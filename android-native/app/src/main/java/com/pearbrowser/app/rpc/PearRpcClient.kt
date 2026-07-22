package com.pearbrowser.app.rpc

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import com.pearbrowser.app.bridge.PearWorkletService
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class PearRpcBindingState(
    val connected: Boolean = false,
    val connecting: Boolean = false,
    val error: String? = null,
)

data class PearRpcStatus(
    val dhtConnected: Boolean = false,
    val peerCount: Int = 0,
    val browseDrives: Int = 0,
    val installedApps: Int = 0,
    val publishedSites: Int = 0,
    val proxyPort: Int = 0,
    val storageUsed: Long = 0,
    val storageLimit: Long = 0,
    val storagePercent: Int = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearRpcStatus =
            PearRpcStatus(
                dhtConnected = obj.boolean("dhtConnected"),
                peerCount = obj.int("peerCount"),
                browseDrives = obj.int("browseDrives"),
                installedApps = obj.int("installedApps"),
                publishedSites = obj.int("publishedSites"),
                proxyPort = obj.int("proxyPort"),
                storageUsed = obj.long("storageUsed"),
                storageLimit = obj.long("storageLimit"),
                storagePercent = obj.int("storagePercent"),
            )
    }
}

data class PearSettings(
    val catalogUrl: String = DEFAULT_CATALOG_URL,
    val catalogList: List<String> = DEFAULT_CATALOGS,
    val theme: String = "dark",
    val defaultTab: String = "home",
    val privateMode: Boolean = false,
    val historyEnabled: Boolean = false,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearSettings {
            val catalogs = obj.stringList("catalogList").ifEmpty { DEFAULT_CATALOGS }
            return PearSettings(
                catalogUrl = obj.string("catalogUrl") ?: catalogs.first(),
                catalogList = catalogs,
                theme = obj.string("theme") ?: "dark",
                defaultTab = obj.string("defaultTab") ?: "home",
                privateMode = obj.boolean("privateMode"),
                historyEnabled = obj.boolean("historyEnabled"),
            )
        }
    }
}

data class PearBookmark(
    val url: String,
    val title: String,
    val addedAt: Long = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearBookmark? {
            val url = obj.string("url") ?: return null
            return PearBookmark(
                url = url,
                title = obj.string("title") ?: url,
                addedAt = obj.long("addedAt"),
            )
        }
    }
}

data class PearHistoryEntry(
    val url: String,
    val title: String,
    val visitedAt: Long = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearHistoryEntry? {
            val url = obj.string("url") ?: return null
            return PearHistoryEntry(
                url = url,
                title = obj.string("title") ?: "",
                visitedAt = obj.long("visitedAt"),
            )
        }
    }
}

/**
 * Relay config snapshot from CMD_GET_RELAYS (backend/relay-client.js
 * `getConfig()`). The backend exposes a flat URL list plus one global
 * hybrid-fetch on/off flag — there is no per-relay enabled state; the
 * first entry is treated as primary (mirrors the iOS Settings screen).
 */
data class PearRelayConfig(
    val relays: List<String> = emptyList(),
    val enabled: Boolean = false,
    val configured: Boolean = false,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearRelayConfig =
            PearRelayConfig(
                relays = obj.stringList("relays"),
                enabled = obj.boolean("enabled"),
                configured = obj.boolean("configured"),
            )
    }
}

/**
 * Self-declared profile fields (backend/profile.js PROFILE_FIELDS). Every
 * field is opt-in; an empty string means unset (the backend deletes the
 * field when it receives one).
 */
data class PearProfile(
    val displayName: String = "",
    val avatar: String = "",
    val bio: String = "",
    val email: String = "",
    val pronouns: String = "",
    val location: String = "",
    val website: String = "",
) {
    fun toUpdates(): JsonObject = buildJsonObject {
        put("displayName", displayName)
        put("avatar", avatar)
        put("bio", bio)
        put("email", email)
        put("pronouns", pronouns)
        put("location", location)
        put("website", website)
    }

    companion object {
        fun fromJson(obj: JsonObject): PearProfile =
            PearProfile(
                displayName = obj.string("displayName") ?: "",
                avatar = obj.string("avatar") ?: "",
                bio = obj.string("bio") ?: "",
                email = obj.string("email") ?: "",
                pronouns = obj.string("pronouns") ?: "",
                location = obj.string("location") ?: "",
                website = obj.string("website") ?: "",
            )
    }
}

data class PearTrustedOrigin(
    val origin: String,
    val trustedAt: Long = 0,
    val lastUsedAt: Long = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearTrustedOrigin? {
            val origin = obj.string("origin") ?: return null
            return PearTrustedOrigin(
                origin = origin,
                trustedAt = obj.long("trustedAt"),
                lastUsedAt = obj.long("lastUsedAt"),
            )
        }
    }
}

/**
 * A user site from CMD_LIST_SITES (backend/site-manager.js `listSites()`).
 * The backend returns a bare array; `url` is always `hyper://<keyHex>`.
 */
data class PearSite(
    val siteId: String,
    val keyHex: String,
    val name: String,
    val published: Boolean = false,
    val createdAt: Long = 0,
    val url: String,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearSite? {
            val siteId = obj.string("siteId") ?: obj.string("id") ?: return null
            val keyHex = obj.string("keyHex") ?: return null
            val name = obj.string("name") ?: return null
            return PearSite(
                siteId = siteId,
                keyHex = keyHex,
                name = name,
                published = obj.boolean("published"),
                createdAt = obj.long("createdAt"),
                url = obj.string("url") ?: "hyper://$keyHex",
            )
        }
    }
}

/**
 * An installed app from CMD_LIST_INSTALLED (backend/app-manager.js
 * `listInstalled()`). The backend returns a bare array.
 */
data class PearInstalledApp(
    val id: String,
    val driveKey: String,
    val name: String,
    val version: String = "0.0.0",
    val installedAt: Long = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearInstalledApp? {
            val id = obj.string("id") ?: return null
            val driveKey = obj.string("driveKey") ?: return null
            return PearInstalledApp(
                id = id,
                driveKey = driveKey,
                name = obj.string("name") ?: id,
                version = obj.string("version") ?: "0.0.0",
                installedAt = obj.long("installedAt"),
            )
        }
    }
}

/**
 * Trusted-origins allow-list state (backend/trusted-origins.js `list()`).
 * [mode] is "all" (bridge injected on every page) or "allowlist"
 * (only the origins below plus PearBrowser's own surfaces).
 */
data class PearTrustedOrigins(
    val origins: List<PearTrustedOrigin> = emptyList(),
    val mode: String = "all",
) {
    companion object {
        fun fromJson(obj: JsonObject): PearTrustedOrigins {
            val entries = obj["origins"]?.jsonArrayOrNull() ?: JsonArray(emptyList())
            return PearTrustedOrigins(
                origins = entries.mapNotNull { (it as? JsonObject)?.let(PearTrustedOrigin::fromJson) },
                mode = obj.string("mode") ?: "all",
            )
        }
    }
}

