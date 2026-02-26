package com.emergance.app.network

import android.content.Context
import com.emergance.protocol.Envelope

class BleTransportAdapter(private val context: Context) : TransportAdapter {
    override val kind: String = "BLE"

    override suspend fun start(deviceId: String, role: String, handler: EnvelopeHandler) {
        // Placeholder: BLE path reserved for short-frame relay and ACK resilience.
    }

    override suspend fun send(envelope: Envelope, targetDeviceId: String?): Boolean {
        return false
    }

    override fun peers(): List<PeerDescriptor> = emptyList()

    fun stop() {
        // no-op in placeholder implementation
    }
}
