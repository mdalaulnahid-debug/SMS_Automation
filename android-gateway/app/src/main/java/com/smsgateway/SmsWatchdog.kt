package com.smsgateway

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Watches content://sms/sent for any outgoing SMS not dispatched by the backend job queue.
 * Reports unauthorized sends to the backend audit log so the admin dashboard can alert on them.
 */
class SmsWatchdog(
    private val context: Context,
    private val gatewayId: String,
    private val backendUrl: String,
    private val gatewaySecret: String
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
            val id    = c.getLong(c.getColumnIndexOrThrow("_id"))
            if (id == lastSeenId) return  // already handled
            lastSeenId = id

            val address = c.getString(c.getColumnIndexOrThrow("address")) ?: return
            val body    = c.getString(c.getColumnIndexOrThrow("body")).orEmpty()

            if (DispatchTracker.isAuthorized(address)) {
                Log.d(TAG, "Authorized send to $address confirmed")
                return
            }

            Log.w(TAG, "⚠️ Unauthorized SMS send detected → $address")
            CoroutineScope(Dispatchers.IO).launch {
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
