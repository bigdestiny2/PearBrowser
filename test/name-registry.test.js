// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/name-registry.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// N5 — the name-registry reducer policy (pure, via applyView). Pins first-claim-
// wins, owner-only rotate (monotonic), release-frees, revoke-tombstones, the
// confusable/homograph-squat defense, and that NO clock/timestamp can resurrect
// or reorder a decision (ordering is purely the linearized op list).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const ops = require('../backend/name-registry-ops.cjs')
const applyMod = require('../backend/name-registry-apply.cjs')
const { applyView, resolveFromNames } = applyMod

const hex = (x) => b4a.toString(x, 'hex')
const signer = (kp) => (msg) => hex(crypto.sign(b4a.from(msg, 'utf-8'), kp.secretKey))
const owner = (kp) => hex(kp.publicKey)
const TARGET_A = 'aa'.repeat(32)
const TARGET_B = 'bb'.repeat(32)
const TARGET_C = 'cc'.repeat(32)
const PEAR_LINK = 'pear://keet'
const HYPER_LINK = `hyper://${TARGET_A}/app`
const FILE_LINK = 'file:///tmp/pear-app'
// a confusable squat of "paypal": latin p, CYRILLIC а (U+0430), y, p, cyr а, l →
// skeleton folds to "paypal" but its normalized form differs.
const PAYPAL_SQUAT = 'pаypаl'

const resolve = (view, name) => {
  const e = resolveFromNames(view.names, name)
  return e ? { target: e.target, owner: e.owner, version: e.version, status: e.status } : null
}

test('first-claim-wins: the earlier claim in linear order owns the name', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'alice', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: 'alice', target: TARGET_B, owner: owner(b) }, signer(b)),
  ])
  assert.equal(resolve(view, 'alice').owner, owner(a))
  assert.equal(resolve(view, 'alice').target, TARGET_A)
})

test('claims can target allowed app links, while unsafe schemes are rejected', () => {
  const a = crypto.keyPair()
  assert.deepEqual(ops.normalizeTarget(HYPER_LINK), { target: HYPER_LINK, key: TARGET_A, link: HYPER_LINK, kind: 'link' })
  assert.deepEqual(ops.targetToResolution(HYPER_LINK), { key: TARGET_A, link: HYPER_LINK })
  assert.equal(ops.normalizeTarget(' PEAR://keet ').target, PEAR_LINK)
  assert.equal(ops.normalizeTarget(FILE_LINK).link, FILE_LINK)

  const view = applyView([
    ops.claimOp({ name: 'keet', target: PEAR_LINK, owner: owner(a) }, signer(a)),
  ])
  const r = resolveFromNames(view.names, 'keet')
  assert.equal(r.target, PEAR_LINK)
  assert.equal(ops.targetToResolution(r.target).link, PEAR_LINK)

  assert.throws(
    () => ops.claimOp({ name: 'bad', target: 'javascript:alert(1)', owner: owner(a) }, signer(a)),
    /target must be/
  )
  assert.throws(
    () => ops.claimOp({ name: 'web', target: 'https://example.com', owner: owner(a) }, signer(a)),
    /target must be/
  )
  const badRemote = {
    type: ops.CLAIM,
    name: 'bad',
    normalized: 'bad',
    target: 'javascript:alert(1)',
    owner: owner(a),
    version: 1,
    sig: signer(a)(ops.canon(ops.CLAIM, { name: 'bad', normalized: 'bad', target: 'javascript:alert(1)', owner: owner(a), version: 1 }))
  }
  assert.equal(resolveFromNames(applyView([badRemote]).names, 'bad'), null)
})

test('a forged claim (tampered signature) is dropped', () => {
  const a = crypto.keyPair()
  const good = ops.claimOp({ name: 'bob', target: TARGET_A, owner: owner(a) }, signer(a))
  const forged = { ...good, name: 'bob', target: TARGET_B } // body changed, sig no longer valid
  assert.equal(resolve(applyView([forged]), 'bob'), null)
  // and an owner-mismatch forgery: claim victim's name but sign with attacker key
  const victim = crypto.keyPair(); const attacker = crypto.keyPair()
  const impersonation = ops.claimOp({ name: 'carol', target: TARGET_A, owner: owner(victim) }, signer(attacker))
  assert.equal(resolve(applyView([impersonation]), 'carol'), null)
})

