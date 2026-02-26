package com.emergance.app.ui

import com.emergance.app.data.db.IncidentEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class SosDeliveryStatusTest {
    @Test
    fun `maps empty incidents to default status`() {
        assertEquals("No SOS has been sent yet", deriveSosDeliveryText(emptyList()))
    }

    @Test
    fun `maps received incident to delivered text`() {
        val incidents = listOf(
            incident(status = "RECEIVED")
        )

        assertEquals("SOS delivered to dispatch", deriveSosDeliveryText(incidents))
    }

    @Test
    fun `maps unknown status to generic text`() {
        val incidents = listOf(
            incident(status = "CUSTOM_STATE")
        )

        assertEquals("SOS status: CUSTOM_STATE", deriveSosDeliveryText(incidents))
    }

    private fun incident(status: String): IncidentEntity {
        return IncidentEntity(
            id = "incident-1",
            createdAtMs = 1_700_000_000_000,
            lat = 14.5995,
            lng = 120.9842,
            accuracyM = 8f,
            locationQuality = "LIVE",
            status = status,
            assignedDriverId = null,
            lastError = null
        )
    }
}
