# FAQ — pièges d'outillage

> Dernière mise à jour : 2026-10-10
> Sources : sessions des 2026-09-04 et 2026-09-08, `apps/web/src/stores/settings.ts`, `apps/web/vite.config.ts`, `apps/web/src/components/home/*.vue`, `apps/web/src/styles/app.css`, `apps/web/src/plugins/vuetify.ts`, `apps/web/src/three/markers/screenArt.ts`, `apps/web/src/three/HouseScene.ts`, `apps/web/src/components/energy/EnergyFlow.vue`, `apps/web/src/components/devices/RoomBands.vue`, `apps/web/src/views/EnergyView.vue`, `apps/web/src/components/home/PanelArraysCard.vue`, `apps/web/src/three/builders/details.ts`, `apps/web/src/views/SettingsView.vue`, `apps/web/src/components/ui/Segmented.vue`, `apps/server/src/app.ts`, `apps/server/src/plugins/mixcloud/resolve.ts`, `apps/server/package.json`, `apps/web/src/components/controls/MediaPlayerControl.vue`, `docs/plugins/claude-assistant.md`, session du 2026-10-08, `scripts/dev-server.mjs`, session du 2026-10-10

## Vuetify 4 : changer de thème

- **Date** : 2026-09-04
- **Symptôme** : avertissement de dépréciation en console au changement de thème.
- **Diagnostic** : `theme.global.name.value = …` est déprécié en Vuetify 4.
- **Solution** : `useTheme().change(name)` (`stores/settings.ts`). Vuetify 4 a aussi un thème par défaut `system`.

## Vuetify 4 : composant dynamique par nom

- **Symptôme** : `<component :is="'v-bottom-sheet'">` rend un élément inconnu (contenu à plat, sans style).
- **Diagnostic** : `vite-plugin-vuetify` (auto-import) ne résout que les balises écrites littéralement dans les templates.
- **Solution** : importer explicitement (`import { VBottomSheet } from 'vuetify/components'`) et passer l'objet composant à `:is`.

## Vuetify 4 : typographie MD3

- **Symptôme** : `text-overline` n'a plus l'effet attendu.
- **Diagnostic** : Vuetify 4 remplace les classes MD2 (`text-h1`…) par des classes MD3 (`text-display-large`…).
- **Solution** : utiliser nos propres classes (`.section-label`, `.stat-value`) définies dans `styles/app.css`.

## Vuetify 4 : styles en couches CSS (`@layer`) — pas besoin de `!important`

- **Date** : 2026-09-08
- **Symptôme** : toutes les surcharges de l'app portaient `!important` pour passer devant Vuetify.
- **Diagnostic** : Vuetify 4 publie son CSS dans des couches (`@layer vuetify-components`,
  `vuetify-utilities`, `theme-background`…). **Toute règle non calquée** de l'app gagne face à une
  règle en couche, quelle que soit la spécificité — `!important` est inutile.
- **Solution** : écrire la règle sans `!important` dans `styles/app.css`. Corollaire : préférer
  quand même les props (`color`, `baseColor`, `trackColor`…), qui acceptent un `var(--jeton)`, pour
  ne pas dépendre des noms de classes internes.

## Vuetify 4 : la piste d'un `v-slider` passe à 38 % d'opacité

