/**
 * App Manager
 *
 * Handles installing, uninstalling, and launching P2P apps.
 * Each app is a Hyperdrive that contains HTML/CSS/JS.
 * Installed apps are cached locally for offline access.
 */

const Hyperdrive = require('hyperdrive')
const { getUserFriendlyError } = require('./hyper-proxy')

class AppManager {
  constructor (store, swarm) {
    this.store = store
    this.swarm = swarm
    this.installed = new Map() // appId → { driveKey, name, icon, drive, version }
    this.activeDrives = new Map() // driveKey hex → Hyperdrive
  }

  /**
   * Install an app by downloading its Hyperdrive
   */
  async install (appInfo, onProgress) {
    const { id, driveKey, name, icon, version } = appInfo
    const keyHex = typeof driveKey === 'string' ? driveKey : driveKey.toString('hex')

    // Open the app's Hyperdrive
    const drive = new Hyperdrive(this.store, Buffer.from(keyHex, 'hex'))
    try {
      await drive.ready()
    } catch (err) {
      throw new Error(`Could not load app: ${getUserFriendlyError(err.message)}`)
    }

    // Join swarm to download
    this.swarm.join(drive.discoveryKey, { server: false, client: true })

    // Wait for initial content
    await this._waitForContent(drive, onProgress)

    // Cache the drive reference
    this.activeDrives.set(keyHex, drive)
    this.installed.set(id, {
      driveKey: keyHex,
      name: name || id,
      icon: icon || null,
      version: version || '0.0.0',
      installedAt: Date.now()
    })

    return { id, driveKey: keyHex, name }
  }

  /**
   * Uninstall an app (removes from installed list, closes drive)
   */
  async uninstall (appId) {
    const app = this.installed.get(appId)
    if (!app) return false

    const drive = this.activeDrives.get(app.driveKey)
    if (drive) {
      // Leave swarm first to stop announcing this drive
      try {
        await this.swarm.leave(drive.discoveryKey)
      } catch (err) {
        console.error('Failed to leave swarm:', err.message)
      }
      // Then close the drive
      try {
        await drive.close()
      } catch (err) {
        console.error('Failed to close drive:', err.message)
      }
      this.activeDrives.delete(app.driveKey)
    }

    this.installed.delete(appId)
    return true
  }

  /**
   * Get the Hyperdrive for a launched app (opens if not already)
   */
  async getDrive (driveKeyHex) {
    if (this.activeDrives.has(driveKeyHex)) {
      return this.activeDrives.get(driveKeyHex)
    }

    const drive = new Hyperdrive(this.store, Buffer.from(driveKeyHex, 'hex'))
    try {
      await drive.ready()
    } catch (err) {
      throw new Error(`Could not open site: ${getUserFriendlyError(err.message)}`)
    }
    this.swarm.join(drive.discoveryKey, { server: false, client: true })
    this.activeDrives.set(driveKeyHex, drive)
    return drive
  }

  /**
   * List installed apps
   */
  listInstalled () {
    const apps = []
    for (const [id, info] of this.installed) {
      apps.push({ id, ...info })
    }
    return apps
  }

  /**
   * Check for updates (compare version in catalog with installed)
   */
  async checkUpdates (catalogApps) {
    const updates = []
    for (const [id, installed] of this.installed) {
      const catalogApp = catalogApps.find(a => a.id === id)
      if (catalogApp && catalogApp.version !== installed.version) {
        updates.push({
          id,
          currentVersion: installed.version,
          newVersion: catalogApp.version
        })
      }
    }
    return updates
  }

  async _waitForContent (drive, onProgress) {
    if (drive.version > 0) return

    return new Promise((resolve) => {
      let completed = false

      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          resolve()
        }
      }, 30000)

      let checks = 0
      const check = async () => {
        if (completed) return

        checks++
        if (onProgress) onProgress(Math.min(95, checks * 5))

        const entry = await drive.entry('/index.html').catch(() => null)
        if (entry && !completed) {
          completed = true
          clearTimeout(timeout)
          if (onProgress) onProgress(100)
          resolve()
        } else if (!completed) {
          setTimeout(check, 500)
        }
      }
      check()
    })
  }

  /**
   * Export installed app list for persistence
   */
  export () {
    const out = {}
    for (const [id, info] of this.installed) {
      out[id] = { ...info }
    }
    return out
  }

  /**
   * Import previously persisted app list
   */
  import (data) {
    for (const [id, info] of Object.entries(data)) {
      this.installed.set(id, info)
    }
  }

  async close () {
    for (const [, drive] of this.activeDrives) {
      try { await drive.close() } catch (err) {
        console.error('Failed to close drive:', err.message)
      }
    }
    this.activeDrives.clear()
  }
}

module.exports = { AppManager }
