package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.ui.theme.PearColors

/** Placeholder — full implementation is in the next pass, wired to
 *  [com.pearbrowser.app.rpc.PearRpc.listBookmarks]. */
@Composable
fun BookmarksScreen() {
    Column(Modifier.fillMaxSize().background(PearColors.Bg).padding(16.dp)) {
        Text("Bookmarks", color = PearColors.TextPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold)
    }
}
