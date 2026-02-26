package com.emergance.app.network

import android.content.Context
import com.emergance.protocol.Envelope

class WifiDirectTransportAdapter(private val context: Context) : TransportAdapter {
    override val kind: String = "WIFI_DIRECT"

    override suspend fun start(deviceId: String, role: String, handler: EnvelopeHandler) {
        // Placeholder: transport contract is wired for phased Wi-Fi Direct implementation.
    }

    override suspend fun send(envelope: Envelope, targetDeviceId: String?): Boolean {
        return false
    }

    override fun peers(): List<PeerDescriptor> = emptyList()

    fun stop() {
        // no-op in placeholder implementation
    }
}
