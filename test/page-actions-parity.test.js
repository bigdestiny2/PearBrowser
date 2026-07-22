const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function includesAll (source, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(source.includes(fragment), `${label}: missing ${fragment}`)
  }
}

test('React Native Browse exposes a working mainstream page-actions menu', () => {
  const source = read('app/screens/BrowseScreen.tsx')
  includesAll(source, [
    'accessibilityLabel="Page actions"',
    'accessibilityLabel="Share current page"',
    'Share.share({ message: currentUrl, url: currentUrl })',
    'Clipboard.setString(currentUrl)',
    'getBookmarks()',
    'addBookmark(currentUrl, pageTitle || currentUrl)',
    'removeBookmark(currentUrl)',
    'accessibilityLabel="Reload page"',
    'accessibilityLabel="Find in page"',
    "desktopSiteRequested ? 'Request Mobile Site' : 'Request Desktop Site'",
    'userAgent={desktopSiteRequested ? DESKTOP_USER_AGENT : undefined}',
    'webViewRef.current?.reload()'
  ], 'BrowseScreen.tsx')
})

test('iOS Browse uses native page actions and reloads WebKit in desktop mode', () => {
  const source = read('ios-native/PearBrowser/Sources/UI/Screens/BrowseScreen.swift')
  includesAll(source, [
    'Menu {',
    'Label("Share", systemImage: "square.and.arrow.up")',
    'UIPasteboard.general.string = urlString',
    'host.rpc.addBookmark(',
    'host.rpc.removeBookmark(url: urlString)',
    'Label("Reload", systemImage: "arrow.clockwise")',
    'Label("Find in Page", systemImage: "magnifyingglass")',
    'desktopSiteRequested ? "Request Mobile Site" : "Request Desktop Site"',
    'webView.customUserAgent = desktopSiteRequested ? pearDesktopUserAgent : nil',
    'preferredContentMode = desktopSiteRequested ? .desktop : .mobile',
    'webView.reload()',
    'ShareSheet(activityItems: [shareItem])',
    'onShareRequested(url)'
  ], 'BrowseScreen.swift')
})

test('Android Browse keeps page actions together and desktop mode per tab', () => {
  const source = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt')
  includesAll(source, [
    'DropdownMenu(',
    'Text("Share")',
    'Text("Copy Link")',
    'if (bookmarked) "Remove Bookmark" else "Add Bookmark"',
    'Text("Reload")',
    'Text("Find in Page")',
    'if (desktopSiteRequested) "Request Mobile Site" else "Request Desktop Site"',
    'clipboard.setText(AnnotatedString(it))',
    'shareLink(context, target)',
    'desktopTabIds',
    'applyDesktopSiteMode(web, desktopSiteRequested)',
    'webView.settings.userAgentString',
    'webView.settings.useWideViewPort = requested',
    'webView.settings.loadWithOverviewMode = requested'
  ], 'BrowseScreen.kt')
})
