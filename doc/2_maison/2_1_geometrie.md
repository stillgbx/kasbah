# Géométrie : murs, ouvertures, sols, toit

> Dernière mise à jour : 2026-10-06
> Sources : `packages/shared/src/house/geometry/{walls,floors,site,roof,bounds,vec2,surface,index}.ts`, tests `walls.test.ts`, `vec2.test.ts`, `house.test.ts`, `surface-openings.test.ts`, `house/fit-survey.mjs`, `packages/shared/src/house/openings.ts`, `packages/shared/src/house/geometry/types.ts`, `packages/shared/src/house/geometry/relief.ts`, `relief.test.ts`

## Pas de CSG, pas de Shape à trous

Chaque mur est découpé **le long de sa longueur** en quads convexes autour des trous, puis extrudé
vers le haut. Robuste (aucune opération booléenne), rapide, et chaque morceau reste un
`ExtrudeGeometry` trivial fusionné ensuite par matériau.

## Algorithme des murs (`walls.ts`), par pièce murée

1. **Segments** : pour l'arête `i`, direction `d`, longueur `L`, normale extérieure `n = (d.y, −d.x)`
   (à droite pour un polygone CCW).
2. **Classification** (`classifySegments`) : surcharge `walls[]` sinon sondage d'un point à
   `2·t_int + 5 cm` derrière l'arête : dans une autre pièce murée du même niveau → `interior`
   (épaisseur `interiorWallThickness`), sinon `exterior`. `none` → aucun mur.
3. **Coins mitrés** (`miterCorners`) : le point extérieur d'un sommet est l'intersection des lignes
   décalées des deux arêtes voisines ; bout droit si voisin `none`, arêtes colinéaires ou mitre trop
   longue (> 3 × épaisseur). Fonctionne pour coins convexes et rentrants ; les murs de pièces
   adjacentes s'aboutent sur un plan commun (jamais de z-fight).
4. **Trous** (`collectHoles`) : ouvertures de la pièce sur l'arête + **miroir** des ouvertures des
   pièces en vis-à-vis (arête antiparallèle, écart `t + t'` ± 2 cm, projection sur l'arête,
   recouvrement > 1 mm) ; fusion des trous qui se chevauchent.
5. **Découpe** (`splitWall`) : parcours de `[0, L]` ; pleine hauteur entre les trous, allège
   `[0, sill]` et linteau `[sill + h, H]` sous/sur chaque trou.
6. **Empreinte** d'un morceau `[u0, u1]` : `[P(u0), Q(u0), Q(u1), P(u1)]` (CCW), avec `Q` = face
   extérieure sauf aux bouts où l'on prend le coin mitré.

*(Constat du lint du 2026-10-06 : « jamais de z-fight » ne tient pas à un angle de bâtiment partagé par deux pièces — voir « Mise à jour 2026-09-12 — deux pièces qui se partagent un angle de bâtiment se traversent ».)*

Sortie : `WallPrism[]` (z locaux au niveau) et `OpeningRect[]` (origine, direction `u`, normale,
largeur, hauteur, épaisseur — utilisés pour les vitrages et les lames de volets).

## Sols, terrain, toit

- **Sols** (`floors.ts`) : dalle extrudée de `−slabThickness` à 0 (5 cm pour terrasses/balcons),
  un matériau cloné par pièce pour la surbrillance ; ancres d'étiquette au centroïde.
- **Terrain et zones** (`site.ts`) : polygones plats à `site.elevation` (zones à +1 cm et
  `polygonOffset` côté builder).
- **Toit** (`roof.ts`) : emprise = `roof.outline` ou `level.outline` ou bbox des pièces murées
  agrandie de l'épaisseur extérieure, puis débord par `offsetPolygon`. `flat` → dalle 20 cm ;
  `gable` → deux versants + deux pignons (faces planes absolues), faîte sur l'axe le plus long par défaut.
- **Bornes** (`bounds.ts`) : AABB absolues de pièce, niveau, zone, bâtiment (sans terrain) et maison
  (avec terrain et toit) pour le cadrage caméra.

