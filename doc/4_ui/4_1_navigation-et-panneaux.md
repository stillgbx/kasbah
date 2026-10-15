# Navigation et panneaux

> Dernière mise à jour : 2026-10-15
> Sources : `apps/web/src/App.vue`, `apps/web/src/components/layout/*.vue`, `apps/web/src/views/*.vue`, `apps/web/src/components/home/*.vue`, `apps/web/src/components/controls/*.vue`, `apps/web/src/views/LightsView.vue`, `apps/web/src/components/home/PlacementControl.vue`, `apps/web/src/components/scenes/SceneChips.vue`, `apps/web/src/components/devices/RoomBands.vue`, `apps/web/src/components/devices/RoomLightsToggle.vue`, `apps/web/src/views/CoversView.vue`, `apps/web/src/components/covers/CoverPill.vue`, `apps/web/src/lib/{cover,deviceState}.ts`, `apps/web/src/composables/useHomeSummary.ts`, `apps/web/src/components/devices/ForgetDeviceButton.vue`, `apps/web/src/components/controls/MediaPlayerControl.vue`, `apps/web/src/lib/audioRouting.ts`, `apps/web/src/components/energy/EnergyFlow.vue`, `apps/web/src/components/EnphasePairingCard.vue`, `apps/web/src/lib/energy.ts`, `apps/web/src/components/devices/RoomBrightness.vue`, `apps/web/src/components/devices/CoversMaster.vue`, `apps/web/src/components/devices/LightsMaster.vue`, `apps/web/src/composables/useRoomLights.ts`, `apps/web/src/components/home/PanelArraysCard.vue`, `apps/web/src/components/energy/InverterFields.vue`, `apps/web/src/components/TeslaLinkCard.vue`, `apps/web/src/views/VehiclesView.vue`, `apps/web/src/components/vehicles/VehicleMap.vue`, `apps/web/src/components/vehicles/VehicleTuning.vue`, `apps/web/src/lib/vehicleTuning.ts`, `apps/web/src/lib/map.ts`, `apps/web/src/components/controls/VehicleCard.vue`, `apps/web/src/components/vehicles/ChargeLimitCard.vue`, `apps/web/src/components/home/DevicePanel.vue`, `apps/web/src/components/settings/PluginSection.vue`, `apps/web/src/views/SettingsView.vue`, `apps/web/src/components/ui/Segmented.vue`, `apps/web/src/components/home/SearchBar.vue`, `apps/web/src/composables/useSearch.ts`, `apps/web/src/components/layout/SearchPalette.vue`, `apps/web/src/lib/search.ts`, `apps/web/src/lib/navItems.ts`, `apps/web/src/views/HeatingView.vue`, `apps/web/src/components/heating/*.vue`, `apps/web/src/components/MelcloudLinkCard.vue`, `apps/web/src/components/home/OpeningPanel.vue`, `apps/web/src/components/home/RoomEditPanel.vue`, `apps/web/src/components/home/ParkingPanel.vue`, `apps/web/src/lib/deviceIcons.ts`, `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/{MusicPlayerBar,ListeningSessions,MusicItemRow,MusicTile,ChipRow}.vue`, `apps/web/src/stores/localPlayer.ts`, `apps/web/src/components/music/MixcloudBrowser.vue`, `apps/web/src/components/MixcloudLinkCard.vue`, `apps/web/src/views/SettingsView.vue`, `apps/web/src/views/{AutomationsView,AutomationEditView}.vue`, `apps/web/src/components/automations/*.vue`, `apps/web/src/components/layout/NavRail.vue` (`meta.nav`), `apps/web/src/components/controls/LightHistoryChart.vue`, `apps/web/src/components/weather/WeatherPlaces.vue`, `apps/web/src/composables/useMusicSession.ts`, `apps/web/src/lib/streamQuality.ts`, `apps/web/src/components/home/ReliefPanel.vue`, `apps/web/src/lib/ignRelief.ts`, `apps/web/src/lib/moon.ts`, `apps/web/src/components/vehicles/VehicleSoftware.vue`, `apps/web/src/components/layout/AssistantReply.vue`, `apps/web/src/components/settings/AssistantCard.vue`, `apps/web/src/components/ClaudeLinkCard.vue`, `apps/web/src/composables/useVoiceInput.ts`, `apps/web/src/stores/properties.ts`, `apps/web/src/components/layout/PropertyList.vue`, `apps/web/src/components/home/{HouseEditPanel,RoomShapeSection}.vue`, `apps/web/src/components/property/*.vue`, `apps/web/src/lib/onboarding.ts`, `apps/web/src/lib/geocode.ts`, `apps/web/src/views/ShoppingView.vue` (2026-10-11)

## Où sont les vues

Le 2026-10-13, cette page a été découpée : elle ne garde que la navigation et les panneaux de la vue
Maison. Les sections des autres vues ont été déplacées telles quelles, avec leurs dates :

| Sujet | Page |
|---|---|
| Vues Lumières, Ouvrants et Caméras | [4_3_vues-lumieres-ouvrants-cameras](4_3_vues-lumieres-ouvrants-cameras.md) |
| Vues Énergie et Véhicules | [4_4_vues-energie-vehicules](4_4_vues-energie-vehicules.md) |
| Musique et médias | [4_5_musique-et-medias](4_5_musique-et-medias.md) |
| Autres vues : Météo, Robots, Eau, Chauffage, Animaux, Agenda, École, Courses, Automatisations | [4_6_autres-vues](4_6_autres-vues.md) |
| Vue Réglages | [4_7_reglages](4_7_reglages.md) |
| Mode édition et propriétés | [4_8_mode-edition-et-proprietes](4_8_mode-edition-et-proprietes.md) |

Un renvoi d'une autre page vers celle-ci pour l'une de ces vues se lit dans la page indiquée.

## Grille

