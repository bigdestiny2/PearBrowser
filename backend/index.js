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
const { HttpBridge } = require('./http-bridge.js')
const { UserData } = require('./user-data.js')
const { Identity, validateMnemonic } = require('./identity.js')
const C = require('./constants.js')

const { IPC } = BareKit
const storagePath = Bare.argv[0] || './pearbrowser-storage'

// --- Storage Limits ---
const STORAGE_LIMIT = 1024 * 1024 * 1024 // 1GB max
const STORAGE_CHECK_INTERVAL = 5 * 60 * 1000 // Check every 5 minutes
const EVICT_THRESHOLD = 0.8 // Start cleanup at 80% capacity

// --- State ---

let swarm = null
let store = null
let proxy = null
let catalogManager = null
let appManager = null
let siteManager = null
let pearBridge = null
let relayClient = null
let userData = null
let identity = null
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
  const apiToken = /^[0-9a-f]{64}$/i.test(key) && proxy?.issueApiToken
    ? proxy.issueApiToken(key)
    : null

  // Start loading the drive in the background — don't wait for sync.
  // The proxy will handle waiting for content when WebView requests it.
  // This makes NAVIGATE instant while the drive syncs behind the scenes.
  ensureBrowseDrive(key).catch((err) => {
    console.error('Failed to load browse drive:', err.message)
  })

  return {
    localUrl: `http://127.0.0.1:${proxy.port}/hyper/${key}${path}${parsed.search || ''}`,
    key,
    path,
    apiToken
  }
})

rpc.handle(C.CMD_GET_STATUS, async () => {
  let storageSize = 0
  try {
    storageSize = await getStorageSize(storagePath)
  } catch {}

  return {
    dhtConnected: swarm !== null,
    peerCount,
    browseDrives: browseDrives.size,
    installedApps: appManager ? appManager.installed.size : 0,
    publishedSites: siteManager ? siteManager.sites.size : 0,
    proxyPort: proxy ? proxy.port : 0,
    storageUsed: storageSize,
    storageLimit: STORAGE_LIMIT,
    storagePercent: Math.round((storageSize / STORAGE_LIMIT) * 100)
  }
})

rpc.handle(C.CMD_GET_IDENTITY, async () => {
  return {
    publicKey: swarm ? swarm.keyPair.publicKey.toString('hex') : null,
    // Identity metadata for the Settings "My Identity" panel
    hasBackupPhrase: !!identity,
    mnemonicWordCount: identity ? identity.getMnemonic().split(' ').length : 0,
  }
})

// App Store commands
rpc.handle(C.CMD_LOAD_CATALOG, async (data) => {
  return await catalogManager.loadCatalog(data.keyHex)
})

