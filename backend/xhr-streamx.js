'use strict'
/**
 * xhr-streamx — run htmx (and ANY XMLHttpRequest-based app) over a streamx
 * stream instead of an HTTP server.
 *
 * The page calls `xhr.open()/send()` exactly as if it were talking to a server.
 * It isn't: `send()` hands a framed request to a streamx-style handler and pipes
 * the response back through the XHR's events. There is no HTTP head — just
 * streams — which is what lets a PearBrowser app run *headless*: the same htmx
 * front-end that hits a server in a browser hits a Hyperdrive / a peer / the
 * worklet here, with zero TCP.
 *
 *   ┌── htmx ──┐   xhr.open/send    ┌── shim ──┐   {method,url,headers,body}
 *   │  app UI  │ ───────────────▶   │  XHR     │ ──────────────▶ handler(req)
 *   └──────────┘   load/progress    └──────────┘   ◀── res.body (streamx)
 *
 * IDEA & APPROACH: **Dominic Cassidy** (@Drache93 · github.com/Drache93) —
 * "hook XMLHttpRequest; htmx thinks it's a
 * server, it's actually streamx." Full credit to him. Integrated into
 * PearBrowser's Holepunch-alignment work (docs/HOLEPUNCH_ALIGNMENT_PLAN.md):
 * a streamx-everywhere, server-less transport is the canonical Pear shape.
 *
 * Handler contract (streamx-native):
 *   handler(req) -> res            (may be async)
 *     req = { method, url, headers:{lower-case}, body }   body: streamx Readable | null
 *     res = { status?, statusText?, headers?, body }       body: Readable | string | b4a buffer | null
 *
 * Usage (headless — run an app with no server):
 *   const { createXHR, serveRoutes } = require('./xhr-streamx.js')
 *   globalThis.XMLHttpRequest = createXHR({ handler: serveRoutes({ ... }) })
 *   // ...now load htmx; every hx-get/hx-post flows over streamx.
 */

const b4a = require('b4a')
let Readable = null
try { ({ Readable } = require('streamx')) } catch (_) { /* handlers may pass any async-iterable/stream-ish body */ }

const READY = { UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 }

function lowerKeys (obj) {
  const out = {}
  for (const k of Object.keys(obj || {})) out[String(k).toLowerCase()] = String(obj[k])
  return out
}

function toBuf (x) {
  if (x == null) return b4a.alloc(0)
  if (typeof x === 'string') return b4a.from(x)
  if (b4a.isBuffer(x)) return x
  try { return b4a.from(x) } catch (_) { return b4a.from(String(x)) }
}

/**
 * Build an XMLHttpRequest-compatible constructor whose requests are fulfilled by
 * `handler` over streams. Implements enough of the XHR surface for htmx:
 * open/send/setRequestHeader, status/statusText/responseText/response,
 * get(All)ResponseHeader(s), readyState, abort, timeout, responseType,
 * and the load/error/abort/timeout/progress/readystatechange/loadend events.
 */
