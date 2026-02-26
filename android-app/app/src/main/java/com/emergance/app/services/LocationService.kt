package com.emergance.app.services

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.emergance.app.data.CoordinateFix
import com.emergance.app.data.LocationQuality
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await

class LocationService(context: Context) {
    private val appContext = context.applicationContext
    private val fusedClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(appContext)
    @Volatile
    private var cachedFix: CoordinateFix? = null

    private fun hasFineLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission")
    suspend fun bestEffortFix(
        timeoutMs: Long = 8_000,
        maxStaleMs: Long = 120_000
    ): CoordinateFix? {
        if (!hasFineLocationPermission()) {
            return lastCachedFix(maxStaleMs)
        }

        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setDurationMillis(timeoutMs)
            .setMaxUpdateAgeMillis(2_000)
            .build()

        val fresh = runCatching {
            val token = CancellationTokenSource()
            fusedClient.getCurrentLocation(request, token.token).await()
        }.getOrNull()

        if (fresh != null) {
            val live = CoordinateFix(
                lat = fresh.latitude,
                lng = fresh.longitude,
                accuracyM = fresh.accuracy,
                fixAtMs = normalizeFixTime(fresh.time),
                quality = LocationQuality.LIVE
            )
            cachedFix = live
            return live
        }

        val lastKnown = runCatching { fusedClient.lastLocation.await() }.getOrNull()
        if (lastKnown != null) {
            val fixAtMs = normalizeFixTime(lastKnown.time)
            if (System.currentTimeMillis() - fixAtMs <= maxStaleMs) {
                val degraded = CoordinateFix(
                    lat = lastKnown.latitude,
                    lng = lastKnown.longitude,
                    accuracyM = lastKnown.accuracy,
                    fixAtMs = fixAtMs,
                    quality = LocationQuality.DEGRADED
                )
                cachedFix = degraded
                return degraded
            }
        }

        return lastCachedFix(maxStaleMs)
    }

    fun lastCachedFix(maxStaleMs: Long = 120_000): CoordinateFix? {
        val cached = cachedFix ?: return null
        if (System.currentTimeMillis() - cached.fixAtMs > maxStaleMs) {
            return null
        }
        return cached.copy(quality = LocationQuality.DEGRADED)
    }

    private fun normalizeFixTime(fixAtMs: Long): Long {
        return if (fixAtMs > 0L) {
            fixAtMs
        } else {
            System.currentTimeMillis()
        }
    }
}
