'use strict'

// Mobile port (Mission B4b): CJS conversion of pearbrowser-desktop
// backend/ai/qvac-service.mjs — `export class` → module.exports; scheduling,
// streaming normalization, cancellation, idle-unload and validation logic are
// byte-identical to the desktop. The service is adapter-injected, so it runs
// against any QVAC-shaped adapter; the native adapter itself stays gated on
// mobile (see qvac-host.cjs).

const DEFAULT_MAX_INPUT_BYTES = 32 * 1024
const DEFAULT_MAX_OUTPUT_TOKENS = 512
const DEFAULT_MAX_QUEUE = 8
const DEFAULT_IDLE_UNLOAD_MS = 0 // disabled unless the host opts in

class AiServiceError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'AiServiceError'
    this.code = code
  }
}

class AiCancelledError extends AiServiceError {
  constructor (requestId) {
    super('cancelled', `AI request ${requestId} was cancelled`)
    this.name = 'AiCancelledError'
    this.requestId = requestId
  }
}

/**
 * Browser-owned coordinator around a small QVAC adapter.
 *
 * This class deliberately knows nothing about HTTP, page tokens, or manifests.
 * Those remain in the browser policy/route layer. Its jobs are model-alias
 * enforcement, load deduplication, global single-concurrency scheduling,
 * streaming normalization, cancellation, and deterministic shutdown.
 */
class QvacService {
  constructor (opts = {}) {
    if (!opts.adapter) throw new TypeError('QvacService requires an adapter')

    this._adapter = opts.adapter
    this._catalog = new Map(Object.entries(opts.models || {}))
    this._maxInputBytes = opts.maxInputBytes || DEFAULT_MAX_INPUT_BYTES
    this._maxOutputTokens = opts.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS
    this._maxQueue = opts.maxQueue || DEFAULT_MAX_QUEUE
    this._id = opts.createRequestId || defaultRequestId
    this._idleUnloadMs = Number.isFinite(opts.idleUnloadMs) && opts.idleUnloadMs > 0
      ? Math.trunc(opts.idleUnloadMs)
      : DEFAULT_IDLE_UNLOAD_MS

    this._loaded = new Map()
    this._loading = new Map()
    this._queue = []
    this._jobs = new Map()
    this._active = null
    this._closed = false
    this._drainPromise = null
    this._idleTimer = null
  }

  capabilities () {
    return {
      available: !this._closed,
      local: true,
      streaming: true,
      busy: !!this._active,
      queueDepth: this._queue.length,
      models: [...this._catalog.entries()].map(([alias, entry]) => ({
        alias,
        installed: this._loaded.has(alias),
        expectedSize: entry.expectedSize,
        ...(entry.label && { label: entry.label }),
        ...(entry.provider && { provider: entry.provider }),
        ...(entry.family && { family: entry.family }),
        ...(entry.params && { params: entry.params }),
        ...(entry.quantization && { quantization: entry.quantization }),
        ...(Number.isFinite(entry.modelConfig?.ctx_size) && { contextSize: entry.modelConfig.ctx_size }),
        ...(entry.recommended === true && { recommended: true })
      }))
    }
  }

  async ensureModel (alias, onProgress) {
    this._assertOpen()
    this._clearIdleTimer()
    const entry = this._catalog.get(alias)
    if (!entry) throw new AiServiceError('unknown-model', `Unknown browser model alias: ${alias}`)
    if (this._loaded.has(alias)) return this._loaded.get(alias)
    if (this._loading.has(alias)) return this._loading.get(alias)

    const loading = Promise.resolve(this._adapter.loadModel({
      modelSrc: entry.modelSrc,
      modelType: entry.modelType,
      modelConfig: entry.modelConfig,
      onProgress
    })).then((modelId) => {
      if (typeof modelId !== 'string' || !modelId) {
        throw new AiServiceError('model-load-failed', `QVAC returned an invalid model id for ${alias}`)
      }
      this._loaded.set(alias, modelId)
      return modelId
    }).finally(() => {
      this._loading.delete(alias)
      this._armIdleTimer()
    })

    this._loading.set(alias, loading)
    return loading
  }

  complete (input = {}) {
    this._assertOpen()
    const normalized = this._validateCompletion(input)
    if (this._queue.length >= this._maxQueue) {
      throw new AiServiceError('queue-full', 'The local AI queue is full')
    }

    const requestId = this._id()
    const events = new AsyncEventQueue()
    const final = deferred()
    // Avoid unhandled-rejection noise when a caller only consumes events.
    final.promise.catch(() => {})

    const job = {
      requestId,
      input: normalized,
      events,
      final,
      cancelled: false,
      cancelDelivered: false,
      upstreamRequestId: null
    }

    this._jobs.set(requestId, job)
    this._queue.push(job)
    this._clearIdleTimer()
    this._schedule()

    return { requestId, events, final: final.promise }
  }

