#!/usr/bin/env node

/**
 * catalog-relay — Discovers P2P apps on the DHT and builds a catalog
 *
 * Joins the 'pearbrowser-apps-v1' DHT topic as a client.
 * When it discovers app publishers, it reads their manifest.json,
 * validates it, and adds the app to a catalog Hyperdrive.
 *
 * Also serves the catalog via HTTP for PearBrowser's fast-path.
 *
 * Usage:
 *   node catalog-relay.js [--port 9200] [--storage ./catalog-storage]
 */

import { createServer } from 'http'
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import b4a from 'b4a'
import sodium from 'sodium-universal'
import minimist from 'minimist'

const APP_ANNOUNCE_TOPIC = b4a.alloc(32)
sodium.crypto_generichash(APP_ANNOUNCE_TOPIC, b4a.from('pearbrowser-apps-v1'))

const args = minimist(process.argv.slice(2))
const port = args.port || 9200
const storagePath = args.storage || './catalog-storage'

const apps = new Map() // driveKeyHex → { manifest, discoveredAt }
let catalogDrive = null

async function main () {
  const store = new Corestore(storagePath)
  await store.ready()

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn, info) => {
    store.replicate(conn)
    handleNewPeer(conn, info, store, swarm)
  })

  // Create the catalog Hyperdrive (writable, we own it)
  catalogDrive = new Hyperdrive(store)
  await catalogDrive.ready()
  swarm.join(catalogDrive.discoveryKey, { server: true, client: false })

  // Join the app announcement topic to discover publishers
  swarm.join(APP_ANNOUNCE_TOPIC, { server: false, client: true })

  await swarm.flush()

  console.log(`Catalog Relay`)
  console.log(`  Catalog key: ${catalogDrive.key.toString('hex')}`)
  console.log(`  Listening for app announcements on DHT...`)

  // Write initial empty catalog
  await updateCatalog()

  // Start HTTP server
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const url = new URL(req.url, `http://localhost:${port}`)

    if (url.pathname === '/health') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        ok: true,
        type: 'catalog-relay',
        apps: apps.size,
        catalogKey: catalogDrive.key.toString('hex')
      }))
      return
    }

    if (url.pathname === '/catalog.json') {
      const content = await catalogDrive.get('/catalog.json')
      res.setHeader('Content-Type', 'application/json')
      res.end(content || JSON.stringify({ version: 1, name: 'PearBrowser Catalog', apps: [] }))
      return
    }

    // Register a new app (developer submits their drive key)
    if (req.method === 'POST' && url.pathname === '/v1/register') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', async () => {
        try {
          const { driveKey } = JSON.parse(body)
          if (!driveKey || driveKey.length < 52) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: 'Invalid driveKey' }))
            return
          }

          // Open the app's drive and read its manifest
          const appDrive = new Hyperdrive(store, Buffer.from(driveKey, 'hex'))
          await appDrive.ready()

          // Join swarm to replicate
          swarm.join(appDrive.discoveryKey, { server: true, client: true })
          await swarm.flush()

          // Wait for manifest to arrive
          let manifest = null
          const startTime = Date.now()
          while (Date.now() - startTime < 30000) {
            const buf = await appDrive.get('/manifest.json').catch(() => null)
            if (buf) {
              manifest = JSON.parse(buf.toString())
              break
            }
            await new Promise(r => setTimeout(r, 1000))
          }

          if (!manifest) {
            res.writeHead(404)
            res.end(JSON.stringify({ error: 'Could not find manifest.json in drive — is the app published?' }))
            return
          }

          await registerApp(driveKey, manifest, store)

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            ok: true,
            app: { name: manifest.name, key: driveKey },
            catalogKey: catalogDrive.key.toString('hex')
          }))
        } catch (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    // Serve catalog files via gateway pattern
    if (url.pathname.startsWith('/v1/hyper/')) {
      const rest = url.pathname.slice('/v1/hyper/'.length)
      const slash = rest.indexOf('/')
      const keyHex = slash === -1 ? rest : rest.slice(0, slash)
      let filePath = slash === -1 ? '/' : rest.slice(slash)
      if (filePath.endsWith('/')) filePath += 'index.html'

      // Serve from catalog drive or any discovered app drive
      try {
        let drive
        if (keyHex === catalogDrive.key.toString('hex')) {
          drive = catalogDrive
        } else {
          drive = new Hyperdrive(store, Buffer.from(keyHex, 'hex'))
          await drive.ready()
        }
        const content = await drive.get(filePath)
        if (content) {
          const ext = filePath.split('.').pop()
          const types = { html: 'text/html', css: 'text/css', js: 'application/javascript', json: 'application/json', png: 'image/png' }
          res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
          res.setHeader('X-Served-By', 'catalog-relay')
          res.end(content)
          return
        }
      } catch {}

      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`  HTTP: http://0.0.0.0:${port}`)
    console.log(`  Catalog: http://localhost:${port}/catalog.json`)
    console.log()
  })

  process.on('SIGINT', async () => {
    console.log('\n  Shutting down...')
    server.close()
    await swarm.destroy()
    await catalogDrive.close()
    await store.close()
    process.exit(0)
  })
}

