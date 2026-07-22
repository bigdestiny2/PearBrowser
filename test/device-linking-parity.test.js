const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

function includesAll (text, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `${label}: missing source fragment: ${fragment}`)
  }
}

const linkCommands = {
  DEVICE_LINK_CREATE_INVITE: 76,
  DEVICE_LINK_JOIN: 77
}

test('device-link command ids stay mirrored across mobile surfaces', () => {
  const backend = require('../backend/constants')
  const mirrors = [
    'app/lib/constants.ts',
    'ios-native/PearBrowser/Sources/RPC/Protocol.swift',
    'android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt'
  ]

  for (const [name, id] of Object.entries(linkCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend ${name} id mismatch`)
    for (const rel of mirrors) {
      assert.match(read(rel), new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `${rel}: ${name} id mismatch`)
    }
  }
})

test('mobile RPC clients expose blind-pairing device-link helpers', () => {
  const rn = read('app/lib/rpc.ts')
  assert.match(rn, /identityExportPhrase\(\)[\s\S]*CMD\.IDENTITY_EXPORT_PHRASE/, 'RN export phrase helper missing')
  assert.match(rn, /identityImportPhrase\(mnemonic:[\s\S]*CMD\.IDENTITY_IMPORT_PHRASE/, 'RN import phrase helper missing')
  assert.match(rn, /identityValidatePhrase\(mnemonic:[\s\S]*CMD\.IDENTITY_VALIDATE_PHRASE/, 'RN validate phrase helper missing')
  assert.match(rn, /deviceLinkCreateInvite\(\)[\s\S]*CMD\.DEVICE_LINK_CREATE_INVITE/, 'RN create invite helper missing')
  assert.match(rn, /deviceLinkJoin\(invite:[\s\S]*CMD\.DEVICE_LINK_JOIN/, 'RN join helper missing')

  const swift = read('ios-native/PearBrowser/Sources/RPC/PearRPC.swift')
  assert.match(swift, /exportPhrase\(\)[\s\S]*Cmd\.IDENTITY_EXPORT_PHRASE/, 'iOS export phrase helper missing')
  assert.match(swift, /importPhrase\(_ mnemonic:[\s\S]*Cmd\.IDENTITY_IMPORT_PHRASE/, 'iOS import phrase helper missing')
  assert.match(swift, /validatePhrase\(_ mnemonic:[\s\S]*Cmd\.IDENTITY_VALIDATE_PHRASE/, 'iOS validate phrase helper missing')
  assert.match(swift, /deviceLinkCreateInvite\(\)[\s\S]*Cmd\.DEVICE_LINK_CREATE_INVITE/, 'iOS create invite helper missing')
  assert.match(swift, /deviceLinkJoin\(invite:[\s\S]*Cmd\.DEVICE_LINK_JOIN/, 'iOS join helper missing')

  const kotlin = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(kotlin, /exportPhrase\(\)[\s\S]*Cmd\.IDENTITY_EXPORT_PHRASE/, 'Android PearRpc export phrase helper missing')
  assert.match(kotlin, /importPhrase\(mnemonic:[\s\S]*Cmd\.IDENTITY_IMPORT_PHRASE/, 'Android PearRpc import phrase helper missing')
  assert.match(kotlin, /validatePhrase\(mnemonic:[\s\S]*Cmd\.IDENTITY_VALIDATE_PHRASE/, 'Android PearRpc validate phrase helper missing')
  assert.match(kotlin, /deviceLinkCreateInvite\(\)[\s\S]*Cmd\.DEVICE_LINK_CREATE_INVITE/, 'Android PearRpc create invite helper missing')
  assert.match(kotlin, /deviceLinkJoin\(invite:[\s\S]*Cmd\.DEVICE_LINK_JOIN/, 'Android PearRpc join helper missing')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  assert.match(client, /exportPhrase\(\)[\s\S]*Cmd\.IDENTITY_EXPORT_PHRASE/, 'Android Binder client export phrase helper missing')
  assert.match(client, /importPhrase\(mnemonic:[\s\S]*Cmd\.IDENTITY_IMPORT_PHRASE/, 'Android Binder client import phrase helper missing')
  assert.match(client, /validatePhrase\(mnemonic:[\s\S]*Cmd\.IDENTITY_VALIDATE_PHRASE/, 'Android Binder client validate phrase helper missing')
  assert.match(client, /deviceLinkCreateInvite\(\)[\s\S]*Cmd\.DEVICE_LINK_CREATE_INVITE/, 'Android Binder client create invite helper missing')
  assert.match(client, /deviceLinkJoin\(invite:[\s\S]*Cmd\.DEVICE_LINK_JOIN/, 'Android Binder client join helper missing')
})

test('mobile worklet mirrors the desktop device-link RPC contract', () => {
  const index = read('backend/index.js')
  includesAll(index, [
    'C.CMD_DEVICE_LINK_CREATE_INVITE',
    'getDeviceLinker().createInvite()',
    'return { invite, discoveryKey }',
    'C.CMD_DEVICE_LINK_JOIN',
    'DeviceLinker(swarm, { identity: requireIdentity() })',
    'await linker.joinWithInvite(invite.trim(), { device: device || \'this device\' })',
    'return { ok: true, restartRequired: true }'
  ], 'backend/index.js')
})

test('Settings and backup flows use 24-word semantics and expose Link a Device', () => {
  const rnSettings = read('app/screens/SettingsScreen.tsx')
  assert.match(rnSettings, /Link a Device/, 'RN Settings must expose device linking')
  assert.match(rnSettings, /deviceLinkCreateInvite/, 'RN Settings must create device-link invites')
  assert.match(rnSettings, /deviceLinkJoin/, 'RN Settings must join device-link invites')
  assert.match(rnSettings, /24-word BIP-39 seed phrase/, 'RN Settings backup copy must say 24-word')

  const rnBackup = read('app/screens/BackupPhraseScreen.tsx')
  assert.match(rnBackup, /24-word phrase/, 'RN backup warning must say 24-word')
  assert.doesNotMatch(rnBackup, /12-word phrase/, 'RN backup warning must not default to 12-word')

  const rnRestore = read('app/screens/RestoreIdentityScreen.tsx')
  assert.match(rnRestore, /Enter your 24-word backup phrase/, 'RN restore copy must lead with 24-word')
  assert.match(rnRestore, /legacy 12-word/, 'RN restore copy must still acknowledge legacy 12-word restores')

  const iosSettings = read('ios-native/PearBrowser/Sources/UI/Screens/SettingsScreen.swift')
  assert.match(iosSettings, /Link a Device/, 'iOS Settings must expose device linking')
  assert.match(iosSettings, /deviceLinkCreateInvite/, 'iOS Settings must create device-link invites')
  assert.match(iosSettings, /deviceLinkJoin/, 'iOS Settings must join device-link invites')
  assert.match(iosSettings, /24-word BIP-39 seed/, 'iOS Settings backup copy must say 24-word')

  const iosBackup = read('ios-native/PearBrowser/Sources/UI/Screens/BackupPhraseScreen.swift')
  assert.match(iosBackup, /24-word phrase/, 'iOS backup warning must say 24-word')
  assert.doesNotMatch(iosBackup, /12-word phrase/, 'iOS backup warning must not default to 12-word')

  const iosRestore = read('ios-native/PearBrowser/Sources/UI/Screens/RestoreIdentityScreen.swift')
  assert.match(iosRestore, /Enter your 24-word backup phrase/, 'iOS restore copy must lead with 24-word')
  assert.match(iosRestore, /Legacy 12-word/, 'iOS restore copy must still acknowledge legacy 12-word restores')

  const androidMore = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/MoreScreen.kt')
  includesAll(androidMore, [
    'IdentitySection',
    'Backup Phrase',
    'Restore from Phrase',
    'Link a Device',
    '24-word BIP-39',
    'Legacy 12-word BIP-39 phrases are also accepted',
    'deviceLinkCreateInvite',
    'deviceLinkJoin',
    'exportPhrase',
    'importPhrase',
    'validatePhrase',
    'Android phone',
    'Replace this identity?'
  ], 'Android MoreScreen')
})
