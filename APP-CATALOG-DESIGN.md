# Open Content Catalog — Mobile Design

PearBrowser Mobile opens static Hyperdrive content. Saving a catalogue entry
offline caches that content for later browsing; it does not install native
software. A signed Pear v3 AppRelease is desktop-only, and a legacy Pear v2
entry remains `migration-required` rather than becoming a mobile action.

## How It Works

```
Developer                          Catalog Relay                    PearBrowser
─────────                          ─────────────                    ───────────
1. Publish static content as Hyperdrive
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

                                                                    8. Displays entries in Catalog tab

                                                                    9. User taps "Open"
                                                                       → opens static content
                                                                         from a stable drive key

                                                                       User taps "Save offline"
                                                                       → caches that content
                                                                         for later browsing
```

## Content Manifest Format

Every openable content Hyperdrive must contain `/manifest.json`:

```json
{
  "name": "My P2P Site",
  "version": "1.0.0",
  "description": "A short description of the published content",
  "author": "developer-name",
  "icon": "/icon.png",
  "entry": "/index.html",
  "categories": ["utilities"],
  "permissions": []
}
```

## DHT Announcement

Content publishers announce on a well-known, legacy-named topic:

```javascript
const APP_ANNOUNCE_TOPIC = crypto_generichash('pearbrowser-apps-v1')

// Developer announces their content Hyperdrive
swarm.join(APP_ANNOUNCE_TOPIC, { server: true, client: false })
// When a catalog relay connects, send the app info via Protomux
```

## Catalog Relay

The catalog relay:
1. Joins `pearbrowser-apps-v1` as a client
2. When it discovers a new peer (content publisher), it reads their manifest
3. Validates the manifest (required fields, reasonable sizes)
4. Adds the content entry to its `catalog.json` Hyperdrive
5. Serves the catalog via HTTP gateway + P2P

## Catalog JSON Envelopes

PearBrowser normalizes relay catalog envelopes before rendering or checking
content updates. Preferred catalogs expose `apps[]`, current HiveRelay gateway
responses may expose `items[]`, and older registry exports may expose
`entries[]`.

Mobile-openable entries must resolve to a stable Hyperdrive key through
`driveKey`, `appKey`, `key`, or a safe `hyper://` content address. A signed
`nativeDelivery` record is displayed as **Desktop only** and requires its
AppRelease on desktop. A legacy `pear://` or `file://` record is retained only
as **Migration required** metadata; mobile never executes it.

## Mobile Actions

- **Open** — render static Hyperdrive content in the sandboxed browser.
- **Save offline** — cache that Hyperdrive content for later browsing.
- **Remove saved copy** — evict the cached copy without changing its publisher
  or catalogue record.
- **Desktop only** — show a signed Pear v3 native package without offering a
  mobile native action.
- **Migration required** — preserve a legacy Pear v2 record as non-executable
  metadata.

The backend RPC retains historical field and command names for protocol
compatibility. In mobile UI and product language those calls mean saving,
opening, listing, or removing cached Hyperdrive content only.

## Multiple Catalogs

- PearBrowser ships with one default catalog relay URL
- Users can add more in Settings
- Each catalog is independent — different relays may have different entries
- PearBrowser aggregates and deduplicates across all catalogs
- Catalog entries give users a stable place to open current static content and
  see native-delivery status without treating a content address as software
  authority.

## Moderation

For MVP: no moderation (everything gets listed).
Future: relay operators can set policies (blocklists, minimum reputation, etc.)
