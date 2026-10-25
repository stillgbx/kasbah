# Calendar

| | |
|---|---|
| **Id** | `agenda` |
| **Role** | calendar: the family's Google calendars, read-only |
| **Connection** | **cloud, official**: the iCal feed that Google publishes for each calendar, read by the server |
| **Account** | no sign-in: one **secret iCal address** per calendar, which is as good as a password |
| **Views** | Calendar, Settings → Plugins |

![Calendar view](../screenshots/agenda.webp)

*Screenshot of the demo: invented calendars and events.*

## What the plugin does

- **Several calendars** combined in a single view, each with its own **color** and name (family calendar, public holidays, personal calendar…). Color dot to change the color, arrows to change the order, show or hide each calendar from the view's legend.
- **Calendar view**: the current month on arrival, with the **week** and the **day** alongside; multi-day events, all-day events, place and description in an event's detail.
- **Recurrences** expanded by Kasbah (repeating events, moved or canceled occurrences, time zones).
- **Read-only**: Kasbah neither adds nor modifies any event.

The plugin publishes no device: it does not appear in the 3D house. On the assistant (MCP) side, the `get_agenda` tool reads the events over a period, read-only.

## Connection

No Google account is linked to Kasbah. For each calendar, Google provides a **secret address in iCal format**: the server reads it every 10 minutes. This address **gives access to the calendar to anyone who has it**: it is kept in `apps/server/.state/agenda-calendars.json` (outside the repository, outside `.env`), is no longer displayed after it is added and never comes back out through the API. When it is added, it does cross your local network in plain HTTP, since Kasbah is not served over HTTPS. To keep it off the network, add it from the public address (HTTPS) when Kasbah has one (`MCP_PUBLIC_URL`, see the README's **Remote access**).

If Google stops answering, the last read stays displayed with a warning ("is not answering: showing the last read").

## Setup

1. Tick **Calendar** in **Settings → Plugins**. As long as no calendar is linked, the plugin is "Pairing required" and its section opens by itself.
2. Get the iCal address: in **Google Calendar on a computer**, with the account that holds the calendar (Google shows it only to its owner, perhaps also to those who can edit it): **Settings** → the calendar in the left-hand column → **Integrate calendar** → **Secret address in iCal format**.
3. In the Calendar section of Settings → Plugins, paste the address into **Add a calendar**, add a name if needed (otherwise the calendar's own), then **Add**. The feed is read immediately: an unreadable address is refused and is not kept.
4. Repeat for each calendar. An address that was already added is refused.
5. Open the **Calendar** view.

To remove a calendar: **Remove**, then **Confirm removal**. A `webcal://` address is accepted.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `AGENDA_FILE` | `.state/agenda-calendars.json` | File holding the calendars (secret addresses included) |
| `AGENDA_REFRESH_MS` | `600000` (10 min) | Feed refresh interval, 1 minute at least |

## Limitations

- **Read-only**: writing would require going through the Google Calendar API (Google Cloud project, OAuth authorization), not the iCal address.
- The iCal feed can lag slightly behind Google; a change only shows up at the server's next read (10 min by default).
- A displayed period cannot exceed about two months (the month view covers six weeks).
- For a public calendar (public holidays), the public feed of a Google calendar also works.

## Further reading

Internals, recurrence handling and routes: [wiki, Agenda](../../doc/3_plugins/3_22_agenda.md) (in French).
