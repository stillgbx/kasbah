# PetKit

| | |
|---|---|
| **Id** | `petkit` |
| **Devices** | feeders (`pet_feeder`: Fresh Element Solo / Infinity) and fountains (`pet_fountain`: Eversweet) |
| **Connection** | **cloud, unofficial**: the PetKit mobile app API; Bluetooth fountains are controlled through a nearby PetKit device |
| **Account** | PetKit account address + one-time code received by e-mail (no password); only the session token is kept |
| **Views** | Pets, Home (device panel), Settings → Plugins |

![Pets view](../screenshots/pets.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **Feeders**: hopper full or needing a refill, desiccant, backup battery, portion served today and planned, next meal in the plan, dispensing in progress. A **Serve a portion** button, with the list of portions the machine accepts.
- **Fountains**: water needing a refill or fine, filter (percentage and alert), battery, number of visits today and average duration. **Start / Stop** commands for the pump and a choice of **Continuous** or **Intermittent** mode (timer, not presence detection).
- **Call the pet**: only on models that have a speaker (the camera series); absent on a Fresh Element Solo.
- Quantities on a cup-based feeder are in tenths of a cup; the grams shown next to them are an **estimate**. The weight of a cup is set in the Pets view (100 g by default): weigh one portion once to calibrate it.

## Connection

Nothing local: the feeders only talk to PetKit's cloud, and an Eversweet Max fountain has no Wi-Fi (Bluetooth only). Kasbah re-reads the devices every 5 minutes.

Sign-in is done **by code**, not by password: PetKit sends a one-time code by e-mail, valid for ten minutes. No password passes through the server; only the session token (valid for about 36 hours, renewed by itself before it expires) is written, in `apps/server/.state/petkit-session.json`. If the session is lost, a new code is requested: the plugin goes to "Pairing required" rather than insisting.

**Use a dedicated PetKit account**, to which you share your devices from your main account: a new sign-in invalidates the previous one, and on your main account the server and your phone would log each other out in a loop.

## Setup

1. In the PetKit app, create a dedicated account and share the devices with it.
2. Tick **Petkit** in **Settings → Plugins**.
3. In the PetKit section of Settings → Plugins: enter the **PetKit account address**, then **Send me a code**.
4. Pick up the code received by e-mail (within ten minutes), enter it in **Code received by email**, then **Link**.
5. The card shows the number of linked devices and the session's end date. Nothing to copy into `.env`. **Unlink** erases the token.

## Configuration (`apps/server/.env`)

Everything is optional and no secret goes in there.

| Variable | Default | Purpose |
|---|---|---|
| `PETKIT_REGION` | `FR` | Account region: it picks the vendor's server (the account must be registered there) |
| `PETKIT_TIMEZONE` | `Europe/Paris` | Time zone announced to the vendor |
| `PETKIT_SESSION_FILE` | `apps/server/.state/petkit-session.json` | Where to keep the session token. Empty: the link is lost on every restart |
| `PETKIT_POLL_MS` | `300000` | Reading pace, from 60,000 to 3,600,000 ms |
| `PETKIT_GATEWAY` | empty (deduced from the region) | Forced server, if needed |
| `PETKIT_PASSPORT_URL`, `PETKIT_APP_VERSION` | vendor values | Change only if PetKit moves its API or requires a more recent version |

## Limitations

- **Fountains: delayed readings.** Kasbah cannot force a fountain to synchronize: the card shows the age of the reading rather than pretending to be real time. The Bluetooth relay is only used for commands (a few seconds, sometimes more), during which the neighboring feeder is busy.
- A fountain **does not measure the water drunk**: it counts its visits, not milliliters.
- A feeder without a weighing tray does not know what was **eaten**: the line is not shown.
- A "portion served" confirmation comes from re-reading the machine, not from the acknowledgement of receipt.
- **No meal plan** (it is set in the PetKit app; a portion served from Kasbah is added to it without touching it), nor camera, pet detection, litter box or purifier.
- The fountains' "battery mode" is not supported.
- The API is not public: it can change without notice.

## Further reading

Internals, API pitfalls and the Bluetooth protocol: [wiki, PetKit](../../doc/3_plugins/3_17_petkit.md) (in French).
