/**
 * RPC commands and events — shared between React Native and worklet.
 *
 * Uses simple numeric IDs for framed-stream message routing.
 * Commands flow RN → worklet, events flow worklet → RN.
 */

// --- Commands (RN → Worklet) ---

// Browser
const CMD_NAVIGATE = 1
const CMD_GET_STATUS = 2

// App Store
const CMD_LOAD_CATALOG = 10
const CMD_LOAD_CATALOG_BEE = 16  // Phase 1 ticket 1 — Hyperbee catalog
const CMD_INSTALL_APP = 11
const CMD_UNINSTALL_APP = 12
const CMD_LAUNCH_APP = 13
const CMD_LIST_INSTALLED = 14
const CMD_CHECK_UPDATES = 15

// Site Builder
const CMD_CREATE_SITE = 20
const CMD_UPDATE_SITE = 21
const CMD_PUBLISH_SITE = 22
const CMD_UNPUBLISH_SITE = 23
const CMD_LIST_SITES = 24
const CMD_DELETE_SITE = 25
const CMD_LOAD_TEMPLATE = 26
const CMD_CLEAR_CACHE = 30
const CMD_GET_IDENTITY = 31

// Relay configuration (Phase 0 ticket 2 — remove hardcoded relay)
const CMD_GET_RELAYS = 40
const CMD_SET_RELAYS = 41
const CMD_SET_RELAY_ENABLED = 42

// User data — bookmarks + history + settings in Hyperbee (Phase 1 ticket 2)
const CMD_USERDATA_LIST_BOOKMARKS = 50
const CMD_USERDATA_ADD_BOOKMARK = 51
const CMD_USERDATA_REMOVE_BOOKMARK = 52
const CMD_USERDATA_LIST_HISTORY = 53
const CMD_USERDATA_ADD_HISTORY = 54
const CMD_USERDATA_CLEAR_HISTORY = 55
const CMD_USERDATA_GET_SETTINGS = 56
const CMD_USERDATA_SET_SETTINGS = 57
const CMD_USERDATA_GET_SESSION = 58
const CMD_USERDATA_SAVE_SESSION = 59
const CMD_USERDATA_IMPORT = 60

// Identity — seed phrase export/import/rotate (Phase 1 ticket 3)
const CMD_IDENTITY_EXPORT_PHRASE = 70
const CMD_IDENTITY_IMPORT_PHRASE = 71
const CMD_IDENTITY_ROTATE = 72
const CMD_IDENTITY_VALIDATE_PHRASE = 73
const CMD_IDENTITY_SIGN = 74
const CMD_DEVICE_LINK_CREATE_INVITE = 76
const CMD_DEVICE_LINK_JOIN = 77

// Profile + grants (Identity Plan Phase B)
const CMD_PROFILE_GET = 80
const CMD_PROFILE_UPDATE = 81
const CMD_PROFILE_CLEAR = 82

// Login consent ceremony (Identity Plan Phase C)
const CMD_LOGIN_LIST_GRANTS = 83
const CMD_LOGIN_REVOKE_GRANT = 84
const CMD_LOGIN_REVOKE_ALL = 85
/** Resolve a pending login consent — sent by the UI after user decides. */
const CMD_LOGIN_RESOLVE = 86

// Contacts (Identity Plan Phase D)
const CMD_CONTACTS_LIST = 90
const CMD_CONTACTS_LOOKUP = 91
const CMD_CONTACTS_ADD = 92
const CMD_CONTACTS_UPDATE = 93
const CMD_CONTACTS_REMOVE = 94

// HTTPS bridge sessions (Phase E follow-up — per-origin tokens for
// non-hyper:// pages so HTTPS apps can use window.pear.* uniformly).
const CMD_PEAR_SESSION = 95

// Trusted-origins allow-list — opt-in privacy mode that gates which
// HTTPS origins get the window.pear bridge injected. Default mode
// is 'all' (current behaviour); user can flip to 'allowlist' in
// Settings → Privacy.
const CMD_TRUSTED_ORIGINS_LIST = 96
const CMD_TRUSTED_ORIGINS_ADD = 97
const CMD_TRUSTED_ORIGINS_REMOVE = 98
const CMD_TRUSTED_ORIGINS_SET_MODE = 110

