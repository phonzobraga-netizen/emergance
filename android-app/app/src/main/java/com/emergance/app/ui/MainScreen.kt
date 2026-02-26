package com.emergance.app.ui

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.emergance.app.data.AppMode
import com.emergance.app.data.DriverNavigationState
import com.emergance.app.data.NavigationWaypoint
import com.emergance.app.data.db.DriverStateEntity
import com.emergance.app.data.db.IncidentEntity
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlinx.coroutines.withTimeoutOrNull

@Composable
fun MainScreen(
    state: MainUiState,
    onModeChange: (AppMode) -> Unit,
    onSosLongPress: () -> Unit,
    onDriverDutyChange: (Boolean) -> Unit,
    onAcceptAssignment: () -> Unit,
    onRejectAssignment: () -> Unit,
    onMarkResolved: () -> Unit,
    onOpenExternalMap: (Double, Double) -> Unit
) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(text = "Emergance", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(text = state.statusText, color = MaterialTheme.colorScheme.primary)
            Text(text = state.sosDeliveryText, color = Color(0xFF0B8F55))
            Text(
                text = if (state.peerCount > 0) "Connected peers: ${state.peerCount}" else "Waiting for dispatcher connection",
                color = if (state.peerCount > 0) Color(0xFF0B8F55) else Color(0xFFB26A00)
            )

            if (state.modeSwitchEnabled) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = { onModeChange(AppMode.SOS) },
                        modifier = Modifier.weight(1f)
                    ) { Text("SOS Mode") }
                    Button(
                        onClick = { onModeChange(AppMode.DRIVER) },
                        modifier = Modifier.weight(1f)
                    ) { Text("Driver Mode") }
                }
            } else {
                Text(
                    text = if (state.mode == AppMode.DRIVER) "Driver Unit" else "SOS Unit",
                    color = Color(0xFF555555)
                )
            }

            OperationsMapCard(
                incidents = state.incidents,
                drivers = state.drivers,
                navigation = state.driverNavigation,
                bridgeSyncOnline = state.bridgeSyncOnline,
                bridgeSyncMessage = state.bridgeSyncMessage,
                bridgeApiBaseUrl = state.bridgeApiBaseUrl
            )

            if (state.mode == AppMode.SOS) {
                SosButton(onLongPress = onSosLongPress)
            }

            if (state.mode == AppMode.DRIVER) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("On Duty")
                    Spacer(modifier = Modifier.weight(1f))
                    Switch(checked = state.driverOnDuty, onCheckedChange = onDriverDutyChange)
                }

                val assignment = state.pendingAssignment
                if (assignment != null) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Incoming Assignment", fontWeight = FontWeight.SemiBold)
                            Text("Incident: ${assignment.incidentId}")
                            Text("Coordinates: ${assignment.lat.format(5)}, ${assignment.lng.format(5)}")
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Button(onClick = onAcceptAssignment, modifier = Modifier.weight(1f)) { Text("Accept") }
                                Button(onClick = onRejectAssignment, modifier = Modifier.weight(1f)) { Text("Reject") }
                            }
                        }
                    }
                }

                DriverNavigationExperience(
                    navigation = state.driverNavigation,
                    onMarkResolved = onMarkResolved,
                    onOpenExternalMap = onOpenExternalMap
                )
            }

            Text("Recent Incidents", fontWeight = FontWeight.SemiBold)
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(state.incidents) { incident ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Status: ${incident.displayStatus()}", fontWeight = FontWeight.Medium)
                            Text("Lat/Lng: ${incident.lat.format(5)}, ${incident.lng.format(5)}")
                            Text("Created: ${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(incident.createdAtMs))}")
                            Text("Assigned: ${incident.assignedDriverId?.takeLast(6) ?: "-"}")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OperationsMapCard(
    incidents: List<IncidentEntity>,
    drivers: List<DriverStateEntity>,
    navigation: DriverNavigationState,
    bridgeSyncOnline: Boolean,
    bridgeSyncMessage: String,
    bridgeApiBaseUrl: String
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Live Operations Map", fontWeight = FontWeight.SemiBold)
            Text(
                text = bridgeSyncMessage,
                color = if (bridgeSyncOnline) Color(0xFF0B8F55) else Color(0xFFB26A00)
            )
            if (bridgeApiBaseUrl.isNotBlank()) {
                Text(
                    text = bridgeApiBaseUrl,
                    color = Color(0xFF6C7686),
                    style = MaterialTheme.typography.labelSmall
                )
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 240.dp, max = 340.dp)
            ) {
                PhilippinesOperationsMapCanvas(
                    incidents = incidents,
                    drivers = drivers,
                    navigation = navigation
                )
            }

            Text(
                text = "Legend: red=incident, blue=driver, green=active route",
                color = Color(0xFF697384),
                style = MaterialTheme.typography.labelSmall
            )
        }
    }
}

