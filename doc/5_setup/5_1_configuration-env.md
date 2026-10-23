# Configuration (.env)

> Dernière mise à jour : 2026-10-23
> Sources : `apps/server/src/config/env.ts`, `apps/server/.env.example`, `apps/server/src/plugins/{mock,hue,tahoma,nest}/index.ts`, `apps/server/src/plugins/google_cast/{index,known}.ts`, `apps/server/src/plugins/google_cast/enrich/cover.ts`, `apps/server/src/plugins/google_cast/bravia.ts`, `apps/server/src/plugins/enphase/index.ts`, `apps/server/src/plugins/tesla/index.ts`, `apps/server/src/plugins/comap/index.ts`, `apps/server/src/plugins/sonos/index.ts`, `apps/server/src/plugins/ytmusic/index.ts`, `apps/server/src/core/paths.ts`, `apps/server/test/state-isolation.ts`, `apps/server/.env.example`, `apps/server/src/music/player.ts`, `apps/server/src/plugins/{mixcloud,radio}/index.ts`, `apps/server/src/core/automations/schedule.ts` (`TZ`), `apps/server/src/plugins/claude/index.ts`, `apps/server/src/plugins/transcription/index.ts`, `apps/server/src/main.ts`, `.gitignore`, `apps/server/src/config/{catalog,properties}.ts`

## Où vivent les secrets

Uniquement dans `apps/server/.env` (ignoré par git ; `.env.example` est versionné). Le navigateur
n'en voit jamais rien : l'app web ne connaît que des URLs relatives. `main.ts` charge `.env` via
dotenv (chemin résolu par rapport au fichier, donc indépendant du répertoire courant).

## Variables du serveur (`config/env.ts`, validées par zod au démarrage)

| Variable | Défaut | Rôle |
|---|---|---|
| `KASBAH_PORT`, `KASBAH_HOST` | `8787`, `0.0.0.0` | écoute HTTP + WebSocket |
| ~~`KASBAH_PLUGINS`~~ | — | **supprimée le 2026-09-11** : l'activation vit dans `house.json` (voir plus bas) |
| `KASBAH_HOUSE_FILE` | absent : serveur de démonstration (`house/demos/`, depuis le 2026-10-08) ; `loadEnv()` garde `house/demo-house.json` pour les tests | maison ; une valeur donnée est résolue depuis le cwd du serveur → `../../house/ma-maison.json` |
| `KASBAH_STATIC_DIR` | `apps/web/dist` | build web servi en production |
| `KASBAH_STATE_DIR` | `apps/server/.state` | dossier des fichiers d'état (jetons, historiques, appareils connus) ; déplacé par les tests, voir plus bas |
| `KASBAH_STRICT_PLUGINS` | `false` | `true` : config de plugin invalide = arrêt (sinon plugin désactivé) |
| `KASBAH_COMMAND_TIMEOUT_MS` | `10000` | délai max d'une commande avant 504 |
| `KASBAH_LOG_LEVEL`, `KASBAH_LOG_PRETTY` | `info`, `false` (auto en TTY) | pino |

## Variables par plugin

Chaque plugin **valide ses propres clés** avec son `configSchema` ; l'hôte lui passe le résultat
déjà transformé (booléens, nombres). Les noms de clés sont exposés (sans valeur) dans `/api/health`
et dans Réglages → Plugins.

- **mock** : `MOCK_SCENARIO` (`default|empty|chaos|winter`), `MOCK_SEED`, `MOCK_START_TIME` (ISO 8601),
  `MOCK_TIME_SCALE`.
- **hue** : `HUE_BRIDGE_HOST` (recommandé), `HUE_APP_KEY` (obtenue par appairage), `HUE_EXPOSE_ROOMS`,
  `HUE_TLS_INSECURE` (défaut `true`, certificat Signify).

Les booléens acceptent `true|false|1|0`.

## Côté web

`VITE_INPROCESS_MOCK=1` (variable Vite, build ou dev) bascule sur la simulation in-process sans serveur.

### Mise à jour 2026-09-05 — chemins relatifs de `KASBAH_HOUSE_FILE` et `KASBAH_STATIC_DIR`

Les **défauts** sont des chemins absolus calculés depuis la racine du dépôt (`config/env.ts` :
`resolve(REPO_ROOT, …)`), mais une valeur **fournie** dans `apps/server/.env` est passée telle quelle
à `loadHouse` / `registerStatic`, donc résolue depuis le **répertoire courant du processus** —
`apps/server`, puisque c’est là que tournent `npm run dev` et `npm start`. D’où les formes
`KASBAH_HOUSE_FILE=../../house/maison.json` et `KASBAH_STATIC_DIR=../web/dist` que montre
`.env.example`. Un chemin absolu fonctionne aussi.

### Mise à jour 2026-09-08 — `KASBAH_SETTINGS_FILE` *(clé supprimée le 2026-09-11, voir plus bas)*

Chemin du JSON des **réglages par plugin** décidés depuis l'UI (défaut
`apps/server/.state/plugin-settings.json`, dossier ignoré par git). Comme `KASBAH_HOUSE_FILE`, une
valeur relative est résolue depuis le dossier de travail du serveur (`apps/server`) ; seul le défaut
est absolu depuis la racine du dépôt. Le fichier est **écrit** par le serveur (deuxième écriture
après `house.json`) et créé à la première modification ; absent, tous les réglages valent leur
défaut. Il ne contient aucun secret : les clés des fabricants restent dans `.env`.

### Mise à jour 2026-09-08 — `TAHOMA_*` (Somfy TaHoma)

