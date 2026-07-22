package com.pearbrowser.app.ui.screens

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.pearbrowser.app.bridge.PearWorkletEvents
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.rpc.PearSearchFederatedEvent
import com.pearbrowser.app.rpc.PearSearchResult
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/**
 * SearchScreen — local-first search over pages you've opened (Mission B3).
 *
 * Mirrors the desktop Library "Search your P2P content" section +
 * FederatedSearch component (pearbrowser-desktop ui/shell.js):
 *   - Local results paint immediately from the on-device personal index —
 *     no query ever leaves the device.
 *   - "Include trusted peers" asks trusted contacts' indexes; the enriched
 *     set arrives later via the ACTION_SEARCH_FEDERATED broadcast, correlated
 *     by queryId so a stale enrichment never overwrites fresher results.
 *   - Indexing is opt-in (Settings → Clearnet & privacy → searchIndexEnabled,
 *     default OFF) — with indexing off the screen says so instead of
 *     pretending to work.
 *
 * iOS note: iOS MainView has no search route — this follows the desktop
 * Library organization, routed from the More tab hub.
 */
@Composable
fun SearchScreen(
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
) {
    val rpc = LocalPearRpc.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<PearSearchResult>?>(null) } // null = not searched yet
    var indexed by remember { mutableIntStateOf(0) }
    var searching by remember { mutableStateOf(false) }
    var federated by remember { mutableStateOf(false) }
    var federating by remember { mutableStateOf(false) }
    var searchMeta by remember { mutableStateOf<PearSearchFederatedEvent?>(null) }
    var searchIndexEnabled by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val searchId = remember { intArrayOf(0) }

    // Indexing posture hint (the same opt-in the desktop Library shows).
    LaunchedEffect(rpc) {
        val client = rpc ?: return@LaunchedEffect
        try {
            searchIndexEnabled = client.getPrivacyStatus().searchIndexEnabled
        } catch (_: Throwable) {
            // Posture hint is best-effort; search still works (empty index).
        }
    }

    // Enriched federated results push (queryId-correlated, stale-suppressed —
    // same discipline as the desktop EVT_SEARCH_FEDERATED listener).
    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != PearWorkletEvents.ACTION_SEARCH_FEDERATED) return
                val raw = intent.getStringExtra(PearWorkletEvents.EXTRA_SEARCH_PAYLOAD) ?: return
                val event = try {
                    PearSearchFederatedEvent.fromJson(Json.parseToJsonElement(raw).jsonObject)
                } catch (_: Throwable) {
                    return
                }
                if (event.queryId != searchId[0]) return // superseded by a newer query
                results = event.results
                searchMeta = event
                federating = false
            }
        }
        val filter = IntentFilter(PearWorkletEvents.ACTION_SEARCH_FEDERATED)
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose {
            try { context.unregisterReceiver(receiver) } catch (_: Throwable) {}
        }
    }

    fun runSearch() {
        val q = query.trim()
        if (q.isEmpty()) {
            results = null
            federating = false
            searchMeta = null
            return
        }
        val client = rpc ?: return
        searching = true
        federating = false
        searchMeta = null
        error = null
        scope.launch {
            try {
                val reply = client.search(q, limit = 50, federated = federated)
                searchId[0] = reply.queryId
                results = reply.results
                indexed = reply.docs
                if (reply.federating) federating = true // peer results arrive asynchronously
            } catch (e: Throwable) {
                error = e.message ?: "Search failed"
            } finally {
                searching = false
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PearColors.Bg),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(PearColors.Bg)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) {
                Text("< Back", color = PearColors.Accent, fontSize = 14.sp)
            }
            Text(
                "Search",
                color = PearColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Text(
                if (searchIndexEnabled) {
                    "Full-text search over pages you've opened, fully local — no query ever leaves this device." +
                        if (indexed > 0) " $indexed page(s) indexed." else ""
                } else {
                    "Local page indexing is OFF (privacy default). Enable it in Settings → Clearnet & privacy if you want search to learn from pages you open."
                },
                color = PearColors.TextSecondary,
                fontSize = 13.sp,
            )

            Spacer(Modifier.height(12.dp))

            // Search bar (mirrors the desktop urlbar row).
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(PearColors.Surface, RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search pages you've visited…", color = PearColors.TextMuted) },
                    textStyle = TextStyle(color = PearColors.TextPrimary, fontSize = 15.sp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.None,
                        autoCorrect = false,
                        imeAction = ImeAction.Search,
                    ),
                    keyboardActions = KeyboardActions(onSearch = { runSearch() }),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        cursorColor = PearColors.Accent,
                        focusedTextColor = PearColors.TextPrimary,
                        unfocusedTextColor = PearColors.TextPrimary,
                    ),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    if (searching) "…" else "Search",
                    color = if (query.trim().isEmpty() || searching) PearColors.TextMuted else PearColors.Accent,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clickable(enabled = query.trim().isNotEmpty() && !searching) { runSearch() }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                )
            }

            // Federated toggle + provenance (desktop search-fed-toggle row).
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Switch(checked = federated, onCheckedChange = { federated = it })
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text("Include trusted peers", color = PearColors.TextPrimary, fontSize = 14.sp)
                    if (federating) {
                        Text("searching peers…", color = PearColors.TextMuted, fontSize = 12.sp)
                    }
                }
                searchMeta?.let { meta ->
                    ProvenanceBadges(meta)
                }
            }

            error?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = PearColors.Error, fontSize = 12.sp)
            }

            Spacer(Modifier.height(14.dp))

            when {
                searching && results == null -> {
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 24.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator(color = PearColors.Accent)
                    }
                }

                results != null && results!!.isEmpty() -> {
                    Text(
                        if (indexed == 0) {
                            "No matches yet — browse some hyper:// pages first to build your index."
                        } else {
                            "No matches."
                        },
                        color = PearColors.TextMuted,
                        fontSize = 13.sp,
                    )
                }

                results != null -> {
                    results!!.forEach { result ->
                        SearchResultRow(
                            result = result,
                            showTier = federated,
                            onOpen = { onOpen(result.url) },
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                }
            }
        }
    }
}

