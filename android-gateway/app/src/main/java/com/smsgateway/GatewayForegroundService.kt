package com.smsgateway



import android.Manifest

import android.app.Notification

import android.app.NotificationChannel

import android.app.NotificationManager

import android.app.PendingIntent

import android.app.Service

import android.content.Intent

import android.content.pm.PackageManager

import android.content.pm.ServiceInfo

import android.os.Build

import android.os.Handler

import android.os.IBinder

import android.os.Looper

import android.util.Log

import androidx.core.app.NotificationCompat

import androidx.core.app.ServiceCompat

import androidx.core.content.ContextCompat

import fi.iki.elonen.NanoHTTPD

import java.io.IOException

import java.util.concurrent.atomic.AtomicBoolean



class GatewayForegroundService : Service() {

    companion object {

        private const val TAG = "GatewayService"

        private const val CHANNEL_ID = "gateway_channel"

        private const val NOTIFICATION_ID = 1

        const val ACTION_STOP = "com.smsgateway.ACTION_STOP"

    }



    private var httpServer: HttpServer? = null

    private val httpRunning = AtomicBoolean(false)

    private val httpStarting = AtomicBoolean(false)

    private var foregroundActive = false

    private val mainHandler = Handler(Looper.getMainLooper())



    override fun onCreate() {

        super.onCreate()

        createNotificationChannel()

    }



    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {

        if (intent?.action == ACTION_STOP) {

            Log.d(TAG, "Stop action received")

            stopGateway(removeForeground = true)

            stopSelf()

            return START_NOT_STICKY

        }



        // Android requires startForeground for EVERY startForegroundService() call within ~5s.
        try {
            promoteToForeground(
                when {
                    httpRunning.get() -> "Listening on :${Prefs.getHttpPort(this)} | ${Prefs.getGatewayId(this)}"
                    httpStarting.get() -> "Starting gateway…"
                    else -> "Starting gateway…"
                }
            )
        } catch (t: Throwable) {
            Log.e(TAG, "Foreground promotion failed", t)
            failStart(t.message ?: "Could not start foreground service", removeForeground = foregroundActive)
            return START_NOT_STICKY
        }

        if (!hasNotificationPermission()) {
            Log.w(TAG, "Notification permission missing")
            failStart("Allow notifications before starting the gateway service.", removeForeground = true)
            return START_NOT_STICKY
        }



        if (httpRunning.get()) {

            Log.d(TAG, "HTTP server already running")

            return START_STICKY

        }



        if (!httpStarting.compareAndSet(false, true)) {

            Log.d(TAG, "HTTP server start already in progress")

            return START_STICKY

        }



        startHttpServerAsync()

        return START_STICKY

    }



    private fun startHttpServerAsync() {

        val port = Prefs.getHttpPort(this)

        Thread({

            try {

                httpServer?.stop()

                httpServer = HttpServer(this, port).also {

                    it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)

                    Log.d(TAG, "HTTP server listening on 0.0.0.0:$port")

                }

                httpRunning.set(true)

                Prefs.setServiceEnabled(this@GatewayForegroundService, true)

                val localIp = NetworkUtils.getLocalIp(this@GatewayForegroundService)
                val gatewayId = Prefs.getGatewayId(this@GatewayForegroundService)
                val backendUrl = Prefs.getBackendUrl(this@GatewayForegroundService)
                if (localIp.isNotBlank() && backendUrl.isNotBlank()) {
                    BackendClient.registerGateway(backendUrl, gatewayId, localIp, port)
                }

                mainHandler.post {

                    updateNotification("Listening on :$port | $gatewayId")

                    ServiceEvents.sendRunning(this@GatewayForegroundService)

                    httpStarting.set(false)

                }

            } catch (e: IOException) {

                Log.e(TAG, "Port $port unavailable", e)

                mainHandler.post {

                    failStart("Port $port is in use. Change HTTP port in Settings.", removeForeground = true)

                }

            } catch (t: Throwable) {

                Log.e(TAG, "Gateway start failed", t)

                mainHandler.post {

                    failStart(t.message ?: "Gateway failed to start", removeForeground = true)

                }

            }

        }, "gateway-http-start").start()

    }



    private fun hasNotificationPermission(): Boolean {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true

        return ContextCompat.checkSelfPermission(

            this,

            Manifest.permission.POST_NOTIFICATIONS

        ) == PackageManager.PERMISSION_GRANTED

    }



    private fun foregroundServiceType(): Int {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {

            ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING

        } else {

            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC

        }

    }



    private fun promoteToForeground(statusText: String) {

        val notification = buildNotification(statusText)

        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, foregroundServiceType())

        foregroundActive = true

    }



    private fun failStart(reason: String, removeForeground: Boolean) {

        Prefs.setServiceEnabled(this, false)

        httpRunning.set(false)

        httpStarting.set(false)

        httpServer?.stop()

        httpServer = null

        ServiceEvents.sendError(this, reason)

        if (removeForeground && foregroundActive) {

            try {

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {

                    stopForeground(STOP_FOREGROUND_REMOVE)

                } else {

                    @Suppress("DEPRECATION")

                    stopForeground(true)

                }

            } catch (t: Throwable) {

                Log.w(TAG, "stopForeground during failStart: ${t.message}")

            }

            foregroundActive = false

        }

        stopSelf()

    }



    private fun stopGateway(removeForeground: Boolean) {

        httpStarting.set(false)

        httpRunning.set(false)

        httpServer?.stop()

        httpServer = null

        Prefs.setServiceEnabled(this, false)

        if (removeForeground && foregroundActive) {

            try {

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {

                    stopForeground(STOP_FOREGROUND_REMOVE)

                } else {

                    @Suppress("DEPRECATION")

                    stopForeground(true)

                }

            } catch (t: Throwable) {

                Log.w(TAG, "stopForeground during stopGateway: ${t.message}")

            }

            foregroundActive = false

        }

        ServiceEvents.sendStopped(this)

    }



    override fun onDestroy() {

        stopGateway(removeForeground = foregroundActive)

        Log.d(TAG, "Service destroyed")

        super.onDestroy()

    }



    override fun onBind(intent: Intent?): IBinder? = null



    private fun createNotificationChannel() {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

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



        return NotificationCompat.Builder(this, CHANNEL_ID)

            .setContentTitle("SMS Gateway Active")

            .setContentText(text)

            .setSmallIcon(R.drawable.ic_notification)

            .setContentIntent(openIntent)

            .setOngoing(true)

            .setOnlyAlertOnce(true)

            .setPriority(NotificationCompat.PRIORITY_LOW)

            .setCategory(NotificationCompat.CATEGORY_SERVICE)

            .build()

    }



    private fun updateNotification(text: String) {

        if (!foregroundActive) return

        getSystemService(NotificationManager::class.java)

            ?.notify(NOTIFICATION_ID, buildNotification(text))

    }

}


