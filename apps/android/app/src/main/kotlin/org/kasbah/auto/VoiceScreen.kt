package org.kasbah.auto

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
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
            val vocabulary = client.vocabulary()
            val heard = client.transcribe(sentence, vocabulary.hints)
            Heard(heard, vocabulary)
        }) { result ->
            result.onSuccess { h ->
                if (h == null || h.text.isEmpty()) show(carContext.getString(R.string.voice_nothing)) else think(h)
            }.onFailure { fail(it) }
        }
    }

    private fun think(h: Heard) {
        show(carContext.getString(R.string.voice_thinking, h.text), busy = true)
        Background.run({ client.ask(h.text) }) { result ->
            result.onSuccess { answer ->
                // The car screen only shows the start of a message: the answer alone, the question has been seen.
                show(answer.ifEmpty { carContext.getString(R.string.voice_done) })
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
    // screen, not as a new screen (those are counted).
    override fun onGetTemplate(): Template =
        MessageTemplate.Builder(message)
            .setTitle(carContext.getString(R.string.voice_title))
            .setHeaderAction(Action.BACK)
            .addAction(Action.Builder().setTitle(carContext.getString(R.string.voice_again)).setOnClickListener(::listen).build())
            .build()

    private data class Heard(val text: String, val vocabulary: Vocabulary)

    private companion object {
        const val TAG = "KasbahVoice"
    }
}
