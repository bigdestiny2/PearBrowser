package com.pearbrowser.app.bridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import com.pearbrowser.app.R
import com.pearbrowser.app.rpc.Evt
import com.pearbrowser.app.rpc.IPearRpcCallback
import com.pearbrowser.app.rpc.IPearRpcService
import com.pearbrowser.app.rpc.PearRpc
import com.pearbrowser.app.rpc.WorkletIpc
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.lang.reflect.Proxy
import java.nio.ByteBuffer

/**
 * Hosts the Bare worklet that runs the PearBrowser backend (Hyperswarm,
 * Corestore, HyperProxy, sync groups).
 *
 * Uses the `to.holepunch.bare.kit.Worklet` API shipped by bare-kit.
 * The local AAR is mirrored into `app/libs/bare-kit.aar`. See BUILD.md.
 *
 * The service runs in the `:worklet` process (see AndroidManifest) which
 * keeps the native heap isolated from the UI process — that matches the
 * RN setup where the worklet was already in its own V8.
 *
 * This class is INTENTIONALLY small. All protocol logic lives in
 * [com.pearbrowser.app.rpc.PearRpc]. We just start/stop the worklet and
 * plumb bytes to the RPC client.
 */
class PearWorkletService : Service() {

    private var worklet: Any? = null          // to.holepunch.bare.kit.Worklet (via reflection)
    private var rpc: PearRpc? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var decisionReceiver: BroadcastReceiver? = null

    private val binder = object : IPearRpcService.Stub() {
        override fun request(command: Int, dataJson: String?, callback: IPearRpcCallback?) {
            val cb = callback ?: return
            val client = rpc
            if (client == null) {
                cb.safeOnError("Pear worklet RPC is not connected yet")
                return
            }

            val data = try {
                parseRpcPayload(dataJson)
            } catch (e: Throwable) {
                cb.safeOnError("Invalid RPC payload: ${e.message ?: "could not parse JSON"}")
                return
            }

            serviceScope.launch {
                try {
                    val result = client.request(command, data)
                    cb.safeOnSuccess(result.toString())
                } catch (e: Throwable) {
                    Log.w(TAG, "Binder RPC request failed: cmd=$command", e)
                    cb.safeOnError(e.message ?: "RPC request failed")
                }
            }
        }

        override fun isBackendAvailable(): Boolean = rpc != null
    }

    override fun onCreate() {
        super.onCreate()
        registerDecisionReceiver()
    }

