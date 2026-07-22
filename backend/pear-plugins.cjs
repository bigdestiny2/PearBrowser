'use strict'

/**
 * Pear Plugins foundation (Phase 3 of docs/BROWSER_PARITY_PLAN.md).
 *
 * Mission B4a: VERBATIM port of pearbrowser-desktop backend/pear-plugins.cjs
 * (no host-specific dependencies — the engine surface it drives,
 * content-shield.cjs applyPluginContribution/setPluginEnabled/
 * PLUGIN_LIST_PREFIX, was already ported in Mission B1).
 *
 * Plugins are Hyperdrive-style apps with extra capabilities declared in
 * manifest.json. They are NOT Chrome MV2/MV3 extensions — there is no
 * webRequest API surface. Contributions feed the same ContentShield engine
 * and HTML inject path as browser-owned rules.
 *
 * Capability vocabulary:
 *   pear.net.filter       — contribute network filter rules (namespaced)
 *   pear.content.styles   — contribute cosmetic/content CSS for matched hosts
 *   pear.content.scripts  — contribute content scripts (hash-authorized inject)
 *   pear.panel            — reserved (chrome side-panel; not enforced here)
 *   pear.ai.infer         — already exists for AI; not plugin-specific
 *
 * Fail-closed: missing pear.plugin metadata, missing capability, or kill
 * switch → contribution has no effect.
 */

const PLUGIN_CAPABILITIES = Object.freeze([
  'pear.net.filter',
  'pear.content.styles',
  'pear.content.scripts',
  'pear.panel',
  'pear.ai.infer'
])

class PearPluginRegistry {
  /**
   * @param {object} opts
   * @param {import('./content-shield.cjs').ContentShield} [opts.shield]
   */
  constructor (opts = {}) {
    this._shield = opts.shield || null
    /** @type {Map<string, PluginRecord>} */
    this._plugins = new Map()
  }

  setContentShield (shield) {
    this._shield = shield || null
  }

  /**
   * Register (or replace) a plugin from a parsed manifest + optional
   * contribution payload. Returns a structured result; never throws for
   * policy failures (fail-closed).
   *
   * @param {object} input
   * @param {string} input.id — stable plugin id (usually drive key hex)
   * @param {object} input.manifest — drive /manifest.json contents
   * @param {object} [input.contribution] — { filters, styles, scripts }
   * @param {boolean} [input.enabled]
   */
  register (input = {}) {
    const id = normalizePluginId(input.id)
    if (!id) return { ok: false, reason: 'missing-plugin-id' }

    const parsed = parsePluginManifest(input.manifest)
    if (!parsed.ok) return parsed

    const enabled = input.enabled !== false
    const contribution = input.contribution || extractContributionFromManifest(input.manifest) || {}

    const record = {
      id,
      name: parsed.name,
      version: parsed.version,
      capabilities: parsed.capabilities,
      contribution,
      enabled,
      registeredAt: Date.now()
    }
    this._plugins.set(id, record)

    if (this._shield) {
      this._shield.setPluginEnabled(id, enabled)
      if (enabled) {
        this._shield.applyPluginContribution(id, contribution, parsed.capabilities)
      } else {
        // Ensure namespaced rules are stripped while disabled.
        this._shield.applyPluginContribution(id, contribution, parsed.capabilities)
        this._shield.setPluginEnabled(id, false)
      }
    }

    return {
      ok: true,
      id,
      name: record.name,
      capabilities: record.capabilities,
      enabled,
      applied: summarizeApplied(parsed.capabilities, contribution, enabled)
    }
  }

  /** One-click kill switch without uninstalling. */
  setEnabled (pluginId, enabled) {
    const id = normalizePluginId(pluginId)
    const record = this._plugins.get(id)
    if (!record) return { ok: false, reason: 'unknown-plugin' }
    record.enabled = !!enabled
    if (this._shield) {
      this._shield.setPluginEnabled(id, record.enabled)
      if (record.enabled) {
        this._shield.applyPluginContribution(id, record.contribution, record.capabilities)
      } else {
        // Strip filter list; style/script inject paths honor isPluginEnabled.
        this._shield.applyPluginContribution(id, record.contribution, record.capabilities)
        this._shield.setPluginEnabled(id, false)
      }
    }
    return { ok: true, id, enabled: record.enabled }
  }

