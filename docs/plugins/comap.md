# COMAP Proteo

| | |
|---|---|
| **Id** | `comap` |
| **Devices** | one water treatment station (`water`), a single device for the whole station |
| **Connection** | **local**, unofficial protocol ([comap-proteo-protocol](https://github.com/stillgbx/comap-proteo-protocol)): plain JSON over TCP, port 23, on the house network |
| **Account** | none: the station has no authentication, nothing to pair or paste |
| **Views** | Water, Home (3D marker of the station), Settings → Plugins |

![Water view](../screenshots/water.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

Tested on a **Proteo 2** station (electronic scale inhibitor, pre-filter, two activated carbon cartridges, UVc lamp). The plugin is **read-only**: settings are changed on the station's touchscreen.

- **Consumable wear**: pre-filter, carbon 1, carbon 2 and UVc lamp, as a percentage remaining (red below 20%).
- **UVc lamp**: on or off.
- **Instantaneous flow**, in liters per hour. The flow meter counts in steps of 36 L/h: the measurement is coarser than its figures suggest.
- **Consumption** for the day, the week and the month, and a **history** built by Kasbah: chart by hour (last 48 hours), by day (last 62 days) and by month (current calendar year), with a French-average marker according to household size.
- **Warning** and **fault** from the station (summary indicators: the detailed codes are not decoded).

## Connection

Everything goes over the local network: the Kasbah server opens a short TCP connection to the station at each read (every 30 s), then closes it. No cloud, no account, no quota. The station has no authentication: any machine on the local network can read it (and write to it), which Kasbah does not do.

**One connection at a time.** The station accepts only one, and the vendor's mobile app uses it too. While it is open, a Kasbah read stays silent: this is normal and harmless. The plugin only declares the station unavailable after several failures in a row (three polls).

## Setup

1. Give the station a fixed address (reserved DHCP lease) and note it down. There is no automatic discovery: the address is configured.
2. Set `COMAP_HOST` in `apps/server/.env` (for example `COMAP_HOST=192.168.1.50`), then restart the server.
3. Tick **Comap** in **Settings → Plugins**.
4. The station appears in the **Water** view. The history fills up over time: the hourly tracking takes shape within a few hours, the daily one within a few days.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `COMAP_HOST` | — | IP address of the station: **required**. Without it, the plugin declares no device and stays in error ("set COMAP_HOST to the station address") |
| `COMAP_PORT` | `23` | TCP port of the station |
| `COMAP_POLL_MS` | `30000` | Read interval (5,000 to 600,000 ms) |
| `COMAP_TIMEOUT_MS` | `5000` | Time before giving up on a read that stayed silent (500 to 30,000 ms) |
| `COMAP_HISTORY_FILE` | `apps/server/.state/comap-consumption.json` | Where to keep the consumption history. Empty: it restarts from zero at every restart |

## Limitations

- **Read-only**, on purpose: a wrong move made remotely on drinking water would cost more than the convenience gained.
- The chart only compares water **filtered** by the station: part of the house's water may not go through it (outdoors, garage, watering). Do not read it as a bill indicator.
- Monthly tracking follows the calendar year: on 1 January, the past year disappears from the chart.
- An hour without a measurement (a gap of more than an hour, a restart) is left empty rather than filled with a zero or a false peak.
- The station's counters are reset by the station itself; the clock that dates the readings is its own.
- The station's detailed alerts are not decoded: only "warning" and "fault" are displayed.

## Further reading

- The station's protocol, reconstructed from captures and documented separately: [stillgbx/comap-proteo-protocol](https://github.com/stillgbx/comap-proteo-protocol).
- Plugin internals, pitfalls and consumption history: [wiki, COMAP Proteo](../../doc/3_plugins/3_12_comap-proteo.md) (in French).
