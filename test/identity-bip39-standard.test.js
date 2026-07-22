// Contract test for the v2 (2026-07) standards-compliant BIP-39 layer in
// backend/identity.js.
//
// backend/identity.js requires bare-fs/bare-path/bare-crypto (Bare-only), so it
// cannot be imported under Node. But its BIP-39 layer now routes entirely
// through the `bip39-mnemonic` package (entropyToMnemonic / mnemonicToEntropy /
// mnemonicToSeed), which IS Node-compatible — so we exercise that package
// directly and pin the exact guarantees identity.js relies on:
//
//   1. Portability — mnemonicToSeed() is real BIP-39 PBKDF2-HMAC-SHA512, so a
//      phrase minted here restores in Keet / hardware wallets / any BIP-39 tool.
//      Oracle: node:crypto pbkdf2 (an independent, trusted PBKDF2).
//   2. 24-word / 256-bit default (the Keet standard — matches ready()'s
//      crypto.randomBytes(32)).
//   3. entropy <-> mnemonic round-trips with checksum validation.
//   4. seed[:32] yields a DETERMINISTIC ed25519 keypair (the root identity).
//
// If identity.js's BIP-39 wiring changes, this test must change with it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ncrypto = require('node:crypto')
const bip39 = require('bip39-mnemonic')
const sodium = require('sodium-universal')
const b4a = require('b4a')

// Independent BIP-39 seed reference: PBKDF2-HMAC-SHA512(NFKD(mnemonic),
// "mnemonic"+passphrase, 2048, 64). This is the spec; if our library ever
// drifts from it, phrases stop being portable and this fails.
function referenceSeed (mnemonic, passphrase = '') {
  const norm = mnemonic.normalize('NFKD')
  return ncrypto.pbkdf2Sync(norm, 'mnemonic' + passphrase, 2048, 64, 'sha512')
}

// mirror of identity.js entropyToSeed(): first 32 bytes of the BIP-39 seed.
async function entropyToSeed (entropy) {
  const mnemonic = bip39.entropyToMnemonic(b4a.from(entropy))
  const seed = await bip39.mnemonicToSeed(mnemonic)
  return b4a.from(seed).slice(0, 32)
}

test('portable: mnemonicToSeed matches the BIP-39 PBKDF2 spec (Trezor vector)', async () => {
  const vec = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  assert.equal(bip39.validateMnemonic(vec), true)
  // all-zero 128-bit entropy for the canonical vector
  assert.equal(b4a.toString(b4a.from(bip39.mnemonicToEntropy(vec)), 'hex'), '00000000000000000000000000000000')
  const seed = b4a.from(await bip39.mnemonicToSeed(vec))
  assert.equal(b4a.toString(seed, 'hex'), referenceSeed(vec).toString('hex'))
})

test('portable: random 24-word phrase seed matches the spec', async () => {
  const m = bip39.generateMnemonic()
  assert.equal(m.split(' ').length, 24) // 256-bit / Keet standard
  const seed = b4a.from(await bip39.mnemonicToSeed(m))
  assert.equal(b4a.toString(seed, 'hex'), referenceSeed(m).toString('hex'))
})

test('entropy <-> mnemonic round-trips and rejects a corrupted phrase', () => {
  const entropy = b4a.alloc(32)
  sodium.randombytes_buf(entropy)
  const m = bip39.entropyToMnemonic(entropy)
  assert.ok(b4a.equals(b4a.from(bip39.mnemonicToEntropy(m)), entropy))
  // flip the last word -> checksum fails
  const bad = m.split(' ').slice(0, 23).concat('zoo').join(' ')
  assert.equal(bip39.validateMnemonic(bad), false)
})

test('seed[:32] yields a deterministic ed25519 root keypair', async () => {
  const entropy = b4a.alloc(32)
  sodium.randombytes_buf(entropy)
  const s1 = await entropyToSeed(entropy)
  const s2 = await entropyToSeed(entropy)
  assert.ok(b4a.equals(s1, s2), 'seed derivation is deterministic')

  const pk1 = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const sk1 = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_seed_keypair(pk1, sk1, s1)
  const pk2 = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const sk2 = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_seed_keypair(pk2, sk2, s2)
  assert.ok(b4a.equals(pk1, pk2), 'same seed -> same root pubkey (cross-device restore)')
})