    override fun onBind(intent: Intent?): IBinder {
        startForegroundWithNotification()
        if (worklet == null) bootWorklet()
        return binder
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundWithNotification()
        if (worklet == null) bootWorklet()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        decisionReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Throwable) {}
        }
        decisionReceiver = null
        serviceScope.cancel()
        try { rpc?.close() } catch (_: Throwable) {}
        try { worklet?.javaClass?.getMethod("terminate")?.invoke(worklet) } catch (_: Throwable) {}
        worklet = null
        rpc = null
    }

    /**
     * Boots the Bare worklet using the bare-kit Java API. We load it
     * reflectively because the AAR is a local drop-in — this lets the
     * project compile and run unit tests even when the artifact is absent,
     * which is useful for CI before the setup step documented in BUILD.md.
     */
    private fun bootWorklet() {
        val bundlePath = extractBundleToAppFiles() ?: run {
            Log.e(TAG, "Worklet bundle not found; aborting boot")
            return
        }
        val storagePath = File(filesDir, "pearbrowser").apply { mkdirs() }

        try {
            val workletClass = Class.forName("to.holepunch.bare.kit.Worklet")
            val optionsClass = Class.forName("to.holepunch.bare.kit.Worklet\$Options")
            val options = optionsClass.getDeclaredConstructor().newInstance()
            val wkt = workletClass.getDeclaredConstructor(optionsClass).newInstance(options)

            // Worklet.start(filename, args). bare-kit reads the bundle from
            // filename on disk.
            val startFile = workletClass.getMethod(
                "start", String::class.java, Array<String>::class.java
            )
            startFile.invoke(wkt, bundlePath, arrayOf(storagePath.absolutePath))
            val ipc = JavaBareIpcAdapter(wkt)
            val client = PearRpc(ipc)
            attachConsentEvents(client)
            worklet = wkt
            rpc = client
            Log.i(TAG, "Worklet started: bundle=$bundlePath storage=${storagePath.absolutePath}")
        } catch (e: ClassNotFoundException) {
            Log.w(TAG, "bare-kit AAR not installed — see BUILD.md. Running in demo mode.")
        } catch (e: Throwable) {
            Log.e(TAG, "Worklet boot failed", e)
        }
    }

    private fun extractBundleToAppFiles(): String? {
        val dest = File(filesDir, "backend.android.bundle")
        val tmp = File(filesDir, "backend.android.bundle.tmp")
        return try {
            assets.open("backend.android.bundle").use { input ->
                tmp.outputStream().use { output -> input.copyTo(output) }
            }
            if (dest.exists()) dest.delete()
            if (!tmp.renameTo(dest)) {
                tmp.copyTo(dest, overwrite = true)
                tmp.delete()
            }
            Log.i(TAG, "Extracted/updated bundle: ${dest.length()} bytes")
            dest.absolutePath
        } catch (e: Throwable) {
            Log.e(TAG, "Bundle asset missing — run npm run bundle-backend-native-android", e)
            null
        }
    }

    private fun registerDecisionReceiver() {
        if (decisionReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    PearWorkletEvents.ACTION_RESOLVE_LOGIN -> resolveLogin(intent)
                    PearWorkletEvents.ACTION_RESOLVE_SWARM -> resolveSwarm(intent)
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(PearWorkletEvents.ACTION_RESOLVE_LOGIN)
            addAction(PearWorkletEvents.ACTION_RESOLVE_SWARM)
        }
        ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        decisionReceiver = receiver
    }

    private fun attachConsentEvents(client: PearRpc) {
        client.on(Evt.READY) { payload ->
            Log.i(TAG, "Backend ready: $payload")
        }
        client.on(Evt.BOOT_PROGRESS) { payload ->
            Log.i(TAG, "Backend boot progress: $payload")
        }
        client.on(Evt.PEER_COUNT) { payload ->
            Log.i(TAG, "Peer count: $payload")
        }
        client.on(Evt.ERROR) { payload ->
            Log.e(TAG, "Backend error: $payload")
        }

        client.on(Evt.CATALOG_UPDATED) { payload ->
            val obj = payload as? JsonObject ?: return@on
            val keyHex = obj.string("keyHex")?.lowercase() ?: return@on
            val catalog = obj["catalog"] ?: return@on
            sendBroadcast(Intent(PearWorkletEvents.ACTION_CATALOG_UPDATED).apply {
                setPackage(packageName)
                putExtra(PearWorkletEvents.EXTRA_CATALOG_KEY, keyHex)
                putExtra(PearWorkletEvents.EXTRA_CATALOG_JSON, catalog.toString())
            })
        }

        client.on(Evt.LOGIN_REQUEST) { payload ->
            val obj = payload as? JsonObject ?: return@on
            val requestId = obj.string("requestId") ?: return@on
            val driveKey = obj.string("driveKey") ?: return@on
            sendBroadcast(Intent(PearWorkletEvents.ACTION_LOGIN_REQUEST).apply {
                setPackage(packageName)
                putExtra(PearWorkletEvents.EXTRA_REQUEST_ID, requestId)
                putExtra(PearWorkletEvents.EXTRA_DRIVE_KEY, driveKey)
                putExtra(PearWorkletEvents.EXTRA_APP_NAME, obj.string("appName") ?: "A PearBrowser app")
                putExtra(PearWorkletEvents.EXTRA_REASON, obj.string("reason") ?: "")
                putExtra(PearWorkletEvents.EXTRA_SCOPES, obj.stringArray("scopes").toTypedArray())
            })
        }

        client.on(Evt.SWARM_REQUEST) { payload ->
            val obj = payload as? JsonObject ?: return@on
            val requestId = obj.string("requestId") ?: return@on
            val driveKey = obj.string("driveKey") ?: return@on
            val topicHex = obj.string("topicHex") ?: return@on
            sendBroadcast(Intent(PearWorkletEvents.ACTION_SWARM_REQUEST).apply {
                setPackage(packageName)
                putExtra(PearWorkletEvents.EXTRA_REQUEST_ID, requestId)
                putExtra(PearWorkletEvents.EXTRA_DRIVE_KEY, driveKey)
                putExtra(PearWorkletEvents.EXTRA_TOPIC_HEX, topicHex)
                putExtra(PearWorkletEvents.EXTRA_PROTOCOL, obj.string("protocol") ?: "pear.swarm.v1")
                putExtra(PearWorkletEvents.EXTRA_APP_NAME, obj.string("appName") ?: "A PearBrowser app")
                putExtra(PearWorkletEvents.EXTRA_REASON, obj.string("reason") ?: "")
            })
        }
    }

    private fun resolveLogin(intent: Intent) {
        val requestId = intent.getStringExtra(PearWorkletEvents.EXTRA_REQUEST_ID) ?: return
        val approved = intent.getBooleanExtra(PearWorkletEvents.EXTRA_APPROVED, false)
        val scopes = intent.getStringArrayExtra(PearWorkletEvents.EXTRA_SCOPES)?.toList()
        serviceScope.launch {
            try {
                rpc?.loginResolve(requestId, approved, scopes)
            } catch (e: Throwable) {
                Log.w(TAG, "loginResolve failed", e)
            }
        }
    }

    private fun resolveSwarm(intent: Intent) {
        val requestId = intent.getStringExtra(PearWorkletEvents.EXTRA_REQUEST_ID) ?: return
        val approved = intent.getBooleanExtra(PearWorkletEvents.EXTRA_APPROVED, false)
        serviceScope.launch {
            try {
                rpc?.swarmResolve(requestId, approved)
            } catch (e: Throwable) {
                Log.w(TAG, "swarmResolve failed", e)
            }
        }
    }

    private fun startForegroundWithNotification() {
        val channelId = "pearbrowser_sync"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val existing = nm.getNotificationChannel(channelId)
            if (existing == null) {
                val channel = NotificationChannel(channelId, "PearBrowser Sync", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Keeps P2P sync running in the background." }
                nm.createNotificationChannel(channel)
            }
        }
        val notif: Notification = Notification.Builder(this, channelId)
            .setContentTitle("PearBrowser")
            .setContentText("P2P sync active")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    companion object {
        private const val TAG = "PearWorkletService"
        private const val NOTIF_ID = 4201

        fun start(context: Context) {
            val intent = Intent(context, PearWorkletService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PearWorkletService::class.java))
        }
    }
}

