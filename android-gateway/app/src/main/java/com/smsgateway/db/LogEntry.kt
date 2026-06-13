package com.smsgateway.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "log_entries")
data class LogEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** SENT | RECEIVED | FORWARDED | ERROR | RETRY */
    val type: String,
    /** OUTBOUND | INBOUND */
    val direction: String,
    val recipient: String? = null,
    val sender: String? = null,
    val messageBody: String,
    val requestId: String? = null,
    val operator: String? = null,
    /** OK | QUEUED_TO_CARRIER | DELIVERED | FAILED | PENDING_RETRY */
    val status: String,
    val errorDetail: String? = null,
    val timestamp: Long = System.currentTimeMillis(),
    /** Provider message ID returned by SmsSender (links delivery callbacks to this row) */
    val localId: String? = null,
    /** SubscriptionManager subId of the SIM used to send; -1 = system default */
    val subId: Int = -1
)