- **Date** : 2026-09-08
- **Symptôme** : la piste de fond d'un curseur est plus pâle que celle du curseur voisin.
- **Diagnostic** : `VSliderTrack` ajoute `v-slider-track__background--opacity` (opacité 0,38) dès que
  la prop `color` est posée (ou que `trackFillColor` ne l'est pas).
- **Solution** : colorer par `trackFillColor` + `thumbColor` (et `trackColor` pour le fond) sans
  poser `color` ; c'est ce que fait le bloc `defaults` de `plugins/vuetify.ts`.

## Jeu d'icônes maison dans Vuetify

- **Date** : 2026-09-08
- **Diagnostic** : `icons.sets` attend un composant qui rend lui-même la balise (`props.tag`) ;
  `IconOptions.aliases` est `Partial<IconAliases>`, on n'est donc pas obligé de fournir les ~55 alias.
- **Solution** : `plugins/icons.ts` (composant fonctionnel avec `props = ['icon', 'tag']` pour que
  ces deux valeurs ne retombent pas en attributs DOM). Piège : un nom absent du jeu ne rend
  **rien** (pas d'erreur) — vérifier visuellement après un renommage de glyphe.

## Vite 8 (Rolldown) : découpage en chunks

- **Symptôme** : `rollupOptions.output.manualChunks` rejeté par le typage / déprécié.
- **Solution** : `output.codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }, …] }` (`apps/web/vite.config.ts`).

## zod 4

- `z.string().datetime()` → `z.iso.datetime()` ; `.passthrough()` → `z.looseObject()` ; `z.record()` exige deux arguments ; `discriminatedUnion` et `superRefine` inchangés.

## TypeScript 7 et vue-tsc

- **Diagnostic** : la version publiée de TypeScript est 7.x (compilateur natif) ; `vue-tsc` 3.3 déclare `typescript >= 5` mais la compatibilité n'est pas garantie.
- **Solution** : `"typescript": "~5.9.0"` à la racine.

## Vitest 5 : projets

- `vitest.workspace.ts` a disparu ; déclarer `test.projects: ['packages/*', 'apps/*']` dans `vitest.config.ts` racine ; chaque workspace garde son `vitest.config.ts`.

## Outil Bash de Claude Code sous Windows

- **Symptôme** : `unexpected EOF while looking for matching quote` sur de longs heredocs.
- **Diagnostic** : la commande est tronquée vers 8 Ko.
- **Solution** : écrire les gros fichiers avec l'outil d'écriture de fichiers, garder Bash pour les commandes courtes.

## 2026-09-10 — `texture.repeat` n'existe pas pour un shader écrit à la main

- **Symptôme** : la pochette affichée sur l'écran 3D d'un téléviseur sortait **étirée** en largeur,
  alors que le calcul du cadrage était juste (vérifié par un test pur) et posé sur la texture par
  `texture.repeat.set(...)` / `texture.offset.set(...)`.
- **Diagnostic** : `repeat` et `offset` ne s'appliquent QUE par le transform d'UV que les matériaux
  **standard** de Three.js (`MeshBasicMaterial`, `MeshStandardMaterial`…) ajoutent à leur shader
  généré (`uvTransform`). Un `ShaderMaterial` écrit à la main lit `uv` brut : il les ignore **en
  silence**, sans avertissement, ni au build ni à l'exécution. L'image entière était donc plaquée sur
  toute la surface.
- **Solution** : passer le cadrage en **uniformes** (`uCrop`, `uCropOffset`) et échantillonner
  `texture2D(uMap, vUv * uCrop + uCropOffset)`. Un test vérifie désormais que le cadrage atterrit dans
  les uniformes du matériau — c'est ce qui manquait pour l'attraper sans regarder l'écran.
- **Leçon** : dès qu'on écrit son propre shader, on quitte TOUTES les commodités du pipeline standard
  (transform d'UV, éclairage, brouillard, encodage de sortie). Ce qui « devrait marcher » ne marche
  plus, sans rien dire.


## Une cellule de grille CSS qui découpe son contenu n'a plus de hauteur

- **Date** : 2026-09-11 (schéma de flux de la vue Énergie, commit 1551583).
- **Symptôme** : la carte du schéma restait haute de **79 px** alors que son contenu mesurait 467 px,
  et se dessinait **par-dessus** le graphique placé sous elle dans la même grille
  (`.energy__scroll`, `display: grid; gap: 20px; align-content: start`).
- **Diagnostic**, trois causes enchaînées, trouvées dans cet ordre :
  1. `aspect-ratio` posé sur la cellule de grille **ne dimensionne pas la rangée**. La rangée prenait
     la valeur du `min-height`, l'élément se peignait à la hauteur du rapport, et débordait.
  2. Le vieux truc du `padding-top` en pourcentage **échoue aussi** : les pourcentages qui dépendent
     du conteneur valent **zéro** dans le calcul de taille intrinsèque, donc la rangée ne les voit
     pas. Il marche en flux normal, pas ici.
  3. Le vrai coupable était **`overflow: hidden` sur la cellule de grille**. Même avec une hauteur
     DÉFINIE sur l'enfant, la rangée restait à 79 px : un conteneur de défilement voit sa taille
     minimale automatique ramenée à zéro.
- **Solution** : hauteur **définie** sur un enfant (`height: clamp(320px, 40vh, 420px)`), et la
  découpe (`overflow`, `border-radius`) portée par cet enfant, **jamais** par la cellule de grille.
  Pour un SVG qui doit s'aligner sur des enfants positionnés en pourcentages, mesurer le conteneur
  (`useElementSize`) et donner au `viewBox` les **pixels réels** : une unité SVG par pixel, donc rien
  n'est étiré, les angles restent droits et un disque reste rond.
- **Leçon** : j'ai deviné trois fois de suite avant de mesurer. Ce qui a donné la réponse en un essai,
  c'est de basculer les propriétés **une par une dans le navigateur** (`getComputedStyle` et
  `getBoundingClientRect` avant / après) — `overflow: visible` a fait passer la carte de 79 à 366 px.
  Devant un problème de layout, mesurer coûte moins cher que raisonner.

## Trois façons pour une grille CSS de déborder la page, ou de bouger toute seule

- **Date** : 2026-09-11 (vue Énergie et composant partagé `RoomBands`).
- **Symptôme** : sous 560 px, **les cinq vues en bandes** (Lumières, Ouvrants, Caméras, Médias,
  Énergie) débordaient horizontalement — conteneur de 303 px, cartes de 340 px, page qui glisse
  latéralement. Et dans la vue Énergie, l'en-tête du graphique mesurait 39 px avec « 0 kWh » mais
  60 px avec « 12,3 kWh » : il aurait grandi tout seul au fil de la journée.
- **Diagnostic**, trois pièges distincts, chacun trouvé en mesurant :
  1. **Un plancher `minmax()` reste un plancher.** `repeat(auto-fill, minmax(340px, 1fr))`
     (`RoomBands.vue`) impose une colonne de 340 px même dans un conteneur de 303 px : `auto-fill`
     sait réduire le NOMBRE de colonnes, pas leur largeur minimale.
  2. **`min-width` remonte toute la chaîne des grilles.** Poser une largeur plancher sur la scène du
     schéma l'a propagée jusqu'au conteneur défilant, et la page débordait de nouveau — de 430 px
     cette fois, soit pire qu'avant. Une cellule de grille prend par défaut la largeur **minimale**
     de son contenu (`min-width: auto`).
  3. **`min-width: 0` coupe aussi le plancher légitime d'un mot.** Posé par réflexe sur le titre du
     graphique, il l'autorisait à passer **sous la largeur de son plus long mot** : « Production »
     était coupé à 320 px.
- **Solution** :
  1. `minmax(min(340px, 100%), 1fr)` — la forme canonique : 340 px tant que la place existe, la
     largeur du conteneur sinon. Comportement inchangé au-dessus de 340 px, donc aucune régression
     sur les grilles à plusieurs colonnes (vérifié : 3 colonnes de 372 px à 1280 px, comme avant).
  2. `min-width: 0` sur **chaque** cellule de grille traversée (`.flow`, `.energy__top`), et la
     largeur plancher enfermée dans un cadre `overflow-x: auto` : le contenu large défile **dans sa
     propre carte**, jamais la page.
  3. Pas de `min-width: 0` sur un texte qu'on veut voir en entier — la valeur par défaut (`auto`,
     soit le plus long mot) est le bon plancher. Et pour la hauteur qui suivait la valeur : sous
     460 px, le total prend **sa propre ligne** (requête média), donc l'en-tête ne dépend plus de ce
     qu'il affiche.
- **Leçon** : corriger un débordement en déplace souvent la cause d'un cran. Les trois pièges se sont
  succédé, chacun **révélé par la correction du précédent**. Le seul garde-fou qui a tenu :
  `document.documentElement.scrollWidth === clientWidth` vérifié à chaque largeur (320, 375, 430,
  461, 500, 560, 700, 768, 900, 930, 1024, 1280, 1440), plus un test de stabilité qui réécrit la
  valeur affichée (« 0 kWh », « 9,9 kWh », « 1 234,5 kWh ») et compare les hauteurs.

### 2026-09-11 — `.partial()` de zod 4 réinjecte les défauts d'un champ optionnel

**Symptôme** : `PATCH /api/plugins/mock` avec `{ "parts": { "light": false } }` décochait bien le
sous-item… et **éteignait le plugin**. L'appareil disparaissait de la maison entière.

**Diagnostic** : le schéma du patch était `pluginSettingsSchema.partial()`. Rendre optionnel un champ
qui porte un `.default()` ne supprime pas le défaut : zod l'applique quand même.

```js
z.object({ enabled: z.boolean().default(false) }).partial().parse({})   // → { enabled: false }
```

Le corps arrivait donc porteur d'un `enabled: false` fantôme, que `setPluginInJson` écrivait
consciencieusement dans `house.json`. Rien dans les types ne le montre : `.partial()` annonce bien
`enabled?: boolean`.

**Solution** : déclarer le schéma de patch **à la main**, en champs `.optional()` sans défaut
(`pluginSettingsPatchSchema`, `packages/shared/src/house/schema.ts`). Règle générale : un schéma
d'écriture partielle ne se dérive pas d'un schéma de lecture qui porte des défauts.

**Cousin** : dans zod 4, `.default(v)` ne **valide pas** `v` (contrairement à zod 3). Le défaut de la
section `plugins` est donc écrit en entier plutôt que de compter sur les défauts imbriqués.

### 2026-09-11 — `v-checkbox-btn` rend une icône vide avec le jeu d'icônes maison

**Symptôme** : des cases à cocher invisibles dans Réglages. Le libellé s'affiche, la case occupe bien
28 × 28 px, l'icône fait 24 × 24 et sa couleur est correcte — mais rien n'est dessiné.

**Diagnostic** : `<svg …><path></path></svg>`, un chemin **vide**. Vuetify demande les alias
`$checkboxOn` / `$checkboxOff` ; `apps/web/src/plugins/icons.ts` ne les définit pas (il déclare
`complete`, `success`, `prev`, `dropdown`, `sortAsc`…), et le jeu maison rend alors un tracé vide au
lieu d'échouer. Même famille que les autres surprises Vuetify 4 de cette page : le composant marche,
il est juste muet.

**Solution** : ne pas utiliser de case à cocher ici — une **pastille à bascule** (`data-on`,
bordure et fond en `--accent`) dit l'état par la couleur, garde la même empreinte allumée ou éteinte
(règle « rien ne bouge ») et n'a besoin d'aucune icône. L'autre voie, si une case devient nécessaire
ailleurs, est d'ajouter les alias manquants dans `icons.ts`.

## Vuetify : le pouce d'un curseur s'aligne sur le `step`, le repère `ticks` sur sa valeur

- **Date** : 2026-09-12 (repère de position favorite d'un ouvrant, `apps/web/src/views/CoversView.vue`,
  `apps/web/src/components/controls/CoverControl.vue`).
- **Symptôme** : « parfois le marqueur de position perso ne semble pas bien placé, et quand on rappelle
  la position le cercle n'est pas au niveau du marqueur ». Décalage visible, de l'ordre de 5 px.
- **Diagnostic** : les deux repères ne suivent pas la même règle. Un `ticks` donné **en tableau** est
  placé à sa valeur exacte (`position(val)` dans `slider.js`, un pourcentage de la piste — vérifié :
  un repère à 80 % tombe à 152 px sur une piste de 190). Le **pouce**, lui, affiche
  `roundValue(modelValue)`, arrondi au `step`. Avec `step="5"` et une position favorite mémorisée à
  73 % par le moteur, le repère est à 73 et le pouce à 75 : 2,5 points d'écart au pire, soit ~5 px.
  Rien à voir avec les marges des repères extrêmes, déjà corrigées en 2026-09-08.
- **Solution** : `step="1"` sur les deux curseurs d'ouvrant. Le pouce peut alors se poser exactement
  sur le repère, et le pourcentage écrit à côté cesse de contredire la poignée. Un pas plus fin ne gêne
  pas au doigt : 0,5 % par pixel sur une piste de 190 px.
- **Leçon** : dès qu'un composant arrondit la valeur qu'il AFFICHE, tout ce qui se dessine à côté à la
  valeur BRUTE finit par mentir. Vérifier l'alignement au `getBoundingClientRect`, pas à l'œil.

## Une colonne de grille `auto` ne descend jamais sous le min-content de ses lignes

- **Date** : 2026-09-12 (section « Emplacement » du panneau appareil,
  `apps/web/src/components/home/PlacementControl.vue`).
- **Symptôme** : dans le corps du mode « Déplacer », le « m » de « 2.30 m » était coupé net au bord de
  la carte, et la ligne des coordonnées passait à deux lignes.
- **Diagnostic** : mesuré au `getBoundingClientRect` — corps large de **267 px**, lignes larges de
  **270 px**. Le corps est en `overflow: hidden` (sa hauteur s'anime à l'ouverture), il coupait donc les
  3 px qui dépassaient. La cause est la grille : `display: grid` sans `grid-template-columns` donne une
  colonne `auto`, dont la taille minimale est le **plus grand min-content** de ses lignes — ici les
  quatre préréglages de hauteur et la pilule « Retirer de la maison » (`min-width: 150px`). Une colonne
  `auto` ne se serre pas ; elle pousse.
- **Solution** : `grid-template-columns: minmax(0, 1fr)`. Le 0 en plancher autorise la colonne à
  descendre sous le min-content, les lignes se serrent à la largeur du panneau, et les enfants qui
  savent se couper (`min-width: 0`, ellipsis) s'en chargent. Vérifié après coup : `scrollWidth` ==
  `clientWidth` partout dans le corps.
- **Leçon** : troisième façon pour une grille de déborder, après le plancher `minmax()` et le
  `min-width` qui remonte la chaîne (entrée précédente). Toutes ont la même parade — donner
  explicitement un plancher de 0 aux colonnes qui doivent pouvoir se serrer.

## `PCFSoftShadowMap` déprécié depuis three 0.184 : les ombres redeviennent dures en silence

- **Date** : 2026-09-12 (`apps/web/src/three/HouseScene.ts`).
- **Symptôme** : ombres crénelées, et aucune ombre portée du bâtiment sur la pelouse, alors que le
  code demandait bien un mode « soft » et une carte d'ombre 2048.
- **Diagnostic** : la console le disait — `THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated.
  Using PCFShadowMap instead.` Depuis three **0.184**, la constante est acceptée mais **retombe sur du
  PCF dur**. Le projet est en `three ^0.185` : le mode soft n'avait jamais servi. L'avertissement se
  noyait dans les logs HMR de Vite, d'où plusieurs mois sans le voir. Cause aggravante, indépendante :
  la caméra d'ombre était cadrée sur les bornes de la maison **terrain compris**, donc la carte
  dépensait ses texels sur du vide.
- **Solution** : `renderer.shadowMap.type = VSMShadowMap`, flou réglé par `light.shadow.radius` et
  `blurSamples` (le même choix que l'éditeur voxel d'`un autre projet`), plus `shadow.normalBias` à côté du
  `bias`, et frustum d'ombre ajusté au **bâti** (cf. `../1_architecture/1_5_scene-3d.md`).
- **Leçon** : un avertissement de dépréciation three ne dégrade pas toujours proprement — ici il
  changeait le rendu sans rien casser, donc rien ne le remontait. Relire la console du navigateur
  filtrée sur `THREE.` après chaque montée de version, et pas seulement quand quelque chose plante.


## 2026-09-12 — Un contrôle segmenté ne se serre pas : il déborde

- **Symptôme** : dans le bloc « Emplacement », la dernière pilule des préréglages de hauteur (Plafond /
  Applique / Table / Sol) sortait de la carte. Apparu sans que ce bloc ait changé.
- **Diagnostic** : mesuré dans le navigateur plutôt que deviné — le segmenté demande **264 px** pour
  **257** disponibles. Ses segments sont en `white-space: nowrap` sans `flex-shrink` : un segmenté ne
  se serre pas tout seul, il déborde. Les 257 px, eux, sont les 267 habituels **moins la barre de
  défilement**, apparue parce qu'une nouvelle carte (les champs de panneaux) a rendu le panneau plus
  haut. Le coupable n'était donc pas le bloc qui débordait.
- **Solution** : quelques pixels repris sur les côtés de chaque segment (12 → 8 px), **sur cette ligne
  seulement** (`.place__presets`, `apps/web/src/components/home/PlacementControl.vue`), plus un
  `max-width: 100%`. Puis balayage de toutes les cartes du panneau, carte par carte, à deux hauteurs de
  fenêtre : plus rien ne sort d'une boîte de contenu.
- **Leçon** : quand une largeur devient juste, chercher ce qui a **pris les pixels** (ici une barre de
  défilement née ailleurs) avant de retoucher le composant qui craque. Et mesurer : `getBoundingClientRect`
  contre la boîte de contenu du parent dit en une passe qui déborde, là où l'œil hésite.

## 2026-09-13 — Sélectionner le contenu d'un champ au focus : `select()` seul ne suffit pas

**Symptôme** — cliquer dans un champ numérique affichant « 450 » et taper « 500 » donnait
« 450500 », puis la valeur bornée à la limite haute du réglage. Le curseur se posait là où on avait
cliqué et la frappe s'ajoutait à la valeur au lieu de la remplacer.

**Diagnostic** — deux mécanismes distincts effacent la sélection faite dans le gestionnaire `focus` :

1. **Le rendu.** Le gestionnaire pose un brouillon (`draft`) que le champ affiche par sa liaison
   `:value` ; Vue réécrit alors `input.value`, ce qui remet le curseur à la fin et annule toute
   sélection. Sélectionner AVANT ce rendu ne tient donc pas une image.
2. **Le relâchement de la souris.** `mousedown` donne le focus (et la sélection), mais `mouseup`
   repose ensuite le curseur à l'endroit du clic — et défait la sélection à peine posée.

**Solution** — les deux à la fois : `nextTick(() => input.select())` dans le gestionnaire de focus,
et `@mouseup.prevent` sur le champ. Appliqué à `PanelArraysCard.vue` et `PlacementControl.vue`, les
deux composants à champs numériques.


### Mise à jour 2026-09-14 — deux pièges MapLibre

**Le plan reste vide, le satellite marche.**
Date : 2026-09-14. Symptôme : avec MapLibre GL JS 6 sous Vite en développement, la vue satellite
(source raster) s'affiche, la vue plan (tuiles vectorielles OpenFreeMap) ne montre que la couleur de
fond — aucune erreur en console, le style, le sprite et le TileJSON sont bien chargés. Diagnostic :
MapLibre 6 est livré en ESM seul et démarre son worker par
`new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url), { type: 'module' })`. Une fois la
dépendance pré-empaquetée dans `node_modules/.vite/deps`, `import.meta.url` ne pointe plus sur rien
de voisin : le worker ne démarre pas, et ce sont LUI qui décode les tuiles vectorielles (les tuiles
raster, elles, se chargent sur le fil principal — d'où le satellite qui marche). Solution :
`optimizeDeps: { exclude: ['maplibre-gl'] }` dans `apps/web/vite.config.ts` ; servie telle quelle
depuis `node_modules`, la bibliothèque retrouve son worker. Le build de production sait empaqueter un
worker désigné ainsi. Comment ça s'est vu : en exposant la carte en développement
(`container.__map`) et en comptant `queryRenderedFeatures().length` — 0 avant, 128 après. Les
requêtes du worker n'apparaissent pas dans `performance.getEntriesByType('resource')` du fil
principal, ce qui a d'abord égaré le diagnostic.

**« Cannot read properties of undefined (reading 'lng') » à l'ajout d'un marqueur.**
Date : 2026-09-14. Symptôme : `new Marker(...).addTo(map)` puis `setLngLat(...)` plante à l'`addTo`.
Diagnostic : MapLibre projette le marqueur en l'ajoutant, il lui faut déjà une position. Solution :
`new Marker(...).setLngLat(at).addTo(map)`. Source : `apps/web/src/components/vehicles/VehicleMap.vue`.

**Au passage** : le serveur `python -m http.server` de Windows sert `.mjs` en `text/plain`, ce que
le navigateur refuse pour un module (« Strict MIME type checking ») ; un `SimpleHTTPRequestHandler`
avec `extensions_map['.mjs'] = 'text/javascript'` règle la page de test.


### 2026-09-14 — L'attribution MapLibre : deux verrous, et deux taps pour rouvrir si on n'en tient qu'un

Date : 2026-09-14. Symptôme : le panneau d'attribution s'ouvre tout seul une demi-seconde après le
montage et couvre la carte ; une fois replié à la main, il faut **deux taps** sur le ⓘ pour le
rouvrir. Diagnostic : le contrôle est un `<details>`, et son état tient à DEUX choses — `open`
(le repli natif du `<details>`) et la classe `maplibregl-compact-show` (c'est elle que le CSS de
MapLibre regarde pour afficher le texte, `display: none` sinon). MapLibre les bascule ensemble au
clic, mais les laisse désaccordés si on n'en change qu'une :

| ce qu'on fait | `open` | classe | effet |
|---|---|---|---|
| retirer la seule classe | vrai | absente | replié à l'œil, mais le premier tap FERME (déjà ouvert) |
| mettre `open` à faux seul | faux | présente | replié à l'œil, mais le premier tap ne fait que retirer la classe |
| les deux (la bonne) | faux | absente | un tap ouvre |

Solution : `el.open = false` **et** `el.classList.remove('maplibregl-compact-show')`, une seule fois
(un drapeau), sur `load` / `styledata` / `idle` — le panneau n'existe pas encore au montage, et il est
déplié plus tard, au premier calcul des mentions. Passé ce repli, on n'y touche plus : le panneau est
à l'utilisateur. Source : `apps/web/src/components/vehicles/VehicleMap.vue`.

Mesuré au passage, utile pour la prochaine fois : le `<details>` apparaît à 220 ms (vide, `open`
faux), et MapLibre l'ouvre à 497 ms. Un repli tenté au montage ne tient donc pas.

### Mise à jour 2026-09-18 — un repli qui TIENT au montage : poser `maplibregl-compact` soi-même

La dernière phrase ci-dessus vaut pour la méthode employée alors, pas pour le montage en général.
Retirer `maplibregl-compact-show` au montage ne sert à rien : à cet instant l'attribution est encore
vide (classe `maplibregl-attrib-empty`), la classe n'est donc pas encore posée, et MapLibre la posera
plus tard. Mais on peut le prendre de vitesse par l'autre bout. Son `_updateCompact()` n'ouvre le
panneau que si `maplibregl-compact` **manque** (`!classList.contains('maplibregl-compact') &&
!classList.contains('maplibregl-attrib-empty')`, maplibre-gl 6.9) : poser cette classe soi-même juste
après `new Map(...)` rend la condition fausse pour toujours, et `maplibregl-compact-show` n'arrive
jamais. Une ligne, sans drapeau ni écoute d'événement :

```ts
container.value.querySelector('.maplibregl-ctrl-attrib')?.classList.add('maplibregl-compact')
```

L'état obtenu (`open` absent, classe absente) est exactement la bonne ligne du tableau ci-dessus :
un seul tap ouvre. Il survit au changement de thème — le style est rechargé, `_updateAttributions()`
rappelle `_updateCompact()`, dont la condition reste fausse. Vérifié sur la vue Météo, thèmes clair
et sombre. Source : `apps/web/src/components/weather/RainRadar.vue`.

`VehicleMap.vue` garde sa méthode du 2026-09-14 (drapeau + repli sur `load` / `styledata` / `idle`),
qui marche aussi ; les deux recettes coexistent, à unifier au prochain passage sur cette carte.

## `backdrop-filter` au-dessus d'un canvas qui s'anime : un plafond de fréquence invisible

- **Date** : 2026-09-15
- **Symptôme** : la vue Maison plafonne autour de 20 images par seconde dès qu'on tourne la caméra,
  sur une machine qui n'a aucune raison de peiner. Les compteurs de three sont sains (appels de
  dessin, triangles), le coût CPU mesuré en JavaScript aussi.
- **Diagnostic** : les pilules de marqueur portaient `backdrop-filter: blur(8px)`. Un filtre de fond
  se recalcule dès que son FOND change — et leur fond, c'est le canvas, qui se redessine à chaque
  image. Des dizaines d'appareils, autant de floutages par image, payés par le compositeur du
  navigateur : aucun outil côté WebGL ne les voit, et aucune mesure JavaScript non plus.
- **Solution** : fond opaque pour la pilule (`color-mix(... 92%)`), aucun filtre. Règle générale :
  **au-dessus d'une surface qui s'anime, un `backdrop-filter` ne doit jamais se multiplier** ; un seul
  grand (un panneau) se discute, des dizaines de petits jamais. Source : `apps/web/src/styles/app.css`
  (`.marker-pill`), `../1_architecture/1_5_scene-3d.md`.

## Déplacer des éléments DOM au-dessus d'un canvas : promouvoir, sinon c'est un repeint par image

- **Date** : 2026-09-15
- **Symptôme** : la vue Maison plafonne à ~28 images par seconde dès qu'on tourne la caméra. Changer
  la qualité de rendu n'y fait rien — même en démontant toute la chaîne d'effets.
- **Diagnostic** : les étiquettes d'appareil sont des éléments HTML que le `CSS2DRenderer` déplace à
  chaque image. Un élément non promu qui se déplace est REPEINT en entier (bordure, arrondi, ombre,
  SVG), plus la zone qu'il libère. Quarante étiquettes = quarante repeints par image (ordre de grandeur), invisibles aux
  compteurs de three comme au temps passé dans `render()`.
- **Solution** : `will-change: transform` sur l'élément déplacé (ici `.marker-anchor`), plus
  `contain: layout style` pour borner l'invalidation. Règle : **tout élément qu'on déplace à chaque
  image doit être promu en couche de composition** ; sinon on paie de la peinture, pas de la
  composition. Source : `apps/web/src/styles/app.css`, `../1_architecture/1_5_scene-3d.md`.

### Mise à jour 2026-09-15 — ce que la mesure GPU a montré ensuite

Les deux entrées ci-dessus restent de l'hygiène juste, mais le plafond de la maison réelle n'était
pas là : mesuré à la requête de temps GPU, pilules allumées ou éteintes donnaient la même cadence
(8,5 vs 8,3 img/s). Le goulot était le GPU — et le mauvais GPU d'un portable hybride. Voir
`../1_architecture/1_5_scene-3d.md` (undecies) et `6_1_pieges-runtime.md`.

## Mesurer la cadence d'une scène 3D : ni la preview intégrée, ni un onglet caché

- **Date** : 2026-09-15
- **Symptôme** : dans la preview intégrée de Claude Code, `requestAnimationFrame` tourne à ~3 Hz ou
  à 165 Hz sans que la scène ne rende ; dans un onglet du vrai Chrome piloté par l'extension, il ne
  tourne pas du tout dès que la fenêtre de l'application passe devant : `document.visibilityState`
  vaut `hidden`, et tout `await` sur une image reste suspendu (« renderer frozen »).
- **Diagnostic** : Chrome ne délivre pas d'images à un onglet qu'il juge invisible (onglet non actif,
  fenêtre occultée, preview hors écran). Aucune cadence n'y est interprétable, et `gl.finish()` ne
  mesure que les commandes GL, pas l'attente du compositeur.
- **Solution** : un Chrome À PART (`chrome.exe --remote-debugging-port=… --user-data-dir=…
  --disable-backgrounding-occluded-windows`), fenêtre visible, piloté par CDP depuis Node (WebSocket
  natif de Node 22) ; une requête `EXT_disjoint_timer_query_webgl2` autour de chaque image pour le
  temps GPU réel ; `Performance.getMetrics` (CDP) pour la part du fil principal. Ne jamais ouvrir un
  second onglet (`chrome://gpu` compris) : il vole la visibilité. Scripts dans
  `_generated-ai-doc/perf/` (`kasbah-variants.mjs`, `verify-guard.mjs`). Le GPU vu par Chrome se lit
  par `SystemInfo.getInfo` sur la cible navigateur.

## Forcer un GPU dans Chrome pour mesurer : `--use-adapter-luid`, que le réglage Windows écrase

- **Date** : 2026-09-15
- **Symptôme** : `--use-adapter-luid=0,72150` (LUID lue par une énumération DXGI, `perf/luid.ps1`)
  force bien le GPU dédié… jusqu'à ce que l'utilisateur pose la préférence Windows pour `chrome.exe` : le
  drapeau ne force plus rien, dans un sens comme dans l'autre.
- **Diagnostic** : la préférence par application (`HKCU\Software\Microsoft\DirectX\UserGpuPreferences`)
  est indexée par **chemin d'exécutable** et gagne sur le choix d'adaptateur du processus.
- **Solution** : pour remesurer l'iGPU une fois la préférence posée, lancer `chrome.exe` par un autre
  chemin — une jonction NTFS vers `C:\Program Files\Google\Chrome\Application` — que la clé ne
  connaît pas. La supprimer avec `rmdir` (pas `rm -r`, qui suivrait la jonction).

## three : `mergeGeometries` refuse une boîte et une extrusion ensemble

- **Date** : 2026-09-15
- **Symptôme** : `THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index 24.
  All geometries must have compatible attributes; make sure index attribute exists among all
  geometries, or in none of them.` — et le maillage fusionné manque (couronnements et soubassement
  du détail architectural), sans qu'aucun test ne le voie.
- **Diagnostic** : une `BoxGeometry` est INDEXÉE, une `ExtrudeGeometry` (nos murs, `extrudePolygon`)
  ne l'est pas ; la fusion exige que toutes le soient ou qu'aucune ne le soit.
- **Solution** : `p.index ? p.toNonIndexed() : p` sur chaque morceau avant `mergeGeometries`, et
  libérer les intermédiaires (`builders/details.ts › meshOf`). Un test qui compte les maillages
  attendus (`détail architectural`) attrape désormais une fusion qui rend `null`.

## three : après `rotateZ`, l'axe y local n'est pas la normale du mur

- **Date** : 2026-09-15
- **Symptôme** : encadrements et appuis de fenêtre posés DANS la pièce, vantail côté façade — vu par
  l'utilisateur sur la vraie maison, capture à l'appui. Vitrage et volet à leur place.
- **Diagnostic** : `geometry.rotateZ(atan2(u.y, u.x))` envoie l'axe x local sur `u` et l'axe y local
  sur la perpendiculaire GAUCHE de `u` ; la normale extérieure d'un mur de pièce CCW est la
  perpendiculaire DROITE (`perpRight`, `walls.ts`). Le vitrage (`buildPane`) et le volet
  (`markers.ts`) n'avaient pas le piège parce qu'ils ajoutent `normal × distance` en coordonnées
  monde au lieu de passer par un repère local.
- **Solution** : ne jamais supposer le sens ; calculer `side = sign(perpLeft(u) · normal)` et
  multiplier la coordonnée locale y par ce signe (`details.ts › boxAt`). Et un test qui projette les
  sommets sur la normale de la baie (cadre entre les deux faces, appui au-delà de la façade).

## three : les UV d'une extrusion suivent les axes du monde, pas les bords du polygone

- **Date** : 2026-09-15
- **Symptôme** : les carreaux du fond d'une piscine tournée sont en biais par rapport à ses côtés
  (« correctement aligner la texture du fond, actuellement en biais »). Invisible sur la maison de
  démo, dont la piscine est alignée sur les axes.
- **Diagnostic** : `ExtrudeGeometry` et `ShapeGeometry` prennent les POSITIONS locales comme UV
  (`WorldUVGenerator`). Un motif à grille (`tile`, `repeat = 1 / tileM`) est donc aligné sur les axes
  du repère dans lequel la géométrie est construite — le monde, si on lui donne le polygone tel quel.
- **Solution** : construire dans le repère du polygone puis remettre en place : tourner le polygone
  pour poser son plus grand côté sur y, autour de son centre, construire, puis `translate` /
  `rotateZ` / `translate` inverses sur la géométrie — les positions reviennent, les UV restent
  locales (`builders/shapes.ts › alignedToLongestEdge`). Test à l'emprise UV : un 8 × 4 tourné de 30°
  doit donner 32 m², pas ~64.

## three : un volume creusé sous une surface est bouché par elle

- **Date** : 2026-09-15
- **Symptôme** : bassin de piscine invisible, seule la margelle se voit autour de la pelouse.
- **Diagnostic** : le terrain (polygone plat à la cote du sol) et le sol infini (disque deux
  centimètres plus bas) couvrent l'emprise du bassin ; le bassin est bien là, sous eux.
- **Solution** : percer les deux à l'emprise des bassins (`Shape.holes` : `flatWithHoles`,
  `discWithHoles`) — un trou dans la surface, pas un ordre de rendu.