/** One hit-counter row from the shield's topRules list. */
data class PearShieldRuleHit(
    val rule: String,
    val hits: Long = 0,
)

/**
 * A filter-list drive subscription (backend/shield-list-sync.cjs
 * `subscriptions()`). Rule text is durable on-device, so a subscribed list
 * keeps blocking fully offline after first sync.
 */
data class PearShieldSubscription(
    val driveKey: String,
    val name: String = "",
    val version: String = "",
    val rules: Int = 0,
    val updatedAt: Long = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearShieldSubscription? {
            val driveKey = obj.string("driveKey") ?: return null
            return PearShieldSubscription(
                driveKey = driveKey,
                name = obj.string("name") ?: "",
                version = obj.string("version") ?: "",
                rules = obj.int("rules"),
                updatedAt = obj.long("updatedAt"),
            )
        }
    }
}

/**
 * Content Shield live status (backend/index.js CMD_SHIELD_STATUS →
 * content-shield.cjs `stats()`). Counters are session-scoped; the shield
 * never logs what you visit. [driveAllowlisted]/[driveStrict] are only
 * filled when the request carried a `driveKey`.
 */
data class PearShieldStatus(
    val enabled: Boolean = true,
    val blocked: Long = 0,
    val allowed: Long = 0,
    val blockRules: Int = 0,
    val exceptionRules: Int = 0,
    val cosmeticRules: Int = 0,
    val scriptletRules: Int = 0,
    val lists: List<String> = emptyList(),
    val allowlist: List<String> = emptyList(),
    val strict: List<String> = emptyList(),
    val topRules: List<PearShieldRuleHit> = emptyList(),
    val subscriptions: List<PearShieldSubscription> = emptyList(),
    val driveKey: String? = null,
    val driveAllowlisted: Boolean = false,
    val driveStrict: Boolean = false,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearShieldStatus {
            val topRules = obj["topRules"]?.jsonArrayOrNull()?.mapNotNull { el ->
                (el as? JsonObject)?.let { hit ->
                    hit.string("rule")?.let { PearShieldRuleHit(it, hit.long("hits")) }
                }
            } ?: emptyList()
            val subs = obj["subscriptions"]?.jsonArrayOrNull()
                ?.mapNotNull { (it as? JsonObject)?.let(PearShieldSubscription::fromJson) }
                ?: emptyList()
            return PearShieldStatus(
                enabled = obj.boolean("enabled", true),
                blocked = obj.long("blocked"),
                allowed = obj.long("allowed"),
                blockRules = obj.int("blockRules"),
                exceptionRules = obj.int("exceptionRules"),
                cosmeticRules = obj.int("cosmeticRules"),
                scriptletRules = obj.int("scriptletRules"),
                lists = obj.stringList("lists"),
                allowlist = obj.stringList("allowlist"),
                strict = obj.stringList("strict"),
                topRules = topRules,
                subscriptions = subs,
                driveKey = obj.string("driveKey"),
                driveAllowlisted = obj.boolean("driveAllowlisted"),
                driveStrict = obj.boolean("driveStrict"),
            )
        }
    }
}

/**
 * One installed Pear Plugin (backend/pear-plugins.cjs publicPluginView,
 * Mission B4a). [capabilities] is the GRANTED set — an ungranted capability
 * never reaches the shield engine. Toggling [enabled] is the kill switch:
 * contributions stop without uninstalling.
 */
data class PearPluginInfo(
    val id: String,
    val name: String = "",
    val version: String = "",
    val capabilities: List<String> = emptyList(),
    val enabled: Boolean = true,
    val registeredAt: Long = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearPluginInfo? {
            val id = obj.string("id") ?: return null
            return PearPluginInfo(
                id = id,
                name = obj.string("name") ?: "",
                version = obj.string("version") ?: "",
                capabilities = obj.stringList("capabilities"),
                enabled = obj.boolean("enabled", true),
                registeredAt = obj.long("registeredAt"),
            )
        }
    }
}

/**
 * Reply from PLUGIN_INSTALL_DRIVE. Two shapes (backend/plugin-drive-
 * loader.cjs installFromDrive): a consent preview ([consentRequired] — echo
 * [requested] + [fingerprint] back to accept; nothing was registered), or the
 * completed install ([ok] with the granted set). The fingerprint binds the
 * consent to the exact manifest+asset bytes the user reviewed.
 */
data class PearPluginInstallReply(
    val ok: Boolean = false,
    val consentRequired: Boolean = false,
    val reason: String? = null,
    val driveKey: String = "",
    val name: String = "",
    val version: String = "",
    val requested: List<String> = emptyList(),
    val granted: List<String> = emptyList(),
    val fingerprint: String? = null,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearPluginInstallReply =
            PearPluginInstallReply(
                ok = obj.boolean("ok"),
                consentRequired = obj.boolean("consentRequired"),
                reason = obj.string("reason"),
                driveKey = obj.string("driveKey") ?: "",
                name = obj.string("name") ?: "",
                version = obj.string("version") ?: "",
                requested = obj.stringList("requested"),
                granted = obj.stringList("granted"),
                fingerprint = obj.string("fingerprint"),
            )
    }
}

/**
 * Reply from PLUGIN_UPDATE_DRIVE (backend/plugin-drive-loader.cjs
 * updateFromDrive). [escalated] means the update requested capabilities
 * beyond the recorded grant: the plugin was auto-disabled and acceptance
 * must echo [capabilities] + [fingerprint]. [changedSinceReview] flags that
 * the snapshot moved after an earlier review (re-inspect before consenting).
 */
data class PearPluginUpdateReply(
    val ok: Boolean = false,
    val escalated: Boolean = false,
    val driveKey: String = "",
    val version: String = "",
    val granted: List<String> = emptyList(),
    val added: List<String> = emptyList(),
    val capabilities: List<String> = emptyList(),
    val fingerprint: String? = null,
    val changedSinceReview: Boolean = false,
    val escalationAccepted: Boolean = false,
    val message: String? = null,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearPluginUpdateReply =
            PearPluginUpdateReply(
                ok = obj.boolean("ok"),
                escalated = obj.boolean("escalated"),
                driveKey = obj.string("driveKey") ?: "",
                version = obj.string("version") ?: "",
                granted = obj.stringList("granted"),
                added = obj.stringList("added"),
                capabilities = obj.stringList("capabilities"),
                fingerprint = obj.string("fingerprint"),
                changedSinceReview = obj.boolean("changedSinceReview"),
                escalationAccepted = obj.boolean("escalationAccepted"),
                message = obj.string("message"),
            )
    }
}

/** One catalogue entry (backend/plugin-catalog.cjs). Metadata only — the
 *  real capability grant always comes from the plugin drive's own manifest
 *  at install time; [capabilities] here is display metadata for the consent
 *  preview. Only builtin entries may carry [verified]. */
