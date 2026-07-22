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

function serveProxy (proxy) {
  const server = http.createServer(async (req, res) => {
    try {
      await proxy._handle(req, res)
    } catch (err) {
      res.statusCode = 500
      res.end(err.message)
    }
  })
  server.__sockets = new Set()
  server.on('connection', (socket) => {
    server.__sockets.add(socket)
    socket.on('close', () => server.__sockets.delete(socket))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      proxy._port = server.address().port
      resolve(server)
    })
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

async function issueSseTicket (baseUrl, token, origin, channelId = CHANNEL_ID) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Pear-Token': token
  }
  if (origin) headers.Origin = origin
  const res = await fetch(`${baseUrl}/api/swarm/ticket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ channelId })
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.match(body.ticket, /^[0-9a-f]{64}$/)
  assert.equal(body.expiresInMs > 0, true)
  return body.ticket
}

test('/api/swarm/events uses one-time origin-scoped SSE tickets instead of query bearer tokens', async (t) => {
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
  const baseUrl = `http://127.0.0.1:${port}`

  const queryBearer = await fetch(`${baseUrl}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&token=${encodeURIComponent(issued.token)}`, {
    headers: { Origin: APP_ORIGIN }
  })
  assert.equal(queryBearer.status, 401)
  assert.match((await queryBearer.json()).error, /SSE ticket required/)

  const queryOnlyTicket = await fetch(`${baseUrl}/api/swarm/ticket?token=${encodeURIComponent(issued.token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN },
    body: JSON.stringify({ channelId: CHANNEL_ID })
  })
  assert.equal(queryOnlyTicket.status, 401)

  const ticket = await issueSseTicket(baseUrl, issued.token, APP_ORIGIN)
  const streamUrl = `${baseUrl}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&ticket=${encodeURIComponent(ticket)}`
  const accepted = await fetch(streamUrl, {
    headers: { Origin: APP_ORIGIN }
  })
  assert.equal(accepted.status, 200)
  assert.match(accepted.headers.get('content-type'), /^text\/event-stream\b/)
  assert.equal(await readFirstChunk(accepted), ': pear.swarm.v1 stream\n\n')
  assert.equal(swarmBridge.attached.length, 1)
  assert.equal(swarmBridge.attached[0].channelId, CHANNEL_ID)

  const reused = await fetch(streamUrl, {
    headers: { Origin: APP_ORIGIN }
  })
  assert.equal(reused.status, 401)
  assert.match((await reused.json()).error, /Invalid SSE ticket/)

  const wrongChannelTicket = await issueSseTicket(baseUrl, issued.token, APP_ORIGIN, 'other-channel')
  const wrongChannel = await fetch(`${baseUrl}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&ticket=${encodeURIComponent(wrongChannelTicket)}`, {
    headers: { Origin: APP_ORIGIN }
  })
  assert.equal(wrongChannel.status, 403)
  assert.match((await wrongChannel.json()).error, /channel mismatch/)

  const mismatchedTicket = await issueSseTicket(baseUrl, issued.token, APP_ORIGIN)
  const mismatched = await fetch(`${baseUrl}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&ticket=${encodeURIComponent(mismatchedTicket)}`, {
    headers: { Origin: OTHER_ORIGIN }
  })
  assert.equal(mismatched.status, 403)
  assert.match((await mismatched.json()).error, /Origin mismatch/)

  const missingOriginTicket = await issueSseTicket(baseUrl, issued.token, APP_ORIGIN)
  const missing = await fetch(`${baseUrl}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&ticket=${encodeURIComponent(missingOriginTicket)}`)
  assert.equal(missing.status, 403)
  assert.match((await missing.json()).error, /request from \(none\)/)
})

test('HyperProxy CORS uses SSE tickets for EventSource and never query bearer tokens', async (t) => {
  const proxy = freshProxy()
  const issued = proxy.issueOriginToken(APP_ORIGIN)
  const swarmBridge = makeSwarmBridge()
  const httpBridge = new HttpBridge(fakePearBridge(), null, null, {
    validateToken: (token) => proxy.validateApiToken(token),
    swarmBridge
  })
  proxy.setHttpBridge(httpBridge)
  const server = await serveProxy(proxy)
  t.after(() => closeServer(server))

  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}`

  const preflight = await fetch(`${baseUrl}/api/swarm/ticket`, {
    method: 'OPTIONS',
    headers: {
      Origin: APP_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-pear-token'
    }
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), APP_ORIGIN)

  const queryBearer = await fetch(`${baseUrl}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&token=${encodeURIComponent(issued.token)}`, {
    headers: { Origin: APP_ORIGIN }
  })
  assert.equal(queryBearer.status, 401)
  assert.notEqual(queryBearer.headers.get('access-control-allow-origin'), APP_ORIGIN)
  assert.match((await queryBearer.json()).error, /SSE ticket required/)

  const mint = await fetch(`${baseUrl}/api/swarm/ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Pear-Token': issued.token,
      Origin: APP_ORIGIN
    },
    body: JSON.stringify({ channelId: CHANNEL_ID })
  })
  assert.equal(mint.status, 200)
  assert.equal(mint.headers.get('access-control-allow-origin'), APP_ORIGIN)
  const minted = await mint.json()
  assert.match(minted.ticket, /^[0-9a-f]{64}$/)

  const accepted = await fetch(`${baseUrl}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&ticket=${encodeURIComponent(minted.ticket)}`, {
    headers: { Origin: APP_ORIGIN }
  })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get('access-control-allow-origin'), APP_ORIGIN)
  assert.match(accepted.headers.get('content-type'), /^text\/event-stream\b/)
  assert.equal(await readFirstChunk(accepted), ': pear.swarm.v1 stream\n\n')

  const reused = await fetch(`${baseUrl}/api/swarm/events?channelId=${encodeURIComponent(CHANNEL_ID)}&ticket=${encodeURIComponent(minted.ticket)}`, {
    headers: { Origin: APP_ORIGIN }
  })
  assert.equal(reused.status, 401)
  assert.notEqual(reused.headers.get('access-control-allow-origin'), APP_ORIGIN)
})

test('/api/sync scopes long drive keys to PearBridge-safe app ids without dropping isolation', async (t) => {
  const proxy = freshProxy()
  const driveA = 'a'.repeat(64)
  const driveB = 'b'.repeat(64)
  const tokenA = proxy.issueApiToken(driveA)
  const tokenB = proxy.issueApiToken(driveB)
  const seen = []
  const pearBridge = {
    _syncGroups: new Map(),
    async createSyncGroup (appId) {
      seen.push(appId)
      assert.match(appId, /^app_[0-9a-f]{32}$/)
      assert.ok(appId.length <= 64)
      return { appId, inviteKey: 'c'.repeat(64), writerPublicKey: 'd'.repeat(64) }
    }
  }
  const httpBridge = new HttpBridge(pearBridge, null, null, {
    validateToken: (token) => proxy.validateApiToken(token)
  })
  const server = await serveBridge(httpBridge)
  t.after(() => closeServer(server))

  const port = server.address().port
  for (const token of [tokenA, tokenB]) {
    const res = await fetch(`http://127.0.0.1:${port}/api/sync/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pear-Token': token },
      body: JSON.stringify({ appId: 'peerit' })
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.appId, 'peerit')
  }

  assert.equal(seen.length, 2)
  assert.notEqual(seen[0], seen[1])
})
