/**
 * Catalog Manager
 *
 * Loads app catalogs from Hyperdrives. A catalog is a Hyperdrive
 * containing catalog.json (the app index) and app metadata/icons.
 *
 * Multiple catalogs can be added (community, private, etc.)
 */

const Hyperdrive = require('hyperdrive')
const Hyperbee = require('hyperbee')
const { getUserFriendlyError } = require('./hyper-proxy')

class CatalogManager {
  constructor (store, swarm) {
    this.store = store
    this.swarm = swarm
    this.catalogs = new Map() // catalogKey hex → { drive, data, lastRefresh }
  }

  /**
   * Load a catalog from a Hyperdrive key
   */
  async loadCatalog (keyHex) {
    if (this.catalogs.has(keyHex)) {
      return this.catalogs.get(keyHex).data
    }

    const drive = new Hyperdrive(this.store, Buffer.from(keyHex, 'hex'))
    try {
      await drive.ready()
    } catch (err) {
      throw new Error(`Could not load the app store: ${getUserFriendlyError(err.message)}`)
    }

    this.swarm.join(drive.discoveryKey, { server: false, client: true })

    // Wait for data
    await this._waitForData(drive)

    const catalogBuf = await drive.get('/catalog.json')
    if (!catalogBuf) throw new Error(getUserFriendlyError('No catalog.json found'))

    // SECURITY: Parse JSON with prototype pollution protection
    const data = this._safeJSONParse(catalogBuf.toString())

    // Load icons for each app
    if (data.apps) {
      for (const app of data.apps) {
        if (app.icon) {
          const iconBuf = await drive.get(app.icon).catch(() => null)
          if (iconBuf) {
            app.iconData = 'data:image/png;base64,' + iconBuf.toString('base64')
          }
        }
      }
    }

    this.catalogs.set(keyHex, { drive, data, lastRefresh: Date.now() })
    return data
  }

  /**
   * Load a catalog that's published as a Hyperbee rather than a Hyperdrive.
   *
   * Phase 1 ticket 1 of the Holepunch alignment plan. This is the canonical
   * Pear-native catalog format: an append-only, signed key/value store
   * replicated over Hyperswarm. Anyone with the public key can subscribe.
   *
   * The relay doesn't publish one yet (see docs/RELAY_CATALOG_POPULATION.md)
   * but the browser side is ready for when it does. The returned shape
   * matches `loadCatalog` so ExploreScreen treats them identically.
   *
   * Key format inside the Hyperbee:
   *   `app!<id>` → { id, name, description, driveKey, version, author, categories, publishedAt }
   *   `meta!version` → 1
   *   `meta!name` → string
   */
  async loadCatalogBee (keyHex) {
    const cacheKey = `bee:${keyHex}`
    if (this.catalogs.has(cacheKey)) {
      return this.catalogs.get(cacheKey).data
    }

    const core = this.store.get(Buffer.from(keyHex, 'hex'))
    await core.ready().catch((err) => {
      throw new Error(`Could not open catalog hypercore: ${getUserFriendlyError(err && err.message)}`)
    })
    this.swarm.join(core.discoveryKey, { server: false, client: true })

    const bee = new Hyperbee(core, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    })
    await bee.ready()

    // Wait briefly for initial replication — same pattern as _waitForData
    await this._waitForBeeData(bee, 15000).catch(() => {})

    const apps = []
    try {
      for await (const entry of bee.createReadStream({ gte: 'app!', lt: 'app!~' })) {
        if (entry.value && typeof entry.value === 'object') {
          apps.push(entry.value)
        }
      }
    } catch (err) {
      throw new Error(`Could not read catalog Hyperbee: ${getUserFriendlyError(err && err.message)}`)
    }

    // Load meta if present
    const nameEntry = await bee.get('meta!name').catch(() => null)
    const versionEntry = await bee.get('meta!version').catch(() => null)

    const data = {
      version: versionEntry ? versionEntry.value : 1,
      name: nameEntry ? nameEntry.value : 'P2P Catalog',
      source: 'hyperbee',
      sourceKey: keyHex,
      apps,
      count: { total: apps.length, apps: apps.length },
    }

    this.catalogs.set(cacheKey, { bee, data, lastRefresh: Date.now(), type: 'hyperbee' })
    return data
  }

  async _waitForBeeData (bee, timeoutMs = 15000) {
    // Wait for at least one entry or timeout
    if (bee.version > 1) return
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      const check = async () => {
        try {
          let found = false
          for await (const _ of bee.createReadStream({ gte: 'app!', lt: 'app!~', limit: 1 })) {
            found = true
            break
          }
          if (found) { clearTimeout(timer); resolve() }
          else setTimeout(check, 500)
        } catch {
          setTimeout(check, 500)
        }
      }
      check()
    })
  }

  /**
   * Refresh a previously loaded catalog
   */
  async refreshCatalog (keyHex) {
    const entry = this.catalogs.get(keyHex)
    if (!entry) return this.loadCatalog(keyHex)

    const catalogBuf = await entry.drive.get('/catalog.json')
    if (catalogBuf) {
      entry.data = this._safeJSONParse(catalogBuf.toString())
      entry.lastRefresh = Date.now()
    }
    return entry.data
  }

  /**
   * Get all apps across all loaded catalogs
   */
  getAllApps () {
    const apps = []
    for (const [catalogKey, entry] of this.catalogs) {
      if (entry.data && entry.data.apps) {
        for (const app of entry.data.apps) {
          apps.push({ ...app, catalogKey })
        }
      }
    }
    return apps
  }

  /**
   * Search apps by name or description
   */
  searchApps (query) {
    const q = query.toLowerCase()
    return this.getAllApps().filter(app =>
      app.name.toLowerCase().includes(q) ||
      (app.description && app.description.toLowerCase().includes(q))
    )
  }

  async _waitForData (drive) {
    if (drive.version > 0) return
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, 15000)
      const check = async () => {
        const entry = await drive.entry('/catalog.json').catch(() => null)
        if (entry) { clearTimeout(timeout); resolve() }
        else setTimeout(check, 300)
      }
      check()
    })
  }

  /**
   * Parse JSON safely with prototype pollution protection
   */
  _safeJSONParse (str) {
    const obj = JSON.parse(str)
    if (obj && typeof obj === 'object') {
      // Remove dangerous prototype properties
      delete obj.__proto__
      delete obj.constructor
      // Also check nested objects
      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          delete obj[key].__proto__
          delete obj[key].constructor
        }
      }
    }
    return obj
  }

  async close () {
    for (const [, entry] of this.catalogs) {
      try { await entry.drive.close() } catch {}
    }
    this.catalogs.clear()
  }
}

module.exports = { CatalogManager }
