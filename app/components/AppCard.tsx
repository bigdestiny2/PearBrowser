import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  name: string
  description?: string
  icon?: string | null
  installed?: boolean
  onPress: () => void
  onAction?: () => void
  actionLabel?: string
  size?: 'small' | 'large'
}

export function AppCard({
  name, description, icon, installed, onPress, onAction, actionLabel, size = 'small'
}: Props) {
  if (size === 'small') {
    return (
      <TouchableOpacity onPress={onPress} style={styles.smallCard} activeOpacity={0.7}>
        <View style={styles.smallIcon}>
          {icon ? (
            <Image source={{ uri: icon }} style={styles.smallIconImg} />
          ) : (
            <Text style={styles.smallIconText}>{name[0]?.toUpperCase()}</Text>
          )}
        </View>
        <Text style={styles.smallName} numberOfLines={1}>{name}</Text>
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity onPress={onPress} style={styles.largeCard} activeOpacity={0.7}>
      <View style={styles.largeIcon}>
        {icon ? (
          <Image source={{ uri: icon }} style={styles.largeIconImg} />
        ) : (
          <Text style={styles.largeIconText}>{name[0]?.toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.largeInfo}>
        <Text style={styles.largeName} numberOfLines={1}>{name}</Text>
        {description && (
          <Text style={styles.largeDesc} numberOfLines={2}>{description}</Text>
        )}
      </View>
      {onAction && (
        <TouchableOpacity onPress={onAction} style={styles.actionBtn}>
          <Text style={styles.actionText}>{actionLabel || (installed ? 'Open' : 'Get')}</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  smallCard: {
    alignItems: 'center',
    width: 72,
    marginRight: 12,
  },
  smallIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  smallIconImg: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  smallIconText: {
    color: colors.accent,
    fontSize: 24,
    fontWeight: '700',
  },
  smallName: {
    color: colors.textPrimary,
    fontSize: 11,
    textAlign: 'center',
  },
  largeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 8,
  },
  largeIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  largeIconImg: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  largeIconText: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '700',
  },
  largeInfo: {
    flex: 1,
  },
  largeName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  largeDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  actionBtn: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    marginLeft: 8,
  },
  actionText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
})