/** Honest federation provenance (desktop SearchProvenanceBadges): partial
 *  results, digest-first skips, and verify-budget exhaustion are surfaced,
 *  never hidden. */
@Composable
private fun ProvenanceBadges(meta: PearSearchFederatedEvent) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (meta.partial) Badge("partial", PearColors.Warning)
        if (meta.digestHit) Badge("digest", PearColors.Success)
        if (meta.fallbackPull) Badge("fallback", PearColors.TextMuted)
        if (meta.verifyBudgetExhausted) Badge("verify cap", PearColors.Warning)
    }
}

@Composable
private fun Badge(label: String, color: Color) {
    Surface(
        color = PearColors.SurfaceElevated,
        shape = RoundedCornerShape(6.dp),
        border = BorderStroke(1.dp, PearColors.Border),
    ) {
        Text(
            label,
            color = color,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun SearchResultRow(
    result: PearSearchResult,
    showTier: Boolean,
    onOpen: () -> Unit,
) {
    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onOpen)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        result.title.ifBlank { result.url },
                        color = PearColors.TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (showTier) {
                        Spacer(Modifier.width(8.dp))
                        TierBadge(result)
                    }
                }
                Text(
                    result.url,
                    color = PearColors.TextMuted,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                "Open",
                color = PearColors.Accent,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(start = 12.dp),
            )
        }
    }
}

/** The desktop src-badge: "you" for hop-0, "trusted · hop N" for followed
 *  peers, the raw tier otherwise. */
@Composable
private fun TierBadge(result: PearSearchResult) {
    val (label, color) = when {
        result.tier.isBlank() || result.tier == "self" -> "you" to PearColors.Accent
        result.tier == "followed" -> "trusted · hop ${result.trustHop}" to PearColors.Success
        else -> result.tier to PearColors.TextMuted
    }
    Badge(label, color)
}
