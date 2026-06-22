# Open App Catalog — Design

## How It Works

```
Developer                          Catalog Relay                    PearBrowser
─────────                          ─────────────                    ───────────
1. Build app as Hyperdrive
   (HTML/CSS/JS + manifest.json)

2. Announce on DHT topic
   "pearbrowser-apps-v1"           3. Discovers announcement
   with { driveKey, name }            via DHT listener

                                   4. Fetches manifest.json
                                      from the app's drive

                                   5. Validates manifest
                                      (has name, index.html, etc.)

                                   6. Adds to catalog.json
                                      in the catalog Hyperdrive
                                                                    7. Fetches catalog.json
                                                                       from relay (HTTP fast-path)
                                                                       or P2P

                                                                    8. Displays apps in Store tab

                                                                    9. User taps "Get/Open"
                                                                       → launches current app
                                                                         from stable drive/link
```

## App Manifest Format

Every app Hyperdrive must contain `/manifest.json`:

```json
{
  "name": "My P2P App",
  "version": "1.0.0",
  "description": "A short description of what the app does",
  "author": "developer-name",
  "icon": "/icon.png",
  "entry": "/index.html",
  "categories": ["utilities"],
  "permissions": []
}
```

## DHT Announcement

Apps announce on a well-known topic:

```javascript
const APP_ANNOUNCE_TOPIC = crypto_generichash('pearbrowser-apps-v1')

// Developer announces their app
swarm.join(APP_ANNOUNCE_TOPIC, { server: true, client: false })
// When a catalog relay connects, send the app info via Protomux
```

## Catalog Relay

The catalog relay:
1. Joins `pearbrowser-apps-v1` as a client
2. When it discovers a new peer (app publisher), it reads their manifest
3. Validates the manifest (required fields, reasonable sizes)
4. Adds the app to its `catalog.json` Hyperdrive
5. Serves the catalog via HTTP gateway + P2P

## Catalog JSON Envelopes

PearBrowser normalizes relay catalog envelopes before rendering or checking app
updates. Preferred catalogs expose `apps[]`, current HiveRelay gateway responses
may expose `items[]`, and older registry exports may expose `entries[]`. Entries
should include one stable drive key field: `driveKey`, `appKey`, `key`, or a
safe `hyper://`, `pear://`, or `file://` launch link.

## Multiple Catalogs

- PearBrowser ships with one default catalog relay URL
- Users can add more in Settings
- Each catalog is independent — different relays may have different apps
- PearBrowser aggregates and deduplicates across all catalogs
- Catalog entries give users a stable place to run the current app, so they do
  not need to rediscover a project URL, download a bundle, or apply updates by
  hand.

## Moderation

For MVP: no moderation (everything gets listed).
Future: relay operators can set policies (blocklists, minimum reputation, etc.)
