package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.rpc.PearAskCapabilities
import com.pearbrowser.app.rpc.PearNameEntry
import com.pearbrowser.app.rpc.PearPluginCatalog
import com.pearbrowser.app.rpc.PearPluginInfo
import com.pearbrowser.app.rpc.PearPluginInstallReply
import com.pearbrowser.app.rpc.PearPluginUpdateReply
import com.pearbrowser.app.rpc.PearPrivacyStatus
import com.pearbrowser.app.rpc.PearProfile
import com.pearbrowser.app.rpc.PearRpcClient
import com.pearbrowser.app.rpc.PearShieldStatus
import com.pearbrowser.app.rpc.PearTrustedOrigin
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * SettingsScreen — mirror of ios-native `SettingsScreen.swift`, with the
 * iOS sub-screens (ProfileEditScreen, TrustedSitesScreen) folded in as
 * sections. Routed from the More tab hub.
 *
 * Sections:
 *   - Privacy: history opt-in toggle. Uses the same `historyEnabled`
 *     user-data setting key that HistoryScreen exposes in its empty state
 *     and BrowseScreen gates recording on — one key, three surfaces.
 *   - Content Shield: ad/tracker blocking (ported from pearbrowser-desktop).
 *     Enable toggle + session counters + per-drive allow/strict toggles +
 *     P2P filter-list subscriptions (SHIELD_STATUS / SET_ALLOW /
 *     SET_STRICT / SUBSCRIBE_LIST / UNSUBSCRIBE_LIST / REFRESH_LISTS).
 *   - Pear Plugins: drive-installed extensions (Mission B4a, ported from
 *     pearbrowser-desktop Phase 3). Installed list with kill-switch toggles,
 *     install by drive key with snapshot-bound consent, update with the
 *     escalation-consent dialog, and the P2P plugin catalogue
 *     (PLUGIN_LIST / SET_ENABLED / INSTALL_DRIVE / UPDATE_DRIVE /
 *     UNINSTALL / CATALOG*).
 *   - Clearnet & Privacy: proxied-vs-direct clearnet mode + privacy-ladder
 *     toggles (HTTPS-only, tracking strip, cookie drop, farbling), driven
 *     by PRIVACY_STATUS + the same settings keys as the desktop (B2).
 *   - Relays: hybrid-fetch on/off (global), relay list (first = primary),
 *     add with validation, remove. Driven by GET_RELAYS / SET_RELAYS /
 *     SET_RELAY_ENABLED.
 *   - Profile: view + edit the opt-in profile fields (PROFILE_GET /
 *     PROFILE_UPDATE) with save/cancel dirty tracking.
 *   - Trusted sites: bridge-injection mode (all / allow-list) plus the
 *     per-origin trust list (TRUSTED_ORIGINS_LIST / ADD / REMOVE /
 *     SET_MODE).
 *
 * All state flows through the bound worklet RPC (LocalPearRpc); errors
 * surface inline next to the section that produced them.
 */
@Composable
fun SettingsScreen(onBack: () -> Unit) {
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
                "Settings",
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
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            PrivacySection()
            ContentShieldSection()
            PluginsSection()
            ClearnetPrivacySection()
            RelaysSection()
            ProfileSection()
            TrustedSitesSection()
            NamesSection()
            OnDeviceAiSection()
        }
    }
}

// --- Privacy ---------------------------------------------------------------

@Composable
private fun PrivacySection() {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var historyEnabled by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(rpc) {
        val client = rpc ?: return@LaunchedEffect
        try {
            historyEnabled = client.getSettings().historyEnabled
            loaded = true
        } catch (e: Throwable) {
            error = e.message ?: "Could not load settings"
        }
    }

    fun setHistoryEnabled(enabled: Boolean) {
        val client = rpc ?: return
        scope.launch {
            try {
                client.setSettings(buildJsonObject { put("historyEnabled", enabled) })
                historyEnabled = enabled
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not update settings"
            }
        }
    }

    SettingsCard("Privacy") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Text("Save browsing history", color = PearColors.TextPrimary, fontSize = 15.sp)
                Text(
                    "Off by default to protect your privacy. Sites you open appear in History, synced across your devices.",
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Switch(
                checked = historyEnabled,
                onCheckedChange = ::setHistoryEnabled,
                enabled = rpc != null && loaded,
            )
        }
        SettingsError(error)
    }
}

// --- Content Shield --------------------------------------------------------
/**
 * Mirror of the desktop Settings → Content Shield card (ui/shell.js
 * ContentShieldSection), scoped to what the mobile RPC supports: enable
 * toggle (user-data `contentShield` key, default ON), session counters,
 * per-drive allowlist / strict-CSP toggles, and P2P filter-list
 * subscriptions (subscribe by drive key, refresh, remove).
 *
 * Two deliberate adaptations from the desktop panel: there is no active-
 * drive context inside Settings, so the per-drive controls take a pasted
 * drive key instead of reading the urlbar; and status reloads after each
 * action instead of polling every 5s (battery).
 */
