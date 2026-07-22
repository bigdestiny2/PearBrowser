/**
 * PearBrowser — Bare Worklet Backend
 *
 * The P2P engine that powers PearBrowser. Runs inside a Bare worklet
 * on the phone. Manages Hyperswarm connections, app store catalog,
 * site publishing, and the HTTP proxy for WebView content.
 */

installAndroidFileLockFallback()

const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const fs = require('bare-fs')
const path = require('bare-path')
const { WorkletRPC } = require('./rpc.js')
const { HyperProxy } = require('./hyper-proxy.js')
const { RelayClient } = require('./relay-client.js')
const { CatalogManager } = require('./catalog-manager.js')
const { AppManager } = require('./app-manager.js')
const { SiteManager } = require('./site-manager.js')
const { PearBridge, PEAR_SWARM_V1_SHIM } = require('./pear-bridge.js')
const { HttpBridge } = require('./http-bridge.js')
const { UserData } = require('./user-data.js')
const { Identity, validateMnemonic } = require('./identity.js')
const { Profile } = require('./profile.js')
const { Contacts } = require('./contacts.js')
const { TrustedOrigins } = require('./trusted-origins.js')
const { SwarmBridge } = require('./swarm-bridge.js')
const { SwarmGrants } = require('./swarm-grants.js')
const { buildNavigateResponse, normalizeDriveKey } = require('./navigation.js')
const { ContentShield } = require('./content-shield.cjs')
const { ShieldListSync } = require('./shield-list-sync.cjs')
// Pear Plugins (Mission B4a — ported from pearbrowser-desktop Phase 3):
// drive-installed extensions feeding the same shield engine + inject path.
const { PluginDriveLoader } = require('./plugin-drive-loader.cjs')
const { PluginCatalog } = require('./plugin-catalog.cjs')
const { PearPluginRegistry } = require('./pear-plugins.cjs')
const { SessionBridge } = require('./session-bridge.cjs')
const {
  DEFAULT_PRIVACY,
  normalizePrivacySettings,
  mergeSettingsWithPrivacyDefaults,
  isSearchIndexEnabled
} = require('./privacy-policy.cjs')
// Lighthouse local-first search + petname naming (Mission B3 — ported from
// pearbrowser-desktop; see backend/search-core.cjs + backend/names.cjs headers).
const { PersonalIndex } = require('./personal-index.cjs')
const { createSearchHandler } = require('./search-handler.js')
const { QueryPlanner, SearchFanoutBudget } = require('./query-planner.js')
const { IdentityBindingPublisher } = require('./identity-binding-publisher.js')
const ib = require('./identity-binding.cjs')
const { Names } = require('./names.cjs')
const { NameRegistry } = require('./name-registry-store.cjs')
const { FederatedNameResolver } = require('./federated-name-resolver.cjs')
const { resolveName } = require('./resolve-name.cjs')
const { nameQueryFromInput } = require('./name-query.cjs')
const { extractIndexContent } = require('./html-raw-text.cjs')
const bareCrypto = require('bare-crypto')
const C = require('./constants.js')
// Mission B4b — TabRuntime (run pear-request apps headless in a tab) and
// QVAC / Ask Browser (on-device LLM page Q&A), ported from pearbrowser-desktop.
// See the gate notes at the wiring sites below.
const { TabRuntime } = require('./tab-runtime.cjs')
const { AskBrowserService, AskBrowserServiceError } = require('./ai/ask-browser-service.cjs')
const { createLazyQvacService } = require('./ai/qvac-host.cjs')
const { QVAC_MODEL_CATALOG } = require('./ai/qvac-model-catalog.cjs')

const { IPC } = BareKit
const storagePath = Bare.argv[0] || './pearbrowser-storage'
installAndroidFileLockFallback()

function installAndroidFileLockFallback () {
  if (!isAndroidStorageCompatRuntime()) return

  let fsx
  try {
    fsx = require('fs-native-extensions')
  } catch {
    return
  }
  if (fsx.__pearbrowserAndroidLockFallback) return
  fsx.__pearbrowserAndroidLockFallback = true

  const originalTryLock = fsx.tryLock
  const originalWaitForLock = fsx.waitForLock
  const originalUnlock = fsx.unlock
  const fallbackLocks = new Set()
  let warned = false

  const unsupportedLockError = (err) => {
    if (!err) return false
    return err.code === 'EINVAL' ||
      err.code === 'ENOSYS' ||
      err.code === 'ENOTSUP' ||
      /invalid argument|not implemented|not supported/i.test(err.message || '')
  }

  const markFallback = (fd, err) => {
    fallbackLocks.add(fd)
    if (!warned) {
      warned = true
      console.warn('[android-lock-fallback] Native advisory file locks are unavailable; continuing with a single-worklet lock fallback:', err && err.message)
    }
  }

  fsx.tryLock = function tryLockAndroidFallback (fd, offset = 0, length = 0, opts = {}) {
    try {
      return originalTryLock.call(this, fd, offset, length, opts)
    } catch (err) {
      if (!unsupportedLockError(err)) throw err
      markFallback(fd, err)
      return true
    }
  }

  fsx.waitForLock = async function waitForLockAndroidFallback (fd, offset = 0, length = 0, opts = {}) {
    try {
      return await originalWaitForLock.call(this, fd, offset, length, opts)
    } catch (err) {
      if (!unsupportedLockError(err)) throw err
      markFallback(fd, err)
    }
  }

  fsx.unlock = function unlockAndroidFallback (fd, offset = 0, length = 0) {
    if (fallbackLocks.delete(fd)) return
    return originalUnlock.call(this, fd, offset, length)
  }
}

function isAndroidStorageCompatRuntime () {
  const platform = global.Bare ? global.Bare.platform : global.process?.platform
  const isNativeAppWorklet = typeof BareKit !== 'undefined'
  if (platform === 'ios' || platform === 'ios-simulator') return false
  return isNativeAppWorklet || platform === 'android'
}

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
let profile = null
let contacts = null
let trustedOrigins = null
let swarmBridge = null
let swarmGrants = null
let deviceLinker = null
let contentShield = null // Content Shield — request filter + cosmetic hiding (ported from desktop)
let shieldListSync = null // P2P filter-list subscriptions (Phase 2 gate)
let pearPlugins = null // Pear Plugins registry (Mission B4a — desktop Phase 3)
let pluginDriveLoader = null // Plugin installs from drives (capability grant + escalation guard)
let pluginCatalog = null // Plugin discovery: builtin seed + subscribed catalogue drives
let sessionBridge = null // Clearnet session bridge facade (Mission B2 — desktop Phase 4)
let privacySettings = { ...DEFAULT_PRIVACY } // live privacy ladder state (user-data backed)
let personalIndex = null // Lighthouse local self-search (Mission B3 — signed postings Hyperbee)
let queryPlanner = null // B3 — federated query orchestration (local-first + budgeted trusted-peer fan-out)
let identityBindingPublisher = null // B3 — root → rotatable search subkey binding (DHT self-certifying record)
let names = null // B3 — petname store (naming Tier 0)
let nameRegistry = null // B3 — N5 multi-writer name registry; null until first use
let federatedNameResolver = null // B3 — resolve contacts' names across their registries
let tabRuntime = null // B4b — run pear-request apps headless in a tab (demo path works; pear:// worker path gated)
let aiService = null // B4b — QVAC on-device LLM service; null while the native runtime is not linked
/** Map<requestId, { resolve, reject, timer }> for login() ceremonies. */
const pendingLogins = new Map()
/** Map<requestId, { resolve, reject, timer }> for swarm.join() consent ceremonies. */
const pendingSwarmConsents = new Map()
const SWARM_CONSENT_TIMEOUT_MS = 2 * 60 * 1000
let peerCount = 0
let browseDrives = new Map() // keyHex → Hyperdrive (for ad-hoc browsing)
let storageTimer = null
let corestorePath = storagePath

// --- RPC ---

const rpc = new WorkletRPC(IPC)

// Mission B4b — QVAC on-device LLM service. GATED on mobile: no runtime
// loader is injected because the @qvac/llm-llamacpp native addon is not
// linked into the Android worklet (see backend/ai/qvac-host.cjs for the full
// assessment + the exact steps to enable it), so createLazyQvacService
// returns null and Ask Browser reports 'runtime-unavailable' through the
// desktop's own availability contract — never a hardcoded "available".
aiService = createLazyQvacService({
  homeDir: storagePath,
  models: QVAC_MODEL_CATALOG,
  idleUnloadMs: 15 * 60 * 1000 // same default as the desktop root index.js
})

// Mirrors pearbrowser-desktop backend/index.js, with one gate: when the AI
// runtime is absent, getAiService throws a typed 'runtime-unavailable' error
// (AskBrowserService.capabilities maps any getAiService throw to that reason;
// start() propagates it, so CMD_ASK_BROWSER_START fails closed at the RPC
// boundary instead of hanging a stream).
const askBrowserService = new AskBrowserService({
  getAiService: () => {
    if (!aiService) {
      throw new AskBrowserServiceError(
        'runtime-unavailable',
        'Ask Browser is unavailable: the QVAC native runtime (@qvac/llm-llamacpp) is not linked into this Android worklet build'
      )
    }
    return aiService
  },
  loadContext: async (page) => ({
    context: page,
    source: { kind: page?.text || page?.selection ? 'active-page' : 'metadata' }
  }),
  emit: (payload) => rpc.event(C.EVT_ASK_BROWSER_STREAM, payload)
})

rpc.handle(C.CMD_ASK_BROWSER_CAPABILITIES, async () => {
  return askBrowserService.capabilities()
})

