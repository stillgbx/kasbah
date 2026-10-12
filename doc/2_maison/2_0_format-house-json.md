# Format house.json : décisions et validation

> Dernière mise à jour : 2026-10-12
> Sources : `packages/shared/src/house/{schema,validate,lookup,geo}.ts`, `docs/house-json.md`, `house/demo-house.json`, `packages/shared/src/house/autoplace.ts`, `house/fit-survey.mjs`, `house/maison.json`, `packages/shared/src/house/place.ts`, `apps/server/src/config/house.ts`, `packages/shared/src/house/panels.ts`, `packages/shared/src/house/openings.ts`, `packages/shared/src/house/parking.ts`, `packages/shared/src/house/geometry/relief.ts` (`site.relief`), `house/demos/*.json`, `apps/server/src/config/properties.ts`, `packages/shared/src/house/structure.ts`, `packages/shared/src/house/newHouse.ts`

La **référence complète du format** (champs, exemples) est `docs/house-json.md`. Cette page
explique les décisions et ce que la validation garantit.

## Décisions

| Choix | Raison |
|---|---|
| **Z-up métrique** dans le JSON (x est, y nord, z haut) | `THREE.Shape` vit en XY et `ExtrudeGeometry` extrude en +Z : « plan + hauteur » sans transformation par sommet. Une seule conversion vers le monde Three (`rotation.x = -π/2`). |
| Polygones de pièces = **face intérieure**, **CCW imposé** | Les ouvertures référencent un **index d'arête** ; inverser silencieusement l'ordre casserait les ancrages. La normale « à droite » d'une arête CCW pointe vers l'extérieur, ce qui simplifie les murs. |
| **Épaisseur de mur portée par chaque pièce** vers l'extérieur ; pièces adjacentes espacées de `t + t'` | Chaque pièce remplit sa moitié ; classification intérieur/extérieur automatique par sondage point-dans-polygone, surcharge possible par arête (`walls[]`, `none` pour un espace ouvert). |
| **Ouvertures ancrées** par segment + offset ; **portes intérieures miroitées** | Déclarer une porte une seule fois ; le mur d'en face est percé automatiquement. |
| `position.z` des appareils **relative au sol de l'ancre** | Déplacer un niveau ne casse pas les appareils ; un appareil extérieur est relatif au terrain. |
| Liaison par **`deviceId = "<plugin>:<externalId>"`** | Une seule chaîne comme clé partout ; un appareil non lié reste affiché (grisé) au lieu de faire échouer la maison. |
| `origin { lat, lon, alt, heading }` | Position GPS du repère local et cap de l'axe +y : conversion équirectangulaire (`geo.ts`) suffisante à l'échelle d'une parcelle ; sert à placer/qualifier les véhicules (à la maison si < 120 m). |
| **Scènes** dans la maison (`scenes[]`) | Lots de commandes validés par le schéma partagé (`commandSchema`) et exécutés côté client ; déclaratif, sans logique serveur. |
| `shortName` sur les niveaux | Libellé court des onglets (« RDC »). |

*(Constat du lint du 2026-10-06 : `scenes[]` est conservé par le schéma (`packages/shared/src/house/schema.ts`, `houseSceneSchema`) mais aucun code ne le lit plus, côté web comme côté serveur ; les ambiances viennent des plugins, et les ambiances maison ont été retirées du panneau d'accueil le 2026-09-22 (bis) — voir `../4_ui/4_1_navigation-et-panneaux.md`, « Mise à jour 2026-09-22 (bis) ».)*

## Validation (`validate.ts`)

`parseHouse` = schéma zod + `superRefine` croisé : ids uniques (niveaux, pièces, zones, appareils,
ouvertures), références (`levelId`, `roomId`, `zoneId`, `openingId` appartenant à la bonne pièce),
ouverture dans son segment et sous la hauteur, pas de chevauchement, pas sur un segment `none`, ni
sur une pièce sans mur (`terrace`, `balcony`), élévations distinctes. Les erreurs ont des chemins
lisibles (`rooms[1].openings[0].offset: …`). Le serveur **refuse de démarrer** sur une maison invalide.

`lintHouse` produit des avertissements non bloquants : pièce sans appareil, niveau à la cote du
terrain (z-fight), appareil non lié ou lié à un id de plugin inconnu.

## Index (`lookup.ts`)

`indexHouse(house)` : maps par id, `roomsByLevel`, `devicesByRoom/Level/Zone`, `outdoorDevices`,
`devicesByBinding` (id de plugin → appareil maison), niveaux triés. La maison est traitée comme
**immuable** : on ré-indexe quand la référence change.

## Fixture

`house/demo-house.json` (dupliqué dans `packages/shared/src/house/__fixtures__/`) : 2 niveaux,
7 pièces, 4 zones, 19 appareils liés aux ids stables du plugin `mock`, 3 scènes. Toute évolution
du schéma doit garder cette fixture valide (tests `house.test.ts`).

> Mis à jour le 2026-10-06 (lint) : la fixture compte aujourd'hui 3 niveaux (`rdc`, `etage` et un niveau `toit`), 7 pièces, 4 zones (`site.zones`), 23 appareils, 3 scènes et 2 champs de panneaux (`arrays`), relevé dans `house/demo-house.json`. *(Le 2026-10-06, plus tard : les 3 scènes sont retirées avec le champ, voir la section suivante.)*

### Mise à jour 2026-09-05 — le JSON ne porte plus que le placement

Deux évolutions pour que le JSON soit **uniquement** la couche de placement, le plugin restant la
source de vérité de l'inventaire :

1. `houseDeviceSchema.name` est devenu **optionnel** (`packages/shared/src/house/schema.ts`).
   Absent, c'est le nom du descripteur qui s'affiche (renommer une lampe dans l'app Hue se propage).
   Les deux lieux qui supposaient un nom retombent sur le descripteur puis l'id :
   `apps/web/src/three/HouseScene.ts` (libellé du marqueur) et
   `apps/web/src/components/home/RoomPanel.vue`. Un appareil peut donc se réduire à
   `{ id, deviceId, position, roomId, mount }`.

2. **Auto-placement** (`packages/shared/src/house/autoplace.ts`, tests `autoplace.test.ts`) :
   `autoPlaceDevices(house, devices, index)` synthétise un `HouseDevice` pour chaque appareil de
   plugin **absent** de `devicesByBinding`, dès qu'une pièce de la maison porte le nom (ou l'id) de
   la pièce déclarée par le plugin (`descriptor.meta.room`, ex. pièce Hue). Rapprochement par
   `roomKey()` : sans accents, sans casse, sans séparateurs (« Chambre 1 » = `chambre1`). Position :
   centroïde de la pièce, réparti sur un petit cercle (0,9 m) si plusieurs, `mount: 'ceiling'` à
   15 cm sous le plafond pour un `light`, sinon 1,20 m en `free`. Id dérivé du `deviceId`
   (`auto.hue-<uuid>`), `meta.autoPlaced: true`. Les appareils qu'aucune pièce ne réclame sont
   rendus dans `unplaced` : hors scène 3D, visibles dans la vue Lumières.

**Sens unique** plugin → placement : rien n'est jamais réécrit vers le plugin, et le serveur n'écrit
jamais le JSON. Conséquence pratique : écrire une position dans le JSON n'est utile que pour
**préciser** un emplacement ; supprimer l'entrée fait retomber sur l'auto-placement.

*(Dépassé le 2026-09-07 : le serveur écrit désormais le JSON, par les routes `PUT/POST/DELETE /api/house/*` (`apps/server/src/http/routes.ts`) — voir « Mise à jour 2026-09-07 — le placement s'écrit depuis l'UI ». Le sens unique plugin → placement reste vrai : rien n'est réécrit vers le plugin.)*

### Mise à jour 2026-09-05 — `house/maison.json`

Le dépôt ne versionne **qu'une** maison : `house/demo-house.json`, qui sert aussi de fixture aux
tests. Une maison de production vit à côté, hors du dépôt — `house/maison.json` est dans
`.gitignore` : sa description (pièces, cotes, position, lampes) est une **donnée personnelle** et
n'a pas à être documentée ici. Le wiki ne décrit donc que le format et les mécanismes ; pour
regarder une maison réelle, ouvrir le fichier.

*(Précisé le 2026-10-08 : le dépôt versionne désormais quatre maisons, la fixture des tests et les trois démos de `house/demos/` — voir la section « trois maisons de démonstration ».)*

Sélectionner une autre maison : `KASBAH_HOUSE_FILE=../../house/<fichier>.json` dans
`apps/server/.env` — le chemin est résolu depuis le **cwd du serveur** (`apps/server`), pas depuis
la racine du dépôt (cf. `../5_setup/5_1_configuration-env.md`). Le fichier est lu **une fois au
démarrage** : le modifier demande un redémarrage du serveur.

### Mise à jour 2026-09-07 — relevé métré : `meta.survey` et polygones dérivés

Une maison réelle se relève **à l'intérieur des pièces** : chaque cloison mitoyenne s'y retrouve
réduite à une seule ligne partagée, alors que le moteur de murs exige un écart de `t + t'` entre
deux faces intérieures en vis-à-vis (cf. `2_1_geometrie.md`). Deux exigences en tension : ne
jamais perdre les mesures brutes, et rendre la dérivation rejouable. D'où la convention : les
mesures vivent dans `meta`, le `polygon` en est **dérivé**.

Les champs (`unit`, `frame`, `partition`, `levelOffsets`, `points`, `note`) et un exemple sont
décrits dans `docs/house-json.md`, section « Relevé métré » ; ci-dessous, le **pourquoi** et les
pièges.

Deux décisions structurantes. **`partition` est découplé de `defaults.interiorWallThickness`** : le
défaut global reste celui des niveaux non relevés et alimente le sondage de classification, tandis
qu'un relevé peut porter des cloisons plus fines sans déplacer les autres niveaux. Et
**`levelOffsets` corrige un repère, pas une mesure** : une campagne dont le 0;0 ne tombe pas sur
celui des autres niveaux se recale par une translation des points bruts — les cotes dictées restent
intactes, et la correction reste un seul nombre ajustable.

**L'outil** `house/fit-survey.mjs` (node, sans dépendance) régénère depuis les relevés :
`room.polygon`, les surcharges `room.walls[]` des arêtes mitoyennes, et `level.outline` des niveaux
relevés. `--check` vérifie sans écrire (sortie 1 si un polygone diverge) ; l'opération est
idempotente. Corollaire : **ne jamais éditer `polygon` ni `walls` à la main** — corriger `points`
ou `levelOffsets`, puis rejouer le script.

Le script **possède** les surcharges `interior` : il les régénère à chaque passage, car les garder
d'un run à l'autre les rend obsolètes dès qu'une arête est coupée et que les index glissent. Seules
sont préservées celles qu'il ne sait pas déduire — `none` (passage ouvert) et `exterior` (façade
forcée).

**Effets de bord d'un relevé** sur le reste du JSON, à traiter dans la même passe :

- les **ouvertures** sont ancrées sur un index d'arête : elles deviennent fausses, voire invalides,
  dès que le polygone change. Relever les pièces sans relever les ouvertures impose donc de retirer
  les ouvertures placeholder, plutôt que de les laisser tomber sur une cloison.
- les **appareils** gardent leur `position` : des x;y issus d'une disposition antérieure se
  retrouvent hors de leur pièce. Les recentrer sur le centroïde, ou supprimer l'entrée pour
  retomber sur l'auto-placement.
- `level.outline`, donc l'emprise du toit, se calcule sur les pièces **murées** uniquement : une
  terrasse ne doit pas être couverte.

### Mise à jour 2026-09-07 — `origin` quand le point GPS connu n'est pas le 0;0

`origin` est le GPS **du 0;0 du repère local**, et `heading` le cap horaire de l'axe +y (`geo.ts`).
Deux pièges au géoréférencement d'une maison relevée :

1. Le point GPS dont on dispose (repère d'un service de cartographie, marqueur d'adresse) tombe
   rarement sur le 0;0 du relevé. Il faut le **ramener** au 0;0 : estimer sa position en
   coordonnées locales, puis appliquer l'inverse de `localToGeo`. Contrôle : `geoToLocal(origin, p)`
   doit redonner ces coordonnées locales.
2. Un relevé est aligné sur les **murs**, pas sur le nord : `heading` se mesure sur les arêtes du
   bâtiment en vue aérienne. Tant qu'il vaut 0, tout ce qui a été dérivé d'une vue « nord en haut »
   (contour de parcelle, bassin aligné nord-sud) est implicitement supposé non tourné. Dès qu'on le
   renseigne, ces données doivent être **ré-exprimées** dans le repère tourné
   (`x = est·cos h − nord·sin h`, `y = est·sin h + nord·cos h`) : la rotation conserve les aires
   mais change toutes les coordonnées.

À doser : la seule consommation actuelle de `origin` est le test « à la maison » des véhicules
(seuil 120 m), donc une erreur métrique sur le 0;0 est sans conséquence — inutile de sur-investir
avant un relevé GPS propre.

*(Dépassé le 2026-10-06 : `origin` n'est plus lu que par le test des véhicules. Il sert aussi à la météo — donnée aux plugins par `ctx.site`, `apps/server/src/core/plugin-host.ts` —, au soleil de la scène (`apps/web/src/composables/useHouseScene.ts`), à la saison du jardin (latitude, même fichier) et à l'apparence « Auto » (`apps/web/src/lib/daylight.ts`).)*

### Mise à jour 2026-09-07 — le placement s'écrit depuis l'UI

Jusqu'ici « le serveur n'écrit jamais le JSON » (cf. mise à jour du 2026-09-05). À partir du
2026-09-07, il fait **une** écriture : le placement d'un appareil depuis le panneau de l'appareil
(mode « Déplacer », cf. `../4_ui/4_1_navigation-et-panneaux.md`), via `PUT /api/house/devices/:id`
(cf. `../1_architecture/1_3_protocole-rest-ws.md`). Le sens unique plugin → placement demeure : rien
n'est réécrit vers le plugin, et le fichier reste la source de vérité (relu à chaque écriture).

Décisions (`packages/shared/src/house/place.ts : placeDeviceInJson`, tests `place.test.ts`) :

- On patche le **JSON brut**, pas la maison parsée : réécrire l'objet zod injecterait les défauts
  (`kind: 'room'`, `openings: []`, `site.elevation`…) dans le fichier de l'utilisateur. Seuls
  `position`, `roomId`, `mount` de l'entrée visée changent ; l'ordre des clés est conservé, le
  fichier est reformaté (`JSON.stringify` à deux espaces, fin de ligne finale).
- Changer de pièce entraîne `levelId` **si l'entrée en portait un** (la fixture porte les deux) ;
  `zoneId` est retiré. Une pièce d'un autre niveau est acceptée par la fonction : la validation
  croisée tranche ensuite, et la scène ne propose de toute façon que les pièces du niveau.
- Un appareil **auto-placé** n'existe pas dans le fichier : le déplacer **crée** l'entrée minimale
  `{ id, deviceId, position, roomId, mount }` avec l'id dérivé (`auto.<plugin>-<id>`), qui reste donc
  stable pour la sélection. Sa pastille passe de « Auto » à « Placée » dans la vue Lumières.
- Position arrondie au **5 cm** côté client (`snap`, store `house`) pour garder un JSON lisible.

Piège : si `KASBAH_HOUSE_FILE` pointe sur `house/demo-house.json`, l'UI salit la fixture versionnée
(et les tests qui la lisent). En dev, viser une copie ou `house/maison.json`. La référence de format
(`docs/house-json.md`, section « Appareils ») décrit le geste côté utilisateur.

### Mise à jour 2026-09-08 — ordre d'affichage des niveaux et des pièces

Le JSON décrit une maison **physique** ; l'UI doit en tirer un ordre de **lecture**, et les deux ne
coïncident pas. `indexHouse` (`packages/shared/src/house/lookup.ts`) est l'endroit unique où l'ordre
d'affichage se décide, pour toutes les listes de l'app :

- `levelsSorted` trie désormais par élévation **décroissante** — le haut d'abord, on descend dans la
  maison. Choix de l'utilisateur ; il vaut pour toutes les **listes** (liste des pièces du panneau
  maison, bandes de la vue Lumières). Exception assumée : les **onglets de niveau** de l'en-tête
  remontent la pile (`Jardin → RDC → étages → Tout`, `HomeView.vue` retourne la liste) — la rangée se
  lit comme une coupe du bâtiment, terrain à gauche, et un niveau ajouté au-dessus ne décale pas les
  onglets existants. La **géométrie n'est pas concernée** : elle retrie par élévation croissante de
  son côté (`house/geometry/index.ts`), et la scène 3D compare des élévations, jamais des rangs.
- `roomsByLevel` n'est plus dans l'ordre du tableau `rooms` : d'abord les pièces citées par le
  nouveau champ **`level.roomOrder`** (tableau d'ids, dans l'ordre voulu), puis les autres **par nom**
  (`localeCompare`). Un ordre partiel est donc légitime, et une pièce ajoutée au JSON apparaît à sa
  place alphabétique sans toucher à `roomOrder`.

`roomOrder` est optionnel et n'a **aucun effet géométrique** : c'est une préférence d'affichage, au
même titre que `shortName`. Il est écrit par l'UI (glisser-déposer de la vue Lumières, voir
`../4_ui/4_1_navigation-et-panneaux.md`) via `setRoomOrderInJson`
(`packages/shared/src/house/place.ts`), qui patche le JSON brut comme `placeDeviceInJson` et refuse
un niveau inconnu, une pièce qui n'est pas de ce niveau, ou un doublon — un ordre qui ne correspond
plus à la maison serait ignoré silencieusement à l'affichage, autant le refuser à l'écriture.

`house.json` a donc maintenant **deux** écritures depuis l'UI (placement d'un appareil, ordre des
pièces), toutes deux passant par `updateHouseFile` (lecture-modification-écriture atomique, `.bak`).

### Mise à jour 2026-09-09 — l'orientation (`yaw`) s'écrit aussi depuis l'UI

`HouseDevice.yaw` (degrés, 0 = face à +y) existait pour les caméras et véhicules, posé à la main dans
le JSON. Demande de l'utilisateur : « tout ce qui a un écran doit être orienté ». `devicePlacementSchema`
(`packages/shared/src/house/place.ts`) accepte désormais `yaw` (0–360, optionnel) et `placeDeviceInJson`
l'écrit sur l'entrée (existante ou créée) **seulement s'il est donné** : un placement sans `yaw` ne
touche pas à l'orientation déjà écrite (test `place.test.ts`). Toujours le JSON brut patché, rien
d'autre ne change. Une orientation absente à l'entrée du mode « Déplacer » ne pouvant pas être
effacée, « Rétablir » la ramène à 0, qui vaut pareil.

### Mise à jour 2026-09-10 — un placement peut ancrer sur un niveau seul

Demande de l'utilisateur : poser depuis une liste un appareil découvert tard, sans aucune entrée (ni JSON,
ni auto-placement), à n'importe quel niveau. `devicePlacementSchema` accepte `levelId` (optionnel) ;
`placeDeviceInJson` l'utilise quand aucune pièce n'est donnée : entrée existante → `levelId` posé, `roomId`
et `zoneId` retirés (l'appareil est sorti de toute pièce) ; entrée créée → `{ id, deviceId, position, levelId }`.
Un niveau inconnu est refusé ; la pièce l'emporte sur le niveau quand les deux sont donnés (tests
`place.test.ts`). Le fichier acceptait déjà un appareil ancré au niveau seul (caméras extérieures) : rien
ne change dans le format, seulement dans ce que l'UI sait écrire.

Et l'inverse : `removeDeviceFromJson(doc, id)` retire l'entrée (id inconnu refusé), le reste du document
intact. C'est « Retirer de la maison » depuis le panneau (`DELETE /api/house/devices/:id`) : l'appareil
redevient ce qu'il était avant d'être posé — auto-placé si sa pièce de plugin existe, sinon « non placé ».

### Mise à jour 2026-09-10 — `meta.audioOutput` : « mon son sort par cet appareil »

Sur un appareil de la maison (`houseDeviceSchema.meta`, libre), **`audioOutput`** = l'**id maison**
(`HouseDevice.id`, pas l'id plugin) de l'appareil qui joue son son : une TV branchée en HDMI ARC
sur une barre de son. Le schéma ne le type pas (meta reste un `record` libre) ; c'est
`apps/web/src/lib/audioRouting.ts` qui le lit. Décision de l'utilisateur (2026-09-10) : le lien vit dans
le JSON, sans sélecteur dans l'UI. Il peut être posé sur une entrée issue de l'auto-placement puis
sauvegardée (`auto.google_cast-…`) comme sur une entrée `media.*`. Pourquoi ce sens (source → puits) :
c'est la source qui sait où part son son (`state.audioOutput`, `../1_architecture/1_1_contrat-appareils.md`),
et un puits pourrait servir plusieurs sources. Le serveur ne relit le fichier qu'au démarrage
(`apps/server/src/config/house.ts : loadHouse`) — une édition à la main demande un redémarrage ;
`updateHouseFile` relit le fichier brut avant de le patcher, la clé survit donc aux placements écrits depuis l'UI.


### Mise à jour 2026-09-11 — le toit comme niveau, et les champs de panneaux (`arrays`)

**Un toit peut être un niveau.** Rien ne l'interdisait : un `level` sans pièce est valide, apparaît
dans les onglets, et un appareil ancré par `levelId` seul s'y place. Il suffit de lui donner
l'élévation du **haut des murs du dernier niveau** — la base du toit — pour que la scène 3D le
reconnaisse comme le niveau qui le porte et garde le toit visible quand on l'affiche
(`../1_architecture/1_5_scene-3d.md`). `roof.levelId` continue de désigner le niveau des murs, pas
celui-là. Posé sur la maison de démonstration (`toit`, élévation 5,55) et sur la maison réelle.

**`arrays` : les champs de panneaux.** Nouveau tableau de `houseSchema`, décrit par
`packages/shared/src/house/panels.ts`. Un champ est une grille : `origin` (x, y absolus ; z relatif
au sol du niveau), `yaw`, `tilt`, `rows`, `cols`, dimensions du module (défaut 1,13 × 1,76 m), `gap`,
et `panels` — la liste ordonnée des `deviceId` de micro-onduleurs, rangée par rangée, `null` pour un
emplacement non suivi.

**Les positions des modules ne sont jamais écrites** : `panelArrayDevices` les dérive du champ, et
`withPanelArrays` les ajoute à `devices`. C'est le choix structurant, décidé avec l'utilisateur le
2026-09-11 après comparaison avec l'alternative (un appareil par panneau, groupés par étiquette) :
déplacer ou pivoter une grille de modules ne touche **qu'un objet**, et le JSON reste à quelques
objets pour de nombreux panneaux. C'est aussi le découpage de l'app du fabricant, où les onduleurs vivent
dans un champ.

Chaque module dérivé est un appareil de la maison à part entière — sélectionnable, lié à son
onduleur, dessiné dans la scène — et porte `meta.panel` (`arrayId`, `row`, `col`, dimensions,
`tilt`). Son emplacement **ne se règle pas seul** : l'UI masque le contrôle de placement pour lui
(`panelOf` dans `apps/web/src/components/home/DevicePanel.vue`), il suit son champ.

La validation croisée refuse un champ sur un niveau inconnu, plus de modules que d'emplacements, et
un onduleur **lié deux fois** — à deux emplacements, ou à la fois dans un champ et dans `devices` :
il donnerait deux marqueurs pour un seul appareil.

### Mise à jour 2026-09-11 — section `plugins` : la maison dit quels fabricants elle utilise

`house.json` gagne `plugins`, un objet `pluginId → { enabled, parts, autoDynamicForNewScenes }`
(`packages/shared/src/house/schema.ts`, `pluginSettingsSchema`). C'est la réponse à « les choix et
infos sont maintenant dans le house.json » : le fichier de la maison décrit désormais **aussi**
quels fabricants cette maison utilise, et `.env` ne garde que les clés, les jetons et les ports.

- `parts` = sous-items du plugin, par id (les kinds simulés par `mock`). Absent = le défaut déclaré
  par le plugin ; on n'écrit que ce qu'on a décoché.
- **Section absente** = `defaultPlugins()`, c'est-à-dire la simulation seule avec tous ses kinds :
  `house/demo-house.json` n'a rien à déclarer et la démo tourne. zod 4 **ne valide pas** la valeur
  d'un `.default()`, elle est donc écrite en entier dans le code.
- Écriture : `setPluginInJson(doc, pluginId, patch)` (`house/place.ts`), même famille que
  `placeDeviceInJson` — patch du JSON **brut**, validé par `parseHouse` avant écriture atomique.
  Particularité : une maison sans section `plugins` la reçoit **matérialisée en entier** au premier
  patch. Sans ça, cocher Hue dans une maison muette aurait éteint la simulation, que seul le défaut
  du schéma gardait allumée.
- Aucun secret n'entre dans le fichier : ni clé de pont, ni jeton. Un `house.json` reste partageable.

### Mise à jour 2026-09-12 — `size` et `leaves` : ce qui dessine un ouvrant LIBRE

Un ouvrant lié à une ouverture (`openingId`) n'a rien à déclarer : son tablier épouse le rectangle de
la fenêtre, dans le plan du mur. Un ouvrant posé **dehors** — portail, porte de garage, store banne —
n'a aucune ouverture pour le dimensionner ni l'orienter : la scène lui dessinait donc une boîte fixe
de 0,6 × 0,5 m, identique pour un portail de 4 m et un store banne. Deux champs optionnels de plus sur
`HouseDevice` (`packages/shared/src/house/schema.ts`) :

- **`size: { width, height }`** en mètres, l'encombrement de ce qui est DESSINÉ. La seconde dimension
  se lit selon la nature : la **hauteur** d'un portail debout, l'**avancée** d'un store déployé à plat
  — même champ dans le fichier, deux mots à l'écran (`../4_ui/4_1_navigation-et-panneaux.md`) ;
- **`leaves: 1 | 2`** — les battants d'un portail, ce qui s'écarte quand il s'ouvre.

Aucun défaut n'est écrit dans le fichier : un JSON sans ces champs garde exactement le dessin qu'il
avait, et c'est l'app qui choisit à défaut (`apps/web/src/lib/orientation.ts` : 0,6 × 0,5 m pour un
ouvrant debout, 3 × 2 m pour un store, deux battants pour un `gate` et un seul pour tout le reste —
une porte de garage est d'une pièce). `yaw`, déjà là pour les caméras et les écrans, sert désormais
aussi à ces ouvrants : un portail ne se pose pas en travers de son entrée.

Côté écriture, `devicePlacementSchema` accepte les deux (`size` borné à 50 m par dimension) et
`placeDeviceInJson` les pose sur l'entrée — existante ou créée — **seulement s'ils sont donnés**,
exactement comme `yaw` : déplacer un appareil ne touche pas à sa taille.

### Mise à jour 2026-09-12 (bis) — `height` d'une pièce = son PLAFOND

Précision tirée d'un défaut de rendu (`2_1_geometrie.md`, mise à jour du même jour) : la hauteur
optionnelle d'une pièce décrit la hauteur sous **plafond**, pas celle de la façade. Elle sert à
accrocher un plafonnier (`autoplace`), à vérifier qu'une ouverture tient (`validate`) et à monter les
**cloisons** ; les murs **extérieurs**, eux, suivent la hauteur du NIVEAU, parce qu'ils appartiennent
à l'enveloppe du bâtiment (`wallHeight`). Une annexe relevée plus basse que son niveau gardait
sinon une façade plus basse que celle de sa voisine du même bloc.

Une annexe réellement plus basse ne se déclare donc pas par `height` : il lui faut son propre niveau
ou sa propre toiture.


### Mise à jour 2026-09-12 (ter) — les champs de panneaux s'écrivent depuis l'UI, et `yaw` devient un AZIMUT

Les champs (`arrays`) existaient dans le fichier depuis le 2026-09-11, mais **rien ne savait les
écrire** : ni route, ni contrôle. Ils se tapaient à la main. La session a ajouté le chemin d'écriture
complet et, chemin faisant, corrigé trois choses que seul l'usage révèle.

**`siteId` : un champ appartient à une installation.** Nouveau champ optionnel de `panelArraySchema`
(`packages/shared/src/house/schema.ts`), le `deviceId` du site (`enphase:site`). Il répond à une
question posée par l'utilisateur : « si je retire l'installation solaire, ses champs devraient partir
avec elle ». `removeDeviceFromJson` (`place.ts`) retire donc aussi les champs qui **nomment**
l'appareil retiré. Un champ qui ne nomme personne — fichier écrit à la main — est rattaché à la seule
installation de la maison (règle partagée avec l'UI, `arraysOf` / `siteOf`), et il l'ADOPTE au premier
réglage : rien à migrer dans un JSON existant.

**`yaw` est l'AZIMUT, plus le sens de la grille.** C'était la source de tous les malentendus : les
rangées gravissaient la pente vers `yaw`, donc le verre — qui bascule à l'opposé — regardait vers
`yaw + 180`. On orientait un champ « au sud » et les panneaux regardaient au nord. Depuis cette mise à
jour, et sur la demande explicite de l'utilisateur :

- `yaw` = **la direction vers laquelle les modules regardent**, comme le `yaw` de n'importe quel
  appareil (0 = vers +y) ;
- les rangées s'en vont **vers l'azimut** et **descendent** la pente en chemin — un toit descend vers
  le soleil. L'**origine d'un champ est donc son coin HAUT** ;
- `tilt` est **signé** (−90 à 90) : positif, le bord bas du module est du côté de l'azimut et le module
  se redresse face au soleil (montage courant d'un toit plat) ; négatif, il bascule en arrière.

**`slope` séparé de `tilt`.** `slope` est la pente du **support** (le toit sous le champ, 0 à plat),
`tilt` l'angle de chaque module **sur** ce support (les châssis). Les deux penchent le verre du même
côté et s'additionnent (`meta.panel.tilt`). C'est ce qui évite de traiter à part le toit plat et le
toit pentu : toit pentu = `slope` seul, toit plat = `tilt` seul, terrasse en pente = les deux. Avant
la séparation, incliner les modules d'un toit plat les faisait monter **en escalier**.

**Écriture.** `panelArrayPatchSchema` + `putArrayInJson` / `removeArrayFromJson` (`place.ts`), même
mécanique que le placement d'un appareil : patch du JSON **brut**, validation complète, écriture
atomique. Deux précautions propres aux champs : la liste `panels` est **ramenée à la grille** quand
elle rétrécit (sinon la validation refuserait le champ en plein geste, et les onduleurs en trop sont
libérés), et les emplacements vides **de la fin** ne sont pas écrits.

**Un champ neuf naît vide, nommé, et regarde comme son installation.** Le garnissage automatique des
premiers onduleurs libres a été retiré : l'ordre des numéros de série n'a **aucune raison** de
suivre le calepinage du toit, et il fallait tout défaire avant de placer chaque onduleur à sa vraie
place. Il naît en revanche avec un `name` (« Champ 1 »), un `siteId`, l'azimut de son installation
(on oriente la passerelle vers le soleil, le champ suit) et une hauteur posée sur le **dessus du
toit** : un toit plat est une dalle de 20 cm et le niveau-toit est déclaré à sa **base**, si bien
qu'un champ à `z = 0` y était noyé, invisible et impossible à attraper.

**Migration de la maison de démonstration.** `house/demo-house.json` et la copie de
`packages/shared/src/house/__fixtures__/` ont été migrées par calcul, pas à la main : nouvelle origine
= coin opposé du champ, `yaw + 180`, liste `panels` **inversée**. Vérifié avant écriture que les vingt
modules retombent au même endroit au centimètre près et que chaque onduleur reste sur SON module.
`pv-sud` : `[0.6, -0.7, 0]` / yaw 0 → `[6.35, 2.22, 2.04]` / yaw 180. Un `house.json` écrit avant
cette date garde ses valeurs mais **change de sens** : son champ part dans l'autre direction et ses
modules regardent à l'opposé. Le plus simple est de recréer le champ.

### Mise à jour 2026-09-13 — ce qu'un champ dit de ses modules et de ses onduleurs

Deux valeurs s'ajoutent à `arrays[]`, et aucune des deux ne se mesure : elles servent d'ÉCHELLE à
ce que l'app dessine.

- **`panel.peakW`** (défaut `PANEL_PEAK_W` = 450) — la puissance crête d'un module, celle inscrite au
  dos du panneau. C'est l'échelle de couleur du module en 3D et des jauges de la vue Énergie. Elle
  vit dans `panel` parce qu'elle décrit le MODULE, avec sa largeur et sa hauteur.
- **`maxOutputW`** (défaut `0` = inconnue) — la puissance de sortie maximale des micro-onduleurs du
  champ, le terme des fiches techniques (480 W pour un IQ8P). Elle est au niveau du CHAMP et non du
  module : c'est l'onduleur qui plafonne, pas le verre. À `0`, l'app ne marque simplement aucun
  plafond.

Une conséquence à connaître : sous un module de 500 Wc, un onduleur de 480 W ne laissera jamais une
jauge se remplir en entier — ce n'est pas un défaut de mesure, c'est l'écrêtage, et c'est justement
ce que le repère montre.

**Le module se patche champ par champ.** `putArrayInJson` recopiait `panel` en entier depuis le
patch ; coucher un module en paysage (`{ width, height }` échangées, envoyé sans `peakW`) effaçait
donc sa puissance crête, qui retombait sur le défaut au prochain `parseHouse`. `panel` est
désormais FUSIONNÉ avec l'existant, comme un patch partiel — les autres clés du champ restent, elles,
remplacées telles quelles. Sources : `packages/shared/src/house/schema.ts`,
`packages/shared/src/house/place.ts`, test `place.test.ts` (« patche le MODULE champ par champ »).


### Mise à jour 2026-09-14 — `position` devient optionnelle : un appareil connu de la maison, sans place dans la scène

`houseDeviceSchema.position` passe en `vec3Schema.optional()`. **Absente = appareil NON PLACÉ** : la
maison le connaît, peut lui donner un `name`, mais il n'occupe aucun point de la scène 3D.

Le cas qui l'a imposé est le **véhicule** (cf. `../3_plugins/3_9_renault.md`) : une voiture n'est pas
un objet du bâtiment, et l'utilisateur veut pourtant la renommer. Le nom choisi vivait déjà dans
`devices[].name` — seule la `position` obligatoire empêchait de lui créer une entrée. Un second motif
est à venir : **placer les voitures d'après leur GPS**, la position étant alors CALCULÉE à partir de
l'`origin` de la maison, jamais stockée.

Rendre le champ optionnel a fait remonter **45 erreurs de typage** — autant d'endroits qui
supposaient qu'un appareil a une place. Plutôt que d'y semer des `!`, la garde est posée **une fois,
au seuil de la 3D** :

```ts
export type PlacedHouseDevice = HouseDevice & { position: Vec3 }
export const isPlaced = (d: HouseDevice): d is PlacedHouseDevice => d.position !== undefined
```

`HouseScene.buildMarkers` filtre par `isPlaced` — un appareil non placé n'a **pas de marqueur** — et
tout l'aval (`DeviceMarker`, les six marqueurs, `createMarker`, `roomSideAzimuth`) ne connaît plus que
des appareils placés. Côté magasin, un accès unique `placedSelection()` remplace une douzaine de
gardes : tous les gestes de placement partent d'un marqueur, donc d'un appareil placé.

**Écriture.** `devicePlacementSchema` (`place.ts`) gagne `name` et rend `position` facultative : la
route `PUT /api/house/devices/:id` sert désormais aussi bien à placer qu'à **renommer sans placer**.
Une chaîne vide **efface** le nom choisi et rend la main au nom du fabricant. L'entrée créée pour un
véhicule n'a donc que trois clés :

```json
{ "id": "auto.renault-<vin>", "deviceId": "renault:<vin>", "name": "Voiture 2" }
```

`houseIdForDevice(deviceId)` (`autoplace.ts`) cesse d'être privé : c'est lui qui donne son id à une
entrée créée depuis l'UI pour un appareil qui n'en avait pas.

Sources : `packages/shared/src/house/schema.ts`, `packages/shared/src/house/place.ts`,
`packages/shared/src/house/autoplace.ts`, `apps/web/src/three/HouseScene.ts`,
`apps/web/src/stores/house.ts`.


### Mise à jour 2026-09-14 — deux réglages qu'aucun fabricant ne peut donner : `gpsOffset`, `batteryKwh`

Un véhicule n'a pas de `position` dans le JSON : sa place se calcule à chaque relevé
(`sitePosition`). Deux champs viennent compléter son entrée, et ils ont en commun d'être **saisis**
— rien dans aucune API ne les connaît.

- **`gpsOffset: [x, y]`** (m, repère maison) — correction constante appliquée à la place calculée.
  Ni le GPS d'une voiture ni l'origine de la maison ne sont exacts au mètre : `house/maison.json`
  note lui-même que son `origin` a été déduit d'un repère Maps « à ±1 m près » et que son `heading`
  est estimé sur vue aérienne. L'écart se mesure à l'œil dans la scène et se pose une fois.
  Appliqué **avant** le test d'appartenance au terrain — la place corrigée est la vraie.
- **`batteryKwh`** — capacité utile de la batterie. Aucun fabricant ne la donne : ni Tesla, ni
  Renault, et le code batterie de la fiche technique (`BTGAE`) ne se traduit pas. Elle ne sert qu'à
  estimer une puissance de charge que le véhicule ne dit pas (cf.
  `../1_architecture/1_1_contrat-appareils.md`).

Côté écriture, `devicePlacementSchema` les accepte avec la même convention que le nom vide qui
efface : **`[0, 0]` et `0` effacent** le réglage plutôt que de l'écrire. `placeDeviceInJson` ne les
pose donc jamais à leur valeur neutre, et l'entrée d'un véhicule reste courte :

```json
{ "id": "auto.renault-<vin>", "deviceId": "renault:<vin>", "name": "Voiture 2", "gpsOffset": [2.5, -1] }
```

`sitePosition(house, point, offset?)` gagne son troisième argument ; l'appelant unique est
`HouseScene.effectivePosition` (cf. `../1_architecture/1_5_scene-3d.md`).

Sources : `packages/shared/src/house/{schema,place,geo}.ts`, tests `place.test.ts` et
`house.test.ts`, `apps/web/src/stores/house.ts` (`setDeviceTuning`),
`apps/web/src/views/VehiclesView.vue`.

### Mise à jour 2026-09-14 (bis) — `yawOffset`, troisième réglage saisi

Même famille que les deux précédents, même contrat : **`yawOffset`** (degrés) corrige
l'**orientation calculée** d'un appareil placé par son GPS, comme `gpsOffset` corrige sa place.

- Sur `HouseDevice` : `z.number().optional()` — aucune borne, le champ est un angle.
- Sur `devicePlacementSchema` (écriture) : borné à **±180**, et **`0` efface**, comme `[0, 0]` pour
  le décalage et la chaîne vide pour le nom. C'est l'UI qui ramène l'angle saisi dans `[-180, 180[`
  avant d'écrire : 200° arrive donc en -160°, jamais en refus.
- Sans effet sur un appareil qui a un `yaw` écrit : il fait déjà foi (cf.
  `../1_architecture/1_5_scene-3d.md` pour la chaîne d'orientation complète).

Pourquoi une correction et non un `yaw` absolu : écrire le `yaw` figerait la voiture, alors qu'un
cap de fabricant est une mesure — une Tesla qui tourne doit continuer de tourner à l'écran. La
correction dit ce que la mesure ne dit pas (de quel côté la voiture s'est garée) sans la remplacer.

Sources : `packages/shared/src/house/{schema,place}.ts`, test `place.test.ts`,
`apps/web/src/stores/house.ts` (`setDeviceTuning`),
`apps/web/src/components/vehicles/VehicleTuning.vue`.

### Mise à jour 2026-09-15 — trois réglages d'apparence : `model3d`, `bodyColor`, `bodyFinish`

Un véhicule est désormais dessiné par un vrai modèle 3D, et trois champs de `houseDeviceSchema`
disent lequel et de quelle couleur :

- **`model3d`** — la carrosserie dessinée : `<pluginId>/<modèle>`, identifiant du catalogue web
  (`apps/web/src/three/models/catalog.ts`), ou `'none'` pour la silhouette générique, qu'on choisit
  pour retrouver le repère d'encombrement plutôt que la vraie forme. **Absent = automatique** : le
  catalogue tranche d'après le plugin du véhicule, ce qui est juste dans le cas courant — une seule
  voiture par plugin. Le contrat partagé ne valide que la FORME de l'identifiant, pas l'existence du
  fichier : le catalogue vit côté web, lui seul sait ce qui est livré.
- **`bodyColor`** — la couleur de carrosserie (`#rrggbb`).
- **`bodyFinish`** — l'aspect de la peinture (`solid` / `metallic` / `matte`).

Ces deux derniers **surchargent** ce que le plugin a su déduire (`descriptor.meta.vehicle`, voir
`../1_architecture/1_1_contrat-appareils.md`) : l'ordre est réglage manuel → information du
fabricant → couleur de véhicule de la scène, qui suit le thème.

Côté écriture (`devicePlacementSchema`, `placeDeviceInJson`), les trois suivent la règle du nom, pas
celle du décalage : **chaîne vide = effacer**. Effacer `bodyColor` ne ramène donc pas au gris de la
scène mais à ce que le fabricant dit — c'est tout l'intérêt de garder les deux. Nuance pour
`model3d` : `'none'` est un CHOIX (la silhouette), pas une absence de choix ; c'est la chaîne vide
qui rend la main au catalogue.

Sources : `packages/shared/src/house/schema.ts`, `packages/shared/src/house/place.ts`,
`packages/shared/src/house/place.test.ts`.


### Mise à jour 2026-09-16 — `origin` n'est pas calé sur la photo : deux décalages pour un seul bouton

Constaté avec le robot tondeuse (`../3_plugins/3_11_husqvarna-automower.md`) : le point GPS corrigé du
décalage réglé par l'utilisateur tombe **au bon endroit dans la scène 3D** (contre un mur du
bâtiment) et **plusieurs mètres à côté sur l'orthophoto IGN**. Les deux vues appliquent
la même projection (`geo.ts`, mêmes `origin` et `heading`) : elles sont cohérentes entre elles, c'est
le MODÈLE qui n'est pas calé sur le monde. La note `meta.site` de `house/maison.json` l'annonçait
(repère Maps à ±1 m, cap estimé sur vue aérienne) ; l'écart réel est plutôt une translation de
plusieurs mètres.

Conséquence : `HouseDevice.gpsOffset` (le seul réglage existant) porte aujourd'hui **deux choses** —
le calage de la maison, commun à tous les appareils, et le biais GPS propre à chacun (quelques mètres,
constant : récepteur contre un mur ou sous un débord de toit). Les offsets posés sur les appareils
en portent une part commune. L'origine n'est
aujourd'hui qu'**affichée** dans les Réglages : aucune route ne l'écrit.

Ce qui est à faire, noté pour une prochaine session dans `_generated-ai-doc/calage-maison-photo.md`
(éphémère, hors git) : dessiner le contour du modèle sur les cartes satellite pour VOIR l'écart, puis
rendre `origin` et `heading` réglables depuis les Réglages (route `PUT /api/house/origin`, boutons
de ±0,5 m et ±1°), et décider du sort des décalages par appareil après le calage.


### Mise à jour 2026-09-18 — les ouvertures s'écrivent depuis l'UI, et `openingId` devient réglable

Le relevé d'une maison réelle est approximatif : une fenêtre est posée à 10 cm près, une porte tombe
sur le mauvais quart de mur. Plutôt que de corriger `house/maison.json` à la main et de recharger, un
**mode édition des ouvertures** règle les cotes en regardant la 3D (voir
`../1_architecture/1_5_scene-3d.md` pour le geste et `../4_ui/4_1_navigation-et-panneaux.md` pour le
panneau). Ce qui touche le format tient en deux points.

**1. La cinquième écriture de `house.json` ouverte à l'UI**, après le placement d'un appareil, son
retrait, l'ordre des pièces d'un niveau et les champs de panneaux — et la **première dont la cible
est imbriquée**. Les quatre précédentes patchent un objet de premier niveau (`devices[]`,
`arrays[]`, `levels[]`) ; une ouverture vit dans `rooms[i].openings[j]`, il faut donc localiser la
pièce **puis** l'ouverture avant de patcher :

```
PUT /api/house/rooms/:roomId/openings/:openingId
corps = OpeningPatch { type?, segment?, offset?, width?, height?, sill? }
```

`packages/shared/src/house/place.ts` porte `openingPatchSchema` et `patchOpeningInJson(doc, roomId,
openingId, patch)` — même moule que ses sœurs : **patch du JSON brut** (les champs non cités, et les
commentaires de mise en forme, restent tels quels), `parseHouse` avant écriture, `.bak` + écriture
atomique, maison rediffusée en `{ type: 'house', house }`. Une pièce ou une ouverture inconnue lève
une `PlacementError`. C'est bien `parseHouse` qui garde la porte : une ouverture qui déborde son mur,
qui en chevauche une autre ou qui dépasse le plafond fait un **400** et le fichier reste intact —
d'où l'intérêt de borner l'UI **avant** d'envoyer (`openingLimits`, voir `2_1_geometrie.md`).

**2. `devicePlacementSchema.openingId` devient écrivable.** Le champ `HouseDevice.openingId` existait
depuis le début (un volet « habille » le rectangle de sa fenêtre plutôt que d'être posé librement)
mais **aucun contrôle de l'UI ne l'écrivait** : il se saisissait à la main dans le JSON. Il suit
désormais la règle du nom, pas celle du décalage : **chaîne vide = délier**.

Un détail qui n'est pas cosmétique : **lier ré-ancre l'appareil sur la pièce qui porte l'ouverture**,
quoi qu'ait dit le reste du patch (`place.ts`, après l'ancrage habituel : `roomId` de la pièce
propriétaire, `levelId` mis d'accord s'il était présent, `zoneId` supprimé). Ce n'est pas une
politesse, c'est la validation croisée qui l'exige — `validate.ts` refuse un appareil dont le
`roomId` diffère de la pièce propriétaire de son `openingId` (`opening "…" belongs to room "…"`).
Sans ce ré-ancrage, lier un volet à une fenêtre d'une autre pièce écrirait une maison que
`parseHouse` rejetterait ensuite.

Périmètre assumé de cette étape : **on règle des ouvertures existantes, on n'en crée ni n'en
supprime**. Le format n'a donc pas bougé (`openingSchema` inchangé) ; seule la façon d'y écrire est
nouvelle.

*(Dépassé le 2026-09-18 : ce périmètre est levé plus bas — « Mise à jour 2026-09-18 (3) — une ouverture peut naître et disparaître » ; le format bouge aussi avec « (2) », le nom d'ouverture.)*

Sources : `packages/shared/src/house/place.ts`, `packages/shared/src/house/openings.ts`,
`packages/shared/src/house/validate.ts`, `apps/server/src/http/routes.ts`,
`apps/server/src/http/openings.test.ts`, `packages/shared/src/house/openings.test.ts`.


### Mise à jour 2026-09-18 (2) — une ouverture reçoit un NOM, et deux natures manquaient

La section ci-dessus disait « le format n'a pas bougé, seule la façon d'y écrire est nouvelle ». Les
lots suivants de la même session l'ont fait bouger, sur deux points — et seulement deux.

**1. `openingSchema.name?` — un nom en clair, facultatif, 1 à 60 caractères.** Une ouverture se
désignait jusqu'ici par son **identifiant de relevé** (`fen-salon-est`, `porte-entree`) : parfait
pour un fichier, insuffisant devant quelqu'un qui règle sa baie. Le champ est **optionnel à dessein**
— absent, c'est l'`id` qui s'affiche partout (`openingLabel`, voir `2_1_geometrie.md`), et un
identifiant reste lisible ; il n'est simplement pas toujours un nom. Aucun relevé existant n'a donc à
être retouché.

`openingPatchSchema.name` suit la **convention maison** des champs effaçables, la même que le nom
d'un appareil : **chaîne vide = effacer**, `undefined` = ne pas toucher. `patchOpeningInJson`
l'applique. L'UI borne à 60 caractères côté champ aussi — sans quoi le seul retour est le message
brut de zod (`Too big: expected string to have <=60 characters`), incompréhensible et, pire, la
saisie est perdue (relevé à la revue).

**2. `OPENING_TYPES` passe de quatre à six** : `'bay'` (baie vitrée) et `'glass-door'` (porte vitrée)
s'ajoutent à `door`, `window`, `passage`, `garage`.

La raison est précise, et c'est elle qui vaut d'être retenue : il manquait une combinaison que
**aucune** des quatre premières ne savait dire. Une baie et une porte vitrée sont **vitrées comme une
fenêtre** *et* **posées au sol comme une porte**. Les décrire en `window` donnait une allège et un
appui ; en `door`, un panneau plein. Le relevé d'une vraie maison butait dessus.

Conséquence côté défauts : `openingSill` leur rend **0**, sans changement de code — **seule**
`'window'` prend `defaults.windowSill`. Mais attention au piège mesuré à la revue : `openingSill` ne
rend 0 par défaut que si `sill` est **absent** du JSON. Une fenêtre retypée en baie **garde son
allège explicite** (20 cm mesurés sur la baie du salon, vitrage démarrant au-dessus d'un muret). Le
panneau tranche ce cas pour l'utilisateur en écrivant `sill: 0` **dans la même requête** que le
changement de nature, pour tout sauf `window` (voir `../4_ui/4_1_navigation-et-panneaux.md`) : le
format, lui, continue de dire que l'explicite gagne sur le défaut.

Ce que la scène fait des deux nouvelles natures (menuiserie, refends, absence d'appui) est dans
`../1_architecture/1_5_scene-3d.md`.

Sources : `packages/shared/src/house/schema.ts` (`openingSchema`, `OPENING_TYPES`),
`packages/shared/src/house/place.ts` (`openingPatchSchema`, `patchOpeningInJson`),
`packages/shared/src/house/geometry/walls.ts` (`openingSill`),
`apps/web/src/components/home/OpeningPanel.vue` (`setType`).


### Mise à jour 2026-09-18 (3) — une ouverture peut naître et disparaître

La première section du 2026-09-18 posait un périmètre explicite : « on règle des ouvertures
existantes, on n'en crée ni n'en supprime ». **Ce périmètre est levé ici** ; tout ce qu'elle dit par
ailleurs (patch imbriqué, `parseHouse` en garde, ré-ancrage d'`openingId`) reste vrai. Le schéma, lui,
ne bouge pas : `openingSchema` est inchangé, seules deux façons d'écrire s'ajoutent.

**`newOpeningSchema` — une ouverture ENTIÈRE, pas un patch.** `addOpeningToJson(doc, roomId, opening)`
reçoit `{ id, name?, type, segment, offset, width, height, sill? }` : une ouverture qui naît doit
dire où elle se pose et ce qu'elle mesure, sinon elle n'existe nulle part. C'est le client qui les
calcule, là où le doigt s'est posé (`../1_architecture/1_3_protocole-rest-ws.md` pour la route,
`2_1_geometrie.md` pour les cotes de naissance).

**L'id doit être libre dans TOUTE la maison**, pas seulement dans sa pièce. `validate.ts` l'impose
déjà (`unique` sur l'ensemble des `rooms[].openings[].id`), pour une raison simple : un ouvrant nomme
son ouverture par `devices[].openingId` **sans dire dans quelle pièce elle est**. Un doublon rendrait
le lien ambigu. `addOpeningToJson` refuse donc par une `PlacementError` avant même `parseHouse`.

**L'allège n'est écrite que si elle dit quelque chose.** `0` est le défaut implicite de tout ce qui
descend au sol, et l'omettre garde lisible le fichier qu'on relit à la main — c'est un relevé, pas
une base de données. **La fenêtre fait exception** : sans `sill`, elle retomberait sur
`defaults.windowSill` (voir la mise à jour (2) ci-dessus, où l'explicite gagne sur le défaut), donc un
0 voulu s'écrit. La règle vit dans l'écrivain JSON, à l'endroit où l'on décide de ce que le fichier
montre.

**Retirer une ouverture libère l'ouvrant qui l'habillait, dans la même écriture.**
`removeOpeningFromJson` supprime l'ouverture de sa pièce **et** efface `openingId` sur les appareils
qui la nomment. Sans cela, la validation croisée refuserait la maison entière (`unknown opening
"…"`), et la suppression échouerait sans jamais dire pourquoi. Une maison qui n'avait aucun appareil
lié ne voit pas sa clé `devices` réécrite : on ne touche qu'à ce qui change, comme partout ailleurs
dans `place.ts`.

Sources : `packages/shared/src/house/place.ts` (`newOpeningSchema`, `addOpeningToJson`,
`removeOpeningFromJson`), `packages/shared/src/house/validate.ts` (unicité des ids, `openingId`
croisé), `packages/shared/src/house/place.test.ts`, `apps/server/src/http/openings.test.ts`.

### Mise à jour 2026-09-18 (4) — la menuiserie d'une ouverture : vantaux, matière, couleur

Le relevé disait où est une ouverture et ce qu'elle mesure ; il ne disait rien de ce qu'elle EST.
Trois champs facultatifs de plus sur `openingSchema` (`packages/shared/src/house/schema.ts`) :

- **`leaves: 1..10`** — le nombre de vantaux ;
- **`material: 'wood' | 'metal' | 'glass'`** (`OPENING_MATERIALS`) — la matière de la menuiserie ;
- **`color`** — un `#rrggbb` (`hexColorSchema`, le même que la carrosserie d'un véhicule).

**Les trois sont facultatifs, et c'est le point.** Absents, la scène garde EXACTEMENT ce qu'elle
déduisait déjà : dormant anthracite, vantail bois, une baie large refendue selon sa largeur. Une
maison relevée avant ces champs ne change pas d'aspect parce qu'ils existent — même principe que
`size` / `leaves` d'un ouvrant libre (mise à jour du 2026-09-12) et que `model3d` / `bodyColor`
(2026-09-15) : le fichier ne porte que ce que quelqu'un a voulu dire.

**Attention au mot `leaves`, qui sert deux fois dans le format et ne veut pas dire la même chose :**

| porté par | valeurs | ce que c'est |
|---|---|---|
| `devices[].leaves` (2026-09-12) | 1 ou 2 | les **battants d'un portail**, ce qui s'écarte quand il s'ouvre |
| `rooms[].openings[].leaves` (ici) | 1 à 10 | les **vantaux d'une menuiserie**, ce qui la refend ou découpe son panneau |

Le premier décrit un appareil posé dehors, le second un trou dans un mur. Aucun des deux ne se lit
sur l'autre, et le dessin qu'ils commandent n'a rien de commun.

**Ce que la matière veut dire.** Elle porte sur la menuiserie ENTIÈRE — dormant *et* vantaux — et
non sur le seul panneau : une fenêtre n'a pas de vantail plein à teinter, il fallait donc que la
couleur ait prise sur son cadre. `glass` est la seule des trois qui touche la géométrie : elle
**vitre** l'ouverture, donc une porte pleine déclarée en verre reçoit son vitrage et perd son
panneau opaque, exactement comme une `glass-door` (`../1_architecture/1_5_scene-3d.md`).

**Côté écriture, quatre champs effaçables au lieu d'un.** `openingPatchSchema` accepte désormais la
**chaîne vide** sur `name`, `leaves`, `material` et `color`, et `patchOpeningInJson` RETIRE alors la
clé du fichier au lieu d'y écrire une valeur. La raison se voit sur « Rétablir » : rendre la main au
défaut, ce n'est pas écrire le nombre déduit. Une baie sans `leaves` suit sa largeur ; lui écrire le
`2` qu'elle vaut aujourd'hui la FIGERAIT à deux vantaux pour toujours, et l'élargir ne ferait plus
rien. Un `null` aurait laissé une clé morte dans un relevé qu'on relit à la main ; la clé disparaît.

`newOpeningSchema` ne les prend pas : une ouverture naît de son relevé, aux cotes de sa nature, et
la menuiserie se règle ensuite dans son panneau (`../4_ui/4_1_navigation-et-panneaux.md`).

Sources : `packages/shared/src/house/schema.ts` (`OPENING_MATERIALS`, `MIN_OPENING_LEAVES`,
`MAX_OPENING_LEAVES`, `openingSchema`), `packages/shared/src/house/place.ts`
(`openingPatchSchema`, `patchOpeningInJson`), `packages/shared/src/house/openings.test.ts`.

### Mise à jour 2026-09-18 — le réglage de la lumière entre dans la maison (`render.tuning`)

`houseSchema` gagne une section **`render`** facultative, dont le seul champ à ce jour est `tuning` :
seize valeurs qui règlent la lumière de la scène 3D (exposition, courbe de tone mapping, bloom,
vignette, halo des lampes, et les cinq grandeurs du trait qui souligne la pièce sélectionnée). Le
détail de ce que chaque nombre fait est dans `../1_architecture/1_5_scene-3d.md` ; ce qui se décide
ici, c'est **où il vit**.

**Pourquoi la maison et non les préférences du navigateur**, où vivent déjà le style, l'heure et la
qualité (`kasbah.sceneStyle`, `sceneAmbience`, `sceneQuality`) : une lumière se règle une fois,
devant la maison, et vaut ensuite pour **tous les écrans qui la regardent**. La qualité de
rendu, elle, dépend de la machine qui dessine — c'est la ligne de partage.

**Un réglage neutre EFFACE la section** au lieu d'écrire seize `1` (`setRenderTuningInJson`) : une
maison sans retouche reste une maison sans `render`, et le style redevient la seule source. C'est
exactement ce qu'on veut dire, et ça garde le fichier lisible.

**Validation stricte, pas de `.catch()`.** La première version donnait à chaque champ un
`.catch(neutre)` pour qu'un fichier écrit à la main ne rende jamais la maison illisible. Un test de
route l'a démasquée : la route acceptait alors un `ringWidth: 12` en répondant 200 puis en écrivant
0,14. **Écrire autre chose que ce qui est demandé** est précisément ce qui mord six mois plus tard —
les bornes sont donc dures, une valeur folle vaut 400, et un fichier abîmé à la main se refuse comme
n'importe quel autre champ de la maison. La tolérance est restée là où elle a un sens : le
**brouillon local** du navigateur (`resolveTuning`, `safeParse`), qui n'est qu'un brouillon.

Sources : `packages/shared/src/house/schema.ts` (`sceneTuningSchema`, `renderSettingsSchema`,
`NEUTRAL_TUNING`), `packages/shared/src/house/place.ts` (`setRenderTuningInJson`),
`packages/shared/src/house/place.test.ts`, `apps/server/src/http/render.test.ts`.

### Mise à jour 2026-09-18 (2) — quatre champs de tilt-shift dans `render.tuning`

`sceneTuningSchema` gagne `tiltShift` (force du flou, `0` = éteint), `tiltCenter` et `tiltWidth`
(place et demi-hauteur de la bande nette, en fraction de l'image, **origine en bas** comme les UV) et
`tiltPills` (combien les étiquettes DOM suivent le flou). Ce sont des valeurs ABSOLUES et non des
multiplicateurs, comme les cinq grandeurs du trait de pièce : aucun style ne calcule un tilt-shift,
il n'y a donc rien à multiplier.

Une maison enregistrée avant ce changement se relit sans rien faire : les quatre champs prennent leur
défaut et `tiltShift: 0` veut dire que la passe n'existe pas. Le détail de l'effet est dans
`../1_architecture/1_5_scene-3d.md`.

### Mise à jour 2026-09-18 (5) — l'ouvrant se décrit à son tour : vantaux, matière, couleur, et une place qui suit sa baie

Une ouverture savait déjà dire sa menuiserie (mise à jour (4)). L'OUVRANT qui l'habille, lui, ne
savait rien dire : un moteur Somfy publie une course en pourcents, jamais « volet bois blanc à deux
vantaux ». Ces trois réglages vivent donc dans l'entrée de maison, à côté de `leaves` et `size`
(`packages/shared/src/house/schema.ts`) :

- `coverMaterial` — `wood` | `metal` | `glass` | `fabric`, la MÊME liste que les ouvertures
  (`OPENING_MATERIALS`, qui gagne `fabric` au passage : la toile d'un store, d'un rideau, d'une porte
  de garage à rideau souple) ;
- `coverColor` — `#rrggbb` ;
- `leaves` — 1 ou 2, jusqu'ici réservé aux battants d'un portail, qui DÉCOUPE désormais le tablier
  d'un volet lié à une ouverture (deux panneaux = un volet battant). Le nombre ne change pas la course.

**Pourquoi `cover…` et non `material` / `color`** comme sur une ouverture : `style.color` occupe déjà
le mot « couleur » sur un appareil de maison, et deux champs homonymes dans la même entrée se
confondraient à la lecture.

Les trois passent par `devicePlacementSchema` et s'effacent par la **chaîne vide**, comme
`bodyColor` / `bodyFinish` d'un véhicule : absent = la scène décide
(`packages/shared/src/house/place.ts`).

#### La `position` d'un ouvrant lié suit sa baie

Un volet n'occupe pas un point : il habille un rectangle, et c'est ce rectangle que la scène dessine
depuis toujours. Sa `position` n'est donc plus ce qui le place — mais elle se LIT, dans un fichier
qu'on ouvre à la main, et elle mentait : l'auto-placement la posait une fois, puis l'ouverture était
affinée sans elle. Mesuré sur la maison réelle : **plus de 2 m** d'écart sur certains volets, dont
un se retrouvait sur un AUTRE MUR que sa fenêtre.

`alignDevicesOnOpenings` (`place.ts`) recale les appareils liés au centre de leur baie, dans la MÊME
écriture que celle qui touche l'ouverture — `patchOpeningInJson` (cotes, place sur le mur, nature) et
la liaison d'un ouvrant (`devicePlacementSchema.openingId`). Trois garde-fous :

- le document est **relu** (`parseHouse` + `computeHouseGeometry`) pour écrire exactement le centre
  que la scène dessine (`openingCentre`, cf. `2_1_geometrie.md`), et non un second calcul qui
  divergerait ;
- seuls les appareils qui ont **déjà** une place sont recalés — lier un appareil jamais posé ne lui
  en invente pas une, la scène sait s'en passer ;
- arrondi au millimètre, et rien n'est réécrit si la place n'a pas bougé.

Un document que `parseHouse` refuse est rendu tel quel : c'est l'appelant qui valide, et son erreur
sera plus claire que la nôtre.

`house/maison.json` a été recalé **en une passe** le 2026-09-18 (tous les volets liés), par un script à usage
unique qui appelait `patchOpeningInJson` avec un patch VIDE — il ne touche pas l'ouverture, il ne
déclenche que le recalage. Hors ces places, le fichier est resté identique à l'octet près.
### Mise à jour 2026-09-18 (6) — `site.parkings[]` : où un engin se RANGE quand il est au repos

Un véhicule et un robot n'ont pas de `position` : leur place se calcule à chaque relevé
(`sitePosition`, plus haut). Le relevé est bon à quelques mètres près — assez pour dire « il est
rentré », pas pour le poser dans son garage. Résultat constaté dans la scène : une voiture en travers
d'un mur, une tondeuse à l'arrêt de biais à côté de sa station.

D'où un nouveau tableau du site : **`site.parkings[]`**, le rectangle au sol où un engin se range.

```jsonc
{ "id": "park.garage-1", "name": "Garage 1",
  "accepts": "vehicle",          // le kind qui a le droit de s'y ranger
  "deviceId": "husqvarna:…",     // facultatif : place RÉSERVÉE à cet appareil
  "center": [x, y], "size": [largeur, longueur], "yaw": 90,
  "margin": 3 }                  // facultatif : rayon d'accroche
```

**Deux champs, et deux seulement, disent qui a droit à quelle place** — c'est la demande de
l'utilisateur traduite en contrat :

- **`accepts`** — le kind qui s'y range. « Une voiture ne peut pas se placer à l'endroit d'une
  station de charge de robot » : c'est ce champ qui l'interdit. Il commande AUSSI le dessin (voir
  `../1_architecture/1_5_scene-3d.md`) : `vehicle` donne un marquage au sol, tout le reste un objet.
- **`deviceId`** — place réservée à cet appareil. « Un robot tondeuse possède sa propre base, il ne
  la partage pas avec un robot aspi. » Absent = place PARTAGÉE par tous les appareils du kind, ce qui
  est le cas des voitures : n'importe laquelle se gare dans n'importe quel garage, devant, ou dans
  l'allée.

Écarté : un champ `kind: 'bay' | 'dock'` en plus, pour dire le dessin. Il aurait fallu le tenir
cohérent avec `accepts` (une base qui accepte une voiture n'existe pas), et le dessin se déduit sans
lui — c'est une redondance qu'aucune règle ne réclamait.

`yaw` suit la convention des appareils (0 = l'avant vers +y, sens trigonométrique) : c'est ce qui
donne à la place son AVANT, l'autre demande de départ (« rectangle au sol avec avant/arrière »).

**La règle d'accrochage** vit dans `packages/shared/src/house/parking.ts`, pure et testée sans scène
(`parking.test.ts`, 16 cas) :

- `assignParkings(parkings, candidates)` — le plus près sert le premier, **une place ne reçoit qu'un
  engin et un engin ne prend qu'une place**. Sans cela, deux voitures rentrées le même soir se
  superposaient dans le garage le plus proche des deux relevés.
- `atRest(state)` — « au repos SAUF preuve du contraire », arbitrage pris avec l'utilisateur. La R5
  ne publie ni vitesse, ni rapport, ni état de veille (seule la Tesla les donne, cf.
  `../3_plugins/3_9_renault.md`) : exiger la preuve de l'arrêt revenait à ne jamais ranger la voiture
  qui en a le plus besoin. On accroche donc par défaut, et on lâche dès que le fabricant DIT que
  l'engin bouge (`speedKmh > 0`, rapport D ou R). Une tondeuse, elle, n'est rangée qu'en `parked` ou
  `charging` — `stopped` veut dire « arrêtée là où elle est », au milieu du jardin.
- `parkingDistance(p, xy)` vaut **0 dedans** : le rayon d'accroche se mesure depuis le BORD du
  rectangle, pas depuis son centre. `margin` absent = `PARKING_SNAP_MARGIN` (2 m), l'ordre de grandeur
  du biais qui reste une fois le `gpsOffset` d'un appareil réglé.
- `parkingHost(house, p)` — ce qui PORTE la place : la pièce sous son centre (niveaux du plus bas au
  plus haut, comme pour le cap d'un véhicule), sinon la zone, sinon le terrain. C'est lui qui donne
  les quatre cotes du panneau (`parkingGaps`, `fitParkingGap`) : on mesure une place au mètre ruban
  depuis les murs du garage, pas depuis l'origine du fichier.

**Écriture** (`place.ts`, routes dans `../1_architecture/1_3_protocole-rest-ws.md`) :
`newParkingSchema` pour poser (complet, comme une ouverture qui naît), `parkingPatchSchema` pour
régler (partiel). Deux champs suivent la règle du nom vide qui efface : `name` rend la main à l'id,
et **`margin: 0` efface** au lieu d'écrire une place qui n'accrocherait plus rien. Le `deviceId`
d'une base ne se patche pas : une base qui change de robot est une autre place.

`validate.ts` compte les ids des places dans l'unicité globale — un `id` de place ne peut donc pas
entrer en collision avec une pièce ou un appareil.

Sources : `packages/shared/src/house/{schema,parking,place,validate}.ts`, tests
`packages/shared/src/house/parking.test.ts`.

### Mise à jour 2026-09-19 — une place de stationnement a son NIVEAU

`parkingSchema` gagne **`levelId`** (facultatif, absent = sur le terrain). La première version posait
toutes les places au sol et laissait la pièce sous le point décider du reste : bon pour un garage de
plain-pied, faux dès qu'on veut **une aire de drone sur le toit, une base d'aspirateur à l'étage, une
voiture dans le garage et une autre sur la pelouse** — trois altitudes, trois passes de rendu, trois
hôtes de cotation différents.

Le champ décide de trois choses, et c'est pourquoi il valait mieux qu'un calcul :

- **l'altitude et la passe** : le marquage vit dans les marqueurs de son niveau (cf.
  `../1_architecture/1_5_scene-3d.md`), donc il monte avec lui et disparaît quand on regarde ailleurs ;
- **l'hôte des quatre cotes** : `parkingHost` ne cherche plus la pièce que DANS ce niveau. Le même
  point tombe dans le salon au rez-de-chaussée et dans une chambre à l'étage ; une place du premier
  n'a rien à mesurer depuis la pièce du dessous ;
- **ce qu'on cote quand il n'y a pas de pièce** : un niveau sans pièce sous le point (le toit qui
  porte l'aire de drone) rend son **emprise** (`level.outline`) quand elle est déclarée — sinon il n'y
  a rien à coter, et le panneau affiche « — » plutôt qu'une mesure inventée.

Sans `levelId`, le comportement d'avant est conservé mot pour mot (pièce la plus basse, puis zone,
puis terrain) : une place écrite avant le champ ne bouge pas.

Côté écriture, c'est le SOL TOUCHÉ dans la 3D qui le remplit (`groundTap` porte le niveau de la
surface tapée), ou la pièce d'où l'on a armé la pose. `validate` refuse un `levelId` inconnu, comme
pour un appareil.

Sources : `packages/shared/src/house/{schema,parking,place,validate}.ts`, test
`packages/shared/src/house/parking.test.ts` (« cherche sa pièce DANS son niveau »).

### Mise à jour 2026-09-19 — ouvertures de SURFACE : fenêtre de toit et puits de lumière

Deux natures s'ajoutent à `OPENING_TYPES` : `roof-window` (Velux / fenêtre de toit) et
`skylight` (puits de lumière au sol). Ce ne sont plus des ancrages muraux.

**Ancrage** : `x`, `y`, `yaw` (centre en plan + cap, même convention que les places) à la place de
`segment` / `offset` / `sill`. `width` = travers, `height` = axe du cap (longueur). Le schéma
(`openingSchema`) exige l'un OU l'autre jeu de champs selon `isSurfaceOpening(type)`.

**Pièce porteuse** : une `roof-window` doit vivre dans une pièce du niveau déclaré par
`roof.levelId` (souvent l'étage sous la dalle). Un `skylight` vit dans la pièce dont le sol est
percé.

**Validation** : deux ouvertures de surface ne se chevauchent que si elles ont le **même type** —
sol et toit sont deux porteurs ; un puits et un Velux peuvent partager la même emprise en plan
(puits traversant) sans conflit. `surfaceFitsInPolygon` refuse un rectangle qui sort de la pièce.

**Écriture** : `newOpeningSchema` / `addOpeningToJson` / `patchOpeningInJson` acceptent `x`/`y`/`yaw`.
Les cotes de panneau pour une surface sont longueur × largeur (libellés UI), pas hauteur d'allège.

Sources : `packages/shared/src/house/{schema,validate,openings,place}.ts`,
`packages/shared/src/house/surface-openings.test.ts`, `house/demo-house.json`.

### Mise à jour 2026-09-22 — `size` sert aussi à une TV

`HouseDevice.size` (largeur × hauteur en mètres) dimensionnait déjà un ouvrant libre. Une
**TV** (`media_player` / `deviceClass: tv`) y stocke maintenant sa dalle 16:9, dérivée de la
diagonale commerciale saisie en pouces dans l'UI (`../4_ui/4_1_navigation-et-panneaux.md`).
Absent = défaut 45″ (`DEFAULT_TV_SIZE` / `tvSizeFromInches` dans `apps/web/src/lib/orientation.ts`).
Le marqueur 3D suit (`../1_architecture/1_5_scene-3d.md`).

Sources : `packages/shared/src/house/schema.ts`, `apps/web/src/lib/orientation.ts`,
`apps/web/src/three/markers/markers.ts`.

### Mise à jour 2026-09-22 (bis) — `speakerShape` : silhouette 3D d'une enceinte

Champ optionnel `HouseDevice.speakerShape` : `'default' | 'pebble' | 'bar' | 'block'`
(`SPEAKER_SHAPES` dans `schema.ts`). Absent = cylindre actuel (`default`) — pas de migration.
**Chaîne vide** dans `devicePlacementSchema` / `placeDeviceInJson` **efface** le champ (retour au
défaut), comme `coverMaterial` / `model3d`. Indépendant de `model3d` (réservé aux véhicules).

Écrit depuis le panneau via `setDeviceTuning` (`stores/house.ts`), sans exiger le mode glisser 3D.
`bar` et `block` rendent l'enceinte orientable (`isOrientable`) ; `default` et `pebble` non.

Sources : `packages/shared/src/house/{schema,place}.ts`, `apps/web/src/stores/house.ts`,
`apps/web/src/lib/orientation.ts`.

### Mise à jour 2026-09-25 — `height` d'une pièce ne monte plus aucun mur

Complète la mise à jour 2026-09-12 (bis) : les **cloisons** ne suivent plus la hauteur sous plafond
non plus. Tous les murs montent au moins à la hauteur du niveau (`wallHeight`, cf.
`2_1_geometrie.md`, mise à jour 2026-09-25) ; `height` ne sert plus qu'au plafonnier (`autoplace`) et au
contrôle des ouvertures (`validate`). Plus aucune pièce du relevé réel (`house/maison.json`) ne déclare
de `height`.

### Mise à jour 2026-09-26 — `site.relief` : le terrain a un relief

Jusqu'ici le terrain était un polygone plat à `site.elevation`. Le champ **facultatif**
`site.relief` lui donne une surface : une grille régulière de hauteurs, en **écart à
`site.elevation`**, au pas `step` (m), à partir du coin `origin` (m, repère maison).

```jsonc
"relief": {
  "step": 2,
  "origin": [-20, -30],
  "rows": ["0 0 12 15 …", "0 3 20 41 …"]   // une rangée par chaîne, du sud au nord ; cm entiers, d'ouest en est
}
```

- **Une rangée par chaîne, en centimètres** plutôt qu'un nombre par ligne : `updateHouseFile`
  réécrit le fichier par `JSON.stringify(doc, null, 2)`, qui aurait mis chaque point sur sa
  ligne. En chaînes, ils tiennent en quelques dizaines de lignes, et un diff montre la rangée qui a
  bougé. `reliefSchema` refuse des rangées de longueurs différentes (400, rien n'est écrit).
- **Hors de la grille**, la hauteur est celle du bord le plus proche.
- **Absent = terrain plat**, exactement comme avant le champ. Un relief entièrement à zéro n'est pas
  écrit : `setReliefInJson(doc, relief | null)` retire alors le champ (même règle que
  `render.tuning` neutre).
- **Écrit depuis l'éditeur de la vue Maison** (`PUT /api/house/relief`, cf.
  `../1_architecture/1_3_protocole-rest-ws.md`), jamais à la main en pratique.

Ce que le relief change ailleurs dans le fichier : `position.z` d'un appareil **extérieur** reste
relative au terrain, mais au terrain **sous lui** — `deviceFloorZ` lit désormais la surface en
(x, y) (`houseTerrain(house)`, calculé une fois par objet maison). Un capteur posé à 1,80 m sur une
bosse de 60 cm est à 2,40 m. Les bornes de cadrage (`siteBounds`, `zoneBounds`) couvrent la plage
du relief. Comment la surface est lue (lissage, écrêtage sous les planchers, bassins) :
`2_1_geometrie.md`.

Sources : `packages/shared/src/house/schema.ts` (`reliefSchema`), `packages/shared/src/house/place.ts`
(`setReliefInJson`), `packages/shared/src/house/lookup.ts` (`houseTerrain`, `deviceFloorZ`),
`packages/shared/src/house/geometry/bounds.ts`, `apps/server/src/http/relief.test.ts`.

### Mise à jour 2026-09-26 — `height` d'une fenêtre de toit, Velux de la démo déplacé

Pour une `roof-window`, `height` est la longueur **le long de la pente** (taille du fabricant) ; la
géométrie la raccourcit de cos(pente) en plan (`../2_maison/2_1_geometrie.md`). Un `skylight` est
à plat : rien ne change pour lui.

Démo (`house/demo-house.json` et sa copie identique
`packages/shared/src/house/__fixtures__/demo-house.json`) : `velux-ch1` passe de `y: 1.6` à
`y: 3.1`. Il était entièrement sous le champ `pv-sud` (rangée 0, colonnes 3-4) ; il est désormais
au-dessus du champ, à ≈ 30 cm du faîtage et des modules. Test : « keeps every roof-window clear of
the solar panels » (`packages/shared/src/house/surface-openings.test.ts`).

### Mise à jour 2026-09-26 (bis) — `yaw` d'une fenêtre de toit posée sur un versant

Sur un versant, le `yaw` écrit d'une `roof-window` est **ignoré** : la géométrie, la validation, les
cotes et la pose prennent le cap de la descente (`surfaceFootprint`, `2_1_geometrie.md`). Il reste
lu sur un toit plat. La validation juge désormais « tient dans la pièce » et le chevauchement sur la
longueur vue du ciel (`height × cos(pente)`) : un Velux peut approcher le mur de sa vraie emprise.

### Mise à jour 2026-09-28 — `site.garden[]` : arbres, buissons et pierres posés à la main

Nouveau tableau du site, à côté de `zones` et `parkings` (absent = jardin vide). Chaque élément a un
`id` unique **dans toute la maison**, une famille (`kind` : `broadleaf`, `conifer`, `palm`, `shrub`,
`rock` ; puis `hedge`, et `bamboo` et `fruit` le 2026-09-29, voir `2_2_jardin.md`), un pied (`center`), une **hauteur seule** (0,1 à 40 m, la largeur découle de la forme),
et trois champs optionnels : `yaw` (trigonométrique, absent = 0), `seed` (absent = hachage de l'id)
et `species` (id d'une recette du catalogue de l'app ; une espèce inconnue retombe sur la forme de
la famille, le fichier reste donc valide d'une version à l'autre). C'est du décor : aucun appareil,
aucun état.

Écrit depuis le mode édition (`addGardenItemToJson` / `patchGardenItemInJson` /
`removeGardenItemFromJson`, même patch du JSON brut que les places). Un `yaw` nul et un `species`
vide sont **effacés**, pas écrits. Tout le détail (pourquoi, rendu, espèces, saisons) :
`2_2_jardin.md`.

Sources : `packages/shared/src/house/{schema,validate,place}.ts`, `packages/shared/src/house/place.test.ts`,
arbre de travail non commité après cf60c7d.

### Mise à jour 2026-09-29 — la haie : `kind: "hedge"`, `length`, `width`

Sixième famille, `hedge`, et deux champs optionnels qui ne servent qu'à elle : `length` (0,5 à
100 m, absent = `DEFAULT_HEDGE_LENGTH` = 3) et `width` (0,2 à 5 m, absent = `DEFAULT_HEDGE_WIDTH` =
0,7). Une haie est un **segment droit** centré sur `center`, le long de l'axe x local tourné de
`yaw` ; une haie en L s'écrit en deux segments. Choix écarté : une polyligne de points, qui aurait
demandé un outil de tracé ; le segment réutilise la pose, le glissement et le cap existants.
Contrairement aux autres familles, la haie a donc une emprise réglée, pas déduite de sa forme.
`addGardenItemToJson` écrit les deux champs s'ils sont donnés, `patchGardenItemInJson` les règle
(changement additif : GitNexus classe les deux fonctions HIGH, leurs appelants sont la route serveur
et le transport simulé). Test : `place.test.ts` (« une haie porte sa longueur et sa largeur… »).
Rendu : `2_2_jardin.md`.

Même jour, plus tard : troisième champ de haie, `spacing` (0,2 à 5 m, de pied à pied entre ses
sujets ; absent = automatique). Dans un RÉGLAGE, `spacing: null` l'efface (retour à l'automatique),
sur le modèle de `species: ''` : `gardenItemPatchSchema` étend le schéma d'ajout d'un
`.nullable()`, et le magasin (`withGardenDraft`) retire le champ de l'aperçu au lieu d'y écrire
`null` (le typecheck l'a signalé : `null` n'est pas une valeur d'élément).

### Mise à jour 2026-10-01 — le contour du terrain (`site.terrain`) s'écrit depuis l'UI

Jusqu'ici `site.terrain` (le polygone de la parcelle) ne se changeait qu'à la main dans le JSON.
Il s'édite maintenant depuis l'éditeur « Modeler le terrain » (onglet Contour, voir
`../4_ui/4_1_navigation-et-panneaux.md`) : sommets déplacés, ajoutés, supprimés.

- **`setTerrainInJson(doc, polygon)`** (`packages/shared/src/house/place.ts`) remplace
  `site.terrain` en entier (corps = le polygone, pas un patch). Un contour non simple lève
  `PlacementError` (400, rien n'est écrit) : la règle est `isSimplePolygon` (voir
  `2_1_geometrie.md`).
- **Le relief suit.** Un contour agrandi sortirait de la grille de `site.relief`, qui ne couvre que
  l'ancienne parcelle. `setTerrainInJson` appelle `extendReliefGrid` et réécrit `site.relief` s'il a
  grandi (même grille rendue = rien réécrit). Les nouveaux nœuds prennent la hauteur du bord le
  plus proche : c'est déjà ce que la lecture donnait hors grille, donc le terrain modelé ne bouge
  pas. Le brouillon de la scène fait le même calcul, pour que l'écran et le fichier ne divergent pas.
- **Rien n'est retiré du fichier** quand un contour rétréci laisse dehors des arbres, des places,
  des zones, des appareils : l'éditeur avertit (choix de l'utilisateur : avertir, ne pas bloquer).
  Le fichier garde donc parfois des éléments hors parcelle ; ils reviennent dedans si on réagrandit.
- Route : `PUT /api/house/terrain` (`../1_architecture/1_3_protocole-rest-ws.md`).

Tests : `apps/server/src/http/terrain.test.ts`, `packages/shared/src/house/geometry/{vec2,relief}.test.ts`.

Sources : `packages/shared/src/house/place.ts`, `apps/server/src/http/routes.ts`,
`apps/server/src/http/terrain.test.ts` (arbre de travail non commité après 1ce4a91).

### Mise à jour 2026-10-03 — finitions : sol et murs d'une pièce, façade

Demande de l'utilisateur : l'édition de pièce (apparence du sol et des murs, puis dimensions), étape
vers la modélisation complète de la maison depuis l'UI. Décisions prises avec lui : apparence **par
pièce + façade** (pas par pan de mur), textures **versionnées**, **teinte libre sur les peintures
seules**, et **jamais d'écriture de house.json sans geste explicite** (« Valider »).

**Une pièce enregistre une FINITION, jamais une image.** Catalogue `FINISHES`
(`packages/shared/src/house/finishes.ts`) : 36 entrées, chacune avec sa famille (`wood`, `tile`,
`carpet`, `concrete`, `paint`, `stone`, `siding`, `pavers`), les surfaces qu'elle peut habiller
(`floor` / `wall` / `facade`), l'identifiant ambientCG, le dossier d'images, la cote d'une image
(`tileM`), sa couleur moyenne (repli procédural) et `tintable` (famille `paint` seulement). C'est
la scène qui interprète la finition selon le style de rendu (voir `../1_architecture/1_5_scene-3d.md`).

Champs (`schema.ts`) :

- `room.style.floorFinish` et `room.style.wallFinish` : `{ id, tint? }` (`finishSchema`). Le sol
  passe devant l'ancien `style.floor`, gardé comme repli des styles qui ignorent les finitions. Les
  murs = les faces INTÉRIEURES des murs de la pièce (cloisons et intérieur des façades).
- `house.style.facade` : finition des faces extérieures des murs extérieurs.
- Validation : une finition hors de sa surface (moquette en façade) et une teinte sur une finition non
  teintable sont refusées par le schéma (donc par `parseHouse`, 400 côté serveur).

**Écriture** : `applyAppearanceToJson(doc, patch)` (`packages/shared/src/house/appearance.ts`), patch
`{ rooms?: { [roomId]: { floor?, walls? } }, facade? }` où `null` RETIRE la finition ; un `style`
devenu vide disparaît du fichier ; pièce inconnue → `PlacementError`. La même fonction sert au
brouillon montré par la scène (maison parsée) et à l'écriture (JSON brut) ;
`mergeAppearancePatch` compose les gestes successifs. Route : `PUT /api/house/edit` (séance d'édition, `apps/server/src/http/routes.ts`, `houseEditPatchSchema` ; corrigé le 2026-10-06 — la route `PUT /api/house/appearance` mentionnée ici n'existe pas)
(`../1_architecture/1_3_protocole-rest-ws.md`).

**Descripteurs** : `FloorDescriptor.finish`, `LevelGeometry.wallFinishes` (par pièce, absent si
aucune) et `HouseGeometry.facade` (`geometry/{types,floors,index}.ts`). Une maison sans finition
garde des descripteurs strictement identiques.

Reste à venir (même demande) : les DIMENSIONS. Décision en cours de discussion : le relevé
(`meta.survey`) généralisé en « cotes intérieures » maîtresses, `fit-survey.mjs` porté dans
`packages/shared`, polygone toujours dérivé.

Tests : `packages/shared/src/house/appearance.test.ts`.

Sources : `packages/shared/src/house/{finishes,appearance,schema}.ts`, `packages/shared/src/house/geometry/{types,floors,index}.ts`.

### Mise à jour 2026-10-03 (bis) — les dimensions s'écrivent depuis l'UI : les cotes deviennent la donnée

Suite de la section précédente (même demande). Décisions de l'utilisateur : **pousser un mur et
taper une cote** (le glissement de sommet reste possible), le **mur mitoyen entraîne la pièce d'en
face**, une ouverture qui ne tient plus **bloque « Valider »**, et **un seul brouillon** pour
l'apparence et la forme. Objectif annoncé : la modélisation complète d'une maison depuis l'UI, en
saisissant les cotes d'un relevé ou d'un plan.

**Les cotes (`meta.survey.points`) sont la donnée, le polygone en est déduit** — la convention du
2026-09-07 tient, elle passe simplement de l'outil en ligne de commande au code partagé :

- `fitSurvey` (`packages/shared/src/house/survey.ts`) est le portage À L'IDENTIQUE de
  `house/fit-survey.mjs`, qui n'en est plus que l'enveloppe (`tsx/esm/api`). Équivalence vérifiée
  sur `house/maison.json` : même compte rendu `--check`, et même fichier écrit, octet pour octet,
  sur une copie dont six relevés avaient été perturbés.
- **Ajout au calcul : un passage ouvert (`walls[].kind: "none"`) ne recule pas** et n'est pas
  contrôlé (pas de cloison, pas d'écart requis). Sans effet sur une maison qui n'en déclare aucun —
  la démo en a un (salon | cuisine), que le calcul reculait de 10 cm.
- **Nouveau contrôle `overlappingRooms`** : le contrôle de `fitSurvey` ne voit que les faces en
  vis-à-vis ; une pièce poussée AU TRAVERS de sa voisine lui échappait. Fait sur les faces finies
  resserrées d'1 cm (deux pièces jointives ne comptent pas).
- **`withSurveyPoints`** : une maison jamais relevée (la démo) reçoit ses cotes par le calcul
  inverse à la première modification de forme — arête mitoyenne repoussée de la moitié de l'écart,
  arête d'une pièce sans mur repoussée jusqu'à la face de la pièce murée. `fitSurvey` en redonne
  exactement les polygones (test). Conventions écrites : `unit: "cm"`, `partition` = deux murs
  intérieurs. Effet de bord : un niveau sans `outline` en reçoit une (boîte des pièces murées).

**Séance d'édition** (`packages/shared/src/house/edit.ts`) : `HouseEditPatch = { appearance?,
shapes? }`, `shapes` = nouvelles cotes par pièce (unité et repère du relevé).
`applyHouseEditToJson` applique l'apparence, convertit si besoin, pose les cotes, recalcule
(`fitSurvey`), puis :

- **recale les ouvertures murales** de chaque pièce dont le polygone change : leur CENTRE est projeté
  sur l'arête qui prolonge leur ancien mur (même sens, la plus proche) — elles gardent leur place
  réelle, pousser le mur voisin ne les fait pas glisser, et un sommet ajouté décale leur numéro
  d'arête sans les déplacer. Aucune n'est rognée : celle qui ne tient plus est refusée par
  `parseHouse` ;
- **suit les surcharges gardées** (`none`, `exterior`) quand le nombre de sommets change ;
- rend `blocking` (vis-à-vis trop serré, chevauchement, relevé retourné) et `warnings` ; ne lève que
  pour une pièce inconnue.

**Gestes** (`packages/shared/src/house/shape.ts`), en cotes : `pushWall` (le mur glisse le long de
sa normale, ses sommets le long des murs voisins ; avec `coupled`, le mur de la pièce d'en face —
même ligne de relevé à 2 cm près, recouvrement — suit du même déplacement), `setEdgeLength` (le mur
SUIVANT recule ou avance), `moveVertex`, `insertVertex` (milieu du côté), `removeVertex`.

L'ordre des clés d'une pièce est celui du script (`openings` avant `style`) : la première écriture
depuis l'UI le remet dans `maison.json` (pour les pièces où l'UI avait ajouté des ouvertures), sans rien
changer au contenu.

Tests : `packages/shared/src/house/{survey,edit,shape}.test.ts`.

Sources : `packages/shared/src/house/{survey,edit,shape}.ts`, `house/fit-survey.mjs`.

### Mise à jour 2026-10-06 — `scenes[]` retiré du format

Décision de l'utilisateur, suite au lint du même jour : le champ `scenes` (« scènes maison », lots de
commandes `{ id, name, icon?, actions: [{ deviceId, command }] }`) est **retiré** du schéma
(`houseSceneSchema`, `sceneActionSchema` et le type `HouseScene` de `packages/shared/src/house/schema.ts`)
et des deux copies de la maison de démo. Plus aucun code ne le lisait depuis le retrait des ambiances
maison du panneau d'accueil (2026-09-22 bis, `4_1`) ; les automatisations (`1_8`) et les ambiances des
plugins couvrent le besoin. Compatibilité : `houseSchema` est un `z.object` (clés inconnues ôtées), donc
un fichier qui porte encore `scenes` se charge sans erreur et perd la clé à la prochaine écriture par le
serveur — verrouillé par un test de `house.test.ts`. La maison réelle avait `scenes: []`.

### Mise à jour 2026-10-08 — trois maisons de démonstration, `meta.demo`, la fixture des tests

Le dépôt va devenir public : il lui fallait une maison de démonstration qui montre toutes les
fonctions **sans reprendre la forme ni les noms de la maison réelle** (qui reste hors dépôt, voir
« `house/maison.json` » plus haut). `house/demos/` porte donc trois propriétés inventées, chacune
choisie pour exercer un pan différent du format :

| Fichier | Propriété | Ce qu'elle exerce |
|---|---|---|
| `tilleuls.json` | « Les Tilleuls » (Dijon, origine sur le cours du Général-de-Gaulle, cap 0) | R+1, toit à deux pans, garage double (deux portes de garage liées par `openingId`), terrasse d'étage posée sur le garage (pièce `terrace` au niveau étage, sol à partir de la face extérieure), pièce `stairs`, home cinéma, relief (grille de 4 m), 25 éléments de jardin, places (deux au garage avec `levelId: rdc`, allée, bases tondeuse et aspirateur), fenêtre de toit motorisée (cover `window` liée à une `roof-window`), champ 2×6 en toiture (`slope` 35), façade enduit teinté. 17 pièces, 56 appareils. |
| `embruns.json` | « Les Embruns » (Pornic, bord du golf, cap 0) | plain-pied en L à toit plat : `outline` en L **explicite** (sans lui la boîte englobante couvrirait l'angle), séjour en L ouvert sur la cuisine (`walls` à `none`, arête coupée par un point colinéaire), couloir dont l'arête est coupée en (6, 10) (mitoyenne puis façade), puits de lumière, brise-soleil `blind` avec `tilt`, voile d'ombrage, carport, portail coulissant, deux rangées sur châssis (`tilt` 15). 9 pièces, 33 appareils. |
| `belvedere.json` | « Le Belvédère » (Lille, Grand-Place) | appartement au 4e étage (élévation 12,2 m), balcon (`balcony`), ni toit, ni jardin, ni véhicule, façade brique. 8 pièces, 26 appareils. |

Chacune porte **`meta.demo = { scenario, kind }`** : `scenario` est le parc simulé qui la peuple
(`tilleuls`, `embruns`, `belvedere`, voir `../3_plugins/3_0_simulation-mock.md`), `kind` sa nature
(`house` ou `apartment`). Une seule source : le serveur (`apps/server/src/config/properties.ts`) et le
web (`apps/web/src/api/demoProperties.ts`) lisent ce même champ, sans table parallèle à tenir à jour.
Une propriété de démo sans `meta.demo.scenario` fait échouer le chargement du serveur.

**Pourquoi trois et pas une** : à la demande de l'utilisateur, deux maisons différentes (toit en
pente / toit plat) **plus** un appartement. Le tableau montre ce que chacune apporte que les autres
n'ont pas (le L et son `outline`, le balcon et l'étage élevé, la fenêtre de toit).

**La fixture des tests n'est plus la démo.** `house/demo-house.json` et sa copie
`packages/shared/src/house/__fixtures__/demo-house.json` restent la maison **des tests** (toujours
deux exemplaires identiques, voir `3_0`), mais ne sont plus ce que le serveur sert sans réglage ; elles
ont été anonymisées pour le dépôt public : « Plafonnier / Ventilateur » d'un prénom devient « chambre 2 »
(ids `fan-chambre2_*`, `light.chambre2`, `fan.chambre2`) et le « travail » des véhicules simulés est la
place de la Libération à Dijon (47.3216, 5.0415). Les tests de la démo : `packages/shared/src/house/demos.test.ts`
(validité, lint propre, toit `gable` / `flat` / aucun), `apps/web/src/three/demos.test.ts` (chargement
headless), `packages/mock-sim/src/demos.test.ts` (liaison maison ↔ parc exacte).

**Les maisons sont des JSON, pas du code** : elles ont été produites par des scripts de brouillon qui
ne sont pas au dépôt. Seul le JSON fait foi ; pour une retouche, éditer le fichier (ou l'UI, mais voir
le piège ci-dessous).

Deux contraintes apprises en les écrivant :

- **Chaque finition photo distincte coûte au chargement.** Les Tilleuls, avec 19 finitions photo
  différentes, figeaient la preview plus de 45 s (préparation des matières) ; ramenées à 11, le
  chargement redevient normal (Belvédère 11, Embruns 7). Compter les finitions d'une maison avant d'en
  ajouter une. Voir aussi `../1_architecture/1_5_scene-3d.md`.
- **Une `roof-window` doit appartenir à une pièce du niveau sous le toit** : retirer le toit d'une
  maison qui en porte une la rend invalide.

Piège : comme pour la fixture, **une édition depuis l'UI réécrit le fichier versionné** de la
propriété affichée. En démo sur le serveur, le fichier modifié est `house/demos/<id>.json` : à relire
avant tout commit. Le « Piège de la démo » de `../4_ui/4_1_navigation-et-panneaux.md` (origine sur une
rue, import cadastre sans parcelle) décrit `house/demo-house.json` ; les Tilleuls ont repris
la même origine, donc le constat vaut pour eux aussi (non revérifié le 2026-10-08).

Sources : `house/demos/*.json`, `packages/shared/src/house/demos.test.ts`,
`apps/server/src/config/properties.ts`, `apps/web/src/api/demoProperties.ts`.

### Mise à jour 2026-10-10 — pièces et niveaux qui naissent ou disparaissent dans la séance d'édition

Suite de « les cotes deviennent la donnée » (2026-10-03 bis) : la séance d'édition porte aussi la
**structure**. Demande de l'utilisateur, préalable à la création d'une maison depuis une installation
neuve : ajouter une pièce (contre un mur choisi, ou au tap), un étage ou un sous-sol, retirer une pièce
ou un niveau vide, changer le nom et le type d'une pièce.

**Patch** (`packages/shared/src/house/structure.ts`, champs ajoutés à `houseEditPatchSchema`) :
`newLevels[] { id, name, shortName?, side: 'above' | 'below' }`, `removeLevels[]`,
`newRooms[] { id, levelId }`, `removeRooms[]`, `rooms: { [id]: { name?, kind? } }`. Une pièce qui
naît a ses **cotes dans `shapes`**, comme les autres : tous les gestes de l'onglet Dimensions marchent
sur elle. Tous optionnels : une séance qui ne s'en sert pas se comporte exactement comme avant.

**Application** (`applyHouseEditToJson`, dans l'ordre) : conversion en relevé (`withSurveyPoints`) si
une forme, une pièce ou un type change ; structure (`applyStructureToJson`) ; apparence ; formes ;
`fitSurvey`. Ce que la séance dit d'une pièce qu'elle retire (cotes, finitions) est ignoré.

- **Étage** : posé sur le plus haut niveau HABITÉ (qui a des pièces, ou né dans la séance) —
  élévation = son élévation + sa hauteur (`height` ou `defaults.levelHeight`) + `slabThickness` ;
  hauteur = `levelHeight`. Les niveaux vides au-dessus (le niveau du toit, cf. 2026-09-11) montent de
  `levelHeight + slabThickness`. **Sous-sol** : sous le plus bas, mis en tête de `levels`. Deux étages
  de suite s'empilent.
- **Pièce retirée** : elle sort de `roomOrder` ; ses appareils perdent `position`, `roomId`,
  `levelId`, `zoneId`, `openingId` (connus sans place, cf. 2026-09-14) ; un appareil lié à une de ses
  ouvertures perd `openingId`. La voisine regagne sa demi-cloison au recalcul.
- **Niveau retiré** : seulement vide (ni pièce, ni appareil, ni place, ni champ de panneaux, ni
  `roof.levelId`) — sinon motif bloquant `<id> : niveau non vide`.
- **Le toit suit** (`roof.levelId`) le plus haut niveau qui a des pièces murées, dès que la séance
  ajoute ou retire une pièce ou un niveau ; calculé AVANT le contrôle des niveaux retirés (l'étage
  qu'on vide puis retire n'est plus celui qui porte le toit). Conséquence : une fenêtre de toit restée
  sous un nouvel étage habité est refusée par `parseHouse` — l'écran le dit (`structure.roofWindowUnder`).
- **Type** `room` : non écrit s'il ne l'était pas (défaut du schéma).

**Gestes** (`shape.ts`) : `roomAgainstWall(doc, roomId, edge, depth = 3)` — rectangle de la longueur
du mur sur 3 m, de l'autre côté, sur la MÊME ligne de relevé : `fitSurvey` en fait une cloison, ce qui
**reprend une demi-cloison à la pièce existante** (un mur de façade devient une cloison centrée sur la
ligne) ; `rectRoomAt(doc, levelId, at, 4, 4)` — carré centré, coins calés au décimètre.

Tests : `packages/shared/src/house/structure.test.ts` (16).

Sources : `packages/shared/src/house/{structure,edit,shape}.ts`.


### Mise à jour 2026-10-10 (2) — la maison neuve de l'assistant de création, `meta.kind`

`packages/shared/src/house/newHouse.ts` fabrique le JSON d'une propriété créée depuis l'UI
(`newHouseJson`, valide pour `parseHouse`). **Pourquoi une première pièce d'office** : une maison sans
pièce ne se voit pas et n'a rien à éditer ; l'utilisateur a choisi une pièce de **5 × 4 m** (`FIRST_ROOM`)
avec **un coin au point 0**, puis un guide enchaîne contour du terrain → cotes de la pièce.

- Contenu : `schemaVersion` 1, `origin` (lat, lon, cap, `alt` à 0 par défaut), niveau `rdc`
  (élévation 0), pièce `piece-1` (libellés dans la langue de l'écran qui crée), `site.terrain`
  rectangulaire, `devices: []`, **`plugins: {}`** (aucun plugin actif).
- **Terrain** : rectangle `width × depth` **centré sur la pièce** (pas sur le point 0). Pour un
  appartement, ou sans terrain donné, une **marge de 2 m** autour de la pièce (un sol où poser un
  balcon).
- **Toit** : plat sur `rdc` pour une maison ; **aucun** pour un appartement.
- **`meta.kind: 'apartment'`** n'existe que pour un appartement : la nature d'une propriété se lit
  donc dans `meta.demo.kind` (démos) puis `meta.kind` (propriétés créées), maison par défaut
  (`kindOf`, `apps/server/src/config/properties.ts`).
- `propertyIdFor(name, taken)` : id lisible tiré du nom (accents retirés, 40 caractères au plus,
  `-2`, `-3`… si pris ; `propriete` si le nom ne donne rien).

Tests : `packages/shared/src/house/newHouse.test.ts`.

Sources : `packages/shared/src/house/newHouse.ts`, `apps/server/src/config/properties.ts`.

### Mise à jour 2026-10-10 (ter) — nom de la propriété et noms d'un niveau dans la séance d'édition

Deux champs de plus dans le patch de structure (`packages/shared/src/house/structure.ts`) :
`propertyName` (le `name` de la maison : en-tête, sélecteur de propriétés) et
`levels: { [id]: { name?, shortName? } }` (niveau existant ou né dans la séance ; un `shortName`
vide RETIRE la clé — l'onglet reprend alors le nom, cf. `shortName ?? name` dans `HomeView.vue`).
Renommer ne convertit pas la maison en relevé (`structureReshapes` ne regarde que pièces et types).
Un niveau inconnu lève `PlacementError`. Le serveur de catalogue donne au sélecteur le nom VIVANT de
la propriété ouverte (`main.ts`), qu'un renommage vient peut-être d'écrire.

Tests : `structure.test.ts`, `apps/web/src/stores/house.structure.test.ts`.

### Mise à jour 2026-10-12 — `devices[].mapOffset` : décaler la CARTE du terrain d'une tondeuse

Nouveau champ facultatif d'un appareil de la maison : `mapOffset: [x, y]` (`vec2`, **mètres, repère
maison**), `houseDeviceSchema` (`packages/shared/src/house/schema.ts`). Il recale la **carte du terrain**
qu'une tondeuse publie (capacité `site_map`), posée par sa station sur la base du robot : ni cette base ni
la photo aérienne ne sont exactes au mètre, et c'est la carte entière qu'on recale sur la photo.

Il est **indépendant de `gpsOffset`**, qui ne déplace que le robot : régler l'un ne bouge pas l'autre
(le test de `place.test.ts` écrit les deux sur la même entrée et vérifie qu'ils cohabitent). Deux
corrections parce que deux erreurs distinctes : le GPS du robot a son biais, la carte a le sien.

Écriture : `placeDeviceInJson` (`packages/shared/src/house/place.ts`) accepte `mapOffset` dans
`DevicePlacement`, à la manière de `gpsOffset` — **`[0, 0]` efface** la clé (retour au calage brut), y
compris à la création d'une entrée (rien n'est écrit si le décalage est nul). Le réglage se fait dans le
panneau « Modifier » de la vue Robots (`4_ui/4_1_navigation-et-panneaux.md`, même date) ; comment la vue
pose la carte : même page.

Sources : `packages/shared/src/house/{schema,place}.ts`, `place.test.ts` (« écrit le décalage de la carte d'une tondeuse »), `apps/web/src/stores/house.ts` (`setDeviceTuning`).