// Phase 1 ticket 1 — Hyperbee-backed catalog (pre-positioning; relay
// publishes Hyperdrive catalogs today. Once a Hyperbee catalog exists,
// ExploreScreen can switch by sending `hyperbee://<key>` URLs.)
rpc.handle(C.CMD_LOAD_CATALOG_BEE, async (data) => {
  return await catalogManager.loadCatalogBee(data.keyHex)
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
    name: app.name,
    driveKey: app.driveKey,
    apiToken: proxy?.issueApiToken ? proxy.issueApiToken(app.driveKey) : null
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

rpc.handle(C.CMD_CLEAR_CACHE, async () => {
  let cleared = 0

  // Clear proxy cache
  if (proxy) {
    const cacheStats = proxy.getCacheStats?.()
    proxy.clearCache?.()
    cleared += cacheStats?.size || 0
  }

  // Clear browse drives cache
  for (const [key, { drive }] of browseDrives) {
    try { await drive.clear?.() } catch {}
  }

  return { cleared, message: 'Cache cleared successfully' }
})

// --- Relay configuration (Phase 0 ticket 2) ---
// Replaces the previously hardcoded relay list in boot().
// Settings UI writes through these handlers; state is persisted in
// pearbrowser-state.json so the config survives restarts.

rpc.handle(C.CMD_GET_RELAYS, async () => {
  if (!relayClient) return { relays: [], enabled: false, configured: false }
  return { ...relayClient.getConfig(), configured: true }
})

rpc.handle(C.CMD_SET_RELAYS, async ({ relays } = {}) => {
  if (!relayClient) throw new Error('Relay client not initialised')
  if (!Array.isArray(relays)) throw new Error('relays must be an array of URLs')
  const ok = relayClient.setRelays(relays)
  if (!ok) throw new Error('No valid http(s) relay URLs provided')
  persistState()
  return { ok: true, relays: relayClient.relays }
})

rpc.handle(C.CMD_SET_RELAY_ENABLED, async ({ enabled } = {}) => {
  if (!relayClient) throw new Error('Relay client not initialised')
  if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean')
  relayClient.setEnabled(enabled)
  persistState()
  return { ok: true, enabled: relayClient.enabled }
})

// --- User data (Phase 1 ticket 2) ---
// Hyperbee-backed bookmarks, history, settings, session, tabs.
// Replaces AsyncStorage usage in the RN layer.

function requireUserData () {
  if (!userData) throw new Error('User data not available — worklet still booting')
  return userData
}

rpc.handle(C.CMD_USERDATA_LIST_BOOKMARKS, async () => {
  return { bookmarks: await requireUserData().listBookmarks() }
})

rpc.handle(C.CMD_USERDATA_ADD_BOOKMARK, async ({ url, title } = {}) => {
  const result = await requireUserData().addBookmark({ url, title })
  return { bookmark: result }
})

rpc.handle(C.CMD_USERDATA_REMOVE_BOOKMARK, async ({ url } = {}) => {
  const removed = await requireUserData().removeBookmark(url)
  return { removed }
})

rpc.handle(C.CMD_USERDATA_LIST_HISTORY, async ({ limit } = {}) => {
  return { history: await requireUserData().listHistory({ limit }) }
})

rpc.handle(C.CMD_USERDATA_ADD_HISTORY, async ({ url, title } = {}) => {
  await requireUserData().addHistory({ url, title })
  return { ok: true }
})

rpc.handle(C.CMD_USERDATA_CLEAR_HISTORY, async () => {
  const cleared = await requireUserData().clearHistory()
  return { cleared }
})

rpc.handle(C.CMD_USERDATA_GET_SETTINGS, async () => {
  return { settings: await requireUserData().getSettings() }
})

rpc.handle(C.CMD_USERDATA_SET_SETTINGS, async ({ updates } = {}) => {
  const settings = await requireUserData().setSettings(updates || {})
  return { settings }
})

rpc.handle(C.CMD_USERDATA_GET_SESSION, async () => {
  return { session: await requireUserData().getSession() }
})

rpc.handle(C.CMD_USERDATA_SAVE_SESSION, async ({ state } = {}) => {
  await requireUserData().saveSession(state || {})
  return { ok: true }
})

rpc.handle(C.CMD_USERDATA_IMPORT, async ({ dump } = {}) => {
  const imported = await requireUserData().importDump(dump || {})
  return { imported }
})

// --- Identity (Phase 1 ticket 3) ---

function requireIdentity () {
  if (!identity) throw new Error('Identity not available — worklet still booting')
  return identity
}

rpc.handle(C.CMD_IDENTITY_EXPORT_PHRASE, async () => {
  return { mnemonic: requireIdentity().getMnemonic() }
})

rpc.handle(C.CMD_IDENTITY_IMPORT_PHRASE, async ({ mnemonic } = {}) => {
  if (typeof mnemonic !== 'string') throw new Error('mnemonic must be a string')
  if (!validateMnemonic(mnemonic)) throw new Error('Invalid seed phrase — check each word and try again')
  requireIdentity().restoreFromMnemonic(mnemonic)
  // Caller MUST restart the worklet for the new identity to take effect
  return { ok: true, restartRequired: true }
})

rpc.handle(C.CMD_IDENTITY_ROTATE, async () => {
  requireIdentity().rotate()
  return { ok: true, restartRequired: true }
})

rpc.handle(C.CMD_IDENTITY_VALIDATE_PHRASE, async ({ mnemonic } = {}) => {
  return { valid: validateMnemonic(mnemonic || '') }
})

rpc.handle(C.CMD_IDENTITY_SIGN, async ({ payload } = {}) => {
  if (payload === undefined || payload === null) throw new Error('payload required')
  // Accept string (UTF-8) or array-of-bytes from the RN side
  const msg = typeof payload === 'string' ? payload : Buffer.from(payload)
  return requireIdentity().sign(msg)
})

// Also enrich the existing CMD_GET_IDENTITY response with mnemonic hint
// (without exposing the phrase itself) so the UI can show identity status.

// --- Drive Management ---

const MAX_BROWSE_DRIVES = 20

function safeJSONParse (str) {
  const obj = JSON.parse(str)
  if (obj && typeof obj === 'object') {
    delete obj.__proto__
    delete obj.constructor
  }
  return obj
}

async function ensureBrowseDrive (keyHex) {
  // Validate drive key format
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error('Invalid drive key format')
  }

  if (browseDrives.has(keyHex)) {
    const entry = browseDrives.get(keyHex)
    entry.lastAccess = Date.now()
    return entry.drive
  }

  // Evict oldest drive if at capacity
  if (browseDrives.size >= MAX_BROWSE_DRIVES) {
    const oldest = browseDrives.keys().next().value
    const oldEntry = browseDrives.get(oldest)
    browseDrives.delete(oldest)
    try { await swarm.leave(oldEntry.drive.discoveryKey) } catch (err) {
      console.error('Failed to leave swarm:', err.message)
    }
    try { await oldEntry.drive.close() } catch (err) {
      console.error('Failed to close drive:', err.message)
    }
  }

  const drive = new Hyperdrive(store, Buffer.from(keyHex, 'hex'))
  await drive.ready()
  swarm.join(drive.discoveryKey, { server: false, client: true })
  browseDrives.set(keyHex, {
    drive,
    lastAccess: Date.now()
  })
  return drive
}

async function getDriveForProxy (keyHex) {
  // Check browse drives
  if (browseDrives.has(keyHex)) {
    const entry = browseDrives.get(keyHex)
    entry.lastAccess = Date.now()
    return entry.drive
  }
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
      relayConfig: relayClient ? {
        relays: relayClient.relays,
        enabled: relayClient.enabled,
      } : undefined,
      savedAt: Date.now()
    }
    fs.writeFileSync(storagePath + '/pearbrowser-state.json', JSON.stringify(state))
  } catch (err) {
    console.warn('[persistState] write failed:', err && err.message)
  }
}

