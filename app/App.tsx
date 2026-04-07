/**
 * PearBrowser — Root Component
 *
 * Boots the Bare worklet (P2P engine), sets up tab navigation,
 * and manages global state (peer count, installed apps, etc.)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, StatusBar,
  ActivityIndicator, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Paths } from 'expo-file-system'
import { PearRPC } from './lib/rpc'

// @ts-ignore — bare-pack bundle exports a string
import backendBundle from '../assets/backend.bundle.mjs'

// Worklet may not be available in dev mode (JSI module)
let Worklet: any = null
try {
  Worklet = require('react-native-bare-kit').Worklet
} catch {
  console.warn('react-native-bare-kit not available — running without P2P engine')
}
import { colors } from './lib/theme'
import { HomeScreen } from './screens/HomeScreen'
import { AppStoreScreen } from './screens/AppStoreScreen'
import { BrowseScreen } from './screens/BrowseScreen'
import { MoreScreen } from './screens/MoreScreen'
import { MySitesScreen } from './screens/MySitesScreen'
import { SiteEditorScreen } from './screens/SiteEditorScreen'

type AppState = 'booting' | 'connecting' | 'ready' | 'error'
type Tab = 'home' | 'store' | 'browse' | 'more'

export default function App() {
  const [state, setState] = useState<AppState>('booting')
  const [proxyPort, setProxyPort] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [peerCount, setPeerCount] = useState(0)
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [browseUrl, setBrowseUrl] = useState<string | null>(null)
  const [installedApps, setInstalledApps] = useState<any[]>([])
  const [showSites, setShowSites] = useState(false)
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null)

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

        // NOW start the worklet
        const documentDir = Paths.document.uri.substring('file://'.length)
        const storagePath = Paths.join(documentDir, 'pearbrowser')
        worklet.start('/app.bundle', backendBundle, [storagePath])

        if (!mounted) return
        setState('connecting')

        // Timeout fallback
        setTimeout(() => {
          if (mounted && !gotReady) {
            setState('ready')
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

  // Navigate to hyper:// URL (switches to Browse tab)
  const handleNavigate = useCallback((url: string) => {
    setBrowseUrl(url)
    setActiveTab('browse')
  }, [])

  // Launch installed app by ID (from home screen)
  const handleLaunchApp = useCallback(async (appId: string) => {
    if (!rpcRef.current) return
    try {
      const result = await rpcRef.current.launchApp(appId)
      setBrowseUrl(`hyper://${result.appId}`)
      setActiveTab('browse')
    } catch {}
  }, [])

  // Launch app by drive key or URL (from app store)
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
            installedApps={installedApps}
            onNavigate={handleNavigate}
            onLaunchApp={handleLaunchApp}
          />
        )}
        {activeTab === 'store' && (
          <AppStoreScreen
            rpc={rpcRef.current}
            onLaunchApp={handleLaunchByKey}
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
        {activeTab === 'more' && !showSites && (
          <MoreScreen
            rpc={rpcRef.current!}
            peerCount={peerCount}
            status={connectionStatus}
            onNavigateToSites={() => setShowSites(true)}
          />
        )}
        {activeTab === 'more' && showSites && !editingSiteId && (
          <MySitesScreen
            rpc={rpcRef.current}
            onEditSite={(siteId) => setEditingSiteId(siteId)}
            onPreviewSite={(url) => { handleNavigate(url); setShowSites(false) }}
          />
        )}
        {editingSiteId && (
          <SiteEditorScreen
            rpc={rpcRef.current}
            siteId={editingSiteId}
            onBack={() => setEditingSiteId(null)}
            onPreview={(url) => { handleNavigate(url); setEditingSiteId(null); setShowSites(false) }}
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
          label="Apps"
          icon="[ ]"
          active={activeTab === 'store'}
          onPress={() => setActiveTab('store')}
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
