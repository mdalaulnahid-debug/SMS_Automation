package com.smsgateway

/**
 * Tracks outgoing SMS dispatched by the backend job queue.
 * Any SMS to a number NOT recorded here within the 5-minute window is unauthorized.
 */
object DispatchTracker {
    private val dispatches = mutableMapOf<String, Long>()
    private const val WINDOW_MS = 5 * 60 * 1000L

    @Synchronized
    fun record(recipient: String) {
        dispatches[normalize(recipient)] = System.currentTimeMillis() + WINDOW_MS
        pruneExpired()
    }

    @Synchronized
    fun isAuthorized(recipient: String): Boolean {
        val expiry = dispatches[normalize(recipient)] ?: return false
        return System.currentTimeMillis() < expiry
    }

    private fun pruneExpired() {
        val now = System.currentTimeMillis()
        dispatches.entries.removeAll { it.value < now }
    }

    private fun normalize(number: String) =
        number.replace(Regex("[^0-9+]"), "").trimStart('+')
}
