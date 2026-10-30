# Plugin YouTube Music (non officiel)

> Dernière mise à jour : 2026-10-30
> Sources : `apps/server/src/plugins/ytmusic/{index,catalog,cookie,browserCookies,resolve,mapping,types}.ts` (`stream.ts` et `queue.ts` devenus `apps/server/src/music/{proxy,queue}.ts` le 2026-09-23), `apps/server/src/music/{player,sources,ytdlp}.ts`, `apps/server/src/core/playbackBridge.ts` (ex-`ytmusic/bridge.ts`), tests `apps/server/src/plugins/ytmusic/{plugin,resolve}.test.ts` et `apps/server/src/music/{proxy,queue}.test.ts` (ex-`ytmusic/{stream,queue}.test.ts`), `apps/server/src/app.ts`, `apps/web/src/stores/localPlayer.ts`, `apps/web/src/views/MusicView.vue` (ex-`YtmusicView.vue`), `apps/web/src/components/music/{MusicPlayerBar,ListeningSessions,MusicItemRow,MusicTile,ChipRow}.vue`, `apps/web/src/composables/useMediaPosition.ts`, `apps/web/src/components/ui/{ArtThumb,artThumbLoader}.vue|ts`, `apps/web/src/components/music/ArtPlay.vue` (ex-`ui/PlayButton.vue`), `apps/web/src/components/YtmusicLinkCard.vue`, `apps/server/.env.example`, Music Assistant `providers/ytmusic` (référence)

## Avertissement

**Non officiel.** Reverse d'InnerTube (client Music / `WEB_REMIX`) + yt-dlp + générateur PO Token.
Usage perso maison uniquement. Google peut casser le chemin sans préavis ; la santé passe en
`degraded` / `error` plutôt que de mentir.

## Découpage (source ≠ lecteur)

Même idée que Music Assistant :

1. **Catalogue** — `youtubei.js` → `yt.music` (recherche, likes `LM`, playlists).
2. **Flux** — `yt-dlp` client `web_music` + cookies Netscape + extractor PO Token (`bgutil`
   HTTP) + **`--js-runtimes node`** (challenge n/sig — sans ça, seuls des storyboards et
   « Requested format is not available »). `android_music` n'existe plus dans yt-dlp ≥2026.08
   (« Skipping unsupported client »). Pas de `-f` : dump `-J` puis choix audio en JS.
