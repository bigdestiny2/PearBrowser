'use strict'

/**
 * Content Shield Phase 2 tests (named lists, durable state, per-drive
 * allowlist/strict, scriptlets, plugin-contribution engine surface) —
 * ported from pearbrowser-desktop/test/content-shield-phase2.test.js
 * (converted to this repo's CJS test style).
 *
 * The plugin-capability methods are engine-level: Mission B4a landed the
 * PLUGIN_* RPC commands (desktop ids 235–237/242–247) on top of this
 * surface — these tests pin the engine semantics the registry drives.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  ContentShield,
  parseFilterList,
  compileScriptlet,
  PLUGIN_LIST_PREFIX
} = require('../backend/content-shield.cjs')

const DRIVE_A = 'a'.repeat(64)
const DRIVE_B = 'b'.repeat(64)

test('named multi-list hot-swap replaces rules without restart', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('easylist', '||ads.old.example^')
  assert.equal(shield.shouldBlockUrl('https://ads.old.example/x').blocked, true)

  // Hot-swap: same name, new text
  const meta = shield.addList('easylist', '||ads.new.example^\n##.promo')
  assert.equal(meta.name, 'easylist')
  assert.equal(meta.blockRules, 1)
  assert.equal(shield.shouldBlockUrl('https://ads.old.example/x').blocked, false)
  assert.equal(shield.shouldBlockUrl('https://ads.new.example/x').blocked, true)
  assert.match(shield.cosmeticCssFor('anything'), /\.promo/)
  assert.deepEqual(shield.listNames(), ['easylist'])
})

test('exportListState / importListState reloads durable lists offline', () => {
  const live = new ContentShield({ builtinList: false })
  live.addList('pear-native', '||tracker.pear.example^\n##.pear-ad')
  live.allowlistDrive(DRIVE_A)
  live.setStrictDrive(DRIVE_B, true)
  live.setPluginEnabled('demo-plugin', false)

  const snapshot = live.exportListState()
  assert.ok(snapshot.lists['pear-native'])
  assert.ok(snapshot.lists['pear-native'].includes('tracker.pear.example'))
  assert.deepEqual(snapshot.allowlist, [DRIVE_A])
  assert.deepEqual(snapshot.strict, [DRIVE_B])
  assert.equal(snapshot.plugins['demo-plugin'], false)
  // Builtin is never exported as durable text
  assert.equal(snapshot.lists.builtin, undefined)

  // Fresh engine with only builtin — then rehydrate offline
  const cold = new ContentShield()
  assert.equal(cold.shouldBlockUrl('https://tracker.pear.example/pixel').blocked, false)
  const { loaded } = cold.importListState(snapshot)
  assert.equal(loaded, 1)
  assert.equal(cold.shouldBlockUrl('https://tracker.pear.example/pixel').blocked, true)
  assert.match(cold.cosmeticCssFor('x'), /\.pear-ad/)
  assert.equal(cold.isAllowlisted(DRIVE_A), true)
  assert.equal(cold.isStrict(DRIVE_B), true)
  assert.equal(cold.isPluginEnabled('demo-plugin'), false)
  // Builtin still present after import
  assert.equal(cold.shouldBlockUrl('https://stats.doubleclick.net/x').blocked, true)
})

test('per-drive allowlist exempts only the named drive', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', '||doubleclick.net^')
  shield.allowlistDrive(DRIVE_A)

  assert.equal(
    shield.shouldBlockUrl(`hyper://${DRIVE_A}/vendor/doubleclick.net/ad.js`, { documentKey: DRIVE_A }).blocked,
    false
  )
  assert.equal(
    shield.shouldBlockUrl(`hyper://${DRIVE_A}/vendor/doubleclick.net/ad.js`, { documentKey: DRIVE_A }).allowlisted,
    true
  )
  assert.equal(
    shield.shouldBlockUrl(`hyper://${DRIVE_B}/vendor/doubleclick.net/ad.js`, { documentKey: DRIVE_B }).blocked,
    true
  )
  // Without documentKey, drive is extracted from hyper:// URL
  assert.equal(
    shield.shouldBlockUrl(`hyper://${DRIVE_A}/vendor/doubleclick.net/ad.js`).blocked,
    false
  )
  assert.equal(shield.cosmeticCssFor(DRIVE_A, { documentKey: DRIVE_A }), '')
  shield.addList('cosmetic', '##.ad')
  assert.equal(shield.cosmeticCssFor(DRIVE_A, { documentKey: DRIVE_A }), '')
  assert.match(shield.cosmeticCssFor(DRIVE_B, { documentKey: DRIVE_B }), /\.ad/)
})

test('strict mode produces confining CSP content', () => {
  const shield = new ContentShield({ builtinList: false })
  assert.equal(shield.isStrict(DRIVE_A), false)
  shield.setStrictDrive(DRIVE_A, true)
  assert.equal(shield.isStrict(DRIVE_A), true)
  assert.equal(shield.isStrict(DRIVE_B), false)

  const csp = shield.strictCspContent(['abc123hash'])
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /script-src 'self' 'sha256-abc123hash'/)
  assert.match(csp, /img-src 'self' data: blob:/)
  assert.match(csp, /connect-src 'self'/)
  assert.match(csp, /object-src 'none'/)
  // No wildcard third-party
  assert.doesNotMatch(csp, /\*/)

  shield.setStrictDrive(DRIVE_A, false)
  assert.equal(shield.isStrict(DRIVE_A), false)
})

