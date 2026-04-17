package com.pearbrowser.app.bridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.pearbrowser.app.BuildConfig
import com.pearbrowser.app.R
import com.pearbrowser.app.rpc.PearRpc
import com.pearbrowser.app.rpc.WorkletIpc
import java.io.File

/**
 * Hosts the Bare worklet that runs the PearBrowser backend (Hyperswarm,
 * Corestore, HyperProxy, sync groups).
 *
 * Uses the `io.pears.kit.Worklet` API documented in
 * github.com/holepunchto/bare-android. The library is dropped in as
 * `app/libs/bare-kit.jar`. See BUILD.md.
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

    private var worklet: Any? = null          // io.pears.kit.Worklet (via reflection)
    private var rpc: PearRpc? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundWithNotification()
        if (worklet == null) bootWorklet()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        try { rpc?.close() } catch (_: Throwable) {}
        try { worklet?.javaClass?.getMethod("terminate")?.invoke(worklet) } catch (_: Throwable) {}
        worklet = null
        rpc = null
    }

    /**
     * Boots the Bare worklet using the bare-kit Java API. We load it
     * reflectively because the jar is dropped in locally — this lets the
     * project compile and run unit tests even when the jar is absent,
     * which is useful for CI before the setup step documented in BUILD.md.
     */
    private fun bootWorklet() {
        val bundlePath = extractBundleToAppFiles() ?: run {
            Log.e(TAG, "Worklet bundle not found; aborting boot")
            return
        }
        val storagePath = File(filesDir, "pearbrowser").apply { mkdirs() }

        try {
            val workletClass = Class.forName("io.pears.kit.Worklet")
            val wkt = workletClass.getDeclaredConstructor().newInstance()
            // Worklet.start(filename, source?, args?). When source is null
            // bare-kit reads the bundle from filename on disk.
            val startFile = workletClass.getMethod(
                "start", String::class.java, Array<String>::class.java
            )
            startFile.invoke(wkt, bundlePath, arrayOf(storagePath.absolutePath))
            worklet = wkt

            // Hand off to PearRpc
            val ipc = JavaBareIpcAdapter(wkt)
            rpc = PearRpc(ipc)
            Log.i(TAG, "Worklet started: bundle=$bundlePath storage=${storagePath.absolutePath}")
        } catch (e: ClassNotFoundException) {
            Log.w(TAG, "bare-kit.jar not installed — see BUILD.md. Running in demo mode.")
        } catch (e: Throwable) {
            Log.e(TAG, "Worklet boot failed", e)
        }
    }

    private fun extractBundleToAppFiles(): String? {
        val dest = File(filesDir, "backend.android.bundle")
        if (dest.exists() && dest.length() > 0) return dest.absolutePath
        return try {
            assets.open("backend.android.bundle").use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
            Log.i(TAG, "Extracted bundle: ${dest.length()} bytes")
            dest.absolutePath
        } catch (e: Throwable) {
            Log.e(TAG, "Bundle asset missing — run npm run bundle-backend-native-android", e)
            null
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

/**
 * Adapter between bare-kit's Worklet.IPC object (accessed reflectively
 * here to avoid compile-time dependency on the jar) and our [WorkletIpc]
 * interface. The real bare-kit API exposes:
 *
 *    worklet.IPC.write(bytes)
 *    worklet.IPC.addListener(listener)
 *
 * We bridge to Kotlin lambdas.
 */
private class JavaBareIpcAdapter(private val worklet: Any) : WorkletIpc {
    private val ipc: Any = worklet.javaClass.getField("IPC").get(worklet)
    private val writeMethod = ipc.javaClass.getMethod("write", ByteArray::class.java)
    private val addListenerMethod = try {
        ipc.javaClass.getMethod("addListener", Any::class.java)
    } catch (e: NoSuchMethodException) {
        // Fallback for older APIs
        ipc.javaClass.getMethod("on", String::class.java, Any::class.java)
    }

    override fun write(bytes: ByteArray) { writeMethod.invoke(ipc, bytes) }
    override fun onData(listener: (ByteArray) -> Unit) {
        // This assumes bare-kit's callback shape is (byte[]) -> Unit.
        // If the real API uses a different interface we'll need a proxy.
        addListenerMethod.invoke(ipc, object : Any() {
            @Suppress("unused") // invoked reflectively by bare-kit
            fun onData(data: ByteArray) { listener(data) }
        })
    }
    override fun close() {
        // bare-kit IPC doesn't have a direct close — terminating the worklet
        // handles cleanup. No-op here.
    }
}
