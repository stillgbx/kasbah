# Google Nest

| | |
|---|---|
| **Id** | `nest` |
| **Devices** | cameras, doorbells and displays with a camera (`camera`), thermostat (`climate`) |
| **Connection** | **cloud, official**: Google's Smart Device Management (SDM) API, there is no local API |
| **Account** | a Google account, a Google Cloud project and a Device Access project (USD 5, one time); a refresh token stored in `apps/server/.env` |
| **Views** | Home (device panel, framing on doorbell ring), Cameras, Heating, Settings → Plugins |

## What the plugin does

- **Cameras and doorbell**: **live** image in the device panel (optional sound, started muted), with about 4 seconds of delay.
- **Cameras view**: one **thumbnail** per camera, refreshed every 10 seconds, and for each tile three states: **Off**, **Preview** (the image and its age), **Live**. At most three simultaneous live streams in this view. The header counts the "active" cameras.
- **Doorbell** (with Pub/Sub events, see below): when someone rings, Kasbah switches back to the Home view, frames the doorbell's room and starts its video.
- **Thermostat**: measured temperature, humidity, setpoint and mode (heat, eco, off, depending on what the thermostat offers), heating state. The setpoint can be set between 9 and 32 °C, except in eco or off mode where Google refuses it: in eco, the eco setpoint (its lower bound, the one a heat-only thermostat follows) is shown without the − / + buttons.
- **Automatic placement**: a device is placed in the house room that has **the same name** as its room in Google Home. Otherwise it stays "not placed" and is placed by hand from its panel.

## Connection

Everything goes through Google's cloud: the Kasbah server queries the SDM API with an OAuth token that is renewed automatically (it lasts one hour). The device list is re-read every 60 seconds. For video, the server asks Google for an RTSP stream and relays it to the browser with **ffmpeg**, without re-encoding (one ffmpeg per camera being watched, to be installed on the server machine, never on the display).

Cameras must be attached to a **Google account**: an old Nest account has to be migrated first.

## Setup

**On the Google side, once (about 15 minutes):**

1. On `console.cloud.google.com`: create a project, enable the **Smart Device Management** API, then create an **OAuth client ID** of type **web application**. The authorized redirect URI is exactly the value of `NEST_REDIRECT_URI`. On the consent screen, add yourself as a test user, then switch the app to **"In production"**: as long as it stays in "Testing" mode, Google expires the token after 7 days and everything has to be linked again (for personal use, Google only shows an "unverified app" warning).
2. On `console.nest.google.com/device-access`: accept the terms (**USD 5**, one time) and create a project, pasting in the OAuth client ID from step 1. The project identifier (a UUID, **not** the Google Cloud project name) is `NEST_PROJECT_ID`.

**On the Kasbah side:**

3. In `apps/server/.env`: `NEST_PROJECT_ID`, `NEST_CLIENT_ID`, `NEST_CLIENT_SECRET` (and `NEST_REDIRECT_URI` if the server does not listen on port 8787).
4. Tick **Nest** in **Settings → Plugins**, and restart the server. The plugin goes to **"Pairing required"**.
5. In the Nest section: **Link the Google account**. Google's consent screen opens in a new tab: this is where you **choose the cameras shared** with Kasbah.
6. On return, the page shows `NEST_REFRESH_TOKEN=…`. Copy it into `apps/server/.env` so it survives a restart: the server never writes that file. The plugin already works; **Refresh** makes the cameras appear.

**Link the account again** (same button) to change the shared cameras.

**Optional, real-time doorbell**: Google only pushes the ring through Pub/Sub.

7. In the Google Cloud project: enable **billing** (Pub/Sub requires it; a household's volume stays within the free quota, so about €0), enable the **Cloud Pub/Sub** API, create a **topic** with its default **pull** subscription.
8. Grant the **Pub/Sub Publisher** role on that topic to the group `sdm-publisher@googlegroups.com`, then enter the topic in the Device Access console and **validate**.
9. Link the account again (the Pub/Sub scope is requested at link time), and set `NEST_PUBSUB_SUBSCRIPTION` to the subscription's full name, `projects/<cloud-project>/subscriptions/<subscription>`.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `NEST_PROJECT_ID` | — | Device Access project UUID |
| `NEST_CLIENT_ID`, `NEST_CLIENT_SECRET` | — | "Web application" OAuth client of the Google Cloud project |
| `NEST_REFRESH_TOKEN` | — | Token obtained by linking the account |
| `NEST_REDIRECT_URI` | `http://localhost:8787/api/plugins/nest/auth/callback` | To be declared identically in the OAuth client |
| `NEST_POLL_MS` | `60000` | Re-reading of the device list (10 s to 10 min): Google limits the calls |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg binary of the video relay (in the `PATH`, or a full path) |
| `NEST_LIVE_BUDGET` | `10` | Video sessions open at the same time, at most (1 to 32) |
| `NEST_SNAPSHOT_MS` | `10000` | Pace of the Cameras view thumbnails (2 s to 2 min) |
| `NEST_PUBSUB_SUBSCRIPTION` | — | Pub/Sub pull subscription; without it, no doorbell events |
| `NEST_PUBSUB_POLL_MS` | `5000` | Pace of event pulling (1 s to 60 s) |

A line left empty (`NEST_REFRESH_TOKEN=`) counts as "absent" and does not disable the plugin.

## Limitations

- **No switching a camera on or off**: Google's public API does not expose this setting (the Google Home app goes through a private API, not reproduced here).
- **Google quota**: a few commands per minute. So video sessions open one every 8 seconds, with a 90-second pause if Google complains; with more cameras than `NEST_LIVE_BUDGET`, the thumbnails **rotate**.
- **Video over RTSP only**: a camera that only serves WebRTC appears in the lists, but its video is not supported yet.
- **Camera switched off**: the API does not say whether a camera is unplugged. It only shows as "inactive" after a stream attempt fails.
- Only the **ring** is reported; motion, person and sound are received but not used yet. Nest Protect smoke detectors are not in this API.
- Auto-placement only knows rooms: an outdoor camera (garage, front, roof) stays "not placed" until you place it by hand.
- A server stopped abruptly during playback can leave an ffmpeg that shuts itself down within five minutes at most.

## Further reading

Internals, video relay, quota and pitfalls: [wiki, Google Nest](../../doc/3_plugins/3_5_google-nest.md) (in French).