rpc.handle(C.CMD_ASK_BROWSER_START, async (data = {}) => {
  return askBrowserService.start(data)
})

rpc.handle(C.CMD_ASK_BROWSER_CANCEL, async (data = {}) => {
  return { ok: await askBrowserService.cancel(data) }
})

// Browser commands
rpc.handle(C.CMD_NAVIGATE, async (data) => {
  if (!proxy) throw new Error('Proxy not running')

  // Naming (Mission B3): pearname://<name> and bare-word tokens try the
  // tiered name resolver BEFORE URL handling — mirrors the desktop URL bar
  // (ui/shell.js go()): petname (Tier 0) → own registry (Tier 2a) → trusted
  // contacts (Tier 2b) → curated floor (Tier 3), then clearnet-host / hyper
  // fallback. Gated by the same experimentalNaming setting as
  // CMD_NAME_RESOLVE; a miss, a disabled flag, or a resolver error falls
  // straight through to the unchanged URL path below.
  let nameResolution = null
  const rawInput = data && data.url
  const nameQuery = typeof rawInput === 'string' ? nameQueryFromInput(rawInput) : null
  if (nameQuery) {
    try {
      const resolved = await resolveNameTiered(nameQuery)
      if (resolved && (resolved.link || resolved.key)) {
        const link = resolved.link || `hyper://${resolved.key}/`
        nameResolution = {
          name: resolved.name,
          label: resolved.label || nameQuery,
          provenance: resolved.provenance || null,
          source: resolved.source || null
        }
        if (/^(?:pear|file):\/\//i.test(link)) {
          // A pear:// / file:// target is a full Pear-runtime app — mobile has
          // no Pear launch phase yet, so the shell surfaces the same honest
          // "coming in a later phase" dialog it uses for pear:// deep links.
          return {
            localUrl: null,
            key: null,
            path: '/',
            apiToken: null,
            kind: 'pear-link',
            url: link,
            nameResolution
          }
        }
        data = { ...data, url: link }
      }
    } catch { /* name resolution never breaks navigation */ }
  }

  // Phase 4–5 clearnet / loopback routing via SessionBridge (Mission B2,
  // mirrors pearbrowser-desktop backend/index.js). Non-hyper input (https
  // URLs, bare hosts, bare keys) is normalized and classified: clearnet
  // resolves to a proxied /clearnet/<base64url> loopback URL by default so
  // Content Shield + the privacy ladder see every request; the
  // `clearnetMode: 'direct'` settings opt-in returns the real https URL
  // and loads without shielding (WebViews cannot intercept requests, so
  // the proxy is the only shielded path).
  const rawUrl = data && data.url
  if (sessionBridge && typeof rawUrl === 'string' && !/^hyper:\/\//i.test(rawUrl.trim())) {
    const resolved = sessionBridge.resolveNavigation(rawUrl)
    if (resolved.kind === 'clearnet') {
      return {
        localUrl: resolved.localUrl,
        key: null,
        path: '/',
        apiToken: null,
        kind: 'clearnet',
        url: resolved.url,
        mode: resolved.mode,
        upgraded: !!resolved.upgraded,
        stripped: resolved.stripped || [],
        shieldActive: !!resolved.shieldActive
      }
    }
    if (resolved.kind === 'loopback') {
      // Relay/catalog fallback and developer pages keep loading directly.
      return {
        localUrl: resolved.localUrl,
        key: null,
        path: new URL(resolved.url).pathname || '/',
        apiToken: null,
        kind: 'loopback',
        url: resolved.url
      }
    }
    if (resolved.kind === 'hyper') {
      // Bare 64-hex / z32 keys normalize to hyper:// — fall through to the
      // drive flow below with the canonical URL.
      data = { ...data, url: resolved.url }
    }
  }

  const result = buildNavigateResponse({
    url: data && data.url,
    proxyPort: proxy.port,
    issueApiToken: proxy.issueApiToken && proxy.issueApiToken.bind(proxy),
  })
  if (nameResolution) result.nameResolution = nameResolution

  // Start loading the drive in the background — don't wait for sync.
  // The proxy will handle waiting for content when WebView requests it.
  // This makes NAVIGATE instant while the drive syncs behind the scenes.
  ensureBrowseDrive(result.key).catch((err) => {
    console.error('Failed to load browse drive:', err.message)
  })

  return result
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

// Hyperbee-backed catalog.
//
// Two formats share this command:
//   - SIGNED P2P catalog (data.signed === true): the relay advertises a
//     `catalogBeeKey` in /catalog.json. We replicate that bee, VERIFY its
//     signed `\x00meta` manifest against the bee's own pubkey (the trust
//     anchor), and scan entries. FAIL CLOSED on verify failure — the handler
//     throws and ExploreScreen falls back to HTTP. Live producer updates are
//     pushed to the UI via EVT_CATALOG_UPDATED.
//   - Legacy `app!`-prefixed bee (no flag): the original unsigned format.
rpc.handle(C.CMD_LOAD_CATALOG_BEE, async (data) => {
  if (data && data.signed) {
    const keyHex = String(data.keyHex || '').trim().toLowerCase()
    return await catalogManager.loadSignedCatalogBee(keyHex, (updated) => {
      rpc.event(C.EVT_CATALOG_UPDATED, { keyHex, catalog: updated })
    })
  }
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

// Run a pear-request app HEADLESS, streamed into a browser tab (Mission B4b,
// mirrors pearbrowser-desktop). 'demo' runs the in-process router — that path
// works in the Android worklet. pear:// / file:// links need a pear-run
// worker process, which the mobile runtime cannot spawn; tabRuntime.open()
// then throws a typed TabRuntimeError (code 'runtime-unavailable') so the
// command fails closed instead of returning a URL that would never stream.
rpc.handle(C.CMD_RUN_APP_IN_TAB, async (data) => {
  const link = String(data?.link || 'demo').trim()
  if (!tabRuntime) throw new Error('tab runtime is not available')
  if (link !== 'demo' && !/^pear:\/\/.+/.test(link) && !/^file:\/\/.+/.test(link)) {
    throw new Error('Only the demo, or pear:// / file:// apps, can run in a tab')
  }
  const res = tabRuntime.open(link)
  console.log('[tab-runtime] run-in-tab')
  return res
})

// --- Lighthouse P2P search (Mission B3 — ported from pearbrowser-desktop) ---
// Query / feed the personal index. Querying is fully local (no network);
// indexing is opt-in (searchIndexEnabled, default OFF) and best-effort.
// handleSearch (search-handler.js) returns local hop-0 results synchronously
// and, when data.federated is set and a planner exists, pushes
// EVT_SEARCH_FEDERATED later with the enriched trusted-peer set
// (queryId-correlated, stale-suppressed).
const handleSearch = createSearchHandler({
  getPersonalIndex: () => personalIndex,
  getQueryPlanner: () => queryPlanner,
  emit: (payload) => rpc.event(C.EVT_SEARCH_FEDERATED, payload),
})
rpc.handle(C.CMD_SEARCH, async (data) => {
  return handleSearch(data)
})

rpc.handle(C.CMD_SEARCH_FEDERATED, async (data = {}) => {
  return handleSearch({ ...data, federated: true })
})

// Publish/refresh our IdentityBinding on demand (e.g. a Settings "rotate
// search key" action), and resolve a contact's current search pubkey from
// the DHT (verified against their Contacts-held root). The mobile backend
// does NOT auto-publish at boot — see boot for the rationale.
rpc.handle(C.CMD_IDENTITY_BINDING_PUBLISH, async (data) => {
  if (!identityBindingPublisher) throw new Error('binding publisher unavailable')
  const published = await identityBindingPublisher.publish({ rotate: !!(data && data.rotate) })
  rpc.event(C.EVT_IDENTITY_BINDING_PUBLISHED, { searchPubkey: published.searchPubkey, version: published.version })
  return published
})

rpc.handle(C.CMD_IDENTITY_BINDING_RESOLVE, async (data) => {
  if (!identityBindingPublisher) throw new Error('binding publisher unavailable')
  if (!data || !data.contactPubkey || !data.dhtPubkey) throw new Error('contactPubkey + dhtPubkey required')
  const resolved = await identityBindingPublisher.resolve({
    contactPubkey: String(data.contactPubkey), dhtPubkey: String(data.dhtPubkey),
  })
  return resolved || { searchPubkey: null, indexKey: null }
})

rpc.handle(C.CMD_SEARCH_INDEX, async (data) => {
  // Privacy-first: local page indexing is opt-in (searchIndexEnabled).
  if (!personalIndex || !data || !data.driveKey) return { ok: false, indexed: false }
  try {
    const settings = userData ? await userData.getSettings() : {}
    if (!isSearchIndexEnabled(settings)) {
      return { ok: true, indexed: false, reason: 'search-index-disabled' }
    }
    const docId = await personalIndex.indexDoc({
      driveKey: normalizeDriveKey(data.driveKey),
      path: data.path || '/',
      title: data.title || '',
      body: data.text || data.body || '',
      publishedAt: Number.isFinite(data.publishedAt) ? data.publishedAt : 0,
    })
    return { ok: !!docId, docId, indexed: !!docId }
  } catch (err) {
    console.error('[search] index failed')
    return { ok: false, indexed: false }
  }
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
  // Apply the Content Shield toggle live — default ON; only explicit false disables.
  if (contentShield) contentShield.setEnabled(settings.contentShield !== false)
  // Allowlist / strict arrays can also be written as settings for simpler UI paths.
  if (contentShield && updates && typeof updates === 'object') {
    if (Array.isArray(updates.contentShieldAllow)) {
      for (const key of contentShield.allowlist()) contentShield.removeAllowlistDrive(key)
      for (const key of updates.contentShieldAllow) contentShield.allowlistDrive(key)
    }
    if (Array.isArray(updates.contentShieldStrict)) {
      for (const key of contentShield.strictDrives()) contentShield.setStrictDrive(key, false)
      for (const key of updates.contentShieldStrict) contentShield.setStrictDrive(key, true)
    }
  }
  // Privacy ladder + clearnet mode — apply live to the proxy (Mission B2).
  // The session bridge reads the shared privacySettings object by reference.
  applyPrivacyFromSettings(settings)
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
  await requireIdentity().restoreFromMnemonic(mnemonic)
  // Caller MUST restart the worklet for the new identity to take effect
  return { ok: true, restartRequired: true }
})

rpc.handle(C.CMD_IDENTITY_ROTATE, async () => {
  await requireIdentity().rotate()
  return { ok: true, restartRequired: true }
})

rpc.handle(C.CMD_IDENTITY_VALIDATE_PHRASE, async ({ mnemonic } = {}) => {
  return { valid: validateMnemonic(mnemonic || '') }
})

// --- Device linking (blind-pairing) ----------------------------------------
// The source device mints a single-use invite. backend/device-linker.js keeps
// the root entropy sealed until the invited candidate is accepted.
function getDeviceLinker () {
  if (!swarm) throw new Error('swarm not ready - cannot link devices yet')
  if (!deviceLinker) {
    const { DeviceLinker } = require('./device-linker.js')
    deviceLinker = new DeviceLinker(swarm, {
      identity: requireIdentity(),
      autoAccept: true,
      log: (message) => console.log(message)
    })
  }
  return deviceLinker
}

rpc.handle(C.CMD_DEVICE_LINK_CREATE_INVITE, async () => {
  const { invite, discoveryKey, done } = await getDeviceLinker().createInvite()
  done
    .then((result) => {
      const device = result && result.device && result.device.device
      console.log('[device-link] linked ' + (device || 'device'))
    })
    .catch((err) => console.warn('[device-link] failed:', err && err.message))
  return { invite, discoveryKey }
})

rpc.handle(C.CMD_DEVICE_LINK_JOIN, async ({ invite, device } = {}) => {
  if (typeof invite !== 'string' || invite.trim().length === 0) throw new Error('invite required')
  if (!swarm) throw new Error('swarm not ready - cannot link devices yet')
  const { DeviceLinker } = require('./device-linker.js')
  const linker = new DeviceLinker(swarm, { identity: requireIdentity() })
  try {
    await linker.joinWithInvite(invite.trim(), { device: device || 'this device' })
  } finally {
    await linker.close().catch(() => {})
  }
  return { ok: true, restartRequired: true }
})

rpc.handle(C.CMD_IDENTITY_SIGN, async ({ payload, driveKey } = {}) => {
  if (payload === undefined || payload === null) throw new Error('payload required')
  const id = requireIdentity()
  // If driveKey is provided, sign with the per-app sub-key (Phase A).
  // Otherwise fall back to the root (kept for backward compat — the
  // "browser" context on Settings screens uses this).
  if (typeof driveKey === 'string' && driveKey.length > 0) {
    return id.signForApp(driveKey, payload)
  }
  return id.sign(typeof payload === 'string' ? payload : b4a.from(payload))
})

// --- Profile (Identity Plan Phase B) ---

function requireProfile () {
  if (!profile) throw new Error('Profile not available — worklet still booting')
  return profile
}

rpc.handle(C.CMD_PROFILE_GET, async () => {
  return { profile: await requireProfile().getAll() }
})

rpc.handle(C.CMD_PROFILE_UPDATE, async ({ updates } = {}) => {
  return { profile: await requireProfile().update(updates || {}) }
})

rpc.handle(C.CMD_PROFILE_CLEAR, async () => {
  await requireProfile().clear()
  return { ok: true }
})

// --- Login ceremony (Identity Plan Phase C) ---
//
// Flow:
//   1. Page calls window.pear.login(opts)
//   2. http-bridge POST /api/login calls ctx.requestLogin(args)
//      → openLoginCeremony() below
//   3. We return the EXISTING grant if one is valid.
//      Otherwise we fire EVT_LOGIN_REQUEST to the RN/Native shell and
//      park the pending promise in `pendingLogins`.
//   4. User decides in a native consent sheet → shell calls
//      CMD_LOGIN_RESOLVE with { requestId, approved, scopes }
//   5. We record the grant in profile.bee, produce the signed
//      attestation, resolve the pending promise → http-bridge returns
//      the attestation to the page.

const LOGIN_TIMEOUT_MS = 2 * 60 * 1000
const LOGIN_DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000

async function openLoginCeremony ({ driveKeyHex, scopes = [], appName = null, reason = null }) {
  if (!identity) throw new Error('Identity not available')
  if (!profile) throw new Error('Profile not available')

  // Reuse an existing valid grant covering ALL requested scopes.
  const existing = await profile.getGrant(driveKeyHex)
  if (existing && scopes.every((s) => existing.scopes.includes(s))) {
    return buildAttestation(driveKeyHex, existing)
  }

  // Fresh consent — park, ask UI, wait.
  const requestId = crypto.randomBytes(16).toString('hex')
  const payload = {
    requestId,
    driveKey: driveKeyHex,
    scopes,
    appName,
    reason,
    currentGrant: existing || null,
  }

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingLogins.has(requestId)) {
        pendingLogins.delete(requestId)
        reject(new Error('Login request timed out (user did not respond in 2 minutes)'))
      }
    }, LOGIN_TIMEOUT_MS)
    pendingLogins.set(requestId, {
      resolve, reject, timer,
      driveKeyHex,
      requestedScopes: scopes,
      requestedAppName: appName,
    })
    rpc.event(C.EVT_LOGIN_REQUEST, payload)
  })
}

