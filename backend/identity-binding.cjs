// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/identity-binding.cjs.
// Lighthouse Phase 2 — IdentityBinding + the missing detached-verify. PURE,
// CommonJS. Closes the v1 showstopper that signForApp does NOT bind a posting's
// signer to the user's root / Contacts identity, and that there is no
// identity.verify. See docs/P2P-SEARCH-RESEARCH.md (gap: identity-binding).
//
// Two concerns:
//  1. verifyAppSig — verify a per-app (e.g. 'search') detached ed25519 signature
//     using the SAME domain-separated tag signForApp produces
//     (`pear.app.<appId>:<namespace>:`), so a signature can't be replayed
//     across apps/namespaces.
//  2. IdentityBinding — a VERSIONED, root-signed record linking your root
//     pubkey → a (rotatable, Corestore-persisted, NOT seed-derived) search
//     pubkey, plus revocation. First-use authentication requires the binding be
//     checked against the Contacts-held ROOT pubkey, never a self-asserted one.

const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const HEX64 = /^[0-9a-f]{64}$/i // ed25519 root + sub-key pubkeys
const HEX128 = /^[0-9a-f]{128}$/i // ed25519 signatures

// --- per-app signature domain (mirrors identity.js signForApp exactly) -------

function appTag (appId, namespace = '') {
  return `pear.app.${appId}:${namespace}:`
}

// The exact message bytes signForApp signs: tag ‖ payload.
function appMessage (appId, payload, namespace = '') {
  const tag = b4a.from(appTag(appId, namespace), 'utf-8')
  const body = typeof payload === 'string' ? b4a.from(payload, 'utf-8') : b4a.from(payload || [])
  return b4a.concat([tag, body])
}

function verifyAppSig (appId, payload, sigHex, pubkeyHex, namespace = '') {
  if (!sigHex || !pubkeyHex) return false
  try {
    return crypto.verify(appMessage(appId, payload, namespace), b4a.from(sigHex, 'hex'), b4a.from(pubkeyHex, 'hex'))
  } catch { return false }
}

// --- IdentityBinding ---------------------------------------------------------
//
// A binding is signed by the ROOT key (so only the identity owner can issue
// one), and is monotonically versioned so the search key can ROTATE (the search
// key is a random Corestore-persisted keypair, NOT getAppKeypair('search'),
// which is seed-derived and therefore unrotatable). A revocation (same version)
// invalidates a binding.

const BINDING_TAG = 'pear.idbinding.v3:'
const REVOKE_TAG = 'pear.idbinding.revoke.v3:'

// A binding ties root → a sub-key FOR ONE PURPOSE. `purpose` is in the SIGNED
// bytes (cross-purpose replay defense): a binding minted for 'search' can never
// satisfy a 'nostr'/'merchant'/... resolve, even with a valid root signature.
// Add purposes here as tracks land; every resolver MUST pass the purpose it
// expects. (v3 cut from v2 is free — no live bindings predate it.)
const PURPOSES = ['search', 'name', 'merchant', 'nostr', 'routing']
const PURPOSE_SEARCH = 'search'

// Canonical, stable bytes a binding/revocation signs (sorted keys, no clock).
function canonBinding (rootPubkey, searchPubkey, purpose, version) {
  return BINDING_TAG + JSON.stringify({ p: purpose, r: rootPubkey, s: searchPubkey, v: version }, ['p', 'r', 's', 'v'])
}
function canonRevoke (rootPubkey, searchPubkey, purpose, version) {
  return REVOKE_TAG + JSON.stringify({ p: purpose, r: rootPubkey, s: searchPubkey, v: version }, ['p', 'r', 's', 'v'])
}

// `rootSign(msgString) -> sigHex` signs with the user's ROOT key (identity.sign
// in the app; a test stub otherwise). `searchPubkey` is the bound sub-key (named
// for the search consumer; generic across purposes).
function makeBinding ({ rootPubkey, searchPubkey, purpose, version }, rootSign) {
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer')
  if (typeof purpose !== 'string' || !purpose) throw new Error('purpose must be a non-empty string')
  const sig = rootSign(canonBinding(rootPubkey, searchPubkey, purpose, version))
  return { kind: 'binding', v: 3, rootPubkey, searchPubkey, purpose, version, sig }
}

function makeRevocation ({ rootPubkey, searchPubkey, purpose, version }, rootSign) {
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer')
  if (typeof purpose !== 'string' || !purpose) throw new Error('purpose must be a non-empty string')
  const sig = rootSign(canonRevoke(rootPubkey, searchPubkey, purpose, version))
  return { kind: 'revoke', v: 3, rootPubkey, searchPubkey, purpose, version, sig }
}

