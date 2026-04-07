import React from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../lib/theme'

type BrowserTab = {
  id: string
  url: string
  title: string
}

type Props = {
  tabs: BrowserTab[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTab: () => void
  onDismiss: () => void
}

export function TabSwitcherScreen({ tabs, activeTabId, onSelect, onClose, onNewTab, onDismiss }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onDismiss} style={styles.doneBtn}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tabs.length} Tab{tabs.length !== 1 ? 's' : ''}</Text>
        <TouchableOpacity onPress={onNewTab} style={styles.newBtn}>
          <Text style={styles.newText}>+</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {tabs.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No open tabs</Text>
            <TouchableOpacity onPress={onNewTab} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>Open New Tab</Text>
            </TouchableOpacity>
          </View>
        )}

        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tabCard, tab.id === activeTabId && styles.tabCardActive]}
            onPress={() => onSelect(tab.id)}
            activeOpacity={0.7}
          >
            <View style={styles.tabHeader}>
              <Text style={styles.tabTitle} numberOfLines={1}>{tab.title || 'New Tab'}</Text>
              <TouchableOpacity onPress={() => onClose(tab.id)} style={styles.closeBtn}>
                <Text style={styles.closeText}>x</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.tabPreview}>
              <Text style={styles.tabUrl} numberOfLines={1}>{tab.url || 'about:blank'}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

export type { BrowserTab }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  doneBtn: { width: 60 },
  doneText: { color: colors.accent, fontSize: 16, fontWeight: '500' },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  newBtn: { width: 60, alignItems: 'flex-end' },
  newText: { color: colors.accent, fontSize: 24, fontWeight: '300' },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 80 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: colors.textMuted, fontSize: 16, marginBottom: 16 },
  emptyBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 12,
  },
  emptyBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  tabCard: {
    backgroundColor: colors.surface, borderRadius: 12,
    marginBottom: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent',
  },
  tabCardActive: { borderColor: colors.accent },
  tabHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  tabTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '500', flex: 1 },
  closeBtn: { padding: 4, marginLeft: 8 },
  closeText: { color: colors.textMuted, fontSize: 16 },
  tabPreview: {
    backgroundColor: colors.surfaceElevated, paddingHorizontal: 14,
    paddingVertical: 10, minHeight: 50,
  },
  tabUrl: { color: colors.textMuted, fontSize: 11, fontFamily: 'monospace' },
})
