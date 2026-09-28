const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt'), 'utf8')
const settings = fs.readFileSync(path.join(root, 'android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt'), 'utf8')
const browse = fs.readFileSync(path.join(root, 'android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt'), 'utf8')
const client = fs.readFileSync(path.join(root, 'android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt'), 'utf8')

test('Android private sessions scrub both tab lists and the legacy URL', () => {
  const snapshot = main.slice(main.indexOf('private fun browserSessionSnapshot('), main.indexOf('/** Sub-routes'))
  assert.match(snapshot, /putJsonArray\("browserTabs"\)\s*\{\s*if \(!privateMode\)/)
  assert.match(snapshot, /put\("activeBrowserTabId", if \(privateMode\) null else tabs\.activeTabId\)/)
  assert.match(snapshot, /put\("lastBrowseUrl", if \(privateMode\) null else tabs\.activeTab\?\.url\)/)
  assert.match(snapshot, /put\("activeTab", if \(privateMode\) "home"/)
})

test('Android reads privateMode from user-data settings before restoring the shared session', () => {
  const restore = main.slice(main.indexOf('// Cold-start session restore'), main.indexOf('// Persist the tab session'))
  assert.ok(restore.indexOf('val settings = rpcClient.getSettings()') < restore.indexOf('val session = rpcClient.getSession()'))
  assert.match(restore, /if \(settings\.privateMode\)\s*\{[\s\S]*?saveSession\(browserSessionSnapshot\(session, tabManager, Tab\.Home, true\)\)/)
  assert.match(restore, /\} else if \(tabManager\.tabs\.isEmpty\(\)\) \{/)
  assert.match(restore, /sessionRestored = restored/)
})

test('Android confirms a tab scrub before changing Private Mode and enabling normal saves', () => {
  const route = main.slice(main.indexOf('MoreRoute.Settings -> SettingsScreen('), main.indexOf('MoreRoute.Sites -> MySitesScreen('))
  const scrub = route.indexOf('rpcClient.saveSession(browserSessionSnapshot(current, tabManager, Tab.Home, true))')
  const legacy = route.indexOf('rpcClient.clearLegacyTabs()')
  const setting = route.indexOf('rpcClient.setSettings(buildJsonObject { put("privateMode", enabled) })')
  const clear = route.indexOf('tabManager.closeAll()')
  const localMode = route.indexOf('privateMode = enabled')
  assert.ok(scrub >= 0 && legacy > scrub && setting > legacy && clear > setting && localMode > clear)
  assert.match(route, /withContext\(NonCancellable\)/)
  assert.match(route, /sessionWriteMutex\.lock\(\)[\s\S]*?try \{[\s\S]*?finally \{\s*sessionWriteMutex\.unlock\(\)/)
  assert.match(client, /suspend fun clearLegacyTabs\(\)[\s\S]*?Cmd\.USERDATA_IMPORT[\s\S]*?putJsonArray\("tabs"\)/)
  const save = main.slice(main.indexOf('// Persist the tab session'), main.indexOf('LaunchedEffect(rpcClient, bindingState.connected)', main.indexOf('// Persist the tab session')))
  assert.match(save, /privateMode == null\) return@LaunchedEffect/)
  assert.match(save, /val settings = rpcClient\.getSettings\(\)/)
  assert.match(save, /saveSession\(browserSessionSnapshot\(current, tabManager, activeTab, settings\.privateMode\)\)/)
})

test('Android Private Mode toggle reports failed scrub and suppresses history', () => {
  assert.match(settings, /onPrivateModeChange\(enabled\)/)
  assert.match(settings, /Private Mode was not changed:/)
  assert.match(settings, /enabled = rpc != null && loaded && !privateModeBusy/)
  assert.match(browse, /settings\?\.privateMode == true \|\| settings\?\.historyEnabled != true/)
})

test('Android observes remote mode changes and rechecks privacy before recording history', () => {
  const poll = main.slice(main.indexOf('while (isActive)'), main.indexOf('DisposableEffect(context)'))
  assert.match(poll, /privateMode != settings\.privateMode[\s\S]*?tabManager\.closeAll\(\)/)
  assert.match(poll, /if \(settings\.privateMode\)[\s\S]*?saveSession\(browserSessionSnapshot\(current, tabManager, Tab\.Home, true\)\)/)
  assert.match(browse, /val latest = client\.getSettings\(\)/)
  assert.match(browse, /if \(latest\.privateMode \|\| !latest\.historyEnabled\) return@LaunchedEffect/)
})

test('Android reopens validated app:// session tabs through the existing Hyperdrive route', () => {
  assert.match(browse, /private val appHost = Regex\("\^\[0-9a-fA-F\]\{64\}\$"\)/)
  assert.match(browse, /uri\.userInfo != null \|\| uri\.port != -1/)
  assert.ok(browse.includes('return AppNavigation(key, "app://$key$path$query$fragment", "hyper://$key$path$query$fragment")'))
  assert.match(browse, /val result = client\.navigate\(appTarget\?\.hyperUrl \?: target\)/)
  assert.match(browse, /verifiedProxyPort\(localUrl\)/)
  assert.match(browse, /responseKey != appTarget\.key/)
  assert.match(browse, /localUrl\.replaceFirst\(prefix, "\/app\/\$\{appTarget\.key\}"\)/)
  assert.match(browse, /normalizeHyperNavigation\(url\) \?: normalizeAppNavigation\(url\)\?\.url/)
})
