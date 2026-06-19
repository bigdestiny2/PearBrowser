/**
 * Signed Hyperbee P2P catalog — trust-anchor tests.
 *
 * These prove the SECURITY-CRITICAL `\x00meta` verification of the catalog
 * consumer (backend/catalog-manager.js). They build a Hyperbee IN-PROCESS,
 * write a `\x00meta` record signed with the SAME construction the consumer
 * verifies, write a couple of `appKey` entries, then drive the consumer's
 * exported verify + scan directly.
 *
 * The signed message (must byte-match the relay producer) is:
 *
 *   signedMessage = sha256( beeKeyBuf(32) || utf8( canonicalJson(metaSansSig) ) )
 *   crypto_sign_verify_detached( signatureBuf, signedMessage, beeKeyBuf )
 *
 * where beeKeyBuf == the bee's 32-byte public key == the publisher's Ed25519
 * verifying key (the trust anchor). To make `core.key` equal a generated
 * Ed25519 public key we open the core in `compat: true` mode (v0 key == signer
 * pubkey); the relay producer must publish its catalog bee the same way so its
 * advertised `catalogBeeKey` IS the verifying key.
 *
 * Replication is intentionally NOT exercised here — verify + scan run against
 * an in-memory (temp-dir) bee. Replication is covered at runtime.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
require('./_stubs')

const b4a = require('b4a')
const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const sodium = require('sodium-universal')

const {
  canonicalJson,
  buildSignedDigest,
  verifyCatalogMeta,
  verifyAndScanCatalogBee,
  META_KEY,
} = require('../backend/catalog-manager')

// --- helpers ---

function freshKeypair () {
  const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}

/** Sign a meta object the SAME way the producer must (see file header). */
function signMeta (beeKeyBuf, secretKey, metaWithoutSignature) {
  const digest = buildSignedDigest(beeKeyBuf, metaWithoutSignature)
  const sig = b4a.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, digest, secretKey)
  return { ...metaWithoutSignature, signature: b4a.toString(sig, 'hex') }
}

/**
 * Build a Hyperbee whose public key (core.key) == the supplied Ed25519
 * public key, write the given records, and return { bee, beeKeyBuf, cleanup }.
 *
 * A raw Hypercore with `compat: true` keeps core.key == signer pubkey (v0
 * keys), matching the "bee key IS the publisher pubkey" trust-anchor model.
 * (Corestore wraps keys in a manifest, so we use a bare Hypercore here.)
 */
async function buildBee ({ publicKey, secretKey }, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-bee-test-'))
  const core = new Hypercore(dir, { keyPair: { publicKey, secretKey }, compat: true })
  await core.ready()
  assert.ok(b4a.equals(core.key, publicKey), 'core.key must equal signer pubkey (compat)')

  const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  await bee.ready()
  for (const [key, value] of records) {
    await bee.put(key, value)
  }

  const cleanup = async () => {
    try { await core.close() } catch (_) {}
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {}
  }
  return { bee, beeKeyBuf: core.key, cleanup }
}

const ENTRY_A = { appKey: 'a'.repeat(64), name: 'App Alpha', description: 'first', version: '1.0.0', author: 'me', categories: ['utils'] }
const ENTRY_B = { appKey: 'b'.repeat(64), name: 'App Beta', description: 'second', version: '2.1.0', author: 'you', categories: ['games'] }

// ---------------------------------------------------------------------------

test('canonicalJson is order-independent (sorts keys recursively)', () => {
  const a = { b: 1, a: 2, nested: { y: 1, x: 2 } }
  const b = { a: 2, nested: { x: 2, y: 1 }, b: 1 }
  assert.equal(canonicalJson(a), canonicalJson(b))
  // Compact (no whitespace) and sorted.
  assert.equal(canonicalJson(a), '{"a":2,"b":1,"nested":{"x":2,"y":1}}')
})

test('canonicalJson preserves array order (order is meaningful in arrays)', () => {
  assert.equal(canonicalJson({ k: [3, 1, 2] }), '{"k":[3,1,2]}')
  assert.notEqual(canonicalJson({ k: [1, 2] }), canonicalJson({ k: [2, 1] }))
})

