// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/name-record.cjs.
// Self-certifying DHT name pointer + name-binding row schema (naming Phase N0).
//
// Mirrors backend/relay-record.js: a name's owner publishes `name → target`
// as a hyperdht MUTABLE record keyed by the name's (rotatable, NOT seed-derived)
// sub-pubkey. dht.mutableGet VERIFIES the Ed25519 signature against that key, so
// a resolved pointer is self-certifying — a malicious DHT node can serve stale
// data, never forge. The monotonic seq `s` lets the owner re-point the name
// (highest seq wins), surviving key rotation.
//
// Node-safe (b4a only, no Bare modules) → unit-testable outside Bare, like
// relay-record.js. See docs/research/naming.md.
const b4a = require('b4a')
const {
  driveKeyFromHyperLink,
  normalizeCatalogLink,
  normalizeDriveKey
} = require('./catalog-safety.cjs')

const NAME_RECORD_VERSION = 1
const MAX_LINK = 300

function normalizeRecordLink (raw) {
  const link = normalizeCatalogLink(raw)
  return link && link.length <= MAX_LINK ? link : null
}

function normalizeRecordTarget ({ driveKey, link, target } = {}) {
  const normalizedLink = normalizeRecordLink(target) || normalizeRecordLink(link)
  const key = normalizeDriveKey(driveKey) ||
    (!normalizedLink ? normalizeDriveKey(target) : '') ||
    (normalizedLink ? driveKeyFromHyperLink(normalizedLink) : '')
  if (!key && !normalizedLink) return null
  return {
    driveKey: key || null,
    link: normalizedLink || null,
    target: normalizedLink || key
  }
}

// Wire shape: { v, n, k?, s, l? } — version, name, optional drive key
// (64-hex), monotonic seq, and optional target/launch link. Old key-only records
// still decode; newer link-only records are accepted when the link scheme is one
// of the shared app-link schemes. Unknown shapes decode to null.
function decodeNameRecord (buf) {
  if (buf == null) return null
  let rec
  try { rec = JSON.parse(b4a.isBuffer(buf) ? b4a.toString(buf, 'utf8') : String(buf)) } catch { return null }
  if (!rec || typeof rec !== 'object' || rec.v !== NAME_RECORD_VERSION) return null
  if (typeof rec.n !== 'string' || rec.n.length === 0 || rec.n.length > 253) return null
  if (!Number.isInteger(rec.s) || rec.s < 0) return null
  const target = normalizeRecordTarget({ driveKey: rec.k, link: rec.l })
  if (!target) return null
  return { name: rec.n, driveKey: target.driveKey, seq: rec.s, link: target.link, target: target.target }
}

function encodeNameRecord ({ name, driveKey, seq, link, target } = {}) {
  if (typeof name !== 'string' || !name) throw new Error('name required')
  if (!Number.isInteger(seq) || seq < 0) throw new Error('seq must be a non-negative integer')
  const resolved = normalizeRecordTarget({ driveKey, link, target })
  if (!resolved) throw new Error('target must be a Hyperdrive key or pear://, hyper://, file:// link')
  const rec = { v: NAME_RECORD_VERSION, n: name, s: seq }
  if (resolved.driveKey) rec.k = resolved.driveKey
  if (resolved.link) rec.l = resolved.link
  return b4a.from(JSON.stringify(rec), 'utf8')
}

/**
 * Resolve a name's current pointer by its sub-pubkey over a hyperdht instance.
 * mutableGet verifies the signature, so the result is trustworthy without a
 * registrar. @param {object} dht @param {Buffer|string} nameSubPubkey 32B/64-hex
 */
async function resolveNameRecord (dht, nameSubPubkey) {
  if (!dht || typeof dht.mutableGet !== 'function') return null
  let key
  try { key = typeof nameSubPubkey === 'string' ? b4a.from(nameSubPubkey, 'hex') : nameSubPubkey } catch { return null }
  if (!key || key.length !== 32) return null
  let res
  try { res = await dht.mutableGet(key) } catch { return null }
  if (!res || res.value == null) return null
  return decodeNameRecord(res.value)
}

// name-binding row schema for a `name-directory` index room — mirrors APPS_SCHEMA
// in backend/sheets-catalog.js. A signed `name → key` claim that the directory
// ingest re-verifies and DROPS on failure ("index, not authority"), ranked by
// the follow graph. binderPubkey is the claimer's name sub-pubkey; bindingSig is
// the Ed25519 sig over (normalized name ‖ driveKey), checked with
// identity-binding.cjs verifyAppSig — i.e. this CONSUMES the Lighthouse
// substrate rather than re-deriving a verifier.
const NAME_BINDING_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 253 },
    driveKey: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    link: { type: 'string', maxLength: 300, pattern: '^(?:hyper|pear|file)://.+' },
    binderPubkey: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    bindingSig: { type: 'string', pattern: '^[0-9a-f]{128}$' },
    seq: { type: 'integer' },
    verification: { enum: ['unverified', 'relay-listed', 'author-signed'] }
  },
  required: ['name', 'binderPubkey', 'bindingSig'],
  anyOf: [{ required: ['driveKey'] }, { required: ['link'] }],
  additionalProperties: false
}

module.exports = {
  NAME_RECORD_VERSION, decodeNameRecord, encodeNameRecord, resolveNameRecord,
  NAME_BINDING_SCHEMA,
}
