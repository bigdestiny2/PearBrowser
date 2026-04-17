/**
 * HTTP Bridge — Direct localhost API for WebView apps
 *
 * Provides REST endpoints on the worklet's HTTP server so WebView
 * apps can call P2P APIs directly via fetch() instead of going
 * through the React Native postMessage relay.
 *
 * This eliminates the three-hop latency:
 *   Before: WebView → postMessage → RN → RPC → Worklet
 *   After:  WebView → fetch(localhost:PORT) → Worklet
 *
 * All endpoints are under /api/* on the same port as the hyper proxy.
 */

class HttpBridge {
  constructor (pearBridge, swarm, getDriveFn, opts = {}) {
    this._bridge = pearBridge
    this._swarm = swarm
    this._getDrive = getDriveFn || null // async (keyHex) => Hyperdrive
    this._allowedOrigins = opts.allowedOrigins || ['http://localhost', 'http://127.0.0.1']
    this._validateToken = opts.validateToken || (() => null)
    this._rateLimiter = new Map() // Simple rate limiting per IP
  }

  // Simple rate limit check
  _checkRateLimit (ip) {
    const now = Date.now()
    const windowMs = 60000 // 1 minute
    const maxRequests = 100 // 100 requests per minute

    let entry = this._rateLimiter.get(ip)
    if (!entry || now - entry.resetAt > windowMs) {
      entry = { count: 0, resetAt: now + windowMs }
      this._rateLimiter.set(ip, entry)
    }
    entry.count++
    return entry.count <= maxRequests
  }

  // Validate appId format (alphanumeric, hyphen, underscore only)
  _isValidAppId (appId) {
    return typeof appId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(appId)
  }

  // Get client IP from request
  _getClientIp (req) {
    return req.socket?.remoteAddress || '127.0.0.1'
  }

