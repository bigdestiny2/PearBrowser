/**
 * Identity — user's root keypair with BIP-39 seed phrase backup.
 *
 * Phase 1 ticket 3 of the Holepunch alignment plan. Matches the Keet-style
 * identity model: one root keypair per user that can be exported as a seed
 * phrase and restored on a new device.
 *
 * Storage:
 *   - The entropy (raw 16/32 bytes for BIP-39 128/256-bit) is persisted at
 *     `<storagePath>/identity.json`. Not encrypted at rest — we're inside
 *     the app's sandbox. A future improvement is to use the OS keystore.
 *   - The derived keypair is ed25519 (matches noise-curve25519 / Hyperswarm
 *     keypair shape).
 *
 * BIP-39 layer:
 *   - Fresh identities use 256-bit entropy → 24-word mnemonic.
 *   - Holepunch's bip39-mnemonic provides checksum validation and the real
 *     PBKDF2-HMAC-SHA512 seed path, so phrases are portable to standard tools.
 *   - Legacy 12-word BIP-39 phrases can still be restored, but new identities
 *     and device-link transfers are 24-word / 32-byte only.
 */

const fs = require('bare-fs')
const path = require('bare-path')
const crypto = require('bare-crypto')
const b4a = require('b4a')
const bip39 = require('bip39-mnemonic')

// sodium-universal is already in the dependency graph via hyperswarm /
// autobase. We use it for ed25519 detached signing so pages can sign
// arbitrary payloads with the user's root identity.
let sodium = null
try { sodium = require('sodium-universal') } catch (_) { /* optional */ }

// --- BIP-39 helpers (standards-compliant, via Holepunch bip39-mnemonic) ------
//
// Thin wrappers so the rest of the file (and external importers) keep the same
// names, but every call now routes through the canonical BIP-39 implementation
// used by Keet/keet-identity-key. Mnemonics interoperate with any BIP-39 tool.

function entropyToMnemonic (entropyBytes) {
  if (!b4a.isBuffer(entropyBytes) && !(entropyBytes instanceof Uint8Array)) {
    throw new TypeError('entropy must be a Buffer/Uint8Array')
  }
  return bip39.entropyToMnemonic(b4a.from(entropyBytes))
}

function mnemonicToEntropy (mnemonic) {
  if (typeof mnemonic !== 'string') throw new TypeError('mnemonic must be a string')
  // bip39-mnemonic normalizes + validates the checksum, throwing on a bad phrase.
  return b4a.from(bip39.mnemonicToEntropy(mnemonic))
}

function validateMnemonic (mnemonic) {
  try { return bip39.validateMnemonic(mnemonic) } catch (_) { return false }
}

/**
 * Derive the 32-byte ed25519 seed from BIP-39 entropy — the REAL BIP-39 path:
 * entropy → mnemonic → PBKDF2-HMAC-SHA512 → 64-byte seed, of which we take the
 * first 32 bytes as the ed25519 / Corestore-namespace seed.
 *
 * ASYNC (PBKDF2 is intentionally slow). Callers cache the result on this._seed
 * so getSeed()/getAppKeypair()/sign() stay synchronous once ready() resolves.
 */
async function entropyToSeed (entropyBytes) {
  const mnemonic = bip39.entropyToMnemonic(b4a.from(entropyBytes))
  const seed = await bip39.mnemonicToSeed(mnemonic)
  return b4a.from(seed).slice(0, 32)
}

// --- Identity manager ---

class Identity {
  constructor (storagePath) {
    if (!storagePath) throw new Error('Identity requires a storagePath')
    this.storagePath = storagePath
    this.file = path.join(storagePath, 'identity.json')
    this._entropy = null
    this._seed = null
  }

