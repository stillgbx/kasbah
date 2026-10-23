# Plugin Sonos (enceintes, Port)

> Dernière mise à jour : 2026-10-23
> Sources : `apps/server/src/plugins/sonos/{index,discovery,soap,mapping,known,types}.ts`, fixtures `apps/server/src/plugins/sonos/__fixtures__/network.ts`, tests `mapping.test.ts` et `plugin.test.ts`, `apps/server/src/plugins/index.ts`, `apps/server/.env.example`, `tools/sonos-probe.mts`, `apps/web/src/views/MediaView.vue`, `apps/server/test/integration.test.ts`

## Ce que l'utilisateur veut, et ce que le local permet

Demande : intégrer les enceintes Sonos du réseau, comme Cast — inventaire, état, télécommande —
sans vue nouvelle. Le contrat `media_player` et la vue Médias existent déjà.

Sondage du 2026-09-19 (script `tools/sonos-probe.mts`, même rôle que `cast-probe`) : des
enceintes sur le LAN, pas une.

| Appareil | Nom de zone | Porte locale |
|---|---|---|
| Sonos Port (`S23`) | Bureau | HTTP `:1400` SOAP, sans authentification |
| Sonos Play:3 (`S3`) | Cuisine | idem |

Les deux modèles parlent **UPnP/SOAP sur le port 1400**. `GET /status/info` (annoncé JSON par la doc
communautaire) est **vide** ; l'identité est dans `GET /status/zp` (XML : `LocalUID`, `ZoneName`,
`SoftwareVersion`). `wss://{ip}:1443/websocket/api` répond **HTTP 400 sans clé d'API** : hors
phase 1. Pas de compte, pas de quota, pas de carte de liaison.

