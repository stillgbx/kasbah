# Sonos

| | |
|---|---|
| **Id** | `sonos` |
| **Devices** | Sonos speakers (Play:3, Port, etc.), one per physical speaker (`media_player`) |
| **Connection** | **local**: UPnP / SOAP on port 1400 of each speaker, automatic discovery through SSDP |
| **Account** | no account, no token |
| **Views** | Media, Music (as a playback speaker), Home (marker and sound wave), Settings → Plugins |

![Media view](../screenshots/media.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **What is playing**: title, artist, cover art, volume, mute and playback state, re-read every 2 seconds (whatever started the playback: Sonos app, phone, Kasbah).
- **Remote control**: play / pause, stop, previous / next track ("previous" goes back to the start of the track once past 3 seconds), position in the track, volume, mute.
- **Play a URL** (MP3, radio stream, HLS): "Play a URL" field in the Media view, and this is how the music plugins (radios, YouTube Music, Mixcloud) start a track on the speaker. The speaker fetches the stream itself: Kasbah does not relay the audio.
- **Groups**: a grouped speaker remains a separate player in Kasbah; its volume is its own, but play, pause and tracks are sent to the group coordinator.
- **Speaker switched off**: it no longer answers discovery, so Kasbah keeps it in the list, unavailable, and finds it again when it comes back on. **Forget device** removes it for good.
- Cover art is relayed by the server, so that screens do not fetch it themselves.

## Connection

Everything is local. The Kasbah server looks for speakers through SSDP (network broadcast, UDP 1900), then talks to them in SOAP on port 1400, without authentication. Nothing goes through the Sonos cloud, and there is no account, no quota and no linking card in Settings.

## Setup

1. Tick **Sonos** in **Settings → Plugins**. The speakers found arrive in the "Not in the house" strip; place them in rooms from their panel.
2. If the **simulation** is also active, untick "Player" in its sub-items: otherwise the simulated players duplicate the real ones.
3. The server and the speakers must be on the **same local network**. If the list stays empty on a machine with several network cards (VPN, virtual machines, `169.254` address), set `SONOS_SSDP_INTERFACE` to the IPv4 address of the card that is on the speakers' network, then restart the server.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `SONOS_SSDP_INTERFACE` | — | IPv4 of the LAN network card, if the machine has several |
| `SONOS_SSDP_REFRESH_MS` | `60000` | Interval of the following searches: speakers switched back on (10 s to 10 min) |
| `SONOS_POLL_MS` | `2000` | Re-read of volume and playback (0.5 to 30 s) |
| `SONOS_REQUEST_TIMEOUT_MS` | `5000` | Maximum time for a request to a speaker (0.5 to 15 s) |
| `SONOS_KNOWN_FILE` | `apps/server/.state/sonos-devices.json` | Memory of the speakers already seen; empty = a switched-off speaker disappears from the list |

## Limitations

- **No launching of Spotify or of a queue** from Kasbah: those services are linked in the Sonos app, not to a URL. Kasbah reads what is playing and starts streams by address.
- **No group view** and no Sonos WebSocket (it needs a cloud API key): changes are seen by polling, with up to 2 seconds of delay.
- **Pausing a live stream**: a live radio cannot be paused, so pause becomes stop.
- On an idle speaker with no queue, pause and "next" are refused: the interface greys out those buttons.

## Further reading

Internals, network captures and pitfalls: [wiki, Sonos](../../doc/3_plugins/3_15_sonos.md) (in French).
