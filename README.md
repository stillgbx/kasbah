# Kasbah

Application web (**tablette, ordinateur, téléphone**) qui montre la maison et le jardin en **3D** (souris et tactile) et permet de **visualiser et piloter les appareils connectés** placés dans les pièces : lumières, ouvrants, lecteurs, caméras, chauffage, robots, eau, énergie solaire et véhicules.

- La maison (étages, pièces, ouvertures, terrain, origine GPS, plugins actifs) est décrite dans un **fichier JSON** : voir [docs/house-json.md](docs/house-json.md) et le [wiki](doc/index.md).
- Chaque fabricant est un **plugin** côté serveur ; les secrets d'API vivent dans un `.env` **serveur**, jamais dans le navigateur.
- Six thèmes nommés, apparence clair / sombre / système / auto (soleil au-dessus de la maison), français et anglais.

## Architecture

```
kasbah/
  apps/web          Vite 8 + Vue 3 + Vuetify 4 + Three.js — l'application web
  apps/server       Node 22 + Fastify 5 — REST + WebSocket, hôte des plugins, sert le build web
  packages/shared   Schémas zod : kinds, états, commandes, protocole, maison + géométrie pure
  packages/mock-sim Moteur de simulation déterministe (plugin `mock` et démo sans serveur)
  house/            demo-house.json — maison de démonstration liée au plugin mock
  doc/              wiki du projet (architecture, plugins, UI, setup)
```

Flux : les plugins découvrent des appareils et poussent des **patchs d'état** → le registre fusionne, horodate et publie → le hub WebSocket envoie des **états complets** (coalescés 50 ms) aux navigateurs connectés. Les commandes passent en **REST** (`POST /api/devices/:id/command`) ; l'état résultant revient par le WebSocket.

