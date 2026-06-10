package com.smsgateway

import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

object BackendDiscovery {
    private const val TAG = "BackendDiscovery"
    private const val DEFAULT_PORT = 3000
    private const val SCAN_TIMEOUT_SEC = 15L
    private const val THREADS = 32

    fun discoverBackendUrl(phoneIp: String, lastKnown: String? = null, port: Int = DEFAULT_PORT): String? {
        val trimmedLast = lastKnown?.trim().orEmpty()
        if (trimmedLast.isNotBlank() && BackendClient.checkHealthForDiscovery(trimmedLast)) {
            Log.d(TAG, "Using last known backend: $trimmedLast")
            return trimmedLast
        }

        val prefix = NetworkUtils.subnetPrefix(phoneIp)
        if (prefix.isNullOrBlank()) {
            Log.w(TAG, "Cannot discover backend without phone Wi-Fi IP")
            return null
        }

        val hosts = buildScanOrder(phoneIp)
        Log.d(TAG, "Scanning ${hosts.size} hosts on $prefix.* for backend on port $port")

        val priorityCount = minOf(hosts.size, 60)
        scanHostsParallel(prefix, hosts.take(priorityCount), port)?.let { return it }

        if (hosts.size > priorityCount) {
            return scanHostsParallel(prefix, hosts.drop(priorityCount), port)
        }

        return null
    }

    private fun buildScanOrder(phoneIp: String): List<Int> {
        val lastOctet = phoneIp.split('.').getOrNull(3)?.toIntOrNull()
        val order = linkedSetOf<Int>()

        order.add(1)
        order.add(254)
        for (host in 200..254) order.add(host)
        for (host in 100..199) order.add(host)

        if (lastOctet != null) {
            for (delta in listOf(-1, 1, -2, 2, -5, 5, -10, 10)) {
                val host = lastOctet + delta
                if (host in 2..254) order.add(host)
            }
        }

        for (host in 2..99) order.add(host)
        return order.toList()
    }

    private fun scanHostsParallel(prefix: String, hosts: List<Int>, port: Int): String? {
        if (hosts.isEmpty()) return null

        val found = AtomicReference<String?>(null)
        val executor = Executors.newFixedThreadPool(THREADS)
        val latch = CountDownLatch(hosts.size)

        try {
            for (host in hosts) {
                executor.submit {
                    try {
                        if (found.get() != null) return@submit
                        val candidate = "http://$prefix.$host:$port"
                        if (BackendClient.checkHealthForDiscovery(candidate)) {
                            if (found.compareAndSet(null, candidate)) {
                                Log.d(TAG, "Discovered backend at $candidate")
                            }
                        }
                    } finally {
                        latch.countDown()
                    }
                }
            }
            latch.await(SCAN_TIMEOUT_SEC, TimeUnit.SECONDS)
        } catch (e: Exception) {
            Log.e(TAG, "Discovery failed: ${e.message}", e)
        } finally {
            executor.shutdownNow()
        }

        return found.get()
    }
}
