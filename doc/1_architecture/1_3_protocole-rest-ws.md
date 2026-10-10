# Protocole REST et WebSocket

> Dernière mise à jour : 2026-10-10
> Sources : `packages/shared/src/protocol/{ws,http}.ts`, `apps/server/src/http/{routes,errors}.ts`, `apps/server/src/ws/hub.ts`, `apps/web/src/api/httpTransport.ts`, `apps/server/src/plugins/tesla/index.ts`, `apps/server/src/config/house.ts`, `packages/shared/src/house/place.ts`, `apps/server/src/core/scene-registry.ts`, `packages/shared/src/protocol/http.ts` (`deviceConsumptionSchema`), `apps/server/src/http/routes.ts` (automatisations), `apps/server/src/http/relief.test.ts`, `apps/server/src/config/properties.ts`, `apps/server/src/config/catalog.ts`

## REST

| Route | Réponse |
|---|---|
| `GET /api/health` | `{ ok, uptimeS, clients, plugins: { [id]: { status, detail?, deviceCount?, keys? } } }` |
| `GET /api/house` | maison validée (défauts zod appliqués) |
| `GET /api/house/warnings` | avertissements du lint de la maison |
| `GET /api/devices` | `{ devices: [{ descriptor, state }] }` |
| `GET /api/devices/:id` | une entrée, 404 sinon |
| `GET /api/devices/:id/history?hours=24` | points horaires (`energy`) |
| `POST /api/devices/:id/command` | `{ ok: true }` après accusé du fabricant |
| `GET /api/scenes` | `{ scenes: [{ scene, state }] }` — scènes des fabricants |
| `POST /api/scenes/:id/recall` | `{ ok: true }` après accusé du fabricant |
| `POST /api/scenes` | `{ ok: true }` — crée une ambiance en recopiant `fromSceneId` |
| `DELETE /api/scenes/:id` | `{ ok: true }` — supprime l'ambiance chez le fabricant |
| `PATCH /api/scenes/:id` | `{ ok: true }` — écrit une préférence de scène chez le fabricant |
| `GET /api/plugins` | `{ plugins }` — inventaire de tous les plugins déclarés, actifs ou non (`host.inventory()`) |
| `PATCH /api/plugins/:id` | `{ plugins }` — écrit le choix dans `house.json`, applique sans redémarrer, diffuse `house` ; 404 si l'id est inconnu |
| `POST /api/plugins/hue/pair` | `{ appKey, hint }`, 409 `LINK_BUTTON_NOT_PRESSED` |

> Mis à jour le 2026-10-06 (lint) : `GET /api/plugins/settings` et `PATCH /api/plugins/:id/settings` sont remplacés par `GET /api/plugins` et `PATCH /api/plugins/:id` (`apps/server/src/http/routes.ts`). Ce tableau n'est pas exhaustif : les routes ajoutées depuis (automatisations, relief…) vivent dans `routes.ts`.

Le `:` dans l'id (`mock:cover-living`) est légal non encodé dans un segment de chemin.

### Erreurs

Corps toujours `{ error: { code, message } }` (`apiErrorSchema`). Correspondance (`http/errors.ts`) :
zod → 400 `INVALID_BODY` ; `CommandNotAllowedError` → 400 (`KIND_MISMATCH`, `UNSUPPORTED_COMMAND`) ;
`PluginError` : `NEEDS_PAIRING` 409, `RATE_LIMITED` 429, `NOT_IMPLEMENTED` 501, `UPSTREAM_ERROR` 502,
`DEVICE_UNAVAILABLE` 503, `TIMEOUT` 504.

## WebSocket `/ws`

Serveur → client (`serverMessageSchema`) :

```
snapshot     { serverTime, devices[], scenes[], automations[] } à la connexion
state        { deviceId, state }              état COMPLET, coalescé 50 ms par appareil
availability { deviceIds[], available }       bascule groupée (ex. bridge hors ligne)
devices      { devices[] }                    l'ensemble des descripteurs a changé
scenes       { scenes[] }                     l'ensemble des scènes d'un fabricant a changé
scene        { sceneId, state }               une scène s'active ou s'éteint (non coalescé)
deviceEvent  { deviceId, event, at }          événement transitoire (sonnette, mouvement), non coalescé
house        { house }                        la maison a été réécrite (placement, réglage de plugin)
automations  { automations[] }                liste entière des automatisations et de leur statut
error        { code, message }
```

> Mis à jour le 2026-10-06 (lint) : le snapshot porte `automations`, et les messages `house` et `automations` existent (`packages/shared/src/protocol/ws.ts`).

Le client n'envoie rien en v1 (`clientMessageSchema` réservé). Ping protocolaire toutes les 15 s,
socket purgé sans pong après 30 s.

### Pourquoi des états complets et des commandes en REST

Un état fait quelques centaines d'octets : l'envoyer entier rend les messages idempotents, supprime
les problèmes d'ordre après reconnexion et laisse **une seule** implémentation de fusion (le
registre). La reconnexion se résume à « recevoir un snapshot ». Les commandes en REST donnent
codes de statut, timeouts et testabilité `curl`, et fonctionnent pendant une reconnexion.

## Côté client (`httpTransport.ts`)

URLs relatives (même origine en prod, proxy Vite en dev). Chaque trame est traitée dans
`onmessage` (jamais via un `watch` sur une ref haute fréquence, qui coalescerait). Aucune trame
depuis 45 s → statut `stale` et reconnexion ; reconnexion exponentielle 1 s → 30 s avec gigue ;
`connecting` → `offline` après 3 tentatives. Le bandeau de connexion n'apparaît qu'après 1,5 s de
`connecting` pour éviter un clignotement au chargement.

### Mise à jour 2026-09-07 — placement d'un appareil : `PUT /api/house/devices/:id` et message `house`

Première (et seule) route d'**écriture** de la maison. Corps `devicePlacementSchema`
(`packages/shared/src/house/place.ts`) : `{ position, roomId?, mount?, deviceId? }` — `deviceId` n'est
requis que pour **créer** l'entrée d'un appareil auto-placé (absent du JSON). Réponse `{ house }`
(maison réécrite, défauts zod appliqués comme `GET /api/house`).

