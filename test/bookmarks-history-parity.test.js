const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

const userDataCommands = {
  USERDATA_LIST_BOOKMARKS: 50,
  USERDATA_ADD_BOOKMARK: 51,
  USERDATA_REMOVE_BOOKMARK: 52,
  USERDATA_LIST_HISTORY: 53,
  USERDATA_ADD_HISTORY: 54,
  USERDATA_CLEAR_HISTORY: 55,
  USERDATA_GET_SETTINGS: 56,
  USERDATA_SET_SETTINGS: 57
}

test('user-data command ids stay mirrored across platforms', () => {
  const backend = require('../backend/constants')
  const mirrors = [
    'app/lib/constants.ts',
    'ios-native/PearBrowser/Sources/RPC/Protocol.swift',
    'android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt'
  ]

  for (const [name, id] of Object.entries(userDataCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend ${name} id mismatch`)
    for (const rel of mirrors) {
      assert.match(read(rel), new RegExp(`\\b${name}\\b[^0-9]+${id}\\b`), `${rel}: ${name} id mismatch`)
    }
  }
})

test('Android native Bookmarks screen lists, opens, and removes bookmarks', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BookmarksScreen.kt')
  assert.match(screen, /listBookmarks\(\)/, 'Android screen must load bookmarks')
  assert.match(screen, /removeBookmark\(/, 'Android screen must remove bookmarks')
  assert.match(screen, /onOpen\(bookmark\.url\)/, 'Android screen must open bookmarks in Browse')
  assert.match(screen, /No bookmarks yet/, 'Android screen must show an empty state')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of ['USERDATA_LIST_BOOKMARKS', 'USERDATA_ADD_BOOKMARK', 'USERDATA_REMOVE_BOOKMARK']) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `Android RPC client must call Cmd.${name}`)
  }

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(rpc, /listBookmarks\(\)[\s\S]*Cmd\.USERDATA_LIST_BOOKMARKS/, 'PearRpc list helper missing shared id')
  assert.match(rpc, /addBookmark[\s\S]*Cmd\.USERDATA_ADD_BOOKMARK/, 'PearRpc add helper missing shared id')
  assert.match(rpc, /removeBookmark[\s\S]*Cmd\.USERDATA_REMOVE_BOOKMARK/, 'PearRpc remove helper missing shared id')
})

test('Android native History screen lists, opens, clears, and keeps history opt-in', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/HistoryScreen.kt')
  assert.match(screen, /listHistory\(limit = 200\)/, 'Android screen must load history')
  assert.match(screen, /clearHistory\(\)/, 'Android screen must clear history')
  assert.match(screen, /onOpen\(entry\.url\)/, 'Android screen must open history entries in Browse')
  assert.match(screen, /Clear History\?/, 'Android screen must confirm before clearing')
  assert.match(screen, /No history/, 'Android screen must show an empty state')
  // History is opt-in default OFF (privacy): the empty state must explain
  // that and expose the historyEnabled setting toggle.
  assert.match(screen, /off by default/i, 'Android screen must explain the privacy default')
  assert.match(screen, /historyEnabled/, 'Android screen must drive the historyEnabled setting')
  assert.match(screen, /setSettings\(/, 'Android screen must persist the opt-in via setSettings')

  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of ['USERDATA_LIST_HISTORY', 'USERDATA_ADD_HISTORY', 'USERDATA_CLEAR_HISTORY', 'USERDATA_SET_SETTINGS']) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `Android RPC client must call Cmd.${name}`)
  }
  assert.match(client, /historyEnabled/, 'Android settings model must parse historyEnabled')

  const rpc = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt')
  assert.match(rpc, /listHistory[\s\S]*Cmd\.USERDATA_LIST_HISTORY/, 'PearRpc list-history helper missing shared id')
  assert.match(rpc, /clearHistory[\s\S]*Cmd\.USERDATA_CLEAR_HISTORY/, 'PearRpc clear-history helper missing shared id')
  assert.match(rpc, /setSettings[\s\S]*Cmd\.USERDATA_SET_SETTINGS/, 'PearRpc set-settings helper missing shared id')
})

test('Android native Browse exposes a bookmark page action and records history only when opted in', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt')
  assert.match(screen, /toggleBookmark/, 'Browse must expose a bookmark toggle')
  assert.match(screen, /addBookmark\(/, 'Browse must add bookmarks')
  assert.match(screen, /removeBookmark\(/, 'Browse must remove bookmarks')
  assert.match(screen, /if \(bookmarked\) "Remove Bookmark" else "Add Bookmark"/, 'Browse must render add/remove bookmark states')
  assert.match(screen, /settings\?\.historyEnabled != true/, 'Browse must gate history recording on the opt-in')
  assert.match(screen, /addHistory\(/, 'Browse must record history when opted in')
})

test('Android native shell routes Bookmarks and History from the More tab', () => {
  const main = read('android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt')
  assert.match(main, /BookmarksScreen\(/, 'MainActivity does not route to BookmarksScreen')
  assert.match(main, /HistoryScreen\(/, 'MainActivity does not route to HistoryScreen')
  assert.match(main, /MoreScreen\([\s\S]*onOpenBookmarks/, 'MoreScreen does not expose Bookmarks navigation')
  assert.match(main, /MoreScreen\([\s\S]*onOpenHistory/, 'MoreScreen does not expose History navigation')
  assert.match(main, /MoreScreen\([\s\S]*onOpenConnectedApps/, 'MoreScreen must keep the Connected Apps route')

  const more = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/MoreScreen.kt')
  assert.match(more, /title = "Bookmarks"/, 'More tab Bookmarks entry missing')
  assert.match(more, /title = "History"/, 'More tab History entry missing')
  assert.match(more, /onOpenBookmarks/, 'More tab does not call the Bookmarks route')
  assert.match(more, /onOpenHistory/, 'More tab does not call the History route')
})

test('Android native shell handles hyper, pear, and hyperbee VIEW deep links', () => {
  const main = read('android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt')
  assert.match(main, /onNewIntent/, 'MainActivity must handle warm-start deep links')
  assert.match(main, /Intent\.ACTION_VIEW/, 'MainActivity must gate on VIEW intents')
  assert.match(main, /"hyper", "hyperbee"/, 'MainActivity must accept hyper and hyperbee links')
  assert.match(main, /"pear" -> Pear\(raw\)/, 'MainActivity must stub pear links')
  assert.match(main, /onNavigate\(link\.url\)/, 'hyper links must route into Browse navigation')
  assert.match(main, /Pear link/, 'pear links must surface a stub message')

  const manifest = read('android-native/app/src/main/AndroidManifest.xml')
  for (const scheme of ['hyper', 'pear', 'hyperbee']) {
    assert.match(manifest, new RegExp(`android:scheme="${scheme}"`), `manifest must declare the ${scheme} scheme`)
  }
})

test('bookmarks and history screens exist in all three shells', () => {
  const ios = read('ios-native/PearBrowser/Sources/UI/Screens/BookmarksScreen.swift')
  assert.match(ios, /listBookmarks\(\)/, 'iOS Bookmarks must load bookmarks')
  assert.match(ios, /removeBookmark\(url:/, 'iOS Bookmarks must remove bookmarks')

  const iosHistory = read('ios-native/PearBrowser/Sources/UI/Screens/HistoryScreen.swift')
  assert.match(iosHistory, /listHistory\(limit: 200\)/, 'iOS History must load history')
  assert.match(iosHistory, /clearHistory\(\)/, 'iOS History must clear history')

  const rn = read('app/screens/BookmarksScreen.tsx')
  assert.match(rn, /getBookmarks|userDataListBookmarks/, 'RN Bookmarks must load bookmarks')

  const rnHistory = read('app/screens/HistoryScreen.tsx')
  assert.match(rnHistory, /getHistory|userDataListHistory/, 'RN History must load history')
})
