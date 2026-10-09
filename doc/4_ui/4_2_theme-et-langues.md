# Thème et langues

> Dernière mise à jour : 2026-10-06
> Sources : `apps/web/src/stores/settings.ts`, `apps/web/src/lib/daylight.ts`, `apps/web/src/themes/*.ts`, `apps/web/src/plugins/vuetify.ts`, `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/locales/{fr,en}.json`, `apps/web/src/views/SettingsView.vue`, `apps/web/src/components/PetkitLinkCard.vue`

## Apparence

Trois modes : `light`, `dark`, `system` (suit `prefers-color-scheme` via `usePreferredDark`). Quatre
accents. Le thème Vuetify effectif est `${accent}${Light|Dark}` (8 thèmes statiques dérivés des
jetons dans `plugins/vuetify.ts`). `applyToVuetify` est appelé **avant le mount** et à chaque
changement : `theme.change(name)` + `data-theme` + variables `--accent*` + `color-scheme`.

> Les **quatre accents** décrits ci-dessus ont été remplacés le 2026-09-12 par six thèmes nommés
> (commit `abf88f5`) : voir la mise à jour en bas de page. Le reste du mécanisme (trois modes,
> `applyToVuetify` avant le mount, nom de thème `${id}${Light|Dark}`) est inchangé.

> Les **trois modes** sont devenus **quatre** le 2026-09-16 : `auto` suit le soleil au-dessus de la
> maison. Voir la mise à jour en bas de page.

La scène 3D relit les variables `--v-theme-*` après `nextTick` (les nouvelles valeurs CSS doivent être
appliquées avant lecture) et mute ses matériaux.

## Persistance

`localStorage` : `kasbah.appearance`, `kasbah.accent` (devenue `kasbah.theme` le 2026-09-12),
`kasbah.locale` (`''` = automatique).

## Langues

vue-i18n 11 en mode Composition, `fr` et `en` importés statiquement (petit volume), repli `en`.
Détection : choix explicite, sinon `navigator.languages`. `document.documentElement.lang` suit.
Pluriels via la syntaxe `a | b | c` (`summary.lightsOn`, `home.devicesCount`). Formats numériques
locaux dans `lib/format.ts` (`Intl.NumberFormat`) : puissance (W/kW), énergie (Wh/kWh), température,
pourcentage, distance.

Hors composants (stores, erreurs), utiliser `t()` exporté par `i18n/index.ts`.

**Règle** : `fr.json` et `en.json` doivent avoir exactement les mêmes clés — test
`lib/lib.test.ts › i18n locales`.

### Mise à jour 2026-09-08 — ce qui n'est PAS une préférence de tablette

