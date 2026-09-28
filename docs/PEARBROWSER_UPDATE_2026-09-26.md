# PearBrowser mobile update candidate — status checked 2026-09-28

State: [draft source PR #6](https://github.com/bigdestiny2/PearBrowser/pull/6) is pushed to GitHub. Desktop is the first release priority. This mobile candidate has no signed distribution, store validation, physical-device qualification, or live activation.

## Implemented locally

- React Native browser tabs now persist in the shared user session. Up to six WebViews stay mounted, preserving live page state while switching tabs; evicted tabs reopen from their saved URL. Android's existing native tab model uses the same session fields. Restored `app://` routes and loopback navigation results are validated before loading.
- Home routes plain text to local P2P search. Trusted-peer search needs an explicit toggle and labels result provenance. Page indexing is opt-in, and the worklet stops history and search indexing during Private Mode.
- Private Mode clears live tabs and saved session URLs, including older tab records. React Native handles mode changes from another shell; native Android completes scrub and setting changes together even if Settings closes. Session and settings read errors block restore or writes instead of replacing shared state with defaults.
- Direct P2P dependencies were updated within their supported ranges: Autobase 7.28.2, Corestore 7.12.6, Hypercore 11.37.0, Hyperdrive 13.3.4, Hyperswarm 4.17.2, Bare Crypto 1.15.3, and framed-stream 1.0.1. The user's pre-existing `bare-http1` 4.5.8 change was retained. Native worklet bundles were rebuilt.
- The release preflight now checks the package, lockfile, installed dependency lock, required native optional packages, and byte-identical native worklet bundles.

## Autobee boundary

Upstream `autobee@2.12.1` is an exact development dependency used only by disposable Corestore compatibility tests for persistence and two-writer convergence. Browser user data and existing sync paths remain Autobase/Hyperbee. There has been no Autobee migration, Bare runtime proof, or live peer replication proof.

## Verification and gates

- Full local `npm test`: 610 passed, 0 failed. TypeScript is included in that command. The GitHub mobile preflight job passed its **soft** structural gate; that does not clear the hard release gate.
- iOS and Android worklet bundles rebuilt. The 2026-09-28 soft release preflight reports 18 structural passes, 0 warnings, and 4 production-authority failures; native bundle hashes match. The iOS Expo export succeeded (665 modules), and the high/critical dependency audit passed.
- A fresh Android native debug APK passed Kotlin compilation. The first emulator install exposed a stale AAR: its worklet failed with `AddonError: ADDON_NOT_FOUND` for `linked:librocksdb-native.3.18.1.so`. The fetch/packaging fix now includes all 18 current native addons for four Android ABIs; a rebuilt APK installed and reached green Connected Home. Android also opened HTTPS Example Domain and routed a plain-text Home query to local Search with indexing off. The tab switcher was moved below the system status bar; its `+` button created a second tab in the emulator. A stale navigation value was cleared for new blank tabs. In a stepwise emulator check, tab A opened Example Domain, tab B opened IANA, and returning to A restored its page content.
- A fresh unsigned React Native iOS Release simulator build passed after refreshing local BareKit addons and CocoaPods. It installed on an iPhone 17 simulator, reached green Connected Home, and opened local Search and Settings. A fresh unsigned native SwiftUI Debug simulator build passed after updating its XcodeGen addon references; it installed on an iPhone 17e simulator and reached green Connected Home. These are local simulator checks, not signed device or store builds.
- In the Android emulator, turning Private Mode on cleared the open tabs, and a cold restart did not restore them. Settings showed History off and Search indexing off afterward, but both settings were already off before the toggle; suppression of previously enabled options remains unverified.
- Physical Android/iOS device smoke, live form/scroll retention, Private Mode transitions beyond this Android emulator check, cross-shell sync, and live peer replication remain unverified.
- Production distribution remains blocked on Android signing, Apple development-team signing, iOS store validation, and Android Play/Firebase validation. The soft preflight records these as four separate failures.
- **Per-app origin isolation remains open.** All mobile P2P pages currently share one loopback origin. The separate four-case [origin-isolation gate](MOBILE_ORIGIN_ISOLATION_GATE.md) fails and is excluded from the normal test glob. The proposed proxy/token rewrite was rejected by automatic approval review because it changes a high-impact navigation boundary without explicit authorization for that exact change. Its contract requires device and cookie proof; ports alone do not isolate cookies.

This candidate has not been published or activated.
