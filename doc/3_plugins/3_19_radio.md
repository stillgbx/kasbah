# Plugin Radios (annuaire radio-browser.info)

> Dernière mise à jour : 2026-10-07
> Sources : `apps/server/src/plugins/radio/{index,directory,favorites}.ts`, tests `apps/server/src/plugins/radio/plugin.test.ts`, `apps/server/src/core/playbackBridge.ts`, `apps/server/src/plugins/index.ts`, `packages/shared/src/devices/command.ts`, `apps/server/src/plugins/{sonos,google_cast}/{mapping,index}.ts`, `apps/web/src/components/music/RadioBrowser.vue`, `apps/web/src/views/MusicView.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, session du 2026-09-23, `apps/server/src/music/player.ts`, `apps/web/src/lib/streamQuality.ts`, arbre de travail non commité du 2026-09-24 (après 553ff9c)

## Ce que c'est, et ce que ce n'est pas

Deuxième **source musicale** après YouTube Music (`3_16_ytmusic.md`) : un plugin **sans appareil**
(`discover` → `[]`, `execute` refuse tout en `UNSUPPORTED_COMMAND`) qui ne sait qu'une chose, lancer
`media_player.play_url` sur un lecteur Cast ou Sonos d'un autre plugin, par le pont de lecture
commun (`core/playbackBridge.ts`, voir `../1_architecture/1_2_serveur-et-plugins.md`).

La grande différence avec ytmusic est ce qu'il **ne fait pas** : ni relais, ni ffmpeg, ni file
d'attente, ni session. Le flux va **de la radio à l'enceinte** sans passer par le serveur — il n'y a
rien à découper par plages d'octets ni à mettre en file dans un direct. C'est pour cela que le noyau
commun « file / relais / sessions / transfert », aujourd'hui dans ytmusic, n'a **pas** été extrait
pour la radio : elle n'en a pas l'usage (voir « Suite : Mixcloud » plus bas).

## L'annuaire : radio-browser.info

Choisi parce qu'il est **libre, sans clé et sans compte**, et qu'il liste toutes les webradios, Radio
France comprise (~50 000 stations d'après le commentaire de `directory.ts`). Deux règles de courtoisie
que le service demande, toutes deux appliquées :

- un **User-Agent qui nomme l'appli** (`Kasbah/0.1 (domotique perso)`) sur chaque appel ;
- **signaler chaque écoute** par `GET /json/url/:uuid` — c'est ce compteur qui classe les stations par
  popularité pour tout le monde. L'appel est lancé sans être attendu et n'échoue jamais pour
  l'appelant (`click`). Une station ajoutée à la main (`custom-…`) n'est pas signalée : l'annuaire ne
  la connaît pas.

Les listes sont demandées triées par écoutes (`order=clickcount&reverse=true`), avec `hidebroken=true`
**et** un filtre local qui écarte `lastcheckok === 0` (double garde). Une fiche sans nom ou dont le
flux n'est pas `http(s)` est ignorée ; `url_resolved` (playlists `.pls` / `.m3u` déjà suivies par l'annuaire) passe avant `url` ; un codec `UNKNOWN` et un
favicon qui n'est pas une URL http sont retirés plutôt que transmis (`toStation`).

### La recherche ne dépend pas de l'ordre des mots

**Constat** : l'annuaire ne cherche qu'une **suite exacte** dans le nom — « campus ville » ne trouve
pas « Ville Campus ».

**Solution** (`searchWords`, `foldName`) : on n'envoie à l'annuaire **que le mot le plus long** de la
requête (le plus sélectif), en demandant large (`limit=400`), puis on garde localement les stations
dont le **nom replié** contient **tous** les mots. Replier = minuscules, sans accents, ponctuation et
décor réduits à des espaces (« ★ Radio Ville Campus » → « radio ville campus »). On rend au plus
60 résultats. Test : « finds a station whatever the word order, the accents or the decoration of its
name ».

## Les favorites sont celles de la MAISON

Gardées par le serveur dans un fichier (`RADIO_FAVORITES_FILE`, écriture atomique par fichier
temporaire puis `rename`), pas dans le navigateur : tous les écrans voient la même liste. On garde
la **station entière** (nom, flux, logo, pays, codec…) et pas seulement son identifiant, pour que la
liste s'affiche **et se lance même quand l'annuaire ne répond pas** — `POST /play` cherche d'abord dans
les favorites, ne demande à l'annuaire (`byuuid`) qu'ensuite. Test : « keeps favorites for the house,
and plays one even when the directory is down ».

### Ajout manuel par l'URL du flux

`POST /favorites/custom { name, url }` (http ou https seulement) ajoute une radio que l'annuaire ne
connaît pas, ou qu'il connaît sous une adresse morte. L'identifiant est **dérivé de l'URL** :
`custom-` + les 12 premiers caractères hexadécimaux de son SHA-1. Même URL = même station : l'ajouter
une seconde fois la **renomme** au lieu de créer un doublon.

## Routes (`/api/plugins/radio/`)

| Route | Effet |
|---|---|
| `GET /status` | `{ favorites, country, lastError }` |
| `GET /search?q=` | stations dont le nom contient tous les mots ; 400 `INVALID_QUERY` sous 2 caractères |
| `GET /top?country=` | les plus écoutées d'un pays (code ISO à deux lettres, défaut `RADIO_COUNTRY`) |
| `GET /favorites` | les favorites de la maison |
| `PUT /favorites/:id` | ajoute une station complète ; 400 si l'`id` du corps n'est pas celui du chemin ; déjà présente = rien ne change |
| `POST /favorites/custom` | ajout manuel par URL de flux (ci-dessus) |
| `DELETE /favorites/:id` | retire |
| `POST /play { deviceId, stationId }` | lance la station sur un lecteur ; 404 lecteur ou station inconnus, 400 si le lecteur n'a pas `play_url` |
| `GET /playing` | `{ playing: [{ deviceId, station }] }` : la dernière station lancée sur chaque lecteur (depuis le 2026-09-24, voir « Qualité d'une radio ») |

Toutes les routes de favorites rendent la liste complète (`{ stations }`), que l'UI adopte telle
quelle.

La commande envoyée : `media_player.play_url { url, title: nom, artist: pays, artUrl: favicon,
live: true }` — le pays tient la ligne d'artiste, faute de mieux (voir Limites).

## `live: true` : pourquoi le service doit le dire

Jusque-là, Sonos et Cast devinaient le direct **d'après l'URL** (`.m3u8` / `.m3u`). Une radio Icecast
en `.aac` ou `.mp3` **ressemble à un fichier** : rien dans l'adresse ne permettait de la publier comme un direct. Seul le service qui lance
la lecture sait que c'est un direct — même situation que le marquage `explicit`, même réponse : un
champ facultatif `live?: boolean` sur `media_player.play_url`
(`../1_architecture/1_1_contrat-appareils.md`), reposé à chaque relevé par les plugins d'enceinte
(`3_15_sonos.md`, `3_6_google-cast.md`). La barre `MusicPlayerBar` savait déjà rendre
`nowPlaying.live` (ni curseur ni saut) : aucun changement côté barre.

## Qualité d'une radio (2026-09-24)

La barre de la page Musique et le panneau appareil affichent la qualité du flux (« MP3 192 kb/s »).
Pour YouTube Music et Mixcloud, elle vient de la **session** du proxy Kasbah
(`../1_architecture/1_6_lecteur-musique.md`). Une radio n'en a pas : le flux va **de la station à
l'enceinte**, sans relais, et l'enceinte ne publie ni codec ni débit. La seule source est donc
l'annuaire — `codec` et `bitrateKbps` de la fiche radio-browser (`directory.ts` écarte `UNKNOWN` et
un débit nul).

D'où `GET /playing` : le plugin retient, à chaque `POST /play` réussi, la station lancée sur chaque
lecteur (`Map` en mémoire, test « remembers the station each player was given, for its quality »).
Deux choix assumés :
- **jamais effacée** : le lecteur a pu passer à autre chose depuis, et le plugin ne le suit pas.
  C'est l'UI qui trie : `streamQuality()` (`apps/web/src/lib/streamQuality.ts`) ne retient la
  station que si le lecteur publie **un direct dont le titre est le nom de la station** ;
- **perdue au redémarrage du serveur** : une radio lancée avant n'a plus de qualité affichée jusqu'au
  prochain lancement.

Une station **ajoutée à la main** (`custom-…`) n'a ni codec ni débit : pas de ligne de qualité.

L'info-bulle le dit : « Débit annoncé par l'annuaire des radios » (`radio.qualityHint`) — c'est une
déclaration de la station, pas une mesure. La page Musique et le panneau ne demandent `/playing` que
si le lecteur joue un direct. Méthode de transport `radioPlaying()` ; en mock, liste vide.

## Santé

`ok` avec « N favorite stations » ; `degraded` si le **dernier** appel à l'annuaire a échoué (le
message est ajouté au détail), et retour à `ok` dès l'appel réussi suivant — l'échec n'est pas
collant. Pas de `needs_pairing` : il n'y a rien à relier. Test : « reports a failing directory as
degraded, and recovers on the next good answer ».

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `RADIO_BROWSER_URL` | `https://de1.api.radio-browser.info` | miroir de l'annuaire |
| `RADIO_FAVORITES_FILE` | `.state/radio-favorites.json` (`stateFile`) | favorites de la maison |
| `RADIO_COUNTRY` | `FR` | pays des « plus écoutées » quand l'UI n'en demande pas |

