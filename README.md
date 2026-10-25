# Kasbah

[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/stillgbx)

*English · [Français](README.fr.md)*

A web app (**tablet, computer, phone**) that shows the house and garden in **3D** (mouse and touch) and lets you **see and control the connected devices** placed in its rooms: lights, fans, covers, players, cameras, heating, robots, water, solar power, vehicles and pets. On top of that: music (YouTube Music, Mixcloud, radio), weather, the family calendar, the school homework diary, and automations run by the server.

- The house (floors, rooms, openings, terrain, GPS origin, active plugins) is described in a **JSON file**: see [docs/house-json.md](docs/house-json.md) and the [wiki](doc/index.md) (in French).
- Each vendor is a server-side **plugin**; API secrets live in a **server** `.env`, never in the browser.
- Six named themes, light / dark / system / auto appearance (sun above the house), French and English.

## Overview

![Les Tilleuls, demo house, in light drizzle](docs/screenshots/maison-tilleuls.webp)

| Les Embruns (single story, flat roof) | Le Belvédère (apartment) |
|---|---|
| ![Les Embruns](docs/screenshots/maison-embruns.webp) | ![Le Belvédère](docs/screenshots/maison-belvedere.webp) |

### Views

| **Energy** | **Weather** |
|---|---|
| ![Energy view](docs/screenshots/energy.webp) | ![Weather view](docs/screenshots/weather.webp) |
| **Music** | **Calendar** |
| ![Music view](docs/screenshots/music.webp) | ![Calendar view](docs/screenshots/agenda.webp) |
| **Vehicles** | **Robots** |
| ![Vehicles view](docs/screenshots/vehicles.webp) | ![Robots view](docs/screenshots/robots.webp) |
| **Lights** | **Covers** |
| ![Lights view](docs/screenshots/lights.webp) | ![Covers view](docs/screenshots/covers.webp) |
| **Media** | **Heating** |
| ![Media view](docs/screenshots/media.webp) | ![Heating view](docs/screenshots/heating.webp) |
| **Water** | **Pets** |
| ![Water view](docs/screenshots/water.webp) | ![Pets view](docs/screenshots/pets.webp) |
| **School** | **Shopping list** |
| ![School view](docs/screenshots/school.webp) | ![Shopping list view](docs/screenshots/shopping.webp) |
| **Automations** | **One automation** |
| ![Automations view](docs/screenshots/automations.webp) | ![Editing an automation](docs/screenshots/automation-edit.webp) |
| **Settings** | **Settings → Plugins** |
| ![Settings](docs/screenshots/settings.webp) | ![Settings, plugins](docs/screenshots/settings-plugins.webp) |

### Themes

The same Energy view in six of the themes, light and dark.