Le démarrage automatique de l'animation d'une ambiance a d'abord été ajouté ici comme quatrième
préférence persistée (`kasbah.sceneAutoDynamic`), puis **retiré le même jour** : ce réglage existe
déjà chez le fabricant (`auto_dynamic` d'une scène Hue), et le dupliquer côté navigateur donnait deux
valeurs pour une même question — donc un comportement ambigu selon l'app utilisée. Il s'écrit
maintenant sur le pont (`PATCH /api/scenes/:id`, cf. `../1_architecture/1_3_protocole-rest-ws.md`)
et l'écran Réglages le présente scène par scène.

**Critère à garder** : une préférence va dans le `localStorage` du navigateur si elle ne concerne
que cet écran (apparence, accent, langue, plein écran). Sinon elle appartient à la source de vérité
commune : **le fabricant** pour un réglage d'appareil ou de scène, **le serveur** pour un réglage de
plugin (`pluginSettingsSchema`, persisté — cf. `../1_architecture/1_2_serveur-et-plugins.md`),
`house.json` pour une propriété de la maison. Un réglage rangé côté navigateur alors qu'un autre
logiciel a un avis dessus produit deux valeurs pour une même question, donc un comportement qui
dépend de l'app utilisée.

*(Constat du lint du 2026-10-06 : il n'y a plus d'accent séparé — le thème (`kasbah.theme`, `apps/web/src/stores/settings.ts`) porte toute la palette depuis le 2026-09-12, voir « Mise à jour 2026-09-12 — les quatre accents deviennent six thèmes nommés » plus bas.)*

### Mise à jour 2026-09-08 — section `rooms.*` pour les libellés partagés par deux vues

L'extraction de `RoomBands.vue` (voir `4_1_navigation-et-panneaux.md`) a sorti de `lights.*` les
clés qui ne parlent plus des lampes : `noRoom`, `notInHouse`, `reorder`, `orderError`, `dangling`,
`danglingHint` et l'objet `origins` vivent maintenant sous **`rooms.*`**. `lights.*` ne garde que
`summary` et `none`, et `covers.*` porte les siennes. `stores/house.ts` cite `rooms.orderError`.

Deux règles que cette bascule a mises en évidence :

- une clé nommée d'après **une vue** finit mal dès qu'un second écran réutilise le composant ; la
  nommer d'après **le concept** (ici la pièce) évite la migration suivante ;
- le **genre grammatical** est un piège d'i18n en français : un libellé écrit pour « une lampe »
  (« Placée ») devient faux pour « un ouvrant ». Préférer une formulation neutre à une duplication
  des traductions par genre — d'où « Dans le plan » / « Hors plan ».

Les deux fichiers de locale sont **écrits à la main en style compact** (objets courts sur une seule
ligne). Les régénérer avec un `json.dumps`/`JSON.stringify` reformate les 400 lignes et noie la
revue : éditer le texte, et vérifier la parité des clés fr/en après coup.


### Mise à jour 2026-09-08 — `cover.*` scindé en deux vocabulaires

`cover` ne porte plus des libellés à plat mais **deux blocs frères** de mêmes clés :
`cover.openClose.{open,closed,opening,closing,level,actionOpen,actionClose}` et `cover.upDown.{…}`.
Le code ne choisit jamais un libellé, il choisit un **préfixe** (`coverWords()`, voir
`4_1_navigation-et-panneaux.md`) et interpole `cover.<vocabulaire>.actionClose`, qui donne « Fermer » ou
« Baisser ». Ajouter un vocabulaire (un portail qui « s'ouvre » et se « referme » ?) est donc un bloc
de plus, sans toucher aux composants.

Effets de bord de cette scission, tous deux vérifiés après coup : `common.open` et `common.closeCover`
sont devenus orphelins et ont été retirés ; et un remplacement de chaîne à l'aveugle dans les deux
locales avait supprimé `cover.openClose.open` côté anglais tout en laissant `common.closeCover` côté
français. **Vérifier la parité des clés fr/en est ce qui l'a détecté** — un diff de 9 lignes de part
et d'autre, à comparer aux 356 lignes d'une régénération automatique.

Nouvelles clés de résumé : `summary.shuttersOpen`, `summary.awningsDown` (pluriels), et
`home.awningsDown` pour la tuile. `common.unknown`, qui existait déjà, sert désormais à un ouvrant
sans position connue.

### Mise à jour 2026-09-08 — `cover.preset` hors des deux vocabulaires

`cover.preset` (« Position perso ») et `cover.presetAt` (« Position perso — {pct} ») sont posées au
niveau de `cover`, à côté de `tilt` et `stopped`, et **non** dans `openClose` / `upDown` : la
formulation est la même pour un volet et pour un store, et la dupliquer aurait créé deux clés à
maintenir pour un seul libellé. La règle qui s'en dégage : ne descendre une clé dans un vocabulaire
que si les mots y diffèrent vraiment.

### Mise à jour 2026-09-09 — deux clés pour la reprogrammation

`cover.presetSave` (« Mémoriser cette position ») et `cover.presetSaved` (« Position perso
mémorisée : {pct} », le toast de confirmation) rejoignent `cover.preset` au même niveau, pour la même
raison : les mots ne changent pas d'un volet à un store. Le `{pct}` du toast est **formaté par
`formatPercent` côté appelant**, pas interpolé brut — sinon le séparateur décimal et l'espace avant
le `%` ne suivraient pas la locale.

### Mise à jour 2026-09-12 — les quatre accents deviennent six thèmes nommés

Demande de l'utilisateur : « concernant le théming je souhaiterais plutôt qu'on intègre une série de
thèmes connus et qu'on puisse select celui qu'on souhaite. Faire en sorte de pouvoir facilement en
ajouter. » Les quatre accents ne changeaient que la couleur **primaire** par-dessus des jetons
neutres communs ; un thème connu ne se reconnaît pas à son accent mais à son fond, ses surfaces et
son texte. Le réglage « Couleur d'accent » est donc **remplacé** par un réglage « Thème » qui porte
toute la palette. Commit `abf88f5`.

**Registre** : `apps/web/src/themes/`, un fichier par thème.

| Thème | Clair | Sombre |
|---|---|---|
| Kasbah (défaut) | palette d'origine, accent lagon | palette d'origine, accent lagon |
| Catppuccin | Latte | Mocha |
| Dracula | Alucard | Dracula |
| Night Owl | Light Owl | Night Owl |
| Synthwave '84 | — | Neon Dream |
| Tokyo Night | Day | Night |

Les déclinaisons claires ne s'inventent pas : **Mocha est la variante sombre** de Catppuccin (le
clair officiel est Latte), et Dracula, Night Owl, Tokyo Night ont chacun leur pendant publié
(Alucard, Light Owl, Day). Valeurs relevées chez leurs auteurs (`draculatheme.com/spec`, les JSON
VS Code de Night Owl et Synthwave '84, `tokyonight.nvim`).

**Ce qu'un thème déclare** : 15 couleurs par variante — `bg`, `surface`, `surface2`, `bright`,
`text`, `muted`, `accent`, `error` / `warning` / `info` / `success`, et les quatre teintes de
catégorie `catLight` / `catCover` / `catCamera` / `catMedia` (cf. `4_0_langage-visuel.md`). Rien
d'autre : `--line` (le texte à 8-9 %), `--shadow`, `--accent-soft` et `--on-accent` sont **dérivés**
dans `themes/index.ts`. Le texte posé sur l'accent est choisi par **contraste WCAG** entre le blanc
et le fond du thème plutôt que déclaré — un thème ajouté demain ne peut pas se tromper de sens.

**Ajouter un thème** : créer `src/themes/<id>.ts` sur le modèle des autres, l'ajouter à `REGISTRY`
dans `themes/index.ts`. Les thèmes Vuetify (`plugins/vuetify.ts`), les jetons CSS (`cssVars`), le
sélecteur des Réglages et les tests s'en dérivent. `REGISTRY` garde les identifiants littéraux (d'où
le type `ThemeId`), `THEME_LIST` les élargit pour l'itération.

**Apparence et thème sont deux réglages distincts.** `wantDark` dit ce que le navigateur demande
(clair / sombre / système) ; `resolveVariant(id, wantDark)` rend la variante réellement appliquée.
Un thème qui n'a pas la variante demandée **impose la sienne** : en apparence « Clair », Synthwave
'84 passe l'interface en sombre, plutôt que d'inventer une palette claire qui ne serait plus le
thème. `isDark` du store découle donc du thème, pas seulement de l'apparence.

**Persistance** : `kasbah.theme` remplace `kasbah.accent`. Aucune migration — l'ancienne clé est
ignorée et tout le monde repart sur « Kasbah », qui reprend exactement l'ancienne palette avec
l'accent lagon (la maquette de référence n'est pas perdue).

**Clés i18n** : `settings.theme` et `settings.themeDarkOnly` remplacent `settings.accent` et
`settings.accents.*`. Les **noms de thèmes ne sont pas traduits** : ce sont des noms propres, ils
vivent dans le registre (`label`, `lightLabel`, `darkLabel`) et non dans les locales.

**Deux compromis assumés**, tous deux à une ligne de distance si l'avis change :

