# Application web : stores, transport, routage

> Dernière mise à jour : 2026-10-06
> Sources : `apps/web/src/main.ts`, `apps/web/src/stores/*.ts`, `apps/web/src/api/*.ts`, `apps/web/src/router/index.ts`, `apps/web/src/lib/optimistic.ts`, `apps/web/src/views/LightsView.vue`, `apps/web/src/components/home/PlacementControl.vue`, `apps/web/src/stores/scenes.ts`, `apps/web/src/lib/deviceState.ts`, `apps/web/src/lib/cover.ts`, `apps/web/src/components/devices/ForgetDeviceButton.vue`, `apps/web/src/lib/audioRouting.ts`, `apps/web/src/stores/house.ts`, `apps/web/src/composables/useRoomLights.ts`, `apps/web/src/views/VehiclesView.vue`, `apps/web/src/components/vehicles/VehicleMap.vue`, `apps/web/src/lib/map.ts`, `apps/web/src/composables/useConsumption.ts`, `apps/web/src/lib/consumption.ts`, `apps/web/src/stores/settings.ts`, `packages/shared/src/house/openings.ts`, `apps/web/src/composables/useMediaPosition.ts`, `apps/web/src/stores/localPlayer.ts`, `apps/web/src/stores/automations.ts`, `apps/web/src/lib/automations.ts`, `apps/web/src/composables/useAutomationNames.ts`

## Démarrage (`main.ts`)

`createApp(App).use(pinia).use(i18n).use(router).use(vuetify)` ; **avant le mount**, le store
`settings` applique le thème Vuetify + les variables CSS et la langue (aucun flash).

## Stores Pinia (setup stores)

