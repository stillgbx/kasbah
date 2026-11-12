package org.kasbah.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
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

    @Test fun `no session cookie from the server's own computer`() {
        // through `adb reverse`, `localhost` is the server's computer: it needs no account
        assertNull(sessionCookie(mapOf(null to listOf("HTTP/1.1 302 Found"), "Location" to listOf("/"))))
    }

    @Test fun `a password only goes over HTTPS, or to the server's own computer`() {
        for (url in listOf("https://kasbah.example.org", "HTTPS://kasbah.example.org/", "http://localhost:9789", "http://127.0.0.1:8787", "http://[::1]:8787")) {
            assertTrue(url, signsInThere(url))
        }
        for (url in listOf("http://192.168.1.20:8787", "http://kasbah.home.internal:8787", "http://kasbah.example.org", "http://localhost.example.org", "kasbah.example.org", "")) {
            assertFalse(url, signsInThere(url))
        }
    }

    @Test fun `the journal keeps the newest lines first, and drops the oldest`() {
        assertEquals(listOf("c", "b", "a"), journalWith(listOf("b", "a"), "c"))
        assertEquals(listOf("c", "b"), journalWith(listOf("b", "a"), "c", max = 2))
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

    private val houseDevices = """{"devices":[
        {"descriptor":{"id":"m:l1","kind":"light","name":"Ceiling"},"state":{"on":true,"available":true}},
        {"descriptor":{"id":"m:l2","kind":"light","name":"Garden"},"state":{"on":false,"available":true}},
        {"descriptor":{"id":"m:l3","kind":"light","name":"Lamp"},"state":{"on":true,"available":false}},
        {"descriptor":{"id":"m:pac","kind":"climate","name":"Zone 2","meta":{"climate":{"control":"flow"}}},"state":{"currentTempC":45,"available":true}},
        {"descriptor":{"id":"m:th","kind":"climate","name":"Thermostat"},"state":{"currentTempC":21.5,"available":true}},
        {"descriptor":{"id":"m:sun","kind":"energy","name":"Solar"},"state":{"productionW":3000,"available":true}},
        {"descriptor":{"id":"m:ev","kind":"ev_charger","name":"Charger"},"state":{"status":"charging","powerW":7000,"available":true}},
        {"descriptor":{"id":"m:cam","kind":"camera","name":"Gate"},"state":{"available":true}}
    ]}"""

    @Test fun `lamps carry their house room, none when placed outside one`() {
        val house = """{"rooms":[{"id":"living","name":"Salon"}],"devices":[{"deviceId":"m:l1","roomId":"living"},{"deviceId":"m:l2"}]}"""
        val lights = parseLights(houseDevices, house)
        assertEquals(listOf("m:l1", "m:l2", "m:l3"), lights.map { it.id })
        assertEquals(listOf("Salon", null, null), lights.map { it.room })
        assertEquals(listOf(true, false, true), lights.map { it.on })
        assertFalse(lights[2].available)
    }

    @Test fun `each room gets its scenes then its lamps, a vendor zone its own section, the rest last`() {
        val l = listOf(Light("a", "A", false, true, null), Light("b", "B", false, true, "Home cinéma"), Light("c", "C", false, true, "Cuisine"), Light("d", "D", false, true, "Home cinéma"))
        val s = listOf(
            Scene("film", "Film", "home cinema", false, emptyList()),
            Scene("summer", "Soirée d'été", "Extérieur", false, emptyList()),
            Scene("night", "Nuit", null, false, emptyList()),
        )
        assertEquals(
            listOf(
                Triple("Home cinéma", listOf("film"), listOf("b", "d")),
                Triple("Cuisine", emptyList(), listOf("c")),
                Triple("Extérieur", listOf("summer"), emptyList()),
                Triple("Ailleurs", listOf("night"), listOf("a")),
            ),
            roomSections(l, s, "Ailleurs").map { Triple(it.name, it.scenes.map { x -> x.id }, it.lights.map { x -> x.id }) },
        )
        assertEquals(listOf("Cuisine"), roomSections(l.filter { it.room == "Cuisine" }, emptyList(), "Ailleurs").map { it.name })
    }

    @Test fun `scenes with their room, state and colors`() {
        val body = """{"scenes":[
            {"scene":{"id":"m:read","name":"Lecture","group":{"name":"Salon","kind":"room"},"swatches":["#fff1d6","bad"]},"state":{"active":"static"}},
            {"scene":{"id":"m:night","name":"Nuit","swatches":[]},"state":{"active":"inactive"}}
        ]}"""
        val scenes = parseScenes(body)
        assertEquals(listOf("Salon", null), scenes.map { it.group })
        assertEquals(listOf(true, false), scenes.map { it.active })
        assertEquals(listOf(0xFFFFF1D6.toInt()), scenes[0].swatches)
    }

    @Test fun `covers are the shutters and the like, with their room, never the gate or garage doors`() {
        val body = """{"devices":[
            {"descriptor":{"id":"m:s","kind":"cover","name":"Volet salon","meta":{"cover":{"deviceClass":"shutter"}}},"state":{"position":100,"motion":"stopped","available":true}},
            {"descriptor":{"id":"m:g","kind":"cover","name":"Portail","meta":{"cover":{"deviceClass":"gate"}}},"state":{"available":true}},
            {"descriptor":{"id":"m:w","kind":"cover","name":"Velux","meta":{"cover":{"deviceClass":"window"}}},"state":{"motion":"stopped","available":false}},
            {"descriptor":{"id":"m:l","kind":"light","name":"Lamp"},"state":{"on":true,"available":true}}
        ]}"""
        val house = """{"rooms":[{"id":"living","name":"Salon"}],"devices":[{"deviceId":"m:s","roomId":"living"}]}"""
        val covers = parseCovers(body, house)
        assertEquals(listOf("m:s", "m:w"), covers.map { it.id })
        assertEquals(listOf("Salon", null), covers.map { it.room })
        assertEquals(listOf(100, null), covers.map { it.position })
        assertFalse(covers[1].available)
    }

    @Test fun `rooms come in the web app's order, levels from the top, the chosen order then by name`() {
        val house = """{
            "levels":[{"id":"rdc","elevation":0,"roomOrder":["salon"]},{"id":"etage","elevation":2.7}],
            "rooms":[{"id":"cuisine","levelId":"rdc","name":"Cuisine"},{"id":"bureau","levelId":"rdc","name":"Bureau"},
                     {"id":"salon","levelId":"rdc","name":"Salon"},{"id":"chambre","levelId":"etage","name":"Chambre"}],
            "devices":[{"deviceId":"m:1","roomId":"cuisine"},{"deviceId":"m:2","roomId":"chambre"},{"deviceId":"m:3","roomId":"salon"},
                       {"deviceId":"m:4","roomId":"salon"},{"deviceId":"m:5","roomId":"bureau"}]
        }"""
        assertEquals(listOf("Chambre", "Salon", "Bureau", "Cuisine"), roomOrder(house))
        val devices = """{"devices":[
            {"descriptor":{"id":"m:1","kind":"light","name":"Spots"},"state":{"available":true}},
            {"descriptor":{"id":"m:6","kind":"light","name":"Jardin"},"state":{"available":true}},
            {"descriptor":{"id":"m:4","kind":"light","name":"Suspension"},"state":{"available":true}},
            {"descriptor":{"id":"m:2","kind":"light","name":"Plafonnier"},"state":{"available":true}},
            {"descriptor":{"id":"m:3","kind":"light","name":"Lampadaire"},"state":{"available":true}},
            {"descriptor":{"id":"m:5","kind":"light","name":"Lampe"},"state":{"available":true}}
        ]}"""
        // by room in that order, by name within a room, the lamp of no room last
        assertEquals(listOf("m:2", "m:3", "m:4", "m:5", "m:1", "m:6"), parseLights(devices, house).map { it.id })
    }

    @Test fun `a still's age counts calendar days, not 24-hour spans`() {
        val zone = java.time.ZoneId.of("Europe/Paris")
        fun at(day: Int, h: Int, m: Int) = java.time.ZonedDateTime.of(2026, 11, day, h, m, 0, 0, zone).toInstant().toEpochMilli()
        // 19:07 read at 18:01 the next day: less than 24 hours, but yesterday
        assertEquals(1L, daysAgo(at(11, 19, 7), at(12, 18, 1), zone))
        assertEquals(0L, daysAgo(at(12, 0, 5), at(12, 23, 59), zone))
        assertEquals(3L, daysAgo(at(9, 12, 0), at(12, 8, 0), zone))
    }

    @Test fun `cameras are the devices of kind camera, in the server's order`() {
        val cameras = parseCameras(houseDevices)
        assertEquals(listOf(Camera("m:cam", "Gate", true)), cameras)
    }

    @Test fun `the house's state skips a zone regulated on its flow water, and offline lamps`() {
        val s = parseStatus(houseDevices)
        assertEquals(21.5, s.insideC!!, 0.0)
        assertEquals(3000.0, s.solarW!!, 0.0)
        assertEquals("charging", s.charger)
        assertEquals(7000.0, s.chargerW!!, 0.0)
        assertEquals(1, s.lightsOn)
        assertEquals("m:cam", s.camera)
    }
}
