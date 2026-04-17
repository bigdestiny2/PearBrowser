/**
 * User data — bookmarks, history, settings — stored in a user-scoped Hyperbee.
 *
 * Phase 1 ticket 2 of the Holepunch alignment plan. Replaces AsyncStorage
 * on the RN side. Data lives inside the user's Corestore and replicates
 * across all devices that share the user's root keypair.
 *
 * Design:
 *   - One Hyperbee per data type (bookmarks, history, settings) under
 *     named Hypercores inside the shared Corestore.
 *   - Each device mirrors the user's writer cores via Autobase so writes
 *     from any device converge. (For Phase 1 we use single-writer Hyperbees
 *     per device; multi-device convergence via Autobase is a Phase 4 refinement.)
 *   - Keys are prefixed (bookmarks!url, history!ts, settings!key).
 *   - Values are plain JSON.
 */

const Hyperbee = require('hyperbee')
const b4a = require('b4a')

const MAX_HISTORY = 200
const MAX_BOOKMARKS = 10_000
const MAX_KEY_LENGTH = 2048

class UserData {
  /**
   * @param {Corestore} store — the user-scoped Corestore
   * @param {Hyperswarm} swarm — for replicating across devices
   * @param {object} opts
   */
  constructor (store, swarm, opts = {}) {
    if (!store) throw new Error('UserData requires a Corestore')
    this.store = store
    this.swarm = swarm
    this._ready = false
    this._bees = null
    this._onReady = []
  }

  async ready () {
    if (this._ready) return
    // One namespaced Hyperbee per data type
    const core = (name) => this.store.get({ name: `pearbrowser-userdata-${name}` })
    const bee = (name) => new Hyperbee(core(name), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    })

    this._bees = {
      bookmarks: bee('bookmarks'),
      history: bee('history'),
      settings: bee('settings'),
      session: bee('session'),
      tabs: bee('tabs'),
    }

    await Promise.all(Object.values(this._bees).map((b) => b.ready()))
    this._ready = true

