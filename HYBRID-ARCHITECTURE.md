# PearBrowser Hybrid Architecture — P2P + HiveRelay

## The Strategy

```
Phone request for hyper://KEY/path
    │
    ├─── Fast path (HTTP): Ask HiveRelay gateway (1-2s)
    │    └─ If relay has it seeded → instant response
    │
    └─── P2P path (Hyperswarm): Connect to peers directly (5-15s)
         └─ Always runs in background, caches locally

Whichever responds first wins. Both paths run concurrently.
```

## How It Works

1. **User navigates to `hyper://KEY/path`**
2. **Two fetches fire simultaneously:**
   - HTTP fetch to the nearest HiveRelay gateway: `GET relay:9100/v1/hyper/KEY/path`
   - P2P fetch via Hyperswarm (existing flow)
3. **First response wins** — the proxy serves whichever arrives first
4. **P2P continues in background** — even if relay was faster, the P2P connection keeps syncing so future navigations within the same drive are instant from local cache

## What This Gives Us

| Scenario | Before (pure P2P) | After (hybrid) |
|---|---|---|
| First visit, relay has it | 5-15s | **1-2s** |
| First visit, relay doesn't have it | 5-15s | 5-15s (same) |
| Return visit (cached) | <1s | <1s (same) |
| Publisher offline, relay seeded | **Unreachable** | **Works via relay** |
| Publisher offline, not seeded | Unreachable | Unreachable |
| Site Builder publish | P2P only | **P2P + relay seeds it for 24/7 availability** |
| App Store catalog | P2P only | **Relay caches catalog for instant discovery** |

## Changes Needed

### 1. HiveRelay — Add HTTP Gateway Endpoint (~80 lines)

New endpoint in the relay API: `GET /v1/hyper/:key/*path`

- Looks up the drive key in `seededApps`
- If found, reads the file from the local Hyperdrive
- Returns with proper Content-Type
- If not seeded, returns 404 (phone falls back to P2P)

### 2. PearBrowser Backend — Add Hybrid Fetcher

New module `backend/relay-client.js`:
- Maintains a list of known relay HTTP endpoints
- On navigate, fires HTTP fetch to relay in parallel with P2P
- Returns whichever responds first
- Falls back gracefully if relay is down

### 3. Relay Discovery

PearBrowser needs to find relay HTTP endpoints. Options:
- **Hardcoded bootstrap**: ship with known relay URLs (like DNS seeds in Bitcoin)
- **DHT discovery**: find relays via `hiverelay-discovery-v1` topic, then query their HTTP port
- **Both**: hardcoded fallbacks + DHT discovery for production relays

For MVP: hardcode one relay URL (localhost for testing, or a public relay).