3. **Proxy LAN** *(depuis le 2026-09-23 hors du plugin : `apps/server/src/music/proxy.ts`, routes `/api/music/raw` et `/api/music/stream`, section (14))* — ffmpeg (MP3) sous `/api/plugins/ytmusic/stream/:sid`, servi à l'enceinte comme un
   **« fichier » de taille connue découpable par plages d'octets** (depuis le 2026-09-22, cf. la section
   du bas) : rien n'est téléchargé d'avance, mais l'enceinte connaît la durée et se pilote seule.
   *(Dépassé le 2026-09-22 (4) : le chemin normal est désormais le relais m4a brut, sans réencodage ; le MP3 par ffmpeg n'est plus que le repli — voir « Mise à jour 2026-09-22 (4) — le RELAIS devient le chemin normal, ffmpeg le repli ».)*
4. **Lecture** — commande `media_player.play_url` vers Cast ou Sonos (URL = IP LAN du serveur Kasbah),
   avec titre / artiste / pochette optionnels. Sonos n'écho souvent pas le DIDL d'un flux HTTP : le
   plugin **retient** ces métas (`stickyPlay`) tant que l'URI joue, pour que la carte Médias affiche
   le vrai morceau au lieu du sid du proxy. Les pochettes catalogue sont montées en **544 px**
   (`upgradeArtUrl`) pour les écrans.
5. **Cookie** — collé à la main **ou** importé via `yt-dlp --cookies-from-browser` sur la
   **machine serveur** (navigateur déjà connecté à music.youtube.com sur cet hôte — pas un
   écran). Sonde périodique / erreurs 401 → `cookieExpired` + santé `needs_pairing`.

Aucun appareil publié par ce plugin (`discover` → `[]`).

## Mise en route

1. Activer le plugin **ytmusic** dans Réglages → Plugins.
2. Installer **yt-dlp** (PATH ou `YTM_YTDLP_PATH`) et **ffmpeg** (`FFMPEG_PATH`).
   *(Précision 2026-10-06 : `FFMPEG_PATH` est une variable du lecteur commun (`apps/server/src/music/player.ts`), plus du plugin ; ffmpeg ne sert que de repli, le relais m4a brut étant le chemin par défaut — section (4).)*
   **Node** doit être sur le PATH (yt-dlp résout les challenges n/sig via `--js-runtimes node`).
   Le plugin yt-dlp `bgutil-ytdlp-pot-provider` (PyPI) doit aussi être installé côté yt-dlp
   (`pip install -U bgutil-ytdlp-pot-provider` si yt-dlp vient de pip).
3. Lancer le **générateur PO Token** (HTTP, port 4416). Avec `npm run dev` à la racine, le script
   `scripts/dev-pot.mjs` le démarre s'il est présent sous `_external/bgutil-ytdlp-pot-provider/server`
   (skip s'il répond déjà à `/ping`). *(Depuis le 2026-10-20, c'est le plugin lui-même qui le lance,
   avec `npm run start` comme avec `npm run dev` : voir « Mise à jour 2026-10-20 » plus bas.)* **Docker n'est pas obligatoire** — c'est juste une option.
   Santé `degraded` tant que `GET …/ping` échoue (`YTM_PO_TOKEN_URL`, défaut
   `http://127.0.0.1:4416`).

   **Option A — Docker** (recommandée si Docker est déjà là) :

   ```bash
   docker run --name bgutil-provider -d --init \
     -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider
   ```

   **Option B — Node natif** (pas de Docker ; Node ≥ 22) :

   ```bash
   git clone --single-branch --branch 2.0.0 \
     https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
   cd bgutil-ytdlp-pot-provider/server
   npm ci && npx tsc
   node build/main.js
   ```

   Vérifier : `curl http://127.0.0.1:4416/ping`.
4. Connectez-vous à **music.youtube.com** dans un navigateur **sur la machine Kasbah**,
   **sans vous déconnecter** ensuite.

   - **Collage** (recommandé sur Windows) : fenêtre privée OK — F12 → Réseau → Cookie.
   - **Import navigateur** (`POST /cookie/from-browser`) : profil **normal** (pas privé),
     Kasbah ouvert ailleurs ; quitter le navigateur avant d'Importer. Chrome/Edge Windows :
     DPAPI / App-Bound Encryption (yt-dlp#10927) → Firefox ou collage. Dump yt-dlp via une
     URL `youtube.com/watch` (la home Music n'est pas extractible).

   Fichier `YTM_COOKIE_FILE` (jamais `.env`). La carte Réglages rappelle ces étapes au renew.
   *(Précisé le 2026-10-07 : les étapes du collage sont réécrites dans la carte — Réseau + F5, filtre `browse`, ligne `cookie` des en-têtes de requête, « Copy value » — et `YTM_COOKIE_FILE` n'est plus que le compte de la maison ; chaque utilisateur a le sien. Voir la mise à jour du 2026-10-07 en bas de page.)*
5. Si l'UI parle en `localhost`, poser `YTM_PUBLISH_BASE=http://<IP-LAN>:8787` pour que
   Cast/Sonos atteignent le proxy (ils refusent `127.0.0.1`).
   *(Dépassé le 2026-09-23 : la variable s'appelle `MUSIC_PUBLISH_BASE`, lue par le lecteur commun (`apps/server/src/music/player.ts`) ; `YTM_PUBLISH_BASE`, l'ancien nom, est encore lu en repli — voir la section (14).)*
6. Premium attendu pour un vrai catalogue (compte famille OK). Cookie mort → réimporter.

## Routes

> **2026-09-23 :** les routes de lecture de ce tableau (`/play`, `/stream/:sid`, `/sessions`,
> `/transfer`, `/queue*`), ainsi que `/local` et `/raw/:file` décrites plus bas, ne sont plus sous
> `/api/plugins/ytmusic/` : elles vivent dans le lecteur commun, sous **`/api/music/*`**, et une piste
> s'y désigne par `{ source: 'ytmusic', id: <videoId> }` au lieu de `videoId`. Voir la section (14) et
> `../1_architecture/1_6_lecteur-musique.md`. Restent ici : statut, cookie, catalogue.

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/api/plugins/ytmusic/status` | lié ?, expiré ?, PO ok ?, `browsers[]` |
| `PUT` | `/api/plugins/ytmusic/cookie` | corps `{ cookie }` |
| `POST` | `/api/plugins/ytmusic/cookie/from-browser` | `{ browser }` → yt-dlp import |
| `DELETE` | `/api/plugins/ytmusic/cookie` | oubli |
| `GET` | `/api/plugins/ytmusic/search?q=` | recherche classée (artistes, albums, singles/EP, compilations, titres — songs+vidéos) |
| `GET` | `/api/plugins/ytmusic/library/liked` | likes |
| `GET` | `/api/plugins/ytmusic/library/playlists` | playlists |
| `GET` | `/api/plugins/ytmusic/playlists/:id` | titres d'une playlist |
| `GET` | `/api/plugins/ytmusic/albums/:id` | titres d'un album |
| `GET` | `/api/plugins/ytmusic/artists/:id` | titres d'un artiste (Top songs) |
| `POST` | `/api/plugins/ytmusic/play` | `{ videoId, deviceId, title?, artist?, artUrl?, durationS? }` → resolve + proxy + `play_url` |
| `GET` / `HEAD` | `/api/plugins/ytmusic/stream/:sid` | le « fichier » MP3 pour l'enceinte (taille, plages d'octets ; `HEAD` sans ffmpeg) |
| `GET` | `/api/plugins/ytmusic/sessions` | ce que nos lecteurs jouent de nous en ce moment |
| `POST` | `/api/plugins/ytmusic/transfer` | `{ fromDeviceId, toDeviceId }` → le titre repart sur la cible à la même position |
| `POST` / `GET` / `DELETE` | `/api/plugins/ytmusic/queue` | nouvelle file / la file d'un lecteur / la vider (depuis le 2026-09-22 soir : `POST /play` n'est plus qu'une file d'un titre) |
| `POST` | `/api/plugins/ytmusic/queue/{add,next,previous,jump,repeat,remove}` | piloter la file — détail : « Mise à jour 2026-09-22 (5) — la file d'attente », en bas de page |

## UI

- Carte `YtmusicLinkCard` dans le panneau plugin.
- Vue rail **Musique** (`/music`, `MusicView.vue`, juste après Météo ; `/ytmusic` redirige) :
  recherche simple ou avancée, Parcourir (récents, likes, playlists), panneau « Écoute » (un lecteur
  = une session), lecteur fixe en bas. Au montage elle charge `plugins.load()` + `GET …/status` (le
  store plugins n'est sinon rempli que dans Réglages — sinon faux « cookie manquant »). Un play
  **reste sur place** : c'est la touche « Voir dans la maison » d'une ligne du panneau qui navigue
  puis sélectionne l'enceinte (`selectDevice`, nav d'abord). Détail : « Mise à jour 2026-09-22 —
  la page Musique » plus bas.
- Clés i18n `ytmusic.*` / `settings.ytmusic.*` (fr/en), badge « non officiel » partout.

### Mise à jour 2026-09-20 — faux cookie manquant à l'arrivée

`YtmusicView` ne lit plus seulement `plugins.byId.ytmusic.health` (inventaire souvent vide hors
Réglages) : `refreshLink()` au montage.

### Mise à jour 2026-09-20 — recherche classée, UI, pochettes ORB

**Catalogue** (`catalog.ts`) : recherches InnerTube en parallèle filtrées `artist` /
`album` / `song` (+ `video` depuis 2026-09-21). Réponse `search` :
`artists`, `albums`, `singles` (Single+EP), `compilations`, `tracks` — plafond 20 / section.
Ordre artiste = **pertinence** InnerTube (ne plus re-scorer « nom contient la requête », qui
enterrait un artiste derrière un titre contenant son nom). Repli : channel_id des albums si l'artiste manque
dans le filtre. Type de release déduit du sous-titre ; titres « Best of », « Edition »,
« Essential collection », etc. → compil. Badge **explicit** (`MUSIC_EXPLICIT_BADGE`). Année
sur titres quand le sous-titre la porte.

**UI** (`YtmusicView.vue`) : colonnes 280 px, ellipsis, `PlayButton`, tris par section
(pertinence / A–Z / date). Persistance `localStorage` (`kasbah.ytmusic.*`). Pochettes via
`ArtThumb` (`<img referrerpolicy="no-referrer">`) — un `background-image` CSS déclenchait
`net::ERR_BLOCKED_BY_ORB` sur ggpht / googleusercontent.

### Mise à jour 2026-09-21 — discographie, vidéos, layout, explicit

**Catalogue** :
- Filtre `album` vide pour un artiste → harvest des albums cités par les titres +
  `getArtist` (Albums **et** Singles & EPs) ; heuristique
  ≤5 pistes → EP sinon album, puis `getAlbum` affine type / année / explicit.
- ≥3 artistes distincts → `compilation` (`MULTI_ARTIST_COMPILATION_MIN`).
- Mots-clés titre (« Best of », etc.) → compil **même si** InnerTube / `getAlbum` dit
  `Album` ; normalisation minuscules (casse ignorée).
- Explicit **titre** = badge du titre seul (jamais déduit de l'album). Explicit album =
  header ou au moins un titre badgeé.
- 4ᵉ filtre `video` fusionné aux songs (boost score titre) — certains morceaux n'existent
  qu'en Music Video, Restricted Mode hors cause.
- Session InnerTube : `withSession` + reset si cookie mort / HMR (`null.read`).

**UI** : ligne 1 = titre (+ badge E s'il y en a) ; ligne 2 = meta + durée (titres) + année
à droite. Switch « masquer les explicites » (client, `kasbah.ytmusic.hideExplicit`).
`ArtThumb` + `artThumbLoader.ts` (chargement différé).

## Hors phase 1

Mix / radio / SuperMix, podcasts, files multi-titres gapless, sync multi-pièces, Lounge YouTube.
Play album/artiste d'un geste (le bouton play n'est encore que sur les titres).

> Depuis le 2026-09-22 au soir, une **file multi-titres** existe (enchaînement côté serveur, sans
> gapless : ~2,5 s de silence entre deux titres) et « Tout lire » joue un album ou une playlist
> ouverts — cf. « Mise à jour 2026-09-22 (5) ». Restent hors périmètre : gapless, artiste d'un geste
> depuis une tuile, mix / radio, podcasts, sync multi-pièces.

## Essais live

Vérifié 2026-09-20 (volume bas) : Play:3 Sonos Cuisine + lecteurs Cast — titre, artiste et
pochette corrects grâce à `stickyPlay` (le DIDL Sonos seul montrait le sid du proxy). Timeout
`LAUNCH` TV Cast déjà connu (`6_faq/6_1_pieges-runtime.md`) : hors scope, retenter.

Import cookie Firefox (profil normal, navigateur fermé) + lecture OK après passage à
`web_music` + `--js-runtimes node` (yt-dlp 2026.08).

Recherche classée vérifiée live (plusieurs artistes) : filtres parallèles, pertinence, ORB fixé.

### Mise à jour 2026-09-20 — renew, import, flux yt-dlp 2026.08

- Carte Réglages : collage en premier, étapes import / renew, messages DPAPI et DB verrouillée.
- `POST /cookie/from-browser` + `browserCookies.ts`.
- `cookieExpired` / sonde ; pochettes `upgradeArtUrl` 544 px.
- Flux : plus d'`android_music` ; Node obligatoire pour EJS.

## Variables

> **2026-09-23 :** `YTM_PUBLISH_BASE` et `FFMPEG_PATH` ne sont plus dans le schéma du plugin : le
> lecteur commun les lit (`musicConfigSchema`, `apps/server/src/music/player.ts`), la première sous le
> nouveau nom `MUSIC_PUBLISH_BASE` avec repli sur l'ancien. Section (14).

| Variable | Défaut | Rôle |
|---|---|---|
| `YTM_COOKIE_FILE` | `.state/ytmusic-cookie.txt` | Cookie brut |
| `YTM_PO_TOKEN_URL` | `http://127.0.0.1:4416` | Générateur PO |
| `YTM_YTDLP_PATH` | `yt-dlp` | Binaire |
| `YTM_PUBLISH_BASE` | *(vide)* | Base LAN pour le stream ; sinon Host de `POST /play` |
| `FFMPEG_PATH` | `ffmpeg` | Proxy audio (clé commune Nest) |

## Mise à jour 2026-09-22 — un flux qui se met en pause, se déplace et change de pièce

> **⚠ MODÈLE ABANDONNÉ le jour même (2026-09-22).** Tout ce que cette section dit du FLUX décrit un
> **flux vivant sans taille**, avec la position, la pause et la reprise reconstruites côté serveur.
> Ce modèle a été remplacé l'après-midi même par le **« fichier » MP3 de taille connue** :
> `startS`, `resumeAt`, `servedAt` / `servedWhy`, `playedS`, les quatre raisons de servir,
> `PROBE_WINDOW_MS`, `noteClosed`, `YTM_RESUME_LEAD_MS` et la route `POST /seek` **n'existent plus**.
> Section à jour : « Mise à jour 2026-09-22 (2) — le proxy se présente comme un FICHIER MP3 de
> taille connue », en bas de page. Conservé ici parce qu'il dit **pourquoi** l'autre existe.

Jusqu'ici le plugin savait **lancer** un titre et rien de plus : une fois le `play_url` parti,
l'enceinte était seule avec un tuyau MP3 sans taille ni durée. La session du 22/09 a fait de ce
tuyau quelque chose qu'on pilote — pause, position, transfert d'une pièce à l'autre — sans jamais
rendre le flux « seekable », ce que ni ffmpeg en direct ni les lecteurs ne permettent.

### Le problème de fond : personne ne sait où on en est

Une enceinte qui joue notre proxy compte son temps **depuis le début du flux**, pas depuis le début
du morceau : si le flux a commencé à 1 min 12 s, l'enceinte annonce `positionS: 3` quand on est à
1 min 15 s. Et elle n'annonce **aucune durée** (le MP3 en direct n'en a pas). La position vraie est
donc une addition faite à trois endroits :

- `ProxySession.startS` — décalage auquel ce flux a commencé (`stream.ts`) ;
- `nowPlaying.positionS` publié par le lecteur, plus le temps écoulé depuis son `updatedAt` quand il
  joue (`trackPosition()` dans `index.ts` ; un Sonos est sondé toutes les 10 s, le relevé a jusqu'à
  2 s de retard) ; *[correctif 2026-09-22 soir : c'est le **Cast** qui relit toutes les 10 s
  (`DEFAULT_MEDIA_POLL_MS`, `google_cast/channel.ts`) ; le **Sonos** est sondé toutes les **2 s**
  (`SONOS_POLL_MS`, `sonos/index.ts`) — d'où justement « jusqu'à 2 s de retard »]* ;
- `meta.durationS` — la durée du **catalogue**, passée à `POST /play` et gardée dans la session,
  puisque le flux ne la porte pas.

C'est cette addition que l'UI affiche (`MusicPlayerBar`), et c'est elle que le transfert relit.

### Les quatre raisons de servir `GET /stream/:sid`

`StreamProxy.startFor(session, leadS)` décide à quel décalage repartir et **pourquoi**
(`ServeReason`, journalisé) :

| `why` | Quand | Décalage servi |
|---|---|---|
| `start` | premier service (lancement, déplacement voulu) | `startS` tel quel, déjà définitif |
| `resume` | transfert : `startS` était la position de la **source** à l'instant du relevé | `+ (maintenant − resumeAt)` **+ l'avance de tampon** |
| `probe` | un GET qui suit de moins de 1,5 s une connexion aussitôt refermée | **le même décalage** : la sonde n'a rien joué |
| `reconnect` | le même lecteur redemande le flux | connexion fermée → `playedS` (où l'écoute en était à la fermeture, quel que soit le délai) ; connexion encore ouverte → `+ temps écoulé` |

`noteClosed()` retient `playedS` = `startS + (fermeture − servedAt − leadS)` : le lecteur joue en
temps réel **depuis le premier son**, venu une avance de tampon après le début du service — d'où la
soustraction. Une connexion plus ancienne qui se ferme après la vraie (la sonde) est ignorée.

`PROBE_WINDOW_MS = 1_500` existe parce qu'un **Sonos sonde toujours l'URI** à sa réception, puis la
lit pour de bon 250–350 ms plus tard (constat live, `3_15_sonos.md`). Servir le second GET « au temps
écoulé » faisait sauter le premier quart de seconde, ou s'entendait comme deux décalages qui se
recouvrent.

### `YTM_RESUME_LEAD_MS` : l'avance de tampon, réglée à l'oreille

Une reprise sans avance repartait **~1 s en arrière** : la cible ne joue son premier octet qu'après
avoir rempli son tampon, temps que la source, elle, n'attend pas. D'où un décalage ajouté à la
position reprise, `YTM_RESUME_LEAD_MS` (défaut **1100 ms**, borné 0–5 000, documenté dans
`.env.example`). Valeur **calée à l'oreille par l'utilisateur** sur son parc : trop de retour en
arrière → l'augmenter, cible en avance → la baisser. Elle sert aussi à la soustraction de
`noteClosed`.

### Quatre routes de plus, et une porte unique vers les autres plugins

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/sessions` | les lecteurs qui jouent **en ce moment** un de nos flux : `deviceId`, `videoId`, `sid`, `startS`, `durationS`, titre / artiste / pochette du catalogue |
| `POST` | `/transfer` | `{ fromDeviceId, toDeviceId }` → le titre repart sur la cible à la position de la source, puis la source s'arrête |
| `POST` | `/seek` | `{ deviceId, positionS }` → **relance** le même titre au bon endroit |
| `HEAD` | `/stream/:sid` | mêmes en-têtes que le GET, **sans ffmpeg** |

`POST /play` accepte en plus `durationS` (durée catalogue, gardée dans `session.meta`).

Le **transfert ne repasse pas par yt-dlp** : l'URL googlevideo de la session source est encore
valable (TTL de session 1 h, validité de l'URL ~6 h), on la réutilise telle quelle. Et la source ne
s'arrête **qu'après** que la cible a démarré : un échec laisse la musique là où elle était.

Le **seek** est une relance, pas un déplacement : le proxy n'est pas « seekable » (pas de taille, pas
de durée, `accept-ranges: none`), donc on rouvre une session au décalage voulu et on repose l'URI.

Le `HEAD` existe parce qu'un Sonos sonde le format ainsi à la reprise. Deux pièges dedans :
Fastify **dérive HEAD du GET** s'on ne l'écrit pas, et exécuterait tout le handler — ffmpeg compris ;
et répondre `content-length: 0` faisait lire un **fichier vide** au Sonos, qui abandonnait la reprise
(il fallait appuyer deux fois sur lecture).

Le pont vers les autres plugins n'a plus qu'**une porte** : `YtmusicBridge.execute(deviceId, command)`
remplace `playUrl` / `stop` (`bridge.ts`, branché dans `app.ts` — devenu `core/playbackBridge.ts` /
`PlaybackBridge` le 2026-09-23, section (13)). Le plugin a maintenant trois verbes
à envoyer chez le voisin (`play_url`, `pause`, `stop`) ; une méthode par verbe aurait grossi à chaque
besoin, alors que le contrat de commande sait déjà tout dire.

### Remplacer un titre : `pause`, jamais `stop`

Lancer un titre là où l'un de nos flux joue déjà déclenche **tout de suite** un
`media_player.pause` sur le lecteur, avant les secondes de résolution yt-dlp : l'interface montre un
sablier, l'enceinte se tait, le nouveau titre prend la place de l'ancien. Un `stop` aurait été plus
franc, mais sur un Cast **il ferme l'appli** — qu'il faudrait relancer (`LAUNCH`, avec son timeout de
5 s sur une TV, cf. `../6_faq/6_1_pieges-runtime.md`). L'envoi est en « et si ça échoue, tant pis »
(`void … .catch(log.debug)`) : ce n'est qu'un confort d'écoute.

### `sessionActive` : une session proxy survit à ce que l'enceinte joue ensuite

`StreamProxy` ne sait pas que l'enceinte a changé de programme. Une radio lancée depuis Google Home
après notre morceau laissait la session vivante, et l'UI montrait **notre** titre, **notre** durée,
et aurait transféré le mauvais morceau. `sessionActive(s)` filtre donc `GET /sessions` (et garde
`/transfer` et `/seek`) sur ce que le lecteur **dit** :

- il joue ou il est en pause, et
- son titre est le nôtre, **ou** il n'est pas lisible (identifiant hexadécimal de 24 caractères, URL :
  l'enceinte n'en sait pas plus que ça sur un flux HTTP) ;
- les **5 premières secondes** sont accordées d'office, le temps que l'état du lecteur suive la
  commande.

### ffmpeg : `-ss` avant `-i`, et un fondu d'entrée permanent

`spawnFfmpeg(sourceUrl, startS)` place `-ss` **avant** `-i` (ffmpeg se positionne dans la source sans
décoder ce qui précède) et applique **toujours** `-af afade=t=in:st=0:d=0.06`. Un flux qui démarre en
milieu de morceau commence sur un échantillon quelconque et **claque** ; au début d'un titre, les
60 ms couvrent l'amorce de l'encodeur et le premier tampon de l'enceinte (petit craquement entendu au
lancement). Inaudible sur une intro — d'où le choix de ne pas le conditionner à `startS > 0`.

Tests : `stream.test.ts` (trois cas de `startFor` / `noteClosed` : sonde servie au même décalage,
reprise après pause à `playedS`, fermeture d'une connexion périmée ignorée) et `plugin.test.ts`
(transfert à la position de la source puis arrêt de la source).

### Runtime paresseux : ne plus planter pendant un redémarrage `tsx`

En développement, `tsx` peut recharger le module et **réenregistrer ses routes sans repasser par
`init()`** : `proxy`, `config` et `ctx` étaient alors `null` et la première requête arrivée dans cette
fenêtre plantait sur un `proxy!`. Tout ce que `init()` construisait se reconstruit désormais à la
demande — `getProxy()`, `cfg()` (défauts du schéma zod), `now()`, `log()` (repli sur `console`).

**Le revers, à savoir** : dans cette fenêtre le plugin tourne avec les **défauts**, donc
`YTM_YTDLP_PATH = 'yt-dlp'` — introuvable si le binaire est ailleurs — et sans `YTM_PUBLISH_BASE`.
*(Précision 2026-10-06 : la base de publication s'appelle désormais `MUSIC_PUBLISH_BASE` et relève du lecteur commun — voir la section (14).)*
Un essai de lecture juste après un redémarrage peut donc échouer pour cette seule raison :
**attendre que `/status` réponde** avant de conclure quoi que ce soit.

### Mise à jour 2026-09-22 — la page Musique

La vue `/ytmusic` (`YtmusicView.vue`, supprimée) devient **`/music`** (`MusicView.vue`, route
`music`, rail « Musique » / clé `nav.music`, redirection `/ytmusic` → `/music` pour les signets).
Le renommage dit la décision : **la page n'est pas celle d'un fournisseur**, c'est celle de la
musique de la maison — YouTube Music n'est que la première source (rangée de pastilles de sources en
en-tête, une seule allumée aujourd'hui).

Trois zones qui ne bougent jamais : la recherche et le catalogue au centre, le panneau **« Écoute »**
à droite (un lecteur = une session), le **lecteur** en bas. Détail d'interface et mesures dans
`../4_ui/4_1_navigation-et-panneaux.md` et `../4_ui/4_0_langage-visuel.md` ; ce qui se joue côté
plugin :

- **`GET /sessions` toutes les 20 s** (`refreshSessions`), plus un rafraîchissement après chaque
  play / transfert / seek / stop. C'est cette liste qui autorise Transférer : une appli native sur
  le Chromecast n'est pas à nous, et rien ne permettrait de la reprendre ailleurs.
- **Position affichée** = celle du lecteur (avancée localement par `useMediaPosition`) **+ `startS`**
  de la session, plafonnée à `durationS` du catalogue. **[Faux depuis le commit `6a5a460`** (flux
  devenu un fichier de taille connue) : la position est celle du lecteur seul, `startS` n'existe
  plus — cf. le paragraphe « Corrigé le même jour » ci-dessous.**]**
- **Titre, artiste et pochette** viennent de la session dès qu'elle existe : l'enceinte publie
  parfois l'URL du flux, le nom de l'appli, ou le `sid`. Un filtre `looksLikeUrl` écarte URL et
  identifiant hexadécimal de 24 caractères côté UI aussi, pour le cas où le **serveur a redémarré**
  et ne sait plus ce que l'enceinte joue.
- **Plus de toast de succès** au lancement ni au transfert : il passait par-dessus le lecteur, qui
  montre déjà le résultat. Les erreurs restent des toasts.
- Transport web : `ytmusicSessions`, `ytmusicTransfer`, `ytmusicSeek`, et `ytmusicPlay` qui accepte
  `durationS` (`apps/web/src/api/transport.ts`).

**Corrigé le même jour** (modèle « fichier », section du bas) : la **position affichée** est
simplement celle du lecteur (plus de `+ startS`), la **durée** vient du lecteur et retombe sur celle
de la session, le curseur envoie `media_player.seek` au lecteur, et `ytmusicSeek` a quitté le
transport. Le reste de cette sous-section (les trois zones, `GET /sessions` toutes les 20 s, le
filtre `looksLikeUrl`, les toasts retirés) reste exact.

### Décisions de périmètre (2026-09-22)

- **File d'attente côté serveur = phase 3**, pas faite. La lecture reste un titre à la fois.
  *[Faite le soir même, avant la phase 2 : « Mise à jour 2026-09-22 (5) — la file d'attente ».]*
- **Genres et ambiances** par `yt.music.getExplore()` = **phase 2**, pas faite. *(Faite le 2026-09-22 au soir, sans `getExplore()` : voir « Mise à jour 2026-09-22 (7) ».)* « Parcourir » se
  limite à Récents (mémoire locale du navigateur) / Likes / Playlists.
- La **page Médias reste à part** : elle pilote des lecteurs, pas une source musicale. Fusionner les
  deux a été écarté.

### Essai live 2026-09-22

Vérifié sur le Sonos **Bureau** (`sonos:RINCON_00000000A00101400`, pièce `bureau` de
`house/maison.json`) : pause / reprise d'un flux proxy, déplacement dans le morceau, transfert vers
une autre enceinte. C'est là qu'ont été relevés les deux GET systématiques du Sonos et le
`content-length: 0` fatal au `HEAD` (cf. `3_15_sonos.md`).

## Mise à jour 2026-09-22 (2) — le proxy se présente comme un FICHIER MP3 de taille connue

**Cette section remplace tout ce qui précède depuis « un flux qui se met en pause, se déplace et
change de pièce » (même journée).** Le modèle du matin — un flux vivant sans taille, et un serveur
qui reconstruit la position, la pause et la reprise — a été **abandonné** l'après-midi : voir la
bannière posée sur ces sections.

### Pourquoi l'abandon

Un tuyau sans taille oblige à refaire à la main, côté serveur, quatre choses que l'enceinte sait
déjà faire : savoir où on en est, mettre en pause, se déplacer, et s'arrêter à la fin du morceau.
Chacune a demandé son mécanisme (décalage de flux à additionner, quatre raisons de servir, fenêtre
de sonde, position retenue à la fermeture de la connexion, avance de tampon calée à l'oreille) et
chacune pouvait se tromper d'une à deux secondes. L'utilisateur a jugé **l'empilement trop
fragile** : trop de pièces mobiles pour un résultat qui restait approximatif.

L'autre issue évidente — **télécharger le morceau entier** avant de servir un vrai fichier — a été
**refusée** : la page est faite pour des mix de plusieurs heures, et la latence au lancement (plus
le disque) était inacceptable.

Reste la troisième voie, celle qu'on a prise : **mentir juste ce qu'il faut**. Se présenter comme un
fichier de taille connue et découpable par plages d'octets, sans rien télécharger d'avance, et
transcoder à la demande le morceau de fichier qu'on nous réclame.

### Ce qui rend le calcul exact : un MP3 à trames fixes

Le truc tient à un choix d'encodage (`spawnFfmpeg`, `stream.ts`) :
`-ar 48000 -ac 2 -c:a libmp3lame -b:a 192k -write_xing 0 -id3v2_version 0`. À 48 kHz et 192 kb/s en
débit constant, une trame MPEG-1 Layer III fait `144 × 192000 / 48000` = **576 octets** exactement
(pas de bit de bourrage) pour 1152 échantillons, soit **24 ms** — d'où `FRAME_BYTES`, `FRAME_S` et
`BYTES_PER_S = 24 000`. Ni en-tête Xing ni tag ID3 : rien devant qui décalerait le compte.

*(Dépassé le 2026-09-22 (3) : le flux passe à 320 kb/s — 960 octets par trame, `BYTES_PER_S` = 40 000 — et `FRAME_BYTES` est dérivé de `OUT_BITRATE_KBPS` dans `apps/server/src/music/proxy.ts` ; voir « Le flux passe à 320 kb/s, et le proxy dit ce qu'il sert ». Les 192 kb/s, 576 octets et 24 000 de ce passage sont l'état historique ; le raisonnement sur les trames fixes reste valable.)*

Octets et secondes deviennent alors interchangeables, et quatre fonctions suffisent :

- `lengthFor(durationS)` — la taille annoncée : un **nombre entier de trames**, la dernière seconde
  partielle comprise ;
- `seekFor(byteOffset)` — l'instant où commence la trame qui contient cet octet, **et** les octets
  de cette trame à sauter (une plage tombe rarement sur une frontière de trame) ;
- `parseRange(header, length)` — `bytes=a-b`, `bytes=a-`, suffixe `bytes=-n`, ramené à la taille ;
  `null` quand il n'y a pas de plage utilisable ;
- `LengthLock` — un `Transform` qui **tient exactement la taille promise** : il avale les `skip`
  premiers octets, coupe ce que ffmpeg produit en trop (sa dernière trame déborde de la durée) et
  **complète par des trames de silence** s'il s'arrête avant (durée arrondie, source un peu plus
  courte). Le silence, `silentFrame()`, est produit **une seule fois** par un ffmpeg `anullsrc`, puis
  gardé ; à défaut de trame livrée, des zéros, que les décodeurs ignorent.

C'est `LengthLock` qui rend la promesse sûre : une taille annoncée et non tenue laisse l'enceinte en
attente sur les derniers octets, et ce sont précisément les derniers qui décident qu'un morceau est
fini.

### D'où vient la durée, et ce qui arrive sans elle

`resolveStreamUrl` rend désormais `durationS` (`info.duration`, **`null` si `is_live`**). C'est elle
qui gagne ; à défaut, le `durationS` que l'UI a joint à `POST /play` (durée du catalogue). Le test
d'intégration le vérifie à l'envers de l'intuition : 20 s de yt-dlp l'emportent sur 265 s annoncés
par le catalogue.

**Sans durée** (un direct), rien de tout ceci ne s'applique : le flux est servi **à l'ancienne**,
sans `content-length`, `accept-ranges: none`. Le chemin d'avant n'a pas disparu, il est devenu le
cas dégradé.

### Ce que répondent `HEAD` et `GET /stream/:sid`

`fileHeaders()` est commun aux deux : `content-type`, `cache-control: no-store`,
`connection: close`, puis `accept-ranges: bytes` + `content-length` si la taille est connue,
`accept-ranges: none` sinon.

- **`HEAD`** répond ces en-têtes **sans lancer ffmpeg** — Fastify dériverait sinon le HEAD du GET et
  exécuterait tout le handler. (Le `content-length: 0` fatal du matin appartient à l'histoire : la
  taille est maintenant une vraie taille.)
- **`GET` sans plage** → 200, tout le fichier, ffmpeg depuis le début (pas de `-ss`).
- **`GET` avec `range: bytes=a-b`** → 206, `content-range: bytes a-b/total`, `content-length` de
  l'étendue, ffmpeg lancé avec **`-ss` à la trame** (avant `-i`, donc sans décoder ce qui précède) et
  `LengthLock` qui avale le début de trame.
- **Plage hors du fichier** → on sert **tout, en 200** (`parseRange` rend `null`) plutôt qu'un 416 :
  l'enceinte s'y retrouve.

Le fondu d'entrée `-af afade=t=in:st=0:d=0.06` reste **toujours** appliqué : une plage commence sur
un échantillon quelconque et claque sans lui ; au début d'un titre, les 60 ms couvrent l'amorce de
l'encodeur et sont inaudibles. Chaque service est journalisé (`ytmusic stream GET` : plage, `startS`
calculé, `user-agent`), ce qui suffit à relire après coup comment une enceinte a découpé un morceau.

### Ce que l'enceinte fait maintenant toute seule

C'est là que le changement se voit, et c'est tout l'intérêt :

- **la durée** — elle la déduit de la taille ; **constat live : le Sonos ne la publie pas** sur ce
  flux, l'UI prend alors celle de la session (`MusicPlayerBar` : durée du lecteur **sinon** celle de
  la session) ;
- **la position** — plus rien à additionner côté serveur ;
- **pause et reprise** — une **vraie** pause Sonos, et **un seul `Play`** pour repartir (le
  `SetAVTransportURI` reposé avant `Play` a été supprimé, cf. `3_15_sonos.md`) ;
- **le déplacement** — la commande du contrat, `media_player.seek`, précise à la trame : l'enceinte
  demande la plage d'octets correspondante ;
- **la fin du morceau** — les derniers octets arrivent, l'enceinte passe **au repos** d'elle-même.

### Transfert : le même fichier, puis un seek natif

`POST /transfer` (`index.ts`) est devenu court :

1. `launch()` ouvre une session pour la cible avec **la même URL googlevideo** (pas de nouvelle
   résolution yt-dlp) et les mêmes métadonnées, et envoie `play_url` ;
2. `seekWhenReady(to, positionS + TRANSFER_LEAD_S)` — **jusqu'à 5 essais espacés de 600 ms**, parce
   qu'une enceinte qui vient de recevoir l'URI refuse encore la commande ; `TRANSFER_LEAD_S = 1 s`
   couvre le temps de démarrage de la cible ;
3. la source s'arrête (`media_player.stop`) **seulement ensuite** : un échec laisse la musique là où
   elle était.

La position de départ vient de `trackPosition()` : le relevé publié par la source **plus** le temps
écoulé depuis son `updatedAt` tant qu'elle joue (un Sonos est sondé toutes les 10 s — *correctif
2026-09-22 soir : 2 s pour un Sonos, `SONOS_POLL_MS` ; les 10 s sont celles du Cast,
`DEFAULT_MEDIA_POLL_MS`*). C'est le seul
calcul de position qui subsiste, et il ne sert qu'au transfert.

`GET /sessions` garde son rôle et son filtre `sessionActive` (une session proxy survit à ce que
l'enceinte joue ensuite, cf. `../6_faq/6_1_pieges-runtime.md`) mais **ne porte plus `startS`** — un
test l'énonce explicitement (`not.toHaveProperty('startS')`). Et le **TTL d'une session passe de 1 h
à 6 h** : un mix de plusieurs heures doit rester servable, puisque l'enceinte redemande le
« fichier » à chaque reprise et à chaque déplacement.

### Ce qui a été supprimé

Tout ce qui existait pour compenser l'absence de taille :

| Supprimé | Ce qui le remplace |
|---|---|
| `ProxySession.startS`, `resumeAt`, `servedAt` / `servedWhy`, `playedS` | la position est celle du lecteur |
| les quatre raisons `start` / `probe` / `resume` / `reconnect` (`ServeReason`, `startFor`) | une plage d'octets, qui dit tout |
| `PROBE_WINDOW_MS` (la sonde Sonos servie au même décalage) | la sonde est un `HEAD`, ou un `GET` qu'on resservira |
| `noteClosed()` (position retenue à la fermeture) | l'enceinte se souvient elle-même |
| `YTM_RESUME_LEAD_MS` (avance de tampon, 1100 ms) | **variable supprimée** du schéma et de `.env.example` |
| `POST /seek` (relance du flux au décalage voulu) | **route supprimée** : `media_player.seek` du contrat |
| la reprise « au temps écoulé » | une pause est une pause |

Côté Sonos, deux mécanismes tombent avec eux (le `SetAVTransportURI` reposé sur `Play`, et le
mapping « STOPPED avec notre URI = `paused` ») : détail dans `3_15_sonos.md`.

### Tests

`stream.test.ts` ne teste plus des raisons de servir mais **le fichier** : durée → trames entières et
octet → début de trame, plages lues contre la taille annoncée, et `LengthLock` qui livre
*exactement* les octets promis (début de trame avalé, surplus coupé, silence ajouté).
`plugin.test.ts` enchaîne le tout sur une vraie app Fastify : durée yt-dlp qui bat le catalogue,
`HEAD` (834 trames = 480 384 octets pour 20 s), 200 complet, 206 sur `bytes=57600-` avec `-ss` à
2,4 s **avant** `-i`, plage hors fichier servie en 200, transfert `play_url` → `seek` → `stop` avec
44,2 s relevés et 45,2 s demandés, session perdue quand l'enceinte joue une radio, et `pause` avant
remplacement.

*(Dépassé le 2026-09-22 (3) : ces chiffres (834 trames, 480 384 octets, 576 octets par trame) datent des 192 kb/s ; à 320 kb/s la trame fait 960 octets, `FRAME_BYTES` étant dérivé (`apps/server/src/music/proxy.ts`).)*

### Essai live 2026-09-22 (Sonos Bureau → Garage)

Relevés par l'utilisateur devant les enceintes, flux proxy ytmusic (à prendre comme des ordres de
grandeur d'un parc Sonos, pas comme des garanties) :

- **pause à 7 s → reprise à 11 s**, en **un seul `Play`** (les 4 s sont le temps de la manipulation,
  pas un décalage) ;
- **déplacement demandé à 120 s → 122 s** atteints ;
- **transfert à 122,3 s** → la cible joue à **127 s** après 6 s, le temps du `play_url`, des essais de
  `seekWhenReady` et du démarrage.

## Mise à jour 2026-09-22 (3) — recherche officielle, 320 kb/s, qualité affichée

### La recherche ne rend plus que du catalogue

Une recherche YouTube Music remonte aussi ce que des **particuliers** ont mis en ligne : reprises
ralenties (« slowed + reverb »), concerts filmés au téléphone, chorégraphies, « type beats »,
instrumentaux, pages de fans. Sur une recherche d'artiste, la plupart des vidéos étaient de ce genre, et la
rangée Artistes montrait une page de fans — elle entrait par les artistes DÉDUITS des
crédits de ces vidéos, et son nom collait à la requête.

Le discriminant est donné par YouTube Music lui-même, dans l'endpoint du crédit :

| Crédit | Type de page | Exemple |
|---|---|---|
| Clip officiel | `MUSIC_PAGE_TYPE_ARTIST` | « <titre> (remix) », créditée à des artistes |
| Mise en ligne perso | `MUSIC_PAGE_TYPE_USER_CHANNEL` | « <artiste> - <titre> (slowed + reverb) », créditée à une chaîne perso |

`isUserUpload()` (`catalog.ts`) écarte un item dont les crédits citent une chaîne SANS citer
d'artiste. Trois endroits s'en servent : `pushTrack` (les titres), `artistRefsFromItem` (les artistes
déduits — d'où la disparition de la page de fans) et `cardToTypedRaw`, où un identifiant de chaîne
perso commence lui aussi par `UC` et passait donc pour un artiste. Un item **sans aucun crédit
cliquable** est gardé : rien ne dit qu'il est amateur.

Conséquence mesurée : la recherche ne rend plus que les vrais artistes, tous les titres
viennent du catalogue, et le vrai clip officiel — crédité à ses artistes — reste.

### Le filtre `song` fournit désormais toute la section

Les titres étaient pris à `songsOnly.slice(0, 12)`, les douze places restantes revenant aux vidéos.
Une fois les vidéos amateurs écartées, la section ne se remplissait plus (17 titres pour un
artiste). Le filtre `song` est passé à `SEARCH_SECTION_LIMIT` (20) : le catalogue remplit la section à
lui seul, les vidéos ne servent plus qu'à ce qui n'existe qu'en clip. Vérifié en direct : 20 titres
pour plusieurs artistes.

### Le flux passe à 320 kb/s, et le proxy dit ce qu'il sert

`stream.ts` expose trois constantes — `OUT_BITRATE_KBPS`, `OUT_SAMPLE_RATE_HZ`, `OUT_CHANNELS` — qui
pilotent **à la fois** les arguments ffmpeg et `FRAME_BYTES`, désormais **dérivé** :
`144 × débit / échantillonnage`. Un seul endroit décide, l'affichage ne peut plus mentir.

PIÈGE : le débit doit donner un nombre ENTIER d'octets par trame (192 → 576, 320 → 960). Sinon
l'encodeur ajoute un bit de bourrage, les trames changent de taille, et toute la promesse de taille —
donc la durée connue de l'enceinte et son déplacement natif — s'écroule.

`GET /sessions` rend en plus un bloc `quality` : `mime`, `bitrateKbps`, `sampleRateHz`, `channels`,
`lengthBytes` et le format `source` (extension, itag, débit annoncé par yt-dlp), gardé dans
`SessionMeta.source` au moment du `POST /play` — donc reposé tel quel au transfert. La barre de
lecture l'affiche sous le nom du lecteur (`MP3 320 kb/s`, détail en info-bulle).

### Mesure : la source est déjà un fichier AAC de taille exacte

Sonde du 2026-09-22 sur un titre du catalogue (compte **Premium**), avec les mêmes arguments yt-dlp
que le plugin :

| itag | conteneur | codec | débit | taille annoncée |
|---|---|---|---|---|
| 140 | m4a | AAC-LC | 130 kb/s | 2 200 451 o |
| 251 | webm | Opus | 143 kb/s | 2 420 614 o |
| **141** | **m4a** | **AAC-LC** | **258 kb/s** | **4 373 288 o** |
| 774 | webm | Opus | 285 kb/s | 4 832 574 o |

`141` est déjà celui que le plugin choisit. Et googlevideo répond `HEAD 200` avec `content-length`
exact et `accept-ranges: bytes` ; un `GET` avec `Range: bytes=1000-1999` rend un `206` et le
`content-range` attendu.

Autrement dit : **le « fichier de taille connue, découpable en plages » que le proxy fabrique en MP3,
la source le fournit déjà** — en AAC 258 kb/s, soit mieux que ce que nous réencodons. Une piste de
relais SANS réencodage est donc ouverte (ffmpeg ne servirait plus que de repli quand la source n'est
qu'en Opus, que Sonos ne lit pas). Points à vérifier avant de basculer : le type de contenu annoncé
dans le DIDL Sonos (`streamLoad` déduit `audio/mpeg` d'une URL sans extension), la lecture d'un m4a
fragmenté par plages, et l'expiration de l'URL googlevideo (~6 h). Sonde à faire sur le Sonos
« Bureau » et le Cast « Cuisine ».

Sources : `apps/server/src/plugins/ytmusic/{catalog,stream,index}.ts`,
`apps/server/src/plugins/ytmusic/{plugin,stream}.test.ts`,
`apps/web/src/components/music/MusicPlayerBar.vue`.

## Sonde 2026-09-22 — relais SANS réencodage : ça marche sur les deux enceintes

Sonde écrite derrière un drapeau (`POST /play { raw: true }`, absent de l'UI) : le proxy sert les
octets de googlevideo tels quels au lieu de lancer ffmpeg. Routes `HEAD` / `GET
/api/plugins/ytmusic/raw/:sid.:ext` — la plage demandée par l'enceinte est repassée telle quelle à
la source, le `content-range` et la taille de la réponse amont sont renvoyés.

Trois détails qui décident de la réussite :

- **Le conteneur, pas le débit.** Le classement des formats prend le plus gros débit : c'est l'Opus
  774 (285 kb/s) qui gagnait, et un **Sonos ne lit pas WebM** — il restait muet. `preferExts` force
  le m4a pour un relais (`141` AAC 258 kb/s, sinon `140`).
- **L'extension de l'URL n'est pas décorative** : `streamLoad` en déduit le type annoncé dans le
  DIDL Sonos, d'où `/raw/:sid.m4a` et non `/raw/:sid`.
- **L'annulation d'un flux relayé DOIT être rattrapée.** Le lecteur ferme la connexion (pause,
  changement de titre, fin de sonde) ; l'`AbortController` fait alors émettre une `AbortError` au
  flux, et sans écouteur `error` Node la remonte en exception non gérée : le **serveur tombe**.
  Constaté au premier essai.

Résultats mesurés (`_generated-ai-doc/probe-raw*.mjs`), Sonos « Bureau » et Cast « Cuisine » :

| Épreuve | Sonos Bureau | Cast Cuisine |
|---|---|---|
| Lecture d'un AAC 258 kb/s relayé | oui | oui |
| Durée publiée par l'enceinte | 230 s | 230,45 s |
| Déplacement natif à 90 s | position 92 | position 90 |
| Pause puis reprise | 93 → 96 | 93,8 → 96,2 |
| Fin de piste | — | passe seule au repos |
| Transfert Sonos → Cast | source arrêtée | cible à 6,7 s (source à 5,1 s) |

À noter : en relais, **le Sonos publie la durée** (230 s), ce que le flux MP3 ne lui permettait pas —
l'UI n'a plus besoin de la durée du catalogue. Et ffmpeg disparaît du chemin : plus de transcodage,
plus de `LengthLock`, plus d'arithmétique de trames — le déplacement est celui du lecteur dans un
vrai fichier.

Ce qui reste à trancher avant d'en faire le défaut : le repli quand la source n'existe qu'en Opus
(Sonos), l'expiration de l'URL googlevideo (~6 h) sur un mix très long, et le sort du modèle MP3
(garder les deux chemins, ou ne garder ffmpeg que pour ce repli).

Sources : `apps/server/src/plugins/ytmusic/{index,stream}.ts`, sondes
`_generated-ai-doc/probe-raw.mjs` et `probe-raw2.mjs` (éphémères), `.claude/launch.json`
(`YTM_PUBLISH_BASE` de la preview : sans lui, l'URL publiée renvoie le lecteur vers le serveur de
l'IDE, qui ne connaît pas la session ouverte dans la preview).

## Mise à jour 2026-09-22 (4) — le RELAIS devient le chemin normal, ffmpeg le repli

Décision de l'utilisateur après la sonde : on sert la source telle quelle, et on ne réencode que
lorsqu'on ne peut pas faire autrement.

**Comment le chemin est choisi**, dans `POST /play` :

1. `resolveStreamUrl` reçoit `preferExts: ['m4a', 'mp4']` — le conteneur passe AVANT le débit. Sans
   ça le classement prenait l'Opus 774 (285 kb/s), qu'un Sonos ne lit pas.
2. Si le format retenu est un conteneur relayable **et** que yt-dlp en annonce la taille, la session
   est ouverte en mode relais (`/raw/:sid.m4a`, `ProxySession.raw`).
3. Sinon — pas de taille, ou seulement de l'Opus — repli sur le MP3 à trames fixes, inchangé. Le
   journal le dit (`ytmusic: source not relayable, falling back to MP3 transcoding`), et la ligne
   `ytmusic play_url dispatched` porte désormais `mode` (`relay m4a` ou `mp3`) et `sourceKbps`.

`POST /play { raw: false }` force le repli : échappatoire si un lecteur bute sur le conteneur
d'origine. C'est le seul réglage ; il n'y a pas de variable d'environnement pour ça.

**Vérifié en direct le 2026-09-22 sans aucun drapeau** (chemin par défaut), Sonos « Bureau » et Cast
« Cuisine » : URL `/raw/<sid>.m4a`, AAC 258 kb/s (itag 141, 7 419 570 octets), durée publiée par
l'enceinte (230 s / 230,45 s), déplacement natif à 90 s, pause et reprise, arrêt. Et `raw: false` sur
le Cast redonne bien `/stream/<sid>` avec la durée 230,016 s du MP3 : les deux chemins marchent.

Tests : `plugin.test.ts` couvre les deux branches — « relays the source untouched when it announces a
size » (URL en `.m4a`, HEAD et plage repassées, ffmpeg jamais lancé, `quality` qui décrit la SOURCE)
et le test historique du fichier MP3, dont le faux yt-dlp n'annonce pas de taille : c'est donc bien
le repli qu'il éprouve.

Ce que le relais fait disparaître : le transcodage (et sa perte), `LengthLock`, l'arithmétique de
trames et la durée du catalogue qu'il fallait prêter au Sonos. Ce qui reste à surveiller :
l'expiration de l'URL googlevideo (~6 h) sur un très long mix, et les titres qui n'existent qu'en
Opus — ceux-là passent par ffmpeg.

Sources : `apps/server/src/plugins/ytmusic/{index,stream}.ts`,
`apps/server/src/plugins/ytmusic/plugin.test.ts`.

## Mise à jour 2026-09-22 (5) — la file d'attente (phase 3), côté serveur

La phase 3 annoncée plus haut est faite, le soir même et avant la phase 2 (genres / ambiances). Non
commitée au moment de l'ingestion (arbre de travail du 2026-09-22).

### Pourquoi côté serveur, et pourquoi le lecteur n'en sait rien

L'enceinte ne connaît jamais qu'**un « fichier » à la fois** : on lui envoie un `play_url`, elle le
joue, elle s'arrête. Ni Sonos ni Cast ne reçoivent de liste de notre part. La file vit donc **dans le
plugin, une par lecteur** (`queues: Map<deviceId, RunningQueue>`, `index.ts`), et c'est le serveur qui
lance le titre suivant — l'écran peut être éteint, la musique continue. Pour la même raison,
précédent et suivant passent par des **routes du plugin**, pas par `media_player.next` / `previous` :
l'enceinte n'aurait rien à sauter.

Découpage :

- `queue.ts` — **logique pure**, sans réseau : `QueueTrack`, `RepeatMode`, et cinq fonctions
  (`afterEnd`, `upcoming`, `jumpTo`, `insert`, `removeAt`), testées seules (`queue.test.ts`) ;
- `index.ts` — ce qui touche au monde : `startTrack` (résolution + `play_url`, sorti de l'ancien
  `POST /play`), `resolveTrack`, `prefetchUpcoming`, `playAt`, `advance`, `onPlayerState`,
  `liveQueue` ;
- `bridge.ts` — le pont gagne un troisième membre, **`onState(cb)`** (chaque état publié par un
  lecteur ; rend de quoi se désabonner), branché dans `app.ts` sur `bus.on('state')`. L'abonnement se
  fait **paresseusement, à la première file** (`watchPlayers`), pas au démarrage : un rechargement
  `tsx` réenregistre les routes sans repasser par `start()` (même raison que le « runtime paresseux »
  plus haut). Sans ce flux, le journal le dit (`no player state feed — tracks will not chain`).

### La répétition porte sur le TITRE, et la file ne boucle pas

Choix de l'utilisateur. `RepeatMode` vaut `off` / `once` / `loop` :

- `once` — le titre courant est **rejoué une fois**, puis la file reprend (le mode retombe à `off`) ;
- `loop` — le titre courant est rejoué **sans fin** ;
- la file elle-même **ne repart jamais au début** : après le dernier titre, elle s'arrête.

Sauter ailleurs (suivant, précédent, choix dans la liste) fait tomber un `once` en attente — il
visait le titre qu'on quitte — mais garde un `loop` (`jumpTo`). Un titre rejoué **réutilise la
session résolue** (même `sourceUrl` googlevideo, même mode relais / MP3 via `rawOf`) : pas de nouvel
aller yt-dlp.

### Routes

> **2026-09-23 :** ces routes sont désormais `/api/music/queue*` (lecteur commun, section (14)) ; une
> piste y est `{ source, id }`, plus `videoId`.

| Méthode | Chemin | Corps / requête | Rôle |
|---|---|---|---|
| `POST` | `/queue` | `{ deviceId, tracks (1 à 1000), startIndex?, raw? }` | nouvelle file (l'ancienne est remplacée), `tracks[startIndex]` joue |
| `GET` | `/queue?deviceId=` | — | `{ items, index, repeat }` ; 404 sans file vivante |
| `POST` | `/queue/add` | `{ deviceId, tracks, where: 'next' \| 'end' }` | ajouter sans interrompre ; **rien de vivant sur ce lecteur → la lecture part**, réponse `started: true` |
| `POST` | `/queue/next` | `{ deviceId }` | titre suivant ; **409 `QUEUE_END`** en bout de file |
| `POST` | `/queue/previous` | `{ deviceId }` | **retour au début** (`media_player.seek` à 0) si plus de 3 s jouées ou premier titre, sinon le titre d'avant |
| `POST` | `/queue/jump` | `{ deviceId, index }` | jouer un titre choisi dans la file |
| `POST` | `/queue/repeat` | `{ deviceId, mode }` | changer la répétition |
| `POST` | `/queue/remove` | `{ deviceId, index }` | retirer un titre — **jamais celui qui joue** (400) |
| `DELETE` | `/queue?deviceId=` | — | vider : **le titre courant continue, seul** |

`QUEUE_MAX = 1000` (« une playlist de plusieurs heures tient largement ») vaut pour la création comme
pour l'ajout. `POST /play` est désormais **une file d'un titre** : la répétition vaut aussi pour lui,
et c'est la même mécanique qui le lance ; le schéma d'un titre (`trackSchema`) est partagé. `GET
/sessions` gagne `queue: { length, index, repeat } | null` — de quoi griser précédent / suivant et
montrer la répétition sans ouvrir la file.

**409 `SUPERSEDED`** : une résolution dure plusieurs secondes ; si une autre commande a lancé autre
chose sur ce lecteur entre-temps, le titre résolu ne part pas (`stillWanted`, relu après la
résolution).

### Reconnaître une fin de piste : aucun lecteur ne l'annonce

C'est le cœur du travail. Ni Sonos ni Cast ne disent « titre fini » : l'état passe simplement à
`idle` (Sonos `STOPPED` en fin de fichier, Cast `IDLE`) — exactement comme après un arrêt voulu.
`onPlayerState` les distingue **par la position** :

- tant que le lecteur joue, la file retient la **dernière position entendue** et son heure
  (`heard`) — **redatée seulement quand `positionS` change** : un état republié pour autre chose (le
  volume) porte l'ANCIENNE position, et la redater ferait partir l'estimation de trop tôt ;
- au passage à `idle`, position entendue + temps écoulé depuis ; si elle atteint
  **durée − 5 s** (`END_SLACK_S`), c'est une fin de piste et la file avance (`advance`) ;
- un `idle` **en milieu de morceau** (arrêt demandé, pause d'un flux que le Sonos transforme en Stop)
  laisse la file **en attente**, sans avancer ;
- les **3 premières secondes** après un `play_url` sont ignorées (`SETTLE_MS`, comptées depuis
  l'ouverture de la session) : un Sonos passe ~1 s à l'arrêt juste après `SetAVTransportURI`, et un
  relevé en vol peut encore décrire le titre précédent.

La file **s'efface** d'elle-même quand notre session proxy est remplacée ou fermée (autre `play`,
cookie retiré, TTL), ou quand le lecteur joue **autre chose** (il joue, mais `sessionActive` est
faux — une radio lancée depuis Google Home, par exemple). `liveQueue` applique le même critère aux
routes. Un titre qui ne se lance pas est **sauté** ; au plus trois titres d'affilée tentés, puis la
file abandonne.

### Précharger le suivant

Pendant que le courant joue, `prefetchUpcoming` résout déjà le **prochain titre différent**
(`upcoming` : pas le même en cas de répétition, son flux est déjà là). Cache d'**une heure**
(`PREFETCH_TTL_MS`) alors que l'URL googlevideo vaut ~6 h : un titre pas joué au bout d'une heure
est résolu à nouveau. Un préchargement qui échoue **n'est pas gardé** — le vrai lancement
réessaiera, et dira pourquoi. Relancé après chaque ajout, retrait ou changement de répétition.

### Le transfert emporte la file

`POST /transfer` marque la file `busy` le temps de l'opération (la source va s'arrêter en milieu de
morceau : ce n'est pas une fin de piste), puis la **déplace** sur la cible avec la nouvelle session.
Même drapeau pendant chaque `playAt` : pendant qu'un titre part, les états du lecteur ne disent rien
de la file.

### PIÈGE (vu en live) : la pause « de confort » qui arrive après le nouveau titre

Remplacer un titre commence par un `media_player.pause` de l'ancien (cf. « Remplacer un titre :
`pause`, jamais `stop` »). Elle partait en « et si ça échoue, tant pis » (`void … .catch`), **sans
être attendue** — tant que la résolution yt-dlp prenait plusieurs secondes, ça ne se voyait pas. Avec
un titre **préchargé**, `play_url` partait dans la même milliseconde, la pause arrivait **après**, et
le Sonos « Bureau » restait **en pause à 0 s sur le nouveau titre**.

Correctif (`startTrack`) : pause et résolution tournent **en parallèle** — on garde le silence
immédiat pendant les secondes de yt-dlp — mais la pause est **attendue avant `play_url`**. Test de
non-régression : « waits for the pause of the playing track before sending a prefetched one »
(`plugin.test.ts`). La pause n'est plus envoyée que si le lecteur joue (`playback === 'playing'`).

### Tests

`queue.test.ts` (six cas : avance puis arrêt en bout de file, `once` puis reprise et `loop`,
préchargement du seul titre différent, `once` qui tombe au saut et `loop` qui reste, insertion
`next` / `end`, retrait qui garde l'index sur le courant). `plugin.test.ts` : « chains a queue at the
end of each track, repeats, skips, and follows a transfer », et le test du piège ci-dessus.

### Essai live 2026-09-22 (Sonos « Bureau »)

Sur `sonos:RINCON_00000000A00101400`, relevé par la session : enchaînement en fin de
titre avec **~2,5 s** entre la fin du son et le son suivant (pas de gapless : c'est le prix d'un
`play_url` par titre, préchargement compris), répétition une fois, boucle deux tours, suivant /
précédent, fin de file ; côté UI suivant, cycle de répétition, « Lire ensuite », retrait et « Vider
la file ». **Non essayé sur un Cast.**

Sources : `apps/server/src/plugins/ytmusic/{queue,index,bridge}.ts`, `apps/server/src/app.ts`,
`apps/server/src/plugins/ytmusic/{queue,plugin}.test.ts`, `apps/server/src/plugins/sonos/index.ts`
(`SONOS_POLL_MS`), `apps/server/src/plugins/google_cast/channel.ts` (`DEFAULT_MEDIA_POLL_MS`). Côté
page : `../4_ui/4_1_navigation-et-panneaux.md` ; transport : `../1_architecture/1_4_app-web.md`.

### Mise à jour 2026-09-22 (6) — les titres d'un album prennent pochette, artiste et nom dans l'en-tête

Sondé en direct (un album, `MPREb_yXhSI4FCUo6`) : sur une page d'album, `getAlbum` rend un en-tête
`MusicResponsiveHeader` (`thumbnail` 544 px, `strapline_text_one` = l'artiste, `title`) et des lignes
**sans** `artists` ni vignette, dont le seul sous-titre est le compteur (« 19M plays »). Deux effets :
pas de pochette dans le détail ni envoyée au lecteur, et un faux artiste — le repli « artiste depuis le
sous-titre » d'`itemToRawTrack` prenait « 19M plays », qui partait jusqu'à l'enceinte.

Correctif (`catalog.ts`) : `albumTracks` recopie sur chaque titre qui n'en a pas la pochette
(`bestThumb(thumbsOf(header))`), l'artiste (`textOf(strapline_text_one)`) et le nom de l'album ; le repli
écarte désormais aussi les compteurs d'écoutes (`plays`, `lectures`, `écoutes`) comme il écartait les
vues. Test : « gives album tracks the album art, artist and title from the header » (en-tête au format
réel). La pochette part alors avec `play_url` comme pour tout titre.

Sources : `apps/server/src/plugins/ytmusic/catalog.ts` (`albumTracks`, `itemToRawTrack`),
`apps/server/src/plugins/ytmusic/plugin.test.ts`.

### Mise à jour 2026-09-22 (7) — Humeurs et genres (phase 2)

**Sondé en direct** (session `lang: 'fr'`) : `getExplore()` ne rend qu'une section « Humeurs et
genres » tronquée ; la vraie source est `browse FEmusic_moods_and_genres`, une liste de GRILLES de
`musicNavigationButtonRenderer` : « Pour vous » (6, personnalisée, peut manquer), « Humeurs et
moments » (12), « Genres » (25). Chaque bouton porte `buttonText`, `solid.leftStripeColor` (entier
ARGB) et `clickCommand.browseEndpoint.params`, qui ouvre `browse FEmusic_moods_and_genres_category`.
youtubei.js n'a pas de méthode pour ces pages et son analyseur JETTE la couleur : la page des
catégories est lue en JSON BRUT (`explore.ts`, `parseMoodsPage`). Les grilles sont classées par
POSITION (dernière = genres, avant-dernière = ambiances, le reste = « Pour vous ») : leurs titres sont
localisés.

**Page d'une catégorie** : lue ANALYSÉE (`parse: true`) pour réutiliser les convertisseurs du
catalogue (`itemToRawTrack` / `itemToRawPlaylist` / `itemToRawAlbum`). PIÈGE : dans une vraie réponse
analysée, `contents` est un objet enveloppe sans clés parcourables — les rangées se prennent dans
l'index `contents_memo.get('MusicCarouselShelf')` (dans l'ordre de la page) ; le parcours de l'arbre
ne sert qu'en repli. Une AMBIANCE (« Calme ») n'a que des rangées de playlists thématiques (« Ambiance
café », « Au calme »… 14 rangées) ; un GENRE (« Jazz ») a Titres (50 `MusicResponsiveListItem`),
Sélection de playlists, Playlists de la communauté, Clips, Albums. On garde titres (`item_type:
song`), playlists OFFICIELLES (`RDCLAK…`, id `VLRDCLAK…`) et albums ; clips et playlists d'utilisateurs
(`PL…`) écartés (choix de l'utilisateur). L'en-tête de la page ne donne pas de titre exploitable :
le contrat n'en porte pas, l'UI connaît le nom de la catégorie.

**Langue** : `CreateSession(cookie, lang?)` ; le catalogue tient une session par langue (`''` = celle de
toujours, pour la recherche et la bibliothèque — ses textes analysés, « Album · … », compteurs, ne
changent pas). Les genres s'affichent donc dans la langue de l'app sans toucher au reste.

| Route | Réponse |
|---|---|
| `GET /explore?hl=fr` | `{ forYou, moods, genres }`, chacun `{ title, categories: { title, params, color: '#rrggbb' \| null }[] }` |
| `GET /explore/category?params=…&hl=fr` | `{ shelves: { title, tracks, playlists, albums }[] }` (rangées vides retirées) |

`hl` validé (`^[a-z]{2}(-[A-Z]{2})?$`, sinon ignoré). Cache mémoire 10 min par langue et par
catégorie. Schémas zod `exploreSchema` / `exploreCategoryPageSchema` (`types.ts`). Tests
`explore.test.ts` (grilles par position, absence de « Pour vous », ARGB → RVB, rangées via l'index ou
l'arbre) et `plugin.test.ts` (langue transmise, cache, langue mal formée ignorée, clips et playlists
communautaires écartés).

**Bug vu pendant l'essai, corrigé** : le Sonos publie parfois comme titre le NOM DU FICHIER relayé
(`<sid>.m4a`, depuis `206941b`). `sessionActive` ne reconnaissait qu'un sid nu : la file se croyait
remplacée (« player moved on to something else ») et s'effaçait, la barre montrait le nom de fichier.
Les trois tests (`sessionActive`, `looksLikeUrl` de la barre, `readable` du panneau Écoute) acceptent
désormais une extension. Test « keeps a relayed session when the Sonos publishes the file name ».

Sources : `apps/server/src/plugins/ytmusic/{explore,catalog,index,types}.ts`,
`apps/server/src/plugins/ytmusic/{explore,plugin}.test.ts`. Page : `../4_ui/4_1_navigation-et-panneaux.md`.

### Mise à jour 2026-09-22 (8) — pochettes des catégories

La page « Humeurs et genres » ne porte AUCUNE image (boutons : nom, couleur, `params`). `GET
/explore/covers?hl=` → `{ covers: { [params]: string[] } }` : deux pochettes par catégorie, prises dans
SA page (playlists, sinon albums, sinon titres), agrandies en 240 px (`upgradeArtUrl`). Lecture des
pages quatre à la fois ; les pages lues passent par le cache des catégories (l'ouverture d'une
catégorie en profite). Stock par langue et PAR CATÉGORIE, 6 h : « Pour vous » change d'une lecture à
l'autre, seules les catégories absentes ou vieillies sont relues ; deux appels simultanés partagent la
même lecture. Mesuré : ~9 s la première fois (41 catégories), 0,3 s ensuite. Test : cache, et une
catégorie nouvelle seule relue.

Sources : `apps/server/src/plugins/ytmusic/index.ts` (`/explore/covers`, `coverStore`, `fillCovers`),
`apps/server/src/plugins/ytmusic/plugin.test.ts`.

### Mise à jour 2026-09-23 (9) — Nouveautés, doublons, badges dans l'enveloppe `SuperParsedResult`

**Nouveautés** : `GET /explore/new?hl=` → `{ shelves }` (même forme qu'une catégorie). `catalog.newReleases`
lit EN PARALLÈLE `FEmusic_new_releases` (grille des playlists phares « RELEASED », rangée « Albums et
singles » de 24, clips écartés) et sa page « Voir tout » `FEmusic_new_releases_albums` (~180-200
albums et singles en UNE réponse, sans continuation) : la rangée d'albums prend la liste complète, EN
ENTIER (choix de l'utilisateur, après avoir hésité à 100). Cache 10 min. `carouselsOf` lit aussi les
`Grid` (éléments dans `items`, pas `contents`), placées en tête comme sur la page.

**Doublons** : YouTube répète parfois un élément dans la même rangée (« RELEASED » deux fois, MÊME id) ;
`browseShelves` garde la PREMIÈRE occurrence de chaque titre / playlist / album (la suivante peut venir
sans pochette — vu en test).

**PIÈGE — badges explicit perdus** : dans une réponse `browse` analysée, `badges` d'un `MusicTwoRowItem`
est un `SuperParsedResult` (enveloppe sans clés, lue par `is_array` / `array()` / `item()`), comme
`contents`. `asList` ne l'ouvrait pas : AUCUN album des nouveautés ni des catégories n'était marqué
(0 sur 184 ; 59 après correctif). `asList` déballe désormais l'enveloppe ; la recherche (autre chemin
youtubei) n'a pas dévié — quelques singles de plus correctement marqués. Test avec une enveloppe
simulée, qui échoue sans le correctif.

Sources : `apps/server/src/plugins/ytmusic/{catalog,explore,index}.ts`, `apps/server/src/plugins/ytmusic/{explore,plugin}.test.ts`.

### Mise à jour 2026-09-23 (10) — www.youtube.com retient les titres explicit ; présentations ; page artiste

**PIÈGE MAJEUR — l'hôte d'InnerTube.** youtubei.js envoie TOUTES ses requêtes à
`www.youtube.com/youtubei/`, même pour le client YouTube Music. Or www.youtube.com RETIENT les titres
explicit d'un album : un album y a 5 titres (des titres explicit absents,
alors que l'en-tête annonce « 8 songs · 33 minutes »), music.youtube.com en rend 8 — avec OU sans
compte, quelle que soit la version du client (`1.20250219` de youtubei ou une récente), le
`User-Agent`, `hl` / `gl`. Fausses pistes écartées en chemin : le cookie (Firefox puis Chrome, compte
partagé, mode restreint désactivé), `__Secure-YEC`, `VISITOR_INFO1_LIVE`. NB : passer
`client: 'YTMUSIC'` à `actions.execute` écrase la `clientVersion` de la session par celle de youtubei.
**Correctif** : `musicHostFetch` (`catalog.ts`), `fetch` de la session qui réécrit
`https://www.youtube.com/youtubei/` en `https://music.youtube.com/youtubei/`, comme le site. Les cookies
valent pour tout `.youtube.com`, la signature SAPISIDHASH reste acceptée : bibliothèque, likes, compte,
recherche, genres, nouveautés répondent (recherche : un peu plus de titres explicit marqués qu'avant).
Test `catalog.test.ts`.

**Présentations** : `GET /albums/:id?hl=` et `GET /artists/:id?hl=` rendent `{ tracks, description }` —
le texte de l'en-tête (`MusicDescriptionShelf.description` pour un album, `MusicImmersiveHeader.description`
pour un artiste), souvent tiré de Wikipédia, dans la langue `hl` (session par langue).

**Page artiste : seulement des titres.** `getArtist` range dans ses rangées albums (`MPREb…`), playlists
(`VL…`) et artistes proches (`UC…`) : la plupart des éléments chez un artiste étaient pris pour des titres
et échouaient à la lecture. Filtre par `item_type` (album / playlist / artist), à défaut par la forme de
l'id (collections longues et préfixées) ; puis une chanson une fois (la rangée « Clips » reprend souvent
celles de « Titres » sous l'id du clip) — 20 titres. Tests dans `plugin.test.ts`.

Sources : `apps/server/src/plugins/ytmusic/{catalog,index}.ts`, `apps/server/src/plugins/ytmusic/{catalog,plugin}.test.ts`.

### Mise à jour 2026-09-23 (11) — journal allégé

Un Sonos lit le fichier servi par plages de 6 Ko : `ytmusic raw GET` (relais) et `ytmusic stream GET`
(repli MP3), une ligne `info` par plage, noyaient le journal. Ils passent en `debug` (comme les `HEAD`).
Restent en `info`, une fois par événement : `ytmusic play_url dispatched` (titre, lecteur, `mode` relais /
mp3, débit source), transfert, fin de file, file abandonnée, repli MP3, cookie. Pour enquêter sur la
lecture d'une enceinte requête par requête : `KASBAH_LOG_LEVEL=debug`.

Sources : `apps/server/src/plugins/ytmusic/index.ts`.

## Mise à jour 2026-09-23 (12) — lecture locale : le navigateur devient un lecteur

Jusqu'ici, la page Musique ne faisait qu'envoyer de la musique **ailleurs** : une enceinte Sonos ou
Cast recevait un `play_url`. Désormais, l'appareil qui affiche la page (tablette, ordinateur,
téléphone) peut jouer **lui-même**, par un `HTMLAudioElement`. Non commité au moment de l'ingestion
(arbre de travail du 2026-09-23).

### Décision : une session PRIVÉE, un nom générique

Choix de l'utilisateur. Le lecteur s'appelle simplement **« Ce navigateur »** (sous-titre « Son de
cet appareil »), sans nom d'appareil à saisir, et il n'existe **que pour l'écran qui l'affiche** :
les autres écrans ne le voient pas, et le serveur ne le compte pas parmi ses lecteurs.
Conséquence directe sur le découpage : le serveur n'a **aucun état publié** pour ce lecteur, donc il
ne peut ni reconnaître une fin de piste, ni tenir sa file. **Le navigateur tient tout** — lecture,
position, file ; le serveur ne fait que résoudre le titre et relayer le « fichier ».

### Côté serveur : `POST /local`, une session sans lecteur

> **2026-09-23 :** devenu `POST /api/music/local`, corps `{ source, id, …, clientId, next?: { source, id } }`
> (`nextVideoId` disparaît) ; section (14).

| Méthode | Chemin | Corps | Réponse |
|---|---|---|---|
| `POST` | `/local` | `{ videoId, title?, artist?, artUrl?, durationS?, explicit?, clientId, nextVideoId? }` | `{ streamUrl, session }` |

- `clientId` : 8 à 64 caractères `[A-Za-z0-9-]`, tiré au hasard par le navigateur et gardé
  (`localStorage kasbah.music.localClientId`). La session proxy porte le `deviceId`
  **`local:<clientId>`**, qui n'est aucun appareil.
- Le titre est résolu comme pour une enceinte (yt-dlp, ou le préchargé s'il est là — `takePrefetched`),
  puis la session s'ouvre ; **rien n'est envoyé à aucun lecteur**. `nextVideoId`, s'il est fourni,
  part en préchargement (`prefetchVideo`) : c'est la seule façon pour le serveur d'anticiper une file
  qu'il ne voit pas.
- `streamUrl` est un **chemin relatif** (`/api/plugins/ytmusic/raw/<sid>.<ext>` en relais,
  `/api/plugins/ytmusic/stream/<sid>` en repli MP3) : c'est le navigateur qui parle au serveur, pas une
  enceinte du réseau à qui il faudrait l'adresse LAN publiée. Le transport HTTP le préfixe de sa base
  (`httpTransport.ts`). Le relais sans réencodage vaut donc aussi pour le navigateur.
- `sessionActive` rend **faux** pour une session `local:` — elle n'est pas celle d'une enceinte : c'est
  ce qui la tient hors de `GET /sessions` (filtré par `sessionActive`), donc invisible des autres écrans.

Refactor au passage, sans changement de comportement pour les enceintes : `describeResolved` (méta de
session + décision relais / repli MP3, sorti de `startTrack`), `streamPath` (le chemin du « fichier »),
et `prefetchVideo` sorti de `prefetchUpcoming`.

### Le transfert accepte un navigateur à l'un ou l'autre bout

`POST /transfer` gagne deux champs facultatifs, `positionS` et `queue { tracks, index, repeat }`.
Deux navigateurs aux deux bouts : 400 (« a transfer needs at least one player »).

- **Du navigateur vers une enceinte.** Le serveur ne peut pas relever la position d'un lecteur qui
  ne publie rien : `positionS` est **obligatoire** (400 sinon). Il lance le même fichier sur l'enceinte,
  se place (`seekWhenReady`, comme un transfert entre enceintes), et **reprend la file** du navigateur à
  son compte (`queues.set` + `watchPlayers` + `prefetchUpcoming`) : c'est lui qui enchaîne désormais sur
  l'enceinte, écran éteint ou non. Il n'arrête pas la source — le navigateur **se tait lui-même** à
  la réponse (`local.stop()`).
- **D'une enceinte vers le navigateur.** Rien à lancer : le serveur ouvre une session `local:` sur la
  **même URL source** (pas de nouvel aller yt-dlp), arrête l'enceinte, **retire sa file serveur**, et
  rend `{ streamUrl, session, positionS, queue }` ; le navigateur adopte le tout (`local.adopt`) et
  repart à la position.

### Côté web : un lecteur synthétique, une file dupliquée

Le store `apps/web/src/stores/localPlayer.ts` (Pinia) — détail dans `../1_architecture/1_4_app-web.md`
et `../4_ui/4_1_navigation-et-panneaux.md`. Ce qui touche au plugin :

- La file du navigateur suit **les mêmes règles** que `queue.ts` (répétition du TITRE `once` / `loop`,
  la file ne boucle pas, « précédent » revient au début après 3 s jouées ou sur le premier titre). Pour
  cela, **`afterEnd` et `jumpRepeat` sont DUPLIQUÉS** en bas du store depuis
  `apps/server/src/plugins/ytmusic/queue.ts`. **Dette connue** : toute règle changée d'un côté doit
  l'être de l'autre, aucun test ne le garantit.
  *(Dépassé le 2026-09-23 : le fichier est `apps/server/src/music/queue.ts`, la file étant passée au lecteur commun — section (14).)*
- Un titre répété en fin de piste repart à 0 sur le **même fichier**, sans aller au serveur.

### Pièges traités côté navigateur

- **Déverrouiller le son dans le geste.** Safari refuse `play()` qui arrive après un `await` (la
  résolution du titre prend plusieurs secondes : le geste est « consommé »). `prime()` joue donc, de
  façon **synchrone dans le clic**, un WAV silencieux (`data:audio/wav…`) ; `MusicView` l'appelle avant
  toute lecture, ajout, ou transfert vers le navigateur.
- **Les événements du son silencieux sont ignorés** (`src` en `data:`) : sans ce filtre, son `ended`
  faisait **avancer la file**.
- **Se placer attend `loadedmetadata`** : un `currentTime` posé avant est ignoré par certains navigateurs
  (reprise après transfert, nouvel essai).
- **Un seul nouvel essai sur `error`**, à la même position : le fichier ne se lit plus quand la session
  a expiré ou que le serveur a redémarré ; on redemande le titre une fois, puis on s'arrête.
- Un refus du navigateur (`DOMException` : lecture automatique bloquée, format) n'est pas une erreur du
  serveur : toast dédié « Lecture impossible dans ce navigateur » (`music.localFailed`).

Media Session API : titre et pochette sur l'écran verrouillé, actions `play` / `pause` /
`nexttrack` / `previoustrack` / `seekto`.

### Essai live 2026-09-23 (preview, vrai serveur)

Dans la preview de l'app contre le vrai serveur : AAC **258 kb/s relayé tel quel** (pas de réencodage),
durée 7:10 affichée, déplacement, pause / reprise, suivant / précédent, enchaînement en fin de titre.
**Transfert navigateur ↔ enceinte NON essayé en live** : seulement couvert par le test serveur
« opens a browser session without any player, and transfers both ways with the queue »
(`plugin.test.ts`).

**Limites connues, non mesurées** : sur iPhone, Safari peut couper le son écran verrouillé ou page en
arrière-plan ; l'URL googlevideo vaut ~6 h (même TTL que les sessions proxy), au-delà, c'est le nouvel
essai sur `error` qui doit prendre le relais — cas non éprouvé.

Sources : `apps/server/src/plugins/ytmusic/index.ts` (`/local`, `/transfer`, `sessionActive`,
`describeResolved`, `streamPath`, `prefetchVideo`), `apps/server/src/plugins/ytmusic/plugin.test.ts`,
`apps/web/src/stores/localPlayer.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`apps/web/src/views/MusicView.vue`.

## Mise à jour 2026-09-23 (13) — deuxième source : le pont sort du plugin, la page devient multi-source

**Le pont de lecture déménage.** `bridge.ts` (`YtmusicBridge`, `setYtmusicBridge`, `getYtmusicBridge`),
cité dans les sections du 2026-09-22 et (5), est **déplacé** dans `apps/server/src/core/playbackBridge.ts`
et renommé `PlaybackBridge` / `setPlaybackBridge` / `getPlaybackBridge`, sans changement de forme :
le plugin `radio` (`3_19_radio.md`) en est le second utilisateur. Détail :
`../1_architecture/1_2_serveur-et-plugins.md`.

**La page Musique n'a plus une seule source.** La rangée de pastilles de sources (section « la page
Musique » du 2026-09-22, « une seule allumée aujourd'hui ») est remplacée par un sélecteur
« YouTube Music » / « Radios » ; YouTube Music reste la source par défaut. Interface :
`../4_ui/4_1_navigation-et-panneaux.md`, « (17) ».

*(Annotation 2026-09-23, plus tard dans la journée : l'extraction annoncée au paragraphe suivant est faite, section (14).)*

**Ce qui ne bouge pas, et pourquoi.** File d'attente, relais, sessions et transfert restent dans ce
plugin : la radio n'en a pas besoin (le flux va de la station à l'enceinte). Leur extraction en noyau
commun est prévue **avec Mixcloud**, dont la sonde du 2026-09-23 montre un m4a AAC 64 kb/s de taille
connue et découpable par plages — le profil du relais brut de la section (4). Détail de la sonde et de
la décision : `3_19_radio.md`, « Suite : Mixcloud ».

Sources : `apps/server/src/core/playbackBridge.ts`, `apps/server/src/app.ts`,
`apps/server/src/plugins/ytmusic/index.ts`, `apps/web/src/views/MusicView.vue`.

## Mise à jour 2026-09-23 (14) — le lecteur sort du plugin : ytmusic n'est plus qu'une source

**Décision de l'utilisateur**, prise à l'arrivée de Mixcloud (`3_20_mixcloud.md`) comme annoncé en
(13) : tout ce qui joue une piste — proxy (relais brut / repli MP3), file d'attente, fin de piste par
la position, préchargement, transfert, écoute locale, `sessionActive` — quitte le plugin pour
`apps/server/src/music/`, monté sous **`/api/music`**. Page dédiée :
`../1_architecture/1_6_lecteur-musique.md`. Le comportement est **porté à l'identique** ; les raisons
de chaque mécanisme restent dans les sections (1) à (5) et (12) de cette page, qui les décrivent sous
leurs anciens chemins.

**Ce qui reste dans le plugin** :
- le **catalogue** (`catalog.ts`, recherche, bibliothèque, explorer…) et ses routes
  `/api/plugins/ytmusic/*` ;
- le **cookie** (collé, importé du navigateur, sonde d'expiration) ;
- **`plugins/ytmusic/resolve.ts`** (nouveau) : la résolution yt-dlp `web_music` + cookie Netscape +
  PO Token + runtime JS node, et `pingPoToken` — ce qui était la partie YouTube de l'ancien
  `stream.ts`. Le lancement de yt-dlp passe par `music/ytdlp.ts` (`runCapture`), partagé avec
  Mixcloud.

**Comment il se branche** : à `init`, `registerMusicSource({ id: 'ytmusic', label: 'YouTube Music',
prepare, resolve, playArt })` ; à `stop`, il se retire.
- `prepare` = cookie présent et non expiré (`NEEDS_PAIRING` sinon) + générateur PO Token joignable
  (`DEVICE_UNAVAILABLE` sinon) ;
- `resolve(videoId)` = `resolve.ts` avec `preferExts: ['m4a', 'mp4']` (ce que relaient les
  enceintes) ; un refus d'authentification (`isAuthError`) marque le cookie expiré, comme avant ;
- `playArt` = pochette montée à **544 px** (`ART_PLAY_SIZE`, `mapping.ts`).
Pas d'`onProgress` : ytmusic ne retient aucune position de reprise (seul Mixcloud le fait).

**Configuration** : `YTM_PUBLISH_BASE` et `FFMPEG_PATH` sortent du `configSchema` du plugin (donc de
`health().keys`). Le lecteur commun les lit : `MUSIC_PUBLISH_BASE`, avec **repli sur
`YTM_PUBLISH_BASE`** pour les `.env` existants, et `FFMPEG_PATH`. `YTM_YTDLP_PATH` reste ici, et
Mixcloud s'en sert par défaut.

**API** : une piste n'est plus `{ videoId }` mais `{ source: 'ytmusic', id }` partout (`/play`,
`/local` — `nextVideoId` devient `next: { source, id }` —, files, sessions, transfert). Côté web, le
transport renomme `ytmusicPlay` → `musicPlay`, `ytmusicSessions` → `musicSessions`, etc.
(`../1_architecture/1_4_app-web.md`) ; les méthodes de catalogue gardent leur préfixe `ytmusic`.

**Changement de comportement** : `DELETE /cookie` appelait `proxy?.clear()` ; le proxy n'étant plus
au plugin, **vider le cookie ne ferme plus les sessions en cours** — un titre déjà relayé va au bout,
seules les résolutions suivantes échouent.

**Tests** : les scénarios de lecture restent dans `plugin.test.ts`, réacheminés sur `/api/music`
sans changer un scénario (56 tests verts d'après le thread principal) ; `stream.test.ts` et
`queue.test.ts` ont suivi leurs fichiers (`music/{proxy,queue}.test.ts`).

**Vérifié en direct le 2026-09-23** (thread principal) : Sonos Garage → Bureau, relais m4a AAC
258 kb/s, seek, transfert à la position.

Sources : `apps/server/src/plugins/ytmusic/{index,resolve}.ts`, `apps/server/src/music/*.ts`,
`apps/server/src/app.ts`, `git show 5c43833:apps/server/src/plugins/ytmusic/index.ts` (ancien
`DELETE /cookie`).

### Mise à jour 2026-10-06 — la source est aussi joignable par le serveur MCP

Un assistant IA branché sur `/mcp` (`apps/server/src/mcp/server.ts`, page `../1_architecture/1_7_serveur-mcp.md`) passe par deux outils :
`search_music` (`source: 'ytmusic'`, la valeur par défaut) appelle `GET /api/plugins/ytmusic/search`
et rend des pistes `{ source, id, title, artist, album, artUrl, durationS, explicit }` ; `play_music`
les reçoit telles quelles et les pose sur une enceinte par le lecteur commun (`POST /api/music/queue`,
`1_6_lecteur-musique.md`). Mêmes chemins que l'interface : cookie, PO Token et relais sont ceux de cette
page, rien n'est propre au MCP.

*(Précisé le 2026-10-07 : « mêmes chemins » reste vrai, mais le cookie n'est plus forcément celui de la maison — un jeton appartient à un compte, et `search_music` / `play_music` utilisent les comptes musicaux de ce compte. Voir ci-dessous.)*

### Mise à jour 2026-10-07 — un compte YouTube par utilisateur, et l'accès anonyme

**Pourquoi.** Demande : « chacun retrouve ses playlists, propositions, etc., et on ne détériore pas
l'historique d'un autre user ou du user commun ». Le détail du lecteur est dans
`../1_architecture/1_6_lecteur-musique.md` (même date). Constat de conception : yt-dlp n'utilise pas
`--mark-watched`, donc **lire ne s'inscrit pas dans l'historique YouTube** ; ce que le compte commun
voyait se mélanger, c'étaient les recherches et recommandations (« Pour vous »).

**Décisions de l'utilisateur** (questions posées, réponses données) :

- Utilisateur connecté **sans cookie** → **accès anonyme** : catalogue public, rien de personnel, aucune
  trace. Écartés : « pas d'accès » (source masquée) et « repli sur le compte commun » (abîme
  l'historique commun, c'est justement ce qu'on veut éviter).
- Les mêmes cartes de Réglages et de la page Musique agissent sur « le compte courant » : le sien s'il est
  connecté, celui de la maison sur le réseau local. Écarté : une carte séparée « Mes comptes musique ».
  Conséquence : le compte de la maison ne se règle que depuis le réseau local.
- PO Token et activation du plugin restent communs.

**Un `Account` par compte** (`apps/server/src/plugins/ytmusic/index.ts`) : cookie, `YtmusicCatalog` et
ses sessions InnerTube, `linked`, `cookieExpired`, `lastProbeAt`, `lastError`. La maison =
`YTM_COOKIE_FILE` ; un utilisateur = `users/<nom>/ytmusic-cookie.txt` (+ `.netscape` à côté), sous
`.state/` (`userStateFile`, `core/paths.ts`, détail en `../5_setup/5_1_configuration-env.md`). Toutes les
routes agissent sur le compte de la requête.

**Anonyme** (utilisateur sans cookie) : recherche, albums, artistes, playlists publiques, Humeurs, genres
et Nouveautés sont servis **sans cookie** (`Innertube.create` sans `cookie`) ; la lecture passe par
yt-dlp **sans `--cookies`** (`resolve.ts`) ; likes et bibliothèque rendent `NEEDS_PAIRING` (409). La
maison sans cookie reste `NEEDS_PAIRING` comme avant.

**Mesure** : flux anonyme résolu par le vrai yt-dlp en **m4a 130 kb/s, format 140**, ~4,3 s ; le compte
Premium sert le 141 (256 kb/s). Relevé du 2026-10-07 dans le navigateur, un seul passage, pas une
médiane.

**Import refusé pour un utilisateur** : `POST /cookie/from-browser` rend 400 — le navigateur du serveur
porte le compte de la maison. La section d'import de la carte est masquée pour un utilisateur.
`GET /status` gagne `user` et `anonymous` ; `browsers` est vide pour un utilisateur.

**Caches par compte** : Humeurs, genres et pochettes sont désormais tenus par compte (« Pour vous » est
propre à chacun). `health()` ne parle que du compte de la maison.

**Côté web** : `views/MusicView.vue` utilise YouTube Music en anonyme, masque les onglets Likes et
Playlists (`personal`) et ramène l'onglet mémorisé à Récents. `YtmusicLinkCard.vue` affiche « Compte de
{user} : ce qui est réglé ici ne touche pas le compte de la maison » (`settings.musicAccountOf`) et
`settings.ytmusic.anonymous`. `api/transport.ts` : `YtmusicStatus.user` / `anonymous`.

**Étapes du cookie réécrites** (`settings.ytmusic.pasteHowTo`, fr et en). L'utilisateur ne retrouvait plus
comment copier la valeur entière : il était dans Application → Cookies, qui montre les cookies un par un.
Il faut la ligne entière : Réseau + F5, filtre `browse`, requête `browse?…`, En-têtes → En-têtes de requête
→ ligne `cookie` → clic droit **Copy value** (ou Raw et sélection) ; la valeur contient `__Secure-3PAPISID`.
La carte avertit : pas l'onglet Application → Cookies. **`document.cookie` écarté** : il omet les cookies
HttpOnly (`__Secure-3PSID`, `SID`) dont YouTube a besoin — dit à l'utilisateur, pas dans la carte.

**Limites** : dans Réglages, le badge de santé reste celui de la maison (un connecté peut lire « liaison
requise » alors que son compte est relié) ; les écrans de la maison restent la maison.

**Tests** : `plugin.test.ts`, `describe('ytmusic accounts')` (2) ; contrôle négatif fait (retirer
`accountFor` fait rougir). Suite complète 1 924 tests verts à l'ingestion.

Sources : `apps/server/src/plugins/ytmusic/{index,catalog,resolve,types}.ts`,
`apps/web/src/components/YtmusicLinkCard.vue`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-10-08 — le badge de santé d'un utilisateur connecté

`healthFor(user)` (`index.ts`, contrat dans `../1_architecture/1_2_serveur-et-plugins.md`) relit le cookie
du compte puis rend :

| État du compte | Badge | Détail |
|---|---|---|
| aucun cookie (anonyme) | `ok` | `anonymous — public catalog only; paste your cookie for likes and playlists` |
| aucun cookie, PO Token injoignable | `degraded` | `PO Token generator unreachable` |
| cookie expiré | `needs_pairing` | `your cookie expired — paste a new one in Settings` |
| cookie valable | comme la maison (`healthFrom`) | `catalog + stream resolution`, ou la dernière erreur |

**Choix de séance** : l'anonyme est `ok` et non « à relier », parce qu'il fonctionne (recherche et
lecture) ; le détail invite à coller son cookie. L'utilisateur a été prévenu que c'est une ligne à
changer s'il préfère un badge qui pousse à relier. `health()` reste celui de la maison.

**Carte** : après un collage, un import ou un effacement, `YtmusicLinkCard` recharge aussi l'inventaire
des plugins (`plugins.load()`, comme `AgendaLinkCard`), sans quoi le badge serait resté l'ancien jusqu'au
rechargement de la page.

**Vérifié** (navigateur, serveur jetable à nom public, compte de test) : sans cookie, « Connecté » avec le
détail anonyme là où l'on lisait « liaison requise » ; vue du réseau local, la maison reste
`needs_pairing`. Tests : assertions `healthFor` dans `describe('ytmusic accounts')`.

Sources : `apps/server/src/plugins/ytmusic/index.ts`, `apps/web/src/components/YtmusicLinkCard.vue`.

### Mise à jour 2026-10-20 — le plugin lance le générateur PO Token

Symptôme sur la vraie maison : avec `npm run start` (production), santé `degraded` « PO Token
generator unreachable » — seul `npm run dev` lançait le générateur (`scripts/dev-pot.mjs`, dans le
`concurrently`).

Désormais, au `start()` du plugin, si rien ne répond au `/ping` de `YTM_PO_TOKEN_URL`, le plugin lance
`node _external/bgutil-ytdlp-pot-provider/server/build/main.js --port <port de l'URL>`
(`potServer.ts`), à trois conditions : l'URL est sur cette machine (`127.0.0.1`, `localhost`,
`[::1]`), le build existe, et rien ne répond encore (un Docker ou un lancement manuel est donc
respecté). Il attend ensuite que le générateur réponde (30 essais, 1 s) sans bloquer le démarrage,
journalise sa sortie s'il s'arrête, et l'arrête au `stop()` du plugin. Même schéma que VoiceStudio
pour la transcription (`3_25_transcription.md`).

`scripts/dev-pot.mjs` sort de `npm run dev` et `npm run house` : deux lanceurs se disputeraient le
port 4416. `npm run dev:pot` le garde pour un lancement à la main. Avec la relance du serveur de dev,
un générateur dont l'arrêt n'a pas eu lieu reste sur le port et est réutilisé au démarrage suivant.

Sources : `apps/server/src/plugins/ytmusic/{index,potServer}.ts`, `plugin.test.ts`
(describe « ytmusic PO Token generator »), `package.json`, `scripts/dev-pot.mjs`.

### Mise à jour 2026-10-24 — le cookie écrit en 0600, et ses deux copies effacées au déliage

Constats d'un audit de sécurité (F11, F29) : le cookie (toute la session Google) et sa copie Netscape
pour yt-dlp étaient écrits avec les droits par défaut (0644 sous un umask 022), et « délier » n'effaçait
que la copie brute. Désormais `cookie.ts`, `browserCookies.ts` et la copie temporaire de `resolve.ts`
écrivent en 0600 (par `writeFileAtomic`, qui applique le mode à chaque écriture puisqu'il crée un
nouveau fichier), et `clear()` efface aussi `<fichier>.netscape`. Test : `ytmusic/cookie.test.ts` (le test
du mode est sauté sous Windows, où il ne veut rien dire).

### Mise à jour 2026-10-30 — un cookie que yt-dlp n'accepte plus : le flux coupé après un Mo

**Symptôme.** Sur le compte relié d'un utilisateur, seul le premier titre d'un album se jouait, puis
erreur ; impossible de lancer le n-ième titre directement. Le navigateur affichait « Failed to load because
no supported source was found », un Cast `LOAD_FAILED`. La file d'attente et le préchargement
n'étaient pas en cause : « Dis-le » lancé seul échouait aussi.

**Cause, mesurée sur la vraie maison.** Avec ce compte, yt-dlp résolvait le **format 140** (AAC 130 kb/s),
celui d'un invité, au lieu du 141 d'un compte Premium, alors que le compte est Premium. Sur l'URL googlevideo
obtenue, la plage `0-1048575` répondait 206 et **toute autre plage 403** : googlevideo ne sert que le
premier Mo d'un flux dont il refuse le jeton PO. Un intro de 786 Ko tenait dedans et se jouait en entier ;
tous les titres suivants, plus gros, s'arrêtaient sur l'enceinte. Le compte de la maison (cookie Premium,
format 141) lisait les mêmes titres jusqu'au bout. **Un cookie recollé depuis une fenêtre privée, fermée
aussitôt, a tout réglé** : Google fait tourner les jetons d'une session restée ouverte dans le navigateur
où le cookie a été copié, et yt-dlp repasse alors en invité **sans échouer**. Le catalogue (InnerTube)
acceptait encore ce cookie : la carte disait « Cookie enregistré » et la sonde des likes passait.

**Ce qui le rend visible désormais** (`resolve.ts`) :

- **`--no-warnings` retiré** de l'appel yt-dlp ; les lignes `WARNING:` de sa sortie d'erreur sont passées
  à `onWarnings` et journalisées par le plugin (`yt-dlp warnings`, avec le compte et le `videoId`).
  C'est la seule trace d'un cookie qu'il n'accepte plus. Mixcloud et l'import navigateur gardent
  `--no-warnings`.
- **Sonde de la fin du fichier** à chaque résolution d'un flux de plus d'un Mo (`FIRST_CHUNK_BYTES`) :
  une requête du dernier octet. Un **403** fait échouer la résolution avec un message lisible
  (« YouTube cut the stream after its first megabyte: yt-dlp no longer accepts this account's cookie —
  paste a fresh one… » ; la variante sans cookie parle du PO Token d'une session anonyme), qui arrive en
  toast au lieu d'un `LOAD_FAILED` muet. Une erreur réseau ou un autre statut ne bloque rien : seule la
  réponse 403 de googlevideo tranche. Le message évite exprès les mots qu'`isAuthError` reconnaît : il
  devient `lastError` sans passer le cookie en « expiré », que la sonde du catalogue rétablirait aussitôt.
  Coût : une requête HTTP de plus par résolution, préchargements compris.

Le relevé du 2026-10-07 (« anonyme = format 140 ») ne mesurait que la résolution, pas une lecture
complète : un flux anonyme coupé au premier Mo reste possible ; la sonde le dirait de la même façon.

**Tests** : `apps/server/src/plugins/ytmusic/resolve.test.ts` (4) — avertissements transmis et
`--no-warnings` absent, 403 sur le dernier octet refusé avec la plage demandée, 206 ou réseau en panne
acceptés, pas de sonde sous un Mo. Les deux premiers étaient rouges avant le correctif. Dossier ytmusic :
56 tests verts.

Sources : `apps/server/src/plugins/ytmusic/{resolve,index}.ts`, `resolve.test.ts`.
