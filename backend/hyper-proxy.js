/**
 * Hyper Proxy — Local HTTP server bridging WebView to Hyperdrives
 *
 * URL mapping:
 *   localhost:PORT/hyper/KEY/path → fetches from Hyperdrive
 *   localhost:PORT/app/APP_ID/path → fetches from installed app's drive
 *
 * Injects <base> tags for relative link resolution in HTML.
 */

const http = require('bare-http1')

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8'
}

function guessType (path) {
  const ext = path.split('.').pop().toLowerCase()
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

class HyperProxy {
  constructor (getDrive, onError, relayClient) {
    this._getDrive = getDrive // async (keyHex) => Hyperdrive
    this._onError = onError || (() => {})
    this._relay = relayClient || null // RelayClient for fast-path
    this._httpBridge = null // HttpBridge for direct WebView API
    this._server = null
    this._port = 0
    this._stats = { relayHits: 0, p2pHits: 0, total: 0 }
  }

  setHttpBridge (bridge) {
    this._httpBridge = bridge
  }

  get port () { return this._port }

  async start () {
    this._server = http.createServer((req, res) => this._handle(req, res))

    return new Promise((resolve, reject) => {
      this._server.on('error', reject)
      this._server.listen(0, '127.0.0.1', () => {
        this._port = this._server.address().port
        resolve(this._port)
      })
    })
  }

  async stop () {
    if (!this._server) return
    return new Promise(resolve => this._server.close(() => resolve()))
  }

  async _handle (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }

    const url = new URL(req.url, `http://localhost:${this._port}`)
    const path = url.pathname

    // HTTP Bridge — direct API for WebView apps (bypasses RN relay)
    if (this._httpBridge && path.startsWith('/api/')) {
      const handled = await this._httpBridge.handle(req, res, url)
      if (handled) return
    }

    // Health check
    if (path === '/health') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ ok: true }))
    }

    try {
      let driveKeyHex, filePath

      if (path.startsWith('/hyper/')) {
        // Direct hyper:// browsing: /hyper/KEY/path
        const rest = path.slice('/hyper/'.length)
        const slash = rest.indexOf('/')
        driveKeyHex = slash === -1 ? rest : rest.slice(0, slash)
        filePath = slash === -1 ? '/' : rest.slice(slash)
      } else if (path.startsWith('/app/')) {
        // Installed app: /app/DRIVE_KEY/path
        const rest = path.slice('/app/'.length)
        const slash = rest.indexOf('/')
        driveKeyHex = slash === -1 ? rest : rest.slice(0, slash)
        filePath = slash === -1 ? '/' : rest.slice(slash)
      } else {
        res.statusCode = 404
        return res.end('Not found')
      }

      this._stats.total++

      // HYBRID FETCH: race relay (fast) vs P2P (reliable)
      const result = await this._hybridFetch(driveKeyHex, filePath)

      if (!result) {
        res.statusCode = 404
        return res.end('File not found')
      }

      res.setHeader('Content-Type', result.contentType)
      res.setHeader('X-Source', result.source) // 'relay' or 'p2p'

      // Inject <base> tag for HTML
      if (result.contentType.includes('text/html')) {
        const html = result.content.toString('utf-8')
        const prefix = path.startsWith('/app/') ? '/app/' : '/hyper/'
        const baseHref = `http://localhost:${this._port}${prefix}${driveKeyHex}/`
        const injected = html.includes('<head>')
          ? html.replace('<head>', `<head><base href="${baseHref}">`)
          : html.replace(/<html>/i, `<html><head><base href="${baseHref}"></head>`)
        res.statusCode = 200
        return res.end(Buffer.from(injected))
      }

      res.statusCode = 200
      res.end(result.content)
    } catch (err) {
      this._onError(path, err.message)
      res.statusCode = 502
      res.setHeader('Content-Type', 'text/html')
      res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#e0e0e0">
        <h1 style="color:#ff9500">Cannot load page</h1>
        <p>${err.message}</p>
        <p style="color:#666">The content may be offline or unreachable.</p>
      </body></html>`)
    }
  }

  /**
   * Hybrid fetch — race relay HTTP (fast) vs P2P Hyperdrive (reliable).
   * Returns { content, contentType, source } or null.
   */
  async _hybridFetch (keyHex, filePath) {
    // Resolve directory paths
    let resolvedPath = filePath
    if (filePath.endsWith('/') || filePath === '') {
      resolvedPath = (filePath || '/') + 'index.html'
    }

    // Start both fetches concurrently
    const relayPromise = this._relay
      ? this._relay.fetch(keyHex, resolvedPath).catch(() => null)
      : Promise.resolve(null)

    const p2pPromise = this._fetchP2P(keyHex, resolvedPath).catch(() => null)

    // Race: first successful response wins
    const result = await Promise.any([
      relayPromise.then(r => r ? { ...r, source: 'relay' } : Promise.reject(new Error('relay: no content'))),
      p2pPromise.then(r => r ? { ...r, source: 'p2p' } : Promise.reject(new Error('p2p: no content')))
    ]).catch((err) => {
      // Both relay and P2P failed
      const reasons = err.errors ? err.errors.map(e => e.message).join(', ') : 'all sources unavailable'
      this._onError(keyHex + resolvedPath, 'Hybrid fetch failed: ' + reasons)
      return null
    })

    if (result) {
      if (result.source === 'relay') this._stats.relayHits++
      else this._stats.p2pHits++
    }

    return result
  }

  /**
   * Fetch from P2P (Hyperdrive)
   */
  async _fetchP2P (keyHex, filePath) {
    const drive = await this._getDrive(keyHex)
    if (!drive) return null

    // Wait for data if drive is fresh
    if (drive.version === 0) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 15000)
        const check = async () => {
          const entry = await drive.entry(filePath).catch(() => null)
          if (entry) { clearTimeout(timeout); resolve() }
          else setTimeout(check, 300)
        }
        check()
      })
    }

    const content = await drive.get(filePath)
    if (!content) return null

    return { content, contentType: guessType(filePath) }
  }

  async _serveDirectoryListing (res, drive, keyHex, dirPath) {
    const entries = []
    try {
      for await (const entry of drive.list(dirPath)) {
        entries.push(entry.key)
      }
    } catch {}

    const items = entries.map(e => {
      const name = e.startsWith(dirPath) ? e.slice(dirPath.length) : e
      return `<li><a href="/hyper/${keyHex}${e}">${name}</a></li>`
    }).join('\n')

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>hyper://${keyHex.slice(0, 8)}...${dirPath}</title>
<style>body{font-family:-apple-system,sans-serif;padding:20px;background:#0a0a0a;color:#e0e0e0}
h1{color:#ff9500;font-size:1.1em;word-break:break-all}ul{list-style:none;padding:0}
li{padding:8px 0;border-bottom:1px solid #333}a{color:#4dabf7;text-decoration:none}</style>
</head><body><h1>hyper://${keyHex.slice(0, 8)}...${dirPath}</h1>
<ul>${items || '<li style="color:#666">Empty directory</li>'}</ul></body></html>`)
  }
}

module.exports = { HyperProxy }