| Kasbah, light | Kasbah, dark | Catppuccin, light |
|---|---|---|
| ![Kasbah light theme](docs/screenshots/theme-kasbah-light.webp) | ![Kasbah dark theme](docs/screenshots/theme-kasbah-dark.webp) | ![Catppuccin light theme](docs/screenshots/theme-catppuccin-light.webp) |
| **Dracula** | **Tokyo Night** | **Synthwave '84** |
| ![Dracula theme](docs/screenshots/theme-dracula-dark.webp) | ![Tokyo Night theme](docs/screenshots/theme-tokyo-night-dark.webp) | ![Synthwave '84 theme](docs/screenshots/theme-synthwave84-dark.webp) |

### 3D rendering

Les Tilleuls in eight of the thirteen rendering styles, at different times of day.

| Realistic, night | Realistic, dusk |
|---|---|
| ![Realistic style, night](docs/screenshots/style-realistic-night.webp) | ![Realistic style, dusk](docs/screenshots/style-realistic-dusk.webp) |
| **Model** | **Cyberpunk** |
| ![Model style](docs/screenshots/style-maquette-day.webp) | ![Cyberpunk style](docs/screenshots/style-cyberpunk-night.webp) |
| **Christmas** | **Star Wars — Tatooine** |
| ![Christmas style](docs/screenshots/style-noel-night.webp) | ![Tatooine style](docs/screenshots/style-tatooine-day.webp) |
| **Haunted house** | **Candy** |
| ![Haunted house style](docs/screenshots/style-haunted-night.webp) | ![Candy style](docs/screenshots/style-candy-day.webp) |

### On a phone

<img src="docs/screenshots/mobile-assistant.webp" alt="Home view on a phone, after an instruction to the assistant" width="300" align="right">

In portrait, the rail moves to the bottom and the panel becomes a drawer. The search bar of the Home view
also talks to the assistant (“Ask Kasbah”): it acts through Kasbah's tools, then says what it did. Here, it
retracted the terrace awning and turned on the pool light.

<br clear="right">

Screenshots of the three demo properties, running on the simulation (no real device). The data in the Music
and Calendar views is made up, and the exchange with the assistant is simulated: those views need a YouTube
Music account, a calendar or a Claude plan, which the demo doesn't have. Other views are shown on each
plugin's page ([docs/plugins](docs/plugins)).

## Getting started

### Fresh machine (Windows)

The screens install nothing: everything happens on the server machine.

| Tool | Needed for | Install |
|---|---|---|
| Node ≥ 22, npm ≥ 10, git | everything | `winget install OpenJS.NodeJS.LTS` then `winget install Git.Git` |
| ffmpeg | cameras (RTSP relay), music playback (Cast / Sonos), 3D materials | `winget install Gyan.FFmpeg` |
| yt-dlp | YouTube Music, Mixcloud | `yt-dlp.exe` in `_external/` (`YTM_YTDLP_PATH`, `MIXCLOUD_YTDLP_PATH`) |
| PO Token generator + `bgutil` yt-dlp plugin | YouTube Music | see [wiki, installation](doc/5_setup/5_0_installation-et-scripts.md) (in French) |

Reopen the terminal after a `winget install`: a process that is already running doesn't see the new `PATH`.

```bash
git clone https://github.com/stillgbx/kasbah.git && cd kasbah
npm install
cp apps/server/.env.example apps/server/.env   # then adjust (Hue, TaHoma…)
npm run dev
```

To move an existing house to a new machine, copy over what git doesn't carry: `apps/server/.env`, `apps/server/mcp-users.json` (accounts for remote access and AI assistants), `apps/server/.state/` (vendor tokens and sessions, remote-access sessions, selected property), `house/properties/` (the houses, their automations and their history) and `_external/`.

### Running

| Command | House | Use |
|---|---|---|
| `npm run dev` | the one selected in **Settings → Property** (demo or real); `KASBAH_HOUSE_FILE` forces one | development, server restarted on every change |
| `npm run house` | same | the real house day to day: server **without** auto-restart, Vite front end |
| `npm run build && npm start` | same | basic production: everything on `KASBAH_PORT` (8787), no Vite |

If npm blocks `esbuild`'s install script: `npm approve-scripts esbuild` then `npm rebuild esbuild`.

- Web (Vite, HMR): <http://localhost:5173> — reachable from a phone or tablet through the computer's IP (`host: true`).
- Server: <http://localhost:8787> — `GET /api/health`, `GET /api/house`, `GET /api/devices`, WebSocket `/ws`, MCP server `/mcp` (see [MCP server](#mcp-server)).

With no configuration at all, the server starts in **demo** mode: three fictional properties (`house/demos/`), each populated by the simulation, and everything can be controlled right away. Demos can be viewed but not modified.

**Your own house**: **Settings → Property → Create a property** (or the initials pad at the top of the rail). A wizard asks for the name, places **point 0** on the map (a corner of the house, from which every measurement starts) and the size of the plot, then guides you through drawing the outline and the rooms in edit mode. Real properties live in `house/properties/` (outside git); **Settings → Property** switches from demo mode to real mode and back whenever you like.

| Property | Location | What it shows |
|---|---|---|
| Les Tilleuls | Dijon | Two-story house with a gable roof: double garage and its doors, upstairs terrace, pool, sloping garden, roof panels and a motorized roof window, cameras and doorbell, TV and soundbar, two cars and a charger, light scenes |
| Les Embruns | Pornic | Contemporary L-shaped single-story house with a flat roof: panels on frames, skylights, adjustable sun louvers, carport, shade sail |
| Le Belvédère | Lille | Fourth-floor apartment: balcony, motorized curtains, intercom, no roof, no garden, no car |

Switch between demos with the initials pad at the top of the rail, or **Settings → Property**; every screen follows. The locations are public places; the names are fictional.

Front end only, without a server or writes to the house (also the three properties; the choice is remembered by the browser):

```bash
VITE_INPROCESS_MOCK=1 npm run dev -w @kasbah/web
```

### Production

On the local network, the interface and the API require neither an account nor HTTPS: **the local network is trusted**. From the Internet, everything goes through a public HTTPS address that requires signing in (see [Remote access](#remote-access)).

```bash
npm run build      # web → apps/web/dist, server → apps/server/dist/main.js (esbuild bundle)
npm start          # serves the web app and the API on KASBAH_PORT (8787)
```

From another device on the network: `http://<server-ip>:8787`.

To update the server without going to the machine, start it through its supervisor rather than
`npm start`: `node scripts/supervisor.mjs` builds the app if needed, restarts the server if it
crashes, and applies the latest version of `main` on request from **Settings → Server update**
(from the local network). An update runs pull, `npm ci` if dependencies changed, build and
restart, and rolls back to the previous version if anything fails. Starting with the machine (Windows
scheduled task, systemd service): [doc/5_setup/5_2_production.md](doc/5_setup/5_2_production.md) (in French).

### Remote access

From a phone away from home, without a VPN: an **HTTPS reverse proxy** (the Synology NAS one, or a tunnel) publishes Kasbah under a public address, declared in `MCP_PUBLIC_URL`. Kasbah recognizes that name (`Host`, or `X-Forwarded-Host`) and requires **signing in** there:

- **Under the public address**: a sign-in page, then the whole app (interface, API, cameras, WebSocket). The MCP server answers there too, with its own tokens (see [MCP server](#mcp-server)).
- **On the local network** (`http://<ip>:8787`, `kasbah.home.internal`): nothing changes, no account required. The **name** decides, not the place: the public address requires signing in even from home (through the proxy, every request comes from the NAS).
- **Local names**: an IP address, `localhost`, a short name (`kasbah`) or a name ending in `.internal`, `.local`, `.lan` or `.home.arpa`; add any other in `KASBAH_LAN_HOSTS`. Any other name is refused (protection against DNS rebinding), and so is a write or a WebSocket that a page from another site sends from a browser at home.
- **Accounts**: the same as the AI assistants' accounts, in **Settings → Accounts**, managed from the local network only (even when signed in, the public address doesn't show them).
- **Session**: a 90-day cookie, extended on every use; you sign in once per device. Changing an account's password closes all its sessions (lost phone); so does removing it. “Sign out” is in Settings → Accounts.
- **Lockout**: after 5 failed sign-ins in a row, the account is locked for 15 minutes, even with the right password (app and AI assistants; `KASBAH_LOGIN_MAX_FAILURES`, `KASBAH_LOGIN_LOCK_MINUTES`). Open sessions are not affected.
- **Installable app**: over HTTPS, the browser offers to install Kasbah, starting from the sign-in page. On iPhone, the app added to the home screen has its own cookies: sign in to it once.

**Setting it up on a Synology NAS** (DSM 6: Control Panel → Application Portal → Reverse Proxy; DSM 7: Login Portal → Advanced → Reverse Proxy):

1. **First** set `MCP_PUBLIC_URL=https://<address>` in `apps/server/.env`, and restart Kasbah. In the other order, the rule would publish the app **without** sign-in as soon as it is saved.
2. Reverse proxy rule:
   - source: HTTPS, hostname `<address>`, port 443, HTTP/2 enabled, no access control;
   - destination: HTTP, IP of the Kasbah computer, port 8787;
   - **custom headers**: Create → WebSocket, which adds `Upgrade: $http_upgrade` and `Connection: $connection_upgrade`. Without them, live state doesn't get through (the app stays “offline”).
3. A Let's Encrypt certificate for `<address>` (Security → Certificate), assigned to the rule.
4. On the router: port 443 forwarded to the NAS.
5. Playing on speakers (Cast, Sonos) from outside: `MUSIC_PUBLISH_BASE=http://<computer-ip>:8787`, otherwise the server refuses (a speaker can't play from the public address).

**Check**, from the phone on mobile data: `https://<address>/` opens the sign-in page, `https://<address>/.well-known/oauth-protected-resource` advertises the address **as https** (otherwise the proxy isn't forwarding the original name, and nothing is protected: fix that before anything else). Once signed in, a light you turn on changes state on screen without reloading.

### Quality

```bash
npm test           # vitest, all workspaces (shared, mock-sim, server, web)
npm run typecheck  # tsc / vue-tsc per workspace
npm run lint       # eslint (flat config, TypeScript + Vue)
```

## Architecture

```
kasbah/
  apps/web          Vite 8 + Vue 3 + Vuetify 4 + Three.js — the web app
  apps/server       Node 22 + Fastify 5 — REST + WebSocket, plugin host, serves the web build
  apps/android      Kotlin + Car App Library — the Android Auto app (gates, garage doors, voice)
  packages/shared   zod schemas: kinds, states, commands, protocol, house + pure geometry
  packages/mock-sim Deterministic simulation engine (`mock` plugin and server-less demo)
  house/            demos/ — three demo properties (gable-roof house, flat roof, apartment); properties/ — your properties (outside git); demo-house.json — the test house
  doc/              project wiki, in French (architecture, plugins, UI, setup)
```

Flow: plugins discover devices and push **state patches** → the registry merges, timestamps and publishes them → the WebSocket hub sends **full states** (coalesced over 50 ms) to connected browsers. Commands go through **REST** (`POST /api/devices/:id/command`); the resulting state comes back over the WebSocket.

There is a single device contract: a `kind` (shape of the state and commands) and `capabilities` (what the UI shows). Kinds: `light`, `cover`, `media_player`, `climate`, `vacuum`, `mower`, `sensor`, `energy`, `ev_charger`, `vehicle`, `camera`, `weather`, `water`, `pet_feeder`, `pet_fountain`, `fan`.

## Features

On a large (landscape) screen, a three-column layout: the **rail** on the left, the **3D scene** in the middle, a contextual **panel** on the right. In portrait, the panel becomes a drawer. The URL reflects the selection (`/?level=…&room=…&device=…`).

### Views

| View | Purpose |
|---|---|
| **Home** | 3D scene, summary tiles, current alerts (a click leads to the device), search, room → device panel. One finger rotates, two fingers zoom; the camera never goes below the ground. |
| **Weather** | Conditions, forecasts, air quality and pollen (Open-Meteo). |
| **Calendar** | The family's shared calendars (iCal): month, week, day. |
| **School** | Homework, the parent-teacher notebook and the class's posts (TouteMonAnnée). |
| **Music** | Shared player: search and queue from YouTube Music, Mixcloud or radio, played on a Cast or Sonos speaker. |
| **Lights** | Strips per level and room, all-on/all-off switch, brightness slider; fans (Tuya) in the same place. |
| **Covers** | Shutters, blinds, gates: position, “my” favorite, house-wide actions (secure / open the house, a room's shutters). |
| **Media** | Cast and Sonos players: transport, volume, artwork, audio relay (HDMI ARC soundbar). |
| **Cameras** | Thumbnails and live view (MSE / ffmpeg). |
| **Energy** | Flow diagram (solar, house, grid, battery), panel arrays, history. |
| **Water** | Filtration station, flow rate, consumables, history. |
| **Heating** | Zones and machine (heat pump), operating history. |
| **Vehicles** | Charging, map (street / satellite), wake-up, charge limit, 3D body, mileage tracking for a lease. |
| **Robots** | Mower (GPS, current task, zones to mow or exclude, map of the plot on the aerial photo and in 3D, log, quota) and vacuum (mopping depending on capabilities). |
| **Pets** | PetKit feeders and fountains: meals, dispensing, water, consumables. |
| **TENS** | actiTENS electrostimulator over Bluetooth, from the browser; only appears on the computers where it is enabled. |
| **Automations** | “When / Unless / Then” rules (see below). |
| **Settings** | Theme, order of the navigation bar on this device, 3D rendering, plugins, setup cards, AI assistant accounts (MCP), edit mode, aligning the house on the aerial photo. |

### 3D scene

The geometry (walls, floors, roof, openings, garden, pool) is built from the JSON. Each device carries a **pill** (icon + name). Thirteen rendering styles: realistic, nature, indigo, model, cyberpunk, candy, haunted house, disco, Halloween, Christmas, Star Wars — Tatooine, Akira, Girlyversaire. The sun lighting (auto / day / dusk / night) is independent of the app theme. Vehicles and the mower are placed from their GPS.

The scene also follows the weather from the plugin (Open-Meteo): falling rain and snow, slanted by the wind, wet ground, fog. The pool water has a swell that follows the wind's strength and direction, and caustics on the bottom that follow the sun.

In **edit mode** (Settings): place and dimension openings, assign a cover, set up parking spots, move devices.

### Light scenes

Light scenes come from the **plugins** (Hue: static scenes and animated palettes), not from a batch of commands in the JSON. They are recalled from the Home / room panel, and managed in Settings → Plugins.

### Automations

**When / Unless / Then** rules, run by the **server** (a screen that is off doesn't stop them):

- **When**: a time, a solar event (sunrise, sunset…) or a change in a device's state, optionally held for a while;
- **Unless**: time ranges, days, dates, a device's state, a vehicle present or parked in a spot, a device on in a room;
- **Then**: a command on named devices or on a selection (all the shutters on a level…), with a fade for Hue lights, or recalling a light scene.

They are written against the device contract, never against a vendor: a disabled plugin leaves the rule incomplete without deleting anything. They live in `<house>.automations.json`, next to the house file.

## Plugins

All of them are **implemented** (no more stubs). They are all available at startup; you tick the ones you want in **Settings → Plugins**. The choice (and the sub-items, such as the types simulated by `mock`) is written to the house file, under `plugins`, and takes effect without a restart. A house without that section starts with the simulation only.

Each plugin has its own **page**: what it does, how it connects, step-by-step setup and its `.env` variables.

| Id | Vendor / service | Kinds | Access | Page |
|---|---|---|---|---|
| `mock` | Simulation of every type | all | local | [mock](docs/plugins/mock.md) |
| `hue` | Philips Hue | `light` | local (CLIP v2 + SSE) | [hue](docs/plugins/hue.md) |
| `tahoma` | Somfy TaHoma | `cover` | local (Overkiz developer API) | [tahoma](docs/plugins/tahoma.md) |
| `nest` | Google Nest | `camera`, `climate` | cloud (Smart Device Management) | [nest](docs/plugins/nest.md) |
| `google_cast` | Google Cast (speakers, Chromecast, TV) | `media_player` | local (Cast v2 / mDNS) | [google_cast](docs/plugins/google_cast.md) |
| `sonos` | Sonos | `media_player` | local (UPnP/SOAP) | [sonos](docs/plugins/sonos.md) |
| `enphase` | Enphase (site, microinverters, IQ batteries) | `energy`, `sensor` | local (gateway) | [enphase](docs/plugins/enphase.md) |
| `tesla` | Tesla | `vehicle` | cloud (Fleet API, monthly credit) | [tesla](docs/plugins/tesla.md) |
| `renault` | Renault (MY Renault) | `vehicle` | private cloud (Gigya / Kamereon) | [renault](docs/plugins/renault.md) |
| `automower` | Husqvarna Automower | `mower` | cloud (Automower Connect) | [automower](docs/plugins/automower.md) |
| `comap` | COMAP Proteo 2 | `water` | local (TCP/23, no auth) | [comap](docs/plugins/comap.md) |
| `melcloud` | Mitsubishi Ecodan (MELCloud) | `climate` | unofficial cloud | [melcloud](docs/plugins/melcloud.md) |
| `irobot` | iRobot Roomba | `vacuum` | local (MQTT) after linking the account | [irobot](docs/plugins/irobot.md) |
| `open_meteo` | Open-Meteo | `weather` | cloud, no key (CC BY 4.0) | [open_meteo](docs/plugins/open_meteo.md) |
| `petkit` | PetKit (feeders, fountains) | `pet_feeder`, `pet_fountain` | private cloud (sign-in with an email code) | [petkit](docs/plugins/petkit.md) |
| `tuya` | Tuya (fan light) | `fan`, `light` | local (Tuya protocol 3.5) | [tuya](docs/plugins/tuya.md) |
| `hormann` | Hörmann (SupraMatic 4 garage doors) | `cover`, `light` | local (HCPBridgeMqtt bridge on the motor bus, HTTP) | [hormann](docs/plugins/hormann.md) |
| `ytmusic` | YouTube Music | — (music source) | unofficial cloud (account cookie) | [ytmusic](docs/plugins/ytmusic.md) |
| `mixcloud` | Mixcloud | — (music source) | public cloud, no key | [mixcloud](docs/plugins/mixcloud.md) |
| `radio` | Radio stations (radio-browser.info) | — (music source) | free cloud, no key | [radio](docs/plugins/radio.md) |
| `agenda` | Shared Google calendars | — (Calendar view) | secret iCal address | [agenda](docs/plugins/agenda.md) |
| `toutemonannee` | TouteMonAnnée (school) | — (School view) | private cloud (parent account) | [toutemonannee](docs/plugins/toutemonannee.md) |
| `claude` | Claude (Claude Code, each account's plan) | — (“Ask Kasbah” assistant) | `claude -p` on the server, through Kasbah's MCP | [claude](docs/plugins/claude-assistant.md) |
| `transcription` | Assistant voice (VoiceStudio, vLLM, Mistral) | — (microphone, spoken answers) | local or cloud (OpenAI route `/v1/audio/*`) | [transcription](docs/plugins/transcription.md) |
| `tens` | actiTENS mini (electrostimulation) | — (TENS view) | **in the browser** (Web Bluetooth), enabled per computer | [actitens](docs/plugins/actitens.md) |

The commented list of `.env` keys is in [apps/server/.env.example](apps/server/.env.example); the internals and pitfalls of each vendor are in the [wiki, Plugins section](doc/index.md) (in French).

Some plugins are still **read-only** or partial (MELCloud setpoints, Enphase charger, starting a Sonos queue…). The details are on each plugin's page.

Vendors that require linking have their **setup card** in Settings → Plugins (Hue pairing, Nest / Tesla OAuth, Enphase token, Renault / MELCloud / iRobot credentials, PetKit code, YouTube Music cookie, iCal address, TouteMonAnnée account…).

### Writing a plugin

A plugin implements [`DevicePlugin`](apps/server/src/core/plugin.ts):

- `configSchema`: zod schema of **its own** environment variables;
- `discover()`: returns `DeviceDescriptor`s (`id = "<plugin>:<externalId>"`, `kind`, `capabilities`);
- `start()`: pushes the initial state, then changes, through `ctx.emitState(externalId, patch)`;
- `execute(externalId, command)`: translates a generic command (`light.set`, `cover.set_position`…) into a vendor call; throws `PluginError(code)` on failure;
- optional: `registerRoutes(app)` (mounted under `/api/plugins/<id>/`), `health()`, scenes, forecasts, log, consumption.

Declare it in [apps/server/src/plugins/index.ts](apps/server/src/plugins/index.ts). The device model lives in one place only: [packages/shared/src/devices](packages/shared/src/devices). Step-by-step guide and checklist: [doc/3_plugins/3_2_ecrire-un-plugin.md](doc/3_plugins/3_2_ecrire-un-plugin.md) (in French).

## MCP server

The Kasbah server also exposes an [MCP](https://modelcontextprotocol.io) server at `http://localhost:8787/mcp` (Streamable HTTP, official TypeScript SDK v2, spec 2026-07-28, 2025 clients accepted). It starts with the server; nothing to enable.

| Tool | Purpose |
|---|---|
| `list_devices` | Devices and current state, filters `kind`, `room`, `query` |
| `get_device` | Full descriptor and state of a device |
| `send_command` | Controls a **real** device (same contract and same checks as `POST /api/devices/:id/command`) |
| `list_scenes` / `recall_scene` | Vendor scenes, and recalling them |
| `get_health` | Plugin health |
| `search_music` | Searches YouTube Music (tracks), Mixcloud (mixes) or Radio (stations), results ready to play |
| `play_music` | Plays a track or a queue on a speaker, through the shared player (`/api/music/queue`) |
| `play_radio` | Plays a live station (`/api/plugins/radio/play`) |
| `get_school` | Upcoming (or past) homework, the parent-teacher notebook and school posts (TouteMonAnnée), read-only, with the School view's filters applied |
| `get_weather` | Current weather, 24 h and 7-day forecasts, air quality, pollen and Météo-France warnings, for the house or a place looked up by name |
| `get_agenda` | Events from the house's calendars over a period (62 days at most), read-only |
| `list_automations` / `run_automation` / `set_automation_enabled` / `create_automation` / `update_automation` | Automations and their status, run now, enable or disable, create and edit; no deletion. A rule written by the assistant is flagged “to review” in the app, one that opens a gate or unlocks a car is created disabled, 10 creations per hour at most |
| `get_music` | What each player is playing, listens to resume, a player's queue |
| `queue_music` / `control_music` | Add to the queue without interrupting; next, previous, seek, remove, repeat, clear, resume, transfer to another speaker |
| `get_device_history` | Energy history (48 h), vendor log, water consumption of a device |
| `get_shopping_list` / `add_shopping_items` / `update_shopping_item` / `remove_shopping_item` / `finish_shopping` / `set_shopping_favorite` | The house's shopping list: read, add, tick or change the quantity (line picked by its name), remove, remove ticked lines, mark as a regular |

Resource: `kasbah://house` (the validated `house.json`).

**OAuth authentication, everywhere** (local network included): Kasbah is its own authorization server. On first connection, the client opens a Kasbah page (user + password), then keeps a token (1 h access, 90-day sliding refresh). Clients register themselves (dynamic registration, or a metadata document for claude.ai).

- **Accounts**: `apps/server/mcp-users.json`, next to `.env`, outside the repo, hashed passwords (scrypt); the same accounts open the app through the public address. Manage them in **Settings → Accounts** (add, change password, remove; from the local network only), or as a fallback:
  ```bash
  npm run mcp-user -w @kasbah/server -- add <name>
  ```
  (`remove <name>` also revokes its tokens, `list` lists them). The file is re-read on every sign-in: no restart needed.
- **Tokens and registered clients**: `apps/server/.state/mcp-auth.json` (hashed). Deleting it disconnects every client.
- **From the Internet** (Claude on the phone, claude.ai connector): the public address from [Remote access](#remote-access). Under that name, `/mcp`, `/oauth/*` and `/.well-known/oauth-*` answer with the MCP tokens; everything else requires signing in to the app. Then on claude.ai: Settings → Connectors → Add custom connector → `https://<address>/mcp`.
- **Local network**: clients built on the MCP SDK refuse to send their credentials to an authorization server over `http://` off the machine: use `http://localhost:8787/mcp` on the server computer, and the public https address elsewhere.

In addition, `/mcp` only accepts requests addressed to `localhost` / `127.0.0.1`, `kasbah` / `kasbah.home.internal` or the `MCP_PUBLIC_URL` name (`Host` and `Origin` headers, protection against DNS rebinding).

### Connecting an AI assistant

Two addresses: `http://localhost:8787/mcp` on the server computer, **`https://<address>/mcp`** (the `MCP_PUBLIC_URL` one) everywhere else, **with no port number** (the proxy answers on 443; 8787 is only used between the proxy and the computer). On first connection, the Kasbah page opens in the browser: sign in with an account from Settings → Accounts. Suggested connector name: `Kasbah`, one word, so you can target it in the chat (`@Kasbah turn on the living room`).

Procedures checked against Kasbah on 5 and 6 October 2026 (Claude, ChatGPT, Mistral Vibe, Grok).

| Assistant | Where to set up the connector | Then |
|---|---|---|
| **Claude** (claude.ai, mobile app) | web app: Settings → Connectors → Add custom connector → `https://<address>/mcp` | follows the account: also available in the mobile app |
| **ChatGPT** | web app only, with **developer mode** enabled: Plugins → Browse plugins → **+** → Create MCP app. Name, server URL, **OAuth** authentication without advanced settings, tick “I understand and want to continue”, Create, then “Connect to Kasbah” | also available in the mobile app |
| **Mistral Vibe** | web app only: Context → Connectors → Add connector → Add custom connector. Name, server `https://<address>/mcp`, **OAuth2.1** authentication without advanced settings | also available in the mobile app |
| **Grok** | directly from the **mobile app**: add a custom connector (name, address) | — |
| **Gemini** | not possible yet in France: the consumer app's “custom apps” are limited to the United States (personal account, English interface); Gemini Enterprise requires a fixed OAuth client with a secret, which Kasbah doesn't support | — |

- **Claude plans managed by an organization** (Team, Enterprise…): a member can't add their own connector; the organization owner adds it for everyone. For a personal server like Kasbah, use a personal Claude account.
- Clients register themselves: Mistral and Grok through dynamic registration, ChatGPT and claude.ai through a client metadata document. Nothing to configure on the Kasbah side.

Desktop and development clients (with the Kasbah server running):

- **Claude Code**
  ```bash
  claude mcp add --transport http kasbah http://localhost:8787/mcp
  ```
  (`https://<address>/mcp` from another computer), then `/mcp` in Claude Code to authenticate.
- **VS Code** (`.vscode/mcp.json` or user configuration)
  ```json
  { "servers": { "kasbah": { "type": "http", "url": "http://localhost:8787/mcp" } } }
  ```
- **Cursor** (`~/.cursor/mcp.json`)
  ```json
  { "mcpServers": { "kasbah": { "url": "http://localhost:8787/mcp" } } }
  ```
- **Claude Desktop**: through its `claude_desktop_config.json` file (Windows: `%APPDATA%\Claude\`, macOS: `~/Library/Application Support/Claude/`), whatever the plan. The `mcp-remote` stdio bridge (Node.js required) to the public address, or `http://localhost:8787/mcp` on the server computer:
  ```json
  { "mcpServers": { "kasbah": { "command": "npx", "args": ["-y", "mcp-remote", "https://<address>/mcp"] } } }
  ```
  Quit Claude Desktop completely (including its notification-area icon) and restart it: the sign-in page opens. `mcp-remote` keeps its tokens in `~/.mcp-auth` (deleting it forces a new sign-in).
- **Testing by hand**: `npx @modelcontextprotocol/inspector`, “Streamable HTTP” transport, URL above.

**Troubleshooting**

- Claude Desktop log: `%LOCALAPPDATA%\Claude\Logs\mcp-server-kasbah.log` (Windows, Microsoft Store), `%APPDATA%\Claude\logs\` (classic installer), `~/Library/Logs/Claude/` (macOS).
- `ETIMEDOUT`, nothing in Kasbah's log: the connection never reaches the server. Often a port in the public address (`https://<address>:8787/mcp` instead of `https://<address>/mcp`).
- `http://kasbah:8787/mcp --allow-http` from another computer: the name is accepted, but the connection fails during OAuth. `--allow-http` only lifts the URL check; the embedded SDK then refuses to send credentials over `http://` off the local machine (`Refusing to send credentials to non-https token endpoint`). Use the public address.
- “invalid state” at the end of sign-in (Mistral): the sign-in page came from an earlier addition of the connector, or the form was submitted twice. Delete the connector, add it once only, sign in with a single click.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `KASBAH_PORT` / `KASBAH_HOST` | `8787` / `0.0.0.0` | HTTP + WS listener |
| `KASBAH_HOUSE_FILE` | — | Forces a house (override, optional); when absent, the properties from `house/demos/` and `house/properties/`, selected in Settings → Property |
| `KASBAH_STATIC_DIR` | `apps/web/dist` | Web build served in production |
| `KASBAH_STATE_DIR` | `apps/server/.state` | Tokens, histories, devices already seen |
| `KASBAH_STRICT_PLUGINS` | `false` | `true`: an invalid plugin config prevents startup |
| `KASBAH_COMMAND_TIMEOUT_MS` | `10000` | Maximum duration of a command |
| `KASBAH_LOG_LEVEL` / `KASBAH_LOG_PRETTY` | `info` / `false` | pino logging |
| `MOCK_SCENARIO` | `default` | `default`, `empty`, `chaos`, `winter`; in demo mode, the device set follows the property (`winter` gives its winter version) |
| `MOCK_TIME_SCALE` | `1` | Speed-up of simulated time (60 → one day in 24 min) |
| `FFMPEG_PATH` | `ffmpeg` | Camera video relay |
| `MCP_PUBLIC_URL` | — | Public HTTPS address: app with sign-in, and MCP server (see [Remote access](#remote-access)) |
| `KASBAH_LOGIN_MAX_FAILURES` / `KASBAH_LOGIN_LOCK_MINUTES` | `5` / `15` | Failed sign-ins in a row that lock an account (`0` = never), lockout duration |
| `KASBAH_SESSIONS_FILE` | `.state/sessions.json` | Public-address sessions (hashed); deleting it signs everyone out |

Each plugin validates its own variables (`HUE_*`, `TAHOMA_*`, `NEST_*`, `CAST_*`, `SONOS_*`, `ENPHASE_*`, `TESLA_*`, `RENAULT_*`, `AUTOMOWER_*`, `COMAP_*`, `MELCLOUD_*`, `IROBOT_*`, `OPEN_METEO_*`, `PETKIT_*`, `TUYA_*`, `YTM_*`, `MIXCLOUD_*`, `RADIO_*`, `MUSIC_*`, `AGENDA_*`, `TMA_*`), detailed on [each plugin's page](#plugins). Commented list: [apps/server/.env.example](apps/server/.env.example).

**Which plugins are active is not set here.**

## Documentation

- [docs/plugins/](docs/plugins/) — one page per plugin: features, connection, setup (list in [Plugins](#plugins)).
- [doc/index.md](doc/index.md) — wiki, in French (architecture, contract, each plugin, UI, setup, pitfalls).
- [docs/house-json.md](docs/house-json.md) — house file format (reference frame, rooms, survey).
- [docs/android-auto.md](docs/android-auto.md) — the Android Auto app: gates and garage doors on the car's screen, an alert to open them when nearing home, voice, building and trying it.
- [doc/5_setup/5_1_configuration-env.md](doc/5_setup/5_1_configuration-env.md) — environment variables (in French).

## License

[MIT](LICENSE).
