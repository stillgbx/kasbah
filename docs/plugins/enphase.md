# Enphase

| | |
|---|---|
| **Id** | `enphase` |
| **Devices** | solar site (production, consumption, grid), microinverters, IQ batteries, and optionally the IQ EV Charger 2 |
| **Connection** | **local** for the IQ Gateway (production, inverters, batteries); **Enphase cloud** (the app's private API) for the charger only |
| **Account** | a gateway token valid for one year; for the charger, additionally, a session linked to the Enphase account |
| **Views** | Energy, Home (panels and batteries in 3D), Settings → Plugins |

![Energy view](../screenshots/energy.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **Site**: solar production, consumption, exchange with the grid and storage, in real time (read every 10 s).
- **Microinverters**: one power sensor per inverter, with its record. An inverter silent for more than half an hour (at night, a failure) becomes unavailable and keeps its last value, grayed out.
- **IQ batteries**: one per battery, with its charge level; storage is positive when charging, negative when discharging.
- **IQ EV Charger 2**: state (plugged in, charging), session energy, **Start charging** / **Stop charging**. The current cannot be set: starting resumes the one from the Enphase app.
- Production is never shown below zero: the microinverters' standby draw at night does not count as consumption.
- **Return to the previous mode**: a stop or a forced start from Kasbah puts the charger in "manual override". When the car reaches its limit or is unplugged, Kasbah restores the mode chosen in the app (for example green charging).
- **Charger mode**: **Green** (on solar surplus only) or **Manual** (as soon as it is plugged in, from the grid if needed), chosen from the charger's panel (Home view), its row in the Energy view, or the assistant (MCP). The scheduled and smart modes are set in the Enphase app; neither button is then lit.
- **Visible manual override**: when the charger no longer follows its mode until it is unplugged, its panel says so and **Resume** gives it back; in the Energy view, its row shows "manual override" and the key of the current mode, in orange, gives it back.

## Connection

- **Gateway**: the Kasbah server talks directly to the gateway over HTTPS (name `envoy.local` by default, self-signed certificate accepted for it alone). No call to the Internet once the token is set, no quota. The serial number never has to be entered: the gateway provides it.
- **Token**: software 7.0 and later requires a token, valid for one year. The server keeps it in `apps/server/.state/enphase-token.json`: there is **nothing to copy** into `.env`, and the pairing survives restarts.
- **Charger**: it is not on the gateway, it only talks to the Enphase cloud. This requires linking the Enphase (Enlighten) account; the session is kept in `apps/server/.state/enphase-cloud.json`. A token pasted by hand is not enough.
- **Password**: the Enphase account's password is never a configuration key. It is used once for pairing, then forgotten (neither saved nor logged). It does, however, cross your local network in plain HTTP, since Kasbah is not served over HTTPS: the "token" route avoids this, at the cost of the charger.

## Setup

1. Tick **Enphase** in **Settings → Plugins**. The **EV charger** sub-item is ticked by default: untick it if you do not have one.
2. If the gateway does not answer to `envoy.local`, set its address in `ENPHASE_HOST` (and restart the server).
3. In the **Enphase gateway** section of Settings → Plugins, there are two routes:
   - **Enphase account** (recommended, and essential for the charger): enter the account's address and password, then **Pair the gateway**. The one-year token is created and kept by the server;
   - **Token**: create it on `entrez.enphaseenergy.com`, paste it, then validate.
4. The card shows the token's role and its expiry. With less than 30 days left, the plugin's pill turns orange: **Renew the token** before then.
5. For the charger: choose **Enphase account** and **Validate**. The button links the cloud session without creating a new token if the local token is still valid.

## Configuration (`apps/server/.env`)

Nothing is required in the normal case.

| Variable | Default | Purpose |
|---|---|---|
| `ENPHASE_HOST` | `envoy.local` | Name or address of the gateway |
| `ENPHASE_TOKEN` | — | Optional bootstrap token (first start without an interface). Between it and the server's own, the one that expires last is kept |
| `ENPHASE_TOKEN_FILE` | `apps/server/.state/enphase-token.json` | Where the server keeps the token. Empty: nothing is kept, you have to pair again at every start |
| `ENPHASE_CLOUD_FILE` | `apps/server/.state/enphase-cloud.json` | Where the server keeps the charger's session. Empty: to be linked at every start |
| `ENPHASE_POLL_MS` | `10000` | Meter polling interval (2,000 to 300,000 ms) |
| `ENPHASE_SLOW_POLL_MS` | `60000` | Polling interval for inverters, batteries and charger (30,000 to 900,000 ms) |

## Limitations

- **Installer token**: for an account that is both installer and owner, Enphase's web form only gives a 12-hour token. Only pairing by account, in Kasbah, gives the one-year token.
- A token belongs to one gateway: one from another gateway is refused, as is an expired or truncated one (the card says so).
- The gateway is slow at times (up to about ten seconds on the detailed reading): the day's totals refresh once a minute.
- **Stopping the charger blocks it** until the next unplug, sun or not: Kasbah flags this under the button and restores the previous mode when it can. It normally returns by itself to the mode chosen in the app.
- The charger does not say which car is plugged in.
- Only one Enlighten site is read: the one chosen at pairing.
- Safe mode: if the charger is not connected to the gateway, it falls back to a reduced current. This is set in the Enphase app (Charger Connectivity), not in Kasbah.

## Further reading

Internals, polling intervals, the charger's API and pitfalls: [wiki, Enphase](../../doc/3_plugins/3_7_enphase.md) (in French).
