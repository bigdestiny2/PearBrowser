'use strict'

/**
 * Session bridge facade (BROWSER_PARITY_PLAN.md Phase 4 Layer 3) — mobile port.
 *
 * Ported from pearbrowser-desktop backend/session-bridge.cjs (Mission B2).
 * WKWebView / Android WebView expose no session.webRequest equivalent to app
 * code, so the browser-owned clearnet proxy is the shield path. This module
 * is the transport-independent contract that:
 *   1. Routes clearnet navigations through the browser-owned clearnet proxy
 *      (Layer 1 equivalent for https://), evaluated by ContentShield.
 *   2. Accepts an optional external webRequest evaluator if a future native
 *      bridge lands — same ContentShield.shouldBlockUrl API.
 *
 * UI and RPC call this module rather than hyper-proxy details so the
 * session bridge can swap implementations without rewriting chrome.
 */

const {
  classifyUrl,
  sanitizeClearnetUrl,
  normalizePrivacySettings,
  normalizeNavigationInput
} = require('./privacy-policy.cjs')
const {
  localClearnetUrl,
  encodeClearnetTarget
} = require('./clearnet-proxy.cjs')

class SessionBridge {
  /**
   * @param {object} opts
   * @param {() => import('./content-shield.cjs').ContentShield|null} [opts.getShield]
   * @param {() => object} [opts.getPrivacy]
   * @param {() => number} [opts.getProxyPort]
   * @param {(filter: object, handler: Function) => Function} [opts.onBeforeRequest]
   *   Optional native session hook (future). Return unsubscribe.
   */
  constructor (opts = {}) {
    this._getShield = opts.getShield || (() => null)
    this._getPrivacy = opts.getPrivacy || (() => ({}))
    this._getProxyPort = opts.getProxyPort || (() => 0)
    this._onBeforeRequest = opts.onBeforeRequest || null
    this._nativeAttached = false
    this._unsubscribeNative = null
  }

  get privacy () {
    return normalizePrivacySettings(this._getPrivacy())
  }

  /**
   * Resolve a user navigation target into a loadable tab descriptor.
   * @param {string} rawUrl
   * @returns {{ kind, url, localUrl, upgraded?, stripped?, mode? }}
   */
  resolveNavigation (rawUrl) {
    const privacy = this.privacy
    const normalized = normalizeNavigationInput(rawUrl, privacy)
    if (!normalized) throw new Error('Empty URL')

    const kind = classifyUrl(normalized)
    if (kind === 'hyper') {
      return { kind: 'hyper', url: normalized, localUrl: null }
    }
    if (kind === 'loopback') {
      return { kind: 'loopback', url: normalized, localUrl: normalized }
    }
    if (kind !== 'clearnet') {
      throw new Error('Unsupported URL scheme for browsing')
    }

    const { url, upgraded, stripped } = sanitizeClearnetUrl(normalized, privacy)
    const mode = privacy.clearnetMode === 'direct' ? 'direct' : 'proxy'

    if (mode === 'direct') {
      // Direct load of the real https URL in the WebView. Shields never see
      // the platform net stack — Android WebView / WKWebView have no request
      // interception, so without the proxy no shielding is possible.
      return {
        kind: 'clearnet',
        url,
        localUrl: url,
        mode: 'direct',
        upgraded,
        stripped,
        shieldActive: false,
        note: 'direct clearnet: network shields unavailable (no WebView request interception)'
      }
    }

    const port = this._getProxyPort()
    if (!port) throw new Error('Proxy not ready for clearnet')
    return {
      kind: 'clearnet',
      url,
      localUrl: localClearnetUrl(port, url),
      mode: 'proxy',
      upgraded,
      stripped,
      shieldActive: true,
      encoded: encodeClearnetTarget(url)
    }
  }

  /**
   * Evaluate a network request the way session.webRequest onBeforeRequest would.
   * Used by the clearnet proxy today and by a native bridge tomorrow.
   * @returns {{ cancel: boolean, rule: string|null }}
   */
  shouldBlockRequest (details = {}) {
    const shield = this._getShield()
    if (!shield || shield.enabled === false) return { cancel: false, rule: null }
    const url = details.url || details.requestUrl || ''
    const documentKey = details.documentKey || details.tabDriveKey || null
    const verdict = shield.shouldBlockUrl(url, { documentKey })
    return { cancel: !!verdict.blocked, rule: verdict.rule || null }
  }

  /**
   * Attach to a native onBeforeRequest implementation when available.
   * No-op if opts.onBeforeRequest was not provided.
   */
  attachNativeSession () {
    if (this._nativeAttached || typeof this._onBeforeRequest !== 'function') {
      return { ok: false, reason: this._nativeAttached ? 'already-attached' : 'no-native-bridge' }
    }
    this._unsubscribeNative = this._onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const decision = this.shouldBlockRequest(details)
      if (typeof callback === 'function') callback({ cancel: decision.cancel })
      return { cancel: decision.cancel }
    })
    this._nativeAttached = true
    return { ok: true }
  }

  detachNativeSession () {
    if (typeof this._unsubscribeNative === 'function') {
      try { this._unsubscribeNative() } catch {}
    }
    this._unsubscribeNative = null
    this._nativeAttached = false
  }

  status () {
    return {
      nativeBridge: this._nativeAttached,
      hasNativeHook: typeof this._onBeforeRequest === 'function',
      privacy: this.privacy,
      proxyPort: this._getProxyPort()
    }
  }
}

module.exports = {
  SessionBridge
}
