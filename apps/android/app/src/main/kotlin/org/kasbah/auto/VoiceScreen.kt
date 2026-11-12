package org.kasbah.auto

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.annotation.StringRes
import androidx.annotation.VisibleForTesting
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.LongMessageTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * "Parler": one sentence from the car's microphone, transcribed and handed to the assistant as the web
 * app's microphone does; the answer is shown and said aloud. Listening starts as soon as the screen
 * opens; leaving it stops everything.
 */
class VoiceScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
    private val client = KasbahClient(carContext)
    private val speaker = Speaker(carContext)
    @Volatile private var stopped = false
    private var busy = false
    private var message = carContext.getString(R.string.voice_listening)

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        stopped = false
        listen()
    }

    override fun onStop(owner: LifecycleOwner) {
        stopped = true
        speaker.stop()
    }

    private fun listen() {
        if (busy) return
        if (carContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            show(carContext.getString(R.string.voice_allow_mic), busy = true)
            carContext.requestPermissions(listOf(Manifest.permission.RECORD_AUDIO)) { granted, _ ->
                busy = false
                if (Manifest.permission.RECORD_AUDIO in granted) listen() else show(carContext.getString(R.string.voice_mic_refused))
            }
            return
        }
        speaker.stop()
        show(carContext.getString(R.string.voice_listening), busy = true)
        Background.run({
            val sentence = recordSentence(carContext) { stopped } ?: return@run null
            // The microphone is closed: no longer "Listening…" while the server transcribes.
            carContext.mainExecutor.execute { show(carContext.getString(R.string.voice_transcribing), busy = true) }
            val vocabulary = client.vocabulary()
            val heard = client.transcribe(sentence, vocabulary.hints)
            Heard(heard, vocabulary)
        }) { result ->
            result.onSuccess { h ->
                when {
                    h == null -> retry(R.string.voice_nothing)
                    h.text.isEmpty() -> {
                        Log.i(TAG, "transcription empty")
                        retry(R.string.voice_unclear)
                    }
                    else -> think(h)
                }
            }.onFailure { fail(it) }
        }
    }

    /** Nothing to ask: said aloud as well, the driver watches the road, not the screen. */
    private fun retry(@StringRes message: Int) {
        val text = carContext.getString(message)
        show(text)
        if (!stopped) speaker.say(text)
    }

    private fun think(h: Heard) {
        show(carContext.getString(R.string.voice_thinking, h.text), busy = true)
        Background.run({ client.ask(h.text) }) { result ->
            result.onSuccess { answer ->
                answered(answer)
                if (answer.isNotEmpty()) say(answer, h.vocabulary.words)
            }.onFailure { fail(it) }
        }
    }

    /** The Kasbah voice, or Android's when the server cannot speak (spoken answers off, synthesis down). */
    private fun say(answer: String, words: Map<String, String>) {
        Background.run({ client.speak(answer, words) }) { result ->
            if (stopped) return@run
            result.onSuccess { speaker.play(it) }.onFailure {
                Log.i(TAG, "Kasbah voice unavailable, Android's instead: ${it.message}")
                speaker.say(answer)
            }
        }
    }

    /** The car screen only shows the start of a message: the answer alone, the question has been seen. */
    @VisibleForTesting internal fun answered(answer: String) = show(answer.ifEmpty { carContext.getString(R.string.voice_done) })

    private fun fail(e: Throwable) {
        Log.w(TAG, "voice failed", e)
        show(e.message ?: carContext.getString(R.string.failed))
    }

    private fun show(text: String, busy: Boolean = false) {
        this.busy = busy
        message = text
        invalidate()
    }

    // Same title and same actions at every step: the host takes each change as a refresh of the
    // screen, not as a new screen (those are counted). "Read all" opens the whole text, which the car
    // only shows parked; the message here keeps its start.
    override fun onGetTemplate(): Template =
        MessageTemplate.Builder(twoLines(message))
            .setTitle(carContext.getString(R.string.voice_title))
            .setHeaderAction(Action.BACK)
            .addAction(Action.Builder().setTitle(carContext.getString(R.string.voice_again)).setOnClickListener(::listen).build())
            .addAction(Action.Builder().setTitle(carContext.getString(R.string.voice_read_all)).setOnClickListener {
                screenManager.push(LongAnswerScreen(carContext, message))
            }.build())
            .build()

    private data class Heard(val text: String, val vocabulary: Vocabulary)

    private companion object {
        const val TAG = "KasbahVoice"
    }
}

/**
 * The host centres the message and its buttons together, and cuts the message after two lines (seen in
 * a car, 2026-11-12): a line of one blank more keeps every message at two lines, so the buttons stay
 * put from "Listening…" to the answer. A message of exactly two lines then ends with an ellipsis, which
 * "Read all" makes up for.
 */
@VisibleForTesting internal fun twoLines(text: String) = text + "\n" + Char(0xA0)

/** The whole answer, scrolling: Android Auto shows this template parked only, and says so while driving. */
class LongAnswerScreen(carContext: CarContext, private val text: String) : Screen(carContext) {
    override fun onGetTemplate(): Template =
        LongMessageTemplate.Builder(text)
            .setTitle(carContext.getString(R.string.voice_answer_title))
            .setHeaderAction(Action.BACK)
            .build()
}