## Vite : un import de valeur ajouté à chaud casse le module qui le porte

- **Date** : 2026-09-16
- **Symptôme** : l'app ne démarre plus sur le serveur de dév, sans avoir rechargé la page.
  `SyntaxError: The requested module '/src/three/HouseScene.ts?t=1789…' does not provide an export
  named 'HouseScene' (at useHouseScene.ts:8:10)`, suivi de `[VUE_ROUTER_R0010]` et
  `[VUE_ROUTER_R0011]` — le routeur échoue sur sa navigation initiale, le composant asynchrone ayant
  jeté. Le fichier compile pourtant, et `vue-tsc` est propre.
- **Diagnostic** : la modification en cours ajoutait à `HouseScene.ts` un import de **valeur** vers
  `markers/markers.ts` (pour un `instanceof`), alors qu'il n'en importait jusque-là que des **types**
  et `createMarker`. Le graphe de modules de la session Vite, construit sur l'ancienne version, s'est
  retrouvé à réévaluer `HouseScene.ts` à chaud avec une dépendance nouvelle : le module sert alors ses
  exports avant d'être initialisé, et l'importateur n'y trouve plus rien. Le `?t=…` de l'URL signe
  bien un module rechargé à chaud, pas un module frais.
- **Solution** : immédiate, recharger la page (ou redémarrer `npm run dev` : la session garde la trace
  de l'import fautif). De fond, ne pas ajouter l'import : le point d'entrée est descendu sur la classe
  de BASE (`DeviceMarker.previewColor`, que la sous-classe redéfinit), déjà importée en type seul — le
  graphe d'imports de la scène redevient celui d'avant. Un `instanceof` qui force un import de valeur
  entre deux modules déjà liés par des types mérite qu'on cherche l'alternative polymorphe.

## 2026-09-16 — Empiler ou aligner : quatre essais pour une page de réglages sans trous

- **Date** : 2026-09-16 (vue Réglages, `apps/web/src/views/SettingsView.vue`).
- **Symptôme** : une page de six blocs dont un seul, « Rendu 3D », fait **887 px** quand les autres
  vont de 94 à 417. Toutes les dispositions essayées laissaient de grandes surfaces vides — jusqu'à
  une colonne entière blanche sur un écran 1920.
- **Diagnostic**, en quatre mesures au `getBoundingClientRect` dans l'app réelle (viewport 1280) :
  1. **Grille `auto-fit minmax(320px, 1fr)` → 1318 px.** Une grille **aligne ses rangées** : la
     hauteur d'une rangée est celle de son plus grand bloc, donc le bloc géant creuse ~800 px de vide
     dans les deux cellules voisines.
  2. **Colonnes CSS `columns: 360px` → 887 px**, dense à 1280 — mais à 1920 la largeur donne
     **quatre** colonnes et la dernière reste entièrement vide. Le **nombre de colonnes utile** d'un
     empilement vaut « hauteur totale des blocs ÷ hauteur du plus grand » : ici ~1460 ÷ ~730, soit 2.
     Au-delà, il n'y a plus de quoi remplir.
  3. **`columns: 2 340px`, bloc géant au milieu → 1131 px.** L'équilibrage de `columns` remplit
     **dans l'ordre du DOM** et la **dernière colonne absorbe le reste** : 683 px d'un côté, 1131 de
     l'autre. Le même CSS avec le bloc géant **en dernier** donne 808 px et 92-98 % de remplissage —
     seul l'ordre avait changé.
  4. Impossible de concilier cet empilement avec « ce bloc sur deux colonnes » : **`column-span` ne
     connaît que `all`**, jamais « deux ».
- **Solution** : abandonner l'idée d'une seule mécanique pour toute la page. Trois **piles**
  indépendantes (`display: grid; align-content: start`) posées dans une grille `1fr 2fr 1fr` — chaque
  pile coule à son rythme, la page ne fait que la hauteur de la plus haute, et le bloc large occupe
  bien ses deux unités. Résultat : **682 px**, ratio mesuré 1 : 2.00 : 1 à 1920.
- **Leçon** : une grille **aligne**, des colonnes **empilent** ; on ne demande pas à l'une le travail
  de l'autre. Quand un bloc domine les autres d'un facteur 5, la parade n'est pas un réglage de
  `minmax()` mais un **découpage en conteneurs indépendants**. Et avant de choisir le nombre de
  colonnes, faire la division : hauteur totale ÷ hauteur du plus grand.

## 2026-09-16 — Le plancher `auto` d'une piste `fr`, utilisé à l'endroit pour une fois

- **Date** : 2026-09-16 (vue Réglages, `apps/web/src/views/SettingsView.vue`).
- **Symptôme** : dans un bloc large coupé en deux colonnes, le segmenté « Automatique / Jour /
  Crépuscule / Nuit » était tranché net au bord de la carte — le même symptôme qu'au 2026-09-12
  (« Un contrôle segmenté ne se serre pas : il déborde »), un cran plus haut dans la page.
- **Diagnostic** : le `scrollWidth` du segmenté donne son min-content, **~370 px** ; la demi-colonne
  n'en offrait que ~280. Deux entrées précédentes de cette FAQ apprenaient à **neutraliser** le
  plancher min-content d'une piste (`minmax(0, 1fr)`) pour l'empêcher de pousser la page. Ici c'est
  l'inverse qu'il fallait : ce plancher est la **seule garantie** que la piste ne se serre pas au
  point de couper son contenu.
- **Solution**, en trois temps :
  - les deux segmentés sortent des demi-colonnes et reprennent **toute la largeur du bloc**
    (`grid-column: 1 / -1`), là où ils ont la place ;
  - ils passent en `dense` (prop déjà offerte par `ui/Segmented.vue`), ce qui abaisse d'autant le
    min-content qu'ils imposent à la piste qui les porte ;
  - la piste centrale garde son plancher `auto` (**pas** de `minmax(0, …)`), et ce min-content sert
    à **calculer le seuil** de bascule de la disposition : la pile de gauche réclamant 344 px, la
    grille 1-2-1 ne s'applique qu'au-delà de 1500 px, sous quoi tout s'empile. En dessous les pistes
    se déformaient en 344 / 492 / 246 — plus rien de 1-2-1.
- **Leçon** : `minmax(0, 1fr)` n'est pas un réflexe, c'est un arbitrage. Plancher à 0 quand les
  enfants savent se couper proprement (ellipsis, `min-width: 0`) ; plancher `auto` conservé quand ils
  ne le savent pas — un segmenté, justement — et le min-content devient alors une **mesure exploitable**
  pour placer un point de bascule, au lieu d'un chiffre rond choisi au hasard.
- **Voir aussi** : `../4_ui/4_1_navigation-et-panneaux.md`, mise à jour du 2026-09-16, pour la
  disposition qui en découle, et la requête de **conteneur** (`@container`) qui décide du découpage
  en deux colonnes d'après la largeur du bloc plutôt que celle de l'écran.

## 2026-09-17 — `:global(X) .y` dans un `<style scoped>` : le descendant disparaît, la règle fuit

- **Date** : 2026-09-17
- **Symptôme** : une règle de thème écrite `:global(html[data-theme='dark']) .ma-classe { … }`
  ne s'applique jamais à `.ma-classe`.
- **Diagnostic** : le compilateur Vue **supprime le descendant** et ne garde que ce qui est dans
  le `:global(...)`. Vérifié en compilant avec `compileStyle` de `vue/compiler-sfc` :
  `:global(html[data-theme='dark']) .home__vignette { background: … }` produit
  `html[data-theme='dark'] { background: … }`. La règle n'est donc pas seulement morte : elle
  **fuit sur `<html>` tout entier**, ce qui est pire qu'un simple oubli.
- **Solution** : mettre **tout** le sélecteur à l'intérieur du `:global(...)` —
  `:global(html[data-theme='dark'] .vmap .btn)` compile correctement (c'est ce que fait
  `apps/web/src/components/vehicles/VehicleMap.vue`). À défaut, un bloc `<style>` **non scopé**
  séparé portant le sélecteur complet, quand la classe visée est assez distinctive pour que la
  portée reste locale en pratique (`apps/web/src/components/controls/WaterCard.vue`).
- **Dette ouverte** : `apps/web/src/views/HomeView.vue:254` emploie la forme cassée — le
  vignettage sombre de l'accueil n'est pas appliqué, et un `radial-gradient` est posé sur `html`
  en thème sombre. Non corrigé, découvert hors périmètre.
  *(Constat du lint du 2026-10-06 : la ligne a bougé, la règle fautive est aujourd'hui à
  `apps/web/src/views/HomeView.vue:476` ; toujours sous la forme cassée `:global(html[data-theme='dark']) .home__vignette`.)*

## Fastify 5 : `FSTDEP022` — `maxParamLength` au premier niveau

- **Date** : 2026-09-19
- **Symptôme** : au démarrage du serveur,
  `[FSTDEP022] FastifyWarning: The router options for maxParamLength property access is deprecated.
  Please use "options.routerOptions" instead`.
- **Diagnostic** : Fastify 5.12 (installé : 5.12.3) copie encore les options du routeur (`find-my-way`)
  depuis le premier niveau de `Fastify({ … })`, mais cet accès est déprécié et disparaît en v6.
  Kasbah posait `maxParamLength: 512` à cet endroit depuis le 2026-09-09 (ids Nest auto-placés,
  voir `6_1_pieges-runtime.md`).
- **Solution** : `routerOptions: { maxParamLength: 512 }` dans `apps/server/src/app.ts`. La limite
  et le test d'id long restent les mêmes.

## 2026-09-22 — `no-irregular-whitespace` : l'outil d'écriture pose de vraies espaces insécables

- **Symptôme** : un `.vue` fraîchement écrit échoue au lint sur `no-irregular-whitespace`, à des
  endroits où le code semble normal. Rien ne se voit dans l'éditeur.
- **Diagnostic** : l'outil d'écriture de fichiers de Claude Code écrit l'espace insécable **en
  caractère réel** (U+00A0) au lieu de la séquence `\u00a0` voulue — typiquement dans un libellé
  d'interface ou une valeur de repli. Le fichier est valide, mais la règle ESLint refuse ce caractère
  dans du code.
- **Solution** : deux voies, aucune n'étant « réécrire le fichier en espérant mieux ». Soit un
  remplacement d'**octets** (`sed`/script sur `\xc2\xa0`), soit — et c'est ce qui a été retenu dans
  `MusicPlayerBar.vue` — une **constante** dans le script : `const NBSP = '\u00a0'`, utilisée partout
  où une ligne vide doit garder sa hauteur (ailleurs, l'échappement en clair dans le template :
  `{{ meta || '\u00a0' }}`, `MusicItemRow.vue` / `MusicTile.vue`). Le caractère cesse alors
  d'exister dans le source — vérifié : aucun U+00A0 littéral dans `components/music/`.
- **Règle** : un caractère invisible qui doit finir dans le DOM se déclare **une fois**, échappé, dans
  le code ; il ne se tape jamais littéralement — d'autant moins quand c'est un outil qui tape.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/components/music/MusicItemRow.vue`.

## 2026-09-23 — Git Bash réécrit un argument qui commence par `/` (clé de mix Mixcloud)

- **Symptôme** : une sonde lancée depuis Git Bash avec une clé de mix Mixcloud (`/user/slug/`) en
  argument — yt-dlp, `curl`, un script `node` — vise une adresse absurde ou échoue, alors que la même
  clé fonctionne depuis le serveur.
- **Diagnostic** : la couche MSYS de Git Bash **convertit** tout argument qui ressemble à un chemin
  POSIX absolu en chemin Windows (`/user/slug/` devient un chemin sous le dossier d'installation de Git, du genre
  `C:/Program Files/Git/user/slug/`) avant de
  le passer à un programme Windows, sans rien afficher. La clé Mixcloud a exactement cette forme.
- **Solution** : préfixer la commande de `MSYS_NO_PATHCONV=1` (ex.
  `MSYS_NO_PATHCONV=1 node probe.mjs /user/slug/`). Le serveur n'est pas concerné : il passe l'URL
  complète `https://www.mixcloud.com<clé>` à yt-dlp par `spawn`, sans shell
  (`apps/server/src/plugins/mixcloud/resolve.ts`).
- **Source** : récit du thread principal, session du 2026-09-23 ; voir `../3_plugins/3_20_mixcloud.md`.

## 2026-09-23 — `tsx watch` bloqué sous `concurrently` par le SDK MCP v2

- **Symptôme** : `npm run dev` lance Vite et le PO Token, mais le serveur n'écrit **rien** après
  `tsx watch --env-file-if-exists=.env src/main.ts` et n'écoute jamais : Vite répète
  `ws proxy error: AggregateError [ECONNREFUSED]`. Aucun message d'erreur, même après 90 s.
- **Diagnostic** : apparu avec le serveur MCP (4657c58). Le blocage tient à l'import de
  `@modelcontextprotocol/server`, et plus précisément à la résolution de son **auto-référence
  conditionnelle** `@modelcontextprotocol/server/_shims` (export `workerd` / `browser` / `node`) : les
  fichiers eux-mêmes se chargent bien importés par leur chemin. Seule la combinaison
  `tsx watch` **+** `concurrently` bloque : `tsx` sans watch, `tsx watch` seul, Node pur, vitest et le
  bundle esbuild passent — c'est pourquoi les tests ne l'ont pas vu. tsx 4.23.15 (la dernière) bloque
  aussi. La cause dans tsx n'a pas été cherchée plus loin.
- **Solution** : script `dev` du serveur passé au watch **natif** de Node, tsx ne servant plus que de
  chargeur : `node --watch --import tsx --env-file-if-exists=.env src/main.ts`
  (`apps/server/package.json`). Vérifié sous `npm run dev` complet : API directe et par le proxy
  Vite, `/mcp`, redémarrage sur modification. Effet de bord bienvenu : une modification de
  `packages/shared` redémarre désormais le serveur, ce que `tsx watch` ne faisait pas
  (`../3_plugins/3_14_irobot-roomba.md`). `node --watch` envoie `SIGTERM` à l'enfant, que `main.ts`
  traite déjà (arrêt propre des plugins).
- **Source** : session du 2026-09-23, bissection par sondes `import '…'` sous
  `concurrently "npx tsx watch …"`.

- **Correction 2026-10-01** : « `main.ts` traite déjà le SIGTERM (arrêt propre des plugins) » est faux
  **sous Windows** — voir l'entrée du 2026-10-01 plus bas. Le reste de l'entrée tient.

- *Dépassé le 2026-10-10 : le serveur de dev ne tourne plus sous `node --watch` mais sous
  `scripts/dev-server.mjs` (voir l'entrée du 2026-10-10). Le diagnostic `tsx watch` + `concurrently`
  tient toujours, re-vérifié ce jour.*

## 2026-09-24 — Le Vite de l'utilisateur sert un bloc `<style scoped>` périmé

- **Symptôme** : dans le pied « Page Musique / Ouvrir » du lecteur du panneau appareil, la pastille
  « Ouvrir » est collée au libellé au lieu d'aller au bord droit — et la preview ne le reproduit pas. Dans SON onglet, une règle neuve
  comme `.to-music { justify-content: space-between }` se calcule à `normal` : le template est à
  jour, les règles récentes du style scoped de `MediaPlayerControl.vue` sont absentes.
- **Diagnostic** : deux serveurs Vite tournaient — celui de l'utilisateur (`npm run dev`, port
  5173) et celui de la preview (6175). Le premier servait une **compilation ancienne du bloc de
  style** du composant, le second la bonne. Pour trancher, demander directement le module de style
  au serveur fautif et y chercher la règle :
  `http://localhost:5173/src/components/controls/MediaPlayerControl.vue?vue&type=style&index=0&scoped=<hash>&lang.css`
  (le `<hash>` se lit dans l'attribut `data-v-…` du DOM ou dans l'onglet réseau). La cause de la
  désynchronisation dans Vite n'a pas été cherchée.
- **Solution** : `touch` sur le `.vue` (force la recompilation) puis recharger l'onglet ; à défaut,
  redémarrer `npm run dev`. Leçon : quand l'utilisateur voit un défaut visuel que la preview ne
  montre pas, inspecter **son** serveur (5173) dans le panneau navigateur, en lecture seule, avant
  de chercher dans le code.
- **Source** : récit du thread principal, session du 2026-09-24 ; voir
  `../4_ui/4_1_navigation-et-panneaux.md`, « le lecteur du panneau appareil rejoint la barre Musique ».
- **Récidive 2026-09-28** : après plusieurs rechargements à chaud ratés, Vite a servi un
  `MusicTile.vue` **sans ses nouveaux styles** (étiquette de durée sur la pochette), et ce même après
  F5 ; seul un **redémarrage de Vite** a rendu la bonne compilation. Le `touch` n'a pas été essayé
  d'après le récit. Même session : les serveurs de dev lancés en watch (8787 pour l'IDE, 9787 pour une
  autre session) rechargent le code en cours d'édition — un serveur qu'on croit « à soi » peut
  tourner sur le code d'une autre session, et inversement. Source : récit du thread
  principal, page Musique du 2026-09-28 ; non reproduit ici.