Décision : **phase 1 = UPnP:1400**. Le compte Sonos / Control API cloud reste en réserve si un
firmware ferme le local (leçon `cap.pw: 0` d'iRobot).

| Besoin | UPnP :1400 | Remarque |
|---|---|---|
| Voir volume, muet, lecture, pochette | Oui | SOAP `GetVolume` / `GetMute` / `GetTransportInfo` / `GetPositionInfo` |
| Lire / pause / stop / suivant / précédent / volume / muet / seek | Oui | Transport sur le **groupe**, volume sur le **player** |
| Lancer un flux HTTP(S) (`media_player.play_url`) | Oui | `SetAVTransportURI` + `Play` ; DIDL via `streamLoad` |
| Lancer Spotify / une file depuis Kasbah | Non | Hors phase 1 (service Sonos lié, pas une URL) |
| UI des groupes | Non | Un `media_player` par enceinte physique ; le groupe n'est qu'une cible de transport |
| Control API cloud (OAuth) | Non | Réserve si le firmware ferme `:1400` |

## Relevé du réseau réel (2026-09-19)

SSDP `M-SEARCH` `urn:schemas-upnp-org:device:ZonePlayer:1` (UDP 1900, multicast `239.255.255.250`).
`GetZoneGroupState` : **des groupes d'un**, chacun coordinateur de lui-même. Tous étaient
**STOPPED**, file vide (`Browse NumberReturned=0`, `TrackMetaData` vide). Recapture via
`GET /api/plugins/sonos/raw` le soir même : toujours STOPPED, muet à 0.

### Mise à jour 2026-09-19 (soir) — lecture réelle sur le Play:3 Cuisine

`GET /api/plugins/sonos/raw` pendant une lecture HLS (`x-sonosapi-hls-static`, `sid=284`) :

- transport `PLAYING`, durée `0:02:18` (138 s), curseur présent → **pas un direct**
  (`nowPlaying.live` absent, `seek` et `track_skip` restent) ;
- `dc:title` = « <artiste> - <titre> » (artiste **dans** le titre) ;
- `dc:creator` = `MicroGram` (nom de la **source**, pas l'interprète) — le mappage le publie
  tel quel en `artist` ;
- **pas** d'`upnp:album` ;
- `upnp:albumArtURI` = chemin **relatif** `/getaa?s=1&u=…` (le plugin préfixe
  `http://{ip}:1400` puis relaie `/art`) ;
- `protocolInfo` = `sonos.com-http:*:application/x-mpegURL:*` ;
- `r:streamContent` vide.

Piste suivante, même service HLS : `dc:title` = « <titre> », `dc:creator` = « <artiste> »
(l'interprète), `upnp:album` = « <album> », durée 198 s. **Les deux formes coexistent**
sur le même flux : le mappage ne suppose ni album, ni artiste hors du titre.

La fixture `__fixtures__/network.ts` `DIDL_TRACK` / `SOAP_POSITION_PLAYING` est la première
capture (jeton HLS anonymisé) ; `DIDL_ALBUM` / `SOAP_POSITION_ALBUM` est la seconde.

### Mise à jour 2026-09-19 (nuit) — pochettes : décoder `&amp;` dans `/getaa`

Le DIDL SOAP laisse `upnp:albumArtURI` avec des entités (`/getaa?s=1&amp;u=…`). `xmlTag` ne les
décode pas : le relais `/art` frappait l'enceinte avec `&amp;` dans la query → **HTTP 404**,
pochette absente dans la vue Médias. Le même `getaa` avec `&` décodé répond **200 image/jpeg**
(60–196 Ko mesurés). `parseDidl` décode désormais les champs texte (`decodeXml`) avant de
construire l'URL proxy.

Piège SSDP : une socket liée à `0.0.0.0` part sur la carte APIPA (`169.254…`) de cette machine
multi-cartes et reste muette. `discovery.ts` ouvre **une socket par IPv4** (ou celle de
`SONOS_SSDP_INTERFACE`). Même famille que `CAST_MDNS_INTERFACE`.

Vérification live une fois le plugin allumé dans `house/maison.json` : santé `ok` —
« N device(s), N reachable » ; `media_player.set_volume` +1 puis retour en HTTP 200 ; `pause` et
`next` sur une file vide → **HTTP 500 Sonos** (l'UI les grise déjà au repos, `MediaView.vue`).
Les enceintes apparaissent dans la vue Médias, bande « Hors maison », volume et sourdine
actifs, transport grisé.

## Architecture du plugin (`apps/server/src/plugins/sonos/`)

- `discovery.ts` — SSDP ZonePlayer, une socket UDP par IPv4.
- `soap.ts` — POST XML à la main, pas de bibliothèque. Timeout composé `AbortSignal.any` +
  `SONOS_REQUEST_TIMEOUT_MS` + `ctx.signal`.
- `mapping.ts` — **pur**. Identité `/status/zp` + description UPnP ; volume / muet / transport /
  position / DIDL → patch `media_player`. `externalId` = `LocalUID` (`RINCON_…01400`, **sans `:`** —
  les `groupId` en portent un, interdits par le contrat plugin). `meta.mediaPlayer.deviceClass:
  speaker`, `meta.forgettable: true`. Capacités : `playback`, `volume`, `mute`, `now_playing`,
  `track_skip`, `seek`, `play_url`.
- `known.ts` — copie du patron Cast : une enceinte éteinte reste listée indisponible.
- `index.ts` — cycle de vie des leçons 2026-09-16 : `discover()` **sans réseau** (rejoue `known`) ;
  `init()` remet à zéro ce qui dit « déjà publié » (l'hôte `stop`/`start` sans réinstancier) ;
  `start()` : SSDP + `createPoller` (GENA `SUBSCRIBE` non vérifié à la capture, donc pas d'événements
  poussés). Transport SOAP ciblé sur l'hôte du **coordinateur** du groupe ; volume / mute sur le
  player. `previous` : retour au début passé 3 s (`RESTART_AFTER_S`, contrat `media_player`).
  `play_url` : `SetAVTransportURI` puis `Play` (`streamLoad` / `streamDidl` dans `mapping.ts`).
  Routes `GET /raw`, `GET /art` (les écrans ne parlent pas à l'enceinte), `DELETE /devices/:externalId`.

Pas de carte Réglages : le local suffit, comme Cast. `makeStubPlugin('sonos')` n'existe plus
(`PLUGIN_FACTORIES.sonos` → `createSonosPlugin`).

Hors phase 1 : lancer une file Spotify / service lié, UI des groupes, WebSocket `:1443`, Control API cloud.

### Mise à jour 2026-09-20 — `media_player.play_url` (SetAVTransportURI)

Commande du contrat : URL HTTP(S) → DIDL (`streamDidl` : HLS = `audioBroadcast`, sinon
`musicTrack` ; `title` / `artist` / `artUrl` optionnels pour le `nowPlaying`) →
`SetAVTransportURI` sur le coordinateur → `Play`. Vérifié en réel sur le Play:3
Cuisine (volume bas, franceinfo Icecast) : `playback: playing`, stop → `idle`. Même URL que Cast :
l'enceinte va chercher le flux elle-même, Kasbah ne proxy pas l'audio.

### Mise à jour 2026-09-20 — `stickyPlay` (métadonnées `play_url`)

Sonos n'écho **pas** de façon fiable le DIDL d'un flux HTTP arbitraire : après
`SetAVTransportURI`, `GetPositionInfo` renvoie souvent un titre vide ou le dernier segment
de l'URL (ex. le `sid` hex du proxy ytmusic). Dès qu'une commande `play_url` apporte
`title` / `artist` / `artUrl`, le plugin les retient (`stickyPlay` sur l'entrée) et les
réimpose à chaque poll tant que `TrackURI` correspond — sinon la carte Médias affichait
« Lecture · 59e53e… ». Vérifié en réel (YouTube Music → Play:3 Cuisine et autres
enceintes). Sources : `mapping.ts : overlayStreamMeta`, `index.ts` (`stickyPlay`),
`../3_plugins/3_16_ytmusic.md`.

## Mise en route

Réglages → Plugins → Sonos. Décocher « Lecteur » chez le mock (déjà fait sur la maison réelle).
Aucune clé secrète. Sur une machine à plusieurs cartes, poser `SONOS_SSDP_INTERFACE` sur l'IPv4
du LAN si le multicast part ailleurs — sinon le bind par interface suffit. Variables :
`../5_setup/5_1_configuration-env.md`.

### Mise à jour 2026-09-22 — un Sonos ne met pas un flux HTTP en pause

> **En partie périmé le jour même** : le proxy ytmusic a changé de modèle l'après-midi (« fichier »
> MP3 de taille connue), ce qui retire deux des trois corrections ci-dessous. Voir
> « Mise à jour 2026-09-22 (2) » en bas de page. Les **constats** restent, eux, ce qui a été mesuré.

Ce qui suit vient d'une session passée devant l'enceinte **Bureau**
(`sonos:RINCON_00000000A00101400`), à piloter un flux MP3 servi par le proxy ytmusic. Rien de tout
cela ne se devine depuis la documentation UPnP.

**Constat 1 — le Sonos fait TOUJOURS deux GET sur un `play_url`.** Le premier part à la réception de
l'URI (`SetAVTransportURI`), **avant** le `Play` : c'est une sonde de format, aussitôt refermée, et
elle **n'est pas jouée**. Le second, 250–350 ms plus tard, est la vraie lecture. Un serveur qui
compte le temps entre les deux servait le second trop loin dans le morceau (côté proxy :
`PROBE_WINDOW_MS`, cf. `3_16_ytmusic.md`).

**Constat 2 — « pause » n'existe pas pour un flux HTTP.** Selon les cas le transport passe en
`PAUSED_PLAYBACK` ou en `STOPPED`, mais dans les deux la **connexion est fermée**. Et au `Play`
suivant, le Sonos tente de reprendre le « fichier » **à l'octet** où il en était : il sonde en `HEAD`,
ne trouve ni taille ni `Range`, et **s'arrête sans un son**. Il fallait appuyer deux fois sur lecture.

Trois corrections dans `index.ts`, toutes conditionnées à `stickyPlay` (donc à un flux que **nous**
avons posé) :

- `media_player.play` avec un transport ≠ `playing` → **`SetAVTransportURI` avec le même URI**, puis
  `Play`. Reposer l'URI fait repartir le Sonos de zéro côté HTTP ; c'est le **serveur** qui reprend le
  morceau à `playedS`, la position atteinte quand la connexion s'est fermée.
- `media_player.pause` qui échoue (un flux refuse la transition) → `Stop`. Même résultat, l'URI reste
  chargé.
- `media_player.stop` **oublie** `stickyPlay` : un arrêt voulu n'a plus à faire passer le flux pour
  « en pause ».

**Constat 3 — le sondage.** `STOPPED` avec notre URI, **ou avec un URI vide** (ce que le Sonos publie
juste après l'arrêt), est publié `paused` et **garde** titre, artiste et pochette : sinon tout
s'effaçait à la première pause (« Rien en lecture »). Seuls un **URI différent** ou un
`media_player.stop` explicite font oublier `stickyPlay`. Avant, la condition `patch.playback ===
'idle'` suffisait à l'oublier — c'était exactement le cas de la pause.

Test : `plugin.test.ts`, « keeps a stopped stream as paused with its title, until an explicit stop »
(il vérifie la **séquence** `SetAVTransportURI` → `Play`, et l'effacement après un stop demandé).

Sources : `apps/server/src/plugins/sonos/index.ts`, `apps/server/src/plugins/sonos/plugin.test.ts`,
`3_16_ytmusic.md`.

### Mise à jour 2026-09-22 (2) — le flux devient un fichier : deux corrections tombent

**Les trois corrections du constat 2 ci-dessus ne sont plus que deux, et le constat 3 est
périmé.** Le proxy ytmusic ne sert plus un flux vivant : il se présente comme un **« fichier » MP3
de taille connue, découpable par plages d'octets** (`3_16_ytmusic.md`, section du bas). Ce que le
Sonos cherchait à faire depuis le début — reprendre le fichier **à l'octet** où il en était — devient
donc possible, et c'est lui qui le fait.

Supprimé de `sonos/index.ts` :

- **le `SetAVTransportURI` reposé avant `Play`** (`media_player.play` avec un transport ≠
  `playing`). Une reprise est maintenant **un seul `Play`** : le Sonos redemande sa plage d'octets et
  le son repart. Plus besoin d'appuyer deux fois, plus besoin de repartir de zéro côté HTTP.
- **le mapping « `STOPPED` avec notre URI (ou un URI vide) = `paused` »**. Le Sonos met désormais un
  vrai `PAUSED_PLAYBACK` sur un fichier ; il n'y a plus à traduire un arrêt en pause, ce qui évitait
  d'effacer titre et pochette.

Conservé, parce que toujours vrai :

- **`media_player.pause` qui échoue → `Stop`** (un flux sans taille — un direct — refuse encore la
  transition, et le proxy sert toujours ce cas sans taille) ;
- **`media_player.stop` explicite oublie `stickyPlay`**.

**Et une correction nouvelle sur l'oubli de `stickyPlay`.** Le titre collé n'est plus oublié « au
repos » : il ne l'est **que lorsqu'un autre URI prend la place**. Motif mesuré sur l'enceinte : le
Sonos passe **une seconde à l'arrêt juste après avoir reçu l'URI**, avant le premier son — la
condition d'avant (`trackUri` absent ou différent, donc aussi « rien ne joue ») effaçait titre,
artiste et pochette dans cette fenêtre, et la carte montrait « Rien en lecture » pendant le
lancement. Au repos l'overlay ne s'applique de toute façon pas (rien ne joue) ; il revient intact si
le même URI repart.

Le test `plugin.test.ts` « keeps a stopped stream as paused with its title, until an explicit stop »
a été **supprimé** avec le mécanisme qu'il gardait ; le test des métadonnées collées
(« emits sticky title and art after play_url with meta ») reste.

Le **constat 1** (deux GET systématiques sur un `play_url`) reste un fait d'observation, mais il n'a
plus de conséquence : le premier GET est une sonde de format, et une sonde sur un fichier ne coûte
que les octets qu'elle lit. `PROBE_WINDOW_MS`, qui existait pour la neutraliser, n'existe plus.

Sources : `apps/server/src/plugins/sonos/index.ts`, `apps/server/src/plugins/sonos/plugin.test.ts`,
`3_16_ytmusic.md`.

## Mise à jour 2026-09-22 (2) — le marquage explicit doit être REPOSÉ à chaque relevé

**Symptôme** : le badge « E » s'allumait au lancement d'un titre explicit, puis s'éteignait tout seul
deux ou trois secondes plus tard, dans la barre comme dans les panneaux.

**Diagnostic** : le marquage était posé une fois, dans l'état émis par `media_player.play_url`. Chaque
sondage suivant reconstruit `nowPlaying` à partir de ce que dit l'enceinte — et une enceinte ne dit
jamais « explicit ». Le recouvrement collant (`overlayStreamMeta`, qui impose déjà titre / artiste /
pochette parce que Sonos oublie le DIDL d'un flux HTTP) ne reportait pas le champ.

**Solution** : `StreamMeta` porte `explicit`, et `overlayStreamMeta` le repose tant que l'URI collée
correspond. Même règle côté Cast, dans le `stickyPlay` de `mediaPatch`. Test : `mapping.test.ts`,
« keeps the explicit mark across polls ».

Règle générale : **tout ce qu'une enceinte ne sait pas dire doit être reposé à chaque relevé**, pas
seulement à l'émission — c'est déjà vrai du titre et de la pochette.

Sources : `apps/server/src/plugins/sonos/{mapping,index}.ts`,
`apps/server/src/plugins/google_cast/index.ts`, `../1_architecture/1_1_contrat-appareils.md`.

## Mise à jour 2026-09-23 — un direct déclaré par le service (`live`)

`streamLoad` distingue désormais deux notions que confondait une seule variable :

- **`hls`** — l'URL finit par `.m3u8` / `.m3u` ; décide seulement le type de contenu
  (`application/x-mpegURL`) ;
- **`live`** — `hls` **ou** `meta.live` venu de `media_player.play_url` ; décide la classe DIDL
  **`audioBroadcast`** (sinon `musicTrack`).

Avant, `live` n'était que `hls` : un Icecast en `.aac` (France Info) partait en `musicTrack` avec un
type `audio/mp4`, comme un fichier. `StreamMeta` porte `live`, émis dans l'écho immédiat de
`play_url` et **reporté par `overlayStreamMeta` à chaque sondage** tant que l'URI collée correspond —
même règle que pour `explicit` (section précédente) : sans ce report, le champ s'éteindrait au premier
sondage.

**Vérifié en direct le 2026-09-23** sur le Sonos « Bureau » avec
`http://icecast.radiofrance.fr/franceinfo-hifi.aac` : `nowPlaying.live: true` sur plusieurs sondages
successifs (lancé par le plugin `radio`, `3_19_radio.md`).

Sources : `apps/server/src/plugins/sonos/{mapping,index}.ts`, `apps/server/src/plugins/sonos/mapping.test.ts`,
`packages/shared/src/devices/command.ts`.

### Mise à jour 2026-10-23 — le relais `/art` ne rend qu'une image matricielle

Constat d'un audit de sécurité : `/art` rendait le corps de l'URL relayée avec le `Content-Type` choisi par
le serveur distant, sous l'origine de Kasbah. Un favicon de radio en `text/html`, ou une pochette
`image/svg+xml` (qu'un émetteur Cast du réseau peut annoncer dans son `MEDIA_STATUS`), s'exécutait en
ouvrant le lien, avec la session de la victime. Désormais (`apps/server/src/http/art.ts`, commun à Cast et
Sonos) : seules les adresses http(s) sont retenues (`isWebUrl`, ni `data:` ni `file:`), seuls les types
matriciels passent (`isRasterImage` : jpeg, png, gif, webp, avif, bmp, icône ; **pas** SVG, sinon 415 puis
502), et la réponse porte `X-Content-Type-Options: nosniff` et `Content-Security-Policy: default-src 'none';
sandbox` (`sendArt`). Une balise `<img>` n'en est pas gênée.