  async cancel (requestId) {
    const job = this._jobs.get(requestId)
    if (!job) return false
    if (job.cancelled) return true

    job.cancelled = true
    const queuedIndex = this._queue.indexOf(job)
    if (queuedIndex !== -1) {
      this._queue.splice(queuedIndex, 1)
      this._finishCancelled(job)
      return true
    }

    if (job === this._active && job.upstreamRequestId && this._adapter.cancel && !job.cancelDelivered) {
      job.cancelDelivered = true
      try {
        await this._adapter.cancel({ requestId: job.upstreamRequestId })
      } catch (err) {
        if (!isCancellation(err)) throw err
      }
    }
    return true
  }

  async unloadModel (alias, opts = {}) {
    const modelId = this._loaded.get(alias)
    if (!modelId) return false
    if (this._active?.input.model === alias) {
      throw new AiServiceError('model-busy', `Model ${alias} is currently in use`)
    }
    await this._adapter.unloadModel({
      modelId,
      clearStorage: !!opts.clearStorage,
      autoClose: false
    })
    this._loaded.delete(alias)
    return true
  }

  async close () {
    if (this._closed) return
    this._closed = true
    this._clearIdleTimer()

    const queued = this._queue.splice(0)
    for (const job of queued) {
      job.cancelled = true
      this._finishCancelled(job)
    }

    if (this._active) await this.cancel(this._active.requestId)
    if (this._drainPromise) {
      try { await this._drainPromise } catch {}
    }

    const loaded = [...this._loaded.entries()]
    this._loaded.clear()
    for (const [, modelId] of loaded) {
      try {
        await this._adapter.unloadModel({ modelId, autoClose: false })
      } catch {}
    }
    if (this._adapter.close) await this._adapter.close()
  }

  _validateCompletion (input) {
    const origin = typeof input.origin === 'string' ? input.origin.trim() : ''
    if (!origin) throw new AiServiceError('invalid-origin', 'A canonical page origin is required')

    const model = typeof input.model === 'string' ? input.model.trim() : ''
    if (!this._catalog.has(model)) {
      throw new AiServiceError('unknown-model', `Unknown browser model alias: ${model || '(empty)'}`)
    }

    if (!Array.isArray(input.messages) || input.messages.length === 0) {
      throw new AiServiceError('invalid-messages', 'At least one message is required')
    }

    let bytes = 0
    const messages = input.messages.map((message) => {
      const role = message && typeof message.role === 'string' ? message.role : ''
      const content = message && typeof message.content === 'string' ? message.content : ''
      if (!['system', 'user', 'assistant'].includes(role) || !content) {
        throw new AiServiceError('invalid-messages', 'Messages require a valid role and non-empty content')
      }
      bytes += byteLength(content)
      return { role, content }
    })
    if (bytes > this._maxInputBytes) {
      throw new AiServiceError('input-too-large', `AI input exceeds ${this._maxInputBytes} bytes`)
    }

    const requestedMax = Number.isFinite(input.maxTokens)
      ? Math.trunc(input.maxTokens)
      : this._maxOutputTokens
    const maxTokens = Math.max(1, Math.min(requestedMax, this._maxOutputTokens))
    const requestedTemp = Number.isFinite(input.temperature) ? input.temperature : 0.7
    const temperature = Math.max(0, Math.min(requestedTemp, 2))
    const reasoningBudget = Number.isFinite(input.reasoningBudget)
      ? Math.max(-1, Math.min(maxTokens, Math.trunc(input.reasoningBudget)))
      : null

    return { origin, model, messages, maxTokens, temperature, reasoningBudget }
  }

  _assertOpen () {
    if (this._closed) throw new AiServiceError('service-closed', 'The local AI service is closed')
  }

  _schedule () {
    if (this._drainPromise || this._closed) return
    this._drainPromise = this._drain().finally(() => {
      this._drainPromise = null
      if (this._queue.length && !this._closed) this._schedule()
      else this._armIdleTimer()
    })
  }

  _clearIdleTimer () {
    if (!this._idleTimer) return
    clearTimeout(this._idleTimer)
    this._idleTimer = null
  }