// Verify a binding's root signature against the EXPECTED root pubkey (the one
// held in Contacts for this peer — NOT binding.rootPubkey, which is attacker-
// controllable on first sight). This is the MITM defense.
// Verify a binding's root signature AND that it was minted for `expectedPurpose`.
// expectedPurpose is REQUIRED — a binding counts only for the EXACT purpose the
// consumer asks for, so a 'nostr' binding can't satisfy a 'search' resolve.
function verifyBinding (binding, expectedRootPubkey, expectedPurpose) {
  if (!binding || binding.kind !== 'binding') return false
  // version must be a canonical integer: a string "10" would verify (the sig is
  // over its JSON form) yet break resolveSearchKey's `===`/`>` version logic,
  // re-opening the equivocation the tie-break exists to close.
  if (!Number.isInteger(binding.version) || binding.version < 1) return false
  // searchPubkey must be a string too: a number/null at the same version would
  // make resolveSearchKey's `<` tie-break number-vs-string (false both ways) →
  // array-order-dependent resolution (the equivocation split-view), and a null
  // "winner" collides with the no-key sentinel.
  // searchPubkey must be a 64-hex pubkey (not just any string): an arbitrary
  // string like 'aaa' has no key behind it, and explicit format validation makes
  // a verification failure unambiguously "wrong signer", never "malformed hex".
  if (typeof binding.searchPubkey !== 'string' || !HEX64.test(binding.searchPubkey)) return false
  // purpose must be a string AND match — cross-purpose replay defense.
  if (typeof binding.purpose !== 'string' || binding.purpose !== expectedPurpose) return false
  if (typeof binding.rootPubkey !== 'string' || !HEX64.test(binding.rootPubkey) || binding.rootPubkey !== expectedRootPubkey) return false
  if (typeof binding.sig !== 'string' || !HEX128.test(binding.sig)) return false
  try {
    return crypto.verify(b4a.from(canonBinding(binding.rootPubkey, binding.searchPubkey, binding.purpose, binding.version), 'utf-8'),
      b4a.from(binding.sig, 'hex'), b4a.from(expectedRootPubkey, 'hex'))
  } catch { return false }
}

function verifyRevocation (rev, expectedRootPubkey, expectedPurpose) {
  if (!rev || rev.kind !== 'revoke') return false
  if (!Number.isInteger(rev.version) || rev.version < 1) return false
  if (typeof rev.searchPubkey !== 'string' || !HEX64.test(rev.searchPubkey)) return false
  if (typeof rev.purpose !== 'string' || rev.purpose !== expectedPurpose) return false
  if (typeof rev.rootPubkey !== 'string' || !HEX64.test(rev.rootPubkey) || rev.rootPubkey !== expectedRootPubkey) return false
  if (typeof rev.sig !== 'string' || !HEX128.test(rev.sig)) return false
  try {
    return crypto.verify(b4a.from(canonRevoke(rev.rootPubkey, rev.searchPubkey, rev.purpose, rev.version), 'utf-8'),
      b4a.from(rev.sig, 'hex'), b4a.from(expectedRootPubkey, 'hex'))
  } catch { return false }
}

// Resolve the CURRENT valid search pubkey for a root from its bindings +
// revocations, authenticated against the Contacts-held root pubkey. Highest
// non-revoked version wins. Returns the searchPubkey hex, or null.
function resolveSearchKey (expectedRootPubkey, bindings, revocations) {
  const revoked = new Set()
  for (const r of revocations || []) {
    if (verifyRevocation(r, expectedRootPubkey, PURPOSE_SEARCH)) revoked.add(r.version + ':' + r.searchPubkey)
  }
  let best = null
  for (const b of bindings || []) {
    if (!verifyBinding(b, expectedRootPubkey, PURPOSE_SEARCH)) continue
    if (revoked.has(b.version + ':' + b.searchPubkey)) continue
    // highest version wins; equal-version ties (equivocation — two valid
    // bindings at the same version) broken deterministically by searchPubkey so
    // every peer resolves the same key regardless of array order.
    if (!best || b.version > best.version ||
      (b.version === best.version && b.searchPubkey < best.searchPubkey)) best = b
  }
  return best ? best.searchPubkey : null
}

module.exports = {
  appTag, appMessage, verifyAppSig,
  canonBinding, canonRevoke,
  makeBinding, makeRevocation, verifyBinding, verifyRevocation, resolveSearchKey,
  PURPOSES, PURPOSE_SEARCH,
}
