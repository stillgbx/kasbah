# YouTube Music (unofficial)

| | |
|---|---|
| **Id** | `ytmusic` |
| **Role** | music source: catalog, library and playlists of your YouTube Music account, played on your speakers |
| **Connection** | **cloud, unofficial**: internal API of the YouTube Music website, audio stream extracted by `yt-dlp` |
| **Account** | your Google / YouTube Music account, linked through a browser **cookie** (no username or password) |
| **Views** | Music, Settings → Plugins |

![Music view](../screenshots/music.webp)

*Screenshot of the demo: invented genres, tracks and covers, as the demo has no YouTube Music account.*

> **Unofficial.** Google offers no API for this: Kasbah poses as the YouTube Music website. Keep it to personal use at home. Google can break the path without notice; the plugin then goes into error in Settings rather than pretending.

## What the plugin does

- **Search** for tracks, albums, singles / EPs, compilations and artists, with the *explicit* tags (and a switch to hide them).
- **Library**: recents, liked tracks ("Liked"), playlists, new releases, moods and genres; album and artist pages.
- **Playback on the house speakers** (see below), with a **queue** ("Play all" on an album or playlist, "Play next", track repeat), pause, position slider and **transfer** from one speaker to another without losing the position.
- **Playback in the browser**: the device showing the page can play by itself ("This browser").
- On the assistant side (MCP): the `search_music` tool searches YouTube Music, and `play_music` starts the results on a speaker.

The plugin publishes no device: it does not appear in the 3D house.

## The shared player

Playback is not done by the plugin itself but by Kasbah's **shared music player**, shared with Mixcloud (radios, for their part, go straight from the station to the speaker). The plugin only provides the catalog and the stream of a track; the shared player takes care of the rest:

- it serves the stream **on the house network** to the target speaker, which plays it like a file (so it knows the duration and lets you seek within the track);
- it keeps the **queue on the server side**: the screen can switch off, the next track still starts;
- it keeps the **last listening session of each speaker** and resumes it after a server restart.

The **target speakers** are the **Google Cast** players (Chromecast, Cast-compatible speakers and TVs) and **Sonos**, which must therefore be enabled too in Settings → Plugins. They refuse `127.0.0.1`: if you open Kasbah as `localhost` on the server machine, set `MUSIC_PUBLISH_BASE` (see below).

## Connection

The Kasbah server queries YouTube Music with your cookie, then runs `yt-dlp` to find the audio stream of each track. `yt-dlp` needs a **PO Token**, a proof that YouTube increasingly requires: a small local service ("PO Token generator", port 4416) produces it. Nothing else leaves the house.

The cookie is stored in `apps/server/.state/ytmusic-cookie.txt`, **never** in `.env`. A **Premium** account is expected for a real catalog (a family account will do). When the cookie expires, the card in Settings says so: repeat the same procedure.

## Setup

1. **Install the tools**, on the machine that hosts Kasbah (not on the screens):
   - `yt-dlp` (in the `PATH`, or its path in `YTM_YTDLP_PATH`) and its `bgutil-ytdlp-pot-provider` module (without it, the PO Token option is silently ignored);
   - `ffmpeg` (transcoding fallback of the shared player; path in `FFMPEG_PATH` if it is not in the `PATH`);
   - **Node** in the `PATH`: `yt-dlp` uses it to solve YouTube's challenges.
2. **Start the PO Token generator** on port 4416 (Docker: `docker run -d --init -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider`, or native Node). `npm run dev` starts it by itself if it is installed in `_external/`. As long as it does not answer, the plugin's health stays "degraded".
3. Tick **Ytmusic** in **Settings → Plugins**.
4. Sign in to **music.youtube.com** in a browser **on the Kasbah machine**, then **do not sign out** (only close the window).
5. In the YouTube Music section of Settings → Plugins, link the cookie in one of two ways:
   - **Paste the cookie** (the most reliable, especially on Windows): F12 → Network tab → reload → click a request to `music.youtube.com` → Request Headers → **Cookie** → copy the whole value (it must contain `__Secure-3PAPISID`) → **Save cookie**. A private window will do.
   - **Import from a browser on the server**: **normal** profile (not private), browser completely closed, then choose the browser and **Import from browser**. On Windows, Chrome and Edge often fail (encryption): prefer Firefox or pasting.
6. The card shows "Cookie saved" and the state of the PO Token generator. Open the **Music** view, choose a speaker in the "Listening" panel, start a track.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `YTM_COOKIE_FILE` | `.state/ytmusic-cookie.txt` | Cookie file (empty: cookie lost at restart) |
| `YTM_PO_TOKEN_URL` | `http://127.0.0.1:4416` | Address of the PO Token generator |
| `YTM_YTDLP_PATH` | `yt-dlp` | `yt-dlp` binary (Mixcloud also uses it by default) |
| `MUSIC_PUBLISH_BASE` | — (deduced from the browser) | Server address given to the speakers, e.g. `http://192.168.1.10:8787`; required if the interface is opened as `localhost` |
| `FFMPEG_PATH` | `ffmpeg` | `ffmpeg` binary of the shared player |

`MUSIC_PUBLISH_BASE` and `FFMPEG_PATH` are read by the shared player, not by the plugin; the old name `YTM_PUBLISH_BASE` is still accepted.

## Limitations

- Unofficial: an update to YouTube or `yt-dlp` can break everything, temporarily.
- The next track starts with about 2.5 s of silence: no gapless playback.
- No YouTube mix / radio, no podcasts, and no multi-room sync.
- Playback started from the Cast or Sonos app itself does not belong to Kasbah: it cannot be transferred.
- Clearing the cookie does not interrupt the current track, only the following ones.

## Further reading

Internals, routes and pitfalls: [wiki, YouTube Music](../../doc/3_plugins/3_16_ytmusic.md) (in French); shared player: [wiki, music player](../../doc/1_architecture/1_6_lecteur-musique.md) (in French).
