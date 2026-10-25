package org.kasbah.auto

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class KasbahCarAppService : CarAppService() {
    // The service is exported: any app on the phone could bind to it as the car and press the gate or
    // garage buttons with the stored session. Only Android Auto may show the app, checked by its signing
    // certificate against the allowlist the car library ships (hosts_allowlist_sample, outside its
    // public resources but readable). The debug build, used with the Desktop Head Unit, lets any host in.
    @SuppressLint("PrivateResource")
    override fun createHostValidator(): HostValidator =
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build()
        }

    override fun onCreateSession(): Session = object : Session() {
        override fun onCreateScreen(intent: Intent): Screen = AccessScreen(carContext)
    }
}
