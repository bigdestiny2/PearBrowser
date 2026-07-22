# PearBrowser Test Command Matrix - 2026-06-23

Purpose: give future agents exact commands, scopes, and exclusions for
PearBrowser. Source status is summarized in
`docs/CURRENT_STATUS_AUDIT_2026-06-23.md`; release evidence is summarized in
`docs/MOBILE_RELEASE_EVIDENCE_2026-06-23.md`.

## Read First

- Root project: `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser`
- This is a standalone git repository; the worktree was clean before this docs
  loop.
- The repo has no `.github/` workflow directory in this checkout. Use
  `package.json` scripts and the direct commands below as the current local
  source of truth.
- `SUBMISSION.md` still contains an older `88/88` test claim. The current
  source baseline is `136/136` tests.
- Production mobile release proof is blocked by real signing and store
  distribution markers, not by local source tests.

## Deterministic Local Gates

| Command | Scope | Current result | Notes |
|---|---|---|---|
| `npm test` | Full source gate: `npx tsc --noEmit`, selected backend `node --check` files, then `node --test test/*.test.js` | Pass on 2026-06-23: 136/136 tests | Covers catalog safety, signed catalogs, relay config, trusted origins, bridge tokens, `swarm.v1`, release-preflight fixture logic, identity, native parity, navigation, and XHR-over-streamx behavior. |
| `npm audit --audit-level=high` | High/critical dependency gate | Exit 0 on 2026-06-23 | Full audit still reports 15 moderate inherited Expo/React Native toolchain advisories through `js-yaml` and `uuid`; npm's fixes require breaking framework changes. |
| `npm run release:preflight -- --soft` | Human-readable mobile release preflight | Blocked on 2026-06-23: 14 pass, 0 warn, 4 fail | Structural release checks pass; production signing/store markers are missing. `--soft` keeps the shell exit code zero for audit capture. |
| `npm run release:preflight -- --json --soft` | Machine-readable mobile release preflight | Same 14/0/4 counts on 2026-06-23 | Use this for release evidence artifacts or CI logs. |

## Focused Regression Slices

| Command | Scope | Current result | When to use |
|---|---|---|---|
| `node --test test/release-preflight.test.js` | Release preflight fixture behavior | Pass on 2026-06-23: 3/3 | Use after changing `scripts/release-preflight.js`, `app.json`, native release config parsing, or release blocker semantics. |
| `node --test test/http-bridge-origin-sse.test.js` | SSE/EventSource token and origin boundary | Not rerun in this loop; covered by full `npm test` | Use after changing `backend/http-bridge.js`, `backend/hyper-proxy.js`, or `pear.session()` token handling. |
| `node --test test/swarm-v1-parity.test.js test/swarm-v1-runtime-smoke.test.js` | `swarm.v1` parity, runtime fixture, and multiplexing | Not rerun in this loop; covered by full `npm test` | Use after touching `backend/swarm-bridge.js`, `backend/swarm-grants.js`, bridge injection templates, or native command mirrors. |
| `node --test test/trusted-origins.test.js` | Trusted-origin allowlist/default behavior and persistence | Not rerun in this loop; covered by full `npm test` | Use after trust-boundary changes. |
| `node --test test/xhr-streamx.test.js` | XHR-over-streamx transport, streaming, abort, size cap, timeout | Not rerun in this loop; covered by full `npm test` | Use after touching `backend/xhr-streamx.js` or headless htmx transport behavior. |
| `node --test test/native-catalog-parity.test.js test/mobile-screen-harness.test.js test/connected-apps-parity.test.js` | Native UI/source-contract parity | Not rerun in this loop; covered by full `npm test` | Use after Android/iOS/RN shell command or screen wiring changes. |

## Build, Bundle, And Native Gates

