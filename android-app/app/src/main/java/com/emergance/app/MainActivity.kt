package com.emergance.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.emergance.app.ui.MainScreen
import com.emergance.app.ui.MainViewModel
import com.emergance.app.ui.MainViewModelFactory

class MainActivity : ComponentActivity() {
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestRuntimePermissions()

        val app = application as EmerganceApp
        val factory = MainViewModelFactory(app.container.repository)

        setContent {
            val vm: MainViewModel = viewModel(factory = factory)
            val state by vm.state.collectAsState()

            MainScreen(
                state = state,
                onModeChange = vm::setMode,
                onSosLongPress = vm::triggerSos,
                onDriverDutyChange = vm::setDriverOnDuty,
                onAcceptAssignment = vm::acceptAssignment,
                onRejectAssignment = vm::rejectAssignment,
                onMarkResolved = vm::markResolved,
                onOpenExternalMap = { lat, lng -> openExternalMap(lat, lng) }
            )
        }
    }

    private fun requestRuntimePermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            permissions += Manifest.permission.ACCESS_BACKGROUND_LOCATION
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
            permissions += Manifest.permission.BLUETOOTH_CONNECT
            permissions += Manifest.permission.BLUETOOTH_SCAN
        }

        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    private fun openExternalMap(lat: Double, lng: Double) {
        val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(Emergency Incident)")
        val mapsIntent = Intent(Intent.ACTION_VIEW, uri).apply {
            setPackage("com.google.android.apps.maps")
        }

        runCatching { startActivity(mapsIntent) }.onFailure {
            if (it is ActivityNotFoundException) {
                val fallbackIntent = Intent(Intent.ACTION_VIEW, uri)
                runCatching { startActivity(fallbackIntent) }
            }
        }
    }
}
