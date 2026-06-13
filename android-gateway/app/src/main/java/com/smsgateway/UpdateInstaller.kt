package com.smsgateway

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

object UpdateInstaller {
    private const val TAG = "UpdateInstaller"

    /**
     * Download the APK from the backend and launch the system installer.
     * Runs in the calling thread — call from a background thread.
     */
    fun downloadAndInstall(context: Context) {
        val backendUrl = Prefs.getBackendUrl(context)
        val secret = Prefs.getApiKey(context)
        if (backendUrl.isBlank()) {
            Log.w(TAG, "No backend URL configured")
            return
        }

        UpdateChecker.showDownloadProgress(context, 0)

        val apkFile = File(context.getExternalFilesDir(null), "gateway-update.apk")
        val ok = BackendClient.downloadApk(backendUrl, secret, apkFile)

        UpdateChecker.cancelDownloadNotification(context)

        if (!ok || !apkFile.exists() || apkFile.length() == 0L) {
            Log.e(TAG, "APK download failed")
            return
        }

        Log.i(TAG, "APK downloaded (${apkFile.length() / 1024} KB) — launching installer")
        launchInstaller(context, apkFile)
    }

    private fun launchInstaller(context: Context, apkFile: File) {
        // Android 8+: check permission to install unknown apps
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.packageManager.canRequestPackageInstalls()) {
                Log.w(TAG, "REQUEST_INSTALL_PACKAGES not granted — directing to settings")
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
                return
            }
        }

        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
