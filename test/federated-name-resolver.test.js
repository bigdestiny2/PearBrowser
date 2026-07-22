// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/federated-name-resolver.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// N5 cross-user federation — FederatedNameResolver. Unit tests pin the trust +
// conflict logic (verified-only, binding-required, owner==contact-root MITM
// defense, deterministic conflict winner). The final test proves the WHOLE path
// end-to-end with REAL registries replicating over wire(): B resolves A's claim.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const storeMod = require('../backend/name-registry-store.cjs')
const fedMod = require('../backend/federated-name-resolver.cjs')
const { NameRegistry } = storeMod
const { FederatedNameResolver } = fedMod
const hex = (x) => b4a.toString(x, 'hex')
const signer = (kp) => (msg) => hex(crypto.sign(b4a.from(msg, 'utf-8'), kp.secretKey))
const K = (c) => c.repeat(32)

function stubResolver ({ contacts, bindings, registries }) {
  return new FederatedNameResolver({
    listContacts: async () => contacts,
    resolveBinding: async ({ contactPubkey }) => bindings[contactPubkey] || null,
    openRegistry: async (keyHex) => registries[keyHex] || null,
  })
}
const fakeReg = (claims) => ({ resolve: async (n) => claims[n] || null })

test("resolves a trusted contact's claim (owner == contact root)", async () => {
  const root = K('aa')
  const r = stubResolver({
    contacts: [{ pubkey: root, displayName: 'Bob', verifiedAt: 1, bindingKey: K('bb') }],
    bindings: { [root]: { nameRegKey: K('cc') } },
    registries: { [K('cc')]: fakeReg({ alice: { target: K('dd'), owner: root, version: 1 } }) },
  })
  const res = await r.resolve('alice')
  assert.equal(res.key, K('dd'))
  assert.equal(res.source, 'Bob')
  assert.equal(res.candidates, 1)
})

test("resolves a trusted contact's link-only app claim", async () => {
  const root = K('aa')
  const link = 'pear://contact-app'
  const r = stubResolver({
    contacts: [{ pubkey: root, displayName: 'Bob', verifiedAt: 1, bindingKey: K('bb') }],
    bindings: { [root]: { nameRegKey: K('cc') } },
    registries: { [K('cc')]: fakeReg({ app: { target: link, owner: root, version: 1 } }) },
  })
  const res = await r.resolve('app')
  assert.equal(res.key, null)
  assert.equal(res.link, link)
  assert.equal(res.source, 'Bob')
})

test("resolves a trusted contact's hyper link with key provenance", async () => {
  const root = K('aa')
  const link = `hyper://${K('dd')}/app`
  const r = stubResolver({
    contacts: [{ pubkey: root, displayName: 'Bob', verifiedAt: 1, bindingKey: K('bb') }],
    bindings: { [root]: { nameRegKey: K('cc') } },
    registries: { [K('cc')]: fakeReg({ site: { target: link, owner: root, version: 1 } }) },
  })
  const res = await r.resolve('site')
  assert.equal(res.key, K('dd'))
  assert.equal(res.link, link)
  assert.equal(res.target, link)
})

test('ignores an UNVERIFIED contact (fail-closed)', async () => {
  const root = K('aa')
  const r = stubResolver({
    contacts: [{ pubkey: root, displayName: 'Bob', verifiedAt: null, bindingKey: K('bb') }],
    bindings: { [root]: { nameRegKey: K('cc') } },
    registries: { [K('cc')]: fakeReg({ alice: { target: K('dd'), owner: root, version: 1 } }) },
  })
  assert.equal(await r.resolve('alice'), null)
})

test('ignores a contact with no advertised binding pointer (no bindingKey)', async () => {
  const root = K('aa')
  const r = stubResolver({
    contacts: [{ pubkey: root, displayName: 'Bob', verifiedAt: 1, bindingKey: null }],
    bindings: {}, registries: {},
  })
  assert.equal(await r.resolve('alice'), null)
})

test('skips a contact whose binding advertises no nameRegKey', async () => {
  const root = K('aa')
  const r = stubResolver({
    contacts: [{ pubkey: root, displayName: 'Bob', verifiedAt: 1, bindingKey: K('bb') }],
    bindings: { [root]: { searchPubkey: K('ff'), nameRegKey: null } },
    registries: {},
  })
  assert.equal(await r.resolve('alice'), null)
})

test('MITM defense: a claim whose owner != the contact root is ignored', async () => {
  const root = K('aa'); const attacker = K('ee')
  const r = stubResolver({
    contacts: [{ pubkey: root, displayName: 'Bob', verifiedAt: 1, bindingKey: K('bb') }],
    bindings: { [root]: { nameRegKey: K('cc') } },
    // the replicated registry resolves alice, but the claim is owned by the ATTACKER
    registries: { [K('cc')]: fakeReg({ alice: { target: K('dd'), owner: attacker, version: 1 } }) },
  })
  assert.equal(await r.resolve('alice'), null)
})

