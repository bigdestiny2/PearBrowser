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

const ANDROID_SCREENS = 'android-native/app/src/main/java/com/pearbrowser/app/ui/screens'
const mirrors = [
  'app/lib/constants.ts',
  'ios-native/PearBrowser/Sources/RPC/Protocol.swift',
  'android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt'
]

const siteCommands = {
  CREATE_SITE: 20,
  UPDATE_SITE: 21,
  PUBLISH_SITE: 22,
  UNPUBLISH_SITE: 23,
  LIST_SITES: 24,
  DELETE_SITE: 25,
  LOAD_TEMPLATE: 26
}

const appCommands = {
  INSTALL_APP: 11,
  UNINSTALL_APP: 12,
  LAUNCH_APP: 13,
  LIST_INSTALLED: 14,
  CHECK_UPDATES: 15
}

test('site builder command ids stay mirrored across platforms', () => {
  const backend = require('../backend/constants')
  for (const [name, id] of Object.entries(siteCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend ${name} id mismatch`)
    for (const rel of mirrors) {
      assert.match(read(rel), new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `${rel}: ${name} id mismatch`)
    }
  }
})

test('app install/launch command ids stay mirrored across platforms', () => {
  const backend = require('../backend/constants')
  for (const [name, id] of Object.entries(appCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend ${name} id mismatch`)
    for (const rel of mirrors) {
      assert.match(read(rel), new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `${rel}: ${name} id mismatch`)
    }
  }
})

test('no GET_SITE_BLOCKS read-back RPC is invented (27 is unused)', () => {
  // The backend cannot return a site's block list — blocks are rendered to
  // HTML by site-manager.buildFromBlocks and never persisted as blocks.
  // Android must not pretend otherwise.
  const backend = require('../backend/constants')
  assert.equal(backend.CMD_GET_SITE_BLOCKS, undefined, 'backend unexpectedly grew CMD_GET_SITE_BLOCKS')
  const protocol = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt')
  assert.doesNotMatch(protocol, /GET_SITE_BLOCKS/, 'Android Protocol.kt must not invent GET_SITE_BLOCKS')

  const index = read('backend/index.js')
  assert.match(index, /CMD_UPDATE_SITE[\s\S]*?buildFromBlocks/, 'UPDATE_SITE must keep routing blocks to buildFromBlocks')
})

test('Android editor block model mirrors backend _renderBlocks schema', () => {
  const manager = read('backend/site-manager.js')
  const editor = read(`${ANDROID_SCREENS}/SiteEditorScreen.kt`)

  // The 8 block types the backend renderer understands.
  const types = ['heading', 'text', 'image', 'link', 'divider', 'code', 'quote', 'list']
  for (const type of types) {
    assert.match(manager, new RegExp(`case '${type}'`), `backend _renderBlocks lost '${type}'`)
    assert.match(editor, new RegExp(`"${type}"`), `Android BlockType missing '${type}'`)
  }

  // Per-type wire fields the backend reads. List items go through putJsonArray.
  for (const field of ['"text"', '"level"', '"href"', '"src"', '"alt"']) {
    assert.ok(editor.includes(`put(${field}`), `Android editor must serialize ${field}`)
  }
  assert.ok(editor.includes('putJsonArray("items"'), 'Android editor must serialize "items"')

  // Theme keys feed _renderThemeCss.
  const themeKeys = ['primaryColor', 'backgroundColor', 'textColor', 'fontFamily']
  for (const key of themeKeys) {
    assert.ok(manager.includes(`theme.${key}`) || manager.includes(`theme = {}`), `backend theme key ${key}`)
    assert.ok(editor.includes(`"${key}"`), `Android SiteTheme must serialize ${key}`)
  }

  // Save path: UPDATE_SITE with blocks + theme; publish after save.
  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of ['CREATE_SITE', 'UPDATE_SITE', 'PUBLISH_SITE', 'UNPUBLISH_SITE', 'LIST_SITES', 'DELETE_SITE']) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `PearRpcClient must call Cmd.${name}`)
  }
  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  for (const name of ['CREATE_SITE', 'UPDATE_SITE', 'PUBLISH_SITE', 'UNPUBLISH_SITE', 'DELETE_SITE']) {
    assert.match(rpc, new RegExp(`Cmd\\.${name}\\b`), `PearRpc must call Cmd.${name}`)
  }
})

test('Android My Sites, template picker, and editor screens exist with states', () => {
  const mySites = read(`${ANDROID_SCREENS}/MySitesScreen.kt`)
  includesAll(mySites, [
    'fun MySitesScreen(',
    'listSites()',
    'publishSite(site.siteId)',
    'unpublishSite(site.siteId)',
    'deleteSite(site.siteId)',
    'onCreateNew',
    'No sites yet',
    'Retry',
    'Delete site?'
  ], 'MySitesScreen.kt')

  const picker = read(`${ANDROID_SCREENS}/TemplatePickerScreen.kt`)
  includesAll(picker, [
    'fun TemplatePickerScreen(',
    'object SiteTemplates',
    '"blank"',
    '"personal"',
    '"blog"',
    '"portfolio"',
    '"landing"'
  ], 'TemplatePickerScreen.kt')

  const editor = read(`${ANDROID_SCREENS}/SiteEditorScreen.kt`)
  includesAll(editor, [
    'fun SiteEditorScreen(',
    'saveBlocks()',
    'publishSite(siteId)',
    'PublishBadge',
    'Site published',
    'BlockToolbar'
  ], 'SiteEditorScreen.kt')
})

