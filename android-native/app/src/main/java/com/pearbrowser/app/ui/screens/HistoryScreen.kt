package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import com.pearbrowser.app.rpc.PearHistoryEntry
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * HistoryScreen — mirror of ios-native `HistoryScreen.swift`.
 *
 * Pulls the last 200 visited URLs from the Hyperbee user-data store and
 * groups them by day (Today / Yesterday / <weekday> / <date>).
 *
 * History recording is opt-in and OFF by default (privacy). When the list
 * is empty the screen explains that and offers a toggle backed by the
 * `historyEnabled` user-data setting — see BrowseScreen for the recording
 * side of that flag.
 */
@Composable
fun HistoryScreen(onOpen: (String) -> Unit, onBack: () -> Unit) {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var entries by remember { mutableStateOf<List<PearHistoryEntry>>(emptyList()) }
    var historyEnabled by remember { mutableStateOf(false) }
    var showClearConfirm by remember { mutableStateOf(false) }

    suspend fun loadHistory() {
        loading = true
        errorMessage = null
        val client = rpc
        if (client == null) {
            errorMessage = "P2P engine is not connected yet"
            entries = emptyList()
            loading = false
            return
        }
        try {
            historyEnabled = try { client.getSettings().historyEnabled } catch (_: Throwable) { false }
            entries = client.listHistory(limit = 200)
        } catch (e: Throwable) {
            errorMessage = e.message ?: "Could not load history"
            entries = emptyList()
        } finally {
            loading = false
        }
    }

    fun refresh() {
        scope.launch { loadHistory() }
    }

    fun setHistoryEnabled(enabled: Boolean) {
        val client = rpc ?: return
        scope.launch {
            try {
                client.setSettings(buildJsonObject { put("historyEnabled", enabled) })
                historyEnabled = enabled
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not update settings"
            }
        }
    }

    fun clear() {
        scope.launch {
            try {
                rpc?.clearHistory()
                loadHistory()
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not clear history"
            }
        }
    }

    LaunchedEffect(rpc) {
        loadHistory()
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
                "History",
                color = PearColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            if (entries.isNotEmpty()) {
                TextButton(onClick = { showClearConfirm = true }) {
                    Text("Clear", color = PearColors.Error, fontSize = 14.sp)
                }
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
        ) {
            when {
                loading -> item {
                    Box(
                        Modifier.fillMaxWidth().padding(top = 44.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(color = PearColors.Accent)
                    }
                }
                errorMessage != null -> item {
                    Column(
                        Modifier.fillMaxWidth().padding(top = 44.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "Could not load history: ${errorMessage ?: ""}",
                            color = PearColors.Error,
                            fontSize = 13.sp,
                        )
                        TextButton(onClick = ::refresh) {
                            Text("Retry", color = PearColors.Accent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                entries.isEmpty() -> item {
                    Column(
                        Modifier.fillMaxWidth().padding(top = 58.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("No history", color = PearColors.TextPrimary, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            if (historyEnabled) {
                                "History is on. Sites you open in Browse will appear here."
                            } else {
                                "History is off by default to protect your privacy. " +
                                    "Turn it on to keep the sites you open, synced across your devices."
                            },
                            color = PearColors.TextSecondary,
                            fontSize = 13.sp,
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(top = 4.dp),
                        ) {
                            Text(
                                "Save browsing history",
                                color = PearColors.TextPrimary,
                                fontSize = 14.sp,
                            )
                            Spacer(Modifier.width(12.dp))
                            Switch(
                                checked = historyEnabled,
                                onCheckedChange = ::setHistoryEnabled,
                            )
                        }
                    }
                }
                else -> {
                    for (group in groupHistoryByDay(entries)) {
                        item(key = "label-${group.label}") {
                            Text(
                                group.label.uppercase(),
                                color = PearColors.TextSecondary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(top = 16.dp, bottom = 8.dp),
                            )
                        }
                        item(key = "group-${group.label}") {
                            Surface(
                                color = PearColors.Surface,
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(1.dp, PearColors.Border),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column {
                                    group.items.forEach { entry ->
                                        HistoryRow(entry = entry, onOpen = { onOpen(entry.url) })
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showClearConfirm) {
        AlertDialog(
            onDismissRequest = { showClearConfirm = false },
            containerColor = PearColors.Surface,
            title = {
                Text("Clear History?", color = PearColors.TextPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Text(
                    "This will permanently remove your browsing history on all devices where this identity is active.",
                    color = PearColors.TextSecondary,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showClearConfirm = false
                        clear()
                    },
                ) {
                    Text("Clear", color = PearColors.Error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearConfirm = false }) {
                    Text("Cancel", color = PearColors.TextSecondary)
                }
            },
        )
    }
}

@Composable
private fun HistoryRow(entry: PearHistoryEntry, onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                entry.title.ifEmpty { entry.url },
                color = PearColors.TextPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                entry.url,
                color = PearColors.TextMuted,
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(12.dp))
        Text(
            formatTime(entry.visitedAt),
            color = PearColors.TextMuted,
            fontSize = 11.sp,
        )
    }
}

private data class HistoryGroup(val label: String, val items: List<PearHistoryEntry>)

private fun groupHistoryByDay(entries: List<PearHistoryEntry>): List<HistoryGroup> {
    val buckets = LinkedHashMap<Long, MutableList<PearHistoryEntry>>()
    val labels = HashMap<Long, String>()
    for (entry in entries) {
        val dayStart = startOfDayMillis(entry.visitedAt)
        if (!buckets.containsKey(dayStart)) {
            buckets[dayStart] = mutableListOf()
            labels[dayStart] = dayLabel(entry.visitedAt)
        }
        buckets.getValue(dayStart).add(entry)
    }
    return buckets.map { (dayStart, items) -> HistoryGroup(labels.getValue(dayStart), items) }
}

private fun startOfDayMillis(epochMs: Long): Long =
    Calendar.getInstance().apply {
        timeInMillis = epochMs
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }.timeInMillis

private fun dayLabel(epochMs: Long): String {
    val entry = Calendar.getInstance().apply { timeInMillis = epochMs }
    val now = Calendar.getInstance()
    if (isSameDay(entry, now)) return "Today"

    // Walk back day by day (DST-safe) — mirrors the iOS grouping rules:
    // Yesterday, weekday names for the rest of the week, then a medium date.
    val cursor = Calendar.getInstance().apply { timeInMillis = startOfDayMillis(now.timeInMillis) }
    for (daysBack in 1..6) {
        cursor.add(Calendar.DAY_OF_YEAR, -1)
        if (epochMs >= cursor.timeInMillis) {
            if (daysBack == 1) return "Yesterday"
            return SimpleDateFormat("EEEE", Locale.getDefault()).format(entry.time)
        }
    }
    return DateFormat.getDateInstance(DateFormat.MEDIUM, Locale.getDefault()).format(entry.time)
}

private fun isSameDay(a: Calendar, b: Calendar): Boolean =
    a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)

private fun formatTime(epochMs: Long): String {
    if (epochMs <= 0) return ""
    return SimpleDateFormat("HH:mm", Locale.getDefault()).format(epochMs)
}
