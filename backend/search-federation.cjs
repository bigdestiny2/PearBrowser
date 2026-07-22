// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/search-federation.cjs.
// Lighthouse Phase 1 — signed-descriptor federation (discovery: intent→key).
// PURE + framework-free, CommonJS. The discovery half of search: resolve a
// query against many small SIGNED descriptor rooms (schema-sheets) plus your
// personal index, ranked client-side over your trust graph (followed curators
// > default set). See docs/P2P-SEARCH-RESEARCH.md.
//
// This module owns the trust graph (hop distance → tier), the dedup-and-rank
// MERGE across sources, the descriptor-room schemas, and the row→candidate
// mapper. The actual room I/O (loading/querying a sheets room) integrates with
// sheets-catalog.js on the live-wiring pass; the ranking + trust logic here is
// the testable engine.

const sc = require('./search-core.cjs')
const b4a = require('b4a')

// schema-sheets per-row verified author provenance is `memberkey` (a Buffer);
// normalize to hex. Matches resourceRowToCandidate + sheets-catalog rowToApp.
function memberRootHex (v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try { return b4a.toString(v, 'hex') } catch { return '' }
}

// schema-sheets schema for a RESOURCE descriptor room: a signed pointer that
// supplies the human-meaningful corner of Zooko's triangle for a hyper:// key.
const RESOURCE_SCHEMA = {
  type: 'object',
  required: ['name'],
  additionalProperties: true,
  properties: {
    name: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    driveKey: { type: 'string', maxLength: 128 },
    link: { type: 'string', maxLength: 256 },          // pear:// or hyper://
    path: { type: 'string', maxLength: 512 },
    kind: { type: 'string', maxLength: 40 },           // app | site | dataset | feed | doc
    keywords: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 64 },
    publishedAt: { type: 'number' },
  },
}

// schema-sheets schema for a TRUST room: a signed "I follow this curator" edge.
// The room is keyed/authored by your root identity (signed provenance); each
// row vouches for another root pubkey as a curator you trust.
const TRUST_SCHEMA = {
  type: 'object',
  required: ['curatorRoot'],
  additionalProperties: true,
  properties: {
    curatorRoot: { type: 'string', maxLength: 128 },   // hex root pubkey you follow
    label: { type: 'string', maxLength: 120 },
    weight: { type: 'number' },                        // optional 0..1 emphasis
    addedAt: { type: 'number' },
  },
}

// Build a trust graph from follow edges and resolve hop distance / tier from
// YOUR root. edges: [{ from: rootHex, to: rootHex }] (from follows to). hop 0 =
// self; 1..maxFollowHops = followed (directly or transitively); beyond = default.
function buildTrustGraph (selfRoot, edges, { maxFollowHops = 2 } = {}) {
  const adj = new Map()
  for (const e of edges || []) {
    if (!e || !e.from || !e.to) continue
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    adj.get(e.from).add(e.to)
  }
  const hop = new Map([[selfRoot, 0]])
  let frontier = [selfRoot]
  for (let h = 1; h <= maxFollowHops && frontier.length; h++) {
    const next = []
    for (const u of frontier) {
      for (const v of (adj.get(u) || [])) {
        if (!hop.has(v)) { hop.set(v, h); next.push(v) }
      }
    }
    frontier = next
  }
  return {
    maxFollowHops,
    hopOf (root) { return hop.has(root) ? hop.get(root) : Infinity },
    tierOf (root) {
      const h = hop.has(root) ? hop.get(root) : Infinity
      if (h === 0) return 'self'
      return h <= maxFollowHops ? 'followed' : 'default'
    },
  }
}