function buildAttestation (driveKeyHex, grant) {
  // The attestation is:
  //   pear.login.v1:<driveKey>:<appPubkey>:<scopes-joined>:<expiresAt>
  // signed with the per-app sub-key. Apps + third parties can verify
  // by recomputing the app sub-pubkey from the user's root pubkey
  // (but since root never leaves the device, they verify the
  // attestation directly with appPubkey which is embedded).
  const keypair = identity.getAppKeypair(driveKeyHex)
  const appPubkey = keypair.publicKey.toString('hex')
  const payload = `pear.login.v1:${driveKeyHex}:${appPubkey}:${grant.scopes.join(',')}:${grant.expiresAt}`
  const signed = identity.signForApp(driveKeyHex, payload, 'login')
  return {
    appPubkey,
    scopes: grant.scopes,
    expiresAt: grant.expiresAt,
    grantedAt: grant.grantedAt,
    loginProof: signed.signature,
    tag: signed.tag,
  }
}

rpc.handle(C.CMD_LOGIN_RESOLVE, async ({ requestId, approved, scopes, ttlMs } = {}) => {
  const pending = pendingLogins.get(requestId)
  if (!pending) throw new Error('No pending login with that id (timed out?)')
  pendingLogins.delete(requestId)
  clearTimeout(pending.timer)

  if (!approved) {
    pending.reject(new Error('User declined'))
    return { ok: true, approved: false }
  }

  // UI decides which scopes to grant (can narrow from what was requested).
  // Fall back to whatever the page asked for if the UI doesn't echo it.
  const finalScopes = Array.isArray(scopes) && scopes.length > 0
    ? scopes.map(String)
    : pending.requestedScopes
  const expiresAt = Date.now() + (typeof ttlMs === 'number' ? ttlMs : LOGIN_DEFAULT_TTL)

  const grant = await profile.setGrant(pending.driveKeyHex, {
    scopes: finalScopes,
    appName: pending.requestedAppName,
    expiresAt,
  })
  const attestation = buildAttestation(pending.driveKeyHex, grant)
  pending.resolve(attestation)
  return { ok: true, approved: true, driveKey: pending.driveKeyHex, scopes: finalScopes }
})

rpc.handle(C.CMD_LOGIN_LIST_GRANTS, async () => {
  return { grants: await requireProfile().listGrants() }
})

rpc.handle(C.CMD_LOGIN_REVOKE_GRANT, async ({ driveKeyHex } = {}) => {
  if (typeof driveKeyHex !== 'string') throw new Error('driveKeyHex required')
  await requireProfile().revokeGrant(driveKeyHex)
  return { ok: true }
})

rpc.handle(C.CMD_LOGIN_REVOKE_ALL, async () => {
  const n = await requireProfile().revokeAllGrants()
  return { ok: true, revoked: n }
})

// --- Contacts (Identity Plan Phase D) ---

function requireContacts () {
  if (!contacts) throw new Error('Contacts not available — worklet still booting')
  return contacts
}

rpc.handle(C.CMD_CONTACTS_LIST, async ({ limit } = {}) => {
  return { contacts: await requireContacts().list({ limit }) }
})

rpc.handle(C.CMD_CONTACTS_LOOKUP, async ({ pubkey } = {}) => {
  return { contact: await requireContacts().lookup(pubkey) }
})

rpc.handle(C.CMD_CONTACTS_ADD, async (input = {}) => {
  return { contact: await requireContacts().add(input) }
})

rpc.handle(C.CMD_CONTACTS_UPDATE, async ({ pubkey, updates } = {}) => {
  return { contact: await requireContacts().update(pubkey, updates || {}) }
})

rpc.handle(C.CMD_CONTACTS_REMOVE, async ({ pubkey } = {}) => {
  await requireContacts().remove(pubkey)
  return { ok: true }
})

