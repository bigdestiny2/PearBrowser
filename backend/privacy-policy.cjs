'use strict'

/**
 * Privacy ladder helpers (BROWSER_PARITY_PLAN.md Phase 5), transport-independent.
 *
 * Ported verbatim from pearbrowser-desktop backend/privacy-policy.cjs (Mission
 * B2). Used by clearnet navigation (SessionBridge), the clearnet proxy, and
 * CMD_PRIVACY_STATUS. Pure functions so unit tests drive the shipped
 * evaluators without mocking. Uses the global URL (present in both Bare and
 * Node) — no module imports.
 */

/** Common tracking / click-id query parameters stripped before navigation. */
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
  'mc_eid', 'mc_cid',
  'igshid', 'mkt_tok',
  'oly_anon_id', 'oly_enc_id',
  'vero_id', '_hsenc', '_hsmi',
  'twclid', 'li_fat_id', 's_cid',
  'spm', 'scm',
  'ref_src', 'ref_url'
])

const UTM_PREFIX = 'utm_'

/**
 * @typedef {object} PrivacySettings
 * @property {boolean} [httpsOnly]
 * @property {boolean} [stripTrackingParams]
 * @property {boolean} [blockThirdPartyCookies]
 * @property {boolean} [fingerprintFarbling]
 * @property {string}  [referrerPolicy]  e.g. 'strict-origin-when-cross-origin'
 * @property {string}  [clearnetMode]    'proxy' | 'direct'
 * @property {boolean} [historyEnabled]       opt-in local visit history (default OFF)
 * @property {boolean} [searchIndexEnabled]   opt-in local full-text index of pages (default OFF)
 * @property {boolean} [telemetryEnabled]     always false — no telemetry endpoints exist
 * @property {boolean} [contentShield]        ad/tracker shield (default ON)
 */

/**
 * Privacy-first defaults. History and search indexing are OFF until the user
 * explicitly enables them. There is no telemetry pipeline; the flag exists only
 * so settings UIs can show "never" and tests can assert it stays false.
 */
const DEFAULT_PRIVACY = Object.freeze({
  httpsOnly: true,
  stripTrackingParams: true,
  blockThirdPartyCookies: true,
  fingerprintFarbling: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  clearnetMode: 'proxy',
  historyEnabled: false,
  searchIndexEnabled: false,
  telemetryEnabled: false,
  contentShield: true
})

function normalizePrivacySettings (raw) {
  const out = { ...DEFAULT_PRIVACY }
  if (!raw || typeof raw !== 'object') return out
  if (typeof raw.httpsOnly === 'boolean') out.httpsOnly = raw.httpsOnly
  if (typeof raw.stripTrackingParams === 'boolean') out.stripTrackingParams = raw.stripTrackingParams
  if (typeof raw.blockThirdPartyCookies === 'boolean') out.blockThirdPartyCookies = raw.blockThirdPartyCookies
  if (typeof raw.fingerprintFarbling === 'boolean') out.fingerprintFarbling = raw.fingerprintFarbling
  if (typeof raw.referrerPolicy === 'string' && raw.referrerPolicy.trim()) {
    out.referrerPolicy = raw.referrerPolicy.trim()
  }
  if (raw.clearnetMode === 'direct' || raw.clearnetMode === 'proxy') {
    out.clearnetMode = raw.clearnetMode
  }
  // History / search index: only ON when explicitly true (unset → false).
  if (typeof raw.historyEnabled === 'boolean') out.historyEnabled = raw.historyEnabled
  if (typeof raw.searchIndexEnabled === 'boolean') out.searchIndexEnabled = raw.searchIndexEnabled
  // Telemetry can never be enabled — there is no collector.
  out.telemetryEnabled = false
  // Shield: default on; only OFF when explicitly false.
  if (typeof raw.contentShield === 'boolean') out.contentShield = raw.contentShield
  return out
}

/**
 * Merge stored settings with privacy-first defaults for UI/RPC consumers.
 * Unset history/search keys remain false (opt-in). Unset contentShield stays on.
 */
function mergeSettingsWithPrivacyDefaults (stored = {}) {
  const s = stored && typeof stored === 'object' ? { ...stored } : {}
  const privacy = normalizePrivacySettings({
    ...s,
    ...(s.privacy && typeof s.privacy === 'object' ? s.privacy : {})
  })
  // Flatten privacy keys onto settings so existing UI paths keep working.
  return {
    ...s,
    httpsOnly: privacy.httpsOnly,
    stripTrackingParams: privacy.stripTrackingParams,
    blockThirdPartyCookies: privacy.blockThirdPartyCookies,
    fingerprintFarbling: privacy.fingerprintFarbling,
    referrerPolicy: privacy.referrerPolicy,
    clearnetMode: privacy.clearnetMode,
    historyEnabled: privacy.historyEnabled === true,
    searchIndexEnabled: privacy.searchIndexEnabled === true,
    telemetryEnabled: false,
    // contentShield only false when user explicitly disabled
    contentShield: s.contentShield === false ? false : true
  }
}

/** True only when the user has explicitly opted into visit history. */
function isHistoryEnabled (settings) {
  const s = mergeSettingsWithPrivacyDefaults(settings)
  return s.historyEnabled === true
}

/** True only when the user has explicitly opted into local page indexing. */
function isSearchIndexEnabled (settings) {
  const s = mergeSettingsWithPrivacyDefaults(settings)
  return s.searchIndexEnabled === true
}

