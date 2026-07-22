// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/search-completeness.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Phase-5 tests: completeness anchor (Layer 1), withholding detection
// (Layer 2), and the PoR freshness challenge.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const cp = require('../backend/search-completeness.cjs')
const dg = require('../backend/search-digest.cjs')

const hex = (b) => b4a.toString(b, 'hex')
const signer = (kp) => (s) => hex(crypto.sign(b4a.from(s, 'utf-8'), kp.secretKey))

test('completeness anchor: root-signed, MITM-safe, truncation-aware', () => {
  const root = crypto.keyPair(); const rootHex = hex(root.publicKey)
  const attacker = crypto.keyPair()
  const a1 = cp.makeAnchor({ rootPubkey: rootHex, indexKey: 'idx', length: 1000, treeHash: 'h1' }, signer(root))
  assert.equal(cp.verifyAnchor(a1, rootHex), true)
  // forged anchor claiming the victim root but signed by attacker → fails
  const forged = cp.makeAnchor({ rootPubkey: rootHex, indexKey: 'idx', length: 1, treeHash: 'evil' }, signer(attacker))
  assert.equal(cp.verifyAnchor(forged, rootHex), false)
  // truncation: a later anchor with a SHORTER signed length is an attack
  const a2short = cp.makeAnchor({ rootPubkey: rootHex, indexKey: 'idx', length: 500, treeHash: 'h2' }, signer(root))
  const a2grow = cp.makeAnchor({ rootPubkey: rootHex, indexKey: 'idx', length: 2000, treeHash: 'h3' }, signer(root))
  assert.equal(cp.isTruncation(a1, a2short), true)
  assert.equal(cp.isTruncation(a1, a2grow), false)
})

test('isFork flags equal-length divergent-treeHash equivocation', () => {
  const root = crypto.keyPair(); const rootHex = hex(root.publicKey)
  const a = cp.makeAnchor({ rootPubkey: rootHex, indexKey: 'idx', length: 1000, treeHash: 'hA' }, signer(root))
  const b = cp.makeAnchor({ rootPubkey: rootHex, indexKey: 'idx', length: 1000, treeHash: 'hB' }, signer(root))
  const grow = cp.makeAnchor({ rootPubkey: rootHex, indexKey: 'idx', length: 1001, treeHash: 'hC' }, signer(root))
  assert.equal(cp.isFork(a, b), true)      // same length, different hash → fork
  assert.equal(cp.isFork(a, grow), false)  // longer → growth, not a fork
  assert.equal(cp.isFork(a, a), false)     // identical → not a fork
})

test('verifyAnchor rejects a non-integer (string) length — closes the isFork bypass', () => {
  const root = crypto.keyPair(); const rootHex = hex(root.publicKey)
  // a validly root-signed anchor whose length is the STRING "500" (sig is over
  // the canonical JSON form, so it would pass the sig check without the guard)
  const canon = 'pear.lighthouse.anchor.v1:' + JSON.stringify({ r: rootHex, i: 'idx', l: '500', h: 'hE' }, ['h', 'i', 'l', 'r'])
  const evil = { kind: 'anchor', rootPubkey: rootHex, indexKey: 'idx', length: '500', treeHash: 'hE', sig: signer(root)(canon) }
  assert.equal(cp.verifyAnchor(evil, rootHex), false, 'string length must not verify')
})

test('withholding: probes a digest-claimed doc the server omitted', () => {
  const refDocs = Array.from({ length: 500 }, (_, i) => 'doc' + i)
  const digest = dg.buildDigest(refDocs, [], { p: 0.001 })
  const probes = cp.deriveProbes('seed-from-anchor', refDocs, 20)
  assert.equal(probes.length, 20)
  // deterministic from the seed
  assert.deepEqual(probes, cp.deriveProbes('seed-from-anchor', refDocs, 20))

  // honest server returns all → not suspected
  assert.equal(cp.detectWithholding(digest, probes, refDocs).suspected, false)
  // malicious server omits one probed doc that the digest claims present → caught
  const omitted = refDocs.filter((d) => d !== probes[0])
  const r = cp.detectWithholding(digest, probes, omitted)
  assert.equal(r.suspected, true)
  assert.deepEqual(r.missing, [probes[0]])
})

test('detectionProbability follows 1-(1-f)^R', () => {
  assert.ok(Math.abs(cp.detectionProbability(0.1, 20) - (1 - Math.pow(0.9, 20))) < 1e-9)
  assert.ok(cp.detectionProbability(0.5, 20) > 0.99) // heavy omission almost always caught
  assert.ok(cp.detectionProbability(0.001, 20) < 0.05) // targeted micro-omission usually evades (stated limit)
})

test('PoR freshness: holder proves a live length bound to the nonce', () => {
  const root = crypto.keyPair(); const rootHex = hex(root.publicKey)
  const challenge = cp.makeFreshnessChallenge('nonce-xyz', 1000)
  const resp = cp.answerFreshness(challenge, { rootPubkey: rootHex, indexKey: 'idx', length: 1500, treeHash: 'h' }, signer(root))
  assert.equal(cp.verifyFreshness(challenge, resp, rootHex), true)

  // too few entries → fails the minLength bound
  const short = cp.answerFreshness(challenge, { rootPubkey: rootHex, indexKey: 'idx', length: 10, treeHash: 'h' }, signer(root))
  assert.equal(cp.verifyFreshness(challenge, short, rootHex), false)
  // replayed under a different nonce → fails (no stale-snapshot replay)
  assert.equal(cp.verifyFreshness(cp.makeFreshnessChallenge('other', 1000), resp, rootHex), false)
  // wrong root → fails
  assert.equal(cp.verifyFreshness(challenge, resp, hex(crypto.keyPair().publicKey)), false)
})
