# Podcasts

| | |
|---|---|
| **Id** | `podcasts` |
| **Role** | music source: podcasts, found in the Apple Podcasts and Podcast Index directories or added by their RSS address |
| **Connection** | **cloud, official**: the Apple Podcasts directory (no key), Podcast Index (optional free key), then each show's public RSS feed |
| **Account** | none: subscriptions are kept by Kasbah, for the house and for each signed-in user |
| **Views** | Music ("Podcasts" source), Settings → Plugins |

## What the plugin does

- **Search** for shows in the Apple Podcasts directory and, if a key is set, in Podcast Index. Results Apple already gives are not listed twice.
- **Add by RSS address**: a show the search does not find can be added by pasting the address of its RSS feed (often behind "Subscribe" or "RSS" on the show's page).
- **Subscriptions**: **Subscribe** on a show's page; the **Subscriptions** tab lists them, and **New** merges the latest episodes of all of them (refreshed every 30 min).
- **Resume and played**: an interrupted episode restarts where you left it ("Resume at 12:34"), on any speaker or in the browser; an episode heard to the end is marked **Played**. **Start over** forgets both.
- **Playback** through the shared player (see below), with transfer from one speaker to another and playback in the browser. An episode plays on its own: it is not chained with the next ones.

Subscriptions, positions and played episodes belong to each account: the house has its own, and each signed-in user has theirs. The plugin publishes no device: it does not appear in the 3D house.

## The shared player

Playback is done by Kasbah's **shared music player**, shared with YouTube Music and Mixcloud. Podcasts only provide the catalog and the address of each episode's file. The shared player:

- serves the episode **over the house network** to the speaker, which plays it as a file: it knows the duration and lets you seek within it;
- keeps the **queue on the server side** and remembers **each speaker's last listen**, restored after a server restart.

The **target speakers** are **Google Cast** and **Sonos** players, which must also be enabled in Settings → Plugins. They refuse `127.0.0.1`: if you open Kasbah as `localhost` on the server machine, set `MUSIC_PUBLISH_BASE` (a shared player variable, see the [YouTube Music](ytmusic.md) page).

## Connection

Everything is public and official: no password, no cookie. The Apple Podcasts directory needs no key. Apple no longer gives the feed of some shows, though (Radio France's, for instance), even when that feed is still public: **Podcast Index** finds them, with a free key and secret created on [podcastindex.org](https://api.podcastindex.org). Without them, use **Add by RSS address**.

## Setup

1. Tick **podcasts** in **Settings → Plugins**.
2. Optional: create a Podcast Index key on [api.podcastindex.org](https://api.podcastindex.org), put `PODCASTINDEX_KEY` and `PODCASTINDEX_SECRET` in `apps/server/.env`, restart the server. The plugin's status then says "Apple + Podcast Index".
3. Open the **Music** view, choose the **Podcasts** source, search a show, open it, **Subscribe**, then start an episode on a speaker or in the browser.

No `yt-dlp` here. `ffmpeg` is only useful as a fallback, if an episode's file cannot be relayed as is.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PODCASTS_STATE_FILE` | `.state/podcasts.json` | The house's subscriptions, resume positions and played episodes (a signed-in user's are in their own folder) |
| `PODCASTS_COUNTRY` | `FR` | Apple Podcasts storefront used for the search |
| `PODCASTS_DIRECTORY_URL` | `https://itunes.apple.com` | Root of the Apple directory |
| `PODCASTINDEX_KEY` / `PODCASTINDEX_SECRET` | — | Podcast Index credentials; without them, Apple only |
| `PODCASTINDEX_URL` | `https://api.podcastindex.org` | Root of the Podcast Index API |

## Limitations

- Some feeds only keep their latest episodes (Radio France's, for instance): older ones are not in Kasbah either.
- The search finds shows, not episodes.
- An RSS address pointing to the local network (`localhost`, `192.168.x.x`, a `.local` name…) is refused; the check is on the address as written.
- Nothing is reported to Apple or to the podcast: Kasbah only reads the feed and the file.
- Not reachable from the assistant (MCP) yet.

## Further reading

Internals, routes and pitfalls: [wiki, Podcasts](../../doc/3_plugins/3_28_podcasts.md) (in French); shared player: [wiki, music player](../../doc/1_architecture/1_6_lecteur-musique.md) (in French).
