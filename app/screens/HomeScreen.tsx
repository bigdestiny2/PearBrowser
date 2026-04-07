import React, { useState, useCallback } from 'react'
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity, FlatList, Clipboard,
} from 'react-native'
import { colors } from '../lib/theme'
import { StatusDot } from '../components/StatusDot'
import { AppCard } from '../components/AppCard'
import type { PearRPC } from '../lib/rpc'

type Props = {
  rpc: PearRPC
  peerCount: number
  status: 'connected' | 'connecting' | 'offline'
  installedApps: any[]
  onNavigate: (url: string) => void
  onLaunchApp: (appId: string) => void
}

// Hardcoded featured apps for MVP (later loaded from catalog Hyperdrive)
const FEATURED: any[] = []

export function HomeScreen({ rpc, peerCount, status, installedApps, onNavigate, onLaunchApp }: Props) {
  const [searchText, setSearchText] = useState('')

  const handleSearch = useCallback(() => {
    let url = searchText.trim()
    if (!url) return

    // Auto-prefix hyper:// for hex keys
    if (/^[a-f0-9]{52,64}$/i.test(url)) {
      url = `hyper://${url}`
    } else if (!url.includes('://')) {
      url = `hyper://${url}`
    }

    onNavigate(url)
    setSearchText('')
  }, [searchText, onNavigate])

  const handlePasteAndGo = useCallback(async () => {
    const text = await Clipboard.getString()
    if (text && /^[a-f0-9]{52,64}$/i.test(text.trim())) {
      onNavigate(`hyper://${text.trim()}`)
    }
  }, [onNavigate])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>PearBrowser</Text>
        <StatusDot status={status} peerCount={peerCount} />
      </View>

      {/* Search / URL bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSearch}
          placeholder="Search or enter hyper:// address"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
        />
        <TouchableOpacity onPress={handlePasteAndGo} style={styles.scanBtn}>
          <Text style={styles.scanBtnText}>QR</Text>
        </TouchableOpacity>
      </View>

      {/* Your Apps */}
      {installedApps.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Apps</Text>
          <View style={styles.appGrid}>
            {installedApps.map((app) => (
              <AppCard
                key={app.id}
                name={app.name}
                icon={app.iconData}
                size="small"
                onPress={() => onLaunchApp(app.id)}
              />
            ))}
            <TouchableOpacity style={styles.addAppCard}>
              <View style={styles.addAppIcon}>
                <Text style={styles.addAppPlus}>+</Text>
              </View>
              <Text style={styles.addAppLabel}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Empty state */}
      {installedApps.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{'{ }'}</Text>
          <Text style={styles.emptyTitle}>Welcome to PearBrowser</Text>
          <Text style={styles.emptyText}>
            Browse the decentralized web, discover P2P apps, and build your own websites.
          </Text>
          <Text style={styles.emptyHint}>
            Enter a hyper:// address above to get started, or explore the app store.
          </Text>
        </View>
      )}

      {/* Discover */}
      {FEATURED.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Discover</Text>
          {FEATURED.map((app) => (
            <AppCard
              key={app.id}
              name={app.name}
              description={app.description}
              icon={app.iconData}
              size="large"
              onPress={() => onNavigate(`hyper://${app.driveKey}`)}
              onAction={() => {}}
              actionLabel="Get"
            />
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 100 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { color: colors.accent, fontSize: 24, fontWeight: '700' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 24,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: 12,
  },
  scanBtn: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  scanBtnText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  appGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  addAppCard: { alignItems: 'center', width: 72, marginRight: 12 },
  addAppIcon: {
    width: 56, height: 56, borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 6, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  addAppPlus: { color: colors.textMuted, fontSize: 28 },
  addAppLabel: { color: colors.textMuted, fontSize: 11 },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyIcon: { color: colors.accent, fontSize: 40, marginBottom: 16, fontFamily: 'monospace' },
  emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  emptyHint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
})