- le `muted` de Dracula (`#6272a4`) et de Light Owl (`#989fb1`) est la vraie couleur de commentaire
  de ces thèmes, mais elle tombe à ≈ 2,6-2,9:1 sur la surface, là où ce jeton porte de l'info réelle
  (sous-titres d'appareils). L'authenticité l'a emporté ; là où l'auteur publie un **second
  plan de texte** (Catppuccin `subtext0`, Tokyo Night `fg_dark`), c'est lui qui est pris ;
- les paliers de surface d'**Alucard** sont des nuances crème voisines : la spec officielle ne
  publie que le fond de l'éditeur (`#FFFBEB`).

> Le premier compromis (authenticité du `muted` de Dracula et Light Owl) est **abandonné le
> 2026-09-29** : voir la section « Contraste AA du texte secondaire » plus bas.

Garde-fous : `src/themes/themes.test.ts` — identifiants uniques, défaut existant, 15 rôles présents
et valides par variante, `resolveVariant` qui rend toujours une palette, contraste ≥ 3:1 sur
l'accent et ≥ 4,5:1 du texte sur la surface, et la liste des jetons CSS alignée sur `tokens.css`.

### Mise à jour 2026-09-12 — `cover.classes.*`, et les clés du placement

`cover.classes.{shutter,awning,blind,curtain,gate,garage,window}` nomme la **nature** d'un ouvrant
telle que le fabricant la déclare (`meta.cover.deviceClass`) : « Volet », « Store banne », « Portail »,
« Porte de garage »… Elle sert au sous-titre du panneau appareil, sur le modèle de `media.classes.*`.
Distincte des deux **vocabulaires** (`cover.openClose` / `cover.upDown`), qui disent l'action et l'état
et se choisissent par la même liste de natures : l'une nomme l'objet, les autres le conjuguent.

`kinds.cover` devient « **Ouvrant** » (en. « Cover ») au lieu de « Volet » : ce n'est plus qu'un repli
quand la nature est inconnue, et il doit alors couvrir volets, stores et portails.

Section `place.*` : `place.height` devient « **Hauteur de pose** » (elle cohabite avec la hauteur d'un
portail), et s'ajoutent `place.size.{width,height,projection}` (« Largeur », « Hauteur », « Avancée »),
`place.smaller` / `place.bigger` et `place.leaves` (« Battants »). Enfin `lights.all` et `covers.all`
nomment les interrupteurs maîtres des en-têtes de vue, et `rooms.brightness` le curseur de luminosité
d'une pièce — un contrôle sans appareil nommé à côté de lui a besoin d'un libellé accessible.

### Mise à jour 2026-09-12 (bis) — `home.roomsCount`

`home.roomsCount` (« {n} pièce | {n} pièces », en. « {n} room | {n} rooms ») compte les pièces d'un
niveau dans le sous-titre de son panneau, à côté de `home.devicesCount` qui compte ses appareils
(`4_1_navigation-et-panneaux.md`). Même forme pluralisée que les autres compteurs, y compris
la branche zéro que vue-i18n réclame en premier.


### Mise à jour 2026-09-12 (ter) — section `arrays.*`

Les champs de panneaux (`../1_architecture/1_5_scene-3d.md`, `4_1_navigation-et-panneaux.md`)
apportent une section : titre et actions (`title`, `add`, `addHint`, `edit`, `done`, `none`), réglages
(`rows`, `cols`, `height`, `slope`, `tilt`, `module`, `portrait`, `landscape`) avec leurs infobulles
(`heightHint`, `slopeHint`, `tiltHint`, `azimuthHint`), onduleurs (`inverters`, `freeCount`,
`slotNone`, `slot`, `cell`), et le retrait (`remove`, `removeConfirm`, `removeHint`). `place.*` gagne
`removeWithArrays`, au pluriel à trois formes comme `home.roomsCount`.

Deux clés servent AUSSI de noms d'objets dans la scène 3D : `arrays.field` (« Champ {n} », écrit dans
le JSON à la création) et `arrays.slot` (« Emplacement {r}-{c} », le nom d'un module sans onduleur).
Ce dernier est fabriqué côté app — le paquet partagé ne parle aucune langue — et le calcul dépend donc
de la langue : la maison dérivée relit `i18n.global.locale` pour se refaire quand elle change
(`apps/web/src/stores/house.ts`).

### Mise à jour 2026-09-13 — les clés des onduleurs

`arrays.*` gagne `peak` / `peakHint` (puissance crête d'un module) et `maxOutput` / `maxOutputHint`
(puissance de sortie maximale de l'onduleur — libellé court « Puissance onduleur » / « Inverter
power », le terme complet des fiches techniques restant dans l'infobulle, faute de tenir sur une
ligne du panneau).

`energy.*` gagne `maxReported` (« Record » : ce qu'un onduleur a déjà sorti, cf.
`SensorState.maxValue`), `invertersLoose` (« Hors champ ») et `noSlot` (« Aucun emplacement »), qui
nomment la carte des onduleurs qu'aucun champ de panneaux ne porte. Sources :
`apps/web/src/i18n/locales/{fr,en}.json`.


### Mise à jour 2026-09-13 — clés `vehicle.*` et `settings.tesla.*`

Section `vehicle` : `sleep.{online,asleep,offline}` (« Éveillé », « En veille », « Hors ligne »),
`wake` / `wakeHint` (le réveil est un geste qui coûte, le texte le dit), `movement`, `moving`,
`parked`, `gear.{P,R,N,D}`, `tires` et `tire.{fl,fr,rl,rr}` (« AV G », « AV D », « AR G », « AR D » —
« FL », « FR », « RL », « RR » en anglais), `temps`, `inside`, `outside`.

Section `settings.tesla` : les trois pas de la carte (`keyStep`, `registerStep`, `linkStep`), leurs
boutons et états (`copyKey` / `copied`, `register` / `registering` / `registered` / `notRegistered`
/ `unverified`, `link` / `opened` / `refresh` / `linked` pluralisé), `notConfigured` (avec la
redirection à déclarer), `noDomain`, `budget`, `notStored`, et la rotation de clé en deux temps
(`rotate`, `rotateConfirm`, `rotated`). Piège vécu en insérant les clés anglaises par script : deux
sections (`enphase`, `tesla`) ont une clé `notStored` dont le texte anglais commence pareil (« No
token file… ») — ancrer sur la variable citée (`TESLA_TOKEN_FILE`), pas sur le début du texte. Le
test de parité fr/en (`apps/web/src/lib/lib.test.ts`) l'a attrapé. Sources :
`apps/web/src/i18n/locales/{fr,en}.json`.


### Mise à jour 2026-09-14 — `vehicle.readAt`, `neverRead`, `refresh*`

`vehicle.readAt` (« Lu {ago} », l'âge vient d'`Intl.RelativeTimeFormat` dans la langue courante :
« il y a 12 min », « maintenant » / « 12 min. ago », « now »), `vehicle.neverRead`, `vehicle.refresh`,
`vehicle.refreshing`, `vehicle.refreshHint` (une lecture facturée, le sondage repart de là).


### Mise à jour 2026-09-14 — `vehicle.map.*`

`vehicle.map.plan`, `.satellite`, `.fullscreen`, `.close`, `.recenter`, `.noPosition` : les boutons et
le voile de la carte du véhicule. `vehicle.mapPlaceholder` n'est plus affiché (la carte a remplacé la
ligne) mais reste dans les fichiers.


### Mise à jour 2026-09-14 — `vehicle.refreshing` retirée

La clé « Actualisation… » n'existe plus : le libellé du bouton ne change plus pendant l'attente (il
changeait sa largeur), c'est un spinner qui remplace son icône. Voir
`4_1_navigation-et-panneaux.md`.


### Mise à jour 2026-09-14 — clés du quota (`vehicle.quota*`), et une clé en double corrigée

`vehicle.quota` (« {used}/{limit} {what} ») compose la ligne de la jauge, `vehicle.quotaSince`
(« depuis le {date} ») la date le cycle, et `vehicle.quotaCredit` (« de crédit Tesla » / « of Tesla
credit ») est ce que le plugin Tesla NOMME par sa `labelKey`. Les sommes et la date sont mises en
forme par la vue (`Intl`), jamais par le serveur : lui ne connaît pas la langue du navigateur.

Corrigé au passage : la section `vehicle` portait **deux fois** la clé `map`, introduite la veille en
rejouant un script d'insertion non idempotent. `JSON.parse` garde la dernière et le test de parité
fr/en n'y voyait rien — d'où deux leçons : un script qui insère dans un JSON doit d'abord retirer ce
qu'il s'apprête à écrire, et une clé en double ne se voit qu'à la lecture du fichier.


### Mise à jour 2026-09-14 — clés de la carte véhicule : charge détaillée et réglages

Onze clés `vehicle.*` pour la carte d'un véhicule (fr et en) :

- `charge` (titre de la case, « Charge »), distinct de `charging` (« En charge », une valeur) ;
- `chargeEta` (« fin dans {time} »), `chargeTarget` (« cible {percent} »), `chargeEstimated`
  (« ~{power} estimé » / « ~{power} est. ») — les trois morceaux de la ligne sous la jauge ;
- `targetMark` / `floorMark`, infobulles des repères de la jauge ;
- `tune` (« Régler »), `offset`, `offsetX`, `offsetY`, `capacity`, `capacityHint` pour le dépliant
  de réglages.

`capacityHint` porte le POURQUOI, pas le comment : « Aucun constructeur ne donne la capacité de sa
batterie. Elle ne sert qu'à estimer la puissance de charge d'un véhicule qui ne la dit pas. » Un
champ dont personne ne devine l'usage vaut une phrase.

Côté formats, `lib/format.ts` gagne `formatMinutes` : « 45 min » sous l'heure, « 1 h 20 » au-delà.
Écrit à la main plutôt que par `Intl.DurationFormat`, encore trop récent pour le navigateur visé.

Sources : `apps/web/src/i18n/locales/{fr,en}.json`, `apps/web/src/lib/format.ts`,
`apps/web/src/views/VehiclesView.vue`.

### Mise à jour 2026-09-14 — `vehicle.rotation`

Une clé de plus dans le dépliant de réglages : `vehicle.rotation` (« Rotation (°) » / « Rotation (°) »),
à côté de `offset`, `offsetX`, `offsetY`, `capacity` et `capacityHint`. L'unité est dans le libellé,
comme pour `offset` (« Décalage 3D (m) ») : la ligne n'a pas de place pour un suffixe, et le champ
est un nombre nu.

Les infobulles `targetMark` / `floorMark` servent maintenant DEUX surfaces — la carte de la vue
Véhicules et la jauge du panneau 3D (cf. `4_1_navigation-et-panneaux.md`).

Sources : `apps/web/src/i18n/locales/{fr,en}.json`,
`apps/web/src/components/vehicles/VehicleTuning.vue`,
`apps/web/src/components/controls/VehicleCard.vue`.

### Mise à jour 2026-09-15 — trois réglages de RENDU, qui ne suivent pas le thème

Le thème de l'application décidait jusqu'ici de l'apparence de la scène 3D : clair = jour, sombre =
nuit. Demande de l'utilisateur : « le mode light/dark de l'app ne doit pas forcément impliquer que la
maison est sombre/claire ; le mode de l'app est une chose, pour la maison c'est en fonction de la
position gps, du soleil, de la météo ». Trois préférences nouvelles, persistées comme les autres
(`localStorage`, préfixe `kasbah.`), et **aucune ne suit clair/sombre** :

| Clé | Valeurs | Ce qu'elle décide |
|---|---|---|
| `kasbah.sceneStyle` | `realistic` (défaut), `nature`, `indigo`, `maquette`, `cyberpunk`, `candy` (depuis le 2026-09-15), `haunted` (depuis le 2026-09-23) | le goût du rendu (`three/styles/`) |
| `kasbah.sceneAmbience` | `auto` (défaut), `day`, `dusk`, `night` | l'heure qu'il fait au-dessus de la maison |
| `kasbah.sceneQuality` | `auto` (défaut), `high`, `medium`, `low` | le budget du post-traitement |
| `kasbah.sceneAssets` | `true` (défaut), `false` — depuis le 2026-09-15 | matières en images (pack photo du style) plutôt que procédurales, pour les styles qui en portent un |
| `kasbah.sceneProjection` | `perspective` (défaut), `ortho`, `iso` — depuis le 2026-09-18 | comment la maison est projetée : fuite, à plat, ou isométrie aux angles verrouillés |

> Mis à jour le 2026-10-06 (lint) : `kasbah.sceneStyle` accepte les 13 styles de `RENDER_STYLES` (`apps/web/src/three/styles/index.ts`) : `realistic` (défaut), `nature`, `indigo`, `maquette`, `cyberpunk`, `candy`, `haunted`, `disco`, `halloween`, `noel`, `tatooine`, `akira`, `girlyversaire`. Un id inconnu est refusé par `setSceneStyle`.

`auto` pour l'ambiance calcule la position réelle du soleil à partir de l'origine GPS de la maison et
de l'horloge — sans réseau (`three/core/sun.ts`, voir `../1_architecture/1_5_scene-3d.md`). Chaque
valeur est validée à l'écriture (`setSceneStyle` / `setSceneAmbience` / `setSceneQuality`) ; la lecture
est protégée elle aussi, un mode inconnu écrit à la main ne doit pas noircir la scène
(`../6_faq/6_1_pieges-runtime.md`).

**i18n** : section `render.*` (et non `scene.*`, le mot « scène » ayant déjà trois sens dans le
projet — voir le glossaire) : `render.title`, `render.style`, `render.styles.<id>`,
`render.ambience` / `.ambienceHint` / `.ambiences.<mode>`, `render.quality` / `.qualityHint` /
`.qualities.<niveau>`. Un style porte sa propre clé (`RenderStyle.labelKey`) : en ajouter un ne
demande que deux lignes de traduction.

### Mise à jour 2026-09-15 — le switch « Matières en images » sous les styles

Quatrième réglage de rendu, `kasbah.sceneAssets` (défaut `true`), demandé par l'utilisateur « pour
ne pas perdre ce qui a été fait en procédural ». Dans Réglages → Rendu 3D, un `v-switch` juste sous
la grille des styles (`views/SettingsView.vue`, `styleHasAssets`) : **grisé** quand le style courant
ne déclare pas de pack (`RenderStyle.assets`, voir `../1_architecture/1_5_scene-3d.md`), et son
libellé secondaire bascule alors sur `render.assetsNone`. Clés : `render.assets`, `render.assetsHint`,
`render.assetsNone`. Le store expose `sceneAssets` / `setSceneAssets`, et `useHouseScene` le passe à
`setAppearance({ assets })` au montage puis à chaque changement. Libellés des deux styles ajoutés :
`render.styles.indigo` (« Indigo »), `render.styles.maquette` (« Maquette » / « Model »).

Sources : `apps/web/src/stores/settings.ts`, `apps/web/src/i18n/locales/{fr,en}.json`,
`apps/web/src/three/styles/index.ts`.

### Mise à jour 2026-09-16 — les clés des sections de plugin

La carte Plugins des Réglages devient une liste de sections dépliables (voir
`4_1_navigation-et-panneaux.md`), et chaque carte de mise en route gagne son état « déjà lié » :

- `settings.pluginDetails` — infobulle du chevron de dépliage ;
- `settings.hue.paired` / `.repair` / `.repairHint` — le pont apparié, et le réappairage (qui redonne
  une clé à recopier dans `.env`, ce que dit le texte d'aide) ;
- `settings.nest.linked` / `.relink` / `.relinkHint` — le compte lié, et la re-liaison qui sert à
  changer les caméras partagées ;
- `settings.enphase.paired` — la passerelle appairée, à la place de `settings.enphase.intro` quand il
  n'y a rien à faire ;
- `settings.enphase.cloudLinked` / `.cloudLinkedNoFile` / `.cloudNeeded` — la session Enlighten
  (borne), distincte du jeton local : coller un JWT n'ouvre pas le cloud.

`settings.noKeys` (« aucune clé ») est **supprimée** des deux locales : la ligne des clés `.env` ne
s'affiche plus que lorsque le plugin en lit.

Sources : `apps/web/src/i18n/locales/{fr,en}.json`, `apps/web/src/components/settings/PluginSection.vue`.

### Mise à jour 2026-09-16 — météo forcée dans la scène (débogage)

Trois réglages de plus dans le store (`kasbah.sceneWeather`, `kasbah.sceneCloudCover`,
`kasbah.sceneVisibilityM`), montrés dans Réglages → Rendu 3D **seulement quand le débogage est
activé**, et appliqués **à la scène seule** : le widget et la vue Météo continuent de dire le vrai
temps. `sceneWeather` vaut `real` (suivre la météo) ou l'une des neuf conditions du contrat ; en
`real`, les curseurs de nébulosité et de visibilité sont grisés. La visibilité se règle par
**paliers** (100 m → 50 km), pas au mètre : un curseur linéaire mettrait tout le brouillard sur un
pixel. `useHouseScene` remplace alors l'entrée météo de `resolveAmbience` par ces valeurs ; couper
le débogage rend la vraie météo sans toucher au choix mémorisé. Le voile de débogage est remonté
au-dessus du widget météo, qu'il recouvrait.

Sources : `apps/web/src/stores/settings.ts`, `apps/web/src/views/SettingsView.vue`,
`apps/web/src/composables/useHouseScene.ts`, `apps/web/src/components/home/SceneDebug.vue`.

### Mise à jour 2026-09-16 — quatrième apparence : « Auto », qui suit le soleil

`APPEARANCES` passe à `['light', 'dark', 'system', 'auto']`. Les deux derniers sont automatiques mais
ne regardent pas la même chose, et c'est TOUT l'intérêt de les garder côte à côte :

- `system` suit **l'appareil qui regarde** (`prefers-color-scheme`, `usePreferredDark`) ;
- `auto` suit **le soleil au-dessus de la maison**, quel que soit l'appareil.

**La règle** : sombre une demi-heure AVANT le coucher, clair une demi-heure APRÈS le lever — le
crépuscule civil, le moment où la pièce s'assombrit alors que le soleil est encore là (demande de
l'utilisateur ; basculer au ras de l'horizon rallume l'interface en plein jour finissant).

**Trois sources, en cascade** (`lib/daylight.ts`, fonction pure `isDaylight`, testée dans
`lib/lib.test.ts`) — chacune ne sert que si la précédente manque :

1. `sunrise` / `sunset` publiés par l'appareil `weather` (Open-Meteo les donne pour le lieu exact,
   réfraction comprise), lus par `useWeather()` ;
2. sinon le soleil **calculé sur place** depuis `site.origin` — `sunPosition()` de
   `three/core/sun.ts`, déjà écrit pour la scène 3D, aucun réseau ;
3. sinon la **journée type 7 h - 21 h** d'`approximateSunPosition()` : le défaut, qui n'est écrit
   qu'à cet endroit-là du dépôt.

Les deux dernières ne donnent pas des heures mais une **hauteur** : la demi-heure s'y exprime en
**5° au-dessus de l'horizon**. Le décalage demandé est asymétrique dans le temps (après le lever,
avant le coucher) mais **symétrique en hauteur** — le soleil est aussi haut d'un côté que de l'autre
— d'où une seule constante `DAY_ALTITUDE_DEG` pour les deux bords de la journée. Mesuré le 21 juin à
Dijon : 5° tombe à 37 min du coucher, et à 4,3° vingt minutes après le lever.