// --- Names (Mission B3) — petnames + N5 multi-writer registry ---------------
// Local Hyperbee petname store (Tier 0) + the pure tiered resolver
// (names.cjs / resolve-name.cjs), the N5 owner-signed multi-writer registry
// (name-registry-store.cjs), and trusted-contact federation
// (federated-name-resolver.cjs). Gated behind the experimentalNaming
// user-data flag exactly like the desktop: disabled ⇒ CMD_NAME_RESOLVE
// answers null and the URL bar behaves EXACTLY as before. Mutations fail
// closed.

function requireNames () {
  if (!names) throw new Error('Names not available — worklet still booting')
  return names
}

async function isNamingEnabled () {
  try {
    const s = await requireUserData().getSettings()
    return !!(s && s.experimentalNaming)
  } catch { return false }
}

async function requireNaming () {
  if (!(await isNamingEnabled())) {
    throw new Error('Naming (petnames) is experimental — enable it in Settings first.')
  }
}

// The owner identity for the user's name claims: their stable ROOT ed25519
// key. ownerSign signs the registry's domain-tagged canonical bytes (NOT
// page-supplied bytes — the canon is built backend-side in name-registry-ops),
// so a claim can never be coerced into signing attacker-chosen content.
function nameRegSigner () {
  const id = requireIdentity()
  return {
    owner: b4a.toString(id.getSigningKeypair().publicKey, 'hex'),
    ownerSign: (msg) => id.sign(msg).signature,
  }
}

// Serialize ensureNameRegistry so two concurrent first-time claims can't both
// enter the create branch (which would double-mint + race setSettings,
// orphaning one base). The second caller awaits the first, then sees the
// persisted key and reopens the same registry. Mirrors PersonalIndex._serialize.
let _nameRegChain = Promise.resolve()
function ensureNameRegistry (opts = {}) {
  const run = _nameRegChain.then(() => _ensureNameRegistryImpl(opts), () => _ensureNameRegistryImpl(opts))
  _nameRegChain = run.then(() => {}, () => {}) // the lock never rejects
  return run
}
async function _ensureNameRegistryImpl ({ create = false } = {}) {
  const s = await requireUserData().getSettings()
  const key = (typeof s.nameRegKey === 'string' && /^[0-9a-f]{64}$/i.test(s.nameRegKey)) ? s.nameRegKey : null
  if (key) {
    if (nameRegistry && nameRegistry.key === key) return nameRegistry
    if (nameRegistry) { try { await nameRegistry.close() } catch {} nameRegistry = null }
    nameRegistry = await new NameRegistry(store, { bootstrap: key, encryptionKey: null }).ready()
    if (nameRegistry.discoveryKey && swarm) swarm.join(nameRegistry.discoveryKey, { server: true, client: true })
    return nameRegistry
  }
  if (!create) return null
  // Create the user's registry ONCE and KEEP it (no close-then-reopen on the
  // shared store). UNENCRYPTED so trusted contacts can replicate + resolve the
  // user's PUBLIC name claims — integrity is the per-claim owner signature,
  // not secrecy. Anyone the user shares the key with (their contacts) can
  // resolve it.
  const reg = await new NameRegistry(store, { bootstrap: null, encryptionKey: null }).ready()
  await requireUserData().setSettings({ nameRegKey: reg.key })
  nameRegistry = reg
  if (nameRegistry.discoveryKey && swarm) swarm.join(nameRegistry.discoveryKey, { server: true, client: true })
  return nameRegistry
}

// Read-only, cached, replicating views of CONTACTS' registries (federation).
// Each gets its OWN substore (keyed by bootstrap) so they never collide with
// the user's own registry or each other on the shared store. Keyed by the
// CONTACT root (one registry per contact): when a contact rotates their
// advertised key we tear down the stale base + leave its swarm topic, and the
// map is capped + LRU-evicted, so a verified contact churning their key can't
// leak unbounded substores/topics.
const MAX_CONTACT_REGISTRIES = 128
const _contactRegistries = new Map() // contactRoot hex -> { keyHex, reg }
async function _closeContactReg (entry) {
  try { if (entry.reg.discoveryKey && swarm) swarm.leave(entry.reg.discoveryKey) } catch {}
  try { await entry.reg.close() } catch {}
}
async function openContactRegistry (keyHex, contactRoot) {
  if (typeof keyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(keyHex)) return null
  const rootKey = (typeof contactRoot === 'string' && contactRoot) ? contactRoot.toLowerCase() : keyHex
  const cached = _contactRegistries.get(rootKey)
  if (cached) {
    if (cached.keyHex === keyHex) return cached.reg
    _contactRegistries.delete(rootKey) // contact rotated their key — drop the stale base
    await _closeContactReg(cached)
  }
  while (_contactRegistries.size >= MAX_CONTACT_REGISTRIES) { // bound + LRU-evict (insertion order)
    const oldestKey = _contactRegistries.keys().next().value
    const oldest = _contactRegistries.get(oldestKey)
    _contactRegistries.delete(oldestKey)
    await _closeContactReg(oldest)
  }
  const reg = await new NameRegistry(store, { bootstrap: keyHex, encryptionKey: null, storeNamespace: 'eab-name-registry-c-' + keyHex }).ready()
  if (reg.discoveryKey && swarm) swarm.join(reg.discoveryKey, { server: false, client: true })
  _contactRegistries.set(rootKey, { keyHex, reg })
  return reg
}

// The tiered resolver shared by CMD_NAME_RESOLVE and CMD_NAVIGATE: petname
// (Tier 0, wins) → own registry (Tier 2a) → trusted contacts (Tier 2b) →
// curated floor (Tier 3). Returns null when naming is disabled or nothing
// resolves — callers then fall through to plain URL handling.
async function resolveNameTiered (name) {
  if (!(await isNamingEnabled())) return null
  const petnames = names ? await names.petnameMap() : {}
  // Tier 2a — the user's OWN registry (reopened if it exists; never minted by
  // a read). Best-effort: a registry failure must not break petname/curated.
  let registry = {}
  try { const reg = await ensureNameRegistry({ create: false }); if (reg) registry = await reg.activeMap() } catch {}
  // Resolve highest tiers first WITHOUT the curated floor: petname (0) + own
  // registry (2a). If those miss, try federation (2b) before falling to curated.
  let resolved = resolveName(name, { petnames, registry, aliases: false })
  if (!resolved && federatedNameResolver) {
    // Tier 2b — trusted contacts' registries (cross-user federation).
    let fed = null
    try { fed = await federatedNameResolver.resolve(name) } catch {}
    if (fed) resolved = { name: fed.name, key: fed.key || null, link: fed.link || null, target: fed.target || fed.link || fed.key || null, label: fed.name, provenance: 'contact', source: fed.source, candidates: fed.candidates }
  }
  // Tier 3 — curated bootstrap floor (lowest authority).
  if (!resolved) resolved = resolveName(name, { aliases: true })
  return resolved
}

// Resolve a typed word against the local petname store + registry + curated
// floor. Never throws for the disabled/unknown case — returns
// { resolved: null } so the UI falls through to plain URL handling.
rpc.handle(C.CMD_NAME_RESOLVE, async ({ name } = {}) => {
  if (!(await isNamingEnabled())) return { resolved: null, enabled: false }
  return { resolved: await resolveNameTiered(name), enabled: !!names }
})

rpc.handle(C.CMD_NAME_PETNAME_LIST, async ({ limit } = {}) => {
  if (!names || !(await isNamingEnabled())) return { petnames: [] }
  return { petnames: await requireNames().list({ limit }) }
})

rpc.handle(C.CMD_NAME_PETNAME_SET, async ({ name, key, link, label } = {}) => {
  await requireNaming()
  return { petname: await requireNames().setPetname({ name, key, link, label }) }
})

rpc.handle(C.CMD_NAME_PETNAME_REMOVE, async ({ name } = {}) => {
  await requireNaming()
  await requireNames().removePetname(name)
  return { ok: true }
})

// --- Name registry (N5) — owner-signed multi-writer claims -------------------
// Claims auto-create the user's own registry; the owner is their root
// identity, signed backend-side (the page supplies only name+target, never
// signable bytes).
function requireNameRegistryCreated () {
  if (!nameRegistry) throw new Error('No name registry yet — claim a name to create one.')
  return nameRegistry
}

rpc.handle(C.CMD_NAMEREG_STATUS, async () => {
  if (!(await isNamingEnabled())) return { enabled: false, created: false }
  const reg = await ensureNameRegistry({ create: false })
  if (!reg) return { enabled: true, created: false }
  const { owner } = nameRegSigner()
  return { enabled: true, created: true, key: reg.key, owner, writable: reg.writable, writerKey: reg.localKey }
})

rpc.handle(C.CMD_NAMEREG_LIST, async () => {
  if (!(await isNamingEnabled())) return { names: [] }
  const reg = await ensureNameRegistry({ create: false })
  return { names: reg ? await reg.list() : [] }
})

rpc.handle(C.CMD_NAMEREG_RESOLVE, async ({ name } = {}) => {
  if (!(await isNamingEnabled())) return { resolved: null }
  const reg = await ensureNameRegistry({ create: false })
  return { resolved: reg ? await reg.resolve(name) : null }
})

