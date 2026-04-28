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

    // Bridge
    const val BRIDGE = 200

    // System
    const val STOP = 99
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
}