// Convert a TRUST room's rows into follow edges rooted at you. A row authored
// by `selfRoot` that names `curatorRoot` is an edge self→curator; transitive
// edges come from replicating a followed curator's own trust room.
function trustRowsToEdges (rows) {
  const edges = []
  for (const r of rows || []) {
    if (!r) continue
    // Provenance must come from VERIFIED fields ONLY: the row's `memberkey`
    // (the sheets layer's per-row signed author) and the signed body's
    // `json.curatorRoot`. Unsigned top-level `.from`/`.to`/`.curatorRoot` are
    // attacker-controllable — accepting them would let anyone forge a follow
    // edge and promote a Sybil into the followed tier.
    const from = memberRootHex(r.memberkey)
    const to = r.json && r.json.curatorRoot
    // curatorRoot must be a hex STRING (TRUST_SCHEMA declares it so); a
    // Buffer/number would be mis-keyed and silently demoted to the default tier.
    if (from && typeof to === 'string' && to) edges.push({ from, to })
  }
  return edges
}

// Map a RESOURCE descriptor row → a ranking candidate. `tf` is the query-match
// strength the caller computed (e.g. count of query terms present in
// name+keywords); defaults to 1 for a plain listing.
function resourceRowToCandidate (row, tf = 1) {
  const j = (row && row.json) || row || {}
  const driveKey = j.driveKey || j.link || ''
  const path = j.path || '/'
  return {
    docId: sc.docIdFor(driveKey, path),
    driveKey,
    link: j.link || null,
    path,
    title: j.name || driveKey,
    tf,
    publishedAt: j.publishedAt || 0,
    contentHash: '',
    // hex-normalize the Buffer memberkey so the mergeFederated dedup tie-break
    // (lexicographic on signerPubkey) is deterministic across peers — a raw
    // Buffer compares via lossy utf-8 coercion.
    signerPubkey: memberRootHex(row && row.memberkey),
  }
}

// Tag a candidate with the trust tier/hop of the source root that vouched for it.
function tagCandidate (c, sourceRoot, graph) {
  const hop = graph.hopOf(sourceRoot)
  return { ...c, trustHop: Number.isFinite(hop) ? hop : 99, tier: graph.tierOf(sourceRoot) }
}

// Merge candidates from many sources, dedup by document (best trust wins, then
// best text match), and rank with the deterministic search-core ranker.
// sources: [{ rootPubkey, candidates: [candidate...] }]. `now0` threads into
// the ranker (recency) without any clock read in the fold.
function mergeFederated (sources, graph, { now0 = 0, limit = 50 } = {}) {
  const byDoc = new Map()
  for (const src of sources || []) {
    if (!src) continue
    const root = src.rootPubkey
    for (const c of (src.candidates || [])) {
      if (!c) continue
      const tagged = tagCandidate(c, root, graph)
      const key = c.docId || (c.driveKey + '|' + (c.path || '/'))
      const prev = byDoc.get(key)
      // best trust (lowest hop) wins, then best text match, then a deterministic
      // signerPubkey/contentHash tie-break so the retained copy is independent
      // of `sources` iteration order (cross-peer reproducibility).
      const sig = (x) => x.signerPubkey || ''
      const ch = (x) => x.contentHash || ''
      const better = !prev ||
        tagged.trustHop < prev.trustHop ||
        (tagged.trustHop === prev.trustHop && (tagged.tf || 0) > (prev.tf || 0)) ||
        (tagged.trustHop === prev.trustHop && (tagged.tf || 0) === (prev.tf || 0) &&
          (sig(tagged) < sig(prev) || (sig(tagged) === sig(prev) && ch(tagged) < ch(prev))))
      if (better) byDoc.set(key, tagged)
    }
  }
  // explicit null/NaN/Infinity limit coalesces back to the default rather than
  // 0 results (Number(null)===0 would otherwise slip through).
  const lim = limit == null ? 50 : Number(limit)
  const n = Number.isFinite(lim) && lim >= 0 ? Math.floor(lim) : 50
  return sc.rankCandidates([...byDoc.values()], { now0 }).slice(0, n)
}

module.exports = {
  RESOURCE_SCHEMA, TRUST_SCHEMA,
  buildTrustGraph, trustRowsToEdges, resourceRowToCandidate, tagCandidate, mergeFederated,
}
