# Jardin : arbres, buissons, pierres

> Dernière mise à jour : 2026-10-06
> Sources : `packages/shared/src/house/{schema,validate,place}.ts` (`gardenItemSchema`, `GARDEN_KINDS`, `addGardenItemToJson` / `patchGardenItemInJson` / `removeGardenItemFromJson`), `packages/shared/src/house/place.test.ts` (« éléments du jardin »), `apps/server/src/http/routes.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/stores/house.ts` (section jardin, `GARDEN_DEFAULT_HEIGHT`), `apps/web/src/stores/settings.ts` (`sceneSeason`), `apps/web/src/three/garden/{shapes,gardenLayer,species,speciesShape,season}.ts`, `apps/web/src/three/garden/species/*.json` (21 espèces), `apps/web/src/three/garden/hedgeShape.ts`, tests `apps/web/src/three/garden/{shapes,species}.test.ts`, `apps/web/src/three/HouseScene.ts`, `apps/web/src/composables/useHouseScene.ts` (`sameShellButGarden`), `apps/web/src/components/home/{GardenSection,GardenPanel,HouseEditPanel,EditSection}.vue`, `apps/web/src/views/SettingsView.vue`, `apps/web/src/lib/gardenIcons.ts`, `.claude/skills/garden-species/SKILL.md`, `scripts/photo-palette.mjs`, journal de session `_generated-ai-doc/sessions/2026-09-28-jardin/journal.md` (non versionné) ; arbre de travail non commité après cf60c7d

Le jardin de la vue 3D reçoit du **décor posé à la main** : arbres, buissons, pierres. Ce ne sont
pas des appareils. Ils n'ont ni état ni plugin, et rien ne les commande. Ils vivent dans
`site.garden[]` de la maison, se posent depuis le mode édition exactement comme une place de
stationnement, et se dessinent en **low-poly facetté procédural**, sans aucun fichier 3D. Des
**espèces** (« cerisier ») affinent la forme générique d'une famille. Ce sont des recettes JSON
qu'une skill écrit à partir d'une photo, et elles changent avec la **saison**.

## Pourquoi de la végétation, alors qu'elle avait été exclue

Le 2026-09-15, la maquette de la vue immersive avait fixé « ni meubles ni arbres », et la décision
avait été reconduite le même jour pour les assets (cf. `../1_architecture/1_5_scene-3d.md`,
sections 2026-09-15 quinquies et duodecies). **Le 2026-09-28, l'utilisateur la lève pour la
végétation**, à une condition : ce qui pousse est ce qu'**il** plante, élément par élément. Aucune
forêt décorative n'est générée d'office. Le mobilier reste exclu.

## Le format : `site.garden[]`

Un élément porte (`gardenItemSchema`, `schema.ts`) :

| Champ | Rôle |
|---|---|
| `id` | unique **dans toute la maison** (`validate.ts`, comme pièces, zones et places). L'UI écrit `garden.<famille>-<n>` |
| `kind` | `broadleaf` (feuillu), `fruit` (fruitier), `conifer`, `palm`, `bamboo`, `shrub` (buisson), `rock` (pierre), `hedge` (haie, depuis le 2026-09-29 ; `bamboo` et `fruit` ajoutés le soir même, voir plus bas) |
| `center` | pied de l'élément, en m dans le repère maison |
| `height` | 0,1 à 40 m. C'est **le seul réglage de taille** |
| `yaw` | optionnel, en degrés, sens trigonométrique comme le `yaw` d'un appareil. Absent = 0 |
| `seed` | optionnel : la graine de la forme. Absente = hachage FNV-1a de l'id |
| `length`, `width`, `spacing` | haie seulement, optionnels : longueur (0,5 à 100 m, 3 par défaut) et largeur (0,2 à 5 m, 0,7 par défaut) du segment, espacement de pied à pied de ses sujets (0,2 à 5 m ; absent = automatique) |
| `species` | optionnel : id d'une recette **de l'application** |
| `meta` | libre, comme ailleurs |

Trois choix derrière ces champs :

- **Seule la hauteur se règle.** La largeur découle de la famille et de la forme tirée (la
  carrure vient du générateur, cf. plus bas). Les bornes, d'après le commentaire du schéma : un
  caillou de 5 cm disparaît dans le gazon, un arbre de 40 m sort du cadre.
- **Graine absente = hachage de l'id.** Deux sapins de même hauteur ne sont pas jumeaux, et le
  fichier n'a pas à écrire une graine pour chaque élément. « Autre forme » en écrit une, tirée au
  hasard.
- **`species` est un nom, pas une géométrie.** Le catalogue vit dans l'app (`three/garden/species/`),
  pas dans la maison. Une espèce inconnue de l'app qui lit le fichier, ou d'une autre famille que
  `kind`, donne simplement la forme générique de la famille (`speciesOf`). Un fichier maison reste
  donc valide d'une version de l'app à l'autre.

Écritures (`place.ts`) : comme pour les places, on patche le JSON brut puis `parseHouse` valide.
`addGardenItemToJson` refuse un id déjà pris dans le jardin. Un id repris d'une pièce est rejeté par
la validation d'unicité globale (test « rejette une maison où un élément reprend l'id d'une
pièce »). `patchGardenItemInJson` ne pose que les champs présents. **Un `yaw` nul et un `species`
vide sont effacés**, pas écrits : ce sont les valeurs par défaut, et la chaîne vide est justement
le moyen de revenir à la forme générique. `removeGardenItemFromJson` n'a rien à libérer : aucun
autre objet ne nomme un élément du jardin.

## REST et transport

