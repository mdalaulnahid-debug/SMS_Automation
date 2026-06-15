package com.smsgateway

import android.content.Context
import android.content.SharedPreferences

object Prefs {
    private const val NAME = "gateway_prefs"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun getGatewayId(context: Context): String =
        prefs(context).getString("gateway_id", "GP_PHONE_01") ?: "GP_PHONE_01"

    fun setGatewayId(context: Context, value: String) =
        prefs(context).edit().putString("gateway_id", value).apply()

    fun getBackendUrl(context: Context): String =
        prefs(context).getString("backend_url", "") ?: ""

    fun setBackendUrl(context: Context, value: String) =
        prefs(context).edit().putString("backend_url", value).apply()

    fun getApiKey(context: Context): String =
        prefs(context).getString("api_key", "") ?: ""

    fun setApiKey(context: Context, value: String) =
        prefs(context).edit().putString("api_key", value).apply()

    fun getHttpPort(context: Context): Int =
        prefs(context).getInt("http_port", 8080)

    fun setHttpPort(context: Context, value: Int) =
        prefs(context).edit().putInt("http_port", value).apply()

    fun isServiceEnabled(context: Context): Boolean =
        prefs(context).getBoolean("service_enabled", false)

    fun setServiceEnabled(context: Context, value: Boolean) =
        prefs(context).edit().putBoolean("service_enabled", value).apply()

    fun getTestGroupId(context: Context): String =
        prefs(context).getString("test_group_id", "test-whatsapp-group") ?: "test-whatsapp-group"

    fun setTestGroupId(context: Context, value: String) =
        prefs(context).edit().putString("test_group_id", value).apply()

    fun getTestRequesterId(context: Context): String =
        prefs(context).getString("test_requester_id", "test-requester") ?: "test-requester"

    fun setTestRequesterId(context: Context, value: String) =
        prefs(context).edit().putString("test_requester_id", value).apply()

    fun getTestRequesterName(context: Context): String =
        prefs(context).getString("test_requester_name", "Test User") ?: "Test User"

    fun setTestRequesterName(context: Context, value: String) =
        prefs(context).edit().putString("test_requester_name", value).apply()

    fun getLastTestTarget(context: Context): String =
        prefs(context).getString("last_test_target", "") ?: ""

    fun setLastTestTarget(context: Context, value: String) =
        prefs(context).edit().putString("last_test_target", value).apply()

    // -1 means "use system default SIM for SMS"
    fun getPreferredSubId(context: Context): Int =
        prefs(context).getInt("preferred_sub_id", -1)

    fun setPreferredSubId(context: Context, value: Int) =
        prefs(context).edit().putInt("preferred_sub_id", value).apply()

    // Secondary gateway for dual-SIM phones (empty = not configured).
    fun getSecondaryGatewayId(context: Context): String =
        prefs(context).getString("secondary_gateway_id", "") ?: ""

    fun setSecondaryGatewayId(context: Context, value: String) =
        prefs(context).edit().putString("secondary_gateway_id", value).apply()

    fun getSecondarySubId(context: Context): Int =
        prefs(context).getInt("secondary_sub_id", -1)

    fun setSecondarySubId(context: Context, value: Int) =
        prefs(context).edit().putInt("secondary_sub_id", value).apply()

    // Admin API key — when set, unlocks the admin panel on this device.
    fun getAdminApiKey(context: Context): String =
        prefs(context).getString("admin_api_key", "") ?: ""

    fun setAdminApiKey(context: Context, value: String) =
        prefs(context).edit().putString("admin_api_key", value).apply()

    fun isAdminConfigured(context: Context): Boolean = getAdminApiKey(context).isNotBlank()

    fun isAutoStartOnBoot(context: Context): Boolean =
        prefs(context).getBoolean("auto_start_on_boot", true)

    fun setAutoStartOnBoot(context: Context, value: Boolean) =
        prefs(context).edit().putBoolean("auto_start_on_boot", value).apply()

    /** Returns list of (gatewayId, subId) for every configured gateway on this phone. */
    fun configuredGateways(context: Context): List<Pair<String, Int>> {
        val list = mutableListOf(getGatewayId(context) to getPreferredSubId(context))
        val secondary = getSecondaryGatewayId(context)
        if (secondary.isNotBlank()) list.add(secondary to getSecondarySubId(context))
        return list
    }

    // ── PIN management ───────────────────────────────────────────────────────────

    private fun sha256(text: String): String {
        val bytes = java.security.MessageDigest.getInstance("SHA-256").digest(text.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun hasPinSet(context: Context): Boolean =
        prefs(context).getString("pin_hash", "").orEmpty().isNotBlank()

    fun verifyPin(context: Context, input: String): Boolean {
        val stored = prefs(context).getString("pin_hash", "") ?: return false
        return stored.isNotBlank() && stored == sha256(input)
    }

    fun setPin(context: Context, pin: String) =
        prefs(context).edit().putString("pin_hash", sha256(pin)).apply()

    fun clearPin(context: Context) =
        prefs(context).edit().remove("pin_hash").apply()

    // ── QR provisioning ──────────────────────────────────────────────────────────

    /** True once backendUrl and gatewayId have been configured (via QR or manually). */
    fun isProvisioned(context: Context): Boolean =
        getBackendUrl(context).isNotBlank() && getGatewayId(context).isNotBlank()

    /**
     * Apply all fields from a provisioning QR code in one atomic write.
     * [pin] is hashed before storage; [secret] is stored as the admin API key.
     */
    fun setFromQrPayload(context: Context, url: String, gatewayId: String, pin: String, secret: String = "") {
        prefs(context).edit()
            .putString("backend_url", url.trim())
            .putString("gateway_id", gatewayId.trim())
            .also { ed ->
                if (pin.isNotBlank()) ed.putString("pin_hash", sha256(pin))
                if (secret.isNotBlank()) ed.putString("admin_api_key", secret)
            }
            .apply()
    }
}
