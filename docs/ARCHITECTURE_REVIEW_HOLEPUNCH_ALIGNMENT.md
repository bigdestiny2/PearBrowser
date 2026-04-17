# PearBrowser Architecture Review — Bare / Pear / Holepunch Alignment

**Date:** 2026-04-17

## Purpose of This Review

PearBrowser is a P2P mobile app platform. Its long-term value depends on how well it fits inside the Holepunch / Pear / Bare stack. This document:

1. Maps the current architecture against the "ideal" Holepunch-native stack
2. Identifies everything a P2P / Pear purist would flag as non-native or at odds with the stack's philosophy
3. Prioritises the migrations (especially moving Android to `bare-android`)
4. Leaves iOS and Android parity as first-class goals, not afterthoughts

---

## 1. Current Architecture (as shipped today)

```
┌───────────────────────────────────────────────────────────────┐
│  React Native app shell (app/)                                │
│  ─ Expo 55, RN 0.83.4                                         │
│  ─ AsyncStorage, expo-file-system, react-native-webview       │
│  ─ Tabs / screens / WebView host                              │
└──────────────────────────┬────────────────────────────────────┘
                           │ length-prefixed JSON over IPC pipe
                           ▼
┌───────────────────────────────────────────────────────────────┐
│  react-native-bare-kit (TurboModule bridge)                   │
│  ─ JavaScriptCore on iOS, V8 on Android                       │
│  ─ Exposes Worklet.start() → bundle.mjs                       │
└──────────────────────────┬────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────┐
│  Bare worklet (backend/ bundled via bare-pack)                │
│  ─ Hyperswarm, Corestore, Hyperdrive, Hyperbee, Autobase      │
│  ─ HyperProxy (localhost HTTP server, hybrid fetch)           │
│  ─ HttpBridge (/api/sync, /api/drive, /api/identity)          │
│  ─ PearBridge (Autobase sync groups for WebView apps)         │
│  ─ RelayClient (bare-http1 → HiveRelay gateway)               │
└───────────────────────────────────────────────────────────────┘
                           ▲
                           │ localhost HTTP + X-Pear-Token
                           │
┌───────────────────────────────────────────────────────────────┐
│  WebView (WKWebView iOS / WebView Android)                    │
│  ─ Renders apps from hyper:// drives via proxy                │
│  ─ window.pear bridge injected                                │
│  ─ Apps (POS, Bazaar, etc.) run here                          │
└───────────────────────────────────────────────────────────────┘
```

### What's good
- **Backend is 100% Bare-native** — `hyperswarm`, `corestore`, `hyperdrive`, `hyperbee`, `autobase`, `bare-http1`, `bare-fs`, `bare-crypto` are all used directly
- **Bundle is produced via `bare-pack`** (the official Holepunch tool), not Metro or Webpack
- **No Node.js assumptions leak into the worklet** — Buffer replaced with `b4a`, `fs` is `bare-fs`, etc.
- **Apps inside the WebView use `window.pear.*`** — mirrors the Pear Runtime's surface (with drive-scoped sync/identity)

---

## 2. What a Pear Purist Would Flag

### 2.1 The React Native shell itself (the biggest flag)
Pear Desktop (`pears.com`) and Keet are native apps that embed Bare directly. Using React Native as a shell adds:

- **Metro bundler** for the RN layer (not Bare's philosophy)
- **React Native TurboModule bridge** between JS and native — one more abstraction than the Keet model (which uses Swift/ObjC + Bare directly)
- **Expo SDK dependencies** (expo-file-system, expo-camera, etc.) — these don't exist in a pure-Bare world
- **~270MB APK overhead** for RN runtime and JS engine (Hermes/JSC) — Bare-on-native apps are <50MB

A purist would say: *"Why are you shipping JavaScriptCore AND Bare (which is MoreBackground-V8 on Android), AND Hermes, AND a full React runtime, to deliver a Hyperswarm app?"* The answer is **developer velocity** (cross-platform UI out of the box), but the cost is stack alignment and binary size.

### 2.2 Two JS engines on Android today
On Android we currently run:
- **V8 (Bare)** for the worklet
- **Hermes** for the React Native JS

That's 15-20MB of redundant engine weight and complicates native crash reports. Pear-aligned apps use only Bare's engine.

### 2.3 `react-native-bare-kit` is a thin wrapper — not the canonical path
Holepunch's canonical embeds for mobile are:
- **`bare-ios`** — example of embedding `bare-kit` in native iOS (Swift/ObjC)
- **`bare-android`** — example of embedding `bare-kit` in native Android (Kotlin/Java)
- **`bare-expo`** — example specifically for Expo users, shown in community responses as the Android-working recipe

`react-native-bare-kit` works but adds an RN TurboModule layer. Community answer ("bare-expo like I shared above") tells us they recommend bare-expo as the nearest working reference for RN + Bare on Android.

### 2.4 expo-file-system / AsyncStorage for anything P2P-adjacent
We currently use `AsyncStorage` for bookmarks, history, settings. This is fine for pure UI state, but if any of that data **should** be synced across devices (bookmarks, in particular), the Holepunch way is to put it in a user-scoped Hyperbee, not AsyncStorage. The same goes for the bundle being written to disk via expo-file-system on Android — that's a workaround; the native `bare-android` shell loads the bundle directly.

### 2.5 The relay itself (HiveRelay) is a centralisation vector
HiveRelay is an HTTP/HTTPS gateway in front of Hyperswarm. The hybrid fetch races relay and P2P. This is **pragmatic for mobile networks** (NAT traversal is slow, relay is fast) but a purist would point out:

- **hyper://** content should ideally come from peers, not a centralised relay
- **The relay's `/catalog.json`** is a centralised directory — Pear Desktop discovers apps via Hypercore-backed indexes
- **`RelayClient` is hardcoded** (`backend/index.js:368`) with a TODO comment — even the code acknowledges this is temporary

The correct long-term path is: **distributed catalog Hypercore + HDHT-only fetch** with the HTTP relay as an opt-in speed cache.

### 2.6 Catalog format diverges from Pear's app discovery model
Pear Desktop discovers apps via `pear://` links with a known key. Our catalog is a JSON blob with drive keys, which is fine but not standard. A closer alignment would be:

- **Catalog is a Hyperbee**, replicated over Hyperswarm, signed by an authority key
- **Each entry is a `pear://<key>` or `hyper://<key>`** with a small manifest
- **PearBrowser subscribes to one or many catalog Hyperbees** rather than HTTP-polling `/catalog.json`

### 2.7 Identity model is ad-hoc
PearBrowser exposes `getIdentity()` returning a public key. Keet uses the `protomux` + `noisekey` stack with a user-managed root keypair. The purist concern is that our "device identity" has no:
- Key rotation
- Backup / recovery phrase
- Relation to any social graph (following, contacts)

For a POS app running on one device this is acceptable, but for any multi-device use (phone + tablet + till) we need a Keet-style identity.

### 2.8 The `window.pear` bridge is custom, not Pear's actual API
Pear Runtime's `global.Pear` has a documented surface. Our `window.pear` mirrors some of it (identity, sync) but also has POS-specific endpoints and uses a different transport (HTTP + X-Pear-Token vs Pear's IPC). A purist would want either:
- `window.Pear` matching the Pear Runtime exactly
- Or explicit "PearBrowser extension API" naming to avoid confusion

### 2.9 Bundle is `.mjs` but Pear uses `.bundle`
Minor but real — `bare-pack` outputs both; we chose `.mjs` for Metro import compatibility. Pear's canonical format is `.bundle`. Doesn't affect functionality but drift is drift.

---

## 3. Priority Migrations

Ranked by strategic value × feasibility.