## 2026-09-25 — `import()` d'un module depuis la console : pas le même après un HMR

- **Symptôme** : en preview, `await import('/src/three/core/heightMist.ts')` depuis la console pour
  modifier `heightMistUniforms` à la main ; la scène ne réagit pas.
- **Diagnostic** : après une modification à chaud, Vite sert le module sous une URL `?t=…` ; un
  import SANS ce paramètre donne une copie neuve, distincte de celle que la scène utilise. Le même
  module n'est rendu qu'avant toute modification à chaud.
- **Solution** : redémarrer le serveur de preview pour retrouver le module partagé, ou passer par le
  contrôleur exposé en dev sur `window.kasbahScene` (`useHouseScene`) quand il donne accès à ce qu'on
  veut régler.
- **Source** : récit du thread principal, session du 2026-09-25 (brume basse) ; non reproduit ici.
  Voir `../1_architecture/1_5_scene-3d.md`, section 2026-09-25 (septies).

## 2026-09-28 — Vite sert une transformation lue en pleine écriture, et la garde

- **Date** : 2026-09-28
- **Symptôme** : après deux écritures successives de `apps/web/src/stores/settings.ts`, l'app de
  la preview est blanche avec « does not provide an export named useHouseStore ». L'erreur
  persiste d'un rechargement à l'autre.