| Variable | Défaut | Rôle |
|---|---|---|
| `TAHOMA_HOST` | — | Adresse de la box : `gateway-<PIN>.local` (le nom du certificat) ou son IP. **Obligatoire**, il n'y a pas de découverte. |
| `TAHOMA_PORT` | `8443` | Port de l'API locale. |
| `TAHOMA_TOKEN` | — | Jeton local généré dans l'appli mobile. Absent → plugin en `needs_pairing`. |
| `TAHOMA_TLS_INSECURE` | `true` | Le certificat est signé par l'AC Overkiz, pas par une AC publique. |
| `TAHOMA_POLL_MS` | `2000` | Cadence de sondage de l'écouteur d'événements (l'API locale ne pousse rien). |

Toutes sont optionnelles au sens du schéma zod : le plugin peut être activé sans être configuré et
le dit dans `/api/health` plutôt que d'empêcher le démarrage. La marche à suivre pour obtenir le
jeton — activation du mode développeur par **sept appuis sur le PIN dans l'appli mobile**, puis
resynchronisation de la box — est détaillée dans `.env.example` et dans
`../3_plugins/3_4_somfy-tahoma.md`.

Rappel : `.env` n'est pas versionné, et le **PIN de la passerelle comme le jeton n'ont rien à faire
dans un commit** (le PIN identifie l'installation ; il sert de nom d'hôte et de sujet du certificat).

### Mise à jour 2026-09-08 — `MOCK_EXCLUDE_KINDS` *(clé supprimée le 2026-09-11, voir plus bas)*

Kinds que la simulation ne doit pas fournir, séparés par des virgules (vide par défaut). Sert à lui
faire **compléter** un parc réel au lieu de le doubler ; détail et raison dans
`../3_plugins/3_0_simulation-mock.md`. Validé contre `DEVICE_KINDS` : une faute de frappe désactive
le plugin au démarrage au lieu de passer inaperçue.


### Mise à jour 2026-09-09 — `NEST_*` (Google Nest)

| Variable | Défaut | Rôle |
|---|---|---|
| `NEST_PROJECT_ID` | — | UUID du projet **Device Access** (pas le projet Google Cloud). |
| `NEST_CLIENT_ID`, `NEST_CLIENT_SECRET` | — | Client OAuth « application web » du projet Google Cloud. |
| `NEST_REFRESH_TOKEN` | — | Obtenu par la liaison du compte (Réglages → « Lier le compte Google »). Absent → `needs_pairing`. |
| `NEST_REDIRECT_URI` | `http://localhost:8787/api/plugins/nest/auth/callback` | Doit être déclarée **à l'identique** dans le client OAuth Google ; le port est celui de `KASBAH_PORT`. |
| `NEST_POLL_MS` | `60000` | Cadence de relecture de la liste des appareils (état du thermostat, ajouts / retraits). Plancher 10 s : Google borne les appels à quelques-uns par minute. |
| `FFMPEG_PATH` | `ffmpeg` | Binaire ffmpeg du relais vidéo (`core/video/`), sur la machine du **serveur**. Clé commune, non préfixée : d'autres plugins à caméras RTSP la liront aussi. |
| `NEST_LIVE_BUDGET` | `10` | Sessions RTSP ouvertes en même temps, au plus (directs regardés + vignettes de la vue Caméras). C'est ce qui coûte ; en dessous du nombre de caméras, les vignettes tournent. |
| `NEST_SNAPSHOT_MS` | `10000` | Cadence de la vignette JPEG de chaque session ouverte (2 s à 2 min). |
| `NEST_PUBSUB_SUBSCRIPTION` | *(vide)* | Abonnement Pub/Sub **pull** d'où tirer les événements (sonnette…). Nom complet `projects/<projet-cloud>/subscriptions/<abo>` — le projet **Cloud**, pas l'UUID Device Access. Vide → aucun événement, le reste marche. Prérequis Google et coût : voir `../3_plugins/3_5_google-nest.md`. |
| `NEST_PUBSUB_POLL_MS` | `5000` | Cadence de tirage de l'abonnement (1 s à 60 s). Une sonnerie arrive au plus tard au prochain tirage. |

Les trois premières manquantes → plugin en `error` avec la liste des clés à poser ; aucune n'empêche
le démarrage. La marche à suivre côté Google (Cloud Console, Device Access à 5 USD, consentement)
est dans `.env.example` et `../3_plugins/3_5_google-nest.md`. Le jeton de rafraîchissement est le
seul secret durable : il donne accès aux caméras du compte, il n'a rien à faire dans un commit.

### Mise à jour 2026-09-09 — `CAST_*` (Google Cast)

Plugin `google_cast` (`../3_plugins/3_6_google-cast.md`) : tout est local, aucun secret. Activer
dans Réglages → Plugins et y décocher « Lecteur » chez le mock (depuis le 2026-09-11 ; c'était
`KASBAH_PLUGINS=…,google_cast` et `MOCK_EXCLUDE_KINDS=…,media_player`).

| Variable | Défaut | Rôle |
|---|---|---|
| `CAST_MDNS_INTERFACE` | *(vide)* | IPv4 de la carte réseau qui porte le multicast mDNS. Machine à plusieurs cartes (VPN, VM) : sans elle la question peut partir sur la mauvaise carte et la liste reste vide (`health` : `degraded`, « no Cast device found »). |
| `CAST_DISCOVERY_WAIT_MS` | `3000` | Temps laissé aux appareils pour répondre à la première question mDNS avant de rendre la liste (0,5 s à 15 s). |
| `CAST_KNOWN_FILE` | `apps/server/.state/google-cast-devices.json` | Où retenir les appareils déjà vus (dernière annonce mDNS de chacun). Un Cast éteint ne s'annonce plus : ce fichier le garde dans l'inventaire, indisponible, avec son nom (`../3_plugins/3_6_google-cast.md`). **Chaîne vide = ne rien retenir** (l'appareil disparaît quand il s'éteint) ; c'est ce que font les tests, pour ne pas écrire la mémoire réelle du poste. |
| `CAST_MDNS_REFRESH_MS` | `60000` | Cadence des questions mDNS suivantes (appareils rallumés, annonces perdues ; 10 s à 10 min). |
| `CAST_COVER_LOOKUP` | `true` | Chercher la pochette d'un morceau que l'appareil nomme sans l'illustrer (appli de TV Android : aucune image, `contentId` vide), par titre + artiste dans les catalogues publics iTunes puis Deezer — sans clé ni compte, correspondance vérifiée avant d'accepter l'image (`../3_plugins/3_6_google-cast.md`). C'est la pochette de l'ALBUM, pas la vignette de la vidéo. `false` : il reste le logo de l'appli. |
| `CAST_CRUNCHYROLL_ENRICH` | `true` | Compléter les lectures Crunchyroll (série, saison, épisode, vignette) par l'API interne du service, en anonyme, sans compte — non officiel. `false` pour s'en passer. |

### Mise à jour 2026-09-10 — `CAST_BRAVIA_PROBE`

`CAST_BRAVIA_PROBE` (défaut `true`) : demander à une TV Sony (modèle mDNS `BRAVIA…`) où part son son par
son API REST locale (port 80, sans clé), toutes les 10 s tant qu'elle est connectée ; publié dans l'état
`audioOutput`. `false` pour s'en passer. Voir `../3_plugins/3_6_google-cast.md`.

### Mise à jour 2026-09-19 — `SONOS_*`

Plugin `sonos` (`../3_plugins/3_15_sonos.md`) : tout est local, aucun secret. Activer dans
Réglages → Plugins. Penser à décocher « Lecteur » chez le mock.

| Variable | Défaut | Rôle |
|---|---|---|
| `SONOS_SSDP_INTERFACE` | *(vide)* | IPv4 de la carte LAN pour le multicast SSDP. Machine à plusieurs cartes (VPN, APIPA `169.254`) : sans bind explicite **et** sans le balayage par interface de `discovery.ts`, la question part sur la mauvaise carte et la liste reste vide (`health` : `degraded`, « no Sonos player found yet »). Même piège que `CAST_MDNS_INTERFACE`. |
| `SONOS_SSDP_REFRESH_MS` | `60000` | Cadence des questions SSDP suivantes (appareils rallumés ; 10 s à 10 min). |
| `SONOS_POLL_MS` | `2000` | Relecture volume / lecture. 2 s : assez vif pour le curseur, sans inonder l'enceinte (0,5 s à 30 s). |
| `SONOS_REQUEST_TIMEOUT_MS` | `5000` | Borne d'une requête SOAP (le défaut undici est 300 s). |
| `SONOS_KNOWN_FILE` | `apps/server/.state/sonos-devices.json` | Mémoire des enceintes déjà vues. Une Sonos éteinte ne répond plus au SSDP : ce fichier la garde dans l'inventaire, indisponible, avec son nom. **Chaîne vide = ne rien retenir** ; c'est ce que font les tests. |

### Mise à jour 2026-09-20 — `YTM_*` (YouTube Music, non officiel)

Plugin `ytmusic` (`../3_plugins/3_16_ytmusic.md`) : **aucun secret dans `.env`**. Cookie collé
ou importé depuis Réglages (`POST …/cookie/from-browser`). Activer le plugin dans la maison ;
Cast et/ou Sonos doivent offrir `play_url`. **Node** sur le PATH (yt-dlp `--js-runtimes node`).

| Variable | Défaut | Rôle |
|---|---|---|
| `YTM_COOKIE_FILE` | `apps/server/.state/ytmusic-cookie.txt` | Cookie brut (`__Secure-3PAPISID` obligatoire). Chaîne vide = mémoire seule (tests). |
| `YTM_PO_TOKEN_URL` | `http://127.0.0.1:4416` | Générateur PO Token (ping `/ping`). |
| `YTM_YTDLP_PATH` | `yt-dlp` | Binaire yt-dlp. |
| `YTM_PUBLISH_BASE` | *(vide)* | Base URL LAN du proxy stream (`http://192.168.x.x:8787`). Obligatoire si l'UI parle en localhost. |
| `FFMPEG_PATH` | `ffmpeg` | Déjà documenté (Nest) — proxy audio MP3 pour Cast/Sonos. |

*(Dépassé le 2026-09-23 : `YTM_PUBLISH_BASE` est devenue `MUSIC_PUBLISH_BASE`, clé du lecteur commun, `YTM_PUBLISH_BASE` n'étant plus lue qu'en repli — voir « Lecteur musique commun » dans la section du 2026-09-23 plus bas.)*

#### Mise à jour 2026-09-22 — `YTM_RESUME_LEAD_MS`, **ajoutée puis SUPPRIMÉE le même jour**

> **La variable n'existe plus** (ni dans le schéma zod du plugin, ni dans `apps/server/.env.example`).
> Elle compensait l'absence de taille du flux proxy : le temps que la cible d'un transfert remplisse
> son tampon. Le proxy sert désormais un « fichier » MP3 de taille connue et c'est **l'enceinte**
> qui se place, par une commande `media_player.seek` — il n'y a plus de tampon à anticiper. Le seul
> réglage de ce genre qui reste est en **dur** dans le code : `TRANSFER_LEAD_S = 1 s`, le temps de
> démarrage de la cible (`apps/server/src/plugins/ytmusic/index.ts`). Une maison qui l'aurait posée
> dans son `.env` peut la retirer sans rien changer d'autre : une clé inconnue est ignorée (les schémas zod
> de configuration ne sont pas `strict`, `plugin-host.ts` les applique à `process.env` entier).
> Conservé ci-dessous pour mémoire — pourquoi elle a existé dit pourquoi le modèle a changé
> (`../3_plugins/3_16_ytmusic.md`).


