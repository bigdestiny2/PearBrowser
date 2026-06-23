# PearBrowser → Full Holepunch Alignment — Implementation Plan

## Context

The [Architecture Review](../../../Desktop/PearBrowser/docs/ARCHITECTURE_REVIEW_HOLEPUNCH_ALIGNMENT.md) scored PearBrowser at 5.5/13 on canonical Holepunch/Pear alignment. The backend worklet (`backend/`) is 9/10 aligned — it uses Hyperswarm, Corestore, Hyperdrive, Hyperbee, Autobase, bare-pack, and bare-http1 directly. The non-aligned parts are:

1. React Native shell on both iOS and Android (should be native Swift / Kotlin a la Keet)
2. Catalog served via HTTP from a centralised relay (should be a Hyperbee)
3. User data (bookmarks, history, settings) in AsyncStorage (should be a user-scoped Hyperbee)
4. `RelayClient` hardcoded, not configurable, not optional
5. `window.pear` bridge slightly diverges from Pear Runtime's documented surface
6. Bundle format `.mjs` (Metro-friendly) instead of canonical `.bundle`

Research confirms that `bare-expo` is just an RN + `react-native-bare-kit` template — *not* a distinct path to native. The real purist move is `bare-android` (Kotlin + bare-kit directly) and `bare-ios` (Swift + bare-kit directly). Keet is the reference for bare-ios; community sources confirm bare-android works in production. UI surface to port is ~4,100 LOC across 11 screens, 4 components, 6 lib files — **~2-3 weeks of native Android work, ~4-6 weeks iOS**. Critically, the entire `backend/` worklet is reusable across all shells.

This plan lays out a phased migration that (a) keeps the current app shippable at every stage, (b) does P2P-only work before rewriting any UI, (c) prioritises Android native as Priority 1 (biggest size/quality win + JNI issues already paid), (d) leaves iOS native as the finish line.

---

## Phase 0 — Foundation (current shell, ~1 week)

**Goal:** Pay down technical debt that blocks clean migrations. Each item below makes Phase 1-3 easier without user-visible disruption.

**Tickets:**

1. **Abstract storage behind a `Storage` interface** (`app/lib/storage.ts`)
   - Define `interface Storage { getBookmarks(), addBookmark(), ... }` matching current functions
   - Implement `AsyncStorageStorage` (current behaviour) as default
   - Prepares for later swap to `HyperbeeStorage`
   - Everything calling `storage.ts` keeps working

2. **Make `RelayClient` URL configurable via RPC + Settings UI**
   - Backend: `CMD_GET_RELAYS`, `CMD_SET_RELAYS`, and
     `CMD_SET_RELAY_ENABLED` handlers are now present in `backend/index.js`
     and persist relay config into `pearbrowser-state.json`.
   - App/native shells can read/write primary + fallback relay settings through
     the RPC mirrors.
   - The old hardcoded-relay marker at `backend/index.js:368` is no longer
     current; that line now validates the relay URL array for the config
     handler.

3. **Extract `window.pear` bridge spec into typed module**
   - Move `app/lib/bridge-inject.ts` injected-script template into `app/lib/pear-bridge-spec.ts` as a frozen constant with TS types
   - Export `injectScript(opts) => string`
   - Makes native shells able to reuse byte-identical injection later

4. **Switch bundle output from `.mjs` to `.bundle`**
   - Update `bare-pack` config to emit `backend/dist/backend.bundle` and `backend.android.bundle`
   - Update `app/App.tsx` bundle import paths
   - Update asset paths in `app.json`

5. **Add smoke tests for: worklet boot, Explore catalog fetch, site publish, sync round-trip**
   - Use `@testing-library/react-native`
   - Mock `rpc` for screen tests; integration test at the RPC level
   - Add to `npm test` so Codex's test runner picks them up

**Verification:**
- `npm test` passes all smoke tests
- iOS + Android apps still boot from current EAS build pipeline
- Settings → Relays can change the relay URL at runtime and the Explore tab respects it
- `backend/dist/backend.bundle` exists and is loaded by the worklet

