// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/search-federation.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Tests for the Phase-1 federation/discovery engine (search-federation.cjs):
// the trust graph (hop→tier) and the dedup-and-rank merge across sources.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fed = require('../backend/search-federation.cjs')
const { buildTrustGraph, trustRowsToEdges, resourceRowToCandidate, mergeFederated } = fed

const ME = 'rootME'
const A = 'curatorA'   // I follow A
const B = 'curatorB'   // A follows B (hop 2 from me)
const Z = 'strangerZ'  // no path

test('buildTrustGraph resolves hop distance + tier from self', () => {
  const g = buildTrustGraph(ME, [{ from: ME, to: A }, { from: A, to: B }], { maxFollowHops: 2 })
  assert.equal(g.hopOf(ME), 0)
  assert.equal(g.tierOf(ME), 'self')
  assert.equal(g.hopOf(A), 1)
  assert.equal(g.tierOf(A), 'followed')
  assert.equal(g.hopOf(B), 2)            // transitive within maxFollowHops
  assert.equal(g.tierOf(B), 'followed')
  assert.equal(g.hopOf(Z), Infinity)
  assert.equal(g.tierOf(Z), 'default')
})

test('maxFollowHops bounds the followed tier', () => {
  const g = buildTrustGraph(ME, [{ from: ME, to: A }, { from: A, to: B }], { maxFollowHops: 1 })
  assert.equal(g.tierOf(A), 'followed')  // hop 1
  assert.equal(g.tierOf(B), 'default')   // hop 2 > maxFollowHops 1
})

test('trustRowsToEdges uses ONLY verified provenance (memberkey + signed body)', () => {
  const edges = trustRowsToEdges([
    { memberkey: ME, json: { curatorRoot: A } }, // valid: sheets memberkey author + signed body
    { memberkey: A, json: { curatorRoot: B } },  // valid
    { from: A, curatorRoot: B },                   // forged: unsigned top-level → DROPPED
    { memberkey: ME, curatorRoot: A },             // curatorRoot not in signed body → DROPPED
    { json: { curatorRoot: A } },                  // no memberkey author → DROPPED
    { json: {} },                                  // incomplete → DROPPED
    null,                                          // null row → DROPPED (no throw)
  ])
  // matches the real sheets contract (row.memberkey); a Sybil cannot inject a
  // follow edge via attacker-controllable fields
  assert.deepEqual(edges, [{ from: ME, to: A }, { from: A, to: B }])
})

test('trustRowsToEdges hex-normalizes a Buffer memberkey', () => {
  const mk = Buffer.from('deadbeef', 'hex')
  const edges = trustRowsToEdges([{ memberkey: mk, json: { curatorRoot: A } }])
  assert.deepEqual(edges, [{ from: 'deadbeef', to: A }])
})

test('resourceRowToCandidate hex-normalizes a Buffer memberkey (deterministic dedup)', () => {
  const c = resourceRowToCandidate({ json: { name: 'X', driveKey: 'dk' }, memberkey: Buffer.from('aa', 'hex') })
  assert.equal(c.signerPubkey, 'aa', 'Buffer memberkey → hex, so the dedup tie-break is order-stable')
})

test('mergeFederated dedup winner is independent of source order (deterministic)', () => {
  const g = buildTrustGraph(ME, [{ from: ME, to: A }], { maxFollowHops: 2 })
  // same doc, same trustHop+tf from two followed sources → tie broken by signerPubkey
  const c1 = { docId: 'same', driveKey: 'd', path: '/', title: 'x', tf: 5, signerPubkey: 'aaa', contentHash: 'h1' }
  const c2 = { docId: 'same', driveKey: 'd', path: '/', title: 'x', tf: 5, signerPubkey: 'bbb', contentHash: 'h2' }
  const fwd = mergeFederated([{ rootPubkey: A, candidates: [c1] }, { rootPubkey: A, candidates: [c2] }], g)
  const rev = mergeFederated([{ rootPubkey: A, candidates: [c2] }, { rootPubkey: A, candidates: [c1] }], g)
  assert.equal(fwd[0].signerPubkey, rev[0].signerPubkey, 'same winner regardless of array order')
  assert.equal(fwd[0].signerPubkey, 'aaa') // lexicographically smaller signerPubkey wins
})

test('resourceRowToCandidate maps a descriptor row to a ranking candidate', () => {
  const c = resourceRowToCandidate({ json: { name: 'Keet', driveKey: 'dk', link: 'pear://keet', path: '/' }, memberkey: 'mk' }, 3)
  assert.equal(c.title, 'Keet')
  assert.equal(c.driveKey, 'dk')
  assert.equal(c.link, 'pear://keet')
  assert.equal(c.tf, 3)
  assert.equal(c.signerPubkey, 'mk')
  assert.match(c.docId, /^[0-9a-f]{16}$/)
})

test('mergeFederated dedups by doc keeping the best-trust copy', () => {
  const g = buildTrustGraph(ME, [{ from: ME, to: A }], { maxFollowHops: 2 })
  const doc = { docId: 'same', driveKey: 'd1', path: '/', title: 'Shared', tf: 5, publishedAt: 0 }
  const out = mergeFederated([
    { rootPubkey: Z, candidates: [{ ...doc }] },   // default (hop ∞)
    { rootPubkey: A, candidates: [{ ...doc }] },    // followed (hop 1) — should win
  ], g)
  assert.equal(out.length, 1, 'same doc deduped')
  assert.equal(out[0].tier, 'followed')
  assert.equal(out[0].trustHop, 1)
})

test('mergeFederated ranks a followed source above a default source', () => {
  const g = buildTrustGraph(ME, [{ from: ME, to: A }], { maxFollowHops: 2 })
  const mk = (docId, driveKey) => ({ docId, driveKey, path: '/', title: docId, tf: 5, publishedAt: 0 })
  const out = mergeFederated([
    { rootPubkey: Z, candidates: [mk('zdoc', 'dz')] },  // default
    { rootPubkey: A, candidates: [mk('adoc', 'da')] },  // followed
  ], g)
  assert.equal(out[0].docId, 'adoc', 'followed-curator result ranks first')
  assert.equal(out[1].docId, 'zdoc')
})

test('mergeFederated includes your own (self/hop-0) results at the top tier', () => {
  const g = buildTrustGraph(ME, [], { maxFollowHops: 2 })
  const out = mergeFederated([
    { rootPubkey: ME, candidates: [{ docId: 'mine', driveKey: 'dm', path: '/', title: 'Mine', tf: 5 }] },
  ], g)
  assert.equal(out[0].tier, 'self')
  assert.equal(out[0].trustHop, 0)
})
