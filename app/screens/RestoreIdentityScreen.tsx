/**
 * RestoreIdentityScreen — restore an identity from a 12-word phrase.
 *
 * Phase 1 ticket 3. Warns that the current identity and any local data
 * tied to it will be effectively replaced — data under the current seed
 * stays on disk but the app will no longer read it after restart.
 */

import React, { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { colors } from '../lib/theme'
import type { PearRPC } from '../lib/rpc'

type Props = {
  rpc: PearRPC | null
  onBack: () => void
  onRestored: () => void
}

export function RestoreIdentityScreen({ rpc, onBack, onRestored }: Props) {
  const [input, setInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [valid, setValid] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleCheck = useCallback(async (value: string) => {
    setInput(value)
    setValid(null)
    // Only validate when we have 12+ whitespace-separated words
    const words = value.trim().split(/\s+/).filter(Boolean)
    if (words.length !== 12 && words.length !== 24) return
    if (!rpc) return
    setValidating(true)
    try {
      const res = await rpc.identityValidatePhrase(value.trim().toLowerCase())
      setValid(res.valid)
    } catch {
      setValid(false)
    } finally {
      setValidating(false)
    }
  }, [rpc])

  const handleRestore = useCallback(() => {
    if (!rpc) {
      Alert.alert('Not connected', 'P2P engine is not available.')
      return
    }
    if (!valid) {
      Alert.alert('Invalid phrase', 'Check that every word is spelled correctly and the phrase is 12 or 24 words.')
      return
    }
    Alert.alert(
      'Replace identity?',
      'Your current identity will be replaced. Data stored under the current seed will remain on disk but will no longer be used. The app will reload.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace', style: 'destructive',
          onPress: async () => {
            setSubmitting(true)
            try {
              await rpc.identityImportPhrase(input.trim().toLowerCase())
              Alert.alert(
                'Identity restored',
                'Close and reopen PearBrowser for the new identity to take effect.',
                [{ text: 'OK', onPress: onRestored }],
              )
            } catch (err: any) {
              Alert.alert('Restore failed', err?.message || 'Unknown error')
            } finally {
              setSubmitting(false)
            }
          },
        },
      ],
    )
  }, [rpc, valid, input, onRestored])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Restore Identity</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Text style={styles.hint}>
          Enter your 12-word backup phrase. Words separated by single spaces. Case doesn't matter.
        </Text>

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={handleCheck}
          placeholder="abandon ability able above ..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          editable={!submitting}
        />

        <View style={styles.statusRow}>
          {validating && <ActivityIndicator size="small" color={colors.accent} />}
          {!validating && valid === true && (
            <Text style={[styles.status, { color: colors.success }]}>✓ Valid phrase</Text>
          )}
          {!validating && valid === false && (
            <Text style={[styles.status, { color: colors.error }]}>✗ Invalid phrase — check each word</Text>
          )}
          {!validating && valid === null && input.length > 0 && (
            <Text style={[styles.status, { color: colors.textMuted }]}>
              Enter 12 or 24 words to validate
            </Text>
          )}
        </View>

        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>⚠️ Heads up</Text>
          <Text style={styles.warningText}>
            Restoring will replace your current identity. The app will need to restart to apply the
            change. Data saved under your current identity will stay on disk but will not be
            readable with the new identity.
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleRestore}
          style={[styles.restoreBtn, (!valid || submitting) && styles.restoreBtnDisabled]}
          disabled={!valid || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={[styles.restoreBtnText, !valid && { color: colors.textMuted }]}>
              Restore Identity
            </Text>
          )}
        </TouchableOpacity>
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
  listContent: { padding: 16, paddingBottom: 100 },
  hint: { color: colors.textSecondary, fontSize: 13, marginBottom: 12, lineHeight: 20 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    color: colors.textPrimary, fontSize: 14, fontFamily: 'monospace',
    minHeight: 100, marginBottom: 8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', minHeight: 24, marginBottom: 16 },
  status: { fontSize: 13, fontWeight: '500' },
  warningCard: {
    backgroundColor: '#2a1a00',
    borderLeftWidth: 4, borderLeftColor: colors.warning,
    borderRadius: 8, padding: 14, marginBottom: 20,
  },
  warningTitle: { color: colors.warning, fontWeight: '700', fontSize: 14, marginBottom: 6 },
  warningText: { color: colors.textPrimary, fontSize: 12, lineHeight: 18 },
  restoreBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  restoreBtnDisabled: { backgroundColor: colors.surface },
  restoreBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
})
