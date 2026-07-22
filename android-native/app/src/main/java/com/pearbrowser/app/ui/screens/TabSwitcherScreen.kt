package com.pearbrowser.app.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.ui.tabs.BrowserTab
import com.pearbrowser.app.ui.theme.PearColors

/**
 * TabSwitcherScreen — mirror of app/screens/TabSwitcherScreen.tsx.
 *
 * Card list of open browser tabs: header with Done / tab count / "+", each
 * card shows title + URL with a close button, the active card gets an accent
 * border. Empty state offers "Open New Tab". Per DESIGN.md ("+ opens a new
 * tab (goes to Home)") the [onNewTab] caller routes to the Home screen.
 */
@Composable
fun TabSwitcherScreen(
    tabs: List<BrowserTab>,
    activeTabId: String?,
    onSelect: (String) -> Unit,
    onClose: (String) -> Unit,
    onNewTab: () -> Unit,
    onDismiss: () -> Unit,
) {
    BackHandler(onBack = onDismiss)

    Column(Modifier.fillMaxSize().background(PearColors.Bg)) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(PearColors.Surface)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onDismiss) {
                Text("Done", color = PearColors.Accent, fontSize = 14.sp)
            }
            Text(
                "${tabs.size} Tab${if (tabs.size != 1) "s" else ""}",
                color = PearColors.TextPrimary,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
            )
            TextButton(onClick = onNewTab) {
                Text("+", color = PearColors.Accent, fontSize = 22.sp, fontWeight = FontWeight.Light)
            }
        }

        if (tabs.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("No open tabs", color = PearColors.TextSecondary, fontSize = 16.sp)
                Spacer(Modifier.height(16.dp))
                Surface(
                    color = PearColors.Accent,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    TextButton(onClick = onNewTab) {
                        Text("Open New Tab", color = PearColors.Bg, fontWeight = FontWeight.Bold)
                    }
                }
            }
            return@Column
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
        ) {
            items(tabs, key = { it.id }) { tab ->
                TabCard(
                    tab = tab,
                    active = tab.id == activeTabId,
                    onSelect = { onSelect(tab.id) },
                    onClose = { onClose(tab.id) },
                )
            }
        }
    }
}

@Composable
private fun TabCard(
    tab: BrowserTab,
    active: Boolean,
    onSelect: () -> Unit,
    onClose: () -> Unit,
) {
    Surface(
        onClick = onSelect,
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(2.dp, if (active) PearColors.Accent else PearColors.Border),
        modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    tab.title.ifBlank { "New Tab" },
                    color = PearColors.TextPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onClose) {
                    Text("×", color = PearColors.TextMuted, fontSize = 18.sp)
                }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(PearColors.SurfaceElevated)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                Text(
                    tab.url ?: "about:blank",
                    color = PearColors.TextMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
