// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/identity-binding-publisher.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Tests for backend/identity-binding-publisher.js — the live half of Lighthouse
// Phase 2. Real Corestore-backed PersonalIndex + real identity-binding.cjs;
// identity/contacts are stubbed and the DHT is an in-memory mutable store.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const piMod = require('../backend/personal-index.cjs')
const ibMod = require('../backend/identity-binding.cjs')
const cmpMod = require('../backend/search-completeness.cjs')
const dgMod = require('../backend/search-digest.cjs')
const pubMod = require('../backend/identity-binding-publisher.js')
const { PersonalIndex } = piMod
const { IdentityBindingPublisher } = pubMod
const ib = ibMod
const cmp = cmpMod
const dg = dgMod

const hex = (b) => b4a.toString(b, 'hex')

// Stub identity that mirrors backend/identity.js's getSigningKeypair/sign/
// getAppKeypair, backed by real hypercore-crypto ed25519 (same algorithm the
// real Identity + identity-binding.cjs use).
function fakeIdentity () {
  const root = crypto.keyPair()
  const appKeys = new Map()
  return {
    rootHex: hex(root.publicKey),
    getSigningKeypair: () => root,
    sign: (m) => ({
      signature: hex(crypto.sign(typeof m === 'string' ? b4a.from(m, 'utf-8') : m, root.secretKey)),
      publicKey: hex(root.publicKey),
      algorithm: 'ed25519',
    }),
    getAppKeypair: (name) => {
      if (!appKeys.has(name)) appKeys.set(name, crypto.keyPair())
      return appKeys.get(name)
    },
  }
}

function fakeContacts () {
  const set = new Set()
  return { lookup: async (pk) => (set.has(pk) ? { pubkey: pk } : null), _add: (pk) => set.add(pk) }
}

// In-memory hyperdht mutable store. mutablePut(keyPair, value, {seq}) keeps the
// highest seq, like hyperdht; mutableGet(pubkeyBuf) -> { value, seq } | null.
function fakeDHT () {
  const m = new Map()
  return {
    async mutablePut (kp, value, { seq } = {}) {
      const k = hex(kp.publicKey)
      const prev = m.get(k)
      if (prev && prev.seq > (seq ?? 0)) return prev
      const entry = { value: b4a.from(value), seq: seq ?? 0 }
      m.set(k, entry)
      return entry
    },
    async mutableGet (pubkeyBuf) {
      const e = m.get(hex(pubkeyBuf))
      return e ? { value: e.value, seq: e.seq } : null
    },
  }
}

async function withPublisher (fn, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'binding-pub-'))
  const store = new Corestore(dir)
  await store.ready()
  const personalIndex = await new PersonalIndex(store).ready()
  const identity = fakeIdentity()
  const contacts = fakeContacts()
  const dht = fakeDHT()
  const pub = await new IdentityBindingPublisher({ ib, identity, personalIndex, contacts, dht, ...opts }).ready()
  try { return await fn({ pub, identity, contacts, dht, personalIndex }) }
  finally { await personalIndex.close(); await store.close(); await rm(dir, { recursive: true, force: true }) }
}

test('publish() mints + persists a self-verifying binding at version 1', async () => {
  await withPublisher(async ({ pub, identity, personalIndex }) => {
    const res = await pub.publish()
    assert.equal(res.version, 1)
    assert.match(res.searchPubkey, /^[0-9a-f]{64}$/)
    const stored = await personalIndex.getMeta('binding', null)
    assert.ok(stored)
    assert.equal(stored.version, 1)
    assert.equal(stored.searchPubkey, res.searchPubkey)
    assert.equal(await personalIndex.getMeta('bindingVersion', 0), 1)
    assert.equal(ib.verifyBinding(stored, identity.rootHex, 'search'), true)
  })
})

