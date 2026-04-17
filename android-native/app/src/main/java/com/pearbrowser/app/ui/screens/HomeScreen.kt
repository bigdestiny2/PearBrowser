package com.pearbrowser.app.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
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
import com.pearbrowser.app.ui.theme.PearColors

/**
 * HomeScreen — mirror of `app/screens/HomeScreen.tsx`.
 *
 * Phase 2 ticket — first screen ported to Jetpack Compose. Kept deliberately
 * simple for now: search bar + welcome state + placeholder for bookmarks.
 * Wiring to [com.pearbrowser.app.rpc.PearRpc] for live bookmark sync
 * happens in the follow-up pass.
 */
@Composable
fun HomeScreen(onNavigate: (String) -> Unit) {
    var input by remember { mutableStateOf("") }
    val scroll = rememberScrollState()

    fun go() {
        var url = input.trim()
        if (url.isEmpty()) return
        if (Regex("^[a-f0-9]{52,64}$", RegexOption.IGNORE_CASE).matches(url)) url = "hyper://$url"
        else if (!url.contains("://")) url = "hyper://$url"
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
                    autoCorrect = false,
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
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text("QR", color = PearColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        Spacer(Modifier.height(40.dp))

        // Welcome state (empty bookmarks)
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
                "Browse the decentralized web, discover P2P sites, and build your own websites.",
                color = PearColors.TextSecondary,
                fontSize = 14.sp,
            )
        }
    }
}
