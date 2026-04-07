# PearBrowser User Flows

Comprehensive user flow diagrams for PearBrowser, a P2P mobile app platform
for iOS. Covers the three core features: P2P Browser, App Store, and Site Builder.

---

## Architecture Overview

```
+-------------------------------------------------------------------+
|                       PearBrowser (iOS)                           |
|                                                                   |
|   +--------------------------+   +-----------------------------+  |
|   |     React Native UI      |   |     Bare Kit Worklet        |  |
|   |  (App.tsx + Screens)     |   |     (P2P Engine)            |  |
|   |                          |   |                             |  |
|   |  HomeScreen              |   |  Hyperswarm   (DHT + NAT)   |  |
|   |  BrowseScreen + WebView  |   |  Corestore    (storage)     |  |
|   |  AppStoreScreen          |   |  Hyperdrive   (content)     |  |
|   |  MySitesScreen           |   |  Autobase     (sync)        |  |
|   |  SiteEditorScreen        |   |  HyperProxy   (HTTP bridge) |  |
|   |  MoreScreen              |   |  CatalogManager             |  |
|   |                          |   |  AppManager                 |  |
|   |  PearRPC (client)        |   |  SiteManager                |  |
|   |  bridge-inject.ts        |   |  PearBridge                 |  |
|   +-----------+--------------+   |  RelayClient                |  |
|               |                  +-------------+---------------+  |
|               | IPC (length-prefixed JSON)     |                  |
|               +--------------------------------+                  |
+-------------------------------------------------------------------+
                                |
              +-----------------+-----------------+
              |                                   |
     +--------v--------+              +----------v----------+
     |   HiveRelay     |              |   Hyperswarm DHT    |
     |   HTTP Gateway  |              |   (Peer-to-Peer)    |
     |   (fast-path)   |              |   hole-punching     |
     +--------+--------+              +----------+----------+
              |                                   |
              +------- Internet / LAN ------------+
```

**RPC Protocol:** Length-prefixed JSON over IPC. Each message is
`[8-char hex length][JSON payload]`. Commands (RN -> Worklet) use
numeric IDs (1=NAVIGATE, 10=LOAD_CATALOG, 20=CREATE_SITE, etc.).
Events (Worklet -> RN) use IDs 100+ (100=READY, 101=PEER_COUNT).

---

## Flow 1: First Launch

The app boots the P2P engine, connects to the DHT, and shows the home screen.

```
User              React Native (App.tsx)         Worklet (index.js)          Network
----              -------------------------      -------------------         -------
taps app icon  -> App() mounts
                  useState('booting')
                  useEffect boot()
                  new Worklet()
                  new PearRPC(worklet.IPC)
                  rpc.onReady(cb)              <- registers before start
                  rpc.onPeerCount(cb)          <- registers before start
                  rpc.onError(cb)              <- registers before start
                  worklet.start(bundle, args)  -> boot() called
                  setState('connecting')          new Corestore(storagePath)
                  shows "Connecting to DHT..."    store.ready()
                                                  new Hyperswarm()
                                                  swarm.on('connection')
                                                  new CatalogManager(store, swarm)
                                                  new AppManager(store, swarm)
                                                  new SiteManager(store, swarm)
                                                  new PearBridge(store, swarm)
                                                  restore pearbrowser-state.json
                                                  new RelayClient({relays})
                                                  new HyperProxy(getDrive, onError, relay)
                                                  proxy.start()              -> binds 127.0.0.1:PORT
                                                  rpc.event(EVT_READY, {port})
                  onReady(port) fires          <-
                  setProxyPort(port)
                  setState('ready')
                                                                                DHT bootstrap
                                                  swarm connects              -> hole-punching
                                                                              <- peer found
                                                  store.replicate(conn)
                                                  peerCount++
                                                  rpc.event(EVT_PEER_COUNT)
sees Home tab  <- setPeerCount(count)          <-
with status      renders HomeScreen
"Connected"      4-tab navigation visible
```

**Key detail:** RPC callbacks are registered BEFORE `worklet.start()` to avoid
missing the EVT_READY event. A 30-second timeout falls back to demo mode if
the worklet fails to boot.

