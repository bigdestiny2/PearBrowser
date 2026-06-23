# PearBrowser Security Boundary Alignment

Generated: 2026-06-23
Loop candidate: `pearbrowser-security-crosscheck`
Autonomy level: Level 1 security/threat documentation artifact
Source root: `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser`

## Executive Status

PearBrowser's April security documents are useful provenance, but they are not
the current security source of truth. The current source tree has stronger and
more explicit boundaries than those historical files show: strict localhost
origin parsing, in-memory bridge tokens, origin-scoped HTTPS session tokens,
drive-scoped sync namespaces, strict CSP on proxied HTML, signed catalog bee
verification, recursive prototype-pollution scrubbing, trusted-origin injection
controls, and consent/rate-limited `swarm.v1` channels.

The biggest remaining architectural caveat is also now explicit in source:
proxied `hyper://` and installed app content share one loopback origin,
`http://127.0.0.1:PORT`. CSP and token scoping reduce the blast radius inside
that shared origin, but they do not provide browser-level per-app origin
isolation. The canonical fix remains a custom scheme handler or per-drive/app
origin.

## Historical Docs To Treat As Provenance

- `SECURITY_AUDIT.md` records the April 2026 vulnerability classes: path
  traversal, unprotected localhost bridge access, hardcoded keys, HTML escaping,
  prototype pollution, permissive CORS, information disclosure, and resource
  exhaustion.
- `SECURITY_FIXES.md` records the patch intent for those findings, but some
  snippets are historical and should not be copied as current code.
- `SUBMISSION.md` is accurate high-level framing for Bare worklet, bridge,
  `swarm.v1`, and hybrid transport, but its test-count claim is stale. The
  current local baseline is the 136-test suite captured in
  `docs/CURRENT_STATUS_AUDIT_2026-06-23.md`.
- `docs/AUDIT_AND_SHIP_PLAN_2026-04-15.md` and
  `docs/HOLEPUNCH_ALIGNMENT_PLAN.md` are useful for provenance of the
  token/origin and Holepunch-alignment work, but current posture should be
  checked against current source and focused tests.

## Current Boundary Map

### Localhost proxy and CORS

Current source: `backend/hyper-proxy.js`.

- `isLoopbackOrigin(origin)` parses the Origin as a URL and only accepts
  `http://127.0.0.1` or `http://localhost`.
- `normaliseOrigin(origin)` canonicalizes `http(s)://host[:port]` origins and
  strips path, query, fragment, and default ports.
- Non-loopback `http(s)` origins are only reflected in
  `Access-Control-Allow-Origin` when the request presents a valid origin-scoped
  token issued for that exact origin.
- Arbitrary unauthenticated HTTPS origins are not echoed; they fall back to the
  loopback default and the browser blocks cross-origin reads.
- API tokens are random 32-byte hex strings, held in memory, and expired after
  10 minutes.

### HTML, paths, directory listings, and CSP

Current source: `backend/hyper-proxy.js`.

- Drive keys must be exactly 64 hex characters before content can be served.
- Proxied file paths reject `..` and NUL bytes.
- Directory listings are capped at 1000 entries and 5 seconds.
- Directory listing names and generated error pages use HTML escaping for
  attacker-controlled file/key/error details.
- Proxied HTML responses receive a strict CSP:
  `default-src 'self'; script-src 'self'; connect-src 'self' loopback; object-src 'none'; base-uri 'self'`.
- HTML responses inject a `<base>` tag, the page API token meta tag, and the
  `window.pear.swarm.v1` shim.

### Bridge API tokens and app scope

Current source: `backend/http-bridge.js`, `backend/pear-bridge.js`.

- Every `/api/*` privileged endpoint requires an `X-Pear-Token`, except
  EventSource streams may pass the same token through `?token=` because
  EventSource cannot set custom headers.
- Origin-scoped tokens are rejected unless the request's `Origin` header exactly
  matches the origin that minted the token.
- Sync app IDs are restricted to 1-64 characters of alphanumeric, hyphen, and
  underscore, with reserved names rejected.
- Sync namespaces are scoped by `driveKeyHex:appId`, so two apps using the same
  app ID under different drives do not share a backend namespace.
- Invite keys must be 64 hex characters.
- POST bodies are capped at 1 MB and sync operations are capped at 100 KB.
- List/range calls clamp page sizes to 1000 items and count scans cap at
  100,000 entries.
- JSON body parsing deletes top-level `__proto__` and `constructor` keys before
  the parsed object reaches bridge handlers.

### Identity, login, contacts, and HTTPS app sessions

Current source: `backend/http-bridge.js`, `backend/index.js`,
`backend/trusted-origins.js`.

- `/api/identity` returns a per-app sub-key, not the raw root or swarm keypair.
- `/api/identity/sign` signs with the per-app sub-key inside the worklet.
- `/api/login` gates visible profile fields behind a login ceremony.
- Contacts endpoints require a valid token and an active grant with the
  `contacts:read` scope.
