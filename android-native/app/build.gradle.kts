plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.pearbrowser.app"
    compileSdk = 35
    ndkVersion = "27.2.12479018" // Required by bare-kit

    defaultConfig {
        applicationId = "com.pearbrowser.app"
        minSdk = 26   // Android 8.0 — same floor as Keet
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // Phase 2 ticket 7: ABI split for small APK size.
            // arm64-v8a covers ~95% of modern Android devices in 2025.
            abiFilters += listOf("arm64-v8a")
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
        }
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

    // Bare Kit — provides the Worklet API.
    // Phase 2 setup step: download bare-kit.jar from:
    //   https://github.com/holepunchto/bare-kit/releases/latest
    // and place it in app/libs/. See BUILD.md.
    implementation(files("libs/bare-kit.jar"))
}
