/**
 * Relay Client — HTTP fast-path for Hyperdrive content
 *
 * Uses bare-http1 for HTTP requests (fetch() doesn't exist in Bare).
 * Fetches content from HiveRelay gateway endpoints.
 */

const http = require('bare-http1')

class RelayClient {
  constructor (opts = {}) {
    this.relays = opts.relays || ['http://127.0.0.1:9100']
    this.timeout = opts.timeout || 5000
    this._stats = { hits: 0, misses: 0, errors: 0 }
  }

  /**
   * Try to fetch a file from any relay gateway
   * Returns { content, contentType, source } or null
   */
  async fetch (keyHex, filePath) {
    for (const relayUrl of this.relays) {
      try {
        const result = await this._httpGet(
          `${relayUrl}/v1/hyper/${keyHex}${filePath}`,
          this.timeout
        )

        if (result.status === 200) {
          this._stats.hits++
          return {
            content: result.body,
            contentType: result.contentType,
            source: relayUrl
          }
        }

        this._stats.misses++
      } catch {
        this._stats.errors++
      }
    }

    return null
  }

  async checkHealth () {
    for (const relayUrl of this.relays) {
      try {
        const result = await this._httpGet(`${relayUrl}/health`, 3000)
        if (result.status === 200) return { ok: true, relay: relayUrl }
      } catch {}
    }
    return { ok: false }
  }

  async requestSeed (keyHex) {
    for (const relayUrl of this.relays) {
      try {
        const result = await this._httpPost(
          `${relayUrl}/v1/seed`,
          JSON.stringify({ key: keyHex }),
          5000
        )
        if (result.status === 200) return { ok: true, relay: relayUrl }
      } catch {}
    }
    return { ok: false }
  }

  /**
   * HTTP GET using bare-http1
   */
  _httpGet (url, timeout) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const timer = setTimeout(() => reject(new Error('Timeout')), timeout)

      const req = http.get({
        hostname: parsed.hostname,
        port: parseInt(parsed.port) || 80,
        path: parsed.pathname + parsed.search
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            status: res.statusCode,
            contentType: res.headers['content-type'] || 'application/octet-stream',
            body: Buffer.concat(chunks)
          })
        })
        res.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })

      req.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  /**
   * HTTP POST using bare-http1
   */
  _httpPost (url, body, timeout) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const timer = setTimeout(() => reject(new Error('Timeout')), timeout)

      const req = http.request({
        method: 'POST',
        hostname: parsed.hostname,
        port: parseInt(parsed.port) || 80,
        path: parsed.pathname,
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks)
          })
        })
      })

      req.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })

      req.write(body)
      req.end()
    })
  }

  addRelay (url) {
    if (!this.relays.includes(url)) this.relays.push(url)
  }

  getStats () {
    return { ...this._stats, relays: this.relays.length }
  }
}

module.exports = { RelayClient }
