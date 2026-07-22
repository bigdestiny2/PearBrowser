package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.rpc.PearRpcBindingState
import com.pearbrowser.app.rpc.PearRpcStatus
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * MoreScreen — hub for sites, bookmarks, history, settings, identity.
 * The My Sites, Connected Apps, Bookmarks, History, and Settings routes are
 * live; the identity section hosts the device-link invite flow (manual paste
 * or QR scan via [onScanInviteQr]).
 */
@Composable
fun MoreScreen(
    status: PearRpcStatus?,
    bindingState: PearRpcBindingState,
    onOpenConnectedApps: () -> Unit,
    onOpenBookmarks: () -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSites: () -> Unit,
    onScanInviteQr: () -> Unit,
    pendingInvite: String?,
    onInviteHandled: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(PearColors.Bg)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Text("More", color = PearColors.TextPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        MoreMenuItem(
            title = "My Sites",
            subtitle = "Create and manage P2P websites",
            onClick = onOpenSites,
        )
        Spacer(Modifier.height(8.dp))
        MoreMenuItem(
            title = "Connected Apps",
            subtitle = "Review sign-ins and swarm topic grants",
            onClick = onOpenConnectedApps,
        )
        Spacer(Modifier.height(8.dp))
        MoreMenuItem(
            title = "Bookmarks",
            subtitle = "Saved sites, synced across your devices",
            onClick = onOpenBookmarks,
        )
        Spacer(Modifier.height(8.dp))
        MoreMenuItem(
            title = "History",
            subtitle = "Recently visited sites (opt-in)",
            onClick = onOpenHistory,
        )
        Spacer(Modifier.height(8.dp))
        MoreMenuItem(
            title = "Search",
            subtitle = "Local-first search over pages you've opened (opt-in)",
            onClick = onOpenSearch,
        )
        Spacer(Modifier.height(8.dp))
        MoreMenuItem(
            title = "Settings",
            subtitle = "Relays, profile, trusted sites, privacy",
            onClick = onOpenSettings,
        )
        Spacer(Modifier.height(12.dp))
        StatusSection(status = status, bindingState = bindingState)
        Spacer(Modifier.height(12.dp))
        IdentitySection(
            bindingState = bindingState,
            onScanInviteQr = onScanInviteQr,
            pendingInvite = pendingInvite,
            onInviteHandled = onInviteHandled,
        )
    }
}

