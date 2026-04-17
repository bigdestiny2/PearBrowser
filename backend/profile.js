/**
 * Profile — the user's self-declared identity attributes.
 *
 * Phase B of the identity plan. A Hyperbee inside the user's Corestore
 * storing profile fields (display name, avatar, bio, email, etc.) and
 * per-app grants that let apps read specific fields.
 *
 * Only the "browser" context (`pear://browser/profile`) can WRITE to
 * the profile. Catalogue apps READ the profile only through the
 * `pear.login()` consent ceremony (Phase C), and only the fields the
 * user has explicitly granted.
 *
 * Data layout:
 *   profile!displayName      "Maya"
 *   profile!avatar           "hyper://.../avatar.png"
 *   profile!bio              "P2P enthusiast"
 *   profile!email            "maya@example.com"
 *
 *   grant!<driveKeyHex>      { scopes: [...], grantedAt, expiresAt, appName }
 */

const Hyperbee = require('hyperbee')

const PROFILE_FIELDS = new Set([
  'displayName',
  'avatar',
  'bio',
  'email',
  'pronouns',
  'location',
  'website',
])

class Profile {
  constructor (store) {
    if (!store) throw new Error('Profile requires a Corestore')
    this.store = store
    this._bee = null
    this._ready = false
  }

  async ready () {
    if (this._ready) return
    const core = this.store.get({ name: 'pearbrowser-profile-v1' })
    this._bee = new Hyperbee(core, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    })
    await this._bee.ready()
    this._ready = true
  }

  _requireReady () {
    if (!this._ready) throw new Error('Profile not ready — call ready() first')
  }

  // ---- Profile fields ----

  async getAll () {
    this._requireReady()
    const out = {}
    for await (const entry of this._bee.createReadStream({ gte: 'profile!', lt: 'profile!~' })) {
      const field = entry.key.slice('profile!'.length)
      if (PROFILE_FIELDS.has(field)) out[field] = entry.value
    }
    return out
  }

  async get (field) {
    this._requireReady()
    if (!PROFILE_FIELDS.has(field)) return null
    const entry = await this._bee.get('profile!' + field)
    return entry ? entry.value : null
  }

  async update (updates) {
    this._requireReady()
    if (!updates || typeof updates !== 'object') return {}
    for (const [field, value] of Object.entries(updates)) {
      if (!PROFILE_FIELDS.has(field)) continue
      if (value === null || value === undefined || value === '') {
        await this._bee.del('profile!' + field)
      } else if (typeof value === 'string' && value.length <= 2048) {
        await this._bee.put('profile!' + field, value)
      }
    }
    return this.getAll()
  }

  async clear () {
    this._requireReady()
    for (const field of PROFILE_FIELDS) {
      await this._bee.del('profile!' + field).catch(() => {})
    }
  }

  // ---- Grants (what apps can see what) ----

  /**
   * Record a user's grant to a specific app. Called from the consent
   * ceremony in backend/index.js after the user approves `pear.login()`.
   */
  async setGrant (driveKeyHex, grant) {
    this._requireReady()
    if (typeof driveKeyHex !== 'string' || driveKeyHex.length === 0) {
      throw new Error('driveKeyHex required')
    }
    const record = {
      scopes: Array.isArray(grant.scopes) ? grant.scopes.map(String) : [],
      appName: typeof grant.appName === 'string' ? grant.appName.slice(0, 128) : null,
      grantedAt: Date.now(),
      expiresAt: typeof grant.expiresAt === 'number' ? grant.expiresAt : (Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
    await this._bee.put('grant!' + driveKeyHex, record)
    return record
  }

  async getGrant (driveKeyHex) {
    this._requireReady()
    const entry = await this._bee.get('grant!' + driveKeyHex)
    if (!entry) return null
    const grant = entry.value
    if (grant.expiresAt && grant.expiresAt < Date.now()) {
      await this._bee.del('grant!' + driveKeyHex).catch(() => {})
      return null
    }
    return grant
  }

  async listGrants () {
    this._requireReady()
    const out = []
    const now = Date.now()
    for await (const entry of this._bee.createReadStream({ gte: 'grant!', lt: 'grant!~' })) {
      const driveKeyHex = entry.key.slice('grant!'.length)
      const grant = entry.value
      if (grant.expiresAt && grant.expiresAt < now) {
        await this._bee.del(entry.key).catch(() => {})
        continue
      }
      out.push({ driveKeyHex, ...grant })
    }
    return out
  }

  async revokeGrant (driveKeyHex) {
    this._requireReady()
    await this._bee.del('grant!' + driveKeyHex).catch(() => {})
  }

  async revokeAllGrants () {
    this._requireReady()
    const keys = []
    for await (const entry of this._bee.createReadStream({ gte: 'grant!', lt: 'grant!~' })) {
      keys.push(entry.key)
    }
    for (const key of keys) await this._bee.del(key).catch(() => {})
    return keys.length
  }

  /**
   * Return the subset of the user's profile that the app at driveKeyHex
   * is currently allowed to read. Filters by the app's grant scopes.
   *
   * Scope mapping:
   *   profile:read         → all PROFILE_FIELDS
   *   profile:name         → displayName + avatar
   *   profile:contact      → email + website
   *
   * Apps that have no grant receive `null`.
   */
  async getVisibleProfile (driveKeyHex) {
    this._requireReady()
    const grant = await this.getGrant(driveKeyHex)
    if (!grant) return null

    const scopes = new Set(grant.scopes)
    const all = await this.getAll()
    const visible = {}

    if (scopes.has('profile:read')) {
      for (const [k, v] of Object.entries(all)) visible[k] = v
    } else {
      if (scopes.has('profile:name')) {
        if (all.displayName) visible.displayName = all.displayName
        if (all.avatar) visible.avatar = all.avatar
      }
      if (scopes.has('profile:contact')) {
        if (all.email) visible.email = all.email
        if (all.website) visible.website = all.website
      }
    }
    return visible
  }

  async close () {
    if (this._bee) {
      try { await this._bee.close() } catch (_) {}
      this._bee = null
    }
    this._ready = false
  }
}

module.exports = { Profile, PROFILE_FIELDS: Array.from(PROFILE_FIELDS) }
