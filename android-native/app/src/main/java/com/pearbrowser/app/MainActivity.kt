package com.pearbrowser.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.pearbrowser.app.bridge.PearWorkletEvents
import com.pearbrowser.app.bridge.PearWorkletService
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.rpc.PearRpcClient
import com.pearbrowser.app.rpc.PearRpcStatus
import com.pearbrowser.app.rpc.PearSettings
import com.pearbrowser.app.ui.screens.BookmarksScreen
import com.pearbrowser.app.ui.screens.BrowseScreen
import com.pearbrowser.app.ui.screens.ConnectedAppsScreen
import com.pearbrowser.app.ui.screens.ExploreScreen
import com.pearbrowser.app.ui.screens.HistoryScreen
import com.pearbrowser.app.ui.screens.HomeScreen
import com.pearbrowser.app.ui.screens.MoreScreen
import com.pearbrowser.app.ui.screens.MySitesScreen
import com.pearbrowser.app.ui.screens.QRScanMode
import com.pearbrowser.app.ui.screens.QRScannerScreen
import com.pearbrowser.app.ui.screens.SearchScreen
import com.pearbrowser.app.ui.screens.SettingsScreen
import com.pearbrowser.app.ui.screens.SiteEditorScreen
import com.pearbrowser.app.ui.screens.TabSwitcherScreen
import com.pearbrowser.app.ui.screens.TemplatePickerScreen
import com.pearbrowser.app.ui.tabs.BrowserTab
import com.pearbrowser.app.ui.tabs.BrowserTabManager
import com.pearbrowser.app.ui.theme.PearBrowserTheme
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Root activity. Hosts the Compose UI and starts the worklet service.
 *
 * Phase 2: this is the Kotlin equivalent of `app/App.tsx`.
 * See docs/HOLEPUNCH_ALIGNMENT_PLAN.md.
 */
class MainActivity : ComponentActivity() {
    // Manifest-declared VIEW deep links (hyper / pear / hyperbee) land here
    // for both cold starts (onCreate) and warm starts (onNewIntent, since the
    // activity is singleTask). The composable consumes and clears the state.
    private val deepLink = mutableStateOf<DeepLink?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        PearWorkletService.start(this)
        deepLink.value = DeepLink.fromIntent(intent)
        setContent {
            PearBrowserTheme {
                PearBrowserRoot(deepLink)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deepLink.value = DeepLink.fromIntent(intent)
    }
}

/** A parsed incoming deep link. Parsing is defensive: null or malformed
 *  intent data must never crash the activity. */
private sealed interface DeepLink {
    /** hyper:// URL (hyperbee:// is rewritten — same hypercore key space). */
    data class Hyper(val url: String) : DeepLink

    /** pear:// app link — full launch support is a later phase. */
    data class Pear(val url: String) : DeepLink