test('publish() writes a DHT mutable record resolvable to the same key', async () => {
  await withPublisher(async ({ pub, dht }) => {
    const res = await pub.publish()
    const got = await dht.mutableGet(b4a.from(res.dhtPubkey, 'hex'))
    assert.ok(got)
    assert.equal(got.seq, res.dhtSeq)
    const rec = JSON.parse(b4a.toString(got.value, 'utf-8'))
    assert.equal(rec.kind, 'binding')
    assert.equal(rec.searchPubkey, res.searchPubkey)
    assert.equal(rec.indexKey, res.indexKey) // index core key advertised in the wrapper
    assert.match(res.indexKey, /^[0-9a-f]{64}$/)
  })
})

test('publish() is idempotent without rotate (no version churn across boots)', async () => {
  await withPublisher(async ({ pub }) => {
    const a = await pub.publish()
    const b = await pub.publish()
    assert.equal(a.version, 1)
    assert.equal(b.version, 1) // re-publish, not re-version
    assert.equal(a.searchPubkey, b.searchPubkey)
    assert.ok(b.dhtSeq > a.dhtSeq) // wrapper metadata can still refresh
  })
})

test('publish() refreshes wrapper metadata without rotating the search binding', async () => {
  let currentNostrBind = null
  let currentNostrRevocations = []
  await withPublisher(async ({ pub, identity, contacts }) => {
    contacts._add(identity.rootHex)
    const a = await pub.publish()
    currentNostrBind = { kind: 'nostr-bind', marker: 'linked' }
    currentNostrRevocations = [{ kind: 'nostr-revoke', marker: 'revoked' }]
    const b = await pub.publish()
    assert.equal(b.version, a.version)
    assert.ok(b.dhtSeq > a.dhtSeq)
    const got = await pub.resolve({ contactPubkey: identity.rootHex, dhtPubkey: b.dhtPubkey })
    assert.deepEqual(got.nostrBind, currentNostrBind)
    assert.deepEqual(got.nostrRevocations, currentNostrRevocations)
  }, {
    getNostrBind: async () => currentNostrBind,
    getNostrRevocations: async () => currentNostrRevocations,
  })
})

test('rotate bumps version, revokes the old key, resolveSearchKey picks the new one', async () => {
  await withPublisher(async ({ pub, identity, personalIndex }) => {
    const v1 = await pub.publish()
    const v2 = await pub.publish({ rotate: true })
    assert.equal(v2.version, 2)
    assert.notEqual(v1.searchPubkey, v2.searchPubkey)
    const b1 = await personalIndex.getMeta('binding!1', null)
    const b2 = await personalIndex.getMeta('binding!2', null)
    const rev1 = await personalIndex.getMeta('revoke!1', null)
    assert.ok(b1 && b2 && rev1)
    assert.equal(ib.verifyRevocation(rev1, identity.rootHex, 'search'), true)
    assert.equal(ib.resolveSearchKey(identity.rootHex, [b1, b2], [rev1]), v2.searchPubkey)
  })
})

test('resolve() returns a known contact\'s current search key (full publish→DHT→verify loop)', async () => {
  await withPublisher(async ({ pub, identity, contacts }) => {
    contacts._add(identity.rootHex) // treat self as a known contact
    const res = await pub.publish()
    const got = await pub.resolve({ contactPubkey: identity.rootHex, dhtPubkey: res.dhtPubkey })
    assert.equal(got.searchPubkey, res.searchPubkey)
    assert.equal(got.indexKey, res.indexKey) // index core key resolves too (for replication)
  })
})

test('resolve() rejects a forged binding signed by the wrong root (MITM defense)', async () => {
  await withPublisher(async ({ pub, identity, contacts, dht }) => {
    const victimRoot = identity.rootHex
    contacts._add(victimRoot)
    const attacker = crypto.keyPair()
    const attackerSign = (m) => hex(crypto.sign(b4a.from(m, 'utf-8'), attacker.secretKey))
    const searchKp = crypto.keyPair()
    // attacker forges a binding CLAIMING the victim's root but signs it themselves
    const forged = ib.makeBinding({ rootPubkey: victimRoot, searchPubkey: hex(searchKp.publicKey), purpose: 'search', version: 1 }, attackerSign)
    const attackerDht = crypto.keyPair()
    await dht.mutablePut(attackerDht, b4a.from(JSON.stringify(forged), 'utf-8'), { seq: 1 })
    const got = await pub.resolve({ contactPubkey: victimRoot, dhtPubkey: hex(attackerDht.publicKey) })
    assert.equal(got, null)
  })
})