rpc.handle(C.CMD_NAMEREG_CLAIM, async ({ name, target } = {}) => {
  await requireNaming()
  // Pre-validate BEFORE minting, so garbage input never creates a registry or
  // appends a dead op. A name that normalizes to empty (all-invisible) or
  // exceeds MAX_NAME would be silently dropped by the reducer → a confusing
  // {ok, null}.
  const { normalize } = require('./name-normalize.cjs')
  const { MAX_NAME, TARGET_ERROR, normalizeTarget } = require('./name-registry-ops.cjs')
  if (typeof name !== 'string' || !name.trim()) throw new Error('name required')
  if (name.length > MAX_NAME || !normalize(name)) throw new Error('invalid name (too long, or empty after normalization)')
  const cleanTarget = normalizeTarget(target)
  if (!cleanTarget) throw new Error(TARGET_ERROR)
  const reg = await ensureNameRegistry({ create: true })
  const { owner, ownerSign } = nameRegSigner()
  await reg.claim({ name, target: cleanTarget.target, owner }, ownerSign)
  const resolved = await reg.resolve(name)
  // A null resolve after a well-formed claim means the reducer rejected it —
  // homograph-blocked or already held by someone else. Report it honestly.
  if (!resolved) throw new Error('Name unavailable — already held or blocked as a look-alike of an existing name.')
  return { ok: true, resolved }
})

rpc.handle(C.CMD_NAMEREG_ROTATE, async ({ name, target } = {}) => {
  await requireNaming()
  const { TARGET_ERROR, normalizeTarget } = require('./name-registry-ops.cjs')
  const cleanTarget = normalizeTarget(target)
  if (!cleanTarget) throw new Error(TARGET_ERROR)
  const reg = requireNameRegistryCreated()
  const cur = await reg.resolve(name)
  if (!cur) throw new Error('You don\'t hold that name (claim it first).')
  const { owner, ownerSign } = nameRegSigner()
  if (cur.owner !== owner) throw new Error('You don\'t own that name.')
  await reg.rotate({ name, target: cleanTarget.target, owner, version: cur.version + 1 }, ownerSign)
  return { ok: true, resolved: await reg.resolve(name) }
})

rpc.handle(C.CMD_NAMEREG_RELEASE, async ({ name } = {}) => {
  await requireNaming()
  const reg = requireNameRegistryCreated()
  const { owner, ownerSign } = nameRegSigner()
  await reg.release({ name, owner }, ownerSign)
  return { ok: true }
})

rpc.handle(C.CMD_NAMEREG_REVOKE, async ({ name } = {}) => {
  await requireNaming()
  const reg = requireNameRegistryCreated()
  const { owner, ownerSign } = nameRegSigner()
  await reg.revoke({ name, owner }, ownerSign)
  return { ok: true }
})

// --- swarm.v1 — consent ceremony + grants management ---
//
// Arbitrary topic joins reveal network metadata and may expose the user to
// peers outside the current drive's namespace. Tier A drive-derived topics
// are automatic; Tier C topics pause here for native consent.

async function openSwarmConsent ({ driveKeyHex, appName, reason, topicHex, protocol }) {
  return await new Promise((resolve, reject) => {
    const requestId = crypto.randomBytes(16).toString('hex')
    const timer = setTimeout(() => {
      if (pendingSwarmConsents.has(requestId)) {
        pendingSwarmConsents.delete(requestId)
        reject(new Error('Swarm consent timed out (no response within 2 minutes)'))
      }
    }, SWARM_CONSENT_TIMEOUT_MS)

    pendingSwarmConsents.set(requestId, { resolve, reject, timer })
    rpc.event(C.EVT_SWARM_REQUEST, {
      requestId,
      driveKey: driveKeyHex,
      topicHex,
      protocol,
      appName,
      reason,
    })
  })
}

rpc.handle(C.CMD_SWARM_RESOLVE, async ({ requestId, approved } = {}) => {
  const pending = pendingSwarmConsents.get(requestId)
  if (!pending) throw new Error('No pending swarm consent with that id (timed out?)')
  pendingSwarmConsents.delete(requestId)
  clearTimeout(pending.timer)
  pending.resolve(!!approved)
  return { ok: true, approved: !!approved }
})

rpc.handle(C.CMD_SWARM_LIST_GRANTS, async ({ driveKey } = {}) => {
  if (!swarmGrants) return { grants: [] }
  const grants = driveKey
    ? await swarmGrants.listForApp(driveKey)
    : await swarmGrants.list()
  return { grants }
})

rpc.handle(C.CMD_SWARM_REVOKE_GRANT, async ({ driveKey, topicHex } = {}) => {
  if (!swarmGrants) throw new Error('SwarmGrants not available')
  const result = await swarmGrants.remove(driveKey, topicHex)
  return { ok: true, ...result }
})

rpc.handle(C.CMD_SWARM_REVOKE_ALL_FOR_APP, async ({ driveKey } = {}) => {
  if (!swarmGrants) throw new Error('SwarmGrants not available')
  const n = await swarmGrants.removeAllForApp(driveKey)
  return { ok: true, revoked: n }
})

// --- Per-origin session tokens (HTTPS apps, Phase E follow-up) ---
//
// Native shell calls this when navigating to a non-loopback URL. We
// derive a deterministic pseudo-driveKey from the origin string and
// hand back a token + the proxy port so the shell can inject the
// bridge with that token. Same origin + same user = same per-app
// sub-pubkey forever.
//
// The shell does NOT call this for hyper:// URLs — those go through
// the existing flow which calls proxy.issueApiToken(actualDriveKey).
rpc.handle(C.CMD_PEAR_SESSION, async ({ origin } = {}) => {
  if (!proxy) throw new Error('Proxy not running')
  if (typeof origin !== 'string' || origin.length === 0) {
    throw new Error('origin (string) required')
  }

  // Trust gate: if the user has flipped to 'allowlist' mode and this
  // origin is not in the trust set, return a sentinel that tells the
  // native shell "do not inject the bridge for this page". The shell
  // is the actual injector; the worklet is the policy engine.
  if (trustedOrigins) {
    if (!trustedOrigins.isTrustedSync(origin)) {
      return {
        allowed: false,
        reason: 'untrusted-origin',
        mode: trustedOrigins.modeSync(),
      }
    }
    // Lazy lastUsedAt update — fire-and-forget, swallow errors.
    trustedOrigins.touch(origin).catch(() => {})
  }

  const result = proxy.issueOriginToken(origin)
  return {
    allowed: true,
    token: result.token,
    driveKey: result.driveKeyHex,
    origin: result.origin,
    port: proxy.port,
  }
})

// --- Trusted origins (privacy mode for window.pear injection) ---

function requireTrustedOrigins () {
  if (!trustedOrigins) throw new Error('TrustedOrigins not available — worklet still booting')
  return trustedOrigins
}

rpc.handle(C.CMD_TRUSTED_ORIGINS_LIST, async () => {
  return await requireTrustedOrigins().list()
})

rpc.handle(C.CMD_TRUSTED_ORIGINS_ADD, async ({ origin } = {}) => {
  const value = await requireTrustedOrigins().add(origin)
  return { ok: true, origin: value }
})

rpc.handle(C.CMD_TRUSTED_ORIGINS_REMOVE, async ({ origin } = {}) => {
  const result = await requireTrustedOrigins().remove(origin)
  return { ok: true, origin: result.origin }
})

rpc.handle(C.CMD_TRUSTED_ORIGINS_SET_MODE, async ({ mode } = {}) => {
  const next = await requireTrustedOrigins().setMode(mode)
  return { ok: true, mode: next }
})


// --- Content Shield (ported from pearbrowser-desktop) ---
// Live status for the Settings card. Toggle / allowlist / strict / lists
// persist via user-data settings; CMD_SHIELD_* / CMD_PRIVACY_STATUS feed
// the Android Settings → Content Shield section.

rpc.handle(C.CMD_SHIELD_STATUS, async (data = {}) => {
  if (!contentShield) {
    return {
      enabled: false, blocked: 0, allowed: 0, blockRules: 0, exceptionRules: 0,
      cosmeticRules: 0, scriptletRules: 0, lists: [], listDetails: [],
      allowlist: [], strict: [], plugins: {}, topRules: []
    }
  }
  const stats = contentShield.stats()
  const driveKey = typeof data.driveKey === 'string' ? data.driveKey.trim().toLowerCase() : ''
  if (driveKey && /^[0-9a-f]{64}$/.test(driveKey)) {
    stats.driveKey = driveKey
    stats.driveAllowlisted = contentShield.isAllowlisted(driveKey)
    stats.driveStrict = contentShield.isStrict(driveKey)
  }
  stats.subscriptions = shieldListSync ? shieldListSync.subscriptions() : []
  return stats
})

rpc.handle(C.CMD_SHIELD_LOAD_LIST, async (data = {}) => {
  if (!contentShield) throw new Error('Content Shield not available')
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name || name === 'builtin' || name.startsWith('plugin:')) {
    throw new Error('invalid list name')
  }
  const result = contentShield.addList(name, data.text == null ? '' : String(data.text))
  await persistShieldState()
  return result
})

rpc.handle(C.CMD_SHIELD_REMOVE_LIST, async (data = {}) => {
  if (!contentShield) throw new Error('Content Shield not available')
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name || name === 'builtin') throw new Error('invalid list name')
  const removed = contentShield.removeList(name)
  await persistShieldState()
  return { removed, name }
})

rpc.handle(C.CMD_SHIELD_SET_ALLOW, async (data = {}) => {
  if (!contentShield) throw new Error('Content Shield not available')
  const driveKey = typeof data.driveKey === 'string' ? data.driveKey.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(driveKey)) throw new Error('driveKey must be 64-char hex')
  if (data.allow) contentShield.allowlistDrive(driveKey)
  else contentShield.removeAllowlistDrive(driveKey)
  await persistShieldState()
  return {
    driveKey,
    allowlisted: contentShield.isAllowlisted(driveKey),
    allowlist: contentShield.allowlist()
  }
})