*(Dépassé le 2026-09-26 : le terrain n'est plus toujours plat — `site.relief` le déforme (`packages/shared/src/house/geometry/relief.ts`) ; voir « Mise à jour 2026-09-26 — le relief du terrain (`relief.ts`) ». Sans relief, ces polygones restent plats.)*

## Invariants testés

Rectangle → 4 prismes ; une fenêtre → 7 (3 murs + gauche/allège/linteau/droite) ; pièces à 0,20 m →
segments `interior` et porte miroitée des deux côtés avec offset projeté ; coin rentrant d'une pièce
en L → quads convexes ; `none` → 0 prisme ; face extérieure continue à `y = −0,3` sur la maison démo.

### Mise à jour 2026-09-07 — ce qu'un relevé intérieur impose aux murs

Le passage d'une maison de démo à une maison relevée (cf. `2_0_format-house-json.md`) a rendu
explicites quatre règles, et une limite de l'algorithme.

**1. Le rentrement est proportionnel, pas moitié-moitié.** Deux faces en vis-à-vis doivent être
séparées de `t + t'`. Chaque face recule de l'épaisseur que **le voisin pousse dans elle** :

```
rentrement = t_voisin × (t + t' − écart_mesuré) / (t + t')
```

Deux pièces murées portant la même demi-cloison reculent donc chacune d'une demi-cloison — le cas
symétrique habituel. Mais face à une pièce **sans mur**, `t_voisin = 0` : la pièce murée ne bouge
pas et garde sa façade, et c'est la pièce sans mur qui absorbe toute l'épaisseur.

**2. Une pièce sans mur (`terrace`, `balcony`) n'est pas mitoyenne.** `WALLED_KINDS` l'exclut, donc
`classifySegments` classe en **façade** l'arête d'une pièce murée qui lui fait face — et c'est
correct : un sas ou une terrasse est hors enveloppe. Deux conséquences côté JSON : le polygone
d'une telle pièce est son **sol fini** (le décroché brut moins les façades qui le bordent), et elle
doit être exclue de l'emprise du niveau, sinon le toit vient la couvrir.

**3. Une arête ne porte qu'une nature et qu'une épaisseur.** Une arête à cheval — partie mitoyenne,
partie en façade (décroché de façade, ou voisin qui ne la longe que sur quelques centimètres) —
doit être **coupée** par un point **colinéaire** ajouté au relevé : la pièce mesurée est inchangée,
et chaque portion reçoit sa nature. Détection : comparer la longueur de l'arête à l'**union** de
ses recouvrements avec les voisins **murés** (un vis-à-vis avec une pièce sans mur ne rend pas
l'arête mitoyenne, il en fait une façade).

**4. Un alignement droit doit rester droit.** Après une coupe, les sous-arêtes colinéaires doivent
partager le même rentrement (le plus grand) : sinon le mur se voile d'une demi-cloison sur sa
longueur, et un décroché de quelques centimètres se transforme en mur en biais.

**Limite du sondage de classification.** Le sondage se fait à `2 × interiorWallThickness + 5 cm`
derrière le **milieu** de l'arête : il suppose donc que les pièces sont espacées comme le défaut
global. Avec des cloisons plus fines que ce défaut, ou quand le milieu de l'arête tombe pile en face
du joint entre deux pièces d'en face, le sondage ne trouve aucune pièce et classe un mur mitoyen en
**façade**. Parade : ne rien laisser deviner sur un niveau relevé — écrire `kind` explicitement sur
les arêtes mitoyennes, ce que fait `house/fit-survey.mjs` qui les connaît exactement (symptômes et
contre-mesures dans `../6_faq/6_1_pieges-runtime.md`).

### Mise à jour 2026-09-12 — deux pièces qui se partagent un angle de bâtiment se traversent

**Corrige** la parenthèse du point 3 ci-dessus (« les murs de pièces adjacentes s'aboutent sur un plan
commun (jamais de z-fight) »). C'est vrai **en vis-à-vis** — deux faces parallèles séparées de
`t + t'`, chacune remplissant sa moitié. Ce n'est pas vrai **en angle** : là, ce sont deux pièces
différentes qui portent les deux faces perpendiculaires, et `miterCorners` ne mitre qu'à l'intérieur
d'une pièce. Les deux prismes se croisent donc, avec faces coplanaires (z-fighting) et lame qui
dépasse — très visible en plongée serrée, signalé par l'utilisateur sur un angle du bâtiment.

Mesuré sur la maison réelle : **des paires de prismes qui s'interpénètrent**, la pire à 0,072 m² sur
toute la hauteur. Vérifié en retirant ce segment : la lame disparaît.

**L'arbitrage (`trimCrossRoomOverlaps`).** Les arêtes ne sont plus extrudées au fil de l'eau : on
construit d'abord la liste des `SegmentPlan` (arête + coins mitrés + hauteur + portion `u` restante),
on arbitre, puis on découpe. Pour chaque paire d'arêtes de **pièces différentes** et non parallèles
(|sin θ| ≥ 0,05 — au-delà on est en vis-à-vis, pas en angle) dont les empreintes se recouvrent de plus
de 1 cm², on rogne **en bout** celle dont la part retirée est **intégralement reprise** par l'autre mur
(`trimCandidate`). Trois refus explicites :

- l'autre mur est plus **bas** → on découvrirait un cran (le cas d'une annexe plus basse — plus possible depuis le 2026-09-25, cf. la mise à jour de ce jour) ;
- le recouvrement tombe **au milieu** de l'arête → un rognage en bout n'y peut rien ;
- la part retirée **déborde** de l'autre empreinte → on ouvrirait une fente.

Quand aucun des deux ne couvre l'autre, on **garde le recouvrement** : un trou dans une façade se voit
plus qu'une arête en biseau. Résultat : **le nombre de paires baisse**, toutes celles à 0,072 m² éliminées. Les
deux résidus à ~0,06 m² viennent du relevé lui-même — les
deux façades y sont posées à 9 cm l'une de l'autre, aucun rognage ne peut les joindre proprement.

Deux primitives nouvelles dans `vec2.ts` : `isConvex` et `clipConvex` (Sutherland–Hodgman, intersection
d'un polygone avec un convexe). C'est `clipConvex` qui sert à la fois à mesurer le recouvrement et à
vérifier la couverture — la même fonction pose le problème et garantit la solution.

**Tests** (`walls.test.ts`) : deux configurations d'angle à deux pièces, l'une où le voisin couvre le
bout (le mur recule à la face du voisin, recouvrement nul), l'autre où le mitre du voisin dépasse (rien
n'est rogné, le recouvrement reste). Plus `clipConvex` / `isConvex` dans `vec2.test.ts`.

### Mise à jour 2026-09-12 (bis) — au T façade / cloison, la façade passe devant

Deuxième défaut relevé par l'utilisateur, capture à l'appui : des **triangles creusés** dans le haut
des murs extérieurs, à chaque endroit où une cloison les rejoint.

`miterCorners` faisait converger la façade et la cloison vers un **point mitré commun**. Dans la bande
de 30 cm de la façade, le triangle compris entre les façades des deux pièces voisines — 8 cm de large
à la face intérieure, 30 cm de profond — n'était alors rempli que par les **pointes mitrées des deux
cloisons**. Or la scène 3D abaisse les cloisons à 1,05 m (`../1_architecture/1_5_scene-3d.md`) : au
dessus, les pointes disparaissent et le triangle se creuse. C'est pourquoi un balayage en plan, à
z = 0, ne voyait rien — il faut ne compter que les murs `exterior` pour que le vide apparaisse
(399 points de bande de façade tenus par une cloison seule à l'étage, 334 au rez-de-chaussée).

*(Dépassé le 2026-09-15 : l'abaissement des cloisons à 1,05 m (`LOW_INTERIOR_WALL`) a été retiré, les murs vont du sol au plafond, cloisons comprises (`apps/web/src/three/builders/buildHouse.ts`) — voir `../1_architecture/1_5_scene-3d.md`, « Mise à jour 2026-09-15 (sexies) ». Le raisonnement sur la façade qui passe devant la cloison reste utile : c'est l'invariant de géométrie plane qui compte.)*

`extendAcross` inverse la règle à ce coin-là : la **façade passe devant**. Son bout, perpendiculaire à
elle, avance de l'épaisseur de la cloison, c'est-à-dire jusqu'au **milieu de l'écart** entre les deux
pièces — exactement là où la façade voisine arrive en reculant de sa propre demi-épaisseur. Les deux
plans coïncident puisque l'écart VAUT la somme des deux demi-épaisseurs (c'est déjà l'invariant de
`MIRROR_TOL`), et ce raisonnement tient même pour un coin oblique. La cloison, elle, bute net sur la
face intérieure de la façade au lieu de la traverser.

Le débord est porté par deux champs nouveaux de `SegmentCorners` (`startExt` / `endExt`) et consommé
par le même mécanisme `u0` / `u1` que l'arbitrage d'angle ci-dessus — un `SegmentPlan` peut donc
déborder de `[0, L]` autant qu'il peut y être rogné. Résultat : 399 → 43 points à l'étage, 334 → 118
au rez-de-chaussée (les résidus sont des bouts de façade qui s'arrêtent vraiment là), et **11 → 3**
paires de prismes qui s'interpénètrent — les cloisons ne traversent plus la façade.

### Mise à jour 2026-09-12 (ter) — la hauteur d'une pièce est celle de son PLAFOND

Troisième constat de l'utilisateur : « le mur extérieur d'une annexe est plus bas que les autres ».
Cette annexe est la seule pièce de la maison réelle à déclarer une hauteur (relevée, plus basse que
celle du niveau), et `computeWalls` la donnait à TOUS ses murs — d'où une marche dans la façade
du bloc arrière, que sa voisine ne déclare pas.

Mais `room.height` décrit le **plafond**, pas l'enveloppe : c'est lui qu'`autoplace` lit pour accrocher
un plafonnier (`roomHeight(...) − CEILING_GAP`) et lui que `validate` compare à une ouverture. Une
façade appartient au bâtiment ; un faux plafond plus bas ne la fait pas redescendre.

`wallHeight(room, level, defaults, kind)` sépare donc les deux : une **cloison** suit le plafond de sa
pièce, une **façade** suit le niveau. `Math.max` et non la hauteur du niveau, pour qu'une pièce plus
HAUTE que son niveau garde sa façade haute. `roomHeight` est inchangé : l'information du relevé reste
exploitée là où elle a un sens.

Écarté : retirer `height` du JSON. Une ligne, mais le plafonnier de l'annexe serait remonté à
la hauteur du niveau. Hypothèse posée avec l'utilisateur : le bloc arrière n'a qu'une ligne de toiture. Si deux
hauteurs de toiture existaient vraiment, elles se modéliseraient par un niveau propre ou une toiture
dédiée, pas par la hauteur de pièce.

*(Dépassé le 2026-09-25 : une cloison ne suit plus le plafond de sa pièce, `wallHeight` rend `max(hauteur de la pièce, hauteur du niveau)` pour tous les murs (`packages/shared/src/house/geometry/walls.ts`) — voir « Mise à jour 2026-09-25 — aucun mur ne descend avec le plafond, cloisons comprises ».)*


### Mise à jour 2026-09-14 — `longestEdgeYawDeg` : l'axe d'une pièce

`vec2.ts` gagne une fonction pure : l'orientation de la **plus longue arête** d'un polygone, rendue
en degrés dans la convention `yaw` des appareils (0 = face à +y, sens trigonométrique), ou `null`
sur un polygone dégénéré.

```ts
// +y tourné de `yaw` donne (-sin yaw, cos yaw) : l'aligner sur l'arête, c'est atan2(-dx, dy)
return best ? (Math.atan2(-best[0], best[1]) * 180) / Math.PI : null
```

Son usage : orienter ce que le fabricant ne sait pas orienter. Dans un garage rectangulaire, la
grande arête est le sens dans lequel une voiture s'y range — c'est ce qui donne son cap au marqueur
d'un véhicule dont l'API ne publie pas de `headingDeg` (cf. `../1_architecture/1_5_scene-3d.md`).

Sources : `packages/shared/src/house/geometry/vec2.ts`, test `vec2.test.ts`.


### Mise à jour 2026-09-18 — la géométrie d'ÉDITION d'une ouverture (`openings.ts`)

Le pipeline de `walls.ts` traduit une ouverture en trous et en quads : il ne dit rien de **où une
ouverture a le droit de se poser**, ni de ce que devient un point attrapé au doigt. C'est l'objet
d'un module frère, `packages/shared/src/house/openings.ts`, pur comme le reste de la géométrie
(entrées : la pièce, les pièces du niveau, les défauts — aucun accès au fichier, aucun état).

**La règle est celle de `validate.ts`, mais prise à l'endroit.** La validation REFUSE (mur `none`,
débordement, chevauchement, plafond) ; ici on **RAMÈNE à l'emplacement admissible le plus proche**.
C'est la décision de conception du lot : un geste ne doit jamais pouvoir fabriquer une maison que le
serveur rejettera par un 400 — il doit **buter**.

**`slotFromPoint(room, roomsOnLevel, defaults, point, width, exceptId, from?)` : deux questions, dans
cet ordre**, parce que c'est ainsi qu'on lit un geste.

1. **Quel mur ?** Le plus proche du doigt parmi les porteurs possibles (`hostSegments` : la pièce est
   murée, le segment n'est pas `none`, et il lui reste un intervalle libre d'au moins `width` une
   fois retirées ses ouvertures — `freeRanges`). C'est ce qui fait **passer les coins** : on tire
   vers le mur d'à côté, l'ouverture y va, et les segments `none` sont sautés sans qu'on ait à les
   nommer.
2. **Où sur ce mur ?** Le doigt projeté sur l'arête, ramené dans un intervalle libre
   (`snapIntoRanges`).

**Le paramètre `from` est tout le sujet.** Il dit la place qu'occupe l'ouverture *en ce moment* ;
donné, il restreint l'étape 2 au **seul intervalle libre où elle se trouve déjà** (`rangeAt`). Sans
lui, « le plus proche » gagne — et c'est exactement ce que faisait la première version : l'ouverture
butait proprement contre sa voisine pendant 60 cm de course, puis **se téléportait de 1,80 m de
l'autre côté** dès que le doigt passait le milieu. Mesuré par la revue UI sur l'entrée de la maison
de démo (mur sud de 3 m, `porte-entree` en 1,00–1,90 ; on glisse `porte-salon`, 0,90 m de large) :

| doigt, depuis le coin | première version | avec `from` |
|---|---|---|
| 2,6 m | offset 2,10 | 2,10 |
| 2,2 → 1,6 m | 1,90 (elle bute) | 1,90 |
| **1,45 m** | **0,10** ← saut de 1,80 m | **1,90** |
| 1,2 → 0,2 m | 0,10 puis 0,00 | 1,90 |

Conséquence **voulue** : pour passer de l'autre côté d'une voisine, on **fait le tour de la pièce**
(`seg 0 → seg 1 → seg 2 → seg 3 → seg 0`, et l'ouverture se repose de l'autre côté). C'est ce que
« courir le long des murs » veut dire, et c'est ce qui rend le geste prévisible : la position ne
dépend que du chemin parcouru, jamais d'un basculement à mi-course.

**Nuance mesurée, à savoir.** En revenant sur un mur **depuis un autre mur**, l'ouverture n'est plus
« chez elle » : tous les intervalles redeviennent candidats, et c'est le point de retour qui décide
du côté. À égalité parfaite (retour à 3,40 m d'un mur dont les deux intervalles libres sont à 1,8 m),
c'est le **premier** intervalle qui gagne — donc le même côté qu'avant le tour. Il faut revenir
franchement au-delà de la voisine pour se poser de l'autre côté.

**Une fonction de bornage** complète le module :

- `openingLimits(room, defaults, opening, ceiling) → { maxWidth, maxHeight, maxSill }` — de quoi
  borner les champs du panneau **avant** d'écrire : la voisine de droite la plus proche borne
  l'élargissement (l'ouverture ne bouge pas de son bord gauche), l'allège et la hauteur sous plafond
  bornent la hauteur, et la hauteur de l'ouverture borne l'allège.

*(Dépassé le 2026-09-18 : la signature est `openingLimits(room, roomsOnLevel, defaults, opening, ceiling)` (`packages/shared/src/house/openings.ts`) — voir la section « Remplacement » de « Mise à jour 2026-09-18 (2) », `openingLimits` a changé de sens ET de signature.)*

**Invariants vérifiés** : 19 tests dans `openings.test.ts` (dont la butée et le passage de coin) ;
et, côté revue UI, un balayage de **1 200 positions** enchaînées comme un vrai glissement, dans et
hors de la pièce : `0 ≤ offset ≤ L − largeur` vrai 1 200 fois sur 1 200, chevauchement **0 fois**.

Sources : `packages/shared/src/house/openings.ts`, `packages/shared/src/house/openings.test.ts`,
`apps/web/src/stores/house.ts` (`previewOpeningAt`), `packages/shared/src/house/validate.ts`.


### Mise à jour 2026-09-18 (2) — GAUCHE et DROITE se disent de l'intérieur, et on garde la valeur tapée

Le module `openings.ts` a gagné, dans les lots suivants de la même session, ce qui manquait pour
**saisir** des cotes et non plus seulement en glisser une : une convention de côtés, et une règle de
bornage qui ne rogne pas ce qu'on tape.

#### `openingGaps` : les deux cotes qu'on relève au mètre ruban

`openingGaps(room, opening) → { left, right }` rend ce qui sépare l'ouverture de **chaque bout de son
mur**. C'est ainsi qu'on relève une maison — depuis les coins, pas depuis une origine de fichier — et
c'est ce que le panneau affiche comme ce que la scène annote pendant le déplacement (mêmes nombres,
une seule fonction).

**La convention, et c'est tout le sujet : gauche et droite se disent DE L'INTÉRIEUR de la pièce**,
parce que c'est de là qu'on mesure. Elle est posée **une fois, ici**, plutôt que laissée à chaque
écran qui affiche les deux nombres.

Pourquoi c'est déterminable sans regarder la pièce : `ccwPolygonSchema` impose le **sens
trigonométrique** (cf. plus haut sur cette page), donc l'intérieur est **toujours** à gauche de
l'arête `polygon[i] → polygon[i+1]`. Un observateur placé dedans et tourné vers le mur a donc le coin
`polygon[segment]` — **l'origine d'`offset`** — à sa **DROITE**. D'où, littéralement :

```
right = offset
left  = longueur du segment − offset − width     (jamais négatif)
```

L'interface a affiché **l'inverse** pendant un lot entier, et l'inversion ne se voit qu'en se mettant
mentalement dans la pièce : rien ne plante, les deux nombres restent justes, ils sont juste échangés.
Un test la garde désormais **par la géométrie et non par la constante** : il reconstruit la droite de
l'observateur depuis la **normale du mur** (`droite = avant × haut`) et vérifie qu'elle pointe vers le
coin d'origine. Le jour où le sens des polygones changerait, c'est ce test-là qui tombe, et il dira
pourquoi — un test qui aurait simplement figé `right === offset` se serait tu.

**Le format n'a pas bougé** : `house.json` ne connaît toujours qu'`offset`, la distance à
`polygon[segment]`. Gauche et droite sont une **lecture**, pas un champ.

`openingLabel(opening)` complète le module dans le même esprit : le nom s'il y en a un, sinon l'`id`.
Une seule règle, pour que le panneau, la liste de la pièce et l'étiquette 3D ne désignent jamais la
même fenêtre de trois façons.

#### La règle de bornage : on GARDE la valeur saisie, on DÉPLACE ce qui peut l'être

Borner un champ en rognant la valeur tapée est ce que faisait la première version, et c'est ce qui
ment : taper 3 m dans une fenêtre qui a **3 m de mur libre** mais seulement 1 m à sa droite donnait
**1 m**, sans dire pourquoi. La règle s'inverse : **la valeur saisie est gardée si elle passe
quelque part**, et c'est l'ouverture qui se déplace pour la laisser passer.

Quatre fonctions pures la portent :

| Fonction | Ce qu'elle rend | Ce qui bouge |
|---|---|---|
| `freeSpan(room, roomsOnLevel, defaults, opening)` | `{ u0, u1 }` — **le vide où l'ouverture est posée**, voisines retirées, en abscisses depuis `polygon[segment]` | rien (c'est la brique des trois autres) |
| `fitWidth(…, wanted)` | `{ width, offset }` | l'ouverture **glisse** vers la gauche quand il n'y a plus de place à droite |
| `fitHeight(sill, height, ceiling, wanted)` | `{ height, sill }` | c'est l'**allège qui descend** quand la hauteur ne tient plus sous le plafond (jamais sous le sol) |
| `fitGap(…, side, wanted)` | `offset` | on saisit **l'une des deux cotes**, mesurée depuis un coin ; l'autre suit |

Le cas qui résume tout, mesuré au navigateur : **9 m tapés** sur un mur qui offre 4,90 m de vide →
largeur **4,90**, et les deux cotes retombent à 0 des deux côtés (l'ouverture a pris tout son
intervalle). De même, `gauche = 0` fait suivre `droite` à `4,90 − largeur` dans le **même rendu** :
les deux valeurs partent dans une **seule écriture** (`width` + `offset`, ou `height` + `sill`),
sinon la carte montrerait un instant deux nombres incohérents.

`MIN_OPENING_DIM = 0.3` (m) plancher les deux dimensions, et **tous les résultats sont arrondis au
centimètre** avant d'entrer dans le JSON (`Math.round(v * 100) / 100`) : un relevé de maison ne se
note pas au dixième de millimètre, et un fichier lisible vaut mieux qu'une précision fictive.

#### `openingLimits` a changé de sens ET de signature

> **Remplacement.** Plus haut, cette page décrivait `openingLimits(room, defaults, opening, ceiling)`
> avec « la voisine de droite la plus proche borne l'élargissement (l'ouverture ne bouge pas de son
> bord gauche) ». **Depuis le 2026-09-18, ce n'est plus vrai** — ni la signature, ni le sens.

