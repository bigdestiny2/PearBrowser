const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

const KOTLIN_MAIN = 'android-native/app/src/main/java/com/pearbrowser/app'

test('session command ids stay mirrored across platforms', () => {
  const backend = require('../backend/constants')
  const sessionCommands = {
    USERDATA_GET_SESSION: 58,
    USERDATA_SAVE_SESSION: 59
  }
  const mirrors = [
    'app/lib/constants.ts',
    'ios-native/PearBrowser/Sources/RPC/Protocol.swift',
    `${KOTLIN_MAIN}/rpc/Protocol.kt`
  ]

  for (const [name, id] of Object.entries(sessionCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend ${name} id mismatch`)
    for (const rel of mirrors) {
      assert.match(read(rel), new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `${rel}: ${name} id mismatch`)
    }
  }
})

test('backend exposes the session KV both shells mirror', () => {
  const index = read('backend/index.js')
  assert.match(index, /rpc\.handle\(C\.CMD_USERDATA_GET_SESSION/, 'backend GET_SESSION handler missing')
  assert.match(index, /rpc\.handle\(C\.CMD_USERDATA_SAVE_SESSION/, 'backend SAVE_SESSION handler missing')

  const userData = read('backend/user-data.js')
  assert.match(userData, /async getSession \(\)/, 'user-data getSession missing')
  assert.match(userData, /async saveSession \(state\)/, 'user-data saveSession missing')
  // Privacy: the session store is its own Hyperbee — it must not touch the
  // history bee, which is why Android session saving is always-on and does
  // not inherit the historyEnabled gate.
  const sessionFns = userData.slice(userData.indexOf('async getSession'), userData.indexOf('async getTabs'))
  assert.doesNotMatch(sessionFns, /history/i, 'session KV must not feed the history log')
})

test('Android tab model mirrors the RN BrowserTab shape', () => {
  const manager = read(`${KOTLIN_MAIN}/ui/tabs/BrowserTabManager.kt`)
  assert.match(manager, /class BrowserTab\(/, 'BrowserTab model missing')
  assert.match(manager, /val id: String = UUID/, 'BrowserTab must carry a stable id')
  assert.match(manager, /var url by mutableStateOf/, 'BrowserTab.url must be observable')
  assert.match(manager, /var title by mutableStateOf/, 'BrowserTab.title must be observable')
  assert.match(manager, /mutableStateListOf<BrowserTab>/, 'tab list must be observable')
  assert.match(manager, /activeTabId/, 'manager must track the active tab')
  assert.match(manager, /fun navigateActive\(/, 'manager must navigate the active tab')
  assert.match(manager, /fun openNewTab\(/, 'manager must open new tabs')
  assert.match(manager, /fun select\(/, 'manager must select tabs')
  assert.match(manager, /fun close\(/, 'manager must close tabs')
  assert.match(manager, /fun restore\(/, 'manager must restore a session')
  // Bounded live-WebView pool (LRU) — eviction re-navigates via CMD_NAVIGATE.
  assert.match(manager, /LinkedHashMap<String, WebView>\(16, 0\.75f, true\)/, 'WebView pool must be access-ordered (LRU)')
  assert.match(manager, /MAX_LIVE_WEBVIEWS/, 'WebView pool must be bounded')
  assert.match(manager, /fun webViewFor\(/, 'manager must vend pooled WebViews')

  // RN reference shape (app/screens/TabSwitcherScreen.tsx).
  const rn = read('app/screens/TabSwitcherScreen.tsx')
  assert.match(rn, /id: string/, 'RN BrowserTab id missing')
  assert.match(rn, /url: string/, 'RN BrowserTab url missing')
  assert.match(rn, /title: string/, 'RN BrowserTab title missing')
})

test('Android TabSwitcherScreen mirrors the RN switcher', () => {
  const screen = read(`${KOTLIN_MAIN}/ui/screens/TabSwitcherScreen.kt`)
  assert.match(screen, /fun TabSwitcherScreen\(/, 'Android TabSwitcherScreen missing')
  assert.match(screen, /onSelect: \(String\) -> Unit/, 'select callback missing')
  assert.match(screen, /onClose: \(String\) -> Unit/, 'close callback missing')
  assert.match(screen, /onNewTab: \(\) -> Unit/, 'new-tab callback missing')
  assert.match(screen, /onDismiss: \(\) -> Unit/, 'dismiss callback missing')
  assert.match(screen, /Done/, 'Done button missing')
  assert.match(screen, /if \(tabs\.size != 1\) "s" else ""/, 'tab-count header missing')
  assert.match(screen, /No open tabs/, 'empty state missing')
  assert.match(screen, /Open New Tab/, 'empty-state new-tab button missing')
  assert.match(screen, /New Tab/, 'untitled tab label missing')
  assert.match(screen, /about:blank/, 'url-less tab label missing')
  assert.match(screen, /BackHandler/, 'back must dismiss the switcher')

  const rn = read('app/screens/TabSwitcherScreen.tsx')
  for (const marker of [/onSelect/, /onClose/, /onNewTab/, /onDismiss/, /Done/, /No open tabs/]) {
    assert.match(rn, marker, `RN switcher lost the ${marker} reference marker`)
  }
})

test('Android Browse renders the DESIGN.md bottom bar with tab entry point', () => {
  const screen = read(`${KOTLIN_MAIN}/ui/screens/BrowseScreen.kt`)
  assert.match(screen, /BrowseNavBar/, 'bottom browse nav bar missing')
  assert.match(screen, /canGoBack/, 'back action must track WebView.canGoBack')
  assert.match(screen, /goBack\(\)/, 'back action must call WebView.goBack')
  assert.match(screen, /canGoForward/, 'forward action must track WebView.canGoForward')
  assert.match(screen, /goForward\(\)/, 'forward action must call WebView.goForward')
  assert.match(screen, /reload\(\)/, 'reload action missing')
  assert.match(screen, /\[\$tabCount\]/, 'tab-count button missing')
  assert.match(screen, /onOpenTabs/, 'tab-count button must open the switcher')
  // Existing actions stay integrated in the consolidated page menu.
  assert.match(screen, /DropdownMenu/, 'page-actions menu must stay')
  assert.match(screen, /onFind/, 'find-in-page action must stay')
  assert.match(screen, /if \(bookmarked\) "Remove Bookmark" else "Add Bookmark"/, 'bookmark action states must stay')
  assert.match(screen, /Request Desktop Site/, 'desktop-site action must stay')
  // Back button: in-page history first, then the previous app screen.
  assert.match(screen, /BackHandler/, 'Browse must handle the back button')
  assert.match(screen, /onExitBrowse/, 'back must fall through to the previous app screen')
  // Tab switching must not reload a still-live WebView (LRU pool reuse).
  assert.match(screen, /webViewUrlTab/, 'resolutions must be pinned to their tab')
})

test('Android shell persists and restores the tab session via USERDATA commands', () => {
  const client = read(`${KOTLIN_MAIN}/rpc/PearRpcClient.kt`)
  assert.match(client, /suspend fun getSession\(\)[\s\S]*Cmd\.USERDATA_GET_SESSION/, 'client getSession must use Cmd.USERDATA_GET_SESSION')
  assert.match(client, /suspend fun saveSession[\s\S]*Cmd\.USERDATA_SAVE_SESSION/, 'client saveSession must use Cmd.USERDATA_SAVE_SESSION')

  const rpc = read(`${KOTLIN_MAIN}/rpc/PearRpc.kt`)
  assert.match(rpc, /getSession[\s\S]*Cmd\.USERDATA_GET_SESSION/, 'PearRpc session helper missing shared id')
  assert.match(rpc, /saveSession[\s\S]*Cmd\.USERDATA_SAVE_SESSION/, 'PearRpc save-session helper missing shared id')

  const main = read(`${KOTLIN_MAIN}/MainActivity.kt`)
  assert.match(main, /getSession\(\)/, 'MainActivity must read the session at cold start')
  assert.match(main, /saveSession\(merged\)/, 'MainActivity must persist the session')
  assert.match(main, /browserTabs/, 'session must carry the open tab list')
  assert.match(main, /activeBrowserTabId/, 'session must carry the active tab id')
  assert.match(main, /sessionRestored/, 'saves must wait for the restore to finish')
  assert.match(main, /current \+ buildJsonObject/, 'session writes must merge (RN saveSession parity)')
  assert.match(main, /lastBrowseUrl/, 'RN-written sessions must restore as a fallback tab')
  assert.match(main, /TabSwitcherScreen\(/, 'MainActivity must route to the tab switcher')
  assert.match(main, /onOpenTabs = \{ showTabSwitcher = true \}/, 'Browse must open the switcher')
  assert.match(main, /browseOrigin/, 'back-out of Browse must return to its origin screen')

  // RN reference markers the Android flow mirrors (app/App.tsx session
  // save/restore + app/lib/rpc.ts session wrappers).
  const rnApp = read('app/App.tsx')
  assert.match(rnApp, /getSession\(\)/, 'RN App.tsx session restore is the reference')
  assert.match(rnApp, /saveSession\(\{ activeTab/, 'RN App.tsx saves the active tab')
  assert.match(rnApp, /saveSession\(\{ lastBrowseUrl/, 'RN App.tsx saves the browse url')

  const rnRpc = read('app/lib/rpc.ts')
  assert.match(rnRpc, /USERDATA_GET_SESSION/, 'RN rpc must expose userDataGetSession')
  assert.match(rnRpc, /USERDATA_SAVE_SESSION/, 'RN rpc must expose userDataSaveSession')
})
