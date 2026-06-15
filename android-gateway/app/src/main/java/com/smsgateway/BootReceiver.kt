package com.smsgateway

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.LOCKED_BOOT_COMPLETED") return

        if (!Prefs.isAutoStartOnBoot(context) && !Prefs.isServiceEnabled(context)) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "Skipping boot restart — notification permission not granted")
            return
        }

        Log.d(TAG, "Boot detected — restarting gateway service")
        val serviceIntent = Intent(context, GatewayForegroundService::class.java)
        try {
            ContextCompat.startForegroundService(context, serviceIntent)
        } catch (t: Throwable) {
            Log.e(TAG, "Boot restart failed: ${t.message}", t)
        }
    }
}