test('Android shell routes sites flows from the More tab', () => {
  const main = read('android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt')
  includesAll(main, [
    'data object Sites',
    'SitesTemplatePicker(val pendingName: String)',
    'MoreRoute.Sites -> MySitesScreen(',
    'is MoreRoute.SitesTemplatePicker -> TemplatePickerScreen(',
    'is MoreRoute.SiteEditor -> SiteEditorScreen(',
    'onOpenSites = { moreRoute = MoreRoute.Sites }',
    'createSite(route.pendingName)',
    'templateId = template.id'
  ], 'MainActivity.kt')

  const more = read(`${ANDROID_SCREENS}/MoreScreen.kt`)
  assert.match(more, /title = "My Sites"/, 'More tab My Sites entry missing')
  assert.match(more, /onOpenSites/, 'More tab does not call the Sites route')
})

test('Android Explore installs, lists, and opens apps via the backend commands', () => {
  const explore = read(`${ANDROID_SCREENS}/ExploreScreen.kt`)
  includesAll(explore, [
    'listInstalled()',
    'installApp(site.id, driveKey, site.name, site.version)',
    'launchApp(appId)',
    'Installed Apps',
    'Installing…',
    'Opening…',
    '"hyper://$it"'
  ], 'ExploreScreen.kt')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of ['INSTALL_APP', 'LAUNCH_APP', 'LIST_INSTALLED']) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `PearRpcClient must call Cmd.${name}`)
  }
  // LAUNCH_APP payload key must be `id` — backend reads data.id.
  assert.match(client, /suspend fun launchApp\(id: String\)[\s\S]*?put\("id", id\)/,
    'PearRpcClient.launchApp must send { id }')
  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(rpc, /suspend fun launchApp\(appId: String\)[\s\S]*?put\("id", appId\)/,
    'PearRpc.launchApp must send { id }')

  // Backend keeps returning a proxy localUrl + driveKey for launches.
  const index = read('backend/index.js')
  includesAll(index, ['CMD_LAUNCH_APP', 'localUrl', 'driveKey'], 'backend/index.js launch handler')
})

test('Android QR scanner uses CameraX + ML Kit with navigate and device-link modes', () => {
  // Camera deps must already be declared — no new heavy deps allowed.
  const gradle = read('android-native/app/build.gradle.kts')
  includesAll(gradle, [
    'androidx.camera.core',
    'androidx.camera.lifecycle',
    'androidx.camera.view',
    'mlkit.barcode.scanning'
  ], 'app/build.gradle.kts')

  const manifest = read('android-native/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android\.permission\.CAMERA/, 'Manifest must keep CAMERA permission')

  const scanner = read(`${ANDROID_SCREENS}/QRScannerScreen.kt`)
  includesAll(scanner, [
    'enum class QRScanMode',
    'Navigate',
    'DeviceLink',
    'fun normalizeScannedPayload(',
    'ProcessCameraProvider.getInstance',
    'BarcodeScanning.getClient',
    'FORMAT_QR_CODE',
    'Manifest.permission.CAMERA',
    'hyper://',
    'p2phiverelay',
    'Not a device-link invite',
    'Not a hyper:// QR'
  ], 'QRScannerScreen.kt')

  // Device-link scans feed the join flow in More's identity section; manual
  // paste entry stays as the no-camera fallback.
  const main = read('android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt')
  includesAll(main, [
    'QRScanMode.Navigate',
    'QRScanMode.DeviceLink',
    'onOpenQR',
    'onScanInviteQr',
    'scannedInvite = payload'
  ], 'MainActivity.kt')

  const more = read(`${ANDROID_SCREENS}/MoreScreen.kt`)
  includesAll(more, [
    'Scan Invite QR',
    'onScanInviteQr',
    'pendingInvite',
    'Paste device-link invite',
    'deviceLinkJoin'
  ], 'MoreScreen.kt')

  const home = read(`${ANDROID_SCREENS}/HomeScreen.kt`)
  assert.match(home, /onOpenQR/, 'Home QR badge must open the scanner')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  assert.match(client, /Cmd\.DEVICE_LINK_JOIN\b/, 'PearRpcClient must keep calling Cmd.DEVICE_LINK_JOIN')
})

test('site screens exist in all three shells', () => {
  const ios = read('ios-native/PearBrowser/Sources/UI/Screens/MySitesScreen.swift')
  assert.match(ios, /Cmd\.LIST_SITES/, 'iOS My Sites must list sites')
  const iosEditor = read('ios-native/PearBrowser/Sources/UI/Screens/SiteEditorScreen.swift')
  assert.match(iosEditor, /Cmd\.UPDATE_SITE/, 'iOS editor must save blocks')
  const iosPicker = read('ios-native/PearBrowser/Sources/UI/Screens/TemplatePickerScreen.swift')
  assert.match(iosPicker, /templates/, 'iOS template picker must define templates')

  const rn = read('app/screens/MySitesScreen.tsx')
  assert.match(rn, /listSites|LIST_SITES/, 'RN My Sites must list sites')
})
