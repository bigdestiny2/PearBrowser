# Relay Catalog Population — Handoff Note

## Symptom

`GET https://relay-us.p2phiverelay.xyz/catalog.json` returns:

```json
{
  "version": 2,
  "name": "HiveRelay Content Catalog",
  "relayKey": "...",
  "apps": []
}
```

But the relay dashboard shows drives actively seeding (e.g. Pear POS `c8698b6a...`, Pear Bazaar, Pear Sanduq, Pear Rides). PearBrowser's Explore tab shows an empty directory.

## Root Cause

The catalog endpoint (`core/relay-node/api.js:201-267`) no longer reads seeded drive manifests on each request. Instead, it returns `this.node.appRegistry.catalog()` — which is only populated by:

1. **`_reseedFromRegistry()`** at boot (`core/relay-node/index.js:757-764`) — loads entries from `app-registry.json` and re-seeds them
2. **`seedApp(key, { ... })`** at runtime — adds to `appRegistry` via `appRegistry.set()` (`index.js:949`)

On the current production relay, `app-registry.json` is either missing or empty, so the registry boots with zero entries. Drives can still be seeded (Hypercore replication works), but they are invisible to `/catalog.json`.

## Fix Options (ranked by simplicity)

### A. Re-publish each app through the relay's publish endpoint (fastest)

For each of the four apps currently seeding, POST to the relay's `/v1/apps/publish` (or equivalent registry write endpoint — check `core/relay-node/api.js` for the exact route name in the current build). The payload must include `driveKey`, `id`, `name`, and `version`. This triggers `seedApp()` which both seeds AND registers.

### B. Manually construct `app-registry.json` and restart

Write a JSON file at the relay's `storage/app-registry.json` path with the four app entries:

```json
{
  "entries": [
    { "appKey": "c8698b6aaaa19b4dc9a7e5203897cae8ed1c0bab1de9383b55d78435aad9ddf2", "id": "pear-pos", "name": "Pear POS", "version": "2.0.2", "publishedAt": 1775752410559 },
    { "appKey": "82f6c68d296e8daa625b27e89e26a87fd295b2d8652d4d6b97b1236bcbb2028a", "id": "pear-bazaar", "name": "Pear Bazaar", "version": "1.0.0", "publishedAt": 1775764876745 },
    { "appKey": "d08478eb151138a292ea630952ee632ee3b4adea2ddc80f8638241d401f60272", "id": "pear-sanduq", "name": "Pear Sanduq", "version": "1.0.0", "publishedAt": 1775764876790 },
    { "appKey": "4a1e72d65a33477ddd41ac6858cae289d178bd33f5967219edbe972474b9d03d", "id": "pear-rides", "name": "Pear Rides", "version": "1.0.0", "publishedAt": 1775764876824 }
  ]
}
```

Restart the relay. `_reseedFromRegistry()` will pick them up and seed + register them.

### C. Automatic discovery from seeded drives (best long-term)

Implement a migration in `_migrateOldSeededApps()` or a new startup routine that:
1. Enumerates drives currently seeded by `seededApps`
2. For each drive, reads `manifest.json` if present
3. Calls `appRegistry.set()` to populate the registry

This makes the registry self-healing on upgrades.

## Verification

After the fix:

```bash
curl -s https://relay-us.p2phiverelay.xyz/catalog.json | jq '.apps | length'
# Should return 4 (or whatever number of apps you expect)

curl -s https://relay-us.p2phiverelay.xyz/catalog.json | jq '.apps[].id'
# Should list: "pear-pos", "pear-bazaar", "pear-sanduq", "pear-rides"
```

In PearBrowser → Explore tab:
- Should show "4 sites"
- Each card has a "Visit" button
- Tapping "Visit" on Pear POS opens `https://relay-us.p2phiverelay.xyz/v1/hyper/c8698b6a.../index.html` in Browse tab
- POS onboarding screen renders

## PearBrowser-Side Is Ready

The browser doesn't need any change — it reads `catalog.apps[]` and works correctly whether the array has 0, 1, or 100 items. The empty-state UI has been updated to clearly say "Directory is empty" when the relay returns `apps: []` vs "No directory connected" when nothing has been loaded yet.