@Composable
private fun ContentShieldSection() {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<PearShieldStatus?>(null) }
    var driveInput by remember { mutableStateOf("") }
    var subscribeInput by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    val driveKey = driveInput.trim().lowercase()
    val driveKeyValid = driveKey.matches(Regex("[0-9a-f]{64}"))
    val subscribeKey = subscribeInput.trim().lowercase()
    val subscribeKeyValid = subscribeKey.matches(Regex("[0-9a-f]{64}"))

    suspend fun reload(key: String? = null) {
        val client = rpc ?: return
        try {
            status = client.getShieldStatus(key)
            loaded = true
            error = null
        } catch (e: Throwable) {
            error = e.message ?: "Could not load shield status"
        }
    }

    LaunchedEffect(rpc) { reload() }

    fun run(action: suspend () -> Unit) {
        if (rpc == null || busy) return
        busy = true
        scope.launch {
            try {
                action()
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Shield request failed"
            }
            reload(driveKey.takeIf { driveKeyValid })
            busy = false
        }
    }

    fun setShieldEnabled(enabled: Boolean) {
        val client = rpc ?: return
        run { client.setSettings(buildJsonObject { put("contentShield", enabled) }) }
    }

    fun setAllow(allow: Boolean) {
        val client = rpc ?: return
        if (!driveKeyValid) return
        run { client.setShieldAllow(driveKey, allow) }
    }

    fun setStrict(strict: Boolean) {
        val client = rpc ?: return
        if (!driveKeyValid) return
        run { client.setShieldStrict(driveKey, strict) }
    }

    fun subscribe() {
        val client = rpc ?: return
        if (!subscribeKeyValid) return
        run {
            client.subscribeList(subscribeKey)
            subscribeInput = ""
        }
    }

    fun unsubscribe(key: String) {
        val client = rpc ?: return
        run { client.unsubscribeList(key) }
    }

    fun refresh(key: String? = null) {
        val client = rpc ?: return
        run { client.refreshLists(key, force = key != null) }
    }

    SettingsCard("Content Shield") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Text("Block ads and trackers", color = PearColors.TextPrimary, fontSize = 15.sp)
                Text(
                    "Matching requests are refused inside the browser before any peer or relay is contacted, and matching page elements are hidden. Counters only — the shield never keeps a log of what you visit.",
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Switch(
                checked = status?.enabled != false,
                onCheckedChange = ::setShieldEnabled,
                enabled = rpc != null && loaded && !busy,
            )
        }

        status?.let { s ->
            Text(
                "${s.blocked} blocked · ${s.allowed} allowed this session",
                color = PearColors.TextPrimary,
                fontSize = 13.sp,
            )
            val listLabel = s.lists.joinToString(", ").ifEmpty { "none" }
            Text(
                "${s.blockRules} block · ${s.cosmeticRules} cosmetic · ${s.scriptletRules} scriptlet · lists: $listLabel",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
            if (s.topRules.isNotEmpty()) {
                Text(
                    "Top rules: " + s.topRules.take(3).joinToString(" · ") { "${it.rule} (${it.hits})" },
                    color = PearColors.TextMuted,
                    fontSize = 11.sp,
                )
            }
        }

        // Per-drive controls — the desktop reads the active drive from the
        // urlbar; here the drive key is pasted explicitly.
        Text("This drive", color = PearColors.TextPrimary, fontSize = 15.sp)
        Text(
            "Allowlist exempts one drive from blocking. Strict mode injects a CSP that confines third-party subresources to the page origin.",
            color = PearColors.TextMuted,
            fontSize = 12.sp,
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SettingsTextField(
                value = driveInput,
                onValueChange = {
                    driveInput = it
                    val key = it.trim().lowercase()
                    if (key.matches(Regex("[0-9a-f]{64}"))) {
                        scope.launch { reload(key) }
                    }
                },
                placeholder = "64-hex drive key",
                enabled = rpc != null && !busy,
                modifier = Modifier.weight(1f),
            )
        }
        if (driveKeyValid) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Allow (no blocking)", color = PearColors.TextPrimary, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Switch(
                    checked = status?.driveAllowlisted == true,
                    onCheckedChange = ::setAllow,
                    enabled = rpc != null && !busy,
                )
                Spacer(Modifier.width(12.dp))
                Text("Strict CSP", color = PearColors.TextPrimary, fontSize = 13.sp)
                Spacer(Modifier.width(6.dp))
                Switch(
                    checked = status?.driveStrict == true,
                    onCheckedChange = ::setStrict,
                    enabled = rpc != null && !busy,
                )
            }
        }

        // Filter lists from the swarm — same subscription lifecycle as the
        // desktop (manifest + sha256 verify, hot-swap, offline restore).
        Text("Filter lists from the swarm", color = PearColors.TextPrimary, fontSize = 15.sp)
        Text(
            "Subscribe to a filter-list Hyperdrive by key. Rules sync peer-to-peer, hot-swap when the publisher updates, and keep working offline — no CDN, no list-fetch fingerprint.",
            color = PearColors.TextMuted,
            fontSize = 12.sp,
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SettingsTextField(
                value = subscribeInput,
                onValueChange = { subscribeInput = it },
                placeholder = "64-hex filter-list drive key",
                enabled = rpc != null && !busy,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            SettingsPill(
                label = "Subscribe",
                enabled = rpc != null && !busy && subscribeKeyValid,
                onClick = ::subscribe,
            )
        }
        val subscriptions = status?.subscriptions ?: emptyList()
        subscriptions.forEach { sub ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text(
                        (sub.name.ifEmpty { sub.driveKey.take(12) + "…" }) +
                            (if (sub.version.isNotEmpty()) " · v${sub.version}" else ""),
                        color = PearColors.TextPrimary,
                        fontSize = 13.sp,
                    )
                    Text(
                        "${sub.rules} rules · ${sub.driveKey.take(16)}…",
                        color = PearColors.TextMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                    )
                }
                SettingsPill(label = "Refresh", enabled = rpc != null && !busy) { refresh(sub.driveKey) }
                Spacer(Modifier.width(8.dp))
                SettingsPill(label = "Remove", destructive = true, enabled = rpc != null && !busy) {
                    unsubscribe(sub.driveKey)
                }
            }
        }
        if (subscriptions.isNotEmpty()) {
            SettingsPill(
                label = "Refresh all",
                enabled = rpc != null && !busy,
                onClick = { refresh() },
            )
        }

        if (!loaded && error == null) {
            Text(
                if (rpc == null) "P2P engine is not connected yet" else "Loading...",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
        }
        SettingsError(error)
    }
}

// --- Pear Plugins ----------------------------------------------------------

