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
const crypto = require('bare-crypto')
const b4a = require('b4a')

const USER_FRIENDLY_ERRORS = {
  'Invalid drive key': 'This link appears to be broken or incomplete',
  'Invalid drive key format': 'The address you entered is not valid',
  'File not found': 'The page you\'re looking for doesn\'t exist on this site',
  'Timeout': 'Taking longer than expected. The site may be offline or unreachable.',
  'Drive not found': 'This site is currently unavailable. The owner may have taken it offline.',
  'Failed to open drive': 'Could not connect to this site. It may be offline.',
  'Failed to open app drive': 'Could not load this app. It may be corrupted or unavailable.',
  'Failed to open catalog drive': 'Could not load the app store. The catalog may be unavailable.',
  'Hybrid fetch failed': 'Unable to load content. Check your connection and try again.',
  'No catalog.json found': 'This app store is empty or not properly configured.',
  'Invalid origin': 'Security error: Access denied',
  'Buffer exceeded': 'The response was too large to process',
  'Operation too large': 'This action is too large to complete',
}

function getUserFriendlyError(technicalError) {
  for (const [key, message] of Object.entries(USER_FRIENDLY_ERRORS)) {
    if (technicalError.includes(key)) {
      return message
    }
  }
  return 'Something went wrong. Please try again.'
}

function isLoopbackOrigin (origin) {
  if (typeof origin !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  } catch {
    return false
  }
}

/**
 * Canonicalise an origin string to `scheme://host[:port]`. Strips path,
 * query, fragment, default ports. Returns null if it's not a parseable
 * http(s):// URL with a non-empty host.
 *
 * Same input → same output, deterministically. Used to derive a stable
 * pseudo-drive-key per origin.
 */
function normaliseOrigin (origin) {
  if (typeof origin !== 'string') return null
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    const defaultPort = u.protocol === 'https:' ? '443' : '80'
    const port = u.port && u.port !== defaultPort ? ':' + u.port : ''
    return `${u.protocol}//${u.hostname.toLowerCase()}${port}`
  } catch {
    return null
  }
}

/**
 * Is this Origin header well-formed enough to be considered a real
 * web origin (so the bridge layer can then check it against an issued
 * token)? Rejects loopback (those go via isLoopbackOrigin) and
 * malformed strings.
 */
