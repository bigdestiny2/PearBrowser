/**
 * Relay Client — HTTP fast-path for Hyperdrive content
 *
 * Uses bare-http1 for HTTP requests (fetch() doesn't exist in Bare).
 * Fetches content from HiveRelay gateway endpoints.
 */

const http = require('bare-http1')
const { getUserFriendlyError } = require('./hyper-proxy')

class RelayClient {
  constructor (opts = {}) {
    this.relays = opts.relays || ['http://127.0.0.1:9100']
    this.timeout = opts.timeout || 5000
    this.enabled = opts.enabled !== false // default on; explicit false disables hybrid fetch
    this._stats = { hits: 0, misses: 0, errors: 0 }

    // Circuit breaker state per relay
    this._circuitBreakers = new Map() // relayUrl -> { failures, lastFailure, open }
    this._maxFailures = 3
    this._circuitTimeout = 60000 // 1 minute
  }

  /**
   * Reconfigure the relay list at runtime. Clears circuit-breaker state so
   * a user-provided URL gets a fresh chance.
   */
  setRelays (relays) {
    if (!Array.isArray(relays)) throw new TypeError('relays must be an array')
    const valid = []
    for (const url of relays) {
      if (typeof url !== 'string') continue
      const clean = url.trim()
      if (!clean) continue
      // Accept http(s) only
      if (!/^https?:\/\//i.test(clean)) continue
      valid.push(clean.replace(/\/+$/, ''))
    }
    if (valid.length === 0) {
      console.warn('[RelayClient] setRelays called with no valid urls; keeping current list')
      return false
    }
    this.relays = valid
    this._circuitBreakers.clear()
    console.log(`[RelayClient] relays updated: ${valid.join(', ')}`)
    return true
  }

  /** Toggle the relay on/off. When off, hybrid fetch falls through to P2P. */
  setEnabled (enabled) {
    this.enabled = !!enabled
    console.log(`[RelayClient] enabled=${this.enabled}`)
  }

  /** Current config snapshot for UI display. */
  getConfig () {
    return {
      relays: [...this.relays],
      enabled: this.enabled,
      timeout: this.timeout,
      stats: { ...this._stats },
      circuitBreakers: Array.from(this._circuitBreakers.entries()).map(([url, cb]) => ({
        url,
        failures: cb.failures,
        open: cb.open,
      })),
    }
  }

  /**
   * Check if circuit is closed (ok to use)
   */
  _checkCircuit (relayUrl) {
    const cb = this._circuitBreakers.get(relayUrl)
    if (!cb) return true // Circuit closed (ok)

    if (cb.open) {
      // Check if circuit should close
      if (Date.now() - cb.lastFailure > this._circuitTimeout) {
        cb.open = false
        cb.failures = 0
        return true
      }
      return false // Circuit still open
    }
    return true
  }

  /**
   * Record successful request - reset circuit breaker
   */
  _recordSuccess (relayUrl) {
    this._circuitBreakers.delete(relayUrl)
  }

  /**
   * Record failed request - update circuit breaker
   */
  _recordFailure (relayUrl) {
    let cb = this._circuitBreakers.get(relayUrl)
    if (!cb) {
      cb = { failures: 0, lastFailure: 0, open: false }
      this._circuitBreakers.set(relayUrl, cb)
    }
    cb.failures++
    cb.lastFailure = Date.now()
    if (cb.failures >= this._maxFailures) {
      cb.open = true
      console.warn(`Circuit breaker opened for ${relayUrl}`)
    }
  }

  /**
   * Try to fetch a file from any relay gateway with retry logic
   * Returns { content, contentType, source } or null
   */
  async fetch (keyHex, filePath, retries = 3) {
    // When the user has disabled the relay, skip the fast-path entirely
    // and let hybrid fetch fall through to P2P
    if (!this.enabled) return null

    for (const relayUrl of this.relays) {
      // Skip if circuit is open
      if (!this._checkCircuit(relayUrl)) continue

      let lastError = null

      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const result = await this._httpGet(
            `${relayUrl}/v1/hyper/${keyHex}${filePath}`,
            this.timeout
          )

          if (result.status === 200) {
            this._recordSuccess(relayUrl)
            this._stats.hits++
            return {
              content: result.body,
              contentType: result.contentType,
              source: relayUrl
            }
          }

          // Non-200 is not a retryable error
          break
        } catch (err) {
          lastError = err
          if (attempt < retries - 1) {
            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, attempt) * 1000
            await new Promise(r => setTimeout(r, delay))
          }
        }
      }

      // All retries failed
      this._recordFailure(relayUrl)
    }

    this._stats.misses++
    return null
  }

  /**
   * Health check endpoint that tests all relays
   * Returns array of { url, ok, latency } for each relay
   */
  async checkHealth () {
    const results = []

    for (const relayUrl of this.relays) {
      const start = Date.now()
      try {
        const result = await this._httpGet(`${relayUrl}/health`, 3000)
        const latency = Date.now() - start
        results.push({
          url: relayUrl,
          ok: result.status === 200,
          latency,
          circuitOpen: !this._checkCircuit(relayUrl)
        })
      } catch {
        results.push({
          url: relayUrl,
          ok: false,
          latency: Date.now() - start,
          circuitOpen: !this._checkCircuit(relayUrl)
        })
      }
    }

    return results
  }

  async requestSeed (keyHex) {
    for (const relayUrl of this.relays) {
      // Skip if circuit is open
      if (!this._checkCircuit(relayUrl)) continue

      try {
        const result = await this._httpPost(
          `${relayUrl}/v1/seed`,
          JSON.stringify({ key: keyHex }),
          5000
        )
        if (result.status === 200) {
          this._recordSuccess(relayUrl)
          return { ok: true, relay: relayUrl }
        }
      } catch {
        this._recordFailure(relayUrl)
      }
    }
    return { ok: false }
  }

  /**
   * HTTP GET using bare-http1
   */
  _httpGet (url, timeout) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const timer = setTimeout(() => reject(new Error(getUserFriendlyError('Timeout'))), timeout)

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
      const timer = setTimeout(() => reject(new Error(getUserFriendlyError('Timeout'))), timeout)

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

  /**
   * Get circuit breaker status for debugging
   * Returns object with relayUrl -> { open, failures }
   */
  getCircuitStatus () {
    const status = {}
    for (const [url, cb] of this._circuitBreakers) {
      status[url] = { open: cb.open, failures: cb.failures }
    }
    return status
  }
}

module.exports = { RelayClient }