**L'horloge** : un `ref` dans le store, battu à la minute par `useIntervalFn`. Les trois autres modes
ne le LISENT pas — le `computed` ne s'y abonne donc pas, et rien ne recalcule chez eux.

**Libellé** : clé dédiée `settings.appearanceAuto` (« Auto » dans les deux langues), et **pas** la
clé `settings.auto` (« Automatique ») que porte le segmenté de la langue. Raison mesurée : le mot
entier poussait le min-content de la pile gauche des Réglages de 344 à **417 px**, ce qui volait
73 px à la piste centrale au-delà de 1500 px (voir `4_1_navigation-et-panneaux.md`) ; « Auto » la
laisse à 363 px et la grille reste en 1-2-1. Une ligne d'aide permanente sous le segmenté
(`settings.appearanceHint`) dit lequel des deux modes suit quoi — sans elle, « Système » et « Auto »
se ressemblent trop. Elle ne parle pas de « tablette » : l'app se regarde aussi depuis un téléphone
ou un ordinateur.

**Ce que ça ne change pas** : l'apparence de l'app et l'**ambiance de la scène 3D** restent deux
réglages séparés (`three/core/ambience.ts`, `../1_architecture/1_5_scene-3d.md`). Les deux savent
suivre le soleil, mais chacun garde son choix : une maison en plein soleil derrière une interface
sombre reste un état normal.

