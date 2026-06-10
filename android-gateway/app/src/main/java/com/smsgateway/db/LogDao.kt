package com.smsgateway.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface LogDao {
    @Insert
    suspend fun insert(entry: LogEntry): Long

    @Query("SELECT * FROM log_entries ORDER BY timestamp DESC LIMIT 100")
    fun getRecent(): Flow<List<LogEntry>>

    @Query("SELECT * FROM log_entries WHERE status = 'PENDING_RETRY' ORDER BY timestamp ASC")
    suspend fun getPendingRetries(): List<LogEntry>

    @Query("UPDATE log_entries SET status = :status, errorDetail = :detail WHERE id = :id")
    suspend fun updateStatus(id: Long, status: String, detail: String? = null)

    @Query("SELECT * FROM log_entries WHERE direction = 'OUTBOUND' ORDER BY timestamp DESC LIMIT 1")
    suspend fun getLastSent(): LogEntry?

    @Query("SELECT * FROM log_entries WHERE direction = 'INBOUND' ORDER BY timestamp DESC LIMIT 1")
    suspend fun getLastReceived(): LogEntry?

    @Query("SELECT COUNT(*) FROM log_entries WHERE status = 'PENDING_RETRY'")
    suspend fun countPendingRetries(): Int

    @Query("DELETE FROM log_entries WHERE id NOT IN (SELECT id FROM log_entries ORDER BY timestamp DESC LIMIT 500)")
    suspend fun pruneOld()
}