/**
 * Mirror of the desktop Settings → Content Shield "Plugin catalog" + "Pear
 * Plugins" rows (ui/shell.js ContentShieldSection), promoted to their own
 * card (Mission B4a). Plugins are Hyperdrives with declared capabilities:
 * installing is a two-step consent bound to the exact reviewed snapshot, an
 * update that requests NEW capabilities auto-disables the plugin until
 * re-approved (escalation dialog), and the per-plugin switch is the kill
 * switch — contributions stop, the install stays.
 *
 * Two deliberate adaptations from the desktop panel: the catalogue's
 * `kind: "app"` Open action copies the hyper:// link instead of navigating
 * (Settings has no browser surface of its own), and state reloads after
 * each action instead of polling every 5s (battery).
 */
@Composable
private fun PluginsSection() {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var plugins by remember { mutableStateOf<List<PearPluginInfo>>(emptyList()) }
    var catalog by remember { mutableStateOf(PearPluginCatalog()) }
    var installInput by remember { mutableStateOf("") }
    var catalogSourceInput by remember { mutableStateOf("") }
    var pendingInstall by remember { mutableStateOf<PearPluginInstallReply?>(null) }
    var escalation by remember { mutableStateOf<PearPluginUpdateReply?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val installKey = installInput.trim().lowercase()
    val installKeyValid = installKey.matches(Regex("[0-9a-f]{64}"))
    val catalogSourceKey = catalogSourceInput.trim().lowercase()
    val catalogSourceKeyValid = catalogSourceKey.matches(Regex("[0-9a-f]{64}"))

    suspend fun reload() {
        val client = rpc ?: return
        try {
            plugins = client.pluginList()
            catalog = client.pluginCatalog()
            loaded = true
            error = null
        } catch (e: Throwable) {
            error = e.message ?: "Could not load plugins"
        }
    }

    LaunchedEffect(rpc) { reload() }

    fun run(action: suspend () -> Unit) {
        if (rpc == null || busy) return
        busy = true
        scope.launch {
            try {
                action()
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Plugin request failed"
            }
            reload()
            busy = false
        }
    }

    // Two-step snapshot-bound consent: the first call previews requested
    // capabilities + the snapshot fingerprint; accepting echoes them back.
    fun installByKey(key: String, review: PearPluginInstallReply? = null) {
        val client = rpc ?: return
        if (!key.matches(Regex("[0-9a-f]{64}"))) return
        run {
            val outcome = client.pluginInstallDrive(
                key,
                granted = review?.requested,
                reviewedFingerprint = review?.fingerprint,
            )
            pendingInstall = if (outcome.consentRequired) outcome else null
        }
    }

    // Same-capability updates hot-swap silently; an escalation returns the
    // added capabilities for the re-consent dialog (plugin stays disabled
    // until accepted).
    fun updatePlugin(id: String, review: PearPluginUpdateReply? = null) {
        val client = rpc ?: return
        run {
            val outcome = client.pluginUpdateDrive(
                id,
                granted = review?.capabilities,
                reviewedFingerprint = review?.fingerprint,
            )
            escalation = if (outcome.escalated) outcome else null
        }
    }

    fun uninstallPlugin(id: String) {
        val client = rpc ?: return
        run {
            client.pluginUninstall(id)
            if (escalation?.driveKey == id) escalation = null
        }
    }

    fun loadCatalogSource() {
        val client = rpc ?: return
        if (!catalogSourceKeyValid) return
        run {
            client.pluginCatalogLoadDrive(catalogSourceKey)
            catalogSourceInput = ""
        }
    }

    SettingsCard("Pear Plugins") {
        Text(
            "Plugins are Hyperdrives with declared capabilities. An update that requests new capabilities is disabled automatically until you re-approve it. The switch disables a plugin's filter/style/script contributions without uninstalling it.",
            color = PearColors.TextMuted,
            fontSize = 12.sp,
        )

        // Installed plugins — kill switch + update + uninstall per row.
        if (loaded && plugins.isEmpty()) {
            Text("No plugins installed.", color = PearColors.TextMuted, fontSize = 12.sp)
        }
        plugins.forEach { plugin ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text(
                        plugin.name + (if (plugin.version.isNotEmpty()) " · v${plugin.version}" else ""),
                        color = PearColors.TextPrimary,
                        fontSize = 13.sp,
                    )
                    if (plugin.capabilities.isNotEmpty()) {
                        Text(
                            plugin.capabilities.joinToString(", "),
                            color = PearColors.TextMuted,
                            fontSize = 11.sp,
                        )
                    }
                    Text(
                        plugin.id.take(16) + "…" + (if (plugin.enabled) "" else " · disabled"),
                        color = PearColors.TextMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                    )
                }
                Switch(
                    checked = plugin.enabled,
                    onCheckedChange = { enabled ->
                        val client = rpc ?: return@Switch
                        run { client.pluginSetEnabled(plugin.id, enabled) }
                    },
                    enabled = rpc != null && !busy,
                )
                Spacer(Modifier.width(8.dp))
                SettingsPill(label = "Update", enabled = rpc != null && !busy) {
                    updatePlugin(plugin.id)
                }
                Spacer(Modifier.width(8.dp))
                SettingsPill(label = "Uninstall", destructive = true, enabled = rpc != null && !busy) {
                    uninstallPlugin(plugin.id)
                }
            }
        }

        // Install by drive key (same two-step consent as the catalogue path).
        Text("Install from a drive", color = PearColors.TextPrimary, fontSize = 15.sp)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SettingsTextField(
                value = installInput,
                onValueChange = { installInput = it },
                placeholder = "64-hex plugin drive key",
                enabled = rpc != null && !busy,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            SettingsPill(
                label = "Install",
                enabled = rpc != null && !busy && installKeyValid,
                onClick = {
                    installByKey(installKey)
                    installInput = ""
                },
            )
        }

        // Plugin catalog — curated seed + subscribed catalogue drives.
        // Installing still runs the grant + escalation path; the catalogue
        // itself never grants anything.
        Text("Plugin catalog", color = PearColors.TextPrimary, fontSize = 15.sp)
        Text(
            "Curated plugins and AI add-ons you can add yourself. Installing a plugin shows its declared capabilities and records your grant; app entries open as ordinary P2P apps gated by their own manifests. Load more catalogues from a drive key below.",
            color = PearColors.TextMuted,
            fontSize = 12.sp,
        )
        catalog.entries.forEach { entry ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text(
                        entry.name + (if (entry.source == "builtin" && entry.verified) " ✦" else ""),
                        color = PearColors.TextPrimary,
                        fontSize = 13.sp,
                    )
                    if (entry.description.isNotEmpty()) {
                        Text(entry.description, color = PearColors.TextMuted, fontSize = 11.sp)
                    }
                    Text(
                        (if (entry.kind == "app") "P2P app" else "plugin") +
                            (if (entry.capabilities.isNotEmpty()) " · " + entry.capabilities.joinToString(", ") else "") +
                            (if (entry.source != "builtin") " · from " + entry.source.take(8) + "…" else ""),
                        color = PearColors.TextMuted,
                        fontSize = 11.sp,
                    )
                }
                val key = entry.driveKey
                when {
                    entry.kind == "app" && key != null -> SettingsPill(
                        label = "Copy link",
                        enabled = !busy,
                        onClick = { clipboard.setText(AnnotatedString("hyper://$key/")) },
                    )
                    entry.kind == "plugin" && key != null && !entry.installed -> SettingsPill(
                        label = "Install",
                        enabled = rpc != null && !busy,
                        onClick = { installByKey(key) },
                    )
                    entry.kind == "plugin" && entry.installed -> Text(
                        "Installed",
                        color = PearColors.TextMuted,
                        fontSize = 12.sp,
                    )
                    entry.kind == "plugin" && key == null -> Text(
                        "Publish pending",
                        color = PearColors.TextMuted,
                        fontSize = 12.sp,
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SettingsTextField(
                value = catalogSourceInput,
                onValueChange = { catalogSourceInput = it },
                placeholder = "64-hex catalogue drive key",
                enabled = rpc != null && !busy,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            SettingsPill(
                label = "Load catalogue",
                enabled = rpc != null && !busy && catalogSourceKeyValid,
                onClick = ::loadCatalogSource,
            )
        }
        catalog.sources.forEach { source ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${source.name} · ${source.entryCount} entries · ${source.driveKey.take(16)}…",
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f).padding(end = 12.dp),
                )
                SettingsPill(label = "Remove", destructive = true, enabled = rpc != null && !busy) {
                    val client = rpc ?: return@SettingsPill
                    run { client.pluginCatalogRemoveSource(source.driveKey) }
                }
            }
        }

        if (!loaded && error == null) {
            Text(
                if (rpc == null) "P2P engine is not connected yet" else "Loading...",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
        }
        SettingsError(error)
    }

    // Install consent — bound to the exact reviewed snapshot. The dialog
    // echoes the requested capabilities + fingerprint back to accept; if the
    // drive changed since the preview the backend answers with a fresh
    // preview instead of installing (fail closed).
    pendingInstall?.let { preview ->
        AlertDialog(
            onDismissRequest = { pendingInstall = null },
            containerColor = PearColors.Surface,
            title = {
                Text("Install ${preview.name}?", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Text(
                    "Version ${preview.version} requests these capabilities:\n\n" +
                        preview.requested.joinToString("\n") { "• $it" } +
                        "\n\nSnapshot ${preview.fingerprint?.take(16) ?: ""}…\nGranting installs the plugin and applies only the granted capabilities.",
                    color = PearColors.TextMuted,
                    fontSize = 13.sp,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val review = preview
                        pendingInstall = null
                        installByKey(review.driveKey, review)
                    },
                ) {
                    Text("Grant and install", color = PearColors.Accent, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingInstall = null }) {
                    Text("Cancel", color = PearColors.TextMuted)
                }
            },
        )
    }

    // Escalation consent — an update requested NEW capabilities; the plugin
    // is already disabled backend-side and stays off until accepted.
    escalation?.let { esc ->
        AlertDialog(
            onDismissRequest = { escalation = null },
            containerColor = PearColors.Surface,
            title = {
                Text("Plugin requests new capabilities", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Text(
                    "This update adds:\n\n" +
                        esc.added.joinToString("\n") { "• $it" } +
                        "\n\nThe plugin is disabled until you approve." +
                        (if (esc.changedSinceReview) "\n\nIt changed after the previous review — inspect this new request before consenting." else ""),
                    color = PearColors.TextMuted,
                    fontSize = 13.sp,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val review = esc
                        escalation = null
                        updatePlugin(review.driveKey, review)
                    },
                ) {
                    Text("Accept and re-enable", color = PearColors.Accent, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { escalation = null }) {
                    Text("Keep disabled", color = PearColors.TextMuted)
                }
            },
        )
    }
}