La fonction prend désormais **les pièces du niveau** (`openingLimits(room, roomsOnLevel, defaults,
opening, ceiling)`, il lui faut classifier les segments pour connaître les vides) et elle borne
**large**, en accord avec la règle ci-dessus :

- `maxWidth` = la longueur du **vide entier** où l'ouverture est posée (`freeSpan`), et non ce qui
  reste à sa droite : on peut l'élargir jusqu'à remplir son intervalle, **elle glissera pour
  passer** ;
- `maxHeight` = la **hauteur sous plafond**, et non ce qui reste au-dessus de l'allège : c'est
  **l'allège qui descend** ;
- `maxSill` = `plafond − hauteur`, inchangé.

Autrement dit, les bornes ne servent plus à dire « tu ne peux pas », mais à dire « au-delà, même en
déplaçant, ça ne rentre nulle part ». C'est ce que le serveur refuserait de toute façon (`parseHouse`
et son 400, cf. `2_0_format-house-json.md`) ; tout le reste est absorbé par le mouvement.

Sources : `packages/shared/src/house/openings.ts` (`openingGaps`, `openingLabel`, `freeSpan`,
`fitWidth`, `fitHeight`, `fitGap`, `openingLimits`, `MIN_OPENING_DIM`),
`packages/shared/src/house/openings.test.ts` (dont « names the sides as seen from INSIDE the room »),
`apps/web/src/components/home/OpeningPanel.vue`, `apps/web/src/three/HouseScene.ts`
(`refreshOpeningNotes`).


