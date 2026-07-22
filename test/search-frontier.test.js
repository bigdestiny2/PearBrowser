// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/search-frontier.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Phase-3 tests: IndexPointer (root-signed DHT pointer) + the fan-out budget
// planner (digest-first, cap-respecting connection selection).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const fr = require('../backend/search-frontier.cjs')

const hex = (b) => b4a.toString(b, 'hex')
const signer = (kp) => (s) => hex(crypto.sign(b4a.from(s, 'utf-8'), kp.secretKey))
// a peer with a digest head advertising the given terms
const peer = (rootPubkey, trustHop, terms, warm = false) => ({ rootPubkey, trustHop, warm, digest: { topTerms: terms } })

test('IndexPointer verifies against the Contacts-held root + resolves latest version', () => {
  const root = crypto.keyPair(); const rootHex = hex(root.publicKey)
  const attacker = crypto.keyPair()
  const p1 = fr.makeIndexPointer({ rootPubkey: rootHex, indexKey: 'idxA', version: 1 }, signer(root))
  const p2 = fr.makeIndexPointer({ rootPubkey: rootHex, indexKey: 'idxB', version: 2 }, signer(root))
  assert.equal(fr.verifyIndexPointer(p1, rootHex), true)
  // forged: claims the victim root but signed by attacker → fails
  const forged = fr.makeIndexPointer({ rootPubkey: rootHex, indexKey: 'evil', version: 9 }, signer(attacker))
  assert.equal(fr.verifyIndexPointer(forged, rootHex), false)
  // resolve ignores the forged high-version pointer, returns latest VALID
  assert.equal(fr.resolveIndexKey(rootHex, [p1, p2, forged]), 'idxB')
})

test('verifyIndexPointer rejects a non-integer (string) version', () => {
  const root = crypto.keyPair(); const rootHex = hex(root.publicKey)
  const canon = 'pear.lighthouse.indexptr.v1:' + JSON.stringify({ i: 'idx', r: rootHex, v: '10' }, ['i', 'r', 'v'])
  const evil = { kind: 'indexptr', rootPubkey: rootHex, indexKey: 'idx', version: '10', sig: signer(root)(canon) }
  assert.equal(fr.verifyIndexPointer(evil, rootHex), false)
  assert.equal(fr.resolveIndexKey(rootHex, [evil]), null)
})

test('planFanout is digest-first: peers whose digest lacks the term are skipped', () => {
  const frontier = [
    peer('a', 1, ['chat', 'peer']),
    peer('b', 1, ['recipes']),       // no 'chat' → skipped
    peer('c', 2, ['chat']),
  ]
  const plan = fr.planFanout(frontier, ['chat'], { maxConnectsPerQuery: 10 })
  assert.deepEqual(plan.pull.map((p) => p.rootPubkey).sort(), ['a', 'c'])
  assert.deepEqual(plan.skipped.map((p) => p.rootPubkey), ['b'])
})

test('planFanout caps NEW cold connects but reuses warm sessions for free', () => {
  const frontier = [
    peer('w1', 1, ['chat'], true),   // warm
    peer('w2', 1, ['chat'], true),   // warm
    peer('c1', 1, ['chat']),         // cold
    peer('c2', 2, ['chat']),         // cold
    peer('c3', 2, ['chat']),         // cold
  ]
  const plan = fr.planFanout(frontier, ['chat'], { maxConnectsPerQuery: 2 })
  // both warm reused + only 2 cold connects opened; the 3rd cold deferred
  assert.deepEqual(plan.pull.map((p) => p.rootPubkey).sort(), ['c1', 'c2', 'w1', 'w2'])
  assert.equal(plan.connects, 2)
  assert.deepEqual(plan.deferred.map((p) => p.rootPubkey), ['c3'])
})

test('planFanout bounds the considered frontier (closest trust first)', () => {
  const frontier = Array.from({ length: 100 }, (_, i) => peer('p' + i, (i % 3) + 1, ['chat']))
  const plan = fr.planFanout(frontier, ['chat'], { maxFrontier: 10, maxConnectsPerQuery: 100 })
  assert.ok(plan.pull.length + plan.skipped.length <= 10, 'only maxFrontier peers considered')
  // closest-hop peers are the ones considered
  assert.ok(plan.pull.every((p) => p.trustHop === 1))
})

test('planFanout respects the live-session ceiling', () => {
  const warm = Array.from({ length: 24 }, (_, i) => peer('w' + i, 1, ['chat'], true))
  const cold = [peer('c1', 1, ['chat'])]
  const plan = fr.planFanout([...warm, ...cold], ['chat'], { maxConnectsPerQuery: 4, maxLiveSessions: 24 })
  assert.equal(plan.connects, 0, 'already at the live-session ceiling → no new connects')
})

test('planFanout counts ALL held warm sessions against the ceiling (not just query-matching)', () => {
  // 24 warm peers that DON'T match this query still occupy the session ceiling
  const idleWarm = Array.from({ length: 24 }, (_, i) => peer('w' + i, 1, ['recipes'], true))
  const cold = [peer('c1', 1, ['chat'])]
  const plan = fr.planFanout([...idleWarm, ...cold], ['chat'], { maxConnectsPerQuery: 4, maxLiveSessions: 24 })
  assert.equal(plan.connects, 0, 'ceiling reached by non-matching warm sessions → no new connect')
})

test('buildFrontier skips self and unreachable roots', () => {
  const graph = { hopOf: (r) => ({ me: 0, a: 1, b: 2 }[r] ?? Infinity) }
  const out = fr.buildFrontier(['me', 'a', 'b', 'stranger'], graph, { warm: new Set(['a']) })
  assert.deepEqual(out.map((p) => p.rootPubkey).sort(), ['a', 'b'])
  assert.equal(out.find((p) => p.rootPubkey === 'a').warm, true)
})