// --- Clearnet & Privacy ----------------------------------------------------

/**
 * Mirror of the desktop Settings → "Clearnet & Privacy" card (ui/shell.js
 * PrivacyClearnetSection), scoped to the mobile RPC (Mission B2): the
 * proxied-vs-direct clearnet mode plus the privacy-ladder toggles.
 *
 * Proxied mode is the default and the only shielded path: Android WebView
 * (like WKWebView) cannot intercept subresource requests, so clearnet pages
 * load through the browser-owned /clearnet/ proxy where Content Shield and
 * the ladder (HTTPS-only upgrade, tracking-param strip, third-party cookie
 * drop, fingerprint farbling, referrer policy) are applied. Direct mode
 * loads the real https URL unshielded.
 *
 * Every toggle is a user-data settings key written via setSettings (same
 * keys as the desktop); the live snapshot reads CMD_PRIVACY_STATUS via
 * getPrivacyStatus(), which also fills defaults for never-touched keys.
 */
@Composable
private fun ClearnetPrivacySection() {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<PearPrivacyStatus?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        val client = rpc ?: return
        try {
            status = client.getPrivacyStatus()
            loaded = true
            error = null
        } catch (e: Throwable) {
            error = e.message ?: "Could not load privacy status"
        }
    }

    LaunchedEffect(rpc) { reload() }

    fun save(key: String, value: Boolean) {
        val client = rpc ?: return
        if (busy) return
        busy = true
        scope.launch {
            try {
                client.setSettings(buildJsonObject { put(key, value) })
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not update settings"
            }
            reload()
            busy = false
        }
    }

    fun setClearnetMode(mode: String) {
        val client = rpc ?: return
        if (busy) return
        busy = true
        scope.launch {
            try {
                client.setSettings(buildJsonObject { put("clearnetMode", mode) })
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not update settings"
            }
            reload()
            busy = false
        }
    }

    val s = status
    SettingsCard("Clearnet & Privacy") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Text("Zero remote data collection", color = PearColors.TextPrimary, fontSize = 15.sp)
                Text(
                    "PearBrowser ships no telemetry, crash beacons, or usage analytics. Nothing you browse is sent to a PearBrowser server — there is no PearBrowser server for that.",
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Text("Telemetry: never", color = PearColors.TextMuted, fontSize = 12.sp)
        }

        Text("Clearnet mode", color = PearColors.TextPrimary, fontSize = 15.sp)
        ModeRow(
            label = "Proxy + shield (default)",
            subtitle = "https pages load through the browser proxy so Content Shield blocks ads/trackers and the privacy ladder below applies.",
            selected = s?.clearnetMode != "direct",
            enabled = rpc != null && loaded && !busy,
            onClick = { setClearnetMode("proxy") },
        )
        ModeRow(
            label = "Direct",
            subtitle = "Load the real https URL. No shielding — WebViews cannot intercept requests, so the shield only works through the proxy.",
            selected = s?.clearnetMode == "direct",
            enabled = rpc != null && loaded && !busy,
            onClick = { setClearnetMode("direct") },
        )

        LadderToggleRow(
            label = "HTTPS-only mode",
            subtitle = "Upgrade http:// navigations to https:// before loading.",
            checked = s?.httpsOnly != false,
            enabled = rpc != null && loaded && !busy,
            onChange = { save("httpsOnly", it) },
        )
        LadderToggleRow(
            label = "Strip tracking parameters",
            subtitle = "Remove utm_*, fbclid, gclid and similar click-ids from URLs.",
            checked = s?.stripTrackingParams != false,
            enabled = rpc != null && loaded && !busy,
            onChange = { save("stripTrackingParams", it) },
        )
        LadderToggleRow(
            label = "Block third-party cookies (proxy)",
            subtitle = "Drop Set-Cookie from proxied clearnet responses so sites cannot share a jar with hyper tabs.",
            checked = s?.blockThirdPartyCookies != false,
            enabled = rpc != null && loaded && !busy,
            onChange = { save("blockThirdPartyCookies", it) },
        )
        LadderToggleRow(
            label = "Fingerprint farbling",
            subtitle = "Noise canvas/audio fingerprints on proxied pages (per-origin seed).",
            checked = s?.fingerprintFarbling != false,
            enabled = rpc != null && loaded && !busy,
            onChange = { save("fingerprintFarbling", it) },
        )

        if (s != null) {
            Text(
                "Shield: " + (if (s.contentShield) "on" else "off") +
                    (if (s.sessionProxyPort > 0) " · proxy :${s.sessionProxyPort}" else "") +
                    " · " + (if (s.clearnetMode == "direct") "direct mode" else "proxied mode"),
                color = PearColors.TextMuted,
                fontSize = 11.sp,
            )
        }
        if (!loaded && error == null) {
            Text(
                if (rpc == null) "P2P engine is not connected yet" else "Loading...",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
        }
        SettingsError(error)
    }
}

