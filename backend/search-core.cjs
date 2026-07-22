// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/search-core.cjs.
// Lighthouse search core — Phase 0 (self-search) engine. PURE + framework-free,
// CommonJS (.cjs) so Bare can require() it and Node can default-import it for
// tests. This is the engine every later phase reuses unchanged (docs/
// P2P-SEARCH-RESEARCH.md). It owns: tokenization, the v2 on-disk schema
// (per-doc signing → thin t! postings bound by a postingSetHash), and the v2
// deterministic capped-additive-in-log-space ranker. No wall-clock is read
// inside any ranking fold (`now0` is passed in), so ranking is a pure function
// of (candidate set + static trust graph) — deterministic across runs/devices.

const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const SCHEMA_VERSION = 2
const MAX_TERMS_PER_DOC = 64
const INV_WIDTH = 18 // zero-pad width for inverted-score keys

// A compact English stoplist — enough to drop the highest-frequency noise
// without an external dep. Tuned for recall, not linguistic completeness.
const STOPWORDS = new Set(('a an and are as at be but by for from has have he her his ' +
  'i in is it its of on or that the their them they this to was were will with you your ' +
  'we our not no do does did so if then than too can could would should how what when where ' +
  'which who whom why all any each more most other some such only own same up out off over').split(' '))

// Lowercase, NFKC-normalize, split on non-alphanumerics, drop stopwords + very
// short tokens, count term frequency, cap at MAX_TERMS_PER_DOC most-frequent
// terms. Returns [{ term, tf }] sorted by term (canonical order for signing).
function tokenize (text) {
  if (typeof text !== 'string' || !text) return []
  const norm = text.normalize('NFKC').toLowerCase()
  const tf = new Map()
  for (const raw of norm.split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || raw.length > 40) continue
    if (STOPWORDS.has(raw)) continue
    tf.set(raw, (tf.get(raw) || 0) + 1)
  }
  // keep the MAX_TERMS_PER_DOC highest-tf terms (ties by term for determinism)
  const top = [...tf.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_TERMS_PER_DOC)
  return top.map(([term, n]) => ({ term, tf: n })).sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
}

function hashHex (str) {
  return b4a.toString(crypto.data(b4a.from(String(str))), 'hex')
}

// Stable doc id = hash(len(driveKey)|driveKey|path)[:16]. Length-prefixed so
// (driveKey,path) is unambiguous (a NUL separator could be forged across the
// boundary). Identifies a page across re-crawls.
function docIdFor (driveKey, path) {
  const dk = String(driveKey || ''); const p = String(path || '/')
  return hashHex(dk.length + '|' + dk + '|' + p).slice(0, 16)
}

// invScore makes a forward Hyperbee range scan return highest-score-first.
function invScore (localScore) {
  const s = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(localScore) || 0)))
  return String(Number.MAX_SAFE_INTEGER - s).padStart(INV_WIDTH, '0')
}

const postingKey = (term, localScore, docId) => `t!${term}!${invScore(localScore)}!${docId}`
const docKey = (docId) => `d!${docId}`

// Hash binding the thin t! postings to the per-doc signature: a peer cannot
// inject/alter/drop a posting without breaking this (recomputed at verify).
function postingSetHash (terms) {
  // Injective canonical encoding: JSON of sorted [term, tf, field] triples. A
  // delimiter-join ('term:tf:field' | …) collides when a term contains the
  // delimiters, which would let a tamperer alter the posting set undetected.
  // canonNum keeps non-finite tf/field DISTINCT (JSON.stringify maps NaN /
  // Infinity / undefined / null all to `null`, which would collide distinct
  // tampered posting sets under one integrity hash).
  const canonNum = (x) => Number.isFinite(x) ? x : 'nf:' + String(x)
  const canon = [...terms]
    .sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .map((t) => [t.term, canonNum(t.tf), canonNum(t.field || 1)])
  return hashHex(JSON.stringify(canon))
}

// Build the v2 records for one document: one signed d! record carrying the
// canonical posting set + ONE sig, plus thin t! postings. `sign(payload)` is
// injected (identity.signForApp in the app; a stub in tests) and returns
// { sig, pubkey }. localScore defaults to tf (term-frequency-as-score at hop-0).
function buildDocRecords (doc, sign) {
  const { driveKey = '', path = '/', title = '', body = '', publishedAt = 0 } = doc
  const terms = tokenize(`${title} ${title} ${body}`) // title weighted 2x
  const docId = docIdFor(driveKey, path)
  const h = postingSetHash(terms)
  const canonDoc = { v: SCHEMA_VERSION, docId, driveKey, path, title: String(title).slice(0, 200), terms, h, publishedAt }
  const signed = sign ? sign(canonDoc) : { sig: '', pubkey: '' }
  const records = []
  records.push([docKey(docId), { ...canonDoc, sig: signed.sig, signerPubkey: signed.pubkey }])
  for (const { term, tf } of terms) {
    records.push([postingKey(term, tf, docId), { tf, ff: 1 }])
  }
  return { docId, terms, records }
}