test('resolve() drops a validly-signed binding from an unknown (non-contact) root', async () => {
  await withPublisher(async ({ pub, identity }) => {
    const res = await pub.publish() // valid, but identity.rootHex is NOT in contacts
    const got = await pub.resolve({ contactPubkey: identity.rootHex, dhtPubkey: res.dhtPubkey })
    assert.equal(got, null)
  })
})

test('putMeta/getMeta round-trip and stay serialized against indexDoc', async () => {
  await withPublisher(async ({ personalIndex }) => {
    await Promise.all([
      personalIndex.putMeta('alpha', { x: 1 }),
      personalIndex.indexDoc({ driveKey: 'd1', path: '/', title: 'T', body: 'hello world' }),
      personalIndex.putMeta('beta', 2),
    ])
    assert.deepEqual(await personalIndex.getMeta('alpha', null), { x: 1 })
    assert.equal(await personalIndex.getMeta('beta', null), 2)
    assert.equal((await personalIndex.stats()).docs, 1) // meta!count not clobbered
  })
})

test('signDocSync signs a posting with the BOUND search key (peer-verifiable)', async () => {
  await withPublisher(async ({ pub }) => {
    await pub.publish() // ensures + binds the search key
    const binding = await pub.getCurrentBinding()
    const payload = JSON.stringify({ docId: 'abc', t: 'hello' })
    const { sig, pubkey } = pub.signDocSync(payload)
    assert.equal(pubkey, binding.searchPubkey) // signed with the same key the binding advertises
    assert.equal(ib.verifyAppSig('search', payload, sig, pubkey, 'lighthouse-doc-v2'), true)
  })
})

test('publish() emits a root-signed completeness anchor (stored + resolvable)', async () => {
  await withPublisher(async ({ pub, identity, contacts, personalIndex }) => {
    await personalIndex.indexDoc({ driveKey: 'd1', path: '/', title: 'T', body: 'hello world' })
    contacts._add(identity.rootHex)
    const res = await pub.publish()
    assert.ok(res.anchor && res.anchor.kind === 'anchor')
    assert.equal(res.anchor.indexKey, res.indexKey)
    assert.equal(cmp.verifyAnchor(res.anchor, identity.rootHex), true) // root-signed
    assert.equal((await personalIndex.getMeta('anchor', null)).length, res.anchor.length) // persisted
    const got = await pub.resolve({ contactPubkey: identity.rootHex, dhtPubkey: res.dhtPubkey })
    assert.ok(got.anchor && cmp.verifyAnchor(got.anchor, identity.rootHex)) // resolves from the DHT record
  })
})

test('publish() emits a digest whose head reflects the index (digest-first gating)', async () => {
  await withPublisher(async ({ pub, identity, contacts, personalIndex }) => {
    await personalIndex.indexDoc({ driveKey: 'd1', path: '/', title: 'T', body: 'encrypted chat' })
    contacts._add(identity.rootHex)
    const res = await pub.publish()
    assert.ok(res.digest && Array.isArray(res.digest.topTerms))
    assert.equal(dg.digestWorthPulling(res.digest, ['chat']), true)
    assert.equal(dg.digestWorthPulling(res.digest, ['nope']), false)
    const got = await pub.resolve({ contactPubkey: identity.rootHex, dhtPubkey: res.dhtPubkey })
    assert.ok(got.digest && dg.digestWorthPulling(got.digest, ['chat'])) // resolves from the DHT record
  })
})
