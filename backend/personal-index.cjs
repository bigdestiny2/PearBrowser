// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/personal-index.cjs.
// PersonalIndex — Phase 0 self-search store. A per-user Hyperbee of signed
// search records (backend/search-core.cjs schema) over the app's Corestore,
// mirroring the Contacts/UserData core pattern. Indexes pages the user browses
// / bookmarks; queried fully locally (zero network, sub-5ms — see
// docs/research/bench-results-personal-index.md). LRU-capped by doc count.
//
// CommonJS so Bare requires it and Node tests it. The `sign` hook is injected
// (identity.signForApp in the app; omitted/stubbed in tests) — at hop-0 you
// trust your own subkey, so the per-doc signature is recorded for forward-
// compatibility with the networked phases but not verified locally.

const Hyperbee = require('hyperbee')
const sc = require('./search-core.cjs')
const dg = require('./search-digest.cjs')

const DEFAULT_NAME = 'pearbrowser-searchindex-v1'
const DEFAULT_MAX_DOCS = 20000
const padSeq = (n) => String(n).padStart(16, '0')
const orderKey = (seq) => 'o!' + padSeq(seq)

class PersonalIndex {
  constructor (store, opts = {}) {
    this.store = store
    this.name = opts.name || DEFAULT_NAME
    this.sign = typeof opts.sign === 'function' ? opts.sign : null
    this.maxDocs = Number.isInteger(opts.maxDocs) && opts.maxDocs >= 0 ? opts.maxDocs : DEFAULT_MAX_DOCS
    this.bee = null
    // Serialize index mutations: the read-modify-write of meta!count/seq spans
    // awaits, so concurrent indexDoc()/removeDoc() would lose updates and orphan
    // order-keys. Every mutation runs through this chain (one at a time).
    this._chain = Promise.resolve()
  }

  _serialize (fn) {
    const run = this._chain.then(fn, fn)
    this._chain = run.then(() => {}, () => {}) // the lock never rejects
    return run
  }

  async ready () {
    this.bee = new Hyperbee(this.store.get({ name: this.name }), { keyEncoding: 'utf-8', valueEncoding: 'json' })
    await this.bee.ready()
    return this
  }

  async _meta (key, dflt) {
    const e = await this.bee.get('meta!' + key).catch(() => null)
    return e && e.value != null ? e.value : dflt
  }

  // Public meta read/write for sidecar records (e.g. the IdentityBinding under
  // meta!binding). putMeta routes through _serialize so a binding write can't
  // interleave with indexDoc()'s read-modify-write of meta!count/seq and lose
  // an update; getMeta is a plain read.
  async putMeta (key, val) { return this._serialize(() => this.bee.put('meta!' + key, val)) }
  async getMeta (key, dflt) { return this._meta(key, dflt) }

  // Index (or re-index) one document. Re-indexing the same (driveKey,path)
  // refreshes its recency and replaces stale postings. Returns the docId, or
  // null if the page had no indexable terms. Serialized against other mutations.
  async indexDoc (doc) { return this._serialize(() => this._indexDocImpl(doc)) }
  async removeDoc (docId) { return this._serialize(() => this._removeDocImpl(docId)) }

  async _indexDocImpl (doc) {
    const { records, docId, terms } = sc.buildDocRecords(doc, this.sign)
    if (!terms.length) return null

    const existing = await this.bee.get(sc.docKey(docId)).catch(() => null)
    if (existing && existing.value) await this._removeByRecord(docId, existing.value)

    const seq = (await this._meta('seq', 0)) + 1
    const count = await this._meta('count', 0)
    const dk = sc.docKey(docId)
    const batch = this.bee.batch()
    for (const [k, v] of records) {
      // stamp the doc record with its order seq for O(1) eviction
      await batch.put(k, k === dk ? { ...v, seq } : v)
    }
    await batch.put(orderKey(seq), docId)
    await batch.put('meta!seq', seq)
    await batch.put('meta!count', count + 1)
    await batch.flush()

    await this._evictIfNeeded()
    return docId
  }

