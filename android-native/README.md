# android-native — PearBrowser Kotlin Shell

Phase 2 of the [Holepunch alignment plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md):
a pure Jetpack Compose + `bare-kit` Android app that reuses the
`backend/` worklet from the sibling RN project, with no React Native,
no Metro, no Hermes.

See [BUILD.md](./BUILD.md) for prerequisites and compilation.

## Tree

```
android-native/
├── app/
│   ├── build.gradle.kts            # AGP + Kotlin + Compose config
│   ├── proguard-rules.pro          # keeps bare-kit JNI classes + RPC serialisation
│   ├── libs/                       # ← drop bare-kit.jar here (gitignored)
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/                 # bare-pack bundle lands here
│       ├── java/com/pearbrowser/app/
│       │   ├── PearBrowserApp.kt           # Application singleton
│       │   ├── MainActivity.kt             # Compose root + tab navigator
│       │   ├── bridge/
│       │   │   ├── PearWorkletService.kt   # hosts bare-kit, bridges to PearRpc
│       │   │   └── PearBridgeScript.kt     # window.pear injection
│       │   ├── rpc/
│       │   │   ├── PearRpc.kt              # length-prefixed JSON IPC client
│       │   │   └── Protocol.kt             # Cmd/Evt IDs (mirrors backend/constants.js)
│       │   └── ui/
│       │       ├── theme/Theme.kt          # matches app/lib/theme.ts
│       │       └── screens/                # Compose screen ports
│       └── res/                    # strings, colors, themes, launcher icons
├── build.gradle.kts                # top-level
├── gradle/
│   ├── libs.versions.toml          # version catalog
│   └── wrapper/
├── gradle.properties
├── settings.gradle.kts
├── BUILD.md                        # ← start here
└── README.md                       # (this file)
```

## How this differs from the RN shell

| Concern | RN shell (`app/`) | Kotlin shell (this) |
|---|---|---|
| UI framework | React Native 0.83 | Jetpack Compose |
| JS engine for UI | Hermes | (none) |
| JS engine for worklet | V8 (via bare-kit) | V8 (via bare-kit) — same |
| Bridge | TurboModule + JSI | Direct Android `WebView.addJavascriptInterface` |
| Storage (pre-Phase-1) | AsyncStorage | DataStore |
| Storage (post-Phase-1) | Hyperbee via RPC | Hyperbee via RPC — identical |
| QR scanner | `expo-camera` | CameraX + ML Kit |
| Bundle path | `assets/backend.android.bundle.mjs` (Metro import) | `assets/backend.android.bundle` (disk) |
| Expected APK size | ~372 MB | < 50 MB |

## Backend reuse

The worklet (`backend/*.js`) is **unchanged**. The only build difference
is the output target: `bare-pack --host android-arm64 -o backend/dist/backend.android.bundle`
produces the canonical `.bundle` format. `PearWorkletService` copies that
into `app/files/` on first launch and calls `Worklet.start(path, [storagePath])`.

## Why Kotlin and not Flutter / KMM / React Native ?

See the [Architecture Review](../docs/ARCHITECTURE_REVIEW_HOLEPUNCH_ALIGNMENT.md).

TL;DR: Holepunch's canonical Android path is `bare-android` (Kotlin +
native views embedding `bare-kit` directly). This shell follows that
pattern so PearBrowser's architecture score against the Pear-purist
checklist rises from 5.5/13 to ~10/13 after this phase.