// Direct page-scoped Hyperswarm access (`window.pear.swarm.v1`).
const CMD_SWARM_RESOLVE = 120
const CMD_SWARM_LIST_GRANTS = 121
const CMD_SWARM_REVOKE_GRANT = 122
const CMD_SWARM_REVOKE_ALL_FOR_APP = 123

// Pear Bridge (WebView → worklet via RN relay)
const CMD_BRIDGE = 200

// TabRuntime — run a pear-request app headless, streamed into a browser tab
// (Mission B4b, ported from pearbrowser-desktop; same numeric id so shells
// stay aligned). Mobile gates the pear:// / file:// worker path (no pear-run
// on the Android worklet); the in-proc 'demo' path works like the desktop.
const CMD_RUN_APP_IN_TAB = 201

// QVAC / Ask Browser (Mission B4b, ported from pearbrowser-desktop; same
// numeric ids so shells stay aligned). The on-device LLM runtime is gated on
// mobile — the @qvac/llm-llamacpp native addon is not linked into the
// Android worklet — so CAPABILITIES reports the honest availability state
// and START/CANCEL fail closed with a typed 'runtime-unavailable' error.
const CMD_ASK_BROWSER_CAPABILITIES = 220
const CMD_ASK_BROWSER_START = 221
const CMD_ASK_BROWSER_CANCEL = 222

// System
const CMD_STOP = 99

// Content Shield (ported from pearbrowser-desktop — BROWSER_PARITY_PLAN.md
// Phases 1–2 gates). Same numeric ids as the desktop so shells stay aligned.
// The enable toggle and durable list/allowlist/strict state persist through
// user-data settings; these commands return live state and mutate per-drive
// / list policy.
const CMD_SHIELD_STATUS = 230
const CMD_SHIELD_LOAD_LIST = 231   // { name, text } → hot-swap named list (durable)
const CMD_SHIELD_REMOVE_LIST = 232 // { name } → drop a named list
const CMD_SHIELD_SET_ALLOW = 233   // { driveKey, allow: boolean } → per-drive allowlist
const CMD_SHIELD_SET_STRICT = 234  // { driveKey, strict: boolean } → per-drive strict CSP

// Pear Plugins (Mission B4a, ported from pearbrowser-desktop Phase 3 — same
// numeric ids as the desktop so shells stay aligned). Drive-installed
// extensions: capability grant + snapshot-bound consent at install,
// escalation guard on update, kill switch, P2P catalogue.
const CMD_PLUGIN_LIST = 235        // → { plugins: [...] }
const CMD_PLUGIN_SET_ENABLED = 236 // { id, enabled } → kill-switch without uninstall
const CMD_PLUGIN_REGISTER = 237    // { id, manifest, contribution?, enabled? } → fixture/install path

// Lighthouse P2P search + petname naming (Mission B3, ported from
// pearbrowser-desktop). Same numeric ids as the desktop so shells stay
// aligned. Local-first: querying the personal index is fully on-device;
// indexing hyper:// pages is opt-in (searchIndexEnabled, default OFF).
const CMD_SEARCH = 177        // query the personal index
const CMD_SEARCH_INDEX = 178  // index a page { driveKey, path, title, text }

// Names (petnames + the N5 multi-writer name registry). Gated by the same
// `experimentalNaming` settings flag as the desktop — disabled ⇒ resolve
// answers null and the URL bar behaves exactly as before.
const CMD_NAME_RESOLVE = 250
const CMD_NAME_PETNAME_LIST = 251
const CMD_NAME_PETNAME_SET = 252
const CMD_NAME_PETNAME_REMOVE = 253

// Identity binding + explicit federated trigger (v1 folds into CMD_SEARCH).
const CMD_IDENTITY_BINDING_PUBLISH = 260  // publish/refresh our binding to DHT + meta
const CMD_IDENTITY_BINDING_RESOLVE = 261  // resolve a contact's current search pubkey
const CMD_SEARCH_FEDERATED = 262          // explicit federated trigger

// N5 name registry — owner-signed, first-claim-wins, homograph-guarded.
const CMD_NAMEREG_CLAIM = 264
const CMD_NAMEREG_ROTATE = 265
const CMD_NAMEREG_RELEASE = 266
const CMD_NAMEREG_REVOKE = 267
const CMD_NAMEREG_LIST = 268
const CMD_NAMEREG_RESOLVE = 269
const CMD_NAMEREG_STATUS = 270

