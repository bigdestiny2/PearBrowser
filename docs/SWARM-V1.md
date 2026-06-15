# `swarm.v1` — direct Hyperswarm access for `hyper://` pages

> Status: design spec, targeting **PearBrowser Desktop v0.3.0**. Mobile parity tracked separately.
>
> Goal: same URL, same drive — pages that know how to ask for direct P2P get it; pages that don't keep working unchanged. The page-side API is `window.pear.swarm.v1`.

---

## 1. Why

Today every `hyper://` page in PearBrowser fetches through a localhost HTTP proxy:

```
page → http://127.0.0.1:PORT/hyper/<key>/...
       ↘ worklet HyperProxy
           ↘ Hyperswarm peer
       ↙ worklet HyperProxy
page ← http://127.0.0.1:PORT/...
```

That model is fine for static page loads. It is the wrong shape for any application that needs **bidirectional realtime** — chat, multiplayer games, collaborative editors, mesh signaling, cursor sharing, voice/video discovery. Every message round-trips localhost HTTP, which destroys streaming, blows up latency, and forces request/response semantics on protocols that want to be push-driven.

`swarm.v1` fixes this by exposing — to opt-in pages — the four primitives that Pear desktop apps already use directly: **keypair**, **autobase**, **swarm join**, **signed ops**. Pages get a real channel into Hyperswarm, scoped and consent-gated, without ever holding raw private keys or socket FDs.

---

## 2. What's already there (v1)

Three of the four caps are already plumbed via the localhost HTTP API in `backend/http-bridge.js`:

| Cap | Endpoint | Notes |
|---|---|---|
| **Keypair** | `GET /api/identity` | Returns the page's per-app `appPubkey`. Private key stays in the worklet — pages can ask "sign X with my key" but never see the key. |
| **Autobase** | `POST /api/sync/{create,join,append}` · `GET /api/sync/{get,list,range,count,status}` | Full CRUD plus implicit swarm-join for the autobase's discovery topic. |
| **Signed ops** | `POST /api/identity/sign` | Signs an arbitrary payload with the per-app sub-key + tag namespace (`pear.app.<driveKey>:<ns>:<payload>`). |

What's **missing** — and what v2 adds — is generic swarm-join: the ability for a page to talk to peers on a topic of its choosing using its own protocol, rather than being limited to "whatever Autobase does".

---

## 3. The v2 surface

### 3.1 Page-side shim

```js
// Feature detect — pages that skip this just use the old proxy fetch path.
if (window.pear?.swarm?.v1) {
  const ch = await window.pear.swarm.v1.join(topicHex, {
    server: false,
    client: true,
    // Optional: protocol name + version, multiplexed by the worklet so
    // multiple pages can share one swarm topic without colliding.
    protocol: 'hivechat',
    version: 1
  })

  ch.on('peer', (peer) => {
    console.log('connected:', peer.id, peer.pubkey)
    peer.send(b4a.from('hello'))
  })
  ch.on('message', (peer, data) => {
    console.log('from', peer.id, ':', b4a.toString(data))
  })
  ch.on('peer-leave', (peer) => { /* … */ })

  // Tear down — releases the worklet-side handle, leaves the swarm topic
  // if no other page in this app is on it.
  ch.destroy()
}
```

### 3.2 Channel object shape

```ts
interface SwarmChannel {
  topic: string                      // 64-hex
  protocol: string                   // app-chosen, e.g. 'hivechat'
  version: number                    // app-chosen, integer
  peers: Peer[]                      // currently connected
  on(event: 'peer' | 'message' | 'peer-leave', fn): void
  off(event, fn): void
  destroy(): void
}

interface Peer {
  id: string                         // worklet-assigned, stable for this conn
  pubkey: string                     // 64-hex — the peer's app sub-key, IF
                                     // they signed a handshake (see §4.4)
  send(data: Uint8Array): void
  destroy(): void                    // closes this single peer conn
}
```

The page never holds a Hyperswarm `connection` directly. It holds an opaque peer **handle** that the worklet multiplexes on its behalf. This keeps the security boundary intact and lets us swap the underlying transport (Hyperswarm conn → relayed conn → WebTransport, etc.) without breaking pages.

