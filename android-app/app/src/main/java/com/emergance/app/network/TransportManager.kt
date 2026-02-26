package com.emergance.app.network

import com.emergance.protocol.Envelope

class TransportManager(
    private val lan: LanTransportAdapter,
    private val wifiDirect: WifiDirectTransportAdapter,
    private val ble: BleTransportAdapter
) {
    private var started = false

    suspend fun start(deviceId: String, role: String, handler: EnvelopeHandler) {
        if (started) return
        started = true

        lan.start(deviceId, role, handler)
        wifiDirect.start(deviceId, role, handler)
        ble.start(deviceId, role, handler)
    }

    suspend fun send(envelope: Envelope, targetDeviceId: String? = null): Boolean {
        if (lan.send(envelope, targetDeviceId)) return true
        if (wifiDirect.send(envelope, targetDeviceId)) return true
        return ble.send(envelope, targetDeviceId)
    }

    fun peers(): List<PeerDescriptor> {
        return buildList {
            addAll(lan.peers())
            addAll(wifiDirect.peers())
            addAll(ble.peers())
        }
    }

    fun updateRole(role: String) {
        lan.updateRole(role)
        wifiDirect.updateRole(role)
        ble.updateRole(role)
    }

    fun stop() {
        lan.stop()
        wifiDirect.stop()
        ble.stop()
    }
}