### Mise à jour 2026-09-18 (3) — `newOpeningDims` : les cotes d'une ouverture qui vient de naître

Poser une ouverture demande des cotes avant que l'utilisateur n'ait rien mesuré.
`newOpeningDims(type, defaults)` les donne, et ce sont des valeurs de **catalogue** : elles n'ont pas
à être justes, elles ont à être **plausibles** pour qu'on reconnaisse dans la scène ce qu'on vient de
poser. Le relevé les corrigera au centimètre dans le panneau.

| Nature | Largeur | Hauteur | Allège |
|---|---|---|---|
| `window` | 1,20 m | 1,20 m | `defaults.windowSill` |
| `door`, `passage`, `glass-door` | 0,90 m | `defaults.doorHeight` | 0 |
| `garage`, `bay` | 2,40 m | `defaults.doorHeight` | 0 |

Deux choix valent d'être retenus. **Les hauteurs viennent de LA maison** (`doorHeight`,
`windowSill`) et non de constantes : régler ces défauts une fois doit valoir pour tout ce qu'on pose
ensuite. Et **la fenêtre arrive en haut à la hauteur d'une porte** — 0,90 + 1,20 = 2,10 avec les
défauts du schéma : c'est ce qu'on voit sur une façade, et c'est pourquoi les deux nombres vont
ensemble plutôt que d'être choisis séparément.

