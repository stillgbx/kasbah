package org.kasbah.auto

import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.testing.TestCarContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The car screens built as Android Auto builds them: the library checks each template against the
 * host's rules while building it (one titled action in a strip, for instance), so an invalid screen
 * fails here instead of showing "Kasbah ne répond pas" in the car.
 */
@RunWith(RobolectricTestRunner::class)
class CarScreensTest {
    private val car = TestCarContext.createCarContext(RuntimeEnvironment.getApplication())

    private val gate = Access("demo:gate", "Portail", "gate", null, "stopped", true)
    private val garage = Access("demo:garage", "Garage", "garage", 40, "opening", true)
    private val offline = Access("demo:garage2", "Garage 2", "garage", 0, "stopped", false)

    @Test fun `home screen has one tile per access, with its state`() {
        val screen = AccessScreen(car).apply { accesses = listOf(gate, garage, offline) }
        val grid = screen.onGetTemplate() as GridTemplate
        val tiles = grid.singleList!!.items.map { it as GridItem }
        assertEquals(listOf("Portail", "Garage", "Garage 2"), tiles.map { it.title.toString() })
        assertEquals(listOf("Unknown state", "Opening…", "Offline"), tiles.map { it.text.toString() })
    }

    @Test fun `home screen strip keeps a single titled action, the microphone being an icon`() {
        val grid = AccessScreen(car).apply { accesses = listOf(gate) }.onGetTemplate() as GridTemplate
        val actions = grid.actionStrip!!.actions
        assertEquals(1, actions.count { it.title != null })
        assertEquals("Car", actions.single { it.title != null }.title.toString())
        assertTrue(actions.any { it.icon != null && it.title == null })
    }

    @Test fun `home screen waits for the server, then says when there is nothing to show`() {
        assertTrue((AccessScreen(car).onGetTemplate() as GridTemplate).isLoading)
        val empty = AccessScreen(car).apply { accesses = emptyList() }.onGetTemplate() as MessageTemplate
        assertEquals("No gate or garage door in Kasbah.", empty.message.toString())
    }

    @Test fun `home screen shows a server error with a way to retry`() {
        val failed = AccessScreen(car).apply { error = "Session expired: sign in again on the phone." }.onGetTemplate() as MessageTemplate
        assertEquals("Session expired: sign in again on the phone.", failed.message.toString())
        assertEquals(listOf("Refresh"), failed.actions.map { it.title.toString() })
    }

    @Test fun `action screen offers Open and Close, and Stop at the top`() {
        val halfOpen = garage.copy(motion = "stopped")
        val action = AccessActionScreen(car, halfOpen).onGetTemplate() as MessageTemplate
        assertEquals("Garage", action.title.toString())
        assertEquals("40 % open", action.message.toString())
        assertEquals(listOf("Open", "Close"), action.actions.map { it.title.toString() })
        assertEquals(listOf("Stop"), action.actionStrip!!.actions.map { it.title.toString() })
    }

    @Test @Config(qualifiers = "fr") fun `action screen in French on a French phone`() {
        val action = AccessActionScreen(car, gate).onGetTemplate() as MessageTemplate
        assertEquals("État inconnu", action.message.toString())
        assertEquals(listOf("Ouvrir", "Fermer"), action.actions.map { it.title.toString() })
    }

    @Test fun `talk screen shows the answer alone, the car cutting what follows the start`() {
        val screen = VoiceScreen(car)
        assertEquals("Listening…", (screen.onGetTemplate() as MessageTemplate).message.toString())
        screen.answered("The living room is lit.")
        val answered = screen.onGetTemplate() as MessageTemplate
        assertEquals("The living room is lit.", answered.message.toString())
        assertEquals("Talk to Kasbah", answered.title.toString())
        screen.answered("")
        assertEquals("Done.", (screen.onGetTemplate() as MessageTemplate).message.toString())
    }
}
