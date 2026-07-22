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
// recursive:true is a no-op (not EEXIST) if another concurrent test process
// created the dir between our check and this call — safe under parallel runs.
fs.mkdirSync(stubDir, { recursive: true })

const HTTP_STUB = 'module.exports = { request: () => ({ on: () => {}, write: () => {}, end: () => {}, destroy: () => {} }), get: () => ({ on: () => {}, destroy: () => {} }) }'

const STUB_SOURCES = {
  'bare-http1': HTTP_STUB,
  'bare-https': HTTP_STUB,
  'bare-crypto': 'module.exports = require("node:crypto")',
  'bare-dns': 'module.exports = { ADDRCONFIG: 0, V4MAPPED: 0, lookup: (host, opts, cb) => { if (typeof opts === "function") { cb = opts; opts = {} } const family = opts && opts.family === 6 ? 6 : 4; const address = family === 6 ? "::1" : "127.0.0.1"; if (cb) return process.nextTick(() => cb(null, address, family)); return Promise.resolve({ address, family }) } }',
  'bare-fs': 'module.exports = require("node:fs")',
  'bare-path': 'module.exports = require("node:path")',
  // Real b4a works fine under plain Node — just forward to the real
  // module so corestore/hypercore (which use allocUnsafe, byteLength,
  // etc.) can pull it in. Earlier we shipped a hand-rolled subset; that
  // covered relay-client.test.js but broke anyone touching Hyperbee.
  'b4a': 'module.exports = require(require("path").join(__dirname, "..", "..", "node_modules", "b4a"))',
}

const STUBS = {}
for (const [name, body] of Object.entries(STUB_SOURCES)) {
  const file = path.join(stubDir, `${name.replace(/[^a-z0-9]/gi, '_')}.js`)
  STUBS[name] = file
  // Skip if already correct — avoids racing a concurrent writer for no reason.
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) continue
  // Atomic publish: write to a pid-unique temp then rename. rename(2) is atomic
  // on the same filesystem, so a concurrent test process never observes a
  // half-written stub (the old race that --test-concurrency=1 was masking).
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
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
