package com.pearbrowser.app.ui.screens

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.pearbrowser.app.bridge.PearBridgeScript
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.rpc.PearSettings
import com.pearbrowser.app.ui.tabs.BrowserTabManager
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.util.concurrent.atomic.AtomicLong

/**
 * BrowseScreen - native WebView host for hyper:// and clearnet content.
 *
 * For hyper:// URLs, the native shell mirrors the React Native flow:
 * it calls CMD_NAVIGATE on the worklet, receives a localhost proxy URL plus
 * a drive-scoped X-Pear-Token, then injects the shared window.pear bridge.
 *
 * For http(s) URLs (Mission B2), CMD_NAVIGATE resolves through the
 * SessionBridge: proxied mode (default) loads a loopback /clearnet/ URL so
 * Content Shield and the privacy ladder apply; the `clearnetMode: "direct"`
 * settings opt-in loads the real https URL unshielded. While a proxied
 * clearnet page is shown, main-frame http(s) navigations re-resolve through
 * CMD_NAVIGATE so they stay on the proxy.
 *
 * Multi-tab: renders the active tab from [tabs] (see ui/tabs/
 * BrowserTabManager.kt for the bounded live-WebView pool). External
 * navigation (Home/Explore/Bookmarks/History/deep link/QR) enters via
 * [initialUrl] and is funneled into the active tab. The bottom bar keeps
 * back/forward and tabs immediately available; Chrome/Safari-style page
 * actions group share, copy link, bookmark, reload, find, and desktop mode.
 */
