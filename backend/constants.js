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

module.exports = {
  CMD_NAVIGATE, CMD_GET_STATUS,
  CMD_LOAD_CATALOG, CMD_INSTALL_APP, CMD_UNINSTALL_APP,
  CMD_LAUNCH_APP, CMD_LIST_INSTALLED, CMD_CHECK_UPDATES,
  CMD_CREATE_SITE, CMD_UPDATE_SITE, CMD_PUBLISH_SITE,
  CMD_UNPUBLISH_SITE, CMD_LIST_SITES, CMD_DELETE_SITE, CMD_LOAD_TEMPLATE,
  CMD_CLEAR_CACHE,
  CMD_BRIDGE,
  CMD_STOP,
  EVT_READY, EVT_PEER_COUNT, EVT_ERROR, EVT_INSTALL_PROGRESS, EVT_SITE_PUBLISHED, EVT_BOOT_PROGRESS
}
