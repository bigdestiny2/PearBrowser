import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../lib/theme'

type Status = 'connected' | 'connecting' | 'offline' | 'error' | 'http-only'

interface Props {
  status: Status
  peerCount?: number
  showLabel?: boolean
  onPress?: () => void
}

export function StatusDot({ status, peerCount, showLabel, onPress }: Props) {
  const getStatusColor = () => {
    switch (status) {
      case 'connected': return '#22c55e'
      case 'connecting': return '#f59e0b'
      case 'error': return colors.error
      case 'offline': return '#666'
      case 'http-only': return '#3b82f6' // Blue for HTTP mode
    }
  }
  
  const getStatusLabel = () => {
    switch (status) {
      case 'connected': return peerCount ? `${peerCount} peers` : 'Connected'
      case 'connecting': return 'Connecting...'
      case 'error': return 'Error'
      case 'offline': return 'Offline'
      case 'http-only': return 'HTTP Mode'
    }
  }
  
  const Container = onPress ? TouchableOpacity : View
  
  return (
    <Container style={styles.container} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.dot, { backgroundColor: getStatusColor() }, status === 'connecting' && styles.pulse]} />
      {showLabel && (
        <Text style={styles.label}>{getStatusLabel()}</Text>
      )}
    </Container>
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
  pulse: {
    // Pulse animation could be added here with Animated
    opacity: 0.7,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
  },
})
