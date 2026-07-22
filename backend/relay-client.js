/**
 * Relay Client — HTTP fast-path for Hyperdrive content
 *
 * Uses bare-http1/bare-https for HTTP requests (fetch() doesn't exist in Bare).
 * Fetches content from HiveRelay gateway endpoints.
 */

const http = require('bare-http1')
const https = require('bare-https')
const b4a = require('b4a')
const { getUserFriendlyError } = require('./hyper-proxy')

const DEFAULT_RELAYS = ['http://127.0.0.1:9100']

// Bare exposes env via Bare.env; fall back to process.env when running under Node.
const ENV = (typeof Bare !== 'undefined' && Bare.env) ||
  (typeof process !== 'undefined' && process.env) || {}

function relayDefaultPort (parsed) {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported relay URL protocol: ${parsed.protocol}`)
  }
  return parsed.protocol === 'https:' ? 443 : 80
}

function relayTransportForUrl (parsed) {
  if (parsed.protocol === 'http:') return http
  if (parsed.protocol === 'https:') return https
  throw new Error(`unsupported relay URL protocol: ${parsed.protocol}`)
}

function relayRequestOptions (parsed, headers) {
  const opts = {
    hostname: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : relayDefaultPort(parsed),
    path: parsed.pathname + parsed.search
  }
  if (headers) opts.headers = headers
  return opts
}

function normalizeRelayUrl (url) {
  if (typeof url !== 'string') return null
  const clean = url.trim()
  if (!clean) return null

  let parsed
  try {
    parsed = new URL(clean)
    relayDefaultPort(parsed)
  } catch {
    return null
  }

  if (!parsed.hostname) return null
  if (parsed.username || parsed.password) return null
  if (parsed.search || parsed.hash) return null

  return clean.replace(/\/+$/, '')
}

function normalizeRelayList (relays) {
  const valid = []
  for (const url of relays) {
    const clean = normalizeRelayUrl(url)
    if (clean && !valid.includes(clean)) valid.push(clean)
  }
  return valid
}

function closeRelayRequest (req) {
  if (!req) return
  if (typeof req.destroy === 'function') req.destroy()
  else if (typeof req.abort === 'function') req.abort()
}

function hasHeader (headers, name) {
  const wanted = name.toLowerCase()
  return Object.keys(headers).some(header => header.toLowerCase() === wanted)
}

class RelayClient {
  constructor (opts = {}) {
    this.relays = Array.isArray(opts.relays) ? normalizeRelayList(opts.relays) : [...DEFAULT_RELAYS]
    this.timeout = opts.timeout || 5000
    this.enabled = opts.enabled !== false // default on; explicit false disables hybrid fetch
    // Optional API key for relays that require auth on the /seed endpoint.
    // Config wins; otherwise fall back to env (HIVE_RELAY_API_KEY).
    this.apiKey = opts.apiKey || ENV.HIVE_RELAY_API_KEY || null
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
    const valid = normalizeRelayList(relays)
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

  /**
   * Ask a relay to seed (pin/replicate) the given app key.
   *
   * Live relay path is `/seed` (the `/v1/seed` variant 404s). Body is
   * `{ appKey }`. If an API key is configured it is sent as a bearer token
   * plus `x-api-key` so the relay can pick whichever it expects.
   *
   * Returns { ok: true, relay } on success, or { ok: false, error, status,
   * relay } describing the last failure — non-2xx responses are surfaced as a
   * clear error rather than silently swallowed.
   */
  async requestSeed (keyHex) {
    if (!keyHex || typeof keyHex !== 'string') {
      return { ok: false, error: 'requestSeed requires a hex app key' }
    }

    const headers = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
      headers['x-api-key'] = this.apiKey
    }

    const body = JSON.stringify({ appKey: keyHex })
    let lastError = 'no relays available'
    let lastStatus = 0
    let lastRelay = null

    for (const relayUrl of this.relays) {
      // Skip if circuit is open
      if (!this._checkCircuit(relayUrl)) {
        lastError = 'circuit open'
        lastRelay = relayUrl
        continue
      }

      lastRelay = relayUrl
      try {
        const result = await this._httpPost(`${relayUrl}/seed`, body, 5000, headers)

        if (result.status >= 200 && result.status < 300) {
          this._recordSuccess(relayUrl)
          return { ok: true, relay: relayUrl }
        }

        // Non-2xx: surface a clear error instead of failing silently.
        this._recordFailure(relayUrl)
        lastStatus = result.status
        const detail = result.body && result.body.length
          ? b4a.toString(result.body, 'utf8').slice(0, 200)
          : ''
        lastError = `relay returned HTTP ${result.status}${detail ? `: ${detail}` : ''}`
      } catch (err) {
        this._recordFailure(relayUrl)
        lastError = err && err.message ? err.message : String(err)
      }
    }

    return { ok: false, error: lastError, status: lastStatus, relay: lastRelay }
  }

  /**
   * HTTP GET using bare-http1/bare-https.
   */
  _httpGet (url, timeout) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const transport = relayTransportForUrl(parsed)
      let settled = false
      let req = null

      const fail = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      }

      const done = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }

      const timer = setTimeout(() => {
        closeRelayRequest(req)
        fail(new Error(getUserFriendlyError('Timeout')))
      }, timeout)

      try {
        req = transport.get(relayRequestOptions(parsed), (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            done({
              status: res.statusCode,
              contentType: (res.headers && res.headers['content-type']) || 'application/octet-stream',
              body: b4a.concat(chunks)
            })
          })
          res.on('error', fail)
        })
        req.on('error', fail)
      } catch (err) {
        fail(err)
      }
    })
  }

  /**
   * HTTP POST using bare-http1/bare-https.
   */
  _httpPost (url, body, timeout, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const transport = relayTransportForUrl(parsed)
      const requestHeaders = { 'Content-Type': 'application/json', ...headers }
      if (!hasHeader(requestHeaders, 'content-length')) {
        requestHeaders['Content-Length'] = String(b4a.byteLength(body))
      }
      let settled = false
      let req = null

      const fail = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      }

      const done = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }

      const timer = setTimeout(() => {
        closeRelayRequest(req)
        fail(new Error(getUserFriendlyError('Timeout')))
      }, timeout)

      try {
        req = transport.request({
          method: 'POST',
          ...relayRequestOptions(parsed, requestHeaders)
        }, (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            done({
              status: res.statusCode,
              body: b4a.concat(chunks)
            })
          })
          res.on('error', fail)
        })
        req.on('error', fail)
        req.write(body)
        req.end()
      } catch (err) {
        fail(err)
      }
    })
  }

  addRelay (url) {
    const clean = normalizeRelayUrl(url)
    if (!clean) return false
    if (!this.relays.includes(clean)) this.relays.push(clean)
    return true
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

module.exports = { RelayClient, relayRequestOptions }