data class PearPluginCatalogEntry(
    val id: String,
    val kind: String = "plugin",
    val driveKey: String? = null,
    val name: String = "",
    val description: String = "",
    val author: String = "",
    val capabilities: List<String> = emptyList(),
    val verified: Boolean = false,
    val source: String = "builtin",
    val installed: Boolean = false,
    val unpublished: String? = null,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearPluginCatalogEntry? {
            val id = obj.string("id") ?: return null
            return PearPluginCatalogEntry(
                id = id,
                kind = obj.string("kind") ?: "plugin",
                driveKey = obj.string("driveKey"),
                name = obj.string("name") ?: "",
                description = obj.string("description") ?: "",
                author = obj.string("author") ?: "",
                capabilities = obj.stringList("capabilities"),
                verified = obj.boolean("verified"),
                source = obj.string("source") ?: "builtin",
                installed = obj.boolean("installed"),
                unpublished = obj.string("unpublished"),
            )
        }
    }
}

/** A subscribed catalogue drive (a drive carrying a /plugins.json). */
data class PearPluginCatalogSource(
    val driveKey: String,
    val name: String = "",
    val entryCount: Int = 0,
    val loadedAt: Long = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearPluginCatalogSource? {
            val driveKey = obj.string("driveKey") ?: return null
            return PearPluginCatalogSource(
                driveKey = driveKey,
                name = obj.string("name") ?: "",
                entryCount = obj.int("entryCount"),
                loadedAt = obj.long("loadedAt"),
            )
        }
    }
}

/** PLUGIN_CATALOG reply: builtin seed + subscribed catalogue drives. */
data class PearPluginCatalog(
    val entries: List<PearPluginCatalogEntry> = emptyList(),
    val sources: List<PearPluginCatalogSource> = emptyList(),
) {
    companion object {
        fun fromJson(obj: JsonObject): PearPluginCatalog =
            PearPluginCatalog(
                entries = obj["entries"]?.jsonArrayOrNull()
                    ?.mapNotNull { (it as? JsonObject)?.let(PearPluginCatalogEntry::fromJson) }
                    ?: emptyList(),
                sources = obj["sources"]?.jsonArrayOrNull()
                    ?.mapNotNull { (it as? JsonObject)?.let(PearPluginCatalogSource::fromJson) }
                    ?: emptyList(),
            )
    }
}

/**
 * Shield + privacy-ladder + session-bridge posture snapshot (backend/index.js
 * CMD_PRIVACY_STATUS). Filled by Mission B2: the privacy block carries the
 * live ladder (https-only, tracking strip, cookie drop, farbling, referrer
 * policy, clearnet mode), the session block the SessionBridge status. The
 * proxied-vs-direct toggle is the `clearnetMode` settings key written via
 * setSettings — there is no dedicated command (mirrors the desktop).
 */
data class PearPrivacyStatus(
    val httpsOnly: Boolean = true,
    val stripTrackingParams: Boolean = true,
    val blockThirdPartyCookies: Boolean = true,
    val fingerprintFarbling: Boolean = true,
    val referrerPolicy: String = "strict-origin-when-cross-origin",
    val clearnetMode: String = "proxy",
    val historyEnabled: Boolean = false,
    val searchIndexEnabled: Boolean = false,
    val contentShield: Boolean = true,
    val sessionProxyPort: Int = 0,
    val sessionNativeBridge: Boolean = false,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearPrivacyStatus {
            val privacy = obj["privacy"] as? JsonObject ?: JsonObject(emptyMap())
            val session = obj["session"] as? JsonObject ?: JsonObject(emptyMap())
            return PearPrivacyStatus(
                httpsOnly = privacy.boolean("httpsOnly", true),
                stripTrackingParams = privacy.boolean("stripTrackingParams", true),
                blockThirdPartyCookies = privacy.boolean("blockThirdPartyCookies", true),
                fingerprintFarbling = privacy.boolean("fingerprintFarbling", true),
                referrerPolicy = privacy.string("referrerPolicy") ?: "strict-origin-when-cross-origin",
                clearnetMode = privacy.string("clearnetMode") ?: "proxy",
                historyEnabled = privacy.boolean("historyEnabled"),
                searchIndexEnabled = privacy.boolean("searchIndexEnabled"),
                contentShield = privacy.boolean("contentShield", true),
                sessionProxyPort = session.int("proxyPort"),
                sessionNativeBridge = session.boolean("nativeBridge"),
            )
        }
    }
}

/**
 * One search hit from CMD_SEARCH / the EVT_SEARCH_FEDERATED enrichment
 * (backend/search-core.cjs rankCandidates). `tier` is the trust tier of the
 * source ("self" = your own index, "followed" = a trusted contact's),
 * `trustHop` its hop distance (0 = you). Local-first: hop-0 results arrive in
 * the CMD_SEARCH reply; trusted-peer results arrive later via the event.
 */
data class PearSearchResult(
    val docId: String = "",
    val driveKey: String = "",
    val path: String = "/",
    val title: String = "",
    val link: String? = null,
    val tier: String = "self",
    val trustHop: Int = 0,
) {
    /** The browsable URL for this hit (mirrors desktop resultUrl()). */
    val url: String
        get() {
            link?.let { if (it.isNotBlank()) return it }
            if (driveKey.startsWith("hyper://") || driveKey.startsWith("pear://") || driveKey.startsWith("file://")) return driveKey
            return "hyper://$driveKey${if (path.isNotBlank() && path != "/") path else "/"}"
        }

    companion object {
        fun fromJson(obj: JsonObject): PearSearchResult =
            PearSearchResult(
                docId = obj.string("docId") ?: "",
                driveKey = obj.string("driveKey") ?: "",
                path = obj.string("path") ?: "/",
                title = obj.string("title") ?: "",
                link = obj.string("link"),
                tier = obj.string("tier") ?: "self",
                trustHop = obj.int("trustHop"),
            )
    }
}

/** CMD_SEARCH reply (backend/search-handler.js): local results + index stats;
 *  [federating] true means an enriched peer set will arrive via the
 *  SEARCH_FEDERATED broadcast, correlated by [queryId]. */
data class PearSearchReply(
    val results: List<PearSearchResult> = emptyList(),
    val docs: Int = 0,
    val phase: String = "first-paint",
    val federating: Boolean = false,
    val queryId: Int = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearSearchReply =
            PearSearchReply(
                results = obj["results"]?.jsonArrayOrNull()
                    ?.mapNotNull { (it as? JsonObject)?.let(PearSearchResult::fromJson) } ?: emptyList(),
                docs = (obj["stats"] as? JsonObject)?.int("docs") ?: 0,
                phase = obj.string("phase") ?: "first-paint",
                federating = obj.boolean("federating"),
                queryId = obj.int("queryId"),
            )
    }
}