### 3.3 Worklet-side endpoints

```
POST  /api/swarm/join                                            → { channelId, topicHex }
POST  /api/swarm/leave    { channelId }                          → { ok: true }
POST  /api/swarm/send     { channelId, peerId, data: base64 }    → { ok: true }
GET   /api/swarm/events?channelId=…                              → text/event-stream (SSE)
```

The streaming half uses **Server-Sent Events** rather than WebSockets. SSE is plain HTTP, so it slots into the existing `bare-http1` proxy without a separate upgrade handler, and `EventSource` is universally available in iframes. The page opens **one SSE stream per joined channel**, with frames as `data: <json>\n\n`. Frame types from worklet → page:

```
{ type: 'peer',       peerId, pubkey?, info? }
{ type: 'peer-leave', peerId }
{ type: 'message',    peerId, data: base64 }
{ type: 'error',      message }
{ type: 'closed' }
```

Backpressure: the per-channel SSE stream is bounded; the worklet drops frames + emits an `error` of `'overflow'` rather than buffering unboundedly. Pages that need ordered guaranteed delivery wrap with their own ack protocol on top.

---

## 4. Topic policy — **the security-critical decision**

Pages cannot be allowed to join arbitrary 32-byte topics without friction. Hyperswarm peers see your IP; any topic-join is also a fingerprinting vector. Three tiers, in increasing trust:

### 4.1 Tier A — drive-derived topics (no consent prompt)

A page can always join, without prompt:

```
topic = sha256("pear.swarm.v1:" || driveKeyHex || subtopic)
```

…where `driveKeyHex` is the key of the drive serving this page and `subtopic` is a UTF-8 string the page chooses. No consent needed because the topic is provably scoped to this drive's owner namespace — only pages served from this drive can address it.

