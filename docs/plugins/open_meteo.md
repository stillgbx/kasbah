# Open-Meteo

| | |
|---|---|
| **Id** | `open_meteo` |
| **Devices** | one weather device (`weather`), at the house's position |
| **Connection** | **cloud, official**: Open-Meteo's open API, queried by the server |
| **Account** | none: no account, no key, no token |
| **Views** | Weather, Home (weather widget), warning alerts, Settings → Plugins |

![Weather view](../screenshots/weather.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **House weather**: temperature and feels-like, conditions, wind and gusts, humidity, pressure, UV index, visibility, dew point, rain risk, cloud cover, sunrise and sunset.
- **Forecasts**: the next 24 hours and 7 days.
- **Air quality** (European EAQI index) and **pollen** (alder, birch, grasses, mugwort, olive, ragweed), from the European Copernicus CAMS program. If this service does not respond, the weather stays displayed without these two blocks, which come back on the next reading.
- **Météo-France warnings** currently in force for the house's département, shown in the alerts. They come from the public MeteoAlarm feed, without a key. Mainland France only: elsewhere, warnings are not shown.
- **Weather elsewhere**: the Weather view lets you search for another place, keep it as a favorite, and see its forecasts and warnings.
- On the assistant side (MCP): the `get_weather` tool returns the weather, forecasts, air, pollen and warnings for the house, or for a place searched by name.
- **3D scene**: the Home view picks up this weather. Rain and snow fall, slanted by the wind, the ground gets wet, fog settles in, and the pool water has a swell that follows the wind's strength and direction.
- **Precipitation radar** in the Weather view: observed images (RainViewer), then Météo-France's AROME forecast. This map is loaded directly by the browser.

## Connection

The Kasbah server queries `api.open-meteo.com` (forecasts) then `air-quality-api.open-meteo.com` (air and pollen), every 10 minutes by default: about 300 calls per day, far below the 10,000 allowed. Open-Meteo combines several models, including Météo-France's AROME for France. There is nothing local and nothing to configure on the account side.

## Setup

1. Check that the house has a geographic position (`origin` in the house file): it sets the location of the weather.
2. Tick **Open Meteo** in **Settings → Plugins**.
3. That's all: the device appears a few seconds later, once the first reading is done. No variable to set.

## Attribution

Open-Meteo data is licensed under **CC BY 4.0**, for **non-commercial use** (free up to 10,000 calls per day). The "Open-Meteo.com" attribution is displayed by Kasbah at the bottom of the Weather view: keep it if you share a screenshot. Warnings are published by Météo-France via MeteoAlarm (CC BY 4.0), and radar images by RainViewer.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `OPEN_METEO_POLL_MS` | `600000` | Reading pace, from 60,000 to 3,600,000 ms. The models are re-run on the hour: reading more often just returns the same thing |

## Limitations

- **No commands**: this is an information source, nothing to control.
- Air quality and pollen: **European** coverage only (dashes elsewhere).
- Warnings: mainland France only, yellow or above; green means "nothing to report".
- The position is rounded by the service (about one kilometer): the weather is that of the neighborhood, not of the garden.
- The AROME radar is displayed even outside its validity area (France and neighboring countries).
- No forecasts without a network: the last successful reading stays displayed.

## Further reading

Internals, weather code and warning mapping: [wiki, Open-Meteo](../../doc/3_plugins/3_10_open-meteo.md) (in French).
