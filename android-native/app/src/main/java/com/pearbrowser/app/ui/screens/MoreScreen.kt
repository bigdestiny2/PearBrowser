package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearbrowser.app.ui.theme.PearColors

/**
 * MoreScreen — hub for bookmarks, history, settings, identity.
 * Scaffold only: screen wiring happens in the follow-up pass once
 * the worklet is fully connected to PearRpc.
 */
@Composable
fun MoreScreen() {
    Column(
        Modifier.fillMaxSize().background(PearColors.Bg).padding(16.dp),
    ) {
        Text("More", color = PearColors.TextPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("Bookmarks, history, sites, identity — coming in the next pass.", color = PearColors.TextSecondary, fontSize = 14.sp)
    }
}
