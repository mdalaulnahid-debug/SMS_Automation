package com.smsgateway

import android.content.Context
import android.net.wifi.WifiManager
import android.text.format.Formatter

object NetworkUtils {
    @Suppress("DEPRECATION")
    fun getLocalIp(context: Context): String {
        val wifiManager = context.applicationContext.getSystemService(WifiManager::class.java)
        val ip = wifiManager?.connectionInfo?.ipAddress ?: 0
        return if (ip == 0) "" else Formatter.formatIpAddress(ip)
    }

    fun subnetPrefix(ip: String): String? {
        val parts = ip.split('.')
        if (parts.size != 4) return null
        return "${parts[0]}.${parts[1]}.${parts[2]}"
    }
}
