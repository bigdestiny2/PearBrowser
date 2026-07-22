'use strict'

/**
 * Browser-owned clearnet (http/https) proxy for PearBrowser (mobile).
 *
 * Ported from pearbrowser-desktop backend/clearnet-proxy.cjs (Mission B2).
 * WKWebView / Android WebView cannot intercept subresource requests natively,
 * so this proxy is the ONLY shielded clearnet path on mobile — which is also
 * the desktop default. Every clearnet request that flows through here is
 * evaluated by the same ContentShield engine as hyper://, HTML is rewritten so
 * subresources stay on the proxy, and privacy ladder hooks (tracking strip,
 * farbling, referrer meta) ride the inject path.
 *
 * Direct-mode clearnet (WebView load of the real https URL) is a separate
 * navigation path that skips this module when settings say so; no shield or
 * privacy ladder applies there (mirrors desktop).
 *
 * Mobile adaptations vs the desktop original (all deliberate):
 *   1. Global URL instead of require('url') (Bare exposes URL globally).
 *   2. b4a instead of Buffer for base64url/concat/utf8 (worklet-safe).
 *   3. Origin pseudo-key documentKey: `deps.documentKeyFor(url)` maps the
 *      target's origin to the same `pear.origin.v1:` 64-hex pseudo-key that
 *      issueOriginToken() uses, so per-origin allowlist AND strict-CSP work
 *      on clearnet exactly like per-drive on hyper://. The desktop passes {}
 *      (no documentKey) — mobile threads it through block, cosmetic,
 *      scriptlet, and strict decisions, recomputed per redirect hop.
 *   4. Injected inline scripts (shield scriptlets, farbling) are
 *      hash-authorized against the page's own meta CSP via B1's
 *      injectCspShimHashes sink, and strict origins additionally receive the
 *      shield's strict-CSP meta. The desktop computes scriptBodies but never
 *      hash-authorizes them on clearnet; mobile reuses the B1 machinery as
 *      intended. Response-header CSP stays unset on proxied documents
 *      (mirrors desktop — a strict header CSP would break publisher inline
 *      scripts; upstream CSP/framing/reporting headers are stripped).
 *   5. The postMessage direct-fallback page is served as-is; the mobile
 *      shell does not listen for 'pearbrowser:clearnet-direct-fallback'
 *      (the explanatory page still renders).
 */

const {
  sanitizeClearnetUrl,
  fingerprintFarblingScript,
  referrerPolicyMeta,
  normalizePrivacySettings
} = require('./privacy-policy.cjs')
const { escapeStyleText } = require('./html-raw-text.cjs')
const b4a = require('b4a')
// B1 injection-sink helpers. Load-order is cycle-free: hyper-proxy.js only
// requires this module lazily inside _handle, never at top level.
const { sha256ScriptBody, injectCspShimHashes } = require('./hyper-proxy.js')

const MAX_BODY_BYTES = 8 * 1024 * 1024 // 8 MiB response cap for proxy mode
const FETCH_TIMEOUT_MS = 20000
const USER_AGENT = 'PearBrowser/0.5 (clearnet-proxy; P2P browser)'
const STRIPPED_UPSTREAM_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'nel',
  'report-to',
  'reporting-endpoints',
  'transfer-encoding',
  'x-content-security-policy',
  'x-frame-options',
  'x-webkit-csp'
])

/**
 * Encode a target URL into a path segment under /clearnet/.
 * Uses base64url so path-safe.
 */
function encodeClearnetTarget (absoluteUrl) {
  const text = String(absoluteUrl || '')
  return b4a.toString(b4a.from(text, 'utf8'), 'base64url')
}

