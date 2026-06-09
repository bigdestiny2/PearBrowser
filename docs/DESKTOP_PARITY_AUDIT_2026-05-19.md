# PearBrowser Desktop Parity Audit - 2026-05-19

Scope: compare `bigdestiny2/pearbrowser` (mobile/iOS/Android/RN) with `bigdestiny2/pearbrowser-desktop`, then close the fastest high-impact runtime gaps.

## Current Desktop Baseline

Desktop is at the most complete app-runtime shape:

- Multi-tab browser shell with `hyper://`, hex, and z-base-32 navigation.
- Hybrid Hyperdrive loading through relay + direct Hyperswarm fallback.
- Site builder with publish/unpublish and HiveRelay pinning.
- Identity, profile, `window.pear.login()`, connected-app grants, and trusted app surfaces.
- `window.pear.swarm.v1` for direct page-scoped Hyperswarm channels.
- Consent + persistent grants for arbitrary swarm topics.

## Mobile/iOS State Before This Pass

Mobile already had more foundation than the README suggested:

- Bare worklet backend with Hyperswarm, Corestore, Hyperdrive, Hyperbee, Autobase.
- React Native, native iOS, and native Android shells.
- Identity backup/restore, profile editing, login grants, contacts, trusted origins.
- Direct localhost bridge for sync, identity, login, contacts, and drive reads.
- iOS native consent sheet for `window.pear.login()`.

## Gap Matrix

| Area | Desktop | Mobile/iOS before | Status after this pass |
| --- | --- | --- | --- |
| `hyper://` routing in iOS WebView | Routes through worklet proxy | iOS passed `hyper://` directly to WKWebView | Fixed: iOS calls `CMD_NAVIGATE`, loads local proxy URL, carries token |
| z-base-32 keys | Supported | Backend did not normalize | Fixed in backend navigation |
| `window.pear.swarm.v1` | Available in pages | Missing | Fixed in backend, proxy injection, RN/native bridge templates |
| Arbitrary swarm consent | Desktop UI event + grant store | Missing | Fixed for iOS native, Android native, and RN shells |
| Swarm grant revocation | Connected Apps section | Missing | Added to iOS Connected Apps |
| HTTP bridge SSE token | `?token=` fallback | Missing | Fixed for `/api/swarm/events` |
| HTML cache bridge injection | Desktop has same risk | Cache hits could skip bridge/base injection | Fixed on mobile by injecting per response |
| HTTPS origin bridge calls | Intended via origin tokens | HttpBridge rejected non-loopback Origin | Fixed to allow canonical http(s) origins and enforce token-origin match |
| Android native shell parity | Partial | No consent UI for login/swarm requests | Added cross-process login/swarm consent broadcasts + Compose dialogs; native browsing is still a lighter shell than iOS |
| Desktop README parity | Complete story | Mobile README stale | Updated with native iOS/Android, bridge, consent, and swarm.v1 story |

## Security Notes

- `window.pear.swarm.v1` is token-gated. Pages do not receive raw Hyperswarm sockets or private keys.
- Drive-derived subtopics are automatic and scoped to the app's drive key.
- Raw arbitrary topics require user consent, then persist as `(driveKey, topicHex)` grants.
- Grants are revocable from iOS Settings -> Connected Apps.
- Android runs the worklet in a separate process, so consent requests cross the process boundary through package-scoped broadcasts and decisions return to the service over explicit resolve broadcasts.
- EventSource cannot send `X-Pear-Token`, so `/api/swarm/events` accepts the same short-lived token via `?token=`.
- Origin-scoped HTTPS tokens are checked against the request `Origin` before the bridge accepts calls.

## Fastest Route From Here

1. Verify iOS native build on device/simulator after bundling `backend.ios.bundle`.
2. Verify Android native build after adding `bare-kit.jar` and `backend.android.bundle`.
3. Keep `examples/echo-peer` and `test/swarm-v1-runtime-smoke.test.js` green as the end-to-end fixture for `window.pear.swarm.v1.join(null, { subtopic })`.
4. Decide whether RN shell should keep receiving full UI investment or become a legacy compatibility shell while native iOS/Android become primary.