**State machine:** `booting` -> `connecting` -> `ready` (or `error`)

---

## Flow 2: Browse a hyper:// Site

User enters a hyper:// URL. The worklet resolves it through hybrid fetch
(relay HTTP fast-path racing against P2P Hyperdrive).

```
User              React Native (BrowseScreen)     Worklet                     Network
----              ---------------------------     -------                     -------
taps Browse tab-> setActiveTab('browse')
                  renders BrowseScreen
                  URL bar at bottom

types URL      -> setInputText(url)
taps Go        -> handleSubmit()
                  auto-prefix hyper:// if needed
                  handleNavigate(url)
                  setLoading(true)
                  setCurrentUrl(url)
                  rpc.navigate(url)             -> CMD_NAVIGATE handler
                                                   parse URL: key + path
                                                   ensureBrowseDrive(key)
                                                   |  check drives Map
                                                   |  if at MAX_BROWSE_DRIVES (20)
                                                   |    evict oldest drive
                                                   |  new Hyperdrive(store, key)
                                                   |  drive.ready()
                                                   |  swarm.join(discoveryKey)   -> DHT lookup
                                                   |                            <- peers found
                                                   build proxy URL:
                                                     127.0.0.1:PORT/hyper/KEY/path
                                                   return {localUrl, key, path}
                  result = await reply          <-
                  setWebViewUrl(result.localUrl)
                  WebView loads URL             -> HTTP GET 127.0.0.1:PORT/hyper/KEY/path
                                                   HyperProxy._handle()
                                                   parse /hyper/KEY/path
                                                   _hybridFetch(keyHex, filePath)
                                                   |
                                                   |  +-- RelayClient.fetch() -----> HTTP GET relay:9100/v1/hyper/KEY/path
                                                   |  |                             <- 200 + content (fast)
                                                   |  |
                                                   |  +-- _fetchP2P() ------------> Hyperdrive.get(path)
                                                   |  |   getDriveForProxy()        <- content from peers (reliable)
                                                   |  |   wait if version === 0
                                                   |  |
                                                   |  Promise.any() -> first success wins
                                                   |
                                                   set X-Source header ('relay' or 'p2p')
                                                   if HTML: inject <base> tag
                                                     <head> -> <head><base href="proxy/hyper/KEY/">
                                                   return content to WebView
renders page   <- WebView displays HTML
                  handleWebViewNav()
                  map localhost URL back to hyper://
                  setCurrentUrl(hyper://KEY/path)
sees page      <- URL bar shows hyper://... address
                  StatusDot shows peer count
```

**Relative links:** The injected `<base>` tag ensures relative links
(e.g., `style.css`, `images/photo.png`) resolve through the proxy as
`127.0.0.1:PORT/hyper/KEY/style.css` automatically.

**Link interception:** `onShouldStartLoadWithRequest` intercepts clicks:
- `hyper://` links -> re-routed through handleNavigate()
- `http://` / `https://` links -> opened in system browser via Linking.openURL()
- Proxy URLs (127.0.0.1:PORT) -> allowed through to WebView

---

## Flow 3: Discover and Install an App

User opens the Apps tab, loads a catalog from HTTP or P2P, browses apps,
and installs one.

