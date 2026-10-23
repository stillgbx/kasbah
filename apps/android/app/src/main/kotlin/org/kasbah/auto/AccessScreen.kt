package org.kasbah.auto

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import androidx.annotation.VisibleForTesting
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

/** The car's home screen: one tile per gate and garage door, with its state. */
class AccessScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val client = KasbahClient(carContext)
    private val handler = Handler(Looper.getMainLooper())
    @VisibleForTesting internal var accesses: List<Access>? = null
    @VisibleForTesting internal var error: String? = null

    init {
        lifecycle.addObserver(this)
    }

    // Also called when coming back from the action screen: the state shown is the one after the command.
    override fun onStart(owner: LifecycleOwner) = refresh()

    override fun onStop(owner: LifecycleOwner) = handler.removeCallbacksAndMessages(null)

    private fun refresh() {
        handler.removeCallbacksAndMessages(null)
        Background.run({ client.accesses() }) { result ->
            result.onSuccess { accesses = it; error = null }.onFailure { error = it.message }
            // A door on the move: look again until it stops.
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) && accesses.orEmpty().any { it.motion == "opening" || it.motion == "closing" }) {
                handler.postDelayed(::refresh, 3_000)
            }
            invalidate()
        }
    }

    // Titles, header actions and action strips use the deprecated builders: the `Header` that replaces
    // them needs a recent Android Auto host, these work on every one.
    override fun onGetTemplate(): Template {
        val retry = Action.Builder().setTitle(carContext.getString(R.string.refresh)).setOnClickListener(::refresh).build()
        error?.let {
            return MessageTemplate.Builder(it).setTitle("Kasbah").setHeaderAction(Action.APP_ICON).addAction(retry).build()
        }
        val list = accesses
        if (list != null && list.isEmpty()) {
            return MessageTemplate.Builder(carContext.getString(R.string.no_access))
                .setTitle("Kasbah").setHeaderAction(Action.APP_ICON).addAction(retry).build()
        }
        // A strip takes a single action with a text title, the microphone is an icon: the grid reloads on
        // its own (on return, while a door moves), so there is no refresh.
        val mic = CarIcon.Builder(IconCompat.createWithResource(carContext, R.drawable.ic_mic)).build()
        val builder = GridTemplate.Builder()
            .setTitle("Kasbah")
            .setHeaderAction(Action.APP_ICON)
            .setActionStrip(
                ActionStrip.Builder()
                    .addAction(Action.Builder().setIcon(mic).setOnClickListener { screenManager.push(VoiceScreen(carContext)) }.build())
                    .addAction(Action.Builder().setTitle(carContext.getString(R.string.car)).setOnClickListener { screenManager.push(ProbeScreen(carContext)) }.build())
                    .build(),
            )
        if (list == null) return builder.setLoading(true).build()
        val items = ItemList.Builder()
        for (a in list) {
            items.addItem(
                GridItem.Builder()
                    .setTitle(a.label)
                    .setText(stateLabel(carContext, a))
                    .setImage(CarIcon.Builder(accessIcon(carContext, a)).setTint(tint(a)).build())
                    .setOnClickListener { screenManager.push(AccessActionScreen(carContext, a)) }
                    .build(),
            )
        }
        return builder.setSingleList(items.build()).build()
    }
}

/**
 * The access's glyph, open past half way as the web app's cover icon (apps/web/src/lib/deviceIcons.ts);
 * one glyph per class, which the web app does not have: read at a glance while driving. With several
 * of a kind, its number in a disc at the bottom right, the glyph shrunk to leave it room. The digit is
 * cut out of the disc: the car's tint colors the whole icon, one color, as with the plain glyphs.
 */
@VisibleForTesting
internal fun accessIcon(context: Context, a: Access): IconCompat {
    val open = (a.position ?: 0) > 50
    val glyph = when {
        a.deviceClass == "garage" -> if (open) R.drawable.ic_garage_open else R.drawable.ic_garage
        else -> if (open) R.drawable.ic_gate_open else R.drawable.ic_gate
    }
    val number = a.number ?: return IconCompat.createWithResource(context, glyph)
    val size = 192
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    context.getDrawable(glyph)!!.apply { setBounds(0, 0, size * 4 / 5, size * 4 / 5) }.draw(canvas)
    val r = size * 0.24f
    val (cx, cy) = size - r to size - r
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    // A gap around the disc, so the glyph's strokes never touch it.
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    canvas.drawCircle(cx, cy, r + size * 0.05f, paint)
    paint.xfermode = null
    paint.color = Color.WHITE
    canvas.drawCircle(cx, cy, r, paint)
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    paint.typeface = Typeface.DEFAULT_BOLD
    paint.textSize = r * 1.45f
    paint.textAlign = Paint.Align.CENTER
    canvas.drawText("$number", cx, cy - (paint.descent() + paint.ascent()) / 2, paint)
    return IconCompat.createWithBitmap(bitmap)
}

/**
 * The state read before the text: open in Kasbah's accent, moving in the logo's copper, offline in the
 * web app's muted grey (day, night), closed or unknown in the car's own color.
 */
private fun tint(a: Access): CarColor = when {
    !a.available -> MUTED
    a.motion == "opening" || a.motion == "closing" -> COPPER
    (a.position ?: 0) > 0 -> ACCENT
    else -> CarColor.DEFAULT
}

// The web app's dark-theme colors, day and night alike: Android Auto keeps a dark background in day
// mode too. With the day teal (#1f6f78), icons were hard to read and the primary button fell back to
// Android Auto's own blue (a color without enough contrast is replaced); the light teal is honored by
// both (seen in the DHU, 2026-10-22).
private val ACCENT = CarColor.createCustom(0xFF4FB3BD.toInt(), 0xFF4FB3BD.toInt())
private val COPPER = CarColor.createCustom(0xFFE0AA70.toInt(), 0xFFE0AA70.toInt())
private val MUTED = CarColor.createCustom(0xFF8D9AB0.toInt(), 0xFF8D9AB0.toInt())

/**
 * Open, close or stop one access. Choosing the tile then the action is the confirmation: a single tap on
 * the home screen never moves anything.
 */
class AccessActionScreen(carContext: CarContext, private val access: Access) : Screen(carContext) {
    private val client = KasbahClient(carContext)

    override fun onGetTemplate(): Template =
        MessageTemplate.Builder(stateLabel(carContext, access))
            .setTitle(access.label)
            .setHeaderAction(Action.BACK)
            .addAction(button(R.string.open, "cover.open", primary = true))
            .addAction(button(R.string.close, "cover.close"))
            .setActionStrip(ActionStrip.Builder().addAction(button(R.string.stop, "cover.stop")).build())
            .build()

    /** The primary action, filled with Kasbah's accent as the web app's main buttons. */
    private fun button(title: Int, type: String, primary: Boolean = false) =
        Action.Builder().setTitle(carContext.getString(title)).setOnClickListener { send(carContext.getString(title), type) }
            .apply { if (primary) setBackgroundColor(ACCENT).setFlags(Action.FLAG_PRIMARY) }
            .build()

    private fun send(title: String, type: String) {
        Background.run({ client.command(access.id, type) }) { result ->
            result.onSuccess {
                CarToast.makeText(carContext, carContext.getString(R.string.command_sent, access.label, title), CarToast.LENGTH_SHORT).show()
                screenManager.pop()
            }.onFailure {
                CarToast.makeText(carContext, it.message ?: carContext.getString(R.string.command_failed), CarToast.LENGTH_LONG).show()
            }
        }
    }
}
