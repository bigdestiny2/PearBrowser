# PearBrowser — Design Document

## Product Vision

PearBrowser is an iOS app that makes the decentralized web feel as polished as the regular one. Users discover P2P apps, build personal websites, and browse hyper:// content — all from their phone as a real peer in the Holepunch network.

**Design principles:**
1. App platform first, browser second
2. Never show a hex key where a name could go
3. Bottom of screen is prime real estate (thumb-friendly)
4. Progressive disclosure: green dot → "12 peers" → full DHT stats
5. Make P2P feel fast, not different
6. Curate over catalogue

## Information Architecture

```
┌─────────────────────────┐
│        PearBrowser       │
├────────┬────────┬───────┤
│  Home  │ Browse │  More │  ← Bottom tab bar
│  (hub) │ (web)  │ (menu)│
└────────┴────────┴───────┘

Home tab:                      Browse tab:              More tab:
┌─────────────────┐           ┌─────────────────┐     ┌─────────────────┐
│ Search / URL bar│           │ [WebView fills   │     │ My Sites        │
│ ────────────────│           │  entire screen]  │     │ Bookmarks       │
│ Quick Access    │           │                  │     │ History         │
│ [●][●][●][●]→  │           │                  │     │ Settings        │
│                 │           │                  │     │ P2P Status      │
│ Your Apps       │           │                  │     │ Add Catalog     │
│ ┌──┐ ┌──┐ ┌──┐ │           │                  │     │ About           │
│ │  │ │  │ │  │ │           │                  │     └─────────────────┘
│ └──┘ └──┘ └──┘ │           └──────────────────┘
│ ┌──┐ ┌──┐ ┌──┐ │           Bottom URL bar:
│ │  │ │  │ │  │ │           ┌─────────────────┐
│ └──┘ └──┘ └──┘ │           │ ◀ ▶ hyper://... ◉│
│                 │           └─────────────────┘
│ Discover        │
│ ┌──────────────┐│
│ │ Featured App ││
│ │ [screenshot] ││
│ │ name + desc  ││
│ └──────────────┘│
└─────────────────┘
```

## Home Screen

The default view. Designed to feel like a curated launcher.

**Sections (top to bottom):**

1. **Search/URL bar** — combined search + hyper:// input. QR scan button on right. P2P status dot on left (green/yellow/red).

2. **Quick Access** — horizontal scroll of recently visited sites. Circular icons with names below (like iOS Frequently Visited in Safari). Max 8 items.

3. **Your Apps** — grid of installed/bookmarked P2P apps. 3 columns. Icon + name. Tap to launch. Long-press for context menu (remove, share, info). "+" card at the end to add from catalog.

4. **Discover** — vertical scroll of featured P2P apps/sites. Large cards with screenshot, name, description, "Get" button. Initially hardcoded, later community-driven via a catalog Hyperdrive.

## Browse Mode

