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
const b4a = require('b4a')
const { getUserFriendlyError } = require('./hyper-proxy')

// sodium-universal is already in the dependency graph (hyperswarm / autobase /
// identity.js use it). We use it for sha256 + ed25519 detached verify of the
// signed catalog manifest. If it can't load we FAIL CLOSED — no signed bee
// can be trusted without a verifier.
let sodium = null
try { sodium = require('sodium-universal') } catch (_) { /* fail closed below */ }

// The signed-manifest record key. It is exactly two characters: a NUL byte
// followed by the ASCII string "meta". Using String.fromCharCode(0) keeps the
// literal NUL explicit and avoids any source-encoding ambiguity.
const META_KEY = '\x00meta'

// ===========================================================================
// SECURITY-CRITICAL: signed catalog manifest verification (the trust anchor)
// ===========================================================================
//
// The producer (relay) publishes a Hyperbee whose `\x00meta` record holds a
// JSON object `{ ...fields, signature }`. The bee's own 32-byte public key IS
// the publisher's Ed25519 public key (the trust anchor — no separate key is
// fetched or trusted). Verification reconstructs EXACTLY this message and
// checks the detached signature:
//
//   signedMessage = sha256( beeKeyBuf(32) || utf8( canonicalJson(metaSansSig) ) )
//   crypto_sign_verify_detached( signatureBuf, signedMessage, beeKeyBuf )
//
// where:
//   - beeKeyBuf            = the bee's 32-byte public key (== publisher pubkey)
//   - metaSansSig          = the meta object with the `signature` field removed
//   - canonicalJson(obj)   = deterministic JSON: object keys recursively SORTED,
//                            compact (no extra whitespace), via JSON.stringify
//   - utf8(...)            = UTF-8 bytes of that canonical JSON string
//   - sha256(...)          = 32-byte SHA-256 digest of the concatenation
//   - signatureBuf         = Buffer.from(meta.signature, 'hex')  (64 bytes)
//
// If ANYTHING is wrong (sodium missing, meta missing, signature absent or the
// wrong length, digest/verify mismatch) we return a falsy verdict so the
// caller rejects the whole bee and falls back to HTTP. FAIL CLOSED.
//
// ⚠ This construction must byte-match the relay producer's signing script.
//   If the relay rejects, diff against the producer using the formula above.

/**
 * Deterministic ("canonical") JSON serialization.
 *
 * Recursively sorts object keys and emits compact JSON (no spaces). Arrays
 * keep their order (order is meaningful in arrays). Primitives serialize as
 * normal JSON. The output is byte-stable regardless of key insertion order,
 * which is what makes the signature reproducible on both ends.
 */
function canonicalJson (value) {
  return JSON.stringify(canonicalize(value))
}

function canonicalize (value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key])
    }
    return out
  }
  return value
}

function scrubPrototypeKeys (value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)

  for (const key of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) delete value[key]
  }

  if (Array.isArray(value)) {
    for (const item of value) scrubPrototypeKeys(item, seen)
    return value
  }

  for (const key of Object.keys(value)) scrubPrototypeKeys(value[key], seen)
  return value
}

function catalogAppsFromEnvelope (catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return []
  if (Array.isArray(catalog.apps)) return catalog.apps
  if (Array.isArray(catalog.items)) return catalog.items
  if (Array.isArray(catalog.entries)) return catalog.entries
  return []
}

const HEX64_RE = /^[0-9a-f]{64}$/i
const Z32_RE = /^[13-9a-km-uw-z]{52}$/i
const APP_LINK_RE = /^(?:hyper|pear|file):\/\/.+/i

