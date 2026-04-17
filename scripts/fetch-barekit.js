#!/usr/bin/env node
/**
 * fetch-barekit.js
 *
 * Downloads the latest bare-kit prebuilds archive from Holepunch and
 * places the iOS BareKit.xcframework (JavaScriptCore variant, required
 * for App Store compliance) into ios-native/PearBrowser/Frameworks/.
 *
 * Usage: npm run barekit:fetch
 *
 * The JSC-variant is REQUIRED for iOS because Apple prohibits apps that
 * bundle a separate JS engine with JIT enabled. bare-kit's V8 variant
 * would be App-Store-rejected. See
 * https://developer.apple.com/documentation/appstore/review
 * "Rule 2.5.6".
 *
 * Android takes a different path — see android-native/BUILD.md for the
 * .jar drop-in. This script only handles iOS today.
 */

const fs = require('fs')
const https = require('https')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const VERSION = process.env.BAREKIT_VERSION || 'v2.0.2'
const URL = `https://github.com/holepunchto/bare-kit/releases/download/${VERSION}/prebuilds.zip`
const DEST = path.join(__dirname, '..', 'ios-native', 'PearBrowser', 'Frameworks')
const TMP = path.join(os.tmpdir(), `barekit-${Date.now()}`)

function log(msg) { console.log(`[barekit:fetch] ${msg}`) }
function bail(msg, code = 1) { console.error(`[barekit:fetch] ${msg}`); process.exit(code) }

async function download(url, dest) {
  log(`Downloading ${url}`)
  log(`  → ${dest}`)
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          file.close(); fs.unlinkSync(dest)
          return get(res.headers.location)
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} fetching ${u}`))
          return
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        let lastPct = -1
        res.on('data', (chunk) => {
          downloaded += chunk.length
          if (total > 0) {
            const pct = Math.floor((downloaded / total) * 100)
            if (pct !== lastPct && pct % 10 === 0) {
              log(`  ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`)
              lastPct = pct
            }
          }
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
      }).on('error', reject)
    }
    get(url)
  })
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true })
  fs.mkdirSync(DEST, { recursive: true })

  const zipPath = path.join(TMP, 'prebuilds.zip')
  try {
    await download(URL, zipPath)
  } catch (err) {
    bail(`Download failed: ${err.message}`)
  }

  log('Unzipping…')
  try {
    execSync(`unzip -q "${zipPath}"`, { cwd: TMP })
  } catch {
    bail('unzip failed — is the unzip tool installed?')
  }

  const src = path.join(TMP, 'apple-javascriptcore', 'BareKit.xcframework')
  if (!fs.existsSync(src)) {
    bail(`Could not find apple-javascriptcore/BareKit.xcframework in archive. Contents:\n${
      fs.readdirSync(TMP).join('\n')}`)
  }

  const dst = path.join(DEST, 'BareKit.xcframework')
  if (fs.existsSync(dst)) {
    log('Removing existing BareKit.xcframework')
    execSync(`rm -rf "${dst}"`)
  }
  log(`Moving framework to ${dst}`)
  execSync(`mv "${src}" "${dst}"`)

  log('Cleaning up')
  execSync(`rm -rf "${TMP}"`)

  log(`\u2713 BareKit ${VERSION} installed (JSC variant, App Store compliant)`)
  log(`\u2192 Next: cd ios-native && xcodegen generate && xcodebuild ...`)
  log(`\u2192 See ios-native/BUILD.md for the full build recipe`)
}

main().catch((err) => bail(err.message || String(err)))