  /**
   * Load or generate the user's identity.
   * On first run: generates fresh 32-byte entropy and persists.
   * On subsequent runs: loads the saved entropy.
   */
  async ready () {
    try {
      const raw = fs.readFileSync(this.file, 'utf-8')
      const data = JSON.parse(raw)
      if (data && typeof data.entropy === 'string') {
        this._entropy = b4a.from(data.entropy, 'hex')
        if (this._entropy.length !== 16 && this._entropy.length !== 32) {
          throw new Error('Persisted entropy has invalid length')
        }
        this._seed = await entropyToSeed(this._entropy)
        return
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn('[Identity] load failed, regenerating:', err.message)
      }
    }
    // Generate fresh 256-bit entropy (24-word mnemonic — the Keet standard).
    this._entropy = crypto.randomBytes(32)
    this._seed = await entropyToSeed(this._entropy)
    this._persist()
  }

  _persist () {
    try {
      if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true })
    } catch (_) {}
    const payload = {
      version: 1,
      entropy: b4a.toString(this._entropy, 'hex'),
      createdAt: Date.now(),
    }
    fs.writeFileSync(this.file, JSON.stringify(payload))
  }

  /** Raw seed bytes (32 bytes). Pass into Corestore.namespace(seed). */
  getSeed () {
    if (!this._seed) throw new Error('Identity not ready')
    return this._seed
  }

  /** Raw entropy bytes (16 or 32 bytes). */
  getEntropy () {
    if (!this._entropy) throw new Error('Identity not ready')
    return b4a.from(this._entropy)
  }

  /** 24-word mnemonic backup phrase for fresh identities; legacy 12-word phrases restore. */
  getMnemonic () {
    if (!this._entropy) throw new Error('Identity not ready')
    return entropyToMnemonic(this._entropy)
  }

  /** Corestore primary key, with a deterministic legacy fallback for older stores. */
  getPublicKeyHex (corestore) {
    if (corestore && corestore.primaryKey) {
      return b4a.toString(corestore.primaryKey, 'hex')
    }
    // Fallback: hash of the seed
    return b4a.toString(crypto.createHash('sha256').update(this._seed).digest(), 'hex')
  }

  /**
   * Derive the ROOT ed25519 keypair from the seed. Cached. Returns
   * `{ publicKey: Buffer(32), secretKey: Buffer(64) }`.
   *
   * The root keypair NEVER leaves the worklet. Pages interact via
   * per-app sub-keypairs (see getAppKeypair()) — that's what they
   * see and sign with.
   */
  getSigningKeypair () {
    if (this._keypair) return this._keypair
    if (!sodium) throw new Error('sodium-universal not available — ed25519 signing disabled')
    if (!this._seed) throw new Error('Identity not ready')

    const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_seed_keypair(publicKey, secretKey, this._seed)
    this._keypair = { publicKey, secretKey }
    return this._keypair
  }

  /**
   * Derive a deterministic per-app ed25519 sub-keypair from the root
   * seed + drive key. Same user + same app = same pubkey, forever,
   * across all devices that share the root seed — but different apps
   * see DIFFERENT pubkeys for the same user, so apps can't correlate
   * users across each other without explicit consent.
   *
   * Derivation:  subSeed = SHA-256(rootSeed || "pear-app-v1:" || driveKey)
   *              (subPub, subPriv) = ed25519.seed_keypair(subSeed)
   *
   * `driveKeyHex` is the hex-encoded 32-byte Hyperdrive key of the app
   * as served by PearBrowser's proxy. For the "browser-itself" context
   * (e.g. Settings screen), pass the literal string "browser".
   *
   * Phase A of the identity plan — see docs/IDENTITY_PLAN.md.
   */
  getAppKeypair (driveKeyHex) {
    if (!sodium) throw new Error('sodium-universal not available')
    if (!this._seed) throw new Error('Identity not ready')
    if (typeof driveKeyHex !== 'string' || driveKeyHex.length === 0) {
      throw new Error('driveKeyHex must be a non-empty string')
    }
    if (!this._appKeypairs) this._appKeypairs = new Map()
    const cached = this._appKeypairs.get(driveKeyHex)
    if (cached) return cached

    const hash = crypto.createHash('sha256')
    hash.update(this._seed)
    hash.update('pear-app-v1:')
    hash.update(driveKeyHex)
    const subSeed = hash.digest()

    const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_seed_keypair(publicKey, secretKey, subSeed)

    const keypair = { publicKey, secretKey, driveKeyHex }
    this._appKeypairs.set(driveKeyHex, keypair)
    return keypair
  }

  /**
   * Sign with the per-app sub-key (not the root). Safe to expose to
   * pages — the root remains sealed inside the worklet.
   *
   * `driveKeyHex` scopes the signing keypair; the payload is also
   * wrapped with a domain-separator tag so one app's signature can't
   * be replayed in another app's context.
   */
  signForApp (driveKeyHex, payload, namespace = '') {
    const { publicKey, secretKey } = this.getAppKeypair(driveKeyHex)
    const tag = `pear.app.${driveKeyHex}:${namespace}:`
    const message = b4a.concat([
      b4a.from(tag, 'utf-8'),
      typeof payload === 'string' ? b4a.from(payload, 'utf-8') : b4a.from(payload || []),
    ])
    if (message.length === 0) throw new Error('payload must be non-empty')
    if (message.length > 64 * 1024) throw new Error('payload too large (>64KB)')

    const signature = b4a.alloc(sodium.crypto_sign_BYTES)
    sodium.crypto_sign_detached(signature, message, secretKey)
    return {
      signature: b4a.toString(signature, 'hex'),
      publicKey: b4a.toString(publicKey, 'hex'),
      algorithm: 'ed25519',
      tag,
    }
  }

  /**
   * Sign a binary or UTF-8 string payload with the user's root keypair.
   * Returns `{ signature: <hex>, publicKey: <hex>, algorithm: 'ed25519' }`.
   *
   * NOTE: Pages that call `window.pear.identity.sign(data)` get this
   * signature back. Validate the payload namespace on the caller side
   * so a malicious page can't trick a user into signing on their behalf
   * for a different app. A future hardening step can prefix-wrap the
   * payload with a domain separator tag (e.g. `PEAR-APP-<driveKey>:`).
   */
  sign (payload) {
    const { publicKey, secretKey } = this.getSigningKeypair()
    const message = typeof payload === 'string'
      ? b4a.from(payload, 'utf-8')
      : b4a.from(payload || [])
    if (message.length === 0) throw new Error('payload must be non-empty')
    if (message.length > 64 * 1024) throw new Error('payload too large (>64KB)')

    const signature = b4a.alloc(sodium.crypto_sign_BYTES)
    sodium.crypto_sign_detached(signature, message, secretKey)
    return {
      signature: b4a.toString(signature, 'hex'),
      publicKey: b4a.toString(publicKey, 'hex'),
      algorithm: 'ed25519'
    }
  }

  /**
   * Replace the current identity with one derived from a user-provided phrase.
   * The caller is responsible for closing the current Corestore and reopening
   * a new one after this — data stored under the old identity is NOT migrated.
   */
  async restoreFromMnemonic (mnemonic) {
    const entropy = mnemonicToEntropy(mnemonic)
    this._entropy = entropy
    this._seed = await entropyToSeed(entropy)
    this._persist()
  }

  /**
   * Generate a fresh identity and replace the persisted one.
   * Same caveat as restoreFromMnemonic — data from old identity is orphaned.
   */
  async rotate () {
    this._entropy = crypto.randomBytes(32)
    this._seed = await entropyToSeed(this._entropy)
    this._persist()
  }
}

module.exports = {
  Identity,
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
  entropyToSeed, // NOTE: now async (standards-compliant BIP-39 PBKDF2)
  mnemonicToSeed: bip39.mnemonicToSeed,
  generateMnemonic: bip39.generateMnemonic,
}
