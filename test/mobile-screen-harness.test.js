const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const keyHex = 'a'.repeat(64)

function flushMicrotasks () {
  return Promise.resolve().then(() => Promise.resolve())
}

function createReactHarness () {
  const hooks = []
  let hookIndex = 0
  let pendingEffects = []

  const depsChanged = (prev, next) => {
    if (!prev || !next) return true
    if (prev.length !== next.length) return true
    return next.some((value, i) => !Object.is(value, prev[i]))
  }

  const React = {
    __esModule: true,
    createElement (type, props, ...children) {
      const nextProps = {
        ...(props || {}),
        children: children.length <= 1 ? children[0] : children
      }
      if (typeof type === 'function') return type(nextProps)
      return {
        type,
        props: nextProps
      }
    },
    useState (initial) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
        }
      ]
    },
    useEffect (fn, deps) {
      const index = hookIndex++
      const prev = hooks[index]
      if (depsChanged(prev, deps)) {
        hooks[index] = deps || []
        pendingEffects.push(fn)
      }
    },
    useCallback (fn, deps) {
      const index = hookIndex++
      const prev = hooks[index]
      if (!prev || depsChanged(prev.deps, deps)) hooks[index] = { fn, deps: deps || [] }
      return hooks[index].fn
    },
    useRef (initial) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    memo (component) {
      return component
    }
  }
  React.default = React

  function render (Component, props) {
    hookIndex = 0
    pendingEffects = []
    const tree = Component(props)
    for (const effect of pendingEffects) effect()
    return tree
  }

  return { React, render }
}

function createReactNativeStub () {
  const alerts = []
  const shared = []
  const clipboard = { value: '' }

  return {
    module: {
      __esModule: true,
      View: 'View',
      Text: 'Text',
      ScrollView: 'ScrollView',
      TouchableOpacity: 'TouchableOpacity',
      TextInput: 'TextInput',
      ActivityIndicator: 'ActivityIndicator',
      KeyboardAvoidingView: 'KeyboardAvoidingView',
      StatusBar: 'StatusBar',
      Modal: 'Modal',
      NativeModules: {},
      Switch: 'Switch',
      Linking: {
        opened: [],
        openURL (url) { this.opened.push(url) }
      },
      StyleSheet: {
        absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
        create: (styles) => styles
      },
      Alert: {
        alert: (...args) => alerts.push(args),
        prompt: null
      },
      Clipboard: {
        async getString () { return clipboard.value },
        setString (value) { clipboard.value = value }
      },
      Platform: { OS: 'ios', Version: 'test' },
      Share: {
        async share (payload) {
          shared.push(payload)
          return { action: 'sharedAction' }
        }
      }
    },
    alerts,
    shared,
    clipboard
  }
}

function loadTsxModule (relativeFile, stubs) {
  const filename = path.join(root, relativeFile)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText

  const mod = { exports: {} }
  const sandbox = {
    module: mod,
    exports: mod.exports,
    console,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    TextEncoder,
    URL,
    fetch: stubs.fetch || global.fetch,
    require (specifier) {
      if (specifier in stubs) return stubs[specifier]
      return require(specifier)
    }
  }
  vm.runInNewContext(output, sandbox, { filename })
  return mod.exports
}

function childrenOf (node) {
  if (!node || typeof node !== 'object' || !node.props) return []
  const children = node.props.children
  if (children == null || children === false) return []
  return Array.isArray(children) ? children : [children]
}

function textContent (node) {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  return childrenOf(node).map(textContent).join('')
}

