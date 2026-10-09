# Langage visuel

> Dernière mise à jour : 2026-10-06
> Sources : maquette Claude Design (non versionnée), `apps/web/src/styles/{tokens,app}.css`, `apps/web/src/themes/*.ts`, `apps/web/src/components/devices/RoomLightsToggle.vue`, `apps/web/src/plugins/vuetify.ts`, `apps/web/src/plugins/icons.ts`, `apps/web/src/lib/strokeIcons.ts`, `apps/web/src/lib/deviceIcons.ts`, `apps/web/src/components/ui/PulseDot.vue`, `apps/web/src/three/markers/DeviceMarker.ts`, `apps/web/src/components/music/{MusicPlayerBar,ListeningSessions}.vue`, `apps/web/src/components/ui/{ArtThumb,MarqueeText}.vue`, `apps/web/src/lib/navItems.ts`

## Maquette de référence

La maquette d'origine est une page interactive produite avec **Claude Design**, fournie par
l'utilisateur le 2026-09-04 ; elle n'est pas versionnée. C'est la **référence** pour tout travail
d'interface : les jetons, la grille (rail / scène / panneau) et les vues ci-dessous en sont la
transcription. Astuce : ce type d'export est un bundle auto-dépaquetant, à ouvrir via un serveur
statique (pas `file://`).

## Jetons (`styles/tokens.css`)

| Jeton | Clair | Sombre |
|---|---|---|
| `--bg` | `#e9edf1` | `#0d1420` |
| `--surface` / `--surface2` | `#ffffff` / `#f2f5f8` | `#161e2d` / `#1d2839` |
| `--text` / `--muted` | `#141a22` / `#66717f` | `#e8edf3` / `#8d9ab0` |
| `--line` | `rgba(20,26,34,.09)` | `rgba(255,255,255,.08)` |
| `--accent` (défaut lagon) | `#1f6f78` | `#4fb3bd` |
| `--radius` | 16 px (cartes), 999 px (pilules), 12 px (avatar, langue) | |

*(Dépassé le 2026-09-29 : la valeur appliquée de `--muted` en clair est `#5f6a78`, celle du thème Kasbah (`apps/web/src/themes/kasbah.ts`), depuis le passage AA du texte secondaire — voir `4_2_theme-et-langues.md`, « Mise à jour 2026-09-29 — Contraste AA du texte secondaire ». `#66717f` ne reste que dans `styles/tokens.css`, valeur de repli.)*

Quatre accents (`ACCENTS` dans `plugins/vuetify.ts`) : lagon, terre cuite, indigo, mousse, chacun en
version claire et sombre. Le store `settings` pose `data-theme` et `--accent / --accent-soft /
--on-accent` sur `<html>`.

> Depuis le 2026-09-12 (commit `abf88f5`), ces valeurs sont celles du **thème « Kasbah »** et non
> plus les seules : les quatre accents ont laissé place à six thèmes qui portent toute la palette,
> et le store pose **tous** les jetons couleur sur `<html>`. Voir la mise à jour en bas de page.

Police : **DM Sans** (variable), embarquée via `@fontsource-variable/dm-sans` (aucun CDN : usage LAN).

*(Dépassé le 2026-09-18 : la police est **Plus Jakarta Sans**, importée par `@fontsource-variable/plus-jakarta-sans` (`apps/web/src/styles/app.css`, `--font` dans `tokens.css`) — voir « Mise à jour 2026-09-18 — la police a changé, parce que `tabular-nums` ne faisait rien ».)*

## Primitives CSS (`styles/app.css`)

