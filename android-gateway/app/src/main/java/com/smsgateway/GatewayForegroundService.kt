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

import android.net.ConnectivityManager

import android.net.Network

import android.net.NetworkCapabilities

import android.net.NetworkRequest

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

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel



class GatewayForegroundService : Service() {

    companion object {

        private const val TAG = "GatewayService"

        private const val CHANNEL_ID = "gateway_channel"

        private const val NOTIFICATION_ID = 1

        const val ACTION_STOP = "com.smsgateway.ACTION_STOP"
        const val ACTION_DOWNLOAD_UPDATE = "com.smsgateway.ACTION_DOWNLOAD_UPDATE"

        // Current live status, readable without needing to catch the broadcast — the service
        // only broadcasts on CHANGE, so a UI that resumes after the state already settled would
        // otherwise be stuck showing its default text until the next real transition.
        @Volatile var lastKnownGatewayLive: Boolean = false
        @Volatile var lastKnownGatewayLiveDetail: String = "Awaiting backend confirmation"

    }



    private var httpServer: HttpServer? = null

    private val httpRunning = AtomicBoolean(false)

    private val httpStarting = AtomicBoolean(false)

    private var foregroundActive = false

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var pollActive = false
    private var pollThread: Thread? = null
    @Volatile private var lastGatewayHeartbeatMs = 0L
    @Volatile private var lastGatewayLive = false
    @Volatile private var lastGatewayLiveDetail = "Awaiting backend confirmation"

    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var hasInternet = true
    private var smsWatchdog: SmsWatchdog? = null

    // Supervised scope for watchdog coroutines — cancelled when gateway stops.
    private var watchdogScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Poll-thread self-healing: last timestamp updated inside the loop body.
    @Volatile private var lastPollAtMs = 0L
    private val pollWatchdogRunnable = object : Runnable {
        override fun run() {
            if (pollActive) {
                val lag = System.currentTimeMillis() - lastPollAtMs
                if (lastPollAtMs > 0 && lag > 30_000) {
                    Log.w(TAG, "Poll thread appears dead (${lag}ms since last tick) — restarting")
                    restartPollLoop("watchdog lag ${lag}ms")
                }
                mainHandler.postDelayed(this, 15_000)
            }
        }
    }



