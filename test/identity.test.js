/**
 * Identity / BIP-39 tests (Phase 1 ticket 3).
 *
 * Uses the same module-resolver stub pattern as relay-client.test.js so
 * bare-fs / bare-path / bare-crypto load under plain Node.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
require('./_stubs')

const {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
  entropyToSeed,
  Identity,
} = require('../backend/identity')

test('entropy -> mnemonic -> entropy round-trip (32 bytes / 24 words)', () => {
  const crypto = require('node:crypto')
  const entropy = crypto.randomBytes(32)
  const phrase = entropyToMnemonic(entropy)
  const words = phrase.split(' ')
  assert.equal(words.length, 24, 'should produce 24 words')
  const recovered = mnemonicToEntropy(phrase)
  assert.equal(Buffer.from(recovered).toString('hex'), entropy.toString('hex'))
})

test('known BIP-39 test vector - all-zero 128-bit entropy stays portable', () => {
  // Canonical vector: 16 zero bytes → "abandon" x11 + "about"
  const zeroEntropy = Buffer.alloc(16, 0)
  const phrase = entropyToMnemonic(zeroEntropy)
  assert.equal(phrase, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
})

test('fresh identity vector uses 24 words for all-zero 256-bit entropy', () => {
  const zeroEntropy = Buffer.alloc(32, 0)
  const phrase = entropyToMnemonic(zeroEntropy)
  assert.equal(phrase.split(' ').length, 24)
  assert.equal(phrase, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art')
})

test('validateMnemonic accepts valid and rejects invalid', () => {
  assert.equal(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'), true)
  assert.equal(validateMnemonic(entropyToMnemonic(Buffer.alloc(32, 0))), true)
  // Wrong checksum word
  assert.equal(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo'), false)
  // Not in wordlist
  assert.equal(validateMnemonic('notaword '.repeat(24).trim()), false)
  // Wrong length
  assert.equal(validateMnemonic('abandon abandon'), false)
})

test('entropyToSeed is async, deterministic, and 32 bytes', async () => {
  const entropy = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex')
  const seed1 = await entropyToSeed(entropy)
  const seed2 = await entropyToSeed(entropy)
  assert.equal(seed1.length, 32)
  assert.equal(Buffer.from(seed1).toString('hex'), Buffer.from(seed2).toString('hex'))
})

test('Identity.ready() generates + persists entropy', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pb-id-'))
  const id1 = new Identity(tmpDir)
  return id1.ready().then(() => {
    const phrase1 = id1.getMnemonic()
    const seed1 = id1.getSeed()
    assert.equal(seed1.length, 32)
    assert.equal(phrase1.split(' ').length, 24)
    // Reload from same path: should read back same identity
    const id2 = new Identity(tmpDir)
    return id2.ready().then(() => {
      assert.equal(id2.getMnemonic(), phrase1)
      assert.equal(Buffer.from(id2.getSeed()).toString('hex'), Buffer.from(seed1).toString('hex'))
    })
  })
})

test('Identity.restoreFromMnemonic overwrites current identity', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pb-id-'))
  const id = new Identity(tmpDir)
  await id.ready()
  const original = id.getMnemonic()
  const target = entropyToMnemonic(Buffer.alloc(32, 0))
  await id.restoreFromMnemonic(target)
  assert.equal(id.getMnemonic(), target)
  assert.notEqual(id.getMnemonic(), original)
  // Reload from disk: should retain the restored phrase
  const id2 = new Identity(tmpDir)
  await id2.ready()
  assert.equal(id2.getMnemonic(), target)
})

test('Identity.restoreFromMnemonic rejects garbage input', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pb-id-'))
  const id = new Identity(tmpDir)
  await id.ready()
  await assert.rejects(() => id.restoreFromMnemonic('not a real phrase'), /mnemonic|invalid|word|language/i)
  await assert.rejects(() => id.restoreFromMnemonic('foo bar baz '.repeat(4).trim()), /mnemonic|invalid|word|language/i)
})
