const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const nodeCrypto = require('node:crypto')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  return request === 'bare-crypto' ? nodeCrypto : origLoad.call(this, request, parent, isMain)
}
const { PearBridge } = require('../backend/pear-bridge.js')
const ApplyState = require('autobase/lib/apply-state.js')
Module._load = origLoad

const stubSwarm = () => ({ join () {}, leave () {} })

async function newStore () {
  const dir = await mkdtemp(join(tmpdir(), 'pb-sync-groups-'))
  const store = new Corestore(dir)
  await store.ready()
  return { store, dir }
}

test('closing a PearBridge sync group leaves the shared root Corestore alive', async () => {
  const { store, dir } = await newStore()
  try {
    const sibling = new Hyperbee(store.get({ name: 'userdata' }), { keyEncoding: 'utf-8', valueEncoding: 'json' })
    await sibling.ready()
    await sibling.put('before', 1)

    const bridge = new PearBridge(store, stubSwarm())
    await bridge.createSyncGroup('myapp', async () => {})
    await bridge.append('myapp', { type: 'test', data: { v: 1 } })
    await bridge.close()

    assert.equal(store.closed, false)
    await sibling.put('after', 2)
    assert.equal((await sibling.get('after')).value, 2)
    await sibling.close()
  } finally {
    await store.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})

test('two PearBridge sync groups get distinct local Autobase identities', async () => {
  const { store, dir } = await newStore()
  try {
    const bridge = new PearBridge(store, stubSwarm())
    const first = await bridge.createSyncGroup('app-a', async () => {})
    const second = await bridge.createSyncGroup('app-b', async () => {})

    assert.notEqual(first.inviteKey, second.inviteKey)
    await bridge.append('app-a', { type: 'test', data: { v: 1 } })
    await bridge.append('app-b', { type: 'test', data: { v: 2 } })
    await bridge.close()
    assert.equal(store.closed, false)
  } finally {
    await store.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})

test('PearBridge leaves Autobase tracing safe when a mapped view ref is unavailable', () => {
  const seen = []
  const tracer = (name, blocks = []) => ({
    start () { seen.push('start:' + name) },
    end () { seen.push('end:' + name); return blocks }
  })
  const node = {}
  const fakeApplyState = {
    systemRef: { tracer: tracer('system') },
    encryptionView: { ref: { tracer: tracer('encryption') } },
    views: [
      { ref: null },
      { ref: { tracer: tracer('view', [7]) } }
    ]
  }

  assert.doesNotThrow(() => ApplyState.prototype._startTrace.call(fakeApplyState, node))
  assert.doesNotThrow(() => ApplyState.prototype._endTrace.call(fakeApplyState, node))
  assert.deepEqual(node.trace, {
    system: [],
    encryption: [],
    user: [{ view: 1, blocks: [7] }]
  })
  assert.deepEqual(seen, ['start:system', 'start:encryption', 'start:view', 'end:system', 'end:encryption', 'end:view'])
})

test('PearBridge Autobase trace guard tolerates missing trace containers', () => {
  const emptyState = {
    systemRef: null,
    encryptionView: null
  }
  assert.doesNotThrow(() => ApplyState.prototype._startTrace.call(emptyState))
  assert.doesNotThrow(() => ApplyState.prototype._endTrace.call(emptyState))

  const node = {}
  const partialState = {
    systemRef: { tracer: { start () {}, end () { return null } } },
    encryptionView: {},
    views: [
      {},
      { ref: { tracer: { start () {}, end () { return [9] } } } }
    ]
  }
  assert.doesNotThrow(() => ApplyState.prototype._startTrace.call(partialState))
  assert.doesNotThrow(() => ApplyState.prototype._endTrace.call(partialState))
  assert.doesNotThrow(() => ApplyState.prototype._endTrace.call(partialState, node))
  assert.deepEqual(node.trace, {
    system: [],
    encryption: [],
    user: [{ view: 1, blocks: [9] }]
  })
})

test('PearBridge default reducer supports generic app writes', async () => {
  const { store, dir } = await newStore()
  try {
    const bridge = new PearBridge(store, stubSwarm())
    await bridge.createSyncGroup('generic-app')
    await bridge.append('generic-app', { type: 'probe:mobile', data: { id: 'one', note: 'default reducer probe' } })
    assert.deepEqual(await bridge.get('generic-app', 'probe!mobile!one'), { id: 'one', note: 'default reducer probe' })
    await bridge.close()
  } finally {
    await store.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})

test('PearBridge dedupes concurrent createSyncGroup calls for the same app id', async () => {
  const { store, dir } = await newStore()
  try {
    const bridge = new PearBridge(store, stubSwarm())
    const [first, second] = await Promise.all([
      bridge.createSyncGroup('in-flight-app'),
      bridge.createSyncGroup('in-flight-app')
    ])
    assert.equal(second.inviteKey, first.inviteKey)
    assert.equal(second.writerPublicKey, first.writerPublicKey)
    assert.equal(bridge._syncGroups.size, 1)
    await bridge.close()
  } finally {
    await store.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})

test('PearBridge createSyncGroup is open-or-create for an already-open app id', async () => {
  const { store, dir } = await newStore()
  try {
    const bridge = new PearBridge(store, stubSwarm())
    const first = await bridge.createSyncGroup('repeat-app')
    const second = await bridge.createSyncGroup('repeat-app')
    assert.equal(second.inviteKey, first.inviteKey)
    assert.equal(second.writerPublicKey, first.writerPublicKey)
    await bridge.joinSyncGroup('repeat-app', first.inviteKey)
    await assert.rejects(
      () => bridge.joinSyncGroup('repeat-app', 'a'.repeat(64)),
      /different invite key/
    )
    await bridge.close()
  } finally {
    await store.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})
