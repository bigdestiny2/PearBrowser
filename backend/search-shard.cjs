// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/search-shard.cjs.
// Lighthouse Phase 4 — full-text shard tier router. PURE, CommonJS. The global
// full-text layer is research-grade and FLAG-GATED on proving cross-shard
// multi-keyword AND stays interactive (docs/research/bench-shard-and.mjs). This
// module owns the deterministic term→shard routing + the cross-shard AND plan;
// it never decides to ship the tier — that's the gate's call.
//
// Sharding: a term lives in shard = hash(term) mod numShards (prefix sharding).
// A hot term-PAIR can additionally live in a co-located BIGRAM shard so the
// head-of-distribution AND is a single-shard intersection, not cross-host — the
// mitigation for the Zipf scatter-gather cost.

const crypto = require('hypercore-crypto')
const b4a = require('b4a')

function hash32 (str) {
  const h = crypto.data(b4a.from(String(str)))
  return (((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3]) >>> 0
}

// Guard numShards (0/negative/NaN would make hash32 % N return NaN, poisoning
// routing); fall back to the 256 default.
function safeN (numShards) { return Number.isInteger(numShards) && numShards >= 1 ? numShards : 256 }

// Deterministic shard id in [0, numShards) for a term.
function shardOf (term, numShards = 256) {
  return hash32(term) % safeN(numShards)
}

// Injective, order-independent id for a term pair. '_'/'!'/'%' are escaped so a
// term containing the join character can't collide two distinct pairs.
function escTerm (t) { return String(t).replace(/[%_!]/g, (c) => '%' + c.charCodeAt(0).toString(16)) }
function pairId (t1, t2) { const [a, b] = t1 < t2 ? [t1, t2] : [t2, t1]; return escTerm(a) + '_' + escTerm(b) }

// Inverted-index posting key within a shard (same shape as the personal index).
const shardPostingKey = (term, invScore, docId) => `t!${term}!${invScore}!${docId}`
// Co-located bigram posting key: a pre-intersected list for an ordered term pair.
function bigramKey (t1, t2, invScore, docId) {
  return `tt!${pairId(t1, t2)}!${invScore}!${docId}`
}
function bigramShardOf (t1, t2, numShards = 256) {
  return shardOf(pairId(t1, t2), numShards)
}

// Plan a multi-keyword AND across shards. Returns:
//   single   — true if every query term routes to ONE shard (cheap, server-side
//              intersection; the case that stays interactive)
//   shards   — the distinct shard ids that must be contacted
//   byShard  — Map<shardId, terms[]>
//   bigram   — for the FIRST TWO query terms, the co-located bigram shard + key
//              prefix to TRY first (single-shard if the index built that pair),
//              converting a cross-host AND into one shard fetch. (This pure
//              module has no document-frequency signal, so it cannot pick the
//              rarest pair; a caller with df can choose the two terms to pass.)
function planCrossShardAnd (queryTerms, numShards = 256) {
  const terms = [...new Set((queryTerms || []).filter((t) => typeof t === 'string' && t))]
  const byShard = new Map()
  for (const t of terms) {
    const s = shardOf(t, numShards)
    if (!byShard.has(s)) byShard.set(s, [])
    byShard.get(s).push(t)
  }
  const shards = [...byShard.keys()]
  const plan = { terms, single: shards.length <= 1, shards, byShard, bigram: null }
  // Offer a bigram hint ONLY for a genuine cross-shard AND (terms in distinct
  // shards). When single, the AND is already a local single-shard intersection,
  // so a divergent bigram shard would just add a redundant extra hop.
  if (terms.length >= 2 && !plan.single) {
    const [t1, t2] = terms
    plan.bigram = { shard: bigramShardOf(t1, t2, numShards), keyPrefix: `tt!${pairId(t1, t2)}!` }
  }
  return plan
}

module.exports = { hash32, shardOf, shardPostingKey, bigramKey, bigramShardOf, planCrossShardAnd }
