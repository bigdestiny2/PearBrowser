# PearBrowser — Holepunch application (Node Engineer / P2P Architect)

PearBrowser is a peer-to-peer mobile app platform built directly on the Holepunch
stack — a **Bare worklet** running **Hyperswarm**, **Corestore**, **Hyperdrive**,
**Hyperbee**, **Autobase**, **streamx**, **b4a**, and **bare-http1**, reused
unchanged across native iOS (Swift), native Android (Kotlin), and an RN shell. The
phone is a real peer: it joins the HyperDHT, holepunches, and replicates directly.

This repo is the submission for the **Node Engineer** and **P2P Architect** roles.

## Start here

| What | Where |
|---|---|
| **Headless XHR-over-streamx** — htmx apps with no HTTP server; `XMLHttpRequest` rides a streamx stream | [`backend/xhr-streamx.js`](backend/xhr-streamx.js), [`examples/htmx-headless/`](examples/htmx-headless/) |
| The P2P engine (one worklet, three shells) | [`backend/`](backend/) |
| Alignment plan + the self-review hardening pass | [`docs/HOLEPUNCH_ALIGNMENT_PLAN.md`](docs/HOLEPUNCH_ALIGNMENT_PLAN.md) |
| `swarm.v1` — page-scoped Hyperswarm channels with consent + revocable grants | [`backend/swarm-bridge.js`](backend/swarm-bridge.js), [`docs/SWARM-V1.md`](docs/SWARM-V1.md) |

## Node engineer — the evidence

- **streamx, used the way it's meant to be.** The `xhr-streamx` transport streams
  a response body with a size cap, decodes once, propagates `destroy()` on
  abort/timeout up the hypercore pipeline, and is terminal-once. (See the review
  hardening pass in the alignment doc for the before/after.)
- **Bare, not Node.** Worklet code is `b4a`/`bare-*` throughout (custom
  length-prefixed RPC over IPC, `bare-http1` for relay fetches); no `Buffer`
  leaking into the worklet.
- **The bridge.** A token-gated localhost surface (`window.pear.*`) with SSE
  streaming, per-origin scoping, and a strict CSP on proxied pages.

## P2P architect — the evidence

- **Hyperswarm/HyperDHT on mobile** — real holepunching from a phone.
- **Data model** — Hyperdrive content, Hyperbee user data + app catalog, Autobase
  for local-first sync, Corestore namespacing.
- **`swarm.v1`** — `hyper://` pages can open direct page-scoped Hyperswarm
  channels, consent-gated, stored as revocable per-app grants.
- **Hybrid transport** — relay HTTP fast-path raced against direct Hyperswarm,
  with the P2P path warming the local cache.

## Engineering discipline

Before submitting, the change set was put through an adversarial multi-agent code
review held to "would the author of streamx wince?" Every confirmed finding was
fixed or **honestly documented as a known gap** (per-app origin isolation; full
Protomux multiplexing for `swarm.v1`) rather than half-built. **87/87 tests green**
(`npm test`, run concurrently). Details: the *Review hardening pass* in
[`docs/HOLEPUNCH_ALIGNMENT_PLAN.md`](docs/HOLEPUNCH_ALIGNMENT_PLAN.md).

## Run it

```bash
npm install --legacy-peer-deps
npm test                          # tsc + node --check + the full suite
node examples/htmx-headless/run.js  # htmx app served over streamx, headless
# native build: see README "Setup"
```

## Credits

- **Dominic Cassidy** ([@Drache93](https://github.com/Drache93)) — the
  **XHR-over-streamx** pattern that makes apps run headless: hook
  `XMLHttpRequest` so htmx thinks it's talking to a server when it's actually a
  streamx stream into the worklet / a peer / a Hyperdrive.
