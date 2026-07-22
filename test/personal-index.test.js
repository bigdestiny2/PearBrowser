// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/personal-index.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Tests for the Phase-0 PersonalIndex (backend/personal-index.cjs) over a real
// on-disk Corestore/Hyperbee.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const pi = require('../backend/personal-index.cjs')
const { PersonalIndex } = pi

async function withIndex (opts, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'personal-index-'))
  const store = new Corestore(dir)
  await store.ready()
  const idx = await new PersonalIndex(store, opts).ready()
  try { return await fn(idx) } finally {
    await idx.close(); await store.close(); await rm(dir, { recursive: true, force: true })
  }
}

test('indexDoc + search round-trips and ranks self-content', async () => {
  await withIndex({}, async (idx) => {
    await idx.indexDoc({ driveKey: 'd1', path: '/', title: 'Keet', body: 'encrypted peer to peer chat' })
    await idx.indexDoc({ driveKey: 'd2', path: '/', title: 'PearPass', body: 'peer to peer password manager' })
    await idx.indexDoc({ driveKey: 'd3', path: '/', title: 'Recipes', body: 'how to bake bread at home' })

    const chat = await idx.search('chat')
    assert.deepEqual(chat.map((r) => r.driveKey), ['d1'])
    const peer = await idx.search('peer')
    assert.deepEqual(peer.map((r) => r.driveKey).sort(), ['d1', 'd2'])
    const and = await idx.search('password manager')
    assert.deepEqual(and.map((r) => r.driveKey), ['d2'])
    assert.deepEqual(await idx.search('nonexistentterm'), [])
    assert.equal((await idx.stats()).docs, 3)
  })
})

test('re-indexing the same page replaces, not duplicates', async () => {
  await withIndex({}, async (idx) => {
    await idx.indexDoc({ driveKey: 'd1', path: '/', title: 'Old Title', body: 'alpha beta' })
    await idx.indexDoc({ driveKey: 'd1', path: '/', title: 'New Title', body: 'gamma delta' })
    assert.equal((await idx.stats()).docs, 1, 'same (driveKey,path) is one doc')
    // old terms gone, new terms present
    assert.deepEqual(await idx.search('alpha'), [])
    assert.deepEqual((await idx.search('gamma')).map((r) => r.title), ['New Title'])
  })
})

test('removeDoc deletes the doc and its postings', async () => {
  await withIndex({}, async (idx) => {
    const id = await idx.indexDoc({ driveKey: 'd1', path: '/', title: 'Solo', body: 'uniqueword here' })
    assert.equal((await idx.search('uniqueword')).length, 1)
    assert.equal(await idx.removeDoc(id), true)
    assert.deepEqual(await idx.search('uniqueword'), [])
    assert.equal((await idx.stats()).docs, 0)
    assert.equal(await idx.removeDoc(id), false) // already gone
  })
})

test('LRU eviction caps the index at maxDocs (oldest dropped)', async () => {
  await withIndex({ maxDocs: 5 }, async (idx) => {
    for (let i = 0; i < 8; i++) {
      await idx.indexDoc({ driveKey: 'd' + i, path: '/', title: 'Doc ' + i, body: 'commonterm body number ' + i })
    }
    assert.equal((await idx.stats()).docs, 5, 'capped at maxDocs')
    // the 3 oldest (d0..d2) were evicted; d7 (newest) survives
    const hits = await idx.search('commonterm')
    const keys = hits.map((r) => r.driveKey).sort()
    assert.equal(keys.length, 5)
    assert.ok(keys.includes('d7') && !keys.includes('d0'), 'newest kept, oldest evicted')
  })
})

test('eviction advances past an orphaned order-key (no permanent stall)', async () => {
  await withIndex({ maxDocs: 2 }, async (idx) => {
    // inject a dangling order-key (smallest, so it sits at the scan head) whose
    // docId has no d! record — the old code would loop forever on it
    await idx.bee.put('o!0000000000000000', 'deadbeefdeadbeef')
    for (let i = 0; i < 4; i++) {
      await idx.indexDoc({ driveKey: 'd' + i, path: '/', title: 'Doc ' + i, body: 'commonword w' + i })
    }
    assert.ok((await idx.stats()).docs <= 2, 'doc cap re-enforced despite the orphan')
    assert.equal(await idx.bee.get('o!0000000000000000'), null, 'dangling order-key deleted, scan advanced')
  })
})

test('concurrent indexDoc is serialized — no lost-update on the count', async () => {
  await withIndex({}, async (idx) => {
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      idx.indexDoc({ driveKey: 'd' + i, path: '/', title: 'Doc ' + i, body: 'commonword token' + i })))
    assert.equal((await idx.stats()).docs, 10, 'count not corrupted by the race')
    assert.equal((await idx.search('commonword')).length, 10, 'all 10 searchable (no orphaned order-keys)')
  })
})

test('indexing a page with no indexable terms is a no-op', async () => {
  await withIndex({}, async (idx) => {
    assert.equal(await idx.indexDoc({ driveKey: 'd1', path: '/', title: 'the and of', body: 'a an it' }), null)
    assert.equal((await idx.stats()).docs, 0)
  })
})

test('the injected sign hook stamps a per-doc signature on the d! record', async () => {
  await withIndex({ sign: (canon) => ({ sig: 'SIG:' + canon.docId, pubkey: 'PK' }) }, async (idx) => {
    const id = await idx.indexDoc({ driveKey: 'd1', path: '/', title: 'Signed', body: 'verifiable content' })
    const rec = await idx.bee.get('d!' + id)
    assert.equal(rec.value.sig, 'SIG:' + id)
    assert.equal(rec.value.signerPubkey, 'PK')
  })
})