test('correctly-signed bee VERIFIES and lists its entries (excluding meta)', async () => {
  const kp = freshKeypair()
  const meta = { version: 1, name: 'Signed Catalog', publishedAt: 1000 }
  const signedMeta = signMeta(kp.publicKey, kp.secretKey, meta)

  const { bee, beeKeyBuf, cleanup } = await buildBee(kp, [
    [META_KEY, signedMeta],
    [ENTRY_A.appKey, ENTRY_A],
    [ENTRY_B.appKey, ENTRY_B],
  ])
  try {
    assert.equal(verifyCatalogMeta(beeKeyBuf, signedMeta), true, 'meta should verify')

    const res = await verifyAndScanCatalogBee(bee, beeKeyBuf)
    assert.equal(res.ok, true, 'scan should succeed')
    assert.equal(res.entries.length, 2, 'two entries, meta excluded')
    const names = res.entries.map((e) => e.name).sort()
    assert.deepEqual(names, ['App Alpha', 'App Beta'])
    // The \x00meta record must never appear as an entry.
    assert.ok(!res.entries.some((e) => e && e.signature), 'no entry should be the meta record')
    assert.equal(res.meta.name, 'Signed Catalog')
  } finally {
    await cleanup()
  }
})

test('TAMPERED meta (field changed, old signature kept) is REJECTED', async () => {
  const kp = freshKeypair()
  const meta = { version: 1, name: 'Original', publishedAt: 1000 }
  const signedMeta = signMeta(kp.publicKey, kp.secretKey, meta)

  // Attacker flips a field but keeps the original signature.
  const tampered = { ...signedMeta, name: 'Evil Catalog' }

  const { bee, beeKeyBuf, cleanup } = await buildBee(kp, [
    [META_KEY, tampered],
    [ENTRY_A.appKey, ENTRY_A],
  ])
  try {
    assert.equal(verifyCatalogMeta(beeKeyBuf, tampered), false, 'tampered meta must NOT verify')

    const res = await verifyAndScanCatalogBee(bee, beeKeyBuf)
    assert.equal(res.ok, false, 'scan must reject')
    assert.equal(res.reason, 'bad-signature')
    assert.equal(res.entries, undefined, 'no entries returned on rejection (fail closed)')
  } finally {
    await cleanup()
  }
})

test('signature from a DIFFERENT key is REJECTED', async () => {
  const beeKp = freshKeypair()
  const attackerKp = freshKeypair()
  const meta = { version: 1, name: 'Signed Catalog', publishedAt: 1000 }

  // Sign with the ATTACKER's secret key, but over the REAL bee key bytes.
  const signedByAttacker = signMeta(beeKp.publicKey, attackerKp.secretKey, meta)

  // Bee is keyed by the legitimate publisher's keypair.
  const { bee, beeKeyBuf, cleanup } = await buildBee(beeKp, [
    [META_KEY, signedByAttacker],
    [ENTRY_A.appKey, ENTRY_A],
  ])
  try {
    assert.equal(verifyCatalogMeta(beeKeyBuf, signedByAttacker), false, 'wrong-key signature must NOT verify')

    const res = await verifyAndScanCatalogBee(bee, beeKeyBuf)
    assert.equal(res.ok, false)
    assert.equal(res.reason, 'bad-signature')
  } finally {
    await cleanup()
  }
})

test('MISSING \\x00meta is REJECTED', async () => {
  const kp = freshKeypair()
  const { bee, beeKeyBuf, cleanup } = await buildBee(kp, [
    [ENTRY_A.appKey, ENTRY_A],
    [ENTRY_B.appKey, ENTRY_B],
  ])
  try {
    const res = await verifyAndScanCatalogBee(bee, beeKeyBuf)
    assert.equal(res.ok, false, 'no meta → reject')
    assert.equal(res.reason, 'missing-meta')
    assert.equal(res.entries, undefined, 'no entries returned (fail closed)')
  } finally {
    await cleanup()
  }
})

test('verifyCatalogMeta fails closed on malformed signature inputs', () => {
  const kp = freshKeypair()
  const meta = { version: 1, name: 'X' }
  const signed = signMeta(kp.publicKey, kp.secretKey, meta)

  assert.equal(verifyCatalogMeta(kp.publicKey, { ...meta }), false, 'no signature field')
  assert.equal(verifyCatalogMeta(kp.publicKey, { ...meta, signature: '' }), false, 'empty signature')
  assert.equal(verifyCatalogMeta(kp.publicKey, { ...meta, signature: 'zz' }), false, 'short/garbage signature')
  assert.equal(verifyCatalogMeta(b4a.alloc(31), signed), false, 'wrong-length key')
  assert.equal(verifyCatalogMeta(kp.publicKey, null), false, 'null meta')
})
