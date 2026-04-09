import React, { useState, useEffect } from 'react'
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

interface ConnectionDetails {
  dhtConnected: boolean
  peerCount: number
  proxyPort: number
  browseDrives: number
  installedApps: number
  storageUsed: number
  storageLimit: number
  publishedSites: number
}

export function MoreScreen({ rpc, peerCount, proxyPort, status, onNavigateToSites, onNavigateToBookmarks, onNavigateToHistory, onNavigateToSettings }: Props) {
  const [showIdentity, setShowIdentity] = useState(false)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [connectionDetails, setConnectionDetails] = useState<ConnectionDetails>({
    dhtConnected: false,
    peerCount: 0,
    proxyPort: 0,
    browseDrives: 0,
    installedApps: 0,
    storageUsed: 0,
    storageLimit: 0,
    publishedSites: 0,
  })

  // Fetch connection details periodically
  useEffect(() => {
    async function fetchDetails() {
      if (!rpc) return
      try {
        const status = await rpc.getStatus()
        if (status) {
          setConnectionDetails({
            dhtConnected: status.dhtConnected || false,
            peerCount: status.peerCount || 0,
            proxyPort: status.proxyPort || proxyPort || 0,
            browseDrives: status.browseDrives || 0,
            installedApps: status.installedApps || 0,
            storageUsed: status.storageUsed || 0,
            storageLimit: status.storageLimit || 0,
            publishedSites: status.publishedSites || 0,
          })
        }
      } catch {}
    }
    
    fetchDetails()
    const interval = setInterval(fetchDetails, 5000) // Update every 5s
    return () => clearInterval(interval)
  }, [rpc, proxyPort])

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

  // Format bytes to human readable
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>More</Text>

      <View style={styles.section}>
        <MenuItem label="My Sites" subtitle="Create and manage P2P websites" onPress={onNavigateToSites} />
        <MenuItem label="Bookmarks" subtitle="Saved sites" onPress={onNavigateToBookmarks} />
        <MenuItem label="History" subtitle="Recently visited" onPress={onNavigateToHistory} />
      </View>

      {/* Connection Status Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection Status</Text>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>DHT Network</Text>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, connectionDetails.dhtConnected ? styles.statusDotOk : styles.statusDotError]} />
            <Text style={[styles.statusValue, connectionDetails.dhtConnected && styles.statusOk]}>
              {connectionDetails.dhtConnected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Active Peers</Text>
          <Text style={styles.statusValue}>{connectionDetails.peerCount}</Text>
        </View>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Local Proxy</Text>
          <Text style={styles.statusValue}>
            {connectionDetails.proxyPort > 0 ? `Port ${connectionDetails.proxyPort}` : 'Not running'}
          </Text>
        </View>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Browse Drives</Text>
          <Text style={styles.statusValue}>{connectionDetails.browseDrives}</Text>
        </View>
        
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Installed Apps</Text>
          <Text style={styles.statusValue}>{connectionDetails.installedApps}</Text>
        </View>

        {connectionDetails.storageLimit > 0 && (
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Storage Used</Text>
            <Text style={styles.statusValue}>
              {formatBytes(connectionDetails.storageUsed)} / {formatBytes(connectionDetails.storageLimit)}
            </Text>
          </View>
        )}
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
    paddingVertical: 8,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statusLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  statusValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  statusOk: {
    color: '#22c55e',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusDotOk: {
    backgroundColor: '#22c55e',
  },
  statusDotError: {
    backgroundColor: colors.error,
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
