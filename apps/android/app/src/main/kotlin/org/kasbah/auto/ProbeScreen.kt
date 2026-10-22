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
    private val rows = linkedMapOf(
        "Modèle" to "…", "Énergie" to "…", "Batterie" to "…", "Vitesse" to "…", "Compteur" to "…",
    )

    private val onEnergy = OnCarDataAvailableListener<EnergyLevel> { e ->
        show("Batterie", "${value(e.batteryPercent)} %, autonomie ${value(e.rangeRemainingMeters)} m")
    }
    private val onSpeed = OnCarDataAvailableListener<Speed> { s -> show("Vitesse", "${value(s.rawSpeedMetersPerSecond)} m/s") }
    private val onMileage = OnCarDataAvailableListener<Mileage> { m -> show("Compteur", "${value(m.odometerMeters)} m") }

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        info.fetchModel(executor) { m -> show("Modèle", "${value(m.manufacturer)} ${value(m.name)} ${value(m.year)}") }
        info.fetchEnergyProfile(executor) { p ->
            show("Énergie", "types ${value(p.fuelTypes)}, prises ${value(p.evConnectorTypes)}")
        }
        carContext.requestPermissions(PERMISSIONS) { _, rejected ->
            if (rejected.isNotEmpty()) Log.i(TAG, "refused: $rejected")
            runCatching { info.addEnergyLevelListener(executor, onEnergy) }.onFailure { show("Batterie", "refusé (${it.message})") }
            runCatching { info.addSpeedListener(executor, onSpeed) }.onFailure { show("Vitesse", "refusé (${it.message})") }
            runCatching { info.addMileageListener(executor, onMileage) }.onFailure { show("Compteur", "refusé (${it.message})") }
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        info.removeEnergyLevelListener(onEnergy)
        info.removeSpeedListener(onSpeed)
        info.removeMileageListener(onMileage)
    }

    private fun show(name: String, text: String) {
        if (rows[name] == text) return
        rows[name] = text
        Log.i(TAG, "$name: $text")
        invalidate()
    }

    override fun onGetTemplate(): Template {
        val list = ItemList.Builder()
        rows.forEach { (name, text) -> list.addItem(Row.Builder().setTitle(name).addText(text).build()) }
        return ListTemplate.Builder().setTitle("Voiture").setHeaderAction(Action.BACK).setSingleList(list.build()).build()
    }

    private companion object {
        const val TAG = "KasbahProbe"
        val PERMISSIONS = listOf(
            "com.google.android.gms.permission.CAR_FUEL",
            "com.google.android.gms.permission.CAR_SPEED",
            "com.google.android.gms.permission.CAR_MILEAGE",
        )

        /** "non fourni" (the car does not implement it) and "indisponible" are the answers a probe is for. */
        fun <T> value(v: CarValue<T>): String = when (v.status) {
            CarValue.STATUS_SUCCESS -> v.value.toString()
            CarValue.STATUS_UNIMPLEMENTED -> "non fourni"
            CarValue.STATUS_UNAVAILABLE -> "indisponible"
            else -> "inconnu"
        }
    }
}