rpc.handle(C.CMD_SHIELD_SET_STRICT, async (data = {}) => {
  if (!contentShield) throw new Error('Content Shield not available')
  const driveKey = typeof data.driveKey === 'string' ? data.driveKey.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(driveKey)) throw new Error('driveKey must be 64-char hex')
  contentShield.setStrictDrive(driveKey, !!data.strict)
  await persistShieldState()
  return {
    driveKey,
    strict: contentShield.isStrict(driveKey),
    strictDrives: contentShield.strictDrives()
  }
})

// Privacy ladder + clearnet mode — normalize stored settings against the
// privacy-first defaults and push them into the proxy's clearnet path.
// Mirrors pearbrowser-desktop applyPrivacyFromSettings (the shield toggle
// itself stays in the SET_SETTINGS handler above).
function applyPrivacyFromSettings (settings) {
  const merged = mergeSettingsWithPrivacyDefaults(settings || {})
  privacySettings = normalizePrivacySettings(merged)
  if (proxy && typeof proxy.setPrivacySettings === 'function') {
    proxy.setPrivacySettings(privacySettings)
  }
}

// Shield + privacy-ladder + session-bridge posture snapshot (Mission B2 —
// the desktop Phase 4–5 shape). `session` fills the B1 reserved spot: the
// SessionBridge status (native hook presence, live privacy ladder, proxy
// port). The direct/proxied toggle is the `clearnetMode` settings key —
// the desktop has no dedicated command for it either; it flows through
// CMD_USERDATA_SET_SETTINGS like every other ladder key.
rpc.handle(C.CMD_PRIVACY_STATUS, async () => {
  const stored = userData ? await userData.getSettings() : {}
  const merged = mergeSettingsWithPrivacyDefaults(stored)
  return {
    privacy: {
      ...privacySettings,
      historyEnabled: merged.historyEnabled === true,
      searchIndexEnabled: merged.searchIndexEnabled === true,
      telemetryEnabled: false,
      contentShield: merged.contentShield !== false
    },
    dataCollection: {
      telemetry: false,
      history: merged.historyEnabled === true,
      searchIndex: merged.searchIndexEnabled === true,
      remoteAnalytics: false,
      note: 'PearBrowser does not ship telemetry. History and local search indexing are opt-in only.'
    },
    shield: contentShield
      ? { enabled: contentShield.enabled, blocked: contentShield.stats().blocked, allowed: contentShield.stats().allowed }
      : null,
    session: sessionBridge
      ? sessionBridge.status()
      : { nativeBridge: false, hasNativeHook: false }
  }
})

// --- P2P distribution: filter-list drives ---
// Rule text is durable through persistShieldState(); these commands own the
// drive-sourced lifecycle (subscribe/refresh) so lists keep working offline
// after first sync and hot-swap when their drives update.

rpc.handle(C.CMD_SHIELD_SUBSCRIBE_LIST, async (data = {}) => {
  if (!shieldListSync) throw new Error('Shield list sync not available')
  const result = await shieldListSync.subscribe(data.driveKey)
  await persistShieldState()
  return { ...result, subscriptions: shieldListSync.subscriptions() }
})

rpc.handle(C.CMD_SHIELD_UNSUBSCRIBE_LIST, async (data = {}) => {
  if (!shieldListSync) throw new Error('Shield list sync not available')
  const result = await shieldListSync.unsubscribe(data.driveKey)
  await persistShieldState()
  return { ...result, subscriptions: shieldListSync.subscriptions() }
})

rpc.handle(C.CMD_SHIELD_REFRESH_LISTS, async (data = {}) => {
  if (!shieldListSync) throw new Error('Shield list sync not available')
  const outcomes = data.driveKey
    ? [{ driveKey: String(data.driveKey).toLowerCase(), ok: true, ...(await shieldListSync.refresh(data.driveKey, { force: !!data.force })) }]
    : await shieldListSync.refreshAll({ force: !!data.force })
  await persistShieldState()
  return { outcomes, subscriptions: shieldListSync.subscriptions() }
})

// --- Pear Plugins (Mission B4a — ported from pearbrowser-desktop Phase 3) ---
// Handlers mirror the desktop backend/index.js exactly (minus its whenReady
// gate — mobile handlers already run post-boot). Drive installs carry the
// two-step snapshot-bound consent, the update path carries the escalation
// guard, and the catalogue is metadata-only discovery.

rpc.handle(C.CMD_PLUGIN_LIST, async () => {
  return { plugins: pearPlugins ? pearPlugins.list() : [] }
})

rpc.handle(C.CMD_PLUGIN_SET_ENABLED, async (data = {}) => {
  if (!pearPlugins) throw new Error('Plugin registry not available')
  const result = pearPlugins.setEnabled(data.id, data.enabled !== false)
  await persistShieldState()
  return result
})

rpc.handle(C.CMD_PLUGIN_REGISTER, async (data = {}) => {
  if (!pearPlugins) throw new Error('Plugin registry not available')
  const result = pearPlugins.register({
    id: data.id,
    manifest: data.manifest,
    contribution: data.contribution,
    enabled: data.enabled !== false
  })
  if (result && result.ok) rememberPluginPayload(data)
  await persistShieldState()
  return result
})

// --- P2P distribution: plugin drives ---
// Plugin payloads are durable through persistShieldState(); these commands
// own the drive-sourced lifecycle (install/update/uninstall) so plugins keep
// working offline after first sync and hot-swap when their drives update.

rpc.handle(C.CMD_PLUGIN_INSTALL_DRIVE, async (data = {}) => {
  if (!pluginDriveLoader) throw new Error('Plugin drive loader not available')
  const result = await pluginDriveLoader.installFromDrive(data.driveKey, {
    grantedCapabilities: data.granted,
    reviewedFingerprint: data.reviewedFingerprint
  })
  await persistShieldState()
  return result
})

rpc.handle(C.CMD_PLUGIN_UPDATE_DRIVE, async (data = {}) => {
  if (!pluginDriveLoader) throw new Error('Plugin drive loader not available')
  const result = await pluginDriveLoader.updateFromDrive(data.driveKey, {
    grantedCapabilities: data.granted,
    reviewedFingerprint: data.reviewedFingerprint
  })
  await persistShieldState()
  return result
})

rpc.handle(C.CMD_PLUGIN_UNINSTALL, async (data = {}) => {
  if (!pluginDriveLoader) throw new Error('Plugin drive loader not available')
  const result = await pluginDriveLoader.uninstall(data.driveKey)
  if (result.driveKey) delete persistShieldState._pluginPayloads[result.driveKey]
  await persistShieldState()
  return result
})

// Plugin discovery. The catalogue is metadata-only: installing still runs
// through the drive loader's grant + escalation path, and `kind: "app"`
// entries (anonGPT) simply open as hyper:// apps.
rpc.handle(C.CMD_PLUGIN_CATALOG, async () => {
  if (!pluginCatalog) return { entries: [], sources: [] }
  const installed = new Set(pearPlugins ? pearPlugins.list().map(p => p.id) : [])
  return {
    entries: pluginCatalog.entries().map(entry => ({
      ...entry,
      installed: !!(entry.driveKey && installed.has(entry.driveKey))
    })),
    sources: pluginCatalog.sources()
  }
})

rpc.handle(C.CMD_PLUGIN_CATALOG_LOAD_DRIVE, async (data = {}) => {
  if (!pluginCatalog) throw new Error('Plugin catalogue not available')
  const result = await pluginCatalog.loadFromDrive(data.driveKey)
  await persistPluginCatalog()
  return { ...result, sources: pluginCatalog.sources() }
})

rpc.handle(C.CMD_PLUGIN_CATALOG_REMOVE_SOURCE, async (data = {}) => {
  if (!pluginCatalog) throw new Error('Plugin catalogue not available')
  const removed = pluginCatalog.removeSource(data.driveKey)
  await persistPluginCatalog()
  return { removed, sources: pluginCatalog.sources() }
})

function persistPluginCatalog () {
  if (!pluginCatalog || !userData) return Promise.resolve()
  return userData.setSettings({ contentShieldPluginCatalog: pluginCatalog.exportState() }).catch(() => {})
}

function persistPluginInstallRecords () {
  if (!pluginDriveLoader || !userData) return Promise.resolve()
  const records = {}
  for (const record of pluginDriveLoader.installs()) {
    records[record.driveKey] = {
      granted: record.granted,
      version: record.version,
      installedAt: record.installedAt,
      escalated: record.escalated
    }
  }
  return userData.setSettings({ contentShieldPluginInstalls: records }).catch(() => {})
}

// Remember last-known plugin register payloads so restart can rehydrate.
function rememberPluginPayload (data) {
  if (!data || !data.id) return
  const id = String(data.id).trim().toLowerCase()
  persistShieldState._pluginPayloads[id] = {
    id,
    manifest: data.manifest,
    contribution: data.contribution,
    enabled: data.enabled !== false
  }
}