    companion object {
        private val driveKey = Regex("^(?:[0-9a-fA-F]{64}|[13-9a-km-uw-zA-KM-UW-Z]{52})$")

        fun fromIntent(intent: Intent?): DeepLink? {
            if (intent?.action != Intent.ACTION_VIEW) return null
            val raw = intent.dataString?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            return try {
                fromUrl(raw)
            } catch (_: Throwable) {
                null
            }
        }

        private fun fromUrl(raw: String): DeepLink? {
            val uri = Uri.parse(raw)
            return when (uri.scheme?.lowercase()) {
                "hyper", "hyperbee" -> {
                    val host = uri.host?.takeIf { driveKey.matches(it) } ?: return null
                    val path = uri.encodedPath?.takeIf { it.isNotEmpty() } ?: "/"
                    val query = uri.encodedQuery?.let { "?$it" }.orEmpty()
                    val fragment = uri.encodedFragment?.let { "#$it" }.orEmpty()
                    Hyper("hyper://${host.lowercase()}$path$query$fragment")
                }
                "pear" -> Pear(raw)
                else -> null
            }
        }
    }
}

private const val TAG = "MainActivity"

private enum class Tab(val label: String, val icon: String) {
    Home("Home", "{ }"),
    Explore("Explore", "[ ]"),
    Browse("Browse", "<>"),
    More("More", "...")
}

/** Sub-routes inside the More tab (mirrors iOS MainView's moreRoute). */
private sealed interface MoreRoute {
    data object Hub : MoreRoute
    data object ConnectedApps : MoreRoute
    data object Bookmarks : MoreRoute
    data object History : MoreRoute
    data object Search : MoreRoute
    data object Settings : MoreRoute
    data object Sites : MoreRoute
    data class SitesTemplatePicker(val pendingName: String) : MoreRoute
    data class SiteEditor(
        val siteId: String,
        val siteName: String?,
        val published: Boolean,
        val templateId: String?,
    ) : MoreRoute
}

private data class LoginConsentRequest(
    val requestId: String,
    val driveKey: String,
    val appName: String,
    val reason: String,
    val scopes: List<String>,
)

private data class SwarmConsentRequest(
    val requestId: String,
    val driveKey: String,
    val topicHex: String,
    val protocolName: String,
    val appName: String,
    val reason: String,
)

@Composable
private fun PearBrowserRoot(deepLink: MutableState<DeepLink?>) {
    var activeTab by remember { mutableStateOf(Tab.Home) }
    var browseUrl by remember { mutableStateOf<String?>(null) }
    var moreRoute by remember { mutableStateOf<MoreRoute>(MoreRoute.Hub) }
    var pendingLogin by remember { mutableStateOf<LoginConsentRequest?>(null) }
    var pendingSwarm by remember { mutableStateOf<SwarmConsentRequest?>(null) }
    var pearLink by remember { mutableStateOf<String?>(null) }
    // QR scanner overlay state — Navigate scans hyper:// URLs into Browse;
    // DeviceLink scans a blind-pairing invite into More's identity section.
    var qrScannerMode by remember { mutableStateOf<QRScanMode?>(null) }
    var scannedInvite by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val appContext = context.applicationContext
    val rpcClient = remember(appContext) { PearRpcClient(appContext) }
    val bindingState by rpcClient.bindingState.collectAsState()
    var workletStatus by remember { mutableStateOf<PearRpcStatus?>(null) }
    var pearSettings by remember { mutableStateOf<PearSettings?>(null) }
    var rpcError by remember { mutableStateOf<String?>(null) }
    // Multi-tab browsing: the tab model (and its bounded live-WebView pool)
    // lives at the root so switching app tabs never destroys tab state.
    val tabManager = remember { BrowserTabManager() }
    var showTabSwitcher by remember { mutableStateOf(false) }
    // App screen Browse was entered from — back-out of Browse lands here.
    var browseOrigin by remember { mutableStateOf(Tab.Home) }
    var sessionRestored by remember { mutableStateOf(false) }

    DisposableEffect(rpcClient) {
        rpcClient.connect()
        onDispose { rpcClient.close() }
    }

    // Release the pooled WebViews when the composition dies (e.g. rotation);
    // the persisted session rehydrates the tabs on the next cold start.
    DisposableEffect(tabManager) {
        onDispose { tabManager.closeAll() }
    }

    // Cold-start session restore (mirror of app/App.tsx): USERDATA_GET_SESSION
    // → hydrate open tabs + active tab. Runs once per process and only while
    // the tab model is still empty — a deep link or navigation that already
    // created a tab wins over the stored session.
    LaunchedEffect(rpcClient, bindingState.connected) {
        if (!bindingState.connected || sessionRestored) return@LaunchedEffect
        var restored = false
        repeat(5) { attempt ->
            if (restored) return@repeat
            try {
                val session = rpcClient.getSession()
                restored = true
                if (tabManager.tabs.isEmpty()) {
                    val parsed = (session["browserTabs"] as? JsonArray)?.mapNotNull { el ->
                        val obj = el as? JsonObject ?: return@mapNotNull null
                        val id = obj["id"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
                            ?: return@mapNotNull null
                        BrowserTab(
                            id = id,
                            url = obj["url"]?.jsonPrimitive?.contentOrNull,
                            title = obj["title"]?.jsonPrimitive?.contentOrNull ?: "",
                        )
                    }.orEmpty()
                    // Cross-shell fallback: an RN-written session has no
                    // browserTabs, only lastBrowseUrl — restore it as one tab.
                    val lastUrl = session["lastBrowseUrl"]?.jsonPrimitive?.contentOrNull
                    val hydrated = when {
                        parsed.isNotEmpty() -> parsed
                        !lastUrl.isNullOrBlank() -> listOf(BrowserTab(url = lastUrl))
                        else -> emptyList()
                    }
                    if (hydrated.isNotEmpty()) {
                        tabManager.restore(
                            hydrated,
                            session["activeBrowserTabId"]?.jsonPrimitive?.contentOrNull,
                        )
                    }
                    // RN parity (App.tsx restores a non-home activeTab) — but
                    // never steal focus from a deep link already routed.
                    val navTab = session["activeTab"]?.jsonPrimitive?.contentOrNull
                    if (navTab != null && navTab != "home" && browseUrl == null && deepLink.value == null) {
                        activeTab = when (navTab) {
                            "explore" -> Tab.Explore
                            "browse" -> Tab.Browse
                            "more" -> Tab.More
                            else -> Tab.Home
                        }
                    }
                }
            } catch (_: Throwable) {
                // The worklet may still be booting (user-data not ready) —
                // retry briefly, then give up: restore is best-effort and
                // must never block startup.
                if (attempt < 4) delay(1_500)
            }
        }
        sessionRestored = true
    }

    // Persist the tab session, debounced, and only after the stored session
    // was restored — same discipline as app/App.tsx (an early save from the
    // empty model would clobber the stored tabs). The session KV is a plain
    // Hyperbee entry (backend/user-data.js saveSession) that does NOT feed
    // the history log, so saving stays always-on regardless of
    // settings.historyEnabled. Merge-before-write mirrors app/lib/storage.ts
    // saveSession(partial) so keys written by other shells survive.
    val tabSessionSnapshot = tabManager.sessionSnapshot()
    LaunchedEffect(tabSessionSnapshot, activeTab, sessionRestored, bindingState.connected) {
        if (!sessionRestored || !bindingState.connected) return@LaunchedEffect
        delay(600)
        try {
            val current = rpcClient.getSession()
            val merged = JsonObject(
                current + buildJsonObject {
                    putJsonArray("browserTabs") {
                        tabManager.tabs.forEach { tab ->
                            add(
                                buildJsonObject {
                                    put("id", tab.id)
                                    put("url", tab.url)
                                    put("title", tab.title)
                                },
                            )
                        }
                    }
                    put("activeBrowserTabId", tabManager.activeTabId)
                    put("activeTab", activeTab.name.lowercase())
                    tabManager.activeTab?.url?.let { put("lastBrowseUrl", it) }
                },
            )
            rpcClient.saveSession(merged)
        } catch (_: Throwable) {
            // Session save is best-effort and must never break browsing.
        }
    }

    LaunchedEffect(rpcClient, bindingState.connected) {
        if (!bindingState.connected) return@LaunchedEffect
        while (isActive) {
            try {
                workletStatus = rpcClient.getStatus()
                rpcError = null
            } catch (e: Throwable) {
                rpcError = e.message ?: "RPC status unavailable"
            }

            try {
                pearSettings = rpcClient.getSettings()
            } catch (e: Throwable) {
                if (rpcError == null) rpcError = e.message ?: "RPC settings unavailable"
            }

            delay(5_000)
        }
    }

    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                when (intent?.action) {
                    PearWorkletEvents.ACTION_LOGIN_REQUEST -> {
                        val requestId = intent.getStringExtra(PearWorkletEvents.EXTRA_REQUEST_ID) ?: return
                        val driveKey = intent.getStringExtra(PearWorkletEvents.EXTRA_DRIVE_KEY) ?: return
                        pendingLogin = LoginConsentRequest(
                            requestId = requestId,
                            driveKey = driveKey,
                            appName = intent.getStringExtra(PearWorkletEvents.EXTRA_APP_NAME) ?: "A PearBrowser app",
                            reason = intent.getStringExtra(PearWorkletEvents.EXTRA_REASON) ?: "",
                            scopes = intent.getStringArrayExtra(PearWorkletEvents.EXTRA_SCOPES)?.toList() ?: emptyList(),
                        )
                    }
                    PearWorkletEvents.ACTION_SWARM_REQUEST -> {
                        val requestId = intent.getStringExtra(PearWorkletEvents.EXTRA_REQUEST_ID) ?: return
                        val driveKey = intent.getStringExtra(PearWorkletEvents.EXTRA_DRIVE_KEY) ?: return
                        val topicHex = intent.getStringExtra(PearWorkletEvents.EXTRA_TOPIC_HEX) ?: return
                        pendingSwarm = SwarmConsentRequest(
                            requestId = requestId,
                            driveKey = driveKey,
                            topicHex = topicHex,
                            protocolName = intent.getStringExtra(PearWorkletEvents.EXTRA_PROTOCOL) ?: "pear.swarm.v1",
                            appName = intent.getStringExtra(PearWorkletEvents.EXTRA_APP_NAME) ?: "A PearBrowser app",
                            reason = intent.getStringExtra(PearWorkletEvents.EXTRA_REASON) ?: "",
                        )
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(PearWorkletEvents.ACTION_LOGIN_REQUEST)
            addAction(PearWorkletEvents.ACTION_SWARM_REQUEST)
        }
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose {
            try { context.unregisterReceiver(receiver) } catch (_: Throwable) {}
        }
    }

    val onNavigate: (String) -> Unit = { url ->
        if (activeTab != Tab.Browse) browseOrigin = activeTab
        browseUrl = url
        moreRoute = MoreRoute.Hub
        activeTab = Tab.Browse
    }

    // Consume incoming deep links (cold start via onCreate, warm start via
    // onNewIntent). hyper:// routes straight into Browse through
    // CMD_NAVIGATE; pear:// app links are a stub until the pear-link launch
    // phase lands — we log and surface a message instead of dropping them.
    val pendingLink = deepLink.value
    LaunchedEffect(pendingLink) {
        when (val link = pendingLink) {
            null -> Unit
            is DeepLink.Hyper -> {
                onNavigate(link.url)
                deepLink.value = null
            }
            is DeepLink.Pear -> {
                Log.d(TAG, "pear:// link received (launch is a later phase): ${link.url}")
                pearLink = link.url
                deepLink.value = null
            }
        }
    }

    CompositionLocalProvider(LocalPearRpc provides rpcClient) {
        Box(Modifier.fillMaxSize().background(PearColors.Bg)) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val headerText = when {
                    bindingState.connecting -> "● Starting..."
                    bindingState.error != null -> "● Offline"
                    workletStatus?.dhtConnected == true ->
                        if ((workletStatus?.peerCount ?: 0) > 0) "● ${workletStatus?.peerCount} peers" else "● Connected"
                    workletStatus != null -> "● Engine ready"
                    rpcError != null -> "● Waiting..."
                    else -> "● Starting..."
                }
                val headerColor = when {
                    workletStatus?.dhtConnected == true -> PearColors.Success
                    bindingState.error != null -> PearColors.Error
                    workletStatus != null -> PearColors.Accent
                    else -> PearColors.Warning
                }
                Text(
                    headerText,
                    color = headerColor,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                )
            }

            Box(Modifier.weight(1f)) {
                when (activeTab) {
                    Tab.Home -> HomeScreen(
                        onNavigate = onNavigate,
                        status = workletStatus,
                        onOpenQR = { qrScannerMode = QRScanMode.Navigate },
                    )
                    Tab.Explore -> ExploreScreen(onVisit = onNavigate, settings = pearSettings)
                    Tab.Browse -> BrowseScreen(
                        initialUrl = browseUrl,
                        settings = pearSettings,
                        tabs = tabManager,
                        onOpenTabs = { showTabSwitcher = true },
                        onExitBrowse = { activeTab = browseOrigin },
                    )
                    Tab.More -> {
                        when (val route = moreRoute) {
                            MoreRoute.Hub -> MoreScreen(
                                status = workletStatus,
                                bindingState = bindingState,
                                onOpenConnectedApps = { moreRoute = MoreRoute.ConnectedApps },
                                onOpenBookmarks = { moreRoute = MoreRoute.Bookmarks },
                                onOpenHistory = { moreRoute = MoreRoute.History },
                                onOpenSearch = { moreRoute = MoreRoute.Search },
                                onOpenSettings = { moreRoute = MoreRoute.Settings },
                                onOpenSites = { moreRoute = MoreRoute.Sites },
                                onScanInviteQr = { qrScannerMode = QRScanMode.DeviceLink },
                                pendingInvite = scannedInvite,
                                onInviteHandled = { scannedInvite = null },
                            )
                            MoreRoute.ConnectedApps -> ConnectedAppsScreen(onBack = { moreRoute = MoreRoute.Hub })
                            MoreRoute.Bookmarks -> BookmarksScreen(
                                onOpen = { url ->
                                    moreRoute = MoreRoute.Hub
                                    onNavigate(url)
                                },
                                onBack = { moreRoute = MoreRoute.Hub },
                            )
                            MoreRoute.History -> HistoryScreen(
                                onOpen = { url ->
                                    moreRoute = MoreRoute.Hub
                                    onNavigate(url)
                                },
                                onBack = { moreRoute = MoreRoute.Hub },
                            )
                            MoreRoute.Search -> SearchScreen(
                                onOpen = { url ->
                                    moreRoute = MoreRoute.Hub
                                    onNavigate(url)
                                },
                                onBack = { moreRoute = MoreRoute.Hub },
                            )
                            MoreRoute.Settings -> SettingsScreen(onBack = { moreRoute = MoreRoute.Hub })
                            MoreRoute.Sites -> MySitesScreen(
                                onEdit = { site ->
                                    moreRoute = MoreRoute.SiteEditor(
                                        siteId = site.siteId,
                                        siteName = site.name,
                                        published = site.published,
                                        templateId = null,
                                    )
                                },
                                onPreview = { url ->
                                    moreRoute = MoreRoute.Hub
                                    onNavigate(url)
                                },
                                onCreateNew = { name -> moreRoute = MoreRoute.SitesTemplatePicker(name) },
                                onBack = { moreRoute = MoreRoute.Hub },
                            )
                            is MoreRoute.SitesTemplatePicker -> TemplatePickerScreen(
                                onSelect = { template ->
                                    // Create the site, then land in the editor
                                    // prefilled with the template (iOS MainView).
                                    val client = rpcClient
                                    scope.launch {
                                        try {
                                            val resp = client.createSite(route.pendingName)
                                            val siteId = resp["siteId"]?.jsonPrimitive?.contentOrNull.orEmpty()
                                            if (siteId.isEmpty()) {
                                                moreRoute = MoreRoute.Sites
                                                return@launch
                                            }
                                            moreRoute = MoreRoute.SiteEditor(
                                                siteId = siteId,
                                                siteName = route.pendingName,
                                                published = false,
                                                templateId = template.id,
                                            )
                                        } catch (_: Throwable) {
                                            moreRoute = MoreRoute.Sites
                                        }
                                    }
                                },
                                onBack = { moreRoute = MoreRoute.Sites },
                            )
                            is MoreRoute.SiteEditor -> SiteEditorScreen(
                                siteId = route.siteId,
                                siteName = route.siteName,
                                published = route.published,
                                templateId = route.templateId,
                                onBack = { moreRoute = MoreRoute.Sites },
                                onPreview = { url ->
                                    moreRoute = MoreRoute.Hub
                                    onNavigate(url)
                                },
                            )
                        }
                    }
                }
            }

            TabBar(active = activeTab, onSelect = {
                activeTab = it
                if (it != Tab.More) moreRoute = MoreRoute.Hub
            })
        }

        // Full-screen QR scanner overlay (Home QR badge + More invite scan).
        qrScannerMode?.let { mode ->
            QRScannerScreen(
                mode = mode,
                onScan = { payload ->
                    qrScannerMode = null
                    when (mode) {
                        QRScanMode.Navigate -> onNavigate(payload)
                        QRScanMode.DeviceLink -> scannedInvite = payload
                    }
                },
                onClose = { qrScannerMode = null },
            )
        }

        // Full-screen tab switcher overlay (Browse nav bar tab-count button).
        if (showTabSwitcher) {
            TabSwitcherScreen(
                tabs = tabManager.tabs,
                activeTabId = tabManager.activeTabId,
                onSelect = { tabId ->
                    tabManager.select(tabId)
                    showTabSwitcher = false
                },
                onClose = { tabId -> tabManager.close(tabId) },
                onNewTab = {
                    tabManager.openNewTab()
                    showTabSwitcher = false
                    // DESIGN.md: "+" opens a new tab and goes to Home.
                    activeTab = Tab.Home
                },
                onDismiss = { showTabSwitcher = false },
            )
        }
        }
    }

    // pear:// stub — full pear-link app launch is a later phase. Until then
    // the link is surfaced so the tap is never silently dropped.
    pearLink?.let { url ->
        AlertDialog(
            onDismissRequest = { pearLink = null },
            containerColor = PearColors.Surface,
            title = {
                Text("Pear link", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Text(
                    "Opening pear:// app links is coming in a later phase.\n\n$url",
                    color = PearColors.TextSecondary,
                    fontSize = 14.sp,
                )
            },
            confirmButton = {
                TextButton(onClick = { pearLink = null }) {
                    Text("OK", color = PearColors.Accent, fontWeight = FontWeight.Bold)
                }
            },
        )
    }

    pendingLogin?.let { request ->
        LoginConsentDialog(
            request = request,
            onAllow = {
                sendLoginDecision(context, request, approved = true)
                pendingLogin = null
            },
            onDeny = {
                sendLoginDecision(context, request, approved = false)
                pendingLogin = null
            },
        )
    }

    pendingSwarm?.let { request ->
        SwarmConsentDialog(
            request = request,
            onAllow = {
                sendSwarmDecision(context, request, approved = true)
                pendingSwarm = null
            },
            onDeny = {
                sendSwarmDecision(context, request, approved = false)
                pendingSwarm = null
            },
        )
    }
}

