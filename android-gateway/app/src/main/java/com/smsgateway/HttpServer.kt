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

        // Reject unsigned sends: the gateway is an SMS relay on the operator SIM, so anyone who can
        // reach it could otherwise send SMS. When a shared secret is configured the caller must
        // present it (Authorization: Bearer <secret> or X-Gateway-Secret). Blank = dev mode (open).
        val expectedSecret = Prefs.getApiKey(context)
        if (expectedSecret.isNotBlank() && !secretMatches(session, expectedSecret)) {
            Log.w(TAG, "Rejected /send-sms: missing or invalid gateway secret")
            return newFixedLengthResponse(
                Response.Status.UNAUTHORIZED, "application/json",
                JSONObject().put("ok", false).put("error", "Unauthorized").toString()
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

            val subId = Prefs.getPreferredSubId(context)
            val localId = SmsSender.send(context, to, message, requestId, operator)

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
                        status = "QUEUED_TO_CARRIER",
                        localId = localId,
                        subId = subId
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

    // Accept the secret via Authorization: Bearer <secret> or the X-Gateway-Secret header.
    // NanoHTTPD lowercases header names.
    private fun secretMatches(session: IHTTPSession, expected: String): Boolean {
        val headers = session.headers
        val bearer = (headers["authorization"] ?: "")
            .trim()
            .removePrefix("Bearer ")
            .removePrefix("bearer ")
            .trim()
        val presented = (headers["x-gateway-secret"]?.trim()).takeUnless { it.isNullOrBlank() } ?: bearer
        return presented == expected
    }

    private fun jsonError(msg: String): Response {
        val body = JSONObject().apply {
            put("ok", false)
            put("error", msg)
        }.toString()
        return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json", body)
    }
}
