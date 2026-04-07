#!/usr/bin/env node

/**
 * End-to-end catalog test
 *
 * 1. Publishes Calculator and Notes apps as Hyperdrives
 * 2. Creates a catalog with both apps
 * 3. Serves the catalog via HTTP gateway
 *
 * Run from hiverelay dir (has deps):
 *   node /Users/localllm/Desktop/PearBrowser/test/start-catalog-test.js
 */

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import { createServer } from 'http'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

const SAMPLE_APPS_DIR = '/Users/localllm/Desktop/PearBrowser/test/sample-apps'
const storage = join(tmpdir(), 'pearbrowser-catalog-test-' + randomBytes(4).toString('hex'))

function getAllFiles (dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) results.push(...getAllFiles(full))
    else results.push(full)
  }
  return results
}

async function publishApp (store, swarm, appDir) {
  const drive = new Hyperdrive(store)
  await drive.ready()

  const files = getAllFiles(appDir)
  for (const file of files) {
    const relPath = '/' + relative(appDir, file).replace(/\\/g, '/')
    await drive.put(relPath, readFileSync(file))
  }

  swarm.join(drive.discoveryKey, { server: true, client: false })

  const manifest = JSON.parse(readFileSync(join(appDir, 'manifest.json'), 'utf-8'))
  return { drive, key: drive.key.toString('hex'), manifest }
}

async function main () {
  console.log('Starting catalog test environment...\n')

  const store = new Corestore(storage)
  await store.ready()

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => store.replicate(conn))

  // Publish sample apps
  const calc = await publishApp(store, swarm, join(SAMPLE_APPS_DIR, 'calculator'))
  console.log(`  Calculator: ${calc.key}`)

  const notes = await publishApp(store, swarm, join(SAMPLE_APPS_DIR, 'notes'))
  console.log(`  Notes:      ${notes.key}`)

  // Create catalog drive
  const catalogDrive = new Hyperdrive(store)
  await catalogDrive.ready()

  const catalog = {
    version: 1,
    name: 'PearBrowser Test Catalog',
    updatedAt: new Date().toISOString(),
    apps: [
      {
        id: 'calculator',
        name: calc.manifest.name,
        description: calc.manifest.description,
        author: calc.manifest.author,
        version: calc.manifest.version,
        driveKey: calc.key,
        categories: calc.manifest.categories
      },
      {
        id: 'notes',
        name: notes.manifest.name,
        description: notes.manifest.description,
        author: notes.manifest.author,
        version: notes.manifest.version,
        driveKey: notes.key,
        categories: notes.manifest.categories
      }
    ]
  }

  await catalogDrive.put('/catalog.json', Buffer.from(JSON.stringify(catalog, null, 2)))
  swarm.join(catalogDrive.discoveryKey, { server: true, client: false })

  await swarm.flush()

  const catalogKey = catalogDrive.key.toString('hex')

  // HTTP gateway serving catalog + app content
  const PORT = 9200
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const url = new URL(req.url, `http://localhost:${PORT}`)

    if (url.pathname === '/health') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, type: 'catalog-relay', apps: catalog.apps.length, catalogKey }))
      return
    }

    if (url.pathname === '/catalog.json') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(catalog, null, 2))
      return
    }

    // Gateway: /v1/hyper/KEY/path
    if (url.pathname.startsWith('/v1/hyper/')) {
      const rest = url.pathname.slice('/v1/hyper/'.length)
      const slash = rest.indexOf('/')
      const keyHex = slash === -1 ? rest : rest.slice(0, slash)
      let filePath = slash === -1 ? '/' : rest.slice(slash)
      if (filePath.endsWith('/')) filePath += 'index.html'

      // Find the drive
      let drive = null
      if (keyHex === catalogKey) drive = catalogDrive
      else if (keyHex === calc.key) drive = calc.drive
      else if (keyHex === notes.key) drive = notes.drive

      if (!drive) {
        // Try opening from store (for P2P-replicated drives)
        try {
          drive = new Hyperdrive(store, Buffer.from(keyHex, 'hex'))
          await drive.ready()
          if (drive.version === 0) { res.writeHead(404); res.end('Not seeded'); return }
        } catch { res.writeHead(404); res.end('Not found'); return }
      }

      const content = await drive.get(filePath).catch(() => null)
      if (!content) { res.writeHead(404); res.end('File not found'); return }

      const ext = filePath.split('.').pop()
      const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'application/javascript', json: 'application/json', png: 'image/png' }
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
      res.setHeader('X-Served-By', 'catalog-relay')
      res.end(content)
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.listen(PORT, '0.0.0.0', () => {
    console.log()
    console.log('=== Catalog Test Environment Ready ===')
    console.log()
    console.log(`  Catalog key:  ${catalogKey}`)
    console.log(`  HTTP:         http://localhost:${PORT}`)
    console.log(`  Catalog JSON: http://localhost:${PORT}/catalog.json`)
    console.log()
    console.log('  Test URLs:')
    console.log(`    curl http://localhost:${PORT}/v1/hyper/${calc.key}/index.html`)
    console.log(`    curl http://localhost:${PORT}/v1/hyper/${notes.key}/index.html`)
    console.log()
    console.log('  For PearBrowser App Store, enter this catalog key:')
    console.log(`    ${catalogKey}`)
    console.log()
    console.log('  Press Ctrl+C to stop.')
  })

  process.on('SIGINT', async () => {
    console.log('\n  Shutting down...')
    server.close()
    await swarm.destroy()
    await store.close()
    process.exit(0)
  })
}

main().catch(err => { console.error('Error:', err.message); process.exit(1) })
