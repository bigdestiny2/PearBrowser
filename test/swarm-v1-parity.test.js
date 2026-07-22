const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

require('./_stubs')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

test('backend exposes swarm.v1 constants and modules', () => {
  const constants = read('backend/constants.js')
  for (const name of [
    'CMD_SWARM_RESOLVE',
    'CMD_SWARM_LIST_GRANTS',
    'CMD_SWARM_REVOKE_GRANT',
    'CMD_SWARM_REVOKE_ALL_FOR_APP',
    'EVT_SWARM_REQUEST'
  ]) {
    assert.match(constants, new RegExp(`\\b${name}\\b`), `${name} missing`)
  }

  assert.ok(fs.existsSync(path.join(root, 'backend/swarm-bridge.js')), 'swarm-bridge.js missing')
  assert.ok(fs.existsSync(path.join(root, 'backend/swarm-grants.js')), 'swarm-grants.js missing')
})

test('platform command mirrors include swarm.v1 ids', () => {
  const files = [
    'app/lib/constants.ts',
    'ios-native/PearBrowser/Sources/RPC/Protocol.swift',
    'android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt'
  ]
  for (const rel of files) {
    const source = read(rel)
    assert.match(source, /SWARM_RESOLVE[^0-9]+120/, `${rel}: SWARM_RESOLVE id mismatch`)
    assert.match(source, /SWARM_LIST_GRANTS[^0-9]+121/, `${rel}: SWARM_LIST_GRANTS id mismatch`)
    assert.match(source, /SWARM_REVOKE_GRANT[^0-9]+122/, `${rel}: SWARM_REVOKE_GRANT id mismatch`)
    assert.match(source, /SWARM_REVOKE_ALL_FOR_APP[^0-9]+123/, `${rel}: SWARM_REVOKE_ALL_FOR_APP id mismatch`)
    assert.match(source, /SWARM_REQUEST[^0-9]+107/, `${rel}: SWARM_REQUEST id mismatch`)
  }
})

