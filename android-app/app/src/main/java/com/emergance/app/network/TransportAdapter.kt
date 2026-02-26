package com.emergance.app.network

import com.emergance.protocol.Envelope

data class PeerDescriptor(
    val deviceId: String,
    val role: String,
    val host: String,
    val port: Int,
    val transport: String,
    val lastSeenMs: Long
)

typealias EnvelopeHandler = suspend (envelope: Envelope, via: String, host: String) -> Unit

interface TransportAdapter {
    val kind: String
    suspend fun start(deviceId: String, role: String, handler: EnvelopeHandler)
    suspend fun send(envelope: Envelope, targetDeviceId: String? = null): Boolean
    fun peers(): List<PeerDescriptor>
    fun updateRole(role: String) {}
}
