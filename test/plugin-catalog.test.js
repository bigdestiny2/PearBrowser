'use strict'

/**
 * Plugin catalogue tests — ported from
 * pearbrowser-desktop/test/plugin-catalog.test.js (converted to this repo's
 * CJS test style). Adaptations: ANONGPT_DRIVE_KEY comes from the ported
 * backend/plugin-catalog.cjs (mobile constants.js is a pure RPC-id mirror),
 * and the shipped catalogue source is read from this repo's own
 * catalogues/pear-plugins/plugins.json (ported seed data).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  PluginCatalog,
  PluginCatalogError,
  BUILTIN_PLUGIN_CATALOG,
  validateCatalogEntry,
  ANONGPT_DRIVE_KEY
} = require('../backend/plugin-catalog.cjs')

const root = path.join(__dirname, '..')
const CAT_KEY = 'f0'.repeat(32)

function makeCatalog (files = {}, opts = {}) {
  return new PluginCatalog({
    fetchDriveFile: async (driveKey, filePath) => {
      const value = files[filePath]
      return value == null ? null : { content: Buffer.from(value) }
    },
    now: () => 4242,
    ...opts
  })
}

test('builtin seed lists anonGPT with its production drive key, installable by the user', () => {
  const catalog = makeCatalog()
  const entries = catalog.entries()

  const anongpt = entries.find(entry => entry.id === 'anongpt')
  assert.ok(anongpt, 'anonGPT is in the builtin catalogue')
  assert.equal(anongpt.kind, 'app')
  assert.equal(anongpt.driveKey, ANONGPT_DRIVE_KEY)
  assert.equal(anongpt.verified, true)
  assert.equal(anongpt.source, 'builtin')

  // Example plugins carry their published drive keys (2026-07-16).
  const darkReader = entries.find(entry => entry.id === 'pear-dark-reader')
  assert.ok(darkReader)
  assert.equal(darkReader.driveKey, 'bbde8330169798dc5e0d08f8909b407cea2f8fec7e31d6241f479c714ad42082')
  assert.equal(darkReader.kind, 'plugin')
  const enhancer = entries.find(entry => entry.id === 'peerit-enhancer')
  assert.equal(enhancer.driveKey, '1b21d8a6960bdcdfb76da94b80dae0d1a28247516de87e6839ea2f87bb609e10')
  assert.equal(BUILTIN_PLUGIN_CATALOG.length, 3)
})

test('a catalogue drive loads, validates entries, and merges after builtin', async () => {
  const pluginKey = 'ab'.repeat(32)
  const refreshes = []
  const catalog = makeCatalog({
    '/plugins.json': JSON.stringify({
      name: 'Community Plugins',
      plugins: [
        { driveKey: pluginKey, name: 'Community Styler', kind: 'plugin', capabilities: ['pear.content.styles'], description: 'x', verified: true },
        { driveKey: 'not-a-key', name: 'Broken entry' },
        { name: 'No key at all' },
        { driveKey: ANONGPT_DRIVE_KEY, name: 'anonGPT shadow attempt', kind: 'app' },
        42
      ]
    })
  }, { refreshDrive: async (key) => { refreshes.push(key) } })

  const result = await catalog.loadFromDrive(CAT_KEY)
  assert.deepEqual(refreshes, [CAT_KEY])
  assert.equal(result.name, 'Community Plugins')
  assert.equal(result.entryCount, 2) // styler + shadow attempt survive validation

  const entries = catalog.entries()
  const styler = entries.find(entry => entry.driveKey === pluginKey)
  assert.equal(styler.source, CAT_KEY)
  assert.equal(styler.verified, false, 'community sources cannot mint the curated trust mark')

  // Builtin wins the dedupe: the shadow entry cannot replace anonGPT.
  const anongpt = entries.filter(entry => entry.driveKey === ANONGPT_DRIVE_KEY)
  assert.equal(anongpt.length, 1)
  assert.equal(anongpt[0].name, 'anonGPT')
  assert.equal(anongpt[0].source, 'builtin')

  assert.deepEqual(catalog.sources(), [{
    driveKey: CAT_KEY, name: 'Community Plugins', entryCount: 2, loadedAt: 4242
  }])
})

test('catalogue failures are typed and fail closed', async () => {
  await assert.rejects(makeCatalog().loadFromDrive('nope'), err => err.code === 'invalid-drive-key')
  await assert.rejects(makeCatalog({}).loadFromDrive(CAT_KEY), err => err.code === 'catalog-unavailable')
  await assert.rejects(
    makeCatalog({ '/plugins.json': 'not json' }).loadFromDrive(CAT_KEY),
    err => err.code === 'catalog-invalid'
  )
  await assert.rejects(
    makeCatalog({ '/plugins.json': JSON.stringify({ plugins: [{ name: 'keyless' }] }) }).loadFromDrive(CAT_KEY),
    err => err.code === 'catalog-empty'
  )
  assert.ok(new PluginCatalogError('x', 'y') instanceof Error)
})

test('sources persist through exportState/restore and can be removed', async () => {
  const pluginKey = 'cd'.repeat(32)
  const first = makeCatalog({
    '/plugins.json': JSON.stringify({
      name: 'Community',
      plugins: [{ driveKey: pluginKey, name: 'Styler', capabilities: ['pear.content.styles'] }]
    })
  })
  await first.loadFromDrive(CAT_KEY)
  const durable = first.exportState()

  const second = makeCatalog({})
  assert.equal(second.restore(durable), 1)
  assert.ok(second.entries().some(entry => entry.driveKey === pluginKey))

  assert.equal(second.removeSource(CAT_KEY), true)
  assert.equal(second.entries().some(entry => entry.driveKey === pluginKey), false)
  assert.deepEqual(second.exportState(), { sources: {} })
})

test('entry validation caps and normalizes fields', () => {
  const entry = validateCatalogEntry({
    driveKey: 'AB'.repeat(32),
    name: '  Padded name  ',
    kind: 'weird-kind',
    description: 'd'.repeat(2000),
    capabilities: ['pear.content.styles', '', 42, 'x'.repeat(200), 'a', 'b', 'c', 'd', 'e', 'f'],
    verified: 'yes'
  })
  assert.equal(entry.driveKey, 'ab'.repeat(32))
  assert.equal(entry.name, 'Padded name')
  assert.equal(entry.kind, 'plugin')
  assert.equal(entry.description.length, 500)
  assert.equal(entry.capabilities.length, 8)
  assert.equal(entry.verified, false)
  assert.equal(validateCatalogEntry({ driveKey: 'ab'.repeat(32) }), null) // no name
})

test('the shippable catalogue source parses and its anonGPT entry matches the builtin key', async () => {
  const raw = fs.readFileSync(path.join(root, 'catalogues/pear-plugins/plugins.json'))
  const catalog = makeCatalog({ '/plugins.json': raw })
  const result = await catalog.loadFromDrive(CAT_KEY)
  assert.ok(result.entryCount >= 1)

  const parsed = JSON.parse(raw.toString('utf8'))
  const anongpt = parsed.plugins.find(entry => entry.id === 'anongpt')
  assert.equal(anongpt.driveKey, ANONGPT_DRIVE_KEY)
})