function findAll (node, predicate, out = []) {
  if (node == null || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (typeof node === 'object') {
    if (predicate(node)) out.push(node)
    for (const child of childrenOf(node)) findAll(child, predicate, out)
  }
  return out
}

function findTouchableWithText (tree, text) {
  return findAll(tree, (node) => node.type === 'TouchableOpacity' && textContent(node).includes(text))[0]
}

function findAllTouchablesWithText (tree, text) {
  return findAll(tree, (node) => node.type === 'TouchableOpacity' && textContent(node).includes(text))
}

function findByProp (tree, type, prop, value) {
  return findAll(tree, (node) => node.type === type && node.props && node.props[prop] === value)[0]
}

function makeBaseStubs (harness, rn) {
  return {
    react: harness.React,
    'react-native': rn.module,
    '../lib/theme': {
      colors: {
        accent: '#ff9500',
        bg: '#0a0a0a',
        border: '#333',
        error: '#ef4444',
        success: '#22c55e',
        surface: '#111',
        surfaceElevated: '#181818',
        textMuted: '#777',
        textPrimary: '#eee',
        textSecondary: '#bbb',
        warning: '#facc15'
      }
    }
  }
}

function makeComponentStubs (harness) {
  return {
    '../components/StatusDot': {
      StatusDot: ({ status, peerCount }) => harness.React.createElement('Text', null, `status:${status}:${peerCount}`)
    },
    '../components/SiteCard': {
      SiteCard: ({ name, description, onPress, onAction, actionLabel }) => harness.React.createElement(
        'TouchableOpacity',
        { onPress: onPress || onAction },
        harness.React.createElement('Text', null, name),
        description ? harness.React.createElement('Text', null, description) : null,
        actionLabel ? harness.React.createElement('Text', null, actionLabel) : null
      )
    },
    '../components/OfflineIndicator': {
      OfflineIndicator: ({ isOffline }) => isOffline ? harness.React.createElement('Text', null, 'Offline') : null
    },
    '../components/StorageMeter': {
      StorageMeter: ({ used, limit, onClearCache }) => harness.React.createElement(
        'View',
        null,
        harness.React.createElement('Text', null, `storage:${used}/${limit}`),
        harness.React.createElement('TouchableOpacity', { onPress: onClearCache }, harness.React.createElement('Text', null, 'Clear Cache'))
      )
    }
  }
}

function makeAppScreenStubs (harness) {
  const simpleScreen = (label) => () => harness.React.createElement('Text', null, label)
  return {
    './screens/HomeScreen': { HomeScreen: simpleScreen('Home screen') },
    './screens/ExploreScreen': { ExploreScreen: simpleScreen('Explore screen') },
    './screens/BrowseScreen': { BrowseScreen: simpleScreen('Browse screen') },
    './screens/MoreScreen': { MoreScreen: simpleScreen('More screen') },
    './screens/BookmarksScreen': { BookmarksScreen: simpleScreen('Bookmarks screen') },
    './screens/HistoryScreen': { HistoryScreen: simpleScreen('History screen') },
    './screens/SettingsScreen': { SettingsScreen: simpleScreen('Settings screen') },
    './screens/QRScannerScreen': { QRScannerScreen: simpleScreen('QR scanner') },
    './screens/BackupPhraseScreen': { BackupPhraseScreen: simpleScreen('Backup phrase') },
    './screens/RestoreIdentityScreen': { RestoreIdentityScreen: simpleScreen('Restore identity') },
    './screens/MySitesScreen': { MySitesScreen: simpleScreen('My sites') },
    './screens/TemplatePickerScreen': {
      TemplatePickerScreen: simpleScreen('Template picker')
    },
    './screens/SiteEditorScreen': { SiteEditorScreen: simpleScreen('Site editor') }
  }
}

function loadAppWithRuntime (harness, rn, runtime) {
  class FakeWorklet {
    constructor () {
      this.IPC = { on: () => {} }
    }

    start (...args) {
      runtime.workletStarts.push(args)
    }

    terminate () {
      runtime.terminated = true
    }
  }

  class FakePearRPC {
    constructor () {
      runtime.rpc = this
      this.eventHandlers = new Map()
    }

    onReady (handler) { this.readyHandler = handler }
    onPeerCount (handler) { this.peerCountHandler = handler }
    onBootProgress (handler) { this.bootProgressHandler = handler }
    onError (handler) { this.errorHandler = handler }
    on (event, handler) { this.eventHandlers.set(event, handler) }
    async getStatus () { return { dhtConnected: true, peerCount: 2, proxyPort: 9876, browseDrives: 1, installedApps: 0, publishedSites: 0 } }
    async loginResolve (requestId, approved, scopes) {
      runtime.calls.push(['loginResolve', requestId, approved, Array.from(scopes || [])])
      return { ok: true }
    }
    async swarmResolve (requestId, approved) {
      runtime.calls.push(['swarmResolve', requestId, approved])
      return { ok: true }
    }
  }

  const module = loadTsxModule('app/App.tsx', {
    ...makeBaseStubs(harness, rn),
    ...makeComponentStubs(harness),
    ...makeAppScreenStubs(harness),
    './components/StatusDot': makeComponentStubs(harness)['../components/StatusDot'],
    './lib/theme': makeBaseStubs(harness, rn)['../lib/theme'],
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-file-system': {
      Paths: {
        document: { uri: 'file:///tmp/pearbrowser-documents' },
        join: (...parts) => parts.join('/')
      }
    },
    './lib/rpc': { PearRPC: FakePearRPC },
    './lib/constants': { EVT: { LOGIN_REQUEST: 106, SWARM_REQUEST: 107 } },
    './lib/network': { networkMonitor: { start: () => {}, stop: () => {} } },
    './lib/storage': {
      getSession: async () => ({}),
      saveSession: async () => {},
      bootstrapHyperbeeStorage: async () => {}
    },
    'react-native-bare-kit': { Worklet: FakeWorklet },
    '../assets/backend.bundle.mjs': 'console.log("ios bundle")',
    '../assets/backend.android.bundle.mjs': 'console.log("android bundle")'
  })
  return module.default || module
}

test('App shows pear.login consent and resolves deny/allow decisions', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const runtime = { calls: [], workletStarts: [], rpc: null, terminated: false }
  const App = loadAppWithRuntime(harness, rn, runtime)

  let tree = harness.render(App, {})
  assert.match(textContent(tree), /PearBrowser/)
  assert.equal(runtime.workletStarts.length, 1)
  runtime.rpc.readyHandler(9876)
  await flushMicrotasks()
  tree = harness.render(App, {})
  assert.match(textContent(tree), /Home screen/)

  runtime.rpc.eventHandlers.get(106)({
    requestId: 'login-1',
    driveKey: keyHex,
    appName: 'Catalog Chat',
    reason: 'Sync your profile across devices.',
    scopes: ['profile:read', 'contacts:read']
  })
  tree = harness.render(App, {})
  assert.match(textContent(tree), /Pear sign-in/)
  assert.match(textContent(tree), /Catalog Chat/)
  assert.match(textContent(tree), /Sync your profile across devices/)
  assert.match(textContent(tree), /profile:read/)
  assert.match(textContent(tree), /contacts:read/)
  await findTouchableWithText(tree, 'Deny').props.onPress()
  await flushMicrotasks()
  assert.deepEqual(runtime.calls.at(-1), ['loginResolve', 'login-1', false, []])

  runtime.rpc.eventHandlers.get(106)({
    requestId: 'login-2',
    driveKey: keyHex,
    appName: 'Catalog Chat',
    scopes: ['profile:read']
  })
  tree = harness.render(App, {})
  await findTouchableWithText(tree, 'Allow').props.onPress()
  await flushMicrotasks()
  assert.deepEqual(runtime.calls.at(-1), ['loginResolve', 'login-2', true, ['profile:read']])
  tree = harness.render(App, {})
  assert.doesNotMatch(textContent(tree), /Pear sign-in/)
})

