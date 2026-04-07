import React from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { colors } from '../lib/theme'
import type { PearRPC } from '../lib/rpc'

type Props = {
  rpc: PearRPC
  peerCount: number
  status: 'connected' | 'connecting' | 'offline'
  onNavigateToSites: () => void
}

export function MoreScreen({ rpc, peerCount, status, onNavigateToSites }: Props) {
  const handleShowStatus = async () => {
    try {
      const s = await rpc.getStatus()
      Alert.alert('P2P Status', [
        `DHT: ${s.dhtConnected ? 'Connected' : 'Disconnected'}`,
        `Peers: ${s.peerCount}`,
        `Browse drives: ${s.browseDrives}`,
        `Installed apps: ${s.installedApps}`,
        `Published sites: ${s.publishedSites}`,
        `Proxy port: ${s.proxyPort}`,
      ].join('\n'))
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>More</Text>

      <View style={styles.section}>
        <MenuItem label="My Sites" subtitle="Create and manage P2P websites" onPress={onNavigateToSites} />
        <MenuItem label="Bookmarks" subtitle="Coming soon" onPress={() => {}} />
        <MenuItem label="History" subtitle="Coming soon" onPress={() => {}} />
      </View>

      <View style={styles.section}>
        <MenuItem label="P2P Status" subtitle={`${peerCount} peers · ${status}`} onPress={handleShowStatus} />
        <MenuItem label="Add Catalog" subtitle="Add a community app catalog" onPress={() => {
          Alert.alert('Add Catalog', 'Enter the hyper:// key of an app catalog Hyperdrive to browse third-party apps.')
        }} />
        <MenuItem label="Settings" subtitle="Theme, defaults, identity" onPress={() => {}} />
      </View>

      <View style={styles.section}>
        <MenuItem label="About PearBrowser" subtitle="v0.1.0 · Built on Holepunch" onPress={() => {}} />
      </View>
    </ScrollView>
  )
}

function MenuItem({ label, subtitle, onPress }: { label: string; subtitle: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={menuStyles.item} activeOpacity={0.6}>
      <View>
        <Text style={menuStyles.label}>{label}</Text>
        <Text style={menuStyles.subtitle}>{subtitle}</Text>
      </View>
      <Text style={menuStyles.arrow}>{'>'}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 100 },
  header: { color: colors.textPrimary, fontSize: 28, fontWeight: '700', marginBottom: 24 },
  section: {
    backgroundColor: colors.surface, borderRadius: 12,
    marginBottom: 16, overflow: 'hidden',
  },
})

const menuStyles = StyleSheet.create({
  item: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  label: { color: colors.textPrimary, fontSize: 16 },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  arrow: { color: colors.textMuted, fontSize: 18 },
})
