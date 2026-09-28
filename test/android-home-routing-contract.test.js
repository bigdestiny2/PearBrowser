const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const home = fs.readFileSync(path.join(root, 'android-native/app/src/main/java/com/pearbrowser/app/ui/screens/HomeScreen.kt'), 'utf8')
const main = fs.readFileSync(path.join(root, 'android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt'), 'utf8')
const search = fs.readFileSync(path.join(root, 'android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SearchScreen.kt'), 'utf8')

test('Android Home sends plain text to local Search while retaining explicit navigation', () => {
  assert.match(home, /homeDriveKey\.matches\(input\).*HomeInputTarget\.Navigate\("hyper:\/\//)
  assert.match(home, /input\.contains\(":\/\/"\) \|\| homeHost\.matches\(input\).*HomeInputTarget\.Navigate\(input\)/)
  assert.match(home, /return HomeInputTarget\.Search\(input\)/)
  assert.match(home, /is HomeInputTarget\.Search -> onSearch\(target\.query\)/)
  assert.match(main, /onSearch = \{ query ->[\s\S]*?searchQuery = query[\s\S]*?moreRoute = MoreRoute\.Search[\s\S]*?activeTab = Tab\.More/)
  assert.match(main, /MoreRoute\.Search -> SearchScreen\(\s*initialQuery = searchQuery/)
  assert.match(search, /LaunchedEffect\(initialQuery, rpc\) \{\s*if \(initialQuery\.isNotBlank\(\) && rpc != null\) runSearch\(\)/)
})
