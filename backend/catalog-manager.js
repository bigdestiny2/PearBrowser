/**
 * Catalog Manager
 *
 * Loads app catalogs from Hyperdrives. A catalog is a Hyperdrive
 * containing catalog.json (the app index) and app metadata/icons.
 *
 * Multiple catalogs can be added (community, private, etc.)
 */

const Hyperdrive = require('hyperdrive')

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
    await drive.ready()

    this.swarm.join(drive.discoveryKey, { server: false, client: true })

    // Wait for data
    await this._waitForData(drive)

    const catalogBuf = await drive.get('/catalog.json')
    if (!catalogBuf) throw new Error('No catalog.json found in drive')

    const data = JSON.parse(catalogBuf.toString())

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
   * Refresh a previously loaded catalog
   */
  async refreshCatalog (keyHex) {
    const entry = this.catalogs.get(keyHex)
    if (!entry) return this.loadCatalog(keyHex)

    const catalogBuf = await entry.drive.get('/catalog.json')
    if (catalogBuf) {
      entry.data = JSON.parse(catalogBuf.toString())
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

  async close () {
    for (const [, entry] of this.catalogs) {
      try { await entry.drive.close() } catch {}
    }
    this.catalogs.clear()
  }
}

module.exports = { CatalogManager }
