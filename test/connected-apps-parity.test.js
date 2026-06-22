const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

const grantCommands = {
  LOGIN_LIST_GRANTS: 83,
  LOGIN_REVOKE_GRANT: 84,
  LOGIN_REVOKE_ALL: 85,
  SWARM_LIST_GRANTS: 121,
  SWARM_REVOKE_GRANT: 122,
  SWARM_REVOKE_ALL_FOR_APP: 123
}

const profileCommands = {
  PROFILE_GET: 80,
  PROFILE_UPDATE: 81,
  PROFILE_CLEAR: 82
}

test('connected-app grant command ids stay mirrored across platforms', () => {
  const backend = require('../backend/constants')
  const mirrors = [
    'app/lib/constants.ts',
    'ios-native/PearBrowser/Sources/RPC/Protocol.swift',
    'android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt'
  ]

  for (const [name, id] of Object.entries(grantCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend ${name} id mismatch`)
    for (const rel of mirrors) {
      assert.match(read(rel), new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `${rel}: ${name} id mismatch`)
    }
  }
})

test('profile command ids stay mirrored across React Native and iOS', () => {
  const backend = require('../backend/constants')
  const mirrors = [
    'app/lib/constants.ts',
    'ios-native/PearBrowser/Sources/RPC/Protocol.swift'
  ]

  for (const [name, id] of Object.entries(profileCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend ${name} id mismatch`)
    for (const rel of mirrors) {
      assert.match(read(rel), new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `${rel}: ${name} id mismatch`)
    }
  }
})

test('Android native Connected Apps uses shared grant commands', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/ConnectedAppsScreen.kt')
  assert.match(screen, /Sign-in grants/, 'Android screen must list login grants')
  assert.match(screen, /Swarm topic grants/, 'Android screen must list swarm topic grants')
  assert.match(screen, /loginRevokeAll/, 'Android screen must support revoking all sign-ins')
  assert.match(screen, /swarmRevokeGrant/, 'Android screen must revoke individual swarm grants')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of Object.keys(grantCommands)) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `Android RPC client must call Cmd.${name}`)
  }

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(rpc, /loginListGrants\(\)[\s\S]*Cmd\.LOGIN_LIST_GRANTS/, 'PearRpc login list helper missing shared id')
  assert.match(rpc, /loginRevokeGrant[\s\S]*Cmd\.LOGIN_REVOKE_GRANT/, 'PearRpc login revoke helper missing shared id')
  assert.match(rpc, /loginRevokeAll\(\)[\s\S]*Cmd\.LOGIN_REVOKE_ALL/, 'PearRpc login revoke-all helper missing shared id')
  assert.match(rpc, /swarmListGrants[\s\S]*Cmd\.SWARM_LIST_GRANTS/, 'PearRpc swarm list helper missing shared id')
  assert.match(rpc, /swarmRevokeGrant[\s\S]*Cmd\.SWARM_REVOKE_GRANT/, 'PearRpc swarm revoke helper missing shared id')
})

