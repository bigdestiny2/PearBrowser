package com.pearbrowser.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.bridge.PearWorkletService
import com.pearbrowser.app.ui.screens.BookmarksScreen
import com.pearbrowser.app.ui.screens.BrowseScreen
import com.pearbrowser.app.ui.screens.ExploreScreen
import com.pearbrowser.app.ui.screens.HomeScreen
import com.pearbrowser.app.ui.screens.MoreScreen
import com.pearbrowser.app.ui.theme.PearBrowserTheme
import com.pearbrowser.app.ui.theme.PearColors

/**
 * Root activity. Hosts the Compose UI and starts the worklet service.
 *
 * Phase 2: this is the Kotlin equivalent of `app/App.tsx`.
 * See docs/HOLEPUNCH_ALIGNMENT_PLAN.md.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        PearWorkletService.start(this)
        setContent {
            PearBrowserTheme {
                PearBrowserRoot()
            }
        }
    }
}

private enum class Tab(val label: String, val icon: String) {
    Home("Home", "{ }"),
    Explore("Explore", "[ ]"),
    Browse("Browse", "<>"),
    More("More", "...")
}

@Composable
private fun PearBrowserRoot() {
    var activeTab by remember { mutableStateOf(Tab.Home) }
    var browseUrl by remember { mutableStateOf<String?>(null) }

    val onNavigate: (String) -> Unit = { url ->
        browseUrl = url
        activeTab = Tab.Browse
    }

    Column(Modifier.fillMaxSize().background(PearColors.Bg)) {
        // Header with status dot (placeholder — wired to PearRpc in the next pass)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "● Starting…",
                color = PearColors.Warning,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
        }

        Box(Modifier.weight(1f)) {
            when (activeTab) {
                Tab.Home -> HomeScreen(onNavigate = onNavigate)
                Tab.Explore -> ExploreScreen(onVisit = onNavigate)
                Tab.Browse -> BrowseScreen(initialUrl = browseUrl)
                Tab.More -> MoreScreen()
            }
        }

        TabBar(active = activeTab, onSelect = { activeTab = it })
    }
}

@Composable
private fun TabBar(active: Tab, onSelect: (Tab) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(PearColors.Surface)
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        for (tab in Tab.entries) {
            val tint = if (tab == active) PearColors.Accent else PearColors.TextMuted
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clickable { onSelect(tab) }
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Text(
                    tab.icon,
                    color = tint,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                )
                Text(
                    tab.label,
                    color = tint,
                    fontSize = 10.sp,
                )
            }
        }
    }
}
