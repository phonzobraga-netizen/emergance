package com.emergance.app.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "incidents")
data class IncidentEntity(
    @PrimaryKey val id: String,
    val createdAtMs: Long,
    val lat: Double,
    val lng: Double,
    val accuracyM: Float,
    val locationQuality: String,
    val status: String,
    val assignedDriverId: String?,
    val lastError: String?
)

@Entity(tableName = "message_outbox")
data class MessageOutboxEntity(
    @PrimaryKey val messageId: String,
    val incidentId: String,
    val type: String,
    val payloadBlob: ByteArray,
    val targetDeviceId: String?,
    val attempts: Int,
    val nextAttemptAtMs: Long,
    val expiresAtMs: Long,
    val ackedAtMs: Long?
)

@Entity(tableName = "message_inbox")
data class MessageInboxEntity(
    @PrimaryKey val messageId: String,
    val receivedAtMs: Long,
    val processedAtMs: Long,
    val validSignature: Boolean,
    val replayDropped: Boolean
)

@Entity(tableName = "peers")
data class PeerEntity(
    @PrimaryKey val deviceId: String,
    val role: String,
    val host: String,
    val port: Int,
    val bestTransport: String,
    val lastSeenMs: Long,
    val rssi: Int,
    val relayScore: Int
)

@Entity(tableName = "driver_state")
data class DriverStateEntity(
    @PrimaryKey val deviceId: String,
    val onDuty: Boolean,
    val available: Boolean,
    val lastLat: Double,
    val lastLng: Double,
    val lastFixAtMs: Long,
    val batteryPct: Int
)