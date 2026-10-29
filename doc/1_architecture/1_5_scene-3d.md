# Scène 3D (Three.js)

> Dernière mise à jour : 2026-10-29
> Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/core/*.ts`, `apps/web/src/three/builders/*.ts`, `apps/web/src/three/markers/*.ts`, `apps/web/src/composables/useHouseScene.ts`, `apps/web/src/three/markers/DeviceMarker.ts`, `apps/web/src/three/markers/screenArt.ts`, `apps/web/src/lib/audioRouting.ts`, `packages/shared/src/house/panels.ts`, `apps/web/src/lib/orientation.ts`, `apps/web/src/three/markers/markers.ts`, `apps/web/src/three/core/theme.ts`, `apps/web/src/three/styles/*.ts`, `apps/web/src/three/textures/{procedural,assets}.ts`, `apps/web/src/three/core/layers.ts`, `packages/shared/src/house/openings.ts`, `apps/web/src/three/core/cameraFit.ts`, `apps/web/src/three/effects/water.ts`, `apps/web/src/three/effects/disco.ts`, `apps/web/src/three/effects/parade.ts`, `apps/web/src/three/builders/parking.ts`, `packages/shared/src/house/sun.ts`, `apps/web/src/three/builders/terrain.ts`, `apps/web/src/three/relief/reliefEditor.ts`, `apps/web/src/three/effects/roam.ts`, `apps/web/src/three/effects/bats.ts`, `apps/web/src/three/garden/gardenLayer.ts`

## Pages filles

Le 2026-10-13, cette page a été découpée : elle garde le socle de la scène, les interactions et les
chemins de reconstruction. Le rendu et les objets dessinés ont été déplacés tels quels, avec leurs dates :

| Sujet | Page |
|---|---|
| Scène 3D : rendu | [1_11_scene-3d-rendu](1_11_scene-3d-rendu.md) |
| Scène 3D : objets dessinés | [1_12_scene-3d-objets](1_12_scene-3d-objets.md) |

Un renvoi d'une autre page vers celle-ci pour le rendu ou un objet dessiné se lit dans la page indiquée.

## Répartition

- **`packages/shared/src/house/geometry`** : descripteurs purs (prismes de murs, sols, rectangles
  d'ouvertures, terrain, zones, toit, bornes) — testés sans Three (voir `2_maison/2_1_geometrie.md`).
- **`three/builders`** : descripteurs → `BufferGeometry`/`Mesh` (`ExtrudeGeometry` + `mergeGeometries`,
  un maillage de murs par niveau et par matériau). Testables en Node (three core).
- **`three/HouseScene.ts`** : contrôleur sans Vue, dépendances injectables (`createRenderer`, RAF,
  `headless`) → instanciable en tests.
- **`composables/useHouseScene.ts`** : adaptateur Vue (cycle de vie, taille, thème, diff d'états, événements).

## Repère

La maison est **Z-up** (x est, y nord, z haut) ; le groupe racine porte `rotation.x = -π/2`, donc
un point local `(x, y, z)` devient `(x, z, -y)` en monde (`core/coords.ts`). Les groupes de niveau
sont à `position.z = elevation` ; les appareils sont enfants du niveau (ou du groupe extérieur) en
coordonnées locales, donc ils se masquent avec lui.

## Rendu à la demande (`core/renderLoop.ts`)

La boucle RAF ne tourne que si `OrbitControls.update()` a bougé (amortissement), si une tween ou une
animation de marqueur est active, ou après `invalidate()`. Pause quand l'onglet est caché. C'est la
différence entre 0 % et 30 % de CPU au repos sur tablette. Les animations DÉCORATIVES tournent à
cadence réduite, et chacune peut demander la sienne (`Animation.hz`, la plus rapide donnant le
tempo) : voir « l'eau de la piscine bouge » en fin de page. Ombres activées (carte 2048 ; le mode et le
cadrage de la caméra d'ombre ont changé le 2026-09-12, voir plus bas).
L'image où une tween **finit** est toujours dessinée, même si le décor n'est pas dû (2026-09-25,
section (duodecies)).

## Cadrage et contrôles

`OrbitControls` : un doigt tourne, deux doigts zooment/déplacent, amortissement 0,08, angle polaire
borné (`π/2 − 0,08`) donc jamais sous le sol. Cadrages par `fitBox` (sphère englobante, tient dans
les deux champs) et tween 650 ms : vue d'ensemble (sud-est, 55°), niveau, pièce, zone, jardin.

## Niveaux, cloisons, sélection de pièce

Onglet de niveau → les niveaux **au-dessus** sont masqués (option `ghost` pour les rendre
translucides), le toit disparaît. *(Dépassé le 2026-09-25 : ces niveaux s'envolent (`LEVEL_LIFT_M`, `LEVEL_LIFT_MS`) puis disparaissent en fondu — voir « Mise à jour 2026-09-25 (nonies) ».)* Les **cloisons intérieures sont abaissées à 1,05 m**
(`LOW_INTERIOR_WALL`, `builders/buildHouse.ts`) pour lire l'intérieur en plongée ; les murs
extérieurs gardent leur hauteur. La pièce sélectionnée voit son sol tirer vers l'accent (`lerp 0,45`).
*(Dépassé le 2026-09-15 : les murs sont de nouveau pleins sur toute leur hauteur, `LOW_INTERIOR_WALL` n'existe plus dans le code, et la pièce sélectionnée est signalée par un trait et un voile (`highlightRoom`) au lieu d'un sol teinté — voir « Mise à jour 2026-09-15 (sexies) ».)*

## Marqueurs (`three/markers`)

Chaque appareil de la maison a un `DeviceMarker` : une **pilule DOM** (`button.marker-pill`, icône
trait + nom) projetée par `CSS2DRenderer` au-dessus de l'ancre, cliquable, teintée quand l'appareil
est actif (`data-on`), et une représentation 3D minimale : sphère émissive + `PointLight` pour une
lampe, lame ajustée dans l'embrasure pour un volet (hauteur = part fermée, tweenée), carrosserie
orientée pour un véhicule (masquée s'il est absent), tondeuse orange qui suit sa position publiée,
petit objet neutre sinon. `update(state)` **mute** ; rien n'est recréé.

Visibilité des pilules : celles du niveau focalisé + celles du jardin ; en vue d'ensemble, seulement
le jardin ; l'appareil sélectionné reste toujours visible. Depuis le 2026-09-25, le passage d'un
niveau à l'autre se fait **en fondu**, au rythme de l'envol des étages : voir section (duodecies).

## Sélection

Tap sur une pilule → `deviceTap`. Tap sur le canvas (`core/input.ts` : < 350 ms, < 8 px souris /
14 px tactile) → lancer de rayon sur les objets d'appareils, puis les sols de pièces visibles, puis
les zones (uniquement hors niveau focalisé). Rien → `backgroundTap` (désélection).
*(Dépassé le 2026-09-25 : les murs et le toit arrêtent désormais le rayon, et un tap sur un mur sélectionne la pièce dont on voit la face (`roomOfWallHit`) — voir « Mise à jour 2026-09-25 (quattuordecies) ».)*

## Tests

`three/three.test.ts` : coordonnées, parseur de thème, cadrage, boucle de rendu (s'arrête sans
mouvement, repart sur tween), builders (étendues, comptes).

### Mise à jour 2026-09-07 — déplacement d'un appareil au doigt

Trois entrées publiques sur `HouseScene` : `setMovable(key | null)` (un seul appareil déplaçable à la
fois), `moveMarker(key, position)` (aperçu, repère maison, z relatif au sol de l'ancre) et
`updateDevices(house)` — **seuls les appareils ont changé** : marqueurs rebâtis, murs et **caméra
intacts** (`load()` recentre `controls.target`, ce qui sautait à chaque dépôt). Le composable
`useHouseScene` choisit entre les deux par `sameShell` (comparaison JSON de `levels / rooms / site /
roof / defaults`) ; effet de bord bienvenu : un changement de descripteurs (auto-placement) ne
recentre plus la caméra non plus.

Glissement (`core/input.ts : createDragDetector`, en parallèle du détecteur de tap et
d'OrbitControls) :

- **Saisie** : l'appui démarre un glissement si le rayon touche un `pickable` du marqueur, ou si le
  point est à moins de 44 px (tactile) / 28 px (souris) de la projection de l'ancre ou de la pilule.
  La pilule DOM passe en `pointer-events: none` (`.marker-pill[data-moving='1']`) pour laisser
  l'événement atteindre le canvas.
- **Plan** : horizontal **à la hauteur de l'appareil** (`Plane` monde `y = ancre.y`), avec l'écart
  initial doigt–ancre conservé : l'appareil suit exactement le doigt, sans saut, même au plafond.
  Monde → maison : `[hit.x, -hit.z]`.
- **Pièce** : `pointInPolygon` sur les pièces du niveau de l'appareil (`roomsByLevel`) → `roomId` ou
  null ; émis avec chaque `deviceDrag`, puis `deviceDrop` au relâchement (si le pointeur a bougé).
- `OrbitControls.enabled = false` pendant le glissement ; le `pointerup` final est aussi vu par le
  détecteur de tap → `handleTap` l'ignore tant que `drag.active()` (150 ms après la fin), sinon un dépôt
  presque immobile désélectionnait l'appareil via `roomTap`.

Le marqueur (`DeviceMarker.setMoving / setGuideHeight`) porte un **guide** : anneau au sol
(`RingGeometry`, plan XY = sol en Z-up local) et fil vertical jusqu'à l'appareil, couleur accent — sans
lui, la position au sol d'un plafonnier est illisible en plongée. Détruit à la sortie du mode.

### Mise à jour 2026-09-09 — cône « regarde vers » en mode « Déplacer »

Demande de l'utilisateur : voir, pendant la rotation, dans quelle direction l'appareil regarde. En
mode « Déplacer », le guide du marqueur (`DeviceMarker.setMoving`) ajoute, pour un appareil
**orientable** (règle partagée avec le panneau : `lib/orientation.ts` — lecteur `tv` / `display`,
caméra, véhicule), un cône plat au sol depuis l'appareil vers +y, long de 1,6 m, teinté `theme.primary`
à 45 % et tourné du `yaw`. Les marqueurs étant reconstruits à chaque écriture du placement, le cône suit
chaque pression des touches de rotation. Il disparaît avec le guide à « Terminé ». Vérifié sur le
Chromecast de la chambre : cône vers +y à 0°, tourné à 45° et 90°, puis retour à 0°.

### Mise à jour 2026-09-10 — cadrer la sélection : l'appareil lui-même, vu depuis sa pièce

Demande de l'utilisateur : « quand on sélectionne une pièce ou un objet connecté il faudrait que la
vue se positionne mieux sur la sélection avec un peu plus de zoom ». Deux choses distinctes derrière
cette phrase.

**Un appareil se cadrait sur sa pièce, pas sur lui.** `selectDevice` pose `selectedRoomId` en même
temps que `selectedKey` (`stores/house.ts`), et `HomeView` ne réagissait qu'à la pièce : un
plafonnier de grand séjour restait un point dans un coin de l'écran. `HouseScene.focusDevice(key)`
cadre désormais une **boîte fixe de 3 m** (`DEVICE_FOCUS_SIZE_M`) autour de `marker.worldAnchor()` —
donc la même distance (≈ 8,8 m avec le champ de 38°) quelle que soit la taille de la pièce, et
l'appareil au centre. `controls.minDistance = 4` borne le rapproché ; un appareil non placé ou sans
marqueur ne cadre rien (sortie anticipée).

**L'azimut est choisi, pas conservé.** Premier essai en gardant l'azimut de l'utilisateur, comme
`focusRoom` : une lampe collée à un mur extérieur s'est cadrée **derrière**
ce mur — on voyait sa face extérieure et la pelouse. C'est le cas courant, pas l'exception : lampes
murales, volets (dans l'embrasure), téléviseurs, thermostats sont contre un mur. `roomSideAzimuth`
regarde donc l'appareil **depuis le centre de sa pièce** (`boundsCenter(roomBounds(...))`,
`Math.atan2(dx, -dy)` — repère monde où z = −y maison), ce qui garantit du vide entre la caméra et
lui. `null` si l'appareil est à moins de 50 cm du centre de la pièce ou hors pièce (extérieur,
niveau seul) : on garde alors l'azimut courant. Compromis assumé : contrairement aux autres cadrages,
celui-ci **écrase la rotation de l'utilisateur**.

Plongée renforcée pour la même raison (`DEVICE_FOCUS_POLAR`, 20°–40° de polaire = **50° à 70°
au-dessus de l'horizon**) : à 8,8 m et 30° au-dessus de l'horizon, tout mur à moins de deux mètres
passe devant l'appareil ; à 60° il faut qu'il soit à moins de 75 cm.

**Pièce et zone resserrées.** Marge de `fitBox` portée de 1,6 à **1,08** (pièce) et de 1,3 à **1,05**
(zone) — un tiers plus près. La marge était le seul levier : mesuré dans la scène sur une pièce de séjour
(environ 8 × 4 × 2,5 m), la distance **minimale** qui contient la boîte est de 14,01 m, là où la
formule par sphère englobante en demande 14,18 — elle n'est donc que **1 % trop large**, et un
cadrage par extension projetée des huit sommets ne gagnerait rien. Avec un champ vertical de 38°, une
pièce de 8 m de long exige ces 14 m : au-delà il faudrait rogner la pièce ou élargir le champ.

**Le cadrage suit la sélection la plus fine** (`HomeView.vue`) : les deux watchers `selectedRoomId` et
`selectedKey` fusionnent en un seul sur le couple, et `frameSelection` aiguille appareil → pièce →
zone → rien. Un appareil surligne sa pièce sans la cadrer ; revenir de l'appareil à la pièce
(`clearSelection`) recadre la pièce, ce que deux watchers séparés ne faisaient pas (la pièce ne
changeait pas, donc rien ne se déclenchait).

**Remplacement 2026-09-25** (demande de l'utilisateur, arbre non commité) : un appareil sélectionné
ne surligne **plus** sa pièce — la branche appareil de `frameSelection` appelle
`scene.highlightRoom(null)` avant `focusDevice`, au lieu de `highlightRoom(roomId)`. Raison : la nuit
surtout, le trait et le voile d'accent couvraient justement ce qu'on vient régler (la flaque de la
lampe, cf. « tache de lumière au sol », section sexies). La pièce ne s'allume que quand c'est ELLE
qu'on a choisie : tap sur son sol, recherche, ou retour depuis l'appareil par le fil d'Ariane
(`focusRoom`, qui allume la surbrillance en interne).

Vérifié dans la preview branchée au parc réel : lampe en pièce, volet dans un mur (embrasure lisible
depuis l'intérieur), portail au jardin (hors pièce et hors niveau), zone piscine, pièce seule. La
caméra a été relevée en direct (`controls.target`, distance, élévation) plutôt que jugée à l'œil.

### Mise à jour 2026-09-11 — pilules : niveau de détail selon l'échelle écran, disque d'icône point fixe

Constat de l'utilisateur (captures) : à une quarantaine d'appareils sur le niveau focalisé, les pilules
(34 px, opaques, ombrées, nom entier) couvraient plus de surface que la maison, et rien ne distinguait un
appareil allumé d'un éteint hors la teinte d'accent. Trois leviers retenus sur quatre proposés (le
quatrième, l'occlusion par lancer de rayon caméra → ancre contre les murs, est resté en réserve : le
problème des captures était la taille des pilules, pas ce qu'il y avait devant).

**Niveau de détail (`data-lod`).** `HouseScene.updatePillLod`, appelé dans `render()` (donc seulement
quand quelque chose a bougé, rendu à la demande), pose sur la couche `.scene-labels` l'un de trois
niveaux : `full` (icône et nom), `icon` (le disque d'icône seul), `dot` (un point de la couleur de la
catégorie). La **pilule sélectionnée reste toujours entière** (CSS `:not([data-sel='1'])`).

Le critère est l'**échelle à l'écran en pixels par mètre au point visé**
(`size.height / (2 · d · tan(fov/2))`), pas la distance : à distance égale, une scène étroite (volet
ouvert, tablette en portrait) montre la maison plus petite. Mesuré dans la preview : la vue niveau
donnait 46,6 m sur un volet de 988 × 822 px là où l'écran de l'utilisateur la cadre vers 27 m — deux
distances, une même densité. Seuils (`PILL_LOD_FULL_MIN_PX_PER_M = 65`, `PILL_LOD_ICON_MIN_PX_PER_M = 26`)
relevés en direct : vue d'ensemble ≈ 20 px/m, niveau ≈ 26-36, pièce ≈ 55-78 selon la largeur du volet,
appareil cadré (8,8 m) ≈ 136. Sur un volet étroit la pièce cadrée est donc en `icon`, sur un grand
écran en `full`. Pas d'hystérésis : pendant un vol de caméra la distance est monotone, et une transition
CSS de 0,15 s lisse le passage.

**Le disque est le point fixe** (règle « rien ne doit bouger », `../4_ui/4_0_langage-visuel.md`). Le
`CSS2DRenderer` centre l'élément qu'on lui donne sur la projection ; l'ancre `.marker-anchor` est
désormais un point de **0 × 0** et la pilule, en `position: absolute`, est décalée de `translate(-15px,
-15px)` : le centre du disque de 24 px (à 3 px de marge + 12 px) tombe exactement sur la projection.
`transform-origin: 15px 15px` garde ce point immobile à l'échelle du survol et de la sélection. Quand le
nom disparaît (`icon`, `dot`), le texte s'efface vers la droite et l'icône ne bouge pas. Piège rencontré :
avec une ancre de largeur 0, la pilule en `inline-flex` absolue rétrécissait à 8 px (padding et bordure,
disque à 0) ; `width: max-content` la fait mesurer son contenu. Et la règle `.marker-pill span` visait
aussi le disque (un `span`) : le libellé a sa classe, `.marker-pill__label`.

**Structure DOM** (`DeviceMarker`, constructeur) : `button.marker-pill[data-key][data-cat][data-on]
[data-sel][data-unavailable][data-moving] > span.marker-pill__icon > svg` + `span.marker-pill__label`.
`data-cat` vient de `deviceCategory(kind)` (`lib/deviceIcons.ts`). Teintes et états : voir la page
langage visuel. Vérifié dans la preview aux trois niveaux, en clair et en sombre, sélection d'un
appareil et cadrage d'une pièce ; 72 tests web inchangés (aucun ne touche le DOM de la pilule).

### Mise à jour 2026-09-11 — le guide de déplacement se dessine par-dessus la maison

Constat de l'utilisateur en déplaçant sa caméra sur le toit : « on ne voit pas le cercle au sol et le
cône pour orienter ». Le guide est posé au **sol du niveau qui ancre l'appareil** ; or le sol d'un
niveau-toit est l'élévation de ce niveau, c'est-à-dire la **base de la dalle de toiture** (`zBase`,
`packages/shared/src/house/geometry/roof.ts` : un toit plat est extrudé de `zBase` vers le haut).
L'anneau et le cône étaient donc dessinés **dans** la dalle, et le test de profondeur les effaçait ;
seul le haut du fil vertical, qui part de l'appareil, dépassait.

Les trois éléments du guide (anneau, fil, cône) passent en `depthTest: false` avec un `renderOrder`
élevé (`GUIDE_RENDER_ORDER`, `three/markers/DeviceMarker.ts`) : ils se dessinent après la maison, donc
par-dessus elle. Le même défaut, plus discret, existait sur un niveau ordinaire quand un mur passait
devant.

Compromis assumé : pendant un déplacement, le guide se voit à travers ce qui le cache. C'est le
comportement habituel d'un gizmo de manipulation, cohérent avec la pilule (HTML, déjà toujours
au-dessus), et **un seul appareil porte un guide à la fois** (`movableKey`). L'alternative écartée —
calculer la surface visible sous l'appareil, donc le dessus du toit — est mal définie sur un toit en
pente et demandait bien plus de code.

### Mise à jour 2026-09-12 (quater) — ce que l'abaissement des cloisons révélait

`LOW_INTERIOR_WALL` (1,05 m) ne fait pas que rendre l'intérieur lisible en plongée : il **révèle**
les endroits où la géométrie laissait un mur extérieur dépendre d'une cloison pour être complet.
C'est ce qui produisait les « triangles creusés » signalés par l'utilisateur en haut des façades, à
chaque T avec une cloison. La cause et le correctif sont côté géométrie partagée, pas côté scène :
voir `../2_maison/2_1_geometrie.md`, mise à jour du même jour.

À retenir pour la suite : tout défaut de façade qui n'apparaît qu'AU-DESSUS de 1,05 m se cherche dans
`walls.ts`, pas dans `buildHouse.ts` — le builder ne fait que tronquer ce que la géométrie lui donne.

### Mise à jour 2026-09-12 (quinquies) — le toit se touche, et le niveau qu'il porte se cadre sur lui

Constat de l'utilisateur sur la maison réelle : « quand on clique sur le toit, il disparaît pour
afficher le 1er étage ».

**La cause était dans `pick()`.** Le lancer de rayon ne connaissait que trois cibles : les objets
d'appareils, les **sols de pièce** et les zones. Le toit n'étant pas sélectionnable, le rayon le
traversait et touchait le sol du niveau en dessous — d'où un `roomTap`, la sélection de cette pièce,
le focus sur son niveau, et `applyLevelFocus` qui masque alors le toit. On cliquait sur ce qu'on
voyait, on obtenait ce qu'on ne voyait pas.

**Le toit entre dans le lancer de rayon** quand il est visible : s'il est **devant** le sol touché,
`pick` renvoie `{ kind: 'level', levelId }` — le niveau que le toit porte (`roofLevel()`, bâti sur
`isRoofLevel`). Nouvel événement `levelTap` (`SceneEvents`, relayé par `useHouseScene`). Les
appareils restent testés **en premier** : la caméra du toit et le coffret Enphase gardent la priorité
sur la dalle qui les porte. Quand le toit est masqué (RDC ou étage focalisé), rien ne change : le
clic retombe sur la pièce, comme avant.

**Un niveau-toit se cadre sur le toit.** `focusLevelView` cadrait `buildingBounds` pour tous les
niveaux ; il cadre désormais `roofBounds(roof)` (nouvelle fonction de
`packages/shared/src/house/geometry/bounds.ts`) avec une plongée `ROOF_POLAR` de 35° au lieu de 52°.
Le bâti entier laissait la dalle petite et lointaine, alors que c'est elle qu'on vient voir. L'onglet
« Toit » en profite aussi.

**Piège de test, à retenir.** Deux tests couvrent le lancer de rayon dans `three.test.ts` (tap au-dessus
d'une chambre : niveau `toit` en vue d'ensemble, pièce `chambre1` quand le toit est masqué). En mode
`headless`, aucun rendu n'a lieu — donc **les matrices monde ne sont jamais à jour** et tout
`intersectObjects` renvoie vide. Il faut appeler `scene.updateMatrixWorld(true)` avant de piquer.

*(Dépassé le 2026-10-29 : `nodes.roof` est devenu `nodes.roofs`, un mesh par toit, et `roofLevel()` n’est plus qu’un cas ; voir « Mise à jour 2026-10-29 — plusieurs toits ».)*

Le fil d'Ariane et le panneau qui découlent de ce `levelTap` sont décrits dans
`../4_ui/4_1_navigation-et-panneaux.md` et `1_4_app-web.md`.

### Mise à jour 2026-09-12 (sexies) — glisser un CHAMP, et quatre détails de marqueurs

**`setMovable` accepte un groupe.** `setMovable(key: string | string[] | null)` : les modules d'un
champ de panneaux se déplacent ensemble, on attrape n'importe lequel. Le marqueur ATTRAPÉ est celui
que nomment `deviceDrag` / `deviceDrop` — à l'appelant d'en déduire ce que devient le groupe
(`previewArrayOrigin`, `1_4_app-web.md`). Deux précisions apprises à l'usage :

- le **guide** (anneau, fil, cône) ne se dessine que sur le PREMIER déplaçable : dix anneaux pour un
  seul objet qui bouge, c'était illisible. D'où le troisième paramètre de `DeviceMarker.setMoving(on,
  height, guide)` ;
- mais **tous** les modules doivent porter `data-moving="1"`, parce que c'est cet attribut qui rend la
  pilule transparente au pointeur (`.marker-pill[data-moving='1'] { pointer-events: none }`). Sans
  ça, cliquer un module **sélectionnait** le module au lieu de démarrer le glissement — et la
  sélection refermait le réglage. C'était le fameux « le clic sur un panneau ne fait rien ».

**Le verre regarde l'azimut.** `PanelMarker` penche la dalle de `-(panel.tilt)` autour de l'axe des
colonnes : tourner autour de +x pencherait la normale vers −y, or un module regarde vers **+y local**,
l'azimut de son champ (`../2_maison/2_0_format-house-json.md`). Le cône « regarde vers » suit le même
azimut, fait demi-tour pour un châssis **négatif**, et **ne se dessine pas du tout** quand le module
est posé à plat : un panneau horizontal ne regarde nulle part, une flèche y inventerait une direction.

**Un ouvrant reconstruit se POSE.** Toute écriture dans la maison reconstruit les marqueurs
(`updateDevices` → `buildMarkers`), et un `CoverMarker` naît ouvert : son premier état le faisait
**tweener** vers sa position réelle sur 400 ms. Tous les volets fermés de la maison se rouvraient donc
et se refermaient à chaque placement enregistré — très visible en glissant un champ, qui écrit à chaque
dépôt. La **première** position s'applique désormais sans animation (`posed`) ; une vraie course
s'anime comme avant. Diagnostiqué en instrumentant `buildMarkers` : 0 reconstruction à l'appui et
pendant le mouvement, 1 au dépôt — ce n'était pas le geste, c'était l'écriture.

**Un marqueur allumé se montre.** `setSelected` rafraîchit `css.visible` : un marqueur sélectionné
reste visible même quand la distance avait effacé sa pilule (`setPillVisible`). C'est ce qui fait
ressortir, sur le toit, le module de la case survolée dans la grille des onduleurs.

**La passerelle n'est plus un meuble.** Le kind `energy` couvre deux objets : le SITE d'une
installation (une passerelle — 0,28 × 0,12 × 0,32 m, une grosse boîte de dérivation) et une BATTERIE
(le coffret d'un mètre, inchangé). `GenericMarker` les distingue par `isEnergySite`, la même règle que
la vue Énergie.

### Mise à jour 2026-09-18 — régler une ouverture au doigt : un TROISIÈME chemin de reconstruction

Le mode édition des ouvertures (armé depuis les Réglages, voir
`../4_ui/4_1_navigation-et-panneaux.md`) rend les fenêtres et les portes sélectionnables et
glissables dans la vue Maison. Le geste écrit dans `house.json` et la maison revient par le
WebSocket : la scène doit donc se remettre à jour **à chaque mouvement de doigt**.

**Le problème posé par le tri existant.** `useHouseScene` triait en deux : `sameShell(a, b)` (même
bâti, seuls les `devices` diffèrent) → `updateDevices`, sinon `load()` complet. Or `rooms` porte
`openings[]` : régler une fenêtre sortait de `sameShell` et repassait par `load()` — toute la maison
reconstruite, **et la caméra recentrée**, à chaque image de geste. Injouable.

**Le troisième cas a son chemin** : `sameShellButOpenings(a, b)` (même bâti aux ouvertures près,
comparé en neutralisant `openings` dans chaque pièce) → `HouseScene.updateOpenings(house)`. Ce chemin
se situe entre les deux autres :

| Chemin | Ce qu'il refait |
|---|---|
| `updateDevices` | les marqueurs, rien du bâti |
| **`updateOpenings`** | la géométrie descriptive entière + les **maillages des seuls niveaux touchés** + les seuls marqueurs qui épousent une ouverture qui a bougé |
| `load` | tout, et recentre la caméra |

Le choix interne mérite d'être dit : `computeHouseGeometry` est recalculée **en entier** (elle est
pure et bon marché) mais seuls les **maillages** des niveaux dont les ouvertures ont changé
sont rebâtis (`rebuildLevelNodes`). Caméra, niveau focalisé, sélection et tous les autres marqueurs
restent en place.

Deux précautions vivent dans `rebuildLevelNodes`, et elles coûtent cher à réapprendre :

- les **marqueurs de l'ancien groupe sont repris tels quels** — les reconstruire est précisément ce
  qui les fait clignoter, et ce qui **rouvrait tous les volets fermés** de la maison
  (`CoverMarker.posed`) ;
- le trait de la pièce sélectionnée et les **poignées d'ouverture** sont retirés du groupe avant sa
  libération : les quatre matériaux des poignées sont **partagés par tous les niveaux**, et les
  libérer avec un groupe laisserait les poignées des autres niveaux tenir un matériau mort.

Seule exception à « les marqueurs ne bougent pas » : un ouvrant **lié** à une ouverture qui a bougé
est reconstruit, parce que sa lame se taille sur le rectangle de sa fenêtre.

#### Mesures RETIRÉES le 2026-09-18 — pourquoi il n'y a plus un seul chiffre ici

La première rédaction de cette section portait une série de mesures (construction en Node, image de
geste complète, coût GPU des poignées selon leur couche, gain des ombres gelées, chiffrage des deux
pistes écartées). **Elles ont toutes été retirées.** Elles avaient été prises sur une machine **sur
batterie** — donc en mode économie, avec la carte dédiée bridée dans cet état — et ne mesuraient pas
ce qu'elles prétendaient mesurer. L'auteur des mesures les a lui-même retirées des commentaires du
code le lendemain.

Ce qui reste ci-dessous est ce qui **se raisonne** : quel chemin refait quel travail, quelle passe de
rendu s'ajoute, ce qui est jeté avant d'être vu. Tout ce qui demandait un chiffre attend d'être
**remesuré sur secteur**, protocole du 2026-09-15 (Chrome à part, `timer query`, jamais dans la
preview). Aucun arbitrage ne doit être tiré des anciens nombres, et ils ne sont volontairement pas
reproduits ici pour qu'on ne puisse pas les recopier.

> **Décision RENVERSÉE le 2026-09-18** — voir la section « (3) » en fin de page. Ce qui suit décrit
> le choix du premier lot ; son argument reste exact mais il était incomplet, car la passe d'un niveau
> repeint ses murs par-dessus ce que la passe globale y a posé. Les poignées, le tracé des cotes et le
> repère d'origine vivent désormais sur `DECOR_LAYER`, dans le groupe `markers` du niveau — et le mode
> édition coûte donc bien une passe par niveau qui en porte.

**Les poignées, et pourquoi elles ne sont pas sur la couche « décor de niveau ».** Une poignée =
deux maillages non éclairés, dans le langage de la surbrillance de pièce : une dalle qui remplit le
rectangle (c'est elle qu'on attrape, et elle déborde l'épaisseur du mur pour s'attraper des deux
côtés) et un trait qui le cerne, dessiné **par-dessus les murs** (`depthTest: false`, comme le trait
d'une pièce) — sinon la façade cache la poignée d'une fenêtre qu'on regarde depuis la chambre. La
sélectionnée tranche par opacité : trait 0,95 / voile 0,28 contre 0,5 / 0,10.

Elles vivent sur `SITE_DECOR_LAYER` et non `DECOR_LAYER`. Les deux disent « décor », mais elles
diffèrent par le **moment du dessin** : un décor de NIVEAU force une passe de plus **par niveau**, et
une passe, c'est tout le bâti redessiné. Une poignée étant en `MeshBasicMaterial`, les lampes du
niveau n'ont rien à lui apprendre : la **passe globale** suffit, et le mode édition n'ajoute alors
aucune passe de niveau. Cela se raisonne sans mesure, ce qui tombe bien (voir l'encadré ci-dessus).

**Piège de saisie** : `Raycaster` ne voit que la couche 0 par défaut. Une poignée posée sur
`SITE_DECOR_LAYER` ne s'attrape pas tant qu'on n'a pas fait `raycaster.layers.enable(...)` — constaté
en séance, le glissement ne démarrait jamais, sans erreur ni indice.

**Le geste lui-même.** Plan **horizontal au sol du niveau** (`openingFoot`), pas le plan du mur : ce
qu'on rapporte est le point du doigt sur ce sol, à charge de l'appelant d'y chercher la place
admissible (`slotFromPoint`, `../2_maison/2_1_geometrie.md`). L'écart initial doigt–ouverture est
conservé dans `dragOffset` — sans lui, l'ouverture sauterait au premier appui, la poignée étant à
hauteur d'allège et le plan à ses pieds. **Les deux glissements partagent `dragPlane` et
`dragOffset`** : on ne déplace donc jamais un appareil et une ouverture en même temps (contrainte
assumée, pas un oubli). `OrbitControls` est coupé pendant le geste (`camDelta = [0, 0, 0]` mesuré à
la revue).

Deux économies **gardées** :

- **Une position par IMAGE, pas une par événement pointeur** (`requestAnimationFrame`,
  `flushOpeningDrag`, plus la dernière position au relâché). Le pointeur émet deux à six fois plus
  vite que la scène ne dessine, et chaque position reconstruit les murs d'un niveau : cinq sixièmes
  du travail finissaient à la poubelle avant d'être vus.
- **Ombres gelées pendant le geste**, refaites au relâché (`invalidateShadows` seulement si aucun
  glissement n'est actif). La carte d'ombre redessine tout le bâti depuis le soleil, et l'ombre d'un
  trou de mur qui glisse n'est pas ce qu'on regarde.

**Deux pistes ÉCARTÉES** — elles valent autant que ce qui a été gardé, mais leur chiffrage faisait
partie des mesures invalidées : ce qui subsiste de chacune est l'argument, pas le verdict.

- **Dégrader la qualité pendant le geste** (`medium` → `low`). Écartée : le gain relevé était mince
  et coûtait le bloom et la vignette — l'image change à vue pendant qu'on règle une cote. L'argument
  qui tient sans mesure : ce qu'un geste dépense, c'est la **reconstruction et l'envoi des tampons**,
  pas la chaîne d'effets, laquelle ne dépend ni du nombre d'ouvertures ni du fait qu'on en déplace
  une. **À re-décider si un jour on remesure sur secteur.**
- **Ne recalculer que la `LevelGeometry` du niveau touché** plutôt que `computeHouseGeometry`
  entière. Écartée sur un argument qui ne demande aucune mesure : il faudrait **recopier
  l'assemblage** de `computeHouseGeometry`, copie qui **dériverait au premier champ ajouté**. Le
  chiffrage du gain est tombé avec le reste ; la raison de ne pas le prendre, non.

**API offerte au reste de l'app** (`HouseScene`, relayée par `useHouseScene`) :
`setEditingOpenings(on)`, `setSelectedOpening(id | null)`, `focusOpening(id)`, et les événements
`openingTap` / `openingDrag` (id + point du repère maison) / `openingDrop`. 66 tests `three` verts,
dont 2 nouveaux.

**Limites connues, à écrire noir sur blanc :**

- **Le geste reste le moment le plus cher de la scène** sur la vraie maison : chaque position
  reconstruit les maillages d'un niveau. Jugé jouable à l'œil, jamais fluide ; sur la maison de démo
  la question ne se pose pas. **Non chiffré** (voir l'encadré sur les mesures retirées).
- Le **trait des poignées transparaît à travers le toit** en vue d'ensemble : c'est le prix du
  `depthTest: false`, le même compromis que le trait d'une pièce sélectionnée.
- La poignée **sélectionnée tranche moins en plein jour** que de nuit (voile et trait sont des
  opacités, pas un contraste garanti).
- **Glissement d'appareil et glissement d'ouverture ne peuvent pas coexister** (plan et écart
  partagés).
- La **`position` JSON d'un ouvrant lié ne suit pas** l'ouverture qui bouge. Rien ne se voit — son
  marqueur, lui, épouse le rectangle de la fenêtre — mais c'est une donnée devenue morte dans le
  fichier, pas une position à croire.
- Ni création ni suppression d'ouverture : **choix de périmètre** de cette étape.

Sources : `apps/web/src/three/HouseScene.ts` (`updateOpenings`, `rebuildLevelNodes`,
`buildOpeningHandles`, `startOpeningDrag` / `moveOpeningDrag` / `endOpeningDrag`),
`apps/web/src/composables/useHouseScene.ts` (`sameShellButOpenings`),
`apps/web/src/three/core/layers.ts`, `apps/web/src/three/three.test.ts`,
journal de session `_generated-ai-doc/sessions/2026-09-17-edition-ouvertures/journal.md`.

### Mise à jour 2026-09-18 (2) — la matrice monde d'un objet qui vient de naître, et ce que la scène écrit autour d'une ouverture

Quatre lots se sont ajoutés au mode édition après la première ingestion. Le plus cher à réapprendre
est un piège de Three.js ; le reste est ce que la scène **dit** de l'ouverture qu'on règle.

#### Le piège : un objet neuf est à l'ORIGINE DU MONDE jusqu'à l'image suivante

La `Scene` tourne avec `matrixWorldAutoUpdate = false` (rendu à la demande : les matrices monde ne
sont recalculées **qu'une fois par image**, juste avant de dessiner). Conséquence, rarement écrite
noir sur blanc : **tout objet qu'on vient d'ajouter garde une matrice monde à l'identité** tant
qu'une image n'a pas été rendue. Le lancer de rayon lit `matrixWorld` — il teste donc l'objet neuf
**à l'origine du monde**, pas là où on l'a posé.

Ce que ça a donné : les onze poignées de la maison de démo étaient toutes injoignables juste après
leur construction (jusqu'à douze mètres d'écart entre leur position réelle et celle que voyait le
rayon), et un appui sur la poignée **dessinée sous le doigt** émettait `roomTap` — le rayon passait
au travers et touchait le sol de la pièce. Aucune erreur, aucun avertissement : la scène était juste
« mal visée ».

Le remède tient en une ligne, à la naissance de l'objet :

```ts
group.updateWorldMatrix(true, true)   // vrai/VRAI : parents ET enfants
```

**Le second `true` est le point important.** C'est la dalle portée par le groupe que le rayon
touche, pas le groupe : mettre à jour le seul groupe ne corrige rien. Le même geste vaut pour tout
ce qui naît en cours d'image et doit être vu ou touché tout de suite — les **étiquettes** et le
**tracé des cotes** (qui lisent `matrixWorld` pour se projeter à l'écran) et le **repère d'origine**,
nés au même moment. C'est la règle à retenir : *dans cette scène, poser un objet ne suffit pas, il
faut lui dire où il est*.

#### Trois états de poignée, distingués par l'ÉPAISSEUR du trait

Il y a trois choses à lire d'un coup d'œil : les murs **sans** ouverture réglable, les ouvertures
**qu'on pourrait** régler, et **celle qu'on règle**. Deux essais ont échoué avant le bon :

1. **l'opacité seule** (c'est ce que décrivait la première ingestion : trait 0,95 / voile 0,28 pour
   la sélectionnée contre 0,5 / 0,10 au repos) — illisible, et surtout invisible de **jour**, où le
   bloom ne porte plus la différence ;
2. **pas de cadre du tout au repos** — les autres ouvertures devenaient introuvables.

Retenu : le **registre change, pas l'intensité**. Un cadre **fin de 3,5 cm** au repos, **épais de
7,5 cm** pour la sélectionnée (`OPENING_RING = { rest: 0.035, on: 0.075 }`, un rapport de 2,1 qui se
voit à l'œil de jour comme de nuit, dans les deux thèmes). Les deux cadres coexistent sur chaque
poignée ; sélectionner n'éteint que des **matériaux** (`visible: false` sur le matériau, jamais
`Object3D.visible`, qui sert ici à décider si l'objet est touchable). La surface de contact ne change
donc jamais.

**Le cadre au repos est un TUBE, pas un cadre plat**, et c'est ce détail qui le rend possible : il est
extrudé dans les 30 cm de la poignée (`extrudeRing`, il dépasse des deux faces du mur), donc il reste
**soumis à la profondeur** sans être enterré dans la menuiserie qui occupe exactement le même plan.
Un cadre plat à mi-épaisseur serait invisible ou en z-fighting avec le dormant. Seule la poignée
**sélectionnée** est plate et en `depthTest: false` : elle passe par-dessus les murs, comme le trait
d'une pièce sélectionnée. Effet de bord **gagné** au passage : les poignées au repos ne
transparaissent plus à travers le toit — ce qui **remplace** la limite notée plus haut (« le trait
des poignées transparaît à travers le toit »), désormais vraie de la seule poignée sélectionnée.

#### Deux natures vitrées de plus : baie et porte vitrée

`OPENING_TYPES` en compte six (`../2_maison/2_0_format-house-json.md`). Ce que la scène en fait :

- `GLAZED_OPENINGS = { window, bay, glass-door }` — **le vitrage et la menuiserie** se construisent
  pour les trois. L'ensemble est déclaré dans `builders/details.ts` et non dans `buildHouse.ts` :
  `buildHouse` importe déjà `buildDetails` de là, l'inverse ferait un **cycle d'import** que Vite
  laisse à moitié initialisé (le genre de panne qui se manifeste par un `undefined` au chargement,
  loin de sa cause). Règle : la constante va dans le module **feuille**.
- **Baie** : cadre sur quatre côtés avec **rail bas**, et un **refend par vantail** (un vantail par
  tranche de 1,6 m de largeur, soit deux à trois) ; **aucun appui** saillant.
- **Porte vitrée** : cadre sur **trois côtés** (elle descend au sol) et un cadre de battant à la place
  du panneau plein d'une porte.
- Fenêtre et porte pleine : inchangées.

À la revue, les quatre familles se distinguent au premier coup d'œil depuis l'intérieur d'une pièce.
La paire la moins évidente est **baie / fenêtre** — tout tient au refend et à l'appui manquant, il
faut regarder le bas de l'ouverture. Porte / porte vitrée ne se confondent pas une seconde.

#### Le repère d'origine du fichier (mode édition seulement)

Un anneau posé à plat sur le **(0, 0, 0) de `house.json`** — le point depuis lequel tout est mesuré :
polygones de pièce, positions d'appareils, `offset` d'ouverture. Un point seul ne dirait pas dans
quel **sens** on compte : il porte donc ses deux bras **+x** et **+y** avec leurs lettres, plus une
flèche plus courte et plus pâle vers le **nord vrai** — `origin.heading` étant le cap horaire de +y,
le nord local est en `(−sin h, cos h)`. C'est ce qui permet de rapprocher un relevé du terrain
(cf. le calage maison/photo dans `../2_maison/2_0_format-house-json.md`).

Tout est dessiné en `depthTest: false` : l'origine peut tomber dans un mur, sous une dalle ou loin du
bâti, et un repère qu'on ne voit pas ne repère rien. Il n'est ni touchable (aucun `role` dans
`userData`) ni déplaçable — **l'origine du fichier n'est pas un réglage**. Échelle volontairement
domestique (anneau de 24 cm, bras de 1,1 m) : un trièdre de CAO au milieu d'une maquette n'aurait
rien à y faire.

#### Les lignes de cote : de la géométrie de scène, et un nombre POSÉ AU-DESSUS

Ce que la scène écrit autour de l'ouverture réglée : son **nom** au-dessus d'elle et ses **deux
cotes** de part et d'autre, celles qui la séparent de chaque bout de son mur. Les nombres viennent
d'`openingGaps` et le nom d'`openingLabel`, **partagés avec le panneau** : la même fenêtre ne peut
pas se coter de deux manières ni se nommer de deux façons (vérifié au centième sur neuf positions de
glissement, carte et 3D caractère par caractère).

Trois décisions valent d'être retenues.

**Elles se posent à la SÉLECTION, pas au premier mouvement.** Les faire surgir quand le geste
commence serait un saut sous la main ; et elles servent aussi à **relire ce que les champs du panneau
viennent d'écrire**, sans qu'on ait rien à glisser.

**Le tracé est de la GÉOMÉTRIE de scène, pas du DOM.** Un trait qui court sur **exactement**
l'intervalle annoncé — sans quoi on ne sait pas si « 0,25 m » se mesure jusqu'au coin ou jusqu'au
tableau — fermé à chaque bout par un tiret vertical, et dessiné par-dessus les murs (une cote que le
tableau d'une fenêtre coupe en deux ne se lit plus). Vivant dans le repère du niveau, il **suit
l'ouverture qui glisse sans un temps de retard** et se cache avec son niveau. À cote nulle, le trait
disparaît et les deux tirets se confondent : c'est exactement ce qu'il y a à lire, l'ouverture touche
le coin.

**Le nombre est AU-DESSUS du trait, jamais dessus** — et c'est le cas difficile qui l'impose. Le
nombre est du DOM : il fait **66 px quelle que soit la distance** (`min-width` tenu, mesuré à 66,00 px
pour « 0.00 m » comme pour « 123.45 m », ce qui garantit aussi qu'il ne danse pas pendant le geste).
L'intervalle, lui, est en mètres. **Aucun seuil en mètres ne peut donc décider « le nombre est plus
large que sa cote »** : la réponse dépend du zoom. Posé au-dessus, il ne coupe jamais son trait, à
aucune échelle, tout en restant au milieu de son intervalle donc attaché à lui.

**Piège attrapé au passage** : le tracé, d'abord posé dans le groupe du **niveau** (c'est de la
géométrie, sa place semblait là), devenait **orphelin dès le premier mouvement de doigt** —
`rebuildLevelNodes` jette ce groupe et reparente marqueurs et étiquettes. Il vit donc dans un groupe qui
SURVIT : il annote la même chose que les étiquettes, il vit et meurt avec elles. Un test l'épingle :
après `updateOpenings`, le tracé existe encore et suit. (**Précisé le 2026-09-18**, section « (3) » :
ce groupe est finalement celui des `markers` du niveau et non celui des étiquettes — les deux
survivent, mais seul le premier est dessiné dans la passe du niveau, donc par-dessus les murs.)

**Limite connue, remède identifié et NON pris.** Une cote peut passer **sous le champ de recherche**,
ou sortir du cadre par le bas, dès qu'on incline ou qu'on zoome soi-même (au cadrage que
l'application choisit, `focusOpening` cadre l'ouverture **et** ses cotes, portée bornée à 2 m, et tout
est dégagé). La couche d'étiquettes est à `z-index: 1`, le panneau à 3, la recherche au-dessus par
ordre de document. Le remède serait un **retrait BAS dans `setViewInset`**, passé par `HomeView`
comme l'est déjà `viewInsetRight` : il n'a **pas** été pris, parce qu'il décalerait la composition de
**toute** la vue Maison pour un défaut qui ne se produit qu'après une manipulation de caméra. Gêne
jugée modérée : on perd la cote la plus proche du bord bas, jamais les deux, et le même nombre reste
lisible au centième dans le panneau.

Sources : `apps/web/src/three/HouseScene.ts` (`buildOpeningHandles`, `refreshOpeningNotes`,
`buildOriginMark`, `styleOpeningHandles`, constantes `OPENING_RING` / `COTE` / `ORIGIN_MARK` /
`OPENING_FOCUS_REACH_M`), `apps/web/src/three/builders/details.ts` (`GLAZED_OPENINGS`),
`apps/web/src/three/builders/buildHouse.ts`, `apps/web/src/three/three.test.ts`,
journal de session `_generated-ai-doc/sessions/2026-09-17-edition-ouvertures/journal.md` (09:09 →
09:31) et `revue-ui.md` (revue du second lot).

### Mise à jour 2026-09-18 (3) — les cotes ne se dessinaient JAMAIS : la passe d'un niveau repeint ses murs par-dessus la passe globale

> **Caduc depuis le 2026-09-25** : sans passe de niveau, plus rien ne repeint les murs par-dessus un décor.
> Les décors restent sur `DECOR_LAYER` dans les marqueurs de leur niveau (occlusion, lancer de rayon,
> masquage avec le niveau) ; `refreshLevelPasses` et `debugStats().levelPasses` ont disparu.

Le piège de rendu le plus cher de la session, et celui qui repiégera le suivant : il a coûté du temps
à deux personnes et **renverse une décision** prise au premier lot.

**Le symptôme.** Les lignes de cote du mode édition (mise à jour « (2) » ci-dessus) ne se dessinaient
à aucun niveau, alors que les étiquettes DOM — le nom et les nombres — s'affichaient normalement. Les
poignées, elles, semblaient masquées par les murs dès qu'on regardait une façade depuis l'extérieur.

#### Le faux diagnostic, et l'erreur de méthode qui l'a produit

Tout était mesuré, et tout était bon : la géométrie existait, `visible` à `true`, matériau `visible`,
sur une couche que la caméra voit, aux bonnes positions monde. Et elle ne se dessinait pas.

Un objet a alors été sorti de sa chaîne de parents (`scene.add(c)`) **en changeant sa couche au même
moment** — il est apparu, d'où la conclusion que le parent (`level.labels`, le conteneur des objets
CSS2D) empêchait le rendu. **C'était faux.** Deux variables changées d'un seul geste : c'est la
couche qui opérait, pas le parent.

La mesure qui tranche, faite ensuite : la géométrie accrochée sous `labels` était bien **soumise au
rendu** — `renderer.info.render.triangles` passe de 13 174 à 13 246 quand on masque puis remontre le
groupe, soit 72 triangles, exactement les six boîtes en jeu. À retenir comme fait de Three.js :
**la couche n'est testée que sur l'objet lui-même, jamais sur ses parents**.

#### Le vrai mécanisme

**La passe de rendu d'un niveau redessine ses murs et ses sols par-dessus l'image de la passe
globale, sans effacer** (voir « octies » du 2026-09-15 : même tampon, `autoClear = false`), et la
profondeur ne l'arrête pas — `depthWrite: false` laisse dans le tampon la valeur du mur, que le mur
repasse à égalité. **Tout ce que la passe globale a posé SUR une surface de niveau est donc recouvert
dès que ce niveau a une passe à lui** (une lampe allumée, un décor).

Et le détail qui a égaré le diagnostic : **un trou de mur n'a pas de surface à redessiner**. Le cadre
de la poignée sélectionnée vit dans l'embrasure — il survivait ; la ligne de cote est posée sur le
mur plein — elle disparaissait. D'où la lecture erronée « c'est une occlusion par le mur ».

#### La règle, à trouver avant de recommencer

> **Ce qui doit se voir par-dessus un mur passe par `DECOR_LAYER` ET par le groupe `markers` du
> niveau.** Le décor y est dessiné DANS la passe du niveau, donc APRÈS ses murs. C'est le chemin
> qu'emprunte déjà le guide du mode « déplacer », et il n'y en a pas d'autre.

Le groupe `markers` a en prime la propriété de **survivre à `rebuildLevelNodes`**, là où le groupe du
niveau est jeté — la même raison qui avait fait poser le tracé des cotes dans les étiquettes.

**Décision renversée.** Le premier lot avait mis les poignées sur `SITE_DECOR_LAYER`, dessinée dans
la passe globale, **pour économiser une passe de niveau** ; le raisonnement (une poignée est en
`MeshBasicMaterial`, les lampes du niveau n'ont rien à lui apprendre) était juste mais incomplet — il
oubliait que la passe du niveau **repasse par-dessus**. Cette décision est annulée : elle rendait
invisible ce qu'elle devait montrer. Le paragraphe « Les poignées, et pourquoi elles ne sont pas sur
la couche décor de niveau » de la mise à jour du matin **ne vaut plus** ; il est gardé au-dessus
parce que son argument, lui, reste exact — il ne suffisait simplement pas.

**Corollaire assumé : le mode édition coûte désormais une passe de rendu par niveau qui porte des
poignées**, et une passe, c'est tout le bâti redessiné. `refreshLevelPasses` donne sa passe au niveau
justement parce qu'il porte ce décor (elle inspecte `markers` à la recherche d'une `PointLight`
allumée ou d'un objet sur `DECOR_LAYER`). **Aucun chiffre** : rien n'a été mesuré ici, et la machine
était sur batterie — même raison que pour les mesures retirées plus haut.

Deux affirmations de la matinée deviennent fausses telles qu'écrites, et se lisent maintenant ainsi :

- le **piège du `Raycaster`** reste entier, la couche seule change : `raycaster.layers.enable(DECOR_LAYER)`
  (et non `SITE_DECOR_LAYER`). Un `Raycaster` ne voit que la couche 0 par défaut ; sans cette ligne le
  glissement ne démarre jamais, sans erreur ni indice ;
- le **tracé des cotes** vit maintenant dans `level.markers` et non dans `level.labels`. Les deux
  survivent à `rebuildLevelNodes` — c'est la couche qui impose `markers`. Le **repère d'origine** a
  suivi le même chemin : il était enfant de la racine, il est désormais posé dans les marqueurs du
  niveau dont le sol est le plus proche du `z = 0` du fichier, sa position corrigée de `-elevation`
  pour retomber exactement sur l'origine.

Effet de bord gagné : les poignées vivant dans `markers`, elles **s'éteignent avec eux** sur un
niveau fantôme ou masqué. La boucle qui les masquait une par une dans `applyLevelFocus` a disparu.

#### Le second défaut, distinct : une poignée à ras du mur ne dépasse d'aucune face

La dalle qu'on attrape avait une **épaisseur fixe de 0,30 m**, exactement celle d'un mur extérieur :
à ras des deux faces, donc masquée par la face extérieure dès qu'on regardait la façade de biais. Elle
vaut maintenant **`o.depth + 0,18`** (`OPENING_HANDLE_PROUD_M = 0,09`, neuf centimètres de débord de
chaque côté, quelle que soit l'épaisseur du mur). Le cadre au repos étant un tube extrudé dans cette
épaisseur, il déborde avec elle.

Et le **trait de cote** est passé de **2,2 à 3,5 cm** (`COTE.bar`) : sous le pixel dès qu'on reculait.

#### Ce que le test garde (et ce que l'ancien laissait passer)

L'ancien test vérifiait la structure — une poignée par ouverture — et les cotes au centimètre. **Tout
cela reste vrai d'un objet qu'on ne dessine jamais** : c'est exactement ce qui a laissé passer un mode
édition dont les traits n'apparaissaient nulle part.

Le nouveau (`three.test.ts`, « dessine poignées et cotes dans la passe de leur niveau, seul endroit
d'où l'on se voit par-dessus un mur ») énonce le **mécanisme** : tout décor du mode édition — les
poignées, le tracé `opening-cotes`, le repère `origin-mark` — doit être sur `DECOR_LAYER` **et** avoir
un groupe nommé `markers` parmi ses ancêtres, et `debugStats().levelPasses` doit être **> 0** quand une
ouverture est sélectionnée. C'est la seule chose qui empêchera la règle de se reperdre : elle ne se
vérifie pas à l'œil sur une capture, et elle ne laisse aucune trace dans la structure de la scène.

Il a révélé au passage que **sortir du mode édition laissait deux passes fantômes** derrière lui —
corrigé : `setEditingOpenings` et `setSelectedOpening` rappellent `refreshLevelPasses`, et
l'assertion `levelPasses === 0` du test de cycle de vie a été **déplacée après** la sortie du mode,
là où elle portait auparavant sur le mode actif.

Sources : `apps/web/src/three/HouseScene.ts` (`buildOpeningHandles`, `refreshOpeningNotes`,
`buildOriginMark`, `refreshLevelPasses`, `renderPasses`, `applyLevelFocus`, constantes
`OPENING_HANDLE_PROUD_M` / `COTE`), `apps/web/src/three/core/layers.ts`,
`apps/web/src/three/three.test.ts`, journal de session
`_generated-ai-doc/sessions/2026-09-17-edition-ouvertures/journal.md` (11:41).

### Mise à jour 2026-09-18 (4) — le mode « poser » : un tap qui DÉSIGNE un mur au lieu de sélectionner

Ajouter une ouverture depuis le panneau de la pièce (`../4_ui/4_1_navigation-et-panneaux.md`) arme
une nature, puis attend un tap sur le bâti. La scène ne dessine **rien** pour cet état — pas de
fantôme qui suivrait le doigt : sur une tablette il n'y a pas de survol, et c'est le panneau qui dit
ce qu'on attend. La scène ne fait qu'une chose, mais elle la fait avant tout le reste.

**`setPlacingOpening(roomId | null)`**, et `handleTap` **sort en premier** quand une pièce est armée,
avant `pick()` : on est venu désigner un mur, pas ouvrir la pièce ni l'appareil qui se trouve devant.
L'événement émis est `placeTap(xy)` — un point du repère maison, comme `openingDrag`. La scène dit
**où l'on a tapé**, jamais où l'ouverture a le droit d'aller : c'est le store qui passe le point à
`slotFromPoint` (`../2_maison/2_1_geometrie.md`), la même règle que le glissement, ce qui garantit que
ce qui naît est toujours à un emplacement que le serveur accepte.

**Le rayon vise les vraies surfaces, et non le plan du sol.** Le glissement d'une ouverture projette
le doigt sur un plan horizontal posé au sol du niveau (`startOpeningDrag`, plus haut) — suffisant
quand on tire un objet déjà posé sur son mur. Ici on **désigne un mur** : tapé à mi-hauteur, il doit
rendre un point **sur lui**, là où le plan du sol aurait rendu un point situé bien au-delà, derrière
la maison, et donc un mur voisin. `buildingPoint(roomId, ndc)` lance donc le rayon sur les maillages
du niveau de la pièce visée — `level.walls` **et** `level.floors` — et convertit le point touché
(monde `x, y, z` → maison `x, z, -y`).

Les murs d'un niveau sont **fusionnés par nature** (un maillage pour tous les murs extérieurs, un
pour les cloisons) : le point touché ne dit donc pas quel segment on vise, et ce n'est pas grave —
la pièce est connue (c'est celle du panneau), et `slotFromPoint` choisit parmi SES murs celui qui est
le plus proche du point. Taper le sol de la pièce près d'un mur marche donc aussi bien que taper le
mur, ce qui rend le geste indulgent.

Aucun maillage touché → `backgroundTap`, l'événement que la vue lit déjà comme un renoncement.

Sources : `apps/web/src/three/HouseScene.ts` (`setPlacingOpening`, `buildingPoint`, `handleTap`,
événement `placeTap`), `apps/web/src/composables/useHouseScene.ts` (`setPlacingOpening`,
`onPlaceTap`), `apps/web/src/three/builders/buildHouse.ts` (`LevelNodes.walls` / `floors`),
`apps/web/src/views/HomeView.vue`.

## La molette avalée par une pilule (2026-09-18)

Défaut **ancien**, trouvé en vérifiant le tilt-shift et d'abord attribué à lui. Une pilule est
cliquable, donc `pointer-events: auto` (`styles/app.css`), donc elle reçoit aussi la MOLETTE — et
`OrbitControls`, qui écoute le canvas, ne la voit jamais. Sur une maison bien équipée
l'écran en est constellé : le zoom devenait intermittent sans raison visible.

La couche des étiquettes repasse donc l'événement au canvas tel quel, **position comprise** pour que
le zoom continue de viser le curseur (`forwardWheelFromLabels`, relais retiré au `dispose`).
**Seulement la molette** : un glissement parti d'une pilule reste ambigu — c'est peut-être un appui
sur la pilule, et le transmettre ferait démarrer une rotation de caméra en même temps qu'une
sélection. Une molette sur une étiquette n'a, elle, aucun autre sens que « zoomer ». Vérifié dans
l'application : 14,649 → 12,952 en avant, retour à 14,649 en arrière, et le clic sélectionne
toujours l'appareil.

Sources : `apps/web/src/three/core/post.ts` (`TILT_SHIFT_SHADER`, `tiltBlurFactor`),
`apps/web/src/three/styles/tuning.ts`, `apps/web/src/three/styles/types.ts` (`TiltShiftLook`),
`apps/web/src/three/HouseScene.ts` (`updatePillFocus`, `forwardWheelFromLabels`),
`apps/web/src/three/markers/DeviceMarker.ts` (`setPillFocus`), `apps/web/src/styles/app.css`.

### Mise à jour 2026-09-18 (6) — la projection : deux caméras, une seule pose

La section « Cadrage et contrôles » ci-dessus décrit la perspective ; depuis cette date elle n'est
plus la seule projection. Réglages → Rendu 3D → **Projection** propose trois valeurs
(`core/cameraFit.ts`, `SCENE_PROJECTIONS`) :

- `perspective` — la vue historique, champ de vision de 38° ;
- `ortho` — caméra **orthographique**, les parallèles le restent, mais on tourne et zoome librement ;
- `iso` — la même caméra, **angles verrouillés** sur l'isométrie.

#### La décision qui tient tout le reste : la POSE ne change pas

`flyTo` calcule sa pose dans les deux cas avec le champ de vision de **référence**, celui de la
caméra perspective (`this.perspectiveCamera.fov`), même quand la caméra active n'en a plus. La
caméra orthographique y ajoute son zoom (`fitZoom`). Les deux cadrent alors la même chose, et
basculer de l'une à l'autre **ne déplace rien** — vérifié : en passant en orthographique, la
position ne bouge pas d'un millimètre et `ORTHO_BASE_M / zoom` retombe exactement sur
`visibleHeight(distance, 38)`, la hauteur de monde que la perspective montrait à cette distance
(`three.test.ts`, « cadre la même hauteur de monde des deux côtés de la bascule »).

L'autre voie a été écartée après l'avoir instruite : **découpler la distance du cadrage**, poser la
caméra orthographique à un recul fixe (80 m) et ne cadrer que par le zoom. C'est ce que fait un
logiciel de CAO, et ça se défend — la caméra ne rentre jamais dans le bâti. Mais `focusDevice`
cadre un appareil DEDANS, à deux mètres de son ancre et vu depuis le centre de sa pièce (mise à
jour du 2026-09-10) : à 80 m de recul, le mur extérieur passe devant et l'on ne verrait plus que la
façade. Garder la pose de la perspective, c'est garder tel quel le comportement de tous les
cadrages existants — la fuite en moins.

#### Le tronc porte la forme, le zoom porte la taille

`ORTHO_BASE_M = 20` : la hauteur de monde que le tronc couvre à zoom 1. Rien d'autre n'en dépend, et
tout passe par le zoom — le cadrage, la molette, l'échelle des pilules. `applyProjection` ne pose
donc sur la caméra orthographique que sa FORME (hauteur de base, rapport de l'écran) ; sa taille est
le zoom. `setViewOffset` s'y applique avec exactement la même sémantique qu'en perspective, ce qui
laisse intact l'encart du panneau flottant (mise à jour du 2026-09-15 quinquies) : le tronc
s'élargit vers la droite au lieu de se recentrer.

Les bornes suivent la même traduction. `controls.minDistance` / `maxDistance` (4 et 120 m) ne veulent
plus rien dire quand la molette ne déplace plus la caméra : `applyControlLimits` les convertit une
fois en `minZoom` / `maxZoom` — mesuré 0,242 et 7,261. Même chose pour le niveau de détail des
pilules : `pxPerM` se lit `size.height × zoom / ORTHO_BASE_M`, parce qu'**en orthographique la
distance ne dit plus rien de l'échelle**. Vérifié dans la scène : un `dollyBy` de 1,35 fait passer
le zoom de 0,716 à 0,967 et les pilules de `full` à `icon`, comme en perspective.

#### L'isométrie : des rails, pas une caméra de plus

`iso` n'ajoute aucune caméra — c'est la même orthographique, avec des angles imposés :

- plongée `ISO_POLAR = atan(√2)` ≈ **54,736°** depuis la verticale (35,264° au-dessus de
  l'horizon) : l'angle qui met les trois axes du monde à égalité à l'écran ;
- azimut ramené sur le coin le plus proche, de quart de tour en quart de tour, **à partir de
  `DEFAULT_AZIMUTH`** (−45°, le sud-est). Heureux hasard du relevé : la vue d'ensemble de
  l'application se posait déjà sur un coin à 45°, l'isométrie ne dépayse donc pas.

La contrainte est appliquée **dans `flyTo`, avant le cadrage** : `focusRoom`, `focusDevice`,
`focusLevelView`, `focusZone` et `resetView` continuent de fonctionner, ils restent simplement sur
les rails. Vérifié sur la vraie scène : un `focusDevice('light.salon')` en isométrie garde
54,74° / +45° et cadre l'appareil par le zoom seul (3,499).

Ce que l'isométrie retire, il faut le rendre ailleurs : `enableRotate` passe à `false`, donc un
doigt (ou le bouton gauche) **déplace** la vue au lieu de la faire pivoter — `TOUCH.PAN` et
`MOUSE.PAN` à la place de `ROTATE`. Et les deux boutons de rotation de la vue font un **quart de
tour**, quelle que soit l'amplitude qu'ils demandent (ils demandent π/4) : `orbitBy` ramène d'abord
l'azimut sur son coin, puis ajoute ±π/2. Mesuré : trois appuis, trois fois 90° exactement, plongée
inchangée.

> **Remplacé le 2026-09-25** : l'isométrie garde ces rails, mais ils sont désormais posés sur la
> caméra PERSPECTIVE à champ étroit (20°) et plus sur l'orthographique. Voir la section 2026-09-25
> (quattuordecies).

#### Ce qu'il faut savoir pour échanger une caméra en cours de route

`swapCamera` recopie position, quaternion et **masque de couches** (`layers.mask` — sans lui, halos,
lampes et décors de site disparaîtraient), puis fait trois choses qui ne vont pas de soi :

1. `controls.object = next` — `OrbitControls` accepte les deux espèces, il branche sur
   `isOrthographicCamera` à chaque geste (molette, `dollyIn`, panoramique) ;
2. `applyProjection()` — le nouveau tronc n'a encore ni rapport d'écran ni encart ;
3. `applyQuality()` — **la chaîne d'image tient une référence sur la caméra**. `GTAOPass` lit
   `this.camera.isPerspectiveCamera` pour poser sa define `PERSPECTIVE_CAMERA`, une seule fois, à la
   construction : une passe d'occlusion bâtie pour une perspective calculerait faux sur une
   orthographique. La chaîne se refait donc à chaque changement d'espèce, jamais autrement.

`HouseScene.camera` est désormais une union `PerspectiveCamera | OrthographicCamera`. Tout ce qui la
lit à chaque image — lancer de rayon, `CSS2DRenderer`, chaîne d'image — n'a pas à savoir laquelle
des deux elle est ; seuls le cadrage et l'échelle s'en soucient.

#### Le réglage « Qualité » ne parlait à personne

Découvert en câblant la projection : `settings.sceneQuality` n'existait que dans le store et dans
son `Segmented` (`views/SettingsView.vue`). Aucun appel ne le passait à la scène —
`useHouseScene` n'appelait `setOptions` que si son appelant lui fournissait des `options`, et
`HomeView.vue` ne lui en fournit pas. `HouseScene` restait donc sur `quality: 'auto'` quoi qu'on
choisisse.

Le symptôme était **invisible à l'œil**, et c'est ce qui l'avait laissé passer : sur cette machine
`auto` détecte `medium`, donc « Moyenne » marchait par coïncidence, « Basse » ne coupait rien et
« Haute » ne montait rien. Mesuré après correction (voile de débogage) : `high` → chaîne complète,
3 passes, 369 appels de dessin ; `low` → **aucune chaîne** (`post` reste `null`), 262 appels ;
`medium` → chaîne sans occlusion ambiante, 277 appels.

Les deux réglages passent maintenant par le même endroit dans `useHouseScene` : dans le
`setOptions` du montage, puis un `watch` chacun. L'ordre compte — ce que l'appelant impose par
`args.options` est appliqué APRÈS, donc il gagne.

### Mise à jour 2026-09-22 (bis) — voiture sous le plancher : parentage + occlusion au tap

**Symptôme** : étage focalisé, une voiture garée au RDC (sous la chambre) montrait sa pilule et
se sélectionnait au tap à travers le plancher.

**Causes** :
1. Sans `roomId` / `levelId`, un GPS + place restait parenté à `outdoorMarkers` → pilules du jardin
   toujours visibles (`setPillVisible(true)`).
2. `pick` prenait le premier appareil touché par le rayon **sans** le comparer au sol plus proche.

**Correctifs** (`HouseScene`) :
- `markerLevelId` : niveau écrit, sinon celui de la place (`parkingFixes` → `parkingLevelId`) —
  même parentage que le marquage.
- `pick` : l'appareil ne gagne que s'il est plus près que le sol (et le toit) rencontrés.
- Pilules outdoor : masquées si XY dans une pièce de l'étage focalisé **et** altitude sous ce
  plancher (`coveredByFocusedFloor`).

Sources : `apps/web/src/three/HouseScene.ts`, test dans `three.test.ts`
(« sous un étage focalisé, la voiture garée ne se voit ni ne se touche »).

### Mise à jour 2026-09-25 (nonies) — les étages s'envolent au lieu de disparaître

Jusqu'ici, focaliser un niveau masquait **d'un coup** (`group.visible = false` dans
`applyLevelFocus`) les étages au-dessus, et le toit. Désormais ils **s'envolent** : `liftTo(key, get,
baseZ, shown, fadeCutY)` les fait monter de `LEVEL_LIFT_M` = 8 m en `LEVEL_LIFT_MS` = 450 ms — un
peu moins que les 650 ms du vol de caméra qu'il accompagne — en accélérant (`easeInCubic`, ajouté à
`core/tween.ts`), puis les masque ; au retour ils redescendent en freinant (`easeOutCubic`) et se
posent **exactement** à leur élévation. Clés : `level:<id>` et `roof`.

Ce qu'il faut savoir du mécanisme :

- **État par clé** dans `lifts` (`offset`, `shown`, `tween`). Un niveau déjà dans l'état demandé ne
  rejoue rien : `applyLevelFocus` est aussi appelé à chaque sélection, et sans ce garde chaque tap
  relancerait le vol.
- **`get()` relit l'objet à chaque image** : un niveau reconstruit en plein vol (réglage d'une
  ouverture) reprend la course où elle en est au lieu de réapparaître posé. `clear()` (maison neuve)
  annule les vols et remet tout à zéro.
- **Sans renderer** (tests headless), bascule immédiate comme avant : les tests existants de pick et
  de lumières gardent leur sens.
- **Ombres** : `invalidateShadows(LEVEL_LIFT_MS + SHADOW_SETTLE_MS)` au départ, la carte suit l'étage
  pendant le vol puis se refait posée.
- **Nombre de lumières constant** : les marqueurs (`nodes.markers`) se masquent toujours
  immédiatement, et `padLamps` est rappelé en fin de vol — sinon le nombre de `PointLight` visibles
  changerait à l'arrivée et recompilerait (cf. section « une seule passe » plus haut).
  *(Plus vrai depuis la section (duodecies) : les marqueurs d'un étage qui s'envole montent avec lui
  et ne disparaissent qu'avec son groupe, à l'arrivée ; le nombre de lumières reste constant par
  `padLamps` au départ et en fin de vol.)*
- **Mode « fantôme »** : non animé — l'étage fantôme reste `shown`, seul son matériau change.

**Le fondu tramé (`core/levelFade.ts`).** Monter ne suffisait pas : l'étage devait aussi s'effacer.
Un vrai fondu demanderait des matières transparentes ; three en fait un **autre programme** (define
`OPAQUE`), donc la première transition aurait recompilé toute la maison — exactement ce que les
sections (ter) et (octies) ont chassé. À la place, un `discard` injecté derrière
`#include <clipping_planes_fragment>` de toutes les matières qui portent les chunks de brouillard
(crochet `Material.prototype.onBeforeCompile` de `levelLight.ts`, et `onBeforeCompile` propre de
l'eau dans `effects/water.ts`) : un pixel est écarté si sa **hauteur monde** dépasse `kasbahFadeY`
**et** si son seuil de Bayer 4×4 (sur `gl_FragCoord`) est ≥ `kasbahFadeVisibility`. Uniforms partagés
(`levelFadeUniforms`) : le programme ne change jamais, et au repos (visibilité 1) la condition
court-circuite — image identique au pixel près.

- **Seuil** : `topBelow(z)` = haut (élévation + hauteur) du plus haut niveau posé sous l'étage qui part
  (pour le toit, sous `roof.zBase`). Plusieurs étages partent ensemble (le RDC depuis « Tout ») → le
  seuil le plus bas l'emporte (`fadeCutY`, `Math.min`). Visibilité = 1 − offset / `LEVEL_LIFT_M` ;
  levée à (1e9, 1) quand plus aucun vol n'est en cours. *(Depuis (duodecies), seuil + 0,03 m :
  posé pile sur le dessus des murs, il les faisait scintiller.)*
- Conséquence du critère **purement en hauteur** (lu dans le shader, non observé) : pendant le vol,
  tout ce qui dépasse le seuil est tramé, pas seulement l'étage qui part.

*(Depuis la section (decies) ci-dessous, la trame n'est plus une Bayer mais un bruit IGN, injecté
avant `alphatest_fragment` et multiplié par l'opacité propre de chaque matière.)*

**Limites connues.** Pendant ~450 ms un étage en vol reste visible, donc **touchable** (pick). De
près, la trame se lit comme un quadrillage fin.

**Vérifié** : test « un étage masqué s'envole puis disparaît, et redescend se poser » (fondu partiel en
vol, seuil = haut du RDC, levé à l'arrivée, même focus → rien ne repart, repos exact) ; test
d'injection (fondu présent sur les sols intérieurs, uniform partagé). Preview, d'après le thread
principal : RDC depuis « Tout », étage monté de 8 m puis masqué, retour à son élévation et toit à 0
exactement ; scène figée à mi-course (étage +3 m, visibilité 0,5) : étage et toit à moitié tramés,
RDC intact sous 2,8 m ; aucune erreur de shader.

Sources : `apps/web/src/three/HouseScene.ts` (`liftTo`, `topBelow`, `lifts`, `LEVEL_LIFT_M`,
`LEVEL_LIFT_MS`, `applyLevelFocus`), `apps/web/src/three/core/levelFade.ts`,
`apps/web/src/three/core/tween.ts`, `apps/web/src/three/core/levelLight.ts`,
`apps/web/src/three/effects/water.ts`, `apps/web/src/three/three.test.ts` — arbre de travail non
commité après 66a72f6.

### Mise à jour 2026-09-25 (undecies) — la pièce qu'on regarde se détache

Quand on **navigue** vers une pièce (`highlightRoom` — qui depuis 5f4d9c0 ne sert plus pour un
appareil sélectionné, cf. `../4_ui/4_1_navigation-et-panneaux.md`), tout ce qui est hors d'elle
s'**assombrit** (`DIM.light` 0,45) et se **désature** (`DIM.saturation` 0,35), en fondu de
`ROOM_FOCUS_MS` = 300 ms (`fadeRoomFocus`, `easeInOutCubic` ; pas de rejeu si la cible est la
même ; immédiat sans renderer ; remis à 0 par `clear`). Le trait et le voile d'accent de la section
« La sélection d'une pièce » sont conservés.

**Un masque, pas de la transparence** (`core/roomFocus.ts`), pour les raisons de la section
(decies) : injecté après `#include <opaque_fragment>` de toutes les matières (crochet prototype +
eau). Le contour de la pièce (≤ `ROOM_FOCUS_MAX` = 24 sommets, sinon pas d'effet) est posé dans le
plan monde (x, z = −y maison) ; test point-dans-polygone par croisement, plus une tranche de hauteur
monde. Position monde reconstruite depuis la position vue : Rᵀ (p − t) avec les colonnes de
`viewMatrix`. Uniforms partagés ; à force 0 le test est sauté → image identique, aucune recompilation.

- **Contour** = `offsetPolygon(sol, exteriorWallThickness + ROOM_FOCUS_MARGIN_M)` : ses murs restent
  entiers. **Tranche** = élévation − `ROOM_FOCUS_SLAB_M` (0,35) → élévation + hauteur + marge.
- **Piège trouvé par l'utilisateur (capture)** : la première version élargissait d'**exactement**
  l'épaisseur du mur. La face extérieure tombait pile sur la limite du masque → chaque pixel
  basculait d'un côté ou de l'autre : grain « sel et poivre » qui scintillait au moindre geste,
  surtout sur le crépi (clair et en relief — la matière n'y était pour rien). Correctif :
  `ROOM_FOCUS_MARGIN_M` = 0,12 m, la limite tombe dans le vide. Voir `../6_faq/6_1_pieges-runtime.md`.
  **Contrepartie** : un mur voisin à moins de ~42 cm (30 + 12) du sol de la pièce reste un peu plus clair.
- **Diagnostic** d'un masque douteux : forcer un contour vide ou lointain (tout doit s'assombrir)
  sépare « le code ne tourne pas » de « le test géométrique répond faux » ; lire les uniforms côté
  GPU par `gl.getUniform` sur `renderer.properties.get(mat).currentProgram.program`.

**Vérifié** : test « le reste de la maison s'efface derrière la pièce, par un masque et non par
transparence » ; maison réelle (serveur de l'utilisateur, lecture seule, d'après le thread
principal) : murs propres, masque actif.

Sources : `apps/web/src/three/core/roomFocus.ts`, `apps/web/src/three/HouseScene.ts`
(`highlightRoom`, `fadeRoomFocus`, `ROOM_FOCUS_MS`, `ROOM_FOCUS_SLAB_M`, `ROOM_FOCUS_MARGIN_M`),
`apps/web/src/three/core/levelLight.ts`, `apps/web/src/three/effects/water.ts`,
`apps/web/src/three/three.test.ts` — arbre de travail non commité après f059001.

**Correction 2026-09-26 — un dégradé au lieu d'une bascule.** L'utilisateur trouvait l'effacement
« un peu brutal » : tout basculait d'un coup au contour. Le test booléen `kasbahInRoom` devient
`kasbahRoomDistance` : 0 dans le volume de la pièce, sinon `length(vec2(dh, dv))` — `dh` distance
au plus proche segment du contour (seulement dehors), `dv` écart à la tranche de hauteur. La force
appliquée vaut `kasbahFocus × smoothstep(0, FEATHER_M, distance)`, avec `FEATHER_M` = **2 m**
(3 m proposés, ramenés à 2 par l'utilisateur, « on verra à l'usage »). Les pièces voisines ne sont
qu'à peine estompées, le fond de la maison et les étages voisins le sont tout à fait ; `DIM` inchangé.
Conséquence : la limite du masque n'est plus une discontinuité, le grain du piège ci-dessus ne peut
plus revenir (la marge `ROOM_FOCUS_MARGIN_M` reste, inoffensive). Coût : une distance point-segment
par sommet du contour (≤ 24), dans la boucle déjà présente, non mesuré. Mise en valeur au sol (trait
et voile) inchangée — un halo dégradé au sol a été essayé par méprise puis annulé.

**Vérifié** : test « le reste de la maison s'efface… » (chaîne `kasbahRoomDistance( kasbahW )`
après `opaque_fragment`) ; preview simulation, salon de la démo : cuisine voisine lisible, piscine
et fond assombris progressivement, aucune erreur de shader. Un seul style et un thème regardés.

Sources : `apps/web/src/three/core/roomFocus.ts` (`FEATHER_M`, `kasbahRoomDistance`),
`apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-25 (duodecies) — les pilules de niveau suivent l'envol, en fondu ; la boucle dessine l'image où une tween finit

Demande de l'utilisateur. Depuis la section (nonies), un étage s'envole et s'estompe en 450 ms, mais
ses **pilules**, elles, étaient masquées d'un coup au départ, et celles du niveau à afficher
surgissaient aussitôt : l'étage, encore bien visible, montait sans les siennes pendant que les
nouvelles étaient déjà là.

**`fadePills(wanted)`** (`HouseScene.ts`, appelé par `applyLevelFocus` à la place de
`setPillVisible` direct). Cible par marqueur dans une `WeakMap` (`pillTargets`) :

- marqueur **jamais vu** (marqueurs refaits) ou **sans renderer** (tests headless) → posé sans fondu :
  il n'a jamais été affiché, il n'a rien d'où partir ;
- sinon, les marqueurs qui changent partagent **une seule course en temps** (`linear`) de
  max(`LEVEL_LIFT_MS` 450, `PILL_IN_DELAY_MS` 150 + `PILL_IN_MS` 550) = 700 ms, découpée en phases
  `easeInOutCubic` : celles qui **partent** s'estompent sur la durée du vol ; celles qui **arrivent**
  attendent 150 ms — le temps que l'étage commence à se dégager — puis apparaissent en 550 ms ;
- un fondu en cours **se termine d'un coup** (`finishPillFade`) quand un autre démarre : ses pilules
  prennent leur état final avant que la nouvelle course parte. `clear()` remet tout à zéro.

`DeviceMarker.setPillFade(k)` : l'opacité de la pilule = netteté du tilt-shift (`setPillFocus`) ×
fondu, et `''` (aucun style) à pleine opacité, comme avant.

**Les pilules montent avec leur étage.** `nodes.markers.visible` vaut désormais `!ghost` et non plus
`!above` : c'est le **groupe** de l'étage, masqué à l'arrivée par `liftTo`, qui retire ses marqueurs.
Nécessaire parce que `CSS2DRenderer` masque tout un sous-arbre dès qu'un ancêtre est invisible :
un `markers.visible = false` immédiat aurait éteint les pilules avant leur fondu. Le fantôme reste en
place, sans marqueurs. **Conséquence** : pendant ~450 ms, les lampes d'un étage en vol éclairent
encore (dans la tranche de hauteur de leur étage, pas le niveau regardé, cf. « une seule passe ») ; le
nombre de lumières reste constant (`padLamps` au départ et en fin de vol). Ceci remplace la puce
« les marqueurs se masquent toujours immédiatement » de la section (nonies).

**Seuil du fondu des étages : + `LEVEL_FADE_MARGIN_M` = 0,03 m** (`topBelow`). Mesuré sur la maison
démo (d'après le thread principal) : dessus des murs du RDC = 2,800 m = **exactement** l'ancien seuil,
d'où un grain qui scintillait sur ces faces pendant l'envol (signalé par l'utilisateur) ; la
couvertine `details:trim` à 2,805 m, qui appartient au niveau qui reste, était tramée entière.
Nouveau seuil 2,83 m. C'est la **deuxième** fois que la règle « jamais une limite de masque posée sur
une face » mord (après `roomFocus`, section (undecies)) : voir `../6_faq/6_1_pieges-runtime.md`.

**Boucle de rendu : l'image où une tween finit est dessinée.** Le fondu a révélé un défaut de
`core/renderLoop.ts` : une tween qui FINIT à une image n'était plus « en mouvement », et si une
animation décorative tournait sans être due (eau à 10 Hz, onde d'enceinte), la boucle sautait le
dessin. L'état final posé par `onDone` n'était pas peint : la pilule, remise à opacité 1 puis
masquée, restait affichée **pleine** jusqu'au tic suivant du décor (symptôme utilisateur : « les
pilules du RDC s'estompent, puis à la fin elles s'affichent et disparaissent »). Correctif :
`interactive = moving || dirty || finished`. Vaut pour **toutes** les tweens (fin d'envol, vols de
caméra). Voir la FAQ runtime.

**Vérifié** : tests « les pilules d'un niveau apparaissent et s'effacent en fondu, au lieu de
surgir » et « l'image où une tween finit est dessinée, même quand le décor n'est pas encore dû »
(échoue sans le correctif, d'après le thread principal). Preview (thread principal), étage → RDC :
pilule de l'étage 1 → 0,9 → 0,7 en montant (position écran 365 → 344 px), masquée à l'arrivée ;
pilule du RDC 0 → 0,1 → 0,3 → 1. `MutationObserver` sur une pilule du RDC après correctif : 1 → … →
0 → (1, masquée) dans la même mutation, plus de flash.

Sources : `apps/web/src/three/HouseScene.ts` (`fadePills`, `finishPillFade`, `pillTargets`,
`PILL_IN_DELAY_MS`, `PILL_IN_MS`, `LEVEL_FADE_MARGIN_M`, `topBelow`, `applyLevelFocus`),
`apps/web/src/three/markers/DeviceMarker.ts` (`setPillFade`), `apps/web/src/three/core/renderLoop.ts`,
`apps/web/src/three/three.test.ts` — arbre de travail non commité après a1a837a.

### Mise à jour 2026-10-03 (ter) — un tap ne traverse plus le plancher vers une poignée

Signalé par l'utilisateur : en mode édition, une ouverture sélectionnée, un tap sur le sol du 1er
« ramenait au RDC » sur une autre ouverture (ou une place). `HouseScene.pick` testait les poignées
d'ouverture et les places AVANT le bâti, sans comparer les distances : le rayon traversait le
plancher du 1er et attrapait la poignée de la fenêtre du RDC juste dessous. Désormais une poignée ou
une place ne gagne que si elle n'est pas derrière le premier élément bâti touché
(`nearestBuiltHit` : sols et murs des niveaux montrés, toit visible), marge `WALL_PICK_TOLERANCE_M`
(5 cm, celle des appareils contre un mur). La distance n'est calculée qu'au besoin.

Test : `apps/web/src/three/pickOcclusion.test.ts` (rayon de l'étage vers une fenêtre du RDC ; rouge
sans le garde, contrôle fait). Le côté panneau (tap sur une pièce pendant un réglage) est dans
`../4_ui/4_1_navigation-et-panneaux.md`.

Sources : `apps/web/src/three/{HouseScene,builders/buildHouse,builders/materials,textures/assets}.ts`,
`apps/web/src/composables/useHouseScene.ts`.

### Mise à jour 2026-10-03 (quater) — l'éditeur de forme d'une pièce, et `updateBuilding`

**`RoomShapeEditor`** (`three/shape/roomShapeEditor.ts`) : la ligne des COTES de la pièce (au milieu
des cloisons) en trait d'accent, un point par sommet, une poignée plus grosse au milieu de chaque
mur, et la longueur de chaque côté en étiquette `sceneNote('gap')`, un peu dans la pièce pour laisser
la poignée dégagée. Posé dans `level.markers` / `level.labels` (groupes qui survivent à la
reconstruction d'un niveau), `DECOR_LAYER`, `depthTest: false`. Contrairement aux éditeurs du terrain,
**pas de « choisir d'abord »** : une poignée s'attrape directement (le `hitTest` du détecteur ne prend
que les poignées ; ailleurs, le glissement fait orbiter). Un mur rend un déplacement le long de sa
normale, un sommet une position, arrondis au centimètre et **mesurés depuis le début du geste**.
L'éditeur ne calcule rien de la maison : événements `shapeWall`, `shapeCorner`, `shapeSelect` ;
`setShapeEditing(roomId)`, `setShapeOutline(points)`, `setShapeSelection(sel)`. Il est recréé à un
rechargement complet (`load`), son groupe de niveau étant neuf. `handleTap` lui donne d'abord le tap :
une poignée touchée le garde, sinon il continue (taper une autre pièce reste possible).

**`updateAppearance` → `updateBuilding`** : `updateAppearance` (section bis) devient `updateBuilding` et
couvre aussi la forme : géométrie recalculée, reconstruction des SEULS niveaux dont la géométrie a
changé (tous si la façade change), toit refait si son descripteur change (emprise), terrain
rééchancré si les emprises au sol changent, marqueurs refaits si les appareils (auto-placés au
centre de leur pièce) ont bougé. `useHouseScene` : `sameShellButBuilding` (même site, toit déclaré,
défauts, niveaux hors emprise, et mêmes pièces) testé après `sameShellButOpenings` — qui compare
désormais `house.style` (une façade seule y passait). Les appareils ne sont PAS comparés par ce
dernier : un ouvrant lié suit sa baie, ses appareils changent donc à chaque glissement d'ouverture.

Mesuré dans la preview simulée (7 pièces) : ~9 ms par pas de glissement, dont 2,5 ms de calcul dans
le store ; non mesuré sur la maison réelle.

Sources : `apps/web/src/three/{shape/roomShapeEditor,HouseScene}.ts`, `apps/web/src/composables/useHouseScene.ts`.

### Mise à jour 2026-10-29 — plusieurs toits : un mesh par toit, des pignons en façade

Contexte : `house.roofs[]` remplace le toit unique (`../2_maison/2_0_format-house-json.md` et
`../2_maison/2_1_geometrie.md`, même date). `HouseNodes.roof` devient **`roofs: Mesh[]`**, un mesh par
toit dans l'ordre du fichier, sur `HouseScene` et `builders/buildHouse.ts`.

**Visibilité par niveau.** Avant, un seul `liftTo('roof', …)` : le toit apparaissait en vue d'ensemble et
depuis le niveau qu'il porte. Désormais chaque toit `i` a le sien, `liftTo('roof:i', …)`, visible en vue
d'ensemble et depuis les niveaux posés **à sa hauteur d'égout ou au-dessus** (`focused.elevation ≥
zBase`). Sur la démo des Tilleuls, depuis l'Étage la maison n'a plus de toit et l'abri de jardin garde le
sien ; au RDC aucun toit ne s'affiche. `applyLevelFocus` est rappelé après la reconstruction (`rebuildRoof`)
parce qu'un mesh neuf naît en place et le niveau focalisé peut devoir le cacher.

**Toucher un toit.** `pick()` lance le rayon sur tous les toits visibles (`shownRoofs()`), et ouvre
`roofLevelOf(roof)` : le **plus bas niveau** posé à l'égout du toit ou au-dessus. Même effet qu'au
2026-09-12 (quinquies) : on obtient ce qu'on voit. `mainRoof()` (le toit le plus haut) reste la référence
du **niveau-toit** déclaré pour les panneaux (cadrage, caméra) ; `roofUnder` choisit le toit d'une fenêtre
de toit (trou, cadrage de la fenêtre depuis le niveau qui montre SON toit).

**Les faces verticales sortent du toit.** Pignons d'un 2 pans, côtés et haut mur d'un 1 pan : sur demande
de l'utilisateur (« ces côtés sont en fait des murs »), `buildRoofMesh` les retire du mesh de tuiles
(`isWallFace` : aire en plan nulle) et les met dans un enfant **`roof:gables`**, au matériau de **façade**
(`finishMaterial(mats, 'facade', house.style.facade)` s'il existe, sinon `mats.wall`). L'index des faces
reste celui du descripteur (le trou d'une fenêtre de toit nomme sa face par index : la face-mur devient
une liste vide, elle n'est pas supprimée). Conséquence : **un changement de finition de façade refait
aussi les toits** (`updateBuilding` : `facadeChanged || roofs différents → rebuildRoof`).

**Planches de rive** (`buildRoofDetails`, `builders/details.ts`) : elles ne suivent plus que les arêtes
posées sur le **contour du rectangle** du toit (égout, rives, haut d'un 1 pan). Ni faîtage ni arêtiers
(ils sont à l'intérieur du rectangle). Cela remplace l'ancienne règle « pas de planche sur le faîtage »
(`a[2] ≥ zRidge`), propre au 2 pans.

**Piège : les observateurs de `useHouseScene.ts` ne regardaient que `h.roof`.** `sameShell`,
`sameShellButOpenings` et `sameShellButBuilding` comparent une photographie JSON de la maison pour décider
si la scène se redessine, et de combien. Aucun ne lisait `roofs` : une modification de `roofs` aurait été
jugée « même enveloppe » et **la scène ne se serait pas redessinée**, sans erreur. Ils comparent maintenant
`h.roofs` et `h.roof`. À refaire pour tout nouveau champ de la maison qui change la géométrie.

Vérifié dans la preview simulée sur la démo Tilleuls (abri, vue Étage, 4 pans essayé en direct sur la
maison, pignons en enduit), sans erreur console. Tests : `three.test.ts`, `builders/shapes.test.ts`,
`builders/roofWindow.test.ts`.

Sources : `apps/web/src/three/{HouseScene,builders/buildHouse,builders/details,builders/shapes}.ts`,
`apps/web/src/composables/useHouseScene.ts`, `apps/web/src/stores/house.ts`.
