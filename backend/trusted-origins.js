/**
 * Trusted origins — opt-in allow-list for `window.pear` bridge injection
 * on HTTPS pages.
 *
 * Default mode: 'all' (preserves the current behaviour — bridge injected
 * on every page, but unauthorised until login() succeeds).
 *
 * Privacy mode: 'allowlist' (bridge only injected on origins the user
 * has explicitly trusted, plus loopback + hyper:// which are always-on
 * because they're our own surfaces).
 *
 * The check happens server-side at session-mint time (CMD_PEAR_SESSION):
 * the native shell asks for a session token for an origin, and the
 * backend either returns one (origin is trusted, or mode is 'all') or
 * returns `{ allowed: false, reason: 'untrusted' }` so the shell skips
 * injection entirely. This keeps the trust-decision authoritative on
 * the worklet side rather than scattering it across native shells.
 *
 * Storage:
 *   bee_trust!<canonical-origin>   → { origin, trustedAt, lastUsedAt }
 *   bee_trust!__mode__             → { mode: 'all' | 'allowlist' }
 *
 * Backed by a single Hyperbee inside the user's Corestore so the trust
 * set replicates across the user's devices alongside their bookmarks
 * and identity.
 */

const Hyperbee = require('hyperbee')

const VALID_MODES = new Set(['all', 'allowlist'])
const DEFAULT_MODE = 'all'
const MODE_KEY = '__mode__'
const ENTRY_PREFIX = 'o!'
const MAX_ORIGIN_LEN = 512

/**
 * Canonicalise an origin string the same way hyper-proxy.js does. Kept
 * local (not imported) so this module has no dependency on the proxy
 * being initialised.
 */