async function persistShieldState () {
  if (!contentShield || !userData) return
  try {
    const state = contentShield.exportListState()
    // Sync enable flags from registry into durable state.
    if (pearPlugins) {
      for (const p of pearPlugins.list()) {
        state.plugins[p.id] = p.enabled
        if (persistShieldState._pluginPayloads[p.id]) {
          persistShieldState._pluginPayloads[p.id].enabled = p.enabled
        }
      }
    }
    await userData.setSettings({
      contentShieldState: state,
      contentShieldPlugins: { ...persistShieldState._pluginPayloads },
      contentShieldAllow: state.allowlist,
      contentShieldStrict: state.strict
    })
  } catch (err) {
    console.warn('[content-shield] persist failed:', err && err.message)
  }
}
persistShieldState._pluginPayloads = {}


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

  const drive = new Hyperdrive(store, b4a.from(keyHex, 'hex'))
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
  const corestoreOptions = { primaryKey: identity.getSeed(), unsafe: true }
  if (isAndroidStorageCompatRuntime()) {
    // Android app backups are disabled in the manifest. This avoids
    // device-file's Linux inode/birthtime/xattr checks, which are unstable
    // on some Android/BareKit devices and can reject valid app-private data.
    corestoreOptions.allowBackup = true
  }
  const openedCorestore = await openCorestore(corestoreOptions)
  store = openedCorestore.store
  corestorePath = openedCorestore.path
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'corestore-ready', message: 'Storage ready' })
  console.log('Corestore ready at:', corestorePath)

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

  // Identity Plan Phase B + D — profile attributes + contacts Hyperbees.
  profile = new Profile(store)
  try { await profile.ready(); console.log('Profile ready') }
  catch (err) { console.error('Profile init failed:', err && err.message); profile = null }

  contacts = new Contacts(store)
  try { await contacts.ready(); console.log('Contacts ready') }
  catch (err) { console.error('Contacts init failed:', err && err.message); contacts = null }

  // Lighthouse local self-search + petname naming (Mission B3 — ported from
  // pearbrowser-desktop). PersonalIndex is a per-user Hyperbee of signed
  // postings over the shared Corestore; indexing is opt-in
  // (searchIndexEnabled, default OFF) at the /hyper/ proxy chokepoint, and
  // querying is fully local — no query ever leaves the device.
  try {
    // Sign each posting with the BOUND (rotatable) search key via the binding
    // publisher, so a trusted peer who resolves our search key can verify our
    // postings (Lighthouse Phase 2). The publisher is created just below; this
    // hook runs only when a page is indexed (post-boot), so it's set by then.
    // Fallback to the seed-derived 'search' subkey if the publisher isn't up —
    // those postings stay self-only (hop-0 isn't peer-verified) until re-indexed.
    const sign = (canonDoc) => {
      const payload = JSON.stringify(canonDoc)
      if (identityBindingPublisher) {
        try { return identityBindingPublisher.signDocSync(payload) } catch (_) { /* fall through */ }
      }
      const r = identity.signForApp('search', payload, 'lighthouse-doc-v2')
      return { sig: r.signature, pubkey: r.publicKey }
    }
    personalIndex = await new PersonalIndex(store, { sign }).ready()
    console.log('PersonalIndex ready')
  } catch (err) {
    console.error('PersonalIndex init failed:', err && err.message)
    personalIndex = null
  }

  // Lighthouse Phase 2 — the binding publisher mints/loads the rotatable
  // search subkey (persisted in the PersonalIndex meta namespace) so postings
  // verify against our root-signed binding. DEVIATION from the desktop: no
  // automatic publish() at boot. Mobile Contacts records cannot carry
  // bindingKey/verifiedAt yet, so no peer could resolve the DHT record anyway;
  // CMD_IDENTITY_BINDING_PUBLISH stays wired for explicit use the moment
  // contact binding keys land (device-linking track). Best-effort, never
  // blocks boot.
  if (personalIndex && identity) {
    try {
      identityBindingPublisher = await new IdentityBindingPublisher({
        ib, identity, personalIndex, contacts, dht: swarm && swarm.dht,
        // advertise our name-registry key (if created) so contacts can resolve our names
        getNameRegKey: async () => { try { return (await requireUserData().getSettings()).nameRegKey || null } catch { return null } },
      }).ready()
      console.log('IdentityBindingPublisher ready')
    } catch (err) {
      console.error('IdentityBindingPublisher init failed:', err && err.message)
      identityBindingPublisher = null
    }
  }

  // N5 federation — resolve a typed name across TRUSTED contacts' registries.
  // Needs contacts (the trust frontier) + the binding publisher (to find each
  // contact's advertised registry key) + openContactRegistry (to replicate
  // it). FAILS CLOSED on mobile today: mobile Contacts records do not carry
  // verifiedAt/bindingKey, so the eligible-contact frontier is empty and
  // resolve() answers null — local tiers (petname/own-registry/curated) keep
  // working fully.
  if (contacts && identityBindingPublisher) {
    try {
      federatedNameResolver = new FederatedNameResolver({
        listContacts: () => requireContacts().list({ limit: 200 }),
        resolveBinding: (args) => identityBindingPublisher.resolve(args),
        openRegistry: (keyHex, contactRoot) => openContactRegistry(keyHex, contactRoot),
      })
      console.log('FederatedNameResolver ready')
    } catch (err) {
      console.error('FederatedNameResolver init failed:', err && err.message)
      federatedNameResolver = null
    }
  }

  // Lighthouse Phase 2 — federated query planner (local-first + trusted-peer
  // fan-out). The fan-out is hard-capped by SearchFanoutBudget (4 cold
  // connects/query, 24 live sessions, 30 joins/min) and fails closed on
  // mobile for the same reason as name federation: with no contact binding
  // keys the fetch loop skips every peer, so planAndSearch returns the local
  // set with honest provenance — never a silent wide fanout. Degrades to
  // local-only search if it can't construct, matching the graceful pattern.
  if (personalIndex && identity) {
    try {
      queryPlanner = new QueryPlanner({
        personalIndex, contacts, identity, swarm, store,
        budget: new SearchFanoutBudget(), bindingPublisher: identityBindingPublisher,
      })
      console.log('QueryPlanner ready')
    } catch (err) {
      console.error('QueryPlanner init failed:', err && err.message)
      queryPlanner = null
    }
  }

  // Naming Phase N1 — local petname store (crypto-free Hyperbee). Always
  // inited; the experimentalNaming flag only gates whether the resolver/
  // mutations are reachable, not whether the store opens.
  names = new Names(store)
  try { await names.ready(); console.log('Names ready') }
  catch (err) { console.error('Names init failed:', err && err.message); names = null }

  // Trusted-origins allow-list — gates window.pear injection on HTTPS
  // pages when the user has flipped to 'allowlist' mode. Default 'all'
  // mode preserves the current "inject everywhere, unauthorised until
  // login()" behaviour.
  trustedOrigins = new TrustedOrigins(store, swarm)
  try { await trustedOrigins.ready(); console.log('TrustedOrigins ready, mode=' + trustedOrigins.modeSync()) }
  catch (err) { console.error('TrustedOrigins init failed:', err && err.message); trustedOrigins = null }

  // swarm.v1 — direct Hyperswarm access for pages. Grants persist
  // per app/topic so arbitrary topics only prompt once until revoked.
  swarmGrants = new SwarmGrants(store, swarm)
  try { await swarmGrants.ready(); console.log('SwarmGrants ready') }
  catch (err) { console.error('SwarmGrants init failed:', err && err.message); swarmGrants = null }

  swarmBridge = new SwarmBridge(swarm, {
    identity,
    swarmGrants,
    requestConsent: (args) => openSwarmConsent(args),
  })

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
  proxy.setPearSwarmShim(PEAR_SWARM_V1_SHIM)

  // Content Shield — enabled by default, persisted `contentShield: false`
  // turns it off. Durable lists / allowlist / strict and Phase 3
  // plugin kill-switches rehydrate from user-data so everything works
  // offline after first save.
  // (Boot sequence mirrors pearbrowser-desktop backend/index.js.)
  contentShield = new ContentShield()
  pearPlugins = new PearPluginRegistry({ shield: contentShield })
  try {
    const shieldSettings = userData ? await userData.getSettings() : null
    if (shieldSettings && shieldSettings.contentShield === false) contentShield.setEnabled(false)
    if (shieldSettings && shieldSettings.contentShieldState) {
      contentShield.importListState(shieldSettings.contentShieldState)
    }
    // Legacy array keys (settings UI may write these directly).
    if (shieldSettings && Array.isArray(shieldSettings.contentShieldAllow)) {
      for (const key of shieldSettings.contentShieldAllow) contentShield.allowlistDrive(key)
    }
    if (shieldSettings && Array.isArray(shieldSettings.contentShieldStrict)) {
      for (const key of shieldSettings.contentShieldStrict) contentShield.setStrictDrive(key, true)
    }
    if (shieldSettings && shieldSettings.contentShieldPlugins && typeof shieldSettings.contentShieldPlugins === 'object') {
      persistShieldState._pluginPayloads = { ...shieldSettings.contentShieldPlugins }
      for (const payload of Object.values(shieldSettings.contentShieldPlugins)) {
        try { pearPlugins.register(payload) } catch {}
      }
    }

    // P2P filter-list distribution. Rule text was already rehydrated above,
    // so lists work fully offline; this owns the drive-sourced metadata
    // (version/sha256 bookkeeping) and the hot-swap lifecycle.
    const sha256Hex = (buf) => bareCrypto.createHash('sha256').update(buf).digest('hex')
    const refreshDistributionDrive = async (keyHex) => {
      const drive = await getDriveForProxy(keyHex)
      if (!drive) return
      const before = drive.version
      try {
        await Promise.race([
          drive.update({ wait: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('update-timeout')), 8000))
        ])
      } catch {
        // Timeout is acceptable — the fetch below still tries cached state.
      }
      if (drive.version !== before && proxy && typeof proxy.invalidateCache === 'function') {
        proxy.invalidateCache(keyHex)
      }
    }
    shieldListSync = new ShieldListSync({
      shield: contentShield,
      fetchDriveFile: (keyHex, path) => proxy._hybridFetch(keyHex, path),
      refreshDrive: refreshDistributionDrive,
      sha256Hex,
      persistMeta: async (meta) => {
        if (userData) await userData.setSettings({ contentShieldListSync: meta })
      }
    })
    if (shieldSettings && shieldSettings.contentShieldListSync) {
      shieldListSync.restore(shieldSettings.contentShieldListSync)
    }

    // Pear Plugins (Mission B4a — desktop Phase 3 gate). Plugin payloads were
    // already rehydrated above, so installed plugins work fully offline;
    // these own the drive-sourced grant records (snapshot-bound consent +
    // escalation guard) and the discovery catalogue. Same injected seams as
    // the desktop: proxy._hybridFetch + refreshDistributionDrive + sha256Hex.
    pluginDriveLoader = new PluginDriveLoader({
      registry: pearPlugins,
      fetchDriveFile: (keyHex, path) => proxy._hybridFetch(keyHex, path),
      refreshDrive: refreshDistributionDrive,
      sha256Hex,
      persistInstall: async (id, payload) => {
        if (payload === null) {
          delete persistShieldState._pluginPayloads[id]
        } else if (payload.__recordPatch) {
          const existing = persistShieldState._pluginPayloads[id]
          if (existing) existing.enabled = false // escalation guard disabled it
        } else {
          persistShieldState._pluginPayloads[id] = {
            id,
            manifest: payload.manifest,
            contribution: payload.contribution,
            enabled: payload.enabled !== false
          }
        }
        await persistPluginInstallRecords()
      }
    })
    if (shieldSettings && shieldSettings.contentShieldPluginInstalls) {
      pluginDriveLoader.restore(shieldSettings.contentShieldPluginInstalls)
    }
    pluginCatalog = new PluginCatalog({
      fetchDriveFile: (keyHex, path) => proxy._hybridFetch(keyHex, path),
      refreshDrive: refreshDistributionDrive
    })
    if (shieldSettings && shieldSettings.contentShieldPluginCatalog) {
      pluginCatalog.restore(shieldSettings.contentShieldPluginCatalog)
    }
  } catch {}
  proxy.setContentShield(contentShield)

  // Local-first search indexing (Mission B3): the /hyper/ HTML serve
  // chokepoint feeds the personal index. This is the mobile equivalent of the
  // desktop UI's indexPage() (which extracts title+text from the loaded page)
  // — same opt-in gate (searchIndexEnabled, default OFF), same best-effort
  // discipline (never throws into the serve path), hyper:// content only.
  proxy.setPageIndexer(({ driveKeyHex, filePath, html }) => {
    (async () => {
      if (!personalIndex) return
      const settings = userData ? await userData.getSettings() : {}
      if (!isSearchIndexEnabled(settings)) return
      const { title, text } = extractIndexContent(html)
      await personalIndex.indexDoc({
        driveKey: normalizeDriveKey(driveKeyHex) || String(driveKeyHex || ''),
        path: filePath || '/',
        title,
        body: text,
        publishedAt: 0,
      })
    })().catch(() => { /* indexing is best-effort */ })
  })

  // Background list refresh: first sweep shortly after boot (drives need
  // the swarm), then periodic hot-swap checks. Same 30-minute cadence as
  // the desktop — the timer is unref'd so it never keeps the worklet
  // alive, and per-drive failures never disturb browsing.
  if (shieldListSync) {
    const firstSweep = setTimeout(() => {
      shieldListSync.refreshAll()
        .then((outcomes) => {
          if (outcomes.some(o => o.ok && o.changed)) return persistShieldState()
        })
        .catch(() => {})
    }, 30 * 1000)
    if (typeof firstSweep?.unref === 'function') firstSweep.unref()
    shieldListSync.startAutoRefresh(30 * 60 * 1000)
  }

  // Session bridge + privacy ladder (Mission B2 — desktop Phases 4–5).
  // Clearnet navigations route through the browser-owned /clearnet/* proxy
  // by default so Content Shield sees every request. Direct mode (real
  // https load in the WebView) is a settings opt-in (clearnetMode: 'direct').
  try {
    const bootPrivacy = userData ? await userData.getSettings() : null
    applyPrivacyFromSettings(bootPrivacy || {})
  } catch {
    privacySettings = { ...DEFAULT_PRIVACY }
    if (proxy) proxy.setPrivacySettings(privacySettings)
  }
  sessionBridge = new SessionBridge({
    getShield: () => contentShield,
    getPrivacy: () => privacySettings,
    getProxyPort: () => (proxy && proxy.port) || 0
  })
  // No native webRequest hook exists on Android WebView / WKWebView; this is
  // a no-op today and activates automatically if a future bridge injects one.
  try { sessionBridge.attachNativeSession() } catch {}

  // Mount direct HTTP bridge (WebView → localhost → Bare, bypasses RN relay)
  const httpBridge = new HttpBridge(pearBridge, swarm, getDriveForProxy, {
    validateToken: (token) => proxy ? proxy.validateApiToken(token) : null,
    identity,
    profile,
    contacts,
    swarmBridge,
    // Login ceremony plumbing — http-bridge calls requestLogin() when a
    // page invokes pear.login(). We fire EVT_LOGIN_REQUEST up to the
    // UI, which calls CMD_LOGIN_RESOLVE after the user decides. See
    // the ceremony handler below.
    requestLogin: (args) => openLoginCeremony(args),
  })
  proxy.setHttpBridge(httpBridge)

  console.log('Starting HTTP proxy...')
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'proxy-start', message: 'Starting HTTP proxy...' })
  const port = await proxy.start()
  console.log('HTTP proxy started on port:', port)
  rpc.event(C.EVT_BOOT_PROGRESS, { stage: 'proxy-ready', message: 'HTTP proxy ready on port ' + port })

  // Tab runtime (Mission B4b, mirrors the desktop boot): the "run in a tab"
  // path. Serves the headless-app wrapper + bridges each tab's WebSocket to a
  // pear-request worker pipe. pearRun is null — the Android worklet cannot
  // spawn a pear-run worker process, so pear:// / file:// tabs fail closed
  // (typed 'runtime-unavailable' error) while the in-proc demo tab works.
  // Best-effort: a failure here just means the in-tab path is unavailable.
  try {
    tabRuntime = new TabRuntime({ pearRun: null })
    await tabRuntime.start()
  } catch (err) {
    console.error('[tab-runtime] failed to start:', err && err.message)
    tabRuntime = null
  }

  // Start storage monitoring
  storageTimer = setInterval(() => checkStorageQuota(), STORAGE_CHECK_INTERVAL)
  storageTimer.unref?.()

  // Notify React Native
  console.log('Sending READY event')
  rpc.event(C.EVT_READY, { port, proxyPort: port })
}

