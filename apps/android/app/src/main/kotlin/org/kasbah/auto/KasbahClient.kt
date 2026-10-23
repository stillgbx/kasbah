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
)

class KasbahError(message: String) : Exception(message)

data class Vocabulary(val hints: List<String>, val words: Map<String, String>)

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

    /** Closes the session on the server when it can be reached, and forgets it here in any case. */
    fun logout() {
        runCatching { open("/logout", "POST").apply { responseCode; disconnect() } }
        session = null
        account = ""
    }

    /** The password is sent once and never kept: only the session cookie is. */
    fun login(user: String, password: String) {
        val c = open("/login", "POST")
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        c.doOutput = true
        c.outputStream.use { it.write("username=${enc(user)}&password=${enc(password)}".toByteArray()) }
        val code = c.responseCode
        val cookie = c.headerFields.entries
            .filter { it.key.equals("Set-Cookie", ignoreCase = true) }
            .flatMap { it.value }
            .firstNotNullOfOrNull { Regex("$COOKIE=([^;]+)").find(it)?.groupValues?.get(1) }
        c.disconnect()
        when {
            code == 401 -> throw KasbahError(context.getString(R.string.err_credentials))
            code == 429 -> throw KasbahError(context.getString(R.string.err_locked))
            code == 403 -> throw KasbahError(context.getString(R.string.err_origin))
            // On the local network there is no session: `/login` just sends back to the app.
            else -> session = cookie
        }
    }

    fun accesses(): List<Access> {
        val devices = JSONObject(request("GET", "/api/devices")).getJSONArray("devices")
        return (0 until devices.length()).map { devices.getJSONObject(it) }.mapNotNull { entry ->
            val d = entry.getJSONObject("descriptor")
            val deviceClass = d.optJSONObject("meta")?.optJSONObject("cover")?.optString("deviceClass")
            if (d.getString("kind") != "cover" || deviceClass !in ACCESS_CLASSES) return@mapNotNull null
            val s = entry.optJSONObject("state")
            Access(
                id = d.getString("id"),
                name = d.getString("name"),
                deviceClass = deviceClass!!,
                position = s?.optDouble("position")?.takeUnless { it.isNaN() }?.toInt(),
                motion = s?.optString("motion")?.takeIf { it.isNotEmpty() },
                available = s?.optBoolean("available", false) ?: false,
            )
        }.sortedBy { ACCESS_CLASSES.indexOf(it.deviceClass) }
    }

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
    fun ask(text: String): String {
        val lines = request("POST", "/api/assistant/ask", JSONObject().put("text", text).toString(), 75_000).lines()
        val answer = mutableListOf<String>()
        for (line in lines.filter { it.isNotBlank() }.map(::JSONObject)) {
            when (line.optString("type")) {
                "text" -> answer += line.getString("text")
                "error" -> throw KasbahError(line.optString("message", context.getString(R.string.failed)))
            }
        }
        return answer.joinToString("\n")
    }

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
