# PearBrowser Release Evidence — 2026-07-22

This is the release-candidate evidence for the mobile browser parity and runtime
hardening change set. The candidate is source-ready for merge. It is not a
claim that Apple or Android production distribution has occurred: credentials,
signed artifacts, and store acceptance remain explicit external gates.

## Candidate Scope

The change set brings the React Native, native SwiftUI, and native Jetpack
Compose shells into browser-action parity for share, copy link, bookmarks,
reload, find in page, and desktop/mobile-site requests. It also includes the
native screen, tab/session, settings, history, site-builder, QR, catalogue,
search/naming, content-shield, identity, plugin, swarm, and Ask Browser/QVAC
hardening that landed in the same candidate.

Release cleanup aligned Android signing across both Gradle shells, CI,
preflight, and documentation; added a regression check for that contract;
removed first-party Android API deprecations; refreshed generated backend
bundles; and made the generated iOS Release wrapper selectable by SDK and
destination while preserving its simulator defaults.

## Automated Gates

| Gate | Result |
|---|---|
| `npm test` | Pass: 566/566; TypeScript, backend syntax, unit, integration, security-boundary, native source-contract, and page-action parity coverage |
| `npm audit --audit-level=high` | Pass: zero high or critical advisories |
| Full `npm audit` | Nine moderate advisories in Expo's transitive `uuid`/`xcode` build-tool path |
| `npm run bundle-all` | Pass; tracked iOS and Android compatibility bundles regenerated |
| `npm run bundle-all-native` | Pass; native worklet bundles regenerated |
| `git diff --check` | Pass |
| Soft JSON release preflight | 15 pass, 0 warn, 4 expected production blockers |
| Preflight report verifier | Pass with `--allow-production-blockers`; no unexpected blocker or warning |

The npm force-fix is not applied because it proposes Expo 46, a breaking
framework downgrade. The release gate remains high/critical, while the moderate
tooling path stays visible for a supported Expo upgrade.

## Native Build Proof

### Android native shell

With Android Studio's JDK 17 and Gradle 8.13:

```sh
gradle --no-daemon -Dorg.gradle.workers.max=1 \
  :app:compileDebugKotlin :app:assembleRelease :app:bundleRelease
```

Result: pass, including release Kotlin/Java compilation, lint-vital, R8,
resource shrinking, APK packaging, and AAB packaging. After the cleanup pass,
the Kotlin compiler emits no first-party deprecation warnings.

Local unsigned outputs, intentionally built without production secrets:

- `app-release-unsigned.apk`: 150,318,276 bytes
- `app-release.aab`: 53,529,126 bytes; `jarsigner` confirms it is unsigned

These prove compilation and packaging only. They are not distribution
artifacts.

### Native SwiftUI shell

After `xcodegen generate`, both commands pass with signing disabled:

```sh
xcodebuild -project PearBrowser.xcodeproj -scheme PearBrowser \
  -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build

xcodebuild -project PearBrowser.xcodeproj -scheme PearBrowser \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

The Release app is about 52 MiB and links BareKit plus 17 addon frameworks.

### Generated Expo iOS compatibility shell

After a clean CocoaPods reconciliation, the 99-target Release graph passes:

```sh
IOS_SDK=iphoneos IOS_DESTINATION='generic/platform=iOS' \
  npm run ios:generated:release
```

The unsigned Release app is about 88 MiB and completes Xcode's shallow
store-style validation. The wrapper still defaults to the simulator; the SDK
and destination overrides provide a device-compilation fallback for CI or hosts
whose simulator service is unavailable.

The local simulator target could not be rerun because this Mac's installed
CoreSimulator service is `1051.54.0` while Xcode expects `1051.55.0`. That host
version mismatch does not affect either successful generic-device build.

## Preflight Contract

All Android release paths now use exactly:

- `PEARBROWSER_RELEASE_STORE_FILE`
- `PEARBROWSER_RELEASE_STORE_PASSWORD`
- `PEARBROWSER_RELEASE_KEY_ALIAS`
- `PEARBROWSER_RELEASE_KEY_PASSWORD`

GitHub Actions accepts the keystore as
`PEARBROWSER_RELEASE_KEYSTORE_BASE64`, writes it under the runner's temporary
directory, and exports the decoded absolute path through
`PEARBROWSER_RELEASE_STORE_FILE`. Tests fail if native Gradle, the workflow, or
the signing guide returns to the retired `PEARBROWSER_ANDROID_*` prefix.

## Honest Capability Boundaries

- Mobile does not inject a `Pear.worker.pipe()` host for `pear://` or `file://`
  worker apps. The tab runtime fails closed with an unavailable error; static
  Hyperdrive/WebView apps remain supported.
- Ask Browser/QVAC fails closed until a supported on-device inference runtime
  is injected. Tests cover both unavailable and injected-runtime behavior.
- Simulator/emulator smoke from the earlier baseline is retained, but this pass
  does not claim a new physical-device matrix.

## Remaining Production-Authority Gates

The four soft-preflight blockers are deliberate and require external authority:

1. Configure the real Android release/upload keystore through all four
   `PEARBROWSER_RELEASE_*` variables.
2. Configure `PEARBROWSER_IOS_DEVELOPMENT_TEAM` or `DEVELOPMENT_TEAM`.
3. Upload and validate the iOS archive, then record
   `PEARBROWSER_TESTFLIGHT_VALIDATED=1` or
   `PEARBROWSER_APP_STORE_CONNECT_VALIDATED=1`.
4. Upload and validate the Android artifact, then record
   `PEARBROWSER_PLAY_CONSOLE_VALIDATED=1` or
   `PEARBROWSER_FIREBASE_APP_DISTRIBUTION_VALIDATED=1`.

Strict preflight must remain red until those facts are real. CI's soft report
allows only these four IDs; any structural blocker or warning fails the gate.

## Reproduction

```sh
npm ci
npm test
npm audit --audit-level=high
npm run bundle-all
npm run bundle-all-native
npm run --silent release:preflight -- --json --soft > mobile-release-preflight.json
npm run check:release-preflight-report -- \
  mobile-release-preflight.json --allow-production-blockers
```

Run the native commands above on the matching Android/Xcode toolchains. Add
production credentials and validation markers only in the protected release
environment; never commit them.
