package org.kasbah.auto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.annotation.VisibleForTesting
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarIcon
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.text.DateFormat
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.Date
import kotlin.math.min

/**
 * The cameras, one tile each with its last still, to read only: no video in the car, and no fresh still
 * asked for (the vendor counts each stream opened). A tap shows the still large, with its time.
 */
class CamerasScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val client = KasbahClient(carContext)
    @VisibleForTesting internal var cameras: List<Camera>? = null
    @VisibleForTesting internal var thumbs: Map<String, IconCompat> = emptyMap()
    @VisibleForTesting internal var error: String? = null

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        Background.run({
            val list = client.cameras().take(MAX_CAMERAS)
            // A camera without a still (none taken yet, a vendor that takes none) keeps the icon.
            list to list.mapNotNull { c -> runCatching { thumbIcon(client.still(c.id).jpeg) }.getOrNull()?.let { c.id to it } }.toMap()
        }) { result ->
            result.onSuccess { (list, images) -> cameras = list; thumbs = images; error = null }.onFailure { error = it.message }
            invalidate()
        }
    }

    override fun onGetTemplate(): Template {
        val title = carContext.getString(R.string.cameras)
        error?.let { return MessageTemplate.Builder(it).setTitle(title).setHeaderAction(Action.BACK).build() }
        val list = cameras ?: return GridTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK).setLoading(true).build()
        if (list.isEmpty()) return MessageTemplate.Builder(carContext.getString(R.string.no_cameras)).setTitle(title).setHeaderAction(Action.BACK).build()
        val items = ItemList.Builder()
        for (c in list) {
            val thumb = thumbs[c.id]
            items.addItem(
                GridItem.Builder()
                    .setTitle(c.name)
                    .setImage(
                        if (thumb != null) CarIcon.Builder(thumb).build()
                        else CarIcon.Builder(IconCompat.createWithResource(carContext, R.drawable.ic_camera)).apply { if (!c.available) setTint(MUTED) }.build(),
                        if (thumb != null) GridItem.IMAGE_TYPE_LARGE else GridItem.IMAGE_TYPE_ICON,
                    )
                    .setOnClickListener { screenManager.push(CameraScreen(carContext, c)) }
                    .build(),
            )
        }
        return GridTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK).setSingleList(items.build()).build()
    }

    private companion object {
        /** Every still crosses to the car in one transaction, whose size is bounded. */
        const val MAX_CAMERAS = 8
    }
}

/** One camera's last still, large, with the time it was taken; read again on "Refresh". */
class CameraScreen(carContext: CarContext, private val camera: Camera) : Screen(carContext), DefaultLifecycleObserver {
    private val client = KasbahClient(carContext)
    @VisibleForTesting internal var image: IconCompat? = null
    @VisibleForTesting internal var at: Long? = null
    @VisibleForTesting internal var loaded = false

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) = load()

    private fun load() {
        Background.run({ client.still(camera.id) }) { result ->
            result.onSuccess { image = stillIcon(it.jpeg); at = it.at }.onFailure { image = null; at = null }
            loaded = true
            invalidate()
        }
    }

    override fun onGetTemplate(): Template {
        if (!loaded) return PaneTemplate.Builder(Pane.Builder().setLoading(true).build()).setTitle(camera.name).setHeaderAction(Action.BACK).build()
        val taken = at?.let(::takenLabel)
        val pane = Pane.Builder()
            .addRow(Row.Builder().setTitle(if (image == null) carContext.getString(R.string.camera_no_still) else taken ?: carContext.getString(R.string.camera_still)).build())
            .addAction(Action.Builder().setTitle(carContext.getString(R.string.refresh)).setOnClickListener(::load).build())
        image?.let { pane.setImage(CarIcon.Builder(it).build()) }
        return PaneTemplate.Builder(pane.build()).setTitle(camera.name).setHeaderAction(Action.BACK).build()
    }

    /**
     * When the still was taken, with its day as soon as it is not today's: no fresh still is asked for,
     * so the last one can be a day old ("19:07" read at 18:01 meant yesterday, on the real house).
     */
    private fun takenLabel(at: Long): String {
        val time = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at))
        return when (daysAgo(at, System.currentTimeMillis())) {
            in Long.MIN_VALUE..0L -> carContext.getString(R.string.camera_still_at, time)
            1L -> carContext.getString(R.string.camera_still_yesterday, time)
            else -> carContext.getString(R.string.camera_still_on, DateFormat.getDateInstance(DateFormat.SHORT).format(Date(at)), time)
        }
    }
}

/** How many calendar days before `now` the instant `at` falls, in the phone's time zone. */
internal fun daysAgo(at: Long, now: Long, zone: ZoneId = ZoneId.systemDefault()): Long =
    ChronoUnit.DAYS.between(Instant.ofEpochMilli(at).atZone(zone).toLocalDate(), Instant.ofEpochMilli(now).atZone(zone).toLocalDate())

/**
 * A camera still, shrunk: the template crosses to Android Auto in a binder transaction, which a full
 * frame would overflow.
 */
internal fun stillIcon(jpeg: ByteArray): IconCompat? {
    val full = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return null
    val width = 480
    return IconCompat.createWithBitmap(Bitmap.createScaledBitmap(full, width, full.height * width / full.width, true))
}

/** A still cropped to its centre square and shrunk, for a grid tile (square). */
internal fun thumbIcon(jpeg: ByteArray): IconCompat? {
    val full = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return null
    val side = min(full.width, full.height)
    val square = Bitmap.createBitmap(full, (full.width - side) / 2, (full.height - side) / 2, side, side)
    return IconCompat.createWithBitmap(Bitmap.createScaledBitmap(square, 160, 160, true))
}