`POST /api/house/garden`, `PUT` et `DELETE /api/house/garden/:id`, sur le modèle exact des places
(`newGardenItemSchema` et `gardenItemPatchSchema`, ZodError → 400, écriture atomique, diffusion
`{ type: 'house' }`). Détail dans `../1_architecture/1_3_protocole-rest-ws.md`. Côté web :
`Transport.addGardenItem` / `saveGardenItem` / `removeGardenItem`, en HTTP et en mock in-process.

## Planter, régler, glisser (store et UI)

Réglages → Mode édition → **« Régler la maison et le jardin »** (libellé élargi ce jour-là).
Le panneau de la maison en édition gagne une section **Jardin** (`GardenSection.vue`) : cinq tuiles
de famille, une pastille par espèce du catalogue, un bouton « Terminé » et une ligne d'aide.

*(Dépassé le 2026-09-29 (soir) : il y a désormais huit familles, `GARDEN_KINDS` (`packages/shared/src/house/schema.ts`) — feuillu, fruitier, conifère, palmier, bambou, buisson, pierre, haie ; voir « Mise à jour 2026-09-29 (soir) - panneau en accordéon, familles Bambou et Fruitier, cinq espèces sans photo ».)*

- **L'arme reste levée.** Toucher une famille (ou une espèce) l'arme (`placingGarden`). Chaque tap
  sur le terrain plante alors un élément, **sans désarmer**, parce qu'on plante souvent plusieurs
  arbres d'affilée, une haie par exemple. « Terminé » ou un tap hors du terrain baisse l'arme.
  Toucher à nouveau la tuile armée la désarme aussi.
- **« Terminé » est toujours là**, grisé quand rien n'est armé. Seul son état change, pour que la
  section ne saute pas au moment où l'on arme (règle « rien ne bouge »).
- **Seul le terrain accueille un élément.** Un tap sur un sol de pièce ou sur un toit annule
  (`gardenPlaceTap` n'est émis que si `groundPoint` ne trouve aucun niveau). Un arbre ne pousse pas
  dans le salon.
- **À la naissance**, un élément prend la hauteur type de sa famille (`GARDEN_DEFAULT_HEIGHT` :
  feuillu 7 m, conifère 9, palmier 6, buisson 1,2, pierre 0,6) ou celle de son espèce, et un
  **cap tiré au hasard** : une rangée posée un à un n'a pas l'air clonée.
- **Sélection et glissement.** En mode édition, un tap sur un élément le sélectionne et cadre la
  vue dessus (`focusGarden`). Un anneau d'accent apparaît au pied. On le glisse au doigt sur un plan
  horizontal au pied, en gardant l'écart entre le doigt et le pied (même règle qu'une place). Le
  glissement ne fait qu'un **brouillon** (`gardenDraft`, superposé à la maison comme celui des
  places). Le fichier n'est écrit qu'au lâcher. Un tap à côté désélectionne.
