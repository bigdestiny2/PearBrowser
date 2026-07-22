const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

function includesAll (text, fragments) {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `missing source fragment: ${fragment}`)
  }
}

test('native Explore screens preserve safe catalog link-only rows and drop targetless rows', () => {
  const rn = read('app/screens/ExploreScreen.tsx')
  const ios = read('ios-native/PearBrowser/Sources/UI/Screens/ExploreScreen.swift')
  const android = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/ExploreScreen.kt')

  includesAll(rn, [
    'link?: string',
    'normalizeEntry',
    'normalizeEntries',
    'site.link',
    'onVisit(site.link)',
    'filter((site): site is SiteInfo => !!site)'
  ])

  includesAll(ios, [
    'let driveKey: String?',
    'let link: String?',
    'normalizeCatalogLink',
    'normalizeDriveKey',
    'driveKeyFromHyperLink',
    'root["entries"]',
    'onVisit(link)',
    'case "pear", "file"'
  ])

  includesAll(android, [
    'val driveKey: String?',
    'val link: String?',
    'LocalPearRpc.current',
    'loadSignedCatalogBee',
    'activeBeeKey',
    'ACTION_CATALOG_UPDATED',
    'EXTRA_CATALOG_JSON',
    'normalizeCatalogLink',
    'normalizeDriveKey',
    'driveKeyFromHyperLink',
    'root["entries"]',
    'val target = site.link',
    '"pear", "file" ->'
  ])
})

test('Android native BrowseScreen hardens CMD_NAVIGATE proxy and bridge lifecycle', () => {
  const browse = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt')
  includesAll(browse, [
    'navigationSerial',
    'verifiedProxyPort(localUrl)',
    'Backend proxyPort did not match localUrl',
    'Backend did not return an API token',
    'normalizeHyperNavigation',
    'isLocalProxyUrl',
    'request.isForMainFrame',
    'onPageStarted',
    'injectBridgeIfAllowed',
    'openExternal',
    'path.startsWith("/hyper/")'
  ])

  const bridge = read('android-native/app/src/main/java/com/pearbrowser/app/bridge/PearBridgeScript.kt')
  includesAll(bridge, [
    'Json.encodeToString(apiToken)',
    'require(port in 1..65535)'
  ])
})

test('Android native service forwards verified signed catalog updates to Explore', () => {
  const events = read('android-native/app/src/main/java/com/pearbrowser/app/bridge/PearWorkletEvents.kt')
  includesAll(events, [
    'ACTION_CATALOG_UPDATED',
    'EXTRA_CATALOG_KEY',
    'EXTRA_CATALOG_JSON'
  ])

  const service = read('android-native/app/src/main/java/com/pearbrowser/app/bridge/PearWorkletService.kt')
  includesAll(service, [
    'Evt.CATALOG_UPDATED',
    'ACTION_CATALOG_UPDATED',
    'EXTRA_CATALOG_KEY',
    'EXTRA_CATALOG_JSON'
  ])

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  assert.match(client, /loadSignedCatalogBee\(keyHex: String\)[\s\S]*signed = true/,
    'PearRpcClient must expose signed catalog bee helper')
})

test('Android native Browse screen wires pear.share to the system share sheet', () => {
  const bridge = read('app/lib/pear-bridge-spec.ts')
  const android = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt')

  includesAll(bridge, [
    'window.PearBrowserNative.share(url)'
  ])

  includesAll(android, [
    'import android.content.Intent',
    'fun share(url: String)',
    'Intent(Intent.ACTION_SEND)',
    'type = "text/plain"',
    'putExtra(Intent.EXTRA_TEXT, url)',
    'Intent.createChooser(shareIntent, "Share link")'
  ])
})

test('native Browse screens expose find-in-page and reload controls', () => {
  const ios = read('ios-native/PearBrowser/Sources/UI/Screens/BrowseScreen.swift')
  const android = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt')

  includesAll(ios, [
    'FindInPageBar(',
    'WKFindConfiguration()',
    'configuration.wraps = true',
    'webView.find(command.query',
    'webView.reload()',
    '.accessibilityLabel("Find in page")',
    '.accessibilityLabel("Reload page")'
  ])

  includesAll(android, [
    'FindInPageBar(',
    'findAllAsync(query)',
    'findNext(false)',
    'findNext(true)',
    'clearMatches()',
    'browserWebView?.reload()',
    'Text("Find in Page")',
    'Text("Reload"'
  ])
})

test('iOS native app routes only hyper deep links into BrowseScreen', () => {
  const app = read('ios-native/PearBrowser/Sources/App/PearBrowserApp.swift')
  const main = read('ios-native/PearBrowser/Sources/App/MainView.swift')
  const plist = read('ios-native/PearBrowser/Info.plist')

  includesAll(app, [
    '.onOpenURL',
    'postHyperURL(url)',
    'url.scheme?.lowercased() == "hyper"',
    '.pearBrowserOpenHyperURL',
    '#if DEBUG',
    '--open-hyper-url',
    'postDebugLaunchHyperURLIfNeeded()'
  ])

  includesAll(main, [
    '.onReceive(NotificationCenter.default.publisher(for: .pearBrowserOpenHyperURL))',
    'url.scheme?.lowercased() == "hyper"',
    'navigateTo(url.absoluteString)'
  ])

  includesAll(plist, [
    '<key>CFBundleURLTypes</key>',
    '<string>com.pearbrowser.app.hyper</string>',
    '<string>hyper</string>'
  ])
})