Ces cotes passent ensuite par les mêmes règles que le panneau : `fitHeight` à la naissance, parce
qu'une hauteur de catalogue ne tient pas forcément sous CE plafond — et c'est alors **l'allège qui
descend**, jamais la hauteur qui se rogne (voir la mise à jour du 2026-09-18 plus haut). La place,
elle, sort de `slotFromPoint` appelé avec un `exceptId` qui ne correspond à aucune ouverture
existante : rien à exclure, puisque celle qu'on pose n'est pas encore dans la pièce.

Sources : `packages/shared/src/house/openings.ts` (`newOpeningDims`),
`packages/shared/src/house/openings.test.ts`, `packages/shared/src/house/defaults.ts`,
`apps/web/src/stores/house.ts` (`placeOpeningAt`).

### Mise à jour 2026-09-18 (4) — `openingLeaves` : le nombre de vantaux, déduit quand le fichier se tait

`openings[].leaves` est facultatif (`2_0_format-house-json.md`), donc quelqu'un doit répondre pour
les ouvertures qui n'en disent rien. C'est `openingLeaves(o)`, posée dans
`packages/shared/src/house/geometry/walls.ts`, à côté d'`openingSill` — pour la même raison qu'elle :

- **le nombre du fichier passe devant**, s'il est là ;
- sinon, une **baie vitrée** se déduit de sa largeur — `round(width / 1.6)` borné entre 2 et 3, ce
  qui est la règle qui vivait jusqu'ici en dur dans le constructeur 3D (`BAY_VANE_W`) ;
