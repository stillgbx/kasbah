# Husqvarna Automower

| | |
|---|---|
| **Id** | `automower` |
| **Devices** | robotic lawn mowers (`mower`), one per robot |
| **Connection** | **Husqvarna cloud** (Automower Connect API, official and free): there is no local option |
| **Account** | an application created on `developer.husqvarnagroup.cloud` with the Automower Connect app account: a key and a secret, with no consent step in a browser |
| **Views** | Robots, Home (robot marker, zones and lawn map painted in 3D), Settings → Plugins |

![Robots view](../screenshots/robots.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **Status**: activity (mowing, charging, returning, at the station, paused, stopped, in error), battery, next start, cutting height (in cm), connection and age of the last status.
- **What is holding the robot back**: schedule, rain, frost, parked on request, daily limit reached, update in progress…
- **Vendor error**: code, text (in English, as support knows it) and time, for example "Error 2 · No loop signal".
- **GPS position** (models with built-in GPS, for example the 435X AWD): map in the Robots view and 3D scene. An adjustable GPS offset in the view corrects a badly placed receiver.
- **Lifetime counters**: mowing time, charges, collisions, distance.
- **Robot log**: the latest messages, with their position when known, placed as incidents on the map.
- **Commands**: **Start mowing** (resumes the robot's schedule) or **Mow for 1 h**, pause, **Park** (until the next slot or until further notice).
- **What it is doing, and where**: "Heading to South zone", "Mowing · Front zone", "Returning to the station", in the Robots card and the robot's panel in the Home view.
- **Zones** (models that support them, for example the 435X AWD): **Zones** button in the Robots view and "Mower zones" block of the 3D panel. **Mow for 1 h** on the whole lawn or on a work area, and a switch for each **stay-out zone**. Zones are drawn in the vendor's app; the API can neither create nor redraw them.
- **Lawn map**: the lawn as surveyed by the robot, its work areas (one color each, the same as in the panel), its stay-out and rewilding zones, the guide wires and the station, laid over the satellite photo in the Robots view. A layers menu chooses what is shown; an adjustable offset realigns the map with the photo. In the Home view, the same map is painted onto the 3D lawn, zone by zone.
- **Real time**: the vendor pushes changes through an event stream, without using up requests.

## Connection

Everything goes through the Husqvarna cloud. The token is requested again automatically (it lasts one day): there is no consent page, no token file, and no pairing in the interface. The application stands for the account that owns the robot. An offline robot (`Offline`) refuses commands.

## Setup

1. On `developer.husqvarnagroup.cloud`, sign in with the Automower Connect app account (the one that owns the robot) and create an application. Connect it to **both** APIs, "Authentication API" and "Automower Connect API". The redirect URL does not matter.
2. Copy the application's key ("Application key") and secret into `apps/server/.env`: `AUTOMOWER_APP_KEY=…` and `AUTOMOWER_APP_SECRET=…`.
3. Restart the server, then tick **Automower** in **Settings → Plugins**.
4. The robot appears in the **Robots** view. Without a key, the plugin stays on hold ("Pairing required").

## Quota

The vendor limits each key to **21,000 requests per seven-day window** (at most one per second), then cuts it off. The window is anchored to the creation of the application; the developer portal shows the count and the moment of the reset ("Resets at …"). Kasbah stays well within it: the event stream is free, and the full refresh every 10 minutes costs about 1,000 requests per week. The gauge at the bottom of the Robots card shows the week's count.

If it drifts from the portal (the portal is authoritative), align it with `AUTOMOWER_QUOTA_RESET_AT`.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `AUTOMOWER_APP_KEY` | — | Application key ("Application key") |
| `AUTOMOWER_APP_SECRET` | — | Application secret |
| `AUTOMOWER_POLL_MS` | `600000` | Full refresh, which catches up on anything the stream may have missed (60,000 to 3,600,000 ms) |
| `AUTOMOWER_TIMEZONE` | server time zone | House time zone (for example `Europe/Paris`), to convert the robot's times to real local time |
| `AUTOMOWER_USAGE_FILE` | `apps/server/.state/automower-usage.json` | Where to keep the request count. Empty: the gauge restarts from zero at every server restart |
| `AUTOMOWER_QUOTA_RESET_AT` | — | The portal's "Resets at" moment (ISO 8601, for example `2026-09-23T17:00:00+02:00`), to anchor the window exactly |

## Limitations

- The robot writes its times (next start, error) in local time: if `AUTOMOWER_TIMEZONE` is wrong, they are shifted.
- Zones are created and redrawn in the vendor's app only. A **rewilding** zone is displayed but cannot be activated remotely (the API refuses it).
- The lawn map is positioned by the robot's **station** on its base, placed in the house. Its accuracy in 3D depends on how the house is aligned to the world (origin and heading).
- The map is read on demand (2 requests), then kept in memory until the zones change or for 24 h; the boundary wire is not published by the API.
- No setting of the cutting height or the headlights yet, and no remote acknowledgement of an error: do these in the vendor's app.
- An error such as "No loop signal" cannot be cleared remotely.
- The GPS is a consumer-grade receiver (2 to 3 m of noise); the robot itself reports a position about every 30 seconds.

## Further reading

Internals, event stream and API captures: [wiki, Husqvarna Automower](../../doc/3_plugins/3_11_husqvarna-automower.md) (in French).
