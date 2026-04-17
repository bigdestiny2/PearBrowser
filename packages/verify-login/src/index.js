/**
 * @pearbrowser/verify-login
 *
 * Verify a PearBrowser login attestation server-side. Zero servers,
 * zero DIDs, zero shared secrets — just ed25519 signature verification
 * against the public key embedded in the attestation.
 *
 * Usage:
 *   const { verifyLoginAttestation } = require('@pearbrowser/verify-login')
 *
 *   const result = await verifyLoginAttestation(attestation, {
 *     expectedDriveKey: 'abc123...',   // OPTIONAL: enforce this was for you
 *     maxAgeMs: 30 * 24 * 60 * 60 * 1000, // OPTIONAL: stricter than the embedded expiresAt
 *     clockSkewMs: 30_000,              // OPTIONAL: allow 30s skew
 *   })
 *   if (result.ok) {
 *     // Trust result.appPubkey as the stable user identifier for THIS app.
 *     // result.scopes is what the user granted.
 *     // result.profile is whatever profile fields the user shared.
 *   }
 *
 * Attestation shape (returned by window.pear.login() in the browser):
 *   {
 *     appPubkey:    '<64-hex>',     // ed25519 public key (per user+app)
 *     scopes:       ['profile:name', ...],
 *     grantedAt:    <epoch ms>,
 *     expiresAt:    <epoch ms>,
 *     loginProof:   '<128-hex>',    // ed25519 signature
 *     tag:          'pear.app.<driveKey>:login:',
 *     profile:      { displayName, ... } | null
 *   }
 *
 * How the signature is verified:
 *   payload = `pear.login.v1:<driveKey>:<appPubkey>:<scopes.join(',')>:<expiresAt>`
 *   message = <tag> + payload
 *   ed25519.verify(loginProof, message, appPubkey) === true
 *
 * The driveKey is recoverable from the tag (see extractDriveKey()).
 */

const ed = require('@noble/ed25519')
const nodeCrypto = require('crypto')

// @noble/ed25519 v2+ needs SHA-512 injected via its `etc` namespace so
// it doesn't hard-depend on a specific runtime. Node + Bun + Deno all
// ship Web Crypto — we wire up Node's built-in here. Browser consumers
// can set `ed.etc.sha512Sync` themselves before calling verify.
if (ed.etc && !ed.etc.sha512Sync) {
  ed.etc.sha512Sync = (...msgs) => {
    const h = nodeCrypto.createHash('sha512')
    for (const m of msgs) h.update(m)
    return new Uint8Array(h.digest())
  }
}

const HEX_64 = /^[0-9a-f]{64}$/i
const HEX_128 = /^[0-9a-f]{128}$/i

function hexToBytes (hex) {
  if (typeof hex !== 'string') throw new Error('expected hex string')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

function utf8Bytes (str) {
  return new TextEncoder().encode(str)
}

function concatBytes (a, b) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/**
 * Extract the driveKey from a `pear.app.<driveKey>:<ns>:` tag.
 * Returns null if the tag is malformed.
 */
function extractDriveKey (tag) {
  if (typeof tag !== 'string') return null
  const m = tag.match(/^pear\.app\.([0-9a-f]+):/)
  return m ? m[1] : null
}

/**
 * Verify a PearBrowser login attestation.
 *
 * @param {object} attestation  from window.pear.login()
 * @param {object} [opts]
 * @param {string} [opts.expectedDriveKey] enforce this attestation was for your app
 * @param {number} [opts.maxAgeMs] reject if grantedAt < now - maxAgeMs
 * @param {number} [opts.clockSkewMs=30_000] allow this much forward drift
 * @param {number} [opts.now=Date.now()] override "now" for testing
 * @returns {Promise<{ok: true, appPubkey, scopes, profile, driveKey, grantedAt, expiresAt} | {ok: false, error}>}
 */
async function verifyLoginAttestation (attestation, opts = {}) {
  if (!attestation || typeof attestation !== 'object') {
    return { ok: false, error: 'attestation required' }
  }

  const {
    appPubkey, scopes, grantedAt, expiresAt, loginProof, tag, profile,
  } = attestation

  // 1. Shape checks
  if (typeof appPubkey !== 'string' || !HEX_64.test(appPubkey)) {
    return { ok: false, error: 'appPubkey must be 64-char hex' }
  }
  if (!Array.isArray(scopes)) {
    return { ok: false, error: 'scopes must be an array' }
  }
  if (typeof grantedAt !== 'number' || typeof expiresAt !== 'number') {
    return { ok: false, error: 'grantedAt and expiresAt must be numbers' }
  }
  if (typeof loginProof !== 'string' || !HEX_128.test(loginProof)) {
    return { ok: false, error: 'loginProof must be 128-char hex' }
  }
  if (typeof tag !== 'string' || !tag.startsWith('pear.app.') || !tag.includes(':login:')) {
    return { ok: false, error: 'tag must look like "pear.app.<driveKey>:login:"' }
  }

  // 2. Extract driveKey from tag + optional check
  const driveKey = extractDriveKey(tag)
  if (!driveKey || !HEX_64.test(driveKey)) {
    return { ok: false, error: 'tag driveKey malformed' }
  }
  if (opts.expectedDriveKey && driveKey.toLowerCase() !== String(opts.expectedDriveKey).toLowerCase()) {
    return { ok: false, error: `driveKey mismatch: got ${driveKey}, expected ${opts.expectedDriveKey}` }
  }

  // 3. Expiry
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const skew = typeof opts.clockSkewMs === 'number' ? opts.clockSkewMs : 30_000
  if (expiresAt + skew < now) {
    return { ok: false, error: 'attestation expired' }
  }
  if (grantedAt - skew > now) {
    return { ok: false, error: 'attestation from the future (clock skew?)' }
  }
  if (typeof opts.maxAgeMs === 'number') {
    if (grantedAt + opts.maxAgeMs + skew < now) {
      return { ok: false, error: `attestation older than maxAgeMs (${opts.maxAgeMs})` }
    }
  }

  // 4. Reconstruct the signed message and verify
  const payload = `pear.login.v1:${driveKey}:${appPubkey}:${scopes.join(',')}:${expiresAt}`
  const message = concatBytes(utf8Bytes(tag), utf8Bytes(payload))

  let valid = false
  try {
    valid = await ed.verify(hexToBytes(loginProof), message, hexToBytes(appPubkey))
  } catch (err) {
    return { ok: false, error: `signature verification threw: ${err.message}` }
  }
  if (!valid) return { ok: false, error: 'signature invalid' }

  return {
    ok: true,
    appPubkey: appPubkey.toLowerCase(),
    scopes,
    profile: profile || null,
    driveKey: driveKey.toLowerCase(),
    grantedAt,
    expiresAt,
  }
}

/**
 * Middleware helper for Express-style handlers. Example:
 *
 *     app.post('/login', verifyLoginMiddleware({ expectedDriveKey }), (req, res) => {
 *       // req.pearLogin is set to the verified attestation
 *       res.json({ hello: req.pearLogin.appPubkey })
 *     })
 */
function verifyLoginMiddleware (opts = {}) {
  return async (req, res, next) => {
    try {
      const attestation = req.body && req.body.attestation
      const result = await verifyLoginAttestation(attestation, opts)
      if (!result.ok) {
        return res.status(401).json({ error: result.error })
      }
      req.pearLogin = result
      next()
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  }
}

module.exports = {
  verifyLoginAttestation,
  verifyLoginMiddleware,
  extractDriveKey,
}
