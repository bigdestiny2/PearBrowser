#!/usr/bin/env node

/**
 * Test Hyperdrive Server
 *
 * Creates a Hyperdrive with sample content and serves it on the real DHT.
 * The hyper:// key is printed so you can browse it in PearBrowser.
 *
 * Run from hiverelay dir (has all deps):
 *   NODE_PATH=/Users/localllm/hiverelay/node_modules node test/serve-test-drive.js
 */

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import path from 'path'

const storage = path.join(tmpdir(), 'pearbrowser-testdrive-' + randomBytes(4).toString('hex'))

async function main () {
  console.log('Creating test Hyperdrive...')
  console.log('Storage:', storage)

  const store = new Corestore(storage)
  const drive = new Hyperdrive(store)
  await drive.ready()

  // Write a sample website
  await drive.put('/index.html', Buffer.from(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PearBrowser Test Site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>Welcome to the P2P Web</h1>
    <p class="subtitle">This page is served from a Hyperdrive over Hyperswarm</p>
  </header>
  <main>
    <section class="card">
      <h2>How it works</h2>
      <p>This content is being served directly from a peer on the network.
         There is no server, no CDN, no cloud. Just peers.</p>
    </section>
    <section class="card">
      <h2>What you are seeing</h2>
      <ul>
        <li>HTML served from a Hyperdrive</li>
        <li>CSS loaded via relative link</li>
        <li>Discovered via the HyperDHT</li>
        <li>Connected via UDP hole-punching</li>
        <li>Encrypted end-to-end with Noise protocol</li>
      </ul>
    </section>
    <section class="card">
      <h2>Links</h2>
      <p><a href="about.html">About this site</a></p>
      <p><a href="data.json">Raw JSON data</a></p>
    </section>
  </main>
  <footer>
    <p>Served by PearBrowser Test Drive</p>
  </footer>
</body>
</html>`))

  await drive.put('/style.css', Buffer.from(`
:root { --accent: #ff9500; --bg: #0a0a0a; --surface: #1a1a1a; --text: #e0e0e0; --muted: #888; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
header { text-align: center; padding: 60px 20px 40px; }
h1 { color: var(--accent); font-size: 2em; margin-bottom: 8px; }
.subtitle { color: var(--muted); font-size: 1.1em; }
main { max-width: 600px; margin: 0 auto; padding: 0 20px 60px; }
.card { background: var(--surface); border-radius: 12px; padding: 24px; margin-bottom: 16px; }
.card h2 { color: var(--accent); font-size: 1.2em; margin-bottom: 12px; }
.card ul { padding-left: 20px; }
.card li { margin-bottom: 6px; }
a { color: var(--accent); }
footer { text-align: center; padding: 40px; color: var(--muted); font-size: 0.85em; }
`))

  await drive.put('/about.html', Buffer.from(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>About - PearBrowser Test Site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>About</h1>
    <p class="subtitle">This is a test site for PearBrowser</p>
  </header>
  <main>
    <section class="card">
      <p>PearBrowser is a P2P mobile app platform built on the Holepunch stack.
         It uses Bare Kit to run Hyperswarm on iOS, connecting your phone
         directly to other peers on the network.</p>
      <p style="margin-top: 12px;"><a href="index.html">Back to home</a></p>
    </section>
  </main>
</body>
</html>`))

  await drive.put('/data.json', Buffer.from(JSON.stringify({
    name: 'PearBrowser Test Site',
    version: '1.0.0',
    created: new Date().toISOString(),
    features: ['hyper://', 'P2P', 'Hyperdrive', 'Hyperswarm'],
    message: 'If you can read this, P2P browsing works!'
  }, null, 2)))

  // Join the swarm
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => {
    store.replicate(conn)
    console.log('  Peer connected!')
  })

  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  const key = drive.key.toString('hex')
  console.log()
  console.log('=== Test Hyperdrive is live ===')
  console.log()
  console.log('  Key:  ' + key)
  console.log('  URL:  hyper://' + key)
  console.log()
  console.log('  Files:')
  console.log('    /index.html   — Home page')
  console.log('    /style.css    — Stylesheet')
  console.log('    /about.html   — About page')
  console.log('    /data.json    — JSON data')
  console.log()
  console.log('  Serving on the DHT. Press Ctrl+C to stop.')
  console.log()

  process.on('SIGINT', async () => {
    console.log('\n  Shutting down...')
    await swarm.destroy()
    await drive.close()
    await store.close()
    console.log('  Done.')
    process.exit(0)
  })
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
