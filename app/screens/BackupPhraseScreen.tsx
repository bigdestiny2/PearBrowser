/**
 * BackupPhraseScreen — display the user's 12-word BIP-39 seed phrase.
 *
 * Phase 1 ticket 3 of the Holepunch alignment plan.
 * Matches the Keet-style identity backup flow.
 *
 * UX rules:
 *   - Phrase is blurred by default; user must tap to reveal
 *   - Copy-to-clipboard button with a short confirmation
 *   - Confirmation step: user must tick "I've written it down" to dismiss
 *   - Warning: anyone with the phrase can impersonate your identity
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Clipboard, Switch,
} from 'react-native'
import { colors } from '../lib/theme'
import type { PearRPC } from '../lib/rpc'

type Props = {
  rpc: PearRPC | null
  onBack: () => void
}

export function BackupPhraseScreen({ rpc, onBack }: Props) {
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!rpc) {
      setError('P2P engine not connected')
      setLoading(false)
      return
    }
    rpc.identityExportPhrase()
      .then((r) => setMnemonic(r.mnemonic))
      .catch((err) => setError(err?.message || 'Could not load backup phrase'))
      .finally(() => setLoading(false))
  }, [rpc])

  const handleCopy = useCallback(() => {
    if (!mnemonic) return
    Clipboard.setString(mnemonic)
    Alert.alert(
      'Copied',
      'Phrase copied to clipboard. Paste it somewhere safe — a password manager or a piece of paper. Clear your clipboard after.',
    )
  }, [mnemonic])

  const words = mnemonic ? mnemonic.split(' ') : []

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Backup Phrase</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Write this down. Keep it private.</Text>
          <Text style={styles.warningText}>
            This 12-word phrase is the master key to your PearBrowser identity. Anyone with these
            words can impersonate you on the P2P network and read any synced data.
          </Text>
          <Text style={styles.warningText}>
            Save it on paper, in a password manager, or somewhere only you can reach. If you lose
            it, you cannot recover your identity.
          </Text>
        </View>

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {mnemonic && (
          <>
            <View style={styles.wordGrid}>
              {words.map((word, idx) => (
                <View key={idx} style={styles.wordChip}>
                  <Text style={styles.wordIndex}>{idx + 1}</Text>
                  <Text style={styles.wordText}>
                    {revealed ? word : '••••••'}
                  </Text>
                </View>
              ))}
            </View>

            {!revealed ? (
              <TouchableOpacity onPress={() => setRevealed(true)} style={styles.revealBtn}>
                <Text style={styles.revealBtnText}>Tap to reveal</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity onPress={handleCopy} style={styles.copyBtn}>
                  <Text style={styles.copyBtnText}>Copy to clipboard</Text>
                </TouchableOpacity>

                <View style={styles.confirmRow}>
                  <Switch
                    value={confirmed}
                    onValueChange={setConfirmed}
                    trackColor={{ true: colors.accent, false: colors.surfaceElevated }}
                  />
                  <Text style={styles.confirmLabel}>
                    I've written down or saved this phrase somewhere safe
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={onBack}
                  style={[styles.doneBtn, !confirmed && styles.doneBtnDisabled]}
                  disabled={!confirmed}
                >
                  <Text style={[styles.doneBtnText, !confirmed && { color: colors.textMuted }]}>
                    Done
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
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
  center: { alignItems: 'center', paddingVertical: 40 },
  warningCard: {
    backgroundColor: '#2a1a00',
    borderLeftWidth: 4, borderLeftColor: colors.warning,
    borderRadius: 8, padding: 16, marginBottom: 20,
  },
  warningTitle: { color: colors.warning, fontWeight: '700', fontSize: 15, marginBottom: 8 },
  warningText: { color: colors.textPrimary, fontSize: 13, lineHeight: 20, marginBottom: 6 },
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  wordChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    marginRight: 8, marginBottom: 8, minWidth: '30%',
  },
  wordIndex: {
    color: colors.textMuted, fontSize: 12, fontFamily: 'monospace',
    marginRight: 8, minWidth: 16,
  },
  wordText: {
    color: colors.textPrimary, fontSize: 14, fontFamily: 'monospace',
  },
  revealBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginBottom: 8,
  },
  revealBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  copyBtn: {
    backgroundColor: colors.surfaceElevated, borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', marginBottom: 16,
  },
  copyBtnText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  confirmRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 16,
    padding: 12, backgroundColor: colors.surface, borderRadius: 8,
  },
  confirmLabel: { color: colors.textPrimary, fontSize: 13, marginLeft: 12, flex: 1 },
  doneBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  doneBtnDisabled: { backgroundColor: colors.surface },
  doneBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  errorBox: {
    backgroundColor: '#2b0e0e', borderRadius: 8, padding: 12, marginBottom: 12,
  },
  errorText: { color: '#fca5a5', fontSize: 13 },
})
