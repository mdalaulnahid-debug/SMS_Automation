package com.smsgateway

import android.content.Context
import android.os.Build
import android.telephony.SmsManager
import android.util.Log

object SmsSender {
    private const val TAG = "SmsSender"

    fun send(context: Context, to: String, message: String): String {
        val smsManager: SmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        }

        val localId = "sms_${System.currentTimeMillis()}"
        Log.d(TAG, "Sending SMS to $to | id=$localId | len=${message.length}")

        if (message.length > 160) {
            val parts = smsManager.divideMessage(message)
            smsManager.sendMultipartTextMessage(to, null, parts, null, null)
        } else {
            smsManager.sendTextMessage(to, null, message, null, null)
        }

        return localId
    }
}