test('all injected bridge templates expose window.pear.swarm.v1', () => {
  const files = [
    'app/lib/pear-bridge-spec.ts',
    'ios-native/PearBrowser/Sources/Bridge/PearBridgeScript.swift',
    'android-native/app/src/main/java/com/pearbrowser/app/bridge/PearBridgeScript.kt'
  ]
  for (const rel of files) {
    const source = read(rel)
    assert.match(source, /\/api\/swarm\/join/, `${rel}: join endpoint missing`)
    assert.match(source, /\/api\/swarm\/ticket/, `${rel}: SSE ticket endpoint missing`)
    assert.match(source, /\/api\/swarm\/events/, `${rel}: events endpoint missing`)
    assert.match(source, /&ticket=/, `${rel}: EventSource must use a one-time SSE ticket`)
    assert.doesNotMatch(source, /\/api\/swarm\/events\?channelId=[\s\S]{0,200}&token=/, `${rel}: EventSource must not put bearer tokens in the URL`)
    assert.match(source, /EventSource/, `${rel}: EventSource stream missing`)
    assert.match(source, /swarm:\s*\{[\s\S]*v1:/, `${rel}: window.pear.swarm.v1 missing`)
  }
})

test('backend-injected swarm shim uses one-time SSE tickets', () => {
  const source = read('backend/pear-bridge.js')
  assert.match(source, /PEAR_SWARM_V1_SHIM/, 'backend swarm shim missing')
  assert.match(source, /\/api\/swarm\/ticket/, 'backend shim ticket endpoint missing')
  assert.match(source, /&ticket=/, 'backend shim EventSource must use a one-time SSE ticket')
  assert.doesNotMatch(source, /\/api\/swarm\/events\?channelId=[\s\S]{0,200}&token=/,
    'backend shim must not put bearer tokens in the EventSource URL')
  assert.match(source, /window\.pear\.swarm\.v1/, 'backend shim does not expose window.pear.swarm.v1')
})

test('echo-peer fixture covers the drive-derived swarm.v1 join shape', () => {
  const htmlPath = path.join(root, 'examples/echo-peer/index.html')
  const manifestPath = path.join(root, 'examples/echo-peer/manifest.json')
  assert.ok(fs.existsSync(htmlPath), 'examples/echo-peer/index.html missing')
  assert.ok(fs.existsSync(manifestPath), 'examples/echo-peer/manifest.json missing')

  const html = fs.readFileSync(htmlPath, 'utf-8')
  assert.match(html, /window\.pear\.swarm\.v1/, 'fixture must feature-detect swarm.v1')
  assert.match(html, /join\(null,\s*\{[\s\S]*subtopic/, 'fixture must call join(null, { subtopic })')
  assert.match(html, /channel\.on\('peer'/, 'fixture must listen for peer events')
  assert.match(html, /channel\.on\('message'/, 'fixture must listen for messages')
  assert.match(html, /channel\.destroy\(\)/, 'fixture must leave/destroy the channel')
})

test('hyper proxy injects per-response bridge token and swarm shim for HTML', () => {
  const source = read('backend/hyper-proxy.js')
  assert.match(source, /setPearSwarmShim/, 'setPearSwarmShim missing')
  assert.match(source, /pear-api-token/, 'api token meta injection missing')
  assert.match(source, /_serveHtmlWithBridge/, 'HTML bridge injection helper missing')
})

test('hyper proxy base href matches the loopback request host', () => {
  const { HyperProxy } = require('../backend/hyper-proxy')
  const key = 'a'.repeat(64)

  function render (host) {
    const proxy = Object.create(HyperProxy.prototype)
    proxy._port = 9876
    proxy._pearSwarmShim = ''
    proxy.issueApiToken = () => 't'.repeat(64)
    const res = {
      headers: {},
      statusCode: 0,
      body: '',
      setHeader (name, value) { this.headers[name] = value },
      end (buf) { this.body = Buffer.from(buf).toString('utf8') }
    }
    proxy._serveHtmlWithBridge(
      { headers: { host } },
      res,
      `/hyper/${key}/`,
      key,
      Buffer.from('<!doctype html><html><head></head><body>ok</body></html>')
    )
    return res.body
  }

  assert.match(render('127.0.0.1:9876'), new RegExp(`<base href="http://127\\.0\\.0\\.1:9876/hyper/${key}/">`))
  assert.match(render('localhost:9876'), new RegExp(`<base href="http://localhost:9876/hyper/${key}/">`))
  assert.match(render('localhost.evil.test:9876'), new RegExp(`<base href="http://127\\.0\\.0\\.1:9876/hyper/${key}/">`))
  assert.match(render('127.0.0.1:9999'), new RegExp(`<base href="http://127\\.0\\.0\\.1:9876/hyper/${key}/">`))
})

test('mobile shells surface and resolve swarm consent requests', () => {
  const rnRpc = read('app/lib/rpc.ts')
  assert.match(rnRpc, /swarmResolve\(requestId: string, approved: boolean\)/, 'RN swarmResolve helper missing')

  const rnApp = read('app/App.tsx')
  assert.match(rnApp, /EVT\.SWARM_REQUEST/, 'RN shell does not listen for SWARM_REQUEST')
  assert.match(rnApp, /resolveSwarmConsent/, 'RN shell does not resolve swarm consent')
  assert.match(rnApp, /Direct swarm access/, 'RN shell does not show swarm consent copy')

  const androidEvents = read('android-native/app/src/main/java/com/pearbrowser/app/bridge/PearWorkletEvents.kt')
  assert.match(androidEvents, /ACTION_SWARM_REQUEST/, 'Android swarm request broadcast missing')
  assert.match(androidEvents, /ACTION_RESOLVE_SWARM/, 'Android swarm resolve broadcast missing')

  const androidService = read('android-native/app/src/main/java/com/pearbrowser/app/bridge/PearWorkletService.kt')
  assert.match(androidService, /Evt\.SWARM_REQUEST/, 'Android service does not listen for SWARM_REQUEST')
  assert.match(androidService, /swarmResolve/, 'Android service does not resolve swarm consent')

  const androidActivity = read('android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt')
  assert.match(androidActivity, /SwarmConsentDialog/, 'Android UI does not present swarm consent')
  assert.match(androidActivity, /sendSwarmDecision/, 'Android UI does not send swarm consent decisions')
})
