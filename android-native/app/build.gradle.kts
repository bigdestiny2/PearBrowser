plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.pearbrowser.app"
    compileSdk = 35
    // Used only to source libc++_shared.so for the prebuilt bare-kit AAR.
    // Keep this aligned with the installed SDK on CI/dev machines.
    ndkVersion = "27.1.12297006"

    defaultConfig {
        applicationId = "com.pearbrowser.app"
        // bare-kit.aar declares minSdk 29. Keep the app floor aligned
        // instead of forcing a manifest override that may crash at runtime.
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // Include 32-bit ARM for inexpensive Android devices that still
            // ship armeabi-v7a-only CPUs. Release/App Bundle distribution can
            // still split by ABI, but the debug APK should install on the
            // hardware we actually have on the bench.
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }

        manifestPlaceholders["usesCleartextTraffic"] = "true"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
        aidl = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        jniLibs {
            // bare-kit and native addons ship .so files per ABI.
            // Keep them uncompressed so Android's PackageManager can mmap them.
            useLegacyPackaging = false
        }
    }

    // Copy the bare-packed worklet bundle into assets so MainActivity can
    // pass its path to `Worklet.start(filename)`. The bundle itself is
    // produced by `npm run bundle-backend-native-android` at the repo root.
    // We pull from ../../../backend/dist/backend.android.bundle via a
    // gradle task that runs before mergeAssets.
    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets", "../../backend/dist")
            jniLibs.srcDir(layout.buildDirectory.dir("generated/jniLibs/libcxx"))
        }
    }
}

val copyLibcxxShared by tasks.registering(Copy::class) {
    val hostTag = when {
        System.getProperty("os.name").startsWith("Mac", ignoreCase = true) -> "darwin-x86_64"
        System.getProperty("os.name").startsWith("Windows", ignoreCase = true) -> "windows-x86_64"
        else -> "linux-x86_64"
    }
    val libcxxRoot = File(
        android.ndkDirectory,
        "toolchains/llvm/prebuilt/$hostTag/sysroot/usr/lib"
    )
    val abiTriples = mapOf(
        "arm64-v8a" to "aarch64-linux-android",
        "armeabi-v7a" to "arm-linux-androideabi",
    )

    into(layout.buildDirectory.dir("generated/jniLibs/libcxx"))
    abiTriples.forEach { (abi, triple) ->
        val libcxx = File(libcxxRoot, "$triple/libc++_shared.so")
        if (libcxx.exists()) {
            from(libcxx) { into(abi) }
        } else {
            logger.warn("libc++_shared.so not found for $abi at ${libcxx.absolutePath}")
        }
    }
}

tasks.configureEach {
    if (name.startsWith("merge") && name.endsWith("JniLibFolders")) {
        dependsOn(copyLibcxxShared)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.datastore.preferences)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    // CameraX + ML Kit for QR scanning
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode.scanning)

    // Bare Kit — provides the Worklet API + native addon .so files.
    // Prefer the local AAR mirrored from react-native-bare-kit because it
    // packages libbare-kit.so and the addon shared libraries together.
    // If neither artifact exists the app still compiles; PearWorkletService
    // falls back to demo mode at runtime via reflection.
    val bareKitAar = file("libs/bare-kit.aar")
    val bareKitJar = file("libs/bare-kit.jar")
    when {
        bareKitAar.exists() -> implementation(files(bareKitAar))
        bareKitJar.exists() -> implementation(files(bareKitJar))
    }
}
