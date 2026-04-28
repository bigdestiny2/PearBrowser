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

// Pear Bridge (WebView → worklet via RN relay)
const CMD_BRIDGE = 200

// System
const CMD_STOP = 99

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
  CMD_PROFILE_GET, CMD_PROFILE_UPDATE, CMD_PROFILE_CLEAR,
  CMD_LOGIN_LIST_GRANTS, CMD_LOGIN_REVOKE_GRANT, CMD_LOGIN_REVOKE_ALL, CMD_LOGIN_RESOLVE,
  CMD_CONTACTS_LIST, CMD_CONTACTS_LOOKUP, CMD_CONTACTS_ADD, CMD_CONTACTS_UPDATE, CMD_CONTACTS_REMOVE,
  CMD_PEAR_SESSION,
  CMD_TRUSTED_ORIGINS_LIST, CMD_TRUSTED_ORIGINS_ADD,
  CMD_TRUSTED_ORIGINS_REMOVE, CMD_TRUSTED_ORIGINS_SET_MODE,
  CMD_BRIDGE,
  CMD_STOP,
  EVT_READY, EVT_PEER_COUNT, EVT_ERROR, EVT_INSTALL_PROGRESS, EVT_SITE_PUBLISHED, EVT_BOOT_PROGRESS,
  EVT_LOGIN_REQUEST,
}