@Composable
private fun PhilippinesOperationsMapCanvas(
    incidents: List<IncidentEntity>,
    drivers: List<DriverStateEntity>,
    navigation: DriverNavigationState
) {
    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFE8F3FF))
    ) {
        fun toOffset(lat: Double, lng: Double): Offset {
            val xRatio = ((lng - PH_MIN_LNG) / (PH_MAX_LNG - PH_MIN_LNG)).coerceIn(0.0, 1.0)
            val yRatio = ((lat - PH_MIN_LAT) / (PH_MAX_LAT - PH_MIN_LAT)).coerceIn(0.0, 1.0)
            return Offset(
                x = (xRatio.toFloat() * size.width),
                y = ((1f - yRatio.toFloat()) * size.height)
            )
        }

        fun drawIsland(points: List<Pair<Double, Double>>) {
            if (points.size < 3) return
            val path = Path()
            points.forEachIndexed { index, (lat, lng) ->
                val point = toOffset(lat, lng)
                if (index == 0) {
                    path.moveTo(point.x, point.y)
                } else {
                    path.lineTo(point.x, point.y)
                }
            }
            path.close()
            drawPath(path = path, color = Color(0xFFDDE8D7))
        }

        // Simplified island silhouettes to keep the map readable offline.
        drawIsland(
            listOf(
                18.0 to 120.0,
                16.8 to 122.4,
                15.0 to 123.0,
                13.0 to 121.8,
                14.3 to 119.5
            )
        )
        drawIsland(
            listOf(
                12.2 to 122.2,
                11.4 to 124.4,
                10.2 to 123.9,
                10.1 to 122.1,
                11.2 to 121.6
            )
        )
        drawIsland(
            listOf(
                9.8 to 124.0,
                8.5 to 126.6,
                6.2 to 126.5,
                5.3 to 123.8,
                7.1 to 122.5,
                8.9 to 123.0
            )
        )
        drawIsland(
            listOf(
                11.8 to 118.2,
                10.4 to 119.1,
                8.7 to 119.0,
                9.3 to 117.6
            )
        )

        val textPaint = Paint().apply {
            color = android.graphics.Color.parseColor("#30445A")
            isAntiAlias = true
            textSize = (size.minDimension * 0.05f).coerceIn(16f, 28f)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }

        listOf(
            "Manila" to (14.5995 to 120.9842),
            "Cebu" to (10.3157 to 123.8854),
            "Davao" to (7.1907 to 125.4553),
            "Iloilo" to (10.7202 to 122.5621),
            "Baguio" to (16.4023 to 120.5960)
        ).forEach { (name, coordinate) ->
            val labelPoint = toOffset(coordinate.first, coordinate.second)
            drawContext.canvas.nativeCanvas.drawText(
                name,
                labelPoint.x + 6f,
                labelPoint.y - 4f,
                textPaint
            )
        }

        incidents.forEach { incident ->
            if (!isWithinPhilippines(incident.lat, incident.lng)) return@forEach
            val point = toOffset(incident.lat, incident.lng)
            drawCircle(color = Color.White, radius = 8f, center = point)
            drawCircle(color = incidentColor(incident.status), radius = 5f, center = point)
        }

        drivers.forEach { driver ->
            if (!isWithinPhilippines(driver.lastLat, driver.lastLng)) return@forEach
            val point = toOffset(driver.lastLat, driver.lastLng)
            drawRect(
                color = if (driver.available) Color(0xFF2F76FF) else Color(0xFF6B7280),
                topLeft = Offset(point.x - 4f, point.y - 4f),
                size = androidx.compose.ui.geometry.Size(8f, 8f)
            )
        }

        val currentLat = navigation.currentLat
        val currentLng = navigation.currentLng
        val destinationLat = navigation.destinationLat
        val destinationLng = navigation.destinationLng
        if (
            navigation.active &&
            currentLat != null &&
            currentLng != null &&
            destinationLat != null &&
            destinationLng != null &&
            isWithinPhilippines(currentLat, currentLng) &&
            isWithinPhilippines(destinationLat, destinationLng)
        ) {
            val current = toOffset(currentLat, currentLng)
            val destination = toOffset(destinationLat, destinationLng)
            drawLine(
                color = Color(0xFF14A44D),
                start = current,
                end = destination,
                strokeWidth = 5f,
                cap = StrokeCap.Round
            )
            drawCircle(color = Color(0xFF14A44D), radius = 6f, center = current)
            drawCircle(color = Color(0xFFE84D4D), radius = 6f, center = destination)
        }
    }
}

