# Hörmann (garage doors)

| | |
|---|---|
| **Id** | `hormann` |
| **Devices** | Hörmann SupraMatic series 4 garage doors: two Kasbah devices per door, the door (`cover`, garage class) and the motor's light (`light`) |
| **Connection** | **local**: HTTP to an [HCPBridgeMqtt](https://github.com/Gifford47/HCPBridgeMqtt) bridge (ESP32 + RS485) plugged into the motor's BUS socket; no cloud, no MQTT broker |
| **Account** | no account: each bridge's address and web password go in `.env` |
| **Views** | Openings, Home (device panels), Settings → Plugins |

## What the plugin does

- **Door**: open, close, stop, and go to a position (0-100 %). The door's position and movement (opening, closing, at rest) are shown as they change.
- **Light**: on / off of the motor's light. Remote controls, wall buttons and BlueSecur are picked up as well: Kasbah reads the motor, not its own commands.
- A command counts as done once the door is **seen moving** (or the light changes): the bridge acknowledges every command, even one it drops, so Kasbah checks the effect and reports a failure otherwise.

Hörmann has no public API, and BlueSecur is Bluetooth only. The bridge talks to the motor over its HCP2 bus, like a Hörmann UAP 1-HCP accessory.

## Connection

The Kasbah server reads each bridge's `/status` every 2 seconds on the house network. The bridge's event stream (`/events`) is not used: it only carries the bridge's optional sensors, never the door.

## Setup

1. **Build one bridge per door**: an ESP32 with an RS485 transceiver, flashed with HCPBridgeMqtt (v1.0.2 checked, on an M5Stack Atom Lite with its Atomic RS485 Base). Connect it to the motor's **BUS** socket (RJ12): pins 1-2 GND, 3 B−, 4 A+, 5-6 +24 V. A cable with only the four middle wires is enough.
2. In the bridge's web interface (Expert tab), check the RS485 pins. **On the Atom Lite + Atomic RS485 Base, set TX = 19 and RX = 22**: the firmware's defaults for that board are swapped.
3. **Run a bus scan** on the motor (menu 37, parameter 01, hold PRG until "bS" shows). The motor only powers the bus during the scan and keeps it on if an accessory answers: the display ends on **1**. A **0** means nothing answered (wiring, A/B swapped, pins).
4. Set a password for the bridge's web interface, and give each bridge a **static DHCP lease**.
5. In `apps/server/.env`, set `HORMANN_DOORS` (see below), then restart the server.
6. Tick **Hormann** in **Settings → Plugins**. As long as `HORMANN_DOORS` is empty, the plugin stays "Pairing required".
7. Place the door and its light in the house like any other device.

If you unplug a bridge, run a bus scan again, otherwise the motor shows error 04.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `HORMANN_DOORS` | empty | JSON array, one object per door: `id` (your choice, letters, digits, `_`, `-`), `host` (bridge address), `password` (web password, user `admin`; empty if none), `name` |
| `HORMANN_POLL_MS` | `2000` | Reading interval of each bridge, from 500 to 60,000 ms |
| `HORMANN_COMMAND_TIMEOUT_MS` | `5000` | Wait for the door to start moving after a command, from 500 to 30,000 ms |

Example, with fictional values:

```
HORMANN_DOORS=[{"id":"garage1","host":"192.168.1.51","password":"<web-password>","name":"Garage door 1"}]
```

## Limitations

- **Series 4 only** (SupraMatic E/P 4, ProMatic 4): series 3 motors speak another protocol. SupraMatic E 4 motors built in 2025 are reported not to be decoded by the bridge.
- The motor's **half-open and ventilation positions** are not offered yet.
- The light only toggles on the bridge side: Kasbah sends a toggle only when the light's state differs from the one asked.
- Positions below 5 % and above 95 % become a full close or a full open (firmware choice).
- The bridge's over-the-air update is protected by a fixed `admin` / `admin` password built into the firmware: anyone on the local network can reflash it.
- The web password is in `.env` in clear text: protect that file.

## Further reading

Internals, firmware findings and the bus scan: [wiki, Hörmann](../../doc/3_plugins/3_26_hormann.md) (in French).
