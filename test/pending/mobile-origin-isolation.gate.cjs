const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const Module = require('node:module')

// Exercise real loopback listeners under Node while retaining the Bare module
// contract used by the packaged mobile worklet.
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'bare-http1') return http
  if (request === 'bare-crypto') return crypto
  return originalLoad.call(this, request, parent, isMain)
}
const { HyperProxy } = require('../../backend/hyper-proxy')
const { HttpBridge } = require('../../backend/http-bridge')
Module._load = originalLoad

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

function makeProxy (opts = {}) {
  const proxy = new HyperProxy(async () => null, () => {}, null, opts)
  proxy._hybridFetch = async (key) => ({
    content: Buffer.from(`<html><head></head><body>${key}</body></html>`),
    contentType: 'text/html; charset=utf-8',
    source: 'fixture'
  })
  const bridge = new HttpBridge({}, null, null, {
    validateToken: (token) => proxy.validateApiToken(token),
    identity: { getAppKeypair: () => ({ publicKey: Buffer.from(A, 'hex') }) }
  })
  proxy.setHttpBridge(bridge)
  return proxy
}

async function get (url, headers = {}) {
  const response = await fetch(url, { headers })
  return { response, body: await response.text() }
}

test('each drive gets a distinct localhost document origin; same-drive hyper and app routes work', async (t) => {
  const proxy = makeProxy()
  await proxy.start()
  t.after(() => proxy.stop())
  const aHyper = await proxy.localUrlForDrive(A, 'hyper', '/index.html')
  const aApp = await proxy.localUrlForDrive(A, 'app', '/index.html')
  const bHyper = await proxy.localUrlForDrive(B, 'hyper', '/index.html')
  assert.equal(new URL(aHyper).origin, new URL(aApp).origin)
  assert.notEqual(new URL(aHyper).origin, new URL(bHyper).origin)
  assert.notEqual(new URL(aHyper).origin, `http://127.0.0.1:${proxy.port}`)
  const a = await get(aHyper)
  assert.equal(a.response.status, 200)
  assert.match(a.body, new RegExp(`<base href="${new URL(aHyper).origin}/hyper/${A}/">`))
  assert.match(a.body, new RegExp(`<body>${A}</body>`))
  const app = await get(aApp)
  assert.equal(app.response.status, 200)
  assert.match(app.body, new RegExp(`<base href="${new URL(aApp).origin}/app/${A}/">`))
})

test('main listener and a foreign drive listener refuse cross-drive pages', async (t) => {
  const proxy = makeProxy()
  await proxy.start()
  t.after(() => proxy.stop())
  const aUrl = await proxy.localUrlForDrive(A, 'hyper', '/index.html')
  const aOrigin = new URL(aUrl).origin
  const main = await get(`http://127.0.0.1:${proxy.port}/hyper/${A}/index.html`)
  assert.equal(main.response.status, 403)
  const foreign = await get(`${aOrigin}/app/${B}/index.html`)
  assert.equal(foreign.response.status, 403)
  const crossOrigin = await get(aUrl, { Origin: 'http://127.0.0.1:9876' })
  assert.equal(crossOrigin.response.status, 403)
  assert.notEqual(crossOrigin.response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:9876')
})

test('drive API token works on its origin and fails on another drive or main port', async (t) => {
  const proxy = makeProxy()
  await proxy.start()
  t.after(() => proxy.stop())
  const aUrl = await proxy.localUrlForDrive(A, 'hyper', '/index.html')
  const bUrl = await proxy.localUrlForDrive(B, 'hyper', '/index.html')
  const aOrigin = new URL(aUrl).origin
  const bOrigin = new URL(bUrl).origin
  const html = (await get(aUrl)).body
  const token = html.match(/<meta name="pear-api-token" content="([0-9a-f]+)">/)?.[1]
  assert.ok(token)
  assert.equal(proxy.validateApiToken(token).origin, aOrigin)
  const same = await get(`${aOrigin}/api/identity`, { 'X-Pear-Token': token })
  assert.equal(same.response.status, 200)
  const other = await get(`${bOrigin}/api/identity`, { 'X-Pear-Token': token })
  assert.equal(other.response.status, 403)
  const main = await get(`http://127.0.0.1:${proxy.port}/api/identity`, { 'X-Pear-Token': token })
  assert.equal(main.response.status, 403)
})

test('listener allocation is bounded and release revokes tokens', async (t) => {
  const proxy = makeProxy({ maxDriveOrigins: 1 })
  await proxy.start()
  t.after(() => proxy.stop())
  const aUrl = await proxy.localUrlForDrive(A, 'hyper', '/index.html')
  const html = (await get(aUrl)).body
  const token = html.match(/<meta name="pear-api-token" content="([0-9a-f]+)">/)?.[1]
  await assert.rejects(() => proxy.localUrlForDrive(B, 'hyper', '/index.html'), /origin capacity/i)
  assert.equal(await proxy.releaseDriveOrigin(A), true)
  assert.equal(proxy.validateApiToken(token), null)
  const bUrl = await proxy.localUrlForDrive(B, 'hyper', '/index.html')
  assert.notEqual(new URL(aUrl).origin, new URL(bUrl).origin)
})