```
User              React Native (AppStoreScreen)   Worklet                     Network
----              -----------------------------   -------                     -------
taps Apps tab  -> setActiveTab('store')
                  renders AppStoreScreen
                  useEffect: auto-load catalog

                  catalog URL = "http://127.0.0.1:9200"
                  handleLoadCatalog()
                  setLoading(true)

                  if HTTP URL:
                    fetch(url + '/catalog.json') ---------------------------------> catalog-relay:9200
                                                                                 <- JSON: {apps: [...]}
                    setApps(catalog.apps)
                  else if hyper:// key:
                    rpc.loadCatalog(keyHex)      -> CMD_LOAD_CATALOG handler
                                                    CatalogManager.loadCatalog()
                                                    new Hyperdrive(store, key)
                                                    swarm.join(discoveryKey)     -> DHT lookup
                                                    _waitForData(drive)          <- peer replicates
                                                    drive.get('/catalog.json')   <- catalog content
                                                    parse + load icon data
                                                    return catalog data
                    setApps(catalog.apps)       <-

sees app list  <- renders AppCard for each app
                  shows name, description, icon
                  button: "Get" (not installed)
                         "Open" (installed)

taps "Get"     -> handleInstall(app)
                  setInstalling(app.id)
                  rpc.installApp(appInfo)        -> CMD_INSTALL_APP handler
                                                    AppManager.install(appInfo)
                                                    new Hyperdrive(store, driveKey)
                                                    drive.ready()
                                                    swarm.join(discoveryKey)     -> DHT: find app peers
                                                    _waitForContent(drive)       <- download index.html
                                                    |  poll drive.entry('/index.html')
                                                    |  onProgress(5, 10, 15...)
                                                    rpc.event(EVT_INSTALL_PROGRESS)
                  onInstallProgress fires      <-   {appId, progress: 50%}
                                                    activeDrives.set(keyHex, drive)
                                                    installed.set(id, appInfo)
                                                    persistState()               -> write state.json
                                                    return {id, driveKey, name}
                  setInstalled([...prev, id])  <-
sees "Open"    <- Alert("Installed - ready to use")
                  button changes to "Open"

taps "Open"    -> handleLaunch(app)
                  if HTTP catalog:
                    build relay URL: relay:9200/v1/hyper/KEY/index.html
                    onLaunchApp(httpUrl)
                  else:
                    onLaunchApp(app.driveKey)
                  -> App.tsx handleLaunchByKey()
                  setBrowseUrl(url)
                  setActiveTab('browse')
                  BrowseScreen loads with initialUrl
                  -> handleNavigate(url)
                  (continues as Flow 2 or direct HTTP load)

sees app       <- app renders in WebView
running
```

**Catalog sources:** Apps can be discovered via:
1. HTTP catalog relay (`http://relay:9200/catalog.json`) -- fast, centralized index
2. P2P Hyperdrive key -- fully decentralized, loaded via worklet

**Install is lightweight:** The app's Hyperdrive is joined on the swarm, and
the worklet waits for `index.html` to arrive (up to 30s). Files are fetched
on demand afterward via the proxy.

---

## Flow 4: Launch an Installed App (Pear POS)

User taps an installed app (Pear POS). The app loads from the relay HTTP
gateway, and the injected `window.posAPI` bridge connects it to Autobase
data sync.

```
User              React Native                    Worklet                     Network
----              --------------                  -------                     -------
taps Pear POS  -> HomeScreen: handleLaunchApp(id)
on Home screen    rpc.launchApp('pear-pos')     -> CMD_LAUNCH_APP handler
                                                    app = installed.get('pear-pos')
                                                    appManager.getDrive(app.driveKey)
                                                    |  open Hyperdrive if not active
                                                    |  swarm.join(discoveryKey)  -> rejoin swarm
                                                    return {
                                                      localUrl: 127.0.0.1:PORT/app/DRIVE_KEY/index.html,
                                                      appId: 'pear-pos', name: 'Pear POS'
                                                    }
                  setBrowseUrl(hyper://pear-pos) <-
                  setActiveTab('browse')
                  BrowseScreen renders
                  WebView source = localUrl

                  WebView loads:
                  injectedJavaScript = BRIDGE_INJECT_JS
                  |
                  |  injects window.pear API:
                  |    pear.sync.create/join/append/get/list
                  |    pear.identity.getPublicKey
                  |
                  |  injects window.posAPI:
                  |    posAPI.register/login/getMe
                  |    posAPI.createProduct/listProducts/...
                  |    posAPI.createTransaction/listTransactions
                  |    posAPI.getSyncStatus/joinSyncGroup
                  |
                  |  auto-init POS sync group:
                  |    check localStorage for invite key
                  |    if found: call sync.join(appId, key)
                  |    else: call sync.create(appId)

                  WebView postMessage()         -> BrowseScreen.handleBridgeMessage()
                  {type:'pear-bridge',              rpc.request(CMD_BRIDGE, {
                   method:'sync.create',             method: 'sync.create',
                   args:{appId:'pear-pos'}}          args: {appId: 'pear-pos'}
                                                   })
                                                 -> CMD_BRIDGE handler
                                                    PearBridge.createSyncGroup('pear-pos')
                                                    new Autobase(store, null, {apply, open})
                                                    base.ready()
                                                    derive topic from inviteKey
                                                    swarm.join(topic, server+client)  -> DHT announce
                                                    return {inviteKey, appId}
                  injectJavaScript(reply)       <-
                  WebView receives reply
                  POS app stores inviteKey in localStorage

sees POS app   <- Pear POS UI renders
                  products, transactions, etc.

                  --- App calls posAPI.createProduct(data) ---

taps "Add       WebView: posAPI.createProduct({name, price})
Product"          -> postMessage({type:'pear-bridge',
                     method:'sync.append',
                     args:{appId:'pear-pos', op:{type:'product:create', data}}})

                  BrowseScreen relays to RPC   -> CMD_BRIDGE handler
                                                  PearBridge.append('pear-pos', op)
                                                  base.append(JSON.stringify(entry))
                                                  _defaultApply runs:
                                                    put('products!id', product)
                                                    put('products-by-barcode!...', id)
                                                    put('products-by-name!...', id)
                                                  base.view.update()
                                                  return {ok: true}
                  WebView receives confirmation <-

                  --- App calls posAPI.listProducts() ---

                  postMessage(sync.list, prefix:'products!') -> PearBridge.list()
                                                                base.view.update()
                                                                createReadStream({gte, lt})
                                                                return [{key, value}, ...]
                  WebView gets product list    <-
sees products  <- POS renders product catalog
```

