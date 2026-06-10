package com.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.LOCKED_BOOT_COMPLETED") return

        if (Prefs.isServiceEnabled(context)) {
            Log.d(TAG, "Boot detected — restarting gateway service")
            val serviceIntent = Intent(context, GatewayForegroundService::class.java)
            ContextCompat.startForegroundService(context, serviceIntent)
        }
    }
}