| Variable | Défaut | Rôle |
|---|---|---|
| `YTM_RESUME_LEAD_MS` | `1100` (borné 0–5 000) | Avance, en ms, ajoutée à la position d'une reprise après **transfert** : le temps que la cible remplisse son tampon avant le premier son, que la source n'attend pas. Sans elle, la cible repartait ~1 s en arrière. **Valeur calée à l'oreille** : trop de retour en arrière → l'augmenter ; cible en avance → la baisser. Sert aussi à la soustraction qui retient où l'écoute en était à la fermeture d'une connexion. Détail : `../3_plugins/3_16_ytmusic.md`. |

### Mise à jour 2026-09-11 — clés `ENPHASE_*`

| Clé | Défaut | Rôle |
|---|---|---|
| `ENPHASE_HOST` | `envoy.local` | Nom ou IP de la passerelle IQ. **HTTPS seul** : son port 80 refuse la connexion, et son certificat auto-signé est accepté pour elle seule. Le nom `envoy.local` suppose que le mDNS le porte — il ne se résout pas sur toutes les machines, auquel cas donner l'IP. |
| `ENPHASE_TOKEN` | (vide) | Jeton d'**amorçage**, facultatif. Rien à mettre là dans le cas normal : l'appairage se fait depuis les Réglages et le serveur garde le jeton lui-même. Utile pour un premier démarrage sans interface, ou pour forcer un jeton précis. |
| `ENPHASE_TOKEN_FILE` | `apps/server/.state/enphase-token.json` | Où le serveur garde le jeton (il vaut un an). **Chaîne vide = ne rien garder**, et l'appairage est alors perdu à chaque redémarrage — la carte des Réglages le dit. |
| `ENPHASE_CLOUD_FILE` | `apps/server/.state/enphase-cloud.json` | Session Enlighten (borne). Distincte du jeton local : coller un JWT n'ouvre pas le cloud. **Chaîne vide = ne pas garder** la session. |
| `ENPHASE_POLL_MS` | `10000` | Cadence des compteurs temps réel (`/ivp/livedata/status`, 0,2 s de réponse). |
| `ENPHASE_SLOW_POLL_MS` | `60000` | Cadence des micro-onduleurs, des batteries et des totaux du jour. Inutile de descendre : un onduleur ne rapporte que toutes les cinq minutes environ. |

Il n'y a **volontairement pas** de clé pour le mot de passe du compte Enphase : il est demandé au
moment de frapper un jeton, et jamais conservé (`../3_plugins/3_7_enphase.md`). Le numéro de série
n'est jamais à saisir non plus, `/info` le donne sans authentification.

Entre le jeton de `ENPHASE_TOKEN` et celui du cache, le serveur garde **celui qui expire le plus
tard** : un vieux jeton oublié ici n'éclipse donc pas un jeton frais.

`MOCK_EXCLUDE_KINDS` gagne une conséquence : l'exclusion emporte ce qui appartient à l'installation
du kind exclu, donc `energy` retire le site solaire simulé **et** ses vingt panneaux, qui sont des
capteurs (`../3_plugins/3_0_simulation-mock.md`).

*(Dépassé le 2026-09-11 : `MOCK_EXCLUDE_KINDS` est supprimée le même jour, voir plus bas. La règle, elle, vaut pour les sous-items du mock : décocher `energy` retire le site solaire simulé et ses panneaux.)*

### Mise à jour 2026-09-11 — `KASBAH_PLUGINS` et `KASBAH_SETTINGS_FILE` disparaissent

« La gestion des plugins dans le .env, c'est assez pénible » : **quels plugins sont actifs ne se
règle plus ici**. Tous sont disponibles, on coche les siens dans Réglages → Plugins, et le choix est
écrit dans la maison (`../2_maison/2_0_format-house-json.md`, section `plugins`), avec ses
sous-items. `.env` ne garde que les ports, les chemins, les clés et les jetons.

