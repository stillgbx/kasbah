# Plugin Mixcloud (mix et émissions)

> Dernière mise à jour : 2026-10-08
> Sources : `apps/server/src/plugins/mixcloud/{index,api,resolve,store}.ts`, tests `apps/server/src/plugins/mixcloud/plugin.test.ts`, `apps/server/src/music/{player,sources,ytdlp}.ts`, `apps/server/src/plugins/index.ts`, `apps/server/.env.example`, `apps/web/src/components/music/MixcloudBrowser.vue`, `apps/web/src/components/MixcloudLinkCard.vue`, `apps/web/src/views/MusicView.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, arbre de travail non commité du 2026-09-23 (après 5c43833), `apps/server/src/plugins/mixcloud/home.ts` et arbre non commité après 1839a21 (accueil), arbre non commité après 604939c (créateurs suivis), `apps/web/src/components/music/{GenrePills,MusicTile,MusicItemRow}.vue` et arbre non commité du 2026-09-28 (après c6fe7c1, genres côté web)

## Ce que c'est

Troisième source de la page Musique, après YouTube Music et les Radios : les mix et émissions de
Mixcloud, souvent longs de une à plusieurs heures. **Non officiel pour la lecture** : le catalogue
passe par l'API publique, le flux par yt-dlp. Comme ytmusic et radio, le plugin **ne publie aucun
appareil** (`discover` → `[]`, `execute` → `UNSUPPORTED_COMMAND`) : c'est une **source du lecteur
commun** (`../1_architecture/1_6_lecteur-musique.md`), qui sert le fichier aux enceintes, tient la
file, le transfert et l'écoute locale.

Ce que le plugin ajoute au lecteur : **la reprise**. Un mix de trois heures interrompu doit pouvoir
repartir où on l'a laissé, sur n'importe quelle enceinte ou dans le navigateur.

Il est la raison de l'extraction du noyau musique : sa sonde du 2026-09-23 (`3_19_radio.md`,
« Suite : Mixcloud ») avait montré un m4a de taille connue, découpable par plages — le profil du relais
brut de ytmusic.

## Le compte : un NOM d'utilisateur, rien d'autre

L'API publique `api.mixcloud.com` lit sans clé ni jeton ce que montre un profil : favoris, écoutes,
mix publiés, playlists, comptes suivis, recherche. Relier un compte = donner son **nom d'utilisateur**
(celui de l'URL du profil, `mixcloud.com/<nom>/`) ; `PUT /account` vérifie qu'il existe chez Mixcloud
(404 sinon). **Aucun mot de passe ne transite**, aucun secret n'est stocké.

Un compte de test a été relié le 2026-09-23 (d'après le thread principal).
*(Précisé le 2026-10-07 : ce nom est celui de la MAISON. Chaque utilisateur peut relier le sien ; sans nom, il est anonyme. Voir la mise à jour du 2026-10-07 en bas de page.)*

**Qualité** : compte gratuit = AAC **64 kb/s**. D'après le thread principal, passer à yt-dlp un
cookie de compte gratuit n'améliore rien ; il n'y a donc pas de cookie dans ce plugin. Un compte
payant n'a pas été essayé.

## Listes et routes

Sous `/api/plugins/mixcloud/` :

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/status` | `{ username, user, lastError }` |
| `PUT` / `DELETE` | `/account` | relier (`{ username }`) / oublier le compte |
| `GET` | `/home` | l'accueil recomposé, en rangées (depuis le 2026-09-23, voir plus bas) |
| `GET` | `/library/{feed,favorites,listens,uploads}` | nouveautés des suivis / favoris / écoutés / mes mix ; `?next=` |
| `GET` | `/playlists` | playlists du compte |
| `GET` | `/playlist?key=` | mix d'une playlist ; `?next=` |
| `GET` | `/following` | comptes suivis |
| `GET` | `/users/:username/cloudcasts` | mix d'un compte (ouvert depuis Suivis) ; `?next=` |
| `GET` | `/search?q=` | recherche de mix (2 caractères min.) ; `?next=` |
| `DELETE` | `/resume?key=` | oublier la position retenue d'un mix (« Repartir du début ») |