**Bridge message flow:**
```
WebView JS                React Native               Worklet
----------                ------------               -------
window.posAPI.fn()
  -> call(method, args)
    -> postMessage(JSON)
                           onMessage(event)
                           parse JSON
                           rpc.request(CMD_BRIDGE, {method, args})
                                                      handleBridge(data)
                                                      PearBridge[method](args)
                                                      return result
                           injectJavaScript(reply)
  <- Promise resolves
```

---

## Flow 5: Create and Publish a Website

User creates a personal website using the block editor, publishes it to
the Hyperswarm, and shares the hyper:// key.

```
User              React Native                    Worklet                     Network
----              --------------                  -------                     -------
taps More tab  -> MoreScreen renders
taps "My Sites"-> onNavigateToSites()
                  setShowSites(true)
                  MySitesScreen renders
                  useEffect: rpc.listSites()    -> CMD_LIST_SITES
                                                    SiteManager.listSites()
                                                    return [{siteId, keyHex, name,
                                                             published, url}, ...]
                  setSites(list)               <-

types name:
"My Portfolio" -> setNewName("My Portfolio")

taps Create    -> handleCreate()
                  rpc.createSite("My Portfolio")-> CMD_CREATE_SITE handler
                                                    SiteManager.createSite("My Portfolio")
                                                    new Hyperdrive(store) <- writable, user owns keypair
                                                    drive.ready()
                                                    keyHex = drive.key.toString('hex')
                                                    siteId = keyHex.slice(0, 16)
                                                    drive.put('/index.html', defaultHtml)
                                                    drive.put('/style.css', defaultCss)
                                                    sites.set(siteId, {drive, name, ...})
                                                    return {siteId, keyHex, name}
                  onEditSite(result.siteId)    <-
                  setEditingSiteId(siteId)
                  SiteEditorScreen renders

                  --- Block Editor ---

adds heading   -> block: {type:'heading', level:1, text:'Welcome'}
block
adds text      -> block: {type:'text', text:'I build P2P apps.'}
block
adds image     -> block: {type:'image', src:'photo.png', alt:'Me'}
block
adds link      -> block: {type:'link', href:'hyper://abc...', text:'My App'}
block
adds divider   -> block: {type:'divider'}
adds code      -> block: {type:'code', text:'npm install pear-pos'}
block

taps Save      -> rpc.updateSite(siteId, blocks, theme)
                                                -> CMD_UPDATE_SITE handler
                                                    SiteManager.buildFromBlocks(siteId, blocks, theme)
                                                    _renderBlocks(blocks, name, theme)
                                                    |  heading -> <h1>...</h1>
                                                    |  text    -> <p>...</p>
                                                    |  image   -> <img src="..." alt="...">
                                                    |  link    -> <a href="...">...</a>
                                                    |  divider -> <hr>
                                                    |  code    -> <pre><code>...</code></pre>
                                                    _renderThemeCss(theme)
                                                    |  CSS variables: --primary, --bg, --text, --font
                                                    |  Responsive layout, max-width: 680px
                                                    drive.put('/index.html', html)
                                                    drive.put('/style.css', css)
                                                    return {siteId}
                  "Saved" confirmation         <-

taps Preview   -> onPreview(hyper://KEY)
                  handleNavigate(url)
                  switch to Browse tab
                  (continues as Flow 2)

sees preview   <- rendered website in WebView

                  --- Publish ---

navigates back
taps Publish   -> handlePublish(siteId)
                  rpc.publishSite(siteId)       -> CMD_PUBLISH_SITE handler
                                                    SiteManager.publishSite(siteId)
                                                    swarm.join(discoveryKey,
                                                      {server: true, client: false})  -> announce on DHT
                                                    swarm.flush()                      <- DHT confirms
                                                    site.published = true
                                                    persistState()
                                                    rpc.event(EVT_SITE_PUBLISHED)
                                                    return {siteId, keyHex, url}
                  Alert("Published! Your site  <-
sees "Live"       is live at hyper://KEY...")
badge

taps Share     -> handleShare(site)
                  Share.share({
                    message: "Check out my P2P site: hyper://KEY",
                    url: site.url
                  })
                  iOS Share sheet opens

shares key     <- sends hyper:// link via
                  Messages, AirDrop, etc.
```

