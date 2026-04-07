/**
 * PearBrowser — Bare Worklet Backend
 *
 * The P2P engine that powers PearBrowser. Runs inside a Bare worklet
 * on the phone. Manages Hyperswarm connections, app store catalog,
 * site publishing, and the HTTP proxy for WebView content.
 */

const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')
const fs = require('bare-fs')
const { WorkletRPC } = require('./rpc.js')
const { HyperProxy } = require('./hyper-proxy.js')
const { RelayClient } = require('./relay-client.js')
const { CatalogManager } = require('./catalog-manager.js')
const { AppManager } = require('./app-manager.js')
const { SiteManager } = require('./site-manager.js')
const { PearBridge } = require('./pear-bridge.js')
const C = require('./constants.js')

const { IPC } = BareKit
const storagePath = Bare.argv[0] || './pearbrowser-storage'

// --- State ---

let swarm = null
let store = null
let proxy = null
let catalogManager = null
let appManager = null
let siteManager = null
let pearBridge = null
let peerCount = 0
let browseDrives = new Map() // keyHex → Hyperdrive (for ad-hoc browsing)

// --- RPC ---

const rpc = new WorkletRPC(IPC)

// Browser commands
rpc.handle(C.CMD_NAVIGATE, async (data) => {
  const { url } = data
  const parsed = new URL(url)
  const key = parsed.hostname
  const path = parsed.pathname || '/'

  // Start loading the drive in the background — don't wait for sync.
  // The proxy will handle waiting for content when WebView requests it.
  // This makes NAVIGATE instant while the drive syncs behind the scenes.
  ensureBrowseDrive(key).catch(() => {})

  return {
    localUrl: `http://127.0.0.1:${proxy.port}/hyper/${key}${path}${parsed.search || ''}`,
    key,
    path
  }
})

rpc.handle(C.CMD_GET_STATUS, () => {
  return {
    dhtConnected: swarm !== null,
    peerCount,
    browseDrives: browseDrives.size,
    installedApps: appManager ? appManager.installed.size : 0,
    publishedSites: siteManager ? siteManager.sites.size : 0,
    proxyPort: proxy ? proxy.port : 0
  }
})

// App Store commands
rpc.handle(C.CMD_LOAD_CATALOG, async (data) => {
  return await catalogManager.loadCatalog(data.keyHex)
})

rpc.handle(C.CMD_INSTALL_APP, async (data) => {
  const result = await appManager.install(data, (progress) => {
    rpc.event(C.EVT_INSTALL_PROGRESS, { appId: data.id, progress })
  })
  persistState()
  return result
})

rpc.handle(C.CMD_UNINSTALL_APP, async (data) => {
  const result = await appManager.uninstall(data.id)
  persistState()
  return result
})

rpc.handle(C.CMD_LAUNCH_APP, async (data) => {
  const app = appManager.installed.get(data.id)
  if (!app) throw new Error('App not installed: ' + data.id)

  // Ensure the app drive is loaded in the proxy
  await appManager.getDrive(app.driveKey)

  return {
    localUrl: `http://127.0.0.1:${proxy.port}/app/${app.driveKey}/index.html`,
    appId: data.id,
    name: app.name
  }
})

rpc.handle(C.CMD_LIST_INSTALLED, () => {
  return appManager.listInstalled()
})

rpc.handle(C.CMD_CHECK_UPDATES, async () => {
  const allApps = catalogManager.getAllApps()
  return await appManager.checkUpdates(allApps)
})

// Site Builder commands
rpc.handle(C.CMD_CREATE_SITE, async (data) => {
  const result = await siteManager.createSite(data.name)
  persistState()
  return result
})

rpc.handle(C.CMD_UPDATE_SITE, async (data) => {
  if (data.blocks) {
    return await siteManager.buildFromBlocks(data.siteId, data.blocks, data.theme)
  }
  return await siteManager.updateSite(data.siteId, data.files)
})

rpc.handle(C.CMD_PUBLISH_SITE, async (data) => {
  const result = await siteManager.publishSite(data.siteId)
  persistState()
  rpc.event(C.EVT_SITE_PUBLISHED, result)
  return result
})

rpc.handle(C.CMD_UNPUBLISH_SITE, async (data) => {
  const result = await siteManager.unpublishSite(data.siteId)
  persistState()
  return result
})

rpc.handle(C.CMD_LIST_SITES, () => {
  return siteManager.listSites()
})

rpc.handle(C.CMD_DELETE_SITE, async (data) => {
  const result = await siteManager.deleteSite(data.siteId)
  persistState()
  return result
})