This covers ~90% of in-app realtime use cases (a chat app's rooms, a game's lobbies, a collab editor's documents).

### 4.2 Tier B — autobase / mint-then-rejoin

Topics returned by `/api/sync/create` (Autobase discovery key) or `/api/swarm/mint` are added to the page's grant list. The page can rejoin them later without a prompt. This covers cross-device sync of the same app.

### 4.3 Tier C — arbitrary topics (consent required)

A page wanting to join a 32-byte topic that isn't drive-derived and wasn't minted by the worklet must trigger a **consent sheet**, identical in shape to the existing login consent:

```
EVT_SWARM_REQUEST { requestId, driveKey, appName, reason, topicHex, protocol }
```

UI shows: "X wants to connect to peers on topic <hex>. This will reveal your IP to those peers." With `Approve` / `Cancel`, optional "Always allow this app". On approve, the worklet records the grant in `swarm-grants.bee` keyed by `(driveKey, topicHex)` and then proceeds with the join. Subsequent rejoins use the cached grant.

Grants are per-app (per-driveKey), per-topic. Listed in **Settings → Connected Apps → Swarm topics**, revocable individually or in bulk.

### 4.4 Peer identity hand-shake (optional)

A page that wants `peer.pubkey` to be populated has its peers exchange an Ed25519-signed handshake on first frame:

```
handshake = pear.swarm.v1:<topicHex>:<theirChannelNonce>:<ourChannelNonce>
sig       = sign(handshake, peer's per-app sub-key)
```

The worklet verifies on receive and surfaces `peer.pubkey` only on success. Pages that don't care (e.g. anonymous chat) skip the handshake and get `peer.pubkey: null`.

---

## 5. Rate limits + DoS mitigation

| Limit | Default | Why |
|---|---|---|
| Topics per page | 8 simultaneous | Stops a runaway page from joining hundreds of topics |
| Topic joins per minute | 10 | Stops topic-fingerprinting probes |
| Outbound bytes per peer per second | 1 MB | Stops accidental tight-loop sends |
| Peers per channel | 64 | Soft cap; resolves with newest-wins |
| Pending consent sheets | 1 | No queue; subsequent joins fail with `'consent-pending'` |

All limits are configurable from `backend/swarm-bridge.js` and overridable in user settings (Settings → Privacy → Advanced).

---

## 6. Wire upgrade: same URL, no redistribution

The killer property of this design: **a page authored today and a page authored after v0.3.0 ships use the same `hyper://drive-key/` URL**. The page checks at runtime:

```js
const direct = !!window.pear?.swarm?.v1
if (direct) {
  // v0.3.0+ — go peer-to-peer
} else {
  // any older PearBrowser, or non-PearBrowser context — fall back to
  // POST /api/sync/append style autobase coordination via the proxy
}
```

Old PearBrowser desktops keep working unchanged. New ones light up direct paths the page already knew how to ask for. There is no flag day, no breaking change, no `swarm.v1`-only fork of any drive.

---

## 7. Versioning

The surface is namespaced `window.pear.swarm.v1` rather than `window.pear.swarm`. Reasons:

1. We will get something wrong. v1 is the contract apps can rely on; v2 (if needed) lives alongside.
2. Pages can feature-detect specifically — `if (window.pear?.swarm?.v1)` is more honest than a generic capability check.
3. Cheap discipline now, saves us from having to break a published surface later.

The HTTP `/api/swarm/*` endpoints are similarly versioned in their request body: `{ version: 1, … }`.

---

## 8. Open questions (resolved before code)

| Q | A |
|---|---|
| Consent every topic-join, or once-per-app-per-topic with persistence? | **Once-per-app-per-topic.** Persistent grant in `swarm-grants.bee`, revocable in Settings. (Tier A drive-derived topics never prompt at all.) |
| `window.pear.swarm` or `window.pear.swarm.v1`? | **`.v1`** (see §7). |
| Can a page mint a fresh keypair (separate from its app sub-key) for a swarm session? | **No, v1.** Pages always sign with their per-app sub-key. Per-session ephemeral keys are a v2 feature if there's demand. |
| Does this work in a sandboxed `iframe`? | **Yes** — same-origin loopback bypass, plus a per-iframe `appPubkey` distinct from the parent. Sandbox attribute irrelevant to localhost fetches. |
| Mobile parity? | **Tracked separately** — same JS surface, same RPC commands, but mobile shells need their own consent UI. v0.3.0 ships desktop only. |

---

## 9. Implementation order

1. **`backend/swarm-bridge.js`** — manages page-scoped channels, multiplexes hyperswarm conns, enforces rate limits.
2. **`backend/http-bridge.js`** — adds `/api/swarm/{join,leave,send}` REST + `GET /api/swarm/events` SSE stream (one `text/event-stream` per channel; no WebSocket upgrade).
3. **`backend/swarm-grants.js`** — Hyperbee for persisted Tier C grants (mirrors `profile.js` shape).
4. **`backend/index.js`** — boots the bridge + grants store + handles `EVT_SWARM_REQUEST` / `CMD_SWARM_RESOLVE`.
5. **`backend/pear-bridge.js`** — page-side injected shim adds `window.pear.swarm.v1`.
6. **`ui/shell.js`** — adds swarm-join consent path to `LoginConsent` (or a sibling `SwarmConsent` component, depending on UX) + a "Swarm topics" sub-table to Connected Apps.
7. **Demo:** `examples/echo-peer/` — `hyper://` fixture that calls `window.pear.swarm.v1.join(null, { subtopic })`, sends "hello", logs replies, and doubles as the runtime smoke test.
8. **`pear stage` + `pear release production .`** — ship.

---

## 10. Non-goals (for v0.3.0)

- ❌ WebRTC / direct browser-to-browser. PearBrowser is the runtime; we own the swarm. Browser-tab isolation comes later.
- ❌ Custom transport injection. The worklet picks the transport (Hyperswarm DHT today, possibly relayed later).
- ❌ Cross-origin swarm sharing. A topic joined by `hyper://drive-A/` cannot be joined by `hyper://drive-B/` without going through Tier C consent for each.
- ❌ Mobile. Tracked separately; same wire format, different consent UI.
