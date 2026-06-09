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
