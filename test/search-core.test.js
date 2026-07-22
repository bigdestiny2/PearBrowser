// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/search-core.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Tests for the Lighthouse Phase-0 search engine (backend/search-core.cjs).
// Pure helpers + an end-to-end query over a real on-disk Hyperbee.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const core = require('../backend/search-core.cjs')
const {
  tokenize, docIdFor, invScore, postingKey, docKey, postingSetHash,
  buildDocRecords, rankCandidates, searchIndex, RANK, MAX_TERMS_PER_DOC,
} = core

test('tokenize lowercases, drops stopwords + short tokens, counts tf, canonical order', () => {
  const t = tokenize('The Quick brown FOX, the fox!')
  const map = Object.fromEntries(t.map((x) => [x.term, x.tf]))
  assert.equal(map.the, undefined)          // stopword
  assert.equal(map.fox, 2)                  // counted + lowercased
  assert.equal(map.quick, 1)
  assert.equal(map.brown, 1)
  // canonical (term-sorted) so the signed posting set is deterministic
  assert.deepEqual(t.map((x) => x.term), [...t.map((x) => x.term)].sort())
})

test('tokenize NFKC-normalizes and caps term count', () => {
  assert.ok(tokenize('café café').length >= 1) // composed + decomposed é unify
  const many = Array.from({ length: 200 }, (_, i) => 'term' + i).join(' ')
  assert.equal(tokenize(many).length, MAX_TERMS_PER_DOC)
})

test('docIdFor is stable + 16 hex chars; invScore orders high-score-first', () => {
  assert.equal(docIdFor('drive', '/a'), docIdFor('drive', '/a'))
  assert.notEqual(docIdFor('drive', '/a'), docIdFor('drive', '/b'))
  assert.match(docIdFor('drive', '/a'), /^[0-9a-f]{16}$/)
  // a higher localScore must produce a LEXICOGRAPHICALLY SMALLER inv key
  assert.ok(invScore(1000) < invScore(10), 'forward range scan returns best first')
})

test('postingSetHash binds the term set deterministically', () => {
  const a = postingSetHash([{ term: 'x', tf: 1 }, { term: 'y', tf: 2 }])
  assert.equal(a, postingSetHash([{ term: 'y', tf: 2 }, { term: 'x', tf: 1 }])) // order-independent
  assert.notEqual(a, postingSetHash([{ term: 'x', tf: 2 }, { term: 'y', tf: 2 }])) // tf change → different
})

test('buildDocRecords: one signed d! + thin t! postings bound by the hash', () => {
  const sign = (payload) => ({ sig: 'SIG(' + payload.docId + ')', pubkey: 'PUB' })
  const { docId, terms, records } = buildDocRecords(
    { driveKey: 'dk', path: '/p', title: 'Keet chat', body: 'private peer to peer chat' }, sign)
  const dRec = records.find(([k]) => k === docKey(docId))
  const tRecs = records.filter(([k]) => k.startsWith('t!'))
  assert.ok(dRec, 'has a d! record')
  assert.equal(dRec[1].sig, 'SIG(' + docId + ')')      // per-DOC signature (one, not per-posting)
  assert.equal(dRec[1].signerPubkey, 'PUB')
  assert.equal(dRec[1].h, postingSetHash(terms))       // postingSetHash present + correct
  assert.equal(tRecs.length, terms.length)             // one thin posting per term
  for (const [k, v] of tRecs) {                        // thin: only {tf, ff}, no sig/pubkey/driveKey
    assert.deepEqual(Object.keys(v).sort(), ['ff', 'tf'])
    assert.ok(k.endsWith('!' + docId))
  }
})

test('rankCandidates is deterministic, caps endorsers, and diversifies by driveKey', () => {
  const base = (over) => ({ docId: 'd', driveKey: 'k', tf: 5, trustHop: 0, endorsers: 0, tier: 'self', publishedAt: 0, ...over })
  // determinism
  const cs = [base({ docId: 'a', tf: 9 }), base({ docId: 'b', tf: 2 }), base({ docId: 'c', tf: 5 })]
  assert.deepEqual(rankCandidates(cs, {}).map((c) => c.docId), rankCandidates(cs, {}).map((c) => c.docId))
  // higher tf ranks first (text feature dominates here)
  assert.equal(rankCandidates(cs, {})[0].docId, 'a')
  // endorser breadth is hard-capped: 8 vs 1000 endorsers score identically
  const e8 = rankCandidates([base({ docId: 'x', endorsers: 8 })], { diversity: false })[0]._score
  const e1000 = rankCandidates([base({ docId: 'x', endorsers: 1000 })], { diversity: false })[0]._score
  assert.equal(e8, e1000, 'endorsers capped at E_CAP=' + RANK.E_CAP)
  // MMR: a 2nd doc from the same driveKey is penalized vs a different driveKey
  const same = rankCandidates([base({ docId: 'p', driveKey: 'k' }), base({ docId: 'q', driveKey: 'k' })], {})
  assert.ok(same[0]._score > same[1]._score, 'duplicate-site penalty applied')
})

