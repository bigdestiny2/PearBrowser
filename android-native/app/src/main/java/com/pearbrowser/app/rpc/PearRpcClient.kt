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
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
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

    suspend fun getSettings(): PearSettings {
        val root = request(Cmd.USERDATA_GET_SETTINGS).jsonObject
        return PearSettings.fromJson(root["settings"]?.jsonObjectOrNull() ?: JsonObject(emptyMap()))
    }

    suspend fun listBookmarks(): List<PearBookmark> {
        val root = request(Cmd.USERDATA_LIST_BOOKMARKS).jsonObject
        val bookmarks = root["bookmarks"]?.jsonArrayOrNull() ?: JsonArray(emptyList())
        return bookmarks.mapNotNull { (it as? JsonObject)?.let(PearBookmark::fromJson) }
    }

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