  unregister (pluginId) {
    const id = normalizePluginId(pluginId)
    const record = this._plugins.get(id)
    if (!record) return false
    this._plugins.delete(id)
    if (this._shield) {
      this._shield.setPluginEnabled(id, false)
      this._shield.applyPluginContribution(id, {}, []) // clears styles/scripts maps
      // removeList via empty filters with cap would not clear; force list drop
      const { PLUGIN_LIST_PREFIX } = require('./content-shield.cjs')
      this._shield.removeList(PLUGIN_LIST_PREFIX + id)
    }
    return true
  }

  get (pluginId) {
    const record = this._plugins.get(normalizePluginId(pluginId))
    return record ? publicPluginView(record) : null
  }

  list () {
    return [...this._plugins.values()].map(publicPluginView)
  }

  /**
   * Fail-closed capability check used by callers before exposing surfaces.
   */
  hasCapability (pluginId, capability) {
    const record = this._plugins.get(normalizePluginId(pluginId))
    if (!record || !record.enabled) return false
    return record.capabilities.includes(String(capability))
  }
}

/**
 * Parse pear.plugin metadata from a drive manifest. Fail-closed when
 * pear.plugin is missing or not truthy.
 */
function parsePluginManifest (manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, reason: 'missing-manifest' }
  }
  const pear = manifest.pear && typeof manifest.pear === 'object' ? manifest.pear : null
  const pluginFlag = pear
    ? (pear.plugin === true || pear.plugin === 1 || (pear.plugin && typeof pear.plugin === 'object'))
    : (manifest.plugin === true)
  if (!pluginFlag) {
    return { ok: false, reason: 'not-a-plugin' }
  }

  const rawCaps = []
  if (pear && Array.isArray(pear.capabilities)) rawCaps.push(...pear.capabilities)
  if (Array.isArray(manifest.capabilities)) rawCaps.push(...manifest.capabilities)
  if (pear && pear.plugin && typeof pear.plugin === 'object' && Array.isArray(pear.plugin.capabilities)) {
    rawCaps.push(...pear.plugin.capabilities)
  }

  const capabilities = [...new Set(rawCaps.map(String).filter((c) => PLUGIN_CAPABILITIES.includes(c)))]
  const name = String(
    (pear && pear.plugin && pear.plugin.name) ||
    manifest.name ||
    manifest.title ||
    'plugin'
  )
  const version = String(manifest.version || (pear && pear.plugin && pear.plugin.version) || '0.0.0')

  return { ok: true, name, version, capabilities }
}

function extractContributionFromManifest (manifest) {
  if (!manifest || typeof manifest !== 'object') return null
  const pear = manifest.pear && typeof manifest.pear === 'object' ? manifest.pear : {}
  const plugin = pear.plugin && typeof pear.plugin === 'object' ? pear.plugin : {}
  const content = plugin.content || pear.content || manifest.content || null
  if (!content || typeof content !== 'object') {
    // Allow top-level contribution fields for fixtures.
    if (manifest.filters || manifest.styles || manifest.scripts) {
      return {
        filters: manifest.filters || '',
        styles: manifest.styles || null,
        scripts: manifest.scripts || null
      }
    }
    return null
  }
  return {
    filters: content.filters || content.filterList || '',
    styles: content.styles || content.css || null,
    scripts: content.scripts || content.js || null
  }
}

function normalizePluginId (value) {
  if (typeof value !== 'string') return ''
  const text = value.trim().toLowerCase()
  if (!text || text.length > 128) return ''
  // Accept full drive keys or short fixture ids.
  if (/^[0-9a-f]{64}$/.test(text)) return text
  if (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(text)) return text
  return ''
}

function publicPluginView (record) {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    capabilities: [...record.capabilities],
    enabled: record.enabled,
    registeredAt: record.registeredAt
  }
}

function summarizeApplied (capabilities, contribution, enabled) {
  if (!enabled) return { filters: false, styles: false, scripts: false, reason: 'disabled' }
  const caps = new Set(capabilities)
  return {
    filters: !!(caps.has('pear.net.filter') && contribution && contribution.filters),
    styles: !!(caps.has('pear.content.styles') && contribution && contribution.styles),
    scripts: !!(caps.has('pear.content.scripts') && contribution && contribution.scripts)
  }
}

module.exports = {
  PearPluginRegistry,
  parsePluginManifest,
  extractContributionFromManifest,
  PLUGIN_CAPABILITIES
}
