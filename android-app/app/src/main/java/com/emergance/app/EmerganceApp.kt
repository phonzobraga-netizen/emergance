package com.emergance.app

import android.app.Application
import com.emergance.app.services.EmergencyRepository
import com.emergance.app.services.ReliabilityWorker

class EmerganceApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        ReliabilityWorker.schedule(this)
        container.repository.start()
    }
}