- **Diagnostic** : Vite a mis en cache la transformation d'un fichier lu **pendant** son écriture
  (fichier incomplet), et ne l'a pas invalidée au rechargement. Cause exacte dans Vite non
  cherchée. Même famille que la récidive du 2026-09-28 plus haut (styles de `MusicTile.vue`).
- **Solution** : seul un **redémarrage du serveur de preview** l'a résolu. Précaution qu'on en
  tire, non éprouvée : écrire un fichier en une fois plutôt qu'en deux passes rapprochées.
- **Source** : récit du thread principal, session jardin du 2026-09-28 ; non reproduit ici.

## 2026-09-28 — Google Drive rend une page « quota dépassé » au lieu du fichier

- **Date** : 2026-09-28
- **Symptôme** : le téléchargement d'un pack d'assets par ses liens officiels (Quaternius, hébergé
  sur Google Drive) donne un fichier de **2 009 octets**.
- **Diagnostic** : c'est une page HTML « quota exceeded », pas l'archive. En plus, le dossier glTF
  du pack était incomplet (pas de palmiers).
- **Solution** : vérifier la taille et le type d'un fichier téléchargé avant de le brancher.
  Historique : le pack a ensuite été retiré, le jardin est procédural (`../2_maison/2_2_jardin.md`).
