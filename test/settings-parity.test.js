const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

const settingsCommands = {
  GET_RELAYS: 40,
  SET_RELAYS: 41,
  SET_RELAY_ENABLED: 42,
  PROFILE_GET: 80,
  PROFILE_UPDATE: 81,
  PROFILE_CLEAR: 82,
  TRUSTED_ORIGINS_LIST: 96,
  TRUSTED_ORIGINS_ADD: 97,
  TRUSTED_ORIGINS_REMOVE: 98,
  TRUSTED_ORIGINS_SET_MODE: 110
}

test('settings command ids stay mirrored across platforms', () => {
  const backend = require('../backend/constants')
  const mirrors = [
    'app/lib/constants.ts',
    'ios-native/PearBrowser/Sources/RPC/Protocol.swift',
    'android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt'
  ]

  for (const [name, id] of Object.entries(settingsCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend ${name} id mismatch`)
    for (const rel of mirrors) {
      assert.match(read(rel), new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `${rel}: ${name} id mismatch`)
    }
  }
})

test('Android native Settings screen edits relays with validation and primary marker', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /getRelays\(\)/, 'Settings must load relay config')
  assert.match(screen, /setRelays\(/, 'Settings must write the relay list')
  assert.match(screen, /setRelayEnabled\(/, 'Settings must toggle hybrid fetch')
  assert.match(screen, /"Primary"/, 'Settings must mark the first relay as primary')
  assert.match(screen, /http:\/\/"\)\s*&&/, 'Settings must validate relay URLs before adding')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of ['GET_RELAYS', 'SET_RELAYS', 'SET_RELAY_ENABLED']) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `Android RPC client must call Cmd.${name}`)
  }

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(rpc, /getRelays[\s\S]*Cmd\.GET_RELAYS/, 'PearRpc get-relays helper missing shared id')
  assert.match(rpc, /setRelays[\s\S]*Cmd\.SET_RELAYS/, 'PearRpc set-relays helper missing shared id')
  assert.match(rpc, /setRelayEnabled[\s\S]*Cmd\.SET_RELAY_ENABLED/, 'PearRpc relay-toggle helper missing shared id')
})

test('Android native Settings screen views and edits the profile with dirty tracking', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /profileGet\(\)/, 'Settings must load the profile')
  assert.match(screen, /profileUpdate\(/, 'Settings must save the profile')
  assert.match(screen, /fields != savedProfile/, 'Settings must track dirty state against the saved profile')
  assert.match(screen, /displayName/, 'Settings must edit displayName')
  assert.match(screen, /avatar/, 'Settings must edit avatar')
  assert.match(screen, /website/, 'Settings must edit website')
  assert.match(screen, /Cancel/, 'Settings must offer cancel')
  assert.match(screen, /Save/, 'Settings must offer save')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of ['PROFILE_GET', 'PROFILE_UPDATE', 'PROFILE_CLEAR']) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `Android RPC client must call Cmd.${name}`)
  }

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(rpc, /profileGet[\s\S]*Cmd\.PROFILE_GET/, 'PearRpc profile-get helper missing shared id')
  assert.match(rpc, /profileUpdate[\s\S]*Cmd\.PROFILE_UPDATE/, 'PearRpc profile-update helper missing shared id')
  assert.match(rpc, /profileClear[\s\S]*Cmd\.PROFILE_CLEAR/, 'PearRpc profile-clear helper missing shared id')
})

test('Android native Settings screen manages trusted origins and their mode', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /trustedOriginsList\(\)/, 'Settings must list trusted origins')
  assert.match(screen, /trustedOriginsAdd\(/, 'Settings must add trusted origins')
  assert.match(screen, /trustedOriginsRemove\(/, 'Settings must remove trusted origins')
  assert.match(screen, /trustedOriginsSetMode\(/, 'Settings must switch the injection mode')
  assert.match(screen, /allowlist/, 'Settings must expose the allow-list mode')
  assert.match(screen, /Remove/, 'Settings must offer per-origin removal')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of ['TRUSTED_ORIGINS_LIST', 'TRUSTED_ORIGINS_ADD', 'TRUSTED_ORIGINS_REMOVE', 'TRUSTED_ORIGINS_SET_MODE']) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `Android RPC client must call Cmd.${name}`)
  }

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(rpc, /trustedOriginsList[\s\S]*Cmd\.TRUSTED_ORIGINS_LIST/, 'PearRpc trusted-list helper missing shared id')
  assert.match(rpc, /trustedOriginsAdd[\s\S]*Cmd\.TRUSTED_ORIGINS_ADD/, 'PearRpc trusted-add helper missing shared id')
  assert.match(rpc, /trustedOriginsRemove[\s\S]*Cmd\.TRUSTED_ORIGINS_REMOVE/, 'PearRpc trusted-remove helper missing shared id')
  assert.match(rpc, /trustedOriginsSetMode[\s\S]*Cmd\.TRUSTED_ORIGINS_SET_MODE/, 'PearRpc trusted-mode helper missing shared id')
})

test('Android native Settings shares the historyEnabled key with History and Browse', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /historyEnabled/, 'Settings must drive the historyEnabled setting')
  assert.match(screen, /setSettings\(/, 'Settings must persist the opt-in via setSettings')
  assert.match(screen, /getSettings\(\)/, 'Settings must read the opt-in via getSettings')

  const history = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/HistoryScreen.kt')
  assert.match(history, /historyEnabled/, 'History must keep driving the same key')

  const browse = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt')
  assert.match(browse, /historyEnabled/, 'Browse must keep gating recording on the same key')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  assert.match(client, /historyEnabled/, 'Android settings model must parse historyEnabled')
})

test('Android native shell routes Settings from the More tab', () => {
  const main = read('android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt')
  assert.match(main, /MoreRoute\.Settings\b/, 'MainActivity must define the Settings route')
  assert.match(main, /SettingsScreen\(/, 'MainActivity does not route to SettingsScreen')
  assert.match(main, /MoreScreen\([\s\S]*onOpenSettings/, 'MoreScreen does not expose Settings navigation')

  const more = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/MoreScreen.kt')
  assert.match(more, /title = "Settings"/, 'More tab Settings entry missing')
  assert.match(more, /onOpenSettings/, 'More tab does not call the Settings route')
})

test('settings screens exist in all three shells', () => {
  const ios = read('ios-native/PearBrowser/Sources/UI/Screens/SettingsScreen.swift')
  assert.match(ios, /getRelays\(\)/, 'iOS Settings must load relays')
  assert.match(ios, /setRelays/, 'iOS Settings must edit relays')

  const iosProfile = read('ios-native/PearBrowser/Sources/UI/Screens/ProfileEditScreen.swift')
  assert.match(iosProfile, /profileGet\(\)/, 'iOS profile editor must load the profile')
  assert.match(iosProfile, /profileUpdate\(/, 'iOS profile editor must save the profile')

  const iosTrusted = read('ios-native/PearBrowser/Sources/UI/Screens/TrustedSitesScreen.swift')
  assert.match(iosTrusted, /trustedOriginsList\(\)/, 'iOS trusted sites must list origins')

  const rn = read('app/screens/SettingsScreen.tsx')
  assert.match(rn, /getRelays|GET_RELAYS/, 'RN Settings must load relays')
})
