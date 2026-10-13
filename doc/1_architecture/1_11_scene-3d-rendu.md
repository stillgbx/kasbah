# Scène 3D : rendu

> Dernière mise à jour : 2026-10-13
> Sources : sections reprises telles quelles de `1_5_scene-3d.md` le 2026-10-13 ; chaque section cite les siennes.

Cette page couvre le rendu de la scène : styles et thèmes, lumière du jour et de la nuit, ombres, météo (nuages, pluie, neige, brume), eau de la piscine, matières photo, chaîne d'image et étalonnage, tilt-shift, banc de réglage, performance GPU (passes, MSAA, shaders précompilés, voile de mesure). Elle est née du découpage de
[1_5 Scène 3D](1_5_scene-3d.md), trop longue pour être lue d'un trait : ses
sections y ont été déplacées sans retouche, dans leur ordre d'origine, avec leurs dates. Un renvoi
« plus haut » ou « plus bas » peut donc désigner une section restée dans une autre des trois pages de la scène 3D.

## Thème

`core/theme.ts` lit les variables `--v-theme-*` de Vuetify (parseur tolérant `r,g,b`, `rgb()`, hex)
et `builders/materials.ts` mute ~15 matériaux partagés : un changement de thème ne touche aucun
maillage. Les couleurs de scène (`sceneWall`, `sceneLawn`…) sont déclarées dans les thèmes Vuetify
(`apps/web/src/plugins/vuetify.ts`).
*(Dépassé le 2026-09-15 : la matière dépend du style de rendu (`three/styles/`) ; `core/theme.ts` ne lit plus que les repères d'interface, et `sceneWall` / `sceneLawn` ne sont plus déclarés dans les thèmes Vuetify — voir « Mise à jour 2026-09-15 (septies) ».)*

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

*(Dépassé le 2026-10-10 : les deux minimums, 1,3 s par étape et 1,5 cycle de dessin, ne s'appliquent
plus qu'à la première fois sur un poste — voir « Mise à jour 2026-10-10 ».)*

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

### Mise à jour 2026-10-10 — l'animation du voile ne se voit en entier qu'une fois

**Pourquoi.** À chaque rechargement, et à chaque relance de l'app sur le téléphone, la maison restait
cachée plus de 5 s (deux niveaux : 1,5 × 3,6 s de dessin), même quand la préparation finissait bien
avant. Le cache chaud était déjà borné par les minimums d'animation (mesure du 2026-09-25). Il n'y a
rien à mettre en cache côté 3D : le contexte WebGL meurt avec la page, et la scène se reconstruit à
chaque fois. Ce qu'on retire, c'est l'attente imposée.

**Règle.** `SceneLoader` lit `localStorage['kasbah.sceneLoaderSeen']` à son montage. Si la clé est
absente, le voile tient ses minimums comme avant (chaque étape 1,3 s, 1,5 cycle de dessin). Il pose
la clé quand il les a tenus jusqu'au bout (`settled`). Une page fermée avant la fin ne pose rien, et
l'animation revient entière. Une fois la clé posée, le voile se comporte comme avec les mouvements
réduits : aucune attente, fondus d'étape nuls, il part dès que la maison est prête. Le dessin s'anime
toujours tant qu'il est affiché. Les reconstructions du mode édition en profitent aussi. Stockage
indisponible : l'animation complète à chaque fois.

Non mesuré sur le téléphone : ce qui reste est le vrai travail (matières, shaders, première image).
Piste suivante si c'est encore long : afficher une capture de la dernière vue en attendant la 3D.

Sources : `apps/web/src/components/home/SceneLoader.vue` (`SEEN_KEY`, `brief`), `SceneLoader.test.ts`.

### Mise à jour 2026-10-13 — la carte peinte, cernée de noir en qualité haute

**Symptôme** : « parfois », chaque trait de la carte peinte d'une tondeuse (`builders/groundOverlay.ts`)
était cerné d'un liseré sombre, les teintes foncées du vert, du rouge et du bleu, l'aplat intact.
**Cause** : l'occlusion ambiante GTAO (`ArchitectureGTAOPass`, `three/core/post.ts`, qualité **haute**
seulement, d'où le « parfois ») relève la profondeur et les normales de la scène ; les rubans de contour,
5 cm au-dessus de l'herbe, y passaient pour des obstacles. **Correction** : les maillages de la carte
vont sur `SITE_DECOR_LAYER` (`three/core/layers.ts`) ; test de masque de couche dans
`groundOverlay.test.ts`. Même famille que le carré noir sous les halos des lampes : tout décor
translucide posé sur la scène sans en être la matière va sur une couche de décor. **Non vu à l'image**
(la 3D ne se rend pas dans le panneau masqué de la préversion) : vérifié sur l'état de la scène.

Sources : `apps/web/src/three/builders/groundOverlay.ts` (+ test), `apps/web/src/three/core/{post,layers}.ts`.
