#!/usr/bin/env node
'use strict'

/** Build the Kotlin shell's BareKit AAR from the installed runtime and addons. */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const ANDROID = path.join(ROOT, 'node_modules', 'react-native-bare-kit', 'android')
const CORE = path.join(ANDROID, 'libs', 'bare-kit')
const ADDONS = path.join(ANDROID, 'src', 'main', 'addons')
const LINKER = path.join(ANDROID, 'link.mjs')
const DEST = path.join(ROOT, 'android-native', 'app', 'libs', 'bare-kit.aar')
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']

function bail (message) {
  console.error(`[barekit:android] ${message}`)
  process.exit(1)
}

function requireFile (file) {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) bail(`missing ${file}`)
}

function namesIn (directory) {
  return fs.readdirSync(directory).sort()
}

function checkAbiDirectories (directory, label) {
  const actual = namesIn(directory).filter((name) => fs.statSync(path.join(directory, name)).isDirectory())
  if (actual.join(',') !== [...ABIS].sort().join(',')) {
    bail(`${label} ABI set is ${actual.join(',')}; expected ${ABIS.join(',')}`)
  }
}

for (const name of ['AndroidManifest.xml', 'classes.jar']) requireFile(path.join(CORE, name))
requireFile(LINKER)
checkAbiDirectories(path.join(CORE, 'jni'), 'BareKit')
for (const abi of ABIS) requireFile(path.join(CORE, 'jni', abi, 'libbare-kit.so'))

// bare-link writes into an existing directory without pruning old versions.
// Start clean so a dependency update cannot leave stale native libraries in
// the package beside the current worklet's expected addon names.
fs.rmSync(ADDONS, { recursive: true, force: true })
const linked = spawnSync(process.execPath, [LINKER], { cwd: ROOT, encoding: 'utf8' })
if (linked.error || linked.status !== 0) {
  bail(`addon linker failed: ${linked.error?.message || linked.stderr || linked.stdout || linked.status}`)
}
checkAbiDirectories(ADDONS, 'Addon')
const expected = namesIn(path.join(ADDONS, ABIS[0]))
if (expected.length === 0 || expected.some((name) => !/^lib[\w.-]+\.so$/.test(name))) {
  bail(`invalid addon manifest for ${ABIS[0]}: ${expected.join(',')}`)
}
for (const abi of ABIS) {
  const actual = namesIn(path.join(ADDONS, abi))
  if (actual.join(',') !== expected.join(',')) bail(`${abi} addon manifest differs from ${ABIS[0]}`)
  for (const name of actual) requireFile(path.join(ADDONS, abi, name))
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pearbrowser-barekit-aar-'))
try {
  const stage = path.join(temporary, 'stage')
  fs.mkdirSync(path.join(stage, 'jni'), { recursive: true })
  for (const name of ['AndroidManifest.xml', 'classes.jar', 'R.txt']) {
    const source = path.join(CORE, name)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(stage, name))
  }
  for (const abi of ABIS) {
    const target = path.join(stage, 'jni', abi)
    fs.mkdirSync(target)
    fs.copyFileSync(path.join(CORE, 'jni', abi, 'libbare-kit.so'), path.join(target, 'libbare-kit.so'))
    for (const name of expected) fs.copyFileSync(path.join(ADDONS, abi, name), path.join(target, name))
  }
  const archive = path.join(temporary, 'bare-kit.aar')
  const zip = spawnSync('zip', ['-qr', archive, '.'], { cwd: stage, stdio: 'inherit' })
  if (zip.error || zip.status !== 0) {
    const jar = spawnSync('jar', ['cf', archive, '.'], { cwd: stage, stdio: 'inherit' })
    if (jar.error || jar.status !== 0) bail(`AAR archive failed: ${jar.error?.message || jar.status}`)
  }
  const size = fs.statSync(archive).size
  if (size < 1024 * 1024) bail(`created AAR is only ${size} bytes`)
  fs.mkdirSync(path.dirname(DEST), { recursive: true })
  fs.renameSync(archive, DEST)
  console.log(`[barekit:android] Wrote ${DEST} (${Math.round(size / 1024 / 1024)} MiB; ${expected.length} addons x ${ABIS.length} ABIs)`)
  console.log(`[barekit:android] Addons: ${expected.join(', ')}`)
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
