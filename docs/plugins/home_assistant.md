# Home Assistant

| | |
|---|---|
| **Id** | `home_assistant` |
| **Devices** | the lights, covers, heaters, temperature and humidity sensors and media players of a Home Assistant installation (`light`, `cover`, `climate`, `sensor`, `media_player`) |
| **Connection** | **local**: Home Assistant's WebSocket API (`/api/websocket`), one connection for the states, the events and the commands |
| **Account** | a Home Assistant long-lived access token, in `.env` |
| **Views** | every view of the kinds above, Home (device panels), Settings → Plugins |

Contributed by [qgiu](https://github.com/qgiu).

## What the plugin does

For anyone who already runs Home Assistant and wants to try Kasbah without changing anything there, or to move to Kasbah one device at a time.

- Each entity shows up in the **house room of the same name** as its Home Assistant area, through auto-placement.
- **Home Assistant stays the only one in command.** A Kasbah command becomes a `call_service`, and the new state comes back through the `state_changed` events. The plugin creates no automation and changes nothing in Home Assistant.
- **Lights**: on / off, brightness, colour temperature and colour, as the light supports them.
- **Covers**: open, close, stop, position, tilt. A cover group (an entity listing other covers) is marked as a group.
- **Heaters**: modes and set point. A heater driven by presets only (pilot wire through Overkiz) offers on / off and no set point; Home Assistant's presets are not shown.
- **Sensors**: temperature and humidity by default (`HA_SENSOR_CLASSES`).
- **Players**: play, pause, next, volume, mute, seek, and what is playing. The cover art goes **through the Kasbah server**: Home Assistant's picture address carries an access token and points at the local network.
- **Quiet mode of Somfy covers**: the Overkiz integration publishes a "slow speed" twin `cover.x_low_speed` next to `cover.x`. The twin is absorbed, and becomes the cover's quiet mode: with it on, commands go to the slow twin. The choice is kept by Kasbah (`HA_STATE_FILE`).

## Choosing what shows up

**Settings → Plugins → Home Assistant** lists every entity Kasbah can translate, grouped by Home Assistant **integration** (Hue, Overkiz, Cast…): duplicates come from the brand, not from the kind of device.

- **All of them are shown by default**, new ones included.
- **Except duplicates**: an entity whose integration is driven natively by a Kasbah plugin that is **on** is hidden, and its group says so. Turning that plugin on or off updates the list at once. Integrations matched: `hue` → Hue, `overkiz` / `somfy` → TaHoma, `cast` → Google Cast, `sonos`, `nest`, `roomba` → iRobot, `husqvarna_automower` → Automower, `enphase_envoy` → Enphase, `melcloud`, `tuya`, `tesla_fleet` / `teslemetry` / `tessie` → Tesla, `renault`, `open_meteo`.
- A switch per entity, and **Show all / Hide all** per integration. A choice that matches the default is forgotten, so the entity keeps following the native plugin.

Moving a device from Home Assistant to Kasbah is then: turn on the native plugin, check the device there, and its Home Assistant twin disappears by itself.

## Setup

1. In Home Assistant: your profile → **Security** → **Long-lived access tokens** → create one.
2. In `apps/server/.env`, set `HA_URL` and `HA_TOKEN` (or `HA_TOKEN_FILE`), then restart the server.
3. Tick **Home Assistant** in **Settings → Plugins**, open it and choose what shows up.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `HA_URL` | empty | Home Assistant's address, e.g. `http://192.168.1.10:8123` |
| `HA_TOKEN` | empty | Long-lived access token |
| `HA_TOKEN_FILE` | empty | Or: the path of a file holding the token |
| `HA_DOMAINS` | `light,cover,climate,sensor,media_player` | Home Assistant domains taken |
| `HA_SENSOR_CLASSES` | `temperature,humidity` | Sensor classes taken |
| `HA_SLOW_SUFFIX` | `_low_speed` | Suffix of the slow twin covers absorbed as quiet mode; empty = none |
| `HA_STATE_FILE` | `.state/home-assistant.json` | The choices made in Settings and the covers in quiet mode |

Entities that are disabled, hidden, or of the `config` / `diagnostic` category in Home Assistant are never offered.

## Limitations

- Not taken yet: cameras, vacuums, fans, locks, switches, alarms.
- **Automation loops**: Kasbah automations that drive Home Assistant devices, on top of Home Assistant's own, can answer each other. Keep each device's automations on one side.
- The token gives full access to Home Assistant: protect `.env`.
