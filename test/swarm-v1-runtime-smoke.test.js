const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

require('./_stubs')
const { HttpBridge } = require('../backend/http-bridge')
const { SwarmBridge, deriveTierATopic } = require('../backend/swarm-bridge')

const root = path.join(__dirname, '..')
const DRIVE_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const TOKEN = 'swarm-smoke-token'
const SUBTOPIC = 'examples/echo-peer/runtime-smoke'

class FakeConnection extends EventEmitter {
  constructor () {
    super()
    this.writes = []
  }

  write (data) {
    this.writes.push(Buffer.from(data))
    return true
  }

  destroy () {
    this.emit('close')
  }
}

class FakeSwarm extends EventEmitter {
  constructor () {
    super()
    this.connections = new Set()
    this.joins = []
    this.discoveries = []
  }

  join (topic, opts) {
    const topicBuffer = Buffer.from(topic)
    this.joins.push({ topic: topicBuffer, opts: { ...opts } })
    const discovery = {
      destroyed: false,
      flushed: async () => {},
      destroy: async () => { discovery.destroyed = true }
    }
    this.discoveries.push(discovery)
    return discovery
  }

  connect (topicHex, conn = new FakeConnection()) {
    this.connections.add(conn)
    conn.once('close', () => this.connections.delete(conn))
    conn.once('error', () => this.connections.delete(conn))
    this.emit('connection', conn, {
      topics: [Buffer.from(topicHex, 'hex')],
      client: true,
      server: false
    })
    return conn
  }
}

class TestEventSource {
  constructor (url) {
    this.url = url
    this.readyState = 0
    this.onmessage = null
    this.onerror = null
    this._closed = false
    this._abort = new AbortController()
    this._read()
  }

  close () {
    this._closed = true
    this.readyState = 2
    this._abort.abort()
  }

  async _read () {
    try {
      const res = await fetch(this.url, { signal: this._abort.signal })
      if (!res.ok) throw new Error('EventSource HTTP ' + res.status)
      this.readyState = 1
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      while (!this._closed) {
        const chunk = await reader.read()
        if (chunk.done) break
        pending += decoder.decode(chunk.value, { stream: true })
        let boundary = pending.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = pending.slice(0, boundary)
          pending = pending.slice(boundary + 2)
          this._dispatch(frame)
          boundary = pending.indexOf('\n\n')
        }
      }
    } catch (err) {
      if (!this._closed && this.onerror) this.onerror(err)
    } finally {
      this.readyState = 2
    }
  }

  _dispatch (frame) {
    const data = []
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (data.length > 0 && this.onmessage) {
      this.onmessage({ data: data.join('\n') })
    }
  }
}

function fakePearBridge () {
  return {
    _syncGroups: new Map(),
    async createSyncGroup (appId) {
      return { appId, inviteKey: 'a'.repeat(64), writerPublicKey: 'b'.repeat(64) }
    },
    async joinSyncGroup (appId, inviteKey) {
      return { appId, inviteKey, writerPublicKey: 'b'.repeat(64) }
    },
    async append () { return { ok: true } },
    async get () { return null },
    async list () { return [] },
    async range () { return [] },
    async count () { return 0 },
    getSyncStatus () { return null }
  }
}

function makeLocalStorage () {
  const state = new Map()
  return {
    getItem: (key) => state.has(key) ? state.get(key) : null,
    setItem: (key, value) => state.set(key, String(value)),
    removeItem: (key) => state.delete(key)
  }
}

function bridgeScript (port) {
  const source = fs.readFileSync(path.join(root, 'app/lib/pear-bridge-spec.ts'), 'utf-8')
  const match = source.match(/export const PEAR_BRIDGE_SCRIPT_TEMPLATE: string = `([\s\S]*?)`/)
  assert.ok(match, 'bridge template not found')
  return match[1]
    .replaceAll('__PEAR_BRIDGE_PORT__', String(port))
    .replaceAll('__PEAR_BRIDGE_TOKEN__', JSON.stringify(TOKEN))
}

