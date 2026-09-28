const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const filename = path.join(__dirname, '../app/lib/storage.ts')
const source = fs.readFileSync(filename, 'utf8')
const output = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText

function loadStorage () {
  const local = new Map()
  const asyncStorage = {
    async getItem (key) { return local.get(key) ?? null },
    async setItem (key, value) { local.set(key, value) },
    async multiRemove (keys) { for (const key of keys) local.delete(key) }
  }
  const mod = { exports: {} }
  const sandbox = {
    module: mod,
    exports: mod.exports,
    console,
    require (name) {
      if (name === '@react-native-async-storage/async-storage') {
        return { __esModule: true, default: asyncStorage }
      }
      return require(name)
    }
  }
  vm.runInNewContext(output, sandbox, { filename })
  return { storage: mod.exports, local }
}

function makeRpc (initialSession, initialSettings = {}, initialLegacyTabs = []) {
  let session = initialSession
  let settings = initialSettings
  let legacyTabs = initialLegacyTabs
  const imports = []
  const operations = []
  return {
    imports,
    operations,
    get session () { return session },
    get settings () { return settings },
    get legacyTabs () { return legacyTabs },
    async userDataGetSession () { return { session } },
    async userDataSaveSession (next) { operations.push('session'); session = next },
    async userDataGetSettings () { return { settings } },
    async userDataSetSettings (next) { operations.push('settings'); settings = { ...settings, ...next } },
    async userDataImport (dump) {
      imports.push(dump)
      if (Array.isArray(dump.tabs)) { operations.push('legacyTabs'); legacyTabs = dump.tabs }
    }
  }
}

test('React Native tab writes preserve the Android shared session', async () => {
  const { storage } = loadStorage()
  const first = { id: 'android-1', url: 'hyper://' + 'a'.repeat(64), title: 'First' }
  const second = { id: 'android-2', url: 'hyper://' + 'b'.repeat(64), title: 'Second' }
  const rpc = makeRpc({
    activeTab: 'browse',
    lastBrowseUrl: second.url,
    browserTabs: [first, second],
    activeBrowserTabId: second.id
  })
  storage.setStorageBackend(new storage.HyperbeeBackend(rpc))

  assert.deepEqual(Array.from(await storage.getTabs(), tab => tab.id), ['android-1', 'android-2'])
  await storage.saveTabs([first])
  assert.deepEqual(Array.from(await storage.getTabs(), tab => tab.id), ['android-1'])
  assert.equal(rpc.session.activeTab, 'browse')
  assert.equal(rpc.session.activeBrowserTabId, 'android-2')
})

test('first Hyperbee migration leaves an existing native browser session intact', async () => {
  const { storage, local } = loadStorage()
  const oldTab = { id: 'rn-old', url: 'hyper://' + 'c'.repeat(64), title: 'Old' }
  const nativeTab = { id: 'android-current', url: 'hyper://' + 'd'.repeat(64), title: 'Current' }
  local.set(storage.KEYS.SESSION, JSON.stringify({ activeTab: 'browse', lastBrowseUrl: oldTab.url }))
  local.set(storage.KEYS.TABS, JSON.stringify([oldTab]))
  const rpc = makeRpc({
    activeTab: 'browse',
    lastBrowseUrl: nativeTab.url,
    browserTabs: [nativeTab],
    activeBrowserTabId: nativeTab.id
  })

  await storage.bootstrapHyperbeeStorage(rpc)
  assert.equal(rpc.session.activeBrowserTabId, nativeTab.id)
  assert.equal(rpc.imports.length, 0)
  assert.deepEqual(Array.from((await storage.getSession()).browserTabs, tab => tab.id), ['android-current'])
})

test('Private Mode scrubs saved tab URLs and prevents later session writes', async () => {
  const { storage, local } = loadStorage()
  const tab = { id: 'private-1', url: 'hyper://' + 'e'.repeat(64), title: 'Sensitive' }
  await storage.saveSession({
    activeTab: 'browse',
    lastBrowseUrl: tab.url,
    browserTabs: [tab],
    activeBrowserTabId: tab.id
  })
  await storage.saveTabs([tab])

  await storage.updateSettings({ privateMode: true })
  const stored = JSON.parse(local.get(storage.KEYS.SESSION))
  assert.equal(stored.lastBrowseUrl, null)
  assert.equal(stored.activeBrowserTabId, null)
  assert.equal(stored.browserTabs.length, 0)
  assert.equal(JSON.parse(local.get(storage.KEYS.TABS)).length, 0)

  await storage.saveSession({ lastBrowseUrl: tab.url, browserTabs: [tab] })
  await storage.saveTabs([tab])
  assert.equal(JSON.parse(local.get(storage.KEYS.SESSION)).lastBrowseUrl, null)
  assert.equal(JSON.parse(local.get(storage.KEYS.SESSION)).browserTabs.length, 0)
  assert.equal((await storage.getTabs()).length, 0)

  await storage.updateSettings({ privateMode: false })
  assert.equal((await storage.getSession()).browserTabs.length, 0)
  assert.equal((await storage.getSession()).lastBrowseUrl, null)
})