**Deliverable:** A tagged v0.1.1 release, no user-visible regressions.

---

## Phase 1 — P2P Data Migration (current shell, ~2 weeks)

**Goal:** Move catalog and user data from HTTP/AsyncStorage to P2P-native primitives. Benefits the current shell immediately (multi-device sync) and means the later native shells inherit a P2P data layer for free.

**Tickets:**

1. **Catalog as Hyperbee** (replaces `/catalog.json` HTTP fetch)
   - Relay publishes a signed Hyperbee with entries: `{ key → { name, drive, version, author, categories, publishedAt } }`
   - PearBrowser subscribes via Hyperswarm topic derived from catalog key
   - Relay keeps `/catalog.json` HTTP endpoint alive for 6 months as fallback
   - `ExploreScreen`: when the app has a `rpc`, prefer Hyperbee subscription; fall back to HTTP if no worklet
   - **Bonus:** Anyone with a Hyperbee can be a catalog — "Explore" generalises from "HiveRelay directory" to "any P2P directory"

2. **Bookmarks + History as Hyperbee** (replaces AsyncStorage)
   - New `backend/user-data.js`: manages `bookmarks.bee` and `history.bee` inside the user's Corestore
   - Replicates over a Hyperswarm topic derived from user's root keypair
   - RPC commands: `CMD_BOOKMARKS_GET/ADD/REMOVE`, `CMD_HISTORY_GET/ADD/CLEAR`
   - `storage.ts` swaps `AsyncStorageStorage` for `HyperbeeStorage` when worklet is ready
   - First-launch migration: if AsyncStorage has data, copy it into the Hyperbee, then clear AsyncStorage
   - **User value:** bookmarks sync across their phone + tablet + till without a server

3. **Identity rotation + backup phrase**
   - Backend: `backend/identity.js` — manages root keypair in Corestore with optional 12-word BIP-39 seed phrase
   - RPC: `CMD_IDENTITY_EXPORT_PHRASE`, `CMD_IDENTITY_IMPORT_PHRASE`, `CMD_IDENTITY_ROTATE`
   - Settings UI: "Backup phrase" screen (show once, require confirm), "Restore from phrase" screen
   - Matches Keet's identity model

4. **Relay becomes opt-in**
   - Settings → Relays: a toggle "Use relay for faster first paint" (default ON for now)
   - When OFF: hybrid fetch goes P2P-only
   - Explore catalog still loads from Hyperbee regardless

**Verification:**
- Adding a bookmark on phone appears on a second device after both devices open the app on the same Wi-Fi
- Disabling the relay toggle still loads Pear POS (slower first paint but it works)
- Backup phrase round-trips: export → wipe app → reinstall → restore → identity is same pubkey
- Explore works with 0 relays configured (pure Hyperbee catalog)

**Deliverable:** v0.3 — "Everything syncs across your devices, no server required."

**Critical files changed:**
- `backend/index.js`, `backend/constants.js` — new RPC handlers
- `backend/user-data.js` (new)
- `backend/identity.js` (new)
- `backend/catalog-manager.js` — gains Hyperbee subscription path
- `app/lib/storage.ts` — implements interface, swaps AsyncStorage → HyperbeeStorage
- `app/screens/ExploreScreen.tsx`, `SettingsScreen.tsx`, `BookmarksScreen.tsx`, `HistoryScreen.tsx` — read from RPC when worklet available
- `app/screens/BackupPhraseScreen.tsx` (new), `RestoreIdentityScreen.tsx` (new)

---

## Phase 2 — Android Native Shell (bare-android, ~4-6 weeks)

**Goal:** Rebuild the Android app as a pure Kotlin + Jetpack Compose app that embeds `bare-kit` directly, with no React Native. **The `backend/` worklet is reused verbatim.** This is the highest-value move: drops APK from ~372MB to sub-50MB, removes Hermes (one JS engine instead of two), fixes all the JNI/bundle workarounds, and matches the canonical Holepunch Android path.

**Tickets:**