Mécanique (`apps/server/src/config/house.ts : updateHouseFile`) : lire-modifier-écrire **sur le
fichier**, pas depuis la maison en mémoire, pour ne pas écraser une édition manuelle faite depuis le
démarrage ; `placeDeviceInJson` patche le JSON brut ; `parseHouse` valide le résultat **avant**
d'écrire ; copie de la version précédente en `<fichier>.bak`, écriture atomique (`<fichier>.tmp` puis
`rename`) ; les écritures d'un même fichier sont sérialisées par une file de promesses. La maison en
mémoire (`LoadedHouse`) est ensuite remplacée, donc `GET /api/house` reflète le changement sans
redémarrage.

Erreurs ajoutées (`http/errors.ts`) : `PlacementError` (pièce inconnue, appareil inconnu sans
`deviceId`) → 400 `INVALID_PLACEMENT` ; `HouseValidationError` (la maison résultante viole la
validation croisée, ex. volet ancré à l'ouverture d'une autre pièce) → 400 `INVALID_HOUSE`, rien n'est
écrit. Corps invalide → 400 `INVALID_BODY` comme ailleurs.

Nouveau message serveur → client : `house { house }` (`serverMessageSchema`), diffusé par le hub après
chaque écriture pour que les **autres écrans** suivent (le client émetteur reçoit déjà la maison
dans la réponse REST). Test : `apps/server/test/integration.test.ts`, « device placement ».

### Mise à jour 2026-09-08 — routes et messages des scènes plugin

`GET /api/scenes` renvoie la liste complète (`scenesResponseSchema`), y compris les scènes inactives :
c'est un catalogue, pas un état.

`POST /api/scenes/:id/recall` prend un corps `sceneRecallSchema` (**vide accepté** → `mode: 'static'`) :
`static` applique les valeurs fixes, `dynamic` lance la palette animée, `off` éteint le groupe de la
scène. `off` est légal sur n'importe quelle scène.
Trois refus avant d'atteindre le plugin : scène inconnue → 404 `NOT_FOUND` ; `mode: 'dynamic'` sur une
scène sans palette animée → 400 `UNSUPPORTED_COMMAND` (contrôle symétrique de
`assertCommandAllowed` pour les appareils) ; plugin sans `recallScene` → 501 `NOT_IMPLEMENTED`.
Comme pour une commande, **la réponse ne contient pas l'état résultant** : la scène active arrive par
le WebSocket, seul chemin d'état.

