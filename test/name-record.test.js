// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/name-record.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Tests for backend/name-record.cjs (naming Phase N0).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const mod = require('../backend/name-record.cjs')
const { NAME_RECORD_VERSION, decodeNameRecord, encodeNameRecord, NAME_BINDING_SCHEMA } = mod

const KEY = '0c35d12fd9b1115dd2d1fb1cd1751817c9173d3196ac7c62ae37d023340dcb75'

test('encode → decode round-trips', () => {
  const buf = encodeNameRecord({ name: 'keet', driveKey: KEY, seq: 3 })
  assert.deepEqual(decodeNameRecord(buf), { name: 'keet', driveKey: KEY, seq: 3, link: null, target: KEY })
})

test('decode: valid launch links are normalized and unsafe links are dropped when a key remains', () => {
  const withLink = encodeNameRecord({ name: 'keet', driveKey: KEY, seq: 1, link: 'PEAR://abc' })
  assert.deepEqual(decodeNameRecord(withLink), {
    name: 'keet',
    driveKey: KEY,
    seq: 1,
    link: 'pear://abc',
    target: 'pear://abc'
  })
  // an unsafe link is ignored (→ key-only), not trusted
  const bad = Buffer.from(JSON.stringify({ v: 1, n: 'keet', k: KEY, s: 1, l: 'https://evil.example' }))
  assert.deepEqual(decodeNameRecord(bad), { name: 'keet', driveKey: KEY, seq: 1, link: null, target: KEY })
})

test('encode → decode accepts link-only app targets', () => {
  const pear = decodeNameRecord(encodeNameRecord({ name: 'keet', target: 'pear://abc', seq: 1 }))
  assert.equal(pear.driveKey, null)
  assert.equal(pear.link, 'pear://abc')
  assert.equal(pear.target, 'pear://abc')

  const hyper = decodeNameRecord(encodeNameRecord({ name: 'site', target: `hyper://${KEY}/app`, seq: 2 }))
  assert.equal(hyper.driveKey, KEY)
  assert.equal(hyper.link, `hyper://${KEY}/app`)
  assert.equal(hyper.target, `hyper://${KEY}/app`)

  const file = decodeNameRecord(encodeNameRecord({ name: 'local', target: 'file:///tmp/app', seq: 3 }))
  assert.equal(file.driveKey, null)
  assert.equal(file.link, 'file:///tmp/app')
})

test('decode: rejects wrong version', () => {
  const buf = Buffer.from(JSON.stringify({ v: 2, n: 'keet', k: KEY, s: 1 }))
  assert.equal(decodeNameRecord(buf), null)
})

test('decode: rejects bad / missing fields', () => {
  assert.equal(decodeNameRecord(null), null)
  assert.equal(decodeNameRecord(Buffer.from('not json')), null)
  assert.equal(decodeNameRecord(Buffer.from(JSON.stringify({ v: 1, n: 'keet', s: 1 }))), null)              // no target
  assert.equal(decodeNameRecord(Buffer.from(JSON.stringify({ v: 1, n: 'keet', k: 'xyz', s: 1 }))), null)     // bad target
  assert.equal(decodeNameRecord(Buffer.from(JSON.stringify({ v: 1, n: 'keet', k: KEY, s: -1 }))), null)      // negative seq
  assert.equal(decodeNameRecord(Buffer.from(JSON.stringify({ v: 1, n: '', k: KEY, s: 1 }))), null)           // empty name
  assert.equal(decodeNameRecord(Buffer.from(JSON.stringify({ v: 1, n: 'bad', l: 'javascript:alert(1)', s: 1 }))), null)
})

test('encodeNameRecord validates inputs', () => {
  assert.throws(() => encodeNameRecord({ name: '', driveKey: KEY, seq: 1 }), /name required/)
  assert.throws(() => encodeNameRecord({ name: 'x', driveKey: 'nope', seq: 1 }), /target must/)
  assert.throws(() => encodeNameRecord({ name: 'x', target: 'https://example.com', seq: 1 }), /target must/)
  assert.throws(() => encodeNameRecord({ name: 'x', driveKey: KEY, seq: -1 }), /non-negative/)
  assert.equal(NAME_RECORD_VERSION, 1)
})

test('NAME_BINDING_SCHEMA mirrors the catalogue schema contract', () => {
  assert.deepEqual(NAME_BINDING_SCHEMA.properties.verification.enum, ['unverified', 'relay-listed', 'author-signed'])
  assert.equal(NAME_BINDING_SCHEMA.properties.link.pattern, '^(?:hyper|pear|file)://.+')
  assert.deepEqual(NAME_BINDING_SCHEMA.anyOf, [{ required: ['driveKey'] }, { required: ['link'] }])
  assert.ok(NAME_BINDING_SCHEMA.required.includes('binderPubkey'))
  assert.ok(NAME_BINDING_SCHEMA.required.includes('bindingSig'))
  assert.equal(NAME_BINDING_SCHEMA.additionalProperties, false)
})
