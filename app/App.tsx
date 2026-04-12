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
  Modal, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Paths } from 'expo-file-system'
import { PearRPC } from './lib/rpc'
import { networkMonitor, NetworkInfo } from './lib/network'
import { StatusDot } from './components/StatusDot'
import * as FileSystem from 'expo-file-system'

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
import { ExploreScreen } from './screens/ExploreScreen'
import { BrowseScreen } from './screens/BrowseScreen'
import { MoreScreen } from './screens/MoreScreen'
import { BookmarksScreen } from './screens/BookmarksScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
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
  installedApps: number
  publishedSites: number
}

export default function App() {
  const [state, setState] = useState<AppState>('booting')
  const [proxyPort, setProxyPort] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [peerCount, setPeerCount] = useState(0)
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [browseUrl, setBrowseUrl] = useState<string | null>(null)
  const [showSites, setShowSites] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null)
  const [editorTemplate, setEditorTemplate] = useState<Template | null>(null)
  const [pendingSiteName, setPendingSiteName] = useState('')
  const [isOffline, setIsOffline] = useState(false)
  const [hasBrowseOpened, setHasBrowseOpened] = useState(false)
  const [bootProgress, setBootProgress] = useState<string>('Initializing...')
  
  // Connection status panel state
  const [showStatusPanel, setShowStatusPanel] = useState(false)
  const [connectionDetails, setConnectionDetails] = useState<ConnectionStatusDetails>({
    dhtConnected: false,
    peerCount: 0,
    proxyPort: 0,
    browseDrives: 0,
    installedApps: 0,
    publishedSites: 0,
  })

  const workletRef = useRef<any>(null)
  const rpcRef = useRef<PearRPC | null>(null)

  const connectionStatus: 'connected' | 'connecting' | 'offline' | 'error' | 'http-only' = state === 'ready'
    ? (proxyPort > 0 ? 'connected' : (Worklet ? 'connecting' : 'http-only'))
    : state === 'error' ? 'offline' : 'connecting'

  // Boot P2P worklet
  // Android: Write bundle to filesystem first to avoid JNI string size limits
  // iOS: Pass bundle inline (works fine)
  useEffect(() => {
    let mounted = true

    async function boot() {
      if (!Worklet) {
        if (mounted) setState('ready')
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
          setProxyPort(port)
          setState('ready')
        })

        rpc.onPeerCount((count) => {
          if (mounted) setPeerCount(count)
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
          setState('ready') // Fall back to HTTP-only mode
        }
      }
    }

    boot()
    return () => {
      mounted = false
      if (workletRef.current) try { workletRef.current.terminate() } catch {}
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
            installedApps: status.installedApps || 0,
            publishedSites: status.publishedSites || 0,
          })
        }
      } catch {}
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
          } catch {}
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
  }, [])

  // Track when browse tab was first opened to keep WebView mounted
  useEffect(() => {
    if (activeTab === 'browse') {
      setHasBrowseOpened(true)
    }
  }, [activeTab])

  // Launch saved site by ID (from home screen)
  const handleLaunchApp = useCallback(async (appId: string) => {
    if (!rpcRef.current) return
    try {
      const result = await rpcRef.current.launchApp(appId)
      setBrowseUrl(`hyper://${result.appId}`)
      setActiveTab('browse')
    } catch {}
  }, [])

  // Launch app by drive key or URL (from explore directory)
  const handleLaunchByKey = useCallback((keyOrUrl: string) => {
    if (keyOrUrl.startsWith('http')) {
      // Direct HTTP URL from relay — load in WebView directly
      setBrowseUrl(keyOrUrl)
    } else {
      setBrowseUrl(`hyper://${keyOrUrl}`)
    }
    setActiveTab('browse')
  }, [])

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
                  <Text style={styles.statusDetailLabel}>Installed Apps</Text>
                  <Text style={styles.statusDetailValue}>{connectionDetails.installedApps}</Text>
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
        {activeTab === 'home' && (
          <HomeScreen
            rpc={rpcRef.current!}
            peerCount={peerCount}
            status={connectionStatus}
            onNavigate={handleNavigate}
          />
        )}
        {activeTab === 'explore' && (
          <ExploreScreen
            rpc={rpcRef.current}
            onVisit={handleLaunchByKey}
          />
        )}
        {/* BrowseScreen - keep mounted after first open, hide when not active */}
        {(activeTab === 'browse' || hasBrowseOpened) && rpcRef.current && (
          <View style={[styles.screenContainer, activeTab !== 'browse' && styles.hiddenScreen]}>
            <BrowseScreen
              rpc={rpcRef.current}
              proxyPort={proxyPort}
              peerCount={peerCount}
              status={connectionStatus}
              initialUrl={browseUrl}
              isOffline={isOffline}
            />
          </View>
        )}
        {activeTab === 'browse' && !rpcRef.current && (
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
        {activeTab === 'more' && showSettings && (
          <SettingsScreen onBack={() => setShowSettings(false)} />
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
                } catch {}
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