async function shutdown () {
  if (storageTimer) { clearInterval(storageTimer); storageTimer = null }
  if (shieldListSync) { try { shieldListSync.stop() } catch {} shieldListSync = null }
  try { await askBrowserService.close() } catch {}
  if (aiService) { try { await aiService.close() } catch {} aiService = null }
  if (tabRuntime) { try { await tabRuntime.stop() } catch {} tabRuntime = null }
  if (proxy) { try { await proxy.stop() } catch {} proxy = null }
  for (const [, entry] of _contactRegistries) { try { await _closeContactReg(entry) } catch {} }
  _contactRegistries.clear()
  if (nameRegistry) { try { await nameRegistry.close() } catch {} nameRegistry = null }
  if (names) { try { await names.close() } catch {} names = null }
  if (personalIndex) { try { await personalIndex.close() } catch {} personalIndex = null }
  queryPlanner = null
  federatedNameResolver = null
  identityBindingPublisher = null
  if (deviceLinker) { try { await deviceLinker.close() } catch {} deviceLinker = null }
  if (swarmBridge) { try { await swarmBridge.destroy() } catch {} swarmBridge = null }
  if (pearBridge) { try { await pearBridge.close() } catch {} pearBridge = null }
  if (siteManager) { try { await siteManager.close() } catch {} siteManager = null }
  if (appManager) { try { await appManager.close() } catch {} appManager = null }
  if (catalogManager) { try { await catalogManager.close() } catch {} catalogManager = null }
  for (const [, entry] of browseDrives) { try { await entry.drive.close() } catch {} }
  browseDrives.clear()
  if (swarm) { try { await swarm.destroy() } catch {} swarm = null }
  if (store) { try { await store.close() } catch {} store = null }
}

async function openCorestore (corestoreOptions) {
  try {
    return await readyCorestore(storagePath, corestoreOptions)
  } catch (err) {
    if (!isCorestoreIdentityConflict(err)) throw err

    const fallbackPath = path.join(
      storagePath,
      'corestore-' + identity.getPublicKeyHex().slice(0, 16)
    )
    console.warn('[corestore] Root storage belongs to another Corestore; using identity-scoped store:', fallbackPath)
    rpc.event(C.EVT_BOOT_PROGRESS, {
      stage: 'corestore-recover',
      message: 'Recovering storage layout...'
    })
    return await readyCorestore(fallbackPath, corestoreOptions)
  }
}

async function readyCorestore (storePath, corestoreOptions) {
  let candidate = null
  try {
    candidate = new Corestore(storePath, corestoreOptions)
    console.log('Corestore created at:', storePath)
    await candidate.ready()
    return { store: candidate, path: storePath }
  } catch (err) {
    if (candidate) {
      try { await candidate.close() } catch {}
    }
    throw err
  }
}

function isCorestoreIdentityConflict (err) {
  return !!(err && /another corestore is stored here/i.test(err.message || ''))
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
