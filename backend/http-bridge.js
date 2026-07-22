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

const crypto = require('bare-crypto')

class HttpBridge {
  constructor (pearBridge, swarm, getDriveFn, opts = {}) {
    this._bridge = pearBridge
    this._swarm = swarm
    this._getDrive = getDriveFn || null // async (keyHex) => Hyperdrive
    this._allowedOrigins = opts.allowedOrigins || ['http://localhost', 'http://127.0.0.1']
    this._validateToken = opts.validateToken || (() => null)
    this._identity = opts.identity || null
    this._profile = opts.profile || null
    this._contacts = opts.contacts || null
    this._requestLogin = opts.requestLogin || null // async (args) => attestation
    this._swarmBridge = opts.swarmBridge || null
    this._rateLimiter = new Map() // Simple rate limiting per IP
    this._sseTickets = new Map()
    this._sseTicketTtlMs = opts.sseTicketTtlMs || 30000
    this._maxSseTickets = opts.maxSseTickets || 4096
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

  _isCanonicalHttpOrigin (origin) {
    if (typeof origin !== 'string') return false
    try {
      const parsed = new URL(origin)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
      if (!parsed.hostname) return false
      return origin === parsed.origin
    } catch {
      return false
    }
  }

  _scopeAppId (driveKeyHex, appId) {
    const digest = crypto.createHash('sha256')
      .update(`${driveKeyHex}:${appId}`)
      .digest('hex')
    return `app_${digest.slice(0, 32)}`
  }

  _requireOriginMatch (entry, req, res) {
    if (entry.kind === 'origin' && entry.origin) {
      const reqOrigin = req.headers.origin
      // WKWebView always supplies Origin on cross-origin localhost
      // fetches. Same-origin same-scheme fetches MAY omit it (a regular
      // <https> page fetching localhost is by definition cross-origin
      // so Origin will be set).
      if (typeof reqOrigin !== 'string' || reqOrigin !== entry.origin) {
        this._jsonError(res,
          `Origin mismatch — token issued for ${entry.origin}, request from ${reqOrigin || '(none)'}`,
          403)
        return false
      }
    }
    return true
  }

  allowsSseTicketCors (req, urlObj) {
    if (!urlObj || urlObj.pathname !== '/api/swarm/events') return false
    const origin = req && req.headers ? req.headers.origin : null
    if (typeof origin !== 'string') return false

    const channelId = urlObj.searchParams.get('channelId')
    const ticket = urlObj.searchParams.get('ticket')
    if (!channelId || !ticket) return false

    this._pruneSseTickets()
    const entry = this._sseTickets.get(ticket)
    if (!entry) return false
    if (entry.channelId !== channelId) return false

    // Only origin-scoped tickets can authorize non-loopback CORS reflection.
    // Drive-scoped tickets are for loopback pages, where CORS is already same
    // origin and a leaked ticket must not open reads to arbitrary HTTPS pages.
    return entry.kind === 'origin' && entry.origin === origin
  }

  _requireToken (req, res) {
    const rawToken = req.headers['x-pear-token']
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken
    const entry = this._validateToken(token)
    if (!entry) {
      this._jsonError(res, 'Unauthorized', 401)
      return null
    }
    // Backward compat: validateToken used to return just the driveKeyHex
    // string. Newer hyper-proxy returns the full entry. Support both.
    if (typeof entry === 'string') {
      return { driveKeyHex: entry, token, origin: null, kind: 'drive' }
    }

    // For origin-scoped tokens (HTTPS apps that called pear.session()),
    // require the request's Origin header to match the token's recorded
    // origin. This prevents a malicious page from stealing another site's
    // token and replaying it under its own origin.
    if (!this._requireOriginMatch(entry, req, res)) return null
    return { driveKeyHex: entry.driveKeyHex, token, origin: entry.origin, kind: entry.kind }
  }

  _pruneSseTickets (now = Date.now()) {
    for (const [ticket, entry] of this._sseTickets) {
      if (entry.expiresAt <= now) this._sseTickets.delete(ticket)
    }
    while (this._sseTickets.size > this._maxSseTickets) {
      const oldest = this._sseTickets.keys().next().value
      if (!oldest) break
      this._sseTickets.delete(oldest)
    }
  }

  _mintSseTicket (auth, channelId) {
    const now = Date.now()
    this._pruneSseTickets(now)
    let ticket
    do {
      ticket = crypto.randomBytes(32).toString('hex')
    } while (this._sseTickets.has(ticket))
    const expiresAt = now + this._sseTicketTtlMs
    this._sseTickets.set(ticket, {
      driveKeyHex: auth.driveKeyHex,
      origin: auth.origin,
      kind: auth.kind,
      channelId,
      expiresAt
    })
    return { ticket, expiresInMs: this._sseTicketTtlMs }
  }

  _consumeSseTicket (req, res, urlObj, channelId) {
    const ticket = urlObj.searchParams.get('ticket')
    if (!ticket) {
      this._jsonError(res, 'SSE ticket required', 401)
      return null
    }
    const entry = this._sseTickets.get(ticket)
    if (!entry) {
      this._jsonError(res, 'Invalid SSE ticket', 401)
      return null
    }
    this._sseTickets.delete(ticket)
    if (entry.expiresAt <= Date.now()) {
      this._jsonError(res, 'Expired SSE ticket', 401)
      return null
    }
    if (entry.channelId !== channelId) {
      this._jsonError(res, 'SSE ticket channel mismatch', 403)
      return null
    }
    if (!this._requireOriginMatch(entry, req, res)) return null
    return {
      driveKeyHex: entry.driveKeyHex,
      token: ticket,
      origin: entry.origin,
      kind: entry.kind
    }
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
      const isAllowed = (
        this._isLoopbackOrigin(origin) &&
        this._allowedOrigins.some(allowed => origin === allowed || origin.startsWith(allowed + ':'))
      ) || this._isCanonicalHttpOrigin(origin)
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

      // Phase 4 addition — range queries with explicit bounds + reverse
      if (req.method === 'GET' && path === '/api/sync/range') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        const appId = url.searchParams.get('appId')
        if (!this._isValidAppId(appId)) {
          return this._jsonError(res, 'Invalid appId format', 400)
        }
        const opts = {
          gte: url.searchParams.get('gte') || undefined,
          gt: url.searchParams.get('gt') || undefined,
          lte: url.searchParams.get('lte') || undefined,
          lt: url.searchParams.get('lt') || undefined,
          reverse: url.searchParams.get('reverse') === '1' || url.searchParams.get('reverse') === 'true',
          limit: parseInt(url.searchParams.get('limit') || '100') || 100
        }
        const scopedAppId = this._scopeAppId(auth.driveKeyHex, appId)
        const result = await this._bridge.range(scopedAppId, opts)
        return this._json(res, result)
      }

      // Phase 4 addition — count under a prefix (for UI counters)
      if (req.method === 'GET' && path === '/api/sync/count') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        const appId = url.searchParams.get('appId')
        const prefix = url.searchParams.get('prefix') || ''
        if (!this._isValidAppId(appId)) {
          return this._jsonError(res, 'Invalid appId format', 400)
        }
        const scopedAppId = this._scopeAppId(auth.driveKeyHex, appId)
        const count = await this._bridge.count(scopedAppId, prefix)
        return this._json(res, { count })
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
        // PHASE A: return the per-app sub-key (stable per user+app), NOT
        // the raw swarm or root keypair. Two different apps see two
        // different pubkeys for the same user — privacy by default.
        let appPubkey = null
        if (this._identity) {
          try { appPubkey = this._identity.getAppKeypair(auth.driveKeyHex).publicKey.toString('hex') } catch { /* demo mode */ }
        }
        return this._json(res, {
          publicKey: appPubkey, // per-app sub-key
          driveKey: auth.driveKeyHex,
          algorithm: 'ed25519'
        })
      }