function decodeClearnetTarget (encoded) {
  try {
    const text = b4a.toString(b4a.from(String(encoded || ''), 'base64url'), 'utf8')
    const u = new URL(text)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Build the loopback local URL that the WebView loads.
 * @param {number|string} port
 * @param {string} targetUrl absolute http(s) URL
 */
function localClearnetUrl (port, targetUrl) {
  const enc = encodeClearnetTarget(targetUrl)
  return `http://127.0.0.1:${port}/clearnet/${enc}`
}

/**
 * Parse /clearnet/<encoded> or /clearnet/<encoded>/extra into target URL.
 */
function parseClearnetPath (pathname, search = '') {
  if (typeof pathname !== 'string' || !pathname.startsWith('/clearnet/')) return null
  const rest = pathname.slice('/clearnet/'.length)
  if (!rest) return null
  // encoded may contain only base64url chars; stop at first slash that is
  // not part of encoding (base64url has no '/').
  const slash = rest.indexOf('/')
  const encoded = slash === -1 ? rest : rest.slice(0, slash)
  const target = decodeClearnetTarget(encoded)
  if (!target) return null
  // Extra path after the blob is not used — full URL is in the blob.
  // search on the proxy request is ignored; target carries its own query.
  return { target, encoded, search }
}

/**
 * Recover a dynamic root-relative request using its proxied document referer.
 * Publisher scripts commonly create `/media/...` URLs at runtime, after the
 * static HTML rewrite has run. The browser resolves those against loopback;
 * this maps them back to the publisher origin without trusting a non-proxy
 * referer.
 */
function resolveClearnetFallback (referer, requestUrl, proxyOrigin) {
  try {
    const proxy = new URL(proxyOrigin)
    const ref = new URL(String(referer || ''))
    if (ref.protocol !== proxy.protocol || ref.host !== proxy.host) return null
    const parsed = parseClearnetPath(ref.pathname, ref.search)
    if (!parsed) return null
    const target = new URL(String(requestUrl || ''), parsed.target)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
    return new URL(`/clearnet/${encodeClearnetTarget(target.toString())}`, proxy)
  } catch {
    return null
  }
}

/**
 * Fetch a clearnet URL using bare-https / bare-http1 (Bare runtime) or
 * Node https/http as fallback in unit tests.
 */
function fetchClearnet (absoluteUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS
  const method = (opts.method || 'GET').toUpperCase()
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: opts.accept || '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(opts.headers || {})
  }
  // Strip hop-by-hop and absent optional headers. Header names can arrive in
  // either browser-style or Node-style casing.
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'host' || lower === 'connection' || headers[key] == null) delete headers[key]
  }

  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(absoluteUrl) } catch (err) { return reject(err) }
    const isHttps = u.protocol === 'https:'
    let lib
    try {
      lib = isHttps ? require('bare-https') : require('bare-http1')
    } catch {
      try {
        // Node fallback for the test environment. Indirect require keeps
        // bare-pack from statically traversing Node builtins that do not
        // exist in the Bare runtime.
        const nodeBuiltin = (name) => require(name)
        lib = isHttps ? nodeBuiltin('https') : nodeBuiltin('http')
      } catch (err) {
        return reject(new Error('HTTP client unavailable: ' + (err && err.message)))
      }
    }

    const req = lib.request({
      method,
      hostname: u.hostname,
      port: u.port ? parseInt(u.port, 10) : (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      headers,
      // Node https option; bare-https ignores unknown fields
      servername: u.hostname
    }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY_BYTES) {
          try { req.destroy() } catch {}
          return reject(new Error('Response too large'))
        }
        chunks.push(c)
      })
      res.on('end', () => {
        clearTimeout(timer)
        resolve({
          statusCode: res.statusCode || 200,
          headers: res.headers || {},
          body: b4a.concat(chunks)
        })
      })
      res.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
    const timer = setTimeout(() => {
      try { req.destroy() } catch {}
      reject(new Error('Clearnet fetch timed out'))
    }, timeoutMs)
    req.on('error', (err) => { clearTimeout(timer); reject(err) })
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

/**
 * Rewrite HTML so navigations and subresources stay on the clearnet proxy.
 * Relative URLs resolve against the document's real clearnet base, then are
 * re-encoded under /clearnet/<blob>.
 */