  _isLoopbackOrigin (origin) {
    if (typeof origin !== 'string') return false
    try {
      const parsed = new URL(origin)
      return parsed.protocol === 'http:' &&
        (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    } catch {
      return false
    }
  }

  _scopeAppId (driveKeyHex, appId) {
    return `${driveKeyHex}:${appId}`
  }

  _requireToken (req, res) {
    const rawToken = req.headers['x-pear-token']
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken
    const driveKeyHex = this._validateToken(token)
    if (!driveKeyHex) {
      this._jsonError(res, 'Unauthorized', 401)
      return null
    }
    return { driveKeyHex, token }
  }

  /**
   * Handle an incoming HTTP request.
   * Returns true if handled, false if not an API route.
   */
  async handle (req, res, url) {
    const path = url.pathname

    if (!path.startsWith('/api/')) return false

    // Rate limiting
    const clientIp = this._getClientIp(req)
    if (!this._checkRateLimit(clientIp)) {
      res.statusCode = 429
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }))
      return true
    }

    // Origin validation
    const origin = req.headers.origin
    if (origin) {
      const isAllowed = this._isLoopbackOrigin(origin) &&
        this._allowedOrigins.some(allowed => origin === allowed || origin.startsWith(allowed + ':'))
      if (!isAllowed) {
        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Invalid origin' }))
        return true
      }
    }

    res.setHeader('Content-Type', 'application/json')

    try {
      // Parse JSON body for POST requests
      let body = null
      if (req.method === 'POST') {
        body = await this._readBody(req)
      }

      // --- Sync API ---

      if (req.method === 'POST' && path === '/api/sync/create') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        if (!this._isValidAppId(body.appId)) {
          return this._jsonError(res, 'Invalid appId format', 400)
        }
        const scopedAppId = this._scopeAppId(auth.driveKeyHex, body.appId)
        const result = await this._bridge.createSyncGroup(scopedAppId)
        return this._json(res, { ...result, appId: body.appId })
      }

      if (req.method === 'POST' && path === '/api/sync/join') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        if (!this._isValidAppId(body.appId)) {
          return this._jsonError(res, 'Invalid appId format', 400)
        }
        // Validate invite key format (64 hex chars)
        if (!body.inviteKey || !/^[0-9a-f]{64}$/i.test(body.inviteKey)) {
          return this._jsonError(res, 'Invalid invite key format', 400)
        }
        const scopedAppId = this._scopeAppId(auth.driveKeyHex, body.appId)
        const result = await this._bridge.joinSyncGroup(scopedAppId, body.inviteKey)
        return this._json(res, { ...result, appId: body.appId })
      }

      if (req.method === 'POST' && path === '/api/sync/append') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        // Validate appId
        if (!this._isValidAppId(body.appId)) {
          return this._jsonError(res, 'Invalid appId format', 400)
        }
        // Limit operation size
        const opSize = JSON.stringify(body.op || body).length
        if (opSize > 100000) { // 100KB max operation
          return this._jsonError(res, 'Operation too large', 413)
        }
        const scopedAppId = this._scopeAppId(auth.driveKeyHex, body.appId)
        const result = await this._bridge.append(scopedAppId, body.op || body)
        return this._json(res, result)
      }

      if (req.method === 'GET' && path === '/api/sync/get') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        const appId = url.searchParams.get('appId')
        const key = url.searchParams.get('key')
        if (!this._isValidAppId(appId)) {
          return this._jsonError(res, 'Invalid appId format', 400)
        }
        // Validate key format
        if (!key || typeof key !== 'string' || key.length > 1024) {
          return this._jsonError(res, 'Invalid key', 400)
        }
        const scopedAppId = this._scopeAppId(auth.driveKeyHex, appId)
        const result = await this._bridge.get(scopedAppId, key)
        return this._json(res, result)
      }

      if (req.method === 'GET' && path === '/api/sync/list') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        const appId = url.searchParams.get('appId')
        const prefix = url.searchParams.get('prefix') || ''
        let limit = parseInt(url.searchParams.get('limit') || '100')
        if (!this._isValidAppId(appId)) {
          return this._jsonError(res, 'Invalid appId format', 400)
        }
        // Enforce max limit
        if (isNaN(limit) || limit < 1) limit = 100
        if (limit > 1000) limit = 1000
        const scopedAppId = this._scopeAppId(auth.driveKeyHex, appId)
        const result = await this._bridge.list(scopedAppId, prefix, { limit })
        return this._json(res, result)
      }

      if (req.method === 'GET' && path === '/api/sync/status') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        const appId = url.searchParams.get('appId')
        if (!this._isValidAppId(appId)) {
          return this._jsonError(res, 'Invalid appId format', 400)
        }
        const scopedAppId = this._scopeAppId(auth.driveKeyHex, appId)
        const result = this._bridge.getSyncStatus(scopedAppId)
        return this._json(res, result ? { ...result, appId } : null)
      }

      // --- Identity ---

      if (req.method === 'GET' && path === '/api/identity') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        const publicKey = this._swarm
          ? this._swarm.keyPair.publicKey.toString('hex')
          : null
        return this._json(res, { publicKey, driveKey: auth.driveKeyHex })
      }

      // --- Drive Operations (Vinjari-inspired) ---

      if (req.method === 'GET' && path === '/api/drive/info') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        const key = url.searchParams.get('key') || auth.driveKeyHex
        if (key !== auth.driveKeyHex) {
          return this._jsonError(res, 'Forbidden for this drive', 403)
        }
        const drive = await this._getDrive(key)
        if (!drive) return this._jsonError(res, 'Drive not found', 404)
        return this._json(res, {
          key,
          version: drive.version,
          writable: drive.writable,
          peers: this._swarm ? this._swarm.connections.size : 0,
          discoveryKey: drive.discoveryKey ? drive.discoveryKey.toString('hex') : null
        })
      }

      if (req.method === 'GET' && path === '/api/drive/readdir') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        const key = url.searchParams.get('key') || auth.driveKeyHex
        const dirPath = url.searchParams.get('path') || '/'
        if (key !== auth.driveKeyHex) {
          return this._jsonError(res, 'Forbidden for this drive', 403)
        }
        if (dirPath.includes('..') || dirPath.includes('\x00')) {
          return this._jsonError(res, 'Invalid path', 400)
        }
        const drive = await this._getDrive(key)
        if (!drive) return this._jsonError(res, 'Drive not found', 404)
        const entries = []
        try {
          for await (const entry of drive.list(dirPath)) {
            entries.push({ key: entry.key, size: entry.value?.blob?.byteLength || 0 })
          }
        } catch {}
        return this._json(res, { key, path: dirPath, entries })
      }

      // --- Status ---

      if (req.method === 'GET' && path === '/api/bridge/status') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        return this._json(res, {
          type: 'http-bridge',
          syncGroups: this._bridge._syncGroups ? this._bridge._syncGroups.size : 0,
          swarmConnected: !!this._swarm,
          peerCount: this._swarm ? this._swarm.connections.size : 0,
          driveKey: auth.driveKeyHex
        })
      }

      // Not found
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Unknown API endpoint: ' + path }))
      return true

    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: err.message }))
      return true
    }
  }

  _json (res, data) {
    res.statusCode = 200
    res.end(JSON.stringify(data))
    return true
  }

  _jsonError (res, message, status = 400) {
    res.statusCode = status
    res.end(JSON.stringify({ error: message }))
    return true
  }

  _readBody (req) {
    return new Promise((resolve, reject) => {
      let data = ''
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 1024 * 1024) { // 1MB max
          req.destroy()
          reject(new Error('Body too large'))
          return
        }
        data += chunk
      })
      req.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {}
          // SECURITY: Prevent prototype pollution
          if (parsed && typeof parsed === 'object') {
            delete parsed.__proto__
            delete parsed.constructor
          }
          resolve(parsed)
        } catch (err) {
          reject(new Error('Invalid JSON: ' + err.message))
        }
      })
      req.on('error', reject)
    })
  }
}

module.exports = { HttpBridge }
