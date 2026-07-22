# PearBrowser Tests

Tests run with Node.js built-in test runner via `node --test test/`.

The tests here validate modules that do not require React Native or the Bare
runtime — they are Node-runnable and can execute in CI without a device or
simulator. Screen-level UI tests live alongside the screen files and require
a React Native test runner (not configured yet — Phase 2 will add it).

## What's covered

- `storage-backend.test.js` — the `StorageBackend` interface in `app/lib/storage.ts`
- `pear-bridge-spec.test.js` — the injected bridge script factory is deterministic and validates inputs
- `relay-client.test.js` — `RelayClient` config methods (setRelays, setEnabled, getConfig)
- `backend-syntax.test.js` — every backend/*.js parses cleanly
- `swarm-v1-parity.test.js` — bridge/native constants, templates, and the `examples/echo-peer` fixture stay in sync
- `swarm-v1-runtime-smoke.test.js` — runs the mobile/native bridge template against a local `HttpBridge` backend and fake swarm to cover join, SSE events, send, and leave
- `content-shield.test.js` / `content-shield-phase2.test.js` — Content Shield engine (ABP-subset parsing, blocking, cosmetic, scriptlets, per-drive allow/strict) ported from the desktop
- `shield-list-sync.test.js` — P2P filter-list subscriptions (manifest + sha256 verify, hot-swap, offline restore)
- `content-shield-proxy.test.js` — shield chokepoints in the hyper-proxy (403 X-Pear-Shield before fetch, HTML injection, CSP hash authorization)
- `shield-parity.test.js` — SHIELD_* command ids, Android mirrors, backend handlers, proxy wiring, Settings section, and the pear-default seed list stay in sync
- `pear-plugins.test.js` / `plugin-drive-loader.test.js` / `plugin-catalog.test.js` — Pear Plugins (B4a, ported from the desktop: capability registry + kill switch, snapshot-bound install consent, escalation guard, P2P catalogue)
- `plugins-parity.test.js` — B4a surfaces stay in sync: PLUGIN_* command ids (desktop numbering), Android mirrors, backend handlers + boot wiring, both proxy injection paths, Settings Plugins section, catalogue seed data
- `privacy-policy.test.js` / `privacy-defaults.test.js` — privacy ladder (HTTPS-only, tracking-param strip, cookie drop, farbling, referrer policy, proxied-by-default) ported from the desktop
- `clearnet-proxy.test.js` — clearnet proxy (HTML rewrite keeping subresources on-proxy, 8 MiB cap, shield before fetch, origin pseudo-key documentKey, strict-CSP meta) + SessionBridge routing
- `clearnet-parity.test.js` — B2 surfaces stay in sync: ported modules, proxy chokepoints, NAVIGATE session routing, PRIVACY_STATUS session block, Android mirrors, Settings section, BrowseScreen proxy integration
- `search-core` / `search-federation` / `search-frontier` / `search-completeness` / `search-shard` / `search-doc-verify`, `personal-index`, `query-planner`, `cmd-search-contract`, `identity-binding-publisher` — local-first P2P search (B3, ported from the desktop: signed postings, deterministic ranker, digest-first fan-out budget, completeness anchors, stale-query suppression)
- `names` / `name-normalize` / `name-record` / `name-registry` / `name-registry-convergence` / `resolve-name` / `federated-name-resolver` / `name-wire` — petname naming + the N5 multi-writer registry (B3, ported from the desktop: first-claim-wins, owner-signed ops, homograph guardrails, trusted-contact federation)
- `search-names-parity.test.js` — B3 surfaces stay in sync: command/event ids (incl. the 108 event-id deviation), backend handlers + boot wiring, the /hyper/ indexing chokepoint, CMD_NAVIGATE name resolution, Android Protocol.kt/PearRpcClient mirrors, Search screen, Settings Names section, URL-bar fix

## Running

```bash
npm test                          # typecheck + backend syntax + these tests
node --test test/                 # just these tests
node --test test/storage-backend.test.js
node --test test/swarm-v1-runtime-smoke.test.js
```
