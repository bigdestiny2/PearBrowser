package com.pearbrowser.app.ui.screens

import android.text.format.DateUtils
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

private data class LoginGrant(
    val driveKeyHex: String,
    val appName: String,
    val scopes: List<String>,
    val grantedAt: Long,
    val expiresAt: Long,
)

private data class SwarmTopicGrant(
    val driveKey: String,
    val topicHex: String,
    val appName: String,
    val protocolName: String,
    val grantedAt: Long,
    val lastUsedAt: Long,
)

@Composable
fun ConnectedAppsScreen(onBack: () -> Unit) {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var loginGrants by remember { mutableStateOf<List<LoginGrant>>(emptyList()) }
    var swarmGrants by remember { mutableStateOf<List<SwarmTopicGrant>>(emptyList()) }
    var showRevokeAllConfirm by remember { mutableStateOf(false) }
    var loginGrantToRevoke by remember { mutableStateOf<LoginGrant?>(null) }
    var swarmGrantToRevoke by remember { mutableStateOf<SwarmTopicGrant?>(null) }
    var revokingId by remember { mutableStateOf<String?>(null) }

    suspend fun loadGrants() {
        loading = true
        errorMessage = null
        val client = rpc
        if (client == null) {
            errorMessage = "P2P engine is not connected yet"
            loginGrants = emptyList()
            swarmGrants = emptyList()
            loading = false
            return
        }
        try {
            loginGrants = client.loginListGrants().toLoginGrants()
            swarmGrants = client.swarmListGrants().toSwarmTopicGrants()
        } catch (e: Throwable) {
            errorMessage = e.message ?: "Could not load connected apps"
            loginGrants = emptyList()
            swarmGrants = emptyList()
        } finally {
            loading = false
        }
    }

    fun refresh() {
        scope.launch { loadGrants() }
    }

    fun revokeLogin(grant: LoginGrant) {
        scope.launch {
            revokingId = grant.driveKeyHex
            try {
                rpc?.loginRevokeGrant(grant.driveKeyHex)
                loadGrants()
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not revoke sign-in"
            } finally {
                revokingId = null
            }
        }
    }

    fun revokeSwarm(grant: SwarmTopicGrant) {
        scope.launch {
            revokingId = grant.id
            try {
                rpc?.swarmRevokeGrant(grant.driveKey, grant.topicHex)
                loadGrants()
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not revoke topic grant"
            } finally {
                revokingId = null
            }
        }
    }

    fun revokeAllLoginGrants() {
        scope.launch {
            revokingId = "all-login"
            try {
                rpc?.loginRevokeAll()
                loadGrants()
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not revoke sign-ins"
            } finally {
                revokingId = null
            }
        }
    }

    LaunchedEffect(rpc) {
        loadGrants()
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PearColors.Bg),
    ) {
        ConnectedAppsHeader(
            onBack = onBack,
            showRevokeAll = loginGrants.isNotEmpty(),
            revokeAllEnabled = !loading && revokingId == null,
            onRevokeAll = { showRevokeAllConfirm = true },
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { Explainer() }

            when {
                loading -> item { LoadingState() }
                errorMessage != null -> item {
                    ErrorState(
                        message = errorMessage ?: "Could not load connected apps",
                        onRetry = ::refresh,
                    )
                }
                loginGrants.isEmpty() && swarmGrants.isEmpty() -> item { EmptyState() }
                else -> {
                    if (loginGrants.isNotEmpty()) {
                        item { SectionLabel("Sign-in grants") }
                        items(loginGrants, key = { it.driveKeyHex }) { grant ->
                            LoginGrantCard(
                                grant = grant,
                                revoking = revokingId == grant.driveKeyHex,
                                onRevoke = { loginGrantToRevoke = grant },
                            )
                        }
                    }

                    if (swarmGrants.isNotEmpty()) {
                        item {
                            SectionLabel(
                                text = "Swarm topic grants",
                                modifier = Modifier.padding(top = if (loginGrants.isEmpty()) 0.dp else 10.dp),
                            )
                        }
                        items(swarmGrants, key = { it.id }) { grant ->
                            SwarmGrantCard(
                                grant = grant,
                                revoking = revokingId == grant.id,
                                onRevoke = { swarmGrantToRevoke = grant },
                            )
                        }
                    }
                }
            }
        }
    }

    if (showRevokeAllConfirm) {
        AlertDialog(
            onDismissRequest = { showRevokeAllConfirm = false },
            containerColor = PearColors.Surface,
            title = {
                Text("Revoke all app sign-ins?", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Text(
                    "Every app signed in with PearBrowser will be logged out. Apps can ask to sign in again later.",
                    color = PearColors.TextSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showRevokeAllConfirm = false
                        revokeAllLoginGrants()
                    },
                ) {
                    Text("Revoke all", color = PearColors.Error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showRevokeAllConfirm = false }) {
                    Text("Cancel", color = PearColors.TextSecondary)
                }
            },
        )
    }

    loginGrantToRevoke?.let { grant ->
        AlertDialog(
            onDismissRequest = { loginGrantToRevoke = null },
            containerColor = PearColors.Surface,
            title = {
                Text("Revoke sign-in?", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Text("${grant.appName} will be signed out immediately.", color = PearColors.TextSecondary)
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        loginGrantToRevoke = null
                        revokeLogin(grant)
                    },
                ) {
                    Text("Revoke", color = PearColors.Error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { loginGrantToRevoke = null }) {
                    Text("Cancel", color = PearColors.TextSecondary)
                }
            },
        )
    }

    swarmGrantToRevoke?.let { grant ->
        AlertDialog(
            onDismissRequest = { swarmGrantToRevoke = null },
            containerColor = PearColors.Surface,
            title = {
                Text("Revoke topic access?", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Text("${grant.appName} will need approval before joining this topic again.", color = PearColors.TextSecondary)
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        swarmGrantToRevoke = null
                        revokeSwarm(grant)
                    },
                ) {
                    Text("Revoke", color = PearColors.Error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { swarmGrantToRevoke = null }) {
                    Text("Cancel", color = PearColors.TextSecondary)
                }
            },
        )
    }
}