| Clé | Devient |
|---|---|
| `KASBAH_PLUGINS` | supprimée — `house.json` → `plugins.<id>.enabled`. Maison sans section : la simulation seule. |
| `KASBAH_SETTINGS_FILE` | supprimée avec le fichier `.state/plugin-settings.json` : son unique réglage (`autoDynamicForNewScenes`) vit dans la maison. Un fichier resté là est simplement ignoré. |
| `MOCK_EXCLUDE_KINDS` | supprimée — sous-items du plugin mock (`../3_plugins/3_0_simulation-mock.md`). |

`KASBAH_STRICT_PLUGINS` survit, avec une nuance : une config invalide n'arrête le démarrage que si
le plugin concerné est **coché dans la maison**. Sinon le plugin est listé en `error`, sans plus.

**Migration** d'une installation existante : recopier l'ancienne liste `KASBAH_PLUGINS` en cochant
les mêmes fabricants dans Réglages (ou en écrivant la section `plugins` à la main), une fois.


### Mise à jour 2026-09-13 — `TESLA_*`

Plugin `tesla` (`../3_plugins/3_8_tesla.md`). Les secrets sont ceux de l'**application** créée sur
developer.tesla.com ; les jetons du compte, eux, sont gardés par le serveur.

| Variable | Défaut | Rôle |
|---|---|---|
| `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET` | — | identifiants de l'application ; absents → `needs_pairing` |
| `TESLA_DOMAIN` | — | hôte (sans `https://`) qui sert la clé publique, celui déclaré dans l'application |
| `TESLA_REGION` | `eu` | `eu` ou `na` : base de l'API et `audience` des jetons |
| `TESLA_REDIRECT_URI` | `http://localhost:8787/api/plugins/tesla/auth/callback` | à déclarer telle quelle dans l'application |
| `TESLA_TOKEN_FILE` | `apps/server/.state/tesla-token.json` | jetons du compte (le refresh token est à usage unique : réécrit à chaque tour) ; vide = liaison perdue au redémarrage |
| `TESLA_KEY_FILE` | `apps/server/.state/tesla-key.json` | clé privée de l'application (sa clé publique est celle du domaine) |
| `TESLA_STATE_FILE` | `apps/server/.state/tesla-state.json` | dernier état de chaque véhicule et consommation du mois ; vide = ne rien garder |
| `TESLA_POLL_MS` | `600000` | cadence de la liste (veille) et, véhicule éveillé, de la lecture complète |
| `TESLA_REST_MS` | `900000` | après une lecture au repos, délai sans relecture (le temps qu'il s'endorme) ; 0 = jamais |
| `TESLA_DAILY_DATA_BUDGET` | `100` | lectures complètes par jour au plus (1 $ pour 500 chez Tesla) ; 0 = veille seule |

Les cadences se lisent en **dollars et en batterie**, pas en confort : voir la page du plugin avant
d'y toucher.

### Mise à jour 2026-09-16 — plugin Open-Meteo

Aucune clé : l'API est libre et la position vient de `origin` dans `house.json`. Une seule variable,
facultative : `OPEN_METEO_POLL_MS` (défaut 600 000, soit dix minutes ; bornes 1 min – 1 h). Les
modèles se relancent à l'heure, sonder plus souvent relit la même chose. Activation dans Réglages →
Plugins (« open meteo »), comme les autres. Voir `../3_plugins/3_10_open-meteo.md`.

Sources : `apps/server/.env.example`, `apps/server/src/plugins/open_meteo/index.ts`.

### Mise à jour 2026-09-17 — `COMAP_*` (station de filtration d'eau)

| Variable | Rôle |
|---|---|
| `COMAP_HOST` | Adresse de la station sur le LAN. **Aucune découverte** : adresse fixe. *(Mise à jour 2026-10-06 : aucun défaut, et la clé est facultative dans le schéma — `apps/server/src/plugins/comap/index.ts`, commit f4c1ee8. Sans elle le plugin ne déclare aucun appareil, ne pose aucun poller, `/raw` répond 409 et sa santé dit « set COMAP_HOST to the station address », comme pour `TAHOMA_HOST`. La maison la renseigne dans son `.env`.)* |
| `COMAP_PORT` | `23` — le seul port ouvert, et ce n'est pas du telnet (JSON en clair, voir `../3_plugins/3_12_comap-proteo.md`). |
| `COMAP_POLL_MS` | Cadence de sondage, `30000`. LAN pur, aucun quota ; la prudence vient de la collision possible avec l'appli du fabricant, pas d'un plafond d'appels. |
| `COMAP_TIMEOUT_MS` | `5000`. Abandon d'une lecture restée muette — un silence isolé est **normal**. |
| `COMAP_HISTORY_FILE` | Où garder l'historique de consommation déjà calculé (`apps/server/.state/comap-consumption.json`). Chaîne vide = ne rien garder ; sans lui, l'historique repart de zéro à chaque redémarrage. |

Deux choses distinguent ce bloc de tous les autres plugins de ce fichier :

- **Il n'y a rien à appairer.** Pas de clé, pas de secret, pas de jeton, pas de page de liaison : la
  station répond à qui la sonde sur le réseau local. C'est une information de sécurité autant qu'une
  facilité — tout le LAN peut la lire, et écrire dedans.
- **Elle n'accepte qu'UNE connexion à la fois.** L'appli mobile du fabricant s'en sert aussi ; une
  lecture lancée pendant qu'elle tient la connexion est **acceptée puis reste muette**, sans erreur.
  D'où une connexion **courte** (ouvre, lit, ferme) à chaque sondage plutôt qu'une connexion
  permanente, qui casserait l'appli du propriétaire.

### Mise à jour 2026-09-19 — `KASBAH_STATE_DIR`, et un seul endroit qui décide des chemins

Les dix clés qui désignent un fichier d'état (`CAST_KNOWN_FILE`, `COMAP_HISTORY_FILE`,
`MELCLOUD_SESSION_FILE`, `MELCLOUD_HISTORY_FILE`, `ENPHASE_TOKEN_FILE`, `ENPHASE_CLOUD_FILE`, `RENAULT_SESSION_FILE`,
`TESLA_TOKEN_FILE`, `TESLA_KEY_FILE`, `TESLA_STATE_FILE`, `AUTOMOWER_USAGE_FILE`) calculaient
chacune son défaut avec sa propre remontée de dossiers. Elles passent toutes par
`stateFile(nom)` (`apps/server/src/core/paths.ts`), qui lit **`KASBAH_STATE_DIR`** et retombe sur
`apps/server/.state`.