function serveBridge (httpBridge) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const handled = await httpBridge.handle(req, res, url)
    if (!handled) {
      res.statusCode = 404
      res.end('not found')
    }
  })
  server.__sockets = new Set()
  server.on('connection', (socket) => {
    server.__sockets.add(socket)
    socket.on('close', () => server.__sockets.delete(socket))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function closeServer (server) {
  for (const socket of server.__sockets || []) socket.destroy()
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
}

function onceChannelEvent (channel, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for ' + event)), 1000)
    channel.on(event, function () {
      clearTimeout(timer)
      resolve(Array.from(arguments))
    })
  })
}

async function waitFor (predicate, label) {
  const start = Date.now()
  while (Date.now() - start < 1000) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for ' + label)
}

function installBrowserGlobals (port) {
  const previous = {
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    EventSource: global.EventSource
  }
  const localStorage = makeLocalStorage()
  global.window = {
    location: { search: '' },
    __pearBridgeInjected: false
  }
  global.document = {
    title: 'Echo Peer Smoke'
  }
  global.localStorage = localStorage
  global.window.localStorage = localStorage
  global.EventSource = TestEventSource
  new Function(bridgeScript(port))()
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]
      else global[key] = value
    }
  }
}

test('examples/echo-peer exercises swarm.v1 join, event stream, send, and leave', async (t) => {
  const fixture = fs.readFileSync(path.join(root, 'examples/echo-peer/index.html'), 'utf-8')
  assert.match(fixture, /window\.pear\.swarm\.v1/, 'fixture must feature-detect swarm.v1')
  assert.match(fixture, /join\(null,\s*\{[\s\S]*subtopic/, 'fixture must call join(null, { subtopic })')

  const fakeSwarm = new FakeSwarm()
  const swarmBridge = new SwarmBridge(fakeSwarm, {
    requestConsent: async () => {
      throw new Error('Tier A subtopic joins must not request consent')
    }
  })
  const httpBridge = new HttpBridge(fakePearBridge(), fakeSwarm, null, {
    validateToken: (token) => token === TOKEN
      ? { driveKeyHex: DRIVE_KEY, token, kind: 'drive' }
      : null,
    swarmBridge
  })
  const server = await serveBridge(httpBridge)
  t.after(async () => {
    await closeServer(server)
    await swarmBridge.destroy()
  })

  const port = server.address().port
  const restoreGlobals = installBrowserGlobals(port)
  t.after(restoreGlobals)

  const expectedTopic = deriveTierATopic(DRIVE_KEY, SUBTOPIC)
  const channel = await window.pear.swarm.v1.join(null, {
    subtopic: SUBTOPIC,
    protocol: 'pear.echo-peer.v1',
    version: 1,
    server: true,
    client: true,
    appName: 'Echo Peer Smoke'
  })

  assert.equal(channel.topicHex, expectedTopic)
  assert.equal(channel.tier, 'A')
  assert.equal(channel.protocol, 'pear.echo-peer.v1')
  assert.equal(fakeSwarm.joins.length, 1)
  assert.equal(fakeSwarm.joins[0].topic.toString('hex'), expectedTopic)
  assert.deepEqual(fakeSwarm.joins[0].opts, { server: true, client: true })

  const peerEvent = onceChannelEvent(channel, 'peer')
  const conn = fakeSwarm.connect(channel.topicHex)
  const [peer] = await peerEvent
  assert.equal(peer.pubkey, null)
  assert.equal(channel.peers.length, 1)

  peer.send(new TextEncoder().encode('ping'))
  await waitFor(() => conn.writes.length === 1, 'outbound send')
  assert.equal(conn.writes[0].toString(), 'ping')

  const messageEvent = onceChannelEvent(channel, 'message')
  conn.emit('data', Buffer.from('pong'))
  const [messagePeer, data] = await messageEvent
  assert.equal(messagePeer.id, peer.id)
  assert.equal(new TextDecoder().decode(data), 'pong')

  const closedEvent = onceChannelEvent(channel, 'closed')
  channel.destroy()
  await closedEvent
  await waitFor(() => swarmBridge.channels.size === 0, 'channel leave')
  assert.throws(() => peer.send(new TextEncoder().encode('after-close')), /channel destroyed/)
  assert.equal(fakeSwarm.discoveries[0].destroyed, true)
})
