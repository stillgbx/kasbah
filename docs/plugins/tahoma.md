# Somfy TaHoma

| | |
|---|---|
| **Id** | `tahoma` |
| **Devices** | roller shutters, blinds, gates, garage doors, windows (`cover`), and the light sensor of solar shutters |
| **Connection** | **local**: the box's "developer mode" API (Overkiz platform), on the house network |
| **Account** | no online account: a token generated in the "TaHoma by Somfy" mobile app |
| **Views** | Home (3D markers, room panel), Covers, Settings → Plugins |

![Covers view](../screenshots/covers.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **Covers**: open, close, stop mid-travel; aim for a **position** as a percentage when the motor can do it (io-homecontrol motors).
- **Preset position** (Somfy's "my" button): recall it from Kasbah, and on io shutters **save** it again ("Save this position").
- **Quiet mode** (compatible io shutters): moves started from Kasbah run at low speed, which is quieter. This is a Kasbah setting; the wall remote keeps its speed.
- **Battery** of the solar shutters, and the **light level** picked up by their panel, with a Day / Month / Year chart built by Kasbah (the box keeps none).
- **State feedback**: the box is polled every 2 seconds (it pushes nothing), so a shutter operated with the remote is seen almost at once.
- **RTS** motors (one-way radio, no feedback) can be controlled, but their position is only **assumed** from the last command, and flagged as such: with no command sent through Kasbah since startup, the state is "Unknown".
- **Placement**: the box does not say which room a shutter is in. Covers arrive as "No opening": in the **Covers** view, **Assign to** a window or door of the house places them in the 3D scene.

The rest of the box (sensors, heating, gateways, audio players) is ignored, and the box's scenarios are not imported.

## Connection

Everything goes through the local network: the Kasbah server talks HTTPS to the box, on port 8443, with the token in a header. No call to the Somfy cloud during operation. The box's certificate is signed by an Overkiz authority and issued for the name `gateway-<PIN>.local`: it is accepted for this one client only, which also makes it possible to reach the box by its IP address.

## Setup

**Developer mode** can only be enabled from the mobile app (the Somfy cloud is what sets it on the box): neither a website nor the local network can do it. As long as it is not active, the box's port stays closed.

1. In the **TaHoma by Somfy** app: "Configure the installation", then "Access the settings" of the box. Tap the gateway's PIN code (of the form `1234-5678-9012`) **seven times** to enable developer mode.
2. **Resynchronise the box**: the local API is only really served afterwards.
3. "Developer mode" menu: **generate a token** and copy it right away, it can only be displayed when it is created.
4. In `apps/server/.env`, set `TAHOMA_HOST` (the name `gateway-<PIN>.local`, or the box's IP with a fixed DHCP lease) and `TAHOMA_TOKEN` (the token).
5. Tick **Tahoma** in **Settings → Plugins**, then restart the server: `.env` is only read at startup.

The plugin's status in Settings tells you where you stand:

| Message | Meaning |
|---|---|
| "Error", "no local API on …" | box unreachable, or developer mode not enabled / box not resynchronised |
| "Pairing required" | the local API answers, but `TAHOMA_TOKEN` is missing |
| "Error", "token rejected" | token refused: generate a new one (a token may never be registered by the box) |

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `TAHOMA_HOST` | — (required) | `gateway-<PIN>.local` or IP address of the box: there is no discovery |
| `TAHOMA_PORT` | `8443` | Port of the local API |
| `TAHOMA_TOKEN` | — | Token generated in the mobile app |
| `TAHOMA_TLS_INSECURE` | `true` | Accepts the box's certificate, signed by a non-public Overkiz authority |
| `TAHOMA_POLL_MS` | `2000` | Polling interval of the box (500 to 60 000 ms) |
| `TAHOMA_COMMAND_MODE` | `queue` | Sending several commands at once (automation, scene): `queue` sends them one by one, `batch` groups them into a single execution, like a TaHoma scenario |
| `TAHOMA_LIGHT_HISTORY_FILE` | `apps/server/.state/tahoma-light-history.json` | Light-level history of the solar shutters; empty = not saved |
| `TAHOMA_QUIET_FILE` | `apps/server/.state/tahoma-quiet.json` | Shutters in quiet mode; empty = not saved |

## Limitations

- **No position during travel**: the box only publishes it at the end of the movement. The interface shows the direction ("Closing") then jumps to the final value.
- **RTS**: the assumed position becomes wrong as soon as the wall remote is used. Stopping an RTS or recalling its preset position **clears** the displayed position, for honesty. The preset position button is offered as soon as the box declares it, even if the motor has none stored; it is recorded with the wall remote.
- Gates with a single "cycle" command (no separate open and close) are ignored. Slat tilt exists but has not been verified on hardware.
- The light level of the solar shutters is only recorded while the server is running: an hour when it was stopped stays empty. Whether the box actually relays luminance locally remains to be confirmed in sunny weather.
- **Saving** a preset position has not been tried on a real box (simulation only): quiet mode, on the other hand, has been verified on a real shutter.

## Further reading

Internals, captures from the box and pitfalls: [wiki, Somfy TaHoma](../../doc/3_plugins/3_4_somfy-tahoma.md) (in French).
