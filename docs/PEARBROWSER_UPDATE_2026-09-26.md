# PearBrowser mobile update candidate — 2026-09-26

State: local candidate. Desktop is the first release priority; this mobile checkout is neither deployed nor device or store qualified.

## Implemented locally

- React Native browser tabs now persist in the shared user session. Up to six WebViews stay mounted, preserving live page state while switching tabs; evicted tabs reopen from their saved URL. Android's existing native tab model uses the same session fields. Restored `app://` routes and loopback navigation results are validated before loading.
- Home routes plain text to local P2P search. Trusted-peer search needs an explicit toggle and labels result provenance. Page indexing is opt-in, and the worklet stops history and search indexing during Private Mode.
- Private Mode clears live tabs and saved session URLs, including older tab records. React Native handles mode changes from another shell; native Android completes scrub and setting changes together even if Settings closes. Session and settings read errors block restore or writes instead of replacing shared state with defaults.
- Direct P2P dependencies were updated within their supported ranges: Autobase 7.28.2, Corestore 7.12.6, Hypercore 11.37.0, Hyperdrive 13.3.4, Hyperswarm 4.17.2, Bare Crypto 1.15.3, and framed-stream 1.0.1. The user's pre-existing `bare-http1` 4.5.8 change was retained. Native worklet bundles were rebuilt.
- The release preflight now checks the package, lockfile, installed dependency lock, required native optional packages, and byte-identical native worklet bundles.

## Autobee boundary

Upstream `autobee@2.12.1` is an exact development dependency used only by disposable Corestore compatibility tests for persistence and two-writer convergence. Browser user data and existing sync paths remain Autobase/Hyperbee. There has been no Autobee migration, Bare runtime proof, or live peer replication proof.

## Verification and gates

- Full local `npm test`: 608 passed, 0 failed. TypeScript is included in that command.
- iOS and Android worklet bundles rebuilt. Soft release preflight: 18 structural passes, 0 warnings, 4 production-authority failures; native bundle hashes match. The iOS Expo export succeeded (665 modules). The high/critical dependency audit passed.
- Native Android Kotlin compile and physical Android/iOS browser smoke remain unverified on this host. Live form/scroll retention, private-mode transitions, and cross-shell sync need device checks.
- Production distribution remains blocked on Android signing, Apple development-team signing, and iOS/Android store validation. The soft preflight records the exact current checks.
- **Per-app origin isolation remains open.** All mobile P2P pages currently share a loopback origin. The proposed proxy/token rewrite was rejected by automatic approval review because it changes a high-impact navigation boundary without explicit authorization for that change. The unexecuted contract and device/cookie requirements are in [MOBILE_ORIGIN_ISOLATION_GATE.md](MOBILE_ORIGIN_ISOLATION_GATE.md). Ports alone do not isolate cookies.

This candidate has not been published or activated.
