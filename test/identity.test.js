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
  WORDLIST,
  Identity,
} = require('../backend/identity')

test('BIP-39 wordlist has 2048 entries', () => {
  assert.equal(WORDLIST.length, 2048)
  assert.equal(WORDLIST[0], 'abandon')
  assert.equal(WORDLIST[2047], 'zoo')
})

test('entropy → mnemonic → entropy round-trip (16 bytes)', () => {
  const crypto = require('node:crypto')
  const entropy = crypto.randomBytes(16)
  const phrase = entropyToMnemonic(entropy)
  const words = phrase.split(' ')
  assert.equal(words.length, 12, 'should produce 12 words')
  const recovered = mnemonicToEntropy(phrase)
  assert.equal(Buffer.from(recovered).toString('hex'), entropy.toString('hex'))
})

test('known BIP-39 test vector — all-zero entropy', () => {
  // Canonical vector: 16 zero bytes → "abandon" x11 + "about"
  const zeroEntropy = Buffer.alloc(16, 0)
  const phrase = entropyToMnemonic(zeroEntropy)
  assert.equal(phrase, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
})

test('known BIP-39 test vector — all-0xff entropy', () => {
  const ffEntropy = Buffer.alloc(16, 0xff)
  const phrase = entropyToMnemonic(ffEntropy)
  // Canonical: 0xff entropy → "zoo" x11 + "wrong"
  assert.equal(phrase, 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong')
})

test('validateMnemonic accepts valid and rejects invalid', () => {
  assert.equal(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'), true)
  // Wrong checksum word
  assert.equal(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo'), false)
  // Not in wordlist
  assert.equal(validateMnemonic('notaword '.repeat(12).trim()), false)
  // Wrong length
  assert.equal(validateMnemonic('abandon abandon'), false)
})

test('entropyToSeed is deterministic and 32 bytes', () => {
  const entropy = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  const seed1 = entropyToSeed(entropy)
  const seed2 = entropyToSeed(entropy)
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
    assert.equal(phrase1.split(' ').length, 12)
    // Reload from same path: should read back same identity
    const id2 = new Identity(tmpDir)
    return id2.ready().then(() => {
      assert.equal(id2.getMnemonic(), phrase1)
      assert.equal(Buffer.from(id2.getSeed()).toString('hex'), Buffer.from(seed1).toString('hex'))
    })
  })
})

test('Identity.restoreFromMnemonic overwrites current identity', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pb-id-'))
  const id = new Identity(tmpDir)
  return id.ready().then(() => {
    const original = id.getMnemonic()
    const target = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    id.restoreFromMnemonic(target)
    assert.equal(id.getMnemonic(), target)
    assert.notEqual(id.getMnemonic(), original)
    // Reload from disk: should retain the restored phrase
    const id2 = new Identity(tmpDir)
    return id2.ready().then(() => {
      assert.equal(id2.getMnemonic(), target)
    })
  })
})

test('Identity.restoreFromMnemonic rejects garbage input', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pb-id-'))
  const id = new Identity(tmpDir)
  return id.ready().then(() => {
    assert.throws(() => id.restoreFromMnemonic('not a real phrase'), /12 or 24/)
    assert.throws(() => id.restoreFromMnemonic('foo bar baz '.repeat(4).trim()), /invalid word/)
  })
})