## Côté web

La page Musique devient multi-source (détail d'interface : `../4_ui/4_1_navigation-et-panneaux.md`,
« (17) ») : un sélecteur « YouTube Music » / « Radios » en en-tête, la source Radios affichée par
`RadioBrowser.vue` (recherche, onglets Favorites / Les plus écoutées, ajout manuel), le panneau
« Écoute » et la barre du bas communs aux deux. Sept méthodes de transport `radio*` (huit avec `radioPlaying`, 2026-09-24) ; en mode mock
elles répondent 501 (il n'y a pas d'annuaire simulé).

## Vérifié en direct (2026-09-23)

Sur le Sonos « Bureau », France Info AAC 192 kb/s
(`http://icecast.radiofrance.fr/franceinfo-hifi.aac`) : l'enceinte joue, et l'état publie
`nowPlaying.live: true` sur **plusieurs sondages successifs** — c'est-à-dire que le report par
`overlayStreamMeta` tient (sans lui, le champ s'éteindrait au premier sondage, comme l'avait fait
`explicit`). Seul essai en direct rapporté : ce Sonos ; côté Cast, `live` n'est couvert que par
`google_cast/mapping.test.ts`.

## Limites

- **Pas jouable dans « Ce navigateur »** (lecteur local de `3_16_ytmusic.md`, « (12) ») : la page
  affiche « La radio ne se lit pas encore dans ce navigateur : choisissez une enceinte ».
