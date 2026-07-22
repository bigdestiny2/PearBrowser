'use strict'

/**
 * Mobile port (Mission B4b) of pearbrowser-desktop backend/ai/qvac-host.mjs.
 *
 * The desktop host lazily `import('./qvac-runtime.mjs')`s the QVAC adapter,
 * which loads `@qvac/bare-sdk` + the `@qvac/llm-llamacpp` native addon
 * (llama.cpp). That native runtime is NOT available in the Android worklet
 * today:
 *
 *   - `@qvac/llm-llamacpp` ships an `android-arm64` prebuild upstream and the
 *     worklet does load linked native addons (react-native-bare-kit's
 *     bare-link step → android-native/app/libs/bare-kit.aar), but the QVAC
 *     addon is not in the linked set — adding it means new npm deps, a
     re-link, an AAR rebuild and on-device verification.
 *   - A bare-pack bundle cannot reference packages that are not installed, so
 *     no module in backend/ may statically load '@qvac/...' until they are.
 *
 * Port adaptation: instead of hardcoding the runtime import, the loader is
 * INJECTED as `opts.loadRuntime` (async () => adapter). When no loader is
 * supplied this returns null — the honest "runtime not linked" state, which
 * the Ask Browser wiring reports through the desktop's own availability
 * contract (reason 'runtime-unavailable'). With a loader, behavior matches
 * the desktop host exactly: the adapter is loaded once, lazily, on first use.
 *
 * To enable QVAC on Android later:
 *   1. npm install @qvac/bare-sdk@0.14.1 @qvac/llm-llamacpp@0.36.3
 *   2. re-run the bare-kit addon link + rebuild android-native's bare-kit.aar
 *      so libqvac__llm-llamacpp.so ships in the APK
 *   3. write backend/ai/qvac-runtime.cjs mirroring the desktop's
 *      qvac-runtime.mjs (bare-process global guard, plugins([llmPlugin]))
 *   4. pass loadRuntime in backend/index.js and merge
 *      discoverOllamaQwenModels(...) into the model catalog, exactly like the
 *      desktop root index.js does
 */

const { QvacService } = require('./qvac-service.cjs')
const { QVAC_MODEL_CATALOG } = require('./qvac-model-catalog.cjs')

/**
 * Create the browser service without loading any QVAC/native-addon module.
 * Returns null when no runtime loader is injected (the gated mobile state).
 */
function createLazyQvacService (opts = {}) {
  const loadRuntime = typeof opts.loadRuntime === 'function' ? opts.loadRuntime : null
  if (!loadRuntime) return null

  let adapterPromise = null
  const getAdapter = async () => {
    if (!adapterPromise) {
      adapterPromise = Promise.resolve()
        .then(() => loadRuntime())
        .catch(err => {
          adapterPromise = null
          throw err
        })
    }
    return adapterPromise
  }

  const adapter = {
    async loadModel (params) { return (await getAdapter()).loadModel(params) },
    async completion (params) { return (await getAdapter()).completion(params) },
    async cancel (params) { return (await getAdapter()).cancel(params) },
    async unloadModel (params) { return (await getAdapter()).unloadModel(params) },
    async close () {
      if (!adapterPromise) return
      return (await adapterPromise).close()
    }
  }

  return new QvacService({
    adapter,
    models: opts.models || QVAC_MODEL_CATALOG,
    maxInputBytes: opts.maxInputBytes,
    maxOutputTokens: opts.maxOutputTokens,
    maxQueue: opts.maxQueue,
    idleUnloadMs: opts.idleUnloadMs
  })
}

module.exports = { createLazyQvacService }
