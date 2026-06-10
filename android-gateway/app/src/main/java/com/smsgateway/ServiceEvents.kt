package com.smsgateway

import android.content.Context
import android.content.Intent
import androidx.localbroadcastmanager.content.LocalBroadcastManager

object ServiceEvents {
    const val ACTION_STATUS = "com.smsgateway.SERVICE_STATUS"
    const val EXTRA_RUNNING = "running"
    const val EXTRA_ERROR = "error"

    fun sendRunning(context: Context) {
        broadcast(context, running = true, error = null)
    }

    fun sendStopped(context: Context) {
        broadcast(context, running = false, error = null)
    }

    fun sendError(context: Context, message: String) {
        broadcast(context, running = false, error = message)
    }

    private fun broadcast(context: Context, running: Boolean, error: String?) {
        val intent = Intent(ACTION_STATUS).apply {
            putExtra(EXTRA_RUNNING, running)
            if (error != null) putExtra(EXTRA_ERROR, error)
        }
        LocalBroadcastManager.getInstance(context.applicationContext).sendBroadcast(intent)
    }
}