*(Constat du lint du 2026-10-06 : la liste ci-dessus est incomplète, et le compte « dix » n'a plus cours. Passent aussi par `stateFile` : `SONOS_KNOWN_FILE`, `TAHOMA_LIGHT_HISTORY_FILE`, `TAHOMA_QUIET_FILE`, `IROBOT_SESSION_FILE`, `PETKIT_SESSION_FILE`, `AGENDA_FILE`, `TMA_FILE`, `MCP_AUTH_FILE`, `YTM_COOKIE_FILE`, `MUSIC_STATE_FILE`, `MIXCLOUD_STATE_FILE`, `RADIO_FAVORITES_FILE`… ; `MCP_USERS_FILE` n'en fait pas partie : `mcp-users.json` vit à côté du `.env`. Le plus sûr est de chercher `stateFile(` dans `apps/server/src`.)*

Le premier client de cette variable est la suite de tests : `apps/server/test/state-isolation.ts`,
chargé en `setupFiles`, la pointe vers un dossier temporaire par processus. Sans quoi un test qui
construit un plugin avec sa configuration par défaut charge et réécrit l'état **réel** du poste —
c'est ce qui arrivait à `comap-consumption.json` et `melcloud-history.json` (voir
`../6_faq/6_1_pieges-runtime.md`, entrées du 2026-09-10 et du 2026-09-19).

Elle sert aussi à donner à l'état un dossier hors du dépôt (volume Docker, `/var/lib/kasbah`) sans
toucher aux dix clés une par une ; chacune reste réglable individuellement si besoin.

### Mise a jour 2026-09-21 — `TUYA_*` (ventilateur-lumiere CREATE, local)

Plugin `tuya` (`../3_plugins/3_18_tuya.md`). Pas de cloud apres la cle. Decouverte par
broadcast inutilisable : IP en configuration + bail DHCP statique.

| Variable | Defaut | Role |
|---|---|---|
| `TUYA_DEVICES` | *(vide)* | Tableau JSON `[{ id, key, ip, name, version? }]`. Cle jamais en CLI ni en log. |
| `TUYA_COMMAND_TIMEOUT_MS` | `8000` | Attente de l'effet apres ecriture. |
| `TUYA_RECONNECT_MS` | `700` | Intervalle de reconnexion. |

### Mise à jour 2026-09-23 — lecteur musique commun (`MUSIC_PUBLISH_BASE`), `MIXCLOUD_*`, `RADIO_*`

**Lecteur musique commun** (`../1_architecture/1_6_lecteur-musique.md`) : la lecture sort du plugin
YouTube Music, et deux clés avec elle. Elles ne sont plus dans le schéma de `ytmusic` mais dans
`musicConfigSchema` (`apps/server/src/music/player.ts`), lu par `app.ts` sur l'environnement complet.
Bloc « Lecteur musique commun » de `apps/server/.env.example`.

| Variable | Défaut | Rôle |
|---|---|---|
| `MUSIC_PUBLISH_BASE` | *(vide)* | Base URL LAN publiée aux enceintes Cast/Sonos (`http://192.168.1.90:8787` dans l'exemple). Vide = dérivée de l'en-tête `Host` du navigateur ; obligatoire si l'UI parle en localhost. **Remplace `YTM_PUBLISH_BASE`** (section du 2026-09-20), encore lue en repli. |
| `FFMPEG_PATH` | `ffmpeg` | Inchangée (clé commune) ; le repli MP3 du lecteur la lit désormais à la place de ytmusic. |

**Plugin Mixcloud** (`../3_plugins/3_20_mixcloud.md`) : **aucune clé ni mot de passe** — le compte
est un nom d'utilisateur saisi dans l'UI, gardé avec les positions de reprise dans le fichier d'état.
Bloc « Plugin Mixcloud » de `.env.example`.

| Variable | Défaut | Rôle |
|---|---|---|
| `MIXCLOUD_STATE_FILE` | `.state/mixcloud.json` (`stateFile`) | Nom d'utilisateur + positions de reprise. |
| `MIXCLOUD_YTDLP_PATH` | *(vide)* | Binaire yt-dlp ; vide = `YTM_YTDLP_PATH`, puis `yt-dlp`. |
| `MIXCLOUD_API_URL` | `https://api.mixcloud.com` | Racine de l'API publique ; seule origine de curseur de pagination acceptée. |

**Plugin Radios** (`../3_plugins/3_19_radio.md`) — trou relevé par l'entrée de journal précédente,
les clés étant depuis présentes dans `.env.example` (bloc « Plugin Radios ») et
`apps/server/src/plugins/radio/index.ts` :

| Variable | Défaut | Rôle |
|---|---|---|
| `RADIO_BROWSER_URL` | `https://de1.api.radio-browser.info` | Miroir de l'annuaire. |
| `RADIO_FAVORITES_FILE` | `.state/radio-favorites.json` (`stateFile`) | Favorites de la maison (station complète, jouable même annuaire tombé). |
| `RADIO_COUNTRY` | `FR` | Pays des « plus écoutées » (code ISO à deux lettres). |

La liste des fichiers d'état passant par `stateFile` (section du 2026-09-19) s'allonge de
`MIXCLOUD_STATE_FILE` et `RADIO_FAVORITES_FILE`.

### Mise à jour 2026-09-23 — `TZ` compte désormais : les automatisations suivent l'heure du process

La maison n'a pas de fuseau (`house.timezone` n'existe pas) : les automatisations raisonnent en
**heure murale locale du process** — « 07:30 », les jours de la semaine, les périodes, et le découpage
du jour dans lequel on cherche le lever et le coucher (`sunTimes`). Un serveur lancé en UTC
déclencherait donc « 07:30 » à 08:30 ou 09:30 heure de Paris. Le service doit tourner avec le bon
fuseau, par la variable standard **`TZ`** (ex. `TZ=Europe/Paris`), posée dans l'environnement du
service — ou dans `apps/server/.env`, que les scripts `dev` et `start` passent à Node par
`--env-file-if-exists=.env` (non vérifié en conditions réelles pour `TZ` ; les tests, eux, le posent
à l'exécution avec une garde). Ce n'est pas une variable Kasbah : `config/env.ts` ne la lit ni ne la
valide. Détail : `../1_architecture/1_8_automatisations.md`.

Sources : `apps/server/src/core/automations/schedule.ts`, `packages/shared/src/house/sun.ts`.

### Mise à jour 2026-09-28 — `MUSIC_STATE_FILE` : la dernière écoute de chaque enceinte

Nouvelle clé de `musicConfigSchema` (`apps/server/src/music/player.ts`), lue comme les autres clés du
lecteur commun sur l'environnement complet.

| Variable | Défaut | Rôle |
|---|---|---|
| `MUSIC_STATE_FILE` | `.state/music.json` (`stateFile('music.json')`) | Par lecteur : file, piste courante, répétition, position atteinte — de quoi montrer le titre interrompu après un redémarrage et le relancer (`POST /api/music/resume`). Détail : `../1_architecture/1_6_lecteur-musique.md`, section du 2026-09-28. |

La liste des fichiers d'état passant par `stateFile` s'allonge de `MUSIC_STATE_FILE`.

**Absente de `apps/server/.env.example`** au moment de l'ingestion (vérifié : aucune occurrence dans
le fichier) — le défaut suffit, mais le bloc « Lecteur musique commun » ne la documente pas.

