'use strict'
// Headless proof for the XHR-over-streamx shim (idea: Dominic). Exercises the
// exact surface htmx drives — open/send, status, responseText, headers, the
// load/progress/error events — but every "request" is satisfied by a streamx
// handler, no HTTP server in sight.
const test = require('node:test')
const assert = require('node:assert')
const { Readable } = require('streamx')
const b4a = require('b4a')
const { createXHR, serveRoutes, echoHandler, installXHR } = require('../backend/xhr-streamx.js')

const onceEvent = (xhr, type) => new Promise((resolve) => xhr.addEventListener(type, resolve))

test('GET over streamx resolves with status + body + load (htmx happy path)', async () => {
  const XHR = createXHR({ handler: serveRoutes({ 'GET /hello': () => 'hi from streamx' }) })
  const xhr = new XHR()
  xhr.open('GET', '/hello')
  const loaded = onceEvent(xhr, 'load')
  xhr.send()
  await loaded
  assert.equal(xhr.readyState, 4)
  assert.equal(xhr.status, 200)
  assert.equal(xhr.responseText, 'hi from streamx')
})

test('POST body + headers reach the handler', async () => {
  const XHR = createXHR({ handler: echoHandler() })
  const xhr = new XHR()
  xhr.open('POST', '/submit')
  xhr.setRequestHeader('Content-Type', 'application/json')
  const loaded = onceEvent(xhr, 'load')
  xhr.send(JSON.stringify({ a: 1 }))
  await loaded
  const echoed = JSON.parse(xhr.responseText)
  assert.equal(echoed.method, 'POST')
  assert.equal(echoed.url, '/submit')
  assert.equal(echoed.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(echoed.body), { a: 1 })
})

test('streaming response fires progress then load, accumulating chunks', async () => {
  const XHR = createXHR({
    handler: () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Readable.from(['<li>a</li>', '<li>b</li>', '<li>c</li>'].map((s) => b4a.from(s))) })
  })
  const xhr = new XHR()
  let progress = 0
  xhr.addEventListener('progress', () => progress++)
  xhr.open('GET', '/stream')
  const loaded = onceEvent(xhr, 'load')
  xhr.send()
  await loaded
  assert.ok(progress >= 1, 'progress fired at least once')
  assert.equal(xhr.responseText, '<li>a</li><li>b</li><li>c</li>')
  assert.equal(xhr.getResponseHeader('content-type'), 'text/html')
})

test('unknown route → 404 (still a load, status set — htmx reads status)', async () => {
  const XHR = createXHR({ handler: serveRoutes({ 'GET /x': () => 'x' }) })
  const xhr = new XHR()
  xhr.open('GET', '/nope')
  const loaded = onceEvent(xhr, 'load')
  xhr.send()
  await loaded
  assert.equal(xhr.status, 404)
})

test('responseType=json parses the response', async () => {
  const XHR = createXHR({ handler: serveRoutes({ 'GET /j': () => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) }) }) })
  const xhr = new XHR()
  xhr.responseType = 'json'
  xhr.open('GET', '/j')
  const loaded = onceEvent(xhr, 'load')
  xhr.send()
  await loaded
  assert.deepEqual(xhr.response, { ok: true })
})

test('handler error surfaces as an error event with status 0', async () => {
  const XHR = createXHR({ handler: () => { throw new Error('boom') } })
  const xhr = new XHR()
  xhr.open('GET', '/err')
  const errored = onceEvent(xhr, 'error')
  xhr.send()
  await errored
  assert.equal(xhr.status, 0)
  assert.equal(xhr.readyState, 4)
})

test('installXHR swaps + restores the global XMLHttpRequest', () => {
  const before = globalThis.XMLHttpRequest
  const restore = installXHR(globalThis, { handler: echoHandler() })
  assert.equal(typeof globalThis.XMLHttpRequest, 'function')
  restore()
  assert.equal(globalThis.XMLHttpRequest, before)
})

const idle = (ms) => new Promise((r) => setTimeout(r, ms)) // ref'd timer — keeps the loop alive while we wait

// An idle streamx Readable (like a Hyperdrive stream waiting on a peer block)
// that records when it is torn down — teardown is observed via 'close', not the
// async-settled `.destroyed` flag.
function trackedReadable () {
  const s = new Readable({ read () {} })
  s._destroyCalled = false
  const orig = s.destroy.bind(s)
  s.destroy = (...a) => { s._destroyCalled = true; return orig(...a) }
  return s
}

test('abort() during streaming destroys the source — no leak, no late load (idle hypercore case)', async () => {
  const src = trackedReadable()
  let loadFired = false
  const XHR = createXHR({ handler: () => ({ status: 200, body: src }) })
  const xhr = new XHR()
  xhr.addEventListener('load', () => { loadFired = true })
  xhr.open('GET', '/stream'); xhr.send()
  await idle(10)
  src.push(b4a.from('partial'))
  await idle(10)
  xhr.abort() // source is idle (no further data) — abort must tear it down eagerly, not wait for a chunk
  await idle(30)
  assert.equal(xhr.readyState, 4)
  assert.ok(src._destroyCalled, 'abort destroyed the source stream')
  src.push(b4a.from('late')) // must not resurrect the request
  await idle(10)
  assert.equal(loadFired, false, 'no load after abort')
})

test('exceeding maxResponseBytes errors and tears down the source', async () => {
  const src = trackedReadable()
  let errFired = false; let status = -1
  const XHR = createXHR({ handler: () => ({ status: 200, body: src }), maxResponseBytes: 8 })
  const xhr = new XHR()
  xhr.addEventListener('error', () => { errFired = true; status = xhr.status })
  xhr.open('GET', '/big'); xhr.send()
  await idle(10)
  src.push(b4a.from('0123456789')) // 10 bytes > cap of 8
  await idle(30)
  assert.ok(errFired, 'error fired when the cap is exceeded')
  assert.equal(status, 0)
  assert.ok(src._destroyCalled, 'cap-exceed destroyed the source stream')
})

test('timeout marks done — a later abort() does not re-fire terminal events', async () => {
  const src = trackedReadable()
  let loadend = 0; let timedOut = false
  const XHR = createXHR({ handler: () => ({ status: 200, body: src }) })
  const xhr = new XHR()
  xhr.addEventListener('loadend', () => { loadend++ })
  xhr.addEventListener('timeout', () => { timedOut = true })
  xhr.timeout = 20
  xhr.open('GET', '/slow'); xhr.send()
  await idle(60) // ref'd wait keeps the loop alive so the unref'd XHR timeout actually fires
  assert.ok(timedOut, 'timeout fired')
  xhr.abort() // must be a no-op — already terminal
  await idle(10)
  assert.equal(loadend, 1, 'loadend fired exactly once across timeout+abort')
})
