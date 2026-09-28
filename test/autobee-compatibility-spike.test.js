// Autobee 2.12.1 compatibility spike. This uses disposable Corestores only;
// existing Autobase + Hyperbee browser data is intentionally outside its scope.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Autobee = require('autobee')
const Corestore = require('corestore')
const b4a = require('b4a')

const keyHex = (key) => b4a.toString(key, 'hex')
const encode = (op) => b4a.from(JSON.stringify(op))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until (label, check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await pause(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function apply (nodes, view, host) {
  for (const node of nodes) {
    const op = JSON.parse(b4a.toString(node.value))
    if (op.type === 'grant') {
      await host.addWriter(b4a.from(op.writer, 'hex'), { isIndexer: true })
      continue
    }
    // A pure reducer: peers derive the same view even if concurrent writes
    // arrive in different network order and must be undone and reapplied.
    if (op.type !== 'set' || typeof op.key !== 'string' || typeof op.value !== 'string') continue
    const batch = view.write()
    batch.tryPut(b4a.from(op.key), b4a.from(op.value))
    await batch.flush()
  }
}

async function openBee (dir, bootstrap = null) {
  const store = new Corestore(dir)
  await store.ready()
  const trusted = new Set(bootstrap ? [keyHex(bootstrap)] : [])
  const db = new Autobee(store, bootstrap, {
    apply,
    optimistic: false,
    isTrusted: (key) => trusted.has(keyHex(key)),
    // v2.12.1 otherwise permits sparse fast-forward by default. This spike
    // does not establish a production trust or whole-view availability policy.
    fastForward: false
  })
  try {
    await db.ready()
    trusted.add(keyHex(db.local.key))
    return db
  } catch (error) {
    await store.close()
    throw error
  }
}

async function value (db, key) {
  await db.update()
  const entry = await db.view.get(b4a.from(key))
  return entry ? b4a.toString(entry.value) : null
}

function wire (a, b) {
  const left = a.replicate(true)
  const right = b.replicate(false)
  left.pipe(right).pipe(left)
  return () => { left.destroy(); right.destroy() }
}

test('Autobee 2.12.1 persists a derived view across a full Corestore reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pearbrowser-autobee-persist-'))
  let db = null
  try {
    db = await openBee(dir)
    const bootstrap = b4a.from(db.key)
    await db.append(encode({ type: 'set', key: 'bookmark', value: 'hyper://example' }))
    await until('initial view', async () => (await value(db, 'bookmark')) === 'hyper://example')
    await db.close()
    db = null
    db = await openBee(dir, bootstrap)
    assert.equal(await value(db, 'bookmark'), 'hyper://example')
  } finally {
    if (db) await db.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Autobee 2.12.1 grants a second writer and converges concurrent updates', async () => {
  const dirA = await mkdtemp(join(tmpdir(), 'pearbrowser-autobee-a-'))
  const dirB = await mkdtemp(join(tmpdir(), 'pearbrowser-autobee-b-'))
  let a = null
  let b = null
  let unwire = null
  try {
    a = await openBee(dirA)
    b = await openBee(dirB, a.key)
    unwire = wire(a, b)
    await a.append(encode({ type: 'grant', writer: keyHex(b.local.key) }))
    await until('second writer permission', async () => { await b.update(); return b.writable })
    await Promise.all([
      a.append([
        encode({ type: 'set', key: 'writer-a', value: 'seen' }),
        encode({ type: 'set', key: 'shared', value: 'from A' })
      ]),
      b.append([
        encode({ type: 'set', key: 'writer-b', value: 'seen' }),
        encode({ type: 'set', key: 'shared', value: 'from B' })
      ])
    ])
    await until('both views converge', async () => {
      const av = await value(a, 'shared')
      const bv = await value(b, 'shared')
      return av !== null && av === bv &&
        (await value(a, 'writer-a')) === 'seen' && (await value(a, 'writer-b')) === 'seen' &&
        (await value(b, 'writer-a')) === 'seen' && (await value(b, 'writer-b')) === 'seen'
    })
    assert.ok(['from A', 'from B'].includes(await value(a, 'shared')))
    assert.equal(await value(a, 'shared'), await value(b, 'shared'))
  } finally {
    if (unwire) unwire()
    if (a) await a.close()
    if (b) await b.close()
    await rm(dirA, { recursive: true, force: true })
    await rm(dirB, { recursive: true, force: true })
  }
})
