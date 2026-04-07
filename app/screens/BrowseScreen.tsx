import React, { useRef, useState, useCallback } from 'react'
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  Linking, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { colors } from '../lib/theme'
import { StatusDot } from '../components/StatusDot'
import { BRIDGE_INJECT_JS } from '../lib/bridge-inject'
import type { PearRPC } from '../lib/rpc'

type Props = {
  rpc: PearRPC
  proxyPort: number
  peerCount: number
  status: 'connected' | 'connecting' | 'offline'
  initialUrl?: string | null
}

export function BrowseScreen({ rpc, proxyPort, peerCount, status, initialUrl }: Props) {
  const webViewRef = useRef<WebView>(null)
  const [currentUrl, setCurrentUrl] = useState(initialUrl || '')
  const [inputText, setInputText] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Navigate on initial URL
  React.useEffect(() => {
    if (initialUrl) handleNavigate(initialUrl)
  }, [initialUrl])

  const handleNavigate = useCallback(async (url: string) => {
    setLoading(true)
    setError(null)
    setCurrentUrl(url)

    // Direct HTTP/HTTPS URLs (from relay gateway) — load directly in WebView
    if (url.startsWith('http://') || url.startsWith('https://')) {
      setWebViewUrl(url)
      return
    }

    // hyper:// URLs — route through the worklet proxy
    if (!url.startsWith('hyper://')) {
      Linking.openURL(url)
      return
    }

    try {
      const result = await rpc.navigate(url)
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
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
    // Allow relay gateway URLs (apps served from relay HTTP)
    if (url.startsWith('http://127.0.0.1:9') || url.startsWith('http://localhost:9')) return true
    if (url.startsWith('hyper://')) { handleNavigate(url); return false }
    if (url.startsWith('http://') || url.startsWith('https://')) { Linking.openURL(url); return false }
    return true
  }, [proxyPort, handleNavigate])

  // Handle bridge messages from WebView
  const handleBridgeMessage = useCallback(async (event: any) => {
    let msg: any
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch { return }

    if (msg.type !== 'pear-bridge') return
    if (!rpc) {
      // Send error back to WebView
      webViewRef.current?.injectJavaScript(`
        window.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ type: 'pear-bridge-reply', id: ${msg.id}, error: 'P2P engine not connected' })
        }));
        true;
      `)
      return
    }

    try {
      // Route bridge calls to worklet RPC
      const result = await rpc.request(200, { method: msg.method, args: msg.args }, 30000)
      webViewRef.current?.injectJavaScript(`
        window.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ type: 'pear-bridge-reply', id: ${msg.id}, result: ${JSON.stringify(result)} })
        }));
        true;
      `)
    } catch (err: any) {
      webViewRef.current?.injectJavaScript(`
        window.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ type: 'pear-bridge-reply', id: ${msg.id}, error: ${JSON.stringify(err.message)} })
        }));
        true;
      `)
    }
  }, [rpc])

  // Truncate display URL
  const displayUrl = currentUrl.length > 40
    ? currentUrl.slice(0, 20) + '...' + currentUrl.slice(-12)
    : currentUrl

  return (
    <View style={styles.container}>
      {/* WebView */}
      {webViewUrl ? (
        <WebView
          ref={webViewRef}
          source={{ uri: webViewUrl }}
          style={styles.webview}
          onNavigationStateChange={handleWebViewNav}
          onShouldStartLoadWithRequest={handleShouldLoad}
          onMessage={handleBridgeMessage}
          injectedJavaScript={BRIDGE_INJECT_JS}
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
}

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
