// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/name-registry-apply.cjs.
// N5 — the name-registry reducer. PURE, CommonJS, deterministic (NO clock —
// ordering is the Autobase linear order). Two layers:
//
//   verifyOpAuthenticity(op) — well-formed + the ed25519 signature verifies under
//     op.owner over the RE-DERIVED canonical bytes (normalized/skeleton are
//     recomputed from op.name, never trusted from the wire). Returns the
//     recomputed { normalized, skeleton } or null (drop).
//
//   decide(ctx, op) — the policy, given the current entry for this name and the
//     entry that currently owns this skeleton:
//     • CLAIM   first-claim-wins: only an unowned/released name can be claimed;
//               a different owner cannot claim a name whose CONFUSABLE skeleton is
//               already held by a non-released name (homograph-squat defense).
//     • ROTATE  owner-only, monotonic version (no downgrade/replay) — supersedes.
//     • RELEASE owner-only → name + skeleton become free again.
//     • REVOKE  owner-only → tombstone; name AND its skeleton stay blocked.
//   revoke/release/rotate all require op.owner === the CURRENT owner, and the sig
//   already proved op.owner signed it — so only the current owner can transition.
//
// applyView(ops) folds a linearized op list through decide for tests; the store
// (name-registry-store) runs the SAME decide against its Hyperbee view.

const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const { normalize, skeleton } = require('./name-normalize.cjs')
const ops = require('./name-registry-ops.cjs')

function ed25519Verify (msg, sigHex, pubHex) {
  try { return crypto.verify(b4a.from(msg, 'utf-8'), b4a.from(String(sigHex), 'hex'), b4a.from(String(pubHex), 'hex')) } catch { return false }
}

function verifyOpAuthenticity (op) {
  if (!ops.isWellFormedOp(op)) return null
  const normalized = normalize(op.name)
  if (!normalized) return null
  const sk = skeleton(op.name)
  const canon = ops.canon(op.type, { name: op.name, normalized, target: op.target, owner: op.owner, version: op.version })
  if (!ed25519Verify(canon, op.sig, op.owner)) return null
  const target = (op.type === ops.CLAIM || op.type === ops.ROTATE)
    ? ops.normalizeTarget(op.target).target
    : null
  return { normalized, skeleton: sk, target }
}

const NOOP = { write: null }

// ctx: { current: entry|null, skelRec: {owner, names}|null, normalized, skeleton }
// entry:   { name, normalized, skeleton, target, owner, version, status }
// skelRec: the reservation for this skeleton — { owner, names:[...] } of ALL its
//   non-released holders (always one owner, since a different owner is rejected at
//   claim). Present ⇔ blocked. decide only needs its owner; the caller maintains
//   the holder set (skelAdd on claim, skelRemove on release, kept on revoke).
function decide (ctx, op) {
  const { current, skelRec, normalized, skeleton: sk } = ctx
  if (op.type === ops.CLAIM) {
    // first-claim-wins: an active or revoked (tombstoned) name is NOT re-claimable.
    if (current && current.status !== 'released') return NOOP
    // homograph defense: a DIFFERENT owner can't claim a name whose confusable
    // skeleton is reserved (held by any non-released entry — active or tombstoned).
    if (skelRec && skelRec.owner !== op.owner) return NOOP
    // version is monotonic across the name's whole lifecycle (NEVER reset on a
    // re-claim after release), so a replayed stale high-version rotate can't
    // resurrect an old target once the name is re-claimed.
    const version = (current ? current.version : 0) + 1
    return {
      write: { name: op.name, normalized, skeleton: sk, target: op.target, owner: op.owner, version, status: 'active' },
      skelAdd: true,
    }
  }
  if (op.type === ops.ROTATE) {
    if (!current || current.status !== 'active' || current.owner !== op.owner) return NOOP
    if (op.version <= current.version) return NOOP // monotonic — no downgrade/replay
    return { write: { ...current, target: op.target, version: op.version } }
  }
  if (op.type === ops.RELEASE) {
    if (!current || current.status !== 'active' || current.owner !== op.owner) return NOOP
    return { write: { ...current, status: 'released' }, skelRemove: true }
  }
  if (op.type === ops.REVOKE) {
    if (!current || current.status !== 'active' || current.owner !== op.owner) return NOOP
    return { write: { ...current, status: 'revoked' } } // tombstone; stays in skel set
  }
  return NOOP
}

// Pure reference reducer over a linearized op list → { names, skels } Maps.
// skels is set-valued: skeleton -> { owner, set:Set<normalized> } of its non-
// released holders, so releasing ONE confusable variant cannot free a skeleton
// another still-active/tombstoned variant depends on (the homograph bypass).
function applyView (opList) {
  const names = new Map() // normalized -> entry
  const skels = new Map() // skeleton -> { owner, set:Set<normalized> }
  for (const op of opList || []) {
    const auth = verifyOpAuthenticity(op)
    if (!auth) continue
    const { normalized, skeleton: sk } = auth
    const effectiveOp = auth.target ? { ...op, target: auth.target } : op
    const current = names.get(normalized) || null
    const skelRec = skels.get(sk) || null
    const d = decide({ current, skelRec, normalized, skeleton: sk }, effectiveOp)
    if (!d.write) continue
    names.set(normalized, d.write)
    if (d.skelAdd) {
      const rec = skels.get(sk) || { owner: op.owner, set: new Set() }
      rec.owner = op.owner
      rec.set.add(normalized)
      skels.set(sk, rec)
    }
    if (d.skelRemove) {
      const rec = skels.get(sk)
      if (rec) { rec.set.delete(normalized); if (rec.set.size === 0) skels.delete(sk) }
    }
  }
  return { names, skels }
}

// Resolve a typed name against a reduced { names } map → active entry or null.
function resolveFromNames (names, name) {
  const e = names.get(normalize(name))
  return (e && e.status === 'active') ? e : null
}

module.exports = { verifyOpAuthenticity, decide, applyView, resolveFromNames }
