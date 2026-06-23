package com.pearbrowser.app.ui.screens

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
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
import java.util.concurrent.atomic.AtomicLong

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
    val navigationSerial = remember { AtomicLong(0) }

    LaunchedEffect(initialUrl) { currentUrl = initialUrl }

    LaunchedEffect(currentUrl, rpc) {
        val target = currentUrl ?: return@LaunchedEffect
        val serial = navigationSerial.incrementAndGet()
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
                if (serial != navigationSerial.get()) return@LaunchedEffect
                val localUrl = result["localUrl"]?.jsonPrimitive?.contentOrNull
                    ?: throw IllegalStateException("Backend did not return localUrl")
                val localPort = verifiedProxyPort(localUrl)
                    ?: throw IllegalStateException("Backend returned an invalid local proxy URL")
                val returnedPort = result["proxyPort"]?.jsonPrimitive?.intOrNull ?: localPort
                if (returnedPort != localPort) {
                    throw IllegalStateException("Backend proxyPort did not match localUrl")
                }
                val token = result["apiToken"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (token.isBlank()) {
                    throw IllegalStateException("Backend did not return an API token")
                }
                webViewUrl = localUrl
                apiToken = token
                proxyPort = localPort
            } catch (e: Throwable) {
                if (serial != navigationSerial.get()) return@LaunchedEffect
                error = e.message ?: "Could not navigate to $target"
                webViewUrl = null
                apiToken = ""
                proxyPort = 0
            }
        } else if (isHttpOrHttpsUrl(target)) {
            // Direct HTTP(S) browsing is allowed for relay/catalog fallback and
            // developer pages. It does not receive a Pear bridge token.
            webViewUrl = target
            apiToken = ""
            proxyPort = 0
        } else {
            error = "Unsupported URL: $target"
            webViewUrl = null
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
                            mainHandler.post {
                                val target = normalizeHyperNavigation(url)
                                if (target != null) {
                                    currentUrl = target
                                } else if (isHttpOrHttpsUrl(url)) {
                                    openExternal(ctx, url) { error = it }
                                }
                            }
                        }

                        @JavascriptInterface
                        fun share(url: String) {
                            mainHandler.post {
                                try {
                                    val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_TEXT, url)
                                    }
                                    ctx.startActivity(Intent.createChooser(shareIntent, "Share link"))
                                } catch (e: Throwable) {
                                    error = e.message ?: "Could not share link"
                                }
                            }
                        }
                    }, "PearBrowserNative")
                }
            },
            update = { web ->
                web.webViewClient = pearWebViewClient(
                    proxyPort = proxyPort,
                    apiToken = apiToken,
                    onHyperNavigate = { currentUrl = it },
                    onExternalError = { error = it },
                )
                if (targetUrl != web.url) web.loadUrl(targetUrl)
                else injectBridgeIfAllowed(web, web.url, proxyPort, apiToken)
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

private val hyperHost = Regex("^(?:[0-9a-fA-F]{64}|[13-9a-km-uw-zA-KM-UW-Z]{52})$")

private fun pearWebViewClient(
    proxyPort: Int,
    apiToken: String,
    onHyperNavigate: (String) -> Unit,
    onExternalError: (String) -> Unit,
): WebViewClient =
    object : WebViewClient() {
        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?,
        ): Boolean {
            val url = request?.url?.toString() ?: return false
            if (request.isForMainFrame != true) return false

            val hyperTarget = normalizeHyperNavigation(url)
            if (hyperTarget != null) {
                onHyperNavigate(hyperTarget)
                return true
            }

            if (proxyPort > 0 && apiToken.isNotBlank()) {
                if (isLocalProxyUrl(url, proxyPort)) return false
                if (isHttpOrHttpsUrl(url)) {
                    view?.context?.let { openExternal(it, url, onExternalError) }
                    return true
                }
                return url != "about:blank"
            }

            return false
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            injectBridgeIfAllowed(view, url, proxyPort, apiToken)
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            injectBridgeIfAllowed(view, url, proxyPort, apiToken)
        }
    }

private fun injectBridgeIfAllowed(view: WebView?, url: String?, proxyPort: Int, apiToken: String) {
    if (view == null || proxyPort <= 0 || apiToken.isBlank()) return
    if (!isLocalProxyUrl(url, proxyPort)) return
    view.evaluateJavascript(PearBridgeScript.build(proxyPort, apiToken), null)
}

private fun normalizeHyperNavigation(url: String?): String? {
    val trimmed = url?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val uri = try { URI(trimmed) } catch (_: Throwable) { return null }
    if (!uri.scheme.equals("hyper", ignoreCase = true)) return null
    val host = uri.host?.takeIf { hyperHost.matches(it) } ?: return null
    val path = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
    val query = uri.rawQuery?.let { "?$it" }.orEmpty()
    val fragment = uri.rawFragment?.let { "#$it" }.orEmpty()
    return "hyper://${host.lowercase()}$path$query$fragment"
}

private fun verifiedProxyPort(url: String): Int? {
    val uri = try { URI(url) } catch (_: Throwable) { return null }
    val port = uri.port.takeIf { it in 1..65535 } ?: return null
    val path = uri.rawPath ?: return null
    return if (
        uri.scheme.equals("http", ignoreCase = true) &&
        isLoopbackHost(uri.host) &&
        path.startsWith("/hyper/")
    ) port else null
}

private fun isLocalProxyUrl(url: String?, proxyPort: Int): Boolean {
    if (proxyPort <= 0) return false
    val uri = try { URI(url?.trim() ?: return false) } catch (_: Throwable) { return false }
    return uri.scheme.equals("http", ignoreCase = true) &&
        isLoopbackHost(uri.host) &&
        uri.port == proxyPort
}

private fun isLoopbackHost(host: String?): Boolean =
    host.equals("127.0.0.1", ignoreCase = true) ||
        host.equals("localhost", ignoreCase = true) ||
        host == "::1"

private fun isHttpOrHttpsUrl(url: String?): Boolean {
    val scheme = try { URI(url?.trim() ?: return false).scheme } catch (_: Throwable) { return false }
    return scheme.equals("http", ignoreCase = true) || scheme.equals("https", ignoreCase = true)
}

private fun openExternal(context: Context, url: String, onError: (String) -> Unit) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (e: Throwable) {
        onError(e.message ?: "Could not open $url")
    }
}