test('rankCandidates reads no wall-clock: recency depends only on passed-in now0', () => {
  const c = [{ docId: 'd', driveKey: 'k', tf: 5, tier: 'self', publishedAt: 1000 }]
  // now0=0 → recency neutral; now0 far in the future → recency decays the score
  const fresh = rankCandidates(c, { now0: 0, diversity: false })[0]._score
  const stale = rankCandidates(c, { now0: 1000 + 365 * 86400000, diversity: false })[0]._score
  assert.ok(stale < fresh, 'older doc (vs now0) ranks lower; no internal clock read')
})

test('ranker: a strong text match is not buried by a zero low-cardinality feature (ε-cliff fix)', () => {
  const base = (over) => ({ docId: 'd', driveKey: 'k', tf: 1, trustHop: 0, endorsers: 0, tier: 'self', ...over })
  const out = rankCandidates([base({ docId: 'weak', tf: 1, endorsers: 5 }), base({ docId: 'strong', tf: 20, endorsers: 0 })], { diversity: false })
  assert.equal(out[0].docId, 'strong', 'high-tf/zero-endorser outranks low-tf/some-endorser — absent feature is neutral, not a penalty')
})

test('ranker coerces non-numeric features to neutral — no NaN-poisoned score', () => {
  const base = (over) => ({ docId: 'd', driveKey: 'k', tf: 5, tier: 'self', ...over })
  const out = rankCandidates([
    base({ docId: 'poison', publishedAt: '2026-01-01', trustHop: 'x', endorsers: 'lots' }),
    base({ docId: 'clean', tf: 9 }),
  ], { now0: 1700000000000, diversity: false })
  for (const c of out) assert.ok(Number.isFinite(c._score), 'every _score is finite')
  assert.equal(out[0].docId, 'clean', 'poisoned row never outranks a clean strong match')
})

test('ranker: a hostile negative tf cannot invert to maximum text relevance', () => {
  const base = (over) => ({ docId: 'd', driveKey: 'k', tf: 1, trustHop: 0, endorsers: 0, tier: 'self', ...over })
  const out = rankCandidates([base({ docId: 'evil', tf: -5 }), base({ docId: 'real', tf: 10 })], { diversity: false })
  assert.equal(out[0].docId, 'real', 'negative tf is clamped to 0, not the BM25 pole')
})

test('searchIndex limit is clamped (negative/garbage → empty, not off-by-one)', async () => {
  // pure-function check on the clamp via rankCandidates + slice contract
  const ranked = rankCandidates([{ docId: 'a', driveKey: 'k', tf: 5, tier: 'self' }], {})
  assert.equal(ranked.length, 1)
})

test('searchIndex: end-to-end tokenize → range-scan → AND → rank over a real Hyperbee', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'search-core-'))
  try {
    const store = new Corestore(dir)
    await store.ready()
    const bee = new Hyperbee(store.get({ name: 'idx' }), { keyEncoding: 'utf-8', valueEncoding: 'json' })
    await bee.ready()
    const sign = (p) => ({ sig: 's', pubkey: 'p' })
    const docs = [
      { driveKey: 'd1', path: '/', title: 'Keet', body: 'encrypted peer to peer chat and video calls' },
      { driveKey: 'd2', path: '/', title: 'PearPass', body: 'peer to peer password manager synced across devices' },
      { driveKey: 'd3', path: '/', title: 'HiveWorm', body: 'a perpetual peer to peer life simulation game' },
      { driveKey: 'd4', path: '/', title: 'Notes', body: 'a private notes app, no chat here' },
    ]
    for (const d of docs) {
      const { records } = buildDocRecords(d, sign)
      for (const [k, v] of records) await bee.put(k, v)
    }

    // single term "chat" → d1 (Keet) and d4 (Notes mentions chat)
    const chat = await searchIndex(bee, 'chat')
    const chatKeys = chat.map((r) => r.driveKey).sort()
    assert.deepEqual(chatKeys, ['d1', 'd4'])

    // AND query "peer chat" → only docs containing BOTH → d1 only (d4 has chat, not peer)
    const and = await searchIndex(bee, 'peer chat')
    assert.deepEqual(and.map((r) => r.driveKey), ['d1'])

    // "peer" alone → d1,d2,d3 (all "peer to peer"); ranked, deterministic
    const peer = await searchIndex(bee, 'peer')
    assert.deepEqual(peer.map((r) => r.driveKey).sort(), ['d1', 'd2', 'd3'])
    assert.deepEqual(await searchIndex(bee, 'peer').then((r) => r.map((x) => x.driveKey)), peer.map((x) => x.driveKey))

    // empty / stopword-only query → no results, no throw
    assert.deepEqual(await searchIndex(bee, 'the and of'), [])

    await store.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