@Composable
private fun IdentitySection(
    bindingState: PearRpcBindingState,
    onScanInviteQr: () -> Unit,
    pendingInvite: String?,
    onInviteHandled: () -> Unit,
) {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val connected = rpc != null && bindingState.connected

    var busy by remember { mutableStateOf<String?>(null) }
    var backupPhrase by remember { mutableStateOf("") }
    var restoreInput by remember { mutableStateOf("") }
    var linkInvite by remember { mutableStateOf("") }
    var linkJoinInput by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showRestoreConfirm by remember { mutableStateOf(false) }
    var showLinkConfirm by remember { mutableStateOf(false) }

    // A scanned device-link invite (QR scanner in DeviceLink mode) prefills
    // the manual field and opens the same confirm dialog as pasting.
    LaunchedEffect(pendingInvite) {
        val invite = pendingInvite?.trim().orEmpty()
        if (invite.isNotEmpty()) {
            linkJoinInput = invite
            showLinkConfirm = true
            onInviteHandled()
        }
    }

    fun loadBackupPhrase() {
        val client = rpc ?: return
        busy = "backup"
        notice = null
        error = null
        scope.launch {
            try {
                backupPhrase = client.exportPhrase()
                notice = "Backup phrase loaded. Copy it only somewhere private."
            } catch (e: Throwable) {
                error = e.message ?: "Could not load backup phrase"
            } finally {
                busy = null
            }
        }
    }

    fun restorePhrase() {
        val client = rpc ?: return
        val phrase = restoreInput.trim().replace(Regex("\\s+"), " ")
        if (phrase.isEmpty()) return
        busy = "restore"
        notice = null
        error = null
        scope.launch {
            try {
                if (!client.validatePhrase(phrase)) {
                    error = "That is not a valid 12 or 24-word BIP-39 phrase."
                } else {
                    client.importPhrase(phrase)
                    restoreInput = ""
                    notice = "Identity restored. Close and reopen PearBrowser for it to take effect."
                }
            } catch (e: Throwable) {
                error = e.message ?: "Could not restore identity"
            } finally {
                busy = null
            }
        }
    }

    fun createLinkInvite() {
        val client = rpc ?: return
        busy = "link-invite"
        notice = null
        error = null
        scope.launch {
            try {
                val res = client.deviceLinkCreateInvite()
                linkInvite = res["invite"]?.jsonPrimitive?.contentOrNull ?: ""
                notice = "Invite created. Paste it into your other device now."
            } catch (e: Throwable) {
                error = e.message ?: "Could not create device-link invite"
            } finally {
                busy = null
            }
        }
    }

    fun joinLinkInvite() {
        val client = rpc ?: return
        val invite = linkJoinInput.trim()
        if (invite.isEmpty()) return
        busy = "link-join"
        notice = null
        error = null
        scope.launch {
            try {
                client.deviceLinkJoin(invite, "Android phone")
                linkJoinInput = ""
                notice = "Device linked. Close and reopen PearBrowser for the linked identity to take effect."
            } catch (e: Throwable) {
                error = e.message ?: "Could not link this device"
            } finally {
                busy = null
            }
        }
    }

    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                "Identity",
                color = PearColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Backup, restore, or move your 24-word BIP-39 identity with blind-pairing.",
                color = PearColors.TextSecondary,
                fontSize = 13.sp,
            )
            if (!connected) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "P2P engine is not connected yet.",
                    color = PearColors.Warning,
                    fontSize = 12.sp,
                )
            }

            Spacer(Modifier.height(12.dp))
            IdentityActionRow(
                title = "Backup Phrase",
                subtitle = "View your 24-word BIP-39 seed phrase. Save it offline.",
                action = if (backupPhrase.isBlank()) "Reveal" else "Hide",
                enabled = connected && busy != "backup",
                onClick = {
                    if (backupPhrase.isBlank()) loadBackupPhrase() else backupPhrase = ""
                },
            )
            if (backupPhrase.isNotBlank()) {
                SecretBox(
                    text = backupPhrase,
                    warning = "Anyone with these words controls your identity.",
                    copyLabel = "Copy Phrase",
                    onCopy = {
                        clipboard.setText(AnnotatedString(backupPhrase))
                        notice = "Backup phrase copied."
                    },
                )
            }

            Spacer(Modifier.height(12.dp))
            Text("Restore from Phrase", color = PearColors.TextPrimary, fontSize = 15.sp)
            Text(
                "Replace this device's identity with one restored from a saved 24-word phrase. Legacy 12-word BIP-39 phrases are also accepted.",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
            )
            IdentityTextField(
                value = restoreInput,
                onValueChange = { restoreInput = it },
                placeholder = "Paste 12 or 24-word backup phrase",
                enabled = connected && busy != "restore",
            )
            ActionPill(
                label = if (busy == "restore") "Restoring..." else "Restore Identity",
                enabled = connected && restoreInput.trim().isNotEmpty() && busy != "restore",
                destructive = true,
                onClick = { showRestoreConfirm = true },
            )

            Spacer(Modifier.height(14.dp))
            IdentityActionRow(
                title = "Link a Device",
                subtitle = "Create a one-time blind-pairing invite for your other device.",
                action = if (busy == "link-invite") "Creating..." else "Invite",
                enabled = connected && busy != "link-invite",
                onClick = { createLinkInvite() },
            )
            if (linkInvite.isNotBlank()) {
                SecretBox(
                    text = linkInvite,
                    warning = "One-time invite. Anyone who receives it can adopt your identity.",
                    copyLabel = "Copy Invite",
                    onCopy = {
                        clipboard.setText(AnnotatedString(linkInvite))
                        notice = "Invite copied. Paste it into your other device now."
                    },
                )
            }

            Spacer(Modifier.height(12.dp))
            Text("Link this device", color = PearColors.TextPrimary, fontSize = 15.sp)
            Text(
                "Paste an invite from your other device to adopt its identity here.",
                color = PearColors.TextMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
            )
            IdentityTextField(
                value = linkJoinInput,
                onValueChange = { linkJoinInput = it },
                placeholder = "Paste device-link invite",
                enabled = connected && busy != "link-join",
            )
            ActionPill(
                label = if (busy == "link-join") "Linking..." else "Link This Device",
                enabled = connected && linkJoinInput.trim().isNotEmpty() && busy != "link-join",
                destructive = true,
                onClick = { showLinkConfirm = true },
            )
            Spacer(Modifier.height(8.dp))
            ActionPill(
                label = "Scan Invite QR",
                enabled = connected && busy != "link-join",
                onClick = onScanInviteQr,
            )

            notice?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = PearColors.Success, fontSize = 12.sp)
            }
            error?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = PearColors.Error, fontSize = 12.sp)
            }
        }
    }

    if (showRestoreConfirm) {
        AlertDialog(
            onDismissRequest = { showRestoreConfirm = false },
            containerColor = PearColors.Surface,
            title = { Text("Replace this identity?", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "Restoring will replace this device identity. Save this device backup phrase first if you still need it.",
                    color = PearColors.TextSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showRestoreConfirm = false
                    restorePhrase()
                }) {
                    Text("Restore", color = PearColors.Error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showRestoreConfirm = false }) {
                    Text("Cancel", color = PearColors.TextSecondary)
                }
            },
        )
    }

    if (showLinkConfirm) {
        AlertDialog(
            onDismissRequest = { showLinkConfirm = false },
            containerColor = PearColors.Surface,
            title = { Text("Replace this identity?", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "Linking will replace this device identity with the one from your other device. Save this device backup phrase first if you still need it.",
                    color = PearColors.TextSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showLinkConfirm = false
                    joinLinkInvite()
                }) {
                    Text("Link Device", color = PearColors.Error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLinkConfirm = false }) {
                    Text("Cancel", color = PearColors.TextSecondary)
                }
            },
        )
    }
}

