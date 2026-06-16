package com.smsgateway

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Watches content://sms/sent for any outgoing SMS not dispatched by the backend job queue.
 * Reports unauthorized sends to the backend audit log so the admin dashboard can alert on them.
 *
 * Requires READ_SMS permission — silently no-ops if it is absent.
 * Uses the caller-supplied [scope] so coroutines are cancelled when the service stops.
 */
class SmsWatchdog(
    private val context: Context,
    private val gatewayId: String,
    private val backendUrl: String,
    private val gatewaySecret: String,
    private val scope: CoroutineScope
) : ContentObserver(Handler(Looper.getMainLooper())) {

    companion object {
        private const val TAG = "SmsWatchdog"
        private val SENT_URI = Uri.parse("content://sms/sent")
    }

    private var lastSeenId: Long = -1L

    override fun onChange(selfChange: Boolean) {
        checkLatestSentSms()
    }

    private fun checkLatestSentSms() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "READ_SMS not granted — watchdog disabled")
            return
        }

        val windowStart = System.currentTimeMillis() - 15_000L
        val cursor = context.contentResolver.query(
            SENT_URI,
            arrayOf("_id", "address", "body", "date"),
            "date > ?",
            arrayOf(windowStart.toString()),
            "date DESC"
        ) ?: return

        cursor.use { c ->
            if (!c.moveToFirst()) return
            val id = c.getLong(c.getColumnIndexOrThrow("_id"))
            if (id == lastSeenId) return
            lastSeenId = id

            val address = c.getString(c.getColumnIndexOrThrow("address")) ?: return
            val body    = c.getString(c.getColumnIndexOrThrow("body")).orEmpty()

            if (DispatchTracker.isAuthorized(address)) {
                Log.d(TAG, "Authorized send to $address confirmed")
                return
            }

            Log.w(TAG, "⚠️ Unauthorized SMS send detected → $address")
            scope.launch {
                BackendClient.reportUnauthorizedSend(
                    backendUrl  = backendUrl,
                    gatewayId   = gatewayId,
                    secret      = gatewaySecret,
                    recipient   = address,
                    snippet     = body.take(80)
                )
            }
        }
    }
}