function rewriteHtmlForProxy (html, documentUrl, proxyOrigin, injectedHead = '') {
  const base = new URL(documentUrl)
  const origin = String(proxyOrigin || '').replace(/\/$/, '')

  const rewriteAttrUrl = (raw) => {
    const value = decodeHtmlCharacterReferences(String(raw || '').trim())
    if (!value || value.startsWith('#') || value.startsWith('data:') ||
        value.startsWith('blob:') || value.startsWith('javascript:') ||
        value.startsWith('mailto:') || value.startsWith('about:')) {
      return value
    }
    try {
      const abs = new URL(value, base).toString()
      if (!/^https?:/i.test(abs)) return value
      return `${origin}/clearnet/${encodeClearnetTarget(abs)}`
    } catch {
      return value
    }
  }

  // Inject <base> pointing at proxy document root so any leftover relative
  // resolution still hits our host; we also set a pear-clearnet meta.
  // Bare's URL implementation exposes protocol + host but not `.origin`.
  const documentOrigin = `${base.protocol}//${base.host}`
  const headBits =
    String(injectedHead || '') +
    `<meta name="pear-clearnet-origin" content="${escapeHtml(documentOrigin)}">` +
    `<base href="${escapeHtml(origin)}/clearnet/${encodeClearnetTarget(base.toString())}">`
  return rewriteHtmlMarkup(String(html || ''), rewriteAttrUrl, headBits)
}

function decodeHtmlCharacterReferences (value) {
  const named = {
    amp: '&',
    apos: "'",
    colon: ':',
    equals: '=',
    gt: '>',
    lt: '<',
    quot: '"',
    sol: '/'
  }
  return String(value || '')
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (full, hex, decimal) => {
      const codePoint = parseInt(hex || decimal, hex ? 16 : 10)
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10FFFF ||
          (codePoint >= 0xD800 && codePoint <= 0xDFFF)) return '�'
      return String.fromCodePoint(codePoint)
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (full, name) => named[name.toLowerCase()] || full)
}

function rewriteCssUrls (css, rewriteUrl) {
  return String(css || '').replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, quote, value) => {
    const rewritten = rewriteUrl(value.trim())
    return `url(${quote}${rewritten}${quote})`
  })
}

