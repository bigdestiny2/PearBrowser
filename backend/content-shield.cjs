'use strict'

/**
 * Content Shield — PearBrowser's browser-owned request filter and cosmetic
 * hider (Phases 1–3 of docs/BROWSER_PARITY_PLAN.md in the desktop repo).
 *
 * Ported verbatim from pearbrowser-desktop backend/content-shield.cjs — the
 * engine is dependency-free CJS, so behavior (block/allow precedence,
 * exceptions, cosmetic/scriptlet model) matches the desktop exactly.
 *
 * The engine is transport-independent on purpose: hyper-proxy calls it for
 * every proxied request and HTML injection; a future session bridge can
 * evaluate the identical rules in front of a native net stack without
 * changing the rule format, settings, or stats contracts.
 *
 * Supported filter syntax (a pragmatic Adblock-Plus/hosts subset):
 *   ! comment                     — ignored
 *   ||host^                      — block host and its subdomains
 *   plain-substring              — block URLs containing the substring
 *   @@||host^  /  @@substring    — exception (always wins over blocks)
 *   ##.selector                  — global cosmetic (element hiding) rule
 *   example.com##.selector       — host-scoped cosmetic rule
 *   ##+js(name, arg1, arg2)      — scriptlet (set-constant / abort-on-property-read)
 *   example.com##+js(...)        — host-scoped scriptlet
 *   0.0.0.0 host / 127.0.0.1 host — hosts-file style block lines
 *
 * Unsupported directives (resource-type options like $script, regex rules,
 * redirect rules, unknown scriptlets) are skipped without error so real-world
 * lists load their supported subset instead of failing.
 *
 * Phase 2 additions: named multi-list hot-swap, durable list text export,
 * per-drive allowlist, per-drive strict third-party CSP, scriptlets.
 * Phase 3 additions: namespaced plugin rule contributions + kill switches.
 */