**Ownership model:** The user's Hyperdrive is created without specifying a key,
so Corestore generates a new keypair. The user owns the private key. The site
is writable only by them. The hyper:// URL is the public key.

**Publishing:** `swarm.join(discoveryKey, { server: true })` makes the phone
a server for this drive. Anyone with the hyper:// key can download the site
directly from the user's phone (or any other peer that has replicated it).

---

## Flow 6: Multi-Device POS Sync

Device A creates products in Pear POS. Autobase replicates the operations
to Device B, which sees the products appear automatically.

```
Device A (iPhone)                                  Device B (iPad)
-----------------                                  ----------------

Pear POS running                                   Pear POS running
sync group created                                 (not yet synced)

posAPI.getSyncInviteKey()
  -> reads localStorage
  <- inviteKey = "abc123..."

User A shares invite key
(via Messages, QR code, etc.)  ========>           User B enters invite key

                                                   posAPI.joinSyncGroup("abc123...")
                                                     -> postMessage -> RPC -> CMD_BRIDGE
                                                     -> PearBridge.joinSyncGroup()
                                                        new Autobase(store, bootstrapKey, {apply, open})
                                                        base.ready()
                                                        base.view.update()
                                                        topic = sha256(inviteKey)
                                                        swarm.join(topic, server+client)  -> DHT lookup
                                                                                          <- find Device A

                                   Autobase Replication
                                   ====================

Device A Hyperswarm           <--- encrypted connection --->     Device B Hyperswarm
store.replicate(conn)                                            store.replicate(conn)

  Autobase writer cores sync in both directions:
  Device A's writer -> Device B receives A's operations
  Device B's writer -> Device A receives B's operations

User A creates product:

posAPI.createProduct({
  name: "Espresso", price: 350
})
  -> PearBridge.append(op)
     base.append({
       type: 'product:create',
       data: {id, name, price},
       timestamp, deviceId
     })
     _defaultApply():
       put('products!prod_123', data)
       put('products-by-name!espresso!prod_123', id)
     base.view.update()

  Autobase replicates writer core  -------->       Device B's Autobase detects new data
                                                   base.view.update()
                                                   _defaultApply() runs same batch:
                                                     put('products!prod_123', data)
                                                     put('products-by-name!espresso!prod_123', id)

                                                   Next time POS calls posAPI.listProducts():
                                                     PearBridge.list('pear-pos', 'products!')
                                                     base.view.update()
                                                     createReadStream({gte:'products!', lt:'products!\xff'})
                                                     <- [{key:'products!prod_123', value:{name:"Espresso"}}]

                                                   User B sees "Espresso" in product list

User B creates product:
                                                   posAPI.createProduct({
                                                     name: "Latte", price: 450
                                                   })
                                                     -> PearBridge.append(op)
                                                        base.append(...)

  Device A receives B's operation  <--------       Autobase replicates
  _defaultApply() runs
  put('products!prod_456', data)

User A calls listProducts():
  sees both "Espresso" and "Latte"

         +----------------+              +----------------+
         |   Device A     |              |   Device B     |
         |                |              |                |
         | Autobase       | <-- sync --> | Autobase       |
         |  Writer A      |              |  Writer B      |
         |  Linearized    |              |  Linearized    |
         |  View (Hyperbee)              |  View (Hyperbee)
         |                |              |                |
         | products!      |              | products!      |
         |   prod_123     |              |   prod_123     |
         |   prod_456     |              |   prod_456     |
         +----------------+              +----------------+
```

