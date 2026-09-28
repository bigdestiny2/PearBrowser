/**
 * PearBrowser — Root Component
 *
 * Boots the Bare worklet (P2P engine), sets up tab navigation,
 * and manages global state (peer count, saved sites, etc.)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, StatusBar, Platform,
  ActivityIndicator, TouchableOpacity, NativeModules,
  Modal, ScrollView, Alert, AppState as NativeAppState,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Paths } from 'expo-file-system'
import { PearRPC } from './lib/rpc'
import { EVT } from './lib/constants'
import { networkMonitor, NetworkInfo } from './lib/network'
import { StatusDot } from './components/StatusDot'
import * as FileSystem from 'expo-file-system'
import { getSession, getSettings, getPrivateModeStrict, saveSession, scrubBrowserSession, bootstrapHyperbeeStorage } from './lib/storage'
import type { Tab as BrowserTab } from './lib/storage'

// @ts-ignore — bare-pack bundles, platform-specific
import iosBundleImport from '../assets/backend.bundle.mjs'
// @ts-ignore
import androidBundleImport from '../assets/backend.android.bundle.mjs'
const backendBundle = Platform.OS === 'android' ? androidBundleImport : iosBundleImport

// Worklet may not be available in dev mode (JSI module)
let Worklet: any = null
try {
  Worklet = require('react-native-bare-kit').Worklet
} catch {
  console.warn('react-native-bare-kit not available — running without P2P engine')
}
import { colors } from './lib/theme'
import { HomeScreen } from './screens/HomeScreen'
import { SearchScreen } from './screens/SearchScreen'
import { ExploreScreen } from './screens/ExploreScreen'
import { BrowseScreen } from './screens/BrowseScreen'
import { TabSwitcherScreen } from './screens/TabSwitcherScreen'
import { MoreScreen } from './screens/MoreScreen'
import { BookmarksScreen } from './screens/BookmarksScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { QRScannerScreen } from './screens/QRScannerScreen'
import { BackupPhraseScreen } from './screens/BackupPhraseScreen'
import { RestoreIdentityScreen } from './screens/RestoreIdentityScreen'
import { MySitesScreen } from './screens/MySitesScreen'
import { TemplatePickerScreen } from './screens/TemplatePickerScreen'
import type { Template } from './screens/TemplatePickerScreen'
import { SiteEditorScreen } from './screens/SiteEditorScreen'

type AppState = 'booting' | 'connecting' | 'ready' | 'error'
type Tab = 'home' | 'explore' | 'browse' | 'more'

interface ConnectionStatusDetails {
  dhtConnected: boolean
  peerCount: number
  proxyPort: number
  browseDrives: number
  savedOfflineSites: number
  publishedSites: number
}

interface LoginConsentRequest {
  requestId: string
  driveKey: string
  appName: string
  reason: string
  scopes: string[]
}

interface SwarmConsentRequest {
  requestId: string
  driveKey: string
  topicHex: string
  protocol: string
  appName: string
  reason: string
}

const MAX_LIVE_BROWSER_TABS = 6

function newBrowserTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function restoreBrowserTabs(raw: unknown): BrowserTab[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.slice(0, 1000).flatMap((entry): BrowserTab[] => {
    if (!entry || typeof entry !== 'object') return []
    const id = typeof entry.id === 'string' ? entry.id : ''
    const url = typeof entry.url === 'string' ? entry.url : ''
    const title = typeof entry.title === 'string' ? entry.title : ''
    const supportedUrl = !url || /^(?:hyper|https?):\/\//i.test(url) ||
      /^app:\/\/[0-9a-f]{64}(?:[/?#]|$)/i.test(url)
    if (!id || id.length > 128 || seen.has(id) || url.length > 8192 ||
        title.length > 256 || !supportedUrl) return []
    seen.add(id)
    return [{ id, url, title }]
  })
}

export default function App() {
  const [state, setState] = useState<AppState>('booting')
  const [proxyPort, setProxyPort] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [peerCount, setPeerCount] = useState(0)
  const [activeTab, setActiveTabState] = useState<Tab>('home')
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([])
  const [activeBrowserTabId, setActiveBrowserTabId] = useState<string | null>(null)
  const [browseNavigationIds, setBrowseNavigationIds] = useState<Record<string, number>>({})
  const [liveBrowserTabIds, setLiveBrowserTabIds] = useState<string[]>([])
  const [showTabSwitcher, setShowTabSwitcher] = useState(false)
  const [sessionRestored, setSessionRestored] = useState(false)
  const [storageSettled, setStorageSettled] = useState(false)
  const [privacySettled, setPrivacySettled] = useState(false)
  const [privateMode, setPrivateMode] = useState(false)
  const browseUrl = browserTabs.find(tab => tab.id === activeBrowserTabId)?.url || null
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSites, setShowSites] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null)
  const [editorTemplate, setEditorTemplate] = useState<Template | null>(null)
  const [pendingSiteName, setPendingSiteName] = useState('')
  const [isOffline, setIsOffline] = useState(false)
  const [bootProgress, setBootProgress] = useState<string>('Initializing...')
  const [showQRScanner, setShowQRScanner] = useState(false)
  const [showBackupPhrase, setShowBackupPhrase] = useState(false)
  const [showRestoreIdentity, setShowRestoreIdentity] = useState(false)
  const [pendingLogin, setPendingLogin] = useState<LoginConsentRequest | null>(null)
  const [pendingSwarm, setPendingSwarm] = useState<SwarmConsentRequest | null>(null)
  
  // Connection status panel state
  const [showStatusPanel, setShowStatusPanel] = useState(false)
  const [connectionDetails, setConnectionDetails] = useState<ConnectionStatusDetails>({
    dhtConnected: false,
    peerCount: 0,
    proxyPort: 0,
    browseDrives: 0,
    savedOfflineSites: 0,
    publishedSites: 0,
  })

  const workletRef = useRef<any>(null)
  const rpcRef = useRef<PearRPC | null>(null)
  const restoreGenerationRef = useRef(0)
  const privateModeRef = useRef(false)
  const pendingPrivacyScrubRef = useRef<boolean | null>(null)

  const connectionStatus: 'connected' | 'connecting' | 'offline' | 'error' | 'http-only' = state === 'ready'
    ? (proxyPort > 0 ? 'connected' : (Worklet ? 'connecting' : 'http-only'))
    : state === 'error' ? 'offline' : 'connecting'

  const setActiveTab = useCallback((tab: Tab) => setActiveTabState(tab), [])

  // Every explicit destination opens in the selected browser tab. A blank
  // tab created from the switcher becomes the selected tab on Home.
  const setBrowseUrl = useCallback((url: string | null) => {
    if (!url) return
    const id = activeBrowserTabId || newBrowserTabId()
    setBrowserTabs(previous => {
      const index = previous.findIndex(tab => tab.id === id)
      if (index < 0) return [...previous, { id, url, title: '' }]
      return previous.map(tab => tab.id === id ? { ...tab, url, title: '' } : tab)
    })
    setActiveBrowserTabId(id)
    setBrowseNavigationIds(previous => ({ ...previous, [id]: (previous[id] || 0) + 1 }))
  }, [activeBrowserTabId])

  const updateBrowserTab = useCallback((id: string, url: string, title: string) => {
    if (!url) return
    setBrowserTabs(previous => {
      const tab = previous.find(item => item.id === id)
      if (!tab || (tab.url === url && tab.title === title)) return previous
      return previous.map(item => item.id === id ? { ...item, url, title } : item)
    })
  }, [])

  // The session shape is shared with Android. One complete write prevents
  // separate active-screen and URL writes from overwriting each other.
  useEffect(() => {
    if (!sessionRestored || !storageSettled || !privacySettled) return
    const timer = setTimeout(() => {
      saveSession(privateMode
        ? { activeTab: 'home', lastBrowseUrl: null, browserTabs: [], activeBrowserTabId: null }
        : { activeTab, lastBrowseUrl: browseUrl, browserTabs, activeBrowserTabId }
      ).catch(err => console.warn('[session] save failed:', err))
    }, 150)
    return () => clearTimeout(timer)
  }, [activeTab, browseUrl, browserTabs, activeBrowserTabId, sessionRestored, storageSettled, privacySettled, privateMode])

  // Older RN sessions stored one URL. Android and current RN sessions store
  // the browser tab list and active id in the same user-scoped session record.
  const applyRestoredSession = useCallback((
    session: Awaited<ReturnType<typeof getSession>>,
    isPrivate: boolean,
  ) => {
    privateModeRef.current = isPrivate
    setPrivateMode(isPrivate)
    setLiveBrowserTabIds([])
    setBrowseNavigationIds({})
    if (isPrivate) {
      setActiveTabState('home')
      setBrowserTabs([])
      setActiveBrowserTabId(null)
      return
    }
    setActiveTabState(session.activeTab || 'home')
    const restored = restoreBrowserTabs(session.browserTabs)
    const tabs = Array.isArray(session.browserTabs)
      ? restored
      : session.lastBrowseUrl
        ? restoreBrowserTabs([{ id: newBrowserTabId(), url: session.lastBrowseUrl, title: '' }])
        : []
    const id = tabs.find(tab => tab.id === session.activeBrowserTabId)?.id || tabs[0]?.id || null
    setBrowserTabs(tabs)
    setActiveBrowserTabId(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const generation = ++restoreGenerationRef.current
    Promise.all([getSession(), getSettings()])
      .then(([session, settings]) => {
        if (cancelled || restoreGenerationRef.current !== generation) return
        applyRestoredSession(session, settings.privateMode)
        setPrivacySettled(true)
        setSessionRestored(true)
      })
      .catch(err => console.warn('[session] restore failed:', err))
    return () => { cancelled = true }
  }, [applyRestoredSession])

  // Boot P2P worklet
  // Android: Write bundle to filesystem first to avoid JNI string size limits
  // iOS: Pass bundle inline (works fine)
  useEffect(() => {
    let mounted = true

    async function boot() {
      if (!Worklet) {
        if (mounted) {
          setStorageSettled(true)
          setState('ready')
        }
        return
      }

      try {
        const worklet = new Worklet()
        workletRef.current = worklet

        const rpc = new PearRPC(worklet.IPC)
        rpcRef.current = rpc

        let gotReady = false

        rpc.onReady((port) => {
          if (!mounted) return
          gotReady = true
          // The local AsyncStorage read can still be pending. Invalidate it
          // before the backend swaps so it cannot overwrite native state.
          ++restoreGenerationRef.current
          setSessionRestored(false)
          setPrivacySettled(false)
          setStorageSettled(false)
          setProxyPort(port)
          // Finish backend selection before restoring and saving the session.
          // This keeps an empty AsyncStorage snapshot from replacing a native
          // Android session that already lives in the shared Hyperbee.
          bootstrapHyperbeeStorage(rpc)
            .catch((err) => console.warn('[App] Hyperbee bootstrap threw:', err))
            .then(() => Promise.all([getSession(), getSettings()]))
            .then(([session, settings]) => {
              if (!mounted) return
              applyRestoredSession(session, settings.privateMode)
              setPrivacySettled(true)
              setSessionRestored(true)
              setStorageSettled(true)
              setState('ready')
            })
            .catch(err => {
              if (!mounted) return
              console.warn('[App] session reload failed:', err)
              setStorageSettled(true)
              setState('ready')
            })
        })

        rpc.onPeerCount((count) => {
          if (mounted) setPeerCount(count)
        })

        rpc.onBootProgress((data) => {
          if (mounted && data?.message) {
            setBootProgress(data.message)
          }
        })

        rpc.on(EVT.LOGIN_REQUEST, (data) => {
          if (!mounted || !data?.requestId || !data?.driveKey) return
          setPendingLogin({
            requestId: String(data.requestId),
            driveKey: String(data.driveKey),
            appName: data.appName ? String(data.appName) : 'A PearBrowser app',
            reason: data.reason ? String(data.reason) : '',
            scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : [],
          })
        })

        rpc.on(EVT.SWARM_REQUEST, (data) => {
          if (!mounted || !data?.requestId || !data?.driveKey || !data?.topicHex) return
          setPendingSwarm({
            requestId: String(data.requestId),
            driveKey: String(data.driveKey),
            topicHex: String(data.topicHex),
            protocol: data.protocol ? String(data.protocol) : 'pear.swarm.v1',
            appName: data.appName ? String(data.appName) : 'A PearBrowser app',
            reason: data.reason ? String(data.reason) : '',
          })
        })

        rpc.onError((err) => {
          if (!mounted) return
          if (state !== 'ready') {
            setError(err.message)
            setState('error')
          }
        })

        let storagePath: string
        try {
          const documentDir = Paths.document.uri.substring('file://'.length)
          storagePath = Paths.join(documentDir, 'pearbrowser')
        } catch {
          storagePath = './pearbrowser-storage'
        }

        if (Platform.OS === 'android') {
          // Android: Convert bundle to Uint8Array to use startBytes instead of
          // startUTF8, avoiding JNI string size limits on large bundles.
          // startBytes passes ArrayBuffer with offset/length — different native path.
          const encoder = new TextEncoder()
          const bundleBytes = encoder.encode(backendBundle)
          worklet.start('/app.bundle', bundleBytes, [storagePath])
        } else {
          // iOS: Inline source works fine
          worklet.start('/app.bundle', backendBundle, [storagePath])
        }

        if (!mounted) return
        setState('connecting')

        setTimeout(() => {
          if (mounted && !gotReady) {
            setState('error')
            setError('P2P engine failed to start within 30s.')
          }
        }, 30000)
      } catch (err: any) {
        if (mounted) {
          console.error('Worklet boot failed:', err)
          setStorageSettled(true)
          setState('ready') // Fall back to HTTP-only mode
        }
      }
    }

    boot()
    return () => {
      mounted = false
      if (workletRef.current) {
        try { workletRef.current.terminate() }
        catch (err) { console.warn('[App] worklet terminate failed:', err) }
      }
    }
  }, [])

  // Fetch connection details for status panel
  useEffect(() => {
    async function fetchDetails() {
      if (!rpcRef.current) return
      try {
        const status = await rpcRef.current.getStatus()
        if (status) {
          setConnectionDetails({
            dhtConnected: status.dhtConnected || false,
            peerCount: status.peerCount || 0,
            proxyPort: status.proxyPort || proxyPort || 0,
            browseDrives: status.browseDrives || 0,
            // `installedApps` is the legacy RPC field for cached Hyperdrives.
            savedOfflineSites: status.installedApps || 0,
            publishedSites: status.publishedSites || 0,
          })
        }
      } catch (err) {
        console.warn('[App] status panel poll failed:', err)
      }
    }

    if (showStatusPanel) {
      fetchDetails()
      const interval = setInterval(fetchDetails, 3000)
      return () => clearInterval(interval)
    }
  }, [showStatusPanel, proxyPort])

  // Network change monitoring
  useEffect(() => {
    // Start network monitoring
    networkMonitor.start(async (info: NetworkInfo) => {
      console.log('Network changed:', info)
      
      setIsOffline(!info.isConnected)
      
      if (!info.isConnected) {
        // Went offline - P2P will handle this via swarm
        console.log('Device went offline')
      } else {
        // Came back online or changed networks
        console.log('Network available:', info.type)
        
        // Optional: Check if we need to re-bootstrap P2P
        if (state === 'ready' && rpcRef.current) {
          try {
            const status = await rpcRef.current.getStatus()
            if (!status.dhtConnected) {
              console.log('DHT disconnected, attempting reconnect...')
              // Could trigger worklet restart here
            }
          } catch (err) {
            console.warn('[App] DHT reconnect check failed:', err)
          }
        }
      }
    })
    
    return () => {
      networkMonitor.stop()
    }
  }, [state])

  // Navigate to hyper:// URL (switches to Browse tab)
  const handleNavigate = useCallback((url: string) => {
    setBrowseUrl(url)
    setActiveTab('browse')
  }, [setBrowseUrl, setActiveTab])

  const selectBrowserTab = useCallback((id: string) => {
    if (!browserTabs.some(tab => tab.id === id)) return
    setActiveBrowserTabId(id)
    setActiveTab('browse')
    setShowTabSwitcher(false)
  }, [browserTabs, setActiveTab])

  const closeBrowserTab = useCallback((id: string) => {
    const index = browserTabs.findIndex(tab => tab.id === id)
    if (index < 0) return
    const remaining = browserTabs.filter(tab => tab.id !== id)
    setBrowserTabs(remaining)
    setLiveBrowserTabIds(previous => previous.filter(tabId => tabId !== id))
    setBrowseNavigationIds(previous => {
      const next = { ...previous }
      delete next[id]
      return next
    })
    if (id === activeBrowserTabId) {
      const next = remaining[index] || remaining[remaining.length - 1]
      setActiveBrowserTabId(next?.id || null)
      if (!next) setActiveTab('home')
    }
  }, [browserTabs, activeBrowserTabId, setActiveTab])

  const openNewBrowserTab = useCallback(() => {
    const id = newBrowserTabId()
    setBrowserTabs(previous => [...previous, { id, url: '', title: '' }])
    setActiveBrowserTabId(id)
    setShowTabSwitcher(false)
    setActiveTab('home')
  }, [setActiveTab])

  const handlePrivateModeChange = useCallback((enabled: boolean) => {
    // Settings has already scrubbed the stored session. Discard live pages
    // before normal-mode persistence can resume.
    privateModeRef.current = enabled
    setPrivateMode(enabled)
    setBrowserTabs([])
    setActiveBrowserTabId(null)
    setLiveBrowserTabIds([])
    setBrowseNavigationIds({})
    setShowTabSwitcher(false)
    setShowSearch(false)
    setSearchQuery('')
    setActiveTab('home')
  }, [setActiveTab])

  // The shared setting can change in the native shell while RN stays open.
  // Observe it with a strict read, discard all live tabs at a transition,
  // and confirm a shared-session scrub before allowing normal saves again.
  useEffect(() => {
    if (!sessionRestored || !storageSettled || state !== 'ready') return
    let cancelled = false
    let checking = false
    const checkPrivateMode = async () => {
      if (checking) return
      checking = true
      try {
        const observed = await getPrivateModeStrict()
        if (cancelled) return
        if (observed !== privateModeRef.current) {
          setPrivacySettled(false)
          pendingPrivacyScrubRef.current = observed
          handlePrivateModeChange(observed)
        }
        if (pendingPrivacyScrubRef.current !== null) {
          await scrubBrowserSession()
          if (cancelled) return
          pendingPrivacyScrubRef.current = null
          setPrivacySettled(true)
        }
      } catch (err) {
        console.warn('[App] privacy mode observation failed:', err)
        // A pending scrub keeps normal session persistence gated. The next
        // interval or foreground event retries it.
      } finally {
        checking = false
      }
    }
    void checkPrivateMode()
    const interval = setInterval(checkPrivateMode, 5_000)
    const subscription = NativeAppState.addEventListener('change', next => {
      if (next === 'active') void checkPrivateMode()
    })
    return () => {
      cancelled = true
      clearInterval(interval)
      subscription.remove()
    }
  }, [sessionRestored, storageSettled, state, handlePrivateModeChange])

  // Keep a bounded set of live WebViews. Switching among these tabs keeps
  // form state, scroll position, and in-page history; an evicted tab is
  // re-resolved from its saved address when selected again. Never evict a
  // possibly active native view during an unrelated tab metadata update.
  useEffect(() => {
    if (activeTab !== 'browse' || !activeBrowserTabId) return
    setLiveBrowserTabIds(previous => {
      const available = new Set(browserTabs.map(tab => tab.id))
      const next = previous.filter(id => id !== activeBrowserTabId && available.has(id))
      next.push(activeBrowserTabId)
      const bounded = next.slice(-MAX_LIVE_BROWSER_TABS)
      return bounded.length === previous.length && bounded.every((id, index) => id === previous[index])
        ? previous
        : bounded
    })
  }, [activeTab, activeBrowserTabId, browserTabs])

  const availableBrowserTabIds = new Set(browserTabs.map(tab => tab.id))
  const retainedBrowserTabIds = liveBrowserTabIds.filter(id => availableBrowserTabIds.has(id))
  if (activeTab === 'browse' && activeBrowserTabId && availableBrowserTabIds.has(activeBrowserTabId) &&
      !retainedBrowserTabIds.includes(activeBrowserTabId)) {
    retainedBrowserTabIds.push(activeBrowserTabId)
  }
  const visibleBrowserTabIds = retainedBrowserTabIds.slice(-MAX_LIVE_BROWSER_TABS)

  // Open static catalog content by drive key or URL. Native packages remain
  // desktop-only and legacy v2 entries remain migration-required.
  const handleOpenCatalogContent = useCallback((keyOrUrl: string) => {
    if (/^hyper:\/\//i.test(keyOrUrl)) {
      handleNavigate(keyOrUrl)
    } else if (keyOrUrl.startsWith('http')) {
      const match = keyOrUrl.match(/\/v1\/hyper\/([a-f0-9]{64})/i)
      handleNavigate(match ? `hyper://${match[1]}` : keyOrUrl)
    } else {
      Alert.alert(
        'Unsupported destination',
        'PearBrowser Mobile opens static Hyperdrive content only. Signed Pear v3 native packages are desktop-only; legacy Pear v2 entries remain migration-required.'
      )
    }
  }, [handleNavigate])

  const resolveLoginConsent = useCallback(async (approved: boolean) => {
    const request = pendingLogin
    if (!request) return
    setPendingLogin(null)
    try {
      await rpcRef.current?.loginResolve(
        request.requestId,
        approved,
        approved ? request.scopes : []
      )
    } catch (err: any) {
      console.warn('[App] loginResolve failed:', err)
      if (approved) Alert.alert('Sign-in failed', err?.message || 'Could not complete sign-in.')
    }
  }, [pendingLogin])

  const resolveSwarmConsent = useCallback(async (approved: boolean) => {
    const request = pendingSwarm
    if (!request) return
    setPendingSwarm(null)
    try {
      await rpcRef.current?.swarmResolve(request.requestId, approved)
    } catch (err: any) {
      console.warn('[App] swarmResolve failed:', err)
      if (approved) Alert.alert('Swarm join failed', err?.message || 'Could not complete swarm join.')
    }
  }, [pendingSwarm])

  // --- Render ---

  if (state !== 'ready') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.center}>
          {state === 'error' ? (
            <>
              <Text style={styles.errorTitle}>Cannot start P2P engine</Text>
              <Text style={styles.errorMsg}>{error}</Text>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.bootTitle}>PearBrowser</Text>
              <Text style={styles.bootMsg}>
                {bootProgress || (state === 'booting' ? 'Starting P2P engine...' : 'Connecting to DHT...')}
              </Text>
            </>
          )}
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Status Panel Modal */}
      <Modal
        visible={showStatusPanel}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatusPanel(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.statusPanel}>
            <View style={styles.statusPanelHeader}>
              <Text style={styles.statusPanelTitle}>Connection Status</Text>
              <TouchableOpacity onPress={() => setShowStatusPanel(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.statusPanelContent}>
              <View style={styles.statusSection}>
                <Text style={styles.statusSectionTitle}>Network</Text>
                <View style={styles.statusDetailRow}>
                  <Text style={styles.statusDetailLabel}>DHT Status</Text>
                  <View style={styles.statusBadge}>
                    <View style={[styles.statusDot, connectionDetails.dhtConnected ? styles.statusDotOk : styles.statusDotError]} />
                    <Text style={[styles.statusDetailValue, connectionDetails.dhtConnected && styles.statusOk]}>
                      {connectionDetails.dhtConnected ? 'Connected' : 'Disconnected'}
                    </Text>
                  </View>
                </View>
                <View style={styles.statusDetailRow}>
                  <Text style={styles.statusDetailLabel}>Active Peers</Text>
                  <Text style={styles.statusDetailValue}>{connectionDetails.peerCount}</Text>
                </View>
                <View style={styles.statusDetailRow}>
                  <Text style={styles.statusDetailLabel}>Connection State</Text>
                  <Text style={[styles.statusDetailValue, connectionStatus === 'connected' && styles.statusOk]}>
                    {connectionStatus === 'connected' ? 'Ready' : 
                     connectionStatus === 'connecting' ? 'Connecting...' : 'Offline'}
                  </Text>
                </View>
              </View>

              <View style={styles.statusSection}>
                <Text style={styles.statusSectionTitle}>Services</Text>
                <View style={styles.statusDetailRow}>
                  <Text style={styles.statusDetailLabel}>Local Proxy</Text>
                  <Text style={styles.statusDetailValue}>
                    {connectionDetails.proxyPort > 0 ? `Port ${connectionDetails.proxyPort}` : 'Not running'}
                  </Text>
                </View>
                <View style={styles.statusDetailRow}>
                  <Text style={styles.statusDetailLabel}>Browse Drives</Text>
                  <Text style={styles.statusDetailValue}>{connectionDetails.browseDrives}</Text>
                </View>
                <View style={styles.statusDetailRow}>
                  <Text style={styles.statusDetailLabel}>Saved Offline Sites</Text>
                  <Text style={styles.statusDetailValue}>{connectionDetails.savedOfflineSites}</Text>
                </View>
                <View style={styles.statusDetailRow}>
                  <Text style={styles.statusDetailLabel}>Published Sites</Text>
                  <Text style={styles.statusDetailValue}>{connectionDetails.publishedSites}</Text>
                </View>
              </View>

              <View style={styles.statusFooter}>
                <Text style={styles.statusFooterText}>
                  Tap the status dot anywhere in the app to view this panel
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* pear.login() consent */}
      <Modal
        visible={!!pendingLogin}
        transparent
        animationType="fade"
        onRequestClose={() => resolveLoginConsent(false)}
      >
        <View style={styles.modalOverlay}>
          {pendingLogin && (
            <View style={styles.consentPanel}>
              <Text style={styles.consentEyebrow}>Pear sign-in</Text>
              <Text style={styles.consentTitle}>{pendingLogin.appName}</Text>
              <Text style={styles.consentBody}>
                This app wants to sign in with your per-app Pear identity.
                {pendingLogin.reason ? ` ${pendingLogin.reason}` : ''}
              </Text>
              <Text style={styles.consentLabel}>Requested access</Text>
              {pendingLogin.scopes.length > 0 ? pendingLogin.scopes.map(scope => (
                <Text key={scope} style={styles.consentScope}>• {scope}</Text>
              )) : (
                <Text style={styles.consentScope}>• app public key only</Text>
              )}
              <Text style={styles.consentFootnote}>
                The app gets a stable key scoped to this drive, not your root device key.
              </Text>
              <View style={styles.consentActions}>
                <TouchableOpacity style={styles.consentSecondaryBtn} onPress={() => resolveLoginConsent(false)}>
                  <Text style={styles.consentSecondaryText}>Deny</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.consentPrimaryBtn} onPress={() => resolveLoginConsent(true)}>
                  <Text style={styles.consentPrimaryText}>Allow</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* window.pear.swarm.v1 arbitrary topic consent */}
      <Modal
        visible={!!pendingSwarm}
        transparent
        animationType="fade"
        onRequestClose={() => resolveSwarmConsent(false)}
      >
        <View style={styles.modalOverlay}>
          {pendingSwarm && (
            <View style={styles.consentPanel}>
              <Text style={styles.consentEyebrow}>Direct swarm access</Text>
              <Text style={styles.consentTitle}>{pendingSwarm.appName}</Text>
              <Text style={styles.consentBody}>
                This app wants to join a raw Hyperswarm topic. That can expose your network metadata
                to peers outside the app drive namespace.
              </Text>
              {pendingSwarm.reason ? (
                <>
                  <Text style={styles.consentLabel}>Reason</Text>
                  <Text style={styles.consentBody}>{pendingSwarm.reason}</Text>
                </>
              ) : null}
              <Text style={styles.consentLabel}>Topic</Text>
              <Text style={styles.consentMono}>{pendingSwarm.topicHex}</Text>
              <Text style={styles.consentFootnote}>
                Protocol: {pendingSwarm.protocol}. This grant is saved for this app and topic until revoked.
              </Text>
              <View style={styles.consentActions}>
                <TouchableOpacity style={styles.consentSecondaryBtn} onPress={() => resolveSwarmConsent(false)}>
                  <Text style={styles.consentSecondaryText}>Deny</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.consentPrimaryBtn} onPress={() => resolveSwarmConsent(true)}>
                  <Text style={styles.consentPrimaryText}>Allow</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* QR Scanner Modal */}
      <Modal
        visible={showQRScanner}
        animationType="slide"
        onRequestClose={() => setShowQRScanner(false)}
      >
        <QRScannerScreen
          onScan={(url) => {
            setShowQRScanner(false)
            handleNavigate(url)
          }}
          onClose={() => setShowQRScanner(false)}
        />
      </Modal>

      {/* Header with StatusDot */}
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <StatusDot 
          status={connectionStatus} 
          peerCount={peerCount}
          showLabel
          onPress={() => setShowStatusPanel(true)}
        />
      </View>

      {/* Active screen */}
      <View style={styles.screenContainer}>
        {activeTab === 'home' && (showSearch ? (
          <SearchScreen
            rpc={rpcRef.current}
            initialQuery={searchQuery}
            onOpen={(url) => { setShowSearch(false); handleNavigate(url) }}
            onBack={() => setShowSearch(false)}
            onOpenSettings={() => {
              setShowSearch(false)
              setActiveTab('more')
              setShowSettings(true)
            }}
          />
        ) : (
          <HomeScreen
            rpc={rpcRef.current!}
            peerCount={peerCount}
            status={connectionStatus}
            onNavigate={handleNavigate}
            onSearch={(query) => {
              setSearchQuery(query)
              setShowSearch(true)
            }}
            onOpenQR={() => setShowQRScanner(true)}
          />
        ))}
        {activeTab === 'explore' && (
          <ExploreScreen
            rpc={rpcRef.current}
            onVisit={handleOpenCatalogContent}
          />
        )}
        {/* Retained tab views stay mounted while hidden, up to the pool cap. */}
        {visibleBrowserTabIds.map(id => {
          const tab = browserTabs.find(item => item.id === id)!
          const visible = activeTab === 'browse' && activeBrowserTabId === id
          return (
            <View
              key={id}
              testID={`live-browser-tab-${id}`}
              style={[styles.screenContainer, !visible && styles.hiddenScreen]}
            >
              <BrowseScreen
                rpc={rpcRef.current!}
                proxyPort={proxyPort}
                peerCount={peerCount}
                status={connectionStatus}
                initialUrl={tab.url || null}
                navigationRequestId={browseNavigationIds[id] || 0}
                onTabChange={(url, title) => updateBrowserTab(id, url, title)}
                onOpenTabs={() => setShowTabSwitcher(true)}
                tabCount={browserTabs.length}
                isOffline={isOffline}
              />
            </View>
          )
        })}
        {false && (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>P2P engine not connected — browsing unavailable in demo mode</Text>
          </View>
        )}
        {activeTab === 'more' && !showSites && !showBookmarks && !showHistory && !showSettings && !editingSiteId && !showTemplatePicker && (
          <MoreScreen
            rpc={rpcRef.current!}
            peerCount={peerCount}
            proxyPort={proxyPort}
            status={connectionStatus}
            onNavigateToSites={() => setShowSites(true)}
            onNavigateToBookmarks={() => setShowBookmarks(true)}
            onNavigateToHistory={() => setShowHistory(true)}
            onNavigateToSettings={() => setShowSettings(true)}
          />
        )}
        {activeTab === 'more' && showBookmarks && (
          <BookmarksScreen
            onOpen={(url) => { handleNavigate(url); setShowBookmarks(false) }}
            onBack={() => setShowBookmarks(false)}
          />
        )}
        {activeTab === 'more' && showHistory && (
          <HistoryScreen
            onOpen={(url) => { handleNavigate(url); setShowHistory(false) }}
            onBack={() => setShowHistory(false)}
          />
        )}
        {activeTab === 'more' && showSettings && !showBackupPhrase && !showRestoreIdentity && (
          <SettingsScreen
            onBack={() => setShowSettings(false)}
            onPrivateModeChange={handlePrivateModeChange}
            rpc={rpcRef.current}
            onOpenBackupPhrase={() => setShowBackupPhrase(true)}
            onOpenRestoreIdentity={() => setShowRestoreIdentity(true)}
          />
        )}
        {activeTab === 'more' && showSettings && showBackupPhrase && (
          <BackupPhraseScreen
            rpc={rpcRef.current}
            onBack={() => setShowBackupPhrase(false)}
          />
        )}
        {activeTab === 'more' && showSettings && showRestoreIdentity && (
          <RestoreIdentityScreen
            rpc={rpcRef.current}
            onBack={() => setShowRestoreIdentity(false)}
            onRestored={() => {
              setShowRestoreIdentity(false)
              setShowSettings(false)
            }}
          />
        )}
        {activeTab === 'more' && showSites && !editingSiteId && !showTemplatePicker && (
          <MySitesScreen
            rpc={rpcRef.current}
            onEditSite={(siteId) => setEditingSiteId(siteId)}
            onPreviewSite={(url) => { handleNavigate(url); setShowSites(false) }}
            onCreateNew={(name) => { setPendingSiteName(name); setShowTemplatePicker(true) }}
          />
        )}
        {showTemplatePicker && (
          <TemplatePickerScreen
            onSelect={async (template) => {
              setEditorTemplate(template)
              setShowTemplatePicker(false)
              // Create the site with the chosen name, then open editor
              if (rpcRef.current && pendingSiteName) {
                try {
                  const result = await rpcRef.current.createSite(pendingSiteName)
                  setEditingSiteId(result.siteId)
                } catch (err: any) {
                  console.warn('[App] createSite failed:', err)
                  Alert.alert('Could not create site', err?.message || 'An unknown error occurred.')
                }
              }
            }}
            onBack={() => setShowTemplatePicker(false)}
          />
        )}
        {editingSiteId && (
          <SiteEditorScreen
            rpc={rpcRef.current}
            siteId={editingSiteId}
            siteName={pendingSiteName || undefined}
            initialBlocks={editorTemplate?.blocks?.map((b: any, i: number) => ({ ...b, id: 'tb' + i })) || undefined}
            initialTheme={editorTemplate?.theme || undefined}
            onBack={() => { setEditingSiteId(null); setEditorTemplate(null) }}
            onPreview={(url) => { handleNavigate(url); setEditingSiteId(null); setEditorTemplate(null); setShowSites(false) }}
          />
        )}
      </View>

      <Modal
        visible={showTabSwitcher}
        animationType="slide"
        onRequestClose={() => setShowTabSwitcher(false)}
      >
        <TabSwitcherScreen
          tabs={browserTabs}
          activeTabId={activeBrowserTabId}
          onSelect={selectBrowserTab}
          onClose={closeBrowserTab}
          onNewTab={openNewBrowserTab}
          onDismiss={() => setShowTabSwitcher(false)}
        />
      </Modal>

      {/* Bottom tab bar */}
      <View style={styles.tabBar}>
        <TabButton
          label="Home"
          icon="{ }"
          active={activeTab === 'home'}
          onPress={() => setActiveTab('home')}
        />
        <TabButton
          label="Explore"
          icon="[ ]"
          active={activeTab === 'explore'}
          onPress={() => setActiveTab('explore')}
        />
        <TabButton
          label="Browse"
          icon="<>"
          active={activeTab === 'browse'}
          onPress={() => setActiveTab('browse')}
          badge={isOffline ? '!' : undefined}
        />
        <TabButton
          label="More"
          icon="..."
          active={activeTab === 'more'}
          onPress={() => setActiveTab('more')}
        />
      </View>
    </SafeAreaView>
  )
}

