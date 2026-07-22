'use strict'

// Mobile port (Mission B4b): adapted from pearbrowser-desktop/test/tab-runtime-context.test.js
// (ESM → CommonJS; same Module._load stubbing — bare-http1/bare-ws need the
// Bare runtime, so the module is loaded with inert stand-ins and exercised
// without sockets). Extended for the mobile gate: worker links fail closed.

const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const nodeCrypto = require('node:crypto')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'bare-http1') return {}
  if (request === 'bare-ws') return {}
  if (request === 'hypercore-crypto') return { randomBytes: nodeCrypto.randomBytes }
  return originalLoad.call(this, request, parent, isMain)
}
const { TabRuntime, TabRuntimeError } = require('../backend/tab-runtime.cjs')
Module._load = originalLoad

function fakeRuntime () {
  const runtime = new TabRuntime()
  runtime.httpPort = 7411
  runtime.wsPort = 7412
  runtime._wrapper = '<!doctype html><html><head></head><body>worker</body></html>'
  runtime._assets = {}
  return runtime
}

test('TabRuntime binds an authenticated context bridge to its own wrapper URLs', () => {
  const runtime = fakeRuntime()

  const opened = runtime.open('demo')
  assert.match(opened.contextToken, /^[0-9a-f]{64}$/)
  assert.equal(runtime.contextTokenForUrl(opened.url), opened.contextToken)
  assert.equal(runtime.contextTokenForUrl('http://127.0.0.1:9999/tab/tab1'), null)
  assert.equal(runtime.contextTokenForUrl('https://example.com/tab/tab1'), null)

  const res = {
    headers: {},
    setHeader (name, value) { this.headers[name.toLowerCase()] = value },
    end (body) { this.body = String(body || '') }
  }
  runtime._serve({ url: new URL(opened.url).pathname }, res)
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8')
  assert.match(res.body, new RegExp(`<meta name="pear-page-context-token" content="${opened.contextToken}">`))
  assert.match(res.body, /pearbrowser:context-request/)
})

test('mobile gate: pear:// / file:// tabs fail closed without a pearRun injector', () => {
  const runtime = fakeRuntime()
  assert.equal(runtime.workerSupported, false)

  // The demo path stays open — that one runs fully in the worklet.
  const demo = runtime.open('demo')
  assert.equal(demo.tabId, 'tab1')
  assert.match(demo.url, /^http:\/\/127\.0\.0\.1:7411\/tab\/tab1\?ws=7412$/)

  for (const link of ['pear://app.example', 'file:///tmp/app']) {
    assert.throws(() => runtime.open(link), (err) => {
      assert.equal(err instanceof TabRuntimeError, true)
      assert.equal(err.code, 'runtime-unavailable')
      assert.match(err.message, /pear-run/)
      return true
    })
  }
  // A rejected open must not leak a registered tab.
  assert.equal(runtime.tabs.has('tab2'), false)
})

test('mobile gate: with a pearRun injector the worker path opens like the desktop', () => {
  const runtime = new TabRuntime({ pearRun: () => { throw new Error('not called at open time') } })
  runtime.httpPort = 7411
  runtime.wsPort = 7412
  assert.equal(runtime.workerSupported, true)
  const opened = runtime.open('pear://app.example')
  assert.equal(opened.tabId, 'tab1')
  assert.match(opened.contextToken, /^[0-9a-f]{64}$/)
})

test('TabRuntime refuses to bridge sockets for unknown tabs', () => {
  const runtime = fakeRuntime()
  const state = { ended: false, writes: [] }
  const sock = {
    handlers: {},
    on (ev, cb) { this.handlers[ev] = cb },
    write (buf) { state.writes.push(buf) },
    end () { state.ended = true }
  }
  runtime._onSocket(sock)
  sock.handlers.data(Buffer.from('nope'))
  assert.equal(state.ended, true)
})

test('TabRuntime demo worker spawns the in-proc router for a known tab', () => {
  const runtime = fakeRuntime()
  const opened = runtime.open('demo')
  const state = { ended: false, writes: [] }
  const sock = {
    handlers: {},
    on (ev, cb) { this.handlers[ev] = cb },
    write (buf) { state.writes.push(buf) ; return true },
    end () { state.ended = true }
  }
  runtime._onSocket(sock)
  // First frame selects the tab; the in-proc router is spawned without throwing.
  sock.handlers.data(Buffer.from(opened.tabId))
  assert.equal(state.ended, false)
  // Socket close/error are safe both before and after a worker attached.
  sock.handlers.close()
  sock.handlers.error()
})
