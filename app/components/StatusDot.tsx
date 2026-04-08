import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../lib/theme'

type Status = 'connected' | 'connecting' | 'offline'

type Props = {
  status: Status
  peerCount: number
  privateMode?: boolean
  onPress?: () => void
}

export function StatusDot({ status, peerCount, privateMode, onPress }: Props) {
  const dotColor = privateMode ? '#8b5cf6' :
    status === 'connected' ? colors.success :
    status === 'connecting' ? colors.warning :
    colors.error

  const label = privateMode
    ? (status === 'connected' ? 'Private' : 'Private...')
    : status === 'connected' ? (peerCount > 0 ? `${peerCount} peers` : 'Ready')
    : status === 'connecting' ? 'Connecting...'
    : 'Offline'

  return (
    <TouchableOpacity onPress={onPress} style={styles.container} activeOpacity={0.7}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
  },
})
