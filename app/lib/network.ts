/**
 * Network Monitoring Utility
 * 
 * Handles WiFi/cellular network changes and notifies listeners
 * so the P2P engine can respond appropriately (reconnect if needed).
 */

import { Platform } from 'react-native'

// Try to import NetInfo, with graceful fallback if not installed
try {
  var NetInfo = require('@react-native-community/netinfo').default
} catch {
  // Fallback if not installed
  var NetInfo = {
    addEventListener: () => () => {},
    fetch: async () => ({ isConnected: true, type: 'unknown', details: {} })
  }
}

export type NetworkState = 'online' | 'offline' | 'metered' | 'unknown'

export interface NetworkInfo {
  isConnected: boolean
  isWifi: boolean
  isMetered: boolean
  type: string
}

class NetworkMonitor {
  private unsubscribe: (() => void) | null = null
  private lastState: NetworkInfo | null = null
  private listeners: Set<(info: NetworkInfo) => void> = new Set()
  
  start(callback: (info: NetworkInfo) => void) {
    this.listeners.add(callback)
    
    if (this.unsubscribe) return
    
    this.unsubscribe = NetInfo.addEventListener(state => {
      const info: NetworkInfo = {
        isConnected: state.isConnected ?? false,
        isWifi: state.type === 'wifi',
        isMetered: state.details?.isConnectionExpensive ?? false,
        type: state.type ?? 'unknown'
      }
      
      // Only notify on significant changes
      if (this.hasSignificantChange(this.lastState, info)) {
        this.lastState = info
        this.listeners.forEach(cb => cb(info))
      }
    })
  }
  
  stop() {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
  }
  
  removeListener(callback: (info: NetworkInfo) => void) {
    this.listeners.delete(callback)
  }
  
  private hasSignificantChange(old: NetworkInfo | null, current: NetworkInfo): boolean {
    if (!old) return true
    return old.isConnected !== current.isConnected || 
           old.isWifi !== current.isWifi ||
           old.type !== current.type
  }
  
  async getCurrentState(): Promise<NetworkInfo> {
    const state = await NetInfo.fetch()
    return {
      isConnected: state.isConnected ?? false,
      isWifi: state.type === 'wifi',
      isMetered: state.details?.isConnectionExpensive ?? false,
      type: state.type ?? 'unknown'
    }
  }
}

export const networkMonitor = new NetworkMonitor()
