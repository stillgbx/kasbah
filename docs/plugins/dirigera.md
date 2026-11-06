# IKEA DIRIGERA

| | |
|---|---|
| **Id** | `dirigera` |
| **Devices** | TRÅDFRI and Matter devices paired to the hub: lights and outlets (`light`), blinds (`cover`), measurements (`sensor`) |
| **Connection** | **local**: the hub's unofficial API (HTTPS port 8443 + WebSocket), on the house network |
| **Account** | no online account: a token obtained by pressing the hub's action button |
| **Views** | Lights, Covers, Home (3D markers), Settings → Plugins |

> **Not yet tried on a real hub.** The plugin was written from the community `dirigera` library and
> its types, without a DIRIGERA hub on hand. Expect adjustments on first use, and please report what
> differs.

## What the plugin does

- **Lights**: on, off, brightness, warm / cool white and color, depending on the bulb.
- **Outlets**: on and off; a metering outlet (INSPELNING) also gives its **power** (W) and **energy** (kWh) as sensors attached to it.
- **Blinds** (FYRTUR, KADRILJ, PRAKTLYSING…): open, close, position, stop, and the motor's battery level.
- **Measurements** of any device that has them: temperature, humidity, PM2.5, CO₂, illuminance (VINDSTYRKA, ALPSTUGA, light sensors).
- **Real time**: changes made elsewhere (IKEA Home smart app, remote, wall switch) arrive through the hub's event stream.
- The hub's room names travel with the devices: a device not declared in the house file is placed in the house room of the **same name**.

Not covered yet: remotes and shortcut buttons, motion / door / leak sensors, the STARKVIND air purifier, the hub's scenes. **SYMFONISK speakers** are Sonos speakers: use the [Sonos plugin](sonos.md), not this one.

## Connection

Everything stays on the local network: the Kasbah server talks to the hub over HTTPS and keeps a WebSocket open for its events. The hub's certificate is self-signed: Kasbah remembers it at the first connection and refuses another one afterwards (pairing again accepts a new certificate). No call to IKEA's servers.

## Setup

1. Give the hub a DHCP reservation and set its address in `apps/server/.env` (`DIRIGERA_HOST=…`).
2. Tick **Dirigera** in **Settings → Plugins**. It goes to **"Pairing required"**.
3. Call `POST http://<kasbah>:8787/api/plugins/dirigera/pair` (for example `curl -X POST …`), then **press the action button** under the hub within a minute. The request answers once the hub has accepted.
4. The token is saved by the server (`.state/dirigera-token.json`) and does not expire: nothing to copy.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DIRIGERA_HOST` | — | IP address of the hub |
| `DIRIGERA_TOKEN_FILE` | `.state/dirigera-token.json` | Where the pairing keeps the token (readable by the server only) |

## Limitations

- Unofficial API: a hub firmware update may change it.
- Pairing has no button in Settings yet: it is done with the request above.
- A command is reported done when the hub acknowledges it, not when the device has moved.
- No throttling while a slider is dragged: every value is sent.

## Further reading

Internals, choices and what remains to check on a real hub: [wiki, IKEA DIRIGERA](../../doc/3_plugins/3_29_ikea-dirigera.md) (in French).
