# Renault

| | |
|---|---|
| **Id** | `renault` |
| **Devices** | vehicles (`vehicle`), one per car (tested on a Renault 5 E-Tech) |
| **Connection** | **Renault cloud, unofficial**: the private API of the MY Renault app (Gigya + Kamereon). There is no official route for an individual, and nothing local |
| **Account** | the email address and password of the MY Renault account (no two-factor authentication) |
| **Views** | Vehicles, Home (the car in 3D, in the body color when it is known), Settings → Plugins |

![Renault card in the Vehicles view](../screenshots/renault.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **Reading**: charge level, range, cable plugged in and charging in progress, time remaining, charge limit (target) and floor, position, mileage, interior temperature, body color.
- **Age of the values**: the time shown is the **car's**, not Kasbah's. The R5 has no notion of sleep: stale data is the only sign that it has dropped off.
- **Commands**: **Refresh**, set the charge limit, **Start charging**, **Climate** (target temperature, heated front seats and steering wheel).
- **Stop charging** goes through the house charger when it is at the end of the cable (the car has no stop command); with no charger charging, the command is refused, and says so.
- **Charge wake-up** (sub-item ticked by default): the R5 does not resume charging by itself after the charger cuts out (solar-surplus charging, where a cloud is enough). When the car is plugged in, not charging, below its limit and within the time window, Kasbah queues a command that rewrites the car's charge settings **unchanged** (departure time, duration and temperature stay as they were). The last wake-up is visible in the Renault section of Settings → Plugins.
- The "charging" figures shown are cross-checked: Renault sometimes reports "pending" while the level is rising, and the reverse.
- **Maintenance contract** (on click, to pre-fill a lease): in "Edit" on the vehicle card, "Look up at Renault" reads the vehicle's contracts and suggests the mileage-capped maintenance one, often tied to the lease. Renault does not publish the financing contract itself: nothing is imported without your click.

## Connection

- **Cloud, a use not intended by the vendor's terms**: like every private API, it can change without notice. Renault changed its keys in May 2026, for instance, which broke third-party integrations.
- **Password entered in the interface, never in `.env`**: it goes through the server only once and is neither logged nor written. Only a session token is kept, in `apps/server/.state/renault-session.json`. It does, however, cross your local network in plain HTTP, since Kasbah is not served over HTTPS. To keep it off the network, link the account from the public address (HTTPS) when Kasbah has one (`MCP_PUBLIC_URL`, see the README's **Remote access**).
- **Two-factor authentication**: an account that has it enabled cannot be linked (Renault refuses it to a third party). Linking says so clearly.
- **Rate**: Renault tolerates about 60 calls per hour and blocks the whole account beyond that (the MY Renault app included, for at least an hour). Kasbah limits itself and reads every 10 minutes.

## Setup

1. Tick **Renault** in **Settings → Plugins**. Untick the **Charge wake-up** sub-item if you do not want Kasbah to write to the car.
2. In the **Renault** section, enter the **MY Renault email address** and the **password**, then **Link the account**. The vehicles appear: "Account linked · 1 vehicle".
3. By default the car is named after its license plate (Renault does not expose the app's nickname): the pencil in the Vehicles view renames it, in the house file.
4. **Unlink the account** deletes the session token.

## Configuration (`apps/server/.env`)

Nothing is required: everything is set in Settings. Optional variables:

| Variable | Default | Purpose |
|---|---|---|
| `RENAULT_COUNTRY` | `FR` | Country of the account (two letters) |
| `RENAULT_ACCOUNT_ID` | — | Kamereon account to read if yours has several (empty: the MY Renault account) |
| `RENAULT_SESSION_FILE` | `apps/server/.state/renault-session.json` | Where the server keeps the session token. Empty: to be linked again at every start |
| `RENAULT_POLL_MS` | `600000` | Read interval (120 000 to 3 600 000 ms) |
| `RENAULT_RATE_PER_HOUR` | `60` | Hourly call cap that Kasbah imposes on itself |
| `RENAULT_WAKE_FROM` / `RENAULT_WAKE_TO` | `08:00` / `20:00` | Time window (server time) for the charge wake-up. Equal bounds: never. May span midnight |
| `RENAULT_WAKE_EVERY_MS` | `900000` | Minimum delay between two wake-ups of the same car (300 000 to 21 600 000 ms) |
| `RENAULT_GIGYA_URL`, `RENAULT_GIGYA_API_KEY`, `RENAULT_KAMEREON_URL`, `RENAULT_KAMEREON_API_KEY` | France's values | Only to be set if Renault changes its entry points or keys and the plugin breaks |

## Limitations

- **A sleeping R5 cannot be woken through the API**: once its unit is offline, no command brings it back, not even from the official app. The charge wake-up therefore does not cover every situation.
- A command is **queued** at Renault and only takes effect when the car reconnects; Kasbah reads again after a delay to confirm it. A "command already pending" refusal is a deferral, not a failure: try again in a few minutes.
- **Start charging** disables the car's charging schedules (they are what make it wait) and does not restore them: turn them back on in the MY Renault app.
- Not available for the R5: locking (neither its state nor a remote lock command: no known way through the API), tyre pressure, speed, outside temperature, instantaneous charging power (estimated at display time from the battery capacity entered in the house).
- The color is only known for shades already checked on a real car; otherwise the scene keeps its theme color.
- Climate and starting a charge have not yet been tried on the real car.

## Further reading

Internals, API captures and diagnostics: [wiki, Renault](../../doc/3_plugins/3_9_renault.md) (in French).