// Shield + privacy posture snapshot for settings surfaces.
const CMD_PRIVACY_STATUS = 238

// P2P distribution: filter lists arrive as Hyperdrives. Subscriptions are
// durable and work offline after first sync; updates hot-swap after
// manifest version/sha256 verification.
const CMD_SHIELD_SUBSCRIBE_LIST = 239   // { driveKey } → subscribe to a filter-list drive
const CMD_SHIELD_UNSUBSCRIBE_LIST = 240 // { driveKey }
const CMD_SHIELD_REFRESH_LISTS = 241    // { driveKey?, force? } → refresh one or all subscriptions

// Plugin drives + catalogue (Mission B4a — same numeric ids as the desktop).
const CMD_PLUGIN_INSTALL_DRIVE = 242    // preview {driveKey}; accept {driveKey, granted, reviewedFingerprint}
const CMD_PLUGIN_UPDATE_DRIVE = 243     // update/preview escalation; accept with grant + reviewedFingerprint
const CMD_PLUGIN_UNINSTALL = 244        // { driveKey }
const CMD_PLUGIN_CATALOG = 245          // → { entries, sources } (builtin seed + subscribed catalogue drives)
const CMD_PLUGIN_CATALOG_LOAD_DRIVE = 246   // { driveKey } → subscribe to a catalogue drive (/plugins.json)
const CMD_PLUGIN_CATALOG_REMOVE_SOURCE = 247 // { driveKey }

// --- Events (Worklet → RN) ---
const EVT_READY = 100
const EVT_PEER_COUNT = 101
const EVT_ERROR = 102
const EVT_INSTALL_PROGRESS = 103
const EVT_SITE_PUBLISHED = 104
const EVT_BOOT_PROGRESS = 105
/** A WebView called window.pear.login() — show the consent sheet.
 *  Payload: { requestId, driveKey, appName, reason, scopes, currentGrant } */
const EVT_LOGIN_REQUEST = 106
/** A WebView called window.pear.swarm.v1.join() for an arbitrary topic.
 *  Payload: { requestId, driveKey, appName, reason, topicHex, protocol } */
const EVT_SWARM_REQUEST = 107
/** A signed P2P catalog bee appended (producer published an update) and
 *  re-verified successfully. Payload: { keyHex, catalog } */
const EVT_CATALOG_UPDATED = 108
/** Federated (trusted-peer) search enrichment for an earlier CMD_SEARCH.
 *  Payload: { queryId, results, phase:'enriched', verifyBudgetExhausted,
 *  digestHit, fallbackPull, partial, provenance }.
 *  NOTE (mobile deviation): the desktop uses 108 here, but 108 has been
 *  EVT_CATALOG_UPDATED on mobile since the signed-catalog-bee work shipped
 *  (app/lib/constants.ts + Android Protocol.kt) — mobile assigns 112/113. */
const EVT_SEARCH_FEDERATED = 112
/** Our IdentityBinding was published/refreshed. Payload: { searchPubkey, version }. */
const EVT_IDENTITY_BINDING_PUBLISHED = 113
/** Ask Browser streaming events (Mission B4b — same numeric id as the
 *  desktop; 111 is unassigned on mobile). Payload:
 *  { streamId, requestId, event } where event is
 *  { type: 'model-progress'|'text'|'stats'|'done'|'error', ... }. */
const EVT_ASK_BROWSER_STREAM = 111

