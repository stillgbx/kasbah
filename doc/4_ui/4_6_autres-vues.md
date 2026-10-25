# Autres vues : Météo, Robots, Eau, Chauffage, Animaux, Agenda, École, Courses, Automatisations

> Dernière mise à jour : 2026-10-25
> Sources : sections reprises telles quelles de `4_1_navigation-et-panneaux.md` le 2026-10-13 ; chaque section cite les siennes.

Cette page couvre les vues propres à un domaine : Météo et radar, Robots (tondeuse, aspirateur), Eau, Chauffage, Animaux, Agenda, École, Courses, Automatisations. Elle est née du découpage de
[4_1 Navigation et panneaux](4_1_navigation-et-panneaux.md), trop longue pour être lue d'un trait : ses
sections y ont été déplacées sans retouche, dans leur ordre d'origine, avec leurs dates. Un renvoi
« plus haut » ou « plus bas » peut donc désigner une section restée dans une autre page de `4_ui/`.

### Mise à jour 2026-09-16 — widget météo, vue Météo, radar

- **Un seul point d'accès** : `composables/useWeather.ts` (`entry`, `live`, `cloudiness`) et
  `useForecast(deviceId)` (rechargé à l'ouverture puis toutes les 10 min, la cadence du serveur).
  Widget, vue et scène 3D passent par là, jamais par l'appareil `weather` directement — c'est ce qui
  permettra de consolider une station personnelle (`sensor`) avec le modèle à un seul endroit.
- **Widget** (`components/home/WeatherWidget.vue`) : en bas à gauche de la vue Maison, comme la
  maquette — icône de condition, température, condition, heure, date. Emplacement **réservé**
  (152 × 132 px) : sans météo, tiret et horloge. Le message « Chargement » est remonté au-dessus.
  Un tap ouvre la vue Météo.
- **Vue Météo** (`views/WeatherView.vue`, route `weather`, entrée du rail en `cloudSun` — d'abord 9e,
  puis **2e, juste après la maison**, à la demande de l'utilisateur le 2026-09-16 ; il a aussi remonté
  Médias avant Caméras — ordre du rail : Maison, Météo, Lumières, Ouvrants, Médias, Caméras, Énergie,
  Véhicules, Réglages) :
  maintenant, soleil (arc du jour), vent (rose), 24 heures (toujours 24 colonnes), 7 jours (toujours
  7 lignes, barres min-max sur l'échelle de la semaine), tuiles, qualité de l'air et pollens **si la
  capacité est déclarée**, radar, crédit de la source. Indisponible : tout reste en place, grisé.
   *(Dépassé le 2026-10-06 : la source de vérité de l'ordre est `apps/web/src/lib/navItems.ts` — Maison, Météo, Agenda, École, Musique, Lumières, Ouvrants, Médias, Caméras, Énergie, Eau, Chauffage, Véhicules, Robots, Animaux, TENS (poste local seulement), Automatisations, puis Réglages épinglés en bas du rail.)*
- **Radar** (`components/weather/RainRadar.vue`) : MapLibre sur le plan OpenFreeMap, une couche
  raster **RainViewer** (radar observé 2 h + nowcast 30 min, sans clé, tuiles ouvertes au navigateur,
  `setTiles` pour changer d'image), frise fixe lecture/pause/curseur. La **lecture démarre seule** au
  premier chargement des images (demande du 2026-09-16 : « une carte de pluie se lit en mouvement ») ;
  ensuite l'utilisateur décide, et un rechargement des images ne relance rien. Ce n'est pas une prévision :
  la carte des précipitations du site d'Open-Meteo est une **prévision** AROME au pas de 15 min
  (`@openmeteo/weather-map-layer`, GPL-2.0, 3,4 Mo), gardée pour une seconde passe (plan de session).
- Icônes trait ajoutées (`lib/strokeIcons.ts`) : `cloud`, `cloudSun`, `cloudMoon`, `drizzle`, `rain`,
  `snow`, `fog`, `thunder`, `wind` ; `lib/weather.ts` (`conditionIcon`, `compassPoint`). Carte
  détail `controls/WeatherCard.vue`. Formats i18n `date`, `weekday`, `hour` ; bloc `weather.*`.

Sources : `apps/web/src/composables/useWeather.ts`, `apps/web/src/components/home/WeatherWidget.vue`,
`apps/web/src/views/WeatherView.vue`, `apps/web/src/components/weather/RainRadar.vue`,
`apps/web/src/lib/{weather,strokeIcons}.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-09-16 — la vue Météo tient sans défiler sur un écran large

Demande : « pouvoir tout afficher sans avoir à scroller sur une page de 1920 × 945 » et voir le
radar sans descendre. Premier essai écarté par l'utilisateur : le radar en colonne de droite sur
toute la hauteur « a trop d'importance » et laissait « plein d'espace vide » dans les autres cartes.
Retenu (troisième passe, sur croquis de l'utilisateur) : à partir de 1400 px de large **et** 820 px
de haut (`@media`), la grille garde le flux d'origine et ses tailles ; la **semaine** prend le haut
à droite (5/12, la hauteur des deux premières rangées, lignes espacées à 38 px pour la remplir), à
côté de maintenant / soleil / vent et des 24 heures ; la troisième rangée aligne à gauche les détails
(resserrés sur 2/12), puis air + pollens côte à côte (`.wx-side`, transparente en flux grâce à
`display: contents`), et le **radar ferme la page en bas à droite**, sur les **mêmes colonnes que la
semaine** (8/13) pour que les deux blocs de droite partagent leur bord gauche. Le crédit de la source se
pose **en bas à gauche**, sous les détails (bloc `.wx-bottom`, transparent en flux, grille à deux
rangées en mode compact) — un premier essai dans l'en-tête a été écarté. Le conteneur passe en `overflow: hidden` et la
grille remplit la hauteur. Mesuré dans la preview : 0 px de dépassement à 1920 × 945 ; en dessous
des seuils, le flux d'origine et son défilement reviennent tels quels.

Les **tuiles** (ressenti, humidité, pression…) deviennent une **liste de détails** (`.wx-details`,
une ligne de 32 px par mesure : icône, libellé, valeur) : les grandes valeurs en tuiles pesaient
autant que l'instant lui-même. Le ressenti n'y est plus, il est déjà au pied de « Maintenant ».

La carte **Qualité de l'air** porte sous son échelle une **légende** : les six paliers EAQI avec leur
couleur et leur plage (0-20 bon … > 100 extrêmement mauvais), le palier du moment en évidence, et
une ligne qui dit ce qu'est l'indice (le palier du polluant le plus élevé parmi PM2,5, PM10, NO₂, O₃,
SO₂). Demande de l'utilisateur : « on ne sait pas trop à quoi correspondent les niveaux ou EAQI »,
et la place sous la carte était vide. Même geste sur **Pollens** : une légende des niveaux (un point par cran) et une ligne sur
la mesure — concentration prévue en grains/m³ (CAMS) graduée sous 10 / 50 / 150 : ce texte reflète
les seuils du mappage `open_meteo`, à garder en phase si un autre fournisseur gradue autrement. En
mode compact, la carte Détails s'étire à la hauteur de ses voisines (`align-items: stretch`). Les deux
légendes sont **poussées au bas de leur carte** (`.wx-legend`, `margin-top: auto` dans une carte en
colonne) sous un filet, en 11 px et en retrait (`opacity: .85`) : elles renseignent sans concurrencer
la mesure.

Sources : `apps/web/src/views/WeatherView.vue`.

### Mise à jour 2026-09-16 — la couche AROME sur le radar : une frise, deux sources

Le radar ne s'arrête plus à maintenant : après les deux heures observées de RainViewer, la frise
continue avec la **prévision AROME de Météo-France au pas de 15 minutes**, jusqu'à six heures,
publiée par Open-Meteo en fichiers `.om` sur un seau S3 ouvert et rendue dans le navigateur par
`@openmeteo/weather-map-layer` (protocole MapLibre `om://`). Sans AROME (réseau, run absent ou
vieux), la demi-heure de prévision immédiate de RainViewer prend la suite, comme avant.

- **Deux couches raster, une visible à la fois** (`radar` par `setTiles`, `arome` par `setUrl`),
  jamais empilées. Le libellé sous l'heure dit la source (observé / immédiat / AROME, la prévision
  en couleur d'accent), et un **trait « AROME » sur la course du curseur** marque la bascule
  (demande de l'utilisateur), placé entre la dernière image observée et la première prévue.
- **Pas par `latest.json?time_step=…`** : la bibliothèque bâtit le nom du fichier avec des minutes
  à zéro (`T${HH}00.om`), donc ses pas de 15 minutes s'écrasaient tous sur l'heure pleine. `lib/arome.ts`
  (pur, testé) lit `latest.json` pour le run et ses échéances et construit l'URL exacte de chaque
  fichier : `…/<AAAA>/<MM>/<JJ>/<HH>00Z/<AAAA-MM-JJ>T<HHMM>.om?variable=precipitation[&dark=true]`.
- **Chargement à la demande** : le module (151 Ko) et son WASM (2,1 Mo) ne sont importés que dans
  `RainRadar.vue`, au premier besoin ; le protocole `om://` est enregistré une fois. Vite doit
  **exclure** les trois paquets Open-Meteo de son pré-empaquetage (`optimizeDeps.exclude`) pour la
  même raison que MapLibre : le WASM est trouvé par `new URL(…, import.meta.url)`.
- **Piège rencontré** : `map.isStyleLoaded()` vaut faux tant qu'une source charge une tuile, donc
  presque toujours pendant une animation qui change d'image toutes les 600 ms — les couches ne se
  posaient jamais. La pose attend l'événement `style.load` (drapeau `styleReady`, remis à zéro au
  changement de thème).
- **Licence** : la bibliothèque et son lecteur sont sous **GPL-2.0**. Sans effet pour un usage maison ;
  à savoir si le dépôt devient public. Elle déclare `maplibre-gl ^5` en dépendance mais ne l'importe
  pas à l'exécution : une copie 5.x reste installée sous son dossier, sans entrer dans le bundle.

Sources : `apps/web/src/components/weather/RainRadar.vue`, `apps/web/src/lib/arome.ts`,
`apps/web/src/lib/arome.test.ts`, `apps/web/vite.config.ts`, `apps/web/package.json`.

### Mise à jour 2026-09-16 — la vue Robots

Demande : « visualiser les infos de base [de la tondeuse], son état, sa position (carte un peu comme
les voitures) ». Une **vue dédiée** plutôt qu'une carte de plus dans Véhicules — une tondeuse n'est pas
un véhicule, et l'aspirateur (`irobot`, squelette) y aura sa place : `views/RobotsView.vue`, route
`/robots`, icône `mower` au rail juste après Véhicules (le rail passe à dix entrées).

*(Dépassé le 2026-10-06 : le nombre d'entrées a encore changé ; la liste et l'ordre vivent dans `apps/web/src/lib/navItems.ts` — Maison, Météo, Agenda, École, Musique, Lumières, Ouvrants, Médias, Caméras, Énergie, Eau, Chauffage, Véhicules, Robots, Animaux, TENS (local), Automatisations ; Réglages épinglés en bas.)*

Une carte par robot, bâtie sur le modèle de la carte véhicule (`.rcard`, mêmes cases `.stat`) :

- en-tête : icône (allumée en tonte), nom (celui de la maison, sinon du fabricant), fabricant ·
  modèle ; à droite une **pastille d'activité** (accent en tonte, orangé d'avertissement en erreur,
  neutre sinon) ;
- batterie en grand chiffre et jauge (rouge sous 20 %) ;
- une **ligne d'état toujours réservée** (règle « rien ne bouge ») : l'erreur du fabricant — « Erreur
  2 · No loop signal · il y a 3 h », code + texte + âge — sinon la raison qui retient le robot
  (`mower.restrictions.*` : « Attend son planning », « Arrêtée par un capteur (pluie) », « Gel : reste
  au garage »…), vide en tonte ;
- prochain départ, hauteur de coupe (« 6 / 9 »), connexion (« Connectée · statut il y a 2 min ») ;
- quatre **compteurs** fixes (tonte en heures, recharges, collisions, distance) — « Recharges »
  plutôt que « Cycles de charge », qui se tronquait à 320 px ;
- la **carte** : `VehicleMap` réutilisée avec la prop `subject="mower"` — un **disque** à la place de
  la flèche (le robot ne dit pas son cap), la maison dessous, légende « Position il y a … » ;
- les gestes selon les **capacités** (`mow` : « Tondre 1 h » / « Pause » ; `park` : « Rentrer »,
  grisé au garage ou en charge), spinner à la place de l'icône pendant l'aller-retour ;
- « Mis à jour il y a … » (horloge de la vue à 30 s) et la **jauge de quota** du fabricant (10 000
  requêtes par mois, `PluginHealth.quota`), même langage que sur la carte véhicule ; rien pour la
  simulation.

Une carte grisée (`data-unavailable`) quand le robot ne parle plus au fabricant : les dernières
valeurs restent lisibles, `statusAt` les date. Vérifié dans la preview sur la simulation (thèmes
sombre et clair, satellite avec le disque et la maison). Testé : `views/RobotsView.test.ts` (erreur
lisible, cases « — », gestes envoyés, boutons selon capacités).

Sources : `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/vehicles/VehicleMap.vue`,
`apps/web/src/components/layout/NavRail.vue`, `apps/web/src/router/index.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-16 (soir) — quatre retours sur la carte Robots, dont le décalage GPS

Retours de l'utilisateur sur le vrai robot : la **hauteur de coupe est en centimètres** (1 à 9,
c'est ainsi que l'appli du fabricant la nomme) → « 7 cm » et non « 7 / 9 » ; « Au garage » devient
**« À la station »** (`mower.activities.parked`) ; la carte **débordait** de sa colonne sur une fenêtre
étroite ; et sur la photo aérienne le robot n'était **pas tout à fait à sa place** (station contre un
mur extérieur).

- **Débordement** : une rangée en `nowrap` (le modèle du fabricant, un compteur) fixait la largeur
  minimale de toute la grille de la carte, qui sortait alors de sa colonne au lieu de couper le texte.
  `min-width: 0` sur chaque rangée (`.rcard > *`) et sur les cases `.stat`. Vérifié à 480 px : plus
  aucun élément à droite du bord de la carte.
- **Sous-titre** : « Husqvarna · Husqvarna Automower® 435X AWD » disait deux fois la marque ; le
  modèle qui la porte déjà suffit (`makeAndModel`).
- **Décalage GPS** : bouton « Régler » (même pilule que sur la carte véhicule), proposé seulement à un
  robot posé par son GPS, qui déplie `components/robots/MowerTuning.vue` — le composant des véhicules
  réduit au décalage X/Y (pas de rotation : le robot ne dit pas son cap ; pas de batterie à saisir),
  écrit dans `house.devices[].gpsOffset` par `house.setDeviceTuning`, avec « Rétablir ». La
  correction s'applique **à la carte aussi** (`offsetLocation`, `lib/map.ts`, testée) : c'est sur la
  photo aérienne qu'on juge la place, elle doit montrer la même chose que la scène 3D — la carte
  véhicule, elle, montre toujours le GPS brut.

Sources : `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/robots/MowerTuning.vue`,
`apps/web/src/lib/map.ts`, `apps/web/src/lib/map.test.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-16 (nuit) — le journal sur la carte Robots

Une carte « Journal » entre les compteurs et la carte satellite, pour un robot qui déclare la
capacité `journal` : **huit lignes** fixes, du plus récent au plus ancien — pastille de gravité (neutre,
orangé d'avertissement, rouge d'erreur, rouge cerclé pour une erreur grave), jour et heure (« 24 août 16:42 » — le journal court sur des semaines), texte du
fabricant et « code N ». Chargé à l'arrivée et à chaque battement de 30 s par `getJournal` du transport
(`Transport.getJournal`, route `/api/devices/:id/journal`) ; un échec garde les lignes d'avant ; vide,
« Aucun message consigné ». La simulation ne déclare pas la capacité : rien ne s'affiche, rien n'est
demandé (testé dans `RobotsView.test.ts`, le transport bouchonné).

Sources : `apps/web/src/views/RobotsView.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-09-16 (nuit, bis) — le journal se signale, se déplie, se pose sur la carte et dans la scène

Retour de l'utilisateur sur la carte « Journal » de la veille : « complètement variable en hauteur, ça
décale tout le reste ». Deux fautes contre la règle « rien ne bouge » : une hauteur qui suivait le
journal, et une section toujours ouverte. **Remplacée** par (cette sous-section fait foi sur le point) :

- **Le journal se SIGNALE** : une pilule « Journal » dans la rangée des gestes, avec le **nombre de
  lignes** et la **gravité de la dernière** en teinte de pastille (`.rcard__count`, largeur minimale
  fixe : « 9 » ou « 22 » font la même pilule). Replié, la carte garde exactement sa hauteur.
- **Il se DÉPLIE au clic**, sous les gestes, comme « Régler » : `components/robots/JournalList.vue`,
  liste **bornée à huit lignes (192 px) qui défile** au-delà — la carte ne s'étire pas au gré du
  journal, en **monospace** avec une date à largeur constante (« 16/09 18:22 » : « 7 juil. » et
  « 16 sept. » ne s'alignaient pas — demande de l'utilisateur). Pastille de gravité, texte du fabricant et code. Une ligne qui SAIT où
  elle s'est produite est un **bouton** ; une ligne sans position ne mène nulle part et le dit au survol.
- **Déplié, il se pose sur la carte** : `VehicleMap` gagne `points` (pastilles de gravité, sous le
  robot et la maison) et `focus` (une ligne choisie amène la carte dessus au zoom 18, et c'est comme
  si l'utilisateur l'avait déplacée : « Recentrer » réapparaît). La ligne choisie se surligne.
- **Les mêmes fonctions dans le panneau détail** de la vue Maison (`DevicePanel.vue`) : deux cartes
  au gabarit de « Paramètres » du véhicule — le **journal** (compte sur le bouton, liste dépliée) et
  le **décalage GPS** (`MowerTuning`, robot sous les yeux). Journal déplié, ses incidents se posent
  **sur le terrain de la scène** (`../1_architecture/1_5_scene-3d.md`) ; une ligne choisie **cadre la
  caméra** dessus — c'est ainsi qu'on localise une panne depuis la maison. Changer d'appareil ou
  quitter le panneau retire les épingles.

Le chargement est partagé : `composables/useJournals.ts` (liste d'ids, relecture à l'arrivée, au
changement de liste et toutes les 30 s ; un échec garde le journal d'avant), `lib/journal.ts` (points
positionnés, libellé, teintes de gravité communes à la carte et à la scène, format de date). Le
store porte `journalOverlay` / `journalFocus` (même couture que l'aperçu de teinte : le panneau dit,
`HomeView` transmet à la scène). Vérifié sur un vrai robot : un journal de plusieurs dizaines de lignes dont la plupart positionnées, la carte
passe de 771 px repliée à 993 px dépliée et n'en bouge plus ; tests `RobotsView.test.ts` et
`three.test.ts` (« incidents du journal posés sur le terrain »).

Sources : `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/robots/{JournalList,MowerTuning}.vue`,
`apps/web/src/components/home/DevicePanel.vue`, `apps/web/src/components/vehicles/VehicleMap.vue`,
`apps/web/src/composables/useJournals.ts`, `apps/web/src/lib/journal.ts`, `apps/web/src/stores/house.ts`, `apps/web/src/views/HomeView.vue`.

### Mise à jour 2026-09-16 (nuit, ter) — l'incident actif : infobulle, marqueur, épingle

Trois retouches demandées sur le journal : **l'infobulle dit tout** (le texte complet que la ligne
coupe, puis « Voir où c'est arrivé » si la ligne est positionnée, « Sans position » sinon — sur la
ligne entière, pas seulement le bouton) ; **un clic met le marqueur en évidence** sur la carte
satellite (pastille grossie, passée devant, `VehicleMap` prop `activeAt`) et, en retour, **toucher une
pastille** désigne sa ligne (`pointTap`), qui se surligne et défile à portée de vue
(`scrollIntoView`) ; **dans la scène**, l'épingle active grossit et porte une **étiquette**
(`.journal-pin`, texte du fabricant et code, dans `app.css` comme les pilules), et **toucher une
épingle** la rend active — le panneau surligne sa ligne. La notion d'« incident actif » est portée
par le store (`journalActive`, `markJournalPoint`) : la ligne choisie et l'épingle touchée la
partagent, la caméra ne bouge que pour une ligne choisie.

Sources : `apps/web/src/components/robots/JournalList.vue`, `apps/web/src/components/vehicles/VehicleMap.vue`,
`apps/web/src/views/{RobotsView,HomeView}.vue`, `apps/web/src/components/home/DevicePanel.vue`, `apps/web/src/stores/house.ts`, `apps/web/src/styles/app.css`.

### Mise à jour 2026-09-17 — `WaterCard.vue`, et ce que le vrai zoom révèle

La carte de la station de traitement de l'eau (kind `water`) affiche les quatre usures avec une
pastille pour la lampe UVc, puis le débit et les consommations, puis l'alerte — chaque section
gouvernée par la capacité correspondante. Valeurs absentes en **tiret, jamais en zéro**. Aucun
contrôle : l'appareil se regarde travailler, comme la météo ou une caméra.

Trois enseignements de sa relecture, qui dépassent cette carte :

**1. Un `min-width` en `ch` calé sur les pourcentages ne tient pas pour les litres.** `5ch`
suffisait à `100 %` mais laissait la colonne de valeurs glisser de **21 px** entre `4 210 L` et
`1 234 567 L`, à tous les zooms — donc structurellement. Caler la réserve sur le **pire cas
réel** (`9ch` ici) ramène la dérive à 0,00 px sur 26 états. La règle « rien ne bouge » se vérifie
au `getBoundingClientRect()`, pas à l'œil.

**2. Le contraste se mesure sur le fond RÉELLEMENT peint, pas sur le blanc du thème.** Le panneau
est translucide au-dessus de la scène 3D : une couleur à 5,27:1 sur blanc tombe à **3,84:1** sur
le gris que la scène laisse transparaître de nuit. Ce n'est pas propre à cette carte — sur la
même base, les libellés `--muted` sont à 3,61 et le rouge de défaut à 3,19. **Tout le petit texte
des panneaux est concerné**, et c'est une dette à traiter globalement plutôt que carte par carte.

**3. Un état « éteint » et un état « inconnu » doivent se distinguer autrement que par le mot.**
La pastille de la lampe retombait sur la couleur des séparateurs (≈ 1,10:1) et rendait
identiquement les deux cas. Disque plein / disque sourdine / **anneau creux en pointillés** les
séparent, à empreinte constante de 7×7 px grâce à `box-sizing: border-box` — une bordure qui
agrandit la pastille ferait bouger la ligne.

### Mise à jour 2026-09-17 (bis) — la vue Eau : un kind a besoin de SA vue, pas seulement de sa carte

`WaterCard.vue` existait, la station était publiée, l'appareil était **invisible** : aucune vue ne le
listait, donc aucun moyen d'atteindre le bouton « Placer », donc pas de marqueur possible dans la
maison. **À retenir pour tout nouveau kind : la carte ne suffit pas.** Il lui faut une vue, une
route et une entrée de rail, sans quoi l'appareil n'existe que dans l'API.

- **Vue** `apps/web/src/views/WaterView.vue` : un hero (icône, nom, `headlineValue` et `statusLabel`
  repris de `lib/deviceState.ts`), la `WaterCard.vue` reprise **telle quelle**, et `RoomBands` en
  `kind=water` pour le badge « Non placé / Placer ».
- **Route** `/water`, **entrée de rail après Énergie et avant Véhicules** : c'est de l'équipement
  technique de la maison, pas un média. Icône `droplet`, déjà mappée sur le kind dans
  `strokeIcons.ts` / `deviceIcons.ts` — aucun ajout d'icône nécessaire.

**Le graphique de consommation** (`components/water/WaterConsumptionChart.vue`) est écrit **à la
main en SVG** : ce projet n'embarque aucune bibliothèque de graphe, et n'en a pas pris une pour
l'occasion. Quatre périodes (`Segmented` réutilisé : Jour / Semaine / Mois / Année).

Ce que sa mise au point a établi, et qui dépasse cette vue :

- **Deux colonnes au-delà de 1040 px**, empilé en dessous (`.water__top`, même patron que
  `.energy__top`) — **seuil mesuré, pas recopié d'EnergyView** : sous 965 px `.hero__main` tombe
  sous 90 px et `.hero__sub` passe sur deux lignes (68 px / 36 px de haut à 950 px, contre 98 / 18 à
  980). 1040 laisse la marge.
- **Hauteur du graphique** : `.chart__body` passe de `height: 192px` à `min-height: 192px` +
  `flex: 1 1 192px`. Il grandit seulement s'il est **étiré** par un hero plus haut (271 px mesurés
  en deux colonnes, 192 seul ou empilé), jamais moins.
- **Pas absent ≠ mesure à zéro** : tiret vertical pointillé de **hauteur fixe 16 px** (il ne
  représente aucune valeur) contre barre pleine avec plancher à 3 px. Les deux ne se confondent
  jamais, vérifié en peuplant le mock à la main.
- **Historique vide** : un message dédié par série (horaire / quotidien / mensuel), jamais un cadre
  en pointillés ni une erreur. La hauteur du corps est identique vide ou pleine, sur les quatre
  périodes.
- **Axe gradué à valeurs rondes** : `niceAxisTicks()` (`lib/consumption.ts` — le pas de D3, `tickStep`, réimplémenté sans la
  dépendance) rend 3 à 4 repères ronds (multiples de 1, 2 ou 5 × 10ⁿ) **toujours ≤ au maximum
  réel** : un repère qui le dépasserait est écarté plutôt que d'étirer les barres pour
  l'atteindre (maximum 12 396 → repères 5 000 et 10 000 seulement). L'unité suit l'échelle
  (L puis m³ via `volumeAxisUnit` / `formatVolumeAxisTick`, `lib/format.ts`) et s'écrit **une seule
  fois en tête de colonne**, jamais collée à chaque graduation. Colonne d'axe réservée à **44 px
  fixes**, jamais calculée depuis le texte : c'est ce qui garantit zéro décalage entre FR/EN et entre
  L/m³.
- **Repère de moyenne française : 145 L/habitant/jour (SISPEA 2023)**, ligne pointillée sur Semaine,
  Mois et Année ; **pas sur Jour** (des barres horaires ne se comparent pas à un objectif
  journalier — le total y est comparé à la place). L'axe est étiré pour inclure le repère, sinon la
  ligne serait rognée dans le cas normal, celui où le foyer est **sous** la cible. Sur Année le
  repère est **plat** (N × 145 × 30,44 j) et non un escalier en jours réels : la contrepartie
  (février se compare à un mois moyen) est dite en clair dans l'aide.
- **Taille du foyer réglable** dans le hero (stepper +/−, `householdSize` du store `settings`,
  défaut 3) : `min-width: 2ch` sur la valeur pour que le passage de 9 à 10 ne déplace pas les
  boutons, et une légende dont le **texte est identique sur les quatre périodes** (elle ne dépend que
  de N), donc aucun saut au changement d'onglet.
- **Les deux unités partout** : `formatVolume` et `formatFlow` rendent désormais L **et** m³, le
  m³/h étant celui de la fiche constructeur (2 m³/h maxi). **Trois décimales sous le mètre cube**
  (3 L → « 0,003 m³ ») pour ne jamais écrire « 0,00 » sur une valeur non nulle — la règle « absent
  n'est pas zéro » appliquée à l'arrondi ; deux au-delà. Le **zéro exact reste nu** (« 0 L »,
  « 0 L/h ») : le m³ n'y apprend rien. Le débit garde trois décimales sur toute sa plage, parce que
  le pas du débitmètre (36 L/h = 0,036 m³/h) est **constant**, contrairement à la précision utile
  d'un volume.
- **Le total affiché vient de l'état, pas de la somme des barres.** Un écart criant entre le
  compteur et la somme des barres a fait préférer `state.todayL/weekL/monthL`
  comme source de vérité, la somme des pas mesurés ne servant que de repli quand le champ exact
  manque. L'écart est expliqué **à côté du total, en permanence** (« Graphique : 9 mois sur 12
  mesurés ») plutôt que signalé par une alerte qui apparaîtrait et disparaîtrait. La mention est
  simplement omise quand tout est mesuré — insertion et retrait mesurés sans un pixel de décalage
  sur le total et le repère ; le résumé accessible, lui, garde toujours le fragment.

Une précision qui compte pour lire ce graphique : **le repère de moyenne ne compare que l'eau
filtrée**, qui ne représente ici qu'une partie de l'eau de la maison (voir
`../3_plugins/3_12_comap-proteo.md`). Il peut dire « dans les clous » quand la facture dit l'inverse.

### Mise à jour 2026-09-17 (quater) — vue Chauffage (`/heating`)

Nouvelle rubrique du rail, **après Eau** : deux installations techniques qu'on consulte, voisines
dans la tête comme dans la chaufferie (`lib/navItems.ts`, route `/heating`, clé `nav.heating`).
Icône **`radiator`** et non `heatpump` : à 18 px, le rectangle barré d'un trait de `heatpump` ne se
lit pas — il ressemble à n'importe quel boîtier. Le radiateur a ses **ailettes verticales** et ses
**pieds qui dépassent**, pour ne pas se confondre avec `shutter`, seul autre cadre à lignes du rail
et dont les lignes sont horizontales.

La page n'a que **deux étages** :

1. **La machine et son historique, côte à côte en tête** — ce qui n'appartient à aucune pièce et ne
   se lit qu'ici. Deux colonnes au-delà de **1040 px**, le même seuil que les vues Eau et Énergie,
   pour que les trois pages se comportent pareil à la même largeur de fenêtre. Le `stretch` par
   défaut de la grille est **gardé** : côte à côte, les deux cartes font la même hauteur.
   `align-items: start` donnait une machine plus courte de 68 px que l'historique, et deux bords bas
   décalés qui cassaient la ligne.
2. **Les appareils dans leurs pièces**, par `RoomBands kind="climate"` — comme Lumières et Ouvrants.

**Il n'y a PAS de liste de zones.** La première version en avait une, et elle redisait les mêmes
appareils que les bandes de pièces trente centimètres plus bas, dans un autre ordre : on cherchait
deux fois, et on réglait à un endroit ce qu'on lisait à l'autre. Un appareil de chauffage se règle
désormais **là où il est dans la maison**, point. Corollaire : la sonde d'ambiance de la zone 1
n'apparaît nulle part — ce n'est pas un objet connecté, c'est une commande filaire du boîtier.

La machine et l'historique **ne sont pas des appareils** : ils ne passent pas par le registre ni par
le WebSocket, la page les redemande elle-même au rythme du sondage serveur
(`GET /api/plugins/melcloud/{system,history}`, voir `../3_plugins/3_13_mitsubishi-melcloud.md`).
Aller plus vite que lui relirait la même chose. Plugin éteint ou compte non lié : la page **garde
ses appareils et tait la partie machine**, elle ne s'effondre pas.

**Carte machine** (`HeatingUnitCard.vue`) : les lignes `icône | libellé | valeur` de la vue Météo,
deux colonnes quand la carte est large, **dix lignes toujours présentes dans le même ordre**. Une
machine qui se met à dégivrer allume une ligne déjà là, elle ne pousse rien vers le bas. La version
précédente serrait quatre mesures sur une ligne de 14 px et alignait quatre pastilles muettes en
dessous : illisible, et surtout elle **taisait la moitié** de ce que la machine dit (température de
condensation, circulateurs comptés, et les deux appoints électriques — qui ne coûtent pas la même
chose — fondus en un seul voyant). Un état inactif **garde sa ligne et affiche un tiret** : on lit
« non, l'appoint ne tourne pas » aussi vite que le contraire, là où une pastille éteinte se confond
avec une pastille qu'on n'a pas remarquée.

**Graphique** (`HeatingHistoryChart.vue`) : **48 h** de part de chaque heure passée à chauffer, avec
la température extérieure par-dessus — les deux ensemble font le seul récit intéressant, une machine
qui tourne beaucoup par 12 °C ne disant pas la même chose qu'une qui tourne beaucoup par −5 °C.
**Aucun kWh** : cette installation n'a pas de compteur. Hauteur de tracé fixe et **toujours 48
créneaux**, que l'historique soit vide, jeune ou complet ; une heure jamais sondée reste un **tiret
en pointillé**, parce qu'une barre à zéro dirait « mesurée, elle n'a pas chauffé », ce qui serait
faux.

#### Deux leçons de mise en page, qui valent au-delà de cette vue

**1. Un contrôle dessiné pour le panneau étroit de la scène 3D ne se transpose pas tel quel sur une
page pleine.** `ClimateControl.vue` vit dans le panneau latéral, où sa largeur est contrainte ;
réemployé au milieu d'une page, il s'est étalé — **937 px pour six nombres** (mesure de session).
D'où un composant propre à la vue (`HeatingControl.vue`) plutôt qu'un réglage de plus sur l'ancien.
La question à se poser avant de réutiliser un contrôle de panneau : *sa largeur était-elle une
décision, ou juste la largeur du panneau ?*

**2. Les commandes d'une ligne de `RoomBands` prennent leur propre rangée** — `grid-column: 1 / -1`,
comme le curseur d'une lampe ou les touches d'un ouvrant. La première version les posait **dans la
colonne du statut** en `flex: 0 0 auto` : ne rétrécissant jamais, elles **débordaient sur la pastille
de liaison et sur l'état** dès que la carte se resserrait. Ce n'est pas un réglage de `gap` à
trouver : tant que les commandes partagent une colonne avec du texte, il existe une largeur où elles
se marchent dessus.

S'y ajoute une erreur de **vocabulaire** corrigée au passage : boutons ronds et pastille d'état,
deux formes que cette application n'emploie nulle part ailleurs. Les vues Ouvrants et Médias ont des
touches **carrées à coins arrondis de 36 px** (`.key`) et mettent leur état **en texte à la suite du
statut** (slot `status-after`, `climate.actions.*`) ; c'est repris tel quel. La consigne est répétée
**entre les deux touches** — ce qu'on règle doit être sous les doigts qui le règlent — en largeur
fixe (`6.5ch`), pour que passer de 9,5 à 10,0 n'écarte pas les touches.

Les commandes n'apparaissent d'ailleurs pas pour les zones MELCloud, qui sont en lecture seule :
`HeatingControl` ne rend **rien** (pas même une rangée vide) si l'appareil ne déclare ni
`target_temp` ni `hvac_mode`. La vue est donc prête pour un thermostat pilotable sans promettre de
boutons pour une machine qui les refuserait.

**Réglages** : carte « Mitsubishi MELCloud » (`MelcloudLinkCard.vue`, montée par `PluginSection`
comme Hue, Nest, Enphase, Tesla et Renault) — e-mail, mot de passe, « Lier le compte », puis
« Compte lié · n machines » et le nombre de zones publiées. Elle dit explicitement que le mot de
passe ne traverse le serveur qu'une fois et n'est jamais enregistré, et que la lecture est seule.

Sources : `apps/web/src/views/HeatingView.vue`,
`apps/web/src/components/heating/{HeatingControl,HeatingUnitCard,HeatingHistoryChart}.vue`,
`apps/web/src/components/MelcloudLinkCard.vue`, `apps/web/src/components/controls/ClimateControl.vue`,
`apps/web/src/lib/{navItems,strokeIcons}.ts`, `apps/web/src/router/index.ts`,
`apps/web/src/api/transport.ts`. Tests : `apps/web/src/components/heating/HeatingControl.test.ts`,
`apps/web/src/components/controls/ClimateControl.test.ts`.

### Mise à jour 2026-09-18 (3) — les crédits de la carte du radar démarrent repliés

La carte des précipitations de la vue Météo (`components/weather/RainRadar.vue`) montrait ses
mentions dépliées à l'arrivée : une bande de texte en travers du bas de la carte, alors que la carte
du véhicule les replie depuis le 2026-09-14. Même traitement ici, mais par un autre chemin : poser
`maplibregl-compact` sur `.maplibregl-ctrl-attrib` juste après `new Map(...)` empêche MapLibre de
jamais déplier — une ligne, sans drapeau ni événement. Le bouton ⓘ continue de basculer au clic, et
le repli survit au changement de thème (qui recharge le style). Mécanisme et piège détaillés dans
`../6_faq/6_0_pieges-outillage.md` (« l'attribution MapLibre », mise à jour du 2026-09-18).

Sources : `apps/web/src/components/weather/RainRadar.vue`.

### Mise à jour 2026-09-19 — l'aspirateur entre dans la vue Robots, et trois boutons qui débordaient

La vue Robots ne listait que le kind `mower` ; elle accueille maintenant aussi les `vacuum`, comme
l'annonçait la note du 2026-09-16 (« l'aspirateur y aura sa place »). Premier robot réel :
un Roomba Combo ([../3_plugins/3_14_irobot-roomba](../3_plugins/3_14_irobot-roomba.md)).

**La carte aspirateur est volontairement plus COURTE que celle de la tondeuse**, et c'est la seule
décision de dessin qui compte ici. Le contrat `vacuum` ne porte que quatre choses — activité,
batterie, bac, erreur. Donc : pas de **carte satellite** (le robot ne dit pas où il est), pas de
**journal** (il ne déclare pas la capacité), pas de **compteurs de vie**. Imiter la tondeuse aurait
demandé d'afficher ces sections vides, c'est-à-dire de **mentir sur ce qu'on sait de lui**. Le
langage visuel, lui, ne change pas : même `.rcard`, même en-tête icône / nom / marque · modèle avec
pastille d'activité à droite, même grand chiffre de batterie et sa jauge rouge sous 20 %, mêmes cases
`.stat` (ici « Bac » et « Connexion »), mêmes pilules de geste selon les capacités. Et la **ligne
d'erreur garde sa place même vide**, comme sur la tondeuse : rien ne se décale quand une panne tombe.

Une seule liste vide pour les deux kinds : le message « aucun robot » n'apparaît que si **ni**
tondeuse **ni** aspirateur. `displayName`, `has`, `makeAndModel` et `busy` ont été élargis de
`MowerEntry` à `DeviceEntry` — aucun d'eux ne lisait quoi que ce soit de propre à la tondeuse.

**Le bug d'interface que ce plugin a révélé, et qui n'avait rien à voir avec lui.** Dans le panneau
d'appareil de la vue Maison, le contrôle `VacuumControl` déborde de **47 px** : Vuetify pose
`flex-shrink: 0` sur tout `v-btn` — ses boutons savent grandir, jamais rétrécir. À trois boutons
(l'aspirateur est le seul contrôle qui en ait trois, la tondeuse n'en a que deux), la rangée réclame
**342 px là où le panneau en offre 294**, et « Localiser » sort du cadre, **inatteignable**. Le
panneau étant de largeur fixe, agrandir la fenêtre n'y change rien : vérifié identique à 1024 et à
1280 px.

Correctif minimal : `flex-shrink: 1; min-width: 0` sur les **deux boutons à texte** seulement — les
libellés se resserrent, la hauteur de rangée ne bouge pas (56 px). Vérifié à 800 / 1024 / 1600 px
et dans les deux thèmes : débordement 0, rangée à 56 px, aucune erreur console.

**Pourquoi personne ne l'avait vu** : le sous-item `vacuum` de la simulation est **décoché** dans la
maison de démo, donc le contrôle n'avait jamais été affiché. Le bug attendait le premier aspirateur
réel. À retenir au-delà de ce cas : **un kind exclu du mock est un pan d'UI que personne ne regarde**
— et la première mise en service d'un vrai appareil sert aussi de recette pour son contrôle.

Sources : `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/controls/VacuumControl.vue`,
`apps/web/src/components/IrobotLinkCard.vue`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-19 (bis) — deux cases de serpillière, sous condition de capacité

La carte aspirateur de la vue Robots gagne **deux cases `.stat`** — « Patin » (Posé / Retiré) et
« Eau » (un pour cent) — et le contrôle `VacuumControl` du panneau d'appareil **une ligne**, qui dit
les deux d'un coup. Rien d'autre ne bouge.

Ce qui mérite d'être noté, c'est la **condition**. Les deux cases sont enveloppées d'un
`v-if="has(v, 'mop')"`, et la ligne du contrôle d'un `descriptor.capabilities.includes('mop')` :
elles n'existent **que pour un robot qui lave**. C'est la suite directe de l'arbitrage de la carte
courte pris le matin même — un Roomba **sec** n'a ni patin ni réservoir, et deux cases à « — »
vaudraient **moins que rien** : elles feraient croire à une donnée manquante là où il n'y a rien à
mesurer. La capacité ne sert pas à filtrer l'état (le serveur publie les champs de toute façon),
elle sert exactement à ça : décider si la question a un sens pour cet appareil.

Quand la question a un sens mais que la réponse manque, les deux affichent le tiret cadratin
habituel (`EMPTY`) : `mopAttached` absent, `tankLevel` absent **ou `null`** — le `null` étant le
réservoir **retiré**, que le serveur efface volontairement plutôt que de laisser une valeur périmée
(cf. [../3_plugins/3_14_irobot-roomba.md](../3_plugins/3_14_irobot-roomba.md)). Les deux cas
tombent sur le même affichage, et c'est voulu : dans les deux cas le geste est le même, aller voir
la machine.

Dans le contrôle, c'est **une ligne de légende à place fixe** et non une section : un renseignement,
pas un réglage — on ne pose ni patin ni eau depuis l'interface. Elle se glisse entre la jauge de
batterie et la rangée de boutons, dont l'empreinte (56 px) ne change pas.

Vocabulaire : `vacuum.mopPad` / `mopOn` / `mopOff` / `tank` dans les deux fichiers de langue
(« Patin · Posé / Retiré », « Eau · 80 % »).

Sources : `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/controls/VacuumControl.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`, commit `ec07f7e`.

### Mise à jour 2026-09-21 — vue Animaux, et quatre façons de faire bouger une carte

Nouvelle entrée de rail `pets` (icône `paw`, après `robots`) et vue `PetsView.vue` : deux kinds
dans la même page, comme la vue Robots réunit tondeuse et aspirateur. Ce qui les rassemble est
l'usage — on vient voir si le chat a mangé et bu — pas leur contrat. Chaque carte réutilise le
contrôle du panneau d'appareil 3D (`PetFeederCard`, `PetFountainCard`) plutôt que de redessiner
les mêmes lignes.

Quatre défauts de tenue ont été trouvés en MESURANT, tous signalés par l'utilisateur d'abord :

**1. Une grille en colonne `auto` se laisse élargir par son contenu.** `.feeder { display: grid }`
suffisait à ce qu'un message d'erreur en une seule ligne fasse déborder la carte
(`scrollWidth > clientWidth`, mesuré) : une piste `auto` se dimensionne sur le `max-content` de son
contenu. `grid-template-columns: minmax(0, 1fr)` l'en empêche. À retenir pour **toute** carte qui
peut recevoir un texte de longueur inconnue.

**2. Un message d'erreur ne doit pas AJOUTER une ligne.** Il en remplace une : les deux cartes ont
UNE ligne d'alerte, toujours présente, qui dit le fait le plus urgent (panne > manque > tout va
bien). La carte garde sa hauteur (405 px mesurés, identique dans les trois états), le compte de
lignes ne change pas, la page non plus. Et le texte **défile avec un fondu** (`MarqueeText`, le
composant des cartes médias) au lieu d'être coupé : un libellé de fabricant se lit en entier.

**3. Une largeur en `ch` suit la taille de police.** Les trois colonnes de droite (valeur,
contrepartie, complément) étaient en `ch` ; l'heure du prochain repas étant en 13 px là où les
compléments sont en 12, sa colonne était 6 px plus large et TOUTE sa ligne glissait. En pixels
(72 / 62 / 88), les colonnes tombent au même endroit sur chaque ligne des DEUX cartes — vérifié à
800, 1024 et 1280 px.

**4. `min-width` est un plancher, pas un plafond.** « 0 s en moyenne » dépassait ses 62 px et
poussait la valeur voisine de 25 px, sur une ligne sur trois seulement. Les colonnes de complément
portent donc `max-width` + `overflow: hidden` : aucun contenu ne peut plus déplacer personne.

Enseignement d'ensemble : **l'alignement vertical des unités est ce qui rend une carte lisible d'un
coup d'œil.** Une valeur bien formatée dans une colonne qui bouge vaut moins qu'un chiffre brut
dans une colonne stable. D'où l'ordre constant, partout : valeur, contrepartie, complément — et
l'heure du prochain repas renvoyée en dernière colonne pour ne pas casser cet alignement.

#### Retour sur une commande

Le retour manquait complètement : on appuyait, rien ne se voyait. L'infrastructure existait
pourtant déjà (`optimisticPatch`, `pending` par appareil, retour arrière et notification
automatiques dans `stores/devices.ts`) — les cartes ne s'y branchaient pas. Trois manques comblés :
les cas `pet_feeder` / `pet_fountain` dans `lib/optimistic.ts`, `:pending` transmis par la vue, et
un indicateur d'attente **par bouton** (un `ref` local retient lequel a été poussé, `pending` étant
par appareil). L'indicateur est le `loading` de Vuetify et non une roulette ajoutée à côté du
texte : il recouvre le bouton **sans changer sa taille**.

Deux détails de patch optimiste qui valent au-delà de PetKit : servir une ration bascule
`feeding: true` mais **n'avance pas le compteur du servi** (la machine peut verser moins que
demandé, et un chiffre qui saute ensuite est pire que pas de chiffre) ; et régler le régime d'une
pompe pose aussi `on: true`, parce que c'est la même trame qui porte les deux.

Sources : `apps/web/src/views/PetsView.vue`, `apps/web/src/components/controls/PetFeederCard.vue`,
`apps/web/src/components/controls/PetFountainCard.vue`, `apps/web/src/lib/optimistic.ts`,
`apps/web/src/lib/navItems.ts`, `../3_plugins/3_17_petkit.md`.

### Mise à jour 2026-09-23 (20) — vue Automatisations : une liste, et l'éditeur sur une page à lui

Nouvelle entrée du rail **Automatisations** (icône `automation`, `4_0_langage-visuel.md`), placée
**juste avant les Réglages** : ce que la maison fait toute seule se règle et se vérifie, ça ne se
pilote pas au quotidien (`lib/navItems.ts`). Modèle et moteur : `../1_architecture/1_8_automatisations.md` ;
store : `../1_architecture/1_4_app-web.md`.

**Deux routes** (`router/index.ts`) : `automations` = `/automations`, la liste ; `automation-edit` =
`/automations/:id`, l'éditeur (`props: true`, `meta: { nav: 'automations' }`). Le rail
(`layout/NavRail.vue`) allume désormais l'entrée de `route.meta.nav ?? route.name` : une sous-page
nomme sa vue dans `meta.nav` et garde l'entrée allumée. Premier usage de ce mécanisme.

#### La liste (`views/AutomationsView.vue`)

En-tête : nombre de règles actives, nombre « à vérifier » (santé autre que `ok`), **toujours affiché
et estompé à 0** pour que le compteur ne change pas d'apparence, et le bouton « Nouvelle
automatisation ». Dessous : recherche (nom, phrase, appareils et pièces nommés) et filtre `Segmented`
Toutes / Actives / Désactivées / À vérifier. Ordre fixe par nom. **Aucun panneau latéral** : une ligne,
ou le bouton de création, **navigue** vers l'éditeur.

Une ligne (`components/automations/AutomationRow.vue`) a une **empreinte fixe** de 64 px : nom et
phrase (`describeAutomation`) sur deux lignes, une colonne de santé à largeur réservée (le point
toujours là, le mot seulement s'il y a quelque chose à dire), une colonne prochaine / dernière
exécution, l'interrupteur **hors du bouton de la ligne** (basculer n'ouvre pas l'éditeur), un chevron.
Désactivée, seuls l'icône et le texte s'estompent ; l'interrupteur reste net.

**Téléphone (≤ 600 px)** : les compteurs se taisent, le bouton de création ne garde que son `+`, le
filtre prend toute la largeur, et la ligne se réduit à nom / phrase / point / interrupteur (mot de
santé, horaires et chevron masqués). Décidé par la **largeur de l'écran, jamais par l'état** : rien ne
bouge en cours d'usage.

Mesuré (2026-09-23, rapporté par la session) : basculer une ligne ne déplace rien
(`getBoundingClientRect`), aucun débordement horizontal à 1280 / 1024 / 853 / 768 / 375 px, les deux
thèmes, console propre.

**Ligne enrichie (2026-09-23, à la demande de l'utilisateur** — sans panneau, la liste a de la place).
La ligne passe à **104 px fixes** : le nom, puis trois lignes étiquetées « Quand », « Sauf si »,
« Alors » (`describeTrigger`, `describeUnless`, `describeActions` de `lib/automations.ts`, chacune en
`MarqueeText`, « — » quand il n'y a pas d'exception : la hauteur ne dépend pas du contenu). À droite, une
colonne de largeur réservée (30 ch, 24 ch sous 1 100 px) : **Prochaine** (jour, date, heure),
**Dernière** (âge et issue : exécutée, partielle · n erreurs en rouge avec le détail en infobulle,
sautée, échec), **État** (point de santé et, en clair, ce qui manque ou ne répond pas, nommé). Sur
téléphone, cette colonne et le chevron disparaissent. Mesuré : bascule et exécution ne déplacent rien,
104 px et aucun débordement à 1280 / 1024 / 853 / 375 px.

**Ordre des sections : Quand, Alors, Sauf si (2026-09-23, décision de l'utilisateur).** Partout où la
règle se lit — colonnes de la page d'édition, lignes étiquetées de la liste, et la phrase
`describeAutomation` (« Quand → Alors · sauf si … ») : on dit d'abord ce qui arrive, l'exception vient
en dernier. Le schéma (`unless` avant `actions`) n'a pas changé, seul l'affichage suit cet ordre.

#### L'éditeur : essayé dans le panneau, écarté, passé en page

La première version logeait l'éditeur dans le panneau latéral (`SidePanel`) de la liste, toujours
présent en paysage large pour que rien ne bouge à l'ouverture. **Écarté le 2026-09-23 avec
l'utilisateur** : un panneau d'environ 300 px devient trop étroit dès que plusieurs « Sauf si » et
plusieurs actions s'empilent. L'éditeur a donc une page à lui.

`views/AutomationEditView.vue` : `:id` = l'id de la règle, ou `new`. Une règle neuve reçoit son id
**une seule fois**, à l'ouverture (`crypto.randomUUID()` ; le serveur fait un upsert sur `PUT /:id`) ;
après son premier enregistrement, l'adresse devient la sienne par `router.replace`, sans remonter
l'éditeur (même route, composant réutilisé). Adresse ouverte directement, avant que la liste soit
arrivée → `store.load()` d'abord ; id inconnu → message `automations.notFound` et un bouton de retour.

`components/automations/AutomationEditor.vue`, devenu une page :

- **En-tête fixe** : retour à la liste, icône et nom, puis **quatre boutons de 132 px fixes** —
  Exécuter, Supprimer, Annuler, Enregistrer. Exécuter et Supprimer sont en `visibility: hidden` tant que
  la règle n'existe pas côté serveur : ils apparaissent dans leur place réservée après le premier
  enregistrement, sans rien pousser. Largeur fixe aussi pour que « Confirmer » (suppression en **deux
  temps** : le premier appui arme, le second dans les 4 s confirme) ou « Enregistrement… » prennent la
  place du libellé sans décaler le voisin. Sous les boutons : la phrase **en direct** sur deux lignes
  réservées, puis une ligne d'aide (ce qui manque, ou « non enregistré »).
- **Annuler** revient au dernier état enregistré (ferme la page pour une règle neuve jamais
  enregistrée).
- **`.edit__cols`** : trois colonnes **« Quand » / « Sauf si » / « Alors »** côte à côte, chacune
  défilant pour son compte — une colonne qui se remplit ne pousse pas les autres. **Sous 900 px**, elles
  s'empilent et c'est toute la zone qui défile. **Téléphone (≤ 600 px)** : les quatre boutons passent en
  deux rangées de deux.
- Brouillon **local** au composant : un message du serveur qui arrive pendant la frappe ne l'écrase pas.

**Piège rencontré** : dans une colonne en `flex-direction: column`, un champ Vuetify (`v-select`, qui
porte `flex: 1 1 auto`) s'étirait sur **toute la hauteur de la colonne**. Correctif :
`.col > * { flex: 0 0 auto }`. À retenir pour tout conteneur flex vertical qui accueille des champs
Vuetify.

Autres briques, dans `components/automations/` : `PredicateEditor.vue`, `ActionEditor.vue` (cible
nommée ou sélection ; la liste de l'exception « sauf les pièces où… » garde sa place, masquée, quand
l'exception est coupée), `AddMenu.vue` (menu « + Ajouter », l'idiome de `ParkingRows.vue`),
`DayPills.vue` (sept pastilles, lundi en tête, valeurs de `Date.getDay()` ; aucun jour coché = tous
les jours).

Mesuré sur la maquette (`VITE_INPROCESS_MOCK`, 2026-09-23, rapporté par la session) : ajouter six
exceptions ne fait grandir que la colonne « Sauf si » (rectangles des autres colonnes et boutons de
l'en-tête inchangés) ; nouvelle → enregistrer → l'adresse prend l'id, Exécuter et Supprimer apparaissent
dans leur place ; Annuler rétablit le brouillon ; aucun débordement horizontal à 1920, 1024 (trois
colonnes de 291 px), 853 (empilé) et 375 px (en-tête de 318 px, boutons en 2 × 2) ; thèmes clair et
sombre ; console propre sur l'aller-retour liste ↔ édition.

Sources : `apps/web/src/views/{AutomationsView,AutomationEditView}.vue`,
`apps/web/src/components/automations/*.vue`, `apps/web/src/components/layout/NavRail.vue`,
`apps/web/src/lib/{navItems,automations}.ts`, `apps/web/src/router/index.ts`,
`apps/web/src/i18n/locales/{fr,en}.json` (`nav.automations`, `automations.*`), arbre non commité après
0f943a0.

### Mise à jour 2026-09-24 — vue Météo : un autre lieu, des favoris

Demande de l'utilisateur : chercher un autre lieu, rappeler des lieux favoris, la maison par défaut,
la dernière sélection gardée, et **toujours voir quel lieu on regarde**.

- **Barre de lieux** (`components/weather/WeatherPlaces.vue`) dans le slot de `PageHeader` : à gauche
  des pastilles, à droite la recherche. Pastille **Maison** (icône maison) toujours première, puis
  les **favoris** (épingle + nom, × pour retirer), puis — si le lieu affiché n'est pas favori — une
  **pastille provisoire** en pointillés avec une étoile pour le garder. La pastille allumée dit le
  lieu regardé. Pastilles de même géométrie (épingle partout) : ajouter ou retirer un favori ne
  décale rien — mesuré, la première version perdait l'épingle et poussait « Maison » de 20 px.
  Une seule rangée qui défile de côté : l'en-tête ne grandit jamais.
- **Recherche** : à partir de 2 caractères, 300 ms d'attente, réponses périmées ignorées (ticket) ;
  la liste s'ouvre PAR-DESSUS la page (`mousedown.prevent` pour que le clic passe avant le flou),
  flèches / Entrée / Échap.
- **État** : `useWeatherPlaces()` (`composables/useWeather.ts`, `createSharedComposable`) —
  `kasbah.weather.place` (`null` = la maison, le défaut) et `kasbah.weather.favorites` en
  localStorage, **par navigateur** comme les recherches récentes de la Musique. `useWeatherAt(place)`
  lit `Transport.getWeatherAt` toutes les 10 min et **vide** ses données au changement de lieu :
  rien de Paris ne reste affiché sous le nom de Tokyo. Le widget d'accueil et la scène 3D restent
  sur la maison (`useWeather()` inchangé).
- **La vue** (`views/WeatherView.vue`) prend l'état, les prévisions et l'attribution à la source du
  lieu ; ailleurs, air et pollens gardent leurs cartes (tirets hors d'Europe). La carte
  « Maintenant » porte en tête le **nom du lieu** (maison ou épingle, région en retrait) à la place
  du mot « Maintenant ». Les heures s'écrivent dans le **fuseau du lieu**
  (`d(date, { key, timeZone })`, « aujourd'hui » comparé dans ce fuseau) ; l'heure du relevé
  ajoute le décalage (« 15:45 UTC+9 ») quand le fuseau n'est pas celui du navigateur.
- **Radar** (`RainRadar.vue`) : prop `away` — épingle au lieu de la maison — et `jumpTo` sur le
  nouveau centre, même zoom.
- **Largeurs** : sous 1100 px la barre passe sous le titre, sur toute la largeur (à 768 px elle
  n'avait plus que 80 px de pastilles) ; sous 560 px, pastilles au-dessus de la recherche. Vérifié
  à 1920, 768 et 375 px, deux thèmes, sans débordement.

### Mise à jour 2026-09-27 — vue Météo : la tendance des 24 heures d'un coup d'œil

Demande de l'utilisateur : avec seulement les icônes et les chiffres, il fallait lire les 24 colonnes
une à une pour comprendre l'évolution. Une **bande de tendance** de 48 px se pose sous les colonnes,
sur la même grille (`grid-column: 1 / -1`), et défile avec elles quand la bande déborde en largeur.
Elle garde sa hauteur même sans prévisions ; elle reste alors vide.

- **Courbe des températures** : lissée (Catmull-Rom converti en Bézier), un point par centre de
  colonne, avec un remplissage léger dessous. Sa **couleur suit la température** sur une échelle
  **fixe**, de 5 °C (`--cat-media`, bleu) à 28 °C (`--cat-light`, ambre), par `color-mix`, dans un
  dégradé horizontal (`gradientUnits="userSpaceOnUse"`) : une journée fraîche reste bleue même à son
  pic. Ce sont les teintes des barres de la semaine.
- **Pluie** : une barre par heure au pied de la bande. La hauteur est la **racine des millimètres**,
  plafonnée à 4 mm/h, pour que la bruine se voie encore ; l'opacité suit la probabilité. Une pluie
  sans probabilité ≥ 10 % (le « best match » en donne parfois une nulle) se voit donc quand même.
- **Nuit** : les heures sans soleil (`isDay`) sont grisées en fond, sur toute la hauteur des colonnes
  et de la bande, en une seule bande par nuit.
- **Min / max** : un point bleu à l'heure la plus froide et un point ambre à la plus chaude (première
  occurrence), et le chiffre de la colonne prend la même couleur. Les points sont en **HTML**
  par-dessus le SVG, qui est étiré (`preserveAspectRatio="none"`) : un `<circle>` y deviendrait une
  ellipse. Pour la même raison, les traits portent `vector-effect="non-scaling-stroke"`.
- **Graduations 1 mm / 4 mm** : des pointillés discrets, **seulement quand il pleut** dans les
  24 heures (ça change l'apparence, pas la mise en page). La valeur est posée **sur sa ligne**, dans une
  pastille du fond de la carte (`--surface` à 85 %), au bord droit : sans cette pastille, le « 1 mm »
  était illisible quand la courbe passait dessus (retour de l'utilisateur).

Écartée : faire porter les chiffres par la courbe (comme Apple Météo). Ils bougeraient d'une heure à
l'autre, ce qui va contre la règle « rien ne bouge ». Mesuré dans la preview : points à ±1 px du
centre de leur colonne ; en 1920 × 945, la page tient toujours sans défiler (le radar cède les 48 px).

Sources : `apps/web/src/views/WeatherView.vue` (`trend`, `rainH`, `RAIN_TICKS`, `tempTint`).

### Mise à jour 2026-09-28 — vue Météo : la lune dans la carte « Soleil et lune »

Demande de l'utilisateur : avoir les informations sur la lune quelque part. Open-Meteo n'en donne
aucune ; elles sont **calculées dans le navigateur** (`lib/moon.ts`, calcul pur comme
`packages/shared/src/house/sun.ts`), avec les formules « basse précision » de SunCalc d'après Meeus :
position à environ un degré près (quelques minutes sur un lever), phase à quelques heures près.

- **Où** : sous un filet, en bas de la carte Soleil, renommée **« Soleil et lune »**
  (`weather.sunMoon`, qui remplace `weather.sun`, utilisée nulle part ailleurs). Pas de carte à
  part : la première rangée du mode large n'a pas de place.
- **Quoi** : un **disque** qui dessine la phase (demi-disque éclairé côté soleil, fermé par un
  terminateur en demi-ellipse de rayon `r·|1 − 2f|` ; en miroir quand la lune décroît, et encore
  dans l'hémisphère sud, pour un lieu choisi ailleurs) ; le **nom de la phase** (huit noms, les
  quatre principaux valent un jour de part et d'autre de leur instant) et la **part éclairée** ; les
  **prochains lever et coucher** à partir de maintenant (pas ceux « du jour » : la lune se lève
  ~50 min plus tard chaque jour, et certains jours n'ont pas de lever) ; la **prochaine pleine ou
  nouvelle lune**, celle qui vient en premier.
- **Horizon** : le lever se prend quand le centre passe à +0,125° en hauteur géocentrique. C'est la
  parallaxe (~0,95°) moins la réfraction et le demi-disque.
- **Couleur** : la part éclairée a une teinte de lune **fixe** (`#f3efe4` teinté de `--cat-light`),
  cerclée d'un liseré. La couleur du texte la rendait noire en thème clair.
- **Place** : en 1920 × 945, la lune faisait dépasser la page de 14 px ; l'arc du soleil passe de 96 à
  72 px dans ce mode seulement. Le radar tombe de 397 à 347 px de haut.

Vérifié par `lib/moon.test.ts` : nouvelle lune du 8 avril 2024 et pleine lune du 23 avril 2024 (instants
USNO) retrouvées à moins de 6 h, et lever de pleine lune vers le coucher du soleil à Paris. Le côté
éclairé du disque a été contrôlé par `isPointInFill` (croissant, quartier, gibbeuse).

Sources : `apps/web/src/lib/moon.ts`, `apps/web/src/lib/moon.test.ts`, `apps/web/src/views/WeatherView.vue` (`moon`).

#### Complément 2026-09-28 — la phase dans les 7 jours, « Aujourd'hui » qui tient

- **Un disque de 18 px par jour**, entre le risque de pluie et le minimum, pris à **midi** du jour
  (le point quotidien commence à minuit local) ; le survol donne la phase et la part éclairée. Le
  disque est sorti en composant (`components/weather/MoonDisc.vue`), partagé avec la carte
  « Soleil et lune ».
- **« Aujourd'hui » était coupé** (« Aujour… ») dans sa colonne de 52 px, bien avant la lune ; il
  lui faut 70 px. La colonne du jour devient `minmax(40px, 72px)` et la barre d'amplitude
  `minmax(48px, 1fr)`. Toutes les lignes ont la même largeur, donc les mêmes colonnes. Le pas
  « maximiser » de la grille sert les pistes non flexibles avant les `fr` : le nom prend ses 72 px,
  puis la barre reçoit le reste.
- **De 760 à 1099 px** (semaine sur une demi-largeur), les lignes demandaient 302 px pour 268
  disponibles et débordaient de 33 px. Dans cette plage, « Aujourd'hui » s'abrège en **« Auj. »**
  (`weather.todayShort` ; « Today » en anglais) et la colonne pluie passe de 44 à 36 px.
  Mesures de la barre : 413 px à 1920, 133 px à 1000, 18 px à 760, 52 px à 500. À 760 px, c'est la
  colonne de la lune qui coûte la place ; on peut la masquer dans cette seule plage si c'est gênant.

Sources : `apps/web/src/components/weather/MoonDisc.vue`, `apps/web/src/views/WeatherView.vue` (`dailyMoon`, `.wx-day`).

### Mise à jour 2026-09-27 — vue Agenda : mois, semaine, jour

Nouvelle vue `/agenda` (`apps/web/src/views/AgendaView.vue`), entrée de rail `calendar` placée
**juste après Météo** (`lib/navItems.ts`) : ce qu'on regarde en arrivant, ce qu'il fait et ce qui
nous attend. Données : plugin `agenda` (`../3_plugins/3_22_agenda.md`), lecture seule.

- **Barre de la vue** (l'en-tête commun reste nu : avec les commandes dans son slot, le résumé
  passait sur deux lignes à 800 px) : titre de la période en `flex: 1` coupé par ellipse, puis
  ‹ / Aujourd'hui / › et le `Segmented` Mois · Semaine · Jour, calés à droite. Mesuré au
  `getBoundingClientRect` : positions identiques au pixel dans les trois modes et d'une période à
  l'autre. Titre : « Septembre 2026 », `formatRange` pour la semaine (« 21–27 sept. 2026 »), date
  longue pour le jour.
- **Pastilles d'agenda** sur une ligne de 32 px fixe (défilement latéral au-delà) : toucher masque
  ou montre un agenda ; un flux en erreur remplace la couleur par une alerte (infobulle « dernière
  lecture affichée ») plutôt que d'ajouter une ligne.
- **Mois** (`components/agenda/AgendaMonth.vue`) : **toujours six semaines** à partir du lundi
  (`lib/agenda.ts`, `visibleDays`), la grille garde sa hauteur de février à mars. Le nombre de lignes
  par case se déduit de la HAUTEUR de la grille (`useElementSize`, 20 px par ligne), pas du contenu :
  au-delà, « +n autres ». Journées entières en bandeau teinté, rendez-vous en point + heure (sans
  heure le lendemain d'un rendez-vous de nuit). Jours hors du mois fondus vers `--bg`
  (`color-mix`) — `--surface2` les faisait ressortir en thème sombre. Toucher un jour ouvre la vue Jour.
- **Semaine / Jour** (`AgendaTimeGrid.vue`) : 48 px par heure, arrivée sur 7 h, bande « Journée » de
  hauteur fixe (deux lignes puis « +n »), trait rouge de l'heure actuelle. Les rendez-vous qui se
  chevauchent se partagent la largeur de leur seul groupe (`layoutDay`), durée affichée d'au moins
  30 min ; sous 45 min, titre et heure sur une ligne. `scrollbar-gutter: stable` en tête comme dans
  la grille, pour que les colonnes restent alignées.
- **Fiche** (`AgendaEventDialog.vue`, `v-dialog`) : quand, lieu, agenda, description.
- Mode et agendas masqués = goût DU POSTE : `localStorage` `kasbah.agenda.mode` /
  `kasbah.agenda.hidden`. Les occurrences sont relues à chaque changement de période et toutes les
  5 min ; un échec garde ce qui est affiché. Plugin éteint ou sans agenda : une carte qui mène aux
  Réglages.

Sources : `apps/web/src/views/AgendaView.vue`, `apps/web/src/components/agenda/*.vue`,
`apps/web/src/lib/agenda.ts`, `apps/web/src/stores/agenda.ts`, `apps/web/src/router/index.ts`,
`apps/web/src/lib/strokeIcons.ts` (`calendar`).

### Mise à jour 2026-09-27 — Agenda : sans liseré, passé estompé, agendas ordonnés

- **Plus de liseré à gauche** des pastilles (journées entières du mois, bande « Journée » et
  rendez-vous de la grille horaire) : le fond teinté à 22 % suffit à dire l'agenda. Le
  `padding-left: 8px` qui compensait le liseré dans le mois est parti avec lui.
- **Événements passés estompés** (opacité 0,45, attribut `data-past`) : `isPast(e, now)` de
  `lib/agenda.ts` — un rendez-vous dès sa fin passée, une journée entière le lendemain de son dernier
  jour (fin exclusive). `now` vient de la vue (relu chaque minute) et est passé au mois comme à la
  grille ; un événement en cours ou du jour garde son plein contraste.
- **Ordre des agendas** choisi dans Réglages → Plugins → agenda (flèches), suivi par la ligne de
  pastilles de la vue : voir `../3_plugins/3_22_agenda.md`. L'ordre des occurrences DANS une case
  reste celui de `byDay` (journées entières puis heure), indépendant de l'ordre des agendas.

Sources : `apps/web/src/components/agenda/{AgendaMonth,AgendaTimeGrid}.vue`, `apps/web/src/lib/agenda.ts`
(`isPast`), `apps/web/src/views/AgendaView.vue`, `apps/web/src/components/AgendaLinkCard.vue`.

### Mise à jour 2026-09-28 — la rose du vent pointe là où il souffle

La flèche de la rose (page Météo) était tournée de `windDirDeg`, donc pointait vers l'ORIGINE du vent
— la convention météo, mais à l'opposé de la houle de la piscine en 3D. Elle est tournée de
`windDirDeg + 180` : elle pointe sous le vent, comme une manche à air. Le libellé (« S ») dit
toujours d'où il vient (« vent du S »). Voir `../1_architecture/1_5_scene-3d.md` (mise à jour du
même jour).

Sources : `apps/web/src/views/WeatherView.vue` (carte `wx-wind`).

### Mise à jour 2026-10-01 — vue Météo : vigilance, soleil élargi, crédits sous le radar

- **Vigilance** : une pastille de hauteur fixe (24 px) dans la carte Maintenant, entre la condition
  et le ressenti, teintée de sa couleur (jaune, orange, rouge à 18 %, texte en `--text`) :
  « Vigilance jaune orages · jusqu'à minuit », « +N » s'il y en a d'autres, la liste complète et le
  département au survol. Vert : « Pas de vigilance en cours » ; hors de la métropole : « Vigilance
  Météo-France : métropole seulement ». Vide pendant la lecture, la place reste. Données :
  `useWeatherAlerts` (`composables/useWeather.ts`), route décrite dans
  `../3_plugins/3_10_open-meteo.md`. Une vigilance longue (« orange pluie-inondation · à partir de
  ven. 06:00 ») est coupée par une ellipse à 320 px, et la tablette n'a pas de survol.
- **Soleil et lune débordait** (contenu 305 px pour 285 de large à 1919 × 937, la ligne de la
  lune). En mode « tout tient », la grille passe à **24 colonnes** : la première rangée se partage
  5 / 5 / 4 (Maintenant 362 px, Soleil 362, Vent 286 à 1919) au lieu de 6 / 4 / 4 demi-colonnes.
  Toutes les colonnes de ce mode ont été doublées (semaine et radar 15/25, bas gauche 1/15).
- **Crédits sous le radar** : le bas de page débordait de 13 px (le crédit passait sur le bas des
  cartes), et la vigilance ajoute une source. Le crédit sort de `.wx-bottom` et devient un enfant
  direct de la grille : en mode « tout tient », rangée 4 sous le radar, deux lignes réservées
  (36 px, assez en fr et en en) ; le radar est le seul bloc qui cède de la hauteur (287 px à
  1919 × 937 au lieu de 339, `min-height: 320px` de `RainRadar` levé dans ce mode). En flux, il
  ferme toujours la page, centré (l'`order: 99` ne sert plus).
- **Seuils du mode « tout tient » relevés** de 1400 × 820 à **1770 × 934**, mesurés : à
  1440 × 860, l'ancien seuil coupait 122 px de bas de page et la lune ; à 1670 × 930, la lune
  manquait encore de 17 px et le bas de 19 px (cartes plus étroites, légendes plus hautes). En
  dessous, la page défile. Il reste 5 px de marge en hauteur à 1919 × 937.
- Mesuré dans la preview (simulation) : aucun débordement à 1919 × 937, 1780 × 937 et 1440 × 860, ni aux
  zooms 1,25 et 1,5 (1535 × 750, 1279 × 625) ; pastille lisible en clair et en sombre.

### Mise à jour 2026-10-04 — vue École (`/school`)

Entrée du rail après Agenda (icône `school`) : devoirs, cahier de liaison et publications de la
classe (plugin `toutemonannee`, `../3_plugins/3_23_toutemonannee.md`). Choix tranchés avec
l'utilisateur en itérant sur des données réelles :

- pas de « gros texte » : la taille habituelle de Kasbah ;
- une seule barre : filtres (classes, niveaux — gardés par le serveur) à gauche ; à droite l'heure
  de mise à jour, discrète et cliquable (« Lu à » était ambigu, le bouton rond trop présent pour un
  geste qu'on ne fait presque jamais), puis un `Segmented` en icônes avec pastilles ;
- le prochain jour à rendre : titre en accent + étiquette pleine « demain » — **pas de liseré à
  gauche des cartes** (refusé) ;
- « Afficher les N devoirs passés » compte des devoirs, pas des jours.

Carte de liaison dans Réglages → Plugins → toutemonannee (`SchoolLinkCard.vue`, sur le modèle de
celle de MELCloud). Vérifié : rien ne bouge au cochage (mesure géométrique, 0 décalage), aucun
débordement à 1280 / 1024 / 853 / 375 px, fr et en, clair et sombre.

### Mise à jour 2026-10-19 — vue École : visionneuse des photos

Une photo de publication ouvrait un onglet du navigateur ; elle s'ouvre maintenant dans
`components/ui/PhotoViewer.vue` (générique : `photos`, `title`, `v-model:index`, `null` = fermée),
branchée dans `views/SchoolView.vue` (les vignettes deviennent des boutons).

- Plein écran sur fond noir quel que soit le thème, `Teleport` vers `body`. Barre : titre de la
  publication, « 2 / 5 », zoom −/+, télécharger, fermer. Flèches aux deux bords, **grisées aux
  extrémités, jamais retirées** (règle « rien ne bouge »).
- Navigation : flèches, clavier (←/→, Échap, +/−), glissé d'un doigt à taille normale. Le zoom
  revient à 1× en changeant de photo ; les voisines sont préchargées.
- Zoom 1× à 6× : boutons par paliers, molette et pincement autour du point visé, double-clic
  (1× ↔ 2,5×). Agrandie, la photo se déplace d'un doigt ou à la souris, bornée au cadre. Le
  pincement ne déplace pas en même temps ; le double-tap dépend du navigateur (non garanti au doigt).
- Un clic sur le fond ferme, pas la fin d'un glissé ni un clic sur la photo.
- **Téléchargement par `fetch` → blob → `<a download>`** : un `<a download>` vers une autre origine
  est ignoré (le navigateur ouvrirait la photo). L'hébergeur des photos répond
  `Access-Control-Allow-Origin: *` (vérifié à la mise en place) ; si un jour il refuse, repli sur
  l'ouverture dans un onglet. Nom : « titre de la publication (n).jpg ».
- Icônes ajoutées à `lib/strokeIcons.ts` : `zoomIn`, `zoomOut`, `download`.

Vérifié dans la preview (simulation, photos de test injectées dans le store) : navigation, zoom,
déplacement borné, glissé, fermetures, nom du fichier, vignettes à la même taille qu'avant, rien
ne déborde à 375 px. Gestes tactiles joués par événements pointeur simulés, pas sur un vrai écran.

### Mise à jour 2026-10-11 (9) — vue Courses (`/shopping`)

Nouvelle entrée du rail, **après l'École** (`NAV_ITEMS`, icône `cart`) : la vie de la famille, qu'on
remplit et consulte chaque jour. Le rail et la barre du bas du téléphone étant le même composant, elle
apparaît dans les deux — c'était une demande explicite de l'utilisateur. Route en anglais, `/shopping`.

Une seule page, sans sous-écran : le champ qui cherche et ajoute (propositions posées par-dessus la
page), la liste où une ligne cochée se barre **sur place**, et les habituels (colonne à droite sur un
écran large, bande fixe de 40 px au-dessus de la liste sur un écran étroit). « Terminer les courses »
vit dans le slot de l'en-tête, toujours affiché. Tout ce qui change d'état garde sa place : compteur
rangé en `visibility: hidden` sur une ligne cochée, « − » qui devient corbeille au même endroit, tuile
estompée à la même taille. Détail, modèle et vérifications : `../1_architecture/1_10_liste-de-courses.md`.

Sources : `apps/web/src/views/ShoppingView.vue`, `apps/web/src/lib/{navItems,strokeIcons}.ts`, `apps/web/src/router/index.ts`.

### Mise à jour 2026-10-11 (10) — vue Robots : cartes à l'horizontale

Demande de l'utilisateur : sur grand écran, les cartes de la vue Robots en largeur, comme celles de la
vue Véhicules. Même mécanique (`RobotsView.vue`) : `.robots__scroll` est un conteneur
(`container-type: inline-size`), les rangées de la carte sont regroupées en `.rcard__group`
(énergie, état, côté = station + boutons + journal + réglage, pied = fraîcheur + quota).

- **Téléphone** : les groupes sont en `display: contents` — la pile reste celle d'avant, dans l'ordre
  du DOM (vérifié : même ordre, carte satellite à 220 px). `min-width: 0` passe aussi aux enfants des
  groupes, sans quoi une ligne en `nowrap` élargirait la carte.
- **≥ 720 px de conteneur** : une carte par ligne. Tondeuse : tout à gauche, carte satellite à droite
  sur toute la hauteur (220 px au moins ; `.rcard .rcard__map` pour battre la hauteur de base déclarée
  plus bas). Aspirateur (pas de carte) : énergie et boutons | état.
- **≥ 1100 px** : tondeuse en trois colonnes `'a st map' 'cnt side map' 'f side map'` — les
  **compteurs** descendent sous la batterie (choix de l'utilisateur : la colonne de gauche restait vide,
  la carte passe de 370 à 299 px de haut à 1440 px) ; aspirateur `'a st side'`.
- Journal et réglage du GPS dépliés s'ajoutent dans la colonne du milieu ; la carte satellite s'allonge
  avec elle. Non vu en simulation (la tondeuse simulée n'a ni l'un ni l'autre).
- Vérifié en mode simulé (maison de démo à tondeuse) : aucun débordement à 1900 / 1440 / 1024 / 853 /
  375 px.

### Mise à jour 2026-10-12 — chauffage à l'arrêt : plus de consigne affichée

Demande de l'utilisateur : la carte d'un thermostat arrêté montrait trois fois la même température
(statut « mesurée → consigne », puis la consigne entre les touches − / +), ambigu. Deux causes : le
plugin Nest publiait l'ambiante comme consigne à l'arrêt (corrigé, voir
`3_plugins/3_5_google-nest.md`, mise à jour 2026-10-12), et l'interface montrait une consigne qui ne
s'applique pas.

- **Statut** (`statusLabel` de `apps/web/src/lib/deviceState.ts`, `summarize` de `lib/format.ts`) : à
  l'arrêt (`mode === 'off'`), la température mesurée seule ; « mesurée → consigne » dans les autres
  modes, éco compris.
- **`HeatingControl.vue`** (vue Chauffage) : à l'arrêt, les touches − / + et la consigne sont
  **retirées** (avant : grisées). Les **modes passent devant** la consigne : choisir « Arrêt » la retire
  au bout de la rangée sans déplacer la touche qu'on vient de toucher (mesuré : positions des modes
  identiques à l'arrêt et à la remise en chauffe). Injoignable : tout est grisé, comme avant. Les modes
  passent à la ligne (`flex: 0 1 auto; flex-wrap: wrap`) : les cinq modes du thermostat simulé
  sortaient d'une carte étroite (défaut antérieur, invisible sur un thermostat à trois modes).
- **`ClimateControl.vue`** (panneau appareil) : même règle, et le bloc « Mode » remonte au-dessus de la
  consigne pour la même raison.
- Vérifié en mode simulé (vue Chauffage) : aucun débordement à 1280 / 1024 / 853 px, pas d'erreur
  console. Panneau appareil couvert par les tests seulement. Tests : `HeatingControl.test.ts`,
  `ClimateControl.test.ts`, `lib.test.ts` (statut d'un appareil de chauffage).

### Mise à jour 2026-10-12 (ter) — vue Robots : zones, carte du terrain, calques

Demande de l'utilisateur : voir et commander les zones de sa tondeuse, et voir la carte de son terrain
sur la photo satellite. Côté plugin et API (ce qu'elle permet et non) :
`../3_plugins/3_11_husqvarna-automower.md`, même date. Tout ceci n'apparaît que pour un robot qui
déclare les capacités `work_areas` / `stay_out_zones` / `site_map` (la tondeuse simulée les déclare).

**Bouton « Zones » et panneau `MowerZones.vue`** (dans la rangée de boutons de la carte du robot,
`RobotsView.vue`) :

- *Zones de travail* : une ligne par zone, une **pastille de couleur** (celle de la zone sur la carte, voir
  plus bas) et « Tondre 1 h » (`mower.start_in_area`, durée fixe d'une heure comme le bouton de la carte :
  le fabricant exige une durée). La zone `0` sans nom s'appelle « Tout le terrain » ; une zone
  désactivée est notée et son bouton grisé.
- *Zones d'exclusion* : une ligne par zone avec un **interrupteur** (`mower.set_stay_out_zone`) ; s'il n'y
  en a aucune, la ligne « Aucune : elles se tracent dans l'appli du fabricant » — l'API ne sait ni les créer
  ni les redessiner.
- Toutes les lignes ont la même hauteur (40 px, celle de l'interrupteur compact) : rien ne bouge
  quand l'état change.

**Carte du terrain sur la carte satellite** (`VehicleMap.vue`, prop `overlay` ; calcul pur dans
`apps/web/src/lib/siteMap.ts`) :

- *Où elle se pose.* Le fabricant la publie dans un repère local sans dire où. On fait coïncider **la
  station de la carte** avec la **base du robot** (`site.parkings[]`, `dockFor`) de la maison, plus le
  `mapOffset` réglé (`../2_maison/2_0_format-house-json.md`) ; à défaut de base, sur le robot quand il est
  à la station (garé ou en charge, son GPS corrigé du `gpsOffset`). Le **dernier ancrage est gardé** : un
  robot sans base qui part tondre ne fait pas disparaître sa carte. Rien d'ancrable, rien de dessiné.
- *Couleurs* (celles de l'appli du fabricant, lisibles sur photo comme sur plan, quel que soit le thème) :
  terrain vert pâle (`LAWN_COLOR`), **chaque zone tracée une teinte** (`WORK_AREA_COLORS`, par rang dans
  `workAreas`, aucune proche des couleurs déjà prises), exclusion rouge, réensauvagement jaune pâle
  (`REWILDING_COLOR`), câbles bleus, station jaune. Une zone d'exclusion **désactivée** est presque
  transparente (fond à 0,06 au lieu de 0,42).
- *Zone de travail reliée par son NOM* : la carte du fabricant ne donne pas le `workAreaId`, seulement un
  nom ; la teinte vient donc du nom, **la même que la pastille du panneau**. Une zone que la liste ne
  connaît pas encore (pas relue) prend la teinte suivante.
- *État d'une zone d'exclusion* : celui du robot prime (il suit une bascule faite ici), à défaut celui de la
  carte — seul à dire le réensauvagement.

**Menu des calques** (bouton « calques », **premier de la rangée** des boutons de la carte, à gauche de
Plan / Satellite : son apparition ne décale rien) :

- cinq calques (`SITE_MAP_LAYERS`) : terrain et obstacles, zones de travail, zones d'exclusion,
  réensauvagement, câbles et station ; le menu **ne propose que ceux que la carte contient** ;
- on mémorise les calques **masqués**, pas les visibles (`localStorage`, clé `kasbah.mapLayers.v1`) : un
  calque qui apparaît plus tard (une première zone d'exclusion) se montre de lui-même ;
- le menu est posé **par-dessus** la carte et calé sur **le bord droit de la rangée** (celui de la
  carte), pas sur le bouton : sur téléphone, calé sur le bouton, il sortait de la carte et se faisait
  couper ; lignes de 28 px et `max-height` 164 px, de sorte que cinq calques tiennent dans la carte la plus
  basse (220 px, boutons compris), il défile au-delà ; il se ferme au clic dehors et sur Échap.

**Réglage** (`MowerTuning.vue`, panneau « Modifier ») : pour un robot `site_map`, une seconde ligne
« Décalage de la carte (m) » (`mapOffset`) sous celle du GPS ; « Rétablir » rend les deux décalages comme
ils étaient à l'ouverture.

**Fraîcheur** : la vue demande la carte au serveur une fois par robot, de nouveau quand les zones
(ids, noms) changent, et toutes les **5 minutes** ; le serveur sert son cache, la redemander ne coûte aucun
quota. Elle ne remplace la carte reçue que si elle a **changé** (comparaison du JSON), pour ne pas
redessiner pour rien. Une carte illisible n'empêche rien : le bouton des calques n'apparaît pas.

Sources : `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/robots/{MowerZones,MowerTuning}.vue`, `apps/web/src/components/vehicles/VehicleMap.vue`, `apps/web/src/lib/siteMap.ts` (+ `siteMap.test.ts`), `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-10-12 (quater) — la tâche du robot, et ses zones dans le panneau de la vue Maison

**Ce que fait la tondeuse, en une phrase.** `mowerTask` (`apps/web/src/lib/mowerTask.ts`) compose, à
partir de l'activité, de `workAreaId` et de `leaving` : « En route vers {zone} », « En route pour
tondre » (tout le terrain), « Tonte · {zone} », « Tonte · tout le terrain » (dit seulement chez un robot
qui a des zones tracées), « Retour à la station » ; vide sinon (garé, en charge, en pause : l'activité
suffit). Une zone inconnue de la liste garde son numéro (« Zone 999 »). Le nom d'une zone passe par
`workAreaLabel` (zone `0` sans nom = « Tout le terrain »), partagé avec le panneau Zones.

- **Vue Robots** : la ligne d'état sous la jauge dit, dans l'ordre, l'erreur, la restriction, puis cette
  phrase — même ligne, place toujours réservée.
- **Panneau de la vue Maison** (`MowerControl.vue`) : une ligne réservée sous la pastille d'activité,
  présente seulement chez un robot qui déclare `work_areas` (capacité fixe : rien ne bouge quand la
  phrase change ou s'efface).

**Les zones depuis la vue Maison.** Le panneau détail d'une tondeuse à zones (`DevicePanel.vue`) a un
bloc « Zones du robot », replié derrière son bouton comme le journal : le même `MowerZones.vue` que la
vue Robots (« Tondre 1 h » par zone avec sa pastille, interrupteurs d'exclusion). Il se referme quand on
sélectionne un autre appareil.

Vérifié en mode simulé : « Tondre 1 h » sur une zone depuis la vue Robots puis depuis le panneau 3D
(« Tonte · Fond », « Tonte · Devant »), « Rentrer » (« Retour à la station ») ; la ligne de tâche garde sa
géométrie au pixel, aucune erreur console.

Sources : `apps/web/src/lib/mowerTask.ts` (+ test), `apps/web/src/components/controls/MowerControl.vue`,
`apps/web/src/components/home/DevicePanel.vue`, `apps/web/src/components/robots/MowerZones.vue`,
`apps/web/src/views/RobotsView.vue`, `apps/web/src/i18n/locales/{fr,en}.json` (`mower.task.*`,
`mower.zonesTitle`).

### Mise à jour 2026-10-12 (quinquies) — le panneau des zones : une liste, et la carte peinte dans la scène

`MowerZones.vue` montre désormais **une seule liste**, dans cet ordre : tout le terrain (zone `0`, à
tondre) et les câbles et la station, puis les zones de travail dans l'ordre du robot, enfin les zones
d'exclusion et de réensauvagement. La liste fusionne ce que dit le **robot** (tondre, basculer) et ce
que montre la **carte** (peindre) : `zoneRows` (`lib/siteMap.ts`), reliées par le nom pour une zone de
travail, par l'id pour une exclusion ; une zone connue d'une seule source a sa ligne quand même.

Dans le panneau détail de la vue Maison (`DevicePanel`, prop `sceneDeviceId`), la liste porte aussi la
**carte peinte sur le terrain** :

- en tête, l'interrupteur « Sur la scène » montre ou masque toute la carte ;
- la **pastille** de chaque ligne (24 px) montre ou masque sa zone : pleine = peinte, cerclée = masquée,
  pâlie tant que l'interrupteur est coupé (le choix attend) ;
- choix propre au poste, par robot (`stores/sceneZones`, `localStorage` : `kasbah.sceneZones.shown`,
  `kasbah.sceneZones.hidden` — on garde les MASQUÉS, une zone tracée plus tard se montre d'elle-même) ;
- la carte reste peinte panneau fermé, tant que l'interrupteur est mis.

Le bloc séparé « Sur la scène » d'une première version est retiré. La vue Robots garde la même liste,
même ordre, sans la scène. Les calques de la carte satellite (`VehicleMap`) sont inchangés.

Vérifié en mode simulé : ordre de la liste, interrupteur global, pastille qui masque sa zone (7 → 6
formes reçues par la scène), géométrie des lignes identique avant/après bascule, console propre.

Sources : `apps/web/src/components/robots/MowerZones.vue`, `apps/web/src/components/home/DevicePanel.vue`,
`apps/web/src/lib/siteMap.ts` (`zoneRows`, `sceneEntryKey`, `sceneGroundShapes`), `apps/web/src/stores/sceneZones.ts`.

### Mise à jour 2026-10-13 (bis) — panneau de la tondeuse : l'erreur en clair, les blocs rangés

Demande, sur un robot réel en erreur : afficher le **détail du problème** dans le panneau détail de la
vue Maison, et ranger les sections (« Zones du robot », « Journal du robot », « Réglages ») qui
**s'éparpillaient** sur toute la hauteur du panneau.

- **La ligne d'état de la vue Robots passe dans le panneau.** Elle sort de `RobotsView.vue` vers
  `lib/mowerTask.ts` (`mowerStatus(state, t, now, locale)`) : l'**erreur du fabricant** d'abord
  (« Erreur 2 · No loop signal · il y a 3 h », en rouge), sinon ce qui retient le robot (planning, gel…),
  sinon où il tond (`mowerTask`). `MowerControl.vue` l'affiche sous le prochain départ, dans un
  `MarqueeText` (un texte long défile, ne déborde pas), place **réservée** pour tous les robots — elle
  ne l'était que pour un robot à zones. Une horloge de 30 s tient « il y a… » à jour.
- **La pastille d'activité est retirée** de `MowerControl.vue` : elle répétait le grand titre du panneau
  (« À la station » deux fois), et à côté d'elle « Prochain départ mer. 10:00 » manquait de 5 px et
  passait sur deux lignes — **tout le panneau descendait de 16 px** entre « Erreur » et « À la station ».
  Le prochain départ tient seul sa ligne réservée (vide sans départ, points de suspension s'il est trop
  long). Perdu au passage : le vert de la tonte (le rouge de l'erreur reste sur la ligne d'état).
- **Les blocs repliés se rangent ensemble en bas.** Chaque bloc (`.tuning`, `.arrays`, `.placement`)
  portait `margin-top: auto` pour se caler au fond : avec trois blocs, trois marges automatiques se
  partageaient la hauteur libre. Désormais seul le **premier** la garde
  (`.tuning ~ .tuning, .tuning ~ .arrays, .tuning ~ .placement { margin-top: 0 }`), les suivants suivent
  à l'écart ordinaire du panneau (20 px).

Vérifié en simulation (erreur injectée, 1232 × 1000) : ligne d'état, prochain départ et boutons au même
pixel en « Erreur », « À la station » et sans départ ; blocs collés en bas ; thèmes clair et sombre.
Test `mowerTask.test.ts` (« mowerStatus »).

Sources : `apps/web/src/lib/mowerTask.ts`, `apps/web/src/components/controls/MowerControl.vue`,
`apps/web/src/components/home/DevicePanel.vue`, `apps/web/src/views/RobotsView.vue`.

### Mise à jour 2026-10-14 — « Effacer l'erreur » et « Reprendre le programme »

Sur la **vue Robots** et dans le **panneau de la tondeuse** (vue Maison, `MowerControl.vue`) :

- **« Effacer l'erreur »** : un lien au bout de la ligne d'état (à côté de « Masquer » sur la vue
  Robots), présent seulement si le robot déclare `confirm_error`, est en erreur, et dit cette erreur
  `errorConfirmable`. La ligne garde sa hauteur : seul le texte de l'erreur se raccourcit (ellipse sur la
  vue Robots, défilement dans le panneau).
- **« Reprendre le programme »** : envoie `mower.start` sans durée. Pilule de la rangée de boutons sur la
  vue Robots ; bouton pleine largeur (44 px) sous « Tondre 1 h / Rentrer » dans le panneau. Toujours
  présent quand le robot a `schedule` : rien ne bouge quand l'état change. La rangée de la vue Robots
  passe sur deux lignes, le panneau grandit d'autant, une fois pour toutes.

Vérifié en simulation (erreur injectée dans le store) : aucun élément ne bouge à l'apparition du lien,
aucun débordement en fr et en en, à 1280 et 375 px (vue Robots), à 1280, 1024 et 853 px (panneau).
Tests `RobotsView.test.ts` et `MowerControl.test.ts`.

Sources : `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/controls/MowerControl.vue`,
`apps/web/src/i18n/locales/{fr,en}.json` (`mower.resumeSchedule`, `mower.confirmError`).

### Mise à jour 2026-10-21 — vue Chauffage : le thermostat qui chauffe ressort, et l'humidité

- **Mise en valeur** : `RoomBands` gagne une prop facultative `emphasize(entry)` (sans effet sur
  les sept autres vues qui l'utilisent). Pour un appareil retenu, la carte de sa pièce prend un **fond
  dégradé** derrière son en-tête et l'icône se teinte, dans la couleur `--emph` posée par la vue
  (accent par défaut). La vue Chauffage retient l'appareil dont `action` vaut `heating` et pose un
  orange chaud : l'accent veut déjà dire « allumé », et une zone allumée ne chauffe pas forcément.
  « Chauffe » passe dans la même couleur, **sans gras** (le mot s'élargirait et pousserait la suite).
  Un premier essai par liseré (`box-shadow` inset) a été remplacé, à la demande de l'utilisateur, par
  le dégradé, à la manière de la pochette derrière une enceinte de la vue Médias. Mesuré en mode
  simulé : carte et textes immobiles entre chauffe et repos ; vérifié en clair et en sombre.
- **Humidité** : ajoutée à la ligne d'état (« Au repos · Humidité 48 % ») quand l'appareil la
  publie (thermostat Nest).
- **Éco** : consigne affichée sans − / +, boutons gardés invisibles à leur place — détail dans
  [../3_plugins/3_5_google-nest](../3_plugins/3_5_google-nest.md), mise à jour du même jour.
- **Fraîcheur** : la vue relit l'état machine au rythme du sondage du serveur (`pollMs`), une
  minute par défaut — voir [../3_plugins/3_13_mitsubishi-melcloud](../3_plugins/3_13_mitsubishi-melcloud.md).

### Mise à jour 2026-10-21 (bis) — vue Chauffage : la zone dont on ne sait rien ne dit rien, et la durée de l'historique

- **Pas de mot quand l'action est inconnue.** La ligne d'une zone n'affiche aucun mot d'action quand
  `action` est absente (cascade MELCloud : la machine chauffe, on ne sait pas quelle zone elle sert —
  [3_13](../3_plugins/3_13_mitsubishi-melcloud.md), même date). « Chauffe » est réservé à une action
  `heating` connue. Le fond dégradé chaud de `RoomBands` (`emphasize`) s'allume si `action === 'heating'`
  **ou** `unitHeating` : la carte dit « la machine chauffe », pas « cette zone chauffe ». Dans le panneau 3D
  (`ClimateControl`), la pastille **« Machine en chauffe »** (couleur d'avertissement) remplace l'action
  quand elle manque et que `unitHeating` est vrai.
- **Circulateurs : « Non remonté »** (carte machine, `HeatingUnitCard`) quand la machine chauffe et
  qu'aucune pompe n'est remontée, au lieu d'un « — » qui se lisait « arrêtée ».
- **Durée de l'historique** : un `Segmented` **48 h / Semaine / Mois / Année** sur `HeatingHistoryChart`
  (demandé : « est-ce qu'on garde les infos ? pourrait-on switcher la durée »). 48 h lit les heures ;
  Semaine (7 jours) et Mois (31 jours) lisent la série quotidienne du serveur ; Année (12 mois) est
  **sommée côté client** à partir des jours, les moyennes pondérées par les échantillons. Les pas sont
  ceux des graphes d'eau et de lumière (`bucketSlots`, `lib/consumption`). Les heures de marche = part ×
  durée du pas. Hauteur de carte **fixe** d'une fenêtre à l'autre (mesurée à 279 px sur les deux cartes,
  quatre fenêtres). Vérifié dans la preview en injectant des réponses MELCloud dans le transport simulé
  (la maison simulée n'a pas de MELCloud) ; test : `HeatingHistoryChart.test.ts`. Côté serveur : l'historique
  garde maintenant ~13 mois de jours, voir [3_13](../3_plugins/3_13_mitsubishi-melcloud.md).

### Mise à jour 2026-10-21 (ter) — vue Chauffage : un temps de marche lisible

Demande : « mettre le temps de fonctionnement dans un format plus humain » (le chiffre « de marche »
de `HeatingHistoryChart`, en heures décimales : « 1,6 h », « 3 130 h » sur l'année). `formatRunTime`
(`lib/format.ts`) prolonge `formatMinutes` : « 36 min », « 1 h 36 » sous la journée, puis jours et
heures, « 2 j 2 h », « 133 j 4 h » (« d » en anglais). Le libellé `heating.history.runHours` est
retiré. Mesuré dans la preview (réponses MELCloud injectées) : « 133 j 4 h » tient dans la case
réservée au chiffre (`min-width: 7ch`), le sélecteur de durée ne bouge pas d'une fenêtre à l'autre.
Tests : `lib.test.ts`, `HeatingHistoryChart.test.ts`.

### Mise à jour 2026-10-21 (quater) — vue Chauffage : cartes plus larges, modes à parts égales, humidité sur la ligne de consigne

Demande : « on peut peut-être les élargir un peu […] que les 3 boutons chauffage/éco/arrêt prennent
toute la largeur de la ligne et fassent la même taille, placer le taux d'humidité ailleurs ».

- **Largeur** : `RoomBands` lit `--card-min` (340 px par défaut, inchangé pour les autres vues) ;
  la vue Chauffage le pose à **420 px**. À 1280 px de large, deux colonnes au lieu de trois.
- **Modes** (`HeatingControl`) : la rangée prend toute la ligne, chaque touche `flex: 1 1 0` avec
  `min-width: max-content` — trois modes (Nest) font la même largeur ; un mot plus long que sa part
  (« Refroidissement », thermostat simulé à cinq modes) garde sa largeur et la rangée passe à la ligne
  plutôt que de déborder.
- **Humidité** : retirée de la ligne d'état, posée au bout droit de la ligne de consigne (icône goutte,
  infobulle « Humidité »). Elle reste affichée à l'arrêt ; la ligne garde alors la hauteur d'une touche
  (`min-height: 36px`) : mesuré, carte, touches et humidité immobiles entre chauffage, éco et arrêt.
- Vérifié en mode simulé à 1280 / 853 / 375 px, clair et sombre, fr et en (le cas Nest à trois modes
  simulé en réduisant les modes du thermostat de démo dans le store). Test : `HeatingControl.test.ts`.

### Mise à jour 2026-10-25 — Eau et Chauffage : découpage glissant ou calendaire

Demande : le même choix **Glissant / Calendaire** que la vue Énergie
([4_4](4_4_vues-energie-vehicules.md), même date) sur les autres graphes d'historique. Chaque graphe
reçoit un second `Segmented` dense à côté du sélecteur de fenêtre, avec les libellés de l'Énergie
(`energy.modes.*`, `energy.modeLabel`). Il est **grisé, jamais masqué**, pour les fenêtres qu'il ne
change pas : les 48 h du chauffage, le jour de l'eau (et de la lumière, [4_3](4_3_vues-lumieres-ouvrants-cameras.md)),
qui restent glissants. Glissant reste le défaut ; le choix n'est pas mémorisé.

- **Calendaire** = semaine depuis lundi, mois depuis le 1er (28 à 31 pas), année depuis janvier,
  par `bucketSlots(…, mode)` (`lib/consumption.ts`). Un pas **encore à venir** ne dessine rien : ni
  barre, ni tiret « non mesuré » (le tiret garde son sens : un pas passé sans mesure).
- **Titres** : le nom de la fenêtre, comme l'Énergie avec `scale`. Eau : la ligne du total devient
  « Cette semaine : … », « Octobre 2026 : … », « 2026 : … » (`water.consumptionTotalIn`) ; Chauffage :
  le sous-titre devient « Cette semaine », « Octobre 2026 », « 2026 ». Le mois et l'année viennent de
  `calendarTitle()` (`lib/consumption.ts`), que la vue Énergie reprend aussi.
- **Eau, mention « X jours sur N mesurés »** : N compte les pas **commencés**, sinon chaque mois
  calendaire aurait dit « 25 sur 31 » le 25.
- **Eau, totaux** : les compteurs semaine / mois de la station restent affichés tels quels dans les
  deux modes ; leur nature calendaire ou glissante n'est toujours pas tranchée
  ([3_12](../3_plugins/3_12_comap-proteo.md)). L'année calendaire somme les mois de janvier à maintenant.
- **Chauffage, année calendaire** : les mois sommés côté client (`byMonth`) tombent pile sur les 1er
  janvier → 1er décembre ; décembre de l'an passé n'entre pas (test `HeatingHistoryChart.test.ts`).
- **Mise en page** : les sélecteurs passent sous le titre quand ils ne tiennent pas à côté, alignés au
  début (un sélecteur plus large que la carte déborde à droite, jamais hors de l'écran à gauche). En
  dessous de 560 px, l'en-tête du chauffage passe à la ligne : à 375 px il débordait déjà de 131 px
  avant ce changement (titre, quatre fenêtres et chiffre sur une ligne insécable) ; il tient désormais
  au zoom 1.

Vérifié dans la preview `kasbah-mock` (réponses MELCloud injectées dans le transport, comme le
2026-10-21) : cadres immobiles (écart 0 px, mesure `getBoundingClientRect`) entre toutes les fenêtres
et les deux modes, à 1280 et 375 px, zooms 1 / 1,25 / 1,5, fr et en ; mois calendaire = 25 barres et
6 jours vides le 25 octobre. **Reste** : le sélecteur de fenêtre à quatre choix est plus large que la
carte à 375 px au zoom ≥ 1,25 (et celui du chauffage dans sa demi-carte à 1280 px au zoom ≥ 1,25, fr) ;
c'était déjà le cas avant.

Sources : `apps/web/src/components/water/WaterConsumptionChart.vue`,
`apps/web/src/components/heating/HeatingHistoryChart.vue` (+ `HeatingHistoryChart.test.ts`),
`apps/web/src/lib/consumption.ts` (+ `consumption.test.ts`), `apps/web/src/i18n/locales/{fr,en}.json`.
