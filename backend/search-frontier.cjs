// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/search-frontier.cjs.
// Lighthouse Phase 3 — multi-hop frontier fan-out. PURE, CommonJS. Two pieces:
//  1. IndexPointer — a tiny, root-signed DHT record mapping a contact's root
//     pubkey → their current search-index core key (resolved at app start;
//     verified against the Contacts-held root, like the IdentityBinding).
//  2. planFanout — the connection-budget algorithm that keeps networked fan-out
//     inside the SwarmBridge caps (8 channels / 10 joins-per-min are a
//     per-page-webview throttle; first-party search joins the shared swarm
//     directly under its OWN budget). Digest-FIRST: open a full-shard
//     replication only to peers whose cheap digest says they might match, warm
//     sessions are reused, and NEW cold connects are hard-capped per query so a
//     large frontier can't blow the budget. See docs/P2P-SEARCH-RESEARCH.md.

const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const dg = require('./search-digest.cjs')

// --- IndexPointer (DHT) ------------------------------------------------------

const POINTER_TAG = 'pear.lighthouse.indexptr.v1:'
function canonPointer (rootPubkey, indexKey, version) {
  return POINTER_TAG + JSON.stringify({ r: rootPubkey, i: indexKey, v: version }, ['i', 'r', 'v'])
}

// `rootSign(msgString) -> sigHex` (identity.sign in the app).
function makeIndexPointer ({ rootPubkey, indexKey, version }, rootSign) {
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer')
  if (typeof rootPubkey !== 'string' || !rootPubkey) throw new Error('rootPubkey required')
  if (typeof indexKey !== 'string' || !indexKey) throw new Error('indexKey required')
  return { kind: 'indexptr', rootPubkey, indexKey, version, sig: rootSign(canonPointer(rootPubkey, indexKey, version)) }
}

function verifyIndexPointer (ptr, expectedRootPubkey) {
  if (!ptr || ptr.kind !== 'indexptr' || ptr.rootPubkey !== expectedRootPubkey) return false
  // canonical integer version (mirror verifyBinding/verifyAnchor) so a string
  // version can't beat legit ones / make resolveIndexKey order-dependent.
  if (!Number.isInteger(ptr.version) || ptr.version < 1) return false
  try {
    return crypto.verify(b4a.from(canonPointer(ptr.rootPubkey, ptr.indexKey, ptr.version), 'utf-8'),
      b4a.from(ptr.sig, 'hex'), b4a.from(expectedRootPubkey, 'hex'))
  } catch { return false }
}

// Pick the highest-version verified pointer for a root → its index key, or null.
function resolveIndexKey (expectedRootPubkey, pointers) {
  let best = null
  for (const p of pointers || []) {
    if (!p || typeof p.indexKey !== 'string' || !p.indexKey) continue
    if (!verifyIndexPointer(p, expectedRootPubkey)) continue
    // highest version wins; equal-version ties broken deterministically by
    // indexKey so resolution is independent of pointer array order.
    if (!best || p.version > best.version ||
      (p.version === best.version && p.indexKey < best.indexKey)) best = p
  }
  return best ? best.indexKey : null
}

// --- Fan-out budget planner --------------------------------------------------

const DEFAULT_BUDGET = {
  maxFrontier: 64,         // most trust-ranked peers considered per query
  maxConnectsPerQuery: 4,  // NEW cold swarm connections opened per query
  maxLiveSessions: 24,     // ceiling on concurrently-held replication sessions
}

// Decide which frontier peers to pull a full shard from this query.
// frontier: [{ rootPubkey, trustHop, digest, warm }]. `warm` = an open/cached
// replication session (≈ free). Returns { pull, deferred, skipped, connects }.
function planFanout (frontier, queryTerms, budget = {}) {
  const b = { ...DEFAULT_BUDGET, ...budget }
  // consider the closest (lowest-hop) peers first; ties stable by rootPubkey
  const ranked = [...(frontier || [])]
    .sort((a, c) => (a.trustHop - c.trustHop) || (String(a.rootPubkey) < String(c.rootPubkey) ? -1 : 1))
    .slice(0, b.maxFrontier)

  // digest-first: only peers whose digest advertises a query term are worth pulling
  const hits = ranked.filter((p) => dg.digestWorthPulling(p.digest, queryTerms))
  const skipped = ranked.filter((p) => !dg.digestWorthPulling(p.digest, queryTerms))

  const warm = hits.filter((p) => p.warm)            // reuse existing sessions — no new connect
  const cold = hits.filter((p) => !p.warm)

  // Sessions held against the ceiling = ALL warm peers we currently hold open,
  // not just those matching THIS query (a replication session is held
  // regardless of the current term). Counting only query-matching warm peers
  // would overshoot maxLiveSessions.
  const liveHeld = (frontier || []).filter((p) => p && p.warm).length
  const connectSlots = Math.max(0, Math.min(b.maxConnectsPerQuery, b.maxLiveSessions - liveHeld))
  const coldPull = cold.slice(0, connectSlots)
  const deferred = cold.slice(connectSlots)          // background / next round

  return { pull: [...warm, ...coldPull], deferred, skipped, connects: coldPull.length }
}

// Build frontier entries from contacts + a trust graph + known digests/warm set.
function buildFrontier (contacts, graph, { digests = new Map(), warm = new Set() } = {}) {
  const out = []
  for (const root of contacts || []) {
    const hop = graph.hopOf(root)
    if (!Number.isFinite(hop) || hop === 0) continue // skip self + unreachable
    out.push({ rootPubkey: root, trustHop: hop, digest: digests.get(root) || null, warm: warm.has(root) })
  }
  return out
}

module.exports = {
  DEFAULT_BUDGET,
  canonPointer, makeIndexPointer, verifyIndexPointer, resolveIndexKey,
  planFanout, buildFrontier,
}
