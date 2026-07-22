'use strict'
/**
 * Tab Runtime — the "run in a tab" path. Mobile port (Mission B4b) of
 * pearbrowser-desktop backend/tab-runtime.js.
 *
 * Lets a Pear app render HEADLESS inside a browser tab instead of spawning its
 * own window. The app is a `pear-request` worker (htmx frontend + a route
 * handler "server"): the tab's XMLHttpRequest is hooked to a streamx, so htmx
 * thinks it's talking to an HTTP server while the bytes actually flow over a
 * pipe to a headless worker. See examples/headless-tab for the standalone proof.
 *
 * CREDIT: this run-in-tab pattern is from Drache93's Pear Browser
 * (https://github.com/Drache93/pear-browser) and his `pear-request` library
 * (https://github.com/Drache93/pear-request, npm: pear-request) — Pear.worker
 * + htmx-over-a-pipe. Drache93 runs the worker + XHR hook directly in the
 * renderer and renders inline; we instead bridge it over bare-ws into an
 * ISOLATED iframe tab (per-app isolation), driven by our Bare backend.
 *
 * Two transports meet here:
 *   - a bare-http1 server serves the tiny wrapper page + htmx + the injected
 *     pear-request client (everything else streams from the worker)
 *   - a bare-ws server bridges each tab's WebSocket <-> the worker's duplex pipe
 *
 * Worker source is pluggable:
 *   - 'demo'        -> an in-process pear-request router (rock-solid, no network)
 *   - pear://|file:// -> a real headless worker via pear-run (the production path,
 *                        the in-tab sibling of CMD_LAUNCH_PEAR_LINK's window spawn)
 *
 * --- Mobile adaptations (Mission B4b) ---------------------------------------
 * Everything above is the desktop file's own header, kept verbatim. The port
 * changes exactly three things, all driven by one platform fact: the Android
 * worklet cannot spawn a pear-run worker process (there is no Pear runtime on
 * device; bare-subprocess exists in node_modules only as a build-time
 * dependency of the bare-link addon linker; Android forbids execve from
 * app-private storage):
 *
 *   1. `open()` FAILS CLOSED at the RPC boundary for pear:// / file:// links
 *      when no `pearRun` was injected, with a typed TabRuntimeError
 *      (code 'runtime-unavailable'). The desktop defers this to WS-connect
 *      time (TabRuntime._spawnWorker throws 'pear-run not available' and the
 *      socket dies) because desktop pear-run exists and its failure mode is
 *      exceptional; on mobile the absence is the expected state, so the
 *      command must reject honestly instead of handing back a URL that can
 *      never stream. The in-proc 'demo' source is unaffected and works
 *      exactly like the desktop.
 *   2. The PEAR_TAB_DEMO_WORKER / ~/Desktop/pear-request-demo demo-worker
 *      sniffing in start() only runs when a pearRun injector exists — on
 *      mobile it could only register a tab that the gate in (1) rejects.
 *   3. `workerSupported` exposes the gate so the command handler and tests
 *      can report it.
 *
 * Transports are unchanged: bare-http1 + bare-ws over loopback TCP both run in
 * the Android worklet (the HTTP proxy and clearnet proxy already rely on the
 * same loopback path). tab-assets/ and page-context-bridge.cjs are verbatim
 * copies of the desktop files.
 */
const http = require('bare-http1')
const ws = require('bare-ws')
const hypercoreCrypto = require('hypercore-crypto')
const b4a = require('b4a')
const { PAGE_CONTEXT_SHIM, pageContextMeta } = require('./page-context-bridge.cjs')
const router = require('./tab-assets/router.cjs')   // { PearRequestRouter, registerRoutes }
const assets = require('./tab-assets/assets.js')     // { wrapper, htmx, client } inline strings

const WS_PORT_BASE = 9886
const WS_PORT_COUNT = 12

class TabRuntimeError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'TabRuntimeError'
    this.code = code
  }
}

