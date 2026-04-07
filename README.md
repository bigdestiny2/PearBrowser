# PearBrowser

A peer-to-peer mobile app platform for iOS. Browse the decentralized web, discover P2P apps from a decentralized App Store, and build personal websites — all from your phone as a real peer in the Holepunch network.

**Live demo:** The Pear POS app is serving right now from HiveRelay:
```
https://relay.p2phiverelay.xyz/v1/hyper/4fd242fd4c90b77b354d6bcbd30654b732905cebf4b94bfefc0adbf97c171e04/index.html
```

## Why PearBrowser?

Traditional mobile apps depend on cloud servers. When the server goes down, the app stops working. When the company shuts down, your data disappears. When you're offline, you can't do anything.

PearBrowser flips this model. Apps run on your device and connect directly to other devices. Your data lives on your phone, syncs peer-to-peer, and is always available — even offline. No cloud server. No monthly fees. No single point of failure.

## Three Features

### 1. Decentralized App Store

PearBrowser has a built-in App Store, but it's not controlled by any single company. Here's how it works:

**Catalogs are hosted on HiveRelay nodes.** Each relay serves a `/catalog.json` endpoint that lists all the P2P apps it knows about. When a developer publishes an app, they seed it on one or more relays, and it automatically appears in the catalog.

**Anyone can run a catalog.** Relays are open source. You can run your own relay with your own curated selection of apps — for your company, your community, or the public. PearBrowser users add relay URLs in Settings to browse different catalogs.

**Apps load instantly.** When you tap "Open" on an app, PearBrowser loads it from the relay's HTTP gateway — not over slow P2P. The relay caches the app's files and serves them like a CDN. First load is under 2 seconds.

**No gatekeepers.** There's no review process, no 30% fee, no approval queue. Developers publish apps by creating a Hyperdrive and seeding it on a relay. Users discover apps by browsing catalogs from relays they trust.

**How apps get into the catalog:**
```
Developer                          HiveRelay                    PearBrowser
─────────                          ─────────                    ───────────
1. Build app (HTML/JS/CSS)
   + manifest.json

2. Publish as Hyperdrive
   node publish-app.js ./dist

3. Seed on relay                 → Relay replicates the drive
   POST /seed {"appKey":"..."}   → Reads manifest.json
                                 → Adds to /catalog.json         → User opens
                                                                    Apps tab
                                                                 → Sees the app
                                                                 → Taps "Get"
                                                                 → App loads
                                                                    instantly
```

### 2. P2P Browser

Browse `hyper://` content natively on your phone. Hyper links point to Hyperdrives — peer-to-peer filesystems that are distributed, versioned, and encrypted.

**Hybrid architecture:** PearBrowser uses two paths to fetch content simultaneously:

- **Fast path (HTTP):** Ask the nearest HiveRelay gateway. If the relay has the content cached, it responds in 1-2 seconds.
- **P2P path (Hyperswarm):** Connect directly to peers via the DHT. Takes 5-15 seconds for the first connection, but content is cached locally for instant future visits.

Whichever path responds first wins. The P2P path continues syncing in the background so subsequent navigations within the same site are instant from local cache.

