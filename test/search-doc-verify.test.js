// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/search-doc-verify.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Step 5a — a trusted peer can VERIFY a replicated search posting. Proves
// search-core.canonDocBytes reconstructs the exact signed bytes from a d! record
// and that identity-binding.verifyAppSig accepts a posting signed with the
// author's search key (and rejects tampering / impersonation). This is the
// integrity foundation the federated RowVerifier (Step 5b) builds on.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const scMod = require('../backend/search-core.cjs')
const ibMod = require('../backend/identity-binding.cjs')
const dgMod = require('../backend/search-digest.cjs')
const piMod = require('../backend/personal-index.cjs')
const sc = scMod
const ib = ibMod
const dg = dgMod
const { PersonalIndex } = piMod

const hex = (b) => b4a.toString(b, 'hex')
const DOC_NS = 'lighthouse-doc-v2'

// the PersonalIndex sign hook, parameterized by a search keypair
const signerFor = (kp) => (canonDoc) => ({
  sig: hex(crypto.sign(ib.appMessage('search', JSON.stringify(canonDoc), DOC_NS), kp.secretKey)),
  pubkey: hex(kp.publicKey),
})
const dRecOf = (records) => records.find(([k]) => k.startsWith('d!'))[1]

test('canonDocBytes lets a peer verify a posting signed with the author search key', () => {
  const kp = crypto.keyPair()
  const { records } = sc.buildDocRecords(
    { driveKey: 'd1', path: '/', title: 'Keet', body: 'encrypted peer to peer chat' }, signerFor(kp))
  const dRec = dRecOf(records)
  assert.equal(dRec.signerPubkey, hex(kp.publicKey))
  assert.equal(ib.verifyAppSig('search', sc.canonDocBytes(dRec), dRec.sig, dRec.signerPubkey, DOC_NS), true)
})

test('a tampered d! record fails verification (title/driveKey/publishedAt/terms are bound)', () => {
  const kp = crypto.keyPair()
  const { records } = sc.buildDocRecords(
    { driveKey: 'd1', path: '/', title: 'Real', body: 'alpha beta gamma' }, signerFor(kp))
  const dRec = dRecOf(records)
  for (const tampered of [
    { ...dRec, title: 'EVIL' },
    { ...dRec, driveKey: 'attacker' },
    { ...dRec, publishedAt: 9999999999 },
    { ...dRec, terms: [] },
  ]) {
    assert.equal(ib.verifyAppSig('search', sc.canonDocBytes(tampered), dRec.sig, dRec.signerPubkey, DOC_NS), false)
  }
})

test('a posting verified against the wrong pubkey fails (impersonation)', () => {
  const real = crypto.keyPair()
  const attacker = crypto.keyPair()
  const { records } = sc.buildDocRecords(
    { driveKey: 'd1', path: '/', title: 'X', body: 'one two three' }, signerFor(real))
  const dRec = dRecOf(records)
  assert.equal(ib.verifyAppSig('search', sc.canonDocBytes(dRec), dRec.sig, hex(attacker.publicKey), DOC_NS), false)
})

// the bridge from scan → verify: searchSignedHits yields exactly the signed d!
// records the RowVerifier checks (Step 5c — what a peer pulls from a replica).
test('searchSignedHits returns peer-verifiable signed records from a real index', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signed-hits-'))
  const store = new Corestore(dir)
  await store.ready()
  const kp = crypto.keyPair()
  const idx = await new PersonalIndex(store, { sign: signerFor(kp) }).ready()
  try {
    await idx.indexDoc({ driveKey: 'd1', path: '/', title: 'Keet', body: 'encrypted peer chat' })
    await idx.indexDoc({ driveKey: 'd2', path: '/', title: 'Recipes', body: 'bake bread' })
    const hits = await sc.searchSignedHits(idx.bee, 'chat')
    assert.equal(hits.length, 1)
    const { tf, rec } = hits[0]
    assert.ok(tf > 0)
    assert.equal(rec.signerPubkey, hex(kp.publicKey))
    assert.equal(ib.verifyAppSig('search', sc.canonDocBytes(rec), rec.sig, rec.signerPubkey, DOC_NS), true)
  } finally {
    await idx.close(); await store.close(); await rm(dir, { recursive: true, force: true })
  }
})

// digest-first gating (I9): the cheap digest head must reflect indexed terms so a
// peer can decide whether to pull the full index.
test('PersonalIndex.buildDigest head matches indexed terms (digest-first gating)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'digest-'))
  const store = new Corestore(dir)
  await store.ready()
  const idx = await new PersonalIndex(store, { sign: signerFor(crypto.keyPair()) }).ready()
  try {
    await idx.indexDoc({ driveKey: 'd1', path: '/', title: 'Keet', body: 'encrypted peer to peer chat' })
    await idx.indexDoc({ driveKey: 'd2', path: '/', title: 'Recipes', body: 'bake fresh bread' })
    const digest = await idx.buildDigest()
    assert.ok(digest && Array.isArray(digest.topTerms))
    assert.equal(dg.digestWorthPulling(digest, ['chat']), true) // indexed → worth pulling
    assert.equal(dg.digestWorthPulling(digest, ['bread']), true)
    assert.equal(dg.digestWorthPulling(digest, ['nonexistentxyz']), false) // miss → skip the pull
  } finally {
    await idx.close(); await store.close(); await rm(dir, { recursive: true, force: true })
  }
})
