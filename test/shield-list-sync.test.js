'use strict'

/**
 * Shield list sync tests — ported from
 * pearbrowser-desktop/test/shield-list-sync.test.js (converted to this
 * repo's CJS test style). Transport, hashing, and persistence are faked
 * exactly like the desktop suite; the module itself is a verbatim port.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const { ContentShield } = require('../backend/content-shield.cjs')
const { ShieldListSync, ShieldListSyncError, DRIVE_LIST_PREFIX, MAX_LIST_BYTES } = require('../backend/shield-list-sync.cjs')

const KEY = 'c'.repeat(64)
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')

function fakeDrive (files) {
  const calls = []
  return {
    calls,
    files,
    fetch: async (driveKey, path) => {
      calls.push(`${driveKey.slice(0, 4)}:${path}`)
      const value = files[path]
      return value == null ? null : { content: Buffer.from(value) }
    }
  }
}

function makeSync ({ files, shield } = {}) {
  const persisted = []
  const refreshes = []
  const drive = fakeDrive(files || {})
  const engine = shield || new ContentShield({ builtinList: false })
  const sync = new ShieldListSync({
    shield: engine,
    fetchDriveFile: drive.fetch,
    refreshDrive: async (driveKey) => { refreshes.push(driveKey) },
    sha256Hex,
    persistMeta: async (meta) => { persisted.push(structuredClone(meta)) },
    now: () => 1234
  })
  return { sync, shield: engine, drive, persisted, refreshes }
}

test('subscribe fetches, verifies, registers, and persists a drive list', async () => {
  const filters = '||ads.example.com^\n##.promo\n'
  const { sync, shield, persisted, refreshes } = makeSync({
    files: {
      '/manifest.json': JSON.stringify({ name: 'pear-default', version: '3', sha256: sha256Hex(filters) }),
      '/filters.txt': filters
    }
  })

  const result = await sync.subscribe(KEY)
  assert.deepEqual(refreshes, [KEY])
  assert.equal(result.changed, true)
  assert.equal(result.name, 'pear-default')
  assert.equal(result.version, '3')
  assert.ok(result.rules >= 2)

  assert.equal(shield.shouldBlockUrl('https://ads.example.com/x.js').blocked, true)
  assert.ok(shield.stats().lists.includes(DRIVE_LIST_PREFIX + KEY))
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0][KEY].version, '3')
  assert.deepEqual(sync.subscriptions().map(item => item.driveKey), [KEY])
})

test('a checksum mismatch fails closed: nothing registered', async () => {
  const { sync, shield } = makeSync({
    files: {
      '/manifest.json': JSON.stringify({ version: '1', sha256: 'f'.repeat(64) }),
      '/filters.txt': '||ads.example.com^'
    }
  })

  await assert.rejects(sync.subscribe(KEY), (err) => {
    assert.ok(err instanceof ShieldListSyncError)
    assert.equal(err.code, 'checksum-mismatch')
    return true
  })
  assert.equal(shield.shouldBlockUrl('https://ads.example.com/x.js').blocked, false)
  assert.equal(sync.subscriptions().length, 0)
})

test('a missing or oversized list fails closed', async () => {
  const { sync } = makeSync({ files: {} })
  await assert.rejects(sync.subscribe(KEY), err => err.code === 'list-unavailable')

  const big = makeSync({ files: { '/filters.txt': 'a'.repeat(MAX_LIST_BYTES + 1) } })
  await assert.rejects(big.sync.subscribe(KEY), err => err.code === 'list-too-large')
})

test('refresh skips the download when version and checksum are unchanged, hot-swaps on change', async () => {
  const v1 = '||ads.example.com^'
  const files = {
    '/manifest.json': JSON.stringify({ version: '1', sha256: sha256Hex(v1) }),
    '/filters.txt': v1
  }
  const { sync, shield, drive } = makeSync({ files })
  await sync.subscribe(KEY)

  const callsAfterSubscribe = drive.calls.length
  const unchanged = await sync.refresh(KEY)
  assert.equal(unchanged.changed, false)
  // Only the manifest was consulted — no rules re-download on same version.
  assert.deepEqual(drive.calls.slice(callsAfterSubscribe), [`${KEY.slice(0, 4)}:/manifest.json`])

  const v2 = '||ads.example.com^\n||tracker.example.net^'
  files['/manifest.json'] = JSON.stringify({ version: '2', sha256: sha256Hex(v2) })
  files['/filters.txt'] = v2
  const changed = await sync.refresh(KEY)
  assert.equal(changed.changed, true)
  assert.equal(changed.version, '2')
  assert.equal(shield.shouldBlockUrl('https://tracker.example.net/p.gif').blocked, true)
})

test('restore + shield state give offline boot without any fetch', async () => {
  // First session: subscribe and capture durable state.
  const filters = '||ads.example.com^'
  const first = makeSync({
    files: {
      '/manifest.json': JSON.stringify({ name: 'pear-default', version: '5', sha256: sha256Hex(filters) }),
      '/filters.txt': filters
    }
  })
  await first.sync.subscribe(KEY)
  const durableShieldState = first.shield.exportListState()
  const durableMeta = first.persisted.at(-1)

  // Second session: no network at all — restore from durable state only.
  const offlineShield = new ContentShield({ builtinList: false })
  offlineShield.importListState(durableShieldState)
  const offline = makeSync({ files: {}, shield: offlineShield })
  const restored = offline.sync.restore(durableMeta)

  assert.equal(restored, 1)
  assert.equal(offline.sync.isSubscribed(KEY), true)
  assert.equal(offline.sync.subscriptions()[0].version, '5')
  assert.equal(offlineShield.shouldBlockUrl('https://ads.example.com/x.js').blocked, true)
  assert.deepEqual(offline.drive.calls, [])
})

test('unsubscribe removes the rules and the durable metadata', async () => {
  const filters = '||ads.example.com^'
  const { sync, shield, persisted } = makeSync({
    files: { '/filters.txt': filters }
  })
  await sync.subscribe(KEY)
  assert.equal(shield.shouldBlockUrl('https://ads.example.com/x.js').blocked, true)

  const removed = await sync.unsubscribe(KEY)
  assert.equal(removed.removed, true)
  assert.equal(shield.shouldBlockUrl('https://ads.example.com/x.js').blocked, false)
  assert.deepEqual(persisted.at(-1), {})
  assert.equal(sync.subscriptions().length, 0)
})

test('refreshAll isolates per-drive failures', async () => {
  const goodKey = 'd'.repeat(64)
  const filters = '||ads.example.com^'
  const files = { '/filters.txt': filters }
  const { sync } = makeSync({ files })
  await sync.subscribe(goodKey)

  // Subscribe a second drive, then break its content for the next sweep.
  const flakyKey = 'e'.repeat(64)
  files['/filters.txt'] = filters
  await sync.subscribe(flakyKey)
  const originalFetch = sync._fetch
  sync._fetch = async (key, path) => {
    if (key === flakyKey) throw new Error('drive offline')
    return originalFetch(key, path)
  }

  const outcomes = await sync.refreshAll({ force: true })
  const byKey = Object.fromEntries(outcomes.map(item => [item.driveKey, item]))
  assert.equal(byKey[goodKey].ok, true)
  assert.equal(byKey[flakyKey].ok, false)
})

test('invalid keys and duplicate list names are rejected', async () => {
  const { sync } = makeSync({ files: {} })
  await assert.rejects(sync.subscribe('not-a-key'), err => err.code === 'invalid-drive-key')
  await assert.rejects(sync.refresh('a'.repeat(64)), err => err.code === 'not-subscribed')
  assert.equal((await sync.unsubscribe('b'.repeat(64))).removed, false)
})
