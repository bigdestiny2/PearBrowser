// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/name-registry-convergence.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// N5 — the multi-writer registry over a real Autobase: two-writer convergence
// (incl. a conflicting claim that must resolve IDENTICALLY on both nodes) and the
// SPIKE-AUTOBEE-DURABILITY acceptance test (a claim survives ALL writers going
// offline, re-served from a fresh never-writer node). Offline, Node-only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const storeMod = require('../backend/name-registry-store.cjs')
const resolveMod = require('../backend/resolve-name.cjs')
const { NameRegistry } = storeMod
const { resolveName } = resolveMod

const ENC = b4a.alloc(32, 0x4e)
const hex = (x) => b4a.toString(x, 'hex')
const signer = (kp) => (msg) => hex(crypto.sign(b4a.from(msg, 'utf-8'), kp.secretKey))
const owner = (kp) => hex(kp.publicKey)
const TARGET_A = 'aa'.repeat(32); const TARGET_B = 'bb'.repeat(32); const TARGET_C = 'cc'.repeat(32)
const PEAR_LINK = 'pear://link-only-app'

const tmps = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function wire (a, b) {
  const s1 = a.replicate(true); const s2 = b.replicate(false)
  s1.on('error', () => {}); s2.on('error', () => {})
  s1.pipe(s2).pipe(s1)
  return () => { try { s1.destroy() } catch {} try { s2.destroy() } catch {} }
}
async function until (label, pred, ms = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await pred()) return true; await sleep(120) }
  throw new Error('timeout: ' + label)
}
async function newStore () {
  const dir = await mkdtemp(join(tmpdir(), 'namereg-')); tmps.push(dir)
  const store = new Corestore(dir); await store.ready()
  return { store, dir }
}

test('two-writer convergence: distinct claims replicate; a conflict resolves identically', async () => {
  const ka = crypto.keyPair(); const kb = crypto.keyPair() // op owners (separate from writer keys)
  const a = await newStore(); const b = await newStore()
  const A = await new NameRegistry(a.store, { encryptionKey: ENC, namespace: 'nr' }).ready()
  await A.claim({ name: 'alice', target: TARGET_A, owner: owner(ka) }, signer(ka))
  const B = await new NameRegistry(b.store, { bootstrap: A.key, encryptionKey: ENC, namespace: 'nr' }).ready()
  const unwire = wire(a.store, b.store)
  try {
    await until('B sees alice', async () => (await B.resolve('alice'))?.owner === owner(ka))
    assert.equal(B.writable, false)
    await A.addWriter(B.localKey)
    await until('B writable', async () => { await B.update(); return B.writable })
    await B.claim({ name: 'bob', target: TARGET_B, owner: owner(kb) }, signer(kb))
    // concurrent conflict: both claim 'carol' with different owners
    await A.claim({ name: 'carol', target: TARGET_A, owner: owner(ka) }, signer(ka))
    await B.claim({ name: 'carol', target: TARGET_B, owner: owner(kb) }, signer(kb))
    await until('converge', async () => {
      const aA = (await A.resolve('alice'))?.owner; const bA = (await B.resolve('alice'))?.owner
      const aB = (await A.resolve('bob'))?.owner; const bB = (await B.resolve('bob'))?.owner
      const aC = (await A.resolve('carol'))?.owner; const bC = (await B.resolve('carol'))?.owner
      return aA === owner(ka) && bA === owner(ka) && aB === owner(kb) && bB === owner(kb) && aC && aC === bC
    })
    // carol resolves to the SAME owner on both nodes — deterministic linear order
    assert.equal((await A.resolve('carol')).owner, (await B.resolve('carol')).owner)
  } finally { unwire(); await A.close(); await B.close(); await a.store.close(); await b.store.close() }
})

