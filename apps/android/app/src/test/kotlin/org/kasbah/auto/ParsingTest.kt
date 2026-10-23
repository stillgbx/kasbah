package org.kasbah.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** What the app reads from the server: the session cookie, the gates and garage doors, the answer. */
class ParsingTest {
    @Test fun `session cookie found whatever the header's case`() {
        val headers = mapOf<String?, List<String>>(
            null to listOf("HTTP/1.1 303 See Other"),
            "set-cookie" to listOf("other=1; Path=/", "__Host-kasbah_session=abc.123; Path=/; Secure; HttpOnly"),
        )
        assertEquals("abc.123", sessionCookie(headers))
    }

    @Test fun `no session cookie on the local network`() {
        assertNull(sessionCookie(mapOf(null to listOf("HTTP/1.1 302 Found"), "Location" to listOf("/"))))
    }

    private val devices = """
        {"devices": [
          {"descriptor": {"id": "demo:shutter", "kind": "cover", "name": "Volet", "meta": {"cover": {"deviceClass": "shutter"}}},
           "state": {"kind": "cover", "position": 0, "motion": "stopped", "available": true}},
          {"descriptor": {"id": "demo:garage", "kind": "cover", "name": "Garage", "meta": {"cover": {"deviceClass": "garage"}}},
           "state": {"kind": "cover", "position": 62.5, "motion": "opening", "available": true}},
          {"descriptor": {"id": "demo:lamp", "kind": "light", "name": "Lampe", "meta": {}}, "state": null},
          {"descriptor": {"id": "demo:gate", "kind": "cover", "name": "Portail", "meta": {"cover": {"deviceClass": "gate"}}},
           "state": {"kind": "cover", "motion": "stopped", "available": false}}
        ]}
    """

    @Test fun `only gates and garage doors, gates first`() {
        val list = parseAccesses(devices)
        assertEquals(listOf("demo:gate", "demo:garage"), list.map { it.id })
    }

    @Test fun `state read as the server gives it`() {
        val (gate, garage) = parseAccesses(devices)
        assertEquals(Access("demo:gate", "Portail", "gate", null, "stopped", false), gate)
        assertEquals(Access("demo:garage", "Garage", "garage", 62, "opening", true), garage)
    }

    @Test fun `the answer is the text lines of the stream`() {
        val body = """
            {"type":"tool","id":"1","name":"get_device","input":{}}
            {"type":"tool_result","id":"1","ok":true}
            {"type":"text","text":"Le salon est allumé."}
            {"type":"text","text":"La cuisine aussi."}
            {"type":"done","ms":4200}
        """.trimIndent()
        assertEquals("Le salon est allumé.\nLa cuisine aussi.", parseAnswer(body, "Failed."))
    }

    @Test fun `an error line becomes the error, with the fallback when it says nothing`() {
        val busy = assertThrows(KasbahError::class.java) {
            parseAnswer("""{"type":"error","code":"BUSY","message":"Une instruction est déjà en cours."}""", "Failed.")
        }
        assertEquals("Une instruction est déjà en cours.", busy.message)
        val silent = assertThrows(KasbahError::class.java) { parseAnswer("""{"type":"error","code":"TIMEOUT"}""", "Failed.") }
        assertEquals("Failed.", silent.message)
    }

    @Test fun `plug names as cars write them, the code otherwise`() {
        assertEquals("Type 2", plugName(2))
        assertEquals("CCS2", plugName(5))
        assertEquals("#42", plugName(42))
    }

    @Test fun `the house's position is its origin`() {
        assertEquals(Home(45.0, 5.0), parseHome("""{"name": "Démo", "origin": {"lat": 45, "lon": 5, "alt": 0, "heading": 20}}"""))
    }

    @Test fun `no position for a house without origin`() {
        assertNull(parseHome("""{"name": "Démo"}"""))
        assertNull(parseHome("""{"origin": {"heading": 20}}"""))
    }

    private val kinds = { kind: String -> if (kind == "garage") "Garage" else "Portail" }
    private val gate = Access("g", "Portail du jardin", "gate", 0, "stopped", true)
    private val left = Access("l", "Porte de garage gauche", "garage", 0, "stopped", true)
    private val right = Access("r", "Porte de garage droite", "garage", 0, "stopped", true)

    @Test fun `a kind alone keeps its name, several are numbered in the server's order`() {
        val list = arrangeAccesses(listOf(gate, left, right), emptyList(), kinds)
        assertEquals(listOf("Portail", "Garage 1", "Garage 2"), list.map { it.label })
        assertEquals(listOf(null, 1, 2), list.map { it.number })
    }

    @Test fun `the phone's order sorts and numbers, the unknown ones after`() {
        val list = arrangeAccesses(listOf(gate, left, right), listOf("r", "g"), kinds)
        assertEquals(listOf("r", "g", "l"), list.map { it.id })
        assertEquals(listOf("Garage 1", "Portail", "Garage 2"), list.map { it.label })
    }

    @Test fun `the alert takes the two chosen, else the first two`() {
        val list = listOf(gate, left, right)
        assertEquals(listOf("g", "r"), alertAccesses(list, setOf("r", "g")).map { it.id })
        assertEquals(listOf("g", "l"), alertAccesses(list, emptySet()).map { it.id })
        assertEquals(listOf("g", "l"), alertAccesses(list, setOf("gone")).map { it.id })
    }
}
