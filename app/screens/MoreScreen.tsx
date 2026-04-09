import React, { useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
  TextInput, Clipboard,
} from 'react-native'
import { colors } from '../lib/theme'
import type { PearRPC } from '../lib/rpc'

type Props = {
  rpc: PearRPC | null
  peerCount: number
  proxyPort?: number
  status: 'connected' | 'connecting' | 'offline'
  onNavigateToSites: () => void
  onNavigateToBookmarks: () => void
  onNavigateToHistory: () => void
  onNavigateToSettings: () => void
}

export function MoreScreen({ rpc, peerCount, proxyPort, status, onNavigateToSites, onNavigateToBookmarks, onNavigateToHistory, onNavigateToSettings }: Props) {
  const [showIdentity, setShowIdentity] = useState(false)
  const [publicKey, setPublicKey] = useState<string | null>(null)

  const handleShowStatus = async () => {
    if (!rpc) {
      Alert.alert('P2P Status', 'Engine: Demo mode\nNo worklet connected')
      return
    }
    try {
      const s = await rpc.getStatus()
      Alert.alert('P2P Status', [
        `DHT: ${s.dhtConnected ? 'Connected' : 'Disconnected'}`,
        `Peers: ${s.peerCount}`,
        `Proxy port: ${s.proxyPort || proxyPort || 'N/A'}`,
        `Browse drives: ${s.browseDrives}`,
        `Saved sites: ${s.installedApps}`,
        `Published sites: ${s.publishedSites}`,
      ].join('\n'))
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  const handleShowIdentity = async () => {
    if (!rpc) return
    try {
      const s = await rpc.getStatus()
      // The identity is the swarm keypair public key — we don't have
      // a direct RPC for this yet, so use the proxy port to query the HTTP bridge
      if (proxyPort) {
        try {
          const res = await fetch(`http://127.0.0.1:${proxyPort}/api/identity`)
          const data = await res.json()
          setPublicKey(data.publicKey)
          setShowIdentity(true)
        } catch {}
      }
    } catch {}
  }

  const handleCopyKey = () => {
    if (publicKey) {
      Clipboard.setString(publicKey)
      Alert.alert('Copied', 'Public key copied to clipboard')
    }
  }

  const handleAddCatalog = () => {
    Alert.prompt(
      'Add Catalog',
      'Enter the URL of a HiveRelay catalog:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (url) => {
            if (url) {
              Alert.alert('Catalog Added', `Added: ${url}\n\nSwitch to the Apps tab and tap Load to browse this catalog.`)
            }
          }
        }
      ],
      'plain-text',
      'https://relay.example.com'
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>More</Text>

      <View style={styles.section}>
        <MenuItem label="My Sites" subtitle="Create and manage P2P websites" onPress={onNavigateToSites} />
        <MenuItem label="Bookmarks" subtitle="Saved sites" onPress={onNavigateToBookmarks} />
        <MenuItem label="History" subtitle="Recently visited" onPress={onNavigateToHistory} />
      </View>

      <View style={styles.section}>
        <MenuItem
          label="P2P Status"
          subtitle={status === 'connected' ? (peerCount > 0 ? `${peerCount} peers` : 'Engine ready') : status === 'connecting' ? 'Connecting...' : 'Offline'}
          onPress={handleShowStatus}
        />
        <MenuItem label="My Identity" subtitle="View your device public key" onPress={handleShowIdentity} />
        <MenuItem label="Add Catalog" subtitle="Add a community app catalog" onPress={handleAddCatalog} />
        <MenuItem label="Settings" subtitle="Catalog, data, about" onPress={onNavigateToSettings} />
      </View>

      {showIdentity && publicKey && (
        <View style={styles.identityCard}>
          <Text style={styles.identityLabel}>Your Device Identity</Text>
          <Text style={styles.identityKey} selectable>{publicKey}</Text>
          <TouchableOpacity onPress={handleCopyKey} style={styles.copyBtn}>
            <Text style={styles.copyBtnText}>Copy Key</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <MenuItem label="About PearBrowser" subtitle="v0.1.0 · Built on Holepunch" onPress={() => {
          Alert.alert('PearBrowser v0.1.0', [
            'A P2P mobile app platform built on:',
            '',
            '• Bare Kit (Holepunch runtime)',
            '• Hyperswarm (P2P networking)',
            '• Autobase (multi-device sync)',
            '• HiveRelay (infrastructure)',
            '',
            'github.com/bigdestiny2/PearBrowser'
          ].join('\n'))
        }} />
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
  identityCard: {
    backgroundColor: colors.surface, borderRadius: 12,
    padding: 16, marginBottom: 16,
  },
  identityLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  identityKey: { color: colors.textPrimary, fontSize: 11, fontFamily: 'monospace', lineHeight: 18, marginBottom: 12 },
  copyBtn: {
    backgroundColor: colors.surfaceElevated, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start',
  },
  copyBtnText: { color: colors.accent, fontSize: 14, fontWeight: '500' },
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