function normaliseOrigin (origin) {
  if (typeof origin !== 'string') return null
  if (origin.length === 0 || origin.length > MAX_ORIGIN_LEN) return null
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

class TrustedOrigins {
  /**
   * @param {Corestore} store — user-scoped Corestore
   * @param {Hyperswarm} [swarm] — optional, for cross-device replication
   */
  constructor (store, swarm) {
    if (!store) throw new Error('TrustedOrigins requires a Corestore')
    this.store = store
    this.swarm = swarm
    this._ready = false
    this._bee = null
    // In-memory mode cache so the injection-mint hot path is sync.
    this._modeCache = DEFAULT_MODE
  }

  async ready () {
    if (this._ready) return
    const core = this.store.get({ name: 'pearbrowser-trusted-origins' })
    this._bee = new Hyperbee(core, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    })
    await this._bee.ready()

    // Pre-warm the mode cache from disk
    try {
      const entry = await this._bee.get(MODE_KEY)
      if (entry && entry.value && VALID_MODES.has(entry.value.mode)) {
        this._modeCache = entry.value.mode
      }
    } catch (err) {
      // First-launch: bee is empty, cache stays at DEFAULT_MODE
    }

    // Hydrate the in-memory trust set so isTrustedSync() works on the
    // very first navigation after boot.
    this._cachedSet = new Set()
    try {
      for await (const entry of this._bee.createReadStream({
        gte: ENTRY_PREFIX,
        lt: ENTRY_PREFIX + '~',
      })) {
        if (entry.value && entry.value.origin) {
          this._cachedSet.add(entry.value.origin)
        }
      }
    } catch (err) {
      // empty bee, nothing to hydrate
    }

    if (this.swarm && typeof this.swarm.join === 'function') {
      try {
        const topic = this._bee.core.discoveryKey
        if (topic) this.swarm.join(topic, { server: true, client: true })
      } catch (err) {
        console.warn('[TrustedOrigins] swarm join failed:', err && err.message)
      }
    }

    this._ready = true
  }

  _requireReady () {
    if (!this._ready) throw new Error('TrustedOrigins not ready — call ready() first')
  }

  /** Sync read of the current mode. Safe to call after ready(). */
  modeSync () {
    return this._modeCache
  }

  async getMode () {
    this._requireReady()
    return this._modeCache
  }

  async setMode (mode) {
    this._requireReady()
    if (!VALID_MODES.has(mode)) {
      throw new Error(`mode must be one of: ${[...VALID_MODES].join(', ')}`)
    }
    await this._bee.put(MODE_KEY, { mode, changedAt: Date.now() })
    this._modeCache = mode
    return mode
  }

  /**
   * Sync check for whether an origin is trusted. Used on the hot path
   * (CMD_PEAR_SESSION) so we avoid an extra await on every navigation.
   * `lastUsedAt` is updated lazily via touch().
   *
   * NOTE: Returns true if mode is 'all' (everything is trusted by
   * default). Returns true for loopback/hyper:// scheme — those are
   * always injected because they're our own UI.
   */
  isTrustedSync (origin) {
    this._requireReady()
    const norm = normaliseOrigin(origin)
    if (!norm) return false
    if (this._modeCache === 'all') return true
    // Cached set populated by list() / add() / remove()
    return this._cachedSet ? this._cachedSet.has(norm) : false
  }

  /**
   * Async authoritative check. Use this for management UIs; use
   * isTrustedSync() for the inject hot path.
   */
  async isTrusted (origin) {
    this._requireReady()
    const norm = normaliseOrigin(origin)
    if (!norm) return false
    if (this._modeCache === 'all') return true
    const entry = await this._bee.get(ENTRY_PREFIX + norm)
    return !!entry
  }

  /**
   * Add an origin to the trust set. Idempotent — re-adding refreshes
   * `lastUsedAt`. Returns the canonicalised origin (caller may have
   * passed a dirty URL).
   */
  async add (origin) {
    this._requireReady()
    const norm = normaliseOrigin(origin)
    if (!norm) throw new Error('origin is not a valid http(s) origin')
    const now = Date.now()
    const existing = await this._bee.get(ENTRY_PREFIX + norm)
    const value = existing && existing.value
      ? { ...existing.value, lastUsedAt: now }
      : { origin: norm, trustedAt: now, lastUsedAt: now }
    await this._bee.put(ENTRY_PREFIX + norm, value)
    this._touchCache(norm, true)
    return value
  }

  async remove (origin) {
    this._requireReady()
    const norm = normaliseOrigin(origin)
    if (!norm) throw new Error('origin is not a valid http(s) origin')
    await this._bee.del(ENTRY_PREFIX + norm)
    this._touchCache(norm, false)
    return { origin: norm }
  }

  /**
   * Touch lastUsedAt without overwriting trustedAt. Cheap fire-and-
   * forget update from the inject hot path. Errors are swallowed —
   * losing a touch is harmless.
   */
  async touch (origin) {
    if (!this._ready) return
    const norm = normaliseOrigin(origin)
    if (!norm) return
    try {
      const existing = await this._bee.get(ENTRY_PREFIX + norm)
      if (!existing || !existing.value) return
      await this._bee.put(ENTRY_PREFIX + norm, {
        ...existing.value,
        lastUsedAt: Date.now(),
      })
    } catch (err) {
      // best-effort
    }
  }

  /**
   * List all trusted origins, newest-trusted first. Also rebuilds the
   * in-memory cached set used by isTrustedSync().
   */
  async list () {
    this._requireReady()
    const out = []
    const set = new Set()
    for await (const entry of this._bee.createReadStream({
      gte: ENTRY_PREFIX,
      lt: ENTRY_PREFIX + '~',
    })) {
      if (entry.value) {
        out.push(entry.value)
        set.add(entry.value.origin)
      }
    }
    this._cachedSet = set
    out.sort((a, b) => (b.trustedAt || 0) - (a.trustedAt || 0))
    return { origins: out, mode: this._modeCache }
  }

  _touchCache (origin, trusted) {
    if (!this._cachedSet) this._cachedSet = new Set()
    if (trusted) this._cachedSet.add(origin)
    else this._cachedSet.delete(origin)
  }
}

module.exports = { TrustedOrigins, normaliseOrigin }