La lecture ne passe **pas** par ces routes : l'UI envoie `{ source: 'mixcloud', id: <clé> }` à
`/api/music/*`. La clé d'un mix est son chemin, `/<user>/<slug>/`.

**Pagination par curseur** : chaque page (40 mix) rend `next`, l'URL `paging.next` de l'API, que
l'UI renvoie telle quelle. Le serveur **ne suit que les curseurs qui pointent vers la racine de
l'API** configurée : sans cela, `?next=` serait un proxy ouvert vers n'importe quelle URL.

**Validation avant toute URL** : `USERNAME_RE` (`[A-Za-z0-9_-]{1,64}`) et `KEY_RE`
(`/<user>/[playlists/]<slug>/`) sont vérifiées avant de composer une URL d'API ou de page. Les tests
refusent explicitement `/NTSRadio/../../etc/` et `https://evil.example/x/` : une clé sert aussi à
bâtir l'URL de la page passée à yt-dlp.

### Le fil « nouveautés des suivis » est recomposé

Sur le site, ce fil exige une **connexion** ; l'API publique ne le donne pas. `followingUploads`
(`api.ts`) le recompose : les derniers mix de chaque compte suivi, fusionnés du plus récent au plus
ancien — **60 comptes au plus, 3 mix chacun, 4 requêtes à la fois**, 60 mix rendus ; un compte en
échec est sauté. Cela coûte une requête par compte suivi, et l'API publique n'annonce pas son quota :
le résultat est gardé **30 min** en cache (vidé si le compte change), et `feed` n'est pas paginé.

### Mise à jour 2026-09-23 — l'accueil, recomposé des écoutes publiques

Le site ouvre sur un accueil (« Your top creators », « More from… », « Popular … shows »). Kasbah le
recompose **sans cookie ni connexion** : `buildHome` (`home.ts`) part des **100 dernières écoutes
publiques** du compte — `api.listens(username, undefined, 100)`, `listens` ayant gagné un paramètre
`limit` plafonné à 100 par l'API — et en tire tout le reste. Relevé qui a guidé le choix (commentaire
de `home.ts`) : sur un compte, les créateurs et genres qui dominent les écoutes sont
exactement ceux des rangées « More from… » et « Popular … » du site.

Les rangées, dans l'ordre (une rangée vide n'est pas rendue) :

| `id` | Contenu | D'où ça vient |
|---|---|---|
| `topCreators` | les **10** créateurs les plus présents dans les écoutes (`kind: 'users'`) — *depuis le 2026-09-23, suivis seulement, complétés par les autres suivis : voir la mise à jour plus bas* | profil relu par `api.user` pour la photo ; en échec, nom seul, `artUrl: null` |
| `following` | nouveautés des suivis | le fil existant, partagé avec `/library/feed` par `followingFeed` (même cache 30 min) |
| `listenAgain` | les écoutes, **dédoublonnées** par clé | aucune requête de plus |
| `moreFrom` × 3 | derniers mix des **3** premiers créateurs | `api.cloudcasts` |
| `popular` × 3 | émissions populaires des **3** genres les plus fréquents | nouvelle `api.popular(slug)` → `/discover/<slug>/popular/` |

20 mix au plus par rangée. Classement : le plus fréquent d'abord, et à égalité **celui écouté le plus
récemment** (premier vu). Le compte lui-même est écarté des créateurs (ses propres mix peuvent figurer
dans ses écoutes).

**Les genres** viennent d'un nouveau champ `genres: { slug, name }[]` de `MixcloudMix` : `toMix` ne
retient que les tags dont la clé est `/genres/<slug>/` (le schéma zod lit désormais `key` en plus de
`name`). **Piège** : chez Mixcloud, un nom de créateur peut aussi être un genre — `worldwide-fm` est
un tag `/genres/worldwide-fm/`. Sans filtre, « Émissions Worldwide FM populaires » doublerait la rangée
« Plus de Worldwide FM ». Un genre dont le slug égale celui du nom d'utilisateur ou du nom affiché d'un
créateur écouté est donc écarté. `popular` valide le slug (`[a-z0-9-]{1,64}`) avant de composer l'URL,
comme les clés et noms plus haut.

