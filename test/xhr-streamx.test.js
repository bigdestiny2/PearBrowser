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
