'use strict'

/**
 * Plugin drive loader — installs Pear Plugins from Hyperdrives (Phase 3 gate
 * of docs/BROWSER_PARITY_PLAN.md).
 *
 * Mission B4a: VERBATIM port of pearbrowser-desktop backend/plugin-drive-
 * loader.cjs. All host-specific pieces (drive fetch, drive refresh, sha256,
 * persistence) were already constructor-injected by the desktop, so the
 * mobile wiring passes the same seams (proxy._hybridFetch, the shield
 * distribution-drive refresh, bare-crypto sha256, user-data settings).
 *
 * A plugin drive looks like an ordinary Pear app drive:
 *
 *   /manifest.json   pear.plugin metadata + capabilities (see pear-plugins.cjs)
 *   /style.css       optional content styles (path declared in the manifest)
 *   /content.js      optional content script
 *   /filters.txt     optional network filter contribution
 *
 * The manifest declares which assets exist and where they match:
 *
 *   {
 *     "name": "Dark Reader",
 *     "version": "1.0.0",
 *     "pear": {
 *       "plugin": {
 *         "capabilities": ["pear.content.styles"],
 *         "content": {
 *           "styles":  { "matches": ["*"], "path": "/style.css" },
 *           "scripts": { "matches": ["*"], "path": "/content.js" },
 *           "filters": "/filters.txt"
 *         }
 *       }
 *     }
 *   }
 *
 * The loader fetches the declared assets, builds the inline contribution the
 * registry expects, and registers under the drive key. Grants are captured at
 * install time; an update whose manifest requests capabilities beyond the
 * recorded grant is an ESCALATION — the plugin is disabled and flagged for
 * explicit re-consent instead of silently gaining power. (A Hyperdrive
 * update arrives over the swarm with no user action, so this guard is what
 * makes P2P-distributed plugins safe.)
 */

const MAX_ASSET_BYTES = 512 * 1024
const MAX_FILTER_BYTES = 2 * 1024 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024

class PluginDriveError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'PluginDriveError'
    this.code = code
  }
}

class PluginDriveLoader {
  /**
   * @param {object} opts
   * @param {object} opts.registry — PearPluginRegistry
   * @param {function} opts.fetchDriveFile — async (driveKeyHex, path) => { content: Buffer } | null
   * @param {function} opts.sha256Hex — cryptographic snapshot hash for consent binding
   * @param {function} [opts.refreshDrive] — async (driveKeyHex) => advance cached drive state
   * @param {function} [opts.persistInstall] — async (id, payload|null) => void; null clears
   * @param {function} [opts.now]
   */
  constructor (opts = {}) {
    if (!opts.registry || typeof opts.registry.register !== 'function') {
      throw new TypeError('PluginDriveLoader requires a PearPluginRegistry')
    }
    if (typeof opts.fetchDriveFile !== 'function') {
      throw new TypeError('PluginDriveLoader requires a fetchDriveFile transport')
    }
    if (typeof opts.sha256Hex !== 'function') {
      throw new TypeError('PluginDriveLoader requires a sha256Hex function')
    }
    this._registry = opts.registry
    this._fetch = opts.fetchDriveFile
    this._sha256Hex = opts.sha256Hex
    this._refreshDrive = typeof opts.refreshDrive === 'function' ? opts.refreshDrive : async () => {}
    this._persistInstall = typeof opts.persistInstall === 'function' ? opts.persistInstall : async () => {}
    this._now = typeof opts.now === 'function' ? opts.now : Date.now
    this._installs = new Map() // driveKeyHex -> { granted, version, escalated: {added}|null }
  }

  /** Rehydrate install records (grants + versions) from durable settings. */
  restore (records) {
    if (!records || typeof records !== 'object') return 0
    let restored = 0
    for (const [key, record] of Object.entries(records)) {
      const driveKey = normalizeDriveKey(key)
      if (!driveKey || !record || typeof record !== 'object') continue
      this._installs.set(driveKey, {
        granted: normalizeCapabilityList(record.granted),
        version: cleanString(record.version),
        installedAt: Number.isFinite(record.installedAt) ? record.installedAt : 0,
        escalated: record.escalated && Array.isArray(record.escalated.added)
          ? {
              added: normalizeCapabilityList(record.escalated.added),
              capabilities: normalizeCapabilityList(record.escalated.capabilities),
              version: cleanString(record.escalated.version),
              fingerprint: normalizeFingerprint(record.escalated.fingerprint)
            }
          : null
      })
      restored++
    }
    return restored
  }

  installs () {
    return [...this._installs.entries()].map(([driveKey, record]) => ({ driveKey, ...record }))
  }

  installRecord (driveKey) {
    const key = normalizeDriveKey(driveKey)
    return key ? this._installs.get(key) || null : null
  }

