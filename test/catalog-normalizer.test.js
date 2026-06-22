const { test } = require('node:test')
const assert = require('node:assert/strict')
require('./_stubs')

const {
  CatalogManager,
  catalogAppSearchText,
  catalogAppsFromEnvelope,
  normalizeCatalogApp,
  normalizeCatalogData,
} = require('../backend/catalog-manager')

test('catalog normalizer accepts HiveRelay items envelope', () => {
  const appKey = 'a'.repeat(64)
  const catalog = normalizeCatalogData({
    version: 2,
    name: 'HiveRelay Content Catalog',
    items: [
      {
        appKey,
        type: 'drive',
        name: 'Relay Site',
        description: 'Pinned public drive',
      },
    ],
  })

  assert.equal(catalog.apps.length, 1)
  assert.equal(catalog.apps[0].driveKey, appKey)
  assert.equal(catalog.apps[0].id, appKey)
  assert.equal(catalog.items.length, 1)
})

test('catalog normalizer accepts legacy entries envelope', () => {
  const key = 'b'.repeat(64)
  const catalog = normalizeCatalogData({
    version: 1,
    name: 'Legacy Relay',
    entries: [
      { key, name: 'Legacy Entry' },
    ],
  })

  assert.equal(catalog.apps.length, 1)
  assert.equal(catalog.apps[0].driveKey, key)
  assert.equal(catalog.apps[0].id, key)
})

test('catalog normalizer derives drive key from hyper link', () => {
  const key = 'c'.repeat(64)
  const app = normalizeCatalogApp({
    link: `hyper://${key}/index.html`,
    name: 'Linked Site',
  })

  assert.equal(app.driveKey, key)
  assert.equal(app.id, key)
})

test('catalog normalizer rejects unsafe or targetless rows and keeps safe link-only apps', () => {
  assert.equal(normalizeCatalogApp({ id: 'targetless', name: 'No target' }), null)
  assert.equal(normalizeCatalogApp({ id: 'bad-key', driveKey: 'not-a-key', name: 'Bad key' }), null)
  assert.equal(normalizeCatalogApp({ id: 'bad-link', link: 'javascript:alert(1)', name: 'Bad link' }), null)

  assert.deepEqual(normalizeCatalogApp({
    id: 'linked',
    name: '  Keet  ',
    link: ' PEAR://keet ',
    categories: [' chat ', '']
  }), {
    id: 'linked',
    name: 'Keet',
    link: 'pear://keet',
    description: '',
    author: '',
    version: '',
    categories: ['chat'],
  })
})

test('catalog search text includes visible metadata and is null-query safe', () => {
  const manager = new CatalogManager(null, null)
  manager.catalogs.set('signed-bee:cat', {
    data: {
      apps: [
        { id: 'alpha', name: 'Alpha', description: 'First', author: 'Holepunch', version: '2.1.0', categories: ['Tools'], driveKey: 'd'.repeat(64) },
        { id: 'beta', name: 'Beta', description: 'Second', link: 'pear://beta' }
      ]
    }
  })

  assert.match(catalogAppSearchText(manager.getAllApps()[0]), /holepunch/)
  assert.deepEqual(manager.searchApps(null).map((a) => a.id), ['alpha', 'beta'])
  assert.deepEqual(manager.searchApps('tools').map((a) => a.id), ['alpha'])
  assert.deepEqual(manager.searchApps('pear://beta').map((a) => a.id), ['beta'])
})

test('catalog JSON parse strips prototype-pollution keys recursively', () => {
  const manager = new CatalogManager(null, null)
  const parsed = manager._safeJSONParse(`{
    "name": "Bad Catalog",
    "__proto__": { "polluted": true },
    "constructor": { "prototype": { "polluted": true } },
    "items": [
      {
        "name": "App",
        "__proto__": { "polluted": true },
        "nested": {
          "constructor": { "prototype": { "polluted": true } },
          "rows": [{ "prototype": { "polluted": true }, "ok": true }]
        }
      }
    ]
  }`)

  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'constructor'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.items[0], '__proto__'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.items[0].nested, 'constructor'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.items[0].nested.rows[0], 'prototype'), false)
  assert.equal(parsed.items[0].nested.rows[0].ok, true)
  assert.equal({}.polluted, undefined)
})

test('catalogAppsFromEnvelope returns empty list for malformed envelopes', () => {
  assert.deepEqual(catalogAppsFromEnvelope(null), [])
  assert.deepEqual(catalogAppsFromEnvelope([]), [])
  assert.deepEqual(catalogAppsFromEnvelope({ apps: {} }), [])
})

test('getAllApps normalizes cached raw catalog entries for update checks', () => {
  const key = 'd'.repeat(64)
  const manager = new CatalogManager(null, null)
  manager.catalogs.set('legacy', {
    data: {
      entries: [
        { appKey: key, name: 'Cached Entry', version: '1.2.3' },
      ],
    },
  })

  const apps = manager.getAllApps()
  assert.equal(apps.length, 1)
  assert.equal(apps[0].id, key)
  assert.equal(apps[0].driveKey, key)
  assert.equal(apps[0].catalogKey, 'legacy')
})