- **Source** : récit du thread principal, session jardin du 2026-09-28.

## 2026-09-28 — `find` du panneau navigateur rate un texte qui contient une insécable

- **Date** : 2026-09-28
- **Symptôme** : l'outil `find` du navigateur intégré ne trouve pas un libellé pourtant affiché.
- **Diagnostic** : le texte contient une espace **insécable** avant « : » (typographie française).
  La recherche, tapée avec une espace ordinaire, ne correspond pas.
- **Solution** : contournement proposé, non éprouvé dans le récit : chercher un fragment sans la
  ponctuation (le mot seul), ou lire le DOM par `javascript_tool`.
- **Source** : récit du thread principal, session jardin du 2026-09-28 ; non reproduit ici.

## 2026-10-01 — `node --watch` sous Windows : un redémarrage par fichier, et pas d'arrêt propre

- **Symptôme** : au lancement, ou pendant qu'une session travaille, la console du serveur enchaîne
  les `Restarting 'src/main.ts'` ; la maison réelle (qui tournait sous `npm run dev`) recommence son
  démarrage à chaque fois.
- **Diagnostic** : message du watch **natif** de Node, pas de Kasbah. Expérience isolée (Node 22, un
  script qui importe deux modules) : chaque écriture d'un fichier du graphe d'import déclenche un
  redémarrage complet — cinq écritures à 0,3 s d'intervalle, cinq redémarrages ; aucune option de
  Node ne les regroupe. Le graphe couvre `apps/server` **et** `packages/shared`. Second constat : sous
  Windows l'enfant est **tué net** — son gestionnaire `SIGTERM` n'a jamais écrit sa ligne. Le
  `shutdown()` de `main.ts` (arrêt des plugins, `kasbah.close()`) ne s'exécute donc jamais au
  redémarrage par le watch.
