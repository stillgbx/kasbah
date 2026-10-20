# Radios

| | |
|---|---|
| **Id** | `radio` |
| **Role** | music source: live web radios, played on your speakers |
| **Connection** | **cloud, public**: the open directory [radio-browser.info](https://www.radio-browser.info) to find stations; the stream itself goes straight from the radio to the speaker |
| **Account** | none: no account, no key, no cookie |
| **Views** | Music ("Radios" source), Settings → Plugins |

## What the plugin does

- **Search** for a station by name ("franceinfo", "FIP", "Nova"...). Word order, accents and decoration in the name don't matter.
- **Most listened** in your country (France by default).
- **House favorites**: the star adds or removes a station. The list is kept by the server, so it is **the same on every screen**, and a favorite starts even if the directory does not respond.
- **Manual add** ("Add a station"): for a station missing from the directory, or listed with a dead address, paste the address of its stream (`http` or `https`) and give it a name.
- **Live playback** on a speaker, with the station's name, country and logo; the announced quality ("MP3 192 kb/s") is shown when the directory knows it.
- On the assistant side (MCP): `search_music` with `source: radio` searches stations, `play_radio` starts one on a speaker.

The plugin publishes no device: it does not appear in the 3D house.

## The shared player

Unlike YouTube Music and Mixcloud, radio **does not go through the server**: Kasbah only gives the speaker the stream's address, and the speaker connects to the radio itself. So there is no relay, no `ffmpeg`, no queue: a live stream has nothing to queue. The plugin does share with the **Music** page the "Listening" panel (one speaker = one session) and the playback bar.

The **target speakers** are **Google Cast** and **Sonos** players, which must also be enabled in Settings → Plugins. The [YouTube Music](ytmusic.md) page describes the shared player for sources that are relayed by the server.

## Connection

Two calls leave the house: the **directory search** (by the Kasbah server) and the **radio's stream** (by the speaker). Kasbah reports to the directory each listen started, as it asks: this is what ranks stations by popularity for everyone. Favorites are stored in `apps/server/.state/radio-favorites.json`.

## Setup

1. Tick **Radio** in **Settings → Plugins**. Nothing else to configure.
2. Open the **Music** view and choose the **Radios** source.
3. Search for a station or browse **Most listened**, choose a speaker in the "Listening" panel, start.
4. Star your usual stations: they appear in the **Favorites** tab.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `RADIO_BROWSER_URL` | `https://de1.api.radio-browser.info` | Directory mirror |
| `RADIO_FAVORITES_FILE` | `.state/radio-favorites.json` | House favorites |
| `RADIO_COUNTRY` | `FR` | Country of the "most listened" (two-letter code) |

## Limitations

- **Not playable in "This browser"**: the page answers "Radio does not play in this browser yet"; choose a speaker.
- **No title of the current program**: the directory does not provide it, the speaker shows the station name.
- A badly listed station (dead stream address) can be worked around with the manual add; fixing it in the directory benefits everyone.
- The displayed bitrate is the one announced by the directory, not a measurement; it is lost when the server restarts until the next start, and absent for a station added by hand.
- Health goes to "degraded" if the directory stops responding, and comes back on its own.

## Further reading

Internals, routes and pitfalls: [wiki, Radios](../../doc/3_plugins/3_19_radio.md) (in French).
