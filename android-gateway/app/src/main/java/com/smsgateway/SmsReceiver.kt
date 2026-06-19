package com.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.smsgateway.db.AppDatabase
import com.smsgateway.db.LogEntry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

class SmsReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "SmsReceiver"
        private const val RETRY_WORK_NAME = "retry_inbound_webhooks"
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

        val incomingSubId = intent.getIntExtra("android.telephony.extra.SUBSCRIPTION_INDEX", -1)
            .takeIf { it >= 0 }
            ?: intent.getIntExtra("subscription", -1)

        CoroutineScope(Dispatchers.IO).launch {
            val db = AppDatabase.get(context)
            val gatewayId = if (incomingSubId >= 0) {
                Prefs.configuredGateways(context)
                    .firstOrNull { (_, subId) -> subId == incomingSubId }
                    ?.first ?: Prefs.getGatewayId(context)
            } else {
                Prefs.getGatewayId(context)
            }

            Log.d(TAG, "Routing inbound SMS (subId=$incomingSubId) to gateway $gatewayId")

            val deliveryKey = buildDeliveryKey(gatewayId, sender, body, receivedAt)
            val ok = WebhookSender.forward(context, gatewayId, sender, body, receivedAt, deliveryKey)

            db.logDao().insert(
                LogEntry(
                    type = if (ok) "FORWARDED" else "RECEIVED",
                    direction = "INBOUND",
                    sender = sender,
                    messageBody = body,
                    operator = gatewayId,
                    gatewayId = gatewayId,
                    status = if (ok) "OK" else "PENDING_RETRY",
                    errorDetail = if (!ok) "Webhook delivery failed - pending retry" else null,
                    receivedAtText = receivedAt,
                    subId = incomingSubId
                )
            )

            if (!ok) {
                val constraints = Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
                val retryRequest = OneTimeWorkRequestBuilder<RetryWorker>()
                    .setConstraints(constraints)
                    .setInitialDelay(30, TimeUnit.SECONDS)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build()
                WorkManager.getInstance(context).enqueueUniqueWork(
                    RETRY_WORK_NAME,
                    ExistingWorkPolicy.KEEP,
                    retryRequest
                )
                Log.w(TAG, "Webhook failed - scheduled retry in 30s")
            }
        }
    }

    private fun buildDeliveryKey(gatewayId: String, sender: String, body: String, receivedAt: String): String {
        val raw = "$gatewayId|$sender|$receivedAt|$body"
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
