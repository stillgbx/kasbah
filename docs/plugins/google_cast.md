# Google Cast

| | |
|---|---|
| **Id** | `google_cast` |
| **Devices** | Google speakers and alarm clocks, Nest Mini / Hub, Chromecast, Google TV, Android TV, "Chromecast built-in" soundbars (`media_player`) |
| **Connection** | **local**: Cast v2 protocol (one TLS connection per device), automatic discovery over mDNS |
| **Account** | no account, no token |
| **Views** | Media, Music (as a playback speaker), Home (marker and sound wave), Settings → Plugins |

![Media view](../screenshots/media.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **What is playing**: title, artist, cover art, source app, volume and mute, whatever the origin of the playback (phone, voice, Kasbah). The device pushes this information itself, so it is displayed immediately.
- **Remote control**: play / pause, previous / next track, position in the track, volume, mute, and **stop** (which closes the app open on the device).
- **Play a URL** (MP3, radio stream, HLS): the "Play a URL" field of the Media view, and this is how the music plugins (radio, YouTube Music, Mixcloud) start a track on the device.
- **Device type recognized automatically**: speaker, television or smart display, based on what it announces. A Chromecast plugged into a TV has a **fixed** volume: no volume slider, it is adjusted on the TV.
- **Silent apps** (native Netflix, for example): the device sends neither title nor commands. Kasbah shows "On screen · Netflix" with the app's logo, with no control possible except stop.
- **Device switched off**: a switched-off Cast device no longer announces itself, so Kasbah keeps it in the list, unavailable, and finds it again as soon as it is switched back on. **Forget device** removes it for good.
- **Enrichments** (see below): Crunchyroll episodes, missing cover art, sound output of a Sony TV.

## Connection

Everything is local. The Kasbah server looks for devices over mDNS (`_googlecast._tcp`), opens an encrypted connection to each (port 8009) and keeps it open. Nothing goes through the Google cloud, and the protocol knows no account: the Google account's queue or history stay in the Google Home app, out of Kasbah's reach. Cover art is relayed by the server, so the screens do not fetch it themselves.

## Setup

1. Tick **Google Cast** in **Settings → Plugins**. The devices found arrive in the "Not in the house" band; place them in the rooms from their panel.
2. If the **simulation** is also active, untick "Player" in its sub-items: otherwise the simulated players duplicate the real ones.
3. The server and the devices must be on the **same local network** (mDNS does not cross a router). If the list stays empty on a machine with several network cards (VPN, virtual machines), set `CAST_MDNS_INTERFACE` to the IPv4 address of the card that is on the devices' network, then restart the server.

Option, **Sony TV and soundbar**: a TV on HDMI ARC sends its sound out through the soundbar, which the Cast protocol sees as "idle". For the sound wave to land on the soundbar, declare the link in the house file (`meta.audioOutput` of the TV device, with the soundbar's identifier); it is the TV that says where its sound goes.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `CAST_MDNS_INTERFACE` | — | IPv4 of the network card that carries multicast, if the machine has several |
| `CAST_DISCOVERY_WAIT_MS` | `3000` | Time given to devices to answer the first query (0.5 to 15 s) |
| `CAST_MDNS_REFRESH_MS` | `60000` | Interval of the following queries: devices switched back on, lost announcements (10 s to 10 min) |
| `CAST_KNOWN_FILE` | `apps/server/.state/google-cast-devices.json` | Memory of devices already seen; empty = a device that is switched off disappears from the list |
| `CAST_CRUNCHYROLL_ENRICH` | `true` | Fills in series, season, episode and poster for Crunchyroll playback (unofficial) |
| `CAST_COVER_LOOKUP` | `true` | Looks up the cover art of a named track that has no image (iTunes, then Deezer) |
| `CAST_BRAVIA_PROBE` | `true` | Asks a Sony TV where its sound goes (the TV's local API) |

The last three can be set to `false`: the display is then what the device provides.

## Limitations

- **No Google account**: you cannot start a YouTube Music "account" playlist from Kasbah. Kasbah's music plugins send a stream address instead, which the device fetches itself.
- **Unofficial enrichments**: Crunchyroll (a service queried without an account) and the iTunes / Deezer catalog can stop answering without notice; Kasbah then falls back to what the device says. The cover art found is the **album's**, not the video thumbnail.
- **Stopping closes the app** on the device. Starting a stream afterwards on a TV that is slow to wake up can fail on the first try (5-second timeout exceeded): the second one works.
- **Speaker groups** are not supported; an Android TV in deep standby does not announce itself and stays invisible.
- An app that opens no media channel (native Netflix, Prime Video) gives neither title nor position: nothing to control, nothing more to display.

## Further reading

Internals, network captures and pitfalls: [wiki, Google Cast](../../doc/3_plugins/3_6_google-cast.md) (in French).
