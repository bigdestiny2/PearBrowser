// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/search-completeness.cjs.
// Lighthouse Phase 5 — completeness anchors + withholding detection + PoR. PURE,
// CommonJS. Re-verification proves authenticity, not COMPLETENESS: a peer can
// serve valid-but-partial results. Two layers (docs/P2P-SEARCH-RESEARCH.md):
//  - Layer 1 (PROVABLE): a root-signed CompletenessAnchor committing to the
//    author's index length + tree hash at a known point. Truncation / fork /
//    substitution are detectable. (On the live core this binds to hypercore
//    11.28's signed-tree / verifyFullyRemote; here it's the signed commitment +
//    the verifier logic.)
//  - Layer 2 (SAMPLE-DETECTABLE): probe R random docIds the digest claims are
//    present; if the server omits one, withholding is caught with probability
//    1-(1-f)^R for fraction f omitted. Targeted micro-omission below the probe
//    rate stays a true, stated limit of single-writer indexes.
//  - PoR freshness: a nonce challenge the holder answers with a signed current
//    length, proving it still holds ≥ L entries now (not a stale snapshot).

const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const dg = require('./search-digest.cjs')

function hash32 (str) {
  const h = crypto.data(b4a.from(String(str)))
  return (((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3]) >>> 0
}

// --- Layer 1: signed completeness anchor -------------------------------------

const ANCHOR_TAG = 'pear.lighthouse.anchor.v1:'
function canonAnchor (rootPubkey, indexKey, length, treeHash) {
  return ANCHOR_TAG + JSON.stringify({ r: rootPubkey, i: indexKey, l: length, h: treeHash }, ['h', 'i', 'l', 'r'])
}
function makeAnchor ({ rootPubkey, indexKey, length, treeHash }, rootSign) {
  if (!Number.isInteger(length) || length < 0) throw new Error('length must be a non-negative integer')
  return { kind: 'anchor', rootPubkey, indexKey, length, treeHash, sig: rootSign(canonAnchor(rootPubkey, indexKey, length, treeHash)) }
}
function verifyAnchor (anchor, expectedRootPubkey) {
  if (!anchor || anchor.kind !== 'anchor' || anchor.rootPubkey !== expectedRootPubkey) return false
  // length must be a canonical integer: a string '500' would otherwise verify
  // (the sig is over its JSON form) yet evade the numeric === / < comparisons in
  // isFork/isTruncation, letting an equivocating author bypass Layer-1 detection.
  if (!Number.isInteger(anchor.length) || anchor.length < 0) return false
  try {
    return crypto.verify(b4a.from(canonAnchor(anchor.rootPubkey, anchor.indexKey, anchor.length, anchor.treeHash), 'utf-8'),
      b4a.from(anchor.sig, 'hex'), b4a.from(expectedRootPubkey, 'hex'))
  } catch { return false }
}

// A new anchor only legitimately ADVANCES (length must not go backwards for the
// same index) — a shorter signed length than one you've seen is a truncation
// attack, even though both are validly signed.
function isTruncation (prevAnchor, newAnchor) {
  if (!prevAnchor || !newAnchor) return false
  if (prevAnchor.indexKey !== newAnchor.indexKey) return false
  return newAnchor.length < prevAnchor.length
}

// Fork/substitution: two validly-signed anchors at the SAME length with
// different tree hashes are provable equivocation (the author published two
// divergent histories). Callers reject on truncation OR fork.
function isFork (prevAnchor, newAnchor) {
  if (!prevAnchor || !newAnchor) return false
  if (prevAnchor.indexKey !== newAnchor.indexKey) return false
  return newAnchor.length === prevAnchor.length && newAnchor.treeHash !== prevAnchor.treeHash
}

// --- Layer 2: sample-detectable withholding ----------------------------------

// Deterministically sample R docIds from a reference set the verifier believes
// SHOULD be present (e.g. from its own replica / cross-referenced sources),
// seeded by the anchor so the server can't predict the probes ahead of serving.
function deriveProbes (seed, referenceDocIds, R) {
  const ids = [...new Set(referenceDocIds || [])]
  const n = ids.length
  const take = Math.max(0, Math.min(Math.floor(Number(R) || 0), n))
  // deterministic seeded partial Fisher-Yates — selects exactly `take` distinct
  // probes in O(n), never under-samples (the old reject-on-collision loop could
  // return fewer than R under coupon-collector pressure, weakening detection).
  for (let i = 0; i < take; i++) {
    const j = i + (hash32(seed + ':' + i) % (n - i))
    const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp
  }
  return ids.slice(0, take)
}

// Given the server's served docId set, flag probes the digest says are present
// but the server omitted. suspected=true ⇒ withholding detected.
function detectWithholding (digest, probeDocIds, servedDocIds) {
  const served = new Set(servedDocIds || [])
  const missing = []
  for (const id of probeDocIds || []) {
    if (dg.digestMayContainDoc(digest, id) && !served.has(id)) missing.push(id)
  }
  return { checked: (probeDocIds || []).length, missing, suspected: missing.length > 0 }
}

// Probability a fraction-f omission is caught by R independent probes. Inputs
// clamped so the published guarantee is robust to caller mis-scaling.
function detectionProbability (f, R) {
  const ff = Math.min(Math.max(Number(f) || 0, 0), 1)
  const rr = Math.max(0, Math.floor(Number(R) || 0))
  return 1 - Math.pow(1 - ff, rr)
}

// --- PoR freshness challenge -------------------------------------------------

const POR_TAG = 'pear.lighthouse.por.v1:'
function makeFreshnessChallenge (nonce, minLength) { return { kind: 'por-challenge', nonce, minLength } }

// Holder answers: a root-signed assertion of current length + tree hash bound
// to the challenge nonce (proves liveness, not just a replayable old snapshot).
function answerFreshness (challenge, { rootPubkey, indexKey, length, treeHash }, rootSign) {
  if (!Number.isInteger(length) || length < 0) throw new Error('length must be a non-negative integer')
  const msg = POR_TAG + JSON.stringify({ n: challenge.nonce, r: rootPubkey, i: indexKey, l: length, h: treeHash }, ['h', 'i', 'l', 'n', 'r'])
  return { kind: 'por-response', nonce: challenge.nonce, rootPubkey, indexKey, length, treeHash, sig: rootSign(msg) }
}
function verifyFreshness (challenge, response, expectedRootPubkey) {
  if (!challenge || !response || response.nonce !== challenge.nonce) return false
  if (response.rootPubkey !== expectedRootPubkey) return false
  // length bound must be a purely numeric comparison — reject string/NaN lengths
  // (a non-canonical "1500" would otherwise pass `>=` via coercion).
  if (!Number.isInteger(response.length) || !Number.isInteger(challenge.minLength)) return false
  if (response.length < challenge.minLength) return false
  const msg = POR_TAG + JSON.stringify({ n: response.nonce, r: response.rootPubkey, i: response.indexKey, l: response.length, h: response.treeHash }, ['h', 'i', 'l', 'n', 'r'])
  try {
    return crypto.verify(b4a.from(msg, 'utf-8'), b4a.from(response.sig, 'hex'), b4a.from(expectedRootPubkey, 'hex'))
  } catch { return false }
}

module.exports = {
  makeAnchor, verifyAnchor, isTruncation, isFork,
  deriveProbes, detectWithholding, detectionProbability,
  makeFreshnessChallenge, answerFreshness, verifyFreshness,
}
