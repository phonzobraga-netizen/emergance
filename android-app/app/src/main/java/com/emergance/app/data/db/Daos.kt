package com.emergance.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface IncidentDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: IncidentEntity)

    @Query("SELECT * FROM incidents ORDER BY createdAtMs DESC")
    fun observeAll(): Flow<List<IncidentEntity>>

    @Query("UPDATE incidents SET status = :status, assignedDriverId = :assignedDriverId WHERE id = :incidentId")
    suspend fun updateStatus(incidentId: String, status: String, assignedDriverId: String?)
}

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: MessageOutboxEntity)

    @Query("SELECT * FROM message_outbox WHERE ackedAtMs IS NULL AND expiresAtMs > :nowMs AND nextAttemptAtMs <= :nowMs ORDER BY nextAttemptAtMs ASC LIMIT :limit")
    suspend fun due(nowMs: Long, limit: Int = 100): List<MessageOutboxEntity>

    @Query("UPDATE message_outbox SET attempts = attempts + 1, nextAttemptAtMs = :nextAttemptAtMs WHERE messageId = :messageId")
    suspend fun markAttempt(messageId: String, nextAttemptAtMs: Long)

    @Query("UPDATE message_outbox SET ackedAtMs = :ackTs WHERE messageId = :messageId")
    suspend fun markAcked(messageId: String, ackTs: Long)

    @Query("DELETE FROM message_outbox WHERE ackedAtMs IS NULL AND expiresAtMs <= :nowMs")
    suspend fun pruneExpired(nowMs: Long)
}

@Dao
interface InboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: MessageInboxEntity)

    @Query("SELECT messageId FROM message_inbox WHERE messageId = :messageId LIMIT 1")
    suspend fun find(messageId: String): String?
}

@Dao
interface PeerDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: PeerEntity)

    @Query("SELECT * FROM peers ORDER BY lastSeenMs DESC")
    fun observePeers(): Flow<List<PeerEntity>>

    @Query("SELECT * FROM peers WHERE deviceId = :deviceId LIMIT 1")
    suspend fun get(deviceId: String): PeerEntity?
}

@Dao
interface DriverStateDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: DriverStateEntity)

    @Query("SELECT * FROM driver_state ORDER BY lastFixAtMs DESC")
    fun observeAll(): Flow<List<DriverStateEntity>>
}