  /**
   * After the queue drains (or a standalone model load finishes), release the
   * native model memory once the service has been idle for the configured
   * window. Loads stay browser-owned: the next request reloads through the
   * usual ensureModel path with progress events.
   */
  _armIdleTimer () {
    if (!this._idleUnloadMs || this._closed) return
    if (this._active || this._queue.length || this._loading.size || !this._loaded.size) return
    this._clearIdleTimer()
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null
      this._unloadIdleModels().catch(() => {})
    }, this._idleUnloadMs)
    if (typeof this._idleTimer?.unref === 'function') this._idleTimer.unref()
  }

  async _unloadIdleModels () {
    if (this._closed || this._active || this._queue.length || this._loading.size) return
    for (const [alias, modelId] of [...this._loaded.entries()]) {
      if (this._closed || this._active || this._queue.length) return
      this._loaded.delete(alias)
      try {
        await this._adapter.unloadModel({ modelId, autoClose: false })
      } catch {}
    }
  }

  async _drain () {
    while (!this._closed && this._queue.length) {
      const job = this._queue.shift()
      if (job.cancelled) continue
      this._active = job
      try {
        await this._run(job)
      } catch (err) {
        if (job.cancelled || isCancellation(err)) this._finishCancelled(job)
        else this._finishFailed(job, err)
      } finally {
        if (this._active === job) this._active = null
      }
    }
  }

  async _run (job) {
    if (job.cancelled) return this._finishCancelled(job)
    const modelId = await this.ensureModel(job.input.model, (progress) => {
      job.events.push({ type: 'model-progress', progress })
    })
    if (job.cancelled) return this._finishCancelled(job)

    const run = await this._adapter.completion({
      modelId,
      history: job.input.messages,
      stream: true,
      generationParams: {
        predict: job.input.maxTokens,
        temp: job.input.temperature,
        ...(job.input.reasoningBudget !== null && {
          reasoning_budget: job.input.reasoningBudget,
          remove_thinking_from_context: true
        })
      }
    })
    job.upstreamRequestId = run.requestId || null

    let text = ''
    let stats
    let finishReason = 'eos'
    for await (const event of run.events) {
      if (job.cancelled && job.upstreamRequestId && this._adapter.cancel && !job.cancelDelivered) {
        job.cancelDelivered = true
        await this._adapter.cancel({ requestId: job.upstreamRequestId })
      }
      if (event.type === 'contentDelta') {
        text += event.text
        job.events.push({ type: 'text', delta: event.text })
      } else if (event.type === 'completionStats') {
        stats = event.stats
        job.events.push({ type: 'stats', stats })
      } else if (event.type === 'completionDone') {
        finishReason = event.stopReason || finishReason
      }
    }

    if (job.cancelled || finishReason === 'cancelled') return this._finishCancelled(job)
    const result = { requestId: job.requestId, text, stats, finishReason }
    job.events.push({ type: 'done', finishReason })
    job.events.end()
    job.final.resolve(result)
    this._jobs.delete(job.requestId)
  }

  _finishCancelled (job) {
    if (!this._jobs.has(job.requestId)) return
    const error = new AiCancelledError(job.requestId)
    job.events.push({ type: 'done', finishReason: 'cancelled' })
    job.events.end()
    job.final.reject(error)
    this._jobs.delete(job.requestId)
  }

  _finishFailed (job, cause) {
    if (!this._jobs.has(job.requestId)) return
    const error = cause instanceof AiServiceError
      ? cause
      : new AiServiceError('inference-failed', cause?.message || String(cause))
    job.events.push({ type: 'error', code: error.code, message: error.message })
    job.events.end()
    job.final.reject(error)
    this._jobs.delete(job.requestId)
  }
}

class AsyncEventQueue {
  constructor () {
    this._values = []
    this._waiters = []
    this._ended = false
  }

  push (value) {
    if (this._ended) return
    const waiter = this._waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this._values.push(value)
  }

  end () {
    if (this._ended) return
    this._ended = true
    for (const waiter of this._waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  [Symbol.asyncIterator] () { return this }

  next () {
    if (this._values.length) return Promise.resolve({ value: this._values.shift(), done: false })
    if (this._ended) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve) => this._waiters.push(resolve))
  }
}

function deferred () {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let requestCounter = 0
function defaultRequestId () {
  requestCounter = (requestCounter + 1) % Number.MAX_SAFE_INTEGER
  return `ai-${Date.now().toString(36)}-${requestCounter.toString(36)}`
}

function byteLength (value) {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(value)
  return new TextEncoder().encode(value).byteLength
}

function isCancellation (err) {
  return err?.code === 'cancelled' ||
    err?.name === 'InferenceCancelledError' ||
    /\bcancell?ed\b/i.test(err?.message || '')
}

module.exports = { AiServiceError, AiCancelledError, QvacService }