test('App shows swarm consent with topic context and resolves decisions', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const runtime = { calls: [], workletStarts: [], rpc: null, terminated: false }
  const App = loadAppWithRuntime(harness, rn, runtime)
  const topicHex = 'f'.repeat(64)

  harness.render(App, {})
  runtime.rpc.readyHandler(9876)
  await flushMicrotasks()
  let tree = harness.render(App, {})
  assert.match(textContent(tree), /Home screen/)

  runtime.rpc.eventHandlers.get(107)({
    requestId: 'swarm-1',
    driveKey: keyHex,
    topicHex,
    protocol: 'pear.swarm.v1',
    appName: 'Peer Debugger',
    reason: 'Join a support room.'
  })
  tree = harness.render(App, {})
  assert.match(textContent(tree), /Direct swarm access/)
  assert.match(textContent(tree), /Peer Debugger/)
  assert.match(textContent(tree), /Join a support room/)
  assert.match(textContent(tree), new RegExp(topicHex))
  assert.match(textContent(tree), /pear\.swarm\.v1/)
  await findTouchableWithText(tree, 'Deny').props.onPress()
  await flushMicrotasks()
  assert.deepEqual(runtime.calls.at(-1), ['swarmResolve', 'swarm-1', false])

  runtime.rpc.eventHandlers.get(107)({
    requestId: 'swarm-2',
    driveKey: keyHex,
    topicHex,
    appName: 'Peer Debugger'
  })
  tree = harness.render(App, {})
  await findTouchableWithText(tree, 'Allow').props.onPress()
  await flushMicrotasks()
  assert.deepEqual(runtime.calls.at(-1), ['swarmResolve', 'swarm-2', true])
  tree = harness.render(App, {})
  assert.doesNotMatch(textContent(tree), /Direct swarm access/)
})

test('QRScannerScreen handles permission states and accepts only supported P2P QR payloads', async () => {
  let permission = null
  let permissionRequests = 0
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const scans = []
  const closes = []
  const stubs = {
    ...makeBaseStubs(harness, rn),
    'expo-camera': {
      CameraView: 'CameraView',
      useCameraPermissions: () => [permission, async () => { permissionRequests++ }]
    }
  }
  const { QRScannerScreen } = loadTsxModule('app/screens/QRScannerScreen.tsx', stubs)
  const props = { onScan: (url) => scans.push(url), onClose: () => closes.push(true) }

  let tree = harness.render(QRScannerScreen, props)
  assert.match(textContent(tree), /Requesting camera permission/)

  permission = { granted: false }
  tree = harness.render(QRScannerScreen, props)
  findTouchableWithText(tree, 'Grant Access').props.onPress()
  findTouchableWithText(tree, 'Cancel').props.onPress()
  assert.equal(permissionRequests, 1)
  assert.equal(closes.length, 1)

  permission = { granted: true }
  tree = harness.render(QRScannerScreen, props)
  let camera = findAll(tree, (node) => node.type === 'CameraView')[0]
  camera.props.onBarcodeScanned({ data: ` ${keyHex} ` })
  assert.deepEqual(scans, [`hyper://${keyHex}`])

  const harness2 = createReactHarness()
  const rn2 = createReactNativeStub()
  const scans2 = []
  const { QRScannerScreen: QRScannerScreen2 } = loadTsxModule('app/screens/QRScannerScreen.tsx', {
    ...makeBaseStubs(harness2, rn2),
    'expo-camera': {
      CameraView: 'CameraView',
      useCameraPermissions: () => [{ granted: true }, async () => {}]
    }
  })
  tree = harness2.render(QRScannerScreen2, { onScan: (url) => scans2.push(url), onClose: () => {} })
  camera = findAll(tree, (node) => node.type === 'CameraView')[0]
  camera.props.onBarcodeScanned({ data: 'https://relay-us.p2phiverelay.xyz/v1/hyper/' + keyHex })
  assert.deepEqual(scans2, ['https://relay-us.p2phiverelay.xyz/v1/hyper/' + keyHex])

  const harness3 = createReactHarness()
  const rn3 = createReactNativeStub()
  const { QRScannerScreen: QRScannerScreen3 } = loadTsxModule('app/screens/QRScannerScreen.tsx', {
    ...makeBaseStubs(harness3, rn3),
    'expo-camera': {
      CameraView: 'CameraView',
      useCameraPermissions: () => [{ granted: true }, async () => {}]
    }
  })
  tree = harness3.render(QRScannerScreen3, { onScan: (url) => scans2.push(url), onClose: () => {} })
  camera = findAll(tree, (node) => node.type === 'CameraView')[0]
  camera.props.onBarcodeScanned({ data: 'https://example.com/not-a-p2p-code' })
  assert.equal(rn3.alerts[0][0], 'Invalid QR')
  tree = harness3.render(QRScannerScreen3, { onScan: (url) => scans2.push(url), onClose: () => {} })
  camera = findAll(tree, (node) => node.type === 'CameraView')[0]
  assert.equal(camera.props.onBarcodeScanned, undefined)
  rn3.alerts[0][2][0].onPress()
  tree = harness3.render(QRScannerScreen3, { onScan: (url) => scans2.push(url), onClose: () => {} })
  camera = findAll(tree, (node) => node.type === 'CameraView')[0]
  assert.equal(typeof camera.props.onBarcodeScanned, 'function')
})

