# Lecteur musique commun (`/api/music`)

> Dernière mise à jour : 2026-11-07
> Sources : `apps/server/src/music/{player,proxy,queue,sources,ytdlp}.ts`, tests `apps/server/src/music/{proxy,queue}.test.ts`, `apps/server/src/plugins/ytmusic/plugin.test.ts`, `apps/server/src/app.ts`, `apps/server/src/plugins/{ytmusic,mixcloud}/{index,resolve}.ts`, `apps/server/.env.example`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/stores/localPlayer.ts`, `apps/web/src/views/MusicView.vue`, arbre de travail non commité du 2026-09-23 (après 5c43833) ; `apps/server/src/music/lastPlayed.ts` et son test, `apps/web/src/stores/localPlayer.test.ts`, arbre de travail non commité du 2026-09-28 (après c6fe7c1) ; `apps/server/src/music/lightsync/{analyze,decode,effects/*,palette,settingsFile,sync}.ts`, `packages/shared/src/music/lightsync.ts` et leurs tests, `apps/server/src/core/lightStreamBridge.ts`, `apps/web/src/components/music/ListeningSessions.vue` (2026-11-05)

## Pourquoi un noyau, et pourquoi maintenant

Jusqu'au 2026-09-23, tout ce qui fait « jouer une piste sur une enceinte » vivait dans le plugin
YouTube Music : proxy LAN (relais brut ou repli MP3 à trames fixes), file d'attente côté serveur, fin
de piste reconnue par la position, transfert d'une enceinte à l'autre, écoute locale dans le
navigateur (`../3_plugins/3_16_ytmusic.md`, sections du 2026-09-22 et (12)). Rien de tout cela n'est
propre à YouTube : c'est la mécanique d'un « fichier » servi à une enceinte qui ne sait rien d'autre.

La décision d'extraire avait été prise **au moment de Mixcloud, pas avant**
(`../3_plugins/3_19_radio.md`, « Suite : Mixcloud ») : la radio n'en avait pas l'usage (le flux va de
la station à l'enceinte, sans relais ni file), Mixcloud si — sa sonde montrait un m4a de taille connue
et découpable par plages, exactement le profil du relais brut. Mixcloud arrivant
(`../3_plugins/3_20_mixcloud.md`), le cœur de ytmusic est sorti dans `apps/server/src/music/`, à la
demande de l'utilisateur. Une source ne fournit plus que **son catalogue et le flux d'une piste** ;
tout le reste est ici.

## Ce qui est où

| Fichier | Rôle |
|---|---|
| `music/player.ts` | `createMusicPlayer` : routes `/api/music/*`, files par lecteur, lancement, transfert, écoute locale, progression. Ex-cœur de `plugins/ytmusic/index.ts`. |
| `music/proxy.ts` | `StreamProxy` : sessions, relais brut, repli ffmpeg MP3 320 kb/s à trames fixes, plages d'octets. **Déplacé par `git mv`** depuis `plugins/ytmusic/stream.ts` (la résolution yt-dlp propre à YouTube en est sortie vers `plugins/ytmusic/resolve.ts`). |
| `music/queue.ts` | Logique pure de la file (`afterEnd`, `upcoming`, `insert`, `jumpTo`, `removeAt`, `REPEAT_MODES`). Déplacé depuis `plugins/ytmusic/queue.ts`. |
| `music/sources.ts` | Registre des sources : `registerMusicSource`, `getMusicSource`. |
| `music/ytdlp.ts` | `runCapture` : lancer yt-dlp et lire sa sortie, commun à ytmusic et Mixcloud ; les arguments et le choix de format restent à chaque source. |

Monté dans `apps/server/src/app.ts` **après** le pont de lecture (`core/playbackBridge.ts`,
`1_2_serveur-et-plugins.md`), par lequel il envoie `play_url` / `seek` / `pause` / `stop` aux
lecteurs Cast et Sonos : `createMusicPlayer({ config: musicConfigSchema.parse(env), logger, now })`,
routes sous `MUSIC_PREFIX = '/api/music'`, `music.stop()` à la fermeture. Ce n'est **pas un plugin** :
il n'a ni santé, ni activation, ni réglages ; il existe dès que le serveur tourne, et ne sert que les
sources inscrites.

## Le contrat d'une source

```ts
registerMusicSource({ id, label, prepare?, resolve(id) → ResolvedStream, playArt?, onProgress? })
  → () => void   // de quoi se retirer
```

- `id` = id du plugin, repris dans chaque piste ; `label` pour les messages.
- `prepare()` — avant toute résolution ; lève une `PluginError` si la source ne peut pas servir
  (ytmusic : cookie absent ou expiré, générateur PO Token injoignable). Absent = toujours prête
  (Mixcloud).
- `resolve(id)` — où est le flux : `{ url, formatId, ext, abrKbps, sizeBytes, durationS }`. Plusieurs
  secondes (yt-dlp) : le lecteur résout la **suivante** d'avance pendant que la courante joue
  (`prefetchUpcoming`, gardée une heure). Une erreur non `PluginError` ressort en `UPSTREAM_ERROR`.
- `playArt(url)` — la pochette montée à la taille des écrans (ytmusic : 544 px, `ART_PLAY_SIZE`).
- `onProgress(id, positionS, durationS, ended)` — **nouveau** : voir plus bas.

*(Signatures dépassées le 2026-10-07 : chaque méthode reçoit en plus le compte pour lequel elle travaille — `prepare(user)`, `resolve(id, user)`, `onProgress(id, positionS, durationS, ended, user)`, `user: MusicUser = string | null`, `null` = la maison. Voir la mise à jour du 2026-10-07 en bas de page.)*

Un plugin s'inscrit à `init` et se retire à `stop` (la fonction rendue ne retire que **sa** source,
pas une autre inscrite depuis sous le même id). Une piste dont la source n'est pas inscrite — plugin
désactivé, ou coupé entre deux titres — est refusée en **400 `UNSUPPORTED_COMMAND`**
(`music source "x" is not enabled`), vérifiée sur **toutes** les pistes d'une file avant de lancer
quoi que ce soit.

## Une piste = `{ source, id }`

Le `videoId` de ytmusic disparaît de l'API : une piste est `{ source, id }` plus ce que le catalogue en
dit (`title`, `artist`, `artUrl`, `durationS`, `explicit`) et, nouveau, **`startS`**. Les sessions
(`GET /sessions`) et les files rendent la même forme. Côté web, les types suivent : `MusicTrack`,
`MusicSession`, `MusicQueue`, `MusicRepeat`, `MusicStreamQuality` (ex-`Ytmusic*`), cf.
`1_4_app-web.md`.

## Routes

Toutes sous `/api/music`. Les chemins et comportements sont ceux qu'avait ytmusic sous
`/api/plugins/ytmusic/` (détail des sections datées de `../3_plugins/3_16_ytmusic.md`), portés à
l'identique, sauf les ajouts signalés.

| Méthode | Chemin | Rôle |
|---|---|---|
| `POST` | `/play` | `{ source, id, deviceId, …piste, raw? }` : une file d'une piste ; `raw: false` force le repli MP3 |
| `POST` | `/local` | `{ …piste, clientId, next?: { source, id } }` : écoute dans le navigateur, chemin rendu **relatif** ; `next` résolue d'avance |
| `POST` / `GET` / `DELETE` | `/queue` | nouvelle file (1 à 1 000 pistes, `startIndex?`) / la file d'un lecteur / la vider (la piste courante continue) |
| `POST` | `/queue/{add,next,previous,jump,repeat,remove}` | piloter la file |
| `GET` | `/sessions` | ce que les enceintes jouent de nous en ce moment (`sessionActive`) |
| `POST` | `/transfer` | enceinte ↔ enceinte ↔ navigateur, à la position, file emportée |
| `POST` | `/progress` | **nouveau** : `{ source, id, positionS, durationS?, ended? }` rapporté par un navigateur |
| `HEAD` / `GET` | `/raw/:file` | relais brut (`<sid>.<ext>`, l'extension renseigne le DIDL Sonos) |
| `HEAD` / `GET` | `/stream/:sid` | repli MP3 à trames fixes |

`MUSIC_PUBLISH_BASE` : base publiée aux enceintes (elles refusent 127.0.0.1) ; vide = dérivée de
l'en-tête `Host` du navigateur, erreur explicite si l'UI parle en localhost. **Repli sur
`YTM_PUBLISH_BASE`**, l'ancien nom, pour ne pas casser un `.env` existant. `FFMPEG_PATH` (repli MP3)
reste la clé commune non préfixée. Voir `../5_setup/5_1_configuration-env.md`.
*(Précisé le 2026-10-06 : la base est aussi refusée sous l'adresse publique du proxy inverse — voir la mise à jour du 2026-10-06 (soir) en bas de page.)*

## Ce qui est nouveau

### `startS` : partir d'une position

Pour reprendre un mix de plusieurs heures. Sur une enceinte, la piste est lancée normalement
(`play_url`), puis `seekWhenReady` envoie `media_player.seek` — jusqu'à cinq essais espacés de
600 ms, l'enceinte refusant parfois la première commande tant qu'elle charge. Le saut n'est tenté que
si la session a une **taille connue** (`lengthBytes !== null`) : sans taille, l'enceinte ne peut pas
se déplacer dans le « fichier ». Un échec du saut n'arrête pas la lecture : on joue du début, avec un
avertissement au journal.

**La reprise ne vaut qu'au premier lancement** : aussitôt jouée, la piste est réécrite dans la file
**sans** `startS`. Rejouée par la répétition ou par « précédent », elle repart du début — sinon une
répétition d'un mix le relancerait éternellement au milieu. Même règle dans le navigateur
(`localPlayer.playQueue` retire `startS` des pistes de la file après avoir lu celui de la piste
lancée).

### `onProgress` : dire où on en est à la source

Aucune enceinte n'annonce la fin d'un titre ni ne mémorise une position pour plus tard. Le lecteur
surveillait déjà les états publiés pour reconnaître une fin de piste ; il en profite pour prévenir la
source :

- à chaque relevé d'enceinte où la **position a bougé** (un état republié pour le volume garde
  l'ancienne position : il ne compte pas) → `onProgress(id, pos, durée, false)` ;
- à la **fin naturelle** reconnue (idle après une position estimée à moins de `END_SLACK_S` = 5 s de
  la durée) → `onProgress(id, durée, durée, true)`, avant d'enchaîner ;
- dans le **navigateur**, que le serveur ne voit pas jouer, `localPlayer` appelle
  `POST /api/music/progress` **toutes les 15 s** et à la fin (`ended: true`) ; un envoi perdu est
  ignoré (« la reprise est un confort »). Le mock ne fait rien.

Seul Mixcloud s'en sert aujourd'hui (positions de reprise, `../3_plugins/3_20_mixcloud.md`).
ytmusic ne déclare pas `onProgress`.

## Ce qui est porté à l'identique

Relais brut par défaut / repli MP3 à trames fixes, file côté serveur et répétition du titre, fin de
piste par la position, préchargement de la suivante, transfert à la position (+ 1 s d'avance à la
cible) avec la file, écoute locale `local:<clientId>`, `sessionActive` (une session proxy survit à ce
que l'enceinte joue ensuite ; le Sonos publie parfois le **nom de fichier** `<sid>.m4a` comme titre).
Les raisons de chacun de ces choix restent documentées là où ils sont nés :
`../3_plugins/3_16_ytmusic.md`, sections du 2026-09-22 (1) à (5) et (12).

Les tests de lecture YouTube Music sont **restés** dans `apps/server/src/plugins/ytmusic/plugin.test.ts`,
réacheminés sur `/api/music` avec des scénarios inchangés — c'est ce qui garantit que le portage n'a
rien changé. D'après le thread principal : 56 tests verts. `proxy.test.ts` et `queue.test.ts` ont
suivi leurs fichiers.

## Changement de comportement : le cookie ne ferme plus les sessions

Avant l'extraction, `DELETE /api/plugins/ytmusic/cookie` appelait `proxy?.clear()` : vider le cookie
coupait les sessions de lecture en cours (cf. `git show 5c43833:apps/server/src/plugins/ytmusic/index.ts`).
Le proxy n'appartenant plus au plugin, **vider le cookie ne ferme plus rien** : un titre déjà relayé
continue jusqu'au bout ; seules les résolutions suivantes échouent (`prepare` lève `NEEDS_PAIRING`).

## Vérifié en direct (2026-09-23)

D'après le thread principal : d'un Sonos à un autre, relais m4a AAC 258 kb/s, seek, transfert à la
position. Mixcloud sur Sonos : voir sa page.

## Piège dans le code (signalé, non corrigé)

Le commentaire d'en-tête de `apps/server/src/music/proxy.ts` dit encore que le relais passe par
« `index.ts` route `/raw` » : depuis l'extraction, la route `/raw/:file` est dans `music/player.ts`.

*(Corrigé, constat du lint du 2026-10-06 : l'en-tête de `proxy.ts` pointe désormais `player.ts` (route `/raw`).)*

## Mise à jour 2026-09-28 — la dernière écoute survit à un redémarrage

**Le problème.** Files et sessions vivent en mémoire : un redémarrage du serveur (ou un `tsx watch`
qui recharge) les perd, et l'enceinte garde une URL morte. La barre ne savait plus rien montrer de ce
qu'on écoutait, et un mix de trois heures était à rechercher à la main. La reprise par mix de
Mixcloud (`../3_plugins/3_20_mixcloud.md`) ne suffit pas : elle retient **où** on en est dans un mix,
pas **ce que jouait quelle enceinte**, ni la file autour.

**Ce qui est gardé** — `apps/server/src/music/lastPlayed.ts`, fichier `.state/music.json`
(`MUSIC_STATE_FILE`, défaut `stateFile('music.json')`, écrit en `.tmp` + rename, relu par un schéma
zod qui rejette tout le fichier s'il est illisible) : **par lecteur**, la file (pistes **sans**
`startS`, même règle que plus haut : une reprise ne vaut qu'au premier lancement), l'index, la
répétition, la position atteinte, la durée, l'heure (`at`). Rien pour ce navigateur (`local:*`), qui
tient la sienne lui-même (voir plus bas).

**Quand c'est écrit** (`remember`, `rememberQueue`, `forget`, `saveLast` dans `music/player.ts`) :

- au **lancement** d'une piste (`playAt`), position = `startS` ou 0 ;
- à chaque **mutation de file** — ajout, retrait, répétition, vider — par `rememberQueue`, qui garde
  la position déjà connue (la piste n'a pas changé) ;
- au **transfert** : la source est oubliée, la cible enregistrée à la position du transfert (file
  emportée, ou à défaut la piste de la session telle qu'elle joue, `trackOfSession`) ; **vers un
  navigateur**, la source est seulement oubliée — c'est lui qui tient l'écoute ;
- la **position**, à chaque relevé d'enceinte où elle a bougé. Sur disque **au plus toutes les 15 s**
  (`LAST_SAVE_MS`), une position arrivant à chaque relevé — **sauf si c'est une action** : l'écart à
  la position attendue (dernier relevé + temps écoulé) dépasse `END_SLACK_S` (5 s), soit une reprise
  après pause, soit un saut dans le morceau ; et un relevé **en pause** s'écrit tout de suite. Demande
  de l'utilisateur : la position retenue doit être celle **de la dernière action**, pas celle d'il y a
  15 s ;
- à `music.stop()` (arrêt du serveur), le minuteur en attente est vidé et le fichier écrit aussitôt.

**Quand c'est oublié** : seulement à la **fin naturelle de la file** (`advance` sans suivante) — il
n'y a plus rien à reprendre. Un stop de l'enceinte ou un redémarrage **gardent** l'entrée : c'est
précisément le cas qu'elle sert.

**Deux routes :**

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/last` | Dernière écoute des lecteurs **sans session vivante** (`sessionActive`) : `{ deviceId, track, positionS, durationS, queue: { length, index, repeat }, at }`. Un lecteur qui joue encore de nous n'y figure pas : sa session le dit mieux. |
| `POST` | `/resume` | `{ deviceId, positionS? }` : relance la file à son index, la piste courante avec `startS` = `positionS` (ou la position retenue), répétition restaurée ; 404 `NOT_FOUND` s'il n'y a rien à reprendre. Même chemin que `/queue` (`playQueue`), donc même saut après `play_url` que la reprise d'un mix. |

Transport web : `musicLast()`, `musicResume(deviceId, positionS?)`, type `MusicLastPlayed` ; le mock
rend une liste vide et lève `501` à la reprise. La barre qui s'en sert :
`../4_ui/4_1_navigation-et-panneaux.md`, section du 2026-09-28.

**Tests** (`apps/server/src/music/lastPlayed.test.ts`, stockage en mémoire `memoryLastPlayed`) :
reprise après redémarrage à la position, reprise à une position choisie, pause et saut écrits
aussitôt (pas 15 s plus tard), oubli en fin de file. 4 tests verts, relancés à l'ingestion.

**Ce navigateur** a désormais la même mémoire, dans `localStorage` et non sur le serveur : voir
`1_4_app-web.md`, section du 2026-09-28.

### Mise à jour 2026-10-06 (soir) — `publishBase` refuse l'adresse publique

Une enceinte Cast ou Sonos ne peut pas lire l'adresse publique du proxy inverse : elle exige une session
qu'une enceinte n'a pas. Quand `MUSIC_PUBLISH_BASE` est vide, `publishBase` dérive la base de l'en-tête
`Host` du navigateur ; sous un nom public (`createMusicPlayer` reçoit `publicHosts`, test
`isPublicRequest`), il lève maintenant l'erreur « MUSIC_PUBLISH_BASE required when the UI is opened
through the public address (Cast/Sonos need the LAN IP) » — même logique que pour `localhost`. Fixer la
variable règle les deux. Les outils MCP (`play_music`) passent par `app.inject` sous `localhost` et ne
sont pas touchés. Tests : `apps/server/src/music/player.test.ts` (2). Voir `1_7_serveur-mcp.md` (même
date).


### Mise à jour 2026-10-07 — chaque file porte le compte de qui l'a lancée

**Pourquoi.** Demande de l'utilisateur : « maintenant qu'on a des utilisateurs, chacun doit avoir accès à
ses propres comptes musicaux », sans abîmer l'historique d'un autre ni celui de la maison. Ce qui se
mélangeait n'était pas l'historique de lecture (yt-dlp n'utilise pas `--mark-watched` : une lecture ne
s'inscrit pas chez YouTube) mais les recherches et recommandations du compte YouTube commun, et surtout
les positions de reprise Mixcloud tenues par Kasbah. Le lecteur est le point où se décide « avec quels
comptes » : il le décide une fois par file.

**Le compte.** `MusicUser = string | null` (`apps/server/src/music/sources.ts`) : le nom d'un utilisateur,
ou `null` = la maison. `musicUserOf(req)` = `req.sessionUser ?? null`. Une session n'existe que sous
l'adresse publique (`1_7_serveur-mcp.md`) : sur le réseau local, et pour les écrans fixes, on est
toujours « la maison ». Les trois méthodes du contrat reçoivent ce compte (voir le renvoi plus haut).

**La file garde son compte.** `RunningQueue` (`player.ts`) retient `user` : celui de la requête qui l'a
lancée (`/play`, `/queue`, `/queue/add` sans file vivante, `/local`). Les pistes suivantes se résolvent
avec CES comptes et la progression lui est rapportée, **même si l'écran de la maison appuie sur suivant,
précédent, saut ou ajout** : celui qui pilote ne change pas le compte de la file. Sinon un appui sur
l'écran du salon ferait chercher le titre suivant avec le compte commun, et inscrire une position
Mixcloud dans la mauvaise reprise.

**Préchargement par compte.** La clé du flux résolu d'avance est `<user>|<source>:<id>` : un flux résolu
pour un compte ne sert jamais à un autre (un flux résolu avec le cookie de la maison ne sort pas pour
un compte anonyme, et inversement). Test négatif fait : retirer le préfixe fait rougir
`apps/server/src/music/accounts.test.ts`.

**Les autres routes.** `/progress` prend le compte de la requête. **`/resume`** aussi : « relancer, c'est
lancer », donc avec les comptes de qui relance, et non ceux de la file d'origine. **`/transfer`** garde
le compte de la file emportée ; une file venue d'un navigateur (qui n'en a pas) prend celui de la
requête.

**Ce qui reste commun.** La « dernière écoute » de chaque enceinte (`.state/music.json`, section du
2026-09-28) : décidé le 2026-10-07 sans objection, elle reste celle de la maison ; elle ne porte pas
le compte.

**Tests** (`apps/server/src/music/accounts.test.ts`, 3) : la file garde le compte de qui l'a lancée ;
un flux préchargé n'est jamais donné à un autre compte ; la progression d'un navigateur est notée pour
son compte. Contrôle négatif fait sur le préchargement seulement (ci-dessus).

Sources : `apps/server/src/music/{player,sources}.ts`, `apps/server/src/music/accounts.test.ts`. Les
comptes eux-mêmes, par plugin : `../3_plugins/3_16_ytmusic.md` et `../3_plugins/3_20_mixcloud.md`.

Sources : `apps/server/src/music/player.ts`.

### Mise à jour 2026-10-09 — la file et les sessions pilotées par le MCP

Le serveur MCP expose désormais le lecteur commun (`1_7_serveur-mcp.md`) : `get_music` (`/sessions`, `/last`, et la
file indexée par `/queue` avec un `deviceId`), `queue_music` (`POST /queue/add`, `where` `next` ou `end`, sans
interrompre, démarre si rien ne joue) et `control_music` (`next`, `previous`, `jump`, `remove`, `repeat`, `clear`,
`resume`, `transfer`, sur les routes `/queue/*`, `/resume`, `/transfer`). Les modes de répétition sont
`REPEAT_MODES` de `music/queue.ts` (off / once / loop). Tous au nom du compte du jeton. Conséquence : la limite du
2026-09-23 (`media_player.next` / `previous` ne sautent pas dans la file) a désormais un chemin par MCP.

Sources : `apps/server/src/mcp/server.ts`.

### Mise à jour 2026-11-05 — lumières de la pièce en rythme avec la musique

Ce que le lecteur joue sur une enceinte peut piloter les lampes Hue de la même pièce, par le flux
Entertainment du pont ([3_1 Philips Hue](../3_plugins/3_1_philips-hue.md), mise à jour du même jour).
L'enceinte ne renvoie jamais le son : le serveur **relit la même source** et l'analyse.

**Périmètre v1 : YouTube Music et Mixcloud**, les sources qui passent par le proxy : l'URL d'origine est
dans `proxy.forDevice(id).sourceUrl` et la position de l'enceinte est connue, donc l'alignement est
automatique. La radio est laissée pour plus tard : `plugins/radio` envoie l'URL de la station
directement à l'enceinte (pas de session), et un direct n'a pas de position — il faudrait un réglage
de délai à l'oreille.

**Analyse** (`lightsync/decode.ts`, `analyze.ts`) : un second ffmpeg lit `sourceUrl` (`-ss` avant `-i`)
en PCM mono flottant à 12 kHz, **plus vite que le temps réel** (pas de `-re`) : les caractéristiques
devancent l'enceinte. `FeatureExtractor` calcule toutes les 20 ms (240 échantillons) l'énergie de trois
bandes (30-150 Hz, 150-2000 Hz, 2-6 kHz) par une FFT radix-2 maison de 512 points, et une **attaque**
(flux spectral au-dessus de 1,5 × sa moyenne de la dernière seconde, plancher contre le souffle). Rien
du PCM n'est gardé au-delà d'une fenêtre : un mix de plusieurs heures coûte quelques Mo. Mesuré sur le
poste : 3 min de son décodées et analysées en 0,9 s (~0,7 s de processeur).

**Orchestration** (`lightsync/sync.ts`, `LightSync`, créé dans `createMusicPlayer`) :
- Interrupteur **par enceinte**, en mémoire (perdu au redémarrage) ; un pont ne diffuse qu'une zone, donc
  **une enceinte à la fois** : en allumer une autre éteint la première.
- Interrupteur allumé : le flux s'ouvre quand l'enceinte joue un de nos flux (`sessionActive`), se ferme
  après **5 s** de pause ou d'arrêt ; l'interrupteur reste pour le morceau suivant. Échec d'ouverture ou
  flux coupé par le pont : nouvel essai 10 s plus tard.
- Boucle de 20 ms : position de l'enceinte (`positionS` + temps écoulé depuis `updatedAt`) sur une
  **horloge locale**, recalée seulement au-delà de 1,2 s d'écart (saut, reprise, nouveau morceau) ; les
  caractéristiques sont lues 0,1 s en avance (latence pont + Zigbee). Nouveau `sid` (la file passe au
  suivant) ou saut hors de ce qui est décodé → le décodage repart de la nouvelle position.
- Effet unique `PulseEffect` (`effect.ts`) : luminosité qui suit les basses rapportées à leur propre
  crête récente (attaque immédiate, retombée de 0,25 s, jamais sous 12 %), palette chaude répartie de
  gauche à droite selon la position des canaux, couleurs permutées sur une attaque franche.
- Limite connue : un Sonos publie sa position en secondes entières, d'où jusqu'à ~1 s de retard ; le
  Cast donne une position fine.

**La pièce** : `app.ts` passe `roomLights(deviceId)`, calculé sur la maison effective
(`HouseView`, placement automatique compris, invalidé sur l'événement `devices`) : les lampes rangées
dans la même pièce que l'enceinte. Le plugin Hue choisit ensuite la zone de divertissement.

**Routes** (droit `media`, comme tout `/api/music`) : `GET /api/music/lightsync?deviceIds=a,b` rend pour
chaque enceinte `{ available, reason?: 'no_hue' | 'no_room' | 'no_area', area?, on, active }` ;
`PUT /api/music/lightsync/:deviceId { on }` (409 là où la pièce ne peut pas). Interface : une touche
ampoule sur les lignes de la carte Écoute ([4_5 Musique et médias](../4_ui/4_5_musique-et-medias.md)).

Vérifié : tests `lightsync/{analyze,sync}.test.ts` (signal synthétique, faux flux et fausse horloge :
démarrage, pause, morceau suivant, saut, passage d'une enceinte à l'autre, reprise après coupure),
route dans `player.test.ts`, flux réel sur le pont par la sonde. **Pas encore vérifié** : la chaîne
complète avec de la musique sur une vraie enceinte.

Vérifié le même soir sur la vraie maison, une fois le serveur redémarré avec `HUE_APP_KEY` et
`HUE_CLIENT_KEY` issus du réappairage : un morceau lancé par Kasbah sur une enceinte Cast, touche
ampoule de la carte Écoute, la lampe de la zone de divertissement de la pièce suit la musique.
Constat de l'utilisateur : ça marche, mais on ne règle rien (palette, ambiance, effet) — suite à venir.

### Mise à jour 2026-11-05 (soir) — les réglages : effet, couleurs, ambiance, luminosité

Demande de l'utilisateur après la première vérification : « on ne peut pas contrôler grand chose. on
veut peut être une gamme de couleur différente, un mood différent, des effets différents ». Inspiration
annoncée : Hue Sync (sa page publique parle d'un réglage d'immersion « de normal à intense », de la
luminosité et de presets de couleurs, sans plus de détail).

**Contrat partagé** (`packages/shared/src/music/lightsync.ts`) : `LIGHTSYNC_EFFECTS` (`pulse`, `wave`,
`spectrum`, `strobe`, `breathe`), `LIGHTSYNC_PRESETS` (six palettes hex : chaud, froid, néon, forêt, océan,
arc-en-ciel — la même table sert au serveur et aux pastilles de l'écran), `lightSyncSettingsSchema`
(`effect`, `palette` = preset | scène `{ sceneId }` | perso `{ colors: 2 à 5 hex }` | pochette, `energy`
0..1, `brightness` 0,1..1), défaut = le comportement d'avant (pulsation, chaud, 0,5, 1).

**Par pièce** : les réglages sont ceux de la pièce de la maison (deux enceintes d'une pièce les
partagent), gardés dans `.state/lightsync.json` (`settingsFile.ts`, patron de `lastPlayed.ts` ; une entrée
illisible retombe seule aux défauts). `app.ts` fournit `room(deviceId)` (même `HouseView` que
`roomLights`) et `sceneColors(sceneId)` (`swatches` du `SceneRegistry`).

**Effets** (`lightsync/effects/`) : interface commune `next(frame, dtS)` + `configure(params)` qui change
les paramètres **sans remettre l'état à zéro** (réglage en direct sans à-coup ; changer d'effet en crée
un nouveau). Briques partagées (`common.ts`) : bande rapportée à sa propre crête récente, enveloppe,
fondu de couleur par canal, front montant d'une attaque, échantillonnage interpolé de la palette.
`energy` déplace tout de façon monotone (retombée 0,6 → 0,12 s, plancher 25 → 5 %, contraste, seuil et
écart des changements de couleur, vitesse) :
- Pulsation : l'effet de la première version, paramétré.
- Vague : la palette défile de gauche à droite, poussée par le niveau.
- Spectre : canaux triés par `x` répartis basses / médiums / aigus ; une bande n'est jamais lue contre
  moins de 15 % de la crête de la bande la plus forte — sinon une bande presque vide, rapportée à sa
  propre crête minuscule, s'allumait en plein (attrapé par le test « les basses à gauche »).
- Strobo : noir (lueur de 8 % en calme) et éclair de 80 ms de la couleur suivante sur une attaque franche.
- Respiration : niveau global lissé sur 1,5 à 4 s dans les deux sens, palette qui glisse.

**Palettes** (`palette.ts`) : la **pochette** vient de `ProxySession.meta.artUrl` (l'URL d'origine, pas
le relais Cast) ; `fetch` (2 Mo, 5 s), puis le **ffmpeg déjà présent** la réduit en 16 × 16 RGB brut
(`-f rawvideo -pix_fmt rgb24`, aucune bibliothèque d'image), puis `dominantColors` : seaux de teinte
pondérés par saturation × valeur, gris et noirs écartés, teintes voisines comptées une fois, couleurs
poussées à pleine saturation ; une seule teinte → une voisine à 40° ajoutée ; pochette grise → rien,
repli. Mesuré : 107 ms pour une image générée. Cache par URL ; au changement de morceau, les couleurs du
morceau précédent restent tant que la nouvelle pochette n'est pas lue (pas de saut vers la palette par
défaut).

**Route** : `PUT /api/music/lightsync/:deviceId/settings` (patch partiel, 400 si invalide, 409 sans pièce) ;
`GET /api/music/lightsync` rend en plus `room`, `settings` et `palette` (couleurs effectives, pochette
comprise). Panneau : [4_5 Musique et médias](../4_ui/4_5_musique-et-medias.md).

Vérifié : `effects/effects.test.ts` (chaque effet borné et qui s'apaise, retombée plus courte en
énergique, couleurs passées sur une attaque, réglage en direct, vague plus rapide, spectre, strobo
sombre entre deux attaques, respiration sans saut), `palette.test.ts` (sources, dominantes sur pixels
synthétiques, faux `fetch` / ffmpeg), réglages dans `sync.test.ts` (défauts, partage par pièce,
persistance, application en direct, scène, pochette par morceau) et route dans `player.test.ts`. Pas
encore jugé à l'œil sur la vraie lampe.

### Mise à jour 2026-11-05 (nuit) — la synchro qui s'arrête : reprise et motif affiché

Même constat que la mise à jour du même jour de [3_1 Philips Hue](../3_plugins/3_1_philips-hue.md) ;
sans les logs du serveur, et sans pouvoir reproduire YouTube sur le poste (pas de générateur de PO Token
local), deux angles morts corrigés à l'aveugle :
- **Analyse coupée en cours de morceau** : le second ffmpeg n'avait jamais été essayé sur un vrai flux
  YouTube (le plugin connaît une coupure après le premier Mo). Avant, une analyse en échec passait pour
  une fin de morceau : lumières figées jusqu'au morceau suivant. `Decoding.failed` distingue l'échec de la
  fin ; quand l'analyse ne couvre pas la position de l'enceinte (échec, ou retard de plus de 8 s), elle
  repart de cette position après 2 s, puis 4, 8… jusqu'à 30 s (journal `lightsync: sound analysis behind
  the speaker`). ffmpeg reçoit `-reconnect` (HTTP seulement : il refuse ces options pour un fichier) et
  reprend une connexion coupée par plage.
- **Motif visible** : `status.problem` = `stream` (flux ouvert en échec ou terminé par le pont, nouvel
  essai) ou `decode` (l'analyse ne suit pas, d'après ce qui est observé et non un compteur). Ampoule
  orange avec le motif en infobulle, ligne réservée dans le panneau. Rallumer l'interrupteur relance
  aussitôt, sans attendre les 10 s.

Vérifié : `sync.test.ts` (reprise avec délais croissants, pas de reprise en fin normale, motif `stream`
puis relance immédiate), ffmpeg réel par HTTP depuis 0 et 60 s avec les options de reconnexion, source
injoignable marquée en échec ; preview : motif affiché sans rien déplacer, une ligne en fr / en sur
téléphone. **Cause réelle non confirmée** : à vérifier avec `grep -i lightsync logs/kasbah.log` au prochain arrêt.

### Mise à jour 2026-11-05 (nuit, suite) — le motif exact affiché, sans les logs

`status.problemDetail` porte l'erreur derrière `problem` : la raison donnée par le pont ou la couche DTLS
pour `stream`, la dernière ligne de ffmpeg pour `decode` (`Decoding.error`, l'URL de la source — longue et
signée — remplacée par « source » pour que la raison reste lisible, par ex. « source: Server returned 403
Forbidden »). Affiché sur une seconde ligne réservée du panneau, en petit, et dans l'infobulle de
l'ampoule : l'utilisateur peut le lire sans aller dans les logs du serveur. Cause de l'arrêt signalé à
la réactivation : voir la mise à jour du même jour de [3_1 Philips Hue](../3_plugins/3_1_philips-hue.md).

### Mise à jour 2026-11-06 — une troisième source du relais brut : les podcasts

Le plugin Podcasts (`../3_plugins/3_28_podcasts.md`) s'inscrit comme source du lecteur commun
(`id: 'podcasts'`, `resolve` + `onProgress`). Deux conséquences pour le noyau :

- **Le relais brut accepte le MP3** : `RAW_MIME` (`apps/server/src/music/player.ts`) gagne
  `mp3: 'audio/mpeg'`, une seule ligne. Avant, un MP3 de taille connue n'avait pas de type de relais brut
  et passait par le **repli ffmpeg** (ré-encodage en MP3), sans déplacement possible ; il est maintenant
  relayé tel quel, par plages. Le profil qui compte reste « fichier direct, taille et `accept-ranges` connus ».
- **`onProgress` n'est plus propre à Mixcloud** : la phrase « Seul Mixcloud s'en sert aujourd'hui »
  (section « `onProgress` », plus haut) est **datée**, Podcasts s'en sert aussi, pour la reprise et pour
  l'état « écouté » de chaque épisode (mêmes règles de reprise que Mixcloud, fonctions importées de
  `plugins/mixcloud/store.ts`).

**Lumières en rythme** (section du 2026-11-05) : les podcasts passent par le proxy comme YouTube Music
et Mixcloud, donc la synchro devrait aussi marcher. **Déduit du code, non vérifié sur une vraie lampe.**
La phrase « Périmètre v1 : YouTube Music et Mixcloud » est de même datée.

### Mise à jour 2026-11-06 — lumières en rythme pour « Ce navigateur » : la pièce est choisie

Demande de l'utilisateur : quand la musique joue **dans le navigateur** (écoute locale,
`local:<clientId>`), pouvoir choisir la cible des lumières, **quelle que soit la pièce où se trouve
l'appareil** (synchroniser le salon depuis l'ordinateur du bureau). Deux choses manquaient : le
navigateur n'a pas de place dans la maison, et le serveur ne le voit pas jouer.

**La pièce est choisie, pas déduite** (`lightsync/sync.ts`) : `setRoom(deviceId, roomId | null)` range
le choix dans `chosenRooms` (en mémoire, comme l'interrupteur) ; `roomOf` / `lightsOf` prennent la
pièce choisie avant la place dans la maison, et tout le reste (zone, réglages de la pièce, palette de
scène) suit sans cas particulier. Deux dépendances de plus, fournies par `app.ts` sur la même
`HouseView` : `rooms()` et `lightsOfRoom(roomId)`. `roomChoices()` ne propose que les pièces dont les
lampes ont une zone de divertissement (`areaFor`). Changer de pièce pendant la diffusion ferme le flux ;
l'interrupteur reste, le tick suivant ouvre la zone de la nouvelle pièce ; une pièce sans zone éteint
l'interrupteur. Écarté : choisir directement une zone Hue — les réglages sont par pièce, et la pièce
est ce que l'utilisateur nomme.

**Où en est le morceau** (`player.ts`) : le navigateur le dit lui-même, `POST /api/music/local/state
{ clientId, playback, positionS }`, sur `playing` (chaque nouveau morceau compris : la lecture ne
change pas d'état d'un morceau à l'autre), `pause`, `seeked`, au passage à l'arrêt, et toutes les 10 s
en lecture (`stores/localPlayer.ts`, `reportState`). Le serveur date le relevé à l'arrivée ; la même
horloge locale de `LightSync` extrapole entre deux relevés. Un onglet qui se tait **25 s** en lecture
(fermé sans pause) ne compte plus comme jouant, et les lumières se rendent 5 s plus tard. La session
d'un navigateur compte toujours (`sessionActive` l'écarte pour les enceintes seulement). `/progress`
(15 s, reprise des mix) n'a pas été réutilisé : il appelle l'`onProgress` des sources, qui écrit.

**Routes** : `GET /api/music/lightsync/rooms` → `{ rooms: [{ id, name, area }] }` ;
`PUT /api/music/lightsync/:deviceId/room { roomId | null }` (400 pour une enceinte : elle est placée
dans la maison ; 404 pièce inconnue). Écran : [4_5 Musique et médias](../4_ui/4_5_musique-et-medias.md).

Vérifié : `sync.test.ts` (pièces proposées, pas de pièce avant le choix puis zone et réglages de la
pièce, passage d'une pièce à l'autre sans éteindre, pièce sans zone), `player.test.ts` (routes, flux
ouvert après le premier relevé du navigateur, refermé quand il se tait), `localPlayer.test.ts`
(relevés sur lecture, saut, pause, arrêt). **Pas encore vérifié** sur les vraies lampes.

### Mise à jour 2026-11-06 (nuit) — Vague par défaut, ambiance adoucie

Retour de l'utilisateur : « rendre moins agressif l'ambiance, même au minimum ce n'est pas très calme,
et le max est presque insupportable ».

- **Défaut** : `DEFAULT_LIGHTSYNC_SETTINGS.effect` passe de `pulse` à `wave`, et `LIGHTSYNC_EFFECTS`
  met `wave` en tête (l'ordre est celui des tuiles). Seules les pièces jamais réglées changent : les
  réglages gardés dans `.state/lightsync.json` restent.
- **Attaque progressive** : `Envelope.follow` prend une constante de montée (`attackS`, 0 = instantané
  comme avant). Une basse fait gonfler la lumière au lieu de l'allumer d'un coup : 0,3 → 0,08 s pour
  Vague, 0,15 → 0,04 s pour Pulsation et Spectre (calme → énergique).
- **Bornes resserrées des deux côtés**, `energy` toujours monotone : Vague, plancher 45 → 20 % (au lieu
  de 35 → 10), retombée 1,5 → 0,5 s, défilement 0,04 → 0,3 couleur/s (au lieu de 0,08 → 0,6) ;
  Pulsation, plancher 40 → 20 % (au lieu de 25 → 5), contraste ≤ 1,5, attaques comptées au plus toutes
  les 2 → 0,5 s, fondu de couleur 0,8 → 0,2 s ; Spectre, plancher 30 → 12 %, retombée 0,7 → 0,2 s.
- **Strobo** : au plus un éclair toutes les 0,35 s même énergique (environ trois par seconde : plus vite
  est pénible, et c'est la limite d'usage pour la photosensibilité) ; lueur de 15 % en calme.
- Respiration, déjà l'effet doux, est inchangée.

Valeurs choisies sans les lampes sous les yeux : à juger en vrai par l'utilisateur. Tests
`effects.test.ts` (le test du passage de couleur laisse 2 s au fondu, plus lent) et `sync.test.ts`
(défaut). Le choix de la zone d'une pièce s'est assoupli le même jour (voir
[3_1 Philips Hue](../3_plugins/3_1_philips-hue.md)).

### Mise à jour 2026-11-07 — fondu à l'arrêt du son, état des lampes rendu à la désactivation

Demande de l'utilisateur : quand on arrête l'écoute, les lampes semblent rester dans leur dernier
état ; synchro active et plus de son → un fondu jusqu'à l'extinction ; synchro désactivée → les lampes
reprennent leur état d'avant la synchro.

Avant : sans son, l'effet retombait à son plancher (12 à 25 % selon `energy`) pendant les 5 s de pause,
puis le flux était rendu au pont ; Kasbah ne gardait ni ne rendait rien de l'état des lampes.

Désormais (`lightsync/sync.ts`) :
- **Plus de son** (pause, arrêt, fin de file : l'enceinte ne joue plus un de nos flux) : chaque trame
  est multipliée par `fade`, qui descend linéairement de 1 à 0 en **3 s** (`FADE_OUT_MS`) ; la reprise
  du son le remet à 1 aussitôt. À **5 s** (`PAUSE_CLOSE_MS`, inchangé), le flux se ferme puis
  `streamer.switchOff(zone)` éteint les lampes de la zone. Un silence **dans** un morceau n'éteint rien :
  l'effet garde son plancher.
- **État d'avant** : juste avant le premier flux qui suit l'allumage de l'interrupteur,
  `streamer.saveLights(zone)` relit les lampes ; l'instantané reste le même pour les flux suivants (une
  pause qui a éteint les lampes ne le remplace pas). `restoreLights` le rend quand l'interrupteur
  s'éteint, quand une autre enceinte prend la main, et à l'arrêt du serveur. Rien n'est rendu si aucun
  flux ne s'est ouvert.
- `settling` : l'extinction qui suit une pause se termine avant qu'un nouveau flux s'ouvre ou que
  l'état d'avant soit rendu.
- Pièce choisie de « Ce navigateur » (`setRoom`, mise à jour du 2026-11-06 ci-dessus) : changer de
  pièce rend aussitôt l'état d'avant de l'ancienne zone ; celui de la nouvelle est pris à son premier
  flux. `open` rend aussi un instantané d'une autre zone (enceinte déplacée dans la maison).

Contrat `core/lightStreamBridge.ts` : `LightStreamer` gagne `saveLights`, `restoreLights` et
`switchOff` ; `SavedLights` est opaque pour le lecteur. Implémentation Hue :
[3_1 Philips Hue](../3_plugins/3_1_philips-hue.md), mise à jour du même jour.

Vérifié : `sync.test.ts` (fondu au noir en 3 s puis fermeture et extinction, reprise immédiate,
instantané pris une seule fois, état rendu à la désactivation, au passage à une autre enceinte et à
l'arrêt du serveur, rien à rendre sans flux). **Pas vérifié sur la vraie maison** : que le flux rallume
des lampes éteintes après une pause, et l'ordre des gestes à la fermeture (voir la contradiction notée
dans 3_1).

### Mise à jour 2026-11-07 (suite) — le flux reste ouvert tant que l'interrupteur est allumé

Cause trouvée des échecs « DTLS handshake timed out » : après la fin d'un flux, le pont Hue refuse tout
nouveau flux pendant 15 s à 3 min (mesures dans [3_1 Philips Hue](../3_plugins/3_1_philips-hue.md), même
jour). Fermer le flux après 5 s de pause, comme depuis le 2026-11-05, faisait buter la reprise ou le morceau
suivant sur ce refus.

Choix de l'utilisateur : **ne plus jamais fermer le flux pendant une pause** ; il faut couper la synchro
pour rendre les lampes. `lightsync/sync.ts` : sans son, le fondu au noir de 3 s reste, puis la boucle passe
au rythme d'attente (250 ms) sans calculer de trame — le `keepalive` du flux renvoie la dernière (noire)
chaque seconde, le pont ne coupe pas. À la reprise, même flux, `fade` à 1. `PAUSE_CLOSE_MS`, `settling` et
l'extinction `switchOff` qui suivait la fermeture sont retirés (section « fondu à l'arrêt du son » plus haut :
les puces « À 5 s … `switchOff` » et `settling` sont **datées**).

Prix : pendant une pause, les lampes de la zone restent tenues par le flux (noires) ; l'appli Hue ne les
pilote pas tant que la synchro est allumée. L'état d'avant est rendu à la désactivation, au passage à une
autre enceinte, au changement de pièce choisie et à l'arrêt du serveur, comme avant.

Vérifié : `sync.test.ts` (flux gardé 60 s de pause puis repris sans réouverture, noir tenu sans trame
calculée, état d'avant pris une fois), `player.test.ts` (« Ce navigateur » muet : noir, flux gardé, rendu à la
désactivation). **Pas encore vérifié sur la vraie maison.**

### Mise à jour 2026-11-07 (soir) — le flux se referme de nouveau en pause

Le refus du pont de la section précédente tenait à un message de la poignée de main que
`node-dtls-client` ne renvoie jamais ; `openStream` le renvoie maintenant et rouvre un flux en moins
d'une seconde juste après le précédent ([3_1 Philips Hue](../3_plugins/3_1_philips-hue.md), même jour).

Choix de l'utilisateur, une fois la réouverture fiable : **refermer le flux en pause**, pour rendre les
lampes à l'appli Hue. Le comportement de la section « fondu à l'arrêt du son » revient tel quel : fondu
au noir en 3 s, fermeture du flux à 5 s puis `switchOff`, `settling` avant toute réouverture ou remise
à l'état d'avant. La section « le flux reste ouvert tant que l'interrupteur est allumé » est **datée**.
Vérifié : `sync.test.ts` et `player.test.ts` de nouveau dans leur version du commit 88a975c, verts.
**Pas encore vérifié sur la vraie maison** avec la synchro complète.