| Command | Scope | Current status | Notes |
|---|---|---|---|
| `npm run bundle-all` | RN/native shared backend bundles for iOS and Android hosts | Not rerun in this docs loop | Mutates `assets/backend.bundle.mjs` and `assets/backend.android.bundle.mjs`. |
| `npm run bundle-all-native` | Native worklet bundles into `backend/dist/` | Not rerun in this docs loop | Release preflight currently sees both native bundles present at about 2293 KiB. |
| `npm run barekit:fetch` | Fetch/refresh BareKit artifacts | Not rerun | Network/artifact mutation gate. Run only when intentionally refreshing native dependencies. |
| `npm run barekit:fetch:addons` | Fetch/refresh iOS addon frameworks | Not rerun | Release preflight currently sees BareKit plus 17 iOS addon frameworks. |
| `npm run ios:generated:release` | Generated Expo iOS release build script | Not rerun | Requires Xcode/iOS environment. Use when validating generated compatibility shell. |
| `cd ios-native && xcodegen generate && xcodebuild ...` | Native SwiftUI iOS build | Not rerun | Requires Xcode simulator/device setup and possibly signing depending configuration. See `README.md`, `ios-native/BUILD.md`, and `docs/MOBILE_RELEASE_EVIDENCE_2026-06-23.md`. |
| `android/gradlew -p android-native :app:compileDebugKotlin` | Android native Kotlin compile target from marker triage | Not rerun | Marker triage names this as preferred local proof after Android native screen/share changes. |
| `cd android-native && ./gradlew :app:assembleDebug` | Android native debug APK build | Not rerun | Requires JDK 17 and Android SDK. Prior release evidence records debug install/launch reaching green Connected. |

## Release Preflight Boundaries

Current `npm run release:preflight -- --soft` result:

- Pass: `package.json`, `app.json`, Android Gradle config, and iOS XcodeGen
  config are readable.
- Pass: package, Expo, Android, and iOS versions align on `0.1.0`.
- Pass: Android package IDs and iOS bundle IDs align on `com.pearbrowser.app`.
- Pass: Android SDK floor is release-grade: min `29`, target `35`, compile `35`.
- Pass: iOS deployment target is `16.0`.
- Pass: native worklet bundles exist for iOS and Android.
- Pass: iOS BareKit plus 17 addon frameworks are present.
- Pass: Android BareKit AAR is present, about 82 MiB.
- Pass: EAS project identity is present.
- Fail: Android production signing env is missing:
  `PEARBROWSER_ANDROID_KEYSTORE`, `PEARBROWSER_ANDROID_STORE_PASSWORD`, and
  `PEARBROWSER_ANDROID_KEY_ALIAS`.
- Fail: iOS production team is missing:
  `DEVELOPMENT_TEAM` is blank and `PEARBROWSER_IOS_DEVELOPMENT_TEAM` is unset.
- Fail: iOS TestFlight/App Store Connect validation marker is missing:
  `PEARBROWSER_TESTFLIGHT_VALIDATED=1` or
  `PEARBROWSER_APP_STORE_CONNECT_VALIDATED=1`.
- Fail: Android Play/Firebase validation marker is missing:
  `PEARBROWSER_PLAY_CONSOLE_VALIDATED=1` or
  `PEARBROWSER_FIREBASE_APP_DISTRIBUTION_VALIDATED=1`.

## Live / External Proof Gates

The following should not be marked pass from local tests alone:

- Real iOS production signing and TestFlight/App Store Connect validation.
- Real Android production/upload keystore signing and Play/Firebase validation.
- Physical device matrix beyond the currently documented simulator/emulator
  smoke.
- Live relay catalog population of `examples/echo-peer` or other app drives.
- Live relay gateway + direct P2P fallback timing and cache behavior.
- Real mobile HyperDHT/holepunching across NATs and networks.
- App Store user flows against real seeded relays.
- Production privacy/legal/store copy approval.
- Moderate Expo/React Native advisory resolution through a safe framework
  upgrade path.

## Suggested Next Edges

1. Release evidence cleanup: persist the `--json --soft` preflight report as a
   dated artifact, then keep signing/store failures explicit until credentials
   and store validation markers exist.
2. Docs drift cleanup: update `SUBMISSION.md` from the older `88/88` claim to
   the current `136/136` local baseline and link this matrix/current audit.
3. Native build proof refresh: run the Android Kotlin compile target from
   `docs/MARKER-TRIAGE-2026-06-23.md` in a known-good JDK 17 environment, then
   refresh native release evidence.
4. Security boundary follow-up: preserve the one-time SSE ticket coverage in
   `test/http-bridge-origin-sse.test.js` while tackling the next open boundary,
   such as trusted-origin allowlist UX or browser-level per-app origin isolation.
