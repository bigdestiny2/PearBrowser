// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/names.cjs.
// Petname store (naming Phase N1, Tier 0) — the user's own name→target aliases
// plus a "seen" log of nicknames observed in the wild.
//
// Mirrors backend/contacts.js (a Hyperbee in the user's Corestore) but needs no
// crypto, so it's a .cjs that loads under Node too — unit-testable with a temp
// Corestore. Names are stored NORMALIZED (name-normalize.cjs) so lookup is
// canonical and homograph-safe.
//
// Layout:
//   pet!<normalizedName>  { name, key?, link?, label, addedAt, updatedAt }
//   seen!<keyHex>         { lastNickname, seenAt }   ← self-asserted, never resolved
const Hyperbee = require('hyperbee')
const { normalize } = require('./name-normalize.cjs')
const { normalizeCatalogLink } = require('./catalog-safety.cjs')

const MAX_PETNAMES = 10_000
const HEX64_RE = /^[0-9a-f]{64}$/i
const MAX_LINK = 300

class Names {
  constructor (store, { now = Date.now } = {}) {
    if (!store) throw new Error('Names requires a Corestore')
    this.store = store
    this._now = now
    this._bee = null
    this._ready = false
  }

  async ready () {
    if (this._ready) return
    const core = this.store.get({ name: 'pearbrowser-names-v1' })
    this._bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })
    await this._bee.ready()
    this._ready = true
  }

  _req () { if (!this._ready) throw new Error('Names not ready — call ready() first') }

  async setPetname ({ name, key, link, label } = {}) {
    this._req()
    const n = normalize(name)
    if (!n) throw new Error('name required')
    const keyHex = (typeof key === 'string' && HEX64_RE.test(key)) ? key.toLowerCase() : null
    const normalizedLink = normalizeCatalogLink(link)
    const lk = normalizedLink && normalizedLink.length <= MAX_LINK ? normalizedLink : null
    if (!keyHex && !lk) throw new Error('petname needs a key or link')
    const existing = await this._bee.get('pet!' + n)
    if (!existing) {
      const count = (await this.list({ limit: MAX_PETNAMES })).length
      if (count >= MAX_PETNAMES) throw new Error(`Petname cap reached (${MAX_PETNAMES})`)
    }
    const rec = {
      name: n,
      key: keyHex,
      link: lk,
      label: typeof label === 'string' ? label.slice(0, 128) : (existing ? existing.value.label : name),
      addedAt: existing ? existing.value.addedAt : this._now(),
      updatedAt: this._now()
    }
    await this._bee.put('pet!' + n, rec)
    return rec
  }

  async lookupPetname (name) {
    this._req()
    const n = normalize(name)
    if (!n) return null
    const e = await this._bee.get('pet!' + n)
    return e ? e.value : null
  }

  async list ({ limit = 1000 } = {}) {
    this._req()
    const out = []
    let c = 0
    const cap = Math.min(Math.max(1, limit), MAX_PETNAMES)
    for await (const e of this._bee.createReadStream({ gte: 'pet!', lt: 'pet!~' })) {
      out.push(e.value)
      if (++c >= cap) break
    }
    return out
  }

  // Resolver-ready map { normalizedName: { key, link, label } } for resolve-name.cjs.
  async petnameMap () {
    const map = {}
    for (const p of await this.list({ limit: MAX_PETNAMES })) {
      map[p.name] = { key: p.key, link: p.link, label: p.label }
    }
    return map
  }

  async removePetname (name) {
    this._req()
    const n = normalize(name)
    if (n) await this._bee.del('pet!' + n)
  }

  // A nickname a publisher self-asserts (seen on a loaded drive). Recorded for
  // an "unverified" hint, NEVER resolved (that would be the centralized,
  // squattable corner of Zooko's triangle).
  async recordSeen (keyHex, nickname) {
    this._req()
    if (typeof keyHex !== 'string' || !HEX64_RE.test(keyHex)) return
    await this._bee.put('seen!' + keyHex.toLowerCase(), {
      lastNickname: String(nickname || '').slice(0, 128),
      seenAt: this._now()
    })
  }

  async close () {
    if (this._bee) { try { await this._bee.close() } catch (_) {} this._bee = null }
    this._ready = false
  }
}

module.exports = { Names, MAX_PETNAMES }
