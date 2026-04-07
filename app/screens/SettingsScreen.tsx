import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, Switch,
} from 'react-native'
import { colors } from '../lib/theme'
import { getSettings, updateSettings, clearAllData, type Settings } from '../lib/storage'

type Props = {
  onBack: () => void
}

export function SettingsScreen({ onBack }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [catalogInput, setCatalogInput] = useState('')

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s)
      setCatalogInput(s.catalogUrl)
    })
  }, [])

  const handleSaveCatalog = useCallback(async () => {
    if (!catalogInput.trim()) return
    const updated = await updateSettings({ catalogUrl: catalogInput.trim() })
    setSettings(updated)
    Alert.alert('Saved', 'Default catalog URL updated. Restart the app to apply.')
  }, [catalogInput])

  const handleClearData = useCallback(() => {
    Alert.alert('Clear All Data', 'This will remove all bookmarks, history, and settings. App data and installed apps will remain.', [
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
        {/* Catalog */}
        <Text style={styles.sectionTitle}>APP STORE</Text>
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
          <Text style={styles.hint}>The App Store tab loads this catalog on startup</Text>
        </View>

        {/* Relay */}
        <Text style={styles.sectionTitle}>RELAY</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingLabel}>Primary Relay</Text>
              <Text style={styles.settingValue}>{settings.catalogUrl}</Text>
            </View>
          </View>
          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingLabel}>Hybrid Fetch</Text>
              <Text style={styles.settingHint}>Relay HTTP (fast) + P2P Hyperswarm (fallback)</Text>
            </View>
            <Switch value={true} disabled trackColor={{ true: colors.accent }} />
          </View>
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
          <SettingInfo label="Platform" value="iOS (React Native)" />
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