    override fun onCreate() {

        super.onCreate()

        createNotificationChannel()

        UpdateChecker.createNotificationChannel(this)

    }



    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {

        if (intent?.action == ACTION_STOP) {

            Log.d(TAG, "Stop action received")

            stopGateway(removeForeground = true)

            stopSelf()

            return START_NOT_STICKY

        }

        if (intent?.action == ACTION_DOWNLOAD_UPDATE) {

            Thread({ UpdateInstaller.downloadAndInstall(this) }, "apk-download").start()

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
                val backendUrl = Prefs.getBackendUrl(this@GatewayForegroundService)
                val gatewaySecret = Prefs.getApiKey(this@GatewayForegroundService)
                if (localIp.isNotBlank() && backendUrl.isNotBlank()) {
                    val sm = getSystemService(android.telephony.SubscriptionManager::class.java)
                    var registeredCount = 0
                    var totalCount = 0
                    for ((gwId, subId) in Prefs.configuredGateways(this@GatewayForegroundService)) {
                        totalCount += 1
                        val phoneNumber = readSimPhoneNumber(sm, subId)
                        if (BackendClient.registerGateway(backendUrl, gwId, localIp, port, gatewaySecret, phoneNumber)) {
                            registeredCount += 1
                        }
                    }
                    if (totalCount > 0) {
                        publishGatewayLiveStatus(
                            registeredCount > 0,
                            if (registeredCount > 0) {
                                "Gateway live • registered ${registeredCount}/${totalCount} route(s)"
                            } else {
                                "Backend reachable • gateway registration not confirmed"
                            }
                        )
                    }
                }

                startPollLoop()

                registerNetworkMonitor()
                registerSmsWatchdog()

                UpdateChecker.checkInBackground(this@GatewayForegroundService)

                mainHandler.post {

                    updateNotification("Listening on :$port | ${Prefs.getGatewayId(this@GatewayForegroundService)}")

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



    private fun startPollLoop() {
        if (pollActive) return
        pollActive = true
        lastPollAtMs = System.currentTimeMillis()
        pollThread = Thread({
            Log.d(TAG, "Poll loop started")
            while (pollActive) {
                lastPollAtMs = System.currentTimeMillis()
                try {
                    val backendUrl = Prefs.getBackendUrl(this)
                    val secret = Prefs.getApiKey(this)
                    if (backendUrl.isNotBlank()) {
                        val configuredGateways = Prefs.configuredGateways(this)
                        for ((gwId, subId) in configuredGateways) {
                            val jobs = BackendClient.fetchAndClaimJobs(backendUrl, gwId, secret)
                            for (job in jobs) {
                                try {
                                    SmsSender.send(this, job.to, job.message, job.requestId, job.operator, subId)
                                    BackendClient.ackJob(backendUrl, gwId, job.outboxId, ok = true, gatewaySecret = secret)
                                    Log.d(TAG, "Poll[$gwId]: sent ${job.outboxId} to ${job.to}")
                                } catch (e: Exception) {
                                    Log.e(TAG, "Poll[$gwId]: send failed for ${job.outboxId}: ${e.message}")
                                    BackendClient.ackJob(backendUrl, gwId, job.outboxId, ok = false, error = e.message, gatewaySecret = secret)
                                }
                            }
                        }
                        val now = System.currentTimeMillis()
                        if (configuredGateways.isNotEmpty() && now - lastGatewayHeartbeatMs >= 30_000) {
                            var confirmedRoutes = 0
                            for ((gwId, _) in configuredGateways) {
                                if (BackendClient.heartbeatGateway(backendUrl, gwId, secret)) {
                                    confirmedRoutes += 1
                                }
                            }
                            lastGatewayHeartbeatMs = now
                            publishGatewayLiveStatus(
                                confirmedRoutes > 0,
                                if (confirmedRoutes > 0) {
                                    "Gateway live • backend confirmed ${confirmedRoutes}/${configuredGateways.size} route(s)"
                                } else {
                                    "Backend reachable • awaiting authenticated gateway confirmation"
                                }
                            )
                        }
                    } else {
                        publishGatewayLiveStatus(false, "Gateway not live • backend URL missing")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Poll loop error: ${e.message}")
                    publishGatewayLiveStatus(false, "Backend reachable check failed • poll loop error")
                }
                try { Thread.sleep(3_000) } catch (_: InterruptedException) { break }
            }
            Log.d(TAG, "Poll loop stopped")
        }, "gateway-poll").also { it.isDaemon = true }
        pollThread?.start()
        // Start poll-thread watchdog — checks every 15s that the thread is still making progress.
        mainHandler.postDelayed(pollWatchdogRunnable, 15_000)
    }

    private fun restartPollLoop(reason: String) {
        Log.w(TAG, "Restarting poll loop: $reason")
        pollActive = false
        pollThread?.interrupt()
        pollThread = null
        lastPollAtMs = System.currentTimeMillis()
        startPollLoop()
    }

    private fun registerNetworkMonitor() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (!hasInternet) {
                    hasInternet = true
                    mainHandler.post {
                        updateNotification("Polling backend | ${Prefs.getGatewayId(this@GatewayForegroundService)}")
                        ServiceEvents.sendInternetRestored(this@GatewayForegroundService)
                    }
                }
            }
            override fun onLost(network: Network) {
                hasInternet = false
                mainHandler.post {
                    updateNotification("No internet — polling paused")
                    ServiceEvents.sendNoInternet(this@GatewayForegroundService)
                }
            }
        }
        cm.registerNetworkCallback(request, cb)
        networkCallback = cb
    }

    private fun registerSmsWatchdog() {
        val backendUrl = Prefs.getBackendUrl(this)
        val gatewayId  = Prefs.getGatewayId(this)
        val secret     = Prefs.getApiKey(this)
        if (backendUrl.isBlank() || gatewayId.isBlank()) return
        // Fresh scope each time so it can be cancelled cleanly on stop.
        watchdogScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val watchdog = SmsWatchdog(this, gatewayId, backendUrl, secret, watchdogScope)
        contentResolver.registerContentObserver(
            android.net.Uri.parse("content://sms/sent"), true, watchdog
        )
        smsWatchdog = watchdog
        Log.d(TAG, "SMS watchdog registered")
    }

    private fun stopGateway(removeForeground: Boolean) {

        pollActive = false
        mainHandler.removeCallbacks(pollWatchdogRunnable)
        pollThread?.interrupt()
        pollThread = null

        watchdogScope.cancel()
        smsWatchdog?.let {
            try { contentResolver.unregisterContentObserver(it) } catch (_: Exception) {}
        }
        smsWatchdog = null

        networkCallback?.let {
            try { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) }
            catch (_: Exception) {}
        }
        networkCallback = null

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
        publishGatewayLiveStatus(false, "Gateway not live • service stopped")

    }

    private fun publishGatewayLiveStatus(live: Boolean, detail: String) {
        lastKnownGatewayLive = live
        lastKnownGatewayLiveDetail = detail
        if (lastGatewayLive == live && lastGatewayLiveDetail == detail) return
        lastGatewayLive = live
        lastGatewayLiveDetail = detail
        ServiceEvents.sendGatewayLive(this, live, detail)
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

    private fun readSimPhoneNumber(sm: android.telephony.SubscriptionManager?, subId: Int): String {
        if (sm == null || subId < 0) return ""
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_NUMBERS)
                    == PackageManager.PERMISSION_GRANTED) {
                    sm.getPhoneNumber(subId).orEmpty()
                } else ""
            } else {
                @Suppress("DEPRECATION")
                sm.activeSubscriptionInfoList
                    ?.find { it.subscriptionId == subId }
                    ?.number
                    .orEmpty()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not read phone number for subId=$subId: ${e.message}")
            ""
        }
    }

}