- **Solution** : la maison tourne par `npm run house` (serveur sans watch,
  `../1_architecture/1_0_monorepo-et-flux.md`) ; `npm run dev` reste pour développer. Le démarrage
  lui-même est raccourci par le lancement parallèle des plugins
  (`../1_architecture/1_2_serveur-et-plugins.md`).
- **Source** : session du 2026-10-01, processus serveur inspecté (`node --watch … src/main.ts` sous
  `npm run dev`) et sonde dans le dossier de travail de la session.

- *Complément 2026-10-10 : les relances « au lancement » ne venaient pas d'écritures mais des
  lectures, via l'heure de dernier accès NTFS — voir l'entrée du 2026-10-10. Le watcher qui remplace
  `node --watch` (`scripts/dev-server.mjs`) regroupe aussi une rafale d'écritures en une seule relance ;
  l'arrêt brutal de l'enfant sous Windows, lui, demeure.*

## 2026-10-07 — `sed -i` sous Git Bash convertit un fichier CRLF en LF

- **Date** : 2026-10-07
- **Symptôme** : après un `sed -i` sur `apps/web/src/i18n/locales/fr.json` (copie de travail en CRLF),
  git avertit « LF will be replaced by CRLF » et le fichier n'a plus aucun `\r`.
- **Diagnostic** : le `sed` de Git Bash (msys) lit en mode texte et réécrit le fichier entier en LF,
  pas seulement la ligne touchée.
