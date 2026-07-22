'use strict'

/**
 * Local-first search + petname naming mobile parity audit (Mission B3).
 *
 * Asserts the shipped surfaces line up: the ported backend modules
 * (search-core … federated-name-resolver), the command/event ids shared with
 * the desktop, the backend/index.js handlers + boot wiring, the hyper-proxy
 * indexing chokepoint, the CMD_NAVIGATE name-resolution path, the Android
 * Protocol.kt mirror + PearRpcClient wrappers, the Search screen, the
 * Settings Names section, and the URL-bar fix.
 *
 * Semantics themselves are pinned by the ported desktop suites
 * (search-*.test.js, personal-index, query-planner, cmd-search-contract,
 * names + the name-* suites + resolve-name + federated-name-resolver) — this
 * suite pins the WIRING so a future drift is loud.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

// --- Command + event ids ------------------------------------------------------

test('search + name command ids match the desktop numbering', () => {
  const backend = require('../backend/constants')
  const expected = {
    CMD_SEARCH: 177,
    CMD_SEARCH_INDEX: 178,
    CMD_NAME_RESOLVE: 250,
    CMD_NAME_PETNAME_LIST: 251,
    CMD_NAME_PETNAME_SET: 252,
    CMD_NAME_PETNAME_REMOVE: 253,
    CMD_IDENTITY_BINDING_PUBLISH: 260,
    CMD_IDENTITY_BINDING_RESOLVE: 261,
    CMD_SEARCH_FEDERATED: 262,
    CMD_NAMEREG_CLAIM: 264,
    CMD_NAMEREG_ROTATE: 265,
    CMD_NAMEREG_RELEASE: 266,
    CMD_NAMEREG_REVOKE: 267,
    CMD_NAMEREG_LIST: 268,
    CMD_NAMEREG_RESOLVE: 269,
    CMD_NAMEREG_STATUS: 270,
  }
  for (const [name, id] of Object.entries(expected)) {
    assert.equal(backend[name], id, `backend ${name} id mismatch`)
  }

  // Mobile deviation (documented in backend/constants.js): the desktop's
  // EVT_SEARCH_FEDERATED=108 collides with mobile's long-standing
  // EVT_CATALOG_UPDATED=108 — mobile assigns 112/113 and keeps 108.
  assert.equal(backend.EVT_CATALOG_UPDATED, 108, 'EVT_CATALOG_UPDATED must stay 108')
  assert.equal(backend.EVT_SEARCH_FEDERATED, 112, 'EVT_SEARCH_FEDERATED mobile id')
  assert.equal(backend.EVT_IDENTITY_BINDING_PUBLISHED, 113, 'EVT_IDENTITY_BINDING_PUBLISHED mobile id')

  const protocol = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/Protocol.kt')
  for (const [name, id] of Object.entries(expected)) {
    const kotlinName = name.replace(/^CMD_/, '')
    assert.match(protocol, new RegExp(`\\b${kotlinName}\\s*=\\s*${id}\\b`), `Protocol.kt: ${kotlinName} id mismatch`)
  }
  assert.match(protocol, /\bCATALOG_UPDATED\s*=\s*108\b/, 'Protocol.kt: CATALOG_UPDATED must stay 108')
  assert.match(protocol, /\bSEARCH_FEDERATED\s*=\s*112\b/, 'Protocol.kt: SEARCH_FEDERATED event id mismatch')
  assert.match(protocol, /\bIDENTITY_BINDING_PUBLISHED\s*=\s*113\b/, 'Protocol.kt: IDENTITY_BINDING_PUBLISHED id mismatch')
})

// --- Ported backend modules ---------------------------------------------------

test('ported search modules ship the desktop exports', () => {
  const sc = require('../backend/search-core.cjs')
  for (const fn of ['tokenize', 'docIdFor', 'buildDocRecords', 'canonDocBytes', 'rankCandidates', 'scanHits', 'searchCandidates', 'searchSignedHits', 'searchIndex']) {
    assert.equal(typeof sc[fn], 'function', `search-core.${fn} missing`)
  }
  assert.equal(sc.SCHEMA_VERSION, 2, 'search schema version changed')

  const dg = require('../backend/search-digest.cjs')
  for (const fn of ['buildDigest', 'digestMayContainDoc', 'digestHasTerm', 'digestWorthPulling']) {
    assert.equal(typeof dg[fn], 'function', `search-digest.${fn} missing`)
  }

  const sf = require('../backend/search-federation.cjs')
  for (const fn of ['buildTrustGraph', 'trustRowsToEdges', 'mergeFederated', 'tagCandidate']) {
    assert.equal(typeof sf[fn], 'function', `search-federation.${fn} missing`)
  }

  const fr = require('../backend/search-frontier.cjs')
  for (const fn of ['makeIndexPointer', 'verifyIndexPointer', 'resolveIndexKey', 'planFanout', 'buildFrontier']) {
    assert.equal(typeof fr[fn], 'function', `search-frontier.${fn} missing`)
  }
  // The fan-out budget caps the desktop enforces — no silent wide fanout.
  assert.equal(fr.DEFAULT_BUDGET.maxConnectsPerQuery, 4, 'fan-out cold-connect cap changed')
  assert.equal(fr.DEFAULT_BUDGET.maxLiveSessions, 24, 'live-session ceiling changed')
  assert.equal(fr.DEFAULT_BUDGET.maxFrontier, 64, 'frontier cap changed')

  const cmp = require('../backend/search-completeness.cjs')
  for (const fn of ['makeAnchor', 'verifyAnchor', 'isTruncation', 'isFork', 'deriveProbes', 'detectWithholding']) {
    assert.equal(typeof cmp[fn], 'function', `search-completeness.${fn} missing`)
  }

  const sh = require('../backend/search-shard.cjs')
  for (const fn of ['shardOf', 'planCrossShardAnd']) {
    assert.equal(typeof sh[fn], 'function', `search-shard.${fn} missing`)
  }

  const ib = require('../backend/identity-binding.cjs')
  for (const fn of ['verifyAppSig', 'makeBinding', 'verifyBinding', 'makeRevocation', 'verifyRevocation', 'resolveSearchKey']) {
    assert.equal(typeof ib[fn], 'function', `identity-binding.${fn} missing`)
  }

  const { PersonalIndex } = require('../backend/personal-index.cjs')
  for (const fn of ['ready', 'indexDoc', 'removeDoc', 'search', 'stats', 'buildDigest', 'coreKeyHex', 'coreState', 'close']) {
    assert.equal(typeof PersonalIndex.prototype[fn], 'function', `PersonalIndex.${fn} missing`)
  }

  const handler = require('../backend/search-handler.js')
  assert.equal(typeof handler.createSearchHandler, 'function', 'createSearchHandler missing')
  assert.equal(handler.MAX_QUERY_CHARS, 512, 'query char cap changed')
  assert.equal(handler.MAX_SEARCH_LIMIT, 100, 'search limit cap changed')

  const qp = require('../backend/query-planner.js')
  assert.equal(typeof qp.QueryPlanner, 'function', 'QueryPlanner missing')
  assert.equal(typeof qp.SearchFanoutBudget, 'function', 'SearchFanoutBudget missing')

  const { IdentityBindingPublisher } = require('../backend/identity-binding-publisher.js')
  assert.equal(typeof IdentityBindingPublisher.prototype.publish, 'function', 'publisher.publish missing')
  assert.equal(typeof IdentityBindingPublisher.prototype.resolve, 'function', 'publisher.resolve missing')
  assert.equal(typeof IdentityBindingPublisher.prototype.signDocSync, 'function', 'publisher.signDocSync missing')
})

test('ported name modules ship the desktop exports', () => {
  const nn = require('../backend/name-normalize.cjs')
  for (const fn of ['normalize', 'skeleton']) {
    assert.equal(typeof nn[fn], 'function', `name-normalize.${fn} missing`)
  }

  const na = require('../backend/name-aliases.cjs')
  assert.equal(typeof na.lookupAlias, 'function', 'lookupAlias missing')
  assert.ok(Array.isArray(na.NAME_ALIASES) && na.NAME_ALIASES.length > 0, 'curated aliases missing')

  const nr = require('../backend/name-record.cjs')
  for (const fn of ['decodeNameRecord', 'encodeNameRecord', 'resolveNameRecord']) {
    assert.equal(typeof nr[fn], 'function', `name-record.${fn} missing`)
  }

  const ops = require('../backend/name-registry-ops.cjs')
  for (const fn of ['normalizeTarget', 'targetToResolution', 'canon', 'isWellFormedOp', 'claimOp', 'rotateOp', 'releaseOp', 'revokeOp']) {
    assert.equal(typeof ops[fn], 'function', `name-registry-ops.${fn} missing`)
  }

  const apply = require('../backend/name-registry-apply.cjs')
  for (const fn of ['verifyOpAuthenticity', 'decide', 'applyView', 'resolveFromNames']) {
    assert.equal(typeof apply[fn], 'function', `name-registry-apply.${fn} missing`)
  }

  const { Names } = require('../backend/names.cjs')
  for (const fn of ['ready', 'setPetname', 'lookupPetname', 'list', 'petnameMap', 'removePetname', 'recordSeen', 'close']) {
    assert.equal(typeof Names.prototype[fn], 'function', `Names.${fn} missing`)
  }

  const { NameRegistry } = require('../backend/name-registry-store.cjs')
  for (const fn of ['ready', 'claim', 'rotate', 'release', 'revoke', 'resolve', 'list', 'activeMap', 'addWriter', 'close']) {
    assert.equal(typeof NameRegistry.prototype[fn], 'function', `NameRegistry.${fn} missing`)
  }

  const rn = require('../backend/resolve-name.cjs')
  assert.equal(typeof rn.resolveName, 'function', 'resolveName missing')

  const fnr = require('../backend/federated-name-resolver.cjs')
  assert.equal(typeof fnr.FederatedNameResolver, 'function', 'FederatedNameResolver missing')

  const eab = require('../backend/encrypted-autobase-helper.cjs')
  assert.equal(typeof eab.createEncryptedAutobaseManager, 'function', 'encrypted-autobase-helper missing')

  const cs = require('../backend/catalog-safety.cjs')
  for (const fn of ['normalizeCatalogLink', 'normalizeDriveKey', 'driveKeyFromHyperLink']) {
    assert.equal(typeof cs[fn], 'function', `catalog-safety.${fn} missing`)
  }
})

// --- Backend wiring -----------------------------------------------------------

test('backend wires the search handlers, boot modules, and privacy gates', () => {
  const index = read('backend/index.js')
  assert.match(index, /rpc\.handle\(C\.CMD_SEARCH,/, 'CMD_SEARCH handler missing')
  assert.match(index, /rpc\.handle\(C\.CMD_SEARCH_INDEX,/, 'CMD_SEARCH_INDEX handler missing')
  assert.match(index, /rpc\.handle\(C\.CMD_SEARCH_FEDERATED,/, 'CMD_SEARCH_FEDERATED handler missing')
  assert.match(index, /rpc\.handle\(C\.CMD_IDENTITY_BINDING_PUBLISH,/, 'CMD_IDENTITY_BINDING_PUBLISH handler missing')
  assert.match(index, /rpc\.handle\(C\.CMD_IDENTITY_BINDING_RESOLVE,/, 'CMD_IDENTITY_BINDING_RESOLVE handler missing')
  assert.match(index, /createSearchHandler\(/, 'search-handler not constructed')
  assert.match(index, /rpc\.event\(C\.EVT_SEARCH_FEDERATED/, 'federated event emit missing')
  assert.match(index, /new PersonalIndex\(store,/, 'PersonalIndex boot missing')
  assert.match(index, /new QueryPlanner\(/, 'QueryPlanner boot missing')
  assert.match(index, /new SearchFanoutBudget\(/, 'fan-out budget missing')
  assert.match(index, /new IdentityBindingPublisher\(/, 'binding publisher boot missing')
  // Privacy-first: indexing is opt-in OFF, gated at BOTH entry points
  // (CMD_SEARCH_INDEX and the proxy hook).
  assert.match(index, /isSearchIndexEnabled\(settings\)[\s\S]{0,120}reason: 'search-index-disabled'/, 'CMD_SEARCH_INDEX opt-in gate missing')
  assert.match(index, /proxy\.setPageIndexer\(/, 'proxy indexing hook missing')
  assert.match(index, /extractIndexContent\(html\)/, 'proxy-side text extraction missing')
})

test('backend wires the name handlers, registry, and resolver gating', () => {
  const index = read('backend/index.js')
  for (const cmd of ['CMD_NAME_RESOLVE', 'CMD_NAME_PETNAME_LIST', 'CMD_NAME_PETNAME_SET', 'CMD_NAME_PETNAME_REMOVE',
    'CMD_NAMEREG_CLAIM', 'CMD_NAMEREG_ROTATE', 'CMD_NAMEREG_RELEASE', 'CMD_NAMEREG_REVOKE',
    'CMD_NAMEREG_LIST', 'CMD_NAMEREG_RESOLVE', 'CMD_NAMEREG_STATUS']) {
    assert.match(index, new RegExp(`rpc\\.handle\\(C\\.${cmd},`), `${cmd} handler missing`)
  }
  assert.match(index, /new Names\(store\)/, 'Names boot missing')
  assert.match(index, /new NameRegistry\(store,/, 'NameRegistry construction missing')
  assert.match(index, /new FederatedNameResolver\(/, 'FederatedNameResolver boot missing')
  assert.match(index, /ensureNameRegistry/, 'serialized registry ensure missing')
  assert.match(index, /openContactRegistry/, 'contact registry federation missing')
  assert.match(index, /nameRegSigner/, 'backend-side owner signer missing')
  // Desktop parity gate: naming is experimental-opt-in; disabled ⇒ resolve
  // answers null and mutations fail closed.
  assert.match(index, /experimentalNaming/, 'experimentalNaming gate missing')
  assert.match(index, /isNamingEnabled/, 'naming gate helper missing')
  assert.match(index, /Naming \(petnames\) is experimental/, 'fail-closed mutation error missing')
})

test('CMD_NAVIGATE resolves pearname:// and bare words before URL handling', () => {
  const index = read('backend/index.js')
  assert.match(index, /nameQueryFromInput\(rawInput\)/, 'navigate name prefilter missing')
  assert.match(index, /resolveNameTiered\(nameQuery\)/, 'navigate tiered resolution missing')
  assert.match(index, /kind: 'pear-link'/, 'pear-link navigate response missing')
  assert.match(index, /nameResolution/, 'nameResolution response metadata missing')
  // Resolution failure must never break navigation.
  assert.match(index, /catch \{ \/\* name resolution never breaks navigation \*\/ \}/, 'fail-open fallback missing')
})

test('hyper-proxy ships the /hyper/ indexing chokepoint', () => {
  const proxy = read('backend/hyper-proxy.js')
  assert.match(proxy, /setPageIndexer/, 'setPageIndexer missing')
  assert.match(proxy, /_reportPageForIndex/, 'index report helper missing')
  // Both HTML serve paths (cache hit + fresh fetch) report, /hyper/ only —
  // installed /app/ pages are not indexed (desktop parity).
  const sites = proxy.match(/path\.startsWith\('\/hyper\/'\)\) this\._reportPageForIndex/g) || []
  assert.equal(sites.length, 2, 'expected exactly 2 /hyper/ indexing call sites (cache hit + fresh fetch)')
})

// --- Android mirror -------------------------------------------------------------

test('Android RPC client exposes the search + name wrappers', () => {
  const client = read('android-native/app/src/main/java/com/pearbrowser/app/rpc/PearRpcClient.kt')
  assert.match(client, /suspend fun search\(/, 'search wrapper missing')
  assert.match(client, /Cmd\.SEARCH\b/, 'SEARCH id not used')
  assert.match(client, /suspend fun nameResolve\(/, 'nameResolve wrapper missing')
  assert.match(client, /Cmd\.NAME_RESOLVE\b/, 'NAME_RESOLVE id not used')
  for (const fn of ['nameregStatus', 'nameregList', 'nameregClaim', 'nameregRotate', 'nameregRelease', 'nameregRevoke']) {
    assert.match(client, new RegExp(`suspend fun ${fn}\\(`), `${fn} wrapper missing`)
  }
  for (const model of ['PearSearchResult', 'PearSearchReply', 'PearSearchFederatedEvent', 'PearNameResolution', 'PearNameEntry', 'PearNameRegStatus']) {
    assert.match(client, new RegExp(`data class ${model}\\b`), `${model} model missing`)
  }
})

test('Android Search screen follows the desktop Library/FederatedSearch shape', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SearchScreen.kt')
  assert.match(screen, /client\.search\(/, 'search call missing')
  assert.match(screen, /Include trusted peers/, 'federated toggle missing')
  assert.match(screen, /ACTION_SEARCH_FEDERATED/, 'federated event listener missing')
  assert.match(screen, /event\.queryId != searchId\[0\]/, 'stale-query suppression missing')
  assert.match(screen, /trusted · hop/, 'tier badge missing')
  assert.match(screen, /searchIndexEnabled/, 'indexing opt-in hint missing')

  const main = read('android-native/app/src/main/java/com/pearbrowser/app/MainActivity.kt')
  assert.match(main, /MoreRoute\.Search\b/, 'Search route missing from MainActivity')
  assert.match(main, /import com\.pearbrowser\.app\.ui\.screens\.SearchScreen/, 'SearchScreen import missing')

  const more = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/MoreScreen.kt')
  assert.match(more, /onOpenSearch/, 'More hub Search item missing')

  const service = read('android-native/app/src/main/java/com/pearbrowser/app/bridge/PearWorkletService.kt')
  assert.match(service, /Evt\.SEARCH_FEDERATED/, 'worklet event subscription missing')
  assert.match(service, /ACTION_SEARCH_FEDERATED/, 'federated broadcast missing')

  const events = read('android-native/app/src/main/java/com/pearbrowser/app/bridge/PearWorkletEvents.kt')
  assert.match(events, /EXTRA_SEARCH_PAYLOAD/, 'search payload extra missing')
})

test('Android Settings ships the Names section', () => {
  const screen = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/SettingsScreen.kt')
  assert.match(screen, /NamesSection\(\)/, 'section not routed into SettingsScreen')
  assert.match(screen, /SettingsCard\("Names"\)/, 'card title missing')
  assert.match(screen, /experimentalNaming/, 'enable toggle settings key missing')
  assert.match(screen, /nameregStatus\(/, 'status read missing')
  assert.match(screen, /nameregClaim\(/, 'claim call missing')
  assert.match(screen, /nameregRotate\(/, 'rotate call missing')
  assert.match(screen, /nameregRelease\(/, 'release call missing')
  assert.match(screen, /nameregRevoke\(/, 'revoke call missing')
  assert.match(screen, /pearname:\/\//, 'pearname copy missing')
})

test('URL-bar bare words reach the CMD_NAVIGATE resolution path', () => {
  const home = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/HomeScreen.kt')
  // The B3 fix: go() passes the raw input through — no hyper:// prefixing
  // (the old code made name resolution unreachable from the URL bar).
  assert.doesNotMatch(home, /"hyper:\/\/\$url"/, 'HomeScreen still prefixes bare words with hyper://')

  const browse = read('android-native/app/src/main/java/com/pearbrowser/app/ui/screens/BrowseScreen.kt')
  assert.match(browse, /kind == "pear-link"/, 'pear-link response handling missing')
  // The non-hyper/non-http(s) branch (bare words) resolves through CMD_NAVIGATE.
  assert.match(browse, /\/\/ Mission B3: bare words[\s\S]{0,1500}client\.navigate\(target\)/,
    'bare-word branch must resolve through CMD_NAVIGATE')
})

// --- URL-bar name prefilter + proxy text extraction (functional) --------------

test('name-query prefilter mirrors the desktop keys.js gates', () => {
  const nq = require('../backend/name-query.cjs')
  // looksLikeName accepts bare name tokens, rejects URLs/keys/domains
  // (desktop test/keys.test.js).
  for (const ok of ['keet', 'PearPass', 'pear-pass', 'anon_gpt', '  keet  ', 'алиса', 'ＫＥＥＴ']) {
    assert.equal(nq.looksLikeName(ok), true, `looksLikeName(${ok}) should be true`)
  }
  for (const bad of ['', '   ', 'foo.com', 'foo/bar', 'hyper://keet', 'pear://keet', 'a b', '-leading',
    'a'.repeat(64), null, undefined]) {
    assert.equal(nq.looksLikeName(bad), false, `looksLikeName(${bad}) should be false`)
  }
  // parsePearname strips the scheme and gates well-formedness.
  assert.equal(nq.parsePearname('pearname://alice'), 'alice')
  assert.equal(nq.parsePearname('pearname://alice/'), 'alice')
  assert.equal(nq.parsePearname('PEARNAME://Bob'), 'Bob')
  assert.equal(nq.parsePearname('pearname://'), null)
  assert.equal(nq.parsePearname('pearname://has space'), null)
  assert.equal(nq.parsePearname('pearname://a/b'), null)
  // nameQueryFromInput: pearname:// and bare words only.
  assert.equal(nq.nameQueryFromInput('pearname://keet'), 'keet')
  assert.equal(nq.nameQueryFromInput('keet'), 'keet')
  assert.equal(nq.nameQueryFromInput('hyper://keet'), null)
  assert.equal(nq.nameQueryFromInput('https://example.com'), null)
  assert.equal(nq.nameQueryFromInput('foo.com'), null)
  assert.equal(nq.nameQueryFromInput(''), null)
  // normalizeNameTarget: claim input gate.
  assert.equal(nq.normalizeNameTarget('A'.repeat(64)), 'a'.repeat(64))
  assert.equal(nq.normalizeNameTarget('hyper://' + 'a'.repeat(64) + '/'), 'hyper://' + 'a'.repeat(64) + '/')
  assert.equal(nq.normalizeNameTarget('pear://oeeoz3w6fjjt7bym3ndpa6hhicm8f8naxyk11z4iypeoupn6jzpo'), 'pear://oeeoz3w6fjjt7bym3ndpa6hhicm8f8naxyk11z4iypeoupn6jzpo')
  assert.equal(nq.normalizeNameTarget('javascript:alert(1)'), null)
  assert.equal(nq.normalizeNameTarget(''), null)
})

test('html-raw-text extraction feeds the index (title + body, blocks dropped)', () => {
  const h = require('../backend/html-raw-text.cjs')
  const { title, text } = h.extractIndexContent(
    '<html><head><title>Keet &amp; Chat</title><style>.x{color:red}</style></head>' +
    '<body><h1>Hello &lt;world&gt;</h1><script>var secret = 1;</script>' +
    '<noscript>enable js</noscript><p>peer&nbsp;to&nbsp;peer chat</p></body></html>'
  )
  assert.equal(title, 'Keet & Chat')
  assert.ok(text.includes('peer to peer chat'), 'body text extracted')
  assert.ok(text.includes('Hello <world>'), 'entities decoded')
  assert.ok(!text.includes('secret'), 'script bodies dropped')
  assert.ok(!text.includes('color:red'), 'style bodies dropped')
  assert.ok(!text.includes('enable js'), 'noscript bodies dropped')
  // Cap mirrors the desktop UI's 200 KB innerText limit.
  assert.equal(h.MAX_INDEX_TEXT, 200000, 'index text cap changed')
  const huge = '<body>' + 'word '.repeat(100000) + '</body>'
  assert.ok(h.htmlToIndexText(huge).length <= h.MAX_INDEX_TEXT, 'index text is capped')
  // escapeStyleText (B1 consumer) still exported.
  assert.equal(h.escapeStyleText('a<b'), 'a\\3c b')
})
