import React, { useRef, useState, useCallback } from 'react'
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  Linking, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { colors } from '../lib/theme'
import { StatusDot } from '../components/StatusDot'
import { OfflineIndicator } from '../components/OfflineIndicator'
import { addToHistory, addBookmark, getSettings } from '../lib/storage'
import { createBridgeScript } from '../lib/bridge-inject'
import type { PearRPC } from '../lib/rpc'

type Props = {
  rpc: PearRPC
  proxyPort: number
  peerCount: number
  status: 'connected' | 'connecting' | 'offline' | 'http-only' | 'error'
  initialUrl?: string | null
  isOffline?: boolean
}

function isTrustedRelayAppUrl (url: string) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const isTrustedRelay = host === 'p2phiverelay.xyz' || host.endsWith('.p2phiverelay.xyz')
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.pathname.includes('/v1/hyper/')
      ? isTrustedRelay || host === '127.0.0.1' || host === 'localhost'
      : false
  } catch {
    return false
  }
}

export const BrowseScreen = React.memo(function BrowseScreen({ rpc, proxyPort, peerCount, status, initialUrl, isOffline }: Props) {
  const webViewRef = useRef<WebView>(null)
  const [currentUrl, setCurrentUrl] = useState(initialUrl || '')
  const [inputText, setInputText] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null)
  const [bridgeToken, setBridgeToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Navigate on initial URL
  React.useEffect(() => {
    if (initialUrl) handleNavigate(initialUrl)
  }, [initialUrl])

  const handleNavigate = useCallback(async (url: string) => {
    setLoading(true)
    setError(null)
    setCurrentUrl(url)
    setBridgeToken(null)

    // Only allow trusted relay app URLs in-app; everything else opens externally.
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (isTrustedRelayAppUrl(url)) {
        setWebViewUrl(url)
      } else {
        setLoading(false)
        Linking.openURL(url)
      }
      return
    }

    // hyper:// URLs — route through the worklet proxy
    if (!url.startsWith('hyper://')) {
      setLoading(false)
      Linking.openURL(url)
      return
    }

    if (!rpc) {
      setError('P2P engine not available. Use Explore to browse via relay.')
      setLoading(false)
      return
    }

    try {
      const result = await rpc.navigate(url)
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
      setBridgeToken(result.apiToken || null)
      setWebViewUrl(result.localUrl)
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }, [rpc])

  const handleSubmit = useCallback(() => {
    let url = inputText.trim()
    if (!url) return
    if (/^[a-f0-9]{52,64}$/i.test(url)) url = `hyper://${url}`
    else if (!url.includes('://')) url = `hyper://${url}`
    handleNavigate(url)
    setInputFocused(false)
  }, [inputText, handleNavigate])

  const handleWebViewNav = useCallback((navState: any) => {
    setLoading(navState.loading)
    // Track history when page finishes loading (skip in private mode)
    if (!navState.loading && navState.url && currentUrl) {
      getSettings().then(s => {
        if (!s.privateMode) addToHistory(currentUrl, navState.title || currentUrl).catch(() => {})
      })
    }
    if (navState.url?.includes('/hyper/')) {
      const match = navState.url.match(/\/hyper\/([^/]+)(.*)/)
      if (match) setCurrentUrl(`hyper://${match[1]}${match[2]}`)
    } else if (navState.url?.includes('/app/')) {
      const match = navState.url.match(/\/app\/([^/]+)(.*)/)
      if (match) setCurrentUrl(`app://${match[1]}${match[2]}`)
    }
  }, [])

  const handleShouldLoad = useCallback((event: any) => {
    const url = event.url || ''
    // Allow proxy URLs
    if (url.startsWith(`http://127.0.0.1:${proxyPort}`)) return true
    if (url.startsWith(`http://localhost:${proxyPort}`)) return true
    if (isTrustedRelayAppUrl(url)) return true
    if (url.startsWith('hyper://')) { handleNavigate(url); return false }
    if (url.startsWith('http://') || url.startsWith('https://')) { Linking.openURL(url); return false }
    return true
  }, [proxyPort, handleNavigate])

  // Handle messages from WebView — only navigation/share actions.
  // Data calls (sync, identity) go directly via localhost HTTP, bypassing RN.
  const handleBridgeMessage = useCallback((event: any) => {
    let msg: any
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch { return }

    if (msg.type === 'pear-navigate' && msg.url) {
      handleNavigate(msg.url)
    } else if (msg.type === 'pear-share' && msg.url) {
      import('react-native').then(({ Share }) => {
        Share.share({ message: msg.url, url: msg.url })
      })
    }
  }, [handleNavigate])

  // Truncate display URL
  const displayUrl = currentUrl.length > 40
    ? currentUrl.slice(0, 20) + '...' + currentUrl.slice(-12)
    : currentUrl

  const shouldInjectBridge = !!bridgeToken && (
    webViewUrl?.startsWith(`http://127.0.0.1:${proxyPort}/`) ||
    webViewUrl?.startsWith(`http://localhost:${proxyPort}/`) ||
    isTrustedRelayAppUrl(webViewUrl || '')
  )
  const bridgeScript = shouldInjectBridge ? createBridgeScript(proxyPort, bridgeToken || '') : 'true;'

  return (
    <View style={styles.container}>
      <OfflineIndicator 
        isOffline={!!isOffline || status === 'offline'} 
        onRetry={() => currentUrl && handleNavigate(currentUrl)}
      />
      
      {/* WebView */}
      {webViewUrl ? (
        <WebView
          ref={webViewRef}
          source={{ uri: webViewUrl }}
          style={styles.webview}
          onNavigationStateChange={handleWebViewNav}
          onShouldStartLoadWithRequest={handleShouldLoad}
          onMessage={handleBridgeMessage}
          injectedJavaScriptBeforeContentLoaded={bridgeScript}
          injectedJavaScript={bridgeScript}
          allowsBackForwardNavigationGestures
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Connecting to peers...</Text>
            </View>
          )}
        />
      ) : (
        <View style={styles.emptyBrowse}>
          <Text style={styles.emptyText}>Enter a hyper:// address below</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Bottom URL bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <View style={styles.bottomBar}>
          <TouchableOpacity onPress={() => webViewRef.current?.goBack()} style={styles.navBtn}>
            <Text style={styles.navBtnText}>{'<'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => webViewRef.current?.goForward()} style={styles.navBtn}>
            <Text style={styles.navBtnText}>{'>'}</Text>
          </TouchableOpacity>

          <View style={styles.urlContainer}>
            {loading && <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 6 }} />}
            <TextInput
              style={styles.urlInput}
              value={inputFocused ? inputText : displayUrl}
              onChangeText={setInputText}
              onFocus={() => { setInputFocused(true); setInputText(currentUrl) }}
              onBlur={() => setInputFocused(false)}
              onSubmitEditing={handleSubmit}
              placeholder="hyper://..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              selectTextOnFocus
            />
          </View>

          <StatusDot status={status} peerCount={peerCount} />
        </View>
      </KeyboardAvoidingView>
    </View>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  webview: { flex: 1 },
  emptyBrowse: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  errorBar: { backgroundColor: '#7f1d1d', paddingHorizontal: 12, paddingVertical: 6 },
  errorText: { color: '#fca5a5', fontSize: 12 },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg,
  },
  loadingText: { color: colors.textSecondary, fontSize: 14, marginTop: 12 },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  navBtn: {
    width: 32, height: 32, justifyContent: 'center', alignItems: 'center',
    borderRadius: 6, backgroundColor: colors.surfaceElevated, marginRight: 4,
  },
  navBtnText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  urlContainer: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceElevated, borderRadius: 8,
    paddingHorizontal: 10, height: 36, marginHorizontal: 4,
  },
  urlInput: {
    flex: 1, color: colors.textPrimary, fontSize: 13, fontFamily: 'monospace',
  },
})
