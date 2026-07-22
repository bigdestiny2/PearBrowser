// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/name-registry-store.cjs.
// N5 — the multi-writer name registry store: an Autobase op-log of owner-signed
// name ops, materialized through the deterministic reducer (name-registry-apply
// decide) so the same first-claim/revoke/rotate/homograph policy the pure tests
// pin also governs the live, replicated view. Built on the durability-proven
// encrypted-autobase-helper (SPIKE-AUTOBEE-DURABILITY GREEN), so a claim survives
// all writers going offline (re-served from a blind relay). writer.add is the
// helper's reserved ADD_WRITER op. CommonJS — Bare requires it, Node tests it.

const { createEncryptedAutobaseManager } = require('./encrypted-autobase-helper.cjs')
const { normalize } = require('./name-normalize.cjs')
const ops = require('./name-registry-ops.cjs')
const { verifyOpAuthenticity, decide } = require('./name-registry-apply.cjs')

class NameRegistry {
  constructor (store, opts = {}) {
    // The reducer: verify the op, read the current name entry + the entry that
    // owns this op's skeleton, run the SAME pure `decide` as applyView, then write.
    const applyOp = async (op, view) => {
      const auth = verifyOpAuthenticity(op)
      if (!auth) return
      const { normalized, skeleton: sk } = auth
      const effectiveOp = auth.target ? { ...op, target: auth.target } : op
      const curRec = await view.get('name!' + normalized).catch(() => null)
      const current = curRec ? curRec.value : null
      // skelRec: { owner, names:[...] } of all non-released holders of this skeleton
      // (set-valued, so a sibling-variant release can't free a still-held skeleton).
      const skelRecRec = await view.get('skel!' + sk).catch(() => null)
      const skelRec = skelRecRec ? skelRecRec.value : null
      const d = decide({ current, skelRec, normalized, skeleton: sk }, effectiveOp)
      if (!d.write) return
      await view.put('name!' + normalized, d.write)
      if (d.skelAdd) {
        const rec = skelRec || { owner: effectiveOp.owner, names: [] }
        rec.owner = effectiveOp.owner
        if (!rec.names.includes(normalized)) rec.names.push(normalized)
        await view.put('skel!' + sk, rec)
      }
      if (d.skelRemove && skelRec) {
        const remaining = skelRec.names.filter((n) => n !== normalized)
        if (remaining.length === 0) await view.del('skel!' + sk)
        else { skelRec.names = remaining; await view.put('skel!' + sk, skelRec) }
      }
    }
    // storeNamespace must be UNIQUE per registry on a node that opens several
    // (your own + each contact's, for federation) — default isolates the own one.
    this.mgr = createEncryptedAutobaseManager(store, { ...opts, applyOp, viewName: 'name-registry', storeNamespace: opts.storeNamespace || 'eab-name-registry-self' })
  }

  async ready () { await this.mgr.ready(); return this }
  get key () { return this.mgr.key }
  get writable () { return this.mgr.writable }
  get localKey () { return this.mgr.localKey }
  get discoveryKey () { return this.mgr.discoveryKey }

  // Append a pre-signed op (built with the name-registry-ops builders + the
  // owner's signer). The store never holds a key — signing stays with the caller.
  async append (op) { await this.mgr.append(op) }
  async addWriter (writerKeyHex) { await this.mgr.addWriter(writerKeyHex) }
  async update () { await this.mgr.update() }

  // Convenience signers: build + append in one call. ownerSign(msg) -> ed25519 hex.
  async claim ({ name, target, owner }, ownerSign) { await this.append(ops.claimOp({ name, target, owner }, ownerSign)) }
  async rotate ({ name, target, owner, version }, ownerSign) { await this.append(ops.rotateOp({ name, target, owner, version }, ownerSign)) }
  async release ({ name, owner }, ownerSign) { await this.append(ops.releaseOp({ name, owner }, ownerSign)) }
  async revoke ({ name, owner }, ownerSign) { await this.append(ops.revokeOp({ name, owner }, ownerSign)) }

  // Resolve a typed name → the active entry (target/owner/version) or null.
  async resolve (name) {
    await this.mgr.update()
    const normalized = normalize(name)
    const e = await this.mgr.view.get('name!' + normalized).catch(() => null)
    const v = e && e.value
    if (!v || v.status !== 'active') return null
    const resolved = ops.targetToResolution(v.target) || {}
    return {
      name: v.name,
      normalized,
      target: v.target,
      key: resolved.key || null,
      link: resolved.link || null,
      owner: v.owner,
      version: v.version
    }
  }

  // Active names as a resolver-ready map { [normalized]: { target, key?, link?, owner, version } }
  // — the registry tier injected into resolveName (mirrors Names.petnameMap()).
  async activeMap () {
    const out = {}
    for (const e of await this.list()) {
      const resolved = ops.targetToResolution(e.target) || {}
      out[e.normalized] = {
        target: e.target,
        key: resolved.key || null,
        link: resolved.link || null,
        owner: e.owner,
        version: e.version,
        label: e.name
      }
    }
    return out
  }

  // All currently-active names. Upper bound is 'name"' (the byte 0x22 right after
  // the '!' separator 0x21), a TRUE prefix range — 'name!~' (0x7E) would silently
  // drop every name!<normalized> whose first byte sorts above '~', i.e. all
  // non-ASCII (i18n / emoji) names.
  async list () {
    await this.mgr.update()
    const out = []
    for await (const e of this.mgr.view.createReadStream({ gte: 'name!', lt: 'name"' })) {
      if (e.value && e.value.status === 'active') {
        const resolved = ops.targetToResolution(e.value.target) || {}
        out.push({ ...e.value, key: resolved.key || null, link: resolved.link || null })
      }
    }
    return out
  }

  async close () { await this.mgr.close() }
}

module.exports = { NameRegistry }
