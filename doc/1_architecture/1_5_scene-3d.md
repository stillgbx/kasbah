# Scène 3D (Three.js)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/core/*.ts`, `apps/web/src/three/builders/*.ts`, `apps/web/src/three/markers/*.ts`, `apps/web/src/composables/useHouseScene.ts`, `apps/web/src/three/markers/DeviceMarker.ts`, `apps/web/src/three/markers/screenArt.ts`, `apps/web/src/lib/audioRouting.ts`, `packages/shared/src/house/panels.ts`, `apps/web/src/lib/orientation.ts`, `apps/web/src/three/markers/markers.ts`, `apps/web/src/three/core/theme.ts`, `apps/web/src/three/styles/*.ts`, `apps/web/src/three/textures/{procedural,assets}.ts`, `apps/web/src/three/core/layers.ts`, `packages/shared/src/house/openings.ts`, `apps/web/src/three/core/cameraFit.ts`, `apps/web/src/three/effects/water.ts`, `apps/web/src/three/effects/disco.ts`, `apps/web/src/three/effects/parade.ts`, `apps/web/src/three/builders/parking.ts`, `packages/shared/src/house/sun.ts`, `apps/web/src/three/builders/terrain.ts`, `apps/web/src/three/relief/reliefEditor.ts`, `apps/web/src/three/effects/roam.ts`, `apps/web/src/three/effects/bats.ts`, `apps/web/src/three/garden/gardenLayer.ts`

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

## Thème

`core/theme.ts` lit les variables `--v-theme-*` de Vuetify (parseur tolérant `r,g,b`, `rgb()`, hex)
et `builders/materials.ts` mute ~15 matériaux partagés : un changement de thème ne touche aucun
maillage. Les couleurs de scène (`sceneWall`, `sceneLawn`…) sont déclarées dans les thèmes Vuetify
(`apps/web/src/plugins/vuetify.ts`).
*(Dépassé le 2026-09-15 : la matière dépend du style de rendu (`three/styles/`) ; `core/theme.ts` ne lit plus que les repères d'interface, et `sceneWall` / `sceneLawn` ne sont plus déclarés dans les thèmes Vuetify — voir « Mise à jour 2026-09-15 (septies) ».)*

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

### Mise à jour 2026-09-09 — onde sonore d'un lecteur en lecture

Demande de l'utilisateur : « l'appareil concerné peut émettre une sorte de pulse simulant des ondes
sonores ». `GenericMarker` (`three/markers/markers.ts`) porte, pour un `media_player`, trois anneaux
plats (`RingGeometry`, plan XY = le sol en Z-up, couleur `theme.primary`, `depthWrite: false`) posés
3 cm au-dessus de la base de l'appareil. Tant que l'état est `playing`, une animation enregistrée par
`ctx.addAnimation` les fait naître à 18 cm de rayon et s'élargir jusqu'à 1,2 m en 2,6 s, décalés
d'un tiers de période, l'opacité tombant en (1 − p)² ; dès que la lecture s'arrête, le pas rend
`false`, les anneaux sont cachés et la boucle de rendu à la demande se rendort. La forme du corps
suit la nature du lecteur (cylindre, écran plat, petite dalle — cf. `../4_ui/4_0_langage-visuel.md`).
Le marqueur ne fait qu'une lecture d'état : c'est `isOn` qui décide, comme pour la teinte de la pilule.

### Mise à jour 2026-09-09 — les écrans regardent dans leur `yaw`

Dans `GenericMarker`, l'écran plat d'un téléviseur et la dalle d'un écran connecté tournent de
`device.yaw` (0 = face à +y, comme la carrosserie du véhicule) ; le cylindre d'une enceinte n'en a
pas besoin. Les marqueurs étant reconstruits à chaque changement de placement (`updateDevices`),
une rotation depuis le panneau se voit aussitôt dans la scène.

### Mise à jour 2026-09-09 — cône « regarde vers » en mode « Déplacer »

Demande de l'utilisateur : voir, pendant la rotation, dans quelle direction l'appareil regarde. En
mode « Déplacer », le guide du marqueur (`DeviceMarker.setMoving`) ajoute, pour un appareil
**orientable** (règle partagée avec le panneau : `lib/orientation.ts` — lecteur `tv` / `display`,
caméra, véhicule), un cône plat au sol depuis l'appareil vers +y, long de 1,6 m, teinté `theme.primary`
à 45 % et tourné du `yaw`. Les marqueurs étant reconstruits à chaque écriture du placement, le cône suit
chaque pression des touches de rotation. Il disparaît avec le guide à « Terminé ». Vérifié sur le
Chromecast de la chambre : cône vers +y à 0°, tourné à 45° et 90°, puis retour à 0°.

### Mise à jour 2026-09-09 — onde sonore plus forte devant que derrière

Demande de l'utilisateur : « toujours des cercles, mais avec un fondu plus important dans le dos ».
Les anneaux passent d'un `MeshBasicMaterial` à un petit `ShaderMaterial` maison (`waveMaterial`) :
couleur unie, opacité pilotée par l'animation (`uOpacity`), et pour un lecteur qui regarde quelque
part (`tv` / `display`, `uDirectional = 1`) un fondu angulaire calculé au fragment — pleine intensité
vers +y local, ≈ 10 % dans le dos (`0.1 + 0.9 · front²`, `front = ½ + ½ cos θ`). L'anneau est tourné du
`yaw` comme l'écran, donc le « devant » de l'onde suit l'orientation réglée depuis le panneau. Une
enceinte garde des cercles uniformes. Le thème recolore via l'uniforme `uColor`.

### Mise à jour 2026-09-10 — l'onde se voit enfin : couleur propre, fondu linéaire, pulsation lente

Constat de l'utilisateur : l'onde ne ressort pas. Deux causes distinctes, la couleur et la courbe.

**La couleur.** Les anneaux étaient teintés `theme.primary` (cf. la mise à jour du 2026-09-09
ci-dessus) : à partir du 2026-09-10 c'est `theme.media`, jeton de scène dédié `sceneMedia`
(`#1a73d8` en clair, `#5aaeff` en sombre — `../4_ui/4_0_langage-visuel.md`). L'accent est un choix de
l'utilisateur parmi quatre ; en teal l'onde se confondait avec la surbrillance de la pièce, en indigo
avec les murs.

**La courbe, qui était le vrai frein.** L'opacité tombait en `0.55 · (1 − p)²` pendant que le rayon
grandissait de 18 cm à 1,2 m : l'anneau était éteint **avant** d'être assez large pour se voir, et
son épaisseur (8 % du rayon, `RingGeometry(0.92, 1)`) le laissait sous le pixel tant qu'il était
encore opaque. Au milieu de sa course il valait ~3 px à 20 % d'alpha sur un sol chargé — invisible en
pratique, ce qu'une capture au ratio 1:1 a confirmé (une capture réduite, elle, l'efface pour de bon
et fait croire à un anneau absent).

Retenu : fondu **linéaire** `0.85 · (1 − p)`, anneau à **14 %** du rayon (`RingGeometry(0.86, 1)`) et
`WAVE_PERIOD_MS` porté de 2,6 s à **5,75 s** — valeur posée par l'utilisateur après un essai à 3,6 s.
Trois anneaux lents qui se lisent comme une onde, en clair comme en sombre.

Vérifié dans la simulation in-process (`VITE_INPROCESS_MOCK=1`, enceinte de cuisine en lecture),
thèmes clair et sombre. Commit `7ced3c2`.

### Mise à jour 2026-09-10 — la pochette s'affiche SUR l'écran du lecteur

Demande de l'utilisateur : « on pourrait afficher l'artwork sur une face de l'objet 3D — ex. la
pochette du titre en cours sur la TV salon ». `markers/screenArt.ts` : un plan texturé, enfant du
maillage de l'écran (donc tourné du même `yaw`), posé 2 mm devant la face avant. L'image est celle que
l'état porte déjà (`nowPlaying.artUrl`, servie par notre origine — pas de CORS), pochette du morceau
ou logo de l'appli selon ce que le plugin a trouvé (`../3_plugins/3_6_google-cast.md`). Seuls les
lecteurs à écran en ont un (`tv`, `display`) : une enceinte n'a pas de dalle.

**Orientation** — dans le repère local d'une boîte d'écran (X = largeur, Y = profondeur, Z = hauteur),
le plan a sa normale en +Y, le haut de l'image en +Z et son côté droit en **−X**. Ce dernier point
n'est pas une coquetterie : quelqu'un placé devant l'écran (en +Y, regardant vers −Y) a sa droite en
−X. Vouloir « droite = +X » avec le haut en +Z et la normale en +Y demande un **miroir**
(déterminant −1), pas une rotation — l'image sortirait retournée. Un test l'épingle par les UV des
coins, plutôt que par une capture d'écran.

**Cadrage « cover », jamais de déformation** — une pochette est carrée, une dalle est en 16:9. Premier
essai : l'image en carré centré, écarté par l'utilisateur (« un timbre au milieu »). Retenu :
`coverCrop` calcule la part de l'image à montrer, comme `object-fit: cover` en CSS — bande centrale
(56 % de la hauteur d'une pochette carrée sur un 16:9), rognée en haut et en bas, jamais étirée.
Format inconnu : on la suppose carrée, on n'étire pas.

**Voile dégradé** — noir, de 0 % en haut à 25 % en bas : cela reprend ce que l'utilisateur fait dans
ses projets web (`.background-shade`, un `linear-gradient(#0000, #00000040)` empilé sur l'image) —
une pochette très saturée devient moins criarde et se marie avec une maquette gris-bleu. En CSS c'est
une couche au-dessus ; ici la même chose en une multiplication avant le mélange alpha, puisque
composer du noir d'opacité `a` sur une couleur `c` donne `c · (1 − a)`.

**Essayé et retiré le même jour** : un fondu des quatre bords (9 % de la hauteur, de largeur égale en
mètres). L'idée était d'éviter une arête franche ; mais le plan épouse exactement la dalle, donc le
bord de l'image tombe sur l'**arête de l'écran** — une arête vraie, qui appartient à l'objet. Le
fondu mangeait de l'image sans rien résoudre. Le shader ne fait donc plus que deux choses : cadrer,
puis voiler.

Matériau NON éclairé : un écran émet sa lumière. Éclairé, il serait sombre dans une maison dont les
lampes sont éteintes — précisément ce qu'on veut voir.

**Deux points de couture ajoutés à `MarkerContext`** : `invalidate()` (la scène ne rend qu'à la
demande, et une texture qui arrive une seconde plus tard n'anime rien — sans lui l'image n'apparaît
qu'au prochain geste) et `loadTexture?` (injection du chargeur, comme `HouseSceneOptions` injecte
déjà son renderer : les tests éprouvent le cycle de vie des textures sans WebGL).

Cycle de vie : une réponse tardive dont l'URL n'est plus celle attendue est **jetée** (l'utilisateur a
pu zapper), la texture remplacée est **libérée** (sinon elle reste en mémoire vidéo), et l'écran
redevient nu dès que l'appareil ne répond plus, que rien ne joue, ou que le morceau n'a pas d'image.

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

### Mise à jour 2026-09-10 — l'onde est du SON : elle va sur l'appareil qu'on entend

Constat de l'utilisateur : la TV du salon joue YouTube Music mais c'est la barre de son qui joue le son
(HDMI eARC) ; l'onde était sur la TV, la barre restait muette. Le marqueur ne voit que son propre état,
or ce qu'on entend ici dépend d'un autre appareil : la décision monte donc dans la scène.
`HouseScene.updateStates` calcule le routage du son à partir de la maison et de tous les états
(`soundRouting`, `emitsSound` — `apps/web/src/lib/audioRouting.ts`, voir
`../1_architecture/1_4_app-web.md`) et passe à chaque marqueur un **`SoundCue`** (`DeviceMarker.update(state, sound)`) :
`emits` (du son sort de lui) et `relayFrom` (l'état du lecteur dont il joue le son). `GenericMarker`
anime l'onde sur `sound.emits` (l'état seul reste le repli, pour les tests et un marqueur sans indication) ;
la pilule est teintée « active » aussi quand l'appareil relaie. La **pochette reste sur l'écran** de la TV :
l'image est chez elle, le son chez la barre. Le diff par référence prend en compte le changement de
`SoundCue` : la barre se met à jour quand c'est la TV qui change (elle n'a pas d'état propre qui bouge).
Vérifié en réel : anneaux autour de la barre (cylindre uniforme), logo YouTube sur la TV sans anneau.

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


### Mise à jour 2026-09-11 — modules photovoltaïques, toit comme niveau, coffrets orientables

**`PanelMarker`** (`markers/markers.ts`) : un module d'un champ de panneaux est une dalle aux
dimensions du module, couchée, inclinée du `tilt` de son champ et orientée de son `yaw`, qui tire
vers l'accent à mesure qu'elle produit (pleine intensité vers 450 W). Son kind reste `sensor` — c'est
une puissance en watts — et c'est `meta.panel` qui dit que ce capteur est un module posé sur un toit :
`createMarker` teste `panelOf(device)` **avant** le kind. Sa pilule prend l'icône solaire plutôt que
celle d'un capteur.

**Le toit reste visible depuis le niveau qui le porte.** `applyLevelFocus` le masquait dès qu'un
niveau était focalisé ; il se voit maintenant en vue d'ensemble **et** depuis un niveau dont
l'élévation atteint la base du toit (`isRoofLevel`). Sans cela, déclarer le toit comme un niveau pour
y poser des panneaux donnait une scène vide. `focusLevelView` cadre ce niveau **avec** le toit, qui
n'a ni pièce ni contour à cadrer autrement.

**Orientation élargie** : le cône « regarde vers » du mode déplacement, et surtout la rotation du
maillage, s'appliquent désormais aussi à `ev_charger` et `energy`. Piège à retenir : rendre un
appareil orientable dans `lib/orientation.ts` ne suffit pas — la rotation du maillage est une
condition séparée dans `GenericMarker`, et sans elle le cône tournait pendant que le coffret restait
figé.

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

### Mise à jour 2026-09-12 — les thèmes nommés s'arrêtent au bord de la maison

Les quatre accents sont devenus six thèmes qui portent toute la palette de l'interface
(`../4_ui/4_2_theme-et-langues.md`, commit `abf88f5`). **La scène 3D, elle, ne change pas** :
`SCENE_LIGHT` / `SCENE_DARK` de `plugins/vuetify.ts` restent deux palettes communes à tous les
thèmes, et `three/core/theme.ts` les lit comme avant sous `--v-theme-scene*`. Murs, sols, verre,
toit, terrain, eau et zones gardent donc leurs couleurs « de matière » quel que soit le thème.

Arbitrage de l'utilisateur, à la question posée avant d'écrire le code : « si possible thémer les
points, pastilles, bulles, labels, ondes… les éléments 3d restent pour l'instant comme ils sont ».
Ce qui suit le thème est donc ce qui est **posé sur** la maison, pas la maison :

- les **disques de catégorie** des pilules et leurs trois niveaux de détail (jetons `--cat-*`,
  déclarés par chaque palette) ;
- la **sélection** d'une pilule (`--accent` / `--on-accent`) et la teinte du sol de la pièce
  sélectionnée, qui tire vers `primary` ;
- l'**onde du lecteur en diffusion** : `sceneMedia` reste la seule couleur de scène dérivée du
  thème, égale à son `catMedia`. La mise à jour du 2026-09-10 ci-dessus disait « indépendante de
  l'accent » — elle l'est toujours de l'accent, mais elle **suit maintenant le thème**, ce qui
  répond au même besoin : elle ne peut pas se confondre avec la surbrillance de pièce, puisque celle-ci
  tire vers l'accent et que les deux teintes sont choisies distinctes dans chaque palette.

Rien à changer côté mécanique : le thème est toujours relu après `nextTick` et mute les ~15
matériaux partagés, aucun maillage n'est reconstruit.

### Mise à jour 2026-09-12 — ouvrants libres (portail, stores) et thermostat en pastille

**Ouvrants sans ouverture liée.** `CoverMarker` leur dessinait une boîte de 0,6 × 0,06 × 0,5 m, jamais
orientée : un portail de 4 m et un store banne de terrasse y ressemblaient au même bouchon. Le
marqueur lit maintenant `size`, `yaw` et `leaves` du JSON (`../2_maison/2_0_format-house-json.md`),
montés dans un **pivot qui porte le `yaw`** — ce qui bouge ensuite se calcule dans un repère où
l'ouvrant regarde toujours +y, sans refaire la trigonométrie à chaque fois.

- **Store** (`isFlatCover`) : une dalle **horizontale** (son épaisseur est verticale — un panneau
  dressé à sa place ne ressemblait à rien), largeur × avancée. La part FERMÉE l'anime, comme la lame
  d'un volet : déployé = l'avancée déclarée, replié = 30 cm (`AWNING_ROLLED`, le coffre et la toile
  enroulée dedans). C'est le bord **côté mur** qui reste fixe : la toile rentre vers lui.
- **Portail** : un ou deux battants **debout**, chacun pendu à une charnière posée au bord extérieur,
  du plan fermé au quart de tour ouvert (`LEAF_SWING`).
- **Position inconnue** : un ouvrant libre est dessiné **tel qu'il est déclaré** (store déployé,
  portail clos), là où un volet lié à une ouverture rentre son tablier. La règle diverge exprès : ne
  rien dessiner dans une embrasure se lit bien, un moignon au bout d'une terrasse passerait pour un
  défaut d'affichage.
- La **pilule** suit `coverActivity` (`1_4_app-web.md`) : elle se remplit pour un volet ouvert, mais
  pour un store DÉPLOYÉ.

**Thermostat.** Le coffre de 0,9 × 0,3 × 0,7 m écrasait le palier où il est posé. Il devient une
**pastille** de 12 cm (cylindre de rayon 0,06 m, épais de 4 cm) qui **garde l'axe +y du cylindre** au
lieu de le basculer en Z-up comme une enceinte : elle est donc couchée contre son mur, ses deux
disques verticaux, et le cadran regarde la pièce dans la direction du `yaw`.

**Qui s'oriente.** `lib/orientation.ts` compte maintenant trois familles : ce qui REGARDE quelque part
(écran, caméra, véhicule), ce qui a une FACE contre un mur (borne, batterie, passerelle, et désormais
le thermostat) et ce qui BARRE un passage (ouvrant libre). Les ouvrants libres gagnent du même coup
une taille réglable (`isSizable`) et, debout, un nombre de battants (`hasLeaves`).

Trois tests headless (`apps/web/src/three/three.test.ts`) vérifient la géométrie plutôt que de
commander du vrai matériel : avancée rentrée sans que le bord mural bouge, battants au quart de tour
(un ou deux selon le JSON), pastille couchée et tournée du `yaw`.

### Mise à jour 2026-09-12 (bis) — un ouvrant libre à position inconnue est dessiné AU REPOS

**Remplace** la règle écrite plus haut le même jour (« un ouvrant libre est dessiné tel qu'il est
déclaré, store déployé, portail clos »). Décision de l'utilisateur : faute de savoir, on suppose
partout l'état de **repos** (`coverAtRest`, `1_4_app-web.md`), et le dessin suit — un volet rentre son
tablier, un **store se replie sur son coffre** (30 cm), un portail reste clos. La scène montre donc ce
qu'on suppose pour décider : une seule supposition, pas deux.

Conséquence assumée sur un parc RTS : des stores jamais commandés depuis Kasbah apparaissent repliés
malgré l'avancée réglée dans `house.json`, jusqu'à la première commande qui donne une position
déduite. C'est le même compromis que le volet de fenêtre, invisible tant qu'il n'a rien dit.

### Mise à jour 2026-09-12 (ter) — les ombres portées redeviennent douces

Constat de l'utilisateur : « les ombres portées ne sont pas terribles ». Deux causes, l'une dans le
mode d'ombre, l'autre dans le cadrage.

**Le mode.** Le renderer demandait `PCFSoftShadowMap`. Depuis **three 0.184** cette constante est
dépréciée et retombe sur `PCFShadowMap` — des ombres **dures**, crénelées — en le disant dans la
console (`THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated`). L'avertissement passait
inaperçu au milieu des logs de Vite. Depuis le 2026-09-12 : `VSMShadowMap` (Variance Shadow Maps), qui
floute nativement, piloté par `sun.shadow.radius = 3` et `blurSamples = 16`. C'est le même constat et
le même remède que dans l'éditeur voxel d'`un autre projet` (`VoxelMapsView.vue`), dont ce correctif
s'inspire. Compromis connu de VSM : du light bleeding possible sur une géométrie très dense — rien de
visible sur une maison.

**Le cadrage, qui était le vrai frein.** `fitSunShadow` ajustait la caméra d'ombre sur
`geometry.bounds`, c'est-à-dire les bornes de la **maison, terrain compris**. Sur une parcelle large,
la carte 2048 passait l'essentiel de ses texels sur de la pelouse vide : au sol, aucune ombre portée ne
se voyait. Elle se cadre maintenant sur le **bâti** (`buildingBounds`), puis le frustum est ajusté aux
**huit coins** de cette boîte exprimés dans le repère de la lumière (axes dérivés de
`position − target`), avec une marge de `max(0,5 m, 8 % du rayon)` pour que le flou VSM ne soit pas
coupé au bord. Aucune ombre portée n'est perdue par ce resserrement : dans le repère de la lumière,
l'ombre d'une boîte tient exactement dans l'emprise de cette boîte.

> **Ajout 2026-09-28 — le jardin entre dans le cadre.** Depuis les arbres du jardin
> (`../2_maison/2_2_jardin.md`), `fitSunShadow` cadre sur le bâti **plus** `GardenLayer.worldBounds()`
> (tous les éléments, hauteur comprise) : sans cela un arbre hors du bâti n'avait pas d'ombre et celle
> d'un grand arbre était coupée au bord. C'est un retour PARTIEL vers le cadrage large écarté ci-dessus :
> mesuré sur la maison de démo avec des arbres aux bords d'une parcelle de 32 × 30 m, le texel passe de
> **0,87 à 2,41 cm** (carte 2048 inchangée). Les ombres des arbres se voient sur la pelouse (capture
> faite), l'impact sur la netteté des ombres de la maison n'a PAS pu être jugé à l'œil (captures figées
> du panneau). Parade prévue si c'est trop flou : ne faire entrer dans le cadre que les éléments hauts
> ou proches du bâti, les autres gardant leur ombre de contact.

**Le biais.** `shadow.bias = −0.0005` seul décollait l'ombre de son objet sans traiter l'acné des murs
rasants. On lui ajoute `shadow.normalBias = 0.02` : le point testé est décalé le long de la **normale**,
ce qui est la bonne parade pour une surface vue de biais par le soleil.

Vérifié dans l'app sur la maison réelle, thèmes clair et sombre, en vue Jardin, Tout, RDC et 1er, plus
un zoom serré sur un angle du bâtiment : l'ombre du bâtiment se pose enfin sur la pelouse, les
cloisons portent une ombre douce sur le sol du niveau, et aucune acné n'apparaît sur les façades.

Les artefacts de **jonction** signalés dans la même demande ne venaient pas du rendu mais de la
géométrie : voir `../2_maison/2_1_geometrie.md`, mise à jour du même jour.

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

### Mise à jour 2026-09-13 — la jauge de bord d'un module, et ses deux repères

Un module (`PanelMarker`) disait déjà sa production en TEINTE : son verre tire vers l'accent et
s'allume à mesure qu'il approche de la crête déclarée par son champ (`meta.panel.peakW`). Deux
choses s'y ajoutent, parce qu'une teinte se compare mal d'un module à l'autre au-delà de « plus
clair / plus sombre » :

- une **jauge de bord** : un trait de 4,5 cm posé le long d'un côté du verre, qui monte depuis le
  bord BAS (celui qui penche vers l'azimut). Enfant de la dalle, il épouse d'office l'inclinaison et
  l'orientation du champ. Une piste à peine visible occupe tout le côté, pour qu'un module à l'arrêt
  garde un trait et non un trou ;
- **deux repères** posés en travers de ce trait, TOUJOURS visibles que la jauge les atteigne ou non :
  la puissance de sortie de l'onduleur (`meta.panel.maxOutputW`, couleur `warning` — celle du repère
  de position favorite d'un ouvrant) et le record de l'appareil (`SensorState.maxValue`, couleur
  `success`). Le plafond est rendu APRÈS le record (`renderOrder` plus grand) : quand les deux
  coïncident, il ne reste que le plafond, et c'est bien ce qu'il y a à dire.

L'échelle du trait n'est pas la crête du module mais **la plus grande des trois valeurs en jeu**
(crête, plafond, record). Sans ça, un IQ8P de 480 W sous un module de 450 Wc voyait son repère
disparaître sans un mot.

`SceneTheme` gagne donc `warning` et `success`, lus comme les autres couleurs dans les variables
Vuetify du thème courant (`--v-theme-warning`, `--v-theme-success`).

**Deux pistes essayées puis abandonnées**, notées ici pour ne pas les reprendre : un ANNEAU de
progression autour du disque d'icône de la pilule (refusé parce que la pilule se réduit à un point
dès qu'on s'éloigne, `data-lod` — la production, elle, doit se lire à toute distance), et un
REMPLISSAGE du verre entier depuis son bord bas (plus précis, mais un module coupé en deux n'est plus
un module, et le toit devient un tableau de bord). Sources : `apps/web/src/three/markers/markers.ts`,
`apps/web/src/three/core/theme.ts`, test `three.test.ts`.


### Mise à jour 2026-09-14 — les véhicules se placent d'après leur GPS

Une voiture n'a **pas** de `position` dans `house.json` (cf. `../2_maison/2_0_format-house-json.md`) :
sa place est **calculée à chaque relevé**. `sitePosition(house, gps)`
(`packages/shared/src/house/geo.ts`, pur) projette le point dans le repère local et rend `null`
**hors du terrain** — une voiture au bureau n'a rien à faire dans le jardin, et ne doit donc pas y
apparaître, fût-ce au bord. `z = 0` : posée sur le terrain.

Trois conséquences dans `HouseScene` :

- **`effectivePosition(device)`** remplace la lecture directe de `device.position` : celle du JSON,
  ou celle que le GPS donne à un véhicule. `null` = pas de marqueur.
- **`drawable()`** : la scène dessine les appareils de la maison **plus les véhicules qu'elle ne
  connaît pas**. Une voiture n'a pas à être déclarée pour apparaître ; ce qui la met dans la scène
  est son GPS, pas une ligne de configuration. Ces véhicules-là sont identifiés par leur **`deviceId`
  de plugin** (`tesla:5YJ…`) et non par un id de maison inventé : c'est l'autre espace de clés que
  l'app sait déjà résoudre (`useDeviceResolver`). Un id fabriqué ne résolvait ni le nom, ni le kind,
  ni les commandes — le panneau affirmait alors « cet appareil n'est lié à aucun plugin ».
- **Un véhicule qui a bougé refait les marqueurs** : son marqueur n'existe peut-être pas encore (il
  vient de rentrer) ou n'a plus lieu d'être (il est parti). La comparaison porte sur la position GPS
  d'un relevé à l'autre ; à une lecture toutes les dix minutes, reconstruire coûte moins cher que de
  maintenir un cas particulier dans la boucle d'états.

Côté panneau, le bouton **« Placer » disparaît pour un véhicule** (comme pour une tondeuse) : sa
place vient du GPS, la proposer à placer serait un bouton sans effet.

Sources : `packages/shared/src/house/geo.ts`, `apps/web/src/three/HouseScene.ts`,
`apps/web/src/components/home/DevicePanel.vue`.


### Mise à jour 2026-09-14 — la voiture se recale, et cesse de regarder le nord

Deux corrections sur le marqueur d'un véhicule placé par son GPS.

**Le décalage.** `effectivePosition` passe le `gpsOffset` de l'entrée de maison à `sitePosition`
(cf. `../2_maison/2_0_format-house-json.md`) : quelques mètres d'erreur constante — biais du GPS de
la voiture, approximation de l'origine de la maison — se rattrapent depuis la carte du véhicule,
une fois pour toutes. Sans effet sur un appareil qui a une `position` écrite : elle fait déjà foi,
et la vue Véhicules n'offre alors même pas le réglage.

**L'orientation.** `VehicleMarker` tournait son corps du seul `device.yaw` du JSON — qu'une voiture
n'a pas. Toutes les voitures posées par leur GPS regardaient donc le nord. La chaîne est maintenant,
du plus sûr au plus supposé (`HouseScene.vehicleYaw`) :

1. le **`yaw` du JSON**, s'il a été posé à la main : l'utilisateur a tranché ;
2. le **cap du fabricant** (`headingDeg`), ramené dans le repère de la maison —
   `yaw = origin.heading − headingDeg`, les deux conventions étant inverses (cap horaire depuis le
   nord vrai contre rotation trigonométrique depuis +y) ;
3. l'**axe de la pièce fermée** qui contient le point (`longestEdgeYawDeg`, cf.
   `../2_maison/2_1_geometrie.md`), pièces essayées du niveau le plus bas au plus haut : une
   voiture est au rez-de-chaussée, pas dans la chambre qui le surplombe. C'est le cas de la R5 dans
   son garage, Renault ne publiant aucun cap ;
4. rien : le marqueur garde son défaut, personne n'affirme un cap.

`vehicleFix` — la signature qui décide de refaire les marqueurs — porte désormais le cap en plus de
la position : une voiture qui se gare tourne parfois sans changer de place au mètre près.

Vérifié par trois tests de scène montés sur la maison de démo dont la voiture a été « dé-placée » :
le décalage déplace bien le marqueur, le cap du fabricant l'oriente, et un point tombant dans le
salon (allongé selon x, rez-de-chaussée) le met au quart de tour quand aucun cap n'est donné.

Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/markers/markers.ts`,
`packages/shared/src/house/{geo.ts,geometry/vec2.ts}`, test `apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-14 (ter) — la rotation se corrige comme la place

Le cap déduit ne dit pas de quel côté la voiture s'est garée : un cap mesuré est juste mais la
carrosserie peut être modélisée à l'envers, et l'axe d'un garage donne une droite, pas un sens. D'où
un **`yawOffset`** dans l'entrée de maison (cf. `../2_maison/2_0_format-house-json.md`), symétrique
du `gpsOffset` : une correction constante, saisie une fois.

Elle **s'AJOUTE** au cap déduit, elle ne le remplace pas (`HouseScene.vehicleYaw`) :

- cas 1 de la chaîne (le `yaw` du JSON, posé à la main) : **inchangé**, il fait déjà foi ;
- cas 2, 3 et 4 (cap du fabricant, axe de la pièce, rien) : `base + yawOffset`.

C'est ce qui distingue la correction d'un `yaw` écrit : une Tesla qui publie son cap continue de
tourner quand elle tourne vraiment, la correction ne fige rien. Quand rien n'est déduit (cas 4, la
voiture hors de toute pièce et sans cap), la correction oriente à elle seule — `base ?? 0`.

L'angle est ramené dans `[-180, 180[` **avant l'envoi** (côté UI) : le contrat borne le champ, et
saisir 200° donne -160° au lieu d'un refus 400.

Vérifié par un test qui compare deux scènes montées sur la même maison, l'une corrigée de 30° : quel
que soit le point (dehors, dans le salon) et le cap (absent, 90°), l'écart des deux corps vaut
exactement 30°.

Sources : `apps/web/src/three/HouseScene.ts`, `packages/shared/src/house/schema.ts`,
test `apps/web/src/three/three.test.ts`.


### Mise à jour 2026-09-14 (quater) — un coffret de batterie souffle ce qu'il fait

Une installation publie un `energy` par unité de stockage (capacité `storage` seule, cf.
`isEnergySite` dans `apps/web/src/lib/energy.ts`), dessiné en **coffret** d'un mètre qui monte du
sol. Le coffret ne disait rien : `isOn` d'un `energy` valait `productionW > 0`, toujours faux pour
une batterie, qui ne produit jamais rien — pilule éteinte et objet gris, qu'elle se remplisse ou se
vide.

Il **pulse** désormais la couleur de ce qu'il fait, et rien d'autre :

| état | couleur | d'où elle vient |
|---|---|---|
| charge (`batteryW ≥ +10 W`) | `SceneTheme.success` (vert) | contrat |
| décharge (`batteryW ≤ −10 W`) | `SceneTheme.info` (bleu) | contrat |
| ne répond plus (`available: false`) | `SceneTheme.error` (rouge) | contrat |
| repos | aucune : rien ne souffle | — |

Le souffle : teinte du coffret tirée à 30 % vers la couleur d'état (il reste gris, même au creux),
et émissif de 0,06 à 0,6 **en cosinus** sur 2,6 s — aucune cassure ni au creux ni à la crête. Bien
plus lent que l'onde d'un lecteur (5,75 s par anneau, mais c'est un rythme, pas un état).

Trois décisions à ne pas défaire :

- **le repos ne pulse pas et RELÂCHE la boucle** (`stopAnimation`, émissif remis à zéro). Le rendu
  est à la demande (`core/renderLoop.ts`) : un coffret qui ne fait rien ne doit pas tenir le CPU
  éveillé la nuit. Le marqueur n'a qu'un créneau d'animation, et une batterie n'a pas d'onde
  sonore — les deux ne se rencontrent jamais ;
- **le coffret a son PROPRE matériau** (`devMaterial(ctx).clone()`), là où les autres objets neutres
  partagent celui du jeu. Un matériau partagé qui pulse ferait souffler tous les capteurs de la
  maison. Corollaire : il ne suit plus `applyTheme`, c'est `onState` (rappelé par `setTheme`) qui
  recopie la couleur de base du thème courant ;
- **le seuil est celui des compteurs** : `IDLE_W` (10 W) a quitté `EnergyFlow.vue` pour
  `apps/web/src/lib/energy.ts`, avec les relevés qui le justifient. Le schéma de flux et la scène
  lisent la même zone morte — sinon un coffret pulserait pendant qu'un fil du schéma est au repos.

`isOn` d'une batterie devient « elle DÉPLACE de l'énergie » (`|batteryW| ≥ IDLE_W`) : sa pilule
s'allume en même temps que son coffret. Le site de l'installation, lui, garde `productionW > 0` —
c'est une passerelle, pas une batterie (il porte pourtant les mêmes `batteryW` / `batterySoc`,
agrégés).

