'use strict'

/**
 * Plugin catalogue — discovery for Pear Plugins and AI add-on apps.
 *
 * The catalogue answers "what can I install?" the way the app store answers
 * it for apps: a browser-shipped builtin seed plus any number of
 * P2P-distributed catalogue drives the user subscribes to (a drive with a
 * /plugins.json). Entries are metadata only — INSTALLING still goes through
 * the plugin drive loader with its capability grant + escalation guard, and
 * `kind: "app"` entries (like anonGPT) open as ordinary hyper:// apps whose
 * own manifest gates their powers. The catalogue never grants anything.
 *
 * /plugins.json format on a catalogue drive:
 *
 *   {
 *     "name": "Pear Plugins",
 *     "plugins": [
 *       {
 *         "driveKey": "<64-hex>",
 *         "kind": "plugin" | "app",
 *         "name": "Pear Dark Reader",
 *         "description": "…",
 *         "author": "…",
 *         "capabilities": ["pear.content.styles"]
 *       }
 *     ]
 *   }
 *
 * Mission B4a: port of pearbrowser-desktop backend/plugin-catalog.cjs.
 * DELIBERATE DEVIATION (host-specific): the desktop reads ANONGPT_DRIVE_KEY
 * from backend/constants.js; mobile constants.js is a pure RPC-id mirror
 * (Protocol.kt parity), so the key is defined here and re-exported instead.
 * Everything else is verbatim.
 */

// anonGPT production drive key (mirrors pearbrowser-desktop constants.js
// ANONGPT_DRIVE_KEY; kept local — see header).
const ANONGPT_DRIVE_KEY = 'e3cf8b6fae6260608cbfcdf6b82d985c65f5ad1b9c85e777e296e7c521213abc'

const MAX_CATALOG_BYTES = 256 * 1024
const MAX_ENTRIES_PER_SOURCE = 200
const ENTRY_KINDS = new Set(['plugin', 'app'])

/**
 * Browser-shipped seed. anonGPT ships with its production drive key so a
 * user can add it on their own; the example plugins list without keys until
 * their drives are published (Install stays disabled — fail closed).
 */
const BUILTIN_PLUGIN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'anongpt',
    kind: 'app',
    driveKey: ANONGPT_DRIVE_KEY,
    name: 'anonGPT',
    description: 'Private AI chat as a P2P app. Uses the window.pear.anongpt bridge; PearBrowser verifies the app\'s no-prompt-storage privacy manifest before the bridge is injected, and only on this drive. Open it and it works.',
    author: 'anonGPT',
    capabilities: Object.freeze(['pear.anongpt.infer']),
    verified: true
  }),
  Object.freeze({
    id: 'pear-dark-reader',
    kind: 'plugin',
    driveKey: 'bbde8330169798dc5e0d08f8909b407cea2f8fec7e31d6241f479c714ad42082', // published 2026-07-16, storage seed-pear-dark-reader
    name: 'Pear Dark Reader',
    description: 'Dark, high-contrast theme for every hyper:// page. Styles only — no scripts, no network rules.',
    author: 'PearBrowser examples',
    capabilities: Object.freeze(['pear.content.styles']),
    verified: true
  }),
  Object.freeze({
    id: 'peerit-enhancer',
    kind: 'plugin',
    driveKey: '1b21d8a6960bdcdfb76da94b80dae0d1a28247516de87e6839ea2f87bb609e10', // published 2026-07-16, storage seed-peerit-enhancer
    name: 'peerit Enhancer',
    description: 'Compact rows, reading-width cap, and j/k keyboard navigation for peerit. Scoped to the peerit drive only.',
    author: 'PearBrowser examples',
    capabilities: Object.freeze(['pear.content.styles', 'pear.content.scripts', 'pear.net.filter']),
    verified: true
  })
])

class PluginCatalogError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'PluginCatalogError'
    this.code = code
  }
}

class PluginCatalog {
  /**
   * @param {object} opts
   * @param {function} opts.fetchDriveFile — async (driveKeyHex, path) => { content: Buffer } | null
   * @param {Array} [opts.builtin] — override the seed (tests)
   * @param {function} [opts.now]
   */
  constructor (opts = {}) {
    if (typeof opts.fetchDriveFile !== 'function') {
      throw new TypeError('PluginCatalog requires a fetchDriveFile transport')
    }
    this._fetch = opts.fetchDriveFile
    this._builtin = (Array.isArray(opts.builtin) ? opts.builtin : BUILTIN_PLUGIN_CATALOG)
      .map(entry => validateCatalogEntry(entry, { trusted: true }))
      .filter(Boolean)
    this._refreshDrive = typeof opts.refreshDrive === 'function' ? opts.refreshDrive : async () => {}
    this._sources = new Map() // driveKeyHex -> { name, entries, loadedAt }
    this._now = typeof opts.now === 'function' ? opts.now : Date.now
  }

  /** Merged view: builtin first, then source entries not shadowed by them. */
  entries () {
    const merged = []
    const seen = new Set()
    const push = (entry, source) => {
      const dedupeKey = entry.driveKey || `id:${entry.id}`
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      merged.push({ ...entry, source })
    }
    for (const entry of this._builtin) push(entry, 'builtin')
    for (const [sourceKey, record] of this._sources) {
      for (const entry of record.entries) push(entry, sourceKey)
    }
    return merged
  }