test('BookmarksScreen lists, opens, and removes stored bookmarks', async () => {
  let bookmarks = [
    { url: 'hyper://' + keyHex, title: 'Alpha', addedAt: 2 },
    { url: 'hyper://' + 'b'.repeat(64), title: 'Beta', addedAt: 1 }
  ]
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const opened = []
  const { BookmarksScreen } = loadTsxModule('app/screens/BookmarksScreen.tsx', {
    ...makeBaseStubs(harness, rn),
    '../lib/storage': {
      getBookmarks: async () => bookmarks,
      removeBookmark: async (url) => {
        bookmarks = bookmarks.filter((b) => b.url !== url)
        return bookmarks
      }
    }
  })

  let tree = harness.render(BookmarksScreen, { onOpen: (url) => opened.push(url), onBack: () => {} })
  await flushMicrotasks()
  tree = harness.render(BookmarksScreen, { onOpen: (url) => opened.push(url), onBack: () => {} })
  assert.match(textContent(tree), /Alpha/)
  assert.match(textContent(tree), /Beta/)

  findTouchableWithText(tree, 'Alpha').props.onPress()
  assert.deepEqual(opened, ['hyper://' + keyHex])

  const removeButtons = findAll(tree, (node) => node.type === 'TouchableOpacity' && textContent(node) === 'x')
  removeButtons[0].props.onPress()
  await flushMicrotasks()
  tree = harness.render(BookmarksScreen, { onOpen: (url) => opened.push(url), onBack: () => {} })
  assert.doesNotMatch(textContent(tree), /Alpha/)
  assert.match(textContent(tree), /Beta/)
})

test('HistoryScreen groups recent visits, opens entries, and clears with confirmation', async () => {
  const now = Date.now()
  let history = [
    { url: 'hyper://' + keyHex, title: 'Today Site', visitedAt: now },
    { url: 'hyper://' + 'b'.repeat(64), title: 'Yesterday Site', visitedAt: now - 86_400_000 }
  ]
  let clearCalls = 0
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const opened = []
  const { HistoryScreen } = loadTsxModule('app/screens/HistoryScreen.tsx', {
    ...makeBaseStubs(harness, rn),
    '../lib/storage': {
      getHistory: async () => history,
      clearHistory: async () => {
        clearCalls++
        history = []
      }
    }
  })

  let tree = harness.render(HistoryScreen, { onOpen: (url) => opened.push(url), onBack: () => {} })
  await flushMicrotasks()
  tree = harness.render(HistoryScreen, { onOpen: (url) => opened.push(url), onBack: () => {} })
  assert.match(textContent(tree), /Today/)
  assert.match(textContent(tree), /Yesterday/)

  findTouchableWithText(tree, 'Today Site').props.onPress()
  assert.deepEqual(opened, ['hyper://' + keyHex])

  findTouchableWithText(tree, 'Clear').props.onPress()
  assert.equal(rn.alerts[0][0], 'Clear History')
  assert.equal(clearCalls, 0)
  await rn.alerts[0][2][1].onPress()
  await flushMicrotasks()
  tree = harness.render(HistoryScreen, { onOpen: (url) => opened.push(url), onBack: () => {} })
  assert.equal(clearCalls, 1)
  assert.match(textContent(tree), /No history/)
})

test('TemplatePickerScreen returns complete built-in template data', () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const selected = []
  const backed = []
  const { TemplatePickerScreen, TEMPLATES } = loadTsxModule('app/screens/TemplatePickerScreen.tsx', makeBaseStubs(harness, rn))

  assert.ok(TEMPLATES.length >= 5)
  for (const template of TEMPLATES) {
    assert.equal(typeof template.id, 'string')
    assert.equal(typeof template.name, 'string')
    assert.ok(Array.isArray(template.blocks))
    assert.ok(template.blocks.length > 0)
    assert.ok(template.theme.primaryColor)
  }

  const tree = harness.render(TemplatePickerScreen, { onSelect: (template) => selected.push(template), onBack: () => backed.push(true) })
  findTouchableWithText(tree, 'Personal').props.onPress()
  assert.equal(selected[0].id, 'personal')
  assert.ok(selected[0].blocks.some((block) => block.type === 'link'))

  findTouchableWithText(tree, '< Back').props.onPress()
  assert.equal(backed.length, 1)
})

test('MoreScreen navigates, reports status, shows identity, and saves catalog prompts', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const calls = []
  let promptArgs = null
  rn.module.Alert.prompt = (...args) => { promptArgs = args }

  const rpc = {
    async getStatus () {
      calls.push('status')
      return {
        dhtConnected: true,
        peerCount: 7,
        proxyPort: 9898,
        browseDrives: 3,
        installedApps: 4,
        storageUsed: 1536,
        storageLimit: 2048,
        publishedSites: 2
      }
    },
    async getIdentity () {
      calls.push('identity')
      return { publicKey: 'f'.repeat(64) }
    }
  }
  const navigations = []
  const catalogs = []
  const { MoreScreen } = loadTsxModule('app/screens/MoreScreen.tsx', {
    ...makeBaseStubs(harness, rn),
    '../lib/storage': {
      addCatalog: async (url) => {
        catalogs.push(url)
        return { catalogList: catalogs }
      }
    }
  })

  const props = {
    rpc,
    peerCount: 1,
    proxyPort: 9876,
    status: 'connected',
    onNavigateToSites: () => navigations.push('sites'),
    onNavigateToBookmarks: () => navigations.push('bookmarks'),
    onNavigateToHistory: () => navigations.push('history'),
    onNavigateToSettings: () => navigations.push('settings')
  }
  let tree = harness.render(MoreScreen, props)
  await flushMicrotasks()
  tree = harness.render(MoreScreen, props)
  assert.match(textContent(tree), /Connected/)
  assert.match(textContent(tree), /Port 9898/)
  assert.match(textContent(tree), /1.5 KB \/ 2 KB/)

  for (const label of ['My Sites', 'Bookmarks', 'History', 'Settings']) {
    findTouchableWithText(tree, label).props.onPress()
  }
  assert.deepEqual(navigations, ['sites', 'bookmarks', 'history', 'settings'])

  await findTouchableWithText(tree, 'P2P Status').props.onPress()
  await flushMicrotasks()
  assert.equal(rn.alerts[0][0], 'P2P Status')
  assert.match(rn.alerts[0][1], /Peers: 7/)

  await findTouchableWithText(tree, 'My Identity').props.onPress()
  await flushMicrotasks()
  tree = harness.render(MoreScreen, props)
  assert.match(textContent(tree), /Your Device Identity/)
  findTouchableWithText(tree, 'Copy Key').props.onPress()
  assert.equal(rn.clipboard.value, 'f'.repeat(64))

  findTouchableWithText(tree, 'Add Catalog').props.onPress()
  assert.equal(promptArgs[0], 'Add Catalog')
  await promptArgs[2][1].onPress('https://relay.example.com/catalog///')
  assert.deepEqual(catalogs, ['https://relay.example.com/catalog///'])
  assert.equal(rn.alerts.at(-1)[0], 'Catalog Added')
})

