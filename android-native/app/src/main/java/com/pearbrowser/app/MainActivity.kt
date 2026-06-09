package com.pearbrowser.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.pearbrowser.app.ui.screens.HomeScreen
import com.pearbrowser.app.ui.screens.MoreScreen
import com.pearbrowser.app.ui.theme.PearBrowserTheme
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/**
 * Root activity. Hosts the Compose UI and starts the worklet service.
 *
 * Phase 2: this is the Kotlin equivalent of `app/App.tsx`.
 * See docs/HOLEPUNCH_ALIGNMENT_PLAN.md.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        PearWorkletService.start(this)
        setContent {
            PearBrowserTheme {
                PearBrowserRoot()
            }
        }
    }
}

private enum class Tab(val label: String, val icon: String) {
    Home("Home", "{ }"),
    Explore("Explore", "[ ]"),
    Browse("Browse", "<>"),
    More("More", "...")
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
private fun PearBrowserRoot() {
    var activeTab by remember { mutableStateOf(Tab.Home) }
    var browseUrl by remember { mutableStateOf<String?>(null) }
    var showConnectedApps by remember { mutableStateOf(false) }
    var pendingLogin by remember { mutableStateOf<LoginConsentRequest?>(null) }
    var pendingSwarm by remember { mutableStateOf<SwarmConsentRequest?>(null) }
    val context = LocalContext.current
    val appContext = context.applicationContext
    val rpcClient = remember(appContext) { PearRpcClient(appContext) }
    val bindingState by rpcClient.bindingState.collectAsState()
    var workletStatus by remember { mutableStateOf<PearRpcStatus?>(null) }
    var pearSettings by remember { mutableStateOf<PearSettings?>(null) }
    var rpcError by remember { mutableStateOf<String?>(null) }

    DisposableEffect(rpcClient) {
        rpcClient.connect()
        onDispose { rpcClient.close() }
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
        browseUrl = url
        showConnectedApps = false
        activeTab = Tab.Browse
    }

    CompositionLocalProvider(LocalPearRpc provides rpcClient) {
        Column(Modifier.fillMaxSize().background(PearColors.Bg)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
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
                    Tab.Home -> HomeScreen(onNavigate = onNavigate)
                    Tab.Explore -> ExploreScreen(onVisit = onNavigate, settings = pearSettings)
                    Tab.Browse -> BrowseScreen(initialUrl = browseUrl)
                    Tab.More -> {
                        if (showConnectedApps) {
                            ConnectedAppsScreen(onBack = { showConnectedApps = false })
                        } else {
                            MoreScreen(
                                status = workletStatus,
                                settings = pearSettings,
                                bindingState = bindingState,
                                onOpenConnectedApps = { showConnectedApps = true },
                            )
                        }
                    }
                }
            }

            TabBar(active = activeTab, onSelect = {
                activeTab = it
                if (it != Tab.More) showConnectedApps = false
            })
        }
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
