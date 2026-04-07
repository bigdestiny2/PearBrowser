import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { colors } from '../lib/theme'
import { getHistory, clearHistory, type HistoryEntry } from '../lib/storage'

type Props = {
  onOpen: (url: string) => void
  onBack: () => void
}

export function HistoryScreen({ onOpen, onBack }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    getHistory().then(setHistory)
  }, [])

  const handleClear = useCallback(() => {
    Alert.alert('Clear History', 'Remove all browsing history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          await clearHistory()
          setHistory([])
        }
      }
    ])
  }, [])

  // Group by day
  const grouped = groupByDay(history)

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>History</Text>
        <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {history.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>~</Text>
            <Text style={styles.emptyTitle}>No history</Text>
            <Text style={styles.emptyText}>Sites you visit will appear here.</Text>
          </View>
        )}

        {grouped.map(([day, entries]) => (
          <View key={day}>
            <Text style={styles.dayHeader}>{day}</Text>
            {entries.map((h, i) => (
              <TouchableOpacity
                key={h.url + i}
                style={styles.item}
                onPress={() => onOpen(h.url)}
                activeOpacity={0.6}
              >
                <View style={styles.itemTime}>
                  <Text style={styles.timeText}>{formatTime(h.visitedAt)}</Text>
                </View>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{h.title || 'Untitled'}</Text>
                  <Text style={styles.itemUrl} numberOfLines={1}>{h.url}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

function groupByDay(history: HistoryEntry[]): [string, HistoryEntry[]][] {
  const groups = new Map<string, HistoryEntry[]>()
  for (const h of history) {
    const day = formatDay(h.visitedAt)
    const list = groups.get(day) || []
    list.push(h)
    groups.set(day, list)
  }
  return [...groups.entries()]
}

function formatDay(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today.getTime() - 86400000)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
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
  clearBtn: { paddingVertical: 4, width: 60, alignItems: 'flex-end' },
  clearText: { color: colors.error, fontSize: 14 },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 80 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { color: colors.accent, fontSize: 36, marginBottom: 12, fontFamily: 'monospace' },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  dayHeader: {
    color: colors.textSecondary, fontSize: 13, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 8,
  },
  item: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 10,
    padding: 12, marginBottom: 6,
  },
  itemTime: { width: 50, marginRight: 12 },
  timeText: { color: colors.textMuted, fontSize: 12, fontFamily: 'monospace' },
  itemInfo: { flex: 1 },
  itemTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  itemUrl: { color: colors.textMuted, fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
})