@Composable
private fun DriverNavigationExperience(
    navigation: DriverNavigationState,
    onMarkResolved: () -> Unit,
    onOpenExternalMap: (Double, Double) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("⌄", style = MaterialTheme.typography.titleLarge, color = Color(0xFF555555))
                Spacer(modifier = Modifier.weight(1f))
                Text("Contact Dispatch", color = Color(0xFF555555))
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 260.dp, max = 420.dp)
            ) {
                NavigationMapLikeCanvas(
                    currentLat = navigation.currentLat,
                    currentLng = navigation.currentLng,
                    destinationLat = navigation.destinationLat,
                    destinationLng = navigation.destinationLng,
                    waypoints = navigation.waypoints
                )

                NavigationBottomCard(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(12.dp),
                    navigation = navigation,
                    onMarkResolved = onMarkResolved,
                    onOpenExternalMap = onOpenExternalMap
                )
            }
        }
    }
}

@Composable
private fun NavigationMapLikeCanvas(
    currentLat: Double?,
    currentLng: Double?,
    destinationLat: Double?,
    destinationLng: Double?,
    waypoints: List<NavigationWaypoint>
) {
    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFEEEEEE))
    ) {
        val path = mutableListOf<Pair<Double, Double>>()
        if (currentLat != null && currentLng != null) {
            path += currentLat to currentLng
        }
        waypoints.forEach { path += it.lat to it.lng }
        if (destinationLat != null && destinationLng != null) {
            path += destinationLat to destinationLng
        }

        // Draw soft map-like roads.
        repeat(9) { idx ->
            val y = size.height * (0.10f + idx * 0.09f)
            drawLine(
                color = Color(0xFFD9D9D9),
                start = Offset(0f, y),
                end = Offset(size.width, y + ((idx % 2) * 8f)),
                strokeWidth = if (idx % 3 == 0) 7f else 4f,
                cap = StrokeCap.Round
            )
        }

        repeat(8) { idx ->
            val x = size.width * (0.08f + idx * 0.11f)
            drawLine(
                color = Color(0xFFE2E2E2),
                start = Offset(x, 0f),
                end = Offset(x + ((idx % 2) * 10f), size.height),
                strokeWidth = 3f,
                cap = StrokeCap.Round
            )
        }

        if (path.size < 2) {
            return@Canvas
        }

        val latValues = path.map { it.first }
        val lngValues = path.map { it.second }
        val minLat = latValues.minOrNull() ?: 0.0
        val maxLat = latValues.maxOrNull() ?: 0.0
        val minLng = lngValues.minOrNull() ?: 0.0
        val maxLng = lngValues.maxOrNull() ?: 0.0

        val pad = 26f
        val w = max(1f, size.width - (pad * 2f))
        val h = max(1f, size.height - (pad * 2f))

        fun normalize(lat: Double, lng: Double): Offset {
            val xRatio = if (abs(maxLng - minLng) < 1e-9) 0.5 else (lng - minLng) / (maxLng - minLng)
            val yRatio = if (abs(maxLat - minLat) < 1e-9) 0.5 else (lat - minLat) / (maxLat - minLat)
            return Offset(
                x = pad + (xRatio.toFloat() * w),
                y = pad + ((1f - yRatio.toFloat()) * h)
            )
        }

        val normalized = path.map { normalize(it.first, it.second) }

        for (i in 0 until normalized.lastIndex) {
            drawLine(
                color = Color(0xFF14A44D),
                start = normalized[i],
                end = normalized[i + 1],
                strokeWidth = 11f,
                cap = StrokeCap.Round
            )
        }

        if (currentLat != null && currentLng != null) {
            val current = normalize(currentLat, currentLng)
            drawCircle(color = Color.White, radius = 14f, center = current)
            drawCircle(color = Color(0xFF2F76FF), radius = 8f, center = current)
            drawCircle(color = Color(0x882F76FF), radius = 18f, center = current, style = Stroke(width = 3f))
        }

        if (destinationLat != null && destinationLng != null) {
            val destination = normalize(destinationLat, destinationLng)
            drawCircle(color = Color(0xFFE84D4D), radius = 16f, center = destination)
            drawCircle(color = Color.White, radius = 6f, center = destination)
        }
    }
}