// Built-in ad/tracker seed — pure advertising, analytics, and tracking
// endpoints with no first-party content role. Expanded for privacy-first
// defaults so the shield blocks the common industry list offline without
// any list CDN. Phase 2 named lists can still hot-swap additional rules.
const BUILTIN_FILTER_LIST = `
! PearBrowser built-in seed list (privacy-first)
! --- Google ads / analytics ---
||doubleclick.net^
||googletagmanager.com^
||google-analytics.com^
||googlesyndication.com^
||googleadservices.com^
||adservice.google.com^
||pagead2.googlesyndication.com^
||googleads.g.doubleclick.net^
||stats.g.doubleclick.net^
||www.google-analytics.com^
||ssl.google-analytics.com^
||region1.google-analytics.com^
||analytics.google.com^
||ad.doubleclick.net^
||static.doubleclick.net^
||cm.g.doubleclick.net^
||googleoptimize.com^
||optimize.google.com^
||tagmanager.google.com^
||googletagservices.com^
||2mdn.net^
||partner.googleadservices.com^
! --- Meta / Facebook ---
||connect.facebook.net^
||facebook.com/tr^
||pixel.facebook.com^
||an.facebook.com^
! --- Amazon / Microsoft / LinkedIn ads ---
||amazon-adsystem.com^
||adsystem.com^
||aax.amazon-adsystem.com^
||c.amazon-adsystem.com^
||fls-na.amazon-adsystem.com^
||ads.microsoft.com^
||bat.bing.com^
||clarity.ms^
||ads.linkedin.com^
||snap.licdn.com^
||px.ads.linkedin.com^
! --- Ad exchanges / SSPs ---
||adnxs.com^
||rubiconproject.com^
||pubmatic.com^
||openx.net^
||openx.com^
||criteo.com^
||criteo.net^
||casalemedia.com^
||advertising.com^
||adtechus.com^
||adform.net^
||bidswitch.net^
||contextweb.com^
||smartadserver.com^
||lijit.com^
||sovrn.com^
||indexww.com^
||3lift.com^
||sharethrough.com^
||teads.tv^
||yieldmo.com^
||media.net^
||adsrvr.org^
||rlcdn.com^
||bluekai.com^
||exelator.com^
||krxd.net^
||mathtag.com^
||turn.com^
||agkn.com^
||demdex.net^
||omtrdc.net^
||everesttech.net^
||adsymptotic.com^
||bidr.io^
||stickyadstv.com^
||spotxchange.com^
||spotx.tv^
||tremorhub.com^
||inmobi.com^
||moatads.com^
||moatpixel.com^
! --- Content recommendation / native ads ---
||taboola.com^
||outbrain.com^
||revcontent.com^
||mgid.com^
||zergnet.com^
||disqusads.com^
! --- Analytics / session replay / mobile attribution ---
||scorecardresearch.com^
||quantserve.com^
||chartbeat.com^
||chartbeat.net^
||mixpanel.com^
||segment.io^
||segment.com^
||api.segment.io^
||cdn.segment.com^
||fullstory.com^
||mouseflow.com^
||hotjar.com^
||hotjar.io^
||static.hotjar.com^
||script.hotjar.com^
||heap-api.com^
||heapanalytics.com^
||amplitude.com^
||api.amplitude.com^
||cdn.amplitude.com^
||nr-data.net^
||bam.nr-data.net^
||yandex.ru/metrika^
||mc.yandex.ru^
||metrika.yandex.ru^
||advertising.yandex.ru^
||ads.yahoo.com^
||analytics.yahoo.com^
||ads.twitter.com^
||static.ads-twitter.com^
||analytics.twitter.com^
||ads-api.twitter.com^
||pixel.wp.com^
||stats.wp.com^
||pixel.quantserve.com^
||secure.quantserve.com^
||sb.scorecardresearch.com^
||b.scorecardresearch.com^
||cdn.mxpnl.com^
||api.mixpanel.com^
||decide.mixpanel.com^
||logx.optimizely.com^
||cdn.optimizely.com^
||api.branch.io^
||cdn.branch.io^
||appsflyer.com^
||app.appsflyer.com^
||adjust.com^
||app.adjust.com^
||ads-twitter.com^
||trkn.us^
||adsafeprotected.com^
||doubleverify.com^
||adobedtm.com^
||omtrdc.net^
||tt.omtrdc.net^
||sc.omtrdc.net^
||everesttech.net^
||serving-sys.com^
||eyeota.net^
||tapad.com^
||crwdcntrl.net^
||addthis.com^
||addthisedge.com^
||sharethis.com^
||outbrainimg.com^
||taboola.com^
||trc.taboola.com^
||cdn.taboola.com^
||widgets.outbrain.com^
||log.outbrain.com^
! --- Path / substring trackers (min length 4, no wildcards) ---
/pagead/
/__utm.gif
doubleclick
googlesyndication
googleadservices
adsbygoogle
amazon-adsystem
googletagmanager
! --- Cosmetic (element hiding) ---
##.adsbygoogle
##.ad-banner
##.ad-container
##.ad-slot
##.ad-wrapper
##.advertisement
##.adsbox
##.taboola-container
##.OUTBRAIN
##.dfp-ad
##.sponsored-content
##.promo-ad
`

/** Scriptlet kinds this engine can emit (uBlock-style subset). */
const SUPPORTED_SCRIPTLETS = new Set(['set-constant', 'abort-on-property-read'])

/** Prefix for plugin-owned list namespaces inside the engine. */
const PLUGIN_LIST_PREFIX = 'plugin:'

class ContentShield {
  constructor (opts = {}) {
    this._enabled = opts.enabled !== false
    this._blockRules = []            // { kind: 'host'|'substring', value, raw, list }
    this._exceptionRules = []        // same shape
    this._cosmeticGlobal = new Set() // selectors
    this._cosmeticByHost = new Map() // host -> Set<selector>
    this._scriptletsGlobal = []      // { name, args, raw, list }
    this._scriptletsByHost = new Map() // host -> same shape[]
    this._lists = new Map()          // name -> { rules, cosmetic, scriptlets, text? }
    this._listTexts = new Map()      // name -> original text (durable reload)
    this._allowlisted = new Set()    // drive keys exempt from blocking
    this._strictDrives = new Set()   // drive keys with strict third-party CSP
    this._pluginEnabled = new Map()  // pluginId -> boolean (default true when registered)
    this._stats = {
      blocked: 0,
      allowed: 0,
      byRule: new Map()              // raw rule -> hits
    }

    if (opts.builtinList !== false) {
      this.addList('builtin', typeof opts.builtinList === 'string' ? opts.builtinList : BUILTIN_FILTER_LIST)
    }
  }

