import React, { useState, useCallback, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, TextInput,
} from 'react-native'
import { colors } from '../lib/theme'
import { AppCard } from '../components/AppCard'
import type { PearRPC } from '../lib/rpc'

type AppInfo = {
  id: string
  name: string
  description: string
  author: string
  version: string
  driveKey: string
  categories: string[]
  iconData?: string
}

type Props = {
  rpc: PearRPC | null
  onLaunchApp: (driveKey: string) => void
}

export function AppStoreScreen({ rpc, onLaunchApp }: Props) {
  // Default catalog relay URL — live relay
  // Default catalog — public HiveRelay
  const [catalogUrl, setCatalogUrl] = useState('https://relay.p2phiverelay.xyz')
  const [apps, setApps] = useState<AppInfo[]>([])
  const [installed, setInstalled] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load installed apps and catalog on mount
  useEffect(() => {
    if (rpc) {
      rpc.listInstalled().then((list: any[]) => {
        setInstalled(list.map((a: any) => a.id))
      }).catch(() => {})
    }
    // Auto-load default catalog
    if (catalogUrl) {
      handleLoadCatalog()
    }
  }, [rpc])

  const handleLoadCatalog = useCallback(async () => {
    const url = catalogUrl.trim()
    if (!url) return
    setLoading(true)
    setError(null)
    try {
      // If it's an HTTP URL, fetch catalog directly (catalog relay)
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const catalogUrl = url.endsWith('/catalog.json') ? url : url + '/catalog.json'
        const res = await fetch(catalogUrl)
        const catalog = await res.json()
        setApps(catalog.apps || [])
      } else {
        // P2P: use worklet RPC to fetch from Hyperdrive
        if (!rpc) throw new Error('P2P engine not connected')
        let key = url
        if (key.startsWith('hyper://')) key = key.replace('hyper://', '')
        const catalog = await rpc.loadCatalog(key)
        setApps(catalog.apps || [])
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [rpc, catalogUrl])

  const handleInstall = useCallback(async (app: AppInfo) => {
    setInstalling(app.id)
    try {
      // Install = mark as installed + record the catalog relay as the source.
      // App files will be served from the relay HTTP gateway (fast)
      // with P2P as fallback. No need to download the full Hyperdrive upfront.
      if (rpc) {
        await rpc.installApp({
          ...app,
          sourceRelay: catalogUrl.startsWith('http') ? catalogUrl : null
        })
      }
      setInstalled(prev => [...prev, app.id])
      Alert.alert('Installed', `${app.name} is ready to use`)
    } catch (err: any) {
      Alert.alert('Install Failed', err.message)
    } finally {
      setInstalling(null)
    }
  }, [rpc])

  const handleLaunch = useCallback((app: AppInfo) => {
    // If we loaded from an HTTP catalog, launch from the relay gateway directly
    // This serves the app files over HTTP (instant) instead of P2P (slow)
    if (catalogUrl.startsWith('http')) {
      const relayBase = catalogUrl.replace(/\/catalog\.json$/, '')
      onLaunchApp(`${relayBase}/v1/hyper/${app.driveKey}/index.html`)
    } else {
      onLaunchApp(app.driveKey)
    }
  }, [onLaunchApp, catalogUrl])

  if (!rpc) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>P2P engine not connected</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>App Store</Text>
      <Text style={styles.subtitle}>Discover P2P apps from the decentralized web</Text>

      {/* Catalog URL input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={catalogUrl}
          onChangeText={setCatalogUrl}
          onSubmitEditing={handleLoadCatalog}
          placeholder="Enter catalog hyper:// key"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
        />
        <TouchableOpacity
          onPress={handleLoadCatalog}
          style={styles.loadBtn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.loadBtnText}>Load</Text>
          )}
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* App list */}
      {apps.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {apps.length} app{apps.length !== 1 ? 's' : ''} available
          </Text>
          {apps.map((app) => {
            const isInstalled = installed.includes(app.id)
            const isInstalling = installing === app.id
            return (
              <AppCard
                key={app.id}
                name={app.name}
                description={app.description}
                icon={app.iconData}
                installed={isInstalled}
                size="large"
                onPress={() => isInstalled ? handleLaunch(app) : handleInstall(app)}
                onAction={() => isInstalled ? handleLaunch(app) : handleInstall(app)}
                actionLabel={isInstalling ? '...' : isInstalled ? 'Open' : 'Get'}
              />
            )
          })}
        </View>
      )}

      {apps.length === 0 && !loading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{'{ }'}</Text>
          <Text style={styles.emptyTitle}>No catalog loaded</Text>
          <Text style={styles.emptyText}>
            Enter a catalog key above, or ask someone to share their app catalog with you.
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted: { color: colors.textMuted, fontSize: 14 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginBottom: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12,
    paddingLeft: 14, marginBottom: 16,
  },
  input: {
    flex: 1, color: colors.textPrimary, fontSize: 14,
    paddingVertical: 12, fontFamily: 'monospace',
  },
  loadBtn: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 8, marginRight: 6, marginVertical: 6,
  },
  loadBtnText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  errorBox: {
    backgroundColor: '#7f1d1d', borderRadius: 8,
    padding: 12, marginBottom: 16,
  },
  errorText: { color: '#fca5a5', fontSize: 12 },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: colors.textSecondary, fontSize: 13, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyIcon: { color: colors.accent, fontSize: 36, marginBottom: 12, fontFamily: 'monospace' },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
})
