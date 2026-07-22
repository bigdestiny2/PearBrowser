'use strict'

/**
 * TabRuntime + Ask Browser mobile parity audit (Mission B4b).
 *
 * Asserts the shipped surfaces line up with the desktop (pearbrowser-desktop
 * backend/tab-runtime.js + backend/ai/): backend command/event ids (same
 * numeric ids as the desktop), the Android Protocol.kt mirror, RPC client
 * wrappers, backend handlers + boot wiring with the documented gates, and the
 * honest Settings availability card (no fake Ask Browser panel).
 *
 * Like plugins-parity.test.js / shield-parity.test.js this checks the Android
 * mirror only; iOS / RN shells are out of scope.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

// Same numbering as pearbrowser-desktop backend/constants.js.
const b4bCommands = {
  RUN_APP_IN_TAB: 201,
  ASK_BROWSER_CAPABILITIES: 220,
  ASK_BROWSER_START: 221,
  ASK_BROWSER_CANCEL: 222
}

test('B4b command ids match the desktop numbering in backend constants', () => {
  const backend = require('../backend/constants')
  for (const [name, id] of Object.entries(b4bCommands)) {
    assert.equal(backend[`CMD_${name}`], id, `backend CMD_${name} id mismatch`)
  }
  assert.equal(backend.EVT_ASK_BROWSER_STREAM, 111, 'backend EVT_ASK_BROWSER_STREAM id mismatch')
})

test('Android Protocol.kt mirrors the B4b command + event ids', () => {
  const kt = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt')
  for (const [name, id] of Object.entries(b4bCommands)) {
    assert.match(kt, new RegExp(`const val ${name} = ${id}\\b`), `Protocol.kt: ${name} id mismatch`)
  }
  assert.match(kt, /const val ASK_BROWSER_STREAM = 111\b/, 'Protocol.kt: ASK_BROWSER_STREAM id mismatch')
})

test('Android PearRpcClient.kt exposes typed wrappers for every B4b command', () => {
  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  for (const name of Object.keys(b4bCommands)) {
    assert.match(client, new RegExp(`Cmd\\.${name}\\b`), `PearRpcClient must call Cmd.${name}`)
  }
  for (const fn of ['runAppInTab', 'askBrowserCapabilities', 'askBrowserStart', 'askBrowserCancel']) {
    assert.match(client, new RegExp(`suspend fun ${fn}\\b`), `PearRpcClient missing ${fn}()`)
  }
  // The capabilities data class carries the honest contract fields.
  for (const field of ['available', 'reason', 'models', 'activeStreams']) {
    assert.match(client, new RegExp(`val ${field}\\b`), `PearAskCapabilities missing ${field}`)
  }
})

test('backend registers the B4b handlers with the documented gates', () => {
  const index = read('backend/index.js')
  assert.match(index, /rpc\.handle\(C\.CMD_RUN_APP_IN_TAB/, 'RUN_APP_IN_TAB handler missing')
  assert.match(index, /rpc\.handle\(C\.CMD_ASK_BROWSER_CAPABILITIES/, 'ASK_BROWSER_CAPABILITIES handler missing')
  assert.match(index, /rpc\.handle\(C\.CMD_ASK_BROWSER_START/, 'ASK_BROWSER_START handler missing')
  assert.match(index, /rpc\.handle\(C\.CMD_ASK_BROWSER_CANCEL/, 'ASK_BROWSER_CANCEL handler missing')
  // The Ask Browser stream event is the desktop id.
  assert.match(index, /rpc\.event\(C\.EVT_ASK_BROWSER_STREAM/, 'Ask Browser emit wiring missing')
  // Gate 1: the tab runtime boots with no pear-run injector (fail-closed worker path).
  assert.match(index, /new TabRuntime\(\{ pearRun: null \}\)/, 'tabRuntime must boot with pearRun: null')
  // Gate 2: the AI service has no runtime loader, and getAiService throws the
  // typed unavailable error instead of returning a mock.
  assert.match(index, /createLazyQvacService\(\{/, 'aiService wiring missing')
  assert.match(index, /'runtime-unavailable'/, "typed 'runtime-unavailable' gate missing")
  assert.doesNotMatch(index, /available:\s*true/, 'capabilities must never hardcode available:true')
  // Shutdown releases all three surfaces.
  assert.match(index, /askBrowserService\.close\(\)/, 'shutdown must close askBrowserService')
  assert.match(index, /tabRuntime\.stop\(\)/, 'shutdown must stop tabRuntime')
})

test('the tab runtime module carries the ported worker gate', () => {
  const runtime = read('backend/tab-runtime.cjs')
  assert.match(runtime, /class TabRuntimeError\b/, 'TabRuntimeError missing')
  assert.match(runtime, /get workerSupported\b/, 'workerSupported getter missing')
  assert.match(runtime, /code === 'EADDRINUSE'|err\.code === 'EADDRINUSE'/, 'WS port scan must be kept')
  // Fail-closed at open time (the mobile adaptation) with the typed code.
  assert.match(runtime, /source !== 'demo' && !this\.workerSupported/, 'open() must gate worker links')
  assert.match(runtime, /'runtime-unavailable'/, 'gate must use the typed runtime-unavailable code')
})

test('ported modules stay dependency-free and reference no uninstalled QVAC packages', () => {
  // A bare-pack bundle cannot resolve modules that are not installed, so the
  // gated runtime must never be require()d anywhere in backend/.
  for (const rel of [
    'backend/index.js',
    'backend/tab-runtime.cjs',
    'backend/page-context-bridge.cjs',
    'backend/ai/ask-browser-service.cjs',
    'backend/ai/qvac-service.cjs',
    'backend/ai/qvac-host.cjs',
    'backend/ai/qvac-model-catalog.cjs',
    'backend/ai/qvac-ollama-catalog.cjs'
  ]) {
    const source = read(rel)
    assert.doesNotMatch(source, /require\(['"]@qvac\//, `${rel} must not require @qvac/* (gated runtime)`)
    assert.doesNotMatch(source, /require\(['"]pear-run['"]\)/, `${rel} must not require pear-run (no spawn path)`)
  }
})

test('tab assets are the desktop files (port fidelity spot-checks)', () => {
  const wrapper = read('backend/tab-assets/wrapper.html')
  assert.match(wrapper, /<head>/, 'wrapper.html must keep the <head> injection point')
  const assets = require('../backend/tab-assets/assets.js')
  assert.equal(typeof assets.wrapper, 'string')
  assert.equal(typeof assets.htmx, 'string')
  assert.equal(typeof assets.client, 'string')
  assert.ok(assets.wrapper.includes('<head>'), 'assets.wrapper must match wrapper.html')
  const router = require('../backend/tab-assets/router.cjs')
  assert.equal(typeof router.PearRequestRouter, 'function', 'router.cjs must export PearRequestRouter')
  assert.equal(typeof router.registerRoutes, 'function', 'router.cjs must export registerRoutes')
  // The page context bridge hash is the desktop value (shim body unchanged).
  const bridge = require('../backend/page-context-bridge.cjs')
  assert.equal(bridge.PAGE_CONTEXT_SHIM_HASH, 'Ezsg1K1z6HgITs7nybkuhSs36nhUJs78Cv7riGX9PpU=')
})

test('Android Settings ships an honest availability card and no fake Ask Browser panel', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /OnDeviceAiSection\(\)/, 'Settings must include the On-device AI section')
  assert.match(screen, /askBrowserCapabilities\(\)/, 'The card must read live capabilities')
  assert.match(screen, /Unavailable on this build/, 'The card must state unavailability plainly')
  // No chat entry point, input field, or streaming UI may ship while gated:
  // the only Ask Browser surface is the status card.
  assert.doesNotMatch(screen, /askBrowserStart\(/, 'Settings must not start Ask Browser streams')
  const panelGlob = 'android-native/app/src/main/java/com/pearbrowser/app/ui/screens'
  for (const file of fs.readdirSync(panelGlob)) {
    if (!file.endsWith('.kt')) continue
    assert.ok(!/^AskBrowser/i.test(file), `gated runtime must not ship an Ask Browser panel: ${file}`)
  }
})
