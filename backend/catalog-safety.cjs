// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/catalog-safety.cjs.
// Shared catalog/link normalizers — also the name layer's target validation
// (name-record.cjs / name-registry-ops.cjs / names.cjs depend on it).
function scrubPrototypeKeys (value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) delete value[key]
  }
  if (Array.isArray(value)) {
    for (const item of value) scrubPrototypeKeys(item, seen)
    return value
  }
  for (const key of Object.keys(value)) scrubPrototypeKeys(value[key], seen)
  return value
}

function safeJSONParse (str) {
  return scrubPrototypeKeys(JSON.parse(str))
}

function catalogAppsFromEnvelope (catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return []
  if (Array.isArray(catalog.apps)) return catalog.apps
  if (Array.isArray(catalog.items)) return catalog.items
  if (Array.isArray(catalog.entries)) return catalog.entries
  return []
}

const HEX64_RE = /^[0-9a-f]{64}$/i
const Z32_RE = /^[13-9a-km-uw-z]{52}$/i
const APP_LINK_RE = /^(?:hyper|pear|file):\/\/.+/i
const VERIFICATION_RANK = { 'author-signed': 3, 'relay-listed': 2, unverified: 1 }

function trimString (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function hexFromZ32 (value) {
  try {
    const z32 = require('z32')
    const buf = z32.decode(String(value || '').toLowerCase())
    return buf && buf.length === 32 ? Buffer.from(buf).toString('hex') : ''
  } catch {
    return ''
  }
}

function normalizeDriveKey (raw) {
  const s = trimString(raw)
  if (!s) return ''

  const target = /^hyper:\/\//i.test(s)
    ? s.replace(/^hyper:\/\//i, '').split(/[/?#]/)[0].trim()
    : s

  if (HEX64_RE.test(target)) return target.toLowerCase()
  if (Z32_RE.test(target)) return hexFromZ32(target)
  return ''
}

function driveKeyFromHyperLink (raw) {
  const s = trimString(raw)
  if (!/^hyper:\/\//i.test(s)) return ''
  const key = s.replace(/^hyper:\/\//i, '').split(/[/?#]/)[0].trim()
  if (HEX64_RE.test(key)) return key.toLowerCase()
  if (Z32_RE.test(key)) return hexFromZ32(key)
  return ''
}

function normalizeCatalogLink (raw) {
  const s = trimString(raw)
  if (!s) return ''
  const normalized = s.replace(/^([a-z][a-z0-9+.-]*):\/\//i, (_, scheme) => scheme.toLowerCase() + '://')
  return APP_LINK_RE.test(normalized) ? normalized : ''
}

function normalizeCategories (categories) {
  if (!Array.isArray(categories)) return []
  return categories
    .map((category) => String(category || '').trim())
    .filter(Boolean)
    .slice(0, 32)
}

function normalizeVerification (value) {
  const v = trimString(value)
  return v || 'unverified'
}

function normalizeAppType (value) {
  const type = trimString(value).toLowerCase()
  return type === 'standalone' || type === 'hypersite' ? type : ''
}

function normalizeCatalogApp (app, opts = {}) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) return null
  const out = { ...app }
  const upstreamSource = trimString(out.sourceUrl) || (opts.source ? trimString(out.source) : '')

  const key = trimString(out.driveKey) ||
    trimString(out.appKey) ||
    trimString(out.key) ||
    ''
  const rawLink = trimString(out.link)
  const link = normalizeCatalogLink(out.link)
  const driveKey = normalizeDriveKey(key) || driveKeyFromHyperLink(link)
  const id = trimString(out.id) || driveKey || link
  if ((key && !driveKey && !link) || (rawLink && !link && !driveKey) || (!driveKey && !link) || !id) return null

  out.id = id || undefined
  out.name = trimString(out.name) || id || undefined
  if (driveKey) out.driveKey = driveKey
  else delete out.driveKey
  if (link) out.link = link
  else delete out.link
  const type = normalizeAppType(out.type)
  if (type) out.type = type
  else delete out.type
  out.version = out.version == null ? '' : String(out.version).trim()
  out.categories = normalizeCategories(out.categories)
  out.verification = normalizeVerification(out.verification)
  if (upstreamSource) out.sourceUrl = upstreamSource
  if (opts.source) out.source = opts.source
  if (opts.catalogKey && !out.catalogKey) out.catalogKey = opts.catalogKey
  if (opts.catalogName && !out.catalogName) out.catalogName = opts.catalogName
  return out
}

function normalizeCatalogData (catalog, opts = {}) {
  const data = scrubPrototypeKeys(catalog && typeof catalog === 'object' && !Array.isArray(catalog)
    ? catalog
    : {})
  const appOpts = { ...opts, catalogName: opts.catalogName || data.name }
  const apps = catalogAppsFromEnvelope(data)
    .map((app) => normalizeCatalogApp(app, appOpts))
    .filter(Boolean)
  return { ...data, apps }
}

function catalogAppStableKey (app) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) return ''
  const key = trimString(app.driveKey) ||
    trimString(app.appKey) ||
    trimString(app.key) ||
    ''
  const link = normalizeCatalogLink(app.link)
  const driveKey = normalizeDriveKey(key) || driveKeyFromHyperLink(link)
  if (driveKey) return `drive:${driveKey}`
  if (link) return `link:${link}`
  const id = trimString(app.id)
  if (id) return `id:${id}`
  return ''
}

function versionGreater (a, b) {
  const pa = String(a == null ? '0' : a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b == null ? '0' : b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da !== db) return da > db
  }
  return false
}