@Composable
private fun NavigationBottomCard(
    modifier: Modifier,
    navigation: DriverNavigationState,
    onMarkResolved: () -> Unit,
    onOpenExternalMap: (Double, Double) -> Unit
) {
    Card(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Estimated incident arrival time", color = Color(0xFF666666))
            Text(
                text = etaWindowText(navigation.etaMinutes),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            val phase = if (navigation.reached) "On Scene" else "Responding"
            val phaseDetail = if (navigation.reached) {
                "You have reached the destination perimeter"
            } else {
                "Driver is en route"
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("●", color = Color(0xFF14A44D))
                Spacer(modifier = Modifier.padding(horizontal = 3.dp))
                Column {
                    Text(phase, fontWeight = FontWeight.SemiBold)
                    Text(phaseDetail, color = Color(0xFF666666))
                }
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = headingText(navigation.bearingDegrees),
                    color = Color(0xFF333333)
                )
            }

            if (navigation.active) {
                Button(onClick = onMarkResolved, enabled = navigation.reached) {
                    Text("Mark Resolved")
                }

                val lat = navigation.destinationLat
                val lng = navigation.destinationLng
                if (lat != null && lng != null) {
                    Button(onClick = { onOpenExternalMap(lat, lng) }) {
                        Text("Open in Maps")
                    }
                }
            }
        }
    }
}

@Composable
private fun SosButton(onLongPress: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 200.dp, max = 320.dp)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    val releasedBeforeHold = withTimeoutOrNull(1_200) {
                        waitForUpOrCancellation()
                    }
                    if (releasedBeforeHold == null) {
                        onLongPress()
                        waitForUpOrCancellation()
                    }
                }
            }
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFFB00020)),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("HOLD 1.2s", color = Color.White)
            Text("SOS", color = Color.White, style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.Black)
        }
    }
}

private fun Double.format(digits: Int): String = String.format(Locale.US, "%.${digits}f", this)

private fun headingText(bearing: Float?): String {
    if (bearing == null) return "Heading -"

    val normalized = ((bearing % 360f) + 360f) % 360f
    val dir = when {
        normalized < 22.5f -> "N"
        normalized < 67.5f -> "NE"
        normalized < 112.5f -> "E"
        normalized < 157.5f -> "SE"
        normalized < 202.5f -> "S"
        normalized < 247.5f -> "SW"
        normalized < 292.5f -> "W"
        normalized < 337.5f -> "NW"
        else -> "N"
    }
    return "Heading $dir"
}

private fun etaWindowText(etaMinutes: Int?): String {
    if (etaMinutes == null) return "--:--"
    val formatter = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    val now = LocalTime.now()
    val start = now.plusMinutes((etaMinutes - 2).coerceAtLeast(0).toLong())
    val end = now.plusMinutes((etaMinutes + 5).toLong())
    return "${start.format(formatter)} - ${end.format(formatter)}"
}

private fun IncidentEntity.displayStatus(): String {
    return when (status) {
        "PENDING_NETWORK" -> "Dispatching"
        "RECEIVED" -> "Received by Dispatch"
        "ASSIGNED" -> "Responder Assigned"
        "RESOLVED" -> "Resolved"
        "CANCELLED" -> "Cancelled"
        "UNASSIGNED_RETRY" -> "Reassigning"
        else -> status
    }
}

private fun isWithinPhilippines(lat: Double, lng: Double): Boolean {
    return lat in PH_MIN_LAT..PH_MAX_LAT && lng in PH_MIN_LNG..PH_MAX_LNG
}

private fun incidentColor(status: String): Color {
    return when (status) {
        "ASSIGNED", "RESOLVED" -> Color(0xFF0B8F55)
        "CANCELLED" -> Color(0xFF70767F)
        else -> Color(0xFFE84D4D)
    }
}

private const val PH_MIN_LAT = 4.382696
private const val PH_MAX_LAT = 21.53021
private const val PH_MIN_LNG = 112.1661
private const val PH_MAX_LNG = 127.0742
