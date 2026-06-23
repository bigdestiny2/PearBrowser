# PearBrowser Mobile Architecture and Capabilities

Last updated: 2026-06-23

PearBrowser Mobile is the iOS and Android host for PearBrowser apps and
`hyper://` sites. It pairs native mobile shells with a Bare Kit worklet so a
phone can browse Hyperdrives, load relay-backed catalogues, publish simple
sites, and expose a token-gated `window.pear` bridge to WebView apps.

## Product Surfaces

- **Home:** saved apps/sites, connection status, shortcuts, QR scanner, and
  P2P engine status.
- **Explore:** relay URL, `hyper://`, `hyperbee://`, signed `catalogBeeKey`, and
  safe link-only catalogue rows that let users open the current app release
  without manual download/update steps.
- **Browse:** WebView-based `hyper://` browsing through the local proxy, with
  relay fast-path and P2P fallback.
- **My Sites:** mobile site creation, templates, block editor, publishing,
  sharing, and HiveRelay seeding.
- **More/Settings:** identity backup/restore, profile, bookmarks, history,
  connected apps, trusted origins, storage, and diagnostics.
- **Native shells:** SwiftUI and Jetpack Compose screens mirror the React Native
  compatibility shell and are covered by source-contract tests.

## Runtime Layers

```text
React Native shell / SwiftUI shell / Jetpack Compose shell
  screens, navigation, consent modals, QR/share/native storage
        |
        | length-prefixed JSON RPC
        v
Bare Kit worklet backend
  HyperProxy, RelayClient, CatalogManager, AppManager, SiteManager
  PearBridge, HttpBridge, SwarmBridge, grants, trusted origins
        |
        +-- Corestore / Hyperdrive / Hyperbee / Autobase
        +-- Hyperswarm / HyperDHT / UDX
        +-- HiveRelay HTTP gateway, /catalog.json, /seed, catalogBeeKey
        |
        v
WebView apps
  injected window.pear and POS compatibility wrapper
```

The phone is a real peer when the Bare worklet is available. If the worklet
cannot start, the shell can still present HTTP-only flows where possible.

## Catalogue Pipeline

Explore accepts:

- relay HTTP catalogues at `/catalog.json`;
- signed Hyperbee catalogues advertised through `catalogBeeKey`;
- direct `hyperbee://` catalogue keys;
- legacy Hyperdrive catalogue keys;
- safe link-only rows using `hyper://`, `pear://`, or `file://`.

Catalogue envelopes are normalized from `apps[]`, `items[]`, or `entries[]`.
Entries may provide `driveKey`, `appKey`, `key`, or a safe `hyper://` link.
Rows with no valid drive key and no safe link are dropped before rendering.
Stable catalog rows/links give users a repeatable launch point for the current
available app, instead of asking them to revisit a publisher site, download a
bundle, or apply updates manually.

Mobile does not currently run desktop `hypersite` workers or window-class Pear
GUI apps inside the WebView. A static Hyperdrive with `/index.html` remains the
universal mobile compatibility floor. Safe link-only rows are preserved so the
shell can navigate or hand off where a platform handler exists.

## Bridge Capabilities

Apps served through PearBrowser can feature-detect:

- `window.pear.login()` for app-scoped sign-in with native consent;
- `window.pear.identity.getPublicKey()` and `identity.sign()`;
- `window.pear.sync.create/join/append/get/list/range/count/status`;
- `window.pear.swarm.v1.join()` for drive-scoped or consent-gated direct
  Hyperswarm channels;
- `window.pear.contacts.*` after a `contacts:read` grant;
- `window.pear.navigate()` and `window.pear.share()` for host navigation/share;
- `window.posAPI` as a mobile POS compatibility wrapper around `pear.sync`.

The bridge is token-gated. Trusted HTTPS origins must be explicitly allowed
before they receive bridge credentials; ordinary external pages receive no
privileged bridge.

## Data and Trust Model

- Identity is backed by a backup/restore phrase and exposes per-app keys rather
  than a global cross-app identifier.
- Login, contacts, and arbitrary swarm topics are mediated by native consent
  modals.
- Bookmarks, history, session state, grants, trusted origins, profile data, and
  app state are kept local-first.
- Relay catalogues improve availability and first load speed, but app content
  remains addressed by Hyperdrive keys and can fall back to direct P2P.

## Native Parity

The React Native shell remains the compatibility host. The SwiftUI and Jetpack
Compose shells are tracked with source-contract tests that check protocol
constants, bridge shape, catalogue safe-link behavior, and screen parity. The
current 2026-06-23 release snapshot has the mobile test suite passing at 124
tests, and `npm audit --audit-level=high` passing after the safe lockfile audit
refresh.

Release smoke note, 2026-06-23: native simulator/device smoke is not cleared
yet. In the local generated `ios/` tree, CocoaPods metadata had drifted to stale
nested Expo package paths while the current Expo autolinker resolves hoisted
packages. Correcting the generated metadata moved the simulator build through
the missing Expo privacy/source/header failures, but the app target then failed
when the generated CocoaPods framework embed script was killed with signal 9.
Android Gradle inspection also requires a local Java Runtime/JDK.

## Current Limits

- Mobile has no desktop `Pear.worker.pipe()` hypersite host.
- Mobile has no standalone Pear GUI window launcher.
- A static Hyperdrive with root `/index.html` is required for a guaranteed
  in-WebView app experience.
- Native mobile distribution still needs a clean iOS simulator build/launch and
  Android Gradle smoke with a local Java Runtime/JDK.
- Public Nostr, desktop federated search, and desktop petname/name registry are
  desktop-side capabilities today; mobile documentation should link to the
  desktop architecture when discussing those browser-wide systems.
