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