| Store | Rôle |
|---|---|
| `settings` | Apparence (`light|dark|system|auto`), thème (`kasbah.theme`, 6 palettes dans `apps/web/src/themes/`), langue, plein écran, réglages de rendu 3D (style, ambiance, saison, qualité, projection, matières en images, météo, couverture nuageuse, visibilité, voile de mesure), mode édition de la maison, taille du foyer, grammes par tasse ; persistés dans `localStorage` (`kasbah.*`). `applyToVuetify` pose `data-theme` et les jetons de la palette (`--bg`, `--accent`…) sur `<html>` et appelle `theme.change(name)`. |
| `house` | Maison (`shallowRef`, immuable, ré-indexée par `indexHouse`), onglet de niveau (`garden | all | levelId`), pièce ou zone sélectionnée, clé d'appareil sélectionnée. `selectDevice` remonte la pièce et le niveau. |
| `devices` | Descripteurs et états (`shallowRef` d'objets remplacés par référence), statut de connexion, commandes en attente, santé serveur, `sendCommand` (optimiste + rollback), `runScene`. |
| `notifications` | File de toasts (`v-snackbar-queue`). |

> Mis à jour le 2026-10-06 (lint) : ligne `settings` alignée sur `apps/web/src/stores/settings.ts` — apparence à quatre valeurs (`auto` suit le soleil), thème à 6 palettes à la place de l'accent à 4 choix, réglages de rendu 3D et autres préférences ajoutés depuis.


**Invariant** : un état d'appareil est **remplacé**, jamais muté → la scène 3D détecte les
changements par `next !== prev`.

## Transport (`api/`)

Interface `Transport` : `getHouse`, `getDevices`, `getHealth`, `getHistory`, `sendCommand`,
`pairHue`, `connect(handlers)`. Deux implémentations :
- `httpTransport.ts` : fetch relatif + WebSocket reconnectant (voir `1_3_protocole-rest-ws.md`).
- `mockTransport.ts` : `Simulation` in-process (`VITE_INPROCESS_MOCK=1`, tests de composants,
  démo statique) ; historique synthétisé à partir de la géométrie solaire.

`getTransport()` choisit selon `import.meta.env.VITE_INPROCESS_MOCK` ; `setTransport()` sert aux tests.

## Mise à jour optimiste (`lib/optimistic.ts`)

`optimisticPatch(state, cmd)` calcule l'effet attendu (lampe on, volet `closing`, consigne…) ;
`sendCommand` l'applique, incrémente `pending[id]`, puis en cas d'erreur **restaure l'état
précédent seulement si aucun état plus récent n'est arrivé** (`updatedAt` inchangé) et affiche un
toast traduit (`errors.<code>`).

## Routage

Historique **HTML5** depuis le 2026-10-04 (`/`, `/energy`, `/vehicles`, `/settings`) :
`createWebHistory(import.meta.env.BASE_URL)`, build en `base: '/'` (`apps/web/vite.config.ts`). Un
rechargement de `/automations/new` repose sur le repli SPA du serveur (`apps/server/src/http/static.ts`)
et de Vite en dev ; `base: '/'` est nécessaire, sinon les chemins relatifs (`./assets/…`,
`BASE_URL` des modèles et textures) se résolvent sous `/automations/`. Un ancien lien `/#/music`
est réécrit en `/music` au chargement (`history.replaceState` avant `createRouter`), pas lors d'un
changement de hash dans une page déjà ouverte. Auparavant, l'historique était **par hash** (`#/energy`)
et le build en `base: './'`, sans réécriture serveur. La vue Maison est gardée en `keep-alive` (scène 3D coûteuse).
La sélection est reflétée dans la query (`?level=&room=&device=`) et ré-appliquée au chargement
**une seule fois** quand l'index de la maison devient disponible, puis rejouée sur la scène quand
celle-ci est prête (`watch(scene.ready)`).

## Résolution d'une sélection (`composables/useDeviceResolver.ts`)

Une clé est un id d'appareil **maison** (lié ou non) ou un id de **plugin** non placé ;
`resolveDevice` renvoie `{ houseDevice, deviceId, descriptor, state, name }`.

## Tests

`stores/devices.test.ts` (snapshot via mock, optimiste + rollback, availability), `lib/lib.test.ts`
(patchs, formats, icônes, parité des clés fr/en), `components/controls/LightControl.test.ts`.

### Mise à jour 2026-09-05 — maison effective et vue Lumières

Le store `house` expose maintenant deux maisons : `house` (le JSON tel que servi) et **`effective`**
= `house` + les appareils **auto-placés** (`autoPlaceDevices`, cf.
`../2_maison/2_0_format-house-json.md`). `effective` alimente `indexHouse`, donc les panneaux, le
résumé et la scène 3D (`HomeView` passe `house.effective` à `useHouseScene`) ; `house` seule ne sert
plus qu'aux champs de niveau supérieur (nom, origine, scènes, zones). Le store `house` dépend donc
du store `devices` (descripteurs) — dépendance à sens unique, `devices` n'importe pas `house`.

Nouvelle route `#/lights` (`views/LightsView.vue`), cinquième entrée du rail. La sélection de
niveau/pièce/appareil reste propre à la vue Maison.

### Mise à jour 2026-09-07 — mode « déplacer » dans le store `house`, `placeDevice` dans le transport

`Transport.placeDevice(id, placement)` renvoie la maison réécrite : `httpTransport` fait le
`PUT /api/house/devices/:id` ; `mockTransport` applique `placeDeviceInJson` **en mémoire** (rien n'est
écrit) et pousse un message `house`, comme le serveur. C'est ce mode (`VITE_INPROCESS_MOCK=1`) qui sert
à vérifier l'UI sans toucher au fichier de l'utilisateur.

Store `house` — l'édition vit à côté de la sélection, jamais dans `house` tant qu'elle n'est pas
écrite :

| Membre | Rôle |
|---|---|
| `selectedDevice` | `HouseDevice` de la clé sélectionnée (index de `effective`, donc auto-placés compris). |
| `placing` | mode « déplacer » ; `startPlacing()` mémorise le placement d'origine, `stopPlacing()` ; **coupé automatiquement** quand `selectedKey` change (`watch`). |
| `draft` | `{ position, roomId }` en cours (aperçu 3D) : `previewPosition(xy, roomId)` (glissement, `roomId` null = hors pièce → on garde l'ancienne) et `previewHeight(z)` (curseur). Arrondi 5 cm. |
| `savePlacement(override?)` | envoie `draft` (ou la position courante) complété de `mount`/`position` ; ajoute `deviceId` (+ `roomId`, `mount`) pour un auto-placé ; remplace `house` par la réponse ; toast `place.saveError` sinon. `draft` est vidé dans tous les cas → le marqueur revient à la position enregistrée. |
| `canRevert` / `revertPlacement()` | renvoie au placement d'entrée dans le mode (position, pièce, `mount`) par une nouvelle écriture. |

Le store `devices` expose `serverHouse` (dernier message WS `house`) ; le store `house` le suit par un
`watch` — la dépendance reste à sens unique (`house` → `devices`). Après sa propre écriture, un client
reçoit donc la maison deux fois (REST puis WS) : objets égaux, rebâtis des marqueurs seulement.

### Mise à jour 2026-09-08 — store `scenes` (scènes des fabricants)

Store à part plutôt qu'un rayon du store `devices` : ce sont d'autres objets, avec d'autres règles.
Le couplage est réduit à une ligne — `devices.start()` passe chaque trame aux deux stores
(`onMessage: (msg) => { applyMessage(msg); scenes.apply(msg) }`), donc un seul canal alimente les
deux et le store `devices` n'a pas à connaître la sémantique des scènes.

- Même invariant que `devices` : la carte est **remplacée**, jamais mutée.
- `apply` traite `snapshot` / `scenes` / `scene` et ignore le reste.
- `forRoom(nom)` / `forHouse(noms[])` : rapprochement par `roomKey` (sans accents ni casse, comme
  l'auto-placement). Ce qu'aucune pièce ne réclame — zones du fabricant, pièces inconnues — remonte
  au niveau maison plutôt que de disparaître.
- `recall(sceneId, mode)` est **optimiste** : la scène visée passe active et ses sœurs du même groupe
  s'éteignent tout de suite (`withActive`, miroir de la règle du serveur). Retour arrière si le pont
  refuse, **seulement** si la carte est encore celle qu'on a posée (comparaison de référence) : une
  trame WebSocket arrivée entre-temps a toujours raison.
- `Transport` gagne `getScenes()` et `recallScene(sceneId, recall)`. La simulation in-process n'a pas
  de fabricant : elle renvoie une liste vide et refuse le rappel en `NOT_IMPLEMENTED`.

Test : `apps/web/src/stores/scenes.test.ts` (rapprochement par nom, activation exclusive par groupe,
rappel optimiste puis retour arrière avec notification).

### Mise à jour 2026-09-08 — `setRoomOrder` dans le store `house`

`Transport` gagne `setRoomOrder(levelId, roomIds)` (HTTP + simulation in-process, qui applique
`setRoomOrderInJson` en mémoire et pousse le message `house` comme le ferait le serveur).

L'action du store est **optimiste**, comme le rappel de scène : elle repose `level.roomOrder` dans la
maison locale avant l'aller-retour — le geste vient de se terminer sous le doigt, la liste ne doit pas
revenir en arrière une demi-seconde — puis remplace la maison par celle que le serveur renvoie. En cas
d'échec elle restaure la maison précédente (comparaison de référence) et notifie
(`lights.orderError`). Rien n'est mis en cache localement : l'ordre vit dans `house.json`, donc il
suit l'utilisateur d'un écran à l'autre.

### Mise à jour 2026-09-08 — position VISÉE d'un ouvrant tenue par le store

Le besoin vient du matériel : une box TaHoma ne publie la position d'un volet **qu'à la fin de la
course** (voir `../3_plugins/3_4_somfy-tahoma.md`). Pendant les ~20 s de descente elle réémet
l'ancienne valeur. Un patch optimiste ne suffit donc pas — il serait écrasé par la trame suivante,
et le curseur reviendrait en arrière juste après le geste.

Le store `devices` tient une **cible** par ouvrant, hors de l'état :

```ts
targets: Record<deviceId, { position: number; moved: boolean; at: number; frozen?: boolean }>
targetPosition(id): number | undefined      // SURCOUCHE : l'appelant écrit `target ?? state.position`
```

C'est bien une surcouche et non un remplacement : l'état reste la source de vérité, et un composant
qui reçoit un `state` en prop doit continuer de s'en servir quand aucune cible n'est tenue.

Pose de la cible dans `sendCommand` : 100 pour `cover.open`, 0 pour `cover.close`, la valeur demandée
pour `cover.set_position`. **Rien** si la position est déjà atteinte (à 1 % près) — sinon la pastille
resterait affichée faute d'un nouvel état, l'appareil n'en émettant aucun quand rien ne change.

`resolveTarget` la confronte à chaque état reçu et l'abandonne quand :

| Cas | Effet |
|---|---|
| position atteinte (± 1) | la réalité rejoint l'intention |
| `moved && motion === 'stopped'` et position différente | **arrêté ailleurs** : obstacle, `stop`, refus du moteur → retour à la réalité |
| plus de 90 s | l'appareil ne répond plus comme prévu |
| appareil devenu indisponible | plus rien à viser |
| commande refusée par le serveur | idem, dans le chemin d'erreur de `sendCommand` |

Trois contraintes non évidentes, chacune couverte par un test de `stores/devices.test.ts` :

- **`moved` vient du SERVEUR, pas de nous.** La cible se pose donc **après** le patch optimiste :
  celui-ci écrit `motion` de notre propre chef, et `resolveTarget` y verrait une confirmation de
  mouvement — la première trame réelle (souvent `stopped`, avant que le moteur démarre) passerait
  alors pour « arrêté ailleurs » et effacerait la cible aussitôt posée.
- **Le délai de péremption se mesure sur `Date.now()`**, jamais sur `state.updatedAt` : celui-ci vient
  du serveur, et l'horloge simulée accélérée du plugin `mock` fait bondir ses valeurs de plusieurs
  minutes entre deux trames — la cible était jetée dès la première.
- **`cover.stop` ne supprime pas la cible, il GÈLE l'affichage** (`frozen`). La position d'arrivée est
  inconnue, mais celle de l'état est périmée elle aussi : relâcher tout de suite faisait revenir le
  curseur à la position d'AVANT le geste avant de se poser sur la vraie. La première trame reçue lève
  le gel, quoi qu'elle dise. La valeur à geler doit être relevée **avant** le patch optimiste, qui
  fait abandonner la cible en cours.

### Mise à jour 2026-09-08 — quatre lectures d'un état, à ne pas confondre (`lib/deviceState.ts`)

Elles se ressemblent assez pour qu'on en oublie une (c'est arrivé deux fois de suite) :

| Fonction | Répond à | Reçoit la cible |
|---|---|---|
| `isDeviceOn(s)` | l'appareil est-il **actif** ? (un volet **ouvert** l'est) | non — teinte d'icône, compteurs, marqueurs 3D |
| `toggleChecked(s, aimed?)` | valeur **affichée** par l'interrupteur (un volet **fermé** est coché) | oui |
| `toggleCommand(s, aimed?)` | ce qu'un **clic** envoie | oui |
| `isDeviceBusy(s, aiming?)` | l'appareil **exécute**-t-il encore ? | oui |

`toggleCommand` en particulier : sans la cible, un volet qui ferme depuis 75 garde `position: 75`,
donc la bascule renvoie **encore** `cover.close` — impossible d'inverser une course en cours. Et
`isDeviceBusy` n'est pas `isPending` : ce dernier ne dure que l'aller-retour HTTP (~50 ms chez
Somfy), l'occupation d'un ouvrant court jusqu'à la fin du mouvement.

Règle qui se dégage : **tout affichage qui dépend de la position d'un ouvrant doit recevoir la
cible** — pas seulement le curseur, mais aussi la grande valeur du panneau et l'interrupteur.

### Mise à jour 2026-09-09 — `Transport.cameraStreamUrl` et lecture MSE

`Transport` gagne `cameraStreamUrl(deviceId)` : l'URL WebSocket du flux vidéo d'une caméra, par
convention `/api/plugins/<plugin>/cameras/<externalId>/stream` (le transport HTTP la construit sur
la même origine que `/ws`, le transport simulé rend `null`). `components/controls/CameraVideo.vue`
la consomme par Media Source Extensions : ligne JSON d'entête (codecs), entête MP4, fragments ;
tampon tenu à un fragment du direct, purge derrière la tête de lecture. Détail et compromis de
latence dans `../3_plugins/3_5_google-nest.md`.

### Mise à jour 2026-09-10 — `forgetDevice` : faire oublier un appareil à son plugin

`Transport` gagne `forgetDevice(deviceId)` : `DELETE /api/plugins/<plugin>/devices/<externalId>`, URL
construite depuis le `deviceId` par la même convention que `cameraStreamUrl`
(`1_3_protocole-rest-ws.md`) ; le transport simulé refuse (`NOT_IMPLEMENTED` : la simulation déclare ses
appareils, elle n'en découvre aucun, il n'y a rien à oublier).

Le store `devices` l'expose par `forget(deviceId)` : il **n'enlève rien localement** — la liste revient du
serveur par le message `devices`, source unique de l'inventaire — et se contente de signaler l'échec par
une notification, comme `sendCommand`. L'UI ne propose le geste qu'aux appareils marqués
`meta.forgettable` et indisponibles (`../4_ui/4_1_navigation-et-panneaux.md`).

### Mise à jour 2026-09-10 — `lib/audioRouting.ts` : qui joue le son de qui

Le son d'un lecteur ne sort pas toujours de lui (TV en HDMI ARC → barre de son). `soundRouting(houseDevices, states)`
croise les liens `meta.audioOutput` du JSON (source → id maison du puits) avec les états : pour une source
`media_player` active dont `audioOutput.terminal` n'est pas `internal`, le puits **relaie** (`relays: puits → source`)
et la source est **silencieuse** (`silenced`, sauf `both`). Sans indication de la source (autre marque), la
déclaration est crue. `emitsSound(id, state, routing)` = l'appareil fait du bruit (lecture propre dont le son
sort de lui, ou relais) ; `relayLabel` = « Son de {name} · titre ». Le store `house` expose `soundRoutes`
(computed sur `effective` × `devices.states`) et `relaySource(pluginId)` → `{ descriptor, state, name }` de la
source, `name` étant le nom maison s'il existe. Les états publiés ne sont jamais modifiés : le relais est une
lecture de plus, comme les quatre autres de `deviceState.ts`. Tests dans `lib/lib.test.ts` (« routage du son »).

