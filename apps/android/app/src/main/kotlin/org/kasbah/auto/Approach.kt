package org.kasbah.auto

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import androidx.car.app.connection.CarConnection
import androidx.car.app.notification.CarAppExtender
import androidx.car.app.notification.CarNotificationManager
import androidx.car.app.notification.CarPendingIntent
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Observer
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * "Open the gate" on the car screen as the car nears the house, without opening the app: a geofence
 * around the house's origin wakes the app, which shows a notification Android Auto draws over the map,
 * one action per gate or garage door (two at most), each sending `cover.open`.
 */
object Approach {
    /** Metres around the house's origin: about 30 s ahead at 50 km/h. */
    const val RADIUS = 400f
    internal const val ACTION_OPEN = "org.kasbah.auto.OPEN"
    internal const val EXTRA_ID = "id"
    internal const val EXTRA_NAME = "name"
    private const val FENCE = "home"
    private const val CHANNEL = "approach"
    private const val NOTIFICATION = 1
    internal const val TAG = "KasbahApproach"

    /** Location at all times: a geofence only wakes an app allowed the background location. */
    fun allowed(context: Context) = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        .all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    /** (Re)places the geofence: after sign-in, at each opening of the app, after a reboot or an update. */
    @SuppressLint("MissingPermission")
    fun register(context: Context) {
        val home = KasbahClient(context).home ?: return
        if (!allowed(context)) {
            Log.i(TAG, "location at all times not allowed: no geofence")
            return
        }
        val fence = Geofence.Builder()
            .setRequestId(FENCE)
            .setCircularRegion(home.lat, home.lon, RADIUS)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()
        // No initial trigger: the phone is usually at home when the fence is placed.
        val request = GeofencingRequest.Builder().setInitialTrigger(0).addGeofence(fence).build()
        LocationServices.getGeofencingClient(context).addGeofences(request, fenceIntent(context))
            .addOnSuccessListener { Log.i(TAG, "geofence placed, ${RADIUS.toInt()} m") }
            .addOnFailureListener { Log.w(TAG, "geofence refused", it) }
    }

    fun unregister(context: Context) {
        LocationServices.getGeofencingClient(context).removeGeofences(fenceIntent(context))
        cancel(context)
    }

    // Mutable: Play services adds the geofence event to it.
    private fun fenceIntent(context: Context) = PendingIntent.getBroadcast(
        context, 0, Intent(context, ApproachReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )

    private fun openIntent(context: Context, a: Access) = PendingIntent.getBroadcast(
        context, a.id.hashCode(),
        Intent(context, ApproachReceiver::class.java).setAction(ACTION_OPEN).putExtra(EXTRA_ID, a.id).putExtra(EXTRA_NAME, a.label),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /**
     * The car has just entered the circle: the alert, if the phone is projected (on foot or by bike it
     * is not) and the server answers. Called on the main thread; `finish` once done.
     */
    internal fun arrive(context: Context, finish: () -> Unit) {
        inCar(context) { car ->
            if (!car) {
                Log.i(TAG, "not in the car: no alert")
                finish()
                return@inCar
            }
            val client = KasbahClient(context)
            Background.run({ client.accesses().filter { it.available } }) { result ->
                result.onSuccess { if (it.isNotEmpty()) notifyArrival(context, it, client.alert) }
                    .onFailure { Log.w(TAG, "accesses not read", it) }
                finish()
            }
        }
    }

    /** Whether Android Auto projects the phone right now; the answer comes once, on the main thread. */
    private fun inCar(context: Context, then: (Boolean) -> Unit) {
        val type = CarConnection(context).type
        type.observeForever(object : Observer<Int> {
            override fun onChanged(value: Int) {
                type.removeObserver(this)
                then(value == CarConnection.CONNECTION_TYPE_PROJECTION)
            }
        })
    }

    /**
     * The heads-up over the map: each access's state, an "Open" button for the two chosen on the phone
     * (`alert`; none chosen or none reachable: the first two), and a tap on it opens Kasbah's grid in
     * the car for the others.
     */
    internal fun notifyArrival(context: Context, accesses: List<Access>, alert: Set<String>) {
        val car = CarAppExtender.Builder()
            .setImportance(NotificationManagerCompat.IMPORTANCE_HIGH)
            .setContentIntent(
                CarPendingIntent.getCarApp(
                    context, 0, Intent().setComponent(ComponentName(context, KasbahCarAppService::class.java)), PendingIntent.FLAG_IMMUTABLE,
                ),
            )
        for (a in alertAccesses(accesses, alert)) car.addAction(icon(a), context.getString(R.string.command_sent, a.label, context.getString(R.string.open)), openIntent(context, a))
        post(
            context,
            notification(context, context.getString(R.string.approach_title), accesses.joinToString(" · ") { "${it.label} : ${stateLabel(context, it)}" })
                .setTimeoutAfter(10 * 60_000L)
                .extend(car.build()),
        )
    }

    /** After an action: what was sent, or why it failed. Same notification, no second alert, no action. */
    internal fun notifyResult(context: Context, text: String) {
        post(
            context,
            notification(context, context.getString(R.string.approach_title), text)
                .setTimeoutAfter(60_000L)
                .extend(CarAppExtender.Builder().setImportance(NotificationManagerCompat.IMPORTANCE_HIGH).build()),
        )
    }

    internal fun cancel(context: Context) = CarNotificationManager.from(context).cancel(NOTIFICATION)

    private fun notification(context: Context, title: String, text: String) =
        NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_gate)
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)

    @SuppressLint("MissingPermission")
    private fun post(context: Context, builder: NotificationCompat.Builder) {
        val manager = CarNotificationManager.from(context)
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName(context.getString(R.string.approach_channel)).build(),
        )
        // Not a permission before Android 13, where checkSelfPermission would say "denied".
        if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            manager.notify(NOTIFICATION, builder)
        } else {
            Log.i(TAG, "notifications not allowed")
        }
    }

    private fun icon(a: Access) = if (a.deviceClass == "garage") R.drawable.ic_garage else R.drawable.ic_gate
}

/** The alert's buttons, two at most (Android Auto's limit): those chosen on the phone, else the first two. */
internal fun alertAccesses(accesses: List<Access>, alert: Set<String>): List<Access> =
    accesses.filter { it.id in alert }.ifEmpty { accesses }.take(2)

/** The geofence's crossings, the notification's actions, and the reboots and updates that erase the geofence. */
class ApproachReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> Approach.register(context)
            Approach.ACTION_OPEN -> open(context, intent.getStringExtra(Approach.EXTRA_ID) ?: return, intent.getStringExtra(Approach.EXTRA_NAME).orEmpty())
            else -> crossed(context, GeofencingEvent.fromIntent(intent) ?: return)
        }
    }

    private fun crossed(context: Context, event: GeofencingEvent) {
        if (event.hasError()) {
            Log.w(Approach.TAG, "geofence error ${event.errorCode}")
            return
        }
        Log.i(Approach.TAG, "geofence transition ${event.geofenceTransition}")
        if (event.geofenceTransition == Geofence.GEOFENCE_TRANSITION_EXIT) return Approach.cancel(context)
        if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_ENTER) return
        val done = goAsync()
        Approach.arrive(context, done::finish)
    }

    private fun open(context: Context, id: String, name: String) {
        val done = goAsync()
        Background.run({ KasbahClient(context).command(id, "cover.open") }) { result ->
            Approach.notifyResult(
                context,
                result.fold(
                    { context.getString(R.string.approach_sent, name) },
                    { it.message ?: context.getString(R.string.command_failed) },
                ),
            )
            done.finish()
        }
    }
}
