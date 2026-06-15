/**
 * SwarmGrants — Hyperbee storing user-approved (driveKey, topicHex)
 * pairs. Lets a page rejoin a Tier C swarm topic without prompting on
 * every page load.
 *
 * See docs/SWARM-V1.md §4.3 for the consent model.
 *
 * Storage layout (single Hyperbee under user's Corestore):
 *   g!<driveKeyHex>!<topicHex>  → { topicHex, driveKey, protocol, appName,
 *                                    grantedAt, lastUsedAt }
 *
 * Replicates across the user's devices via the existing Corestore
 * swarm join — same property as profile / contacts / user-data.
 */

const Hyperbee = require('hyperbee')

const ENTRY_PREFIX = 'g!'
const HEX64 = /^[0-9a-f]{64}$/

function key (driveKeyHex, topicHex) {
  return ENTRY_PREFIX + driveKeyHex.toLowerCase() + '!' + topicHex.toLowerCase()
}

class SwarmGrants {
  /**
   * @param {Corestore} store
   * @param {Hyperswarm} [swarm] — optional, for cross-device replication
   */
  constructor (store, swarm) {
    if (!store) throw new Error('SwarmGrants requires a Corestore')
    this.store = store
    this.swarm = swarm
    this._ready = false
    this._bee = null
  }

  async ready () {
    if (this._ready) return
    const core = this.store.get({ name: 'pearbrowser-swarm-grants' })
    this._bee = new Hyperbee(core, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    await this._bee.ready()

    if (this.swarm && typeof this.swarm.join === 'function') {
      try {
        const topic = this._bee.core.discoveryKey
        // PRIVACY CONCERN (alignment): we join with server:false so this
        // bee's discovery key is NOT announced on the DHT. The grants bee
        // is meant to replicate only between the user's OWN devices (same
        // property as profile / contacts / user-data, per the module
        // docstring), and those devices already find each other via the
        // shared Corestore swarm join. Announcing it (server:true) would
        // publish a discovery key that the privacy model says should stay
        // device-local, letting unrelated peers probe for it. client:true
        // is retained so this device still dials and replicates when a
        // sibling device announces the same Corestore. If announce-based
        // discovery is ever required here, flip server back to true with an
        // explicit justification.
        if (topic) this.swarm.join(topic, { server: false, client: true })
      } catch (err) {
        console.warn('[SwarmGrants] swarm join failed:', err && err.message)
      }
    }

    this._ready = true
  }

  _requireReady () {
    if (!this._ready) throw new Error('SwarmGrants not ready — call ready() first')
  }

  _validate (driveKeyHex, topicHex) {
    const d = String(driveKeyHex || '').toLowerCase()
    const t = String(topicHex || '').toLowerCase()
    if (!HEX64.test(d)) throw new Error('driveKey must be 64-char hex')
    if (!HEX64.test(t)) throw new Error('topic must be 64-char hex')
    return { d, t }
  }

  /** Returns true if a grant exists for (driveKey, topic). */
  async has (driveKeyHex, topicHex) {
    this._requireReady()
    const { d, t } = this._validate(driveKeyHex, topicHex)
    const entry = await this._bee.get(key(d, t))
    return !!entry
  }

  /** Add or refresh a grant. Idempotent. Returns the stored value. */
  async add (driveKeyHex, topicHex, meta = {}) {
    this._requireReady()
    const { d, t } = this._validate(driveKeyHex, topicHex)
    const now = Date.now()
    const existing = await this._bee.get(key(d, t))
    const value = existing && existing.value
      ? { ...existing.value, lastUsedAt: now, protocol: meta.protocol || existing.value.protocol, appName: meta.appName || existing.value.appName }
      : {
          driveKey: d,
          topicHex: t,
          protocol: meta.protocol || null,
          appName: meta.appName || null,
          grantedAt: now,
          lastUsedAt: now
        }
    await this._bee.put(key(d, t), value)
    return value
  }

  /** Bump lastUsedAt on a hot path. Best-effort, swallows errors. */
  async touch (driveKeyHex, topicHex) {
    if (!this._ready) return
    try {
      const { d, t } = this._validate(driveKeyHex, topicHex)
      const existing = await this._bee.get(key(d, t))
      if (!existing || !existing.value) return
      await this._bee.put(key(d, t), { ...existing.value, lastUsedAt: Date.now() })
    } catch {}
  }

  async remove (driveKeyHex, topicHex) {
    this._requireReady()
    const { d, t } = this._validate(driveKeyHex, topicHex)
    await this._bee.del(key(d, t))
    return { driveKey: d, topicHex: t }
  }

  /** Remove every grant for an app. Used by Connected Apps "revoke all". */
  async removeAllForApp (driveKeyHex) {
    this._requireReady()
    const d = String(driveKeyHex || '').toLowerCase()
    if (!HEX64.test(d)) throw new Error('driveKey must be 64-char hex')
    const prefix = ENTRY_PREFIX + d + '!'
    const keys = []
    for await (const entry of this._bee.createReadStream({ gte: prefix, lt: prefix + '~' })) {
      keys.push(entry.key)
    }
    for (const k of keys) await this._bee.del(k)
    return keys.length
  }

  /** List all grants, newest-first. */
  async list () {
    this._requireReady()
    const out = []
    for await (const entry of this._bee.createReadStream({ gte: ENTRY_PREFIX, lt: ENTRY_PREFIX + '~' })) {
      if (entry.value) out.push(entry.value)
    }
    out.sort((a, b) => (b.grantedAt || 0) - (a.grantedAt || 0))
    return out
  }

  /** List grants scoped to one app. */
  async listForApp (driveKeyHex) {
    this._requireReady()
    const d = String(driveKeyHex || '').toLowerCase()
    if (!HEX64.test(d)) return []
    const prefix = ENTRY_PREFIX + d + '!'
    const out = []
    for await (const entry of this._bee.createReadStream({ gte: prefix, lt: prefix + '~' })) {
      if (entry.value) out.push(entry.value)
    }
    out.sort((a, b) => (b.grantedAt || 0) - (a.grantedAt || 0))
    return out
  }
}

module.exports = { SwarmGrants }
