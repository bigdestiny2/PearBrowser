/**
 * Shared Node-compatible stubs for Bare-only modules used by backend files.
 * Tests that need to load backend/*.js under plain Node import this once
 * at the top of the file.
 *
 * Each stub is written to test/.stubs/<name>.js and registered with
 * Module._resolveFilename so `require('bare-http1')` etc. resolves.
 */

const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')

const stubDir = path.join(__dirname, '.stubs')
if (!fs.existsSync(stubDir)) fs.mkdirSync(stubDir)

const STUB_SOURCES = {
  'bare-http1': 'module.exports = { request: () => ({ end: () => {} }) }',
  'bare-crypto': 'module.exports = require("node:crypto")',
  'bare-fs': 'module.exports = require("node:fs")',
  'bare-path': 'module.exports = require("node:path")',
  'b4a': `module.exports = {
    from: (x, enc) => typeof x === 'string' ? Buffer.from(x, enc) : Buffer.from(x || []),
    alloc: (n) => Buffer.alloc(n),
    isBuffer: (b) => Buffer.isBuffer(b) || b instanceof Uint8Array,
    concat: (list) => Buffer.concat(list),
    toString: (b, enc) => Buffer.from(b).toString(enc || 'utf-8'),
  }`,
}

const STUBS = {}
for (const [name, body] of Object.entries(STUB_SOURCES)) {
  const file = path.join(stubDir, `${name.replace(/[^a-z0-9]/gi, '_')}.js`)
  // Write every time — keeps all tests in sync even if one changed the stub
  fs.writeFileSync(file, body)
  STUBS[name] = file
}

// Install the resolver hook (idempotent — we wrap once)
if (!Module._resolveFilename.__pearStubbed) {
  const orig = Module._resolveFilename
  const patched = function (request, ...rest) {
    if (STUBS[request]) return STUBS[request]
    return orig.call(this, request, ...rest)
  }
  patched.__pearStubbed = true
  Module._resolveFilename = patched
}

module.exports = { STUBS }