function TabButton({ label, icon, active, onPress, badge }: {
  label: string; icon: string; active: boolean; onPress: () => void; badge?: string
}) {
  return (
    <TouchableOpacity onPress={onPress} style={tabStyles.button} activeOpacity={0.6}>
      <View>
        <Text style={[tabStyles.icon, active && tabStyles.activeIcon]}>{icon}</Text>
        {badge && (
          <View style={tabStyles.badge}>
            <Text style={tabStyles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[tabStyles.label, active && tabStyles.activeLabel]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  bootTitle: { color: colors.accent, fontSize: 28, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  bootMsg: { color: colors.textSecondary, fontSize: 14 },
  errorTitle: { color: colors.error, fontSize: 20, fontWeight: '600', marginBottom: 12 },
  errorMsg: { color: '#fca5a5', fontSize: 14, textAlign: 'center' },
  screenContainer: { flex: 1 },
  hiddenScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    pointerEvents: 'none',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: colors.bg,
  },
  headerSpacer: { flex: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    minHeight: 400,
  },
  statusPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusPanelTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color: colors.textSecondary,
    fontSize: 20,
    fontWeight: '400',
  },
  statusPanelContent: {
    padding: 20,
  },
  statusSection: {
    marginBottom: 24,
  },
  statusSectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  statusDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusDetailLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  statusDetailValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  statusOk: {
    color: '#22c55e',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusDotOk: {
    backgroundColor: '#22c55e',
  },
  statusDotError: {
    backgroundColor: colors.error,
  },
  statusFooter: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statusFooterText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  consentPanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  consentEyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  consentTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  consentBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  consentLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
  },
  consentScope: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 4,
  },
  consentMono: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace',
    backgroundColor: colors.bg,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  consentFootnote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  consentActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  consentSecondaryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  consentSecondaryText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  consentPrimaryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  consentPrimaryText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '800',
  },
  tabBar: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingBottom: 20, // Safe area bottom padding
  },
})

const tabStyles = StyleSheet.create({
  button: { flex: 1, alignItems: 'center', paddingTop: 8 },
  icon: { fontSize: 18, color: colors.textMuted, fontFamily: 'monospace', fontWeight: '700' },
  activeIcon: { color: colors.accent },
  label: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  activeLabel: { color: colors.accent },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: colors.error,
    borderRadius: 10,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
})