test('rotate is owner-only and monotonic (supersedes target; no downgrade/replay)', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const claim = ops.claimOp({ name: 'dave', target: TARGET_A, owner: owner(a) }, signer(a))
  // a non-owner cannot rotate
  const foreign = ops.rotateOp({ name: 'dave', target: TARGET_B, owner: owner(b), version: 2 }, signer(b))
  let view = applyView([claim, foreign])
  assert.equal(resolve(view, 'dave').target, TARGET_A)
  // the owner rotates forward
  const rot2 = ops.rotateOp({ name: 'dave', target: TARGET_B, owner: owner(a), version: 2 }, signer(a))
  view = applyView([claim, rot2])
  assert.equal(resolve(view, 'dave').target, TARGET_B)
  assert.equal(resolve(view, 'dave').version, 2)
  // a replayed/stale rotate at version <= current is ignored (no downgrade)
  const stale = ops.rotateOp({ name: 'dave', target: TARGET_A, owner: owner(a), version: 2 }, signer(a))
  view = applyView([claim, rot2, stale])
  assert.equal(resolve(view, 'dave').target, TARGET_B)
})

test('release frees the name; a different owner can then claim it', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'eve', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.releaseOp({ name: 'eve', owner: owner(a) }, signer(a)),
    ops.claimOp({ name: 'eve', target: TARGET_B, owner: owner(b) }, signer(b)),
  ])
  assert.equal(resolve(view, 'eve').owner, owner(b))
  assert.equal(resolve(view, 'eve').target, TARGET_B)
})

test('revoke tombstones the name — not re-claimable, even by the original owner', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'frank', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.revokeOp({ name: 'frank', owner: owner(a) }, signer(a)),
    ops.claimOp({ name: 'frank', target: TARGET_A, owner: owner(a) }, signer(a)), // re-claim
    ops.claimOp({ name: 'frank', target: TARGET_B, owner: owner(b) }, signer(b)), // by another
  ])
  assert.equal(resolve(view, 'frank'), null) // stays dead
})

test('homograph squat: a different owner cannot claim a confusable of a held name', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'paypal', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: PAYPAL_SQUAT, target: TARGET_B, owner: owner(b) }, signer(b)),
  ])
  assert.equal(resolve(view, 'paypal').owner, owner(a))
  assert.equal(resolve(view, PAYPAL_SQUAT), null) // the squat is rejected
})

test('the SAME owner may hold confusable variants of their own name', () => {
  const a = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'paypal', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: PAYPAL_SQUAT, target: TARGET_A, owner: owner(a) }, signer(a)),
  ])
  assert.equal(resolve(view, 'paypal').owner, owner(a))
  assert.equal(resolve(view, PAYPAL_SQUAT).owner, owner(a)) // same owner → allowed
})

test('a revoked name keeps its skeleton blocked (no confusable re-squat)', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'paypal', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.revokeOp({ name: 'paypal', owner: owner(a) }, signer(a)),
    ops.claimOp({ name: PAYPAL_SQUAT, target: TARGET_B, owner: owner(b) }, signer(b)),
  ])
  assert.equal(resolve(view, PAYPAL_SQUAT), null) // skeleton stays reserved by the tombstone
})

test('normalization: case/width variants are the same name', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'Alice', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: 'ALICE', target: TARGET_B, owner: owner(b) }, signer(b)),
  ])
  assert.equal(resolve(view, 'alice').owner, owner(a)) // second claim is the same name → loses
})

// --- regressions from the N5 adversarial review -----------------------------

test('homograph fix: releasing one confusable variant does NOT free a still-held skeleton', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'paypal', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: PAYPAL_SQUAT, target: TARGET_A, owner: owner(a) }, signer(a)), // same owner variant
    ops.releaseOp({ name: PAYPAL_SQUAT, owner: owner(a) }, signer(a)), // release the variant
    ops.claimOp({ name: PAYPAL_SQUAT, target: TARGET_B, owner: owner(b) }, signer(b)), // attacker squat
  ])
  assert.equal(resolve(view, 'paypal').owner, owner(a)) // original still A's
  assert.equal(resolve(view, PAYPAL_SQUAT), null) // squat STILL rejected (skeleton stays A's)
})