test('first migration does not import stale tabs into a private native profile', async () => {
  const { storage, local } = loadStorage()
  const oldTab = { id: 'rn-old', url: 'hyper://' + 'f'.repeat(64), title: 'Old' }
  local.set(storage.KEYS.SESSION, JSON.stringify({
    activeTab: 'browse', lastBrowseUrl: oldTab.url, browserTabs: [oldTab]
  }))
  local.set(storage.KEYS.TABS, JSON.stringify([oldTab]))
  const rpc = makeRpc({ activeTab: 'home', lastBrowseUrl: null }, { privateMode: true })

  await storage.bootstrapHyperbeeStorage(rpc)
  assert.deepEqual(Array.from(rpc.imports[0].tabs), [])
  assert.equal((await storage.getSession()).lastBrowseUrl, null)
  assert.equal((await storage.getTabs()).length, 0)
})

test('migration preserves native private settings without replacing unrelated fields', async () => {
  const { storage, local } = loadStorage()
  const oldTab = { id: 'rn-old', url: 'hyper://' + 'a'.repeat(64), title: 'Old' }
  local.set(storage.KEYS.SETTINGS, JSON.stringify({ privateMode: false, theme: 'light' }))
  local.set(storage.KEYS.SESSION, JSON.stringify({
    activeTab: 'browse', lastBrowseUrl: oldTab.url, browserTabs: [oldTab]
  }))
  const rpc = makeRpc(null, { privateMode: true, theme: 'native-dark' })

  await storage.bootstrapHyperbeeStorage(rpc)
  assert.equal(rpc.settings.privateMode, true)
  assert.equal(rpc.settings.theme, 'native-dark')
  assert.equal(JSON.parse(local.get(storage.KEYS.SETTINGS)).privateMode, true)
  assert.deepEqual(Array.from(rpc.imports[0].tabs), [])
  assert.equal((await storage.getSession()).lastBrowseUrl, null)
})

test('privacy settings read errors block session restore and writes', async () => {
  const { storage } = loadStorage()
  const rpc = makeRpc({ activeTab: 'home', lastBrowseUrl: null }, {})
  rpc.userDataGetSettings = async () => { throw new Error('settings offline') }
  storage.setStorageBackend(new storage.HyperbeeBackend(rpc))

  await assert.rejects(storage.getSession(), /settings offline/)
  await assert.rejects(storage.saveSession({ lastBrowseUrl: 'hyper://' + 'a'.repeat(64) }), /settings offline/)
  assert.equal(rpc.session.lastBrowseUrl, null)
})


test('session read errors block restore and writes instead of replacing saved tabs', async () => {
  const { storage } = loadStorage()
  const tab = { id: 'saved', url: 'hyper://' + 'b'.repeat(64), title: 'Saved' }
  const original = {
    activeTab: 'browse', lastBrowseUrl: tab.url,
    browserTabs: [tab], activeBrowserTabId: tab.id
  }
  const rpc = makeRpc(original)
  rpc.userDataGetSession = async () => { throw new Error('session offline') }
  storage.setStorageBackend(new storage.HyperbeeBackend(rpc))

  await assert.rejects(storage.getSession(), /session offline/)
  await assert.rejects(storage.saveSession({ browserTabs: [], lastBrowseUrl: null }), /session offline/)
  assert.equal(rpc.session.activeBrowserTabId, tab.id)
  assert.equal(rpc.session.browserTabs[0].url, tab.url)
})


test('Private Mode toggle does not commit when the shared session cannot be scrubbed', async () => {
  const { storage } = loadStorage()
  const tab = { id: 'old', url: 'hyper://' + 'c'.repeat(64), title: 'Old' }
  const rpc = makeRpc({ browserTabs: [tab], lastBrowseUrl: tab.url }, { privateMode: false })
  rpc.userDataSaveSession = async () => { throw new Error('session save offline') }
  storage.setStorageBackend(new storage.HyperbeeBackend(rpc))

  await assert.rejects(storage.updateSettings({ privateMode: true }), /session save offline/)
  assert.equal(rpc.settings.privateMode, false)
  assert.equal(rpc.session.browserTabs[0].id, tab.id)
})