/**
 * Classify a navigation target for the browser.
 * @returns {'hyper'|'clearnet'|'loopback'|'other'|null}
 */
function classifyUrl (url) {
  if (typeof url !== 'string' || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    if (u.protocol === 'hyper:') return 'hyper'
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const host = (u.hostname || '').toLowerCase()
      if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') return 'loopback'
      return 'clearnet'
    }
    return 'other'
  } catch {
    return null
  }
}

/**
 * Apply HTTPS-only + tracking-param strip to a clearnet URL.
 * Returns { url, upgraded, stripped: string[] }.
 */
function sanitizeClearnetUrl (inputUrl, privacy = DEFAULT_PRIVACY) {
  const settings = normalizePrivacySettings(privacy)
  let text = typeof inputUrl === 'string' ? inputUrl.trim() : ''
  if (!text) return { url: '', upgraded: false, stripped: [] }

  let upgraded = false
  try {
    let u = new URL(text)
    if (settings.httpsOnly && u.protocol === 'http:') {
      u.protocol = 'https:'
      upgraded = true
      text = u.toString()
      u = new URL(text)
    }
    const stripped = []
    if (settings.stripTrackingParams) {
      const keys = [...u.searchParams.keys()]
      for (const key of keys) {
        const lower = key.toLowerCase()
        if (TRACKING_PARAMS.has(lower) || lower.startsWith(UTM_PREFIX)) {
          u.searchParams.delete(key)
          stripped.push(key)
        }
      }
      // Drop empty search
      text = u.toString()
    }
    return { url: text, upgraded, stripped }
  } catch {
    return { url: text, upgraded: false, stripped: [] }
  }
}

/**
 * Fingerprint farbling script body (no <script> wrapper) for hash-authorized inject.
 * Per-origin noise seeded from a stable salt so same site stays consistent in-session.
 * Pure JS — ports to WKWebView/Android WebView with no native hooks because it
 * rides the same inject path as Content Shield scriptlets.
 */
function fingerprintFarblingScript (originSalt = 'pear') {
  const salt = String(originSalt || 'pear').slice(0, 64)
  return `(function(){try{if(window.__pearFarbling)return;window.__pearFarbling=true;var S=${JSON.stringify(salt)};function h(s){var x=2166136261>>>0;for(var i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619)}return x>>>0}var seed=h(S+(location&&location.origin||''));function rnd(){seed=(seed*1664525+1013904223)>>>0;return (seed>>>0)/4294967296}try{var to=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(){try{var c=this.getContext('2d');if(c){var d=c.getImageData(0,0,Math.min(this.width||1,16),Math.min(this.height||1,16));for(var i=0;i<d.data.length;i+=4){d.data[i]=d.data[i]^(rnd()*3|0)}c.putImageData(d,0,0)}}catch(e){}return to.apply(this,arguments)}}catch(e){}try{var aq=AudioBuffer.prototype.getChannelData;AudioBuffer.prototype.getChannelData=function(){var a=aq.apply(this,arguments);try{for(var i=0;i<Math.min(a.length,128);i++)a[i]+= (rnd()-0.5)*1e-5}catch(e){}return a}}catch(e){}}catch(e){}})();`
}

/**
 * Referrer-Policy meta content when privacy enables a policy.
 */
function referrerPolicyMeta (privacy = DEFAULT_PRIVACY) {
  const settings = normalizePrivacySettings(privacy)
  if (!settings.referrerPolicy) return ''
  return `<meta name="referrer" content="${escapeAttr(settings.referrerPolicy)}">`
}

function escapeAttr (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * True when input looks like a public domain / host for URL-bar navigation
 * (example.com, www.example.co.uk:8080/path).
 */
function looksLikeClearnetHost (raw) {
  const s = String(raw || '').trim()
  if (!s || /\s/.test(s)) return false
  if (/^(hyper|pear|file|pearname):\/\//i.test(s)) return false
  if (/^[0-9a-f]{64}$/i.test(s)) return false
  if (/^[13-9a-km-uw-z]{52}$/i.test(s)) return false
  // scheme already present
  if (/^https?:\/\//i.test(s)) return true
  // host.tld or host.tld/path
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i.test(s)
}

/**
 * Structural URL-bar normalization only (no privacy mutations).
 * Privacy (HTTPS-only, tracking strip) is applied once by SessionBridge
 * via sanitizeClearnetUrl so upgrade/stripped metadata stays accurate.
 */
function normalizeNavigationInput (raw, privacy = DEFAULT_PRIVACY) {
  void privacy // reserved for callers that pass settings through
  const s = String(raw || '').trim()
  if (!s) return null
  if (/^hyper:\/\//i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (/^[0-9a-f]{64}$/i.test(s)) return `hyper://${s.toLowerCase()}/`
  if (/^[13-9a-km-uw-z]{52}$/i.test(s)) return `hyper://${s}/`
  if (looksLikeClearnetHost(s)) {
    return `https://${s.replace(/^\/+/, '')}`
  }
  if (s.includes('/') || s.startsWith('pear://')) return s
  return `hyper://${s}`
}

module.exports = {
  DEFAULT_PRIVACY,
  TRACKING_PARAMS,
  normalizePrivacySettings,
  mergeSettingsWithPrivacyDefaults,
  isHistoryEnabled,
  isSearchIndexEnabled,
  classifyUrl,
  sanitizeClearnetUrl,
  fingerprintFarblingScript,
  referrerPolicyMeta,
  looksLikeClearnetHost,
  normalizeNavigationInput
}