    // Advertise our cores over swarm so other devices can replicate
    if (this.swarm && typeof this.swarm.join === 'function') {
      for (const bee of Object.values(this._bees)) {
        try {
          const topic = bee.core.discoveryKey
          if (topic) this.swarm.join(topic, { server: true, client: true })
        } catch (err) {
          console.warn('[UserData] swarm join failed:', err && err.message)
        }
      }
    }
  }

  _requireReady () {
    if (!this._ready) throw new Error('UserData not ready — call ready() first')
  }

  _validateKey (key) {
    if (typeof key !== 'string') throw new Error('key must be a string')
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) throw new Error('key length out of range')
    if (key.includes('\x00')) throw new Error('key contains null byte')
  }

  // --- Bookmarks ---

  async listBookmarks () {
    this._requireReady()
    const out = []
    for await (const entry of this._bees.bookmarks.createReadStream({ reverse: true })) {
      out.push(entry.value)
    }
    return out
  }

  async addBookmark ({ url, title }) {
    this._requireReady()
    this._validateKey(url)
    // Sort by most-recent-first using inverted timestamp prefix
    const addedAt = Date.now()
    const value = { url, title: String(title || ''), addedAt }
    // Use (max - addedAt) so reverse-lex order == newest first
    const sortKey = String(Number.MAX_SAFE_INTEGER - addedAt).padStart(18, '0')
    await this._bees.bookmarks.put(`bm!${sortKey}!${url}`, value)
    return value
  }

  async removeBookmark (url) {
    this._requireReady()
    this._validateKey(url)
    // Scan and delete all keys matching the url — url can appear under any sortKey
    const toDelete = []
    for await (const entry of this._bees.bookmarks.createReadStream({ gte: 'bm!', lt: 'bm!~' })) {
      if (entry.value && entry.value.url === url) toDelete.push(entry.key)
    }
    for (const key of toDelete) await this._bees.bookmarks.del(key)
    return toDelete.length
  }

  // --- History ---

  async listHistory ({ limit = 200 } = {}) {
    this._requireReady()
    const out = []
    let count = 0
    for await (const entry of this._bees.history.createReadStream({ reverse: true })) {
      out.push(entry.value)
      if (++count >= limit) break
    }
    return out
  }

  async addHistory ({ url, title }) {
    this._requireReady()
    this._validateKey(url)
    const visitedAt = Date.now()
    const sortKey = String(Number.MAX_SAFE_INTEGER - visitedAt).padStart(18, '0')
    // Remove previous entries for same url (Hyperbee del is cheap)
    for await (const entry of this._bees.history.createReadStream({ gte: 'h!', lt: 'h!~' })) {
      if (entry.value && entry.value.url === url) {
        await this._bees.history.del(entry.key)
      }
    }
    await this._bees.history.put(`h!${sortKey}!${url}`, { url, title: String(title || ''), visitedAt })
    // Trim to MAX_HISTORY — walk from oldest and delete overflow
    let total = 0
    const overflow = []
    for await (const entry of this._bees.history.createReadStream({ reverse: true })) {
      if (++total > MAX_HISTORY) overflow.push(entry.key)
    }
    for (const key of overflow) await this._bees.history.del(key)
  }

  async clearHistory () {
    this._requireReady()
    const keys = []
    for await (const entry of this._bees.history.createReadStream({ gte: 'h!', lt: 'h!~' })) {
      keys.push(entry.key)
    }
    for (const key of keys) await this._bees.history.del(key)
    return keys.length
  }

  // --- Settings (key-value) ---

  async getSettings () {
    this._requireReady()
    const out = {}
    for await (const entry of this._bees.settings.createReadStream({ gte: 's!', lt: 's!~' })) {
      const k = entry.key.slice(2) // strip 's!' prefix
      out[k] = entry.value
    }
    return out
  }

  async setSettings (updates) {
    this._requireReady()
    if (!updates || typeof updates !== 'object') return {}
    for (const [k, v] of Object.entries(updates)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
      await this._bees.settings.put(`s!${k}`, v)
    }
    return this.getSettings()
  }

  // --- Session (single KV) ---

  async getSession () {
    this._requireReady()
    const entry = await this._bees.session.get('current')
    return entry ? entry.value : null
  }

  async saveSession (state) {
    this._requireReady()
    await this._bees.session.put('current', state)
  }

  // --- Tabs ---

  async getTabs () {
    this._requireReady()
    const entry = await this._bees.tabs.get('current')
    return entry ? entry.value : []
  }

  async saveTabs (tabs) {
    this._requireReady()
    await this._bees.tabs.put('current', Array.isArray(tabs) ? tabs : [])
  }

  // --- Bulk (for AsyncStorage → Hyperbee migration) ---

  async importDump (dump) {
    this._requireReady()
    let imported = 0
    if (dump && typeof dump === 'object') {
      if (Array.isArray(dump.bookmarks)) {
        for (const b of dump.bookmarks) {
          if (b && b.url) { await this.addBookmark({ url: b.url, title: b.title || '' }); imported++ }
        }
      }
      if (Array.isArray(dump.history)) {
        for (const h of dump.history) {
          if (h && h.url) { await this.addHistory({ url: h.url, title: h.title || '' }); imported++ }
        }
      }
      if (dump.settings && typeof dump.settings === 'object') {
        await this.setSettings(dump.settings); imported++
      }
      if (dump.session) {
        await this.saveSession(dump.session); imported++
      }
      if (Array.isArray(dump.tabs)) {
        await this.saveTabs(dump.tabs); imported++
      }
    }
    return imported
  }

  async exportAll () {
    this._requireReady()
    return {
      bookmarks: await this.listBookmarks(),
      history: await this.listHistory({ limit: MAX_HISTORY }),
      settings: await this.getSettings(),
      session: await this.getSession(),
      tabs: await this.getTabs(),
    }
  }

  async close () {
    if (!this._bees) return
    for (const bee of Object.values(this._bees)) {
      try { await bee.close() } catch (_) {}
    }
    this._bees = null
    this._ready = false
  }
}

module.exports = { UserData, MAX_HISTORY, MAX_BOOKMARKS }
