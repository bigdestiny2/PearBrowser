/**
 * Contacts — the user's social graph.
 *
 * Phase D of the identity plan. A Hyperbee inside the user's Corestore
 * listing people the user has added (scanned their QR / accepted an
 * invite). Any app with the `contacts:read` scope can query it via
 * `window.pear.contacts.list()`.
 *
 * Data layout:
 *   contact!<pubkey>   { displayName, addedAt, tags?, avatar?, notes? }
 *
 * Pubkeys are the OTHER user's ROOT pubkey (not their per-app sub-key).
 * Since each user's root pubkey is derived from their BIP-39 seed, it's
 * stable forever and unique — the right identifier for a "person."
 */

const Hyperbee = require('hyperbee')
const crypto = require('bare-crypto')

const MAX_CONTACTS = 10_000

class Contacts {
  constructor (store) {
    if (!store) throw new Error('Contacts requires a Corestore')
    this.store = store
    this._bee = null
    this._ready = false
  }

  async ready () {
    if (this._ready) return
    const core = this.store.get({ name: 'pearbrowser-contacts-v1' })
    this._bee = new Hyperbee(core, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    })
    await this._bee.ready()
    this._ready = true
  }

  _requireReady () {
    if (!this._ready) throw new Error('Contacts not ready — call ready() first')
  }

  _validatePubkey (pubkey) {
    if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) {
      throw new Error('Invalid pubkey — expected 64-char hex')
    }
    return pubkey.toLowerCase()
  }

  async list ({ limit = 1000 } = {}) {
    this._requireReady()
    const out = []
    let count = 0
    const cap = Math.min(Math.max(1, limit), 1000)
    for await (const entry of this._bee.createReadStream({ gte: 'contact!', lt: 'contact!~' })) {
      out.push({ pubkey: entry.key.slice('contact!'.length), ...entry.value })
      if (++count >= cap) break
    }
    return out
  }

  async lookup (pubkey) {
    this._requireReady()
    const key = this._validatePubkey(pubkey)
    const entry = await this._bee.get('contact!' + key)
    return entry ? { pubkey: key, ...entry.value } : null
  }

  async add ({ pubkey, displayName, avatar, tags, notes }) {
    this._requireReady()
    const key = this._validatePubkey(pubkey)
    const trimmedName = typeof displayName === 'string' ? displayName.trim().slice(0, 128) : ''
    const existing = await this._bee.get('contact!' + key)
    const record = {
      displayName: trimmedName,
      addedAt: existing ? existing.value.addedAt : Date.now(),
      avatar: typeof avatar === 'string' ? avatar.slice(0, 1024) : null,
      tags: Array.isArray(tags) ? tags.map(String).slice(0, 16) : [],
      notes: typeof notes === 'string' ? notes.slice(0, 512) : null,
      updatedAt: Date.now(),
    }
    // enforce cap
    const count = (await this.list({ limit: MAX_CONTACTS })).length
    if (!existing && count >= MAX_CONTACTS) {
      throw new Error(`Contact cap reached (${MAX_CONTACTS})`)
    }
    await this._bee.put('contact!' + key, record)
    return { pubkey: key, ...record }
  }

  async update (pubkey, updates) {
    this._requireReady()
    const key = this._validatePubkey(pubkey)
    const existing = await this._bee.get('contact!' + key)
    if (!existing) return null
    const next = {
      ...existing.value,
      ...updates,
      pubkey: undefined,       // never allow overwriting key
      addedAt: existing.value.addedAt,
      updatedAt: Date.now(),
    }
    delete next.pubkey
    await this._bee.put('contact!' + key, next)
    return { pubkey: key, ...next }
  }

  async remove (pubkey) {
    this._requireReady()
    const key = this._validatePubkey(pubkey)
    await this._bee.del('contact!' + key)
  }

  /**
   * Parse a `pear://contact?pk=<hex>&name=<url-encoded>&sig=<hex>` URL
   * into a contact record. `sig` is optional (ed25519 signature over
   * `pear.contact:<pubkey>:<displayName>` by the contact's root key —
   * proves the QR wasn't tampered with). If sig is present + invalid
   * we reject the import.
   */
  static parseInviteURL (url) {
    try {
      const u = new URL(url)
      if (u.protocol !== 'pear:') return null
      if (u.hostname !== 'contact' && u.pathname.replace('//', '') !== 'contact') return null
      const pk = u.searchParams.get('pk')
      const name = u.searchParams.get('name') || ''
      const sig = u.searchParams.get('sig')
      if (!pk || !/^[0-9a-f]{64}$/i.test(pk)) return null
      return { pubkey: pk.toLowerCase(), displayName: name, signature: sig }
    } catch {
      return null
    }
  }

  async close () {
    if (this._bee) {
      try { await this._bee.close() } catch (_) {}
      this._bee = null
    }
    this._ready = false
  }
}

module.exports = { Contacts, MAX_CONTACTS }
