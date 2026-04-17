# PearBrowser — Android Native Shell

Phase 2 of the [Holepunch Alignment Plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md).
A pure Kotlin + Jetpack Compose + `bare-kit` shell, no React Native,
reusing the `backend/` worklet from the RN project verbatim.

## Current status

| Area | Status |
|---|---|
| Gradle project | ✅ scaffolded (AGP 8.7, Kotlin 2.1, Compose BOM 2025.01) |
| Kotlin IPC client (`PearRpc.kt`) | ✅ full API, mirrors `app/lib/rpc.ts` |
| Worklet host (`PearWorkletService.kt`) | ✅ reflectively loads `bare-kit.jar` |
| Compose theme | ✅ matches `app/lib/theme.ts` exactly |
| HomeScreen | ✅ search bar + welcome state (bookmarks wiring TODO) |
| ExploreScreen | ✅ HTTP catalog fetch + Visit flow |
| BrowseScreen | ✅ native WebView + Pear bridge injection |
| MoreScreen, BookmarksScreen, HistoryScreen, SettingsScreen, MySitesScreen, SiteEditorScreen, QRScannerScreen, TemplatePickerScreen | ⏳ stubs / pending port |
| QR scanner (CameraX + ML Kit) | ⏳ dependencies added, screen TODO |
| APK build + sign | ⏳ needs `bare-kit.jar` + bundle |
| TestFlight-equivalent distribution | ⏳ Firebase App Distribution config TODO |

## Prerequisites

1. **Android Studio Ladybug (2024.2.1)** or newer with:
   - Android SDK 35 installed
   - NDK 27.2.12479018 installed (Holepunch-required version)
   - `cmdline-tools/latest`
2. **JDK 17** on your `JAVA_HOME`.
3. **Node.js 20+** (for bundling the backend).
4. **`bare-kit.jar`** — download the latest release from
   <https://github.com/holepunchto/bare-kit/releases> and drop it in
   `android-native/app/libs/bare-kit.jar`.

The jar is **not checked in** (see `.gitignore`). You must fetch it fresh.

## Building the bundled backend

The Kotlin shell reuses `backend/` unchanged. Produce the canonical
`.bundle` output at the repo root:

```bash
cd /Users/localllm/Desktop/PearBrowser
npm install                                    # if not already
npm run bundle-backend-native-android
# Produces backend/dist/backend.android.bundle
```

Gradle's `sourceSets.main.assets.srcDirs` includes `../../backend/dist`
so the bundle is automatically bundled into the APK's `assets/` folder
at build time.

## Building the APK

```bash
cd /Users/localllm/Desktop/PearBrowser/android-native

# First build (downloads gradle wrapper distribution)
./gradlew --version

# Debug APK (arm64 only, ~45MB target)
./gradlew :app:assembleDebug

# Release APK (ProGuard + R8, ~30MB target)
./gradlew :app:assembleRelease
```

Output: `android-native/app/build/outputs/apk/{debug,release}/app-*.apk`.

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
| Debug APK | < 60 MB | TBD (needs first build) |
| Release APK (arm64 only) | < 50 MB | TBD |
| Release AAB (all ABIs) | < 70 MB | TBD |

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
3. If the screen needs RPC, inject `PearRpc` via the DI path (TBD — likely a `LocalPearRpc` CompositionLocal in the next pass).

**Adding a new RPC command:**
1. Add it to the three mirrors: `backend/constants.js`, `app/lib/constants.ts`, **AND** `android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt`.
2. Add the backend handler in `backend/index.js`.
3. Add the RN method in `app/lib/rpc.ts`.
4. Add the Kotlin method in `android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpc.kt`.
5. Run `npm test` at the repo root to typecheck both JS/TS sides.

**Bridge JS changes:**
The Pear bridge script lives in **two** places:
- `app/lib/pear-bridge-spec.ts` — source of truth
- `android-native/app/src/main/java/com/pearbrowser/app/bridge/PearBridgeScript.kt` — Kotlin mirror

They must stay byte-identical. A future improvement is to generate the Kotlin
mirror from the TS source at build time.

## Known TODOs before v0.2 ship

- [ ] Connect PearRpc to PearWorkletService via a Binder — currently the RPC handle is instantiated inside the service and not exposed to the UI process
- [ ] `LocalPearRpc` CompositionLocal for screens to access
- [ ] Wire HomeScreen bookmarks to `rpc.listBookmarks()`
- [ ] Finish screen ports (Bookmarks, History, Settings, MySites, SiteEditor, QRScanner, TemplatePicker)
- [ ] QR scanner (CameraX + ML Kit Vision barcode)
- [ ] Backup phrase / Restore identity screens
- [ ] Firebase App Distribution for beta delivery
- [ ] Verify bare-kit.jar reflection calls against the actual published API
- [ ] IPC Binder pattern so UI and worklet processes share a `PearRpc` over an AIDL interface

## References

- Architecture plan: [`../docs/HOLEPUNCH_ALIGNMENT_PLAN.md`](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md)
- `holepunchto/bare-android` template: <https://github.com/holepunchto/bare-android>
- `holepunchto/bare-kit`: <https://github.com/holepunchto/bare-kit>
- Keet's reference Android shell (not public): <https://keet.io>
