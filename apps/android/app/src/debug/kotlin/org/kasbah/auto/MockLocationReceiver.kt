package org.kasbah.auto

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.location.LocationServices

/**
 * Debug builds only: moves the phone's position to test the approach alert from the computer, by an
 * offset from the house so its coordinates never leave the phone.
 * With R=org.kasbah.auto.debug/org.kasbah.auto.MockLocationReceiver (the debug build's own id):
 *
 *     adb shell appops set org.kasbah.auto.debug android:mock_location allow
 *     adb shell am broadcast -n $R --ef north 2000   # 2 km north
 *     adb shell am broadcast -n $R --ef north 0      # at the house
 *     adb shell am broadcast -n $R --ez off true     # real position
 *     adb shell am broadcast -n $R --ez arrive true  # as if entering the circle
 *
 * A mock position alone did not wake the geofence on an emulator (2026-10-23): `arrive` skips it.
 */
class MockLocationReceiver : BroadcastReceiver() {
    @SuppressLint("MissingPermission")
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.getBooleanExtra("arrive", false)) {
            val done = goAsync()
            Approach.arrive(context, done::finish)
            return
        }
        val fused = LocationServices.getFusedLocationProviderClient(context)
        if (intent.getBooleanExtra("off", false)) {
            fused.setMockMode(false)
            return
        }
        val home = KasbahClient(context).home
        if (home == null) {
            Log.w(Approach.TAG, "mock: no house position yet")
            return
        }
        val north = intent.getFloatExtra("north", 0f)
        val location = Location("kasbah-mock").apply {
            latitude = home.lat + north / 111_320.0
            longitude = home.lon
            accuracy = 5f
            time = System.currentTimeMillis()
            elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        }
        val done = goAsync()
        fused.setMockMode(true)
            .continueWithTask { fused.setMockLocation(location) }
            .addOnCompleteListener {
                Log.i(Approach.TAG, "mock: ${north.toInt()} m north of the house, ${if (it.isSuccessful) "set" else "refused: ${it.exception}"}")
                done.finish()
            }
    }
}