  async _removeByRecord (docId, drec) {
    const batch = this.bee.batch()
    for (const { term, tf } of (drec.terms || [])) await batch.del(sc.postingKey(term, tf, docId))
    await batch.del(sc.docKey(docId))
    if (drec.seq != null) await batch.del(orderKey(drec.seq))
    const count = await this._meta('count', 0)
    await batch.put('meta!count', Math.max(0, count - 1))
    await batch.flush()
  }

  async _removeDocImpl (docId) {
    const e = await this.bee.get(sc.docKey(docId)).catch(() => null)
    if (!e || !e.value) return false
    await this._removeByRecord(docId, e.value)
    return true
  }

  // Evict the least-recently-indexed docs until under the doc cap. Runs INSIDE
  // the serialized mutation, so it calls the unwrapped impl (not the public,
  // re-locking removeDoc) to avoid self-deadlock.
  async _evictIfNeeded () {
    let count = await this._meta('count', 0)
    let guard = 0
    while (count > this.maxDocs && guard++ < this.maxDocs + 64) {
      let oldest = null
      for await (const entry of this.bee.createReadStream({ gte: 'o!', lt: 'o!~', limit: 1 })) oldest = entry
      if (!oldest) break
      const removed = await this._removeDocImpl(oldest.value)
      // A dangling order-key (its d! record is gone, e.g. a seq-less re-index or
      // a crash mid-eviction) would otherwise sit at the head forever and stall
      // the scan — delete it directly so eviction makes progress.
      if (!removed) await this.bee.del(oldest.key)
      count = await this._meta('count', 0)
    }
  }

  // Query the index. `now0` (ms) is the single query-time stamp threaded into
  // the deterministic ranker; pass Date.now() from the caller (never read
  // inside the ranking fold).
  async search (query, opts = {}) {
    return sc.searchIndex(this.bee, query, { tier: 'self', trustHop: 0, ...opts })
  }

  async stats () {
    return { docs: await this._meta('count', 0), name: this.name }
  }

  // Hex of the underlying hypercore key — what a trusted peer replicates to read
  // this index (advertised in the IdentityBinding so contacts can find it).
  coreKeyHex () {
    const core = this.bee && (this.bee.core || this.bee.feed)
    return core && core.key ? core.key.toString('hex') : null
  }

  // Inputs for a completeness anchor: the index core key, its current length, and
  // the signed merkle tree hash (commits to the content AT that length, so a
  // peer can detect truncation/fork against a previously-seen anchor).
  async coreState () {
    const core = this.bee && (this.bee.core || this.bee.feed)
    if (!core || !core.key) return null
    let treeHash = ''
    try { treeHash = (await core.treeHash()).toString('hex') } catch (_) { /* pre-ready */ }
    return { key: core.key.toString('hex'), length: core.length || 0, treeHash }
  }

  // Build the cheap digest (docId Bloom + top-term head) a contact replicates by
  // default, so a peer can decide whether to pull our full shard for a query
  // WITHOUT downloading the (tens-of-MB) index. Scans the index — runs at publish
  // time, never per query.
  async buildDigest (opts = {}) {
    const docIds = []
    for await (const e of this.bee.createReadStream({ gte: 'd!', lt: 'd!~' })) docIds.push(e.key.slice(2))
    // term document-frequency from the t! postings (grouped by term in key order)
    const df = new Map()
    let curTerm = null
    let seen = null
    for await (const e of this.bee.createReadStream({ gte: 't!', lt: 't!~' })) {
      const parts = e.key.split('!') // t!<term>!<invScore>!<docId>
      const term = parts[1]
      const docId = parts[parts.length - 1]
      if (term !== curTerm) { curTerm = term; seen = new Set(); df.set(term, 0) }
      if (!seen.has(docId)) { seen.add(docId); df.set(term, (df.get(term) || 0) + 1) }
    }
    const termDf = []
    for (const [term, d] of df) termDf.push({ term, df: d })
    return dg.buildDigest(docIds, termDf, opts)
  }

  async close () { try { if (this.bee) await this.bee.close() } catch {} }
}

module.exports = { PersonalIndex }