**Pas d'orange.** L'utilisateur a demandé « un warn orange ou une erreur rouge si on a l'info » : le
contrat n'a AUCUN champ de défaut pour un `energy` (cf. `1_1_contrat-appareils.md`),
la seule panne qu'il porte est `available: false`. La passerelle Enphase publie bien un
`admin_state_str` par batterie (`/ivp/ensemble/inventory`), non mappé à ce jour : c'est par là qu'un
orange « en défaut mais joignable » passerait, une fois décidé quelles valeurs comptent comme une
alerte.

`SceneTheme` gagne `info` et `error`, lus comme les autres dans les variables Vuetify du thème
courant (`--v-theme-info`, `--v-theme-error`) — les six thèmes nommés les déclarent déjà.

Vérifié en test (les trois couleurs, les bornes du souffle, le retour au repos qui rend la main, et
la passerelle qui ne pulse pas) et dans la scène réelle, sur des batteries IQ en décharge :
coffrets bleus, lisibles en thème clair comme en sombre. Le vert et le rouge ne sont couverts que
par le test — la simulation n'a **pas** d'unité de stockage (seul le site simulé porte un
`batteryW`), donc l'effet ne se voit qu'avec une vraie installation.

Sources : `apps/web/src/three/markers/markers.ts`, `apps/web/src/three/core/theme.ts`,
`apps/web/src/lib/energy.ts`, test `apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-20 — la borne de recharge souffle aussi, en charge

Même souffle que le coffret de batterie (teinte 30 %, émissif en cosinus 0,06–0,6 sur 2,6 s, matériau
propre, boucle relâchée au repos). La borne n'a qu'un état à dire : VERT quand `status === 'charging'`.
Branchée au repos, débranchée, en erreur : rien. Pas de jauge — la borne n'a pas de SOC.

Le déclencheur est l'état, pas les watts. La capture Enphase du 20/09 n'a pas encore montré le champ
de puissance en cours de charge (`powerW` reste 0) : caler le souffle sur `IDLE_W` laisserait le
coffret muet pendant une vraie charge.

Vérifié en test (vert en charge, repos qui rend la main, mêmes bornes de souffle que la batterie).
Pas vu en réel : la borne Enphase du parc est `connected` / `SUSPENDED_EVSE` au moment de l'écriture.

Sources : `apps/web/src/three/markers/markers.ts`, test `apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-15 — la jauge de charge d'un coffret de batterie

« Au niveau des batteries dans la vue 3D on pourrait afficher une jauge sur l'objet comme ce qui a
été fait sur les objets des panneaux solaires. » Le coffret disait ce qu'il FAISAIT depuis la veille
(le souffle vert / bleu / rouge, plus haut), jamais ce qu'il CONTENAIT : pour connaître la charge, il
fallait ouvrir son panneau.

Le trait reprend la langue de la jauge d'un module (`PanelMarker`, plus haut) : une **piste** à 16 %
d'opacité sur toute la hauteur utile, un **trait plein** à 95 % qui monte depuis le bord bas, tous
deux en `MeshBasicMaterial` sans `depthWrite` — une mesure qu'on lit ne s'éteint pas avec la lumière
de la scène, et le trait ne creuse pas la tôle sur laquelle il est posé. 6 cm de large, 86 % de la
hauteur du coffret, à 6 cm du bord (`BATTERY_GAUGE`), sur un coffret dont les dimensions passent
enfin dans une constante (`BATTERY_BOX`, 0,6 × 0,15 × 1 m) : le trait et la tôle qu'il habille se
seraient séparés au premier ajustement.

Quatre décisions :

- **sur les DEUX grandes faces**, pas seulement celle du `yaw`. La vue d'ensemble regarde la maison
  depuis le sud-est, et selon son `yaw` un coffret peut tourner le dos à la caméra : une seule face
  lisible aurait pu lui être cachée. Les plans sont enfants du coffret, donc ils suivent
  son orientation sans calcul ; la face avant fait un demi-tour supplémentaire (`rotation.set(∓π/2,
  0, π|0)`) pour que son axe vertical reste le HAUT du coffret dans les deux cas ;
- **le trait est à l'ACCENT, pas à la couleur d'état.** Le souffle dit ce que le coffret fait, la
  hauteur dit ce qu'il contient : deux langues qui se lisent ensemble. Les teindre pareil aurait
  brouillé les deux messages ;
- **`batterySoc` absent = rien, pas même la piste.** Une piste vide se lirait comme une batterie à
  plat — même arbitrage que la position inconnue d'un ouvrant (`2_maison` / `4_1`) ;
- **un coffret muet garde son dernier niveau**, contrairement au module dont le trait disparaît dès
  `available: false`. Une charge ne s'évapore pas avec la liaison, alors que la production d'un
  onduleur décrit un instant ; et le souffle rouge dit déjà que le chiffre est gelé.