@Composable
private fun LoginConsentDialog(
    request: LoginConsentRequest,
    onAllow: () -> Unit,
    onDeny: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDeny,
        containerColor = PearColors.Surface,
        title = {
            Text(
                text = request.appName,
                color = PearColors.TextPrimary,
                fontWeight = FontWeight.Bold,
            )
        },
        text = {
            Column {
                Text(
                    text = "This app wants to sign in with your per-app Pear identity." +
                        if (request.reason.isNotBlank()) " ${request.reason}" else "",
                    color = PearColors.TextSecondary,
                    fontSize = 14.sp,
                )
                Text(
                    text = "Requested access",
                    color = PearColors.TextPrimary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 14.dp, bottom = 6.dp),
                )
                val scopes = if (request.scopes.isEmpty()) listOf("app public key only") else request.scopes
                scopes.forEach { scope ->
                    Text("• $scope", color = PearColors.TextSecondary, fontSize = 13.sp)
                }
                Text(
                    text = "The app gets a stable key scoped to this drive, not your root device key.",
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onAllow) {
                Text("Allow", color = PearColors.Accent, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDeny) {
                Text("Deny", color = PearColors.TextSecondary)
            }
        },
    )
}

@Composable
private fun SwarmConsentDialog(
    request: SwarmConsentRequest,
    onAllow: () -> Unit,
    onDeny: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDeny,
        containerColor = PearColors.Surface,
        title = {
            Text(
                text = "Direct swarm access",
                color = PearColors.TextPrimary,
                fontWeight = FontWeight.Bold,
            )
        },
        text = {
            Column {
                Text(
                    text = "${request.appName} wants to join a raw Hyperswarm topic. " +
                        "That can expose your network metadata to peers outside this app drive.",
                    color = PearColors.TextSecondary,
                    fontSize = 14.sp,
                )
                if (request.reason.isNotBlank()) {
                    Text(
                        text = request.reason,
                        color = PearColors.TextSecondary,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
                Text(
                    text = "Topic",
                    color = PearColors.TextPrimary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 14.dp, bottom = 6.dp),
                )
                Text(
                    text = request.topicHex,
                    color = PearColors.TextMuted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                )
                Text(
                    text = "Protocol: ${request.protocolName}. This grant is saved until revoked.",
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onAllow) {
                Text("Allow", color = PearColors.Accent, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDeny) {
                Text("Deny", color = PearColors.TextSecondary)
            }
        },
    )
}

private fun sendLoginDecision(context: Context, request: LoginConsentRequest, approved: Boolean) {
    context.sendBroadcast(Intent(PearWorkletEvents.ACTION_RESOLVE_LOGIN).apply {
        setPackage(context.packageName)
        putExtra(PearWorkletEvents.EXTRA_REQUEST_ID, request.requestId)
        putExtra(PearWorkletEvents.EXTRA_APPROVED, approved)
        putExtra(PearWorkletEvents.EXTRA_SCOPES, if (approved) request.scopes.toTypedArray() else emptyArray<String>())
    })
}

private fun sendSwarmDecision(context: Context, request: SwarmConsentRequest, approved: Boolean) {
    context.sendBroadcast(Intent(PearWorkletEvents.ACTION_RESOLVE_SWARM).apply {
        setPackage(context.packageName)
        putExtra(PearWorkletEvents.EXTRA_REQUEST_ID, request.requestId)
        putExtra(PearWorkletEvents.EXTRA_APPROVED, approved)
    })
}

@Composable
private fun TabBar(active: Tab, onSelect: (Tab) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(PearColors.Surface)
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        for (tab in Tab.entries) {
            val tint = if (tab == active) PearColors.Accent else PearColors.TextMuted
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clickable { onSelect(tab) }
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Text(
                    tab.icon,
                    color = tint,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                )
                Text(
                    tab.label,
                    color = tint,
                    fontSize = 10.sp,
                )
            }
        }
    }
}