- **`GardenPanel.vue`** (mêmes idiomes que `ParkingPanel`) : famille, espèce (« Générique » plus
  les espèces de **cette** famille ; changer de famille efface l'espèce, qui appartenait à
  l'ancienne), hauteur par −/+ et saisie (pas de 0,1 m sous 2 m pour les buissons et les pierres,
  0,5 m au-dessus pour les arbres), orientation par pas de 15°, « Autre forme » (graine neuve, rien
  d'autre ne change), suppression en deux temps (confirmer dans les 4 s).
- Icônes trait `treeBroadleaf`, `treeConifer`, `treePalm`, `shrub`, `rock` (`lib/strokeIcons.ts`,
  table `lib/gardenIcons.ts`).

> Mis à jour le 2026-10-06 (lint) : `GARDEN_DEFAULT_HEIGHT` (`apps/web/src/stores/house.ts`) compte huit valeurs : feuillu 7 m, fruitier 5, conifère 9, palmier 6, bambou 5, buisson 1,2, pierre 0,6, haie 1,8.

Dans la scène, **un arbre passe avant tout le reste au lancer de rayon, mais seulement en mode
édition** (`pick`). C'est le seul moment où on le touche. Hors édition, il ne doit pas voler le tap
destiné à la pièce ou à l'appareil derrière lui : hors édition, les éléments ne sont pas
touchables du tout. Et **glisser un arbre ne recharge pas la maison** :
`sameShellButGarden` (`useHouseScene.ts`) reconnaît une maison identique au jardin près et n'appelle
que `updateGarden`.

## Le style : low-poly facetté, procédural, sans fichier

C'est la décision qui a le plus bougé dans la session. Le chemin, pour ne pas le refaire :

1. **Procédural lisse (v1).** Formes générées et ombrées en lisse, première version.
2. **Quaternius « Stylized Nature MegaKit »** (CC0, texturé) : téléchargé et branché derrière le
   switch « assets » des styles. **Retiré à la demande de l'utilisateur**, qui préfère le rendu
   facetté de Pure Poly. Deux obstacles au passage : les liens officiels (Google Drive) rendaient
   une page HTML « quota dépassé » (2 009 octets) au lieu du fichier, et le dossier glTF du pack était
   incomplet (pas de palmiers). Il n'en reste aucun fichier dans le dépôt.
3. **Pure Poly lui-même** (https://pure-poly.artstation.com/, la référence donnée par
   l'utilisateur) : **écarté**. Le pack gratuit n'a ni palmier ni buisson, le pack complet coûte
   119,94 $, il faut un compte ArtStation, et la licence n'est pas CC0.
4. **Retenu : du facetté procédural, dans l'esprit de Pure Poly.** Aucun fichier à télécharger, à
   héberger ou à licencier. La silhouette se règle par du code et des recettes.

Ce qui fait le grain « palette » sans texture (`facet`, `shapes.ts`) : peu de faces, des faces
**non indexées** (chaque triangle a ses sommets, donc sa normale), et une **clarté par face** en
couleur de sommet, un peu aléatoire et **plus claire vers le haut**, comme un houppier pris par le
ciel.

Mécanique de rendu (`GardenLayer`) :

- **4 variantes de forme par famille**, choisies par `graine % 4`. La dernière variante de conifère
  est un cyprès en colonne plutôt qu'un sapin étagé.
- **Une `InstancedMesh` par (famille ou espèce, variante, matière)** : `bark`, `leaf`, `stone`,
  `accent`. Trente sapins de quatre formes coûtent huit appels de dessin, pas soixante. L'échelle,
  la rotation, une carrure de ±10 % et une teinte voisine tirées de la graine font le reste : un
  bosquet n'est pas d'un vert uniforme. Les géométries sont en cache et partagées. Seules les
  matrices sont réécrites quand on glisse ou qu'on change une hauteur.
- Chaque forme mesure **exactement 1 de haut**, pied à 0, et c'est l'échelle de l'instance qui
  applique `height`. Ainsi la hauteur écrite dans la maison est exacte quelle que soit la forme
  tirée. Une pierre est enterrée d'un cinquième.
- **Le pied suit le relief** (`groundZ`) et s'enfonce de **5 cm** : sur une pente, un tronc posé
  au centre flotterait côté aval.
- L'anneau de sélection vit dans `SITE_DECOR_LAYER`, teinté de l'accent du thème.

## Les espèces : une recette JSON par fichier

Ajouter une espèce, c'est déposer `apps/web/src/three/garden/species/<id>.json`, sans code. Le
schéma zod est `speciesSchema` (`species.ts`). Toutes les mesures sont **relatives à la hauteur**
(1). La vraie hauteur reste celle de l'élément, et `height` n'est que la valeur proposée à la
plantation.

- `kind`, `name` {fr, en}, `height` ;
- `trunk` {`height` du fût nu, `radius`, `lean`, `forks` (charpentières), `forkAt` (facultatif,
  depuis le 2026-09-29 : départ des charpentières sur le fût, pour une cépée), `spread` (facultatif,
  2026-09-29 : écart des pieds sur un cercle, chaumes parallèles d'un bambou), `color`} ;
- `crown` {`shape` : `round` | `spreading` | `oval` | `cone` | `column` | `tiered` (2026-09-29),
  `width`, `masses`, `roughness`, `droop`, `tiers` (plateaux de `tiered`, absent = 3)} ;
- `leaf` {`color`, `top`} : dégradé du bas au haut du houppier ;
- `accent` : fruits ou fleurs, de petites facettes semées plutôt sous le feuillage ;
- `seasons` {`spring`, `summer`, `autumn`, `winter`} : ce qui change par rapport à la base, qui est
  l'**été** : `foliage` 0..1 (0 = nu), `leaf`, `accent` (ou `null`) ;
- `source` : d'où vient la recette, et ce qui a été estimé plutôt que mesuré.

**Le catalogue écarte un fichier invalide en silence**, avec un simple avertissement console, pour
ne pas bloquer l'app. C'est pourquoi `species.test.ts` valide **chaque** fichier et construit chaque
saison. Une recette cassée casse le test, pas l'interface.

### Le générateur (`speciesShape.ts`) et ses deux premières versions ratées

- **Masses sur la coquille, pas dans le volume.** Les masses de feuillage sont posées sur la
  coquille d'un ellipsoïde, à des élévations propres au port (un dôme pour `spreading`, presque
  toute la sphère pour `round`), plus une masse au cœur. **Première version : masses empilées dans
  le volume**, ce qui donnait une « pile de boules » sans silhouette.
- **L'échelle vient de l'enveloppe de TOUTES les masses**, dessinées ou non. Sinon, l'arbre nu de
  l'hiver, plus bas que son houppier, serait étiré jusqu'à la même hauteur.
- **Arbre dégarni = ramure étagée.** Une flèche prolonge le fût dans le houppier. Chaque branche en
  part à la hauteur de la masse qu'elle nourrit (les basses en bas), avec deux rameaux vers le bord
  de cette masse. **Première version : toutes les branches partaient du haut du fût**, et l'arbre
  d'hiver faisait « balai ».
- **Le tirage ne dépend pas de la saison.** Le même arbre perd ses feuilles, il ne change pas de
  port. Le feuillage partiel retire des masses (`foliage × masses`) sans décaler le tirage.
- Une espèce porte ses couleurs **dans ses sommets** (dégradé `leaf.color` → `leaf.top`), et
  l'instance n'y module que la clarté.

**Première espèce : `cherry.json`** (cerisier, `spreading`, fruits rouges l'été, fleurs blanches au
printemps, feuillage orangé à l'automne, nu l'hiver). Ses couleurs ont été **estimées à l'œil** :
la photo n'existait que dans la conversation, pas sur disque. Les saisons sont déduites de la
botanique, pas de la photo. Le fichier le dit dans `source`.

### Mise à jour 2026-09-29 - `trunk.forkAt` (cépée) et le figuier

**Le besoin.** Un figuier adulte se ramifie au ras du sol, mais son houppier reste haut (environ
25 % de la hauteur). Dans le générateur, `trunk.height` fixait à la fois le départ des
charpentières et le **bas du houppier** (`z0 = trunk.height × 0,85`). Descendre le départ faisait
donc descendre le feuillage avec. À 0,06, les masses du bord touchaient l'herbe et les branches
partaient à l'horizontale (« araignée »). À 0,12, le défaut restait le même. **Impasse : aucune
valeur des champs existants ne donne une cépée.**

**L'extension** (`species.ts`, `speciesShape.ts`) : `trunk.forkAt`, facultatif, en part de la
hauteur totale. Le point de départ est pris sur l'axe du fût (qui peut être incliné).
- **Absent : calcul inchangé**, les charpentières partent du haut du fût et vont aux 70 % du trajet
  vers les masses basses. Le cerisier ne bouge pas.
- **Présent, en plein feuillage** : les tiges partent de `forkAt` et vont aux **90 %** du trajet
  vers leur masse, donc jusque dans le feuillage, et le fût central se prolonge vers la masse du
  cœur. Premier essai : les tiges gardaient le bout calculé depuis le haut du fût et s'arrêtaient
  sous le houppier (« le tronc ne monte pas bien haut », remarque de l'utilisateur).
- **Présent, dégarni** (hiver ou style qui clairsème) : les `forks` branches les plus basses de la
  ramure étagée partent du même point bas, et les autres restent sur la flèche.

Test : `species.test.ts` (« forkAt fait partir les charpentières du bas du fût… ») compte les
sommets d'écorce sous z = 0,1, l'été et l'hiver. **Piège du test** : un tronçon (`limb`) est un
cylindre sans subdivision, avec des sommets **à ses deux bouts seulement**. Mesurer l'écart
horizontal des sommets à mi-hauteur ne voit donc pas une branche qui traverse la tranche : il faut
compter les pieds.

**Deuxième espèce : `fig.json`** (figuier, `spreading`, largeur 2, 12 masses, retombée 0,55, fût
0,22 avec `forkAt` 0,02 et 3 tiges). C'est la première recette dont les couleurs de feuillage sont
**mesurées** par `photo-palette.mjs` (la photo était sur disque). Ravivées comme le demande la
skill, elles sortaient trop jaunes au rendu : on les a refoncées (`#48622a` → `#809646`). Le tronc
est estimé, car la zone mesurée ramassait l'herbe. Saisons tirées de la botanique : débourrement
tardif (feuillage 0,6 au printemps), figues violettes l'été, jaune à l'automne, nu l'hiver. Une
première version écrite dans une autre session a été écartée sans être lue, à la demande de
l'utilisateur.

### Mise à jour 2026-09-29 (suite) - `tiered`, `spread`, et onze espèces

Une série de photos passées à la skill a buté trois fois sur le générateur ; chaque impasse a donné
une extension, qui **ne change rien aux espèces existantes** : les formes des 11 espèces d'alors,
dans toutes leurs saisons, ont été comparées sommet par sommet avant et après (97 formes
identiques). Aucun tirage aléatoire n'a été ajouté sur les chemins existants.

- **`tiered` (cèdre, pin parasol).** Impasse : sur la coquille d'ellipsoïde, un houppier plat ne
  donne que des **billes séparées**, parce que la taille d'une masse est bornée par la hauteur du
  houppier ; le cèdre sortait en boule de feuillu, le pin parasol en candélabre. Le port pose des
  masses **aplaties** (demi-hauteur `rz`) en anneau, étagées sur `tiers` plateaux de plus en plus
  étroits (−55 % au sommet), leur taille venant de la largeur du plateau ; une flèche les traverse.
  `rz` sert aussi à l'échelle (sommet) et au placement des fruits. Cèdre : 4 plateaux ; pin
  parasol : 1 plateau sur un fût à 62 % avec `forkAt` 0,35.
- **`trunk.spread` (bambous).** Les tiges d'une cépée partaient d'un point et s'ouvraient en
  éventail. Les pieds sont répartis sur un cercle, à angles FIXES dérivés du cap du fût (aucun
  tirage). Premier essai : chaque chaume visait sa masse de feuillage, tirée au hasard, et les
  chaumes se croisaient ; avec `spread`, un chaume monte droit au-dessus de son pied, un peu évasé.
- Tests : `species.test.ts` (« spread écarte les pieds… », « tiered pose des plateaux plats,
  étagés et de plus en plus étroits »).

Espèces ajoutées (photos du 2026-09-29, couleurs mesurées sauf mention) : pêcher (`peach`, fleurs
roses avant les feuilles), ginkgo (la première photo montrait le début du jaunissement : elle a
servi à la silhouette, l'automne vient de la seconde), chêne (`oak`, photo voilée, couleurs
ravivées), laurier rose (`oleander`, cépée ; les fleurs se posent sous les masses, le générateur
semant ses accents comme des fruits pendants : une option « en tête » reste à faire), cèdre
(`cedar`), pin parasol (`stone-pine`), bambou doré (`golden-bamboo`) et bambou vert (`green-bamboo`,
couleurs **estimées**, photo absente du disque), charmille (`hornbeam`) et laurier-cerise
(`cherry-laurel`), qui sont des haies (section suivante). Piège de mesure : `photo-palette.mjs`
lancé sur la photo la plus récente du disque a mesuré le bambou doré à la place du vert, qui
n'était que dans la conversation ; vérifier le fichier avant de croire une mesure.

### Mise à jour 2026-09-29 (suite) - la haie, élément linéaire

**Pourquoi.** Une rangée de buissons (la voie prévue jusque-là) laissait des trous entre les
sujets, des petits troncs dessous et un dessus bosselé : jamais le mur taillé d'une charmille ou
d'un laurier-cerise, même élargie à 0,8 × la hauteur. Format : `kind: "hedge"` avec `length` et
`width` (cf. `2_0_format-house-json.md`, mise à jour du jour).

**Rendu (`hedgeShape.ts`).** Un bloc facetté continu, construit à sa vraie longueur et sa vraie
largeur en mètres (axe x et y), de hauteur 1 : l'instance ne l'étire qu'en hauteur (dans
`gardenLayer.ts`, pas de carrure tirée pour une haie). Un bosselage par demi-mètre dans les deux sens,
pour que les facettes gardent leur taille ; le relief est une fonction de la POSITION, pour que les
sommets confondus de deux faces bougent ensemble, sans fente. Arêtes du haut arrondies (retrait
plafonné à 20 cm, une haie large reste taillée). Couleurs de saison de l'espèce en dégradé,
`crown.roughness` règle le bosselage, fleurs semées sur les flancs et le dessus au prorata de la
longueur (taille d'une recette = part de la hauteur, convertie en mètres). Sous un style : ombrage
seul. Clé d'instances : longueur et largeur, deux haies identiques partagent un tampon. Ombre de
contact étirée et tournée avec la haie ; anneau et cadrage sur la demi-longueur. Les champs de port
d'une espèce de haie (colonne, masses, fût) ne servent plus au rendu, le schéma les exige encore.

*(Dépassé le 2026-09-29 (fin) : ce bloc continu est remplacé par une rangée de sujets serrés — voir « Mise à jour 2026-09-29 (fin) - la haie en rangée de sujets ».)*

**Édition.** `GardenPanel.vue` : lignes « Longueur » (pas 0,5 m) et « Largeur » (pas 10 cm), pour une
haie seulement ; « Autre forme » désactivé (une haie n'a qu'une forme). Changer la famille d'un
élément vers « haie » fait donc apparaître deux lignes : écart assumé à la règle « rien ne bouge »,
question laissée à l'utilisateur. Icône `hedge` dans `strokeIcons.ts`. Six familles : la grille à
icônes du panneau passe à 6 colonnes, celle à libellés de `GardenSection.vue` à **3 × 2** (à 6
colonnes, « Conifère » et « Buisson » étaient tronqués ; mesuré fr et en aux zooms 1 / 1,25 / 1,5,
contrôle négatif compris). Tests : `hedgeShape.test.ts`.

### Mise à jour 2026-09-29 (fin) - la haie en rangée de sujets

Le bloc taillé continu (section précédente) était lisible mais « vraiment pas détaillé »
(retour de l'utilisateur). **Il est remplacé** : `hedgeShape.ts` pose désormais une RANGÉE de
sujets serrés le long du segment. Format, panneau et réglages (longueur, largeur) ne changent pas.

- **Espacement** plus serré que la largeur d'un sujet (1,2 × le rayon d'une masse) : les
  feuillages se chevauchent et ferment la haie. Les sujets des bouts sont rentrés d'un rayon, pour
  rester dans la longueur réglée (tolérance testée : ± 25 cm).
- **Un sujet** = masses facettées ÉTIRÉES en hauteur (× 1,5), de tailles inégales (0,8 à 1,2) et
  placées de façon irrégulière, avec une masse ronde au sommet et deux tiges au pied (pied dégagé de
  12 cm). Taille d'une masse : 0,38 × la largeur, bornée à 12 cm et 50 cm, en une ou plusieurs
  colonnes dont le bord extérieur tombe sur la largeur réglée.
- **Individualité** : hauteur ± 10 % (le dessus se découpe), teinte ± 10 %, position le long du
  segment. Premier essai de la rangée : masses rondes en grille régulière, soit la « pile de
  boules » du premier générateur d'arbres.
- **Construite en mètres sur les trois axes**, puis ramenée à la hauteur 1 : sinon les masses
  s'écrasent. La hauteur entre donc dans la clé du cache et dans celle des instances : régler la
  hauteur d'une haie reconstruit sa forme. `limb` est exporté de `speciesShape.ts` pour les tiges ;
  la haie générique a une écorce (`COLORS.hedge.bark`).
- **Poids, mesuré** : 10 m × 0,7 m ≈ 57 000 sommets (19 000 triangles, une vingtaine d'arbres),
  20 m ≈ 116 000, contre quelques centaines pour le bloc. Non mesuré en images par seconde sur
  l'iGPU visé (`perf-gpu-hybride`) ; parade prête si besoin : espacer les sujets ou réduire les
  masses (÷ 2 environ).

Test : `hedgeShape.test.ts` (« des sujets individuels : le dessus se découpe… »). Vérifié dans la
preview de loin seulement (panneau de 373 px de haut) et en été seulement.

### Mise à jour 2026-09-29 (fin, suite) - espacement réglable, autre forme d'une haie

- **`spacing`** (demande de l'utilisateur). Absent : l'espacement automatique d'avant
  (`autoHedgeSpacing`, 1,2 × le rayon d'une masse), réparti sur la longueur : les formes
  automatiques sont restées identiques au sommet près (20 formes comparées). Réglé : l'espacement
  EXACT, la rangée centrée sur le segment ; au-delà de la largeur d'un sujet, des trous, soit une
  haie libre ou une rangée d'arbustes isolés. Le décalage aléatoire d'un sujet est plafonné à un
  demi-rayon, pour qu'un grand espacement ne donne pas un alignement désordonné.
- **Panneau** : ligne « Espacement », qui affiche la valeur automatique tant que rien n'est réglé,
  et une pastille « auto » TOUJOURS présente (grisée en automatique, « ↺ auto » cliquable qui y
  ramène quand l'espacement est réglé) : le même emplacement dans les deux états. Deux ratés
  mesurés en chemin : la pastille passait de 58 à 74 px avec son icône, et comme la largeur du
  panneau suit son contenu, les 24 éléments du panneau se décalaient de 16 px (`width` fixe de 76 px
  depuis) ; côte à côte avec le libellé, elle faisait déborder la carte de 23 px (294 → 317 px) :
  libellé et pastille sont désormais empilés. Contrôlé fr et en, zooms 1 / 1,25 / 1,5 : 0 élément sur
  25 déplacé, aucun débordement. Thème clair vu en capture ; thème sombre NON joué (capture figée du
  panneau, les couleurs calculées étaient elles aussi figées par les transitions).
- **« Autre forme »** fonctionne désormais pour une haie : `hedgeShape` prend la graine de l'élément
  (`gardenSeed`), qui entre dans la clé du cache et dans celle des instances. Les haies déjà posées
  changent donc de tirage une fois (leur graine vient de l'id).
- Tests : `hedgeShape.test.ts` (« l'espacement réglé fixe la distance de pied à pied… », « une autre
  graine tire d'autres sujets… »), `place.test.ts` (espacement posé, effacé par `null`, bornes).

## Mise à jour 2026-09-29 (soir) - panneau en accordéon, familles Bambou et Fruitier, cinq espèces sans photo

**Le panneau de la maison en édition est un accordéon** (`EditSection.vue`, `HouseEditPanel.vue`).
Fenêtres de toit, Places de stationnement et Jardin sont trois sections repliables, avec leur nombre
d'éléments dans l'en-tête. On travaille par thème : **une seule est ouverte à la fois**, et elle a
tout le panneau. La dernière ouverte est retenue sur le poste (`localStorage`
`kasbah.houseEdit.section`, lecture et écriture sous `try`). Aucune n'est ouverte au premier
affichage (choix de l'utilisateur). **Replier ou changer de section désarme toute pose en cours**
(ouverture, place, jardin) : sinon son « Annuler » / « Terminé » disparaîtrait avec la section, pose
toujours armée. Le sous-titre « N places » sous le nom de la maison est retiré (les en-têtes portent
les nombres), et la clé `parking.count` avec lui. `ParkingRows` gagne `hide-label`. Le panneau d'une
pièce, qui l'utilise aussi, est inchangé.

**Un bouton « Terminer »** dans l'en-tête du panneau fait le même geste que l'interrupteur des
Réglages (`settings.setHouseEditing(false)`). Dans l'autre sens, **armer l'interrupteur mène à la vue
Maison** (`SettingsView.vue`, comme le bouton du relief). Le désarmer laisse dans les Réglages.

**La section Jardin procède par famille.** Avec douze espèces, les pastilles de toutes les espèces
devenaient une liste sans fin. Désormais, toucher une famille fait deux choses : elle **arme sa forme
générique** (comme avant) et elle **affiche ses espèces**. La famille reste affichée après
« Terminé ». La liste des espèces est placée **sous** « Terminé » et la ligne d'aide : sa hauteur
change d'une famille à l'autre (0 à 6 espèces), et au-dessus elle ferait bouger le bouton (décalage
mesuré : 0 px entre Feuillu et Pierre). Une famille sans espèce affiche `garden.noSpecies`. Grille
des tuiles : 4 colonnes (8 familles, 2 rangées), 8 colonnes d'icônes dans `GardenPanel`.

**Deux familles de plus dans `GARDEN_KINDS`** (`packages/shared/src/house/schema.ts`) :

- `bamboo` : les deux bambous étaient rangés en Feuillu. Forme générique `bamboo()` (`shapes.ts`) :
  une touffe de 6 à 9 chaumes presque droits, avec des plumets en haut. 5 m par défaut, icône `bamboo`.
- `fruit` : cerisier, figuier, pêcher et pommier (4 des 6 espèces de Feuillu). Forme générique
  `fruit()` : le feuillu générique abaissé et élargi, semé de 24 fruits rouges (pièce `accent`). La
  forme générique ne suit la saison que par la couleur des feuilles (`SEASON_LEAF`, caduc comme le
  feuillu), donc **ses fruits restent toute l'année**. Les espèces, elles, ont leurs saisons. 5 m par
  défaut, icône `treeFruit`. Limite admise : « fruitier » est un usage, pas une silhouette. Le
  châtaignier a été rangé en Feuillu (arbre de haute tige plutôt que de verger).

**Migrer les éléments déjà posés** : `speciesOf` exige que l'espèce appartienne à la famille de
l'élément. Changer le `kind` d'une recette sans migrer fait donc retomber ces éléments sur la forme
générique de leur ancienne famille. Migration faite **par l'API** (`PUT /api/house/garden/:id`
`{"kind": …}`), et non en écrivant le fichier : `updateHouseFile` relit, modifie et réécrit
`house.json` d'un coup, et prévient les clients. L'espèce est conservée (`patchGardenItemInJson` ne
touche `species` que si le patch la porte). Des bambous verts, puis des fruitiers, dans `maison.json`,
sauvegarde préalable dans le dossier temporaire de la session. Les ids restent `garden.broadleaf-N`,
simple étiquette. **Piège** : un serveur lancé avant le changement de `packages/shared` garde en
mémoire l'ancien schéma et l'ancienne maison. Il faut le relancer, sinon un élément `bamboo` écrit
par un autre serveur le fait échouer.

**Cinq espèces sans photo** (demande explicite), avec la skill : port et couleurs estimés d'après la
botanique, et c'est dit dans `source`. `apple` (Fruitier : fleurs blanc rosé, pommes rouges de l'été
à l'automne), `silver-fir` (Conifère, « Sapin » : `cone` étroit, largeur 0,42), `eucalyptus` (fût
clair, `oval` aéré vert bleuté, persistant), `chestnut` (houppier `round` ample, chatons l'été, bogues
à l'automne), `silver-birch` (fût blanc, `oval` retombant, jaune d'or à l'automne). Captures des
quatre saisons du pommier et du sapin, et de l'été pour les trois autres, sur `kasbah-mock`. Le
bouleau est resté caché derrière le châtaignier, donc pas vraiment vu.

Puis quatre de plus, toujours sans photo : `olive` (Fruitier : tronc court, épais et penché,
feuillage vert-gris argenté, persistant, olives vertes puis noires), `walnut` (Feuillu comme le
châtaignier : fût gris clair, port étalé, feuilles tardives et bronzées au printemps), `quince`
(Fruitier : coings jaune d'or à l'automne) et `rose` (Buisson, rosier remontant rouge en cépée,
cynorhodons sur les tiges nues l'hiver). Vus en été seulement ; le noyer au bord du cadre.

**Correctif du port `cone`** (`speciesShape.ts`) : aucune espèce ne l'avait encore utilisé. L'échelle
se calculait sur les masses témoins (rayon × 0,6), alors que la pointe du dernier cône est à
`z0 + crownH` et sa base à `R`. Un sapin étroit sortait à 1,085 de sa hauteur (`species.test.ts`,
« chaque saison construit un arbre de hauteur 1 »). La hauteur de référence et la portée incluent
maintenant la pointe et la base réelles pour ce seul port, sans rien changer aux autres. Ce n'est
pas un réglage propre au sapin : c'est un défaut du générateur.

### La skill `garden-species` et `scripts/photo-palette.mjs`

`.claude/skills/garden-species/SKILL.md` : photo → lecture de la silhouette (tableau des champs à
mesurer en part de la hauteur) → couleurs → quatre saisons → recette → `npx vitest run
apps/web/src/three/garden` → une capture par saison dans la preview `kasbah-mock` (pilotée par le
pinia de la page) → itérations avec l'utilisateur jusqu'à validation. Deux interdits : **aucun
modèle ni aucune texture téléchargés**, et **ne pas toucher au générateur pour une seule espèce**.
Si une silhouette est inatteignable (palmier en éventail…), on propose d'étendre la recette.

`scripts/photo-palette.mjs <image> --crop x,y,w,h --k 3` : ffmpeg réduit la zone (en fractions de
l'image) à 96 × 96 pixels RGB bruts, puis des k-moyennes donnent les couleurs dominantes avec leur
part. **Le ciel et les blancs cramés sont exclus**, sinon un arbre à contre-jour ramène du blanc
dans son feuillage. Les graines des k-moyennes sont réparties sur la luminance, ce qui rend le
résultat stable d'un lancement à l'autre. À l'ingestion, il n'avait encore servi à aucune recette :
la photo du cerisier n'était pas sur disque.

## La saison

`three/garden/season.ts`, réglage `kasbah.sceneSeason` (`auto` | `spring` | `summer` | `autumn` |
`winter`), dans Réglages → Rendu 3D → « Saison du jardin ». C'est une préférence du navigateur,
dans `localStorage`, comme l'ambiance, et non un champ de la maison.

- **`auto` = saisons météorologiques par la date** (mars-mai printemps, juin-août été…), **décalées
  de six mois dans l'hémisphère sud** d'après `origin.lat` de la maison. Une maison à Nouméa a son
  été en janvier.
- Les **familles génériques caduques** (feuillu, buisson) changent de teinte (`SEASON_LEAF` : vert
  tendre, roux, terne l'hiver) mais gardent leurs masses. Conifère, palmier et pierre ne changent
  pas.
- Une **espèce** applique sa propre variante saisonnière : feuillage partiel ou nu, couleurs,
  fleurs ou fruits.
- Changer de saison reconstruit le calque du jardin (la saison entre dans sa signature), pas la
  maison.

## Le jardin suit le style de rendu (2026-09-28, suite)

Demande de l'utilisateur : réaliste et nature gardent le jardin naturel, les autres styles le
teintent à leur manière. Chaque style PEUT déclarer une palette de jardin dans son `look`
(`GardenLook`, `three/styles/types.ts`) : teintes de feuillage (plusieurs), tronc, pierre, fruits
(`null` = ceux de l'espèce), part émise, feuillage restant. **Absente = couleurs naturelles** :
réaliste, nature et indigo (ce dernier n'a pas été demandé, il reste naturel).

| Style | Jardin |
|---|---|
| Cyberpunk | feuillages néon qui ÉMETTENT (cyan, magenta, violet), troncs noirs, fruits jaune fluo |
| Maquette | tout en blanc cassé façon maquette d'architecte, troncs balsa, fruits fondus dans le feuillage |
| Candy (bonbon) | pastels rose, menthe, lilas, citron ; troncs caramel, fruits framboise |
| Maison hantée | feuillage sombre et CLAIRSEMÉ (arbres à moitié morts), troncs presque noirs, fruits phosphorescents |
| Akira | feuillage presque noir, troncs noirs, fruits et fleurs rouges qui luisent un peu (émission 0,15) |
| Disco | feuillages rose fluo, or, cyan et violet qui ÉMETTENT (0,35), troncs noirs, fruits argent |
| Girlyversaire | feuillages tendres (verts et rose), fleurs et fruits roses |
| Halloween | l'automne poussé : orange, rouge sombre, violet presque noir ; troncs noirs, fruits orange (citrouilles), feuillage réduit à 70 % |
| Noël | sapins sombres et givre (une teinte claire), troncs bruns, fruits : boules rouges |
| Tatooine | végétation rare d'un désert, olive poussiéreuse et à moitié sèche (feuillage restant 60 %), fruits de l'espèce |

> Mis à jour le 2026-10-06 (lint) : le tableau ne donnait que quatre styles ; dix déclarent une palette `garden` dans leur `look` (`apps/web/src/three/styles/{akira,candy,cyberpunk,disco,girlyversaire,halloween,haunted,maquette,noel,tatooine}.ts`), les six lignes Akira à Tatooine sont ajoutées d'après ces fichiers. Réaliste, nature et indigo n'en déclarent pas : jardin naturel.

Comment c'est tenu :

- **Une teinte par élément**, tirée par sa graine parmi celles du style. Elle entre dans la clé des
  tranches d'instances : une tranche n'a qu'une teinte, et c'est ce qui permet au néon d'en émettre
  une — l'émission d'une matière ignore la couleur d'instance, donc une matière propre (clonée) par
  tranche émissive, libérée avec elle.
- **Une espèce sous une palette** est tirée en ombrage seul (sommets gris, pas le dégradé de sa
  recette) : la teinte vient du style. Elle garde sa silhouette, ses saisons (feuillage restant, arbre
  nu l'hiver) et ses fruits, dont la couleur reste la sienne si le style n'en impose pas.
- **Feuillage restant du style** (`foliage`, hantée 0,45) : il s'ajoute à celui de la saison. Sur une
  espèce, tout feuillage < 1 fait apparaître la ramure étagée (flèche et branches), même l'été. Sur
  une famille générique (feuillu, buisson seulement), c'est la **grande masse centrale qui part la
  première** : garder la plus grosse donnait un arbre plus petit mais plein, pas un arbre dégarni. La
  mise à l'échelle se fait sur la forme ENTIÈRE avant la coupe, pour que la hauteur reste exacte.
- Réglages jugés sur capture : l'émission cyberpunk ramenée de 0,55 à **0,3** (à 0,55 les facettes
  disparaissaient, les arbres devenaient des taches) ; les teintes hantées assombries (lues kaki sous
  l'éclairage de nuit du style).

Test : `species.test.ts` (« sous la palette d'un style, une espèce perd ses couleurs mais garde sa
silhouette », et un style qui dégarnit fait apparaître la ramure).

## Ombres, reflet, lampes (2026-09-28, suite)

Demande de l'utilisateur : « les ombres, la réflexion ». Choix faits avec lui (`AskUserQuestion`) :
ombre de contact ET ombres portées du soleil ; reflet figé plutôt que temps réel.

- **Ombre de contact** : un disque noir qui s'efface vers le bord (texture calculée en mémoire, pas de
  canevas, pour exister dans les tests) au pied de chaque élément, rayon 1,25 × celui de l'élément,
  opacité 0,38. UNE `InstancedMesh` pour tout le jardin, en `SITE_DECOR_LAYER` : l'occlusion ambiante
  ne la prend pas pour un objet, la sonde de reflet ne la voit pas. Posée à 3 cm du sol, plate : sur une
  pente elle s'enfonce d'un côté.
- **Ombres portées du soleil** : le cadre de la carte d'ombre englobe désormais le jardin
  (`fitSunShadow`, rappelé à chaque `buildGarden`). Coût mesuré et limite : voir l'ajout du
  2026-09-28 dans `../1_architecture/1_5_scene-3d.md` (texel 0,87 → 2,41 cm).
- **Reflet de la piscine** (`three/effects/reflection.ts`) : une sonde cubique (6 rendus de 256 px, en
  demi-flottants) posée 40 cm au-dessus de la première piscine, la surface de l'eau masquée le temps de
  la photo, le ciel du style posé en fond avec l'intensité de l'environnement (sinon la nuit se
  reflétait trop claire). Elle devient la `envMap` de la seule eau (`materials.zones.pool`). Le reflet
  est **figé** : refait seulement quand la maison, le jardin, le relief, le style ou l'heure changent,
  après **400 ms de calme** — un glissement au doigt ou un curseur n'en paie aucun. Un miroir temps réel
  (un rendu complet de plus par image) a été écarté pour l'iGPU visé. Mesuré : **3 à 7 ms** par mise à
  jour, contre 4 à 9 ms pour une image ordinaire. Vérifié en lisant les pixels de la sonde : vert
  (arbre), gris clair (façade), bleu (ciel) ; le rendu du reflet sur l'eau, lui, reste à juger sur la
  tablette. Ce qui ne s'y reflète pas : les couches de décor (halos, anneaux, ombres de contact), et ce
  qui change sans reconstruire (un volet qui descend, une voiture qui arrive) jusqu'au prochain refait.
- **Lampes** : les matières du jardin portent `userData.noLamps`, comme la pelouse. Un arbre au ras de
  la façade est à la hauteur du rez-de-chaussée : le plafonnier du salon l'éclairait à travers le mur
  (`core/levelLight.ts`). Les lampes de jardin l'éclairent toujours (elles portent une ombre).

## État à l'ingestion

Arbre de travail non commité après cf60c7d. Le fichier réel `house/maison.json` (non versionné)
portait déjà des éléments posés à la main. Tests : `place.test.ts` (« éléments du jardin »), `shapes.test.ts` (hauteur 1 et
pied à 0 pour chaque famille et chaque variante, graine stable), `species.test.ts` (recettes
valides, chaque saison construite, espèce d'une autre famille ignorée, hémisphères).

Pièges rencontrés pendant la session : `../6_faq/6_0_pieges-outillage.md` (entrées du 2026-09-28).
