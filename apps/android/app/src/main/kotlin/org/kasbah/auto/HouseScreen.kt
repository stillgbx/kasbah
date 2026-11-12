package org.kasbah.auto

import androidx.annotation.DrawableRes
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.annotation.VisibleForTesting
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarIcon
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.Locale

/**
 * The house's state, to read only: one tile per figure, as the home tab's, without any tap. Read again
 * each time the screen is shown. A grid, all of it at a glance: a list hid its end behind the arrows of
 * the car's left edge (seen in a car, 2026-11-12). The car shows two rows of three tiles without
 * scrolling, hence six tiles at most: the robots only come when one is out.
 */
class HouseScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val client = KasbahClient(carContext)
    @VisibleForTesting internal var status: HouseStatus? = null
    @VisibleForTesting internal var error: String? = null

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        Background.run({ client.status() }) { result ->
            result.onSuccess { status = it; error = null }.onFailure { error = it.message }
            invalidate()
        }
    }

    override fun onGetTemplate(): Template {
        val title = carContext.getString(R.string.house)
        error?.let { return MessageTemplate.Builder(it).setTitle(title).setHeaderAction(Action.BACK).build() }
        val grid = GridTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK)
        val s = status ?: return grid.setLoading(true).build()
        val tiles = ItemList.Builder()
        s.insideC?.let { tiles.addItem(tile(R.string.house_inside, String.format(Locale.getDefault(), "%.1f °C", it), R.drawable.ic_thermostat, false)) }
        s.solarW?.let { tiles.addItem(tile(R.string.house_solar, kilowatts(it), R.drawable.ic_solar, it > 0)) }
        s.charger?.let { tiles.addItem(tile(R.string.house_charger, chargerLabel(it, s.chargerW), R.drawable.ic_charger, it == "charging")) }
        tiles.addItem(tile(R.string.house_lights, count(s.lightsOn, R.string.house_lights_none, R.plurals.house_lights_on), R.drawable.ic_light, s.lightsOn > 0))
        s.coversOpen?.let { tiles.addItem(tile(R.string.house_covers, count(it, R.string.house_covers_none, R.plurals.house_covers_open), R.drawable.ic_shutter_open, it > 0)) }
        s.playersOn?.let { tiles.addItem(tile(R.string.house_music, count(it, R.string.house_music_none, R.plurals.house_players_on), R.drawable.ic_music, it > 0)) }
        s.robotsOut?.takeIf { it > 0 }?.let { tiles.addItem(tile(R.string.house_robots, carContext.resources.getQuantityString(R.plurals.house_robots_out, it, it), R.drawable.ic_robot, true)) }
        return grid.setSingleList(tiles.build()).build()
    }

    private fun count(n: Int, @StringRes none: Int, @PluralsRes some: Int) =
        if (n == 0) carContext.getString(none) else carContext.resources.getQuantityString(some, n, n)

    /** A figure's tile: its name, its value, its icon in the accent while something runs. */
    private fun tile(@StringRes title: Int, value: String, @DrawableRes icon: Int, active: Boolean) =
        GridItem.Builder()
            .setTitle(carContext.getString(title))
            .setText(value)
            .setImage(CarIcon.Builder(IconCompat.createWithResource(carContext, icon)).apply { if (active) setTint(ACCENT) }.build())
            .build()

    private fun kilowatts(w: Double) = String.format(Locale.getDefault(), "%.1f kW", w / 1000)

    private fun chargerLabel(status: String, w: Double?) = when (status) {
        "charging" -> carContext.getString(R.string.charger_charging, kilowatts(w ?: 0.0))
        "connected" -> carContext.getString(R.string.charger_connected)
        "finished" -> carContext.getString(R.string.charger_finished)
        "error" -> carContext.getString(R.string.charger_error)
        else -> carContext.getString(R.string.charger_free)
    }
}
