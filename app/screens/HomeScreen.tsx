import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity, Clipboard,
} from 'react-native'
import { colors } from '../lib/theme'
import { StatusDot } from '../components/StatusDot'
import { SiteCard } from '../components/SiteCard'
import { getBookmarks, type Bookmark } from '../lib/storage'
import type { PearRPC } from '../lib/rpc'

type Props = {
  rpc: PearRPC
  peerCount: number
  status: 'connected' | 'connecting' | 'offline' | 'http-only' | 'error'
  onNavigate: (url: string) => void
  onOpenQR?: () => void
}

export function HomeScreen({ rpc, peerCount, status, onNavigate, onOpenQR }: Props) {
  const [searchText, setSearchText] = useState('')
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  useEffect(() => {
    getBookmarks().then(setBookmarks)
  }, [])

  const handleSearch = useCallback(() => {
    let url = searchText.trim()
    if (!url) return
    if (/^[a-f0-9]{52,64}$/i.test(url)) url = `hyper://${url}`
    else if (!url.includes('://')) url = `hyper://${url}`
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
      <View style={styles.header}>
        <Text style={styles.title}>PearBrowser</Text>
        <StatusDot status={status} peerCount={peerCount} />
      </View>

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
        <TouchableOpacity
          onPress={onOpenQR || handlePasteAndGo}
          onLongPress={handlePasteAndGo}
          style={styles.scanBtn}
        >
          <Text style={styles.scanBtnText}>QR</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Access — bookmarked sites */}
      {bookmarks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Access</Text>
          <View style={styles.siteGrid}>
            {bookmarks.slice(0, 8).map((b) => (
              <SiteCard
                key={b.url}
                name={b.title || 'Site'}
                size="small"
                onPress={() => onNavigate(b.url)}
              />
            ))}
          </View>
        </View>
      )}

      {/* Welcome state */}
      {bookmarks.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{'{ }'}</Text>
          <Text style={styles.emptyTitle}>Welcome to PearBrowser</Text>
          <Text style={styles.emptyText}>
            Browse the decentralized web, discover P2P sites, and build your own websites.
          </Text>
          <Text style={styles.emptyHint}>
            Enter a hyper:// address above, or explore the directory.
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 100 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  title: { color: colors.accent, fontSize: 24, fontWeight: '700' },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12,
    paddingHorizontal: 14, marginBottom: 24,
  },
  searchInput: {
    flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 12,
  },
  scanBtn: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, marginLeft: 8,
  },
  scanBtnText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: colors.textSecondary, fontSize: 13, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  siteGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyIcon: { color: colors.accent, fontSize: 40, marginBottom: 16, fontFamily: 'monospace' },
  emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  emptyHint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
})