  get enabled () { return this._enabled }

  setEnabled (enabled) {
    this._enabled = !!enabled
  }

  /**
   * Parse and register a filter list under a name. Re-adding the same name
   * replaces that list's rules (supports Phase 2 hot swaps). Stores the raw
   * text so durable state can rehydrate without network.
   */
  addList (name, text) {
    const listName = typeof name === 'string' && name ? name : 'unnamed'
    this._lists.delete(listName)
    const source = text == null ? '' : String(text)
    const parsed = parseFilterList(source)
    this._lists.set(listName, parsed)
    this._listTexts.set(listName, source)
    this._rebuild()
    return {
      name: listName,
      blockRules: parsed.block.length,
      exceptionRules: parsed.exceptions.length,
      cosmeticRules: parsed.cosmetic.length,
      scriptletRules: parsed.scriptlets.length
    }
  }

  removeList (name) {
    const removed = this._lists.delete(name)
    this._listTexts.delete(name)
    if (removed) this._rebuild()
    return removed
  }

  /** Names of currently loaded lists (including plugin namespaces). */
  listNames () {
    return [...this._lists.keys()]
  }

  /**
   * Snapshot list metadata + raw texts for durable browser-owned state.
   * Builtin seed is omitted from texts (rebuilt on construct); user/plugin
   * lists are included so offline reload works after first acquisition.
   */
  exportListState () {
    const lists = {}
    for (const [name, text] of this._listTexts) {
      if (name === 'builtin') continue
      if (name.startsWith(PLUGIN_LIST_PREFIX)) continue
      lists[name] = text
    }
    return {
      lists,
      allowlist: [...this._allowlisted],
      strict: [...this._strictDrives],
      plugins: Object.fromEntries(this._pluginEnabled)
    }
  }

  /**
   * Rehydrate durable state (lists, allowlist, strict, plugin kill switches)
   * without network. Hot-swaps each named list; preserves builtin seed.
   */
  importListState (state) {
    if (!state || typeof state !== 'object') return { loaded: 0 }
    let loaded = 0
    if (state.lists && typeof state.lists === 'object') {
      for (const [name, text] of Object.entries(state.lists)) {
        if (!name || name === 'builtin' || name.startsWith(PLUGIN_LIST_PREFIX)) continue
        this.addList(name, text)
        loaded++
      }
    }
    if (Array.isArray(state.allowlist)) {
      this._allowlisted.clear()
      for (const key of state.allowlist) {
        const n = normalizeDriveKey(key)
        if (n) this._allowlisted.add(n)
      }
    }
    if (Array.isArray(state.strict)) {
      this._strictDrives.clear()
      for (const key of state.strict) {
        const n = normalizeDriveKey(key)
        if (n) this._strictDrives.add(n)
      }
    }
    if (state.plugins && typeof state.plugins === 'object') {
      for (const [id, enabled] of Object.entries(state.plugins)) {
        this._pluginEnabled.set(String(id), !!enabled)
      }
      this._rebuild()
    }
    return { loaded }
  }

  // --- Per-drive allowlist (Phase 2) ---

  allowlistDrive (driveKey) {
    const key = normalizeDriveKey(driveKey)
    if (!key) return false
    this._allowlisted.add(key)
    return true
  }

  removeAllowlistDrive (driveKey) {
    const key = normalizeDriveKey(driveKey)
    if (!key) return false
    return this._allowlisted.delete(key)
  }

  isAllowlisted (driveKey) {
    const key = normalizeDriveKey(driveKey)
    return !!(key && this._allowlisted.has(key))
  }

  allowlist () {
    return [...this._allowlisted]
  }

  // --- Per-drive strict third-party mode (Phase 2) ---

