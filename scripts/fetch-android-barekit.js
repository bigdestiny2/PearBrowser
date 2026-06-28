#!/usr/bin/env node
'use strict'

/**
 * Mirrors react-native-bare-kit's exploded Android bare-kit artifact into the
 * native Kotlin shell as an AAR. This keeps cold CI and fresh developer clones
 * aligned with the release-preflight expectation without committing binaries.
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'node_modules', 'react-native-bare-kit', 'android', 'libs', 'bare-kit')
const DEST_DIR = path.join(ROOT, 'android-native', 'app', 'libs')
const DEST = path.join(DEST_DIR, 'bare-kit.aar')

function log (message) {
  console.log(`[barekit:android] ${message}`)
}

function bail (message) {
  console.error(`[barekit:android] ${message}`)
  process.exit(1)
}

function ensureSource () {
  for (const rel of ['AndroidManifest.xml', 'classes.jar']) {
    if (!fs.existsSync(path.join(SRC, rel))) {
      bail(`${path.join(SRC, rel)} missing — run npm ci first.`)
    }
  }
  const jni = path.join(SRC, 'jni')
  if (!fs.existsSync(jni) || !fs.readdirSync(jni).length) {
    bail(`${jni} missing or empty — react-native-bare-kit did not install native libraries.`)
  }
}

function runArchiver () {
  const zip = spawnSync('zip', ['-qr', DEST, '.'], { cwd: SRC, stdio: 'inherit' })
  if (!zip.error && zip.status === 0) return

  log('zip was unavailable or failed; falling back to jar.')
  const jar = spawnSync('jar', ['cf', DEST, '.'], { cwd: SRC, stdio: 'inherit' })
  if (jar.error) bail(jar.error.message)
  if (jar.status !== 0) bail(`jar exited with status ${jar.status}`)
}

ensureSource()
fs.mkdirSync(DEST_DIR, { recursive: true })
fs.rmSync(DEST, { force: true })
runArchiver()

const size = fs.statSync(DEST).size
if (size < 1024 * 1024) {
  bail(`created ${DEST}, but it is only ${size} bytes`)
}

log(`Wrote ${DEST} (${Math.round(size / 1024 / 1024)} MiB)`)