### Mise à jour 2026-09-11 — changer le NIVEAU d'un appareil déjà placé (`moveToLevel`)

Le mode « déplacer » ne savait changer que x;y (glissement), la hauteur et l'orientation : le niveau
d'ancrage n'était modifiable nulle part. Le glissement ne pouvait pas y suppléer — `HouseScene.roomAt`
ne cherche la pièce que **dans le niveau de l'appareil** — et seul un appareil *provisoire* suivait les
onglets de niveau. Résultat : une caméra posée au 1er ne pouvait pas rejoindre le niveau `toit`
(`../2_maison/2_0_format-house-json.md`), pourtant écrivable côté serveur depuis toujours
(`devicePlacementSchema.levelId`, `placeDeviceInJson`).

Le watch de `focusedLevelId` couvre désormais les deux cas, **tant que `placing` est vrai** :
provisoire → centre du niveau choisi (inchangé) ; appareil déjà placé → `moveToLevel(levelId)`, qui

- garde x;y,
- reprend la **pièce sous le point** dans le niveau d'arrivée (`pointInPolygon`) ; à défaut — niveau sans
  pièce, comme un toit — le niveau ancre seul,
- **recalcule z** par rapport au sol du niveau d'arrivée (`z + élévation d'origine − élévation d'arrivée`),
  pour que l'appareil ne bouge pas dans l'espace : c'est un ré-ancrage, pas un déplacement.

`savePlacement(override)` accepte `levelId`, posé **seulement si aucune pièce n'est envoyée** — le
serveur ignore `levelId` quand `roomId` est là, et efface la pièce quand le niveau ancre seul. Même
prudence dans `revertPlacement` : le niveau d'entrée n'est renvoyé que si aucune pièce ne l'ancre déjà,
sinon « Rétablir » aurait **sorti l'appareil de sa pièce** en rétablissant une simple hauteur.
`placingOrigin` mémorise donc aussi le niveau (`anchorLevel`, via `resolveDeviceLevelId`), et `canRevert`
le compare.

Hors du mode, un onglet ne fait toujours que naviguer. Vérifié dans l'app (pile in-process, aucune
écriture) : aller-retour étage ⇄ toit avec pièce retrouvée au retour, « Rétablir » complet, et onglets
sans effet hors mode.

### Mise à jour 2026-09-11 — `stores/plugins.ts`

Nouveau store, miroir de `GET /api/plugins` : la liste des plugins, leur activation, leurs
sous-items. Aucune valeur n'y est recalculée — chaque écriture rend l'inventaire complet, qu'on
adopte tel quel. Mise à jour optimiste avec retour arrière comme ailleurs, plus un `busy` par
plugin : allumer un fabricant demande une découverte, l'interrupteur reste affiché et attend au lieu
de disparaître (règle « rien ne bouge », `../4_ui/4_0_langage-visuel.md`).

`stores/scenes.ts` perd du même coup `pluginSettings`, `settingsOf`, `loadPluginSettings` et
`setAutoDynamicForNewScenes` : le réglage « nouvelles ambiances animées » est un réglage de plugin
comme les autres, il est servi par le store des plugins. Côté transport, `getPluginSettings` devient
`getPlugins`, et `setPluginSettings(pluginId, patch)` prend un **patch partiel**. Le transport de la
maquette in-process rend une liste vide : la simulation tourne dans la page, il n'y a pas de serveur
à régler.

### Mise à jour 2026-09-12 — taille et battants dans le placement, `coverActivity`, `useRoomLights`

**Placement.** `savePlacement({ size, leaves })` s'ajoute à `{ position, mount, yaw, levelId }` ; les
deux valeurs d'entrée dans le mode sont retenues par `placingOrigin`, comptent dans `canRevert` et
sont rétablies par « Rétablir ». Une taille **absente** à l'entrée ne peut pas être effacée du JSON :
on réécrit alors le défaut de la nature, qui donne le même dessin — même compromis que `yaw`, ramené
à 0 (`apps/web/src/stores/house.ts`).

**Ce qui se remarque chez un ouvrant.** `lib/cover.ts` gagne deux fonctions, posées là parce qu'elles
partagent la liste des natures avec le vocabulaire (`coverWords`) :

- `isFlatCover(descriptor)` — store banne, BSO : ce qui se déploie **à plat** ;
- `coverActivity(descriptor, position)` — la part de l'ouvrant qui **se remarque**, de 0 à 1. C'est
  l'inverse d'une nature à l'autre : d'un volet on retient qu'il est OUVERT, d'un store qu'il est
  DÉPLOYÉ — c'est déployé qu'il craint le vent. Position inconnue = 0, on n'affirme rien.

`isDeviceOn(state, descriptor?)` prend un descripteur **optionnel** et s'appuie dessus pour les
ouvrants (sans lui, la règle du volet). Les appelants le passent : `RoomBands`, `RoomPanel`,
`HomePanel`, `DevicePanel`, et `CoverMarker.isOn` côté 3D. Une seule règle gouverne donc la teinte
d'une ligne, la jauge de la vue Ouvrants et la pilule d'un marqueur : ils ne peuvent plus se
contredire.

**`composables/useRoomLights.ts`** : la lecture des lampes d'une pièce (toutes / joignables /
allumées), partagée par ses deux contrôles d'ensemble — l'interrupteur maître et le curseur de
luminosité. C'est l'INVENTAIRE qui décide de leur présence, jamais la joignabilité : un pont muet ne
doit pas faire disparaître un interrupteur sous le doigt.

### Mise à jour 2026-09-12 (bis) — `coverAtRest` : le doute penche du côté sûr

`lib/cover.ts` gagne deux notions de plus, décidées avec l'utilisateur :

- `isPassageCover(descriptor)` — portail, porte de garage : ce qui donne sur la rue ;
- `coverAtRest(descriptor, position)` — l'ouvrant est-il **au repos**, l'état où il ne demande rien à
  personne : **fermé** pour ce qui se tient debout, **remonté** pour un store. Et surtout : une
  **position inconnue est SUPPOSÉE au repos**. Une radio unidirectionnelle ne dit jamais où elle en
  est, et sans cette supposition un portail muet suffisait à faire croire que la maison n'était pas
  sécurisée — l'appui suivant l'aurait ouvert.

Trois lieux s'appuient dessus : l'interrupteur maître des ouvrants et les libellés
(`../4_ui/4_1_navigation-et-panneaux.md`), et le dessin de la scène (`1_5_scene-3d.md`).
`coverRestKey(descriptor)` donne le mot de ce repos — « Fermé » debout, « Remonté » pour un store —
pour que l'interface puisse MONTRER ce qu'elle suppose au lieu d'un « Inconnu » muet.

Ce qui ne change pas : `toggleChecked` garde sa règle (position inconnue = interrupteur de ligne NON
coché, donc la bascule **ferme**, la direction sûre), et les compteurs du résumé continuent d'exclure
les positions inconnues de leur numérateur ET de leur dénominateur — un compteur est une affirmation,
pas une décision.

### Mise à jour 2026-09-12 (ter) — un NIVEAU se sélectionne, et le retour remonte d'un cran

Jusqu'ici le store ne connaissait que deux sélections : une **pièce ou zone** (`selectedRoomId`) et un
**appareil** (`selectedKey`). Un appareil posé sur un niveau hors de toute pièce — la caméra du toit,
l'installation solaire — n'avait donc pas de parent : son fil d'Ariane disait « Maison ».

`selectedLevelId` complète les deux autres, avec trois fonctions (`stores/house.ts`) :

- `selectLevel(levelId)` — onglet, panneau et cadrage sur ce niveau (le tap sur le toit en 3D passe
  par là, voir `1_5_scene-3d.md`) ;
- `backFromRoom()` — le retour d'une pièce va au **niveau** qui la porte ; une zone du jardin ou un
  niveau ramènent à la maison ;
- `backFromDevice()` — le retour d'un appareil va à sa pièce, sa zone, ou à défaut **le niveau** qui
  l'ancre.

La hiérarchie est donc : appareil → pièce / zone / **niveau** → maison.

**Le niveau sélectionné se referme tout seul** dès qu'autre chose prend la main : un autre onglet
(`setFloorTab`), une pièce (`selectRoom`), un appareil (`selectDevice`), un placement en cours
(`startPlacingNew`). Sans quoi le panneau aurait montré « Toit » pendant qu'on regarde le 1er.

