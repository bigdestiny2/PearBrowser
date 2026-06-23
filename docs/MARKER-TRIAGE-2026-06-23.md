# PearBrowser - Marker Triage (2026-06-23)

This note records the current first-party task-marker state for PearBrowser.
Generated Bare bundles, dependencies, build output, and vendored artifacts are
out of scope.

## Inventory

First-party markers after this loop are confined to milestone tracker sections:

- `android-native/BUILD.md`
  - QR scanner screen port.
  - Firebase App Distribution beta path.
  - Known v0.2 ship list: remaining screen ports, QR scanner, backup/restore,
    Firebase distribution, and real bare-kit reflection verification.
- `ios-native/BUILD.md`
  - Known v1.0 iOS ship list: LocalPearRPC environment value, remaining screen
    ports, QR scanner, and TestFlight/App Store Connect work.

Older docs that claimed `RelayClient` was still hardcoded are now updated. The
current backend has relay config handlers in `backend/index.js`:
`CMD_GET_RELAYS`, `CMD_SET_RELAYS`, and `CMD_SET_RELAY_ENABLED`.

## Fixed In This Loop

- `android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt`
  now wires the WebView bridge `share(url)` callback to Android's native share
  sheet via `Intent.ACTION_SEND`.
- `docs/HOLEPUNCH_ALIGNMENT_PLAN.md` no longer routes agents to a stale
  hardcoded-relay marker.
- `docs/ARCHITECTURE_REVIEW_HOLEPUNCH_ALIGNMENT.md` now states the current
  relay configurability while keeping the larger architecture concern: default
  discovery still depends on an HTTP relay/catalog surface.

## Classification

| Cluster | Classification | Next action |
|---|---|---|
| Android QR scanner and screen ports | Product milestone | Port screens incrementally, with Kotlin compile after each slice. |
| Android Firebase distribution | Release operations milestone | Configure Firebase App Distribution only after debug/release build proof is current. |
| iOS screen ports and QR scanner | Product milestone | Port after LocalPearRPC environment value is wired. |
| iOS TestFlight/App Store Connect | Release operations milestone | Requires Apple account/tooling validation, not a local code-only loop. |

## Validation Target

Preferred local validation for this slice:

```bash
npm test
android/gradlew -p android-native :app:compileDebugKotlin
```

The native Kotlin compile is the important proof for the Android share-sheet
change. A full APK build remains useful when the local Android environment and
bare-kit artifact are ready.

