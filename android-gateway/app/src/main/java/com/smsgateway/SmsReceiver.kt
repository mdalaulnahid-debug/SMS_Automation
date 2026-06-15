package com.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.smsgateway.db.AppDatabase
import com.smsgateway.db.LogEntry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

class SmsReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "SmsReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        val sender = messages[0].displayOriginatingAddress ?: return
        val body = messages.joinToString("") { it.messageBody }
        val receivedAt = DateTimeFormatter.ISO_OFFSET_DATE_TIME
            .withZone(ZoneId.systemDefault())
            .format(Instant.now())

        Log.d(TAG, "SMS from $sender: ${body.take(50)}")

        // Determine which SIM received this SMS so we use the right gatewayId.
        val incomingSubId = intent.getIntExtra("android.telephony.extra.SUBSCRIPTION_INDEX", -1)
            .takeIf { it >= 0 }
            ?: intent.getIntExtra("subscription", -1)

        CoroutineScope(Dispatchers.IO).launch {
            val db = AppDatabase.get(context)

            // Match subId to configured gateway; fall back to primary.
            val gatewayId = if (incomingSubId >= 0) {
                Prefs.configuredGateways(context)
                    .firstOrNull { (_, subId) -> subId == incomingSubId }
                    ?.first ?: Prefs.getGatewayId(context)
            } else {
                Prefs.getGatewayId(context)
            }

            Log.d(TAG, "Routing inbound SMS (subId=$incomingSubId) to gateway $gatewayId")

            val ok = WebhookSender.forward(context, gatewayId, sender, body, receivedAt)

            db.logDao().insert(
                LogEntry(
                    type = if (ok) "FORWARDED" else "RECEIVED",
                    direction = "INBOUND",
                    sender = sender,
                    messageBody = body.take(500),
                    operator = gatewayId,
                    status = if (ok) "OK" else "PENDING_RETRY",
                    errorDetail = if (!ok) "Webhook delivery failed — pending retry" else null,
                    subId = incomingSubId
                )
            )

            if (!ok) {
                val retryRequest = OneTimeWorkRequestBuilder<RetryWorker>()
                    .setInitialDelay(30, TimeUnit.SECONDS)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build()
                WorkManager.getInstance(context).enqueue(retryRequest)
                Log.w(TAG, "Webhook failed — scheduled retry in 30s")
            }
        }
    }
}