**Pas d'entrée d'URL dédiée** : `?level=` reflète déjà l'onglet, que `selectLevel` positionne. Un
rechargement rouvre donc le bon niveau **en vue**, avec le panneau maison — assumé, pour ne pas
ajouter un troisième paramètre qui dirait presque la même chose.

Couvert par `apps/web/src/stores/house.test.ts` (parent d'un appareil hors pièce, remontée d'une pièce
à son niveau, fermeture du niveau au changement d'onglet).


### Mise à jour 2026-09-12 (quater) — le store sait régler un champ de panneaux

Le store `house` (`apps/web/src/stores/house.ts`) gagne un second mode d'édition, à côté du mode
« déplacer » d'un appareil, pour les champs de panneaux :

- `editingArrayId` / `editingArraySite` / `arrayDraft` — le champ ouvert, l'installation d'où on l'a
  ouvert, et l'origine en cours de **glissement** (aperçu, jamais écrite avant le dépôt) ;
- `addArray` / `saveArray` / `removeArray` / `writeArray` — les écritures, via les routes
  `/api/house/arrays/:id` (`1_3_protocole-rest-ws.md`) ;
- `editArray(id)` — ouvrir un champ depuis AILLEURS que la carte de son installation (le panneau d'un
  module) : on sélectionne l'installation **puis** on ouvre le champ. L'ordre compte, il est commenté
  dans le code : `selectDevice` cadre le niveau de l'installation (elle peut être au rez-de-chaussée)
  et c'est `startEditingArray`, ensuite, qui ramène sur le niveau du champ ;
- `siteOf` / `siteOfDevice` / `arraysOf` — l'installation d'un champ (celle qu'il nomme, ou la seule
  de la maison), et les champs d'une installation. `backFromDevice` s'en sert : le parent d'un MODULE
  est son installation, pas le toit qui le porte ;
- `previewArrayOrigin` / `dropArray` — le glissement : on attrape n'importe quel module et l'origine
  se déplace du même écart, mesuré depuis la position **écrite** du module (rien ne s'accumule) ;
- `freeInverters(site)` — les onduleurs du même plugin que le site qu'aucun champ ne porte et
  qu'aucune entrée de la maison ne pose, **triés par nom, chiffres compris** (la passerelle les
  annonce dans son ordre à elle) ;
- `hoveredKey` / `hoverSlot` — l'emplacement mis en avant depuis la grille des onduleurs. La vue le
  traduit en `scene.setSelected`, et rend la main à la sélection quand le survol s'arrête.

**Un garde-fou de sélection.** Quitter l'installation referme le réglage (la carte qui le portait
n'est plus là) ; y ARRIVER ne le referme pas — sans quoi `editArray` se serait refermé sur lui-même.

**Un piège de navigation corrigé.** `HomeView.onDeviceBack` appelait `backToAll()` dès qu'aucune pièce
ni aucun niveau n'était sélectionné. Or le retour d'un module atterrit sur l'**installation**, qui peut
être posée sur un niveau sans pièce (le toit) : « Tout » effaçait alors la sélection et le fil
d'Ariane retombait sur « Maison ». Il ne se déclenche plus si le retour a laissé un appareil
sélectionné.


### Mise à jour 2026-09-14 — quatre méthodes Tesla dans `Transport`, et la santé qu'il faut aller chercher

`Transport` gagne les quatre routes propres au plugin Tesla, sur le modèle de `nestAuthUrl` et
`enphaseTokenStatus` : `teslaStatus()` (où en est la mise en route), `teslaRegister()` (enregistrer le
domaine auprès du fabricant), `teslaAuthUrl()` (URL de consentement) et `teslaRotateKey()` (nouvelle
paire de clés). `mockTransport` les refuse toutes en `NOT_IMPLEMENTED` : la simulation n'a pas de
compte constructeur.

**La santé des plugins se DEMANDE** (`devices.refreshHealth()`), elle n'arrive ni par le WebSocket ni
par un sondage du serveur. Jusqu'ici seul l'écran Réglages la lisait, au montage ; la vue Véhicules la
lit désormais aussi, pour sa jauge de quota — en arrivant, à chaque battement de son horloge de 30 s,
et après chaque commande, un réveil ou une relecture consommant le crédit. À garder en tête avant
d'afficher une information de santé ailleurs : sans redemande, elle date du dernier passage dans
Réglages.

Une conséquence sur les cartes de mise en route (`TeslaLinkCard`) : elles lisent la santé dans
l'**inventaire des plugins** (`stores/plugins`, que l'interrupteur met à jour dans la même réponse) et
non dans `devices.health`, sinon elles n'apparaissent qu'après un rechargement de la page. Symptôme et
explication dans `../6_faq/6_1_pieges-runtime.md`.

Nouveau morceau côté vue : `lib/map.ts` (pur, testé — cadrage de la carte du véhicule, style du plan
selon le thème, pourcentage d'un quota) et `components/vehicles/VehicleMap.vue`, qui n'est que
l'application MapLibre de ces décisions. Le partage habituel de la maison : le calcul testable dans
`lib/`, le rendu dans le composant.

### Mise à jour 2026-09-15 — `moveToLevel` ne s'appelle plus depuis l'onglet

Corrige la mise à jour du 2026-09-11 ci-dessus : le `watch(focusedLevelId)` qui, en mode « déplacer »,
emmenait l'appareil sur le niveau de l'onglet est **retiré**. Un clic d'onglet pour aller regarder
ailleurs ré-ancrait l'appareil sans le dire — c'est ainsi qu'une lampe du salon s'est retrouvée ancrée
au toit, donc invisible depuis le 1er. `moveToLevel` (inchangé : x;y gardés, pièce sous le point,
hauteur conservée dans l'espace) n'est plus appelé que par `setPlacementLevel(levelId)`, branché sur
le **sélecteur de niveau** de la section « Emplacement » du panneau (`4_ui/4_1_navigation-et-panneaux.md`),
qui fait ensuite suivre la vue. `placementLevelId` donne au sélecteur le niveau d'ancrage courant.
Source : `apps/web/src/stores/house.ts`, test `apps/web/src/stores/house.test.ts`.

### Mise à jour 2026-09-16 — le store porte l'aperçu de la teinte d'une carrosserie

`bodyColorPreview` (`shallowRef<{ key, color } | null>`) et `previewBodyColor(pluginDeviceId, color)`
rejoignent le store `house`. C'est la teinte MONTRÉE le temps qu'on la choisit : la scène la peint à
chaque mouvement du sélecteur, et `setDeviceTuning` ne part qu'au choix validé — autrement chaque
nuance survolée réécrirait `house.json`. `null` rend la teinte d'avant, pour un choix abandonné.

La fonction traduit l'identifiant de plugin en **clé de marqueur** (`houseDeviceFor(id)?.id`, à
défaut l'identifiant de plugin lui-même : une voiture n'a pas à être déclarée dans la maison pour
apparaître dans la scène, cf. `drawable` dans `1_5_scene-3d.md`). `HomeView` l'observe et la passe à
la scène ; rien n'écoute dans la vue Véhicules, où l'appel est simplement sans effet.

C'est le même partage des rôles que le brouillon de déplacement (`draft` / `previewHeight` →
`moveMarker`) : l'aperçu vit dans le store, l'écriture est un geste distinct.

Sources : `apps/web/src/stores/house.ts`, `apps/web/src/views/HomeView.vue`,
`apps/web/src/components/vehicles/VehicleTuning.vue`.

### Mise à jour 2026-09-16 — météo : `getForecast`, `useWeather`, `useForecast`

- `Transport.getForecast(deviceId)` : HTTP → `GET /api/devices/:id/forecast` validé par
  `weatherForecastSchema` ; mock in-process → `Simulation.forecast(externalId)` (mêmes codes d'erreur
  que les commandes).
- `composables/useWeather.ts` est le **seul point d'accès** à la météo côté UI : `entry` (le premier
  appareil `weather` disponible, sinon le premier tout court, grisé), `live` (l'état seulement s'il
  est disponible), `cloudiness` (0-1 pour la scène). `useForecast(deviceId)` charge à l'ouverture et
  toutes les dix minutes — la cadence du sondage serveur. Widget, vue Météo et `useHouseScene`
  passent par là, jamais par l'appareil directement : le jour où une station personnelle publiera
  des `sensor`, la consolidation se fera ici.
- Nouvelle route `weather` (`views/WeatherView.vue`), neuvième entrée du rail.

Sources : `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/composables/useWeather.ts`,
`apps/web/src/router/index.ts`.

### Mise à jour 2026-09-17 — `getConsumption`, `useConsumption`, et le foyer dans les réglages

`Transport.getConsumption(deviceId)` complète `getForecast` / `getJournal` : lecture à la demande de
`GET /api/devices/:id/consumption`, validée contre `deviceConsumptionSchema`
(`apps/web/src/api/httpTransport.ts`). Le `mockTransport` en fabrique un historique plausible
(72 h, 60 j, 15 mois ; profil horaire 90–400 L/j avec pointes matin et soir) : sans lui la vue Eau
ne serait atteignable par personne en preview.