function trimString (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function hexFromZ32 (value) {
  try {
    const z32 = require('z32')
    const buf = z32.decode(String(value || '').toLowerCase())
    return buf && buf.length === 32 ? Buffer.from(buf).toString('hex') : ''
  } catch {
    return ''
  }
}

function normalizeDriveKey (raw) {
  const s = trimString(raw)
  if (!s) return ''
  const target = /^hyper:\/\//i.test(s)
    ? s.replace(/^hyper:\/\//i, '').split(/[/?#]/)[0].trim()
    : s
  if (HEX64_RE.test(target)) return target.toLowerCase()
  if (Z32_RE.test(target)) return hexFromZ32(target)
  return ''
}

function driveKeyFromHyperLink (raw) {
  const s = trimString(raw)
  if (!/^hyper:\/\//i.test(s)) return ''
  return normalizeDriveKey(s)
}

function normalizeCatalogLink (raw) {
  const s = trimString(raw)
  if (!s) return ''
  const normalized = s.replace(/^([a-z][a-z0-9+.-]*):\/\//i, (_, scheme) => scheme.toLowerCase() + '://')
  return APP_LINK_RE.test(normalized) ? normalized : ''
}

function normalizeCategories (categories) {
  if (!Array.isArray(categories)) return []
  return categories
    .map((category) => String(category || '').trim())
    .filter(Boolean)
    .slice(0, 32)
}

function normalizeCatalogApp (app) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) return null
  const out = scrubPrototypeKeys({ ...app })
  const key = trimString(out.driveKey) || trimString(out.appKey) || trimString(out.key)
  const rawLink = trimString(out.link)
  const link = normalizeCatalogLink(rawLink)
  const driveKey = normalizeDriveKey(key) || driveKeyFromHyperLink(link)
  const id = trimString(out.id) || driveKey || link
  if ((key && !driveKey && !link) || (rawLink && !link && !driveKey) || (!driveKey && !link) || !id) return null

  out.id = id
  out.name = trimString(out.name) || trimString(out.title) || id
  if (driveKey) out.driveKey = driveKey
  else delete out.driveKey
  if (link) out.link = link
  else delete out.link
  out.description = trimString(out.description)
  out.author = trimString(out.author)
  out.version = out.version == null ? '' : String(out.version).trim()
  out.categories = normalizeCategories(out.categories)
  return out
}

function catalogAppSearchText (app) {
  if (!app || typeof app !== 'object') return ''
  const fields = [
    app.name,
    app.description,
    app.author,
    app.id,
    app.version,
    app.source,
    app.catalogName,
    app.verification,
    app.link,
    app.driveKey,
    ...(Array.isArray(app.categories) ? app.categories : []),
  ]
  return fields
    .filter((value) => value != null && value !== '')
    .map((value) => String(value).normalize('NFKC').toLowerCase())
    .join(' ')
}

function normalizeCatalogData (catalog) {
  const data = scrubPrototypeKeys(catalog && typeof catalog === 'object' && !Array.isArray(catalog)
    ? catalog
    : {})
  const apps = catalogAppsFromEnvelope(data)
    .map(normalizeCatalogApp)
    .filter(Boolean)
  return { ...data, apps }
}

/** SHA-256 digest (32 bytes) of a Buffer/Uint8Array, via sodium-universal. */
function sha256 (input) {
  const out = b4a.alloc(sodium.crypto_hash_sha256_BYTES)
  sodium.crypto_hash_sha256(out, input)
  return out
}

/**
 * Build the exact 32-byte message that is signed/verified for a given
 * (beeKeyBuf, metaSansSig) pair. Exported so the test can sign with the same
 * bytes the consumer verifies. See the block comment above for the formula.
 */
function buildSignedDigest (beeKeyBuf, metaWithoutSignature) {
  const canonical = canonicalJson(metaWithoutSignature)
  const message = b4a.concat([
    beeKeyBuf,                       // 32-byte bee/publisher public key
    b4a.from(canonical, 'utf-8'),    // UTF-8 bytes of canonical JSON
  ])
  return sha256(message)
}

/**
 * Verify a signed catalog manifest.
 *
 * @param {Buffer|Uint8Array} beeKeyBuf  the bee's 32-byte public key (trust anchor)
 * @param {object} meta                  the parsed `\x00meta` value: { ...fields, signature }
 * @returns {boolean} true ONLY if the signature is valid for this exact meta + key.
 *
 * FAIL CLOSED on every error path.
 */
function verifyCatalogMeta (beeKeyBuf, meta, signerKeyBuf = beeKeyBuf) {
  try {
    if (!sodium) return false
    if (!beeKeyBuf || beeKeyBuf.length !== sodium.crypto_sign_PUBLICKEYBYTES) return false
    if (!signerKeyBuf || signerKeyBuf.length !== sodium.crypto_sign_PUBLICKEYBYTES) return false
    if (!meta || typeof meta !== 'object') return false
    if (typeof meta.signature !== 'string' || meta.signature.length === 0) return false

    const signatureBuf = b4a.from(meta.signature, 'hex')
    if (signatureBuf.length !== sodium.crypto_sign_BYTES) return false

    // Strip the signature field, sign over everything else canonically.
    const metaWithoutSignature = { ...meta }
    delete metaWithoutSignature.signature

    // The digest is anchored to beeKeyBuf — the bee's KEY, the user's trust
    // anchor — so a signature can never be replayed onto a different catalog.
    // The signature is VERIFIED with signerKeyBuf, which differs from the key on
    // hypercore-11 manifest cores: there core.key is a manifest HASH, and the
    // actual Ed25519 writer lives in core.manifest.signers[]. core.key
    // cryptographically commits to that manifest (key === hash(manifest)), so
    // trusting the manifest signer is equivalent to trusting core.key. For
    // classic `compat` cores (core.key === signer pubkey) signerKeyBuf defaults
    // to beeKeyBuf, preserving the original v0 behaviour exactly.
    const digest = buildSignedDigest(beeKeyBuf, metaWithoutSignature)
    return sodium.crypto_sign_verify_detached(signatureBuf, digest, signerKeyBuf)
  } catch (_) {
    return false
  }
}

/**
 * Resolve the Ed25519 key that actually SIGNS a bee, given a ready hypercore.
 * Classic/`compat` core → core.key is the signer. Single-signer manifest core →
 * the writer in core.manifest.signers[0] (bound to core.key by key===hash(manifest)).
 * Returns null for multi-signer / unrecognized manifests so the caller fails closed.
 */
function resolveSignerKey (core, beeKeyBuf) {
  try {
    const signers = core && core.manifest && core.manifest.signers
    if (!Array.isArray(signers)) return beeKeyBuf // classic core: key IS the signer
    if (signers.length !== 1) return null // multi-sig not supported here — fail closed
    const pk = signers[0] && signers[0].publicKey
    if (!pk || pk.length !== sodium.crypto_sign_PUBLICKEYBYTES) return null
    return b4a.from(pk)
  } catch (_) {
    return null
  }
}

/**
 * Read + verify + scan a (replicated) signed catalog bee.
 *
 * Pure with respect to networking — it only reads from the supplied Hyperbee,
 * so the unit test can drive it against an in-memory bee. Replication is the
 * caller's job (loadSignedCatalogBee does swarm.join + store.replicate).
 *
 * @param {Hyperbee} bee  a ready Hyperbee (keyEncoding utf-8, valueEncoding json)
 * @param {Buffer|Uint8Array} beeKeyBuf  the bee's 32-byte public key
 * @returns {Promise<{ ok: boolean, reason?: string, meta?: object, entries?: object[] }>}
 *
 * FAIL CLOSED: if `\x00meta` is missing or its signature does not verify we
 * return { ok: false } and NO entries — never partial trust.
 */
async function verifyAndScanCatalogBee (bee, beeKeyBuf, signerKeyBuf = beeKeyBuf) {
  // 1. Read the signed manifest. Missing → reject.
  const metaNode = await bee.get(META_KEY).catch(() => null)
  if (!metaNode || metaNode.value == null || typeof metaNode.value !== 'object') {
    return { ok: false, reason: 'missing-meta' }
  }
  const meta = metaNode.value

  // 2. Verify the Ed25519 signature. Digest anchored to beeKeyBuf (the trust
  // anchor); signature checked against signerKeyBuf (== beeKeyBuf for classic
  // cores, the manifest writer for manifest cores — see verifyCatalogMeta).
  if (!signerKeyBuf || !verifyCatalogMeta(beeKeyBuf, meta, signerKeyBuf)) {
    return { ok: false, reason: 'bad-signature' }
  }

  // 3. Scan every key OTHER than `\x00meta` → catalog entries.
  //    `\x00meta` sorts before any printable appKey (NUL = 0x00), so a forward
  //    range scan starting just after it naturally excludes it; we also guard
  //    explicitly in case a producer ever uses keys < the meta key.
  const entries = []
  for await (const node of bee.createReadStream()) {
    if (node.key === META_KEY) continue
    if (node.value && typeof node.value === 'object') {
      entries.push(node.value)
    }
  }

  return { ok: true, meta, entries }
}

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
    const data = normalizeCatalogData(this._safeJSONParse(catalogBuf.toString()))

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
    keyHex = String(keyHex || '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(keyHex)) {
      throw new Error('Invalid catalog bee key')
    }
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
        const app = normalizeCatalogApp(entry.value)
        if (app) apps.push(app)
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

  /**
   * Load a SIGNED P2P catalog bee, the consumer side of the relay's
   * `catalogBeeKey` feature.
   *
   * The relay publishes a Hyperbee, pins + announces it, and advertises its
   * 64-hex key in `/catalog.json` as `catalogBeeKey`. We:
   *   1. open the bee on that key over the worklet's Corestore + Hyperswarm,
   *   2. replicate it (the relay is announcing as server, so peers are found),
   *   3. VERIFY the signed `\x00meta` manifest against the bee's own pubkey
   *      (the trust anchor) — FAIL CLOSED if missing/invalid,
   *   4. scan every non-`\x00meta` key into catalog entries,
   *   5. subscribe to `append` so live producer updates re-verify + re-scan.
   *
   * Returns the same shape ExploreScreen renders ({ apps, name, ... }).
   * Throws on verify failure so the caller falls back to HTTP.
   *
   * @param {string} keyHex            64-hex bee public key (== publisher pubkey)
   * @param {function} [onUpdate]      called with fresh `data` when the bee appends
   */
  async loadSignedCatalogBee (keyHex, onUpdate) {
    keyHex = String(keyHex || '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(keyHex)) {
      throw new Error('Invalid catalog bee key')
    }
    const cacheKey = `signed-bee:${keyHex}`
    const cached = this.catalogs.get(cacheKey)
    if (cached) {
      if (onUpdate) cached.onUpdate = onUpdate
      return cached.data
    }

    const beeKeyBuf = b4a.from(keyHex, 'hex')

    // --- 2. Replicate the bee over Corestore + Hyperswarm ---
    // MUST match the producer's encodings (utf-8 keys, json values).
    const core = this.store.get({ key: beeKeyBuf })
    await core.ready().catch((err) => {
      throw new Error(`Could not open catalog bee: ${getUserFriendlyError(err && err.message)}`)
    })

    // Join the bee's discovery topic as a client. The worklet's swarm
    // 'connection' handler already calls store.replicate(conn) for every peer
    // (see backend/index.js boot()), so cores in this store replicate
    // automatically — we only need to be on the topic to find the relay.
    this.swarm.join(core.discoveryKey, { server: false, client: true })

    const bee = new Hyperbee(core, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    })
    await bee.ready()

    // Pull length from peers before reading. update() resolves once we've
    // synced the latest known length (or immediately if already current).
    await bee.core.update().catch(() => {})

    // Wait briefly for the signed manifest to actually replicate in.
    await this._waitForMeta(bee, 15000).catch(() => {})

    // Resolve the signing key. For a manifest core (corestore's default) core.key
    // is a hash and the writer lives in core.manifest.signers[]; hypercore has
    // already verified key === hash(manifest) on replication, so the signer is
    // bound to the trust anchor. For classic compat cores this is core.key itself.
    const signerKeyBuf = resolveSignerKey(core, beeKeyBuf)

    // --- 3 + 4. Verify the signed manifest, then scan entries ---
    const result = await verifyAndScanCatalogBee(bee, beeKeyBuf, signerKeyBuf)
    if (!result.ok) {
      // FAIL CLOSED. Leave the topic so we don't keep an unverifiable bee live.
      try { await this.swarm.leave(core.discoveryKey) } catch (_) {}
      try { await bee.close() } catch (_) {}
      throw new Error(
        result.reason === 'missing-meta'
          ? 'Catalog bee is missing its signed manifest (\\x00meta) — rejected'
          : 'Catalog bee signature verification failed — rejected'
      )
    }

    const data = this._buildSignedCatalogData(keyHex, result)

    const entry = { bee, core, data, lastRefresh: Date.now(), type: 'signed-bee', onUpdate, beeKeyBuf }
    this.catalogs.set(cacheKey, entry)

    // --- 5. Live updates: re-verify + re-scan whenever the producer appends ---
    const onAppend = async () => {
      try {
        const fresh = await verifyAndScanCatalogBee(bee, beeKeyBuf, signerKeyBuf)
        if (!fresh.ok) {
          // A producer can never legitimately publish an unverifiable update.
          // Keep the last-good data; surface nothing rather than trust it.
          console.warn('[catalog] signed bee append failed verification — keeping previous data')
          return
        }
        entry.data = this._buildSignedCatalogData(keyHex, fresh)
        entry.lastRefresh = Date.now()
        if (typeof entry.onUpdate === 'function') entry.onUpdate(entry.data)
      } catch (err) {
        console.warn('[catalog] signed bee append handler error:', err && err.message)
      }
    }
    entry.onAppend = onAppend
    bee.core.on('append', onAppend)

    return data
  }

  _buildSignedCatalogData (keyHex, result) {
    const meta = result.meta || {}
    const apps = result.entries
      .map(normalizeCatalogApp)
      .filter(Boolean)
    return {
      version: meta.version != null ? meta.version : 1,
      name: meta.name || 'P2P Catalog',
      source: 'signed-hyperbee',
      sourceKey: keyHex,
      verified: true,
      meta,
      apps,
      count: { total: apps.length, apps: apps.length },
    }
  }

  /** Wait until the `\x00meta` record is readable (or timeout). */
  async _waitForMeta (bee, timeoutMs = 15000) {
    const existing = await bee.get(META_KEY).catch(() => null)
    if (existing) return
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      const check = async () => {
        const node = await bee.get(META_KEY).catch(() => null)
        if (node) { clearTimeout(timer); resolve() }
        else setTimeout(check, 400)
      }
      check()
    })
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
      entry.data = normalizeCatalogData(this._safeJSONParse(catalogBuf.toString()))
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
      const catalogApps = catalogAppsFromEnvelope(entry.data)
      if (catalogApps.length > 0) {
        for (const rawApp of catalogApps) {
          const app = normalizeCatalogApp(rawApp)
          if (!app) continue
          apps.push({ ...app, catalogKey })
        }
      }
    }
    return apps
  }

  /**
   * Search apps by the same user-visible catalogue metadata desktop uses.
   */
  searchApps (query) {
    const q = String(query || '').normalize('NFKC').trim().toLowerCase()
    if (!q) return this.getAllApps()
    return this.getAllApps().filter(app => catalogAppSearchText(app).includes(q))
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
    return scrubPrototypeKeys(JSON.parse(str))
  }

  async close () {
    for (const [, entry] of this.catalogs) {
      try {
        if (entry.onAppend && entry.bee && entry.bee.core) {
          entry.bee.core.removeListener('append', entry.onAppend)
        }
      } catch {}
      try { if (entry.drive) await entry.drive.close() } catch {}
      try { if (entry.bee) await entry.bee.close() } catch {}
    }
    this.catalogs.clear()
  }
}

module.exports = {
  CatalogManager,
  // Exported for unit tests + reuse — the trust-anchor primitives.
  canonicalJson,
  scrubPrototypeKeys,
  catalogAppsFromEnvelope,
  catalogAppSearchText,
  normalizeCatalogApp,
  normalizeCatalogData,
  sha256,
  buildSignedDigest,
  verifyCatalogMeta,
  verifyAndScanCatalogBee,
  resolveSignerKey,
  META_KEY,
}
