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
)

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
            // On the local network there is no session: `/login` just sends back to the app.
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

    fun accesses(): List<Access> = arrange(parseAccesses(request("GET", "/api/devices")))

    /** [arrangeAccesses] with this phone's order and the kinds' names in its language. */
    fun arrange(list: List<Access>): List<Access> = arrangeAccesses(list, order) {
        context.getString(if (it == "garage") R.string.kind_garage else R.string.kind_gate)
    }

    fun readHome(): Home? = parseHome(request("GET", "/api/house"))

    fun command(id: String, type: String) {
        request("POST", "/api/devices/$id/command", JSONObject().put("type", type).toString())
    }

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