### Priority 1 — Android to `bare-android` direct (HIGH value, MEDIUM effort)

**Why:**
- Fixes the fundamental issue that the RN shell is **fighting** `react-native-bare-kit` on Android (JNI string limits, file-system workarounds, 372MB APK)
- Gets rid of Hermes entirely → one engine (V8) instead of two
- Matches community-recommended path (`bare-expo` / `bare-android`)
- Drops APK from ~372MB to sub-50MB based on the bare-expo reference
- Unlocks real P2P on Android — DHT, Hyperswarm, all of it, without the current startBytes song-and-dance

**What it takes:**
- Fork `bare-expo` or `bare-android` as the Android shell
- Replicate the four screens (Home / Explore / Browse / More) in Jetpack Compose or Kotlin UI
- Reuse the **entire `backend/` worklet unchanged** — it's already Bare-pure
- Bridge WebView to the worklet via the same localhost HTTP pattern
- iOS remains on RN temporarily

**Migration path:**
1. Fork bare-expo → name it `PearBrowser-android`
2. Copy `backend/` verbatim, re-bundle with `bare-pack --target android`
3. Port UI screen-by-screen (Home → Explore → Browse → More)
4. Ship as separate Android APK initially, then maybe converge

### Priority 2 — iOS to `bare-ios` direct (HIGH value, HIGH effort)

**Why:** Same logic as Priority 1 for iOS. Keet proves this works.

**Blocker:** iOS native (Swift/SwiftUI) has less P2P community tooling than Android. But the Keet codebase is the reference.

**What it takes:**
- Fork the Keet shell or write a new Swift/SwiftUI wrapper around `bare-kit` (iOS pod/xcframework already exists)
- Port screens
- Reuse the worklet

### Priority 3 — Catalog Hyperbee instead of HTTP (MEDIUM value, LOW effort)

**Why:** Most direct purism fix. A "catalog" is a natural fit for a Hyperbee: append-only, signed, replicated.

**What it takes:**
- Relay publishes a Hyperbee with entries `{ key → { name, drive, version, ... } }`
- PearBrowser subscribes via Hyperswarm, reads entries directly
- HTTP `/catalog.json` kept for 6 months as a compatibility endpoint, then removed
- **Bonus:** Anyone with a Hyperbee can become a catalog. The whole "Explore tab" generalises from "HiveRelay directory" to "any P2P directory you subscribe to"

### Priority 4 — Bookmarks / History as Hyperbee (LOW value for solo users, HIGH value for multi-device)

**Why:** Currently bookmarks live in AsyncStorage → only on one device. Pear purism + user value both say: **bookmarks should sync across user's devices via their own Hyperbee**.

**What it takes:**
- New `bookmarks.bee` inside user's Corestore
- Replicated over Hyperswarm topic derived from user's root key
- Same for `history.bee` (opt-in)

### Priority 5 — Replace RelayClient with direct Hyperswarm (MEDIUM value, MEDIUM effort)

**Why:** Removing the relay dependency is the ultimate purist move. The relay exists because mobile NAT traversal can take 15s while relay HTTP is 1-2s. But for a real P2P browser, the P2P path must be the primary path, not the fallback.

**What it takes:**
- Keep the relay code but make it opt-in (setting: "Use relay for fast-start: [ ]")
- Invest in improving first-connect latency via hints, boot bootstrap nodes, etc.
- Eventually: ship without a relay by default

### Priority 6 — Canonical `window.Pear` surface (LOW value, LOW effort)

Rename the bridge to match Pear Runtime's API exactly. PearBrowser extensions get a distinct namespace (`window.PearBrowser.*`).

---

## 4. What to Keep (don't fix what isn't broken)

These pieces are fine and should survive any migration:

