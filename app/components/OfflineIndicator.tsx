import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../lib/theme'

interface Props {
  isOffline: boolean
  onRetry?: () => void
  message?: string
}

export function OfflineIndicator({ isOffline, onRetry, message }: Props) {
  if (!isOffline) return null
  
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>You're offline</Text>
      <Text style={styles.message}>
        {message || 'Content may be unavailable. Check your connection.'}
      </Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    margin: 16,
    alignItems: 'center',
  },
  icon: { fontSize: 32, marginBottom: 8 },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 4 },
  message: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 12 },
  retryBtn: { backgroundColor: colors.accent, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  retryText: { color: '#000', fontWeight: '600' },
})