Vérifié en test (les deux faces regardent chacune vers le dehors et montent vers le haut du coffret —
contrôlé en appliquant les rotations à un vecteur, pas en recopiant les angles ; hauteur et ancrage
bas à 50 / 100 / 0 %, niveau conservé quand l'appareil se tait, jauge absente sans `batterySoc`, et
la passerelle du site qui n'en porte aucune) et dans la scène réelle : deux batteries
à faible charge, trait sur le bas de chaque coffret, lisible en thème clair comme en
sombre. Comme pour le souffle, la simulation n'a pas d'unité de stockage : cet affichage ne se voit
qu'avec une vraie installation.

Sources : `apps/web/src/three/markers/markers.ts` (`GenericMarker.buildCharge` / `setCharge`),
test `apps/web/src/three/three.test.ts` (« la jauge d'un coffret de batterie monte avec sa charge,
sur ses deux faces »).

### Mise à jour 2026-09-15 (bis) — les véhicules prennent leur vraie carrosserie

Jusqu'ici une voiture était **deux boîtes**. Elle est désormais dessinée par un vrai modèle glTF,
quand le catalogue en connaît un pour elle.

**Où vivent les fichiers.** `apps/web/public/models/<pluginId>/<modèle>.glb` — un sous-dossier par
plugin de marque. Vite les sert en développement, ils partent dans le build, et `@fastify/static`
les sert en production sans route nouvelle. Le dossier du plugin serveur avait été envisagé et
écarté : le serveur est bundlé en un seul `dist/main.js` par esbuild (un `.glb` posé à côté d'un
`.ts` ne partirait pas), `registerStatic` est enraciné sur le build web, et un plugin est une
**source de données**, pas un moteur de rendu.

**Le catalogue** (`apps/web/src/three/models/catalog.ts`) est de la donnée pure : identifiant →
URL, cotes, plugin, marque. L'identifiant `<pluginId>/<modèle>` est AUSSI le chemin du fichier.
Cette indirection permet de déplacer les fichiers un jour sans toucher ni la scène ni l'UI.
`modelsFor()` filtre sur le plugin du véhicule — on ne gare pas une Model S dans le garage d'une
R5 —, **à défaut sur la marque** (`meta.manufacturer`) : la simulation publie une Tesla et une
Renault sous `pluginId: 'mock'`, et sans ce repli elles n'auraient jamais de carrosserie.

**Le chargeur** (`apps/web/src/three/models/loadModel.ts`) suit le contrat de `TextureLoad` : un
type de fonction que la scène **injecte**, pour qu'un marqueur reste testable sans réseau —
`three.test.ts` tourne sous happy-dom, où rien ne se charge. Une géométrie par URL, mise en cache
**dès le départ** (pas à l'arrivée) pour que deux marqueurs créés dans la même image ne lancent pas
deux requêtes ; deux Tesla dans la scène = un seul téléchargement. Un échec ne se met pas en cache.
Le glTF est Y-up par spécification, la maison est Z-up : un `rotateX(π/2)` appliqué **une fois** à
la géométrie du cache. Les modèles sont exportés nez vers +Y dans Blender, ce qui retombe
exactement sur la convention de la scène (`yaw` 0 = face à +y) — aucun demi-tour.

**La substitution ne déplace rien.** Le `.glb` arrive après le marqueur. La silhouette générique
est donc dessinée tout de suite **aux cotes du modèle attendu** (`CarModel.size`), et la carrosserie
prend exactement sa place : même origine, même boîte englobante, donc même cadrage de caméra avant
et après. Un test le vérifie au `Box3` à 2 cm près. Si le chargement échoue, la silhouette reste :
on voit toujours la place occupée.

### Mise à jour 2026-09-15 (ter) — ce qu'une carrosserie reflète

Les premiers modèles rendaient de l'**argile**. Le maillage n'y était pour rien : la scène éclaire
avec `AmbientLight` + `HemisphereLight` + une `DirectionalLight`, et **`scene.environment` n'est
jamais défini**. Or la part métallique d'un matériau PBR ne rend QUE des reflets — sans carte
d'environnement, à `metalness` 0,3 un tiers de la réponse du matériau ne rendait rien.

`apps/web/src/three/core/environment.ts` construit donc une carte **propre aux véhicules**, posée
sur le seul `materials.vehicle` : `scene.environment` toucherait murs, toit et panneaux solaires,
ce qui est une autre décision. Trois choses la font marcher, et aucune n'est un détail :

- le **sol sombre**, qui donne son assise au bas de caisse ;
- l'**horizon clair resserré** (`|sin φ|^0.45`, pas une interpolation linéaire) : c'est cette ligne
  qui balaie le flanc quand on tourne autour, et c'est elle qui fait lire un galbe ;
- un **soleil en valeurs HDR** (`FloatType`, 14× le blanc), aligné sur la `DirectionalLight` de la
  scène pour que reflet et ombre portée viennent du même endroit. Une tache plafonnée à 255 ne fait
  pas un reflet, elle fait une tache grise — c'est le dépassement qui donne le point brillant.

Le `PMREMGenerator` pré-filtre la carte pour toutes les rugosités, une fois. Elle se refait à chaque
bascule de thème et **l'ancienne est libérée** : un véhicule dont la couleur est réglée a son
matériau propre, qui pointerait alors dans le vide — `VehicleMarker.setTheme` reprend donc la carte
fraîche, que `HouseScene.setTheme` a déjà renouvelée à ce stade. Sans renderer (mode sans tête,
tests) la carte vaut `null` et la carrosserie garde son rendu diffus.

Le matériau de véhicule est accordé en conséquence : `roughness` 0,28 et `metalness` 0,55, valeurs
qui n'ont de sens QU'AVEC cette carte.

### Mise à jour 2026-09-15 (quater) — la peinture : couleur et aspect

`VehicleMarker` ne choisit plus sa couleur par le nom du constructeur. La chaîne est écrite une
seule fois dans `apps/web/src/lib/vehicleTuning.ts` (`bodyColorOf`, `bodyFinishOf`), et vaut pour
la scène comme pour le panneau de réglage :

1. ce que l'utilisateur a **réglé** (`HouseDevice.bodyColor` / `bodyFinish`) — un covering, une
   repeinte ou un simple goût contredisent l'usine ;
2. ce que le plugin a **déduit** du relevé (`descriptor.meta.vehicle.color` / `.finish`) ;
3. rien — et la scène applique `materials.vehicle`, qui suit le thème.

Effacer le réglage manuel fait donc retomber sur ce qu'on sait du véhicule, **pas** sur le gris de
la scène : c'est tout l'intérêt de garder les deux.

L'**aspect** (`solid` / `metallic` / `matte`) décide du couple métallicité / rugosité via
`FINISH_MATERIAL`. Le marqueur se fabrique un matériau propre dès qu'il s'écarte de celui de la
scène — par la couleur OU par l'aspect : sans ça, une carrosserie mate sans couleur réglée resterait
vernie. Le défaut est `SCENE_FINISH = 'metallic'`, celui que porte déjà `materials.vehicle`, donc un
véhicule sans information ne change pas d'allure.

> **Préparer un modèle.** Décimer depuis le maillage DENSE, en une seule passe. Une seconde
> décimation par-dessus une première dégrade beaucoup plus que le compte de triangles ne le laisse
> croire : 16 000 triangles pris directement sur un STL de 2 M battent largement 28 000 obtenus en
> deux passes (pavillon déchiré, triangles d'un mètre carré sur des surfaces courbes). Décimation
> **symétrique** sur l'axe transversal, puis ombrage par angle (~40°) pour que les lignes de caisse
> restent des lignes. Export sans Draco — le décodeur pèse 336 Ko à héberger, plus que les modèles
> eux-mêmes — et **sans couleur** : la scène applique la sienne.

### Mise à jour 2026-09-15 (quinquies) — la scène se rapproche de la maquette : maison de poupée, nuit, cadrage dans la partie libre

L'utilisateur a fourni une maquette générée (vue 3D de nuit, façon maison de poupée, rail et panneau
posés SUR la scène qui prend tout l'écran, boutons de vue en bas à droite) : « pour la vue 3D est-ce
qu'on peut se rapprocher de la maquette ? on ne prend pas en compte les meubles… juste les pièces
(murs/sols) et éléments connectés qu'on possède », « concernant le jardin on ne prend pas en compte
les arbres ». Quatre choses côté scène ; la coquille est décrite dans `../4_ui/4_1_navigation-et-panneaux.md`.
(Levé le 2026-09-28 pour les arbres que l'utilisateur plante lui-même : `../2_maison/2_2_jardin.md`.)

**Maison de poupée.** Les murs EXTÉRIEURS d'un niveau sont construits en deux maillages coupés à
`LOW_INTERIOR_WALL` (`splitWallsAt`, `builders/buildHouse.ts`) : `walls:exterior` (le bas) et
`walls:exterior-upper` (`LevelNodes.wallsUpper`). `applyLevelFocus` masque le haut **du seul niveau
focalisé**, et ses vitrages avec (ils flotteraient au-dessus de la coupe) ; les niveaux dessous
gardent leurs façades entières, la vue d'ensemble aussi. Découpe géométrique et non plan de clipping :
l'extrusion coupée porte sa propre face supérieure, donc la coupe se lit comme un mur tranché (la
face du dessus prend la lumière) et non comme une coque creuse. Le volet d'une fenêtre reste dessiné
dans son embrasure, même s'il dépasse la coupe : c'est un appareil qu'on possède.

**Sol infini.** Un disque de `GROUND_RADIUS` (400 m, `CircleGeometry`) sous la parcelle, 2 cm sous le
terrain, matériau **non éclairé** (`MeshBasicMaterial`, `materials.ground`) de la couleur
`theme.background` : il se fond exactement dans le fond CSS de l'app, la parcelle ne flotte plus et
l'horizon n'a plus de bord quand la caméra descend. Pas de brouillard, inutile avec un fond plat.

**Nuit en thème sombre** (`HouseScene.applyLighting`) : hémisphère bleutée faible (`0x8fa3c7` /
`0x1a1f2a`, 0,45), ambiante 0,12, soleil devenu clair de lune froid (`0xc4d2f2`, 0,7). La palette
`SCENE_DARK` (`plugins/vuetify.ts`) descend d'un cran — sols `#262d3a`, pelouse `#1f3326` — et les
murs MONTENT (`#6c7686`) pour que la coupe se lise. Ce qui éclaire la maison, ce sont ses lampes :
`LightMarker` gagne un **halo** (`Sprite` additif, texture radiale procédurale partagée — aucun
`<canvas>`, elle se construit aussi en Node), diamètre `GLOW_SCALE` 1,1 m, opacité `GLOW_OPACITY`
0,9 la nuit et 0,3 le jour, teinté de la couleur de la lampe. C'est le « bloom » de la maquette sans
post-traitement (une passe de flou sur un canvas transparent coûte sur tablette et se marie mal avec
les pilules DOM). Le sol de la pièce sélectionnée devient en plus légèrement **émissif** la nuit
(`primary × 0,15`) : la seule teinte ne se voyait plus sous un ciel sombre. Le thème clair garde son
jour ; les couleurs de scène restent communes à tous les thèmes (décision du 2026-09-12).

**Cadrage dans la partie libre** (`HouseScene.setViewInset(rightPx)`). Le panneau flotte SUR le
canvas ; sans rien, la maison se centrait derrière lui. `applyProjection` pose `camera.aspect =
libre / hauteur` et `camera.setViewOffset(libre, h, 0, 0, largeur, h)` : la vue « logique » — celle
que `fitBox` cadre — occupe les `libre` pixels de gauche, et le décalage ÉLARGIT le tronc vers la
droite au lieu de le recentrer. Tout ce qui se calcule sur le canvas entier (NDC du lancer de rayon,
projection des pilules par le `CSS2DRenderer`, `grabs`) reste juste sans changement, puisque la
matrice de projection porte le décalage. `HomeView` lit l'encart dans les jetons (`--aside-w` +
2 × `--panel-gap`) et le retire quand le panneau devient tiroir.

**Boutons de vue** : `orbitBy(delta)` (rotation autour de la cible, plongée conservée) et
`dollyBy(facteur)` (distance bornée par `controls.min/maxDistance`), tous deux tweenés par
`moveCamera`, extrait de `flyTo`.

Trois tests headless (`three.test.ts`) : la coupe des prismes (le bas garde son pied, le haut son
sommet), le masquage du haut et des vitrages du seul niveau focalisé puis leur retour, et l'aspect /
`view.enabled` de la caméra selon l'encart. Vérifié dans la preview mock : RDC de nuit avec le
plafonnier du salon allumé (flaque chaude + halo), thème clair, vue Tout, tablette 768 px (tiroir,
boutons en bas à droite).

Sources : `apps/web/src/three/builders/{buildHouse,materials}.ts`, `apps/web/src/three/HouseScene.ts`,
`apps/web/src/three/markers/markers.ts`, `apps/web/src/plugins/vuetify.ts`, `apps/web/src/views/HomeView.vue`.

### Mise à jour 2026-09-15 (sexies) — retour de l'utilisateur : pas de maison de poupée, des matières, des lampes qui restent chez elles

Trois corrections sur la mise à jour précédente, après captures de la maison réelle.

**« Maison de poupée, non, ce n'est pas du tout ce qu'on a sur le design. »** La coupe des murs
extérieurs à 1,05 m (`splitWallsAt`, `wallsUpper`) est **retirée** le jour même, et avec elle
l'abaissement des cloisons à `LOW_INTERIOR_WALL` qui datait des débuts (« Niveaux, cloisons,
sélection de pièce » plus haut, désormais caduc). Sur la maquette, tous les murs vont du sol au
plafond, cloisons comprises, et l'on regarde dans les pièces par le dessus, sans plafond : c'est
exactement ce que donne un niveau focalisé (les niveaux au-dessus et le toit masqués). Les vitrages
ne se cachent plus. `buildLevel` revient donc à un maillage par nature de mur, pleine hauteur.

**Matières par défaut** (`three/textures/procedural.ts`). Les surfaces n'avaient qu'une couleur
plate ; elles portent maintenant une **texture procédurale** — calculée au démarrage, aucune image
à héberger (usage LAN, pas de CDN, cf. la police embarquée) ni à verser au dépôt. Chaque texture est
une carte de **luminance** (gris autour de 1) que le matériau multiplie par sa couleur de thème : la
teinte reste celle des palettes, la texture n'apporte que le grain, donc clair et sombre en profitent
sans rien d'autre. La même carte sert de `bumpMap` (relief en lumière rasante). Les UV des builders
étant en mètres (caps d'`ExtrudeGeometry`, `ShapeGeometry`), `repeat = 1 / taille du motif` pose un
motif à l'échelle du monde, sans couture (bruit de valeur périodique, hachage déterministe).

| rôle (`SurfaceRole`) | motif | posé sur (`SURFACE_OF`, `builders/materials.ts`) |
|---|---|---|
| `plaster` | enduit fin | murs extérieurs et cloisons |
| `wood` | lames 12 cm × 1,2 m décalées, veinées | `floorStyle: wood` |
| `tile` | carreaux 60 cm, joint 6 mm | `floorStyle: tile` |
| `carpet` | grain serré | `floorStyle: carpet` |
| `concrete` | nuages + piqûres | sol par défaut, `concrete`, allée, zone `other` |
| `grass` | touffe et plaque | terrain, pelouse |
| `water` | crêtes claires (caustiques) | piscine (rugosité 0,15, un peu de métal) |
| `pavers` | dalles 40 cm | chemin, terrasse |
| `soil` | terre grumeleuse | massif |
| `roof` | membrane / gravillon | toiture |

`SURFACE_OF` est la **seule table à changer** pour remplacer une matière ; et le catalogue rôle →
texture est la couture prévue pour laisser plus tard l'utilisateur fournir ses propres images (« des
textures par défaut que l'utilisateur pourra modifier par la suite »). Les textures vivent dans
`MaterialSet.textures` et se libèrent avec les matériaux. Coût : dix cartes de 256 à 512 px, ~3 Mo,
quelques millisecondes ; construites en Node aussi (tests).

**Les lampes traversaient les dalles.** Une `PointLight` ne connaît pas la géométrie : le plafonnier
d'une pièce de l'étage éclairait la pièce en dessous, que rien ne couvre, et celles du rez-de-chaussée
éclairaient l'étage par en dessous. Des ombres par lumière ponctuelle (six cartes par lampe) sont
hors de prix sur tablette. Premier essai le même jour — éteindre la lumière des lampes dont le
niveau n'est pas focalisé (`setLevelActive`) — retiré aussitôt : il ne traitait que le sens montant.

> **Remplacé le 2026-09-25** : le rendu en passes n'existe plus. Une seule passe, et la lampe est
> cantonnée à son niveau par le shader — voir « Mise à jour 2026-09-25 — une seule passe » en fin de page.

Retenu : **le rendu en passes** (`HouseScene.renderPasses`). Three ne collecte que les lumières
VISIBLES au moment du `render` ; on dessine donc d'abord tout (site, toit, niveaux) SANS les
marqueurs de niveau — donc sans leurs lampes — sous le seul éclairage global, passe qui refait la
carte d'ombre du soleil ; puis chaque niveau visible SEUL, avec ses marqueurs et donc ses lampes,
redessiné par-dessus sans effacer (même tampon de profondeur). Une lampe n'atteint ainsi que les
surfaces de son niveau, dans toutes les vues : en vue d'ensemble les lampes ne tachent plus le toit,
et à l'étage celles du rez-de-chaussée éclairent le rez-de-chaussée qu'on aperçoit par un vide. Coût :
murs et sols dessinés deux fois, marqueurs une seule (un halo additif dessiné deux fois doublerait ;
c'est pourquoi les marqueurs sont absents de la première passe). Un niveau fantôme (`ghost`) n'a pas
de passe. Reste connu : dans un même niveau, une lampe éclaire encore à travers une cloison.

Tests (`three.test.ts`) : cloisons pleine hauteur, catalogue de textures (taille, répétition, joint
plus sombre que le carreau, câblage sur les matériaux). Vérifié
dans la preview mock : RDC de nuit, plafonnier du salon allumé, murs entiers, carrelage et pelouse
texturés ; onglet Étage sans flaque venue d'en bas, vue Tout sans tache sur le toit.

Sources : `apps/web/src/three/textures/procedural.ts`, `apps/web/src/three/builders/{materials,buildHouse}.ts`,
`apps/web/src/three/markers/{DeviceMarker,markers}.ts`, `apps/web/src/three/HouseScene.ts`.

### Mise à jour 2026-09-15 (septies) — un STYLE de rendu, une HEURE, et une vraie chaîne d'image

Demande de l'utilisateur, après la première passe : « j'aimerais qu'on puisse choisir un style de
rendu, par exemple réaliste comme la maquette, et d'autres styles (nature, cyberpunk, candy…) », «
il faudrait construire la chose pour qu'on puisse ajouter et switcher de style facilement », et « le
mode light/dark de l'app ne doit pas forcément impliquer que la maison est sombre/claire — pour la
maison c'est en fonction de la position gps, du soleil, de la météo ». Arbitrages posés avant
d'écrire : **tout en procédural** (« si ça n'est toujours pas satisfaisant alors on ajoutera des
assets ») et **post-traitement avec un réglage de qualité**.

#### Trois axes séparés, et c'est le cœur de la refonte

| Axe | Où | Ce qu'il décide |
|---|---|---|
| **Style de rendu** | `three/styles/` | le goût : couleurs de matière, quelle matière sur quelle surface, ciel, courbe d'image |
| **Ambiance** | `three/core/ambience.ts` | l'heure qu'il fait AU-DESSUS DE LA MAISON : position du soleil, couverture du ciel |
| **Thème de l'app** | `three/core/theme.ts` (`UiTheme`) | les repères POSÉS sur la maison : accent, onde `sceneMedia`, jauges |

Aucun n'impose les deux autres : une tablette en thème sombre devant une maison en plein soleil est
un état normal. `SceneTheme` est leur fusion (`resolveSceneTheme`), et aucun consommateur — matériaux,
marqueurs, scène — n'a à savoir d'où vient quelle couleur. Le booléen `isDark` disparaît au profit de
`night` (0 = plein jour, 1 = nuit noire) : ce qui pilotait l'apparence de la scène n'était pas le mode
de l'application, c'était l'heure.

**Les palettes `SCENE_LIGHT` / `SCENE_DARK` de `plugins/vuetify.ts` sont retirées** : les couleurs de
matière appartiennent désormais au style. Seul `sceneMedia` reste lu dans les variables CSS.

#### Le soleil se calcule (`three/core/sun.ts`)

Algorithme « low-precision » de l'Astronomical Almanac (celui du calculateur NOAA) : quelques
dixièmes de degré, aucun réseau, aucune API. La maison est géoréférencée (`origin.lat` / `lon`), et
l'horloge fait le reste. Sans géoréférencement, `approximateSunPosition` prend l'heure locale et une
journée type (lever 7 h, coucher 21 h) : faux de plusieurs degrés, mais la scène n'a besoin de savoir
qu'une chose, s'il fait jour et d'où vient la lumière.

`AmbienceMode` = `auto` (le vrai soleil) | `day` | `dusk` | `night` (heures figées). `dayFactor`
mélange continûment entre −6° (fin du crépuscule civil) et +8° : un seuil binaire ferait claquer la
scène à la minute près. `sunDirection` RELÈVE la source sous l'horizon à 18° en gardant son azimut —
une `DirectionalLight` enterrée n'éclaire plus rien. En mode `night` la lune est posée au **sud-ouest**,
d'où la scène se regarde par défaut : une source dans le dos de la caméra ne montre que des faces à
l'ombre. `cloudiness` existe, reste à 0, et attend un plugin météo — c'est la seule entrée qui
demandera du réseau.

L'heure est relue **toutes les 15 minutes** (`useHouseScene`) : le soleil se déplace de moins de 4°,
et la scène ne rend qu'à la demande.

#### Le contrat d'un style (`three/styles/types.ts`)

Un style est une **fonction de l'ambiance** : `look(ambience) → StyleLook`, qui porte la `palette`
(couleurs de matière), les `surfaces` (matière procédurale + rugosité / métallicité / part émissive
par surface), le `glass`, le `sky`, le `lighting`, le `post` et le `glow` des lampes. C'est ce qui
permet au même style de rendre un midi d'été et la nuit de la maquette sans deux styles distincts.

**Ajouter un style = un fichier dans `three/styles/` + une ligne dans `index.ts` + deux clés i18n.**
Ni la scène, ni les builders, ni l'UI ne connaissent la liste. Onze livrés : `realistic` (la
maquette, et le défaut), `nature`, `indigo`, `maquette`, `cyberpunk`, `candy`, `haunted` (« Maison
hantée », 2026-09-23), `disco`, `halloween`, `noel` et `tatooine` (2026-09-29).

Point de méthode qui explique presque tout le style réaliste : **sa palette est une palette
d'ALBÉDOS**, la couleur de la matière en plein jour, et elle ne change pas avec l'heure. Avant le
tone mapping, la scène peignait ses murs en gris sombre pour « faire nuit » — ce qui donnait des murs
gris sombre en plein soleil dès qu'une lampe s'allumait. Maintenant c'est la LUMIÈRE qui fait la nuit,
et un mur blanc reste un mur blanc, simplement très peu éclairé.

`cyberpunk` est le style qui ÉPROUVE la couture : il émet (cloisons et sols rendent de la lumière,
`SurfaceLook.emissive`), il change de palette avec l'heure (`mixPalette`) et il pousse le bloom
jusqu'à baver. Si ces trois-là passent, un style peut tout dire.

`haunted` (2026-09-23) montre qu'un style peut **refuser le jour** : il écrase `dayFactor` (× 0,45),
si bien qu'un midi d'été reste un ciel bas et gris. Vitres émissives vert-jaune même sans lampe,
piscine croupie (`emissive` 0,35, `flow` 0,3), relief poussé (× 1,4 à 1,8), vignette forte.
Entièrement procédural (pas de pack photo). Leçon de réglage : une palette SOMBRE pour « faire
lugubre » rend la maison illisible la nuit — comme pour le réaliste, la lisibilité vient de la lune
(≈ 1,2) et du remplissage hémisphérique (≈ 1,2), la teinte fait l'ambiance. Premier jet volontairement
brut : fenêtres qui vacillent (il faudrait une animation) et rendu de jour non relus.

#### Le ciel éclaire tout (`three/core/sky.ts`, remplace `core/environment.ts`)

La carte d'environnement était réservée aux véhicules, « `scene.environment` toucherait murs, toit et
panneaux solaires, ce qui est une autre décision » (2026-09-15 ter). **Cette décision est prise** :
le ciel du style, pré-filtré au PMREM, est posé sur `scene.environment` et éclaire toute la scène. Un
matériau PBR ne rend ses reflets — et la totalité de sa part métallique — qu'à partir d'une carte
d'environnement : sans elle, murs, verre, eau et carrosseries rendent de l'argile. Conséquence
bienvenue : `VehicleMarker` n'a plus à recopier la carte sur son matériau propre, three l'applique à
tout matériau standard sans `envMap` à lui.

Le ciel n'est jamais AFFICHÉ. Le fond du canvas prend sa couleur d'horizon (`backdropColor`) et le
disque de sol infini sa couleur de sol (`groundColor`), les deux en linéaire : ils passent par la même
courbe d'image et se raccordent donc sans couture. Le sol ne suit plus `theme.background` — après tone
mapping, une couleur recopiée du CSS ne retombe plus sur la même valeur.

#### La chaîne d'image (`three/core/post.ts`)

Trois choses, dans cet ordre, plus une vignette :

1. **Tone mapping** (ACES / AgX / Neutral selon le style). La scène est calculée en valeurs linéaires
   non bornées ; sans courbe, tout ce qui dépasse devient un aplat blanc et la nuit un aplat noir.
   C'est le réglage qui décide si la maison est lisible, pas la couleur des murs.
2. **Occlusion ambiante** (`GTAOPass`, qualité haute seulement). Elle assombrit les angles rentrants,
   le pied des murs, le dessous des objets : c'est elle qui POSE les volumes les uns sur les autres.
   Rayon 60 cm, l'échelle des angles d'une pièce.
3. **Bloom** (`UnrealBloomPass`). Le halo des lampes de la maquette. Le sprite additif du `LightMarker`
   reste : l'un donne le volume de la source, l'autre la diffusion dans l'image.

Le rendu en passes par niveau (2026-09-15 sexies) est conservé : il devient la **première passe** de
la chaîne (`ScenePass`, à la place d'un `RenderPass`), et dessine dans la cible du composer.

`RenderQuality` = `auto` | `high` | `medium` | `low`. `auto` mesure la machine
(`hardwareConcurrency`, `deviceMemory`, `pointer: coarse`) puis **descend d'un cran, une seule fois**,
si les vingt premières images coûtent plus de 40 ms en moyenne. `low` démonte la chaîne : le tone
mapping revient au renderer et l'image part droit à l'écran. Le rapport de pixels suit (2 / 1,5 /
1,25) — c'est le levier le moins visible et le plus rentable.

#### Les matières passent au PBR (`three/textures/procedural.ts`)

Chaque rôle produit maintenant **trois** cartes au lieu d'une :

- `map`, la couleur (luminance × teinte), que le matériau multiplie par sa couleur de style ;
- `normalMap`, dérivée du relief par différences centrées — c'est elle qui fait accrocher la lumière
  rasante, là où l'ancien `bumpMap` ne donnait qu'un tremblement approximatif ;
- `ormMap`, une carte packée (R inutilisée, **G rugosité, B métallicité**) lue par `roughnessMap` ET
  `metalnessMap` du MÊME objet Texture : three lit le canal qu'il lui faut.

Règle tenue par tous les motifs : **la luminance reste sous 1**. Une matière qui sature écrête ses
variations et rend un aplat de la couleur du style — exactement ce que la texture est censée éviter
(constaté sur le carrelage, dont un carreau sur deux était blanc pur). Quatre matières s'ajoutent au
catalogue pour les nouveaux styles : `metal`, `grid`, `gloss`, `stone`.

Le catalogue est **cuit à la demande et gardé** (`BAKED`, même politique que le cache des
carrosseries) : une matière est déterministe et immuable, la recuire donnerait les mêmes octets. La
cuisson se payait à chaque construction de scène — la suite de tests 3D est passée de 51 s à 11 s.
`disposeMaterials` ne libère donc plus les textures.

#### Changer de style ne touche aucune géométrie

`HouseScene.setAppearance({ ui?, style?, ambience? })` est le point d'entrée unique. Changer de
STYLE repasse des cartes aux matériaux partagés (et recompile leurs shaders) ; changer d'HEURE ne
fait que muter des couleurs et des intensités — `applyLook` compare les cartes avant de demander une
recompilation. Les sols portant un CLONE du matériau de leur nature (surbrillance par pièce),
`syncFloorClones` leur repasse les cartes du matériau d'origine, sans quoi un clone garderait la
matière du style précédent.

#### Une couche pour les décors additifs (`three/core/layers.ts`)

Le halo d'une lampe est un sprite additif : une image qui ajoute de la lumière et n'occupe aucun
volume. L'occlusion ambiante, elle, redessine la scène en profondeur et en normales — et voyait ce
sprite comme un panneau plein face à la caméra. Résultat observé : **un carré noir sous chaque lampe
allumée**. Le halo vit donc sur `DECOR_LAYER`, que la caméra voit pour le rendu final et que
`ArchitectureGTAOPass` éteint le temps de son relevé. Le lancer de rayon n'est pas concerné : un halo
n'a jamais été cliquable.

#### Vérifié

Preview mock (`VITE_INPROCESS_MOCK=1`), maison de démo : nuit (maison lisible sur ciel noir, flaques
chaudes des plafonniers, occlusion au pied des murs, vignette), jour automatique suivant le vrai
soleil de Dijon, style cyberpunk appliqué en direct depuis les Réglages (ciel violet, vitrages
lumineux, carrosserie néon), qualités haute / moyenne / basse. Six tests headless ajoutés
(`three/three.test.ts`) : position du soleil à Dijon au solstice (midi, minuit, matin), continuité de
`dayFactor`, ambiance jamais `NaN`, source relevée sous l'horizon, finitude des quatre styles à trois
heures, et changement de style qui repasse d'autres matières aux mêmes matériaux.

**Un outil de débogage assumé** : en développement seulement, `useHouseScene` pose le contrôleur sur
`window.kasbahScene`. Une scène 3D ne se débogue qu'en la regardant, et relever une intensité de
lumière ou une exposition depuis la console vaut mieux qu'instrumenter le code à chaque fois.

Sources : `apps/web/src/three/styles/*.ts`, `apps/web/src/three/core/{sun,ambience,sky,post,theme,layers}.ts`,
`apps/web/src/three/builders/materials.ts`, `apps/web/src/three/textures/procedural.ts`,
`apps/web/src/three/HouseScene.ts`, `apps/web/src/composables/useHouseScene.ts`.

### Mise à jour 2026-09-15 (octies) — un volet fermé barre la lumière

Constat de l'utilisateur, capture à l'appui : « ici le volet est fermé et dans la pièce on voit tout
de même la lumière traverser la vitre ». La tache de soleil se posait sur le sol comme si l'ouvrant
n'existait pas.

**Le maillage n'y était pour rien** : la lame d'un volet porte `castShadow` depuis toujours. C'est le
rendu en passes (mise à jour du 2026-09-15 sexies) qui l'écartait : la passe globale — la seule qui
refait la carte d'ombre — masquait TOUS les marqueurs de niveau (`n.markers.visible = false`). Or
three ne relève comme bloqueur que ce qui est visible **au moment du rendu** : depuis cette date,
aucun appareil ne portait d'ombre, ni un volet, ni une voiture, ni un coffret.

Le masquage servait deux choses, et deux seulement : empêcher les **lampes** d'un niveau d'éclairer
les autres, et éviter qu'un **décor translucide** (halo, onde, jauge) soit mélangé deux fois. Ces
deux exclusions se disent maintenant par des **couches** (`three/core/layers.ts`) et non par la
visibilité — three teste la couche d'un objet contre celle de la caméra, y compris pour les lumières
(`projectObject`) et pour le relevé d'ombre (`WebGLShadowMap.renderObject`) :

- `DECOR_LAYER` (déjà là pour l'occlusion ambiante) reçoit désormais **tous** les décors :
  halo d'une lampe, ondes d'un lecteur, jauges d'un coffret de batterie et d'un module, pochette
  posée sur un écran, guide du mode « déplacer ». Une méthode `DeviceMarker.asDecor(objet)` les
  marque, plutôt qu'un `layers.set` dispersé dans six constructeurs.
- `LAMP_LAYER` (nouvelle) reçoit les `PointLight` des lampes.

`renderPasses` s'écrit alors sans toucher à aucune visibilité de marqueur :

1. **la matière, tout entière**, caméra privée des deux couches → les appareils sont là, ils portent
   leur ombre, mais ni leurs lampes ni leurs décors ne participent ; c'est cette passe qui refait la
   carte d'ombre ;
2. **un passage par groupe qui porte des lampes** : chaque niveau visible, **puis le jardin** — le
   site a maintenant sa passe, comme un niveau. Les maillages d'appareil sont donc dessinés deux fois
   (opaques, même profondeur : le second passage réécrit le premier, exactement comme les murs), les
   décors une seule fois.

**Compromis assumé** : une lampe de jardin éclaire le jardin, et non plus l'intérieur de la maison à
travers ses murs. C'est la règle déjà posée pour les niveaux, appliquée au site ; la contrepartie est
qu'un spot extérieur n'illumine plus la façade.

Vérifié dans la preview mock, en plein jour, à cadrage identique : volets fermés → aucune tache au
sol et le panneau du volet dans l'embrasure ; volets ouverts → la baie s'éclaire et la lumière se
pose sur le carrelage. Un test headless épingle la règle plutôt que l'image (`three.test.ts`, « un
appareil porte son ombre ; ses lampes et ses décors sortent de la passe globale ») : les maillages
d'un ouvrant sont sur la couche commune et `castShadow`, la `PointLight` d'une lampe sur
`LAMP_LAYER`, son halo sur `DECOR_LAYER`.

Sources : `apps/web/src/three/core/layers.ts`, `apps/web/src/three/HouseScene.ts` (`renderPasses`),
`apps/web/src/three/markers/{DeviceMarker,markers}.ts`.

### Mise à jour 2026-09-15 (nonies) — une lampe de jardin éclaire la façade, et s'arrête au mur

**Lève le compromis** posé une heure plus tôt (« octies » ci-dessus : le jardin avait sa passe, donc
ses lampes n'éclairaient plus que le jardin). Arbitrage de l'utilisateur : « les lampes extérieures
doivent quand même éclairer la façade mais pas l'intérieur ».

Ces deux exigences ne se règlent pas par une couche. Une couche dit *qui voit quoi* dans une passe ;
elle ne sait pas distinguer la face EXTÉRIEURE d'un mur de sa face intérieure — c'est le même
maillage. Et le rendu en passes ne s'additionne pas : chaque passe REDESSINE ses surfaces, donc un
mur ne peut pas recevoir sa lumière de jardin dans une passe et sa lumière d'intérieur dans une
autre. La seule chose qui arrête vraiment la lumière au mur, c'est une **ombre portée**.

- Une lampe de **jardin** (`MarkerContext.outdoor`) reste donc sur la couche commune — elle participe
  à **toutes** les passes, donc la façade garde son halo quelle que soit celle qui la dessine en
  dernier — et porte une ombre : `PointLightShadow`, six faces de 512 px, `far` calé sur la portée de
  la lampe. Elle n'est allumée que tant que la lampe l'est (`castShadow = k > 0`) : une lampe éteinte
  ne vaut pas six rendus de profondeur. Le vitrage, lui, ne porte pas d'ombre — une lampe de terrasse
  entre par la fenêtre, et c'est juste.
- Une lampe d'**intérieur** garde `LAMP_LAYER` et pas d'ombre : elles sont trop nombreuses pour ça,
  et le rendu en passes leur suffit.
- Le jardin n'a plus de passe à lui. Ses **décors** (halo d'une borne) passent sur
  `SITE_DECOR_LAYER`, dessinée dans la passe globale — la seule où le terrain est dessiné. Deux
  couches de décor pour une même idée : c'est le MOMENT du dessin qui diffère, pas la nature de l'objet.
- Pendant les passes de niveau, le **sol du jardin** est retiré (`siteSurfaces`) : sans quoi une lampe
  d'intérieur viendrait le tacher à travers la façade. Les appareils du jardin, eux, restent visibles —
  ce sont leurs lampes qu'on veut, et ils sont opaques.

Vérifié dans la preview mock, de nuit, en déplaçant une lampe de la maison au jardin (`updateDevices`
depuis la console, `window.kasbahScene`) : devant un pan de mur plein, la flaque se pose sur la façade
et sur la pelouse, et la pièce derrière reste éclairée par ses seules lampes ; devant la baie, la
lumière passe par le vitrage, comme elle doit. Un test headless épingle la règle : la lumière d'une
lampe de jardin est sur la couche commune, elle ne porte son ombre qu'allumée, et son halo est sur
`SITE_DECOR_LAYER`.

Reste connu : la part d'ombre est calculée à chaque image rendue, pour chaque lampe extérieure
allumée. Une poignée de bornes est sans conséquence ; un parc de vingt lampadaires se mesurerait —
le réglage « Qualité » est le premier levier si cela se présente.

Sources : `apps/web/src/three/core/layers.ts`, `apps/web/src/three/markers/markers.ts` (`LightMarker`),
`apps/web/src/three/HouseScene.ts` (`renderPasses`, `buildMarkers`).

### Mise à jour 2026-09-15 (decies) — un voile de mesure, et trois choses qui coûtaient pour rien

Constat de l'utilisateur sur la VRAIE maison : « ça rame un peu
lorsqu'on orbite ou qu'on sélectionne une pièce », puis « on plafonne à 22 fps, à mon avis on a un pb
quelque part ». Demande : un interrupteur de débogage qui affiche les courbes de three, puis
l'enquête.

#### Le voile de débogage (Réglages → Rendu 3D → Débogage)

`components/home/SceneDebug.vue`, deux étages :

- les **courbes de `stats.js`** (FPS, ms, mémoire), celles de three, branchées en **sonde** autour de
  chaque image rendue (`HouseScene.setProbe`) et non sur une boucle à part : le rendu est à la
  demande, une boucle indépendante compterait des images qui n'existent pas. Les trois panneaux sont
  montrés ensemble plutôt qu'à tour de rôle au clic ;
- un **relevé chiffré** (`HouseScene.debugStats()`) que la scène tient déjà pendant qu'elle dessine,
  relu deux fois par seconde : images/s, coût CPU d'une image, appels de dessin et triangles d'une
  IMAGE (toutes passes comprises — `renderer.info.autoReset = false` et remise à zéro par nous),
  nombre de passes, relevé d'ombre refait ou non, lampes à ombre cubique, marqueurs, qualité, rapport
  de pixels, mémoire.

Le panneau est **opaque et sans filtre de fond** : un instrument ne doit rien coûter à ce qu'il
mesure. Et « img/s » à 0 au repos est normal — c'est le rendu à la demande, pas une panne.

La sonde se pose au **premier relevé où la scène existe**, et non au montage du composant : Vue monte
les enfants AVANT d'exécuter le `onMounted` du parent, et c'est là que `useHouseScene` construit la
scène. Posée au montage, elle l'était sur `null` — les courbes restaient figées pendant que les
chiffres, eux, se mettaient à jour (ils relisent la scène à chaque relevé), ce qui donnait un voile à
moitié vivant plutôt qu'une erreur.

#### 1. La carte d'ombre se refaisait à CHAQUE image

`renderPasses` posait `shadowMap.autoUpdate = true` à chaque passe globale. Or **une ombre ne dépend
pas de la caméra** : tourner autour de la maison redessinait tout le bâti depuis le soleil, plus le
flou VSM d'une carte de 2048², soixante fois par seconde, pour un résultat rigoureusement identique.

Retenu : `invalidateShadows(ms)` ouvre une fenêtre de 700 ms (`SHADOW_SETTLE_MS`, la course d'un volet
en dure 400) et `renderPasses` ne relève les ombres que pendant celle-ci. Elle s'ouvre au chargement,
à un changement d'appareils, d'apparence (le soleil bouge), d'options, pendant un glissement — et sur
un changement d'état **de volet, de véhicule ou de lampe uniquement** : un capteur qui publie sa
mesure toutes les secondes ne doit pas relancer un relevé.
*(Depuis la section 2026-09-25 (terdecies), la fenêtre est doublée d'un compte d'images dessinées :
seule, elle expirait pendant le voile de chargement, sans une image.)*

#### 2. Chaque niveau payait sa passe, même sans rien à montrer

Le rendu en passes redessine un niveau entier pour que ses lampes l'éclairent. Mais un niveau dont
**aucune lampe n'est allumée** rend exactement ce que la passe globale a déjà rendu. Sur la maison
réelle, en vue « Tout », c'était trois passes de trop.

`levelsNeedingPass` (recalculé à chaque changement d'état, d'appareil, d'apparence ou de mode
« déplacer », jamais pendant le rendu) ne retient qu'un niveau portant **une lampe allumée ou un décor
visible** — le décor compte, parce que la passe globale ne le dessine pas (onde d'un lecteur, jauge
d'un coffret, guide de déplacement).

Mesuré sur la maison réelle chargée dans la preview, lampes éteintes : **4 passes → 1**, et
**477 → 265 appels de dessin** par image. Avec deux pièces allumées, deux passes reviennent — c'est
le prix de ce qu'on regarde.

#### 3. Des dizaines de pilules qui floutaient le fond, à chaque image

C'est le plafond que l'utilisateur voyait. `.marker-pill` portait `backdrop-filter: blur(8px)` — or
une pilule est posée **sur le canvas**, et un filtre de fond se recalcule dès que son fond change.
Sur la maison réelle, une pilule = un floutage par image, payés par le
compositeur du navigateur : invisibles pour `renderer.info`, invisibles pour le coût CPU mesuré en
JavaScript, et parfaitement capables de plafonner une page à une vingtaine d'images par seconde sur
un GPU intégré. Le fond de la pilule passe opaque (92 %) : à cette taille la différence ne se voit
pas, le prix si.

**À retenir comme règle** : sur la vue Maison, aucun `backdrop-filter` au-dessus du canvas ne doit se
multiplier. Il en reste trois, et ils sont uniques : le panneau latéral, les deux grappes de boutons
de vue, l'en-tête de panneau. Si la fréquence reste basse, c'est le panneau latéral — grand, et
posé sur une zone que la scène redessine — qu'il faudra regarder ensuite.

#### 4. Les matrices monde recalculées une fois par PASSE

Three met à jour les matrices monde au début de chaque `render()`. Une image en compte plusieurs (la
passe globale, une par niveau éclairé, celles de l'occlusion ambiante, celle du `CSS2DRenderer`) et
rien ne bouge entre elles : c'était le même arbre reparcouru quatre fois pour le même résultat.
`scene.matrixWorldAutoUpdate = false`, et `render()` le demande UNE fois avant la première passe.
Mesuré : 0,2 ms par parcours sur la maison réelle — trois parcours économisés, donc
~0,6 ms. Petit, mais gratuit et sans risque.

#### Ce que « rendu » mesure, et le seuil qui explique tout

Le relevé nomme « rendu » (et non « cpu ») le temps passé DANS `render()` : ce n'est pas du CPU pur,
car lorsque la file de commandes du GPU est pleine, le pilote bloque à l'envoi et cette attente s'y
retrouve. Relevé sur la vraie maison pendant une orbite : **28 img/s, rendu 9 ms, 2 passes, ombres ✗,
279 appels, 84 k triangles, rapport de pixels ×1**.

Le chiffre à retenir n'est pas le 9 ms, c'est le **seuil de 16,7 ms** : à 60 Hz, une image qui le
dépasse — ne serait-ce que d'une milliseconde — attend la synchronisation suivante et tombe à 30.
Entre 28 et 30 images par seconde, il ne manque donc souvent que deux ou trois millisecondes, pas la
moitié du budget. C'est ce qui rend la suite de l'enquête utile : il n'y a pas de gouffre à combler.

#### 5. Le post-traitement mis hors de cause, et ce qui restait

Relevé décisif de l'utilisateur : **« rien ne change quel que soit le mode, entre 25-28 img/s et
10-11 ms de rendu »**. « Basse » démonte pourtant TOUTE la chaîne — ni occlusion, ni bloom, ni
vignette, et un rapport de pixels plus bas. Si cela ne change rien, le coût n'est ni dans les effets,
ni dans le nombre de pixels : il est dans ce que la scène a de commun à tous les modes.

Mesuré alors, image par image et avec `gl.finish()`, sur la maison réelle chargée dans la preview :

| | ms / image |
|---|---|
| tout | 7,7 |
| sans les maillages des marqueurs | 4,0 |
| sans les pilules DOM | 5,3 |
| sans les deux | 3,2 |

**Les marqueurs pèsent près des deux tiers de l'image** : 3,7 ms pour leurs maillages (57 appels de
dessin de plus par passe sur 127) et 2,4 ms pour les pilules. Leurs maillages sont minuscules — ce
n'est pas du remplissage de pixels, c'est le **coût d'appel** : des dizaines d'objets, autant de changements
d'état passés au pilote (ANGLE → Direct3D 11), et ce coût-là est le même en qualité haute et basse.

Correctif : **un marqueur n'est plus dessiné deux fois**. Il l'était dans la passe globale PUIS dans
celle de son niveau, le second passage réécrivant le premier au même endroit. Il ne reste dans la
passe globale que si elle relève les ombres (il faut alors qu'il soit là pour les porter) ou si son
niveau n'a pas de passe à lui. Vérifié au compteur : à deux passes, les marqueurs du niveau comptent
37 appels et non 74.

#### Le voile sait éteindre les pilules

Le coût des pilules ne se paie qu'en partie dans `render()` : le reste est du style et du
compositeur, là où ni `renderer.info` ni le temps passé dans `render()` ne vont. La ligne
« pilules » du voile est donc **cliquable** : elle coupe la couche DOM et cesse de la mettre à jour.
Les éteindre et regarder « img/s » est la seule façon de chiffrer ce qu'elles coûtent — sur la
machine qui a le problème, pas sur une autre.

#### 6. Les étiquettes promues en couches de composition

Verdict de l'utilisateur, l'interrupteur du voile en main : **« ce sont bien les étiquettes qui font
ramer l'orbite »**. Ce que le `CSS2DRenderer` fait à chaque image est pourtant modeste — deux
écritures de style par étiquette VISIBLE (il saute les autres, et ne les met même pas dans le DOM).
Le prix n'est pas là : il est dans ce que le navigateur fait ensuite. Déplacer un élément non promu
le fait **REPEINDRE en entier** — bordure, arrondi, ombre, disque de catégorie, SVG de l'icône — plus
la zone qu'il libère. Quarante étiquettes au-dessus d'un canvas qui se redessine, c'est quarante
repeints par image, et aucun compteur de three ne les voit.

`will-change: transform` sur `.marker-anchor` les promeut : une étiquette n'est plus qu'une texture
que le compositeur repose ailleurs, son déplacement ne coûte plus de peinture. `contain: layout style`
borne en plus l'invalidation à l'étiquette elle-même.

Le voile compte désormais les étiquettes **qui bougent** et non les appareils (« visibles / marqueurs »
au voile) — c'est ce nombre-là qui décide du coût, et il dépend de la vue :
en vue d'ensemble seul le jardin en porte, sur un niveau focalisé tous ses appareils.

Si cela ne suffisait pas, le levier suivant est de **ne plus passer par le DOM pour le niveau de
détail le plus bas** : au plus loin une pilule n'est qu'un point coloré, et un point se dessine dans
la scène pour presque rien.

#### 7. « Hors rendu », et une promotion qui ne dure que le mouvement

Retour de l'utilisateur, après la promotion : « le fps plonge, on accumule une sorte de déficit…
c'est comme si on prenait du retard pour afficher une image et qu'ensuite on devait rendre les images
en retard avant de reprendre ». Vérifié d'abord qu'il ne s'agit pas d'une fuite : 900 rendus
d'affilée sur la maison réelle laissent géométries (39), textures (37), programmes (20), étiquettes
dans le DOM (17) et tas JavaScript (72 → 77 Mo) **strictement stables**. Rien ne s'accumule dans la
scène. Et ce n'est pas thermique non plus : le défaut persiste machine branchée, en mode performance.

Un retard qui se creuse puis se rattrape, c'est une FILE qui se remplit — pas un dessin lent. Le voile
affiche donc « **hors rendu** » : le temps qui sépare deux images moins celui passé à dessiner,
c'est-à-dire ce que le navigateur fait de son côté (style, disposition, peinture, composition,
présentation). Un « hors rendu » qui gonfle pendant que « rendu » reste stable désigne tout sauf
notre dessin.

Et la promotion des étiquettes devient **transitoire** : `will-change` n'est posé que pendant le
mouvement (`data-moving`, relâché une demi-seconde après la dernière image). Une promotion permanente
sur quarante éléments garde autant de textures vivantes en permanence — la spécification le
déconseille explicitement, et c'est exactement le genre de chose qui se paie en **dégradation
progressive** plutôt qu'en coût fixe.

**Décision de l'utilisateur, à retenir** : pas d'étiquettes en 3D si l'on y perd en qualité. Le texte
net à toute échelle, l'ellipsis, le défilement d'un nom long et le thème par variables CSS ne se
troquent pas contre des images par seconde. La piste « un `InstancedMesh` et un atlas de texte » est
donc **écartée**, et ce qui reste à optimiser doit l'être sans toucher au rendu des étiquettes.

#### 9. La scène rendait en continu SANS qu'on touche à rien

Le relevé suivant de l'utilisateur écarte la piste précédente et en ouvre une meilleure : le panneau
latéral était **replié depuis le début** (son `backdrop-filter` n'a donc jamais été en cause), et
« hors rendu » continue de gonfler **après l'arrêt de l'orbite », jusqu'à 70 ms, avant de redescendre.

Un chiffre qui continue d'évoluer après l'arrêt veut dire une chose : **des images continuent d'être
rendues**. Vérifié dans la preview, sans toucher à rien pendant trois secondes :

```
loop.running : true   animations : 1   img/s : 18
```

Le rendu à la demande était défait par une animation **décorative**. L'onde d'un lecteur qui joue
(période 5,75 s) et le souffle d'une batterie qui charge (2,6 s) rendent `true` à chaque pas, donc la
boucle se reprogrammait indéfiniment — à la cadence de l'écran. Une maison où une enceinte joue
redessinait TOUT (deux passes, ~280 appels de dessin, la chaîne d'effets, quarante étiquettes
déplacées) soixante fois par seconde, pour un anneau qui avance d'une fraction de pixel par image. Et
ce chargement permanent se cumulait à tout le reste : la file de composition du navigateur ne se
vidait jamais vraiment, ce qui explique le déficit qui s'accumule ET sa lenteur à se résorber.

`core/renderLoop.ts` distingue donc deux choses qu'il confondait :

- ce qui vient d'un **geste** — vol de caméra, contrôles encore amortis, `invalidate` explicite —
  garde la **cadence pleine** : c'est là que l'œil voit la saccade ;
- ce qui n'est que **décor animé** tourne à `ANIMATION_HZ` (20). Une onde de 5,75 s y est lisse.

Piège rencontré en l'écrivant : `dirty` dit que l'image COURANTE est demandée, pas qu'il faut
continuer après. Les confondre faisait tourner la boucle indéfiniment après un simple `invalidate` —
un test existant l'a attrapé tout de suite. Le voile affiche maintenant le nombre d'animations en
cours : un « img/s » au repos qui n'est ni 0 ni 60 s'explique de lui-même.

**Écarté et remis en cause au passage** : le canvas rendu opaque (point 8) a été **annulé**.
L'utilisateur a signalé une aggravation dans la même fenêtre, et rien ne permettait de démontrer le
gain — une modification qu'on ne sait pas mesurer et qui coïncide avec une régression ne se garde pas.
Le piège three r140 (`alpha: false` ne donne plus un contexte opaque) reste vrai et noté ici, pour le
jour où on saura le mesurer.

#### Ce que la mesure vaut, et ne vaut pas

Les chiffres ci-dessus ont été pris dans la preview intégrée, dont le `requestAnimationFrame` est
bridé à ~3 Hz : les cadences y sont ininterprétables, et seules les mesures **comparatives**
(à mêmes conditions, image par image avec `gl.finish()`) ont été retenues — 7,0 ms → 4,8 ms par image
sur la maison réelle pour les points 1 et 2, à 819 × 910 et rapport de pixels 1. Le point 3 ne se
mesure pas depuis JavaScript du tout : il se raisonne, et se vérifie sur la vraie machine avec le
voile.

Sources : `apps/web/src/components/home/SceneDebug.vue`, `apps/web/src/three/HouseScene.ts`
(`setProbe`, `debugStats`, `invalidateShadows`, `refreshLevelPasses`, `renderPasses`),
`apps/web/src/styles/app.css` (`.marker-pill`), `apps/web/src/stores/settings.ts`.

### Mise à jour 2026-09-15 (undecies) — le goulot était le GPU, et ce n'était pas le bon

**Déclencheur** : après les trois coûts supprimés (decies), « on a donc toujours le pb du hors rendu
qui gonfle » sur la maison réelle.

**Ce que la mesure a montré.** Dans un Chrome À PART piloté par CDP (la preview intégrée et un onglet
caché n'ont pas de `requestAnimationFrame`, voir `../6_faq/6_0_pieges-outillage.md`), vraie maison,
orbite soutenue, une requête `EXT_disjoint_timer_query_webgl2` autour de chaque image :

- le fil principal était libre à 86–91 % (style 0,5 ms, mise en page 0,2 ms par image) ; `render()`
  soumettait en 7 ms ; **le GPU mettait 93 ms** à exécuter une image « high » → 8,5 img/s. Le
  « hors rendu » du voile, c'était cette attente ;
- pilules DOM, `z-index` du `CSS2DRenderer`, promotion `will-change`, `backdrop-filter` des grappes :
  aucun effet mesurable (8,5 vs 8,3 img/s). Une page nue qui efface un canvas WebGL2 de même taille
  tourne à 110–140 img/s sur le même GPU : la présentation n'y est pour rien non plus ;
- **Chrome dessinait sur le GPU intégré** d'un portable à GPU hybride (iGPU + GPU dédié),
  `UNMASKED_RENDERER_WEBGL` = `ANGLE (AMD, AMD Radeon(TM) Graphics ...)`. Sur le GPU dédié, même scène,
  même code : 14,5 ms → 62 img/s. `powerPreference: 'high-performance'` n'y change rien ; c'est le
  réglage Windows par application (Graphiques → `chrome.exe` → Hautes performances) qui décide, et
  l'utilisateur l'a posé : « effectivement c'est bien mieux » ;
- le poste, c'est l'**occlusion ambiante** (`GTAOPass`, qualité « high » seule) : ~75 ms sur l'iGPU,
  ~10 ms sur le GPU dédié, et **quasi indépendant du nombre de pixels** (canvas moitié : 79 vs 93 ms). Le
  rapport de pixels ne l'attaque donc pas ; « medium » (sans GTAO) divise le temps GPU par cinq.

**Ce qui change dans le code** (`core/post.ts`, `HouseScene.ts`) :

1. **`detectQuality(gpu)`** lit le nom du GPU (`gpuName(renderer)`, extension
   `WEBGL_debug_renderer_info`) : Intel, `Radeon(TM) Graphics`, `Radeon Graphics`, `Radeon 7xxM`,
   `Vega n` → `medium` d'entrée ; SwiftShader, llvmpipe, Basic Render Driver → `low`. Les cœurs et la
   mémoire restent, en second — beaucoup de cœurs et de mémoire disaient « high » de la machine
   qui peinait.
2. **Le garde-fou mesure le GPU, pas le fil principal.** Auparavant (septies) il chronométrait
   `composer.render()` côté CPU : 7 ms contre un budget de 40, il ne pouvait pas voir un GPU à 93 ms,
   et « auto » restait « high » à 8 img/s. Depuis le 2026-09-15 : une requête de temps GPU
   (`EXT_disjoint_timer_query_webgl2`) autour de chaque image, résultat lu quelques images plus tard ;
   sans l'extension (Safari, Firefox), l'intervalle entre deux images enchaînées. Seules comptent les
   images **mesurables** — `interactive && t0 > shadowsDirtyUntil` — celles d'un geste sans relevé
   d'ombres : les premières images après un chargement refont la carte d'ombre pendant 700 ms et
   envoient textures et carte d'environnement ; la première version du correctif avait rebaissé un
   GPU dédié en « medium » sur celles-là. Décision à la **médiane** de 12 échantillons (`createCostGuard`
   : 16 images observées, 4 de chauffe), budget 40 ms inchangé.

**Vérifié** (Chrome à part, `_generated-ai-doc/perf/verify-guard.mjs` et `diag-guard2.mjs`) : sur
l'iGPU, « auto » part en medium ; « high » forcé reste high tant que la médiane GPU tient sous 40 ms
(30 ms, 25 img/s ce soir-là) ; ×4 pixels (143 ms) → redescend en medium en ~3 s. Sur le GPU dédié : « auto »
donne high, high reste high. Un même iGPU a mesuré 93 ms puis 30 ms à une heure d'écart, même scène,
même code : ses fréquences suivent la charge et la chaleur, c'est ce que le garde-fou absorbe.

**Ce que ça remet en perspective.** Les correctifs DOM du decies (promotion, `contain`, plus de
`backdrop-filter` sur les pilules) restent de l'hygiène juste, mais ils n'étaient pas le plafond de
la maison réelle. L'hypothèse « canvas opaque » est close : la présentation ne coûte rien de
mesurable. Le voile de débogage garde son sens à condition de lire « hors rendu » comme « attente du
GPU (ou du navigateur) », pas comme du CSS.

Sources : `apps/web/src/three/core/post.ts` (`gpuName`, `detectQuality`, `createCostGuard`,
`createPostPipeline`), `apps/web/src/three/HouseScene.ts` (`applyQuality`, `render`),
`apps/web/src/three/three.test.ts` (« qualité de rendu »), note `_generated-ai-doc/perf-scene-3d.md` §§ 9–10.

### Mise à jour 2026-09-15 (duodecies) — deux styles de plus, et des matières en IMAGES

Demande de l'utilisateur, maquette générée à l'appui (maison isométrique de nuit, « rendu fin et
détaillé ») : « je pense qu'il faut qu'on passe aux assets », un **switch sous les styles** entre le
mode procédural et le mode assets du style « pour ne pas perdre ce qui a été fait en procédural »,
et deux styles de plus (dont un d'après une seconde image : maison monochrome bleue). Arbitrages
posés : **pas de mobilier, pas de végétation** (la décision du matin tient), **un asset gazon oui**,
des **kits existants et gratuits** seulement. Constat partagé : candy n'est pas utilisable en plein
jour, cyberpunk à aucune heure, nature à revoir (blocs de pierre à l'échelle d'un château).

> **2026-09-28** : « pas de végétation » est levé pour les éléments que l'utilisateur plante lui-même
> (`site.garden[]`, facetté procédural, sans asset). Voir la section du 2026-09-28 en fin de page et
> `../2_maison/2_2_jardin.md`.

#### Indigo et Maquette (`three/styles/{indigo,maquette}.ts`)

- **`indigo`** : l'illustration monochrome — toute la maison dans le même bleu mat, relief à peine
  marqué, et le vitrage comme SEUL élément chaud de la palette (`glass: '#f6e7cf'`, émissif la nuit
  jusqu'à 0,7, nul le jour). Le jour est une « heure bleue » claire, jamais un midi blanc : c'est ce
  qui le rend lisible à toute heure. Crépuscule à liseré magenta, AgX pour garder le bleu bleu.
- **`maquette`** : le modèle blanc de l'architecte. Palette presque blanche, sols un ton sous les murs
  (sur du blanc, c'est ce ton qui sépare le plan de l'élévation), plateau en carton LISSE (le grain
  d'une pelouse sur un aplat pâle ne fait que du bruit — première version rejetée pour ça), ciel de
  studio gris, ombres pleines, occlusion forte (« le trait de crayon de ce style »), `neutral`.
  Exposition de jour à 0,72 : à 0,95 murs et sols tombaient sur la même valeur. Le seul style qui
  n'aura jamais besoin d'assets.

Six styles au catalogue ; les tests parcourent `RENDER_STYLES`, rien à ajouter pour un style de plus.

#### Le contrat des matières s'élargit (`textures/procedural.ts`)

`SurfaceTexture.ormMap` devient **`roughnessMap` + `metalnessMap: Texture | null`** (le procédural
sert la même carte packée aux deux ; une photo n'a pas de carte de métal, la métallicité du style
reste uniforme), plus **`colored?: boolean`** : la carte porte SA couleur. `materials.ts › surface`
pose alors du blanc à la place de la couleur de palette — sans quoi un plâtre blanc photographié
sous un mur beige rendait un beige sale. `applyLook(mats, theme, look, photos?)` accepte un jeu de
matières qui passent devant les procédurales du même rôle ; signature existante inchangée (rayon
d'impact HIGH : `createMaterials`, `setAppearance`, `useHouseScene`).

#### Le pack photo (`textures/assets.ts`, `public/assets/textures/photo/`)

Dix matières **CC0 d'ambientCG**, une par rôle « réel » : plaster Plaster001, concrete Concrete046,
wood WoodFloor051, tile Tiles133A, carpet Carpet016, grass Grass004, pavers PavingStones128, soil
Ground048, roof RoofingTiles013A, stone Bricks100 (provenance dans `SOURCES.md` à côté des fichiers).
Trois cartes par matière — couleur (sRGB), normale **OpenGL** (celle de three), rugosité (données,
`NoColorSpace`) — en JPEG 512 px : **1,5 Mo** le pack, contre ~50 Mo pour les zips 1K d'origine.
`PHOTO_PACK.surfaces[rôle].tileM` reprend la cote physique publiée (gazon 1,40 m, parquet 1,80 m,
pavés 3,50 m…) ; trois cotes posées à l'œil faute de donnée (plâtre 2 m, carrelage 1,2 m, pierre
2,5 m). Concrete034, rectangulaire (110 × 55), écarté au profit de Concrete046.

Un rôle absent du pack **reste procédural** (l'eau, le néon, la laque, la grille). Un style déclare
son pack par **`RenderStyle.assets: 'photo'`** — `realistic` et `nature` ; les quatre autres sont
entièrement calculés et le switch est grisé pour eux.

`loadPackTextures(pack, rôles, onReady, load?)` rend tout de suite les matières DÉJÀ chargées et
lance les autres ; `onReady` est rappelé à chaque rôle qui arrive. Cache `READY` borné et partagé
comme `BAKED`, échec non mis en cache (même politique que `loadModel`). Chargeur injectable
(`ImageLoad`), même contrat que `TextureLoad` et `ModelLoad`.

#### La scène (`HouseScene.setAppearance({ assets })`)

Quatrième axe de `SceneAppearance` : `assets: boolean`. `applyMaterials()` regroupe `applyLook` +
`syncFloorClones` : il demande le pack si le style en a un ET si l'utilisateur le veut, et **le
procédural tient la place** jusqu'à l'arrivée des images — la maison n'attend jamais un fichier. Un
jeton `photoGen`, incrémenté à chaque `setAppearance` et dans `dispose`, écarte les rôles qui
arrivent pour un style, un réglage ou une scène qu'on a quittés. La surbrillance de pièce est
rejouée à chaque arrivée (`highlightRoom` recopie les couleurs des clones et redessine).

**Vérifié** (preview mock, 1600 × 900) : les 30 fichiers en 200, mur en photo et blanc (`color`
`ffffff`, `map.image.src` = `plaster/color.jpg`) ; switch éteint → `DataTexture` procédurale et
couleur de palette (`d9cdb8` en nature) ; rallumé → photo. Réaliste de jour : gazon, parquet,
carrelage et plâtre changent nettement la lecture ; de nuit l'écart reste faible — la nuit est faite
par la lumière, pas par la matière. Typage, 43 tests 3D, lint propres.

**Suite recommandée** : le détail architectural en procédural (encadrements, appuis, couronnement des
murs, acrotère, appliques) — c'est maintenant l'écart le plus visible avec la maquette.

Sources : `apps/web/src/three/styles/{indigo,maquette,types,realistic,nature}.ts`,
`apps/web/src/three/textures/{assets,procedural}.ts`, `apps/web/src/three/builders/materials.ts`,
`apps/web/src/three/HouseScene.ts`, `apps/web/src/composables/useHouseScene.ts`,
`apps/web/public/assets/textures/photo/SOURCES.md`, `scripts/fetch-textures.mjs`.

### Mise à jour 2026-09-15 (terdecies) — le détail architectural, en procédural

« On passe au détail architectural » : après les matières photo, l'écart le plus visible avec la
maquette était que la maison restait une boîte extrudée. Tout se déduit désormais des prismes de
murs et des rectangles d'ouvertures (`packages/shared/src/house/geometry`), sans asset ni donnée de
plus dans le JSON de la maison — `builders/details.ts`, appelé par `buildLevel`.

#### Cinq familles, quatre maillages

| Détail | Règle | Matériau |
|---|---|---|
| **Encadrement** d'une baie | quatre montants (fenêtre, 6 cm) ou trois (porte, 7 cm), à MI-ÉPAISSEUR du mur avec le vitrage ; le volet vit à 0,8 de l'épaisseur (`markers.ts`) et ne le touche pas | `frame` — sombre : sur un mur clair, c'est le cadre qui dessine la fenêtre (menuiseries anthracite de la maquette) |
| **Appui** de fenêtre | déborde de 5 cm devant la façade et de 4 cm de chaque côté ; son dessus AFFLEURE l'allège, un volet fermé descend jusque là | `trim` — clair |
| **Couronnement** des murs | 3 cm pris sur le mur + 5 mm au-dessus, débord de 1 cm de chaque face ; sur chaque morceau qui atteint le haut de SON mur (plein, linteau — pas l'allège) ; vu du dessus, c'est lui qui dessine le plan | `trim` |
| **Soubassement** des murs extérieurs | 28 cm depuis le sol fini (+2 mm : pas de face partagée avec le plancher), 1,5 cm dehors, 8 mm dedans — une plinthe ; une porte y laisse son trou | `plinth` — sombre |
| **Vantail** d'une porte | fermé, 4 cm, côté intérieur (0,35 de l'épaisseur) ; une porte de garage remplit sa baie ; un passage n'a rien | `door` — couleur du parquet |

Les couleurs se **déduisent de la palette** dans `applyLook` (lisse : mur → blanc à 0,4 ; menuiseries
: mur → noir à 0,55 ; soubassement : mur → noir à 0,4 ; vantail : `floors.wood`) : aucun style n'a
rien à déclarer, Indigo reste monochrome, Maquette reste blanche. Première lisse à 0,55 vers le blanc
: elle brûlait en plein soleil.

Une géométrie **fusionnée par matériau et par niveau** (`details:trim`, `details:frames`,
`details:plinth`, `details:doors`) : trente baies, ce sont quatre appels de dessin de plus. Les
maillages sont rangés dans `LevelNodes.walls` APRÈS les murs (fantôme d'un étage au-dessus, retour de
matériau ; `walls[0]` reste le mur extérieur des tests) — ils n'ont pas de pièce, un tap dessus vaut
un tap sur le mur.

#### Deux règles de géométrie, et deux pièges

- **Décaler ACROSS le mur, jamais le long.** Le quad d'un morceau est `[P0, Q0, Q1, P1]` (P ligne
  intérieure, Q ligne extérieure, `pieceFootprint`) ; `acrossOffset` déplace P et Q chacun selon la
  perpendiculaire orientée vers Q. Deux morceaux d'un même mur (plein, linteau, plein) gardent des
  couronnements qui se TOUCHENT exactement : deux dessus coplanaires qui se chevauchent
  scintillent. Il reste une encoche d'un centimètre à chaque angle extérieur, invisible.
- **Le signe de la normale** (`boxAt`). Après `rotateZ(atan2(u))`, l'axe y local d'une boîte suit la
  perpendiculaire GAUCHE de `u` ; la normale extérieure d'un mur (pièce CCW) est la perpendiculaire
  DROITE. Sans le signe `side = sign(perpLeft(u) · normal)`, cadres et appuis partaient dans la
  pièce — vu par l'utilisateur sur la vraie maison, capture à l'appui (« normal que ce soit comme
  ça ? à l'intérieur de la pièce ? »), appui posé au pied de la fenêtre côté parquet, vantail côté
  façade. Le vitrage et le volet, qui emploient `normal` directement, étaient à leur place.
- **`mergeGeometries` refuse de mélanger indexé et non indexé** : une `BoxGeometry` est indexée, une
  `ExtrudeGeometry` ne l'est pas ; les boîtes passent par `toNonIndexed()` avant fusion. Première
  version : couronnements et soubassement absents, deux erreurs console, aucun test ne le voyait.

**Tests** (`three.test.ts › détail architectural`, six) : quatre maillages et leurs matériaux,
couronnement à +5 mm du haut des murs, soubassement de 2 mm à 28 cm, projection de chaque sommet sur
la normale de SA baie (niveau réduit à la seule `baie` : cadre entre les deux faces, appui au-delà de
la mi-épaisseur et débordant la façade — le test qui aurait attrapé le signe), passage sans rien,
lisse plus claire / menuiseries et soubassement plus sombres que le mur.

**Vérifié** (preview mock, jour et nuit, vue d'ensemble et façade rapprochée) : le plan se lit par ses
couronnements, les fenêtres par leur cadre sombre et leur appui, la maison se pose par son
soubassement ; les vantaux ferment les portes. Non fait : appliques de façade (des lampes que la
maison ne possède pas — règle « seulement les appareils réellement possédés »), fascia et acrotère
du toit.

Sources : `apps/web/src/three/builders/details.ts`, `apps/web/src/three/builders/{materials,buildHouse}.ts`,
`apps/web/src/three/three.test.ts`, `packages/shared/src/house/geometry/walls.ts` (`pieceFootprint`).

### Mise à jour 2026-09-15 (quaterdecies) — toit, bassin, et une sélection qui ne teinte plus le sol

Trois demandes de l'utilisateur après le détail architectural : « ok pour le toit (fascia et
acrotère) », « si on peut faire qqchose de mieux pour l'eau/la piscine » (référence : bassin de nuit,
margelle claire, eau bleue profonde), « revoir la mise en évidence d'une pièce sélectionnée car
actuellement ça perturbe les couleurs propagées par les lumières et la sélection n'est aussi pas
toujours bien visible ». Puis, en cours de route : « pour le toit plat trouver autre chose que de la
tuile », « correctement aligner la texture du fond (actuellement en biais par rapport aux côtés) »,
et deux tours de réglage du glow.

#### Le toit (`builders/details.ts › buildRoofDetails`, enfant du maillage `roof`)

- **Toit à deux pentes** : une **planche de rive** (`frame`, anthracite ; 18 cm de haut, 4 cm
  d'épais) pendue sous chaque arête de VERSANT qui n'est pas le faîte — égouts et rives de pignon.
  Les faces du descripteur sont des plans sans épaisseur (`RoofDescriptor.thickness` 0) : la rive
  est l'épaisseur visible d'un toit qui n'en a pas. Un parallélépipède (boîte unitaire à base
  oblique, `Matrix4.makeBasis`) : la planche d'une rive en pente suit la pente en gardant ses faces
  verticales. Décollée d'un centimètre du pignon, sinon deux faces coplanaires scintillent. Les
  pignons se reconnaissent à leur emprise au sol d'aire nulle.
- **Toit plat** : un **acrotère** (`extrudeRing`, 20 cm d'épais, 35 cm au-dessus de la dalle) dans le
  matériau des murs, couronné comme eux (`trim`).
- **La dalle d'un toit plat n'est pas en tuiles.** Le pack photo habillait `roof` de RoofingTiles :
  juste sur un versant, absurde à plat. Nouveau rôle **`gravel`** (procédural : grain gris serré ;
  photo : Gravel043, 1,60 m), `SurfaceLooks.roofFlat?` (défaut `{ gravel, roughness 1 }` dans
  `applyLook`, aucun style n'a eu à changer), matériau `roofFlat`, choisi par `buildHouse` selon
  `roof.type`.

#### La piscine est un bassin (`buildHouse.ts`, zone `pool`)

Auparavant une tache bleue à +1 cm sur le terrain. Désormais : une **margelle** (`trim`, anneau de
40 cm, `offsetPolygon` → polygone, à +1,2 cm), un **bassin** (extrusion du polygone de −1,50 m à
+1,2 cm rendue sur ses faces ARRIÈRE — `poolBasin`, `side: BackSide` : parois et fond se voient de
l'intérieur, le dessus reste ouvert ; carrelé quel que soit le style, `tile` toujours cuit, couleur
= eau du style éclaircie de 55 %), et l'**eau** 12 cm sous la margelle, translucide (`zones.pool`
`transparent`, opacité 0,72) : c'est le fond qui lui donne sa couleur et sa profondeur. L'eau reste
le maillage de la zone (`zones.get`, tap, guide du mode déplacer).

Deux conséquences qu'il a fallu tirer :
- **Terrain et sol infini sont PERCÉS** à l'emprise des bassins (`flatWithHoles`, `discWithHoles`) :
  la surface du terrain, à la cote du bassin, en fermait le trou, et le disque de sol deux
  centimètres plus bas le coupait à deux centimètres de profondeur. Vu en preview : une margelle
  autour de la pelouse.
- **Les UV suivent les bords de la piscine, pas les axes du monde.** `ExtrudeGeometry` et
  `ShapeGeometry` prennent les positions locales pour UV : sur une maison dont la piscine n'est pas
  alignée sur les axes, les carreaux du fond étaient en biais (« actuellement en biais par rapport aux côtés »).
  `shapes.ts › alignedToLongestEdge(polygone, construire)` : le polygone est tourné pour poser son plus
  grand côté sur l'axe y (autour de son centre, `longestEdgeYawDeg` / `centroid`), la géométrie est
  construite là, puis ramenée en place — les positions reviennent, les UV restent locales. Test :
  un 8 × 4 tourné de 30° a une emprise UV de fond de 32 m², contre le double en placage monde.
  Pas de spots sous l'eau : ce seraient des lampes que la maison ne possède pas.

#### La sélection d'une pièce (`HouseScene.highlightRoom`)

**Remplacement** : jusqu'au 2026-09-15 (cf. « surbrillance par pièce », clones de sol), le sol de la
pièce choisie tirait vers l'accent (`color.lerp` 0,45) et en émettait un peu la nuit. Deux défauts
signalés : la teinte FAUSSAIT les flaques colorées des lampes (le sol réfléchit ce qu'il est), et
elle se perdait sur un parquet sombre ou sous un ciel noir. Désormais la pièce porte un **trait**
(`flatRing`, 14 cm le long des murs, à +1,2 cm) et un **voile** (opacité 0,10), tous deux en
`MeshBasicMaterial` — non éclairés, ils ne réagissent pas aux lampes et n'altèrent pas le sol. Le
trait se dessine **par-dessus les murs** (`depthTest: false`, comme le guide du mode déplacer) : en
vue oblique, le pied d'un mur cachait la ligne qui le longe. Les deux vivent dans le groupe du
niveau (visibilité, élévation) et sont libérés à chaque changement et dans `clear`. Les clones de
sol continuent d'être resynchronisés ici (couleur et émission de leur nature) : c'est cet appel qui
les remet d'aplomb après un changement de style ou d'heure.

**Le glow, réglé à l'œil avec l'utilisateur** : couleur = accent éclairci de 20 % vers le blanc, puis
**× 1,15**. À × 1,8 le bloom de nuit le brûlait en blanc (« ça glow beaucoup ») ; à × 1 « ça ne glow
plus assez » ; c'est le petit dépassement de 1 que le bloom accroche la nuit sans écraser la teinte.

**Tests** (`three.test.ts`, cinq de plus, 54 au total) : rives sous l'égout et jusqu'au faîte, jamais
au-dessus ; acrotère et couronnement d'un toit plat, dalle en `roofFlat` distincte de `roof` ;
bassin (margelle, parois `BackSide`, eau translucide à −12 cm) ; UV du fond alignées ; sélection :
deux maillages non éclairés, couleur du sol inchangée, retirés à la désélection.

**Vérifié** en preview mock, jour et nuit : bassin lisible avec sa profondeur, rives sombres sous le
toit, trait de sélection visible de loin et néon discret la nuit. Un défaut de lint préexistant dans
`models/loadModel.ts` (import de types) est hors périmètre et laissé tel quel.

Sources : `apps/web/src/three/builders/{details,buildHouse,shapes,materials}.ts`,
`apps/web/src/three/HouseScene.ts` (`highlightRoom`, `HIGHLIGHT_RING_M`) *(constat du lint du 2026-10-06 : `HIGHLIGHT_RING_M` n'existe plus, les réglages sont les `ring*` de `three/styles/tuning.ts`)*,
`apps/web/src/three/textures/{procedural,assets}.ts` (`gravel`), `apps/web/src/three/styles/types.ts`
(`roofFlat`), `scripts/fetch-textures.mjs`.

### Mise à jour 2026-09-16 — la couleur d'une carrosserie se voit PENDANT qu'on la choisit

Le sélecteur de couleur d'un véhicule n'écrivait qu'au choix validé (`change`) : la voiture ne
changeait de teinte qu'à la fermeture de la popup, alors que c'est justement sur la voiture qu'on
juge une couleur. Le sélecteur natif annonce pourtant chaque nuance survolée (`input`) — mais écrire
à chaque mouvement réécrirait le fichier de la maison des dizaines de fois par seconde.

D'où un **aperçu**, séparé de l'écriture, sur le modèle du brouillon de déplacement (`draft` /
`moveMarker`) :

| Couche | Ce qui a été ajouté |
|---|---|
| `markers/DeviceMarker.ts` | `previewColor(color)` qui ne fait rien — seul un véhicule a une caisse à peindre. Le point d'entrée vit sur la classe de base pour que la scène n'ait pas à importer la sous-classe. |
| `markers/markers.ts` | `VehicleMarker.previewColor()` : peint **un seul** matériau, sans refaire les marqueurs. `null` rend la teinte d'avant. |
| `HouseScene.ts` | `previewBodyColor(key, color)` → `this.markers.get(key)?.previewColor(color)`. |
| `useHouseScene.ts` | Le relais habituel vers la scène. |
| `views/HomeView.vue` | `watch(() => house.bodyColorPreview, …)`. |

**Le matériau partagé.** Une voiture sans couleur réglée et à l'aspect de la scène utilise
`ctx.materials.vehicle`, partagé par TOUS les véhicules : le peindre tacherait les autres. Elle s'en
détache donc à la première retouche (`bodyMat.clone()`, `ownsBodyMat` passe à vrai, le matériau est
réappliqué à la carrosserie chargée et à la boîte qui la remplace le temps du chargement) — ce qui
fait perdre à `bodyMat` et `ownsBodyMat` leur `readonly`. `paintBase` garde la teinte d'avant pour
`previewColor(null)`.

**Le chemin de retour.** L'écriture, elle, refait tous les marqueurs (`updateDevices`) : la maison
reprend la main et l'aperçu devient sans objet. Un choix abandonné, lui, est rendu par le composant
qui replie la section (`onBeforeUnmount`).

**Piège évité.** La première version faisait `marker instanceof VehicleMarker` dans `HouseScene`, ce
qui y ajoutait un import de VALEUR vers `markers/markers.ts` — la scène n'en importait jusque-là que
des types et `createMarker`. Vite a réévalué `HouseScene.ts` à chaud, le module s'est retrouvé à
moitié initialisé, et `useHouseScene` n'y a plus trouvé `HouseScene` (cf.
`../6_faq/6_0_pieges-outillage.md`). D'où la méthode posée sur la classe de base.

Vérifié dans l'app : la R5 suit le sélecteur (`#2244ff` → `#00a86b` → `#ff7a00`) sans qu'aucune croix
« Effacer » n'apparaisse — donc rien n'est écrit ; le panneau replié sans valider rend `#aab2bb`, la
teinte de la scène ; la validation écrit `#c8102e`.

Sources : `apps/web/src/three/markers/DeviceMarker.ts`, `apps/web/src/three/markers/markers.ts`,
`apps/web/src/three/HouseScene.ts`, `apps/web/src/composables/useHouseScene.ts`,
`apps/web/src/views/HomeView.vue`, `apps/web/src/components/vehicles/VehicleTuning.vue`.

### Mise à jour 2026-09-16 — la météo entre dans l'ambiance : nuages et brouillard

`SceneAmbience.cloudiness` n'attend plus « un plugin qui la publie » : `useHouseScene` lit
`useWeather().cloudiness` (l'appareil `weather` disponible, `cloudCover / 100`) et la passe à
`resolveAmbience`, avec `visibilityM` quand la météo la donne. Sans météo : ciel dégagé, comme avant.
Ce que la scène en fait :

- **Les styles** qui lisaient déjà `cloudiness` (`realistic`, `nature`, `indigo`) réagissent tels
  quels : soleil moins fort, hémisphérique plus fort, ombres qui s'effacent (`castShadow` coupé sous
  0,15 d'opacité), pas de disque solaire.
- **Le ciel se grise pour tous les styles**, centralement : `overcastSky(look.sky, cloudiness)`
  (`core/sky.ts`) désature et assombrit zénith et horizon, éteint `sunGlare`. C'est ce ciel qui sert
  d'environnement PBR et de fond du canvas — un style garde son ciel dégagé, la météo le grise pareil
  pour tous.
- **Brouillard** : `fogDistance(ambience)` (`core/ambience.ts`) ramène la visibilité météo à
  l'échelle de la maison (`visibilityM / 12`, borné 18-300 m, rien au-dessus de 5 km) ; `applySky`
  pose un `Fog` de la couleur du fond. Vérifié en preview en forçant `cloudiness: 1, visibilityM: 400`
  par `window.kasbahScene.setAppearance` : brouillard à 33 m, ombres coupées, soleil divisé par deux.

Pas encore fait (plan de session, palier C) : pluie et neige en particules, sols mouillés, blanc de
neige, éclair d'orage — le palier qui coûte du GPU et casse le rendu à la demande, à mesurer avant.

Sources : `apps/web/src/three/core/{ambience,sky}.ts`, `apps/web/src/three/HouseScene.ts`,
`apps/web/src/composables/{useHouseScene,useWeather}.ts`.

### Mise à jour 2026-09-16 — palier B : sols mouillés, blanc de neige, éclairs

L'ambiance gagne trois entrées optionnelles, dérivées de la **condition** météo par `weatherEffects`
(`core/ambience.ts`) : `wetness` (pluie 1, bruine 0,7, brouillard 0,35, neige fondue 0,6), `snow`
(neige 1, neige fondue 0,5), `storm` (orage). `useHouseScene` passe `condition` à `resolveAmbience`.

- **Mouillé et enneigé : dans les matériaux, pas dans la géométrie.** `applyLook` (`builders/materials.ts`)
  reçoit un `SurfaceWeather` et passe `weathered()` sur ce qui est DEHORS après `surface()` : toit,
  dalle de toit plat, terrain, zones sauf la piscine. La pluie fonce la couleur (× 0,7) et fait tomber
  la rugosité vers 0,18 (le reflet du ciel dans une flaque) ; la neige remonte la rugosité à 0,95 et
  tire la couleur vers un blanc cassé. Une **matière photo** porte sa couleur en carte (couleur du
  matériau déjà à blanc) : la neige s'y pose par l'**émissif**, seul canal qui éclaircit. Les sols
  intérieurs et l'eau ne bougent pas. Remettre le beau temps rend les valeurs du style (testé).
- **Éclairs : des minuteries, pas une animation.** Une `Animation` de la boucle aurait fait tourner
  le rendu à 20 Hz tout l'orage pour rien ; `stormStep` enchaîne deux éclats (× 2,6 pendant 70 ms,
  retour, × 1,9 pendant 120 ms) par l'exposition du post-traitement, une image par éclat, puis attend
  6 à 16 s. Le seul état est `stormTimer`, arrêté quand l'orage passe (`syncStorm`) ou à `dispose`.
- Vérifié en preview par `window.kasbahScene.setAppearance` : terrain (photo) 0,51 → 0,30 de
  rugosité et couleur foncée sous la pluie ; blanc et mat sous la neige ; minuterie posée en orage,
  nulle après.

Reste le palier C (pluie et neige en particules, vent), le seul qui coûte du GPU.

Sources : `apps/web/src/three/core/ambience.ts`, `apps/web/src/three/builders/materials.ts`,
`apps/web/src/three/HouseScene.ts`, `apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-16 — palier C : pluie et neige en particules

`effects/precipitation.ts` : des particules au-dessus de la parcelle, enfant de la racine (repère
local Z-up), dans un volume fermé (emprise de la maison + 3 m de marge, 14 m de plafond) — une
particule qui touche le sol retombe en haut, ailleurs ; poussée hors du volume par le vent, elle
rentre par l'autre bord. Nombre fixe, aucune allocation par image.

- **Pluie** : des `LineSegments` (une goutte qui tombe est un trait, pas un point), 700 à 2 600
  selon l'intensité, chute 9 m/s, trait de 40 cm **incliné par le vent** (la goutte suit 35 % du
  vent). **Neige** : des `Points` à disque doux (`CanvasTexture`, absente sans contexte 2D dans les
  tests), 500 à 1 600, chute 1,2 m/s, 70 % du vent et un balancement. Le vent vient de l'ambiance
  (`windKmh`, `windDirDeg` : d'où il vient, convention météo) ; il est toujours le VRAI, même en
  météo forcée.
- `weatherEffects` donne `precipitation` : bruine 0,3, pluie 0,8, orage 1, neige fondue 0,6 (en
  pluie), neige 0,8. `HouseScene.syncPrecipitation` pose ou retire l'effet à chaque `setAppearance`,
  au `load` (racine neuve) et à chaque changement de qualité ; même nature et intensité voisine
  (< 0,25) se **règle** sans reconstruire. `frustumCulled = false` : les positions bougent, le
  volume englobant serait faux.
- **Ce que ça coûte, et pourquoi c'est coupé en qualité basse** : l'effet lui-même est un appel de
  dessin et quelques milliers de sommets — rien. Ce qui coûte, c'est qu'il oblige la **boucle à
  tourner** tant qu'il pleut (bridée à 20 Hz comme toute animation décorative, `core/renderLoop.ts`),
  donc à redessiner toute la scène vingt fois par seconde — exactement le régime d'une enceinte qui
  joue. La mesure dans la preview n'est pas fiable (volet throttlé, cf. `_generated-ai-doc/perf/`) :
  ce qui est certain, c'est ce régime ; le chiffre GPU se mesure hors preview, comme pour le reste.

Sources : `apps/web/src/three/effects/precipitation.ts`, `apps/web/src/three/HouseScene.ts`,
`apps/web/src/three/core/ambience.ts`, `apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-16 — la tondeuse se place par son GPS, et son marqueur suit sans reconstruction

Un robot Husqvarna publie sa position en **GPS** (`location`), pas dans le repère de la maison comme la
tondeuse simulée (`position`). Trois retouches, calquées sur les véhicules du 2026-09-14 :

- **`effectivePosition`** projette aussi une `location` de kind `mower` (`sitePosition`, avec le
  `gpsOffset` de l'entrée de maison) ; **`drawable`** dessine les tondeuses que la maison ne déclare
  pas, identifiées par leur `deviceId` de plugin (`automower:<uuid>`), comme les voitures.
- **Pas de reconstruction à chaque relevé.** En tonte, une position arrive toutes les quelques
  secondes : refaire tous les marqueurs à chaque fois (ce que fait `vehicleFix` pour une voiture lue
  toutes les dix minutes) serait trop cher, et inutile — `MowerMarker` **suit** déjà sa cible par
  animation. `vehicleFix` ne rend donc pour une tondeuse que `in` / `out` (sur le terrain ou hors) :
  les marqueurs ne se refont que quand elle entre sur le terrain ou en sort.
- **`MarkerContext.toLocal`** : la scène donne au marqueur la projection GPS → repère maison (origine,
  cap, décalage de l'appareil, `null` hors terrain). `MowerMarker.onState` lit `state.position`, sinon
  `toLocal(state.location)` ; un relevé hors du terrain laisse le marqueur où il était.

Testé (`three.test.ts`, « tondeuse placée par son GPS ») : apparaît à son relevé sur la maison de
démo, même objet après un pas de plus dans le jardin, disparaît emportée hors du terrain.

Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/markers/{DeviceMarker,markers}.ts`.

### Mise à jour 2026-09-16 (nuit) — les incidents du journal, épinglés sur le terrain

`HouseScene.setJournalPoints(key, points)` pose une **épingle** par incident positionné du journal
d'un appareil (tige fine blanche de 0,7 m, tête teintée de la gravité — `JOURNAL_PIN_COLORS`, les
teintes de `lib/journal.ts` —, plus grosse pour une erreur grave), projetée comme l'appareil lui-même
(`sitePosition` avec le `gpsOffset` de son entrée de maison) ; un point hors du terrain n'est pas
dessiné ; `null` retire tout. Les épingles vivent dans `outdoorMarkers`, à la hauteur du terrain
(`deviceFloorZ`). `focusJournalPoint(at)` cadre la caméra sur une épingle avec la boîte de 3 m des
appareils. La scène ne décide pas quand les montrer : le store (`journalOverlay`, `journalFocus`)
et `HomeView` le lui disent, comme pour l'aperçu de teinte. Testé : deux points dans le terrain, un
au large ignoré, `null` vide, le cadrage ne plante ni sur un point connu ni sur un inconnu.

Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/three.test.ts`, `apps/web/src/composables/useHouseScene.ts`.

### Mise à jour 2026-09-16 (nuit, bis) — l'épingle du journal se touche et se raconte

Les têtes d'épingle sont **touchables** (`userData.role = 'journal'`, `at`) : `pick` les essaie en
premier — petites et posées au sol, elles perdraient contre le sol de la pièce — et `handleTap` émet
**`journalTap(at)`**. `setActiveJournalPoint(at | null)` grossit la tête active (×1,6) et montre son
**étiquette** : un `CSS2DObject` (`.journal-pin`) porté par chaque épingle, invisible par défaut —
dix-neuf étiquettes ouvertes se couvriraient. `focusJournalPoint` rend active l'épingle qu'il cadre.
Testé : l'épingle cadrée est grossie et étiquetée, les autres non, `null` éteint tout.

Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/three.test.ts`, `apps/web/src/composables/useHouseScene.ts`.

Piège relevé aussitôt : `disposeObject3D` et `removeFromParent` ne retirent PAS les éléments DOM qu'un
`CSS2DObject` a fait poser par le rendu 2D — refermer le journal laissait les étiquettes dans le vide.
`setJournalPoints` les enlève lui-même (`label.element.remove()`), comme `DeviceMarker.dispose`.

### Mise à jour 2026-09-17 — le caisson de la station d'eau, et deux bols écartés après mesure

Branche `water` dans `apps/web/src/three/markers/markers.ts` : un `BoxGeometry` de
**0,59 × 0,17 × 0,59 m**, les cotes exactes de la notice COMAP Proteo 2. Plat et large, il se lit
comme ce qu'il est — une centrale **murale**, bien plus grande qu'un thermostat et bien plus plate
qu'un coffret de batterie. Caisson centré sur l'ancre (comme la borne et le coffret), `setLift` à
`h/2 + 0,2` pour poser la pilule juste au-dessus de son arête haute. Le kind rejoint la liste qui
applique `rotation.z = yawToRad(device.yaw)` (avec `climate`, `ev_charger`, `energy`) : ce qui se
pose **contre** un mur a un dos, et un coffret tourné à l'envers se voit.

**Piège attrapé au passage, et il vaut pour tout nouveau kind orientable :** faire tourner un
maillage et rendre un appareil **orientable** sont deux choses distinctes, et il faut les deux.
`isOrientable` (`apps/web/src/lib/orientation.ts`) ignorait `water` : le maillage suivait bien son
`yaw`, mais le panneau ne proposait jamais la ligne « Orientation » pour le régler, et le cône
« regarde vers » du mode Déplacer n'apparaissait pas. Un `yaw` qu'on ne peut pas régler est un `yaw`
qui vaut toujours 0.

**Deux bols de cartouches essayés puis RETIRÉS**, après mesure de la projection sur un canvas de
1400 px : le caisson fait 111 px en focus appareil (8,8 m) et 26 px en vue de niveau (31 m) ; un bol
de 11 cm y ferait **21 px, et 5 px** respectivement. Essayés en direct dans la scène : à distance
moyenne les deux images sont **indiscernables**, et en focus les bols se lisent comme deux pieds,
pas comme des cartouches. Zéro bénéfice de lisibilité pour du détail en plus — l'impasse la plus
utile à noter, parce qu'elle se représentera à chaque marqueur qu'on voudra « enrichir ».

**Coût GPU : nul, et mesuré.** Médiane par image sur orbite soutenue de 8 s, **vraie maison**,
Chrome à part forcé sur le GPU intégré, qualité **medium**,
1904 × 905. Trois paires entrelacées caisson/sphère : 16,36/16,34 — 11,50/11,60 — 16,09/16,25 ms.
**L'écart A–B reste ≤ 0,16 ms quand l'écart entre deux passages du MÊME variant atteint 4,9 ms** :
l'effet est trente fois sous le bruit. Le caisson est même un peu moins cher que ce qu'il remplace
(12 triangles contre ~320 pour la sphère de la branche `default`). Sur ce protocole, voir la section
du 2026-09-15 sur le GPU et la mesure hors preview.

Vérifié dans la vraie maison : le caisson tient entre le sol et le plafond et son dos est à quelques
centimètres de la face intérieure du mur — il ne traverse ni sol ni mur et ne flotte pas. Il est
posé un peu bas pour une centrale murale, mais c'est le **placement de l'utilisateur**, pas le
marqueur. Un test de `three.test.ts` fige les cotes et le `yaw` ; captures clair/sombre/nuit dans
`_generated-ai-doc/sessions/2026-09-16-comap-proteo-2/captures/water-*.png`.


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

### Mise à jour 2026-09-18 (5) — la menuiserie prend matière et couleur : refends, vitrage, et une fusion par TEINTE

Le détail architectural (mise à jour du 2026-09-15 terdecies) ne se déduisait que de la géométrie :
tout dormant était anthracite, tout vantail en bois, et une baie se refendait selon sa largeur. La
maison peut maintenant en dire trois choses de plus par ouverture — vantaux, matière, couleur
(`../2_maison/2_0_format-house-json.md`) — et la scène les rend.

#### Les vantaux dessinent, selon que l'ouverture est vitrée ou pleine

`o.leaves` arrive tout calculé dans `OpeningRect` (`openingLeaves`,
`../2_maison/2_1_geometrie.md`) et commande deux gestes différents :

- **vitrée** : `leaves - 1` **refends** verticaux dans le dormant. C'est la généralisation de ce que
  la baie faisait seule — elle en prenait d'office selon sa largeur, ce sont désormais les vantaux
  qui décident, et une FENÊTRE à deux vantaux en gagne un aussi ;
- **pleine** (porte, porte de garage) : le panneau se **découpe** en autant de vantaux, séparés d'un
  jeu de 2 cm. Une porte à deux battants se reconnaît à ce trait vertical — pas à un panneau deux
  fois plus large. Un refend n'aurait rien donné ici : il vit à mi-épaisseur du mur, et le vantail
  plein est à 0,35 de l'épaisseur, donc le panneau l'aurait caché.

À un seul vantail, les deux chemins rendent exactement la géométrie d'avant : la baie du fichier de
démonstration compte ses trois montants et le panneau d'une porte garde son centre en `w/2`.

#### `glass` est la seule matière qui touche la géométrie

`isGlazed(o)` remplace `GLAZED_OPENINGS.has(o.type)` partout où la scène demandait « est-ce
vitré ? » : une ouverture l'est **par sa nature** (fenêtre, baie, porte vitrée) **ou parce que le
relevé lui donne le verre pour matière**. Une porte pleine en verre reçoit alors son vitrage
(`buildPane`) et perd son panneau opaque au profit d'un cadre de battant — vérifié dans la scène :
`porte-entree` passe du groupe des `details:doors` à celui des panes `MeshPhysicalMaterial`.

`wood` et `metal`, elles, ne changent rien au dessin : seulement la lumière (métal lisse et
réfléchissant, bois mat) et la couleur.

#### La fusion se fait par teinte, et une maison ordinaire n'y perd rien

Le détail était fusionné en **un maillage par matériau et par niveau** — c'est ce qui fait qu'une
maison de trente baies coûte trois appels de dessin et non trois cents. Une couleur par ouverture
casse cette règle, il fallait donc décider où.

Les encadrements et les vantaux se regroupent maintenant par clé `matière|couleur`, et **la clé vide
est celle du réglage par défaut** : une ouverture qui ne demande rien retombe sur le matériau
PARTAGÉ de son rôle (`mats.frame`, `mats.door`) et n'ajoute aucun appel de dessin. Seules les
ouvertures qui veulent autre chose en coûtent un de plus, et **deux fenêtres de la même teinte le
partagent**. Mesuré dans la scène de démonstration avec une seule porte teintée :
`details:frames#metal|#b5651d` (36 triangles) à côté du `details:frames` commun (216).

Les variantes vivent dans `MaterialSet.joinery`, une `Map` clé → matériau, et se recalculent
**entièrement depuis leur clé** à chaque `applyLook`. C'est ce qui les rattrape quand le style ou
l'heure changent — vérifié : en Cyberpunk le dormant partagé passe de `#908c86` à `#606372` pendant
que la teinte explicite reste `#b5651d`, parce qu'une couleur voulue n'est pas une couleur de
palette. `MaterialSet.applied` retient le dernier style pour la même raison : la géométrie se
rebâtit à chaque changement de maison, donc bien APRÈS la dernière application de style, et un
matériau créé à ce moment-là serait né noir.

`ROLE_PBR` et `MATERIAL_PBR` déclarent les réglages une seule fois, partagés entre la création des
matériaux de base et celle des variantes : le dormant d'une menuiserie teintée part du même point
que celui de toutes les autres.

Sources : `apps/web/src/three/builders/details.ts` (`isGlazed`, `leafSpans`, `bucket`,
`buildDetails`), `apps/web/src/three/builders/materials.ts` (`MaterialSet.joinery`,
`joineryMaterial`, `applyJoinery`, `ROLE_PBR`, `MATERIAL_PBR`),
`apps/web/src/three/builders/buildHouse.ts` (`buildPane`), `apps/web/src/three/three.test.ts`.

## Banc de réglage de la lumière (2026-09-18)

De nuit, l'image **brûlait les yeux** : les lampes allumées noyaient des pans de mur entiers dans du
blanc, et le trait de la pièce sélectionnée était un ruban de néon qui traversait le cadre. Le
diagnostic a trouvé non pas un réglage de travers, mais **quatre sources empilées**, chacune
raisonnable seule :

1. **Le seuil du bloom était très bas.** `realistic` la nuit : `threshold: 0.72`, `strength: 0.8`,
   `radius: 0.55`. La passe tourne AVANT l'`OutputPass`, elle seuille donc des valeurs **linéaires
   non bornées** : à 0,72, ce n'est plus la lampe qui bave, c'est tout mur qu'elle éclaire un peu
   fort. D'où les nappes blanches sur des surfaces qui ne sont pas des sources.
2. **Le halo était compté deux fois.** Le sprite additif de `markers.ts` (`glowMap`) avait été écrit
   *à la place* du bloom, « sans post-traitement ». Depuis qu'il y a une vraie passe, son opacité de
   0,6 la nuit dépasse le seuil et **bave à son tour**. Sa taille étant en mètres (`scale: 1.2`), une
   caméra proche d'une lampe se prend le halo en plein écran.
3. **Le trait de pièce était peint au-dessus de 1.** `accent.lerp(WHITE, 0.2) × 1.15`, `opacity 0.92`,
   `depthTest: false` : une bande pleine, d'épaisseur constante, dessinée par-dessus les murs et
   au-dessus du seuil de bloom. Un néon a un cœur fin et une décroissance ; celui-ci était uniforme,
   et l'œil le lisait comme de la peinture lumineuse, pas comme de la lumière.
4. **ACES désature ce qui dépasse.** L'accent × 1,15 × exposition 1,2 tombe dans le genou de la
   courbe et vire au blanc : ni le mauve du trait ni l'ambre des lampes ne survivaient.

### Ce qu'est le banc

Plutôt que de deviner un nouveau jeu de nombres dans le code, les nombres se règlent **devant la
maison, en direct**, et ce qui plaît s'enregistre (`house.render.tuning`, cf.
`../2_maison/2_0_format-house-json.md`).

`three/styles/tuning.ts` tient ce qui ne regarde que l'écran — bornes des curseurs, préréglages, et
`applyTuning(look, tuning)`, fonction **pure** qui pose un réglage sur le `StyleLook` d'un style. Le
contrat lui-même (les seize champs, leurs bornes, le neutre) vit dans `@kasbah/shared` avec le reste
de la maison.

**Tout est multiplicateur, jamais valeur absolue** — sauf les cinq grandeurs du trait de pièce, qui
n'appartiennent à aucun style (il vient du thème de l'application). C'est ce qui permet de régler la
nuit sans écraser la courbe jour/nuit du style : × 0,55 sur la force du bloom reste × 0,55 à midi, et
chaque style garde sa personnalité. Un réglage neutre rend **exactement** le look du style — vérifié
dans la scène réelle et par un test.

`HouseScene.setTuning()` est un **chemin court** : il recalcule le look et ne réapplique que la
chaîne d'image, le halo des lampes (`setTheme`, qui rejoue `onState`) et le trait de la pièce.
`setAppearance` referait matières, ciel, textures et ombres à chaque image d'un glissement de
curseur. `tunedLook()` rend ce que la chaîne applique VRAIMENT, réglage compris : c'est le chiffre
qu'on ira écrire dans un style le jour où un défaut sera arrêté.

### Les quatre préréglages

Quatre partis pris, pas quatre variantes du même — chacun répond à une question différente posée à la
même maison, et tous sont sortis du diagnostic ci-dessus :

| Préréglage | La question | Les leviers |
|---|---|---|
| **Douce** | la même image, sans l'éblouissement | seuil × 1,45 (seules les vraies sources bavent), halo ÷ 2 (le bloom fait le travail), trait à 10 cm sous le seuil |
| **Cinéma** | garder la TEINTE d'une surexposition | AgX, diaphragme + 35 % pour compenser la courbe plus douce, vignette creusée, trait le plus fin |
| **Sobre** | une tablette murale, en plein jour, à un mètre | presque pas de bloom, pas de vignette, trait net et opaque : la maison devient un tableau de bord |
| **Maquette** | garder l'esprit d'origine — ça doit briller | seul le seuil monte, assez pour que les murs cessent de baver, les lampes gagnant même en diamètre |

Un préréglage est un **point de départ, pas un verrou** : il pose les seize valeurs d'un coup, les
curseurs restent libres, et la pastille se désélectionne dès qu'un nombre change
(`sameTuning` reconnaît l'égalité exacte).

Sources : `apps/web/src/three/styles/tuning.ts`, `apps/web/src/three/HouseScene.ts` (`setTuning`,
`tunedLook`, `highlightRoom`), `apps/web/src/three/core/post.ts`,
`apps/web/src/three/styles/realistic.ts`, `apps/web/src/three/markers/markers.ts` (`LightMarker`),
`apps/web/src/three/styles/tuning.test.ts`.

## Tilt-shift : l'effet de maquette (2026-09-18)

Une bande nette, le flou qui monte vers le haut et vers le bas : ce qui fait lire une vraie maison
comme une maquette. La passe ferme la chaîne d'image, après le tone mapping et la vignette — c'est
un défaut d'objectif, pas une lumière.

**Ce n'est PAS une profondeur de champ, et c'est fidèle.** Rien ici ne lit la profondeur. Une photo
tilt-shift est faite avec un plan de netteté INCLINÉ, qui vu d'une caméra plongeante se lit
précisément comme une bande horizontale de l'image : la version en espace écran dit donc la même
chose que l'optique, à l'angle où la scène est regardée. Un vrai flou de profondeur (`BokehPass`)
demanderait un rendu de la scène en profondeur alors qu'elle est déjà rendue en plusieurs passes par
niveau, et l'occlusion GTAO en paie déjà un.

**Deux passes séparables** (horizontale puis verticale), neuf échantillons chacune au lieu des
quatre-vingt-un d'un noyau 2D, pour le même flou. Le rayon varie par pixel, ce qui n'est pas
exactement séparable — l'écart ne se voit pas, c'est l'approximation de tous les flous d'écran.
Éteint en qualité BASSE comme le bloom. Mesuré : **+2 appels de dessin** (105 → 107). Le coût GPU n'a
PAS été mesuré, faute d'instrument valable (voir plus haut : la preview ne mesure pas un GPU) ; le
garde-fou existant continue de surveiller et peut descendre d'un cran.

Les deux constantes de la courbe (largeur de transition, rayon maximal) sont **interpolées depuis le
JS dans le shader** : `tiltBlurFactor` doit rendre exactement la même courbe pour les pilules, et
deux nombres recopiés à la main finissent toujours par diverger.

### Les pilules, et pourquoi ce n'est pas un détail

Les pilules des appareils vivent dans le **DOM**, hors du canvas : le flou de la chaîne d'image ne
les atteint pas. Laissées intactes au-dessus d'une maison floutée, elles cassent l'illusion de
maquette ; effacées, la scène perd ses noms. Plutôt que de trancher, elles suivent la même courbe que
le flou d'un montant réglable (`tiltPills`), lu à la place de la pilule PROJETÉE plutôt qu'en
fouillant le `transform` que `CSS2DRenderer` vient d'écrire — une chaîne à re-parser à chaque image,
et un détail d'implémentation de three. Mesuré dans l'application : bande centrale à 1, haut de
l'image entre 0,63 et 0,83, bas à 0,25 (le plancher du préréglage « Maquette »).

L'extinction rend leur netteté à TOUTES : c'est le chemin de retour, celui qu'on oublie.

### Aucun style ne porte l'effet

`PostLook.tiltShift` est facultatif et absent partout : le tilt-shift naît dans le banc de réglage et
nulle part ailleurs, parce que c'est un goût et non une propriété de la lumière. Éteint, la clé n'est
pas `null` mais **absente** — c'est ce qui garde littéralement vraie la promesse du réglage neutre
(le look du style, à l'identique), et le test de cette promesse a attrapé la première version, qui
posait un `null`.

Deux préréglages en usent : « Cinéma » discrètement (le flou d'un objectif ouvert), « Maquette »
franchement (bande étroite, pilules qui suivent).

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

### Mise à jour 2026-09-18 (7) — un ouvrant lié épouse sa baie, pilule comprise ; et son tablier prend vantaux, matière et teinte

**La pilule était à côté.** Le tablier d'un volet lié se dessine sur le rectangle de son ouverture
depuis toujours, mais son marqueur — donc sa pilule, son clic, et le cadrage caméra — restait à la
`position` du JSON, posée une fois par l'auto-placement puis figée pendant qu'on affinait la baie au
doigt. Mesuré sur la vraie maison : **plus de 2 m** d'écart pour un volet. `effectivePosition`
(`HouseScene.ts`) rend maintenant `openingCentre(rect)` dès qu'un appareil porte un `openingId`, et
ne retombe sur la `position` que si l'ouverture n'existe plus. Ce qu'on voit et ce qu'on touche
partent du même point, et `focusDevice` cadre la fenêtre. `updateOpenings` refait déjà les marqueurs
des ouvertures qui bougent : la pilule suit le doigt.

**Le tablier se refend.** `CoverMarker` monte un panneau par vantail (`coverLeaves`, 1 ou 2), jeu de
2 cm entre eux, l'ensemble occupant 98 % de la largeur de la baie (`SLAT_INSET` — il coulisse DANS
l'embrasure, pas dessus). Les vantaux ne changent QUE le dessin : la course reste verticale, c'est
elle que l'état publie. Un volet battant se lit à son refend ; il ne s'ouvre pas en tournant.

**Matière et teinte.** `joineryMaterial` gagne un troisième rôle, `slat` (`builders/materials.ts`) :
même mécanique que les menuiseries d'une baie, donc même cache — dix volets blancs partagent un
matériau, et un changement de style ou d'heure les rattrape tous. Sans matière ni couleur demandée,
l'ouvrant garde le matériau de la scène (`mats.slat` pour un volet lié, `mats.device` pour un ouvrant
libre) : une maison relevée hier ne change pas d'aspect parce que ces réglages existent. Deux
matières font plus que teinter :

- **verre** — panneau translucide (opacité 0,45) qui cesse de porter une ombre pleine, comme le
  vitrage d'une baie : c'est ce qu'est une porte de garage vitrée ;
- **tissu** — la matière la plus mate du jeu (rugosité 1, aucun reflet) ; sans teinte choisie, le mur
  du style éclairci de 30 %, un écru de toile.

**L'aperçu de teinte** emprunte le canal déjà posé pour les carrosseries (`house.previewBodyColor` →
`HouseScene.previewColor` → marqueur) : `CoverMarker.previewColor` se DÉTACHE du matériau partagé au
premier survol — le peindre tacherait tous les volets de la maison — et rend la teinte d'avant si le
choix est abandonné.

**Une baie habillée ne dessine plus son propre vantail.** `details.ts` pose un panneau plein pour une
porte ou un garage ; quand un ouvrant habille cette ouverture, c'est LUI le panneau, et lui qui
l'ouvre. Les deux se superposaient : une porte de garage remontée laissait derrière elle le vantail
fixe du bâti, et la baie n'était jamais vide. `HouseScene.dressedOpenings` recense les ouvertures que
couvre un ouvrant (un ouvrant SEUL : un capteur d'ouverture épouse lui aussi le rectangle de sa
fenêtre, mais il ne la ferme pas) et le passe à `buildHouse` / `buildLevel` / `buildDetails`. Le
DORMANT et le VITRAGE, eux, restent au bâti : un volet ne retire ni le cadre ni la vitre de la
fenêtre qu'il couvre.

L'ensemble se recalcule quand on lie ou délie (`updateDevices`) **et à l'arrivée des descripteurs**
(`setDescriptors`) : le kind d'un appareil vient de son descripteur, qui arrive parfois après la
maison — sans ce second appel, le vantail serait resté jusqu'au prochain chargement complet. Les
murs ne sont refaits que si l'ensemble a VRAIMENT changé, ce qui n'arrive à aucun autre geste.

### Mise à jour 2026-09-18 (8) — l'eau de la piscine bouge, et ce qu'on paie pour ça

Demande : « pour la piscine, possible de faire en sorte que la surface de l'eau ne soit pas
statique ? un shader (ex https://www.shadertoy.com/view/MdlXz8) ? ». Le bassin était bâti depuis le
2026-09-15 (voir « La piscine est un bassin ») mais sa surface restait une TEXTURE figée : le rôle
procédural `water` peint un réseau de caustiques une fois pour toutes, ce qui ne trompe personne dès
qu'on s'approche.

**Deux gestes, sur les deux matériaux du bassin** (`three/effects/water.ts`), injectés dans le
shader standard de three par `onBeforeCompile` :

- la **surface** (`zones.pool`) ondule : trois trains d'ondes directionnels croisés donnent la PENTE
  de la houle (le gradient, pas la hauteur), qui incline la normale. Aucun sommet ne bouge — c'est la
  normale qui ment. Conséquence visible : le reflet du ciel et le point brillant du soleil se
  déplacent, puisque la normale sert aussi à la carte d'environnement ;
- le **fond et les parois** (`poolBasin`) reçoivent les **caustiques** en lumière AJOUTÉE
  (`totalEmissiveRadiance`, donc elles traversent la chaîne d'image comme le reste), pondérées par
  l'horizontalité de la normale ramenée au monde : le fond en reçoit tout, les parois presque rien.
  C'est ce second geste qui fait « vraie eau » — une surface qui scintille sur un fond mort ne suffit
  pas.

Points d'injection : `#include <common>` pour les déclarations et la varying de position monde,
`#include <project_vertex>` pour la remplir, et `#include <emissivemap_fragment>` pour les deux
effets — la normale y est posée (cartes comprises) et `lights_fragment_begin`, qui la lira comme
`geometryNormal`, n'est pas encore passé. `customProgramCacheKey` est OBLIGATOIRE : sans clé propre,
three réutiliserait le programme d'un matériau standard aux mêmes réglages, et l'eau serait rendue
par un shader qui n'a jamais reçu le patch. Le patch survit aux changements de style parce que
`applyLook` MUTE les mêmes matériaux au lieu de les recréer.

**Licence.** Le principe des caustiques (replier une interférence sur ses crêtes) est celui des
shaders d'eau de Shadertoy, dont celui cité par l'utilisateur ; les lignes sont écrites ici. Les
shaders y sont publiés en CC BY-NC-SA par défaut, licence qui n'a rien à faire dans ce dépôt.

**Ce que ça coûte n'est PAS le shader.** Quelques dizaines d'instructions sur les pixels de la
piscine, c'est-à-dire rien. Le coût est la BOUCLE : une eau animée la fait tourner, donc toute la
scène se redessine (deux passes, ~280 appels, chaîne d'effets, étiquettes déplacées) — le même
raisonnement que la pluie. D'où trois conditions dans `HouseScene.syncWater`, dans cet ordre de
gratuité :

1. le **style** veut de l'eau vivante — `SurfaceLook.flow`, lu pour la seule piscine, défaut 1 ;
   `maquette` la met à 0, une maquette a de l'eau en résine coulée ;
2. la **qualité** n'est pas basse — même règle que la précipitation ;
3. une **piscine est dans le tronc de projection** — réévalué à chaque `change` des contrôles, donc
   à chaque mouvement de caméra : un jardin qu'on ne regarde plus ne coûte rien. Le test emploie la
   matrice LOCALE de la racine, qui est sa matrice monde ici (elle pend à l'origine de la scène, et
   `matrixWorldAutoUpdate` est coupé — voir le piège des matrices monde plus haut).

La force de chaque matériau est un uniforme réglé à part : celle du fond suit le jour
(`0,25 + 0,75 × dayFactor`), sans quoi un bassin s'allumerait tout seul à minuit ; la houle, elle,
ondule aussi sous la lune.

**Et à 10 Hz, pas 20.** Une houle de piscine avance lentement. `Animation.hz` (`core/renderLoop.ts`)
rend sa cadence à chaque animation, la PLUS RAPIDE des animations en cours donnant le tempo — une
image redessinée les sert toutes, donc une averse en cours ramène l'eau à 20 Hz sans rien coûter de
plus.

**Si ça rame** (le goulot GPU connu — Chrome sur le GPU intégré, ~93 ms par image en « high » —
laisse peu de marge à dix images par seconde) : la porte suivante est de remplacer « la piscine est
dans le champ » par « la piscine OCCUPE une part minimale de l'écran ». Une piscine large de quinze
pixels n'ondule pour personne. Mesure : projeter le centre de sa sphère englobante et ce même centre
décalé du rayon le long de l'axe HAUT de la caméra (`setFromMatrixColumn(camera.matrixWorld, 1)`),
puis comparer l'écart en y NDC ramené à la hauteur de vue (`|Δy| / 2` = rayon en part de hauteur
d'écran) à un seuil de l'ordre de 0,05 ; un centre derrière la caméra (`z > 1` après `project`) vaut
« visible », la piscine remplit alors la vue. Écarté à la première écriture pour ne pas figer l'eau
dans la vue d'ensemble sans que l'utilisateur l'ait demandé.

**Test qui compte** : `three.test.ts › eau vivante` compile le patch contre le vrai
`ShaderLib.physical` et vérifie que les points d'injection EXISTENT encore. Le jour où une version de
three en déplace un, `String.replace` ne trouverait plus sa cible et échouerait en silence : eau
figée, aucune erreur. Le second test vérifie les trois portes, caméra détournée du jardin comprise.

> **Remplacé en partie le 2026-09-24** (voir la mise à jour suivante) : la houle n'a plus trois
> ondes mais une vingtaine, et les caustiques ne sont plus une interférence repliée ajoutée en
> émissive (`totalEmissiveRadiance`, pondérée par l'horizontalité) mais une carte calculée par
> réfraction qui MODULE la lumière directe. Les trois portes de `syncWater`, les 10 Hz, la clé de
> programme et la force du fond `0,25 + 0,75 × dayFactor` restent valables.

### Mise à jour 2026-09-24 — l'eau réfracte le soleil : caustiques calculées, absorption, Fresnel

Constat : trois ondes analytiques et des caustiques procédurales dessinaient un réseau régulier,
qui se lisait comme un motif et non comme de l'eau. Un premier essai à huit ondes posées à la main
restait trop régulier (retour de l'utilisateur). Source de vérité : `apps/web/src/three/effects/water.ts`,
dont les commentaires sont détaillés ; branchement dans `HouseScene.ts` (`syncWater`, `render`,
`dispose`) et `builders/buildHouse.ts` (attribut de profondeur). Non commité à la date de l'écriture.

**Écarté : reprendre clearwater tel quel.** github.com/Aureliengmz/clearwater (MIT) est une démo
WebGL2 autonome : FFT de Tessendorf en plusieurs passes, post-traitement propre, pensée pour une
houle d'OCÉAN. Rien de cela ne s'insère dans notre chaîne d'image ni ne convient à un bassin de
1,5 m. On en a pris les idées — et la méthode de caustiques de *WebGL Water* d'Evan Wallace (MIT),
que clearwater reprend ; les lignes sont réécrites.

**La houle** (`drawWaves`) : ~20 ondes TIRÉES par un PRNG à graine fixe (la même eau à chaque
chargement), longueurs de 25 cm à 2,5 m réparties en logarithme, deux tiers groupés autour d'un
vent (±70°), un tiers en clapot libre, phases au hasard (sinon toutes les crêtes se croisent à
l'origine). Ce qui concentre la lumière est la COURBURE `A·k²` : ~0,6 par onde, ce sont leurs
rencontres qui dessinent le réseau (il en faut ~3 pour une ligne nette à 1,4 m de fond).
Amplitude plafonnée à 1,2 cm, pulsation `0,3 · √(g·k)` (dispersion des ondes de gravité,
ralentie). Chaque vecteur d'onde est arrondi sur la grille d'une tuile de 5 m : le motif est
périodique et la carte se répète sans couture. Dans le shader de la surface, une onde plus courte
que quelques pixels au sol (`fwidth`) s'efface au lieu de scintiller ; la passe des caustiques, elle,
les garde toutes.

**1. Caustiques par réfraction** (`WaterCaustics`). Une grille 256² de la tuile est déviée par la
pente de la houle (`refract`, eau d'indice 1,333) jusqu'au fond à 1,38 m (`POOL_DEPTH − POOL_WATER_DROP`,
1,5 − 0,12) ; l'intensité est le rapport des aires d'une maille avant / après (`dFdx` / `dFdy`), et
le mélange additif somme les mailles repliées. La grille est instanciée 3 × 3 (`gl_InstanceID`) pour
qu'un rayon dévié hors de la tuile retombe chez la voisine. Cible 512 × 512 en 8 bits, mipmaps,
répétition : l'intensité vaut 1 en moyenne et monte à ~4 sur les lignes, elle est donc stockée au
QUART et remultipliée par 4 à la lecture. La carte est redessinée dans `HouseScene.render` AVANT
l'image, et seulement si le temps de l'eau ou la lumière ont changé depuis. Sans renderer
(headless, tests), pas de `WaterCaustics` : l'uniforme reste `null`.

Changement de nature : les caustiques ne sont plus de la lumière AJOUTÉE, elles MODULENT
`reflectedLight.directDiffuse` (injecté après `lights_fragment_end`). Leur moyenne étant 1, le fond
n'est pas plus clair, il est tramé ; et comme elles ne redistribuent que le soleil direct, elles
s'éteignent seules à l'ombre et la nuit.

**2. Le soleil suivi** (`setWaterSun(u, sunDir)`, appelée dans `syncWater`). La lumière incidente
est tenue à 5° de hauteur au minimum (soleil couché compris), et son rayon réfracté par une eau
plane est calculé côté JS. La passe réfracte la lumière réelle : un soleil bas décale et étire le
réseau dans son axe. Un point de PAROI lit la carte à l'endroit où son rayon aurait fini au fond
(prolongé dans l'axe réfracté) : la paroi face au soleil reçoit le réseau, celle qui lui tourne le
dos non. Poids `sqrt(profondeur / 1,38 m)` : près de la surface, la houle n'a pas encore concentré
la lumière.

**3. Absorption par la profondeur.** `buildHouse` pose sur la géométrie du bassin un attribut de
sommet `waterDepth` (`WATER_DEPTH_ATTRIBUTE` : profondeur sous la lame, en mètres). Chemin de la
lumière = profondeur × (1 + 1 / cos du regard), borné ; transmission `exp(−σ · chemin)` avec
`σ = −ln(teinte) × 0,3 /m` (`setWaterTint`, teinte = `theme.zones.pool` du style) ; ce qui est
absorbé est remplacé par la teinte de l'eau à la mesure de la luminance locale. Injecté juste avant
`#include <opaque_fragment>`. D'où le bleu qui fonce avec la profondeur et quand le regard rase.

**4. Fresnel sur la surface** (F₀ = 0,02, celui de l'eau) : `alpha = mix(opacité × 0,55, 1, F)` —
transparente vue d'en haut, miroir en rasant.

Les uniformes sont désormais partagés par un seul objet, `createWaterUniforms()` (`time`,
`caustics`, `tint`, `sigma`, `light`, `refracted`), que `makeWaterAlive(mat, role, water)` reçoit à
la place de l'ancien `{ value }` de temps.

**Coût mesuré le 2026-09-24** (Chrome à part piloté par CDP, GPU dédié, sur secteur, qualité
« high », vue cadrée sur la piscine) : passe de caustiques ≈ 0,5 ms en médiane ; image complète
≈ 17 ms avec ou sans la passe, écart dans le bruit. Non mesuré sur le GPU intégré du goulot
connu (93 ms par image).

**Limites connues.**
- Pas d'ombre de margelle dans le bassin : le terrain ne projette pas d'ombre dans le trou.
- Le style `maquette` (`flow` 0) reste figé, et sans caustiques (force du fond à 0).
- Le Fresnel se voit peu : la caméra ne rase jamais la surface.

**Test** : `three.test.ts › eau vivante` vérifie désormais `waterFresnel` sur la surface, les
uniformes partagés du bassin (`uWaterCaustics`, `uWaterRefracted`), la varying `vWaterDepth`, la
modulation de `directDiffuse` et l'absorption placée AVANT `opaque_fragment` (et absente de la
surface).

### Mise à jour 2026-09-18 (9) — les places de stationnement : l'engin se range, et on les pose au sol

Le format des places est dans `../2_maison/2_0_format-house-json.md` (`site.parkings[]`) ; ici, ce
que la scène en fait — et elle en fait trois choses : elle RANGE, elle DESSINE, elle laisse POSER.

**1. Ranger.** `computeParkingFixes()` tourne avec les marqueurs (`buildMarkers`) et rend, pour chaque
engin placé par son GPS, la place où il se met (`assignParkings`, partagé). Deux points d'application :

- `effectivePosition` — le point du relevé (`gpsPoint`, inchangé : projection + `gpsOffset`) est
  REMPLACÉ par le centre de la place. Le `z` reste celui du relevé : une place ne décolle pas du sol.
- `vehicleYaw` — la place passe **avant** tout ce qui se déduit, juste après le `yaw` écrit à la main.
  Le `yawOffset` ne s'y ajoute pas : il corrige une déduction, or il n'y a plus rien à corriger, le
  sens de la place a été posé en regardant la scène.

Un appareil qui a une `position` écrite n'est jamais candidat : sa place fait foi, comme partout
ailleurs.

**`vehicleFix`** — la signature qui décide de refaire les marqueurs — porte désormais aussi le
REPOS (`atRest`) : une voiture qui se gare, une tondeuse qui rentre à sa base changent d'état sans
changer de point au mètre près, et c'est la reconstruction qui applique la place.

**Le cas de la tondeuse a demandé un crochet.** Son marqueur SUIT sa position publiée sans être
reconstruit (voir plus haut) : entre deux reconstructions, chaque relevé l'aurait fait dériver de sa
base, alors qu'elle est à l'arrêt dessus. `MarkerContext.parkedAt(state)` rend donc la place de
l'engin (centre et cap) quand la scène le juge au repos, `null` sinon ; `MowerMarker` vise ce point
et prend ce cap, au lieu de s'orienter sur sa direction de déplacement.

**2. Dessiner** (`builders/parking.ts`). Deux dessins, parce que ce sont deux objets — c'est
`accepts` qui tranche :

- une **place de voiture** est une PEINTURE au sol : contour en tirets fins, côté avant PLEIN (c'est
  ce qui distingue l'avant de l'arrière sans écrire une flèche), et un « P » posé à l'arrière. Le
  « P » est une texture de canevas et non une police 3D : une lettre est une image ici, elle ne porte
  ni volume ni ombre, et charger une police pour un caractère coûterait plus cher que la place ;
- une **base de robot** est un OBJET : une plaque au sol et un bloc de tête, comme une base de robot
  aspirateur. Un marquage au sol ne dirait pas qu'il y a quelque chose là où le robot se recharge.

La peinture **ne suit pas le thème de l'app** : elle est blanche, comme le toit et la pelouse gardent
leur couleur de matière. Essayé d'abord avec `theme.onSurface` — juste en thème sombre (du blanc),
faux en thème clair : un trait anthracite sur le béton, qu'aucun parking ne porte.

Où poser le marquage : dans les MARQUEURS du niveau de la pièce qui porte la place (un garage), sur
`DECOR_LAYER` — sinon la passe de ce niveau redessine son sol par-dessus et le marquage disparaît,
le piège déjà rencontré avec les poignées d'ouverture (`core/layers.ts`). Dehors, c'est du sol comme
un autre : dans le groupe du site, dessiné par la passe globale avec le terrain.

**3. Poser et régler.** Le geste est celui des ouvertures, au sol — c'est ce que l'utilisateur a
demandé (« comme la pose d'une ouverture, avec les cotes sur les 4 côtés, sauf qu'on fait ça au
sol ») — et il réutilise le même mode édition (`settings.houseEditing`, qui ne s'appelle donc plus
« Régler les ouvertures » mais « Régler la maison ») :

- `setEditingParkings(on)` ajoute à chaque place un voile touchable et un cadre, par simple échange
  de MATÉRIAU : trois états (rien, une place, celle qu'on règle), rien qui se construise ou se
  détruise en sélectionnant. Le marquage, lui, vit en permanence — ce n'est pas une poignée ;
- `setPlacingParking(on)` arme le mode « poser » : le tap suivant rapporte le point du SOL touché
  (`groundTap`, distinct de `placeTap` qui vise un mur). Une place se pose à plat, il n'y a pas de
  règle d'admissibilité à appliquer — contrairement à une ouverture, qui doit trouver un mur ;
- `setSelectedParking(id)` arme le glissement, comme pour une ouverture : une seule place se déplace
  à la fois, et on ne l'attrape que par elle-même ;
- les quatre COTES (ce qui sépare la place du contour de son hôte, devant, derrière, à gauche, à
  droite) sont écrites dans la scène pendant le réglage : une étiquette DOM par côté, gardée d'une
  image à l'autre, et un trait de cote posé dans le groupe de la place — il tourne et glisse avec
  elle, sans un temps de retard.

**`updateParkings(house)`** est le chemin court, comme `updateOpenings` : régler une place ne doit
pas repasser par `load()`, qui recentre la caméra à chaque mouvement de doigt. Il refait le marquage,
recalcule qui se range où, et ne reconstruit QUE les marqueurs dont la place a changé — c'est ce qui
fait suivre la voiture pendant le geste sans refaire tous les autres marqueurs à chaque image.
`useHouseScene` l'aiguille par `sameShellButParkings`, jumeau de `sameShellButOpenings` (les places
vivent dans `site`, qui fait partie du « bâti » au sens de `sameShell`).

Vérifié par quatre tests de scène (`three.test.ts`, « places de stationnement ») : la voiture au
repos se pose au centre et prend le cap de la place, celle qui est trop loin ou qui ROULE garde son
relevé, le marquage existe en édition comme hors édition, et la voiture SUIT la place qu'on déplace.

Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/builders/parking.ts`,
`apps/web/src/three/markers/{DeviceMarker,markers}.ts`, `apps/web/src/composables/useHouseScene.ts`,
`packages/shared/src/house/parking.ts`, test `apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-19 — les places se lisent : un cône pour le sens, un « P » au milieu, et le trait plein derrière

Premier essai regardé dans la scène, quatre corrections — toutes de LECTURE, la mécanique
d'accrochage n'a pas bougé.

**Le sens ne se voyait pas.** Une place est un rectangle : posée, elle ne dit pas de quel côté l'engin
regarde, et le trait plein qui l'indique ne se remarque qu'une fois qu'on le cherche. Elle porte donc
maintenant le **cône « regarde vers »** du guide d'un appareil orientable (`DeviceMarker.setMoving`) :
même langage, même teinte d'accent, posé devant l'avant et dimensionné par la place — une base de
tondeuse de 80 cm ne porte pas la flèche d'un garage de 5 m. Il vit avec le cadre d'édition : allumé
quand on pose ou qu'on règle, éteint le reste du temps.

**Tout était à l'envers.** Le trait plein était à l'avant ; il passe à l'**arrière**, là où l'on
bute en reculant, et les tirets s'ouvrent devant. Le bloc d'une base de robot passe de même de l'autre
côté : un robot recule dans sa station, ses contacts sont derrière lui. Le « P », enfin, se lit
maintenant depuis l'AVANT de la place — comme celui d'un vrai parking, qu'on lit en arrivant dessus
(la lettre est dessinée retournée dans son canevas ; vérifié dans la scène, des deux côtés).

**Le « P » est passé au milieu, deux fois plus grand et deux fois plus pâle.** Dans un coin il se
confondait avec un tiret ; au centre il se lit d'un coup d'œil, et l'opacité le garde discret. Le
marquage entier a d'ailleurs baissé (0,46 → **0,26**) : c'est la demande, « plus discret encore ».

**Le cadrage d'une place ne descend plus sous le sol.** `focusParking` cadrait la boîte au plus
juste : pour une base de 60 cm, la caméra passait sous le terrain. La boîte est désormais au moins
celle d'un appareil (`DEVICE_FOCUS_SIZE_M`), et les grandes places gardent leur marge proportionnelle.

### Mise à jour 2026-09-19 (2) — le sol touché dit le NIVEAU de la place

`groundTap` ne rapporte plus seulement un point : il rapporte **le niveau de la surface touchée**
(sol de pièce, dalle de toit, terrain ou zone → `null` pour le jardin). C'est ce qui permet de poser
une place là où on la voit — dans le garage en tapant le sol du garage, sur le toit en tapant le toit
— sans rien choisir dans un menu.

Le `parkingParent` suit : c'est `levelId` qui décide du groupe et de l'altitude, plus la pièce sous le
point (cf. `../2_maison/2_0_format-house-json.md`). Une place sans niveau retombe sur l'ancien calcul,
donc rien de ce qui existait ne se déplace.

**Une place SÉLECTIONNÉE se montre même hors mode édition** (cadre, cône, cotes, glissement) : on
arrive maintenant depuis la vue Robots, qui arme la pose d'une base sans rien demander aux Réglages,
et une place qu'on vient de poser doit se voir et se régler tout de suite. Les autres places, elles,
n'ont leur cadre qu'en mode édition — la scène reste celle d'avant quand on ne règle rien.

Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/builders/parking.ts`,
`apps/web/src/composables/useHouseScene.ts`.

### Mise à jour 2026-09-19 — Velux et puits : cadre dans le plan, quatre cotes, trou de toit reconstruit

**Cadre** : une poignée de surface (`host: floor | roof`) bâtit son ring dans le plan XY du porteur.
Le `rotateX(π/2)` mural ne s'applique plus — sinon le cadre se dresse à la verticale sur un puits.

**Quatre cotes** : `refreshOpeningNotes` pose avant / arrière / gauche / droite (`surfaceGaps`),
traits compris, comme une place. Le panneau suit (`OpeningPanel`).

**Pose toit** : `setPlacingOpening({ roomId, type })` vise le maillage `roof` pour un
`roof-window` (pièce optionnelle, résolue au tap par polygone sous le point). Cône de cap pendant
la pose. `selectOpening` / `focusOpening` d'un Velux basculent sur le **niveau-toit**, pas sur
l'étage porteur — sinon le toit disparaît et la poignée semble au sol.

**Trou manquant après pose** : la géométrie calculait déjà `roof.holes`, mais `updateOpenings` ne
refaisait que les maillages de niveau. `rebuildRoof()` (`buildRoofMesh`) reconstruit le toit dès
qu'une `roof-window` change.

Sources : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/builders/buildHouse.ts`,
`packages/shared/src/house/openings.ts`.

### Mise à jour 2026-09-21 — plafonnier-ventilateur 3D

Quand `MarkerContext.linkedFan` (lumière avec un `fan` qui pointe `meta.linkedTo` vers elle),
`LightMarker` remplace la sphère par un **hub cylindrique + globe + 3 pales**
(`ceiling-fan` / `ceiling-fan-blades`). `HouseScene` passe aussi `linkedFanId` ; à chaque
`updateStates`, si l'état du ventilateur change, `setCompanionFan` fait **tourner les pales**
(animation décorative ~20 Hz) tant que le fan est `on` / `available`. Pilule : icône `lightFan`
via le même flag.

Sources : `apps/web/src/three/markers/markers.ts` (`LightMarker`),
`apps/web/src/three/markers/DeviceMarker.ts`, `apps/web/src/three/HouseScene.ts`.

### Mise à jour 2026-09-24 — pales à la vitesse et au sens, flux d'air en anneaux

Le plafonnier-ventilateur (voir 2026-09-21) ne tourne plus à une vitesse fixe :

- **Vitesse** : `fanSpeedFraction` lit `state.speed` comme un RANG dans `meta.fan.speeds` du
  ventilateur lié (0 = la plus lente, 1 = la plus rapide ; liste 1-6 du CREATE par défaut, 0,5 si
  la vitesse est absente). `HouseScene` passe la liste par `MarkerContext.linkedFanSpeeds`. Les pales
  vont de **0,3 à 1 tr/s** (`FAN_TURNS_S`) — un vrai plafonnier monte vers 3 tr/s, mais la boucle
  anime à 20 Hz et trois pales se ressemblent tous les 120° : au-delà d'1 tr/s (18° par image),
  l'effet roue de charrette les fait tourner à l'envers à l'œil.
- **Sens** : `forward` tourne horaire vu d'en haut (Z négatif), c'est-à-dire trigonométrique vu
  d'en dessous = mode **été**, qui pousse l'air vers le bas ; `reverse` l'inverse. Correspondance
  **supposée** (convention courante des ventilateurs Tuya), **non vérifiée** sur le CREATE réel.
- Changer de vitesse ou de sens pendant que le ventilateur tourne ne relance pas d'animation : un
  seul créneau, qui lit `spinRadS` à chaque pas.

**Flux d'air** (`FanAirflow`, constantes `AIRFLOW`) : **trois anneaux plats** sous les pales, dans
la langue de l'onde sonore d'un lecteur (même `waveMaterial`, non directionnel). `forward` : ils
naissent au plan des pales et DESCENDENT en s'élargissant (0,32 → 0,85 m sur 1,3 m), en **bleu**
(frais) ; `reverse` : ils MONTENT vers les pales en se resserrant, en **rouge** (chaud ramené du
plafond). Chaque anneau naît et s'éteint en `sin(π·p)` ; période 4,5 → 1,8 s et opacité de crête
0,22 → 0,4 selon la vitesse ; la phase AVANCE au rythme courant, donc un changement de vitesse ne
fait pas sauter les anneaux. Couches `DECOR_LAYER` (`asDecor` sur chaque anneau).

Essai écarté le même jour : des **traînées de particules** (`Points`) en spirale. Illisibles d'abord
(point de 3 px à 9 m, halo `glowMap` au cœur trop petit), puis délavées en blanc par le mélange
additif sur un sol clair, et, une fois lisibles, **lues comme de la pluie** et trop marquées. Les
anneaux disent « de l'air qui circule » sans rien dessiner de matériel.

Sources : `apps/web/src/three/markers/markers.ts` (`FanAirflow`, `AIRFLOW`, `fanSpeedFraction`,
`LightMarker.setCompanionFan`), `apps/web/src/three/markers/DeviceMarker.ts`
(`linkedFanSpeeds`), `apps/web/src/three/HouseScene.ts`, test dans `apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-22 — pack photo : sol / herbe / bassin, et dalle TV dimensionnable

**Pack photo** (`textures/assets.ts`, `scripts/fetch-textures.mjs`, `SOURCES.md`) :

- `tile` → **Tiles107** (carreaux blancs clairs, `tileM` 4,8 m = 8 × 60 cm) — Tiles133A puis
  Tiles052 écartés (trop fins / trop sombres).
- Rôle neuf **`poolTile`** → Tiles133A (`tileM` 1,2 m) : le bassin garde la faïence fine ; le sol
  maison ne la partage plus. `applyLook` pose `poolTile` sur `poolBasin` ; `HouseScene.applyMaterials`
  charge ce rôle même s'il n'est dans aucun look.
- `grass` → **Grass006** ; Grass004 archivée sous `photo/grass004/`.
- `wood` reste **WoodFloor051** (Planks033B essayé puis écarté, archivé sous `photo/wood033b/`).

**TV en 3D** : `GenericMarker` lit `coverSize` / `HouseDevice.size` pour une TV (largeur × hauteur
de dalle, défaut 45″ 16:9). La pochette suit. Voir aussi `../4_ui/4_1_navigation-et-panneaux.md`
(diagonale en pouces) et `../2_maison/2_0_format-house-json.md` (`size`).

Sources : `apps/web/src/three/textures/{assets,procedural}.ts`,
`apps/web/src/three/builders/materials.ts`, `apps/web/src/three/HouseScene.ts`,
`apps/web/src/three/markers/markers.ts`, `apps/web/src/lib/orientation.ts`,
`scripts/fetch-textures.mjs`, `apps/web/public/assets/textures/photo/SOURCES.md`.

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

### Mise à jour 2026-09-22 (ter) — silhouettes d'enceinte (`speakerShape`)

`GenericMarker` ne dessine plus toute enceinte en cylindre fixe. `HouseDevice.speakerShape`
choisit la géométrie (`../2_maison/2_0_format-house-json.md`) :

| Valeur | Forme (repère marqueur Z-up) |
|--------|------------------------------|
| `default` (absent) | cylindre debout `r=0,13` `h=0,32` |
| `pebble` | cylindre court `r≈0,14` `h≈0,1` (galet) |
| `bar` | boîte `0,55 × 0,08 × 0,07`, **yaw** appliqué |
| `block` | petit bloc `0,14 × 0,08 × 0,10`, **yaw** appliqué (réveil) |

`setLift` / `position.z` calés pour que la pilule reste juste au-dessus. L'onde sonore est
inchangée. Remplace, pour les enceintes, la phrase « le cylindre d'une enceinte n'en a pas
besoin » (mise à jour 2026-09-09) : barre et bloc suivent le `yaw` ; tube et galet non.

Sources : `apps/web/src/three/markers/markers.ts`, `apps/web/src/lib/orientation.ts`.

### Mise à jour 2026-09-22 (quater) — mangeoire / fontaine : tours, pas des boules

`pet_feeder` et `pet_fountain` tombaient dans le repli `SphereGeometry` de `GenericMarker`
(comme un capteur). Ils ont maintenant une boîte au sol `0,12 × 0,12 × 0,20` (`PET_BOX`) —
un peu plus haute que large — avec `position.z = h/2` pour ne pas s'enterrer à moitié.

Sources : `apps/web/src/three/markers/markers.ts`, test dans `three.test.ts`.

### Mise à jour 2026-09-23 — le calcul du soleil déménage dans `@kasbah/shared`

`sunPosition` et `approximateSunPosition` (section « Le soleil se calcule ») vivent désormais dans
`packages/shared/src/house/sun.ts` : le serveur en a besoin pour les automatisations au lever, au
coucher et au crépuscule. `apps/web/src/three/core/sun.ts` n'est plus qu'un ré-export ; la scène n'a
rien changé. Le module partagé gagne `sunTimes(day, lat, lon)` (heures de passage du jour local).
Détail : `1_8_automatisations.md`.

Sources : `packages/shared/src/house/sun.ts`, `apps/web/src/three/core/sun.ts`.

### Mise à jour 2026-09-25 — une seule passe : la lampe reste à son niveau par le SHADER

**Constat de l'utilisateur** : la vue 3D rame alors que des scènes Three bien plus chargées tournent ;
« faire des passes par étage me semble bizarre » ; et parfois l'ombre d'un étage masqué reste sur le
niveau qu'on explore. Cible désormais explicite : **l'iGPU, portable en mode éco** — la tablette
n'aura pas de GPU dédié.

**Mesuré** (Chrome à part forcé sur le GPU intégré, banc `_generated-ai-doc/perf/kasbah-passes.mjs`, qui
chronomètre chaque passe par `EXT_disjoint_timer_query_webgl2` et profile le CPU par CDP) : 22,5 ms
de CPU par image, dont **~14 ms dans `setProgram` / `getProgram` de three**. D'une passe à l'autre,
l'ensemble des lumières visibles changeait (aucune lampe dans la passe globale, celles du niveau dans
la sienne) : three réévaluait le programme de CHAQUE matière à chaque passe. Côté GPU, les trois passes
de niveau coûtaient ~9,5 ms, deux fois la passe globale. Passes coupées : 10 ms de CPU.

**Ce qui remplace le rendu en passes** (`apps/web/src/three/core/levelLight.ts`) :
- `HouseScene.renderScene` fait **un seul** `render()`, lampes comprises ; `LAMP_LAYER` disparaît
  (les lampes sont sur la couche commune, `core/layers.ts` n'a plus que les deux couches de décor).
- La boucle des lumières ponctuelles de toute matière éclairée reçoit un **test de hauteur** : les
  élévations MONDE des niveaux (`setLevelHeights`, reposées à chaque image) découpent des tranches, et
  une lampe ne compte pour un pixel que s'ils sont dans la même. La hauteur monde se lit depuis la
  position vue (`dot(viewMatrix[1].xyz, p - viewMatrix[3].xyz)`), sans varying. Le dessus d'une dalle
  est relevé de 5 mm pour tomber dans le niveau qu'elle porte ; son dessous reste le plafond du niveau
  d'en dessous (plus juste qu'avant : la passe de l'étage éclairait le dessous de sa propre dalle).
- Une lampe masquée ou éteinte **ne calcule rien** (`if ( directLight.visible ) RE_Direct(...)`).
  Mesuré : allumer des lampes ne change pas le coût de la scène (4,9 ms).
- Les lampes de **jardin** échappent au test : elles portent une ombre, et three range les lumières
  qui en portent en tête de liste (`UNROLLED_LOOP_INDEX >= NUM_POINT_LIGHT_SHADOWS`).
- Le patch est posé sur `Material.prototype.onBeforeCompile` : les matières créées à la volée par les
  marqueurs le reçoivent sans rien faire. L'eau, qui a son propre `onBeforeCompile`, appelle
  `applyLevelLight` elle-même (`effects/water.ts`).
- `userData.noLamps` (terrain, zones, toits, eau — `builders/materials.ts`) : ces surfaces sont à la
  hauteur d'un niveau, une lampe du salon tacherait la pelouse à travers la façade. C'est ce que la
  passe de niveau obtenait en retirant sol, zones et toit.
- Restent vrais : une lampe éclaire encore à travers une cloison du même niveau ; un appareil du
  jardin à hauteur du rez-de-chaussée reçoit les lampes de ce niveau (déjà le cas avant).

**Le piège rencontré en route, et son correctif** : three compile un programme **par nombre de
lumières**. Masquer l'étage retirait ses lampes du compte ; la première visite du rez-de-chaussée
recompilait toutes les matières — **2,2 s d'image figée** sur l'iGPU (le rendu en passes l'évitait
sans le savoir : toutes ses variantes étaient compilées au chargement). `HouseScene.padLamps`, appelé
en fin d'`applyLevelFocus`, pose dans `lampPadding` autant de `PointLight` éteintes qu'il y a de
lampes masquées : le compte ne bouge plus, le changement de niveau prend 8 ms. Voir aussi
`../6_faq/6_1_pieges-runtime.md`.

**L'ombre de l'étage masqué** : `focusLevel` ne redemandait pas de relevé d'ombres ; la carte gardait
le plancher de l'étage caché. Il appelle désormais `invalidateShadows()`.

**Résultat, iGPU, vue d'ensemble, 1904×905** : CPU 22,5 → 8,4 ms, GPU 27 → ~18-20 ms, ~31 → ~45
images/s. Captures de nuit avant/après identiques (`_generated-ai-doc/perf/shots/`). Il reste la
chaîne d'effets : ~14 ms GPU sur ~19 (bloom, sortie, vignette, deux passes de tilt-shift).

`debugStats()` perd `passes` et `levelPasses` (le voile `SceneDebug.vue` perd sa ligne « passes »).

Sources : `apps/web/src/three/core/levelLight.ts`, `apps/web/src/three/HouseScene.ts` (`renderScene`,
`padLamps`, `focusLevel`), `apps/web/src/three/core/layers.ts`, `apps/web/src/three/builders/materials.ts`,
`apps/web/src/three/effects/water.ts`, `apps/web/src/three/markers/markers.ts`,
`apps/web/src/three/three.test.ts` (« une lampe n'éclaire que son niveau »).

### Mise à jour 2026-09-25 (bis) — la chaîne d'effets : le MSAA ne sert qu'à la scène

Après le passage à une passe, il restait ~14 ms de GPU sur ~19 dans la chaîne d'effets (iGPU, qualité
moyenne) — dont 2,8 ms pour une vignette, un shader d'une ligne. La cause : la cible MSAA passée à
`EffectComposer` était **clonée** pour son second tampon, si bien que chaque passe plein écran
(bloom, sortie, vignette, deux passes de tilt-shift) écrivait dans une cible multi-échantillonnée en
demi-flottant puis la résolvait. Tampons sans MSAA, mesuré à chaud : 22 → 7,7 ms.

Ce qui change (`apps/web/src/three/core/post.ts`) :
- le composer reçoit une cible **sans** MSAA ; `ScenePass` porte sa propre cible MSAA (les
  échantillons de la qualité), y dessine la scène, puis la **recopie** (résolue, sans mélange, alpha
  compris) dans le tampon du composer — 0,56 ms ;
- la vignette n'a plus de passe : `VignetteOutputPass` l'ajoute au shader de `OutputPass`, après la
  conversion sRGB comme avant ;
- le garde-fou descend d'un cran au-delà de **25 ms** médians (40 jusqu'ici, qui laissait tourner une
  machine à 25 images/s). Sur l'iGPU, « high » (29 ms) redescend donc en « medium ».

Le tilt-shift était déjà « à la demande » (éteint si le style n'en veut pas) ; le bloom calcule déjà
ses niveaux à demi-résolution — ni l'un ni l'autre n'a changé.

Résultat, iGPU, vue d'ensemble, 1904×905 : qualité moyenne 19-20 → **11,6 ms** de GPU, ~45 → **~63**
images/s ; « high » 39 → 28,6 ms. Au total de la journée : ~31 → ~63 images/s. Captures de nuit
identiques (`_generated-ai-doc/perf/shots/post-*.png`). Le premier poste est désormais le rendu de la
scène avec son MSAA 2× (~6 ms, ~3 sans) : un anticrénelage d'écran (FXAA/SMAA) serait la piste
suivante, au prix d'arêtes plus molles.

Sources : `apps/web/src/three/core/post.ts` (`ScenePass`, `VignetteOutputPass`, `FRAME_BUDGET_MS`).

### Mise à jour 2026-09-25 (ter) — la maison se prépare sous un voile : shaders précompilés, plan qui se dessine

**Pourquoi.** Au chargement, la première image compilait tous les shaders d'un bloc sur le fil
principal ; chaque matière photo arrivée ensuite recompilait la sienne. Mesuré sur l'iGPU (Chrome à
part, appels WebGL chronométrés) : **10,3 s** de compilation quand le cache de shaders de Chrome est
vide (profil neuf, ou après une mise à jour qui change un shader), **~1,45 s** ensuite — Chrome garde
les shaders compilés sur disque, par texte de shader ; aucun `localStorage` n'y peut rien, WebGL ne
donne pas accès aux binaires. Changer de page ne recompile rien : la vue Maison est sous
`<keep-alive>` (`App.vue`).

**`HouseScene.prepare`** (appelé en fin de `load`) publie ses étapes par l'événement `prepare`
(`'materials' | 'shaders' | 'frame'`, puis `null`) :
- **matières** : attend les images du pack photo (`packTexturesSettled`, avec leur compte ; plafond
  10 s) — chacune qui arrive change sa matière, donc son shader ;
- **shaders** : `renderer.compile(scene, camera)` en visant la cible de la chaîne d'effets
  (`PostPipeline.sceneTarget`, demi-flottant linéaire) — viser l'écran compilerait la variante « tone
  mapping + sRGB », que la scène n'utilise jamais ici. Puis `shadersReady` attend que les programmes
  soient prêts (`isReady()`, en parallèle quand le pilote a KHR_parallel_shader_compile ; plafond 30 s) ;
- **première image** : elle compile ce que `compile` ne voit pas (chaîne d'effets, relevé d'ombres).

Deux pièges, tous deux constatés (voir `../6_faq/6_1_pieges-runtime.md`) :
- **aucune image pendant la préparation** (`holdFrames`) : une seule image rendue avant la fin des
  compilations les fait toutes d'un bloc — 9 s figées à cache froid. Avec la retenue : ~1,4 s de fil
  principal bloqué au total, le reste en parallèle ;
- **pas `compileAsync`** : sa boucle d'attente lit `currentProgram.isReady()` sans garde ; une matière
  détruite pendant l'attente (marqueurs reconstruits à l'arrivée des descripteurs) la fait planter en
  silence, la promesse ne se résout jamais et le voile restait. `shadersReady` ignore les matières
  disparues.

Après la préparation, une orbite ne compile plus rien (27 programmes avant et après, mesuré).

**Le voile** (`apps/web/src/components/home/SceneLoader.vue`, posé par `HomeView`) :
- une **vue éclatée axonométrique** du vrai plan (pièces de `house.json`), vue du sud-est comme la vue
  d'ensemble : chaque niveau est une plaque, écartée de la précédente de plus que sa hauteur à l'écran
  pour ne jamais la recouvrir, reliée par des lignes de rappel aux coins de l'emprise. Les niveaux se
  tracent l'un après l'autre, chaque mur UNE fois (arêtes partagées dédoublonnées), dans l'ordre d'un
  balayage. Essais écartés le même jour : niveaux à leur vraie hauteur tracés ensemble (brouillard de
  traits), puis plan vu de dessus niveau par niveau (lisible, « moins stylé ») ;
- le trait est dans l'unité du plan : `vector-effect: non-scaling-stroke` calcule aussi le motif du
  tracé (`pathLength`) en pixels, et les murs sortaient en pointillés ;
- titre « Préparation de la maison… » et un sous-titre par étape (« Plan de la maison », « Matières ·
  n / total », « Compilation des shaders », « Première image ») ; le voile tient sa propre file et
  montre chaque étape au moins 1,3 s, fondus compris ;
- il reste au moins **1,5 cycle de dessin** (la maison remplace un dessin en mouvement, pas un plan
  figé), et ne part que quand la maison est prête ET la dernière étape lue (événement `settled`, un
  état et non un signal) ;
- au **premier** chargement, 3D, onglets de niveau, recherche et commandes de caméra partent masqués
  (`data-loading` sur `.home`, fondu à l'apparition) ; ensuite, une reconstruction ne rappelle le voile
  qu'au-delà de 250 ms. Le voile est transparent aux clics : le bouton d'apparence reste utilisable.
- en SVG/CSS, pas en three : un voile qui compilerait ses propres shaders arriverait trop tard. Mouvements
  réduits : dessin statique, aucune attente.

Mesuré, iGPU, cache froid : 8 à 11 s de voile à 80 %, 125 % et 150 % de zoom, cinq chargements sur cinq
aboutis ; cache chaud : ~5-7 s, bornés par les minimums d'animation.

Sources : `apps/web/src/three/HouseScene.ts` (`prepare`, `shadersReady`, `holdFrames`),
`apps/web/src/three/core/post.ts` (`sceneTarget`), `apps/web/src/three/textures/assets.ts`
(`packTexturesSettled`), `apps/web/src/composables/useHouseScene.ts` (`preparing`, `shown`),
`apps/web/src/views/HomeView.vue`, `apps/web/src/components/home/SceneLoader.vue` (+ test),
`apps/web/src/i18n/locales/*.json` (`scene.loading`).

### Mise à jour 2026-09-25 (quater) — les fenêtres d'une pièce éclairée s'allument la nuit

**Pourquoi.** Vue de dehors, une maison dont les lampes brûlent gardait des vitrages éteints : la
lumière de la lampe n'éclaire que les surfaces de son niveau (`core/levelLight.ts`), le verre ne la
montrait pas. Désormais le vitrage d'une pièce émet la couleur de ses lampes allumées, la nuit
seulement — en plein jour une fenêtre éclairée ne se voit pas. Arbre de travail non commité après
79dd21a.

**Un verre PAR PIÈCE.** `buildLevel` (`builders/buildHouse.ts`) clone `mats.glass` une fois par
`roomId` (Map pièce → clone) : allumer le salon ne doit pas allumer la cuisine, et un matériau partagé
l'aurait fait. Chaque vitrage porte `userData.roomId`, `userData.baseMaterial` (le `mats.glass`
partagé, qui sert de référence) et `userData.material` (son clone) — le même principe que les clones de
sols de `highlightRoom`. Les clones ne sont pas dans `materials.all`, donc `disposeObject3D` les libère
à chaque reconstruction (`core/dispose.ts`).

**`HouseScene.syncWindowGlow()`** :
- recopie d'abord dans chaque clone couleur, rugosité, métal, émissif et opacité du verre de base :
  le style (et l'émissif propre au verre d'`indigo`) reste la vérité, la lueur s'ajoute par-dessus ;
- pour chaque pièce ayant une lampe (`house.devices` avec `roomId`, état `light` `available` et `on`) :
  couleur moyenne des lampes pondérée par la luminosité (`xyToRgb` si `color`, sinon
  `mirekToRgb(colorTempMirek ?? 366)`, comme `LampMarker.color()` dans `markers/markers.ts`),
  `k` = luminosité MAX de la pièce ; émissif += couleur × `WINDOW_GLOW` (0,65) × k × `theme.night`,
  opacité tirée vers `WINDOW_LIT_OPACITY` (0,6) du même poids — un verre à 30 % n'émettrait que 30 % ;
- ne change qu'une couleur et une opacité : **aucune variante de programme** (rien à recompiler, cf.
  la préparation des shaders ci-dessus), **nombre de lumières inchangé**.

Appelé dans `load()` après `buildMarkers`, en fin d'`updateStates` quand un marqueur a changé (il
remplace alors le simple `invalidate`), dans `setAppearance` (style, et l'heure qui dit s'il fait
nuit), et après la reconstruction des niveaux d'`applyHouseEdit` (verres neufs).

**Réglage de `WINDOW_GLOW`, à l'œil sur la preview** : 0,9 saturait la fenêtre en blanc sous le bloom ;
0,45 ne l'accrochait plus. 0,65 retenu. Pas de mesure GPU publiée pour ce changement.

Test : `three.test.ts` › « fenêtres éclairées » (un verre par pièce ; salon allumé plus émissif et plus
opaque que la base ; cuisine voisine intacte ; retour exact à la base de jour).

**Correction 2026-09-25 — les puits de lumière ne s'allument pas.** Constaté en preview : quand le
plafonnier du salon s'allumait, le puits `puits-salon` faisait un **carré blanc au milieu de la pièce**
— un vitrage posé dans une DALLE est vu d'en haut, au cœur du plan, pas en façade. Désormais `buildLevel`
ne clone le verre et ne pose `userData.roomId` que si `o.host !== 'floor'` : un puits garde `mats.glass`
commun, que `syncWindowGlow` ne touche jamais. Les fenêtres de mur et de toit (`host === 'roof'`)
s'allument toujours. Test étendu : le puits porte le verre de base et reste moins opaque que la fenêtre
allumée du salon.

**Piste ouverte, non investiguée** : au chargement de la maison démo, la console montre des erreurs
`THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index 1 … index attribute`,
antérieures à ce changement. Même famille de message que le piège indexé / non indexé déjà documenté
(`../6_faq/6_0_pieges-outillage.md`, « `mergeGeometries` refuse une boîte et une extrusion ensemble »),
mais la cause de CELLE-CI n'est pas établie.

Sources : `apps/web/src/three/builders/buildHouse.ts` (`buildLevel`), `apps/web/src/three/HouseScene.ts`
(`syncWindowGlow`, `WINDOW_GLOW`, `WINDOW_LIT_OPACITY`), `apps/web/src/three/core/dispose.ts`,
`apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-25 (quinquies) — étalonnage colorimétrique par l'heure

**Pourquoi.** Au crépuscule, le style réaliste rendait une image gris-rosé : rien ne teintait
l'image finie. Un ÉTALONNAGE (le geste de l'étalonneur,
pas une lumière de plus) donne l'orangé du couchant et le bleu pâle de l'aube sans toucher à aucune
source. Arbre de travail non commité après 5a6de4a.

**`PostLook.grade?: GradeLook | null`** (`styles/types.ts`) : `lift`, `gamma`, `gain` (triplets r, g, b)
et `saturation`. En espace d'AFFICHAGE : `c = gain × (c + lift × (1 − c))`, puis `c = c^(1/gamma)`,
puis mélange avec la luminance Rec.709 selon `saturation`. Absent ou `null` = `NEUTRAL_GRADE`
(identité).

**Où.** Dans `VignetteOutputPass` (`core/post.ts`), après la conversion sRGB d'`OutputPass` et AVANT
la vignette. Quatre uniforms (`gradeLift`, `gradeInvGamma` — le gamma est passé INVERSÉ —,
`gradeGain`, `gradeSaturation`) réglés dans `setLook` : changer d'heure ou de
style ne change **aucun programme** (cohérent avec la précompilation des shaders ci-dessus).

**`hourGrade(a, strength = 1)`** (`styles/types.ts`) : `k = duskFactor(a) × (1 − 0,7 × cloudiness) ×
strength`, mélange de `NEUTRAL_GRADE` vers `DAWN_GRADE` si `sunAzimuthDeg < 180` (soleil à l'est :
froid, pâle, saturation 0,94), sinon `DUSK_GRADE` (gain 1,08 / 0,97 / 0,85, noirs légèrement violacés,
saturation 1,1). Neutre en plein jour et en pleine nuit (`duskFactor` nul) ; un ciel couvert le réduit
de 70 %, faute de soleil pour colorer.

**Qui l'emploie.** `realistic` (défaut) et `nature` seulement, `grade: hourGrade(a)`. Les styles
stylisés (cyberpunk, candy, haunted, indigo, maquette) gardent leur couleur.
`applyTuning` (`styles/tuning.ts`) transmet `grade`
tel quel, et la clé reste ABSENTE si le style n'en porte pas — la promesse du réglage neutre (le look
du style, à l'identique) tient toujours.

**Limite.** Sans chaîne de post-traitement (qualité `low` : `applyQuality` rend le tone mapping au
renderer, `HouseScene.ts`), il n'y a **pas d'étalonnage** : l'image du crépuscule y reste neutre.

**Vérifié.** `styles/tuning.test.ts` › « étalonnage de l'heure » (neutre jour et nuit ; gain rouge > 1
et bleu < 1 au couchant, l'inverse à l'aube ; atténué mais non annulé sous ciel couvert ; transmis tel
quel par le banc). Preview en réaliste au crépuscule, comparée à `strength` 0 : sans, gris-rosé ; avec,
orangé franc. **L'aube n'a pas été vérifiée à l'œil** ; les valeurs de `DAWN_GRADE` et `DUSK_GRADE`
n'ont pas de mesure publiée derrière elles, et aucun coût GPU n'a été relevé (trois opérations par
pixel dans une passe existante).

Sources : `apps/web/src/three/styles/types.ts` (`GradeLook`, `NEUTRAL_GRADE`, `hourGrade`),
`apps/web/src/three/core/post.ts` (`VignetteOutputPass`, `setLook`), `apps/web/src/three/styles/{realistic,nature,tuning}.ts`,
`apps/web/src/three/styles/tuning.test.ts`.

### Mise à jour 2026-09-25 (sexies) — un plafonnier pose sa lumière au sol

La `PointLight` d'une lampe éclaire tout autour d'elle, murs et plafond compris, mais ne dessine pas
la flaque qu'on voit sous une suspension. Une lampe d'intérieur (`!ctx.outdoor`) montée au plafond
(`device.mount === 'ceiling'`, plafonnier-ventilateur compris) gagne donc une **tache au sol**
(`lamp-pool`) : un carré de 2 × `POOL.radius` (1,3 m) en `MeshBasicMaterial` additif, texturé par
la même `glowMap()` que le halo (dégradé radial partagé), `depthWrite: false`, rangé en décor
(`asDecor` → `DECOR_LAYER`, donc hors du relevé d'occlusion).

- **Intensité et couleur** : opacité = k (luminosité) × `glow.opacity` du style × `POOL.opacity`
  (0,55) — la tache suit le jour et la nuit comme le halo et reste à peine visible de jour. Couleur
  = celle de la lampe (xy, sinon `colorTempMirek`). Invisible éteinte.
- **Hauteur** : le sol du niveau est à z local 0, la tache se pose à `POOL.lift` = 4 mm, sous le
  voile de la pièce sélectionnée (8 mm) et son trait (12 mm, `HouseScene.ts`). `onBeforeRender`
  recale `position.z = lift − object.position.z` puis appelle `updateMatrixWorld()` — le renderer
  calcule `modelViewMatrix` après ce rappel, la correction vaut donc pour l'image en cours. La tache
  suit ainsi la lampe même pendant un glissement.
- **Pourquoi pas une `SpotLight`** : aucune lumière n'est ajoutée. Leur nombre doit rester constant
  (`HouseScene.padLamps`, sinon variante de programme à compiler), et `core/levelLight.ts` ne sait
  confiner que des `PointLight`. La `PointLight` de la lampe reste en place.
- **Limite connue** : la tache n'est pas découpée par la pièce — une lampe contre un mur déborde
  chez le voisin.

Vérifié : test headless « un plafonnier pose une tache de lumière au sol… » (`three.test.ts` :
invisible éteinte, blanc froid à 153 mirek, z = 0,004 − 2,5, couche décor, une seule lumière dans
le marqueur, absente pour une lampe hors plafond et pour une lampe de jardin) ; preview de nuit au
RDC comparée à une opacité nulle : visible sans excès sur carrelage et parquet. Aucun coût GPU
relevé (un quad additif par plafonnier allumé).

Sources : `apps/web/src/three/markers/markers.ts` (`POOL`, `LightMarker`), `apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-25 (septies) — la brume basse de l'aube et de la nuit

La nappe qui couche sur le jardin à l'aube n'est pas le `Fog` de three : celui-ci ne dépend que de
la distance et noierait la maison vue d'en haut autant que l'horizon. `core/heightMist.ts` pose un
**brouillard de HAUTEUR** — densité d·exp(−(y − base)/H) — **intégré le long du rayon** caméra →
pixel en forme fermée : épaisseur optique d·L·H·(e(yc) − e(yf))/(yf − yc), et d·L·e(y) quand le
rayon est à plat ; la couleur est mêlée vers celle de la nappe par 1 − exp(−épaisseur). Un rayon qui
plonge sur la maison ne traverse la nappe que sur ses derniers mètres, un rayon rasant la traverse
sur toute sa longueur : **vue plongeante, maison nette ; vue rasante, lointain noyé**.

- **Injection** : derrière `#include <fog_fragment>`, avec un varying `kasbahMistView =
  mvPosition.xyz` posé derrière `fog_vertex`. Elle passe par le crochet
  `Material.prototype.onBeforeCompile` de `core/levelLight.ts` (toute matière le reçoit, y compris
  celles créées à la volée) et par l'`onBeforeCompile` propre de l'eau (`effects/water.ts`), qui
  appelle `applyHeightMist` comme elle appelle déjà `applyLevelLight`.
- **Uniforms PARTAGÉS** (`heightMistUniforms`, un seul objet pour toutes les matières) : changer
  d'heure ne recompile rien, et une densité 0 rend l'image à l'identique.
- **Seules les matières du DEHORS** (`userData.noLamps` : terrain, zones, eau, toit). Premier essai
  sur toutes : les sols des pièces sont à la hauteur du jardin, **la maison de poupée s'embrumait**.
  Le sol infini (`mats.ground`) n'en reçoit pas : il doit rester de la couleur du fond, sans bord.
- **Combien** (`mistAmount`) : 0 le jour et le soir ; 0,6 × (1 − `dayFactor`) la nuit ;
  `duskFactor` à l'aube, reconnue au soleil à l'EST (azimut < 180°) ; le vent la disperse
  au-delà de 10 km/h, nulle à 40 km/h. `MIST_DENSITY` 0,15 /m au sol, épaisseur caractéristique
  (`kasbahMistFalloff`) 1,2 m, base = `geometry.terrain.z`.
- **Couleur** (`HouseScene.applyMist`, appelé par `applySky` et par `load` — la nappe se pose sur le
  terrain neuf) : l'horizon du ciel grisé par la nébulosité (`backdropColor(overcastSky(…))`) mêlé à
  50 % au ciel d'en haut (`hemiSky` × `hemiIntensity` × `MIST_SKY_SHARE` 0,35) — une nappe un peu
  plus claire que le fond, qui se lit contre lui.
- S'applique à **tous les styles**. Le brouillard météo (`scene.fog`) reste à part et s'y ajoute.

Vérifié : deux tests « brume basse » (`three.test.ts` : dosage jour / nuit / aube / soir / vent ;
injection sur le terrain, uniform partagé, absente du sol de pièce et du sol infini) ; preview de
nuit en A/B densité 0 / 0,078 : pelouse et piscine se voilent légèrement, discrète depuis la vue
plongeante par défaut. **Aube non vérifiée à l'œil** : les modes fixes de l'ambiance n'offrent qu'un
crépuscule du soir.

Sources : `apps/web/src/three/core/heightMist.ts`, `apps/web/src/three/core/levelLight.ts`,
`apps/web/src/three/effects/water.ts`, `apps/web/src/three/HouseScene.ts` (`applyMist`),
`apps/web/src/three/three.test.ts`.

### Mise à jour 2026-09-25 (octies) — la météo forcée ne gèle plus l'image

Glisser le curseur de visibilité des Réglages (« Météo forcée ») figeait la vue 3D. Deux causes :

- **Le brouillard qui apparaît recompile tout.** `applySky` passait `scene.fog` de `null` à un `Fog`
  quand la visibilité descendait sous 5 km ; three compile une variante de programme avec et une sans
  brouillard, donc **toutes les matières** étaient recompilées : 2,1 s d'image figée mesurées.
  Désormais un `Fog` est **toujours posé**, rejeté à `NO_FOG_M` = 1e6 m (near = far) quand l'air est
  clair — au-delà du sol infini de 400 m —, et `applySky` n'en mute que couleur, `near` et `far`.
  Après : brouillard qui apparaît en 117 ms + 4 ms d'image ; pluie, neige, orage 50-80 ms ; nombre
  de programmes stable. Détail dans `../6_faq/6_1_pieges-runtime.md`.
- **Une ambiance par cran de curseur.** Chaque ambiance refait le ciel (~35 ms) ; `useHouseScene`
  applique donc `ambience` par `watchThrottled(…, { throttle: 100 })` au lieu de `watch` : 20 crans
  en rafale → 6 appels, la dernière valeur toujours appliquée.

Demandé puis **non fait** : un indicateur « en cours » et des contrôles désactivés pendant
l'application. La cause étant supprimée, à reprendre seulement si ça accroche encore.

Note sur la section du 2026-09-16 « la météo entre dans l'ambiance » : « `applySky` pose un `Fog` »
décrivait un brouillard créé à la demande (et `null` au-dessus de 5 km) ; depuis ce jour le `Fog` est
permanent et seules ses bornes suivent `fogDistance`, qui rend toujours `null` au-dessus de 5 km.

Sources : `apps/web/src/three/HouseScene.ts` (`applySky`, `NO_FOG_M`),
`apps/web/src/composables/useHouseScene.ts`.

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

### Mise à jour 2026-09-25 (decies) — une opacité par matière, « opaque par défaut »

Question de l'utilisateur : gérer la transparence **partout, par défaut**, pour de futurs effets.
Réponse retenue : **pas** `transparent: true` sur tout. Dans three ce n'est pas un réglage : la
matière change de file (tri arrière → avant **par objet**, mélange activé → surdessin, cher sur
iGPU), le tri se trompe sur les grands maillages fusionnés de la maison, une maison à 50 % montre
ses cloisons à travers ses façades (« rayons X »), le verre sort de la transmission (d'après le
thread principal), et le define `OPAQUE` fait un autre programme — la recompilation que les
sections (ter), (octies) et (nonies) ont chassée.

**Écarté aussi : l'`alphaHash` de three activé partout.** Il compare `diffuseColor.a`, alpha des
textures compris : les lames vitrées à 0,45 (`GLASS_SLAT`, `builders/materials.ts`) ou une
carrosserie GLTF dont la texture porte un canal alpha auraient été tramées sans qu'on le demande.

**Retenu : une opacité À NOUS** (`core/levelFade.ts`, réécrit). `materialOpacity(material)` rend
`{ value }`, rangé dans `material.userData.kasbahOpacity` — c'est l'uniform **même** du shader :
le changer ne recompile rien ; un clone reçoit le sien (recopie des `userData`). Injection **avant**
`#include <alphatest_fragment>` (et non plus derrière `clipping_planes_fragment`), par le crochet
prototype de `levelLight.ts` et l'`onBeforeCompile` de l'eau :
`kasbahA = kasbahOpacity × (visibilité du fondu si hauteur monde > kasbahFadeY)`, puis
- `#ifdef OPAQUE` → `discard` selon un **bruit en gradient entrelacé** (IGN, Jimenez 2014), stable
  à l'écran, sans motif ;
- sinon (verre, halos, déjà transparents) → `diffuseColor.a *= kasbahA`, un vrai fondu.

Le fondu des étages de la section (nonies) passe désormais par là : **la trame de Bayer 4×4 est
remplacée** par l'IGN (la limite « de près, un quadrillage fin » de (nonies) décrivait la Bayer ;
non revérifiée avec l'IGN). À 1 partout, rien n'est écarté, image identique. `materialOpacity`
n'a aujourd'hui **aucun appelant** hors tests : c'est la fondation des effets à venir.

**Mesures** (banc `kasbah-passes.mjs`, GPU intégré forcé, sur secteur, maison démo
6175) : A/B/A/B du `discard` du fondu tramé = 17,3* / 13,7 / 13,4 / 15,0 ms GPU → **aucun coût
mesurable**, bruit ± 1,5 ms. *Le **premier** passage d'une série sort toujours trop haut : alterner
A/B, ne jamais comparer un premier passage. Version opacité / IGN : un seul passage, 13–14,6 ms, dans
la fourchette (un écart < 1,5 ms n'est pas exclu). **Non mesuré** sur GPU de tablette à tuiles, où
`discard` a un coût propre. L'avertissement console `X4122` (compilateur D3D) est préexistant,
présent avec et sans ces changements.

**Vérifié** : test « chaque matière a son opacité, réglable sans recompiler, et un clone la
sienne » ; preview (thread principal) : façades et toit à 0,4 → intérieur visible, programmes 33 → 33.

Sources : `apps/web/src/three/core/levelFade.ts` (`materialOpacity`, `applyLevelFade`),
`apps/web/src/three/core/levelLight.ts`, `apps/web/src/three/effects/water.ts`,
`apps/web/src/three/three.test.ts` — arbre de travail non commité après f059001.

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

### Mise à jour 2026-09-25 (terdecies) — une demande de relevé d'ombres se compte aussi en IMAGES

**Symptôme** (capture de l'utilisateur, sa maison réelle) : RDC affiché après le voile de chargement,
étage masqué, mais une grande ombre de l'étage sur la pelouse.

**Cause, identifiée par lecture du code.** Depuis la section (decies), `invalidateShadows(ms)` n'ouvrait
qu'une **fenêtre de temps** (`shadowsDirtyUntil` = maintenant + 700 ms) et `renderScene` ne posait
`shadowMap.autoUpdate = true` que tant que `now <= shadowsDirtyUntil`. Or pendant la préparation
(section (ter)) **aucune image n'est dessinée** (`holdFrames`) et l'attente des shaders dure des
secondes : la fenêtre expirait sans une seule image. L'étage, masqué entre-temps — depuis la section
(nonies), la fin de son envol peut tomber pendant la compilation —, restait dans la carte d'ombre, et
plus rien ne demandait de la refaire.

**Correctif** (`HouseScene.ts`) :
- `invalidateShadows` pose aussi `shadowFramesPending = SHADOW_MIN_FRAMES` (2 ; le commentaire du code
  justifie le 2 par le filtrage VSM en deux passes) : les deux prochaines images **dessinées** refont
  les ombres, quel que soit le temps écoulé ; `renderScene` décrémente le compte ;
- la fin de l'envol (`onDone` de `liftTo`) redemande un relevé — l'appel du départ,
  `invalidateShadows(LEVEL_LIFT_MS + SHADOW_SETTLE_MS)`, reste ;
- ces images restent hors du garde-fou de qualité :
  `post.render(interactive && t0 > shadowsDirtyUntil && shadowFramesPending === 0)`.

**Vérifié** : test « focaliser un niveau redemande un relevé des ombres » étendu (après 60 s sans image,
la fenêtre a expiré mais `shadowFramesPending > 0`) ; 417 tests OK ; preview, maison démo chargée
sur `?level=rdc` : étage et toit masqués, pas d'ombre d'étage (d'après le thread principal).
**Non vérifié** : le défaut n'a pas été reproduit sur la maison démo avant correctif ; reste à
confirmer chez l'utilisateur, sur sa maison. Voir `../6_faq/6_1_pieges-runtime.md`.

Sources : `apps/web/src/three/HouseScene.ts` (`invalidateShadows`, `shadowFramesPending`,
`SHADOW_MIN_FRAMES`, `renderScene`, `liftTo`), `apps/web/src/three/three.test.ts` — arbre de travail
non commité après 5e2ef15.

### Mise à jour 2026-09-25 (quattuordecies) — styles revus, chauves-souris, tap sur un mur, ombre en fondu, isométrie en perspective étroite

Retours de l'utilisateur sur sa maison réelle (captures), traités dans la même session.

#### Styles
- **Candy, de jour** : image blanche et éblouissante (horizon du ciel à 1, soleil 2,4, ciel 1,3 sous
  un tone mapping `neutral`). Le jour descend : soleil `mix(1.1, 1.7, day)`, ciel
  `mix(1.3, 0.85, day)`, exposition 0,9, horizon pastel `[0.8, 0.8, 0.9]`. La nuit est inchangée
  (`styles/candy.ts`).
- **Maison hantée, de jour** : illisible (`dayFactor × 0.45`). Le jour monte à `× 0.8`, avec un ciel
  plus clair, plus de soleil et d'ambiante, moins d'occlusion et de vignette (`styles/haunted.ts`).
- **Nature = du bois** : bardage à clin sur les murs extérieurs, lambris, toit en bois, allées et
  terrasse en bois, palette brune (`styles/nature.ts`). Nouvelle matière procédurale **`siding`**
  (`textures/procedural.ts`) : 12 lames horizontales de 20 cm, l'ombre du clin en bas de chaque lame,
  un veinage étiré dans le sens de la lame. Le parquet (`wood`), à lames courtes décalées, se lisait
  comme de la **brique** sur une façade. Le pack photo n'a pas de `siding` : les murs restent
  procéduraux, donc teintés par la palette, même avec les matières photo.
- **Toits plats végétalisés** (nature) : `SurfaceLooks.roofFlat = grass` et une couleur de dalle
  `ScenePalette.roofFlat` (`#5f7a42`). Cette couleur est **toujours présente** : sans déclaration du
  style, c'est celle du toit (`mixPalette`). Voir le piège dans `../6_faq/6_1_pieges-runtime.md`.

#### Chauves-souris (`effects/bats.ts`)
Porté par un style, comme la pluie par la météo : `StyleLook.bats = { count, color }`. La maison
hantée en pose 12 la nuit, 3 le jour. Elles sont gris violacé la nuit (le noir se perdait sur le
jardin noir) et noires le jour.
- Chaque chauve-souris est faite de deux triangles qui battent (5 Hz). Toutes partagent une géométrie
  réécrite à chaque pas : un seul appel de dessin, aucune allocation par image.
- Elles tournent autour du centre de l'emprise, dans les deux sens, avec un rayon et une altitude qui
  ondulent. Elles ne portent pas d'ombre et restent en `MeshBasicMaterial`.
- `HouseScene.syncBats` / `removeBats` suivent `syncPrecipitation` : animation décorative à 20 Hz,
  coupée en qualité basse, refaite seulement si le nombre change, recolorée sinon.

#### Un tap sur un mur sélectionne la pièce
Le rayon de `pick` ignorait les murs : un tap sur une cloison tombait sur le sol de la pièce voisine,
derrière elle. Désormais, les murs des niveaux affichés (murs et détails, `nodes.walls`) arrêtent le
rayon. `roomOfWallHit` cherche d'abord la pièce **devant** la face vue, à 10 cm dans le sens de la
normale, ce qui départage les deux côtés d'une cloison. À défaut, il cherche **derrière**, jusqu'à 1 m
en arrière : une façade vue du jardin ouvre la pièce qu'elle ferme. Le dessus d'un mur, sans face
verticale, prend le côté caméra.
- Un appareil garde la priorité avec une marge de 5 cm (`WALL_PICK_TOLERANCE_M`) : une applique est
  collée à son mur.
- Le toit gagne s'il est plus proche que le mur.
- Tests : « tap sur un mur » (cloison vue des deux côtés, façade vue du jardin).

#### L'ombre de l'étage qui s'envole pâlit avec lui
`applyLevelFade` (`core/levelFade.ts`) s'applique aussi au `MeshDepthMaterial` de la passe d'ombre.
Ce shader n'a pas de brouillard : le crochet se fait sur `#include <project_vertex>` et
`#include <common>`. Le calcul de hauteur ne lit que `viewMatrix`, qui vaut celle du soleil dans ce
passage. L'étage perd la même part de pixels dans la carte d'ombre, et le flou VSM transforme cette
trame en une ombre qui pâlit. Avant, elle disparaissait d'un coup à l'arrivée.
- **Vérifié** : le programme `MeshDepthMaterial` compilé porte l'uniform `kasbahFadeVisibility` (preview).
- **Vérifié partiellement** : un fondu figé à 25 % éclaircit l'ombre sur la pelouse, mais la météo
  simulée changeait entre les captures.
- La transparence propre à une matière (`materialOpacity`) ne touche toujours pas les ombres.

#### L'isométrie passe en perspective à champ étroit
Remplace la section « L'isométrie : des rails, pas une caméra de plus » (2026-09-18 (6)).
- **Avant** : l'orthographique, aux angles imposés. **Depuis le 2026-09-25** : la caméra
  perspective, avec les mêmes rails (plongée `ISO_POLAR`, azimut en quarts de tour, rotation libre
  coupée) et un champ vertical de **`ISO_FOV_DEG` = 20°** au lieu de `BASE_FOV_DEG` = 38°.
- **Pourquoi** : mesuré, la projection orthographique n'était pas fausse (rapport du tronc égal à celui
  de l'écran, angles d'une vraie isométrie). Mais rien n'y rapetisse au loin, et l'œil lit la piscine
  du fond comme agrandie : une perspective inversée. Une piscine tournée de quelques degrés sur
  le nord vrai accentuait l'effet en paraissant cisaillée.
- **Ce qui se conserve** : `applyProjectionMode` relève la hauteur de monde montrée au point visé
  **avant** tout changement, pose le champ, puis recule la caméra pour montrer la même hauteur.
  L'orthographique se rapporte toujours au champ de base.
- **Bornes de la molette** : `applyControlLimits` les multiplie par `tan(19°) / tan(10°)` ≈ 1,95 en
  isométrie, soit 8 à 234 m au lieu de 4 à 120 m. Hors isométrie, les valeurs sont inchangées.
- **Conséquence connue** : la caméra est environ deux fois plus loin, donc un brouillard météo voile
  un peu plus la maison en isométrie.
- Tests : « l'isométrie verrouille la plongée… » (champ de 20°, même hauteur montrée à l'aller et au
  retour).

Sources : `apps/web/src/three/{HouseScene.ts, core/cameraFit.ts, core/levelFade.ts, effects/bats.ts,
styles/{candy,haunted,nature,types}.ts, textures/procedural.ts, builders/materials.ts, three.test.ts}`.

### Mise à jour 2026-09-26 — terrain en relief et éditeur du relief

**Maillage (`builders/terrain.ts`).** Un terrain plat garde exactement l'ancien chemin
(`flatWithHoles`, pas de jupe) — c'était la parade au risque CRITICAL de `computeTerrain` / HIGH de
`buildHouse` relevé par GitNexus. Avec un relief (`shapeTerrain`, appelé par `buildHouse`) :
- `drapeGeometry` : le polygone découpé en mailles de 0,5 m calées sur les multiples du pas
  (Sutherland–Hodgman, la maille étant convexe), privé des triangles de ses bassins. Pas de
  `ShapeGeometry` : elle n'a de sommets que sur le contour, rien pour suivre une bosse.
- **affinage le long des murs** : les mailles traversées par le contour de la maison (arêtes dont
  les deux côtés ne sont pas dans une emprise) sont redécoupées en 4 × 4, pour que le raccord
  libre/écrêté reste dans le mur. Les mailles voisines reçoivent les sommets du côté commun
  (`densifyBorders`), sinon le terrain se fend. **Piège** : `ShapeUtils.triangulateShape` (earcut)
  retire les points ALIGNÉS, justement ceux-là ; un morceau convexe densifié est donc triangulé en
  éventail depuis son centre. Un test vérifie qu'aucune arête de bord n'est à l'intérieur de la
  parcelle.
- `applyTerrainHeights` ne refait que les z ; la part de palier (`padWeight`) et le plafond
  (`footprintCeiling`) de chaque sommet sont gardés sur la géométrie tant que les emprises sont les
  mêmes : pendant un glissement, seul le relief change.
- une **jupe** (`skirtGeometry`, deux faces) borde la parcelle jusqu'au sol infini, désormais percé
  à l'emprise du terrain ; les zones non-piscine sont drapées de même, à +1 cm.

**Ce qui suit le relief** : `localZ` / `groundZ` (appareils du jardin, véhicules, aperçu d'un
déplacement), `MarkerContext.groundZ` (la tondeuse suit la pente en roulant), les places au sol
(z au centre), les épingles du journal. `afterTerrainChange` les recale sans reconstruire les
marqueurs. Enregistrer le relief passe par `sameShellButRelief` → `updateRelief` : pas de `load()`,
donc la caméra ne se recentre pas.

**Éditeur (`relief/reliefEditor.ts`, `HouseScene.setEditingRelief`).** Le brouillon (`reliefGrid`)
survit à un rechargement de la maison ; l'éditeur vit et meurt avec les nœuds.
- une poignée par nœud de la grille (pas de 2 m, `RELIEF_STEP`), deux jeux de `Points` : jardin
  (test de profondeur) et **sous la maison** (sans test de profondeur, plus pâles), posés à la
  hauteur du NŒUD (`reliefSurface`). Pas de poignée sur le palier d'un bassin.
- **un tap choisit, seul le point choisi se glisse** ; un glissement parti ailleurs fait orbiter
  (sans cela, on déplaçait un point en voulant tourner). Glissement vertical à l'écran, converti en
  mètres à la profondeur du point, pas de 5 cm, zone morte de 6 px. Un point bouge SEUL : le pinceau
  en cloche de la première version (rayon réglable) a été retiré à la demande (« trop compliqué à
  modeler »).
- point choisi : anneau d'accent à cœur blanc, deux fois plus gros, par-dessus tout.
- **historique** annuler / rétablir de 10 pas (`RELIEF_HISTORY`) : geste, saisie, import et remise à
  zéro en font chacun un ; l'historique rend un NOUVEL objet grille (`afterReliefTravel` relit
  `editor.grid`).
- **flèches** : point voisin dans le sens de l'ÉCRAN (axe de la grille le mieux aligné, projeté
  autour du point), nœuds sans poignée sautés.
- **poignées estompées en profondeur** dans le shader (`fadeWithDepth`, crochet de programme
  `kasbah-relief-handles` qui appelle d'abord le crochet commun du prototype) : alpha, taille et
  teinte baissent jusqu'à 8 %, 45 %, 45 % ; la plage est recalée à chaque image sur la sphère des
  poignées vue de la caméra (`onBeforeRender`). Hors tone mapping et sous le seuil du bloom :
  blanches, elles bavaient en halos la nuit.
- **concentration** : pendant l'édition, les matières des niveaux et du toit passent à 50 % par
  `materialOpacity` (trame de `levelFade`, sans tri ni recompilation — premier usage de cette
  opacité) et la couche DOM des pilules est masquée (`syncReliefFocus`) ; un tap ne sélectionne
  plus ni pièce ni appareil.
- **vues** `viewTerrainFrom('north' | 'east' | 'south' | 'west' | 'top')` : presque horizontales
  (π/2 − 0,12), calées sur le vrai nord (`origin.heading`), azimut three = atan2(x, z) du côté
  voulu ; `top` d'aplomb.

État vers le panneau : événement `reliefChange` (`ReliefEditState` : hauteur du point, brouillon,
`canUndo` / `canRedo`, dernier choix au tap et son pointeur), relayé par `useHouseScene.relief`.

#### Correction 2026-09-26 — l'affinage suit le CHANGEMENT DE PLAFOND, pas la sortie des pièces

La règle d'affinage décrite plus haut (« arêtes dont les deux côtés ne sont pas dans une emprise »)
sautait les façades du RDC situées **sous un étage en porte-à-faux** : dehors, le point est sous une
pièce de l'étage, donc « dans une emprise ». Sur la maison réelle (terrain en pente contre une façade,
sous une terrasse d'étage), le raccord libre/écrêté s'étalait alors sur des mailles de
50 cm qui dépassaient du mur : dents de scie le long de la pente, jusqu'à **39 cm** d'écart entre le
terrain dessiné et sa hauteur voulue, mesurés par rayon vertical juste devant la façade.

Désormais `refinedCells` compare le **plafond** des deux côtés de l'arête (`footprintCeiling`) : même
plafond (cloison entre deux pièces d'un niveau) → pas d'affinage ; plafond différent (façade, même
sous un porte-à-faux) → mailles de 12,5 cm. `drapeGeometry` reçoit donc les emprises entières
(`Footprint[]`, polygone et plafond), plus seulement leurs polygones. Écart mesuré après : 0 cm sur
229 points. Test : « sous un étage en porte-à-faux, la façade du RDC est affinée ».

Tests : `apps/web/src/three/builders/terrain.test.ts`, `apps/web/src/three/relief/reliefEditor.test.ts`.

Sources : `apps/web/src/three/builders/{terrain,buildHouse}.ts`, `apps/web/src/three/relief/reliefEditor.ts`,
`apps/web/src/three/HouseScene.ts`, `apps/web/src/three/markers/{DeviceMarker,markers}.ts`,
`apps/web/src/composables/useHouseScene.ts`.

### Mise à jour 2026-09-26 — toit à pentes percé : fusion, inclinaison et place du Velux

**Les Velux d'un toit à pentes étaient rebouchés.** `planarFacesWithHoles` fusionnait (`mergeGeometries`)
une face percée issue d'un `ShapeGeometry` (indexée, avec `uv`) et des faces `planarFaces` (non
indexées, `position` + `normal` seuls). La fusion rendait `null` avec l'avertissement
« .mergeGeometries() failed with geometry at index 1 » à chaque `HouseScene.load()`, et le repli
`planarFaces(faces)` dessinait le toit **sans aucun trou**. Correctif : la face percée passe en
`toNonIndexed()` et perd son `uv` avant la fusion. Test : `apps/web/src/three/builders/shapes.test.ts`
(aire fusionnée = faces moins trous, aucun `console.error`).

**La vitre penchait à l'envers à cap 180.** `buildPane` et `buildOpeningHandles` posaient
`rotation.z = cap` et `rotation.x = −pente` sur le même objet : avec l'ordre d'Euler `XYZ` par défaut
de three.js, la pente s'applique autour du **X monde**, pas de l'axe de largeur tourné par le cap.
Juste à cap 0, miroir à cap 180 (écart mesuré : 70°, le double de la pente). Correctif :
`rotation.order = 'ZXY'` (cap, puis pente dans le repère tourné). Les modules photovoltaïques
n'avaient pas le défaut : leur groupe porte le cap, le maillage enfant la pente.

**Taille et hauteur** : la vitre remplit maintenant le trou (convention « longueur le long de la
pente », `../2_maison/2_1_geometrie.md`) et son centre est sur le plan du versant ; `buildPane`
reprend `openingCentre` au lieu de recalculer le centre. Les traits des cotes d'édition
(`refreshOpeningNotes`) partent du bord du trou (`planLength`, `rect.slope`).

**Pré-existant, non traité** : un toit à pentes n'a pas d'UV (`planarFaces` n'en pose pas) ; la
texture de tuiles de `mats.roof` y est échantillonnée en un seul point.

Tests : `apps/web/src/three/builders/{shapes,roofWindow}.test.ts`.

Sources : `apps/web/src/three/builders/{shapes,buildHouse}.ts`, `apps/web/src/three/HouseScene.ts`.

### Mise à jour 2026-09-26 (bis) — UV du toit à pentes, cotes du Velux sur son emprise

**Remplace** le « pré-existant, non traité » de la section précédente : le toit à pentes a ses UV.
`faceFrame` (`builders/shapes.ts`) donne à chaque face un repère 2D **en mètres** : u le long de sa
première arête (l'égout), v dans le plan, orienté vers le haut (le faîtage). `planarFaces` en tire les
UV ; la face percée garde celles de son `ShapeGeometry`, qui sont déjà ces coordonnées (seul le
`toNonIndexed()` reste avant la fusion). Même convention que le reste de la scène
(`texture.repeat = 1 / tileM`) : un mètre de toit = un mètre de texture, sans étirement par la pente.
Le motif de tuiles de `mats.roof`, uniforme jusque-là, s'affiche sur la démo.

**Cotes d'édition d'un Velux** : `refreshOpeningNotes` prend le cap et la longueur en plan de
l'`OpeningRect` (qui sont ceux de `surfaceFootprint`, `../2_maison/2_1_geometrie.md`) et passe cette
emprise à `surfaceGaps`.

Tests : `apps/web/src/three/builders/shapes.test.ts` (UV présents, longueurs conservées, v qui monte
avec z).

Sources : `apps/web/src/three/builders/shapes.ts`, `apps/web/src/three/HouseScene.ts`.

### Mise à jour 2026-09-27 — shaders compilés hors du fil principal après le chargement ; garde-fou revu

**Symptôme** : en changeant de style, la sélection mettait quelques secondes à se peindre. Mesuré dans
la preview (GPU intégré) : premier passage à « réaliste » = une image de **2,5 s**, retour sur
« réaliste » plus tard = **5,5 s** (7 programmes recompilés). three **jette** les programmes que plus
aucune matière n'utilise : revenir sur un style déjà vu recompile aussi. La préparation du chargement
(ter) ne couvrait que l'état initial.

**Correctif** : `HouseScene.compileBeforeShow()`, appelé à la fin de `setAppearance` et à chaque
matière photo arrivée (une carte de plus = un autre programme). Même mécanisme que `prepare` :
`renderer.compile` lance les compilations (en parallèle avec `KHR_parallel_shader_compile`),
`shadersReady` attend sans bloquer, et `render()` rend la main tant que `compiling` est vrai —
l'ancienne image reste. Sans l'extension, tout est « prêt » tout de suite : on retombe sur la
compilation à la première image. Ignoré pendant une préparation (elle tient déjà les images).
`shadersReady` prend désormais un prédicat « encore d'actualité » au lieu du jeton `prepareGen`.
Mesuré après : retour sur « réaliste » = 0,47 s d'ancienne image, plus longue tâche 81 ms.

**Garde-fou de qualité** — **remplace** le point 1 de la section du 2026-09-15 et le budget de 25 ms du
2026-09-25 (bis), sur décision de l'utilisateur :
- il n'est branché qu'en **« auto »** (`onDowngrade` absent sinon). Il écrivait la qualité descendue
  dans `options.quality`, écrasant un choix explicite : « high » forcé repassait en « medium » au bout
  de 13 s sur l'iGPU. Le cran retenu vit dans `autoQuality` ; le réglage reste « auto », et tout
  changement de qualité par `setOptions` repart de la détection ;
- budget **33 ms** médians (≈ 30 img/s) au lieu de 25 ;
- `detectQuality` ne rétrograde plus un GPU **intégré sur son nom** (règle `INTEGRATED_GPU` retirée) :
  c'est la mesure qui tranche. Restent `low` pour un rendu logiciel, `medium` pour un pointeur grossier
  (tablette) ou ≤ 6 cœurs.

Mesures du jour (Chrome à part, secteur, maison réelle, `_generated-ai-doc/perf/diag-guard3.mjs` :
gestes de 0,7 s séparés de pauses de 2,5 s) : GPU intégré « high » 26-46 ms, « medium » 9-18 ; GPU dédié
« high » 11-15. En « auto » sur le GPU intégré, la scène part en « high » et y reste (médiane ~28 ms) ;
certains gestes montent à 31-38 ms, donc la marge est mince. Un Chrome neuf lancé par script dessine
sur le GPU intégré par défaut.

**Rappel utile au diagnostic** : en qualité **basse**, la pluie et les chauves-souris sont retirées et
l'eau est figée (`syncPrecipitation`, `syncBats`, `syncWater`). « L'eau ne bouge plus et plus de
chauves-souris » se lit donc d'abord dans le voile de débogage, ligne « qualité ».

**Ambiance dédoublonnée** (`composables/useHouseScene.ts`) : l'ambiance est un objet recalculé, neuf à
chaque relecture ; `setAppearance` (ciel ~35 ms, matières, ombres) n'est plus appelé que si sa
sérialisation JSON a changé. Le « ciel recalculé chaque seconde » observé venait de la météo simulée
(`../3_plugins/3_0_simulation-mock.md`, même date).

Tests : `apps/web/src/three/three.test.ts` (« un changement de style compile ses shaders sans dessiner,
puis redessine » ; détection : tout vrai GPU part en high), `apps/web/src/three/quality.test.ts`
(qualité forcée intouchée ; « auto » qui descend et reste « auto »).

Sources : `apps/web/src/three/HouseScene.ts` (`compileBeforeShow`, `shadersReady`, `applyQuality`,
`setOptions`, `render`), `apps/web/src/three/core/post.ts` (`detectQuality`, `FRAME_BUDGET_MS`),
`apps/web/src/composables/useHouseScene.ts`.

### Mise à jour 2026-09-28 — la houle de la piscine suit le vent réel ; le cap de la maison compte

Jusqu'ici, la houle (section « La houle », `drawWaves`) était groupée autour d'un vent **fictif**
écrit en dur (`const wind = 0.6`, ~34°) et figée dans le shader au chargement : ni la direction ni la
force du vent météo n'y changeaient rien. Et la phase `k·p + ωt` faisait avancer chaque onde
**contre** son vecteur. Désormais (`apps/web/src/three/effects/water.ts`) :

- **Repère du vent.** Les ondes sont tirées autour de +x d'un repère « vent » (même graine, même
  eau). Un uniforme partagé `uWaterWind` (`WaterUniforms.wind`) porte en `xy` la direction où le
  vent POUSSE, dans le plan xz du monde, et en `z` l'amplitude. `kasbahToWind` y ramène un point du
  monde, `kasbahFromWind` en ressort la pente. La carte des caustiques est une tuile de ce repère :
  la passe des caustiques y tourne aussi le soleil, le fond la lit par `kasbahToWind(causticAt)`.
  Tourner le vent ne recompile rien et ne casse pas la périodicité.
- **Sens.** Phase `k·p − ωt` : chaque onde avance dans le sens de son vecteur, donc sous le vent.
- **Force.** `setWaterWind(u, windKmh, windDirDeg)` : amplitude `0,15 + 0,85·√(v/10)` plafonnée à
  1,5 — 0,15 par calme (la filtration), 1 à 10 km/h (la houle d'avant), ×1,35 à 20 km/h, plafond vers
  26 km/h. Sans météo, la brise de la pluie (10 km/h, 250°). `WaterCaustics.update` redessine aussi
  quand le vent change.
- **Convention.** `windDirDeg` est d'où le vent VIENT (Open-Meteo `wind_direction_10m`, transmis tel
  quel par `apps/server/src/plugins/open_meteo/mapping.ts`) : un vent de 196° pousse la houle au
  nord-nord-est. La rose de la page Météo pointait vers l'origine, d'où une contradiction apparente
  avec la piscine ; elle pointe maintenant sous le vent (voir `../4_ui/4_1_navigation-et-panneaux.md`).

**Le cap de la maison.** Le +y du plan est au cap `origin.heading`, pas forcément au nord. Soleil, pluie/neige et houle prenaient le haut du plan pour le nord vrai. Désormais
`HouseScene` retranche `headingDeg` des azimuts météo : `sunDirection(a, minAlt, headingDeg)`
(`core/ambience.ts`), `windDirDeg − headingDeg` pour `Precipitation` et `setWaterWind`. `sunDir` est
devenu un accesseur (ambiance + cap), et `load` refait le ciel (`applySky`) quand le cap change.
`heightMist` et le grade aube/soir comparent l'azimut à 180° : ils restent en nord vrai, à dessein.

Vérifié : tests `three.test.ts` (« la houle part sous le vent réel… », « compte le vent depuis le
nord VRAI… », « retranche le cap de la maison… ») ; dans la preview, vent réel 194° → houle vers
188° du plan (x = 0,139), shaders de l'eau liés sans erreur.

Sources : `apps/web/src/three/effects/water.ts` (`WIND_FRAME`, `setWaterWind`, `WAVES`),
`apps/web/src/three/HouseScene.ts` (`sunDir`, `headingDeg`, `syncWater`, `syncPrecipitation`, `load`),
`apps/web/src/three/core/ambience.ts` (`sunDirection`), `apps/web/src/three/effects/precipitation.ts`.

### Mise à jour 2026-09-28 — le calque du jardin : facettes, instances, saison

**Remplacement d'une décision.** Les sections 2026-09-15 (quinquies) et (duodecies) excluaient la
végétation (« on ne prend pas en compte les arbres », « pas de mobilier, pas de végétation »). Le
2026-09-28, l'utilisateur la lève **pour ce qu'il plante lui-même** (`site.garden[]`). Le mobilier
reste exclu. Ces deux sections restent vraies pour leur date.

Côté scène (`apps/web/src/three/garden/`, récit complet et décisions de style dans
`../2_maison/2_2_jardin.md`) :

- **`GardenLayer`** : une `InstancedMesh` par (famille ou espèce, variante de forme, matière), quatre
  variantes par famille choisies par la graine. Le calque est posé dans le groupe du site, **gardé
  d'une maison à l'autre** (ses formes et matières servent à la suivante) et reposé par
  `buildGarden` au chargement, au changement de thème (anneau d'accent) et après une édition du
  relief (le pied suit `groundZ`, enfoncé de 5 cm).
- **Style low-poly facetté** (`shapes.ts`, `facet`) : faces non indexées, clarté par face en couleur
  de sommet, plus claire vers le haut. Aucun fichier, aucune texture. Le pack Quaternius essayé
  derrière le switch « assets » a été retiré.
- **API de `HouseScene`** : `updateGarden` (seul le jardin a changé ; `useHouseScene` le détecte par
  `sameShellButGarden`, glisser un arbre ne recharge donc pas la maison), `setSeason`,
  `setEditingGarden`, `setPlacingGarden`, `setSelectedGarden` (anneau dans `SITE_DECOR_LAYER` +
  détecteur de glissement propre à l'élément), `focusGarden`. Événements `gardenTap`, `gardenDrag`
  (coalescé à une image par `requestAnimationFrame`), `gardenDrop`, `gardenPlaceTap`.
- **`pick`** : en mode édition, un élément du jardin passe **avant tout**, appareils compris (une
  place, elle, passe après les appareils). Hors édition, le jardin n'est pas touchable.
  Élément armé : seul un point du terrain (`groundPoint` sans niveau) est rapporté, un sol de pièce
  ou un toit donne `backgroundTap`.
- **Saison** : `resolveSeason(settings.sceneSeason, horloge, origin.lat)` dans `useHouseScene`,
  poussée par `setSeason`. Elle entre dans la signature du calque, qui se reconstruit seul.

Sources : `apps/web/src/three/garden/{gardenLayer,shapes,species,speciesShape,season}.ts`,
`apps/web/src/three/HouseScene.ts`, `apps/web/src/composables/useHouseScene.ts`, tests
`apps/web/src/three/garden/{shapes,species}.test.ts`, arbre de travail non commité après cf60c7d.

### Mise à jour 2026-09-29 — style disco, boule à facettes et projecteurs animés

Demande de l'utilisateur : « ajouter un style de rendu 3D disco », puis « ajoute la boule à
facettes et des projecteurs animés ».

**Le style** (`three/styles/disco.ts`) : murs en argent presque miroir (`metal`, rugosité 0,18,
métallicité 0,95), toit en or, sols en dalles `tile` laquées qui ÉMETTENT (magenta, or, cyan selon
le revêtement), ciel bleu nuit à horizon magenta, soleil doré et hémisphère cyan en haut, magenta
en bas, bloom fort et étalonnage saturé (`grade.saturation` 1,25). Comme `haunted`, il écrase
`dayFactor` (× 0,7) : à midi la fête baisse d'un ton. Deux premiers réglages écartés à l'œil : un
ciel tout magenta rendait une maison monochrome qui lisait comme du cyberpunk ; un horizon doré
teintait tout en orange. Le rendu de jour n'a pas été regardé.

**L'effet** (`three/effects/disco.ts`, classe `Disco`), demandé par une clé optionnelle
`StyleLook.disco = { spots, colors }` sur le modèle de `bats` : la couche des styles décrit, la scène
anime. Trois pièces dans le repère local de la maison (enfant de `nodes.root`) :

- la boule : icosaèdre subdivisé en `flatShading`, métal miroir que la carte d'environnement (le
  ciel du style) fait briller, 2,5 m au-dessus du faîtage, qui tourne, pendue à un fil ;
- ses éclats : 240 points additifs sur une grande sphère qui tourne avec elle ;
- les projecteurs (4) posés au sol autour de la maison : un cône additif (le faisceau visible,
  éteint sur sa longueur par une couleur de sommet — son bout s'arrêtait net sur un disque) et une
  `SpotLight` SANS ombre (la tache de couleur), qui balaient en lissajous et glissent d'une couleur
  de la palette à la suivante.

`HouseScene.syncDisco` / `removeDisco` suivent exactement `syncBats` / `removeBats` : animation de
la boucle à 20 Hz, retirée en qualité basse, refaite seulement si le nombre de projecteurs change,
appelée au chargement, à `setAppearance`, à `applyQuality`, à `clear` et à `dispose`. Rien n'est
cliquable (`raycast` neutralisé) : un faisceau couvre la maison et avalerait le tap des appareils.

Points ouverts : les `SpotLight` changent le nombre de lumières (tous les programmes recompilent en
entrant dans le style, le chargement observé ~15 s n'a pas été comparé à un autre style) et ajoutent
un coût par fragment sur toute la maison, non mesuré sur l'iGPU — c'est le choix que la tache des
plafonniers avait écarté (`lamp-pool`, 2026-09-25) ; la boule reste au-dessus du toit quand on
regarde un seul niveau.

Sources : `apps/web/src/three/styles/{disco,types,index}.ts`, `apps/web/src/three/effects/disco.ts`,
`apps/web/src/three/HouseScene.ts`, test `apps/web/src/three/effects/disco.test.ts`.

### Mise à jour 2026-09-29 (bis) — Halloween, Noël, Tatooine, et des personnages qui défilent

Demande de l'utilisateur : « ajouter 3 autres styles : halloween, noël, star wars ». Pour Star
Wars, il a choisi **Tatooine** parmi trois univers proposés (Tatooine, Empire, Hoth) ; les effets
demandés : « noël : traîneau du père Noël ; halloween : fantômes/squelettes ; star wars : des
X-wings ». Puis : « les trajectoires peuvent être plus aléatoires, comme les chauves-souris ».

**Les styles** (`three/styles/{halloween,noel,tatooine}.ts`) :

- `halloween` n'est pas `haunted` : c'est la fête, pas la ruine. Bardage violet, fenêtres qui
  brûlent d'orange (vitre émissive 0,95 la nuit), piscine en soupe verte émissive, six
  chauves-souris presque noires, `dayFactor × 0,6`. Réglage écarté à l'œil : un horizon orange sur
  des murs presque noirs rendait une scène orange où la maison disparaissait. L'horizon est
  maintenant violacé, les murs sont éclaircis.
- `noel` : chalet en bardage rouge, neige PEINTE par la palette sur le toit, le terrain et la
  pelouse (rôle `plaster` mat, elle tient sans météo neigeuse), piscine gelée (`flow: 0`), AgX pour
  que le blanc ne brûle pas. Les fenêtres sont moins chaudes que voulu.
- `tatooine` : ferme d'adobe (`plaster`, relief × 1,5), sable partout (rôle `soil`, pas un brin
  d'herbe), soleil à 2,8, ombres franches, étalonnage jaune et un peu désaturé. **Un seul soleil** :
  un second disque demanderait de toucher `core/sky.ts`.

**L'effet** (`three/effects/parade.ts`, classe `Parade`), demandé par `StyleLook.parade = { kind }`
(`ParadeKind` = `noel` | `halloween` | `tatooine`, déclaré dans `styles/types.ts` pour que les
styles n'importent pas l'effet). Les personnages sont faits de PRIMITIVES (boîtes, cylindres,
sphères, tores) : aucun fichier, aucun chargement ; chaque modèle regarde vers +X en Z-up, ne porte
pas d'ombre et ne se prend pas au clic.

- Traîneau : caisse, patins dorés, père Noël, hotte, deux paires de rennes au galop (pattes sur
  pivots) et Rudolph en tête au nez émissif, rênes en `LineSegments`, traînée de 90 paillettes
  additives qui s'éteignent en vieillissant.
- Fantômes (5) : dôme et robe au bas ondulé, translucides, qui s'estompent et reviennent, sur des
  cercles qui respirent — ils traversent les murs, c'est voulu.
- Squelettes (4) : ils marchent AU SOL en procession, bras et jambes qui balancent, hors de
  l'emprise bâtie (rayon = demi-diagonale de `buildingBounds` + 1,6 m), la hauteur lue sur le
  relief par `HouseScene.groundZ`.
- X-wings (3) : fuselage, nez, verrière, R2 bleu, quatre ailes en X sur des pivots, réacteurs à
  flamme > 1 (le bloom la prend), canons.

Tout tourne autour de l'emprise BÂTIE (`ParadeArea.building`), pas du terrain : sur le rayon du
terrain, le traîneau volait hors du cadre et on n'en voyait que les paillettes.

**Le vol qui erre** (`wander` + `fly`) : le traîneau et les X-wings ne tournent plus en rond.
L'angle avance à une vitesse qui varie, le rayon respire, le centre dérive, l'altitude monte et
descend — fréquences, phases et sens tirés à la création comme pour les chauves-souris ; somme de
sinus, donc lisse et bornée (plancher `z0 − 1`). Le nez suit la TRAJECTOIRE : cap et tangage lus
entre un point un peu avant et un peu après (± 0,15 s), roulis proportionnel à la vitesse à laquelle
le cap tourne (borné à 0,7 rad). Les X-wings ont chacun leur vol (plus de formation en V).

`HouseScene.syncParade` / `removeParade` suivent `syncDisco` : 20 Hz, retirés en qualité basse,
refaits seulement si la sorte change, appelés aux cinq mêmes endroits.

Non vérifié : le temps d'entrée dans ces styles (« Compilation des shaders » a duré plus de 15 s,
mais le panneau de preview était masqué et ne dessine pas dans cet état), Halloween et Noël de jour,
Tatooine de nuit, le mouvement du vol errant jugé à l'œil. Piège vu en route : deux `sed` successifs
sur `HouseScene.ts` ont laissé Vite servir un état intermédiaire (`b is not defined`), et la console
de la preview garde ce message après rechargement — lire le module servi avant de conclure.

Sources : `apps/web/src/three/styles/{halloween,noel,tatooine,types,index}.ts`,
`apps/web/src/three/effects/parade.ts`, `apps/web/src/three/HouseScene.ts`, test
`apps/web/src/three/effects/parade.test.ts`.

### Mise à jour 2026-10-01 — éditeur du contour du terrain (`OutlineEditor`) et remaillage

**Un second éditeur à côté de celui du relief.** `three/relief/outlineEditor.ts` : `OutlineEditor`
est créé avec le `ReliefEditor` dans `applyReliefDraft`, et chacun reçoit `setEnabled(tab)` selon
l'onglet courant (poignées cachées, `hitTest` coupé pour l'inactif). Les taps sont routés vers
l'éditeur de l'onglet. `HouseScene` porte un `outlineDraft` qui, comme le brouillon du relief,
survit à un rechargement de la maison. `ReliefEditState` gagne `tab` et `outline` (`point`,
`draft`, `canUndo`, `canRedo`, `canRemove`, `pick`) ; méthodes publiques : `setTerrainTab`,
`undoOutline`, `redoOutline`, `setOutlinePoint`, `removeOutlinePoint`.

**Gestes** (même règle que le relief : CHOISIR puis glisser, un glissement ailleurs fait orbiter) :
le sommet choisi se glisse dans le plan HORIZONTAL du monde à sa hauteur (écart doigt-sommet
conservé), arrondi à `OUTLINE_SNAP_M` = 0,1 m ; la petite poignée au milieu d'un côté insère un
sommet déjà choisi. Un contour qui se croiserait est refusé AU FIL du geste (le sommet reste à sa
dernière place valide). Historique de `OUTLINE_HISTORY` = 20 pas, séparé de celui du relief.
Pendant un glissement seuls le trait et les poignées suivent ; le terrain est remaillé à la FIN du
geste.

**Remaillage : `shapeTerrain(nodes, geometry, mats, outlineChanged = false)`**
(`builders/buildHouse.ts`). Un terrain déjà drapé n'était jamais refait (`userData.drape`) ; il
l'est maintenant quand le contour change, et la jupe est retirée puis refaite (sinon elle gardait
l'ancien pourtour). `shapeTerrainNow()` compare le contour courant à `meshedOutline` (posé au
`load`). Un autre écran qui reçoit le nouveau contour remaille donc aussi.

**Pas de recentrage de caméra.** `sameShellButRelief` (`composables/useHouseScene.ts`) ignore
désormais aussi `site.terrain` : enregistrer le contour passe par `updateRelief`, pas par le
rechargement complet.

**Relief agrandi côté scène** : `applyReliefDraft` applique `extendReliefGrid` au brouillon puis
`ReliefEditor.adoptGrid(grid)` (sans pas d'historique ; le point choisi suit son nœud). Le serveur
fait le même calcul à l'écriture.

**Visuel.** Sommets gris 0,62 (14 px), milieux de côté plus petits et plus sombres, anneau d'accent
sur le sommet choisi, trait d'accent qui SUIT le relief (un point par mètre), le tout
`depthTest: false` et hors tone mapping (`dotTexture` / `ringTexture` exportés de
`reliefEditor.ts`). Piège : des sommets blancs (0,9) faisaient des halos de bloom la nuit ; ramenés
à 0,62 comme les poignées du relief.

Voir aussi `../2_maison/2_0_format-house-json.md` (écriture) et
`../4_ui/4_1_navigation-et-panneaux.md` (panneau, avertissement).

Sources : `apps/web/src/three/relief/{outlineEditor,reliefEditor}.ts`, `apps/web/src/three/HouseScene.ts`,
`apps/web/src/three/builders/buildHouse.ts`, `apps/web/src/composables/useHouseScene.ts`, test
`apps/web/src/three/relief/outlineEditor.test.ts`.

### Mise à jour 2026-10-01 (bis) — style Akira, la moto de Kaneda, et tout ce qui bouge parcourt le terrain

Demandes de l'utilisateur, dans l'ordre : un style de rendu « Akira » (« pas le thème de l'app »),
avec la moto ; puis « pour tous les styles et les objets qui bougent, est-ce qu'ils peuvent faire ça
sur la totalité du terrain (hors maison pour tous sauf les fantômes) » ; puis « éviter la piscine,
les arbres et voitures/robots » ; « les squelettes marchent en ligne, ce n'était pas le cas avant » ;
« lisser un peu les courbes […] sauf si pas le choix » ; enfin « dispense le traîneau et les X-wings
des obstacles au sol ».

**Le style** (`three/styles/akira.ts`, `ParadeKind` gagne `akira`, clés `render.styles.akira`) :
Neo-Tokyo 2019. Béton gris-bleu, bitume mouillé, le rouge de Kaneda qui ÉMET (vitres, allées,
cloisons intérieures), la piscine et la lune cyan en contrepoint ; la nuit, horizon rouge de ville
qui brûle ; le jour, ciel laiteux de smog, vitres au reflet rouge (`#c25a4e`) pour que la signature
reste sur la maison. Étalonnage de celluloïd : saturation 1,25, rouge poussé, noirs écrasés (lift
négatif, que `max(·, 0)` du shader de sortie borne) — **de jour seulement** (`lift × day`) : la nuit,
ils tombaient dans le noir. Trois réglages de nuit jugés « trop sombre » par l'utilisateur avant
d'être relevés : un sol métallique ou très lisse reflète un ciel noir et devient NOIR — le bitume
est passé à `roughness 0,6` sans métal, le toit à `metalness 0,1`. Pas de rendu dessin animé
(contours, aplats) : le moteur n'en a pas.

**La moto** (`Parade.bike`) : primitives comme le reste — carénage en gélule rouge (`CapsuleGeometry`),
moyeux rouges pleins, Kaneda couché sur le réservoir, gélule blanche dans le dos, feu arrière
> 1 pour le bloom. Elle roule AU SOL à ~8 m/s, couchée dans les virages par `fly`. Sa **traînée** :
deux rubans croisés (vus d'en haut comme de côté), additifs, dont les 48 points sont relus sur la
trajectoire PASSÉE — `path` étant une fonction du temps, rien à mémoriser.

**Parcours sur tout le terrain** (`three/effects/roam.ts`, nouveau ; utilisé par `parade.ts` et
`bats.ts`). Précédemment, tout tournait autour de l'emprise bâtie (cf. section du 2026-09-29 bis :
« pas du terrain, le traîneau volait hors du cadre ») ; à partir d'aujourd'hui, chaque personnage et
chaque chauve-souris suit une **boucle tirée au hasard sur le polygone du terrain**
(`geometry.terrain.polygon`), qu'on parcourt à vitesse constante (abscisse curviligne) et qui
recommence au bout d'un tour (~30 s à 1 min). `wander`, `orbit` et `frame` sont retirés. Sur un
grand terrain, les personnages sortent donc souvent du cadre — assumé.

Construction d'une boucle : 8 points de passage tirés dans le terrain (à 1,5 m du bord, hors des
emprises et du jardin) → **ordre de visite** au plus proche voisin puis 2-opt (un ordre au hasard
faisait des huit et des demi-tours) → détours → deux passes de **Chaikin** → points de contrôle à
moins de 1,5 m retirés (`spaced` : la Catmull-Rom y faisait des nœuds de 20 cm) → Catmull-Rom
centripète fermée. Chaque boucle est échantillonnée et JUGÉE ; on en compare plusieurs.

| Règle | Comment |
|---|---|
| terrain, maison, piscine | **règles** : la boucle refusée si un échantillon sort du terrain ou entre dans une emprise. Une emprise se contourne par les coins d'un rectangle agrandi (`around`), le plus court des deux sens ; deux emprises qui se touchent une fois agrandies (piscine collée à la maison) sont fondues (`merge`), sinon aucun détour ne passait |
| jardin (`statics`) | **préférence** : un segment qui coupe un élément est détourné par un point posé à côté (abandonné s'il sortirait du terrain) ; des candidates, on garde celle qui touche le MOINS d'éléments, puis la plus coulante |
| coulant | rayon du virage le plus serré (`tightestTurn`, fenêtre de 1 m) : le plus large gagne |
| arrêt | 6 boucles sans contact, ou 10 valides (jardin touffu), ou 30 tirages ; à défaut, un cercle autour des emprises |

Les disques du jardin viennent de `GardenLayer.footprints()` : un arbre ne bloque que la moitié de sa
couronne (au plus 2,5 m) — on passe sous le bord, pas dans le tronc —, un buisson ou un rocher tout
son volume, une haie un chapelet de disques ; `tall` marque les arbres. Rangés dans une grille de
cases de 4 m (`CircleGrid`) : un jardin fourni en compte plus d'une centaine.

**Ce qui bouge** (voitures, tondeuse : `HouseScene.roamObstacles`, par classe de marqueur
`VehicleMarker` / `MowerMarker` — `device.kind` est vide, le genre vient du descripteur) est
contourné DÈS le tracé là où c'est garé à ce moment (`roamStatics`), puis **évité au passage**
(`swerve`) s'il bouge, relu à chaque pas (20 Hz). Écart par RENCONTRE : chaque minimum local de la
distance au parcours de base, sur une fenêtre autour de `t`, est un passage au plus près ; le côté
se décide une fois (à l'opposé, ou l'autre si celui-là entre dans une emprise), et le décalage se
fait en travers du cap PRIS À CE PASSAGE, avec une cloche à plateau (pente nulle aux raccords).
Obstacles mobiles trop proches pour passer entre eux fondus (plafond 6 m), garde-fou de 15 cm au bord.

Qui évite quoi :

| Personnage | Maison | Piscine | Arbres | Buissons, rochers, haies | Voitures, tondeuse |
|---|---|---|---|---|---|
| moto, squelettes, chauves-souris | oui | oui | oui | oui | oui |
| traîneau, X-wings (au-dessus du toit) | oui | non | oui | non | non |
| fantômes | non | non | non | non | non |

Les squelettes ont chacun leur parcours (un parcours commun, décalé de 2,2 s, les mettait en file).
`HouseScene.buildGarden` retrace défilé et chauves-souris quand l'empreinte du jardin change
(`gardenRoamKey`) : au chargement, le jardin est bâti APRÈS eux, ils ne le voyaient pas.

**Quatre impasses, chacune mesurée** (sondes jetables sur la preview démo et sur la vraie maison) :

1. **Poussée radiale** depuis le centre d'un obstacle : continue tant qu'on n'en passe pas par le
   centre ; quand le parcours y passe, elle change de sens et le personnage saute de 2 R (rayon de
   virage 0 sur deux squelettes).
2. **Côté sur le signe** du décalage latéral : un obstacle PILE sur le trajet voit son signe flotter
   d'un millimètre et le côté avec — saut de 1,06 m à chaque bascule. Zone morte de 5 cm (`SIDE_DEADBAND`).
3. **Normale du moment** plutôt que celle du passage, et **minimum global** sur la fenêtre plutôt que
   les minima locaux : un parcours qui contourne déjà l'obstacle tourne pendant la rencontre (l'écart
   rentrait dedans), ou le passe deux fois (bascule d'un passage à l'autre, saut d'un bord à l'autre).
4. **Tout évité au passage, jardin compris** : sur la vraie maison, les bosquets fusionnaient de
   proche en proche en disques géants ; X-wings, moto et quatre squelettes sur cinq presque tout le
   temps hors du terrain, vitesses jusqu'à 1 178 m/s (« il n'y a qu'un squelette » : les autres
   étaient dehors). D'où le jardin planifié, et l'évitement au passage réservé à ce qui bouge.

Mesures finales :

| | Avant | Après |
|---|---|---|
| virage le plus serré (terrain en L, cordes de 2 m) | 0,6 à 0,7 m | 1,2 à 2,9 m |
| vraie maison : hors terrain | presque tout le temps | jamais (3 tirages × 3 styles) |
| vraie maison : vitesse max X-wing / squelette | jusqu'à 1 178 m/s | 6,1 (nominal 6) / 1,4 |
| vraie maison : dans un élément du jardin | — | moto jamais, squelettes 0 à 3,5 %, un X-wing 3 % sur un tirage |
| construction (ce poste) | — | 20 à 200 ms par style ; 6 à 17 ms par parcours |

Non joué : le coût de construction sur la tablette (prévoir un à-coup au changement de style), la
maison hantée et ses 12 chauves-souris en temps, l'animation vue en direct (le panneau masqué ne
tire pas `requestAnimationFrame` : positions relues en faisant avancer `parade.step` à la main, via
`window.kasbahScene`).

Sources : `apps/web/src/three/styles/{akira,types,index}.ts`, `apps/web/src/three/effects/{roam,parade,bats}.ts`,
`apps/web/src/three/garden/gardenLayer.ts`, `apps/web/src/three/HouseScene.ts`, tests
`apps/web/src/three/effects/{roam,parade}.test.ts`, `apps/web/src/three/garden/gardenLayer.test.ts`.

### Mise à jour 2026-10-03 — style Girlyversaire et ses ballons

Demande de l'utilisateur : un nouveau thème de rendu 3D sur le thème de l'anniversaire. Parmi quatre effets proposés (ballons, confettis, gâteau géant sur le
toit, banderole au prénom), il a choisi **les ballons**, et la palette **rose, lilas et doré**. Nom
choisi ensuite : « Girlyversaire », id `girlyversaire` partout (fichier, `ParadeKind`, clé
`render.styles.girlyversaire`, même libellé en fr et en).

**Le style** (`three/styles/girlyversaire.ts`) : palette unique (`toPalette`, comme `candy` ; la nuit
vient de l'éclairage). Façades rose bonbon en `gloss` (« glaçage », rugosité 0,45), toit lilas
(`roof`), allées et terrasse dorées (`metal`, métallicité 0,55 — plus haut, le métal noircit sans
environnement), volets dorés, pelouse verte, piscine turquoise. Fenêtres dorées émissives au
crépuscule (0,7 la nuit). Nuit violette et claire (lune lilas à 0,9), AgX pour que le rose ne vire
pas au saumon, saturation 1,12. Jardin : feuillages tendres, fleurs et fruits roses.

**Les ballons** (`Parade.balloons`, `ParadeKind` = `girlyversaire`) : 16 ballons de six couleurs
(sphère étirée à 1,18 en hauteur, nœud en cône, ×1,5 « plus grand que nature »), un peu émissifs pour
la nuit. Ils ne suivent PAS `roam` : chacun est lâché sur le pourtour de l'emprise bâtie agrandie de
1 à 3,5 m, au sol (`groundZ`), monte à 0,7–1,1 m/s, dérive avec un vent commun (0,18 ; 0,08 m par
mètre de montée) plus un écart propre, se balance, se gonfle sur 0,6 s au départ et s'efface sur les
deux derniers mètres avant `roofZ + 7`, puis repart du sol. Au départ, les hauteurs sont déjà
étalées. Les ficelles : un seul `LineSegments` (6 segments par ballon) qui ondule davantage vers le
bas. Dernier enfant de `parade.object` = les ficelles.

Vérifié dans la preview (simulation, sous la bruine) de nuit et de jour ; libellé sans débordement
dans Réglages. Non vu : un jour clair, la tablette.

Sources : `apps/web/src/three/styles/{girlyversaire,types,index}.ts`, `apps/web/src/three/effects/parade.ts`,
test `apps/web/src/three/effects/parade.test.ts`.

### Mise à jour 2026-10-03 (bis) — finitions des pièces et de la façade ; les murs se découpent par face

**Qui interprète les finitions.** Seuls les styles qui portent un pack d'images (`RenderStyle.assets`
: Réaliste, Nature) les montrent : photo de la finition si « matières en images » est allumé, sinon
la matière procédurale de sa famille teinte de sa couleur moyenne (`FINISHES[id].color`) ou de la
teinte choisie. Les styles « costume » (Indigo, Cyberpunk…) gardent leur palette : la finition y
prend l'apparence de la surface qu'elle remplace (sol déclaré `style.floor`, cloisons, façade du
style). Choix fait pour ne pas casser ces styles ; le panneau le signale.

**Matériaux** (`builders/materials.ts`) : `finishMaterial(mats, surface, finish, fallback?)`, même
patron que les menuiseries teintées — créé à la demande, partagé par clé
`surface|finition|teinte|repli`, ajouté à `mats.all` (survit à `rebuildLevelNodes`), repris par
`applyLook` à chaque style ou heure. `MaterialSet.finishMode = { honor, photos? }` est posé par
`HouseScene.applyMaterials`. Une teinte colore aussi la photo (enduit blanc repeint).

**Images** (`textures/assets.ts`) : `loadFinishTextures(ids, onReady)` partage le cache du pack, la
clé est le DOSSIER — une finition qui reprend une matière du pack (`photo/wood`) ne la charge pas
deux fois ; d'où la règle « même `tileM` que le pack », vérifiée par test. `textureUrl(dir, file)`
remplace l'ancien `fileUrl`.

**Murs** (`builders/buildHouse.ts`) : `buildWallsGeometry` (extrusion fusionnée par nature) est
remplacé par `addWallPrism`, qui range les six faces d'un prisme dans deux lots : la face
INTÉRIEURE (arête 3 → 0 de l'empreinte `[P(u0), Q(u0), Q(u1), P(u1)]` de `pieceFootprint`, P étant
sur la face intérieure) et le reste. Un maillage par MATÉRIAU ; sans aucune finition, ce sont
exactement `walls:exterior` et `walls:interior` d'avant (`walls[0]` reste l'extérieur), 12
triangles par prisme. Une pièce habillée reçoit ses faces intérieures dans `walls:finish:<id>` ;
une façade habillée prend tout l'extérieur, et l'intérieur des façades sans finition passe alors au
matériau des cloisons (la brique de façade n'entre pas dans la pièce). UV en mètres (le long du mur
× hauteur). Sols : `finishMaterial('floor', …)` comme matériau de base du clone de pièce.

**Mise à jour sans recharger** : `HouseScene.updateAppearance(house)` refait les maillages de tous
les niveaux et les matériaux (photos d'une finition qu'on vient de choisir), sans caméra, marqueurs
ni voile de préparation — le chemin de chaque clic du sélecteur. `useHouseScene` le choisit par
`sameShellButAppearance`, testé JUSTE APRÈS `sameShell` : les chemins suivants (ouvertures, places,
jardin) ignorent `house.style`, et une façade seule passait par `updateOpenings` sans rien refaire
(bug vu dans la preview, corrigé le jour même). `sameShell` compare aussi `house.style`.

Vérifié dans la preview simulée (Réaliste, jour) : chevrons, brique, enduit teinté, bardage de
façade, annuler qui ramène l'enduit, Indigo qui rend la finition à la couleur des cloisons.

Tests : `apps/web/src/three/builders/finishes.test.ts` (faces intérieures qui regardent toutes dans
la pièce — rouge si on prend l'arête 1, contrôle fait —, façade, sol, repli « costume », quatre
images par finition, cotes partagées) ; `three.test.ts` adapté (extents des murs lus sur les maillages).

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