test('DURABILITY: a claim survives all writers going offline (fresh node re-serves)', async () => {
  const ka = crypto.keyPair()
  const a = await newStore(); const p = await newStore(); const c = await newStore()
  const A = await new NameRegistry(a.store, { encryptionKey: ENC, namespace: 'nr' }).ready()
  await A.claim({ name: 'durable', target: TARGET_C, owner: owner(ka) }, signer(ka))
  await until('A has durable', async () => (await A.resolve('durable'))?.target === TARGET_C)

  // replica P mirrors A
  const P = await new NameRegistry(p.store, { bootstrap: A.key, encryptionKey: ENC, namespace: 'nr' }).ready()
  const uw1 = wire(a.store, p.store)
  await until('P mirrors durable', async () => (await P.resolve('durable'))?.target === TARGET_C)

  // the ONLY writer goes offline
  uw1(); await A.close(); await a.store.close()

  // fresh never-writer C re-serves the claim from P
  const C = await new NameRegistry(c.store, { bootstrap: A.key, encryptionKey: ENC, namespace: 'nr' }).ready()
  const uw2 = wire(p.store, c.store)
  try {
    await until('C re-serves durable', async () => (await C.resolve('durable'))?.target === TARGET_C)
    const r = await C.resolve('durable')
    assert.equal(r.owner, owner(ka))
    assert.equal(r.target, TARGET_C)
  } finally { uw2(); await P.close(); await C.close(); await p.store.close(); await c.store.close() }
})

const PAYPAL_SQUAT = 'pаypаl' // latin p, Cyrillic а ×2 — skeleton folds to 'paypal'

test('store parity: releasing a sibling confusable keeps the skeleton blocked (homograph fix)', async () => {
  const ka = crypto.keyPair(); const kb = crypto.keyPair()
  const s = await newStore()
  const R = await new NameRegistry(s.store, { encryptionKey: ENC, namespace: 'nr' }).ready()
  try {
    await R.claim({ name: 'paypal', target: TARGET_A, owner: owner(ka) }, signer(ka))
    await R.claim({ name: PAYPAL_SQUAT, target: TARGET_A, owner: owner(ka) }, signer(ka)) // same-owner variant
    await R.release({ name: PAYPAL_SQUAT, owner: owner(ka) }, signer(ka))
    await R.claim({ name: PAYPAL_SQUAT, target: TARGET_B, owner: owner(kb) }, signer(kb)) // attacker squat
    assert.equal((await R.resolve('paypal')).owner, owner(ka)) // original still held
    assert.equal(await R.resolve(PAYPAL_SQUAT), null) // squat rejected in the LIVE store too
  } finally { await R.close(); await s.store.close() }
})

test('store list() includes non-ASCII (i18n) names — range-bound fix', async () => {
  const ka = crypto.keyPair()
  const s = await newStore()
  const R = await new NameRegistry(s.store, { encryptionKey: ENC, namespace: 'nr' }).ready()
  try {
    await R.claim({ name: 'ascii', target: TARGET_A, owner: owner(ka) }, signer(ka))
    await R.claim({ name: '日本語', target: TARGET_B, owner: owner(ka) }, signer(ka)) // sorts above '~'
    const list = await R.list()
    assert.equal(list.length, 2) // the non-ASCII name is NOT silently dropped
    assert.ok((await R.resolve('日本語')) != null)
  } finally { await R.close(); await s.store.close() }
})

test('end-to-end: claim → activeMap → resolveName (the CMD_NAME_RESOLVE path)', async () => {
  const ka = crypto.keyPair()
  const s = await newStore()
  const R = await new NameRegistry(s.store, { encryptionKey: ENC, namespace: 'nr' }).ready()
  try {
    await R.claim({ name: 'Alice', target: TARGET_A, owner: owner(ka) }, signer(ka))
    await R.claim({ name: 'LinkApp', target: PEAR_LINK, owner: owner(ka) }, signer(ka))
    const registry = await R.activeMap() // what the backend injects into the resolver
    // a typed bare name resolves through the registry tier to a navigable key
    const r = resolveName('alice', { petnames: {}, registry })
    assert.equal(r.provenance, 'registry')
    assert.equal(r.key, TARGET_A) // → go() builds hyper://<target>/
    const link = resolveName('linkapp', { petnames: {}, registry })
    assert.equal(link.provenance, 'registry')
    assert.equal(link.key, null)
    assert.equal(link.link, PEAR_LINK)
    // a petname still wins over the registry (tier order preserved end-to-end)
    const pet = resolveName('alice', { petnames: { alice: { key: TARGET_B } }, registry })
    assert.equal(pet.provenance, 'petname')
  } finally { await R.close(); await s.store.close() }
})

test.after(async () => { for (const d of tmps) { try { await rm(d, { recursive: true, force: true }) } catch {} } })
