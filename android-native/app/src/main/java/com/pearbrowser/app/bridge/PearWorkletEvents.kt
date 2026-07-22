package com.pearbrowser.app.bridge

/**
 * Cross-process intents between the UI process and the Bare worklet service.
 * The service owns the RPC connection; activities only receive consent
 * requests and send back user decisions.
 */
object PearWorkletEvents {
    const val ACTION_LOGIN_REQUEST = "com.pearbrowser.app.action.LOGIN_REQUEST"
    const val ACTION_SWARM_REQUEST = "com.pearbrowser.app.action.SWARM_REQUEST"
    const val ACTION_CATALOG_UPDATED = "com.pearbrowser.app.action.CATALOG_UPDATED"
    const val ACTION_SEARCH_FEDERATED = "com.pearbrowser.app.action.SEARCH_FEDERATED"
    const val ACTION_RESOLVE_LOGIN = "com.pearbrowser.app.action.RESOLVE_LOGIN"
    const val ACTION_RESOLVE_SWARM = "com.pearbrowser.app.action.RESOLVE_SWARM"

    const val EXTRA_REQUEST_ID = "requestId"
    const val EXTRA_DRIVE_KEY = "driveKey"
    const val EXTRA_APP_NAME = "appName"
    const val EXTRA_REASON = "reason"
    const val EXTRA_SCOPES = "scopes"
    const val EXTRA_TOPIC_HEX = "topicHex"
    const val EXTRA_PROTOCOL = "protocol"
    const val EXTRA_APPROVED = "approved"
    const val EXTRA_CATALOG_KEY = "catalogKey"
    const val EXTRA_CATALOG_JSON = "catalogJson"
    /** Full EVT_SEARCH_FEDERATED payload JSON (queryId-correlated enriched results). */
    const val EXTRA_SEARCH_PAYLOAD = "searchPayload"
}
