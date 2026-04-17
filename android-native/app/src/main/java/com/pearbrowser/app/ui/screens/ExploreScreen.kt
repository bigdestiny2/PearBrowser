package com.pearbrowser.app.ui.screens

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
 * The Kotlin equivalent of `app/screens/ExploreScreen.tsx`. In this first
 * pass we only support HTTP(S) catalog URLs (fetched via HttpURLConnection).
 * The worklet-backed Hyperbee/Hyperdrive paths (via PearRpc.loadCatalog and
 * loadCatalogBee) will be wired in once the service reports READY in the
 * follow-up pass.
 *
 * Phase 2 ticket — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.
 */
@Composable
fun ExploreScreen(onVisit: (String) -> Unit) {
    var sites by remember { mutableStateOf<List<Site>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var sourceUrl by remember { mutableStateOf("https://relay-us.p2phiverelay.xyz") }

    LaunchedEffect(sourceUrl) {
        loading = true
        error = null
        try {
            sites = withContext(Dispatchers.IO) { fetchCatalog(sourceUrl) }
        } catch (e: Throwable) {
            error = e.message ?: "Could not load catalog"
            sites = emptyList()
        } finally {
            loading = false
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
                    val relayBase = sourceUrl.removeSuffix("/catalog.json")
                    onVisit("$relayBase/v1/hyper/${site.driveKey}/index.html")
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
    val driveKey: String,
)

private fun fetchCatalog(base: String): List<Site> {
    val target = if (base.endsWith("/catalog.json")) base else "$base/catalog.json"
    val url = URL(target)
    val conn = url.openConnection() as HttpURLConnection
    conn.connectTimeout = 10_000
    conn.readTimeout = 10_000
    conn.requestMethod = "GET"
    conn.setRequestProperty("Accept", "application/json")
    conn.inputStream.use { stream ->
        val body = stream.bufferedReader().readText()
        val root = Json.parseToJsonElement(body).jsonObject
        val apps: JsonElement = root["apps"] ?: return emptyList()
        return apps.jsonArray.mapNotNull { el ->
            val obj = el.jsonObject
            val driveKey = obj["driveKey"]?.jsonPrimitive?.content ?: return@mapNotNull null
            Site(
                id = obj["id"]?.jsonPrimitive?.content ?: driveKey,
                name = obj["name"]?.jsonPrimitive?.content ?: "Untitled",
                description = obj["description"]?.jsonPrimitive?.content ?: "",
                driveKey = driveKey,
            )
        }
    }
}