// --- Boot ---

async function boot () {
  console.log('Boot starting, storagePath:', storagePath)
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'identity-load', message: 'Loading identity...' })

  // Phase 1 ticket 3 — load or generate the user's root identity
  identity = new Identity(storagePath)
  await identity.ready()
  console.log('Identity ready')

  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'corestore-start', message: 'Initializing storage...' })

  // Derive the Corestore from the user's identity seed so rotating the
  // identity gives a clean store. The seed is 32 bytes — exactly what
  // Corestore's primaryKey expects. `unsafe: true` acknowledges that we
  // know what we're doing (corestore >= 7.x guards the primaryKey path
  // because a wrong value destroys existing hypercore data).
  store = new Corestore(storagePath, { primaryKey: identity.getSeed(), unsafe: true })
  console.log('Corestore created, waiting for ready...')
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'corestore-ready', message: 'Storage ready' })
  await store.ready()
  console.log('Corestore ready')

  console.log('Creating Hyperswarm...')
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'hyperswarm-start', message: 'Starting P2P network...' })
  swarm = new Hyperswarm()
  console.log('Hyperswarm created')
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'hyperswarm-ready', message: 'P2P network ready' })
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
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'managers-start', message: 'Loading app manager...' })
  catalogManager = new CatalogManager(store, swarm)
  appManager = new AppManager(store, swarm)
  siteManager = new SiteManager(store, swarm)
  pearBridge = new PearBridge(store, swarm)

  // Phase 1 ticket 2 — Hyperbee-backed user data (bookmarks, history, etc.)
  userData = new UserData(store, swarm)
  try {
    await userData.ready()
    console.log('UserData ready')
  } catch (err) {
    console.error('UserData init failed:', err && err.message)
    userData = null
  }

  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'managers-ready', message: 'Managers loaded' })

  // Restore persisted app/site state from disk
  const stateFile = storagePath + '/pearbrowser-state.json'
  let persistedState = {}
  try {
    const raw = fs.readFileSync(stateFile, 'utf-8')
    persistedState = safeJSONParse(raw) || {}
    if (persistedState.installedApps) appManager.import(persistedState.installedApps)
    if (persistedState.sites) await siteManager.import(persistedState.sites)
  } catch (err) {
    // No saved state yet — first run
    if (err.code !== 'ENOENT') {
      console.error('Failed to load state:', err.message)
    }
  }

  // Initialize relay client for hybrid fast-path.
  // Config is user-controllable via CMD_SET_RELAYS / CMD_SET_RELAY_ENABLED
  // and persisted in pearbrowser-state.json alongside apps and sites.
  // Phase 0 ticket 2 completed.
  const DEFAULT_RELAYS = [
    'https://relay-us.p2phiverelay.xyz',
    'https://relay-sg.p2phiverelay.xyz'
  ]
  const savedRelayConfig = persistedState.relayConfig || {}
  relayClient = new RelayClient({
    relays: Array.isArray(savedRelayConfig.relays) && savedRelayConfig.relays.length > 0
      ? savedRelayConfig.relays
      : DEFAULT_RELAYS,
    enabled: savedRelayConfig.enabled !== false,
    timeout: 5000
  })

  // Start HTTP proxy with hybrid fetching (relay + P2P)
  proxy = new HyperProxy(getDriveForProxy, (path, err) => {
    rpc.event(C.EVT_ERROR, { type: 'proxy-error', path, message: err })
  }, relayClient)

  // Mount direct HTTP bridge (WebView → localhost → Bare, bypasses RN relay)
  const httpBridge = new HttpBridge(pearBridge, swarm, getDriveForProxy, {
    validateToken: (token) => proxy ? proxy.validateApiToken(token) : null,
    identity: identity // for /api/identity/sign
  })
  proxy.setHttpBridge(httpBridge)

  console.log('Starting HTTP proxy...')
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'proxy-start', message: 'Starting HTTP proxy...' })
  const port = await proxy.start()
  console.log('HTTP proxy started on port:', port)
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'proxy-ready', message: 'HTTP proxy ready on port ' + port })

  // Start storage monitoring
  setInterval(() => checkStorageQuota(), STORAGE_CHECK_INTERVAL)

  // Notify React Native
  console.log('Sending READY event')
  rpc.event(C.EVT_READY, { port })
}

