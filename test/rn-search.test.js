const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const key = 'a'.repeat(64)

async function settle () {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function reactHarness () {
  const hooks = []
  let index = 0
  let effects = []
  const changed = (a, b) => !a || !b || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]))
  const React = {
    __esModule: true,
    Fragment: 'Fragment',
    createElement (type, props, ...children) {
      const node = { type, props: { ...(props || {}), children: children.length < 2 ? children[0] : children } }
      return typeof type === 'function' ? type(node.props) : node
    },
    useState (initial) {
      const at = index++
      if (!(at in hooks)) hooks[at] = typeof initial === 'function' ? initial() : initial
      return [hooks[at], (next) => {
        hooks[at] = typeof next === 'function' ? next(hooks[at]) : next
      }]
    },
    useRef (initial) {
      const at = index++
      if (!(at in hooks)) hooks[at] = { current: initial }
      return hooks[at]
    },
    useCallback (fn, deps) {
      const at = index++
      const prev = hooks[at]
      if (!prev || changed(prev.deps, deps)) hooks[at] = { fn, deps }
      return hooks[at].fn
    },
    useEffect (fn, deps) {
      const at = index++
      const prev = hooks[at]
      if (!prev || changed(prev.deps, deps)) {
        if (prev && prev.cleanup) prev.cleanup()
        hooks[at] = { deps, cleanup: null }
        effects.push(() => { hooks[at].cleanup = fn() })
      }
    }
  }
  React.default = React
  return {
    React,
    render (Component, props) {
      index = 0
      effects = []
      const tree = Component(props)
      for (const effect of effects) effect()
      return tree
    }
  }
}

function nativeStub () {
  const alerts = []
  return {
    alerts,
    module: {
      __esModule: true,
      View: 'View',
      Text: 'Text',
      ScrollView: 'ScrollView',
      TextInput: 'TextInput',
      TouchableOpacity: 'TouchableOpacity',
      Switch: 'Switch',
      ActivityIndicator: 'ActivityIndicator',
      Clipboard: { async getString () { return '' }, setString () {} },
      Alert: { alert: (...args) => alerts.push(args) },
      Platform: { OS: 'ios', Version: 'test' },
      StyleSheet: { create: (styles) => styles }
    }
  }
}

function loadTsx (name, stubs) {
  const filename = path.join(root, name)
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
  vm.runInNewContext(output, {
    module: mod,
    exports: mod.exports,
    console,
    setTimeout: () => 1,
    clearTimeout () {},
    setInterval: () => 1,
    clearInterval () {},
    require (specifier) {
      if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier]
      return require(specifier)
    }
  }, { filename })
  return mod.exports
}

function all (tree, predicate, out = []) {
  if (Array.isArray(tree)) {
    for (const item of tree) all(item, predicate, out)
    return out
  }
  if (!tree || typeof tree !== 'object' || !tree.props) return out
  if (predicate(tree)) out.push(tree)
  all(tree.props.children, predicate, out)
  return out
}

function one (tree, type, predicate = () => true) {
  const found = all(tree, (node) => node.type === type && predicate(node))
  assert.ok(found.length, 'expected ' + type)
  return found[0]
}

function textOf (tree) {
  if (Array.isArray(tree)) return tree.map(textOf).join(' ')
  if (tree == null || typeof tree === 'boolean') return ''
  if (typeof tree !== 'object') return String(tree)
  return textOf(tree.props && tree.props.children)
}

function baseStubs (harness, native) {
  return {
    react: harness.React,
    'react-native': native.module,
    '../lib/theme': { colors: {
      bg: '#000', surface: '#111', surfaceElevated: '#222', border: '#333',
      accent: '#f8a', textPrimary: '#fff', textSecondary: '#ccc',
      textMuted: '#888', error: '#f00', success: '#0f0', warning: '#ff0'
    } }
  }
}

test('Home routes ordinary text to local search and keys to navigation', async () => {
  const harness = reactHarness()
  const native = nativeStub()
  const searches = []
  const navigations = []
  const { HomeScreen } = loadTsx('app/screens/HomeScreen.tsx', {
    ...baseStubs(harness, native),
    '../lib/storage': { getBookmarks: async () => [] },
    '../components/StatusDot': { StatusDot: () => null },
    '../components/SiteCard': { SiteCard: () => null }
  })
  const props = {
    rpc: {}, peerCount: 0, status: 'connected',
    onSearch: (q) => searches.push(q),
    onNavigate: (url) => navigations.push(url)
  }
  let tree = harness.render(HomeScreen, props)
  await settle()
  tree = harness.render(HomeScreen, props)
  one(tree, 'TextInput').props.onChangeText('  privacy tools  ')
  tree = harness.render(HomeScreen, props)
  one(tree, 'TextInput').props.onSubmitEditing()
  assert.deepEqual(searches, ['privacy tools'])
  assert.deepEqual(navigations, [])

  tree = harness.render(HomeScreen, props)
  one(tree, 'TextInput').props.onChangeText(key)
  tree = harness.render(HomeScreen, props)
  one(tree, 'TextInput').props.onSubmitEditing()
  assert.deepEqual(navigations, ['hyper://' + key])
})

