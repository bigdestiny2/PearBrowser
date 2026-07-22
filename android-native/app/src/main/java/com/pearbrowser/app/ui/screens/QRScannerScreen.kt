package com.pearbrowser.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.pearbrowser.app.ui.theme.PearColors
import java.util.concurrent.Executors
import kotlinx.coroutines.delay

/**
 * QRScannerScreen — CameraX + ML Kit barcode scanning (both deps are already
 * declared in app/build.gradle.kts). Mirror of ios-native `QRScannerScreen.swift`
 * (AVFoundation metadata .qr) with an added device-link mode.
 *
 * Two modes:
 *  - [QRScanMode.Navigate]  — hyper:// / pear:// / hyperbee:// payloads, bare
 *    52–64 char hex keys (auto-prefixed hyper://), and p2phiverelay gateway
 *    URLs. Result is handed to the caller for Browse navigation.
 *  - [QRScanMode.DeviceLink] — a blind-pairing device-link invite (64-hex
 *    string, backend/device-linker.js `createInvite()`). Result is handed
 *    back raw; the caller wires it to CMD_DEVICE_LINK_JOIN after user
 *    confirmation.
 *
 * Manual invite entry already lives in More → Identity ("Link this device")
 * and stays the no-camera fallback.
 */
enum class QRScanMode { Navigate, DeviceLink }

private val hexKey = Regex("^[a-f0-9]{52,64}$", RegexOption.IGNORE_CASE)
private val inviteHex = Regex("^[a-f0-9]{64}$", RegexOption.IGNORE_CASE)

/**
 * Validates and normalizes a scanned payload. Returns null when the payload
 * is not acceptable for [mode] — mirrors the iOS `handleCode` rules.
 */
fun normalizeScannedPayload(raw: String, mode: QRScanMode): String? {
    val trimmed = raw.trim()
    return when (mode) {
        QRScanMode.Navigate -> when {
            trimmed.startsWith("hyper://") ||
                trimmed.startsWith("pear://") ||
                trimmed.startsWith("hyperbee://") -> trimmed
            hexKey.matches(trimmed) -> "hyper://${trimmed.lowercase()}"
            trimmed.startsWith("https://") && trimmed.contains("p2phiverelay") -> trimmed
            else -> null
        }
        QRScanMode.DeviceLink ->
            if (inviteHex.matches(trimmed)) trimmed.lowercase() else null
    }
}

@Composable
fun QRScannerScreen(
    mode: QRScanMode,
    onScan: (String) -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var permissionAsked by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasPermission = granted
        permissionAsked = true
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        when {
            hasPermission -> AuthorizedScanner(mode = mode, onScan = onScan, onClose = onClose)
            !permissionAsked -> PermissionRequestView(
                onGrant = { permissionLauncher.launch(Manifest.permission.CAMERA) },
                onCancel = onClose,
            )
            else -> PermissionDeniedView(onClose = onClose)
        }
    }
}

@Composable
private fun AuthorizedScanner(
    mode: QRScanMode,
    onScan: (String) -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var scanned by remember { mutableStateOf(false) }
    var invalidToast by remember { mutableStateOf<String?>(null) }
    val previewView = remember { PreviewView(context) }

    // Auto-dismiss the "invalid payload" hint, mirroring the iOS 2s toast.
    LaunchedEffect(invalidToast) {
        if (invalidToast != null) {
            delay(2_000)
            invalidToast = null
        }
    }

    DisposableEffect(context, lifecycleOwner, mode) {
        val cameraExecutor = Executors.newSingleThreadExecutor()
        val barcodeScanner = BarcodeScanning.getClient(
            com.google.mlkit.vision.barcode.BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        var cameraProvider: ProcessCameraProvider? = null

        cameraProviderFuture.addListener({
            try {
                val provider = cameraProviderFuture.get()
                cameraProvider = provider
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                    @androidx.annotation.OptIn(ExperimentalGetImage::class)
                    val mediaImage = imageProxy.image
                    if (mediaImage == null) {
                        imageProxy.close()
                        return@setAnalyzer
                    }
                    val image = InputImage.fromMediaImage(
                        mediaImage,
                        imageProxy.imageInfo.rotationDegrees,
                    )
                    barcodeScanner.process(image)
                        .addOnSuccessListener { barcodes ->
                            if (scanned) return@addOnSuccessListener
                            val value = barcodes.firstOrNull()?.rawValue ?: return@addOnSuccessListener
                            val normalized = normalizeScannedPayload(value, mode)
                            if (normalized != null) {
                                scanned = true
                                onScan(normalized)
                            } else {
                                invalidToast = when (mode) {
                                    QRScanMode.Navigate -> "Not a hyper:// QR"
                                    QRScanMode.DeviceLink -> "Not a device-link invite"
                                }
                            }
                        }
                        .addOnCompleteListener { imageProxy.close() }
                }
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
            } catch (_: Throwable) {
                // Camera unavailable (emulator, busy hardware) — the overlay
                // stays up and the user can still Close; manual invite entry
                // lives in More → Identity.
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            try { cameraProvider?.unbindAll() } catch (_: Throwable) {}
            barcodeScanner.close()
            cameraExecutor.shutdown()
        }
    }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            factory = { previewView },
            modifier = Modifier.fillMaxSize(),
        )

        // Overlay — close button, target box, hint (mirrors iOS overlay).
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 60.dp),
            ) {
                Spacer(Modifier.weight(1f))
                Text(
                    "Close",
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                        .clickable(onClick = onClose)
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            Spacer(Modifier.weight(1f))
            Box(
                Modifier.fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(250.dp)
                        .border(3.dp, PearColors.Accent, RoundedCornerShape(12.dp)),
                )
                invalidToast?.let {
                    Text(
                        it,
                        color = Color.White,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .background(Color.Black.copy(alpha = 0.7f), CircleShape)
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            Text(
                when (mode) {
                    QRScanMode.Navigate -> "Point at a QR code with a hyper:// address"
                    QRScanMode.DeviceLink -> "Point at the device-link invite QR on your other device"
                },
                color = Color.White,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(bottom = 80.dp)
                    .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                    .padding(horizontal = 20.dp, vertical = 10.dp),
            )
        }
    }
}

/** The PreviewView is remembered inside AuthorizedScanner and shared with the camera binder. */

@Composable
private fun PermissionRequestView(
    onGrant: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxSize()
            .padding(40.dp),
    ) {
        Spacer(Modifier.weight(1f))
        Text(
            "Camera Access",
            color = PearColors.TextPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "PearBrowser needs camera access to scan QR codes containing hyper:// addresses.",
            color = PearColors.TextSecondary,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            "Grant Access",
            color = PearColors.Bg,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .background(PearColors.Accent, RoundedCornerShape(12.dp))
                .clickable(onClick = onGrant)
                .padding(horizontal = 24.dp, vertical = 12.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "Cancel",
            color = PearColors.TextSecondary,
            fontSize = 14.sp,
            modifier = Modifier
                .clickable(onClick = onCancel)
                .padding(8.dp),
        )
        Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun PermissionDeniedView(onClose: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxSize()
            .padding(40.dp),
    ) {
        Spacer(Modifier.weight(1f))
        Text(
            "Camera not available",
            color = PearColors.TextPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "Enable camera access in Settings to scan QR codes.",
            color = PearColors.TextSecondary,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            "Close",
            color = PearColors.Bg,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .background(PearColors.Accent, RoundedCornerShape(12.dp))
                .clickable(onClick = onClose)
                .padding(horizontal = 24.dp, vertical = 12.dp),
        )
        Spacer(Modifier.weight(1f))
    }
}