`composables/useConsumption.ts` suit le patron de `useForecast` — chargement à la demande, une série
par appareil, rien de poussé. `lib/consumption.ts` met la réponse en colonnes pour le graphique :
un nombre de colonnes **fixe par période** (`PERIOD_STEPS` : 24 / 7 / 31 / 12), jamais le nombre de
points reçus, et un pas non mesuré reste `litres: null` — **jamais `0`**, c'est ce qui distingue à
l'écran « mesuré à 0 L » de « pas de mesure ». `week` et `month` lisent tous deux `daily`.

Le store `settings` gagne `householdSize` (`kasbah.householdSize`, 1 à 10, défaut 3). **C'est une
préférence d'affichage du navigateur, jamais une donnée de `house.json`** : elle ne sert qu'à
placer le repère de moyenne française sur le graphique d'eau, et la maison n'a pas à connaître le
nombre d'occupants. Même frontière que les réglages de rendu 3D (cf. la section « ce qui n'est PAS
une préférence de tablette » dans `../4_ui/4_2_theme-et-langues.md`).


### Mise à jour 2026-09-18 — le store tient le réglage d'une ouverture, et son BROUILLON n'est pas un calque

Le mode édition des ouvertures (`../4_ui/4_1_navigation-et-panneaux.md`) ajoute au store `house` un
état de sélection parallèle à celui d'un appareil, et une famille d'actions :

| Nom | Ce que c'est |
|---|---|
| `selectedOpeningId` | l'ouverture en cours de réglage, `null` sinon |
| `selectedOpening` | `{ room, opening }` **brouillon compris** — c'est ce que le panneau AFFICHE |
| `savedOpening` | la même, telle qu'elle est ÉCRITE — c'est elle qu'on compare pour « Rétablir » |
| `openingDraft` | `OpeningPatch \| null`, pas encore écrit |
| `openingBounds` / `openingCeiling` | bornes des champs (`openingLimits`) et hauteur sous plafond |
| `openingDevices` | les ouvrants liés à l'ouverture |
| `selectOpening(id)` | sélectionne, cadre la pièce, vide la sélection d'appareil |
| `previewOpeningAt([x, y])` | pendant le glissement : pose le brouillon à la place admissible la plus proche |
| `saveOpening(patch?)` / `dropOpening()` | écrit (fin de geste = écrire le brouillon) |
| `revertOpening()` / `canRevertOpening` | rétablit les cotes trouvées à la sélection |
| `setOpeningDevice(id \| null)` | lie / délie un ouvrant |

**Le point de conception.** Le brouillon **n'est pas un calque** que la scène simulerait par-dessus la
maison : il est injecté dans la maison rendue, en tête du store (`withOpeningDraft`, appliqué avant
`withPanelArrays` dans `expanded`). La scène ne reçoit donc qu'une **maison**, qu'elle dessine comme
une autre — allège, linteau et vitrage se refont comme si le JSON était déjà écrit. C'est ce qui
garantit que **ce qu'on voit pendant le geste est exactement ce qu'on gardera**, et c'est aussi ce qui
permet le chemin de reconstruction partielle côté 3D (`1_5_scene-3d.md`).

Corollaire à connaître : le brouillon fait partie de `effective`, donc tout ce qui lit la maison
effective pendant un geste voit la cote provisoire. `savedOpening` existe précisément pour les rares
lectures qui doivent voir le JSON.

`previewOpeningAt` passe la place **actuelle** à `slotFromPoint` (paramètre `from`) : c'est là que se
joue la butée contre une voisine plutôt que le saut par-dessus (`../2_maison/2_1_geometrie.md`), et
les offsets sont arrondis au centimètre avant d'entrer dans le brouillon. Un point qu'aucun mur ne
peut recevoir ne bouge rien.

`setOpeningDevice` n'a pas de route à lui : il passe par `placeDevice` avec `{ openingId }` et
**délie d'abord** l'ouvrant précédent (chaîne vide), pour qu'un volet ne reste pas accroché à une
fenêtre dont on vient de le retirer. Deux allers-retours donc, dans cet ordre.

Transport : `saveOpening(roomId, openingId, patch) → Promise<House>`, HTTP et mock in-process
(`1_3_protocole-rest-ws.md`). Pas de mise à jour optimiste ici — la réponse
**est** la maison, et l'échec se dit par une notification (`opening.saveError`).

Sources : `apps/web/src/stores/house.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`packages/shared/src/house/openings.ts`.


### Mise à jour 2026-09-18 (2) — `setCoverOpening` : une ouverture ne porte qu'UN ouvrant

La liaison ouvrant ↔ ouverture se noue désormais depuis **deux écrans** — le panneau d'une ouverture
(« quel ouvrant habille cette fenêtre ? ») et la vue Ouvrants (« où va ce volet ? », cf.
`../4_ui/4_1_navigation-et-panneaux.md`). Deux sens, **une seule écriture** :
`setCoverOpening(houseDeviceId, openingId | null)`. `setOpeningDevice`, vu depuis l'ouverture, s'y
ramène. La règle ne vit qu'à un endroit, faute de quoi elle finit écrite deux fois et différemment.

La règle, justement : **une ouverture ne porte qu'un ouvrant**. En affecter un **libère d'abord**
celui qui s'y trouvait (une écriture `openingId: ''` par occupant, puis l'écriture voulue). Ce n'est
pas une protection contre l'utilisateur : reprendre une ouverture déjà prise est un geste **voulu**,
les deux écrans montrent d'ailleurs les ouvertures occupées sans les masquer, juste en le disant.

Le serveur complète le geste de son côté : lier **ré-ancre l'appareil sur la pièce qui porte
l'ouverture**, parce que la validation croisée l'exige (cf. `../2_maison/2_0_format-house-json.md`).
Le store n'a donc pas à s'en occuper — mais il faut le savoir pour ne pas s'étonner qu'un volet
change de pièce en se liant.

`coversWithoutOpening` (liste de travail des ouvrants à poser) est décrit avec la vue Ouvrants,
puisque c'est là qu'il s'affiche.

Sources : `apps/web/src/stores/house.ts` (`setCoverOpening`, `setOpeningDevice`,
`coversWithoutOpening`), `apps/web/src/lib/cover.ts`.

## Mise à jour 2026-09-22 — quatre routes de plus dans le transport, et la position en composable

> **`ytmusicSeek` et `YtmusicSession.startS` ont été supprimés le même jour** : voir la section
> suivante. `useMediaPosition`, lui, n'a pas bougé.

**Transport** (`apps/web/src/api/transport.ts`, `httpTransport.ts`, `mockTransport.ts`) : trois
méthodes ytmusic s'ajoutent — `ytmusicSessions()`, `ytmusicTransfer({fromDeviceId,toDeviceId})`,
`ytmusicSeek({deviceId,positionS})` — et `ytmusicPlay` accepte `durationS`. Le type
`YtmusicSession` porte ce que le serveur sait d'un flux en cours : `startS` (décalage du flux, à
ajouter à la position publiée par le lecteur), `durationS` du catalogue, titre / artiste / pochette.
Comme les autres méthodes de plugin, elles sont **hors** du protocole d'appareils : rien dans le
store `devices`, tout dans la vue qui les appelle. Côté **mock**, `ytmusicSessions()` rend une liste
**vide** plutôt qu'un 501 : la page Musique s'y ouvre et montre les lecteurs simulés, simplement sans
rien à transférer (`ytmusicSeek` / `ytmusicTransfer` restent en `NOT_IMPLEMENTED`).

**`composables/useMediaPosition.ts`** sort la lecture de position de `MediaPlayerControl` pour la
partager avec le lecteur de la page Musique. Elle répond à un fait du protocole : **un appareil ne
pousse pas sa position**, le plugin la relit (dix secondes côté Sonos — *correctif 2026-09-22 soir :
2 s pour un Sonos, `SONOS_POLL_MS` ; les 10 s sont celles du Cast, `DEFAULT_MEDIA_POLL_MS`*). Le composable avance donc la
valeur localement, à la demi-seconde, depuis le dernier relevé — repère posé quand la **position ou
le morceau** change, pas sur `updatedAt` (un changement de volume l'aurait fait bouger). Deux
précautions valent leur ligne : le compteur se **fige net** au passage en pause, et un relevé reçu en
pause qui s'écarte de moins de 2,5 s est **ignoré** (il date d'avant le geste ; au-delà, c'est un
vrai déplacement). Une durée n'est une durée que **positive** (`-0.001` de Prime Video = inconnue).

Sources : `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`apps/web/src/composables/useMediaPosition.ts`, `../3_plugins/3_16_ytmusic.md`,
`../6_faq/6_1_pieges-runtime.md`.

## Mise à jour 2026-09-22 (2) — `ytmusicSeek` disparaît, la position redevient celle du lecteur

La section précédente décrit l'état du **matin**. Le proxy ytmusic s'est mis à servir un
« fichier » MP3 de taille connue (`../3_plugins/3_16_ytmusic.md`), et le côté web s'en trouve
**allégé** — c'est le signe que le changement était bon :

