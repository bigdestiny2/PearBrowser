/**
 * Tests for backend/trusted-origins.js — the opt-in allow-list that
 * gates window.pear injection on HTTPS pages when the user has flipped
 * to 'allowlist' privacy mode.
 *
 * Uses a real Corestore + Hyperbee against a tmp directory (via the
 * shared bare-fs stub which forwards to node:fs).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
require('./_stubs')

const Corestore = require('corestore')
const { TrustedOrigins, normaliseOrigin } = require('../backend/trusted-origins.js')

function makeTmpStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-trust-'))
  return { store: new Corestore(dir), dir }
}

test('normaliseOrigin: canonicalises https/http origins', () => {
  assert.equal(normaliseOrigin('https://Example.COM'), 'https://example.com')
  assert.equal(normaliseOrigin('https://example.com:443'), 'https://example.com')
  assert.equal(normaliseOrigin('http://example.com:80'), 'http://example.com')
  assert.equal(normaliseOrigin('https://example.com:8443'), 'https://example.com:8443')
  assert.equal(normaliseOrigin('https://example.com/path?q=1#frag'), 'https://example.com')
  assert.equal(normaliseOrigin('ftp://example.com'), null)
  assert.equal(normaliseOrigin('not a url'), null)
  assert.equal(normaliseOrigin(null), null)
  assert.equal(normaliseOrigin(''), null)
  assert.equal(normaliseOrigin('x'.repeat(600)), null)
})

test('TrustedOrigins: defaults to mode=all (everything trusted)', async () => {
  const { store } = makeTmpStore()
  const t = new TrustedOrigins(store)
  await t.ready()
  assert.equal(t.modeSync(), 'all')
  // In 'all' mode every well-formed origin is trusted
  assert.equal(t.isTrustedSync('https://example.com'), true)
  assert.equal(t.isTrustedSync('https://anyrandomsite.example'), true)
  // Garbage still rejected
  assert.equal(t.isTrustedSync('not a url'), false)
  assert.equal(t.isTrustedSync('ftp://example.com'), false)
})

test('TrustedOrigins: allowlist mode enforces explicit trust', async () => {
  const { store } = makeTmpStore()
  const t = new TrustedOrigins(store)
  await t.ready()
  await t.setMode('allowlist')
  assert.equal(t.modeSync(), 'allowlist')

  assert.equal(t.isTrustedSync('https://example.com'), false)
  await t.add('https://Example.com:443/some/path')
  assert.equal(t.isTrustedSync('https://example.com'), true)
  // Different origin still untrusted
  assert.equal(t.isTrustedSync('https://other.com'), false)
})

test('TrustedOrigins: setMode rejects unknown modes', async () => {
  const { store } = makeTmpStore()
  const t = new TrustedOrigins(store)
  await t.ready()
  await assert.rejects(() => t.setMode('open-bar'), /must be one of/)
})

test('TrustedOrigins: add/remove are idempotent and canonical', async () => {
  const { store } = makeTmpStore()
  const t = new TrustedOrigins(store)
  await t.ready()
  await t.setMode('allowlist')

  const v1 = await t.add('https://Example.COM/login')
  assert.equal(v1.origin, 'https://example.com')
  // Re-adding refreshes lastUsedAt but keeps trustedAt
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await sleep(2)
  const v2 = await t.add('https://example.com')
  assert.equal(v2.trustedAt, v1.trustedAt)
  assert.ok(v2.lastUsedAt >= v1.lastUsedAt)

  // Remove with dirty input still finds the canonical entry
  const r = await t.remove('https://Example.com:443/foo')
  assert.equal(r.origin, 'https://example.com')
  assert.equal(t.isTrustedSync('https://example.com'), false)
})

test('TrustedOrigins: add rejects malformed origins', async () => {
  const { store } = makeTmpStore()
  const t = new TrustedOrigins(store)
  await t.ready()
  await assert.rejects(() => t.add('ftp://example.com'), /not a valid http/)
  await assert.rejects(() => t.add('not a url'), /not a valid http/)
  await assert.rejects(() => t.add(null), /not a valid http/)
})

test('TrustedOrigins: list returns sorted, canonical entries with mode', async () => {
  const { store } = makeTmpStore()
  const t = new TrustedOrigins(store)
  await t.ready()
  await t.setMode('allowlist')
  await t.add('https://a.com')
  await new Promise((r) => setTimeout(r, 5))
  await t.add('https://b.com')
  await new Promise((r) => setTimeout(r, 5))
  await t.add('https://c.com')

  const { origins, mode } = await t.list()
  assert.equal(mode, 'allowlist')
  assert.equal(origins.length, 3)
  // Newest-first sort
  assert.equal(origins[0].origin, 'https://c.com')
  assert.equal(origins[2].origin, 'https://a.com')
})

test('TrustedOrigins: state survives restart (Hyperbee persistence)', async () => {
  const { store, dir } = makeTmpStore()
  const t1 = new TrustedOrigins(store)
  await t1.ready()
  await t1.setMode('allowlist')
  await t1.add('https://persistent.example')
  // Drop the on-disk file lock before re-opening — Corestore (via
  // hypercore-storage / rocksdb-native) holds an exclusive lock on the
  // storage dir while the instance is alive.
  await store.close()
  // Open a fresh instance against the same on-disk corestore
  const store2 = new Corestore(dir)
  const t2 = new TrustedOrigins(store2)
  await t2.ready()
  assert.equal(t2.modeSync(), 'allowlist')
  assert.equal(t2.isTrustedSync('https://persistent.example'), true)
  await store2.close()
})

test('TrustedOrigins: isTrusted async matches sync result', async () => {
  const { store } = makeTmpStore()
  const t = new TrustedOrigins(store)
  await t.ready()
  await t.setMode('allowlist')
  await t.add('https://foo.example')
  assert.equal(await t.isTrusted('https://foo.example'), true)
  assert.equal(await t.isTrusted('https://bar.example'), false)
  // 'all' mode short-circuits to true for any well-formed origin
  await t.setMode('all')
  assert.equal(await t.isTrusted('https://anything.example'), true)
})

test('TrustedOrigins: touch is best-effort (no throw on unknown origin)', async () => {
  const { store } = makeTmpStore()
  const t = new TrustedOrigins(store)
  await t.ready()
  // Should not throw even though the origin isn't trusted yet
  await t.touch('https://nope.example')
  await t.touch('not a url')
  await t.touch(null)
})