  setStrictDrive (driveKey, enabled) {
    const key = normalizeDriveKey(driveKey)
    if (!key) return false
    if (enabled) this._strictDrives.add(key)
    else this._strictDrives.delete(key)
    return true
  }

  isStrict (driveKey) {
    const key = normalizeDriveKey(driveKey)
    return !!(key && this._strictDrives.has(key))
  }

  strictDrives () {
    return [...this._strictDrives]
  }

  /**
   * CSP meta content that confines third-party subresources to the page's
   * own origin. Callers inject this as a <meta http-equiv="Content-Security-Policy">
   * when isStrict(driveKey). Script hashes (if any) are appended by the proxy.
   */
  strictCspContent (extraScriptHashes = []) {
    const hashTokens = (extraScriptHashes || [])
      .filter(Boolean)
      .map((h) => (String(h).startsWith('sha256-') ? `'${h}'` : `'sha256-${h}'`))
      .join(' ')
    const scriptSrc = hashTokens
      ? `script-src 'self' ${hashTokens}`
      : "script-src 'self'"
    return [
      "default-src 'self'",
      scriptSrc,
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "connect-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'"
    ].join('; ')
  }

  /**
   * Decide whether a URL should be blocked. `url` may be any absolute URL.
   * `opts.documentKey` (drive key hex) opts that drive out of blocking when
   * allowlisted; cosmetic/scriptlet injection still consults allowlist in the
   * proxy so exempt drives render unfiltered.
   */
  shouldBlockUrl (url, opts = {}) {
    if (!this._enabled) return { blocked: false, rule: null }
    const documentKey = normalizeDriveKey(opts.documentKey) || extractDriveKeyFromUrl(url)
    if (documentKey && this._allowlisted.has(documentKey)) {
      this._stats.allowed++
      return { blocked: false, rule: null, allowlisted: true }
    }
    const normalized = normalizeUrl(url)
    if (!normalized) return { blocked: false, rule: null }

    for (const rule of this._exceptionRules) {
      if (matchRule(rule, normalized)) {
        this._stats.allowed++
        return { blocked: false, rule: rule.raw }
      }
    }
    for (const rule of this._blockRules) {
      if (matchRule(rule, normalized)) {
        this._stats.blocked++
        this._stats.byRule.set(rule.raw, (this._stats.byRule.get(rule.raw) || 0) + 1)
        return { blocked: true, rule: rule.raw }
      }
    }
    this._stats.allowed++
    return { blocked: false, rule: null }
  }

  /**
   * The cosmetic (element hiding) CSS block for one document host. Returns
   * an empty string when nothing applies so callers can inject
   * unconditionally. Allowlisted drives get no cosmetic CSS.
   */
  cosmeticCssFor (host, opts = {}) {
    if (!this._enabled) return ''
    const documentKey = normalizeDriveKey(opts.documentKey)
    if (documentKey && this._allowlisted.has(documentKey)) return ''
    const selectors = new Set(this._cosmeticGlobal)
    const documentHost = normalizeHost(host)
    if (documentHost) {
      for (const [ruleHost, hostSelectors] of this._cosmeticByHost) {
        if (documentHost === ruleHost || documentHost.endsWith('.' + ruleHost)) {
          for (const selector of hostSelectors) selectors.add(selector)
        }
      }
    }
    if (!selectors.size) return ''
    return `${[...selectors].join(',\n')} { display: none !important; }`
  }

  /**
   * Scriptlet bodies for a document host. Returns an array of
   * `{ raw, body }` where body is pure JS (no <script> wrapper) so the
   * proxy can hash-authorize and inject via the existing CSP path.
   */
  scriptletsFor (host, opts = {}) {
    if (!this._enabled) return []
    const documentKey = normalizeDriveKey(opts.documentKey)
    if (documentKey && this._allowlisted.has(documentKey)) return []
    const out = []
    const push = (entry) => {
      const body = compileScriptlet(entry)
      if (body) out.push({ raw: entry.raw, name: entry.name, args: entry.args, body })
    }
    for (const entry of this._scriptletsGlobal) push(entry)
    const documentHost = normalizeHost(host)
    if (documentHost) {
      for (const [ruleHost, entries] of this._scriptletsByHost) {
        if (documentHost === ruleHost || documentHost.endsWith('.' + ruleHost)) {
          for (const entry of entries) push(entry)
        }
      }
    }
    return out
  }

