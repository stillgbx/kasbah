package org.kasbah.auto

import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.hardware.CarHardwareManager
import androidx.car.app.hardware.common.CarValue
import androidx.car.app.hardware.common.OnCarDataAvailableListener
import androidx.car.app.hardware.info.EnergyLevel
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
 * What Android Auto tells about the car, shown as it is and logged under the `KasbahProbe` tag
 * (`adb logcat -s KasbahProbe`). A probe: it says which values this car provides at all.
 */
class ProbeScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val info = carContext.getCarService(CarHardwareManager::class.java).carInfo
    private val executor = carContext.mainExecutor
    // Row titles by string resource, in display order.
    private val rows = linkedMapOf(
        R.string.probe_model to "…", R.string.probe_energy to "…", R.string.probe_battery to "…",
        R.string.probe_speed to "…", R.string.probe_odometer to "…",
    )

    private val onEnergy = OnCarDataAvailableListener<EnergyLevel> { e ->
        show(R.string.probe_battery, carContext.getString(R.string.probe_battery_value, value(e.batteryPercent), value(e.rangeRemainingMeters)))
    }
    private val onSpeed = OnCarDataAvailableListener<Speed> { s -> show(R.string.probe_speed, "${value(s.rawSpeedMetersPerSecond)} m/s") }
    private val onMileage = OnCarDataAvailableListener<Mileage> { m -> show(R.string.probe_odometer, "${value(m.odometerMeters)} m") }

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        info.fetchModel(executor) { m -> show(R.string.probe_model, "${value(m.manufacturer)} ${value(m.name)} ${value(m.year)}") }
        info.fetchEnergyProfile(executor) { p ->
            show(R.string.probe_energy, carContext.getString(R.string.probe_energy_value, value(p.fuelTypes), value(p.evConnectorTypes)))
        }
        carContext.requestPermissions(PERMISSIONS) { _, rejected ->
            if (rejected.isNotEmpty()) Log.i(TAG, "refused: $rejected")
            runCatching { info.addEnergyLevelListener(executor, onEnergy) }.onFailure { show(R.string.probe_battery, refused(it)) }
            runCatching { info.addSpeedListener(executor, onSpeed) }.onFailure { show(R.string.probe_speed, refused(it)) }
            runCatching { info.addMileageListener(executor, onMileage) }.onFailure { show(R.string.probe_odometer, refused(it)) }
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        info.removeEnergyLevelListener(onEnergy)
        info.removeSpeedListener(onSpeed)
        info.removeMileageListener(onMileage)
    }

    private fun show(name: Int, text: String) {
        if (rows[name] == text) return
        rows[name] = text
        Log.i(TAG, "${carContext.getString(name)}: $text")
        invalidate()
    }

    private fun refused(e: Throwable) = carContext.getString(R.string.probe_refused, e.message)

    /** "Not provided" (the car does not implement it) and "unavailable" are the answers a probe is for. */
    private fun <T> value(v: CarValue<T>): String = when (v.status) {
        CarValue.STATUS_SUCCESS -> v.value.toString()
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
        )
    }
}