**Chaque appel peut échouer seul.** Après la lecture des écoutes (dont l'échec, lui, fait échouer
toute la route), profils, fil des suivis, « Plus de » et « populaires » partent **en parallèle**,
chacun rattrapé vers une valeur vide : un 429 sur `cloudcasts` ou un fil des suivis en panne retire
leurs rangées, pas l'accueil (second test du `describe('mixcloud home')`).

**Cache** : `GET /home` garde les rangées **30 min par compte**, remises à zéro quand on relie, change
ou délie le compte (et à l'arrêt du plugin). Les **positions de reprise ne sont pas en cache** : elles
sont reposées sur les mix (`withResume`) à chaque appel, pour qu'un mix entamé il y a une minute
s'affiche « Reprendre à… ». Coût d'une reconstruction : 1 requête d'écoutes, jusqu'à 10 profils, 3 +
3 pages de mix, plus le fil des suivis s'il n'est pas déjà en cache (une requête par compte suivi).

**Le cookie n'est pas nécessaire** (question posée par l'utilisateur pendant la session) : tout ce qui
précède vient de l'API publique. Seules les recommandations que Mixcloud calcule chez lui pour un
compte connecté en auraient besoin, et Kasbah ne les reproduit pas.

**Mesuré en direct** (d'après le thread principal, compte de test, 2026-09-23) : **9 rangées**,
environ **4 s** au premier appel (cache vide). Temps des appels suivants (servis par le cache) non relevé.

Tests : `plugin.test.ts`, `describe('mixcloud home')` — rangées tirées d'écoutes fabriquées sur ce
relevé (ordre, dédoublonnage, `worldwide-fm` jamais demandé à `popular`, limite à 100), puis rangées
survivantes quand `cloudcasts` et le fil échouent.

#### Mise à jour 2026-09-23 (plus tard) — « Tes créateurs » ne garde que les comptes SUIVIS

Ce qui précède décrivait `topCreators` comme « les 10 créateurs les plus présents dans les écoutes ».
C'est **dépassé** (arbre non commité après 604939c) : à l'usage, l'utilisateur a vu dans la rangée des
profils qu'il **ne suit pas**, écoutés en passant. Sur le site, « Your top
creators » ne montre que des comptes suivis ; l'historique d'écoutes de l'API publique, lui, rend tout
ce qui a été écouté, et **aucun paramètre ne filtre par suivi**. Le tri se fait donc chez Kasbah.

`buildHome` lit désormais, **en parallèle des écoutes**, la liste des suivis (`api.following`, une page
de 200 au plus) et ne garde parmi les créateurs écoutés que ceux qui y figurent (comparaison sans
casse), toujours classés par nombre d'écoutes. La rangée est ensuite **complétée jusqu'à 10** par les
autres suivis, **dans l'ordre de la liste** renvoyée par l'API — demande de l'utilisateur, pour une
rangée pleine même quand peu de suivis ont été écoutés récemment. Ces compléments arrivent avec leur
photo dans la réponse de `following` : **aucune requête `user` de plus**, seuls les écoutés sont relus
par `api.user`.

Conséquences, à lire dans le code (`home.ts`) :

- **« Plus de… »** prend toujours les 3 premiers de `creators`, donc désormais **3 suivis écoutés** ; un
  complément jamais écouté n'y entre pas.
- **Les genres « populaires » comptent TOUTES les écoutes**, suivies ou non (le test le fixe : un
  compte non suivi écouté deux fois en `house` fait apparaître une rangée `house`). « Réécouter » garde
  aussi les mix des comptes non suivis.
- **Suivis illisibles** (`following` en échec, rattrapé en `null`) : **aucun filtre**, on retombe sur
  l'ancien comportement (tous les créateurs écoutés, classés par écoutes), sans complément. Testé :
  `keeps every listened creator when the following list cannot be read` (`following` rejette un 429,
  le compte non suivi reste dans la rangée à son rang d'écoutes).
- Coût d'une reconstruction : **+1 requête** (`following`), distincte de celle que fait le fil des
  suivis recomposé (`followingUploads`), qui a son propre cache.
- Le filtre anti-doublon des genres (`creatorSlugs`, piège `worldwide-fm` plus haut) porte sur **tous
  les créateurs écoutés**, suivis ou non (`listenedCreators`, calculé avant le filtre des suivis) : un
  nom de compte écouté mais non suivi n'est jamais pris pour un genre. Une première version du
  changement le calculait après le filtre, ce qui laissait passer ce cas ; corrigé le même jour avant
  tout commit, et le test donne au compte `notfollowed` un tag `notfollowed` que `popular` ne doit
  jamais recevoir.

**Vérifié en direct** (d'après le thread principal, compte de test, 2026-09-23) : des suivis écoutés en
tête, puis les compléments ; toujours **9 rangées**.
Temps de construction non remesuré.

Tests : le premier test de `describe('mixcloud home')` ajoute un compte `notfollowed` écouté deux fois
— ni créateur, ni `cloudcasts` demandé, mais présent dans « Réécouter » et dans les genres — et des
suivis dont deux non écoutés (`sohoradio`, `KioskRadio`) qui complètent la rangée après les écoutés ;
son tag `notfollowed` n'est jamais demandé à `popular`. Un test dédié couvre les suivis illisibles.

## Le flux : yt-dlp, un fichier direct, et sa taille par HEAD

`resolve.ts` lance `yt-dlp --ignore-config -J --no-download --no-warnings` sur
`https://www.mixcloud.com<clé>` (via `music/ytdlp.ts`) et choisit un format :

- **direct HTTP(S) seulement**, pas de HLS ni de DASH : seul un fichier se relaie tel quel. Le m4a est
  préféré.
- le format direct a `protocol: http(s)` mais **pas d'`acodec`** annoncé : le filtre accepte un
  `acodec` absent (seul `none` est refusé), sinon il ne restait rien.
- il n'annonce pas non plus son débit : on prend celui des variantes HLS/DASH du même fichier.
- **yt-dlp ne donne pas la taille** : une requête `HEAD` la lit. Il faut `content-length` **et**
  `accept-ranges: bytes` ; sinon la taille reste inconnue et le lecteur commun retombe sur le repli
  MP3 (le fichier n'est pas découpable, l'enceinte ne pourrait pas s'y déplacer ni reprendre).

Avec la taille, le lecteur relaie le m4a brut (`/api/music/raw/<sid>.m4a`). Le binaire est
`MIXCLOUD_YTDLP_PATH`, sinon celui de YouTube Music (`YTM_YTDLP_PATH`), sinon `yt-dlp`. Pas de
`prepare` : rien à préparer, pas de PO Token.

## La reprise, gardée dans Kasbah

Sans connexion au site, Mixcloud ne peut rien retenir pour nous : Kasbah tient la position lui-même, grâce à `onProgress` du lecteur commun (relevés d'enceinte, et
`POST /api/music/progress` du navigateur).

`store.ts`, fichier `.state/mixcloud.json` (`MIXCLOUD_STATE_FILE`, écrit en `.tmp` + rename) : le nom
d'utilisateur et `resume: { [clé]: { positionS, durationS, at } }`. Règles :

- **rien à reprendre en deçà de 60 s** (`RESUME_MIN_S`) : la position est notée mais pas proposée ;
- **oublié dans les 90 dernières secondes** (`RESUME_END_S`) **ou à la fin** naturelle : un mix
  fini ne se « reprend » pas au générique ;
- **200 mix au plus** (`RESUME_MAX`), les plus anciennement écoutés partent ;
- écrit sur disque **au plus toutes les 15 s** (une progression arrive à chaque relevé) ; une fin ou
  un oubli s'écrit tout de suite, l'UI relisant aussitôt la liste.

Chaque mix rendu à l'UI porte `resumeS` s'il a une position retenue ; l'UI le passe en `startS` à la
piste **lancée seulement** (les suivantes de la file partent du début), et le lecteur commun saute à
la position après `play_url`.
*(Précisé le 2026-10-07 : cette reprise est désormais PAR compte — `users/<nom>/mixcloud.json` pour un utilisateur, `MIXCLOUD_STATE_FILE` pour la maison — et un utilisateur anonyme n'en garde aucune.)*

## Santé

`needs_pairing` sans nom d'utilisateur ; sinon `ok` (« Mixcloud: `<nom>`, N mix(es) to resume »),
`degraded` avec le dernier échec d'API ou de résolution.
*(Précisé le 2026-10-07 : la santé est celle du compte de la maison.)*

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `MIXCLOUD_API_URL` | `https://api.mixcloud.com` | Racine de l'API (et seule origine de curseur acceptée) |
| `MIXCLOUD_STATE_FILE` | `.state/mixcloud.json` | Compte + positions de reprise |
| `MIXCLOUD_YTDLP_PATH` | *(vide → `YTM_YTDLP_PATH` → `yt-dlp`)* | Binaire yt-dlp |

## Côté web

`components/music/MixcloudBrowser.vue` (source « Mixcloud » de la page Musique, visible si le plugin
est actif) et `components/MixcloudLinkCard.vue` (Réglages → Plugins) : détail dans
`../4_ui/4_1_navigation-et-panneaux.md`, « (18) », et « (19) » pour l'onglet Accueil. Mock : toutes les méthodes `mixcloud*` lèvent
`501 NOT_IMPLEMENTED`.

### Mise à jour 2026-09-28 — les genres se lisent et se filtrent

Le genre est un critère de choix d'une émission : le serveur envoyait déjà `genres` (tags
`/genres/<slug>/`, champ ajouté pour l'accueil, plus haut), le web l'affiche désormais.

- **Pastilles sous chaque mix** (`GenrePills.vue`, tuiles de l'accueil comme lignes des listes) ; les
  tags **quittent la méta**, qui n'affiche plus que la reprise et l'auteur.
- **Une rangée de filtres** au-dessus des listes. Choix de l'utilisateur : **trois états** par
  pastille, neutre → gardé → écarté ; un mix reste s'il porte **au moins un genre gardé** (ou si aucun
  n'est gardé) **et aucun écarté**. Rangée composée des genres des mix reçus, classés par fréquence
  **avant** filtre, et dont l'ordre ne bouge pas quand on choisit (demande de l'utilisateur). Choix
  retenu dans le navigateur (`kasbah.mixcloud.genres`). Le filtre est **local** : rien n'est
  demandé de plus à l'API, il ne trie que ce qui est chargé.
- La file lancée depuis une liste est la liste **filtrée**.
- La **durée** s'affiche aussi sur les tuiles de l'accueil (étiquette sur la pochette).

Détail d'interface et pièges de mise en page : `../4_ui/4_1_navigation-et-panneaux.md`, section du
2026-09-28.

## Vérifié en direct (2026-09-23)

D'après le thread principal, sur Sonos Garage : départ à **30:00** (reprise), relais m4a **64 kb/s,
43 Mo**, position retenue ensuite (**30:26**) ; lancement ≈ **8 s** entre le clic et le son (yt-dlp
+ HEAD + `play_url` + saut). Durée du mix et nombre d'essais non précisés.

## Piège outillage : une clé de mix dans Git Bash

Une clé commence par `/` (`/user/slug/`). Passée en argument dans Git Bash (sonde yt-dlp, `curl`),
MSYS la **convertit en chemin Windows** (`C:/Program Files/Git/user/slug/`) sans rien dire. Préfixer
la commande de `MSYS_NO_PATHCONV=1`. D'après le thread principal ; voir aussi
`../6_faq/6_0_pieges-outillage.md`.

## Limites

- Qualité plafonnée à 64 kb/s AAC en compte gratuit.
- Pas de nouveautés paginées ; aucune écoute n'est signalée à Mixcloud (`api.ts` ne fait que des
  lectures).
- Pas de lecture sans taille annoncée autre que le repli MP3 (non observé sur Mixcloud à ce jour).

### Mise à jour 2026-10-06 — la source est aussi joignable par le serveur MCP

Un assistant IA branché sur `/mcp` (`apps/server/src/mcp/server.ts`, page `../1_architecture/1_7_serveur-mcp.md`) cherche des mixes avec `search_music`
(`source: 'mixcloud'`, qui appelle `GET /api/plugins/mixcloud/search`) et les joue avec `play_music`,
par le lecteur commun (`POST /api/music/queue`). La recherche ne demande pas de compte relié ; les
listes personnelles (accueil, favoris) ne sont pas exposées au MCP.

*(Précisé le 2026-10-07 : la recherche par MCP se fait avec les comptes du compte du jeton — un utilisateur sans nom Mixcloud cherche en anonyme.)*

### Mise à jour 2026-10-07 — un nom Mixcloud par utilisateur, et l'accès anonyme

**Pourquoi.** Même demande que pour YouTube Music (`3_16_ytmusic.md`, même date). Ici, le risque réel
n'était pas une recherche : c'étaient les **positions de reprise**, que Kasbah tient lui-même (« La
reprise, gardée dans Kasbah ») et qui auraient mélangé ce que chacun écoute. Mêmes décisions : connecté
sans réglage = anonyme ; les mêmes cartes agissent sur le compte courant.

**Un compte = `{ username, resume }` par utilisateur** (`apps/server/src/plugins/mixcloud/index.ts`) :
`users/<nom>/mixcloud.json` sous `.state/` ; la maison garde `MIXCLOUD_STATE_FILE`. Les positions de
reprise sont par compte.

**Anonyme** (utilisateur sans nom Mixcloud) : recherche et mix d'un compte ouvert possibles ; listes
personnelles → `NEEDS_PAIRING` ; **aucune position retenue**. Le test a d'abord passé à tort : la trace
restait en mémoire sans être écrite. Renforcé : recherche d'Alice sans `resumeS`, puis `plugin.stop()`
avant de lire les fichiers.

**Caches par NOM Mixcloud**, et non par utilisateur Kasbah : le fil des suivis et l'accueil sont des
données publiques, deux utilisateurs reliés au même nom les partagent. `GET /status`, `PUT` et `DELETE
/account` rendent aussi `account` (l'utilisateur, `null` = la maison). La santé reste celle de la maison.

**Web** : `components/music/MixcloudBrowser.vue` en mode anonyme montre recherche et genres, pas
d'onglets personnels ; hors recherche, une invitation « Relier ton compte Mixcloud »
(`mixcloud.anonymousHint`) avec le **champ avant l'explication** — sur téléphone la zone sous la
recherche ne fait que ~137 px, le champ se retrouvait sous le pli. `MixcloudLinkCard.vue` : ligne
« Compte de {user} … ». `MixcloudStatus.account` dans `api/transport.ts`.

**Vérifié** (serveur jetable, connecté en `alice`) : recherche anonyme réelle avec filtre de genres ;
Alice relie un nom public → son accueil s'affiche, `users/alice/mixcloud.json` écrit, la maison reste sans
compte ; rien ne bouge entre repos et recherche, aucun débordement à 1 280 et 375 px, fr et en.

**Limite** : compte retiré puis recréé du même nom avant un redémarrage — Mixcloud peut montrer l'ancien
nom (gardé en mémoire).

**Tests** : `plugin.test.ts`, `describe('mixcloud accounts')` (2) ; contrôle négatif sur la garde anonyme.

Sources : `apps/server/src/plugins/mixcloud/index.ts`, `apps/web/src/components/music/MixcloudBrowser.vue`.

### Mise à jour 2026-10-08 — le badge de santé d'un utilisateur connecté

`healthFor(user)` (`index.ts`, contrat dans `../1_architecture/1_2_serveur-et-plugins.md`) lit le compte
de l'utilisateur et rend `ok` avec, selon le cas, `Mixcloud: <nom>, N mix(es) to resume` ou, sans nom,
`Mixcloud: anonymous — search only; set your username for your home, favorites and resume points` ;
`degraded` avec la dernière erreur d'API. Même choix que YouTube Music : l'anonyme fonctionne, il n'est
pas « à relier ». `health()` reste celui de la maison (`needs_pairing` sans nom).

**Carte** : `MixcloudLinkCard` recharge l'inventaire après une liaison ou un oubli (`plugins.load()`).
Vérifié dans le navigateur : Alice relie un nom public depuis la carte, le détail du badge passe à
`Mixcloud: NTSRadio, 0 mix(es) to resume` sans recharger la page ; la maison, vue du réseau local, reste
`needs_pairing`. Tests : assertions `healthFor` dans `describe('mixcloud accounts')`.

Sources : `apps/server/src/plugins/mixcloud/index.ts`, `apps/web/src/components/MixcloudLinkCard.vue`.