  // --- Plugin contributions (Phase 3) ---

  /**
   * Register filter/style/script contributions from a plugin. Fail-closed:
   * without declared capabilities the call is a no-op. Network filters land
   * in a namespaced list `plugin:<id>`; styles/scripts go into dedicated
   * plugin maps consulted at inject time.
   */
  applyPluginContribution (pluginId, contribution, capabilities = []) {
    const id = String(pluginId || '').trim()
    if (!id) return { ok: false, reason: 'missing-plugin-id' }
    const caps = new Set((capabilities || []).map(String))
    if (!this._pluginEnabled.has(id)) this._pluginEnabled.set(id, true)

    const listName = PLUGIN_LIST_PREFIX + id
    // Drop previous contributions for this plugin before re-applying.
    this.removeList(listName)
    this._pluginStyles = this._pluginStyles || new Map()
    this._pluginScripts = this._pluginScripts || new Map()
    this._pluginStyles.delete(id)
    this._pluginScripts.delete(id)

    if (!this._pluginEnabled.get(id)) {
      return { ok: true, disabled: true, listName }
    }

    let applied = { filters: false, styles: false, scripts: false }

    if (caps.has('pear.net.filter') && contribution && contribution.filters) {
      this.addList(listName, contribution.filters)
      applied.filters = true
    }
    if (caps.has('pear.content.styles') && contribution && contribution.styles) {
      const styles = normalizePluginStyles(contribution.styles)
      if (styles.length) {
        this._pluginStyles.set(id, styles)
        applied.styles = true
      }
    }
    if (caps.has('pear.content.scripts') && contribution && contribution.scripts) {
      const scripts = normalizePluginScripts(contribution.scripts)
      if (scripts.length) {
        this._pluginScripts.set(id, scripts)
        applied.scripts = true
      }
    }
    return { ok: true, listName, applied, enabled: this._pluginEnabled.get(id) !== false }
  }

  /** Kill-switch: disable a plugin's contributions without uninstalling. */
  setPluginEnabled (pluginId, enabled) {
    const id = String(pluginId || '').trim()
    if (!id) return false
    this._pluginEnabled.set(id, !!enabled)
    // Re-apply by clearing list if disabled; callers that hold contributions
    // should call applyPluginContribution again after re-enable. When
    // disabling we just strip the namespaced list and mark disabled so
    // styles/scripts skip at inject time.
    if (!enabled) {
      this.removeList(PLUGIN_LIST_PREFIX + id)
    }
    return true
  }

  isPluginEnabled (pluginId) {
    const id = String(pluginId || '').trim()
    if (!id) return false
    if (!this._pluginEnabled.has(id)) return true
    return this._pluginEnabled.get(id) !== false
  }

  pluginStylesFor (host, opts = {}) {
    if (!this._enabled) return ''
    const documentKey = normalizeDriveKey(opts.documentKey)
    if (documentKey && this._allowlisted.has(documentKey)) return ''
    if (!this._pluginStyles) return ''
    const documentHost = normalizeHost(host)
    const chunks = []
    for (const [id, styles] of this._pluginStyles) {
      if (!this.isPluginEnabled(id)) continue
      for (const entry of styles) {
        if (hostMatches(documentHost, entry.matches)) {
          chunks.push(`/* pear-plugin:${id} */\n${entry.css}`)
        }
      }
    }
    return chunks.join('\n')
  }

  pluginScriptsFor (host, opts = {}) {
    if (!this._enabled) return []
    const documentKey = normalizeDriveKey(opts.documentKey)
    if (documentKey && this._allowlisted.has(documentKey)) return []
    if (!this._pluginScripts) return []
    const documentHost = normalizeHost(host)
    const out = []
    for (const [id, scripts] of this._pluginScripts) {
      if (!this.isPluginEnabled(id)) continue
      for (const entry of scripts) {
        if (hostMatches(documentHost, entry.matches) && entry.js) {
          out.push({ pluginId: id, body: entry.js })
        }
      }
    }
    return out
  }