- **`ytmusicSeek` est supprimé** de `Transport`, de `httpTransport` et de `mockTransport` : se
  déplacer dans un titre est une commande d'appareil (`media_player.seek`), pas une route de plugin.
  `MusicView.barSeek` passe donc par `devices.sendCommand`, et n'est plus `async`.
- **`YtmusicSession` perd `startS`.** Il ne reste que `deviceId`, `videoId`, `sid`, `durationS`,
  titre, artiste, pochette. Le commentaire de `durationS` a changé de sens : ce n'est plus « la
  durée que le flux n'annonce pas » mais une **doublure**, le lecteur la connaissant aussi par la
  taille du fichier.
- **`MusicPlayerBar`** : la position affichée est celle du lecteur, plafonnée à la durée ; la durée est
  celle du **lecteur** et retombe sur celle de la session (constat live : le Sonos ne publie pas la
  durée de ce flux). `canSeek` ne dépend plus du fait que le flux soit à nous, seulement de la
  **capacité `seek`** du lecteur — une ligne de moins et une règle plus juste.
- **`ListeningSessions`** applique le filtre « c'est lisible » (`readable` : ni URL, ni identifiant
  hexadécimal de 24 caractères) **aussi à `nowPlaying.source`**, et plus seulement au titre : la
  ligne de repli affichait sinon l'URL du proxy comme nom de source.
- Le mock garde une liste de sessions **vide** ; seul `ytmusicTransfer` y reste en
  `NOT_IMPLEMENTED`.

Sources : `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`apps/web/src/components/music/{MusicPlayerBar,ListeningSessions}.vue`,
`apps/web/src/views/MusicView.vue`, `../3_plugins/3_16_ytmusic.md`.

## Mise à jour 2026-09-22 (3) — une seule position de lecteur, et un curseur qui tient sa cible

Fin d'après-midi du même jour, deux symptômes **vus en live** sur la barre de `/music` et sur le
panneau appareil : après un clic dans le curseur, la lecture « passait par un autre endroit » avant
d'atteindre la cible ; et en pause, le timecode n'était pas stable.

**La cause n'est pas un bug mais un empilement de trois vérités.** Un seul geste de seek produit
successivement trois positions différentes dans le store :

1. la **mise à jour optimiste** écrit tout de suite la cible (`lib/optimistic.ts`,
   `case 'media_player.seek'` → `nowPlaying.positionS = cmd.positionS`) ;
2. le plugin publie ensuite un relevé **encore antérieur au geste** — c'est du sondage, pas du push
   (`SONOS_POLL_MS`, défaut **2 s**) ;
3. puis arrive le vrai relevé, conforme à la cible.

Rien ne distingue (2) de (3) autrement que par sa valeur : d'où un affichage qui rebondit. En pause,
le même retard suffit à faire osciller le compteur, puisque le dernier relevé date d'avant le geste.

**Deux composables, partagés par les deux surfaces** (`composables/useMediaPosition.ts`) :

- `useMediaPosition(state)` — inchangé dans son principe (position avancée localement, figée nette à
  la pause, reprise d'où elle s'était figée). Le seuil de tolérance en pause **devient une constante
  exportée**, `MEDIA_POSITION_SLACK_S = 2.5` (avant : `PAUSED_REANCHOR_S`, privée) : le test et le
  wiki nomment désormais le même chiffre que le code.
- `useSeekHold(published, deviceId?)` → `{ seekDraft, beginSeek, holding }`. Au relâcher du curseur,
  `beginSeek(v)` arrondit la cible à la seconde, **rend la valeur à envoyer** au lecteur, la garde
  affichée (`seekDraft`) et retient le **point de départ**. La tenue se relâche quand la position
  publiée est **plus proche de la cible que du point de départ** — et non au bout d'une distance
  fixe : un déplacement d'une seconde doit tenir lui aussi face à un relevé stagnant
  (`Math.abs(pos - target) < Math.abs(pos - origin)`). Changer de lecteur relâche tout (`deviceId`).

**Le dédoublonnage est fait.** `components/controls/MediaPlayerControl.vue` perd son propre repère
local, son `ticker`, ses `position` / `duration` / `hasPosition` et son `seekDraft` (−30 lignes) et
appelle les deux composables ; `components/music/MusicPlayerBar.vue` remplace sa tenue maison (un
`holding` relâché au **premier** relevé, quel qu'il soit) par `useSeekHold`. Le panneau appareil
portait d'ailleurs la cause du second symptôme dans son ancienne ligne : son repère se reposait
aussi sur `props.state.playback`, donc la pause le recalait sur le relevé périmé.

> **Correction de la section du matin** : elle annonçait que le composable « sort la lecture de
> position de `MediaPlayerControl` pour la partager ». C'était vrai de l'**extraction** — la copie
> du panneau, elle, a vécu jusqu'à cette session. Depuis cette section, il n'y a plus qu'une
> implémentation.

> **Correction de chiffre** : la même section (et l'entrée FAQ du jour) disent « le plugin la relit
> toutes les dix secondes (Sonos) ». Le code dit l'inverse du couple : **Sonos sonde à 2 s**
> (`SONOS_POLL_MS`, `apps/server/src/plugins/sonos/index.ts`, borné 0,5–30 s) et c'est **Cast** qui
> est à 10 s (`DEFAULT_MEDIA_POLL_MS`, `apps/server/src/plugins/google_cast/channel.ts`). La règle,
> elle, ne change pas : entre deux relevés, l'application avance seule.

**L'écho optimiste, réglé le jour même** : l'écho du point (1) vaut exactement la cible et
satisfaisait aussitôt la condition de relâche — la tenue tombait au tick suivant l'envoi, avant le
relevé périmé du point (2). La tenue a donc un **minimum** (`SEEK_HOLD_MIN_MS`, 2 s : l'écho ne
compte pas) et un **maximum** (`SEEK_HOLD_MAX_MS`, 8 s : un lecteur qui ne confirme jamais ne fige
pas le curseur) ; entre les deux, c'est le rapprochement de la cible qui relâche.

**Tests** : `apps/web/src/composables/useMediaPosition.test.ts` (neuf) couvre les règles — le relevé
dans la marge ignoré en pause, le saut au-delà suivi, l'écho optimiste puis le relevé périmé tenus
et le vrai relevé qui relâche, l'abandon au maximum, le seek d'une seconde qui ne se relâche pas sur
son point de départ, le changement d'appareil ; `MediaPlayerControl.test.ts` vérifie la même tenue à
travers le composant (curseur relâché à 120 s, écho à 120 puis relevé à 42 s : l'affichage reste à
`2:00` ; relevé à 119 s après la tenue minimale : `1:59`).

Sources : `apps/web/src/composables/useMediaPosition.ts`,
`apps/web/src/components/controls/MediaPlayerControl.vue`,
`apps/web/src/components/music/MusicPlayerBar.vue`, `apps/web/src/lib/optimistic.ts`,
`apps/web/src/stores/devices.ts` (`sendCommand`), `../4_ui/4_1_navigation-et-panneaux.md`,
`../6_faq/6_1_pieges-runtime.md`.

## Mise à jour 2026-09-22 (2) — cache de recherche et volume au fil du geste

**Cache de la dernière recherche** (`MusicView.vue`) : aller voir un appareil dans la vue 3D puis
revenir remonte la vue, et la MÊME requête repartait au serveur, donc à InnerTube. `lastSearch`
(terme + résultat) est déclaré dans un bloc `<script>` **de module**, pas dans `<script setup>` : un
`let` de setup vit par INSTANCE et serait perdu à chaque remontage. Le terme sert de clé — s'il
change, on redemande ; la croix « effacer » vide le cache ; un rechargement de page redonne des
résultats frais. Vérifié en comptant les appels à `/api/plugins/ytmusic/search` : 1 pour la première
recherche, 1 après un aller-retour vers l'accueil, 2 après un nouveau terme.

**Volume appliqué pendant le glissement** (`MusicPlayerBar.vue`) : la commande partait au relâché
(`@end`), ce qui rendait impossible de régler à l'oreille. Elle part maintenant au fil du geste, au
plus une fois toutes les `VOLUME_THROTTLE_MS` (200 ms), plus la valeur finale au relâché. Pendant le
geste, le relevé de l'appareil est IGNORÉ (`sliding`) : sinon un sondage en retard faisait sauter le
pouce. Mesure d'un glissement 45 → 92 : l'état de l'enceinte suit en cours de route
(45, 50, 63, 75, 92) au lieu de ne bouger qu'à la fin.

**Type `YtmusicStreamQuality`** dans le transport : `YtmusicSession.quality` est optionnel, un
serveur plus ancien que l'affichage reste donc lisible.

## Mise à jour 2026-09-22 (4) — neuf méthodes de file d'attente dans le transport

La file d'attente ytmusic (serveur : `../3_plugins/3_16_ytmusic.md`, « (5) » ; page :
`../4_ui/4_1_navigation-et-panneaux.md`, « (6) ») ajoute à `Transport` une méthode par route :
`ytmusicQueuePlay({deviceId, tracks, startIndex?})`, `ytmusicQueue(deviceId)`,
`ytmusicQueueAdd({deviceId, tracks, where})` (rend `started` : vrai si rien ne jouait et que l'ajout
a lancé la lecture), `ytmusicQueueNext`, `ytmusicQueuePrevious`, `ytmusicQueueJump(deviceId, index)`,
`ytmusicQueueRepeat(deviceId, mode)`, `ytmusicQueueRemove(deviceId, index)`, `ytmusicQueueClear`.
Toutes rendent la file (`YtmusicQueue` : `items`, `index`, `repeat`), ce qui permet à la vue de la
recopier dans sa session locale sans attendre le prochain `GET /sessions`.

Nouveaux types : `YtmusicRepeat` (`'off' | 'once' | 'loop'`, répétition du TITRE courant),
`YtmusicQueueTrack` (ce que `/play` accepte d'un titre) et `YtmusicQueue`. `YtmusicSession` gagne
`queue?: { length, index, repeat } | null` — optionnel, pour la même raison que `quality`. Comme les
autres méthodes de plugin, tout reste **hors du store `devices`** : c'est `MusicView` qui les appelle.
Côté **mock**, les neuf méthodes lèvent `501 NOT_IMPLEMENTED` (pas de flux YouTube Music simulé).
`ytmusicPlay` reste dans le transport, mais la page passe désormais par `ytmusicQueuePlay`.

Sources : `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`apps/web/src/views/MusicView.vue`.

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/api/transport.ts`, `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-22 (5) — Humeurs et genres dans le transport

