package org.kasbah.auto

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class KasbahCarAppService : CarAppService() {
    // The app is installed by hand ("Sources inconnues" in Android Auto), never from the Play Store: any
    // host may show it. Android Auto's own allowlist is private to the car library.
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = object : Session() {
        override fun onCreateScreen(intent: Intent): Screen = AccessScreen(carContext)
    }
}
