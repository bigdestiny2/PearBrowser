package com.pearbrowser.app.ui.screens

import android.annotation.SuppressLint
import android.graphics.Color
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.pearbrowser.app.bridge.PearBridgeScript
import com.pearbrowser.app.ui.theme.PearColors

/**
 * BrowseScreen — WebView host with Pear bridge injection.
 *
 * The Kotlin equivalent of `app/screens/BrowseScreen.tsx`. Uses native
 * Android WebView (no react-native-webview wrapper) — drops ~5MB of RN
 * dependencies and gives us direct access to addJavascriptInterface for
 * native callbacks from the page.
 *
 * Phase 2 ticket 6 — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowseScreen(initialUrl: String?) {
    // Placeholder port + token — will be populated once the worklet
    // reports READY via PearRpc.onReady in the next pass.
    var proxyPort by remember { mutableStateOf(0) }
    var apiToken by remember { mutableStateOf("") }
    var currentUrl by remember { mutableStateOf(initialUrl) }

    LaunchedEffect(initialUrl) { currentUrl = initialUrl }

    if (currentUrl == null) {
        Column(
            Modifier.fillMaxSize().background(PearColors.Bg).padding(32.dp),
        ) {
            Text(
                "Browse",
                color = PearColors.TextPrimary,
                fontSize = 24.sp,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                "Enter a hyper:// address on the Home tab, or tap a site in Explore.",
                color = PearColors.TextSecondary,
                fontSize = 14.sp,
            )
        }
        return
    }

    AndroidView(
        modifier = Modifier.fillMaxSize().background(PearColors.Bg),
        factory = { ctx ->
            WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                setBackgroundColor(Color.parseColor("#0A0A0A"))
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false

                // Native hooks the bridge script calls back to. Matches the
                // `window.PearBrowserNative` path declared in
                // app/lib/pear-bridge-spec.ts (mirrored in
                // bridge/PearBridgeScript.kt).
                addJavascriptInterface(object {
                    @JavascriptInterface
                    fun navigate(url: String) {
                        // TODO: post through a callback prop so the root
                        // navigator can switch to the Browse tab.
                    }
                    @JavascriptInterface
                    fun share(url: String) { /* TODO: Intent.ACTION_SEND */ }
                }, "PearBrowserNative")

                webViewClient = object : WebViewClient() {
                    override fun onPageStarted(
                        view: WebView?, url: String?, favicon: android.graphics.Bitmap?
                    ) {
                        // Inject the Pear bridge as early as possible so
                        // pages see window.pear before their onload runs.
                        val script = PearBridgeScript.build(proxyPort, apiToken)
                        view?.evaluateJavascript(script, null)
                    }
                }
            }
        },
        update = { web ->
            val target = currentUrl
            if (target != null && target != web.url) {
                web.loadUrl(target)
            }
        },
    )
}
