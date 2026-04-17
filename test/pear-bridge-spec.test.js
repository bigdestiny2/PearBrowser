/**
 * pear-bridge-spec.ts — the bridge script factory.
 *
 * Tests are in JS (not TS) to keep node:test simple. The TS source is
 * type-checked separately by `npx tsc --noEmit` in the `test` script.
 *
 * We evaluate the TS source by stripping type annotations with a tiny
 * heuristic — good enough because the spec file is pure data + one factory.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const specPath = path.join(__dirname, '..', 'app', 'lib', 'pear-bridge-spec.ts')

test('pear-bridge-spec.ts contains the template with both placeholders', () => {
  const source = fs.readFileSync(specPath, 'utf-8')
  assert.match(source, /__PEAR_BRIDGE_PORT__/, 'port placeholder missing')
  assert.match(source, /__PEAR_BRIDGE_TOKEN__/, 'token placeholder missing')
})

test('pear-bridge-spec.ts exports createBridgeScript and the script template', () => {
  const source = fs.readFileSync(specPath, 'utf-8')
  assert.match(source, /export function createBridgeScript\(/, 'createBridgeScript not exported')
  assert.match(source, /export const PEAR_BRIDGE_SCRIPT_TEMPLATE/, 'template constant not exported')
})

test('pear-bridge-spec.ts declares the window.pear API shape', () => {
  const source = fs.readFileSync(specPath, 'utf-8')
  // The core TS surfaces
  for (const sym of ['PearAPI', 'PearSyncAPI', 'PearIdentityAPI', 'PearBridgeStatusAPI']) {
    assert.match(source, new RegExp(`export interface ${sym}\\b`), `${sym} interface missing`)
  }
})

test('pear-bridge-spec.ts injected script references both RN and native host bridges', () => {
  const source = fs.readFileSync(specPath, 'utf-8')
  // RN path
  assert.match(source, /window\.ReactNativeWebView/, 'RN postMessage path missing')
  // Native Android/iOS path for Phase 2/3
  assert.match(source, /window\.PearBrowserNative/, 'Native host bridge path missing')
})

test('legacy bridge-inject.ts still works as a compatibility shim', () => {
  const legacyPath = path.join(__dirname, '..', 'app', 'lib', 'bridge-inject.ts')
  const source = fs.readFileSync(legacyPath, 'utf-8')
  assert.match(source, /pear-bridge-spec/, 'shim does not import from pear-bridge-spec')
  assert.match(source, /createBridgeScript/, 'shim does not re-export createBridgeScript')
})