// The EXACT bytes buildDocRecords signed for a doc: the canonDoc (the d! record
// minus sig + signerPubkey) in its original key order. Shared by the signer
// (PersonalIndex sign hook) and the federated RowVerifier so a peer's posting
// signature is checked over identical bytes — any tampering changes these bytes
// and fails the check.
function canonDocBytes (rec) {
  return JSON.stringify({
    v: rec.v, docId: rec.docId, driveKey: rec.driveKey, path: rec.path,
    title: rec.title, terms: rec.terms, h: rec.h, publishedAt: rec.publishedAt,
  })
}

// FNV-1a over a string → a deterministic [0,1) dither for exploration that
// never reads a clock or RNG, so rankings are reproducible.
function fnvUnit (str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0 }
  return (h >>> 0) / 0xffffffff
}

// Stable 3-way string compare for deterministic, antisymmetric tie-breaks.
function cmp (a, b) { return a < b ? -1 : a > b ? 1 : 0 }

const RANK = {
  W: { text: 1.0, trust: 0.9, endorse: 0.6, recency: 0.5, tier: 0.7 }, // feature weights
  // ε-floor kept SHALLOW: with a tiny eps, ln(eps) is a deep cliff so a single
  // zero/low feature (e.g. 0 endorsers) would dominate the log-product and bury
  // a strong text match. 0.15 keeps every feature's contribution bounded.
  EPS: 0.15,
  E_CAP: 8,         // hard cap on endorser breadth (sybil-proof)
  HALFLIFE_DAYS: 30,
  LAMBDA: 0.05,     // exploration dither magnitude (small, deterministic)
  TIER: { self: 1.0, followed: 0.8, default: 0.5 },
  K1: 1.2,          // BM25-style tf saturation
}

// The v2 ranker: a pure, deterministic, capped-additive-in-log-space score.
// `candidates`: [{ docId, driveKey, path, title, tf, trustHop, endorsers,
//   publishedAt, tier, contentHash, signerPubkey }]. `now0` is the single
// query-time timestamp, passed IN (never read inside the fold). Returns
// candidates sorted best-first with a `_score`, after MMR diversity by driveKey.
function rankCandidates (candidates, { now0 = 0, diversity = true } = {}) {
  const eps = RANK.EPS
  const clamp01 = (x) => Math.max(0, Math.min(1, x))
  // Text relevance is the PRIMARY base (low text → low score, correct). Every
  // other feature is a NON-NEGATIVE boost via ln(1 + w·f): an absent feature
  // (0 endorsers, an old doc) contributes ln(1)=0 (neutral), so it can never
  // bury a strong text match — fixing the ε-cliff where a single zero feature
  // dominated the log-product. Boosts are bounded by their weights.
  const boost = (w, f) => Math.log(1 + w * clamp01(f))
  // Coerce EVERY feature input to a finite number with a NEUTRAL default —
  // any non-numeric tf/trustHop/endorsers/publishedAt (a peer-supplied ISO
  // date string, a typo) must never poison _score with NaN, which would make
  // the order comparator non-transitive. This is the deterministic trust
  // boundary; it self-defends all inputs, not just some.
  const num = (x, dflt) => { const v = Number(x); return Number.isFinite(v) ? v : dflt }
  const scored = candidates.map((c) => {
    // clamp tf ≥ 0: a hostile negative tf hits the BM25 pole at -K1 and inverts
    // to MAX relevance (tf=-5 → ratio 1.3 → clamped to 1.0).
    const tfc = Math.max(0, num(c.tf, 0))
    const f1 = tfc / (tfc + RANK.K1)                                       // text (BM25-ish saturation)
    const f2 = 1 / (1 + Math.max(0, num(c.trustHop, 0)))                   // trust proximity (hop-0 → 1)
    const f3 = Math.min(Math.max(0, num(c.endorsers, 0)), RANK.E_CAP) / RANK.E_CAP // endorser breadth, capped
    const pub = num(c.publishedAt, 0)
    const ageDays = now0 && pub ? Math.max(0, (now0 - pub) / 86400000) : 0
    const f4 = Math.pow(2, -ageDays / RANK.HALFLIFE_DAYS)                  // recency half-life
    // typeof-number guard: a prototype-chain tier key ('__proto__', 'toString'…)
    // would resolve RANK.TIER[c.tier] to an object (!= null), making f5 an object
    // → NaN _score → a non-transitive comparator that breaks the total order.
    const f5raw = RANK.TIER[c.tier]
    const f5 = typeof f5raw === 'number' ? f5raw : RANK.TIER.default
    const logScore = RANK.W.text * Math.log(eps + clamp01(f1)) +
      boost(RANK.W.trust, f2) + boost(RANK.W.endorse, f3) +
      boost(RANK.W.recency, f4) + boost(RANK.W.tier, f5)
    const dither = RANK.LAMBDA * fnvUnit(c.docId || c.path || '')
    const score = logScore + dither
    // backstop: never let a non-finite score reach the comparator
    return { ...c, _score: Number.isFinite(score) ? score : -Infinity }
  })
  // total order: score desc, then contentHash, then signerPubkey (deterministic,
  // antisymmetric — never returns 1 for equal operands)
  const order = (a, b) => (b._score - a._score) ||
    cmp(a.contentHash || '', b.contentHash || '') ||
    cmp(a.signerPubkey || '', b.signerPubkey || '')
  scored.sort(order)
  if (!diversity) return scored
  // greedy MMR-lite: lightly penalize repeats of the same driveKey so one site
  // can't monopolize the page. Pure (penalty depends only on prior selections).
  const seen = new Map()
  for (const c of scored) {
    const n = seen.get(c.driveKey) || 0
    c._score -= 0.15 * n
    seen.set(c.driveKey, n + 1)
  }
  scored.sort(order)
  return scored
}

