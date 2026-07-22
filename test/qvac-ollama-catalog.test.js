'use strict'

// Mobile port (Mission B4b): adapted from pearbrowser-desktop/test/qvac-ollama-catalog.test.js
// (ESM → CommonJS; module path points at the ported
// backend/ai/qvac-ollama-catalog.cjs). Discovery is adapter-injected and
// dependency-free, so behavior matches the desktop exactly.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { discoverOllamaQwenModels } = require('../backend/ai/qvac-ollama-catalog.cjs')

test('Ollama discovery turns complete Qwen manifests into host-owned aliases', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qvac-ollama-catalog-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const modelsRoot = path.join(root, '.ollama', 'models')
  const manifestDir = path.join(modelsRoot, 'manifests', 'registry.ollama.ai', 'library', 'qwen3')
  const blobsDir = path.join(modelsRoot, 'blobs')
  fs.mkdirSync(manifestDir, { recursive: true })
  fs.mkdirSync(blobsDir, { recursive: true })

  const configDigest = `sha256:${'a'.repeat(64)}`
  const modelDigest = `sha256:${'b'.repeat(64)}`
  fs.writeFileSync(path.join(blobsDir, configDigest.replace(':', '-')), JSON.stringify({
    model_family: 'qwen3',
    model_type: '8.2B',
    file_type: 'Q4_K_M'
  }))
  fs.writeFileSync(path.join(blobsDir, modelDigest.replace(':', '-')), 'GGUF')
  fs.writeFileSync(path.join(manifestDir, '8b'), JSON.stringify({
    config: { digest: configDigest },
    layers: [{
      mediaType: 'application/vnd.ollama.image.model',
      digest: modelDigest,
      size: 1234
    }]
  }))

  const catalog = discoverOllamaQwenModels({ fs, path, homeDir: root, device: 'cpu' })
  assert.deepEqual(Object.keys(catalog), ['ollama:qwen3:8b'])
  assert.equal(catalog['ollama:qwen3:8b'].modelSrc, path.join(blobsDir, modelDigest.replace(':', '-')))
  assert.equal(catalog['ollama:qwen3:8b'].expectedSize, 1234)
  assert.equal(catalog['ollama:qwen3:8b'].provider, 'ollama')
  assert.equal(catalog['ollama:qwen3:8b'].recommended, true)
  assert.deepEqual(catalog['ollama:qwen3:8b'].modelConfig, {
    device: 'cpu',
    gpu_layers: 0,
    ctx_size: 8192
  })
})

test('Ollama discovery ignores non-Qwen, malformed, and missing model blobs', () => {
  const files = new Map([
    ['/models/manifests/registry.ollama.ai/library/gemma/latest', JSON.stringify({
      config: { digest: `sha256:${'1'.repeat(64)}` },
      layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: `sha256:${'2'.repeat(64)}`, size: 10 }]
    })],
    [`/models/blobs/sha256-${'1'.repeat(64)}`, JSON.stringify({ model_family: 'gemma' })],
    [`/models/blobs/sha256-${'2'.repeat(64)}`, 'GGUF']
  ])
  const fakeFs = {
    readdirSync: () => ['library/gemma/latest', 'broken'],
    readFileSync: name => {
      if (!files.has(name)) throw new Error('missing')
      return files.get(name)
    },
    existsSync: name => files.has(name)
  }
  const posixPath = { join: (...parts) => parts.join('/').replace(/\/+/g, '/') }
  assert.deepEqual(discoverOllamaQwenModels({
    fs: fakeFs,
    path: posixPath,
    homeDir: '',
    modelsRoot: '/models'
  }), {})
})

test('Ollama discovery does not relabel Qwen-architecture distill models as Qwen products', () => {
  const configDigest = `sha256:${'3'.repeat(64)}`
  const modelDigest = `sha256:${'4'.repeat(64)}`
  const files = new Map([
    ['/models/manifests/registry.ollama.ai/library/deepseek-r1/8b', JSON.stringify({
      config: { digest: configDigest },
      layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: modelDigest, size: 10 }]
    })],
    [`/models/blobs/${configDigest.replace(':', '-')}`, JSON.stringify({ model_family: 'qwen3' })],
    [`/models/blobs/${modelDigest.replace(':', '-')}`, 'GGUF']
  ])
  const fakeFs = {
    readdirSync: () => ['library/deepseek-r1/8b'],
    readFileSync: name => files.get(name),
    existsSync: name => files.has(name)
  }
  const posixPath = { join: (...parts) => parts.join('/').replace(/\/+/g, '/') }
  assert.deepEqual(discoverOllamaQwenModels({ fs: fakeFs, path: posixPath, modelsRoot: '/models' }), {})
})