  stats () {
    const byRule = [...this._stats.byRule.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([rule, hits]) => ({ rule, hits }))
    let blockRules = this._blockRules.length
    let cosmeticRules = this._cosmeticGlobal.size
    for (const selectors of this._cosmeticByHost.values()) cosmeticRules += selectors.size
    let scriptletRules = this._scriptletsGlobal.length
    for (const entries of this._scriptletsByHost.values()) scriptletRules += entries.length
    const lists = []
    for (const [name, parsed] of this._lists) {
      lists.push({
        name,
        blockRules: parsed.block.length,
        exceptionRules: parsed.exceptions.length,
        cosmeticRules: parsed.cosmetic.length,
        scriptletRules: (parsed.scriptlets || []).length,
        durable: name !== 'builtin' && !name.startsWith(PLUGIN_LIST_PREFIX)
      })
    }
    return {
      enabled: this._enabled,
      blocked: this._stats.blocked,
      allowed: this._stats.allowed,
      blockRules,
      exceptionRules: this._exceptionRules.length,
      cosmeticRules,
      scriptletRules,
      lists: lists.map((l) => l.name),
      listDetails: lists,
      allowlist: this.allowlist(),
      strict: this.strictDrives(),
      plugins: Object.fromEntries(this._pluginEnabled),
      topRules: byRule
    }
  }

  resetStats () {
    this._stats.blocked = 0
    this._stats.allowed = 0
    this._stats.byRule.clear()
  }

  _rebuild () {
    this._blockRules = []
    this._exceptionRules = []
    this._cosmeticGlobal = new Set()
    this._cosmeticByHost = new Map()
    this._scriptletsGlobal = []
    this._scriptletsByHost = new Map()
    for (const [listName, parsed] of this._lists) {
      // Skip disabled plugin lists (belt-and-suspenders with removeList on kill).
      if (listName.startsWith(PLUGIN_LIST_PREFIX)) {
        const pluginId = listName.slice(PLUGIN_LIST_PREFIX.length)
        if (!this.isPluginEnabled(pluginId)) continue
      }
      for (const rule of parsed.block) this._blockRules.push({ ...rule, list: listName })
      for (const rule of parsed.exceptions) this._exceptionRules.push({ ...rule, list: listName })
      for (const { host, selector } of parsed.cosmetic) {
        if (!host) {
          this._cosmeticGlobal.add(selector)
        } else {
          if (!this._cosmeticByHost.has(host)) this._cosmeticByHost.set(host, new Set())
          this._cosmeticByHost.get(host).add(selector)
        }
      }
      for (const scriptlet of parsed.scriptlets || []) {
        if (!scriptlet.host) {
          this._scriptletsGlobal.push({ ...scriptlet, list: listName })
        } else {
          if (!this._scriptletsByHost.has(scriptlet.host)) {
            this._scriptletsByHost.set(scriptlet.host, [])
          }
          this._scriptletsByHost.get(scriptlet.host).push({ ...scriptlet, list: listName })
        }
      }
    }
  }
}

