//  PearBrowser — Protocol.swift
//
//  Command / event IDs. Must stay in sync with backend/constants.js,
//  app/lib/constants.ts, and android-native/.../rpc/Protocol.kt.
//
//  See docs/HOLEPUNCH_ALIGNMENT_PLAN.md, Phase 3 ticket 2.

import Foundation

enum Cmd {
    // Browser
    static let NAVIGATE = 1
    static let GET_STATUS = 2

    // App Store / Catalog
    static let LOAD_CATALOG = 10
    static let INSTALL_APP = 11
    static let UNINSTALL_APP = 12
    static let LAUNCH_APP = 13
    static let LIST_INSTALLED = 14
    static let CHECK_UPDATES = 15
    static let LOAD_CATALOG_BEE = 16

    // Site Builder
    static let CREATE_SITE = 20
    static let UPDATE_SITE = 21
    static let PUBLISH_SITE = 22
    static let UNPUBLISH_SITE = 23
    static let LIST_SITES = 24
    static let DELETE_SITE = 25
    static let LOAD_TEMPLATE = 26

    static let CLEAR_CACHE = 30
    static let GET_IDENTITY = 31

    // Relay config (Phase 0 ticket 2)
    static let GET_RELAYS = 40
    static let SET_RELAYS = 41
    static let SET_RELAY_ENABLED = 42

    // User data (Phase 1 ticket 2)
    static let USERDATA_LIST_BOOKMARKS = 50
    static let USERDATA_ADD_BOOKMARK = 51
    static let USERDATA_REMOVE_BOOKMARK = 52
    static let USERDATA_LIST_HISTORY = 53
    static let USERDATA_ADD_HISTORY = 54
    static let USERDATA_CLEAR_HISTORY = 55
    static let USERDATA_GET_SETTINGS = 56
    static let USERDATA_SET_SETTINGS = 57
    static let USERDATA_GET_SESSION = 58
    static let USERDATA_SAVE_SESSION = 59
    static let USERDATA_IMPORT = 60

    // Identity (Phase 1 ticket 3)
    static let IDENTITY_EXPORT_PHRASE = 70
    static let IDENTITY_IMPORT_PHRASE = 71
    static let IDENTITY_ROTATE = 72
    static let IDENTITY_VALIDATE_PHRASE = 73

    // Bridge
    static let BRIDGE = 200

    // System
    static let STOP = 99
}

enum Evt {
    static let READY = 100
    static let PEER_COUNT = 101
    static let ERROR = 102
    static let INSTALL_PROGRESS = 103
    static let SITE_PUBLISHED = 104
    static let BOOT_PROGRESS = 105
}
