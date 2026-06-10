package com.smsgateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import fi.iki.elonen.NanoHTTPD as NanoHTTPDLib

class GatewayForegroundService : Service() {
    companion object {
        private const val TAG = "GatewayService"
        private const val CHANNEL_ID = "gateway_channel"
        private const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "com.smsgateway.ACTION_STOP"
    }

    private var httpServer: HttpServer? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Log.d(TAG, "Stop action received")
            stopSelf()
            return START_NOT_STICKY
        }
        startGateway()
        return START_STICKY
    }

    private fun startGateway() {
        val port = Prefs.getHttpPort(this)
        startForeground(NOTIFICATION_ID, buildNotification("Starting on port $port…"))

        httpServer?.stop()
        httpServer = HttpServer(this, port).also {
            it.start(NanoHTTPDLib.SOCKET_READ_TIMEOUT, false)
            Log.d(TAG, "HTTP server listening on port $port")
        }

        Prefs.setServiceEnabled(this, true)
        updateNotification("Listening on :$port | ${Prefs.getGatewayId(this)}")
    }

    override fun onDestroy() {
        httpServer?.stop()
        httpServer = null
        Prefs.setServiceEnabled(this, false)
        Log.d(TAG, "Service destroyed")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "SMS Gateway Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps the SMS gateway running in the background"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = PendingIntent.getService(
            this, 1,
            Intent(this, GatewayForegroundService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SMS Gateway Active")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(openIntent)
            .addAction(android.R.drawable.ic_delete, "Stop", stopIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }
}

