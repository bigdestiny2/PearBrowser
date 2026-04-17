package com.pearbrowser.app.rpc

import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * PearRpc — Kotlin IPC client for the Bare worklet.
 *
 * Wire format mirrors `backend/rpc.js` + `app/lib/rpc.ts` (Phase 0/1):
 *
 *   [4-byte little-endian length][JSON payload]
 *
 *   Request  : { id: int, cmd: int, data: any }
 *   Response : { id: int, ok: bool, result?: any, error?: string }
 *   Event    : { evt: int, data: any }   (no id)
 *
 * The [ipc] interface is an abstraction over the bare-kit Worklet.IPC so
 * we can unit-test the protocol logic without needing a live worklet.
 *
 * See docs/HOLEPUNCH_ALIGNMENT_PLAN.md, Phase 2 ticket 3.
 */
interface WorkletIpc {
    /** Write a byte array to the worklet. Framing is added by PearRpc. */
    fun write(bytes: ByteArray)

    /** Register a listener for incoming bytes. Multiple framed messages may
     *  arrive together — the protocol layer deframes them. */
    fun onData(listener: (ByteArray) -> Unit)

    /** Detach everything. Called on shutdown. */
    fun close()
}

class PearRpc(
    private val ipc: WorkletIpc,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    companion object { private const val TAG = "PearRpc" }

    private val nextId = AtomicInteger(1)
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<JsonElement>>()
    private val eventListeners = ConcurrentHashMap<Int, MutableList<(JsonElement) -> Unit>>()
    private val writeLock = Mutex()

    private var buffer = ByteArrayOutputStream()
    private val job: Job

    init {
        ipc.onData { chunk -> onBytes(chunk) }
        // Minimal keepalive: nothing to do, but we hold a job reference so the
        // scope isn't accidentally GCed. Real cleanup happens in close().
        job = scope.launch { /* noop */ }
    }

    // ---------- Public API ----------

    suspend fun request(cmd: Int, data: JsonElement = JsonNull, timeoutMs: Long = 30_000): JsonElement {
        val id = nextId.getAndIncrement()
        val payload = buildJsonObject {
            put("id", id)
            put("cmd", cmd)
            put("data", data)
        }
        val deferred = CompletableDeferred<JsonElement>()
        pending[id] = deferred
        sendFramed(payload.toString().toByteArray(Charsets.UTF_8))
        return try {
            withTimeout(timeoutMs) { deferred.await() }
        } catch (e: Throwable) {
            pending.remove(id)
            throw e
        }
    }

    fun on(event: Int, listener: (JsonElement) -> Unit): () -> Unit {
        val list = eventListeners.getOrPut(event) { mutableListOf() }
        synchronized(list) { list.add(listener) }
        return {
            synchronized(list) { list.remove(listener) }
        }
    }

    fun close() {
        scope.cancel()
        ipc.close()
        pending.values.forEach { it.cancel() }
        pending.clear()
        eventListeners.clear()
    }

    // ---------- Convenience typed wrappers ----------
    // These mirror the methods in app/lib/rpc.ts so screen code can use
    // a high-level Kotlin API instead of raw JSON.

    suspend fun getStatus(): JsonObject =
        request(Cmd.GET_STATUS).jsonObject

    suspend fun navigate(url: String): JsonObject =
        request(Cmd.NAVIGATE, buildJsonObject { put("url", url) }, timeoutMs = 60_000).jsonObject

    suspend fun loadCatalog(keyHex: String): JsonObject =
        request(Cmd.LOAD_CATALOG, buildJsonObject { put("keyHex", keyHex) }, timeoutMs = 60_000).jsonObject

    suspend fun loadCatalogBee(keyHex: String): JsonObject =
        request(Cmd.LOAD_CATALOG_BEE, buildJsonObject { put("keyHex", keyHex) }, timeoutMs = 60_000).jsonObject

    suspend fun launchApp(appId: String): JsonObject =
        request(Cmd.LAUNCH_APP, buildJsonObject { put("appId", appId) }).jsonObject

    suspend fun listSites(): JsonArray =
        request(Cmd.LIST_SITES).jsonArray

    suspend fun getIdentity(): JsonObject =
        request(Cmd.GET_IDENTITY).jsonObject

    suspend fun getRelays(): JsonObject =
        request(Cmd.GET_RELAYS).jsonObject

    suspend fun setRelays(relays: List<String>): JsonObject =
        request(Cmd.SET_RELAYS, buildJsonObject {
            putJsonArray("relays") { relays.forEach { add(it) } }
        }).jsonObject

    suspend fun setRelayEnabled(enabled: Boolean): JsonObject =
        request(Cmd.SET_RELAY_ENABLED, buildJsonObject { put("enabled", enabled) }).jsonObject

    suspend fun listBookmarks(): JsonArray =
        request(Cmd.USERDATA_LIST_BOOKMARKS).jsonObject["bookmarks"]!!.jsonArray

    suspend fun addBookmark(url: String, title: String): JsonElement =
        request(Cmd.USERDATA_ADD_BOOKMARK, buildJsonObject {
            put("url", url); put("title", title)
        })

    suspend fun removeBookmark(url: String): JsonElement =
        request(Cmd.USERDATA_REMOVE_BOOKMARK, buildJsonObject { put("url", url) })

    suspend fun listHistory(limit: Int? = null): JsonArray {
        val res = request(Cmd.USERDATA_LIST_HISTORY, buildJsonObject { limit?.let { put("limit", it) } })
        return res.jsonObject["history"]!!.jsonArray
    }

    suspend fun addHistory(url: String, title: String): JsonElement =
        request(Cmd.USERDATA_ADD_HISTORY, buildJsonObject {
            put("url", url); put("title", title)
        })

    suspend fun clearHistory(): JsonElement =
        request(Cmd.USERDATA_CLEAR_HISTORY)

    suspend fun getSettings(): JsonObject =
        request(Cmd.USERDATA_GET_SETTINGS).jsonObject["settings"]!!.jsonObject

    suspend fun setSettings(updates: JsonObject): JsonElement =
        request(Cmd.USERDATA_SET_SETTINGS, buildJsonObject { put("updates", updates) })

    suspend fun exportPhrase(): String =
        request(Cmd.IDENTITY_EXPORT_PHRASE).jsonObject["mnemonic"]!!.jsonPrimitive.content

    suspend fun importPhrase(mnemonic: String): JsonObject =
        request(Cmd.IDENTITY_IMPORT_PHRASE, buildJsonObject { put("mnemonic", mnemonic) }).jsonObject

    suspend fun validatePhrase(mnemonic: String): Boolean =
        request(Cmd.IDENTITY_VALIDATE_PHRASE, buildJsonObject { put("mnemonic", mnemonic) })
            .jsonObject["valid"]!!.jsonPrimitive.boolean

    // ---------- Internal framing ----------

    private suspend fun sendFramed(bytes: ByteArray) {
        writeLock.withLock {
            val frame = ByteArray(4 + bytes.size)
            val buf = ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN)
            buf.putInt(bytes.size)
            buf.put(bytes)
            ipc.write(frame)
        }
    }

    private fun onBytes(chunk: ByteArray) {
        buffer.write(chunk)
        while (true) {
            val current = buffer.toByteArray()
            if (current.size < 4) return
            val len = ByteBuffer.wrap(current, 0, 4).order(ByteOrder.LITTLE_ENDIAN).int
            if (len < 0 || len > 10_000_000) {
                Log.e(TAG, "Bad frame length $len; resetting buffer")
                buffer = ByteArrayOutputStream()
                return
            }
            if (current.size < 4 + len) return
            val payload = current.copyOfRange(4, 4 + len)
            // Shift remaining
            buffer = ByteArrayOutputStream().apply {
                write(current, 4 + len, current.size - 4 - len)
            }
            handleMessage(payload)
        }
    }

    private fun handleMessage(payload: ByteArray) {
        val text = String(payload, Charsets.UTF_8)
        val json = try {
            Json.parseToJsonElement(text).jsonObject
        } catch (e: Exception) {
            Log.w(TAG, "Invalid JSON from worklet: ${text.take(200)}", e)
            return
        }
        // Event?
        json["evt"]?.jsonPrimitive?.intOrNull?.let { evtId ->
            val data = json["data"] ?: JsonNull
            eventListeners[evtId]?.toList()?.forEach { listener ->
                try { listener(data) } catch (e: Throwable) { Log.w(TAG, "event listener threw", e) }
            }
            return
        }
        // Response
        val id = json["id"]?.jsonPrimitive?.intOrNull ?: return
        val deferred = pending.remove(id) ?: return
        if (json["ok"]?.jsonPrimitive?.boolean == true) {
            deferred.complete(json["result"] ?: JsonNull)
        } else {
            val msg = json["error"]?.jsonPrimitive?.content ?: "RPC error"
            deferred.completeExceptionally(RuntimeException(msg))
        }
    }
}
