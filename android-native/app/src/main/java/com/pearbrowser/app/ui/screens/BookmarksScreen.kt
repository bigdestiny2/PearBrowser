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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.pearbrowser.app.rpc.PearBookmark
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.coroutines.launch

/**
 * BookmarksScreen — mirror of ios-native `BookmarksScreen.swift` (itself a
 * mirror of `app/screens/BookmarksScreen.tsx`).
 *
 * Lists bookmarks from the Hyperbee user-data store via the bound worklet
 * RPC so they sync across the user's devices. Tap a row to open it in the
 * Browse tab; tap "x" to remove it.
 */
@Composable
fun BookmarksScreen(onOpen: (String) -> Unit, onBack: () -> Unit) {
    val rpc = LocalPearRpc.current
    val scope = rememberCoroutineScope()

    var loading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var bookmarks by remember { mutableStateOf<List<PearBookmark>>(emptyList()) }

    suspend fun loadBookmarks() {
        loading = true
        errorMessage = null
        val client = rpc
        if (client == null) {
            errorMessage = "P2P engine is not connected yet"
            bookmarks = emptyList()
            loading = false
            return
        }
        try {
            bookmarks = client.listBookmarks()
        } catch (e: Throwable) {
            errorMessage = e.message ?: "Could not load bookmarks"
            bookmarks = emptyList()
        } finally {
            loading = false
        }
    }

    fun refresh() {
        scope.launch { loadBookmarks() }
    }

    fun remove(url: String) {
        scope.launch {
            try {
                rpc?.removeBookmark(url)
                loadBookmarks()
            } catch (e: Throwable) {
                errorMessage = e.message ?: "Could not remove bookmark"
            }
        }
    }

    LaunchedEffect(rpc) {
        loadBookmarks()
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
                "Bookmarks",
                color = PearColors.TextPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
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
                            "Could not load bookmarks: ${errorMessage ?: ""}",
                            color = PearColors.Error,
                            fontSize = 13.sp,
                        )
                        TextButton(onClick = ::refresh) {
                            Text("Retry", color = PearColors.Accent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                bookmarks.isEmpty() -> item {
                    Column(
                        Modifier.fillMaxWidth().padding(top = 58.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("*", color = PearColors.Accent, fontSize = 36.sp)
                        Text(
                            "No bookmarks yet",
                            color = PearColors.TextPrimary,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "Save the current site from Page actions while browsing.",
                            color = PearColors.TextSecondary,
                            fontSize = 13.sp,
                        )
                    }
                }
                else -> items(bookmarks, key = { it.url }) { bookmark ->
                    BookmarkRow(
                        bookmark = bookmark,
                        onOpen = { onOpen(bookmark.url) },
                        onRemove = { remove(bookmark.url) },
                    )
                }
            }
        }
    }
}

@Composable
private fun BookmarkRow(
    bookmark: PearBookmark,
    onOpen: () -> Unit,
    onRemove: () -> Unit,
) {
    Surface(
        color = PearColors.Surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, PearColors.Border),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
    ) {
        Row(
            Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(PearColors.SurfaceElevated, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    bookmark.title.firstOrNull()?.uppercase() ?: "*",
                    color = PearColors.Accent,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    bookmark.title.ifEmpty { "Untitled" },
                    color = PearColors.TextPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    bookmark.url,
                    color = PearColors.TextMuted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            TextButton(onClick = onRemove) {
                Text("x", color = PearColors.Error, fontSize = 16.sp)
            }
        }
    }
}
