package com.emergance.app.services

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.emergance.app.BuildConfig
import com.emergance.app.data.AppMode
import com.emergance.app.data.DriverNavigationState
import com.emergance.app.data.IncidentStatus
import com.emergance.app.data.LocationQuality
import com.emergance.app.data.NavigationWaypoint
import com.emergance.app.data.PendingAssignment
import com.emergance.app.data.db.DriverStateEntity
import com.emergance.app.data.db.EmerganceDatabase
import com.emergance.app.data.db.IncidentEntity
import com.emergance.app.data.db.MessageOutboxEntity
import com.emergance.app.data.db.PeerEntity
import com.emergance.app.network.TransportManager
import com.emergance.app.security.CryptoManager
import com.emergance.app.util.bearingDegrees
import com.emergance.app.util.etaMinutesByDistance
import com.emergance.app.util.haversineMeters
import com.emergance.app.util.nextRetryDelayMs
import com.emergance.app.util.ttlMsByType
import com.emergance.protocol.AssignmentAck
import com.emergance.protocol.AssignmentOffer
import com.emergance.protocol.AssignmentReject
import com.emergance.protocol.Coordinate
import com.emergance.protocol.DeviceRole
import com.emergance.protocol.DriverHeartbeat
import com.emergance.protocol.Envelope
import com.emergance.protocol.IncidentStatusUpdate
import com.emergance.protocol.MessageType
import com.emergance.protocol.Payload
import com.emergance.protocol.SosCreate
import com.emergance.protocol.SosReceivedAck
import com.google.protobuf.ByteString
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class EmergencyRepository(
    private val context: Context,
    private val db: EmerganceDatabase,
    private val transportManager: TransportManager,
    private val locationService: LocationService,
    private val alertService: AlertService,
    private val cryptoManager: CryptoManager
) {
    private data class NavigationTarget(
        val incidentId: String,
        val dispatchDeviceId: String,
        val destinationLat: Double,
        val destinationLng: Double
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var navigationTarget: NavigationTarget? = null
    private var navigationInitialDistanceMeters: Double? = null
    private var navigationWaypoints: List<NavigationWaypoint> = emptyList()

    private val lockedMode: AppMode? = when (BuildConfig.APP_ROLE) {
        "SOS" -> AppMode.SOS
        "DRIVER" -> AppMode.DRIVER
        else -> null
    }
    val modeSwitchEnabled: Boolean = lockedMode == null

    private val _mode = MutableStateFlow(lockedMode ?: AppMode.SOS)
    val mode: StateFlow<AppMode> = _mode.asStateFlow()

    private val _driverOnDuty = MutableStateFlow(lockedMode == AppMode.DRIVER)
    val driverOnDuty: StateFlow<Boolean> = _driverOnDuty.asStateFlow()

    private val _pendingAssignment = MutableStateFlow<PendingAssignment?>(null)
    val pendingAssignment: StateFlow<PendingAssignment?> = _pendingAssignment.asStateFlow()

    private val _driverNavigation = MutableStateFlow(DriverNavigationState())
    val driverNavigation: StateFlow<DriverNavigationState> = _driverNavigation.asStateFlow()

    private val _bridgeSyncOnline = MutableStateFlow(false)
    val bridgeSyncOnline: StateFlow<Boolean> = _bridgeSyncOnline.asStateFlow()

    private val _bridgeSyncMessage = MutableStateFlow("Bridge sync: waiting for dispatch peer")
    val bridgeSyncMessage: StateFlow<String> = _bridgeSyncMessage.asStateFlow()

    private val _bridgeApiBaseUrl = MutableStateFlow("")
    val bridgeApiBaseUrl: StateFlow<String> = _bridgeApiBaseUrl.asStateFlow()

    val incidents = db.incidentDao().observeAll()
    val peers = db.peerDao().observePeers()
    val drivers = db.driverStateDao().observeAll()

    val missionFilePath: String = cryptoManager.missionFilePath

    fun start() {
        scope.launch {
            transportManager.start(
                deviceId = cryptoManager.deviceId,
                role = currentTransportRole()
            ) { envelope, via, host ->
                handleIncomingEnvelope(envelope, via, host)
            }
        }

        if (lockedMode == AppMode.DRIVER) {
            setDriverOnDuty(true)
        }

        scope.launch { outboxLoop() }
        scope.launch { heartbeatLoop() }
        scope.launch { driverTrackerLoop() }
        scope.launch { peerSnapshotLoop() }
        scope.launch { bridgeSyncLoop() }
    }

    suspend fun triggerSos(notes: String = ""): Boolean {
        val fix = locationService.bestEffortFix(
            timeoutMs = 8_000,
            maxStaleMs = 15 * 60_000
        ) ?: locationService.lastCachedFix(maxStaleMs = 15 * 60_000) ?: return false

        val incidentId = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val incident = IncidentEntity(
            id = incidentId,
            createdAtMs = now,
            lat = fix.lat,
            lng = fix.lng,
            accuracyM = fix.accuracyM,
            locationQuality = fix.quality.name,
            status = IncidentStatus.PENDING_NETWORK.name,
            assignedDriverId = null,
            lastError = null
        )
        db.incidentDao().upsert(incident)

        val payload = Payload.newBuilder()
            .setSosCreate(
                SosCreate.newBuilder()
                    .setIncidentId(incidentId)
                    .setCoordinate(fix.toProtoCoordinate())
                    .setClientCreatedAtMs(now)
                    .setNotes(notes)
                    .build()
            )
            .build()

        queueSecureMessage(
            messageType = MessageType.SOS_CREATE,
            payload = payload,
            incidentId = incidentId,
            ackRequired = true,
            ttlMs = ttlMsByType("SOS_CREATE"),
            targetDeviceId = null,
            requiredAckFor = null
        )

        alertService.playSosConfirmation()
        return true
    }

    suspend fun respondToPendingAssignment(accept: Boolean, reason: String = "") {
        val assignment = _pendingAssignment.value ?: return
        val now = System.currentTimeMillis()

        if (accept) {
            activateNavigationTarget(
                incidentId = assignment.incidentId,
                dispatchDeviceId = assignment.dispatchDeviceId,
                destinationLat = assignment.lat,
                destinationLng = assignment.lng
            )

            locationService.bestEffortFix(timeoutMs = 2_500)?.let { fix ->
                updateNavigationFromFix(fix)
            }

            val payload = Payload.newBuilder()
                .setAssignmentAck(
                    AssignmentAck.newBuilder()
                        .setAssignmentId(assignment.assignmentId)
                        .setIncidentId(assignment.incidentId)
                        .setDriverDeviceId(cryptoManager.deviceId)
                        .setAckAtMs(now)
                        .build()
                )
                .build()

            queueSecureMessage(
                messageType = MessageType.ASSIGNMENT_ACK,
                payload = payload,
                incidentId = assignment.incidentId,
                ackRequired = false,
                ttlMs = 60_000,
                targetDeviceId = assignment.dispatchDeviceId,
                requiredAckFor = assignment.offerMessageId
            )

            db.incidentDao().updateStatus(
                incidentId = assignment.incidentId,
                status = IncidentStatus.ASSIGNED.name,
                assignedDriverId = cryptoManager.deviceId
            )
        } else {
            val payload = Payload.newBuilder()
                .setAssignmentReject(
                    AssignmentReject.newBuilder()
                        .setAssignmentId(assignment.assignmentId)
                        .setIncidentId(assignment.incidentId)
                        .setDriverDeviceId(cryptoManager.deviceId)
                        .setReason(reason.ifBlank { "DECLINED" })
                        .setRejectedAtMs(now)
                        .build()
                )
                .build()

            queueSecureMessage(
                messageType = MessageType.ASSIGNMENT_REJECT,
                payload = payload,
                incidentId = assignment.incidentId,
                ackRequired = false,
                ttlMs = 60_000,
                targetDeviceId = assignment.dispatchDeviceId,
                requiredAckFor = assignment.offerMessageId
            )
        }

        _pendingAssignment.value = null
    }

    suspend fun markCurrentIncidentResolved(): Boolean {
        val target = navigationTarget ?: return false
        val now = System.currentTimeMillis()

        val payload = Payload.newBuilder()
            .setIncidentStatusUpdate(
                IncidentStatusUpdate.newBuilder()
                    .setIncidentId(target.incidentId)
                    .setStatus(com.emergance.protocol.IncidentStatus.RESOLVED)
                    .setAssignedDriverId(cryptoManager.deviceId)
                    .setUpdatedAtMs(now)
                    .setReason("DRIVER_MARKED_RESOLVED")
                    .build()
            )
            .build()

        queueSecureMessage(
            messageType = MessageType.INCIDENT_STATUS_UPDATE,
            payload = payload,
            incidentId = target.incidentId,
            ackRequired = false,
            ttlMs = 60_000,
            targetDeviceId = target.dispatchDeviceId,
            requiredAckFor = null
        )

        db.incidentDao().updateStatus(
            incidentId = target.incidentId,
            status = IncidentStatus.RESOLVED.name,
            assignedDriverId = cryptoManager.deviceId
        )

        clearNavigationTarget()
        return true
    }

    fun setMode(mode: AppMode) {
        if (lockedMode != null && mode != lockedMode) {
            _mode.value = lockedMode
            return
        }

        _mode.value = mode
        transportManager.updateRole(currentTransportRole())
        if (mode != AppMode.DRIVER) {
            setDriverOnDuty(false)
            clearNavigationTarget()
        }
    }

    fun setDriverOnDuty(onDuty: Boolean) {
        if (lockedMode == AppMode.SOS) {
            _driverOnDuty.value = false
            return
        }
        if (onDuty && _mode.value != AppMode.DRIVER) {
            _driverOnDuty.value = false
            return
        }

        _driverOnDuty.value = onDuty
        if (onDuty && _mode.value == AppMode.DRIVER) {
            val started = runCatching {
                ContextCompat.startForegroundService(context, Intent(context, DriverHeartbeatService::class.java))
            }.isSuccess

            if (!started) {
                _driverOnDuty.value = false
                return
            }

            scope.launch { sendDriverHeartbeat() }
        } else {
            context.stopService(Intent(context, DriverHeartbeatService::class.java))
            if (!onDuty) {
                clearNavigationTarget()
            }
        }
    }

    private suspend fun queueSecureMessage(
        messageType: MessageType,
        payload: Payload,
        incidentId: String,
        ackRequired: Boolean,
        ttlMs: Long,
        targetDeviceId: String?,
        requiredAckFor: String?
    ) {
        val now = System.currentTimeMillis()
        val plain = payload.toByteArray()
        val (nonce, cipher) = cryptoManager.encrypt(plain)

        val senderRole = if (_mode.value == AppMode.DRIVER) DeviceRole.DRIVER else DeviceRole.SOS
        val envelopeBuilder = Envelope.newBuilder()
            .setSchemaVersion(1)
            .setMessageId(UUID.randomUUID().toString())
            .setIncidentId(incidentId)
            .setType(messageType)
            .setSenderRole(senderRole)
            .setCreatedAtMs(now)
            .setTtlMs(ttlMs.toInt())
            .setHopCount(0)
            .setAckRequired(ackRequired)

        if (!requiredAckFor.isNullOrBlank()) {
            envelopeBuilder.setRequiredAckFor(ByteString.copyFromUtf8(requiredAckFor))
        }

        val signedEnvelope = cryptoManager.buildSignedEnvelope(envelopeBuilder, nonce, cipher)

        db.outboxDao().upsert(
            MessageOutboxEntity(
                messageId = signedEnvelope.messageId,
                incidentId = incidentId,
                type = messageType.name,
                payloadBlob = signedEnvelope.toByteArray(),
                targetDeviceId = targetDeviceId,
                attempts = 0,
                nextAttemptAtMs = now,
                expiresAtMs = now + ttlMs,
                ackedAtMs = null
            )
        )
    }

    private suspend fun handleIncomingEnvelope(envelope: Envelope, via: String, host: String) {
        val now = System.currentTimeMillis()
        if (envelope.createdAtMs + envelope.ttlMs <= now) {
            return
        }

        val replay = db.inboxDao().find(envelope.messageId) != null
        val verified = !replay && cryptoManager.verify(envelope)

        db.inboxDao().upsert(
            cryptoManager.toInboxRecord(
                messageId = envelope.messageId,
                validSignature = verified,
                replayDropped = replay
            )
        )

        if (replay || !verified) {
            return
        }

        val clear = runCatching {
            cryptoManager.decrypt(
                cipherText = envelope.ciphertext.toByteArray(),
                nonce = envelope.nonce.toByteArray()
            )
        }.getOrNull() ?: return

        val payload = runCatching { Payload.parseFrom(clear) }.getOrNull() ?: return

        if (!envelope.requiredAckFor.isEmpty) {
            val ackedMessageId = envelope.requiredAckFor.toStringUtf8()
            if (ackedMessageId.isNotBlank()) {
                db.outboxDao().markAcked(ackedMessageId, now)
            }
        }

        when (envelope.type) {
            MessageType.SOS_RECEIVED_ACK -> {
                val body = payload.sosReceivedAck
                db.outboxDao().markAcked(body.messageId, body.receivedAtMs)
                db.incidentDao().updateStatus(body.incidentId, IncidentStatus.RECEIVED.name, null)
            }

            MessageType.ASSIGNMENT_OFFER -> {
                val body = payload.assignmentOffer
                _pendingAssignment.value = PendingAssignment(
                    offerMessageId = envelope.messageId,
                    assignmentId = body.assignmentId,
                    incidentId = body.incidentId,
                    driverDeviceId = body.driverDeviceId,
                    dispatchDeviceId = envelope.senderDeviceId,
                    ackDeadlineMs = body.ackDeadlineMs,
                    lat = body.incidentCoordinate.lat,
                    lng = body.incidentCoordinate.lng
                )

                db.incidentDao().upsert(
                    IncidentEntity(
                        id = body.incidentId,
                        createdAtMs = now,
                        lat = body.incidentCoordinate.lat,
                        lng = body.incidentCoordinate.lng,
                        accuracyM = body.incidentCoordinate.accuracyM,
                        locationQuality = body.incidentCoordinate.quality.name,
                        status = IncidentStatus.RECEIVED.name,
                        assignedDriverId = null,
                        lastError = null
                    )
                )
            }

            MessageType.INCIDENT_STATUS_UPDATE -> {
                val body = payload.incidentStatusUpdate
                db.incidentDao().updateStatus(body.incidentId, body.status.toLocalStatus(), body.assignedDriverId)
            }

            MessageType.DRIVER_HEARTBEAT -> {
                val body = payload.driverHeartbeat
                db.driverStateDao().upsert(
                    DriverStateEntity(
                        deviceId = body.deviceId,
                        onDuty = body.onDuty,
                        available = body.available,
                        lastLat = body.coordinate.lat,
                        lastLng = body.coordinate.lng,
                        lastFixAtMs = body.coordinate.fixAtMs,
                        batteryPct = body.batteryPct
                    )
                )
            }

            MessageType.STORE_FORWARD_BUNDLE -> {
                payload.storeForwardBundle.envelopesList.forEach {
                    handleIncomingEnvelope(it, "RELAY", host)
                }
            }

            else -> Unit
        }

        db.peerDao().upsert(
            PeerEntity(
                deviceId = envelope.senderDeviceId,
                role = envelope.senderRole.name,
                host = host,
                port = 37021,
                bestTransport = via,
                lastSeenMs = now,
                rssi = 0,
                relayScore = 0
            )
        )
    }

    private suspend fun outboxLoop() {
        while (scope.isActive) {
            val now = System.currentTimeMillis()
            db.outboxDao().pruneExpired(now)
            val due = db.outboxDao().due(now)

            due.forEach { record ->
                val envelope = runCatching { Envelope.parseFrom(record.payloadBlob) }.getOrNull() ?: return@forEach
                val sent = transportManager.send(envelope, record.targetDeviceId)
                val nextAttempt = now + nextRetryDelayMs(record.attempts)
                db.outboxDao().markAttempt(record.messageId, nextAttempt)

                if (!sent) {
                    return@forEach
                }
            }

            delay(500)
        }
    }

    private suspend fun heartbeatLoop() {
        while (scope.isActive) {
            if (_mode.value == AppMode.DRIVER && _driverOnDuty.value) {
                sendDriverHeartbeat()
            }
            delay(5_000)
        }
    }

    private suspend fun driverTrackerLoop() {
        while (scope.isActive) {
            if (_mode.value == AppMode.DRIVER && _driverOnDuty.value) {
                val fix = locationService.bestEffortFix(timeoutMs = 2_000)
                if (fix != null) {
                    updateNavigationFromFix(fix)
                }
            }
            delay(2_000)
        }
    }

    private suspend fun peerSnapshotLoop() {
        while (scope.isActive) {
            transportManager.peers().forEach { peer ->
                db.peerDao().upsert(
                    PeerEntity(
                        deviceId = peer.deviceId,
                        role = peer.role,
                        host = peer.host,
                        port = peer.port,
                        bestTransport = peer.transport,
                        lastSeenMs = peer.lastSeenMs,
                        rssi = 0,
                        relayScore = 0
                    )
                )
            }
            delay(2_000)
        }
    }

    private suspend fun bridgeSyncLoop() {
        var lastOriginPingAtMs = 0L

        while (scope.isActive) {
            val bridgeBaseUrl = resolveDispatchBridgeBaseUrl()
            if (bridgeBaseUrl.isBlank()) {
                _bridgeApiBaseUrl.value = ""
                _bridgeSyncOnline.value = false
                _bridgeSyncMessage.value = "Bridge sync: waiting for dispatch peer"
                delay(3_000)
                continue
            }

            _bridgeApiBaseUrl.value = bridgeBaseUrl
            val snapshot = fetchDispatchSnapshot(bridgeBaseUrl)
            if (snapshot == null) {
                _bridgeSyncOnline.value = false
                _bridgeSyncMessage.value = "Bridge sync: unreachable ($bridgeBaseUrl)"
                delay(2_500)
                continue
            }

            applyDispatchSnapshot(snapshot)
            val incidentCount = snapshot.optJSONArray("incidents")?.length() ?: 0
            val responderCount = snapshot.optJSONArray("responders")?.length() ?: 0
            _bridgeSyncOnline.value = true
            _bridgeSyncMessage.value = "Bridge sync live: $incidentCount incidents, $responderCount responders"

            val now = System.currentTimeMillis()
            if (now - lastOriginPingAtMs >= 10_000) {
                val fix = locationService.lastCachedFix(maxStaleMs = 300_000)
                    ?: locationService.bestEffortFix(timeoutMs = 2_000, maxStaleMs = 300_000)
                if (fix != null) {
                    postOriginPing(bridgeBaseUrl, fix)
                    lastOriginPingAtMs = now
                }
            }

            delay(2_000)
        }
    }

    private suspend fun sendDriverHeartbeat() {
        val fix = locationService.bestEffortFix(
            timeoutMs = 3_500,
            maxStaleMs = 15 * 60_000
        ) ?: locationService.lastCachedFix(maxStaleMs = 15 * 60_000)
            ?: _driverNavigation.value.currentLat?.let { lat ->
                val lng = _driverNavigation.value.currentLng ?: return@let null
                com.emergance.app.data.CoordinateFix(
                    lat = lat,
                    lng = lng,
                    accuracyM = 120f,
                    fixAtMs = System.currentTimeMillis(),
                    quality = LocationQuality.DEGRADED
                )
            } ?: return

        updateNavigationFromFix(fix)
        val payload = Payload.newBuilder()
            .setDriverHeartbeat(
                DriverHeartbeat.newBuilder()
                    .setDeviceId(cryptoManager.deviceId)
                    .setOnDuty(_driverOnDuty.value)
                    .setAvailable(true)
                    .setCoordinate(fix.toProtoCoordinate())
                    .setBatteryPct(50)
                    .build()
            )
            .build()

        queueSecureMessage(
            messageType = MessageType.DRIVER_HEARTBEAT,
            payload = payload,
            incidentId = "",
            ackRequired = false,
            ttlMs = ttlMsByType("DRIVER_HEARTBEAT"),
            targetDeviceId = null,
            requiredAckFor = null
        )
    }

    private fun resolveDispatchBridgeBaseUrl(): String {
        val dispatchPeer = transportManager.peers().firstOrNull { peer ->
            peer.role.equals("DISPATCH", ignoreCase = true)
        } ?: return ""

        val host = dispatchPeer.host.trim()
        if (host.isBlank() || host == "0.0.0.0" || host == "::") {
            return ""
        }

        val hostPart = if (host.contains(":") && !host.startsWith("[")) {
            "[$host]"
        } else {
            host
        }
        return "http://$hostPart:37024/api/dispatch"
    }

    private fun fetchDispatchSnapshot(bridgeBaseUrl: String): JSONObject? {
        val connection = (URL(bridgeBaseUrl).openConnection() as? HttpURLConnection) ?: return null
        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 2_000
            connection.readTimeout = 2_500
            connection.setRequestProperty("Accept", "application/json")
            connection.inputStream.bufferedReader().use { reader ->
                JSONObject(reader.readText())
            }
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun postOriginPing(bridgeBaseUrl: String, fix: com.emergance.app.data.CoordinateFix) {
        val payload = JSONObject()
            .put("command", "ACTION")
            .put(
                "action",
                JSONObject()
                    .put("type", "PING_ORIGIN")
                    .put("source", if (_mode.value == AppMode.DRIVER) "DRIVER" else "APP")
                    .put("sourceId", cryptoManager.deviceId)
                    .put("lat", fix.lat)
                    .put("lng", fix.lng)
                    .put("accuracyM", fix.accuracyM.toDouble())
                    .put("pingAtMs", fix.fixAtMs)
            )
            .toString()

        val connection = (URL(bridgeBaseUrl).openConnection() as? HttpURLConnection) ?: return
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 2_000
            connection.readTimeout = 2_500
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.bufferedWriter().use { writer ->
                writer.write(payload)
            }
            connection.inputStream.close()
        } catch (_: Exception) {
            // Ignore bridge ping errors; loop will retry.
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun applyDispatchSnapshot(snapshot: JSONObject) {
        val now = System.currentTimeMillis()
        val incidentArray = snapshot.optJSONArray("incidents")
        if (incidentArray != null) {
            for (index in 0 until incidentArray.length()) {
                val row = incidentArray.optJSONObject(index) ?: continue
                val incidentId = row.optString("id", "")
                if (incidentId.isBlank()) {
                    continue
                }

                val rawStatus = row.optString("status", IncidentStatus.PENDING_NETWORK.name)
                val status = IncidentStatus.entries.firstOrNull { it.name == rawStatus }?.name
                    ?: IncidentStatus.PENDING_NETWORK.name
                val accuracyM = row.optDouble("accuracyM", 50.0).toFloat()
                val assignedDriver = row.optString("assignedDriverId", "").ifBlank { null }

                db.incidentDao().upsert(
                    IncidentEntity(
                        id = incidentId,
                        createdAtMs = row.optLong("createdAtMs", now),
                        lat = row.optDouble("lat", 0.0),
                        lng = row.optDouble("lng", 0.0),
                        accuracyM = accuracyM,
                        locationQuality = if (accuracyM <= 35f) {
                            LocationQuality.LIVE.name
                        } else {
                            LocationQuality.DEGRADED.name
                        },
                        status = status,
                        assignedDriverId = assignedDriver,
                        lastError = null
                    )
                )
            }
        }

        val responderArray = snapshot.optJSONArray("responders")
        if (responderArray != null) {
            for (index in 0 until responderArray.length()) {
                val row = responderArray.optJSONObject(index) ?: continue
                val deviceId = row.optString("deviceId", "")
                if (deviceId.isBlank()) {
                    continue
                }

                val responderStatus = row.optString("status", "OFFLINE")
                db.driverStateDao().upsert(
                    DriverStateEntity(
                        deviceId = deviceId,
                        onDuty = responderStatus != "OFFLINE",
                        available = responderStatus == "AVAILABLE",
                        lastLat = row.optDouble("lastLat", 0.0),
                        lastLng = row.optDouble("lastLng", 0.0),
                        lastFixAtMs = row.optLong("lastFixAtMs", now),
                        batteryPct = row.optInt("batteryPct", 50)
                    )
                )
            }
        }
    }

    private fun activateNavigationTarget(
        incidentId: String,
        dispatchDeviceId: String,
        destinationLat: Double,
        destinationLng: Double
    ) {
        navigationTarget = NavigationTarget(
            incidentId = incidentId,
            dispatchDeviceId = dispatchDeviceId,
            destinationLat = destinationLat,
            destinationLng = destinationLng
        )
        navigationInitialDistanceMeters = null
        navigationWaypoints = emptyList()
        _driverNavigation.value = _driverNavigation.value.copy(
            active = true,
            incidentId = incidentId,
            dispatchDeviceId = dispatchDeviceId,
            destinationLat = destinationLat,
            destinationLng = destinationLng,
            reached = false,
            progress = 0f,
            waypoints = emptyList()
        )
    }

    private fun clearNavigationTarget() {
        navigationTarget = null
        navigationInitialDistanceMeters = null
        navigationWaypoints = emptyList()
        _driverNavigation.value = _driverNavigation.value.copy(
            active = false,
            incidentId = null,
            dispatchDeviceId = null,
            destinationLat = null,
            destinationLng = null,
            distanceMeters = null,
            etaMinutes = null,
            bearingDegrees = null,
            progress = 0f,
            reached = false,
            waypoints = emptyList()
        )
    }

    private fun updateNavigationFromFix(fix: com.emergance.app.data.CoordinateFix) {
        val target = navigationTarget
        if (target == null) {
            _driverNavigation.value = _driverNavigation.value.copy(
                currentLat = fix.lat,
                currentLng = fix.lng
            )
            return
        }

        if (navigationWaypoints.isEmpty()) {
            navigationWaypoints = buildWaypoints(
                startLat = fix.lat,
                startLng = fix.lng,
                destinationLat = target.destinationLat,
                destinationLng = target.destinationLng
            )
        }

        val remainingDistance = haversineMeters(
            lat1 = fix.lat,
            lng1 = fix.lng,
            lat2 = target.destinationLat,
            lng2 = target.destinationLng
        )

        if (navigationInitialDistanceMeters == null) {
            navigationInitialDistanceMeters = remainingDistance.coerceAtLeast(1.0)
        }

        navigationWaypoints = navigationWaypoints.map { waypoint ->
            val reached = waypoint.reached || haversineMeters(fix.lat, fix.lng, waypoint.lat, waypoint.lng) <= 35.0
            waypoint.copy(reached = reached)
        }

        val initialDistance = navigationInitialDistanceMeters ?: remainingDistance.coerceAtLeast(1.0)
        val progress = ((initialDistance - remainingDistance) / initialDistance).coerceIn(0.0, 1.0).toFloat()
        val reachedDestination = remainingDistance <= 35.0

        _driverNavigation.value = _driverNavigation.value.copy(
            active = true,
            incidentId = target.incidentId,
            dispatchDeviceId = target.dispatchDeviceId,
            destinationLat = target.destinationLat,
            destinationLng = target.destinationLng,
            currentLat = fix.lat,
            currentLng = fix.lng,
            distanceMeters = remainingDistance,
            etaMinutes = etaMinutesByDistance(remainingDistance),
            bearingDegrees = bearingDegrees(fix.lat, fix.lng, target.destinationLat, target.destinationLng),
            progress = if (reachedDestination) 1f else progress,
            reached = reachedDestination,
            waypoints = navigationWaypoints
        )
    }

    private fun buildWaypoints(
        startLat: Double,
        startLng: Double,
        destinationLat: Double,
        destinationLng: Double
    ): List<NavigationWaypoint> {
        val distance = haversineMeters(startLat, startLng, destinationLat, destinationLng)
        val segments = (distance / 250.0).toInt().coerceIn(4, 12)
        return (1..segments).map { step ->
            val ratio = step.toDouble() / segments.toDouble()
            NavigationWaypoint(
                id = "wp-$step",
                lat = startLat + ((destinationLat - startLat) * ratio),
                lng = startLng + ((destinationLng - startLng) * ratio),
                reached = false
            )
        }
    }

    private fun com.emergance.app.data.CoordinateFix.toProtoCoordinate(): Coordinate {
        val quality = when (this.quality) {
            LocationQuality.LIVE -> com.emergance.protocol.LocationQuality.LIVE
            LocationQuality.DEGRADED -> com.emergance.protocol.LocationQuality.DEGRADED
        }

        return Coordinate.newBuilder()
            .setLat(this.lat)
            .setLng(this.lng)
            .setAccuracyM(this.accuracyM)
            .setFixAtMs(this.fixAtMs)
            .setQuality(quality)
            .build()
    }

    private fun com.emergance.protocol.IncidentStatus.toLocalStatus(): String {
        return when (this) {
            com.emergance.protocol.IncidentStatus.PENDING_NETWORK -> IncidentStatus.PENDING_NETWORK.name
            com.emergance.protocol.IncidentStatus.RECEIVED -> IncidentStatus.RECEIVED.name
            com.emergance.protocol.IncidentStatus.ASSIGNED -> IncidentStatus.ASSIGNED.name
            com.emergance.protocol.IncidentStatus.RESOLVED -> IncidentStatus.RESOLVED.name
            com.emergance.protocol.IncidentStatus.CANCELLED -> IncidentStatus.CANCELLED.name
            com.emergance.protocol.IncidentStatus.UNASSIGNED_RETRY -> IncidentStatus.UNASSIGNED_RETRY.name
            else -> IncidentStatus.PENDING_NETWORK.name
        }
    }

    private fun currentTransportRole(): String {
        return if (_mode.value == AppMode.DRIVER) "DRIVER" else "SOS"
    }
}
