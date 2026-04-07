import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Share,
} from 'react-native'
import { colors } from '../lib/theme'
import type { PearRPC } from '../lib/rpc'

type Site = {
  siteId: string
  keyHex: string
  name: string
  published: boolean
  createdAt: number
  url: string
}

type Props = {
  rpc: PearRPC | null
  onEditSite: (siteId: string) => void
  onPreviewSite: (url: string) => void
  onCreateNew?: (name: string) => void
}

export function MySitesScreen({ rpc, onEditSite, onPreviewSite, onCreateNew }: Props) {
  const [sites, setSites] = useState<Site[]>([])
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSites()
  }, [rpc])

  const loadSites = useCallback(async () => {
    if (!rpc) { setLoading(false); return }
    try {
      const list = await rpc.listSites()
      setSites(list)
    } catch {}
    setLoading(false)
  }, [rpc])

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    if (onCreateNew) {
      // Go through template picker
      onCreateNew(newName.trim())
      setNewName('')
    } else if (rpc) {
      // Direct create (fallback)
      setCreating(true)
      try {
        const result = await rpc.createSite(newName.trim())
        setNewName('')
        await loadSites()
        onEditSite(result.siteId)
      } catch (err: any) {
        Alert.alert('Error', err.message)
      }
      setCreating(false)
    }
  }, [rpc, newName, loadSites, onEditSite, onCreateNew])

  const handlePublish = useCallback(async (siteId: string) => {
    if (!rpc) return
    try {
      const result = await rpc.publishSite(siteId)
      Alert.alert('Published!', `Your site is live at:\n\nhyper://${result.keyHex.slice(0, 16)}...`)
      await loadSites()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }, [rpc, loadSites])

  const handleShare = useCallback(async (site: Site) => {
    try {
      await Share.share({
        message: `Check out my P2P site: ${site.url}`,
        url: site.url,
      })
    } catch {}
  }, [])

  const handleDelete = useCallback(async (siteId: string, name: string) => {
    Alert.alert('Delete Site', `Delete "${name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          if (!rpc) return
          try {
            await rpc.deleteSite(siteId)
            await loadSites()
          } catch {}
        }
      }
    ])
  }, [rpc, loadSites])

  if (!rpc) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>P2P engine not connected</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>My Sites</Text>
      <Text style={styles.subtitle}>Create and publish P2P websites</Text>

      {/* Create new site */}
      <View style={styles.createRow}>
        <TextInput
          style={styles.createInput}
          value={newName}
          onChangeText={setNewName}
          placeholder="Site name..."
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          onSubmitEditing={handleCreate}
        />
        <TouchableOpacity
          onPress={handleCreate}
          style={styles.createBtn}
          disabled={creating || !newName.trim()}
        >
          {creating ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <Text style={styles.createBtnText}>Create</Text>
          )}
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />}

      {/* Site list */}
      {sites.map((site) => (
        <View key={site.siteId} style={styles.siteCard}>
          <View style={styles.siteHeader}>
            <View style={styles.siteIcon}>
              <Text style={styles.siteIconText}>{site.name[0]?.toUpperCase()}</Text>
            </View>
            <View style={styles.siteInfo}>
              <Text style={styles.siteName}>{site.name}</Text>
              <Text style={styles.siteKey}>
                {site.published ? 'Live' : 'Draft'} · hyper://{site.keyHex.slice(0, 8)}...
              </Text>
            </View>
            <View style={[styles.statusBadge, site.published && styles.statusLive]}>
              <Text style={[styles.statusText, site.published && styles.statusLiveText]}>
                {site.published ? 'Live' : 'Draft'}
              </Text>
            </View>
          </View>

          <View style={styles.siteActions}>
            <TouchableOpacity
              onPress={() => onEditSite(site.siteId)}
              style={styles.actionBtn}
            >
              <Text style={styles.actionText}>Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onPreviewSite(site.url)}
              style={styles.actionBtn}
            >
              <Text style={styles.actionText}>Preview</Text>
            </TouchableOpacity>

            {!site.published ? (
              <TouchableOpacity
                onPress={() => handlePublish(site.siteId)}
                style={[styles.actionBtn, styles.publishBtn]}
              >
                <Text style={[styles.actionText, styles.publishText]}>Publish</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => handleShare(site)}
                style={[styles.actionBtn, styles.shareBtn]}
              >
                <Text style={[styles.actionText, styles.shareText]}>Share</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => handleDelete(site.siteId, site.name)}
              style={styles.actionBtn}
            >
              <Text style={[styles.actionText, { color: colors.error }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {!loading && sites.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{'</>'}</Text>
          <Text style={styles.emptyTitle}>No sites yet</Text>
          <Text style={styles.emptyText}>
            Create your first P2P website above. It will be served from your phone and available to anyone on the network.
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
  createRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 24,
  },
  createInput: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, color: colors.textPrimary,
    fontSize: 16, marginRight: 8,
  },
  createBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  createBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  siteCard: {
    backgroundColor: colors.surface, borderRadius: 12,
    padding: 16, marginBottom: 12,
  },
  siteHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  siteIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  siteIconText: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  siteInfo: { flex: 1 },
  siteName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  siteKey: { color: colors.textMuted, fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  statusBadge: {
    backgroundColor: colors.surfaceElevated, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  statusLive: { backgroundColor: '#166534' },
  statusText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  statusLiveText: { color: colors.success },
  siteActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    backgroundColor: colors.surfaceElevated, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  actionText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  publishBtn: { backgroundColor: colors.accent },
  publishText: { color: colors.bg },
  shareBtn: { backgroundColor: '#1e3a5f' },
  shareText: { color: colors.link },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyIcon: { color: colors.accent, fontSize: 36, marginBottom: 12, fontFamily: 'monospace' },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
})
