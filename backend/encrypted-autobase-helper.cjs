// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/encrypted-autobase-helper.cjs.
// createEncryptedAutobaseManager — a reusable ENCRYPTED multi-writer Autobase +
// Hyperbee-view manager. The pattern (an encrypted op-log whose bytes a relay can
// BLIND-PIN without reading, a pure reducer materializing the view, op-driven
// writer management) was embedded in browser-state-sync.cjs; this extracts it
// ONCE so the next consumers — PAY1 per-merchant receipt ledgers, PRIV0 rooms —
// reuse it instead of forking. CommonJS so Bare requires it and Node tests it.
//
// The consumer supplies applyOp(op, view, ctx) for its OWN ops; this module owns
// the Autobase/Hyperbee/encryption wiring and writer management (a reserved op
// type, so the consumer never reimplements addWriter).

const Autobase = require('autobase')
const Hyperbee = require('hyperbee')

const ADD_WRITER = '__autobase_add_writer__' // reserved op type for writer invites

function toBuf (v) {
  if (v == null) return null
  return typeof v === 'string' ? Buffer.from(v, 'hex') : v
}

// Build the reserved "add this writer" op (an indexer invite).
function addWriterOp (writerKeyHex) {
  if (!/^[0-9a-f]{64}$/i.test(String(writerKeyHex || ''))) throw new Error('writerKey must be 64-char hex')
  return { type: ADD_WRITER, key: String(writerKeyHex).toLowerCase() }
}

function createEncryptedAutobaseManager (store, opts = {}) {
  if (!store) throw new Error('createEncryptedAutobaseManager requires a Corestore')
  const bootstrap = toBuf(opts.bootstrap)
  const encryptionKey = toBuf(opts.encryptionKey)
  const ns = opts.namespace || (bootstrap ? Buffer.from(bootstrap).toString('hex') : 'local')
  const viewName = opts.viewName || `eab-${ns}-view`
  const valueEncoding = opts.viewValueEncoding || 'json'
  const applyOp = typeof opts.applyOp === 'function' ? opts.applyOp : async () => {}
  // CRITICAL: give the Autobase its OWN namespaced substore (keyed by the unique
  // viewName) rather than the raw store. base.close() runs store.close(); on the
  // shared ROOT Corestore that would tear down Hyperdrive/UserData/Names/
  // replication for the WHOLE app (a single consumer's close kills everything).
  // A namespace session's close() frees only its own cores, leaving the root
  // alive. The substore id must be UNIQUE per base on a node that opens several
  // (e.g. your own name registry + every contact's), so callers that open
  // multiple bases with the same viewName pass an explicit storeNamespace (e.g.
  // keyed by the bootstrap). Default keys by viewName for single-base consumers.
  // The namespace MUST wrap the store passed to new Autobase — opts.namespace
  // (used only for the view name) does not.
  const subNs = opts.storeNamespace || ('eab-' + viewName)
  const baseStore = typeof store.namespace === 'function' ? store.namespace(subNs) : store
  let base = null

  const handlers = {
    valueEncoding: 'json',
    open: (s) => new Hyperbee(s.get({ name: viewName }), { extension: false, keyEncoding: 'utf-8', valueEncoding }),
    apply: async (nodes, view, host) => {
      for (const node of nodes) {
        const op = node.value
        // reserved writer-invite op — handled here, never seen by the consumer
        if (op && op.type === ADD_WRITER && /^[0-9a-f]{64}$/i.test(op.key || '')) {
          await host.addWriter(Buffer.from(op.key, 'hex'), { indexer: true })
          continue
        }
        await applyOp(op, view, { host })
      }
    },
  }
  if (encryptionKey) handlers.encryptionKey = encryptionKey // blind-pin: relay holds bytes, can't read

  return {
    async ready () { base = new Autobase(baseStore, bootstrap, handlers); await base.ready(); return this },
    get base () { return base },
    get view () { return base && base.view },
    get writable () { return !!(base && base.writable) },
    get key () { return base && base.key ? Buffer.from(base.key).toString('hex') : '' },
    get discoveryKey () { return base && base.discoveryKey ? Buffer.from(base.discoveryKey) : null },
    get localKey () { return base && base.local && base.local.key ? Buffer.from(base.local.key).toString('hex') : '' },
    async append (op) { await base.append(op) },
    async addWriter (writerKeyHex) { await base.append(addWriterOp(writerKeyHex)) },
    async update () { await base.update() },
    async close () { try { if (base) await base.close() } catch {} },
  }
}

module.exports = { createEncryptedAutobaseManager, addWriterOp, ADD_WRITER }