async function shutdown () {
  if (proxy) { try { await proxy.stop() } catch {} proxy = null }
  if (pearBridge) { try { await pearBridge.close() } catch {} pearBridge = null }
  if (siteManager) { try { await siteManager.close() } catch {} siteManager = null }
  if (appManager) { try { await appManager.close() } catch {} appManager = null }
  if (catalogManager) { try { await catalogManager.close() } catch {} catalogManager = null }
  for (const [, entry] of browseDrives) { try { await entry.drive.close() } catch {} }
  browseDrives.clear()
  if (swarm) { try { await swarm.destroy() } catch {} swarm = null }
  if (store) { try { await store.close() } catch {} store = null }
}

// --- Storage Management ---

async function checkStorageQuota () {
  try {
    const stats = await getStorageSize(storagePath)
    console.log(`Storage usage: ${formatBytes(stats)} / ${formatBytes(STORAGE_LIMIT)}`)

    if (stats > STORAGE_LIMIT * EVICT_THRESHOLD) {
      console.log('Storage above threshold, running cleanup...')
      await cleanupOldData()
    }
  } catch (err) {
    console.error('Storage check failed:', err.message)
  }
}

async function getStorageSize (dir) {
  const fs = require('bare-fs')
  const path = require('bare-path')

  let total = 0

  async function calcSize (currentPath) {
    const entries = await fs.promises.readdir(currentPath)
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry)
      const stat = await fs.promises.stat(fullPath)
      if (stat.isDirectory()) {
        await calcSize(fullPath)
      } else {
        total += stat.size
      }
    }
  }

  await calcSize(dir)
  return total
}

function formatBytes (bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

async function cleanupOldData () {
  // 1. Evict least recently used browse drives
  const sortedDrives = Array.from(browseDrives.entries())
    .sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0))

  // Remove oldest 20% of drives
  const toRemove = Math.ceil(sortedDrives.length * 0.2)
  for (let i = 0; i < toRemove && i < sortedDrives.length; i++) {
    const [key, entry] = sortedDrives[i]
    console.log(`Evicting old browse drive: ${key.slice(0, 8)}...`)
    browseDrives.delete(key)
    try { await swarm.leave(entry.drive.discoveryKey) } catch {}
    try { await entry.drive.close() } catch {}
  }

  // 2. Clear proxy cache
  if (proxy) {
    proxy.clearCache?.()
    console.log('Cleared proxy cache')
  }

  // 3. In future: could also prune old/unused app versions
}

// --- Lifecycle ---

Bare.on('suspend', () => IPC.unref())
Bare.on('resume', () => IPC.ref())

// --- Start ---

console.log('Starting boot...')
boot().catch((err) => {
  console.error('Boot failed:', err)
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'error', message: err.message, error: err.stack })
  rpc.event(C.EVT_ERROR, { type: 'boot-error', message: err.message, stack: err.stack })
})
