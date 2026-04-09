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
  // Extract extension safely
  const lastDot = path.lastIndexOf('.')
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (lastDot <= lastSlash) return 'application/octet-stream'
  const ext = path.slice(lastDot + 1).toLowerCase()
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

// Validate drive key format (64 hex characters)
function isValidDriveKey (keyHex) {
  return typeof keyHex === 'string' && /^[0-9a-f]{64}$/i.test(keyHex)
}

// Escape HTML entities to prevent XSS
function escapeHtml (str) {
  if (typeof str !== 'string') return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
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

    // CORS preflight - only allow localhost origins
    if (req.method === 'OPTIONS') {
      const origin = req.headers.origin
      if (origin && !origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) {
        res.statusCode = 403
        return res.end('Invalid origin')
      }
      res.setHeader('Access-Control-Allow-Origin', origin || 'http://localhost')
      res.statusCode = 204
      return res.end()
    }

    // Validate origin for non-localhost requests
    const origin = req.headers.origin
    if (origin && !origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) {
      res.statusCode = 403
      return res.end('Invalid origin')
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

      // SECURITY: Validate drive key format to prevent path traversal
      if (!isValidDriveKey(driveKeyHex)) {
        res.statusCode = 400
        return res.end('Invalid drive key format')
      }

      // SECURITY: Validate file path to prevent directory traversal
      if (filePath.includes('..') || filePath.includes('\x00')) {
        res.statusCode = 400
        return res.end('Invalid file path')
      }

      this._stats.total++

      // HYBRID FETCH: race relay (fast) vs P2P (reliable)
      const result = await this._hybridFetch(driveKeyHex, filePath)

      if (!result) {
        res.statusCode = 404
        return res.end('File not found')
      }

      const contentType = result.contentType
      const content = result.content

      res.setHeader('Content-Type', contentType)
      res.setHeader('X-Source', result.source)

      // Inject <base> tag for HTML
      if (contentType.includes('text/html')) {
        const html = content.toString('utf-8')
        const prefix = path.startsWith('/app/') ? '/app/' : '/hyper/'
        const baseHref = `http://localhost:${this._port}${prefix}${driveKeyHex}/`
        const injected = html.includes('<head>')
          ? html.replace('<head>', `<head><base href="${baseHref}">`)
          : html.replace(/<html>/i, `<html><head><base href="${baseHref}"></head>`)
        res.statusCode = 200
        return res.end(Buffer.from(injected))
      }

      // Range request support for streaming (video, audio, large files)
      res.setHeader('Accept-Ranges', 'bytes')
      const rangeHeader = req.headers.range || req.headers['range']

      if (rangeHeader) {
        const total = content.length
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (match) {
          const start = match[1] ? parseInt(match[1]) : 0
          const end = match[2] ? parseInt(match[2]) : total - 1
          const chunkSize = end - start + 1

          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
          res.setHeader('Content-Length', chunkSize)
          res.statusCode = 206
          return res.end(content.slice(start, end + 1))
        }
      }

      res.setHeader('Content-Length', content.length)
      res.statusCode = 200
      res.end(content)
    } catch (err) {
      // Log detailed error internally
      this._onError(path, err.message)
      // Return generic error to client (don't leak internal details)
      res.statusCode = 502
      res.setHeader('Content-Type', 'text/html')
      res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#e0e0e0">
        <h1 style="color:#ff9500">Cannot load page</h1>
        <p>The content may be offline or unreachable.</p>
        <p style="color:#666">Please try again later.</p>
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
   * Uses { wait: true } for non-blocking wait — Hypercore handles
   * the waiting internally instead of us polling every 300ms.
   * Inspired by Vinjari's fetch.js approach.
   */
  async _fetchP2P (keyHex, filePath) {
    const drive = await this._getDrive(keyHex)
    if (!drive) return null

    // Use Hyperdrive's built-in wait: true to wait for the specific
    // block we need, with a 15s timeout. No polling.
    const content = await Promise.race([
      drive.get(filePath, { wait: true }),
      new Promise(resolve => setTimeout(() => resolve(null), 15000))
    ])

    if (!content) return null

    return { content, contentType: guessType(filePath) }
  }

  async _serveDirectoryListing (res, drive, keyHex, dirPath) {
    const entries = []
    const MAX_ENTRIES = 1000 // Prevent memory exhaustion
    const TIMEOUT_MS = 5000
    const startTime = Date.now()

    try {
      for await (const entry of drive.list(dirPath)) {
        // Check timeout
        if (Date.now() - startTime > TIMEOUT_MS) {
          break
        }
        entries.push(entry.key)
        if (entries.length >= MAX_ENTRIES) {
          entries.push('... (truncated)')
          break
        }
      }
    } catch (err) {
      this._onError('directory-listing', err.message)
    }

    // Escape all entries to prevent XSS
    const items = entries.map(e => {
      const name = e.startsWith(dirPath) ? e.slice(dirPath.length) : e
      const escapedName = escapeHtml(name)
      const escapedE = escapeHtml(e)
      return `<li><a href="/hyper/${escapeHtml(keyHex)}${escapedE}">${escapedName}</a></li>`
    }).join('\n')

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>hyper://${escapeHtml(keyHex.slice(0, 8))}...${escapeHtml(dirPath)}</title>
<style>body{font-family:-apple-system,sans-serif;padding:20px;background:#0a0a0a;color:#e0e0e0}
h1{color:#ff9500;font-size:1.1em;word-break:break-all}ul{list-style:none;padding:0}
li{padding:8px 0;border-bottom:1px solid #333}a{color:#4dabf7;text-decoration:none}</style>
</head><body><h1>hyper://${escapeHtml(keyHex.slice(0, 8))}...${escapeHtml(dirPath)}</h1>
<ul>${items || '<li style="color:#666">Empty directory</li>'}</ul></body></html>`)
  }
}

module.exports = { HyperProxy }