test('Search starts local, peer option is explicit, and stale enrichment is ignored', async () => {
  const harness = reactHarness()
  const native = nativeStub()
  const calls = []
  const opened = []
  let event = null
  const local = { docId: 'local', driveKey: key, path: '/', title: 'Local page', tier: 'self' }
  const peer = { docId: 'peer', driveKey: key, path: '/peer', title: 'Peer page', tier: 'followed', trustHop: 1 }
  const rpc = {
    getPrivacyStatus: async () => ({ privacy: { searchIndexEnabled: false } }),
    onSearchFederated (cb) { event = cb; return () => { event = null } },
    async search (query, options) {
      calls.push({ query, options })
      return {
        results: [local], stats: { docs: 1 }, phase: 'first-paint',
        federating: options.federated, queryId: calls.length
      }
    }
  }
  const { SearchScreen, searchResultUrl } = loadTsx('app/screens/SearchScreen.tsx', {
    ...baseStubs(harness, native)
  })
  const props = {
    rpc, initialQuery: 'privacy', onOpen: (url) => opened.push(url), onBack () {}
  }
  let tree = harness.render(SearchScreen, props)
  await settle()
  tree = harness.render(SearchScreen, props)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.federated, false)
  assert.match(textOf(tree), /Local page/)
  assert.match(textOf(tree), /Page indexing is off/)
  event({ queryId: 1, results: [peer], phase: 'enriched' })
  tree = harness.render(SearchScreen, props)
  assert.doesNotMatch(textOf(tree), /Peer page/)

  one(tree, 'Switch').props.onValueChange(true)
  await settle()
  tree = harness.render(SearchScreen, props)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].options.federated, true)
  assert.match(textOf(tree), /Local page/)
  event({ queryId: 1, results: [peer], phase: 'enriched' })
  tree = harness.render(SearchScreen, props)
  assert.doesNotMatch(textOf(tree), /Peer page/)
  event({
    queryId: 2, results: [local, peer], phase: 'enriched', partial: false,
    provenance: { plannedPeers: 1, pulledPeers: 1 }
  })
  tree = harness.render(SearchScreen, props)
  assert.match(textOf(tree), /Peer page/)
  assert.match(textOf(tree), /Trusted peer/)
  assert.match(textOf(tree), /1\/1 peers checked/)
  const peerResult = all(tree, (node) => node.type === 'TouchableOpacity' &&
    textOf(node).includes('Peer page'))[0]
  peerResult.props.onPress()
  assert.deepEqual(opened, ['hyper://' + key + '/peer'])

  one(tree, 'Switch').props.onValueChange(false)
  tree = harness.render(SearchScreen, props)
  assert.doesNotMatch(textOf(tree), /Peer page/)
  assert.equal(searchResultUrl({ driveKey: key, path: '/page' }), 'hyper://' + key + '/page')
  assert.equal(searchResultUrl({ driveKey: key, link: 'https://evil.example' }), null)
})

test('Settings indexing follows worklet opt-in and private-mode callback follows persisted setting', async () => {
  const harness = reactHarness()
  const native = nativeStub()
  const writes = []
  const transitions = []
  let local = {
    catalogUrl: 'https://example.test', catalogList: [],
    theme: 'dark', defaultTab: 'home', privateMode: false
  }
  let indexEnabled = false
  const storage = {
    getSettings: async () => local,
    updateSettings: async (updates) => { local = { ...local, ...updates }; return local },
    clearAllData: async () => {},
    addCatalog: async () => local,
    removeCatalog: async () => local
  }
  const rpc = {
    getRelays: async () => ({ relays: [], enabled: true, configured: false }),
    getStatus: async () => ({ storageUsed: 0, storageLimit: 100, storagePercent: 0 }),
    getPrivacyStatus: async () => ({ privacy: { searchIndexEnabled: indexEnabled } }),
    userDataSetSettings: async (updates) => {
      writes.push(updates)
      indexEnabled = updates.searchIndexEnabled
    }
  }
  const { SettingsScreen } = loadTsx('app/screens/SettingsScreen.tsx', {
    ...baseStubs(harness, native),
    '../lib/storage': storage,
    '../components/StorageMeter': { StorageMeter: () => null }
  })
  const props = { onBack () {}, rpc, onPrivateModeChange: (value) => transitions.push(value) }
  let tree = harness.render(SettingsScreen, props)
  await settle()
  tree = harness.render(SettingsScreen, props)
  const switches = all(tree, (node) => node.type === 'Switch')
  assert.equal(switches[0].props.value, false)
  assert.equal(switches[1].props.value, false)
  assert.equal(switches[1].props.disabled, false)
  await switches[1].props.onValueChange(true)
  tree = harness.render(SettingsScreen, props)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].searchIndexEnabled, true)
  assert.equal(all(tree, (node) => node.type === 'Switch')[1].props.value, true)

  await switches[0].props.onValueChange(true)
  tree = harness.render(SettingsScreen, props)
  assert.deepEqual(transitions, [true])
  assert.equal(local.privateMode, true)
  assert.doesNotMatch(textOf(tree), /Ephemeral drive cache|Data cleared on exit/)
  await all(tree, (node) => node.type === 'Switch')[0].props.onValueChange(false)
  assert.deepEqual(transitions, [true, false])
  assert.equal(local.privateMode, false)
})
