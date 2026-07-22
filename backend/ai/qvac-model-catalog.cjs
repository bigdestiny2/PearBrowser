'use strict'

// Mobile port (Mission B4b): CJS conversion of pearbrowser-desktop
// backend/ai/qvac-model-catalog.mjs — the browser-approved model alias table,
// pinned exactly as the desktop has it (same registry source, size and
// sha256). Pages never receive or choose this source URL.

// Browser-owned alias. Keep this descriptor pinned alongside the QVAC package
// versions and packaging test; pages never receive or choose this source URL.
const SMOLLM2_360M_INST_Q8 = Object.freeze({
  name: 'SMOLLM2_360M_INST_Q8',
  src: 'registry://hf/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/593b5a2e04c8f3e4ee880263f93e0bd2901ad47f/smollm2-360m-instruct-q8_0.gguf',
  registryPath: 'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/593b5a2e04c8f3e4ee880263f93e0bd2901ad47f/smollm2-360m-instruct-q8_0.gguf',
  registrySource: 'hf',
  blobCoreKey: 'd90c0263033385abdb2290a69936d5cef030d5c63c87baa33c3a4a2d01b84ca8',
  blobBlockOffset: 1607599,
  blobBlockLength: 5897,
  blobByteOffset: 105350167985,
  modelId: 'smollm2-360m-instruct-q8_0.gguf',
  expectedSize: 386404992,
  sha256Checksum: '48ab3034d0dd401fbc721eb1df3217902fee7dab9078992d66431f09b7750201',
  addon: 'llm',
  engine: 'llamacpp-completion',
  quantization: 'q8',
  params: '360M'
})

const QVAC_MODEL_CATALOG = Object.freeze({
  'pear-small-chat': Object.freeze({
    modelSrc: SMOLLM2_360M_INST_Q8,
    modelType: 'llamacpp-completion',
    modelConfig: Object.freeze({
      device: 'cpu',
      gpu_layers: 0,
      ctx_size: 8192
    }),
    expectedSize: SMOLLM2_360M_INST_Q8.expectedSize,
    sha256Checksum: SMOLLM2_360M_INST_Q8.sha256Checksum,
    label: 'Pear Small Chat',
    provider: 'qvac',
    family: 'smollm2',
    params: '360M',
    quantization: 'Q8_0',
    recommended: false
  })
})

module.exports = { QVAC_MODEL_CATALOG }
