'use strict'

/**
 * Privacy-first defaults — ported from
 * pearbrowser-desktop/test/privacy-defaults.test.js (Mission B2).
 *
 * Mobile adaptation: the desktop's UI-wiring test asserts on ui/shell.js;
 * here the same surface is the Android native SettingsScreen.kt, and the
 * backend assertions target the mobile backend/index.js.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  DEFAULT_PRIVACY,
  mergeSettingsWithPrivacyDefaults,
  isHistoryEnabled,
  isSearchIndexEnabled,
  normalizePrivacySettings
} = require('../backend/privacy-policy.cjs')
const { ContentShield } = require('../backend/content-shield.cjs')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

test('privacy defaults: history off, search index off, telemetry never, shield on', () => {
  assert.equal(DEFAULT_PRIVACY.historyEnabled, false)
  assert.equal(DEFAULT_PRIVACY.searchIndexEnabled, false)
  assert.equal(DEFAULT_PRIVACY.telemetryEnabled, false)
  assert.equal(DEFAULT_PRIVACY.contentShield, true)

  const merged = mergeSettingsWithPrivacyDefaults({})
  assert.equal(merged.historyEnabled, false)
  assert.equal(merged.searchIndexEnabled, false)
  assert.equal(merged.telemetryEnabled, false)
  assert.equal(merged.contentShield, true)

  assert.equal(isHistoryEnabled({}), false)
  assert.equal(isHistoryEnabled({ historyEnabled: true }), true)
  assert.equal(isSearchIndexEnabled({}), false)
  assert.equal(isSearchIndexEnabled({ searchIndexEnabled: true }), true)

  // Telemetry can never be forced on via normalize
  assert.equal(normalizePrivacySettings({ telemetryEnabled: true }).telemetryEnabled, false)
})

test('unset contentShield stays on; explicit false disables', () => {
  assert.equal(mergeSettingsWithPrivacyDefaults({}).contentShield, true)
  assert.equal(mergeSettingsWithPrivacyDefaults({ contentShield: false }).contentShield, false)
})

test('clearnet ladder defaults: proxied mode with every rung on', () => {
  const p = normalizePrivacySettings({})
  assert.equal(p.clearnetMode, 'proxy')
  assert.equal(p.httpsOnly, true)
  assert.equal(p.stripTrackingParams, true)
  assert.equal(p.blockThirdPartyCookies, true)
  assert.equal(p.fingerprintFarbling, true)
  assert.equal(p.referrerPolicy, 'strict-origin-when-cross-origin')
})

test('builtin shield blocks expanded ad/tracker set and ships cosmetics', () => {
  const shield = new ContentShield()
  const cases = [
    'https://stats.doubleclick.net/pixel',
    'https://www.googletagmanager.com/gtm.js',
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'https://connect.facebook.net/en_US/fbevents.js',
    'https://cdn.segment.com/analytics.js',
    'https://static.hotjar.com/c/hotjar.js',
    'https://bat.bing.com/bat.js',
    'https://ads.linkedin.com/li.lms',
    'https://trc.taboola.com/x',
    'https://cdn.taboola.com/libtrc.js',
    'https://sb.scorecardresearch.com/beacon.js',
    'https://cdn.mxpnl.com/libs/mixpanel.js',
    'https://bam.nr-data.net/1',
    'https://app.appsflyer.com/x',
    'https://aax.amazon-adsystem.com/e/dtb'
  ]
  for (const url of cases) {
    assert.equal(shield.shouldBlockUrl(url).blocked, true, `expected block: ${url}`)
  }
  assert.equal(shield.shouldBlockUrl('https://example.com/blog/post').blocked, false)
  assert.equal(shield.shouldBlockUrl('https://news.example/article').blocked, false)
  const css = shield.cosmeticCssFor('example.com')
  assert.match(css, /\.adsbygoogle/)
  assert.match(css, /\.OUTBRAIN|\.taboola-container|\.ad-banner/)
  const stats = shield.stats()
  assert.ok(stats.blockRules > 40, `expected broad seed list, got ${stats.blockRules}`)
})

test('shield stats never retain URLs (counters only)', () => {
  const shield = new ContentShield()
  shield.shouldBlockUrl('https://doubleclick.net/ad?secret=token')
  const stats = shield.stats()
  assert.ok(stats.blocked >= 1)
  const blob = JSON.stringify(stats)
  assert.doesNotMatch(blob, /secret=token/)
  assert.doesNotMatch(blob, /https:\/\/doubleclick/)
})

test('Android Settings wires the ladder toggles and zero-collection copy', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /ClearnetPrivacySection\(\)/, 'Clearnet & Privacy section not routed into SettingsScreen')
  assert.match(screen, /"Clearnet & Privacy"/, 'card title missing')
  assert.match(screen, /httpsOnly/, 'https-only toggle missing')
  assert.match(screen, /stripTrackingParams/, 'tracking-strip toggle missing')
  assert.match(screen, /blockThirdPartyCookies/, 'cookie toggle missing')
  assert.match(screen, /fingerprintFarbling/, 'farbling toggle missing')
  assert.match(screen, /clearnetMode/, 'clearnet mode toggle missing')
  assert.match(screen, /Telemetry: never/, 'zero-collection copy missing')
  assert.match(screen, /getPrivacyStatus\(/, 'PRIVACY_STATUS read missing')
  assert.match(screen, /setSettings\(/, 'settings write path missing')

  const index = read('backend/index.js')
  assert.match(index, /applyPrivacyFromSettings/, 'live privacy apply missing')
  assert.match(index, /mergeSettingsWithPrivacyDefaults/, 'privacy defaults merge missing')
  assert.match(index, /telemetryEnabled: false/, 'telemetry-never assertion missing')
  assert.match(index, /dataCollection/, 'dataCollection block missing')
})