function replaceAttribute (tag, names, transform) {
  const re = new RegExp(
    `(\\b(?:${names})\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    'gi'
  )
  return tag.replace(re, (full, prefix, doubleValue, singleValue, bareValue) => {
    const quote = doubleValue !== undefined ? '"' : (singleValue !== undefined ? "'" : '"')
    const value = doubleValue !== undefined
      ? doubleValue
      : (singleValue !== undefined ? singleValue : bareValue)
    return `${prefix}${quote}${transform(value)}${quote}`
  })
}

function rewriteHtmlTag (tag, rewriteUrl) {
  let out = replaceAttribute(
    tag,
    'href|src|action|poster|formaction|data-src',
    rewriteUrl
  )
  out = replaceAttribute(out, 'srcset', (value) => {
    return value.split(',').map((part) => {
      const bits = part.trim().split(/\s+/)
      if (!bits[0]) return part
      bits[0] = rewriteUrl(bits[0])
      return bits.join(' ')
    }).join(', ')
  })
  return replaceAttribute(out, 'style', (value) => rewriteCssUrls(value, rewriteUrl))
}

function findHtmlTagEnd (html, start) {
  let quote = ''
  for (let i = start + 1; i < html.length; i++) {
    const char = html[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return i
    }
  }
  return -1
}

function rewriteHtmlMarkup (html, rewriteUrl, headBits) {
  const rawTextElements = new Set(['iframe', 'noembed', 'noframes', 'plaintext', 'script', 'textarea', 'title', 'xmp'])
  const lower = html.toLowerCase()
  const pieces = []
  let cursor = 0
  let headInjected = false
  let htmlInsertIndex = -1

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor)
    if (tagStart === -1) {
      pieces.push(html.slice(cursor))
      break
    }
    pieces.push(html.slice(cursor, tagStart))

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4)
      if (commentEnd === -1) {
        pieces.push(html.slice(tagStart))
        break
      }
      pieces.push(html.slice(tagStart, commentEnd + 3))
      cursor = commentEnd + 3
      continue
    }

    const tagEnd = findHtmlTagEnd(html, tagStart)
    if (tagEnd === -1) {
      pieces.push(html.slice(tagStart))
      break
    }
    const tag = html.slice(tagStart, tagEnd + 1)
    const nameMatch = tag.match(/^<\s*([a-z][a-z0-9:-]*)\b/i)
    const tagName = nameMatch ? nameMatch[1].toLowerCase() : ''
    const rewrittenTag = tagName ? rewriteHtmlTag(tag, rewriteUrl) : tag
    pieces.push(rewrittenTag)

    if (tagName === 'html' && htmlInsertIndex === -1) htmlInsertIndex = pieces.length
    if (tagName === 'head' && !headInjected) {
      pieces.push(headBits)
      headInjected = true
    }

    cursor = tagEnd + 1
    if (!tagName || (!rawTextElements.has(tagName) && tagName !== 'style')) continue

    const closingStart = lower.indexOf(`</${tagName}`, cursor)
    if (closingStart === -1) {
      const body = html.slice(cursor)
      pieces.push(tagName === 'style' ? rewriteCssUrls(body, rewriteUrl) : body)
      cursor = html.length
      break
    }
    const body = html.slice(cursor, closingStart)
    pieces.push(tagName === 'style' ? rewriteCssUrls(body, rewriteUrl) : body)
    const closingEnd = findHtmlTagEnd(html, closingStart)
    if (closingEnd === -1) {
      pieces.push(html.slice(closingStart))
      cursor = html.length
      break
    }
    pieces.push(html.slice(closingStart, closingEnd + 1))
    cursor = closingEnd + 1
  }

  if (!headInjected) {
    const head = `<head>${headBits}</head>`
    if (htmlInsertIndex >= 0) pieces.splice(htmlInsertIndex, 0, head)
    else pieces.unshift(head)
  }
  return pieces.join('')
}

function escapeHtml (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Build the HTML head injection for a clearnet document (shield + privacy).
 * Returns { htmlFragment, scriptBodies: string[] } for CSP hashing by caller.
 */
function buildClearnetInjections (opts = {}) {
  const {
    contentShield = null,
    documentUrl = '',
    documentKey = null,
    privacy = {},
    farblingSalt = 'pear'
  } = opts
  const settings = normalizePrivacySettings(privacy)
  let host = ''
  try { host = new URL(documentUrl).hostname } catch {}

  const fragments = []
  const scriptBodies = []

  const refMeta = referrerPolicyMeta(settings)
  if (refMeta) fragments.push(refMeta)

  if (contentShield && contentShield.enabled !== false) {
    // documentKey is the origin pseudo-key: an allowlisted origin gets no
    // cosmetic CSS / scriptlets, exactly like an allowlisted drive.
    const shieldOpts = documentKey ? { documentKey } : {}
    const css = contentShield.cosmeticCssFor
      ? contentShield.cosmeticCssFor(host, shieldOpts)
      : ''
    if (css) fragments.push(`<style data-pear-shield>${escapeStyleText(css)}</style>`)

    if (typeof contentShield.scriptletsFor === 'function') {
      for (const entry of contentShield.scriptletsFor(host, shieldOpts)) {
        if (entry && entry.body) {
          scriptBodies.push(entry.body)
          fragments.push(`<script data-pear-scriptlet="${escapeHtml(entry.name || 'scriptlet')}">${entry.body}</script>`)
        }
      }
    }
    if (typeof contentShield.pluginStylesFor === 'function') {
      const pcss = contentShield.pluginStylesFor(host, shieldOpts)
      if (pcss) fragments.push(`<style data-pear-plugin-style>${escapeStyleText(pcss)}</style>`)
    }
    if (typeof contentShield.pluginScriptsFor === 'function') {
      for (const entry of contentShield.pluginScriptsFor(host, shieldOpts)) {
        if (entry && entry.body) {
          scriptBodies.push(entry.body)
          fragments.push(`<script data-pear-plugin="${escapeHtml(entry.pluginId || 'plugin')}">${entry.body}</script>`)
        }
      }
    }
  }

  if (settings.fingerprintFarbling) {
    const body = fingerprintFarblingScript(farblingSalt + ':' + host)
    scriptBodies.push(body)
    fragments.push(`<script data-pear-farbling="1">${body}</script>`)
  }

  return { htmlFragment: fragments.join(''), scriptBodies }
}

function isTopLevelClearnetNavigation (req) {
  const mode = String(req.headers['sec-fetch-mode'] || '').toLowerCase()
  const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase()
  return mode === 'navigate' && (dest === 'iframe' || dest === 'document')
}

function buildClearnetDirectFallback (target) {
  const targetJson = JSON.stringify(String(target || '')).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Opening directly…</title></head>
    <body style="font-family:system-ui;padding:2rem;background:#0f1410;color:#e8efe9">
      <h1>Opening this publisher directly…</h1>
      <p>The publisher refused PearBrowser's privacy proxy. Content Shield is unavailable for this tab.</p>
      <script>(()=>{const notify=()=>window.parent.postMessage({type:'pearbrowser:clearnet-direct-fallback',url:${targetJson}},'*');notify();setTimeout(notify,250);setTimeout(notify,1000)})()</script>
    </body></html>`
}

/**
 * Handle a /clearnet/* request end-to-end.
 * @returns {Promise<boolean>} true if handled
 */
async function handleClearnetRequest (req, res, urlObj, deps = {}) {
  const parsed = parseClearnetPath(urlObj.pathname, urlObj.search)
  if (!parsed) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain')
    res.end('Invalid clearnet target')
    return true
  }

  const privacy = normalizePrivacySettings(deps.privacy || {})
  const sanitized = sanitizeClearnetUrl(parsed.target, privacy)
  let target = sanitized.url

  // Origin pseudo-key — the clearnet equivalent of the drive-scoped token's
  // documentKey. Same `pear.origin.v1:` derivation issueOriginToken() uses,
  // supplied by the proxy via deps.documentKeyFor. Null when unwired
  // (unit tests) — decisions then behave exactly like the desktop's {}.
  const documentKeyFor = typeof deps.documentKeyFor === 'function'
    ? deps.documentKeyFor
    : () => null
  let documentKey = documentKeyFor(target)

  // Content Shield network block before any clearnet fetch
  if (deps.contentShield && deps.contentShield.enabled !== false) {
    const verdict = deps.contentShield.shouldBlockUrl(target, { documentKey })
    if (verdict.blocked) {
      res.statusCode = 403
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('X-Pear-Shield', 'blocked')
      res.end('Blocked by PearBrowser Shield')
      return true
    }
  }

  const proxyOrigin = deps.proxyOrigin || `http://127.0.0.1:${deps.port || 0}`
  const fetchFn = deps.fetchClearnet || fetchClearnet
  const upstreamHeaders = {
    'User-Agent': req.headers['user-agent'] || USER_AGENT,
    Accept: req.headers.accept || 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9'
  }
  if (req.headers.range) upstreamHeaders.Range = req.headers.range
  if (req.headers['content-type']) upstreamHeaders['Content-Type'] = req.headers['content-type']

  try {
    let response = await fetchFn(target, {
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: upstreamHeaders
    })

    // Follow a small number of redirects, re-checking the shield each hop.
    let hops = 0
    while (response.statusCode >= 300 && response.statusCode < 400 && hops < 5) {
      const loc = response.headers.location || response.headers.Location
      if (!loc) break
      let next
      try { next = new URL(loc, target).toString() } catch { break }
      const nextSan = sanitizeClearnetUrl(next, privacy)
      next = nextSan.url
      const nextKey = documentKeyFor(next)
      if (deps.contentShield && deps.contentShield.enabled !== false) {
        const v = deps.contentShield.shouldBlockUrl(next, { documentKey: nextKey })
        if (v.blocked) {
          res.statusCode = 403
          res.setHeader('X-Pear-Shield', 'blocked')
          res.end('Blocked by PearBrowser Shield (redirect)')
          return true
        }
      }
      target = next
      documentKey = nextKey
      response = await fetchFn(target, { method: 'GET', headers: upstreamHeaders })
      hops++
    }

    const contentType = String(
      response.headers['content-type'] ||
      response.headers['Content-Type'] ||
      'application/octet-stream'
    ).toLowerCase()
    const useDirectFallback = response.statusCode === 403 && isTopLevelClearnetNavigation(req)

    res.statusCode = useDirectFallback ? 200 : (response.statusCode || 200)
    res.setHeader('X-Pear-Clearnet', '1')
    res.setHeader('X-Pear-Clearnet-Url', target)
    if (useDirectFallback) res.setHeader('X-Pear-Clearnet-Fallback', 'direct')
    // Do not forward Set-Cookie by default in proxy mode when third-party
    // cookie blocking is on — partitions clearnet cookie jar from hyper.
    const blockCookies = privacy.blockThirdPartyCookies !== false
    for (const [key, value] of Object.entries(response.headers || {})) {
      const lower = key.toLowerCase()
      if (STRIPPED_UPSTREAM_HEADERS.has(lower)) continue
      if (blockCookies && (lower === 'set-cookie' || lower === 'set-cookie2')) continue
      try { res.setHeader(key, value) } catch {}
    }

    let body = response.body
    if (useDirectFallback) {
      body = b4a.from(buildClearnetDirectFallback(target), 'utf8')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Referrer-Policy', 'no-referrer')
    } else if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      let html = b4a.toString(body, 'utf8')
      const inj = buildClearnetInjections({
        contentShield: deps.contentShield,
        documentUrl: target,
        documentKey,
        privacy,
        farblingSalt: deps.farblingSalt || 'pear'
      })
      html = rewriteHtmlForProxy(html, target, proxyOrigin, inj.htmlFragment)

      // Hash-authorize the exact inline scripts we injected (scriptlets,
      // farbling) against the page's own meta CSP — B1's sink, reused. No
      // 'unsafe-inline' is ever added; pages without a meta CSP are untouched.
      const scriptHashes = []
      for (const scriptBody of inj.scriptBodies) {
        const hash = sha256ScriptBody(`<script>${scriptBody}</script>`)
        if (hash) scriptHashes.push(hash)
      }
      if (scriptHashes.length > 0) {
        html = injectCspShimHashes(html, scriptHashes)
      }

      // Per-origin strict mode (user opt-in via the pseudo-key): confine the
      // page to its own (proxied) origin with the shield's strict CSP meta.
      // On-proxy every subresource is 'self', so this is meaningful here.
      if (deps.contentShield && documentKey &&
          typeof deps.contentShield.isStrict === 'function' &&
          deps.contentShield.isStrict(documentKey)) {
        const strictMeta =
          `<meta http-equiv="Content-Security-Policy" content="` +
          `${deps.contentShield.strictCspContent(scriptHashes)}" data-pear-shield-strict="1">`
        html = html.includes('<head>')
          ? html.replace('<head>', `<head>${strictMeta}`)
          : html.replace(/<html>/i, `<html><head>${strictMeta}</head>`)
      }

      body = b4a.from(html, 'utf8')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
    } else if (contentType.includes('text/css')) {
      // Rewrite url() in stylesheets
      const base = new URL(target)
      const css = rewriteCssUrls(b4a.toString(body, 'utf8'), (val) => {
        const value = String(val || '').trim()
        if (!value || value.startsWith('data:')) return value
        try {
          const abs = new URL(value, base).toString()
          if (!/^https?:/i.test(abs)) return value
          return `${proxyOrigin}/clearnet/${encodeClearnetTarget(abs)}`
        } catch {
          return value
        }
      })
      body = b4a.from(css, 'utf8')
      res.setHeader('Content-Type', 'text/css; charset=utf-8')
    } else if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', contentType)
    }

    res.setHeader('Content-Length', body.length)
    res.end(body)
    return true
  } catch (err) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><meta charset="utf-8"><title>Clearnet error</title>
      <body style="font-family:system-ui;padding:2rem;background:#0f1410;color:#e8efe9">
      <h1>Could not load page</h1>
      <p>${escapeHtml(err && err.message ? err.message : String(err))}</p>
      <p style="opacity:.7">Target: ${escapeHtml(target)}</p>
      <p style="opacity:.7">PearBrowser clearnet proxy · shield and privacy ladder still apply.</p>
      </body>`)
    return true
  }
}

module.exports = {
  encodeClearnetTarget,
  decodeClearnetTarget,
  localClearnetUrl,
  parseClearnetPath,
  resolveClearnetFallback,
  fetchClearnet,
  rewriteHtmlForProxy,
  buildClearnetInjections,
  buildClearnetDirectFallback,
  handleClearnetRequest,
  MAX_BODY_BYTES,
  USER_AGENT
}
