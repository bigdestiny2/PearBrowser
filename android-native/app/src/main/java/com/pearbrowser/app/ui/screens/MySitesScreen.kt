package com.pearbrowser.app.ui.screens

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.rpc.PearSite
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * MySitesScreen — mirror of ios-native `MySitesScreen.swift`.
 *
 * Lists the user's sites (CMD_LIST_SITES), creates new ones (routes into the
 * template picker, which issues CMD_CREATE_SITE), and per site: edit,
 * preview, publish/unpublish toggle (CMD_PUBLISH_SITE / CMD_UNPUBLISH_SITE),
 * share the hyper:// URL, and delete (CMD_DELETE_SITE).
 */
@Composable
fun MySitesScreen(
    onEdit: (PearSite) -> Unit,
    onPreview: (String) -> Unit,
    onCreateNew: (String) -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var sites by remember { mutableStateOf<List<PearSite>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var newName by remember { mutableStateOf("") }
    var busySiteId by remember { mutableStateOf<String?>(null) }
    var siteToDelete by remember { mutableStateOf<PearSite?>(null) }

    suspend fun load() {
        loading = true
        errorMessage = null
        val client = rpc
        if (client == null) {
            sites = emptyList()
            errorMessage = "P2P engine is not connected yet"
            loading = false
            return
        }
        try {
            sites = client.listSites()
        } catch (e: Throwable) {
            errorMessage = e.message ?: "Could not load sites"
            sites = emptyList()
        } finally {
            loading = false
        }
    }

    fun refresh() {
        scope.launch { load() }
    }

    fun publish(site: PearSite) {
        val client = rpc ?: return
        busySiteId = site.siteId
        errorMessage = null
        notice = null
        scope.launch {
            try {
                val resp = client.publishSite(site.siteId)
                val key = resp["keyHex"]?.jsonPrimitive?.contentOrNull ?: site.keyHex
                notice = "Site published! Live at hyper://${key.take(16)}…"
                load()
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not publish site"
            } finally {
                busySiteId = null
            }
        }
    }

    fun unpublish(site: PearSite) {
        val client = rpc ?: return
        busySiteId = site.siteId
        errorMessage = null
        notice = null
        scope.launch {
            try {
                client.unpublishSite(site.siteId)
                notice = "Site unpublished. It stays on this device as a draft."
                load()
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not unpublish site"
            } finally {
                busySiteId = null
            }
        }
    }

    fun delete(site: PearSite) {
        val client = rpc ?: return
        busySiteId = site.siteId
        errorMessage = null
        notice = null
        scope.launch {
            try {
                client.deleteSite(site.siteId)
                load()
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not delete site"
            } finally {
                busySiteId = null
            }
        }
    }

    fun share(site: PearSite) {
        try {
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, site.url)
            }
            context.startActivity(Intent.createChooser(shareIntent, "Share site"))
        } catch (e: Throwable) {
            errorMessage = e.message ?: "Could not share site"
        }
    }

    LaunchedEffect(rpc) { load() }

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
                "My Sites",
                color = PearColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Text(
                "Create and publish P2P websites",
                color = PearColors.TextSecondary,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(12.dp))

            // Create row — routes into the template picker (iOS onCreateNew).
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextField(
                    value = newName,
                    onValueChange = { newName = it },
                    placeholder = { Text("Site name…", color = PearColors.TextMuted, fontSize = 16.sp) },
                    singleLine = true,
                    textStyle = TextStyle(color = PearColors.TextPrimary, fontSize = 16.sp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = PearColors.Surface,
                        unfocusedContainerColor = PearColors.Surface,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        cursorColor = PearColors.Accent,
                        focusedTextColor = PearColors.TextPrimary,
                        unfocusedTextColor = PearColors.TextPrimary,
                    ),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.size(8.dp))
                val canCreate = newName.trim().isNotEmpty()
                Text(
                    "Create",
                    color = if (canCreate) PearColors.Bg else PearColors.TextMuted,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .background(
                            if (canCreate) PearColors.Accent else PearColors.Surface,
                            RoundedCornerShape(12.dp),
                        )
                        .clickable(enabled = canCreate) {
                            val name = newName.trim()
                            newName = ""
                            onCreateNew(name)
                        }
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }

            errorMessage?.let {
                Spacer(Modifier.height(12.dp))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(PearColors.Surface, RoundedCornerShape(12.dp))
                        .padding(14.dp),
                ) {
                    Text(
                        "Could not load sites",
                        color = PearColors.Error,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(it, color = PearColors.TextSecondary, fontSize = 12.sp)
                    Text(
                        "Retry",
                        color = PearColors.Accent,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier
                            .clickable { refresh() }
                            .padding(vertical = 4.dp),
                    )
                }
            }

            notice?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = PearColors.Success, fontSize = 12.sp)
            }

            Spacer(Modifier.height(12.dp))
            when {
                loading -> Row(
                    Modifier.fillMaxWidth().padding(top = 20.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator(color = PearColors.Accent)
                }
                sites.isEmpty() && errorMessage == null -> Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 40.dp),
                ) {
                    Text(
                        "</>",
                        color = PearColors.Accent,
                        fontSize = 36.sp,
                        fontFamily = FontFamily.Monospace,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "No sites yet",
                        color = PearColors.TextPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Create your first P2P website above. It will be served from your phone and available to anyone on the network.",
                        color = PearColors.TextSecondary,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                    )
                }
                else -> sites.forEach { site ->
                    SiteCard(
                        site = site,
                        busy = busySiteId == site.siteId,
                        onEdit = { onEdit(site) },
                        onPreview = { onPreview(site.url) },
                        onPublish = { publish(site) },
                        onUnpublish = { unpublish(site) },
                        onShare = { share(site) },
                        onDelete = { siteToDelete = site },
                    )
                    Spacer(Modifier.height(12.dp))
                }
            }
        }
    }

    siteToDelete?.let { site ->
        AlertDialog(
            onDismissRequest = { siteToDelete = null },
            containerColor = PearColors.Surface,
            title = { Text("Delete site?", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "\"${site.name}\" will be removed from this device.",
                    color = PearColors.TextSecondary,
                    fontSize = 14.sp,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    siteToDelete = null
                    delete(site)
                }) {
                    Text("Delete", color = PearColors.Error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { siteToDelete = null }) {
                    Text("Cancel", color = PearColors.TextSecondary)
                }
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SiteCard(
    site: PearSite,
    busy: Boolean,
    onEdit: () -> Unit,
    onPreview: () -> Unit,
    onPublish: () -> Unit,
    onUnpublish: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(PearColors.Surface, RoundedCornerShape(12.dp))
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier
                    .size(40.dp)
                    .background(PearColors.SurfaceElevated, RoundedCornerShape(10.dp)),
            ) {
                Text(
                    site.name.firstOrNull()?.uppercase() ?: "?",
                    color = PearColors.Accent,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.size(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    site.name,
                    color = PearColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "${if (site.published) "Live" else "Draft"} · hyper://${site.keyHex.take(8)}…",
                    color = PearColors.TextMuted,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
            Text(
                if (site.published) "Live" else "Draft",
                color = if (site.published) PearColors.Success else PearColors.TextMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .background(
                        if (site.published) Color(0xFF176345) else PearColors.SurfaceElevated,
                        RoundedCornerShape(8.dp),
                    )
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SiteAction("Edit", onClick = onEdit)
            SiteAction("Preview", onClick = onPreview)
            if (site.published) {
                SiteAction(if (busy) "…" else "Unpublish", enabled = !busy, onClick = onUnpublish)
                SiteAction("Share", onClick = onShare)
            } else {
                SiteAction(if (busy) "…" else "Publish", prominent = true, enabled = !busy, onClick = onPublish)
            }
            SiteAction("Delete", destructive = true, enabled = !busy, onClick = onDelete)
        }
    }
}

@Composable
private fun SiteAction(
    label: String,
    prominent: Boolean = false,
    destructive: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val color = when {
        !enabled -> PearColors.TextMuted
        destructive -> PearColors.Error
        prominent -> PearColors.Bg
        else -> PearColors.TextSecondary
    }
    Text(
        label,
        color = color,
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
        modifier = Modifier
            .background(
                if (prominent) PearColors.Accent else PearColors.SurfaceElevated,
                RoundedCornerShape(8.dp),
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}
