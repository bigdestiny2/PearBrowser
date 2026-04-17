# ios-native — PearBrowser Swift Shell

Phase 3 of the [Holepunch alignment plan](../docs/HOLEPUNCH_ALIGNMENT_PLAN.md):
a pure SwiftUI + `BareKit` iOS app that reuses the `backend/` worklet
from the sibling RN project.

See [BUILD.md](./BUILD.md) for prerequisites and compilation.

## Tree

```
ios-native/
├── project.yml                  # XcodeGen config (source of truth for .xcodeproj)
├── BUILD.md                     # ← start here
├── README.md                    # (this file)
└── PearBrowser/
    ├── Info.plist               # URL schemes, permissions, ATS
    ├── PearBrowser.entitlements # keychain access group
    ├── LaunchScreen.storyboard  # dark background splash
    ├── Assets.xcassets/
    │   ├── AppIcon.appiconset/  # 18 icon sizes from the pear icon
    │   └── AccentColor.colorset/  # #FF9500
    ├── Frameworks/              # ← drop BareKit.xcframework here (gitignored)
    └── Sources/
        ├── App/
        │   ├── PearBrowserApp.swift   (@main)
        │   └── MainView.swift         (tab navigator, status dot)
        ├── Bridge/
        │   ├── PearWorkletHost.swift  (@MainActor ObservableObject, boots worklet)
        │   └── PearBridgeScript.swift (window.pear injection template)
        ├── RPC/
        │   ├── PearRPC.swift          (actor, length-prefixed JSON IPC)
        │   └── Protocol.swift         (Cmd/Evt IDs, mirrors backend/constants.js)
        └── UI/
            ├── Theme/PearColors.swift (mirrors app/lib/theme.ts)
            └── Screens/
                ├── HomeScreen.swift
                ├── ExploreScreen.swift
                ├── BrowseScreen.swift
                ├── MoreScreen.swift     (stub)
                └── BookmarksScreen.swift (stub)
```

## How this differs from the RN shell

| Concern | RN shell (`app/`) | Swift shell (this) |
|---|---|---|
| UI framework | React Native 0.83 | SwiftUI |
| JS engine for UI | JavaScriptCore (iOS) | (none) |
| JS engine for worklet | V8 via BareKit | V8 via BareKit — same |
| Bridge into the WebView | RN postMessage relay | WKScriptMessageHandler (`window.webkit.messageHandlers.PearBrowserNative`) |
| Storage (pre-Phase-1) | AsyncStorage | Keychain / UserDefaults |
| Storage (post-Phase-1) | Hyperbee via RPC | Hyperbee via RPC — identical |
| QR scanner | `expo-camera` | AVCaptureSession + Vision |
| Bundle path | `assets/backend.bundle.mjs` (Metro import) | `backend.ios.bundle` (mmap'd resource) |
| Expected IPA size | ~180 MB | < 40 MB |

## Backend reuse

The worklet (`backend/*.js`) is **unchanged**. Build with:

```bash
npm run bundle-backend-native-ios
# → backend/dist/backend.ios.bundle
```

`project.yml` references that path as an `optional` resource so the
Xcode project still compiles before you've run the bundle command.

## Why Swift / SwiftUI and not Flutter / RN / other

See the [Architecture Review](../docs/ARCHITECTURE_REVIEW_HOLEPUNCH_ALIGNMENT.md).

TL;DR: Holepunch's canonical iOS path is `bare-ios` (Swift + native views
embedding `BareKit` directly). Keet is the reference. This shell follows
that pattern so PearBrowser's architecture score against the Pear-purist
checklist rises to ~11/13 after this phase.
