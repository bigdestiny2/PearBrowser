import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { colors } from '../lib/theme'
import { getBookmarks, removeBookmark, type Bookmark } from '../lib/storage'

type Props = {
  onOpen: (url: string) => void
  onBack: () => void
}

export function BookmarksScreen({ onOpen, onBack }: Props) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  useEffect(() => {
    getBookmarks().then(setBookmarks)
  }, [])

  const handleRemove = useCallback(async (url: string) => {
    const updated = await removeBookmark(url)
    setBookmarks(updated)
  }, [])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bookmarks</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {bookmarks.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>*</Text>
            <Text style={styles.emptyTitle}>No bookmarks yet</Text>
            <Text style={styles.emptyText}>
              Bookmark sites while browsing by tapping the share button.
            </Text>
          </View>
        )}

        {bookmarks.map((b) => (
          <TouchableOpacity
            key={b.url}
            style={styles.item}
            onPress={() => onOpen(b.url)}
            activeOpacity={0.6}
          >
            <View style={styles.itemIcon}>
              <Text style={styles.itemIconText}>{b.title?.[0]?.toUpperCase() || '*'}</Text>
            </View>
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle} numberOfLines={1}>{b.title || 'Untitled'}</Text>
              <Text style={styles.itemUrl} numberOfLines={1}>{b.url}</Text>
            </View>
            <TouchableOpacity onPress={() => handleRemove(b.url)} style={styles.removeBtn}>
              <Text style={styles.removeText}>x</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { paddingVertical: 4, width: 60 },
  backText: { color: colors.accent, fontSize: 16 },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 80 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { color: colors.accent, fontSize: 36, marginBottom: 12 },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  item: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12,
    padding: 12, marginBottom: 8,
  },
  itemIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  itemIconText: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  itemInfo: { flex: 1 },
  itemTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
  itemUrl: { color: colors.textMuted, fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  removeBtn: { padding: 8 },
  removeText: { color: colors.error, fontSize: 16 },
})
