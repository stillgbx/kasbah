# Simulation (mock)

| | |
|---|---|
| **Id** | `mock` |
| **Devices** | every device type, simulated: lights (with effects), covers (shutters, blinds, curtains, gate, garage doors, roof window), players (speakers, TVs, displays), heating, vacuum, mower, sensors, solar energy, charger and vehicles, weather, water, pets, fans, cameras and doorbells (no video stream), and light scenes |
| **Connection** | none: the simulation runs **inside the Kasbah server** |
| **Account** | none, nothing to configure |
| **Views** | all of them (Home, Lights, Covers, Media, Heating, Vehicles, Robots, Pets, Energy, Water, Weather...), Settings → Plugins |

![Les Tilleuls](../screenshots/maison-tilleuls.webp)
![Les Embruns](../screenshots/maison-embruns.webp)
![Le Belvédère](../screenshots/maison-belvedere.webp)

*Screenshots of the demo (simulation, no real device).*

## What the plugin does

- **A house that lives on its own**, with no hardware: shutters that rise at a realistic speed, a thermostat that reaches its setpoint, a vacuum and a mower that follow their schedule, vehicles that leave and come back, sun and clouds that make solar production vary, wear of the water station's consumables...
- **The demo properties**: each of the three houses in `house/demos/` has its own fleet of devices (`tilleuls`, `embruns`, `belvedere`), with stable ids (`mock:tl-light-salon`...) tied to the house, so everything shows up directly in the 3D scene. The fleet follows the displayed property.
- **Light scenes** to recall from the Home panel, like those of a Hue bridge: fixed or animated, per room or per zone; they clear when one of their lamps is adjusted by hand.
- **A doorbell** that rings at fixed times (the postman, a delivery person): the Home view reacts as it would to a real one.
- **A test bench**: the same engine lets you discover Kasbah without buying anything, develop a view, or see a rare case (alert, failure, winter) without waiting for it to happen at home.
- **Scenarios**: one per demo property, with its `-winter` variant; and `default` (the test house), `empty` (no devices, to see the empty screens), `chaos` (devices that disappear for about thirty seconds, 10% of commands failing, slow 3 s responses), `winter` (winter: heating on, blind retracted, lamps lit).
- **Accelerated time** is possible: a simulated day in a few minutes to watch the sun move or a charge finish.
- The engine also exists **in the browser** (server-less demo: `VITE_INPROCESS_MOCK=1 npm run dev -w @kasbah/web`).

## Connection

None. Nothing is read or sent over the network: the values are made up by the server, and are **deterministic** (same seed + same start time = same day). The state lives in memory: restarting the server puts the house back in its initial state.

## Setup

1. Nothing to do on a fresh install: without a `plugins` section in the house file, the server starts with **the simulation alone**.
2. To remove it, or add it alongside real plugins: tick / untick **Mock** in **Settings → Plugins**.
3. **As soon as a real plugin covers a device type, untick that type** in the plugin's sub-items ("Light" when Hue is connected, "Cover" with TaHoma, "Player" with Cast or Sonos...). Otherwise the simulated devices pile up with the real ones in the "Not in the house" band and you can no longer tell one from the other. Unticking "Energy" removes the simulated solar site **and** its twenty panels; the change takes effect right away, without a restart.

There is one sub-item per simulated type (16 today, cameras included), all ticked by default.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `MOCK_SCENARIO` | `default` | Scenario: `default`, `empty`, `chaos`, `winter`, or that of a property (`tilleuls`, `embruns`, `belvedere`, and `-winter`). In demo mode, the property picks it; `winter` gives its winter version |
| `MOCK_SEED` | `42` | Random seed: the same one gives the same day |
| `MOCK_TIME_SCALE` | `1` | Speed-up of the simulated time (`60`: a day in 24 minutes) |
| `MOCK_START_TIME` | — (now) | Simulated start date and time, in ISO 8601 format (e.g. `2026-06-21T06:00:00+02:00`) |

Which device types are simulated is chosen in Settings → Plugins, never here.

## Limitations

- **These are fictitious values**: a simulated charger or panel draws real flows in the Energy view. Mixed with real measurements without unticking the matching type, the simulation skews the counters. Don't leave it ticked for anything no real plugin covers, unless you know you are looking at a demo.
- Cameras and doorbells **have no image**: the Cameras view says "No video stream declared". Light scenes can be recalled but neither created nor deleted.

## Further reading

Engine, scenarios and simulated behaviors: [wiki, Simulation and mock plugin](../../doc/3_plugins/3_0_simulation-mock.md) (in French).