1. **Scaffold `PearBrowser-android` Kotlin project**
   - Fork `holepunchto/bare-android` template
   - Set up XcodeGen equivalent (Gradle Kotlin DSL)
   - Install `bare-kit` .jar from GitHub releases; place in `app/libs/`
   - NDK 27.2.12479018 (per Holepunch requirements)
   - App ID: `com.pearbrowser.app` (matches existing)

2. **Port the `backend/` build to Android**
   - `bare-pack --target android --out app/src/main/assets/app.bundle`
   - `bare-link` pre-build task to process native addons
   - Wire the bundle loader in `MainActivity.kt` with the correct worklet start call
   - Success metric: worklet boots, logs `READY` event via IPC in Logcat

3. **Kotlin IPC client matching `app/lib/rpc.ts`**
   - `PearRpc.kt` — length-prefixed JSON over Bare Worklet IPC
   - Callback-based: `rpc.onReady { port -> }`, `rpc.onPeerCount { count -> }`
   - Coroutines-based request/reply API: `suspend fun getStatus(): Status`
   - Reuses byte-identical protocol from `backend/rpc.js` — no backend changes

4. **Jetpack Compose UI layer — screen-by-screen port**
   Order of porting (by complexity, simpler first so wins come early):
   - `HomeScreen` (simple) — search bar, quick access, welcome state
   - `BookmarksScreen` (simple) — list with remove
   - `HistoryScreen` (simple) — grouped-by-day list
   - `TemplatePickerScreen` (simple) — carousel of presets
   - `ExploreScreen` (medium) — catalog fetch + list (already platform-agnostic after Phase 1)
   - `SettingsScreen` (medium) — toggle + text input + list
   - `MoreScreen` (medium) — menu hub
   - `QRScannerScreen` (medium) — CameraX + ML Kit Vision barcode scanning
   - `MySitesScreen` (complex) — list + create + publish + share
   - `BrowseScreen` (complex) — native WebView + bridge injection + URL bar
   - `SiteEditorScreen` (complex) — block editor, RecyclerView-based

5. **Replace each RN bridge point with native equivalent**
   | RN API | Android native replacement |
   |---|---|
   | `react-native-bare-kit` Worklet.IPC | `PearRpc.kt` wrapping bare-kit Java API |
   | `react-native-webview` | Android `WebView` with `addJavascriptInterface` for postMessage |
   | `expo-camera` | CameraX + ML Kit Vision barcode |
   | `expo-file-system` | `Context.filesDir` / `FileProvider` |
   | `@react-native-async-storage/async-storage` | DataStore (post-Phase 1: HyperbeeStorage makes this moot) |
   | `@react-native-community/netinfo` | `ConnectivityManager` |
   | `Share` | `Intent.ACTION_SEND` |
   | `Alert`, `Alert.prompt` | `AlertDialog` |
   | `Clipboard` | `ClipboardManager` |

6. **Reuse the Pear bridge injection script byte-identically**
   - Load `app/lib/pear-bridge-spec.ts` output as a resource
   - Inject via `WebView.evaluateJavascript` on page load
   - Localhost HTTP proxy + X-Pear-Token stay unchanged
   - Apps (POS, Bazaar, etc.) see identical `window.pear` API

7. **APK size budget: < 50MB**
   - ABI splits: arm64-v8a only (or arm64 + armeabi-v7a if we care about old devices)
   - R8/ProGuard enabled
   - Remove React Native + Hermes + Metro entirely
   - Measured target: ~45MB debug, ~30MB release

8. **TestFlight-equivalent beta via Firebase App Distribution**
   - Push the APK to Firebase for internal testers
   - Parallel track: old RN Android APK remains available until v0.2 ships stable

**Verification:**
- Fresh install → worklet boots within 3s (vs 15s+ on RN) → "Connected" status
- Full flow: Explore → Visit Pear POS → POS loads → onboarding renders
- Create a site, publish it, open from Bookmarks
- QR scanner detects a hyper:// QR and navigates
- APK size < 50MB on release build
- No Hermes in the dex output

**Deliverable:** v0.2 Android — "Real P2P on Android" — shipped as a separate Android track alongside the iOS RN app