async function handleNewPeer (conn, info, store, swarm) {
  if (!info.publicKey) return
  const peerKeyHex = b4a.toString(info.publicKey, 'hex')

  // Don't re-process known apps
  if (apps.has(peerKeyHex)) return

  // Try to read this peer's Hyperdrive manifest
  // The peer's public key IS the drive key (they announced from the same swarm)
  // Actually, the peer might be serving multiple drives — we need to discover them
  // For now, attempt to open a drive with the peer's key
  setTimeout(async () => {
    try {
      await tryDiscoverApp(peerKeyHex, store, swarm)
    } catch {}
  }, 2000) // Small delay to let replication start
}

async function tryDiscoverApp (peerKeyHex, store, swarm) {
  // The peer announced on the apps topic — they should also be serving
  // a Hyperdrive. We need to find it by trying to open drives that
  // are available from this peer.
  //
  // Strategy: the peer's app drive key is sent via the Protomux channel
  // For simplicity in MVP, we check if any drive from this peer has
  // a manifest.json by trying the peer's public key as a drive key.
  //
  // In production, the announcement protocol would include the drive key.

  // For now, scan connections for drives with manifest.json
  for (const conn of swarm.connections) {
    // This is a simplification — in production, use a proper announcement protocol
  }
}

async function registerApp (driveKeyHex, manifest, store) {
  if (apps.has(driveKeyHex)) return

  // Validate manifest
  if (!manifest.name || !manifest.entry) {
    console.log(`  [skip] Invalid manifest from ${driveKeyHex.slice(0, 12)}...`)
    return
  }

  apps.set(driveKeyHex, {
    manifest,
    discoveredAt: Date.now()
  })

  console.log(`  [+] Discovered: ${manifest.name} (${driveKeyHex.slice(0, 12)}...)`)

  await updateCatalog()
}

async function updateCatalog () {
  const catalog = {
    version: 1,
    name: 'PearBrowser Open Catalog',
    updatedAt: new Date().toISOString(),
    apps: [...apps.entries()].map(([key, entry]) => ({
      id: entry.manifest.name.toLowerCase().replace(/\s+/g, '-'),
      name: entry.manifest.name,
      description: entry.manifest.description || '',
      author: entry.manifest.author || 'anonymous',
      version: entry.manifest.version || '1.0.0',
      driveKey: key,
      icon: entry.manifest.icon || null,
      categories: entry.manifest.categories || ['uncategorized'],
      discoveredAt: entry.discoveredAt
    }))
  }

  await catalogDrive.put('/catalog.json', Buffer.from(JSON.stringify(catalog, null, 2)))
}

// Export for programmatic use
export { registerApp, updateCatalog, APP_ANNOUNCE_TOPIC }

main().catch(err => { console.error('Error:', err.message); process.exit(1) })