/** EVT_SEARCH_FEDERATED payload — the enriched, re-ranked trusted-peer set. */
data class PearSearchFederatedEvent(
    val queryId: Int = 0,
    val results: List<PearSearchResult> = emptyList(),
    val verifyBudgetExhausted: Boolean = false,
    val digestHit: Boolean = false,
    val fallbackPull: Boolean = false,
    val partial: Boolean = false,
    val plannedPeers: Int = 0,
    val pulledPeers: Int = 0,
    val digestSkipped: Int = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearSearchFederatedEvent {
            val prov = obj["provenance"] as? JsonObject ?: JsonObject(emptyMap())
            return PearSearchFederatedEvent(
                queryId = obj.int("queryId"),
                results = obj["results"]?.jsonArrayOrNull()
                    ?.mapNotNull { (it as? JsonObject)?.let(PearSearchResult::fromJson) } ?: emptyList(),
                verifyBudgetExhausted = obj.boolean("verifyBudgetExhausted"),
                digestHit = obj.boolean("digestHit"),
                fallbackPull = obj.boolean("fallbackPull"),
                partial = obj.boolean("partial"),
                plannedPeers = prov.int("plannedPeers"),
                pulledPeers = prov.int("pulledPeers"),
                digestSkipped = prov.int("digestSkipped"),
            )
        }
    }
}

/** A resolved name (CMD_NAME_RESOLVE) with its honest provenance label. */
data class PearNameResolution(
    val name: String = "",
    val key: String? = null,
    val link: String? = null,
    val target: String? = null,
    val label: String = "",
    val provenance: String = "",
    val source: String? = null,
    val candidates: Int = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearNameResolution =
            PearNameResolution(
                name = obj.string("name") ?: "",
                key = obj.string("key"),
                link = obj.string("link"),
                target = obj.string("target"),
                label = obj.string("label") ?: "",
                provenance = obj.string("provenance") ?: "",
                source = obj.string("source"),
                candidates = obj.int("candidates"),
            )
    }
}

/** One active N5 registry name (CMD_NAMEREG_LIST / RESOLVE). */
data class PearNameEntry(
    val name: String = "",
    val normalized: String = "",
    val target: String = "",
    val key: String? = null,
    val link: String? = null,
    val owner: String = "",
    val version: Int = 0,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearNameEntry =
            PearNameEntry(
                name = obj.string("name") ?: "",
                normalized = obj.string("normalized") ?: "",
                target = obj.string("target") ?: "",
                key = obj.string("key"),
                link = obj.string("link"),
                owner = obj.string("owner") ?: "",
                version = obj.int("version"),
            )
    }
}

/** CMD_NAMEREG_STATUS reply: whether naming is enabled and the user's
 *  multi-writer registry exists (it is minted lazily on the first claim). */
data class PearNameRegStatus(
    val enabled: Boolean = false,
    val created: Boolean = false,
    val key: String? = null,
    val owner: String? = null,
    val writable: Boolean = false,
    val writerKey: String? = null,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearNameRegStatus =
            PearNameRegStatus(
                enabled = obj.boolean("enabled"),
                created = obj.boolean("created"),
                key = obj.string("key"),
                owner = obj.string("owner"),
                writable = obj.boolean("writable"),
                writerKey = obj.string("writerKey"),
            )
    }
}

/** CMD_RUN_APP_IN_TAB reply (backend/tab-runtime.cjs open()) — the wrapper
 *  URL the shell loads in a tab WebView, plus its page-context token. */
data class PearTabRun(
    val tabId: String = "",
    val url: String = "",
    val contextToken: String = "",
) {
    companion object {
        fun fromJson(obj: JsonObject): PearTabRun =
            PearTabRun(
                tabId = obj.string("tabId") ?: "",
                url = obj.string("url") ?: "",
                contextToken = obj.string("contextToken") ?: "",
            )
    }
}

/** One model alias in CMD_ASK_BROWSER_CAPABILITIES (qvac-service capabilities()). */
data class PearAskModel(
    val alias: String = "",
    val installed: Boolean = false,
    val expectedSize: Long = 0,
    val label: String? = null,
    val provider: String? = null,
    val recommended: Boolean = false,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearAskModel =
            PearAskModel(
                alias = obj.string("alias") ?: "",
                installed = obj.boolean("installed"),
                expectedSize = obj.long("expectedSize"),
                label = obj.string("label"),
                provider = obj.string("provider"),
                recommended = obj.boolean("recommended"),
            )
    }
}

/**
 * CMD_ASK_BROWSER_CAPABILITIES reply — the desktop availability contract
 * (backend/ai/ask-browser-service.cjs). While the QVAC native runtime is not
 * linked into the Android worklet, [available] is false and [reason] carries
 * the typed cause ('runtime-unavailable' / 'runtime-not-configured' /
 * 'service-closed'). Never hardcoded: the value comes from the live service.
 */
data class PearAskCapabilities(
    val available: Boolean = false,
    val local: Boolean = true,
    val streaming: Boolean = true,
    val busy: Boolean = false,
    val queueDepth: Int = 0,
    val models: List<PearAskModel> = emptyList(),
    val activeStreams: Int = 0,
    val reason: String? = null,
) {
    companion object {
        fun fromJson(obj: JsonObject): PearAskCapabilities =
            PearAskCapabilities(
                available = obj.boolean("available"),
                local = obj.boolean("local", true),
                streaming = obj.boolean("streaming", true),
                busy = obj.boolean("busy"),
                queueDepth = obj.int("queueDepth"),
                models = obj["models"]?.jsonArrayOrNull()
                    ?.mapNotNull { (it as? JsonObject)?.let(PearAskModel::fromJson) } ?: emptyList(),
                activeStreams = obj.int("activeStreams"),
                reason = obj.string("reason"),
            )
    }
}

class PearRpcClient(context: Context) : AutoCloseable {
    private val appContext = context.applicationContext
    private val lock = Any()
    private val waiters = mutableListOf<CompletableDeferred<IPearRpcService>>()

    private var service: IPearRpcService? = null
    private var bindRequested = false

