package com.pearbrowser.app.ui.screens

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import com.pearbrowser.app.rpc.LocalPearRpc
import com.pearbrowser.app.ui.theme.PearColors
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI

/**
 * BrowseScreen - native WebView host for hyper:// content.
 *
 * For hyper:// URLs, the native shell mirrors the React Native flow:
 * it calls CMD_NAVIGATE on the worklet, receives a localhost proxy URL plus
 * a drive-scoped X-Pear-Token, then injects the shared window.pear bridge.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowseScreen(initialUrl: String?) {
    val rpc = LocalPearRpc.current
    var currentUrl by remember { mutableStateOf(initialUrl) }
    var webViewUrl by remember { mutableStateOf<String?>(null) }
    var proxyPort by remember { mutableStateOf(0) }
    var apiToken by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(initialUrl) { currentUrl = initialUrl }

    LaunchedEffect(currentUrl, rpc) {
        val target = currentUrl ?: return@LaunchedEffect
        error = null

        if (target.startsWith("hyper://", ignoreCase = true)) {
            val client = rpc
            if (client == null) {
                error = "P2P engine is not ready yet."
                webViewUrl = null
                apiToken = ""
                proxyPort = 0
                return@LaunchedEffect
            }

            try {
                val result = client.navigate(target)
                val localUrl = result["localUrl"]?.jsonPrimitive?.contentOrNull
                    ?: throw IllegalStateException("Backend did not return localUrl")
                webViewUrl = localUrl
                apiToken = result["apiToken"]?.jsonPrimitive?.contentOrNull.orEmpty()
                proxyPort = result["proxyPort"]?.jsonPrimitive?.intOrNull ?: parsePort(localUrl)
            } catch (e: Throwable) {
                error = e.message ?: "Could not navigate to $target"
                webViewUrl = null
                apiToken = ""
                proxyPort = 0
            }
        } else {
            // Direct HTTP(S) browsing is allowed for relay/catalog fallback and
            // developer pages. It does not receive a Pear bridge token.
            webViewUrl = target
            apiToken = ""
            proxyPort = 0
        }
    }

    if (currentUrl == null) {
        EmptyBrowseState()
        return
    }

    Column(Modifier.fillMaxSize().background(PearColors.Bg)) {
        error?.let {
            Text(
                it,
                color = PearColors.Error,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }

        val targetUrl = webViewUrl
        if (targetUrl == null) {
            Text(
                "Preparing P2P route...",
                color = PearColors.TextSecondary,
                fontSize = 14.sp,
                modifier = Modifier.padding(32.dp),
            )
            return@Column
        }

        AndroidView(
            modifier = Modifier.fillMaxSize().background(PearColors.Bg),
            factory = { ctx ->
                WebView(ctx).apply {
                    val mainHandler = Handler(Looper.getMainLooper())
                    setBackgroundColor(Color.parseColor("#0A0A0A"))
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false

                    addJavascriptInterface(object {
                        @JavascriptInterface
                        fun navigate(url: String) {
                            mainHandler.post { currentUrl = url }
                        }

                        @JavascriptInterface
                        fun share(url: String) {
                            // TODO: wire Intent.ACTION_SEND once the share sheet
                            // route is ported from the RN shell.
                        }
                    }, "PearBrowserNative")

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?,
                        ): Boolean {
                            val url = request?.url?.toString() ?: return false
                            if (url.startsWith("hyper://", ignoreCase = true)) {
                                currentUrl = url
                                return true
                            }
                            return false
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            if (proxyPort > 0 && apiToken.isNotBlank()) {
                                view?.evaluateJavascript(
                                    PearBridgeScript.build(proxyPort, apiToken),
                                    null,
                                )
                            }
                        }
                    }
                }
            },
            update = { web ->
                if (targetUrl != web.url) web.loadUrl(targetUrl)
            },
        )
    }
}

@Composable
private fun EmptyBrowseState() {
    Column(
        Modifier.fillMaxSize().background(PearColors.Bg).padding(32.dp),
    ) {
        Text("Browse", color = PearColors.TextPrimary, fontSize = 24.sp)
        Spacer(Modifier.height(16.dp))
        Text(
            "Enter a hyper:// address on the Home tab, or tap a site in Explore.",
            color = PearColors.TextSecondary,
            fontSize = 14.sp,
        )
    }
}

private fun parsePort(url: String): Int =
    try { URI(url).port.takeIf { it > 0 } ?: 0 } catch (_: Throwable) { 0 }
