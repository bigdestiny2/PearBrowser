/**
 * Pear Bridge — P2P API for apps running in PearBrowser's WebView
 *
 * Provides a JavaScript API that gets injected into WebViews,
 * allowing P2P apps to access Hyperswarm, Autobase, and Hyperdrive
 * through the worklet backend.
 *
 * Apps call window.pear.* which posts messages to React Native,
 * which forwards them via RPC to the worklet, which does the P2P work.
 *
 * Architecture:
 *   WebView JS → postMessage → React Native → RPC → Worklet → Hyperswarm/Autobase
 */

const Autobase = require('autobase')
const Hyperbee = require('hyperbee')
const crypto = require('bare-crypto')

class PearBridge {
  constructor (store, swarm) {
    this.store = store
    this.swarm = swarm
    this._syncGroups = new Map() // groupId → { base, swarm topic }
    this._appDrives = new Map() // appId → Hyperdrive
  }

  // Validate appId format to prevent path traversal
  _validateAppId (appId) {
    if (typeof appId !== 'string') {
      throw new Error('appId must be a string')
    }
    if (appId.length < 1 || appId.length > 64) {
      throw new Error('appId must be between 1 and 64 characters')
    }
    // Only allow alphanumeric, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(appId)) {
      throw new Error('appId contains invalid characters')
    }
    // Prevent special reserved names
    const reserved = ['__proto__', 'constructor', 'prototype']
    if (reserved.includes(appId.toLowerCase())) {
      throw new Error('appId is reserved')
    }
    return appId
  }

  // ---------------------------------------------------------------------------
  // Sync Groups (Autobase)
  // ---------------------------------------------------------------------------

  /**
   * Create a new sync group — returns an invite key others can join with
   */
  async createSyncGroup (appId, applyFn) {
    // Validate appId
    this._validateAppId(appId)
    const localWriter = this.store.get({ name: `pear-app-${appId}-writer` })
    await localWriter.ready()

    const base = new Autobase(this.store, null, {
      apply: applyFn || this._defaultApply,
      open: (store) => new Hyperbee(store.get({ name: `pear-app-${appId}-view` }), {
        keyEncoding: 'utf-8',
        valueEncoding: 'binary',
        extension: false
      }),
      valueEncoding: 'json'
    })

    await base.ready()
    const inviteKey = (base.key || base.local.key).toString('hex')

    // Derive topic and join swarm
    const topic = crypto.createHash('sha256').update(inviteKey).digest()
    this.swarm.join(topic, { server: true, client: true })

    this._syncGroups.set(appId, { base, topic, inviteKey })

    return { inviteKey, appId }
  }

  /**
   * Join an existing sync group by invite key
   */
  async joinSyncGroup (appId, inviteKeyHex, applyFn) {
    // Validate appId
    this._validateAppId(appId)
    // Validate invite key format
    if (!inviteKeyHex || !/^[0-9a-f]{64}$/i.test(inviteKeyHex)) {
      throw new Error('Invalid invite key format')
    }
    const bootstrapKey = Buffer.from(inviteKeyHex, 'hex')

    const base = new Autobase(this.store, bootstrapKey, {
      apply: applyFn || this._defaultApply,
      open: (store) => new Hyperbee(store.get({ name: `pear-app-${appId}-view` }), {
        keyEncoding: 'utf-8',
        valueEncoding: 'binary',
        extension: false
      }),
      valueEncoding: 'json'
    })

    await base.ready()
    await base.view.update()

    const topic = crypto.createHash('sha256').update(inviteKeyHex).digest()
    this.swarm.join(topic, { server: true, client: true })

    this._syncGroups.set(appId, { base, topic, inviteKey: inviteKeyHex })

    return { inviteKey: inviteKeyHex, appId }
  }

  /**
   * Append an operation to a sync group
   */
  async append (appId, operation) {
    // Validate appId
    this._validateAppId(appId)
    const group = this._syncGroups.get(appId)
    if (!group) throw new Error('Sync group not found: ' + appId)

    const entry = {
      type: operation.type,
      data: operation.data,
      timestamp: operation.timestamp || new Date().toISOString(),
      deviceId: group.base.local.key.toString('hex').slice(0, 16)
    }

    await group.base.append(JSON.stringify(entry))
    await group.base.view.update()

    return { ok: true }
  }

  /**
   * Query the sync group's view (Hyperbee)
   */
  async get (appId, key) {
    // Validate appId
    this._validateAppId(appId)
    // Validate key
    if (typeof key !== 'string' || key.length === 0 || key.length > 1024) {
      throw new Error('Invalid key')
    }
    const group = this._syncGroups.get(appId)
    if (!group) throw new Error('Sync group not found: ' + appId)

    await group.base.view.update()
    const node = await group.base.view.get(key)
    if (!node || !node.value) return null
    return JSON.parse(node.value.toString())
  }

  /**
   * List entries from the sync group's view with a prefix
   */
  async list (appId, prefix, opts = {}) {
    // Validate appId
    this._validateAppId(appId)
    const group = this._syncGroups.get(appId)
    if (!group) throw new Error('Sync group not found: ' + appId)

    // Validate limit
    let limit = opts.limit || 100
    if (typeof limit !== 'number' || limit < 1) limit = 100
    if (limit > 1000) limit = 1000 // Max 1000 items

    // Validate prefix
    if (prefix && typeof prefix !== 'string') {
      throw new Error('Invalid prefix')
    }
    if (prefix && prefix.length > 1024) {
      throw new Error('Prefix too long')
    }

    await group.base.view.update()

    const results = []
    const rangeOpts = {}
    if (prefix) {
      rangeOpts.gte = prefix
      rangeOpts.lt = prefix + '\xff'
    }

    for await (const node of group.base.view.createReadStream(rangeOpts)) {
      if (results.length >= limit) break
      try {
        results.push({
          key: node.key,
          value: JSON.parse(node.value.toString())
        })
      } catch (err) {
        console.error('Failed to parse node value:', err.message)
      }
    }

    return results
  }

  /**
   * Get sync group status
   */
  getSyncStatus (appId) {
    // Validate appId
    this._validateAppId(appId)
    const group = this._syncGroups.get(appId)
    if (!group) return null
    return {
      appId,
      inviteKey: group.inviteKey,
      writerCount: group.base.inputs?.length || 1,
      viewLength: group.base.view?.version || 0
    }
  }

  /**
   * POS-compatible apply function — matches sync-apply.js from Pear POS.
   * Handles product:create, product:update, product:delete, transaction:create,
   * config:set, stock:adjust, and more.
   */
  async _defaultApply (batch, view) {
    const b = view.batch({ update: false })

    for (const node of batch) {
      if (!node.value) continue
      let op
      try { op = JSON.parse(node.value.toString()) } catch (err) {
        console.error('Failed to parse operation:', err.message)
        continue
      }
      // Validate operation structure
      if (!op || typeof op !== 'object' || !op.type) {
        console.error('Invalid operation structure')
        continue
      }

      try {
        const k = (...parts) => parts.join('!')
        const enc = (obj) => Buffer.from(JSON.stringify(obj))
        const dec = (n) => n && n.value ? JSON.parse(n.value.toString()) : null

        switch (op.type) {
          case 'product:create': {
            const p = op.data
            await b.put(k('products', p.id), enc(p))
            if (p.barcode) await b.put(k('products-by-barcode', p.barcode), enc(p.id))
            if (p.sku) await b.put(k('products-by-sku', p.sku), enc(p.id))
            if (p.category) await b.put(k('products-by-category', p.category.toLowerCase(), p.id), enc(p.id))
            if (p.name) await b.put(k('products-by-name', p.name.toLowerCase(), p.id), enc(p.id))
            break
          }
          case 'product:update': {
            const { id, updates } = op.data
            const existing = dec(await b.get(k('products', id)))
            if (!existing) break
            const updated = { ...existing, ...updates, id, updated_at: op.timestamp }
            await b.put(k('products', id), enc(updated))
            if (updated.barcode) await b.put(k('products-by-barcode', updated.barcode), enc(id))
            if (updated.sku) await b.put(k('products-by-sku', updated.sku), enc(id))
            break
          }
          case 'product:delete': {
            const { id } = op.data
            const existing = dec(await b.get(k('products', id)))
            if (existing) await b.put(k('products', id), enc({ ...existing, active: false, updated_at: op.timestamp }))
            break
          }
          case 'stock:adjust': {
            const { product_id, delta } = op.data
            const existing = dec(await b.get(k('products', product_id)))
            if (existing) {
              existing.stock = (existing.stock || 0) + delta
              existing.updated_at = op.timestamp
              await b.put(k('products', product_id), enc(existing))
            }
            break
          }
          case 'transaction:create': {
            const tx = op.data
            const ts = tx.created_at || op.timestamp
            await b.put(k('transactions', ts, tx.id), enc(tx))
            await b.put(k('transactions-by-id', tx.id), enc(tx))
            break
          }
          case 'config:set': case 'merchant:register': {
            const existing = dec(await b.get('config!merchant'))
            await b.put('config!merchant', enc({ ...(existing || {}), ...op.data, updated_at: op.timestamp }))
            break
          }
          default: {
            // Generic fallback for unknown op types
            if (op.data && op.data.id) {
              await b.put(k(op.type.replace(':', '!'), op.data.id), enc(op.data))
            }
            break
          }
        }
      } catch (err) {
        console.error('Apply operation failed:', err.message)
      }
    }
    await b.flush()
  }

  async close () {
    for (const [, group] of this._syncGroups) {
      try { await this.swarm.leave(group.topic) } catch (err) {
        console.error('Failed to leave topic:', err.message)
      }
    }
    this._syncGroups.clear()
  }
}

module.exports = { PearBridge }
