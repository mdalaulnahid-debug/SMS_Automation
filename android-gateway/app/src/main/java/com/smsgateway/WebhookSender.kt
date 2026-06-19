package com.smsgateway

import android.content.Context
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object WebhookSender {
    private const val TAG = "WebhookSender"

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

    fun forward(
        context: Context,
        gatewayId: String,
        from: String,
        body: String,
        receivedAt: String,
        deliveryKey: String? = null
    ): Boolean {
        val backendUrl = Prefs.getBackendUrl(context).trimEnd('/')
        val apiKey = Prefs.getApiKey(context)

        val payload = JSONObject().apply {
            put("gatewayId", gatewayId)
            put("from", from)
            put("body", body)
            put("receivedAt", receivedAt)
            if (!deliveryKey.isNullOrBlank()) put("deliveryKey", deliveryKey)
        }.toString()

        val requestBuilder = Request.Builder()
            .url("$backendUrl/api/sms/inbound")
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))

        if (apiKey.isNotBlank()) {
            requestBuilder.addHeader("Authorization", "Bearer $apiKey")
        }

        return try {
            val response = client.newCall(requestBuilder.build()).execute()
            response.use { r ->
                val ok = r.code in 200..299
                Log.d(TAG, "Webhook → $backendUrl/api/sms/inbound: HTTP ${r.code}")
                ok
            }
        } catch (e: Exception) {
            Log.e(TAG, "Webhook failed: ${e.message}")
            false
        }
    }
}
