# PearBrowser

A P2P mobile app platform for iOS. Browse the decentralized web, discover and run P2P apps, and build personal websites — all from your phone as a real peer in the Holepunch network.

## What Is PearBrowser?

PearBrowser is three things:

1. **App Store** — Discover, install, and run P2P apps from decentralized catalogs
2. **Website Builder** — Create and publish personal sites to `hyper://` from your phone
3. **P2P Browser** — Browse any `hyper://` content natively

Your phone is a real peer — it joins the HyperDHT, hole-punches through NAT, and connects directly to other peers. Content loads instantly via HiveRelay HTTP gateways with P2P sync in the background.

## Screenshots

| Home | App Store | Browse | Site Builder |
|------|-----------|--------|-------------|
| Welcome screen with search bar, app grid | Catalog with Calculator, Notes, Pear POS | P2P website rendering in WebView | Block editor with publish flow |

## Architecture

```
┌──────────────────────────────────────┐
│  React Native (iOS)                  │
│  Home │ App Store │ Browse │ More    │
├──────────────────────────────────────┤
│  IPC (length-prefixed JSON RPC)      │
├──────────────────────────────────────┤
│  Bare Worklet (P2P Engine)           │
│  ├── HyperProxy (hybrid HTTP proxy)  │
│  ├── RelayClient (HiveRelay HTTP)    │
│  ├── CatalogManager                  │
│  ├── AppManager                      │
│  ├── SiteManager                     │
│  ├── PearBridge (WebView ↔ Autobase) │
│  └── Hyperswarm + Corestore         │
└──────────────────────────────────────┘
```

### Hybrid Architecture

Content loads via two paths simultaneously:

- **Fast path**: HiveRelay HTTP gateway serves cached content instantly
- **P2P path**: Hyperswarm connects directly to peers in the background

Whichever responds first wins. After first load, content is cached locally.

```
Navigate to hyper://KEY
  ├── HTTP → HiveRelay gateway (1-2s) → instant
  └── P2P → Hyperswarm DHT (5-15s) → cached for next time
```

## Features

### Completed (v0.1.0)

- [x] **P2P Browser** — browse `hyper://` content in WebView
- [x] **Hybrid fetch** — relay HTTP fast-path + P2P fallback
- [x] **App Store** — load catalogs from HTTP or hyper://, display apps with Get/Open
- [x] **App launching** — serve app frontends from relay gateway (instant)
- [x] **Site Builder** — create sites, block editor (6 types), publish to Hyperdrive
- [x] **My Sites** — list, edit, publish, share, delete sites
- [x] **Pear Bridge** — `window.pear` + `window.posAPI` injected into WebViews
- [x] **Autobase sync** — POS-compatible apply function for multi-device data sync
- [x] **Status indicator** — green/yellow/red dot with peer count
- [x] **4-tab navigation** — Home, Apps, Browse, More
- [x] **Bottom URL bar** — truncated display, auto hyper:// prefix
- [x] **App persistence** — installed apps survive restarts
- [x] **Site persistence** — published sites survive restarts
- [x] **17 native addons** — sodium, udx, rocksdb, etc. statically linked
- [x] **Pear POS integration** — loads and runs in PearBrowser with data sync bridge

### Planned (v0.2.0+)

- [ ] QR code scanning for hyper:// keys
- [ ] Bookmarks + history persistence
- [ ] Tab management (card-based switcher)
- [ ] Petnames (local aliases for hex keys)
- [ ] Deep link handling (`pearbrowser://hyper/KEY`)
- [ ] Share sheet integration
- [ ] HiveCompute LLM integration
- [ ] Android support
- [ ] Offline-first with local app caching
- [ ] App update notifications
- [ ] Community voting / app ratings

## App Store

### How It Works

The App Store is a decentralized catalog system. Anyone can run a catalog, and anyone can publish apps.

**For app developers:**

```bash
# 1. Create your app (must have index.html + manifest.json)
mkdir my-app
echo '<html><body><h1>My App</h1></body></html>' > my-app/index.html
echo '{"name":"My App","version":"1.0.0","description":"...","entry":"/index.html"}' > my-app/manifest.json

# 2. Publish as a Hyperdrive
node tools/publish-app.js ./my-app --name "My App"
# Output: Key: abc123...

# 3. Seed on a HiveRelay for instant delivery
curl -X POST http://your-relay:9100/seed -d '{"appKey":"abc123..."}'
```

**For relay operators:**

Your relay automatically serves a catalog at `GET /catalog.json` built from all seeded drives that contain a `manifest.json`. No manual catalog management needed.

**For users:**

1. Open PearBrowser → Apps tab
2. Enter a relay URL (e.g., `http://relay.example.com:9100`)
3. Browse available apps
4. Tap "Get" to install, "Open" to launch
5. Apps load instantly from the relay HTTP gateway

### Manifest Format

Every app must include `/manifest.json` in its Hyperdrive:

```json
{
  "name": "My App",
  "version": "1.0.0",
  "description": "What the app does",
  "author": "your-name",
  "entry": "/index.html",
  "categories": ["utilities"],
  "permissions": []
}
```

### P2P App API

Apps running in PearBrowser's WebView get access to P2P APIs via an injected bridge:

```javascript
// Generic P2P API
window.pear.sync.create('my-app')         // Create sync group
window.pear.sync.join('my-app', inviteKey) // Join existing group
window.pear.sync.append('my-app', { type: 'item:create', data: {...} })
window.pear.sync.list('my-app', 'items!')  // Query data
window.pear.identity.getPublicKey()        // Device identity

// POS-specific API (for Pear POS compatibility)
window.posAPI.createProduct({ name: 'Widget', price_cents: 999 })
window.posAPI.listProducts()
window.posAPI.createTransaction(items, 'card')
window.posAPI.getSyncStatus()
```

Data syncs across devices via Autobase over Hyperswarm.

## Setup

### Prerequisites

- **Node.js** >= 20
- **Xcode** >= 15 (with iOS simulators)
- **CocoaPods**: `brew install cocoapods`
- **bare-pack**: `npm install -g bare-pack`

### Build & Run

```bash
# Install dependencies
npm install --legacy-peer-deps

# Bundle the worklet backend for iOS
bare-pack --linked --host ios-arm64 backend/index.js -o assets/backend.bundle.mjs

# Generate Xcode project
npx expo prebuild --platform ios --no-install

# Install CocoaPods
cd ios && LANG=en_US.UTF-8 pod install && cd ..

# Run on simulator
npx expo run:ios --device "iPhone 17 Pro"
```

### Running Test Infrastructure

```bash
# Start a test Hyperdrive (content to browse)
node test/serve-test-drive.js

# Start the catalog relay with sample apps
node test/start-catalog-test.js

# Publish a custom app
node tools/publish-app.js ./my-app --name "My App"
```

## Project Structure

```
PearBrowser/
├── app/                          # React Native UI
│   ├── App.tsx                   # Root: worklet boot, tab navigation
│   ├── screens/
│   │   ├── HomeScreen.tsx        # Welcome, search, app grid
│   │   ├── AppStoreScreen.tsx    # Catalog browser, install/launch
│   │   ├── BrowseScreen.tsx      # WebView + bottom URL bar
│   │   ├── MySitesScreen.tsx     # Site list, create, publish
│   │   ├── SiteEditorScreen.tsx  # Block editor
│   │   └── MoreScreen.tsx        # Settings, status, navigation
│   ├── components/
│   │   ├── AppCard.tsx           # App listing card (small/large)
│   │   └── StatusDot.tsx         # P2P status indicator
│   └── lib/
│       ├── rpc.ts                # RPC client (length-prefixed JSON)
│       ├── bridge-inject.ts      # window.pear + window.posAPI bridge
│       ├── constants.ts          # RPC command/event IDs
│       └── theme.ts              # Color palette
├── backend/                      # Bare worklet (P2P engine)
│   ├── index.js                  # Entry: boots Hyperswarm, proxy, managers
│   ├── rpc.js                    # RPC server (length-prefixed JSON)
│   ├── hyper-proxy.js            # Hybrid HTTP proxy (relay + P2P)
│   ├── relay-client.js           # HiveRelay HTTP client (bare-http1)
│   ├── catalog-manager.js        # Load/search app catalogs
│   ├── app-manager.js            # Install/uninstall/launch apps
│   ├── site-manager.js           # Create/edit/publish sites
│   ├── pear-bridge.js            # Autobase sync for WebView apps
│   └── constants.js              # Shared RPC constants
├── tools/                        # Developer tools
│   ├── publish-app.js            # Publish app directory as Hyperdrive
│   └── catalog-relay.js          # Run an open app catalog relay
├── test/
│   ├── sample-apps/              # Calculator + Notes test apps
│   ├── serve-test-drive.js       # Serve test content on DHT
│   ├── create-catalog.js         # Create test catalog
│   └── start-catalog-test.js     # Full test environment
├── assets/
│   └── backend.bundle.mjs        # Bundled worklet (bare-pack output)
├── package.json
├── app.json                      # Expo config
└── tsconfig.json
```

## Technical Details

### Why Bare Kit (not Node.js)?

Mobile devices can't run Node.js. Bare is a minimal JS runtime from Holepunch that:
- Runs on iOS (JavaScriptCore) and Android
- Has explicit suspend/resume for mobile lifecycle
- Supports native addons via static linking
- Powers Keet (Holepunch's P2P messaging app)

### RPC Protocol

Communication between React Native and the Bare worklet uses a custom length-prefixed JSON protocol:

```
[8-byte hex length][JSON payload]
00000023{"event":100,"data":{"port":50380}}
```

- Requests: `{ id, cmd, data }` → replies with `{ id, result }` or `{ id, error }`
- Events: `{ event, data }` (fire-and-forget, worklet → RN)

### Native Addons (17 linked)

```
bare-crypto, bare-dns, bare-fs, bare-inspect, bare-os, bare-pipe,
bare-subprocess, bare-tcp, bare-type, bare-url, fs-native-extensions,
quickbit-native, rabin-native, rocksdb-native, simdle-native,
sodium-native, udx-native
```

## Related Projects

- **[HiveRelay](https://github.com/bigdestiny2/P2P-Hiveswarm)** — P2P relay backbone (storage, seeding, gateway)
- **[HiveCompute](https://github.com/bigdestiny2/P2P-Hiveswarm)** — Decentralized AI inference network
- **[Pear POS](../pear-pos/)** — P2P point-of-sale system
- **[Holepunch](https://holepunch.to)** — The P2P stack (Hyperswarm, Hypercore, Bare)
- **[Peersky](https://github.com/p2plabsxyz/peersky-browser)** — Desktop P2P browser (inspiration)

## License

MIT
