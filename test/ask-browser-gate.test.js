'use strict'

/**
 * Mission B4b — the Ask Browser / QVAC gate on mobile.
 *
 * The QVAC native runtime (@qvac/bare-sdk + @qvac/llm-llamacpp) is not linked
 * into the Android worklet, so backend/index.js wires Ask Browser exactly
 * like the desktop but with a getAiService that throws a typed
 * 'runtime-unavailable' error. These tests pin that wiring contract:
 *
 *   1. createLazyQvacService without a runtime loader returns null (the gate).
 *   2. capabilities() then reports the desktop's unavailable shape with reason
 *      'runtime-unavailable' — never a hardcoded available:true.
 *   3. start() fails closed with the typed error; cancel() returns false.
 *   4. With a loader injected, the SAME wiring runs a full streaming
 *      round-trip — the port works like the desktop when a runtime exists.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { AskBrowserService, AskBrowserServiceError } = require('../backend/ai/ask-browser-service.cjs')
const { createLazyQvacService } = require('../backend/ai/qvac-host.cjs')
const { QVAC_MODEL_CATALOG } = require('../backend/ai/qvac-model-catalog.cjs')

// Mirrors the exact wiring in backend/index.js (Mission B4b gate).
function wireLikeIndexJs ({ aiService, emitted = [] } = {}) {
  return new AskBrowserService({
    getAiService: () => {
      if (!aiService) {
        throw new AskBrowserServiceError(
          'runtime-unavailable',
          'Ask Browser is unavailable: the QVAC native runtime (@qvac/llm-llamacpp) is not linked into this Android worklet build'
        )
      }
      return aiService
    },
    loadContext: async (page) => ({
      context: page,
      source: { kind: page?.text || page?.selection ? 'active-page' : 'metadata' }
    }),
    emit: (payload) => emitted.push(payload)
  })
}

test('the mobile gate: no runtime loader means no service (null, not a mock)', () => {
  const service = createLazyQvacService({
    homeDir: '/tmp/pearbrowser-test',
    models: QVAC_MODEL_CATALOG,
    idleUnloadMs: 15 * 60 * 1000
  })
  assert.equal(service, null)
})

test('the pinned model catalog matches the desktop descriptor', () => {
  const entry = QVAC_MODEL_CATALOG['pear-small-chat']
  assert.equal(entry.modelType, 'llamacpp-completion')
  assert.equal(entry.expectedSize, 386404992)
  assert.equal(entry.sha256Checksum, '48ab3034d0dd401fbc721eb1df3217902fee7dab9078992d66431f09b7750201')
  assert.equal(entry.provider, 'qvac')
  assert.deepEqual(entry.modelConfig, { device: 'cpu', gpu_layers: 0, ctx_size: 8192 })
})

test('gated capabilities report the desktop unavailable contract honestly', () => {
  const service = wireLikeIndexJs({ aiService: null })
  assert.deepEqual(service.capabilities(), {
    available: false,
    local: true,
    streaming: true,
    busy: false,
    queueDepth: 0,
    models: [],
    activeStreams: 0,
    reason: 'runtime-unavailable'
  })
})

test('gated start fails closed with a typed runtime-unavailable error', async () => {
  const emitted = []
  const service = wireLikeIndexJs({ aiService: null, emitted })
  await assert.rejects(
    service.start({
      streamId: 'ask:gated',
      model: 'pear-small-chat',
      question: 'Summarize this page',
      page: { url: 'hyper://example/', text: 'Some page text' }
    }),
    (err) => {
      assert.equal(err instanceof AskBrowserServiceError, true)
      assert.equal(err.code, 'runtime-unavailable')
      assert.match(err.message, /not linked/)
      return true
    }
  )
  // No stream is left registered and no stream events were fabricated.
  assert.equal(emitted.length, 0)
  const caps = service.capabilities()
  assert.equal(caps.activeStreams, 0)
  assert.equal(caps.available, false)
})

test('gated cancel reports false (nothing to cancel) instead of pretending', async () => {
  const service = wireLikeIndexJs({ aiService: null })
  assert.equal(await service.cancel({ streamId: 'ask:gated' }), false)
})

test('with a runtime loader the same wiring streams end-to-end like the desktop', async () => {
  const adapterCalls = { load: 0, completion: 0 }
  const aiService = createLazyQvacService({
    models: QVAC_MODEL_CATALOG,
    loadRuntime: async () => ({
      async loadModel (params) {
        adapterCalls.load++
        assert.equal(params.modelSrc, QVAC_MODEL_CATALOG['pear-small-chat'].modelSrc)
        return 'fixture-model-id'
      },
      completion (params) {
        adapterCalls.completion++
        return {
          requestId: 'upstream-1',
          events: (async function * () {
            yield { type: 'contentDelta', seq: 0, text: 'on-device answer' }
            yield { type: 'completionDone', seq: 1, stopReason: 'eos' }
          })()
        }
      },
      async cancel () { return true },
      async unloadModel () { return true },
      async close () {}
    })
  })
  assert.notEqual(aiService, null)
  assert.equal(aiService.capabilities().available, true)
  assert.equal(aiService.capabilities().models[0].alias, 'pear-small-chat')

  const emitted = []
  const service = wireLikeIndexJs({ aiService, emitted })
  const caps = service.capabilities()
  assert.equal(caps.available, true)
  assert.equal(caps.reason, undefined)

  const started = await service.start({
    streamId: 'ask:live',
    model: 'pear-small-chat',
    question: 'What does this page say?',
    page: { url: 'hyper://example/', title: 'Example', text: 'Page body' }
  })
  assert.equal(started.streamId, 'ask:live')
  assert.equal(started.source.kind, 'active-page')

  await until(() => emitted.some(item => item.event.type === 'done'))
  assert.deepEqual(emitted.map(item => item.event.type), ['text', 'done'])
  assert.equal(emitted[0].event.delta, 'on-device answer')
  assert.equal(adapterCalls.load, 1)
  assert.equal(adapterCalls.completion, 1)

  await service.close()
  await aiService.close()
})

test('a failing runtime loader surfaces as inference failure, not availability', async () => {
  const aiService = createLazyQvacService({
    models: QVAC_MODEL_CATALOG,
    loadRuntime: async () => { throw new Error('addon load failed') }
  })
  const emitted = []
  const service = wireLikeIndexJs({ aiService, emitted })
  await service.start({ streamId: 'ask:broken', model: 'pear-small-chat', question: 'Hi' })
  await until(() => emitted.some(item => item.event.type === 'error'))
  const error = emitted.find(item => item.event.type === 'error')
  assert.equal(error.event.code, 'inference-failed')
  await service.close()
  await aiService.close()
})

async function until (predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}