test('MySitesScreen creates, edits, previews, publishes, shares, and deletes sites', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  let sites = [
    {
      siteId: 'draft',
      keyHex,
      name: 'Draft Site',
      published: false,
      createdAt: 1,
      url: 'hyper://' + keyHex
    },
    {
      siteId: 'live',
      keyHex: 'b'.repeat(64),
      name: 'Live Site',
      published: true,
      createdAt: 2,
      url: 'hyper://' + 'b'.repeat(64)
    }
  ]
  const calls = []
  const edited = []
  const previewed = []
  const rpc = {
    async listSites () {
      calls.push('list')
      return sites
    },
    async createSite (name) {
      calls.push(['create', name])
      const site = {
        siteId: 'new-site',
        keyHex: 'c'.repeat(64),
        name,
        published: false,
        createdAt: 3,
        url: 'hyper://' + 'c'.repeat(64)
      }
      sites = [site, ...sites]
      return site
    },
    async publishSite (siteId) {
      calls.push(['publish', siteId])
      sites = sites.map((site) => site.siteId === siteId ? { ...site, published: true } : site)
      return { keyHex: sites.find((site) => site.siteId === siteId).keyHex }
    },
    async deleteSite (siteId) {
      calls.push(['delete', siteId])
      sites = sites.filter((site) => site.siteId !== siteId)
      return { ok: true }
    }
  }
  const { MySitesScreen } = loadTsxModule('app/screens/MySitesScreen.tsx', makeBaseStubs(harness, rn))
  const props = { rpc, onEditSite: (id) => edited.push(id), onPreviewSite: (url) => previewed.push(url) }

  let tree = harness.render(MySitesScreen, props)
  await flushMicrotasks()
  tree = harness.render(MySitesScreen, props)
  assert.match(textContent(tree), /Draft Site/)
  assert.match(textContent(tree), /Live Site/)

  findAllTouchablesWithText(tree, 'Edit')[0].props.onPress()
  findAllTouchablesWithText(tree, 'Preview')[0].props.onPress()
  assert.deepEqual(edited, ['draft'])
  assert.deepEqual(previewed, ['hyper://' + keyHex])

  findByProp(tree, 'TextInput', 'placeholder', 'Site name...').props.onChangeText('  New Site  ')
  tree = harness.render(MySitesScreen, props)
  await findTouchableWithText(tree, 'Create').props.onPress()
  await flushMicrotasks()
  tree = harness.render(MySitesScreen, props)
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'create' && call[1] === 'New Site'))
  assert.deepEqual(edited.at(-1), 'new-site')

  await findAllTouchablesWithText(tree, 'Publish')[0].props.onPress()
  await flushMicrotasks()
  assert.equal(rn.alerts.at(-1)[0], 'Published!')

  tree = harness.render(MySitesScreen, props)
  await findAllTouchablesWithText(tree, 'Share')[0].props.onPress()
  await flushMicrotasks()
  assert.equal(rn.shared[0].url.startsWith('hyper://'), true)

  findAllTouchablesWithText(tree, 'Delete')[0].props.onPress()
  assert.equal(rn.alerts.at(-1)[0], 'Delete Site')
  await rn.alerts.at(-1)[2][1].onPress()
  await flushMicrotasks()
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'delete'))
})

test('SiteEditorScreen edits theme, previews generated HTML, saves, and publishes', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const calls = []
  const previews = []
  const rpc = {
    async updateSite (siteId, blocks, theme) {
      calls.push(['update', siteId, blocks, theme])
      return { ok: true }
    },
    async publishSite (siteId) {
      calls.push(['publish', siteId])
      return { keyHex }
    }
  }
  const { SiteEditorScreen } = loadTsxModule('app/screens/SiteEditorScreen.tsx', {
    ...makeBaseStubs(harness, rn),
    'react-native-webview': { WebView: 'WebView' }
  })
  const props = {
    rpc,
    siteId: 'site-1',
    siteName: 'Harness Site',
    initialBlocks: [
      { id: 'h1', type: 'heading', text: 'Hello <World>', level: 1 },
      { id: 'p1', type: 'text', text: 'A paragraph & more.' },
      { id: 'l1', type: 'list', items: ['One', 'Two'] },
      { id: 'a1', type: 'link', text: 'Launch', href: 'hyper://' + keyHex }
    ],
    onBack: () => {},
    onPreview: (url) => previews.push(url)
  }

  let tree = harness.render(SiteEditorScreen, props)
  findTouchableWithText(tree, 'Theme').props.onPress()
  tree = harness.render(SiteEditorScreen, props)
  findTouchableWithText(tree, 'Ocean').props.onPress()
  tree = harness.render(SiteEditorScreen, props)

  await findTouchableWithText(tree, 'Save').props.onPress()
  await flushMicrotasks()
  assert.equal(calls[0][0], 'update')
  assert.equal(calls[0][3].name, 'Ocean')

  findTouchableWithText(tree, 'Preview').props.onPress()
  tree = harness.render(SiteEditorScreen, props)
  const webView = findAll(tree, (node) => node.type === 'WebView')[0]
  assert.match(webView.props.source.html, /Hello &lt;World&gt;/)
  assert.match(webView.props.source.html, /A paragraph &amp; more\./)
  assert.match(webView.props.source.html, /<li>One<\/li>/)
  assert.match(webView.props.source.html, /hyper:\/\/aaaaaaaa/)
  assert.match(webView.props.source.html, /#0a1628/)

  await findTouchableWithText(tree, 'Publish').props.onPress()
  await flushMicrotasks()
  assert.deepEqual(calls.at(-2)[0], 'update')
  assert.deepEqual(calls.at(-1), ['publish', 'site-1'])
  assert.equal(rn.alerts.at(-1)[0], 'Published!')
  rn.alerts.at(-1)[2][0].onPress()
  assert.deepEqual(previews, ['hyper://' + keyHex])
})

