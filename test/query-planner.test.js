// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/query-planner.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Tests for backend/query-planner.js — the federated-search orchestrator.
// Step 3 covers the SearchFanoutBudget and the LOCAL-ONLY planAndSearch path
// (peer I/O is a clean no-op until Step 5). Real Corestore-backed PersonalIndex;
// identity + contacts stubbed.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const piMod = require('../backend/personal-index.cjs')
const qpMod = require('../backend/query-planner.js')
const { PersonalIndex } = piMod
const { QueryPlanner, SearchFanoutBudget } = qpMod

const hex = (b) => b4a.toString(b, 'hex')
const fakeCore = () => ({ closed: false, close () { this.closed = true } })

function fakeIdentity () {
  const root = crypto.keyPair()
  return { rootHex: hex(root.publicKey), getSigningKeypair: () => root }
}
function fakeContacts () {
  let list = []
  return { list: async () => list, _set: (l) => { list = l } }
}

async function withPlanner (fn) {
  const dir = await mkdtemp(join(tmpdir(), 'query-planner-'))
  const store = new Corestore(dir)
  await store.ready()
  const personalIndex = await new PersonalIndex(store).ready()
  const identity = fakeIdentity()
  const contacts = fakeContacts()
  const planner = new QueryPlanner({ personalIndex, contacts, identity, budget: new SearchFanoutBudget() })
  try { return await fn({ planner, personalIndex, identity, setContacts: contacts._set }) }
  finally { await personalIndex.close(); await store.close(); await rm(dir, { recursive: true, force: true }) }
}

// --- SearchFanoutBudget ------------------------------------------------------

test('budget: per-query connect counter resets on beginQuery and caps at maxConnectsPerQuery', () => {
  const b = new SearchFanoutBudget({ maxConnectsPerQuery: 2, maxLiveSessions: 10, maxNewJoinsPerMinute: 100 })
  b.beginQuery()
  assert.equal(b.canConnect(), true)
  b.noteConnect(); assert.equal(b.canConnect(), true)
  b.noteConnect(); assert.equal(b.canConnect(), false) // 2 reached this query
  b.beginQuery(); assert.equal(b.canConnect(), true)   // reset for the next query
})

test('budget: toBudgetArg reflects remaining cold-connect slots', () => {
  const b = new SearchFanoutBudget({ maxConnectsPerQuery: 4 })
  b.beginQuery()
  assert.equal(b.toBudgetArg().maxConnectsPerQuery, 4)
  b.noteConnect()
  assert.equal(b.toBudgetArg().maxConnectsPerQuery, 3)
})

test('budget: LRU touch evicts + closes the least-recently-used session at the ceiling', () => {
  const b = new SearchFanoutBudget({ maxLiveSessions: 2 })
  const c1 = fakeCore(); const c2 = fakeCore(); const c3 = fakeCore()
  b.touch('r1', c1); b.touch('r2', c2)
  assert.equal(b.sessions.size, 2)
  b.touch('r3', c3) // over ceiling → evict r1 (oldest)
  assert.equal(b.sessions.size, 2)
  assert.equal(c1.closed, true)
  assert.deepEqual([...b.warmRoots()].sort(), ['r2', 'r3'])
})

test('budget: re-touching an existing session refreshes it (not evicted as oldest)', () => {
  const b = new SearchFanoutBudget({ maxLiveSessions: 2 })
  const c1 = fakeCore(); const c2 = fakeCore(); const c3 = fakeCore()
  b.touch('r1', c1); b.touch('r2', c2)
  b.touch('r1', c1)  // r1 now most-recent; r2 is oldest
  b.touch('r3', c3)  // evicts r2, keeps r1
  assert.equal(c2.closed, true)
  assert.equal(c1.closed, false)
  assert.deepEqual([...b.warmRoots()].sort(), ['r1', 'r3'])
})

test('budget: per-minute join-rate window gates new connects', () => {
  let t = 1_000_000
  const b = new SearchFanoutBudget({ maxNewJoinsPerMinute: 2, now: () => t })
  b.beginQuery()
  b.noteConnect(); b.noteConnect()
  assert.equal(b._joinsInWindow(), 2)
  assert.equal(b.canConnect(), false) // join window full
  t += 61_000                         // roll past the 60s window
  assert.equal(b._joinsInWindow(), 0)
})

// --- QueryPlanner ------------------------------------------------------------

