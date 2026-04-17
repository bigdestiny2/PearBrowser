const { test } = require('node:test')
const assert = require('node:assert/strict')
const { verifyLoginAttestation, extractDriveKey } = require('../src/index.js')
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
