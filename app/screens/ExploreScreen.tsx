import React, { useState, useCallback, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput,
} from 'react-native'
import { colors } from '../lib/theme'
import { SiteCard } from '../components/SiteCard'
import type { PearRPC } from '../lib/rpc'

type SiteInfo = {
  id: string
  name: string
  description: string
  author: string
  version: string
  driveKey: string
  categories: string[]
}

type Props = {
  rpc: PearRPC | null
  onVisit: (url: string) => void
}

export function ExploreScreen({ rpc, onVisit }: Props) {
  const [directoryUrl, setDirectoryUrl] = useState('https://relay-us.p2phiverelay.xyz')
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (directoryUrl) handleLoadDirectory()
  }, [])

  const handleLoadDirectory = useCallback(async () => {
    const url = directoryUrl.trim()
    if (!url) return
    setLoading(true)
    setError(null)
    try {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const catalogUrl = url.endsWith('/catalog.json') ? url : url + '/catalog.json'
        const res = await fetch(catalogUrl)
        const catalog = await res.json()
        setSites((catalog.apps || []).map((a: any) => ({
          ...a,
          // Normalize field names
          name: a.name || a.title || 'Untitled',
          description: a.description || '',
        })))
      } else if (rpc) {
        let key = url
        if (key.startsWith('hyper://')) key = key.replace('hyper://', '')
        const catalog = await rpc.loadCatalog(key)
        setSites(catalog.apps || [])
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [rpc, directoryUrl])

  const handleVisit = useCallback((site: SiteInfo) => {
    if (directoryUrl.startsWith('http')) {
      const relayBase = directoryUrl.replace(/\/catalog\.json$/, '')
      onVisit(`${relayBase}/v1/hyper/${site.driveKey}/index.html`)
    } else {
      onVisit(`hyper://${site.driveKey}`)
    }
  }, [onVisit, directoryUrl])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Explore</Text>
      <Text style={styles.subtitle}>Discover sites and tools on the P2P web</Text>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={directoryUrl}
          onChangeText={setDirectoryUrl}
          onSubmitEditing={handleLoadDirectory}
          placeholder="Enter relay URL or hyper:// address"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
        />
        <TouchableOpacity onPress={handleLoadDirectory} style={styles.connectBtn} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.connectBtnText}>Connect</Text>
          )}
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {sites.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {sites.length} site{sites.length !== 1 ? 's' : ''}
          </Text>
          {sites.map((site) => (
            <SiteCard
              key={site.id}
              name={site.name}
              description={site.description}
              onPress={() => handleVisit(site)}
              onAction={() => handleVisit(site)}
              actionLabel="Visit"
            />
          ))}
        </View>
      )}

      {sites.length === 0 && !loading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{ }</Text>
          <Text style={styles.emptyTitle}>No directory connected</Text>
          <Text style={styles.emptyText}>
            Enter a relay URL above to browse the P2P web directory, or type a hyper:// address to visit a site directly.
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 100 },
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
  connectBtn: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 8, marginRight: 6, marginVertical: 6,
  },
  connectBtnText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
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