module.exports = {
  CMD_NAVIGATE, CMD_GET_STATUS,
  CMD_LOAD_CATALOG, CMD_LOAD_CATALOG_BEE, CMD_INSTALL_APP, CMD_UNINSTALL_APP,
  CMD_LAUNCH_APP, CMD_LIST_INSTALLED, CMD_CHECK_UPDATES,
  CMD_CREATE_SITE, CMD_UPDATE_SITE, CMD_PUBLISH_SITE,
  CMD_UNPUBLISH_SITE, CMD_LIST_SITES, CMD_DELETE_SITE, CMD_LOAD_TEMPLATE,
  CMD_CLEAR_CACHE, CMD_GET_IDENTITY,
  CMD_GET_RELAYS, CMD_SET_RELAYS, CMD_SET_RELAY_ENABLED,
  CMD_USERDATA_LIST_BOOKMARKS, CMD_USERDATA_ADD_BOOKMARK, CMD_USERDATA_REMOVE_BOOKMARK,
  CMD_USERDATA_LIST_HISTORY, CMD_USERDATA_ADD_HISTORY, CMD_USERDATA_CLEAR_HISTORY,
  CMD_USERDATA_GET_SETTINGS, CMD_USERDATA_SET_SETTINGS,
  CMD_USERDATA_GET_SESSION, CMD_USERDATA_SAVE_SESSION, CMD_USERDATA_IMPORT,
  CMD_IDENTITY_EXPORT_PHRASE, CMD_IDENTITY_IMPORT_PHRASE, CMD_IDENTITY_ROTATE,
  CMD_IDENTITY_VALIDATE_PHRASE, CMD_IDENTITY_SIGN,
  CMD_DEVICE_LINK_CREATE_INVITE, CMD_DEVICE_LINK_JOIN,
  CMD_PROFILE_GET, CMD_PROFILE_UPDATE, CMD_PROFILE_CLEAR,
  CMD_LOGIN_LIST_GRANTS, CMD_LOGIN_REVOKE_GRANT, CMD_LOGIN_REVOKE_ALL, CMD_LOGIN_RESOLVE,
  CMD_CONTACTS_LIST, CMD_CONTACTS_LOOKUP, CMD_CONTACTS_ADD, CMD_CONTACTS_UPDATE, CMD_CONTACTS_REMOVE,
  CMD_PEAR_SESSION,
  CMD_TRUSTED_ORIGINS_LIST, CMD_TRUSTED_ORIGINS_ADD,
  CMD_TRUSTED_ORIGINS_REMOVE, CMD_TRUSTED_ORIGINS_SET_MODE,
  CMD_SWARM_RESOLVE, CMD_SWARM_LIST_GRANTS,
  CMD_SWARM_REVOKE_GRANT, CMD_SWARM_REVOKE_ALL_FOR_APP,
  CMD_BRIDGE,
  CMD_RUN_APP_IN_TAB,
  CMD_ASK_BROWSER_CAPABILITIES, CMD_ASK_BROWSER_START, CMD_ASK_BROWSER_CANCEL,
  CMD_STOP,
  CMD_SHIELD_STATUS, CMD_SHIELD_LOAD_LIST, CMD_SHIELD_REMOVE_LIST,
  CMD_SHIELD_SET_ALLOW, CMD_SHIELD_SET_STRICT,
  CMD_PRIVACY_STATUS,
  CMD_SHIELD_SUBSCRIBE_LIST, CMD_SHIELD_UNSUBSCRIBE_LIST, CMD_SHIELD_REFRESH_LISTS,
  CMD_PLUGIN_LIST, CMD_PLUGIN_SET_ENABLED, CMD_PLUGIN_REGISTER,
  CMD_PLUGIN_INSTALL_DRIVE, CMD_PLUGIN_UPDATE_DRIVE, CMD_PLUGIN_UNINSTALL,
  CMD_PLUGIN_CATALOG, CMD_PLUGIN_CATALOG_LOAD_DRIVE, CMD_PLUGIN_CATALOG_REMOVE_SOURCE,
  CMD_SEARCH, CMD_SEARCH_INDEX,
  CMD_NAME_RESOLVE, CMD_NAME_PETNAME_LIST, CMD_NAME_PETNAME_SET, CMD_NAME_PETNAME_REMOVE,
  CMD_IDENTITY_BINDING_PUBLISH, CMD_IDENTITY_BINDING_RESOLVE, CMD_SEARCH_FEDERATED,
  CMD_NAMEREG_CLAIM, CMD_NAMEREG_ROTATE, CMD_NAMEREG_RELEASE, CMD_NAMEREG_REVOKE,
  CMD_NAMEREG_LIST, CMD_NAMEREG_RESOLVE, CMD_NAMEREG_STATUS,
  EVT_READY, EVT_PEER_COUNT, EVT_ERROR, EVT_INSTALL_PROGRESS, EVT_SITE_PUBLISHED, EVT_BOOT_PROGRESS,
  EVT_LOGIN_REQUEST, EVT_SWARM_REQUEST, EVT_CATALOG_UPDATED,
  EVT_SEARCH_FEDERATED, EVT_IDENTITY_BINDING_PUBLISHED, EVT_ASK_BROWSER_STREAM,
}