**The phone is a real peer.** PearBrowser runs the full Hyperswarm stack via a Bare Kit worklet — a separate JavaScript runtime that handles all P2P networking. Your phone joins the HyperDHT, performs UDP hole-punching, and establishes direct encrypted connections to other peers. This is the same technology that powers [Keet](https://keet.io).

### 3. Website Builder

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
│  PearBrowser (iOS App)                       │
│                                              │
│  ┌──────────┬──────────┬────────┬─────────┐  │
│  │  Home    │  Apps    │ Browse │  More   │  │
│  │  Screen  │  Store   │  View  │  Menu   │  │
│  └──────────┴──────────┴────────┴─────────┘  │
│         │                  │                  │
│         │  React Native    │  WebView         │
│  ───────┼──────────────────┼───────────────── │
│         │  IPC (RPC)       │  window.pear     │
│  ┌──────▼──────────────────▼───────────────┐  │
│  │  Bare Worklet — P2P Engine              │  │
│  │                                         │  │
│  │  HyperProxy ─── relay HTTP (fast)       │  │
│  │       └──────── Hyperswarm P2P (backup) │  │
│  │                                         │  │
│  │  CatalogManager ── loads /catalog.json  │  │
│  │  AppManager ─────── install/launch apps │  │
│  │  SiteManager ────── create/publish sites│  │
│  │  PearBridge ─────── Autobase data sync  │  │
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

**Currently running:**
- `relay.p2phiverelay.xyz` — primary public relay
- 3 additional relays across different regions

## P2P App API

Apps running in PearBrowser get access to P2P features via an injected JavaScript bridge:

```javascript
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
# Output: Key: abc123... — keep this process running
```

### 3. Seed on a HiveRelay

```bash
curl -X POST https://relay.p2phiverelay.xyz/seed \
  -H 'Content-Type: application/json' \
  -d '{"appKey": "abc123..."}'
```

Your app now appears in the relay's catalog. PearBrowser users who browse that relay's App Store will see it.

### 4. Users install and run

No configuration needed. Users open PearBrowser → Apps tab → see your app → tap Get → it works.

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Mobile UI | React Native + Expo | Native iOS app shell |
| P2P Engine | Bare Kit worklet | Runs Hyperswarm on iOS |
| Peer Discovery | HyperDHT | Distributed hash table |
| Connections | Hyperswarm + libudx | UDP hole-punching + encrypted streams |
| Data Sync | Autobase + Hyperbee | Multi-writer database with materialized views |
| Content Delivery | HiveRelay HTTP gateway | Instant app loading via CDN-like HTTP |
| App Storage | Hyperdrive | Versioned P2P filesystem |
| Native Addons | 17 xcframeworks | sodium, udx, rocksdb, etc. statically linked |
| IPC Protocol | Length-prefixed JSON | Communication between RN and worklet |

## Setup

### Prerequisites

- Node.js >= 20
- Xcode >= 15 with iOS simulators
- CocoaPods: `brew install cocoapods`
- bare-pack: `npm install -g bare-pack`

### Build & Run

```bash
git clone https://github.com/bigdestiny2/PearBrowser.git
cd PearBrowser

npm install --legacy-peer-deps

# Bundle the P2P engine for iOS
bare-pack --linked --host ios-arm64 backend/index.js -o assets/backend.bundle.mjs

# Generate Xcode project
npx expo prebuild --platform ios --no-install

# Install native dependencies
cd ios && LANG=en_US.UTF-8 pod install && cd ..

# Run on simulator
npx expo run:ios --device "iPhone 17 Pro"
```

## Project Structure

```
PearBrowser/
├── app/                          # React Native UI
│   ├── App.tsx                   # Root: worklet boot, tab navigation
│   ├── screens/                  # Home, AppStore, Browse, MySites, SiteEditor, More
│   ├── components/               # AppCard, StatusDot
│   └── lib/                      # RPC client, bridge injection, theme, constants
├── backend/                      # Bare worklet (P2P engine)
│   ├── index.js                  # Boots Hyperswarm, proxy, managers, bridge
│   ├── hyper-proxy.js            # Hybrid HTTP proxy (relay + P2P)
│   ├── relay-client.js           # HiveRelay HTTP client
│   ├── catalog-manager.js        # App catalog loading
│   ├── app-manager.js            # App install/launch lifecycle
│   ├── site-manager.js           # Site creation/publishing
│   ├── pear-bridge.js            # Autobase sync for WebView apps
│   └── rpc.js                    # IPC protocol implementation
├── tools/                        # Developer tools
│   ├── publish-app.js            # Publish apps to the network
│   └── catalog-relay.js          # Run a catalog relay
├── docs/                         # Documentation
│   ├── USER-FLOWS.md             # User journey diagrams
│   ├── USE-CASES.md              # Detailed use cases
│   └── DEVELOPER-GUIDE.md        # Full developer onboarding
└── test/                         # Test apps and infrastructure
```

## Documentation

- **[User Flows](docs/USER-FLOWS.md)** — Step-by-step journey diagrams for every feature
- **[Use Cases](docs/USE-CASES.md)** — Real-world scenarios (POS, publishing, marketplace, education)
- **[Developer Guide](docs/DEVELOPER-GUIDE.md)** — Build and publish your first P2P app
- **[Design Document](DESIGN.md)** — UX research, information architecture, color system
- **[Hybrid Architecture](HYBRID-ARCHITECTURE.md)** — Relay + P2P technical design
- **[App Catalog Design](APP-CATALOG-DESIGN.md)** — How the decentralized catalog works

## Related Projects

- **[HiveRelay](https://github.com/bigdestiny2/P2P-Hiveswarm)** — The relay backbone powering the App Store
- **[Pear POS](https://github.com/bigdestiny2/pear-pos)** — P2P point-of-sale system (first app in the catalog)
- **[Holepunch](https://holepunch.to)** — The P2P stack (Hyperswarm, Hypercore, Bare)

## License

MIT
