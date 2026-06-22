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
    'normalizeCatalogLink',
    'normalizeDriveKey',
    'driveKeyFromHyperLink',
    'root["entries"]',
    'val target = site.link',
    '"pear", "file" ->'
  ])
})