`.card` / `.card--soft`, `.pill` (`data-on="1"` = accent), `.icon-square` (carré 36 px, accent-soft
quand actif), `.section-label` (12 px, majuscules espacées), `.stat-value`, `.big-value`,
`.marker-pill` (marqueur 3D). Vuetify est recolorié sur les jetons (boutons en pilule, curseurs et
interrupteurs sur l'accent).

## Icônes

Jeu « trait » (24×24, stroke 1,8, arrondi) dans `lib/strokeIcons.ts`, rendu par
`components/ui/StrokeIcon.vue` (Vue) et `iconSvg()` (DOM des marqueurs). `kindIcon(kind, descriptor)`
choisit l'icône (thermomètre pour un capteur de température, filtration pour pression/débit…).
Les icônes `@mdi/js` restent utilisées dans les contrôles Vuetify.

## Palette de la scène 3D

Déclarée dans les thèmes Vuetify (`sceneWall`, `sceneWallInterior`, `sceneFloor*`, `sceneGlass`,
`sceneRoof`, `sceneTerrain`, `sceneLawn`, `sceneWater`, `sceneDriveway`, `scenePath`, `sceneBed`,
`sceneTerrace`) en clair et en sombre, lue par `three/core/theme.ts`. Le fond du canvas est
transparent : la scène repose sur `--bg`.

*(Dépassé le 2026-09-15 (bis) : ces couleurs de matière ont quitté les thèmes Vuetify et appartiennent au style de rendu (`apps/web/src/three/styles/`) ; seul `sceneMedia` reste dans `apps/web/src/plugins/vuetify.ts` — voir « Mise à jour 2026-09-15 (bis) — les couleurs de MATIÈRE quittent les thèmes ».)*

### Mise à jour 2026-09-08 — un seul jeu d'icônes, couleurs Vuetify par props

Deux vocabulaires d'icônes coexistaient : le jeu « trait » dans la coquille (rail, panneaux, vues) et
`@mdi/js` (glyphes pleins) dans les contrôles d'appareil. La phrase « les icônes `@mdi/js` restent
utilisées dans les contrôles Vuetify » ci-dessus **n'est plus vraie depuis le 2026-09-08**.

**Icônes.** Le jeu « trait » est désormais branché comme *jeu d'icônes Vuetify*
(`plugins/icons.ts` : `IconSet` dont le composant rend `StrokeIcon` en 100 % × 100 %, enregistré en
`defaultSet: 'stroke'`). Conséquences :

- `<v-icon icon="light" />` et `<StrokeIcon name="light" />` rendent le même chemin ; les contrôles
  écrivent `prepend-icon="collapseUp"`, `icon="minus"`… (des **noms**, plus des chemins SVG).
- Les alias internes de Vuetify (`$dropdown` de `v-select`, `$clear`, `$eyeDropper` du sélecteur de
  couleur…) sont mappés sur des glyphes trait dans `plugins/icons.ts` ; `IconOptions.aliases` est
  `Partial`, seuls les alias atteignables par les composants utilisés ici sont définis.
- ~40 glyphes ajoutés à `lib/strokeIcons.ts` (variantes d'état `lightOn`/`shutterOpen`/`speakerOn`,
  contrôles `minus`/`stop`/`skipPrev`/`volume`/`lock`…, alias `check`/`alert`/`chevronDown`…).
- `lib/deviceIcons.ts` renvoie maintenant des `IconName` du jeu trait (et non plus des chemins mdi).
- `@mdi/js` est retiré de `apps/web/package.json`.

**Couleurs Vuetify.** Les surcharges CSS qui visaient les classes internes (`.v-slider-track__fill`,
`.v-switch__track`…) sont remplacées par des props par défaut dans `plugins/vuetify.ts` :
`VSlider: { trackFillColor: 'primary', thumbColor: 'primary', trackColor: 'var(--line)' }` et
`VSwitch: { color: 'primary', baseColor: 'var(--line)' }` — Vuetify accepte un `var(--…)` comme
couleur. Ne restent en CSS que les valeurs sans prop équivalente (opacité de la piste de
l'interrupteur, couleur du curseur éteint), et **sans `!important`** (cf.
[6_0_pieges-outillage](../6_faq/6_0_pieges-outillage.md), section sur `@layer`).

Les `color="warning" / "success" / "secondary"` posés sur des `v-slider` étaient déjà sans effet
(l'ancienne règle CSS les écrasait) : ils ont été retirés, tous les curseurs sont sur l'accent.

### Mise à jour 2026-09-05 — icône `gear`

Le glyphe `gear` de `lib/strokeIcons.ts` était un cercle entouré de huit rayons, donc visuellement
un **soleil** (identique à `sun`, l'icône d'apparence du rail). Redessiné en vraie roue dentée :
couronne à 8 dents (rayons 7,4 → 10,2) et perçage central de rayon 3,2, en un seul chemin.

### Mise à jour 2026-09-08 — rien ne doit bouger : empreinte fixe et espace réservé

Règle posée par l'utilisateur après trois occurrences du même défaut, et qui vaut pour toute l'app :

> Un élément qui **remplace** un autre doit occuper le même espace, et un élément qui **apparaît** ne
> doit pas décaler ses voisins.

Les trois cas rencontrés, tous dans les contrôles d'ouvrant :

1. Le point pulsant posé **avant un curseur** en changeait la largeur : il vit maintenant dans la
   ligne de statut, où le texte reflue de lui-même quand le mouvement commence.
2. Une ligne « mouvement en cours » qui apparaissait poussait tout ce qui suit : fusionnée en **une
   seule ligne de hauteur constante** `[point | texte | %]`.
3. Un `v-progress-circular` de 20 px remplaçait un `v-switch` de **52 × 56** — l'interrupteur fixant
   la hauteur de l'en-tête, celle-ci se retractait. Les deux partagent désormais une empreinte fixe.

Deux moyens pour ça :

- **`components/ui/PulseDot.vue`** : le point « quelque chose est en cours ». Éteint, il reste un
  carré transparent de la même taille — l'espace est toujours réservé. Il porte l'unique
  `@keyframes pulse` de l'app et le respect de `prefers-reduced-motion`. Le parent gère l'espacement
  (une ligne `flex` a son `gap`, un texte a besoin d'une marge). Trois utilisations : la ligne de
  `CoverControl`, le slot `status-badge` de `RoomBands`, les lignes de `RoomPanel`.
- **`font-variant-numeric: tabular-nums`** sur un pourcentage qui change en continu : sans lui, la
  largeur des chiffres varie et la valeur frémit. *(Cette propriété est restée SANS EFFET jusqu'au
  2026-09-18, DM Sans n'ayant pas de chiffres tabulaires — voir la mise à jour en fin de page.)*

Méthode de vérification, parce que l'œil ne suffit pas : mesurer `getBoundingClientRect()` avant,
pendant et après le changement d'état, et comparer. Les trois défauts ci-dessus ont été trouvés
comme ça, alors que le rendu paraissait correct sur une capture.


### Mise à jour 2026-09-09 — icônes `tv` et `tablet`, marqueurs 3D par nature de lecteur

Deux glyphes ajoutés à `lib/strokeIcons.ts` : `tv` (écran sur pied) et `tablet` (dalle posée, un
trait pour le pied). `lib/deviceIcons.ts` choisit l'icône d'un `media_player` d'après
`meta.mediaPlayer.deviceClass` : `speaker` / `speakerOn` pour une enceinte (la variante « On » reste
propre à l'enceinte, un téléviseur en lecture garde son icône et c'est la couleur qui dit l'état),
`tv` pour un téléviseur, `tablet` pour un écran connecté (choix de l'utilisateur). Côté 3D
(`three/markers/markers.ts`, `GenericMarker`), la classe donne la forme : cylindre pour l'enceinte,
écran plat 1 m × 0,56 m pour un téléviseur, petite dalle 25 × 16 cm pour un écran connecté.

### Mise à jour 2026-09-09 — quatrième cas de « rien ne doit bouger » : le panneau lecteur, et `MarqueeText`

Rappel de l'utilisateur, captures à l'appui : entre lecture et pause du panneau d'un lecteur, tout
bougeait — le bloc « en cours » (titre, artiste, barre, temps) disparaissait au profit d'une ligne
« Rien en lecture · En pause », et les touches remontaient de trois lignes. Deux causes, deux remèdes :

1. **Le bloc a maintenant toujours ses quatre lignes** (`controls/MediaPlayerControl.vue`) : sans
   morceau, le titre dit « Rien en lecture » et le sous-titre l'état ; sans durée (radio en direct),
   la barre et les temps passent en `visibility: hidden` mais gardent leur place. Mesuré au
   `getBoundingClientRect()` sur deux appareils, l'un en lecture, l'autre au repos : bloc, touches,
   sourdine et curseur aux mêmes positions au pixel. `tabular-nums` sur les temps et le volume.
2. La disparition du morceau à la pause venait du **plugin**, pas de l'UI (voir
   `../6_faq/6_1_pieges-runtime.md`) : corrigée aussi.

**`components/ui/MarqueeText.vue`** — demande de l'utilisateur : un texte trop long ne doit pas être
coupé mais **défiler doucement, avec un fondu aux deux bords**. Le composant mesure le débordement
(`ResizeObserver`), et seulement s'il y en a : masque en dégradé aux extrémités, va-et-vient à
vitesse constante (~24 px/s, 6 à 30 s) avec une pause de lecture à chaque bout ; sinon rien ne
bouge et rien n'est délavé. `prefers-reduced-motion` → points de suspension. Une ligne de hauteur
constante dans tous les cas. Deux pièges rencontrés : le fondu ne doit exister que quand ça défile
(un texte court se retrouvait pâli aux bords), et il faut **`contain: inline-size`** — sans lui, la
largeur du texte (inline-block sans retour à la ligne) comptait dans la largeur minimale du panneau,
qui s'élargissait et poussait le bouton « Déplacer » hors de l'écran. Utilisé pour le titre et le
sous-titre du lecteur, et pour la grande valeur du panneau appareil.

**En-tête du panneau** : l'icône et le libellé d'un lecteur suivent sa nature (`kindIcon` dans
`lib/strokeIcons.ts`, clés `media.classes.*`) : « Écran connecté · Google » avec la tablette pour un
Nest Hub, « Téléviseur » pour un Chromecast, « Enceinte » sinon.

Deux compléments demandés dans la même session :

- **Repère d'attente** : au changement de morceau, l'appareil envoie l'identifiant du contenu avant
  ses métadonnées. Le plugin laisse alors le titre **vide** (ni identifiant, ni nom de l'appli, qui
  est déjà dans `source`) et le panneau affiche « … » avec une respiration lente de l'opacité
  (`.now__waiting`, arrêtée sous `prefers-reduced-motion`), la source restant seule en sous-titre.
  Ailleurs, un titre vide vaut « pas de titre » (`lib/deviceState.ts`, `lib/format.ts`) : la ligne
  d'état dit « Lecture », pas « Lecture · ».
- **Position interpolée** : l'appareil ne pousse pas sa position et le plugin la relit toutes les dix
  secondes ; la barre ne bougeait donc que par sauts. Le contrôle fait avancer la position **à la
  seconde côté client** tant que ça joue, à partir du dernier relevé (repère local posé quand la
  position ou le morceau change — pas `updatedAt`, qu'un changement de volume ferait bouger), bornée à
  la durée ; le relevé suivant recale sans à-coup visible. Vérifié : 2:55 → 2:58 → 3:00 sur trois
  lectures à deux secondes d'écart.
- **Pochette en fond** : le panneau d'un lecteur pose la pochette du morceau (ou le visuel de la
  radio — `nowPlaying.artUrl`, fourni par les métadonnées Cast) derrière son haut (`DevicePanel.vue`,
  `.art`) : couche absolue de 380 px, opacité 0,26, masque en dégradé transparent → opaque → transparent
  pour fondre le haut et le bas, fondu croisé de 0,9 s entre deux pochettes (`<Transition>` sur la clé
  URL, les deux couches coexistent). Pour qu'une couche en `z-index: -1` reste devant le fond de
  l'aside, `.side-panel__scroll` est devenu `position: relative; isolation: isolate`. Rien ne se
  décale : positions mesurées identiques avec et sans pochette.
  Complément : l'image est **préchargée** (`new Image()`), la couche n'est posée qu'une fois l'image
  décodée — l'utilisateur voyait parfois l'URL dans le DOM sans image (chargement en cours, ou serveur
  d'images qui refuse) ; une URL en échec ne laisse rien, une réponse tardive d'une URL déjà remplacée
  est ignorée.

### Mise à jour 2026-09-09 (bis) — panneau lecteur : ne rien répéter, curseur de position, volume sur deux lignes

Trois retours de l'utilisateur sur le panneau d'un lecteur (`controls/MediaPlayerControl.vue`) :

- **Répétitions** : le titre d'un morceau s'affichait trois fois (grande valeur, titre du bloc, album identique au
  titre). Le titre n'est plus que dans la grande valeur ; le bloc dit, sans doublon, l'**artiste**,
  l'**album** s'il diffère du titre, puis la **source** — deux lignes toujours présentes (espace
  insécable quand il n'y a rien à dire). Radio : « Radio France » seul. En attente de métadonnées :
  « … » puis la source.
- **Curseur de position** : la barre de progression est devenue un `v-slider` fin (piste 3 px, poignée
  12 px) — glisser affiche le temps visé, relâcher envoie `media_player.seek`
  (`../1_architecture/1_1_contrat-appareils.md`). Invisible mais réservé sans durée (direct) ; inactif
  sans capacité `seek`.
- **Volume** : les touches − / + demandées écrasaient le curseur ; un pas-à-pas « − valeur + » sur une
  seconde ligne laissait un nombre orphelin (« on se demande ce que c'est »). Retenu : UNE ligne qui se
  lit seule — sourdine, −, curseur, + (pas de 5, touches petites pour laisser la largeur au curseur),
  la valeur écrite au bout de la ligne, sans unité comme les temps du morceau (largeur fixe, chiffres à
  largeur constante).
  Essayé et écarté : une bulle sur la poignée, qui passait par-dessus les touches de transport.

Positions mesurées identiques entre un lecteur en lecture et un lecteur au repos, comme avant.

### Mise à jour 2026-09-10 — la pilule d'un marqueur est bornée

Un appareil dont aucun plugin ne dit rien s'affiche sous son id (`auto.google_cast-abcd1234…`) : sa pilule
mesurait **383 px** et barrait la maison. `.marker-pill` reçoit donc `max-width: 210px`, son libellé
`overflow: hidden; text-overflow: ellipsis`, et la pilule porte le nom entier en **infobulle** (`title`,
posé à la construction dans `three/markers/DeviceMarker.ts`).

Le 210 px est mesuré, pas choisi au hasard : le plus long nom d'appareil relevé sur une maison réelle
(195 px) tient encore en entier ; l'échelle de la pilule sélectionnée (×1,06) est comprise. Le nom complet
reste lisible dans le panneau, qui le fait défiler (`4_1_navigation-et-panneaux.md`).

### Mise à jour 2026-09-10 — icône `cast` pour la catégorie Médias, et une couleur propre à l'onde

**L'icône du rail.** L'entrée « Médias » portait `speaker`. Les autres entrées (lumière, volet,
caméra) ont la chance de ne contenir qu'un type d'appareil, donc nommer l'objet suffit ; la catégorie
Médias, elle, regroupe désormais des enceintes, des téléviseurs et des écrans connectés
(`meta.mediaPlayer.deviceClass`, cf. la mise à jour du 2026-09-09 ci-dessus), et une icône d'objet
en désignait un seul. Une icône de **catégorie** doit donc monter d'un cran : elle ne nomme plus
l'objet mais ce que ces objets font.

Glyphe `cast` ajouté à `lib/strokeIcons.ts` (un écran, les ondes du flux dans le coin, le point) et
posé sur l'entrée `media` du rail (`components/layout/NavRail.vue`). Il dit l'écran **et** la
diffusion, il couvre l'enceinte par association, et c'est le langage visuel de la source de données
du parc (Google Cast) : rien à apprendre. Les icônes **par appareil** ne bougent pas — `speaker` /
`speakerOn`, `tv`, `tablet` restent choisies par `lib/deviceIcons.ts`.

Deux candidats écartés, présentés côte à côte à l'utilisateur :
- un **play encadré** — neutre, mais il double le glyphe `play` du transport : deux sens pour un même
  dessin dans la même app ;
- des **ondes concentriques** — plus abstrait, et joli écho au marqueur 3D d'un lecteur en diffusion,
  mais moins immédiat en navigation.

**La palette gagne `sceneMedia`.** La liste de la section « Palette de la scène 3D » ci-dessus
s'enrichit d'un jeton : `sceneMedia` (`#1a73d8` en clair, `#5aaeff` en sombre, dans `SCENE_LIGHT` /
`SCENE_DARK` de `plugins/vuetify.ts`), lu comme les autres par `three/core/theme.ts` sous
`SceneTheme.media`. Il sert à l'onde du lecteur en diffusion, qui prenait jusqu'ici la couleur
d'**accent** : avec l'accent teal elle se noyait dans la teinte de surbrillance de la pièce (le sol
sélectionné tire de 45 % vers `primary`), avec l'indigo dans les murs. Une couleur de scène dédiée la
rend indépendante des quatre accents (`../1_architecture/1_5_scene-3d.md` pour la mécanique de l'onde).

*(Dépassé le 2026-09-15 (bis) : `SCENE_LIGHT` et `SCENE_DARK` n'existent plus dans `plugins/vuetify.ts` ; `sceneMedia` y est désormais `p.catMedia`, la couleur de la catégorie Médias de la palette du thème, et reste lu par `three/core/theme.ts`.)*

### Mise à jour 2026-09-11 — la pilule d'un marqueur : catégorie, état, sélection sur trois supports

Demande de l'utilisateur : alléger la vue 3D sans perdre d'information, et **différencier les quatre
catégories d'appareils implémentées** (Lumières, Ouvrants, Caméras, Médias — d'autres viendront).
Jusqu'ici la seule différence entre catégories était le glyphe en trait de 2 px à 16 px, illisible à
la densité d'un niveau entier, et la seule couleur porteuse de sens était l'accent (« actif » ou
« sélectionné »). Principe retenu : trois informations, trois supports qui ne se marchent pas dessus.

- **Catégorie = teinte du disque d'icône** (`span.marker-pill__icon`, 24 px, `data-cat` sur la
  pilule). Le disque est aussi le seul élément qui survit à tous les niveaux de détail (voir
  `../1_architecture/1_5_scene-3d.md`) : même le point de la vue d'ensemble dit « ici une lampe, là
  un volet », là où le nom a disparu.
- **État = remplissage du disque** (`data-on`). Au repos : pilule translucide
  (`color-mix(surface 72 %)` + `backdrop-filter: blur(8px)`), sans ombre, texte `--muted`, disque
  cerné (`inset 1.5px` à 45 %) sur fond à 14 %. Actif : pilule opaque avec ombre, texte `--text`,
  disque **plein** dans sa teinte, glyphe couleur `--surface`. Indisponible : teinte neutre, opacité
  0,6. **L'accent ne dit plus « actif »**, ce qui lève le conflit avec les quatre accents au choix.
- **Sélection = la pilule entière** (`data-sel`) : fond accent, texte `--on-accent`, comme avant ; le
  disque garde sa teinte, on sait toujours ce qu'on a sélectionné.

**Palette des catégories** — jetons `--cat-*` dans `tokens.css`, indépendants des accents comme
`sceneMedia` l'était déjà (même raison : ne pas se noyer dans un accent) :

| Catégorie | `data-cat` | clair | sombre | raison |
|---|---|---|---|---|
| Lumières | `light` | `#d18f0a` | `#f0b429` | ambre, lecture universelle de la lumière |
| Ouvrants | `cover` | `#5b7086` | `#97abbf` | ardoise : matière, neutre |
| Caméras | `camera` | `#7a4fcf` | `#ab8fff` | violet, absent des accents et de la palette 3D |
| Médias | `media` | `#1a73d8` | `#5aaeff` | **= `sceneMedia`** : la pilule et l'onde disent la même chose |
| autres | `other` | `--muted` | `--muted` | énergie, véhicules, capteurs : neutres jusqu'à décision |

Le mappage `kind → catégorie` est `deviceCategory()` dans `lib/deviceIcons.ts` (`camera` couvre la
sonnette, `media_player` les trois natures de lecteur). Vérifié avec l'accent lagon dans les deux
thèmes ; violet et bleu face à l'accent indigo, ambre face à la terre cuite restent à regarder — le
risque est faible puisque la sélection s'exprime sur la pilule et non sur le disque.

**Niveaux de détail côté CSS** : `.scene-labels[data-lod='icon']` masque `.marker-pill__label` et
ramène le padding droit à 3 px (la pilule devient un cercle de 30 px autour du disque) ;
`[data-lod='dot']` rend en plus la pilule transparente et réduit le disque à `scale(.42)` (≈ 10 px),
plein à 55 % au repos, plein à 100 % si actif. La pilule reste un bouton de 30 px : la cible tactile ne
rétrécit pas avec le point. Détail des seuils et du point fixe : page scène 3D.

### Mise à jour 2026-09-11 — une icône DANS le pouce d'un interrupteur

L'interrupteur maître des lumières d'une pièce (`components/devices/RoomLightsToggle.vue`, cf.
`4_1_navigation-et-panneaux.md`) est le seul interrupteur de l'app qui n'a **pas d'appareil nommé à
côté de lui** : dans l'en-tête d'une carte de pièce ou d'un panneau, rien ne dit sur quoi il agit.
Remarque de l'utilisateur : « on pourrait peut-être ajouter un visuel dans le cercle du switch ».

Le pouce porte donc l'**ampoule** du jeu maison (`ICONS.light`, `StrokeIcon` à 12 px dans le slot
`#thumb` de `v-switch`) — le même glyphe que l'icône carrée des lignes de lampe et que la catégorie
Lumières des pilules 3D. **Pas soleil / lune** : ce couple est déjà le vocabulaire du bouton
d'apparence clair / sombre du rail, le réutiliser pour les lumières aurait créé un homonyme visuel.

Un seul glyphe pour les deux états : l'état reste dit par la position et la couleur du pouce, comme
sur tous les autres interrupteurs. L'ampoule prend la couleur du support qui la porte — `--muted` sur
le pouce éteint, `--accent` sur l'allumé (le fond du pouce est `--surface` / `--on-accent`, posés par
`app.css`). Contrastes relevés dans la preview : ≈ 5:1 dans les deux thèmes, dans les deux états.

Le libellé « Lumières » posé au premier jet à côté de l'interrupteur a été retiré : l'ampoule le dit,
et dans la vue Lumières le mot répétait le titre de la vue.

### Mise à jour 2026-09-12 — les jetons ne sont plus des constantes, mais une palette de thème

Les quatre accents ont laissé place à six thèmes nommés (`4_2_theme-et-langues.md`, commit
`abf88f5`). Conséquence pour le langage visuel : **toutes les couleurs de `tokens.css` sont
désormais posées sur `<html>` par le store des réglages** depuis la palette du thème choisi
(`themes/index.ts` → `cssVars`). Le fichier ne garde ces valeurs qu'en **repli avant l'exécution du
script**, et elles reprennent la variante claire du thème « Kasbah » — c'est-à-dire exactement le
tableau de jetons du haut de cette page. Le bloc `:root[data-theme='dark']` devenait mort (une
variable inline gagne toujours sur lui) et a été retiré.

Le tableau « Jetons » et le paragraphe « Quatre accents » plus haut restent donc **justes comme
description du thème Kasbah**, mais ce ne sont plus les seules valeurs possibles : `--bg`,
`--surface`, `--surface2`, `--text`, `--muted`, `--line`, `--shadow`, `--accent`, `--accent-soft`,
`--on-accent` et les cinq `--cat-*` changent avec le thème.

**La palette des catégories suit le thème.** Le tableau `--cat-*` de la mise à jour du 2026-09-11
donne maintenant les valeurs du thème Kasbah ; chaque thème déclare les siennes (`catLight`,
`catCover`, `catCamera`, `catMedia` — `catOther` reste `--muted`). Le raisonnement d'origine tient
toujours, mais se formule autrement : les quatre teintes doivent se distinguer **entre elles et de
l'accent du thème**, puisque la sélection s'exprime sur la pilule entière et l'état par le
remplissage du disque. Règle appliquée à chaque palette : ambre pour les lumières, un teal ou une
ardoise pour les ouvrants, un violet / magenta pour les caméras, un bleu ou cyan pour les médias, en
évitant la teinte déjà prise par l'accent (Dracula prend son vert pour les ouvrants et son cyan pour
les médias, l'accent étant le violet ; Synthwave '84 prend l'orange pour les caméras, l'accent étant
le rose).

`sceneMedia` reste **égal à `--cat-media`** — l'onde du lecteur et la pilule Médias disent la même
chose, c'est écrit une seule fois dans `definition()` de `plugins/vuetify.ts`. C'est la seule
couleur de scène 3D qui suit le thème ; murs, sols, terrain gardent leurs deux palettes
`SCENE_LIGHT` / `SCENE_DARK` communes à tous les thèmes (`../1_architecture/1_5_scene-3d.md`).

### Mise à jour 2026-09-15 — la palette sombre de la scène devient une NUIT

Complète « Palette de la scène 3D » ci-dessus. `SCENE_DARK` (`plugins/vuetify.ts`) descend d'un
cran — terrain et pelouse `#1f3326`, sols `#262d3a` à `#332d31`, allée `#2a2f3a`, toit `#232936` —
et les murs **montent** (`sceneWall` `#6c7686`, `sceneWallInterior` `#5a6474`) : la face supérieure
d'un mur coupé doit ressortir sous un clair de lune faible, et les lampes allumées doivent porter
sur un sol sombre. `SCENE_LIGHT` ne change pas. La règle du 2026-09-12 tient : ces couleurs restent
communes à tous les thèmes nommés. Nouveau jeton de mise en page : `--panel-gap` (16 px), marge du
panneau flottant de la vue Maison. Détails d'éclairage et de halo : `../1_architecture/1_5_scene-3d.md`.

### Mise à jour 2026-09-15 (bis) — les couleurs de MATIÈRE quittent les thèmes

**Remplace** la décision du 2026-09-12 (« `SCENE_LIGHT` / `SCENE_DARK` restent deux palettes communes
à tous les thèmes ») : ces deux palettes sont **retirées de `plugins/vuetify.ts`**. Murs, sols, verre,
toit, terrain, eau et zones sont désormais donnés par le **style de rendu** choisi
(`three/styles/`, voir `../1_architecture/1_5_scene-3d.md`), qui en offre quatre jeux et n'a plus rien
à voir avec l'apparence claire/sombre de l'interface.

Ce qui ne change pas, et c'est l'essentiel de l'arbitrage du 2026-09-12 : **ce qui est POSÉ sur la
maison suit toujours le thème** — disques de catégorie des pilules (`--cat-*`), sélection
(`--accent`), teinte du sol de la pièce sélectionnée, et l'onde d'un lecteur en diffusion
(`sceneMedia`, seule couleur de scène restée dans les variables CSS, égale au `catMedia` du thème).

Corollaire à retenir : la scène ne lit plus `--v-theme-background` pour son sol infini. Avec une
courbe de tone mapping en bout de chaîne, une couleur recopiée du CSS ne retombe plus sur la même
valeur à l'écran ; le fond du canvas et le disque de sol prennent donc les couleurs du CIEL du style,
et passent par la même courbe — c'est ce qui les raccorde sans couture.

Sources : `apps/web/src/plugins/vuetify.ts`, `apps/web/src/three/core/theme.ts`,
`apps/web/src/three/builders/materials.ts`.

### Mise à jour 2026-09-16 — la famille météo du jeu d'icônes

Neuf icônes trait de plus dans `lib/strokeIcons.ts`, construites sur **un même nuage** pour que la
famille se reconnaisse : `cloud`, `cloudSun`, `cloudMoon`, `drizzle`, `rain`, `snow`, `fog`,
`thunder`, `wind`. Le kind `weather` porte `cloud` par défaut (`KIND_ICON`, `KIND_ICONS`) ;
`lib/weather.ts` (`conditionIcon`) choisit l'icône d'une condition, et bascule sur `moon` /
`cloudMoon` la nuit pour les seules conditions où le ciel se voit — un nuage de pluie est le même à
minuit. `sun` et `moon` existaient (apparence du rail) et sont réutilisés. Le rail gagne une
neuvième entrée, « Météo », en `cloudSun`.

Sources : `apps/web/src/lib/{strokeIcons,weather,deviceIcons}.ts`, `apps/web/src/components/layout/NavRail.vue`.

### Mise à jour 2026-09-16 (bis) — `sunHorizon`, l'icône de l'apparence « Auto »

Une icône trait de plus dans `lib/strokeIcons.ts` : un **soleil posé sur l'horizon** (demi-arc sur une
ligne de sol, trois rayons courts). Elle sert au quatrième mode d'apparence du rail
(`4_2_theme-et-langues.md`), et devait se distinguer de deux voisines immédiates du même bouton :
`sun` (l'apparence CLAIRE) et `auto` (le disque mi-clair mi-sombre, « comme l'appareil »). D'où
l'horizon : ce qui est dessiné n'est pas le soleil, c'est **son lever et son coucher**.

Le rail n'a pas d'homonyme visuel pour autant — `cloudSun`, qui aurait aussi pu dire « soleil », y
tient déjà la vue Météo.

Sources : `apps/web/src/lib/strokeIcons.ts`, `apps/web/src/components/layout/NavRail.vue`.

### Mise à jour 2026-09-17 — trois icônes trait pour la recherche

`lib/strokeIcons.ts` gagne `search` (la loupe), `room` (une pièce vue en plan : quatre murs et une
ouverture) et `layers` (un niveau : des plans empilés). Les deux dernières servent aux **lignes de
résultat** de la barre de recherche, où une pièce, une zone et un niveau doivent se distinguer d'un
coup d'œil alors que rien d'autre ne les sépare : le sous-titre dit le lieu, pas la nature. Une
zone du jardin reprend `room` faute d'un dessin qui vaille mieux qu'une redite.

Sources : `apps/web/src/lib/strokeIcons.ts`, `apps/web/src/components/home/SearchBar.vue`.

### Mise à jour 2026-09-18 — la police a changé, parce que `tabular-nums` ne faisait rien

Toute la règle « rien ne doit bouger » s'appuie, pour les valeurs numériques, sur
`font-variant-numeric: tabular-nums` — cinquante-trois déclarations dans vingt-sept fichiers. **Aucune
ne faisait quoi que ce soit** : DM Sans n'a pas de chiffres tabulaires, et la propriété était donc
inerte depuis toujours. Le CSS avait l'air de s'en occuper, personne n'avait de raison d'y regarder.

Mesuré dans le navigateur, sur l'app, à `600 13px` :

| | « 0 » | « 1 » | `00.00` vs `11.11` | `tabular-nums` agit ? |
|---|---|---|---|---|
| DM Sans Variable | 9,08 px | 4,53 px | **17,55 px d'écart** | non |
| Segoe UI / `system-ui` | — | — | 7,96 px → **0** | oui |
| **Plus Jakarta Sans** (adoptée) | 7,81 | 7,81 | 17,23 px → **0** | oui |

Le « 1 » de DM Sans fait exactement la moitié du « 0 » ; les huit autres chiffres ne s'écartent que de
2,1 px entre eux. C'est donc lui qui fait presque tout le mal, et il le fait à chaque valeur affichée.

La ligne `system-ui` du tableau n'est pas décorative : c'est le **contrôle**. Sans elle, « la propriété
ne change rien » pouvait aussi bien vouloir dire « ma mesure est fausse ». Elle montre que la méthode
est bonne et que le défaut est dans la police. À reproduire avant de conclure qu'une propriété CSS est
sans effet.

**Ce qui a été retenu : changer la police.** `--font` passe à Plus Jakarta Sans
(`@fontsource-variable/plus-jakarta-sans`). Les cinquante-trois déclarations se mettent alors à faire
ce qu'elles disent, sans toucher un seul composant. Le choix s'est joué sur les **métriques de texte** :
Jakarta est à 0,2 % de DM Sans sur un mot de contrôle, donc aucune mise en page existante ne bouge —
là où Inter (+2,5 %) et Figtree (−5,9 %) auraient demandé de tout revérifier.

**Ce qu'une police tabulaire ne répare pas** : elle fixe la largeur d'un chiffre, pas le nombre de
chiffres. `9` → `10` élargit toujours, et demande une place réservée. La distinction vaut d'être tenue
en tête, parce que les deux se ressemblent à l'œil.

**Un corollaire utile** : une boîte dimensionnée en `ch` réservait déjà le pire cas, même du temps de
DM Sans — `1ch` vaut la largeur du « 0 », qui se trouve être son chiffre le plus large. Les champs de
`PlacementControl` (largeur en `ch`) ne déplaçaient donc jamais leurs touches ; seuls les glyphes
frémissaient dans leur boîte. Les endroits vraiment exposés étaient les **vingt-neuf** où la valeur
coule dans du texte sans largeur réservée — dont le sous-titre du panneau d'ouverture, qui passait à
deux lignes et faisait sauter sa carte de 17,5 px en fenêtre basse.

Sources : `apps/web/src/styles/tokens.css` (le jeton `--font` porte le pourquoi),
`apps/web/src/styles/app.css`.


### Mise à jour 2026-09-21 — quatre icônes trait de plus

`paw` (la vue Animaux au rail), `feeder` (trémie au-dessus d'une gamelle), `fountain` (gamelle et
jet) et `clock` (l'heure du prochain repas) rejoignent le dictionnaire `ICONS` de
`apps/web/src/lib/strokeIcons.ts`. Deux gamelles se ressembleraient trop à 16 px : c'est ce qui les
SURMONTE qui les distingue. Table `KIND_ICON` / `KIND_ICONS` complétée pour `pet_feeder` et
`pet_fountain`.

### Mise à jour 2026-09-21 (bis) — « l'icône d'apparence du rail » n'est plus au rail

Quatre passages de cette page situent le couple `sun` / `moon` (et `auto`, `sunHorizon`) sur un
bouton **du rail** : la mise à jour du 2026-09-05 (`gear` redessiné pour ne plus ressembler à un
soleil), celle du 2026-09-08 (l'ampoule du pouce de `RoomLightsToggle`, choisie pour ne pas faire
homonyme), celle du 2026-09-16 (les neuf icônes de météo) et celle du 2026-09-16 (bis)
(`sunHorizon`). Depuis le 2026-09-21, ce bouton est une pilule de l'**en-tête de la vue Maison**,
après les onglets de niveau (`views/HomeView.vue`, cf. `4_1_navigation-et-panneaux.md`) ; le rail
porte les Réglages à sa place, en bas.

Les quatre raisonnements tiennent tels quels — ils portaient sur le **vocabulaire d'icônes**, pas sur
un emplacement : `gear` ne doit pas ressembler à `sun`, l'interrupteur maître des lumières ne doit
pas emprunter soleil / lune, et `cloudSun` (vue Météo, au rail) ne fait toujours pas homonyme avec
`sunHorizon`. Seul le mot « rail » est à lire « en-tête de la vue Maison » dans ces phrases.

Sources : `apps/web/src/views/HomeView.vue`, `apps/web/src/components/layout/NavRail.vue`.

### Mise à jour 2026-09-21 — icône `wind` pour le ventilateur

Kind `fan` : icône trait `wind` (déjà dans le jeu). Catégorie visuelle `light` (même teinte de
disque que les lampes dans la vue Lumières / filtre de pièce).

### Mise à jour 2026-09-21 (bis) — `lightFan` / `lightFanOn`

Lumière liée à un ventilateur : icônes `lightFan` / `lightFanOn` (ampoule + souffle) via
`deviceIcon` / `kindIcon` (`opts.linkedFan`) — liste, panneau détail, pilule 3D.
`Segmented` accepte un `sublabel` (ex. « 2700 K » sous « Chaud »).

### Mise à jour 2026-09-22 — silhouettes d'enceinte en icônes

Quatre glyphes dans `strokeIcons.ts` pour le Segmented « Forme » du panneau appareil :
`speakerTube`, `speakerPebble`, `speakerBar`, `speakerBlock`. Le Segmented dense resserre le
padding des segments icône seule (`:has(svg)`) pour que quatre options tiennent à côté du
libellé. Le `label` reste l'infobulle et le nom accessible (comportement déjà prévu par
`Segmented` quand `icon` est posé).

Sources : `apps/web/src/lib/strokeIcons.ts`, `apps/web/src/components/ui/Segmented.vue`,
`apps/web/src/components/home/PlacementControl.vue`.

### Mise à jour 2026-09-22 — le lecteur de la page Musique : centré sur l'ÉCRAN, et rien qui bouge

Cinquième application de la règle « rien ne doit bouger », sur la barre du bas de `/music`
(`MusicPlayerBar.vue`). Hauteur **fixe 92 px**, trois colonnes, mêmes zones que quelque chose joue ou
non.

**La colonne centrale est au milieu de l'écran, pas de la barre.** La barre commence après le rail :
un `1fr 1fr` aurait centré sur la page et la touche lecture aurait paru décalée à droite. D'où une
première colonne calculée — `calc(50% - var(--rail-w)/2 - var(--center-w)/2 - var(--bar-gap))` — et
une largeur centrale qui suit l'écran, `--center-w: clamp(320px, calc(100vw - 940px), 640px)` : 340 px
à 1280, 640 px à 1920 (un curseur de position large se règle plus finement, mais l'aile droite doit
tenir).

**Symétrie de la rangée de touches** : précédent / lecture / suivant / stop laisserait lecture à
gauche du centre. Un **emplacement fantôme** (`.key--ghost`, `visibility: hidden`) fait face au stop,
et la touche lecture retombe pile au milieu.

**Emplacements réservés** plutôt que masqués :

- sans durée **ni** position (rien en cours), le bloc curseur + temps passe en `visibility: hidden` —
  il garde sa ligne ;
- sans durée mais avec une position, seul le curseur disparaît, les deux temps restent ;
- la touche « Transférer » a une **largeur fixe de 124 px** : « Transférer », « Annuler » et
  « Transfert… » se relaient dedans (libellé coupé par ellipsis s'il le faut) sans décaler le volume
  ni le nom du lecteur ;
- dans les lignes du panneau Écoute, une touche lecture / pause sans rien de chargé devient
  invisible **et** intransigeable (`tabindex="-1"`), sa place restant prise ; en mode transfert,
  « Ici » occupe exactement la largeur des deux touches qu'il remplace (36 + 36 px).

**Les textes ne rétrécissent pas la mise en page** : titre, artiste, nom du lecteur et libellé de
session passent par `MarqueeText` (défilement + fondu), et une ligne vide porte une espace insécable
plutôt que de disparaître. Un **sablier** (`v-progress-circular`) prend la place de l'icône dans la
touche lecture le temps d'un envoi, sans changer sa taille.

**`ArtThumb` accepte une taille** (prop `size`, défaut 44 px, posée en variable CSS `--art`) : 56 px
dans la barre, plus grand dans les tuiles. Avant, la pochette était figée à 44 px et chaque usage
recopiait ses propres règles.

Vérifié en preview mock à **1280 × 800** et **1920 × 1080**, mesures `getBoundingClientRect` avant /
après changement d'état (d'après le compte rendu de session — les mesures elles-mêmes ne sont pas
versionnées).

Sources : `apps/web/src/components/music/{MusicPlayerBar,ListeningSessions}.vue`,
`apps/web/src/components/ui/ArtThumb.vue`, `4_1_navigation-et-panneaux.md`.

### Mise à jour 2026-09-22 (bis) — « rien ne doit bouger » vaut aussi pour les CHIFFRES

Les cinq applications précédentes de la règle parlent d'**empreintes** : hauteurs fixes, places
réservées, largeurs de libellé. La correction de fin d'après-midi sur le lecteur en ajoute une
lecture : **une valeur qui revient en arrière bouge, elle aussi.** Un timecode qui perd deux
secondes à la pause et un pouce de curseur qui repasse par l'ancienne position avant d'atteindre la
cible se remarquent autant qu'une ligne qui se décale — et se corrigent au même endroit du
raisonnement : décider ce qu'on affiche, plutôt que refléter la dernière donnée reçue.

Conséquence pratique retenue : quand une valeur est **avancée localement** ou **demandée en attente
de confirmation**, l'affichage garde la main tant que la source de vérité ne s'est pas rapprochée de
ce qu'on montre. Mécanique et code dans `../1_architecture/1_4_app-web.md` et
`../6_faq/6_1_pieges-runtime.md`.

Sources : `apps/web/src/composables/useMediaPosition.ts`,
`apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/components/controls/MediaPlayerControl.vue`.

### Mise à jour 2026-09-23 — icône `automation`

Nouveau tracé dans `lib/strokeIcons.ts` pour l'entrée du rail de la vue
Automatisations : un embranchement « si… alors » — un trait d'entrée, le **losange** du test (le
symbole de décision des organigrammes), une sortie **fléchée**. Choisi pour ne ressembler ni à
l'engrenage des Réglages, ni aux étincelles, ni à une flèche de répétition.

Sources : `apps/web/src/lib/strokeIcons.ts`, `apps/web/src/lib/navItems.ts`.

### Mise à jour 2026-09-28 — icônes du jardin

Cinq icônes trait : `treeBroadleaf`, `treeConifer`, `treePalm`, `shrub`, `rock`, une par famille
d'élément du jardin (table `GARDEN_ICON`, `lib/gardenIcons.ts`). Le rendu 3D de ces éléments
(low-poly facetté) est décrit dans `../2_maison/2_2_jardin.md`.

Sources : `apps/web/src/lib/strokeIcons.ts`, `apps/web/src/lib/gardenIcons.ts`.

### Mise à jour 2026-10-04 — `Segmented` : pastille `count`, icônes `school` / `message` / `news`

Option `count?: number` d'un segment : pastille accent (inversée sur le segment actif). Après un
libellé, sa place reste **réservée** à 0 (`visibility: hidden`) : mesuré sur la vue École, la
pastille qui tombait à zéro décalait de 28 px les segments voisins. Sur un segment en **icône**, elle
est posée en exposant, hors du flux (`segmented__count--over`) : rien à réserver, et le segment
garde la largeur d'une icône. Une option sans `count` n'affiche rien de plus (les autres vues
ne changent pas).

Nouvelles icônes trait : `school` (cahier ouvert, entrée du rail École), `message` (bulle,
cahier de liaison), `news` (journal, publications).

Sources : `apps/web/src/components/ui/Segmented.vue`, `apps/web/src/lib/strokeIcons.ts`,
`apps/web/src/views/SchoolView.vue`.
