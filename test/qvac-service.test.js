'use strict'

// Mobile port (Mission B4b): adapted from pearbrowser-desktop/test/qvac-service.test.js
// (ESM → CommonJS; module path points at the ported backend/ai/qvac-service.cjs).
// Exercises the ported QvacService coordinator against a fake adapter — the
// same contract the gated native adapter will satisfy when linked.

const test = require('node:test')
const assert = require('node:assert/strict')
const { AiCancelledError, AiServiceError, QvacService } = require('../backend/ai/qvac-service.cjs')

const MODEL = {
  'pear-small-chat': {
    modelSrc: { name: 'fixture-model' },
    modelType: 'llamacpp-completion',
    modelConfig: { device: 'cpu' },
    expectedSize: 123
  }
}

function fakeAdapter (opts = {}) {
  const calls = { load: [], completion: [], cancel: [], unload: [], close: 0 }
  let active = 0
  let peakActive = 0
  let runId = 0

  return {
    calls,
    get peakActive () { return peakActive },
    async loadModel (params) {
      calls.load.push(params)
      if (opts.loadGate) await opts.loadGate
      return 'fixture-model-id'
    },
    completion (params) {
      calls.completion.push(params)
      const requestId = `upstream-${++runId}`
      return {
        requestId,
        events: (async function * () {
          active++
          peakActive = Math.max(peakActive, active)
          try {
            if (opts.runGate) await opts.runGate(requestId)
            yield { type: 'contentDelta', seq: 0, text: 'hello' }
            yield {
              type: 'completionStats',
              seq: 1,
              stats: { tokensPerSecond: 12, backendDevice: 'cpu' }
            }
            yield { type: 'completionDone', seq: 2, stopReason: 'eos' }
          } finally {
            active--
          }
        })()
      }
    },
    async cancel (params) { calls.cancel.push(params) },
    async unloadModel (params) { calls.unload.push(params) },
    async close () { calls.close++ }
  }
}

function complete (service, overrides = {}) {
  return service.complete({
    origin: 'pear://fixture-drive',
    model: 'pear-small-chat',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 9999,
    temperature: 99,
    ...overrides
  })
}

test('QVAC service exposes aliases, normalizes streams, and clamps generation options', async () => {
  const adapter = fakeAdapter()
  const service = new QvacService({
    adapter,
    models: MODEL,
    maxOutputTokens: 64,
    createRequestId: () => 'browser-request-1'
  })

  assert.deepEqual(service.capabilities().models, [{
    alias: 'pear-small-chat',
    installed: false,
    expectedSize: 123
  }])

  const run = complete(service)
  const events = []
  for await (const event of run.events) events.push(event)
  const final = await run.final

  assert.equal(final.text, 'hello')
  assert.equal(final.finishReason, 'eos')
  assert.deepEqual(events.map(event => event.type), ['text', 'stats', 'done'])
  assert.equal(adapter.calls.load.length, 1)
  assert.deepEqual(adapter.calls.completion[0].generationParams, { predict: 64, temp: 2 })
  assert.equal(service.capabilities().models[0].installed, true)

  await service.close()
  assert.deepEqual(adapter.calls.unload, [{ modelId: 'fixture-model-id', autoClose: false }])
  assert.equal(adapter.calls.close, 1)
})

test('QVAC service forwards an explicit per-request reasoning budget', async () => {
  const adapter = fakeAdapter()
  const service = new QvacService({ adapter, models: MODEL })
  const run = complete(service, { reasoningBudget: 0 })
  await run.final
  assert.deepEqual(adapter.calls.completion[0].generationParams, {
    predict: 512,
    temp: 2,
    reasoning_budget: 0,
    remove_thinking_from_context: true
  })
  await service.close()
})

test('QVAC model loads are deduplicated', async () => {
  let releaseLoad
  const loadGate = new Promise(resolve => { releaseLoad = resolve })
  const adapter = fakeAdapter({ loadGate })
  const service = new QvacService({ adapter, models: MODEL })

  const first = service.ensureModel('pear-small-chat')
  const second = service.ensureModel('pear-small-chat')
  assert.equal(adapter.calls.load.length, 1)
  releaseLoad()
  assert.equal(await first, 'fixture-model-id')
  assert.equal(await second, 'fixture-model-id')
  assert.equal(adapter.calls.load.length, 1)
  await service.close()
})

