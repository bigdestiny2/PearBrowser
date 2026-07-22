/**
 * RelayClient configuration tests (Phase 0 ticket 2).
 *
 * Validates that the runtime config surface introduced for
 * CMD_GET_RELAYS / CMD_SET_RELAYS / CMD_SET_RELAY_ENABLED works correctly
 * without needing the Bare runtime or a live swarm.
 *
 * Bare-only deps (bare-http1, bare-crypto) are stubbed via Node's
 * Module._resolveFilename hook so the backend files parse and evaluate.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
require('./_stubs')
const { RelayClient, relayRequestOptions } = require('../backend/relay-client')

test('constructor defaults to enabled=true and a single fallback relay', () => {
  const rc = new RelayClient()
  assert.equal(rc.enabled, true)
  assert.deepEqual(rc.relays, ['http://127.0.0.1:9100'])
})

test('constructor respects explicit enabled=false', () => {
  const rc = new RelayClient({ enabled: false })
  assert.equal(rc.enabled, false)
})

test('setRelays accepts valid http(s) urls, rejects invalid', () => {
  const rc = new RelayClient()
  const ok = rc.setRelays(['https://relay-us.p2phiverelay.xyz', 'http://localhost:9100'])
  assert.equal(ok, true)
  assert.deepEqual(rc.relays, ['https://relay-us.p2phiverelay.xyz', 'http://localhost:9100'])
})

test('constructor normalizes configured relays', () => {
  const rc = new RelayClient({
    relays: [
      ' https://relay-us.p2phiverelay.xyz/ ',
      'https://relay-us.p2phiverelay.xyz///',
      'ftp://relay.example.com',
      'https://relay.example.com/catalog?token=secret',
      'http://localhost:9100///'
    ]
  })
  assert.deepEqual(rc.relays, ['https://relay-us.p2phiverelay.xyz', 'http://localhost:9100'])
})

test('setRelays strips trailing slashes', () => {
  const rc = new RelayClient()
  rc.setRelays(['https://relay-us.p2phiverelay.xyz/', 'https://relay-sg.p2phiverelay.xyz///'])
  assert.deepEqual(rc.relays, [
    'https://relay-us.p2phiverelay.xyz',
    'https://relay-sg.p2phiverelay.xyz',
  ])
})

test('setRelays ignores non-http schemes silently and returns false if nothing valid', () => {
  const rc = new RelayClient()
  const before = [...rc.relays]
  const ok = rc.setRelays(['ftp://relay.example.com', 'hyper://abc123', '', 42])
  assert.equal(ok, false)
  assert.deepEqual(rc.relays, before)
})

test('setRelays throws TypeError on non-array input', () => {
  const rc = new RelayClient()
  assert.throws(() => rc.setRelays('https://single.example.com'), TypeError)
  assert.throws(() => rc.setRelays(null), TypeError)
})

test('addRelay normalizes and rejects invalid relay urls', () => {
  const rc = new RelayClient({ relays: [] })
  assert.equal(rc.addRelay('https://relay-us.p2phiverelay.xyz///'), true)
  assert.equal(rc.addRelay('hyper://abc123'), false)
  assert.equal(rc.addRelay('https://user:pass@relay.example.com'), false)
  assert.deepEqual(rc.relays, ['https://relay-us.p2phiverelay.xyz'])
})

test('setRelays clears circuit breakers for fresh attempts', () => {
  const rc = new RelayClient()
  rc._circuitBreakers.set('http://127.0.0.1:9100', { failures: 3, open: true, lastFailure: Date.now() })
  rc.setRelays(['https://new.example.com'])
  assert.equal(rc._circuitBreakers.size, 0)
})

test('setEnabled flips the flag', () => {
  const rc = new RelayClient()
  rc.setEnabled(false)
  assert.equal(rc.enabled, false)
  rc.setEnabled(true)
  assert.equal(rc.enabled, true)
  rc.setEnabled(1)
  assert.equal(rc.enabled, true)
})

test('fetch short-circuits when disabled', async () => {
  const rc = new RelayClient({ relays: ['http://localhost:65535'] })
  rc.setEnabled(false)
  const result = await rc.fetch('a'.repeat(64), '/index.html')
  assert.equal(result, null)
})

test('getConfig returns a safe snapshot', () => {
  const rc = new RelayClient({
    relays: ['https://relay-us.p2phiverelay.xyz'],
    enabled: true,
  })
  const cfg = rc.getConfig()
  assert.deepEqual(cfg.relays, ['https://relay-us.p2phiverelay.xyz'])
  assert.equal(cfg.enabled, true)
  assert.ok(Array.isArray(cfg.circuitBreakers))
  assert.ok(typeof cfg.stats === 'object' && cfg.stats !== null)
  cfg.relays.push('https://attacker.example')
  assert.deepEqual(rc.relays, ['https://relay-us.p2phiverelay.xyz'])
})

test('relayRequestOptions uses scheme-aware default ports', () => {
  assert.equal(relayRequestOptions(new URL('http://relay.example.com/catalog.json')).port, 80)
  assert.equal(relayRequestOptions(new URL('https://relay.example.com/catalog.json')).port, 443)
  assert.equal(relayRequestOptions(new URL('https://relay.example.com:9443/catalog.json')).port, 9443)
  assert.throws(() => relayRequestOptions(new URL('ftp://relay.example.com/catalog.json')), /unsupported relay URL protocol/)
})

test('_httpGet selects bare-https for https relay URLs', async (t) => {
  const bareHttp = require('bare-http1')
  const bareHttps = require('bare-https')
  const originalHttpGet = bareHttp.get
  const originalHttpsGet = bareHttps.get
  t.after(() => {
    bareHttp.get = originalHttpGet
    bareHttps.get = originalHttpsGet
  })

  const calls = []
  bareHttp.get = () => {
    throw new Error('bare-http1 must not handle https relays')
  }
  bareHttps.get = (opts, cb) => {
    calls.push(opts)
    const req = new EventEmitter()
    req.destroy = () => {}
    process.nextTick(() => {
      const res = new EventEmitter()
      res.statusCode = 200
      res.headers = { 'content-type': 'text/plain' }
      cb(res)
      res.emit('data', Buffer.from('relay-ok'))
      res.emit('end')
    })
    return req
  }

  const rc = new RelayClient({ relays: [] })
  const result = await rc._httpGet('https://relay.example.com/v1/hyper/' + 'a'.repeat(64) + '/index.html?x=1', 1000)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].hostname, 'relay.example.com')
  assert.equal(calls[0].port, 443)
  assert.equal(calls[0].path, '/v1/hyper/' + 'a'.repeat(64) + '/index.html?x=1')
  assert.equal(result.status, 200)
  assert.equal(result.contentType, 'text/plain')
  assert.equal(Buffer.from(result.body).toString('utf8'), 'relay-ok')
})

test('requestSeed posts to https relays through bare-https with auth headers', async (t) => {
  const bareHttp = require('bare-http1')
  const bareHttps = require('bare-https')
  const originalHttpRequest = bareHttp.request
  const originalHttpsRequest = bareHttps.request
  t.after(() => {
    bareHttp.request = originalHttpRequest
    bareHttps.request = originalHttpsRequest
  })

  const writes = []
  let requestOpts = null
  bareHttp.request = () => {
    throw new Error('bare-http1 must not handle https relays')
  }
  bareHttps.request = (opts, cb) => {
    requestOpts = opts
    const req = new EventEmitter()
    req.write = (chunk) => writes.push(String(chunk))
    req.destroy = () => {}
    req.end = () => {
      process.nextTick(() => {
        const res = new EventEmitter()
        res.statusCode = 204
        res.headers = {}
        cb(res)
        res.emit('end')
      })
    }
    return req
  }

  const key = 'b'.repeat(64)
  const rc = new RelayClient({
    relays: ['https://relay.example.com'],
    apiKey: 'secret-key'
  })
  const result = await rc.requestSeed(key)

  assert.deepEqual(result, { ok: true, relay: 'https://relay.example.com' })
  assert.equal(requestOpts.method, 'POST')
  assert.equal(requestOpts.hostname, 'relay.example.com')
  assert.equal(requestOpts.port, 443)
  assert.equal(requestOpts.path, '/seed')
  assert.equal(requestOpts.headers.Authorization, 'Bearer secret-key')
  assert.equal(requestOpts.headers['x-api-key'], 'secret-key')
  assert.equal(requestOpts.headers['Content-Type'], 'application/json')
  assert.equal(requestOpts.headers['Content-Length'], String(Buffer.byteLength(writes[0])))
  assert.deepEqual(JSON.parse(writes[0]), { appKey: key })
})
