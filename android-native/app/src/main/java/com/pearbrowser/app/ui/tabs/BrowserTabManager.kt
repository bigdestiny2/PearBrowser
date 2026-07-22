package com.pearbrowser.app.ui.tabs

import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.UUID

/**
 * One open browser tab. Shape mirrors the RN `BrowserTab` in
 * app/screens/TabSwitcherScreen.tsx ({ id, url, title }). Only the canonical
 * hyper:// / https:// URL is stored — never the localhost proxy URL — so a
 * dead worklet (process death) re-resolves cleanly through CMD_NAVIGATE the
 * next time the tab becomes active.
 */
class BrowserTab(
    val id: String = UUID.randomUUID().toString(),
    url: String? = null,
    title: String = "",
) {
    var url by mutableStateOf(url)
    var title by mutableStateOf(title)
}

/**
 * Browser tab model for the native shell.
 *
 * WebView strategy: a bounded live-WebView pool. Each tab keeps its own
 * WebView (exact in-page history, scroll position, form state) up to
 * [MAX_LIVE_WEBVIEWS]; past that the least-recently-used WebView is destroyed
 * and the tab falls back to re-navigating its stored URL (fresh proxy route
 * + bridge token via CMD_NAVIGATE) when it is next activated. WebView
 * saveState/restoreState was rejected: it is best-effort for exactly the
 * state users notice (form data, POST pages) and cannot re-issue the
 * drive-scoped bridge token anyway.
 *
 * All methods must be called on the main thread (Compose state + WebView).
 */
class BrowserTabManager {
    private val _tabs = mutableStateListOf<BrowserTab>()
    val tabs: List<BrowserTab> get() = _tabs

    var activeTabId by mutableStateOf<String?>(null)
        private set

    val activeTab: BrowserTab? get() = _tabs.firstOrNull { it.id == activeTabId }

    // Access-order LinkedHashMap = LRU pool of live WebViews keyed by tab id.
    private val webViews = LinkedHashMap<String, WebView>(16, 0.75f, true)

    /** Navigate the active tab, creating one when none exists. Mirrors the
     *  previous single-WebView shell where every navigation reused the one
     *  WebView. */
    fun navigateActive(url: String) {
        val tab = activeTab
        if (tab == null) {
            val created = BrowserTab(url = url)
            _tabs.add(created)
            activeTabId = created.id
        } else {
            tab.url = url
        }
    }

    /** Open an empty tab and make it active. DESIGN.md: a new tab goes to
     *  Home — the caller switches app screens; the tab itself stays blank. */
    fun openNewTab(): BrowserTab {
        val tab = BrowserTab()
        _tabs.add(tab)
        activeTabId = tab.id
        return tab
    }

    fun select(tabId: String) {
        if (_tabs.any { it.id == tabId }) activeTabId = tabId
    }

    /** Close a tab. The next active tab is the one that takes its slot
     *  (falling back to the last tab) — same neighbor-preference as common
     *  mobile browsers. */
    fun close(tabId: String) {
        val index = _tabs.indexOfFirst { it.id == tabId }
        if (index < 0) return
        destroyWebView(tabId)
        _tabs.removeAt(index)
        if (activeTabId == tabId) {
            activeTabId = _tabs.getOrNull(index)?.id ?: _tabs.lastOrNull()?.id
        }
    }

    /** Replace the whole model with a hydrated session. Only called at cold
     *  start, before any browsing happened (the caller guards on empty). */
    fun restore(tabs: List<BrowserTab>, activeId: String?) {
        closeAll()
        _tabs.addAll(tabs)
        activeTabId = tabs.firstOrNull { it.id == activeId }?.id ?: tabs.firstOrNull()?.id
    }

    fun setTabUrl(tabId: String, url: String) {
        _tabs.firstOrNull { it.id == tabId }?.url = url
    }

    fun setTabTitle(tabId: String, title: String?) {
        _tabs.firstOrNull { it.id == tabId }?.title = title.orEmpty()
    }

    /** Returns the live WebView for [tabId], creating one via [create] on
     *  first use or after LRU eviction. The active tab's WebView is never
     *  evicted by this call: [create] runs only after the pool dropped below
     *  the cap, and the new instance lands as most-recently-used. */
    fun webViewFor(tabId: String, create: () -> WebView): WebView {
        webViews[tabId]?.let { return it }
        while (webViews.size >= MAX_LIVE_WEBVIEWS) {
            val eldest = webViews.entries.firstOrNull()?.key ?: break
            destroyWebView(eldest)
        }
        val created = create()
        webViews[tabId] = created
        return created
    }

    /** The tab's live WebView without creating one, if it survived. */
    fun peekWebView(tabId: String): WebView? = webViews[tabId]

    fun closeAll() {
        webViews.values.forEach { it.destroy() }
        webViews.clear()
        _tabs.clear()
        activeTabId = null
    }

    /** Stable snapshot of everything the session persists. Compose effects
     *  key on this string so session saves are triggered (and debounced) by
     *  any tab/url/title/active change. */
    fun sessionSnapshot(): String =
        _tabs.joinToString(separator = "|") { "${it.id}${it.url}${it.title}" } +
            "#${activeTabId.orEmpty()}"

    private fun destroyWebView(tabId: String) {
        webViews.remove(tabId)?.destroy()
    }

    companion object {
        /** Beyond this many live WebViews the LRU tab is dropped and
         *  re-navigated on next activation. WebViews are the heaviest
         *  per-tab resource; 6 keeps worst-case memory sane on low-end
         *  devices while covering realistic browsing. */
        const val MAX_LIVE_WEBVIEWS = 6
    }
}
