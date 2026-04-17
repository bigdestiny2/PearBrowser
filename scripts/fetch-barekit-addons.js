#!/usr/bin/env node
/**
 * fetch-barekit-addons.js
 *
 * Mirrors the pre-built native addon xcframeworks from
 * `node_modules/react-native-bare-kit/ios/addons/` into
 * `ios-native/PearBrowser/Frameworks/addons/`.
 *
 * Also mirrors the RN-matched BareKit.xcframework so the iOS native
 * shell uses the same runtime version the RN shell does (keeps the
 * addon ABIs in sync).
 *
 * Re-run whenever:
 *   - You `npm install` for the first time
 *   - `react-native-bare-kit` is bumped in package.json
 *
 * The copied files are gitignored (see ios-native/.gitignore).
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SRC_ROOT = path.join(ROOT, 'node_modules', 'react-native-bare-kit', 'ios')
const DST_ROOT = path.join(ROOT, 'ios-native', 'PearBrowser', 'Frameworks')

function log(msg) { console.log(`[barekit:addons] ${msg}`) }
function bail(msg) { console.error(`[barekit:addons] ${msg}`); process.exit(1) }

if (!fs.existsSync(SRC_ROOT)) {
  bail(`${SRC_ROOT} not found — run 'npm install' first.`)
}

const SRC_ADDONS = path.join(SRC_ROOT, 'addons')
const SRC_BAREKIT = path.join(SRC_ROOT, 'BareKit.xcframework')
const DST_ADDONS = path.join(DST_ROOT, 'addons')
const DST_BAREKIT = path.join(DST_ROOT, 'BareKit.xcframework')

fs.mkdirSync(DST_ROOT, { recursive: true })

// ---- BareKit.xcframework ----
if (!fs.existsSync(SRC_BAREKIT)) {
  bail(`${SRC_BAREKIT} missing — is react-native-bare-kit installed?`)
}
log('Mirroring BareKit.xcframework…')
if (fs.existsSync(DST_BAREKIT)) execSync(`rm -rf "${DST_BAREKIT}"`)
execSync(`cp -R "${SRC_BAREKIT}" "${DST_BAREKIT}"`)

// The RN-shipped xcframework omits module.modulemap (RN's import path
// doesn't need Swift modules). Add it so `import BareKit` works from
// the bare-kit-swift SPM package.
const MODULEMAP = `framework module BareKit {
  umbrella header "BareKit.h"
  export *
  module * { export * }
}
`
for (const slice of ['ios-arm64', 'ios-arm64_x86_64-simulator']) {
  const moduleDir = path.join(DST_BAREKIT, slice, 'BareKit.framework', 'Modules')
  if (!fs.existsSync(moduleDir)) fs.mkdirSync(moduleDir, { recursive: true })
  fs.writeFileSync(path.join(moduleDir, 'module.modulemap'), MODULEMAP)
}
log('  patched BareKit.xcframework with module.modulemap (needed by bare-kit-swift SPM)')

// ---- Addons ----
if (!fs.existsSync(SRC_ADDONS)) {
  bail(`${SRC_ADDONS} missing — has react-native-bare-kit's postinstall link step run?`)
}
if (fs.existsSync(DST_ADDONS)) execSync(`rm -rf "${DST_ADDONS}"`)
fs.mkdirSync(DST_ADDONS, { recursive: true })

const addons = fs.readdirSync(SRC_ADDONS).filter((n) => n.endsWith('.xcframework'))
if (addons.length === 0) bail('No addon xcframeworks found in node_modules/react-native-bare-kit/ios/addons/')

log(`Mirroring ${addons.length} addons…`)
for (const addon of addons) {
  execSync(`cp -R "${path.join(SRC_ADDONS, addon)}" "${path.join(DST_ADDONS, addon)}"`)
  process.stdout.write(`  ${addon}\n`)
}

// ---- Check project.yml references each addon ----
const projectYml = path.join(ROOT, 'ios-native', 'project.yml')
if (fs.existsSync(projectYml)) {
  const yml = fs.readFileSync(projectYml, 'utf-8')
  const missing = addons.filter((a) => !yml.includes(a))
  if (missing.length > 0) {
    log(`⚠️  These addon versions are NOT referenced in ios-native/project.yml:`)
    missing.forEach((a) => log(`     - ${a}`))
    log('   Add them under `dependencies:` (embed: true) and re-run `xcodegen generate`.')
  }
}

log(`✓ Done. Run: cd ios-native && xcodegen generate && xcodebuild …`)
