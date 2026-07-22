'use strict'

/**
 * Shield list sync — P2P filter-list distribution (Phase 2 gate of
 * docs/BROWSER_PARITY_PLAN.md in the desktop repo).
 *
 * Ported verbatim from pearbrowser-desktop backend/shield-list-sync.cjs —
 * transport, hashing, and persistence are injected, so the module runs
 * identically under Bare (bare-crypto, hyper-proxy hybrid fetch, user-data
 * settings) and under node:test fakes.
 *
 * A filter list is published as an ordinary Hyperdrive (see
 * filter-lists/README.md):
 *
 *   /filters.txt      the rules (Content Shield syntax subset)
 *   /manifest.json    optional: { name, version, filters, sha256 }
 *
 * The browser subscribes by drive key. Rule text is registered on the
 * shield under the namespaced list `drive:<key>` — which the shield
 * already persists through exportListState() — so a synced list keeps
 * working fully offline after first sync. This module owns only the
 * subscription metadata (version/hash bookkeeping) and the hot-swap.
 */

const DRIVE_LIST_PREFIX = 'drive:'
const MAX_LIST_BYTES = 2 * 1024 * 1024 // a converted EasyList fits well within this
const MAX_MANIFEST_BYTES = 64 * 1024

class ShieldListSyncError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'ShieldListSyncError'
    this.code = code
  }
}

class ShieldListSync {
  /**
   * @param {object} opts
   * @param {object} opts.shield — ContentShield (addList/removeList)
   * @param {function} opts.fetchDriveFile — async (driveKeyHex, path) => { content: Buffer } | null
   * @param {function} [opts.refreshDrive] — async (driveKeyHex) => advance cached drive state
   * @param {function} [opts.sha256Hex] — (bufferOrString) => hex string; required to verify checksums
   * @param {function} [opts.persistMeta] — async (metaByKey) => void
   * @param {function} [opts.now] — clock injection for tests
   */
  constructor (opts = {}) {
    if (!opts.shield || typeof opts.shield.addList !== 'function') {
      throw new TypeError('ShieldListSync requires a ContentShield')
    }
    if (typeof opts.fetchDriveFile !== 'function') {
      throw new TypeError('ShieldListSync requires a fetchDriveFile transport')
    }
    this._shield = opts.shield
    this._fetch = opts.fetchDriveFile
    this._refreshDrive = typeof opts.refreshDrive === 'function' ? opts.refreshDrive : async () => {}
    this._sha256Hex = typeof opts.sha256Hex === 'function' ? opts.sha256Hex : null
    this._persistMeta = typeof opts.persistMeta === 'function' ? opts.persistMeta : async () => {}
    this._now = typeof opts.now === 'function' ? opts.now : Date.now
    this._meta = new Map() // driveKeyHex -> { name, version, sha256, updatedAt, rules }
    this._timer = null
  }

  /** Rehydrate subscription metadata from durable settings (offline boot). */
  restore (metaByKey) {
    if (!metaByKey || typeof metaByKey !== 'object') return 0
    let restored = 0
    for (const [key, meta] of Object.entries(metaByKey)) {
      const driveKey = normalizeDriveKey(key)
      if (!driveKey || !meta || typeof meta !== 'object') continue
      this._meta.set(driveKey, {
        name: cleanString(meta.name) || shortListName(driveKey),
        version: cleanString(meta.version),
        sha256: cleanString(meta.sha256),
        updatedAt: Number.isFinite(meta.updatedAt) ? meta.updatedAt : 0,
        rules: Number.isFinite(meta.rules) ? meta.rules : 0
      })
      restored++
    }
    return restored
  }

  subscriptions () {
    return [...this._meta.entries()].map(([driveKey, meta]) => ({
      driveKey,
      listName: DRIVE_LIST_PREFIX + driveKey,
      ...meta
    }))
  }

  isSubscribed (driveKey) {
    const key = normalizeDriveKey(driveKey)
    return !!key && this._meta.has(key)
  }

  /**
   * Subscribe to a filter-list drive: first fetch, verify, register, persist.
   * Throws ShieldListSyncError on transport/validation failure (fail-closed:
   * nothing is registered on error).
   */
  async subscribe (driveKey) {
    const key = normalizeDriveKey(driveKey)
    if (!key) throw new ShieldListSyncError('invalid-drive-key', 'A 64-hex filter-list drive key is required')
    const result = await this._pull(key, { force: true })
    return { driveKey: key, ...this._meta.get(key), ...result }
  }

  async unsubscribe (driveKey) {
    const key = normalizeDriveKey(driveKey)
    if (!key || !this._meta.has(key)) return { removed: false }
    this._meta.delete(key)
    this._shield.removeList(DRIVE_LIST_PREFIX + key)
    await this._persist()
    return { removed: true, driveKey: key }
  }

