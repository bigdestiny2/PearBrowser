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
  constructor (pearBridge, swarm) {
    this._bridge = pearBridge
    this._swarm = swarm
  }

  /**
   * Handle an incoming HTTP request.
   * Returns true if handled, false if not an API route.
   */
  async handle (req, res, url) {
    const path = url.pathname

    if (!path.startsWith('/api/')) return false

    res.setHeader('Content-Type', 'application/json')

    try {
      // Parse JSON body for POST requests
      let body = null
      if (req.method === 'POST') {
        body = await this._readBody(req)
      }

      // --- Sync API ---

      if (req.method === 'POST' && path === '/api/sync/create') {
        const result = await this._bridge.createSyncGroup(body.appId)
        return this._json(res, result)
      }

      if (req.method === 'POST' && path === '/api/sync/join') {
        const result = await this._bridge.joinSyncGroup(body.appId, body.inviteKey)
        return this._json(res, result)
      }

      if (req.method === 'POST' && path === '/api/sync/append') {
        const result = await this._bridge.append(body.appId, body.op || body)
        return this._json(res, result)
      }

      if (req.method === 'GET' && path === '/api/sync/get') {
        const appId = url.searchParams.get('appId')
        const key = url.searchParams.get('key')
        const result = await this._bridge.get(appId, key)
        return this._json(res, result)
      }

      if (req.method === 'GET' && path === '/api/sync/list') {
        const appId = url.searchParams.get('appId')
        const prefix = url.searchParams.get('prefix') || ''
        const limit = parseInt(url.searchParams.get('limit') || '100')
        const result = await this._bridge.list(appId, prefix, { limit })
        return this._json(res, result)
      }

      if (req.method === 'GET' && path === '/api/sync/status') {
        const appId = url.searchParams.get('appId')
        const result = this._bridge.getSyncStatus(appId)
        return this._json(res, result)
      }

      // --- Identity ---

      if (req.method === 'GET' && path === '/api/identity') {
        const publicKey = this._swarm
          ? this._swarm.keyPair.publicKey.toString('hex')
          : null
        return this._json(res, { publicKey })
      }

      // --- Status ---

      if (req.method === 'GET' && path === '/api/bridge/status') {
        return this._json(res, {
          type: 'http-bridge',
          syncGroups: this._bridge._syncGroups ? this._bridge._syncGroups.size : 0,
          swarmConnected: !!this._swarm,
          peerCount: this._swarm ? this._swarm.connections.size : 0
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
          resolve(data ? JSON.parse(data) : {})
        } catch {
          reject(new Error('Invalid JSON'))
        }
      })
      req.on('error', reject)
    })
  }
}

module.exports = { HttpBridge }
