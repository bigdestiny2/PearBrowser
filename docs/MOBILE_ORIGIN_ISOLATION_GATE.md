# Mobile drive-origin isolation gate

The current mobile worklet serves all `/hyper/<driveKey>/` and `/app/<driveKey>/` pages from one `127.0.0.1` port. That gives distinct drives the same web origin and shared localStorage, IndexedDB, DOM reach and same-origin requests. Drive API tokens are scoped to a drive key, but their current `origin` is null. This is an open security boundary for untrusted P2P content.

## Candidate contract

`test/pending/mobile-origin-isolation.gate.cjs` is a deliberately red integration gate. It is outside the normal `test/*.test.js` suite until the backend and all mobile shells adopt the contract. It currently fails because `HyperProxy.localUrlForDrive()` does not exist. The gate requires:

- A separate ephemeral `127.0.0.1:<port>` listener for each active drive. `/hyper/` and `/app/` for the same key share that origin; a listener rejects every other key before cache, relay or P2P fetch. The existing main port rejects all drive routes, so it cannot bypass the boundary.
- `CMD_NAVIGATE` and `CMD_LAUNCH_APP` return a drive-specific URL and port. The relay fast path still fetches content on the drive listener. Clearnet `/clearnet/` and its root-relative fallback remain on the main listener.
- Every drive token binds to the active listener's origin. HTTP bridge requests and one-time SSE tickets verify the token's drive, `Host` and any `Origin` before acting. A token for a released listener is revoked.
- A fixed listener cap, explicit release command when the final live WebView for a drive closes, and a visible capacity error. Do not evict a listener that a native WebView may still use. Reopened tabs re-resolve via `CMD_NAVIGATE`.
- RN, iOS and Android WebViews use the returned drive port for bridge injection, local navigation checks and tab restoration. The global worklet port remains for status and clearnet routing.

## Required proof before a source-fixed claim

1. Gate tests fail on the current proxy, then pass with distinct origins, same-drive `/hyper/` and `/app/` success, cross-drive and main-port route denial, same-origin bridge success, token replay denial on another listener, and bounded listener release.
2. Browser or device tests show separate localStorage and IndexedDB, cross-origin fetch denial, and same-drive bridge and SSE behavior. Test both Android WebView and iOS WKWebView with strict CSP and relative assets. Exercise relay-first and P2P fetch paths.
3. Verify cookie isolation separately. **Ports do not partition cookies:** cookies are scoped to host/domain and path. Two `127.0.0.1` ports can still share a `Path=/` cookie through `document.cookie`. Per-drive ports alone cannot satisfy a cross-drive cookie test. A distinct host or browser data-store design needs mobile device proof before claiming full storage isolation.
4. Native tab lifecycle and app launch need qualification, including listener exhaustion and worklet restart. No production backend change has been applied under this gate.

The proposed backend proxy rewrite was rejected by automatic approval review on 2026-09-26 because it would change a high-impact navigation/token boundary without explicit authorization for that exact change. The rejected action was not retried or applied indirectly.
