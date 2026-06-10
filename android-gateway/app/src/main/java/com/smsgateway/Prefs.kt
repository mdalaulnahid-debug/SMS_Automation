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
}