@Composable
fun BrowseScreen(
    initialUrl: String?,
    settings: PearSettings? = null,
    tabs: BrowserTabManager,
    onOpenTabs: () -> Unit = {},
    onExitBrowse: () -> Unit = {},
) {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val activeTab = tabs.activeTab
    val currentUrl = activeTab?.url
    var webViewUrl by remember { mutableStateOf<String?>(null) }
    // Which tab the current webViewUrl resolution belongs to. Without this a
    // stale resolution from tab A would load A's page into tab B's WebView
    // during the window between switching and re-resolution.
    var webViewUrlTab by remember { mutableStateOf<String?>(null) }
    var proxyPort by remember { mutableStateOf(0) }
    var apiToken by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var browserWebView by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    var canGoForward by remember { mutableStateOf(false) }
    var findVisible by remember { mutableStateOf(false) }
    var findQuery by remember { mutableStateOf("") }
    var findResult by remember { mutableStateOf("") }
    var bookmarked by remember { mutableStateOf(false) }
    var pageActionsVisible by remember { mutableStateOf(false) }
    var desktopTabIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    // True while the active tab shows a clearnet page through the shielded
    // proxy (Mission B2): the WebViewClient then keeps every http(s)
    // main-frame navigation on the proxy by re-resolving via CMD_NAVIGATE.
    var clearnetProxyActive by remember { mutableStateOf(false) }
    val navigationSerial = remember { AtomicLong(0) }
    val desktopSiteRequested = activeTab?.id?.let { it in desktopTabIds } == true

    // External navigation entry: funnel into the active tab (creating one
    // when none exists) — same semantics as the old single-WebView shell.
    LaunchedEffect(initialUrl) {
        if (initialUrl != null) tabs.navigateActive(initialUrl)
    }

    // There is no dedicated "is bookmarked" RPC, so the star state is derived
    // from the bookmark list on each navigation and then updated from
    // add/remove responses in toggleBookmark().
    LaunchedEffect(currentUrl, rpc) {
        val target = currentUrl ?: return@LaunchedEffect
        val client = rpc ?: return@LaunchedEffect
        bookmarked = try {
            client.listBookmarks().any { it.url == target }
        } catch (_: Throwable) {
            false
        }
    }

    // History recording is opt-in (settings.historyEnabled, default OFF for
    // privacy). When enabled, each navigation target is recorded best-effort;
    // the page URL stands in for the title until the WebView title is plumbed.
    LaunchedEffect(currentUrl, settings?.historyEnabled, rpc) {
        val target = currentUrl ?: return@LaunchedEffect
        if (settings?.historyEnabled != true) return@LaunchedEffect
        val client = rpc ?: return@LaunchedEffect
        try {
            client.addHistory(target, "")
        } catch (_: Throwable) {
            // History is best-effort and must never break browsing.
        }
    }

    LaunchedEffect(activeTab?.id, currentUrl, rpc) {
        val tabId = activeTab?.id ?: return@LaunchedEffect
        val target = currentUrl ?: return@LaunchedEffect
        val serial = navigationSerial.incrementAndGet()
        error = null

        if (target.startsWith("hyper://", ignoreCase = true)) {
            val client = rpc
            if (client == null) {
                error = "P2P engine is not ready yet."
                webViewUrl = null
                webViewUrlTab = tabId
                apiToken = ""
                proxyPort = 0
                clearnetProxyActive = false
                return@LaunchedEffect
            }

            try {
                val result = client.navigate(target)
                if (serial != navigationSerial.get()) return@LaunchedEffect
                val localUrl = result["localUrl"]?.jsonPrimitive?.contentOrNull
                    ?: throw IllegalStateException("Backend did not return localUrl")
                val localPort = verifiedProxyPort(localUrl)
                    ?: throw IllegalStateException("Backend returned an invalid local proxy URL")
                val returnedPort = result["proxyPort"]?.jsonPrimitive?.intOrNull ?: localPort
                if (returnedPort != localPort) {
                    throw IllegalStateException("Backend proxyPort did not match localUrl")
                }
                val token = result["apiToken"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (token.isBlank()) {
                    throw IllegalStateException("Backend did not return an API token")
                }
                webViewUrl = localUrl
                webViewUrlTab = tabId
                apiToken = token
                proxyPort = localPort
                clearnetProxyActive = false
            } catch (e: Throwable) {
                if (serial != navigationSerial.get()) return@LaunchedEffect
                error = e.message ?: "Could not navigate to $target"
                webViewUrl = null
                webViewUrlTab = tabId
                apiToken = ""
                proxyPort = 0
                clearnetProxyActive = false
            }
        } else if (isHttpOrHttpsUrl(target)) {
            // Mission B2: HTTP(S) navigation resolves through the worklet's
            // SessionBridge via the same CMD_NAVIGATE. Default proxied mode
            // returns a loopback /clearnet/ URL so Content Shield + the
            // privacy ladder see every request (WebViews cannot intercept
            // subresource requests, so the proxy is the only shielded path).
            // The `clearnetMode: "direct"` settings opt-in returns the real
            // https URL and loads it unshielded. Loopback targets (relay/
            // catalog fallback, developer pages) load as-is. No Pear bridge
            // token is issued for clearnet pages.
            val client = rpc
            if (client == null) {
                error = "P2P engine is not ready yet."
                webViewUrl = null
                webViewUrlTab = tabId
                apiToken = ""
                proxyPort = 0
                clearnetProxyActive = false
                return@LaunchedEffect
            }

            try {
                val result = client.navigate(target)
                if (serial != navigationSerial.get()) return@LaunchedEffect
                val kind = result["kind"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val mode = result["mode"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val localUrl = result["localUrl"]?.jsonPrimitive?.contentOrNull
                    ?: throw IllegalStateException("Backend did not return localUrl")
                val proxied = kind == "clearnet" && mode == "proxy"
                val localPort = if (proxied) {
                    loopbackUrlPort(localUrl)
                        ?: throw IllegalStateException("Backend returned an invalid local proxy URL")
                } else {
                    0
                }
                webViewUrl = localUrl
                webViewUrlTab = tabId
                apiToken = ""
                proxyPort = localPort
                clearnetProxyActive = proxied
            } catch (e: Throwable) {
                if (serial != navigationSerial.get()) return@LaunchedEffect
                error = e.message ?: "Could not navigate to $target"
                webViewUrl = null
                webViewUrlTab = tabId
                apiToken = ""
                proxyPort = 0
                clearnetProxyActive = false
            }
        } else {
            // Mission B3: bare words (names, bare keys, bare hosts) resolve
            // through the same CMD_NAVIGATE — the backend's name resolver +
            // SessionBridge own the classification (mirrors the desktop URL
            // bar). The response shape tells us which load path to take.
            val client = rpc
            if (client == null) {
                error = "P2P engine is not ready yet."
                webViewUrl = null
                webViewUrlTab = tabId
                apiToken = ""
                proxyPort = 0
                clearnetProxyActive = false
                return@LaunchedEffect
            }

            try {
                val result = client.navigate(target)
                if (serial != navigationSerial.get()) return@LaunchedEffect
                val kind = result["kind"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (kind == "pear-link") {
                    // A name resolved to a pear:// / file:// Pear-runtime app —
                    // no mobile launch phase yet (same honest stub the shell
                    // already shows for pear:// deep links).
                    val link = result["url"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    error = "Opening pear:// app links is coming in a later phase.\n$link"
                    webViewUrl = null
                    webViewUrlTab = tabId
                    apiToken = ""
                    proxyPort = 0
                    clearnetProxyActive = false
                    return@LaunchedEffect
                }
                val localUrl = result["localUrl"]?.jsonPrimitive?.contentOrNull
                    ?: throw IllegalStateException("Backend did not return localUrl")
                val token = result["apiToken"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (token.isNotBlank()) {
                    // hyper-shaped response: a name resolved to a drive, or a
                    // bare 64-hex/z32 key normalized to hyper://.
                    val localPort = verifiedProxyPort(localUrl)
                        ?: throw IllegalStateException("Backend returned an invalid local proxy URL")
                    val returnedPort = result["proxyPort"]?.jsonPrimitive?.intOrNull ?: localPort
                    if (returnedPort != localPort) {
                        throw IllegalStateException("Backend proxyPort did not match localUrl")
                    }
                    webViewUrl = localUrl
                    webViewUrlTab = tabId
                    apiToken = token
                    proxyPort = localPort
                    clearnetProxyActive = false
                } else {
                    // clearnet/loopback response: a bare host proxied through
                    // the SessionBridge (or loaded directly in direct mode).
                    val mode = result["mode"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    val proxied = kind == "clearnet" && mode == "proxy"
                    val localPort = if (proxied) {
                        loopbackUrlPort(localUrl)
                            ?: throw IllegalStateException("Backend returned an invalid local proxy URL")
                    } else {
                        0
                    }
                    webViewUrl = localUrl
                    webViewUrlTab = tabId
                    apiToken = ""
                    proxyPort = localPort
                    clearnetProxyActive = proxied
                }
            } catch (e: Throwable) {
                if (serial != navigationSerial.get()) return@LaunchedEffect
                error = e.message ?: "Could not navigate to $target"
                webViewUrl = null
                webViewUrlTab = tabId
                apiToken = ""
                proxyPort = 0
                clearnetProxyActive = false
            }
        }
    }

    // Hardware/gesture back: in-page WebView history first; when that is
    // exhausted, leave Browse for the app screen it was entered from.
    BackHandler {
        val web = browserWebView
        if (web != null && web.canGoBack()) web.goBack() else onExitBrowse()
    }

    if (currentUrl == null) {
        EmptyBrowseState()
        return
    }

    fun toggleBookmark() {
        val target = currentUrl ?: return
        val client = rpc ?: return
        scope.launch {
            try {
                if (bookmarked) {
                    client.removeBookmark(target)
                    bookmarked = false
                } else {
                    val title = browserWebView?.title?.takeIf { it.isNotBlank() } ?: target
                    client.addBookmark(target, title)
                    bookmarked = true
                }
            } catch (e: Throwable) {
                error = e.message ?: "Could not update bookmark"
            }
        }
    }

    fun shareCurrentPage() {
        val target = currentUrl ?: return
        shareLink(context, target) { error = it }
    }

    Column(Modifier.fillMaxSize().background(PearColors.Bg)) {
        error?.let {
            Text(
                it,
                color = PearColors.Error,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }

        if (findVisible) {
            FindInPageBar(
                query = findQuery,
                result = findResult,
                onQueryChange = { query ->
                    findQuery = query
                    findResult = ""
                    if (query.isBlank()) browserWebView?.clearMatches()
                    else browserWebView?.findAllAsync(query)
                },
                onPrevious = { if (findQuery.isNotBlank()) browserWebView?.findNext(false) },
                onNext = { if (findQuery.isNotBlank()) browserWebView?.findNext(true) },
                onClose = {
                    browserWebView?.clearMatches()
                    findVisible = false
                    findQuery = ""
                    findResult = ""
                },
            )
        }

        Box(Modifier.fillMaxWidth().weight(1f).background(PearColors.Bg)) {
            // Only show the resolution that belongs to the active tab; a tab
            // switch re-resolves (CMD_NAVIGATE is deterministic per worklet
            // run, so a still-live WebView compares equal below and is NOT
            // reloaded — scroll position and in-page history survive).
            val targetUrl = webViewUrl.takeIf { webViewUrlTab == activeTab?.id }
            if (targetUrl == null) {
                Text(
                    "Preparing P2P route...",
                    color = PearColors.TextSecondary,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(32.dp),
                )
            } else {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx -> FrameLayout(ctx) },
                    update = { container ->
                        val tab = tabs.activeTab ?: return@AndroidView
                        val web = tabs.webViewFor(tab.id) {
                            createTabWebView(
                                context = container.context,
                                onHyperNavigate = { tabs.setTabUrl(tab.id, it) },
                                onError = { error = it },
                            )
                        }
                        // Exactly one child at all times: detach whatever tab
                        // was shown before, then attach the active one.
                        container.removeAllViews()
                        if (web.parent !== container) {
                            (web.parent as? android.view.ViewGroup)?.removeView(web)
                            container.addView(web)
                        }
                        browserWebView = web
                        applyDesktopSiteMode(web, desktopSiteRequested)
                        web.webViewClient = pearWebViewClient(
                            proxyPort = proxyPort,
                            apiToken = apiToken,
                            clearnetProxyActive = clearnetProxyActive,
                            onHyperNavigate = { tabs.setTabUrl(tab.id, it) },
                            onExternalError = { error = it },
                            onNavState = { changed ->
                                canGoBack = changed.canGoBack()
                                canGoForward = changed.canGoForward()
                                tabs.setTabTitle(tab.id, changed.title)
                            },
                        )
                        web.setFindListener { activeMatchOrdinal, numberOfMatches, isDoneCounting ->
                            if (isDoneCounting) {
                                findResult = if (numberOfMatches == 0) {
                                    "No match"
                                } else {
                                    "${activeMatchOrdinal + 1}/$numberOfMatches"
                                }
                            }
                        }
                        if (targetUrl != web.url) web.loadUrl(targetUrl)
                        else injectBridgeIfAllowed(web, web.url, proxyPort, apiToken)
                    },
                )
            }
        }

        BrowseNavBar(
            canGoBack = canGoBack,
            canGoForward = canGoForward,
            tabCount = tabs.tabs.size,
            bookmarked = bookmarked,
            pageActionsVisible = pageActionsVisible,
            desktopSiteRequested = desktopSiteRequested,
            onBack = { browserWebView?.goBack() },
            onForward = { browserWebView?.goForward() },
            onOpenPageActions = { pageActionsVisible = true },
            onDismissPageActions = { pageActionsVisible = false },
            onShare = {
                pageActionsVisible = false
                shareCurrentPage()
            },
            onCopyLink = {
                pageActionsVisible = false
                currentUrl?.let { clipboard.setText(AnnotatedString(it)) }
            },
            onReload = {
                pageActionsVisible = false
                browserWebView?.reload()
            },
            onFind = {
                pageActionsVisible = false
                findVisible = true
            },
            onToggleBookmark = {
                pageActionsVisible = false
                toggleBookmark()
            },
            onToggleDesktopSite = {
                pageActionsVisible = false
                activeTab?.id?.let { tabId ->
                    desktopTabIds = if (tabId in desktopTabIds) {
                        desktopTabIds - tabId
                    } else {
                        desktopTabIds + tabId
                    }
                }
            },
            onOpenTabs = onOpenTabs,
        )
    }
}

/** Bottom browse bar: in-page back/forward, a consolidated page-actions
 *  menu, and the tab-count button that opens the card-based tab switcher. */
@Composable
private fun BrowseNavBar(
    canGoBack: Boolean,
    canGoForward: Boolean,
    tabCount: Int,
    bookmarked: Boolean,
    pageActionsVisible: Boolean,
    desktopSiteRequested: Boolean,
    onBack: () -> Unit,
    onForward: () -> Unit,
    onOpenPageActions: () -> Unit,
    onDismissPageActions: () -> Unit,
    onShare: () -> Unit,
    onCopyLink: () -> Unit,
    onReload: () -> Unit,
    onFind: () -> Unit,
    onToggleBookmark: () -> Unit,
    onToggleDesktopSite: () -> Unit,
    onOpenTabs: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().background(PearColors.Surface),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onBack, enabled = canGoBack) {
            Text("◀", color = if (canGoBack) PearColors.TextSecondary else PearColors.TextMuted)
        }
        TextButton(onClick = onForward, enabled = canGoForward) {
            Text("▶", color = if (canGoForward) PearColors.TextSecondary else PearColors.TextMuted)
        }
        Box {
            TextButton(onClick = onOpenPageActions) {
                Text("•••", color = PearColors.TextSecondary, fontSize = 18.sp)
            }
            DropdownMenu(
                expanded = pageActionsVisible,
                onDismissRequest = onDismissPageActions,
            ) {
                DropdownMenuItem(text = { Text("Share") }, onClick = onShare)
                DropdownMenuItem(text = { Text("Copy Link") }, onClick = onCopyLink)
                DropdownMenuItem(
                    text = { Text(if (bookmarked) "Remove Bookmark" else "Add Bookmark") },
                    onClick = onToggleBookmark,
                )
                DropdownMenuItem(text = { Text("Reload") }, onClick = onReload)
                DropdownMenuItem(text = { Text("Find in Page") }, onClick = onFind)
                DropdownMenuItem(
                    text = { Text(if (desktopSiteRequested) "Request Mobile Site" else "Request Desktop Site") },
                    onClick = onToggleDesktopSite,
                )
            }
        }
        TextButton(onClick = onOpenTabs) {
            Text(
                "[$tabCount]",
                color = PearColors.TextSecondary,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}

@Composable
private fun FindInPageBar(
    query: String,
    result: String,
    onQueryChange: (String) -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().background(PearColors.Surface).padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextField(
            value = query,
            onValueChange = onQueryChange,
            placeholder = { Text("Find in page") },
            singleLine = true,
            modifier = Modifier.weight(1f),
        )
        if (result.isNotEmpty()) {
            Text(
                result,
                color = PearColors.TextSecondary,
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 6.dp),
            )
        }
        TextButton(onClick = onPrevious) { Text("↑", color = PearColors.TextSecondary) }
        TextButton(onClick = onNext) { Text("↓", color = PearColors.TextSecondary) }
        TextButton(onClick = onClose) { Text("×", color = PearColors.TextSecondary) }
    }
}

@Composable
private fun EmptyBrowseState() {
    Column(
        Modifier.fillMaxSize().background(PearColors.Bg).padding(32.dp),
    ) {
        Text("Browse", color = PearColors.TextPrimary, fontSize = 24.sp)
        Spacer(Modifier.height(16.dp))
        Text(
            "Enter a hyper:// address on the Home tab, or tap a site in Explore.",
            color = PearColors.TextSecondary,
            fontSize = 14.sp,
        )
    }
}

private val hyperHost = Regex("^(?:[0-9a-fA-F]{64}|[13-9a-km-uw-zA-KM-UW-Z]{52})$")

/** Creates a fully configured WebView for one browser tab. Instances live in
 *  the BrowserTabManager pool and are re-parented into the active container
 *  on tab switches; the per-navigation WebViewClient and find listener are
 *  (re)attached by the AndroidView update block in BrowseScreen. */
@SuppressLint("SetJavaScriptEnabled")
private fun createTabWebView(
    context: Context,
    onHyperNavigate: (String) -> Unit,
    onError: (String) -> Unit,
): WebView = WebView(context).apply {
    val mainHandler = Handler(Looper.getMainLooper())
    setBackgroundColor(Color.parseColor("#0A0A0A"))
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.mediaPlaybackRequiresUserGesture = false
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    tag = BrowserDisplayMode(defaultUserAgent = settings.userAgentString)

    addJavascriptInterface(object {
        @JavascriptInterface
        fun navigate(url: String) {
            mainHandler.post {
                val target = normalizeHyperNavigation(url)
                if (target != null) {
                    onHyperNavigate(target)
                } else if (isHttpOrHttpsUrl(url)) {
                    openExternal(context, url, onError)
                }
            }
        }

        @JavascriptInterface
        fun share(url: String) {
            mainHandler.post {
                shareLink(context, url, onError)
            }
        }
    }, "PearBrowserNative")
}

private data class BrowserDisplayMode(
    val defaultUserAgent: String,
    var desktopSiteRequested: Boolean = false,
)

/** Apply a per-tab desktop/mobile preference. Android WebView reloads the
 *  current page when userAgentString changes (API 19+), while a fresh tab
 *  simply uses the selected UA for its first load. */
private fun applyDesktopSiteMode(webView: WebView, requested: Boolean) {
    val displayMode = (webView.tag as? BrowserDisplayMode)
        ?: BrowserDisplayMode(webView.settings.userAgentString).also { webView.tag = it }
    if (displayMode.desktopSiteRequested == requested) return

    webView.settings.userAgentString = if (requested) {
        desktopUserAgent(displayMode.defaultUserAgent)
    } else {
        displayMode.defaultUserAgent
    }
    webView.settings.useWideViewPort = requested
    webView.settings.loadWithOverviewMode = requested
    displayMode.desktopSiteRequested = requested
}

private fun desktopUserAgent(defaultUserAgent: String): String =
    defaultUserAgent
        .replace(Regex("\\([^)]*(?:Android|Mobile)[^)]*\\)"), "(X11; Linux x86_64)")
        .replace(Regex("\\s+(?:Mobile|wv)(?:/[A-Za-z0-9._-]+)?\\b"), "")

private fun pearWebViewClient(
    proxyPort: Int,
    apiToken: String,
    clearnetProxyActive: Boolean,
    onHyperNavigate: (String) -> Unit,
    onExternalError: (String) -> Unit,
    onNavState: (WebView) -> Unit,
): WebViewClient =
    object : WebViewClient() {
        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?,
        ): Boolean {
            val url = request?.url?.toString() ?: return false
            if (request.isForMainFrame != true) return false

            val hyperTarget = normalizeHyperNavigation(url)
            if (hyperTarget != null) {
                onHyperNavigate(hyperTarget)
                return true
            }

            if (clearnetProxyActive && proxyPort > 0) {
                // Proxied clearnet tab (Mission B2): rewritten links resolve
                // on the loopback proxy — load them in place. Any other
                // http(s) main-frame navigation (script-driven redirects that
                // escaped the static HTML rewrite) re-resolves through
                // CMD_NAVIGATE so it stays on the shielded proxy too.
                if (isLocalProxyUrl(url, proxyPort)) return false
                if (isHttpOrHttpsUrl(url)) {
                    onHyperNavigate(url)
                    return true
                }
                return url != "about:blank"
            }

            if (proxyPort > 0 && apiToken.isNotBlank()) {
                if (isLocalProxyUrl(url, proxyPort)) return false
                if (isHttpOrHttpsUrl(url)) {
                    view?.context?.let { openExternal(it, url, onExternalError) }
                    return true
                }
                return url != "about:blank"
            }

            return false
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            injectBridgeIfAllowed(view, url, proxyPort, apiToken)
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            injectBridgeIfAllowed(view, url, proxyPort, apiToken)
            if (view != null) onNavState(view)
        }

        override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
            super.doUpdateVisitedHistory(view, url, isReload)
            // Fires for SPA pushState and back/forward jumps that never reach
            // onPageFinished — keeps the nav bar's ◀ ▶ enabled state honest.
            if (view != null) onNavState(view)
        }
    }

private fun injectBridgeIfAllowed(view: WebView?, url: String?, proxyPort: Int, apiToken: String) {
    if (view == null || proxyPort <= 0 || apiToken.isBlank()) return
    if (!isLocalProxyUrl(url, proxyPort)) return
    view.evaluateJavascript(PearBridgeScript.build(proxyPort, apiToken), null)
}

private fun normalizeHyperNavigation(url: String?): String? {
    val trimmed = url?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val uri = try { URI(trimmed) } catch (_: Throwable) { return null }
    if (!uri.scheme.equals("hyper", ignoreCase = true)) return null
    val host = uri.host?.takeIf { hyperHost.matches(it) } ?: return null
    val path = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
    val query = uri.rawQuery?.let { "?$it" }.orEmpty()
    val fragment = uri.rawFragment?.let { "#$it" }.orEmpty()
    return "hyper://${host.lowercase()}$path$query$fragment"
}

private fun verifiedProxyPort(url: String): Int? {
    val uri = try { URI(url) } catch (_: Throwable) { return null }
    val port = uri.port.takeIf { it in 1..65535 } ?: return null
    val path = uri.rawPath ?: return null
    return if (
        uri.scheme.equals("http", ignoreCase = true) &&
        isLoopbackHost(uri.host) &&
        path.startsWith("/hyper/")
    ) port else null
}

/** Port of any loopback http URL the backend hands us (e.g. the proxied
 *  /clearnet/ document URL) — no path constraint, unlike [verifiedProxyPort]. */
private fun loopbackUrlPort(url: String): Int? {
    val uri = try { URI(url) } catch (_: Throwable) { return null }
    val port = uri.port.takeIf { it in 1..65535 } ?: return null
    return if (uri.scheme.equals("http", ignoreCase = true) && isLoopbackHost(uri.host)) port else null
}

private fun isLocalProxyUrl(url: String?, proxyPort: Int): Boolean {
    if (proxyPort <= 0) return false
    val uri = try { URI(url?.trim() ?: return false) } catch (_: Throwable) { return false }
    return uri.scheme.equals("http", ignoreCase = true) &&
        isLoopbackHost(uri.host) &&
        uri.port == proxyPort
}

private fun isLoopbackHost(host: String?): Boolean =
    host.equals("127.0.0.1", ignoreCase = true) ||
        host.equals("localhost", ignoreCase = true) ||
        host == "::1"

private fun isHttpOrHttpsUrl(url: String?): Boolean {
    val scheme = try { URI(url?.trim() ?: return false).scheme } catch (_: Throwable) { return false }
    return scheme.equals("http", ignoreCase = true) || scheme.equals("https", ignoreCase = true)
}

private fun openExternal(context: Context, url: String, onError: (String) -> Unit) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (e: Throwable) {
        onError(e.message ?: "Could not open $url")
    }
}

private fun shareLink(context: Context, url: String, onError: (String) -> Unit) {
    try {
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, url)
        }
        context.startActivity(Intent.createChooser(shareIntent, "Share link"))
    } catch (e: Throwable) {
        onError(e.message ?: "Could not share link")
    }
}