- **tout le reste vaut 1**, quelle que soit sa largeur.

Pourquoi dans `geometry/walls.ts` et pas dans `openings.ts`, qui porte pourtant tout le reste du
vocabulaire d'une ouverture : `computeWalls` en a besoin, et `openings.ts` importe déjà `walls.ts`
(`classifySegments`) — la placer là-bas ferait un **cycle d'imports**. C'est le même arbitrage que
pour `openingSill`, et c'est pourquoi les deux fonctions se retrouvent voisines dans un module qui
ne parle sinon que de murs.

**`OpeningRect` porte maintenant la menuiserie**, en plus de sa place et de ses cotes : `leaves`
(le nombre EFFECTIF, jamais l'optionnel du fichier), `material` et `color` s'il y en a. Le
descripteur reste le contrat testé, sans dépendance à Three : le constructeur 3D n'a rien à
recalculer ni à aller rechercher dans la maison pour savoir quoi dessiner.

Sources : `packages/shared/src/house/geometry/walls.ts` (`openingLeaves`, `computeWalls`),
`packages/shared/src/house/geometry/types.ts` (`OpeningRect`),
`packages/shared/src/house/openings.test.ts`.

### Mise à jour 2026-09-18 (5) — `openingCentre` : le point qu'occupe ce qui habille une baie

`computeWalls` rend le rectangle d'une ouverture (`OpeningRect` : `origin` au coin bas-gauche de la
face intérieure, `u` le long du mur, `normal` vers l'extérieur). Son CENTRE se recalculait à la main
partout où l'on en avait besoin — et nulle part pour la pilule d'un marqueur, qui restait sur la
`position` du JSON, périmée.

`openingCentre(rect)` (`geometry/walls.ts`) le dit une fois : `origin + u · width / 2` en plan,
`origin.z + height / 2` en hauteur. Le z est LOCAL au niveau, comme l'origine du rectangle et comme
la `position` d'un appareil ancré dans une pièce — c'est ce qui permet de l'écrire tel quel dans le
fichier.

C'est le point d'ancrage de tout ce qui habille une baie : le marqueur d'un ouvrant lié
(`../1_architecture/1_5_scene-3d.md`) et la place recalée à l'écriture
(`2_0_format-house-json.md`). Le cadrage caméra d'une ouverture (`focusOpening`) garde son propre
calcul : il lui faut aussi l'élévation du niveau et les deux cotes de position.

### Mise à jour 2026-09-19 — géométrie de surface : trous de sol et de toit

`geometry/surface.ts` calcule les `OpeningRect` de surface (`host: 'floor' | 'roof'`), les trous
de dalle (`FloorHole` sur les `skylight`) et les trous de toiture (`RoofHole` via `roofHolesOf` pour
toutes les `roof-window` de la maison).

- **Sol** : `floors.ts` extrude la dalle avec `extrudePolygonWithHoles` quand il y a des puits.
- **Toit plat** : `buildRoofMesh` extrude l'emprise avec les polygones des Velux.
- **Toit à pentes** : `planarFacesWithHoles` découpe chaque face dont `faceIndex` porte un trou
  (coins 3D relevés sur le plan du versant).
- **Cap par défaut** d'un Velux : `defaultRoofYaw` = sens de la descente du versant au point tapé.
- **Cotes d'édition** : `surfaceGaps` / `fitSurfaceGap` réutilisent la règle des places
  (quatre côtés dans le sens du `yaw`).

`OpeningRect` gagne `host`, `yaw?`, `slope?`. Le cadre 3D d'une surface reste dans le plan XY du
porteur (pas de `rotateX` mural).

Sources : `packages/shared/src/house/geometry/{surface,floors,types,index}.ts`,
`apps/web/src/three/builders/{buildHouse,shapes}.ts`.

### Mise à jour 2026-09-25 — aucun mur ne descend avec le plafond, cloisons comprises

Remplace la règle de la mise à jour 2026-09-12 (ter) (commit `63cbdf5`), qui faisait suivre le
plafond de la pièce aux **cloisons**. Constat de l'utilisateur : « une annexe a un problème au niveau
des murs » — des diagonales en haut de ses deux cloisons, vues en plongée.

Diagnostic : une cloison est UN mur dont chaque pièce porte une moitié. Celle de l'annexe, déclarée
plus basse, s'arrêtait à sa hauteur, la moitié voisine montait au niveau : il restait une marche de
40 cm sur 4 cm de retrait, dont l'**ombre** dessinait les diagonales. Relevé par `computeWalls` sur la
maison réelle : deux segments de l'annexe plus bas que ceux de ses voisines.

`wallHeight(room, level, defaults)` rend désormais `max(roomHeight, hauteur du niveau)` pour **tous**
les murs ; le paramètre `kind` disparaît (`packages/shared/src/house/geometry/walls.ts`). La scène n'a
pas de plafond : un mur abaissé à un faux plafond n'y montre qu'une marche. `roomHeight` reste la
hauteur sous plafond (plafonnier d'`autoplace`, contrôle des ouvertures dans `validate`).

Conséquence sur `trimCandidate` : le refus « l'autre mur est plus bas » ne se produit plus que face à
une pièce plus HAUTE que son niveau ; l'annexe n'en est plus l'exemple.

Dans la foulée, l'utilisateur a retiré la déclaration de hauteur de l'annexe dans
`house/maison.json` (origine inconnue). Le test « un plafond plus bas ne fait redescendre ni la façade
ni la cloison » (`walls.test.ts`) est conservé : il exige qu'une cloison ait la même hauteur que sa
moitié voisine.

Sources : `packages/shared/src/house/geometry/{walls,walls.test}.ts`, `house/maison.json`.

### Mise à jour 2026-09-26 — le relief du terrain (`relief.ts`)

`computeTerrain(site, pads, footprints)` rend désormais, en plus du polygone et de sa cote, le
**relief parsé** (`ReliefGrid`, `null` = plat) et deux listes d'emprises. La hauteur en un point est
`terrainHeight(terrain, x, y)` ; sans relief, c'est `terrain.z` partout — le chemin d'avant.

**Lissage : cubique MONOTONE (Fritsch–Butland), en produit tensoriel.** La surface passe PAR les
nœuds — la poignée qu'on tire est à la hauteur affichée — et, entre deux nœuds, ne sort jamais de
leurs hauteurs. La pente en un nœud est la moyenne harmonique des deux pentes voisines, nulle quand
elles changent de signe. Première version en **Catmull-Rom**, abandonnée le jour même : elle
dépasse, et un plateau suivi d'une chute gagnait une bosse avant la descente (signalé sur la maison
réelle) et un creux d'environ 5 cm au pied du talus. Contrepartie assumée : le sommet d'une bosse
isolée est un peu plus plat.

**Sous la maison : écrêté, pas aplani.** Une première version aplanissait le terrain sous le bâti et
sur 3 m autour ; elle empêchait un talus de venir toucher un mur. Désormais (`terrainFootprints`) :
- une **emprise par pièce**, élargie de la **moitié du mur extérieur** (qui se pose DEHORS, contre le
  contour de la pièce, cf. `walls.ts`) ;
- son **plafond** = le dessous de la dalle du niveau (`elevation − slabThickness`), jamais sous
  `site.elevation` ;
- le terrain y vaut `min(surface, plafond)` (`footprintCeiling`). Le passage du terrain libre au
  terrain écrêté tombe dans l'épaisseur du mur, et la terre touche la face extérieure à sa vraie
  hauteur. Mesuré sur la démo : talus de 1,20 m → 1,18 m contre la face, sol de la pièce inchangé.
- **Sous un étage en porte-à-faux**, le plafond est le plancher de l'étage : le terrain y reste libre
  jusqu'à 2,60 m.
- Les **contours de niveau** (`outline`) ne comptent pas : sur la maison réelle, ce sont des
  rectangles approchés, plus grands (RDC) ou plus petits (étage) que les pièces.
- `reliefSurface(terrain, x, y)` rend la surface AVANT écrêtage : c'est la hauteur d'un nœud qu'on
  tire, même sous la maison.

**Autour d'un bassin : palier plat.** `terrainPads` ne liste plus que les **piscines** : plat
dessous et sur `PAD_FLAT` = 1 m autour, raccord en douceur (`smoothstep`) sur `PAD_BLEND` = 2 m. Sans
cela la margelle flotterait ou s'enterrerait ; et le maillage, découpé autour du bassin, n'y montre
aucune fente puisque tout y est à la même hauteur.

Tests : `packages/shared/src/house/geometry/relief.test.ts` (relecture, nœuds traversés, plateau
puis chute sans dépassement, palier de bassin, écrêtage contre le mur et sous l'étage, grille vide
calée sur le pas).

Sources : `packages/shared/src/house/geometry/{relief,site,types,index,bounds}.ts`.

### Mise à jour 2026-09-26 — la longueur d'un Velux se mesure le long de la pente

**Convention (décision de l'utilisateur)** : pour une `roof-window`, `height` (l'axe du cap) est la
**longueur le long de la pente**, c'est-à-dire la taille du fabricant (un Velux 78 × 118 cm s'écrit
tel quel), comme la longueur d'un module photovoltaïque. Vue du ciel, elle vaut
`height × cos(pente)` : `planLength(height, slopeDeg)`, exporté de `geometry/walls.ts` (à côté
d'`openingCentre`, pour éviter le cycle `openings.ts` → `walls.ts`). `width` ne penche pas.

Avant ce jour, le trou était dimensionné **en plan** (1,2 m vus du ciel, soit ≈ 1,46 m sur une pente
de 35°) alors que la vitre faisait 1,2 m le long du versant : 13 cm de verre manquaient à chaque bout.

Ce qui suit la convention :
- **Trou** : `roofHolesOf` découpe `surfaceCorners(…, planLength(height, at.slope))`, relevé sur le
  plan de la face.
- **`OpeningRect` d'un Velux** : coin `origin` calculé avec la longueur en plan ; `origin[2]` =
  hauteur du versant au centre **moins `depth / 2`**, pour que `origin[2] + depth / 2` (centre du
  verre, de la poignée, cible du cadrage) tombe **sur le plan du versant**. Avant, le centre était
  10 cm au-dessus (toit sans épaisseur, `depth` par défaut 0,2) : la vitre flottait.
- **`openingCentre`** : le décalage le long du cap vaut `planLength(height, slope)` (pente nulle =
  inchangé pour un puits de lumière).
- **Cotes** : `surfaceGaps(room, opening, slopeDeg = 0)` et `fitSurfaceGap(…, slopeDeg = 0)`
  mesurent depuis le bord du **trou**. Démo : `velux-ch1` affiche 2,61 / 1,31 / 1,95 / 1,95 m
  (2,50 / 1,20 avant).

**Restent en longueur non raccourcie** (plus grande qu'en vrai, donc prudent) :
`surfaceFitsInPolygon` (le Velux tient dans la pièce, `validate.ts`), `surfaceRectsOverlap`
(chevauchement), `slotFromSurfacePoint` (pose au doigt). Aucun ne connaît le toit.

**Limite connue** : la pente s'applique autour de l'axe de largeur, c'est-à-dire en supposant que le
cap suit la descente du versant (`defaultRoofYaw`). Un Velux tourné de 90° sur son versant serait
mal incliné et mal raccourci.

Tests : `packages/shared/src/house/surface-openings.test.ts` (cotes sur une pente de 60°, glissement
par cote), `apps/web/src/three/builders/roofWindow.test.ts` (le verre remplit le trou coin pour coin).

Sources : `packages/shared/src/house/geometry/{walls,surface}.ts`, `packages/shared/src/house/openings.ts`.

### Mise à jour 2026-09-26 (bis) — un Velux sur un versant suit la pente : `surfaceFootprint`

**Remplace** deux points de la section précédente du même jour (« Restent en longueur non
raccourcie » et « Limite connue »), laissés ci-dessus pour l'historique.

**Décision de l'utilisateur** : sur un versant, un Velux suit la pente, comme une vraie pose. Son cap
est la **descente** (`defaultRoofYaw`) ; le `yaw` écrit dans le JSON est ignoré, et le Velux se
retourne seul s'il passe sur l'autre versant. L'option « cap libre » (emprise en parallélogramme,
contrôles sur quatre coins quelconques) a été écartée : beaucoup de code pour une pose qui n'existe
guère.

**Une seule source de l'emprise en plan** : `surfaceFootprint(opening, roof)` (`geometry/surface.ts`)
rend `{ x, y, yaw, width, height, slope }`. Sur un versant : cap de la descente, `height` raccourci
(`planLength`), `slope` de la face. Puits de lumière, toit plat, pas de toit sous le point : l'ouverture
telle qu'écrite, `slope: 0`. Tout ce qui raisonne en plan passe par elle :
- le trou (`roofHolesOf`) et l'`OpeningRect` du Velux (`computeSurfaceOpenings`), dont `yaw` et `u`
  sont désormais ceux de l'emprise : vitre, poignée et `openingCentre` suivent sans changement ;
- la **validation** (`validate.ts`) : « tient dans la pièce » et chevauchement jugés sur l'emprise. Le
  toit n'est calculé que si un Velux le demande (`computeRoof`, mémorisé) ; s'il ne se calcule pas
  (maison encore invalide ailleurs), le Velux est jugé sur ses cotes écrites, comme avant ;
- la **pose** et le **glissement** au doigt (`apps/web/src/stores/house.ts` : `placeOpeningAt`,
  `previewOpeningAt`) : `slotFromSurfacePoint` reçoit le cap et la longueur de l'emprise au point visé ;
- les **cotes** : `surfaceGaps` / `fitSurfaceGap` reprennent leur signature d'origine (le paramètre
  `slopeDeg` de la section précédente est retiré) ; c'est l'appelant qui leur passe l'emprise
  (`OpeningPanel.vue` via `surfaceFootprint`, `HouseScene.refreshOpeningNotes` via le cap et la pente
  de l'`OpeningRect`). Cela évite un cycle `openings.ts` ↔ `surface.ts`.

**Bug corrigé dans `defaultRoofYaw`** : il prenait l'opposé de la projection horizontale de la normale.
Une normale montante penche vers l'**aval** : sa projection est la descente. Jusqu'à ce jour, un Velux
posé au doigt regardait donc le faîtage ; celui de la démo n'était juste que parce que son `yaw: 180`
était écrit à la main.

Tests : `packages/shared/src/house/surface-openings.test.ts` (emprise au sud et au nord, puits et
absence de toit inchangés, Velux accepté contre le mur sud grâce à sa longueur raccourcie,
`defaultRoofYaw` = 180 sur le versant sud), `apps/web/src/three/builders/roofWindow.test.ts` (la vitre
suit la pente malgré un cap faux dans le JSON).

Sources : `packages/shared/src/house/geometry/surface.ts`, `packages/shared/src/house/{validate,openings}.ts`,
`apps/web/src/stores/house.ts`.

### Mise à jour 2026-10-01 — `isSimplePolygon` et `extendReliefGrid`

Deux fonctions pures ajoutées pour l'édition du contour du terrain (contexte :
`2_0_format-house-json.md`, section du même jour).

- **`isSimplePolygon(poly)`** (`geometry/vec2.ts`) : au moins 3 sommets, aire non nulle, aucun côté
  de longueur nulle, et deux côtés NON voisins ne se touchent pas — un simple contact (sommet posé
  sur un autre côté) compte comme croisement, à la tolérance `EPS` près. Les côtés voisins par la
  fermeture sont écartés du test. Un contour en huit ou qui se replie n'a pas d'intérieur clair :
  le terrain, sa jupe et le test « dedans / dehors » n'auraient plus de sens.
- **`extendReliefGrid(grid, polygon)`** (`geometry/relief.ts`) : ajoute colonnes et rangées pour
  couvrir le polygone **plus une maille de marge**. Nœuds existants intacts (place et hauteur),
  nouveaux = hauteur du bord le plus proche (l'écrêtage de `node()` hors grille). Rend la MÊME
  grille (égalité de référence) quand rien n'est à faire : les appelants s'en servent pour ne rien
  réécrire. Elle ne rétrécit jamais.

Tests : `vec2.test.ts`, `relief.test.ts`.

Sources : `packages/shared/src/house/geometry/{vec2,relief}.ts` (arbre de travail non commité après 1ce4a91).