function isCanonicalHttpOrigin (origin) {
  const norm = normaliseOrigin(origin)
  return norm !== null && norm === origin
}

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
    this._inFlight = new Map() // key -> Promise

    // LRU content cache
    this._cache = new Map() // Simple LRU implementation
    this._cacheMaxSize = 50 * 1024 * 1024 // 50MB
    this._cacheCurrentSize = 0
    this._cacheStats = { hits: 0, misses: 0 }
    this._apiTokens = new Map() // token -> { driveKeyHex, issuedAt }
    this._apiTokenTtlMs = 10 * 60 * 1000 // 10 minutes
    this._pearSwarmShim = ''
  }

  setHttpBridge (bridge) {
    this._httpBridge = bridge
  }

  setPearSwarmShim (shimHtml) {
    this._pearSwarmShim = String(shimHtml || '')
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
    // Origin policy:
    //   - Loopback origins (http://127.0.0.1, http://localhost) — always allowed.
    //     hyper:// pages served via this proxy come from loopback, so they
    //     always pass.
    //   - http(s) origins — allowed IF the request carries an X-Pear-Token
    //     issued for that exact origin via issueOriginToken(). The
    //     http-bridge layer cross-checks the Origin header against the
    //     token's recorded origin on each call. Here we allow the
    //     request through so the bridge can do that check.
    //   - Anything else — rejected outright.
    const origin = req.headers.origin
    const acceptableOrigin = origin && (isLoopbackOrigin(origin) || isCanonicalHttpOrigin(origin))
    if (origin && !acceptableOrigin) {
      res.statusCode = 403
      res.setHeader('Content-Type', 'text/plain')
      return res.end('Invalid origin')
    }

    // CORS — default-DENY the echo. We only reflect Access-Control-Allow-Origin
    // for an origin we can affirmatively trust:
    //   - loopback origins (http://127.0.0.1, http://localhost), OR
    //   - a non-loopback http(s) origin that presents a valid, unexpired
    //     origin-scoped token (X-Pear-Token header, or `token` query param
    //     for EventSource which cannot set headers) issued for THAT exact
    //     origin.
    // The token is validated BEFORE the echo decision. An arbitrary,
    // unauthenticated https origin is NEVER echoed — it falls back to the
    // loopback default, so the browser denies the cross-origin read.
    let allowOrigin = 'http://127.0.0.1'
    if (origin && isLoopbackOrigin(origin)) {
      allowOrigin = origin
    } else if (origin) {
      const rawToken = req.headers['x-pear-token']
      let token = Array.isArray(rawToken) ? rawToken[0] : rawToken
      if (!token) {
        // EventSource fallback — token may ride in the query string.
        try {
          token = new URL(req.url, `http://localhost:${this._port}`)
            .searchParams.get('token') || null
        } catch {
          token = null
        }
      }
      const entry = token ? this.validateApiToken(token) : null
      if (entry && entry.kind === 'origin' && entry.origin === origin) {
        allowOrigin = origin
      }
    }

    res.setHeader('Access-Control-Allow-Origin', allowOrigin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Pear-Token')

    // CORS preflight handler
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

      // KNOWN LIMITATION — single shared origin: both /hyper/KEY/... and
      // /app/KEY/... are served from the one origin http://127.0.0.1:PORT.
      // There is therefore NO per-app isolation at the browser layer — all
      // drives/apps share the same origin and thus the same cookie jar,
      // localStorage, and same-origin fetch reach. The canonical fix is to
      // give each app its OWN origin (a custom scheme handler, or a
      // per-drive-key subdomain). We deliberately do NOT re-architect that
      // here; the injected CSP only limits what a single shared-origin page
      // can load, it does not separate apps from each other.
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

      // Check if this is a directory request
      if (filePath.endsWith('/') || filePath === '') {
        const drive = await this._getDrive(driveKeyHex)
        if (drive) {
          // Check if there's an index.html
          const indexExists = await drive.entry(filePath + 'index.html').catch(() => null)
          if (!indexExists) {
            // No index, show directory listing
            return this._serveDirectoryListing(res, drive, driveKeyHex, filePath)
          }
          // Has index, serve it (filePath stays as directory path)
        }
      }

      // Check cache first
      const cacheKey = this._getCacheKey(driveKeyHex, filePath)
      const cached = this._getFromCache(cacheKey)
      if (cached) {
        res.setHeader('Content-Type', cached.contentType)
        res.setHeader('X-Cache', 'HIT')
        if (cached.contentType.includes('text/html')) {
          return this._serveHtmlWithBridge(res, path, driveKeyHex, cached.content)
        }
        res.statusCode = 200
        return res.end(cached.content)
      }
      this._cacheStats.misses++

      // STREAMING PATH for large / range-requested non-HTML files.
      // drive.get() buffers the WHOLE file into memory before we send a
      // byte — fine for small cached assets, ruinous for video/audio/large
      // downloads and pointless for a 206 range slice. So before the
      // (buffering) hybrid fetch, resolve the entry: if the drive is
      // reachable, the entry exists, and the file is either being
      // range-requested or is larger than the streaming threshold, pipe
      // drive.createReadStream(path, { start, length }) straight to res
      // with streamx backpressure. drive.get() stays reserved for small
      // files (so they can still be cached + HTML-injected below).
      const contentTypeGuess = guessType(filePath)
      const isHtml = contentTypeGuess.includes('text/html')
      const rangeHeader = req.headers.range
      if (!isHtml) {
        const streamed = await this._maybeStreamFromDrive(
          req, res, driveKeyHex, filePath, contentTypeGuess, rangeHeader
        )
        if (streamed) return
      }

      // HYBRID FETCH: race relay (fast) vs P2P (reliable)
      const result = await this._hybridFetch(driveKeyHex, filePath)

      if (!result) {
        res.statusCode = 404
        return res.end('File not found')
      }

      // Cache successful result
      this._setCache(cacheKey, result.content, result.contentType)

      const contentType = result.contentType
      const content = result.content
      res.setHeader('X-Cache', 'MISS')

      res.setHeader('Content-Type', contentType)
      res.setHeader('X-Source', result.source)

      // Inject <base> tag + per-page api-token meta + window.pear.swarm.v1
      // shim for HTML responses. Pages get the shim "for free" — no
      // <script src> required from the author.
      if (contentType.includes('text/html')) {
        return this._serveHtmlWithBridge(res, path, driveKeyHex, content)
      }

      // Range request support for buffered fallback (small files, or when
      // the streaming path above could not take over — e.g. served via
      // relay, or the drive/entry was momentarily unresolved).
      res.setHeader('Accept-Ranges', 'bytes')

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
      // Return user-friendly error to client
      const userMessage = getUserFriendlyError(err.message)
      res.statusCode = 502
      res.setHeader('Content-Type', 'text/html')
      res.setHeader('Content-Security-Policy', this._contentSecurityPolicy())
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cannot Load Page</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
    }
    .container { text-align: center; max-width: 400px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #ff9500; font-size: 20px; margin-bottom: 12px; }
    p { color: #999; line-height: 1.6; margin-bottom: 24px; }
    .error-code { 
      display: inline-block;
      background: #1a1a1a;
      padding: 8px 16px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🔌</div>
    <h1>Cannot Load Page</h1>
    <p>${userMessage}</p>
    <div class="error-code">${err.code || '502'}</div>
  </div>
</body>
</html>`)
    }
  }

  /**
   * Strict Content-Security-Policy for proxied HTML. The capability token
   * is injected into a page-readable <meta name="pear-api-token">, so we
   * must stop any third-party or inline script from reading it back out to
   * an attacker. Locking script-src/connect-src to the proxy's own loopback
   * origin (no inline, no remote) blocks token exfiltration.
   *
   * connect-src is pinned to the actual proxy port so the injected
   * window.pear.swarm.v1 shim can still reach /api/* on this server.
   */
  _contentSecurityPolicy () {
    const self = `http://127.0.0.1:${this._port}`
    const selfLocalhost = `http://localhost:${this._port}`
    return [
      "default-src 'self'",
      "script-src 'self'",
      `connect-src 'self' ${self} ${selfLocalhost}`,
      "object-src 'none'",
      "base-uri 'self'"
    ].join('; ')
  }

  _serveHtmlWithBridge (res, path, driveKeyHex, content) {
    // KNOWN LIMITATION (browser-layer isolation): every drive/app is served
    // from the same single origin http://127.0.0.1:PORT, so there is NO
    // per-app origin isolation at the browser layer — one app's page can,
    // within CSP limits, reach another app's same-origin resources and
    // shares cookies/storage/token surface. The canonical fix is a per-app
    // origin (a custom scheme handler, or a per-drive-key subdomain so each
    // app gets its own origin). That is deliberately NOT attempted here;
    // the CSP below only narrows what a single shared-origin page may load.
    const html = b4a.toString(content, 'utf-8')
    const prefix = path.startsWith('/app/') ? '/app/' : '/hyper/'
    const baseHref = `http://localhost:${this._port}${prefix}${driveKeyHex}/`
    const apiToken = this.issueApiToken(driveKeyHex)
    const headInjection =
      `<base href="${baseHref}">` +
      `<meta name="pear-api-token" content="${apiToken}">` +
      (this._pearSwarmShim || '')
    const injected = html.includes('<head>')
      ? html.replace('<head>', `<head>${headInjection}`)
      : html.replace(/<html>/i, `<html><head>${headInjection}</head>`)
    res.setHeader('Content-Security-Policy', this._contentSecurityPolicy())
    res.statusCode = 200
    return res.end(b4a.from(injected))
  }

  /**
   * Stream a non-HTML drive file directly to res using
   * drive.createReadStream(path, { start, length }) with streamx
   * backpressure, instead of buffering the whole blob via drive.get().
   *
   * Only takes over for files that actually benefit: a Range (206) request,
   * or a file larger than _streamThreshold. Small, non-ranged files fall
   * through (returns false) to the buffered hybrid-fetch path so they can
   * still be served from relay and populated into the LRU cache.
   *
   * Returns true once it has assumed responsibility for the response
   * (headers sent / stream piping), false to let the caller continue.
   */
  async _maybeStreamFromDrive (req, res, driveKeyHex, filePath, contentType, rangeHeader) {
    const STREAM_THRESHOLD = 5 * 1024 * 1024 // 5MB — matches cache ceiling

    let drive
    try {
      drive = await this._getDrive(driveKeyHex)
    } catch {
      return false
    }
    if (!drive || typeof drive.createReadStream !== 'function') return false

    // Resolve the entry to learn the blob size. No size → can't compute
    // Content-Length / Content-Range, so defer to the buffered path.
    let entry
    try {
      entry = await drive.entry(filePath)
    } catch {
      return false
    }
    const total = entry && entry.value && entry.value.blob
      ? entry.value.blob.byteLength
      : null
    if (total === null) return false

    // Small, non-ranged file → let the cache-friendly buffered path handle it.
    if (!rangeHeader && total <= STREAM_THRESHOLD) return false

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', contentType)
    res.setHeader('X-Cache', 'MISS')
    res.setHeader('X-Source', 'p2p-stream')

    let start = 0
    let end = total - 1
    let statusCode = 200

    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (match) {
        start = match[1] ? parseInt(match[1], 10) : 0
        end = match[2] ? parseInt(match[2], 10) : total - 1
        // Clamp to valid bounds.
        if (Number.isNaN(start) || start < 0) start = 0
        if (Number.isNaN(end) || end > total - 1) end = total - 1
        if (start > end) {
          // Unsatisfiable range.
          res.removeHeader && res.removeHeader('Content-Type')
          res.setHeader('Content-Range', `bytes */${total}`)
          res.statusCode = 416
          res.end()
          return true
        }
        statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
      }
    }

    const length = end - start + 1
    res.setHeader('Content-Length', length)
    res.statusCode = statusCode

    // createReadStream takes { start, length } (passed through to the blob
    // store). HEAD must not carry a body.
    if (req.method === 'HEAD') {
      res.end()
      return true
    }

    const rs = drive.createReadStream(filePath, { start, length })

    // streamx backpressure + error propagation. If the read stream errors
    // (block unavailable, drive closed), destroy res so the socket tears
    // down cleanly; if res errors/closes early, destroy the read stream so
    // we stop pulling blocks. Surface the read error to _onError.
    rs.on('error', (err) => {
      this._onError(driveKeyHex + filePath, 'stream: ' + (err && err.message))
      if (!res.destroyed) res.destroy(err)
    })
    res.on('error', () => {
      if (!rs.destroyed) rs.destroy()
    })
    res.on('close', () => {
      if (!rs.destroyed) rs.destroy()
    })

    rs.pipe(res)
    return true
  }

  /**
   * Hybrid fetch — race relay HTTP (fast) vs P2P Hyperdrive (reliable).
   * Deduplicates concurrent requests for the same file.
   * Returns { content, contentType, source } or null.
   */
  async _hybridFetch (keyHex, filePath) {
    const cacheKey = `${keyHex}:${filePath}`

    // Return existing promise if already fetching
    if (this._inFlight.has(cacheKey)) {
      return this._inFlight.get(cacheKey)
    }

    // Create the fetch promise
    const promise = this._doHybridFetch(keyHex, filePath)
    this._inFlight.set(cacheKey, promise)

    // Clean up when done
    promise.finally(() => {
      this._inFlight.delete(cacheKey)
    })

    return promise
  }

  /**
   * Internal hybrid fetch implementation — race relay HTTP (fast) vs P2P Hyperdrive (reliable).
   * Returns { content, contentType, source } or null.
   */
  async _doHybridFetch (keyHex, filePath) {
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

  _getCacheKey (driveKeyHex, filePath) {
    return `${driveKeyHex}:${filePath}`
  }

  _getFromCache (key) {
    const entry = this._cache.get(key)
    if (!entry) return null

    // Check TTL (5 minutes)
    if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
      this._cache.delete(key)
      this._cacheCurrentSize -= entry.size
      return null
    }

    // Update access order (LRU)
    entry.lastAccess = Date.now()
    this._cacheStats.hits++
    return entry
  }

  _setCache (key, content, contentType) {
    const size = content.length

    // Don't cache files > 5MB
    if (size > 5 * 1024 * 1024) return

    // Evict oldest entries if needed
    while (this._cacheCurrentSize + size > this._cacheMaxSize && this._cache.size > 0) {
      let oldest = null
      let oldestTime = Infinity
      for (const [k, v] of this._cache) {
        if (v.lastAccess < oldestTime) {
          oldestTime = v.lastAccess
          oldest = k
        }
      }
      if (oldest) {
        const entry = this._cache.get(oldest)
        this._cacheCurrentSize -= entry.size
        this._cache.delete(oldest)
      }
    }

    this._cache.set(key, {
      content,
      contentType,
      size,
      timestamp: Date.now(),
      lastAccess: Date.now()
    })
    this._cacheCurrentSize += size
  }

  /**
   * Invalidate cache entries for a specific drive key
   * @param {string} driveKeyHex - The drive key to invalidate
   */
  invalidateCache (driveKeyHex) {
    for (const key of this._cache.keys()) {
      if (key.startsWith(`${driveKeyHex}:`)) {
        const entry = this._cache.get(key)
        this._cacheCurrentSize -= entry.size
        this._cache.delete(key)
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats () {
    return {
      ...this._cacheStats,
      size: this._cacheCurrentSize,
      maxSize: this._cacheMaxSize,
      entries: this._cache.size
    }
  }

  /**
   * Clear the entire cache
   */
  clearCache () {
    this._cache.clear()
    this._cacheCurrentSize = 0
    this._cacheStats.hits = 0
    this._cacheStats.misses = 0
  }

  issueApiToken (driveKeyHex) {
    if (!isValidDriveKey(driveKeyHex)) {
      throw new Error('Invalid drive key format')
    }
    this._cleanupExpiredApiTokens()
    const token = crypto.randomBytes(32).toString('hex')
    this._apiTokens.set(token, { driveKeyHex, origin: null, kind: 'drive', issuedAt: Date.now() })
    return token
  }

  /**
   * Issue a session token scoped to an HTTPS (or http) Origin string.
   *
   * The origin acts as a pseudo-drive-key: we hash it with a v1 domain
   * separator to get a stable 64-hex pseudo-key. That feeds the same
   * identity sub-keypair derivation used for hyper:// drives, so the
   * `pear.login()` ceremony, profile grants, and verify-login pipeline
   * all work uniformly across hyper:// and HTTPS apps.
   *
   * Same origin (same scheme + host + port) → same pseudo-driveKey
   * forever → stable per-user-per-site sub-pubkey.
   * Different origins → different pseudo-driveKeys → different sub-pubkeys.
   *
   * Phase E follow-up — the per-origin token security model. See
   * docs/HOLEPUNCH_ALIGNMENT_PLAN.md and packages/verify-login/README.md.
   */
  issueOriginToken (originString) {
    const origin = normaliseOrigin(originString)
    if (!origin) throw new Error('Invalid origin')

    // Reject literal loopback — those don't need origin scoping; they
    // get the unscoped browser-context flow.
    if (isLoopbackOrigin(origin)) {
      throw new Error('Origin tokens are for non-loopback HTTPS origins only')
    }

    const driveKeyHex = crypto.createHash('sha256')
      .update('pear.origin.v1:').update(origin)
      .digest('hex')

    this._cleanupExpiredApiTokens()
    const token = crypto.randomBytes(32).toString('hex')
    this._apiTokens.set(token, {
      driveKeyHex,
      origin,
      kind: 'origin',
      issuedAt: Date.now(),
    })
    return { token, driveKeyHex, origin }
  }

  /**
   * Validate a token and return the FULL entry (driveKey + origin + kind).
   * Callers (http-bridge) cross-check the request's `Origin` header
   * against `entry.origin` for origin-scoped tokens to prevent token
   * theft / replay across origins.
   */
  validateApiToken (token) {
    if (typeof token !== 'string' || token.length < 32) return null
    this._cleanupExpiredApiTokens()
    const entry = this._apiTokens.get(token)
    if (!entry) return null
    return entry
  }

  _cleanupExpiredApiTokens () {
    const now = Date.now()
    for (const [token, entry] of this._apiTokens) {
      if (now - entry.issuedAt > this._apiTokenTtlMs) {
        this._apiTokens.delete(token)
      }
    }
  }

  async _serveDirectoryListing (res, drive, keyHex, dirPath) {
    const entries = []
    const MAX_ENTRIES = 1000 // Prevent memory exhaustion
    const TIMEOUT_MS = 5000
    const startTime = Date.now()

    // Normalize dirPath for listing (ensure it ends with / for prefix matching)
    const normalizedDirPath = dirPath.endsWith('/') ? dirPath : dirPath + '/'

    try {
      for await (const entry of drive.list(normalizedDirPath)) {
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
    res.setHeader('Content-Security-Policy', this._contentSecurityPolicy())
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

module.exports = { 
  HyperProxy, 
  getUserFriendlyError,
  USER_FRIENDLY_ERRORS 
}
