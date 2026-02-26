package com.emergance.app

import android.content.Context
import com.emergance.app.data.db.EmerganceDatabase
import com.emergance.app.network.BleTransportAdapter
import com.emergance.app.network.LanTransportAdapter
import com.emergance.app.network.TransportManager
import com.emergance.app.network.WifiDirectTransportAdapter
import com.emergance.app.security.CryptoManager
import com.emergance.app.services.AlertService
import com.emergance.app.services.EmergencyRepository
import com.emergance.app.services.LocationService

class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    private val database = EmerganceDatabase.build(appContext)
    private val cryptoManager = CryptoManager(appContext)
    private val locationService = LocationService(appContext)
    private val alertService = AlertService(appContext)

    private val lan = LanTransportAdapter(appContext, BuildConfig.TRANSPORT_TCP_PORT)
    private val wifiDirect = WifiDirectTransportAdapter(appContext)
    private val ble = BleTransportAdapter(appContext)

    private val transportManager = TransportManager(lan, wifiDirect, ble)

    val repository = EmergencyRepository(
        context = appContext,
        db = database,
        transportManager = transportManager,
        locationService = locationService,
        alertService = alertService,
        cryptoManager = cryptoManager
    )
}