  sources () {
    return [...this._sources.entries()].map(([driveKey, record]) => ({
      driveKey,
      name: record.name,
      entryCount: record.entries.length,
      loadedAt: record.loadedAt
    }))
  }

  /** Subscribe to a catalogue drive: fetch, validate, register (replaces). */
  async loadFromDrive (driveKey) {
    const key = normalizeDriveKey(driveKey)
    if (!key) throw new PluginCatalogError('invalid-drive-key', 'A 64-hex catalogue drive key is required')

    await this._refreshDrive(key)
    const fetched = await this._fetch(key, '/plugins.json')
    const content = fetched && fetched.content ? fetched.content : null
    if (!content || content.length === 0) {
      throw new PluginCatalogError('catalog-unavailable', `No /plugins.json on drive ${key.slice(0, 12)}…`)
    }
    if (content.length > MAX_CATALOG_BYTES) {
      throw new PluginCatalogError('catalog-too-large', `Catalogue exceeds ${MAX_CATALOG_BYTES} bytes`)
    }

    let parsed
    try {
      parsed = JSON.parse(content.toString('utf8'))
    } catch {
      throw new PluginCatalogError('catalog-invalid', 'Catalogue is not valid JSON')
    }
    const rawEntries = Array.isArray(parsed?.plugins) ? parsed.plugins : null
    if (!rawEntries) throw new PluginCatalogError('catalog-invalid', 'Catalogue has no plugins array')

    const entries = rawEntries
      .slice(0, MAX_ENTRIES_PER_SOURCE)
      .map(entry => validateCatalogEntry(entry, { requireDriveKey: true }))
      .filter(Boolean)
    if (!entries.length) throw new PluginCatalogError('catalog-empty', 'Catalogue contains no valid entries')

    const record = {
      name: cleanString(parsed.name, 120) || `catalogue ${key.slice(0, 8)}…`,
      entries,
      loadedAt: this._now()
    }
    this._sources.set(key, record)
    return { driveKey: key, name: record.name, entryCount: entries.length }
  }

  removeSource (driveKey) {
    const key = normalizeDriveKey(driveKey)
    return !!key && this._sources.delete(key)
  }

  /** Durable snapshot of subscribed sources (builtin never persists). */
  exportState () {
    const sources = {}
    for (const [key, record] of this._sources) sources[key] = record
    return { sources }
  }

  restore (state) {
    if (!state || typeof state !== 'object' || !state.sources || typeof state.sources !== 'object') return 0
    let restored = 0
    for (const [key, record] of Object.entries(state.sources)) {
      const driveKey = normalizeDriveKey(key)
      if (!driveKey || !record || typeof record !== 'object') continue
      const entries = Array.isArray(record.entries)
        ? record.entries.map(entry => validateCatalogEntry(entry, { requireDriveKey: true })).filter(Boolean)
        : []
      if (!entries.length) continue
      this._sources.set(driveKey, {
        name: cleanString(record.name, 120) || `catalogue ${driveKey.slice(0, 8)}…`,
        entries,
        loadedAt: Number.isFinite(record.loadedAt) ? record.loadedAt : 0
      })
      restored++
    }
    return restored
  }
}

/**
 * Validate one catalogue entry into the canonical shape, or null. Catalogue
 * capabilities are DISPLAY metadata (what the consent UI previews); the real
 * grant always comes from the plugin drive's own manifest at install time.
 */
function validateCatalogEntry (entry, opts = {}) {
  if (!entry || typeof entry !== 'object') return null
  const name = cleanString(entry.name, 120)
  if (!name) return null

  const driveKey = normalizeDriveKey(entry.driveKey)
  if (opts.requireDriveKey && !driveKey) return null

  const kind = ENTRY_KINDS.has(entry.kind) ? entry.kind : 'plugin'
  const id = cleanString(entry.id, 64).toLowerCase() || driveKey || slugify(name)
  if (!id) return null

  const capabilities = Array.isArray(entry.capabilities)
    ? entry.capabilities.map(cap => cleanString(cap, 64)).filter(Boolean).slice(0, 8)
    : []

  return {
    id,
    kind,
    driveKey,
    name,
    description: cleanString(entry.description, 500),
    author: cleanString(entry.author, 120),
    capabilities,
    // Only browser-shipped entries may carry the curated trust mark. Drive
    // catalogues are untrusted discovery metadata, including after restore.
    verified: opts.trusted === true && entry.verified === true,
    ...(typeof entry.unpublished === 'string' && entry.unpublished ? { unpublished: cleanString(entry.unpublished, 200) } : {})
  }
}

function slugify (value) {
  return cleanString(value, 64).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function normalizeDriveKey (value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[0-9a-f]{64}$/.test(text) ? text : ''
}

function cleanString (value, maxChars) {
  return typeof value === 'string' ? value.trim().slice(0, maxChars) : ''
}

module.exports = {
  PluginCatalog,
  PluginCatalogError,
  BUILTIN_PLUGIN_CATALOG,
  validateCatalogEntry,
  ANONGPT_DRIVE_KEY
}
