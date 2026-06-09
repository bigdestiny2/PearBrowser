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

## Running

```bash
npm test                          # typecheck + backend syntax + these tests
node --test test/                 # just these tests
node --test test/storage-backend.test.js
node --test test/swarm-v1-runtime-smoke.test.js
```