function betterCatalogApp (a, b) {
  const va = VERIFICATION_RANK[a && a.verification] || 1
  const vb = VERIFICATION_RANK[b && b.verification] || 1
  if (va !== vb) return va > vb ? a : b
  if (versionGreater(a && a.version, b && b.version)) return a
  if (versionGreater(b && b.version, a && a.version)) return b
  return b
}

function mergeCatalogAppEntries (incoming, existing) {
  if (!existing) return incoming
  const winner = betterCatalogApp(incoming, existing)
  const other = winner === incoming ? existing : incoming
  const merged = { ...winner }
  if (!merged.iconData && other.iconData) merged.iconData = other.iconData
  if (!merged.icon && other.icon) merged.icon = other.icon
  const sources = [
    ...(Array.isArray(existing._sources) ? existing._sources : []),
    ...(Array.isArray(incoming._sources) ? incoming._sources : []),
    existing.catalogName,
    incoming.catalogName
  ].filter(Boolean)
  if (sources.length) merged._sources = [...new Set(sources)]
  return merged
}

function defaultCatalogEntrySource (entry) {
  if (entry && entry.type) return entry.type
  return entry && entry.drive ? 'hyperdrive' : 'catalog'
}

function aggregateCatalogApps (catalogs, sourceForEntry = defaultCatalogEntrySource) {
  const byTarget = new Map()
  const anon = []
  const entries = catalogs && typeof catalogs[Symbol.iterator] === 'function' ? catalogs : []
  for (const [catalogKey, entry] of entries) {
    if (!entry || !entry.data || !Array.isArray(entry.data.apps)) continue
    const catalogName = entry.data.name || 'Catalog'
    const source = sourceForEntry(entry)
    for (const app of entry.data.apps) {
      const normalized = normalizeCatalogApp(app, { source, catalogKey, catalogName })
      if (!normalized) continue
      const tagged = { ...normalized, source, catalogKey, catalogName }
      const stableKey = catalogAppStableKey(tagged)
      if (!stableKey) { anon.push(tagged); continue }
      byTarget.set(stableKey, mergeCatalogAppEntries(tagged, byTarget.get(stableKey)))
    }
  }
  return [...byTarget.values(), ...anon]
}

function searchAppsList (apps, query) {
  const list = Array.isArray(apps) ? apps : []
  const q = String(query || '').normalize('NFKC').trim().toLowerCase()
  if (!q) return list
  return list.filter(app => catalogAppSearchText(app).includes(q))
}

function catalogAppSearchText (app) {
  if (!app || typeof app !== 'object') return ''
  const fields = [
    app.name,
    app.description,
    app.author,
    app.homepage,
    app.sourceUrl,
    app.license,
    app.id,
    app.version,
    app.source,
    app.catalogName,
    app.verification,
    app.link,
    app.driveKey,
    ...(Array.isArray(app.categories) ? app.categories : []),
    ...(Array.isArray(app._sources) ? app._sources : [])
  ]
  return fields
    .filter((value) => value != null && value !== '')
    .map((value) => String(value).normalize('NFKC').toLowerCase())
    .join(' ')
}

function sanitizePersonalCatalogEntry (app) {
  if (!app || typeof app !== 'object') throw new Error('Invalid app')
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : undefined)
  const draft = {
    id: str(app.id, 128),
    name: str(app.name, 200),
    description: str(app.description, 1000),
    driveKey: str(app.driveKey, 128),
    link: str(app.link, 300),
    version: str(app.version, 40),
    author: str(app.author, 200),
    icon: str(app.icon, 300),
    // Launch gating (PBACS §9): explicit standalone (own window) vs hypersite
    // (inline tab). Only the two valid enum values survive; anything else drops.
    type: (['standalone', 'hypersite'].includes(String(app.type || '').trim()) ? String(app.type).trim() : undefined)
  }
  if (Array.isArray(app.categories)) {
    draft.categories = app.categories.map((c) => String(c).trim().slice(0, 60)).filter(Boolean).slice(0, 12)
  }
  for (const k of Object.keys(draft)) if (draft[k] === undefined || draft[k] === '') delete draft[k]
  const out = normalizeCatalogApp(draft)
  if (!out) throw new Error('App needs a valid 64-hex drive key, hyper:// drive link, pear:// link, or file:// link.')
  return {
    id: out.id,
    name: out.name,
    ...(draft.type ? { type: draft.type } : {}),
    description: out.description || '',
    ...(out.driveKey ? { driveKey: out.driveKey } : {}),
    ...(out.link ? { link: out.link } : {}),
    version: out.version || '',
    author: out.author || '',
    categories: Array.isArray(out.categories) ? out.categories : [],
    ...(out.icon ? { icon: out.icon } : {})
  }
}

module.exports = {
  VERIFICATION_RANK,
  aggregateCatalogApps,
  betterCatalogApp,
  catalogAppStableKey,
  catalogAppSearchText,
  catalogAppsFromEnvelope,
  mergeCatalogAppEntries,
  normalizeCatalogApp,
  normalizeCatalogLink,
  normalizeDriveKey,
  driveKeyFromHyperLink,
  normalizeCatalogData,
  normalizeAppType,
  scrubPrototypeKeys,
  safeJSONParse,
  sanitizePersonalCatalogEntry,
  searchAppsList
}