Full-screen WebView with bottom URL bar (follows Safari's bottom-bar pattern).

**Bottom bar (always visible):**
- Back arrow
- Forward arrow
- Truncated URL (tap to edit, shows full URL in editing mode)
- Share button (generates QR + copy key)
- Status dot (green/yellow/red)

**Gestures:**
- Edge swipe left = back
- Edge swipe right = forward
- Pull down from top = show full URL bar + tabs
- Swipe on bottom bar left/right = switch between open tabs

**Tab management:**
- Pull-down or tap tab count reveals card-based tab switcher
- Each card shows site thumbnail + title + peer count
- Swipe to close
- "+" to open new tab (goes to Home)

## Site Builder

Accessed from More → My Sites → "Create New Site"

**Editor:**
- Mobile block editor (tap to add, drag to reorder)
- Block types: Heading, Text, Image, Link, Divider, Code, Quote
- Theme picker: 4-5 presets with primary color customization
- Live preview toggle (split or full-screen)

**Publishing:**
- "Publish" button creates/updates the Hyperdrive
- Shows the hyper:// key with QR code for sharing
- Option to seed via HiveRelay for 24/7 availability

## App Store / Catalog

The catalog is itself a Hyperdrive. Multiple catalogs can be added.

**Default catalog structure:**
```
/catalog.json            — app index
/apps/{id}/
  manifest.json          — metadata
  icon.png               — 256x256 app icon
  screenshots/           — preview images
```

**App card in catalog:**
- Icon (left)
- Name + short description (center)
- "Get" button (right)
- Tap card → detail page with screenshots, full description, permissions

**Installing an app** = downloading its Hyperdrive and caching locally. No approval needed. Apps run in a sandboxed WebView.

**P2P App API** (injected into WebView via postMessage bridge):
```typescript
window.pear = {
  // Identity
  publicKey: string,           // User's ed25519 public key (hex)

  // Networking (proxied through RN → worklet)
  swarm: {
    join(topic: string): Promise<void>,
    leave(topic: string): Promise<void>,
    onConnection(cb: (peer: { publicKey: string }) => void): void,
    send(peerId: string, data: Uint8Array): Promise<void>,
    onData(cb: (peerId: string, data: Uint8Array) => void): void,
  },

  // Storage (app-scoped Hyperdrive)
  drive: {
    get(path: string): Promise<Uint8Array | null>,
    put(path: string, data: Uint8Array): Promise<void>,
    del(path: string): Promise<void>,
    list(prefix: string): Promise<string[]>,
  },

  // Compute (HiveCompute integration — future)
  compute: {
    inference(opts: { model: string, messages: any[] }): AsyncIterable<{ text: string }>,
  },

  // Browser
  navigate(url: string): void,
  share(url: string): void,
}
```

## P2P Status Indicator

Three-level progressive disclosure:

**Level 1 — Dot (always visible):**
- Green = connected, peers available
- Yellow = connecting or limited
- Red = offline

**Level 2 — Tap dot → inline text:**
- "Connected · 12 peers"
- "Connecting..."
- "Offline"

**Level 3 — Tap again → bottom sheet:**
- DHT nodes: 847
- Active connections: 12
- Data transferred: 4.2 MB
- Uptime: 23m
- Public key: abc123... (tap to copy)

## Key Address Handling

Hex keys are the enemy of mobile UX. Strategy:

1. **Petnames** — user assigns local names: "alice-blog" → hyper://abc...
2. **Site titles** — parse <title> from HTML on first visit, cache it
3. **QR codes** — primary sharing mechanism
4. **Clipboard detection** — detect 64-char hex in clipboard, offer to navigate
5. **Truncated display** — `hyper://a1b2...c3d4` (first 4 + last 4)
6. **Deep links** — `pearbrowser://hyper/KEY` opens the app
7. **Share sheet** — "Share" generates QR + copyable key + share via iOS

## Color Palette

Dark theme (matches Pear/Holepunch aesthetic):

```
Background:       #0a0a0a
Surface:          #1a1a1a
Surface elevated: #2a2a2a
Border:           #333333
Text primary:     #e0e0e0
Text secondary:   #888888
Text muted:       #555555
Accent (Pear):    #ff9500 (orange)
Success:          #4ade80 (green)
Warning:          #facc15 (yellow)
Error:            #ef4444 (red)
Link:             #4dabf7 (blue)
```

## Technical Architecture

Same Bare Kit worklet pattern, but using the canonical `framed-stream` + `hrpc` stack (not bare-rpc):

```
React Native ↔ Worklet IPC:
  FramedStream (length-prefixed framing)
    └─ HRPC (typed, schema-based RPC)

Worklet internals:
  Hyperswarm → Corestore → Hyperdrive (shared across all features)
  HTTP proxy server (bare-http1) for WebView content
  CatalogManager, AppManager, SiteManager modules
```

## Build Phases

### Phase 1 — Foundation
- Project setup (Expo + bare-kit + worklet)
- Worklet backend with Hyperswarm + Corestore
- HTTP proxy for hyper:// content
- HRPC schema and RPC layer
- Basic Home screen + Browse tab + bottom nav

### Phase 2 — App Store
- Catalog manager (parse catalog.json from Hyperdrive)
- App install/uninstall (download + cache app Hyperdrives)
- App launcher (serve in WebView)
- Pear API bridge (window.pear injection)
- Discover UI + My Apps grid

### Phase 3 — Site Builder
- Site manager (writable Hyperdrive lifecycle)
- Block editor component
- Templates (blank, blog, portfolio, landing)
- Publish flow + QR sharing
- My Sites list

### Phase 4 — Polish
- Tabs (card-based switcher)
- Bookmarks + history persistence
- Petnames for key aliasing
- Deep links + share sheet
- HiveRelay seeding integration
- HiveCompute inference API
