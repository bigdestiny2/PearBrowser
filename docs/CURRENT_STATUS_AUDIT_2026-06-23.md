# PearBrowser Current Status Audit

Generated: 2026-06-23
Loop candidate: `pearbrowser-status-audit`
Autonomy level: Level 1 status artifact
Source root: `~/pear-ecosystem/01-browser/PearBrowser`

## Executive Status

PearBrowser is a mature mobile P2P browser/runtime source tree at version
`0.1.0`. The current local source baseline is healthy: TypeScript, backend
syntax checks, and the full Node test suite pass. The main remaining standard
gap is not first-party browser/runtime correctness; it is production mobile
release proof: real signing credentials, TestFlight/App Store Connect
validation, Play/Firebase validation, and broader physical device coverage.

The most important current split:

- Local source/runtime validation: green.
- High/critical dependency gate: green.
- Release structure preflight: mostly green, blocked by production credentials
  and store/distribution validation markers.
- Native production launch: still requires real signing, store validation, and
  broader device matrix evidence.

## Validation Run

Run from `~/pear-ecosystem/01-browser/PearBrowser`:

```sh
npm test
npm audit --audit-level=high
npm run release:preflight -- --soft
```

Results:

- `npm test` passed: 136/136 tests, with TypeScript, backend syntax checks,
  catalog safety, bridge tokens, swarm.v1, identity, native parity, release
  preflight fixture tests, and streamx/XHR behavior covered.
- `npm audit --audit-level=high` exited successfully. It still reports 15
  moderate inherited Expo/React Native toolchain advisories through `js-yaml`
  and `uuid`; npm's available fixes require breaking framework changes.
- `npm run release:preflight -- --soft` reported 14 pass, 0 warn, 4 fail.

Soft preflight passes:

- `package.json`, `app.json`, Android Gradle config, and iOS XcodeGen config
  are readable.
- Package, Expo, Android, and iOS versions align on `0.1.0`.
- Android package IDs and iOS bundle IDs align on `com.pearbrowser.app`.
- Android SDK floor is release-grade: min 29, target 35, compile 35.
- iOS deployment target is 16.0.
- Native worklet bundles exist for iOS and Android.
- iOS BareKit plus 17 addon frameworks are present.
- Android BareKit AAR is present.
- EAS project identity is present.

Soft preflight blockers:

- Android production signing env is missing:
  `PEARBROWSER_ANDROID_KEYSTORE`,
  `PEARBROWSER_ANDROID_STORE_PASSWORD`, and
  `PEARBROWSER_ANDROID_KEY_ALIAS`.
- iOS production team is not configured:
  `DEVELOPMENT_TEAM` is blank and
  `PEARBROWSER_IOS_DEVELOPMENT_TEAM` is unset.
- iOS TestFlight/App Store Connect validation marker is missing:
  `PEARBROWSER_TESTFLIGHT_VALIDATED=1` or
  `PEARBROWSER_APP_STORE_CONNECT_VALIDATED=1`.
- Android Play/Firebase validation marker is missing:
  `PEARBROWSER_PLAY_CONSOLE_VALIDATED=1` or
  `PEARBROWSER_FIREBASE_APP_DISTRIBUTION_VALIDATED=1`.

## Strong Evidence Of Completed Work

- `README.md` and `docs/ARCHITECTURE_AND_CAPABILITIES.md` describe the current
  mobile architecture: native shells plus a Bare Kit worklet, Hyperdrive
  browsing, relay catalogues, signed catalog bees, direct `swarm.v1`, identity,
  sync, contacts, trusted origins, and token-gated bridge access.
- `npm test` proves the current source-level behavior across 136 tests.
- `docs/MARKER-TRIAGE-2026-06-23.md` records that first-party task markers were
  reduced to native product/release milestones rather than loose source debt.
- `scripts/release-preflight.js` now gives a concrete release gate for native
  artifact presence, platform identifiers, SDK floors, signing, and store
  validation.
- `docs/ARCHITECTURE_AND_CAPABILITIES.md` records recent native smoke progress:
  generated Expo iOS builds, tracked SwiftUI shell launch to green "Connected",
  Android native debug install/launch to green "Connected", and Android native
  release APK/AAB build/signing proof with a disposable test key.

## Older Docs To Treat Carefully

- `SECURITY_AUDIT.md` and `SECURITY_FIXES.md` are April 2026 security history.
  They are useful for tracing known vulnerability classes, but current security
  posture should be judged from current source, current tests, README, and
  `docs/ARCHITECTURE_AND_CAPABILITIES.md`.
- `docs/AUDIT_AND_SHIP_PLAN_2026-04-15.md` is a completed and partially stale
  ship-plan snapshot. It remains useful for provenance of the token/origin
  trust-boundary work.
- `docs/HOLEPUNCH_ALIGNMENT_PLAN.md` still contains long-range migration phases
  that are now partly superseded by current native shell and relay-config work.
  Use `docs/MARKER-TRIAGE-2026-06-23.md` for current marker status.
- `SUBMISSION.md` is role-submission framing and still claims an older 88-test
  baseline. The current local baseline is 136 passing tests.

## Current Open Release Gaps

- Configure real Android production signing and verify release APK/AAB with the
  production/upload key.
- Configure real iOS Apple development team signing.
- Upload/validate iOS archive in TestFlight or App Store Connect and record the
  validation marker.
- Upload/validate Android AAB/APK in Play Console or Firebase App Distribution
  and record the validation marker.
- Capture broader real-device evidence beyond the current simulator/emulator
  smoke.
- Keep moderate Expo/React Native toolchain advisories tracked until a safe
  framework upgrade path exists.

## Recommended Next Level 1/2 Step

Run a PearBrowser release-evidence cleanup pass:

- Capture `npm run release:preflight -- --json` into a dated proof artifact.
- Add a compact release evidence note that distinguishes structural pass items
  from credential/store blockers.
- If credentials are available, run the production signing/store validation
  checks and record the exact environment markers used.
- If credentials are not available, keep those blockers explicit and avoid
  marking the release path ready.

## Source Evidence

- `~/pear-ecosystem/01-browser/PearBrowser/package.json`
- `~/pear-ecosystem/01-browser/PearBrowser/README.md`
- `~/pear-ecosystem/01-browser/PearBrowser/docs/ARCHITECTURE_AND_CAPABILITIES.md`
- `~/pear-ecosystem/01-browser/PearBrowser/docs/MARKER-TRIAGE-2026-06-23.md`
- `~/pear-ecosystem/01-browser/PearBrowser/scripts/release-preflight.js`
- `~/pear-ecosystem/01-browser/PearBrowser/SECURITY_AUDIT.md`
- `~/pear-ecosystem/01-browser/PearBrowser/SECURITY_FIXES.md`
- `~/pear-ecosystem/01-browser/PearBrowser/SUBMISSION.md`
- `~/pear-ecosystem/01-browser/PearBrowser/docs/AUDIT_AND_SHIP_PLAN_2026-04-15.md`
- `~/pear-ecosystem/01-browser/PearBrowser/docs/HOLEPUNCH_ALIGNMENT_PLAN.md`