  /**
   * Re-fetch one subscription. Skips the rules download when the published
   * manifest version and checksum match what is already applied (hot-swap
   * only on change). `force` re-applies regardless.
   */
  async refresh (driveKey, opts = {}) {
    const key = normalizeDriveKey(driveKey)
    if (!key || !this._meta.has(key)) {
      throw new ShieldListSyncError('not-subscribed', 'Not subscribed to that filter-list drive')
    }
    return this._pull(key, { force: !!opts.force })
  }

  /** Refresh every subscription; per-drive failures never abort the sweep. */
  async refreshAll (opts = {}) {
    const outcomes = []
    for (const key of [...this._meta.keys()]) {
      try {
        const result = await this._pull(key, { force: !!opts.force })
        outcomes.push({ driveKey: key, ok: true, ...result })
      } catch (err) {
        outcomes.push({ driveKey: key, ok: false, code: err.code || 'refresh-failed', message: err.message })
      }
    }
    return outcomes
  }

  /** Periodic background refresh. Cleared by stop(); never holds the loop open. */
  startAutoRefresh (intervalMs) {
    const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0
    if (!interval) return false
    this.stop()
    this._timer = setInterval(() => {
      this.refreshAll().catch(() => {})
    }, interval)
    if (typeof this._timer?.unref === 'function') this._timer.unref()
    return true
  }

  stop () {
    if (!this._timer) return
    clearInterval(this._timer)
    this._timer = null
  }

  async _pull (key, { force }) {
    await this._refreshDrive(key)
    const manifest = await this._readManifest(key)
    const existing = this._meta.get(key)

    if (!force && existing && manifest && manifest.version && manifest.version === existing.version &&
        (!manifest.sha256 || manifest.sha256 === existing.sha256)) {
      return { changed: false, version: existing.version }
    }

    const filtersPath = manifest && manifest.filters ? manifest.filters : '/filters.txt'
    const fetched = await this._fetch(key, filtersPath)
    const content = fetched && fetched.content ? fetched.content : null
    if (!content || content.length === 0) {
      throw new ShieldListSyncError('list-unavailable', `Filter list ${filtersPath} not found on drive ${key.slice(0, 12)}…`)
    }
    if (content.length > MAX_LIST_BYTES) {
      throw new ShieldListSyncError('list-too-large', `Filter list exceeds ${MAX_LIST_BYTES} bytes`)
    }

    const text = content.toString('utf8')
    const contentHash = this._sha256Hex ? this._sha256Hex(content) : ''
    if (manifest && manifest.sha256 && this._sha256Hex && contentHash !== manifest.sha256) {
      throw new ShieldListSyncError('checksum-mismatch', 'Filter list bytes do not match the published sha256')
    }

    if (!force && existing && contentHash && existing.sha256 === contentHash) {
      // Same bytes under a version-less manifest — nothing to swap.
      this._meta.set(key, { ...existing, updatedAt: this._now() })
      await this._persist()
      return { changed: false, version: existing.version }
    }

    const applied = this._shield.addList(DRIVE_LIST_PREFIX + key, text)
    const meta = {
      name: (manifest && cleanString(manifest.name)) || shortListName(key),
      version: (manifest && cleanString(manifest.version)) || '',
      sha256: (manifest && cleanString(manifest.sha256)) || contentHash,
      updatedAt: this._now(),
      rules: (applied && applied.blockRules + applied.exceptionRules + applied.cosmeticRules) || 0
    }
    this._meta.set(key, meta)
    await this._persist()
    return { changed: true, version: meta.version, rules: meta.rules }
  }

  async _readManifest (key) {
    let fetched
    try {
      fetched = await this._fetch(key, '/manifest.json')
    } catch {
      return null
    }
    const content = fetched && fetched.content ? fetched.content : null
    if (!content || content.length === 0 || content.length > MAX_MANIFEST_BYTES) return null
    try {
      const parsed = JSON.parse(content.toString('utf8'))
      if (!parsed || typeof parsed !== 'object') return null
      return {
        name: cleanString(parsed.name),
        version: cleanString(parsed.version),
        sha256: cleanString(parsed.sha256).toLowerCase(),
        filters: typeof parsed.filters === 'string' && parsed.filters.startsWith('/') ? parsed.filters : null
      }
    } catch {
      return null
    }
  }

  async _persist () {
    const meta = {}
    for (const [key, value] of this._meta) meta[key] = value
    try {
      await this._persistMeta(meta)
    } catch {}
  }
}

function normalizeDriveKey (value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[0-9a-f]{64}$/.test(text) ? text : ''
}

function cleanString (value) {
  return typeof value === 'string' ? value.trim().slice(0, 256) : ''
}

function shortListName (key) {
  return `list ${key.slice(0, 8)}…`
}

module.exports = {
  ShieldListSync,
  ShieldListSyncError,
  DRIVE_LIST_PREFIX,
  MAX_LIST_BYTES
}