test('iOS native Connected Apps lists and revokes login plus swarm grants', () => {
  const screen = read('ios-native/PearBrowser/Sources/UI/Screens/ConnectedAppsScreen.swift')
  assert.match(screen, /Sign-in grants/, 'iOS screen must list login grants')
  assert.match(screen, /Swarm topic grants/, 'iOS screen must list swarm topic grants')
  assert.match(screen, /loginListGrants\(\)/, 'iOS screen must load login grants')
  assert.match(screen, /swarmListGrants\(\)/, 'iOS screen must load swarm grants')
  assert.match(screen, /loginRevokeGrant\(driveKeyHex:/, 'iOS screen must revoke individual login grants')
  assert.match(screen, /loginRevokeAll\(\)/, 'iOS screen must support revoke-all sign-ins')
  assert.match(screen, /swarmRevokeGrant\(driveKey:[\s\S]*topicHex:/, 'iOS screen must revoke individual swarm grants')
  assert.match(screen, /Revoke all app sign-ins\?/, 'iOS screen must confirm revoke-all')
  assert.match(screen, /Revoke sign-in\?/, 'iOS screen must confirm individual sign-in revoke')

  const settings = read('ios-native/PearBrowser/Sources/UI/Screens/SettingsScreen.swift')
  assert.match(settings, /identityRow\("Connected Apps"/, 'iOS Settings must expose Connected Apps')

  const main = read('ios-native/PearBrowser/Sources/App/MainView.swift')
  assert.match(main, /case connectedApps/, 'iOS MainView must route to Connected Apps')
  assert.match(main, /ConnectedAppsScreen/, 'iOS MainView must render ConnectedAppsScreen')
})

test('iOS native Profile editor is wired to profile RPCs and opt-in scope copy', () => {
  const screen = read('ios-native/PearBrowser/Sources/UI/Screens/ProfileEditScreen.swift')
  assert.match(screen, /Your Profile/, 'iOS profile editor heading missing')
  assert.match(screen, /profileGet\(\)/, 'iOS profile editor must load profile fields')
  assert.match(screen, /profileUpdate\(fields\)/, 'iOS profile editor must save profile fields')
  assert.match(screen, /Display name/, 'iOS profile editor must expose display name')
  assert.match(screen, /Avatar URL/, 'iOS profile editor must expose avatar URL')
  assert.match(screen, /Email/, 'iOS profile editor must expose email')
  assert.match(screen, /Website/, 'iOS profile editor must expose website')
  assert.match(screen, /Bio/, 'iOS profile editor must expose bio')
  assert.match(screen, /Pronouns/, 'iOS profile editor must expose pronouns')
  assert.match(screen, /Location/, 'iOS profile editor must expose location')
  assert.match(screen, /profile:name/, 'iOS profile editor must explain profile:name scope')
  assert.match(screen, /profile:contact/, 'iOS profile editor must explain profile:contact scope')
  assert.match(screen, /profile:read/, 'iOS profile editor must explain profile:read scope')
  assert.match(screen, /Apps only see the fields you grant access to/, 'iOS profile editor must explain opt-in sharing')

  const rpc = read('ios-native/PearBrowser/Sources/RPC/PearRPC.swift')
  assert.match(rpc, /profileGet\(\)[\s\S]*Cmd\.PROFILE_GET/, 'PearRPC profileGet helper missing shared id')
  assert.match(rpc, /profileUpdate\(_ updates:[\s\S]*Cmd\.PROFILE_UPDATE/, 'PearRPC profileUpdate helper missing shared id')
  assert.match(rpc, /profileClear\(\)[\s\S]*Cmd\.PROFILE_CLEAR/, 'PearRPC profileClear helper missing shared id')

  const settings = read('ios-native/PearBrowser/Sources/UI/Screens/SettingsScreen.swift')
  assert.match(settings, /identityRow\("Your Profile"/, 'iOS Settings must expose Your Profile')
  assert.match(settings, /onOpenProfile/, 'iOS Settings must call the profile route')

  const main = read('ios-native/PearBrowser/Sources/App/MainView.swift')
  assert.match(main, /case profile/, 'iOS MainView must route to Profile')
  assert.match(main, /ProfileEditScreen/, 'iOS MainView must render ProfileEditScreen')
})

test('Android native shell wires Connected Apps from More through the bound worklet service', () => {
  const aidl = read('android-native/app/src/main/aidl/com/pearbrowser/app/rpc/IPearRpcService.aidl')
  assert.match(aidl, /void request\(int command,\s*String dataJson,\s*IPearRpcCallback callback\)/, 'Android Binder RPC request method missing')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  assert.match(client, /remote\.request\(command,\s*data\.toString\(\),\s*callback\)/, 'PearRpcClient must forward command ids through Binder')

  const service = read('android-native/app/src/main/java/com/pearbrowser/app/bridge/PearWorkletService.kt')
  assert.match(service, /IPearRpcService\.Stub/, 'Worklet service does not expose the Binder RPC service')
  assert.match(service, /client\.request\(command,\s*data\)/, 'Worklet service must forward Binder requests to PearRpc.request')

  const main = read('android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt')
  assert.match(main, /ConnectedAppsScreen/, 'MainActivity does not route to ConnectedAppsScreen')
  assert.match(main, /MoreScreen\([\s\S]*onOpenConnectedApps/, 'MoreScreen does not expose Connected Apps navigation')

  const more = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/MoreScreen.kt')
  assert.match(more, /Connected Apps/, 'More tab entry missing')
  assert.match(more, /onOpenConnectedApps/, 'More tab does not call the Connected Apps route')
})
