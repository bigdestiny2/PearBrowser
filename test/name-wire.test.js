// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/name-wire.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Integration test for the CMD_NAME_RESOLVE wiring (naming Phase N1).
//
// The backend handler is, in full:
//     const petnames = await names.petnameMap()
//     return { resolved: resolveName(name, { petnames, aliases: true }) }
// i.e. the petname Hyperbee store (Tier 0) composed with the pure tiered
// resolver (Tiers 0 + 3). This test drives that exact composition through a
// real on-disk Corestore — the part the unit tests (names.test.js /
// resolve-name.test.js) cover only in isolation. It needs no Bare/RPC, so it
// runs under plain `node --test`.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const namesMod = require('../backend/names.cjs')
const resolveMod = require('../backend/resolve-name.cjs')
const aliasMod = require('../backend/name-aliases.cjs')
const { Names } = namesMod
const { resolveName } = resolveMod
const { lookupAlias } = aliasMod

// A petname target distinct from any curated alias, so "petname beats curated"
// is observable by the resolved key/link, not just the provenance label.
const PET_KEY = '0c35d12fd9b1115dd2d1fb1cd1751817c9173d3196ac7c62ae37d023340dcb75'

// Mirror the backend handler: petnameMap() → resolveName(name, { petnames }).
async function resolveThroughStore (names, name) {
  const petnames = names ? await names.petnameMap() : {}
  return resolveName(name, { petnames, aliases: true })
}

async function withStore (fn) {
  const dir = await mkdtemp(join(tmpdir(), 'name-wire-test-'))
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

test('curated floor answers a bare name offline (Tier 3)', async () => {
  await withStore(async (names) => {
    const r = await resolveThroughStore(names, 'keet')
    assert.equal(r.provenance, 'curated')
    assert.equal(r.link, lookupAlias('keet').link) // the curated bootstrap target
    assert.equal(r.name, 'keet')
  })
})

test('a saved petname BEATS the curated floor for the same word (Tier 0 wins)', async () => {
  await withStore(async (names) => {
    // 'keet' exists in the curated floor; the user's own petname must override it.
    await names.setPetname({ name: 'keet', key: PET_KEY, label: 'My Keet' })
    const r = await resolveThroughStore(names, 'keet')
    assert.equal(r.provenance, 'petname')
    assert.equal(r.key, PET_KEY)
    assert.notEqual(r.key, null)
    assert.equal(r.label, 'My Keet')
  })
})

test('petname resolution is normalized — different case/homograph still hits', async () => {
  await withStore(async (names) => {
    await names.setPetname({ name: 'MyApp', key: PET_KEY })
    const r = await resolveThroughStore(names, '  myapp  ') // case-folded + trimmed
    assert.equal(r.provenance, 'petname')
    assert.equal(r.key, PET_KEY)
  })
})

test('an unknown word resolves to null (URL bar falls through to plain handling)', async () => {
  await withStore(async (names) => {
    assert.equal(await resolveThroughStore(names, 'definitely-not-a-known-name'), null)
  })
})

test('a petname pointing at a link (not a key) is returned with its link', async () => {
  await withStore(async (names) => {
    await names.setPetname({ name: 'home', link: 'pear://example/' })
    const r = await resolveThroughStore(names, 'home')
    assert.equal(r.provenance, 'petname')
    assert.equal(r.link, 'pear://example/')
    assert.equal(r.key, null)
  })
})