- HTTPS apps receive origin-scoped session tokens from `CMD_PEAR_SESSION`.
  The token's drive key is deterministically derived from the canonical origin,
  giving stable per-user-per-site identity without sharing the root key.
- Trusted origins default to mode `all`, preserving bridge injection for every
  well-formed origin. Privacy mode `allowlist` restricts injection to explicit
  trusted origins while loopback/hyper surfaces remain always-on.

### Catalog trust and prototype-pollution handling

Current source: `backend/catalog-manager.js`, `backend/index.js`.

- Signed catalog bees fail closed when sodium is unavailable, metadata is
  missing, signatures are malformed, or signature verification fails.
- Catalog signatures are checked against a canonical JSON digest anchored to the
  bee key/trust anchor, with manifest-core signer resolution where applicable.
- Catalog JSON parsing recursively removes `__proto__`, `constructor`, and
  `prototype` keys before normalization.
- Catalog apps normalize drive keys and links; malformed entries are dropped
  rather than accepted into the directory.
- The backend's persisted state JSON parse also strips top-level prototype
  pollution keys.

### `swarm.v1` direct P2P access

Current source: `backend/swarm-bridge.js`, `backend/http-bridge.js`,
`backend/pear-bridge.js`, `docs/SWARM-V1.md`.

- Pages never receive raw Hyperswarm sockets or private keys. They receive a
  page-scoped channel descriptor and communicate through token-gated
  `/api/swarm/*` endpoints.
- Tier A drive-derived topics are convenience scoping only; drive keys are
  public, so Tier A is not a privacy boundary.
- Arbitrary topics require user consent and can be persisted as grants.
- Joins and channels are rate-limited: 8 simultaneous channels per app, 10 joins
  per minute, 1 pending consent, 64 peers per channel, and 1 MB/s outbound per
  peer.
- Denied consent and join failures do not permanently consume channel slots or
  join-budget tokens.
- Multiple logical channels are multiplexed over Protomux by protocol and topic
  buffer, avoiding cross-delivery between channels sharing a connection.
- SSE stream output has bounded buffering and closes the stream when the page is
  too far behind.

## Open Security Caveats

1. Browser-level per-app origin isolation is not solved. All proxied apps still
   share one loopback origin, cookies/storage, and same-origin fetch reach.
2. EventSource query-token fallback is an accepted leak-risk tradeoff. The next
   hardening step is a one-time SSE ticket minted through a header-authenticated
   request and consumed by the stream.
3. Trusted origins default to `all`. Users who want injection minimization need
   allowlist mode, and release notes/settings UX should make that choice clear.
4. Tier A `swarm.v1` topics are public-deriveable from public drive keys. Apps
   that need peer authentication must run their own handshake on top.
5. Current production-release proof is still blocked by signing and store
   validation evidence, as captured in
   `docs/CURRENT_STATUS_AUDIT_2026-06-23.md`.
6. `npm audit --audit-level=high` is green, but moderate inherited
   Expo/React Native advisories remain and require framework-level upgrade
   planning rather than a safe local force-fix.

## Focused Test Coverage To Preserve

- `test/origin-token.test.js` for per-origin token derivation and validation.
- `test/http-bridge-origin-sse.test.js` for origin-scoped SSE token matching.
- `test/trusted-origins.test.js` for trusted-origin mode and native screen
  parity.
- `test/catalog-normalizer.test.js` and `test/catalog-bee.test.js` for catalog
  normalization, prototype-key scrubbing, and signature verification.
- `test/swarm-v1-parity.test.js` and `test/swarm-v1-runtime-smoke.test.js` for
  swarm bridge surfaces, parity, event streams, send/leave, and multiplexing.
- `test/mobile-screen-harness.test.js` for native UI consent and trusted-origin
  flows.

## Recommended Next Level 1/2 Step

Run the release-evidence cleanup pass from the current status audit:

- Capture `npm run release:preflight -- --json` into a dated proof artifact.
- Keep signing/store blockers explicit unless real credentials are present.
- Then harden the EventSource token path by replacing query-token fallback with
  a one-time SSE ticket flow and covering it with `http-bridge-origin-sse`
  tests.

## Source Evidence

- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/backend/hyper-proxy.js`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/backend/http-bridge.js`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/backend/pear-bridge.js`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/backend/swarm-bridge.js`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/backend/trusted-origins.js`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/backend/catalog-manager.js`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/backend/index.js`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/docs/CURRENT_STATUS_AUDIT_2026-06-23.md`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/docs/HOLEPUNCH_ALIGNMENT_PLAN.md`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/docs/SWARM-V1.md`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/SECURITY_AUDIT.md`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/SECURITY_FIXES.md`
- `/Users/localllm/Projects/pear-ecosystem/01-browser/PearBrowser/SUBMISSION.md`