function createXHR ({ handler } = {}) {
  if (typeof handler !== 'function') throw new Error('createXHR requires a handler(req) -> res')

  class StreamXHR {
    constructor () {
      this.readyState = READY.UNSENT
      this.status = 0
      this.statusText = ''
      this.responseText = ''
      this.response = ''
      this.responseType = ''
      this.timeout = 0
      this.withCredentials = false
      this.onreadystatechange = null
      this.onload = null
      this.onerror = null
      this.onprogress = null
      this.onloadend = null
      this.ontimeout = null
      this.onabort = null
      this._method = 'GET'
      this._url = ''
      this._reqHeaders = {}
      this._resHeaders = {}
      this._listeners = {}
      this._aborted = false
      this._done = false
      this._timer = null
    }

    open (method, url) {
      this._method = String(method || 'GET').toUpperCase()
      this._url = String(url || '')
      this._setReadyState(READY.OPENED)
    }

    setRequestHeader (k, v) { this._reqHeaders[String(k).toLowerCase()] = String(v) }
    getResponseHeader (k) {
      const v = this._resHeaders[String(k).toLowerCase()]
      return v === undefined ? null : v
    }

    getAllResponseHeaders () {
      const keys = Object.keys(this._resHeaders)
      if (!keys.length) return ''
      return keys.map((k) => k + ': ' + this._resHeaders[k]).join('\r\n') + '\r\n'
    }

    addEventListener (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn) }
    removeEventListener (type, fn) {
      const a = this._listeners[type] || []
      const i = a.indexOf(fn)
      if (i >= 0) a.splice(i, 1)
    }

    abort () {
      if (this._done) return
      this._aborted = true
      this._clearTimer()
      this.readyState = READY.DONE
      this._emit('readystatechange'); this._emit('abort'); this._emit('loadend')
    }

    send (body) {
      const self = this
      if (this.timeout > 0) {
        this._timer = setTimeout(() => {
          if (self._done || self._aborted) return
          self._aborted = true
          self.readyState = READY.DONE
          self._emit('readystatechange'); self._emit('timeout'); self._emit('loadend')
        }, this.timeout)
        if (this._timer.unref) this._timer.unref()
      }
      const reqBody = body == null
        ? null
        : (Readable && typeof body !== 'string' && !b4a.isBuffer(body) && typeof body.pipe === 'function'
            ? body
            : (Readable ? Readable.from([toBuf(body)]) : toBuf(body)))
      const req = { method: this._method, url: this._url, headers: { ...this._reqHeaders }, body: reqBody }

      Promise.resolve().then(() => handler(req)).then((res) => {
        if (self._aborted) return
        res = res || {}
        self.status = Number.isFinite(res.status) ? res.status : 200
        self.statusText = res.statusText || ''
        self._resHeaders = lowerKeys(res.headers)
        self._setReadyState(READY.HEADERS_RECEIVED)

        const out = res.body
        if (out == null) return self._finish(b4a.alloc(0))
        if (typeof out === 'string' || b4a.isBuffer(out)) {
          self._setReadyState(READY.LOADING); self._emit('progress')
          return self._finish(toBuf(out))
        }
        // streaming body (streamx Readable / Node stream / async iterable)
        const chunks = []
        const onData = (c) => {
          if (self._aborted) { try { out.destroy && out.destroy() } catch (_) {} ; return }
          chunks.push(toBuf(c))
          self.responseText = b4a.toString(b4a.concat(chunks))
          self._setReadyState(READY.LOADING); self._emit('progress')
        }
        if (typeof out.on === 'function') {
          out.on('data', onData)
          out.on('end', () => { if (!self._aborted) self._finish(b4a.concat(chunks)) })
          out.on('error', (err) => { if (!self._aborted) self._error(err) })
        } else if (out[Symbol.asyncIterator]) {
          ;(async () => {
            try { for await (const c of out) onData(c); if (!self._aborted) self._finish(b4a.concat(chunks)) } catch (err) { if (!self._aborted) self._error(err) }
          })()
        } else {
          self._error(new Error('handler returned an unsupported body'))
        }
      }).catch((err) => { if (!self._aborted) self._error(err) })
    }

    _setReadyState (s) { this.readyState = s; this._emit('readystatechange') }

    _finish (buf) {
      this._clearTimer()
      this._done = true
      this.responseText = b4a.toString(buf)
      this.response = this.responseType === 'json' ? safeJson(this.responseText) : this.responseText
      this.readyState = READY.DONE
      this._emit('readystatechange'); this._emit('load'); this._emit('loadend')
    }

    _error (err) {
      this._clearTimer()
      this._done = true
      this.status = 0
      this.statusText = ''
      this._lastError = err
      this.readyState = READY.DONE
      this._emit('readystatechange'); this._emit('error'); this._emit('loadend')
    }

    _clearTimer () { if (this._timer) { clearTimeout(this._timer); this._timer = null } }

    _emit (type) {
      const ev = { type, target: this, currentTarget: this, lengthComputable: false, loaded: this.responseText.length, total: 0 }
      const h = this['on' + type]
      if (typeof h === 'function') { try { h.call(this, ev) } catch (_) {} }
      for (const fn of (this._listeners[type] || []).slice()) { try { fn.call(this, ev) } catch (_) {} }
    }
  }
  Object.assign(StreamXHR, READY)
  return StreamXHR
}

function safeJson (s) { try { return JSON.parse(s) } catch (_) { return null } }

/** Install the shim as the global XMLHttpRequest (headless app runs). Returns a restore fn. */
function installXHR (target, opts) {
  const prev = target.XMLHttpRequest
  target.XMLHttpRequest = createXHR(opts)
  return () => { target.XMLHttpRequest = prev }
}

// --- ready-made handlers -----------------------------------------------------

/** Echo handler — reflects the request (handy for smoke tests / demos). */
function echoHandler () {
  return async (req) => {
    const body = req.body ? await drain(req.body) : b4a.alloc(0)
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: b4a.toString(body) })
    }
  }
}

/**
 * Route handler — map "METHOD /path" (or "/path") to a function. The function
 * gets (req, params) and returns a body string/buffer/stream or a full
 * { status, headers, body }. Path may be a string or RegExp.
 */
function serveRoutes (routes) {
  const table = Object.keys(routes || {}).map((key) => {
    const sp = key.split(' ')
    const method = sp.length > 1 ? sp[0].toUpperCase() : null
    const path = sp.length > 1 ? sp.slice(1).join(' ') : key
    return { method, path, fn: routes[key] }
  })
  return async (req) => {
    const path = req.url.split('?')[0]
    for (const r of table) {
      if (r.method && r.method !== req.method) continue
      if (r.path instanceof RegExp ? r.path.test(path) : r.path === path) {
        const out = await r.fn(req)
        if (out && (typeof out === 'object') && ('body' in out || 'status' in out)) return out
        return { status: 200, body: out }
      }
    }
    return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found: ' + req.url }
  }
}

/**
 * Hyperdrive handler — serve a P2P drive's files to an XHR app over streamx,
 * no HTTP server in between. `GET /index.html` → drive.createReadStream(...).
 * @param {*} drive  a Hyperdrive (needs entry() + createReadStream())
 */
function serveHyperdrive (drive, { index = 'index.html' } = {}) {
  return async (req) => {
    let p = decodeURI(req.url.split('?')[0])
    if (p.endsWith('/')) p += index
    if (!p.startsWith('/')) p = '/' + p
    const entry = await drive.entry(p)
    if (!entry) return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found: ' + p }
    return { status: 200, headers: { 'content-type': contentType(p) }, body: drive.createReadStream(p) }
  }
}

async function drain (stream) {
  if (stream == null) return b4a.alloc(0)
  if (typeof stream === 'string' || b4a.isBuffer(stream)) return toBuf(stream)
  const chunks = []
  for await (const c of stream) chunks.push(toBuf(c))
  return b4a.concat(chunks)
}

function contentType (p) {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
  return ({
    html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript',
    css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', wasm: 'application/wasm'
  })[ext] || 'application/octet-stream'
}

module.exports = { createXHR, installXHR, echoHandler, serveRoutes, serveHyperdrive, drain, READY }