test('conflict: two contacts claim the same name → deterministic winner + ambiguity count', async () => {
  const r1 = K('11'); const r2 = K('22') // r1 < r2 lexicographically
  const r = stubResolver({
    // deliberately list the higher pubkey FIRST to prove order-independence
    contacts: [
      { pubkey: r2, displayName: 'Carol', verifiedAt: 1, bindingKey: K('b2') },
      { pubkey: r1, displayName: 'Bob', verifiedAt: 1, bindingKey: K('b1') },
    ],
    bindings: { [r1]: { nameRegKey: K('c1') }, [r2]: { nameRegKey: K('c2') } },
    registries: {
      [K('c1')]: fakeReg({ alice: { target: K('d1'), owner: r1, version: 1 } }),
      [K('c2')]: fakeReg({ alice: { target: K('d2'), owner: r2, version: 1 } }),
    },
  })
  const res = await r.resolve('alice')
  assert.equal(res.contactPubkey, r1) // lowest pubkey wins, regardless of list order
  assert.equal(res.key, K('d1'))
  assert.equal(res.candidates, 2) // ambiguity surfaced for the UI
})

test('a hung contact times out and does not block a fast one (parallel + per-step timeout)', async () => {
  const fast = K('11'); const slow = K('22') // fast < slow
  const r = new FederatedNameResolver({
    listContacts: async () => [
      { pubkey: slow, displayName: 'Slow', verifiedAt: 1, bindingKey: K('b2') },
      { pubkey: fast, displayName: 'Fast', verifiedAt: 1, bindingKey: K('b1') },
    ],
    // the slow contact's binding lookup never resolves; the fast one returns at once
    resolveBinding: async ({ contactPubkey }) => (contactPubkey === slow ? new Promise(() => {}) : { nameRegKey: K('c1') }),
    openRegistry: async () => fakeReg({ alice: { target: K('d1'), owner: fast, version: 1 } }),
    stepTimeoutMs: 150,
  })
  const t0 = Date.now()
  const res = await r.resolve('alice')
  const elapsed = Date.now() - t0
  assert.equal(res.contactPubkey, fast) // the fast contact still resolves
  assert.ok(elapsed < 1500, `bounded by the per-step timeout, not the hung contact (was ${elapsed}ms)`)
})

test('end-to-end: B resolves A\'s real claim over wire() replication', async () => {
  const tmps = []
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const wire = (a, b) => { const s1 = a.replicate(true); const s2 = b.replicate(false); s1.on('error', () => {}); s2.on('error', () => {}); s1.pipe(s2).pipe(s1); return () => { try { s1.destroy() } catch {} try { s2.destroy() } catch {} } }
  const until = async (label, pred, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await sleep(120) } throw new Error('timeout: ' + label) }
  const newStore = async () => { const dir = await mkdtemp(join(tmpdir(), 'fed-')); tmps.push(dir); const store = new Corestore(dir); await store.ready(); return { store } }

  const aKp = crypto.keyPair(); const aRoot = hex(aKp.publicKey)
  const a = await newStore(); const b = await newStore()
  const A = await new NameRegistry(a.store, { encryptionKey: null }).ready() // A's PUBLIC registry
  await A.claim({ name: 'alice', target: K('dd'), owner: aRoot }, signer(aKp))
  // B opens A's registry read-only in its OWN substore + replicates
  const Bopen = await new NameRegistry(b.store, { bootstrap: A.key, encryptionKey: null, storeNamespace: 'eab-name-registry-c-' + A.key }).ready()
  const unwire = wire(a.store, b.store)
  try {
    await until('B replicates A\'s claim', async () => (await Bopen.resolve('alice'))?.owner === aRoot)
    // B's resolver: A is a verified contact; openRegistry returns the replicated view
    const fed = new FederatedNameResolver({
      listContacts: async () => [{ pubkey: aRoot, displayName: 'Alice', verifiedAt: 1, bindingKey: K('bb') }],
      resolveBinding: async () => ({ nameRegKey: A.key }),
      openRegistry: async () => Bopen,
    })
    const res = await fed.resolve('alice')
    assert.equal(res.key, K('dd'))
    assert.equal(res.owner, aRoot)
    assert.equal(res.source, 'Alice')
  } finally {
    unwire(); await A.close(); await Bopen.close(); await a.store.close(); await b.store.close()
    for (const d of tmps) { try { await rm(d, { recursive: true, force: true }) } catch {} }
  }
})
