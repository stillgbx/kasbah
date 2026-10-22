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
    private var message = "Je vous écoute…"

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
            show("Autoriser le micro sur le téléphone…", busy = true)
            carContext.requestPermissions(listOf(Manifest.permission.RECORD_AUDIO)) { granted, _ ->
                busy = false
                if (Manifest.permission.RECORD_AUDIO in granted) listen() else show("Micro refusé : l'autoriser dans les réglages du téléphone.")
            }
            return
        }
        speaker.stop()
        show("Je vous écoute…", busy = true)
        Background.run({
            val sentence = recordSentence(carContext) { stopped } ?: return@run null
            val vocabulary = client.vocabulary()
            val heard = client.transcribe(sentence, vocabulary.hints)
            Heard(heard, vocabulary)
        }) { result ->
            result.onSuccess { h ->
                if (h == null || h.text.isEmpty()) show("Rien entendu.") else think(h)
            }.onFailure { fail(it) }
        }
    }

    private fun think(h: Heard) {
        show("« ${h.text} »\n\nKasbah réfléchit…", busy = true)
        Background.run({ client.ask(h.text) }) { result ->
            result.onSuccess { answer ->
                show("« ${h.text} »\n\n${answer.ifEmpty { "C'est fait." }}")
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
        show(e.message ?: "Échec.")
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
            .setTitle("Parler à Kasbah")
            .setHeaderAction(Action.BACK)
            .addAction(Action.Builder().setTitle("Reparler").setOnClickListener(::listen).build())
            .build()

    private data class Heard(val text: String, val vocabulary: Vocabulary)

    private companion object {
        const val TAG = "KasbahVoice"
    }
}
