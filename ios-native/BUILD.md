# PearBrowser — iOS Native Shell

Phase 3 of the [Holepunch Alignment Plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md).
A pure Swift + SwiftUI + `BareKit` shell, reusing the `backend/` worklet
from the RN project verbatim.

## Current status

| Area | Status |
|---|---|
| XcodeGen project (`project.yml`) | ✅ targets iPhone + iPad, iOS 16+ |
| Swift IPC client (`PearRPC.swift`) | ✅ actor-based, async/await, 20+ typed methods |
| Worklet host (`PearWorkletHost.swift`) | ✅ `@MainActor` `ObservableObject` with `@Published` state |
| Pear bridge injection (`PearBridgeScript.swift`) | ✅ byte-identical template with `WKScriptMessageHandler` path |
| SwiftUI theme | ✅ matches `app/lib/theme.ts` exactly |
| HomeScreen | ✅ search bar + welcome state (bookmarks wiring TODO) |
| ExploreScreen | ✅ URLSession catalog fetch + Visit flow |
| BrowseScreen | ✅ WKWebView + bridge injection at documentStart |
| MoreScreen, BookmarksScreen, HistoryScreen, SettingsScreen, MySitesScreen, SiteEditorScreen, QRScannerScreen, TemplatePickerScreen | ⏳ stubs / pending port |
| QR scanner (AVCaptureSession + Vision) | ⏳ TODO |
| Backup phrase / Restore identity screens | ⏳ TODO |
| TestFlight distribution | ⏳ TODO |

## Prerequisites

1. **macOS 14+** with **Xcode 15.3+** (Xcode 16 recommended). iPhone 17 Pro simulator or a physical iOS 16+ device.
2. **XcodeGen** for generating the `.xcodeproj`:
   ```bash
   brew install xcodegen
   ```
3. **Node.js 20+** (for bundling the backend).
4. **`BareKit.xcframework`** — download the latest release from
   <https://github.com/holepunchto/bare-kit/releases>
   and unzip into `ios-native/PearBrowser/Frameworks/BareKit.xcframework`.
   The framework is **not checked in** (see `.gitignore`).

## Building the bundled backend

The Swift shell reuses `backend/` unchanged:

```bash
cd /Users/localllm/Desktop/PearBrowser
npm install                                # if not already
npm run bundle-backend-native-ios
# Produces backend/dist/backend.ios.bundle
```

`project.yml` references that path as a resource so it's automatically
copied into the app bundle at build time.

## Generating the Xcode project

```bash
cd /Users/localllm/Desktop/PearBrowser/ios-native
xcodegen generate
```

That creates `PearBrowser.xcodeproj` (gitignored). Open it:

```bash
open PearBrowser.xcodeproj
```

## Running on the simulator

1. In Xcode, pick the `PearBrowser` scheme and the `iPhone 17 Pro` simulator.
2. Press ⌘R.

Or from the command line:

```bash
cd ios-native
xcodebuild -project PearBrowser.xcodeproj \
    -scheme PearBrowser \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    build
xcrun simctl install booted build/Debug-iphonesimulator/PearBrowser.app
xcrun simctl launch booted com.pearbrowser.app
```

## Running on a device

1. Set `DEVELOPMENT_TEAM` in `project.yml` to your Team ID (or select a team manually in Xcode after `xcodegen generate`).
2. Enable developer mode on the device.
3. Select the device in Xcode, press ⌘R.

## Size budget

| Build type | Target | Current |
|---|---|---|
| Debug IPA | < 50 MB | TBD (needs first build) |
| Release IPA (archived) | < 40 MB | TBD |

Compared to the RN iOS build (~180 MB archived), we expect a **~75% reduction**.
Drivers:
- No React Native runtime (no Hermes, no RN bridge)
- No JavaScriptCore for the UI layer (only BareKit's V8 for the worklet)
- Native Swift + SwiftUI only
- Bitcode off (Xcode default)

## Keeping things in sync across the three shells

- **`backend/`** is the source of truth. Never diverge — any change must be
  a worklet change.
- **`app/lib/constants.ts`** ↔ **`android-native/.../rpc/Protocol.kt`** ↔
  **`ios-native/.../RPC/Protocol.swift`** — Cmd + Evt IDs must stay in lock-step.
- **`app/lib/rpc.ts`** ↔ **`android-native/.../rpc/PearRpc.kt`** ↔
  **`ios-native/.../RPC/PearRPC.swift`** — method surfaces must stay in lock-step.
- **`app/lib/pear-bridge-spec.ts`** ↔ **`android-native/.../bridge/PearBridgeScript.kt`** ↔
  **`ios-native/.../Bridge/PearBridgeScript.swift`** — the injected JS template is byte-identical.

## Known TODOs before v1.0 iOS ship

- [ ] Verify `BareKit.Worklet` Swift API against the actual published `.xcframework`
      (our import assumes `Worklet.start(file:source:arguments:)` and
      `worklet.ipc.sink / send` — if the real API differs we adapt `PearWorkletHost` accordingly)
- [ ] Plumb a `LocalPearRPC` EnvironmentValue so screens can get the RPC
      via `@Environment` instead of `@EnvironmentObject` on the host
- [ ] Finish screen ports (Bookmarks, History, Settings, MySites,
      SiteEditor, QRScanner, TemplatePicker, BackupPhrase, RestoreIdentity)
- [ ] QR scanner using AVCaptureSession + Vision's `VNDetectBarcodesRequest`
- [ ] TestFlight submission + App Store Connect config
- [ ] Push WKWebView navigation/share events up to MainView

## References

- [Architecture Review](../docs/ARCHITECTURE_REVIEW_HOLEPUNCH_ALIGNMENT.md)
- [Holepunch Alignment Plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md)
- Android shell counterpart: [`../android-native/BUILD.md`](../android-native/BUILD.md)
- `holepunchto/bare-ios` template: <https://github.com/holepunchto/bare-ios>
- `holepunchto/bare-kit`: <https://github.com/holepunchto/bare-kit>