function parseFilterList (text) {
  const block = []
  const exceptions = []
  const cosmetic = []
  const scriptlets = []
  const lines = String(text || '').split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('!') || line.startsWith('[')) continue

    // Scriptlets: [host]##+js(name, args…) — before generic cosmetic ##.
    const scriptletIndex = line.indexOf('##+js(')
    if (scriptletIndex !== -1 && line.endsWith(')')) {
      const rawHostPart = line.slice(0, scriptletIndex)
      if (!/[\s#]/.test(rawHostPart)) {
        const hostPart = normalizeHost(rawHostPart)
        // Slice past "##+js(" and drop the trailing ")".
        const argsBody = line.slice(scriptletIndex + '##+js('.length, -1)
        const parts = splitScriptletArgs(argsBody)
        const name = (parts[0] || '').trim().toLowerCase()
        if (SUPPORTED_SCRIPTLETS.has(name)) {
          scriptlets.push({
            host: hostPart || null,
            name,
            args: parts.slice(1).map((a) => a.trim()),
            raw: line
          })
        }
        continue
      }
    }

    // Cosmetic rules: [host]##selector — check before network parsing so a
    // selector containing network metacharacters is never misread. The host
    // part must look like a host (or be empty for a global rule); anything
    // with spaces or '#' before the separator is a hosts-file comment.
    const cosmeticIndex = line.indexOf('##')
    if (cosmeticIndex !== -1) {
      const rawHostPart = line.slice(0, cosmeticIndex)
      if (!/[\s#]/.test(rawHostPart)) {
        const hostPart = normalizeHost(rawHostPart)
        const selector = line.slice(cosmeticIndex + 2).trim()
        // Selectors are embedded into a browser-owned <style> block. Reject
        // markup delimiters here and also escape style text at the proxy sink.
        if (selector && !/[{}<>]/.test(selector)) {
          cosmetic.push({ host: hostPart || null, selector })
        }
        continue
      }
    }
    if (line.includes('#@#')) continue // cosmetic exceptions unsupported
    if (line.startsWith('#')) continue // hosts-file comment

    // Hosts-file lines: "0.0.0.0 host" / "127.0.0.1 host".
    const hostsMatch = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+([^\s#]+)/)
    if (hostsMatch) {
      const host = normalizeHost(hostsMatch[1])
      if (host && host !== 'localhost') block.push({ kind: 'host', value: host, raw: `||${host}^` })
      continue
    }

    const isException = line.startsWith('@@')
    const body = isException ? line.slice(2) : line
    const target = isException ? exceptions : block

    // Skip rules with unsupported option suffixes ($third-party, $script…)
    // except a bare $document/$all which still reduces to its pattern.
    const dollar = body.indexOf('$')
    const pattern = dollar === -1 ? body : body.slice(0, dollar)
    const options = dollar === -1 ? '' : body.slice(dollar + 1)
    if (options && !/^(document|all)$/i.test(options)) continue
    if (!pattern) continue

    if (pattern.startsWith('||')) {
      // ||host^ or ||host/path^ — host anchor with optional path prefix.
      const anchored = pattern.slice(2).replace(/\^$/, '')
      if (!anchored) continue
      const slash = anchored.indexOf('/')
      if (slash === -1) {
        const host = normalizeHost(anchored)
        if (host) target.push({ kind: 'host', value: host, raw: line })
      } else {
        target.push({ kind: 'substring', value: anchored.toLowerCase(), raw: line })
      }
      continue
    }

    // Plain substring rule. Strip ABP anchor/separator metacharacters we do
    // not model; require a minimum length so a stray "a" can't nuke the web.
    const substring = pattern.replace(/^\|+/, '').replace(/\|+$/, '').replace(/\^/g, '').toLowerCase()
    if (substring.length >= 4 && !substring.includes('*')) {
      target.push({ kind: 'substring', value: substring, raw: line })
    }
  }

  return { block, exceptions, cosmetic, scriptlets }
}

function splitScriptletArgs (body) {
  const parts = []
  let current = ''
  let inQuote = null
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inQuote) {
      if (ch === inQuote) inQuote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch
      continue
    }
    if (ch === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

function compileScriptlet (entry) {
  if (!entry || !SUPPORTED_SCRIPTLETS.has(entry.name)) return ''
  if (entry.name === 'set-constant') {
    const prop = sanitizeIdentifierPath(entry.args[0])
    if (!prop) return ''
    const valueLit = scriptletValueLiteral(entry.args[1])
    return `(function(){try{var p=${JSON.stringify(prop)}.split('.');var o=window;for(var i=0;i<p.length-1;i++){o=o[p[i]];if(o==null)return}var k=p[p.length-1];try{Object.defineProperty(o,k,{get:function(){return ${valueLit}},set:function(){},configurable:true})}catch(e){try{o[k]=${valueLit}}catch(e2){}}}catch(e){}})();`
  }
  if (entry.name === 'abort-on-property-read') {
    const prop = sanitizeIdentifierPath(entry.args[0])
    if (!prop) return ''
    return `(function(){try{var p=${JSON.stringify(prop)}.split('.');var o=window;for(var i=0;i<p.length-1;i++){o=o[p[i]];if(o==null)return}var k=p[p.length-1];Object.defineProperty(o,k,{get:function(){throw new ReferenceError('aborted')},set:function(){},configurable:true})}catch(e){}})();`
  }
  return ''
}

function sanitizeIdentifierPath (value) {
  const text = String(value || '').trim()
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(text)) return ''
  return text
}

function scriptletValueLiteral (raw) {
  const v = String(raw == null ? '' : raw).trim()
  if (v === 'true') return 'true'
  if (v === 'false') return 'false'
  if (v === 'undefined') return 'undefined'
  if (v === 'null') return 'null'
  if (v === 'noopFunc' || v === 'noopCallbackFunc') return 'function(){}'
  if (v === 'trueFunc') return 'function(){return true}'
  if (v === 'falseFunc') return 'function(){return false}'
  if (v === 'emptyArray') return '[]'
  if (v === 'emptyObject') return '{}'
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  return JSON.stringify(v)
}

function matchRule (rule, normalized) {
  if (rule.kind === 'host') {
    return normalized.host === rule.value || normalized.host.endsWith('.' + rule.value) ||
      // hyper:// paths can carry proxied clearnet-shaped segments; match the
      // full URL too so ||host^ still catches /hyper/<key>/https://host/ad.js.
      normalized.url.includes('/' + rule.value + '/') || normalized.url.includes('//' + rule.value)
  }
  return normalized.url.includes(rule.value)
}

function normalizeUrl (url) {
  const text = typeof url === 'string' ? url.trim() : ''
  if (!text) return null
  try {
    const parsed = new URL(text)
    return { url: text.toLowerCase(), host: normalizeHost(parsed.hostname) }
  } catch {
    return { url: text.toLowerCase(), host: '' }
  }
}

function normalizeHost (value) {
  return typeof value === 'string' ? value.trim().replace(/\.$/, '').toLowerCase() : ''
}

function normalizeDriveKey (value) {
  if (typeof value !== 'string') return ''
  const hex = value.trim().toLowerCase().replace(/^hyper:\/\//i, '').split(/[/?#]/)[0]
  if (!/^[0-9a-f]{64}$/.test(hex)) return ''
  return hex
}

function extractDriveKeyFromUrl (url) {
  if (typeof url !== 'string') return ''
  const m = url.match(/^hyper:\/\/([0-9a-fA-F]{64})/i)
  return m ? m[1].toLowerCase() : ''
}

function hostMatches (documentHost, matches) {
  if (!matches || !matches.length) return true
  const host = normalizeHost(documentHost) || ''
  for (const pattern of matches) {
    const p = String(pattern || '').trim().toLowerCase()
    if (!p || p === '*') return true
    if (p.startsWith('*.')) {
      const suffix = p.slice(2)
      if (host === suffix || host.endsWith('.' + suffix)) return true
    } else if (host === p || host.endsWith('.' + p)) {
      return true
    }
  }
  return false
}

function normalizePluginStyles (styles) {
  const list = Array.isArray(styles) ? styles : [styles]
  return list.map((entry) => {
    if (typeof entry === 'string') return { matches: ['*'], css: entry }
    return {
      matches: Array.isArray(entry.matches) ? entry.matches : ['*'],
      css: String(entry.css || entry.style || '')
    }
  }).filter((e) => e.css)
}

function normalizePluginScripts (scripts) {
  const list = Array.isArray(scripts) ? scripts : [scripts]
  return list.map((entry) => {
    if (typeof entry === 'string') return { matches: ['*'], js: entry }
    return {
      matches: Array.isArray(entry.matches) ? entry.matches : ['*'],
      js: String(entry.js || entry.script || entry.body || '')
    }
  }).filter((e) => e.js)
}

module.exports = {
  ContentShield,
  parseFilterList,
  compileScriptlet,
  BUILTIN_FILTER_LIST,
  PLUGIN_LIST_PREFIX,
  SUPPORTED_SCRIPTLETS
}