- **The worklet itself (`backend/`)** — this is the crown jewel. Bare-native, uses canonical Holepunch libraries, the security work Codex did is solid
- **Hybrid fetch** — pragmatic, user-visible benefit (fast first paint), and the relay cost is small
- **Autobase for app data** — correct Holepunch primitive for multi-writer sync
- **Token-gated HTTP bridge** — right model (capability tokens), even if a future Bare-native version might use IPC instead of HTTP
- **The site builder** — block editor → Hyperdrive → publish is exactly the right shape

---

## 5. Purist Checklist (quick answer yes/no)

| Concern | Status | Notes |
|---|---|---|
| Bundle is Bare (not Node) | ✓ | `bare-pack` output, uses b4a, bare-fs, bare-http1, bare-crypto |
| Uses Hyperswarm for peer discovery | ✓ | Direct use of `hyperswarm` |
| Uses Hyperdrive for content | ✓ | `hyperdrive` + `corestore` |
| Uses Autobase for multi-writer | ✓ | `autobase` + `hyperbee` view |
| No Node.js shims | ✓ | Checked in `bare-pack` config |
| Native shell on iOS (not RN) | ✗ | **Priority 2 migration** |
| Native shell on Android (not RN) | ✗ | **Priority 1 migration** |
| Catalog is P2P (not HTTP) | ✗ | **Priority 3 migration** |
| User data is P2P (not AsyncStorage) | ✗ | **Priority 4 migration** |
| Relay is optional, not required | ~ | Hybrid fetch is opt-in via RelayClient but Explore hits relay HTTP by default |
| Identity is Keet-style | ✗ | Device pubkey only, no rotation |
| `window.Pear` matches Pear Runtime | ~ | Close but has drift |
| Bundle format is `.bundle` | ~ | We use `.mjs` for Metro compat |

**Score: 5.5 / 13.** Decent but lots of room to push toward full alignment.

---

## 6. Recommended Sequence

If the goal is **full Holepunch-native PearBrowser within 6 months**, do it in this order:

1. **Finish current functional polish** (these fixes landing today) — unblock shipping v0.1 to real users
2. **Ship v0.1 as a TestFlight + direct APK** — get user feedback while working on native migrations
3. **Start Priority 1: Android → bare-android** in parallel. 4-6 weeks.
4. **Ship Android bare-native as v0.2** — promote it as "the real P2P browser now"
5. **Priority 3: Catalog Hyperbee** — 1-2 weeks, works across both shells
6. **Priority 4: User-data Hyperbee sync** — 2-3 weeks, big UX win (multi-device bookmarks)
7. **Priority 2: iOS → bare-ios** — 6-8 weeks
8. **Ship v1.0 native on both platforms** — purists happy, APK small, no RN layer

This sequence also produces a natural storytelling arc:
- v0.1 "PearBrowser exists" (RN everywhere)
- v0.2 "Real P2P on Android" (bare-android)
- v0.3 "Everything syncs" (Hyperbee user data + catalog)
- v1.0 "Native everywhere" (bare-ios)

---

## 7. Specific Technical Debt to Pay Down Before Priority 1

Before migrating to bare-android, clear these first so the migration is clean:

- [x] Fix silent `catch {}` blocks (done in this session)
- [x] Persist active tab + browse URL (done in this session)
- [x] Support multiple catalogs in settings (done in this session)
- [ ] Replace `RelayClient` hardcoded URL with RPC-configurable setting
- [ ] Move `bookmarks.ts` and `history.ts` to an abstract `Storage` interface so later bare-native shells can swap in Hyperbee
- [ ] Extract `window.pear` bridge spec into a separate typed module so Android and iOS shells use the exact same injection script

Each of these is small (half a day) and sets up the migration to be boring.

---

## 8. TL;DR

- Backend worklet is aligned with Bare/Pear/Holepunch (9/10)
- Native shells are not (0/10 on Android, 0/10 on iOS — both are RN)
- Catalog and user data persistence are not (HTTP and AsyncStorage respectively)
- **Priority 1 action: move Android to `bare-android` / `bare-expo` native shell**
- Everything else can follow without breaking users
