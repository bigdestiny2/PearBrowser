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
  navigationRequestId?: number
  onTabChange?: (url: string, title: string) => void
  onOpenTabs?: () => void
  tabCount?: number
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

type LocalDriveRoute = { origin: string; port: number; key: string; mode: 'hyper' | 'app'; suffix: string }

function localDriveRoute (value: string): LocalDriveRoute | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) return null
    const port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    const match = url.pathname.match(/^\/(hyper|app)\/([0-9a-f]{64})(\/.*|$)/i)
    if (!match) return null
    return {
      origin: `http://127.0.0.1:${port}`,
      port,
      key: match[2].toLowerCase(),
      mode: match[1].toLowerCase() as 'hyper' | 'app',
      suffix: (match[3] || '/') + url.search + url.hash,
    }
  } catch {
    return null
  }
}

export const BrowseScreen = React.memo(function BrowseScreen({ rpc, proxyPort, peerCount, status, initialUrl, navigationRequestId, onTabChange, onOpenTabs, tabCount = 0, isOffline }: Props) {
  const webViewRef = useRef<WebView>(null)
  const [currentUrl, setCurrentUrl] = useState(initialUrl || '')
  const [inputText, setInputText] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null)
  const [bridgeToken, setBridgeToken] = useState<string | null>(null)
  const [bridgePort, setBridgePort] = useState(0)
  const [activeDriveKey, setActiveDriveKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [findVisible, setFindVisible] = useState(false)
  const [findText, setFindText] = useState('')
  const [pageTitle, setPageTitle] = useState('')
  const [pageActionsVisible, setPageActionsVisible] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [desktopSiteRequested, setDesktopSiteRequested] = useState(false)
  const desktopModeReady = useRef(false)

  // External navigation has its own request id. Page redirects update tab
  // metadata without sending the WebView back to its starting URL.
  React.useEffect(() => {
    const needsProxy = initialUrl?.startsWith('hyper://') || initialUrl?.startsWith('app://')
    if (initialUrl && (!needsProxy || proxyPort > 0)) handleNavigate(initialUrl)
  }, [navigationRequestId, proxyPort])

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
    setBridgePort(0)
    setActiveDriveKey(null)

    // Only allow trusted relay app URLs in-app; everything else opens externally.
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (isTrustedRelayAppUrl(url)) {
        onTabChange?.(url, '')
        setWebViewUrl(url)
      } else {
        setLoading(false)
        Linking.openURL(url)
      }
      return
    }

    // app:// is the browser's canonical address for an installed drive's
    // /app/ proxy route. Validate its drive key before restoring it.
    let appKey: string | null = null
    if (url.startsWith('app://')) {
      try {
        const parsed = new URL(url)
        if (!/^[0-9a-f]{64}$/i.test(parsed.hostname)) throw new Error('Invalid app drive key')
        appKey = parsed.hostname.toLowerCase()
      } catch {
        setError('Invalid app:// address')
        setLoading(false)
        return
      }
    } else if (!url.startsWith('hyper://')) {
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
      const navigateUrl = appKey ? `hyper://${appKey}${new URL(url).pathname}${new URL(url).search}${new URL(url).hash}` : url
      const result = await rpc.navigate(navigateUrl)
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
      const route = localDriveRoute(result.localUrl || '')
      const inputHost = new URL(url).hostname.toLowerCase()
      // A 64-hex input must resolve to that drive. z32 inputs are normalized
      // by CMD_NAVIGATE, so compare its returned key with the local route.
      const expectedKey = appKey || (/^[0-9a-f]{64}$/.test(inputHost) ? inputHost : String(result.key || '').toLowerCase())
      if (!route || route.mode !== 'hyper' || route.key !== expectedKey ||
          String(result.key || '').toLowerCase() !== route.key ||
          (result.proxyPort != null && Number(result.proxyPort) !== route.port)) {
        throw new Error('P2P engine returned an invalid drive address')
      }
      const localUrl = appKey
        ? `${route.origin}/app/${route.key}${route.suffix}`
        : result.localUrl
      onTabChange?.(url, '')
      setBridgePort(route.port)
      setActiveDriveKey(route.key)
      setBridgeToken(result.apiToken || null)
      setWebViewUrl(localUrl)
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }, [rpc, onTabChange])

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
    let address = currentUrl
    const route = localDriveRoute(navState.url || '')
    if (route && route.port === bridgePort && route.key === activeDriveKey) {
      address = `${route.mode}://${route.key}${route.suffix}`
    }
    if (address && address !== currentUrl) setCurrentUrl(address)
    if (!navState.loading && address) {
      onTabChange?.(address, navState.title || '')
      getSettings().then(settings => {
        if (!settings.privateMode) addToHistory(address, navState.title || address).catch(() => {})
      })
    }
  }, [currentUrl, onTabChange, bridgePort, activeDriveKey])

  const handleShouldLoad = useCallback((event: any) => {
    const url = event.url || ''
    const route = localDriveRoute(url)
    if (route) {
      if (route.port === bridgePort && route.key === activeDriveKey) return true
      handleNavigate(`${route.mode}://${route.key}${route.suffix}`)
      return false
    }
    if (isTrustedRelayAppUrl(url)) return true
    if (url.startsWith('hyper://') || url.startsWith('app://')) { handleNavigate(url); return false }
    if (url.startsWith('http://') || url.startsWith('https://')) { Linking.openURL(url); return false }
    return false
  }, [bridgePort, activeDriveKey, handleNavigate])

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

  const currentRoute = localDriveRoute(webViewUrl || '')
  const shouldInjectBridge = !!bridgeToken && currentRoute?.port === bridgePort &&
    currentRoute.key === activeDriveKey
  const bridgeScript = shouldInjectBridge ? createBridgeScript(bridgePort, bridgeToken || '') : 'true;'

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

          <TouchableOpacity
            accessibilityLabel="Open tabs"
            onPress={onOpenTabs}
            style={styles.tabCountBtn}
          >
            <Text style={styles.tabCountText}>[{tabCount}]</Text>
          </TouchableOpacity>
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
  tabCountBtn: {
    minWidth: 38, height: 32, justifyContent: 'center', alignItems: 'center',
    marginHorizontal: 4, borderRadius: 6, backgroundColor: colors.surfaceElevated,
  },
  tabCountText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
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
