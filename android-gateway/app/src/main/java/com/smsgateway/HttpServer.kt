package com.smsgateway

import android.content.Context
import android.util.Log
import com.smsgateway.db.AppDatabase
import com.smsgateway.db.LogEntry
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

class HttpServer(private val context: Context, port: Int) : NanoHTTPD("0.0.0.0", port) {
    companion object {
        private const val TAG = "HttpServer"
    }

    override fun serve(session: IHTTPSession): Response {
        if (session.method != Method.POST || session.uri != "/send-sms") {
            return newFixedLengthResponse(
                Response.Status.NOT_FOUND, MIME_PLAINTEXT,
                "Only POST /send-sms is supported"
            )
        }

        return try {
            val files = HashMap<String, String>()
            session.parseBody(files)
            val rawBody = files["postData"] ?: ""

            val json = JSONObject(rawBody)
            val to = json.optString("to", "").trim()
            val message = json.optString("message", "").trim()
            val requestId = json.optString("requestId", "")
            val operator = json.optString("operator", "")

            if (to.isBlank() || message.isBlank()) {
                return jsonError("Missing required fields: to, message")
            }

            Log.d(TAG, "send-sms → to=$to operator=$operator requestId=$requestId msg=${message.take(40)}")

            val localId = SmsSender.send(context, to, message)

            CoroutineScope(Dispatchers.IO).launch {
                val db = AppDatabase.get(context)
                db.logDao().insert(
                    LogEntry(
                        type = "SENT",
                        direction = "OUTBOUND",
                        recipient = to,
                        messageBody = message,
                        requestId = requestId.ifBlank { null },
                        operator = operator.ifBlank { null },
                        status = "OK"
                    )
                )
                db.logDao().pruneOld()
            }

            val resp = JSONObject().apply {
                put("ok", true)
                put("providerMessageId", localId)
            }
            newFixedLengthResponse(Response.Status.OK, "application/json", resp.toString())

        } catch (e: Exception) {
            Log.e(TAG, "Error in /send-sms: ${e.message}", e)
            jsonError(e.message ?: "Internal error")
        }
    }

    private fun jsonError(msg: String): Response {
        val body = JSONObject().apply {
            put("ok", false)
            put("error", msg)
        }.toString()
        return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json", body)
    }
}