// Extract candidate rows (PRE-rank) for a query over a ready Hyperbee holding v2
// records: tokenize → bounded range-scan per term → AND-intersect by docId →
// hydrate d! records. The rank+slice is split out (searchIndex) so a federated
// planner can pull raw candidates from many peer bees and rank them together
// exactly once (search-federation.mergeFederated). `tier`/`trustHop` describe
// the source (hop-0 self = {tier:'self', trustHop:0}).
// Scan a ready v2 Hyperbee for query hits: tokenize → bounded range-scan per
// term → AND-intersect by docId → hydrate the d! record. Returns
// [{ docId, tf, rec }] in intersection order (rec is the full signed d! record,
// or null if missing). Shared by searchCandidates (local rank) and
// searchSignedHits (federated verify).
async function scanHits (bee, query, { perTerm = 500 } = {}) {
  const qterms = tokenize(query).map((t) => t.term)
  if (qterms.length === 0) return []
  const lists = []
  for (const term of qterms) {
    const m = new Map()
    for await (const e of bee.createReadStream({ gte: `t!${term}!`, lt: `t!${term}!~`, limit: perTerm })) {
      const k = e.key
      const docId = k.slice(k.lastIndexOf('!') + 1)
      m.set(docId, (m.get(docId) || 0) + (e.value && e.value.tf ? e.value.tf : 1))
    }
    lists.push(m)
  }
  lists.sort((a, b) => a.size - b.size)
  let hits = lists[0]
  for (let i = 1; i < lists.length; i++) {
    const next = new Map()
    for (const [d, tf] of hits) if (lists[i].has(d)) next.set(d, tf + lists[i].get(d))
    hits = next
  }
  const out = []
  for (const [docId, tf] of hits) {
    const rec = await bee.get(docKey(docId)).catch(() => null)
    out.push({ docId, tf, rec: rec && rec.value ? rec.value : null })
  }
  return out
}

async function searchCandidates (bee, query, { perTerm = 500, tier = 'self', trustHop = 0 } = {}) {
  const hits = await scanHits(bee, query, { perTerm })
  return hits.map(({ docId, tf, rec }) => {
    const d = rec || { docId, driveKey: '', path: '/', title: docId }
    return {
      docId, driveKey: d.driveKey, path: d.path, title: d.title, tf,
      publishedAt: d.publishedAt || 0, tier, trustHop, endorsers: 0,
      contentHash: d.h || '', signerPubkey: d.signerPubkey || '',
    }
  })
}

// Query hits as SIGNED rows for federated verification: [{ tf, rec }] where rec
// is the peer's full d! record (with sig + signerPubkey). Rows without a record
// are dropped (nothing to verify). The RowVerifier checks each rec against the
// peer's resolved search key before it can rank.
async function searchSignedHits (bee, query, { perTerm = 500 } = {}) {
  const hits = await scanHits(bee, query, { perTerm })
  const out = []
  for (const { tf, rec } of hits) if (rec) out.push({ tf, rec })
  return out
}

// End-to-end local query over a ready Hyperbee: candidates → deterministic rank.
async function searchIndex (bee, query, { limit = 200, perTerm = 500, now0 = 0, tier = 'self', trustHop = 0 } = {}) {
  const candidates = await searchCandidates(bee, query, { perTerm, tier, trustHop })
  if (candidates.length === 0) return []
  const n = Math.max(0, Math.floor(Number(limit) || 0))
  return rankCandidates(candidates, { now0 }).slice(0, n)
}

module.exports = {
  SCHEMA_VERSION, MAX_TERMS_PER_DOC, STOPWORDS, RANK,
  tokenize, docIdFor, invScore, postingKey, docKey, postingSetHash,
  buildDocRecords, canonDocBytes, rankCandidates,
  scanHits, searchCandidates, searchSignedHits, searchIndex, fnvUnit, hashHex,
}