      // Sign a payload with the per-app sub-key (ed25519). Safe to expose —
      // the root keypair stays sealed inside the worklet.
      if (req.method === 'POST' && path === '/api/identity/sign') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        if (!this._identity) return this._jsonError(res, 'identity not available', 503)
        let body
        try { body = await this._readBody(req) } catch (err) {
          return this._jsonError(res, 'Invalid JSON body', 400)
        }
        if (!body || typeof body.payload !== 'string') {
          return this._jsonError(res, '`payload` (string) required', 400)
        }
        try {
          const result = this._identity.signForApp(
            auth.driveKeyHex,
            body.payload,
            body.namespace || ''
          )
          return this._json(res, result)
        } catch (err) {
          return this._jsonError(res, err.message || 'sign failed', 500)
        }
      }

      // --- Login ceremony (Identity Plan Phase C) ---
      //
      // POST /api/login      { scopes, appName, reason } → attestation
      // GET  /api/login/status                           → current grant
      // POST /api/login/logout                           → revoke grant for this app

      if (req.method === 'POST' && path === '/api/login') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        if (!this._requestLogin) return this._jsonError(res, 'login not available', 503)
        const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : []
        const appName = typeof body.appName === 'string' ? body.appName.slice(0, 128) : null
        const reason = typeof body.reason === 'string' ? body.reason.slice(0, 512) : null
        try {
          const attestation = await this._requestLogin({
            driveKeyHex: auth.driveKeyHex, scopes, appName, reason
          })
          // Attach the visible profile fields the app is allowed to see.
          let profileFields = null
          if (this._profile) {
            try { profileFields = await this._profile.getVisibleProfile(auth.driveKeyHex) } catch {}
          }
          return this._json(res, { ...attestation, profile: profileFields })
        } catch (err) {
          return this._jsonError(res, err.message || 'Login failed', 403)
        }
      }

      if (req.method === 'GET' && path === '/api/login/status') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        if (!this._profile || !this._identity) {
          return this._json(res, { loggedIn: false })
        }
        const grant = await this._profile.getGrant(auth.driveKeyHex)
        if (!grant) return this._json(res, { loggedIn: false })
        let appPubkey = null
        try { appPubkey = this._identity.getAppKeypair(auth.driveKeyHex).publicKey.toString('hex') } catch {}
        let profileFields = null
        try { profileFields = await this._profile.getVisibleProfile(auth.driveKeyHex) } catch {}
        return this._json(res, {
          loggedIn: true,
          appPubkey,
          scopes: grant.scopes,
          expiresAt: grant.expiresAt,
          profile: profileFields
        })
      }

      if (req.method === 'POST' && path === '/api/login/logout') {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        if (this._profile) {
          try { await this._profile.revokeGrant(auth.driveKeyHex) } catch {}
        }
        return this._json(res, { ok: true })
      }

      // --- Contacts (Identity Plan Phase D) ---
      //
      // All endpoints require a valid token AND an active grant with
      // the `contacts:read` scope.

      if (path.startsWith('/api/contacts')) {
        const auth = this._requireToken(req, res)
        if (!auth) return true
        if (!this._contacts) return this._jsonError(res, 'Contacts not available', 503)

        // Gate on grant+scope
        const grant = this._profile ? await this._profile.getGrant(auth.driveKeyHex) : null
        if (!grant || !grant.scopes.includes('contacts:read')) {
          return this._jsonError(res, 'contacts:read scope required — call pear.login first', 403)
        }

        if (req.method === 'GET' && path === '/api/contacts/list') {
          const limit = parseInt(url.searchParams.get('limit') || '1000')
          return this._json(res, await this._contacts.list({ limit }))
        }
        if (req.method === 'GET' && path === '/api/contacts/lookup') {
          const pk = url.searchParams.get('pubkey')
          if (!pk) return this._jsonError(res, 'pubkey required', 400)
          return this._json(res, await this._contacts.lookup(pk))
        }
        return this._jsonError(res, 'Not found', 404)
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

      // --- swarm.v1 (direct Hyperswarm access for pages) ---

      if (path.startsWith('/api/swarm/')) {
        if (!this._swarmBridge) {
          return this._jsonError(res, 'swarm bridge not available', 503)
        }

        if (req.method === 'GET' && path === '/api/swarm/events') {
          const channelId = url.searchParams.get('channelId')
          if (!channelId) return this._jsonError(res, 'channelId required', 400)
          const auth = this._consumeSseTicket(req, res, url, channelId)
          if (!auth) return true
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache, no-transform')
          res.setHeader('Connection', 'keep-alive')
          res.setHeader('X-Accel-Buffering', 'no')
          res.write(': pear.swarm.v1 stream\n\n')

          const closeHandlers = []
          let ended = false

          // --- Backpressure-aware SSE writer ---
          //
          // res.write() returns false when the kernel/page socket buffer is
          // full. A slow page that drains the EventSource slowly would
          // otherwise let the worklet's outbound socket buffer balloon
          // without bound, since peer data keeps arriving. We honor drain:
          // once res.write() returns false we stop forwarding and buffer
          // into a *bounded* in-flight queue, flushing it on 'drain'. If the
          // page falls so far behind that the queue overflows, we drop the
          // stream (close the connection) rather than grow unbounded — the
          // page gets a fresh channelId on reconnect.
          //
          // NOTE: full backpressure would also pause the peer hyperswarm
          // conn while drained and resume it on 'drain'. The peer conns are
          // owned by SwarmBridge's channel, not reachable from here, so that
          // half lives in swarm-bridge.js (see crossFileNeeds). This handler
          // does the localhost-side half: a slow page can no longer balloon
          // the worklet socket buffer.
          const MAX_QUEUED = 1024 // events buffered while the page is drained
          const queue = []
          let draining = false
          let drainBound = false

          const flushQueue = () => {
            draining = false
            while (queue.length > 0) {
              if (ended || res.writableEnded || res.destroyed) {
                queue.length = 0
                return
              }
              const frame = queue.shift()
              let ok
              try {
                ok = res.write(frame)
              } catch {
                queue.length = 0
                return
              }
              if (ok === false) {
                // Still backed up — wait for the next drain.
                draining = true
                bindDrain()
                return
              }
            }
          }

          const bindDrain = () => {
            if (drainBound) return
            drainBound = true
            res.once('drain', () => {
              drainBound = false
              flushQueue()
            })
          }

          const stream = {
            send (eventObj) {
              if (ended || res.writableEnded || res.destroyed) return
              let frame
              try {
                frame = 'data: ' + JSON.stringify(eventObj) + '\n\n'
              } catch {
                return // non-serializable event — drop it, never throw to the peer path
              }
              // Already buffering — append (bounded) and let drain flush.
              if (draining) {
                if (queue.length >= MAX_QUEUED) {
                  // Page is hopelessly behind: drop the stream instead of
                  // unbounded growth. onClose tears the channel down.
                  try { res.destroy() } catch {}
                  return
                }
                queue.push(frame)
                bindDrain()
                return
              }
              let ok
              try {
                ok = res.write(frame)
              } catch {
                return
              }
              if (ok === false) {
                // Socket buffer full — stop forwarding until 'drain'.
                draining = true
                bindDrain()
              }
            },
            close () {
              if (ended) return
              ended = true
              queue.length = 0
              try { res.end() } catch {}
            },
            onClose (fn) {
              closeHandlers.push(fn)
            }
          }
          const cleanup = () => {
            ended = true
            queue.length = 0
            closeHandlers.forEach((fn) => { try { fn() } catch {} })
          }
          req.on('close', cleanup)
          req.on('error', cleanup)
          res.on('close', cleanup)
          res.on('error', cleanup)

          this._swarmBridge.attachStream(channelId, stream)
          return true
        }

        const auth = this._requireToken(req, res)
        if (!auth) return true

        if (req.method === 'POST' && path === '/api/swarm/ticket') {
          const channelId = body?.channelId
          if (typeof channelId !== 'string' || channelId.length === 0) {
            return this._jsonError(res, 'channelId required', 400)
          }
          if (channelId.length > 256) {
            return this._jsonError(res, 'channelId too long', 400)
          }
          return this._json(res, this._mintSseTicket(auth, channelId))
        }

        if (req.method === 'POST' && path === '/api/swarm/join') {
          try {
            const result = await this._swarmBridge.join({
              driveKeyHex: auth.driveKeyHex,
              appName: body?.appName || null,
              reason: body?.reason || null,
              topicHex: body?.topicHex || null,
              subtopic: body?.subtopic === undefined ? null : body.subtopic,
              protocol: body?.protocol || 'pear.swarm.v1',
              version: body?.version || 1,
              server: !!body?.server,
              client: body?.client !== false
            })
            return this._json(res, result)
          } catch (err) {
            return this._jsonError(res, err.message, 400)
          }
        }

        if (req.method === 'POST' && path === '/api/swarm/send') {
          try {
            this._swarmBridge.send(body?.channelId, body?.peerId, body?.data)
            return this._json(res, { ok: true })
          } catch (err) {
            return this._jsonError(res, err.message, 400)
          }
        }

        if (req.method === 'POST' && path === '/api/swarm/leave') {
          try {
            await this._swarmBridge.leave(body?.channelId)
            return this._json(res, { ok: true })
          } catch (err) {
            return this._jsonError(res, err.message, 400)
          }
        }

        return this._jsonError(res, 'Unknown swarm endpoint', 404)
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
            const protoKey = '__proto__'
            delete parsed[protoKey]
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
