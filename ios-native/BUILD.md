# PearBrowser — iOS Native Shell

Phase 3 of the [Holepunch Alignment Plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md).
Pure Swift + SwiftUI + `BareKit` shell, reusing `backend/` verbatim.

## Current status

| Area | Status |
|---|---|
| XcodeGen project (`project.yml`) | ✅ iPhone + iPad, iOS 16+ |
| Swift IPC client (`PearRPC.swift`) | ✅ actor-based async/await, 8-char hex length framing |
| Worklet host (`PearWorkletHost.swift`) | ✅ wires BareKit `Worklet` + `IPC` (AsyncSequence) |
| Pear bridge injection | ✅ WKScriptMessageHandler path |
| SwiftUI theme | ✅ matches RN theme exactly |
| HomeScreen / ExploreScreen / BrowseScreen | ✅ |
| BareKit.framework + 17 native addons linked | ✅ sourced from `react-native-bare-kit/ios/addons/` |
| **Worklet boots end-to-end on simulator** | ✅ **green "Connected" dot confirmed on iPhone 17 Pro sim** |
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

## iOS addon linking — SOLVED

The worklet bundle includes native addons: **sodium-native**, **udx-native**,
**rocksdb-native**, etc. These are compiled C/C++ modules that the backend
loads at runtime.

**The `react-native-bare-kit` npm package ships all 17 addons pre-built
as xcframeworks** (produced by its `node ios/link.mjs` postinstall hook
running `bare-link`). We reuse those directly — saves us from setting up
our own `bare-link` toolchain.

### How it works
- `node_modules/react-native-bare-kit/ios/BareKit.xcframework` — the runtime
- `node_modules/react-native-bare-kit/ios/addons/*.xcframework` — 17 pre-built addons

We copy both into `ios-native/PearBrowser/Frameworks/` and list each in
`project.yml` as an embedded framework dependency. XcodeGen resolves,
Xcode embeds them in `PearBrowser.app/Frameworks/`, bare-kit's runtime
loader finds them via `bare_addon_load_dynamic` at worklet start.

### Refreshing addons after an `npm install`
The `barekit:fetch:addons` script mirrors the addons from node_modules:

```bash
npm run barekit:fetch:addons
```

Run this after `npm install` or `npm update react-native-bare-kit` to
pick up addon version bumps.

### RPC wire format (important for anyone touching PearRPC.swift)
The worklet RPC is length-prefixed JSON, but **the length prefix is
8 ASCII hex characters, not a 4-byte binary integer** (mirrors
`backend/rpc.js` `_send()`). Both `PearRPC.swift` and `PearRpc.kt`
follow this format. Event messages use the key `event` (not `evt`);
responses use `result` (not `ok`).

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