  /**
   * Install through a two-step consent handshake. The first call returns the
   * requested capabilities and a cryptographic snapshot fingerprint without
   * registering anything. Acceptance must echo that fingerprint and an
   * explicit grant, binding consent to the exact bytes the user reviewed.
   */
  async installFromDrive (driveKey, opts = {}) {
    const key = normalizeDriveKey(driveKey)
    if (!key) throw new PluginDriveError('invalid-drive-key', 'A 64-hex plugin drive key is required')

    const loaded = await this._load(key)
    const requested = loaded.capabilities
    const reviewedFingerprint = normalizeFingerprint(opts.reviewedFingerprint)
    if (!reviewedFingerprint || reviewedFingerprint !== loaded.fingerprint || opts.grantedCapabilities === undefined) {
      return consentPreview(key, loaded, reviewedFingerprint ? 'plugin-changed' : 'consent-required')
    }
    const granted = normalizeCapabilityList(opts.grantedCapabilities).filter(cap => requested.includes(cap))

    const result = this._registry.register({
      id: key,
      manifest: withCapabilities(loaded.manifest, granted),
      contribution: loaded.contribution,
      enabled: opts.enabled !== false
    })
    if (!result || result.ok !== true) {
      throw new PluginDriveError('register-failed', (result && result.reason) || 'Plugin registration failed')
    }

    const record = {
      granted,
      version: loaded.version,
      installedAt: this._now(),
      escalated: null
    }
    this._installs.set(key, record)
    await this._persist(key, {
      id: key,
      manifest: withCapabilities(loaded.manifest, granted),
      contribution: loaded.contribution,
      enabled: opts.enabled !== false,
      granted,
      version: loaded.version,
      installedAt: record.installedAt
    })
    return { ok: true, driveKey: key, name: result.name, version: loaded.version, granted, applied: result.applied }
  }

  /**
   * Update an installed plugin from its drive. Fail-closed on capability
   * escalation: the plugin is disabled, the escalation is recorded, and the
   * caller gets the added capabilities to show in a re-consent prompt.
   * Acceptance must echo the reviewed snapshot fingerprint and complete
   * capability set; changed bytes produce a new warning instead of a grant.
   */
  async updateFromDrive (driveKey, opts = {}) {
    const key = normalizeDriveKey(driveKey)
    const record = key ? this._installs.get(key) : null
    if (!record) throw new PluginDriveError('not-installed', 'Plugin is not installed from a drive')

    const loaded = await this._load(key)
    const added = loaded.capabilities.filter(cap => !record.granted.includes(cap))

    if (added.length > 0) {
      const reviewedFingerprint = normalizeFingerprint(opts.reviewedFingerprint)
      const acceptedCapabilities = normalizeCapabilityList(opts.grantedCapabilities)
      const pending = record.escalated
      const acceptedSnapshot = pending &&
        reviewedFingerprint &&
        pending.fingerprint === reviewedFingerprint &&
        loaded.fingerprint === reviewedFingerprint &&
        arraysEqual(acceptedCapabilities, pending.capabilities) &&
        arraysEqual(loaded.capabilities, pending.capabilities)

      if (!acceptedSnapshot) {
        this._registry.setEnabled(key, false)
        record.escalated = escalationSnapshot(loaded, added)
        await this._persistRecordOnly(key, record)
        return {
          ok: false,
          escalated: true,
          driveKey: key,
          ...record.escalated,
          changedSinceReview: !!reviewedFingerprint,
          message: reviewedFingerprint
            ? 'Plugin changed since review; inspect the new capabilities before re-consenting'
            : 'Update requests new capabilities; plugin disabled pending re-consent'
        }
      }
    }

    const granted = added.length > 0 ? loaded.capabilities : record.granted
    const result = this._registry.register({
      id: key,
      manifest: withCapabilities(loaded.manifest, granted),
      contribution: loaded.contribution,
      enabled: true
    })
    if (!result || result.ok !== true) {
      throw new PluginDriveError('register-failed', (result && result.reason) || 'Plugin registration failed')
    }

    record.granted = granted
    record.version = loaded.version
    record.escalated = null
    await this._persist(key, {
      id: key,
      manifest: withCapabilities(loaded.manifest, granted),
      contribution: loaded.contribution,
      enabled: true,
      granted,
      version: loaded.version,
      installedAt: record.installedAt || this._now()
    })
    return { ok: true, driveKey: key, version: loaded.version, granted, escalationAccepted: added.length > 0 }
  }

  async uninstall (driveKey) {
    const key = normalizeDriveKey(driveKey)
    if (!key) return { removed: false }
    const known = this._installs.delete(key)
    const removed = this._registry.unregister(key) || known
    await this._persist(key, null)
    return { removed: !!removed, driveKey: key }
  }

  async _load (key) {
    await this._refreshDrive(key)
    const manifestFile = await this._fetch(key, '/manifest.json')
    const manifestBytes = manifestFile && manifestFile.content ? manifestFile.content : null
    if (!manifestBytes || manifestBytes.length === 0) {
      throw new PluginDriveError('manifest-unavailable', `No /manifest.json on drive ${key.slice(0, 12)}…`)
    }
    if (manifestBytes.length > MAX_MANIFEST_BYTES) {
      throw new PluginDriveError('manifest-too-large', 'Plugin manifest exceeds the size cap')
    }

    let manifest
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'))
    } catch {
      throw new PluginDriveError('manifest-invalid', 'Plugin manifest is not valid JSON')
    }