`ytmusicExplore(hl?)` → `YtmusicExplore` (`forYou` / `moods` / `genres`, chacun `{ title, categories:
YtmusicExploreCategory[] }`) et `ytmusicExploreCategory(params, hl?)` → `{ shelves:
YtmusicExploreShelf[] }` ; 501 en mock comme les autres méthodes ytmusic. `hl` = `locale` de vue-i18n.

Sources : `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-23 (6) — nouveautés et pochettes dans le transport

`ytmusicExploreNew(hl?)` → `{ shelves }` et `ytmusicExploreCovers(hl?)` → `{ covers: Record<params,
string[]> }` ; 501 en mock.

### Mise à jour 2026-09-23 (7) — store `localPlayer` : ce navigateur comme lecteur

Nouveau store Pinia `apps/web/src/stores/localPlayer.ts` : la lecture **dans l'appareil qui affiche la
page**, par un `HTMLAudioElement` (serveur : `../3_plugins/3_16_ytmusic.md`, « (12) » ; page :
`../4_ui/4_1_navigation-et-panneaux.md`, « (16) »).

- **Hors de la vue, exprès** : la musique continue quand on quitte la page Musique.
- **Un lecteur synthétique** (`entry`) : un `DeviceEntry` d'id `local:<clientId>`, `pluginId: 'local'`,
  `kind: 'media_player'`, `deviceClass: 'speaker'`, capacités `playback`, `volume`, `mute`,
  `now_playing`, `track_skip`, `seek`, `play_url`. Le panneau Écoute et la barre du bas le rendent sans
  cas particulier ; seules les commandes passent par `local.command()` au lieu de
  `devices.sendCommand`. Il **n'est pas dans le store `devices`** : `MusicView` le place en tête de ses
  lecteurs. Aide `isLocalPlayer(id)` (préfixe `local:`).
- **Mémoire** : `kasbah.music.localClientId` (id tiré au hasard, identifie la session côté serveur)
  et `kasbah.music.localVolume`.
- **La file vit dans le navigateur**, aux règles de `queue.ts` — `afterEnd` et `jumpRepeat` y sont
  **dupliqués** depuis le serveur (dette connue, à garder synchrones à la main).
- API : `prime` (déverrouillage du son dans le geste), `playQueue`, `next`, `previous`, `jump`,
  `setRepeat`, `add`, `remove`, `clear`, `seek`, `stop`, `command`, et pour le transfert `snapshot`
  (position + file à donner au serveur) / `adopt` (reprendre ce que le serveur rend). Media Session API
  (écran verrouillé).

**Transport** : `ytmusicLocalPlay(track & { clientId, nextVideoId? })` → `{ streamUrl, session }` ;
`ytmusicTransfer` accepte `positionS?` et `queue?` et peut rendre `session?` / `queue?`. Le serveur
rendant un **chemin relatif**, `httpTransport.ts` le préfixe de sa base (dans `ytmusicLocalPlay`, et
dans `ytmusicTransfer` quand la réponse porte une `session`, c'est-à-dire quand la cible est ce
navigateur). Mock : `ytmusicLocalPlay` lève `501 NOT_IMPLEMENTED`, comme les autres méthodes ytmusic.

Sources : `apps/web/src/stores/localPlayer.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-23 (8) — transport : le lecteur devient `music*`, Mixcloud s'ajoute

Le serveur sort la lecture du plugin YouTube Music vers un lecteur commun sous `/api/music`
(`1_6_lecteur-musique.md`) ; le transport suit.

**Renommages** (sections du 2026-09-22 et (7) ci-dessus, qui gardent les anciens noms) :
- types `YtmusicSession` → **`MusicSession`**, `YtmusicQueueTrack` → **`MusicTrack`**,
  `YtmusicQueue` → **`MusicQueue`**, `YtmusicRepeat` → **`MusicRepeat`**, `YtmusicStreamQuality` →
  **`MusicStreamQuality`** ;
- méthodes `ytmusicPlay` → **`musicPlay`**, `ytmusicSessions` → **`musicSessions`**,
  `ytmusicTransfer` → **`musicTransfer`**, `ytmusicLocalPlay` → **`musicLocalPlay`**, et les neuf
  `ytmusicQueue*` → **`musicQueue*`**, toutes vers `/api/music/*`. Les méthodes de **catalogue**
  gardent leur préfixe `ytmusic`.

**Une piste = `{ source, id }`.** `MusicTrack` et `MusicSession` portent `source` (`ytmusic`,
`mixcloud`) et `id` au lieu de `videoId` ; `musicLocalPlay` prend `next?: { source, id }` au lieu de
`nextVideoId`. `MusicTrack` gagne **`startS?`** : partir d'une position (reprise d'un mix).

**Nouveau : `musicProgress({ source, id, positionS, durationS?, ended? })`** → `POST
/api/music/progress`, pour ce que le serveur ne voit pas jouer : la lecture dans ce navigateur. Le
store `localPlayer` l'appelle **au plus toutes les 15 s** pendant l'écoute et **à la fin** (position =
durée, `ended: true`) ; un échec est avalé, la reprise étant un confort. `localPlayer.playQueue`
applique le `startS` de la piste lancée au **premier** lancement seulement, et range la file sans
`startS`. Mock : `musicProgress` ne fait rien, `musicSessions` rend une liste vide, le reste lève
`501`.

**Nouveau : les appels `mixcloud*`** (`/api/plugins/mixcloud/*`) — `mixcloudStatus`,
`mixcloudSetAccount`, `mixcloudClearAccount`, `mixcloudList(list, next?)`, `mixcloudPlaylists`,
`mixcloudPlaylist(key, next?)`, `mixcloudFollowing`, `mixcloudUserMixes(username, next?)`,
`mixcloudSearch(q, next?)`, `mixcloudForgetResume(key)` ; types `MixcloudMix` (dont `resumeS?`),
`MixcloudUser`, `MixcloudStatus`, `MixcloudList`, `MixcloudPage`. Tous en `501` dans le mock.
Détail serveur : `../3_plugins/3_20_mixcloud.md`.

**Chemin cité plus haut** : la file dupliquée de `localPlayer` suit les règles de
`apps/server/src/music/queue.ts` (anciennement `plugins/ytmusic/queue.ts`) ; la dette de
synchronisation manuelle reste la même.

Sources : `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/stores/localPlayer.ts`,
`apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/MusicPlayerBar.vue`.

### Mise à jour 2026-09-23 (9) — store `automations`, cinq méthodes de transport, maquette qui exécute

**Store** `apps/web/src/stores/automations.ts`, miroir du serveur. La carte est **remplacée** à chaque
`snapshot` ou message `automations` (jamais mutée) ; `devices.start()` lui passe le même flux qu'aux
scènes (`automations.apply(msg)`). La liste a un **ordre fixe, par nom** : une ligne qu'on désactive
ne saute pas ailleurs sous le doigt. Le statut (santé, prochaine et dernière exécution) arrive calculé
par le serveur : la vue n'a aucune santé de plugin à interroger.

- `save(id, body)` n'est **pas optimiste** : le serveur normalise la règle et calcule son statut, c'est
  sa réponse qu'on montre (une règle neuve n'apparaît qu'une fois acceptée). L'erreur affichée est le
  détail du serveur, pas le générique `errors.INVALID_BODY`.