`PATCH /api/scenes/:id` prend `sceneUpdateSchema` (`{ autoDynamic }`, corps obligatoire) et écrit
la préférence chez le fabricant. Refus : scène inconnue → 404 ; `autoDynamic: true` sur une scène
sans palette animée → 400 `UNSUPPORTED_COMMAND` ; plugin sans `updateScene` → 501. La nouvelle
valeur ne revient pas dans la réponse mais par le message **`scenes`** (elle vit dans le
descripteur, pas dans l'état) — donc un réglage changé depuis l'app du fabricant arrive par le même
chemin.

`POST /api/scenes` prend `sceneCreateSchema`. Refus : source inconnue → 404 ; corps invalide → 400 ;
plugin sans `createScene` → 501 ; ambiance déjà présente dans le groupe ou groupe introuvable → 400 /
503 selon le cas, remontés par le plugin. La nouvelle ambiance arrive par le message **`scenes`**,
comme si elle avait été créée dans l'app du fabricant — et le seeder lui applique alors le défaut du
plugin, puisqu'elle vient d'apparaître.

`DELETE /api/scenes/:id` : 404 si l'ambiance est inconnue, 501 si le plugin ne sait pas supprimer.
Aucune confirmation côté serveur — le geste est destructif et visible depuis toutes les apps du
fabricant, donc c'est l'UI qui confirme (deux appuis), pas la route.

Les réglages par plugin ne passent **pas** par le WebSocket : ils changent très rarement et sont
lus au montage de l'écran Réglages (`GET`). Un autre écran les verra à sa prochaine visite.

Le message `scene` n'est **pas coalescé** (contrairement à `state`) : une activation est un événement
rare, déclenché par un doigt ou un interrupteur mural. `snapshot.scenes` a un `.default([])` : un
serveur sans plugin à scènes reste compatible avec le schéma, et le client reçoit toujours un tableau.

### Mise à jour 2026-09-08 — `PUT /api/house/levels/:id/room-order`

Deuxième (et pour l'instant dernière) route qui écrit dans `house.json`. Corps
`{ roomIds: string[] }` (`roomOrderSchema`), réponse `{ house }`, et la maison réécrite part aussi en
message **`house`** à tous les écrans — même mécanique et mêmes garanties que
`PUT /api/house/devices/:id` : patch du JSON brut (`setRoomOrderInJson`), validation complète avant
écriture, écriture atomique sérialisée par fichier.

Refus : niveau inconnu, pièce n'appartenant pas au niveau, id en double → 400 `INVALID_PLACEMENT`
(la classe d'erreur des écritures maison est partagée). Un ordre **partiel** est valide : les pièces
absentes de la liste suivent par ordre alphabétique (cf. `../2_maison/2_0_format-house-json.md`).

### Mise à jour 2026-09-09 — message `deviceEvent` et `PluginContext.emitEvent`

Un plugin savait pousser des **états** (`emitState`) mais pas un **événement transitoire** — un coup
de sonnette n'est pas un état, on ne le conserve pas. Ajout d'un canal bout en bout :
`PluginContext.emitEvent(externalId, event)` → `Bus.emit('deviceEvent', deviceId, event, at)` → le hub
diffuse `deviceEvent { deviceId, event, at }` (`serverMessageSchema`), **sans coalescence** (comme les
scènes). `event` est un `DeviceEventKind` (`'chime' | 'motion' | 'person' | 'sound'`, `@kasbah/shared`),
`at` = horloge serveur. Premier producteur : le plugin Nest sur les événements Pub/Sub (voir
`../3_plugins/3_5_google-nest.md`). Côté client, le store `devices` expose `onDeviceEvent(fn)` (relais, sans coalescence) ; `HomeView`
s'y abonne et réagit à un `chime` (revenir sur la maison, cadrer la sonnette, jouer son direct — voir
`../3_plugins/3_5_google-nest.md`). `PluginHost` reçoit désormais le `Bus` en option pour câbler `emitEvent`.

### Mise à jour 2026-09-10 — `DELETE /api/house/devices/:id`

Geste inverse du placement : retire l'entrée de l'appareil du JSON (`removeDeviceFromJson`, JSON brut
patché, validation complète, réécriture atomique) et diffuse la maison entière (`house`), comme le
`PUT`. L'appareil redevient auto-placé ou « non placé » ; le plugin reste la source de l'inventaire. Id
inconnu → 400 `INVALID_PLACEMENT`. Le placement (`PUT`) accepte désormais aussi `levelId` pour ancrer
hors de toute pièce (`../2_maison/2_0_format-house-json.md`).

### Mise à jour 2026-09-10 — `DELETE /api/plugins/<plugin>/devices/<externalId>` (oublier un appareil)

Route **propre au plugin** (montée sous `/api/plugins/<id>/` comme `/art`, `/raw` ou les caméras), et
convention pour tout plugin qui poserait `meta.forgettable` sur ses descripteurs
(`1_1_contrat-appareils.md`) : elle fait **oublier** au plugin un appareil qu'il retenait alors qu'il a
disparu du réseau. Réponse `{ "forgotten": "<externalId>" }` ; id inconnu → 404 `NOT_FOUND`. L'appareil
quitte l'inventaire par le message `devices` habituel — le client n'a rien à retirer lui-même.

Implémentée par `google_cast` (mémoire des appareils vus, `../3_plugins/3_6_google-cast.md`). Côté web,
`Transport.forgetDevice(deviceId)` construit l'URL depuis `<pluginId>:<externalId>`, comme
`cameraStreamUrl` (`1_4_app-web.md`).

### Mise à jour 2026-09-11 — `GET /api/plugins` et `PATCH /api/plugins/:id`

Les deux routes de réglages par plugin (`GET /api/plugins/settings`,
`PATCH /api/plugins/:id/settings`) sont **remplacées**, le réglage ayant déménagé dans la maison
(`../2_maison/2_0_format-house-json.md`) :

| Route | Réponse |
|---|---|
| `GET /api/plugins` | `{ plugins: PluginInfo[] }` — **tous** les plugins déclarés, actifs ou non : `id`, `implemented`, `enabled`, `autoDynamicForNewScenes` (présent seulement chez un plugin qui écrit ses scènes), `parts: [{ id, labelKey, enabled }]`, `health`. |
| `PATCH /api/plugins/:id` | Corps `pluginSettingsPatchSchema` (`enabled?`, `parts?`, `autoDynamicForNewScenes?`) → écrit `house.json`, applique (`PluginHost.apply`), **diffuse la maison** (`{ type: 'house' }`) et rend l'inventaire à jour. Id inconnu → 404, corps invalide → 400. |

`labelKey` est une **clé i18n** (`kinds.light`…) : le serveur ne connaît pas la langue du
navigateur. Pas de conflit avec les routes propres aux plugins, montées un cran plus bas
(`/api/plugins/<id>/pair`…).

### Mise à jour 2026-09-12 — le placement transporte aussi la taille et les battants

`PUT /api/house/devices/:id` accepte deux champs de plus dans `devicePlacementSchema`
(`packages/shared/src/house/place.ts`) : `size: { width, height }` (mètres, > 0, ≤ 50) et
`leaves: 1 | 2`. Mêmes règles que `yaw` : optionnels, écrits sur l'entrée seulement s'ils sont
donnés, et rien d'autre ne change — patch du JSON brut, validation complète avant écriture, écriture
atomique, maison relue diffusée en `house` sur le WebSocket. Ce que ces champs veulent dire :
`../2_maison/2_0_format-house-json.md`.


### Mise à jour 2026-09-12 (bis) — deux routes pour les champs de panneaux

`PUT /api/house/arrays/:id` (corps : `panelArrayPatchSchema`) crée ou règle un champ ;
`DELETE /api/house/arrays/:id` le retire (`apps/server/src/http/routes.ts`). Même mécanique que le
placement d'un appareil, et c'est voulu : patch du JSON brut (`putArrayInJson` /
`removeArrayFromJson`, `packages/shared/src/house/place.ts`), validation complète, écriture atomique,
**maison entière rediffusée** en `house` sur le WebSocket. Le patch est partiel : seuls les champs
présents sont écrits, `levelId` et `origin` n'étant requis qu'à la création.

Rien de nouveau pour les MODULES : ils restent dérivés du champ et n'ont pas de route. Une
conséquence utile de la diffusion complète : le retrait d'une installation solaire
(`DELETE /api/house/devices/:id`) emporte ses champs dans la même réponse, sans second aller-retour
(`../2_maison/2_0_format-house-json.md`).


### Mise à jour 2026-09-14 — `/api/health` peut porter un QUOTA

La santé d'un plugin gagne un champ facultatif, et c'est la seule évolution de la forme de
`GET /api/health` :

```
plugins: { [id]: { status, detail?, deviceCount?, keys?, quota? } }
quota: { used, limit, labelKey, unit?: 'usd', since? }
```

Il sert à un plugin dont l'API du fabricant est FACTURÉE ou bornée et qui se rationne : Tesla y publie
sa consommation du cycle de facturation, et la vue Véhicules en fait une jauge. Le serveur ne formate
rien — il dit quoi (`labelKey`, une clé i18n de l'app web), combien, dans quelle unité et depuis quand ;
la mise en forme (somme, date, langue) appartient à l'interface. Détail du champ dans
`../3_plugins/3_2_ecrire-un-plugin.md`.

Piège qui vaut pour toute UI qui l'affiche : **la santé n'est ni poussée sur le WebSocket, ni sondée
par le serveur**. Elle se demande. Une vue qui montre un quota doit donc la redemander elle-même, au
rythme qui lui convient — la vue Véhicules le fait en arrivant, toutes les 30 s, et après chaque
commande.

### Mise à jour 2026-09-16 — `GET /api/devices/:id/forecast`

Prévisions d'un appareil `weather`, servies **à la demande** et jamais poussées sur le WebSocket
(même arbitrage que `/history` : plusieurs Ko qui changent à chaque sondage n'ont rien à faire sur
un écran qui n'a pas la vue ouverte). Réponse au schéma partagé `weatherForecastSchema`
(`packages/shared/src/protocol/http.ts`) : `deviceId`, `issuedAt`, `hourly[]` (24 pas : `t`,
`condition`, `tempC`, `precipMm`, `precipProbability?`, `windKmh`, `isDay`) et `daily[]` (7 jours :
`t` minuit local, `condition`, `minC`, `maxC`, `precipMm`, `precipProbability?`, `uvIndexMax?`,
`sunrise`, `sunset`). Erreurs : 404 appareil inconnu, 400 `KIND_MISMATCH` si l'appareil n'est pas
une météo, 501 `NOT_IMPLEMENTED` si son plugin n'a pas de `forecast?`, 503 tant que le plugin n'a
rien lu. Le plugin rend sa dernière lecture : appeler la route ne déclenche aucun appel externe.

Sources : `apps/server/src/http/routes.ts`, `apps/server/src/core/plugin-host.ts`,
`apps/server/test/integration.test.ts`.

### Mise à jour 2026-09-16 (nuit) — `GET /api/devices/:id/journal`

Le journal d'un appareil, à la demande : 404 si l'appareil est inconnu, 400 `KIND_MISMATCH` s'il ne
déclare pas la capacité `journal`, sinon `deviceJournalSchema`. L'hôte appelle `plugin.journal?()`
(`NOT_IMPLEMENTED` à défaut) sous le même délai que les commandes, exactement comme `/forecast`. Rien
n'est poussé par le WebSocket : c'est la vue qui redemande.

Sources : `apps/server/src/http/routes.ts`, `apps/server/src/core/plugin-host.ts`, `apps/server/src/core/plugin.ts`.

### Mise à jour 2026-09-17 — `GET /api/devices/:id/consumption`

Troisième route « à la demande » du même moule que `/forecast` et `/journal` : un historique n'est
pas un état, il n'a rien à faire dans les messages WebSocket poussés à chaque sondage.

| Route | Réponse |
|---|---|
| `GET /api/devices/:id/consumption` | `deviceConsumptionSchema` — `404 NOT_FOUND` si l'appareil est inconnu, `400 KIND_MISMATCH` s'il ne déclare pas la capacité `water_usage`, `NOT_IMPLEMENTED` si son plugin n'expose pas `consumption?` |

Le contrat vit dans `packages/shared/src/protocol/http.ts` :

```ts
consumptionPointSchema = { t: number /* ms epoch, début du pas */, litres: number >= 0 }
deviceConsumptionSchema = { deviceId, hourly: [], daily: [], monthly: [] }
```

Trois décisions portées par le schéma lui-même :

- **Trois séries, parce qu'aucune ne se déduit des autres** à coût raisonnable : `hourly` dit à
  quelle heure on tire, `daily` couvre **la semaine ET le mois** (une seule série pour deux
  échelles), `monthly` donne les douze mois.
- **Chaque point porte ce qui a été consommé PENDANT son pas, jamais un cumul.** Un graphique
  additionne des barres, il ne dérive pas un compteur. La soustraction est au plugin, parce que lui
  seul sait quand son compteur est reparti de zéro.
- **Un pas jamais mesuré est ABSENT du tableau, pas à zéro.** Même règle que `cover.position`
  optionnelle : « absent » se lit « inconnu », et un zéro affirmerait une mesure qu'on n'a pas. Côté
  client, c'est ce qui permet de dessiner un tiret là où il n'y a pas de barre.


### Mise à jour 2026-09-18 — `PUT /api/house/rooms/:roomId/openings/:openingId`

Cinquième écriture de `house.json` ouverte à l'interface, et la **première dont la cible est
imbriquée** : une ouverture vit dans `rooms[i].openings[j]`, là où les précédentes patchaient un
objet de premier niveau. D'où les deux paramètres de chemin — la pièce d'abord, l'ouverture ensuite.

```
PUT /api/house/rooms/:roomId/openings/:openingId
corps : openingPatchSchema  { type?, segment?, offset?, width?, height?, sill? }
→ { house }   +  diffusion WebSocket { type: 'house', house }
```

Mécanique identique au reste (`apps/server/src/http/routes.ts`, `patchOpeningInJson` dans
`packages/shared/src/house/place.ts`) : patch **partiel** du JSON brut, `parseHouse` avant écriture,
`.bak` + écriture atomique, maison **entière** rediffusée. Deux façons d'échouer, et c'est voulu :

- corps mal formé → `ZodError` → **400**, comme les autres routes de patch ;
- corps valide mais maison invalide (ouverture qui déborde son mur, en chevauche une autre, dépasse
  le plafond) → `parseHouse` refuse → **400**, et **le fichier reste intact** (vérifié par
  `apps/server/src/http/openings.test.ts`, 6 tests sur une copie temporaire de `demo-house.json`).

Le second cas est le filet, pas le mode de fonctionnement normal : l'UI borne ses champs et ramène
tout geste à un emplacement admissible avant d'envoyer (`packages/shared/src/house/openings.ts`, voir
`../2_maison/2_1_geometrie.md`).

Le **lien ouvrant ↔ ouverture** n'a pas de route à lui : il passe par la route de placement existante,
`PUT /api/house/devices/:id` avec `{ openingId }` — chaîne vide pour délier. Lier ré-ancre l'appareil
sur la pièce qui porte l'ouverture, sans quoi la validation croisée refuserait la maison
(`../2_maison/2_0_format-house-json.md`).

Côté client, `Transport.saveOpening(roomId, openingId, patch) → Promise<House>` (HTTP et mock in
process) — `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.


### Mise à jour 2026-09-18 (bis) — `POST` et `DELETE` sur les ouvertures d'une pièce

La route de patch ci-dessus réglait une ouverture existante. Deux routes sœurs la complètent : la
sixième et la septième écritures de `house.json` ouvertes à l'interface.

```
POST   /api/house/rooms/:roomId/openings
corps : newOpeningSchema  { id, name?, type, segment, offset, width, height, sill? }
→ { house }   +  diffusion WebSocket { type: 'house', house }

DELETE /api/house/rooms/:roomId/openings/:openingId
→ { house }   +  diffusion WebSocket { type: 'house', house }
```

**Le corps du `POST` est une ouverture COMPLÈTE, pas un patch** — et c'est le point de conception.
Le serveur ne devine ni le mur, ni la place : c'est la 3D qui sait où le doigt s'est posé, et le
client tient déjà toute la géométrie (`slotFromPoint`, `newOpeningDims` de
`packages/shared/src/house/openings.ts`). L'id est **choisi par le client**, comme celui d'un champ
de panneaux, et doit être libre dans **toute la maison** et pas seulement dans sa pièce : un ouvrant
nomme son ouverture par `devices[].openingId` sans dire où elle est.

**Le `DELETE` libère l'ouvrant dans la même écriture** (`removeOpeningFromJson`) : sans cela, le
volet nommerait une ouverture disparue, `parseHouse` refuserait la maison **entière**, et la
suppression échouerait par un 400 qui ne dirait rien de la vraie raison. Le volet reste dans la
maison, sans ouverture — la vue Ouvrants le compte alors parmi ceux qui attendent une place.

Mécanique identique au reste (`apps/server/src/http/routes.ts`, `addOpeningToJson` /
`removeOpeningFromJson` dans `packages/shared/src/house/place.ts`) : JSON brut, `parseHouse` avant
écriture, `.bak` + écriture atomique, maison entière rediffusée. Les façons d'échouer, toutes en
**400**, fichier intact : corps mal formé (`ZodError`), pièce inconnue, id déjà pris, ouverture
absente — et, filet plutôt que mode normal, une maison que `parseHouse` refuse (ouverture qui
chevauche une voisine). Vérifié par cinq tests de plus dans `apps/server/src/http/openings.test.ts`,
sur une copie temporaire de `demo-house.json`.

Côté client : `Transport.addOpening(roomId, opening)` et `Transport.removeOpening(roomId, openingId)`
— HTTP et mock in process, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-09-18 — `PUT /api/house/render`

**Sixième écriture de house.json**, et la première dont la cible n'est ni un appareil, ni une pièce,
ni un niveau : le **réglage de la lumière de la scène 3D** (`render.tuning`, cf.
`../2_maison/2_0_format-house-json.md`).

Le corps est le réglage **entier** (`sceneTuningSchema`), pas un patch : il sort d'un banc qui tient
les seize valeurs sous les yeux, il n'y a rien à fusionner. Même mécanique que le reste — `parse`
zod (ZodError → 400), patch du JSON brut, réécriture atomique par `updateHouseFile`, diffusion de la
**maison entière** par `{ type: 'house' }` à tous les écrans connectés. Un réglage neutre ne
répond pas différemment : il retire la section, et la maison rediffusée n'a plus de `render`.

Les bornes sont dures : un `ringWidth: 12` vaut **400**, il n'est pas ramené en silence à sa valeur
neutre.

Sources : `apps/server/src/http/routes.ts`, `apps/server/src/http/render.test.ts`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts` (`saveRenderTuning`).

### Mise à jour 2026-09-18 (2) — les places de stationnement, sixième écriture de `house.json`

Trois routes, calquées sur celles des ouvertures — poser, régler, retirer — parce que c'est le même
geste : on relève au sol ce qu'aucun fabricant ne sait donner (cf.
`../2_maison/2_0_format-house-json.md` pour le format et la règle d'accrochage).

| Méthode | Route | Corps | Effet |
|---|---|---|---|
| POST | `/api/house/parkings` | `newParkingSchema` | ajoute une place (ce qui s'y range, où, dans quel sens) |
| PUT | `/api/house/parkings/:id` | `parkingPatchSchema` | règle une place (cotes, centre, cap, rayon d'accroche) |
| DELETE | `/api/house/parkings/:id` | — | retire une place |

Même mécanique que le reste : patch du JSON BRUT, `parseHouse` avant écriture (c'est lui qui refuse
une place aux cotes impossibles ou à l'id déjà pris), écriture atomique, diffusion de la maison
réécrite à tous les écrans (`{ type: 'house', house }`).

Rien à libérer ailleurs à la suppression, contrairement à une ouverture qui libère son ouvrant : une
place n'est nommée par aucun appareil — c'est ELLE qui nomme le sien (`deviceId` d'une base). L'engin
qui s'y rangeait retourne simplement à son point GPS.

Sources : `apps/server/src/http/routes.ts`, `packages/shared/src/house/place.ts`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-09-19 — un `/status` de plugin rend compte de ce que le plugin fait SEUL

Les routes propres à un plugin (`/api/plugins/<id>/status`, `/pair`, `/raw`…) restent détaillées sur
la page du plugin, mais l'une d'elles mérite une règle générale, apprise à ses dépens le 2026-09-19.

Un plugin qui agit **de sa propre initiative** — sans qu'aucun geste de l'utilisateur n'attende une
réponse — n'a, par construction, personne à qui rendre compte : la requête HTTP qui aurait porté
l'erreur n'existe pas. Le réveil de charge Renault a ainsi échoué pendant des heures en ne
laissant qu'un `warn` dans la console du serveur. La santé disait `ok`, l'UI ne montrait rien : c'était exact, et parfaitement trompeur.

D'où la forme retenue, à reprendre pour toute action autonome d'un plugin — `GET
/api/plugins/renault/status` rend désormais :

```jsonc
"lastWake": { "at": 1789819304000, "result": "sent", "detail": "HVAC_CHARGE_SYNCH CREATED <id>" }
```

Trois issues et non deux : `sent`, `deferred` (**le tiers a dit « pas maintenant »** — un refus
normal, pas une panne) et `failed`. Confondre les deux dernières est ce qui rendait le journal
illisible. `null` tant qu'aucune tentative n'a eu lieu depuis le démarrage — l'état ne survit pas au
redémarrage, et n'a pas à le faire : ce qu'on veut savoir, c'est où en est la boucle qui tourne.

Détail et cas d'espèce dans `../3_plugins/3_9_renault.md` ; le piège complet dans
`../6_faq/6_1_pieges-runtime.md`.

Sources : `apps/server/src/plugins/renault/index.ts` (`WakeOutcome`, `RenaultStatus`),
`apps/web/src/api/transport.ts`, `apps/web/src/components/RenaultLinkCard.vue`.

### Mise à jour 2026-09-23 — une troisième façade : le serveur MCP `/mcp`

À côté du REST et du WebSocket, le serveur répond sur `/mcp` (Model Context Protocol, Streamable
HTTP, sans état). Ce n'est pas une nouvelle API : ses outils rejouent les lectures et les chaînes de
validation des routes ci-dessus (`send_command` = `POST /api/devices/:id/command`, `recall_scene` =
`POST /api/scenes/:id/recall`). Réservé à localhost (403 sinon) *(Dépassé : jeton OAuth exigé partout, `auth.ts`, et Host/Origin limités à `ALLOWED_HOSTS` plus l'hôte de `MCP_PUBLIC_URL`, `apps/server/src/mcp/server.ts` — constat du lint du 2026-10-06 ; voir `1_7_serveur-mcp.md`)*. Détail dans `1_7_serveur-mcp.md`.
*(Le REST lui-même est sans compte sur le réseau local, mais sous l'adresse publique il exige une session depuis le 2026-10-06 : voir « Mise à jour 2026-10-06 (soir) — session sous l'adresse publique » en bas de page.)*

Sources : `apps/server/src/mcp/server.ts`, `apps/server/src/app.ts`.

### Mise à jour 2026-09-23 — automatisations : cinq routes et un message

| Méthode | Route | Corps / réponse |
|---|---|---|
| `GET` | `/api/automations` | `{ automations: AutomationEntry[] }` (`automationsResponseSchema`) |
| `PUT` | `/api/automations/:id` | corps `automationBodySchema` (ni `id`, pris dans l'URL, ni `updatedAt`, posé par le serveur) → `{ automation }` (`automationResponseSchema`) ; crée ou remplace |
| `PATCH` | `/api/automations/:id` | `{ enabled }` seul (`automationPatchSchema`) → `{ automation }` ; 404 si inconnue |
| `DELETE` | `/api/automations/:id` | `{ ok: true }` ; 404 si inconnue |
| `POST` | `/api/automations/:id/run` | `{ run }` (`automationRunResponseSchema`) : **les actions seules**, sans déclencheur ni « sauf si » ; **200 même en échec partiel**, `run.errors` dit ce qui a raté appareil par appareil |

Un id hors `[a-z0-9_.-]{1,64}` ou un corps invalide → 400 (`ZodError`). `AutomationEntry` =
`{ automation, status }`, le statut (santé, références manquantes, dernière et prochaine exécution)
étant **calculé par le serveur**.

WebSocket : nouveau message **`{ type: 'automations', automations }`** — la liste ENTIÈRE avec statuts,
poussée à chaque changement (écriture, exécution, appareil apparu ou disparu), dédoublonnée côté
moteur. Le `snapshot` gagne `automations` (`.default([])` : un serveur plus ancien passe la
validation). Détail : `1_8_automatisations.md`.

Sources : `packages/shared/src/protocol/{http,ws}.ts`, `apps/server/src/http/routes.ts`,
`apps/server/src/ws/hub.ts`, `apps/web/src/api/httpTransport.ts`.

### Mise à jour 2026-09-26 — `PUT /api/house/relief`

Écrit le relief du terrain (`site.relief`, cf. `../2_maison/2_0_format-house-json.md`). Corps : le
relief **entier** (`reliefSchema`) ou `null`. Un relief plat, ou `null`, retire le champ. Même
mécanique que `PUT /api/house/render` : `parse` zod (ZodError → 400, par exemple des rangées de
longueurs différentes), patch du JSON brut (`setReliefInJson`), réécriture atomique, diffusion de la
maison par `{ type: 'house' }`.

Côté client, `Transport.saveRelief` (HTTP et mock in process). L'**import IGN** ne passe pas par le
serveur : le service d'altimétrie de la Géoplateforme a un CORS ouvert et le navigateur l'appelle
directement, comme la météo (`apps/web/src/lib/ignRelief.ts`, cf. `../4_ui/4_1_navigation-et-panneaux.md`).

Sources : `apps/server/src/http/routes.ts`, `apps/server/src/http/relief.test.ts`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-09-28 — les éléments du jardin, sur le modèle des places

| Méthode | Route | Corps | Effet |
|---|---|---|---|
| POST | `/api/house/garden` | `newGardenItemSchema` | plante un élément (id choisi par l'UI, famille, pied, hauteur, cap, graine, espèce) |
| PUT | `/api/house/garden/:id` | `gardenItemPatchSchema` | règle un élément (seuls les champs présents ; `species: ''` revient à la forme générique) |
| DELETE | `/api/house/garden/:id` | — | retire un élément |

Mécanique identique aux places : `parse` zod (ZodError → 400), patch du JSON brut, `parseHouse`
(qui refuse un id déjà pris ailleurs dans la maison), écriture atomique, diffusion
`{ type: 'house', house }`. Rien à libérer à la suppression : aucun objet ne nomme un élément du
jardin. Côté client : `Transport.addGardenItem` / `saveGardenItem` / `removeGardenItem` (HTTP et
mock in-process). Contexte : `../2_maison/2_2_jardin.md`.

Sources : `apps/server/src/http/routes.ts`, `packages/shared/src/house/place.ts`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, arbre de travail non commité après cf60c7d.

### Mise à jour 2026-10-01 — `PUT /api/house/terrain`

Écriture de `house.json` sur le modèle de `PUT /api/house/relief` : corps = le polygone ENTIER du
contour (`polygonSchema`, ZodError → 400), `setTerrainInJson` sur le JSON brut, écriture atomique,
diffusion `{ type: 'house', house }`, réponse `{ house }`. Un contour qui se croise
(`isSimplePolygon`) → `PlacementError` → 400, rien n'est écrit. Un relief existant est agrandi dans
la même écriture (`../2_maison/2_0_format-house-json.md`). Côté client : `Transport.saveTerrain(polygon)`
(HTTP et mock in-process), `house.saveTerrain` dans le store (notification
`relief.outline.saveError` en cas d'échec).

Sources : `apps/server/src/http/routes.ts`, `apps/server/src/http/terrain.test.ts`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/stores/house.ts`.

### Mise à jour 2026-10-02 — `GET /api/devices/:id/release-notes?lang=`

Quatrième route « à la demande » du moule de `/forecast`, `/journal`, `/consumption` : 404 si
l'appareil est inconnu, 400 `KIND_MISMATCH` sans la capacité `release_notes`, sinon
`deviceReleaseNotesSchema` : `installedVersion?`, `pending? { version, notes[] }`, `history[]` (de la
plus récente à la plus ancienne), `fetchedAt?`, et `lang?` — la langue SERVIE. `lang` demandé est
normalisé par `releaseNotesLang` (deux lettres, sinon `en`) ; le plugin rend l'anglais tant qu'il n'a
pas la langue voulue, et l'UI le signale. Une note : `title`, `description?`, `imageUrl?` (sombre),
`lightImageUrl?` (clair). Texte du fabricant, jamais traduit par Kasbah. Hôte :
`PluginHost.releaseNotes(deviceId, lang)` → `plugin.releaseNotes?(externalId, lang)`, sous le délai
des commandes. Web : `Transport.getReleaseNotes(deviceId, lang)` (HTTP et simulation).

Sources : `packages/shared/src/protocol/http.ts`, `apps/server/src/http/routes.ts`,
`apps/server/src/core/{plugin,plugin-host}.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-10-03 — `PUT /api/house/appearance` et l'historique de house.json

`PUT /api/house/appearance` : corps `AppearancePatch` (`appearancePatchSchema`, voir
`../2_maison/2_0_format-house-json.md`), un patch = toute une séance d'édition (plusieurs pièces et la
façade), écrite d'un coup ou pas du tout. 400 sur une pièce inconnue, une finition hors de sa
surface ou une teinte non permise ; rien n'est écrit. Réponse `{ house }` et diffusion `house` comme
les autres écritures. Web : `Transport.saveAppearance(patch)` (HTTP et simulation).

**Historique** : `updateHouseFile` (`apps/server/src/config/house.ts`) garde désormais, en plus du
`.bak` (une seule version, écrasée à chaque écriture), une copie horodatée de la version remplacée
dans `history/` à côté du fichier (`<nom>.<ISO>.json`), 50 versions par maison
(`HOUSE_HISTORY_KEEP`). Pour TOUTES les écritures de l'UI, pas seulement l'apparence ;
`house/history/` est ignoré par git.

Tests : `apps/server/src/http/appearance.test.ts` (écriture, copie dans `history/`, trois refus sans écriture).

Sources : `apps/server/src/http/routes.ts`, `apps/server/src/config/house.ts`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-10-03 (bis) — `PUT /api/house/edit` remplace `/api/house/appearance`

Une seule route pour une séance d'édition : corps `HouseEditPatch` (`houseEditPatchSchema` :
`appearance` et/ou `shapes`, voir `../2_maison/2_0_format-house-json.md`), écrite d'un coup ou pas
du tout. `blocking` non vide → `SurveyError`, **400 `INVALID_SURVEY`** (pièces qui se chevauchent,
cloison trop mince), rien n'est écrit ; une ouverture qui ne tient plus → 400 `INVALID_HOUSE`
(`parseHouse`). `/api/house/appearance` (section précédente) est retirée : seul le code du même
jour l'appelait. Web : `Transport.saveEdit(patch)` remplace `saveAppearance` (HTTP et simulation, qui
applique le même refus).

Tests : `apps/server/src/http/edit.test.ts` (apparence, historique, cotes écrites et maison
convertie, chevauchement refusé sans écriture).

Sources : `apps/server/src/http/routes.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-10-04 — routes du plugin `toutemonannee`

Plugin sans appareil (comme `agenda`) : `GET /api/plugins/toutemonannee/school` rend tout
(devoirs, cahier de liaison, publications, filtres) et chaque écriture rend la même forme —
`POST /login` (`{ username, password }`, mot de passe jamais gardé), `POST /logout`, `POST /refresh`,
`PUT /homework/:journal/:id/done`, `PUT /filters`, `PUT /posts/seen`. Détail et API amont du site :
`../3_plugins/3_23_toutemonannee.md`. Côté web : `school*` dans `Transport` (`httpTransport.ts`),
classe de démonstration en mode simulé (`mockSchool.ts`).

### Mise à jour 2026-10-06 (soir) — session sous l'adresse publique

Sous le nom public (`MCP_PUBLIC_URL`, derrière un proxy inverse), tout le REST et le WebSocket passent
par une porte à session ; sur le réseau local, rien ne change. Raisons, cookie, révocation, blocage :
`1_7_serveur-mcp.md`, même date.

**Routes ajoutées** (`apps/server/src/http/session.ts`) : `GET /api/session` → `{ user }` (le compte, ou
`null` sur le réseau local : le web s'en sert pour savoir s'il est connecté) ; `GET` / `POST /login`
(page HTML rendue par le serveur, formulaire `application/x-www-form-urlencoded`, 303 vers `next` si
réussi, 401 ou 429 avec la page) ; `POST /logout` (303 vers `/login`). Sur le réseau local, `/login`
renvoie vers `/`.

**Codes d'erreur ajoutés** (forme habituelle `{ error: { code, message } }`) :

| Code | Statut | Quand |
|---|---|---|
| `AUTH_REQUIRED` | 401 | Pas de session valide sous le nom public, pour tout ce qui n'est pas une navigation (API, WebSocket, scripts, CSS, images). Une navigation (`GET` avec `Accept: text/html`, hors `/api/` et `/ws`) part en 302 vers `/login?next=…`. |
| `BAD_ORIGIN` | 403 | `Origin` différent de l'origine publique sur une écriture (`/login` et `/logout` compris) ou sur toute demande de WebSocket (en-tête `upgrade` : `/ws` ET les flux des caméras sous `/api/plugins/<id>/cameras/…`). |
| `LAN_ONLY` | 403 | `/api/mcp/users` sous le nom public, MÊME connecté. |

Le client web n'agit que sur **`AUTH_REQUIRED`**, pas sur tout 401 : la route du plugin `automower` rend
déjà 401 sur le réseau local pour le compte Husqvarna (voir `1_4_app-web.md`). Un refus ne se lit pas sur
un WebSocket (la poignée de main échoue sans corps) : à la coupure, le web interroge `/api/session`.

Sources : `apps/server/src/http/session.ts`, `apps/server/src/http/session.test.ts`.

### Mise à jour 2026-10-08 — propriétés : deux routes et `propertyId` au snapshot

| Route | Réponse |
|---|---|
| `GET /api/properties` | `{ activeId, switchable, properties: [{ id, name, kind }] }` (`propertiesResponseSchema`, `packages/shared/src/protocol/http.ts`). Une seule maison (`KASBAH_HOUSE_FILE` donné) : une seule entrée et `switchable: false`. `kind` = `house` ou `apartment`. |
| `POST /api/properties/:id/select` | **202** : la bascule a lieu *après* la réponse (le serveur se reconstruit, `1_2`). **404** propriété inconnue, **409 `NOT_SWITCHABLE`** hors mode démonstration. |

Le message `snapshot` du WebSocket gagne **`propertyId`** (optionnel, `packages/shared/src/protocol/ws.ts`,
`apps/server/src/ws/hub.ts`) : à la reconnexion après une bascule, un écran qui le trouve différent de
celui qu'il montrait se recharge. Le champ est optionnel dans le schéma : absent quand le serveur ne
fournit pas de propriétés.

Le transport web (`apps/web/src/api/transport.ts`) expose `getProperties()` et `selectProperty(id)` ;
l'implémentation in-process (`mockTransport.ts`) répond sans serveur, en retenant le choix dans le
navigateur ; le store et le menu sont décrits dans `../4_ui/4_1_navigation-et-panneaux.md`.

Autre changement de contrat relevé dans la même session : le plugin `mock` répond **503
`DEVICE_UNAVAILABLE`** (et non plus 501) au rappel d'une ambiance qu'il ne connaît pas.

Sources : `apps/server/src/http/routes.ts`, `packages/shared/src/protocol/{http,ws}.ts`,
`apps/server/src/ws/hub.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-10-08 — `/api/health` et `/api/plugins` pour le compte qui demande

`GET /api/health`, `GET /api/plugins` et `PATCH /api/plugins/:id` gardent leur forme, mais pour un
utilisateur connecté (session sous l'adresse publique) la santé d'un plugin qui tient des comptes par
utilisateur — ytmusic, Mixcloud — est celle de **ses** comptes. Le réseau local voit celle de la maison.
Mécanique : `1_2_serveur-et-plugins.md`, mise à jour du 2026-10-08.

Sources : `apps/server/src/http/routes.ts`, `apps/server/src/core/plugin-host.ts`.


### Mise à jour 2026-10-10 — créer et dupliquer une propriété, `demo` et `canCreate`

| Route | Réponse |
|---|---|
| `POST /api/properties` | corps `newPropertyBodySchema` : `name`, `kind`, `origin { lat, lon, heading, alt? }`, `terrain { width, depth }?` (5 à 2000 m), `levelName`, `roomName` (1 à 60 caractères). **201** `{ id }` ; 400 si le corps est invalide ; **409 `NOT_SWITCHABLE`** hors serveur de démonstration. |
| `POST /api/properties/:id/duplicate` | corps `{ name }`. **201** `{ id }` de la copie ; même 409 hors démonstration ; 404 si l'id est inconnu. |

`GET /api/properties` gagne `canCreate?` (le serveur sait créer et dupliquer) et, par propriété,
`demo?` (elle se regarde, ne se modifie pas). Les deux sont optionnels : un serveur à une seule maison
ne les envoie pas.

**Nouveau code d'erreur : 409 `DEMO_READONLY`**, levé par toute écriture de `house.json` ou du fichier
d'automatisations d'une démo (`ReadOnlyHouseError`). Le client le traduit (`httpTransport.ts` :
`properties.readOnly`). Le mode in-process répond 409 à `createProperty` / `duplicateProperty`.

Sources : `packages/shared/src/protocol/http.ts`, `apps/server/src/http/routes.ts`,
`apps/server/src/config/house.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.


### Mise à jour 2026-10-10 (2) — `POST /api/properties/mode`, `mode` et `realAvailable`

| Route | Réponse |
|---|---|
| `POST /api/properties/mode` | corps `{ mode: 'demo' \| 'real' }` (`propertyModeBodySchema`, `PROPERTY_MODES`). **202** `{ ok: true }` : le serveur rouvre la propriété retenue dans ce mode **après** la réponse, comme `select`. 400 corps invalide ; **409 `NOT_SWITCHABLE`** si la maison est imposée (`KASBAH_HOUSE_FILE`) ; **409 `NO_REAL_PROPERTY`** si le réel n'a encore aucune propriété. |

`GET /api/properties` gagne `mode?` et `realAvailable?` (optionnels : absents sur une maison imposée).
**Changement de sens** de la liste : elle ne porte plus que les propriétés du **mode courant**, et non
plus démos et propriétés du poste ensemble comme le décrit la mise à jour précédente. `activeId` est
celle du mode. Le client attend que `mode` change pour recharger. Le mode in-process répond 409 à
`setPropertyMode`.

Sources : `packages/shared/src/protocol/http.ts`, `apps/server/src/http/routes.ts`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-10-10 (bis) — `select` vise une propriété de N'IMPORTE QUEL mode

Correctif (signalé par l'utilisateur : « unknown property » au « Créer » de l'assistant, en mode
démo). Depuis le lot C, `list()` ne rend que le mode courant ; `POST /api/properties/:id/select`
vérifiait l'id dans cette liste, donc une propriété réelle tout juste créée (ou dupliquée) depuis le
mode démo était refusée (404) — le fichier était pourtant écrit. La route demande désormais
`PropertyHost.has(id)` (le catalogue, tous modes) ; choisir une propriété fait passer dans son mode :
créer depuis la démo sort de la démo, comme voulu. Test : `apps/server/src/config/properties.test.ts`.

