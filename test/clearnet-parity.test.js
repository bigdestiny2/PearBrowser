'use strict'

/**
 * Clearnet & privacy-ladder mobile parity audit (Mission B2).
 *
 * Asserts the shipped surfaces line up: the ported backend modules, the
 * hyper-proxy chokepoints, CMD_NAVIGATE session routing, the PRIVACY_STATUS
 * session block, the Android Protocol.kt mirror + RPC wrappers, the
 * Settings "Clearnet & Privacy" section, and the BrowseScreen proxy
 * integration.
 *
 * Command ids: B2 adds NO new commands — the desktop's only privacy-ladder
 * id is CMD_PRIVACY_STATUS = 238 (mirrored since B1), and the direct/proxied
 * toggle is the `clearnetMode` settings key via CMD_USERDATA_SET_SETTINGS.
 * This suite pins that contract so a future drift is loud.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Backend module loads pull bare-* modules; stub them for plain Node.
require('./_stubs')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

test('privacy command ids match the desktop numbering (238 only; nothing new)', () => {
  const backend = require('../backend/constants')
  assert.equal(backend.CMD_PRIVACY_STATUS, 238, 'backend CMD_PRIVACY_STATUS id mismatch')
  // No clearnet-specific command exists on the desktop — the toggle is a
  // settings key. Guard against inventing one.
  for (const name of Object.keys(backend)) {
    assert.doesNotMatch(name, /CMD_CLEARNET/, `unexpected clearnet command ${name}`)
  }

  const protocol = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt')
  assert.match(protocol, /\bPRIVACY_STATUS\b[^0-9]+238\b/, 'Protocol.kt: PRIVACY_STATUS id mismatch')
})

test('ported backend modules ship the desktop exports', () => {
  const privacy = require('../backend/privacy-policy.cjs')
  for (const fn of [
    'normalizePrivacySettings', 'mergeSettingsWithPrivacyDefaults',
    'isHistoryEnabled', 'isSearchIndexEnabled', 'classifyUrl',
    'sanitizeClearnetUrl', 'fingerprintFarblingScript', 'referrerPolicyMeta',
    'looksLikeClearnetHost', 'normalizeNavigationInput'
  ]) {
    assert.equal(typeof privacy[fn], 'function', `privacy-policy.${fn} missing`)
  }
  assert.ok(privacy.DEFAULT_PRIVACY, 'DEFAULT_PRIVACY missing')

  const clearnet = require('../backend/clearnet-proxy.cjs')
  for (const fn of [
    'encodeClearnetTarget', 'decodeClearnetTarget', 'localClearnetUrl',
    'parseClearnetPath', 'resolveClearnetFallback', 'fetchClearnet',
    'rewriteHtmlForProxy', 'buildClearnetInjections',
    'buildClearnetDirectFallback', 'handleClearnetRequest'
  ]) {
    assert.equal(typeof clearnet[fn], 'function', `clearnet-proxy.${fn} missing`)
  }
  assert.equal(clearnet.MAX_BODY_BYTES, 8 * 1024 * 1024, '8 MiB body cap changed')

  const { SessionBridge } = require('../backend/session-bridge.cjs')
  for (const fn of ['resolveNavigation', 'shouldBlockRequest', 'attachNativeSession', 'status']) {
    assert.equal(typeof SessionBridge.prototype[fn], 'function', `SessionBridge.${fn} missing`)
  }
})

test('hyper-proxy ships the clearnet chokepoints and origin pseudo-key', () => {
  const proxy = read('backend/hyper-proxy.js')
  assert.match(proxy, /setClearnetHandler/, 'setClearnetHandler missing')
  assert.match(proxy, /setPrivacySettings/, 'setPrivacySettings missing')
  assert.match(proxy, /path\.startsWith\('\/clearnet\/'\)/, '/clearnet/ route missing')
  assert.match(proxy, /resolveClearnetFallback/, 'dynamic-root fallback missing')
  assert.match(proxy, /documentKeyFor/, 'documentKey threading missing')
  assert.match(proxy, /originPseudoKey/, 'origin pseudo-key derivation missing')
  assert.match(proxy, /pear\.origin\.v1:/, 'v1 domain separator missing')
  assert.match(proxy, /_documentKeyForClearnetUrl/, 'clearnet documentKey helper missing')
})

test('backend wires session bridge routing, live privacy, and the status session block', () => {
  const index = read('backend/index.js')
  assert.match(index, /new SessionBridge\(/, 'SessionBridge not constructed at boot')
  assert.match(index, /sessionBridge\.resolveNavigation/, 'CMD_NAVIGATE session routing missing')
  assert.match(index, /kind: 'clearnet'/, 'clearnet navigate response missing')
  assert.match(index, /kind: 'loopback'/, 'loopback navigate response missing')
  assert.match(index, /applyPrivacyFromSettings\(settings\)/, 'settings live-apply missing')
  assert.match(index, /proxy\.setPrivacySettings/, 'proxy privacy push missing')
  assert.match(index, /session: sessionBridge/, 'PRIVACY_STATUS session block missing')
  assert.match(index, /rpc\.handle\(C\.CMD_PRIVACY_STATUS/, 'PRIVACY_STATUS handler missing')
})

test('clearnet-proxy mirrors the desktop trust model', () => {
  const src = read('backend/clearnet-proxy.cjs')
  assert.match(src, /X-Pear-Shield', 'blocked'/, 'block-before-fetch header missing')
  assert.match(src, /MAX_BODY_BYTES = 8 \* 1024 \* 1024/, '8 MiB cap missing')
  assert.match(src, /STRIPPED_UPSTREAM_HEADERS/, 'upstream header strip missing')
  assert.match(src, /content-security-policy/, 'upstream CSP strip missing')
  assert.match(src, /set-cookie/, 'third-party cookie drop missing')
  assert.match(src, /sanitizeClearnetUrl/, 'tracking-strip/https-only hook missing')
  assert.match(src, /injectCspShimHashes/, 'B1 meta-CSP hash sink not reused')
  assert.match(src, /sha256ScriptBody/, 'B1 script hashing sink not reused')
  assert.match(src, /strictCspContent/, 'per-origin strict CSP missing')
  // The generated policy is asserted unsafe-inline-free in
  // clearnet-proxy.test.js (the word itself appears in doc comments here
  // explaining why it is never emitted).
})

test('Android RPC clients expose the privacy wrappers', () => {
  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  assert.match(client, /Cmd\.PRIVACY_STATUS\b/, 'PearRpcClient must call Cmd.PRIVACY_STATUS')
  assert.match(client, /suspend fun getPrivacyStatus\b/, 'PearRpcClient.getPrivacyStatus missing')
  assert.match(client, /data class PearPrivacyStatus\b/, 'PearPrivacyStatus model missing')

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(rpc, /getPrivacyStatus[\s\S]*Cmd\.PRIVACY_STATUS/, 'PearRpc getPrivacyStatus helper missing shared id')
})

test('Android Settings ships the Clearnet & Privacy section', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /ClearnetPrivacySection\(\)/, 'section not routed into SettingsScreen')
  assert.match(screen, /"Clearnet & Privacy"/, 'card title missing')
  assert.match(screen, /getPrivacyStatus\(/, 'status read missing')
  assert.match(screen, /clearnetMode/, 'mode toggle missing')
  assert.match(screen, /httpsOnly/, 'https-only toggle missing')
  assert.match(screen, /stripTrackingParams/, 'tracking-strip toggle missing')
  assert.match(screen, /blockThirdPartyCookies/, 'cookie toggle missing')
  assert.match(screen, /fingerprintFarbling/, 'farbling toggle missing')
  assert.match(screen, /Proxy \+ shield/, 'proxied mode label missing')
  assert.match(screen, /"direct"/, 'direct mode value missing')
})

test('BrowseScreen navigates http(s) through the session bridge', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt')
  assert.match(screen, /isHttpOrHttpsUrl\(target\)[\s\S]{0,1500}client\.navigate\(target\)/,
    'http(s) branch must resolve through CMD_NAVIGATE')
  assert.match(screen, /kind == "clearnet" && mode == "proxy"/, 'proxied-mode detection missing')
  assert.match(screen, /clearnetProxyActive/, 'proxy-mode WebViewClient state missing')
  assert.match(screen, /onHyperNavigate\(url\)/, 'off-proxy re-navigation missing')
  assert.match(screen, /loopbackUrlPort/, 'clearnet localUrl port validation missing')
})
