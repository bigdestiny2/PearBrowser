package com.pearbrowser.app.ui.screens

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.pearbrowser.app.bridge.PearWorkletEvents
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.rpc.PearRpcClient
import com.pearbrowser.app.rpc.PearSettings
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.HttpURLConnection
import java.net.URL

/**
 * ExploreScreen — catalog directory.
 *
 * The Kotlin equivalent of `app/screens/ExploreScreen.tsx`. HTTP relay
 * catalogs are fetched via HttpURLConnection; if a relay advertises a signed
 * catalog bee, the worklet verifies and streams that P2P catalog instead.
 *
 * Phase 2 ticket — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.
 */
@Composable
fun ExploreScreen(onVisit: (String) -> Unit, settings: PearSettings? = null) {
    val context = LocalContext.current
    val rpc = LocalPearRpc.current
    var sites by remember { mutableStateOf<List<Site>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var sourceUrl by remember { mutableStateOf(settings?.catalogUrl ?: "https://relay-us.p2phiverelay.xyz") }
    var activeBeeKey by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(settings?.catalogUrl) {
        settings?.catalogUrl?.takeIf { it.isNotBlank() }?.let { sourceUrl = it }
    }

    LaunchedEffect(sourceUrl, rpc) {
        loading = true
        error = null
        activeBeeKey = null
        try {
            val result = loadCatalog(sourceUrl, rpc)
            sites = result.sites
            activeBeeKey = result.activeBeeKey
        } catch (e: Throwable) {
            error = e.message ?: "Could not load catalog"
            sites = emptyList()
        } finally {
            loading = false
        }
    }

    DisposableEffect(context, activeBeeKey) {
        val key = activeBeeKey
        if (key == null) {
            onDispose {}
        } else {
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context?, intent: Intent?) {
                    if (intent?.action != PearWorkletEvents.ACTION_CATALOG_UPDATED) return
                    val updatedKey = intent.getStringExtra(PearWorkletEvents.EXTRA_CATALOG_KEY)
                        ?.lowercase()
                        ?: return
                    if (updatedKey != key) return
                    val catalogJson = intent.getStringExtra(PearWorkletEvents.EXTRA_CATALOG_JSON) ?: return
                    try {
                        val root = Json.parseToJsonElement(catalogJson).jsonObject
                        sites = sitesFromCatalog(root)
                        error = null
                    } catch (e: Throwable) {
                        error = e.message ?: "Could not apply catalog update"
                    }
                }
            }
            ContextCompat.registerReceiver(
                context,
                receiver,
                IntentFilter(PearWorkletEvents.ACTION_CATALOG_UPDATED),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            onDispose {
                try { context.unregisterReceiver(receiver) } catch (_: Throwable) {}
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PearColors.Bg)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Text(
            "Explore",
            color = PearColors.TextPrimary,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "Discover sites and tools on the P2P web",
            color = PearColors.TextSecondary,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(16.dp))

        when {
            loading -> CircularProgressIndicator(color = PearColors.Accent)
            error != null -> Text(
                "Could not load directory: $error",
                color = PearColors.Error,
                fontSize = 13.sp,
            )
            sites.isEmpty() -> Text(
                "Directory is empty.",
                color = PearColors.TextMuted,
                fontSize = 13.sp,
            )
            else -> sites.forEach { site ->
                SiteCard(site = site, onVisit = {
                    val target = site.link ?: site.driveKey?.let { "hyper://$it" }
                    if (target != null) onVisit(target)
                })
            }
        }
    }
}

@Composable
private fun SiteCard(site: Site, onVisit: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .background(PearColors.Surface, RoundedCornerShape(12.dp))
            .clickable { onVisit() }
            .padding(14.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                site.name,
                color = PearColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            if (site.description.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(site.description, color = PearColors.TextSecondary, fontSize = 12.sp)
            }
        }
        Text(
            "Visit",
            color = PearColors.Accent,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

private data class Site(
    val id: String,
    val name: String,
    val description: String,
    val driveKey: String?,
    val link: String?,
)

private data class CatalogLoadResult(
    val sites: List<Site>,
    val activeBeeKey: String? = null,
)

private suspend fun loadCatalog(base: String, rpc: PearRpcClient?): CatalogLoadResult {
    val source = base.trim()
    if (source.startsWith("http://", ignoreCase = true) || source.startsWith("https://", ignoreCase = true)) {
        val root = withContext(Dispatchers.IO) { fetchCatalogJson(source) }
        val beeKey = root.stringAt("catalogBeeKey")?.takeIf { hex64.matches(it) }?.lowercase()
        if (rpc != null && beeKey != null) {
            try {
                val beeCatalog = rpc.loadSignedCatalogBee(beeKey)
                return CatalogLoadResult(
                    sites = sitesFromCatalog(beeCatalog),
                    activeBeeKey = beeKey,
                )
            } catch (_: Throwable) {
                // Fall through to the relay JSON catalog. Signed bees fail closed
                // in the worklet, so this path never trusts partial bee data.
            }
        }
        return CatalogLoadResult(sitesFromCatalog(root))
    }

    val client = rpc ?: throw IllegalStateException("P2P engine not available. Use an https:// relay URL instead.")
    val isBee = source.startsWith("hyperbee://", ignoreCase = true)
    val key = when {
        isBee -> source.removePrefixIgnoringCase("hyperbee://")
        source.startsWith("hyper://", ignoreCase = true) -> source.removePrefixIgnoringCase("hyper://")
        else -> source
    }.trim().substringBefore('/').substringBefore('?').substringBefore('#')
    if (!hex64.matches(key)) throw IllegalArgumentException("Invalid catalog key")

    val catalog = if (isBee) client.loadCatalogBee(key) else client.loadCatalog(key)
    return CatalogLoadResult(sitesFromCatalog(catalog))
}

private fun fetchCatalogJson(base: String): JsonObject {
    val target = if (base.endsWith("/catalog.json")) base else "$base/catalog.json"
    val url = URL(target)
    val conn = url.openConnection() as HttpURLConnection
    conn.connectTimeout = 10_000
    conn.readTimeout = 10_000
    conn.requestMethod = "GET"
    conn.setRequestProperty("Accept", "application/json")
    conn.inputStream.use { stream ->
        val body = stream.bufferedReader().readText()
        return Json.parseToJsonElement(body).jsonObject
    }
}

private fun sitesFromCatalog(root: JsonObject): List<Site> {
    // Live relay catalog returns `apps`; the paginated variant returns `items`;
    // legacy registry exports may use `entries`.
    val apps: JsonElement = root["apps"] ?: root["items"] ?: root["entries"] ?: return emptyList()
    return apps.jsonArray.mapNotNull { el ->
        val obj = el.jsonObject
        val link = normalizeCatalogLink(obj.stringAt("link"))
        val driveKey = normalizeDriveKey(obj.stringAt("driveKey"))
            ?: normalizeDriveKey(obj.stringAt("appKey"))
            ?: normalizeDriveKey(obj.stringAt("key"))
            ?: driveKeyFromHyperLink(link)
        if (driveKey == null && link == null) return@mapNotNull null
        Site(
            id = obj.stringAt("id") ?: driveKey ?: link ?: return@mapNotNull null,
            name = obj.stringAt("name") ?: "Untitled",
            description = obj.stringAt("description") ?: "",
            driveKey = driveKey,
            link = link,
        )
    }
}

private val hex64 = Regex("^[0-9a-fA-F]{64}$")

private fun JsonObject.stringAt(key: String): String? {
    return this[key]?.let { element ->
        runCatching { element.jsonPrimitive.content.trim() }.getOrNull()
    }?.takeIf { it.isNotEmpty() }
}

private fun normalizeDriveKey(raw: String?): String? {
    val trimmed = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (hex64.matches(trimmed)) return trimmed.lowercase()
    return driveKeyFromHyperLink(trimmed)
}

private fun normalizeCatalogLink(raw: String?): String? {
    val trimmed = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val separator = trimmed.indexOf("://")
    if (separator <= 0) return null
    val scheme = trimmed.substring(0, separator).lowercase()
    return when (scheme) {
        "hyper" -> normalizeHyperLink(trimmed)
        "pear", "file" -> "$scheme://${trimmed.substring(separator + 3)}"
        else -> null
    }
}

private fun normalizeHyperLink(link: String): String? {
    val trimmed = link.trim()
    val separator = trimmed.indexOf("://")
    if (separator <= 0 || trimmed.substring(0, separator).lowercase() != "hyper") return null
    val rest = trimmed.substring(separator + 3)
    val keyEnd = rest.indexOfAny(charArrayOf('/', '?', '#')).let { if (it < 0) rest.length else it }
    val key = rest.substring(0, keyEnd)
    if (!hex64.matches(key)) return null
    return "hyper://${key.lowercase()}${rest.substring(keyEnd)}"
}

private fun driveKeyFromHyperLink(link: String?): String? {
    val normalized = normalizeHyperLink(link ?: "") ?: return null
    val rest = normalized.removePrefix("hyper://")
    val keyEnd = rest.indexOfAny(charArrayOf('/', '?', '#')).let { if (it < 0) rest.length else it }
    return rest.substring(0, keyEnd)
}

private fun String.removePrefixIgnoringCase(prefix: String): String =
    if (startsWith(prefix, ignoreCase = true)) substring(prefix.length) else this
