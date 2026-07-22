'use strict'

/**
 * Plugin drive loader tests — ported from
 * pearbrowser-desktop/test/plugin-drive-loader.test.js (converted to this
 * repo's CJS test style). backend/plugin-drive-loader.cjs is a verbatim
 * port, so these assert the same security contract: snapshot-bound install
 * consent, the capability-escalation guard, and fail-closed asset handling.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const { ContentShield } = require('../backend/content-shield.cjs')
const { PearPluginRegistry } = require('../backend/pear-plugins.cjs')
const { PluginDriveLoader, PluginDriveError, MAX_ASSET_BYTES } = require('../backend/plugin-drive-loader.cjs')

const KEY = 'a1'.repeat(32)

function pluginManifest (capabilities, content, version = '1.0.0') {
  return JSON.stringify({
    name: 'Fixture Plugin',
    version,
    pear: { plugin: { capabilities, content } }
  })
}

function makeLoader (files) {
  const shield = new ContentShield({ builtinList: false })
  const registry = new PearPluginRegistry({ shield })
  const persisted = new Map()
  const store = { ...files }
  const refreshes = []
  const loader = new PluginDriveLoader({
    registry,
    fetchDriveFile: async (driveKey, path) => {
      const value = store[path]
      return value == null ? null : { content: Buffer.from(value) }
    },
    refreshDrive: async (driveKey) => { refreshes.push(driveKey) },
    sha256Hex: (input) => createHash('sha256').update(input).digest('hex'),
    persistInstall: async (id, payload) => {
      if (payload === null) persisted.delete(id)
      else persisted.set(id, structuredClone(payload))
    },
    now: () => 99
  })
  return { loader, registry, shield, persisted, store, refreshes }
}

async function approveInstall (loader, key = KEY, granted) {
  const preview = await loader.installFromDrive(key)
  assert.equal(preview.consentRequired, true)
  return loader.installFromDrive(key, {
    grantedCapabilities: granted === undefined ? preview.requested : granted,
    reviewedFingerprint: preview.fingerprint
  })
}

test('install from a drive fetches assets and applies the contribution', async () => {
  const { loader, registry, shield, persisted, refreshes } = makeLoader({
    '/manifest.json': pluginManifest(
      ['pear.content.styles', 'pear.content.scripts', 'pear.net.filter'],
      {
        styles: { matches: ['*'], path: '/style.css' },
        scripts: { matches: ['*'], path: '/content.js' },
        filters: '/filters.txt'
      }
    ),
    '/style.css': '.fixture-hide { display: none }',
    '/content.js': 'window.__fixture = 1',
    '/filters.txt': '||fixture-ads.example.com^'
  })

  const preview = await loader.installFromDrive(KEY)
  assert.equal(preview.consentRequired, true)
  assert.deepEqual(refreshes, [KEY])
  assert.deepEqual(preview.requested, ['pear.content.styles', 'pear.content.scripts', 'pear.net.filter'])
  assert.equal(registry.list().length, 0)
  const result = await loader.installFromDrive(KEY, {
    grantedCapabilities: preview.requested,
    reviewedFingerprint: preview.fingerprint
  })
  assert.deepEqual(refreshes, [KEY, KEY])
  assert.equal(result.ok, true)
  assert.equal(result.version, '1.0.0')
  assert.deepEqual(result.granted, ['pear.content.styles', 'pear.content.scripts', 'pear.net.filter'])

  const listed = registry.list().find(item => item.id === KEY)
  assert.ok(listed)
  assert.equal(listed.enabled, true)

  assert.equal(shield.shouldBlockUrl('https://fixture-ads.example.com/x.js').blocked, true)
  assert.ok(shield.pluginStylesFor('anything.example').includes('.fixture-hide'))
  assert.ok(shield.pluginScriptsFor('anything.example').some(item => (item.body || '').includes('__fixture')))

  const payload = persisted.get(KEY)
  assert.equal(payload.version, '1.0.0')
  assert.deepEqual(payload.granted, result.granted)
})

test('a narrower explicit grant strips ungranted capabilities before the engine', async () => {
  const { loader, shield } = makeLoader({
    '/manifest.json': pluginManifest(
      ['pear.content.styles', 'pear.net.filter'],
      {
        styles: { matches: ['*'], path: '/style.css' },
        filters: '/filters.txt'
      }
    ),
    '/style.css': '.fixture-hide { display: none }',
    '/filters.txt': '||fixture-ads.example.com^'
  })

  const result = await approveInstall(loader, KEY, ['pear.content.styles'])
  assert.deepEqual(result.granted, ['pear.content.styles'])

  // Styles applied, network filter NOT applied (capability was not granted).
  assert.ok(shield.pluginStylesFor('x.example').includes('.fixture-hide'))
  assert.equal(shield.shouldBlockUrl('https://fixture-ads.example.com/x.js').blocked, false)
})

test('an update that escalates capabilities disables the plugin pending re-consent', async () => {
  const { loader, registry, store } = makeLoader({
    '/manifest.json': pluginManifest(['pear.content.styles'], {
      styles: { matches: ['*'], path: '/style.css' }
    }),
    '/style.css': '.fixture-hide { display: none }'
  })
  await approveInstall(loader)

  // The drive updates itself over the swarm: same plugin, new powers.
  store['/manifest.json'] = pluginManifest(
    ['pear.content.styles', 'pear.content.scripts'],
    {
      styles: { matches: ['*'], path: '/style.css' },
      scripts: { matches: ['*'], path: '/content.js' }
    },
    '2.0.0'
  )
  store['/content.js'] = 'window.__sneaky = 1'

  const outcome = await loader.updateFromDrive(KEY)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.escalated, true)
  assert.deepEqual(outcome.added, ['pear.content.scripts'])

  const listed = registry.list().find(item => item.id === KEY)
  assert.equal(listed.enabled, false)
  assert.equal(loader.installRecord(KEY).escalated.added[0], 'pear.content.scripts')

  // Explicit re-consent accepts the escalation and re-enables.
  const accepted = await loader.updateFromDrive(KEY, {
    grantedCapabilities: outcome.capabilities,
    reviewedFingerprint: outcome.fingerprint
  })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.escalationAccepted, true)
  assert.deepEqual(accepted.granted, ['pear.content.styles', 'pear.content.scripts'])
  assert.equal(registry.list().find(item => item.id === KEY).enabled, true)
})

test('install and escalation consent are bound to the exact reviewed snapshot', async () => {
  const { loader, registry, store } = makeLoader({
    '/manifest.json': pluginManifest(['pear.content.styles'], {
      styles: { matches: ['*'], path: '/style.css' }
    }),
    '/style.css': '.v1 { color: red }'
  })

  const installPreview = await loader.installFromDrive(KEY)
  store['/style.css'] = '.v2 { color: blue }'
  const changedInstall = await loader.installFromDrive(KEY, {
    grantedCapabilities: installPreview.requested,
    reviewedFingerprint: installPreview.fingerprint
  })
  assert.equal(changedInstall.consentRequired, true)
  assert.equal(changedInstall.reason, 'plugin-changed')
  assert.equal(registry.list().length, 0)

  await approveInstall(loader)
  store['/manifest.json'] = pluginManifest(['pear.content.styles', 'pear.content.scripts'], {
    styles: { matches: ['*'], path: '/style.css' },
    scripts: { matches: ['*'], path: '/content.js' }
  }, '2.0.0')
  store['/content.js'] = 'window.__v2 = true'
  const warning = await loader.updateFromDrive(KEY)

  // Publisher changes the reviewed snapshot before the user accepts it.
  store['/manifest.json'] = pluginManifest(['pear.content.styles', 'pear.content.scripts', 'pear.net.filter'], {
    styles: { matches: ['*'], path: '/style.css' },
    scripts: { matches: ['*'], path: '/content.js' },
    filters: '/filters.txt'
  }, '2.1.0')
  store['/filters.txt'] = '||new-power.example^'
  const raced = await loader.updateFromDrive(KEY, {
    grantedCapabilities: warning.capabilities,
    reviewedFingerprint: warning.fingerprint
  })
  assert.equal(raced.escalated, true)
  assert.equal(raced.changedSinceReview, true)
  assert.deepEqual(raced.added, ['pear.content.scripts', 'pear.net.filter'])
  assert.equal(registry.list().find(item => item.id === KEY).enabled, false)
})

test('a same-capability update hot-swaps without consent friction', async () => {
  const { loader, shield, store } = makeLoader({
    '/manifest.json': pluginManifest(['pear.content.styles'], {
      styles: { matches: ['*'], path: '/style.css' }
    }),
    '/style.css': '.v1 { display: none }'
  })
  await approveInstall(loader)

  store['/manifest.json'] = pluginManifest(['pear.content.styles'], {
    styles: { matches: ['*'], path: '/style.css' }
  }, '1.1.0')
  store['/style.css'] = '.v2 { display: none }'

  const outcome = await loader.updateFromDrive(KEY)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.version, '1.1.0')
  assert.ok(shield.pluginStylesFor('x.example').includes('.v2'))
})

test('missing manifests, invalid assets, and oversized assets fail closed', async () => {
  const none = makeLoader({})
  await assert.rejects(none.loader.installFromDrive(KEY), err => err.code === 'manifest-unavailable')

  const notPlugin = makeLoader({ '/manifest.json': JSON.stringify({ name: 'app' }) })
  await assert.rejects(notPlugin.loader.installFromDrive(KEY), err => err.code === 'not-a-plugin')

  const missingAsset = makeLoader({
    '/manifest.json': pluginManifest(['pear.content.styles'], {
      styles: { matches: ['*'], path: '/style.css' }
    })
  })
  await assert.rejects(missingAsset.loader.installFromDrive(KEY), err => err.code === 'asset-unavailable')

  const traversal = makeLoader({
    '/manifest.json': pluginManifest(['pear.content.styles'], {
      styles: { matches: ['*'], path: '/../escape.css' }
    })
  })
  await assert.rejects(traversal.loader.installFromDrive(KEY), err => err.code === 'asset-path-invalid')

  const oversized = makeLoader({
    '/manifest.json': pluginManifest(['pear.content.styles'], {
      styles: { matches: ['*'], path: '/style.css' }
    }),
    '/style.css': 'x'.repeat(MAX_ASSET_BYTES + 1)
  })
  await assert.rejects(oversized.loader.installFromDrive(KEY), err => err.code === 'asset-too-large')

  assert.ok(new PluginDriveError('x', 'y') instanceof Error)
})

test('uninstall removes the registration and the durable payload', async () => {
  const { loader, registry, shield, persisted } = makeLoader({
    '/manifest.json': pluginManifest(['pear.content.styles', 'pear.net.filter'], {
      styles: { matches: ['*'], path: '/style.css' },
      filters: '/filters.txt'
    }),
    '/style.css': '.fixture-hide { display: none }',
    '/filters.txt': '||fixture-ads.example.com^'
  })
  await approveInstall(loader)
  assert.equal(shield.shouldBlockUrl('https://fixture-ads.example.com/x.js').blocked, true)

  const removed = await loader.uninstall(KEY)
  assert.equal(removed.removed, true)
  assert.equal(registry.list().length, 0)
  assert.equal(persisted.has(KEY), false)
  assert.equal(shield.shouldBlockUrl('https://fixture-ads.example.com/x.js').blocked, false)
  assert.equal(shield.pluginStylesFor('x.example'), '')
})
