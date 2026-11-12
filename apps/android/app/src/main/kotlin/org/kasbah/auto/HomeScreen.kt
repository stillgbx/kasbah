package org.kasbah.auto

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.annotation.VisibleForTesting
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.GridItem
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.SectionedItemList
import androidx.car.app.model.Tab
import androidx.car.app.model.TabContents
import androidx.car.app.model.TabTemplate
import androidx.car.app.model.Template
import androidx.car.app.model.Toggle
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import org.json.JSONObject
import java.text.Normalizer

/**
 * The car's home on a host that has tabs (Car App API 6): the home tab (gate and garage doors, and two
 * tiles that only read: the car, the house), the lights (each room's scenes and a switch per lamp), the
 * covers by room, and talking. Each tab reads its data when it is shown.
 */
class HomeScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val client = KasbahClient(carContext)
    private val handler = Handler(Looper.getMainLooper())
    @VisibleForTesting internal var tab = TAB_HOME
    @VisibleForTesting internal var accesses: List<Access>? = null
    @VisibleForTesting internal var lights: List<Light>? = null
    @VisibleForTesting internal var scenes: List<Scene>? = null
    @VisibleForTesting internal var covers: List<Access>? = null
    @VisibleForTesting internal var error: String? = null

    init {
        lifecycle.addObserver(this)
    }

    // Also called when coming back from another screen: the state shown is the one after the command.
    override fun onStart(owner: LifecycleOwner) = refresh()

    override fun onStop(owner: LifecycleOwner) = handler.removeCallbacksAndMessages(null)

    private fun select(id: String) {
        tab = id
        error = null
        invalidate()
        refresh()
        // Choosing the tab is asking to talk: listening starts at once, as from the microphone of old.
        if (id == TAB_TALK) screenManager.push(VoiceScreen(carContext))
    }

    private fun refresh() {
        handler.removeCallbacksAndMessages(null)
        when (tab) {
            TAB_LIGHTS -> load({ client.lights() to client.scenes() }) { (l, s) -> lights = l; scenes = s }
            TAB_COVERS -> load({ client.covers() }) { covers = it; followMotion(it) }
            TAB_TALK -> Unit
            else -> load({ client.accesses() }) { accesses = it; followMotion(it) }
        }
    }

    /** A cover on the move: look again until it stops. */
    private fun followMotion(list: List<Access>) {
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) && list.any { it.motion == "opening" || it.motion == "closing" }) {
            handler.postDelayed(::refresh, 3_000)
        }
    }

    /**
     * Reads off the main thread; a result that comes back once the driver has changed tab is dropped. The
     * screen is drawn again only when what it shows has changed: the host lays a template out anew each
     * time, and the home grid jumped when the same tiles came back (seen in a car, 2026-11-12).
     */
    private fun <T> load(work: () -> T, done: (T) -> Unit) {
        val shown = tab
        Background.run(work) { result ->
            if (tab != shown) return@run
            val before = listOf(accesses, lights, scenes, covers, error)
            result.onSuccess { error = null; done(it) }.onFailure { error = it.message }
            if (listOf(accesses, lights, scenes, covers, error) != before) invalidate()
        }
    }

    override fun onGetTemplate(): Template {
        val content = when (tab) {
            TAB_LIGHTS -> lightsTemplate()
            TAB_COVERS -> coversTemplate()
            TAB_TALK -> talkTemplate()
            else -> accessTemplate(this, accesses, error, ::refresh, readingTiles())
        }
        // Four tabs at most: the library refuses more ("There cannot be more than 4 tabs added", tried
        // with six in the DHU, 2026-11-12). Inside a tab the host hides the grid's action strip
        // (microphone, "Car"): talking has its own tab, the car its tile.
        return TabTemplate.Builder(object : TabTemplate.TabCallback {
            override fun onTabSelected(tabContentId: String) = select(tabContentId)
        })
            .setHeaderAction(Action.APP_ICON)
            .addTab(tab(TAB_HOME, R.string.tab_home, R.drawable.ic_star))
            .addTab(tab(TAB_LIGHTS, R.string.tab_lights, R.drawable.ic_light))
            .addTab(tab(TAB_COVERS, R.string.tab_covers, R.drawable.ic_shutter))
            .addTab(tab(TAB_TALK, R.string.tab_talk, R.drawable.ic_mic))
            .setTabContents(TabContents.Builder(content).build())
            .setActiveTabContentId(tab)
            .build()
    }

    private fun tab(id: String, @StringRes title: Int, @DrawableRes icon: Int) =
        Tab.Builder().setContentId(id).setTitle(carContext.getString(title)).setIcon(icon(icon)).build()

    private fun icon(@DrawableRes res: Int, tint: CarColor? = null) =
        CarIcon.Builder(IconCompat.createWithResource(carContext, res)).apply { tint?.let(::setTint) }.build()

    private fun failed(message: String) =
        MessageTemplate.Builder(message).addAction(Action.Builder().setTitle(carContext.getString(R.string.refresh)).setOnClickListener(::refresh).build()).build()

    /**
     * After the gate and the garage doors, tiles that only read: what the car sends, the house's state,
     * the cameras' last stills.
     */
    private fun readingTiles() = listOf(
        GridItem.Builder().setTitle(carContext.getString(R.string.car)).setImage(icon(R.drawable.ic_vehicle))
            .setOnClickListener { screenManager.push(ProbeScreen(carContext)) }.build(),
        GridItem.Builder().setTitle(carContext.getString(R.string.house)).setImage(icon(R.drawable.ic_home))
            .setOnClickListener { screenManager.push(HouseScreen(carContext)) }.build(),
        GridItem.Builder().setTitle(carContext.getString(R.string.cameras)).setImage(icon(R.drawable.ic_camera))
            .setOnClickListener { screenManager.push(CamerasScreen(carContext)) }.build(),
    )

    /**
     * One section per room: its scenes first, a tap recalls one, then a switch per lamp. One tap turns a
     * lamp on or off, nothing else to confirm.
     */
    private fun lightsTemplate(): Template {
        error?.let { return failed(it) }
        val list = lights ?: return ListTemplate.Builder().setLoading(true).build()
        val all = scenes.orEmpty()
        if (list.isEmpty() && all.isEmpty()) return MessageTemplate.Builder(carContext.getString(R.string.no_lights)).build()
        val builder = ListTemplate.Builder()
        for (section in roomSections(list, all, carContext.getString(R.string.lights_elsewhere))) {
            val items = ItemList.Builder()
            for (s in section.scenes) {
                items.addItem(
                    Row.Builder()
                        .setTitle(s.name)
                        .apply { if (s.active) addText(carContext.getString(R.string.scene_active)) }
                        .setImage(if (s.swatches.isEmpty()) icon(R.drawable.ic_sparkle) else CarIcon.Builder(swatchIcon(s.swatches)).build())
                        .setOnClickListener { recall(s) }
                        .build(),
                )
            }
            for (l in section.lights) {
                items.addItem(
                    Row.Builder()
                        .setTitle(l.name)
                        .setImage(icon(R.drawable.ic_light, if (!l.available) MUTED else if (l.on) ACCENT else CarColor.DEFAULT))
                        .setToggle(Toggle.Builder { on -> switch(l, on) }.setChecked(l.on).setEnabled(l.available).build())
                        .build(),
                )
            }
            builder.addSectionedList(SectionedItemList.create(items.build(), section.name))
        }
        return builder.build()
    }

    private fun switch(light: Light, on: Boolean) {
        lights = lights?.map { if (it.id == light.id) it.copy(on = on) else it }
        Background.run({ client.command(light.id, "light.set", JSONObject().put("on", on)) }) { result ->
            result.onFailure { CarToast.makeText(carContext, it.message ?: carContext.getString(R.string.command_failed), CarToast.LENGTH_LONG).show() }
            refresh()
        }
    }

    private fun recall(scene: Scene) {
        Background.run({ client.recall(scene.id) }) { result ->
            result.onSuccess { CarToast.makeText(carContext, carContext.getString(R.string.scene_recalled, scene.name), CarToast.LENGTH_SHORT).show() }
                .onFailure { CarToast.makeText(carContext, it.message ?: carContext.getString(R.string.command_failed), CarToast.LENGTH_LONG).show() }
            refresh()
        }
    }

    /**
     * The shutters, blinds and windows by room, with their state. A tap opens the action screen, as for
     * the gate: a single tap on a tab never moves anything.
     */
    private fun coversTemplate(): Template {
        error?.let { return failed(it) }
        val list = covers ?: return ListTemplate.Builder().setLoading(true).build()
        if (list.isEmpty()) return MessageTemplate.Builder(carContext.getString(R.string.no_covers)).build()
        val builder = ListTemplate.Builder()
        for ((room, inRoom) in byRoom(list, { it.room }, carContext.getString(R.string.lights_elsewhere))) {
            val items = ItemList.Builder()
            for (c in inRoom) {
                items.addItem(
                    Row.Builder()
                        .setTitle(c.name)
                        .addText(stateLabel(carContext, c))
                        .setImage(icon(if ((c.position ?: 0) > 50) R.drawable.ic_shutter_open else R.drawable.ic_shutter, tint(c)))
                        .setOnClickListener { screenManager.push(AccessActionScreen(carContext, c)) }
                        .build(),
                )
            }
            builder.addSectionedList(SectionedItemList.create(items.build(), room))
        }
        return builder.build()
    }

    /** What remains when the tab is shown again after talking: one button to talk again. */
    private fun talkTemplate(): Template =
        MessageTemplate.Builder(carContext.getString(R.string.talk_prompt))
            .addAction(
                Action.Builder().setTitle(carContext.getString(R.string.talk)).setBackgroundColor(ACCENT).setFlags(Action.FLAG_PRIMARY)
                    .setOnClickListener { screenManager.push(VoiceScreen(carContext)) }.build(),
            )
            .build()

    companion object {
        const val TAB_HOME = "home"
        const val TAB_LIGHTS = "lights"
        const val TAB_COVERS = "covers"
        const val TAB_TALK = "talk"
    }
}

