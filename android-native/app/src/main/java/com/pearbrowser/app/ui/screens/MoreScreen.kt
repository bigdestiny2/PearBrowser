package com.pearbrowser.app.ui.screens

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.rpc.PearRpcBindingState
import com.pearbrowser.app.rpc.PearRpcStatus
import com.pearbrowser.app.rpc.PearSettings
import com.pearbrowser.app.ui.theme.PearColors

/**
 * MoreScreen — hub for bookmarks, history, settings, identity.
 * The Connected Apps route is live; the remaining sections are still
 * scaffolded while native shell parity lands.
 */
@Composable
fun MoreScreen(
    status: PearRpcStatus?,
    settings: PearSettings?,
    bindingState: PearRpcBindingState,
    onOpenConnectedApps: () -> Unit,
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
            title = "Connected Apps",
            subtitle = "Review sign-ins and swarm topic grants",
            onClick = onOpenConnectedApps,
        )
        Spacer(Modifier.height(12.dp))
        StatusSection(status = status, bindingState = bindingState)
        Spacer(Modifier.height(12.dp))
        SettingsSection(settings = settings)
        Spacer(Modifier.height(12.dp))
        Text(
            "Bookmarks, history, sites, identity - native screens are next.",
            color = PearColors.TextSecondary,
            fontSize = 14.sp,
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
private fun SettingsSection(settings: PearSettings?) {
    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                "Settings",
                color = PearColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(10.dp))
            StatusRow("Private Mode", if (settings?.privateMode == true) "On" else "Off")
            StatusRow("Default Tab", settings?.defaultTab ?: "home")
            StatusRow("Catalog", settings?.catalogUrl ?: "Loading")
            StatusRow("Catalog Sources", "${settings?.catalogList?.size ?: 0}")
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