@Composable
private fun IdentityActionRow(
    title: String,
    subtitle: String,
    action: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, color = PearColors.TextPrimary, fontSize = 15.sp)
            Text(subtitle, color = PearColors.TextMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
        }
        ActionPill(label = action, enabled = enabled, onClick = onClick)
    }
}

@Composable
private fun IdentityTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    enabled: Boolean,
) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = PearColors.TextMuted, fontSize = 12.sp) },
        enabled = enabled,
        textStyle = TextStyle(
            color = PearColors.TextPrimary,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
        ),
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrectEnabled = false,
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
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun SecretBox(
    text: String,
    warning: String,
    copyLabel: String,
    onCopy: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .background(PearColors.SurfaceElevated, RoundedCornerShape(10.dp))
            .padding(12.dp),
    ) {
        Text(
            text,
            color = PearColors.Warning,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
        )
        Spacer(Modifier.height(8.dp))
        ActionPill(label = copyLabel, enabled = true, onClick = onCopy)
        Spacer(Modifier.height(6.dp))
        Text(warning, color = PearColors.Error, fontSize = 11.sp)
    }
}

@Composable
private fun ActionPill(
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
private fun StatusSection(status: PearRpcStatus?, bindingState: PearRpcBindingState) {
    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                "Connection Status",
                color = PearColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(10.dp))
            StatusRow(
                label = "Worklet Service",
                value = when {
                    bindingState.connected -> "Bound"
                    bindingState.connecting -> "Starting"
                    else -> "Offline"
                },
                valueColor = if (bindingState.connected) PearColors.Success else PearColors.Warning,
            )
            StatusRow(
                label = "DHT Network",
                value = if (status?.dhtConnected == true) "Connected" else "Disconnected",
                valueColor = if (status?.dhtConnected == true) PearColors.Success else PearColors.TextSecondary,
            )
            StatusRow("Active Peers", (status?.peerCount ?: 0).toString())
            StatusRow(
                "Local Proxy",
                status?.proxyPort?.takeIf { it > 0 }?.let { "Port $it" } ?: "Not running",
            )
            StatusRow("Browse Drives", (status?.browseDrives ?: 0).toString())
            StatusRow("Installed Apps", (status?.installedApps ?: 0).toString())
            StatusRow("Published Sites", (status?.publishedSites ?: 0).toString())
            if ((status?.storageLimit ?: 0) > 0) {
                StatusRow(
                    "Storage Used",
                    "${formatBytes(status?.storageUsed ?: 0)} / ${formatBytes(status?.storageLimit ?: 0)}",
                )
            }
        }
    }
}

@Composable
private fun StatusRow(
    label: String,
    value: String,
    valueColor: Color = PearColors.TextSecondary,
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            color = PearColors.TextSecondary,
            fontSize = 13.sp,
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            color = valueColor,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(start = 12.dp),
        )
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = listOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit += 1
    }
    return if (unit == 0) {
        "${value.toLong()} ${units[unit]}"
    } else {
        "%.1f %s".format(value, units[unit])
    }
}

@Composable
private fun MoreMenuItem(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                title,
                color = PearColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                subtitle,
                color = PearColors.TextSecondary,
                fontSize = 13.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