@Composable
private fun LadderToggleRow(
    label: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(label, color = PearColors.TextPrimary, fontSize = 15.sp)
            Text(
                subtitle,
                color = PearColors.TextMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

// --- Relays ----------------------------------------------------------------

@Composable
private fun RelaysSection() {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var relays by remember { mutableStateOf<List<String>>(emptyList()) }
    var relayEnabled by remember { mutableStateOf(true) }
    var relayInput by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun loadRelays() {
        val client = rpc ?: return
        try {
            val cfg = client.getRelays()
            relays = cfg.relays
            relayEnabled = cfg.enabled
            loaded = true
            error = null
        } catch (e: Throwable) {
            error = e.message ?: "Could not load relays"
        }
    }

    LaunchedEffect(rpc) { loadRelays() }

    fun setRelayEnabled(enabled: Boolean) {
        val client = rpc ?: return
        scope.launch {
            try {
                client.setRelayEnabled(enabled)
                relayEnabled = enabled
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not update relay mode"
            }
            loadRelays()
        }
    }

    fun addRelay() {
        val client = rpc ?: return
        val url = relayInput.trim().trimEnd('/')
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            error = "Relay must be an http(s) URL, e.g. https://relay.example.com"
            return
        }
        if (url.contains('?') || url.contains('#') || url.any { it.isWhitespace() }) {
            error = "Relay URLs cannot contain spaces, query strings, or fragments"
            return
        }
        if (relays.contains(url)) {
            error = "That relay is already in the list"
            return
        }
        scope.launch {
            try {
                client.setRelays(relays + url)
                relayInput = ""
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not add relay"
            }
            loadRelays()
        }
    }

    fun removeRelay(url: String) {
        val client = rpc ?: return
        if (relays.size <= 1) return // backend refuses an empty list; keep one relay
        scope.launch {
            try {
                client.setRelays(relays.filter { it != url })
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not remove relay"
            }
            loadRelays()
        }
    }

    SettingsCard("Relays") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Text(
                    if (relayEnabled) "Hybrid Fetch (on)" else "Pure P2P Mode",
                    color = PearColors.TextPrimary,
                    fontSize = 15.sp,
                )
                Text(
                    if (relayEnabled) {
                        "Relay HTTP (fast first paint) + P2P fallback."
                    } else {
                        "P2P-only. Slower first visit, no relay dependency."
                    },
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Switch(
                checked = relayEnabled,
                onCheckedChange = ::setRelayEnabled,
                enabled = rpc != null && loaded,
            )
        }

        when {
            !loaded && error == null -> Text(
                if (rpc == null) "P2P engine is not connected yet" else "Loading...",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
            relays.isEmpty() && error == null -> Text(
                "No relays configured. Add one below to speed up first paint.",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
            else -> relays.forEachIndexed { index, url ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f).padding(end = 12.dp)) {
                        Text(
                            url,
                            color = PearColors.TextPrimary,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (index == 0) {
                            Text("Primary", color = PearColors.Accent, fontSize = 10.sp)
                        }
                    }
                    if (relays.size > 1) {
                        SettingsPill(label = "Remove", destructive = true, enabled = rpc != null) {
                            removeRelay(url)
                        }
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SettingsTextField(
                value = relayInput,
                onValueChange = { relayInput = it },
                placeholder = "https://relay.example.com",
                enabled = rpc != null,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            SettingsPill(
                label = "Add",
                enabled = rpc != null && relayInput.trim().isNotEmpty(),
                onClick = ::addRelay,
            )
        }
        SettingsError(error)
    }
}

// --- Profile ---------------------------------------------------------------

@Composable
private fun ProfileSection() {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    // savedProfile is the last-known backend state; fields is the editable
    // copy. dirty tracking compares the two (see ProfileEditScreen.swift).
    var savedProfile by remember { mutableStateOf(PearProfile()) }
    var fields by remember { mutableStateOf(PearProfile()) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val dirty = fields != savedProfile

    LaunchedEffect(rpc) {
        val client = rpc ?: return@LaunchedEffect
        try {
            val profile = client.profileGet()
            savedProfile = profile
            fields = profile
            loaded = true
        } catch (e: Throwable) {
            error = e.message ?: "Could not load profile"
        }
    }

    fun save() {
        val client = rpc ?: return
        saving = true
        notice = null
        scope.launch {
            try {
                val updated = client.profileUpdate(fields.toUpdates())
                savedProfile = updated
                fields = updated
                notice = "Saved."
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Save failed"
            } finally {
                saving = false
            }
        }
    }

    fun cancel() {
        fields = savedProfile
        notice = null
    }

    SettingsCard("Your Profile") {
        Text(
            "Your profile lives on your device. Apps only see the fields you grant access to when you sign in. All fields are optional.",
            color = PearColors.TextSecondary,
            fontSize = 12.sp,
        )
        if (!loaded && error == null) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                CircularProgressIndicator(color = PearColors.Accent)
            }
        } else {
            ProfileGroupLabel("Shown to apps that ask for profile:name")
            ProfileField("Display name", fields.displayName, "Maya") { fields = fields.copy(displayName = it) }
            ProfileField("Avatar URL", fields.avatar, "hyper://... or https://...", mono = true) {
                fields = fields.copy(avatar = it)
            }
            ProfileGroupLabel("Shown to apps that ask for profile:contact")
            ProfileField("Email", fields.email, "maya@example.com") { fields = fields.copy(email = it) }
            ProfileField("Website", fields.website, "https://maya.example", mono = true) {
                fields = fields.copy(website = it)
            }
            ProfileGroupLabel("Shown with profile:read")
            ProfileField("Bio", fields.bio, "Short bio") { fields = fields.copy(bio = it) }
            ProfileField("Pronouns", fields.pronouns, "they/them") { fields = fields.copy(pronouns = it) }
            ProfileField("Location", fields.location, "Auckland") { fields = fields.copy(location = it) }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                SettingsPill(label = "Cancel", enabled = dirty && !saving, onClick = ::cancel)
                Spacer(Modifier.width(8.dp))
                SettingsPill(
                    label = if (saving) "Saving..." else "Save",
                    enabled = rpc != null && dirty && !saving,
                    onClick = ::save,
                )
            }
            notice?.let { Text(it, color = PearColors.Success, fontSize = 12.sp) }
        }
        SettingsError(error)
    }
}

@Composable
private fun ProfileGroupLabel(text: String) {
    Text(
        text.uppercase(),
        color = PearColors.TextSecondary,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(top = 6.dp),
    )
}

@Composable
private fun ProfileField(
    label: String,
    value: String,
    placeholder: String,
    mono: Boolean = false,
    onValueChange: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Text(label, color = PearColors.TextSecondary, fontSize = 12.sp)
        Spacer(Modifier.height(4.dp))
        SettingsTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = placeholder,
            mono = mono,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

// --- Trusted sites ---------------------------------------------------------

@Composable
private fun TrustedSitesSection() {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var origins by remember { mutableStateOf<List<PearTrustedOrigin>>(emptyList()) }
    var mode by remember { mutableStateOf("all") }
    var addInput by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        val client = rpc ?: return
        try {
            val result = client.trustedOriginsList()
            origins = result.origins
            mode = result.mode
            loaded = true
            error = null
        } catch (e: Throwable) {
            error = e.message ?: "Could not load trusted sites"
        }
    }

    LaunchedEffect(rpc) { reload() }

    fun setMode(next: String) {
        val client = rpc ?: return
        if (mode == next) return
        scope.launch {
            try {
                client.trustedOriginsSetMode(next)
                mode = next
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not update mode"
            }
            reload()
        }
    }

    fun addOrigin() {
        val client = rpc ?: return
        val raw = addInput.trim()
        if (raw.isEmpty()) return
        if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
            error = "Origin must be an http(s) URL, e.g. https://example.com"
            return
        }
        scope.launch {
            try {
                client.trustedOriginsAdd(raw)
                addInput = ""
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not add origin"
            }
            reload()
        }
    }

    fun removeOrigin(origin: String) {
        val client = rpc ?: return
        scope.launch {
            try {
                client.trustedOriginsRemove(origin)
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not remove origin"
            }
            reload()
        }
    }

    SettingsCard("Trusted Sites") {
        Text(
            "Choose which HTTPS sites can use the window.pear bridge.",
            color = PearColors.TextSecondary,
            fontSize = 12.sp,
        )
        ModeRow(
            label = "Inject everywhere",
            subtitle = "window.pear is available on every page (still unauthorised until you grant access). Default.",
            selected = mode == "all",
            enabled = rpc != null && loaded,
            onClick = { setMode("all") },
        )
        ModeRow(
            label = "Allow-list only",
            subtitle = "Only the sites below plus PearBrowser's own surfaces see window.pear.",
            selected = mode == "allowlist",
            enabled = rpc != null && loaded,
            onClick = { setMode("allowlist") },
        )

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SettingsTextField(
                value = addInput,
                onValueChange = { addInput = it },
                placeholder = "https://example.com",
                enabled = rpc != null,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            SettingsPill(
                label = "Add",
                enabled = rpc != null && addInput.trim().isNotEmpty(),
                onClick = ::addOrigin,
            )
        }

        when {
            !loaded && error == null -> Text(
                if (rpc == null) "P2P engine is not connected yet" else "Loading...",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
            origins.isEmpty() && error == null -> Text(
                if (mode == "all") {
                    "You haven't pinned any sites yet — Allow-list only mode would currently inject the bridge nowhere."
                } else {
                    "No trusted sites. Pages will not see window.pear until you add one."
                },
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
            else -> origins.forEach { entry ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f).padding(end = 12.dp)) {
                        Text(
                            entry.origin,
                            color = PearColors.TextPrimary,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (entry.trustedAt > 0) {
                            Text(
                                "Trusted ${formatTrustedDate(entry.trustedAt)}",
                                color = PearColors.TextMuted,
                                fontSize = 11.sp,
                            )
                        }
                    }
                    SettingsPill(label = "Remove", destructive = true, enabled = rpc != null) {
                        removeOrigin(entry.origin)
                    }
                }
            }
        }
        SettingsError(error)
    }
}

@Composable
private fun ModeRow(
    label: String,
    subtitle: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            if (selected) "◉" else "○",
            color = if (selected) PearColors.Accent else PearColors.TextMuted,
            fontSize = 15.sp,
            modifier = Modifier.padding(top = 1.dp),
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(label, color = PearColors.TextPrimary, fontSize = 15.sp)
            Text(subtitle, color = PearColors.TextMuted, fontSize = 11.sp, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

// --- Shared bits -----------------------------------------------------------

// --- Names (Mission B3) ------------------------------------------------------

/**
 * Mirror of the desktop Settings → Names section (ui/shell.js
 * NameRegistrySection): the experimentalNaming enable toggle, one form that
 * claims a new name or rotates one you already own, and the list of your
 * active names with Copy pearname:// / Release / Revoke. Names resolve in the
 * URL bar as bare words or pearname://<name> (petname → own registry →
 * trusted contacts → curated floor), first-claim-wins with a homograph guard.
 */
@Composable
private fun NamesSection() {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var loaded by remember { mutableStateOf(false) }
    var enabled by remember { mutableStateOf(false) }
    var created by remember { mutableStateOf(false) }
    var entries by remember { mutableStateOf<List<PearNameEntry>>(emptyList()) }
    var name by remember { mutableStateOf("") }
    var target by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload(client: PearRpcClient) {
        val st = client.nameregStatus()
        enabled = st.enabled
        created = st.created
        entries = if (st.enabled && st.created) client.nameregList() else emptyList()
    }

    LaunchedEffect(rpc) {
        val client = rpc ?: return@LaunchedEffect
        try {
            reload(client)
            loaded = true
        } catch (e: Throwable) {
            error = e.message ?: "Could not load names"
        }
    }

    fun setEnabled(next: Boolean) {
        val client = rpc ?: return
        scope.launch {
            try {
                client.setSettings(buildJsonObject { put("experimentalNaming", next) })
                enabled = next
                reload(client)
                error = null
            } catch (e: Throwable) {
                error = e.message ?: "Could not update settings"
            }
        }
    }

    fun submit() {
        val client = rpc ?: return
        val n = name.trim()
        val t = normalizeNameTargetInput(target)
        if (t == null) {
            error = "Enter a 64-hex drive key or pear://, hyper://, file:// link."
            return
        }
        // Re-submitting a name you own rotates (updates) its target — same
        // claim-or-update form as the desktop.
        val owned = entries.any { it.normalized.equals(n, ignoreCase = true) || it.name.equals(n, ignoreCase = true) }
        busy = "submit"
        error = null
        scope.launch {
            try {
                if (owned) client.nameregRotate(n, t) else client.nameregClaim(n, t)
                name = ""
                target = ""
                reload(client)
            } catch (e: Throwable) {
                error = e.message
            } finally {
                busy = null
            }
        }
    }

    fun act(kind: String, n: String) {
        val client = rpc ?: return
        busy = kind + n
        error = null
        scope.launch {
            try {
                when (kind) {
                    "release" -> client.nameregRelease(n)
                    else -> client.nameregRevoke(n)
                }
                reload(client)
            } catch (e: Throwable) {
                error = e.message
            } finally {
                busy = null
            }
        }
    }

    SettingsCard("Names") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Text("Names (experimental)", color = PearColors.TextPrimary, fontSize = 15.sp)
                Text(
                    "Claim memorable names that resolve to your drives or app links — type the name (or pearname://name) in the URL bar. Owner-signed, durable across devices, first-claim-wins with a homograph guard.",
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Switch(
                checked = enabled,
                onCheckedChange = ::setEnabled,
                enabled = rpc != null && loaded,
            )
        }

        if (enabled) {
            Text("Claim or update a name", color = PearColors.TextPrimary, fontSize = 14.sp)
            Text(
                "A memorable name → a drive key or app link. First claim wins; confusable look-alikes are rejected. Re-submitting a name you own updates its target.",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
            )
            SettingsTextField(
                value = name,
                onValueChange = { name = it },
                placeholder = "name (e.g. alice)",
                enabled = busy == null,
                mono = false,
                modifier = Modifier.fillMaxWidth(),
            )
            SettingsTextField(
                value = target,
                onValueChange = { target = it },
                placeholder = "64-hex key, pear://, hyper://, file://",
                enabled = busy == null,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SettingsPill(
                    label = if (busy == "submit") "Saving…" else "Save",
                    enabled = busy == null && name.trim().isNotEmpty() && normalizeNameTargetInput(target) != null,
                    onClick = ::submit,
                )
            }
            if (created && entries.isEmpty()) {
                Text("No names yet — claim one above.", color = PearColors.TextMuted, fontSize = 12.sp)
            }
            entries.forEach { entry ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(end = 12.dp)) {
                        Text(entry.name, color = PearColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "pearname://${entry.normalized} → ${shortNameTarget(entry.link ?: entry.key ?: entry.target)} · v${entry.version}",
                            color = PearColors.TextMuted,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SettingsPill(label = if (copied == entry.normalized) "Copied" else "Copy", enabled = busy == null) {
                            clipboard.setText(AnnotatedString("pearname://" + entry.normalized))
                            copied = entry.normalized
                        }
                        SettingsPill(label = "Release", enabled = busy == null) { act("release", entry.normalized) }
                        SettingsPill(label = "Revoke", enabled = busy == null, destructive = true) { act("revoke", entry.normalized) }
                    }
                }
            }
        } else {
            Text("Turn on Names to claim registry names.", color = PearColors.TextMuted, fontSize = 12.sp)
        }
        SettingsError(error)
    }
}

/** The claim-target input gate (backend/name-query.cjs normalizeNameTarget). */
private fun normalizeNameTargetInput(raw: String): String? {
    val s = raw.trim()
    if (s.isEmpty()) return null
    if (Regex("^[0-9a-f]{64}$", RegexOption.IGNORE_CASE).matches(s)) return s.lowercase()
    if (s.length <= 300 && Regex("^(?:hyper|pear|file)://.+", RegexOption.IGNORE_CASE).matches(s)) return s
    return null
}

private fun shortNameTarget(raw: String): String =
    if (raw.length > 28) raw.take(14) + "…" + raw.takeLast(10) else raw

// --- On-device AI (Ask Browser) --------------------------------------------
/**
 * Mission B4b honest-availability card. The Ask Browser side panel is NOT
 * shipped on Android while the QVAC native runtime (llama.cpp addon) is not
 * linked into the worklet — this card only reports the live state read from
 * CMD_ASK_BROWSER_CAPABILITIES. It is a status surface, not a control: no
 * toggles, no chat entry point, nothing that looks functional when gated.
 */
@Composable
private fun OnDeviceAiSection() {
    val rpc = LocalPearRpc.current

    var caps by remember { mutableStateOf<PearAskCapabilities?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(rpc) {
        val client = rpc ?: return@LaunchedEffect
        try {
            caps = client.askBrowserCapabilities()
        } catch (e: Throwable) {
            error = e.message ?: "Could not load AI capabilities"
        }
    }

    SettingsCard("On-device AI (Ask Browser)") {
        val state = caps
        when {
            state == null && error == null -> Text(
                if (rpc == null) "Backend not connected." else "Checking availability…",
                color = PearColors.TextMuted,
                fontSize = 13.sp,
            )
            state != null && state.available -> {
                Text(
                    "Available",
                    color = PearColors.Accent,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                val installed = state.models.count { it.installed }
                Text(
                    "${state.models.size} approved model(s), $installed installed. Page Q&A runs fully on-device.",
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                )
            }
            else -> {
                Text(
                    "Unavailable on this build",
                    color = PearColors.TextPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    when (state?.reason) {
                        "runtime-unavailable" ->
                            "The on-device AI runtime (llama.cpp) is not linked into this Android build, so Ask Browser is off. Nothing is sent to the cloud — when a future build links the runtime, page answers will be computed on-device only."
                        "runtime-not-configured" ->
                            "The on-device AI runtime is not configured in this build."
                        "service-closed" ->
                            "The on-device AI service is closed."
                        else ->
                            "Ask Browser is unavailable${state?.reason?.let { " ($it)" } ?: ""}."
                    },
                    color = PearColors.TextMuted,
                    fontSize = 12.sp,
                )
            }
        }
        SettingsError(error)
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(title, color = PearColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun SettingsPill(
    label: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    val color = when {
        !enabled -> PearColors.TextMuted
        destructive -> PearColors.Error
        else -> PearColors.Accent
    }
    Surface(
        color = PearColors.SurfaceElevated,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.clickable(enabled = enabled, onClick = onClick),
    ) {
        Text(
            label,
            color = color,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun SettingsTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    enabled: Boolean = true,
    mono: Boolean = true,
    modifier: Modifier = Modifier,
) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = PearColors.TextMuted, fontSize = 12.sp) },
        enabled = enabled,
        singleLine = true,
        textStyle = TextStyle(
            color = PearColors.TextPrimary,
            fontSize = 12.sp,
            fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
        ),
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrect = false,
        ),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = PearColors.SurfaceElevated,
            unfocusedContainerColor = PearColors.SurfaceElevated,
            disabledContainerColor = PearColors.SurfaceElevated,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent,
            cursorColor = PearColors.Accent,
            focusedTextColor = PearColors.TextPrimary,
            unfocusedTextColor = PearColors.TextPrimary,
            disabledTextColor = PearColors.TextMuted,
        ),
        modifier = modifier,
    )
}

@Composable
private fun SettingsError(message: String?) {
    message?.let { Text(it, color = PearColors.Error, fontSize = 12.sp) }
}

private fun formatTrustedDate(epochMs: Long): String =
    SimpleDateFormat("MMM d, yyyy", Locale.getDefault()).format(Date(epochMs))