test('HomeScreen opens QR, normalizes typed keys, and renders bookmark quick access', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const navigations = []
  let qrOpened = 0
  const { HomeScreen } = loadTsxModule('app/screens/HomeScreen.tsx', {
    ...makeBaseStubs(harness, rn),
    ...makeComponentStubs(harness),
    '../lib/storage': {
      getBookmarks: async () => [{ url: 'hyper://' + keyHex, title: 'Saved Site', addedAt: 1 }]
    }
  })
  const props = {
    rpc: {},
    peerCount: 2,
    status: 'connected',
    onNavigate: (url) => navigations.push(url),
    onOpenQR: () => { qrOpened++ }
  }

  let tree = harness.render(HomeScreen, props)
  await flushMicrotasks()
  tree = harness.render(HomeScreen, props)
  assert.match(textContent(tree), /Saved Site/)

  findTouchableWithText(tree, 'QR').props.onPress()
  assert.equal(qrOpened, 1)

  findByProp(tree, 'TextInput', 'placeholder', 'Search or enter hyper:// address').props.onChangeText(keyHex)
  tree = harness.render(HomeScreen, props)
  findByProp(tree, 'TextInput', 'placeholder', 'Search or enter hyper:// address').props.onSubmitEditing()
  assert.deepEqual(navigations, ['hyper://' + keyHex])
})

test('BrowseScreen routes hyper URLs through rpc.navigate and opens untrusted HTTPS externally', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const navigateCalls = []
  const bookmarkCalls = []
  const { BrowseScreen } = loadTsxModule('app/screens/BrowseScreen.tsx', {
    ...makeBaseStubs(harness, rn),
    ...makeComponentStubs(harness),
    'react-native-webview': { WebView: 'WebView' },
    '../lib/storage': {
      getSettings: async () => ({ privateMode: true }),
      addToHistory: async () => {},
      getBookmarks: async () => [],
      addBookmark: async (url, title) => { bookmarkCalls.push(['add', url, title]) },
      removeBookmark: async (url) => { bookmarkCalls.push(['remove', url]) }
    },
    '../lib/bridge-inject': {
      createBridgeScript: (port, token) => `bridge:${port}:${token}`
    }
  })
  const rpc = {
    async navigate (url) {
      navigateCalls.push(url)
      return { localUrl: 'http://127.0.0.1:9876/hyper/' + keyHex + '/', apiToken: 'token-1' }
    }
  }

  let tree = harness.render(BrowseScreen, { rpc, proxyPort: 9876, peerCount: 3, status: 'connected', initialUrl: 'hyper://' + keyHex })
  await flushMicrotasks()
  tree = harness.render(BrowseScreen, { rpc, proxyPort: 9876, peerCount: 3, status: 'connected', initialUrl: 'hyper://' + keyHex })
  assert.deepEqual(navigateCalls, ['hyper://' + keyHex])
  let webView = findAll(tree, (node) => node.type === 'WebView')[0]
  assert.equal(webView.props.source.uri, 'http://127.0.0.1:9876/hyper/' + keyHex + '/')
  assert.equal(webView.props.injectedJavaScriptBeforeContentLoaded, 'bridge:9876:token-1')

  const browserCommands = []
  webView.props.ref.current = {
    injectJavaScript: (script) => browserCommands.push(['injectJavaScript', script]),
    reload: () => browserCommands.push(['reload'])
  }
  const openPageActions = () => {
    findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Page actions').props.onPress()
    tree = harness.render(BrowseScreen, { rpc, proxyPort: 9876, peerCount: 3, status: 'connected', initialUrl: 'hyper://' + keyHex })
  }

  openPageActions()
  findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Reload page').props.onPress()
  assert.deepEqual(browserCommands, [['reload']])

  openPageActions()
  findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Find in page').props.onPress()
  tree = harness.render(BrowseScreen, { rpc, proxyPort: 9876, peerCount: 3, status: 'connected', initialUrl: 'hyper://' + keyHex })
  findByProp(tree, 'TextInput', 'placeholder', 'Find in page').props.onChangeText('Pear Browser')
  tree = harness.render(BrowseScreen, { rpc, proxyPort: 9876, peerCount: 3, status: 'connected', initialUrl: 'hyper://' + keyHex })
  findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Next match').props.onPress()
  findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Previous match').props.onPress()
  assert.match(browserCommands[1][1], /window\.find\("Pear Browser", false, false/)
  assert.match(browserCommands[2][1], /window\.find\("Pear Browser", false, true/)

  openPageActions()
  await findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Share current page').props.onPress()
  assert.equal(rn.shared[0].url, 'hyper://' + keyHex)

  openPageActions()
  findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Copy current page link').props.onPress()
  assert.equal(rn.clipboard.value, 'hyper://' + keyHex)

  openPageActions()
  await findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Add bookmark').props.onPress()
  assert.deepEqual(bookmarkCalls, [['add', 'hyper://' + keyHex, 'hyper://' + keyHex]])

  openPageActions()
  findByProp(tree, 'TouchableOpacity', 'accessibilityLabel', 'Request desktop site').props.onPress()
  tree = harness.render(BrowseScreen, { rpc, proxyPort: 9876, peerCount: 3, status: 'connected', initialUrl: 'hyper://' + keyHex })
  webView = findAll(tree, (node) => node.type === 'WebView')[0]
  assert.match(webView.props.userAgent, /Macintosh/)
  assert.deepEqual(browserCommands.at(-1), ['reload'])

  assert.equal(webView.props.onShouldStartLoadWithRequest({ url: 'https://example.com/page' }), false)
  assert.deepEqual(rn.module.Linking.opened, ['https://example.com/page'])

  findByProp(tree, 'TextInput', 'placeholder', 'hyper://...').props.onFocus()
  tree = harness.render(BrowseScreen, { rpc, proxyPort: 9876, peerCount: 3, status: 'connected', initialUrl: 'hyper://' + keyHex })
  findByProp(tree, 'TextInput', 'placeholder', 'hyper://...').props.onChangeText('b'.repeat(64))
  tree = harness.render(BrowseScreen, { rpc, proxyPort: 9876, peerCount: 3, status: 'connected', initialUrl: 'hyper://' + keyHex })
  findByProp(tree, 'TextInput', 'placeholder', 'hyper://...').props.onSubmitEditing()
  await flushMicrotasks()
  assert.equal(navigateCalls.at(-1), 'hyper://' + 'b'.repeat(64))
})

test('ExploreScreen loads an HTTP catalog, renders cards, and visits valid drive keys', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const visits = []
  const fetches = []
  const { ExploreScreen } = loadTsxModule('app/screens/ExploreScreen.tsx', {
    ...makeBaseStubs(harness, rn),
    ...makeComponentStubs(harness),
    '../lib/storage': {
      getSettings: async () => ({ catalogUrl: 'https://relay.example.com', catalogList: [], theme: 'dark', defaultTab: 'home', privateMode: false })
    },
    fetch: async (url) => {
      fetches.push(url)
      return {
        ok: true,
        async json () {
          return {
            apps: [
              { id: 'alpha', name: 'Alpha App', description: 'First app', driveKey: keyHex },
              { id: 'pear', name: 'Pear Link', description: 'Standalone app', link: 'PEAR://keet' },
              { id: 'bad', name: 'Broken App', description: 'No key', driveKey: 'bad' }
            ]
          }
        }
      }
    }
  })

  let tree = harness.render(ExploreScreen, { rpc: null, onVisit: (url) => visits.push(url) })
  await flushMicrotasks()
  await flushMicrotasks()
  tree = harness.render(ExploreScreen, { rpc: null, onVisit: (url) => visits.push(url) })
  assert.deepEqual(fetches, ['https://relay.example.com/catalog.json'])
  assert.match(textContent(tree), /Alpha App/)
  assert.match(textContent(tree), /Pear Link/)
  assert.doesNotMatch(textContent(tree), /Broken App/)

  findTouchableWithText(tree, 'Alpha App').props.onPress()
  assert.deepEqual(visits, ['hyper://' + keyHex])
  findTouchableWithText(tree, 'Pear Link').props.onPress()
  assert.deepEqual(visits, ['hyper://' + keyHex, 'pear://keet'])
})

