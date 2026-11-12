package org.kasbah.auto

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.Collator
import java.util.concurrent.Executors

/** A gate or a garage door, as `GET /api/devices` describes it. */
data class Access(
    val id: String,
    val name: String,
    val deviceClass: String,
    /** 0 = closed, 100 = open, null = unknown (a one-way radio never says). */
    val position: Int?,
    val motion: String?,
    val available: Boolean,
    /** What fits a car tile and button: its kind, numbered when the house has several ("Garage 2"). */
    val label: String = name,
    /** Its number among the accesses of its kind, null when it is the only one. */
    val number: Int? = null,
    /** The house room it is placed in, for the covers listed by room. */
    val room: String? = null,
)

/** A lamp, with the name of the house room it is placed in (null: placed outside any room, or not at all). */
data class Light(val id: String, val name: String, val on: Boolean, val available: Boolean, val room: String?)

/** A plugin scene (`GET /api/scenes`): a preset of the vendor, recalled as a whole. */
data class Scene(val id: String, val name: String, val group: String?, val active: Boolean, val swatches: List<Int>)

/**
 * What the house tab shows, each null when the house has no such device or it is offline: the room
 * temperature, the solar production, the charger, how many lamps are on, and a camera to show.
 */
data class HouseStatus(
    val insideC: Double? = null,
    val solarW: Double? = null,
    val charger: String? = null,
    val chargerW: Double? = null,
    val lightsOn: Int = 0,
    val camera: String? = null,
)

/** A camera or doorbell, as `GET /api/devices` describes it. */
data class Camera(val id: String, val name: String, val available: Boolean)

/** A camera's last still: the JPEG, and when it was taken (epoch ms) when the server says. */
class Still(val jpeg: ByteArray, val at: Long?)

class KasbahError(message: String) : Exception(message)

data class Vocabulary(val hints: List<String>, val words: Map<String, String>)

/** Where the house stands: the `origin` of the house file, the point its 3D scene, sun and weather start from. */
data class Home(val lat: Double, val lon: Double)

/**
 * Talks to the Kasbah server the way the web app does: the session cookie of `POST /login`, and the
 * server's own Origin on every request (it refuses any write without it).
 */
