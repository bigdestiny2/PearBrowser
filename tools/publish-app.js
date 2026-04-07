#!/usr/bin/env node

/**
 * publish-app — Publish a P2P app to the PearBrowser catalog
 *
 * Creates a Hyperdrive from a directory, adds a manifest, and
 * announces it on the DHT so catalog relays can discover it.
 *
 * Usage:
 *   node publish-app.js ./my-app --name "My App" --description "Does things"
 *
 * The directory must contain at least index.html.
 * A manifest.json will be created if it doesn't exist.
 */

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import b4a from 'b4a'
import sodium from 'sodium-universal'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, basename } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import minimist from 'minimist'

const APP_ANNOUNCE_TOPIC = b4a.alloc(32)
sodium.crypto_generichash(APP_ANNOUNCE_TOPIC, b4a.from('pearbrowser-apps-v1'))

const args = minimist(process.argv.slice(2))
const appDir = args._[0]

if (!appDir || !existsSync(appDir)) {
  console.log(`
publish-app — Publish a P2P app to PearBrowser

Usage:
  node publish-app.js <directory> [options]

Options:
  --name <name>           App name (default: directory name)
  --description <desc>    Short description
  --author <name>         Author name
  --category <cat>        Category (utilities, productivity, communication, games)
  --storage <path>        Storage path for the Hyperdrive

The directory must contain index.html.
`)
  process.exit(appDir ? 1 : 0)
}

async function main () {
  if (!existsSync(join(appDir, 'index.html'))) {
    console.error('Error: directory must contain index.html')
    process.exit(1)
  }

  const name = args.name || basename(appDir)
  const description = args.description || ''
  const author = args.author || 'anonymous'
  const category = args.category || 'utilities'
  const storagePath = args.storage || join(tmpdir(), 'pearbrowser-publish-' + randomBytes(4).toString('hex'))

  console.log(`Publishing "${name}"...`)

  const store = new Corestore(storagePath)
  const drive = new Hyperdrive(store)
  await drive.ready()

  // Write all files from the directory to the Hyperdrive
  const files = getAllFiles(appDir)
  for (const file of files) {
    const relPath = '/' + relative(appDir, file).replace(/\\/g, '/')
    const content = readFileSync(file)
    await drive.put(relPath, content)
    console.log(`  + ${relPath} (${content.length} bytes)`)
  }

  // Create manifest if it doesn't exist in the source
  if (!existsSync(join(appDir, 'manifest.json'))) {
    const manifest = {
      name,
      version: '1.0.0',
      description,
      author,
      icon: existsSync(join(appDir, 'icon.png')) ? '/icon.png' : null,
      entry: '/index.html',
      categories: [category],
      permissions: []
    }
    await drive.put('/manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
    console.log('  + /manifest.json (generated)')
  }

  // Start swarming
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => store.replicate(conn))

  // Join the app's own discovery topic
  swarm.join(drive.discoveryKey, { server: true, client: false })

  // Announce on the catalog discovery topic
  swarm.join(APP_ANNOUNCE_TOPIC, { server: true, client: false })

  await swarm.flush()

  const key = drive.key.toString('hex')
  console.log()
  console.log('=== App Published ===')
  console.log()
  console.log(`  Name:        ${name}`)
  console.log(`  Key:         ${key}`)
  console.log(`  URL:         hyper://${key}`)
  console.log(`  Files:       ${files.length}`)
  console.log()
  console.log('  The app is now discoverable by catalog relays.')
  console.log('  Keep this process running to serve the app.')
  console.log('  Press Ctrl+C to stop.')
  console.log()

  process.on('SIGINT', async () => {
    console.log('\n  Stopping...')
    await swarm.destroy()
    await drive.close()
    await store.close()
    process.exit(0)
  })
}

function getAllFiles (dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...getAllFiles(full))
    } else {
      results.push(full)
    }
  }
  return results
}

main().catch(err => { console.error('Error:', err.message); process.exit(1) })
