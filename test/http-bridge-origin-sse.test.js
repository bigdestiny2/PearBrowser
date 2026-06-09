const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

require('./_stubs')

const { HttpBridge } = require('../backend/http-bridge')
const { HyperProxy } = require('../backend/hyper-proxy')

const APP_ORIGIN = 'https://app.example'
const OTHER_ORIGIN = 'https://other.example'
const CHANNEL_ID = 'channel-1'

function freshProxy () {
  return new HyperProxy(async () => null, () => {}, null)
}

function fakePearBridge () {
  return {
    _syncGroups: new Map()
  }
}

function makeSwarmBridge () {
  const attached = []
  return {
    attached,
    attachStream (channelId, stream) {
      attached.push({ channelId, stream })
    }
  }
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

async function readFirstChunk (res) {
  const reader = res.body.getReader()
  try {
    const chunk = await reader.read()
    assert.equal(chunk.done, false)
    return new TextDecoder().decode(chunk.value)
  } finally {
    await reader.cancel()
  }
}

test('/api/swarm/events accepts an origin-scoped pear.session() token from the EventSource query string only for the matching origin', async (t) => {
  const proxy = freshProxy()
  const issued = proxy.issueOriginToken(APP_ORIGIN)
  const swarmBridge = makeSwarmBridge()
  const httpBridge = new HttpBridge(fakePearBridge(), null, null, {
    validateToken: (token) => proxy.validateApiToken(token),
    swarmBridge
  })
  const server = await serveBridge(httpBridge)
  t.after(() => closeServer(server))

  const port = server.address().port
  const streamUrl = `http://127.0.0.1:${port}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&token=${encodeURIComponent(issued.token)}`

  const accepted = await fetch(streamUrl, {
    headers: { Origin: APP_ORIGIN }
  })
  assert.equal(accepted.status, 200)
  assert.match(accepted.headers.get('content-type'), /^text\/event-stream\b/)
  assert.equal(await readFirstChunk(accepted), ': pear.swarm.v1 stream\n\n')
  assert.equal(swarmBridge.attached.length, 1)
  assert.equal(swarmBridge.attached[0].channelId, CHANNEL_ID)

  const mismatched = await fetch(streamUrl, {
    headers: { Origin: OTHER_ORIGIN }
  })
  assert.equal(mismatched.status, 403)
  assert.match((await mismatched.json()).error, /Origin mismatch/)

  const missing = await fetch(streamUrl)
  assert.equal(missing.status, 403)
  assert.match((await missing.json()).error, /request from \(none\)/)
})
