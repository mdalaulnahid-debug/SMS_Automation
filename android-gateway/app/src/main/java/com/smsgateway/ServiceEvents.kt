package com.smsgateway

import android.content.Context
import android.content.Intent
import androidx.localbroadcastmanager.content.LocalBroadcastManager

object ServiceEvents {
    const val ACTION_STATUS = "com.smsgateway.SERVICE_STATUS"
    const val EXTRA_RUNNING = "running"
    const val EXTRA_ERROR = "error"
    const val EXTRA_NO_INTERNET = "no_internet"
    const val EXTRA_GATEWAY_LIVE = "gateway_live"
    const val EXTRA_GATEWAY_LIVE_DETAIL = "gateway_live_detail"

    fun sendRunning(context: Context) {
        broadcast(context, running = true, error = null)
    }

    fun sendStopped(context: Context) {
        broadcast(context, running = false, error = null)
    }

    fun sendError(context: Context, message: String) {
        broadcast(context, running = false, error = message)
    }

    fun sendNoInternet(context: Context) {
        val intent = Intent(ACTION_STATUS).apply {
            putExtra(EXTRA_RUNNING, true)
            putExtra(EXTRA_NO_INTERNET, true)
        }
        LocalBroadcastManager.getInstance(context.applicationContext).sendBroadcast(intent)
    }

    fun sendInternetRestored(context: Context) {
        val intent = Intent(ACTION_STATUS).apply {
            putExtra(EXTRA_RUNNING, true)
            putExtra(EXTRA_NO_INTERNET, false)
        }
        LocalBroadcastManager.getInstance(context.applicationContext).sendBroadcast(intent)
    }

    fun sendGatewayLive(context: Context, live: Boolean, detail: String) {
        val intent = Intent(ACTION_STATUS).apply {
            putExtra(EXTRA_RUNNING, true)
            putExtra(EXTRA_GATEWAY_LIVE, live)
            putExtra(EXTRA_GATEWAY_LIVE_DETAIL, detail)
        }
        LocalBroadcastManager.getInstance(context.applicationContext).sendBroadcast(intent)
    }

    private fun broadcast(context: Context, running: Boolean, error: String?) {
        val intent = Intent(ACTION_STATUS).apply {
            putExtra(EXTRA_RUNNING, running)
            if (error != null) putExtra(EXTRA_ERROR, error)
        }
        LocalBroadcastManager.getInstance(context.applicationContext).sendBroadcast(intent)
    }
}