test('QVAC completions are globally serialized across origins', async () => {
  const releases = []
  const adapter = fakeAdapter({
    runGate: () => new Promise(resolve => releases.push(resolve))
  })
  let id = 0
  const service = new QvacService({ adapter, models: MODEL, createRequestId: () => `job-${++id}` })

  const first = complete(service, { origin: 'pear://one' })
  const second = complete(service, { origin: 'pear://two' })
  await until(() => releases.length === 1)
  assert.equal(adapter.calls.completion.length, 1)
  releases.shift()()
  await first.final

  await until(() => releases.length === 1)
  assert.equal(adapter.calls.completion.length, 2)
  releases.shift()()
  await second.final

  assert.equal(adapter.peakActive, 1)
  await service.close()
})

test('queued QVAC completion can be cancelled without reaching the addon', async () => {
  const releases = []
  const adapter = fakeAdapter({ runGate: () => new Promise(resolve => releases.push(resolve)) })
  let id = 0
  const service = new QvacService({ adapter, models: MODEL, createRequestId: () => `job-${++id}` })

  const first = complete(service)
  const queued = complete(service)
  await until(() => releases.length === 1)
  assert.equal(await service.cancel(queued.requestId), true)
  await assert.rejects(queued.final, AiCancelledError)
  assert.equal(adapter.calls.completion.length, 1)

  releases.shift()()
  await first.final
  await service.close()
})

test('an active QVAC cancellation is delivered to the addon exactly once', async () => {
  let releaseRun
  const adapter = fakeAdapter({
    runGate: () => new Promise(resolve => { releaseRun = resolve })
  })
  // The fixture generator yields three events after the gate opens; every
  // event after the cancel would previously re-deliver adapter.cancel().
  const service = new QvacService({ adapter, models: MODEL, createRequestId: () => 'active-cancel' })

  const run = complete(service)
  await until(() => !!releaseRun && adapter.calls.completion.length === 1)
  assert.equal(await service.cancel(run.requestId), true)
  assert.equal(adapter.calls.cancel.length, 1)

  releaseRun()
  await assert.rejects(run.final, AiCancelledError)
  assert.equal(adapter.calls.cancel.length, 1)
  assert.deepEqual(adapter.calls.cancel[0], { requestId: 'upstream-1' })
  await service.close()
})

test('idle QVAC models unload after the configured quiet window', async () => {
  const adapter = fakeAdapter()
  const service = new QvacService({ adapter, models: MODEL, idleUnloadMs: 25 })

  const run = complete(service)
  await run.final
  assert.equal(service.capabilities().models[0].installed, true)
  assert.equal(adapter.calls.unload.length, 0)

  await until(() => adapter.calls.unload.length === 1)
  assert.deepEqual(adapter.calls.unload[0], { modelId: 'fixture-model-id', autoClose: false })
  assert.equal(service.capabilities().models[0].installed, false)

  // Close after an idle unload must not double-unload the released model.
  await service.close()
  assert.equal(adapter.calls.unload.length, 1)
})

test('new work clears a pending idle unload', async () => {
  const releases = []
  const adapter = fakeAdapter({ runGate: () => new Promise(resolve => releases.push(resolve)) })
  const service = new QvacService({ adapter, models: MODEL, idleUnloadMs: 30 })

  const first = complete(service)
  await until(() => releases.length === 1)
  releases.shift()()
  await first.final

  // Enqueue again inside the idle window; the pending unload must be dropped.
  const second = complete(service)
  await until(() => releases.length === 1)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(adapter.calls.unload.length, 0)
  assert.equal(adapter.calls.load.length, 1)

  releases.shift()()
  await second.final
  await service.close()
})

test('QVAC service rejects unapproved models, paths, invalid origins, and oversized input', async () => {
  const service = new QvacService({ adapter: fakeAdapter(), models: MODEL, maxInputBytes: 4 })

  assert.throws(() => complete(service, { model: '/tmp/untrusted.gguf' }), error => {
    return error instanceof AiServiceError && error.code === 'unknown-model'
  })
  assert.throws(() => complete(service, { origin: '' }), error => error.code === 'invalid-origin')
  assert.throws(() => complete(service, {
    messages: [{ role: 'user', content: '12345' }]
  }), error => error.code === 'input-too-large')

  await service.close()
})

async function until (predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}