// Pear Bridge — WebView apps call P2P APIs via this relay
rpc.handle(C.CMD_BRIDGE, async (data) => {
  const { method, args } = data
  if (!pearBridge) throw new Error('Bridge not initialized')

  switch (method) {
    case 'sync.create':
      return await pearBridge.createSyncGroup(args.appId)
    case 'sync.join':
      return await pearBridge.joinSyncGroup(args.appId, args.inviteKey)
    case 'sync.append':
      return await pearBridge.append(args.appId, args.op)
    case 'sync.get':
      return await pearBridge.get(args.appId, args.key)
    case 'sync.list':
      return await pearBridge.list(args.appId, args.prefix, args.opts)
    case 'sync.status':
      return pearBridge.getSyncStatus(args.appId)
    case 'identity.getPublicKey':
      return { publicKey: swarm ? swarm.keyPair.publicKey.toString('hex') : null }
    case 'navigate':
      // RN handles this directly
      return { ok: true }
    default:
      throw new Error('Unknown bridge method: ' + method)
  }
})

// System
rpc.handle(C.CMD_STOP, async () => {
  await shutdown()
  return { ok: true }
})

// --- Drive Management ---

const MAX_BROWSE_DRIVES = 20

async function ensureBrowseDrive (keyHex) {
  if (browseDrives.has(keyHex)) return browseDrives.get(keyHex)

  // Evict oldest drive if at capacity
  if (browseDrives.size >= MAX_BROWSE_DRIVES) {
    const oldest = browseDrives.keys().next().value
    const oldDrive = browseDrives.get(oldest)
    browseDrives.delete(oldest)
    try { await swarm.leave(oldDrive.discoveryKey) } catch {}
    try { await oldDrive.close() } catch {}
  }

  const drive = new Hyperdrive(store, Buffer.from(keyHex, 'hex'))
  await drive.ready()
  swarm.join(drive.discoveryKey, { server: false, client: true })
  browseDrives.set(keyHex, drive)
  return drive
}

async function getDriveForProxy (keyHex) {
  // Check browse drives
  if (browseDrives.has(keyHex)) return browseDrives.get(keyHex)
  // Check app drives
  if (appManager && appManager.activeDrives.has(keyHex)) {
    return appManager.activeDrives.get(keyHex)
  }
  // Check site drives
  if (siteManager) {
    for (const [, site] of siteManager.sites) {
      if (site.keyHex === keyHex) return site.drive
    }
  }
  // Load on demand
  return await ensureBrowseDrive(keyHex)
}

// Persist app/site state to disk
function persistState () {
  try {
    const state = {
      installedApps: appManager ? appManager.export() : {},
      sites: siteManager ? siteManager.export() : {},
      savedAt: Date.now()
    }
    fs.writeFileSync(storagePath + '/pearbrowser-state.json', JSON.stringify(state))
  } catch {}
}

// --- Boot ---

async function boot () {
  store = new Corestore(storagePath)
  await store.ready()

  swarm = new Hyperswarm()
  swarm.on('connection', (conn) => {
    store.replicate(conn)
    peerCount++
    rpc.event(C.EVT_PEER_COUNT, { peerCount })
    conn.on('close', () => {
      peerCount = Math.max(0, peerCount - 1)
      rpc.event(C.EVT_PEER_COUNT, { peerCount })
    })
    conn.on('error', () => {
      peerCount = Math.max(0, peerCount - 1)
      rpc.event(C.EVT_PEER_COUNT, { peerCount })
    })
  })

  // Initialize managers
  catalogManager = new CatalogManager(store, swarm)
  appManager = new AppManager(store, swarm)
  siteManager = new SiteManager(store, swarm)
  pearBridge = new PearBridge(store, swarm)

  // Restore persisted app/site state from disk
  const stateFile = storagePath + '/pearbrowser-state.json'
  try {
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
    if (data.installedApps) appManager.import(data.installedApps)
    if (data.sites) {
      // Sites need their drives reopened — handled by siteManager.import() in future
    }
  } catch {
    // No saved state yet — first run
  }

  // Initialize relay client for hybrid fast-path
  // TODO: make relay URLs configurable via RPC settings
  const relayClient = new RelayClient({
    relays: ['http://127.0.0.1:9100'], // Local relay for development
    timeout: 5000
  })

  // Start HTTP proxy with hybrid fetching (relay + P2P)
  proxy = new HyperProxy(getDriveForProxy, (path, err) => {
    rpc.event(C.EVT_ERROR, { type: 'proxy-error', path, message: err })
  }, relayClient)
  const port = await proxy.start()

  // Notify React Native
  rpc.event(C.EVT_READY, { port })
}

async function shutdown () {
  if (proxy) { try { await proxy.stop() } catch {} proxy = null }
  if (pearBridge) { try { await pearBridge.close() } catch {} pearBridge = null }
  if (siteManager) { try { await siteManager.close() } catch {} siteManager = null }
  if (appManager) { try { await appManager.close() } catch {} appManager = null }
  if (catalogManager) { try { await catalogManager.close() } catch {} catalogManager = null }
  for (const [, drive] of browseDrives) { try { await drive.close() } catch {} }
  browseDrives.clear()
  if (swarm) { try { await swarm.destroy() } catch {} swarm = null }
  if (store) { try { await store.close() } catch {} store = null }
}

// --- Lifecycle ---

Bare.on('suspend', () => IPC.unref())
Bare.on('resume', () => IPC.ref())

// --- Start ---

boot().catch((err) => {
  rpc.event(C.EVT_ERROR, { type: 'boot-error', message: err.message })
})