test('failed privacy-settings read does not replace shared settings', async () => {
  const { storage } = loadStorage()
  const rpc = makeRpc(null, { privateMode: true, theme: 'custom' })
  rpc.userDataGetSettings = async () => { throw new Error('settings offline') }
  storage.setStorageBackend(new storage.HyperbeeBackend(rpc))

  await assert.rejects(storage.updateSettings({ theme: 'light' }), /settings offline/)
  assert.equal(rpc.settings.theme, 'custom')
  assert.equal(rpc.settings.privateMode, true)
})

test('private migration clears old local and replicated tabs before committing the setting', async () => {
  const { storage, local } = loadStorage()
  const tab = { id: 'old', url: 'hyper://' + 'c'.repeat(64), title: 'Old' }
  local.set(storage.KEYS.SETTINGS, JSON.stringify({ privateMode: true }))
  local.set(storage.KEYS.SESSION, JSON.stringify({ lastBrowseUrl: tab.url, browserTabs: [tab] }))
  local.set(storage.KEYS.TABS, JSON.stringify([tab]))
  const rpc = makeRpc({ lastBrowseUrl: tab.url, browserTabs: [tab] }, { privateMode: false, theme: 'native' }, [tab])

  await storage.bootstrapHyperbeeStorage(rpc)
  assert.equal(rpc.session.lastBrowseUrl, null)
  assert.equal(rpc.session.browserTabs.length, 0)
  assert.equal(rpc.legacyTabs.length, 0)
  assert.equal(JSON.parse(local.get(storage.KEYS.TABS)).length, 0)
  assert.equal(JSON.parse(local.get(storage.KEYS.SESSION)).lastBrowseUrl, null)
  assert.equal(rpc.settings.privateMode, true)
  assert.deepEqual(rpc.operations.slice(0, 3), ['session', 'legacyTabs', 'settings'])
})

test('private startup with an existing migration marker clears older replicated tabs', async () => {
  const { storage, local } = loadStorage()
  const tab = { id: 'old', url: 'hyper://' + 'd'.repeat(64), title: 'Old' }
  local.set('pearbrowser_hyperbee_migration_v1', JSON.stringify({ at: 1 }))
  const rpc = makeRpc({ lastBrowseUrl: tab.url, browserTabs: [tab] }, { privateMode: true }, [tab])

  await storage.bootstrapHyperbeeStorage(rpc)
  assert.equal(rpc.session.lastBrowseUrl, null)
  assert.equal(rpc.session.browserTabs.length, 0)
  assert.equal(rpc.legacyTabs.length, 0)
  assert.equal(JSON.parse(local.get(storage.KEYS.SETTINGS)).privateMode, true)
})

test('a failed legacy-tab scrub prevents Private Mode from being committed', async () => {
  const { storage } = loadStorage()
  const tab = { id: 'old', url: 'hyper://' + 'e'.repeat(64), title: 'Old' }
  const rpc = makeRpc({ lastBrowseUrl: tab.url, browserTabs: [tab] }, { privateMode: false }, [tab])
  rpc.userDataImport = async () => { throw new Error('legacy tabs offline') }
  storage.setStorageBackend(new storage.HyperbeeBackend(rpc))

  await assert.rejects(storage.updateSettings({ privateMode: true }), /legacy tabs offline/)
  assert.equal(rpc.settings.privateMode, false)
  assert.equal(rpc.legacyTabs.length, 1)
})

test('external Private Mode observation reads strictly after the local transition queue', async () => {
  const { storage, local } = loadStorage()
  const rpc = makeRpc(null, { privateMode: false })
  storage.setStorageBackend(new storage.HyperbeeBackend(rpc))
  await storage.updateSettings({ privateMode: true })
  assert.equal(await storage.getPrivateModeStrict(), true)
  assert.equal(JSON.parse(local.get(storage.KEYS.SETTINGS)).privateMode, true)

  rpc.settings.privateMode = false
  assert.equal(await storage.getPrivateModeStrict(), false)
  await storage.scrubBrowserSession()
  assert.equal(rpc.session.lastBrowseUrl, null)
  assert.equal(rpc.legacyTabs.length, 0)
})

test('RN observes external mode changes and gates saves until the scrub succeeds', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app/App.tsx'), 'utf8')
  const observer = app.slice(app.indexOf('// The shared setting can change'), app.indexOf('// Keep a bounded set of live WebViews'))
  assert.match(observer, /getPrivateModeStrict\(\)/)
  assert.match(observer, /observed !== privateModeRef\.current[\s\S]*?setPrivacySettled\(false\)[\s\S]*?handlePrivateModeChange\(observed\)/)
  assert.match(observer, /await scrubBrowserSession\(\)[\s\S]*?setPrivacySettled\(true\)/)
  assert.match(observer, /setInterval\(checkPrivateMode, 5_000\)/)
  assert.match(observer, /NativeAppState\.addEventListener\('change'/)
})