function listenWsServer (port, onSocket) {
  return new Promise((resolve, reject) => {
    const httpServer = http.createServer((req, res) => {
      const body = 'WebSocket required'
      res.writeHead(426, {
        'Content-Type': 'text/plain',
        'Content-Length': body.length
      })
      res.end(body)
    })
    const server = new ws.Server({ server: httpServer }, onSocket)
    let settled = false

    const cleanup = () => {
      httpServer.removeListener('error', onError)
      httpServer.removeListener('listening', onListening)
    }
    const onError = (err) => {
      if (settled) return
      settled = true
      cleanup()
      try { server.close() } catch {}
      reject(err)
    }
    const onListening = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(server)
    }

    httpServer.once('error', onError)
    httpServer.once('listening', onListening)
    httpServer.listen(port, '127.0.0.1')
  })
}

class TabRuntime {
  constructor (opts = {}) {
    this.pearRun = opts.pearRun || null // (link) => duplex worker pipe
    this.tabs = new Map()               // tabId -> { source }
    this._seq = 0
    this.httpPort = 0
    this.wsPort = 0
  }

  // Mobile adaptation (3): whether pear:// / file:// worker tabs can run.
  get workerSupported () {
    return typeof this.pearRun === 'function'
  }

  async start () {
    this._wrapper = assets.wrapper
    this._assets = {
      '/htmx.min.js': { body: assets.htmx, type: 'text/javascript' },
      '/pear-request-client.bundle.js': { body: assets.client, type: 'text/javascript' }
    }

    this._http = http.createServer((req, res) => this._serve(req, res))
    this.httpPort = await new Promise((resolve, reject) => {
      this._http.on('error', reject)
      this._http.listen(0, '127.0.0.1', () => resolve(this._http.address().port))
    })

    for (let p = WS_PORT_BASE; p < WS_PORT_BASE + WS_PORT_COUNT; p++) {
      try {
        this._ws = await listenWsServer(p, (sock) => this._onSocket(sock))
        this.wsPort = p
        break
      } catch (err) {
        if (err && err.code === 'EADDRINUSE') continue
        throw err
      }
    }
    if (!this._ws) throw new Error('TabRuntime: no free WS port in range')
    // A stable demo tab so the headless run-in-tab path is reachable without UI
    // (GET /tab/demo) — the in-process router; the "Headless Demo" card opens it.
    this.tabs.set('demo', { source: 'demo' })
    // Optional: a stable tab that exercises the real pear-run worker path
    // (/tab/demo-worker). Enabled by PEAR_TAB_DEMO_WORKER, or by the local demo
    // app at ~/Desktop/pear-request-demo if present (statSync-guarded, so it's a
    // no-op on machines without it). This is the same app the "Headless Demo
    // (worker)" card launches.
    // Mobile adaptation (2): without a pearRun injector this tab could never
    // stream, so it is not registered at all.
    if (this.workerSupported) {
      const env = (globalThis.Bare && Bare.env) || (globalThis.process && process.env) || {}
      let demoWorker = env.PEAR_TAB_DEMO_WORKER || null
      if (!demoWorker && env.HOME) {
        const p = env.HOME + '/Desktop/pear-request-demo'
        try { require('bare-fs').statSync(p); demoWorker = 'file://' + p } catch {}
      }
      if (demoWorker) {
        this.tabs.set('demo-worker', { source: demoWorker })
        console.log('[tab-runtime] demo-worker (pear-run) -> ' + demoWorker)
      }
    }
    console.log(`[tab-runtime] http :${this.httpPort}  ws :${this.wsPort}  (demo: /tab/demo)`)
    return { httpPort: this.httpPort, wsPort: this.wsPort }
  }

  // Register a tab and return the wrapper URL the UI should load in an iframe.
  open (link) {
    const tabId = 'tab' + (++this._seq)
    const source = (!link || link === 'demo') ? 'demo' : String(link)
    // Mobile adaptation (1): fail closed at the RPC boundary. The desktop
    // discovers a missing pear-run at WS-connect time; mobile knows at open
    // time, so the caller gets a typed unavailable error instead of a URL
    // that would hang the tab.
    if (source !== 'demo' && !this.workerSupported) {
      throw new TabRuntimeError(
        'runtime-unavailable',
        'Running pear:// / file:// apps in a tab is unavailable: this Android build cannot spawn a pear-run worker (no Pear runtime on device)'
      )
    }
    const tab = { source, contextToken: this._newContextToken() }
    this.tabs.set(tabId, tab)
    return {
      tabId,
      url: `http://127.0.0.1:${this.httpPort}/tab/${tabId}?ws=${this.wsPort}`,
      contextToken: tab.contextToken
    }
  }

