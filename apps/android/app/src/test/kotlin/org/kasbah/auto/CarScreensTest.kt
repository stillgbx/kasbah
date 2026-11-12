package org.kasbah.auto

import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.LongMessageTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.TabTemplate
import androidx.car.app.testing.TestCarContext
import androidx.core.graphics.drawable.IconCompat
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

    @Test fun `tiles take the short label, and a numbered access gets its own icon`() {
        val (g, first, second) = arrangeAccesses(listOf(gate, garage, offline), emptyList()) { if (it == "garage") "Garage" else "Portail" }
        val grid = AccessScreen(car).apply { accesses = listOf(g, first, second) }.onGetTemplate() as GridTemplate
        assertEquals(listOf("Portail", "Garage 1", "Garage 2"), grid.singleList!!.items.map { (it as GridItem).title.toString() })
        assertEquals(IconCompat.TYPE_RESOURCE, accessIcon(car, g).type)
        assertEquals(IconCompat.TYPE_BITMAP, accessIcon(car, second).type)
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
        assertEquals(listOf("Talk again", "Read all"), answered.actions.map { it.title.toString() })
    }

    @Test fun `the whole answer opens in a long message`() {
        val long = LongAnswerScreen(car, "A long answer.").onGetTemplate() as LongMessageTemplate
        assertEquals("A long answer.", long.message.toString())
    }

    private fun content(screen: HomeScreen) = (screen.onGetTemplate() as TabTemplate).tabContents.template

    @Test fun `home tabs, then the home grid, the accesses then the car and the house`() {
        val screen = HomeScreen(car).apply { accesses = listOf(gate, garage) }
        val tabs = screen.onGetTemplate() as TabTemplate
        assertEquals(listOf("Home", "Lights", "Covers", "Talk"), tabs.tabs.map { it.title.toString() })
        assertEquals("home", tabs.activeTabContentId)
        val tiles = (content(screen) as GridTemplate).singleList!!.items.map { (it as GridItem).title.toString() }
        assertEquals(listOf("Portail", "Garage", "Car", "House", "Cameras"), tiles)
    }

    @Test fun `the home grid keeps its reading tiles without any access`() {
        val screen = HomeScreen(car).apply { accesses = emptyList() }
        assertEquals(3, (content(screen) as GridTemplate).singleList!!.items.size)
    }

    @Test fun `cameras screen, one tile each, the icon when there is no still`() {
        val screen = CamerasScreen(car).apply { cameras = listOf(Camera("m:door", "Sonnette", true), Camera("m:lane", "Allée", false)) }
        val grid = screen.onGetTemplate() as GridTemplate
        assertEquals("Cameras", grid.title.toString())
        val items = grid.singleList!!.items.map { it as GridItem }
        assertEquals(listOf("Sonnette", "Allée"), items.map { it.title.toString() })
        assertTrue(items.all { it.imageType == GridItem.IMAGE_TYPE_ICON })
    }

    @Test fun `camera screen says when there is no still, and can read it again`() {
        val screen = CameraScreen(car, Camera("m:door", "Sonnette", true)).apply { loaded = true }
        val pane = (screen.onGetTemplate() as PaneTemplate).pane
        assertEquals("No picture yet", pane.rows.single().title.toString())
        assertEquals(listOf("Refresh"), pane.actions.map { it.title.toString() })
    }

    @Test fun `covers tab, by room, each with its state, a tap opens its action screen`() {
        val screen = HomeScreen(car).apply {
            tab = HomeScreen.TAB_COVERS
            covers = listOf(
                Access("m:s", "Volet salon", "shutter", 0, "stopped", true, room = "Salon"),
                Access("m:a", "Store terrasse", "awning", null, "stopped", true),
            )
        }
        val list = content(screen) as ListTemplate
        assertEquals(listOf("Salon", "Elsewhere"), list.sectionedLists.map { it.header.toString() })
        val rows = list.sectionedLists.map { it.itemList.items.single() as Row }
        assertEquals(listOf("Closed", "Unknown state"), rows.map { it.texts.single().toString() })
        assertTrue(rows.all { it.onClickDelegate != null })
    }

    @Test fun `lights tab, a section per room, its scenes then a switch per lamp`() {
        val screen = HomeScreen(car).apply {
            tab = HomeScreen.TAB_LIGHTS
            lights = listOf(Light("a", "Ceiling", true, true, "Salon"), Light("b", "Garden", false, false, null))
            scenes = listOf(Scene("m:read", "Lecture", "Salon", true, listOf(0xFFFFF1D6.toInt())))
        }
        val list = content(screen) as ListTemplate
        assertEquals(listOf("Salon", "Elsewhere"), list.sectionedLists.map { it.header.toString() })
        val salon = list.sectionedLists[0].itemList.items.map { it as Row }
        assertEquals(listOf("Lecture", "Ceiling"), salon.map { it.title.toString() })
        assertEquals("On", salon[0].texts.single().toString())
        assertTrue(salon[0].toggle == null)
        val lamps = list.sectionedLists.map { it.itemList.items.last() as Row }
        assertEquals(listOf(true, false), lamps.map { it.toggle!!.isChecked })
        assertEquals(listOf(true, false), lamps.map { it.toggle!!.isEnabled })
    }

    @Test fun `talk tab, a single button to talk again`() {
        val screen = HomeScreen(car).apply { tab = HomeScreen.TAB_TALK }
        assertEquals(listOf("Talk"), (content(screen) as MessageTemplate).actions.map { it.title.toString() })
    }

    @Test fun `house screen, the figures to read, no button`() {
        val screen = HouseScreen(car).apply {
            status = HouseStatus(insideC = 21.5, solarW = 3000.0, charger = "charging", chargerW = 7000.0, lightsOn = 2)
        }
        val pane = (screen.onGetTemplate() as PaneTemplate).pane
        assertEquals(listOf("Inside", "Solar", "Charger", "Lights"), pane.rows.map { it.title.toString() })
        assertEquals("2 on", pane.rows.last().texts.single().toString())
        assertTrue(pane.actions.isEmpty())
    }

    @Test fun `a tab's failure shows its message and a refresh`() {
        val screen = HomeScreen(car).apply { tab = HomeScreen.TAB_LIGHTS; error = "Session expired: sign in again on the phone." }
        val failed = content(screen) as MessageTemplate
        assertEquals("Session expired: sign in again on the phone.", failed.message.toString())
        assertEquals("Refresh", failed.actions.single().title.toString())
    }
}
