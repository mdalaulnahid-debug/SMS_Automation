package com.smsgateway

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.util.Log

object SmsSender {
    private const val TAG = "SmsSender"

    const val ACTION_SMS_SENT = "com.smsgateway.SMS_SENT"
    const val ACTION_SMS_DELIVERED = "com.smsgateway.SMS_DELIVERED"
    const val EXTRA_LOCAL_ID = "localId"
    const val EXTRA_REQUEST_ID = "requestId"
    const val EXTRA_OPERATOR = "operator"

    fun send(
        context: Context,
        to: String,
        message: String,
        requestId: String = "",
        operator: String = "",
        subId: Int = -1
    ): String {
        val subId = subId.takeIf { it != -1 } ?: Prefs.getPreferredSubId(context)
        val smsManager: SmsManager = resolveSmsManager(context, subId)

        val localId = "sms_${System.currentTimeMillis()}"
        Log.d(TAG, "Sending SMS to=$to subId=$subId requestId=$requestId id=$localId len=${message.length}")

        val sentPi = makePendingIntent(context, ACTION_SMS_SENT, localId, requestId, operator)
        val deliveredPi = makePendingIntent(context, ACTION_SMS_DELIVERED, localId, requestId, operator)

        if (message.length > 160) {
            val parts = smsManager.divideMessage(message)
            val sentList = ArrayList<PendingIntent>(parts.size).apply { repeat(parts.size) { add(sentPi) } }
            val deliveredList = ArrayList<PendingIntent>(parts.size).apply { repeat(parts.size) { add(deliveredPi) } }
            smsManager.sendMultipartTextMessage(to, null, parts, sentList, deliveredList)
        } else {
            smsManager.sendTextMessage(to, null, message, sentPi, deliveredPi)
        }

        return localId
    }

    private fun resolveSmsManager(context: Context, subId: Int): SmsManager {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (subId != -1) {
                return context.getSystemService(SmsManager::class.java)
                    .createForSubscriptionId(subId)
            }
            return context.getSystemService(SmsManager::class.java)
        }
        @Suppress("DEPRECATION")
        return if (subId != -1) SmsManager.getSmsManagerForSubscriptionId(subId)
        else SmsManager.getDefault()
    }

    private fun makePendingIntent(
        context: Context,
        action: String,
        localId: String,
        requestId: String,
        operator: String
    ): PendingIntent {
        val intent = Intent(action).apply {
            setPackage(context.packageName)
            putExtra(EXTRA_LOCAL_ID, localId)
            putExtra(EXTRA_REQUEST_ID, requestId)
            putExtra(EXTRA_OPERATOR, operator)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, localId.hashCode(), intent, flags)
    }

    /** Returns list of (subscriptionId, displayName, simSlotIndex) for all active SIMs. */
    fun listSims(context: Context): List<Triple<Int, String, Int>> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP_MR1) return emptyList()
        val sm = context.getSystemService(SubscriptionManager::class.java) ?: return emptyList()
        return try {
            sm.activeSubscriptionInfoList?.map { info ->
                Triple(info.subscriptionId, info.displayName?.toString() ?: "SIM ${info.simSlotIndex + 1}", info.simSlotIndex)
            } ?: emptyList()
        } catch (e: SecurityException) {
            Log.w(TAG, "READ_PHONE_STATE denied — cannot list SIMs: ${e.message}")
            emptyList()
        }
    }
}
