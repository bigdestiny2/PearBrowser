import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, Switch, Platform,
} from 'react-native'
import { colors } from '../lib/theme'
import { getSettings, updateSettings, clearAllData, addCatalog, removeCatalog, type Settings } from '../lib/storage'
import { StorageMeter } from '../components/StorageMeter'
import { PearRPC } from '../lib/rpc'

type Props = {
  onBack: () => void
  rpc?: PearRPC | null
  onOpenBackupPhrase?: () => void
  onOpenRestoreIdentity?: () => void
}

type RelayConfig = {
  relays: string[]
  enabled: boolean
  configured: boolean
}

export function SettingsScreen({ onBack, rpc, onOpenBackupPhrase, onOpenRestoreIdentity }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [catalogInput, setCatalogInput] = useState('')
  const [storageInfo, setStorageInfo] = useState({
    used: 0,
    limit: 1024 * 1024 * 1024, // 1GB default
    percent: 0
  })
  const [relayConfig, setRelayConfig] = useState<RelayConfig>({ relays: [], enabled: true, configured: false })
  const [relayInput, setRelayInput] = useState('')

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s)
      setCatalogInput(s.catalogUrl)
    })
  }, [])

  // Fetch relay config from worklet (authoritative source)
  useEffect(() => {
    if (!rpc) return
    let cancelled = false
    rpc.getRelays()
      .then((cfg) => {
        if (cancelled) return
        setRelayConfig({
          relays: cfg.relays || [],
          enabled: !!cfg.enabled,
          configured: !!cfg.configured,
        })
      })
      .catch((err) => console.warn('[Settings] getRelays failed:', err))
    return () => { cancelled = true }
  }, [rpc])

  const handleAddRelay = useCallback(async () => {
    if (!rpc) {
      Alert.alert('P2P engine not connected', 'Cannot update relays right now.')
      return
    }
    const url = relayInput.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      Alert.alert('Invalid URL', 'Enter an http:// or https:// URL.')
      return
    }
    const next = [...relayConfig.relays, url.replace(/\/+$/, '')]
    try {
      const result = await rpc.setRelays(next)
      setRelayConfig((prev) => ({ ...prev, relays: result.relays }))
      setRelayInput('')
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not add relay.')
    }
  }, [rpc, relayInput, relayConfig.relays])

  const handleRemoveRelay = useCallback(async (url: string) => {
    if (!rpc) return
    const next = relayConfig.relays.filter((r) => r !== url)
    if (next.length === 0) {
      Alert.alert('Cannot remove', 'At least one relay must be configured. Disable the toggle instead to go relay-free.')
      return
    }
    try {
      const result = await rpc.setRelays(next)
      setRelayConfig((prev) => ({ ...prev, relays: result.relays }))
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not remove relay.')
    }
  }, [rpc, relayConfig.relays])

  const handleToggleRelay = useCallback(async (enabled: boolean) => {
    if (!rpc) return
    try {
      const result = await rpc.setRelayEnabled(enabled)
      setRelayConfig((prev) => ({ ...prev, enabled: result.enabled }))
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not update relay setting.')
    }
  }, [rpc])

  // Fetch storage status on mount and periodically
  useEffect(() => {
    async function fetchStorage() {
      try {
        const status = await rpc?.getStatus()
        if (status) {
          setStorageInfo({
            used: status.storageUsed || 0,
            limit: status.storageLimit || 1024 * 1024 * 1024,
            percent: status.storagePercent || 0
          })
        }
      } catch (err) {
        // Background poll — log only, don't surface (RPC may be momentarily unavailable)
        console.warn('[Settings] storage poll failed:', err)
      }
    }

    fetchStorage()
    // Refresh every 30 seconds
    const interval = setInterval(fetchStorage, 30000)
    return () => clearInterval(interval)
  }, [rpc])

  const handleSaveCatalog = useCallback(async () => {
    if (!catalogInput.trim()) return
    const updated = await updateSettings({ catalogUrl: catalogInput.trim() })
    setSettings(updated)
    Alert.alert('Saved', 'Default catalog URL updated. Restart the app to apply.')
  }, [catalogInput])

  const handleClearData = useCallback(() => {
    Alert.alert('Clear All Data', 'This will remove all bookmarks, history, and settings.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear Everything', style: 'destructive',
        onPress: async () => {
          await clearAllData()
          const fresh = await getSettings()
          setSettings(fresh)
          setCatalogInput(fresh.catalogUrl)
          Alert.alert('Cleared', 'All browser data has been removed.')
        }
      }
    ])
  }, [])

  const handleClearCache = useCallback(async () => {
    try {
      await rpc?.clearCache()
      // Refresh storage info
      const status = await rpc?.getStatus()
      setStorageInfo(prev => ({
        ...prev,
        used: status?.storageUsed || 0,
        percent: status?.storagePercent || 0
      }))
      Alert.alert('Cache Cleared', 'Temporary cache files have been removed.')
    } catch {
      Alert.alert('Error', 'Failed to clear cache.')
    }
  }, [rpc])

  if (!settings) return null

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {/* Storage */}
        <Text style={styles.sectionTitle}>STORAGE</Text>
        <StorageMeter
          used={storageInfo.used}
          limit={storageInfo.limit}
          onClearCache={handleClearCache}
        />

        {/* Catalog */}
        <Text style={styles.sectionTitle}>EXPLORE DIRECTORY</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Default Catalog URL</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={catalogInput}
              onChangeText={setCatalogInput}
              placeholder="https://relay.example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={handleSaveCatalog} style={styles.saveBtn}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>The Explore tab loads this directory on startup</Text>
        </View>

        {/* Privacy */}
        <Text style={styles.sectionTitle}>PRIVACY</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Private Mode</Text>
              <Text style={styles.settingHint}>No history recorded. Ephemeral drive cache. Data cleared on exit.</Text>
            </View>
            <Switch
              value={settings.privateMode}
              onValueChange={async (val) => {
                const updated = await updateSettings({ privateMode: val })
                setSettings(updated)
                Alert.alert(
                  val ? 'Private Mode On' : 'Private Mode Off',
                  val ? 'Browsing history will not be recorded. Cached drives will be cleared when you close the app.' : 'Normal browsing resumed. History will be recorded.'
                )
              }}
              trackColor={{ true: colors.accent, false: colors.surfaceElevated }}
            />
          </View>
        </View>

        {/* Relay (configurable via RPC — Phase 0 ticket 2) */}
        <Text style={styles.sectionTitle}>RELAYS</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>
                {relayConfig.enabled ? 'Hybrid Fetch (on)' : 'Pure P2P Mode'}
              </Text>
              <Text style={styles.settingHint}>
                {relayConfig.enabled
                  ? 'Relay HTTP (fast, 1-2s) + P2P Hyperswarm (fallback). Turn off for pure P2P — slower first paint but no relay dependency.'
                  : 'Content loads via Hyperswarm DHT only. Slower on first visit but fully decentralized — no relay is consulted.'}
              </Text>
            </View>
            <Switch
              value={relayConfig.enabled}
              onValueChange={handleToggleRelay}
              disabled={!rpc || !relayConfig.configured}
              trackColor={{ true: colors.accent, false: colors.surfaceElevated }}
            />
          </View>

          {!relayConfig.configured && (
            <Text style={[styles.settingHint, { marginTop: 10 }]}>
              P2P engine not connected — relay settings will be available once the worklet is ready.
            </Text>
          )}

          {relayConfig.relays.length === 0 ? (
            <Text style={[styles.settingHint, { marginTop: 10 }]}>
              No relays configured. Add one below to speed up first paint.
            </Text>
          ) : (
            relayConfig.relays.map((url, idx) => (
              <View key={url} style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingValue} numberOfLines={1} ellipsizeMode="middle">
                    {url}
                  </Text>
                  {idx === 0 && (
                    <Text style={[styles.settingHint, { color: colors.accent }]}>Primary</Text>
                  )}
                </View>
                {relayConfig.relays.length > 1 && (
                  <TouchableOpacity
                    onPress={() => handleRemoveRelay(url)}
                    style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                  >
                    <Text style={{ color: colors.error, fontSize: 12 }}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}

          <View style={[styles.inputRow, { marginTop: 8 }]}>
            <TextInput
              style={styles.input}
              value={relayInput}
              onChangeText={setRelayInput}
              placeholder="https://relay.example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!!rpc}
            />
            <TouchableOpacity
              onPress={handleAddRelay}
              style={[styles.saveBtn, !rpc && { opacity: 0.5 }]}
              disabled={!rpc}
            >
              <Text style={styles.saveBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Catalog list */}
        <Text style={styles.sectionTitle}>KNOWN CATALOGS</Text>
        <View style={styles.card}>
          {settings.catalogList.length === 0 && (
            <Text style={styles.settingHint}>No catalogs configured.</Text>
          )}
          {settings.catalogList.map((url) => {
            const isPrimary = url === settings.catalogUrl
            return (
              <View key={url} style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingValue} numberOfLines={1} ellipsizeMode="middle">
                    {url}
                  </Text>
                  {isPrimary && <Text style={[styles.settingHint, { color: colors.accent }]}>Primary</Text>}
                </View>
                {!isPrimary && (
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        const next = await updateSettings({ catalogUrl: url })
                        setSettings(next)
                        setCatalogInput(url)
                      } catch (err: any) {
                        Alert.alert('Error', err?.message || 'Could not switch primary catalog.')
                      }
                    }}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, marginRight: 4 }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 12 }}>Use</Text>
                  </TouchableOpacity>
                )}
                {settings.catalogList.length > 1 && (
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        const next = await removeCatalog(url)
                        setSettings(next)
                        setCatalogInput(next.catalogUrl)
                      } catch (err: any) {
                        Alert.alert('Error', err?.message || 'Could not remove catalog.')
                      }
                    }}
                    style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                  >
                    <Text style={{ color: colors.error, fontSize: 12 }}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          })}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={catalogInput}
              onChangeText={setCatalogInput}
              placeholder="https://relay.example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={async () => {
                const url = catalogInput.trim()
                if (!url) return
                if (!/^https?:\/\//.test(url) && !/^[0-9a-f]{52,64}$/i.test(url)) {
                  Alert.alert('Invalid URL', 'Enter an https:// URL or a hyper:// drive key.')
                  return
                }
                try {
                  const next = await addCatalog(url)
                  setSettings(next)
                  setCatalogInput('')
                  Alert.alert('Catalog Added', 'Saved to your catalog list.')
                } catch (err: any) {
                  Alert.alert('Error', err?.message || 'Could not add catalog.')
                }
              }}
              style={styles.saveBtn}
            >
              <Text style={styles.saveBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Identity (Phase 1 ticket 3) */}
        <Text style={styles.sectionTitle}>IDENTITY</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={onOpenBackupPhrase}
            disabled={!onOpenBackupPhrase}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Backup Phrase</Text>
              <Text style={styles.settingHint}>
                View your 12-word seed phrase. Save it somewhere safe — without it you cannot recover your identity.
              </Text>
            </View>
            <Text style={[styles.settingValue, { color: colors.accent, fontSize: 18 }]}>{'>'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={onOpenRestoreIdentity}
            disabled={!onOpenRestoreIdentity}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Restore from Phrase</Text>
              <Text style={styles.settingHint}>
                Replace this device's identity with one restored from a saved backup phrase.
              </Text>
            </View>
            <Text style={[styles.settingValue, { color: colors.accent, fontSize: 18 }]}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        {/* Data */}
        <Text style={styles.sectionTitle}>DATA</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.settingRow} onPress={handleClearData}>
            <Text style={[styles.settingLabel, { color: colors.error }]}>Clear All Browser Data</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <Text style={styles.sectionTitle}>ABOUT</Text>
        <View style={styles.card}>
          <SettingInfo label="Version" value="0.1.0" />
          <SettingInfo label="Runtime" value="Bare Kit + Hyperswarm" />
          <SettingInfo
            label="Platform"
            value={`${Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS} (React Native ${Platform.Version ?? ''})`}
          />
          <SettingInfo label="Bridge" value="Direct HTTP (localhost)" />
        </View>
      </ScrollView>
    </View>
  )
}

function SettingInfo({ label, value }: { label: string; value: string }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={infoStyles.value}>{value}</Text>
    </View>
  )
}

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  label: { color: colors.textSecondary, fontSize: 14 },
  value: { color: colors.textPrimary, fontSize: 14 },
})

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
  sectionTitle: {
    color: colors.textMuted, fontSize: 12, fontWeight: '600',
    letterSpacing: 1, marginTop: 20, marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 4,
  },
  label: { color: colors.textSecondary, fontSize: 13, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, color: colors.textPrimary,
    fontSize: 14, fontFamily: 'monospace', marginRight: 8,
  },
  saveBtn: {
    backgroundColor: colors.accent, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  saveBtnText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 11, marginTop: 8 },
  settingRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  settingLabel: { color: colors.textPrimary, fontSize: 15 },
  settingValue: { color: colors.textMuted, fontSize: 12, fontFamily: 'monospace', marginTop: 2 },
  settingHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
})