    private val _bindingState = MutableStateFlow(PearRpcBindingState())
    val bindingState: StateFlow<PearRpcBindingState> = _bindingState

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            if (binder == null) {
                markDisconnected("Pear worklet service returned no Binder")
                return
            }
            val remote = IPearRpcService.Stub.asInterface(binder)
            val pending = synchronized(lock) {
                service = remote
                bindRequested = true
                waiters.toList().also { waiters.clear() }
            }
            _bindingState.value = PearRpcBindingState(connected = true)
            pending.forEach { it.complete(remote) }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            markDisconnected("Pear worklet service disconnected")
        }

        override fun onBindingDied(name: ComponentName?) {
            markDisconnected("Pear worklet service binding died")
        }

        override fun onNullBinding(name: ComponentName?) {
            markDisconnected("Pear worklet service returned no Binder")
        }
    }

    fun connect() {
        synchronized(lock) {
            if (service != null || bindRequested) return
            bindRequested = true
        }
        _bindingState.value = PearRpcBindingState(connecting = true)

        try {
            PearWorkletService.start(appContext)
            val bound = appContext.bindService(
                Intent(appContext, PearWorkletService::class.java),
                connection,
                Context.BIND_AUTO_CREATE,
            )
            if (!bound) {
                markDisconnected("Could not bind to Pear worklet service")
            }
        } catch (e: Throwable) {
            Log.w(TAG, "bindService failed", e)
            markDisconnected(e.message ?: "Could not bind to Pear worklet service")
        }
    }

    suspend fun request(
        command: Int,
        data: JsonElement = JsonNull,
        bindTimeoutMs: Long = 10_000,
    ): JsonElement {
        val remote = awaitService(bindTimeoutMs)
        return suspendCancellableCoroutine { cont ->
            val callback = object : IPearRpcCallback.Stub() {
                override fun onSuccess(resultJson: String?) {
                    val parsed = try {
                        if (resultJson.isNullOrBlank()) JsonNull else Json.parseToJsonElement(resultJson)
                    } catch (e: Throwable) {
                        if (cont.isActive) cont.resumeWithException(e)
                        return
                    }
                    if (cont.isActive) cont.resume(parsed)
                }

                override fun onError(message: String?) {
                    if (cont.isActive) {
                        cont.resumeWithException(RuntimeException(message ?: "RPC request failed"))
                    }
                }
            }

            try {
                remote.request(command, data.toString(), callback)
            } catch (e: Throwable) {
                if (cont.isActive) cont.resumeWithException(e)
            }
        }
    }

    suspend fun getStatus(): PearRpcStatus =
        PearRpcStatus.fromJson(request(Cmd.GET_STATUS).jsonObject)

    suspend fun navigate(url: String): JsonObject =
        request(
            Cmd.NAVIGATE,
            buildJsonObject { put("url", url) },
            bindTimeoutMs = 60_000,
        ).jsonObject

    suspend fun loadCatalog(keyHex: String): JsonObject =
        request(
            Cmd.LOAD_CATALOG,
            buildJsonObject { put("keyHex", keyHex) },
            bindTimeoutMs = 60_000,
        ).jsonObject

    suspend fun loadCatalogBee(keyHex: String, signed: Boolean = false): JsonObject =
        request(
            Cmd.LOAD_CATALOG_BEE,
            buildJsonObject {
                put("keyHex", keyHex)
                if (signed) put("signed", true)
            },
            bindTimeoutMs = 60_000,
        ).jsonObject

    suspend fun loadSignedCatalogBee(keyHex: String): JsonObject =
        loadCatalogBee(keyHex, signed = true)

    suspend fun getSettings(): PearSettings {
        val root = request(Cmd.USERDATA_GET_SETTINGS).jsonObject
        return PearSettings.fromJson(root["settings"]?.jsonObjectOrNull() ?: JsonObject(emptyMap()))
    }

    suspend fun listBookmarks(): List<PearBookmark> {
        val root = request(Cmd.USERDATA_LIST_BOOKMARKS).jsonObject
        val bookmarks = root["bookmarks"]?.jsonArrayOrNull() ?: JsonArray(emptyList())
        return bookmarks.mapNotNull { (it as? JsonObject)?.let(PearBookmark::fromJson) }
    }

    suspend fun addBookmark(url: String, title: String): JsonElement =
        request(Cmd.USERDATA_ADD_BOOKMARK, buildJsonObject {
            put("url", url)
            put("title", title)
        })

    suspend fun removeBookmark(url: String): JsonElement =
        request(Cmd.USERDATA_REMOVE_BOOKMARK, buildJsonObject { put("url", url) })

    suspend fun listHistory(limit: Int? = null): List<PearHistoryEntry> {
        val root = request(Cmd.USERDATA_LIST_HISTORY, buildJsonObject {
            limit?.let { put("limit", it) }
        }).jsonObject
        val history = root["history"]?.jsonArrayOrNull() ?: JsonArray(emptyList())
        return history.mapNotNull { (it as? JsonObject)?.let(PearHistoryEntry::fromJson) }
    }

    suspend fun addHistory(url: String, title: String): JsonElement =
        request(Cmd.USERDATA_ADD_HISTORY, buildJsonObject {
            put("url", url)
            put("title", title)
        })

    suspend fun clearHistory(): JsonElement =
        request(Cmd.USERDATA_CLEAR_HISTORY)

    suspend fun setSettings(updates: JsonObject): JsonElement =
        request(Cmd.USERDATA_SET_SETTINGS, buildJsonObject { put("updates", updates) })

    /**
     * Raw mirror of the backend session KV (backend/user-data.js
     * `getSession()`): returns the stored session object, or an empty object
     * when none was ever saved. Merge-before-write is the caller's job —
     * MainActivity mirrors app/lib/storage.ts `saveSession(partial)`.
     */
    suspend fun getSession(): JsonObject {
        val root = request(Cmd.USERDATA_GET_SESSION).jsonObject
        return root["session"]?.jsonObjectOrNull() ?: JsonObject(emptyMap())
    }

    suspend fun saveSession(state: JsonObject): JsonElement =
        request(Cmd.USERDATA_SAVE_SESSION, buildJsonObject { put("state", state) })

    suspend fun getRelays(): PearRelayConfig =
        PearRelayConfig.fromJson(request(Cmd.GET_RELAYS).jsonObject)

    suspend fun setRelays(relays: List<String>): JsonElement =
        request(Cmd.SET_RELAYS, buildJsonObject {
            putJsonArray("relays") { relays.forEach { add(it) } }
        })

    suspend fun setRelayEnabled(enabled: Boolean): JsonElement =
        request(Cmd.SET_RELAY_ENABLED, buildJsonObject { put("enabled", enabled) })

    suspend fun profileGet(): PearProfile {
        val root = request(Cmd.PROFILE_GET).jsonObject
        return PearProfile.fromJson(root["profile"]?.jsonObjectOrNull() ?: JsonObject(emptyMap()))
    }

    suspend fun profileUpdate(updates: JsonObject): PearProfile {
        val root = request(Cmd.PROFILE_UPDATE, buildJsonObject { put("updates", updates) }).jsonObject
        return PearProfile.fromJson(root["profile"]?.jsonObjectOrNull() ?: JsonObject(emptyMap()))
    }

    suspend fun profileClear(): JsonElement =
        request(Cmd.PROFILE_CLEAR)

    suspend fun trustedOriginsList(): PearTrustedOrigins =
        PearTrustedOrigins.fromJson(request(Cmd.TRUSTED_ORIGINS_LIST).jsonObject)

    suspend fun trustedOriginsAdd(origin: String): JsonElement =
        request(Cmd.TRUSTED_ORIGINS_ADD, buildJsonObject { put("origin", origin) })

    suspend fun trustedOriginsRemove(origin: String): JsonElement =
        request(Cmd.TRUSTED_ORIGINS_REMOVE, buildJsonObject { put("origin", origin) })

    suspend fun trustedOriginsSetMode(mode: String): JsonElement =
        request(Cmd.TRUSTED_ORIGINS_SET_MODE, buildJsonObject { put("mode", mode) })

    // --- Site Builder (backend/site-manager.js) ---

    suspend fun listSites(): List<PearSite> {
        val root = request(Cmd.LIST_SITES)
        // site-manager returns a bare array; tolerate a { sites: [...] } wrap.
        val arr = when (root) {
            is JsonArray -> root
            is JsonObject -> root["sites"]?.jsonArrayOrNull()
            else -> null
        } ?: JsonArray(emptyList())
        return arr.mapNotNull { (it as? JsonObject)?.let(PearSite::fromJson) }
    }

    suspend fun createSite(name: String): JsonObject =
        request(Cmd.CREATE_SITE, buildJsonObject { put("name", name) }).jsonObject

    /**
     * Save a block-built site. CMD_UPDATE_SITE routes to
     * `siteManager.buildFromBlocks(siteId, blocks, theme)` when `blocks`
     * is present — see backend/index.js + site-manager.js `_renderBlocks`.
     */
    suspend fun updateSite(siteId: String, blocks: JsonArray, theme: JsonObject): JsonElement =
        request(Cmd.UPDATE_SITE, buildJsonObject {
            put("siteId", siteId)
            put("blocks", blocks)
            put("theme", theme)
        }, bindTimeoutMs = 60_000)

    suspend fun publishSite(siteId: String): JsonObject =
        request(Cmd.PUBLISH_SITE, buildJsonObject { put("siteId", siteId) }, bindTimeoutMs = 60_000).jsonObject

    suspend fun unpublishSite(siteId: String): JsonElement =
        request(Cmd.UNPUBLISH_SITE, buildJsonObject { put("siteId", siteId) })

    suspend fun deleteSite(siteId: String): JsonElement =
        request(Cmd.DELETE_SITE, buildJsonObject { put("siteId", siteId) })

    // --- App install / launch (backend/app-manager.js) ---

    /**
     * Install a catalog app. `driveKey` is the 64-hex Hyperdrive key; the
     * backend downloads the drive and reports progress over
     * EVT_INSTALL_PROGRESS. Long bind timeout mirrors app/lib/rpc.ts.
     */
    suspend fun installApp(id: String, driveKey: String, name: String, version: String? = null): JsonObject =
        request(Cmd.INSTALL_APP, buildJsonObject {
            put("id", id)
            put("driveKey", driveKey)
            put("name", name)
            version?.let { put("version", it) }
        }, bindTimeoutMs = 120_000).jsonObject

    /**
     * Launch an installed app. Returns `{ localUrl, appId, name, driveKey,
     * apiToken }` — callers open `hyper://<driveKey>` in the Browse tab
     * (mirrors app/App.tsx `handleLaunchApp`), which re-navigates through
     * CMD_NAVIGATE and gets a fresh bridge token.
     */
    suspend fun launchApp(id: String): JsonObject =
        request(Cmd.LAUNCH_APP, buildJsonObject { put("id", id) }, bindTimeoutMs = 60_000).jsonObject

    suspend fun listInstalled(): List<PearInstalledApp> {
        val root = request(Cmd.LIST_INSTALLED)
        val arr = when (root) {
            is JsonArray -> root
            is JsonObject -> root["apps"]?.jsonArrayOrNull()
            else -> null
        } ?: JsonArray(emptyList())
        return arr.mapNotNull { (it as? JsonObject)?.let(PearInstalledApp::fromJson) }
    }

    suspend fun exportPhrase(): String =
        request(Cmd.IDENTITY_EXPORT_PHRASE).jsonObject["mnemonic"]?.jsonPrimitive?.contentOrNull ?: ""

    suspend fun importPhrase(mnemonic: String): JsonObject =
        request(Cmd.IDENTITY_IMPORT_PHRASE, buildJsonObject { put("mnemonic", mnemonic) }).jsonObject

    suspend fun validatePhrase(mnemonic: String): Boolean =
        request(Cmd.IDENTITY_VALIDATE_PHRASE, buildJsonObject { put("mnemonic", mnemonic) })
            .jsonObject["valid"]?.jsonPrimitive?.booleanOrNull ?: false

    suspend fun loginListGrants(): JsonArray =
        request(Cmd.LOGIN_LIST_GRANTS).jsonObject["grants"]?.jsonArrayOrNull() ?: JsonArray(emptyList())

    suspend fun loginRevokeGrant(driveKeyHex: String): JsonElement =
        request(Cmd.LOGIN_REVOKE_GRANT, buildJsonObject { put("driveKeyHex", driveKeyHex) })

    suspend fun loginRevokeAll(): JsonElement =
        request(Cmd.LOGIN_REVOKE_ALL)

    suspend fun swarmListGrants(driveKey: String? = null): JsonArray =
        request(Cmd.SWARM_LIST_GRANTS, buildJsonObject {
            driveKey?.let { put("driveKey", it) }
        }).jsonObject["grants"]?.jsonArrayOrNull() ?: JsonArray(emptyList())

    suspend fun swarmRevokeGrant(driveKey: String, topicHex: String): JsonElement =
        request(Cmd.SWARM_REVOKE_GRANT, buildJsonObject {
            put("driveKey", driveKey)
            put("topicHex", topicHex)
        })

    suspend fun swarmRevokeAllForApp(driveKey: String): JsonElement =
        request(Cmd.SWARM_REVOKE_ALL_FOR_APP, buildJsonObject { put("driveKey", driveKey) })

    // --- Content Shield (backend/content-shield.cjs + shield-list-sync.cjs) ---

    /**
     * Live shield status + counters. Pass a 64-hex [driveKey] to also get
     * that drive's allowlist/strict state (the desktop panel's per-drive
     * toggles read the same fields).
     */
    suspend fun getShieldStatus(driveKey: String? = null): PearShieldStatus =
        PearShieldStatus.fromJson(request(Cmd.SHIELD_STATUS, buildJsonObject {
            driveKey?.let { put("driveKey", it) }
        }).jsonObject)

    /** Exempt (or re-block) one drive from request blocking and injection. */
    suspend fun setShieldAllow(driveKey: String, allow: Boolean): JsonElement =
        request(Cmd.SHIELD_SET_ALLOW, buildJsonObject {
            put("driveKey", driveKey)
            put("allow", allow)
        })

    /** Toggle the per-drive strict third-party CSP meta injection. */
    suspend fun setShieldStrict(driveKey: String, strict: Boolean): JsonElement =
        request(Cmd.SHIELD_SET_STRICT, buildJsonObject {
            put("driveKey", driveKey)
            put("strict", strict)
        })

    /**
     * Subscribe to a filter-list Hyperdrive by key. The backend fetches
     * /manifest.json + /filters.txt over the swarm, verifies the sha256,
     * and hot-swaps the rules — hence the longer timeout.
     */
    suspend fun subscribeList(driveKey: String): JsonObject =
        request(
            Cmd.SHIELD_SUBSCRIBE_LIST,
            buildJsonObject { put("driveKey", driveKey) },
            bindTimeoutMs = 60_000,
        ).jsonObject

    suspend fun unsubscribeList(driveKey: String): JsonObject =
        request(Cmd.SHIELD_UNSUBSCRIBE_LIST, buildJsonObject { put("driveKey", driveKey) }).jsonObject

    /** Refresh one subscription ([driveKey] != null) or sweep all of them. */
    suspend fun refreshLists(driveKey: String? = null, force: Boolean = false): JsonObject =
        request(
            Cmd.SHIELD_REFRESH_LISTS,
            buildJsonObject {
                driveKey?.let { put("driveKey", it) }
                if (force) put("force", true)
            },
            bindTimeoutMs = 60_000,
        ).jsonObject

    // --- Pear Plugins (Mission B4a — backend/pear-plugins.cjs +
    // plugin-drive-loader.cjs + plugin-catalog.cjs, ported from
    // pearbrowser-desktop Phase 3). PLUGIN_REGISTER stays backend-only:
    // it is the desktop's fixture/test path, not a UI surface.

    /** Installed plugins with their granted capabilities + kill-switch state. */
    suspend fun pluginList(): List<PearPluginInfo> =
        request(Cmd.PLUGIN_LIST).jsonObject["plugins"]?.jsonArrayOrNull()
            ?.mapNotNull { (it as? JsonObject)?.let(PearPluginInfo::fromJson) }
            ?: emptyList()

    /** Kill switch: disable (or re-enable) a plugin's contributions without uninstalling. */
    suspend fun pluginSetEnabled(id: String, enabled: Boolean): JsonObject =
        request(Cmd.PLUGIN_SET_ENABLED, buildJsonObject {
            put("id", id)
            put("enabled", enabled)
        }).jsonObject

    /**
     * Install a plugin from its Hyperdrive. Two-step consent: call with just
     * [driveKey] for the preview (requested capabilities + snapshot
     * fingerprint), then again with [granted] + [reviewedFingerprint] echoing
     * the preview to accept. Drive fetch goes over the swarm — long timeout.
     */
    suspend fun pluginInstallDrive(
        driveKey: String,
        granted: List<String>? = null,
        reviewedFingerprint: String? = null,
    ): PearPluginInstallReply =
        PearPluginInstallReply.fromJson(request(
            Cmd.PLUGIN_INSTALL_DRIVE,
            buildJsonObject {
                put("driveKey", driveKey)
                granted?.let { caps -> putJsonArray("granted") { caps.forEach { add(it) } } }
                reviewedFingerprint?.let { put("reviewedFingerprint", it) }
            },
            bindTimeoutMs = 60_000,
        ).jsonObject)

    /**
     * Update an installed plugin from its drive. A same-capability update
     * hot-swaps silently; an escalation auto-disables the plugin and returns
     * [PearPluginUpdateReply.escalated] — accept by re-calling with
     * [granted] = reply.capabilities + [reviewedFingerprint] = reply.fingerprint.
     */
    suspend fun pluginUpdateDrive(
        driveKey: String,
        granted: List<String>? = null,
        reviewedFingerprint: String? = null,
    ): PearPluginUpdateReply =
        PearPluginUpdateReply.fromJson(request(
            Cmd.PLUGIN_UPDATE_DRIVE,
            buildJsonObject {
                put("driveKey", driveKey)
                granted?.let { caps -> putJsonArray("granted") { caps.forEach { add(it) } } }
                reviewedFingerprint?.let { put("reviewedFingerprint", it) }
            },
            bindTimeoutMs = 60_000,
        ).jsonObject)

    /** Uninstall a plugin: drops the registration, grant record, and rules. */
    suspend fun pluginUninstall(driveKey: String): JsonObject =
        request(Cmd.PLUGIN_UNINSTALL, buildJsonObject { put("driveKey", driveKey) }).jsonObject

    /** Catalogue listing: builtin seed + subscribed catalogue drives. */
    suspend fun pluginCatalog(): PearPluginCatalog =
        PearPluginCatalog.fromJson(request(Cmd.PLUGIN_CATALOG).jsonObject)

    /** Subscribe to a catalogue drive (a drive carrying a /plugins.json). */
    suspend fun pluginCatalogLoadDrive(driveKey: String): JsonObject =
        request(
            Cmd.PLUGIN_CATALOG_LOAD_DRIVE,
            buildJsonObject { put("driveKey", driveKey) },
            bindTimeoutMs = 60_000,
        ).jsonObject

    /** Drop a subscribed catalogue source (builtin cannot be removed). */
    suspend fun pluginCatalogRemoveSource(driveKey: String): JsonObject =
        request(Cmd.PLUGIN_CATALOG_REMOVE_SOURCE, buildJsonObject { put("driveKey", driveKey) }).jsonObject

    // --- Clearnet & privacy (Mission B2 — backend/session-bridge.cjs) ---

    /**
     * Privacy-ladder + session-bridge snapshot (CMD_PRIVACY_STATUS). The
     * ladder toggles themselves are settings keys written via [setSettings]
     * (`clearnetMode`, `httpsOnly`, `stripTrackingParams`,
     * `blockThirdPartyCookies`, `fingerprintFarbling`) — same as desktop.
     */
    suspend fun getPrivacyStatus(): PearPrivacyStatus =
        PearPrivacyStatus.fromJson(request(Cmd.PRIVACY_STATUS).jsonObject)

    // --- Local-first search + names (Mission B3 — backend/search-handler.js,
    // backend/names.cjs, backend/name-registry-store.cjs) ---

    /**
     * Query the personal index. Local results come back in the reply; when
     * [federated] and a query planner exists, the enriched trusted-peer set
     * arrives later as an ACTION_SEARCH_FEDERATED broadcast correlated by
     * queryId (backend/search-handler.js — stale queries are suppressed).
     */
    suspend fun search(query: String, limit: Int = 50, federated: Boolean = false): PearSearchReply =
        PearSearchReply.fromJson(
            request(Cmd.SEARCH, buildJsonObject {
                put("query", query)
                put("limit", limit)
                if (federated) put("federated", true)
            }, bindTimeoutMs = 60_000).jsonObject,
        )

    /**
     * Resolve a typed name / pearname:// word through the tiered resolver
     * (petname → own registry → trusted contacts → curated floor). Returns
     * null when naming is disabled or nothing resolves.
     */
    suspend fun nameResolve(name: String): PearNameResolution? {
        val root = request(Cmd.NAME_RESOLVE, buildJsonObject { put("name", name) }, bindTimeoutMs = 60_000).jsonObject
        return (root["resolved"] as? JsonObject)?.let(PearNameResolution::fromJson)
    }

    /** N5 registry status: naming flag + whether the user's registry exists. */
    suspend fun nameregStatus(): PearNameRegStatus =
        PearNameRegStatus.fromJson(request(Cmd.NAMEREG_STATUS).jsonObject)

    /** The user's active registry names. */
    suspend fun nameregList(): List<PearNameEntry> {
        val root = request(Cmd.NAMEREG_LIST).jsonObject
        return root["names"]?.jsonArrayOrNull()
            ?.mapNotNull { (it as? JsonObject)?.let(PearNameEntry::fromJson) } ?: emptyList()
    }

    /** Claim a name → a 64-hex drive key or pear://, hyper://, file:// link. */
    suspend fun nameregClaim(name: String, target: String): JsonObject =
        request(Cmd.NAMEREG_CLAIM, buildJsonObject {
            put("name", name)
            put("target", target)
        }, bindTimeoutMs = 60_000).jsonObject

    /** Re-point a name the user already owns (monotonic version). */
    suspend fun nameregRotate(name: String, target: String): JsonObject =
        request(Cmd.NAMEREG_ROTATE, buildJsonObject {
            put("name", name)
            put("target", target)
        }, bindTimeoutMs = 60_000).jsonObject

    /** Release a name (frees it + its confusable skeleton for re-claim). */
    suspend fun nameregRelease(name: String): JsonElement =
        request(Cmd.NAMEREG_RELEASE, buildJsonObject { put("name", name) })

    /** Revoke a name (tombstone — name AND skeleton stay blocked). */
    suspend fun nameregRevoke(name: String): JsonElement =
        request(Cmd.NAMEREG_REVOKE, buildJsonObject { put("name", name) })

    suspend fun deviceLinkCreateInvite(): JsonObject =
        request(Cmd.DEVICE_LINK_CREATE_INVITE).jsonObject

    suspend fun deviceLinkJoin(invite: String, device: String = "this device"): JsonObject =
        request(
            Cmd.DEVICE_LINK_JOIN,
            buildJsonObject {
                put("invite", invite)
                put("device", device)
            },
            bindTimeoutMs = 120_000,
        ).jsonObject

    suspend fun isBackendAvailable(): Boolean =
        try {
            awaitService().isBackendAvailable()
        } catch (_: Throwable) {
            false
        }

    override fun close() {
        val shouldUnbind = synchronized(lock) {
            val wasBound = bindRequested || service != null
            service = null
            bindRequested = false
            waiters.forEach { it.completeExceptionally(IllegalStateException("PearRpcClient closed")) }
            waiters.clear()
            wasBound
        }
        if (shouldUnbind) {
            try {
                appContext.unbindService(connection)
            } catch (_: Throwable) {
            }
        }
        _bindingState.value = PearRpcBindingState()
    }

    // --- TabRuntime + Ask Browser (Mission B4b — backend/tab-runtime.cjs and
    // backend/ai/ask-browser-service.cjs, gated ports from pearbrowser-desktop) ---

    /**
     * Run a pear-request app headless in a tab. "demo" uses the backend's
     * in-proc router and works on Android; pear:// / file:// links need a
     * pear-run worker process, which the worklet cannot spawn — the backend
     * then rejects the command with a typed 'runtime-unavailable' error.
     */
    suspend fun runAppInTab(link: String = "demo"): PearTabRun =
        PearTabRun.fromJson(
            request(Cmd.RUN_APP_IN_TAB, buildJsonObject { put("link", link) }).jsonObject
        )

    /**
     * Ask Browser availability — the desktop contract, read live from the
     * backend. On Android this reports available=false with reason
     * 'runtime-unavailable' until the QVAC native addon is linked into the
     * worklet; it is never a hardcoded "available".
     */
    suspend fun askBrowserCapabilities(): PearAskCapabilities =
        PearAskCapabilities.fromJson(request(Cmd.ASK_BROWSER_CAPABILITIES).jsonObject)

    /**
     * Start an Ask Browser page-Q&A stream. Fails closed with a typed
     * 'runtime-unavailable' error while the QVAC runtime is gated; with a
     * runtime present, streamed tokens arrive as EVT_ASK_BROWSER_STREAM
     * payloads correlated by [streamId].
     */
    suspend fun askBrowserStart(
        streamId: String,
        model: String,
        question: String,
        page: JsonObject? = null,
        history: JsonArray? = null,
        maxTokens: Int? = null,
        temperature: Double? = null,
    ): JsonObject =
        request(Cmd.ASK_BROWSER_START, buildJsonObject {
            put("streamId", streamId)
            put("model", model)
            put("question", question)
            page?.let { put("page", it) }
            history?.let { put("history", it) }
            maxTokens?.let { put("maxTokens", it) }
            temperature?.let { put("temperature", it) }
        }).jsonObject

    /** Cancel a running Ask Browser stream; reply carries { ok: false } when
     *  the stream id is unknown or already finished. */
    suspend fun askBrowserCancel(streamId: String): JsonObject =
        request(Cmd.ASK_BROWSER_CANCEL, buildJsonObject { put("streamId", streamId) }).jsonObject

    private suspend fun awaitService(timeoutMs: Long = 10_000): IPearRpcService {
        synchronized(lock) { service }?.let { return it }
        connect()

        val deferred = CompletableDeferred<IPearRpcService>()
        synchronized(lock) {
            service?.let {
                deferred.complete(it)
            } ?: waiters.add(deferred)
        }

        return try {
            withTimeout(timeoutMs) { deferred.await() }
        } finally {
            if (!deferred.isCompleted) {
                synchronized(lock) { waiters.remove(deferred) }
            }
        }
    }

    private fun markDisconnected(message: String) {
        val pending = synchronized(lock) {
            service = null
            bindRequested = false
            waiters.toList().also { waiters.clear() }
        }
        _bindingState.value = PearRpcBindingState(error = message)
        pending.forEach { it.completeExceptionally(IllegalStateException(message)) }
    }

    companion object {
        private const val TAG = "PearRpcClient"
    }
}

private const val DEFAULT_CATALOG_URL = "https://relay-us.p2phiverelay.xyz"
private val DEFAULT_CATALOGS = listOf(
    DEFAULT_CATALOG_URL,
    "https://relay-sg.p2phiverelay.xyz",
)

private fun JsonObject.boolean(key: String, default: Boolean = false): Boolean =
    this[key]?.jsonPrimitive?.booleanOrNull ?: default

private fun JsonObject.int(key: String, default: Int = 0): Int =
    this[key]?.jsonPrimitive?.intOrNull ?: default

private fun JsonObject.long(key: String, default: Long = 0): Long =
    this[key]?.jsonPrimitive?.longOrNull ?: default

private fun JsonObject.string(key: String): String? =
    this[key]?.jsonPrimitive?.contentOrNull

private fun JsonObject.stringList(key: String): List<String> =
    this[key]?.jsonArrayOrNull()?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()

private fun JsonElement.jsonObjectOrNull(): JsonObject? =
    this as? JsonObject

private fun JsonElement.jsonArrayOrNull(): JsonArray? =
    this as? JsonArray
