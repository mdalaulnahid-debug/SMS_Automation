package com.smsgateway

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.smsgateway.db.AppDatabase
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class RetryWorker(appContext: Context, workerParams: WorkerParameters) :
    CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "RetryWorker"
    }

    override suspend fun doWork(): Result {
        val db = AppDatabase.get(applicationContext)
        val pending = db.logDao().getPendingRetries()

        if (pending.isEmpty()) return Result.success()

        Log.d(TAG, "Retrying ${pending.size} failed webhooks")
        var allOk = true

        for (entry in pending) {
            val receivedAt = DateTimeFormatter.ISO_OFFSET_DATE_TIME
                .withZone(ZoneId.systemDefault())
                .format(Instant.ofEpochMilli(entry.timestamp))

            val ok = WebhookSender.forward(
                applicationContext,
                Prefs.getGatewayId(applicationContext),
                entry.sender ?: "",
                entry.messageBody,
                receivedAt
            )

            if (ok) {
                db.logDao().updateStatus(entry.id, "OK")
                Log.d(TAG, "Retry succeeded for entry ${entry.id}")
            } else {
                allOk = false
                Log.w(TAG, "Retry still failing for entry ${entry.id}")
            }
        }

        return if (allOk) Result.success() else Result.retry()
    }
}
