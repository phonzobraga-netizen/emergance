package com.emergance.app.ui

import com.emergance.app.data.db.IncidentEntity

fun deriveSosDeliveryText(incidents: List<IncidentEntity>): String {
    val latest = incidents.firstOrNull() ?: return "No SOS has been sent yet"
    return when (latest.status) {
        "PENDING_NETWORK" -> "SOS queued and retrying network delivery"
        "RECEIVED" -> "SOS delivered to dispatch"
        "ASSIGNED" -> "SOS delivered and responder assigned"
        "UNASSIGNED_RETRY" -> "Dispatch received SOS and is reassigning"
        "RESOLVED" -> "SOS incident resolved"
        "CANCELLED" -> "SOS incident cancelled"
        else -> "SOS status: ${latest.status}"
    }
}