/** Items by room, in the order the rooms first appear; those of no room last, under `elsewhere`. */
internal fun <T> byRoom(items: List<T>, room: (T) -> String?, elsewhere: String): List<Pair<String, List<T>>> {
    val grouped = items.groupBy(room)
    return grouped.filterKeys { it != null }.map { (r, l) -> r!! to l } + listOfNotNull(grouped[null]?.let { elsewhere to it })
}

/** A room of the lights tab: its scenes, then its lamps. */
internal data class RoomSection(val name: String, val scenes: List<Scene>, val lights: List<Light>)

/**
 * The lamps by room, in the order the rooms first appear, each with the scenes of its name (compared
 * without case, accents or punctuation, as the web app relates a vendor's room to the house's). A scene
 * group with no lamp in the house (a vendor zone such as "Extérieur") gets its own section after the
 * rooms; the lamps of no room and the scenes of no group come last, under `elsewhere`.
 */
internal fun roomSections(lights: List<Light>, scenes: List<Scene>, elsewhere: String): List<RoomSection> {
    val byRoom = lights.groupBy { it.room }
    val scenesByKey = scenes.filter { it.group != null }.groupBy { roomKey(it.group!!) }
    val rooms = byRoom.keys.filterNotNull()
    val roomKeys = rooms.map(::roomKey).toSet()
    val sections = rooms.map { RoomSection(it, scenesByKey[roomKey(it)].orEmpty(), byRoom[it]!!) } +
        scenesByKey.filterKeys { it !in roomKeys }.values.map { RoomSection(it.first().group!!, it, emptyList()) }
    val loose = RoomSection(elsewhere, scenes.filter { it.group == null }, byRoom[null].orEmpty())
    return sections + listOfNotNull(loose.takeIf { it.scenes.isNotEmpty() || it.lights.isNotEmpty() })
}

private fun roomKey(name: String) =
    Normalizer.normalize(name, Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").lowercase().replace(Regex("[^a-z0-9]"), "")

/** A disc split between the scene's first two colors, as the web app's scene swatches. */
private fun swatchIcon(colors: List<Int>): IconCompat {
    val size = 128
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val oval = RectF(8f, 8f, size - 8f, size - 8f)
    paint.color = colors[0]
    canvas.drawArc(oval, 90f, 180f, true, paint)
    paint.color = colors.getOrElse(1) { colors[0] }
    canvas.drawArc(oval, 270f, 180f, true, paint)
    return IconCompat.createWithBitmap(bitmap)
}
