'use strict'

/**
 * Content Shield mobile parity audit (Mission B1).
 *
 * Asserts the shipped surfaces line up: backend command ids, Android
 * Protocol.kt mirror, RPC client wrappers on both Kotlin clients, backend
 * handlers, hyper-proxy chokepoints, the Android Settings section, and the
 * pear-default seed list (with a live sha256 check against its manifest).
 *
 * iOS / RN shells are deliberately out of scope for B1 (no ios-native/ or
 * app/ changes), so unlike settings-parity.test.js this checks the Android
 * mirror only.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

const shieldCommands = {
  SHIELD_STATUS: 230,
  SHIELD_LOAD_LIST: 231,
  SHIELD_REMOVE_LIST: 232,
  SHIELD_SET_ALLOW: 233,
  SHIELD_SET_STRICT: 234,
  PRIVACY_STATUS: 238,
  SHIELD_SUBSCRIBE_LIST: 239,
  SHIELD_UNSUBSCRIBE_LIST: 240,
  SHIELD_REFRESH_LISTS: 241
}

test('shield command ids match the desktop numbering in backend constants', () => {
  const backend = require('../backend/constants')
  for (const [name, id] of Object.entries(shieldCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend CMD_${name} id mismatch`)
  }
})

test('Android Protocol.kt mirrors the shield command ids', () => {
  const protocol = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt')
  for (const [name, id] of Object.entries(shieldCommands)) {
    assert.match(protocol, new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `Protocol.kt: ${name} id mismatch`)
  }
})

test('Android RPC clients expose the shield wrappers', () => {
  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  // Wrappers required by B1: status, per-drive allow/strict, and the
  // subscription lifecycle. LOAD_LIST/REMOVE_LIST (raw-text hot-swap) and
  // PRIVACY_STATUS stay backend-only for now — no mobile surface calls them.
  const wrapped = [
    'SHIELD_STATUS', 'SHIELD_SET_ALLOW', 'SHIELD_SET_STRICT',
    'SHIELD_SUBSCRIBE_LIST', 'SHIELD_UNSUBSCRIBE_LIST', 'SHIELD_REFRESH_LISTS'
  ]
  for (const name of wrapped) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `PearRpcClient must call Cmd.${name}`)
  }
  for (const fn of ['getShieldStatus', 'setShieldAllow', 'setShieldStrict', 'subscribeList', 'unsubscribeList', 'refreshLists']) {
    assert.match(client, new RegExp(`suspend fun ${fn}\\b`), `PearRpcClient.${fn} missing`)
  }
  assert.match(client, /data class PearShieldStatus\b/, 'PearShieldStatus model missing')

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  for (const fn of ['getShieldStatus', 'setShieldAllow', 'setShieldStrict', 'subscribeList', 'unsubscribeList', 'refreshLists']) {
    assert.match(rpc, new RegExp(`suspend fun ${fn}\\b`), `PearRpc.${fn} helper missing`)
  }
})

test('backend registers a handler for every shield command', () => {
  const index = read('backend/index.js')
  for (const name of Object.keys(shieldCommands)) {
    assert.match(index, new RegExp(`rpc\\.handle\\(C\\.CMD_${name}\\b`), `backend/index.js: CMD_${name} handler missing`)
  }
  // Boot wiring: engine constructed, persisted state rehydrated, proxy hook.
  assert.match(index, /new ContentShield\(\)/, 'ContentShield not constructed at boot')
  assert.match(index, /new ShieldListSync\(/, 'ShieldListSync not constructed at boot')
  assert.match(index, /proxy\.setContentShield\(contentShield\)/, 'proxy.setContentShield wiring missing')
  assert.match(index, /startAutoRefresh\(30 \* 60 \* 1000\)/, '30-minute auto-refresh cadence changed')
  // Live toggle through the settings write path (default ON semantics).
  assert.match(index, /settings\.contentShield !== false/, 'settings live-apply for the toggle missing')
})

test('hyper-proxy ships the shield block + injection chokepoints', () => {
  const proxy = read('backend/hyper-proxy.js')
  assert.match(proxy, /setContentShield/, 'setContentShield missing')
  assert.match(proxy, /shouldBlockUrl/, 'block decision missing')
  assert.match(proxy, /X-Pear-Shield/, 'X-Pear-Shield header missing')
  assert.match(proxy, /documentKey/, 'documentKey allowlist plumbing missing')
  assert.match(proxy, /cosmeticCssFor/, 'cosmetic injection missing')
  assert.match(proxy, /scriptletsFor/, 'scriptlet injection missing')
  assert.match(proxy, /isStrict/, 'strict-mode check missing')
  assert.match(proxy, /strictCspContent/, 'strict CSP meta missing')
  assert.match(proxy, /data-pear-scriptlet/, 'scriptlet tag marker missing')
  assert.match(proxy, /data-pear-shield-strict/, 'strict meta marker missing')
  assert.match(proxy, /data-pear-shield>/, 'shield style marker missing')
  assert.match(proxy, /sha256ScriptBody/, 'CSP hash authorization missing')
  assert.match(proxy, /injectCspShimHashes/, 'page meta CSP rewriting missing')
  // The generated policy is asserted unsafe-inline-free in
  // content-shield-proxy.test.js (the word itself appears in doc comments
  // here explaining why it is never emitted).
})

test('Android Settings ships a Content Shield section backed by the RPC wrappers', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /ContentShieldSection\(\)/, 'ContentShieldSection not routed into SettingsScreen')
  assert.match(screen, /"Content Shield"/, 'Content Shield card title missing')
  assert.match(screen, /getShieldStatus\(/, 'Settings must read shield status')
  assert.match(screen, /setShieldAllow\(/, 'Settings must drive the per-drive allowlist')
  assert.match(screen, /setShieldStrict\(/, 'Settings must drive per-drive strict CSP')
  assert.match(screen, /subscribeList\(/, 'Settings must subscribe to list drives')
  assert.match(screen, /unsubscribeList\(/, 'Settings must remove subscriptions')
  assert.match(screen, /refreshLists\(/, 'Settings must refresh subscriptions')
  assert.match(screen, /contentShield/, 'Settings must write the contentShield toggle key')
  assert.match(screen, /Filter lists from the swarm/, 'list subscription block missing')
  assert.match(screen, /blocked · /, 'session counters missing')
})

test('pear-default seed list ships with a manifest whose sha256 matches', () => {
  const filtersPath = path.join(root, 'filter-lists/pear-default/filters.txt')
  const manifestPath = path.join(root, 'filter-lists/pear-default/manifest.json')
  assert.ok(fs.existsSync(filtersPath), 'filters.txt missing')
  assert.ok(fs.existsSync(manifestPath), 'manifest.json missing')

  const filters = fs.readFileSync(filtersPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  assert.equal(manifest.name, 'pear-default')
  assert.equal(manifest.filters, '/filters.txt')
  const sha256 = createHash('sha256').update(filters).digest('hex')
  assert.equal(manifest.sha256, sha256, 'manifest sha256 does not match filters.txt bytes')

  // The published default-list drive key is documented for users to paste.
  const readme = read('filter-lists/README.md')
  assert.match(readme, /842fb9e64c1c2092ec426151fd4f9ffb23a2efcae26ff3dd61d5d564ed58d99f/,
    'default list drive key missing from filter-lists/README.md')

  // The seed parses under the engine and only yields supported rules.
  const { parseFilterList } = require('../backend/content-shield.cjs')
  const parsed = parseFilterList(filters.toString('utf-8'))
  assert.ok(parsed.block.length > 40, 'seed list should carry a meaningful block set')
  assert.ok(parsed.cosmetic.length > 0, 'seed list should carry cosmetic rules')
  assert.ok(parsed.exceptions.length > 0, 'seed list should carry the documented exceptions')
})

test('default state: shield ON with the builtin list, like the desktop', () => {
  const { ContentShield } = require('../backend/content-shield.cjs')
  const shield = new ContentShield()
  assert.equal(shield.enabled, true)
  assert.ok(shield.stats().blockRules > 40, 'builtin list should be loaded by default')
  assert.ok(shield.stats().lists.includes('builtin'), 'builtin list must be registered')
})
