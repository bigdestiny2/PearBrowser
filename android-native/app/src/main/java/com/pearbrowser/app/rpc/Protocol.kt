package com.pearbrowser.app.rpc

/**
 * Command / event IDs. Must stay in sync with backend/constants.js and
 * app/lib/constants.ts. This file is the Kotlin mirror of those.
 *
 * See docs/HOLEPUNCH_ALIGNMENT_PLAN.md, Phase 2 ticket 3.
 */
object Cmd {
    // Browser
    const val NAVIGATE = 1
    const val GET_STATUS = 2

    // App Store / Catalog
    const val LOAD_CATALOG = 10
    const val INSTALL_APP = 11
    const val UNINSTALL_APP = 12
    const val LAUNCH_APP = 13
    const val LIST_INSTALLED = 14
    const val CHECK_UPDATES = 15
    const val LOAD_CATALOG_BEE = 16

    // Site Builder
    const val CREATE_SITE = 20
    const val UPDATE_SITE = 21
    const val PUBLISH_SITE = 22
    const val UNPUBLISH_SITE = 23
    const val LIST_SITES = 24
    const val DELETE_SITE = 25
    const val LOAD_TEMPLATE = 26

    const val CLEAR_CACHE = 30
    const val GET_IDENTITY = 31

    // Relay config (Phase 0 ticket 2)
    const val GET_RELAYS = 40
    const val SET_RELAYS = 41
    const val SET_RELAY_ENABLED = 42

    // User data (Phase 1 ticket 2)
    const val USERDATA_LIST_BOOKMARKS = 50
    const val USERDATA_ADD_BOOKMARK = 51
    const val USERDATA_REMOVE_BOOKMARK = 52
    const val USERDATA_LIST_HISTORY = 53
    const val USERDATA_ADD_HISTORY = 54
    const val USERDATA_CLEAR_HISTORY = 55
    const val USERDATA_GET_SETTINGS = 56
    const val USERDATA_SET_SETTINGS = 57
    const val USERDATA_GET_SESSION = 58
    const val USERDATA_SAVE_SESSION = 59
    const val USERDATA_IMPORT = 60

    // Identity (Phase 1 ticket 3 + identity plan)
    const val IDENTITY_EXPORT_PHRASE = 70
    const val IDENTITY_IMPORT_PHRASE = 71
    const val IDENTITY_ROTATE = 72
    const val IDENTITY_VALIDATE_PHRASE = 73
    const val IDENTITY_SIGN = 74
    const val DEVICE_LINK_CREATE_INVITE = 76
    const val DEVICE_LINK_JOIN = 77

    // Profile + login grants (Identity Plan Phases B + C + F)
    const val PROFILE_GET = 80
    const val PROFILE_UPDATE = 81
    const val PROFILE_CLEAR = 82
    const val LOGIN_LIST_GRANTS = 83
    const val LOGIN_REVOKE_GRANT = 84
    const val LOGIN_REVOKE_ALL = 85
    const val LOGIN_RESOLVE = 86

    // Contacts (Identity Plan Phase D)
    const val CONTACTS_LIST = 90
    const val CONTACTS_LOOKUP = 91
    const val CONTACTS_ADD = 92
    const val CONTACTS_UPDATE = 93
    const val CONTACTS_REMOVE = 94

    // Per-origin session tokens for HTTPS apps (Phase E follow-up)
    const val PEAR_SESSION = 95

    // Trusted-origins allow-list (HTTPS parity privacy mode)
    const val TRUSTED_ORIGINS_LIST = 96
    const val TRUSTED_ORIGINS_ADD = 97
    const val TRUSTED_ORIGINS_REMOVE = 98
    const val TRUSTED_ORIGINS_SET_MODE = 110

    // Direct page-scoped Hyperswarm access (`window.pear.swarm.v1`)
    const val SWARM_RESOLVE = 120
    const val SWARM_LIST_GRANTS = 121
    const val SWARM_REVOKE_GRANT = 122
    const val SWARM_REVOKE_ALL_FOR_APP = 123

    // Bridge
    const val BRIDGE = 200

