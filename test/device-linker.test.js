// End-to-end + unit test for backend/device-linker.js (blind-pairing device
// linking, adopted from hyper-identity and hardened with an approval gate).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const createTestnet = require('hyperdht/testnet.js')
const Hyperswarm = require('hyperswarm')
const bip39 = require('bip39-mnemonic')
const b4a = require('b4a')
const { DeviceLinker } = require('../backend/device-linker.js')

function stubIdentity (entropy) {
  return {
    _restored: null,
    getEntropy () { return b4a.from(entropy) },
    async restoreFromMnemonic (mnemonic) { this._restored = mnemonic }
  }
}

test('approval gate fails closed unless autoAccept or onRequest approves', async () => {
  const linker = new DeviceLinker({}, { identity: stubIdentity(b4a.alloc(32)) })
  assert.equal(await linker._shouldApprove({ device: 'x' }), false)

  const auto = new DeviceLinker({}, { identity: stubIdentity(b4a.alloc(32)), autoAccept: true })
  assert.equal(await auto._shouldApprove({ device: 'x' }), true)

  let sawInfo = null
  const gated = new DeviceLinker({}, {
    identity: stubIdentity(b4a.alloc(32)),
    onRequest: async (info) => {
      sawInfo = info
      return info.device === 'trusted'
    }
  })
  assert.equal(await gated._shouldApprove({ device: 'trusted' }), true)
  assert.equal(await gated._shouldApprove({ device: 'stranger' }), false)
  assert.deepEqual(sawInfo, { device: 'stranger' })
})

test('createInvite rejects a non-32-byte pre-v2 identity', async () => {
  const linker = new DeviceLinker({}, { identity: stubIdentity(b4a.alloc(16)) })
  await assert.rejects(() => linker.createInvite(), /32-byte/)
})

test('end-to-end root seed transfers source -> target over a local testnet', async () => {
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  const entropy = b4a.from(bip39.mnemonicToEntropy(bip39.generateMnemonic()))
  const expectedMnemonic = bip39.entropyToMnemonic(entropy)

  const sourceSwarm = new Hyperswarm({ bootstrap })
  const targetSwarm = new Hyperswarm({ bootstrap })

  const sourceId = stubIdentity(entropy)
  const targetId = stubIdentity(b4a.alloc(32))

  const source = new DeviceLinker(sourceSwarm, { identity: sourceId, autoAccept: true, poll: 1000 })
  const target = new DeviceLinker(targetSwarm, { identity: targetId, poll: 1000 })

  try {
    const { invite, done } = await source.createInvite()
    const joined = await target.joinWithInvite(invite, { device: 'phone' })

    await done

    assert.equal(joined.mnemonic, expectedMnemonic, 'target reconstructed the source phrase')
    assert.equal(joined.restartRequired, true)
    assert.equal(targetId._restored, expectedMnemonic, 'target adopted the linked identity')
  } finally {
    await source.close().catch(() => {})
    await target.close().catch(() => {})
    await sourceSwarm.destroy().catch(() => {})
    await targetSwarm.destroy().catch(() => {})
    await testnet.destroy().catch(() => {})
  }
})