test('SettingsScreen updates catalog, relay, privacy, cache, and identity navigation controls', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  let settings = {
    catalogUrl: 'https://relay-us.p2phiverelay.xyz',
    catalogList: ['https://relay-us.p2phiverelay.xyz', 'https://relay-sg.p2phiverelay.xyz'],
    theme: 'dark',
    defaultTab: 'home',
    privateMode: false
  }
  const calls = []
  const opened = []
  const rpc = {
    async getRelays () {
      return { relays: ['https://relay-us.p2phiverelay.xyz'], enabled: true, configured: true }
    },
    async setRelays (relays) {
      calls.push(['setRelays', relays])
      return { relays }
    },
    async setRelayEnabled (enabled) {
      calls.push(['relayEnabled', enabled])
      return { enabled }
    },
    async getStatus () {
      return { storageUsed: 256, storageLimit: 1024, storagePercent: 25 }
    },
    async clearCache () {
      calls.push('clearCache')
    },
    async deviceLinkCreateInvite () {
      calls.push(['deviceLinkCreateInvite'])
      return { invite: 'f'.repeat(64), discoveryKey: 'd'.repeat(64) }
    },
    async deviceLinkJoin (invite, device) {
      calls.push(['deviceLinkJoin', invite, device])
      return { ok: true, restartRequired: true }
    }
  }
  const { SettingsScreen } = loadTsxModule('app/screens/SettingsScreen.tsx', {
    ...makeBaseStubs(harness, rn),
    ...makeComponentStubs(harness),
    '../lib/rpc': {},
    '../lib/storage': {
      getSettings: async () => settings,
      updateSettings: async (updates) => {
        calls.push(['settings', updates])
        settings = { ...settings, ...updates }
        return settings
      },
      clearAllData: async () => {
        calls.push('clearAll')
        settings = { ...settings, privateMode: false }
      },
      addCatalog: async (url) => {
        calls.push(['addCatalog', url])
        settings = { ...settings, catalogList: [...settings.catalogList, url] }
        return settings
      },
      removeCatalog: async (url) => {
        calls.push(['removeCatalog', url])
        settings = { ...settings, catalogList: settings.catalogList.filter((u) => u !== url) }
        return settings
      }
    }
  })
  const props = {
    rpc,
    onBack: () => opened.push('back'),
    onOpenBackupPhrase: () => opened.push('backup'),
    onOpenRestoreIdentity: () => opened.push('restore')
  }

  let tree = harness.render(SettingsScreen, props)
  await flushMicrotasks()
  tree = harness.render(SettingsScreen, props)
  assert.match(textContent(tree), /Settings/)
  assert.match(textContent(tree), /storage:256\/1024/)
  assert.match(textContent(tree), /24-word BIP-39 seed phrase/)
  assert.match(textContent(tree), /Link a Device/)

  findByProp(tree, 'TextInput', 'value', 'https://relay-us.p2phiverelay.xyz').props.onChangeText('https://relay-new.example.com')
  tree = harness.render(SettingsScreen, props)
  findTouchableWithText(tree, 'Save').props.onPress()
  await flushMicrotasks()
  assert.equal(calls.at(-1)[0], 'settings')
  assert.equal(calls.at(-1)[1].catalogUrl, 'https://relay-new.example.com')

  const switches = findAll(tree, (node) => node.type === 'Switch')
  await switches[0].props.onValueChange(true)
  assert.equal(calls.at(-1)[0], 'settings')
  assert.equal(calls.at(-1)[1].privateMode, true)
  await switches[1].props.onValueChange(false)
  assert.equal(calls.at(-1)[0], 'relayEnabled')
  assert.equal(calls.at(-1)[1], false)

  await findTouchableWithText(tree, 'Clear Cache').props.onPress()
  await flushMicrotasks()
  assert.ok(calls.includes('clearCache'))
  assert.equal(rn.alerts.at(-1)[0], 'Cache Cleared')

  findTouchableWithText(tree, 'Backup Phrase').props.onPress()
  findTouchableWithText(tree, 'Restore from Phrase').props.onPress()
  assert.deepEqual(opened, ['backup', 'restore'])

  await findTouchableWithText(tree, 'Invite').props.onPress()
  await flushMicrotasks()
  assert.deepEqual(calls.at(-1), ['deviceLinkCreateInvite'])
  tree = harness.render(SettingsScreen, props)
  assert.match(textContent(tree), /Invite created/)
  findTouchableWithText(tree, 'Copy Invite').props.onPress()
  assert.equal(rn.clipboard.value, 'f'.repeat(64))

  findByProp(tree, 'TextInput', 'placeholder', 'Paste invite from your other device').props.onChangeText('abc123')
  tree = harness.render(SettingsScreen, props)
  findTouchableWithText(tree, 'Link This Device').props.onPress()
  assert.equal(rn.alerts.at(-1)[0], 'Replace this identity?')
  await rn.alerts.at(-1)[2][1].onPress()
  await flushMicrotasks()
  assert.deepEqual(calls.at(-1), ['deviceLinkJoin', 'abc123', 'iPhone'])

  findTouchableWithText(tree, 'Clear All Browser Data').props.onPress()
  await rn.alerts.at(-1)[2][1].onPress()
  await flushMicrotasks()
  assert.ok(calls.includes('clearAll'))
})

