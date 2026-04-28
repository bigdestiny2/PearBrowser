const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  verifyLoginAttestation,
  extractDriveKey,
  canonicaliseOrigin,
  originToDriveKey,
} = require('../src/index.js')
const ed = require('@noble/ed25519')

// Helper: produce a valid attestation end-to-end (same shape the
// backend produces) so we can round-trip verify.
async function buildAttestation ({ driveKey, scopes, expiresAt, tamper } = {}) {
  driveKey = driveKey || '11'.repeat(32)
  scopes = scopes || ['profile:name']
  expiresAt = typeof expiresAt === 'number' ? expiresAt : Date.now() + 60_000

  const privKey = ed.utils.randomPrivateKey()
  const pubKey = await ed.getPublicKey(privKey)
  const appPubkey = Buffer.from(pubKey).toString('hex')

  const tag = `pear.app.${driveKey}:login:`
  const payload = `pear.login.v1:${driveKey}:${appPubkey}:${scopes.join(',')}:${expiresAt}`
  const message = Buffer.concat([Buffer.from(tag, 'utf-8'), Buffer.from(payload, 'utf-8')])
  const sig = await ed.sign(message, privKey)

  return {
    appPubkey,
    scopes,
    grantedAt: Date.now(),
    expiresAt,
    loginProof: Buffer.from(sig).toString('hex') + (tamper ? '' : ''),
    tag,
    profile: null,
  }
}

test('verifyLoginAttestation: valid attestation passes', async () => {
  const att = await buildAttestation()
  const r = await verifyLoginAttestation(att)
  assert.equal(r.ok, true, r.ok ? '' : r.error)
  assert.equal(r.appPubkey, att.appPubkey.toLowerCase())
  assert.deepEqual(r.scopes, att.scopes)
})

test('verifyLoginAttestation: rejects expired attestation', async () => {
  const att = await buildAttestation({ expiresAt: Date.now() - 120_000 })
  const r = await verifyLoginAttestation(att, { clockSkewMs: 0 })
  assert.equal(r.ok, false)
  assert.match(r.error, /expired/)
})

test('verifyLoginAttestation: enforces expectedDriveKey', async () => {
  const att = await buildAttestation({ driveKey: 'ab'.repeat(32) })
  const r = await verifyLoginAttestation(att, { expectedDriveKey: 'cd'.repeat(32) })
  assert.equal(r.ok, false)
  assert.match(r.error, /driveKey mismatch/)
})

test('verifyLoginAttestation: tampered scopes fail verification', async () => {
  const att = await buildAttestation({ scopes: ['profile:name'] })
  att.scopes = ['profile:name', 'profile:read']  // try to escalate
  const r = await verifyLoginAttestation(att)
  assert.equal(r.ok, false)
  assert.match(r.error, /signature invalid/)
})

test('verifyLoginAttestation: tampered appPubkey fails verification', async () => {
  const att = await buildAttestation()
  // Flip one byte of the pubkey
  att.appPubkey = att.appPubkey.slice(0, 60) + '0000'
  const r = await verifyLoginAttestation(att)
  assert.equal(r.ok, false)
})

test('verifyLoginAttestation: garbage shape rejected cleanly', async () => {
  const r1 = await verifyLoginAttestation({})
  assert.equal(r1.ok, false)
  const r2 = await verifyLoginAttestation({ appPubkey: 'not-hex' })
  assert.equal(r2.ok, false)
  const r3 = await verifyLoginAttestation(null)
  assert.equal(r3.ok, false)
})

test('extractDriveKey parses pear.app.<key>: tag', () => {
  assert.equal(
    extractDriveKey('pear.app.abc123:login:'),
    'abc123'
  )
  assert.equal(extractDriveKey('pear.app.deadbeef:foo:'), 'deadbeef')
  assert.equal(extractDriveKey('something.else'), null)
  assert.equal(extractDriveKey(undefined), null)
})

test('verifyLoginAttestation: maxAgeMs enforced', async () => {
  const att = await buildAttestation()
  att.grantedAt = Date.now() - 10 * 60 * 1000 // 10 min ago
  const r = await verifyLoginAttestation(att, { maxAgeMs: 60_000, clockSkewMs: 0 })
  assert.equal(r.ok, false)
  assert.match(r.error, /older than maxAgeMs/)
})

// --- expectedOrigin / originToDriveKey ---

test('canonicaliseOrigin: strips path/query/fragment, default ports, lowercases host', () => {
  assert.equal(canonicaliseOrigin('https://Example.COM'), 'https://example.com')
  assert.equal(canonicaliseOrigin('https://example.com:443'), 'https://example.com')
  assert.equal(canonicaliseOrigin('http://example.com:80'), 'http://example.com')
  assert.equal(canonicaliseOrigin('https://example.com:8443'), 'https://example.com:8443')
  assert.equal(canonicaliseOrigin('https://example.com/foo/bar?x=1#frag'), 'https://example.com')
  assert.equal(canonicaliseOrigin('not a url'), null)
  assert.equal(canonicaliseOrigin('ftp://example.com'), null)
  assert.equal(canonicaliseOrigin(null), null)
})

test('originToDriveKey: same origin → same key, deterministic', () => {
  const k1 = originToDriveKey('https://example.com')
  const k2 = originToDriveKey('https://Example.com:443/some/path')
  assert.equal(k1, k2)
  assert.match(k1, /^[0-9a-f]{64}$/)
})

test('originToDriveKey: different origins → different keys', () => {
  assert.notEqual(originToDriveKey('https://a.com'), originToDriveKey('https://b.com'))
  assert.notEqual(originToDriveKey('http://a.com'), originToDriveKey('https://a.com'))
  assert.notEqual(originToDriveKey('https://a.com'), originToDriveKey('https://a.com:8443'))
})

test('verifyLoginAttestation: expectedOrigin matches when origin is correct', async () => {
  const origin = 'https://example.com'
  const driveKey = originToDriveKey(origin)
  const att = await buildAttestation({ driveKey })
  const r = await verifyLoginAttestation(att, { expectedOrigin: origin })
  assert.equal(r.ok, true, r.ok ? '' : r.error)
})

test('verifyLoginAttestation: expectedOrigin rejects mismatch', async () => {
  const att = await buildAttestation({ driveKey: originToDriveKey('https://example.com') })
  const r = await verifyLoginAttestation(att, { expectedOrigin: 'https://other.com' })
  assert.equal(r.ok, false)
  assert.match(r.error, /driveKey mismatch/)
})

test('verifyLoginAttestation: expectedOrigin handles dirty origin strings', async () => {
  // Server passes the full URL it serves from — verify normalises it.
  const att = await buildAttestation({ driveKey: originToDriveKey('https://Example.COM') })
  const r = await verifyLoginAttestation(att, {
    expectedOrigin: 'https://example.com:443/login/callback?from=foo'
  })
  assert.equal(r.ok, true, r.ok ? '' : r.error)
})

test('verifyLoginAttestation: expectedOrigin rejects garbage', async () => {
  const att = await buildAttestation()
  const r = await verifyLoginAttestation(att, { expectedOrigin: 'not a url' })
  assert.equal(r.ok, false)
  assert.match(r.error, /not a valid http\(s\) origin/)
})
