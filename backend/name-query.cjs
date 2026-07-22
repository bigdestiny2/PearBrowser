'use strict'

// Mobile port (Mission B3): the URL-bar name prefilter + pearname:// parsing,
// ported from pearbrowser-desktop ui/lib/keys.js (looksLikeName, parsePearname,
// normalizeNameTarget). On the desktop these live UI-side in front of
// CMD_NAME_RESOLVE; on mobile they sit backend-side in front of CMD_NAVIGATE
// so bare-word input tries the tiered name resolver BEFORE URL handling.
// Pure + dependency-free → Node-testable.

// Naming Phase N1 — true when `raw` is a bare name token the resolver should
// try BEFORE URL handling: a single word like "keet" or "pear-pass", not a
// drive key, domain, path, or scheme. A cheap pre-filter so the navigate path
// only runs the resolver for plausible names (the backend resolver still
// returns null for anything unknown, so this never changes correctness — only
// avoids a registry scan on ordinary navigations). Rejects keys explicitly so
// a typed 64-hex/52-z32 key always goes straight to drive loading.
function looksLikeName (raw) {
  const s = String(raw || '').normalize('NFKC').trim()
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,127}$/u.test(s)) return false // single token: no dot/slash/scheme/space
  if (/^[0-9a-f]{64}$/i.test(s)) return false                 // 64-char hex drive key
  if (/^[13-9a-km-uw-z]{52}$/i.test(s)) return false          // 52-char z-base-32 key
  return true
}

// Parse a `pearname://<name>` URL → the bare registry name (or null). Only a
// loose well-formedness gate — the backend name-normalize.cjs does the
// authoritative NFKC + confusable folding; this just strips the scheme so the
// navigate path can resolve it like a typed bare name. MAX_NAME=253.
function parsePearname (raw) {
  const s = String(raw || '').trim().replace(/^pearname:\/\//i, '').replace(/\/+$/, '')
  return /^[^\s/]{1,253}$/.test(s) ? s : null
}

// The name → target input gate for claims/petnames (Settings Names section):
// a 64-hex drive key or a hyper://, pear://, file:// link, else null.
function normalizeNameTarget (raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  if (s.length <= 300 && /^(?:hyper|pear|file):\/\/.+/i.test(s)) return s
  return null
}

// One entry point for CMD_NAVIGATE: the name to resolve for raw URL-bar input,
// or null when the input is not name-shaped. A pearname://<name> URL resolves
// exactly like a typed bare word (desktop ui/shell.js go()).
function nameQueryFromInput (raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (/^pearname:\/\//i.test(s)) return parsePearname(s)
  return looksLikeName(s) ? s : null
}

module.exports = { looksLikeName, parsePearname, normalizeNameTarget, nameQueryFromInput }
