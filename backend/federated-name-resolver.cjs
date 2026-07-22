// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/federated-name-resolver.cjs.
// N5 cross-user federation — resolve a typed name across TRUSTED contacts' name
// registries. Each verified contact advertises their registry key on their self-
// certifying binding (the same record federated search already resolves); we
// replicate that registry and trust ONLY claims signed by the contact's
// Contacts-held ROOT pubkey (the MITM defense — never a self-asserted owner).
// Deterministic conflict resolution. PURE w.r.t. its injected deps (contacts
// list, binding resolver, registry opener) → Node-testable with stubs or real
// local registries. CommonJS.

const { normalize } = require('./name-normalize.cjs')
const { targetToResolution } = require('./name-registry-ops.cjs')

const DEFAULT_MAX_CONTACTS = 64
const DEFAULT_STEP_TIMEOUT_MS = 2500

// Bound a promise so one slow/hostile contact can't stall resolution. The timer
// is cleared when the wrapped promise settles, so it never leaks.
function withTimeout (p, ms) {
  let t = null
  return Promise.race([
    Promise.resolve(p).finally(() => { if (t) clearTimeout(t) }),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms) }),
  ])
}

class FederatedNameResolver {
  // deps:
  //   listContacts() -> [{ pubkey (root hex), displayName, verifiedAt, bindingKey }]
  //   resolveBinding({ contactPubkey, dhtPubkey }) -> { nameRegKey } | null
  //   openRegistry(nameRegKeyHex, contactPubkey) -> { resolve(name) -> {target, owner, version}|null } | null
  constructor ({ listContacts, resolveBinding, openRegistry, maxContacts, stepTimeoutMs, log } = {}) {
    if (typeof listContacts !== 'function') throw new Error('FederatedNameResolver requires listContacts')
    if (typeof resolveBinding !== 'function') throw new Error('FederatedNameResolver requires resolveBinding')
    if (typeof openRegistry !== 'function') throw new Error('FederatedNameResolver requires openRegistry')
    this.listContacts = listContacts
    this.resolveBinding = resolveBinding
    this.openRegistry = openRegistry
    this.maxContacts = Number.isInteger(maxContacts) && maxContacts > 0 ? maxContacts : DEFAULT_MAX_CONTACTS
    this.stepTimeoutMs = Number.isInteger(stepTimeoutMs) && stepTimeoutMs > 0 ? stepTimeoutMs : DEFAULT_STEP_TIMEOUT_MS
    this.log = typeof log === 'function' ? log : () => {}
  }

  // Resolve `name` across trusted contacts IN PARALLEL (a slow contact only adds
  // latency up to stepTimeoutMs, not linearly). Returns { name, key, link, owner,
  // source, contactPubkey, candidates } or null. `candidates` = how many trusted
  // contacts claimed it (>1 ⇒ ambiguous).
  async resolve (name) {
    const norm = normalize(name)
    if (!norm) return null
    const contacts = (await this.listContacts()) || []
    // fail-closed: only SIGNATURE-VERIFIED contacts (verifiedAt) with an
    // advertised, invite-bound binding pointer (bindingKey) — mirrors the
    // federated-search trust frontier — and capped.
    const eligible = contacts
      .filter((c) => c && c.verifiedAt && typeof c.pubkey === 'string' && c.bindingKey)
      .slice(0, this.maxContacts)
    const settled = await Promise.allSettled(eligible.map(async (c) => {
      const binding = await withTimeout(this.resolveBinding({ contactPubkey: c.pubkey, dhtPubkey: c.bindingKey }), this.stepTimeoutMs)
      if (!binding || !binding.nameRegKey) return null
      const reg = await withTimeout(this.openRegistry(binding.nameRegKey, c.pubkey), this.stepTimeoutMs)
      if (!reg) return null
      const claim = await withTimeout(reg.resolve(norm), this.stepTimeoutMs)
      const target = claim && targetToResolution(claim.link || claim.key || claim.target)
      if (!claim || !target || (!target.key && !target.link)) return null
      // MITM defense: trust the claim ONLY if its owner is THIS contact's root
      // (held in Contacts, invite-authenticated). A replicated registry can carry
      // other writers' claims — we ignore those.
      if (claim.owner !== c.pubkey) return null
      return { contact: c, claim, target }
    }))
    const candidates = settled.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value)
    if (!candidates.length) return null
    // Deterministic, replica-independent conflict resolution: lowest contact
    // pubkey wins. A name can be claimed independently inside each contact's own
    // registry (there is no global namespace), so we surface the source contact +
    // the ambiguity count rather than pretend a name is globally unique.
    candidates.sort((a, b) => (a.contact.pubkey < b.contact.pubkey ? -1 : 1))
    const best = candidates[0]
    return {
      name: norm,
      key: best.target.key || null,
      link: best.target.link || null,
      target: best.claim.target || best.target.link || best.target.key,
      owner: best.claim.owner,
      source: best.contact.displayName || best.contact.pubkey.slice(0, 8),
      contactPubkey: best.contact.pubkey,
      candidates: candidates.length,
    }
  }
}

module.exports = { FederatedNameResolver }
