# PearBrowser Developer Guide

Build, publish, and distribute P2P apps that run inside PearBrowser. Your apps are standard HTML/CSS/JS served from Hyperdrives, with access to multi-device data sync and P2P networking through the `window.pear` bridge API.

---

## Table of Contents

1. [Building Your First P2P App](#1-building-your-first-p2p-app)
2. [The window.pear API Reference](#2-the-windowpear-api-reference)
3. [Publishing Your App](#3-publishing-your-app)
4. [Running a Catalog Relay](#4-running-a-catalog-relay)
5. [The Autobase Data Model](#5-the-autobase-data-model)
6. [Architecture Deep Dive](#6-architecture-deep-dive)
7. [PearBrowser Development Setup](#7-pearbrowser-development-setup)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Building Your First P2P App

A PearBrowser app is a directory containing at minimum an `index.html` and a `manifest.json`. Apps run inside a sandboxed WebView with access to P2P APIs through the injected `window.pear` bridge.

### Step 1: Create the App Directory

```bash
mkdir my-todo-app
cd my-todo-app
```

### Step 2: Write manifest.json

Every app must include a manifest at the root of the directory. This is what PearBrowser reads to display your app in the catalog.

```json
{
  "name": "My Todo App",
  "version": "1.0.0",
  "description": "A simple P2P to-do list that syncs across devices",
  "author": "your-name",
  "icon": "/icon.png",
  "entry": "/index.html",
  "categories": ["productivity"],
  "permissions": []
}
```

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name in the app store |
| `version` | string | Semver version string |
| `entry` | string | Path to the HTML entry point (usually `/index.html`) |

**Optional fields:**

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Short description shown in catalog listings |
| `author` | string | Developer name |
| `icon` | string | Path to a 256x256 PNG icon within the drive |
| `categories` | string[] | One or more of: `utilities`, `productivity`, `communication`, `games` |
| `permissions` | string[] | Reserved for future use (currently empty) |

### Step 3: Build the App

Create `index.html`. The `window.pear` API is automatically injected by PearBrowser -- you do not need to include any scripts to access it.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Todo App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      padding: 20px;
    }
    h1 { color: #ff9500; margin-bottom: 16px; }
    input {
      background: #1a1a1a;
      border: 1px solid #333;
      color: #e0e0e0;
      padding: 10px;
      border-radius: 8px;
      width: 100%;
      font-size: 16px;
      margin-bottom: 12px;
    }
    .todo-item {
      padding: 12px;
      border-bottom: 1px solid #333;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .done { text-decoration: line-through; color: #555; }
    button {
      background: #ff9500;
      color: #000;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
    }
    #status { color: #888; font-size: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>P2P Todos</h1>
  <input id="newTodo" placeholder="Add a todo..." />
  <div id="todos"></div>
  <div id="status">Initializing sync...</div>

  <script>
    const APP_ID = 'my-todo-app';
    let syncReady = false;

    // --- Initialize Sync ---
    async function init() {
      try {
        // Check for a saved invite key (for joining an existing group)
        const savedKey = localStorage.getItem('todo-invite-key');
        let result;

        if (savedKey) {
          result = await window.pear.sync.join(APP_ID, savedKey);
        } else {
          result = await window.pear.sync.create(APP_ID);
        }

        if (result.inviteKey) {
          localStorage.setItem('todo-invite-key', result.inviteKey);
        }

        syncReady = true;
        document.getElementById('status').textContent =
          'Syncing with peers (key: ' + result.inviteKey.slice(0, 12) + '...)';

        // Load existing todos
        await refreshTodos();
      } catch (err) {
        document.getElementById('status').textContent = 'Sync error: ' + err.message;
      }
    }

    // --- Add a Todo ---
    async function addTodo(text) {
      if (!syncReady || !text.trim()) return;

      const id = 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      await window.pear.sync.append(APP_ID, {
        type: 'todo:create',
        data: { id, text: text.trim(), done: false, created_at: new Date().toISOString() }
      });

      await refreshTodos();
    }

    // --- Toggle Done ---
    async function toggleTodo(id) {
      const existing = await window.pear.sync.get(APP_ID, 'todo:create!' + id);
      if (!existing) return;

      await window.pear.sync.append(APP_ID, {
        type: 'todo:update',
        data: { id, updates: { done: !existing.done } }
      });

      await refreshTodos();
    }

    // --- Refresh List ---
    async function refreshTodos() {
      const items = await window.pear.sync.list(APP_ID, 'todo:create!', { limit: 50 });
      const container = document.getElementById('todos');
      container.innerHTML = '';

      for (const item of items) {
        const todo = item.value;
        const div = document.createElement('div');
        div.className = 'todo-item';
        div.innerHTML =
          '<span class="' + (todo.done ? 'done' : '') + '">' + todo.text + '</span>' +
          '<button onclick="toggleTodo(\'' + todo.id + '\')">' +
            (todo.done ? 'Undo' : 'Done') +
          '</button>';
        container.appendChild(div);
      }
    }

    // --- Input Handler ---
    document.getElementById('newTodo').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        addTodo(this.value);
        this.value = '';
      }
    });

    // --- Listen for Sync Events ---
    window.pear.sync.onSync(function() {
      refreshTodos();
    });

    // --- Boot ---
    init();
  </script>
</body>
</html>
```

### Step 4: Add an Icon (Optional)

Create a 256x256 PNG named `icon.png` in the root directory. This is displayed in the app catalog and home screen.

### Using window.posAPI for POS-Compatible Apps

If you are building a point-of-sale application, PearBrowser injects a higher-level `window.posAPI` that wraps the sync primitives with a retail-specific data model. This API automatically initializes an Autobase sync group with the app ID `pear-pos`.

```javascript
// Register a merchant
await window.posAPI.register('My Store', 'me@store.com', 'password');

// Create a product
const product = await window.posAPI.createProduct({
  name: 'Widget',
  price_cents: 999,
  category: 'Electronics',
  barcode: '1234567890',
  sku: 'WDG-001',
  stock: 50
});

// List all products
const products = await window.posAPI.listProducts({ limit: 100 });

// Create a transaction
const txn = await window.posAPI.createTransaction(
  [{ product_id: product.id, name: 'Widget', price_cents: 999, quantity: 2 }],
  'card'
);

// Adjust stock
await window.posAPI.adjustStock(product.id, -2, 'Sold 2 units');

// Get sync status
const status = await window.posAPI.getSyncStatus();

// Share invite key with another device
const key = await window.posAPI.getSyncInviteKey();

// Join from another device
await window.posAPI.joinSyncGroup(key);
```

### Step 5: Test Locally Before Publishing

You can test your app by serving it from a local HTTP server and verifying the HTML/CSS/JS works in a browser. The `window.pear` API will not be available outside PearBrowser, so wrap bridge calls in availability checks:

```javascript
if (window.pear) {
  // Running inside PearBrowser -- use P2P features
  await window.pear.sync.create('my-app');
} else {
  // Running in a regular browser -- use mock data
  console.log('window.pear not available, running in standalone mode');
}
```

For a quick local server:

```bash
# Using Python
cd my-todo-app
python3 -m http.server 8080

# Using Node.js
npx serve my-todo-app
```

To test the full P2P flow, publish the app and load it in PearBrowser on a simulator (see Section 3).

---

## 2. The window.pear API Reference

The `window.pear` object is injected into every WebView that loads a P2P app. It communicates with PearBrowser's Bare worklet backend through a `postMessage` bridge. All methods return Promises.

### Sync API

The sync API provides multi-device data synchronization via Autobase. Data is organized into sync groups identified by an app ID.

#### `window.pear.sync.create(appId)`

Create a new Autobase sync group. Returns an invite key that other devices can use to join.

```javascript
const result = await window.pear.sync.create('my-app');
console.log(result.inviteKey); // '4a3b2c1d...' (64-char hex string)
console.log(result.appId);     // 'my-app'
```

**Parameters:**
- `appId` (string) -- A unique identifier for the sync group. Convention: lowercase kebab-case (e.g., `my-app`, `pear-pos`).

**Returns:** `{ inviteKey: string, appId: string }`

The invite key is derived from the Autobase's public key. Save it (e.g., in `localStorage`) so you can rejoin on restart.

---

#### `window.pear.sync.join(appId, inviteKey)`

Join an existing sync group by invite key. The device begins replicating data from all other writers in the group.

```javascript
const result = await window.pear.sync.join('my-app', '4a3b2c1d...');
```

**Parameters:**
- `appId` (string) -- Must match the group you are joining.
- `inviteKey` (string) -- 64-character hex string from `sync.create()`.

**Returns:** `{ inviteKey: string, appId: string }`

---

#### `window.pear.sync.append(appId, operation)`

Append an operation to the sync group's log. Operations are processed by the apply function to build the materialized view.

```javascript
await window.pear.sync.append('my-app', {
  type: 'product:create',
  data: {
    id: 'prod_001',
    name: 'Widget',
    price_cents: 999,
    stock: 50
  }
});
```

**Parameters:**
- `appId` (string) -- The sync group to append to.
- `operation` (object):
  - `type` (string) -- Operation type. The built-in apply function handles: `product:create`, `product:update`, `product:delete`, `stock:adjust`, `transaction:create`, `config:set`, `merchant:register`. Unknown types get a generic fallback: `key = type.replace(':', '!') + '!' + data.id`.
  - `data` (object) -- Operation payload. Must contain an `id` field for the generic fallback to index it.
  - `timestamp` (string, optional) -- ISO 8601 timestamp. Defaults to `new Date().toISOString()`.

**Returns:** `{ ok: true }`

A `deviceId` field (first 16 hex chars of the local writer's key) is added automatically.

---

#### `window.pear.sync.get(appId, key)`

Query a single value from the sync group's materialized view (Hyperbee).

```javascript
const product = await window.pear.sync.get('my-app', 'products!prod_001');
// Returns: { id: 'prod_001', name: 'Widget', price_cents: 999, ... }
// Returns null if not found
```

**Parameters:**
- `appId` (string) -- The sync group.
- `key` (string) -- The exact key to look up. Key format depends on the operation type (see Section 5 for naming conventions).

**Returns:** The parsed JSON value, or `null` if not found.

---

#### `window.pear.sync.list(appId, prefix, opts)`

Query a range of entries from the view by key prefix.

```javascript
// List all products
const products = await window.pear.sync.list('my-app', 'products!', { limit: 50 });
// Returns: [{ key: 'products!prod_001', value: {...} }, ...]

// List transactions in a time range
const txns = await window.pear.sync.list('my-app', 'transactions!2024-01', { limit: 20 });
```

**Parameters:**
- `appId` (string) -- The sync group.
- `prefix` (string) -- Key prefix. Uses Hyperbee range query: `gte: prefix`, `lt: prefix + '\xff'`.
- `opts` (object, optional):
  - `limit` (number) -- Maximum results. Default: 100.

**Returns:** Array of `{ key: string, value: object }`.

---

#### `window.pear.sync.status(appId)`

Get the current status of a sync group.

```javascript
const status = await window.pear.sync.status('my-app');
// Returns:
// {
//   appId: 'my-app',
//   inviteKey: '4a3b2c1d...',
//   writerCount: 3,    // Number of devices writing to this group
//   viewLength: 147    // Number of entries in the materialized view
// }
```

**Parameters:**
- `appId` (string)

**Returns:** `{ appId, inviteKey, writerCount, viewLength }` or `null` if the group does not exist.

---

#### `window.pear.sync.onSync(callback)`

Register a listener for sync events. Called when new data arrives from other peers.

```javascript
window.pear.sync.onSync(function() {
  console.log('New data received from peers');
  refreshUI();
});
```

**Parameters:**
- `callback` (function) -- Called with no arguments when a sync event occurs.

---

### Identity API

#### `window.pear.identity.getPublicKey()`

Get the device's ed25519 public key from the Hyperswarm keypair. This is a stable identifier for the device (not the user).

```javascript
const { publicKey } = await window.pear.identity.getPublicKey();
console.log(publicKey); // '7f8e9d...' (64-char hex)
```

**Returns:** `{ publicKey: string | null }` -- `null` if Hyperswarm has not connected yet.

---

### Navigation API

#### `window.pear.navigate(url)`

Navigate PearBrowser to a different URL. Supports `hyper://` addresses.

```javascript
// Navigate to another P2P app or site
await window.pear.navigate('hyper://abc123.../index.html');
```

**Parameters:**
- `url` (string) -- The URL to navigate to.

**Returns:** `{ ok: true }`

Note: Navigation is handled by the React Native layer. The WebView will be replaced with the new content.

---

#### `window.pear.share(url)`

Trigger the iOS share sheet for a URL.

```javascript
await window.pear.share('hyper://abc123...');
```

**Parameters:**
- `url` (string) -- The URL to share.

**Returns:** `{ ok: true }`

---

### window.posAPI Reference

The `window.posAPI` is a higher-level API that wraps `window.pear.sync` with a point-of-sale data model. It uses the fixed app ID `pear-pos` and auto-initializes the sync group on load.

| Method | Description |
|--------|-------------|
| `register(name, email, password)` | Register merchant info. Returns `{ token, merchant }`. |
| `login(email, password)` | No-op in P2P mode. Returns `{ token: 'p2p-local', merchant }`. |
| `getMe()` | Get current merchant info from sync group. |
| `listProducts(params)` | List products. `params.limit` defaults to 100. |
| `createProduct(product)` | Create a product. Auto-generates `id` if missing. |
| `updateProduct(id, updates)` | Merge updates into existing product. |
| `deleteProduct(id)` | Soft-delete (sets `active: false`). |
| `getProduct(id)` | Get single product by ID. |
| `adjustStock(productId, delta, reason)` | Adjust stock level by delta (positive or negative). |
| `getLowStock()` | List products where `stock <= low_stock_threshold` (default threshold: 5). |
| `createTransaction(items, paymentMethod, options)` | Create a completed transaction. Auto-calculates `total_cents`. |
| `listTransactions(params)` | List transactions. `params.limit` defaults to 50. |
| `getSyncStatus()` | Returns `{ appId, inviteKey, writerCount, viewLength }`. |
| `getSyncInviteKey()` | Returns the saved invite key from `localStorage`. |
| `joinSyncGroup(inviteKey)` | Join POS sync group from another device. |
| `getConfig()` | Read config from `config!main` key. |
| `updateConfig(updates)` | Merge updates into config. |

---

## 3. Publishing Your App

### Using tools/publish-app.js

The publish tool creates a Hyperdrive from your app directory, writes all files into it, and announces it on the DHT.

```bash
node tools/publish-app.js ./my-todo-app \
  --name "My Todo App" \
  --description "A P2P to-do list with multi-device sync" \
  --author "your-name" \
  --category "productivity"
```

### Command Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `--name <name>` | Directory name | App display name |
| `--description <desc>` | Empty string | Short description |
| `--author <name>` | `anonymous` | Author name |
| `--category <cat>` | `utilities` | Category: `utilities`, `productivity`, `communication`, `games` |
| `--storage <path>` | OS temp dir | Where to store the Hyperdrive data on disk |

### What Happens When You Publish

1. **Hyperdrive creation** -- A new writable Hyperdrive is created in the storage directory. This generates a unique ed25519 keypair. The public key becomes the drive's address.

2. **File writing** -- All files from your app directory are written into the Hyperdrive (excluding dotfiles). Each file's path is preserved relative to the root.

3. **Manifest generation** -- If your directory does not contain `manifest.json`, one is auto-generated from the command line options.

4. **DHT announcement** -- The tool joins two Hyperswarm topics:
   - The drive's own `discoveryKey` (so peers can find and download the app)
   - The well-known topic `pearbrowser-apps-v1` (so catalog relays discover the app)

5. **Seeding** -- The process stays running and serves the Hyperdrive to any peer that connects. You must keep it running for the app to be available.

```
=== App Published ===

  Name:        My Todo App
  Key:         4a3b2c1de5f6...  (64 hex chars)
  URL:         hyper://4a3b2c1de5f6...
  Files:       3

  The app is now discoverable by catalog relays.
  Keep this process running to serve the app.
```

### Seeding on a HiveRelay for Availability

If you stop the publish process, your app becomes unavailable until you restart it (unless another peer has cached it). For 24/7 availability, seed your app on a HiveRelay:

```bash
# Ask a relay to seed your app's Hyperdrive
curl -X POST http://your-relay:9100/v1/seed \
  -H 'Content-Type: application/json' \
  -d '{"key": "4a3b2c1de5f6..."}'
```

Once seeded, the relay stores and serves your app's content. PearBrowser's hybrid fetch system will load it from the relay HTTP gateway in 1-2 seconds, even if your local publish process is not running.

### Registering with a Catalog Relay

You can also manually register your app with a catalog relay's HTTP endpoint:

```bash
curl -X POST http://catalog-relay:9200/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"driveKey": "4a3b2c1de5f6..."}'
```

The relay will connect to your drive, read the manifest, validate it, and add the app to its catalog. Your publish process must be running when you do this so the relay can fetch the manifest.

---

## 4. Running a Catalog Relay

A catalog relay discovers published apps and builds a browseable catalog that PearBrowser clients can load.

### Using tools/catalog-relay.js

```bash
node tools/catalog-relay.js --port 9200 --storage ./catalog-storage
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port <number>` | `9200` | HTTP server port |
| `--storage <path>` | `./catalog-storage` | Corestore directory for the catalog Hyperdrive |

### How Apps Are Discovered and Indexed

When the relay starts, it:

1. Creates a writable Hyperdrive to hold the catalog data (`catalog.json`).
2. Joins the DHT topic `pearbrowser-apps-v1` as a client to discover app publishers.
3. Serves the catalog over HTTP for PearBrowser's fast-path loading.

When a new peer is discovered on the announcement topic, the relay attempts to read a `manifest.json` from the peer's Hyperdrive. If the manifest is valid (has `name` and `entry` fields), the app is added to the catalog.

The catalog itself is a JSON file written to the relay's Hyperdrive:

```json
{
  "version": 1,
  "name": "PearBrowser Open Catalog",
  "updatedAt": "2025-01-15T12:00:00.000Z",
  "apps": [
    {
      "id": "my-todo-app",
      "name": "My Todo App",
      "description": "A P2P to-do list with multi-device sync",
      "author": "your-name",
      "version": "1.0.0",
      "driveKey": "4a3b2c1de5f6...",
      "icon": "/icon.png",
      "categories": ["productivity"],
      "discoveredAt": 1705312800000
    }
  ]
}
```

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Returns `{ ok, type, apps, catalogKey }` |
| `/catalog.json` | GET | Returns the full catalog JSON |
| `/v1/register` | POST | Submit a drive key for manual registration. Body: `{ driveKey: "hex..." }` |
| `/v1/hyper/:key/*path` | GET | Gateway: serves files from any Hyperdrive by key |

### The /v1/register Endpoint

Developers can submit their app directly without waiting for DHT discovery:

```bash
curl -X POST http://localhost:9200/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"driveKey": "4a3b2c1de5f6..."}'
```

The relay connects to the drive, waits up to 30 seconds for the manifest to replicate, validates it, and adds the app to the catalog. Returns:

```json
{
  "ok": true,
  "app": { "name": "My Todo App", "key": "4a3b2c1de5f6..." },
  "catalogKey": "9f8e7d6c..."
}
```

### Running Your Own Community Catalog

Anyone can run a catalog relay for their own community:

1. Start the relay: `node tools/catalog-relay.js --port 9200`
2. Note the catalog key printed on startup (64-char hex string)
3. Share the relay's HTTP URL with your community
4. Users add the URL in PearBrowser: Apps tab -> enter relay URL
5. Developers register their apps via `/v1/register` or DHT announcement

The relay also serves as an HTTP gateway for all Hyperdrives it knows about, so apps load instantly via the HTTP fast-path.

---

## 5. The Autobase Data Model

### How Autobase Works

Autobase is a multi-writer database built on Hypercore. Each device has its own append-only log (a Hypercore) and writes operations to it. Autobase deterministically merges all writers' logs and passes batches of operations to an `apply` function that builds a materialized view (a Hyperbee key-value store).

```
Device A log:  [op1] [op3] [op5]
Device B log:  [op2] [op4]
                 ↓ merge (causal ordering)
Autobase:      [op1] [op2] [op3] [op4] [op5]
                 ↓ apply function
Hyperbee view: { "products!p1": {...}, "products!p2": {...} }
```

Key properties:
- Each device writes independently to its own log (no coordination needed)
- Logs replicate over Hyperswarm when peers connect
- The apply function runs deterministically on all devices, producing the same view
- The view is queryable by key or prefix range

### The Apply Function

PearBrowser's built-in apply function processes operations from the merged log and writes results to a Hyperbee. It handles POS-compatible operations out of the box and provides a generic fallback for custom types.

Each operation is a JSON object:

```json
{
  "type": "product:create",
  "data": { "id": "prod_001", "name": "Widget", "price_cents": 999 },
  "timestamp": "2025-01-15T12:00:00.000Z",
  "deviceId": "7f8e9d0a1b2c3d4e"
}
```

**Built-in operation types and their key mappings:**

| Operation Type | Keys Written |
|---|---|
| `product:create` | `products!{id}`, `products-by-barcode!{barcode}`, `products-by-sku!{sku}`, `products-by-category!{category}!{id}`, `products-by-name!{name}!{id}` |
| `product:update` | `products!{id}` (merged with existing), plus barcode/sku indexes |
| `product:delete` | `products!{id}` (sets `active: false` -- soft delete) |
| `stock:adjust` | `products!{id}` (increments `stock` by `delta`) |
| `transaction:create` | `transactions!{timestamp}!{id}`, `transactions-by-id!{id}` |
| `config:set` | `config!merchant` (merged with existing) |
| `merchant:register` | `config!merchant` (merged with existing) |
| *(any other type)* | `{type with : replaced by !}!{data.id}` |

### Key Naming Conventions

Keys use `!` as a separator to create a hierarchical namespace. This allows efficient prefix queries via `sync.list()`.

```
products!prod_001              -- Product by ID
products-by-barcode!123456     -- Barcode index
products-by-category!electronics!prod_001  -- Category index
transactions!2025-01-15T12:00:00.000Z!txn_001  -- Transaction (time-sorted)
transactions-by-id!txn_001    -- Transaction by ID
config!merchant                -- Merchant configuration
```

**Custom types use the generic fallback:**

```javascript
// Appending a custom operation type
await window.pear.sync.append('my-app', {
  type: 'note:create',
  data: { id: 'note_001', text: 'Hello', color: 'yellow' }
});

// This creates key: note:create!note_001  (colon is NOT replaced in the key for generic ops)
// Actually the generic fallback uses: type.replace(':', '!') + '!' + data.id
// So: note!create!note_001

// Query all notes
const notes = await window.pear.sync.list('my-app', 'note!create!');
```

### Multi-Device Sync Behavior

When two devices are syncing:

1. **Online sync**: If both devices are connected to Hyperswarm, operations replicate in near-real-time (typically under 1 second on good connections).

2. **Offline operation**: Each device writes to its local log independently. Operations are queued and replicate when connectivity is restored.

3. **Reconnection**: When devices reconnect, Hypercore efficiently syncs only the missing entries (not the entire log).

4. **View rebuild**: After receiving new operations from peers, the Autobase apply function re-runs on the new batch. The materialized view updates to reflect all operations from all devices.

### Conflict Resolution

The built-in apply function uses **last-write-wins** semantics:

- `product:update` merges fields: `{ ...existing, ...updates }`. The last update to arrive overwrites conflicting fields.
- `stock:adjust` is additive -- delta values from all devices are applied in causal order, so concurrent adjustments produce correct totals.
- `product:delete` is a soft delete (`active: false`). A subsequent `product:create` with the same ID would overwrite it.
- `config:set` merges: `{ ...existing, ...newData }`.

For applications needing stronger conflict resolution, you would need a custom apply function (not currently exposed through the bridge API, but available if you fork PearBrowser's backend).

---

## 6. Architecture Deep Dive

### How the Bare Worklet Runs on iOS

PearBrowser uses [Bare](https://github.com/nickhaf/bare), a minimal JavaScript runtime from Holepunch, running inside a `react-native-bare-kit` worklet:

```
iOS App Process
├── React Native (JavaScriptCore)    -- UI layer
│   └── App.tsx, screens, components
│
└── Bare Worklet (separate JS context) -- P2P engine
    └── backend/index.js
        ├── Hyperswarm (DHT + hole-punching)
        ├── Corestore (Hypercore management)
        ├── HyperProxy (local HTTP server)
        ├── PearBridge (Autobase sync)
        └── 17 native addons (sodium, udx, rocksdb, etc.)
```

The worklet is bundled with `bare-pack`, which statically links native addons for the target platform:

```bash
bare-pack --linked --host ios-arm64 backend/index.js -o assets/backend.bundle.mjs
```

At boot, `App.tsx` creates a `Worklet` instance, passes the bundle, and communicates over IPC:

```typescript
const worklet = new Worklet()
const rpc = new PearRPC(worklet.IPC)
worklet.start('/app.bundle', backendBundle, [storagePath])
```

The worklet handles iOS lifecycle events:

```javascript
Bare.on('suspend', () => IPC.unref())  // App going to background
Bare.on('resume', () => IPC.ref())     // App returning to foreground
```

### The RPC Protocol

React Native and the worklet communicate via **length-prefixed JSON** over the IPC stream.

**Wire format:**

```
[8 hex digits = payload length][JSON payload]
```

Example:
```
00000023{"event":100,"data":{"port":50380}}
```

**Message types:**

1. **Request** (RN -> Worklet): `{ id: number, cmd: number, data: any }`
2. **Reply** (Worklet -> RN): `{ id: number, result: any }` or `{ id: number, error: string }`
3. **Event** (Worklet -> RN): `{ event: number, data: any }`

**Command IDs:**

| ID | Command | Direction |
|----|---------|-----------|
| 1 | `NAVIGATE` | RN -> Worklet |
| 2 | `GET_STATUS` | RN -> Worklet |
| 10 | `LOAD_CATALOG` | RN -> Worklet |
| 11 | `INSTALL_APP` | RN -> Worklet |
| 12 | `UNINSTALL_APP` | RN -> Worklet |
| 13 | `LAUNCH_APP` | RN -> Worklet |
| 14 | `LIST_INSTALLED` | RN -> Worklet |
| 15 | `CHECK_UPDATES` | RN -> Worklet |
| 20-26 | Site builder commands | RN -> Worklet |
| 200 | `BRIDGE` | RN -> Worklet (relays WebView API calls) |
| 99 | `STOP` | RN -> Worklet |

**Event IDs:**

| ID | Event | Direction |
|----|-------|-----------|
| 100 | `READY` | Worklet -> RN (includes proxy port) |
| 101 | `PEER_COUNT` | Worklet -> RN |
| 102 | `ERROR` | Worklet -> RN |
| 103 | `INSTALL_PROGRESS` | Worklet -> RN |
| 104 | `SITE_PUBLISHED` | Worklet -> RN |

### How the window.pear Bridge Works

The bridge spans four layers:

```
1. WebView JavaScript
   window.pear.sync.create('my-app')
       ↓ postMessage

2. React Native (BrowseScreen.tsx)
   onMessage handler receives JSON
   { type: 'pear-bridge', id: 1, method: 'sync.create', args: { appId: 'my-app' } }
       ↓ rpc.request(CMD.BRIDGE, { method, args })

3. Worklet RPC Handler (backend/index.js)
   CMD_BRIDGE handler routes by method string
   'sync.create' → pearBridge.createSyncGroup(args.appId)
       ↓ Autobase operations

4. PearBridge (backend/pear-bridge.js)
   Creates Autobase, joins Hyperswarm topic
   Returns { inviteKey, appId }
       ↓ RPC reply bubbles back up

Reply path: Worklet → RPC → RN → injectJavaScript → WebView
   window.dispatchEvent(new MessageEvent('message', {
     data: JSON.stringify({ type: 'pear-bridge-reply', id: 1, result: {...} })
   }))
```

Each bridge call has a 30-second timeout. If the worklet does not respond, the Promise rejects with a timeout error.

### The Hybrid Fetch System

When you navigate to a `hyper://` URL, the proxy fetches content from two sources simultaneously:

```
WebView requests: http://127.0.0.1:{port}/hyper/{key}/path
                         ↓
                    HyperProxy._hybridFetch()
                    ├── RelayClient.fetch() -- HTTP GET to relay gateway
                    │   GET http://relay:9100/v1/hyper/{key}/path
                    │   Uses bare-http1 (not fetch -- Bare has no fetch)
                    │
                    └── _fetchP2P() -- Open Hyperdrive, read file
                        drive.get(filePath)
                        Waits up to 15s for data if drive is new

                    Promise.any([relay, p2p])
                    First successful response wins
```

The proxy also:
- Injects `<base>` tags into HTML responses so relative links resolve correctly
- Serves CORS headers for cross-origin requests
- Maps file extensions to content types (HTML, CSS, JS, images, fonts, video, etc.)
- Returns an X-Source header (`relay` or `p2p`) indicating which path served the content

### Native Addon Linking

The worklet uses 17 native addons that are statically linked at build time by `bare-pack`:

```
bare-crypto, bare-dns, bare-fs, bare-inspect, bare-os, bare-pipe,
bare-subprocess, bare-tcp, bare-type, bare-url, fs-native-extensions,
quickbit-native, rabin-native, rocksdb-native, simdle-native,
sodium-native, udx-native
```

These provide cryptographic operations (sodium), networking (udx, tcp, dns), file system access (fs), and database storage (rocksdb) needed by Hyperswarm and Corestore.

---

## 7. PearBrowser Development Setup

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | >= 20 | [nodejs.org](https://nodejs.org) |
| Xcode | >= 15 | Mac App Store |
| CocoaPods | latest | `brew install cocoapods` |
| bare-pack | >= 2.0 | `npm install -g bare-pack` |

Ensure Xcode command line tools are installed: `xcode-select --install`

### Building from Source

```bash
# Clone and install dependencies
cd PearBrowser
npm install --legacy-peer-deps

# Bundle the Bare worklet for iOS
npm run bundle-backend
# Equivalent to: bare-pack --linked --host ios-arm64 backend/index.js -o assets/backend.bundle.mjs

# Generate the Xcode project (Expo prebuild)
npx expo prebuild --platform ios --no-install

# Install CocoaPods native dependencies
cd ios && LANG=en_US.UTF-8 pod install && cd ..
```

### Running on Simulator

```bash
# Build and launch on iOS simulator
npx expo run:ios --device "iPhone 17 Pro"

# Or open in Xcode for debugging
open ios/PearBrowser.xcworkspace
# Select a simulator target, then Build & Run (Cmd+R)
```

### Running Tests

```bash
# Run backend unit tests
npm test

# Start test infrastructure (serves sample apps on local relay)
node test/start-catalog-test.js

# Serve a test Hyperdrive for browsing
node test/serve-test-drive.js
```

### Adding New RPC Commands

To add a new command that the React Native layer can send to the worklet:

1. **Add the command constant** in both `backend/constants.js` and `app/lib/constants.ts`:

```javascript
// backend/constants.js
const CMD_MY_COMMAND = 300

module.exports = {
  // ... existing exports
  CMD_MY_COMMAND
}
```

```typescript
// app/lib/constants.ts
export const CMD = {
  // ... existing commands
  MY_COMMAND: 300,
} as const
```

2. **Register the handler** in `backend/index.js`:

```javascript
rpc.handle(C.CMD_MY_COMMAND, async (data) => {
  // Do something with data
  return { result: 'done' }
})
```

3. **Add a typed helper** in `app/lib/rpc.ts` (optional but recommended):

```typescript
myCommand(data: any) {
  return this.request(CMD.MY_COMMAND, data)
}
```

4. **Call from a screen**:

```typescript
const result = await rpc.request(CMD.MY_COMMAND, { foo: 'bar' })
```

### Adding New Screens

1. Create the screen component in `app/screens/`:

```typescript
// app/screens/MyScreen.tsx
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  rpc: any
}

export function MyScreen({ rpc }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Screen</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  title: { color: colors.accent, fontSize: 24, fontWeight: '700' },
})
```

2. Import and add to the tab routing in `app/App.tsx`:

```typescript
import { MyScreen } from './screens/MyScreen'

// In the render, add a condition for the new tab
{activeTab === 'myTab' && (
  <MyScreen rpc={rpcRef.current} />
)}
```

### Project Structure Reference

```
PearBrowser/
├── app/                          # React Native UI
│   ├── App.tsx                   # Root: worklet boot, tab navigation
│   ├── screens/                  # Screen components
│   ├── components/               # Reusable components (AppCard, StatusDot)
│   └── lib/                      # Utilities (rpc, bridge-inject, constants, theme)
├── backend/                      # Bare worklet (P2P engine)
│   ├── index.js                  # Entry: boots Hyperswarm, proxy, managers
│   ├── rpc.js                    # RPC server (length-prefixed JSON)
│   ├── hyper-proxy.js            # Hybrid HTTP proxy (relay + P2P)
│   ├── relay-client.js           # HiveRelay HTTP client
│   ├── catalog-manager.js        # Load/search app catalogs
│   ├── app-manager.js            # Install/uninstall/launch apps
│   ├── site-manager.js           # Create/edit/publish sites
│   ├── pear-bridge.js            # Autobase sync for WebView apps
│   └── constants.js              # Shared RPC constants
├── tools/                        # Developer tools
│   ├── publish-app.js            # Publish app as Hyperdrive
│   └── catalog-relay.js          # Run an app catalog relay
├── test/                         # Test infrastructure and sample apps
├── assets/                       # Bundled worklet output
└── package.json
```

---

## 8. Troubleshooting

### Common Issues

**"Buffer not available" in WebView**

The WebView runs standard browser JavaScript, which does not have Node.js `Buffer`. Use `Uint8Array` or string encoding instead:

```javascript
// Wrong -- Buffer does not exist in WebView
const buf = Buffer.from('hello');

// Correct -- use TextEncoder
const encoder = new TextEncoder();
const bytes = encoder.encode('hello');
```

The `window.pear` bridge handles all Buffer conversions internally. You pass and receive plain JavaScript objects and strings.

---

**"Addon not found" or linking errors during bare-pack**

Native addons must be statically linked for the target platform. Make sure you specify the correct `--host` flag:

```bash
# iOS only
bare-pack --linked --host ios-arm64 backend/index.js -o assets/backend.bundle.mjs

# iOS + Android
bare-pack --linked --host ios-arm64 --host android-arm64 backend/index.js -o assets/backend.bundle.mjs
```

If an addon is missing, install it: `npm install sodium-native` (or whichever addon is needed).

---

**RPC timeout (30-second errors)**

Bridge calls time out after 30 seconds. Common causes:

1. The worklet has not finished booting. Wait for the `READY` event before making RPC calls.
2. The Hyperswarm DHT is unreachable (check network connectivity).
3. A drive you are trying to read has no peers seeding it.

To debug, check the worklet's output:

```typescript
rpc.onError((err) => {
  console.error('Worklet error:', err);
});
```

---

**App loads but window.pear is undefined**

The bridge is only injected for URLs served through the local proxy (`http://127.0.0.1:{port}/...`). If you load a raw HTTP URL directly in the WebView, the bridge is still injected via the `injectedJavaScript` prop, but the worklet may not be connected.

Check for availability:

```javascript
if (typeof window.pear === 'undefined') {
  console.error('PearBridge not available -- are you running inside PearBrowser?');
}
```

---

**Sync group not found**

You must call `sync.create()` or `sync.join()` before any other sync operations. The sync group only exists in memory and must be initialized each time the app loads.

Pattern:

```javascript
const savedKey = localStorage.getItem('my-app-invite-key');
if (savedKey) {
  await window.pear.sync.join('my-app', savedKey);
} else {
  const result = await window.pear.sync.create('my-app');
  localStorage.setItem('my-app-invite-key', result.inviteKey);
}
```

---

**CocoaPods install fails**

Set the locale before running pod install:

```bash
cd ios && LANG=en_US.UTF-8 pod install && cd ..
```

If pods are out of date:

```bash
cd ios && pod repo update && LANG=en_US.UTF-8 pod install && cd ..
```

---

### How to Debug the Worklet

The Bare worklet runs in a separate process. Its stdout/stderr goes to the system log, not the React Native console.

**On macOS (simulator):**

```bash
# View worklet logs in Console.app
# Open Console.app → filter by process "PearBrowser"

# Or use the command line
log stream --predicate 'processImagePath CONTAINS "PearBrowser"' --level debug
```

**From Xcode:**

Build and run from Xcode. The worklet's console output appears in Xcode's debug console alongside React Native logs.

**Adding debug logging in the worklet:**

```javascript
// backend/index.js or any backend module
console.log('[MyModule]', 'Debug message', someData)
```

These logs go to the Bare runtime's stdout, which Xcode captures.

### How to Debug the Bridge

The bridge JavaScript runs inside the WebView. Use Safari's Web Inspector to debug it.

**Enable Web Inspector:**

1. On your Mac: Safari -> Settings -> Advanced -> Show Develop menu
2. On the iOS Simulator: Settings -> Safari -> Advanced -> Web Inspector (ON)
3. Run PearBrowser, navigate to a P2P app
4. In Safari on your Mac: Develop -> Simulator -> select the WebView

**In the WebView console, you can test bridge calls directly:**

```javascript
// Check if bridge is loaded
window.__pearBridgeInjected  // should be true

// Test a sync call
window.pear.sync.create('test-app').then(console.log).catch(console.error)

// Check pending bridge calls
window.pear.identity.getPublicKey().then(console.log)
```

**Bridge message flow logging:**

The bridge logs initialization status to the WebView console:

```
[PearBridge] window.pear and window.posAPI injected
[PearBridge] POS sync group ready: 4a3b2c1de5f6...
```

If you see `POS sync init failed`, the worklet backend is not connected or the Autobase could not initialize.

---

## Quick Reference

### Minimal App Checklist

- [ ] Directory with `index.html` at root
- [ ] `manifest.json` with `name`, `version`, `entry` fields
- [ ] `window.pear` availability check for standalone testing
- [ ] Sync group init on load (create or join)
- [ ] Invite key saved to `localStorage` for persistence
- [ ] `icon.png` at 256x256 (optional but recommended)

### Publish Checklist

- [ ] App works in a regular browser (without P2P features)
- [ ] `manifest.json` is valid JSON with required fields
- [ ] Run `node tools/publish-app.js ./my-app --name "My App"`
- [ ] Keep the publish process running (or seed on a relay)
- [ ] Register with a catalog relay via `/v1/register`
- [ ] Test loading in PearBrowser simulator
