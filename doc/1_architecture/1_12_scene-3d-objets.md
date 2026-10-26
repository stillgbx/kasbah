# Scène 3D : objets dessinés

> Dernière mise à jour : 2026-10-26
> Sources : sections reprises telles quelles de `1_5_scene-3d.md` le 2026-10-13 ; chaque section cite les siennes.

Cette page couvre ce que la scène dessine : marqueurs et formes d'appareils (onde sonore, écrans et pochettes, ventilateur, enceintes), modules photovoltaïques et coffrets de batterie, véhicules et carrosseries, tondeuse et son journal, places de stationnement, menuiseries et Velux, détail architectural, terrain en relief et son contour, calque du jardin. Elle est née du découpage de
[1_5 Scène 3D](1_5_scene-3d.md), trop longue pour être lue d'un trait : ses
sections y ont été déplacées sans retouche, dans leur ordre d'origine, avec leurs dates. Un renvoi
« plus haut » ou « plus bas » peut donc désigner une section restée dans une autre des trois pages de la scène 3D.

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

*Mise à jour 2026-10-26* : aucun code de la scène n'a changé, mais ce que le repère vert dit a changé.
`SensorState.maxValue` n'est plus le `maxReportWatts` de la passerelle (qui oublie ses pics en quelques
jours) mais le vrai record de l'historique du plugin, en moyenne sur 15 min
([3_7](../3_plugins/3_7_enphase.md)). Une puissance instantanée peut donc le dépasser : la jauge monte
alors au-dessus du repère vert, qui n'est pas un plafond.

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

### Mise à jour 2026-10-12 — la carte du terrain d'une tondeuse, peinte sur le terrain

`HouseScene.setGroundOverlay(shapes)` peint des formes sur le terrain, dans le repère de la maison :
aplats et traits qui **épousent le relief**. Le constructeur est `builders/groundOverlay.ts` :

- un aplat se maille par `drapeGeometry` (maille de 1 m, plus lâche que le terrain) puis se pose par
  `applyTerrainHeights` à +3 cm — sous un plancher, il passe sous le plancher comme l'herbe ;
- un trait est un ruban échantillonné tous les 50 cm, chaque sommet à `terrainHeight` + 5 cm ;
- `MeshBasicMaterial` transparent, sans écriture de profondeur, `polygonOffset` ; aucun maillage ne
  prend un tap (`raycast` vide) : le terrain dessous reste à lui.

Les formes reçues sont gardées (`groundShapes`) et repeintes quand la racine est reconstruite (maison
rechargée) ou que le terrain change (`afterTerrainChange`, relief édité). Le groupe vit dans
`nodes.site`.

Qui l'alimente : `composables/useSceneGroundOverlay.ts` (monté par `HomeView`) — les tondeuses dont on a
demandé la carte (`stores/sceneZones`), la carte servie par `GET /api/devices/:id/map`, posée par sa
station sur la **base** du robot, puis ramenée dans le repère maison (`sceneGroundShapes`,
`lib/siteMap.ts`). Il ne repeint que si les formes ont changé.

**Le `mapOffset` n'est PAS appliqué dans la scène** : il recale la carte sur la photo satellite,
c'est-à-dire qu'il compense l'erreur de calage de la maison sur le monde (`origin`, `heading`). Dans la
scène tout est dans le repère de la maison et la base y est juste ; l'appliquer décalait la carte
d'autant (constaté sur la vraie maison). Reste, sur la vraie maison, une **rotation** de la carte par
rapport aux murs (le contour de la tondeuse traverse la maison) : un ajustement du contour sur le plan
du rez-de-chaussée la situe à plusieurs degrés, pour moins d'un mètre de translation résiduelle — le cap de la
maison (`origin.heading`) est le suspect, pas la carte (sur la photo, la carte n'a eu besoin que d'une
translation). À trancher par le calage de la maison sur la photo, voir `_generated-ai-doc/`.

Non vérifié à l'écran dans la préversion (capture figée sur la 3D quand le panneau est masqué) :
contrôlé par l'état de la scène (formes et maillages reçus, hauteurs qui suivent le relief) et par la
capture de l'utilisateur.

Sources : `apps/web/src/three/builders/groundOverlay.ts` (+ test), `apps/web/src/three/HouseScene.ts`,
`apps/web/src/composables/{useSceneGroundOverlay,useHouseScene}.ts`, `apps/web/src/stores/sceneZones.ts`,
`apps/web/src/lib/siteMap.ts`.

### Mise à jour 2026-10-21 (bis) — les marqueurs de chauffage pulsent

Les marqueurs `climate` de `GenericMarker` (disque du thermostat, bloc de la pompe à chaleur) respirent
désormais comme les coffrets de batterie et la borne de recharge, en `theme.warning`, quand
`available && (action === 'heating' || unitHeating)` (`pulseCue`). Pour une zone de pompe à chaleur,
`unitHeating` suffit : le bloc dessiné est la machine, pas la zone. Au repos, pas de pulsation. Vérifié
par test (`three.test.ts`) seulement : le panneau de preview masqué fige la boucle 3D, l'effet n'a pas
été vu à l'écran.

Sources : `apps/web/src/three/markers/markers.ts` (+ `three.test.ts`).
