# TouteMonAnnée

| | |
|---|---|
| **Id** | `toutemonannee` |
| **Role** | homework notebook (homework), school-home communication notebook and class posts, for parents and pupil alike |
| **Connection** | **cloud, unofficial**: the private API of the web app of [toutemonannee.com](https://www.toutemonannee.com), with no public API |
| **Account** | your TouteMonAnnée account (email address or username + password), used **only once**; only the session cookies are kept |
| **Views** | School, Settings → Plugins |

> **Unofficial.** The site offers no delegated sign-in and no API: Kasbah connects the way a browser does. A change to the site can break reading without notice.

![School view](../screenshots/school.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **Homework** (homework notebook): grouped by due day starting today, with the next due day highlighted; past homework from the last few days can be expanded. A **"done"** checkbox per item.
- **Messages**: the teacher's messages, most recent first, with the "Unread" tag and the number of replies.
- **Posts** from the class (announcements, images, attached documents), with "New" for those you have not seen yet. Photos open inside Kasbah: you can move from one to the next, zoom, and download them.
- **Filters** by class (if the account has several) and by level (CP, CE1, CE2, CM1, CM2) to see only what concerns your child; anything that names no level stays shown. The filters are kept by the server, so they are the same on every screen.
- **Pills** in the view: next day's homework not done, unread messages, new posts.
- **Automatic refresh** every 30 minutes, or on demand ("Updated at HH:MM").
- On the assistant side (MCP): the `get_school` tool reads the homework, messages and posts, with the same filters as the School view.

The plugin publishes no device: it does not appear in the 3D house.

## Connection

TouteMonAnnée offers no third-party sign-in: the **account password** is required. It goes through the Kasbah server **only once**, when the account is linked, and is **never stored**. The server only keeps the **session cookies**, in `apps/server/.state/toutemonannee.json` (restricted permissions, outside the repository, outside `.env`); one of them reopens an expired session by itself. This file gives access to your account: treat it as a secret. The password does, however, cross your local network in plain HTTP, since Kasbah is not served over HTTPS. To keep it off the network, link the account from the public address (HTTPS) when Kasbah has one (`MCP_PUBLIC_URL`, see the README's **Remote access**).

Reading is done by the server; screens never talk to the site directly. If the site refuses the session anyway, the view shows a banner, **keeps the last reading**, and the linking form reappears.

## Setup

1. Tick **Toutemonannee** in **Settings → Plugins**. As long as no account is linked, the plugin is "Pairing required".
2. In the TouteMonAnnée section, enter your account's **email address or username** and **password**, then **Link the account**. The card shows "Linked: …".
3. Open the **School** view ("Open the School view" link on the card). The homework, messages and posts appear after the first read.
4. If the class is not the right one, or if there are several children, set the class and level filters at the top of the view.

**Unlink the account** deletes the cookies; the filters and the local "done" checkboxes are kept.

## The "done" checkbox

- When the teacher has opened the checkbox on an item of homework, it is **the site's own**: ticking it in Kasbah ticks it on TouteMonAnnée, and **the teacher sees who ticked it**.
- Otherwise the checkbox stays **in Kasbah** only (a household reminder).

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `TMA_FILE` | `.state/toutemonannee.json` | Session cookies, local "done" checkboxes, filters |
| `TMA_REFRESH_MS` | `1800000` (30 min) | Refresh interval, 5 minutes at least |
| `TMA_PAST_DAYS` | `7` | Past days re-read for homework (0 to 31) |

## Limitations

- Unofficial: depends on the site's web app, which can change.
- Mostly **read-only**: you cannot reply to the teacher, comment on a post or mark a message as read.
- The level (CE1, CE2…) is not data from the site: Kasbah reads it from the text ("for the CE1s"). A missing or unusual mention is not filtered.
- The site only keeps a few days of past homework.
- Ticking the site's "done" checkbox is the only write that Kasbah makes at TouteMonAnnée.

## Further reading

Internals, routes observed and pitfalls: [wiki, TouteMonAnnée](../../doc/3_plugins/3_23_toutemonannee.md) (in French).