`App.vue` : `grid-template-columns: var(--rail-w) 1fr` (rail 72 px + vue). La vue Maison ajoute sa
propre colonne droite (`--aside-w`, 340 px) quand la fenêtre fait ≥ 1000 px ; sinon le panneau devient
un **tiroir** superposé (bouton dans l'en-tête, fermeture par le voile).

*(Dépassé le 2026-09-15 : le rail est en `position: absolute` sur la vue, sans colonne de grille, et `.app-main` réserve sa largeur en `padding-left: var(--rail-w)` (`apps/web/src/App.vue`, `components/layout/NavRail.vue`) — voir « Mise à jour 2026-09-15 — la vue Maison devient immersive : tout flotte sur la scène ».)*

## Rail (`layout/NavRail.vue`)

Initiales de la maison (carré accent), vues du rail (`lib/navItems.ts`), espace, bouton
d'apparence (cycle clair → sombre → système → auto-soleil, icônes sun/moon/auto/sunHorizon).
La langue se règle uniquement dans Réglages (plus de `FR`/`EN` en bas du rail depuis
2026-09-21).

*(Dépassé le 2026-09-21 : le bouton d'apparence n'est plus au rail, il est dans l'en-tête de la vue Maison (`views/HomeView.vue`, `settings.cycleAppearance()`), et les Réglages sont épinglés en bas du rail, sous `.rail__spacer` — voir « Mise à jour 2026-09-21 — l'apparence quitte le rail, les Réglages s'y épinglent en bas ».)*

## En-tête (`layout/PageHeader.vue`)

Nom de la maison + **résumé vivant** (`composables/useHomeSummary.ts` : lumières allumées,
température intérieure — climat ou premier capteur de température intérieur —, production solaire) et
un slot à droite : sur la vue Maison, le **contrôle segmenté** des niveaux (`ui/Segmented.vue`) :
Jardin, un onglet par niveau (`shortName`), Tout.

## Vue Maison (`views/HomeView.vue`)

Scène 3D + panneau contextuel. Enchaînement du panneau :
1. **HomePanel** : les tuiles de synthèse (lumières allumées, volets ouverts x/y, caméras,
   lecteurs x/y, solaire, batterie, puis une par voiture — solaire et batterie retirées le
   2026-09-11 et revenues le 2026-09-15, voir les mises à jour en fin de page),
   **scènes** (pilules, `devices.runScene`), liste des pièces par niveau puis zones du jardin qui ont
   des appareils (`n appareils · m actifs`).
   *(Dépassé le 2026-09-22 : le panneau d'accueil ne montre plus que les tuiles de synthèse ; ni les scènes (`runScene`) ni la liste des pièces n'y sont plus — voir « Mise à jour 2026-09-22 (bis) — HomePanel : tuiles de synthèse seulement ».)*
2. **RoomPanel** : fil d'Ariane « ‹ Maison », titre, `Niveau · n appareils`, lignes d'appareils
   (icône carrée teintée si actif, nom, libellé d'état, interrupteur de bascule rapide si le kind en
   a une — `lib/deviceState.ts : toggleCommand`, sinon chevron). Au-dessus de la liste, un **filtre
   segmenté** (icônes, pas de pilules libres) quand la pièce mélange au moins deux catégories —
   voir la mise à jour 2026-09-20.
3. **DevicePanel** : fil d'Ariane vers la pièce, en-tête (icône, nom, kind · fabricant, interrupteur),
   grande valeur (`headlineValue`), puis le contrôle du kind (`controls/DeviceControl.vue` aiguille
   vers Light/Cover/MediaPlayer/Climate/Vacuum/Mower/Sensor/Energy/EvCharger/Vehicle).
   *(Dépassé : `controls/DeviceControl.vue` aiguille aujourd'hui seize kinds — light, cover, media_player, climate, vacuum, mower, sensor, energy, ev_charger, vehicle, camera, weather, water, pet_feeder, pet_fountain, fan —, relevé du lint du 2026-10-06 dans la table `CONTROLS` du composant.)*

Interactions scène ↔ store : onglet → `setFloorTab` + cadrage ; tap pièce → sélection (re-tap =
désélection) ; tap pilule/objet → appareil ; tap fond → désélection. L'URL suit (`?level=&room=&device=`).

Une **barre de recherche** flotte en bas de la scène, entre la carte météo et les boutons de
vue : elle atteint pièces, zones, niveaux, appareils, ambiances et pages du rail, et valider un
résultat ne fait que déplacer la sélection (voir la mise à jour 2026-09-17 (ter) en fin de page).
Le même moteur s'ouvre depuis **n'importe quelle page** par **Ctrl+K / Cmd+K** (palette,
`layout/SearchPalette.vue`, voir la mise à jour 2026-09-29 « palette Ctrl+K »).

## Suppressions par rapport à la première version

La vue « liste des appareils », le sélecteur de niveaux vertical, les puces de pièces en bas de scène
et la feuille basse d'appareil ont été remplacés par le panneau latéral et les onglets, conformément
à la maquette.

### Mise à jour 2026-09-07 — « Emplacement » dans le panneau appareil

`components/home/PlacementControl.vue`, sous le contrôle du kind dans **DevicePanel**, pour tout
appareil de la maison (JSON ou auto-placé) **sauf** ceux ancrés à une ouverture (`openingId` : volets,
capteurs d'ouverture — déplacer serait modifier l'ouverture) et la tondeuse (position publiée par le
plugin). Choix délibéré d'un mode **par appareil** plutôt qu'un mode édition global : on est déjà sur
l'appareil, aucun risque de glissement accidentel en usage quotidien.

- Repos : ligne « Emplacement » + bouton **Déplacer** (icône `move`).
- Mode actif : **Terminé**, conseil, préréglages segmentés **Plafond / Applique / Table / Sol** (posent
  `mount` `ceiling / wall / free / floor` et `z` = plafond − 0,15 / 1,80 / 0,75 / 0,10 m, écriture
  immédiate), **Hauteur** avec valeur et curseur `0 → hauteur sous plafond de la pièce` (`roomHeight`,
  4 m hors pièce) au pas de 5 cm — aperçu pendant le glissement (`previewHeight`), écriture au
  relâchement (`@end`) —, ligne `x · y · pièce` du brouillon, et **Rétablir** quand le placement
  diffère de celui d'entrée dans le mode.
- x;y se règlent en glissant l'appareil **dans la scène** (voir `../1_architecture/1_5_scene-3d.md`) ;
  le fil d'Ariane et la surbrillance de pièce suivent si l'appareil change de pièce. *(Depuis le
  2026-09-25, un appareil sélectionné ne surligne plus sa pièce — voir ci-dessous « Sélectionner un
  appareil n'allume pas sa pièce » : seul le fil d'Ariane suit.)*
- Toute sortie de l'appareil (tap ailleurs, changement d'onglet) quitte le mode.

Libellés : `place.*` (fr/en). La carte est en bas du panneau : sur un écran bas il faut faire
défiler le panneau, accepté (fonction secondaire).

#### Mise à jour 2026-09-25 — sélectionner un appareil n'allume pas sa pièce

Règle demandée par l'utilisateur : toucher directement un appareil (une lampe, etc.) ne met **plus**
sa pièce en surbrillance (trait d'accent + voile au sol). La nuit surtout, ils masquaient l'effet du
réglage qu'on est en train de faire — la flaque de la lampe. La pièce n'est mise en valeur que quand
on navigue vers ELLE : tap sur son sol, recherche, retour depuis l'appareil par le fil d'Ariane.
Même logique que la surbrillance coupée pendant le réglage d'une ouverture (plus bas). Code :
`frameSelection` dans `apps/web/src/views/HomeView.vue` ; détail dans `../1_architecture/1_5_scene-3d.md`.

*Complément 2026-09-25 : quand on navigue vers une pièce, le reste de la maison s'assombrit et se
désature aussi (fondu 300 ms), en plus du trait et du voile — voir `../1_architecture/1_5_scene-3d.md`,
section (undecies).*

### Mise à jour 2026-09-08 — pastilles « Ambiances » et sélecteur d'effet

Les scènes des fabricants s'appellent **« Ambiances »** dans l'UI : le mot « Scènes » est déjà pris
par les scènes maison (`house.json`) affichées juste au-dessus dans le panneau maison, et deux
sections homonymes seraient illisibles.

`SceneChips.vue` — une pastille par ambiance :

- aperçu à gauche : aplat si une seule couleur, dégradé à 135° sinon (les palettes Hue en comptent
  jusqu'à 5) ;
- **deux bascules**, pas deux déclencheurs. La pastille : applique l'ambiance en fixe, et si elle
  tourne déjà, **éteint la pièce** (`mode: 'off'`) — sur un panneau mural la pastille est le contrôle
  lumière de la pièce, et c'est le seul geste unique pour l'éteindre depuis ce panneau. Le **bouton ✨**
  (icône `sparkle`, `aria-pressed`) lance la palette animée, et l'arrête en revenant au fixe : la
  scène reste allumée, seule l'animation cesse. Deux boutons distincts plutôt qu'un mode implicite :
  l'utilisateur choisit fixe ou animé, et voit lequel tourne ;
- la scène en cours porte le contour et le fond d'accent ; le bouton ✨ s'allume quand c'est la
  palette qui tourne ;
- pastille désactivée pendant l'aller-retour (le rappel est limité à 1/s côté pont) ;
- une pastille qui n'est **qu'une icône** (le « + ») doit remettre `align-items: center` et
  `padding: 0` : elle hérite sinon du `align-items: stretch` de `.chip` et du padding par défaut des
  `<button>`, et l'icône se retrouve décentrée (12/2 px au lieu de 12/12 dans une boîte de 40×40) ;
- **le survol ne rejoue jamais le fond ni la couleur d'un bouton allumé** : ce fond *est* le signal
  « en cours ». Piège CSS rencontré — `.chip__dyn:hover:not(:disabled)` (0,3,0) l'emporte sur
  `.chip__dyn[data-on='1']` (0,2,0), donc survoler le bouton d'animation allumé le faisait paraître
  éteint. Les règles de survol sont désormais **scindées par état** : fond de survol quand c'est
  éteint, `filter: brightness(1.08)` ou surcouche d'accent quand c'est allumé (idiome déjà utilisé
  par les lignes de pièce et d'appareil).

Au bout de la rangée, une pastille **« + »** ouvre la liste des ambiances présentes ailleurs chez le
fabricant et absentes ici, chacune annotée « reprise de <pièce> » et marquée ✨ si elle est animée.
Un appui la crée pour cette pièce (`POST /api/scenes`) : c'est la réponse au besoin « voir les autres
ambiances disponibles pour en choisir une nouvelle », que la galerie du fabricant ne permet pas de
satisfaire autrement (elle n'est pas exposée par le pont, cf. `../3_plugins/3_1_philips-hue.md`).
La section apparaît même quand la pièce n'a aucune ambiance : il reste le « + ».

Placement : dans le **panneau pièce**, entre le titre et la liste des appareils (les ambiances de la
pièce homonyme). Dans le **panneau maison**, une section par groupe du fabricant, étiquetée
« Ambiances · <groupe> » — un pont réplique souvent la **même** ambiance (même nom) dans plusieurs
zones, l'étiquette lève l'ambiguïté.

Panneau appareil : `LightControl.vue` gagne un `v-select` **Effet** quand la lampe déclare la capacité
`effect`, alimenté par `descriptor.meta.effects`. Les libellés sont traduits quand on les connaît
(`light.effects.*`) et retombent sur le nom brut sinon — les firmwares en ajoutent régulièrement.

### Mise à jour 2026-09-08 — respecter « démarrer l'animation automatiquement »

Le premier jet ignorait `auto_dynamic` : la pastille jouait toujours le fixe et l'animation ne
partait qu'au bouton ✨. C'était trancher à la place de l'utilisateur, qui a déjà exprimé ce choix
scène par scène dans l'app du fabricant — et il varie vraiment (sur un pont installé, deux scènes
homonymes de deux pièces peuvent différer). Un réglage global de Kasbah aurait écrasé cette
intention fine avec un interrupteur grossier.

Désormais : un appui sur une pastille éteinte joue le mode rendu par `scenes.tapMode(entry)` —
`dynamic` si la scène a une palette **et** qu'elle est réglée en démarrage auto, `static` sinon. La
décision vit dans le store (donc testable) et le composant reste bête. Le bouton ✨ ne change pas :
il reste la commande explicite, dans les deux sens.

Pour changer ce comportement, on modifie le réglage **là où il vit, chez le fabricant** :
**Réglages → « Ambiances »**, **une carte par plugin** (le concept est commun, les réglages non).
C'est l'écran de **gestion** : il liste TOUTES les ambiances du plugin (nom + groupe), chacune avec

- un interrupteur « démarrage animé » qui écrit sur le pont (`PATCH /api/scenes/:id`), désactivé et
  expliqué pour une ambiance sans palette — un interrupteur grisé se comprend mieux qu'une case vide ;
- un bouton de **suppression** en deux temps : le premier appui arme et affiche « Confirmer », le
  second supprime (`DELETE /api/scenes/:id`), et l'armement retombe seul au bout de 5 s. Deux appuis
  parce que le geste est destructif ET visible depuis l'app du fabricant.

**Quand utiliser Vuetify plutôt qu'un bouton maison** : dans cette liste, les deux boutons sont des
`v-btn` (icône puis `color="error"` pour la confirmation) — ils voisinent des `v-switch`, donc ils
doivent partager leur thème, leurs états et leurs tailles ; `app.css` les arrondit déjà et Vuetify
centre l'icône tout seul. À l'inverse, les pastilles d'ambiance du panneau pièce restent des boutons
maison : elles appartiennent au langage de pilules du projet (`.pill`), qu'un `v-btn` ne reproduit
pas. Règle : Vuetify là où l'on est déjà dans ses composants, boutons maison dans le langage visuel
propre à l'app.

En tête de carte, un réglage du **plugin** : « Nouvelles ambiances animées » — le défaut appliqué aux
ambiances qui apparaîtront, qui ne touche jamais celles déjà listées (`PATCH /api/plugins/:id/settings`). Un premier jet avait mis à
cet endroit une préférence du navigateur (`kasbah.sceneAutoDynamic`) : abandonné le même jour à la
demande de l'utilisateur, parce que deux valeurs pour la même question créent une ambiguïté dès que
l'app du fabricant touche au réglage.

### Mise à jour 2026-09-09 — « Emplacement » au fond du panneau appareil

Demande de l'utilisateur : la section « Emplacement » (`PlacementControl`, mode « Déplacer ») sert
rarement, elle passe **en bas** du panneau. Elle est calée au fond quand le contenu est plus court que
l'écran (`margin-top: auto`), et suit simplement le contenu quand celui-ci défile. Pour que ce soit
possible, `.side-panel__scroll` (`layout/SidePanel.vue`) est passé de grille à **colonne flex** (même
`gap` de 20 px, enfants étirés en largeur comme avant) ; les fils d'Ariane des panneaux pièce et
appareil, qui se calaient à gauche par `justify-self: start`, le font désormais par `align-self:
flex-start`. Panneaux maison, pièce et appareil vérifiés à l'écran.

### Mise à jour 2026-09-09 — ligne « Orientation » du mode « Déplacer »

Dans `PlacementControl`, sous la hauteur : une ligne **Orientation** avec deux touches (tourner à
gauche / à droite, pas de 45°, glyphes `rotateLeft` / `rotateRight`) et la valeur en degrés à largeur
fixe entre les deux. Chaque pression écrit `yaw` via `house.savePlacement({ yaw })` ; « Rétablir » la
ramène aussi. Proposée seulement aux appareils qui **regardent** quelque part : lecteur de classe
`tv` ou `display`, caméra, véhicule (ou tout appareil qui porte déjà un `yaw`) — règle dans
`lib/orientation.ts`, partagée avec le cône « regarde vers » de la scène (`../1_architecture/1_5_scene-3d.md`). Vérifié sur le
Chromecast de la chambre : 0° → 45° → 0°, la valeur revient par l'état de la maison.

### Mise à jour 2026-09-09 — la section « Emplacement » s'ouvre vers le haut, sans rien déplacer

Trois demandes de l'utilisateur, la section étant désormais au fond du panneau (`PlacementControl`) :

- **Ouverture fluide** : le corps (aide, préréglages, hauteur, orientation, coordonnées) se déplie
  AU-DESSUS du pied de la section, par une transition de `max-height` de 0 vers sa hauteur mesurée
  (`ResizeObserver`), avec fondu. `grid-template-rows: 0fr → 1fr` a été essayé d'abord : il sautait
  sans s'animer dans le navigateur, une hauteur en pixels s'anime partout. Replié, le
  corps passe en `visibility: hidden` (hors tabulation) une fois la transition finie.
- **Un seul bouton, une seule place** : la ligne de titre est au pied de la section ; « Déplacer » et
  « Terminé » ont la même largeur minimale et le même coin (mesuré : même rectangle au pixel dans les
  deux états) — on referme là où on a ouvert.
- **« Rétablir » réservé** : en tête du corps, à droite de l'aide, en `visibility: hidden` tant qu'il n'y
  a rien à rétablir. La ligne ne bouge pas quand il apparaît.

### Mise à jour 2026-09-10 — poser un appareil « Non placé » depuis une liste

Demande de l'utilisateur, après avoir allumé un téléviseur jamais découvert (« TV Salon ») : il était
« hors maison », visible seulement dans la vue Médias, sans moyen de le poser. Le flux :

1. Dans `RoomBands`, le badge « Non placé » est remplacé par un **bouton « Placer »** (pilule d'accent,
   même hauteur que les badges d'origine). Il appelle `house.startPlacingNew(id)` puis navigue vers la
   maison en **attendant** la navigation (voir la FAQ sur le watcher URL).
2. Le store crée un appareil **provisoire** (`provisional`, id `auto.<plugin>-<externalId>` comme
   l'auto-placement, `meta.provisional`) au centre du niveau affiché — ou du premier —, à 0,75 m, ancré
   au niveau ; il entre dans la maison `effective`, donc dans la scène et les panneaux, sélectionné, mode
   « Déplacer » ouvert (`HomeView` applique `setMovable` dès l'arrivée : watch immédiat).
3. **Le niveau se choisit par les onglets** : tant que rien n'est déposé, changer d'onglet déplace le
   provisoire au centre du niveau choisi (watch de `focusedLevelId`).
4. Le glissement 3D, la hauteur et l'orientation fonctionnent comme pour tout appareil. **Le premier
   dépôt écrit l'entrée** : pièce si l'appareil est posé dans une pièce, sinon `levelId`
   (`../2_maison/2_0_format-house-json.md`). La maison relue contient l'entrée sous le même id, le
   provisoire s'efface, la sélection reste.
5. Tant que rien n'est déposé, le bouton du pied dit **« Annuler »** (et non « Terminé ») : l'abandon du
   provisoire est explicite ; la sélection revient à l'appareil de plugin, dont le panneau propose « Placer »
   à nouveau. Changer de sélection abandonne aussi.
6. **« Retirer de la maison »** (corps de la section, à droite des coordonnées, place réservée — invisible
   pour un provisoire) : geste en deux temps, « Retirer de la maison » puis « Confirmer le retrait » dans
   les 4 s, sinon il se désarme. Il appelle `DELETE /api/house/devices/:id`
   (`../1_architecture/1_3_protocole-rest-ws.md`) ; l'appareil sort de la maison et la sélection suit
   l'appareil de plugin, dont le panneau montre alors une carte « Emplacement · Placer » à la place de
   la section.

Deux corrections venues du premier essai de l'utilisateur :
- **Le clic « Placer » ne basculait pas sur la 3D.** Le store était renseigné AVANT `router.push` ; or
  `HomeView` reste vivante sous `keep-alive` et reflète toute sélection dans l'URL de la route
  **courante** — son `router.replace({ query })` gagnait contre le push et on restait sur la liste, avec
  `?device=…` collé à `/media`. Même piège qu'au 2026-09-09 (`../6_faq/6_1_pieges-runtime.md`). Ordre
  inversé : naviguer, puis démarrer. Si la maison n'est pas encore chargée (serveur en train de
  redémarrer), la demande est gardée (`pendingNew`) et rejouée à l'arrivée de la maison.
- Un appareil non placé sélectionné dans le panneau (après un retrait, ou depuis une liste) n'avait aucun
  moyen d'être posé : carte « Placer » ajoutée à la place de la section « Emplacement ».

Vérifié en réel avec « TV Salon » : bouton → maison au 1er, provisoire au centre, RDC puis 1er par les
onglets (le point suit), dépôt dans le salon → entrée `auto.google_cast-…` écrite avec `roomId: salon`,
fil d'Ariane « Salon », coordonnées « x 4,00 · y 2,60 · Salon ». Deux téléviseurs Sony en veille
restent « Indisponible » (le protocole Cast s'y coupe en veille) mais se posent tout de même.

### Mise à jour 2026-09-10 — « Oublier l'appareil », et rien ne déborde du panneau

Deux demandes de l'utilisateur sur le même appareil : le téléviseur du salon, éteint, s'affichait sous son
id brut, et « tout débordait » du panneau latéral.

**Oublier l'appareil** — pendant de la mémoire du plugin Cast (`../3_plugins/3_6_google-cast.md`) : sans
lui, un appareil vu une fois resterait listé pour toujours. Composant partagé
`components/devices/ForgetDeviceButton.vue`, geste en **deux temps** (« Oublier l'appareil » puis
« Confirmer l'oubli » dans les 4 s, sinon il se désarme), largeur commune aux deux libellés — même patron
que « Retirer de la maison ». Il n'apparaît que si le descripteur porte `meta.forgettable`, que l'appareil
est **indisponible** et qu'il n'est **pas** dans la maison. Deux endroits, les deux seuls où un fantôme se
voit :
- **panneau appareil**, dans la carte « Emplacement · Placer » (sur une seconde ligne, sous le bouton
  « Placer », avec « Cet appareil ne répond plus ») ; l'oubli referme le panneau, son sujet ayant disparu.
  Un appareil **placé** se retire d'abord de la maison — sinon son entrée viserait un id oublié ;
- **vues en bandes** (`RoomBands`, bande « Hors maison »), sur **sa propre ligne** de la grille
  (`grid-column: 1 / -1`, aligné à droite, sous le contrôle) : à côté du nom, la pilule ne laissait plus
  rien à lire dans une carte étroite (essayé, écarté).

**Rien ne déborde du panneau** (340 px) — le nom d'un appareil non lié est un id de cinquante caractères :
- panneau appareil : le nom passe par `MarqueeText` (défilement avec fondu, comme un titre de morceau) ;
- sa sous-ligne (nature · disponibilité · fabricant) tient sur une ligne, coupée aux points de suspension,
  avec **« Indisponible » avant la marque** : si la ligne est coupée, c'est le fabricant qui part ;
- la carte « Cet appareil n'est lié à aucun plugin (…) » coupe l'id n'importe où (`overflow-wrap: anywhere`) ;
- les lignes du panneau pièce prennent l'ellipsis, comme celles des vues en bandes ;
- `.side-panel__scroll` reçoit `overflow-x: hidden` en **garde-fou** : chaque contenu se charge de tenir
  dans la largeur, et celui qui l'oublierait est découpé là plutôt que de passer par-dessus la 3D.

Mesuré après coup dans le navigateur (panneau ouvert sur l'appareil non lié) :
`scrollWidth == clientWidth == 339` — plus rien ne sort, seul `.marquee__inner` dépasse, à l'intérieur de
son masque. La pilule du marqueur 3D est traitée dans `4_0_langage-visuel.md`.

### Mise à jour 2026-09-11 — tuiles de synthèse : caméras et lecteurs à la place de solaire et batterie

Les deux tuiles d'énergie du `HomePanel` (production solaire, charge de la batterie) cèdent la place
à **caméras** et **lecteurs**. Demande de l'utilisateur : l'énergie a déjà sa vue dédiée avec l'anneau
et le graphique, tandis que ces deux compteurs n'avaient aucun endroit où se lire d'un coup d'œil.
Décision explicitement provisoire (« pour l'instant ») : les tuiles d'énergie peuvent revenir.

Les deux tuiles ne portent pas le même genre de chiffre, et c'est volontaire :

- **`N` caméras** — un nombre simple, pas de fraction. L'état d'une caméra ne contient que
  `available` (`cameraStateSchema`, `packages/shared/src/devices/state.ts`) : l'API Google Nest ne dit
  ni si une caméra filme ni si elle est joignable. L'« active » de la vue Caméras vient du sondage des
  vignettes, que le panneau maison ne fait pas — une fraction ici serait inventée. Même raison de fond
  que la position inconnue d'un ouvrant : ne rien affirmer plutôt qu'afficher un chiffre faux.
- **`0/N` lecteurs** — en diffusion sur le total, la forme des volets. Le numérateur est le `playing`
  de `useHomeSummary` : lecture propre **ou** son relayé d'un autre appareil (barre de son en HDMI ARC,
  `lib/audioRouting.ts`), donc exactement le même compte que « n lecteurs en diffusion » de l'en-tête.

`useHomeSummary` gagne pour cela un compteur `cameras` (les `players` / `playing` existaient déjà).
Côté i18n, `home.cameras` et `home.players` remplacent `home.battery` (supprimée) ; `home.solar` reste,
la vue Énergie s'en sert comme indice de sa tuile de production.

Mesuré sur la preview (thèmes clair et sombre) : les quatre tuiles font 84 px de haut et les quatre
libellés tiennent sur une ligne de 18 px — d'où des libellés courts (« caméras », « lecteurs ») et le
qualificatif porté par la valeur plutôt que par l'étiquette. C'est la règle « rien ne doit bouger »
(`4_0_langage-visuel.md`) : les hauteurs ne changent pas quand les compteurs changent.

### Mise à jour 2026-09-11 — les onglets de niveau emmènent l'appareil qu'on déplace

Demande de l'utilisateur, venue d'un cas réel : le toit est devenu un niveau
(`../2_maison/2_0_format-house-json.md`) et une caméra, ancrée à une pièce d'un étage, ne pouvait
pas l'y rejoindre — « je ne parviens pas à le faire via l'UI ». Rien dans la section « Emplacement » ne
touchait au niveau. L'utilisateur s'attendait à ce que les onglets s'en chargent, comme ils le font déjà
pour un appareil *provisoire* : c'est donc ce geste-là qui est étendu, plutôt qu'un sélecteur de plus.

- **Mode « Déplacer » ouvert** : changer d'onglet de niveau **emmène l'appareil sélectionné** sur ce
  niveau (mécanique dans `../1_architecture/1_4_app-web.md`). Il garde son x;y et sa hauteur *dans
  l'espace* ; il retrouve une pièce s'il en survole une, sinon le niveau l'ancre seul.
- **Hors du mode**, un onglet ne fait toujours que naviguer. À lire avec la phrase du 2026-09-07 (« toute
  sortie de l'appareil… quitte le mode ») : les onglets **Tout** et **Jardin** vident la sélection et
  ferment donc le mode, les onglets de niveau le gardent ouvert — et déplacent, maintenant.
- Le conseil de la section le dit : « Faites glisser l'appareil dans la vue 3D pour le déplacer, **ou
  changez d'onglet de niveau pour l'y emmener**. La hauteur se règle ici. »
- La ligne `x · y · pièce` affiche le **niveau** quand aucune pièce n'ancre l'appareil (« x 1.20 ·
  y 2.40 · Toit ») au lieu de « hors pièce » : c'est ce qui confirme à l'écran que le changement d'onglet
  a pris. « hors pièce » ne reste que pour un appareil sans pièce **et** sans niveau.

Le guide de la scène (anneau au sol, fil, cône) restait invisible sur un niveau-toit, enterré sous la
dalle de toiture : corrigé dans `../1_architecture/1_5_scene-3d.md`.

### Mise à jour 2026-09-12 — « Déplacer » : taille, battants, sens de rotation, et plus rien de coupé

Trois corrections et deux ajouts dans la section « Emplacement » du panneau appareil
(`PlacementControl.vue`) :

- **Taille d'un ouvrant libre** — une ligne par dimension, deux touches −/+ au pas de 25 cm, écrit à
  chaque pression dans `house.json` (`size`). Le libellé de la seconde dimension suit la nature :
  « Hauteur » pour un portail debout, « **Avancée** » pour un store déployé à plat. Deux séries de
  touches sur une même ligne ne laissaient plus de place au libellé dans 340 px.
- **Battants** — un segmenté 1 / 2 (`leaves`), proposé aux seuls ouvrants debout : un store se
  déploie d'une pièce, la question ne se pose pas pour lui.
- **Orientation** ouverte aux ouvrants libres et au thermostat (`../1_architecture/1_5_scene-3d.md`).
- **Sens de rotation inversé** — le `yaw` du JSON tourne dans le sens trigonométrique, donc
  l'augmenter faisait pivoter l'objet vers la **gauche** : la touche de droite tournait à gauche.
  C'est maintenant la touche de gauche qui augmente le `yaw` et celle de droite qui le diminue — ce
  qu'on voit tourner suit la touche qu'on appuie, pas la convention du fichier.
- **Le corps du panneau ne coupe plus son contenu** — le « m » de la hauteur de pose était rogné. Le
  corps est en `overflow: hidden` (il s'anime en hauteur) et sa grille avait une colonne `auto`, qui
  ne descend jamais sous le min-content de ses lignes : 270 px de contenu dans 267 px de place,
  mesuré. Colonne passée en `minmax(0, 1fr)` (piège détaillé dans `../6_faq/6_0_pieges-outillage.md`).

La ligne « Hauteur » du curseur de pose devient « **Hauteur de pose** » : elle cohabite désormais avec
la hauteur d'un portail, et deux « Hauteur » dans le même panneau ne se distinguaient plus.

### Mise à jour 2026-09-12 (ter) — le fil d'Ariane remonte au parent, et un niveau devient un panneau

Deux constats de l'utilisateur : le retour d'un appareil du toit affichait « Maison », et « Salon
devrait afficher 1er comme parent ». Le fil d'Ariane sautait donc un cran — parfois deux.

**La chaîne est maintenant complète** : appareil → pièce (ou zone, ou **niveau**) → maison.
`DevicePanel` nomme la pièce, à défaut la zone, à défaut **le niveau** qui porte l'appareil ;
`RoomPanel` nomme le **niveau** d'une pièce. Les actions correspondantes vivent dans le store
(`backFromDevice`, `backFromRoom`, `../1_architecture/1_4_app-web.md`).

**Le panneau d'un niveau** est rendu par `RoomPanel`, qui sait désormais afficher une pièce, une zone
**ou un niveau** : titre = nom du niveau, sous-titre « 5 pièces · 1 appareil » (ou « Maison ·
2 appareils » pour un niveau sans pièce, comme le toit), puis une section **Pièces** et enfin les
appareils posés sur le niveau **hors de toute pièce**. Sans ses pièces, remonter du Salon au 1er étage
aurait donné une page presque vide — un parent doit montrer ses enfants. Pas d'« Ambiances » sur un
niveau (les scènes du fabricant se rapprochent par nom de pièce), et les deux contrôles d'ensemble
des lampes s'effacent d'eux-mêmes faute de lampes.

**`RoomRows.vue`** (nouveau, `components/home/`) porte les lignes de pièce — nom, « n appareils ·
n actifs », interrupteur maître, sélection au clic — extraites de `HomePanel` et partagées avec le
panneau de niveau. Le calcul des compteurs a suivi dedans ; `where` (le niveau, à droite) devient
optionnel : dans un niveau il répéterait le titre. Le panneau maison est inchangé à l'écran.

**Le tap sur le toit en 3D sélectionne ce niveau** (onglet, panneau, cadrage sur la dalle) ; re-taper
ressort, comme un second tap sur une pièce. Voir `../1_architecture/1_5_scene-3d.md`.

**« Maison » fait ce que fait l'onglet « Tout »** (`HomeView.backToAll`) : arrivé au dernier cran, le
retour déplie la maison entière et recadre la vue d'ensemble. Auparavant il vidait la sélection en
laissant la caméra sur le niveau qu'on regardait — on revenait « à la maison » en voyant toujours le
1er. Les crans intermédiaires, eux, ne recadrent que leur propre échelle.

Nouvelle clé i18n `home.roomsCount` (« {n} pièce | {n} pièces »).

### Mise à jour 2026-09-12 (quater) — les valeurs du mode « Déplacer » se saisissent aussi

Régler un portail de plusieurs mètres au quart de mètre demandait des dizaines d'appuis sur « + ». L'orientation, la
largeur et la hauteur (ou l'avancée) se **tapent** désormais, dans le champ posé entre les deux
touches — qui restent, elles servent à l'ajustement fin au doigt.

Trois règles pour que ce champ ne fasse pas de dégâts :

- **il ne commite qu'à la validation** — Entrée ou perte du focus, jamais à la frappe : écrire
  house.json à chaque caractère enverrait une maison par touche. `Échap` abandonne la saisie ;
- **tant qu'on tape, c'est le brouillon qui s'affiche** — sinon la maison relue du serveur écraserait
  la saisie en cours sous les doigts ;
- **la valeur est nettoyée avant d'être écrite** : virgule décimale acceptée (c'est ce que tape un
  clavier français), taille bornée aux limites du réglage, orientation ramenée dans le tour
  (`-45` → `315`), saisie illisible ignorée, et rien n'est écrit si la valeur n'a pas changé.

Le champ occupe **exactement** la place que le texte occupait : même police, même graisse, même
largeur, chiffres à chasse fixe, et son soulignement est posé en `box-shadow` plutôt qu'en bordure —
passer en édition ne déplace donc rien (règle « rien ne doit bouger », `4_0_langage-visuel.md`). Sa
hauteur est celle des touches −/+ qui l'encadrent, ce qui lui donne au passage une cible tactile.

### Mise à jour 2026-09-15 — la vue Maison devient immersive : tout flotte sur la scène

**Remplace** la section « Grille » ci-dessus pour la vue Maison. Auparavant, `App.vue` posait une
grille `rail | vue` et `HomeView` ajoutait sa colonne droite `--aside-w` ; depuis le 2026-09-15
(maquette fournie par l'utilisateur, voir `../1_architecture/1_5_scene-3d.md`) :

- **Rail** (`layout/NavRail.vue`) : `position: absolute` sur la vue, **sans fond ni bord**
  (`z-index: 5`) ; `.app-main` réserve sa largeur en `padding-left`. Ajout du jour (« on a du mal à bien voir les
  icônes ») : un **voile** `::before` derrière les boutons, du fond `--bg` vers le transparent sur la
  largeur du rail plus 72 px — les icônes se lisent par-dessus murs et pilules, sans bord franc ; sur
  les autres vues il a la couleur du fond et ne se voit pas. Les autres vues ne changent
  donc pas de place ; seule la vue Maison passe dessous.
- **`HomeView`** : `margin-left: calc(-1 * var(--rail-w))` pour déborder sous le rail, la scène en
  `position: absolute; inset: 0`. Flottent dessus : l'en-tête (`.home__header`, décalé du rail à
  gauche et du panneau à droite quand il est ancré, `pointer-events: none` sauf ses enfants), une
  **vignette** CSS en thème sombre seulement (`html[data-theme='dark']`, dégradé radial qui
  assombrit les bords), et les **boutons de vue** en bas à droite : deux grappes en pilule verticale
  (tourner à gauche / à droite, rapprocher / éloigner) et le bouton « Vue d'ensemble » —
  `data-wide` les décale de la largeur du panneau ancré. Libellés `home.rotateLeft` / `rotateRight` /
  `zoomIn` / `zoomOut`.
- **Panneau** (`layout/SidePanel.vue`, mode ancré) : **carte flottante** — `position: absolute`,
  marges `--panel-gap` (16 px, `styles/tokens.css`), rayon 20 px, fond `surface` à 86 % avec
  `backdrop-filter: blur(16px)`. Le tiroir des écrans < 1000 px est inchangé.
- La scène **se cadre dans la partie libre** du canvas quand le panneau est ancré
  (`HouseScene.setViewInset`, voir la page scène 3D) : la maison n'est plus centrée derrière lui.

Vérifié aux deux thèmes, à 1024 px (panneau ancré) et 768 px (tiroir, bouton dans l'en-tête).

Sources : `apps/web/src/App.vue`, `apps/web/src/views/HomeView.vue`, `apps/web/src/components/layout/{NavRail,SidePanel}.vue`, `apps/web/src/styles/tokens.css`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-15 (ter) — le niveau d'un appareil se change dans « Emplacement », plus par l'onglet

**Remplace**, pour le mode « Déplacer », la règle « l'onglet de niveau emmène l'appareil » (mise à
jour du 2026-09-07 ci-dessus et `1_architecture/1_4_app-web.md`). Incident du jour : un cube
(appareil) avait disparu. Le `.bak` de la maison montrait l'entrée ré-ancrée du niveau `rdc` au niveau `toit`
(`z` −2,5, même point dans l'espace) : le cube était en déplacement, et un clic sur l'onglet Toit —
pour aller regarder la lumière qui traversait la dalle — l'avait emmené là, sans le dire. Un appareil
du toit est masqué dès qu'on regarde le 1er. Décision de l'utilisateur : « le changement de niveau
se fait par un select dans la section déplacement ».

- **Store** (`stores/house.ts`) : le `watch(focusedLevelId)` qui appelait `moveToLevel` est
  retiré ; l'onglet ne fait plus que naviguer, en mode « Déplacer » ou non. `setPlacementLevel(id)`
  fait ce qu'il faisait (provisoire → centre du niveau ; appareil placé → `moveToLevel` : x;y gardés,
  pièce reprise sous le point, hauteur conservée dans l'espace) et **fait suivre la vue**
  (`focusedLevelId`). `placementLevelId` expose le niveau d'ancrage courant.
- **Panneau** (`components/home/PlacementControl.vue`) : ligne « Niveau » avec un `v-select`
  (niveaux du haut vers le bas, `shortName`), au-dessus des préréglages de hauteur ; largeur fixe,
  rien ne bouge. Le conseil du mode ne parle plus de l'onglet (`place.hint`, `place.level`).
- Le cube a été remis dans sa pièce (`z` 0,10 = préréglage « Sol ») par la route
  `PUT /api/house/devices/:id`. D'autres appareils de la maison réelle restent ancrés à un niveau
  seul — voulu pour le toit, à vérifier pour les caméras d'étage.

Test (`stores/house.test.ts`) : en mode « Déplacer », `focusLevel('etage')` ne change ni l'ancrage ni
la position ; `setPlacementLevel('etage')` ré-ancre dans la pièce sous le point avec la même hauteur
absolue, et la vue passe à l'étage.

### Mise à jour 2026-09-15 (quater) — le panneau flottant : en-tête collant, fondus, barre sans flèches

Retour de l'utilisateur sur la carte flottante : flèches de la barre de défilement qui dépassaient de
l'arrondi, liste tranchée net en bas, en-tête perdu dès qu'on fait défiler.

- **Barre de défilement** (`layout/SidePanel.vue`) : la carte ancrée passe en `overflow: hidden` (la
  barre suit l'arrondi), barre de 6 px sans flèches (`::-webkit-scrollbar-button { display: none }`),
  piste transparente, pouce `--line` visible au survol seulement.
- **Fondu bas** : `mask-image` sur le conteneur de défilement, du plein à transparent sur les 36
  derniers pixels (barre comprise), et 36 px de marge basse. Pas de masque en haut : il effacerait
  l'en-tête collant.
- **En-tête collant** (`.panel-head`, `styles/app.css`) : les panneaux pièce et appareil enveloppent
  fil d'Ariane + titre dans un bloc `position: sticky; top: 0`, qui reprend le verre du panneau
  (surface à 90 %, flou de ce qui passe dessous), déborde des marges du conteneur pour couvrir toute la
  largeur, et porte sous lui un fondu de 18 px (`::after`). **Piège** rencontré aussitôt (« on voit le reste passer
  au-dessus ») : Chrome cale la BOÎTE DE MARGE d'un élément collant, pas sa bordure — avec une marge
  haute négative de P et `top: 0`, la bordure se calait P px sous le haut du conteneur et 20 px de
  contenu défilé restaient visibles au-dessus. `top: -P` compense exactement ; P est le jeton
  `--panel-pad-top` que `SidePanel` déclare (20 px ancré, `safe-top` + 20 px en tiroir) et que
  `.panel-head` lit. Mesuré : bordure de l'en-tête à 0 px du haut du conteneur une fois défilé. Le panneau maison n'a pas d'en-tête (ses
  tuiles défilent avec le reste). La pochette de fond du panneau appareil (`.art`) reste derrière.

Vérifié sur la maison réelle (panneau d'une pièce, appareils et ambiances) : l'en-tête reste en vue, les
lignes s'effacent sous lui et en bas, plus de flèches.

### Mise à jour 2026-09-16 — le rail cycle sur quatre apparences, et ce que le libellé coûte à la grille

**Rail** : le bouton d'apparence ne fait plus trois pas mais **quatre**, et il suit désormais l'ordre
du segmenté des Réglages — clair → sombre → système → auto → clair. `cycleAppearance()` parcourt
`APPEARANCES` par index au lieu d'enchaîner des ternaires : ajouter un mode demain ne demandera plus
d'y toucher. Remplace sur ce point la description « cycle système → clair → sombre » de la section
Rail ci-dessus. Le quatrième mode a son icône, `sunHorizon` (voir `4_0_langage-visuel.md`) ; les
trois autres gardent `sun` / `moon` / `auto`.

**Réglages** : le segmenté d'Apparence passe à quatre segments. La pile de gauche réclamait 344 px de
min-content (le segmenté de langue, mesure du 2026-09-16 plus haut) ; avec « Automatique » comme
quatrième libellé elle montait à **417 px**, et la piste centrale tombait à 617 px au lieu de 740 à
1500 — la grille tenait (aucun débordement) mais le bloc Rendu 3D payait 73 px pour un mot. Le
libellé retenu est donc **« Auto »** (clé dédiée `settings.appearanceAuto`, distincte du
« Automatique » de la langue) : la pile revient à **363 px** et les proportions mesurées à 1600
redeviennent 363 / 726 / 363, soit 1-2-1 exact.

À retenir pour la suite : dans cette grille, **la longueur d'un libellé est une contrainte de
layout**, pas un détail de traduction — un segmenté à `white-space: nowrap` et `flex: 1 1 0` (voir
`.w-100` de `SettingsView.vue`) reporte la somme de ses mots sur le min-content de sa piste.

Une ligne d'aide permanente sous le segmenté (`settings.appearanceHint`) distingue « Système » (le
réglage clair/sombre de l'appareil) de « Auto » (le soleil). Permanente et non conditionnée au mode
choisi : la carte garde la même hauteur quoi qu'on coche — règle « rien ne doit bouger »
(`4_0_langage-visuel.md`).

Sources : `apps/web/src/components/layout/NavRail.vue`, `apps/web/src/views/SettingsView.vue`,
`apps/web/src/stores/settings.ts`, `apps/web/src/lib/daylight.ts`.

### Mise à jour 2026-09-17 (ter) — la barre de recherche de la vue Maison

Un champ posé **en bas de la scène**, dans la bande libre entre la carte météo (à gauche) et les
boutons de vue (à droite), centré dedans. Il atteint tout ce que la maison contient : pièces, zones
du jardin, niveaux, appareils (placés ou non), ambiances, et les **pages du rail**. À partir de deux
caractères la liste s'ouvre, se réduit à la frappe, et valider déplace la sélection.

#### Les cinq décisions qui tiennent le reste

**1. Aucun index — un balayage linéaire par frappe.** Les entités vivent déjà dans les stores
Pinia : une maison réelle compte quelques niveaux, **des dizaines de pièces et d'appareils** dans son fichier de maison,
auxquels s'ajoutent les appareils de plugin et les ambiances — quelques centaines d'entrées.
Parcourir cette liste coûte moins que la frappe qui la déclenche : ni index inversé, ni Fuse.js,
ni dépendance. Ce qui compte n'est pas la structure de données mais la **normalisation** (NFD sans
diacritiques, minuscules : « etage » trouve « Étage ») et le **classement**. `lib/search.ts` est
pur (ni store ni DOM) ; `composables/useSearch.ts` aplatit les stores en `SearchEntry[]` dans un
`computed` qui ne se refait qu'à un changement de maison, d'appareils ou d'ambiances, et les noms
normalisés sont mémorisés à côté (`haystacks`) plutôt que recalculés à chaque touche.

**2. Rien à déclarer côté plugins.** Le contrat appareil porte déjà `name`, `kind`, `meta.room`,
`meta.manufacturer` et `meta.model` : la recherche n'a demandé **aucun champ nouveau** et **aucun
plugin n'a bougé**. Le point d'extension est côté web — une boucle par famille dans `useSearch.ts`
(`room` / `zone` / `level` / `device` / `scene` / `page`). Voir aussi
`../1_architecture/1_1_contrat-appareils.md`.

**3. Un résultat NAVIGUE, il n'agit jamais.** `go()` appelle les **mêmes setters que le tap dans la
scène** (`house.selectRoom`, `selectLevel`, `selectDevice`, `backToHome`), qui cadrent la 3D et
ouvrent le bon panneau ; `HomeView.onSearchPicked` se contente d'ouvrir le tiroir, sauf pour une
page (qui change de route). Conséquence assumée : **une ambiance emmène là où sa pastille se
touche, elle ne se rappelle pas**. Une faute de frappe ne doit pas changer la lumière de toute la
maison — le coût d'une erreur de recherche doit rester un coup d'œil, jamais une action.

**4. Le niveau de l'objet est focalisé.** Sans cela, valider « Plafonnier salon » depuis l'onglet
« Tout » cadre un marqueur que l'étage et le toit recouvrent : `HouseScene.applyLevelFocus()` ne
masque **rien** tant qu'aucun niveau n'est focalisé (`focused` nul → tous les groupes visibles,
toit compris). La focalisation se fait donc des deux côtés : `house.selectDevice()` pose
`focusedLevelId` depuis la pièce, le niveau ou la zone de l'appareil, et `HouseScene.focusDevice()`
appelle `focusLevel()` avant de cadrer. Deux tests de `SearchBar.test.ts` le verrouillent (niveau
de l'appareil, et jardin pour un appareil de zone).

**5. Les appareils non placés sont montrés**, avec « Non placé » (`rooms.origins.unplaced`) à la
place du lieu. `resolveDevice` accepte un id de plugin comme clé de sélection : leur panneau
s'ouvre quand même, et c'est de là qu'on les place. Les cacher ferait un appareil **introuvable
sans dire pourquoi** — le pire des deux, puisque l'utilisateur sait qu'il existe.

#### Le score : trois crans, et la marque au dixième

`scoreTerm` classe la place du terme dans le texte : **début de texte (3) > début de mot (2) >
milieu de mot (1)** — les mots étant coupés sur espace, tiret, apostrophe, point médian et
ponctuation. Taper « salon » donne ainsi la **pièce Salon avant la lampe « Lampe salon »**.
`scoreQuery` exige que **tous** les mots de la requête soient présents et retient **le plus mal
placé** : un nom où chaque mot tombe en début de mot vaut mieux qu'un nom où l'un d'eux se cache.
À score égal, `FAMILY_RANK` départage (pièce, zone, niveau, appareil, ambiance, page), puis l'ordre
alphabétique.

**Marque et modèle cherchables, en second rang** — ajout du jour même, après un retour d'usage :
« proteo » ne trouvait pas la station COMAP, dont le nom est « Traitement de l'eau », et la R5
s'appelle « AB-123-CD » chez Renault (personne ne cherche une voiture par sa plaque). Un appareil
porte donc un `alias` (`meta.manufacturer` + `meta.model`), un niveau son nom court (« RDC »). Un
score de nom pèse **dix fois** un score d'alias (`NAME_WEIGHT = 10`) : la moindre correspondance de
nom passe devant « Tesla ». Et **quand on est arrivé par l'alias, la ligne l'affiche à la place du
lieu** (« Traitement de l'eau — COMAP Proteo V3 »), sinon elle paraît sortie de nulle part.

Deux seuils : `MIN_QUERY = 2` (une lettre ramènerait la maison entière) et `MAX_RESULTS = 20`
(au-delà la liste ne se lit plus — c'est la frappe suivante qui trie, pas le défilement).

#### Rien ne bouge (la règle du projet, mesurée)

- **La liste s'ouvre vers le HAUT** (`bottom: calc(100% + 8px)`), donc le champ ne bouge jamais,
  quel que soit le nombre de résultats. Mesuré à 1280×800 sur **31 états de frappe enchaînés** :
  **une seule géométrie sur 31**, champ `[349, 740, 380, 44]`, et le **bas de la liste figé à
  732 px** quelle que soit sa hauteur (48 / 140 / 186 / 230 px). Idem à 900×700 en mode tiroir
  (10 états, bas figé à 632 px).
- **Cinq lignes visibles** (`max-height: calc(5 * 46px)`), le reste au défilement **interne**
  (`overscroll-behavior: contain`) : « panneau » sort 20 lignes, `clientHeight` 228 px pour
  `scrollHeight` 920 px, et `document.scrollTop` ne bouge pas.
- **La place de la croix « Effacer » est réservée** (`visibility: hidden`, pas `v-if`) : l'`input`
  fait **292 px avec ou sans**, à 0,00 px près. Un bouton qui apparaît rétrécirait le champ sous
  les doigts.
- **Ancrage par jetons, pas par pixels recopiés** : `--wx-w: 152px` (carte météo) et `--ctl-w: 44px`
  (boutons de vue) sont montés dans `styles/tokens.css`, et `.home__search` se cale dessus. Un
  `152px` recopié dans `HomeView.vue` se serait décalé au premier changement de la carte météo.
  Centrage vérifié **au pixel (0,0 px d'écart de marges)** sur six tailles, de 1280×800 à 600×467,
  ancré comme en tiroir, sans aucun recouvrement ni défilement horizontal.
- **Clavier** : ↑/↓ déplacent (avec `scrollIntoView({ block: 'nearest' })`), Entrée valide, **Échap
  efface d'abord et rend la main ensuite** (on corrige une frappe sans perdre le champ). La frappe
  remet le curseur en tête, sinon Entrée validerait la 4ᵉ ligne d'une liste qui a changé.
  `@mousedown.prevent` sur la liste : sans lui le champ perd le focus **avant** le clic, la liste se
  ferme et le résultat n'est jamais choisi.

#### Les deux défauts que la revue a trouvés, et leur correction

- **`text-overflow: ellipsis` se pose sur le CHAMP, pas sur `::placeholder`.** À 600×467 l'`input`
  tombe à 180 px pour un texte indicatif de 227,5 px : « Rechercher une pièce, un a », coupé net.
  La propriété posée sur `::placeholder` est **refusée** (vérifié par `getComputedStyle`) ; posée
  sur `.search__input` elle rend « Rechercher une pièce, un … ».
- **La ligne active a gagné un liseré accent de 2 px.** Sa teinte seule
  (`color-mix(… var(--accent) 14% …)`) ne la détachait que de **1,26:1** en sombre et **1,22:1** en
  clair, là où un état d'interface non textuel se repère à **3:1** — visible de près, pas à la
  distance d'une tablette murale. Le liseré reprend le geste de la pièce sélectionnée dans
  `RoomRows` et monte à **5,8:1** en clair, **7,1:1** en sombre. Il est en **`outline` (avec `outline-offset: -2px`) et
  non en `border`** : il se pose *sur* la ligne sans changer sa hauteur de 46 px — sinon la liste
  se serait allongée d'un cran à chaque déplacement du curseur.

#### Contrastes et accessibilité (mesurés aux deux thèmes)

Texte saisi 14,49 (sombre) / 17,16 (clair), texte indicatif 6,00 / 4,87, libellé de ligne 14,34 /
17,35, sous-titre gris 5,93 / 4,92 — tous au-dessus de 4,5:1. Le fond flouté est quasi opaque
par-dessus la 3D (`rgb(20,28,43)` en sombre, `rgb(252,253,253)` en clair) : lisible sur une scène de
jour comme de nuit, et aucune couleur en dur (tout suit `--surface` / `--text` / `--muted` /
`--accent`). Le nombre de résultats est annoncé aux lecteurs d'écran par une région `aria-live`
(« 0 résultat » / « 1 résultat » / « 5 résultats », pluriel vérifié).

#### Connu et non corrigé

En mode **tiroir** (< 1000 px), valider un résultat ouvre le panneau **par-dessus** la barre : à
900×700 le tiroir recouvre la moitié droite du champ, plus un voile. Le champ **ne se déplace
pas**, il est masqué — même sort que les boutons de vue. C'est le comportement du tiroir, antérieur
à la recherche, laissé tel quel.

Sources : `apps/web/src/lib/search.ts`, `apps/web/src/composables/useSearch.ts`,
`apps/web/src/components/home/SearchBar.vue`, `apps/web/src/lib/navItems.ts` (la liste des vues du
rail, sortie de `NavRail.vue` pour être lue **aussi** par la recherche : une seule liste, deux
lectures), `apps/web/src/views/HomeView.vue` (bloc `.home__search`),
`apps/web/src/styles/tokens.css`, `apps/web/src/stores/house.ts`,
`apps/web/src/three/HouseScene.ts`. Tests : `apps/web/src/lib/search.test.ts` (6) et
`apps/web/src/components/home/SearchBar.test.ts` (10).

## Banc de réglage de la lumière, posé sur la vue Maison (2026-09-18)

Un réglage de lumière ne se juge que **devant la maison, à l'heure qu'elle a**. Le banc
(`SceneTuningPanel.vue`) n'est donc pas une carte des Réglages : il flotte sur la vue Maison, à
gauche contre le rail, largeur fixe de 320 px, hauteur plafonnée et corps qui défile. Les Réglages
n'en portent que **l'interrupteur** : une ligne « Régler la lumière » dans la carte « Rendu 3D », dont
le bouton arme le panneau et **emmène sur la vue Maison** (`router.push({ name: 'home' })`).

Le panneau, de haut en bas : les quatre **préréglages** en pastilles (la pastille active est celle
dont le réglage courant est la copie conforme), la **courbe** de tone mapping, puis quatorze curseurs
en trois groupes — Image, Lampes, Pièce sélectionnée — et une bascule « Trait visible à travers les
murs ». Au pied du défilement, un relevé monospace donne **ce que la chaîne d'image applique
vraiment**, style et réglage confondus (`HouseScene.tunedLook()`) : le nombre qu'on ira écrire dans
un style le jour où un défaut sera arrêté.

La ligne d'un curseur est une grille `84px | 1fr | 52px` : la cellule de valeur a une **largeur fixe
et des chiffres tabulaires**, sinon la piste se raccourcissait en passant de « × 1,00 » à « × 0,75 »
— la règle « rien ne bouge » vaut aussi pour un outil de réglage.

### Les deux boutons, et ce qu'ils veulent dire

Ils sont côte à côte, toujours aux deux mêmes places :

- **Réinitialiser** ne disparaît ni ne se grise jamais. Il rend ce que le style calcule (× 1 partout)
  et **ne touche pas** à ce qui est enregistré dans la maison. C'est la sortie de secours d'un
  réglage qu'on ne retrouve plus.
- **Enregistrer** écrit le réglage dans la maison (`PUT /api/house/render`) et ne s'allume que
  lorsqu'il a quelque chose à écrire. Enregistrer un réglage neutre **retire** la section du fichier.

Entre les deux vit un **brouillon local** : on tire les curseurs toute une soirée sans rien écrire
dans le fichier de la maison, et l'enregistrement l'efface — la maison redevient la source. C'est ce
que disent les trois valeurs calculées du store : `savedSceneTuning` (la maison), `sceneTuning` (le
brouillon s'il existe, sinon la maison) et `sceneTuningDirty` (le bouton a-t-il quelque chose à
dire).

Sources : `apps/web/src/components/home/SceneTuningPanel.vue`, `apps/web/src/views/HomeView.vue`,
`apps/web/src/views/SettingsView.vue` (`openTuning`), `apps/web/src/stores/settings.ts`,
`apps/web/src/stores/house.ts` (`saveRenderTuning`).

### Mise à jour 2026-09-18 (2) — le groupe « Tilt-shift » du banc

Un cinquième groupe de curseurs au banc de réglage : flou, hauteur et largeur de la bande nette, et
**pilules floutées**. Ce dernier curseur est la réponse à une question qui n'avait pas de bonne
réponse — les pilules sont en DOM, le flou de la scène ne les atteint pas, et les deux partis (les
laisser nettes, les effacer) se défendent. Elle est donc rendue à qui regarde, comme le reste du
banc, plutôt que tranchée dans le code.

### Mise à jour 2026-09-20 — filtre de la liste d'une pièce, en icônes

Le panneau d'une pièce (et d'un niveau) gagne un **contrôle segmenté** au-dessus de la liste
d'appareils, le même genre de switch que les onglets de niveau — pas des pilules libres à la
`SceneChips`.

**Ce qui s'affiche.** « Tout » plus les **catégories réellement présentes** dans la pièce, dans un
ordre fixe : lumière, volet, température (kind `climate` **ou** sonde `sensor` de classe
`temperature`), média, caméra, autre. Une seule catégorie n'affiche pas la barre (le geste ne
ferait rien). Le compteur du titre reste celui de la pièce entière. Changer de pièce ramène à
« Tout ».

**Pourquoi des icônes.** Un premier jet en libellés (« Lumière », « Température », « Caméra »)
tenait mal : cinq segments dans ~282 px, « Camera » déjà coupé. Les icônes sont celles du rail
(`light`, `shutter`, `cast`, `camera`), plus `thermostat` pour la température, `devices` pour Tout,
`dots` pour Autre (`ROOM_FILTER_ICONS` dans `lib/deviceIcons.ts`). Le nom reste en `title` et
`aria-label`.

**Ce que `Segmented` a gagné** (additif, les autres appels inchangés) : `fill` — pleine largeur,
segments `flex: 1 1 0` avec `min-width: 0`, pour ne plus imposer un min-content — et `icon` par
option. Le piège chiffré des natures d'ouverture (ci-dessus) reste : un libellé long n'a toujours
pas sa place ici.

Sources : `apps/web/src/components/home/RoomPanel.vue`, `apps/web/src/components/ui/Segmented.vue`,
`apps/web/src/lib/deviceIcons.ts`, `apps/web/src/i18n/locales/{fr,en}.json` (`home.filter.*`).

### Mise à jour 2026-09-21 — l'apparence quitte le rail, les Réglages s'y épinglent en bas

Deux mouvements dans la même passe, demandés par l'utilisateur.

**Le rail épingle les Réglages tout en bas.** `settings` était la dernière entrée de `NAV_ITEMS`,
donc la dernière de la file : sa place dépendait du nombre de vues au-dessus, et chaque vue ajoutée
la faisait descendre d'un cran. Elle occupe maintenant le pied du rail, sous `.rail__spacer`, à la
place qu'occupait le bouton d'apparence — une destination fixe, atteignable sans lire la colonne.

`settings` **reste dans `NAV_ITEMS`** : la barre de recherche de la vue Maison lit cette liste pour
sa famille « pages » (taper « réglages » ouvre la page, cf. la section Recherche plus haut). Le rail
la filtre à l'affichage et re-rend la même entrée après le spacer, avec le même `rail__btn`, le même
état actif et le même libellé i18n :

```ts
const items = NAV_ITEMS.filter((it) => it.name !== 'settings')
const settingsItem = NAV_ITEMS.find((it) => it.name === 'settings')!
```

Retirer l'entrée de `NAV_ITEMS` aurait été plus court d'une ligne et aurait cassé la recherche sans
rien faire échouer — un des deux lecteurs de cette liste est silencieux.

**L'apparence passe dans l'en-tête de la vue Maison.** Le bouton clair / sombre / système / auto
quitte le rail pour une pilule dans la rangée de `PageHeader`, **juste après les onglets de niveau**
(`views/HomeView.vue`, même `class="pill"` et même icône à 18 px que le bouton liste du tiroir, pour
que les deux se ressemblent). Trois autres emplacements étaient sur la table et ont été écartés :

- **dans la colonne en bas à droite**, au-dessus du bouton « vue d'ensemble » : cette colonne ne
  porte que des commandes de **caméra** (rotation, zoom, cadrage) ; y glisser une préférence d'app
  aurait mélangé deux vocabulaires sur le même verre ;
- **au-dessus de la carte météo**, en bas à gauche : le voisinage soleil / lune / horloge se
  défendait (le mode « auto » suit justement le soleil), mais c'était un nouvel îlot flottant, et la
  place est déjà tenue par le message de chargement (`.home__loading`, à 144 px du bas) ;
- **dans `PageHeader` lui-même**, donc sur toutes les vues : plus proche du comportement du rail,
  mais l'utilisateur voulait le réglage **dans la vue 3D**.

Le réglage complet reste dans Réglages → Apparence (segmenté à quatre segments) : le bouton n'est
qu'un raccourci, et on ne perd rien à ne l'avoir que sur la vue Maison.

**Ce qui a été mesuré** (preview `kasbah-mock`, 1440 × 900 puis 900 × 800, thèmes clair et sombre) :

- **Rien ne bouge** : sur les quatre modes (`system → auto → light → dark`), la pilule garde
  `[992, 29, 52, 40]` et le segmenté des niveaux `[623, 26, 349, 46]`. Seule l'icône change, et
  `.pill` a une largeur imposée par son padding, pas par son contenu.
- **La hauteur de l'en-tête ne change pas à 1440 px** : 97 px avec et sans le bouton (le
  sous-titre du résumé y passait déjà sur deux lignes).
- **En dessous de ~950 px, le bouton coûte une ligne** : les 72 px qu'il prend (52 + le `gap: 20px`
  de `.page-header`) font passer le sous-titre de deux à trois lignes, soit 117 px d'en-tête au lieu
  de 97. Le resserrement est antérieur — `.page-header__sub` n'a ni `nowrap` ni ellipsis, contrairement
  à `.page-header__title`. Non corrigé ici : la règle vaut pour toutes les vues, et l'en-tête de la
  vue Maison flotte au-dessus de la scène, donc rien ne casse. À traiter si une vue en souffre.

Cette section remplace, sur l'emplacement du bouton, la description de la section **Rail** en tête de
page et celle de la mise à jour du 2026-09-16 (« le rail cycle sur quatre apparences ») : le cycle à
quatre pas et l'ordre des Réglages sont inchangés, seul le porteur du bouton a changé.

Sources : `apps/web/src/components/layout/NavRail.vue`, `apps/web/src/views/HomeView.vue`,
`apps/web/src/lib/navItems.ts`, `apps/web/src/components/layout/PageHeader.vue`,
`apps/web/src/stores/settings.ts`.

### Mise à jour 2026-09-22 (bis) — HomePanel : tuiles de synthèse seulement

Le panneau « maison » n'affiche plus, pour l'instant, que la grille de tuiles (`StatTile` via
`useHomeSummary`). Ambiances maison, ambiances fabricant (`SceneChips`) et liste des pièces /
zones (`RoomRows`) sont retirées — à réintroduire plus tard. Remplace, sur ce panneau, la
description en tête de page (« scènes », « liste des pièces »).

Sources : `apps/web/src/components/home/HomePanel.vue`.

### Mise à jour 2026-09-22 (ter) — « Réglages / Modifier » et forme d'enceinte

**Libellés unifiés** pour les deux cartes pliantes du panneau appareil (et les vues qui
réutilisent les mêmes clés) :

| Clé | FR | EN |
|-----|----|----|
| `place.title` / `vehicle.tuneTitle` | Réglages | Settings |
| `place.move` / `vehicle.tune` | Modifier | Edit |

Pied de carte : « Réglages » + bouton « Modifier » → ouvert « Terminé » (`place.done`).
`place.hint` ne parle plus seulement du glisser-déposer (niveau, hauteur, orientation, taille /
forme). Pas de rename de clés ni du composant `PlacementControl`.

**Forme d'enceinte** : ligne Segmented dans `PlacementControl` (comme les battants), écrite via
`setDeviceTuning` **sans** exiger le mode glisser 3D. Quatre valeurs (`SPEAKER_SHAPES`) :
défaut / galet / barre / bloc — affichées en **icônes** (`speakerTube` / `speakerPebble` /
`speakerBar` / `speakerBlock`) avec libellé en tooltip (`Segmented` `icon` + `title`), pour ne
pas déborder le panneau. Barre et bloc : ligne Orientation (`isOrientable`).

Sources : `PlacementControl.vue`, `VehicleTuning.vue`, `Segmented.vue`,
`lib/{orientation,strokeIcons}.ts`, `stores/house.ts`, `i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-29 — l'app sur un téléphone Android, en portrait et en paysage

Retour de l'utilisateur sur un téléphone Android (412 × 915 CSS) : des contrôles invisibles ou qui se
chevauchaient, un rail impossible à faire défiler, des boutons trop gros. En portrait, le résumé
de l'en-tête s'empilait mot par mot dans une colonne étroite et les onglets de niveau sortaient
de l'écran. En paysage (≈ 330 px de haut une fois la barre d'adresse retirée), les boutons de
caméra remontaient jusqu'à l'en-tête et Réglages restait hors d'atteinte sous le rail. Choix de
l'utilisateur : une barre en bas en portrait, un rail compact en paysage, la seule « vue
d'ensemble » au doigt, et une feuille qui monte du bas pour le panneau.

**Complète** la section « Grille » et la mise à jour « vue Maison immersive » (2026-09-15) : ces
règles valent toujours au-delà des deux seuils ci-dessous.

- **Deux seuils, des jetons** (`styles/tokens.css`) :
  - **Portrait**, `max-width: 599px` : `--rail-w: 0`, `--dock-h: 60px + safe-bottom` (hauteur de la
    barre du bas), `--page-x: 16px` (marge latérale des pages, 24 px ailleurs, utilisée par les
    zones qui défilent des 15 vues et par `PageHeader`) et `--wx-w: 108px`.
  - **Paysage bas**, `min-width: 600px and max-height: 500px` : `--rail-w: 60px`, `--wx-w: 108px`.
- **Coquille** (`App.vue`) : `.app-main` réserve `--dock-h` en bas. En portrait, elle remet
  `--safe-bottom` à 0 pour ses enfants, puisque c'est la barre qui porte l'encoche basse.
  `--dock-h` est calculé sur `:root` : le 0 posé plus bas ne le change pas.
- **Rail** (`layout/NavRail.vue`) : les boutons passent dans un conteneur `.rail__scroll`, et
  c'est lui qui défile. Le voile (`::before` du rail) reste ainsi plus large que la file sans être
  rogné par un `overflow`.
  - **Portrait** : barre horizontale en bas, boutons de 48 px, initiales masquées, Réglages en fin
    de file. Le voile monte du bas et un fondu apparaît aux deux bords.
  - **Paysage** : boutons de 44 px, défilement vertical avec fondu.
  - **Bureau** : les boutons se **tassent** avant de défiler (`flex: 0 1 auto`, `min-height: 28px`),
    comme avant la refonte, où ils rétrécissaient sans plancher. La première version les avait
    figés (`flex: none`) : sur un écran de 1140 px de haut, une fois la barre du navigateur
    retirée, le rail défilait au lieu de tenir. Mesuré dans la preview : 46 px à 960 de haut,
    30 px à 700, tout en vue. Sur téléphone, les boutons restent fixes (44 / 48 px).
  - Dans les deux cas, un changement de vue **fait défiler le rail seul** (`scrollTo`, jamais
    `scrollIntoView`, qui ferait aussi défiler la coquille) jusqu'au bouton actif.
- **En-tête** (`layout/PageHeader.vue`) :
  - Le résumé est un `MarqueeText` : une ligne, qui défile si elle déborde, **sur toutes les
    tailles**. Seul changement visible sur tablette : il ne passe plus à la ligne.
  - Le bloc des titres prend la place libre (`flex: 1 1 0; min-width: 120px`) ; l'ancien espaceur
    est retiré.
  - En portrait, l'en-tête passe à la ligne : le slot va sous le titre, en pleine largeur.
- **Vue Maison** (`views/HomeView.vue`) :
  - La vue déborde aussi sous la barre du bas (`height: calc(100% + var(--dock-h))`). Ce qui flotte
    en bas lit `--float-bottom`.
  - **Piège** : il faut `flex: none` sur `.home`. Sinon, la colonne flex de `.app-main` la
    rétrécit à 100 %, la 3D s'arrête au-dessus de la barre, et le panneau superposé s'y arrête
    aussi.
  - En portrait, les onglets de niveau passent en `fill` + `dense` et partagent leur ligne avec
    les deux pastilles.
  - **Boutons de caméra** : sous `pointer: coarse`, sur ces deux tailles, les deux grappes
    (rotation, zoom) sont masquées : au doigt, glisser tourne et pincer zoome. À la souris dans
    une fenêtre basse, elles passent en rangée.
  - `--ctl-span` donne la largeur occupée par ces boutons, que la recherche laisse libre.
- **Carte météo** (`home/WeatherWidget.vue`) : 72 px de haut, température et heure seules.
- **Panneau** (`layout/SidePanel.vue`) : en portrait, le tiroir devient une **feuille du bas**
  (64 dvh, coins hauts arrondis, glisse en `translateY`) qui passe au-dessus de la barre ; le voile
  la ferme. Pas de glissement vers le bas pour la fermer (non fait). En paysage, le tiroir à
  droite reste celui d'avant.
- **Musique** :
  - En portrait, `.body` passe sur une colonne et les lecteurs occupent 38 % de la hauteur, sous
    la zone centrale.
  - La recherche prend sa ligne ; « Avancée » et le filtre explicite passent dessous.
  - `MusicPlayerBar` empile le morceau, les touches (40 px), la position, puis le volume avec le
    lecteur. « Transférer » s'y réduit à son icône, le libellé restant lu par les lecteurs d'écran.
- **Piège des grilles implicites** : une grille sans `grid-template-columns` crée une piste
  `auto`, dont le minimum est le min-content de son contenu. Une valeur longue ou quatre libellés
  de segmenté élargissaient ainsi la carte au-delà du téléphone (Eau +15 px, Réglages +12 px).
  Correctif : `minmax(0, 1fr)` sur `.water__top`, `.block`, `.render`, `.render__side` et
  `.render__full`. Les segmentés `.w-100` des Réglages rétrécissent (`min-width: 0`, points de
  suspension). En portrait, leurs cases se dimensionnent au libellé (`flex: 1 1 auto`, 12 px) :
  plus aucune coupe mesurée en français.

**Vérifié dans la preview** `kasbah-mock` à 412 × 870 et 915 × 340 : aucune vue ne sort de
l'écran en portrait, à part la bande horaire de la Météo, qui défile exprès. Le rail paysage
défile jusqu'à Réglages. Les thèmes clair et sombre ont été vus, et le 1280 × 800 est sans
changement hormis le résumé.

**Non vérifiés** : le vrai téléphone, les zooms 1,25 / 1,5 et l'anglais.

**Restent à reprendre** : la ligne de compteurs d'Ouvrants (trois lignes en portrait) et Musique
en paysage (≈ 180 px utiles).

Sources : `apps/web/src/{App.vue,styles/tokens.css}`,
`apps/web/src/components/layout/{NavRail,PageHeader,SidePanel}.vue`,
`apps/web/src/components/home/WeatherWidget.vue`, `apps/web/src/views/{HomeView,MusicView,WaterView,SettingsView}.vue`,
`apps/web/src/components/music/MusicPlayerBar.vue`, commit 8310a1c.

### Mise à jour 2026-09-29 — palette Ctrl+K, la recherche depuis toutes les pages

**Ce que c'est** : `components/layout/SearchPalette.vue`, montée une fois dans `App.vue`,
téléportée dans `body`. Ctrl+K (Cmd+K) l'ouvre et la referme, écouté sur `window` **en phase de
capture** : il passe même quand un champ a le focus, et avant le navigateur (qui met sinon le focus
sur la barre d'adresse). Échap efface puis ferme, un clic sur le voile ferme, le focus revient à
l'élément qui l'avait.

**Même moteur, même règle** : `useSearch(query, { withHome: true })` — seule différence avec la
barre de la vue Maison, la page Maison y est une destination. Un résultat **navigue, n'agit
jamais** (V1 voulue ainsi par l'utilisateur ; des actions — allumer, rappeler une ambiance — sont
une V2 possible, pas une évidence).

**Ordre imposé pour un résultat de la maison** : `router.push({ name: 'home' })` **puis**
`hit.go()` — sinon le watcher de `HomeView` qui reflète la sélection dans l'URL la réécrit sur la
vue courante (même course que la sonnette, voir plus haut). Le panneau, lui, appartient à
`HomeView` (`panelOpen`, replié en fenêtre étroite) : la palette incrémente le signal
`homePanelRequest` exporté par `useSearch.ts`, que `HomeView` (gardée en vie) observe. Une page ne
l'incrémente pas.

**Rien ne bouge** : champ à hauteur fixe (12vh), liste vers le bas, 8 lignes puis défilement ;
position du champ mesurée identique de 0 à 20 résultats, aux zooms 1 / 1,25 / 1,5 et sur
téléphone (16 px de gouttière). Tablette : pas de bouton pour l'ouvrir au doigt, la barre de
l'accueil suffit (choix de l'utilisateur).

**Piège de test** : sous `stubs: { teleport: true }`, la valeur DOM d'un `v-model` ne se remet
pas à `''` dans jsdom alors que l'état l'est — `SearchPalette.test.ts` vérifie donc l'effet
(la liste disparaît, la palette reste ouverte), pas `input.element.value`.

**Écarts relevés par la revue, corrigés le même jour** : sur téléphone (< 600 px) la marge
intérieure passe de 16 à 12 px — le texte indicatif français (283 px) tenait dans 281 px, il en a
289. Le sous-libellé de la ligne active (`--muted` sur la teinte d'accent) tombait à 4,07:1 en
thème Kasbah clair : il prend un quart de `--text` (`color-mix(in srgb, var(--muted) 75%,
var(--text))`), dans la palette ET dans `SearchBar.vue`, soit 5,64:1 en clair et 5,93:1 en sombre.
Les autres thèmes ne passent pas tous (night-owl, tokyo-night clair, dracula sombre) : leur
`--muted` échoue déjà sur les lignes au repos, et tokyo-night clair met même le libellé principal
à 3,86:1 — c'est un chantier de thèmes, pas de la recherche.

Sources : `apps/web/src/components/layout/SearchPalette.{vue,test.ts}`,
`apps/web/src/composables/useSearch.ts`, `apps/web/src/views/HomeView.vue`, `apps/web/src/App.vue`.

### Mise à jour 2026-10-02 — alertes sur le rail : une pastille, et le « vu » propre au poste

Une vue qui a une alerte en attente porte une **pastille** sur le coin de l'icône du rail : 9 px,
`position: absolute` (hors du flux : rien ne bouge quand elle paraît ou part), liseré de 2 px de
`--bg` qui la détache du trait de l'icône. Sa couleur dit la gravité la plus haute de la vue :
`info` accent, `problem` `--v-theme-warning`, `critical` `--v-theme-error`. `aria-label` du bouton :
« {vue} · alerte en cours » (`alerts.pending`). Pas de compteur : un point suffit (`NavRail.vue`).

**D'où viennent les alertes.** `stores/alerts.ts` les tire de l'état, par `deviceAlerts` (partagé,
voir `../1_architecture/1_1_contrat-appareils.md`), et les range par vue selon le kind :
vehicle → `vehicles`, mower et vacuum → `robots`, weather → `weather`. Les autres kinds n'en
produisent pas.

**Le « vu » est PAR POSTE**, dans `localStorage` (`kasbah.alerts.dismissed`, id → appareil), pas sur
le serveur. Kasbah n'a pas de comptes : l'identité, c'est le poste. Fermer une alerte sur une tablette
ne masque donc rien sur le téléphone. Limite assumée : une tablette partagée est un seul
« utilisateur ».

**Trois gravités, trois règles de fermeture.**
- `info` (mise à jour logicielle d'un véhicule) : vue en OUVRANT la vue. `NavRail` a un
  `watchEffect` qui appelle `markViewSeen(vue courante)`, donc aussi pour une alerte qui arrive
  pendant qu'on regarde la page.
- `problem` (robot en panne, vigilance orange) : tenue jusqu'à un geste explicite ou jusqu'à la
  résolution. Ouvrir la vue ne suffit pas.
- `critical` (vigilance rouge) : jamais fermable (`dismiss` l'ignore, `pending` la garde), elle
  part avec sa cause.

**Fermer, explicitement.**
- Robots : un lien « Masquer » / « Dismiss » (16 px) au bout de la ligne d'état de la carte
  (`RobotsView.vue`). `rcard__status` passe de `<p>` à une ligne flex : texte (`rcard__status-text`,
  qui garde l'ellipse) + bouton ; la hauteur de 16 px est tenue même vide.
- Météo : une croix de 24 px à côté de la pastille de vigilance (`wx-alert-row`), seulement quand la
  page montre la MAISON (pas un autre lieu).
- Survol et `aria-label` : `alerts.dismissHint`, « Ne plus la signaler sur le rail ».
- Écarté : le libellé « Masquer l'alerte » rognait l'erreur du robot à 375 px (200 px visibles sur
  224). Sur la page Météo, « Masquer » en texte rognait la vigilance elle-même : d'où la croix.
  Reste connu : en anglais à 375 px, la pastille de vigilance est rognée de 18 px quand la croix est
  là.

**Nettoyage du stockage.** On ne garde que les ids encore actifs, mais un id n'est oublié que sur une
lecture qui dit que c'est fini. Appareil injoignable ou état pas encore reçu (démarrage) = `null` =
on garde ; appareil disparu de la liste (une fois la liste connue) = oublié ; liste d'alertes lue et
sans cet id = oublié. Conséquence assumée : la même panne qui revient après résolution est une
NOUVELLE alerte. Pas de bouton « réafficher » dans les Réglages.

Vérifié dans la preview `kasbah-mock` : 1440 × 900 et 375 × 812, fr et en, rien ne bouge
(`getBoundingClientRect`), pastille en clair et en sombre. **Non joué** : zooms 1,25 / 1,5, thème
sombre de la page Météo, captures (elles expiraient).

Sources : `apps/web/src/stores/alerts.ts` (+ test), `apps/web/src/components/layout/NavRail.vue`,
`apps/web/src/views/RobotsView.vue`, `apps/web/src/views/WeatherView.vue`,
`apps/web/src/i18n/locales/{fr,en}.json` (`alerts.*`).

Un seul geste ferme TOUTES les alertes fermables d'un appareil (`closableFor`) : deux vigilances
orange simultanées sur la maison partent d'un clic sur la croix, comme les alertes d'un robot avec
« Masquer ».

### Mise à jour 2026-10-07 — « Demander à Kasbah » dans la palette et la barre, l'assistant dans Réglages

Le cœur et le moteur : `../1_architecture/1_9_assistant.md`, `../3_plugins/3_24_claude.md`.

**La ligne de l'assistant.** La palette Ctrl+K (`components/layout/SearchPalette.vue`) et la barre de
la vue Maison (`components/home/SearchBar.vue`) ajoutent une **dernière ligne** à leurs résultats,
dès le deuxième caractère : « Demander à Kasbah » (icône `sparkle` en accent), la saisie à droite
(classe `…__row--ask`). Elle se navigue au clavier comme les autres ; quand rien ne correspond (une
instruction ne ressemble à aucun nom), c'est elle qui est active, et Entrée l'envoie. La règle de la
recherche tient : **un résultat navigue, il n'agit jamais** — seule cette ligne, à part, agit.

**La réponse prend la place de la liste** (`AssistantReply.vue`) : l'instruction en gris, une ligne
par outil appelé (« Commande · Spots cuisine ✓ », état en place réservée par `PulseDot`), puis la
phrase de l'assistant ou l'erreur dite en clair. Pendant l'appel, le champ est en lecture seule.

- **Palette** : sous le champ, comme la liste (60vh au plus, défile). Fermer la palette **n'arrête
  pas** l'instruction ; la rouvrir remet l'instruction dans le champ et montre la réponse. Échap :
  efface (ou abandonne) la réponse, puis la saisie, puis ferme.
- **Barre de la vue Maison** : au-dessus du champ, du même verre que la liste, et elle **reste sans
  le focus** (sur téléphone, le clavier se ferme à l'envoi) jusqu'à la croix ou Échap.
- **Retoucher l'instruction** après la réponse revient à la recherche. Revenir au champ **sélectionne**
  l'instruction : la frappe la remplace (vu en vérification : sans cela, un toucher insérait le texte
  au milieu de l'ancienne instruction, et Claude a reçu le mélange des deux).
- **Téléphone** : le champ de la vue Maison ne fait que 159 px entre la météo et les boutons ; la
  réponse prend la largeur de l'écran à 16 px des bords (`left`/`right` calculés depuis la boîte du
  champ, sous 600 px, recalculés au redimensionnement). Elle recouvre le haut de la carte météo.
- **Rien ne bouge** : champ mesuré au `getBoundingClientRect` avant et après une instruction, identique
  (1 280 et 375 px).

**Réglages.** Section « Assistant » (`components/settings/AssistantCard.vue`), après « Comptes » :
l'explication, puis le **journal** des 200 dernières instructions de tous les comptes (date · compte ·
durée, puis le même rendu que la palette), bouton Actualiser, liste qui défile dans la carte (480 px).
Réseau local seulement : connecté par l'adresse publique, la carte ne le demande pas (le serveur le
refuserait). Le jeton du forfait se règle dans **Réglages → Plugins → claude** (`ClaudeLinkCard.vue`).

Vérifié dans le navigateur sur un serveur jetable : instructions réelles depuis la barre (7,1 s) et
depuis la palette sur la page Réglages (6,1 s) ; clair et sombre, fr et en, 375 px, zooms 1 / 1,25 /
1,5 sans débordement ; console sans erreur.

### Mise à jour 2026-10-07 (soir) — le micro de la recherche

Quand le plugin `transcription` tourne, un micro (icône `mic`, nouvelle dans `lib/strokeIcons.ts`)
se pose au bout du champ de la palette et de la barre de la vue Maison : appuyer pour parler,
appuyer pour finir, le texte entendu part à l'assistant. **Barre** : micro et croix se partagent une
seule place toujours réservée (le micro quand le champ est vide ou pendant l'écoute, la croix dès
qu'il y a du texte ou une réponse) — côte à côte, ils ne laissaient que 31 px de saisie sur
téléphone ; mesuré : saisie de 71 px à 375 px, place fixe à x = 260, champ inchangé (159 × 44).
Pendant l'écoute : bouton rouge (arrêt), « J'écoute… » ; pendant la transcription : micro qui
pulse. Détails : `../3_plugins/3_25_transcription.md`.

### Mise à jour 2026-10-10 (6) — vue Maison sur téléphone : recherche pleine largeur, feuille à glisser, réponse refermable

Retours de l'utilisateur sur un vrai téléphone (portrait, < 600 px). Rien ne change au-delà.

- **Bas de la vue Maison** (`HomeView.vue`) : entre la météo et la vue d'ensemble, la recherche
  n'avait que 160 px. Elle prend désormais **toute la largeur** au ras de la barre du bas (343 px à
  375 px de large). La météo devient une **pastille** de la hauteur des boutons (icône, température,
  heure ; `WeatherWidget.vue`) et monte, avec la vue d'ensemble, sur une rangée **sous les onglets de
  niveau** (`.home__toprow`, rendue par `phone`). Choix de l'utilisateur, en deux temps : la rangée
  était d'abord au-dessus du champ ; il l'a voulue en haut pour que la liste et la réponse s'ouvrent
  **juste au-dessus du champ**, sans couper la météo (la réponse masquait le haut de la carte). Le
  calcul en JS qui élargissait la réponse à l'écran (`placeReply`) a disparu avec. À la souris dans
  une fenêtre étroite, les grappes rotation / zoom restent en bas à droite, au-dessus du champ.
- **Feuille du bas** (`SidePanel.vue`, panneau superposé en portrait) : une **poignée** (bande de
  28 px sur la marge haute du contenu, barrette de 40 × 4 px) se glisse vers le bas. Lâchée après un
  quart de la hauteur, ou lancée (> 0,5 px/ms et > 16 px), la feuille descend et se ferme ; sinon elle
  remonte. Seule la poignée se glisse : le contenu défile comme avant. Piège évité : la fermeture
  attend que le style « partie » (`translateY(100%)`) soit posé (`nextTick`), sinon le style en ligne
  du glissement écraserait la transition de sortie de Vue.
- **Réponse de l'assistant** (`AssistantReply.vue`) : une **croix** en haut à droite (`closable`, dans
  la hauteur de la ligne de l'instruction) la ferme comme Échap ; « **Réécouter** » en pastille
  libellée en bas à droite de la réponse (l'icône seule était ambiguë), voir
  `../3_plugins/3_25_transcription.md`. Fermer la réponse (croix, Échap) l'arrête si elle est dite et
  **efface l'instruction du champ**, dans la barre comme dans la palette — Échap ramenait jusque-là la
  liste de résultats sur l'instruction.
- **Clavier virtuel** : toucher le micro rend le focus du champ (`blur`) ; dans la palette, le focus
  ne revient au champ qu'à la souris (`pointer: coarse` sinon). Hypothèse : le champ gardait le focus
  et redevenait éditable à la fin de la transcription. Non reproduit sur un vrai téléphone.

Vérifié dans la preview (`kasbah-mock`) à 375 × 812 (géométrie : rangée sous l'en-tête, champ
16 → 359 px, réponse au-dessus du champ, glisser ferme et un petit glissement revient) et à
1 280 × 800 (inchangé). Non joué : thème clair (la barrette dérive de `--text`). Piège de preview :
redimensionner sans recharger peut laisser la disposition téléphone (le `change` du media query
n'arrive pas pendant que le panneau est masqué) ; après rechargement, c'est juste.

Tests : `SearchBar.test.ts` (+2 : Échap et la croix effacent l'instruction), `SearchPalette.test.ts`
(Échap sur une réponse vide le champ, la palette reste ouverte).

### Mise à jour 2026-10-10 (7) — barre de navigation du bas : plus haute, et la suite qui se voit

Retours de l'utilisateur sur un vrai téléphone (portrait).

- **Hauteur** : `--dock-h` passe de 60 à **72 px** (+ encoche), boutons de 48 à **52 px**, posés
  **14 px au-dessus du bord** même sans encoche déclarée (`tokens.css`, `NavRail.vue`). Le doigt posé
  trop bas tombait dans la zone des gestes du système, qui prenait un glissement de côté pour un
  changement d'app (ce n'était pas l'app). Tout ce qui flotte en bas de la vue Maison suit
  (`--float-bottom` lit `--dock-h`).
- **La suite de la file** : le fondu fixe de 12 px aux deux bouts ne disait pas qu'on pouvait faire
  défiler. Désormais seul le côté qui a une suite se fond (44 px, `data-more-start` / `data-more-end`
  posés par `measure()` au défilement et au redimensionnement), et un **chevron en pastille** s'y pose,
  qui fait défiler de 70 % de la largeur. Il est hors de la file (et de son masque), centré dans la même
  bande que les boutons. Éteint, il est `inert` (et non `aria-hidden` : Chrome refusait un
  `aria-hidden` sur le chevron touché qui gardait le focus en s'éteignant au bout de la file) ; il ne
  prend pas le focus au doigt (`mousedown.prevent`) et, au clavier, passe le focus à l'autre chevron.
  Le rail vertical (bureau, paysage) n'a pas de chevron.
- Écarté pour l'instant : régler l'espacement pour qu'un bouton soit toujours coupé à moitié au bord
  (signal classique de défilement, mais espacement dépendant de la largeur d'écran).

Vérifié dans la preview à 375 × 812 : boutons 52 px à 14 px du bord, chevron de droite seul au début,
les deux au milieu, celui de gauche seul à la fin, centres alignés à 769 px. Non joué : thème clair.

**Au passage** : les raccourcis clavier globaux (Ctrl+K de la palette, annuler / rétablir de
`EditBar.vue` et `ReliefPanel.vue`) ignorent les `keydown` sans `key` — le remplissage automatique de
Chrome en émet (`key` `undefined` malgré le type), et `e.key.toLowerCase()` levait une erreur. Test :
`SearchPalette.test.ts` (rouge sans la garde).

### Mise à jour 2026-10-11 (8) — réponse de l'assistant : en-tête fixe, fondu, champ vide après la voix

**Retour de l'utilisateur** (téléphone, une instruction qui a commandé sept volets) : toute la réponse
défilait, l'instruction et sa croix partaient avec ; rien ne disait qu'il restait à faire défiler ; et
après une commande vocale, le texte et la croix restaient dans le champ, à effacer avant la suivante.

- **En-tête fixe** (`AssistantReply.vue`) : la réponse est une colonne ; l'instruction et la croix
  (`.reply__asked`) restent, seul `.reply__body` (outils, réponse, « Réécouter », erreur) défile. Les
  appelants bornent la hauteur (`max-height`, barre `min(50vh, 360px)`, palette `60vh`) en
  `overflow: hidden` et ne font plus défiler eux-mêmes. Le corps a 4 px de marge rendus par une marge
  négative : « Réécouter » (décalé de -4 px) n'y crée pas de défilement horizontal.
- **Fondu du côté qui a une suite**, comme les genres Mixcloud et la barre du bas : 24 px, `data-fade-start`
  / `data-fade-end` posés par `measure()` au défilement, au redimensionnement (`ResizeObserver`) et à
  chaque ligne ou texte qui arrive.
- **La vue suit la fin** tant que la réponse arrive (elle s'écrit en bas), sauf si l'on est remonté
  (à plus de 4 px du bas). Ajout non demandé : sans lui, la réponse finale naissait sous le fondu.
- **Champ vide après la voix** (barre et palette) : le texte dicté part à l'assistant sans passer par
  le champ ; l'instruction se lit en tête de la réponse. Dans la barre, la place du bout du champ
  revient au **micro dès que le champ est vide** (avant : seulement sans réponse), la réponse gardant
  sa propre croix : un toucher du micro efface la réponse et rouvre l'écoute. Une instruction **tapée**
  reste dans le champ (on la retouche).

Vérifié dans la preview (`kasbah-mock`, réponse fabriquée par l'état du composant) : en-tête au même
pixel en haut, au milieu et en bas du défilement ; fondu bas seul en haut, les deux au milieu, haut seul
en bas ; croix dans le cadre et aucun débordement à 375, 300 et 250 px (zooms 1 / 1,25 / 1,5) et à
1 280 px ; palette capturée sur la page Lumières. Non joué : thème clair (le masque ne dépend pas des
couleurs). Test : `SearchBar.voice.test.ts` (rouge si le champ reprend le texte dicté).

### Mise à jour 2026-10-12 (bis) — les tuiles du panneau maison mènent à leur vue

« Si je clique la carte "volets ouverts", je vais sur la vue Ouvrants ; la carte d'une voiture, sur la
vue Véhicules. » L'utilisateur revient sur le choix du 2026-09-15 (tuiles **décoratives**, plus haut) :
chaque tuile du `HomePanel` est désormais un lien vers la vue qui en donne le détail.

| Tuile | Vue (nom de route) |
|---|---|
| lumières allumées | `lights` |
| volets ouverts, stores baissés | `covers` |
| caméras | `cameras` |
| lecteurs | `media` |
| solaire, batterie | `energy` |
| chaque voiture | `vehicles` |

- **Un `router-link` autour de `StatTile`**, pas un `@click` : clavier et focus viennent avec
  (`:focus-visible` en contour accent). `StatTile` ne change pas — `HomePanel` est son seul
  utilisateur, et la tuile reste la même boîte.
- **Rien ne bouge au survol** : seul le fond passe en `--accent-soft`, ni bordure ni ombre ajoutée.
  Le lien hérite de la couleur (`color: inherit`, sans soulignement).
- **Une voiture ouvre la vue Véhicules, sans désigner laquelle** : la vue ne reçoit pas (encore) de
  véhicule en paramètre.
- Les six vues visées existent toujours au rail (aucune n'est conditionnée à un plugin), donc pas de
  lien mort.

Vérifié en mode simulé (1440 × 900, clair et sombre) : les neuf tuiles gardent 84 px de haut,
« volets ouverts » ouvre `/covers`, une voiture ouvre `/vehicles`, aucune erreur console. L'effet de
survol n'a pas été vu (capture figée sur la scène 3D).

Sources : `apps/web/src/components/home/HomePanel.vue`.

### Règle 2026-10-15 — un contrôle partagé entre le panneau et une vue a un rendu par contexte

Posée par l'utilisateur quand les boutons du panneau de la borne ont été repris tels quels sur sa
ligne de la vue Énergie : « quand on partage des composants entre le panel de la vue 3D et les cartes
des vues spé, on ne peut généralement pas adopter le même design/layout ». Un composant partagé entre
le panneau de l'appareil (`controls/*`, via `DeviceControl`) et les cartes de pièce d'une vue
(`RoomBands`) partage la logique et les commandes, et prend un **mode de rendu** par contexte : grands
boutons dans le panneau, touches de ligne dans la carte (36 px, coins arrondis, rangée à part — le
vocabulaire de `HeatingControl` et des vues Ouvrants et Médias). Premier cas :
`controls/EvChargerCommands.vue` (`variant` `panel` / `row`), détaillé dans
`4_4_vues-energie-vehicules.md`.
