# PearBrowser — Android Native Shell

Phase 2 of the [Holepunch Alignment Plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md).
A pure Kotlin + Jetpack Compose + `bare-kit` shell, no React Native,
reusing the `backend/` worklet from the RN project verbatim.

## Current status

| Area | Status |
|---|---|
| Gradle project | ✅ scaffolded (AGP 8.7, Kotlin 2.1, Compose BOM 2025.01) |
| Kotlin IPC client (`PearRpc.kt`) | ✅ full worklet API, mirrors `app/lib/rpc.ts` |
| Binder RPC bridge (`IPearRpcService.aidl`, `PearRpcClient.kt`) | ✅ UI process can call worklet RPC through `PearWorkletService` |
| Worklet host (`PearWorkletService.kt`) | ✅ reflectively loads `bare-kit` and exposes Binder RPC |
| Compose theme | ✅ matches `app/lib/theme.ts` exactly |
| HomeScreen | ✅ search bar + synced bookmark quick access |
| ExploreScreen | ✅ HTTP catalog fetch + Visit flow, seeded by synced settings |
| BrowseScreen | ✅ native WebView + Pear bridge injection |
| MoreScreen | ✅ connected-apps route + live status/settings summary |
| BookmarksScreen, HistoryScreen, SettingsScreen, MySitesScreen, SiteEditorScreen, QRScannerScreen, TemplatePickerScreen | ⏳ stubs / pending port |
| QR scanner (CameraX + ML Kit) | ⏳ dependencies added, screen TODO |
| Gradle task discovery | ✅ passes |
| Kotlin compile | ✅ `:app:compileDebugKotlin` passes |
| Debug APK build | ✅ `:app:assembleDebug` passes with a verified JDK 17 (`jmod` support required) |
| Emulator launch smoke | ✅ fresh install on headless `pp_avd` reaches green `Connected` without the first-launch bookmark error |
| Release APK/AAB build | ✅ release APK/AAB builds pass with R8/resource shrink |
| Release signing | ✅ env-driven signing config verified with a disposable test key; production keystore/distribution checks remain |
| TestFlight-equivalent distribution | ⏳ Firebase App Distribution config TODO |

## Prerequisites

1. **Android Studio Ladybug (2024.2.1)** or newer with:
   - Android SDK 35 installed
   - NDK 27.1.12297006 installed (matches `android.ndkVersion`)
   - `cmdline-tools/latest`
2. **JDK 17** on your `JAVA_HOME`. Use a distribution whose `javac` and
   `jmod` complete Android Gradle Plugin's JDK image transform. Eclipse
   Temurin 17 is verified locally; Homebrew OpenJDK 17.0.19 hung in `jmod`
   on this machine during `:app:assembleDebug`.
3. **Node.js 20+** (for bundling the backend).
4. **`bare-kit.aar` or `bare-kit.jar`** — download the latest release from
   <https://github.com/holepunchto/bare-kit/releases> and drop it in
   `android-native/app/libs/bare-kit.aar` (preferred) or
   `android-native/app/libs/bare-kit.jar`.

The artifact is **not checked in** (see `.gitignore`). You must fetch it fresh.

## Building the bundled backend

The Kotlin shell reuses `backend/` unchanged. Produce the canonical
`.bundle` output at the repo root:

```bash
cd /Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser
npm install                                    # if not already
npm run bundle-backend-native-android
# Produces backend/dist/backend.android.bundle
```

Gradle's `sourceSets.main.assets.srcDirs` includes `../../backend/dist`
so the bundle is automatically bundled into the APK's `assets/` folder
at build time.

## Building the APK

If this checkout does not include `android-native/gradlew`, substitute the
sibling wrapper with `-p`:

```bash
/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/android/gradlew -p /Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/android-native <task>
```

```bash
cd /Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/android-native

# First build (downloads gradle wrapper distribution)
./gradlew --version

# Debug APK (arm64 only, ~45MB target)
./gradlew :app:assembleDebug

# Release APK (ProGuard + R8; unsigned unless signing env vars are set)
./gradlew :app:assembleRelease

# Release AAB (Play/App Bundle format; unsigned unless signing env vars are set)
./gradlew :app:bundleRelease
```

Outputs:

- APK: `android-native/app/build/outputs/apk/{debug,release}/app-*.apk`
- AAB: `android-native/app/build/outputs/bundle/release/app-release.aab`

## Release signing

Release signing is intentionally driven by environment variables so secrets do
not enter git:

```bash
export PEARBROWSER_ANDROID_KEYSTORE=/absolute/path/to/release.keystore
export PEARBROWSER_ANDROID_STORE_PASSWORD=...
export PEARBROWSER_ANDROID_KEY_ALIAS=pearbrowser
export PEARBROWSER_ANDROID_KEY_PASSWORD=... # optional; defaults to store password

./gradlew :app:assembleRelease :app:bundleRelease
```

Without these variables Gradle still produces unsigned release artifacts for
R8/resource-shrink validation. The pipeline has been verified with a disposable
test keystore: `app-release.apk` passes `apksigner verify --print-certs`, and
`app-release.aab` passes `jarsigner -verify` with the expected self-signed test
certificate warnings. Distribution requires a real upload/release keystore and
Play Console or Firebase App Distribution validation.

## Installing on a device

