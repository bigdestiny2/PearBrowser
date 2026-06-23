# PearBrowser Mobile Release Evidence - 2026-06-23

This is the current mobile/native release proof for the source/runtime baseline
`de85d420c942d433905324c3e098acc34458a23a`. The follow-up docs-only evidence
commit does not change runtime source.

## Automated Checks

- `npm test`: passed `136/136`.
- `git diff --check`: passed.
- `npm audit --audit-level=high`: exited `0`.
- `npm run release:preflight -- --soft`: `14 pass`, `0 warn`, `4 fail`.
- `npm run release:preflight -- --json --soft`: same counts, machine-readable
  report generated at `2026-06-23T15:51:08.065Z`.

The high-severity audit gate is green. A full audit still reports 15 moderate
Expo/React Native toolchain advisories through `js-yaml` and `uuid`; npm's
available fixes require breaking framework changes, so those remain tracked
follow-up rather than release-day force fixes.

## Preflight Passes

- Package, Expo, Android, and iOS release versions align on `0.1.0`.
- Android package IDs align on `com.pearbrowser.app`.
- iOS bundle IDs align on `com.pearbrowser.app`.
- Android SDK targets are release-grade: min `29`, target `35`, compile `35`.
- iOS deployment target is `16.0`.
- Native worklet bundles exist:
  - `backend/dist/backend.ios.bundle`, `2293 KiB`
  - `backend/dist/backend.android.bundle`, `2293 KiB`
- iOS BareKit and native addons are present: 17 addon frameworks.
- Android BareKit AAR is present: 82 MiB.
- EAS project identity is present:
  `bigdestiny22s-organization/f84eafc6-f7c2-4489-b81e-479410ab3340`.

## Remaining Production Blockers

- Android production signing environment is not configured:
  `PEARBROWSER_ANDROID_KEYSTORE`, `PEARBROWSER_ANDROID_STORE_PASSWORD`, and
  `PEARBROWSER_ANDROID_KEY_ALIAS` are missing.
- iOS production team is not configured:
  `DEVELOPMENT_TEAM` is blank and `PEARBROWSER_IOS_DEVELOPMENT_TEAM` is unset.
- iOS TestFlight/App Store Connect validation marker is missing:
  `PEARBROWSER_TESTFLIGHT_VALIDATED=1` or
  `PEARBROWSER_APP_STORE_CONNECT_VALIDATED=1`.
- Android Play/Firebase validation marker is missing:
  `PEARBROWSER_PLAY_CONSOLE_VALIDATED=1` or
  `PEARBROWSER_FIREBASE_APP_DISTRIBUTION_VALIDATED=1`.

## Release Read

The mobile source tree is structurally ready for release validation, but not
production-distribution-cleared. The remaining blockers require real platform
credentials and store/distribution validation evidence, not code changes.
