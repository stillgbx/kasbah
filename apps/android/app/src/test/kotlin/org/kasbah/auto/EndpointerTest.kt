package org.kasbah.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * End of sentence guessed from the sound level: the same cases as the web app's
 * `apps/web/src/lib/vad.test.ts`, since `Endpointer` is its copy. Invented levels, one frame every 50 ms.
 */
class EndpointerTest {
    private val frame = 50L

    /** Plays a sequence of (level, duration in ms) and returns the first event with its instant. */
    private fun play(vararg parts: Pair<Double, Long>): Pair<String, Long>? {
        val vad = Endpointer()
        var at = 0L
        for ((level, ms) in parts) {
            val end = at + ms
            while (at < end) {
                vad.push(level, at)?.let { return it to at }
                at += frame
            }
        }
        return null
    }

    @Test fun `speech then silence sends after the wanted silence, not before`() {
        val (event, at) = play(0.002 to 300L, 0.1 to 1500L, 0.002 to 3000L)!!
        assertEquals("end", event)
        assertEquals(Endpointer.SILENCE_MS, at - 1800)
    }

    @Test fun `a hesitation shorter than the wanted silence does not cut the sentence`() {
        val (event, at) = play(0.002 to 300L, 0.1 to 800L, 0.002 to Endpointer.SILENCE_MS - 200, 0.1 to 800L, 0.002 to 3000L)!!
        assertEquals("end", event)
        assertTrue(at > 300 + 800 + Endpointer.SILENCE_MS - 200 + 800)
    }

    @Test fun `nobody speaks, nothing heard after the delay`() {
        assertEquals("nothing" to Endpointer.NO_SPEECH_MS, play(0.002 to 10_000L))
    }

    @Test fun `a brief noise does not count as speech`() {
        assertEquals("nothing", play(0.002 to 300L, 0.3 to 100L, 0.002 to 10_000L)?.first)
    }

    @Test fun `a constant background noise becomes the floor and the end is still found`() {
        val (event, at) = play(0.03 to 1000L, 0.2 to 1500L, 0.03 to 3000L)!!
        assertEquals("end", event)
        assertEquals(Endpointer.SILENCE_MS, at - 2500)
    }

    @Test fun `speech from the very first instant is heard`() {
        assertEquals("end", play(0.1 to 600L, 0.003 to 100L, 0.1 to 800L, 0.003 to 3000L)?.first)
    }

    @Test fun `the null frames of the microphone opening do not skew the floor`() {
        assertEquals("end", play(0.0 to 200L, 0.02 to 500L, 0.15 to 1000L, 0.02 to 3000L)?.first)
    }

    @Test fun `nothing after the first event`() {
        val vad = Endpointer()
        var at = 0L
        while (at <= Endpointer.NO_SPEECH_MS) { vad.push(0.002, at); at += frame }
        assertNull(vad.push(0.5, at))
    }
}
