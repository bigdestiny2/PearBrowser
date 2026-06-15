const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

require('./_stubs')
const { HttpBridge } = require('../backend/http-bridge')
const { SwarmBridge, deriveTierATopic } = require('../backend/swarm-bridge')
const { duplexPair, MockPeer } = require('./helpers/protomux-pair')

const root = path.join(__dirname, '..')
const DRIVE_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const TOKEN = 'swarm-smoke-token'
const SUBTOPIC = 'examples/echo-peer/runtime-smoke'

// Full mux protocol the bridge pairs on for a given page-chosen protocol.
function muxProtocol (protocol) {
  return 'pear.swarm.v1/' + protocol
}

// A FakeSwarm whose connections are real Protomux-capable byte Duplex pairs.
// The bridge listens on swarm.on('connection') and runs Protomux.from() on the
// connection it is handed; the test drives the *other* end via a MockPeer that
// opens the matching (protocol, topic) sub-channel.
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

  /**
   * Simulate a peer connecting. Emits the bridge's end through 'connection'
   * and returns a MockPeer wrapping the remote end so the test can open
   * matching mux sub-channels.
   *
   * @param {object} [info] — overrides the PeerInfo (client/server roles).
   */
  connectPeer (info = { client: false, server: true }) {
    const [bridgeEnd, peerEnd] = duplexPair()
    this.connections.add(bridgeEnd)
    bridgeEnd.once('close', () => this.connections.delete(bridgeEnd))
    bridgeEnd.once('error', () => this.connections.delete(bridgeEnd))
    // info.topics deliberately omitted: with Protomux pairing the topic match
    // comes from the (protocol, id) the remote opens, NOT from info.topics.
    this.emit('connection', bridgeEnd, info)
    return new MockPeer(peerEnd)
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

  // Bring up a remote peer that speaks Protomux and opens the SAME
  // (protocol, topic) sub-channel. Protomux pairing — not info.topics — is
  // what attributes it to this channel, so the page sees exactly one peer.
  const peerEvent = onceChannelEvent(channel, 'peer')
  const mockPeer = fakeSwarm.connectPeer({ client: false, server: true })
  const remoteReceived = []
  const remoteChannel = mockPeer.openChannel({
    protocol: muxProtocol('pear.echo-peer.v1'),
    id: Buffer.from(channel.topicHex, 'hex'),
    onmessage: (buf) => remoteReceived.push(buf)
  })
  const [peer] = await peerEvent
  assert.equal(peer.pubkey, null)
  assert.equal(channel.peers.length, 1)

  // Page → peer: the framed payload must arrive verbatim on the remote's
  // c.raw message (channel-level assertion, replacing the old raw conn.writes
  // check).
  peer.send(new TextEncoder().encode('ping'))
  await waitFor(() => remoteReceived.length === 1, 'remote received ping')
  assert.equal(new TextDecoder().decode(remoteReceived[0]), 'ping')

  // Peer → page: the page receives it through the channel 'message' event,
  // decoded back to the original bytes.
  const messageEvent = onceChannelEvent(channel, 'message')
  remoteChannel.send(new TextEncoder().encode('pong'))
  const [messagePeer, data] = await messageEvent
  assert.equal(messagePeer.id, peer.id)
  assert.equal(new TextDecoder().decode(data), 'pong')

  const closedEvent = onceChannelEvent(channel, 'closed')
  channel.destroy()
  await closedEvent
  await waitFor(() => swarmBridge.channels.size === 0, 'channel leave')
  assert.throws(() => peer.send(new TextEncoder().encode('after-close')), /channel destroyed/)
  assert.equal(fakeSwarm.discoveries[0].destroyed, true)

  mockPeer.destroy()
})

// Drives a Channel directly through an in-memory stream collector, so we can
// assert exactly which page events each logical channel sees — no HTTP/SSE in
// the loop. Mirrors the stream contract SwarmBridge.attachStream expects.
function collectStream () {
  const events = []
  const stream = {
    send (ev) { events.push(ev) },
    close () {},
    onClose () {}
  }
  return { events, stream }
}

