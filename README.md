# Kasbah

Application web (**tablette, ordinateur, téléphone**) qui montre la maison et le jardin en **3D** (souris et tactile) et permet de **visualiser et piloter les appareils connectés** placés dans les pièces : lumières, ventilateurs, ouvrants, lecteurs, caméras, chauffage, robots, eau, énergie solaire, véhicules et animaux. S'y ajoutent la musique (YouTube Music, Mixcloud, radios), la météo, l'agenda de la famille, le cahier de texte de l'école et des automatisations exécutées par le serveur.

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

Le contrat d'appareil est unique : un `kind` (forme de l'état et des commandes) et des `capabilities` (ce que l'UI affiche). Kinds : `light`, `cover`, `media_player`, `climate`, `vacuum`, `mower`, `sensor`, `energy`, `ev_charger`, `vehicle`, `camera`, `weather`, `water`, `pet_feeder`, `pet_fountain`, `fan`.

## Fonctionnalités

Mise en page en grand écran (paysage) en trois colonnes : **rail** à gauche, **scène 3D** au centre, **panneau** contextuel à droite. En portrait, le panneau devient un tiroir. L'URL reflète la sélection (`/?level=…&room=…&device=…`).

### Vues

| Vue | Rôle |
|---|---|
| **Maison** | Scène 3D, tuiles de synthèse, recherche, panneau pièce → appareil. Un doigt tourne, deux doigts zooment ; la caméra ne passe jamais sous le sol. |
| **Météo** | Conditions, prévisions, qualité de l'air et pollens (Open-Meteo). |
| **Agenda** | Agendas partagés de la famille (iCal) : mois, semaine, jour. |
| **École** | Devoirs, cahier de liaison et publications de la classe (TouteMonAnnée). |
| **Musique** | Lecteur commun : recherche et file d'attente YouTube Music, Mixcloud ou radios, joués sur une enceinte Cast ou Sonos. |
| **Lumières** | Bandes par niveau et pièce, interrupteur d'ensemble, curseur de luminosité ; ventilateurs (Tuya) au même endroit. |
| **Ouvrants** | Volets, stores, portails : position, favori « my », gestes d'ensemble (sécuriser / ouvrir). |
| **Médias** | Lecteurs Cast et Sonos : transport, volume, pochette, relais son (barre HDMI ARC). |
| **Caméras** | Vignettes et direct (MSE / ffmpeg). |
| **Énergie** | Schéma de flux (solaire, maison, réseau, batterie), champs de panneaux, historique. |
| **Eau** | Station de filtration, débit, consommables, historique. |
| **Chauffage** | Zones et machine (pompe à chaleur), historique de fonctionnement. |
| **Véhicules** | Charge, carte (plan / satellite), réveil, limite de charge, carrosserie 3D. |
| **Robots** | Tondeuse (GPS, journal, quota) et aspirateur (serpillière selon capacités). |
| **Animaux** | Mangeoires et fontaines PetKit : repas, distribution, eau, consommables. |
| **TENS** | Électrostimulateur actiTENS en Bluetooth, depuis le navigateur ; n'apparaît que sur les postes où il est activé. |
| **Automatisations** | Règles « Quand / Sauf si / Alors » (voir plus bas). |
| **Réglages** | Thème, rendu 3D, plugins, cartes de mise en route, comptes des assistants IA (MCP), mode édition. |

### Scène 3D

La géométrie (murs, sols, toit, ouvertures, jardin, piscine) est construite depuis le JSON. Chaque appareil porte une **pilule** (icône + nom). Treize styles de rendu : réaliste, nature, indigo, maquette, cyberpunk, candy, maison hantée, disco, Halloween, Noël, Star Wars — Tatooine, Akira, Girlyversaire. L'ambiance solaire (auto / jour / crépuscule / nuit) est indépendante du thème de l'app. Véhicules et tondeuse se placent d'après leur GPS.

En **mode édition** (Réglages) : poser et coter des ouvertures, affecter un ouvrant, régler des places de stationnement, déplacer les appareils.

### Ambiances

Les ambiances viennent des **plugins** (Hue : scènes fixes et palettes animées), pas d'un lot de commandes dans le JSON. Elles se rappellent depuis le panneau Maison / pièce, et se gèrent dans Réglages → Plugins.

### Automatisations

Des règles **Quand / Sauf si / Alors**, exécutées par le **serveur** (un écran éteint ne les arrête pas) :

- **Quand** : une heure, un moment solaire (lever, coucher…) ou un changement d'état d'un appareil, éventuellement maintenu un certain temps ;
- **Sauf si** : plages horaires, jours, dates, état d'un appareil, véhicule présent ou garé à une place, appareil allumé dans une pièce ;
- **Alors** : une commande sur des appareils nommés ou sur une sélection (tous les volets d'un niveau…), ou le rappel d'une ambiance.

Elles s'écrivent sur le contrat d'appareil, jamais sur un fabricant : un plugin désactivé rend la règle incomplète sans rien supprimer. Elles vivent dans `<maison>.automations.json`, à côté du fichier de la maison.

## Plugins

Tous sont **implémentés** (plus aucun squelette). Ils sont tous disponibles au démarrage ; on coche ceux qu'on veut dans **Réglages → Plugins**. Le choix (et les sous-items, comme les types simulés par `mock`) est écrit dans le fichier de la maison, sous `plugins`, et prend effet sans redémarrer. Une maison sans cette section démarre avec la simulation seule.

Chaque plugin a sa **page** : ce qu'il fait, comment il se connecte, sa mise en route pas à pas et ses variables `.env`.

| Id | Fabricant / service | Kinds | Accès | Page |
|---|---|---|---|---|
| `mock` | Simulation de tous les types | tous | local | [mock](docs/plugins/mock.md) |
| `hue` | Philips Hue | `light` | local (CLIP v2 + SSE) | [hue](docs/plugins/hue.md) |
| `tahoma` | Somfy TaHoma | `cover` | local (API développeur Overkiz) | [tahoma](docs/plugins/tahoma.md) |
| `nest` | Google Nest | `camera`, `climate` | cloud (Smart Device Management) | [nest](docs/plugins/nest.md) |
| `google_cast` | Google Cast (enceintes, Chromecast, TV) | `media_player` | local (Cast v2 / mDNS) | [google_cast](docs/plugins/google_cast.md) |
| `sonos` | Sonos | `media_player` | local (UPnP/SOAP) | [sonos](docs/plugins/sonos.md) |
| `enphase` | Enphase (site, micro-onduleurs, batteries IQ) | `energy`, `sensor` | local (passerelle) | [enphase](docs/plugins/enphase.md) |
| `tesla` | Tesla | `vehicle` | cloud (Fleet API, crédit mensuel) | [tesla](docs/plugins/tesla.md) |
| `renault` | Renault (MY Renault) | `vehicle` | cloud privé (Gigya / Kamereon) | [renault](docs/plugins/renault.md) |
| `automower` | Husqvarna Automower | `mower` | cloud (Automower Connect) | [automower](docs/plugins/automower.md) |
| `comap` | COMAP Proteo 2 | `water` | local (TCP/23, sans auth) | [comap](docs/plugins/comap.md) |
| `melcloud` | Mitsubishi Ecodan (MELCloud) | `climate` | cloud non officiel | [melcloud](docs/plugins/melcloud.md) |
| `irobot` | iRobot Roomba | `vacuum` | local (MQTT) après une liaison compte | [irobot](docs/plugins/irobot.md) |
| `open_meteo` | Open-Meteo | `weather` | cloud sans clé (CC BY 4.0) | [open_meteo](docs/plugins/open_meteo.md) |
| `petkit` | PetKit (mangeoires, fontaines) | `pet_feeder`, `pet_fountain` | cloud privé (connexion par code courriel) | [petkit](docs/plugins/petkit.md) |
| `tuya` | Tuya (ventilateur-lumière) | `fan`, `light` | local (protocole Tuya 3.5) | [tuya](docs/plugins/tuya.md) |
| `ytmusic` | YouTube Music | — (source musicale) | cloud non officiel (cookie du compte) | [ytmusic](docs/plugins/ytmusic.md) |
| `mixcloud` | Mixcloud | — (source musicale) | cloud public sans clé | [mixcloud](docs/plugins/mixcloud.md) |
| `radio` | Radios (radio-browser.info) | — (source musicale) | cloud libre sans clé | [radio](docs/plugins/radio.md) |
| `agenda` | Agendas Google partagés | — (vue Agenda) | adresse iCal secrète | [agenda](docs/plugins/agenda.md) |
| `toutemonannee` | TouteMonAnnée (école) | — (vue École) | cloud privé (compte parent) | [toutemonannee](docs/plugins/toutemonannee.md) |
| `tens` | actiTENS mini (électrostimulation) | — (vue TENS) | **dans le navigateur** (Web Bluetooth), activé par poste | [actitens](docs/plugins/actitens.md) |

La liste commentée des clés `.env` est dans [apps/server/.env.example](apps/server/.env.example) ; le fonctionnement interne et les pièges de chaque fabricant, dans le [wiki, section Plugins](doc/index.md).

Certains plugins sont encore **lecture seule** ou partiels (consignes MELCloud, borne Enphase, lancement de file Sonos…). Le détail est sur la page du plugin.

Les fabricants qui demandent une liaison ont leur **carte de mise en route** dans Réglages → Plugins (appairage Hue, OAuth Nest / Tesla, jeton Enphase, identifiants Renault / MELCloud / iRobot, code PetKit, cookie YouTube Music, adresse iCal, compte TouteMonAnnée…).

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

Pour reprendre une maison existante, recopier depuis l'ancienne machine ce que git ne porte pas : `apps/server/.env`, `apps/server/mcp-users.json` (comptes de l'accès extérieur et des assistants IA), `apps/server/.state/` (jetons et sessions des fabricants, sessions de l'accès extérieur), `house/maison.json` (+ `maison.automations.json`, `history/`) et `_external/`.

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

Sur le réseau local, l'interface et l'API ne demandent ni compte ni HTTPS : **réseau local de confiance**. Depuis Internet, tout passe par une adresse publique HTTPS où une connexion est exigée (voir [Accès depuis l'extérieur](#accès-depuis-lextérieur)).

```bash
npm run build      # web → apps/web/dist, serveur → apps/server/dist/main.js (bundle esbuild)
npm start          # sert l'app web et l'API sur KASBAH_PORT (8787)
```

Depuis un autre appareil du réseau : `http://<ip-du-serveur>:8787`.

### Accès depuis l'extérieur

Depuis un téléphone hors de la maison, sans VPN : un **proxy inverse HTTPS** (celui du NAS Synology, ou un tunnel) publie Kasbah sous une adresse publique, déclarée dans `MCP_PUBLIC_URL`. Kasbah reconnaît ce nom (`Host`, ou `X-Forwarded-Host`) et y exige une **connexion** :

- **Sous l'adresse publique** : page de connexion, puis toute l'application (interface, API, caméras, WebSocket). Le serveur MCP y répond aussi, avec ses propres jetons (voir [Serveur MCP](#serveur-mcp)).
- **Sur le réseau local** (`http://<ip>:8787`, `kasbah.home.internal`) : rien ne change, aucun compte demandé. C'est le **nom** qui décide, pas l'endroit : l'adresse publique demande la connexion même depuis la maison (par le proxy, toutes les requêtes arrivent du NAS).
- **Comptes** : les mêmes que ceux des assistants IA, dans **Réglages → Comptes**, gérés depuis le réseau local seulement (même connecté, l'adresse publique ne les montre pas).
- **Session** : un cookie de 90 jours, prolongé à chaque usage ; on se connecte une fois par appareil. Changer le mot de passe d'un compte ferme toutes ses sessions (téléphone perdu) ; le retirer aussi. « Se déconnecter » est dans Réglages → Comptes.
- **Blocage** : après 5 échecs de connexion d'affilée, le compte est bloqué 15 minutes, même avec le bon mot de passe (application et assistants IA ; `KASBAH_LOGIN_MAX_FAILURES`, `KASBAH_LOGIN_LOCK_MINUTES`). Les sessions ouvertes ne sont pas touchées.
- **App installable** : en HTTPS, le navigateur propose d'installer Kasbah, dès la page de connexion. Sur iPhone, l'app ajoutée à l'écran d'accueil a ses propres cookies : s'y connecter une fois.

**Mise en service sur un NAS Synology** (DSM 6 : Panneau de configuration → Portail des applications → Proxy inversé ; DSM 7 : Portail de connexion → Avancé → Proxy inversé) :

1. **D'abord** `MCP_PUBLIC_URL=https://<adresse>` dans `apps/server/.env`, et relancer Kasbah. Dans l'autre ordre, la règle publierait l'application **sans** connexion dès son enregistrement.
2. Règle de proxy inversé :
   - source : HTTPS, nom d'hôte `<adresse>`, port 443, HTTP/2 activé, pas de contrôle d'accès ;
   - destination : HTTP, IP du poste Kasbah, port 8787 ;
   - **en-têtes personnalisés** : Créer → WebSocket, qui ajoute `Upgrade: $http_upgrade` et `Connection: $connection_upgrade`. Sans eux, l'état en direct ne passe pas (l'app reste « hors ligne »).
3. Un certificat Let's Encrypt pour `<adresse>` (Sécurité → Certificat), associé à la règle.
4. Sur le routeur : le port 443 redirigé vers le NAS.
5. Lecture sur les enceintes (Cast, Sonos) depuis l'extérieur : `MUSIC_PUBLISH_BASE=http://<ip-du-poste>:8787`, sinon le serveur refuse (une enceinte ne peut pas lire l'adresse publique).

**Vérifier**, depuis le téléphone en 4G : `https://<adresse>/` ouvre la page de connexion, `https://<adresse>/.well-known/oauth-protected-resource` annonce l'adresse **en https** (sinon le proxy ne transmet pas le nom d'origine, et rien n'est protégé : le corriger avant tout). Une fois connecté, une lumière allumée change d'état à l'écran sans recharger.

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

- **Comptes** : `apps/server/mcp-users.json`, à côté du `.env`, hors dépôt, mots de passe hachés (scrypt) ; les mêmes ouvrent l'application par l'adresse publique. Les gérer dans **Réglages → Comptes** (ajouter, changer le mot de passe, retirer ; depuis le réseau local seulement), ou en secours :
  ```bash
  npm run mcp-user -w @kasbah/server -- add <nom>
  ```
  (`remove <nom>` coupe aussi ses jetons, `list` les liste). Le fichier est relu à chaque connexion : pas besoin de redémarrer.
- **Jetons et clients enregistrés** : `apps/server/.state/mcp-auth.json` (hachés). Le supprimer déconnecte tous les clients.
- **Depuis Internet** (Claude sur le téléphone, connecteur claude.ai) : l'adresse publique de [Accès depuis l'extérieur](#accès-depuis-lextérieur). Sous ce nom, `/mcp`, `/oauth/*` et `/.well-known/oauth-*` répondent avec les jetons du MCP ; le reste exige la connexion de l'application. Puis sur claude.ai : Paramètres → Connecteurs → Ajouter un connecteur personnalisé → `https://<adresse>/mcp`.
- **Réseau local** : les clients bâtis sur le SDK MCP refusent d'envoyer leurs identifiants à un serveur d'autorisation en `http://` hors de la machine : `http://localhost:8787/mcp` sur le poste du serveur, l'adresse publique en https ailleurs.

`/mcp` n'accepte en plus que les requêtes adressées à `localhost` / `127.0.0.1`, `kasbah` / `kasbah.home.internal` ou au nom de `MCP_PUBLIC_URL` (en-têtes `Host` et `Origin`, protection contre le DNS rebinding).

### Brancher un assistant IA

Deux adresses : `http://localhost:8787/mcp` sur le poste du serveur, **`https://<adresse>/mcp`** (celle de `MCP_PUBLIC_URL`) partout ailleurs, **sans numéro de port** (le proxy répond sur 443 ; 8787 ne sert qu'entre le proxy et le poste). À la première connexion, la page Kasbah s'ouvre dans le navigateur : se connecter avec un compte de Réglages → Comptes. Nom conseillé pour le connecteur : `Kasbah`, en un mot, pour le viser dans le chat (`@Kasbah allume le salon`).

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
| `MCP_PUBLIC_URL` | — | Adresse publique HTTPS : application avec connexion et serveur MCP (voir [Accès depuis l'extérieur](#accès-depuis-lextérieur)) |
| `KASBAH_LOGIN_MAX_FAILURES` / `KASBAH_LOGIN_LOCK_MINUTES` | `5` / `15` | Échecs de connexion d'affilée qui bloquent un compte (`0` = jamais), durée du blocage |
| `KASBAH_SESSIONS_FILE` | `.state/sessions.json` | Sessions de l'adresse publique (hachées) ; le supprimer déconnecte tout le monde |

Chaque plugin valide ses propres variables (`HUE_*`, `TAHOMA_*`, `NEST_*`, `CAST_*`, `SONOS_*`, `ENPHASE_*`, `TESLA_*`, `RENAULT_*`, `AUTOMOWER_*`, `COMAP_*`, `MELCLOUD_*`, `IROBOT_*`, `OPEN_METEO_*`, `PETKIT_*`, `TUYA_*`, `YTM_*`, `MIXCLOUD_*`, `RADIO_*`, `MUSIC_*`, `AGENDA_*`, `TMA_*`), détaillées sur la [page de chaque plugin](#plugins). Liste commentée : [apps/server/.env.example](apps/server/.env.example).

**Quels plugins sont actifs ne se règle pas ici.**

## Documentation

- [docs/plugins/](docs/plugins/) — une page par plugin : fonctionnalités, connexion, mise en route (liste dans [Plugins](#plugins)).
- [doc/index.md](doc/index.md) — wiki (architecture, contrat, chaque plugin, UI, setup, pièges).
- [docs/house-json.md](docs/house-json.md) — format du fichier maison (repère, pièces, relevé métré).
- [doc/5_setup/5_1_configuration-env.md](doc/5_setup/5_1_configuration-env.md) — variables d'environnement.

## Licence

Projet personnel.