test('planAndSearch local-only path matches personalIndex.search exactly', async () => {
  await withPlanner(async ({ planner, personalIndex }) => {
    await personalIndex.indexDoc({ driveKey: 'd1', path: '/', title: 'Keet', body: 'encrypted peer to peer chat' })
    await personalIndex.indexDoc({ driveKey: 'd2', path: '/', title: 'PearPass', body: 'peer to peer password manager' })
    await personalIndex.indexDoc({ driveKey: 'd3', path: '/', title: 'Recipes', body: 'bake bread at home peer' })
    const now0 = 1700000000000
    const direct = await personalIndex.search('peer', { now0, limit: 50 })
    const fed = await planner.planAndSearch('peer', { now0, limit: 50 })
    assert.ok(fed.results.length > 0)
    assert.deepEqual(fed.results.map((r) => r.docId), direct.map((r) => r.docId))
    assert.deepEqual(fed.results.map((r) => r.driveKey), direct.map((r) => r.driveKey))
    // self results are tagged hop-0 / self by the merge
    assert.ok(fed.results.every((r) => r.trustHop === 0 && r.tier === 'self'))
    assert.equal(fed.verifyBudgetExhausted, false)
    assert.equal(fed.digestHit, false)
    assert.equal(fed.fallbackPull, false)
    assert.equal(fed.partial, false)
    assert.deepEqual(fed.provenance, {
      digestHit: false,
      fallbackPull: false,
      partial: false,
      plannedPeers: 0,
      pulledPeers: 0,
      digestSkipped: 0
    })
  })
})

test('planAndSearch returns [] for a no-match query (federation no-op)', async () => {
  await withPlanner(async ({ planner, personalIndex }) => {
    await personalIndex.indexDoc({ driveKey: 'd1', path: '/', title: 'Keet', body: 'encrypted chat' })
    const fed = await planner.planAndSearch('nonexistentterm', { now0: 1, limit: 50 })
    assert.deepEqual(fed.results, [])
  })
})

test('_trustSnapshot puts direct contacts at hop 1 (followed), others at default', async () => {
  await withPlanner(async ({ planner, setContacts }) => {
    const friend = 'aa'.repeat(32)
    setContacts([{ pubkey: friend }])
    const snap = await planner._trustSnapshot()
    assert.equal(snap.graph.hopOf(snap.selfRoot), 0)
    assert.equal(snap.graph.tierOf(snap.selfRoot), 'self')
    assert.equal(snap.graph.hopOf(friend), 1)
    assert.equal(snap.graph.tierOf(friend), 'followed')
    assert.equal(snap.graph.tierOf('bb'.repeat(32)), 'default')
    assert.deepEqual(snap.contactRoots, [friend])
  })
})

test('planAndSearch pulls digest-hit peers and skips known digest misses', async () => {
  await withPlanner(async ({ planner, setContacts }) => {
    const hit = '11'.repeat(32)
    const miss = '22'.repeat(32)
    const unknown = '33'.repeat(32)
    setContacts([{ pubkey: hit }, { pubkey: miss }, { pubkey: unknown }])
    planner._digestCache.set(hit, { v: 1, topTerms: ['peer'] })
    planner._digestCache.set(miss, { v: 1, topTerms: ['recipes'] })

    let fetched = []
    planner._fetchPeerHits = async (roots) => { fetched = roots; return [] }

    const fed = await planner.planAndSearch('peer', { now0: 1, limit: 50 })
    assert.deepEqual(fetched, [hit])
    assert.equal(fed.digestHit, true)
    assert.equal(fed.fallbackPull, false)
    assert.equal(fed.partial, true)
    assert.equal(fed.provenance.plannedPeers, 3)
    assert.equal(fed.provenance.pulledPeers, 1)
    assert.equal(fed.provenance.digestSkipped, 1)
  })
})

test('planAndSearch marks no-digest peer fanout as fallback and partial', async () => {
  await withPlanner(async ({ planner, setContacts }) => {
    const friend = '44'.repeat(32)
    setContacts([{ pubkey: friend }])

    let fetched = []
    planner._fetchPeerHits = async (roots) => { fetched = roots; return [] }

    const fed = await planner.planAndSearch('peer', { now0: 1, limit: 50 })
    assert.deepEqual(fetched, [friend])
    assert.equal(fed.digestHit, false)
    assert.equal(fed.fallbackPull, true)
    assert.equal(fed.partial, true)
    assert.deepEqual(fed.provenance, {
      digestHit: false,
      fallbackPull: true,
      partial: true,
      plannedPeers: 1,
      pulledPeers: 1,
      digestSkipped: 0
    })
  })
})
