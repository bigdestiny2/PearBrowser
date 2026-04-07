# PearBrowser Use Cases

PearBrowser is a P2P mobile app platform for iOS. It enables users to browse `hyper://` content, discover peer-to-peer apps from decentralized catalogs, and build personal websites -- all from their phone as a real peer in the Holepunch network.

This document describes practical use cases that demonstrate why PearBrowser matters and how its technology stack solves real problems that centralized approaches cannot.

**Core technology referenced throughout:**

- **Bare Kit worklet** -- Native runtime executing Hyperswarm and Hypercore directly on iOS
- **Hyperswarm** -- Distributed networking layer for peer discovery and connections
- **Hypercore / Hyperdrive** -- Append-only logs and file systems for P2P data
- **Autobase** -- Multi-writer data structure enabling multi-device sync without a central server
- **HiveRelay** -- HTTP gateway nodes that seed content for availability when peers are offline
- **`window.pear`** -- JavaScript bridge exposing P2P primitives to WebView-based apps

---

## Table of Contents

1. [Small Business Point of Sale](#1-small-business-point-of-sale)
2. [Personal Website Publishing](#2-personal-website-publishing)
3. [Community App Distribution](#3-community-app-distribution)
4. [Offline-First Field Data Collection](#4-offline-first-field-data-collection)
5. [Censorship-Resistant Publishing](#5-censorship-resistant-publishing)
6. [P2P Marketplace](#6-p2p-marketplace)
7. [Education Platform](#7-education-platform)

---

## 1. Small Business Point of Sale

### Summary

A coffee shop runs its entire point-of-sale system through a Pear POS app loaded in PearBrowser. Multiple iPads at the counter and kitchen sync inventory, orders, and transaction records via Autobase -- no cloud subscription, no vendor lock-in, and full operation even when the internet goes down.

### Actors

| Actor | Role |
|---|---|
| **Shop owner** | Installs and configures Pear POS on all devices |
| **Baristas** | Ring up orders, mark items complete |
| **Kitchen staff** | View incoming orders on a kitchen display iPad |
| **HiveRelay node** | Seeds transaction data for off-site backup and availability |

### Preconditions

- Two or more iPads running PearBrowser with the Pear POS app installed
- All devices connected to the shop's local network (Wi-Fi or LAN)
- A HiveRelay node configured for the shop's Autobase (optional but recommended for backup)
- Initial product catalog entered by the shop owner

### Step-by-Step Flow

1. **Setup.** The shop owner opens PearBrowser on the primary iPad and launches the Pear POS app. The app generates a new Autobase with the owner's device as the first writer. The owner adds menu items, prices, tax rates, and categories.

2. **Device enrollment.** On each additional iPad, the owner opens PearBrowser and navigates to the Pear POS app. The primary device displays a pairing QR code. Each new device scans the code to receive the Autobase discovery key and is added as an authorized writer.

3. **Order entry.** A barista taps items on the touchscreen to build an order. The order is written to the local Autobase as a new entry with a timestamp, item list, and total. The Autobase linearizes the entry and replicates it to all connected peers within milliseconds over the local Hyperswarm.

4. **Kitchen display.** The kitchen iPad runs the same Pear POS app in "kitchen view" mode. New orders appear in real time as the Autobase replicates. Kitchen staff mark items as "in progress" or "complete," and those status updates propagate back to the counter iPads.

5. **Inventory tracking.** Each sale automatically decrements inventory counts in the Autobase. When a product drops below a configured threshold, the app displays a low-stock alert on all devices simultaneously.

6. **End of day.** The owner opens the reporting view. All transaction data is already aggregated locally from the Autobase. Daily totals, item breakdowns, and peak hours are computed on-device. No server round-trip required.

7. **Off-site backup.** Throughout the day, the HiveRelay node replicates the Autobase over the internet. Even if a disaster destroys all in-store devices, the transaction history is recoverable from the relay.

8. **Internet outage resilience.** If the shop's internet drops, all iPads continue operating normally. Hyperswarm discovers peers on the local network via mDNS. Orders, inventory updates, and kitchen communication continue without interruption. When internet returns, the HiveRelay resumes syncing automatically.

### How P2P Technology Is Used

- **Autobase** provides the multi-writer database. Each iPad writes independently to its own Hypercore, and Autobase linearizes all writes into a single consistent view. Conflict resolution is deterministic -- all devices converge to the same state.
- **Hyperswarm** handles peer discovery. On the local network it uses mDNS, so devices find each other without any cloud coordination. Over the internet it uses the Hyperswarm DHT to connect to the HiveRelay.
- **HiveRelay** acts as a persistent peer. It replicates the Autobase continuously, providing both off-site backup and data availability if the owner wants to check reports from home.
- **`window.pear`** exposes Autobase read/write operations to the Pear POS web app running inside PearBrowser's WebView.

### Benefits over Traditional Approach

| Traditional Cloud POS | Pear POS via PearBrowser |
|---|---|
| Monthly SaaS subscription ($50-200/mo) | No recurring fees after setup |
| Requires constant internet for core functions | Fully operational on LAN without internet |
| Vendor controls your data; export is often limited | Shop owner has full custody of all data |
| Single point of failure (vendor server) | No single point of failure; data lives on every device |
| Vendor can change pricing, features, or shut down | Open-source app; shop owner controls updates |
| Data latency to/from cloud on every transaction | Sub-millisecond local sync between devices |

### Current Limitations / Future Improvements

- **Payment processing.** Pear POS currently handles order management and inventory but does not directly integrate with card payment terminals. Near-term: integrate with local card readers via Bluetooth or direct IP connection, keeping payment flow off the cloud where possible.
- **Receipt printing.** Printing requires either AirPrint-compatible printers or a future native bridge extension. PearBrowser does not yet expose printer APIs through `window.pear`.
- **Scale.** Autobase performs well with 5-10 writers. Shops with dozens of terminals would need performance testing. Future Autobase optimizations and sharding strategies will extend this limit.
- **Reporting exports.** Currently limited to on-screen reports. CSV/PDF export is a planned feature for the Pear POS app.
- **Multi-location.** Each location operates as an independent Autobase. Cross-location aggregation (e.g., for franchise reporting) would require a higher-level sync mechanism, which is on the roadmap.

---

## 2. Personal Website Publishing

### Summary

A creator builds a personal website using PearBrowser's built-in Site Builder, publishes it to the `hyper://` network, and seeds it via HiveRelay for around-the-clock availability. Visitors can access the site through any Holepunch-compatible browser or via an HTTP gateway. The creator shares the link as a QR code, and all content updates propagate automatically to every peer.

### Actors

| Actor | Role |
|---|---|
| **Creator** | Builds and publishes the site |
| **HiveRelay node** | Seeds the site for 24/7 availability |
| **Visitors** | Browse the site via PearBrowser or an HTTP gateway |

### Preconditions

- PearBrowser installed on the creator's iPhone or iPad
- A HiveRelay node available for persistent seeding (self-hosted or community-provided)
- Basic familiarity with the Site Builder interface

### Step-by-Step Flow

1. **Create site.** The creator opens PearBrowser and launches the Site Builder. They choose a template or start from a blank page. The builder provides a visual editor for adding text, images, and layout blocks.

2. **Edit content.** The creator writes their bio, adds a profile photo, and creates additional pages (portfolio, blog, contact). All content is stored locally in a Hyperdrive -- an append-only file system built on Hypercore.

3. **Preview.** The creator taps "Preview" to see their site rendered in PearBrowser's WebView exactly as visitors will see it. They iterate on layout and content.

4. **Publish.** The creator taps "Publish." PearBrowser writes all site files to the Hyperdrive and begins announcing the site's discovery key on the Hyperswarm DHT. The site is now live at `hyper://<public-key>/`.

5. **Configure HiveRelay seeding.** The creator adds their HiveRelay node as a persistent seeder. PearBrowser sends the Hyperdrive key to the relay, which begins replicating and re-announcing the site. The site is now available even when the creator's phone is asleep or offline.

6. **Share.** The creator generates a QR code from the `hyper://` URL. They print it on business cards, post it on social media, or embed it in an email signature. Recipients scan the QR code with PearBrowser to load the site directly from the P2P network.

7. **Update.** When the creator edits a page and publishes again, the Hyperdrive appends new versions. All peers (including the HiveRelay) automatically receive the update. Visitors see the latest version on their next load. Previous versions remain in the append-only log if needed.

8. **Custom domain (optional).** The creator configures their HiveRelay to serve the site over HTTP at a custom domain (e.g., `https://alice.example.com`). This gives non-P2P visitors a traditional URL while the content still originates from the Hyperdrive.

### How P2P Technology Is Used

- **Hyperdrive** stores the website as a set of files (HTML, CSS, images) in an append-only structure. Each update creates a new version without overwriting history.
- **Hyperswarm DHT** enables peer discovery. When a visitor opens the `hyper://` URL, their client queries the DHT to find peers seeding that Hyperdrive, then connects directly to download the files.
- **HiveRelay** acts as an always-on peer. It replicates the Hyperdrive and responds to DHT lookups, ensuring the site loads even when the creator's device is offline.
- **`window.pear`** provides the Site Builder app with APIs to create Hyperdrives, write files, and manage seeding configuration.

### Benefits over Traditional Approach

| Traditional Web Hosting | PearBrowser Site Publishing |
|---|---|
| Monthly hosting fees ($5-30/mo) | Free to publish; optional relay costs are minimal |
| Domain registration required | `hyper://` URL is free and permanent |
| Content stored on a company's servers | Creator retains full data ownership |
| Server can go down; single point of failure | Content distributed across all peers who access it |
| Platform can censor or remove content | No central authority can remove a `hyper://` site |
| Requires technical knowledge (FTP, DNS, etc.) | Visual editor on a phone; tap to publish |
| Updates require deploy pipelines or FTP uploads | Edit and publish in one step; propagation is automatic |

### Current Limitations / Future Improvements

- **Discovery.** `hyper://` URLs are long public keys, not human-readable. Future: integrate with decentralized naming systems (e.g., Hypercore-based DNS alternatives) to support short, memorable names.
- **SEO.** Search engines do not crawl `hyper://` URLs. The HTTP gateway via HiveRelay mitigates this, but native P2P search indexing remains an open problem.
- **Media optimization.** The Site Builder does not yet auto-compress images or generate responsive variants. Large image files increase Hyperdrive size and slow initial sync.
- **Collaborative editing.** Currently single-author only. Autobase-backed multi-author sites are technically feasible and planned for a future release.
- **Analytics.** No built-in visitor analytics. A privacy-respecting analytics module that counts peer connections (without tracking individuals) is under consideration.

---

## 3. Community App Distribution

### Summary

A developer collective operates a catalog relay -- a decentralized app directory that appears in PearBrowser's App Store. Members of the collective publish apps to the catalog. Community members review and curate submissions. PearBrowser users discover, browse, and install apps without relying on Apple's App Store or any centralized gatekeeper.

### Actors

| Actor | Role |
|---|---|
| **Collective admins** | Operate the catalog relay and manage membership |
| **App developers** | Build and publish P2P apps to the catalog |
| **Community reviewers** | Test apps and submit reviews to the catalog |
| **End users** | Discover and install apps through PearBrowser |
| **Catalog relay** | Hypercore-based index that PearBrowser reads for app listings |

### Preconditions

- A catalog relay is running and seeding an Autobase containing app listings and metadata
- PearBrowser is configured to follow at least one catalog relay (can follow multiple)
- App developers have PearBrowser or Pear CLI tools for publishing

### Step-by-Step Flow

1. **Catalog setup.** The collective admins initialize a catalog relay -- an Autobase that stores app metadata (name, description, version, Hyperdrive key, screenshots, author public key). The relay announces itself on the Hyperswarm DHT.

2. **Developer registration.** A developer wanting to publish generates a keypair and submits their public key to the collective. Admins add the developer as an authorized writer on the catalog Autobase.

3. **App development.** The developer builds their app as a standard web application (HTML/CSS/JS) that uses `window.pear` for P2P capabilities. They test it locally in PearBrowser's developer mode.

4. **Publishing.** The developer packages the app into a Hyperdrive and writes a catalog entry to the Autobase: app name, version, description, category, the Hyperdrive's public key, and a signature proving authorship. The entry replicates to all catalog relay peers.

5. **Community review.** Reviewers browse new submissions in the catalog. They install the app, test it, and write a review entry to the Autobase. Reviews include a rating, text commentary, and the reviewer's public key for accountability. The collective's review policy (e.g., "two positive reviews required before featuring") is enforced by the catalog UI.

6. **Discovery.** An end user opens PearBrowser's App Store tab. PearBrowser reads the catalog Autobase and displays available apps organized by category, recency, and review score. The user searches for "budget tracker" and finds three options.

7. **Installation.** The user taps "Install" on their chosen app. PearBrowser resolves the app's Hyperdrive key, connects to peers seeding it (including the catalog relay), and downloads the app files. The app is now available locally in PearBrowser's app drawer.

8. **Updates.** When the developer publishes a new version (new Hyperdrive entry in the catalog), PearBrowser detects the update and prompts the user. The user taps "Update" and the new version is downloaded from the swarm.

9. **Multiple catalogs.** The user subscribes to a second catalog relay run by a different community. Both catalogs appear in the App Store tab. Apps from different catalogs are clearly labeled with their source.

### How P2P Technology Is Used

- **Autobase** serves as the catalog database. Multiple authorized writers (developers, reviewers, admins) contribute entries. Autobase linearizes all writes so every PearBrowser client sees the same catalog state.
- **Hyperdrive** stores each app's files. Apps are distributed as self-contained Hyperdrives that PearBrowser downloads and runs in a sandboxed WebView.
- **Hyperswarm** enables peer discovery for both the catalog Autobase and individual app Hyperdrives. No central download server is needed.
- **Public key cryptography** provides identity and integrity. Each developer signs their catalog entries. Users can verify that an app was published by the claimed author. Catalog admins control write access by managing the Autobase's writer set.

### Benefits over Traditional Approach

| Centralized App Store | PearBrowser Community Catalogs |
|---|---|
| Single gatekeeper (Apple/Google) controls distribution | Any community can operate a catalog |
| 15-30% platform fee on paid apps | No platform fees; direct developer-to-user distribution |
| Opaque review process; weeks-long delays | Community-driven review; transparent and fast |
| Apps can be removed by the platform at any time | No central authority can remove a published app |
| Developer accounts cost $99/year (Apple) | Free to publish; only requires a keypair |
| Geographic and content restrictions | No geographic or political content restrictions |
| Users locked into one store per platform | Users can follow multiple catalogs simultaneously |

### Current Limitations / Future Improvements

- **Security sandboxing.** PearBrowser apps run in a WebView with access to `window.pear`. The sandboxing model needs hardening to prevent malicious apps from abusing P2P APIs (e.g., exfiltrating data over Hyperswarm). Planned: a capability-based permission model where users grant specific permissions per app.
- **Trust bootstrapping.** Users must decide which catalogs to trust. Future: a "web of trust" model where catalogs can endorse each other, and users see trust scores based on their social graph.
- **App size.** Large apps (10+ MB) take time to download from the swarm, especially if few peers are seeding. HiveRelay helps but is not a full CDN. Future: chunked lazy-loading of app assets.
- **Monetization.** No built-in payment mechanism for paid apps. Developers must use external payment systems. Future: integrate with P2P payment protocols.
- **Version rollback.** Users cannot currently roll back to a previous app version. Since Hyperdrives are append-only, the history exists -- the UI just needs to expose it.

---

## 4. Offline-First Field Data Collection

### Summary

Field workers (agricultural surveyors, humanitarian aid workers, wildlife researchers) use a data collection app in PearBrowser to record observations, photos, and GPS coordinates while working in areas with no internet connectivity. Data is stored locally in an Autobase on each device. When workers return to a location with connectivity, all collected data syncs automatically with the home office, merging seamlessly with data from other field workers.

### Actors

| Actor | Role |
|---|---|
| **Project coordinator** | Sets up the data collection app and Autobase; reviews incoming data |
| **Field workers** | Collect data on-site using PearBrowser on their iPhones/iPads |
| **Home office server** | A persistent peer (laptop or HiveRelay) that aggregates all field data |
| **HiveRelay node** | Provides always-on availability for the aggregated dataset |

### Preconditions

- PearBrowser installed on all field worker devices
- A data collection app configured for the specific project (custom forms, data fields, validation rules)
- An Autobase initialized with all field worker devices added as authorized writers
- A home office peer or HiveRelay node running and connected to the internet

### Step-by-Step Flow

1. **Project setup.** The coordinator creates a new data collection project in the app. This initializes an Autobase and defines the data schema: required fields (species name, GPS coordinates, photo, timestamp, notes), validation rules (GPS must be within project area), and form layout.

2. **Device provisioning.** Each field worker's device is added as a writer to the Autobase. The coordinator generates pairing QR codes at the office where all devices are on the same network. Workers scan the codes, and their devices replicate the project schema and any existing data.

3. **Field collection.** Workers travel to remote sites. They open PearBrowser, launch the data collection app, and begin recording observations. Each entry is written to the local Autobase on their device. GPS coordinates are captured automatically. Photos are taken through the app and stored as blobs in the local Hyperdrive. The app works entirely offline -- no network connection is attempted or required.

4. **Local peer sync (optional).** If two field workers are at the same site, their devices can discover each other via Bluetooth or local Wi-Fi hotspot. Hyperswarm's local discovery connects them, and their Autobases sync. Each worker immediately sees the other's collected data, preventing duplicate observations.

5. **Return to connectivity.** When a worker returns to base camp or a town with internet, their device's Hyperswarm reconnects to the DHT and finds the home office peer. The Autobase replicates all locally collected entries to the home office. This happens automatically in the background while PearBrowser is open.

6. **Data aggregation.** The home office server runs a persistent peer that merges all field workers' Autobase entries into a single linearized view. The coordinator opens the data collection app on their device and sees all observations from all workers, sorted chronologically and deduplicated.

7. **Quality review.** The coordinator reviews entries, flags any that need clarification, and marks them with review status. These status updates replicate back to the field workers' devices on their next sync.

8. **Export.** The coordinator exports the aggregated dataset as CSV or GeoJSON for analysis in GIS software or statistical tools.

### How P2P Technology Is Used

- **Autobase** is the core data store. Each field worker's device maintains its own Hypercore of entries. Autobase merges all cores into a single deterministic view. There is no "master" copy -- every device has the full dataset after sync.
- **Hyperswarm** handles connectivity. In the field, it discovers local peers via mDNS and Bluetooth. On the internet, it uses the DHT to find the home office server and HiveRelay. The app does not need to know or care which transport is active.
- **Hyperdrive** stores binary attachments (photos, audio recordings) alongside the structured data entries. Each attachment is content-addressed and deduplicated.
- **HiveRelay** provides a persistent sync target. Even if the home office laptop is shut down, the relay keeps the Autobase available for incoming syncs.

### Benefits over Traditional Approach

| Traditional Field Data Collection | PearBrowser P2P Collection |
|---|---|
| Paper forms later digitized (error-prone) or apps requiring mobile data | Digital collection works fully offline |
| Data lives on individual devices until manual upload | Automatic sync when connectivity is available |
| Central server required; single point of failure | No central server; data on every device |
| Sync conflicts require manual resolution | Autobase provides deterministic conflict resolution |
| Proprietary platforms with per-seat licensing | Open-source; no licensing fees |
| Data locked in vendor's cloud | Full data custody; export anytime |
| No local peer sync; workers duplicate observations | Workers at the same site sync in real time over LAN |

### Current Limitations / Future Improvements

- **Storage limits.** iOS imposes storage limits on apps. Large projects with thousands of high-resolution photos may hit these limits. Future: configurable photo compression and selective sync (metadata first, full images on demand).
- **Bluetooth connectivity.** Hyperswarm's Bluetooth transport on iOS is experimental. Reliable local sync currently requires a Wi-Fi hotspot. Full Bluetooth Hyperswarm support is in active development.
- **Form builder.** The data collection app currently requires developer involvement to define custom forms. A visual form builder (similar to ODK Build) is planned so coordinators can design forms themselves.
- **Offline maps.** The app does not yet support offline map tiles for location reference. Integration with a tile cache or vector tile system is planned.
- **Data validation.** Client-side validation exists, but server-side validation (e.g., "this GPS point is outside the project area") only runs when the coordinator reviews synced data. Future: validation rules that run locally on each device at entry time.

---

## 5. Censorship-Resistant Publishing

### Summary

A journalist operating in a country with heavy internet censorship publishes investigative articles to the `hyper://` network. Content is seeded by HiveRelay nodes distributed across multiple countries. There is no single server to seize, no domain to block, and no hosting provider to pressure. PearBrowser users worldwide can access the content directly from the swarm, and each reader who accesses the content becomes an additional seeder.

### Actors

| Actor | Role |
|---|---|
| **Journalist** | Authors and publishes articles |
| **HiveRelay operators** | Volunteers or organizations running relay nodes in multiple jurisdictions |
| **Readers** | Access content via PearBrowser |
| **Censors** | Adversary attempting to suppress the content |

### Preconditions

- The journalist has PearBrowser installed on a device
- At least one HiveRelay node is running in a jurisdiction outside the censor's reach
- The journalist can establish an initial connection to the Hyperswarm DHT (possibly via a VPN or bridge for the initial publish)

### Step-by-Step Flow

1. **Content creation.** The journalist writes an article using PearBrowser's Site Builder or a dedicated publishing app. The article includes text, photographs, and source documents. All content is stored locally in a Hyperdrive.

2. **Publish.** The journalist publishes the Hyperdrive. PearBrowser announces the content on the Hyperswarm DHT. The journalist may use a VPN or Tor bridge for this initial announcement to avoid detection.

3. **Relay seeding.** Multiple HiveRelay nodes, operated by press freedom organizations in different countries, are pre-configured to replicate the journalist's Hyperdrive key. As soon as the content is announced, relays connect and begin downloading and re-seeding the full Hyperdrive.

4. **Distribution.** The journalist shares the `hyper://` URL through secure channels -- encrypted messaging apps, printed QR codes, or word of mouth. Each person who receives the URL can share it further.

5. **Reader access.** A reader opens PearBrowser and enters the `hyper://` URL. PearBrowser queries the Hyperswarm DHT to find peers seeding the Hyperdrive. It connects to the nearest available peer (a HiveRelay node or another reader who has the content) and downloads the article.

6. **Passive re-seeding.** By default, PearBrowser temporarily caches and re-seeds content that the reader has accessed. This means each reader becomes an additional seed, increasing the content's availability and resilience.

7. **Content updates.** When the journalist publishes a follow-up or correction, they update the Hyperdrive. The new version propagates through the relay network. Readers who revisit the URL receive the latest version automatically.

8. **Attempted censorship.** The censor may attempt to block known DHT bootstrap nodes or specific IP addresses. Countermeasures include: DHT bootstrap via alternative transports, relay nodes with rotating IP addresses, and the fact that any device that has the content can serve it to nearby peers over local networks.

### How P2P Technology Is Used

- **Hyperdrive** stores the published content with cryptographic integrity. Every block is signed by the journalist's keypair. Readers can verify that content has not been tampered with, even if it reaches them through multiple relay hops.
- **Hyperswarm DHT** provides censorship-resistant peer discovery. The DHT is distributed across thousands of nodes worldwide. Blocking individual nodes does not disable discovery because the DHT re-routes around missing nodes.
- **HiveRelay** nodes provide persistent seeding across jurisdictions. By distributing relays across countries with different legal frameworks, no single government action can take down all seeds.
- **Append-only structure** of Hypercore means published content cannot be retroactively altered. The journalist's keypair proves authorship, and the Hypercore's Merkle tree proves integrity.

### Benefits over Traditional Approach

| Traditional Web Publishing | PearBrowser Censorship-Resistant Publishing |
|---|---|
| Domain can be seized or DNS-blocked | No domain to seize; content addressed by public key |
| Hosting provider can be compelled to remove content | No hosting provider; content lives on the swarm |
| Server can be physically seized | No single server; content replicated across global peers |
| HTTPS certificate can be revoked | Cryptographic integrity built into the data structure |
| DDoS can take down a single server | Distributed seeding; more readers means more capacity |
| Journalist's identity tied to domain registration | Pseudonymous publishing via keypair |

### Current Limitations / Future Improvements

- **Initial connectivity.** The journalist must connect to the Hyperswarm DHT at least once to publish. In heavily restricted environments, even VPN access may be difficult. Future: support for publishing via sneakernet (USB drives or local file transfer) where a trusted intermediary carries the Hyperdrive to an internet-connected device.
- **Reader discovery.** Readers need to learn the `hyper://` URL through some channel. If all communication channels are monitored, distribution of the URL itself becomes the bottleneck. Future: integration with anonymous broadcast mechanisms.
- **Traffic analysis.** While content is encrypted in transit, an adversary monitoring network traffic can detect Hyperswarm DHT activity. Future: pluggable transports that disguise DHT traffic as ordinary HTTPS or other protocols.
- **Metadata.** The Hyperdrive key is public. Anyone monitoring the DHT can see which keys are being requested, even if they cannot read the content. Future: private Hyperswarm connections where the discovery key is derived from a secret shared out-of-band.
- **Key management.** If the journalist's private key is compromised, an adversary could publish false content under the same identity. Future: key rotation mechanisms and multi-signature publishing.

---

## 6. P2P Marketplace

### Summary

Vendors publish product listings as lightweight P2P apps distributed through PearBrowser. Buyers browse listings, communicate with vendors, and complete transactions directly -- no platform intermediary, no listing fees, no commission on sales. Each vendor's inventory syncs across their own devices via Autobase, and product catalogs are discoverable through community catalog relays.

### Actors

| Actor | Role |
|---|---|
| **Vendors** | Create product listings, manage inventory, fulfill orders |
| **Buyers** | Browse listings, contact vendors, make purchases |
| **Catalog relay operators** | Run marketplace catalog relays that aggregate vendor listings |
| **HiveRelay nodes** | Seed vendor catalogs for availability |

### Preconditions

- PearBrowser installed on vendor and buyer devices
- At least one marketplace catalog relay is running and subscribed to by buyers
- Vendors have configured their product catalog Autobase

### Step-by-Step Flow

1. **Vendor setup.** A vendor opens PearBrowser and launches the Marketplace Vendor app. They create a new store, which initializes a Hyperdrive for their product catalog and an Autobase for inventory and order management. The vendor adds products with descriptions, photos, pricing, and stock quantities.

2. **Multi-device sync.** The vendor has an iPhone for on-the-go management and an iPad at their workshop. Both devices are added as writers to the store's Autobase. When the vendor updates inventory on one device, the change replicates to the other within seconds.

3. **Catalog registration.** The vendor submits their store's Hyperdrive key to a marketplace catalog relay. The relay operator reviews the submission and adds it to the catalog Autobase. The vendor's products now appear in the marketplace directory.

4. **Buyer discovery.** A buyer opens PearBrowser's App Store tab, which includes marketplace catalogs. They browse categories, search for "handmade ceramics," and find the vendor's store. Tapping the listing loads the vendor's store app from the Hyperdrive.

5. **Product browsing.** The buyer browses the vendor's products within the store app. Product data loads from the vendor's Hyperdrive, which is seeded by the vendor's devices and HiveRelay. Photos and descriptions render in the WebView.

6. **Direct communication.** The buyer initiates a conversation with the vendor through a P2P messaging channel built on Hyperswarm. Messages are encrypted end-to-end. The buyer asks about customization options and shipping.

7. **Order placement.** The buyer selects items and creates an order. The order details are written to a shared Autobase between the buyer and vendor. The vendor receives the order on their device and confirms it.

8. **Payment.** Payment is handled outside the P2P system -- the vendor provides payment instructions (bank transfer, mobile payment app, cryptocurrency address, or cash on pickup). The vendor marks the order as paid once payment is confirmed.

9. **Fulfillment.** The vendor ships the item and updates the order status in the Autobase. The buyer sees the status change in real time. Both parties have a cryptographically signed record of the transaction.

10. **Inventory update.** The sale automatically decrements the vendor's inventory across all their devices. If stock reaches zero, the product is marked as sold out in the catalog.

### How P2P Technology Is Used

- **Hyperdrive** stores each vendor's product catalog (descriptions, photos, pricing) as a self-contained website/app. Buyers download and render it directly in PearBrowser.
- **Autobase** provides three functions: (a) vendor inventory sync across devices, (b) order management between buyer and vendor, (c) marketplace catalog aggregation.
- **Hyperswarm** enables direct peer connections between buyers and vendors for messaging and data exchange, with no intermediary server.
- **HiveRelay** seeds vendor catalogs so products remain browsable even when the vendor's devices are offline.
- **`window.pear`** provides the store app with APIs for creating encrypted communication channels, reading/writing Autobases, and managing Hyperdrives.

### Benefits over Traditional Approach

| Traditional Marketplace (Etsy, eBay) | PearBrowser P2P Marketplace |
|---|---|
| 10-15% commission on every sale | Zero platform fees |
| Platform controls listing visibility | Vendor controls their own store and visibility |
| Account can be suspended at platform's discretion | No account to suspend; vendor owns their keypair |
| Buyer and seller data harvested by platform | No data collection; communication is direct and encrypted |
| Platform mediates all communication | Direct buyer-vendor relationship |
| Listing fees and promoted placement costs | Free to list; discovery through community catalogs |
| Geographic restrictions on sellers | Global by default; no geographic limitations |

### Current Limitations / Future Improvements

- **Payment integration.** Payments currently happen outside the platform. This adds friction and requires trust. Future: integration with cryptocurrency or P2P payment protocols to enable in-app escrow and payment.
- **Dispute resolution.** No built-in mechanism for handling disputes. Traditional marketplaces provide buyer protection. Future: a reputation/escrow system backed by community arbitrators, with dispute records on an Autobase.
- **Search.** Search is limited to catalogs the buyer has subscribed to. There is no global search across all marketplaces. Future: federated search across catalog relays.
- **Reputation.** Buyer and vendor reviews exist within individual catalog relays but are not portable across catalogs. Future: a cross-catalog reputation protocol using verifiable credentials.
- **Shipping integration.** No built-in shipping label generation or tracking. Vendors must handle logistics independently. Future: integration with shipping APIs.
- **Scale.** A single vendor's Hyperdrive can handle a catalog of a few hundred products comfortably. Vendors with thousands of SKUs may need catalog pagination and lazy-loading optimizations.

---

## 7. Education Platform

### Summary

A teacher creates interactive learning materials -- quizzes, reading assignments, multimedia content -- as a P2P app distributed through PearBrowser. Students access the materials on their iPhones or iPads. Progress is tracked via Autobase, giving the teacher a real-time view of each student's work. The entire system works in schools with limited or no internet connectivity, since all content and progress data sync over the local network.

### Actors

| Actor | Role |
|---|---|
| **Teacher** | Creates learning materials, monitors student progress, provides feedback |
| **Students** | Access materials, complete assignments, take quizzes |
| **School IT (optional)** | Maintains a local HiveRelay or always-on device for data availability |
| **HiveRelay node** | Seeds course materials and syncs progress data for off-hours availability |

### Preconditions

- PearBrowser installed on the teacher's device and all student devices
- A local Wi-Fi network in the classroom (internet connectivity is optional)
- The teacher has created course content using the education app's authoring tools

### Step-by-Step Flow

1. **Course creation.** The teacher opens PearBrowser and launches the Education App. They create a new course, which initializes a Hyperdrive for course materials and an Autobase for student progress tracking. The teacher adds lessons, reading materials, embedded videos, interactive quizzes, and assignments.

2. **Student enrollment.** In the classroom, the teacher displays a QR code on the projector. Each student scans the code with PearBrowser, which enrolls them in the course. Their device receives the Autobase discovery key and is added as an authorized writer (scoped to their own progress data -- students cannot modify course materials or other students' progress).

3. **Content distribution.** Course materials replicate from the teacher's device to all student devices over the classroom Wi-Fi via Hyperswarm's local peer discovery. No internet required. A class of 30 students all receive the materials simultaneously, with each downloaded device helping to seed to others (swarm distribution).

4. **Self-paced learning.** Students work through lessons at their own pace. As they complete readings, the app writes completion timestamps to their local Autobase core. When they take a quiz, their answers and scores are recorded locally.

5. **Real-time progress monitoring.** The teacher's device subscribes to all student Autobase cores. As students complete activities, progress updates replicate to the teacher's view in real time over the local network. The teacher sees a dashboard showing each student's progress through the lesson sequence, quiz scores, and time spent on each activity.

6. **Offline homework.** Students take their devices home. They can continue working on assignments offline -- all course materials are cached locally. Progress is recorded to their local Autobase core.

7. **Next-day sync.** When students return to the classroom and connect to the Wi-Fi, their homework progress automatically syncs to the teacher's device and to the school's local HiveRelay (if one exists). The teacher sees updated progress without any manual submission step.

8. **Feedback loop.** The teacher writes individual feedback entries to the Autobase, addressed to specific students. When the student's device syncs, they see the teacher's comments alongside their work.

9. **Academic record.** At the end of the term, the teacher exports grades and progress data from the Autobase. The complete history of each student's work, including timestamps and quiz attempts, is available for records.

### How P2P Technology Is Used

- **Hyperdrive** stores all course materials (HTML lessons, images, videos, quiz definitions). It acts as a local CDN within the classroom -- once the teacher's device has the content, the swarm distributes it to all students efficiently.
- **Autobase** tracks student progress with a multi-writer model. Each student writes to their own core (answers, completion events, timestamps). The teacher writes to their core (feedback, grade adjustments). Autobase linearizes everything into a coherent timeline. Write permissions are scoped so students can only write their own progress data.
- **Hyperswarm** with mDNS provides local network peer discovery. In a classroom setting, all devices find each other without internet. This is critical for schools in areas with poor connectivity.
- **HiveRelay** (optional) provides persistence. A Raspberry Pi or old laptop running a relay node on the school network ensures course data is available even when the teacher's device is not present.

### Benefits over Traditional Approach

| Traditional LMS (Google Classroom, Canvas) | PearBrowser Education Platform |
|---|---|
| Requires internet for every interaction | Works fully on local Wi-Fi; no internet needed |
| Student data stored on company servers | Student data stays on school devices; full privacy |
| Monthly per-student licensing fees | No licensing fees |
| Platform downtime affects all users | No central server to go down |
| Bandwidth-intensive; video streaming requires fast internet | Content distributed locally via swarm; efficient even on slow networks |
| No functionality offline | Full functionality offline; sync when connected |
| Data governed by platform's privacy policy (often US-based) | Data governed only by the school's own policies |
| Requires student email accounts / platform accounts | No accounts needed; enrollment via QR code |

### Current Limitations / Future Improvements

- **Content authoring.** The education app's authoring tools are currently basic (text, images, simple quizzes). Future: support for richer interactive content types (simulations, drag-and-drop exercises, code editors), potentially by embedding third-party P2P learning apps.
- **Video content.** Large video files strain local network bandwidth and device storage during initial distribution. Future: adaptive bitrate streaming from local peers using chunked Hyperdrive reads.
- **Student privacy controls.** Currently, the teacher can see all student progress data. Future: finer-grained privacy controls where students can choose what progress data to share.
- **Multi-class management.** Each course is a separate Autobase. Teachers managing multiple classes must switch between them. Future: a teacher dashboard that aggregates multiple course Autobases.
- **Parent access.** No mechanism for parents to view their child's progress. Future: read-only Autobase access for parent devices.
- **Accessibility.** The education app does not yet have full accessibility support (screen reader optimization, alternative text for images, keyboard navigation). This is a priority for future development.
- **Assessment integrity.** There is no built-in proctoring or anti-cheating mechanism for quizzes. The offline nature makes this inherently challenging. Future: timed quiz modes with randomized question order and one-time-use answer tokens.
- **Cross-school sharing.** Teachers at different schools cannot easily share course materials. Future: a teacher catalog (similar to the app catalog in Use Case 3) where educators publish and discover course packs.

---

## Cross-Cutting Themes

Several themes emerge across all seven use cases that highlight PearBrowser's fundamental value proposition:

### Data Sovereignty

In every use case, the data creator retains full ownership and custody. There is no third-party server holding the authoritative copy. The shop owner owns their transaction history. The journalist owns their published content. The teacher owns their course materials. This is not merely a philosophical preference -- it has practical implications for privacy, regulatory compliance, and long-term data access.

### Offline-First by Design

PearBrowser's architecture does not treat offline capability as a fallback mode. The Bare Kit worklet runs Hypercore and Hyperswarm natively on iOS, meaning the P2P stack operates identically whether the device is connected to the internet, connected only to a local network, or completely offline. This makes PearBrowser viable in environments where reliable internet is not available -- rural areas, developing regions, disaster zones, and censored networks.

### Zero Infrastructure Costs

Traditional applications require servers, databases, CDNs, and ongoing operational expenses. PearBrowser apps run on the devices that use them. HiveRelay nodes are optional enhancements for availability, not required infrastructure. This eliminates the cost barrier for individuals, small businesses, and community organizations.

### Resilience Through Distribution

Every PearBrowser use case benefits from the fundamental P2P property: more users means more resilience. A coffee shop with five iPads has five copies of its data. A popular website has as many seeds as it has readers. A widely-used education platform distributes load across all student devices. This is the inverse of traditional architectures, where more users means more server load.

### Interoperability Through Open Protocols

All use cases build on the same open protocols -- Hypercore, Hyperswarm, Autobase. A developer who builds a POS app uses the same `window.pear` APIs as a developer building a marketplace. This shared foundation means the ecosystem compounds: improvements to Autobase performance benefit every use case simultaneously.

---

## Conclusion

PearBrowser is not a replacement for every web application. It is purpose-built for scenarios where centralized infrastructure is a liability -- whether because of cost, censorship, connectivity limitations, or data sovereignty requirements. The seven use cases in this document represent concrete, practical applications where P2P architecture provides measurable advantages over traditional approaches.

The current limitations noted in each use case are honest assessments of where the technology stands today. They also represent the roadmap: each limitation is a solvable engineering problem, not a fundamental architectural constraint. As the Holepunch ecosystem matures, PearBrowser's capabilities will expand to address these gaps while preserving the core properties that make it valuable.
