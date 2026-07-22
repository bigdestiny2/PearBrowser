import React, { useRef, useState, useCallback } from 'react'
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  Linking, ActivityIndicator, KeyboardAvoidingView, Platform,
  Share, Clipboard, Modal,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { colors } from '../lib/theme'
import { StatusDot } from '../components/StatusDot'
import { OfflineIndicator } from '../components/OfflineIndicator'
import {
  addToHistory, addBookmark, getBookmarks, getSettings, removeBookmark,
} from '../lib/storage'
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

const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 PearBrowser/0.1 Safari/605.1.15'

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
  const [findVisible, setFindVisible] = useState(false)
  const [findText, setFindText] = useState('')
  const [pageTitle, setPageTitle] = useState('')
  const [pageActionsVisible, setPageActionsVisible] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [desktopSiteRequested, setDesktopSiteRequested] = useState(false)
  const desktopModeReady = useRef(false)

  // Navigate on initial URL
  React.useEffect(() => {
    if (initialUrl) handleNavigate(initialUrl)
  }, [initialUrl])

  React.useEffect(() => {
    let cancelled = false
    if (!currentUrl) {
      setBookmarked(false)
      return () => { cancelled = true }
    }
    getBookmarks()
      .then(items => {
        if (!cancelled) setBookmarked(items.some(item => item.url === currentUrl))
      })
      .catch(() => {
        if (!cancelled) setBookmarked(false)
      })
    return () => { cancelled = true }
  }, [currentUrl])

  // React Native WebView applies the new userAgent prop on re-render. Reload
  // after that render so the request and responsive layout both use it.
  React.useEffect(() => {
    if (!desktopModeReady.current) {
      desktopModeReady.current = true
      return
    }
    webViewRef.current?.reload()
  }, [desktopSiteRequested])

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

  const findInPage = useCallback((forward = true) => {
    const query = findText.trim()
    if (!query) return
    webViewRef.current?.injectJavaScript(`
      (() => {
        try {
          window.find(${JSON.stringify(query)}, false, ${forward ? 'false' : 'true'}, true, false, true, false)
        } catch (_) {}
      })();
      true;
    `)
  }, [findText])

  const closeFind = useCallback(() => {
    setFindVisible(false)
    setFindText('')
    webViewRef.current?.injectJavaScript(`
      try { window.getSelection()?.removeAllRanges() } catch (_) {}
      true;
    `)
  }, [])

  const showFind = useCallback(() => {
    setPageActionsVisible(false)
    setFindVisible(true)
  }, [])

  const reloadPage = useCallback(() => {
    setPageActionsVisible(false)
    webViewRef.current?.reload()
  }, [])

  const sharePage = useCallback(async () => {
    setPageActionsVisible(false)
    if (!currentUrl) return
    await Share.share({ message: currentUrl, url: currentUrl })
  }, [currentUrl])

  const copyPageLink = useCallback(() => {
    setPageActionsVisible(false)
    if (currentUrl) Clipboard.setString(currentUrl)
  }, [currentUrl])

  const toggleBookmark = useCallback(async () => {
    setPageActionsVisible(false)
    if (!currentUrl) return
    if (bookmarked) {
      await removeBookmark(currentUrl)
      setBookmarked(false)
    } else {
      await addBookmark(currentUrl, pageTitle || currentUrl)
      setBookmarked(true)
    }
  }, [bookmarked, currentUrl, pageTitle])

  const toggleDesktopSite = useCallback(() => {
    setPageActionsVisible(false)
    setDesktopSiteRequested(value => !value)
  }, [])

  const handleWebViewNav = useCallback((navState: any) => {
    setLoading(navState.loading)
    if (navState.title) setPageTitle(navState.title)
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
  }, [currentUrl])

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
          userAgent={desktopSiteRequested ? DESKTOP_USER_AGENT : undefined}
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
        {findVisible && (
          <View style={styles.findBar}>
            <TextInput
              style={styles.findInput}
              value={findText}
              onChangeText={setFindText}
              onSubmitEditing={() => findInPage(true)}
              placeholder="Find in page"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              autoFocus
            />
            <TouchableOpacity
              accessibilityLabel="Previous match"
              onPress={() => findInPage(false)}
              style={styles.findBtn}
            >
              <Text style={styles.findBtnText}>{'↑'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel="Next match"
              onPress={() => findInPage(true)}
              style={styles.findBtn}
            >
              <Text style={styles.findBtnText}>{'↓'}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityLabel="Close find" onPress={closeFind} style={styles.findBtn}>
              <Text style={styles.findBtnText}>{'×'}</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.bottomBar}>
          <TouchableOpacity onPress={() => webViewRef.current?.goBack()} style={styles.navBtn}>
            <Text style={styles.navBtnText}>{'<'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => webViewRef.current?.goForward()} style={styles.navBtn}>
            <Text style={styles.navBtnText}>{'>'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Page actions"
            onPress={() => setPageActionsVisible(true)}
            style={styles.navBtn}
          >
            <Text style={styles.navBtnText}>{'•••'}</Text>
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

      {pageActionsVisible && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPageActionsVisible(false)}
        >
          <View style={styles.actionsBackdrop}>
            <TouchableOpacity
              accessibilityLabel="Close page actions"
              activeOpacity={1}
              onPress={() => setPageActionsVisible(false)}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.actionsSheet}>
              <Text style={styles.actionsTitle}>Page actions</Text>
              <PageAction label="Share" accessibilityLabel="Share current page" onPress={sharePage} />
              <PageAction label="Copy Link" accessibilityLabel="Copy current page link" onPress={copyPageLink} />
              <PageAction
                label={bookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
                accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
                onPress={toggleBookmark}
              />
              <PageAction label="Reload" accessibilityLabel="Reload page" onPress={reloadPage} />
              <PageAction label="Find in Page" accessibilityLabel="Find in page" onPress={showFind} />
              <PageAction
                label={desktopSiteRequested ? 'Request Mobile Site' : 'Request Desktop Site'}
                accessibilityLabel={desktopSiteRequested ? 'Request mobile site' : 'Request desktop site'}
                onPress={toggleDesktopSite}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  )
})

function PageAction ({ label, accessibilityLabel, onPress }: {
  label: string
  accessibilityLabel: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity accessibilityLabel={accessibilityLabel} onPress={onPress} style={styles.actionRow}>
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
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
  findBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  findInput: {
    flex: 1, height: 34, paddingHorizontal: 10,
    color: colors.textPrimary, backgroundColor: colors.surfaceElevated,
    borderRadius: 6, fontSize: 13,
  },
  findBtn: {
    width: 34, height: 34, justifyContent: 'center', alignItems: 'center',
    marginLeft: 4,
  },
  findBtnText: { color: colors.textSecondary, fontSize: 18, fontWeight: '600' },
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
  actionsBackdrop: {
    flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  actionsSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderTopWidth: 1, borderColor: colors.border, padding: 12, paddingBottom: 28,
  },
  actionsTitle: {
    color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  actionRow: {
    minHeight: 46, justifyContent: 'center', paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  actionText: { color: colors.textPrimary, fontSize: 16, fontWeight: '500' },
})
