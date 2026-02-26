package com.emergance.app.util

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

private const val EARTH_RADIUS_M = 6_371_000.0

private fun Double.toRadians(): Double = Math.toRadians(this)
private fun Double.toDegrees(): Double = Math.toDegrees(this)

fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val dLat = (lat2 - lat1).toRadians()
    val dLng = (lng2 - lng1).toRadians()

    val a =
        sin(dLat / 2) * sin(dLat / 2) +
            cos(lat1.toRadians()) * cos(lat2.toRadians()) *
            sin(dLng / 2) * sin(dLng / 2)

    val c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return EARTH_RADIUS_M * c
}

fun bearingDegrees(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Float {
    val phi1 = lat1.toRadians()
    val phi2 = lat2.toRadians()
    val deltaLng = (lng2 - lng1).toRadians()

    val y = sin(deltaLng) * cos(phi2)
    val x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(deltaLng)

    val brng = atan2(y, x).toDegrees()
    return ((brng + 360.0) % 360.0).toFloat()
}

fun etaMinutesByDistance(distanceMeters: Double, metersPerSecond: Double = 11.0): Int {
    if (distanceMeters <= 0.0) return 0
    val seconds = distanceMeters / metersPerSecond
    return (seconds / 60.0).roundToInt().coerceAtLeast(1)
}