Vérifié dans l'app (simulation in-process) : à 15 h 45 « Auto » donne le clair ; l'horloge de la page
poussée à 03 h 48, l'interface est passée d'elle-même en sombre au tic suivant, sans intervention.

Sources : `apps/web/src/lib/daylight.ts`, `apps/web/src/stores/settings.ts`,
`apps/web/src/views/SettingsView.vue`, `apps/web/src/components/layout/NavRail.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-17 — `householdSize`, les clés `water.*`, et deux mots à ne plus écrire

**`kasbah.householdSize`** rejoint le store `settings` (1 à 10, défaut **3**, bornes exportées en
`HOUSEHOLD_SIZE_MIN` / `HOUSEHOLD_SIZE_MAX`). Il ne sert qu'à placer le repère de moyenne française
sur le graphique d'eau. **Il n'a rien à faire dans `house.json`** : c'est une préférence
d'affichage du navigateur, au même titre que les réglages de rendu — la maison décrit des murs et
des appareils, pas ses occupants. Même frontière que celle posée le 2026-09-08 plus haut.

Clés ajoutées sous `water.*` : `period.*`, `consumptionTotal`, `noReading`, `consumptionEmpty.*`
(un message par série), `chartSummary`, `measuredFragment.*`, `measuredNote`, `household*`,
`referenceLegend`, `referenceHint`, `referenceMark`.

**Piège vue-i18n : un champ nommé `count` ou `n` dans l'objet interpolé écrase silencieusement le
nombre qui pilote l'accord.** `getPluralIndex` préfère `named.count` / `named.n` au troisième
argument de `t()`. Le résumé du graphique passait `{count}` pour le **nombre de colonnes** et
`measuredCount` en troisième argument : l'accord suivait 24 au lieu de 1, d'où « 1 pas mesurés sur
24 ». **Aucune erreur, aucun avertissement, aucune trace en console.** Correctif : renommer le champ
(`{steps}` ici). À retenir : dans un message **pluralisé**, `count` et `n` sont des noms réservés.
Ils restent sans danger sur un message qui ne l'est pas — `referenceLegend` utilise `{n}` pour le
nombre de personnes sans aucune conséquence, faute de variantes séparées par `|`.

**Vocabulaire : ne pas écrire « pas » au sens d'intervalle dans l'interface française.** Le libellé
« 9/12 pas mesurés » se lit spontanément comme une négation — « neuf douzièmes ne sont **pas**
mesurés » — alors qu'il voulait dire « neuf pas de temps sur douze ont été mesurés », c'est-à-dire
exactement l'inverse. Le mot entre en collision avec l'adverbe, et aucun contexte ne le rattrape.
Remplacé par **l'unité réelle du pas** : `water.measuredFragment.hours` / `.days` / `.months`
(« 9 mois sur 12 mesurés »), injectée comme `{fragment}` dans `measuredNote` et `chartSummary`.
La règle vaut pour toute l'interface, pas seulement pour ce graphique.

### Mise à jour 2026-09-17 (bis) — la section `search.*`, et un `n` qui ne vole rien

Neuf clés pour la barre de recherche de la vue Maison
(`4_1_navigation-et-panneaux.md`) : `search.placeholder`, `.aria`, `.clear`, `.empty`,
`.count`, puis les quatre sous-titres de famille `search.level` / `.room` / `.scene` / `.page`.
Les autres sous-titres sont **empruntés** plutôt que redéclarés — `home.garden` pour une zone,
`rooms.origins.unplaced` pour un appareil que la maison ne place pas — parce qu'ils nomment les
mêmes choses ailleurs dans l'interface et doivent en changer en même temps.

Deux points de rédaction :

- **Le texte indicatif est une contrainte de layout.** « Rechercher une pièce, un appareil… »
  mesure 227,5 px, et le champ tombe à 180 px d'`input` en fenêtre étroite. C'est le CSS qui
  encaisse (`text-overflow: ellipsis` sur le champ, voir la page navigation) et non le libellé
  qu'on raccourcit — mais la marge est mince, et un libellé allemand ou une traduction plus longue
  la consommeraient.
- **`search.count` passe `n` ET le troisième argument** :
  `$t('search.count', { n: results.length }, results.length)`. Le piège consigné plus haut — un
  champ nommé `count` ou `n` écrase le nombre qui pilote l'accord — **ne mord pas ici parce que les
  deux valeurs sont la même**. C'est la bonne façon de s'en servir : si l'interpolé et le pluriel
  doivent différer, c'est l'interpolé qu'il faut renommer, jamais l'inverse. Accord vérifié à
  0 / 1 / 5 résultats (« 0 résultat », « 1 résultat », « 5 résultats »).

Sources : `apps/web/src/i18n/locales/{fr,en}.json`, `apps/web/src/components/home/SearchBar.vue`.

### Mise à jour 2026-09-18 — les gestes d'ensemble se nomment, et un compte par nature d'ouvrant

Les en-têtes des vues Lumières et Ouvrants passent de l'interrupteur à deux gestes nommés (voir
`4_1_navigation-et-panneaux.md`), d'où quatre clés d'action : `lights.allOff` / `lights.allOn`
(« Tout éteindre » / « Tout allumer ») et `covers.allClose` / `covers.allOpen` (« Tout fermer » /
« Tout ouvrir »). `lights.all` et `covers.all` restent, mais comme **étiquette du groupe** pour les
lecteurs d'écran, plus comme infobulle d'un interrupteur.

`covers.summary` (« {open} ouverts sur {total} ») disparaît au profit de **`covers.counts.*`, une
clé par nature d'ouvrant** : `shutter`, `blind`, `awning`, `curtain`, `window`, `gate`, `garage` et
un `other` de repli. Chacune porte son propre accord, parce que le français ne le donne pas
gratuitement : « {n} volet ouvert » mais « {n} porte de garage ouverte », « {n} fenêtre ouverte ».
Le genre et le mot d'état sont donc **dans la traduction**, jamais recomposés en code.

Ces clés s'appellent avec le **seul troisième argument** — `t('covers.counts.shutter', n)` — et rien
d'interpolé : vue-i18n remplit `{n}` tout seul à partir du nombre qui pilote l'accord. C'est la
manière la plus sûre vis-à-vis du piège consigné plus haut (un champ nommé `count` ou `n` écrase le
nombre qui pilote l'accord), puisqu'il n'y a plus qu'une seule valeur. Accord vérifié à 0 et 1 dans
le navigateur (« 0 store déployé », « 1 volet ouvert »).

La divergence de vocabulaire apparue le même jour entre `covers.counts.blind` / `.awning`
(« stores déployés ») et `summary.awningsDown` (« stores baissés ») a été **tranchée en faveur de
« déployé »** : `summary.awningsDown` et `home.awningsDown` disent désormais « store déployé » /
« stores déployés », et l'anglais `deployed` aux trois endroits. Les **noms** de clés ne changent
pas (l'axe mesuré reste « baissé »), et `cover.upDown.*` non plus — c'est le vocabulaire des gestes
d'un appareil, pas celui d'un compte. Raisonnement complet dans la section « Contradiction détectée
2026-09-18 » de `4_1_navigation-et-panneaux.md`.

Sources : `apps/web/src/i18n/locales/{fr,en}.json`, `apps/web/src/views/CoversView.vue`,
`apps/web/src/components/devices/{LightsMaster,CoversMaster}.vue`.

### Mise à jour 2026-09-18 — `render.tuning.*`, et un réglage de scène qui n'est PAS une préférence de tablette

La section i18n `render.*` gagne `tuning.*` : titre et texte d'appel de la ligne des Réglages, noms
et infobulles des quatre préréglages (`presetNames.*` / `presetHints.*` — Douce, Cinéma, Sobre,
Maquette), libellés des quatorze curseurs (`fields.*`), courbes (`curves.*`, dont `style` = « Du
style » et `linear` = « Aucune »), et les trois mots des boutons `reset` / `save` / `saved`, plus
`saveError` pour la notification d'échec.

Le point à retenir dépasse les libellés : les quatre réglages de rendu déjà listés ici
(`kasbah.sceneStyle`, `sceneAmbience`, `sceneQuality`, `sceneAssets`) sont des **préférences du
navigateur** — le goût de qui regarde, l'heure qu'on veut voir, le budget de la machine qui dessine. Le
**réglage de la lumière n'en est pas une** : il vit dans le fichier de la maison
(`../2_maison/2_0_format-house-json.md`) et vaut pour tous les écrans. `kasbah.sceneTuning` ne
persiste donc qu'un **brouillon** — ce qui est en train d'être réglé et n'a pas encore été
enregistré ; `null` signifie « pas de brouillon, la maison fait foi », et c'est le seul moyen de
distinguer cet état d'un brouillon **neutre**, qui lui est un choix.

Sources : `apps/web/src/i18n/locales/{fr,en}.json` (`render.tuning.*`),
`apps/web/src/stores/settings.ts`.

### Mise à jour 2026-09-18 (2) — `render.tuning.tilt`

Le groupe `tilt` et ses quatre libellés (`fields.tiltShift` / `tiltCenter` / `tiltWidth` /
`tiltPills`) complètent la section du banc. Le nom du groupe porte le mot technique ET le mot commun
— « Tilt-shift (maquette) » — parce que le premier seul ne dit rien à qui n'a pas fait de photo, et
le second seul se confondrait avec le style de rendu `maquette`, qui est autre chose.

### Mise à jour 2026-09-18 (3) — `render.projection`, et un réglage qui n'atteignait pas la scène

Cinquième réglage de rendu, `kasbah.sceneProjection` (défaut `perspective`), posé dans Rendu 3D
juste au-dessus de « Qualité » : `Perspective | À plat | Isométrique`. Clés `render.projection`,
`render.projectionHint`, `render.projections.<mode>`.

**« À plat » et non « Orthographique »** dans le sélecteur : trois segments pleine largeur se
partagent la ligne, et le mot juste est aussi le plus long des trois. Mesuré à 1280, 768 et 600 px
de large, dans les deux thèmes : aucun débordement, géométrie identique au sélecteur « Qualité »
juste en dessous. Le mot technique est rendu dans l'aide sous le contrôle, qui a la place de
l'expliquer. En anglais, « Flat ».

Ce qui distingue les deux modes plats ne se devine pas d'un libellé, l'aide le dit donc en toutes
lettres : « à plat » retire la fuite mais laisse tourner, « isométrique » fige en plus les angles et
change le geste — le doigt déplace la vue au lieu de la faire pivoter
(`../1_architecture/1_5_scene-3d.md`).

**Et un constat à garder** : `kasbah.sceneQuality` existait depuis le 2026-09-15 sans jamais
atteindre la scène — le store le retenait, le `Segmented` l'affichait, personne ne le lisait. Un
réglage persisté et validé à l'écriture peut n'avoir aucun destinataire ; ni le typage ni les tests
ne le disent (`../6_faq/6_1_pieges-runtime.md`).

Sources : `apps/web/src/stores/settings.ts`, `apps/web/src/views/SettingsView.vue`,
`apps/web/src/composables/useHouseScene.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-20 — `home.filter.*`

