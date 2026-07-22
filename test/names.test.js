// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/names.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Tests for backend/names.cjs (naming Phase N1 — petname Hyperbee store).
// Uses a real on-disk Corestore (runs under node, like the autobee tests).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const namesMod = require('../backend/names.cjs')
const { Names } = namesMod

const KEY = '0c35d12fd9b1115dd2d1fb1cd1751817c9173d3196ac7c62ae37d023340dcb75'

async function withStore (fn) {
  const dir = await mkdtemp(join(tmpdir(), 'names-test-'))
  try {
    const store = new Corestore(dir)
    await store.ready()
    const names = new Names(store, { now: () => 1700000000000 })
    await names.ready()
    await fn(names)
    await names.close()
    await store.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('setPetname + lookupPetname round-trips; names are normalized', async () => {
  await withStore(async (names) => {
    await names.setPetname({ name: 'KEET', key: KEY, label: 'My Keet' })
    const hit = await names.lookupPetname('keet')          // looked up case-folded
    assert.equal(hit.name, 'keet')
    assert.equal(hit.key, KEY)
    assert.equal(hit.label, 'My Keet')
    assert.equal(hit.addedAt, 1700000000000)
  })
})

test('petname accepts a link; requires key or link', async () => {
  await withStore(async (names) => {
    const r = await names.setPetname({ name: 'home', link: ' HYPER://abc/ ' })
    assert.equal(r.link, 'hyper://abc/')
    assert.equal(r.key, null)
    await assert.rejects(() => names.setPetname({ name: 'badlink', link: 'javascript:alert(1)' }), /needs a key or link/)
    await assert.rejects(() => names.setPetname({ name: 'web', link: 'https://example.com' }), /needs a key or link/)
    await assert.rejects(() => names.setPetname({ name: 'toolong', link: 'pear://' + 'x'.repeat(301) }), /needs a key or link/)
    await assert.rejects(() => names.setPetname({ name: 'bad' }), /needs a key or link/)
    await assert.rejects(() => names.setPetname({ name: '', key: KEY }), /name required/)
  })
})

test('list + petnameMap feed the resolver; remove works', async () => {
  await withStore(async (names) => {
    await names.setPetname({ name: 'keet', key: KEY })
    await names.setPetname({ name: 'home', link: 'hyper://abc/' })
    assert.equal((await names.list()).length, 2)
    const map = await names.petnameMap()
    assert.equal(map.keet.key, KEY)
    assert.equal(map.home.link, 'hyper://abc/')
    await names.removePetname('keet')
    assert.equal(await names.lookupPetname('keet'), null)
    assert.equal((await names.list()).length, 1)
  })
})

test('recordSeen stores under seen!, never as a resolvable petname', async () => {
  await withStore(async (names) => {
    await names.recordSeen(KEY, 'TotallyKeet')
    // a self-asserted nickname must NOT become a petname/resolvable
    assert.equal(await names.lookupPetname('totallykeet'), null)
    assert.equal((await names.list()).length, 0)   // list() is pet! only
  })
})