private fun JsonObject.string(key: String): String? =
    this[key]?.jsonPrimitive?.contentOrNull

private fun JsonObject.stringArray(key: String): List<String> =
    when (val value: JsonElement? = this[key]) {
        is JsonArray -> value.jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull }
        else -> emptyList()
    }

private fun parseRpcPayload(dataJson: String?): JsonElement =
    if (dataJson.isNullOrBlank()) JsonNull else Json.parseToJsonElement(dataJson)

private fun IPearRpcCallback.safeOnSuccess(resultJson: String) {
    try {
        onSuccess(resultJson)
    } catch (_: Throwable) {
    }
}

private fun IPearRpcCallback.safeOnError(message: String) {
    try {
        onError(message)
    } catch (_: Throwable) {
    }
}

/**
 * Adapter between bare-kit's IPC object (accessed reflectively here to
 * avoid compile-time dependency on the local AAR) and our [WorkletIpc]
 * interface. The current bare-kit Android API exposes:
 *
 *    IPC(worklet)
 *    ipc.readable(PollCallback)
 *    ipc.read(): ByteBuffer?
 *    ipc.write(ByteBuffer)
 *
 * We bridge to Kotlin lambdas.
 */
private class JavaBareIpcAdapter(private val worklet: Any) : WorkletIpc {
    private val ipcClass: Class<*> = Class.forName("to.holepunch.bare.kit.IPC")
    private val pollCallbackClass: Class<*> = Class.forName("to.holepunch.bare.kit.IPC\$PollCallback")
    private val ipc: Any = ipcClass.getDeclaredConstructor(worklet.javaClass).newInstance(worklet)
    private val writeMethod = ipcClass.getMethod("write", ByteBuffer::class.java)
    private val readableMethod = ipcClass.getMethod("readable", pollCallbackClass)
    private val readMethod = ipcClass.getMethod("read")
    private val closeMethod = ipcClass.getMethod("close")

    override fun write(bytes: ByteArray) {
        writeMethod.invoke(ipc, ByteBuffer.wrap(bytes))
    }

    override fun onData(listener: (ByteArray) -> Unit) {
        val callback = Proxy.newProxyInstance(
            pollCallbackClass.classLoader,
            arrayOf(pollCallbackClass)
        ) { _, method, _ ->
            if (method.name == "apply") drainReadable(listener)
            null
        }
        readableMethod.invoke(ipc, callback)
    }

    private fun drainReadable(listener: (ByteArray) -> Unit) {
        while (true) {
            val buffer = readMethod.invoke(ipc) as? ByteBuffer ?: break
            if (!buffer.hasRemaining()) break
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)
            listener(bytes)
        }
    }

    override fun close() {
        closeMethod.invoke(ipc)
    }
}