test('BackupPhraseScreen reveals, copies, confirms, and closes only after acknowledgement', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const backs = []
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
  const { BackupPhraseScreen } = loadTsxModule('app/screens/BackupPhraseScreen.tsx', makeBaseStubs(harness, rn))

  let tree = harness.render(BackupPhraseScreen, {
    rpc: { identityExportPhrase: async () => ({ mnemonic }) },
    onBack: () => backs.push(true)
  })
  await flushMicrotasks()
  tree = harness.render(BackupPhraseScreen, {
    rpc: { identityExportPhrase: async () => ({ mnemonic }) },
    onBack: () => backs.push(true)
  })
  assert.match(textContent(tree), /••••••/)
  assert.match(textContent(tree), /24-word phrase/)
  findTouchableWithText(tree, 'Tap to reveal').props.onPress()
  tree = harness.render(BackupPhraseScreen, {
    rpc: { identityExportPhrase: async () => ({ mnemonic }) },
    onBack: () => backs.push(true)
  })
  assert.match(textContent(tree), /abandon/)

  findTouchableWithText(tree, 'Copy to clipboard').props.onPress()
  assert.equal(rn.clipboard.value, mnemonic)
  assert.equal(rn.alerts.at(-1)[0], 'Copied')

  const done = findTouchableWithText(tree, 'Done')
  assert.equal(done.props.disabled, true)
  findAll(tree, (node) => node.type === 'Switch')[0].props.onValueChange(true)
  tree = harness.render(BackupPhraseScreen, {
    rpc: { identityExportPhrase: async () => ({ mnemonic }) },
    onBack: () => backs.push(true)
  })
  findTouchableWithText(tree, 'Done').props.onPress()
  assert.equal(backs.length, 1)
})

test('RestoreIdentityScreen validates phrases and restores through double confirmation', async () => {
  const harness = createReactHarness()
  const rn = createReactNativeStub()
  const calls = []
  const restored = []
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
  const rpc = {
    async identityValidatePhrase (value) {
      calls.push(['validate', value])
      return { valid: value === phrase }
    },
    async identityImportPhrase (value) {
      calls.push(['import', value])
      return { ok: true }
    }
  }
  const { RestoreIdentityScreen } = loadTsxModule('app/screens/RestoreIdentityScreen.tsx', makeBaseStubs(harness, rn))

  let tree = harness.render(RestoreIdentityScreen, { rpc, onBack: () => {}, onRestored: () => restored.push(true) })
  assert.match(textContent(tree), /24-word backup phrase/)
  await findByProp(tree, 'TextInput', 'placeholder', 'abandon ability able above ...').props.onChangeText(phrase.toUpperCase())
  await flushMicrotasks()
  tree = harness.render(RestoreIdentityScreen, { rpc, onBack: () => {}, onRestored: () => restored.push(true) })
  assert.match(textContent(tree), /Valid phrase/)
  assert.deepEqual(calls[0], ['validate', phrase])

  await findTouchableWithText(tree, 'Restore Identity').props.onPress()
  assert.equal(rn.alerts.at(-1)[0], 'Replace identity?')
  await rn.alerts.at(-1)[2][1].onPress()
  await flushMicrotasks()
  assert.deepEqual(calls.at(-1), ['import', phrase])
  assert.equal(rn.alerts.at(-1)[0], 'Identity restored')
  rn.alerts.at(-1)[2][0].onPress()
  assert.deepEqual(restored, [true])
})
