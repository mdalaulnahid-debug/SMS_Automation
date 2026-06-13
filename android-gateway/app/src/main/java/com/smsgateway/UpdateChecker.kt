package com.smsgateway

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

object UpdateChecker {
    private const val TAG = "UpdateChecker"
    const val CHANNEL_ID = "gateway_updates"
    private const val NOTIF_UPDATE_AVAILABLE = 100
    private const val NOTIF_DOWNLOADING = 101

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "App Updates",
            NotificationManager.IMPORTANCE_HIGH
        ).apply { description = "Notifies when a new version of the gateway app is available" }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun currentVersionCode(context: Context): Long {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0).versionCode.toLong()
            }
        } catch (_: PackageManager.NameNotFoundException) { 0L }
    }

    private fun currentVersionName(context: Context): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
        } catch (_: PackageManager.NameNotFoundException) { "?" }
    }

    /** Call once per service start (runs in background thread). */
    fun checkInBackground(context: Context) {
        Thread({
            val backendUrl = Prefs.getBackendUrl(context)
            if (backendUrl.isBlank()) return@Thread
            try {
                val remote = BackendClient.fetchAppVersion(backendUrl) ?: return@Thread
                if (remote.versionCode <= currentVersionCode(context)) return@Thread
                Log.i(TAG, "Update available: ${remote.versionName} (current ${currentVersionName(context)})")
                showUpdateNotification(context, remote)
            } catch (e: Exception) {
                Log.w(TAG, "Update check failed: ${e.message}")
            }
        }, "update-check").start()
    }

    private fun showUpdateNotification(context: Context, version: BackendClient.AppVersion) {
        val downloadIntent = Intent(context, GatewayForegroundService::class.java).apply {
            action = GatewayForegroundService.ACTION_DOWNLOAD_UPDATE
        }
        val pi = PendingIntent.getService(
            context, 0, downloadIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Gateway update available")
            .setContentText("v${version.versionName} — ${version.releaseNotes}")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java)
            .notify(NOTIF_UPDATE_AVAILABLE, notif)
    }

    fun showDownloadProgress(context: Context, percent: Int) {
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Downloading update…")
            .setContentText("$percent%")
            .setSmallIcon(R.drawable.ic_notification)
            .setProgress(100, percent, percent == 0)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        context.getSystemService(NotificationManager::class.java)
            .notify(NOTIF_DOWNLOADING, notif)
    }

    fun cancelDownloadNotification(context: Context) {
        context.getSystemService(NotificationManager::class.java)
            .cancel(NOTIF_DOWNLOADING)
    }
}