- **Solution** : modifier ces fichiers par un petit script Node qui normalise en `\n`, remplace, puis
  remet `\r\n` s'il y en avait (`includes('\r\n')`) ; vérifier par `od -c | head` plutôt que par
  `grep -c $'\r'`, qui ne compte rien sous Git Bash. Les sections des fichiers de traduction tiennent
  sur une ligne : les réécrire en sérialisant l'objet (`JSON.stringify` des valeurs), jamais par
  remplacement global de `}` (casse les paramètres `{message}`).
- **Source** : session du 2026-10-07 (assistant).

## 2026-10-08 — Une page `docs/plugins/claude.md` est lue comme un `CLAUDE.md`

- **Date** : 2026-10-08
- **Symptôme** : à la création de la page utilisateur du plugin `claude` sous `docs/plugins/claude.md`,
  Claude Code a aussitôt chargé son contenu comme instructions du projet (« Contents of
  …\docs\plugins\CLAUDE.md »).
- **Diagnostic** : le système de fichiers de Windows ignore la casse : `claude.md` *est* `CLAUDE.md`,
  que Claude Code charge comme instructions pour tout travail dans ce dossier.
- **Solution** : ne jamais nommer un fichier `claude.md` (ni `agents.md`…) ailleurs qu'à sa place
  voulue ; la page s'appelle `docs/plugins/claude-assistant.md`.
- **Source** : session du 2026-10-08 (pages des plugins).

## 2026-10-08 — Python en mode texte change un `\r` isolé en saut de ligne

- **Date** : 2026-10-08
- **Symptôme** : un script Python de remplacement (`open(p).read()`, puis réécriture) a coupé en deux
  une ligne de commentaire de `apps/server/src/plugins/transcription/index.ts` sans y toucher.
- **Diagnostic** : la ligne contenait un vrai retour chariot (une séquence `\r` mal échappée dans
  `VoiceStudio\runtime-location.json`) ; la lecture en mode texte (sauts de ligne universels) le
  traduit en `\n`.
- **Solution** : pour un remplacement exact, lire et écrire en binaire (`open(p, 'rb')`), ou passer
  `newline=''` aussi à la **lecture** ; relire `git diff` pour toute ligne changée hors de la demande.
- **Source** : session du 2026-10-08 (voix des réponses par compte).

## 2026-10-10 — `node --watch` sous Windows : une simple LECTURE relance le serveur

- **Date** : 2026-10-10
- **Symptôme** : au lancement de `npm run dev`, la console du serveur enchaîne plusieurs
  `Restarting 'src/main.ts'` alors que personne n'écrit rien (`git status` propre, aucune autre
  session). Le watch de Node efface la console à chaque relance : le journal du démarrage précédent
  est perdu. Une relance peut aussi survenir dans la journée, quand un outil lit des sources que
  personne n'a lues depuis plus d'une heure (vitest, eslint, un éditeur).
- **Diagnostic** :
  - Sur Windows, libuv abonne `fs.watch` (donc `node --watch`) à **huit** types de notification de
    `ReadDirectoryChangesW`, dont `FILE_NOTIFY_CHANGE_LAST_ACCESS` : une mise à jour de l'heure de
    dernier accès arrive comme un `change`, identique à une écriture
    ([`src/win/fs-event.c`, branche v1.x](https://github.com/libuv/libuv/blob/v1.x/src/win/fs-event.c)).
  - NTFS réécrit cette heure à la **lecture** d'un fichier dont la valeur a plus d'une heure, si la
    mise à jour est active : `fsutil behavior query disablelastaccess` répond `2` (« géré par le
    système, mises à jour ACTIVÉES ») sur le poste de développement.
  - Au premier démarrage après une pause, le serveur lit tous ses modules (`apps/server/src`,
    `packages/*/src`, `node_modules`) : les heures d'accès bougent, les événements arrivent une fois
    les fichiers inscrits au watch, et Node relance. À la relance, tout vient d'être lu, l'heure ne
    bouge plus : la cascade s'éteint après une à trois relances (le chargement se fait par vagues :
    `main.ts`, puis les plugins et leurs dépendances).
  - Sondes de la session : la lecture (`readFileSync`) de trois fichiers de `node_modules/zod` non lus
    depuis la veille a produit trois `change`, mtime inchangé ; une lecture de `packages/shared/src/index.ts`,
    lu le matin même, n'a rien produit. Reproduction : heures d'accès des 360 sources reculées de 2 h
    (`utimes`, mtime conservé), serveur démo sous `node --watch` : **deux** `Restarting` au démarrage,
    aucun sans ce recul — ce qui explique pourquoi les premiers essais de la session ne
    reproduisaient rien.
  - Pourquoi si peu de monde le voit : il faut Windows, un watcher qui croit l'événement sans
    regarder la date de modification (`node --watch` le fait ; chokidar, donc `tsx watch`, compare
    `atime`/`mtime` avant d'émettre), et la mise à jour du dernier accès active sur le volume. Linux
    (inotify) et macOS (FSEvents) ne signalent pas une lecture. `node --watch` n'a aucune option
    d'exclusion, et `--watch-path` surveille alors tout le dossier, ce qui aggrave.
  - Effet de bord à connaître : un plugin qui agit au démarrage refait son action à chaque relance
    (le réveil de charge Renault garde son délai `lastWake` en mémoire, `apps/server/src/plugins/renault/index.ts`).
- **Confirmations trouvées** (recherche du 2026-10-10 ; aucune issue ne vise `node --watch` lui-même,
  et aucune issue libuv ne propose de retirer le drapeau) :
  - [colbymchenry/codegraph#1451](https://github.com/colbymchenry/codegraph/issues/1451) — « File reads
    flagged as edits on Windows (NTFS atime) », Windows 11 : même mécanisme, même règle de l'heure.
    Corrigée le 2026-09-27 en ignorant un événement dont la taille et la date de modification n'ont
    pas bougé (PR #1472 puis #2050), le correctif retenu ici.
  - [samchon/ttsc#1719](https://github.com/samchon/ttsc/issues/1719) — démonstration identique à la
    nôtre (Node 24.18, libuv 1.52.1) : atime reculé, simple `readFileSync`, `change` reçu alors que
    seul `atimeNs` bouge ; une compilation y tournait trois fois au lieu d'une. Ouverte au 2026-10-10.
  - [nodejs/node#21643](https://github.com/nodejs/node/issues/21643) — « fs.watch says every single
    file in my folder changed, randomly » (2018, Windows 10). Un contributeur y désigne déjà
    `FILE_NOTIFY_CHANGE_LAST_ACCESS` ; l'auteur l'a fermée après `fsutil behavior set disablelastaccess 1`,
    sans changement dans Node ni libuv.
  - [remy/nodemon#1208](https://github.com/remy/nodemon/issues/1208) — « Overkill Restarting On File
    Opening » (Windows 10 / 8.1) : relances à la simple ouverture d'un fichier dans l'éditeur, « only
    since the 1803 Window Update » pour l'un ; un autre les fait cesser en coupant la mise à jour du
    dernier accès (`fsutil`). Réglé côté nodemon par une montée de version de chokidar (2019).
- **Solution** : `node --watch` remplacé par un petit watcher maison, `scripts/dev-server.mjs`
  (script `dev` de `apps/server/package.json` : `node ../../scripts/dev-server.mjs`). Il lance
  `node --import tsx --env-file-if-exists=.env src/main.ts`, surveille `apps/server/src` et
  `packages/*/src` (fichiers `.ts`/`.js`, tests exclus), et ne compte un événement que si la date de
  modification ou la taille a changé ; les événements sont regroupés sur 300 ms, une relance cite les
  fichiers en cause, et la console n'est plus effacée. Vérifié : zéro relance au démarrage avec les
  heures d'accès reculées, rien sur une lecture, une seule relance pour trois `touch` d'affilée, aucune
  pour un fichier de test, `npm run dev` complet qui écoute et ne laisse aucun processus orphelin.
  `tsx watch` reste écarté : il bloque toujours sous `concurrently` (re-vérifié ce jour, entrée du
  2026-09-23). L'autre voie, poste par poste, est de couper la mise à jour du dernier accès
  (`fsutil behavior set disablelastaccess 1`, en administrateur) — réglage système, sans effet pour
  les autres clones. Ce qui ne change pas : sous Windows, la relance coupe l'enfant net (`kill()`),
  le `shutdown()` de `main.ts` ne tourne pas — comme sous `node --watch` (entrée du 2026-10-01).
- **Source** : session du 2026-10-10 (sondes `fs.watch` et `utimes` dans le dossier de travail de la
  session, recherche web).