@Composable
private fun ConnectedAppsHeader(
    onBack: () -> Unit,
    showRevokeAll: Boolean,
    revokeAllEnabled: Boolean,
    onRevokeAll: () -> Unit,
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
            "Connected Apps",
            color = PearColors.TextPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f),
        )
        if (showRevokeAll) {
            TextButton(
                onClick = onRevokeAll,
                enabled = revokeAllEnabled,
                colors = ButtonDefaults.textButtonColors(
                    contentColor = PearColors.Error,
                    disabledContentColor = PearColors.TextMuted,
                ),
            ) {
                Text("Revoke all", fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        } else {
            Spacer(Modifier.width(88.dp))
        }
    }
}

@Composable
private fun Explainer() {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            "Apps you sign into with PearBrowser get a stable per-app identity, never your root device key.",
            color = PearColors.TextSecondary,
            fontSize = 13.sp,
            lineHeight = 18.sp,
        )
        Text(
            "Apps that ask for arbitrary peer-network topics are listed separately so network access can be revoked too.",
            color = PearColors.TextSecondary,
            fontSize = 13.sp,
            lineHeight = 18.sp,
        )
    }
}

@Composable
private fun LoadingState() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(top = 44.dp),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = PearColors.Accent)
    }
}

@Composable
private fun ErrorState(message: String, onRetry: () -> Unit) {
    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Could not load grants", color = PearColors.Error, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Text(message, color = PearColors.TextSecondary, fontSize = 12.sp)
            TextButton(onClick = onRetry, contentPadding = PaddingValues(horizontal = 0.dp)) {
                Text("Retry", color = PearColors.Accent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun EmptyState() {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 58.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("No connected apps", color = PearColors.TextPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text(
            "Approved sign-ins and direct swarm topic grants will appear here.",
            color = PearColors.TextSecondary,
            fontSize = 13.sp,
        )
    }
}

@Composable
private fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        color = PearColors.TextSecondary,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = modifier,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LoginGrantCard(
    grant: LoginGrant,
    revoking: Boolean,
    onRevoke: () -> Unit,
) {
    GrantSurface {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GrantAvatar(label = grant.appName.firstOrNull()?.uppercase() ?: "?")
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    grant.appName,
                    color = PearColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "Signed in ${relative(grant.grantedAt)} - expires ${relative(grant.expiresAt)}",
                    color = PearColors.TextMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        if (grant.scopes.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                grant.scopes.forEach { scope ->
                    GrantChip(scopeLabel(scope))
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                shortHex(grant.driveKeyHex),
                color = PearColors.TextMuted,
                fontFamily = FontFamily.Monospace,
                fontSize = 10.sp,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onRevoke, enabled = !revoking) {
                Text(if (revoking) "Revoking..." else "Revoke", color = PearColors.Error, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun SwarmGrantCard(
    grant: SwarmTopicGrant,
    revoking: Boolean,
    onRevoke: () -> Unit,
) {
    GrantSurface {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GrantAvatar(label = "P2P")
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    grant.appName,
                    color = PearColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "Allowed ${relative(grant.grantedAt)} - used ${relative(grant.lastUsedAt)}",
                    color = PearColors.TextMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        GrantChip(grant.protocolName)

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                shortHex(grant.topicHex),
                color = PearColors.TextMuted,
                fontFamily = FontFamily.Monospace,
                fontSize = 10.sp,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onRevoke, enabled = !revoking) {
                Text(if (revoking) "Revoking..." else "Revoke", color = PearColors.Error, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun GrantSurface(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

@Composable
private fun GrantAvatar(label: String) {
    Box(
        modifier = Modifier
            .size(44.dp)
            .background(PearColors.SurfaceElevated, RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = PearColors.Accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun GrantChip(text: String) {
    Surface(color = PearColors.SurfaceElevated, shape = RoundedCornerShape(999.dp)) {
        Text(
            text,
            color = PearColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

private val SwarmTopicGrant.id: String
    get() = "$driveKey:$topicHex"

private fun JsonArray.toLoginGrants(): List<LoginGrant> =
    mapNotNull { entry ->
        val obj = entry as? JsonObject ?: entry.jsonObjectOrNull() ?: return@mapNotNull null
        val driveKey = obj.string("driveKeyHex") ?: return@mapNotNull null
        LoginGrant(
            driveKeyHex = driveKey,
            appName = obj.string("appName") ?: "Unknown app",
            scopes = obj.stringArray("scopes"),
            grantedAt = obj.longMs("grantedAt"),
            expiresAt = obj.longMs("expiresAt"),
        )
    }

private fun JsonArray.toSwarmTopicGrants(): List<SwarmTopicGrant> =
    mapNotNull { entry ->
        val obj = entry as? JsonObject ?: entry.jsonObjectOrNull() ?: return@mapNotNull null
        val driveKey = obj.string("driveKey") ?: return@mapNotNull null
        val topicHex = obj.string("topicHex") ?: return@mapNotNull null
        SwarmTopicGrant(
            driveKey = driveKey,
            topicHex = topicHex,
            appName = obj.string("appName") ?: "Unknown app",
            protocolName = obj.string("protocol") ?: "pear.swarm.v1",
            grantedAt = obj.longMs("grantedAt"),
            lastUsedAt = obj.longMs("lastUsedAt"),
        )
    }

private fun JsonElement.jsonObjectOrNull(): JsonObject? =
    try {
        jsonObject
    } catch (_: Throwable) {
        null
    }

private fun JsonObject.string(key: String): String? =
    this[key]?.jsonPrimitive?.contentOrNull

private fun JsonObject.stringArray(key: String): List<String> =
    when (val value = this[key]) {
        is JsonArray -> value.jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull }
        else -> emptyList()
    }

private fun JsonObject.longMs(key: String): Long {
    val primitive = this[key]?.jsonPrimitive ?: return 0L
    return primitive.longOrNull ?: primitive.doubleOrNull?.toLong() ?: 0L
}

private fun relative(epochMs: Long): String {
    if (epochMs <= 0) return "unknown"
    return DateUtils.getRelativeTimeSpanString(
        epochMs,
        System.currentTimeMillis(),
        DateUtils.MINUTE_IN_MILLIS,
        DateUtils.FORMAT_ABBREV_RELATIVE,
    ).toString()
}

private fun shortHex(hex: String): String =
    if (hex.length <= 12) hex else hex.take(12) + "..."

private fun scopeLabel(scope: String): String =
    when (scope) {
        "profile:read" -> "Full profile"
        "profile:name" -> "Name + avatar"
        "profile:contact" -> "Contact info"
        "contacts:read" -> "Contacts"
        "pay" -> "Payments"
        else -> scope
    }