*(Constat du lint du 2026-10-06 : elle y figure désormais, commentée (`# MUSIC_STATE_FILE=.state/music.json`), dans le bloc « Lecteur musique commun ».)*

Sources : `apps/server/src/music/{player,lastPlayed}.ts`, arbre de travail non commité du 2026-09-28
(après c6fe7c1).

### Mise à jour 2026-10-04 — `TMA_*` (plugin TouteMonAnnée)

| Variable | Défaut | Rôle |
|---|---|---|
| `TMA_FILE` | `.state/toutemonannee.json` | cookies de session (0600), filtres, cases « fait » locales, dernière publication vue — jamais le mot de passe |
| `TMA_REFRESH_MS` | `1800000` | relecture (5 min au moins) |
| `TMA_PAST_DAYS` | `7` | jours passés relus pour les devoirs (0 à 31) |

Le compte se relie dans les Réglages, pas dans le `.env` : `../3_plugins/3_23_toutemonannee.md`.

### Mise à jour 2026-10-06 — variables des plugins restants et du MCP

Relevé fait en lisant les `configSchema` du code (noms et défauts), pour les variables que la page
ne listait pas encore. Les clés d'état passent par `stateFile` : le défaut est un fichier de
`apps/server/.state/` (ou de `KASBAH_STATE_DIR`). Détail et mise en route de chaque plugin :
`apps/server/.env.example` (un bloc par plugin) et `docs/plugins/<id>.md`. Les clés d'API publiques
de l'appli du fabricant (Gigya et Kamereon de Renault, `IROBOT_APP_ID`) ont des défauts dans le
code (`auth.ts` de chaque plugin) qu'on ne recopie pas ici : on ne les pose dans `.env` que si le
fabricant les fait tourner.

**Agenda** (`apps/server/src/plugins/agenda/index.ts`, `docs/plugins/agenda.md`)

| Variable | Défaut | Rôle |
|---|---|---|
| `AGENDA_FILE` | `.state/agenda-calendars.json` | Agendas enregistrés (adresses secrètes iCal). |
| `AGENDA_REFRESH_MS` | `600000` (min 60 000) | Relecture des flux, gardés en mémoire ; Google régénère le flux à chaque lecture. |

**Automower** (`plugins/automower/index.ts`, `docs/plugins/automower.md`)

| Variable | Défaut | Rôle |
|---|---|---|
| `AUTOMOWER_APP_KEY`, `AUTOMOWER_APP_SECRET` | *(vides)* | Clé et secret de l'application créée sur le portail développeur de Husqvarna. |
| `AUTOMOWER_POLL_MS` | `600000` (60 000 à 3 600 000) | Relecture complète ; le flux d'événements porte le vivant, elle ne rattrape que les manques. 10 min = 4 320 requêtes par mois, sous la moitié du quota. |
| `AUTOMOWER_TIMEZONE` | fuseau du serveur | Fuseau IANA des horodatages « locaux » du robot ; inconnu = refus à la validation. |
| `AUTOMOWER_QUOTA_RESET_AT` | *(vide)* | Instant de remise à zéro du quota tel que le portail l'affiche (ISO 8601) : cale la fenêtre de sept jours exactement. Absent, la première requête fait foi. |
| `AUTOMOWER_USAGE_FILE` | `.state/automower-usage.json` | Compte de requêtes de la fenêtre. Vide = ne rien garder. |

**iRobot** (`plugins/irobot/index.ts`, `docs/plugins/irobot.md`)

