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

function makeRes () {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader (name, value) { this.headers[name.toLowerCase()] = value },
    end (body = '') { this.body = body }
  }
  return res
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

test('HyperProxy CORS preflight works without re-allowing query tokens', async () => {
  const proxy = freshProxy()
  proxy._port = 12345
  const origin = 'https://example.com'

  const preflight = makeRes()
  await proxy._handle({
    method: 'OPTIONS',
    url: '/api/swarm/ticket',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-pear-token'
    },
    socket: {}
  }, preflight)
  assert.equal(preflight.statusCode, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], origin)

  const issued = proxy.issueOriginToken(origin)
  const queryBearer = makeRes()
  await proxy._handle({
    method: 'GET',
    url: `/api/swarm/events?channelId=channel-1&token=${encodeURIComponent(issued.token)}`,
    headers: { origin },
    socket: {}
  }, queryBearer)
  assert.notEqual(queryBearer.headers['access-control-allow-origin'], origin)
})

test('HyperProxy returns 400 for malformed request URLs instead of crashing', async () => {
  const proxy = freshProxy()
  proxy._port = 12345
  const OriginalURL = global.URL
  global.URL = class {
    constructor () {
      throw new URIError('URI malformed')
    }
  }
  const res = makeRes()
  try {
    await proxy._handle({ method: 'GET', url: '/api/sync/range?lt=probe!%FF', headers: {}, socket: {} }, res)
  } finally {
    global.URL = OriginalURL
  }
  assert.equal(res.statusCode, 400)
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8')
  assert.equal(res.body, 'Bad request')
})
