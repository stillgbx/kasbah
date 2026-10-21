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
- Asking for the opposite direction while the door moves (closing while it opens) **stops it first**, then sends the command: the motor ignores a command against the movement in progress.
- A command counts as done once the door is **seen moving** (or the light changes): the bridge acknowledges every command, even one it drops, so Kasbah checks the effect and reports a failure otherwise.

Hörmann has no public API, and BlueSecur is Bluetooth only. The bridge talks to the motor over its HCP2 bus, like a Hörmann UAP 1-HCP accessory.

## Connection

The Kasbah server reads each bridge's `/status` every 2 seconds on the house network. The bridge's event stream (`/events`) is not used: it only carries the bridge's optional sensors, never the door.

## Hardware

One bridge per door. The combination checked on a real door:

- an [M5Stack ATOM Lite](https://openelab.io/fr/products/m5stackatomliteesp32) (ESP32, SKU M5-C008);
- its [M5Stack ATOMIC TTL-RS485 Base](https://openelab.io/fr/products/m5stack-ttl-rs485) (SKU M5-A131): SP3485 transceiver, DC-DC converter that powers the ATOM from the bus's 24 V, VH-3.96 4-pin terminal;
- an RJ12 cable. One with only the **four middle wires** (pins 2 to 5) is enough: ground and 24 V are doubled on the outer pins.

Any ESP32 with an RS485 transceiver works with HCPBridgeMqtt; only the RS485 pins change.

## Flashing the bridge

HCPBridgeMqtt publishes no binary for the ATOM Lite: build it with PlatformIO from the [project's sources](https://github.com/Gifford47/HCPBridgeMqtt) (environment `m5stack-atom-lite`, v1.0.2 checked). On Windows, build in a short path (`C:\pio`, for instance): a long temporary folder makes the compiler fail.

To flash a built firmware again (a second bridge) without PlatformIO, use the `esptool.py` that PlatformIO installed, with any Python that has `pyserial`, **at 115,200 baud** (921,600 drops on the ATOM's FTDI serial chip):

```
python esptool.py --chip esp32 --port COMx --baud 115200 erase_flash
python esptool.py --chip esp32 --port COMx --baud 115200 write_flash -z 0x1000 bootloader.bin 0x8000 partitions.bin 0xe000 boot_app0.bin 0x10000 m5stack-atom-lite.bin
```

`bootloader.bin`, `partitions.bin` and `m5stack-atom-lite.bin` are in `.pio/build/m5stack-atom-lite/`; `boot_app0.bin` comes with the Arduino framework (`framework-arduinoespressif32/tools/partitions/`). The ATOM Lite's LED lights when it is powered over USB-C, not when it is powered from the base: on the motor, an unlit LED proves nothing, a ping does.

## First configuration of the bridge

1. Power the ATOM over USB. On its first start it opens a Wi-Fi access point named **HCPBRIDGE**, password **`gifford47`** (the firmware's public default).
2. Join it and open **http://192.168.4.1/** (no password yet).
3. In **Basic Configuration**: your Wi-Fi network and password, a **Hostname** and a **Device Name** per door, and a **Web Password**. Leave **Enable Wifi AP** ticked for now, then **Save & Restart**.
4. Back on your own network, open the bridge at its new address:
   - **Expert Configuration**: **TX = 19 and RX = 22** on the ATOM Lite + ATOMIC TTL-RS485 Base. The firmware's defaults for that board are swapped, and a bus scan then always ends on 0;
   - untick **Enable Wifi AP**, then **Save & Restart**. Untick it only once the bridge answers on your network: without the access point and without Wi-Fi, the only way back is pressing the ATOM's button 5 times (factory reset).
5. **Device ID** only names the MQTT topics: Kasbah does not use it, but give each bridge its own (`garage-1`, `garage-2`) in case a broker is added later.
6. Give each bridge a **static DHCP lease** in your router.

## Setup

1. Connect the bridge to the motor's **BUS** socket (RJ12, the one next to the screw terminal; the other one is the safety input): pins 1-2 GND, 3 B−, 4 A+, 5-6 +24 V. On the base's terminal: GND → G, B− → B, A+ → A, +24 V → DC. Cable colours follow no standard: go by the pin numbers.
2. **Run a bus scan** on the motor: hold PRG until `00`, arrows to menu **37**, short PRG, parameter **01**, hold PRG until `bS` blinks. The motor only powers the bus **during the scan** (0 V on the socket at rest is normal) and keeps it on if an accessory answers: the display ends on **1**. A **0** means nothing answered: A/B swapped (harmless, swap them), RS485 pins, or the bridge too slow to start (then power the base from the screw terminal: 5 = +24 V → DC, 20 = 0 V → G).
3. In `apps/server/.env`, set `HORMANN_DOORS` (see below), then restart the server.
4. Tick **Hormann** in **Settings → Plugins**. As long as `HORMANN_DOORS` is empty, the plugin stays "Pairing required".
5. Link the door to its opening (edit mode, select the opening, **Linked cover** list: a door never placed in the house is offered too), and place its light on the ceiling (**Lights** view → **Place**, then **Mounting height → Ceiling**).

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