```bash
./gradlew :app:installDebug
# Or:
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Running against a local Metro-free dev loop

Unlike the RN shell, there is no Metro / `expo start` — the native Kotlin
app is fully self-contained. Any code change to `.kt` files needs a rebuild.

For worklet changes (i.e. anything in `backend/`) rerun:

```bash
npm run bundle-backend-native-android
./gradlew :app:installDebug
```

## Size budget

| Build type | Target | Current |
|---|---|---|
| Debug APK | Diagnostic only | 169 MB (unminified, arm64-v8a + armeabi-v7a, bare-kit/addons included) |
| Release APK (signed test artifact, 2 ABIs) | < 150 MB diagnostic ceiling | 142 MB |
| Release AAB (signed test artifact, 2 ABIs) | < 70 MB | 49 MB |

Compared to the RN Android build (**~372 MB**), we expect a **~85% reduction**.
Drivers:
- No Hermes (~20 MB saved)
- No React Native runtime (~50 MB)
- No Metro-produced bundles duplicated alongside bare-pack bundle
- ABI split: arm64-v8a only instead of armeabi-v7a + arm64-v8a + x86 + x86_64

## Notes for contributors

**Kotlin code style:** official Kotlin style (enforced via
`kotlin.code.style=official` in `gradle.properties`).

**Adding a new screen:**
1. Drop a `@Composable` into `ui/screens/`
2. Wire it into `MainActivity.PearBrowserRoot`'s `when (activeTab)` block (or route from MoreScreen)
3. If the screen needs RPC, read `LocalPearRpc.current` and call the typed wrappers on `PearRpcClient` (or add a wrapper there for a new command).

**Adding a new RPC command:**
1. Add it to the three mirrors: `backend/constants.js`, `app/lib/constants.ts`, **AND** `android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt`.
2. Add the backend handler in `backend/index.js`.
3. Add the RN method in `app/lib/rpc.ts`.
4. Add the Kotlin method in `android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt`.
5. Run `npm test` at the repo root to typecheck both JS/TS sides.

**Android Binder RPC smoke check:**

```bash
cd /Users/localllm/Desktop/PearBrowser/android-native
./gradlew :app:compileDebugKotlin
# If ./gradlew is absent:
/Users/localllm/Desktop/PearBrowser/android/gradlew -p /Users/localllm/Desktop/PearBrowser/android-native :app:compileDebugKotlin
```

Runtime smoke on a device/emulator:
1. Install/launch the debug app with `backend.android.bundle` and `bare-kit` present.
2. Confirm the top-right header changes from `Starting...` to `Engine ready`, `Connected`, or a peer count.
3. Open **More** and confirm `Worklet Service` is `Bound`, then check live DHT/proxy/storage/settings rows.
4. Add a bookmark through the worklet-backed user data path and confirm it appears on Home under **Quick Access**.

**Latest local smoke, 2026-06-23:**

```bash
export JAVA_HOME=/path/to/temurin-17/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH
npm run bundle-backend-native-android
android/gradlew -p android-native :app:tasks --all
android/gradlew -p android-native --no-daemon \
  -Dorg.gradle.workers.max=1 \
  -Dkotlin.compiler.execution.strategy=in-process \
  :app:compileDebugKotlin
android/gradlew -p android-native --no-daemon \
  -Dorg.gradle.workers.max=1 \
  -Dkotlin.compiler.execution.strategy=in-process \
  :app:assembleDebug
```

Result: task discovery, Kotlin compile, Java compile, and `:app:assembleDebug`
passed with Eclipse Temurin 17. A fresh
`android-native/app/build/outputs/apk/debug/app-debug.apk` was installed onto a
headless `pp_avd` emulator and launched via `com.pearbrowser.app/.MainActivity`.
The app extracted `backend.android.bundle`, loaded `libbare-kit.so`, started the
worklet, recovered with the identity-scoped Corestore path when needed, opened
the local proxy, and showed a green `Connected` Home screen. The Home screen now
retries bookmark loading across the initial Binder boot race, so a clean install
no longer shows "Bookmarks are unavailable right now" before the worklet is
ready.

Local evidence files from that run:
- `/private/tmp/pearbrowser-android-native-smoke-fixed.png` — clean Home screen,
  green `Connected`
- `adb logcat` focused tags showed `Worklet started`, `Corestore ready`,
  `UserData ready`, `HTTP proxy started`, and `Backend ready`

**Bridge JS changes:**
The Pear bridge script lives in **two** places:
- `app/lib/pear-bridge-spec.ts` — source of truth
- `android-native/app/src/main/java/com/pearbrowser/app/bridge/PearBridgeScript.kt` — Kotlin mirror

They must stay byte-identical. A future improvement is to generate the Kotlin
mirror from the TS source at build time.

## Known TODOs before v0.2 ship

- [ ] Finish screen ports (Bookmarks, History, Settings, MySites, SiteEditor, QRScanner, TemplatePicker)
- [ ] QR scanner (CameraX + ML Kit Vision barcode)
- [ ] Backup phrase / Restore identity screens
- [ ] Firebase App Distribution for beta delivery
- [ ] Verify bare-kit.jar reflection calls against the actual published API

## References

- Architecture plan: [`../docs/HOLEPUNCH_ALIGNMENT_PLAN.md`](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md)
- `holepunchto/bare-android` template: <https://github.com/holepunchto/bare-android>
- `holepunchto/bare-kit`: <https://github.com/holepunchto/bare-kit>
- Keet's reference Android shell (not public): <https://keet.io>
