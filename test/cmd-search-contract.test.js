// Mobile port (Mission B3): adapted from pearbrowser-desktop/test/cmd-search-contract.test.js
// (ESM → CommonJS; module paths unchanged — the backend layout mirrors the desktop).
// Tests for backend/search-handler.js — the CMD_SEARCH local-first +
// background-federate contract (extracted from index.js so it's Node-testable).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const handlerMod = require('../backend/search-handler.js')
const { createSearchHandler, MAX_QUERY_CHARS, MAX_SEARCH_LIMIT } = handlerMod

const tick = () => new Promise((r) => setTimeout(r, 0))
const fakePI = (rows = []) => ({
  search: async () => rows.slice(),
  stats: async () => ({ docs: rows.length }),
})

test('returns local results synchronously with first-paint shape; no event when not federating', async () => {
  const rows = [{ docId: 'a', driveKey: 'd1' }]
  const events = []
  const h = createSearchHandler({
    getPersonalIndex: () => fakePI(rows),
    getQueryPlanner: () => ({ planAndSearch: async () => ({ results: [] }) }),
    emit: (e) => events.push(e),
  })
  const res = await h({ query: 'x' }) // no federated flag
  assert.deepEqual(res.results, rows)
  assert.equal(res.phase, 'first-paint')
  assert.equal(res.federating, false)
  assert.equal(res.stats.docs, 1)
  assert.equal(typeof res.queryId, 'number')
  await tick()
  assert.equal(events.length, 0) // background path never ran
})

test('federated:true emits exactly one enriched event with the planner results + matching queryId', async () => {
  const rows = [{ docId: 'a' }]
  const fedRows = [{ docId: 'a', tier: 'self' }, { docId: 'b', tier: 'followed' }]
  const events = []
  const h = createSearchHandler({
    getPersonalIndex: () => fakePI(rows),
    getQueryPlanner: () => ({
      planAndSearch: async () => ({
        results: fedRows,
        verifyBudgetExhausted: false,
        digestHit: true,
        fallbackPull: false,
        partial: true,
        provenance: { digestHit: true, fallbackPull: false, partial: true, plannedPeers: 2, pulledPeers: 1, digestSkipped: 1 }
      })
    }),
    emit: (e) => events.push(e),
  })
  const res = await h({ query: 'x', federated: true })
  assert.equal(res.federating, true)
  assert.deepEqual(res.results, rows) // first paint is still local-only
  await tick()
  assert.equal(events.length, 1)
  assert.equal(events[0].phase, 'enriched')
  assert.deepEqual(events[0].results, fedRows)
  assert.equal(events[0].queryId, res.queryId)
  assert.equal(events[0].verifyBudgetExhausted, false)
  assert.equal(events[0].digestHit, true)
  assert.equal(events[0].fallbackPull, false)
  assert.equal(events[0].partial, true)
  assert.deepEqual(events[0].provenance, { digestHit: true, fallbackPull: false, partial: true, plannedPeers: 2, pulledPeers: 1, digestSkipped: 1 })
})

test('federating is false when no planner exists, even with federated:true', async () => {
  const events = []
  const h = createSearchHandler({
    getPersonalIndex: () => fakePI([]),
    getQueryPlanner: () => null,
    emit: (e) => events.push(e),
  })
  const res = await h({ query: 'x', federated: true })
  assert.equal(res.federating, false)
  await tick()
  assert.equal(events.length, 0)
})

test('no personalIndex yields an empty first-paint result', async () => {
  const h = createSearchHandler({
    getPersonalIndex: () => null,
    getQueryPlanner: () => null,
    emit: () => {},
  })
  const res = await h({ query: 'x', federated: true })
  assert.deepEqual(res.results, [])
  assert.equal(res.federating, false)
  assert.equal(res.phase, 'first-paint')
  assert.equal(res.stats.docs, 0)
})

test('normalizes query text and clamps limit before local and federated search', async () => {
  const calls = []
  const plannerCalls = []
  const pi = {
    search: async (query, opts) => { calls.push({ query, opts }); return [] },
    stats: async () => ({ docs: 0 }),
  }
  const planner = {
    planAndSearch: async (query, opts) => { plannerCalls.push({ query, opts }); return { results: [] } },
  }
  const h = createSearchHandler({
    getPersonalIndex: () => pi,
    getQueryPlanner: () => planner,
    emit: () => {},
  })
  await h({ query: `  ${'x'.repeat(MAX_QUERY_CHARS + 40)}  `, limit: 100000, federated: true })
  await tick()

  assert.equal(calls[0].query.length, MAX_QUERY_CHARS)
  assert.equal(calls[0].opts.limit, MAX_SEARCH_LIMIT)
  assert.equal(plannerCalls[0].query.length, MAX_QUERY_CHARS)
  assert.equal(plannerCalls[0].opts.limit, MAX_SEARCH_LIMIT)
})

test('a stale federation from a superseded query is dropped; only the newest emits', async () => {
  const events = []
  const deferreds = []
  const planner = { planAndSearch: () => new Promise((resolve) => deferreds.push(resolve)) }
  const h = createSearchHandler({
    getPersonalIndex: () => fakePI([]),
    getQueryPlanner: () => planner,
    emit: (e) => events.push(e),
  })
  const r1 = await h({ query: 'a', federated: true }) // queryId 1, federation pending
  const r2 = await h({ query: 'b', federated: true }) // queryId 2, federation pending
  assert.notEqual(r1.queryId, r2.queryId)

  deferreds[0]({ results: [{ docId: 'stale' }], verifyBudgetExhausted: false }) // resolve the OLD query
  await tick()
  assert.equal(events.length, 0) // suppressed — superseded

  deferreds[1]({ results: [{ docId: 'fresh' }], verifyBudgetExhausted: false }) // resolve the CURRENT query
  await tick()
  assert.equal(events.length, 1)
  assert.equal(events[0].queryId, r2.queryId)
  assert.deepEqual(events[0].results, [{ docId: 'fresh' }])
})
