package com.emergance.app.network

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import com.emergance.protocol.Envelope

class LanTransportAdapter(
    private val context: Context,
    private val preferredTcpPort: Int = 37021
) : TransportAdapter {
    override val kind: String = "LAN"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val peers = ConcurrentHashMap<String, PeerDescriptor>()

    private var localDeviceId: String = ""
    private var localRole: String = "SOS"
    private var localTcpPort: Int = preferredTcpPort
    private var handler: EnvelopeHandler? = null
    private var serverSocket: ServerSocket? = null
    private var multicastSocket: MulticastSocket? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    override suspend fun start(deviceId: String, role: String, handler: EnvelopeHandler) {
        this.localDeviceId = deviceId
        this.localRole = role
        this.handler = handler

        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        multicastLock = wifiManager.createMulticastLock("emergance-multicast").apply {
            setReferenceCounted(false)
            acquire()
        }

        serverSocket = runCatching { ServerSocket(preferredTcpPort) }.getOrNull()
            ?: runCatching { ServerSocket(0) }.getOrNull()
        localTcpPort = serverSocket?.localPort ?: preferredTcpPort

        scope.launch { acceptLoop() }
        scope.launch { discoveryListenLoop() }
        scope.launch { discoveryAnnounceLoop() }
    }

    private suspend fun acceptLoop() {
        val server = serverSocket ?: return
        while (scope.isActive) {
            val socket = runCatching { server.accept() }.getOrNull() ?: continue
            scope.launch { handleIncomingSocket(socket) }
        }
    }

    private suspend fun handleIncomingSocket(socket: Socket) {
        socket.use { active ->
            val host = active.inetAddress?.hostAddress ?: "0.0.0.0"
            val input = DataInputStream(active.getInputStream())
            while (scope.isActive) {
                val size = runCatching { input.readInt() }.getOrNull() ?: break
                if (size <= 0 || size > 4_000_000) {
                    break
                }
                val data = ByteArray(size)
                input.readFully(data)
                val envelope = runCatching { Envelope.parseFrom(data) }.getOrNull() ?: continue
                peers[envelope.senderDeviceId] = PeerDescriptor(
                    deviceId = envelope.senderDeviceId,
                    role = envelope.senderRole.name,
                    host = host,
                    port = peers[envelope.senderDeviceId]?.port ?: 37021,
                    transport = kind,
                    lastSeenMs = System.currentTimeMillis()
                )
                handler?.invoke(envelope, kind, host)
            }
        }
    }

    private suspend fun discoveryListenLoop() {
        multicastSocket = MulticastSocket(37020).apply {
            reuseAddress = true
            joinGroup(InetAddress.getByName("239.10.10.10"))
        }

        val socket = multicastSocket ?: return
        val buffer = ByteArray(1024)
        while (scope.isActive) {
            val packet = java.net.DatagramPacket(buffer, buffer.size)
            val received = runCatching { socket.receive(packet) }.isSuccess
            if (!received) {
                continue
            }
            val jsonString = String(packet.data, 0, packet.length)
            val parsed = runCatching { JSONObject(jsonString) }.getOrNull() ?: continue
            val deviceId = parsed.optString("deviceId", "")
            if (deviceId.isBlank() || deviceId == localDeviceId) {
                continue
            }
            val peer = PeerDescriptor(
                deviceId = deviceId,
                role = parsed.optString("role", "RELAY"),
                host = packet.address?.hostAddress ?: "0.0.0.0",
                port = parsed.optInt("tcpPort", 37021),
                transport = kind,
                lastSeenMs = parsed.optLong("sentAtMs", System.currentTimeMillis())
            )
            peers[peer.deviceId] = peer
        }
    }

    private suspend fun discoveryAnnounceLoop() {
        val socket = MulticastSocket().apply {
            timeToLive = 2
            reuseAddress = true
        }

        while (scope.isActive) {
            val payload = JSONObject()
                .put("deviceId", localDeviceId)
                .put("role", localRole)
                .put("tcpPort", localTcpPort)
                .put("sentAtMs", System.currentTimeMillis())
                .toString()
                .toByteArray()

            val multicastPacket = java.net.DatagramPacket(
                payload,
                payload.size,
                InetAddress.getByName("239.10.10.10"),
                37020
            )
            runCatching { socket.send(multicastPacket) }
            val broadcastPacket = java.net.DatagramPacket(
                payload,
                payload.size,
                InetAddress.getByName("255.255.255.255"),
                37020
            )
            runCatching { socket.send(broadcastPacket) }
            delay(2_000)
        }
    }

    override suspend fun send(envelope: Envelope, targetDeviceId: String?): Boolean {
        val destinations = if (targetDeviceId == null) {
            peers.values.toList()
        } else {
            listOfNotNull(peers[targetDeviceId])
        }

        if (destinations.isEmpty()) {
            return false
        }

        val payload = envelope.toByteArray()
        var sent = false

        for (peer in destinations) {
            val success = runCatching {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(peer.host, peer.port), 700)
                    val output = DataOutputStream(socket.getOutputStream())
                    output.writeInt(payload.size)
                    output.write(payload)
                    output.flush()
                }
            }.isSuccess
            sent = sent || success
        }

        return sent
    }

    override fun peers(): List<PeerDescriptor> {
        val now = System.currentTimeMillis()
        return peers.values.filter { now - it.lastSeenMs <= 15_000 }
    }

    override fun updateRole(role: String) {
        localRole = role
    }

    fun stop() {
        scope.cancel()
        runCatching { serverSocket?.close() }
        runCatching { multicastSocket?.close() }
        runCatching { multicastLock?.release() }
    }
}
