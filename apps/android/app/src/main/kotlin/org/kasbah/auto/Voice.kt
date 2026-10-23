package org.kasbah.auto

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.car.app.CarContext
import androidx.car.app.media.CarAudioRecord
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

// Built on first use: the file also holds pure functions the JVM tests load, where Android's audio
// classes do not exist.
private val SPEECH by lazy {
    AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
}

/**
 * The end of the sentence, guessed from the sound level: same rule and numbers as the web app's
 * `apps/web/src/lib/vad.ts`. The floor follows the car's noise (it drops at once to the lowest
 * level heard and rises slowly during silences), the threshold is three times the floor.
 */
class Endpointer {
    private var floor: Double? = null
    private var last = 0L
    private var loudSince: Long? = null
    private var quietSince: Long? = null
    private var spoke = false
    private var done = false

    /** `level`: RMS between 0 and 1; `at`: ms since the start. "end", "nothing", or null to go on. */
    fun push(level: Double, at: Long): String? {
        if (done) return null
        val dt = max(0L, at - last) / 1000.0
        last = at
        val threshold = max((floor ?: 0.0) * FACTOR, MIN_LEVEL)
        val loud = level > threshold
        if (level > 0) {
            val f = floor
            if (f == null || level < f) floor = level
            else if (!loud) floor = f + (level - f) * min(1.0, RISE_PER_S * dt)
        }
        if (loud) {
            quietSince = null
            val since = loudSince ?: at.also { loudSince = it }
            if (at - since >= SPEECH_MS) spoke = true
        } else {
            loudSince = null
            if (quietSince == null) quietSince = at
        }
        val quiet = quietSince
        if (spoke && quiet != null && at - quiet >= SILENCE_MS) return "end".also { done = true }
        if (!spoke && at >= NO_SPEECH_MS) return "nothing".also { done = true }
        return null
    }

    companion object {
        const val SILENCE_MS = 1000L
        const val NO_SPEECH_MS = 5000L
        const val SPEECH_MS = 250L
        const val FACTOR = 3.0
        const val MIN_LEVEL = 0.01
        const val RISE_PER_S = 0.5
    }
}

/**
 * Records one sentence from the car's microphone (16 kHz, mono, 16 bits) and returns it as a WAV
 * file, or null when nobody spoke. Blocks: to be called off the main thread. `cancelled` is polled
 * between frames.
 */
fun recordSentence(carContext: CarContext, cancelled: () -> Boolean): ByteArray? {
    if (carContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw KasbahError(carContext.getString(R.string.err_mic))
    }
    val audio = carContext.getSystemService(AudioManager::class.java)
    val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE).setAudioAttributes(SPEECH).build()
    audio.requestAudioFocus(focus)
    val record = CarAudioRecord.create(carContext)
    val pcm = ByteArrayOutputStream()
    val frame = ByteArray(CarAudioRecord.AUDIO_CONTENT_BUFFER_SIZE)
    val endpointer = Endpointer()
    val start = SystemClock.elapsedRealtime()
    record.startRecording()
    try {
        while (!cancelled()) {
            val n = record.read(frame, 0, frame.size)
            if (n <= 0) break
            pcm.write(frame, 0, n)
            val at = SystemClock.elapsedRealtime() - start
            when (endpointer.push(rms(frame, n), at)) {
                "end" -> break
                "nothing" -> return null
            }
            if (at >= MAX_RECORD_MS) break
        }
    } finally {
        record.stopRecording()
        audio.abandonAudioFocusRequest(focus)
    }
    return if (cancelled()) null else wav(pcm.toByteArray())
}

/** Same cap as the web app's microphone. */
private const val MAX_RECORD_MS = 15_000L

internal fun rms(frame: ByteArray, length: Int): Double {
    val samples = ByteBuffer.wrap(frame, 0, length).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    var sum = 0.0
    val count = samples.remaining()
    while (samples.hasRemaining()) {
        val s = samples.get() / 32768.0
        sum += s * s
    }
    return if (count == 0) 0.0 else sqrt(sum / count)
}

/** A WAV header in front of 16 kHz mono 16-bit PCM: the format the transcription route reads. */
internal fun wav(pcm: ByteArray): ByteArray {
    val rate = CarAudioRecord.AUDIO_CONTENT_SAMPLING_RATE
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
        put("RIFF".toByteArray()); putInt(36 + pcm.size); put("WAVE".toByteArray())
        put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1); putInt(rate); putInt(rate * 2); putShort(2); putShort(16)
        put("data".toByteArray()); putInt(pcm.size)
    }
    return header.array() + pcm
}

/**
 * Says the assistant's answer through the car: the Kasbah voice (a WAV from the server) when there is
 * one, Android's own voice otherwise. Music is lowered while it speaks.
 */
class Speaker(private val context: Context) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(SPEECH).build()
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var tts: TextToSpeech? = null

    fun play(wav: ByteArray) {
        stop()
        val file = File(context.cacheDir, "answer.wav").apply { writeBytes(wav) }
        audio.requestAudioFocus(focus)
        player = MediaPlayer().apply {
            setAudioAttributes(SPEECH)
            setDataSource(file.path)
            setOnCompletionListener { stop() }
            prepare()
            start()
        }
    }

    fun say(text: String) {
        stop()
        audio.requestAudioFocus(focus)
        tts = TextToSpeech(context) { status ->
            val t = tts ?: return@TextToSpeech
            if (status != TextToSpeech.SUCCESS) return@TextToSpeech stop()
            t.language = Locale.getDefault()
            t.setAudioAttributes(SPEECH)
            // Called on a speech thread: back to the main one, where the speaker lives.
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) { main.post(::stop) }
                @Deprecated("Deprecated in Java")
                override fun onError(id: String?) { main.post(::stop) }
            })
            t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "answer")
        }
    }

    fun stop() {
        player?.release()
        player = null
        tts?.shutdown()
        tts = null
        audio.abandonAudioFocusRequest(focus)
    }
}
