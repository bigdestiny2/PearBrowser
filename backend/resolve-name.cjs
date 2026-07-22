// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/resolve-name.cjs.
// Pure tiered name resolver (naming Phase N1 — Tiers 0 + 3).
//
// Given a typed name and the local trust context, resolve to a target + an
// HONEST provenance label saying which tier answered. Higher tiers WIN: a
// user's own petname beats a curated alias (the user's intent is authoritative).
// No network, no Bare → Node-testable. Tiers 1 (contacts-bound bindings) and 2
// (followed name rooms, verify-then-drop) land in N3/N4 behind this same shape.
const { normalize } = require('./name-normalize.cjs')
const { lookupAlias } = require('./name-aliases.cjs')
const { targetToResolution } = require('./name-registry-ops.cjs')

/**
 * @param {string} rawName  the word typed in the URL bar
 * @param {object} ctx
 *   @param {object} ctx.petnames  { [normalizedName]: { key?, link?, label? } }
 *                                 the user's own saved aliases (Tier 0)
 *   @param {object} ctx.registry  { [normalizedName]: { target, owner?, version?, label? } }
 *                                 the multi-writer N5 name registry (Tier 2)
 *   @param {boolean} ctx.aliases  include the curated bootstrap floor (default true)
 * @returns {null | { name, key, link, label, provenance }}  provenance ∈
 *   'petname' | 'registry' | 'curated' (later: 'contact').
 */
function resolveName (rawName, { petnames = {}, registry = {}, aliases = true } = {}) {
  const n = normalize(rawName)
  if (!n) return null

  // Tier 0 — local petname. Highest authority: the user explicitly saved it.
  const pet = petnames[n]
  if (pet && (pet.key || pet.link)) {
    const key = pet.key || null
    const link = pet.link || null
    return { name: n, key, link, target: link || key, label: pet.label || rawName, provenance: 'petname' }
  }

  // Tier 2 — multi-writer name registry (N5). An owner-signed first-claim, durable
  // across writers. Beats the static curated floor; yields to the user's own petname.
  const reg = registry[n]
  if (reg) {
    const target = targetToResolution(reg.link || reg.key || reg.target)
    if (target && (target.key || target.link)) {
      return { name: n, key: target.key || null, link: target.link || null, target: target.link || target.key, label: reg.label || rawName, provenance: 'registry' }
    }
  }

  // Tier 3 — curated bootstrap floor. Lowest authority; overridden by anything above.
  if (aliases) {
    const a = lookupAlias(n)
    if (a) {
      const key = a.key || null
      const link = a.link || null
      return { name: n, key, link, target: link || key, label: a.label, provenance: 'curated' }
    }
  }

  return null
}

module.exports = { resolveName }
