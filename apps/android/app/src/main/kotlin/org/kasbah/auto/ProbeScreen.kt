package org.kasbah.auto

import android.Manifest
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.hardware.CarHardwareManager
import androidx.car.app.hardware.common.CarValue
import androidx.car.app.hardware.common.OnCarDataAvailableListener
import androidx.car.app.hardware.info.CarHardwareLocation
import androidx.car.app.hardware.info.CarSensors
import androidx.car.app.hardware.info.EnergyLevel
import androidx.car.app.hardware.info.EnergyProfile
import androidx.car.app.hardware.info.Mileage
import androidx.car.app.hardware.info.Speed
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * What Android Auto tells about the car, shown readable and logged under the `KasbahProbe` tag
 * (`adb logcat -s KasbahProbe`). A probe: it says which values this car provides at all.
 */
class ProbeScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val hardware = carContext.getCarService(CarHardwareManager::class.java)
    private val info = hardware.carInfo
    private val executor = carContext.mainExecutor
    private val locale = carContext.resources.configuration.locales[0]
    // Row titles by string resource, in display order.
    private val rows = linkedMapOf(
        R.string.probe_model to "…", R.string.probe_energy to "…", R.string.probe_battery to "…",
        R.string.probe_speed to "…", R.string.probe_odometer to "…", R.string.probe_position to "…",
    )

    private val onEnergy = OnCarDataAvailableListener<EnergyLevel> { e ->
        show(
            R.string.probe_battery,
            carContext.getString(R.string.probe_battery_value, value(e.batteryPercent) { format("%.0f %%", it) }, value(e.rangeRemainingMeters, ::km)),
        )
    }
    private val onSpeed = OnCarDataAvailableListener<Speed> { s ->
        show(R.string.probe_speed, value(s.rawSpeedMetersPerSecond) { format("%.0f km/h", it * 3.6f) })
    }
    // Despite its name, the odometer comes in kilometres from Android Auto (the car's own count, seen
    // in a real car on 2026-10-23); the range does come in metres.
    private val onMileage = OnCarDataAvailableListener<Mileage> { m -> show(R.string.probe_odometer, value(m.odometerMeters) { format("%,.0f km", it) }) }
    private val onLocation = OnCarDataAvailableListener<CarHardwareLocation> { l ->
        show(R.string.probe_position, value(l.location) { format("%.5f, %.5f", it.latitude, it.longitude) + if (it.hasAccuracy()) format(" (± %.0f m)", it.accuracy) else "" })
    }

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        info.fetchModel(executor) { m -> show(R.string.probe_model, "${value(m.manufacturer) { it }} ${value(m.name) { it }} ${value(m.year) { "$it" }}") }
        info.fetchEnergyProfile(executor) { p ->
            show(
                R.string.probe_energy,
                carContext.getString(R.string.probe_energy_value, value(p.fuelTypes) { it.joinToString(transform = ::fuel) }, value(p.evConnectorTypes) { it.joinToString(transform = ::plug) }),
            )
        }
        carContext.requestPermissions(PERMISSIONS) { _, rejected ->
            if (rejected.isNotEmpty()) Log.i(TAG, "refused: $rejected")
            runCatching { info.addEnergyLevelListener(executor, onEnergy) }.onFailure { show(R.string.probe_battery, refused(it)) }
            runCatching { info.addSpeedListener(executor, onSpeed) }.onFailure { show(R.string.probe_speed, refused(it)) }
            runCatching { info.addMileageListener(executor, onMileage) }.onFailure { show(R.string.probe_odometer, refused(it)) }
            runCatching { hardware.carSensors.addCarHardwareLocationListener(CarSensors.UPDATE_RATE_NORMAL, executor, onLocation) }
                .onFailure { show(R.string.probe_position, refused(it)) }
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        info.removeEnergyLevelListener(onEnergy)
        info.removeSpeedListener(onSpeed)
        info.removeMileageListener(onMileage)
        hardware.carSensors.removeCarHardwareLocationListener(onLocation)
    }

    private fun show(name: Int, text: String) {
        if (rows[name] == text) return
        rows[name] = text
        Log.i(TAG, "${carContext.getString(name)}: $text")
        invalidate()
    }

    private fun refused(e: Throwable) = carContext.getString(R.string.probe_refused, e.message)

    private fun format(pattern: String, vararg args: Any) = String.format(locale, pattern, *args)

    private fun km(meters: Float) = format("%,.0f km", meters / 1000)

    private fun fuel(type: Int) = if (type == EnergyProfile.FUEL_TYPE_ELECTRIC) carContext.getString(R.string.fuel_electric) else "#$type"

    private fun plug(type: Int) = plugName(type)

    /** "Not provided" (the car does not implement it) and "unavailable" are the answers a probe is for. */
    private fun <T> value(v: CarValue<T>, format: (T) -> String): String = when (v.status) {
        CarValue.STATUS_SUCCESS -> v.value?.let(format) ?: carContext.getString(R.string.value_unknown)
        CarValue.STATUS_UNIMPLEMENTED -> carContext.getString(R.string.value_unimplemented)
        CarValue.STATUS_UNAVAILABLE -> carContext.getString(R.string.value_unavailable)
        else -> carContext.getString(R.string.value_unknown)
    }

    override fun onGetTemplate(): Template {
        val list = ItemList.Builder()
        rows.forEach { (name, text) -> list.addItem(Row.Builder().setTitle(carContext.getString(name)).addText(text).build()) }
        return ListTemplate.Builder().setTitle(carContext.getString(R.string.car)).setHeaderAction(Action.BACK).setSingleList(list.build()).build()
    }

    private companion object {
        const val TAG = "KasbahProbe"
        val PERMISSIONS = listOf(
            "com.google.android.gms.permission.CAR_FUEL",
            "com.google.android.gms.permission.CAR_SPEED",
            "com.google.android.gms.permission.CAR_MILEAGE",
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_FINE_LOCATION,
        )
    }
}

/** A plug's name as the cars' own screens write it (EnergyProfile.EVCONNECTOR_TYPE_*), else its code. */
internal fun plugName(type: Int): String = when (type) {
    EnergyProfile.EVCONNECTOR_TYPE_J1772 -> "Type 1"
    EnergyProfile.EVCONNECTOR_TYPE_MENNEKES -> "Type 2"
    EnergyProfile.EVCONNECTOR_TYPE_CHADEMO -> "CHAdeMO"
    EnergyProfile.EVCONNECTOR_TYPE_COMBO_1 -> "CCS1"
    EnergyProfile.EVCONNECTOR_TYPE_COMBO_2 -> "CCS2"
    else -> "#$type"
}