- **Pas de titre en cours d'émission** : l'annuaire ne le donne pas. Pour Radio France, son API
  (clé gratuite) pourrait le fournir — piste non ouverte.

## Piège : une station listée avec une adresse morte

**Cas** : une radio locale figure dans l'annuaire, mais son flux pointe vers
`<hôte de la radio>:8082`, en panne depuis plusieurs mois. Le lecteur du site de la radio
renvoyait lui-même une erreur WordPress, donc ne donnait pas l'adresse. Le vrai flux
(`https://<site de la radio>/proxy_streaming.php`) a été trouvé via OnlineRadioBox.

**Réponse** : c'est la raison d'être de l'ajout manuel par URL. Pour que tout le monde en profite, la
correction se fait sur radio-browser.info en **ajoutant une nouvelle fiche**.

## Suite : Mixcloud (sonde du 2026-09-23)

> **Annotation 2026-09-23 (plus tard dans la journée)** : c'est fait. Le plugin existe
> (`3_20_mixcloud.md`) et le noyau commun est extrait dans `apps/server/src/music/`, sous `/api/music`
> (`../1_architecture/1_6_lecteur-musique.md`). La radio n'y passe toujours pas : son flux va de la
> station à l'enceinte. Le texte ci-dessous est l'état du matin.

Prochaine source envisagée ; rien n'est codé. Ce que la sonde a établi :

- **API publique `api.mixcloud.com` sans clé** : recherche, favoris et suivis d'un utilisateur ;
- **yt-dlp 2026.08.19** en extrait un **m4a direct, AAC 64 kb/s** (la qualité gratuite), avec
  `content-length` connu, plages d'octets acceptées (206) et **aucune expiration visible dans l'URL** —
  exactement le profil du **relais brut** de ytmusic (`3_16_ytmusic.md`, « (4) — le RELAIS devient le
  chemin normal »).

**Décision** : le noyau commun (file d'attente, relais, sessions, transfert), aujourd'hui dans le
plugin ytmusic, sera **extrait au moment de Mixcloud, pas avant** — Mixcloud en aura besoin, la radio
non.

### Mise à jour 2026-10-06 — la source est aussi joignable par le serveur MCP

Un assistant IA branché sur `/mcp` (`apps/server/src/mcp/server.ts`, page `../1_architecture/1_7_serveur-mcp.md`) cherche une station avec `search_music`
(`source: 'radio'`, qui appelle `GET /api/plugins/radio/search` et rend `stationId`, nom, pays,
genres, codec, débit) puis la joue avec `play_radio` (`POST /api/plugins/radio/play`) : le flux va
toujours de la radio à l'enceinte, sans le lecteur commun ni le serveur.

### Mise à jour 2026-10-07 — les favorites restent celles de la maison

Quand YouTube Music et Mixcloud sont passés à un compte par utilisateur (`3_16_ytmusic.md`), les radios
favorites n'ont **pas** suivi : décision de l'utilisateur, inchangé. Un connecté voit les favorites de la
maison.
