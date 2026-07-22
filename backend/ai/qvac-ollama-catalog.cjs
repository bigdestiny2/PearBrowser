'use strict'

// Mobile port (Mission B4b): CJS conversion of pearbrowser-desktop
// backend/ai/qvac-ollama-catalog.mjs — local Ollama model discovery, kept for
// catalog parity. It takes fs/path adapters, so it is dependency-free; on
// Android there is normally no ~/.ollama and discovery returns {} (the same
// result the desktop produces on machines without Ollama).

const MODEL_MEDIA_TYPE = 'application/vnd.ollama.image.model'

function discoverOllamaQwenModels (opts = {}) {
  const fs = opts.fs
  const path = opts.path
  if (!fs || !path) throw new TypeError('Ollama discovery requires fs and path adapters')

  const homeDir = opts.homeDir
  const modelsRoot = opts.modelsRoot || (homeDir ? path.join(homeDir, '.ollama', 'models') : null)
  if (!modelsRoot) return {}
  const manifestsRoot = path.join(modelsRoot, 'manifests', 'registry.ollama.ai')
  const blobsRoot = path.join(modelsRoot, 'blobs')
  const device = opts.device === 'gpu' ? 'gpu' : 'cpu'
  const entries = []

  let candidates
  try {
    candidates = fs.readdirSync(manifestsRoot, { recursive: true })
  } catch {
    return {}
  }

  for (const relativePath of candidates) {
    try {
      const manifestPath = path.join(manifestsRoot, relativePath)
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const configPath = blobPath(blobsRoot, manifest?.config?.digest, path)
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      const family = String(config.model_family || '').toLowerCase()
      if (!family.startsWith('qwen')) continue

      const layer = manifest.layers?.find(item => item?.mediaType === MODEL_MEDIA_TYPE)
      const modelPath = blobPath(blobsRoot, layer?.digest, path)
      if (!modelPath || !fs.existsSync(modelPath)) continue

      const modelName = ollamaName(relativePath)
      if (!modelName || !/qwen/i.test(modelName)) continue
      const alias = `ollama:${modelName}`
      const expectedSize = Number.isFinite(layer.size) ? layer.size : undefined
      entries.push([alias, Object.freeze({
        modelSrc: modelPath,
        modelType: 'llamacpp-completion',
        modelConfig: Object.freeze({
          device,
          gpu_layers: device === 'gpu' ? 99 : 0,
          ctx_size: 8192
        }),
        expectedSize,
        label: modelName,
        provider: 'ollama',
        family,
        params: typeof config.model_type === 'string' ? config.model_type : undefined,
        quantization: typeof config.file_type === 'string' ? config.file_type : undefined,
        recommended: family === 'qwen3'
      })])
    } catch {
      // Directories, malformed manifests, and incomplete blobs are ignored.
    }
  }

  entries.sort((a, b) => {
    const recommended = Number(!!b[1].recommended) - Number(!!a[1].recommended)
    if (recommended) return recommended
    return (a[1].expectedSize || Infinity) - (b[1].expectedSize || Infinity) || a[0].localeCompare(b[0])
  })
  return Object.freeze(Object.fromEntries(entries))
}

function blobPath (blobsRoot, digest, path) {
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(digest)) return null
  return path.join(blobsRoot, digest.replace(':', '-').toLowerCase())
}

function ollamaName (relativePath) {
  const parts = String(relativePath || '').split(/[\\/]/).filter(Boolean)
  if (parts.length < 2) return null
  const tag = parts.pop()
  if (parts[0] === 'library') parts.shift()
  if (!parts.length || !tag) return null
  return `${parts.join('/')}:${tag}`
}

module.exports = { discoverOllamaQwenModels }
