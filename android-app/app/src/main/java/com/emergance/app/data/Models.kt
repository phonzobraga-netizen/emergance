package com.emergance.app.data

enum class AppMode {
    SOS,
    DRIVER
}

enum class LocationQuality {
    LIVE,
    DEGRADED
}

enum class IncidentStatus {
    PENDING_NETWORK,
    RECEIVED,
    ASSIGNED,
    RESOLVED,
    CANCELLED,
    UNASSIGNED_RETRY
}

data class CoordinateFix(
    val lat: Double,
    val lng: Double,
    val accuracyM: Float,
    val fixAtMs: Long,
    val quality: LocationQuality
)

data class PendingAssignment(
    val offerMessageId: String,
    val assignmentId: String,
    val incidentId: String,
    val driverDeviceId: String,
    val dispatchDeviceId: String,
    val ackDeadlineMs: Long,
    val lat: Double,
    val lng: Double
)

data class NavigationWaypoint(
    val id: String,
    val lat: Double,
    val lng: Double,
    val reached: Boolean
)

data class DriverNavigationState(
    val active: Boolean = false,
    val incidentId: String? = null,
    val dispatchDeviceId: String? = null,
    val destinationLat: Double? = null,
    val destinationLng: Double? = null,
    val currentLat: Double? = null,
    val currentLng: Double? = null,
    val distanceMeters: Double? = null,
    val etaMinutes: Int? = null,
    val bearingDegrees: Float? = null,
    val progress: Float = 0f,
    val reached: Boolean = false,
    val waypoints: List<NavigationWaypoint> = emptyList()
)