test('scriptlet parsing and compile for set-constant / abort-on-property-read', () => {
  const parsed = parseFilterList(`
##+js(set-constant, ads.enabled, false)
tracker.example##+js(abort-on-property-read, ads.detect)
##+js(unknown-scriptlet, x)
`)
  assert.equal(parsed.scriptlets.length, 2)
  assert.equal(parsed.scriptlets[0].name, 'set-constant')
  assert.deepEqual(parsed.scriptlets[0].args, ['ads.enabled', 'false'])
  assert.equal(parsed.scriptlets[0].host, null)
  assert.equal(parsed.scriptlets[1].host, 'tracker.example')

  const body = compileScriptlet(parsed.scriptlets[0])
  assert.match(body, /ads\.enabled/)
  assert.match(body, /false/)

  const abort = compileScriptlet(parsed.scriptlets[1])
  assert.match(abort, /ReferenceError/)
  assert.match(abort, /ads\.detect/)
})

test('scriptletsFor scopes by host and respects allowlist', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('s', `
##+js(set-constant, globalAd, false)
tracker.example##+js(abort-on-property-read, fingerprint)
`)
  const global = shield.scriptletsFor('unrelated.net')
  assert.equal(global.length, 1)
  assert.equal(global[0].name, 'set-constant')
  assert.ok(global[0].body)

  const scoped = shield.scriptletsFor('www.tracker.example')
  assert.equal(scoped.length, 2)

  shield.allowlistDrive(DRIVE_A)
  assert.deepEqual(shield.scriptletsFor('tracker.example', { documentKey: DRIVE_A }), [])
})

test('plugin contributions are namespaced, fail-closed without caps, kill-switchable', () => {
  const shield = new ContentShield({ builtinList: false })

  // No capabilities → no effect
  const denied = shield.applyPluginContribution('plug-a', {
    filters: '||evil-ads.example^',
    styles: { matches: ['*'], css: '.evil { display:none }' },
    scripts: { matches: ['*'], js: 'window.__plug=1' }
  }, [])
  assert.equal(denied.ok, true)
  assert.equal(denied.applied.filters, false)
  assert.equal(shield.shouldBlockUrl('https://evil-ads.example/x').blocked, false)

  // With capabilities → rules land under plugin: namespace
  const ok = shield.applyPluginContribution('plug-a', {
    filters: '||evil-ads.example^',
    styles: { matches: ['*'], css: '.evil { display:none !important; }' },
    scripts: { matches: ['site.example'], js: 'window.__plug=1' }
  }, ['pear.net.filter', 'pear.content.styles', 'pear.content.scripts'])
  assert.equal(ok.applied.filters, true)
  assert.equal(ok.applied.styles, true)
  assert.equal(ok.applied.scripts, true)
  assert.ok(shield.listNames().includes(PLUGIN_LIST_PREFIX + 'plug-a'))
  assert.equal(shield.shouldBlockUrl('https://evil-ads.example/x').blocked, true)
  assert.match(shield.pluginStylesFor('anything'), /\.evil/)
  assert.equal(shield.pluginScriptsFor('site.example').length, 1)
  assert.equal(shield.pluginScriptsFor('other.example').length, 0)

  // Kill switch strips network rules and skips style/script inject
  shield.setPluginEnabled('plug-a', false)
  assert.equal(shield.shouldBlockUrl('https://evil-ads.example/x').blocked, false)
  assert.equal(shield.pluginStylesFor('anything'), '')
  assert.deepEqual(shield.pluginScriptsFor('site.example'), [])

  // Re-apply after re-enable
  shield.setPluginEnabled('plug-a', true)
  shield.applyPluginContribution('plug-a', {
    filters: '||evil-ads.example^',
    styles: { matches: ['*'], css: '.evil { display:none !important; }' },
    scripts: { matches: ['site.example'], js: 'window.__plug=1' }
  }, ['pear.net.filter', 'pear.content.styles', 'pear.content.scripts'])
  assert.equal(shield.shouldBlockUrl('https://evil-ads.example/x').blocked, true)
})

test('stats expose list details, allowlist, strict, scriptlets', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('mine', '||x.example^\n##+js(set-constant, a, 1)\n##.ad')
  shield.allowlistDrive(DRIVE_A)
  shield.setStrictDrive(DRIVE_B, true)
  const s = shield.stats()
  assert.equal(s.enabled, true)
  assert.ok(s.lists.includes('mine'))
  assert.ok(s.listDetails.some((d) => d.name === 'mine' && d.durable === true))
  assert.ok(s.scriptletRules >= 1)
  assert.deepEqual(s.allowlist, [DRIVE_A])
  assert.deepEqual(s.strict, [DRIVE_B])
})
