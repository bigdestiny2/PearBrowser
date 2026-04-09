import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../lib/theme'

interface Props {
  used: number      // Bytes
  limit: number     // Bytes
  onClearCache?: () => void
  onClearData?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function StorageMeter({ used, limit, onClearCache, onClearData }: Props) {
  const percent = Math.min(100, Math.round((used / limit) * 100))
  const isWarning = percent > 80
  const isCritical = percent > 95
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Storage</Text>
        <Text style={[styles.usage, isCritical && styles.critical, isWarning && !isCritical && styles.warning]}>
          {formatBytes(used)} / {formatBytes(limit)} ({percent}%)
        </Text>
      </View>
      
      <View style={styles.barContainer}>
        <View style={[styles.bar, { width: `${percent}%`, backgroundColor: isCritical ? colors.error : isWarning ? '#f59e0b' : colors.accent }]} />
      </View>
      
      {(isWarning || isCritical) && (
        <Text style={styles.warningText}>
          {isCritical ? 'Storage almost full. Clear cache to free space.' : 'Storage getting full.'}
        </Text>
      )}
      
      <View style={styles.buttons}>
        {onClearCache && (
          <TouchableOpacity onPress={onClearCache} style={styles.button}>
            <Text style={styles.buttonText}>Clear Cache</Text>
          </TouchableOpacity>
        )}
        {onClearData && (
          <TouchableOpacity onPress={onClearData} style={[styles.button, styles.dangerButton]}>
            <Text style={[styles.buttonText, styles.dangerText]}>Clear All Data</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  usage: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  warning: {
    color: '#f59e0b',
  },
  critical: {
    color: colors.error,
  },
  barContainer: {
    height: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  bar: {
    height: '100%',
    borderRadius: 4,
  },
  warningText: {
    color: '#f59e0b',
    fontSize: 13,
    marginBottom: 12,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  dangerButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: colors.error,
  },
  buttonText: {
    color: colors.accent,
    fontWeight: '600',
  },
  dangerText: {
    color: colors.error,
  },
})