test('homograph fix (symmetric): releasing the original keeps the skeleton blocked while a variant is held', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'paypal', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: PAYPAL_SQUAT, target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.releaseOp({ name: 'paypal', owner: owner(a) }, signer(a)), // release the original
    ops.claimOp({ name: 'paypal', target: TARGET_B, owner: owner(b) }, signer(b)), // B grabs the freed exact name
  ])
  assert.equal(resolve(view, PAYPAL_SQUAT).owner, owner(a)) // variant still A's
  assert.equal(resolve(view, 'paypal'), null) // B blocked — the skeleton is still A's via the variant
})

test('homograph fix: releasing ALL variants frees the skeleton for another owner', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'paypal', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: PAYPAL_SQUAT, target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.releaseOp({ name: PAYPAL_SQUAT, owner: owner(a) }, signer(a)),
    ops.releaseOp({ name: 'paypal', owner: owner(a) }, signer(a)),
    ops.claimOp({ name: PAYPAL_SQUAT, target: TARGET_B, owner: owner(b) }, signer(b)),
  ])
  assert.equal(resolve(view, PAYPAL_SQUAT).owner, owner(b)) // skeleton fully freed → B
})

test('rotate-replay: a stale high-version rotate cannot resurrect after release + re-claim', () => {
  const a = crypto.keyPair()
  const claim1 = ops.claimOp({ name: 'site', target: TARGET_A, owner: owner(a) }, signer(a))
  const rot5 = ops.rotateOp({ name: 'site', target: TARGET_B, owner: owner(a), version: 5 }, signer(a))
  const rel = ops.releaseOp({ name: 'site', owner: owner(a) }, signer(a))
  const reclaim = ops.claimOp({ name: 'site', target: TARGET_C, owner: owner(a) }, signer(a))
  // replay the OLD v5 rotate (→ TARGET_B) AFTER the re-claim: version is monotonic
  // across the lifecycle, so the re-claim's effective version is > 5 → replay rejected.
  const view = applyView([claim1, rot5, rel, reclaim, rot5])
  const r = resolve(view, 'site')
  assert.equal(r.target, TARGET_C) // re-claim target holds; stale rotate ignored
  assert.ok(r.version > 5) // version never reset to 1 on re-claim
})

test('invisible filler codepoints are stripped — a filler-injected name is the same name', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'wallet', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: 'walᅠlet', target: TARGET_B, owner: owner(b) }, signer(b)), // Hangul filler
  ])
  assert.equal(resolve(view, 'wallet').owner, owner(a)) // filler stripped → same name → B loses
})

test('Cyrillic н (now folding to n) is caught as a homograph squat', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const view = applyView([
    ops.claimOp({ name: 'noah', target: TARGET_A, owner: owner(a) }, signer(a)),
    ops.claimOp({ name: 'нoah', target: TARGET_B, owner: owner(b) }, signer(b)), // Cyrillic н + 'oah'
  ])
  assert.equal(resolve(view, 'noah').owner, owner(a))
  assert.equal(resolve(view, 'нoah'), null) // skeleton folds to 'noah' → rejected
})

test('an oversized op (bloated extra field) is dropped by the byte cap', () => {
  const a = crypto.keyPair()
  const good = ops.claimOp({ name: 'big', target: TARGET_A, owner: owner(a) }, signer(a))
  const bloated = { ...good, junk: 'x'.repeat(5000) } // > MAX_OP_BYTES
  assert.equal(resolve(applyView([bloated]), 'big'), null) // dropped at apply
  assert.equal(resolve(applyView([good]), 'big').owner, owner(a)) // the un-bloated op is fine
})

test('the display name is signed: tampering it (same normalized) drops the op', () => {
  const a = crypto.keyPair()
  const good = ops.claimOp({ name: 'alice', target: TARGET_A, owner: owner(a) }, signer(a))
  const tampered = { ...good, name: 'Alice' } // normalizes to 'alice' but the signed display differs
  assert.equal(resolve(applyView([tampered]), 'alice'), null)
})

test('no clock can resurrect or reorder: an injected timestamp is ignored', () => {
  const a = crypto.keyPair(); const b = crypto.keyPair()
  const first = ops.claimOp({ name: 'grace', target: TARGET_A, owner: owner(a) }, signer(a))
  // B's later claim carries a huge fake timestamp; canon excludes it, so it neither
  // breaks the sig nor wins — linear order, not the clock, decides.
  const second = { ...ops.claimOp({ name: 'grace', target: TARGET_B, owner: owner(b) }, signer(b)), created_at: 9_999_999_999 }
  const view = applyView([first, second])
  assert.equal(resolve(view, 'grace').owner, owner(a))
})
