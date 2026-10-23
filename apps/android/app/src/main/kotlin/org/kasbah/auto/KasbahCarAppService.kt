package org.kasbah.auto

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class KasbahCarAppService : CarAppService() {
    // Any host may show the app: the Desktop Head Unit for tests, Android Auto in the car. Android Auto's
    // own allowlist is private to the car library.
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = object : Session() {
        override fun onCreateScreen(intent: Intent): Screen = AccessScreen(carContext)
    }
}
