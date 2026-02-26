package com.emergance.app.util

fun nextRetryDelayMs(attempts: Int): Long {
    return when (attempts) {
        0 -> 500
        1 -> 1_000
        2 -> 2_000
        3 -> 4_000
        4 -> 8_000
        5 -> 16_000
        else -> 30_000
    }
}

fun ttlMsByType(type: String): Long {
    return when (type) {
        "SOS_CREATE" -> 86_400_000
        "ASSIGNMENT_OFFER" -> 60_000
        "DRIVER_HEARTBEAT" -> 15_000
        else -> 60_000
    }
}