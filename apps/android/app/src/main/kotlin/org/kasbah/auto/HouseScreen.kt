package org.kasbah.auto

import androidx.annotation.StringRes
import androidx.annotation.VisibleForTesting
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarIcon
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.Locale

/**
 * The house's state, to read only: a few figures and a camera's last still beside them. Read again each
 * time the screen is shown.
 */
class HouseScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val client = KasbahClient(carContext)
    @VisibleForTesting internal var status: HouseStatus? = null
    private var still: IconCompat? = null
    @VisibleForTesting internal var error: String? = null

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        Background.run({
            val s = client.status()
            // No still (none taken yet, a camera without one): the pane goes without an image.
            s to s.camera?.let { id -> runCatching { stillIcon(client.snapshot(id)) }.getOrNull() }
        }) { result ->
            result.onSuccess { (s, image) -> status = s; still = image; error = null }.onFailure { error = it.message }
            invalidate()
        }
    }

    override fun onGetTemplate(): Template {
        val title = carContext.getString(R.string.house)
        error?.let { return MessageTemplate.Builder(it).setTitle(title).setHeaderAction(Action.BACK).build() }
        val s = status ?: return PaneTemplate.Builder(Pane.Builder().setLoading(true).build()).setTitle(title).setHeaderAction(Action.BACK).build()
        val pane = Pane.Builder()
        s.insideC?.let { pane.addRow(figure(R.string.house_inside, String.format(Locale.getDefault(), "%.1f °C", it))) }
        s.solarW?.let { pane.addRow(figure(R.string.house_solar, kilowatts(it))) }
        s.charger?.let { pane.addRow(figure(R.string.house_charger, chargerLabel(it, s.chargerW))) }
        pane.addRow(
            figure(
                R.string.house_lights,
                if (s.lightsOn == 0) carContext.getString(R.string.house_lights_none)
                else carContext.resources.getQuantityString(R.plurals.house_lights_on, s.lightsOn, s.lightsOn),
            ),
        )
        still?.let { pane.setImage(CarIcon.Builder(it).build()) }
        return PaneTemplate.Builder(pane.build()).setTitle(title).setHeaderAction(Action.BACK).build()
    }

    private fun figure(@StringRes title: Int, value: String) = Row.Builder().setTitle(carContext.getString(title)).addText(value).build()

    private fun kilowatts(w: Double) = String.format(Locale.getDefault(), "%.1f kW", w / 1000)

    private fun chargerLabel(status: String, w: Double?) = when (status) {
        "charging" -> carContext.getString(R.string.charger_charging, kilowatts(w ?: 0.0))
        "connected" -> carContext.getString(R.string.charger_connected)
        "finished" -> carContext.getString(R.string.charger_finished)
        "error" -> carContext.getString(R.string.charger_error)
        else -> carContext.getString(R.string.charger_free)
    }
}