Section `home.filter` (fr/en) : `aria`, `light`, `cover`, `climate`, `media`, `camera`, `other`.
Ce sont les **noms** du filtre de la liste d'une pièce — infobulle et lecteur d'écran, le switch
n'affiche que des icônes (`../4_ui/4_1_navigation-et-panneaux.md`). « Tout » réutilise `common.all`.

### Mise à jour 2026-09-20 — `media.playUrl` / `media.urlPlaceholder`

Deux clés dans `media.*` (fr / en) pour le champ « lire une URL » du panneau lecteur.

### Mise à jour 2026-09-20 — `ytmusic.*` / `settings.ytmusic.*`

Vue YouTube Music et carte Réglages : recherche / likes / playlists, lecteur, cookie, PO Token,
badge non officiel. Icône `music` dans `strokeIcons.ts`. `nav.ytmusic`.

*(Dépassé le 2026-09-22 : la vue est devenue la page « Musique », clé `nav.music` (`/music`, `MusicView.vue`) ; `nav.ytmusic` n'existe plus dans `i18n/locales/fr.json` et `/ytmusic` redirige — voir `4_1_navigation-et-panneaux.md`.)*

### Mise à jour 2026-09-20 — renew cookie (import + collage)

Sur la carte plugin : `pasteHowTo` en premier (fiable sur Windows), `importSteps` (Kasbah
ailleurs, Chrome fermé ; note DPAPI → Firefox ou collage), `renewHint` quand déjà lié.

### Mise à jour 2026-09-21 — un réglage d'affichage qui n'est pas une préférence de goût

`settings.cupGrams` (localStorage `kasbah.cupGrams`, 100 g par défaut) dit **combien pèse une tasse
de croquettes**. Ce n'est pas un réglage de confort mais le seul moyen honnête d'afficher des
grammes : une mangeoire PetKit compte en VOLUME et ne pèse rien. Le défaut de 100 g n'est pas une
supposition — l'appli du fabricant écrit « 1/2 (environ 50 g) », soit 10 g par dixième de tasse.
La valeur affichée garde un « ~ » parce qu'elle dépend des croquettes ; un pas-à-pas au pied de la
carte Animaux permet de la caler en pesant une ration une fois.

Même patron que `householdSize` sur la vue Traitement de l'eau : un réglage d'AFFICHAGE, discret,
séparé des données par un filet, jamais une commande envoyée à l'appareil. Nouvelle section i18n
`pets.*` (FR + EN), et `common.cancel` qui manquait — chaque section avait son propre « Annuler ».
Sources : `apps/web/src/stores/settings.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-21 — clés `fan.*` et `light.kelvin.*`

Section i18n `fan` (titre, vitesse, sens, minuterie, mute) et `light.kelvin.2700|3300|4000`
affichés en Kelvin, pas en mirek. Kind `kinds.fan`.

### Mise à jour 2026-09-21 (bis) — `kelvinLabel` et `kinds.lightFan`

`light.kelvinLabel` : Chaud / Neutre / Froid (Warm / Neutral / Cool) ; le K reste en
`light.kelvin` (sous-ligne du segmenté). `kinds.lightFan` : « Lumière - Ventilateur ».

### Mise à jour 2026-09-22 — `place.*` / `vehicle.tune*` → Réglages / Modifier ; `speakerShape`

`place.title` et `vehicle.tuneTitle` : « Réglages » / « Settings ». `place.move` et
`vehicle.tune` : « Modifier » / « Edit » (vues Véhicules / Robots incluses). `place.hint`
élargie (niveau, hauteur, orientation, taille ou forme). Section `place.speakerShape.*` :
`label`, `default`, `pebble`, `bar`, `block` (Forme / Défaut / Galet / Barre / Bloc).

Sources : `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-22 (bis) — `settings.pluginsStats`

Clé pluralisée pour l'en-tête de la liste Plugins :
`{active} / {available} actifs · {n} appareil(s)` (EN : `enabled · device(s)`).

Sources : `apps/web/src/i18n/locales/{fr,en}.json`, `SettingsView.vue`.

### Mise à jour 2026-09-28 — `kasbah.sceneSeason` et les clés `garden.*`

**Réglage** : `sceneSeason` (`localStorage` `kasbah.sceneSeason`, défaut `auto`), valeurs `auto`,
`spring`, `summer`, `autumn`, `winter`, validées par `setSceneSeason` contre `SEASON_MODES`.
Segmenté « Saison du jardin » dans la carte Rendu 3D des Réglages, juste sous « Heure de la
maison ». C'est une préférence du navigateur, pas un champ de la maison, comme l'ambiance. `auto`
suit la date dans l'hémisphère de la maison (`../2_maison/2_2_jardin.md`).

**Clés** (fr/en) : `render.season`, `.seasonHint`, `.seasons.<mode>`. Section `garden.*` : `list`,
`add`, `done`, `count` (pluralisée `{n}`), `none`, `kinds.<famille>` (Feuillu / Conifère / Palmier
/ Buisson / Pierre), `placeHint`, `hint`, `height`, `yaw`, `kind`, `species`, `generic`, `reshape`,
`whereHint`, `remove`, `removeConfirm`, `smaller`, `bigger`, `saveError`. `render.houseEditing`
devient « Régler la maison et le jardin » / « Adjust the house and garden ». Les noms d'espèce ne
sont pas des clés i18n : ils viennent de la recette (`name.fr` / `name.en`).

Sources : `apps/web/src/stores/settings.ts`, `apps/web/src/views/SettingsView.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`, `apps/web/src/three/garden/season.ts`, arbre de travail
non commité après cf60c7d.

### Mise à jour 2026-09-29 — Contraste AA du texte secondaire

**Constat** (mesuré sur les lignes de la barre de recherche de la vue Maison, sous-libellé 12 px
`--muted`) : le texte secondaire tombait sous l'AA 4,5:1 dans cinq variantes, et le texte
principal de Tokyo Night Day sous 4,5:1 sur le fond de page. Or `--muted` porte de l'information
réelle (sous-titres d'appareils, lignes de recherche, résumés d'en-tête) : il suit désormais la
même règle que `--text`. Le compromis « authenticité d'abord » de 2026-09-12 ne tient plus.

**Règle** : `text` et `muted` à **≥ 4,5:1 sur `surface` ET sur `bg`**, pour chaque thème et chaque
variante. En clair, le fond de page est plus sombre que la surface, donc c'est lui qui contraint.

**Méthode** : prendre d'abord une couleur que l'auteur publie (Catppuccin `subtext1`). À défaut,
garder la teinte et la chroma d'origine (OKLCH) et ne bouger que la luminosité, jusqu'à ≈ 4,6:1
pour garder une petite marge (la liste de recherche pose la surface à 94 %).

| Variante | Rôle | Avant | Après | surface / bg |
|---|---|---|---|---|
| Kasbah clair | muted | `#66717f` | `#5f6a78` | 5,50 / 4,67 |
| Catppuccin Latte | muted | `#6c6f85` (`subtext0`) | `#5c5f77` (`subtext1`) | 5,53 / 4,73 |
| Dracula | muted | `#6272a4` (comment) | `#8192c6` | 4,65 / 5,16 |
| Light Owl | muted | `#989fb1` (comment) | `#656c7c` | 5,09 / 4,62 |
| Night Owl | muted | `#637777` (comment) | `#7f9494` | 4,66 / 5,73 |
| Tokyo Night Day | text | `#3760bf` | `#2349a6` | 6,30 / 5,56 |
| Tokyo Night Day | muted | `#6172b0` (`fg_dark`) | `#495894` | 5,23 / 4,61 |

Le texte de Tokyo Day est foncé **plus** que le strict nécessaire : ramené à 4,6:1, il aurait le
même contraste que `muted` et la hiérarchie des deux plans disparaîtrait. Il reste bleu, la
signature de Day. Kasbah sombre, Catppuccin Mocha, Alucard, Synthwave '84 et Tokyo Night Night
passaient déjà. Chaque écart à la couleur publiée est expliqué en tête du fichier du thème.

**Garde-fou** : `src/themes/themes.test.ts`, cas « tient l'AA 4,5:1 pour le texte et le texte
secondaire, sur la surface et le fond », qui remplace l'ancienne vérification du seul `text` sur
`surface`. Un thème ajouté demain avec un commentaire trop pâle échoue au test.

Vérifié dans la preview `kasbah-mock`, page Lumières : tous les textes rendus en `--muted`, sur
leur fond réel composé, pour les six thèmes en clair et en sombre — pire cas 4,61:1.

Sources : `apps/web/src/themes/{kasbah,catppuccin,dracula,night-owl,tokyo-night}.ts`,
`apps/web/src/themes/themes.test.ts`.

### Mise à jour 2026-10-01 — `render.styles.akira`, et la tuile d'un style passe par son étalonnage

Un style de plus, Akira (`../1_architecture/1_5_scene-3d.md`) : clé `render.styles.akira`, « Akira »
en français comme en anglais (nom propre).

Remarque de l'utilisateur : « la carte akira dans les param ne reflète pas trop les couleurs de la
scène 3d ». La tuile (`stylePreview`, `views/SettingsView.vue`) montrait ciel, sol, mur et vitre de
la palette À L'HEURE CHOISIE, mais avant l'étalonnage que la passe de sortie applique ensuite
(`post.grade`, `core/post.ts`). Elle l'applique désormais elle-même (`graded`, même formule en
espace d'affichage : gain, lift, gamma, saturation) — plus fidèle pour tout style étalonné : les
tuiles Halloween et Disco changent un peu. Le rouge d'Akira manquait aussi parce qu'il n'était que
sur la moto : la vitre de jour du style a pris un reflet rouge, qui fait le point de la tuile.

Sources : `apps/web/src/views/SettingsView.vue`, `apps/web/src/three/styles/akira.ts`,
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-10-05 — format de date `long`, et un `<nom>` pris pour du HTML

Deux avertissements `[intlify]` dans la console de la page Réglages :

- `Not found 'long' key in 'fr' locale messages` : la carte PetKit (`components/PetkitLinkCard.vue`)
  datait la fin de session avec `d(date, 'long')`, format jamais déclaré. Ajouté aux deux langues
  dans `datetimeFormats` (`i18n/index.ts`) : `{ day: 'numeric', month: 'long', year: 'numeric' }`,
  soit « 12 novembre 2026 » / « November 12, 2026 ». Les formats déclarés sont `time`, `short`,
  `date`, `weekday`, `hour`, `month` et `long` ; un nom absent n'échoue pas, il se contente d'un
  avertissement et d'un repli : vérifier la liste avant d'appeler `d()` avec un nouveau nom.
- `Detected HTML in '…' message` : `mixcloud.linkHint` écrivait `mixcloud.com/<nom>/`, qu'intlify
  prend pour une balise. Remplacé par `mixcloud.com/ton-nom/` (en : `your-name`). Un `<` isolé
  (`automations.op.lt`) ne déclenche rien : c'est la forme `<mot>` qui est visée.

Sources : `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/locales/{fr,en}.json`,
`apps/web/src/components/PetkitLinkCard.vue`.
