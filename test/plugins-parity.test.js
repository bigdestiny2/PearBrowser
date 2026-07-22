'use strict'

/**
 * Pear Plugins mobile parity audit (Mission B4a).
 *
 * Asserts the shipped surfaces line up with the desktop Phase 3 gate:
 * backend command ids (same numeric ids as pearbrowser-desktop), the Android
 * Protocol.kt mirror, RPC client wrappers on both Kotlin clients, backend
 * handlers + boot wiring, the /hyper/ + /clearnet/ injection chokepoints,
 * the Android Settings Plugins section (install consent + escalation
 * dialogs), and the ported catalogue seed data.
 *
 * iOS / RN shells are deliberately out of scope (no ios-native/ or app/
 * changes), so like shield-parity.test.js this checks the Android mirror
 * only.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

const pluginCommands = {
  PLUGIN_LIST: 235,
  PLUGIN_SET_ENABLED: 236,
  PLUGIN_REGISTER: 237,
  PLUGIN_INSTALL_DRIVE: 242,
  PLUGIN_UPDATE_DRIVE: 243,
  PLUGIN_UNINSTALL: 244,
  PLUGIN_CATALOG: 245,
  PLUGIN_CATALOG_LOAD_DRIVE: 246,
  PLUGIN_CATALOG_REMOVE_SOURCE: 247
}

test('plugin command ids match the desktop numbering in backend constants', () => {
  // The map above pins the desktop numbering (pearbrowser-desktop
  // backend/constants.js, Phase 3) — same convention as shield-parity.test.js.
  const backend = require('../backend/constants')
  for (const [name, id] of Object.entries(pluginCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend CMD_${name} id mismatch`)
  }
})

test('Android Protocol.kt mirrors the plugin command ids', () => {
  const protocol = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt')
  for (const [name, id] of Object.entries(pluginCommands)) {
    assert.match(protocol, new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `Protocol.kt: ${name} id mismatch`)
  }
})

test('Android RPC clients expose the plugin wrappers', () => {
  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  // PLUGIN_REGISTER stays backend-only (the desktop's fixture/install path —
  // no UI surface calls it on either platform).
  const wrapped = [
    'PLUGIN_LIST', 'PLUGIN_SET_ENABLED',
    'PLUGIN_INSTALL_DRIVE', 'PLUGIN_UPDATE_DRIVE', 'PLUGIN_UNINSTALL',
    'PLUGIN_CATALOG', 'PLUGIN_CATALOG_LOAD_DRIVE', 'PLUGIN_CATALOG_REMOVE_SOURCE'
  ]
  for (const name of wrapped) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `PearRpcClient must call Cmd.${name}`)
  }
  for (const fn of [
    'pluginList', 'pluginSetEnabled', 'pluginInstallDrive', 'pluginUpdateDrive',
    'pluginUninstall', 'pluginCatalog', 'pluginCatalogLoadDrive', 'pluginCatalogRemoveSource'
  ]) {
    assert.match(client, new RegExp(`suspend fun ${fn}\\b`), `PearRpcClient.${fn} missing`)
  }
  for (const model of ['PearPluginInfo', 'PearPluginInstallReply', 'PearPluginUpdateReply', 'PearPluginCatalogEntry', 'PearPluginCatalogSource', 'PearPluginCatalog']) {
    assert.match(client, new RegExp(`data class ${model}\\b`), `${model} model missing`)
  }

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  for (const fn of [
    'pluginList', 'pluginSetEnabled', 'pluginInstallDrive', 'pluginUpdateDrive',
    'pluginUninstall', 'pluginCatalog', 'pluginCatalogLoadDrive', 'pluginCatalogRemoveSource'
  ]) {
    assert.match(rpc, new RegExp(`suspend fun ${fn}\\b`), `PearRpc.${fn} helper missing`)
  }
})

test('backend registers a handler for every plugin command', () => {
  const index = read('backend/index.js')
  for (const name of Object.keys(pluginCommands)) {
    assert.match(index, new RegExp(`rpc\\.handle\\(C\\.CMD_${name}\\b`), `backend/index.js: CMD_${name} handler missing`)
  }
  // Boot wiring: registry on the shield, payload rehydrate, drive loader with
  // the snapshot-consent + escalation-guard seams, catalogue with restore.
  assert.match(index, /new PearPluginRegistry\(\{ shield: contentShield \}\)/, 'PearPluginRegistry not constructed at boot')
  assert.match(index, /new PluginDriveLoader\(/, 'PluginDriveLoader not constructed at boot')
  assert.match(index, /new PluginCatalog\(/, 'PluginCatalog not constructed at boot')
  assert.match(index, /contentShieldPlugins/, 'plugin payload rehydrate/persist key missing')
  assert.match(index, /contentShieldPluginInstalls/, 'install-record persistence key missing')
  assert.match(index, /contentShieldPluginCatalog/, 'catalogue persistence key missing')
  // The security seams stay injected exactly like the desktop: drive fetch,
  // refresh, and the snapshot fingerprint hash.
  assert.match(index, /fetchDriveFile: \(keyHex, path\) => proxy\._hybridFetch\(keyHex, path\)/, 'hybrid-fetch seam missing')
  assert.match(index, /refreshDrive: refreshDistributionDrive/, 'drive-refresh seam missing')
  assert.match(index, /sha256Hex,/, 'snapshot fingerprint seam missing')
})

test('both proxy paths ship the plugin injection chokepoints with hash authorization', () => {
  const hyper = read('backend/hyper-proxy.js')
  assert.match(hyper, /pluginStylesFor/, '/hyper/: plugin style sink missing')
  assert.match(hyper, /pluginScriptsFor/, '/hyper/: plugin script sink missing')
  assert.match(hyper, /data-pear-plugin-style/, '/hyper/: plugin style marker missing')
  assert.match(hyper, /data-pear-plugin=/, '/hyper/: plugin script marker missing')
  assert.match(hyper, /pluginScriptHashes/, '/hyper/: plugin scripts must be hash-authorized')
  assert.match(hyper, /shouldBlockUrl/, '/hyper/: net.filter enforcement missing')

  const clearnet = read('backend/clearnet-proxy.cjs')
  assert.match(clearnet, /pluginStylesFor/, '/clearnet/: plugin style sink missing')
  assert.match(clearnet, /pluginScriptsFor/, '/clearnet/: plugin script sink missing')
  assert.match(clearnet, /data-pear-plugin/, '/clearnet/: plugin markers missing')
  assert.match(clearnet, /shouldBlockUrl/, '/clearnet/: net.filter enforcement missing')

  // The engine surface the registry drives (ported in B1).
  const shield = read('backend/content-shield.cjs')
  assert.match(shield, /applyPluginContribution/, 'engine plugin contribution surface missing')
  assert.match(shield, /setPluginEnabled/, 'engine kill switch missing')
  assert.match(shield, /PLUGIN_LIST_PREFIX/, 'namespaced plugin list prefix missing')
})

test('Android Settings ships a Pear Plugins section with the consent + escalation dialogs', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /PluginsSection\(\)/, 'PluginsSection not routed into SettingsScreen')
  assert.match(screen, /"Pear Plugins"/, 'Pear Plugins card title missing')
  assert.match(screen, /pluginList\(/, 'Settings must list installed plugins')
  assert.match(screen, /pluginSetEnabled\(/, 'Settings must drive the kill switch')
  assert.match(screen, /pluginInstallDrive\(/, 'Settings must install by drive key')
  assert.match(screen, /pluginUpdateDrive\(/, 'Settings must update plugins')
  assert.match(screen, /pluginUninstall\(/, 'Settings must uninstall plugins')
  assert.match(screen, /pluginCatalog\(/, 'Settings must read the catalogue')
  assert.match(screen, /pluginCatalogLoadDrive\(/, 'Settings must load catalogue drives')
  assert.match(screen, /pluginCatalogRemoveSource\(/, 'Settings must remove catalogue sources')
  assert.match(screen, /Grant and install/, 'install-consent dialog missing')
  assert.match(screen, /Accept and re-enable/, 'escalation-consent dialog missing')
  assert.match(screen, /Plugin catalog/, 'catalogue block missing')
})

test('the ported catalogue seed parses and carries the published keys', () => {
  const seedPath = path.join(root, 'catalogues/pear-plugins/plugins.json')
  assert.ok(fs.existsSync(seedPath), 'catalogues/pear-plugins/plugins.json missing')
  const parsed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'))
  assert.ok(Array.isArray(parsed.plugins) && parsed.plugins.length >= 3, 'seed must carry the shipped entries')

  const { ANONGPT_DRIVE_KEY, BUILTIN_PLUGIN_CATALOG } = require('../backend/plugin-catalog.cjs')
  const anongpt = parsed.plugins.find(entry => entry.id === 'anongpt')
  assert.equal(anongpt.driveKey, ANONGPT_DRIVE_KEY, 'seed anonGPT key drifted from the builtin seed')

  // Builtin seed + shipped source agree on the published plugin keys.
  const byId = Object.fromEntries(BUILTIN_PLUGIN_CATALOG.map(entry => [entry.id, entry.driveKey]))
  for (const entry of parsed.plugins) {
    if (byId[entry.id]) assert.equal(entry.driveKey, byId[entry.id], `${entry.id} key drifted`)
  }
})

test('the ported modules stay dependency-free beyond injected seams', () => {
  // Faithful-port guard: pear-plugins + plugin-drive-loader must not grow
  // host-specific requires (everything host-side is constructor-injected).
  for (const rel of ['backend/pear-plugins.cjs', 'backend/plugin-drive-loader.cjs']) {
    const src = read(rel)
    const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map(m => m[1])
    assert.deepEqual(requires, ['./content-shield.cjs'].filter(() => rel.includes('pear-plugins')), `${rel} grew a host-specific require`)
  }
  // plugin-catalog keeps exactly its one documented deviation (local
  // ANONGPT_DRIVE_KEY instead of requiring constants.js).
  const catalog = read('backend/plugin-catalog.cjs')
  assert.doesNotMatch(catalog, /require\('\.\/constants\.js'\)/, 'plugin-catalog must not require mobile constants (RPC-id mirror)')
})