- `setEnabled` et `remove` **sont optimistes**, avec retour arrière si le serveur refuse (seulement si
  personne n'a remplacé la carte entre-temps).
- `runNow` rend le compte rendu ou `null` ; `busy` / `isBusy` par automatisation, `saving` global.
- **Le brouillon de l'éditeur ne vit pas dans le store** : un message WebSocket arrivé pendant la
  frappe écraserait ce qu'on tape. L'éditeur garde sa copie et n'appelle `save` qu'à l'enregistrement.

**Transport** : `getAutomations()`, `putAutomation(id, body)`, `setAutomationEnabled(id, enabled)`,
`deleteAutomation(id)`, `runAutomation(id)` — routes dans `1_3_protocole-rest-ws.md`. Le **mock**
démarre avec trois règles de démonstration (volets au crépuscule sauf lecteur au salon ; portail le
midi, désactivée ; veilleuse qui vise `hue:veilleuse-couloir`, appareil absent de la simulation → santé
`incomplete`), calcule un statut approché (appareils nommés absents, prochaine heure FIXE — le soleil
n'est pas calculé en maquette) et **exécute pour de vrai** sur la simulation : les volets se ferment
dans la 3D. Une sélection s'y résout sur le kind et la nature seulement, sans pièces ni exceptions.

**Lecture humaine** : `apps/web/src/lib/automations.ts`, tout pur (noms par un `NameContext`, mots par
`t`) : `describeAutomation` (la phrase « Quand · sauf si … → Alors » d'une ligne), `COMMAND_CHOICES`
(commandes proposées par kind, filtrées par capacité — pas tout le contrat), `missingPart` qui se fie
au **schéma partagé** (`automationBodySchema.safeParse`) plutôt qu'à une copie des règles : un brouillon
accepté ici l'est par le serveur. `composables/useAutomationNames.ts` tire les noms et les listes de
choix des stores ; un id disparu (plugin éteint, pièce supprimée) se montre **tel quel**, marqué
« inconnu », pour qu'on le voie et le remplace.

**Routage** : `automation-edit` = `/automations/:id` (`props: true`, `:id` = id ou `new`), avec
`meta: { nav: 'automations' }` ; `NavRail.vue` allume l'entrée de `route.meta.nav ?? route.name`, ce
qui garde « Automatisations » allumée sur la page d'édition.

Moteur et modèle : `1_8_automatisations.md`. Vue : `../4_ui/4_1_navigation-et-panneaux.md`.

Sources : `apps/web/src/stores/{automations,devices}.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`apps/web/src/lib/automations.ts`, `apps/web/src/composables/useAutomationNames.ts`,
`apps/web/src/router/index.ts`, `apps/web/src/components/layout/NavRail.vue`, tests
`apps/web/src/stores/automations.test.ts` et `apps/web/src/lib/automations.test.ts`.

### Mise à jour 2026-09-28 — `localPlayer` : l'écoute de ce navigateur survit au rechargement

**Constat de l'utilisateur** : recharger la page perdait la lecture dans ce navigateur — ni titre, ni
file, ni position. Le store tenait tout en mémoire (section (7) plus haut, « Mémoire » : seuls
`kasbah.music.localClientId` et `kasbah.music.localVolume` étaient gardés).

**Deux clés de plus dans `localStorage`** (`apps/web/src/stores/localPlayer.ts`) :
- `kasbah.music.localQueue` — la file entière (jusqu'à 1 000 titres), écrite **quand elle change**
  seulement ;
- `kasbah.music.localPosition` — la position, écrite **à chaque relevé** (`positionS`). Séparées
  exprès : réécrire mille titres à chaque seconde de lecture n'aurait pas de sens.

**Au chargement, l'état `restored`** : si la file gardée a une piste courante, le store démarre
**en pause** à la position gardée, sans rien dans l'`<audio>`. Tant que `restored` vaut vrai :
- `barSession` se **synthétise depuis la piste** (sid vide, titre, artiste, pochette, durée) : la
  barre montre le titre, la file est visible, précédent / suivant sont actifs ;
- `seek` ne fait que **déplacer le point de départ** (rien n'est chargé à déplacer) ;
- `previous` : au premier titre, ou au-delà de `RESTART_AFTER_S`, revient à 0 ; sinon lance le titre
  d'avant ;
- `media_player.play` → `prime()` (déverrouillage du son dans le geste) puis
  `go(index, repeat, position)` ; un échec rend l'état `paused`.

`stop()` et la **fin naturelle de la file** (`advance` sans suivante : `queue = null`) oublient —
même règle que la dernière écoute des enceintes côté serveur (`1_6_lecteur-musique.md`, section du
2026-09-28), qui, elle, ne garde rien pour `local:*`.

Tests : `apps/web/src/stores/localPlayer.test.ts` (file et position gardées à mesure puis oubliées
au stop ; titre restauré en pause à sa position après rechargement, et relancé de là) — 2 verts,
relancés à l'ingestion.

**Transport** : `musicLast()` → `GET /api/music/last`, `musicResume(deviceId, positionS?)` →
`POST /api/music/resume`, type `MusicLastPlayed` ; mock : liste vide / `501`. `MixcloudMix` gagne
`genres: { slug, name }[]` (le serveur l'envoyait déjà depuis l'accueil Mixcloud).

Sources : `apps/web/src/stores/localPlayer.ts`, `apps/web/src/stores/localPlayer.test.ts`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, arbre de travail non commité du
2026-09-28 (après c6fe7c1).

### Mise à jour 2026-09-28 — store `house` : le jardin, calqué sur les places

`selectedGardenId` + `gardenDraft` (brouillon superposé à la maison par `withGardenDraft`, comme
celui des places : la scène suit le doigt, le fichier attend le lâcher), `placingGarden`
`{ kind, species? }` qui **reste armé** après chaque plantation jusqu'à « Terminé » ou un tap hors
du terrain, `placeGardenAt` (hauteur de la famille `GARDEN_DEFAULT_HEIGHT` ou de l'espèce, cap au
hasard, id libre `garden.<famille>-<n>`), `reshapeGardenItem` (graine neuve), `removeGardenItem`.
Sélectionner un élément désélectionne appareil, ouverture et place. Le store importe `speciesOf`
depuis `three/garden/species` pour la hauteur d'une espèce. Réglage `settings.sceneSeason`
(`kasbah.sceneSeason`). Détail : `../2_maison/2_2_jardin.md`.

Sources : `apps/web/src/stores/{house,settings}.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
arbre de travail non commité après cf60c7d.

## Mise à jour 2026-10-01 — `isChargeRequested` : la charge demandée, pas encore constatée

Le store `devices` expose `isChargeRequested(id)`. Pourquoi : le serveur accuse « Lancer la charge » en
quelques secondes (borne forcée, commande à la voiture), mais le courant n'arrive que 20 s à 1 min plus
tard et la voiture ne le dit qu'à sa relecture suivante. `isPending` seul laisserait le bouton redevenir
« Lancer la charge » entre les deux.

- Posée par `sendCommand` sur `vehicle.start_charge`.
- Levée quand l'état reçu dit `charging` ou `!pluggedIn` (dans `setState`), sur un refus de la commande,
  ou après `CHARGE_WAIT_MAX_MS` (180 s).
- Tenue dans le store, et non dans une vue, parce que la vue Véhicules et le panneau de détail
  (`VehicleCard`, `v-btn :loading`) montrent la même attente.

Sources : `apps/web/src/stores/devices.ts`, tests `devices.test.ts` et `VehicleCard.test.ts`.

### Mise à jour 2026-10-06 (soir) — retour à la connexion quand la session finit

Sous l'adresse publique (voir `1_7_serveur-mcp.md`), une session peut finir sous les pieds de l'app
(expirée, mot de passe changé, compte retiré). Trois points de détection, tous dans le web :
- **`httpTransport.ts` : `signInAgain()`** (`location.assign('/login?next=<chemin actuel>')`) sur un 401
  **portant le code `AUTH_REQUIRED`** seulement. Le code seul compte : la route du plugin `automower`
  rend 401 sur le réseau local pour son propre compte chez Husqvarna, et ne doit pas renvoyer à une
  connexion qui n'existe pas.
- **Fermeture du WebSocket** : un refus de session ne se lit pas sur un WebSocket, donc à la coupure le
  transport demande `/api/session` ; si elle répond `AUTH_REQUIRED`, `request` renvoie à la connexion.
- **`router/index.ts` : `router.onError`** interroge aussi `/api/session` : une vue qui ne se charge pas
  est souvent une session finie, le serveur refusant alors son fichier JS.

`Transport` gagne `session(): Promise<{ user: string | null }>` (HTTP : `GET /api/session` ; mock :
`{ user: null }`). Limite : on revient sur la vue où l'on était, pas sur celle qu'on ouvrait. Piège
d'origine (morceaux JS recevant la page de connexion) : `../6_faq/6_1_pieges-runtime.md`, 2026-10-06.

Sources : `apps/web/src/api/{httpTransport,transport,mockTransport}.ts`, `apps/web/src/router/index.ts`.