Le contrat d'appareil est unique : un `kind` (forme de l'état et des commandes) et des `capabilities` (ce que l'UI affiche). Kinds : `light`, `cover`, `media_player`, `climate`, `vacuum`, `mower`, `sensor`, `energy`, `ev_charger`, `vehicle`, `camera`, `weather`, `water`.

## Fonctionnalités

Mise en page en grand écran (paysage) en trois colonnes : **rail** à gauche, **scène 3D** au centre, **panneau** contextuel à droite. En portrait, le panneau devient un tiroir. L'URL reflète la sélection (`#/?level=…&room=…&device=…`).

### Vues

| Vue | Rôle |
|---|---|
| **Maison** | Scène 3D, tuiles de synthèse, recherche, panneau pièce → appareil. Un doigt tourne, deux doigts zooment ; la caméra ne passe jamais sous le sol. |
| **Météo** | Conditions, prévisions, qualité de l'air et pollens (Open-Meteo). |
| **Lumières** | Bandes par niveau et pièce, interrupteur d'ensemble, curseur de luminosité. |
| **Ouvrants** | Volets, stores, portails : position, favori « my », gestes d'ensemble (sécuriser / ouvrir). |
| **Médias** | Lecteurs Cast et Sonos : transport, volume, pochette, relais son (barre HDMI ARC). |
| **Caméras** | Vignettes et direct (MSE / ffmpeg). |
| **Énergie** | Schéma de flux (solaire, maison, réseau, batterie), champs de panneaux, historique. |
| **Eau** | Station de filtration, débit, consommables, historique. |
| **Chauffage** | Zones et machine (pompe à chaleur), historique de fonctionnement. |
| **Véhicules** | Charge, carte (plan / satellite), réveil, limite de charge, carrosserie 3D. |
| **Robots** | Tondeuse (GPS, journal, quota) et aspirateur (serpillière selon capacités). |
| **Réglages** | Thème, rendu 3D, plugins, cartes d'appairage, mode édition. |

### Scène 3D

La géométrie (murs, sols, toit, ouvertures, jardin, piscine) est construite depuis le JSON. Chaque appareil porte une **pilule** (icône + nom). Styles de rendu : réaliste, nature, indigo, maquette, cyberpunk, candy. L'ambiance solaire (auto / jour / crépuscule / nuit) est indépendante du thème de l'app. Véhicules et tondeuse se placent d'après leur GPS.

En **mode édition** (Réglages) : poser et coter des ouvertures, affecter un ouvrant, régler des places de stationnement, déplacer les appareils.

### Ambiances

Les ambiances viennent des **plugins** (Hue : scènes fixes et palettes animées), pas d'un lot de commandes dans le JSON. Elles se rappellent depuis le panneau Maison / pièce, et se gèrent dans Réglages → Plugins.

## Plugins

Tous sont **implémentés** (plus aucun squelette). Ils sont tous disponibles au démarrage ; on coche ceux qu'on veut dans **Réglages → Plugins**. Le choix (et les sous-items, comme les types simulés par `mock`) est écrit dans le fichier de la maison, sous `plugins`, et prend effet sans redémarrer. Une maison sans cette section démarre avec la simulation seule.

| Id | Fabricant | Kinds | Accès |
|---|---|---|---|
| `mock` | Simulation de tous les types | tous | local |
| `hue` | Philips Hue | `light` | local (CLIP v2 + SSE) |
| `tahoma` | Somfy TaHoma | `cover` | local (API développeur Overkiz) |
| `nest` | Google Nest | `camera`, `climate` | cloud (Smart Device Management) |
| `google_cast` | Google Cast (enceintes, Chromecast, TV) | `media_player` | local (Cast v2 / mDNS) |
| `sonos` | Sonos | `media_player` | local (UPnP/SOAP) |
| `enphase` | Enphase (site, micro-onduleurs, batteries IQ) | `energy`, `sensor` | local (passerelle) |
| `tesla` | Tesla | `vehicle` | cloud (Fleet API, crédit mensuel) |
| `renault` | Renault (MY Renault) | `vehicle` | cloud privé (Gigya / Kamereon) |
| `automower` | Husqvarna Automower | `mower` | cloud (Automower Connect) |
| `comap` | COMAP Proteo 2 | `water` | local (TCP/23, sans auth) |
| `melcloud` | Mitsubishi Ecodan (MELCloud) | `climate` | cloud non officiel |
| `irobot` | iRobot Roomba | `vacuum` | local (MQTT) après une liaison compte |
| `open_meteo` | Open-Meteo | `weather` | cloud sans clé (CC BY 4.0) |

Détail, pièges et mise en route de chaque fabricant : [wiki, section Plugins](doc/index.md). La liste des clés `.env` est dans [apps/server/.env.example](apps/server/.env.example).

Certains plugins sont encore **lecture seule** ou partiels (consignes MELCloud, borne Enphase, lancement de file Sonos…). Le détail est sur la page wiki du plugin.

### Appairer un bridge Hue

1. Activez le plugin dans **Réglages → Plugins**. Sans `HUE_BRIDGE_HOST`, le bridge est cherché via `discovery.meethue.com` (fixez ensuite l'IP dans `.env`).
2. Le plugin passe en `needs_pairing` (visible dans Réglages).
3. Appuyez sur le bouton rond du bridge, puis dans les 30 s cliquez **Appairer le bridge** (ou `curl -X POST http://localhost:8787/api/plugins/hue/pair`).
4. Copiez la clé renvoyée dans `apps/server/.env` (`HUE_APP_KEY=…`) : le serveur ne modifie jamais ce fichier, mais la clé est utilisée immédiatement en mémoire.

Les autres fabricants ont leur **carte de mise en route** dans Réglages → Plugins (OAuth Nest / Tesla, jeton TaHoma / Enphase, identifiants Renault / MELCloud / iRobot, etc.).

### Écrire un plugin

Un plugin implémente [`DevicePlugin`](apps/server/src/core/plugin.ts) :

- `configSchema` : schéma zod de **ses** variables d'environnement ;
- `discover()` : retourne des `DeviceDescriptor` (`id = "<plugin>:<externalId>"`, `kind`, `capabilities`) ;
- `start()` : pousse l'état initial puis les changements via `ctx.emitState(externalId, patch)` ;
- `execute(externalId, command)` : traduit une commande générique (`light.set`, `cover.set_position`…) en appel fabricant ; lève `PluginError(code)` en cas d'échec ;
- optionnel : `registerRoutes(app)` (monté sous `/api/plugins/<id>/`), `health()`, scènes, prévisions, journal, consommation.

Déclarez-le dans [apps/server/src/plugins/index.ts](apps/server/src/plugins/index.ts). Le modèle d'appareils vit une seule fois dans [packages/shared/src/devices](packages/shared/src/devices). Marche à suivre et liste de contrôle : [doc/3_plugins/3_2_ecrire-un-plugin.md](doc/3_plugins/3_2_ecrire-un-plugin.md).

## Démarrage

### Machine neuve (Windows)

Les écrans n'installent rien : tout se passe sur la machine du serveur.

| Outil | Requis pour | Installation |
|---|---|---|
| Node ≥ 22, npm ≥ 10, git | tout | `winget install OpenJS.NodeJS.LTS` puis `winget install Git.Git` |
| ffmpeg | caméras (relais RTSP), lecture musicale (Cast / Sonos), matières 3D | `winget install Gyan.FFmpeg` |
| yt-dlp | YouTube Music, Mixcloud | `yt-dlp.exe` dans `_external/` (`YTM_YTDLP_PATH`, `MIXCLOUD_YTDLP_PATH`) |
| générateur PO Token + plugin yt-dlp `bgutil` | YouTube Music | voir [wiki, installation](doc/5_setup/5_0_installation-et-scripts.md) |

Rouvrir le terminal après un `winget install` : un processus déjà lancé ne voit pas le nouveau `PATH`.

```bash
git clone <dépôt> kasbah && cd kasbah
npm install
cp apps/server/.env.example apps/server/.env   # puis ajuster (Hue, TaHoma…)
npm run dev
```

Pour reprendre une maison existante, recopier depuis l'ancienne machine ce que git ne porte pas : `apps/server/.env`, `apps/server/.state/` (jetons et sessions des fabricants), `house/maison.json` (+ `maison.automations.json`, `history/`) et `_external/`.

### Lancer

| Commande | Maison | Usage |
|---|---|---|
| `npm run dev` | celle de `KASBAH_HOUSE_FILE` (défaut : démo + simulation) | développement, serveur relancé à chaque modification |
| `npm run house` | idem | la maison réelle au quotidien : serveur **sans** relance automatique, front Vite |
| `npm run build && npm start` | idem | production de base : tout sur `KASBAH_PORT` (8787), sans Vite |

Si npm bloque le script d'installation d'`esbuild` : `npm approve-scripts esbuild` puis `npm rebuild esbuild`.

- Web (Vite, HMR) : <http://localhost:5173> — accessible depuis un téléphone ou une tablette via l'IP du poste (`host: true`).
- Serveur : <http://localhost:8787> — `GET /api/health`, `GET /api/house`, `GET /api/devices`, WebSocket `/ws`, serveur MCP `/mcp` (voir [Serveur MCP](#serveur-mcp)).

Sans aucune configuration, le serveur démarre avec le plugin `mock` et la maison de démonstration : tout est pilotable immédiatement.

Front seul, sans serveur ni écriture dans la maison :

```bash
VITE_INPROCESS_MOCK=1 npm run dev -w @kasbah/web
```

### Production

Pas d'authentification ni de HTTPS en v1 : **réseau local de confiance uniquement**.

```bash
npm run build      # web → apps/web/dist, serveur → apps/server/dist/main.js (bundle esbuild)
npm start          # sert l'app web et l'API sur KASBAH_PORT (8787)
```

Depuis un autre appareil du réseau : `http://<ip-du-serveur>:8787`.

### Qualité

```bash
npm test           # vitest, tous les workspaces (shared, mock-sim, server, web)
npm run typecheck  # tsc / vue-tsc par workspace
npm run lint       # eslint (flat config, TypeScript + Vue)
```

## Serveur MCP

Le serveur Kasbah expose aussi un serveur [MCP](https://modelcontextprotocol.io) sur `http://localhost:8787/mcp` (Streamable HTTP, SDK TypeScript officiel v2, spec 2026-07-28, clients 2025 acceptés). Il démarre avec le serveur, rien à activer.

| Outil | Rôle |
|---|---|
| `list_devices` | Appareils et état courant, filtres `kind`, `room`, `query` |
| `get_device` | Descripteur complet et état d'un appareil |
| `send_command` | Commande un **vrai** appareil (même contrat et mêmes contrôles que `POST /api/devices/:id/command`) |
| `list_scenes` / `recall_scene` | Scènes des fabricants, et leur rappel |
| `get_health` | Santé des plugins |
| `search_music` | Recherche YouTube Music (titres), Mixcloud (mixes) ou Radios (stations), résultats prêts à jouer |
| `play_music` | Joue une piste ou une file sur une enceinte, par le lecteur commun (`/api/music/queue`) |
| `play_radio` | Joue une station en direct (`/api/plugins/radio/play`) |
| `get_school` | Devoirs à venir (ou passés), cahier de liaison et publications de l'école (TouteMonAnnée), en lecture seule, filtres de la vue École appliqués |

Ressource : `kasbah://house` (le `house.json` validé).

**Authentification OAuth, partout** (réseau local compris) : Kasbah est son propre serveur d'autorisation. À la première connexion, le client ouvre une page Kasbah (utilisateur + mot de passe), puis garde un jeton (accès 1 h, renouvellement 90 jours glissants). Les clients s'enregistrent seuls (enregistrement dynamique, ou document de métadonnées pour claude.ai).

- **Comptes** : `apps/server/mcp-users.json`, à côté du `.env`, hors dépôt, mots de passe hachés (scrypt). Les gérer dans **Réglages → Assistants IA (MCP)** (ajouter, changer le mot de passe, retirer ; depuis le réseau local seulement), ou en secours :
  ```bash
  npm run mcp-user -w @kasbah/server -- add <nom>
  ```
  (`remove <nom>` coupe aussi ses jetons, `list` les liste). Le fichier est relu à chaque connexion : pas besoin de redémarrer.
- **Jetons et clients enregistrés** : `apps/server/.state/mcp-auth.json` (hachés). Le supprimer déconnecte tous les clients.
- **Depuis Internet** (Claude sur le téléphone, connecteur claude.ai) : un proxy inverse HTTPS (celui du NAS Synology, ou un tunnel) vers `http://<poste>:8787`, et l'adresse dans `MCP_PUBLIC_URL`. Sous ce nom (`Host`, ou `X-Forwarded-Host`), Kasbah ne répond **qu'au MCP** (`/mcp`, `/oauth/*`, `/.well-known/oauth-*`) : tout le reste (interface, API, caméras, WebSocket) rend 404, même si le proxy transmet tout. Vérifier après coup que `https://<adresse>/` rend 404 et que `https://<adresse>/.well-known/oauth-protected-resource` annonce l'adresse en https (sinon le proxy ne transmet pas le nom d'origine). Puis sur claude.ai : Paramètres → Connecteurs → Ajouter un connecteur personnalisé → `https://<adresse>/mcp`.
- **Réseau local** : les clients bâtis sur le SDK MCP refusent d'envoyer leurs identifiants à un serveur d'autorisation en `http://` hors de la machine : `http://localhost:8787/mcp` sur le poste du serveur, l'adresse publique en https ailleurs.

`/mcp` n'accepte en plus que les requêtes adressées à `localhost` / `127.0.0.1`, `kasbah` / `kasbah.home.internal` ou au nom de `MCP_PUBLIC_URL` (en-têtes `Host` et `Origin`, protection contre le DNS rebinding).

### Brancher un assistant IA

Deux adresses : `http://localhost:8787/mcp` sur le poste du serveur, **`https://<adresse>/mcp`** (celle de `MCP_PUBLIC_URL`) partout ailleurs, **sans numéro de port** (le proxy répond sur 443 ; 8787 ne sert qu'entre le proxy et le poste). À la première connexion, la page Kasbah s'ouvre dans le navigateur : se connecter avec un compte de Réglages → Assistants IA. Nom conseillé pour le connecteur : `Kasbah`, en un mot, pour le viser dans le chat (`@Kasbah allume le salon`).

Procédures vérifiées avec Kasbah les 5 et 6 octobre 2026 (Claude, ChatGPT, Mistral Vibe, Grok).

| Assistant | Où se configure le connecteur | Ensuite |
|---|---|---|
| **Claude** (claude.ai, app mobile) | app web : Paramètres → Connecteurs → Ajouter un connecteur personnalisé → `https://<adresse>/mcp` | suit le compte : disponible aussi dans l'app mobile |
| **ChatGPT** | app web seulement, **mode développeur** activé : Plugins → Parcourir les plugins → **+** → Créer une application MCP. Nom, URL du serveur, authentification **OAuth** sans paramètres avancés, cocher « J'ai compris et je souhaite continuer », Créer, puis « Se connecter avec Kasbah » | disponible aussi dans l'app mobile |
| **Mistral Vibe** | app web seulement : Contexte → Connecteurs → Ajouter un connecteur → Ajouter un connecteur personnalisé. Nom, serveur `https://<adresse>/mcp`, authentification **OAuth2.1** sans paramètres avancés | disponible aussi dans l'app mobile |
| **Grok** | directement depuis l'**app mobile** : ajouter un connecteur personnalisé (nom, adresse) | — |
| **Gemini** | pas encore possible en France : les « applications personnalisées » de l'app grand public sont réservées aux États-Unis (compte personnel, interface en anglais) ; Gemini Enterprise demande un client OAuth fixe avec secret, que Kasbah ne gère pas | — |

- **Forfaits Claude gérés par une organisation** (Team, Enterprise…) : un membre ne peut pas ajouter son propre connecteur, c'est le propriétaire de l'organisation qui l'ajoute pour tous. Pour un serveur personnel comme Kasbah, passer par un compte Claude personnel.
- Les clients s'inscrivent seuls : Mistral et Grok par enregistrement dynamique, ChatGPT et claude.ai par document de métadonnées client. Rien à régler côté Kasbah.

Clients de bureau et de développement (serveur Kasbah lancé) :

- **Claude Code**
  ```bash
  claude mcp add --transport http kasbah http://localhost:8787/mcp
  ```
  (`https://<adresse>/mcp` depuis un autre poste), puis `/mcp` dans Claude Code pour s'authentifier.
- **VS Code** (`.vscode/mcp.json` ou configuration utilisateur)
  ```json
  { "servers": { "kasbah": { "type": "http", "url": "http://localhost:8787/mcp" } } }
  ```
- **Cursor** (`~/.cursor/mcp.json`)
  ```json
  { "mcpServers": { "kasbah": { "url": "http://localhost:8787/mcp" } } }
  ```
- **Claude Desktop** : par son fichier `claude_desktop_config.json` (Windows : `%APPDATA%\Claude\`, macOS : `~/Library/Application Support/Claude/`), indépendant du forfait. Le pont stdio `mcp-remote` (Node.js requis) vers l'adresse publique, ou `http://localhost:8787/mcp` sur le poste du serveur :
  ```json
  { "mcpServers": { "kasbah": { "command": "npx", "args": ["-y", "mcp-remote", "https://<adresse>/mcp"] } } }
  ```
  Quitter complètement Claude Desktop (icône de la zone de notification comprise) et le relancer : la page de connexion s'ouvre. `mcp-remote` garde ses jetons dans `~/.mcp-auth` (le supprimer force une reconnexion).
- **Tester à la main** : `npx @modelcontextprotocol/inspector`, transport « Streamable HTTP », URL ci-dessus.

**Dépannage**

- Journal de Claude Desktop : `%LOCALAPPDATA%\Claude\Logs\mcp-server-kasbah.log` (Windows, Microsoft Store), `%APPDATA%\Claude\logs\` (installateur classique), `~/Library/Logs/Claude/` (macOS).
- `ETIMEDOUT`, rien dans le journal de Kasbah : la connexion n'arrive pas jusqu'au serveur. Souvent un port dans l'adresse publique (`https://<adresse>:8787/mcp` au lieu de `https://<adresse>/mcp`).
- `http://kasbah:8787/mcp --allow-http` depuis un autre poste : le nom est accepté, mais la connexion échoue pendant OAuth. `--allow-http` ne lève que le contrôle de l'URL ; le SDK embarqué refuse ensuite d'envoyer les identifiants en `http://` hors de la machine locale (`Refusing to send credentials to non-https token endpoint`). Passer par l'adresse publique.
- « invalid state » à la fin de la connexion (Mistral) : la page de connexion venait d'un ajout précédent du connecteur, ou le formulaire a été envoyé deux fois. Supprimer le connecteur, l'ajouter une seule fois, se connecter en un seul clic.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `KASBAH_PORT` / `KASBAH_HOST` | `8787` / `0.0.0.0` | Écoute HTTP + WS |
| `KASBAH_HOUSE_FILE` | `house/demo-house.json` | Fichier de la maison |
| `KASBAH_STATIC_DIR` | `apps/web/dist` | Build web servi en production |
| `KASBAH_STATE_DIR` | `apps/server/.state` | Jetons, historiques, appareils déjà vus |
| `KASBAH_STRICT_PLUGINS` | `false` | `true` : une config de plugin invalide empêche le démarrage |
| `KASBAH_COMMAND_TIMEOUT_MS` | `10000` | Délai max d'une commande |
| `KASBAH_LOG_LEVEL` / `KASBAH_LOG_PRETTY` | `info` / `false` | Journalisation pino |
| `MOCK_SCENARIO` | `default` | `default`, `empty`, `chaos`, `winter` |
| `MOCK_TIME_SCALE` | `1` | Accélération du temps simulé (60 → une journée en 24 min) |
| `FFMPEG_PATH` | `ffmpeg` | Relais vidéo des caméras |

Chaque plugin valide ses propres variables (`HUE_*`, `TAHOMA_*`, `NEST_*`, `CAST_*`, `SONOS_*`, `ENPHASE_*`, `TESLA_*`, `RENAULT_*`, `AUTOMOWER_*`, `COMAP_*`, `MELCLOUD_*`, `IROBOT_*`, `OPEN_METEO_*`). Liste commentée : [apps/server/.env.example](apps/server/.env.example).

**Quels plugins sont actifs ne se règle pas ici.**

## Documentation

- [doc/index.md](doc/index.md) — wiki (architecture, contrat, chaque plugin, UI, setup, pièges).
- [docs/house-json.md](docs/house-json.md) — format du fichier maison (repère, pièces, relevé métré).
- [doc/5_setup/5_1_configuration-env.md](doc/5_setup/5_1_configuration-env.md) — variables d'environnement.

## Licence

Projet personnel.
