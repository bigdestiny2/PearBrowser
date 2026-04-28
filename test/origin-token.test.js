/**
 * Per-origin session token tests for HyperProxy (Phase E follow-up).
 *
 * Validates:
 *   - normaliseOrigin canonicalises scheme://host[:port]
 *   - issueOriginToken refuses loopback + malformed origins
 *   - same origin → same pseudo-driveKey across calls (deterministic)
 *   - different origins → different pseudo-driveKeys
 *   - validateApiToken returns the full entry (driveKey + origin + kind)
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
require('./_stubs')

const { HyperProxy } = require('../backend/hyper-proxy')

function freshProxy () {
  // Constructor needs a getDrive fn + onError fn — we don't fire either
  return new HyperProxy(async () => null, () => {}, null)
}

test('issueOriginToken: same origin → same pseudo-driveKey', () => {
  const a = freshProxy()
  const t1 = a.issueOriginToken('https://example.com')
  const t2 = a.issueOriginToken('https://example.com')
  assert.equal(t1.driveKeyHex, t2.driveKeyHex)
  assert.notEqual(t1.token, t2.token, 'tokens are random per call')
  assert.equal(t1.driveKeyHex.length, 64)
  assert.match(t1.driveKeyHex, /^[0-9a-f]{64}$/)
})

test('issueOriginToken: different origins → different pseudo-driveKeys', () => {
  const a = freshProxy()
  const t1 = a.issueOriginToken('https://example.com')
  const t2 = a.issueOriginToken('https://other.com')
  assert.notEqual(t1.driveKeyHex, t2.driveKeyHex)
})

test('issueOriginToken: scheme matters (http vs https)', () => {
  const a = freshProxy()
  const t1 = a.issueOriginToken('https://example.com')
  const t2 = a.issueOriginToken('http://example.com')
  assert.notEqual(t1.driveKeyHex, t2.driveKeyHex)
})

test('issueOriginToken: port matters when non-default', () => {
  const a = freshProxy()
  const t1 = a.issueOriginToken('https://example.com')
  const t2 = a.issueOriginToken('https://example.com:8443')
  assert.notEqual(t1.driveKeyHex, t2.driveKeyHex)
})

test('issueOriginToken: default port equals omitted port', () => {
  const a = freshProxy()
  const t1 = a.issueOriginToken('https://example.com')
  const t2 = a.issueOriginToken('https://example.com:443')
  assert.equal(t1.driveKeyHex, t2.driveKeyHex)

  const t3 = a.issueOriginToken('http://example.com')
  const t4 = a.issueOriginToken('http://example.com:80')
  assert.equal(t3.driveKeyHex, t4.driveKeyHex)
})

test('issueOriginToken: case-insensitive host', () => {
  const a = freshProxy()
  const t1 = a.issueOriginToken('https://Example.COM')
  const t2 = a.issueOriginToken('https://example.com')
  assert.equal(t1.driveKeyHex, t2.driveKeyHex)
})

test('issueOriginToken: rejects loopback', () => {
  const a = freshProxy()
  assert.throws(() => a.issueOriginToken('http://127.0.0.1'), /Origin tokens are for non-loopback/)
  assert.throws(() => a.issueOriginToken('http://localhost:8080'), /Origin tokens are for non-loopback/)
})

test('issueOriginToken: rejects malformed strings', () => {
  const a = freshProxy()
  assert.throws(() => a.issueOriginToken(''), /Invalid origin/)
  assert.throws(() => a.issueOriginToken('not a url'), /Invalid origin/)
  assert.throws(() => a.issueOriginToken('ftp://example.com'), /Invalid origin/)
  assert.throws(() => a.issueOriginToken('https://'), /Invalid origin/)
})

test('issueOriginToken: rejects path/query/fragment leakage', () => {
  // The token derives from the canonicalised origin, NOT the full URL —
  // so two URLs on the same origin must collide on driveKey.
  const a = freshProxy()
  const t1 = a.issueOriginToken('https://example.com')
  // We canonicalise inside issueOriginToken so a URL with a path also
  // works and produces the same driveKey.
  const t2 = a.issueOriginToken('https://example.com/some/path?x=1#frag')
  assert.equal(t1.driveKeyHex, t2.driveKeyHex)
})

test('validateApiToken: returns full entry for origin tokens', () => {
  const a = freshProxy()
  const issued = a.issueOriginToken('https://example.com')
  const entry = a.validateApiToken(issued.token)
  assert.equal(entry.driveKeyHex, issued.driveKeyHex)
  assert.equal(entry.origin, 'https://example.com')
  assert.equal(entry.kind, 'origin')
})

test('validateApiToken: returns full entry for drive tokens', () => {
  const a = freshProxy()
  const fakeDriveKey = 'a'.repeat(64)
  const token = a.issueApiToken(fakeDriveKey)
  const entry = a.validateApiToken(token)
  assert.equal(entry.driveKeyHex, fakeDriveKey)
  assert.equal(entry.origin, null)
  assert.equal(entry.kind, 'drive')
})

test('validateApiToken: rejects garbage', () => {
  const a = freshProxy()
  assert.equal(a.validateApiToken(''), null)
  assert.equal(a.validateApiToken('short'), null)
  assert.equal(a.validateApiToken(null), null)
  assert.equal(a.validateApiToken('a'.repeat(64)), null) // never issued
})