function peerIdsOf (events) {
  return events.filter(e => e.type === 'peer').map(e => e.peerId)
}

function messagesFor (events, peerId) {
  return events
    .filter(e => e.type === 'message' && e.peerId === peerId)
    .map(e => Buffer.from(e.data, 'base64').toString())
}

test('two swarm.v1 channels (same protocol, different topics) multiplex over ONE connection without cross-delivery', async (t) => {
  const PROTOCOL = 'pear.echo-peer.v1'
  const SUB_A = 'examples/echo-peer/mux-a'
  const SUB_B = 'examples/echo-peer/mux-b'

  const fakeSwarm = new FakeSwarm()
  const swarmBridge = new SwarmBridge(fakeSwarm, {
    requestConsent: async () => { throw new Error('Tier A must not prompt') }
  })
  t.after(async () => { await swarmBridge.destroy() })

  // Two logical channels from the same drive/app: same protocol, distinct
  // (Tier A derived) topics.
  const joinA = await swarmBridge.join({
    driveKeyHex: DRIVE_KEY, appName: 'mux', subtopic: SUB_A,
    protocol: PROTOCOL, version: 1, server: true, client: true
  })
  const joinB = await swarmBridge.join({
    driveKeyHex: DRIVE_KEY, appName: 'mux', subtopic: SUB_B,
    protocol: PROTOCOL, version: 1, server: true, client: true
  })
  assert.notEqual(joinA.topicHex, joinB.topicHex, 'topics must differ')

  const a = collectStream()
  const b = collectStream()
  swarmBridge.attachStream(joinA.channelId, a.stream)
  swarmBridge.attachStream(joinB.channelId, b.stream)

  // ONE connection. Both bridge channels open their sub-channels on it; the
  // remote opens BOTH matching (protocol, topic) sub-channels over the same
  // socket.
  const mockPeer = fakeSwarm.connectPeer({ client: false, server: true })
  assert.equal(fakeSwarm.connections.size, 1, 'exactly one underlying connection')

  const remoteA = mockPeer.openChannel({
    protocol: muxProtocol(PROTOCOL),
    id: Buffer.from(joinA.topicHex, 'hex')
  })
  const remoteB = mockPeer.openChannel({
    protocol: muxProtocol(PROTOCOL),
    id: Buffer.from(joinB.topicHex, 'hex')
  })

  // Each channel should pair exactly one peer.
  await waitFor(() => peerIdsOf(a.events).length === 1 && peerIdsOf(b.events).length === 1,
    'both channels paired one peer each')
  const peerA = peerIdsOf(a.events)[0]
  const peerB = peerIdsOf(b.events)[0]

  // Remote sends a distinct payload on each sub-channel.
  remoteA.send(Buffer.from('only-for-A'))
  remoteB.send(Buffer.from('only-for-B'))

  await waitFor(() => messagesFor(a.events, peerA).length === 1 && messagesFor(b.events, peerB).length === 1,
    'each channel received its own message')

  // Each channel got ONLY its own payload — no cross-delivery.
  assert.deepEqual(messagesFor(a.events, peerA), ['only-for-A'])
  assert.deepEqual(messagesFor(b.events, peerB), ['only-for-B'])
  assert.equal(a.events.filter(e => e.type === 'message').length, 1, 'A saw exactly one message')
  assert.equal(b.events.filter(e => e.type === 'message').length, 1, 'B saw exactly one message')

  // And page→peer direction stays namespaced too.
  swarmBridge.send(joinA.channelId, peerA, Buffer.from('to-A').toString('base64'))
  swarmBridge.send(joinB.channelId, peerB, Buffer.from('to-B').toString('base64'))
  await waitFor(() => remoteA.received.length === 1 && remoteB.received.length === 1,
    'remote received per-channel payloads')
  assert.equal(remoteA.received[0].toString(), 'to-A')
  assert.equal(remoteB.received[0].toString(), 'to-B')

  mockPeer.destroy()
})
