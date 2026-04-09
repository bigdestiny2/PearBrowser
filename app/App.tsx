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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Paths } from 'expo-file-system'
import { PearRPC } from './lib/rpc'
import { networkMonitor, NetworkInfo } from './lib/network'

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

  const workletRef = useRef<any>(null)
  const rpcRef = useRef<PearRPC | null>(null)

  const connectionStatus = state === 'ready'
    ? (proxyPort > 0 ? 'connected' : 'connecting')
    : state === 'error' ? 'offline' : 'connecting'

  // Boot worklet
  useEffect(() => {
    let mounted = true

    async function boot() {
      // If bare-kit not available or no bundle, run in demo mode
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
          // Start foreground service on Android to keep P2P connections alive
          if (Platform.OS === 'android') {
            NativeModules.P2PModule?.startService()
          }
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

        // Resolve storage path (platform-specific)
        let storagePath: string
        try {
          const documentDir = Paths.document.uri.substring('file://'.length)
          storagePath = Paths.join(documentDir, 'pearbrowser')
        } catch {
          storagePath = Platform.OS === 'android'
            ? '/data/data/com.pearbrowser.app/files/pearbrowser'
            : './pearbrowser-storage'
        }

        // Start the worklet
        worklet.start('/app.bundle', backendBundle, [storagePath])

        if (!mounted) return
        setState('connecting')

        // Timeout fallback - if we haven't gotten ready in 30s, it's an error
        setTimeout(() => {
          if (mounted && !gotReady) {
            setState('error')
            setError('P2P engine failed to start within 30s. Check your connection and restart the app.')
            // Optionally try to restart the worklet
            try { 
              if (workletRef.current) {
                workletRef.current.terminate()
              }
            } catch {}
          }
        }, 30000)
      } catch (err: any) {
        if (mounted) {
          setState('ready')
        }
      }
    }

    boot()
    return () => {
      mounted = false
      if (workletRef.current) try { workletRef.current.terminate() } catch {}
    }
  }, [])

  // Network change monitoring
  useEffect(() => {
    // Start network monitoring
    networkMonitor.start(async (info: NetworkInfo) => {
      console.log('Network changed:', info)
      
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
                {state === 'booting' ? 'Starting P2P engine...' : 'Connecting to DHT...'}
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
        {activeTab === 'browse' && rpcRef.current && (
          <BrowseScreen
            rpc={rpcRef.current}
            proxyPort={proxyPort}
            peerCount={peerCount}
            status={connectionStatus}
            initialUrl={browseUrl}
          />
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
          onPress={() => setActiveTab('browse')}
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

function TabButton({ label, icon, active, onPress }: {
  label: string; icon: string; active: boolean; onPress: () => void
}) {
  return (
    <TouchableOpacity onPress={onPress} style={tabStyles.button} activeOpacity={0.6}>
      <Text style={[tabStyles.icon, active && tabStyles.activeIcon]}>{icon}</Text>
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
})
