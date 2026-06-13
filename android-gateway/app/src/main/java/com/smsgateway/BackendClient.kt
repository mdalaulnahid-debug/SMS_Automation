package com.smsgateway

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object BackendClient {
    private const val TAG = "BackendClient"

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .build()

    private val discoveryClient = OkHttpClient.Builder()
        .connectTimeout(1, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .writeTimeout(2, TimeUnit.SECONDS)
        .build()

    private val JSON = "application/json; charset=utf-8".toMediaType()

    fun checkHealth(backendUrl: String): Boolean {
        return checkHealthInternal(backendUrl, client, logFailures = true)
    }

    fun checkHealthForDiscovery(backendUrl: String): Boolean {
        return checkHealthInternal(backendUrl, discoveryClient, logFailures = false)
    }

    private fun checkHealthInternal(
        backendUrl: String,
        httpClient: OkHttpClient,
        logFailures: Boolean
    ): Boolean {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank()) return false
        return try {
            val response = httpClient.newCall(
                Request.Builder().url("$base/api/health").get().build()
            ).execute()
            response.use { r ->
                if (!r.isSuccessful) return false
                val body = r.body?.string().orEmpty()
                val json = JSONObject(body)
                json.optBoolean("ok") &&
                    json.optString("service") == "sms-whatsapp-automation"
            }
        } catch (e: Exception) {
            if (logFailures) {
                Log.w(TAG, "Health check failed for $base: ${e.message}")
            }
            false
        }
    }

    fun registerGateway(
        backendUrl: String,
        gatewayId: String,
        localIp: String,
        port: Int,
        gatewaySecret: String = ""
    ): Boolean {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank() || localIp.isBlank()) return false

        val payload = JSONObject().apply {
            put("gatewayId", gatewayId)
            put("host", localIp)
            put("localIp", localIp)
            put("port", port)
        }.toString()

        return try {
            val builder = Request.Builder()
                .url("$base/api/gateways/register")
                .post(payload.toRequestBody(JSON))
            if (gatewaySecret.isNotBlank()) {
                builder.header("x-gateway-secret", gatewaySecret)
            }
            val response = client.newCall(builder.build()).execute()
            response.use { r ->
                if (!r.isSuccessful) {
                    Log.w(TAG, "Gateway register failed: HTTP ${r.code}")
                    return false
                }
                Log.d(TAG, "Registered $gatewayId at http://$localIp:$port")
                true
            }
        } catch (e: Exception) {
            Log.w(TAG, "Gateway register failed: ${e.message}")
            false
        }
    }

    fun submitTestRequest(
        backendUrl: String,
        requestText: String,
        testDestination: String,
        whatsappGroupId: String,
        requesterWhatsappId: String,
        requesterName: String
    ): Result<String> {
        val base = backendUrl.trimEnd('/')
        val payload = JSONObject().apply {
            put("text", requestText)
            put("testDestination", PhoneUtils.normalize(testDestination))
            put("whatsappGroupId", whatsappGroupId)
            put("requesterWhatsappId", requesterWhatsappId)
            put("requesterName", requesterName)
        }.toString()

        return try {
            val response = client.newCall(
                Request.Builder()
                    .url("$base/api/requests")
                    .post(payload.toRequestBody(JSON))
                    .build()
            ).execute()

            response.use { r ->
                val body = r.body?.string().orEmpty()
                if (!r.isSuccessful) {
                    val message = parseError(body) ?: "Backend rejected request (HTTP ${r.code})"
                    return Result.failure(Exception(message))
                }
                val json = JSONObject(body)
                val requestId = json.optJSONObject("request")?.optString("requestId").orEmpty()
                if (requestId.isBlank()) {
                    return Result.failure(Exception("Backend accepted request but no requestId returned"))
                }
                Result.success(requestId)
            }
        } catch (e: Exception) {
            Log.e(TAG, "submitTestRequest failed: ${e.message}")
            Result.failure(e)
        }
    }

    fun postDeliveryStatus(
        backendUrl: String,
        gatewayId: String,
        localId: String,
        requestId: String,
        operator: String,
        event: String,       // "SENT" | "DELIVERED" | "FAILED"
        resultCode: Int,
        gatewaySecret: String = ""
    ) {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank()) return
        val payload = JSONObject().apply {
            put("gatewayId", gatewayId)
            put("localId", localId)
            put("requestId", requestId)
            put("operator", operator)
            put("event", event)
            put("resultCode", resultCode)
        }.toString()
        try {
            val builder = Request.Builder()
                .url("$base/api/sms/delivery")
                .post(payload.toRequestBody(JSON))
            if (gatewaySecret.isNotBlank()) builder.header("x-gateway-secret", gatewaySecret)
            client.newCall(builder.build()).execute().use { r ->
                Log.d(TAG, "Delivery status $event/$localId → HTTP ${r.code}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "postDeliveryStatus failed: ${e.message}")
        }
    }

    data class AppVersion(val versionCode: Int, val versionName: String, val releaseNotes: String)

    fun fetchAppVersion(backendUrl: String): AppVersion? {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank()) return null
        return try {
            client.newCall(Request.Builder().url("$base/api/app/version").get().build()).execute().use { r ->
                if (!r.isSuccessful) return null
                val json = JSONObject(r.body?.string().orEmpty())
                AppVersion(
                    versionCode = json.optInt("versionCode", 0),
                    versionName = json.optString("versionName"),
                    releaseNotes = json.optString("releaseNotes")
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "fetchAppVersion failed: ${e.message}")
            null
        }
    }

    fun downloadApk(backendUrl: String, gatewaySecret: String, dest: java.io.File): Boolean {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank()) return false
        return try {
            val builder = Request.Builder().url("$base/api/app/apk").get()
            if (gatewaySecret.isNotBlank()) builder.header("x-gateway-secret", gatewaySecret)
            client.newCall(builder.build()).execute().use { r ->
                if (!r.isSuccessful) return false
                val body = r.body ?: return false
                dest.outputStream().use { out -> body.byteStream().copyTo(out) }
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "downloadApk failed: ${e.message}")
            false
        }
    }

    data class PendingJob(
        val outboxId: String,
        val to: String,
        val message: String,
        val requestId: String,
        val operator: String
    )

    fun fetchAndClaimJobs(
        backendUrl: String,
        gatewayId: String,
        gatewaySecret: String = ""
    ): List<PendingJob> {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank()) return emptyList()
        return try {
            val builder = Request.Builder()
                .url("$base/api/gateway/jobs?gatewayId=${gatewayId}")
                .get()
            if (gatewaySecret.isNotBlank()) builder.header("x-gateway-secret", gatewaySecret)
            client.newCall(builder.build()).execute().use { r ->
                if (!r.isSuccessful) return emptyList()
                val json = JSONObject(r.body?.string().orEmpty())
                val arr = json.optJSONArray("jobs") ?: return emptyList()
                (0 until arr.length()).map { i ->
                    val j = arr.getJSONObject(i)
                    PendingJob(
                        outboxId = j.getString("outboxId"),
                        to = j.getString("to"),
                        message = j.getString("message"),
                        requestId = j.optString("requestId"),
                        operator = j.optString("operator")
                    )
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "fetchAndClaimJobs failed: ${e.message}")
            emptyList()
        }
    }

    fun ackJob(
        backendUrl: String,
        gatewayId: String,
        outboxId: String,
        ok: Boolean,
        error: String? = null,
        gatewaySecret: String = ""
    ) {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank()) return
        val payload = JSONObject().apply {
            put("gatewayId", gatewayId)
            put("ok", ok)
            if (error != null) put("error", error)
        }.toString()
        try {
            val builder = Request.Builder()
                .url("$base/api/gateway/jobs/$outboxId/ack")
                .post(payload.toRequestBody(JSON))
            if (gatewaySecret.isNotBlank()) builder.header("x-gateway-secret", gatewaySecret)
            client.newCall(builder.build()).execute().use { r ->
                Log.d(TAG, "Ack $outboxId ok=$ok → HTTP ${r.code}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "ackJob failed: ${e.message}")
        }
    }

    data class GatewayStatus(
        val id: String,
        val operator: String,
        val operatorName: String,
        val online: Boolean,
        val lastSeenAt: String
    )

    fun fetchGatewayHealth(backendUrl: String, adminKey: String): List<GatewayStatus> {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank()) return emptyList()
        return try {
            val req = Request.Builder().url("$base/api/gateways").get()
                .header("x-api-key", adminKey).build()
            client.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return emptyList()
                val arr = JSONObject(r.body?.string().orEmpty()).optJSONArray("gateways") ?: return emptyList()
                (0 until arr.length()).map { i ->
                    val g = arr.getJSONObject(i)
                    GatewayStatus(
                        id = g.optString("id"),
                        operator = g.optString("operator"),
                        operatorName = g.optString("operatorName"),
                        online = g.optBoolean("online"),
                        lastSeenAt = g.optString("lastSeenAt")
                    )
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "fetchGatewayHealth failed: ${e.message}")
            emptyList()
        }
    }

    fun publishApk(
        backendUrl: String,
        adminKey: String,
        apkBytes: ByteArray,
        versionCode: Int,
        versionName: String,
        releaseNotes: String
    ): Result<String> {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isBlank()) return Result.failure(Exception("No backend URL"))
        return try {
            val body = apkBytes.toRequestBody("application/vnd.android.package-archive".toMediaType())
            val req = Request.Builder()
                .url("$base/api/app/publish-apk")
                .post(body)
                .header("x-api-key", adminKey)
                .header("x-version-code", versionCode.toString())
                .header("x-version-name", versionName)
                .header("x-release-notes", releaseNotes)
                .build()
            client.newCall(req).execute().use { r ->
                val rbody = r.body?.string().orEmpty()
                if (!r.isSuccessful) {
                    return Result.failure(Exception(parseError(rbody) ?: "HTTP ${r.code}"))
                }
                Result.success("v$versionName published — all phones will be notified.")
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun parseError(body: String): String? {
        if (body.isBlank()) return null
        return try {
            val json = JSONObject(body)
            val errors = json.optJSONArray("errors")
            if (errors != null && errors.length() > 0) {
                (0 until errors.length()).joinToString("; ") { errors.getString(it) }
            } else {
                json.optString("replyText").ifBlank { json.optString("error") }.ifBlank { null }
            }
        } catch (_: Exception) {
            body.take(200)
        }
    }
}