| Variable | Défaut | Rôle |
|---|---|---|
| `IROBOT_SESSION_FILE` | `.state/irobot-session.json` | Mots de passe LOCAUX des robots ; celui du compte n'y est jamais écrit. |
| `IROBOT_COUNTRY` | `FR` | Code pays envoyé à la découverte d'endpoints (il choisit le centre Gigya). |
| `IROBOT_DISCOVERY_URL`, `IROBOT_APP_ID`, `IROBOT_USER_AGENT` | défauts du code | En configuration car le fabricant peut les changer sans prévenir. |
| `IROBOT_SCAN_MS` | `120000` (15 000 à 3 600 000) | Balayage réseau, qui ne sert qu'à retrouver un robot qui rentre ou change d'adresse (l'état arrive par MQTT). |
| `IROBOT_SCAN_TIMEOUT_MS` | `4000` (500 à 30 000) | Durée d'écoute d'un balayage. |

**MELCloud** (`plugins/melcloud/index.ts`, `docs/plugins/melcloud.md`)

| Variable | Défaut | Rôle |
|---|---|---|
| `MELCLOUD_BASE_URL` | URL du client Mitsubishi (`melcloud/auth.ts`) | Racine de l'API ; en configuration car le fabricant peut la déplacer. |
| `MELCLOUD_APP_VERSION` | `1.34.12.0` | Version d'application annoncée à la connexion (exigée par MELCloud). |
| `MELCLOUD_POLL_MS` | `120000` (60 000 à 3 600 000) | Un seul appel par tour (`ListDevices` rend tout le compte). |
| `MELCLOUD_SESSION_FILE` | `.state/melcloud-session.json` | Clé de session ; jamais le mot de passe. |
| `MELCLOUD_HISTORY_FILE` | `.state/melcloud-history.json` | Historique de fonctionnement déjà calculé (une semaine d'heures). Vide = ne rien garder. |

**PetKit** (`plugins/petkit/index.ts`, `docs/plugins/petkit.md`)

| Variable | Défaut | Rôle |
|---|---|---|
| `PETKIT_PASSPORT_URL` | `https://passport.petkt.com/` | Où demander la liste des passerelles régionales. |
| `PETKIT_GATEWAY` | *(vide)* | Passerelle forcée ; vide = déduite de la région. |
| `PETKIT_REGION` | `FR` | Région du compte : elle choisit la passerelle, et seule celle-ci accepte la session. |
| `PETKIT_TIMEZONE` | `Europe/Paris` | Fuseau. |
| `PETKIT_APP_VERSION` | `13.2.1` | Version d'application annoncée. |
| `PETKIT_SESSION_FILE` | `.state/petkit-session.json` | Jeton de session ; ni mot de passe ni code. |
| `PETKIT_POLL_MS` | `300000` (60 000 à 3 600 000) | Cadence de lecture (grandeurs lentes). |

**Renault** (`plugins/renault/index.ts`, `docs/plugins/renault.md`)

| Variable | Défaut | Rôle |
|---|---|---|
| `RENAULT_COUNTRY` | `FR` | Pays du compte, exigé sur toutes les routes Kamereon. |
| `RENAULT_GIGYA_URL`, `RENAULT_GIGYA_API_KEY`, `RENAULT_KAMEREON_URL`, `RENAULT_KAMEREON_API_KEY` | défauts `fr_FR` du code (`renault/auth.ts`) | Points d'entrée et clés d'authentification (Gigya) et de données (Kamereon) ; en configuration parce que Renault les fait tourner. |
| `RENAULT_ACCOUNT_ID` | *(vide)* | Compte Kamereon à lire. Vide = le compte `MYRENAULT` s'il existe, sinon le premier (`index.ts`, choix du compte). |
| `RENAULT_SESSION_FILE` | `.state/renault-session.json` | Jeton de session Gigya ; jamais le mot de passe. |
| `RENAULT_POLL_MS` | `600000` (120 000 à 3 600 000) | Cadence de lecture. |
| `RENAULT_RATE_PER_HOUR` | `60` (1 à 600) | Plafond d'appels par heure que le plugin s'impose avant que Renault ne réponde 429. |
| `RENAULT_WAKE_FROM`, `RENAULT_WAKE_TO` | `08:00`, `20:00` | Fenêtre horaire (heure locale du serveur) du réveil de charge ; bornes égales = jamais. |
| `RENAULT_WAKE_EVERY_MS` | `900000` (300 000 à 21 600 000) | Délai minimal entre deux réveils du même véhicule. |

**TaHoma, fichiers d'état** (`plugins/tahoma/index.ts`) : `TAHOMA_LIGHT_HISTORY_FILE`
(`.state/tahoma-light-history.json`, historique de luminosité des volets solaires) et
`TAHOMA_QUIET_FILE` (`.state/tahoma-quiet.json`, volets en mode discret, un réglage de Kasbah que la
box ne retient pas) ; vide = pas de persistance.

**Serveur MCP** (`apps/server/src/mcp/auth.ts`, `mcpAuthConfigSchema` ; `../1_architecture/1_7_serveur-mcp.md`)

| Variable | Défaut | Rôle |
|---|---|---|
| `MCP_PUBLIC_URL` | *(absente)* | Adresse publique (URL complète, derrière un proxy HTTPS) : son nom d'hôte est accepté par le contrôle d'hôte et sert d'émetteur OAuth en https. |
| `MCP_USERS_FILE` | `apps/server/mcp-users.json` | Comptes des assistants IA (mots de passe hachés en scrypt), à côté du `.env`, hors dépôt. Gérés par Réglages ou `npm run mcp-user`. |
| `MCP_AUTH_FILE` | `.state/mcp-auth.json` | Clients enregistrés et jetons (hachés). |


### Mise à jour 2026-10-06 (soir) — comptes, sessions et blocage ; `MCP_PUBLIC_URL` change de rôle

`MCP_PUBLIC_URL` ne sert plus qu'au MCP : sous ce nom, **toute l'application** exige une connexion
(`apps/server/src/http/session.ts`) ; son origine est aussi celle que doit porter l'en-tête `Origin` de
toute écriture et de tout WebSocket. Le tableau « Serveur MCP » de la section du 2026-10-06 ci-dessus
décrit donc un rôle plus étroit que le réel. Nouvelles variables (`mcpAuthConfigSchema` et
`sessionConfigSchema`, `.env.example` à jour) :

| Variable | Défaut | Rôle |
|---|---|---|
| `KASBAH_SESSIONS_FILE` | `.state/sessions.json` | Sessions de l'application sous l'adresse publique (hachées, 0600, 90 jours glissants). Le supprimer déconnecte tout le monde. |
| `KASBAH_LOGIN_MAX_FAILURES` | `5` | Échecs de connexion d'affilée qui bloquent un COMPTE (application et MCP partagent le compteur) ; `0` = jamais. Les échecs comptent par nom saisi, existant ou non. |
| `KASBAH_LOGIN_LOCK_MINUTES` | `15` | Durée du blocage, et fenêtre dans laquelle deux échecs se suivent pour compter « d'affilée ». |

Le plafond global (10 échecs en 15 minutes, toutes connexions confondues) est constant, non réglable.
Le blocage est en mémoire : un redémarrage de Kasbah le lève ; les sessions déjà ouvertes ne sont pas
touchées. `MUSIC_PUBLISH_BASE` devient **obligatoire** pour lancer une lecture sur une enceinte depuis
l'adresse publique (voir la section du 2026-09-23 plus haut, et `5_2_production.md`).

Sources : `apps/server/src/mcp/auth.ts`, `apps/server/src/http/session.ts`, `apps/server/.env.example`.

### Mise à jour 2026-10-07 — `.state/users/<nom>/` : les comptes musicaux de chaque utilisateur

**Aucune variable nouvelle.** `YTM_COOKIE_FILE` et `MIXCLOUD_STATE_FILE` deviennent « le compte de la
maison » ; ceux des utilisateurs vivent sous le dossier d'état (`KASBAH_STATE_DIR`, section du 2026-09-19),
dans `users/<nom>/` : `ytmusic-cookie.txt` (+ `.netscape`) et `mixcloud.json`. Chemins décidés à un seul
endroit : `userStateDir(user)` / `userStateFile(user, name)` (`apps/server/src/core/paths.ts`).

**Encodage du nom** (`userNameSchema` admet `.`, `..`, `@`, des majuscules) : `encodeURIComponent` ; un point
en tête devient `%2E` (sinon `.` et `..` sortiraient du dossier) ; les majuscules sont marquées d'un `+`
(`Alice` → `+alice`), car un disque Windows ne distingue pas `Alice` de `alice`, qui sont deux comptes.
Tests : `apps/server/src/mcp/users-routes.test.ts`.

**À la suppression d'un compte** (route de Réglages ou script `mcp-user`), `deleteUser` efface son dossier :
ses cookies et ses positions de reprise partent avec lui. Le dossier contient un cookie de compte
YouTube : à traiter comme `YTM_COOKIE_FILE` (jamais dans le dépôt ni dans `.env`) ; il est sous
`.state/`, déjà hors du dépôt. Voir `../1_architecture/1_6_lecteur-musique.md` et `../1_architecture/1_7_serveur-mcp.md`.

Sources : `apps/server/src/core/paths.ts`, `apps/server/src/mcp/auth.ts`.

### Mise à jour 2026-10-07 — `CLAUDE_*` (plugin Claude, moteur de l'assistant)

| Clé | Défaut | Rôle |
|---|---|---|
| `CLAUDE_BIN` | `claude` | Binaire de Claude Code. Le processus serveur doit le trouver dans son `PATH` ; sinon, chemin absolu. Introuvable : la santé du plugin le dit dans Réglages. |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | Modèle de `claude -p --model` : ID complet (version figée) ou alias de la CLI (`haiku`, `sonnet`), qui retarde sur les sorties. |
| `CLAUDE_KEEP_SESSIONS` | `false` | `1` / `true` : garder les sessions de `claude -p` (transcriptions JSONL) pour déboguer. |

Pas de clé d'API : le forfait de chaque compte passe par le jeton de `claude setup-token`, collé dans
Réglages (fichiers d'état ci-dessous). Les variables `CLAUDE*` et `ANTHROPIC*` de l'environnement du
serveur ne sont **pas** transmises à `claude` (voir `../3_plugins/3_24_claude.md`).

Fichiers d'état (`stateFile`, donc sous `KASBAH_STATE_DIR`) : `claude.json` (jeton de la maison),
`users/<compte>/claude.json` (jeton d'un compte), `claude/` (dossier courant vide, config isolée,
fichiers MCP temporaires), `assistant-log.json` (journal des instructions, 200 entrées).

### Mise à jour 2026-10-07 (soir) — `STT_*` (plugin Transcription, la voix)

| Clé | Défaut | Rôle |
|---|---|---|
| `STT_PROVIDER` | `voicestudio` | `voicestudio`, `vllm` ou `mistral` : fixe l'adresse, le modèle et le champ du vocabulaire par défaut. |
| `STT_URL` | selon le fournisseur (aucune pour `voicestudio`, `http://localhost:8000` pour `vllm`, `https://api.mistral.ai`) | Racine du serveur, sans `/v1` (retiré s'il y est). |
| `STT_MODEL` | `whisper-1` / `mistralai/Voxtral-Mini-4B-Realtime-2602` / `voxtral-mini-latest` | Modèle demandé. |
| `STT_API_KEY` | *(vide)* | `Authorization: Bearer` ; obligatoire pour `mistral`. |
| `STT_LANGUAGE` | `fr` | Langue parlée (ISO 639-1). |

Mise en route de chaque fournisseur et drapeau Chrome du micro : `../3_plugins/3_25_transcription.md`.

### Mise à jour 2026-10-07 (nuit) — `TTS_*` (réponses parlées)

| Clé | Défaut | Rôle |
|---|---|---|
| `TTS_MODEL` | `tts-1` | Modèle de synthèse des réponses parlées, au même serveur que `STT_URL` ; `tts-1` = le moteur actif de VoiceStudio (OmniVoice). |
| `TTS_VOICE` | `default` | Voix : profil VoiceStudio, `default`, ou nom de voix du fournisseur. |
| `VOICESTUDIO_DIR` | note de l'app | Runtime de VoiceStudio (dossier `project`) pour le lancer sans son interface (sous-item `voicestudio`) ; défaut : `%APPDATA%\VoiceStudio\runtime-location.json`. |

L'interrupteur n'est pas une clé : sous-item `speech` du plugin `transcription`, dans Réglages.

### Mise à jour 2026-10-08 — `KASBAH_HOUSE_FILE` absent = démonstration

Le tableau annonce `house/demo-house.json` comme défaut : c'est le défaut de `loadEnv()`
(`apps/server/src/config/env.ts`, ce que voient les tests). Pour le **serveur lancé** (`main.ts`), une
variable **absente** n'est plus « la maison de démo » : c'est le **mode démonstration**, qui propose
les trois propriétés de `house/demos/` et bascule de l'une à l'autre (`../1_architecture/1_2_serveur-et-plugins.md`).
Une valeur donnée fait vivre ce seul fichier, comme avant ; une valeur **vide** compte comme absente
(c'est ainsi que la config de preview `kasbah-demo-server` passe outre un `.env`).

`MOCK_SCENARIO` accepte en plus `tilleuls`, `embruns`, `belvedere` et leurs variantes `-winter`. En
mode démonstration le parc vient de la propriété affichée ; `winter` y donne la version d'hiver de ce
parc. Tout est commenté dans `apps/server/.env.example`.

Sources : `apps/server/src/config/env.ts`, `apps/server/src/main.ts`, `apps/server/.env.example`.


### Mise à jour 2026-10-10 — `house/properties/` : où vivent les maisons créées sur ce poste

Aucune variable nouvelle. En **mode démonstration** (`KASBAH_HOUSE_FILE` absent ou vide), le serveur
propose en plus des démos les propriétés trouvées dans **`house/properties/`**, dossier **ignoré par
git** (`.gitignore`) : celles qu'on crée par l'assistant « Créer une propriété » ou qu'on obtient en
dupliquant une démo (`../1_architecture/1_2_serveur-et-plugins.md`, même date). Les démos de
`house/demos/` sont en **lecture seule** ; pour en changer, on les duplique. Le dossier est distinct de
`house/` à dessein : le serveur de démonstration ne doit pas ramasser `house/maison.json`.

Une installation fraîche peut donc créer sa maison sans éditer de fichier. Une installation qui fixe
`KASBAH_HOUSE_FILE` fait toujours vivre ce seul fichier : ni sélecteur, ni création.

Sources : `.gitignore`, `apps/server/src/config/properties.ts`, `apps/server/src/main.ts`.


### Mise à jour 2026-10-10 (2) — `KASBAH_HOUSE_FILE` devient un forçage facultatif

**Remplace** la lecture « absent ou vide = serveur de démonstration » des mises à jour du 2026-10-08 et
du 2026-10-10 ci-dessus : ce n'est plus un mode du serveur mais le cas normal.

- **Absent ou vide** (cas normal) : le serveur lit ses propriétés dans des **dossiers** :
  `house/demos/` (trois démos, lecture seule) et `house/properties/` (propriétés réelles du poste,
  ignoré par git). Une seule vit à la fois. Réglages → Propriété passe du mode démo au mode réel et
  choisit la propriété. Une installation neuve démarre en démo ; un poste qui a déjà des propriétés
  démarre en réel.
- **Renseigné** : le serveur fait vivre ce seul fichier, **sans mode ni sélecteur** (409
  `NOT_SWITCHABLE` sur `POST /api/properties/mode`). C'est le forçage : tests, previews, installation à
  maison fixe. Le commentaire de `.env.example` est réécrit en ce sens ; son exemple pointe désormais
  `../../house/properties/ma-maison.json`.
- **Nouveau fichier d'état** : `.state/property-mode.json` (`{ mode, demo, real }` : mode montré et
  propriété retenue dans chacun). Il remplace `demo-property.json`, repris une fois à la première
  lecture, et suit `KASBAH_STATE_DIR` comme les autres.
- Limite connue : l'état de `.state/` reste **global**, pas par propriété
  (`../1_architecture/1_2_serveur-et-plugins.md`, même date).

Sources : `apps/server/.env.example`, `apps/server/src/main.ts`, `apps/server/src/config/{catalog,properties}.ts`.

### Mise à jour 2026-10-23 — `KASBAH_LAN_HOSTS`

| Variable | Défaut | Rôle |
|---|---|---|
| `KASBAH_LAN_HOSTS` | *(vide)* | Noms du réseau local admis **en plus** de ceux acceptés d'office (adresse IP, `localhost`, nom court sans point, suffixes `.internal` `.local` `.lan` `.home.arpa`), séparés par des virgules. Tout autre nom reçoit 403 `UNKNOWN_HOST`. Utile seulement pour un nom local qui ressemble à un nom public (DNS de la maison qui sert un vrai domaine). |

Lue par `mcpAuthConfigSchema` (`apps/server/src/mcp/auth.ts`), comme `MCP_PUBLIC_URL`. Le pourquoi
(DNS rebinding, contrôle de l'`Origin` sur le réseau local) : `../1_architecture/1_13_comptes-et-sessions.md`,
section du 2026-10-23 (soir).
