package org.kasbah.auto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** What the car's microphone becomes before the transcription: a level, then a WAV file. */
class VoiceAudioTest {
    private fun pcm(vararg samples: Short): ByteArray =
        ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN).apply { samples.forEach(::putShort) }.array()

    @Test fun `RMS level of a little-endian 16-bit frame`() {
        assertEquals(0.5, rms(pcm(16384, -16384, 16384, -16384), 8), 1e-9)
        assertEquals(0.0, rms(ByteArray(0), 0), 0.0)
    }

    @Test fun `only the frame's first bytes count`() {
        assertEquals(0.5, rms(pcm(16384, -16384, 0, 0), 4), 1e-9)
    }

    /** `ms` of sound at RMS `level` (a square wave), 16 kHz. */
    private fun sound(level: Double, ms: Int): ShortArray = ShortArray(ms * 16) { i -> ((if (i % 2 == 0) level else -level) * 32767).toInt().toShort() }

    /**
     * A sentence as the car's microphone gives it: syllables of 120 ms split by 40 ms dips (the "p" and
     * "t" of "ouvre le portail"), after and before a quiet car. Fed in 512-byte frames (16 ms), the
     * car's buffer size; returns the listening's first event.
     */
    private fun listen(listening: Listening): String? {
        val syllables = (1..8).flatMap { sound(0.1, 120).toList() + sound(0.002, 40).toList() }
        val samples = sound(0.002, 300).toList() + syllables + sound(0.002, 5000).toList()
        return samples.chunked(256).firstNotNullOfOrNull { chunk -> pcm(*chunk.toShortArray()).let { listening.add(it, it.size) } }
    }

    @Test fun `a sentence with short dips between syllables is heard, its end found`() {
        assertEquals("end", listen(Listening()))
    }

    @Test fun `measured frame by frame, the same sentence was taken for silence`() {
        // The car app's behaviour before: one measure per 16 ms frame, every dip resets "speaking".
        assertEquals("nothing", listen(Listening(windowMs = 16)))
    }

    @Test fun `WAV header for 16 kHz mono 16-bit PCM`() {
        val data = pcm(1, 2, 3)
        val file = wav(data)
        val h = ByteBuffer.wrap(file).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(44 + data.size, file.size)
        assertEquals("RIFF", String(file, 0, 4))
        assertEquals(36 + data.size, h.getInt(4))
        assertEquals("WAVE", String(file, 8, 4))
        assertEquals("fmt ", String(file, 12, 4))
        assertEquals(16, h.getInt(16))
        assertEquals(1, h.getShort(20).toInt()) // PCM
        assertEquals(1, h.getShort(22).toInt()) // mono
        assertEquals(16_000, h.getInt(24))
        assertEquals(32_000, h.getInt(28)) // bytes per second
        assertEquals(2, h.getShort(32).toInt()) // bytes per frame
        assertEquals(16, h.getShort(34).toInt()) // bits per sample
        assertEquals("data", String(file, 36, 4))
        assertEquals(data.size, h.getInt(40))
        assertArrayEquals(data, file.copyOfRange(44, file.size))
    }
}