**Conflict resolution:** Autobase linearizes operations from multiple writers
into a single deterministic view. The `_defaultApply` function processes
each operation idempotently (create, update, delete, stock:adjust). Both
devices converge to the same state regardless of operation order.

**Sync topology:** Both devices join the same DHT topic (sha256 of the
invite key). Hyperswarm handles NAT traversal via hole-punching. Corestore
replicates the Autobase writer cores bidirectionally.

---

## Flow 7: Developer Publishes an App

A developer builds a P2P app, publishes it using `publish-app.js`, seeds it
on a relay, and it appears in the PearBrowser catalog.

```
Developer (Terminal)                    Catalog Relay (Server)           PearBrowser (User)
--------------------                    ----------------------           ------------------

mkdir my-app/
  index.html
  style.css
  app.js
  icon.png

node publish-app.js ./my-app \
  --name "My App" \
  --description "Does things" \
  --author "dev" \
  --category "utilities"

  new Corestore(storagePath)
  new Hyperdrive(store)
  drive.ready()
  for each file in ./my-app/:
    drive.put('/index.html', content)
    drive.put('/style.css', content)
    drive.put('/app.js', content)
    drive.put('/icon.png', content)
  generate /manifest.json:
    {name, version, description,
     author, icon, entry, categories}
  drive.put('/manifest.json', manifest)

  new Hyperswarm()
  swarm.join(drive.discoveryKey,
    {server:true})                      catalog-relay running:
  swarm.join(APP_ANNOUNCE_TOPIC,          swarm joined APP_ANNOUNCE_TOPIC
    {server:true})     -------->          as client
  swarm.flush()                           handleNewPeer(conn, info)
                                          tryDiscoverApp(peerKey)
  prints:
    Key: abc123...def
    URL: hyper://abc123...def
    "Keep process running to serve"
                                        --- OR via HTTP registration ---

  curl -X POST relay:9200/v1/register \
    -d '{"driveKey":"abc123...def"}' ---> POST /v1/register handler
                                          new Hyperdrive(store, driveKey)
                                          swarm.join(appDrive.discoveryKey)
                                          wait for manifest.json (up to 30s)
                                          <- manifest arrives from publisher
                                          registerApp(driveKey, manifest)
                                          apps.set(driveKey, {manifest, ...})
                                          updateCatalog()
                                            build catalog.json:
                                              {version, name, apps: [{
                                                id, name, description,
                                                author, version, driveKey,
                                                categories
                                              }]}
                                            catalogDrive.put('/catalog.json', data)
                                          <- 200 {ok: true, app: {...},
                                                  catalogKey: "..."}

                                                                         User opens Apps tab
                                                                         handleLoadCatalog()
                                                                         fetch(relay:9200/catalog.json)
                                                                           <-------------------------- GET /catalog.json
                                                                                                       catalogDrive.get('/catalog.json')
                                                                           ---------------------------> catalog JSON
                                                                         setApps(catalog.apps)
                                                                         sees "My App" in list
                                                                         taps "Get"
                                                                         (continues as Flow 3)

                                          --- Serving app files ---

                                        GET /v1/hyper/abc.../index.html  <-- PearBrowser hybrid fetch
                                          drive = new Hyperdrive(key)        (relay fast-path)
                                          content = drive.get('/index.html')
                                          return content
                                          X-Served-By: catalog-relay   ----> WebView renders app

  publisher keeps running
  (serves app to any peer)
```

