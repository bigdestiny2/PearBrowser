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
require('./_stubs')
const { RelayClient } = require('../backend/relay-client')

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
