# PearBrowser — iOS Native Shell

Phase 3 of the [Holepunch Alignment Plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md).
Pure Swift + SwiftUI + `BareKit` shell, reusing `backend/` verbatim.

## Current status

| Area | Status |
|---|---|
| XcodeGen project (`project.yml`) | ✅ iPhone + iPad, iOS 16+ |
| Swift IPC client (`PearRPC.swift`) | ✅ actor-based async/await |
| Worklet host (`PearWorkletHost.swift`) | ✅ wires BareKit `Worklet` + `IPC` (AsyncSequence) |
| Pear bridge injection | ✅ WKScriptMessageHandler path |
| SwiftUI theme | ✅ matches RN theme exactly |
| HomeScreen / ExploreScreen / BrowseScreen | ✅ |
| BareKit.framework linked + app builds | ✅ via SPM + xcframework drop-in |
| **Worklet boots native addons** | ⚠️ **known blocker** — see "iOS addon linking" below |
| Remaining screen ports (More, Bookmarks, Settings, MySites, Editor, QR, TemplatePicker, BackupPhrase, Restore) | ⏳ |

## Prerequisites

1. **macOS 14+** with **Xcode 15.3+**. iPhone simulator or iOS 16+ device.
2. **XcodeGen**: `brew install xcodegen`
3. **Node.js 20+** (for bundling the worklet)
4. **BareKit.xcframework** — fetch with the included script:
   ```bash
   npm run barekit:fetch
   ```
   This downloads bare-kit v2.0.2's JavaScriptCore variant (required for
   App Store compliance — JIT-enabled V8 would be rejected) and places
   it at `ios-native/PearBrowser/Frameworks/BareKit.xcframework`.

## Build + run

```bash
# Bundle the backend worklet for iOS
cd /Users/localllm/Desktop/PearBrowser
npm run bundle-backend-native-ios
# → backend/dist/backend.ios.bundle (~2.1 MB)

# Fetch BareKit (one-time)
npm run barekit:fetch

# Generate Xcode project (re-run after editing project.yml)
cd ios-native && xcodegen generate

# Build for the booted iPhone 17 Pro simulator
xcodebuild -project PearBrowser.xcodeproj \
    -scheme PearBrowser \
    -sdk iphonesimulator \
    -configuration Debug \
    build

# Install + launch
APP="$HOME/Library/Developer/Xcode/DerivedData/PearBrowser-hjgjxqsbwjpmhmepdqsvnwqkdihc/Build/Products/Debug-iphonesimulator/PearBrowser.app"
xcrun simctl install booted "$APP"
xcrun simctl launch booted com.pearbrowser.app
```

The build also succeeds **without** `BareKit.xcframework` or the bundle —
in that case `PearWorkletHost` enters "demo mode" where the UI renders
but no worklet runs. Useful for UI iteration.

## ⚠️ iOS addon linking — known blocker

The worklet bundle includes native addons: **sodium-native**, **udx-native**,
**rocksdb-native**, etc. These are compiled C/C++ modules that the backend
loads at runtime.

**bare-kit's prebuilt `BareKit.xcframework` does NOT include them.** When
the worklet's `require('sodium-universal')` runs inside `PearBrowser.app`,
`bare_runtime__abort()` fires because the addon can't be found.

### Stack trace you'll see
```
libsystem_c.dylib        abort
BareKit                  bare_runtime__abort
BareKit                  js__on_function_call
JavaScriptCore           JSC::callJSCallbackFunction
```

### Why this isn't blocking on Android
Android solves it by having `bare-link` (a Gradle task) pre-process
`addons.yml` and link each addon as a static library into the
`bare-kit.so`. The `holepunchto/bare-android` template wires this up
automatically.

### The fix for iOS (not done yet)
We need to either:

1. **Build a custom BareKit.xcframework with our addons statically linked.**
   Follow `holepunchto/bare-kit`'s build instructions with an `addons.yml`
   listing sodium-native, udx-native, rocksdb-native, bare-fs, etc.
   Produces an xcframework that's specific to PearBrowser's backend.

2. **Ship addons as separate dynamic libraries.** Use `bare_addon_load_dynamic`
   (the symbol already exists in the prebuilt framework). Requires each
   addon to be built as an iOS `.dylib` and embedded in the app's Frameworks
   dir. Complex — each addon has its own build toolchain.

3. **Prune the backend to not need native addons** for a minimal "browser
   only" mode. Removes identity signing, encryption, much of the P2P —
   basically not viable for shipping.

**Recommended path:** Option (1). Estimated 1-2 days with the bare-kit
build environment set up. Until then, the iOS shell boots fine, the UI
works, the Explore tab loads the catalog over HTTPS, the BrowseScreen
renders relay URLs — but `hyper://` P2P content requires the worklet
which requires the addons.

Tracked in `docs/HOLEPUNCH_ALIGNMENT_PLAN.md` under "iOS addon linking
follow-up".

## Size budget

| Build type | Target | Actual |
|---|---|---|
| Debug IPA (demo mode, no BareKit) | — | 8.2 MB |
| Debug IPA (BareKit JSC embedded) | < 50 MB | **~10 MB** |
| Release IPA | < 40 MB | TBD |

Compare to RN iOS archived build (~180 MB). The JSC-variant BareKit is
20 MB embedded; the whole native app ships at **~10 MB Debug** (the 20 MB
framework gets significant dead-code stripping + the BareKit binary is
only in Frameworks, not duplicated).

## Tickets API reference (Phase 4 additions)

Recent additions to `window.pear` — available to all pages, all shells:

```js
// Sync range queries with explicit bounds
await window.pear.sync.range('tickets-event-abc', {
  gte: 'tickets!',
  lt: 'tickets!~',
  reverse: true,
  limit: 50
})

// Count under a prefix (O(n), capped at 100k)
const { count } = await window.pear.sync.count('tickets-event-abc', 'tickets!')

// Sign arbitrary payload with user's ed25519 root key
const { signature, publicKey } = await window.pear.identity.sign(
  JSON.stringify({ type: 'ticket:mint', ticketId: 'abc' }),
  'tickets'  // optional namespace — prevents cross-app replay
)
```

`sync.create()` and `sync.join()` now return `{ inviteKey, appId, writerPublicKey }`.

**13 ticket ops** added to `_defaultApply`: `event:create`, `event:update`,
`event:publish`, `event:cancel`, `ticket-type:create`, `ticket-type:update`,
`ticket:mint`, `ticket:transfer`, `ticket:redeem`, `ticket:refund`,
`ticket:void`, `attendee:register`, `venue:set`.

See `backend/pear-bridge.js` for the exact key structures.

## Known TODOs before v1.0 iOS ship

- [ ] **iOS addon linking** (see above — main blocker)
- [ ] LocalPearRPC EnvironmentValue for screens
- [ ] Finish screen ports (Bookmarks, History, Settings, MySites,
      SiteEditor, QRScanner, TemplatePicker, BackupPhrase, RestoreIdentity)
- [ ] QR scanner: AVCaptureSession + Vision VNDetectBarcodesRequest
- [ ] TestFlight submission + App Store Connect config

## References

- [Architecture Review](../docs/ARCHITECTURE_REVIEW_HOLEPUNCH_ALIGNMENT.md)
- [Holepunch Alignment Plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md)
- [`../android-native/BUILD.md`](../android-native/BUILD.md) — Android counterpart
- `holepunchto/bare-ios`: <https://github.com/holepunchto/bare-ios>
- `holepunchto/bare-kit-swift`: <https://github.com/holepunchto/bare-kit-swift>
- `holepunchto/bare-kit`: <https://github.com/holepunchto/bare-kit>
