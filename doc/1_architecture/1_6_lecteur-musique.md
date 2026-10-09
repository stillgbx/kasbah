# Lecteur musique commun (`/api/music`)

> Dernière mise à jour : 2026-10-09
> Sources : `apps/server/src/music/{player,proxy,queue,sources,ytdlp}.ts`, tests `apps/server/src/music/{proxy,queue}.test.ts`, `apps/server/src/plugins/ytmusic/plugin.test.ts`, `apps/server/src/app.ts`, `apps/server/src/plugins/{ytmusic,mixcloud}/{index,resolve}.ts`, `apps/server/.env.example`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/stores/localPlayer.ts`, `apps/web/src/views/MusicView.vue`, arbre de travail non commité du 2026-09-23 (après 5c43833) ; `apps/server/src/music/lastPlayed.ts` et son test, `apps/web/src/stores/localPlayer.test.ts`, arbre de travail non commité du 2026-09-28 (après c6fe7c1)

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
