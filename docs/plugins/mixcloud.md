# Mixcloud

| | |
|---|---|
| **Id** | `mixcloud` |
| **Role** | music source: mixes and shows (DJ sets, radio replays), often one to several hours long |
| **Connection** | **cloud, partly unofficial**: Mixcloud's public API for the catalog, `yt-dlp` for the audio stream |
| **Account** | a plain Mixcloud **username**, no password or cookie |
| **Views** | Music ("Mixcloud" source), Settings → Plugins |

## What the plugin does

- **Search** for mixes, shows and DJs.
- **Your account**: a home page rebuilt for you (the creators you follow, new uploads from followed accounts, "Listen again", more from your favorite creators, popular shows in your genres), favorites, listened, your mixes, playlists, followed accounts (opening an account shows its mixes).
- **Genres**: each mix carries its genre pills, and a row of filters lets you **keep** or **rule out** genres (the choice is remembered in the browser).
- **Resume**: an interrupted mix restarts where you left it ("Resume at 1:23:45", or "Start over"), on any speaker or in the browser. Mixcloud remembers nothing without a sign-in to the site: Kasbah keeps the position itself (beyond 60 s, up to the last 90 seconds).
- **Playback** through the shared player (see below), with a queue, transfer from one speaker to another and playback in the browser.
- On the assistant side (MCP): `search_music` with `source: mixcloud` searches mixes, `play_music` starts them on a speaker.

The plugin publishes no device: it does not appear in the 3D house.

## The shared player

Playback is done by Kasbah's **shared music player**, shared with YouTube Music (radios go straight from the station to the speaker). Mixcloud only provides the catalog and the stream of a mix. The shared player:

- serves the mix **over the house network** to the speaker, which plays it as a file: it knows the duration and lets you seek within a three-hour mix;
- keeps the **queue on the server side** and remembers **each speaker's last listen**, restored after a server restart.

The **target speakers** are **Google Cast** and **Sonos** players, which must also be enabled in Settings → Plugins. They refuse `127.0.0.1`: if you open Kasbah as `localhost` on the server machine, set `MUSIC_PUBLISH_BASE` (a shared player variable, see the [YouTube Music](ytmusic.md) page).

## Connection

The catalog comes from Mixcloud's **public API**, which needs no key or token: Kasbah only reads what your profile shows publicly. Linking an account means giving your username (the one in your profile address: `mixcloud.com/your-name/`); **no password passes through, no secret is stored**. The name and the resume positions are kept in `apps/server/.state/mixcloud.json`.

The audio stream is found by `yt-dlp` on the mix page. No PO Token here, unlike YouTube Music.

## Setup

1. Install **`yt-dlp`** on the machine that hosts Kasbah. If it is already installed for YouTube Music, nothing else is needed: Mixcloud uses the same one (otherwise, `MIXCLOUD_YTDLP_PATH`). `ffmpeg` is only useful as a fallback, if a stream cannot be relayed as is.
2. Tick **Mixcloud** in **Settings → Plugins**.
3. As long as no account is linked, the Mixcloud section (and the Mixcloud source on the Music page) asks for your **username**: enter it, then **Link**. Kasbah checks that it exists on Mixcloud.
4. Open the **Music** view, choose the **Mixcloud** source, start a mix on a speaker.

To change the account or remove it: **Change account** / **Unlink**. With no account linked, the plugin stays on hold ("to be linked") and the personal lists (home, favorites, following...) are unavailable.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `MIXCLOUD_STATE_FILE` | `.state/mixcloud.json` | Username and resume positions |
| `MIXCLOUD_YTDLP_PATH` | — (then `YTM_YTDLP_PATH`, then `yt-dlp`) | `yt-dlp` binary |
| `MIXCLOUD_API_URL` | `https://api.mixcloud.com` | Root of the public API |

## Limitations

- Quality capped at **64 kb/s** (AAC) with a free account; a free account's cookie changes nothing there, so there isn't one.
- The recommendations that Mixcloud computes on its side for a signed-in account do not exist: the home page is rebuilt from your public listens (refreshed every 30 min).
- No listen is reported to Mixcloud: Kasbah only reads.
- Starting takes a few seconds (`yt-dlp` looks up the stream).
- Resume keeps the last 200 mixes you started.

## Further reading

Internals, routes and pitfalls: [wiki, Mixcloud](../../doc/3_plugins/3_20_mixcloud.md) (in French); shared player: [wiki, music player](../../doc/1_architecture/1_6_lecteur-musique.md) (in French).
