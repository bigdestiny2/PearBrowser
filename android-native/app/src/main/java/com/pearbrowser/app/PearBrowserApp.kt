package com.pearbrowser.app

import android.app.Application
import android.util.Log

/**
 * Application singleton. Kept deliberately minimal — the worklet lives
 * inside [com.pearbrowser.app.bridge.PearWorkletService] which is started
 * from [MainActivity] after permissions have been sorted out.
 */
class PearBrowserApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "PearBrowser starting (${BuildConfig.VERSION_NAME} / code ${BuildConfig.VERSION_CODE})")
    }

    companion object {
        const val TAG = "PearBrowser"
    }
}
