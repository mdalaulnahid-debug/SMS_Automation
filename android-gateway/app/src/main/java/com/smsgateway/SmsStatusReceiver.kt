package com.smsgateway

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.util.Log
import com.smsgateway.db.AppDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Receives SMS sent/delivered callbacks fired by SmsSender's PendingIntents.
 * Updates Room DB status and reports to backend.
 */
class SmsStatusReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "SmsStatusReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val localId = intent.getStringExtra(SmsSender.EXTRA_LOCAL_ID) ?: return
        val requestId = intent.getStringExtra(SmsSender.EXTRA_REQUEST_ID) ?: ""
        val operator = intent.getStringExtra(SmsSender.EXTRA_OPERATOR) ?: ""

        val (dbStatus, event) = when (action) {
            SmsSender.ACTION_SMS_SENT -> resolvedSentStatus(resultCode)
            SmsSender.ACTION_SMS_DELIVERED -> "DELIVERED" to "DELIVERED"
            else -> return
        }

        Log.d(TAG, "$event localId=$localId requestId=$requestId resultCode=$resultCode")

        val backendUrl = Prefs.getBackendUrl(context)
        val gatewayId = Prefs.getGatewayId(context)
        val gatewaySecret = Prefs.getApiKey(context)

        CoroutineScope(Dispatchers.IO).launch {
            // Update Room DB
            AppDatabase.get(context).logDao().updateStatusByLocalId(localId, dbStatus)

            // Report to backend (fire-and-forget — no retry needed for delivery status)
            BackendClient.postDeliveryStatus(
                backendUrl = backendUrl,
                gatewayId = gatewayId,
                localId = localId,
                requestId = requestId,
                operator = operator,
                event = event,
                resultCode = resultCode,
                gatewaySecret = gatewaySecret
            )
        }
    }

    private fun resolvedSentStatus(code: Int): Pair<String, String> {
        return when (code) {
            Activity.RESULT_OK -> "SENT" to "SENT"
            SmsManager.RESULT_ERROR_RADIO_OFF -> "FAILED" to "FAILED"
            SmsManager.RESULT_ERROR_NO_SERVICE -> "FAILED" to "FAILED"
            SmsManager.RESULT_ERROR_NULL_PDU -> "FAILED" to "FAILED"
            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "FAILED" to "FAILED"
            else -> "FAILED" to "FAILED"
        }
    }
}