    const pear = manifest && manifest.pear && typeof manifest.pear === 'object' ? manifest.pear : {}
    const plugin = pear.plugin && typeof pear.plugin === 'object' ? pear.plugin : null
    if (!plugin) throw new PluginDriveError('not-a-plugin', 'Manifest does not declare pear.plugin')

    const capabilities = normalizeCapabilityList(
      [].concat(plugin.capabilities || [], pear.capabilities || [], manifest.capabilities || [])
    )
    const content = plugin.content && typeof plugin.content === 'object' ? plugin.content : {}
    const contribution = {}

    if (content.styles && typeof content.styles === 'object' && typeof content.styles.path === 'string') {
      const css = await this._readAsset(key, content.styles.path, MAX_ASSET_BYTES)
      contribution.styles = { matches: normalizeMatches(content.styles.matches), css }
    }
    if (content.scripts && typeof content.scripts === 'object' && typeof content.scripts.path === 'string') {
      const js = await this._readAsset(key, content.scripts.path, MAX_ASSET_BYTES)
      contribution.scripts = { matches: normalizeMatches(content.scripts.matches), js }
    }
    if (typeof content.filters === 'string' && content.filters.startsWith('/')) {
      contribution.filters = await this._readAsset(key, content.filters, MAX_FILTER_BYTES)
    }

    const version = cleanString(manifest.version) || '0.0.0'
    const fingerprint = normalizeFingerprint(this._sha256Hex(Buffer.from(JSON.stringify({ manifest, contribution }))))
    if (!fingerprint) throw new PluginDriveError('fingerprint-failed', 'Could not fingerprint the plugin snapshot')
    return {
      manifest,
      capabilities,
      contribution,
      version,
      fingerprint,
      name: cleanString(manifest.name) || `plugin ${key.slice(0, 8)}…`
    }
  }

  async _readAsset (key, path, maxBytes) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) {
      throw new PluginDriveError('asset-path-invalid', `Invalid plugin asset path: ${path}`)
    }
    const fetched = await this._fetch(key, path)
    const content = fetched && fetched.content ? fetched.content : null
    if (!content || content.length === 0) {
      throw new PluginDriveError('asset-unavailable', `Declared plugin asset ${path} is missing`)
    }
    if (content.length > maxBytes) {
      throw new PluginDriveError('asset-too-large', `Plugin asset ${path} exceeds ${maxBytes} bytes`)
    }
    return content.toString('utf8')
  }

  async _persist (key, payload) {
    try {
      await this._persistInstall(key, payload)
    } catch {}
  }

  async _persistRecordOnly (key, record) {
    // Escalation state rides the same durable payload; merge via callback.
    try {
      await this._persistInstall(key, {
        __recordPatch: true,
        granted: record.granted,
        version: record.version,
        installedAt: record.installedAt,
        escalated: record.escalated
      })
    } catch {}
  }
}

function consentPreview (driveKey, loaded, reason) {
  return {
    ok: false,
    consentRequired: true,
    reason,
    driveKey,
    name: loaded.name,
    version: loaded.version,
    requested: loaded.capabilities,
    fingerprint: loaded.fingerprint
  }
}

function escalationSnapshot (loaded, added) {
  return {
    added: normalizeCapabilityList(added),
    capabilities: [...loaded.capabilities],
    version: loaded.version,
    fingerprint: loaded.fingerprint
  }
}

function normalizeFingerprint (value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[0-9a-f]{64}$/.test(text) ? text : ''
}

function arraysEqual (a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index])
}

function withCapabilities (manifest, capabilities) {
  // The registry derives capabilities from the manifest; scope registration
  // to the GRANTED set so an ungranted capability never reaches the engine.
  const clone = JSON.parse(JSON.stringify(manifest || {}))
  if (!clone.pear || typeof clone.pear !== 'object') clone.pear = {}
  if (!clone.pear.plugin || typeof clone.pear.plugin !== 'object') clone.pear.plugin = {}
  clone.pear.plugin.capabilities = [...capabilities]
  delete clone.pear.capabilities
  delete clone.capabilities
  return clone
}

function normalizeCapabilityList (value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
}

function normalizeMatches (value) {
  if (!Array.isArray(value)) return ['*']
  const matches = value.map(item => typeof item === 'string' ? item.trim().toLowerCase() : '').filter(Boolean)
  return matches.length ? matches : ['*']
}

function normalizeDriveKey (value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[0-9a-f]{64}$/.test(text) ? text : ''
}

function cleanString (value) {
  return typeof value === 'string' ? value.trim().slice(0, 256) : ''
}

module.exports = {
  PluginDriveLoader,
  PluginDriveError,
  MAX_ASSET_BYTES,
  MAX_FILTER_BYTES
}
