# PearBrowser

A peer-to-peer mobile app platform for iOS and Android. Browse the decentralized web, discover P2P apps from decentralized catalogs, build personal websites, and run web apps that can use Pear identity, Autobase sync, Hyperdrive content, and direct Hyperswarm channels from a phone.

**2026-09-28 draft update:** [Mobile PR #6](https://github.com/bigdestiny2/PearBrowser/pull/6) adds browser tab/session controls, local-first search with an explicit trusted-peer option, opt-in page indexing, Private Mode session safeguards, updated P2P dependencies, and stricter release checks. Autobee is under compatibility test only; existing user data remains on Autobase/Hyperbee. This is a source candidate, not a released mobile build. Fresh Android and iOS simulator builds now boot with a Connected worklet; Android HTTPS navigation and local search passed initial smoke. The Android tab switcher and second-tab creation passed initial emulator smoke; prior-page retention still needs a stepwise device check. Per-app web origin isolation, physical-device proof, production signing, and store validation remain open. See [the current update evidence and gates](docs/PEARBROWSER_UPDATE_2026-09-26.md).

**Architecture and evidence:** start with [docs/ARCHITECTURE_AND_CAPABILITIES.md](docs/ARCHITECTURE_AND_CAPABILITIES.md) and [the September candidate status](docs/PEARBROWSER_UPDATE_2026-09-26.md). The [July 2026 release evidence](docs/RELEASE_EVIDENCE_2026-07-22.md) records older source, audit, and native builds; it is historical evidence, not qualification of PR #6. The current soft preflight reports 18 structural passes and four production-authority failures. The separate mobile origin-isolation gate is still red.

**Try it locally:** Build the iOS shell and run the bundled example app from source — see [Setup](#setup) below. In short:

```bash
git clone https://github.com/bigdestiny2/PearBrowser.git
cd PearBrowser
npm install --legacy-peer-deps
npm run bundle-all && npm run bundle-all-native
cd ios-native && xcodegen generate && cd ..
xcodebuild -project ios-native/PearBrowser.xcodeproj -scheme PearBrowser -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO build
```

**Production mobile release preflight:** before cutting a community release, run the hard gate:

```bash
npm run release:preflight
```

For an audit-only report that does not fail the shell, use `npm run release:preflight -- --soft`; for CI/artifact capture, use `npm run release:preflight -- --json`. The preflight verifies version/package ID alignment, native worklet bundles, iOS BareKit/addon frameworks, Android BareKit AAR, production signing inputs, and store-distribution validation markers. On 2026-09-28 it reports 18 structural passes and four failures: Android signing, Apple development-team signing, iOS store validation, and Android Play/Firebase validation. A passing soft CI job is not a passing production release gate; [per-app origin isolation](docs/MOBILE_ORIGIN_ISOLATION_GATE.md) is an additional open gate.

**Try the in-app catalog flow:** the `examples/echo-peer/` fixture contains `index.html` and a `manifest.json` (name "Echo Peer", `swarm.v1` permission) for exercising the `window.pear.swarm.v1` bridge. To list it in a PearBrowser relay catalog, have a relay operator **seed `examples/echo-peer`** (relay dashboard → Seeding Registry / wizard, or `POST /seed` with its drive key). Its manifest lets the catalog show **"Echo Peer"** rather than "Unknown App." This is a developer flow; live peer and mobile device behavior still need qualification. The configured default relay hosts are `relay-us.p2phiverelay.xyz` and `relay-sg.p2phiverelay.xyz`.

## Why PearBrowser?

Traditional mobile apps depend on cloud servers. When the server goes down, the app stops working. When the company shuts down, your data disappears. When you're offline, you can't do anything.

PearBrowser is designed to run apps and keep their data on your device, then sync directly with peers when they are reachable. Content already saved on the phone can remain available offline. A trusted relay catalog can help users discover apps and fetch seeded content. Availability still depends on peers or a relay for content that is not cached.

## Core Features

### 1. Decentralized App Store

PearBrowser has a built-in App Store, but it's not controlled by any single company. Here's how it works:

**Catalogs are hosted on HiveRelay nodes.** Each relay serves a `/catalog.json` endpoint that lists all the P2P apps it knows about. Current relays may also advertise a signed `catalogBeeKey` and an additive capability doc at `/.well-known/hiverelay.json`; PearBrowser prefers the richer signed catalog path when it is available. When a relay operator seeds an app's drive, the relay reads its manifest and the app appears in that relay's catalog.

**Anyone can run a catalog.** Relays are open source. You can run your own relay with your own curated selection of apps — for your company, your community, or the public. PearBrowser users add relay URLs in Settings to browse different catalogs.

**Hyper sites can use a relay fast path.** When you tap **Open** on a browseable `hyper://` site, PearBrowser can load seeded files from a relay's HTTP gateway (`/v1/hyper/<driveKey>/…`) with a direct P2P fallback. First-load speed depends on relay availability, cache state, and peer connectivity.

**The catalogue states the delivery boundary.** `hyper://` sites are opened on the phone. A compatible native v3 desktop package is labelled **Desktop only** and is never installed by mobile. A `pear://` or `file://` v2 executable is labelled **Migration required**, never launched, and directs its owner to migrate on desktop.

**Catalog rows are normalized before rendering.** PearBrowser accepts `apps[]`, `items[]`, or `entries[]`, recognizes `driveKey`, `appKey`, `key`, and safe `hyper://` links, and prefers signed Hyperbee catalogs when advertised. Legacy `pear://` and `file://` links are retained only as migration records; they cannot become a browser destination.

**Relay catalogs are operator curated.** A relay operator decides what its catalog seeds, and users choose which relays they trust. Distribution of the mobile PearBrowser app through Apple's or Google's stores is subject to those stores' review and release requirements.

**How apps get into the catalog:**

1. **Build the app** (HTML/JS/CSS) and ship a `manifest.json` at the drive root (`name`, `description`, `author`, `version`, `categories`, optional `icon`). Publish it as a Hyperdrive so it has a drive key.

2. **A relay operator seeds it.** From the relay dashboard (Seeding Registry / `wizard.html`) or with an authenticated `POST /seed` (Bearer token), the operator hands the relay the app's drive key (`appKey`) plus any optional metadata.

3. **The relay eager-replicates the drive and reads its `/manifest.json`** to build the catalog entry (name, description, author, version, categories, icon). An app seeded **without a manifest shows up as "Unknown App"** — so always include one.

4. **The relay serves the aggregated catalog at `GET /catalog.json`.** PearBrowser fetches it over HTTP and lists the entries. If the relay also advertises `catalogBeeKey`, PearBrowser verifies and loads that signed Hyperbee in preference to the plain JSON snapshot. Tapping **Open** loads a browseable Hyperdrive through the relay gateway (`/v1/hyper/<driveKey>/…`) with a P2P fallback; mobile never installs a desktop package.

```
Developer            Relay operator          HiveRelay                 PearBrowser
─────────            ──────────────          ─────────                 ───────────
Build app + drive →  Seed driveKey via   →   Eager-replicates drive,
manifest.json        dashboard wizard or     reads /manifest.json,
                     POST /seed (Bearer)     adds entry to catalog  →  App Store fetches
                                                                       GET /catalog.json
                                                                    →  Taps "Open" for hyper://
                                                                    →  Loads via
                                                                       /v1/hyper/<driveKey>/…
                                                                       (P2P fallback)
```

### 2. P2P Browser Runtime

The native shells route `hyper://` links to Hyperdrive content through a Bare worklet and local proxy. This mobile candidate has bridge tokens, but all P2P pages still share one loopback web origin. [Per-app origin isolation](docs/MOBILE_ORIGIN_ISOLATION_GATE.md) remains a release gate for untrusted content.

**Hybrid architecture:** PearBrowser uses two paths to fetch content simultaneously:

- **Fast path (HTTP):** Ask a configured HiveRelay gateway for content it has seeded.
- **P2P path (Hyperswarm):** Connect directly to peers via the DHT and cache retrieved content locally.

Whichever path responds first wins. The P2P path can continue syncing in the background so later navigations may use local content.

**The worklet is built for direct peer connections.** Bare Kit runs the Hyperswarm stack in a separate JavaScript runtime. The current candidate still needs physical-device and live-peer replication proof before those paths are treated as release qualified.

### 3. App Identity and Direct P2P APIs

Apps running inside PearBrowser get the PearBrowser `window.pear` bridge. Feature-detect each namespace because desktop and mobile hosts expose different subsets:

- `window.pear.login()` for per-app sign-in with a native consent prompt.
- `window.pear.identity.*` for app-scoped public keys and signatures.
- `window.pear.sync.*` for Autobase-backed local-first data, including range and count queries.
- `window.pear.swarm.v1.join()` for direct Hyperswarm channels.
- `window.pear.contacts.*`, `window.pear.navigate()`, and `window.pear.share()` when granted/available.
- `window.posAPI` as a POS compatibility wrapper around `window.pear.sync`.

Raw arbitrary swarm topics are consent-gated and stored as revocable per-app grants. Drive-derived swarm topics are scoped to the current Hyperdrive and can connect automatically.

### 4. Website Builder

Create and publish personal websites directly from your phone:

1. **Create:** Name your site, choose from block types (heading, text, image, code, quote, link, divider)
2. **Edit:** Mobile-friendly block editor with drag-to-reorder and theme customization
3. **Publish:** One tap — creates a Hyperdrive, starts serving on the DHT, shows your `hyper://` URL
4. **Share:** QR code or iOS Share sheet with the link
5. **Seed:** Ask a HiveRelay to seed your site for 24/7 availability

Your site is yours forever. You own the keypair. No hosting fees. No domain registration. No censorship.

## How It All Connects

```
┌──────────────────────────────────────────────┐
│  PearBrowser (mobile app)                    │
│                                              │
│  ┌──────────┬──────────┬────────┬─────────┐  │
│  │  Home    │  Apps    │ Browse │  More   │  │
│  │  Screen  │  Store   │  View  │  Menu   │  │
│  └──────────┴──────────┴────────┴─────────┘  │
│         │                  │                  │
│         │  Native/RN shell │  WebView         │
│  ───────┼──────────────────┼───────────────── │
│         │  IPC (RPC)       │  window.pear     │
│  ┌──────▼──────────────────▼───────────────┐  │
│  │  Bare Worklet — P2P Engine              │  │
│  │                                         │  │
│  │  HyperProxy ─── relay HTTP (fast)       │  │
│  │       └──────── Hyperswarm P2P (backup) │  │
│  │                                         │  │
│  │  CatalogManager ── loads /catalog.json  │  │
│  │  CatalogManager ─── classifies browse / desktop / legacy │  │
│  │  SiteManager ────── create/publish sites│  │
│  │  PearBridge ─────── login/sync/swarm.v1 │  │
│  │                                         │  │
│  │  Hyperswarm + HyperDHT + Corestore     │  │
│  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────┐      ┌──────────────────┐
│  HiveRelay      │      │  Other Peers     │
│  Nodes          │      │  (phones, PCs)   │
│                 │      │                  │
│  • HTTP gateway │      │  • Direct P2P    │
│  • App catalog  │      │  • Autobase sync │
│  • Content seed │      │  • Content serve │
│  • NAT relay    │      │                  │
└─────────────────┘      └──────────────────┘
```

## The Role of HiveRelay

HiveRelay nodes are the always-on infrastructure of the P2P network. They solve four critical problems:

| Problem | Without HiveRelay | With HiveRelay |
|---------|-------------------|----------------|
| **App availability** | Apps only available when the developer's machine is on | Apps cached and served 24/7 from relay HTTP gateway |
| **First load speed** | 5-15 seconds (DHT lookup + peer connection) | Under 2 seconds (HTTP from nearest relay) |
| **App discovery** | Users must manually enter 64-char hex keys | Relay auto-builds `/catalog.json` — users browse an App Store |
| **Data persistence** | Autobase data only syncs when peers are online simultaneously | Relay seeds Autobase cores — data available for new peers anytime |

**Anyone can run a relay.** The more relays, the more resilient the network. Relays are open source and free to operate.

**Default public relays** (the hosts PearBrowser ships pointing at):
- `relay-us.p2phiverelay.xyz`
- `relay-sg.p2phiverelay.xyz`

Each relay can additionally publish `/.well-known/hiverelay.json` capability data and an optional `indexRoom` pointer for richer relay discovery. PearBrowser already treats those as additive surfaces: capability docs improve trust and diagnostics, signed catalog bees improve catalog integrity, and `indexRoom` is the next relay-directory path to keep expanding.

## P2P App API

Apps running in PearBrowser get access to P2P features via an injected JavaScript bridge:

```javascript
// Sign in with app-scoped identity after native user consent.
const login = await window.pear.login({
  appName: 'Pear POS',
  scopes: ['profile:name'],
  reason: 'Show your name on receipts you share.'
})

// Sync data across devices (Autobase)
await window.pear.sync.create('my-app')
await window.pear.sync.append('my-app', {
  type: 'product:create',
  data: { id: '1', name: 'Coffee', price: 450 }
})
const products = await window.pear.sync.list('my-app', 'products!')

// Multi-device: share the invite key
const { inviteKey } = await window.pear.sync.create('my-app')
// On another device:
await window.pear.sync.join('my-app', inviteKey)
// Both devices now share the same data

// Identity
const { publicKey } = await window.pear.identity.getPublicKey()

// Direct P2P channel scoped to this app drive.
const channel = await window.pear.swarm.v1.join(null, {
  subtopic: 'rooms/lobby',
  appName: 'Pear Chat',
  reason: 'Find peers in this room.'
})
channel.on('message', (peer, data) => {
  console.log(peer.id, new TextDecoder().decode(data))
})
```

Data syncs automatically between all devices in the same sync group via Autobase. Reads are always local (zero latency). Writes replicate to peers in the background.

## Building and Publishing Apps

### 1. Create your app

Any web app works — HTML, CSS, JavaScript. Add a `manifest.json`:

```json
{
  "name": "My App",
  "version": "1.0.0",
  "description": "What my app does",
  "author": "your-name",
  "entry": "/index.html",
  "categories": ["utilities"]
}
```

### 2. Publish as a Hyperdrive

```bash
node tools/publish-app.js ./my-app --name "My App"
# Output: Key: abc123... — your drive key
```

This writes your app (including `manifest.json`) into a Hyperdrive and prints its drive key. Keep a copy of the app available (the publish process, another peer, or a relay seed) so the drive can replicate.

### 3. Get it seeded into a relay catalog

A relay operator adds your app to a catalog by **seeding its drive key**:

- From the **relay dashboard** — Seeding Registry / the seeding wizard (`wizard.html`), or
- Via an authenticated **`POST /seed`** (Bearer token) with the drive key (plus optional metadata).

The relay then **eager-replicates the drive and reads its `/manifest.json`** to build the catalog entry. If the drive has no manifest, it shows up as **"Unknown App"** — so always ship one. Once indexed, your app appears in that relay's `GET /catalog.json`.

### 4. Users install and run

No configuration needed. Users open PearBrowser → Apps tab (pointed at a relay that seeded your app) → see your app → tap Get → it loads via the relay gateway (`/v1/hyper/<driveKey>/…`) with a P2P fallback.

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Mobile UI | SwiftUI, Jetpack Compose, React Native compatibility shell | Native mobile app shells |
| P2P Engine | Bare Kit worklet | Runs Hyperswarm on mobile |
| Peer Discovery | HyperDHT | Distributed hash table |
| Connections | Hyperswarm + libudx | UDP hole-punching + encrypted streams |
| Data Sync | Autobase + Hyperbee | Multi-writer database with materialized views |
| Content Delivery | HiveRelay HTTP gateway | Instant app loading via CDN-like HTTP |
| App Storage | Hyperdrive | Versioned P2P filesystem |
| Native Addons | 18 XCFrameworks plus BareKit | Current native dependency bundle |
| IPC Protocol | Length-prefixed JSON | Communication between native shells and worklet |

## Setup

### Prerequisites

- Node.js >= 20
- Xcode >= 15 with iOS simulators
- CocoaPods: `brew install cocoapods`
- Java Runtime/JDK for Android Gradle builds
- bare-pack: `npm install -g bare-pack`

### Build & Run

```bash
git clone https://github.com/bigdestiny2/PearBrowser.git
cd PearBrowser

npm install --legacy-peer-deps

# Bundle the P2P engine for React Native shells
npm run bundle-all

# Bundle native shells
npm run bundle-all-native

# Typecheck, syntax-check backend files, and run the node test suite
npm test

# Generate the native iOS project
cd ios-native && xcodegen generate && cd ..

# Android native also requires app/libs/bare-kit.jar; see android-native/BUILD.md
```

## Project Structure

```
PearBrowser/
├── app/                          # React Native compatibility shell
│   ├── App.tsx                   # Root: worklet boot, tab navigation
│   ├── screens/                  # Home, Explore, Browse, MySites, SiteEditor, More
│   ├── components/               # AppCard, StatusDot
│   └── lib/                      # RPC client, bridge injection, theme, constants
├── ios-native/                   # SwiftUI + Bare Kit iOS shell
├── android-native/               # Jetpack Compose + Bare Kit Android shell
├── backend/                      # Bare worklet (P2P engine)
│   ├── index.js                  # Boots Hyperswarm, proxy, managers, bridge
│   ├── hyper-proxy.js            # Hybrid HTTP proxy (relay + P2P)
│   ├── relay-client.js           # HiveRelay HTTP client
│   ├── catalog-manager.js        # App catalog loading
│   ├── app-manager.js            # App install/launch lifecycle
│   ├── site-manager.js           # Site creation/publishing
│   ├── pear-bridge.js            # WebView bridge shim
│   ├── swarm-bridge.js           # window.pear.swarm.v1 backend
│   ├── swarm-grants.js           # Persistent arbitrary-topic grants
│   └── rpc.js                    # IPC protocol implementation
├── examples/
│   └── echo-peer/                # swarm.v1 join(null, { subtopic }) fixture
├── tools/                        # Developer tools
│   ├── publish-app.js            # Publish apps to the network
│   └── catalog-relay.js          # Run a catalog relay
├── docs/                         # Documentation
│   ├── ARCHITECTURE_AND_CAPABILITIES.md # Current system map
│   ├── RELEASE_EVIDENCE_2026-07-22.md # Historical July release evidence
│   ├── CURRENT_STATUS_AUDIT_2026-06-23.md # Historical status snapshot
│   ├── MOBILE_RELEASE_EVIDENCE_2026-06-23.md # Historical mobile evidence
│   ├── USER-FLOWS.md             # User journey diagrams
│   ├── USE-CASES.md              # Detailed use cases
│   └── DEVELOPER-GUIDE.md        # Full developer onboarding
└── test/                         # Test apps and infrastructure
```

## Documentation

- **[User Flows](docs/USER-FLOWS.md)** — Step-by-step journey diagrams for every feature
- **[Use Cases](docs/USE-CASES.md)** — Real-world scenarios (POS, publishing, marketplace, education)
- **[Developer Guide](docs/DEVELOPER-GUIDE.md)** — Build and publish your first P2P app
- **[Architecture and Capabilities](docs/ARCHITECTURE_AND_CAPABILITIES.md)** — Current mobile runtime map, catalogue model, bridge capabilities, native parity, and limits
- **[September Candidate Status](docs/PEARBROWSER_UPDATE_2026-09-26.md)** — Current draft PR tests, native checks, and open release gates
- **[Mobile Origin Isolation Gate](docs/MOBILE_ORIGIN_ISOLATION_GATE.md)** — Web origin and storage requirements for untrusted P2P pages
- **[July Release Evidence](docs/RELEASE_EVIDENCE_2026-07-22.md)** — Historical tests, audits, native builds, and production blockers
- **[June Status Audit](docs/CURRENT_STATUS_AUDIT_2026-06-23.md)** — Historical baseline retained for comparison
- **[Security Boundary Alignment](docs/SECURITY-BOUNDARY-ALIGNMENT-2026-06-23.md)** — Current mobile security boundary map and remaining caveats
- **[Desktop Parity Audit](docs/DESKTOP_PARITY_AUDIT_2026-05-19.md)** — Current feature gap analysis against pearbrowser-desktop
- **[Swarm v1 API](docs/SWARM-V1.md)** — Direct page-scoped Hyperswarm bridge design
- **[Headless htmx over streamx](examples/htmx-headless/)** — run htmx apps with no HTTP server; `XMLHttpRequest` rides a streamx stream
- **[Design Document](DESIGN.md)** — UX research, information architecture, color system
- **[Hybrid Architecture](HYBRID-ARCHITECTURE.md)** — Relay + P2P technical design
- **[App Catalog Design](APP-CATALOG-DESIGN.md)** — How the decentralized catalog works

## Related Projects

- **[HiveRelay](https://github.com/bigdestiny2/P2P-Hiverelay)** — The relay backbone powering the App Store
- **[Pear POS](https://github.com/bigdestiny2/pear-pos)** — P2P point-of-sale system (first app in the catalog)
- **[Holepunch](https://holepunch.to)** — The P2P stack (Hyperswarm, Hypercore, Bare)

## Acknowledgments

- **Dominic Cassidy** ([@Drache93](https://github.com/Drache93)) — the **XHR-over-streamx** pattern: hook `XMLHttpRequest` so htmx
  (and any XHR-based app) thinks it's talking to a server, when it's actually a
  streamx stream into the worklet / a peer / a Hyperdrive. It removes the HTTP
  "head" entirely — the server-less, streamx-everywhere shape our Holepunch
  alignment is built around — and lets PearBrowser apps run **headless**. See
  [`backend/xhr-streamx.js`](backend/xhr-streamx.js) and the
  [example](examples/htmx-headless/).

## License

MIT
