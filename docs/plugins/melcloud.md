# Mitsubishi MELCloud

| | |
|---|---|
| **Id** | `melcloud` |
| **Devices** | one heating zone (`climate`) per heat pump zone, read-only |
| **Connection** | **cloud, unofficial**: the MELCloud mobile app API (an Ecodan's Wi-Fi module only talks to this cloud) |
| **Account** | MELCloud account e-mail and password, entered once in Settings; only a session key is kept |
| **Views** | Heating, Home (room panel), Settings → Plugins |

![Heating view](../screenshots/heating.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **One heating zone = one device**: measured temperature, and displayed setpoint. The unit is "on" almost all year round; the interface tells apart what is switched on from what is actually heating.
- **Heating view**: the unit's state (heating, running, standby, unreachable), defrost, electric backup heater, circulation pumps, 3-way valve, flow, return and outdoor temperatures, demand, any error, and the time of the last report.
- **Operating history** (when the unit heated, defrosted, called on the backup heater, and at what outdoor temperature), over 48 hours, a week, a month or a year. It is built up from the readings Kasbah takes — hour by hour for a week, day by day for thirteen months: it starts out empty.
- **Placement**: each zone is placed in the house like the other devices, through the house file.

What the plugin does not do: see Limitations.

## Connection

The Kasbah server polls Mitsubishi's cloud at regular intervals (one reading every 2 minutes by default, a single call for the whole account). Nothing goes through the local network. This API is not published by Mitsubishi for consumers: it is the app's API, with the risk that it changes without notice.

There is no delegated sign-in (OAuth). The password passes through the server **only once**, and is neither written nor logged; in exchange MELCloud returns a session key, the only thing kept, in `apps/server/.state/melcloud-session.json`. On the local network it crosses in plain HTTP, since Kasbah is not served over HTTPS. To keep it off the network, link the account from the public address (HTTPS) when Kasbah has one (`MCP_PUBLIC_URL`, see the README's **Remote access**).

## Setup

1. Tick **Melcloud** in **Settings → Plugins**.
2. In the Mitsubishi MELCloud section of Settings → Plugins: enter the **MELCloud e-mail** and the **password**, then **Link the account**.
3. The card shows the number of units and heating zones published, and the zones appear immediately in the Heating view.
4. Nothing to copy into `.env`. **Unlink the account** deletes the session key.

If MELCloud ever rejects the key, the plugin goes back to "Pairing required": just link the account again.

## Configuration (`apps/server/.env`)

Everything is optional, no secret goes in there.

| Variable | Default | Purpose |
|---|---|---|
| `MELCLOUD_BASE_URL` | `https://app.melcloud.com/Mitsubishi.Wifi.Client` | API entry point, in case the vendor moves it |
| `MELCLOUD_APP_VERSION` | `1.34.12.0` | App version announced at sign-in |
| `MELCLOUD_SESSION_FILE` | `apps/server/.state/melcloud-session.json` | Where to keep the session key (never the password). Empty: the link is lost on every restart |
| `MELCLOUD_POLL_MS` | `60000` | Reading pace, from 60,000 to 3,600,000 ms |
| `MELCLOUD_HISTORY_FILE` | `apps/server/.state/melcloud-history.json` | Operating history. Empty: it starts again from zero on every restart |

## Limitations

- **Read-only**: setpoints are displayed, they cannot be changed from Kasbah yet.
- **A MELCloud unit is not a heat pump**: several heat pumps cascaded behind a single controller show up only as one unit with two zones. On such a cascade, MELCloud keeps the zones "idle" and the circulation pumps off even while a unit runs: Kasbah reads heating from the unit's operating mode instead, and cannot tell which of the two zones is being served: the zones then show no activity rather than a guess, and the circulation pumps read "Not reported".
- **No hot water tank, no energy meter**: MELCloud does not expose them for every installation, nothing is shown in kWh.
- Depending on the zone, the displayed temperature is the room temperature or the water flow temperature (weather compensation): the interface says which.
- The history only follows the first unit on the account.
- MELCloud's "offline" indicator is not reliable: Kasbah considers the unit reachable as long as it has reported data in the last 15 minutes.

## Further reading

Internals, API pitfalls and mapping: [wiki, Mitsubishi MELCloud](../../doc/3_plugins/3_13_mitsubishi-melcloud.md) (in French).
