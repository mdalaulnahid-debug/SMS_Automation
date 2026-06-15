package com.smsgateway

import android.app.Application
import android.content.Context
import androidx.appcompat.app.AppCompatDelegate

class GatewayApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        applyTheme(this)
    }

    companion object {
        fun applyTheme(context: Context) {
            val mode = when (Prefs.getThemeMode(context)) {
                "dark"  -> AppCompatDelegate.MODE_NIGHT_YES
                "light" -> AppCompatDelegate.MODE_NIGHT_NO
                else    -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
            }
            AppCompatDelegate.setDefaultNightMode(mode)
        }
    }
}