class KasbahClient(private val context: Context) {
    private val prefs = context.getSharedPreferences("kasbah", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString("url", "")!!
        set(value) = prefs.edit().putString("url", value.trim().trimEnd('/')).apply()

    private var session: String?
        get() = prefs.getString("session", null)
        set(value) = prefs.edit().putString("session", value).apply()

    /** The account signed in from this phone, empty when signed out. */
    var account: String
        get() = prefs.getString("account", "")!!
        set(value) = prefs.edit().putString("account", value).apply()

    /**
     * The house's position, kept on this phone only (never sent anywhere): the approach alert works from
     * it without the network. Null until read once signed in.
     */
    var home: Home?
        get() = prefs.getString("home", null)?.split(',')?.let { (lat, lon) -> Home(lat.toDouble(), lon.toDouble()) }
        set(value) = prefs.edit().putString("home", value?.let { "${it.lat},${it.lon}" }).apply()

    /** Closes the session on the server when it can be reached, and forgets it here in any case. */
    fun logout() {
        runCatching { open("/logout", "POST").apply { responseCode; disconnect() } }
        session = null
        account = ""
        home = null
    }

    /** The password is sent once and never kept: only the session cookie is. */
    fun login(user: String, password: String) {
        // a local address no longer opens Kasbah, and the password would cross the network in clear
        if (!signsInThere(baseUrl)) throw KasbahError(context.getString(R.string.err_public_address))
        val c = open("/login", "POST")
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        c.doOutput = true
        c.outputStream.use { it.write("username=${enc(user)}&password=${enc(password)}".toByteArray()) }
        val code = c.responseCode
        val cookie = sessionCookie(c.headerFields)
        c.disconnect()
        when {
            code == 401 -> throw KasbahError(context.getString(R.string.err_credentials))
            code == 429 -> throw KasbahError(context.getString(R.string.err_locked))
            code == 403 -> throw KasbahError(context.getString(R.string.err_origin))
            // The server's own computer (`adb reverse`) needs no account: `/login` just sends back to the app.
            else -> session = cookie
        }
    }

    /**
     * The accesses in the order chosen on the phone, which also numbers them: the car's tiles are
     * too narrow for "Porte de garage gauche" and "Porte de garage droite".
     */
    var order: List<String>
        get() = prefs.getString("order", "")!!.split(',').filter { it.isNotEmpty() }
        set(value) = prefs.edit().putString("order", value.joinToString(",")).apply()

    /** The accesses with a button in the approach alert, two at most; none chosen = the first two. */
    var alert: Set<String>
        get() = prefs.getStringSet("alert", emptySet())!!
        set(value) = prefs.edit().putStringSet("alert", value).apply()

    /**
     * The last approach events (geofence placed, crossings, alerts, failures), newest first, kept on this
     * phone only: what happened on the road, read once parked.
     */
    val journal: List<String>
        get() = prefs.getString("journal", "")!!.lines().filter { it.isNotEmpty() }

    fun note(line: String) = prefs.edit().putString("journal", journalWith(journal, line).joinToString("\n")).apply()

    fun accesses(): List<Access> = arrange(parseAccesses(request("GET", "/api/devices")))

    /** [arrangeAccesses] with this phone's order and the kinds' names in its language. */
    fun arrange(list: List<Access>): List<Access> = arrangeAccesses(list, order) {
        context.getString(if (it == "garage") R.string.kind_garage else R.string.kind_gate)
    }

    fun readHome(): Home? = parseHome(request("GET", "/api/house"))

    fun command(id: String, type: String, params: JSONObject = JSONObject()) {
        request("POST", "/api/devices/$id/command", params.put("type", type).toString())
    }

    fun lights(): List<Light> = parseLights(request("GET", "/api/devices"), request("GET", "/api/house"))

    fun covers(): List<Access> = parseCovers(request("GET", "/api/devices"), request("GET", "/api/house"))

    fun scenes(): List<Scene> = parseScenes(request("GET", "/api/scenes"))

    fun recall(id: String) {
        request("POST", "/api/scenes/$id/recall", JSONObject().put("mode", "static").toString())
    }

    fun status(): HouseStatus = parseStatus(request("GET", "/api/devices"))

    /** The camera's last still, a JPEG (the route the web app's camera tiles read). */
    fun snapshot(cameraId: String): ByteArray = still(cameraId).jpeg

    /**
     * The camera's last still and when it was taken. Read only: asking for a fresh one would open the
     * camera's stream, which the vendor counts against a budget.
     */
    fun still(cameraId: String): Still {
        if (baseUrl.isEmpty()) throw KasbahError(context.getString(R.string.err_no_address))
        val (plugin, external) = cameraId.split(':', limit = 2)
        val c = open("/api/plugins/$plugin/cameras/${enc(external)}/snapshot.jpg", "GET")
        c.readTimeout = 20_000
        try {
            val code = c.responseCode
            if (code == 401) throw KasbahError(context.getString(R.string.err_session))
            if (code !in 200..299) throw KasbahError(context.getString(R.string.err_server, code))
            return Still(c.inputStream.readBytes(), c.getHeaderField("x-kasbah-snapshot-at")?.toLongOrNull())
        } finally {
            c.disconnect()
        }
    }

    fun cameras(): List<Camera> = parseCameras(request("GET", "/api/devices"))

    /**
     * The house's words, as the web app sends them: names for the transcription to recognise (rooms,
     * zones, levels, scenes, devices), and each level's abbreviation for the synthesis to say in full.
     */
    fun vocabulary(): Vocabulary {
        val house = JSONObject(request("GET", "/api/house"))
        val scenes = JSONObject(request("GET", "/api/scenes")).getJSONArray("scenes")
        val devices = JSONObject(request("GET", "/api/devices")).getJSONArray("devices")
        val names = listOf("rooms", "zones", "levels").flatMap { key -> objects(house.optJSONArray(key)).map { it.optString("name") } } +
            objects(scenes).map { it.getJSONObject("scene").optString("name") } +
            objects(devices).map { it.getJSONObject("descriptor").optString("name") }
        val words = objects(house.optJSONArray("levels"))
            .filter { it.optString("shortName").isNotEmpty() && it.optString("shortName") != it.optString("name") }
            .associate { it.getString("shortName") to it.getString("name") }
        return Vocabulary(names.map { it.trim() }.filter { it.isNotEmpty() && it.length <= 80 }.distinct().take(400), words)
    }

    /** `wav`: a whole WAV file. The text heard, empty when nothing was understood. */
    fun transcribe(wav: ByteArray, hints: List<String>): String {
        val body = JSONObject().put("audio", Base64.encodeToString(wav, Base64.NO_WRAP)).put("hints", JSONArray(hints))
        return JSONObject(request("POST", "/api/plugins/transcription/transcribe", body.toString(), 30_000)).optString("text")
    }

    /** The assistant's answer: its `text` lines, once the run is over (the stream is read whole). */
    fun ask(text: String): String =
        parseAnswer(request("POST", "/api/assistant/ask", JSONObject().put("text", text).toString(), 75_000), context.getString(R.string.failed))

    /** The answer said aloud with the account's Kasbah voice: a WAV file. */
    fun speak(text: String, words: Map<String, String>): ByteArray {
        val body = JSONObject().put("text", text).put("words", JSONObject(words))
        return call("POST", "/api/plugins/transcription/speak", body.toString(), 60_000)
    }

    private fun objects(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.getJSONObject(it) }

    private fun request(method: String, path: String, json: String? = null, timeout: Int = 20_000): String =
        String(call(method, path, json, timeout))

    private fun call(method: String, path: String, json: String?, timeout: Int): ByteArray {
        if (baseUrl.isEmpty()) throw KasbahError(context.getString(R.string.err_no_address))
        val c = open(path, method)
        c.readTimeout = timeout
        if (json != null) {
            c.setRequestProperty("Content-Type", "application/json")
            c.doOutput = true
            c.outputStream.use { it.write(json.toByteArray()) }
        }
        try {
            val code = c.responseCode
            if (code == 401) throw KasbahError(context.getString(R.string.err_session))
            if (code !in 200..299) {
                val message = runCatching {
                    JSONObject(c.errorStream.bufferedReader().readText()).getJSONObject("error").getString("message")
                }.getOrNull()
                throw KasbahError(message ?: context.getString(R.string.err_server, code))
            }
            return c.inputStream.readBytes()
        } finally {
            c.disconnect()
        }
    }

    private fun open(path: String, method: String): HttpURLConnection {
        val url = URL(baseUrl + path)
        return (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            instanceFollowRedirects = false
            connectTimeout = 10_000
            setRequestProperty("Origin", "${url.protocol}://${url.authority}")
            session?.let { setRequestProperty("Cookie", "$COOKIE=$it") }
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    companion object {
        const val COOKIE = "__Host-kasbah_session"
        val ACCESS_CLASSES = listOf("gate", "garage")
    }
}

/**
 * Does Kasbah sign in at this address? Over HTTPS (the public address, at home as away), or the server's
 * own computer over HTTP (`adb reverse` to `localhost`, trusted without an account). A local address in
 * plain HTTP serves only the speakers' streams, and would send the password in clear.
 */
internal fun signsInThere(url: String): Boolean {
    val u = url.trim().lowercase()
    if (u.startsWith("https://")) return true
    if (!u.startsWith("http://")) return false
    val host = u.removePrefix("http://").substringBefore('/').let { if (it.startsWith("[")) it.substringBefore(']') + "]" else it.substringBefore(':') }
    return host == "localhost" || host.startsWith("127.") || host == "[::1]"
}

/** The journal with `line` on top, the oldest lines dropped beyond `max`. */
internal fun journalWith(journal: List<String>, line: String, max: Int = 30): List<String> = (listOf(line) + journal).take(max)

/** The session cookie among a response's headers (`Set-Cookie`, whatever its case), null if none. */
internal fun sessionCookie(headers: Map<String?, List<String>>): String? = headers.entries
    .filter { it.key.equals("Set-Cookie", ignoreCase = true) }
    .flatMap { it.value }
    .firstNotNullOfOrNull { Regex("${KasbahClient.COOKIE}=([^;]+)").find(it)?.groupValues?.get(1) }

/** The gates and garage doors of a `GET /api/devices` body, gates first. */
internal fun parseAccesses(body: String): List<Access> {
    val devices = JSONObject(body).getJSONArray("devices")
    return (0 until devices.length()).map { devices.getJSONObject(it) }.mapNotNull { entry ->
        val d = entry.getJSONObject("descriptor")
        val deviceClass = d.optJSONObject("meta")?.optJSONObject("cover")?.optString("deviceClass")
        if (d.getString("kind") != "cover" || deviceClass !in KasbahClient.ACCESS_CLASSES) return@mapNotNull null
        val s = entry.optJSONObject("state")
        Access(
            id = d.getString("id"),
            name = d.getString("name"),
            deviceClass = deviceClass!!,
            position = s?.optDouble("position")?.takeUnless { it.isNaN() }?.toInt(),
            motion = s?.optString("motion")?.takeIf { it.isNotEmpty() },
            available = s?.optBoolean("available", false) ?: false,
        )
    }.sortedBy { KasbahClient.ACCESS_CLASSES.indexOf(it.deviceClass) }
}

/**
 * The accesses in `order` (ids; the others after, as the server gives them), each labelled by its kind,
 * numbered in that order when the house has several of the kind: "Portail", "Garage 1", "Garage 2".
 */
internal fun arrangeAccesses(list: List<Access>, order: List<String>, kindName: (String) -> String): List<Access> {
    val sorted = list.sortedBy { a -> order.indexOf(a.id).takeIf { it >= 0 } ?: Int.MAX_VALUE }
    val counts = sorted.groupingBy { it.deviceClass }.eachCount()
    val seen = mutableMapOf<String, Int>()
    return sorted.map { a ->
        if (counts[a.deviceClass] == 1) return@map a.copy(label = kindName(a.deviceClass), number = null)
        val n = (seen[a.deviceClass] ?: 0) + 1
        seen[a.deviceClass] = n
        a.copy(label = "${kindName(a.deviceClass)} $n", number = n)
    }
}

private fun objectsOf(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.getJSONObject(it) }

/** Each placed device's room name, from a `GET /api/house` body. */
private fun roomsOf(houseBody: String): Map<String, String?> {
    val house = JSONObject(houseBody)
    val roomNames = objectsOf(house.optJSONArray("rooms")).associate { it.getString("id") to it.optString("name") }
    return objectsOf(house.optJSONArray("devices"))
        .filter { it.has("roomId") }
        .associate { it.getString("deviceId") to roomNames[it.getString("roomId")] }
}

/**
 * The house's room names in the web app's display order (`buildHouseIndex` in packages/shared): levels
 * from the highest down, and in each the rooms of `level.roomOrder` (set in the Lights view) first, then
 * the others by name. The same for every account: the order belongs to the house.
 */
internal fun roomOrder(houseBody: String): List<String> {
    val house = JSONObject(houseBody)
    val rooms = objectsOf(house.optJSONArray("rooms"))
    val collator = Collator.getInstance()
    return objectsOf(house.optJSONArray("levels")).sortedByDescending { it.optDouble("elevation", 0.0) }.flatMap { level ->
        val chosen = level.optJSONArray("roomOrder")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
        rooms.filter { it.optString("levelId") == level.getString("id") }
            .sortedWith(compareBy<JSONObject> { chosen.indexOf(it.getString("id")).let { i -> if (i < 0) Int.MAX_VALUE else i } }
                .thenComparator { a, b -> collator.compare(a.optString("name"), b.optString("name")) })
            .map { it.optString("name") }
    }
}

/** Devices in the web app's order: their room's rank in [roomOrder], then by name; those of no room last. */
private fun <T> inHouseOrder(items: List<T>, houseBody: String, room: (T) -> String?, name: (T) -> String): List<T> {
    val rank = roomOrder(houseBody).withIndex().associate { (i, n) -> n to i }
    val collator = Collator.getInstance()
    // A room the order does not know (on no level) still comes before the devices of no room.
    return items.sortedWith(compareBy<T> { room(it)?.let { r -> rank[r] ?: (Int.MAX_VALUE - 1) } ?: Int.MAX_VALUE }.thenComparator { a, b -> collator.compare(name(a), name(b)) })
}

/**
 * The covers of a `GET /api/devices` body that are not gates or garage doors (shutters, blinds,
 * awnings, curtains, windows), each with its room's name from the `GET /api/house` body, in the web
 * app's order.
 */
internal fun parseCovers(devicesBody: String, houseBody: String): List<Access> {
    val roomOf = roomsOf(houseBody)
    return inHouseOrder(parseAllCovers(devicesBody, roomOf), houseBody, { it.room }, { it.name })
}

private fun parseAllCovers(devicesBody: String, roomOf: Map<String, String?>): List<Access> =
    objectsOf(JSONObject(devicesBody).getJSONArray("devices")).mapNotNull { entry ->
        val d = entry.getJSONObject("descriptor")
        val deviceClass = d.optJSONObject("meta")?.optJSONObject("cover")?.optString("deviceClass").orEmpty()
        if (d.getString("kind") != "cover" || deviceClass in KasbahClient.ACCESS_CLASSES) return@mapNotNull null
        val s = entry.optJSONObject("state")
        Access(
            id = d.getString("id"),
            name = d.getString("name"),
            deviceClass = deviceClass,
            position = s?.optDouble("position")?.takeUnless { it.isNaN() }?.toInt(),
            motion = s?.optString("motion")?.takeIf { it.isNotEmpty() },
            available = s?.optBoolean("available", false) ?: false,
            room = roomOf[d.getString("id")],
        )
    }

/** The cameras and doorbells of a `GET /api/devices` body, in the server's order. */
internal fun parseCameras(body: String): List<Camera> = objectsOf(JSONObject(body).getJSONArray("devices")).mapNotNull { entry ->
    val d = entry.getJSONObject("descriptor")
    if (d.getString("kind") != "camera") return@mapNotNull null
    Camera(d.getString("id"), d.getString("name"), entry.optJSONObject("state")?.optBoolean("available") ?: false)
}

/**
 * The lamps of a `GET /api/devices` body, each with its room's name from the `GET /api/house` body, in
 * the web app's order.
 */
internal fun parseLights(devicesBody: String, houseBody: String): List<Light> {
    val roomOf = roomsOf(houseBody)
    val lights = objectsOf(JSONObject(devicesBody).getJSONArray("devices")).mapNotNull { entry ->
        val d = entry.getJSONObject("descriptor")
        if (d.getString("kind") != "light") return@mapNotNull null
        val s = entry.optJSONObject("state")
        Light(d.getString("id"), d.getString("name"), s?.optBoolean("on") ?: false, s?.optBoolean("available") ?: false, roomOf[d.getString("id")])
    }
    return inHouseOrder(lights, houseBody, { it.room }, { it.name })
}

/** The scenes of a `GET /api/scenes` body, their `#rrggbb` swatches as ARGB colors. */
internal fun parseScenes(body: String): List<Scene> = objectsOf(JSONObject(body).getJSONArray("scenes")).map { entry ->
    val s = entry.getJSONObject("scene")
    val swatches = s.optJSONArray("swatches")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
        .mapNotNull { hex -> hex.removePrefix("#").takeIf { it.length == 6 }?.toIntOrNull(16)?.let { 0xFF000000.toInt() or it } }
    Scene(
        id = s.getString("id"),
        name = s.getString("name"),
        group = s.optJSONObject("group")?.optString("name")?.takeIf { it.isNotEmpty() },
        active = entry.optJSONObject("state")?.optString("active", "inactive") != "inactive",
        swatches = swatches,
    )
}

/**
 * The house's state in a `GET /api/devices` body: the first room thermostat (a zone regulated on its
 * flow water says 45 °C, not a room's air), the first solar site, the first charger, the lamps on, the
 * first camera. Offline devices say nothing.
 */
internal fun parseStatus(body: String): HouseStatus {
    var status = HouseStatus()
    for (entry in objectsOf(JSONObject(body).getJSONArray("devices"))) {
        val d = entry.getJSONObject("descriptor")
        val s = entry.optJSONObject("state") ?: continue
        val online = s.optBoolean("available")
        when (d.getString("kind")) {
            "climate" -> if (online && status.insideC == null &&
                d.optJSONObject("meta")?.optJSONObject("climate")?.optString("control") != "flow" && s.has("currentTempC")
            ) status = status.copy(insideC = s.getDouble("currentTempC"))
            "energy" -> if (online && status.solarW == null && s.has("productionW")) status = status.copy(solarW = s.getDouble("productionW"))
            "ev_charger" -> if (online && status.charger == null) status = status.copy(charger = s.optString("status"), chargerW = s.optDouble("powerW", 0.0))
            "light" -> if (online && s.optBoolean("on")) status = status.copy(lightsOn = status.lightsOn + 1)
            "camera" -> if (status.camera == null) status = status.copy(camera = d.getString("id"))
        }
    }
    return status
}

/** The house's `origin` in a `GET /api/house` body, null when it has none. */
internal fun parseHome(body: String): Home? {
    val origin = JSONObject(body).optJSONObject("origin") ?: return null
    if (!origin.has("lat") || !origin.has("lon")) return null
    return Home(origin.getDouble("lat"), origin.getDouble("lon"))
}

/**
 * The assistant's answer from the whole NDJSON stream of `POST /api/assistant/ask`: its `text` lines.
 * An `error` line becomes the error, with `fallback` when it carries no message.
 */
internal fun parseAnswer(body: String, fallback: String): String {
    val answer = mutableListOf<String>()
    for (line in body.lines().filter { it.isNotBlank() }.map(::JSONObject)) {
        when (line.optString("type")) {
            "text" -> answer += line.getString("text")
            "error" -> throw KasbahError(line.optString("message").ifEmpty { fallback })
        }
    }
    return answer.joinToString("\n")
}

/** Network off the main thread, result back on it (screens and views are only touched there). */
object Background {
    private val pool = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun <T> run(work: () -> T, done: (Result<T>) -> Unit) {
        pool.execute {
            val result = runCatching(work)
            main.post { done(result) }
        }
    }
}

fun stateLabel(context: Context, a: Access): String = when {
    !a.available -> context.getString(R.string.state_offline)
    a.motion == "opening" -> context.getString(R.string.state_opening)
    a.motion == "closing" -> context.getString(R.string.state_closing)
    a.position == null -> context.getString(R.string.state_unknown)
    a.position == 0 -> context.getString(R.string.state_closed)
    a.position == 100 -> context.getString(R.string.state_open)
    else -> context.getString(R.string.state_open_pct, a.position)
}
