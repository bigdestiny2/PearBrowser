package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.rpc.PearBookmark
import com.pearbrowser.app.rpc.PearRpcStatus
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.delay

/**
 * HomeScreen — mirror of `app/screens/HomeScreen.tsx`.
 *
 * Phase 2 ticket — first screen ported to Jetpack Compose. Kept deliberately
 * simple for now: search bar + synced bookmark quick access.
 */
@Composable
fun HomeScreen(
    onNavigate: (String) -> Unit,
    status: PearRpcStatus?,
    onOpenQR: (() -> Unit)? = null,
) {
    var input by remember { mutableStateOf("") }
    var bookmarks by remember { mutableStateOf<List<PearBookmark>>(emptyList()) }
    var bookmarksLoading by remember { mutableStateOf(false) }
    var bookmarksError by remember { mutableStateOf<String?>(null) }
    val scroll = rememberScrollState()
    val rpc = LocalPearRpc.current
    val backendReady = status != null

    LaunchedEffect(rpc, backendReady) {
        val client = rpc ?: return@LaunchedEffect
        if (!backendReady) {
            bookmarksLoading = true
            bookmarksError = null
            return@LaunchedEffect
        }

        bookmarksLoading = true
        bookmarksError = null
        var lastError: Throwable? = null
        for (attempt in 0 until 5) {
            try {
                bookmarks = client.listBookmarks()
                bookmarksError = null
                bookmarksLoading = false
                return@LaunchedEffect
            } catch (e: Throwable) {
                lastError = e
                if (!e.isBootRace() || attempt == 4) break
                delay(400L * (attempt + 1))
            }
        }

        bookmarks = emptyList()
        bookmarksError = lastError?.message ?: "Bookmarks unavailable"
        bookmarksLoading = false
    }

    fun go() {
        // Mission B3: pass the raw input through — CMD_NAVIGATE resolves
        // bare-word names (petnames / N5 registry / curated aliases), bare
        // drive keys (→ hyper://), and bare clearnet hosts (→ https proxy)
        // itself. The old shell prefixed everything non-URL with hyper://,
        // which made name resolution unreachable from the URL bar.
        val url = input.trim()
        if (url.isEmpty()) return
        input = ""
        onNavigate(url)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(PearColors.Bg)
            .verticalScroll(scroll)
            .padding(16.dp)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(bottom = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                "PearBrowser",
                color = PearColors.Accent,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        // Search bar
        Row(
            Modifier
                .fillMaxWidth()
                .background(PearColors.Surface, RoundedCornerShape(12.dp))
                .padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("Search or enter hyper:// address", color = PearColors.TextMuted) },
                textStyle = TextStyle(color = PearColors.TextPrimary, fontSize = 15.sp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { go() }),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = PearColors.Accent,
                    focusedTextColor = PearColors.TextPrimary,
                    unfocusedTextColor = PearColors.TextPrimary,
                ),
                modifier = Modifier.weight(1f),
            )
            Box(
                Modifier
                    .background(PearColors.SurfaceElevated, RoundedCornerShape(8.dp))
                    .then(
                        if (onOpenQR != null) Modifier.clickable { onOpenQR() } else Modifier,
                    )
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text("QR", color = PearColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        Spacer(Modifier.height(32.dp))

        when {
            bookmarksLoading -> {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(color = PearColors.Accent)
                }
            }

            bookmarks.isNotEmpty() -> {
                Text(
                    "Quick Access",
                    color = PearColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(10.dp))
                bookmarks.take(8).forEach { bookmark ->
                    BookmarkRow(bookmark = bookmark, onNavigate = onNavigate)
                }
            }

            else -> {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        "{ }",
                        color = PearColors.Accent,
                        fontSize = 40.sp,
                        fontFamily = FontFamily.Monospace,
                    )
                    Spacer(Modifier.height(16.dp))
                    Text(
                        "Welcome to PearBrowser",
                        color = PearColors.TextPrimary,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        if (bookmarksError == null) {
                            "Browse the decentralized web, discover P2P sites, and build your own websites."
                        } else {
                            "Bookmarks are unavailable right now. Try again in a moment."
                        },
                        color = PearColors.TextSecondary,
                        fontSize = 14.sp,
                    )
                }
            }
        }
    }
}

private fun Throwable.isBootRace(): Boolean {
    val msg = message ?: return false
    return msg.contains("still booting", ignoreCase = true) ||
        msg.contains("not available", ignoreCase = true) ||
        msg.contains("not connected yet", ignoreCase = true)
}

@Composable
private fun BookmarkRow(bookmark: PearBookmark, onNavigate: (String) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .background(PearColors.Surface, RoundedCornerShape(10.dp))
            .clickable { onNavigate(bookmark.url) }
            .padding(14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                bookmark.title.ifBlank { "Site" },
                color = PearColors.TextPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                bookmark.url,
                color = PearColors.TextMuted,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
            )
        }
        Text(
            "Open",
            color = PearColors.Accent,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}