**Risks and mitigations:**
- **Risk:** Kotlin team ramp-up. **Mitigation:** Assign 1 senior dev full-time; screens are small enough to port in 2-3 days each.
- **Risk:** WebView + bridge gotchas on Android (different default settings than iOS WKWebView). **Mitigation:** Test the POS app first (known working on iOS); isolate any Android-specific differences.
- **Risk:** CameraX + ML Kit adds back weight. **Mitigation:** Use Google's MLKit Play Services model delivery — keeps APK lean.

---

## Phase 3 — iOS Native Shell (bare-ios, ~6-8 weeks)

**Goal:** Rebuild the iOS app in Swift + SwiftUI using `bare-ios` + `bare-kit` directly. Reuses `backend/` worklet verbatim.

**Tickets:**

1. **Scaffold `PearBrowser-ios` Swift project**
   - Fork `holepunchto/bare-ios` template
   - XcodeGen `project.yml` configured with bundle ID `com.pearbrowser.app`
   - BareKit `.xcframework` from GitHub releases in `app/frameworks/`
   - Xcode 15+, iOS 16+ deployment target (matches current)

2. **Swift IPC client**
   - `PearRPC.swift` — async/await version of `PearRpc.kt`
   - Actor-based for thread safety
   - Identical wire format

3. **SwiftUI UI port — same screen-by-screen order as Android**
   - Reuse the Kotlin-port notes as a guide (same layout, same state model)
   - Use `WKWebView` for BrowseScreen (same bridge injection as RN's react-native-webview)
   - `AVCaptureSession` + Vision framework for QR scanning

4. **Replace RN bridges with native Swift equivalents**
   | RN API | iOS native replacement |
   |---|---|
   | WKWebView | `WKWebView` (direct, no RN wrapper) |
   | expo-camera | `AVCaptureSession` + `AVCaptureMetadataOutput` |
   | expo-file-system | `FileManager.default` |
   | AsyncStorage | `UserDefaults` (post-Phase 1: moot) |
   | NetInfo | `NWPathMonitor` |
   | Share | `UIActivityViewController` |
   | Alert | `.alert` SwiftUI modifier |
   | Clipboard | `UIPasteboard.general` |

5. **IPA size budget: < 40MB**
   - Bitcode off (Xcode 14+ default)
   - Strip symbols in release
   - Measured target: ~35MB release

6. **TestFlight beta**
   - Apple App Store submission
   - Keep old RN iOS version available for 3 months as fallback

**Verification:**
- All iOS features from the current RN version work identically
- Side-by-side comparison with RN version — UX feels the same, P2P is faster
- App Review passes (Explore framing from previous work still protects 4.7)
- IPA < 40MB

**Deliverable:** v1.0 — "Native everywhere, pure Holepunch stack, no React Native" — marketed as "The P2P browser, now as fast as Signal."

**Risks and mitigations:**
- **Risk:** Apple App Review might flag the P2P networking or hyper:// scheme. **Mitigation:** Frame as "personal website browser with directory" per existing Explore reframing; have the privacy policy and architecture explainer ready.
- **Risk:** bare-ios has fewer public reference apps than bare-android. **Mitigation:** Keet is the reference; Swift community is large enough to solve any emergent issues.

---

## Phase 4 — Polish + Purist Finishing (ongoing)

After Phase 3, the remaining items from the architecture review checklist:

- **`window.Pear` namespace alignment** — rename `window.pear` to `window.Pear` to match Pear Runtime exactly; extension-specific endpoints move to `window.PearBrowser.*`. Version bump to v1.1.
- **Catalog signing verification** — app verifies catalog Hyperbee signatures before trusting entries. Prevents rogue catalogs from injecting malicious entries.
- **App signing / capability verification** — drives that are signed by known authorities get a verified badge in Explore.
- **Release checklist automation** — CI: typecheck, bundle, startup smoke, regression suite (mirrors Codex's Phase 3 recommendation).
- **Bare-on-Desktop parity** — stretch goal: a Pear Desktop version that shares the worklet, proving the architecture works across all three surfaces (iOS, Android, Desktop).

---

## Headless transport — XHR over streamx (idea: Dominic Cassidy · @Drache93)

A purist-alignment win that lands now, not at the finish line. Today every page
request goes `page → localhost HTTP proxy → worklet → P2P` — that localhost
server is an HTTP **head** the canonical Pear shape doesn't want.

**Dominic's pattern removes it:** hook `XMLHttpRequest` so htmx (and any
XHR-based app) thinks it's hitting a server, when each request is actually a
**streamx** stream into the worklet / a peer / a Hyperdrive. No HTTP, no TCP, no
head — apps can even run **headless** (no browser).

- Shim: `backend/xhr-streamx.js` — `createXHR` / `installXHR` + streamx-native handlers (`serveRoutes`, `serveHyperdrive`, `echoHandler`).
- Proof: `test/xhr-streamx.test.js` — GET / POST / streaming / json / error (7/7).
- Demo: `examples/htmx-headless/` — a real htmx app served over streamx, run headless.

This advances review items **2 & 5** (streamx-everywhere, no servers; the bridge
matching the canonical Pear surface) and opens a clean path to a headless app
runner and server-as-a-peer apps. Full credit to **Dominic Cassidy** ([@Drache93](https://github.com/Drache93)) for the approach.

---

## Review hardening pass — self-review at a canonical-Holepunch standard

Before submission the whole change set was put through an adversarial multi-agent
code review at canonical-Holepunch standard; every confirmed finding was fixed or
honestly documented.

**streamx correctness (the headline `xhr-streamx` transport):**
- `abort()`/timeout now `destroy()` the in-flight source stream so cancellation
  propagates up the hypercore pipeline — was cancel-by-boolean that leaked an idle
  drive read forever (the *common* case on P2P).
- Response body decoded once with a size cap — was O(n²) per-chunk
  concat+re-stringify plus unbounded buffering of a drive into the worklet heap.
- async-iterator path honors abort; a single `_done` guard makes
  abort/timeout/error/load terminal-once. Regression tests cover each.

**swarm.v1 bugs:** channel-count slot leak on denied consent (8 denials locked the
app out of swarm) fixed; server-role channels now receive inbound peers (was
filtered on `PeerInfo.topics`, which is empty for inbound connections);
shared-topic cross-delivery removed via a single bridge-level connection handler +
single-attribution routing.

**security:** strict CSP on every proxied HTML response (an injected/third-party
script can no longer exfiltrate the page-readable bridge token); localhost CORS is
default-deny; Tier-A "scoping" claims softened to the truth (drive keys are public).

**runtime hygiene:** `b4a` instead of Node `Buffer` in worklet code (rpc framing,
proxy, base64); Hyperdrive large/range responses streamed via `createReadStream`
instead of full-buffer; storage-monitor interval cleared on shutdown; SSE honors
backpressure; a cross-process test race fixed so the suite is green concurrently
(no `--test-concurrency=1` crutch).

**honesty:** README/docs overclaims removed — the dead live-demo URL, and a publish
flow that now describes the real DHT-announce mechanism instead of a `POST /seed`
it never makes.

**Documented known-gaps (deliberately not half-built):**
- *Per-app origin isolation* — every `hyper://` page shares one
  `http://127.0.0.1:PORT` origin, so the browser does not partition them. Canonical
  fix: a per-app origin (custom scheme handler / per-key subdomain). CSP +
  token-scoping mitigate in the meantime.

**Update — full Protomux multiplexing landed.** `swarm.v1` now multiplexes many
logical channels over one connection per peer: `Protomux.from(conn)` plus a
`pear.swarm.v1/<protocol>` sub-channel keyed by the topic buffer (the same
primitive hypercore replication muxes over). **Pairing is the topic filter**,
which structurally fixes both server-role peers and cross-delivery, and two
channels share one socket with zero cross-talk — covered by a multiplexing
isolation test (two channels, one connection, each sees only its own frames).
This is the "acts like a real browser" model: concurrent logical streams over
multiplexed connections.

---

## Phase Summary

| Phase | Duration | Deliverable | User-Visible Change |
|---|---|---|---|
| 0 | 1 week | v0.1.1 foundation | None (debt payoff) |
| 1 | 2 weeks | v0.3 P2P data | Bookmarks sync across devices; identity backup phrase; relay optional |
| 2 | 4-6 weeks | v0.2 Android native | Android APK 45MB (was 372MB); DHT connects in 2s (was 15s); real P2P works |
| 3 | 6-8 weeks | v1.0 iOS native | Same UX on iOS, faster boot, smaller app |
| 4 | Ongoing | v1.1+ polish | Signed catalogs, verified apps, desktop parity |

**Total: ~14-19 weeks for full Holepunch alignment** from today.

---

## Decision Points (surface now, before Phase 0)

1. **Phase 2 repo structure:** Should Android native be a separate repo (`PearBrowser-android`) or a new top-level `android-native/` folder inside the existing `PearBrowser/` monorepo? Monorepo is easier for backend reuse; split repo is cleaner build systems. **Recommendation:** Monorepo with `android-native/` and `ios-native/` siblings to `app/` and `backend/`.

2. **Current RN app retention:** Once Phase 2 ships, do we keep the RN Android around? **Recommendation:** Keep for 3 months as fallback, then retire. The RN iOS stays alive until Phase 3 ships.

3. **Bundle signing for catalogs:** Use Hypercore's built-in signing keys (simple, one-key-per-catalog) or add a layer with multiple signers? **Recommendation:** Start with Hypercore's single-key signing for v0.3; multi-signer can come later in Phase 4.

4. **Hyperbee user data:** Do we give each user one root keypair (multi-device sync via sharing the seed phrase) or separate keys per device with pairing? **Recommendation:** One root keypair + seed phrase = Keet's model and proven UX.

---

## Critical Files Referenced

- `/Users/localllm/Desktop/PearBrowser/docs/ARCHITECTURE_REVIEW_HOLEPUNCH_ALIGNMENT.md` — parent doc
- `/Users/localllm/Desktop/PearBrowser/docs/RELAY_CATALOG_POPULATION.md` — prerequisite for Phase 1 catalog work
- `/Users/localllm/Desktop/PearBrowser/backend/index.js` — hardcoded RelayClient at line 368 (Phase 0 ticket 2)
- `/Users/localllm/Desktop/PearBrowser/app/lib/storage.ts` — storage interface target (Phase 0 ticket 1)
- `/Users/localllm/Desktop/PearBrowser/app/lib/bridge-inject.ts` — source for `pear-bridge-spec.ts` extraction (Phase 0 ticket 3)
- `/Users/localllm/Desktop/PearBrowser/backend/catalog-manager.js` — Hyperbee subscription target (Phase 1)
- `/Users/localllm/Desktop/PearBrowser/app/lib/rpc.ts` — reference for `PearRpc.kt` and `PearRPC.swift` (Phases 2, 3)
- Reference repo: `github.com/holepunchto/bare-android` — template for Phase 2
- Reference repo: `github.com/holepunchto/bare-ios` — template for Phase 3

---

## Verification — End-to-End Success Criteria

At the end of all phases, PearBrowser should:

1. ✅ Run on iOS and Android with **no React Native**
2. ✅ Load in < 3 seconds on both platforms
3. ✅ APK < 50MB, IPA < 40MB
4. ✅ One engine per platform (V8 via Bare, no Hermes)
5. ✅ Bookmarks, history, settings sync across the user's devices via Hyperbee
6. ✅ Catalog comes from a signed Hyperbee, not HTTP
7. ✅ Relay is optional at runtime
8. ✅ Backup phrase export / import works
9. ✅ `window.Pear` surface matches Pear Runtime documentation
10. ✅ Bundle format is `.bundle` (canonical bare-pack output)
11. ✅ Backend `backend/` worklet is identical across all three shells
12. ✅ Purist checklist from architecture review reaches **12/13** (the 13th — Desktop parity — is Phase 4 stretch)
