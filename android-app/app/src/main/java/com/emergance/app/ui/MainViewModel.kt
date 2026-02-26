package com.emergance.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.emergance.app.data.AppMode
import com.emergance.app.data.DriverNavigationState
import com.emergance.app.data.PendingAssignment
import com.emergance.app.data.db.DriverStateEntity
import com.emergance.app.data.db.IncidentEntity
import com.emergance.app.services.EmergencyRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class MainUiState(
    val mode: AppMode = AppMode.SOS,
    val modeSwitchEnabled: Boolean = true,
    val driverOnDuty: Boolean = false,
    val pendingAssignment: PendingAssignment? = null,
    val driverNavigation: DriverNavigationState = DriverNavigationState(),
    val incidents: List<IncidentEntity> = emptyList(),
    val drivers: List<DriverStateEntity> = emptyList(),
    val sosDeliveryText: String = "No SOS has been sent yet",
    val peerCount: Int = 0,
    val bridgeSyncOnline: Boolean = false,
    val bridgeSyncMessage: String = "Bridge sync: waiting for dispatch peer",
    val bridgeApiBaseUrl: String = "",
    val missionFilePath: String = "",
    val statusText: String = "Idle"
)

class MainViewModel(private val repository: EmergencyRepository) : ViewModel() {
    private val statusText = MutableStateFlow("Ready")

    private val baseCore = combine(
        repository.mode,
        repository.driverOnDuty,
        repository.pendingAssignment,
        repository.driverNavigation,
        repository.incidents
    ) { mode, onDuty, pending, navigation, incidents ->
        MainUiState(
            mode = mode,
            modeSwitchEnabled = repository.modeSwitchEnabled,
            driverOnDuty = onDuty,
            pendingAssignment = pending,
            driverNavigation = navigation,
            incidents = incidents,
            sosDeliveryText = deriveSosDeliveryText(incidents),
            missionFilePath = repository.missionFilePath,
            statusText = "Ready"
        )
    }

    private val syncState = combine(
        repository.drivers,
        repository.bridgeSyncOnline,
        repository.bridgeSyncMessage,
        repository.bridgeApiBaseUrl
    ) { drivers, bridgeSyncOnline, bridgeSyncMessage, bridgeApiBaseUrl ->
        SyncAugmentation(
            drivers = drivers,
            bridgeSyncOnline = bridgeSyncOnline,
            bridgeSyncMessage = bridgeSyncMessage,
            bridgeApiBaseUrl = bridgeApiBaseUrl
        )
    }

    private val baseWithoutPeers = combine(baseCore, syncState) { base, sync ->
        base.copy(
            drivers = sync.drivers,
            bridgeSyncOnline = sync.bridgeSyncOnline,
            bridgeSyncMessage = sync.bridgeSyncMessage,
            bridgeApiBaseUrl = sync.bridgeApiBaseUrl
        )
    }

    private val baseState = combine(
        baseWithoutPeers,
        repository.peers.map { it.size }
    ) { base, peerCount ->
        base.copy(peerCount = peerCount)
    }

    val state: StateFlow<MainUiState> = combine(baseState, statusText) { base, status ->
        base.copy(statusText = status)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = MainUiState(missionFilePath = repository.missionFilePath)
    )

    fun setMode(mode: AppMode) {
        repository.setMode(mode)
    }

    fun setDriverOnDuty(enabled: Boolean) {
        repository.setDriverOnDuty(enabled)
    }

    fun triggerSos() {
        viewModelScope.launch {
            val success = repository.triggerSos()
            statusText.value = if (success) "SOS queued for dispatch" else "Location unavailable"
        }
    }

    fun acceptAssignment() {
        viewModelScope.launch {
            repository.respondToPendingAssignment(accept = true)
            statusText.value = "Assignment accepted"
        }
    }

    fun rejectAssignment() {
        viewModelScope.launch {
            repository.respondToPendingAssignment(accept = false, reason = "DRIVER_REJECT")
            statusText.value = "Assignment rejected"
        }
    }

    fun markResolved() {
        viewModelScope.launch {
            val success = repository.markCurrentIncidentResolved()
            statusText.value = if (success) "Incident marked resolved" else "No active navigation target"
        }
    }
}

private data class SyncAugmentation(
    val drivers: List<DriverStateEntity>,
    val bridgeSyncOnline: Boolean,
    val bridgeSyncMessage: String,
    val bridgeApiBaseUrl: String
)

class MainViewModelFactory(private val repository: EmergencyRepository) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MainViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return MainViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