**Two registration paths:**
1. **DHT discovery:** Publisher joins `APP_ANNOUNCE_TOPIC`. Catalog relay
   listens on the same topic and discovers the app automatically.
2. **HTTP registration:** Developer POSTs their drive key to
   `relay:9200/v1/register`. The relay opens the drive, reads the manifest,
   and adds the app to the catalog.

**Serving:** The catalog relay also serves app files via its HTTP gateway
(`/v1/hyper/KEY/path`). PearBrowser's HyperProxy races this relay against
P2P Hyperdrive fetching. The relay typically wins (HTTP is faster than
DHT lookup + hole-punching).

---

## Appendix: Command and Event Reference

### Commands (React Native -> Worklet)

| ID  | Name              | Data                              | Description                     |
|-----|-------------------|-----------------------------------|---------------------------------|
| 1   | CMD_NAVIGATE      | `{url}`                           | Resolve hyper:// to proxy URL   |
| 2   | CMD_GET_STATUS    | `{}`                              | Get engine status               |
| 10  | CMD_LOAD_CATALOG  | `{keyHex}`                        | Load app catalog from Hyperdrive|
| 11  | CMD_INSTALL_APP   | `{id, driveKey, name, ...}`       | Install app                     |
| 12  | CMD_UNINSTALL_APP | `{id}`                            | Uninstall app                   |
| 13  | CMD_LAUNCH_APP    | `{id}`                            | Get proxy URL for installed app |
| 14  | CMD_LIST_INSTALLED| `{}`                              | List installed apps             |
| 15  | CMD_CHECK_UPDATES | `{}`                              | Check for app updates           |
| 20  | CMD_CREATE_SITE   | `{name}`                          | Create new writable Hyperdrive  |
| 21  | CMD_UPDATE_SITE   | `{siteId, blocks, theme}`         | Build site from content blocks  |
| 22  | CMD_PUBLISH_SITE  | `{siteId}`                        | Start swarming (go live)        |
| 23  | CMD_UNPUBLISH_SITE| `{siteId}`                        | Stop swarming                   |
| 24  | CMD_LIST_SITES    | `{}`                              | List user's sites               |
| 25  | CMD_DELETE_SITE   | `{siteId}`                        | Delete a site                   |
| 200 | CMD_BRIDGE        | `{method, args}`                  | WebView -> P2P bridge call      |
| 99  | CMD_STOP          | `{}`                              | Graceful shutdown               |

### Events (Worklet -> React Native)

| ID  | Name                | Data                            | Description                     |
|-----|---------------------|---------------------------------|---------------------------------|
| 100 | EVT_READY           | `{port}`                        | Proxy server ready              |
| 101 | EVT_PEER_COUNT      | `{peerCount}`                   | Peer count changed              |
| 102 | EVT_ERROR            | `{type, message}`               | Error occurred                  |
| 103 | EVT_INSTALL_PROGRESS | `{appId, progress}`             | App download progress (0-100)   |
| 104 | EVT_SITE_PUBLISHED   | `{siteId, keyHex, url}`         | Site published successfully     |

### Bridge Methods (WebView -> Worklet via CMD_BRIDGE)

| Method                    | Args                              | Description                     |
|---------------------------|-----------------------------------|---------------------------------|
| `sync.create`             | `{appId}`                         | Create Autobase sync group      |
| `sync.join`               | `{appId, inviteKey}`              | Join existing sync group        |
| `sync.append`             | `{appId, op}`                     | Append operation to Autobase    |
| `sync.get`                | `{appId, key}`                    | Get value from Hyperbee view    |
| `sync.list`               | `{appId, prefix, opts}`           | List entries by prefix          |
| `sync.status`             | `{appId}`                         | Get sync group status           |
| `identity.getPublicKey`   | `{}`                              | Get device's DHT public key     |