    // TabRuntime + QVAC / Ask Browser (Mission B4b, mirrors
    // backend/constants.js; same ids as pearbrowser-desktop so shells stay
    // aligned). RUN_APP_IN_TAB runs the in-proc demo tab; pear:// worker tabs
    // and the Ask Browser LLM runtime are gated on Android (no pear-run, and
    // the llamacpp addon is not linked) and fail closed with typed errors.
    const val RUN_APP_IN_TAB = 201
    const val ASK_BROWSER_CAPABILITIES = 220
    const val ASK_BROWSER_START = 221
    const val ASK_BROWSER_CANCEL = 222

    // System
    const val STOP = 99

    // Content Shield (mirrors backend/constants.js; same ids as
    // pearbrowser-desktop so shells stay aligned).
    const val SHIELD_STATUS = 230
    const val SHIELD_LOAD_LIST = 231
    const val SHIELD_REMOVE_LIST = 232
    const val SHIELD_SET_ALLOW = 233
    const val SHIELD_SET_STRICT = 234
    // Pear Plugins (Mission B4a — drive-installed extensions; same ids as
    // the desktop). PLUGIN_REGISTER stays backend-only (fixture path).
    const val PLUGIN_LIST = 235
    const val PLUGIN_SET_ENABLED = 236
    const val PLUGIN_REGISTER = 237
    const val PLUGIN_INSTALL_DRIVE = 242
    const val PLUGIN_UPDATE_DRIVE = 243
    const val PLUGIN_UNINSTALL = 244
    const val PLUGIN_CATALOG = 245
    const val PLUGIN_CATALOG_LOAD_DRIVE = 246
    const val PLUGIN_CATALOG_REMOVE_SOURCE = 247
    // Shield + privacy-ladder + clearnet session-bridge status (Mission B2).
    // The desktop has no dedicated direct/proxied toggle command — the
    // `clearnetMode` settings key via USERDATA_SET_SETTINGS is the toggle.
    const val PRIVACY_STATUS = 238
    const val SHIELD_SUBSCRIBE_LIST = 239
    const val SHIELD_UNSUBSCRIBE_LIST = 240
    const val SHIELD_REFRESH_LISTS = 241

    // Lighthouse local-first P2P search (Mission B3, ported from
    // pearbrowser-desktop — same numeric ids so shells stay aligned).
    const val SEARCH = 177
    const val SEARCH_INDEX = 178
    const val IDENTITY_BINDING_PUBLISH = 260
    const val IDENTITY_BINDING_RESOLVE = 261
    const val SEARCH_FEDERATED = 262

    // Names — petnames + the N5 multi-writer name registry (Mission B3).
    const val NAME_RESOLVE = 250
    const val NAME_PETNAME_LIST = 251
    const val NAME_PETNAME_SET = 252
    const val NAME_PETNAME_REMOVE = 253
    const val NAMEREG_CLAIM = 264
    const val NAMEREG_ROTATE = 265
    const val NAMEREG_RELEASE = 266
    const val NAMEREG_REVOKE = 267
    const val NAMEREG_LIST = 268
    const val NAMEREG_RESOLVE = 269
    const val NAMEREG_STATUS = 270
}

object Evt {
    const val READY = 100
    const val PEER_COUNT = 101
    const val ERROR = 102
    const val INSTALL_PROGRESS = 103
    const val SITE_PUBLISHED = 104
    const val BOOT_PROGRESS = 105
    /** A page called window.pear.login() — show the consent sheet. */
    const val LOGIN_REQUEST = 106
    /** A page called window.pear.swarm.v1.join() for an arbitrary topic. */
    const val SWARM_REQUEST = 107
    /** A signed P2P catalog bee updated and re-verified successfully. */
    const val CATALOG_UPDATED = 108
    /** Federated (trusted-peer) search enrichment for an earlier SEARCH.
     *  Mobile deviation: the desktop uses 108 here, but 108 has been
     *  CATALOG_UPDATED on mobile since the signed-catalog-bee work shipped
     *  (app/lib/constants.ts) — mobile assigns 112/113. */
    const val SEARCH_FEDERATED = 112
    /** Our IdentityBinding was published/refreshed. */
    const val IDENTITY_BINDING_PUBLISHED = 113
    /** Ask Browser streaming events { streamId, requestId, event } (Mission B4b —
     *  same numeric id as the desktop; 111 is unassigned on mobile). */
    const val ASK_BROWSER_STREAM = 111
}