  contextTokenForUrl (url) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') return null
      if (Number(parsed.port) !== this.httpPort) return null
      const match = parsed.pathname.match(/^\/tab\/([a-zA-Z0-9_-]+)$/)
      if (!match) return null
      const tab = this.tabs.get(match[1])
      if (!tab) return null
      if (!tab.contextToken) tab.contextToken = this._newContextToken()
      return tab.contextToken
    } catch {
      return null
    }
  }

  _newContextToken () {
    return b4a.toString(hypercoreCrypto.randomBytes(32), 'hex')
  }

  _serve (req, res) {
    const u = (req.url || '/').split('?')[0]
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (u.startsWith('/tab/')) {
      const tabId = u.slice('/tab/'.length)
      const tab = this.tabs.get(tabId)
      if (!tab) { res.statusCode = 404; return res.end('unknown tab') }
      if (!tab.contextToken) tab.contextToken = this._newContextToken()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      const contextHead = pageContextMeta(tab.contextToken) + PAGE_CONTEXT_SHIM
      return res.end(this._wrapper.replace('<head>', `<head>${contextHead}`))
    }
    const asset = this._assets[u]
    if (asset) { res.setHeader('Content-Type', asset.type); return res.end(asset.body) }
    res.statusCode = 404
    res.end('not found')
  }

  // Each tab opens one WebSocket. Its FIRST frame is the tabId (bare-ws gives no
  // request URL); every frame after that is pear-request wire bytes for the worker.
  _onSocket (sock) {
    let worker = null
    sock.on('data', (data) => {
      if (!worker) {
        const tabId = data.toString().trim()
        const tab = this.tabs.get(tabId)
        if (!tab) { try { sock.end() } catch {} ; return }
        try {
          worker = tab.source === 'demo' ? this._spawnInProc(sock) : this._spawnWorker(tab.source, sock)
        } catch (err) {
          console.error('[tab-runtime] spawn failed:', err && err.message)
          try { sock.end() } catch {}
        }
        return
      }
      worker.toWorker(data) // browser -> worker request bytes
    })
    sock.on('close', () => { if (worker) worker.close() })
    sock.on('error', () => { if (worker) worker.close() })
  }

  // Demo: host the pear-request router in-process. The worker pipe just writes
  // responses straight back out the same WebSocket.
  _spawnInProc (sock) {
    const workerPipe = {
      write: (buf) => { try { sock.write(buf) } catch {} ; return true },
      once: (ev, cb) => { if (ev === 'drain') queueMicrotask(cb) }
    }
    const r = new router.PearRequestRouter(workerPipe)
    router.registerRoutes(r, { label: 'in-proc worker (pearbrowser backend)' })
    return {
      toWorker: (data) => { try { r.processMessage(data) } catch (e) { console.error('[tab-runtime] router:', e && e.message) } },
      close: () => {}
    }
  }

  // Production: spawn the app as a real headless worker; bridge its pipe <-> WS.
  _spawnWorker (link, sock) {
    if (!this.pearRun) throw new Error('pear-run not available')
    const pipe = this.pearRun(link)
    pipe.on('data', (d) => { try { sock.write(d) } catch {} }) // worker -> browser
    try { pipe.on('error', (e) => console.error('[tab-runtime] worker error:', e && e.message)) } catch {}
    try { pipe.on('crash', (i) => console.error('[tab-runtime] worker crash:', i)) } catch {}
    return {
      toWorker: (data) => { try { pipe.write(data) } catch (e) { console.error('[tab-runtime] write:', e && e.message) } },
      close: () => { try { pipe.end ? pipe.end() : pipe.destroy && pipe.destroy() } catch {} }
    }
  }

  async stop () {
    try { this._ws && this._ws.close() } catch {}
    try { this._http && this._http.close() } catch {}
    this.tabs.clear()
  }
}

module.exports = { TabRuntime, TabRuntimeError }
