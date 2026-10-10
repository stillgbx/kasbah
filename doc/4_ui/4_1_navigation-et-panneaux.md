# Navigation et panneaux

> Dernière mise à jour : 2026-10-10
> Sources : `apps/web/src/App.vue`, `apps/web/src/components/layout/*.vue`, `apps/web/src/views/*.vue`, `apps/web/src/components/home/*.vue`, `apps/web/src/components/controls/*.vue`, `apps/web/src/views/LightsView.vue`, `apps/web/src/components/home/PlacementControl.vue`, `apps/web/src/components/scenes/SceneChips.vue`, `apps/web/src/components/devices/RoomBands.vue`, `apps/web/src/components/devices/RoomLightsToggle.vue`, `apps/web/src/views/CoversView.vue`, `apps/web/src/components/covers/CoverPill.vue`, `apps/web/src/lib/{cover,deviceState}.ts`, `apps/web/src/composables/useHomeSummary.ts`, `apps/web/src/components/devices/ForgetDeviceButton.vue`, `apps/web/src/components/controls/MediaPlayerControl.vue`, `apps/web/src/lib/audioRouting.ts`, `apps/web/src/components/energy/EnergyFlow.vue`, `apps/web/src/components/EnphasePairingCard.vue`, `apps/web/src/lib/energy.ts`, `apps/web/src/components/devices/RoomBrightness.vue`, `apps/web/src/components/devices/CoversMaster.vue`, `apps/web/src/components/devices/LightsMaster.vue`, `apps/web/src/composables/useRoomLights.ts`, `apps/web/src/components/home/PanelArraysCard.vue`, `apps/web/src/components/energy/InverterFields.vue`, `apps/web/src/components/TeslaLinkCard.vue`, `apps/web/src/views/VehiclesView.vue`, `apps/web/src/components/vehicles/VehicleMap.vue`, `apps/web/src/components/vehicles/VehicleTuning.vue`, `apps/web/src/lib/vehicleTuning.ts`, `apps/web/src/lib/map.ts`, `apps/web/src/components/controls/VehicleCard.vue`, `apps/web/src/components/vehicles/ChargeLimitCard.vue`, `apps/web/src/components/home/DevicePanel.vue`, `apps/web/src/components/settings/PluginSection.vue`, `apps/web/src/views/SettingsView.vue`, `apps/web/src/components/ui/Segmented.vue`, `apps/web/src/components/home/SearchBar.vue`, `apps/web/src/composables/useSearch.ts`, `apps/web/src/components/layout/SearchPalette.vue`, `apps/web/src/lib/search.ts`, `apps/web/src/lib/navItems.ts`, `apps/web/src/views/HeatingView.vue`, `apps/web/src/components/heating/*.vue`, `apps/web/src/components/MelcloudLinkCard.vue`, `apps/web/src/components/home/OpeningPanel.vue`, `apps/web/src/components/home/RoomEditPanel.vue`, `apps/web/src/components/home/ParkingPanel.vue`, `apps/web/src/lib/deviceIcons.ts`, `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/{MusicPlayerBar,ListeningSessions,MusicItemRow,MusicTile,ChipRow}.vue`, `apps/web/src/stores/localPlayer.ts`, `apps/web/src/components/music/MixcloudBrowser.vue`, `apps/web/src/components/MixcloudLinkCard.vue`, `apps/web/src/views/SettingsView.vue`, `apps/web/src/views/{AutomationsView,AutomationEditView}.vue`, `apps/web/src/components/automations/*.vue`, `apps/web/src/components/layout/NavRail.vue` (`meta.nav`), `apps/web/src/components/controls/LightHistoryChart.vue`, `apps/web/src/components/weather/WeatherPlaces.vue`, `apps/web/src/composables/useMusicSession.ts`, `apps/web/src/lib/streamQuality.ts`, `apps/web/src/components/home/ReliefPanel.vue`, `apps/web/src/lib/ignRelief.ts`, `apps/web/src/lib/moon.ts`, `apps/web/src/components/vehicles/VehicleSoftware.vue`, `apps/web/src/components/layout/AssistantReply.vue`, `apps/web/src/components/settings/AssistantCard.vue`, `apps/web/src/components/ClaudeLinkCard.vue`, `apps/web/src/composables/useVoiceInput.ts`, `apps/web/src/stores/properties.ts`, `apps/web/src/components/layout/PropertyList.vue`, `apps/web/src/components/home/{HouseEditPanel,RoomShapeSection}.vue`, `apps/web/src/components/property/*.vue`, `apps/web/src/lib/onboarding.ts`

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

## Vue Énergie (`views/EnergyView.vue`)

Tuiles Solaire, Réseau (soutirage/injection), Batterie (charge/décharge), Borne autour de l'anneau
« Maison » (consommation, % d'autoconsommation = part de la production non injectée). Graphique
6 h → 20 h de la production horaire (historique serveur, rafraîchi chaque minute ; barres passées
sur l'accent, futures sur `--line`).

*(Dépassé le 2026-09-11 : la vue Énergie se compose aujourd'hui d'`EnergyFlow` (schéma de flux, `components/energy/EnergyFlow.vue`), d'`InverterFields` (un onduleur à sa place, `components/energy/InverterFields.vue`) et de `RoomBands` (`components/devices/RoomBands.vue`) — voir « Mise à jour 2026-09-11 — vue Énergie : appareils, schéma de flux, et carte d'appairage Enphase » et « Mise à jour 2026-09-13 — la vue Énergie montre chaque onduleur, à sa place ».)*

## Vue Véhicules (`views/VehiclesView.vue`)

Une carte par véhicule : charge (grande valeur + barre), autonomie, état (verrouillé), charge
(puissance / branché), position (« À la maison » si < 120 m de l'origine, sinon distance),
emplacement de carte, actions verrouiller / charger.

*(Dépassé le 2026-10-02 : chaque véhicule a une carte pleine largeur à disposition adaptative, avec six boutons en tuiles identiques (Verrouiller, Charge, Réveiller, Actualiser, Climatisation, Modifier) — voir « Mise à jour 2026-10-01 — vue Véhicules : le panneau Climatisation » (ajout 2026-10-01 (bis)) et « Mise à jour 2026-10-02 — vue Véhicules : cartes horizontales, panneaux par-dessus la carte ».)*

## Vue Réglages (`views/SettingsView.vue`)

Colonne gauche : apparence (segmenté), langue (segmenté : automatique, français, english), couleur
d'accent (4 pastilles), origine GPS (+ compte niveaux/pièces/appareils), plein écran. Colonne droite :
plugins (nom, **noms des clés `.env`**, pastille de statut, nombre d'appareils) et carte d'appairage
Hue quand nécessaire.

*(Dépassé le 2026-09-12 puis le 2026-09-16 : les quatre pastilles d'accent sont une grille de thèmes (« Mise à jour 2026-09-12 — les quatre pastilles d'accent deviennent une grille de thèmes ») et la page ne se lit plus en deux colonnes mais en trois zones, les Plugins en pleine largeur à la fin (« Mise à jour 2026-09-16 — la vue Réglages en trois zones, les Ambiances rendues à leur plugin »).)*

## Suppressions par rapport à la première version

La vue « liste des appareils », le sélecteur de niveaux vertical, les puces de pièces en bas de scène
et la feuille basse d'appareil ont été remplacés par le panneau latéral et les onglets, conformément
à la maquette.

### Mise à jour 2026-09-05 — vue Lumières (5e entrée du rail)

Le rail compte 5 vues : Maison / **Lumières** / Énergie / Véhicules / Réglages.

`views/LightsView.vue` liste **toutes** les lampes remontées par les plugins, groupées par pièce
(pièces de la maison d'abord, dans l'ordre des niveaux, puis pièces de plugin sans équivalent, puis
« Sans pièce »). Chaque ligne : icône teintée si allumée, nom (descripteur), libellé d'état
(`statusLabel`), **pastille de liaison** et interrupteur ; un curseur de gradation apparaît sous la
ligne quand la lampe est allumée et sait varier (envoi au `@end`, valeur locale pendant le
glissement, la limitation de débit serveur supplantant les commandes intermédiaires).

Les trois pastilles sont le diagnostic de synchronisation JSON ↔ plugin :
- **Placée** — position définie dans `house.json` ;
- **Auto** — rattachée automatiquement à la pièce de même nom (`autoPlaceDevices`) ;
- **Non placée** — aucune pièce ne porte le nom de sa pièce de plugin : absente de la scène 3D.

Une dernière carte, **Liaisons mortes**, liste les appareils du JSON dont le `deviceId` n'est remonté
par aucun plugin (typiquement les `mock:*` quand le plugin `mock` est coupé).

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

### Mise à jour 2026-09-08 — vue Lumières en bandes par niveau, ordre des pièces réordonnable

Note sur les **onglets de niveau** de l'en-tête : ils gardent l'ordre montant (`Jardin`, `RDC`,
étages, `Tout`) alors que toutes les listes de l'app descendent (`levelsSorted`). Décision de
l'utilisateur, prise en voyant le résultat : une rangée horizontale se lit comme une coupe du
bâtiment, et l'onglet d'un niveau ne doit pas se déplacer parce qu'un étage s'ajoute au-dessus.

Les cartes de pièces coulaient dans une seule grille `auto-fill` triée par (niveau, ordre du JSON) :
visuellement les niveaux se mélangeaient sur une même ligne, et l'ordre interne était celui,
arbitraire, du tableau `rooms`.

La vue est maintenant découpée en **bandes**, une par niveau dans l'ordre `levelsSorted` (du haut vers
le bas) : chaque bande a son titre (nom du niveau) et **sa propre grille**, donc un niveau repart
toujours à la ligne. Suit une bande **« Hors maison »** (pièces de plugin sans équivalent dans le
JSON, puis « Sans pièce »), et la carte **« Liaisons mortes »** reste en dernier. Le sous-titre de
carte qui rappelait le niveau a disparu : le titre de bande le dit déjà.

L'ordre des pièces d'une bande vient de `roomsByLevel` — `level.roomOrder` puis alphabétique (voir
`../2_maison/2_0_format-house-json.md`) — et se règle **ici**, par glisser-déposer :

- le geste part d'une **poignée** (icône `grip`), jamais de la carte entière : les cartes portent des
  interrupteurs et des curseurs qu'on manipule au doigt, et un geste d'appoint ne doit pas réécrire
  `house.json`. Même raisonnement que le mode « Déplacer » par appareil ci-dessus ;
- la liste se réorganise **sous le doigt** (pas de fantôme flottant : la carte déplacée porte un
  contour d'accent) ; l'insertion se calcule sur les rangs de départ, donc pas d'oscillation quand on
  descend ;
- l'écriture part au **relâchement**, et seulement si l'ordre a changé (`PUT
  /api/house/levels/:id/room-order`) ; les écrans voisins reçoivent la maison réécrite ;
- la poignée n'apparaît pas sur les cartes hors maison (elles n'ont pas de pièce à ordonner) ni quand
  la bande n'a qu'une carte.

Piège rencontré (capture de pointeur perdue quand Vue déplace la poignée) : voir
`../6_faq/6_1_pieges-runtime.md`.

Libellés : `lights.reorder`, `lights.orderError` (fr/en).

### Mise à jour 2026-09-08 — vue « Ouvrants » (6e entrée du rail) et composant `RoomBands` partagé

Le rail compte 6 vues : Maison / Lumières / **Ouvrants** / Énergie / Véhicules / Réglages.

**Le nom.** « Ouvrants » est le terme du bâtiment qui englobe volets, stores, portails, fenêtres et
portes de garage — soit tout le kind `cover`. Choisi par l'utilisateur contre deux autres :
« Fermetures » (le vocabulaire de Somfy, mais un portail ouvert n'est pas une fermeture) et
« Volets » (le plus lisible, mais l'étiquette exclurait littéralement les stores et le portail qui
figurent dans la liste). En anglais : « Covers », comme le kind. Un nom qui ne devient pas faux
quand un appareil d'un autre type arrive.

**Le partage, demandé explicitement pour éviter la duplication.** Les deux listes ne diffèrent que
par le contrôle d'une ligne. `components/devices/RoomBands.vue` porte donc tout le commun :

- groupement par pièce, bandes par niveau, ordre des pièces (`roomsByLevel`) ;
- la **poignée** de réordonnancement et son écriture (`PUT /api/house/levels/:id/room-order`) ;
- la pastille de liaison au JSON et la carte « Liaisons mortes », filtrées sur le `kind` reçu en prop ;
- le rendu d'une ligne : icône teintée (`deviceIcon` + `isDeviceOn`, déjà génériques), nom, `statusLabel`.

Chaque vue ne fournit que son contrôle, via un **slot `control`** qui reçoit l'entrée du registre.
`LightsView.vue` passe ainsi de 241 à 56 lignes, `CoversView.vue` en fait 85. Une correction sur la
liste profite désormais aux deux vues — c'était l'argument de l'utilisateur contre un simple
copier-coller, et le réordonnancement fonctionne de fait depuis les deux.

Détail utile : le contenu d'un slot est compilé dans la portée du **parent**, donc le CSS scopé de
chaque vue habille son propre contrôle, et les éléments du slot deviennent des enfants de la grille
`.row`. C'est ce qui permet à la vue Ouvrants de poser ses boutons et son curseur sur une deuxième
ligne pleine largeur (`grid-column: 1 / -1`) : trois boutons dans la 4e colonne écrasaient le nom de
l'ouvrant sur trois lignes.

**Contrôles conditionnés aux capacités**, parce que le parc est hétérogène (voir
`../3_plugins/3_4_somfy-tahoma.md`) : Ouvrir et Fermer toujours, **Stop** seulement si `stop` est
déclarée, **curseur de position** seulement si `position` l'est. Un volet en radio unidirectionnelle
n'a donc que deux boutons : lui montrer un curseur promettrait une commande que le serveur
refuserait en 400.

**Libellés neutres en genre.** La même pastille sert maintenant à *une lampe* et à *un ouvrant* :
« Placée » / « Non placée » devenaient faux. Elles décrivent désormais la conséquence —
**« Dans le plan »** / **« Hors plan »** — et les infobulles, déjà neutres, sont inchangées.
L'anglais garde « Placed » / « Unplaced ».

Limite connue, **antérieure** à cette vue : à 375 px de large, les cartes des deux listes débordent
(la grille `minmax(340px, 1fr)` ne tient pas dans 375 px moins les 72 px du rail) — interrupteur,
pastille et curseur sont coupés. Vérifié identique sur la vue Lumières avant le changement.

### Mise à jour 2026-09-08 — contrôles d'ouvrant : fermeture affichée, cible montrée, rien qui bouge

**Le pourcentage affiché est une FERMETURE** : 0 % = ouvert, 100 % = fermé. Demandé par
l'utilisateur (« c'est plus intuitif »), et c'est aussi la convention du fabricant
(`core:ClosureState` chez Overkiz). Le contrat, lui, garde une OUVERTURE — l'inversion est confinée
à `lib/cover.ts` (`toClosure` / `fromClosure`) et n'existe que dans la couche d'affichage, parce que
`position` sert par ailleurs à `isDeviceOn`, au comptage « volets ouverts » du résumé, aux marqueurs
3D et à tous les plugins. Voir `../1_architecture/1_4_app-web.md`.

**Les contrôles montrent l'INTENTION, le texte montre l'ÉTAT.** Curseur, grande valeur du panneau et
interrupteur suivent la position visée dès le geste ; le libellé de statut continue de dire où
l'ouvrant se trouve vraiment, et annonce le mouvement quand il y en a un (« Fermeture en cours »
plutôt qu'un « Ouvert » qu'il est en train de quitter). Un ouvrant qui s'arrête ailleurs qu'à la
cible fait revenir les contrôles à la réalité, tout seuls.

Conséquence à connaître : sur une box qui ne publie sa position qu'en fin de course, la position
affichée reste figée pendant tout le trajet puis saute à la valeur finale. C'est le matériel, et
c'est représenté tel quel plutôt qu'interpolé.

`CoverControl.vue` (panneau appareil) tient sur quatre éléments, sans rien qui se décale :

- **Ouvrir / Stop / Fermer**, conditionnés aux capacités (`open_close`, `stop`) — trois boutons à
  `min-width: 0` et 40 px de haut : à largeur minimale par défaut ils débordaient des 340 px du
  panneau ;
- **une seule ligne** `[point | texte | %]` de hauteur constante — le point garde sa place même
  éteint, le texte est le mouvement puis « Ouvert » / « Fermé » / « Fermeture », le pourcentage est
  collé à droite en `tabular-nums`. Le texte ne répète **jamais** le pourcentage, déjà au bout de la
  ligne ;
- le **curseur**, seulement si la capacité `position` est déclarée ;
- l'inclinaison, au même gabarit, pour que les deux pourcentages s'alignent.

Le contrôle **ne répète pas** la grande valeur du panneau, qui suit la même convention.

Dans l'en-tête du panneau, le **spinner et l'interrupteur partagent une empreinte fixe de 52 × 56**
(`.head__toggle`) et le spinner reflète `isDeviceBusy` — l'appareil exécute encore — et non
`isPending`, qui ne dure que l'aller-retour HTTP et clignotait sans être lisible.

Dans les **lignes du panneau de pièce** (`RoomPanel`) : point pulsant devant le statut, interrupteur
qui bascule au geste, et **un clic pendant la course inverse le mouvement** — la commande est dérivée
de la cible, pas de la position réelle.

Limite connue, antérieure : à 375 px de large, les cartes des listes Lumières et Ouvrants débordent
(la grille `minmax(340px, 1fr)` ne tient pas dans 375 px moins les 72 px du rail). Non traité.

Reste ouvert : dans les lignes de `RoomPanel`, un interrupteur (52 × 56) et un chevron (18 px) ne
donnent pas la même hauteur de ligne selon l'appareil. Ce n'est pas un saut — rien ne se remplace
dans le temps — mais uniformiser alignerait les lignes au prix de 20 px sur chacune sans
interrupteur. Laissé au choix de l'utilisateur.


### Mise à jour 2026-09-08 — deux vocabulaires, deux compteurs, et l'aveu d'ignorance

**Un volet s'ouvre, un store se remonte.** Les commandes sont les mêmes (`cover.open` /
`cover.close`), les mots non. `coverWords()` (`apps/web/src/lib/cover.ts`) lit
`meta.cover.deviceClass` et rend un préfixe i18n : `cover.openClose.*` pour un volet, un rideau, un
portail, une fenêtre ; `cover.upDown.*` pour un store banne, un BSO ou un écran. Les six points
d'affichage le traversent : le statut des listes (`statusLabel`), la grande valeur et les boutons du
panneau appareil (`CoverControl`), et les boutons de la vue Ouvrants. Un ouvrant sans classe déclarée
est traité comme un volet — c'est la nature par défaut.

**Le résumé compte séparément** (`useHomeSummary`) : « n volets ouverts » et « n stores baissés »,
dans l'en-tête comme en tuiles. Les deux ne peuvent pas fusionner, parce que la même position se dit
à l'envers d'un cas à l'autre : un store « baissé » est déployé, donc de position basse, là où un
volet « ouvert » est de position haute. Portails, portes de garage, rideaux et fenêtres motorisées ne
sont dans aucun des deux compteurs : leur formulation reste à décider.

**Position inconnue : l'interface n'affirme rien.** Pour un ouvrant dont `state.position` est absente
(radio unidirectionnelle jamais commandée) : statut « Inconnu », grande valeur « Inconnu », aucun
pourcentage, icône non teintée, interrupteur non coché — et **hors des compteurs du résumé,
dénominateur compris**, ce qui fait disparaître la ligne et la tuile plutôt que d'annoncer un chiffre
faux. La bascule reste utile : `toggleCommand` rend `cover.close` sur un ouvrant non coché, donc le
geste fonctionne et la première commande donne une position déduite qui fait tout réapparaître.

Dans `CoverControl`, la ligne d'état affiche alors un tiret cadratin et **non** « Inconnu » : la
grande valeur le dit déjà juste au-dessus. La ligne garde sa hauteur (18 px mesurés) et reprend la
parole dès qu'un mouvement est annoncé — le mouvement étant la seule chose qu'une box dise d'un RTS.

### Mise à jour 2026-09-08 — position favorite : une touche, un repère, deux pièges Vuetify

La position favorite du moteur (capacité `preset`) est **activable partout où l'ouvrant apparaît** et
**visualisable là où il y a un curseur** :

- **panneau appareil** : une touche sur sa propre ligne, pleine largeur, avec la valeur écrite
  (« Position perso · 73 % »). Elle ne pouvait pas rejoindre les trois touches existantes, qui se
  partagent déjà les 340 px en `flex: 1 1 0` ;
- **vue Ouvrants** : une 4ᵉ touche-icône de 36 px dans la ligne, la valeur passant par le `title` et
  l'`aria-label` ;
- **repère sur la piste du curseur** aux deux endroits, posé par `:ticks="[fermeture]"` de Vuetify
  plutôt que par un pourcentage calculé à la main : le pouce ne parcourt pas toute la largeur du
  composant. Mesuré, le repère tombe à la fraction 0,7300 pour 73 % — 0,01 px d'écart.

**Une infobulle aurait été inutile** : l'application est tactile, rien ne survole. C'est pourquoi la
valeur est écrite en clair là où il y a la place, et confiée à l'`aria-label` là où il n'y en a pas.

Deux pièges Vuetify, invisibles aux tests unitaires et trouvés en mesurant dans le navigateur :

1. **Un repère donné en tableau est ÉTIQUETÉ.** Vuetify affiche « 73 » sous la piste, soit 24 px de
   hauteur en plus — un décalage de tout ce qui suit, pour un chiffre déjà écrit dans la touche
   juste en dessous. L'étiquette est masquée (`.v-slider-track__tick-label`).
2. **Un repère couleur accent est invisible sur la portion ACTIVE de la piste**, qui est de cette
   même couleur : mesuré `rgb(79,179,189)` sur `rgb(79,179,189)`. Vuetify marque ces repères
   `--filled`, et le jeton `--on-accent` existe précisément pour écrire par-dessus l'accent — d'où
   142 points d'écart de luminance, dans les deux thèmes par construction.

Hauteurs vérifiées inchangées : 98 px pour une ligne d'ouvrant avec ou sans repère, la touche
« position perso » n'existant que pour les appareils qui la déclarent — une différence entre
appareils, jamais un élément qui apparaît et disparaît dans le temps.

Limite préexistante notée au passage, sans lien avec ce changement : à 100 %, le halo du pouce du
curseur dépasse de 14 px la largeur du bloc du panneau. Rien ne défile (`overflow` visible), non
traité.

### Mise à jour 2026-09-09 — mémoriser la position favorite

Le geste retenu est celui de la télécommande Somfy : on amène l'ouvrant où on veut, **puis** on
mémorise. Une touche « Mémoriser cette position » sous le rappel envoie `cover.set_preset` avec la
position ACTUELLE — on n'enregistre donc jamais une valeur qu'on n'a pas vue, et il n'y a pas de
second curseur à régler.

Trois choix délibérés :

- **panneau appareil uniquement.** C'est un réglage, pas une manœuvre : les lignes de la vue
  Ouvrants gardent leurs 4 touches, et une action qui reprogramme un moteur ne côtoie pas les
  touches qu'on utilise dix fois par jour.
- **discrète et libellée en clair** (32 px, sans bordure, en gris) plutôt qu'une icône : reprogrammer
  la mémoire change aussi le bouton « my » des télécommandes murales de la maison, ça ne doit pas se
  déclencher sur une supposition d'icône.
- **verrouillée en pleine course**, parce que la position affichée y est celle du départ : mémoriser
  graverait une valeur que l'ouvrant a déjà quittée. Elle est *désactivée*, pas masquée — rien ne se
  décale.

Le retour est un **toast** (`cover.presetSaved`, émis par `DevicePanel` sur succès) : sans lui,
l'action réussie ne se verrait qu'au changement d'un « 73 % » en « 0 % » dans la touche du dessus,
pour un réglage qui, lui, est durable et partagé avec le reste de la maison.

### Mise à jour 2026-09-09 (bis) — position perso : une ligne, une étoile, un repère qui tient

Trois corrections à la version décrite dans les deux sections précédentes, toutes venues d'un retour
d'usage. Ce qui suit **remplace** la disposition « touche pleine largeur + bouton discret dessous »
et le repère couleur accent.

**Les deux touches sur une ligne** (`.preset`) : le rappel s'étire et porte son libellé et sa valeur
(249 px mesurés), la mémorisation se réduit à 40 px, les deux à 40 px de haut. La touche de
mémorisation porte une **teinte d'avertissement** (`rgb(var(--v-theme-warning))`, présente dans les
deux thèmes Vuetify) : elle réécrit un réglage du moteur, partagé avec les télécommandes murales.

**Icône : une étoile, après deux essais écartés.** Une coche se lisait comme un acquittement
(« validé ») ; une pipette, sémantiquement juste (« prélever la valeur actuelle »), ne se distingue
pas à 16 px. L'étoile — glyphe universel du favori — est le seul de ce jeu d'icônes qui matérialise
« mémorisé » à cette taille, et elle se distingue de la cible (`crosshair`) du rappel. Elle a été
AJOUTÉE au jeu (`lib/strokeIcons.ts`), qui n'avait rien pour cette idée. Leçon : une icône dont le
sens est exact mais le dessin illisible à la taille d'emploi ne vaut pas mieux qu'une icône fausse.

**Le repère du curseur** est désormais plus HAUT que le pouce (28 px contre 22) et passe DERRIÈRE
lui : il reste visible quand le pouce vient dessus, dépassant de 3 px de part et d'autre (mesuré).
Il est centré verticalement sur la piste et coloré en avertissement. Cela remplace l'astuce
`--filled` / `--on-accent` de la veille, qui ne servait qu'à contourner l'invisibilité d'un repère
accent sur une piste accent — problème disparu avec une couleur distincte. Le style vit maintenant
dans **`styles/app.css` sous `.cover-slider`**, les deux écrans l'affichant.

**Le piège Vuetify du jour**, invisible aux tests unitaires : Vuetify n'écrit
`inset-inline-start` en style inline **que pour les valeurs intermédiaires**. Les repères extrêmes
sont placés par ses propres marges, et le `margin: 0` nécessaire au recentrage les annule — un
repère à 100 % retombait alors **à gauche** de la piste. D'où deux règles explicites pour
`--first` (0) et `--last` (100 %). Vérifié après correction : 0 % → fraction 0,000, 73 % → 0,730,
100 % → 1,000.

Deux erreurs de mesure à connaître pour la prochaine fois : dans le volet d'aperçu, une capture
d'écran peut retarder d'une frame sur le DOM (le texte lu par script est la référence), et un
`getBoundingClientRect` pris pendant la transition du pouce donne une position fausse — il faut
attendre la fin du mouvement.

### Mise à jour 2026-09-09 — caméras : carte de liaison Google et carte détail

**Réglages** : `components/NestLinkCard.vue`, sous la carte d'appairage Hue, visible uniquement quand
le plugin `nest` est en `needs_pairing`. Différence avec Hue : la liaison ne se fait pas dans
Kasbah mais dans un **onglet Google** (`window.open` sur l'URL de `GET /api/plugins/nest/auth/url`),
et le retour de Google atterrit sur une page du serveur, pas dans l'app. La carte affiche donc,
après le clic, un texte « le consentement s'est ouvert… » et un bouton **Actualiser**
(`devices.refreshHealth`) pour voir les caméras arriver — le plugin fonctionne déjà en mémoire.
Libellés `settings.nest.*`.

**Panneau appareil** : `controls/CameraCard.vue` pour le kind `camera` — nature (`camera.classes.*` :
Caméra / Sonnette / Écran), pièce Google Home, « Sonne » si capacité `chime`, protocoles de flux
déclarés, et une ligne annonçant que la vidéo vient dans une phase suivante. Pas d'interrupteur
(`toggleCommand` → `null`), libellé d'état « En ligne » (`camera.online`), grande valeur = la nature.
Icônes trait `camera` et `doorbell` (`lib/strokeIcons.ts`), la sonnette choisie d'après
`meta.camera.deviceClass`. Dans la scène 3D, une caméra est un `GenericMarker` (sphère) à 1,20 m :
pas de forme propre pour l'instant.

La vue « Caméras » du rail est arrivée le même jour : voir la mise à jour suivante.

### Mise à jour 2026-09-09 — vue Caméras (7e entrée du rail)

Le rail compte 7 vues : Maison / Lumières / Ouvrants / **Caméras** / Énergie / Véhicules / Réglages.
`views/CamerasView.vue` est la troisième vue bâtie sur `RoomBands` (kind `camera`) : mêmes bandes
par niveau, mêmes pastilles de liaison, même poignée de réordonnancement, même carte des liaisons
mortes. Ce qui lui est propre tient en trois lignes : le résumé de l'en-tête compte les caméras
**en ligne** (`cameras.summary`, il n'y a rien d'autre à compter — une caméra n'est ni allumée ni
ouverte), il n'y a **aucun contrôle** dans la 4e colonne (pas de commande dans le contrat, l'API
Nest ne sait pas éteindre une caméra), et à sa place une puce discrète dit ce que le fabricant
déclare du flux : « Sonnette RTSP », « RTSP ». La vidéo elle-même viendra s'y loger (phase 2 de
`../3_plugins/3_5_google-nest.md`).

Vérifié sur une maison réelle : une caméra que l'utilisateur a choisi de ne pas placer reste en « Hors
maison ».

### Mise à jour 2026-09-09 — la vidéo dans la carte caméra

`CameraCard.vue` affiche `CameraVideo.vue` en tête de carte dès que la caméra déclare un flux
`rtsp` et qu'elle est disponible : lecture automatique **en sourdine** (les navigateurs refusent
l'autoplay sonore), boutons arrêter / reprendre et son coupé / activé en surimpression, message
d'état à la place de l'image tant qu'elle n'est pas là (connexion, flux terminé, indisponible,
navigateur incapable). Une caméra qui ne parle que WebRTC voit une ligne « pas encore pris en
charge » au lieu d'une promesse. Rien dans la scène 3D pour l'instant.

### Mise à jour 2026-09-09 — vue Caméras : une tuile vidéo par caméra

Chaque ligne de la vue Caméras porte désormais une tuile `CameraVideo` en mode **vignette**
(`autoplay=false`) : la dernière image JPEG que le serveur tient à jour pour cette caméra, son âge
en surimpression (« il y a 12 s »), et les mêmes boutons que la carte détail — lecture pour passer
en direct, arrêt pour revenir à la vignette, son. La tuile prend sa propre ligne sous le nom (en 4e
colonne elle serait un timbre-poste). Une caméra dont le flux échoue affiche « Caméra inactive :
pas de flux » ; une caméra qui n'a pas encore d'image, « Pas encore d'image ». La vue sonde les
dates toutes les 5 s, ce qui signale aussi au serveur qu'on la regarde
(`../3_plugins/3_5_google-nest.md`, « vue Caméras »).

**Trois états par tuile (repris le même jour, l'UI d'avant prêtait à confusion)** : la tuile porte
une **barre segmentée à trois boutons toujours affichés** — **Arrêté**, **Aperçu**, **Direct** —,
l'actif surligné, plus un **badge** en haut à gauche qui redit l'état (le direct en accent avec un
point qui bat). Trois états, un seul à la fois :
- **Arrêté** : aucune session pour cette caméra ; la dernière image reste figée. Retenu côté serveur
  (`PUT …/cameras/<id>/snapshots { enabled:false }`, la caméra sort de la rotation), donc partagé
  entre les écrans et perdu au redémarrage.
- **Aperçu** (défaut) : l'image JPEG que le serveur rafraîchit toutes les ~10 s, avec son âge en haut
  à droite. C'est une **image fixe qui change**, pas une vidéo — d'où la confusion : ce qui « bougeait »
  était en réalité des tuiles passées en Direct.
- **Direct** : la vidéo en continu, comme la carte détail (le bouton son apparaît alors).

**Au plus trois directs à la fois** (`LIVE_MAX` dans `CamerasView`) : un direct ouvre une session
Google dédiée, non plafonnée par le budget des vignettes ; au-delà de trois, le bouton **Direct** des
autres tuiles est grisé (« 3 directs au maximum »). Passer une tuile sur Arrêté ou Aperçu rend le
créneau. La carte détail ne change pas (lecture / arrêt du direct, son).

L'en-tête de la vue compte « **X actives sur N** » — *active* = caméra dont le flux marche au dernier
essai. Il n'y a pas de « en ligne » : l'API Google n'expose pas la connectivité des caméras (voir
`../3_plugins/3_5_google-nest.md`), donc « en ligne » vaudrait toujours le total. Le compteur descend
sous le total dès que la rotation constate une caméra éteinte.

### Mise à jour 2026-09-09 — rangées de même hauteur, badge d'origine en icône, protocole sur la ligne d'état

Sur remarque de l'utilisateur : des cartes voisines se décalaient parce qu'un nom long de caméra
passait sur deux lignes, décalant la tuile en dessous. Trois retouches dans `RoomBands` (donc
communes à Caméras, Lumières, Ouvrants) :

- **Titre sur une ligne** : `.row__name` en `text-overflow: ellipsis` (plus de retour à la ligne).
  Les rangées d'une même vue ont alors la même hauteur (constaté : 426 px pour une carte caméra avec
  tuile, 98 px pour un ouvrant).
- **Badge d'origine en icône** : au lieu d'une pastille texte « Dans le plan / Hors plan » (largeur
  variable qui volait de la place au nom), une petite **icône épingle** (`pin`), colorée selon l'état
  (neutre = placé, accent = auto, orange = non placé) ; le libellé passe en **infobulle** et
  `aria-label`.
- **Protocole au bout de la ligne d'état** : « RTSP » n'est plus un badge en tête de ligne mais se lit
  au bout de « En ligne » (nouveau slot `status-after` de `RoomBands`, rempli par `CamerasView`).

**Contradiction assumée avec la mise à jour du 2026-09-08.** Ce jour-là, les libellés étaient passés de
« Placée / Non placée » à « Dans le plan / Hors plan » pour éviter l'accord en genre (une lampe / un
ouvrant). L'utilisateur trouvant « Dans/Hors plan » peu clair, on revient à **« Placé / Non placé »** —
mais cette fois le texte n'est plus affiché, il n'est qu'en **infobulle d'une icône**, donc l'accord
(« Placé » pour une caméra) est à peine visible et le compromis est acceptable. L'anglais : « Placed /
Not placed ».

### Mise à jour 2026-09-09 — vue Médias (8e entrée du rail)

Nouvelle vue **Médias** (`views/MediaView.vue`, route `media`, icône `speaker`, entre Caméras et
Énergie) pour le kind `media_player`, sur `RoomBands` comme les trois autres vues par pièce. En-tête :
« N en lecture sur T ». Par ligne : touches précédent / lire-pause / suivant (grisées quand rien
n'est chargé — le plugin refuserait la commande), sourdine (touche allumée quand muet), curseur de
volume à valeur locale pendant le glissement, pourcentage. Chaque touche suit une **capacité** :
un Chromecast à volume fixe n'a ni curseur ni sourdine, un lecteur sans file n'a pas de piste
suivante. Le statut de la ligne (« Lecture · titre », « Au repos ») vient de `lib/deviceState.ts`.

Les clés `media.*` (`playing`, `paused`, `idle`, `off`, `nothing`) qu'utilisaient déjà
`deviceState.ts` et `MediaPlayerControl.vue` **n'existaient pas** dans `fr.json` / `en.json` (les
lecteurs simulés affichaient la clé brute) : ajoutées avec `summary`, `none`, `play`, `next`,
`previous`, `mute`, `unmute`, `volume`. Le rail compte désormais 8 vues. Plugin :
`../3_plugins/3_6_google-cast.md`.

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

### Mise à jour 2026-09-09 — lignes d'appareil : point de lecture, statut qui défile, pochette en fond

Trois retours de l'utilisateur sur les listes :

- **Point pulsant du panneau pièce** : il restait éteint pendant une lecture, parce qu'il suivait
  `isDeviceBusy`, qui ne connaît que le mouvement d'un ouvrant — et qui sert AUSSI à remplacer
  l'interrupteur du panneau par un spinner, ce qu'une lecture ne doit pas faire. Nouveau prédicat
  `isDevicePulsing` (`lib/deviceState.ts`) = occupé OU en lecture, réservé aux points des listes.
- **Statut qui défile** : « Lecture · titre » débordait et était coupé ; le statut des lignes du
  panneau pièce (`RoomPanel`) et des vues par pièce (`RoomBands`) passe par `MarqueeText` — défilement
  doux avec fondu, seulement si ça déborde.
- **Pochette en fond de ligne** : `RoomBands` expose un slot `backdrop` rendu en premier dans la ligne
  (`.row` en `position: relative; isolation: isolate`) ; la vue Médias y pose la pochette du morceau
  (URL relayée par le serveur) à 20 % d'opacité, fondue de la gauche vers les touches, avec un fondu
  croisé au changement de morceau. Rien ne se décale : la couche est absolue, hors de la grille. Les
  lignes du panneau pièce (`RoomPanel`, `.dev-row__art`) font de même, découpées au rayon de la ligne.
- **Teinte d'une lampe allumée** (même geste, demandé ensuite) : `lib/lightTint.ts` fabrique un dégradé de la
  couleur en cours (xy, sinon température de blanc, sinon blanc chaud 2700 K — le repli de la 3D), dont
  l'opacité suit la luminosité (18 % → 45 %). Posé par le slot `backdrop` dans la vue Lumières et par le
  même fond de ligne du panneau pièce, qui choisit pochette ou teinte selon l'appareil. Éteinte → rien.
- **Curseur de luminosité réservé** (vue Lumières) : il n'apparaissait qu'allumée, et la ligne grandissait
  de 32 px à l'allumage en poussant les lignes du dessous. Il est rendu pour toute lampe qui a la
  capacité `brightness`, en `visibility: hidden` et inactif quand elle est éteinte : toutes les lignes
  font 93 px, allumées ou non (mesuré).

### Mise à jour 2026-09-10 — « n en lecture » dans l'en-tête

Le résumé de l'en-tête (`composables/useHomeSummary.ts`) compte aussi les lecteurs qui jouent, entre
les ouvrants et la température : « 0 en lecture » dès qu'un lecteur existe, comme les lumières et les
volets. Clé `summary.playing`, sans pluriel en français (« 1 en lecture », « 3 en lecture »).

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

### Mise à jour 2026-09-10 — un lecteur qui ne dit presque rien

Trois règles du bloc « en cours » (`MediaPlayerControl.vue`), tirées d'une lecture dans une appli de vidéo sur
une TV (`../3_plugins/3_6_google-cast.md`) :

- **Sans titre, on nomme l'appli**, tout de suite et sans plus. Le repère d'attente « … » qui pulsait
  sur la première ligne est retiré : il tournait sans fin pour une appli qui ne publiera jamais de
  titre (certaines applis de vidéo natives de la TV), et pour le vrai cas d'attente — métadonnées en retard d'une
  seconde à un changement de morceau — le nom de l'appli est de toute façon ce qu'on affichait juste
  en dessous. Une ligne de moins qui bouge, une information de plus.
- **Les temps s'affichent dès qu'une position est connue**, même sans durée : le total reste vide et
  garde sa place. Avant, « pas de durée » cachait les deux temps, alors que la position d'un direct ou
  d'une appli de TV est une information (« 9:12 »).
- **Le curseur, lui, reste caché sans durée** (rien à parcourir), et sa place reste réservée.

Le statut d'une ligne de liste suit la même idée (`lib/deviceState.ts`) : en lecture sans titre, la
source complète le libellé — « Lecture · <nom de l'appli> » plutôt que « Lecture » seul.

Quatre tests montés sur le composant (`MediaPlayerControl.test.ts`) : nom de l'appli sans « … », temps
seul avec une durée absurde, deux temps et curseur actif sur une vraie durée, quatre lignes tenues au
repos.

### Mise à jour 2026-09-10 — un direct : précédent, suivant et curseur grisés

Ce qui joue peut être un **direct** (radio, chaîne d'info) : l'état le dit désormais
(`nowPlaying.live`, voir `../1_architecture/1_1_contrat-appareils.md`). Il n'a ni piste voisine ni
début où revenir, donc précédent, suivant et le curseur de position sont grisés — dans le panneau
appareil (`MediaPlayerControl.vue`) **comme dans la vue Médias** (`MediaView.vue`), qui portait la
même touche active.

Lecture / pause, sourdine et volume restent actifs : eux marchent sur un direct. Les touches ne
disparaissent pas, elles se grisent — la rangée garde sa forme, comme partout ailleurs.

Le grisage vaut pour le confort et la lisibilité ; c'est le plugin qui protège vraiment l'appareil, en
refusant la commande (un appui a suffi à couper le direct de la cuisine, voir
`../6_faq/6_1_pieges-runtime.md`). Deux tests de plus sur le composant, qui portent son total à six :
touches grisées sur un direct sauf lecture / pause, et actives sur un morceau ordinaire.

### Mise à jour 2026-09-10 — « en diffusion » plutôt que « en lecture », et l'icône du rail

**Le vocabulaire.** « En lecture » vient du monde du morceau de musique, qu'un téléviseur affichant
une série ne « lit » pas vraiment — et la catégorie Médias regroupe maintenant enceintes, téléviseurs
et écrans connectés. Les formulations « N en lecture sur T » (2026-09-09) et « n en lecture »
(2026-09-10, ci-dessus) **ne sont plus celles de l'app depuis le 2026-09-10** :

- `summary.playing` : « {n} en diffusion » (en-tête, toujours sans pluriel en français) ;
- `media.summary` : « {playing} en diffusion sur {total} » (vue Médias) ;
- `media.nothing` : « Rien en diffusion » (titre du bloc « en cours » sans morceau).

Retenue la forme **nominale** plutôt que « 3 diffusent » : elle garde la grammaire des autres
compteurs, tous des syntagmes nominaux (« {n} volets ouverts », « {n} stores baissés »), et elle
survit à la seconde phrase — « 3 en diffusion sur 12 » se lit, « 3 diffusent sur 12 » accroche.
L'anglais garde `playing`, qui couvre déjà le téléviseur.

`kinds.media_player` passe de « Enceinte » à « Lecteur » (« Speaker » → « Player »). C'est un
**repli sans appelant vivant** aujourd'hui — `DevicePanel.vue` aiguille explicitement un
`media_player` vers `media.classes.*` (Enceinte / Téléviseur / Écran connecté) — mais il nommerait
une TV « Enceinte » le jour où il servirait.

**L'icône du rail.** L'entrée `media` ne porte plus `speaker` mais `cast` : la mention « icône
`speaker` » de la mise à jour du 2026-09-09 ci-dessus n'est plus exacte. Raisonnement et candidats
écartés dans `4_0_langage-visuel.md`.

Vérifié dans la simulation in-process : « 1 en diffusion » dans l'en-tête, « 0 en diffusion sur N »
sur la vue Médias branchée à une maison réelle, « Au repos · Rien en diffusion » sur une enceinte au repos.
Commit `7ced3c2`.

### Mise à jour 2026-09-10 — « n lecteurs en diffusion » : le compteur nomme ce qu'il compte

L'utilisateur, en relisant l'en-tête : « on a par exemple "1 en diffusion", mais 1 quoi ? ». Toutes
les autres entrées de la ligne de synthèse sont des syntagmes nominaux complets — « 0 lumière
allumée », « 5 volets ouverts », « 2 stores baissés » — et seule celle-là laissait le nom implicite.

`summary.playing` devient donc **« {n} lecteur en diffusion | … | {n} lecteurs en diffusion »**
(anglais : « {n} player streaming | … | {n} players streaming »). Les formes de pluriel manquaient
alors que `useHomeSummary` passait déjà le compte en troisième argument de `t()` — la chaîne
précédente les ignorait simplement.

« Lecteur » plutôt que « média », « enceinte » ou « appareil » : c'est déjà le nom du kind dans l'app
(`kinds.media_player`, cf. la mise à jour du 2026-09-10 ci-dessus), il reste juste d'une enceinte à
un téléviseur, et il nomme l'**appareil** — c'est bien lui qu'on compte, pas le contenu, ce qui
écartait « média ». « Enceinte » serait faux dès qu'une TV ou une barre de son diffuse, et le parc
réel en compte ; « appareil » est toujours vrai mais ne dit rien.

Les deux autres formulations « en diffusion » de la vue Médias (`media.summary`, `media.nothing`) sont
inchangées : leur sujet est nommé par la phrase qui les porte.

### Mise à jour 2026-09-10 — une barre de son qui joue le son d'une TV : « Son de TV Salon · titre »

Quand la maison lie une TV à une barre (`meta.audioOutput`) et que la TV joue en envoyant son son ailleurs
(`../1_architecture/1_5_scene-3d.md`, `apps/web/src/lib/audioRouting.ts`, `house.relaySource(id)`), la barre
est montrée **active** : icône teintée et point pulsant (`RoomPanel`, `RoomBands` donc vue Médias, `PulseDot`
de la vue Médias), statut `relayLabel` = « Son de TV Salon · titre » (clé `media.relaying`, « Sound from
{name} »). Panneau appareil de la barre : la grande valeur est le **titre entendu** (celui de la TV), le
contrôle dit « Son de TV Salon » à la place de « Rien en diffusion » (prop `relayFrom` de
`MediaPlayerControl`, passée à travers `DeviceControl` en attribut). Ce qui ne change PAS, à dessein :
l'interrupteur et les touches de transport restent ceux de la barre (elle n'a pas de session à mettre en
pause ; le volume, lui, est bien le sien) ; la pochette reste sur la TV ; le compteur « n lecteurs en
diffusion » de l'en-tête ne compte que les lectures propres (décision de l'utilisateur).

**Révision le même jour** — après un premier essai où la barre était active mais non cochée et non
comptée, l'utilisateur tranche : « il faut activer les 2 appareils dans l'app et l'indiquer dans le
header ». Désormais la barre qui relaie est **cochée** (`RoomPanel`, `DevicePanel`) et son interrupteur,
comme la touche lire / pause de la vue Médias, agit sur la **TV** (`toggleCommand` de l'état de la TV,
envoyé à son id — c'est elle qu'on entend, la barre n'a pas de session) ; précédent / suivant restent
grisés (file de la barre). La **pochette de la TV** sert de fond à la ligne de la barre (`RoomPanel`,
slot `backdrop` de la vue Médias via `heard(entry)`) et au haut de son panneau. Les compteurs comptent
**les deux** : « n lecteurs en diffusion » de l'en-tête (`useHomeSummary.playing`), « n en diffusion sur
total » de la vue Médias, « n actifs » d'une pièce (`HomePanel.counts`). Ce paragraphe remplace la
phrase « ce qui ne change PAS » ci-dessus pour l'interrupteur, la pochette et le compteur.

### Mise à jour 2026-09-11 — interrupteur maître des lumières d'une pièce

Demande de l'utilisateur : « j'aimerais pouvoir allumer ou éteindre complètement une pièce sans avoir
à actionner chaque lampe ». Avant cette session, le seul « éteindre la pièce » de l'app était la
**pastille d'ambiance** re-tapée (`SceneChips.vue`, `mode: 'off'`, cf. la mise à jour du 2026-09-08
ci-dessus) : elle n'existe que dans une pièce à qui le fabricant a donné des ambiances.

`components/devices/RoomLightsToggle.vue` — un `v-switch` qui prend une liste d'ids d'appareils, n'y
garde que les **lampes** et envoie un **lot** de commandes par `devices.runScene()` (donc la mise à
jour optimiste et le retour arrière par lampe déjà en place, cf. `../1_architecture/1_4_app-web.md`).

Trois décisions :

- **Les lampes seulement** (choix de l'utilisateur parmi trois portées proposées). « Éteindre la
  pièce » ne doit ni fermer les volets — ils sont dans `toggleCommand` — ni couper le chauffage. C'est
  aussi ce que fait déjà l'ambiance en `mode: 'off'`.
- **Coché dès qu'UNE lampe est allumée** : l'interrupteur répond alors au geste qu'on vient chercher,
  éteindre. Conséquence assumée : rallumer une pièce à moitié allumée demande deux appuis.
- **N'écrire que sur les lampes qui changent** (allumer : celles qui sont éteintes ; éteindre : celles
  qui sont allumées) — le pont limite le débit des commandes (`../3_plugins/3_1_philips-hue.md`).

Présence et disponibilité sont dissociées, règle « rien ne doit bouger » : l'interrupteur existe dès
que la pièce a une lampe **dans l'inventaire**, et devient seulement *désactivé* si plus aucune n'est
joignable — sinon un pont muet le ferait disparaître sous le doigt.

**Pourquoi lampe par lampe et pas « éteins la pièce » dit au pont** : le contrat d'appareils ne
connaît pas la pièce, les commandes s'adressent à un appareil (`../1_architecture/1_1_contrat-appareils.md`).
Le pont Hue, lui, a bien une ressource de groupe : `grouped_light`, un seul PUT pour toute une pièce —
`apps/server/src/plugins/hue/index.ts` s'en sert déjà pour éteindre une ambiance. Elle n'est exposée
comme appareil que derrière `HUE_EXPOSE_ROOMS` (défaut `false`), et elle apparaît alors comme une
**lampe de plus** portant le nom de la pièce, comptée dans « n lumières allumées ». Passer par elle
supposerait donc soit ce doublon, soit une notion de commande de pièce dans le contrat et l'interface
plugin. À trancher ; en attendant, le lot de commandes marche avec tous les plugins et couvre les
pièces mixtes (une lampe Hue + une lampe d'un autre fabricant).

**Trois emplacements** (choix de l'utilisateur) :

1. **Panneau pièce** — dans l'en-tête, à droite du titre. Le libellé « Lumières » essayé d'abord a été
   retiré à sa demande : l'ampoule du pouce le dit déjà (cf. `4_0_langage-visuel.md`).
2. **Vue Lumières** — en tête de chaque carte de pièce. `RoomBands.vue` gagne pour cela un slot
   **`room-action`** (vide par défaut, donc sans effet sur les vues Ouvrants, Caméras et Médias), posé
   entre le titre et la poignée de réordonnancement.
3. **Panneau maison** — sur chaque ligne de pièce, pour éteindre sans y entrer.

Deux effets de bord du branchement :

- `HomePanel.vue` : la ligne de pièce passe de `<button>` à `<div role="button" tabindex="0">` — un
  interrupteur **dans** un bouton n'est pas du HTML valide. Son nom et son sous-titre sont désormais
  coupés aux points de suspension : les 52 px pris par l'interrupteur faisaient passer « Salle
  de jeux · Rez-de-chaussée » sur deux lignes, et la liste perdait des lignes de hauteur égale
  (63 / 64 px après correction, mesurés au `getBoundingClientRect`).
- `RoomBands.vue` : `.group__title` absorbe la place libre et s'ellipse, pour que le contenu du slot
  et la poignée restent collés à droite. Vaut aussi pour Ouvrants, Caméras et Médias, seulement
  visible sur un nom de pièce très long.

Clé i18n : `rooms.allLights` (étiquette d'accessibilité et infobulle — l'interrupteur n'a pas de
texte à côté de lui).

Tests : `apps/web/src/components/devices/RoomLightsToggle.test.ts` (absence dans une pièce sans
lampe, extinction des seules lampes allumées, allumage des seules joignables, interrupteur maintenu
désactivé quand rien ne répond).


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


### Mise à jour 2026-09-11 — vue Énergie : appareils, schéma de flux, et carte d'appairage Enphase

**La vue liste ses appareils**, comme Lumières, Ouvrants, Caméras et Médias. `RoomBands` accepte
désormais un kind **ou une liste** ; la vue Énergie lui passe `['energy', 'ev_charger']`, ce qui
réunit le site, les batteries et la borne, groupés par pièce, avec le bouton « Placer » sur chacun.
Les **panneaux en sont volontairement absents** : un module ne se place pas seul, il suit son champ
(`../2_maison/2_0_format-house-json.md`), et des dizaines de boutons « Placer » auraient proposé exactement ce
que le modèle interdit.

Deux corrections que cette liste a imposées. Une batterie affichait « 0 W » de production, ce qui ne
dit rien d'elle : `statusLabel` rend maintenant sa charge et son sens de travail, « 100 % · Décharge
16 W ». Et son icône était un panneau solaire ; `deviceIcon` applique la règle que `strokeIcons`
avait déjà — un `energy` qui ne mesure pas le réseau est une unité de stockage.

**Le site se reconnaît à ce qu'il mesure le RÉSEAU** (`apps/web/src/lib/energy.ts`). La vue et
`useHomeSummary` prenaient le premier appareil `energy` de la liste et tombaient sur une batterie dès
qu'il y en avait une : zéro watt de production affiché avec une charge à cent pour cent. Un test de
non-régression fige le choix.

**Le schéma de flux remplace les quatre tuiles.** Inspiré de l'app du fabricant, à la demande de
l'utilisateur — « ce qu'il y a de bien c'est qu'on voit les flux d'électrons, c'est bien plus lisible
qu'uniquement du texte, même si je trouve que le texte est utile pour comprendre ». D'où : les mots
restent (« injection », « décharge »), et le trajet s'y ajoute.

- La **maison est au centre**, dans un anneau qui répartit sa consommation entre le soleil, la
  batterie et le réseau. Le calcul suit le bilan du contrat (`consommation = production + réseau −
  batterie`) : ce qui l'alimente est le soutirage, la décharge, et le solaire pour le reste ; une
  charge ou une injection n'y figurent pas, elles en sortent.
- Les quatre sources sont **aux coins**, reliées par des traits qui sortent par le **côté** et
  arrivent sur le **haut ou le bas** de l'anneau, coudes arrondis. Le point d'arrivée est calculé par
  Pythagore pour toucher le cercle exactement.
- Un **seul point** parcourt chaque trait actif, dans le sens réel du courant, **lentement** : neuf
  secondes le tour au repos, cinq à pleine puissance. Vitesse demandée « apaisante » ; l'essai
  précédent, des pointillés à moins d'une seconde, a été rejeté.
- L'anneau ne tire que du **seul accent** — plein pour le soleil, à demi pour la batterie, gris
  neutre pour le réseau — donc les quatre accents du réglage restent maîtres
  (`4_0_langage-visuel.md`).
- Règle « rien ne bouge » : les nœuds sont à demeure, les trois parts sont **toujours listées même à
  zéro**, un flux au repos garde son trait en gris, et la ligne d'indice de chaque nœud garde sa
  place quand elle est vide. Le mouvement s'arrête sous `prefers-reduced-motion`.
- Le **même seuil de 20 W** vaut pour l'anneau et pour les traits : sans cela l'anneau annonçait
  « 1 % batterie » alors qu'aucun point ne circulait sur ce fil.

Le schéma et le graphique de production **partagent la ligne**, moitié-moitié et à la même hauteur
(`align-items: stretch`, barres en `flex: 1`) ; ils se replacent l'un sous l'autre en dessous de
900 px, faute de quoi les blocs se chevauchent.

**Carte d'appairage Enphase** (`apps/web/src/components/EnphasePairingCard.vue`), dans les Réglages
à côté de celles de Hue et de Nest, visible seulement quand l'appairage demande quelque chose. Deux
voies au choix, un sélecteur segmenté : les identifiants du compte, ou un jeton déjà obtenu. Elle
affiche le **rôle** du jeton et sa date d'échéance — c'est ce qui explique une échéance de douze
heures — et prévient avant de créer un jeton de plus quand celui en place est encore bon.

Contrairement aux cartes Hue et Nest, elle ne demande **rien à recopier dans `.env`** : le serveur
garde le jeton, et la carte dit où. Détail du plugin : `../3_plugins/3_7_enphase.md`.

Trois pièges d'affichage relevés en mesurant, jamais à l'œil : un `min-height` sur le corps du
sélecteur laissait encore le bouton sauter de 20 px, d'où les deux formulaires **superposés dans la
même cellule de grille** avec bascule de `visibility` ; réserver la ligne d'avertissement en `em`
débordait sur trois lignes à 375 px et poussait le bouton de 21 px, d'où le texte **toujours présent**
dont seule la visibilité bascule ; et le serveur ne comptant qu'en jours pleins, « expire dans
0 jours » s'affichait pour un jeton de onze heures — la carte recalcule en heures sous un jour.

**Orientation** (`apps/web/src/lib/orientation.ts`) : la borne de recharge et les appareils `energy`
— batteries et boîtier de passerelle — s'orientent maintenant comme un téléviseur, à la demande de
l'utilisateur. La règle porte désormais deux raisons : ce qui **regarde** quelque part (écran,
caméra, véhicule) et ce qui a une **face** posée contre un mur.

### Mise à jour 2026-09-11 — vue Énergie : l'échelle de temps écrite dans chaque bloc

Les deux blocs de la ligne du haut ne parlent **pas de la même échelle de temps**, et rien ne le
disait : le schéma montre l'instant, le graphique la journée. Chacun l'annonce désormais sous son
titre — « Instantané » pour le schéma (`energy.instant`), « Historique local » pour la production du
jour (`energy.localHistory`). Le bloc de flux n'avait jusque-là **aucun titre visible**, seulement un
`aria-label` ; il en gagne un.

**Sous le titre, et non à côté.** Posé sur la même ligne, le mot entrait en concurrence avec le total
« 12,3 kWh · kWh produits » et faisait passer l'en-tête sur deux lignes sous ~560 px **et** dans la
fenêtre 900–950 px, là où les cartes viennent justement de passer en deux colonnes. Pire : la hauteur
dépendait alors de la longueur du total, donc de la production accumulée — l'en-tête aurait grandi
tout seul en cours de journée, contre la règle « rien ne bouge » (`4_0_langage-visuel.md`).

Demande d'origine de l'utilisateur : un **sélecteur live / jour / mois / année / exploitation**
pilotant les deux blocs. Il n'est **pas** implémenté, et la raison n'est pas l'UI : l'API locale de
la passerelle ne publie que des **compteurs** (`whToday`, `whLastSevenDays`, `whLifetime`), jamais de
série datée — c'est le cloud Enphase que lit l'app Enlighten. Mois et année n'existent donc nulle
part aujourd'hui, et l'historique horaire du serveur vit **en mémoire, 48 h**
(`../1_architecture/1_2_serveur-et-plugins.md`). Voie locale repérée pour plus tard : `whLifetime`
étant **monotone**, une différence entre deux dates persistées donnerait le total exact d'une période
— exact pour la production et la consommation, approximatif pour le réseau et la batterie, qui n'ont
aucun compteur cumulé fiable (`net-consumption.whToday` vaut 0, cf. `../3_plugins/3_7_enphase.md`).
Décision en attente côté utilisateur. Le libellé « Historique local » dit donc aussi **d'où vient**
ce que le graphique montre.

**Largeur plancher du schéma.** Mesuré : il faut **380 px** pour que les quatre nœuds et l'anneau
tiennent côte à côte ; en dessous, les boîtes mordent sur le cercle. La scène garde donc cette
largeur minimale dans un cadre `overflow-x: auto` — sous ~500 px de fenêtre, **seul le schéma défile
latéralement**, dans sa carte, et la page reste fixe. Deux pièges CSS payés au passage, tous deux
détaillés dans `../6_faq/6_0_pieges-outillage.md` : la propagation d'un `min-width` à travers les
cellules de grille, et le plancher `minmax(340px, 1fr)` de `RoomBands` qui faisait **déborder la page
entière des cinq vues en bandes** sous 560 px.

Nettoyage au passage : `EnergyView.vue` gardait le CSS de l'ancienne maquette à quatre tuiles
(`.energy__grid`, `.ring`, `.ring__*` et sa requête média), plus référencé par aucun élément depuis la
refonte du schéma de flux.

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

### Mise à jour 2026-09-11 — Flux d'énergie : un seuil mesuré, un anneau borné, le mot « Inactif »

Comparaison écran à écran avec l'appli Enphase live, sur la maison réelle. Elle a révélé **deux causes
distinctes** que le même symptôme réunissait : une borne simulée d'un côté, la lecture des petites
valeurs de l'autre.

**Le nœud « Borne » disparaît avec son appareil.** Il n'y a rien eu à changer ici : `EnergyFlow.vue`
le conditionne déjà à `shown: !!charger`. C'est la simulation qui publiait une borne fantôme, retirée
dans `../3_plugins/3_0_simulation-mock.md`.

**`IDLE_W` = 10 W**, en dessous desquels un fil reste gris et sans point. Le trajet de la décision
compte autant que le chiffre :

| Valeur | Verdict |
|---|---|
| 20 W (départ) | masquait un petit soutirage réel, relevé |
| 100 W (essayé) | **rejeté** : effaçait la production réelle au crépuscule, et le soutirage mesuré la même nuit. Calé sur l'affichage de l'appli Enphase, qui arrondit au dixième de kW |
| 7 W (proposé) | sous le désaccord entre compteurs (0–11 W) : c'est ce désaccord qu'on dessinerait |
| **10 W** (retenu) | posé au niveau de ce désaccord, et encore **sous une ampoule LED** — rien que le foyer appellerait une charge n'est masqué |

**La part « Solaire » de l'anneau est bornée par la production.** Elle était calculée en *reste*
(`consommation − réseau − batterie`) et ramassait donc tout l'écart d'arrondi des compteurs : « 1 %
Solaire » s'affichait panneaux éteints. Le solaire ne peut pas donner à la maison plus qu'il ne
produit — `min(production, reste)`, et le même seuil s'applique.

**« Inactif » plutôt qu'un sens inventé.** Les nœuds Réseau et Batterie écrivaient « soutirage » /
« injection » et « Charge » / « Décharge » d'après le seul signe de la valeur. À ±5 W, le mot
basculait d'une lecture à l'autre sans qu'aucun point ne circule. Sous le seuil, ils affichent
maintenant `energy.idle` (« Inactif » / « Idle », `../4_2_theme-et-langues.md` pour les deux langues).
La valeur mesurée, elle, reste affichée telle quelle : « 38 W · Réseau · Inactif » dit les deux choses
sans en nier une.

Vérifié nuit tombée sur une maison réelle : Production à zéro en gris sans point, Réseau
soutirage actif avec son point, Batterie en décharge, anneau **0 % Solaire** et la batterie en
tête des parts, et le bilan qui se ferme. Aucune empreinte ne bouge : les mots de remplacement tiennent
dans la place déjà réservée par `node__hint`.

### Mise à jour 2026-09-11 — carte Plugins : un interrupteur par fabricant, des pastilles par sous-item

Réglages → Plugins ne liste plus seulement les plugins actifs : elle liste **tout ce que le serveur
sait faire**, avec de quoi choisir.

- Une ligne par plugin : nom, clés `.env` lues (jamais leurs valeurs), pastille d'état, et un
  **interrupteur**. Cocher écrit la maison et prend effet sans redémarrer le serveur.
- Un squelette (Sonos, iRobot, Tesla…) est listé avec son interrupteur **grisé** et « Pas encore
  implémenté » : on voit ce qui existera sans pouvoir activer une coquille vide.
- Sous-items : une rangée de **pastilles à bascule** (« Fournit »), affichée seulement quand le
  plugin est allumé — décochées, elles ne voudraient rien dire. Pastilles et non cases à cocher pour
  deux raisons : `v-checkbox-btn` rend une icône vide avec le jeu d'icônes maison
  (`../6_faq/6_0_pieges-outillage.md`), et une pastille garde la **même empreinte** allumée ou
  éteinte. Vérifié : décocher « Énergie » ne déplace ni les pastilles voisines ni la ligne suivante.
- Un paragraphe d'introduction dit où va le choix (`settings.pluginsHint`) : dans le fichier de la
  maison, pas dans le navigateur — il vaut donc pour tous les écrans.

### Mise à jour 2026-09-19 — plus de squelette dans Réglages → Plugins

Le tiret « Un squelette (Sonos, iRobot, Tesla…) » plus haut date d'avant l'implémentation de ces
trois-là. `sonos` était le **dernier** `makeStubPlugin` ; il a quitté ce statut le 2026-09-19
(`../3_plugins/3_15_sonos.md`). L'interrupteur grisé « Pas encore implémenté » reste le comportement
de `implemented: false` — il n'a plus de porteur dans `PLUGIN_FACTORIES`. Les enceintes Sonos
apparaissent dans la vue Médias déjà existante (bande « Hors maison » tant qu'on ne les a pas
placées) ; aucune carte de liaison, aucune vue nouvelle. Le cas de test « ne se déplie pas »
(`PluginSection.test.ts`) construit un id factice `unobtanium`.

### Mise à jour 2026-09-12 — les quatre pastilles d'accent deviennent une grille de thèmes

Le bloc « Couleur d'accent » de la colonne gauche des Réglages est remplacé par un bloc **« Thème »**
(commit `abf88f5`, mécanique côté palette dans `4_2_theme-et-langues.md`). Quatre pastilles rondes ne
pouvaient plus rien dire : un thème ne se reconnaît pas à son accent mais à son fond et ses surfaces.

Une **tuile par thème**, deux colonnes, chacune composée de trois éléments d'empreinte fixe :

- un **aperçu** de 46 px qui rend la palette elle-même — fond du thème, carte posée dessus, deux
  barres de texte (`text` et `muted`), pastille d'accent en bas à droite. C'est la palette qui se
  montre, pas une vignette d'illustration à maintenir à côté ;
- le **nom** du thème (nom propre, jamais traduit) ;
- une **ligne de variante** toujours présente, même vide : elle porte le nom de la déclinaison chez
  son auteur (« Latte », « Alucard », « Light Owl », « Day ») ou, pour un thème sans variante claire,
  « Sombre uniquement ». Réserver la ligne évite que la grille se réorganise en changeant
  d'apparence — règle « rien ne doit bouger » (`4_0_langage-visuel.md`).

**L'aperçu montre la variante que l'apparence DEMANDE**, pas celle appliquée : en apparence
« Clair », toutes les tuiles s'affichent en clair sauf Synthwave '84 qui reste sombre — ce qui est
précisément ce que chacune appliquerait si on la choisissait. Le badge « Sombre uniquement » est
**statique** (il dépend du thème, pas de l'état), donc il ne clignote pas d'une apparence à l'autre.
Le thème sélectionné se marque comme les autres bascules de la page : bordure d'accent et fond
`--accent-soft`.

La description de la vue Réglages plus haut (« couleur d'accent (4 pastilles) ») est donc caduque sur
ce point ; le reste de la colonne — apparence, langue, origine GPS, plein écran — est inchangé.

### Mise à jour 2026-09-12 — la luminosité de TOUTE une pièce

L'interrupteur maître des lampes d'une pièce (2026-09-11) gagne un compagnon : un **curseur de
luminosité de pièce** (`RoomBrightness.vue`), sur sa propre ligne sous l'en-tête, dans le **panneau
pièce** et dans l'**en-tête de carte de la vue Lumières** (nouveau slot `room-under` de `RoomBands`,
à côté de `room-action`). Une ligne à lui, et non à côté du titre : un curseur coincé entre un nom de
pièce et un interrupteur n'aurait plus eu de course utile dans une carte de 340 px.

Comme l'interrupteur, ce n'est pas une notion du protocole mais un **lot de commandes**
(`devices.runScene`), avec sa mise à jour optimiste par lampe. Trois décisions :

- **valeur absolue** : toutes les lampes allumées reçoivent le même pourcentage. Les écarts réglés
  lampe par lampe sont donc écrasés — c'est le geste qu'on vient chercher (« mets le salon à 30 % »),
  et le réglage fin reste à la ligne de chaque lampe ;
- **seulement les lampes ALLUMÉES** : poser une luminosité sur une lampe éteinte l'allumerait chez la
  plupart des fabricants, et le curseur serait devenu un second interrupteur ;
- **valeur affichée = la moyenne** des lampes allumées qui savent varier ; place **réservée** quand la
  pièce est éteinte (invisible, inactif), comme le curseur d'une ligne — mesuré : la première ligne
  d'une carte reste à 101 px du haut, allumée ou éteinte (règle « rien ne doit bouger »).

La lecture des lampes est partagée avec l'interrupteur (`composables/useRoomLights.ts`,
`../1_architecture/1_4_app-web.md`) : les deux contrôles ne peuvent pas voir deux pièces différentes.
Le panneau **maison**, lui, garde le seul interrupteur par ligne de pièce : une liste de pièces n'est
pas l'endroit où l'on nuance.

### Mise à jour 2026-09-12 — vue Ouvrants : une jauge en fond de ligne, inversée pour un store

Dans les vues Lumières et Médias, une ligne active se voit à son fond (teinte de la lampe, pochette du
morceau) ; la vue Ouvrants, elle, ne disait rien — il fallait lire chaque ligne pour savoir ce qui
était ouvert. Le slot `backdrop` sert maintenant à une **jauge** : une bande d'accent doux qui part du
bord gauche, large de la part qui se remarque, **fondue sur sa fin** pour ne pas se lire comme une
seconde piste de curseur. Absolue et en z-index négatif : elle ne décale rien, et une ligne sans rien
à signaler n'a simplement pas de fond.

Ce qu'elle mesure n'est pas l'ouverture mais `coverActivity` (`../1_architecture/1_4_app-web.md`) : un
volet se remarque **ouvert**, un store **déployé**. L'inversion est voulue et vient de l'usage — un
store déployé est celui qui craint le vent, replié il n'y a rien à surveiller. La même règle teinte
l'icône de la ligne (`isDeviceOn`) et remplit la pilule du marqueur 3D : les trois s'accordent. La
jauge lit la position **visée** quand le store en tient une, donc elle suit le geste comme le curseur,
et une position inconnue ne dessine rien.

Le compteur de l'en-tête (« n ouverts sur m ») reste sur le mot du contrat et compte les positions
> 0, stores compris ; le résumé de l'en-tête maison, lui, sépare déjà « volets ouverts » et « stores
baissés ».

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

### Mise à jour 2026-09-12 — interrupteurs maîtres des vues Lumières et Ouvrants

Un interrupteur dans l'**en-tête de vue**, à droite du compteur, agit sur toute la maison.

- **Lumières** : le composant de la pièce (`RoomLightsToggle`) posé sur toutes les lampes, avec un
  libellé propre à la portée (« Toutes les lumières de la maison »). Coché **dès qu'une lampe est
  allumée** : le geste qu'on vient chercher est « tout éteindre ».
- **Ouvrants** : `CoversToggle.vue`, coché **seulement quand tout ce qu'on sait est fermé**. La règle
  des lampes aurait été mauvaise ici : une maison a presque toujours un volet baissé quelque part, et
  « tout fermer » le soir aurait demandé deux appuis. Les positions inconnues ne votent pas.
   *(Dépassé le 2026-09-18 : `CoversToggle.vue` est devenu `CoversMaster.vue` (`components/devices/CoversMaster.vue`) — voir « Mise à jour 2026-09-18 (4) — en-têtes Lumières et Ouvrants : deux gestes nommés, et le droit de se raviser ».)*

L'interrupteur des ouvrants parle de ce qu'on **commande** — coché = fermé, la convention du contrat
et des interrupteurs de ligne (`cover.close` ferme un volet et **baisse** un store, c'est le plugin
qui traduit). À ne pas confondre avec la mise en valeur des lignes, qui est inversée pour un store
(`coverActivity`) : l'une dit ce qu'on fait, l'autre ce qui se remarque. Les deux lots n'écrivent que
sur ce qui doit bouger — on n'envoie rien à un ouvrant déjà fermé — sauf position inconnue, où l'on
envoie quand même puisqu'on ne sait pas où il en est. Un parc injoignable laisse l'interrupteur en
place, inactif.

### Mise à jour 2026-09-12 — un ouvrant sans retour ne donne plus de pourcentage, et dit sa nature

**Plus de pourcentage déduit.** La grande valeur du panneau appareil n'affiche un pourcentage que si
le moteur sait **viser** une position, donc la mesurer (capacité `position`). Sans elle — radio
unidirectionnelle RTS — le pourcentage n'était qu'une déduction de la dernière commande de pleine
course : un store réellement arrêté à mi-hauteur s'annonçait « 100 % ». Elle donne maintenant le
**mot**, qui reste vrai : « Baissé » / « Remonté », « Ouvert » / « Fermé », « Inconnu » tant que rien
n'a été commandé. La ligne d'état juste en dessous ne répète plus ce mot (elle garde sa hauteur et
reprend la parole dès qu'un mouvement commence), exactement comme pour « Inconnu ». Les moteurs
bidirectionnels gardent leur pourcentage, lui qui vient d'une mesure. Côté plugin, ce que devient une
position supposée après un arrêt : `../3_plugins/3_4_somfy-tahoma.md`.

**Chacun dit sa nature.** Le sous-titre de l'en-tête du panneau annonçait « Volet » pour un portail,
ce qui se lisait comme une erreur de liaison. Il prend maintenant la nature déclarée par le fabricant
quand il y en a une — « Portail », « Store banne », « Porte de garage » (`cover.classes.*`), comme il
le faisait déjà pour un lecteur (« Téléviseur », `media.classes.*`). Le mot du kind ne sert plus que
de repli et devient « **Ouvrant** » (`kinds.cover`), qui couvre volets, stores et portails.

**Pas du curseur d'ouvrant ramené à 1 %** — le repère de position favorite tombe où le moteur l'a
mémorisée (73 %, 81 %…), et Vuetify aligne le **pouce** sur le `step` : à 5 %, rappeler la position
perso posait le pouce jusqu'à 2,5 points à côté de son propre repère, mesuré ~5 px sur une piste de
190 px (`../6_faq/6_0_pieges-outillage.md`). Les deux curseurs d'ouvrant (panneau et vue Ouvrants)
sont passés au pas de 1 %.

### Mise à jour 2026-09-12 (bis) — l'interrupteur des Ouvrants sécurise, il ne « ferme » pas

**Précise et remplace** la section précédente du même jour sur `CoversToggle`. Le mot « fermer » ne
pouvait pas gouverner tout un parc : `cover.close` **baisse** un store, or un store baissé n'est pas
une maison sécurisée mais de la toile au vent, et rien ne doit **ouvrir** un portail par un geste
d'ensemble. L'interrupteur dit donc **sécuriser / ouvrir les volets**, et ses deux sens ne sont
volontairement pas symétriques :

- **coché = tout est AU REPOS** — volets et portail fermés, stores **remontés** (`coverAtRest`,
  `../1_architecture/1_4_app-web.md`). Une position inconnue est supposée au repos : sans ça, un
  portail muet décochait l'interrupteur en permanence, et l'appui suivant aurait ouvert le portail.
- **appui pour sécuriser** : chaque ouvrant part vers son repos — `cover.close` pour ce qui se tient
  debout, `cover.open` pour un store (on le **remonte**, on ne le déploie pas). Un ouvrant dont on
  ignore la position reçoit quand même la commande : on ne sait pas où il en est, et fermer ce qui est
  déjà fermé ne coûte rien.
- **appui pour ouvrir** : les **volets** seulement (rideaux et fenêtres motorisées compris). Ni le
  portail, ni la porte de garage (`isPassageCover`), ni les stores. Ce qu'on ouvre par erreur ici coûte
  plus cher que ce qu'on oublie d'ouvrir.
- **rien à ouvrir** (une terrasse de stores et un portail, tout au repos) : l'interrupteur se désactive
  plutôt que de promettre un geste qu'il ne ferait pas.

L'interrupteur maître des **lampes** garde sa règle : coché dès qu'une lampe est allumée, le geste
qu'on vient chercher étant « tout éteindre ».

**Les libellés montrent la supposition, marquée comme telle.** Puisque l'app suppose le repos pour
décider et pour dessiner, cacher cette supposition derrière un « Inconnu » revenait à faire dire à
l'écran le contraire de ce que fait la scène. **Remplace** sur ce point la section précédente du même
jour (« Inconnu tant que rien n'a été commandé ») :

- **ligne de liste** : « Fermé (supposé) », « Remonté (supposé) » (`cover.assumed`) ;
- **panneau appareil** : le mot seul en grande valeur — « Remonté » — et la ligne d'état juste en
  dessous porte la réserve : « Position supposée, jamais confirmée » (`cover.assumedHint`). Le
  « (supposé) » ne tient pas en 32 px, et cette ligne était justement libre dans ce cas.

Le mot montré est celui du REPOS de la nature (`coverRestKey`), donc « Fermé » pour un volet ou un
portail et « Remonté » pour un store : le même état que l'interrupteur maître considère et que la
scène dessine. Dès qu'une position arrive — la première commande suffit sur un RTS — la réserve
disparaît et l'état redevient un fait.

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


### Mise à jour 2026-09-12 (quinquies) — la carte « Champs de panneaux »

Nouvelle carte (`apps/web/src/components/home/PanelArraysCard.vue`), au fond du panneau de
l'**installation solaire** — le site d'une installation qui produit, pas une batterie — juste
au-dessus d'« Emplacement ». C'est là qu'on déclare ses champs, parce que c'est là qu'on vient quand
on parle de son installation. Elle reste accessible même quand l'installation n'est pas posée dans la
maison : sinon un champ déjà déclaré serait resté dessiné sur le toit sans aucun panneau pour le
régler.

**La liste**, puis le réglage de l'un d'eux : rangées, colonnes, hauteur, **pente du support**,
**inclinaison** des modules, orientation, portrait / paysage, et la grille des emplacements. Chaque
réglage s'écrit tout de suite (`../1_architecture/1_3_protocole-rest-ws.md`) ; les valeurs se tapent
au clavier comme celles du mode « Déplacer ». Les deux angles portent une infobulle, parce que leur
différence n'est pas devinable : l'un est le toit, l'autre le châssis.

**Le champ se déplace en glissant n'importe lequel de ses modules dans la 3D** — le rappel est écrit
dans la carte. La ligne du champ porte pour cela une pilule « ✛ Régler » : en texte gris, elle se
lisait comme une étiquette et personne ne trouvait le geste.

**La grille des emplacements et le toit se répondent.** Une case liée porte les cinq derniers chiffres
de son onduleur, une case vide porte **sa place** (`2-5`) — les mêmes chiffres que la pilule du module
dans la scène (« Emplacement 2-5 »). Et **survoler une case allume son module dans la 3D** (au
toucher, l'ouverture du menu fait pareil) : sans ce fil, on garnissait une grille sans savoir à quel
panneau du toit chaque case correspondait. La liste d'onduleurs est triée et en **chasse fixe** : on y
cherche un numéro relevé sur un plan, des chiffres alignés se comparent d'un coup d'œil.

**Le panneau d'un MODULE** (un onduleur touché dans la 3D) dit son champ et sa place — « Champ 1 ·
rangée 1, colonne 2 » — et propose « Régler » pour ouvrir le champ. Son fil d'Ariane nomme
l'**installation** : un module appartient à son champ, donc à son installation, pas au toit qui le
porte.

**Retirer l'installation de la maison emporte ses champs** : la confirmation le dit (« Confirmer ·
2 champs », même largeur que « Retirer de la maison », rien ne bouge). C'est le moment où l'on décide.

**Un débordement, et sa cause.** Les quatre préréglages de hauteur (Plafond / Applique / Table / Sol)
demandent 264 px pour 257 dès que le panneau prend sa barre de défilement — ce que cette carte, plus
haute, a rendu fréquent. Un segmenté ne se serre pas tout seul (ses mots ne se coupent pas) : la
dernière pilule sortait de la carte. Quelques pixels repris sur les côtés de chaque segment, sur cette
ligne-là seulement.

### Mise à jour 2026-09-13 — la vue Énergie montre chaque onduleur, à sa place

La vue Énergie disait la production de la MAISON ; elle dit maintenant celle de chaque
micro-onduleur, dans une bande « Onduleurs » posée sous le schéma de flux
(`components/energy/InverterFields.vue`).

Une carte par CHAMP de panneaux, et dans chaque carte la **grille du champ** — autant de colonnes
qu'il en déclare, rangée 1 en haut, c'est-à-dire la même disposition que sur le toit en 3D
(`panelArrayDevices` range `panels` rangée par rangée). Une case = un emplacement : la fin du numéro
de série au-dessus (cinq caractères, `shortInverterId`, partagé avec la grille de la carte « Champs
de panneaux » — les deux se lisent l'une avec l'autre), la puissance instantanée en dessous, une
jauge de fond à bord franc, et au pied de la jauge les deux repères décrits dans la page
[scène 3D](../1_architecture/1_5_scene-3d.md) : plafond de l'onduleur et record. Les emplacements
vides gardent leur case, en pointillés, avec leur place (« 2-5 ») : sans eux la grille ne
ressemblerait plus au toit. Une liste à plat de numéros de série, elle, ne disait rien de ce
qu'on voit par la fenêtre.

Détails qui ont demandé une correction en cours de route : les onduleurs qu'aucun champ ne porte ne
disparaissent pas (dernière carte « Hors champ », sur une colonne) ; un onduleur muet affiche un
tiret et non « 0 W » ; la grille d'un champ très large défile à l'horizontale dans sa carte plutôt
que d'élargir la page ; et l'infobulle d'une case porte ce que la case ne tient pas (nom, place,
puissance, plafond, record).

**Deux réglages de plus dans la carte « Champs de panneaux »** : « Puissance crête » (Wc, celle du
module) et « Puissance onduleur » (W, la puissance de sortie maximale — le libellé complet
« Puissance de sortie max » passait à la ligne dans les 295 px du panneau et déformait la rangée ; il
est dans l'infobulle). Le second à `0` affiche un tiret : « 0 W » affirmerait qu'aucun onduleur ne
sort rien.

**Saisie des champs numériques** : le contenu se SÉLECTIONNE à la prise de focus, dans cette carte
comme dans le mode « Déplacer » (`PlacementControl.vue`). Avant, cliquer dans un champ à 450 et taper
500 donnait 450500, borné ensuite à la limite haute. Deux pièges à connaître pour le refaire ailleurs,
détaillés dans [pièges outillage](../6_faq/6_0_pieges-outillage.md).


### Mise à jour 2026-09-13 — carte Tesla des Réglages et vue Véhicules enrichie

**Carte « Tesla »** (`TeslaLinkCard.vue`, Réglages → Plugins, sous la carte Enphase) : la mise en
route de la Fleet API en **trois pas toujours rendus**, chacun coché quand il est fait (un pas fait
n'est pas retiré, l'utilisateur qui revient voit où il en est) :
1. la **clé publique** de l'application, dans un bloc monospace à hauteur fixe (`user-select: all`,
   bouton « Copier la clé »), et l'URL exacte où la poser sur son domaine ;
2. « Enregistrer le domaine », avec le verdict de Tesla (clé lue et reconnue, lue mais pas la nôtre,
   pas encore vérifié) ;
3. « Lier le compte Tesla » (consentement dans un onglet, « Actualiser » ensuite).

Sous les pas : la dernière erreur, le budget du jour (« n/limite lectures aujourd'hui · une lecture
toutes les 10 min quand un véhicule est éveillé, jamais de réveil automatique »), et l'avertissement
si aucun fichier de jetons n'est configuré. Sans identifiants, un seul paragraphe dit quoi créer sur
developer.tesla.com. **Masquée pour un plugin éteint** : `/api/health` liste aussi les plugins
`disabled`, et un fabricant non coché n'a pas à réclamer ses clés.

**Vue Véhicules** (`VehiclesView.vue`) : en tête de carte, une **pastille de veille** (soleil
« Éveillé », lune « En veille » / « Hors ligne », « — » si le plugin ne la connaît pas). La grille
d'état passe à quatre cases : État, Charge, **Mouvement** (« En route · 83 km/h », « Garé », « — »),
**Températures** (« 21,5 °C · 17,0 °C »). Une carte **Pneus** à quatre cases fixes (AV G, AV D, AR G,
AR D) ; une roue non mesurée affiche « — » sans déplacer les autres. Le kilométrage rejoint la ligne
de position. Les boutons suivent les **capacités** du descripteur (`lock`, `charging`) : le plugin
Tesla, en lecture seule, ne déclare ni l'un ni l'autre et n'a donc ni « Déverrouiller » ni « Lancer
la charge ». « **Réveiller** » n'apparaît que quand le véhicule dort, avec son explication (les
valeurs sont les dernières connues, le réveil est facturé). Vérifié sur la simulation à 800 px et à
375 px : la carte tient dans son plancher de 320 px déjà en place (`minmax(320px, 1fr)`), la page ne
défile pas horizontalement.


### Mise à jour 2026-09-13 (soir) — carte Tesla : inventaire plutôt que /api/health, et « — » pour un véhicule jamais lu

La carte Tesla lit maintenant la santé du plugin dans `stores/plugins` (l'inventaire que
l'interrupteur met à jour dans la même réponse) : elle apparaît dès qu'on allume le plugin, sans
recharger la page (piège détaillé dans `../6_faq/6_1_pieges-runtime.md`). Elle gagne « Générer une
nouvelle clé » (deux temps, proposé seulement quand Tesla refuse l'enregistrement) et distingue,
dans son message d'erreur, un domaine pris par une autre application d'une clé prise.

Vue Véhicules : un véhicule découvert ENDORMI n'a livré que sa veille, et son état porte les défauts
du contrat (`soc: 0`, `rangeKm: 0`). Les afficher se lisait « batterie vide » ; la carte montre « — »
tant qu'aucune lecture n'a eu lieu (`unread` : 0 %, 0 km, ni kilométrage ni position). Un vrai 0 %
aurait au moins un kilométrage. Le bouton « Réveiller » est alors le geste qui remplit la carte.


### Mise à jour 2026-09-14 — vue Véhicules : « Lu il y a 12 min » et « Actualiser »

Sous les actions de chaque carte, une ligne TOUJOURS présente date les valeurs (`readAt` →
`formatAgo`, « Lu il y a 12 min », « Lu maintenant », « Jamais lu »), suivie de l'explication de la
veille quand le véhicule dort. Elle vieillit d'elle-même (horloge de la vue, 30 s). Le bouton
« Actualiser » (icône `rotateRight`, grisé pendant la commande via `devices.isPending`) envoie
`vehicle.refresh` et n'apparaît que véhicule éveillé ; endormi, c'est « Réveiller ». Vérifié sur la
simulation : la voiture en route montre « Actualiser · Lu maintenant », celle endormie « Réveiller ».


### Mise à jour 2026-09-14 — la carte du véhicule : plan, satellite, plein écran

La ligne « Carte — position du véhicule » de la vue Véhicules devient une vraie carte
(`components/vehicles/VehicleMap.vue`, 220 px de haut dans la carte du véhicule). Le choix
technique, fait avec l'utilisateur (« un bon niveau de zoom, le satellite, le tout gratuit ») :
**un assemblage entièrement libre, sans compte ni clé** — voir `../3_plugins/3_8_tesla.md` pour
les alternatives écartées (Google exige une carte bancaire depuis mars 2025).

- **Moteur : MapLibre GL JS** (rendu vectoriel WebGL) : zoom continu, rotation, inclinaison, boutons
  natifs de zoom et boussole à gauche.
- **Plan : OpenFreeMap** (tuiles vectorielles OpenStreetMap, gratuit, sans clé), style `liberty` en
  thème clair et `dark` en thème sombre — la carte suit le thème de l'app.
- **Satellite : orthophotos de l'IGN** par la Géoplateforme (WMTS, grille Web Mercator, 20 cm par
  pixel, sans clé). **France seulement**, sans repli mondial pour l'instant (choix de l'utilisateur).
- Marqueurs DOM : la **voiture** en flèche tournée selon son **cap** (`headingDeg`, nouveau dans le
  contrat, Tesla le donne), la **maison** à l'origine GPS de `house.json`. Ils survivent au
  changement de style.
- Cadrage (`lib/map.ts`, `initialView`, testé) : voiture à moins de 3 km de la maison → les deux
  dans le cadre (on voit où elle est PAR RAPPORT à chez soi) ; plus loin → la voiture seule au zoom
  du quartier ; sans position → la maison. Dès que l'utilisateur bouge la carte, elle ne se recadre
  plus sous ses doigts ; un bouton « Recentrer » apparaît.
- Boutons à droite : **Plan / Satellite** (choix gardé dans `localStorage`, `kasbah.mapMode`),
  **plein écran** (état du composant en position fixe, pas l'API Fullscreen du navigateur : l'app a
  déjà la sienne, iOS ne l'offre pas aux éléments, et le même canvas suit d'un simple `resize`),
  Échap pour sortir. La légende (distance, kilométrage) est une pilule posée sur la carte.
- Règle « rien ne bouge » : la carte a toujours sa hauteur ; sans position, un voile « Position
  inconnue » la recouvre, la maison reste visible dessous.

Vérifié sur la simulation (thèmes clair et sombre, plan et satellite, plein écran et retour). Deux
pièges d'outillage rencontrés, détaillés dans `../6_faq/6_0_pieges-outillage.md` : le worker de
MapLibre égaré par le pré-empaquetage de Vite, et un `Marker` ajouté avant d'avoir une position.


### Mise à jour 2026-09-14 — « Réveiller » montre que la demande est en cours

Demande de l'utilisateur : « quand on clique sur Réveiller, indiquer que la demande est en cours ».

Le spinner (`v-progress-circular`, 16 px, comme dans `DevicePanel.vue`) prend **la place de l'icône**,
à taille égale : le libellé ne change pas et le bouton garde sa largeur — vérifié au
`getBoundingClientRect()`, 113 px au repos comme en attente. C'est aussi ce qui a fait retirer le
« Actualisation… » introduit la veille sur le bouton « Actualiser » : changer le libellé élargissait
le bouton de 11 px, et la règle de la maison est que rien ne bouge. Le spinner n'a pas de prop
`color` : il hérite de `currentColor`, donc du texte du bouton, dans les deux thèmes.

**Ce qui dure, et jusqu'à quand.** `devices.isPending` ne couvre que l'aller-retour avec le serveur —
une seconde, là où la voiture met une dizaine de secondes à ouvrir les yeux (le plugin la relit 15 s
après, cf. `../3_plugins/3_8_tesla.md`). S'y fier laisserait le bouton redevenir inerte alors que rien
n'a changé à l'écran. La vue tient donc son propre registre `waking` (par id d'appareil), levé :

- dès que le véhicule se déclare **éveillé** (`sleepState === 'online'`, un `watch` sur la liste) ;
- si la demande est **refusée**, tout de suite ;
- au bout de **90 s** sinon, pour ne pas bloquer le bouton sur une voiture hors de portée.

Pendant ce temps le bouton est `disabled` (un réveil coûte dix lectures chez Tesla, il ne se rejoue
pas par inadvertance) et porte `aria-busy`. Un bouton qui ATTEND n'étant pas un bouton indisponible,
son opacité passe de 0,45 à 0,7 : sinon le spinner, qui porte toute l'information, était à peine
visible. Testé dans `apps/web/src/views/VehiclesView.test.ts` (la carte est bouchonnée, MapLibre
demandant WebGL) : l'indicateur tient APRÈS l'acquittement de la commande, s'efface quand le véhicule
passe éveillé, et revient tout de suite si la demande échoue.

Piège de vérification : la **simulation réveille instantanément** (son `apply` pose `sleepState:
'online'`), donc l'indicateur y passe en un éclair — ce qui ne dit rien de la vraie voiture. Le rendu
a été observé en forçant `waking` dans l'instance du composant, et l'enchaînement par le test.


### Mise à jour 2026-09-14 — attribution de la carte repliée, et jauge de quota au bas de la carte véhicule

**Attribution.** MapLibre DÉPLIE les mentions une demi-seconde après le montage, même en mode
`compact` : 300 px de large sur une carte de 320, par-dessus la légende (c'est ce que l'utilisateur a
signalé). Elle est désormais **repliée par défaut** : il ne reste que le ⓘ au coin bas droit, habillé
comme les autres boutons (fond `--surface`, pastille ronde, ombre), et un tap l'ouvre en panneau
lisible borné à la largeur de la carte. L'icône de MapLibre étant une image sombre, elle est inversée
en thème sombre. La légende (distance, kilométrage) s'arrête avant le ⓘ pour ne plus le recouvrir.
Le piège qui se cache derrière ce repli est dans `../6_faq/6_0_pieges-outillage.md`.

**Jauge de quota.** Au bas de la carte du véhicule — pas de la minimap : la place a été choisie avec
l'utilisateur — une ligne « 3,42 $/10,00 $ de crédit Tesla · depuis le 13 sept. » et un trait de 4 px
qui se remplit. Ce qui est jaugé est le **crédit MENSUEL du fabricant** (10 $ par compte, cycle
calendaire), pas le budget journalier que le plugin s'impose : c'est ce crédit qu'on ne veut pas
dépasser. Elle vient de `PluginHealth.quota` (`../3_plugins/3_2_ecrire-un-plugin.md`), où le plugin dit
CE qu'il compte (`labelKey`), dans quelle unité (`unit: 'usd'`) et depuis quand (`since`) ; la vue ne
fait que mettre en forme, dans la langue et le format du navigateur (`Intl.NumberFormat`,
`currencyDisplay: 'narrowSymbol'` pour « 3,42 $ » et non « 3,42 $US »). Rien ne s'affiche pour un
plugin qui ne compte pas, la simulation par exemple. Même langage visuel que la jauge de charge en
tête de carte, en plus discret ; au-delà de 80 % elle passe à l'orangé des avertissements des cartes
de Réglages. La santé des plugins n'étant ni poussée ni sondée, la vue la redemande (requête locale)
en arrivant, à chaque battement d'horloge de 30 s, et après chaque commande — un réveil ou une
relecture consomme le crédit, la jauge doit suivre.

Deux retouches demandées après coup sur l'attribution : le ⓘ de MapLibre est calé **en haut à gauche**
de son bouton par défaut (`background-position` implicite), donc décentré dès qu'on change la taille
du bouton ou de l'image — il faut le centrer explicitement. Et le panneau déplié **monte d'une ligne**
(`margin-bottom: 44px` quand la carte porte une légende) : il passait sinon devant ou derrière la
pilule de distance, qui occupe le même coin.


### Mise à jour 2026-09-14 — renommer un véhicule, et la pastille qui n'a pas lieu d'être

**Renommage depuis la carte véhicule.** Une voiture n'est pas placée dans la scène 3D : elle n'a donc
aucun panneau de placement où la renommer, et le geste devait vivre sur sa propre carte. Un **crayon
discret** à côté du nom bascule le titre en champ de saisie — **dans la même boîte**, avec la même
police et la même graisse, pour que rien ne se décale. Entrée valide, Échap annule, sortir du champ
valide aussi ; vider le champ efface le nom choisi et rend la main au fabricant.

Le nom affiché est `house.devices[].name` quand il existe, sinon celui du descripteur de plugin
(`displayName()`). Sans cette règle, renommer écrivait dans la maison **sans que rien ne change à
l'écran** : la vue lisait `descriptor.name`, le nom du fabricant. Le trou n'est apparu qu'en
essayant pour de vrai.

Deux pièges relevés au passage, valables au-delà de cette vue :

- **Un `ref` nommé DANS un `v-for` rend un TABLEAU** (Vue 3). `renameInput.value?.select()` ne
  faisait donc rien, et la saisie s'AJOUTAIT au nom au lieu de le remplacer. Le `v-if` ne laissant
  qu'un champ monté à la fois, une **ref de fonction** le capte sans ambiguïté.
- Un champ de saisie qui remplace un titre doit hériter `font: inherit` **et** `font-weight` : sinon
  la ligne change de hauteur au clic, et toute la carte descend.

**La pastille de veille disparaît** quand le véhicule n'a pas de `sleepState` (Renault n'a pas cette
notion). Un soleil suivi d'un « — » se lirait « éveillée : inconnu ». Ce n'est pas une entorse à la
règle « rien ne bouge » : l'absence est une propriété STABLE du plugin, pas un état qui clignote —
la pastille est toujours là pour une Tesla, jamais pour une Renault.

Sources : `apps/web/src/views/VehiclesView.vue`, `apps/web/src/stores/house.ts` (`renameDevice`),
`apps/web/src/lib/strokeIcons.ts` (icône `pencil`).


### Mise à jour 2026-09-14 (bis) — la carte passe au satellite, avec les noms

**Satellite par défaut** dans les mini-cartes de la vue Véhicules : reconnaître son allée, son
parking ou le bâtiment devant lequel la voiture est garée se fait d'un coup d'œil sur la photo, pas
sur un plan.

**Les étiquettes du plan sont posées PAR-DESSUS la photo** (`satelliteStyleWithLabels`,
`apps/web/src/lib/map.ts`) : on reprend le style vectoriel d'OpenFreeMap et on n'en garde que les
couches `symbol` — ce sont exactement les libellés (villes, rues, eaux), et rien de leur géométrie ne
vient masquer l'orthophoto. `sources`, `glyphs` et `sprite` suivent, sans quoi aucune étiquette ne se
dessine. Le style est récupéré à l'exécution et mis en cache par thème ; à défaut (réseau, service
indisponible), la photo NUE est posée quand même.

Les couleurs du plan sont calculées pour un fond uni : sur une orthophoto — champs, toitures, arbres,
ombres — elles se noient. Les libellés reçoivent donc un traitement **imposé et indépendant du
thème** : texte blanc, contour noir franc (`labelOverImagery`).

Deux corrections trouvées en vérifiant :

- **Le défaut ne s'appliquait jamais.** Le watcher écrivait le mode dans `localStorage` à chaque
  changement de THÈME, rangeant comme « choix de l'utilisateur » un mode qu'il n'avait jamais touché.
  Le choix n'est désormais écrit que lorsque le mode change, et la clé a changé de nom
  (`kasbah.mapMode.v2`) pour ignorer les valeurs parasites déjà stockées.
- **« En charge · 0 W »** sur un véhicule dont le fabricant ne donne pas la puissance (Renault n'a
  pas ce champ) : `0 W` se lit « branchée mais rien ne passe », soit le contraire de ce qui se passe.
  C'est « En charge » tout court quand la puissance est inconnue.


### Mise à jour 2026-09-14 — carte véhicule : la charge en détail, les limites en repères, les réglages repliés

Cinq changements sur la carte d'un véhicule (vue Véhicules), tous nés de l'usage réel de
véhicules.

**« Actualiser » ne cède plus la place à « Réveiller ».** Les deux boutons coexistent quand la
voiture dort : relire ne la réveille pas (le plugin s'arrête à la liste), et c'est précisément ainsi
qu'on constate qu'elle s'est réveillée toute seule. « Actualiser » reste même **cliquable pendant un
réveil** — il ne suit que `devices.isPending`, pas l'attente de réveil : c'est le moment où l'on veut
demander « alors, tu es réveillée ? ».

**La case « En charge » devient « Charge ».** Le titre nommait une des valeurs possibles ; la case
porte l'état du câble (« Débranché », « Branché », « En charge »).

**Une ligne de détail sous la jauge**, à place **toujours réservée** (16 px, mesurés) et sans retour
à la ligne : `7,4 kW · fin dans 1 h 20 · cible 80 %`. Chaque morceau est facultatif — aucun fabricant
ne les donne tous. La puissance a quitté la case Charge pour ne pas être dite deux fois — la note
« En charge · 0 W » plus haut dans cette page reste vraie sur le fond (on n'invente pas un zéro),
mais elle décrit un emplacement qui n'existe plus. Quand le
véhicule ne donne pas sa puissance, elle est **estimée** et se présente comme telle : `~4,4 kW
estimé` (cf. `../1_architecture/1_1_contrat-appareils.md`).

**Des repères sur la jauge**, cible et plancher (`chargeLimit`, `socMin`), avec leur infobulle. Ils
reprennent la géométrie du trait de **position favorite d'un ouvrant** (`.cover-slider` dans
`app.css`) — 3 px, arrondi 2 px, `rgb(var(--v-theme-warning))` — en plus court (14 px) et **par
dessus** la jauge : il n'y a pas de pouce pour les cacher. L'`overflow: hidden` de la barre est
tombé pour qu'ils débordent ; il ne servait à rien, le remplissage porte déjà son propre arrondi.

**Un dépliant « Régler »** (⚙, un seul ouvert à la fois) pour ce que seul l'utilisateur peut
savoir : le **décalage 3D** (X / Y en mètres) et la **capacité de la batterie** (kWh). Les deux
vivent dans la maison, pas dans l'état, et se rangent derrière un pli parce qu'on les pose une fois.
Chaque ligne n'apparaît que si elle sert :

| | Décalage | Capacité | Bouton « Régler » |
|---|---|---|---|
| voiture placée à la main, qui dit sa puissance | — | — | **absent** |
| voiture placée à la main, muette sur sa puissance | — | oui | présent |
| voiture posée par son GPS, muette | oui | oui | présent |

Un dépliant vide ne peut donc pas exister. Un champ vidé ou mis à 0 **efface** le réglage.

Sources : `apps/web/src/views/VehiclesView.vue`, `apps/web/src/stores/house.ts`
(`setDeviceTuning`), `apps/web/src/lib/format.ts` (`formatMinutes`), `apps/web/src/styles/app.css`,
test `apps/web/src/views/VehiclesView.test.ts`.

### Mise à jour 2026-09-14 (bis) — régler la limite de charge : paliers ET pour cent

La cible de charge n'était que **montrée** (un repère sur la jauge, une mention dans la ligne de
détail). Elle se **règle** maintenant, sur la carte de la vue Véhicules comme dans le panneau d'un
véhicule sélectionné dans la 3D, dès que le descripteur déclare la capacité `charge_limit` — donc
jamais pour un plugin qui ne l'honorerait pas.

**Deux gestes pour une seule valeur**, parce qu'ils ne servent pas le même moment :

- **six paliers** (50, 60, 70, 80, 90, 100) en grille de six colonnes égales, hauteur fixe : on les
  touche sans viser, et 80 % est le réglage de tous les jours ;
- **un curseur au pas de 1 %** juste en dessous, pour qui veut 73. Aucun palier n'est alors allumé —
  la valeur exacte est écrite en tête de bloc.

**Rien ne bouge** (mesuré au `getBoundingClientRect` à 50, 73, 80 et 100 % : carte 982 px, rangée de
paliers au même x et à la même largeur). Les deux règles habituelles s'appliquent : la valeur est
**tenue en local pendant le geste** (`dragged`, sinon le curseur reviendrait en arrière à chaque
image) et rendue à l'état dès la commande finie — acceptée, l'état porte la cible ; refusée, il a
repris l'ancienne.

**Grisé plutôt qu'absent** quand le véhicule dort ou est indisponible : la carte garde sa hauteur,
et l'infobulle renvoie au bouton « Réveiller » (une Tesla endormie répond 408 à une commande, cf.
`../3_plugins/3_8_tesla.md`).

Un piège Vuetify dans le panneau : un `v-btn` a 32 px de marge intérieure et une largeur plancher,
et six boutons **débordaient** le panneau (dernier palier coupé à « 10 »). C'est `px-0` + `min-width="0"`
qui les laisse se serrer — mesuré, le dernier bord passe de 1306 px à 1258 px pour un panneau qui
s'arrête à 1280.

Sources : `apps/web/src/views/VehiclesView.vue`,
`apps/web/src/components/controls/VehicleCard.vue`, `apps/web/src/lib/optimistic.ts`.

### Mise à jour 2026-09-14 (ter) — la rotation d'un véhicule, et les réglages descendus dans le panneau

**Une ligne « Rotation (°) » dans « Régler »**, sous le décalage 3D et aux mêmes conditions (voiture
posée par son GPS). Pas de 15°, valeur libre au clavier : c'est une correction du cap DÉDUIT, pas un
cap absolu (cf. `../1_architecture/1_5_scene-3d.md`). Un angle hors bornes est ramené dans
`[-180, 180[` avant l'envoi — 200° devient -160°, le contrat n'a rien à refuser.

**La section est descendue dans le panneau de l'appareil**, au fond, là où un appareil posé porte son
bloc « Emplacement » (`margin-top: auto`). C'est le point de la demande : régler le décalage en
voyant la voiture bouger dans la scène, plutôt qu'à l'aveugle depuis la vue Véhicules. Vérifié dans
l'app — rotation 90° saisie, la R5 pivote sur place, la sélection et le cadrage tiennent ; X = 4, elle
glisse de 4 m.

Les deux surfaces partagent donc un composant, `components/vehicles/VehicleTuning.vue` (même markup,
même CSS, mêmes écritures), et les deux règles qui décident de l'afficher vivent dans
`lib/vehicleTuning.ts` — le bouton « Régler » de la vue et la section du panneau ne peuvent plus
diverger. Sans rien à régler (voiture placée à la main ET qui dit sa puissance de charge), ni bouton
ni carte : pas de bloc vide au fond du panneau.

**Les repères de la jauge, aussi dans le panneau.** Le plancher voulu (`socMin`) et la cible de
charge (`chargeLimit`) sont désormais tracés par-dessus la barre de `VehicleCard`, comme sur la carte
de la vue Véhicules : traits ambrés de 16 px sur une barre de 10, infobulles « Plancher voulu 20 % » /
« Cible de charge 80 % ». Deux différences assumées :

- **rien n'est inventé** — Tesla n'a pas de plancher, elle n'a qu'un repère ; un véhicule qui ne dit
  ni l'un ni l'autre n'en a aucun (le `?? 80` du curseur ne doit pas se dessiner sur la jauge) ;
- **le repère de cible suit le réglage EN COURS** (`limit`, donc la valeur tenue pendant le geste) et
  non l'état : le curseur est juste en dessous, le trait l'accompagne sans attendre la voiture.

Sources : `apps/web/src/components/vehicles/VehicleTuning.vue`, `apps/web/src/lib/vehicleTuning.ts`,
`apps/web/src/components/home/DevicePanel.vue`, `apps/web/src/components/controls/VehicleCard.vue`,
`apps/web/src/views/VehiclesView.vue`, tests `VehicleCard.test.ts` et `VehiclesView.test.ts`.


### Mise à jour 2026-09-14 — le curseur de pièce dit son pourcentage

« Sur ce genre de slider lumière pièce j'aimerais pouvoir visualiser le %, je ne sais pas où placer
le curseur pour obtenir 50 % par exemple. » Le curseur de luminosité de pièce (2026-09-12, plus haut)
montrait bien la moyenne par la position de sa poignée, mais aucun chiffre : viser une valeur ronde
se faisait à l'œil.

**La valeur est écrite au bout de la piste**, dans le slot `#append` du `v-slider` — donc sur la même
ligne, pas de légende au-dessus qui aurait ajouté une ligne à un panneau déjà dense. Elle affiche
`shown`, la valeur que le curseur porte déjà : la **moyenne** des lampes allumées au repos, et le
**brouillon suivi en direct pendant le glissement** (`draft`), puisque c'est là qu'on en a besoin.

**Largeur FIXE et chiffres tabulaires** (`min-width: 5ch`, `font-variant-numeric: tabular-nums`,
`4_0_langage-visuel.md`) : sans cela, passer de « 9 % » à « 10 % » aurait raccourci la piste et fait
glisser la poignée sous le doigt. Mesuré dans l'app : piste de 261 px identique pour « 1 % », « 16 % »
et « 100 % », aux zooms 100 / 125 / 150 %, sans troncature. `min-width` plutôt que `width` justement
pour le gros zoom.

Pièce éteinte, le chiffre disparaît avec le curseur : il est dans le même conteneur que
`.room-bright--off` porte en `visibility: hidden`, donc la place reste réservée et rien ne remonte.

Le choix du **permanent** plutôt que de la bulle Vuetify (`thumb-label`, visible seulement pendant le
geste) : la bulle ne raccourcit pas la piste, mais ne répond pas à « à combien est la pièce, là ? ».

Sources : `apps/web/src/components/devices/RoomBrightness.vue`, test `RoomBrightness.test.ts`
(« writes the value next to the slider, and follows the drag »).

### Mise à jour 2026-09-15 — les tuiles d'énergie reviennent, et chaque voiture a la sienne

« Dans le panneau de droite on pourrait ajouter des pilules pour l'énergie et les voitures. » La
décision du 2026-09-11 (caméras et lecteurs **à la place** de solaire et batterie, plus haut) se
disait provisoire : elle l'était. Les tuiles d'énergie reviennent — sans reprendre la place des
deux autres, cette fois — et les véhicules en gagnent.

La grille du `HomePanel` porte donc, dans cet ordre :

| Tuile | Valeur | Condition |
|---|---|---|
| lumières allumées | `n` | au moins une lampe |
| volets ouverts / stores baissés | `x/y` | au moins un ouvrant de cette nature à position connue |
| caméras | `n` | au moins une caméra |
| lecteurs | `x/y` en diffusion | au moins un lecteur |
| **solaire** | production instantanée (`formatPower`) | un site d'énergie existe |
| **batterie** | charge du site (`formatPercent`) | le site déclare un `batterySoc` |
| **une par véhicule** | charge de la voiture | pour chaque `vehicle` connu |

Quatre décisions :

- **une tuile PAR voiture**, étiquetée de son nom (celui de la maison s'il a été choisi, sinon celui
  du fabricant), plutôt qu'un « 1/2 en charge ». Deux voitures ne se résument pas en un chiffre, et
  ce qu'on vient regarder est la charge de CELLE qu'on va prendre ;
- **un véhicule jamais lu affiche « — »**, pas « 0 % ». Une voiture découverte endormie porte les
  défauts du contrat (0 %, 0 km, ni compteur ni position) : même garde que la vue Véhicules
  (`unreadVehicle`, plus haut dans cette page) — vérifié sur la R5, qui s'annonce ainsi ;
- **le plafond de la grille passe de 6 à 10.** À 6, la dernière voiture disparaissait dès que la
  maison avait ses cinq compteurs et ses deux tuiles d'énergie. C'est la seule raison du changement :
  la grille reste à deux colonnes, les tuiles passent à la ligne ;
- **chaque tuile a une `key` explicite** (l'identifiant de l'appareil pour une voiture) : la clé
  était le libellé, et deux voitures homonymes se seraient télescopées.

Côté i18n, `home.battery` — supprimée le 2026-09-11 — revient, accompagnée de `home.solarNow`
(« solaire » en minuscule, comme les autres étiquettes de tuile) ; `home.solar` reste capitalisée,
la vue Énergie s'en sert comme légende de son anneau.

Les tuiles restent **décoratives** : ni bouton ni lien vers les vues Énergie et Véhicules. Choix de
l'utilisateur, et changement minimal — les quatre tuiles existantes n'ont pas bougé.

Mesuré dans l'app (panneau ancré 1440 × 900 et tiroir 834 × 1112, thèmes clair et sombre) : les sept
tuiles de la maison simulée font toutes 84 px de haut, aucune valeur ni étiquette ne déborde de sa
tuile. La règle « rien ne doit bouger » (`4_0_langage-visuel.md`) tient donc quand la production ou
une charge change.

Sources : `apps/web/src/components/home/HomePanel.vue`,
`apps/web/src/composables/useHomeSummary.ts` (qui exposait déjà `energy`, `vehicles` et `chargers`),
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-15 (bis) — l'apparence d'un véhicule se règle dans « Régler »

`VehicleTuning` gagne trois lignes, à côté du décalage, de la rotation et de la capacité :
**Carrosserie 3D**, **Peinture** et **Couleur**. Même doctrine que le reste de la carte — ce que
seul l'utilisateur peut savoir vit dans la MAISON, pas dans l'état — et les deux surfaces qui
affichent déjà ce panneau (carte de la vue Véhicules, panneau de l'appareil sélectionné) en
héritent sans rien de plus.

- **Carrosserie 3D** ne propose que les modèles du plugin de CE véhicule — on ne gare pas une
  Model S dans le garage d'une R5 —, à défaut ceux de sa marque, plus « Silhouette » pour revenir
  au repère d'encombrement. Les trois lignes disparaissent quand aucune carrosserie ne correspond.
- **Peinture** reprend le vocabulaire de la voiture elle-même : Unie / Métallique / Mate.
- **Couleur** s'ouvre sur ce qui est PEINT aujourd'hui — le choix manuel, sinon la teinte que le
  plugin a déduite —, pas sur un gris arbitraire.

**Peinture et couleur SURCHARGENT le fabricant : les deux portent donc une croix**, et elle ne
paraît que s'il y a un choix manuel à effacer — sinon elle promettrait d'annuler quelque chose qui
n'existe pas. L'effacer rend la main à ce que le plugin a déduit, **pas** à un défaut arbitraire :
d'où les libellés « Effacer la couleur choisie » et « Effacer la peinture choisie », et non
« couleur du thème ». Le select de peinture montre lui aussi ce qui est peint, d'où que ça vienne ;
y choisir explicitement la valeur du fabricant est un geste utile — ça la FIGE, et la voiture cesse
de suivre l'écran de bord.

`tunableVehicle` s'élargit en conséquence : la carrosserie se choisit pour TOUT véhicule dont le
plugin en livre une, placé à la main ou non — c'est un choix d'apparence, sans rapport avec la
façon dont la voiture trouve sa place. Une voiture posée à la main qui dit sa puissance de charge
garde donc son bouton « Régler », là où elle le perdait.

Sources : `apps/web/src/components/vehicles/VehicleTuning.vue`, `apps/web/src/lib/vehicleTuning.ts`,
`apps/web/src/views/VehiclesView.test.ts`.

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

### Mise à jour 2026-09-15 (ter) — carte « Rendu 3D » des Réglages

Sous le bloc « Thème », dans la colonne de gauche, une carte qui rassemble ce qui décide de
l'apparence de la SCÈNE (et non de l'interface) :

- une **grille de tuiles de style** (même gabarit que les tuiles de thème : aperçu, nom, bordure
  d'accent sur la tuile active). L'aperçu est rendu avec les couleurs du style **à l'heure choisie** —
  ciel en fond, sol en bas, un pan de mur posé dessus, une pastille de la couleur du verre. Un style de
  nuit ne se juge pas sur sa palette de midi : changer l'ambiance redessine donc les quatre tuiles.
- un **segmenté « Heure de la maison »** (Automatique / Jour / Crépuscule / Nuit) et sa ligne
  d'explication : elle dit que le réglage est indépendant du thème clair/sombre et qu'« Automatique »
  suit le soleil réel d'après l'origine GPS ;
- un **segmenté « Qualité »** (Automatique / Haute / Moyenne / Basse) et sa ligne d'explication.

Le style s'applique EN DIRECT, sans rechargement : revenir sur la vue Maison montre la nouvelle
matière (vérifié en passant de Réaliste à Cyberpunk avec la maison de démo). Voir
`../1_architecture/1_5_scene-3d.md` pour ce que chacun des trois axes pilote, et
`4_2_theme-et-langues.md` pour les clés persistées.

Sources : `apps/web/src/views/SettingsView.vue`, `apps/web/src/stores/settings.ts`.

### Mise à jour 2026-09-16 — Réglages → Plugins : chaque fabricant tient dans SA section, dépliable

Constat de l'utilisateur : « le plugin renault affiche toujours son bloc "compte lié" alors que le
plugin est paramétré et fonctionne ». C'était structurel — les cartes de mise en route (Hue, Nest,
Enphase, Tesla, Renault) vivaient **au-dessus** de la liste et décidaient chacune de leur apparition.
Celle de Renault n'avait aucune condition de retrait : compte lié, elle restait là à l'annoncer.

La carte Plugins devient une liste de **sections** (`components/settings/PluginSection.vue`, une par
plugin de l'inventaire) :

- **En-tête toujours rendu**, empreinte fixe : chevron, nom, pastille d'état (+ « n appareils »),
  interrupteur. Le chevron reste dans le DOM même quand il n'y a rien à déplier (`visibility: hidden`) :
  les noms de tous les fabricants restent alignés, y compris ceux des squelettes.
- **Corps déplié** : le `detail` que renvoie le serveur — jamais affiché jusqu'ici, alors qu'il dit
  l'essentiel (« IQ Gateway D8.x · N onduleurs, N batteries », « gateway-1234-5678-9012.local
  (protocol 2026.3.3-7) ») —, puis la carte de mise en route du fabricant, les pastilles « Fournit »,
  puis les clés `.env`. Les clés quittent donc la ligne repliée, qui redevient lisible d'un coup d'œil.
- **Ouverture automatique** quand le serveur RÉCLAME quelque chose : `needs_pairing` et `error`,
  et seulement pour un plugin allumé. **Pas `degraded`** : un fabricant dégradé se plaint souvent sans
  rien demander (Cast qui attend un appareil éteint), et ouvrir sa section n'y changerait rien — arbitré
  avec l'utilisateur, au prix de ne plus ouvrir seuls Enphase « jeton qui expire » et Tesla « domaine
  non enregistré », qui sont `degraded` eux aussi.
- **L'utilisateur garde le dernier mot** : `manual: boolean | null`, `null` = on suit le serveur ; un
  clic fixe l'état dans les deux sens (fermer une section ouverte seule, ouvrir une section calme).
- `v-show` et non `v-if` sur le corps : les cartes interrogent leur fabricant au montage et retiennent
  où en est la mise en route (l'onglet de consentement ouvert, par exemple). Replier ne doit rien
  redemander.

Conséquence pour les cinq cartes : elles perdent leur condition d'apparition et leur titre propre (la
section porte déjà le nom), et gardent leur enveloppe `card--soft` comme bloc du corps. Deux d'entre
elles n'existaient qu'en `needs_pairing` et gagnent donc leur **état déjà lié**, avec de quoi refaire
la liaison — c'est le sens de la demande, « chaque section affiche ses propres infos/params (moyen de
lier, de délier…) » :

- **Hue** : « Le pont est apparié. » + « Réappairer le bridge » (à ne faire que si la clé est perdue,
  la nouvelle est à recopier dans `.env` : le texte le dit).
- **Nest** : « Compte Google lié. » + « Relier le compte à nouveau » (c'est le chemin pour changer les
  caméras partagées, le choix se fait dans l'écran de consentement Google).
- **Enphase** : en `stage: 'ok'`, la carte dit que la passerelle est appairée et qu'il n'y a rien à
  faire tant que le jeton vaut, au lieu de son texte d'introduction ; le formulaire de renouvellement
  reste sous la main.
- **Tesla** et **Renault** : contenu inchangé, ils cessent simplement de s'imposer.

Tests : `components/settings/PluginSection.test.ts` (6 cas — replié quand le fabricant va bien,
ouvert sur `needs_pairing` et `error`, fermé sur `degraded`, jamais ouvert pour un plugin éteint,
l'utilisateur a le dernier mot dans les deux sens, squelette inerte). Le panneau étant masqué par
`v-show`, l'assertion lit le `style` du corps : `isVisible()` de `@vue/test-utils` le rendait vrai.

Vérifié dans l'app (maison réelle, 13 plugins) : tout replié au chargement, plus rien au-dessus de la
liste ; noms alignés à 768 px ; aucun débordement introduit en 1280 / 768 / 375 px ni en thème clair
comme sombre — le dépassement horizontal des Réglages à 375 px préexiste et vient de la colonne de
gauche.

**i18n** : `settings.pluginDetails` (infobulle du chevron), `settings.hue.paired` / `.repair` /
`.repairHint`, `settings.nest.linked` / `.relink` / `.relinkHint`, `settings.enphase.paired`.
`settings.noKeys` est supprimée : la ligne des clés ne s'affiche plus que s'il y en a.

Sources : `apps/web/src/components/settings/PluginSection.vue`,
`apps/web/src/components/{Hue,Nest}*.vue`, `apps/web/src/components/{Enphase,Tesla,Renault}*.vue`,
`apps/web/src/views/SettingsView.vue`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-16 (bis) — la limite de charge montre TOUTE la batterie, et les paramètres d'un véhicule se replient

**La cible de charge, en un seul composant.** Le bloc vivait en double : écrit à la main dans
`VehiclesView.vue` (boutons et `<input type="range">` maison) et refait en Vuetify dans
`VehicleCard.vue` (`v-btn` + `v-slider`), avec deux allures pour un même réglage. Il devient
`components/vehicles/ChargeLimitCard.vue`, que les deux surfaces montent. Le parent garde la valeur :
`preview` pendant qu'on glisse (sans quoi le curseur reviendrait à la valeur du véhicule à chaque
image), `change` quand la commande peut partir.

**La piste va de 0 à 100 %.** Elle s'arrêtait à 50, et une cible de 50 % se lisait alors comme un
réservoir vide. Elle montre maintenant la batterie entière, avec :

- des **repères** à 50, 60, 70, 80 et 90 — 100 est la fin de la piste, un trait y serait à moitié
  rogné ;
- la part **0–50 voilée** (`.limit__dead`, la couleur de la carte à 62 %) : elle fait partie de la
  batterie, mais aucun constructeur ne l'accepte comme cible (Tesla annonce `charge_limit_soc_min`
  à 50) ;
- le pouce **borné à 50** : la valeur lue est repoussée à la borne et réécrite dans l'input, sinon
  l'élément restait sur le 20 qu'on venait de lâcher. Vrai au clavier comme à la souris.

La piste est **dessinée à part** (`.limit__track`, en retrait d'un demi-pouce de chaque côté) et le
pouce natif est le seul élément que l'input apporte : c'est la seule façon d'aligner exactement les
repères sur le centre du pouce, qui ne va pas jusqu'aux bords. Mesuré : piste = largeur de l'input
− 16 px (le pouce), repère 80 % à 285,6 px du bord gauche de la piste = centre du pouce.

**Les paramètres d'un véhicule se replient.** Dans le panneau de la vue Maison, `VehicleTuning`
s'étalait sous les commandes alors qu'on vient là pour piloter la voiture, pas pour la régler. Il
vit maintenant dans une carte à pied, sur le modèle d'« Emplacement » juste en dessous : « Paramètres »
à gauche, une pilule « Régler » / « Terminé » à droite, le corps au-dessus. Le pli se referme quand
on change d'appareil, et un véhicule qui n'a rien à régler (`tunableVehicle`) ne montre pas le bouton.
La carte intérieure perd son fond et ses marges (`:deep(.tune)`), sans quoi deux cartes se
superposaient.

**« Rétablir ».** Les champs s'écrivent au fil de la saisie, sans bouton « Enregistrer » : c'est un
retour en arrière qui tient lieu d'annulation, comme pour l'emplacement d'un appareil. Le bouton vit
en haut de la section, aligné à droite, **place réservée** (invisible tant qu'il n'y a rien à rendre,
la ligne ne bouge pas). Il rend les réglages tels qu'ils étaient à l'**ouverture** de la section —
le composant naît avec elle, les deux surfaces le montant en `v-if` — et un seul appel les rend tous
les six : `[0, 0]`, `0` et la chaîne vide EFFACENT, c'est ce que dit le contrat d'écriture
(`devicePlacementSchema`).

**i18n** : `vehicle.tuneTitle` (« Paramètres » / « Settings »). Le bouton reprend `vehicle.tune`
(« Régler ») et `place.done` (« Terminé »), et « Rétablir » reprend `place.revert`.

Vérifié dans l'app (maison démo, thèmes clair et sombre) : glisser sous 50 s'arrête à 50, 73 se
saisit au pour cent, le pli s'ouvre et se ferme, « Rétablir » rend la teinte et se re-masque.

Sources : `apps/web/src/components/vehicles/ChargeLimitCard.vue`,
`apps/web/src/components/vehicles/VehicleTuning.vue`,
`apps/web/src/components/controls/VehicleCard.vue`, `apps/web/src/views/VehiclesView.vue`,
`apps/web/src/components/home/DevicePanel.vue`, `apps/web/src/i18n/locales/{fr,en}.json`.

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

### Mise à jour 2026-09-16 — la vue Réglages en trois zones, les Ambiances rendues à leur plugin

Deux changements de fond dans `views/SettingsView.vue`, qui **remplacent** deux descriptions plus
haut dans cette page : la section « Vue Réglages » (colonne gauche / colonne droite) et, dans la
mise à jour du 2026-09-08, le placement des Ambiances en **carte séparée, une par plugin**. Les deux
restent lisibles comme état antérieur ; depuis le 2026-09-16, ce qui suit fait foi.

**1. Les réglages d'abord, les fabricants en dernier.** La page ne se lit plus en deux colonnes
figées mais en deux temps : tous les blocs de réglages en haut, puis la carte **Plugins en pleine
largeur** en fin de page — chaque ligne de plugin (nom, clés `.env`, statut, interrupteur) a enfin
la place de se déployer sans se serrer.

**2. Les Ambiances vivent chez leur plugin.** Le bloc a quitté la colonne des réglages pour le
panneau dépliable de `components/settings/PluginSection.vue`, sous la carte d'appairage : réglage
« Nouvelles ambiances animées » (`PATCH /api/plugins/:id/settings`), puis la liste complète avec sa
bascule par ambiance et sa suppression en deux temps. Le code lit `scenes.scenesByPlugin` et filtre
sur `props.plugin.id` : **générique**, pas câblé sur Hue — aujourd'hui seul Hue en produit, un futur fabricant à scènes héritera du même emplacement. La
présence d'ambiances rend la section dépliable (`expandable`).

*Conséquence assumée* : les ambiances ne sont plus visibles sans déplier la section du fabricant.
C'est l'écran de **gestion** ; le geste courant reste la pastille du panneau pièce (`SceneChips.vue`).

#### La disposition des réglages, et pourquoi elle a coûté quatre essais

La forme retenue tient en un croquis :

```
| Apparence | Rendu 3D                    | Plein écran |
| Langue    |   tuiles     | Matières     | Origine GPS |
| Thème     |              | Débogage     |             |
|           |   Heure de la maison (pleine largeur)     |
|           |   Qualité            (pleine largeur)     |
--------------------------------------------------------
| Plugins                              (largeur totale)  |
```

Quatre unités : une **pile** d'une unité, le Rendu 3D sur deux, une pile d'une unité. Des piles
(`.stack`, `display: grid; align-content: start`) et non des cellules de grille — une rangée de
grille s'aligne sur son plus grand élément, et le Rendu 3D (887 px à l'origine, contre 94 px pour
« Plein écran ») aurait creusé sa hauteur à côté de chaque petit bloc. Chaque pile coule à son
rythme ; la page ne fait que la hauteur de la plus haute des trois.

Les mesures des tentatives écartées, pour ne pas les refaire (toutes prises au
`getBoundingClientRect` dans l'app réelle, viewport 1280 sauf mention) :

| Tentative | Hauteur | Ce qui clochait |
|---|---|---|
| Grille `auto-fit minmax(320px, 1fr)` | 1318 px | rangées alignées : 800 px de vide à côté du Rendu 3D |
| Colonnes CSS `columns: 360px` | 887 px | dense à 1280, mais **4e colonne entièrement vide** à 1920 |
| Colonnes `2 340px`, Rendu 3D au milieu | 1131 px | la dernière colonne absorbe le reste : 683 d'un côté, 1131 de l'autre |
| Colonnes `2 340px`, Rendu 3D **en dernier** | 808 px | 92-98 % de remplissage, mais pas de bloc sur 2 unités |
| **Trois zones 1-2-1** (retenue) | 682 px | conforme au croquis, ratio mesuré 1 : 2.00 : 1 à 1920 |

Trois enseignements réutilisables ailleurs (repris en `../6_faq/6_0_pieges-outillage.md`) :
le **nombre de colonnes utile** d'un empilement vaut « hauteur totale ÷ hauteur du plus grand bloc »
(ici ~2 — au-delà il n'y a plus de quoi remplir) ; l'équilibrage de `columns` **suit l'ordre du DOM**
et la dernière colonne ramasse le reste ; et `column-span` ne connaît que `all`, jamais « deux ».

#### Le seuil de 1500 px n'est pas un chiffre rond

`grid-template-columns: 1fr 2fr 1fr` ne s'applique qu'à partir de **1500 px** ; en dessous, tout
s'empile sur une colonne — ce qui suffit à ces blocs. Le seuil est mesuré, pas choisi : une piste
`fr` ne descend jamais sous le min-content de ce qu'elle porte (`../6_faq/6_0_pieges-outillage.md`),
et la pile de gauche en réclame **344 px** (le segmenté Automatique / Français / English). Un quart
de la largeur doit donc valoir au moins ça. Sous ce seuil les pistes se déformaient en
**344 / 492 / 246** — plus rien de 1-2-1, et la colonne de droite à l'étroit.

Le plancher `auto` est **gardé volontairement** (pas de `minmax(0, …)`) : il garantit que la piste
centrale ne se serre jamais au point de couper les segmentés, et il encaisserait une traduction plus
longue en élargissant plutôt qu'en tronquant.

#### Le contenu du Rendu 3D, et ce qui refuse de tenir en demi-colonne

Le bloc se lit sur deux colonnes — les tuiles de style à gauche, les bascules « Matières en images »
et « Débogage » à droite — **sauf les deux segmentés**, qui reprennent toute la largeur du bloc
(`.render__full`, `grid-column: 1 / -1`). Mesuré : « Automatique / Jour / Crépuscule / Nuit » réclame
**~370 px** de min-content, une demi-colonne n'en offrait que ~280, et un premier jet les coupait net
au bord de la carte. Les deux passent aussi en `dense` (prop déjà prévue par `ui/Segmented.vue`), ce
qui desserre d'autant la contrainte de largeur minimale imposée à la piste centrale.

La bascule à deux colonnes est une **requête de conteneur** (`container-type: inline-size` sur le
bloc, `@container (min-width: 520px)`) et non une requête d'écran : ce qui décide est la largeur du
bloc, qu'il soit sur deux unités en grand écran (881 px à 1920) ou en pleine page sur une tablette
étroite (635 px). En dessous de 520 px il repasse à une colonne tout seul.

Enfin, les tuiles (`.themes`, partagées par Thème et Rendu 3D) passent en
`repeat(auto-fit, minmax(max(130px, (100% - 20px) / 3), 1fr))` : autant par rangée que la colonne en
porte, **jamais plus de trois**. Il y a six thèmes comme six styles — 3 + 3 se ferme, 5 + 1 laissait
une orpheline. Effet de bord utile : sur large écran les deux blocs à tuiles raccourcissent au lieu
de s'étaler, ce qui aide les zones à finir à niveau.

Vérifié sur la maison réelle, deux thèmes, de 500 à 1920 px : aucun débordement horizontal, aucun
segmenté ni curseur coupé, ratio 1 : 2.00 : 1 à 1920 et 1 : 1.96 : 0.98 à 1512. Débogage activé, la
page passe à 879 px (pastilles météo 631 px, deux curseurs) et revient à 682 px en le refermant.

Sources : `apps/web/src/views/SettingsView.vue`,
`apps/web/src/components/settings/PluginSection.vue`, `apps/web/src/components/ui/Segmented.vue`.

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


### Mise à jour 2026-09-18 — mode édition des ouvertures : un interrupteur dans Réglages, un panneau de cotes

**Où vit l'interrupteur, et pourquoi là.** « Régler les ouvertures » est une bascule de la carte
**Rendu 3D** des Réglages (`SettingsView.vue`, troisième interrupteur de la colonne de droite, après
« Matières en images » et « Débogage »), persistée en `kasbah.houseEditing` par le store `settings`
(clé non listée dans le tableau des préférences de `4_2_theme-et-langues.md`, daté du 2026-09-15).
Décision prise avec l'utilisateur, contre un bouton flottant dans la vue Maison : la
tablette est **posée à demeure dans la maison**, et un doigt qui glisse sur la maison ne doit pas pouvoir
déplacer une fenêtre. Le mode s'**arme** ailleurs, volontairement, et ne se désarme pas par accident.

Ce que l'armement change dans la vue Maison : les poignées d'ouverture apparaissent dans la scène
(`../1_architecture/1_5_scene-3d.md`), et le panneau de pièce gagne une section **« Ouvertures »**
(une ligne par ouverture, nature + cotes) qui disparaît quand on désarme.

**Le panneau d'ouverture** (`components/home/OpeningPanel.vue`, `panelMode = 'opening'`, quatrième
état après maison / pièce / appareil) : fil d'Ariane vers la pièce, **nature** (porte, fenêtre,
passage, porte de garage), trois cotes en `−` / champ / `+` (largeur, hauteur, hauteur d'allège),
un sous-titre qui dit la place — « Mur 3, à 2.50 m du coin » — et le texte d'aide qui renvoie au
geste, **« Ouvrant lié »**, **« Rétablir »**. Les champs se saisissent au clavier et **ne commitent
qu'à la validation**, comme `PlacementControl` ; les touches `−` / `+`, elles, écrivent tout de
suite. Les bornes viennent du partagé (`openingLimits`) : on ne propose pas une valeur que le serveur
refuserait. Libellés sous `opening.*` (fr/en) ; l'interrupteur sous `render.houseEditing`.

La liste « Ouvrant lié » est filtrée : **ouvrants de la maison, hors portail et porte de garage**
(`isPassageCover`) — ceux-là se posent librement et ne s'ancrent jamais à une ouverture. Pas de
filtre par pièce : la maison de démo n'a qu'un volet par pièce, la question ne s'est pas posée.

#### Le piège de mise en page, chiffré : quatre choix ne tiennent pas dans un `Segmented`

La première version mettait la nature dans un `Segmented`. La revue UI l'a mesuré : les quatre
libellés imposent un `min-content` de **393 px** dans une carte qui en fait **294** — et
« Porte de garage » ne se coupe pas. Comme `.opening` est une grille, **toutes** les rangées
s'alignent sur cette colonne :

- bord droit des rangées à x = 1514 pour un panneau qui finit à 1424 et une fenêtre de 1440 : la
  touche « Agrandir » est **entièrement hors écran**, « Ouvrant lié » et « Rétablir » sont coupés ;
- `--aside-w` valant 340 px **en dur**, le débordement est **inconditionnel** — identique à 1440,
  1152 et 960 px de large. Ce n'est pas un problème de petit écran ;
- pire, il casse la règle **« rien ne bouge »** par le geste le plus banal qui soit : un **Tab** vers
  le champ Largeur fait défiler `.side-panel__scroll` (pourtant en `overflow-x: hidden`) de
  **0 à 91 px** pour amener le champ en vue — tout le contenu du panneau part de 91 px à gauche, le
  titre devient « uverture », le fil d'Ariane sort du cadre.

**La sortie : un `v-select` à largeur fixe** (150 px, comme le niveau de `PlacementControl`), qui se
serre à la place qu'on lui donne au lieu d'imposer la sienne. Après : rangées à 266 px,
`clientWidth = scrollWidth = 294`, `scrollLeft` qui reste à 0 après 12 Tab, et un diff de
25 rectangles vide (`{}`) sur sept événements, y compris le passage de la nature à « Porte de
garage » et l'ouverture du menu déroulant.

**À retenir pour le prochain contrôle à quatre choix** dans un panneau ancré : un `Segmented`
n'admet pas de libellé long, il n'a aucun moyen de se rétracter, et le débordement se paie deux fois
— en contenu hors champ, et en défilement induit par le focus clavier.

Depuis **2026-09-20**, `Segmented` a `fill` (pleine largeur, `min-width: 0`) et `icon` (le texte
reste infobulle et nom accessible). Un filtre à **icônes** tient dans le panneau — mesuré 282 px
dans 328, aucun débordement, cinq catégories au Salon. Ça ne remplace pas le `v-select` des natures
d'ouverture : « Porte de garage » n'a pas d'icône qui la distingue d'une porte.

#### Trois garde-fous d'état, tous appris de la revue

- **Armé au chargement.** Le `watch` de `settings.houseEditing` ne doit **pas** être `immediate` :
  il tirerait pendant le `setup`, avant que `useHouseScene` n'ait construit la scène dans son
  `onMounted`, et l'appel serait un no-op. Mesuré avant correctif, après un vrai rechargement :
  `{ localStorage: "true", storeEditing: true, sceneEditing: false, handles: 0 }` — mode armé dans
  Réglages, **rien de cliquable dans la vue Maison**, c'est-à-dire le premier écran au redémarrage
  de l'écran. C'est le watcher de `scene.ready` qui rejoue l'état au bon moment (des poignées
  présentes après correctif, sur deux rechargements).
- **Désarmer ferme le réglage en cours.** Sinon la scène se nettoie (0 poignée) mais le panneau reste
  ouvert **et écrivant** : mode à `false`, un clic sur « Agrandir » passait encore la largeur de
  1,20 à 1,25 dans `house.json`. L'interrupteur ne fermait pas la porte qu'il prétend fermer.
- **Un tap sur un marqueur d'appareil ne vole plus la sélection** pendant un réglage d'ouverture.
  Le fond et les pièces avaient déjà leur garde (`house.selectedOpeningId`), pas `onDeviceTap` — et
  les marqueurs sont nombreux et gros autour des fenêtres (volets, capteurs) : l'accident était
  facile.

#### Ce qui reste, assumé

- La 3D **ne suit pas pendant la frappe** d'une cote, seulement à la validation (les `−` / `+`, eux,
  sont immédiats) : c'est le contrat des champs de panneaux, le brief demandait l'inverse.
- Les lignes de la liste « Ouvertures » sont libellées par la **seule nature** et les cotes : deux
  fenêtres identiques dans une même pièce donneraient deux lignes identiques, rien ne dit le mur.
- Passer du panneau de pièce au panneau d'ouverture laisse le cadre **au pixel**, mais l'en-tête
  passe de 123 à 116 px (deux en-têtes de structures différentes) — 7 px, seul écart résiduel relevé.

Sources : `apps/web/src/components/home/OpeningPanel.vue`, `apps/web/src/components/home/RoomPanel.vue`,
`apps/web/src/views/HomeView.vue`, `apps/web/src/views/SettingsView.vue`,
`apps/web/src/stores/settings.ts`, `apps/web/src/i18n/locales/{fr,en}.json`, revue UI et contre-visite
du 2026-09-18 (`_generated-ai-doc/sessions/2026-09-17-edition-ouvertures/revue-ui.md`).


### Mise à jour 2026-09-18 (2) — le panneau d'ouverture au complet, la liste de travail des ouvrants, et une fonte qui n'aligne pas ses chiffres

Quatre lots ont suivi la première ingestion. Le panneau décrit ci-dessus a changé sur plusieurs
points ; ce qui suit les **remplace**, il n'est pas utile de remonter.

#### Le panneau d'ouverture, tel qu'il est

| Ce qu'on y règle | Détail |
|---|---|
| **Nom** | éditable au crayon, **même idiome que `VehiclesView`** ; vide = effacer, et l'affichage retombe sur l'`id` de relevé (`openingLabel`). `maxlength=60` sur le champ : la borne existait côté schéma, pas côté UI, et le seul retour était un message brut de zod avec la saisie perdue |
| **Nature** | **six** entrées (porte, fenêtre, passage, porte de garage, **baie vitrée**, **porte vitrée**) dans un `v-select` — et non plus quatre dans un `Segmented`, cf. le piège de largeur ci-dessus |
| **Largeur / hauteur** | branchées sur `fitWidth` / `fitHeight` : on garde ce qui est tapé, on déplace ce qui peut l'être (`../2_maison/2_1_geometrie.md`) |
| **Hauteur d'allège** | bornée par `maxSill` |
| **Les deux cotes de position** | **gauche et droite, saisissables**, branchées sur `fitGap` — c'est le relevé au mètre ruban qu'on recopie, depuis le coin qu'on a mesuré ; l'autre cote suit |
| **Ouvrant lié** | filtre `canTakeOpening` (voir plus bas) |
| **Rétablir** | inchangé |

Huit rangées en tout. Le **sous-titre** est retombé à **« Mur N »** seul : les deux cotes vivent
maintenant dans le corps de la carte, il n'a plus à les répéter. `MIN_OPENING_DIM` est importé du
partagé, plus de constante locale.

**Changer de nature écrit aussi l'allège, dans la même requête** : `sill: 0` pour tout ce qui touche
le sol (porte, passage, porte de garage, baie, porte vitrée), parce qu'`openingSill` ne rend 0 par
défaut que si `sill` est **absent** du JSON — une fenêtre retypée en baie gardait sinon son muret de
20 cm (mesuré). `window`, seule à prendre une allège par défaut, ne devine rien. Un geste pour
l'utilisateur, une écriture.

#### Le piège de mise en page le plus utile de la session : `tabular-nums` ne fait RIEN ici

Le sous-titre a d'abord porté les deux cotes en toutes lettres (« Mur 1 · 0.00 m d'un côté, 4.40 m de
l'autre »). Il passait alors à **deux lignes selon les chiffres**, et toute la carte montait et
descendait de **17,5 px pendant le glissement** — dix fois par seconde. Deux causes, mesurées
séparément, et la première est un fait à connaître pour toute l'application :

**`font-variant-numeric: tabular-nums` n'a aucun effet sur DM Sans Variable.** La propriété est bien
appliquée (`getComputedStyle` le confirme), la fonte n'a simplement pas la fonctionnalité `tnum` —
et `font-feature-settings: "tnum"` n'y change rien non plus. Mesures au caractère, dans le sous-titre
de la carte :

| chiffre | largeur |
|---|---|
| « 0 » | **9,08 px** |
| « 1 » | **4,53 px** |

Un second relevé du même parcours, sur un autre élément, donne 8,22 / 3,75 px — les valeurs absolues
dépendent du contexte mesuré, **le rapport voisin de deux, lui, est constant**. D'où la règle
observée à l'œil nu : **un texte de cotes tient s'il contient un « 1 », il déborde sinon**.

C'est grave au-delà de ce panneau : **toute l'application s'appuie sur `tabular-nums` pour tenir la
règle « rien ne bouge »** (cf. `4_0_langage-visuel.md`), à commencer par `PlacementControl` et par
toute valeur numérique qui change sous l'œil. Le fait est **écrit ici parce qu'il a été mesuré ici** ;
son traitement (changer de fonte pour les chiffres, réserver la place en `ch`, ou assumer) est une
**tâche séparée**, non faite.

Seconde cause, banale mais instructive : le texte était à **2,4 px du bord** (230,56 px à poser dans
228,0), et le déclencheur était l'**ascenseur du panneau** — la largeur utile tombe de 238 à 228 px
quand il apparaît. Invisible à 1440 × 900, systématique à 1199 × 533 et 1440 × 520, c'est-à-dire sur
une **fenêtre basse** : exactement ce qu'est une tablette murale en paysage. La sortie a été la
**forme compacte** (« Mur N · X – Y m », une seule unité) puis le retrait complet des cotes du
sous-titre, plus `nowrap` + ellipse en filet de sécurité.

**Et un piège de confinement**, de la même famille que le `:global()` déjà noté : le nom de
l'ouverture ne s'affichait **jamais** dans le titre de la carte — largeur **0 px**, texte entièrement
rogné, sur toutes les longueurs de nom. `MarqueeText` porte `contain: inline-size`, qui annule sa
largeur intrinsèque ; enfant **bloc** de `.head__main` dans `DevicePanel` il prend la largeur de son
parent, mais placé ici dans un conteneur **flex**, `flex-basis: auto` le réduisait à son intrinsèque,
soit zéro. Correction : `flex: 1 1 0` (0 → 200 px mesurés). À retenir : **un composant à `contain`
ne se comporte pas pareil selon que son parent est un bloc ou un flex**, et le symptôme est un
silence complet — le DOM est là, le texte est là, la boîte fait zéro.

#### La liste de travail des ouvrants (vue Ouvrants)

Le scénario qui la motive, et qui explique sa forme : **on dessine la maison, on active le plugin
Somfy des mois plus tard, et six volets arrivent d'un coup sans savoir où ils vont.** Ce n'est pas
une anomalie à signaler en rouge, c'est du **travail à faire**, et il se vide à mesure qu'on
l'accomplit.

La vue Ouvrants porte donc un **compteur « {n} à affecter »** (place réservée, estompé à zéro — la
règle « rien ne bouge ») et, ligne par ligne, une **pastille « Sans ouverture »** plus un sélecteur
**« Affecter à »**. Le sélecteur propose d'abord les ouvertures de **la pièce de l'ouvrant** (c'est là
qu'il habite, donc le geste le plus probable), puis le reste de la maison : jamais masquées,
seulement reléguées, parce que la liste complète reste parfois nécessaire — un volet posé au mauvais
endroit par le plugin. Une ouverture déjà prise se distingue (« pris par X ») **sans disparaître** :
la reprendre est un geste voulu, `setCoverOpening` libère l'ancien
(`../1_architecture/1_4_app-web.md`). Symétriquement, le panneau d'ouverture marque « déjà posé
sur Y » plutôt que de masquer.

**La distinction de vocabulaire qui compte.** Un appareil « **non lié** » désigne déjà autre chose
dans cette interface : il n'a pas de liaison vers un appareil de **plugin** (`deviceId` absent,
affiché grisé). Ici la liaison au fabricant **existe** ; c'est la **place dans la maison** qui manque.
Deux manques différents, deux mots différents, sans quoi la liste de travail se lit comme une panne.

**Deux règles, et l'écart entre elles est voulu** (`apps/web/src/lib/cover.ts`) :

| | Ce que c'est | Natures |
|---|---|---|
| `expectsOpening` | les ouvrants qui **réclament** une ouverture — ils n'ont aucun sens sans celle qu'ils habillent ; c'est ce qui peuple la liste de travail | `shutter`, `blind`, `curtain`, `window` |
| `canTakeOpening` | ceux qu'on a le **droit** d'affecter — une seule règle partagée par la vue Ouvrants et le panneau d'ouverture | tout sauf `gate` et `garage` |

Le **store banne** (`awning`) vit dans l'écart : il se manœuvre comme un store intérieur, mais il se
déploie au-dessus d'une terrasse, pas dans une baie. On **peut** l'affecter à une ouverture si
l'installation le veut ; son absence d'ouverture n'est simplement **pas un travail en retard**.
Portail et porte de garage donnent sur la rue : ils se posent librement, jamais sur une ouverture.

> **Limite : ce scénario n'est pas démontrable en simulation.** La maison de démo
> (`packages/mock-sim/src/behaviours/cover.ts`) ne pose **jamais** `meta.cover.deviceClass` sur ses
> volets. `expectsOpening` est donc toujours faux contre elle et la liste de travail ne peut pas être
> non vide, quel que soit l'état réel des liaisons. Le parcours complet (pastille, compteur,
> affectation, reprise sans double comptage) a été vérifié avec un correctif **local et temporaire**
> des fixtures, annulé ensuite — rien n'en subsiste dans le code. Les fixtures mock n'ont pas non plus
> de portail ni de porte de garage, donc « un portail n'apparaît jamais » n'a pas pu être vérifié
> contre cette maison. En revanche la règle tient sur une installation **réelle** : des ouvrants Somfy,
> en majorité des `shutter`, quelques `awning` et un `gate` (cf. `../3_plugins/3_4_somfy-tahoma.md`) — des
> lignes de travail pour les volets, des stores bannes silencieux, un portail absent de la liste. **À corriger côté fixtures** si l'on
> veut le démontrer sans bidouille.

#### Deux détails d'état, appris à la revue

- **La surbrillance de pièce est coupée pendant le réglage d'une ouverture**, avec **deux** points de
  garde : dans `frameSelection` (qui l'éteint après `focusRoom`, même si le watcher `roomId`/`key` se
  redéclenche) et dans le watcher de `selectedOpeningId` lui-même (pour le cas où la pièce **ne change
  pas** — l'ouverture appartenant à la pièce déjà sélectionnée). Un seul des deux ne suffisait pas.
  Elle est restaurée à la sortie, dans les deux cas.
- **Une cote 3D peut passer sous le champ de recherche** à certains cadrages. Le remède est identifié
  (un retrait bas dans `setViewInset`) et **non pris** : il décalerait la composition de toute la vue
  Maison. Détail et raisonnement dans `../1_architecture/1_5_scene-3d.md`.

Sources : `apps/web/src/components/home/OpeningPanel.vue`, `apps/web/src/views/CoversView.vue`,
`apps/web/src/components/home/RoomPanel.vue`, `apps/web/src/views/HomeView.vue`,
`apps/web/src/stores/house.ts`, `apps/web/src/lib/cover.ts`, `apps/web/src/i18n/locales/{fr,en}.json`,
revue du second lot (`_generated-ai-doc/sessions/2026-09-17-edition-ouvertures/revue-ui.md`) et
journal de session (08:17 → 10:23).

### Mise à jour 2026-09-18 (3) — les crédits de la carte du radar démarrent repliés

La carte des précipitations de la vue Météo (`components/weather/RainRadar.vue`) montrait ses
mentions dépliées à l'arrivée : une bande de texte en travers du bas de la carte, alors que la carte
du véhicule les replie depuis le 2026-09-14. Même traitement ici, mais par un autre chemin : poser
`maplibregl-compact` sur `.maplibregl-ctrl-attrib` juste après `new Map(...)` empêche MapLibre de
jamais déplier — une ligne, sans drapeau ni événement. Le bouton ⓘ continue de basculer au clic, et
le repli survit au changement de thème (qui recharge le style). Mécanisme et piège détaillés dans
`../6_faq/6_0_pieges-outillage.md` (« l'attribution MapLibre », mise à jour du 2026-09-18).

Sources : `apps/web/src/components/weather/RainRadar.vue`.

### Mise à jour 2026-09-18 (4) — en-têtes Lumières et Ouvrants : deux gestes nommés, et le droit de se raviser

**Précise et remplace** les deux sections du 2026-09-12 sur les interrupteurs maîtres de vue. Ce
qu'ils commandent ne change pas d'un iota — la doctrine « sécuriser » du 2026-09-12 (bis) reste la
règle — c'est la **forme du contrôle** qui change. `CoversToggle.vue` devient `CoversMaster.vue`,
`LightsMaster.vue` est son pendant côté lampes. L'interrupteur **par pièce** (`RoomLightsToggle`,
2026-09-11) ne bouge pas : une ligne de pièce n'a pas la place pour deux mots, et une pièce est un
petit lot où l'ambiguïté coûte moins cher. Sa prop `label`, qui ne servait qu'à l'en-tête de vue,
disparaît (l'étiquette est toujours `rooms.allLights`).

**Pourquoi.** Un interrupteur n'offre qu'un geste à la fois, et il le déduit de l'état : sur quinze
lampes dont trois sont allumées, il fallait deviner ce que l'appui allait faire, et rallumer la
maison demandait **deux** appuis (coché dès qu'une lampe est allumée → un appui éteint, un second
rallume). L'en-tête porte donc un `Segmented` (`components/ui/Segmented.vue`) à deux segments
nommés : « Tout éteindre » / « Tout allumer », « Tout fermer » / « Tout ouvrir ». Les deux gestes
sont toujours à portée, quel que soit l'état du parc.

**Le segment allumé montre l'ÉTAT, pas le dernier appui.** Aucun des deux n'est sélectionné tant que
le parc est partagé — c'est précisément le cas où l'interrupteur mentait. Pour les lampes : « tout
éteint » quand aucune n'est allumée, « tout allumé » quand toutes le sont. Pour les ouvrants : le
segment « Tout fermer » s'allume quand **tout ce qui est joignable est au repos** (`coverAtRest`,
volets et portail fermés, stores remontés) et « Tout ouvrir » quand **tout ce qui est ouvrable**
(ni store, ni passage) est grand ouvert.

**La valeur cible au doigt, sans rien ajouter.** Le segment bascule au clic parce que le store
applique déjà la commande à l'état sans attendre le serveur (`lib/optimistic.ts`, lampes) et pose
une **position visée** (`stores/devices.ts`, `targetPosition`, ouvrants). Aucun état d'intention
local : le refus du serveur remet l'état d'avant et libère la cible, donc le segment revient seul.
Un échec partiel laisse le parc partagé, donc aucun segment allumé — ce qui est la vérité.

**Se raviser** demandait le seul vrai changement de logique. Les commandes d'ensemble lisaient la
position **publiée** : un volet lancé vers le bas annonce encore 100 % pendant ses vingt secondes de
descente (une box TaHoma ne publie qu'en fin de course), donc « tout ouvrir » le croyait déjà ouvert
et ne lui disait **rien**. Elles lisent maintenant `targetPosition(id) ?? position`, comme le
curseur et la jauge de ligne le faisaient déjà. Fermer par erreur puis rouvrir dans la seconde
relance donc bien les moteurs.

**Le résumé de l'en-tête des ouvrants compte par NATURE.** « 8 ouverts sur 10 » mélangeait des
choses qui ne se lisent pas dans le même sens (cf. 2026-09-08). Il devient « 8 volets ouverts ·
1 store déployé · 1 portail ouvert » : un groupe par `meta.cover.deviceClass` présente dans la
maison, chacun décrit par l'état qui **se remarque** (`coverActivity` — un volet se remarque ouvert,
un store déployé), avec l'accord qui va avec (« portes de garage ouvertes », « fenêtres ouvertes »).
Ordre **fixe** (`SUMMARY_ORDER` dans `CoversView.vue`) et jamais celui des comptes ; une nature
absente n'a pas de groupe, une nature présente garde le sien **à zéro** — sinon le libellé sauterait
dès qu'un volet s'ouvre (règle « rien ne doit bouger »). Le compte suit la position **visée**, comme
les jauges. Cela **tranche la question laissée ouverte le 2026-09-08** (« portails, portes de garage,
rideaux et fenêtres ne sont dans aucun des deux compteurs : leur formulation reste à décider ») :
chaque nature a maintenant son groupe et son mot, et une classe inconnue retombe sur « n ouvrants
ouverts ».

### Contradiction détectée 2026-09-18 — « store déployé » ici, « store baissé » dans l'en-tête de la vue Maison

Le même compte se dit de deux façons selon l'écran : `covers.counts.blind` / `.awning` (vue
Ouvrants, posé ce jour) dit « n stores **déployés** », là où `summary.awningsDown` (`useHomeSummary`,
en-tête de la vue Maison et tuiles, 2026-09-08) dit « n stores **baissés** ». Les deux comptent la
même chose (un store de position basse) et le vocabulaire de l'app pour cet état est « Baissé »
(`cover.upDown.closed`). Le mot « déployé » a été choisi par l'utilisateur dans l'aperçu de la
proposition ; l'alignement sur « baissé » est un changement d'un mot dans `covers.counts.*`.

**Arbitré le 2026-09-18 : « déployé » l'emporte, et c'est l'en-tête de la vue Maison qui s'aligne.**
`summary.awningsDown` et `home.awningsDown` (phrase d'en-tête et étiquette de tuile) disent
désormais « {n} store déployé » et « stores déployés » ; l'anglais passe à `deployed` aux trois
endroits (les deux natures de `covers.counts` et le groupe mixte de la vue Maison), plutôt que de
garder `down` pour un store intérieur et `out` pour un banne. Le mot dit ce qui **se remarque**
— une toile dehors — là où « baissé » ne décrivait qu'un sens de course.

Deux choses n'ont **pas** bougé, et c'est voulu :

- **les noms de clés** (`summary.awningsDown`, `home.awningsDown`) : un store déployé EST baissé, le
  nom décrit toujours l'axe mesuré (`pos(e) < 100`) ; les renommer aurait touché `useHomeSummary`,
  `HomePanel` et cette page pour un gain nul ;
- **`cover.upDown.*`** (« Remonter » / « Baisser », « Remonté » / « Baissé ») : c'est le vocabulaire
  des **gestes** et de l'état d'**un** appareil, pas celui d'un compte. On baisse un store, et une
  fois baissé il est déployé.

**Ce que `Segmented` a gagné** (et c'est tout) : un `disabled` **par option** — « Tout ouvrir » se
grise quand il n'y a rien à ouvrir (une terrasse de stores et un portail), sans griser « Tout
fermer » qui, lui, a encore du travail — et un `label` qui nomme le groupe pour les lecteurs
d'écran, puisque ce contrôle n'a aucun appareil nommé à côté de lui (`lights.all`, `covers.all`,
les mêmes clés qu'avant).

**Vérifié dans le navigateur** (preview `kasbah-mock`) : trois lampes allumées montrent « Tout
allumer », une seule éteinte n'en montre plus aucun, et les boîtes du contrôle **et** de l'en-tête
sont au pixel près identiques dans les trois états. Côté ouvrants, « Tout fermer » allume son
segment alors que le moteur annonce encore 100 % et que la cible vaut 0 ; « Tout ouvrir » dans la
foulée repart vers le haut, pendant que le portail reste fermé. Thème clair et thème sombre, largeurs
1024 / 1280 / 1536 px : aucun débordement. **Sous ~900 px de large l'en-tête des ouvrants passe sur
deux lignes** (le résumé par nature est plus long que « 8 ouverts sur 10 ») — rien n'est coupé, mais
c'est le prix du libellé complet.

Tests : `apps/web/src/components/devices/LightsMaster.test.ts` (état montré, gestes qui n'écrivent
que sur ce qui doit changer, valeur cible au doigt puis retour arrière sur refus, contrôle maintenu
et grisé quand rien ne répond) et `CoversMaster.test.ts` (les mêmes, plus « se raviser » : la
commande inverse repart avant que le moteur ait bougé).

Sources : `apps/web/src/components/devices/{LightsMaster,CoversMaster}.vue`,
`apps/web/src/components/devices/RoomLightsToggle.vue`, `apps/web/src/components/ui/Segmented.vue`,
`apps/web/src/views/{LightsView,CoversView}.vue`, `apps/web/src/lib/cover.ts`,
`apps/web/src/stores/devices.ts`, `apps/web/src/i18n/locales/{fr,en}.json`, commit `f29d48e`.


### Mise à jour 2026-09-18 (5) — poser et retirer une ouverture : en mode édition, le panneau de pièce change de sujet

Le mode armé dans Réglages savait **régler** une ouverture relevée ; il ne savait ni en poser une, ni
en enlever une. Or le relevé d'une maison réelle se fait dans les deux sens : on en oublie une au
premier passage, et on en dessine une qui n'existe pas.

**Ce qui remplace la section « Ouvertures » collée sous les appareils.** La mise à jour du
2026-09-18 (plus haut) ajoutait la liste des ouvertures **en plus** des appareils, tout en bas du
panneau de pièce. À partir d'ici, en mode édition, un tap sur une pièce ouvre un panneau qui ne parle
QUE de la pièce : `RoomEditPanel.vue`, et `panelMode` de `HomeView.vue` gagne une cinquième valeur,
`'roomEdit'`. La liste d'appareils ne s'y trouve plus — elle revient dès qu'on désarme l'interrupteur
des Réglages.

Trois formes ont été pesées avec l'utilisateur, qui a tranché pour la première :

| Forme | Pourquoi elle a été écartée (ou retenue) |
|---|---|
| **Remplacer** (retenue) | Le mode est armé ailleurs : le geste est déjà décidé, on relève la maison, on ne l'allume pas. Le même tap sur la même pièce donne toujours la même chose. |
| Édition en tête, appareils dessous | Garde les volets sous la main pendant qu'on règle leur fenêtre, au prix d'un panneau long — et de deux sujets dans la même colonne. |
| Onglets « Appareils / Structure » | Un geste de plus à chaque pièce, et un état de plus à retenir d'une pièce à l'autre. |

Une **zone du jardin** et un **niveau** gardent leur panneau habituel : ils n'ont pour l'instant rien
de modifiable (`panelMode` ne bascule que si `house.selectedRoom` existe, donc une vraie pièce). Le
composant est à part plutôt qu'un `v-if` de plus dans `RoomPanel.vue` parce que le nom de la pièce,
sa hauteur sous plafond et son sol ont vocation à venir là, en sections voisines.

**Poser, en deux temps, chaque temps portant ce qu'il sait.** Le **menu** du bouton « Ajouter une
ouverture » donne la **nature** (les six) ; le **tap sur le mur dans la 3D** donne la **place**. Rien
n'est écrit tant que le mur n'est pas touché. Une fois une nature choisie, le bouton devient
« Annuler » **dans la même boîte** (pleine largeur dans les deux états) et la consigne « Touchez dans
la vue 3D le mur qui la portera » occupe une place réservée sous lui — rien ne bouge en s'armant. Le
geste 3D lui-même est décrit dans `../1_architecture/1_5_scene-3d.md` ; ce qu'il faut retenir ici :
un tap **à côté du bâti** vaut renoncement, on désarme sans toucher à la sélection, la pièce reste
ouverte pour un autre essai.

L'ouverture qui naît devient aussitôt la sélection : le panneau d'ouverture s'ouvre sur elle, la
caméra la cadre, et elle se glisse comme n'importe quelle autre. Ses cotes de naissance sont des
valeurs de catalogue (`newOpeningDims`, voir `../2_maison/2_1_geometrie.md`).

**Retirer se fait là où l'objet vit**, dans son panneau, à gauche de « Rétablir », et **en deux
temps** — armer, puis confirmer dans les 4 s — exactement comme « Oublier l'appareil »
(`ForgetDeviceButton.vue`) et « Retirer de la maison » (`PlacementControl.vue`). Pas de corbeille par
ligne dans la liste de la pièce : sur une tablette posée à demeure, une fenêtre relevée au mètre
ruban ne doit pas partir d'un doigt posé de travers, et il n'y a **rien à rétablir** après coup.

Une fois armé, le bouton dit ce que le geste emporte : « Volet chambre 1 perdra sa place. » Cette
phrase n'est pas une politesse — l'ouvrant est libéré par le serveur dans la même écriture, faute de
quoi la maison entière serait rejetée (`../2_maison/2_0_format-house-json.md`).

**Ce qui a été mesuré dans le navigateur** (règle « rien ne bouge ») :

- bouton de suppression : **175 px dans ses deux libellés**. Les 150 px de `ForgetDeviceButton` ne
  suffisaient pas — « Confirmer la suppression » mesure 170 px, et le bouton grandissait de 16 px
  sous le doigt entre l'armement et la confirmation.
- carte de l'ouverture : **456 px armée comme au repos**. L'avertissement est borné à deux lignes
  (`min-height: 36px`, `line-clamp: 2`) et coupé au-delà : un nom d'ouvrant a droit à soixante
  signes, et un nom long ajoutait une troisième ligne, donc 4 px de carte.
- thèmes clair et sombre, 1280 × 800 et 1000 × 700, aucun débordement horizontal, console propre.

**Un piège d'outillage, pas de code**, relevé en vérifiant : un menu Vuetify **en cours d'animation**
rend une position fausse à `getBoundingClientRect` (503 px pendant l'ouverture, 431 px une fois
posé). Cliquer un item par cette position tape à côté, referme le menu, et **le tap suivant sur la 3D
efface la sélection** — ce qui ressemble trait pour trait à « la pose n'arme pas ». Attendre que le
menu soit posé avant de mesurer.

Sources : `apps/web/src/components/home/RoomEditPanel.vue`,
`apps/web/src/components/home/OpeningPanel.vue` (bouton de suppression, avertissement),
`apps/web/src/views/HomeView.vue` (`panelMode`, `onPlaceTap`, annulation au tap de fond),
`apps/web/src/stores/house.ts` (`placingOpening`, `startPlacingOpening`, `placeOpeningAt`,
`removeOpening`), `apps/web/src/i18n/locales/{fr,en}.json` (`opening.add`, `opening.placeHint`,
`opening.count`, `opening.none`, `opening.remove*`).

### Mise à jour 2026-09-18 (6) — la menuiserie dans le panneau d'ouverture, et la carte « Mode édition » des Réglages

#### Trois lignes de plus sous les cotes

Le panneau d'ouverture réglait la place et les cotes ; il règle maintenant ce que l'ouverture EST
(`../2_maison/2_0_format-house-json.md`). Trois lignes sous le texte d'aide, au gabarit des lignes
existantes — même `v-select` de 150 px que « Nature » et « Ouvrant lié », pour que la carte se lise
d'un trait :

| Ligne | Contrôle | Défaut affiché |
|---|---|---|
| **Vantaux** | `v-select` de 1 à 10 | le nombre EFFECTIF (`openingLeaves`), donc 2 sur une baie qui n'a rien dans son fichier |
| **Matière** | `v-select` Auto / Bois / Métal / Verre | « Auto » = la clé n'est pas dans le fichier |
| **Couleur** | `<input type="color">` + un `×` qui rend la main au style | le sélecteur part d'un anthracite de menuiserie |

**« Auto » et non « Automatique » : mesuré.** Le mot demande 101 px dans un emplacement qui en offre
88, et se coupait. Le sélecteur de 150 px est une contrainte déjà documentée ici (un `Segmented`
imposait 393 px de min-content) ; c'est donc le libellé qui cède. L'anglais garde « Automatic », qui
tient.

**Le `×` est à place RÉSERVÉE**, pas en `v-if` — contrairement à celui de `VehicleTuning.vue`, qui
apparaît et pousse le champ. Mesuré : le sélecteur de couleur reste à la même abscisse, colorée ou
non, et la ligne garde ses 30 px de haut. C'est la règle « rien ne bouge »
(`4_0_langage-visuel.md`).

**« Rétablir » couvre les trois réglages** : la photo prise à la sélection (`openingOrigin`) porte
désormais `leaves`, `material` et `color`, et les rend par la **chaîne vide** quand ils étaient
absents. Défaut trouvé en vérifiant dans la vraie app et corrigé : la première version rendait le
nombre DÉDUIT (`leaves: 1`), ce qui écrivait une clé là où le fichier n'en avait pas — et sur une
baie, cela l'aurait figée au lieu de la laisser suivre sa largeur. Le brouillon d'édition
(`withOpeningDraft` → `mergeOpening`) applique la même convention que le serveur : une chaîne vide
retire le champ au lieu de le poser, sans quoi la scène aurait montré, le temps du geste, une
menuiserie de matière `''` que le fichier ne portera jamais.

#### « Passage » s'appelle « Passage/Ouverture »

Le libellé de la nature `passage` devient **« Passage/Ouverture »** (« Passage/Opening ») : le mot
seul se lisait comme un couloir plutôt que comme un trou sans menuiserie dans un mur. **Le libellé
seulement** — `OPENING_TYPES` garde `passage`, sinon toutes les maisons déjà relevées seraient à
réécrire.

#### La carte « Mode édition » des Réglages

« Régler les ouvertures » quitte la colonne de droite de la carte **Rendu 3D** (mise à jour du
2026-09-18 plus haut) pour une **carte à elle**, `settings.editMode`, dans la pile de droite de la
vue Réglages : **entre « Plein écran » et « Origine GPS »**. Le texte et l'interrupteur ne changent
pas, seul leur logement — armer l'édition de la maison n'est pas un réglage de rendu, et la carte
Rendu 3D n'avait plus à porter un interrupteur qui ne parle pas d'images. Vérifié aux deux mises en
page (pile à 800 px, trois colonnes au-delà de 1500 px) et dans les deux thèmes.

Sources : `apps/web/src/components/home/OpeningPanel.vue` (`leafOptions`, `materialOptions`,
`setLeaves`, `setMaterial`, `setColor`), `apps/web/src/stores/house.ts` (`mergeOpening`,
`openingOrigin`, `canRevertOpening`), `apps/web/src/views/SettingsView.vue`,
`apps/web/src/i18n/locales/{fr,en}.json` (`opening.leaves`, `opening.material`,
`opening.materials.*`, `opening.color`, `opening.colorReset`, `opening.types.passage`,
`settings.editMode`).

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

### Mise à jour 2026-09-18 (7) — les réglages d'un ouvrant, repliés au pied de son panneau

Le panneau d'un appareil accueille une troisième carte pliante, au même endroit et sous le même
patron que les réglages d'un véhicule et le décalage GPS d'une tondeuse : `CoverTuning.vue`
(`apps/web/src/components/covers/`), repliée derrière « Régler ». Ce qu'on vient faire sur un volet,
c'est le manœuvrer ; le décrire vient après.

Trois lignes, toutes FACULTATIVES, et le panneau le montre :

- **Vantaux** (1 ou 2) — masquée pour un store banne, qui se déploie et n'en a pas. `hasLeaves`
  (`lib/orientation.ts`) ne réclame plus qu'un ouvrant DEBOUT, libre ou lié : les battants d'un
  portail s'écartent, les panneaux d'un volet ne font que découper son tablier, mais c'est le même
  nombre et la même question à poser.
- **Matière** — « Auto » en tête, puis bois, métal, verre, tissu (`OPENING_MATERIALS`, la liste des
  ouvertures : les quatre matières servent aux deux).
- **Couleur** — sélecteur natif, avec la croix qui rend la main au style. Place RÉSERVÉE : la croix
  s'efface sans que le sélecteur bouge. La teinte se voit PENDANT qu'on la choisit — la scène peint
  le tablier à chaque nuance survolée — et seul le choix validé s'écrit.

Les trois écritures passent par `house.setDeviceTuning`, qui accepte désormais `leaves`,
`coverMaterial` et `coverColor` : l'entrée de maison est créée au besoin, sans position. La carte
n'apparaît que pour un ouvrant PRÉSENT dans la maison — ces réglages ne concernent que ce qui est
dessiné.

**`canTakeOpening` accepte maintenant une porte de garage.** Elle en était exclue avec le portail
(« ce qui donne sur la rue »), ce qui rendait le cas inatteignable depuis le sélecteur d'ouvrant du
panneau d'ouverture. Quand le garage est relevé, la porte EST le panneau d'une ouverture de la
façade : la lier lui donne les cotes de la baie, et le bâti cesse d'y dessiner son propre vantail
(`../1_architecture/1_5_scene-3d.md`). Le portail, lui, reste dehors : aucun mur ne le porte.
### Mise à jour 2026-09-18 (8) — les places de stationnement dans le panneau de la maison

Où les mettre : **dans le panneau de la MAISON, en mode édition seulement**, et non dans celui d'une
pièce comme les ouvertures. Une place n'appartient à personne — elle peut être dans un garage, devant
les garages, dans une allée de jardin — et c'est `site.parkings[]` qui les porte toutes
(`../2_maison/2_0_format-house-json.md`).

La section reprend trait pour trait celle des ouvertures dans le panneau d'une pièce : une ligne par
place (nom, ce qu'elle accepte, à qui elle est réservée, ses cotes), un bouton « Ajouter une place »
qui ouvre un menu, et la même boîte qui devient « Annuler » une fois armé — rien ne bouge sous le
doigt. Le menu liste ce qu'on peut poser : une place de voiture (partagée), puis **une base par robot
connu**, nommée d'après lui (« Base : Tondeuse ») — c'est ainsi que la base naît déjà réservée à son
robot, sans champ à remplir ensuite.

`ParkingPanel.vue` règle la place choisie, aux idiomes de `OpeningPanel` (touches −/+, saisie qui ne
commite qu'à la validation, virgule décimale, chiffres à chasse fixe) :

- **largeur et longueur**, les cotes d'encombrement ;
- **les quatre cotes de position** — avant, arrière, gauche et droite, mesurées jusqu'au contour de
  l'hôte (le garage, l'allée, le terrain), nommé sous les champs (« Cotes depuis Salon »). La règle
  est celle des deux cotes d'une ouverture : on GARDE ce qui a été tapé et la place GLISSE de ce qui
  manque, la cote opposée suivant d'elle-même. Une place posée hors de toute pièce et de toute zone
  affiche « — » plutôt qu'un nombre inventé ;
- **l'orientation**, par pas de 5° et un bouton 180° : c'est le demi-tour qu'on corrige le plus
  souvent (l'avant du mauvais côté), et l'angle est ramené dans `[-180, 180[` avant l'envoi ;
- **le rayon d'accroche**, vide tant qu'il vaut celui de tout le monde (2 m) ;
- « Supprimer la place », en deux temps (armer, confirmer dans les 4 s), comme une ouverture.

Sélectionner une place FOCALISE son niveau quand elle est dans une pièce (`selectParking`, magasin) :
sans cela, on règle le marquage d'un garage à travers le toit, et l'onglet de niveau dirait autre
chose que la scène.

Conséquence côté Réglages : l'interrupteur du mode édition ne s'appelle plus « Régler les
ouvertures » mais **« Régler la maison »** — il arme désormais les deux (ouvertures sur les murs,
places au sol).

Sources : `apps/web/src/components/home/{HomePanel,ParkingPanel}.vue`,
`apps/web/src/views/HomeView.vue`, `apps/web/src/stores/house.ts`, `apps/web/src/views/SettingsView.vue`.

### Mise à jour 2026-09-19 — où l'on pose une place : le panneau de la maison en édition, celui d'une pièce, et la carte du robot

Trois corrections d'ergonomie après le premier essai, et elles disent toutes la même chose : **une
place se pose là où on y pense**.

**1. Le panneau de la maison est REMPLACÉ en mode édition** (`HouseEditPanel`), comme celui d'une
pièce l'est déjà par `RoomEditPanel`. Rangée en bas du panneau ordinaire, sous les tuiles, les
scènes et la liste des pièces, la section des places n'était pas visible sans défiler — on ne pouvait pas
deviner où ajouter une place. En édition, le panneau ne montre donc plus que ça.

**2. Le panneau d'une PIÈCE porte la même section** : les places posées dans cette pièce, et le même
bouton « Ajouter une place » — qui impose alors le niveau de la pièce à la place créée. C'est la même
section aux deux endroits (`ParkingRows`), pas deux copies : le geste doit être identique.

**3. La vue Robots porte la station du robot.** Sous la carte, une ligne « Base de robot » dit
« Non placée » (en accent) avec « Placer la station », ou « Placée » avec « Régler ». Poser arme la
pose et emmène sur la vue Maison ; le tap au sol crée la base et ouvre son panneau. La ligne existe
dans les deux états, à la même hauteur — rien ne bouge quand la station est posée.

Ce bouton ne vit **pas** dans la rangée des commandes du robot : celle-ci suit les CAPACITÉS du
fabricant (un plugin en lecture seule n'y voit rien), alors qu'une station est un relevé de la maison.
Un test le vérifiait déjà — il est tombé au premier essai, et il avait raison.

**Une base par robot** : le menu d'ajout ne propose plus la base d'un robot qui en a déjà une. Une
seconde base ne serait jamais occupée (la plus proche gagne) et ne ferait qu'encombrer la liste.

**Ce qui débordait.** Les lignes de place mettaient leur nom, ce qu'elles acceptent et leurs cotes sur
une seule ligne sans `min-width: 0` sur les lignes internes : un nom long POUSSAIT la rangée hors du
panneau au lieu d'être coupé. Les cotes sont maintenant au bout, jamais coupées, et c'est le nom qui
cède (mesuré : 177 px de trop absorbés par l'ellipse, le panneau ne bouge plus d'un pixel).

Sources : `apps/web/src/components/home/{ParkingRows,HouseEditPanel,RoomEditPanel,HomePanel}.vue`,
`apps/web/src/views/{HomeView,RobotsView}.vue`, `apps/web/src/stores/house.ts`.

### Mise à jour 2026-09-19 (2) — le cap d'une place se règle comme celui d'un appareil

La ligne « Orientation » du panneau d'une place portait deux touches marquées « −5° » et « +5° », et
elles MENTAIENT : le `yaw` tourne dans le sens trigonométrique, donc appuyer sur « +5° » affichait
« -5° ». C'est exactement la ligne d'un appareil orienté qu'il fallait reprendre (`PlacementControl`,
plus haut) : deux icônes de rotation — qui, elles, ne peuvent pas mentir, ce qu'on voit tourner suit
la touche — et la **saisie directe de l'angle** entre elles, dans la même boîte qu'ailleurs.

Deux différences assumées avec la ligne d'un appareil : le pas reste de **5°** (une place se cale sur
un mur de garage, pas sur une direction cardinale, là où un appareil tourne par 45°), et le bouton
« 180° » disparaît — un demi-tour se tape maintenant, comme n'importe quel angle.

Le cap d'une place est désormais écrit dans **`[0, 360[`**, la convention des appareils : l'axe de
pièce qui la crée (`longestEdgeYawDeg`, négatif la moitié du temps) y est ramené avant écriture, et
le contrat élargit ses bornes à ±360 plutôt que de refuser ce que la géométrie lui donne.

Sources : `apps/web/src/components/home/ParkingPanel.vue`, `apps/web/src/stores/house.ts`,
`packages/shared/src/house/place.ts`.

### Mise à jour 2026-09-19 — fenêtres de toit dans le panneau Maison, longueur × largeur

**`HouseEditPanel`** porte une section « Fenêtres de toit » (liste + « Ajouter ») : l'onglet Toit
n'ouvre aucune pièce, et sans cette section on ne pouvait pas poser un Velux là où le toit se voit.
La pose arme `startPlacingOpening('roof-window')`, bascule sur le niveau-toit, et rattache la
fenêtre à la pièce sous le point.

**Libellés surface** : le panneau d'ouverture affiche **Longueur** puis **Largeur** (champs JSON
`height` / `width` — axe du cap / travers), plus « Largeur / Hauteur » murales. Les listes
(`RoomEditPanel`, `HouseEditPanel`) affichent `height × width` pour les natures de surface.

Sources : `apps/web/src/components/home/{HouseEditPanel,OpeningPanel,RoomEditPanel}.vue`,
`apps/web/src/stores/house.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

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

### Mise à jour 2026-09-20 — champ URL du panneau lecteur

Quand l'appareil déclare la capacité `play_url`, `MediaPlayerControl` montre un champ
(placeholder `media.urlPlaceholder`) et un bouton lire (`media.playUrl`) : entrée →
`media_player.play_url`. Absent de la vue Médias en bandes (télécommande seule) — le geste
vit dans le panneau détail. Sources : `MediaPlayerControl.vue`, `lib/optimistic.ts`.

### Mise à jour 2026-09-20 — vue YouTube Music

Entrée rail juste après Médias (`nav.ytmusic`, icône `music`) → `/ytmusic` : recherche, Likes,
Playlists, sélecteur des lecteurs `play_url`, touche Jouer. Carte cookie dans Réglages
(`YtmusicLinkCard`). Badge « non officiel ». Au montage : `plugins.load()` + statut cookie
(sinon faux « manquant » hors Réglages). Sources : `YtmusicView.vue`, `navItems.ts`,
`../3_plugins/3_16_ytmusic.md`.

*(Dépassé le 2026-09-22 : cette vue est devenue la page « Musique » — clé `nav.music`, route `/music`, `views/MusicView.vue` ; `/ytmusic` redirige vers `/music` (`apps/web/src/router/index.ts`) — voir « Mise à jour 2026-09-22 — la page Musique remplace la page YouTube Music ».)*

### Mise à jour 2026-09-20 — recherche classée ytmusic

Colonnes Artiste / Album / EP / Compil / Titre (280 px, ellipsis), `PlayButton`, tris pertinence /
A–Z / date, badge Explicit, `ArtThumb` (`referrerpolicy=no-referrer` contre ORB). Persistance
`kasbah.ytmusic.*`. Détail : `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-21 — layout lignes + masquer explicites

Ligne 1 = titre (+ E) ; ligne 2 = meta + durée + année. Switch client « masquer les explicites »
(`kasbah.ytmusic.hideExplicit`). Détail catalogue / vidéos / Best of : `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-21 — ytmusic après météo, play → 3D, plus de langue au rail

- Ordre rail : Maison → Météo → **YouTube Music** → … (`navItems.ts`).
- Après `ytmusicPlay` réussi : `router.push(home)` puis `selectDevice` (nav d'abord, comme
  sonnette / placement — éviter la course d'URL keep-alive).
- Bouton langue retiré du `NavRail` (Réglages seuls).

> **Périmé depuis le 2026-09-22** : un play **ne navigue plus** (vérifié dans
> `MusicView.vue : play()`). La navigation + `selectDevice` a été déplacée sur la touche « Voir dans
> la maison » de chaque ligne du panneau Écoute (`locate()`), qui garde la règle « nav d'abord ».
> Voir « Mise à jour 2026-09-22 — la page Musique remplace la page YouTube Music » en fin de page.


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

### Mise à jour 2026-09-21 — ventilateur dans la vue Lumières

Pas de vue dédiée. `LightControl` montre une section ventilateur quand un `fan` déclare
`meta.linkedTo` vers cette lumière (hauteur réservée). Un ventilateur sans lien a sa carte dans
la même vue (`RoomBands` `hide-linked`).

### Mise à jour 2026-09-21 (bis) — polish UI plafonnier lié

- **Liste** : deux interrupteurs empilés (lumière puis ventilateur) ; en mode dual, glyphes
  `light` / `wind` **dans le pouce** (même patron que `RoomLightsToggle`).
- **Détail** : `Segmented` pleine largeur (`fill`) pour température 3CCT (libellé parlant + K en
  sous-ligne), vitesses, sens, minuterie. Sous-titre panneau `kinds.lightFan` (« Lumière -
  Ventilateur »). Fabricant `CREATE / Tuya`.
- Helper `lib/linkedDevices.ts` (`fanLinkedTo`).

Sources : `LightsView.vue`, `LightControl.vue`, `FanControl.vue`, `Segmented.vue`,
`DevicePanel.vue`.

### Mise à jour 2026-09-22 — médias : plus d'URL manuelle ; TV : diagonale en pouces ; onglet de niveau

- **Champ URL retiré** du panneau lecteur (`MediaPlayerControl`) : `play_url` reste pour YouTube
  Music et les plugins, plus de saisie manuelle dans le détail. Remplace la mise à jour du
  2026-09-20 « champ URL du panneau lecteur » ci-dessus.
- **Taille d'une TV** dans Emplacement → Déplacer : une ligne **Diagonale** (pouces, pas 1″,
  bornes 20–100, défaut 45″). Conversion 16:9 → `HouseDevice.size` en mètres
  (`tvSizeFromInches` / `tvInchesFromSize` dans `lib/orientation.ts`). Les ouvrants libres gardent
  largeur × hauteur / avancée.
- **Onglet de niveau** : `setFloorTab` désélectionne l'appareil (sauf mode Déplacer). Sinon
  `frameSelection` → `focusDevice` → `focusLevel` de la pièce de l'appareil annulait le niveau
  demandé. Voir `../6_faq/6_1_pieges-runtime.md`.

Sources : `MediaPlayerControl.vue`, `PlacementControl.vue`, `lib/orientation.ts`,
`stores/house.ts`, `i18n/locales/{fr,en}.json` (`place.size.diagonal`).

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

### Mise à jour 2026-09-22 (quater) — en-tête Plugins : actifs / dispo · appareils

Réglages → Plugins porte à droite du titre un résumé (`settings.pluginsStats`) :
**actifs / disponibles · N appareils**. Actifs = `enabled` parmi les `implemented` ;
disponibles = plugins implémentés de l'inventaire ; appareils = `devices.count` du store
(parc live à l'instant T, pas la somme des `health.deviceCount`).

Sources : `apps/web/src/views/SettingsView.vue`, `stores/{plugins,devices}.ts`.

### Mise à jour 2026-09-22 — la page Musique remplace la page YouTube Music

Le rail n'a plus d'entrée « YouTube Music » mais **« Musique »** (`nav.music`, icône `music`, même
place : Maison → Météo → Musique). La route `/ytmusic` **redirige** vers `/music` et
`YtmusicView.vue` a disparu au profit de `MusicView.vue` + `components/music/`. Le renommage porte
une décision : la page est celle de la musique de la maison, pas celle d'un fournisseur — d'où une
**rangée de pastilles de sources** en en-tête (une seule reliée aujourd'hui, avec son point d'état).

**Trois zones fixes**, jamais réorganisées :

1. **Au centre**, la recherche puis le catalogue. Deux modes, mémorisés (`kasbah.music.advanced`) :
   - *simple* : des **rangées de tuiles** (`MusicTile` : grande pochette, deux lignes de hauteur
     fixe) Artistes / Albums / Titres, 12 par rangée, avec « Voir tout » qui bascule en avancée ;
   - *avancée* : les **cinq colonnes** triables héritées de la vue précédente (artistes, albums,
     EP, compilations, titres).
   Sans recherche, la zone sert à **parcourir** : Récents (les 20 derniers titres joués, mémoire du
   navigateur) / Likes / Playlists. `ChipRow` porte les recherches récentes, effaçables, et garde sa
   hauteur même vide. `MusicItemRow` unifie les lignes de catalogue (pochette, titre + badge
   explicite, méta, durée, année).
2. **À droite, le panneau « Écoute »** (`ListeningSessions.vue`) : **un lecteur `media_player` = une
   session**. La ligne choisie est celle que pilote le lecteur du bas et là où partent les lectures.
   Un filtre segmenté restreint aux enceintes / téléviseurs / écrans d'après
   `meta.mediaPlayer.deviceClass` (une option sans porteur est grisée, pas cachée). Tri
   **alphabétique**, les **favoris** groupés au-dessus (étoile par ligne,
   `localStorage kasbah.music.favoriteSessions` — même clé que le choix du lecteur par défaut au
   premier chargement). Trois touches de largeur fixe par ligne : lecture / pause du lecteur
   (**invisible** s'il n'a rien de chargé, sa place restant prise), **« Voir dans la maison »** et
   l'étoile. Une ligne qui joue porte sa **pochette en fond**, fondue vers la droite ; les textes
   trop longs défilent (`MarqueeText`).
3. **En bas, le lecteur** (`MusicPlayerBar.vue`) : le morceau à gauche, transport et position au
   centre, volume et lecteur à droite. Détail des empreintes : `4_0_langage-visuel.md`.

**Mode transfert** : la touche « Transférer » du lecteur transforme le panneau Écoute en sélecteur de
cible — les lignes capables de recevoir un flux (`play_url`) montrent **« Ici »** à la place des deux
premières touches, la source reste visible mais grisée, et la touche de la barre devient
**« Annuler »** (même emplacement, même largeur). Elle n'est active que pour une lecture **lancée
depuis Kasbah** (`GET /sessions`) : une appli native sur un Chromecast n'est pas transférable, et
l'infobulle le dit.

**Ce qui a été retiré** : les toasts de succès au lancement et au transfert. Ils passaient
par-dessus le lecteur, qui montre déjà le résultat (titre en attente + sablier). Les erreurs restent
des toasts. Et « Voir dans la maison » **navigue d'abord, sélectionne ensuite**
(`router.push` puis `selectDevice`) — la course d'URL sous keep-alive est toujours là (`6_1`).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/*.vue`,
`apps/web/src/lib/navItems.ts`, `apps/web/src/router/index.ts`, `i18n/locales/{fr,en}.json`
(`nav.music`, `music.*`), `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-22 (2) — le curseur du lecteur déplace vraiment l'enceinte

Le même jour, le proxy ytmusic a changé de modèle (« fichier » MP3 de taille connue,
`../3_plugins/3_16_ytmusic.md`). Rien ne bouge dans la **disposition** de la page Musique — les trois
zones, le mode transfert et les empreintes sont inchangés — mais quatre choses se simplifient,
et ça se voit à l'usage :

- **Le curseur de position** envoie désormais la commande `media_player.seek` du lecteur, comme dans
  la vue Médias : plus de relance de flux, donc **plus de coupure de son** au relâcher. Il est
  actif dès que le lecteur déclare la capacité `seek` et qu'une durée est connue — la question « ce
  flux est-il à nous ? » ne se pose plus.
- **La pause et la reprise** sont celles du lecteur : une vraie pause Sonos, puis **un seul `Play`**
  pour repartir où on en était. Ni le serveur ni la page n'ont plus à retenir quoi que ce soit entre
  les deux.
- **Le panneau « Écoute »** écarte aussi une **source** illisible, et plus seulement un titre
  illisible : une ligne de repli affichait l'URL du proxy ou un identifiant hexadécimal là où on
  attend un nom de source. Même règle que pour le titre (`readable()`), posée une fois.
- **Ce qui reste montré par la session** et non par l'enceinte : titre, artiste, pochette, et la
  **durée** quand le lecteur ne la publie pas (constat live : le Sonos ne la publie pas sur ce flux).

Sources : `apps/web/src/components/music/{MusicPlayerBar,ListeningSessions}.vue`,
`apps/web/src/views/MusicView.vue`, `../1_architecture/1_4_app-web.md`.

### Mise à jour 2026-09-22 (3) — le pouce du curseur ne rebondit plus, et les deux lecteurs se comportent pareil

Correction ciblée de fin d'après-midi, **sans rien changer à la disposition** : ni la barre de
`/music` ni la carte lecteur du panneau appareil ne gagnent ou ne perdent un pixel.

Ce qu'on voyait : on clique à 2:00 dans le curseur, et la lecture « passe par un autre endroit »
avant d'y arriver — le pouce revenait une fraction de seconde à l'ancienne position. En pause, le
timecode oscillait. Les deux viennent du **sondage** : le lecteur ne pousse pas sa position, et le
relevé qui suit immédiatement le geste date d'**avant** lui (mécanique détaillée dans
`../1_architecture/1_4_app-web.md`).

Ce qui change à l'usage :

- **Après un déplacement, le curseur reste sur la valeur demandée** jusqu'à ce que le lecteur
  publie une position plus proche de la cible que du point d'où l'on venait. Un relevé périmé ne
  fait donc plus reculer le pouce, et un déplacement d'une **seconde** tient lui aussi — c'est le
  cas qu'une simple « distance minimale » aurait laissé passer.
- **En pause, le timecode est stable** : il se fige à la valeur affichée et ignore un relevé qui
  s'en écarte de moins de 2,5 s, tout en suivant un vrai saut (seek, transfert).
- **Le panneau appareil se comporte exactement comme la barre Musique** : il partageait le
  vocabulaire, il partage maintenant le code (`useMediaPosition`, `useSeekHold`). Son ancienne copie
  recalait la position sur le relevé périmé au passage en pause — c'est ce qui donnait deux
  comportements pour un même curseur selon la page où on se trouvait.
- **Changer de lecteur** (autre session, autre appareil) relâche la valeur tenue : on n'hérite pas
  de la cible visée sur l'enceinte précédente.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/components/controls/MediaPlayerControl.vue`,
`apps/web/src/composables/useMediaPosition.ts`, `../1_architecture/1_4_app-web.md`,
`../6_faq/6_1_pieges-runtime.md`.


### Mise à jour 2026-09-22 (3) — badge explicit, qualité du flux, volume au fil du geste

**Badge explicit** (`components/ui/ExplicitBadge.vue`, le même carré « E » que les lignes de
recherche) à trois endroits, qui lisent tous `nowPlaying.explicit` :

- barre de lecture de la page Musique, contre le titre ;
- panneau « Écoute », sur la ligne du morceau (légèrement réduit, `scale(0.85)`) ;
- détail d'un appareil dans la vue 3D (`MediaPlayerControl.vue`), sur la ligne artiste / album.

PIÈGE relevé à l'usage : dans la barre, le badge doit suivre la MÊME source que le titre et la
pochette. Entre le clic et le premier octet servi il s'écoule quelques secondes (résolution yt-dlp),
pendant lesquelles la barre montre déjà le titre du CATALOGUE (`pending`) : en lisant l'état du
lecteur, le badge arrivait en retard sur un titre explicit, puis RESTAIT allumé sur le titre suivant
— qui ne l'était pas — jusqu'au démarrage du flux. Il lit donc `pending.explicit` tant qu'un envoi
est en cours, l'état ensuite.

**Qualité du flux** : une ligne discrète sous le nom du lecteur, dans la colonne de droite de la
barre (`MP3 320 kb/s`), avec en info-bulle l'échantillonnage, le nombre de voies, la taille annoncée
et le format reçu de YouTube (« source M4A 258 kb/s »). Emplacement de largeur fixe (96 px) TOUJOURS
rendu, insécable quand rien de nous ne joue : la colonne ne bouge pas quand la lecture part.

**Volume** : le curseur applique le réglage pendant le glissement (détail dans
`../1_architecture/1_4_app-web.md`).

Sources : `apps/web/src/components/ui/ExplicitBadge.vue`,
`apps/web/src/components/music/{MusicPlayerBar,ListeningSessions}.vue`,
`apps/web/src/components/controls/MediaPlayerControl.vue`,
`apps/web/src/components/music/MusicPlayerBar.test.ts`.

### Mise à jour 2026-09-22 (4) — reculer / avancer de 10 s dans le lecteur fixe

Deux touches encadrent la touche lecture : `↺ 10` et `↻ 10` (flèche circulaire avec le pas EN SON
CENTRE, comme sur les lecteurs de podcast). Le pas est écrit PETIT — 8 px dans une flèche de 24 :
à 10 px les deux chiffres remplissaient le cercle bord à bord et l'ensemble devenait une tache. La rangée reste symétrique — emplacement fantôme,
piste précédente, −10, lecture, +10, piste suivante, stop (*l'emplacement fantôme est devenu la
touche Répéter le soir même, cf. « (6) » plus bas*) — donc la touche lecture est toujours au
centre exact de l'ÉCRAN : mesuré à 1280 (640 px) et à 1920 (960 px), rangée de 322 px dans une
colonne centrale qui en fait 340 au minimum.

Le saut passe par le MÊME chemin qu'un déplacement au curseur (`useSeekHold` puis `media_player.seek`
vers le lecteur) et part de la position AFFICHÉE : deux appuis rapides s'additionnent (100 → 110 →
120) au lieu de retomber deux fois sur un relevé qui n'a pas encore bougé. Bornes : jamais avant 0,
jamais au-delà de la durée. Les deux touches sont grisées quand il n'y a rien à parcourir (direct,
lecteur au repos, appareil sans capacité `seek`) — comme le curseur lui-même.

Le pas est la constante `SEEK_STEP_S` du composant, reprise dans le libellé (`media.jumpBack` /
`media.jumpForward`, paramètre `{seconds}`) : changer la constante change l'info-bulle.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/components/music/MusicPlayerBar.test.ts`,
`apps/web/src/composables/useMediaPosition.ts`.

### Mise à jour 2026-09-22 (5) — touches de transport OBLONGUES, et l'attente d'une recherche

**Des touches plus larges, pas plus hautes.** La taille des touches est bornée par la HAUTEUR de la
barre (92 px), qui empile la rangée et le curseur de position : 42 px de haut (lecture 50) est ce qui
y tient. On agit donc sur la largeur — `--key-w: clamp(42px, calc(5.2vw - 24px), 84px)` — car c'est
l'espace libre entre le morceau (à gauche) et le volume (à droite) qui la borne : ~376 px à 1280,
~682 px à 1920. Résultat mesuré : 43 × 42 à 1280 (la rangée y touche déjà ses voisines, rien à
gagner), **76 × 42 à 1920**, soit le double de la largeur d'origine. L'icône se règle sur la HAUTEUR
(`height: 46%; width: auto`) : en pourcentage des deux côtés elle s'étirait avec la touche.

La rangée porte `width: var(--center-w)` et `justify-content: center` : quand elle déborde (écran
étroit), elle déborde des DEUX côtés à égalité et la touche lecture reste au centre exact de l'écran
— vérifié à 1280 (640) et à 1920 (960). Sans ça elle partait du bord gauche de la colonne et lecture
glissait de 5 px.

**L'attente d'une recherche.** Une recherche prend plusieurs secondes (InnerTube) : les résultats
précédents sont maintenant VIDÉS dès l'envoi, et la zone montre des squelettes à la forme des tuiles
à venir (trois rangées de sept, `.skel`, respiration de 1,4 s coupée par `prefers-reduced-motion`),
plus une ligne `role="status"` « Recherche en cours… ». Garder les anciens résultats laissait croire
que le clic n'avait pas pris — ou pire, que c'était la réponse. Vérifié en direct : 21 squelettes et
aucune tuile de résultat pendant l'attente, 27 tuiles et plus un squelette à l'arrivée.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-22 (6) — la file d'attente dans la page Musique

La file vit sur le **serveur**, une par lecteur (mécanique, fin de piste et répétition :
`../3_plugins/3_16_ytmusic.md`, « Mise à jour 2026-09-22 (5) »). La page ne fait que la remplir, la
montrer et la piloter. Non commitée au moment de l'ingestion.

**Jouer un titre, c'est jouer sa liste.** Un clic sur un titre d'une liste — album ou playlist
ouverts, Likes, Récents, titres de la recherche (tuiles du mode simple comme lignes de l'avancé) —
le lance, et **toute la liste devient la file à partir de lui** (`play(track, list)` →
`ytmusicQueuePlay`). Une liste plus longue que les 1000 titres qu'accepte le serveur est envoyée par
**fenêtre** (`QUEUE_WINDOW`) : jusqu'à 100 titres avant celui choisi, et la suite. L'en-tête du détail
d'un album / d'une playlist gagne une pastille **« Tout lire »** (depuis le premier titre).

*(Dépassé le 2026-09-22 : la méthode du transport s'appelle `musicQueuePlay` (`apps/web/src/api/transport.ts`), la page Musique n'étant plus propre à YouTube Music.)*

**Compléter sans interrompre.** Chaque ligne de titre (`MusicItemRow`, prop `queueable`) porte deux
petites touches **fixes** devant le bouton play — « Lire ensuite » (`queueNext`) et « Ajouter à la
fin » (`queueAdd`) — jamais au survol : rien ne bouge. Les tuiles du mode simple (`MusicTile`) ne les
ont **pas encore**. Rien ne joue depuis Kasbah sur ce lecteur ? L'ajout lance la lecture (réponse
`started`). Pas de toast de succès : le retour est la **pastille** de la touche File.

**La vue File remplace la zone centrale**, ouverte par la touche File de la barre (fermée par
« Retour », ou en changeant d'onglet Parcourir). Le titre qui joue est surligné et amené sous les
yeux à l'ouverture ; un clic sur une ligne y saute (`/queue/jump`). Chaque ligne a sa touche de
retrait (`removable`) — **masquée sur le titre courant mais sa place gardée** (`visibility: hidden`),
le serveur refusant de retirer ce qui joue. « Vider la file » garde le titre en cours, seul.

**La barre** (`MusicPlayerBar.vue`) :

- **Précédent / suivant** sont pilotés par la file quand la session en a une : `MusicView` intercepte
  `media_player.next` / `previous` et appelle les routes de file (l'enceinte n'a qu'un titre).
  Suivant est grisé en bout de file ; précédent reste actif au premier titre (il ramène au début).
  Sans file, on retombe sur la capacité `track_skip` du lecteur, comme avant.
- **Répéter** prend l'emplacement qui répond à Stop — celui qu'occupait jusqu'ici un
  **emplacement fantôme** (`key--ghost`, section « (4) » ci-dessus) : la rangée reste symétrique et
  lecture pile au centre. Un appui fait tourner `off` → `once` → `loop` → `off` ; le pas s'écrit au
  centre des flèches (« 1 » ou « ∞ », comme le « 10 » des sauts ; classe `key--repeat`). Grisée sans
  file.
- **La touche File** est posée **au bout de la zone du morceau**, pas dans la colonne de droite : à
  1280 px, volume + lecteur + Transférer la remplissent déjà. Sa **pastille** (titres en attente,
  « 99+ » au-delà) est posée **sur le coin**, en `position: absolute` : elle n'élargit rien quand elle
  apparaît.

**Suivre l'enchaînement automatique.** Le serveur enchaîne seul ; la page relit donc `GET /sessions`
**800 ms** après tout changement de lecture ou de titre du lecteur choisi, plutôt qu'au prochain tour
de 20 s — le délai laisse au serveur le temps de finir de lancer le titre suivant. La file elle-même
est relue dès que la session annonce un autre index, une autre longueur ou une autre répétition.

Nouvelles icônes `repeat`, `queueNext`, `queueAdd` (`lib/strokeIcons.ts` ; la touche File reprend
`list`). Clés i18n `music.queue*`, `music.playAll`, `music.playNext`, `music.addToQueue`,
`music.repeatOff` / `repeatOnce` / `repeatLoop` (fr / en).

Vérifié en direct sur un Sonos (selon la session) : suivant, cycle de répétition, lire
ensuite, retrait, vider.

**Défaut connu, antérieur, non corrigé** : dans la colonne de droite de la barre à 1280 px, la boîte
du nom du lecteur (96 px) déborde sur la pastille Transférer, et le « 12 » du volume chevauche le
bloc du lecteur d'environ 4 px. Relevé pendant la session, pas mesuré de nouveau ici.

Sources : `apps/web/src/views/MusicView.vue`,
`apps/web/src/components/music/{MusicPlayerBar,MusicItemRow}.vue`,
`apps/web/src/components/music/MusicPlayerBar.test.ts`, `apps/web/src/lib/strokeIcons.ts`,
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-22 (7) — jouer un album ou un artiste d'un geste, lecture au survol sur la pochette

**Lecture sur la pochette** (`components/music/ArtPlay.vue`) : le bouton plein en bout de ligne
(`PlayButton.vue`, supprimé) est remplacé par un cercle au trait (1,5 px blanc) sur un voile sombre
translucide, centré sur la pochette — 48 px sur une tuile de 128, 30 px sur la vignette de 44 d'une
ligne. Lisible sur n'importe quelle image, sans aplat de couleur ; au survol du cercle lui-même, il
prend l'accent. Grisé par le trait (pas par l'opacité, qui appartient au parent).

**Au survol seulement** : sous `@media (hover: hover)`, le cercle ET les touches de file (« Lire
ensuite », « Ajouter à la fin ») d'une ligne sont à `opacity: 0` et apparaissent au survol ou au focus
de la tuile / de la ligne ; le cercle reste visible pendant l'envoi (`aria-busy`, sablier). Leur place
est gardée : rien ne bouge. Sur un écran **sans survol** (tactile), tout reste affiché en permanence —
sinon rien ne serait jouable ; c'est le cercle au trait qui rend l'écran moins chargé qu'avant.
Révélation écrite côté parent par `:deep(.art-play)` (pas de `:global`, cf. le piège du sélecteur
global dans un style scoped).

**Album et artiste jouables** (`playable` sur `MusicTile` et `MusicItemRow`) : tuiles de la recherche
simple et lignes des colonnes Artistes / Albums / EP / Compilations de la recherche avancée. Le cercle
lance `playCollection` : les titres de l'album (`ytmusicAlbum`) ou de l'artiste (`ytmusicArtist`),
filtrés par « Masquer explicit », deviennent la file depuis le premier ; le reste de la tuile ou de la
ligne ouvre le détail, comme avant (le clic du cercle ne remonte pas — verrouillé par
`MusicTile.test.ts`). Les playlists n'ont pas (encore) de cercle : non demandé.

**Structure** : la racine d'une tuile ou d'une ligne qui s'ouvre est désormais un `div` avec
`role="button"`, `tabindex` et Entrée / Espace — un bouton de lecture ne peut pas vivre dans un
`<button>` (HTML invalide).

Vérifié dans la preview (1280×800, sombre) sur un Sonos de test : pochettes nettes au repos,
cercle au survol, un album lancé depuis sa tuile (premier titre, une dizaine de titres en attente, pochette et
artiste reçus par l'enceinte), un artiste lancé depuis sa tuile sans quitter la recherche (file de
plusieurs dizaines de titres).

Sources : `apps/web/src/components/music/{ArtPlay,MusicTile,MusicItemRow}.vue`,
`apps/web/src/components/music/MusicTile.test.ts`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-22 (8) — le « E » explicit sur les tuiles de la recherche simple

Les tuiles d'album et de titre n'avaient jamais porté le marquage (seules les lignes, le lecteur du bas
et le panneau Écoute l'affichaient). `MusicTile` gagne `explicit` : le même `ExplicitBadge` que le
lecteur, posé à droite du titre sous la pochette (`.tile__line1`, flex) — c'est le titre qui se
raccourcit, la tuile garde sa hauteur (172 px avec ou sans badge, mesuré sur une recherche d'artiste : la plupart
des tuiles Album et Titre en portent un). Pas de badge sur un artiste (non marqué par le
catalogue). Test : `MusicTile.test.ts`.

Sources : `apps/web/src/components/music/MusicTile.vue`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-22 (9) — onglets Genres et Ambiances

« Parcourir » gagne deux onglets (`browseTab` : `genres`, `moods`). **Genres** : la rangée « Pour vous »
(si YouTube en donne) puis les 25 genres ; **Ambiances** : les humeurs et moments. Des pastilles de
hauteur FIXE (52 px, grille `auto-fill minmax(176px, 1fr)`), liseré gauche de 6 px à la couleur de
YouTube Music (`--cat`) — pas en aplat : ces couleurs sont pastel (#a4ffa4, #cccccc…) et rendraient le
texte illisible en sombre ; survol teinté à 16 %. Nom trop long coupé (ellipsis, `title`). Squelettes
de pastilles pendant le chargement. Noms dans la langue de l'app (`hl = locale`), relus seulement si
la langue change.

**Page d'une catégorie** (`browse.kind === 'category'`) : rangées de tuiles avec le titre de chaque
rangée ; titres jouables (la rangée devient la file), playlists et albums qui s'ouvrent ou se jouent
d'un geste (`playPlaylist`, `playAlbum` — même `playCollection`). « Masquer explicit » s'applique, une
rangée vidée disparaît. **Retour** : ce qui est ouvert DEPUIS une catégorie y revient (`backStack`,
rangées gardées en mémoire), puis à la grille. Vérifié dans la preview (1280×800) : 31 pastilles de
52×190 px, Jazz (Titres / Sélection de playlists / Albums), double retour, une playlist
lancée depuis Calme sur un Sonos de test (file de plusieurs dizaines de titres).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-22 (10) — cartes de genres et d'ambiances

Les pastilles de la section « (9) » deviennent des CARTES à la manière de « Parcourir » de Spotify :
108 px de haut, grille `auto-fill minmax(208px, 1fr)`, fond en dégradé de la couleur de la catégorie
ASSOMBRIE (`color-mix` avec #0b0d12, halo radial dans le coin) — même carte dans les deux thèmes, comme
une vignette ; nom en 17 px gras, deux lignes au plus (`line-clamp`), à gauche. Deux pochettes
inclinées (22° devant, −10° derrière, ombrées) dépassent du coin bas-droit ; au survol elles se
redressent un peu, la carte s'éclaircit. Les cartes s'affichent d'abord ; `ytmusicExploreCovers` arrive
ensuite, chaque pochette n'apparaît (fondu 0,35 s) qu'une fois chargée (`@load`) — emplacement absolu,
rien ne bouge. PIÈGE retrouvé : `<img referrerpolicy="no-referrer">` obligatoire pour les pochettes
Google (cf. `ArtThumb`), sinon image vide. Vérifié en sombre et clair à 1280×800 (12 ambiances, 31
genres, toutes avec leurs deux pochettes).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-09-23 (11) — onglet Nouveautés, numéros, lecture des playlists, « Avancée »

- **Nouveautés** : nouvel onglet de « Parcourir », entre Playlists et Genres (six options). Rangées de
  la page de YouTube : la playlist phare en tête, puis TOUS les albums et singles récents (~185), en
  GRILLE (`MusicShelves grid` : `repeat(auto-fill, 128px)`, passage à la ligne) et non en rangée
  défilante. « Retour » depuis un album ouvert ici ramène aux Nouveautés.
- **`MusicShelves.vue`** : les rangées de tuiles (titres jouables en file, playlists et albums
  ouverts ou joués) sont un composant partagé par la page d'une catégorie et les Nouveautés ; une
  rangée sans titre prend le nom de ce qu'elle contient.
- **Numéros** `#1, #2…` (`MusicItemRow position`) dans la file, le détail d'une playlist / d'un album /
  d'un artiste et les Likes (pas les Récents, dont l'ordre ne signifie rien). Colonne de 38 px FIXE :
  en `ch` elle suivait la graisse et la ligne en cours (numéro en gras, couleur d'accent) décalait sa
  pochette d'un pixel. Rang dans la liste AFFICHÉE (« Masquer explicit » renumérote).
- **Lignes de playlists jouables** (onglet Playlists) : cercle de lecture au survol, comme les tuiles.
- **« Avancée » grisée sans recherche affichée** : elle ne règle que la présentation des résultats ; le
  choix reste mémorisé et revient à la recherche suivante, largeur inchangée.

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/{MusicShelves,MusicItemRow}.vue`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-23 (12) — détail d'album / de playlist / d'artiste à la YouTube Music

Le détail n'est plus une liste pleine largeur : **colonne de gauche** (208 px) avec la pochette en
grand (176 px, ronde pour un artiste), le titre (2 lignes au plus), l'artiste, « E · Album · 2012 »
(type de sortie : Album / Single / EP / Compilation, ou Playlist / Artiste), « 8 titres · 33 min »
(durée calculée sur la liste affichée) et une grande touche de lecture (52 px, lance tout) ; **titres
à droite**. Un voile flou de la pochette (`blur(60px)`, opacité .24, masque en dégradé) en fond. La
colonne reçoit ce que la liste d'origine savait de l'élément (`DetailHead` dans `Browse`).

**Titres d'un album sans vignette** (`MusicItemRow artless`) : la même pochette partout ne s'y répète
plus. Le numéro devient ▶ au survol (sablier pendant l'envoi) et la ligne ENTIÈRE se joue (clic,
toucher, Entrée) — c'est le geste des écrans tactiles, qui n'ont pas de survol. Touches de file
inchangées (elles ne lancent pas le titre). Hauteur de ligne identique avec ou sans vignette (61 px).
Playlists et artistes gardent leurs vignettes (un titre, une pochette).

**PIÈGES rencontrés** : (1) une colonne `sticky` plus haute que la zone de défilement rend sa touche de
lecture inaccessible (on ne peut plus la ramener en vue) — la colonne n'est collante qu'à partir de
760 px de hauteur d'écran, et compactée ; (2) le voile qui déborde de 20 px crée une barre
horizontale — contenu dans la zone, et `overflow-x: clip` (pas `hidden`, qui casserait le `sticky`).
Vérifié à 1280×800 sombre et clair : un album, une playlist, un artiste ; clic sur une
ligne d'album → la file part de ce titre (Sonos de test).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/MusicItemRow.vue`,
`apps/web/src/components/music/MusicTile.test.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-23 (13) — détail affiné, pochettes nettes et adoucies

- **Colonne de gauche** : pochette qui grandit avec l'écran (`--cover` 208 / 260 / 300 px selon la
  largeur ; `--art` posé en ligne par ArtThumb, remplacé par `!important`), plus d'air, titre 22 px.
  **Fixe tant qu'elle tient en entier** sous « Retour » : la page MESURE la colonne et la zone
  (`useResizeObserver` de VueUse sur les deux ; `sideFits` → `.is-fixed`, `position: sticky; top:
  var(--back-row-h)`) et la laisse défiler sinon (écran bas, présentation dépliée) — plus de seuils
  d'écran devinés. Accrochée à sa place EXACTE de départ (la ligne « Retour » fait `--back-row-h`, sans
  marge dessous), sinon elle glissait de 6 px avant de se fixer. NB : dans la preview en arrière-plan,
  la page ne se redessine pas et un ResizeObserver ne se déclenche pas — forcer un rendu (capture)
  pour vérifier.
- **« Retour » collant** (`.back-row`, toutes les vues à détail) en haut de la zone, sur `var(--bg)` : il ne
  chevauche plus le voile flou (qui commence sous lui) et reste accessible en défilant.
- **Présentation** d'album et d'artiste sous la durée, repliée sur 2 lignes, un clic la déplie ; la
  mention « Source : Wikipedia, licence : Creative Commons… » détachée en petit dessous, sans les URL
  (tronquées par YouTube, parfois sans parenthèse fermante, ou avec leurs propres parenthèses) —
  `lib/wikiCredit.ts` (testé).
- **Pochettes nettes** : le catalogue les livre en 120 px ; `lib/artUrl.ts` (`artAt`, même réécriture que
  `upgradeArtUrl`) les redemande en 600 px pour le détail et en 256 px pour les tuiles de 128 (artistes
  compris). `i.ytimg.com` : jamais `maxresdefault` (absent pour bien des vidéos).
- **Voile sur les pochettes** (`ArtThumb`, demande de l'utilisateur : une page pleine d'images « pète
  les yeux ») : dégradé du haut transparent au bas assombri de 25 %, seulement sur une vraie image, à
  l'arrondi de la pochette qui le porte (`border-radius: inherit`, le détail l'a à 10 px).
- **« E » collé au titre** dans les lignes (`.title` ne prend que sa place).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/ui/ArtThumb.vue`,
`apps/web/src/components/music/{MusicTile,MusicItemRow}.vue`, `apps/web/src/lib/{artUrl,wikiCredit}.ts` (+ tests).

### Mise à jour 2026-09-23 (14) — le titre qui joue, pulsant dans les listes ; colonne compactée

- **Titre en cours signalé** (`MusicItemRow playing`) : le `PulseDot` du panneau Écoute, devant le titre,
  à l'accent. Allumé et pulsant quand le lecteur choisi JOUE ce titre (servi par nous : `nowPlayingId` =
  `videoId` de sa session, `nowPulsing` = `playback === 'playing'`) ; en pause, la ligne reste surlignée,
  le point s'éteint. Sa place est toujours gardée sur une ligne de titre (titres alignés au pixel, allumé
  ou non). Partout où l'on voit des titres : détail, likes, récents, recherche avancée, file. Le surlignage
  suit désormais ce qui JOUE, et non plus le dernier titre lancé depuis la page (`recentPlays[0]`).
- **Colonne de gauche compactée** (~55 px gagnés, la touche de lecture tenait mal à 1920×1080 avec la
  ligne de licence) : type, année, titres et durée sur UNE ligne, marges et touche resserrées.
- **PIÈGE — `MarqueeText` a une largeur naturelle NULLE** (`contain: inline-size`, voulu : un titre long
  n'élargit pas son panneau). Lui donner `flex: 0 1 auto` pour coller le « E » au titre l'a réduit à zéro
  : le titre avait disparu du lecteur du bas. Il garde `flex: 1 1 auto`, et le « E » passe DEVANT lui.

Sources : `apps/web/src/components/music/{MusicItemRow,MusicPlayerBar}.vue`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-23 (15) — voile immersif et « Retour » hors de la zone qui défile

- **Voile de la pochette** (`.veil`) : sorti de la zone qui défile, il ne bouge plus quand la liste défile ;
  posé dans un bloc `.main__body` (« Retour » + zone qui défile) — JAMAIS sous la recherche ni les
  recherches récentes (demande de l'utilisateur) — et fondu sur ses QUATRE bords (deux masques croisés,
  `mask-composite: intersect`) : plus aucune démarcation. Rogné dans sa boîte (l'image floue agrandie ne
  déborde pas, pas de barre horizontale).
- **« Retour » hors de la zone qui défile** : une seule ligne pour la file, une catégorie et un détail
  (titre, « Vider la file » selon le cas), au-dessus de la zone. Plus de fond plein qui tranchait le voile,
  et plus rien ne passe dessous ; le haut de la zone qui défile se fond sur 14 px (`main__scroll--under`),
  une ligne qui monte s'y efface. Colonne de gauche collante à `top: 0` ; `sideFits` compare sa hauteur à
  la seule zone qui défile. Écartée en chemin : une vitre dépolie sur « Retour » laissée DANS la zone —
  les titres de la colonne passaient lisibles sous le bouton.

Sources : `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-23 (16) — « Ce navigateur » : la page joue elle-même

Le panneau « Écoute » gagne un lecteur qui n'est aucune enceinte : **« Ce navigateur »** (sous-titre
« Son de cet appareil », icône `tablet`), qui fait jouer la musique par l'appareil qui affiche la page.
Mécanique serveur et pièges audio : `../3_plugins/3_16_ytmusic.md`, « (12) ».

- **Toujours la toute première ligne**, au-dessus même des favoris, dans son **propre groupe sans
  titre** (`ListeningSessions.vue`, groupe `local`) : c'est le lecteur qu'on a sous la main. Il n'entre
  ni dans les favoris ni dans le tri alphabétique.
- **« Voir dans la maison » disparaît** sur cette ligne (le navigateur n'a pas de place dans la 3D),
  mais **son emplacement reste** (`is-hidden`, désactivée, hors tabulation) : les touches des lignes
  restent alignées. La barre du bas montre la même icône `tablet` (`MusicPlayerBar.vue`).
- **Session privée** (choix de l'utilisateur) : les autres écrans ne voient pas cette ligne.
- **Aucun cas particulier d'affichage** : le store présente un `DeviceEntry` synthétique, le panneau
  et la barre le rendent comme les autres. Seules les commandes changent de chemin : `MusicView`
  aiguille lecture, file, transport, déplacement et transfert vers le store quand le lecteur choisi est
  local (`localSelected`), et les touches du panneau passent par `panelCommand`.
- **Transfert** dans les deux sens : le navigateur peut être source (il donne sa position et sa file,
  puis se tait) ou cible (« Ici » sur sa ligne ; il reprend fichier, position et file).
- **Choix du lecteur par défaut** : le lecteur local étant toujours dans la liste, le `watch` qui
  choisit la ligne au premier chargement **attend l'inventaire des appareils** avant de juger un choix
  mémorisé — sinon il l'aurait jugé disparu.
- La musique **continue quand on change de page** : le store vit hors de la vue.

Sources : `apps/web/src/components/music/{ListeningSessions,MusicPlayerBar}.vue`,
`apps/web/src/views/MusicView.vue`, `apps/web/src/stores/localPlayer.ts`,
`i18n/locales/{fr,en}.json` (`music.localPlayer`, `music.localRoom`, `music.localFailed`).

### Mise à jour 2026-09-23 (17) — la page Musique choisit sa source : YouTube Music ou Radios

**Sélecteur de source.** La rangée de pastilles de sources en en-tête (section du 2026-09-22, « une
seule reliée aujourd'hui, avec son point d'état ») est **remplacée** par un `Segmented` en haut à
droite, dans `PageHeader` : « YouTube Music », plus « Radios » si le plugin `radio` est actif
(`plugins.byId.radio?.enabled`). Le choix est mémorisé (`kasbah.music.source`) ; si la source mémorisée
n'est plus active, la page **retombe sur YouTube Music** sans effacer le choix.

Le point « reliée » a disparu avec les pastilles, et pas par oubli : `Segmented` n'affiche que
l'icône quand on lui en donne une (le libellé devient l'infobulle), et un `sublabel` le passe en
disposition empilée, donc **change sa hauteur** — aucune des deux façons de porter un état ne tenait
dans le gabarit de l'en-tête sans le faire bouger. Clés i18n `music.sourceLinked` / `sourceUnlinked`
retirées.

**Ce que la source change, et ce qu'elle ne change pas.** La source choisie occupe **la recherche et
la zone centrale** ; le panneau « Écoute » et la barre du bas restent **communs** (une radio lancée se
pilote dans la même barre, qui gérait déjà `nowPlaying.live` : ni curseur ni saut).

**`RadioBrowser.vue`** (source Radios) :
- recherche au **même gabarit** que celle de YouTube Music — rien ne bouge en changeant de source ;
  mémoire `kasbah.radio.query` ;
- onglets **Favorites / Les plus écoutées** (`Segmented`, `kasbah.radio.tab`) ; les favorites sont
  celles de la maison, gardées par le serveur (`../3_plugins/3_19_radio.md`) ;
- liste en grille **`repeat(auto-fill, minmax(320px, 1fr))`** de `MusicItemRow`, chacune suivie d'une
  **étoile** (ajouter / retirer des favorites) ; ligne de méta = pays · codec et débit · trois tags ;
- la station « qui joue » est reconnue sur le lecteur choisi : `playing`, `nowPlaying.live` et titre
  égal au nom de la station ;
- touche **« Ajouter une radio »** : formulaire nom + URL du flux (validé `http(s)`), qui bascule sur
  l'onglet Favorites ;
- lecteur « Ce navigateur » choisi → message « La radio ne se lit pas encore dans ce navigateur :
  choisissez une enceinte » (pas de lecture locale pour la radio).

**`ArtThumb.vue`** : `@error` sur l'image → retour à l'icône de remplacement. Les logos de radio de
l'annuaire sont souvent disparus ou refusent le lien direct ; sans cela, le navigateur affichait son
image cassée.

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/RadioBrowser.vue`,
`apps/web/src/components/ui/{ArtThumb,Segmented}.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`i18n/locales/{fr,en}.json` (`radio.*`).

### Mise à jour 2026-09-23 (18) — source Mixcloud, logos de source, Réglages triés

**Troisième source.** « Mixcloud » s'ajoute au sélecteur de la section (17) si le plugin `mixcloud`
est actif (`plugins.byId.mixcloud?.enabled`), entre YouTube Music et Radios. Serveur :
`../3_plugins/3_20_mixcloud.md`.

**Le sélecteur passe aux logos.** Les options du `Segmented` portent désormais une icône :
`sourceYtmusic`, `sourceMixcloud`, `sourceRadio`, ajoutées à `lib/strokeIcons.ts` — les logos
**redessinés au trait** comme le reste du jeu, pas les marques en couleur. Comme le notait (17),
`Segmented` n'affiche que l'icône quand on lui en donne une : le nom de la source devient l'infobulle
et le libellé accessible. Le gabarit ne change donc pas (ce qui écartait un point d'état en (17)
reste vrai).

**Une lecture générique.** `MusicView.vue` gagne `playTracks(tracks, index)`, indépendant de la
source : la liste devient la file du lecteur choisi — une enceinte (`musicQueuePlay`, file côté
serveur) ou **ce navigateur** (`localPlayer.playQueue`) — par fenêtre de 100 pistes autour de celle
lancée, comme le faisait déjà YouTube Music. `nowPlayingTrack` est `{ source, id }` ; les listes
YouTube Music ne reconnaissent comme « en cours » qu'un id venu de `ytmusic` (`nowPlayingId`), pour
qu'un id Mixcloud ne s'allume pas par hasard ailleurs. Contrairement à la radio, **Mixcloud se lit
aussi dans le navigateur**.

**`components/music/MixcloudBrowser.vue`** (source Mixcloud) :
- tant que rien n'est relié : champ **nom d'utilisateur** et touche « Relier » sur la page même
  (texte : « Aucun mot de passe : Kasbah ne lit que ce que ton profil montre publiquement ») ;
- recherche au même gabarit que les autres sources ;
- onglets **Nouveautés / Favoris / Écoutés / Mes mix / Playlists / Suivis** (`Segmented`,
  `kasbah.mixcloud.tab`), sur la même rangée qu'une pastille « Compte @nom » qui délie ; rangée
  gardée (grisée) pendant une recherche ; sous Nouveautés, une ligne rappelle que le fil est recomposé
  et mis à jour toutes les 30 min ;
- une playlist ou un compte suivi s'ouvrent en **liste de mix**, avec une rangée « Retour » ;
- grille **`repeat(auto-fill, minmax(320px, 1fr))`** de `MusicItemRow` ; un mix écouté en partie
  affiche **« Reprendre à hh:mm:ss »** en tête de sa méta (le nom de l'auteur passe derrière) et le
  lancer part de cette position ;
- à droite de chaque ligne, une touche **« Repartir du début »** (`rotateLeft`) qui oublie la position
  (`DELETE /resume`) puis joue du début ; sa **place est toujours gardée** (`is-hidden` quand il n'y a
  rien à reprendre), pour qu'une ligne sans reprise ne se décale pas (règle « rien ne doit bouger »,
  `4_0_langage-visuel.md`) ;
- « Afficher plus » tant que l'API rend un curseur `next`.

Seule la piste **lancée** part avec sa reprise ; les suivantes de la file démarrent au début.

**`components/MixcloudLinkCard.vue`** : la même liaison dans Réglages → Plugins, avec en plus
« Changer de compte ».

**Réglages → Plugins trié.** `SettingsView.vue` range les sections de plugin par **ordre alphabétique
de leur nom affiché** (l'id, `_` remplacé par une espace : `google cast`, `open meteo`), et non plus
dans l'ordre où la liste arrive du serveur.

Sources : `apps/web/src/views/{MusicView,SettingsView}.vue`, `apps/web/src/components/music/MixcloudBrowser.vue`,
`apps/web/src/components/MixcloudLinkCard.vue`, `apps/web/src/components/settings/PluginSection.vue`,
`apps/web/src/lib/strokeIcons.ts`, `apps/web/src/stores/localPlayer.ts`,
`i18n/locales/{fr,en}.json` (`mixcloud.*`).

### Mise à jour 2026-09-23 (19) — Mixcloud : onglet Accueil, la touche du compte quitte la page

**Un onglet « Accueil », en premier et par défaut.** `MixcloudBrowser.vue` ajoute `home` en tête des
onglets de (18) ; c'est la nouvelle valeur par défaut de `kasbah.mixcloud.tab` (qui valait `feed`) —
un navigateur qui a déjà un onglet retenu le garde. L'accueil reprend celui du site : des **rangées
horizontales** de `MusicTile` (128 px, défilement horizontal avec `scroll-snap` léger), une par section
rendue par `GET /api/plugins/mixcloud/home` (composition côté serveur :
`../3_plugins/3_20_mixcloud.md`, « l'accueil, recomposé des écoutes publiques »). Titres :
« Tes créateurs », « Des comptes que tu suis », « Réécouter », « Plus de {nom} », « Émissions {genre}
populaires ».
- une tuile **créateur** est **ronde** (`round`, icône `person` faute de photo) et **ouvre** ses mix :
  même chemin que depuis Suivis (`openUser` → liste de mix avec la rangée « Retour ») ;
- une tuile **mix** **joue** ; la **rangée** devient la file (`play(m, sh.items)` — `play` accepte
  désormais la liste en second argument au lieu de toujours prendre la liste affichée) ; comme ailleurs,
  seule la piste lancée part de sa reprise, et « Reprendre à hh:mm:ss » apparaît dans la méta de la
  tuile. La touche « Repartir du début » des lignes n'existe pas sur les tuiles ;
- pendant le chargement, **trois rangées squelettes** de six tuiles au gabarit des vraies ; sans
  rangée, un message : « Mixcloud ne répond pas » en cas d'échec, sinon « Écoute quelques mix sur
  Mixcloud : l'accueil se compose de tes écoutes » (un compte sans écoute publique n'a pas d'accueil) ;
- une recherche, une playlist ou un compte ouverts remplacent l'accueil (`showsHome`) comme ils
  remplacent les autres listes.

**La pastille « Compte @nom » qui déliait est retirée de la page** (demande de l'utilisateur) : la rangée
des onglets ne porte plus que le `Segmented`. Ce que (18) décrivait — « sur la même rangée qu'une
pastille « Compte @nom » qui délie » — n'est donc plus vrai à partir de cette date. Relier, **changer**
et **délier** se font dans la fiche du plugin, Réglages → Plugins (`MixcloudLinkCard.vue`, qui avait
déjà les trois). Le champ « Relier » de la page reste, lui, tant qu'aucun compte n'est relié. Clé i18n
`mixcloud.account` supprimée ; `mixcloud.unlink` reste (utilisée par la fiche).

Transport : `mixcloudHome()` et le type `MixcloudHomeSection` (union discriminée par `kind` / `id`,
calquée sur `HomeSection` du serveur) ; le mock lève `501 NOT_IMPLEMENTED` comme les autres `mixcloud*`.

Sources : `apps/web/src/components/music/{MixcloudBrowser,MusicTile}.vue`,
`apps/web/src/components/MixcloudLinkCard.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`i18n/locales/{fr,en}.json` (`mixcloud.tabHome`, `mixcloud.home*`), arbre non commité après 1839a21.

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

## Mise à jour 2026-09-24 — volets solaires : fiche et cartes de la vue Ouvrants

**Fiche du volet** (`CoverControl.vue`), sous la position perso et selon les capacités :
- **Mode discret** : ligne de 40 px, icône lune + interrupteur (`cover.set_quiet`), toujours actif
  pendant une course puisqu'il ne bouge rien ;
- **Batterie** : ligne de 32 px, valeur à droite en chiffres fixes, rouge sous 20 % ;
- **Luminosité** (`LightHistoryChart.vue`), quand un capteur `illuminance` déclare `meta.linkedTo`
  vers ce volet : valeur du moment, sélecteur Jour / Mois / Année, barres du MAXIMUM par heure, jour
  ou mois (`GET /api/plugins/tahoma/light/:id`, relu toutes les 5 min). Tracé de hauteur FIXE (96 px) ;
  un pas non mesuré est un tiret en pointillé, comme le graphe de consommation d'eau dont il
  réutilise le découpage (`lib/consumption.ts`, `bucketSlots`). La fiche du capteur lui-même
  (`SensorCard.vue`) montre le même graphe.

**Cartes de la vue Ouvrants** (`CoversView.vue`), réorganisées à la demande de l'utilisateur, qui
trouvait le curseur trop petit pour le doigt :
- trois lignes : nom + état ; touches ; **curseur seul sur toute la largeur** (piste ~308 px au lieu de
  ~110, pouce 22 px, piste 6 px via les props `thumb-size` / `track-size` de Vuetify, qui les pose en
  style inline — une variable CSS n'y fait rien). Ligne de 148 px au lieu de 98 ;
- touches de 40 px : **manœuvres à gauche** (ouvrir / stop / fermer), **réglages à droite** (position
  perso, mode discret — bascule `aria-pressed`, teinte d'accent quand allumée), séparés par un espace
  extensible ;
- **luminosité et batterie** au bout de la ligne d'état (slot `status-after` de `RoomBands`), largeurs
  minimales réservées pour qu'un chiffre qui s'allonge ne pousse pas le statut.

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

### Mise à jour 2026-09-24 — le lecteur du panneau appareil rejoint la barre Musique

**Pourquoi.** Le lecteur du panneau (vue 3D, `MediaPlayerControl.vue`) n'avait que précédent,
lecture, suivant — et ses précédent / suivant envoyaient `media_player.next` à l'enceinte. Or un
lecteur qui joue un flux **servi par Kasbah** (YouTube Music, Mixcloud) n'a qu'un « fichier » : la
file vit sur le serveur (« (6) » plus haut), l'enceinte n'a rien à sauter. L'appui ne faisait rien.

**La rangée** est désormais celle de la barre de la page Musique : répéter, précédent, −10 s,
lecture / pause, +10 s, suivant, stop. Sept touches dans les **285 px** de contenu du panneau fixe de
340 px : aux tailles Vuetify par défaut la rangée débordait de 32 px, d'où des tailles fixées dans le
composant (36 px les touches de texte, 40 px les tonales, 50 px la lecture) et un
`justify-content: space-between` ; la rangée étant symétrique, lecture reste au centre. Le pas
(« 10 », « 1 », « ∞ ») vit au centre de la flèche, comme dans la barre.

**Ce qui se grise** (rien ne disparaît, règle « rien ne bouge ») :
- **direct** (`nowPlaying.live`) : répéter, précédent, suivant et ±10 s grisés ; lecture / pause,
  stop et volume restent actifs ;
- **au repos** : tout grisé ;
- **répéter** n'est actif qu'avec une file serveur ; suivant se grise sur le dernier titre de la file.

Changement discret : précédent / suivant étaient en `v-if="has('track_skip')"` et **disparaissaient**
sur un lecteur sans cette capacité ; ils sont maintenant toujours rendus, grisés.

**Qui reçoit l'appui.** Avec une file serveur, suivant / précédent / répéter passent par
`musicQueueNext` / `musicQueuePrevious` / `musicQueueRepeat` ; sans file, on retombe sur
`media_player.next` / `previous` et la capacité `track_skip`, comme avant. La session est suivie par
un composable dédié, `composables/useMusicSession.ts` : il ne lit que CE lecteur dans
`GET /api/music/sessions`, relit 800 ms après un changement d'état ou de titre (le délai de la page
Musique : laisser le serveur lancer le titre qu'il enchaîne) et toutes les 20 s, et ne fait **aucun
appel** si l'appareil n'a pas `play_url`. La session survit au morceau (TTL serveur) : le panneau ne
l'écoute que tant que le lecteur est en lecture ou en pause.

**Qualité du flux**, au milieu de la ligne des temps (grille `5ch | 1fr | 5ch`), en 10 px à
`opacity: .6` : c'est une info de connaisseur, pas de lecture, elle doit peser moins que les temps qui
l'encadrent. Info-bulle pour le détail. Le calcul est partagé avec la barre Musique dans
`lib/streamQuality.ts` (`qualityLabel`, `qualityDetails`, `streamQuality`) ; pour une radio, la
qualité est celle de l'annuaire (voir `../3_plugins/3_19_radio.md`, « Qualité d'une radio »).
Vérifié en réel sur un Sonos avec un mix servi par Kasbah : « AAC 64 kb/s », pied et
rangée de touches sans débordement à 90, 100 et 125 % de zoom.

**Pied « Page Musique / Ouvrir »**, même motif que « Réglages / Modifier » (`card card--soft`,
libellé `muted`, pastille ; clés `media.musicPageHint`, `media.openInMusic`). Il écrit l'id de
l'appareil dans `localStorage['kasbah.music.session']` — la clé que `MusicView.vue` lit pour son
lecteur choisi ; `useLocalStorage` de VueUse synchronise aussi dans le même document, donc le choix
passerait même si la page Musique était gardée en vie (aujourd'hui seule `HomeView` l'est, `App.vue`)
— puis pousse la route `music`.

Tests montés du composant enrichis (`MediaPlayerControl.test.ts`). Voir aussi le piège du style
scoped périmé rencontré pendant cette session : `../6_faq/6_0_pieges-outillage.md`, 2026-09-24.

Sources : `apps/web/src/components/controls/MediaPlayerControl.vue`,
`apps/web/src/components/controls/MediaPlayerControl.test.ts`,
`apps/web/src/composables/useMusicSession.ts`, `apps/web/src/lib/streamQuality.ts`,
`apps/web/src/components/music/MusicPlayerBar.vue`, `apps/web/src/views/MusicView.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`, arbre de travail non commité du 2026-09-24 (après 553ff9c).

### Mise à jour 2026-09-25 — entrée de rail LOCALE (TENS) et « Sur cet appareil » dans les Réglages

Une entrée du rail peut désormais dépendre du **poste** et non de la maison : `NavItem.local`
(`lib/navItems.ts`) nomme un plugin local, et `visibleNavItems(isEnabled)` filtre la liste pour le
rail (`layout/NavRail.vue`) comme pour la recherche (`composables/useSearch.ts`). Première entrée
concernée : **TENS** (icône `pulse`, route `/tens`, entre Animaux et Automatisations — juste avant
ce que la maison fait seule, qui ne peut justement pas l'atteindre).

Réglages : un bloc **« Sur cet appareil »** précède la liste des plugins de la maison, avec un
interrupteur par plugin local, enregistré dans le navigateur (`stores/localPlugins.ts`,
`kasbah.localPlugins`) et non dans house.json. Sur une tablette murale, rien n'apparaît.

La vue `views/TensView.vue` suit la règle « rien ne bouge » (mesuré au `getBoundingClientRect()`
entre repos, connecté, séance, montée et pause) : emplacements des boutons de connexion réservés,
ligne d'erreur réservée, cartes Séance et Programmes à hauteur égale côte à côte (Pause / Arrêter
collés en bas), noms de programmes sur deux lignes plutôt que tronqués, point pulsant (`PulseDot`)
à place réservée pour le programme en cours. Détail du plugin : `../3_plugins/3_21_actitens-tens.md`.

Sources : `apps/web/src/lib/navItems.ts`, `apps/web/src/components/layout/NavRail.vue`,
`apps/web/src/composables/useSearch.ts`, `apps/web/src/views/SettingsView.vue`,
`apps/web/src/views/TensView.vue`, `apps/web/src/stores/localPlugins.ts`.

### Mise à jour 2026-09-26 — « Modeler le terrain » : l'éditeur du relief

Réglages → Rendu 3D → **Modeler le terrain** → vue Maison, avec le panneau `ReliefPanel` flottant
à la place du banc de lumière (même gabarit ; ouvrir l'un ferme l'autre). État
`settings.reliefEditing`, jamais persisté ; le watcher de `scene.ready` rejoue le mode au chargement.

- **Point … m** : champ de l'altitude du point choisi (m, virgule ou point), grisé sans point choisi,
  toujours à la même place. Un point choisi à la **souris** donne la main au champ, valeur
  sélectionnée : on tape la valeur, Entrée, clic suivant, sans aller chercher le champ. **Pas au
  doigt** : le clavier virtuel s'ouvrirait à chaque tap et couvrirait la scène. Échap abandonne.
- **Flèches** : point voisin dans le sens de l'écran, depuis le canevas comme depuis le champ (ce qui
  y était tapé est validé d'abord). ↑/↓ ne font donc plus varier la valeur du champ.
- **↶ ↷** dans l'en-tête, et **Ctrl+Z / Ctrl+Y** (ou Ctrl+Maj+Z) : 10 pas. Dans le champ, les
  raccourcis restent ceux du champ — sauf juste après un clic, tant que rien n'est tapé.
- **Importer l'IGN** (`lib/ignRelief.ts`) : un point par nœud, MNT LiDAR HD (50 cm) d'abord, les
  points sans donnée (`-99999`) redemandés au RGE ALTI (1 m), 150 points par requête ; le zéro est
  l'altitude **médiane sous les pièces**, pas `origin.alt`. Ne remplace que le brouillon. Sur une
  parcelle réelle (sondé le 2026-09-26) : pas de LiDAR, et le RGE ALTI ne montre qu'une pente douce
  — ni bosses ni talus.
- **Tout à zéro** : aplanit le brouillon ; passe par l'historique, donc sans confirmation.
- **Vue N / E / S / O / Dessus** : cf. `viewTerrainFrom` dans `../1_architecture/1_5_scene-3d.md`.
- **Annuler** (retour au dernier relief validé, sortie), **Valider** (écrit sans quitter, grisé
  s'il n'y a rien à écrire), **Terminer** (écrit puis sort). La croix vaut Annuler.

La ligne d'état de l'import a une hauteur réservée : son message n'écarte rien (règle « rien ne
bouge »).

Sources : `apps/web/src/components/home/ReliefPanel.vue`, `apps/web/src/views/{HomeView,SettingsView}.vue`,
`apps/web/src/stores/{settings,house}.ts`, `apps/web/src/lib/ignRelief.ts`, `apps/web/src/lib/strokeIcons.ts` (`undo`, `redo`),
`apps/web/src/i18n/locales/{fr,en}.json` (`relief.*`).

### Mise à jour 2026-09-26 — panneau d'ouverture : cap d'un Velux sur un versant

Sur un versant, le cap d'un Velux est imposé par la pente (`../2_maison/2_1_geometrie.md`). Dans
`OpeningPanel.vue`, la ligne **Orientation (°)** reste à sa place (règle « rien ne bouge ») mais est
**grisée** (champ et boutons − / +), et affiche le cap réel ; `apply('yaw')` ne fait rien. Les quatre
cotes et le glissement par cote passent par l'emprise (`surfaceFootprint`) : dans la démo, 2,61 /
1,31 / 1,95 / 1,95 m, identiques aux traits de la scène. La longueur affichée reste la taille du Velux
le long de la pente (1,20 m).

Sources : `apps/web/src/components/home/OpeningPanel.vue`.

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

### Mise à jour 2026-09-28 (bis) — page Musique : dernière écoute en pause, genres Mixcloud, la file partout

Arbre de travail non commité après c6fe7c1. Serveur : `../1_architecture/1_6_lecteur-musique.md` et
`../3_plugins/3_20_mixcloud.md`, sections du 2026-09-28 ; store : `../1_architecture/1_4_app-web.md`.

**(a) La barre montre la dernière écoute d'une enceinte, en pause.** Après un redémarrage du serveur
ou un arrêt, la barre (`MusicPlayerBar.vue`, nouvelle prop `resume`) affiche le titre, la pochette, la
position et la durée de ce que jouait l'enceinte, **en pause**. Lecture → `musicResume` (file et
répétition comprises) ; le **curseur et les sauts de 10 s ne font que choisir la position de départ**
(`resumeAt` dans `MusicView.vue`) — rien n'est envoyé à l'enceinte, qui n'a plus rien à déplacer.
Précédent, suivant, stop et répétition sont **grisés tant que `resume` est posé** (`canPrevious`,
`canNext` et le `disabled` de stop testent `!resume`) : une enceinte restée **en pause** sur le flux
mort a `loaded` vrai, et sans ce test ses capacités (`track_skip`) auraient allumé des touches qui
seraient parties vers elle. La répétition, elle, n'a pas de file vivante à régler. `MusicView` lit
`musicLast()` avec `musicSessions()` à chaque rafraîchissement.

**Quand la montrer — `selectedLast`.** Seulement si le lecteur n'a **aucune session vivante** de
nous, qu'il **ne joue pas**, et, s'il est **en pause**, qu'il montre encore **notre** titre, un nom
de fichier `<sid>.m4a` (le Sonos publie parfois le nom du fichier servi) ou une URL — un flux mort,
donc. Autre chose en pause (une appli, une radio lancée ailleurs) : c'est ça que la barre montre, pas
un souvenir qui le masquerait.

**(b) Ce navigateur aussi** : après un rechargement, le titre est là en pause à sa position, file
visible, précédent / suivant actifs ; même logique du curseur (point de départ seulement). Mécanique :
`1_4_app-web.md`, état `restored`.

**(c) Genres Mixcloud en pastilles** — `components/music/GenrePills.vue`, posées sous chaque mix par
un slot `extra` ajouté à `MusicItemRow` (lignes) et à `MusicTile` (tuiles de l'accueil). Les tags
quittent la méta.
- Une ligne de **hauteur fixe (20 px)** : ce qui ne tient pas **s'estompe à droite** (la suite existe)
  et **défile** façon `MarqueeText` — au survol de la tuile ou de la ligne avec une souris, en continu
  sur un écran tactile (pas de survol), jamais sous `prefers-reduced-motion`.
- **Piège corrigé** : `.gp__inner` en `inline-flex` se posait sur la **ligne de base** et descendait
  de 4 px, rognant le bas des pastilles ; passé en `display: flex` + `width: max-content`.
- Un genre gardé par le filtre s'allume **à la couleur seule** : un gras élargirait la pastille, et le
  défilement mesuré ne serait plus le bon.

**(d) La rangée de filtres** (`MixcloudBrowser.vue`), entre les onglets et la liste :
- **trois états** par pastille, cycle neutre → gardé → écarté (règle : `3_20_mixcloud.md`) ; l'état se
  lit **aux couleurs et au trait seulement** — gardé = accent, écarté = bord pointillé et texte barré,
  sans icône ni gras : **largeur constante** (demande de l'utilisateur, règle « rien ne bouge ») ;
- **composée des mix reçus** : à l'accueil, toutes les rangées de mix, **dédoublonnées par mix** (un
  mix présent dans plusieurs rangées ne compte qu'une fois) ; dans une liste, la page chargée. Classée
  par fréquence **avant filtre** ; l'ordre ne change pas quand on choisit, et les genres choisis
  absents des mix reçus vont **à la fin** (ils restent pour pouvoir être défaits) ;
- choix mémorisé dans `kasbah.mixcloud.genres` (nom + état) ;
- **une seule ligne qui défile** : la molette verticale d'une souris la fait avancer à l'horizontale ;
  barre fine globale de l'appli (`apps/web/src/styles/app.css`, `* { scrollbar-width: thin }`, qui
  fait ignorer les règles `-webkit-scrollbar`). **Hauteur réservée de 44 px, barre comprise**, qu'elle
  soit là ou non ; libellé « Genres » et bouton calés en haut (marge 4 px, hauteur 28 px) comme les
  pastilles ; fondu au bord **du côté où la rangée continue** (`data-fade-start` / `data-fade-end`,
  recalculés au défilement et par `ResizeObserver`) ;
- **« Tout remettre »** : bouton discret **sans bordure, avec l'icône `undo`** — l'utilisateur ne le
  distinguait pas des pastilles quand il en avait l'air ; sa place est gardée, invisible, sans filtre ;
- **grisée, pas masquée**, sur Playlists et Suivis (rien à filtrer) : rien ne bouge en changeant
  d'onglet ;
- la file lancée depuis une liste = la liste **filtrée** (`play` prend `shownMixes`) ; sans mix
  restant : « Aucun mix ne correspond à ces genres ».

**(e) Durée sur les tuiles de l'accueil** : prop `badge` de `MusicTile`, étiquette sombre en bas à
droite de la pochette — elle ne prend aucune place au texte. Les lignes avaient déjà la durée à droite.

**(f) Bug corrigé : la file n'existait que pour YouTube Music.** La vue File de (6) vivait dans la
branche YouTube Music de `MusicView.vue` ; depuis l'arrivée des sources (17) et (18), la touche File
de la barre **basculait sans rien montrer** sous Mixcloud ou Radios — alors même que sa pastille
annonçait des mix en attente. La liste est extraite dans `components/music/QueueList.vue` et prend la
zone centrale **quelle que soit la source**, avec sa rangée « Retour » / « Vider la file ».
`RadioBrowser` et `MixcloudBrowser` restent **montés** (`v-show`) : on les retrouve tels quels au
retour (onglet, défilement, recherche).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/{MusicPlayerBar,MixcloudBrowser,GenrePills,QueueList,MusicItemRow,MusicTile}.vue`,
`apps/web/src/stores/localPlayer.ts`, `apps/web/src/styles/app.css`, `i18n/locales/{fr,en}.json`
(`mixcloud.genres`, `mixcloud.genresReset`, `mixcloud.genresEmpty`, `mixcloud.genreNeutral|On|Off`).

### Mise à jour 2026-09-29 — la touche lecture tourne jusqu'à ce que l'enceinte joue

**Bug.** Lecture sur la dernière écoute (en pause après un rechargement ou un redémarrage du serveur) :
le sablier ne durait que l'appel `musicResume`. Le serveur répond une fois le lancement fait, mais
l'enceinte publie « lecture » un peu après ; entre les deux, `pending` était retombé, la dernière
écoute oubliée, l'enceinte encore au repos : la touche revenait à un « lire » grisé, sans sablier.

**Correctif** (`MusicPlayerBar.vue`) : un état local `starting`, posé au clic sur lecture, levé dès que
l'état du lecteur passe à `playing`, au changement de lecteur, ou au bout de `STARTING_MAX_MS`
(15 s) si l'enceinte ne suit jamais. La touche tourne (`busy` = `pending` ou `starting`) et reste
désactivée pendant ce temps ; même taille, rien ne bouge. Sur une lecture **directe** (enceinte en
pause sur un flux vivant), le patch optimiste du store (`lib/optimistic.ts`) passe aussitôt à
`playing` : la touche montre « pause » tout de suite, comme avant. Le Cast mappe déjà `BUFFERING`
sur `playing` côté serveur : le trou n'était pas là.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/components/music/MusicPlayerBar.test.ts` (« attente de la lecture »).

## Mise à jour 2026-09-28 — ouvrants : une vignette verticale à la place des curseurs horizontaux

**Pourquoi.** Retour de l'utilisateur : la vue Ouvrants « perturbe », ses curseurs sont horizontaux
alors qu'un volet, un store ou une porte de garage bougent de haut en bas. La jauge peinte en fond de
ligne (section du 2026-09-12) se remplissait elle aussi de gauche à droite.

**Ce qui remplace quoi.** Jusqu'ici, une ligne de la vue Ouvrants portait l'icône de l'appareil, une
jauge d'accent en fond de ligne (`.row-open`) et un `v-slider` sur toute la largeur (sections du
2026-09-08 et du 2026-09-12). Depuis le 2026-09-28, **`components/covers/CoverPill.vue`** remplace les
trois : une vignette qui EST l'ouvrant vu de face.
- Le fond est la baie, un dégradé d'accent (« le jour qui passe ») : un ouvrant ouvert se remarque
  sans lire la ligne, ce que faisait la jauge.
- Le tablier descend du haut à la part de FERMETURE (convention de `lib/cover.ts`, 0 % = ouvert),
  avec une lame finale d'accent de 3 px et un coffre de 5 px minimum : le bord reste visible sur un
  ouvrant tout ouvert. Il a des **lames** pour `shutter` et `garage`, une toile unie pour le reste.
  Un **portail** (`gate`) se ferme de côté : le vantail entre par la gauche.
- **Glissement relatif** (le point de départ est la position actuelle, jamais l'endroit où tombe le
  doigt), avec un seuil de 4 px : sur tablette, un doigt qui fait défiler la page et s'arrête sur la
  vignette n'envoie pas l'ouvrant à l'autre bout, et un simple appui ne commande rien.
  `touch-action: none` sur la vignette seule, qui est étroite. Au clavier : flèches par pas de 10,
  Début et Fin.
- Position favorite : un trait d'avertissement sur la vignette (`.pill__preset`). Position inconnue :
  baie en pointillés, sans tablier. Glissable seulement avec la capacité `position`, un appareil
  joignable et une ouverture déjà connue (pas pour un ouvrant « sans ouverture »).
- Taille réglée par le parent au moyen de propriétés héritées : `--pill-w`, `--pill-h`, `--pill-r` et
  `--pill-rows` (par défaut `span 2`, pour occuper la 1re colonne sur la ligne du nom ET celle des
  touches).

**Liste (`CoversView.vue`).** La vignette arrive dans un nouveau slot **`leading`** de `RoomBands`,
dont l'icône actuelle est le contenu par défaut : les autres vues ne changent pas. Les touches passent
en `grid-column: 2 / -1`, à droite de la vignette, et la ligne du curseur disparaît : la carte est
plus compacte (108 px par ligne mesurés). **Sur un téléphone** (375 px), il ne reste que 157 px à
côté de la vignette : les touches **passent à la ligne** (`flex-wrap`), et les réglages (position
perso, mode discret) vont sous les manœuvres. Cette hauteur ne dépend que de la largeur, jamais de
l'état : la règle « rien ne bouge » tient (0 élément déplacé sur 27 pendant une manœuvre, mesuré).
Rétrécir les touches à 34 px a été écarté : une cible tactile ne se sacrifie pas pour tenir.

**Panneau appareil (`CoverControl.vue`).** Même vignette en grand (88 × 170 px). À sa droite, la
ligne d'état et les touches Ouvrir / Stop / Fermer **empilées dans le sens du mouvement** (Ouvrir en
haut). Le reste est inchangé (position perso, mode discret, batterie, courbe de luminosité).
**L'inclinaison** (`tilt`) garde un curseur horizontal : c'est l'ANGLE des lames d'un store vénitien
ou d'un brise-soleil orientable, pas un déplacement, donc aucun sens à respecter. Un volet roulant n'en
a pas : la simulation en prête une à « Volet chambre 1 ».

**Piège de mise en page rencontré.** Dans le panneau, la vignette gardait son `grid-row: span 2` de
la liste : la grille créait une seconde rangée implicite, et la vignette mesurait 170 + 14 px (l'écart
entre rangées). D'où `--pill-rows: auto` dans le panneau. Autre constat : dans la ligne de liste,
`align-self: stretch` laissait la vignette à sa hauteur minimale, alors que `height: 100%` prend bien
toute la zone (87 px mesurés).

**Bug corrigé au passage (antérieur à la refonte).** `CoverControl` lisait ses capacités une seule
fois, à la création (`const hasTilt = props.descriptor.capabilities.includes(…)`). Or le panneau
réutilise le composant quand on passe d'un ouvrant à un autre : le volet baie affichait l'inclinaison
de « Volet chambre 1 » et perdait sa position perso, son mode discret et sa batterie. Ce sont
désormais des `computed`. La correction est limitée aux ouvrants. Les autres contrôles de
`DeviceControl` n'ont pas été vérifiés et peuvent avoir le même défaut : une `:key` sur le
descripteur les couvrirait tous, mais les recréerait tous.

**`.cover-slider` supprimé** de `styles/app.css` : plus aucun curseur d'ouvrant ne l'emploie. Les
sections du 2026-09-1x qui le décrivent (repère de 28 px, piège `--first` / `--last` de Vuetify)
restent vraies pour l'historique. Les repères de la jauge de charge (Véhicules) et de TENS citent
encore sa géométrie dans leurs commentaires : ils ont leur propre style.

**Pastille « placé » cliquable (toutes les vues `RoomBands`).** La pastille de position d'un appareil
placé (`json` ou `auto`) est devenue un bouton qui ouvre la maison 3D sur l'appareil : son niveau, sa
pièce cadrée, l'appareil sélectionné. L'ordre est celui de « Placer » et de la localisation de la page
Musique : **naviguer d'abord, sélectionner ensuite** (`HomeView` sous keep-alive, cf. 6_1). Le
survol dit « Position définie dans house.json · Voir dans la maison 3D » (nouvelle clé
`rooms.origins.show`, fr/en). Un appareil non placé garde son bouton « Placer ».

Sources : `apps/web/src/components/covers/CoverPill.vue`, `apps/web/src/views/CoversView.vue`,
`apps/web/src/components/controls/CoverControl.vue` (+ `CoverControl.test.ts`),
`apps/web/src/components/devices/RoomBands.vue` (slot `leading`, `show()`), `apps/web/src/styles/app.css`,
`i18n/locales/{fr,en}.json` (`rooms.origins.show`).

### Complément 2026-09-28 — l'appui vise, le glissement ajuste

Plus haut dans cette section, un simple appui sur la vignette « ne commande rien ». Ce n'est plus le
cas : à la demande de l'utilisateur, **un appui sans glisser envoie l'ouvrant là où tombe le doigt**
(fermeture lue depuis le haut, ou depuis la gauche pour un portail). Cela vaut dans les cartes de la
vue Ouvrants comme dans le panneau, puisque c'est le même composant. Le glissement reste relatif,
avec son seuil de 4 px. Un `pointercancel` n'est jamais pris pour un appui.

La crainte qui avait fait écarter l'appui (un doigt qui fait défiler la page et s'arrête sur la
vignette) ne tenait pas. La vignette porte déjà `touch-action: none` : un geste qui commence dessus
ne fait jamais défiler la page, il est donc voulu. **Risque restant** dans la liste, où la vignette
fait 44 px de large : un appui de travers sur la ligne peut désormais bouger un volet. Si c'est gênant
à l'usage, il faudra limiter l'appui au panneau. Tests : `components/covers/CoverPill.test.ts` (appui
vertical, appui de côté, glissement relatif, ouvrant qui ne vise pas). Vérifié dans la preview :
panneau (75 %) et liste (40 %).


### Mise à jour 2026-09-28 — le jardin en mode édition : section « Jardin » et `GardenPanel`

L'interrupteur des Réglages, devenu « Régler la maison » le 2026-09-18 (8), s'appelle désormais
**« Régler la maison et le jardin »**, et son aide cite les arbres, buissons et pierres à planter,
déplacer ou retirer (`render.houseEditing` / `.houseEditingHint`, fr/en). Il arme maintenant trois
choses : ouvertures, places, jardin.

- **Panneau de la maison en édition** : sous les places, la section **Jardin**
  (`GardenSection.vue`). En-tête « Jardin · N éléments », cinq tuiles de famille à icône trait
  (grille de 5 colonnes, libellé tronqué en ellipse), une pastille par espèce du catalogue, puis un
  bouton **« Terminé » toujours présent** (grisé tant que rien n'est armé : la section ne saute pas
  quand on arme). L'aide sous le bouton a une hauteur minimale réservée et change de texte selon
  l'arme. Une tuile armée reste armée entre deux plantations. La toucher à nouveau, « Terminé » ou
  un tap hors du terrain la désarme.
- **`GardenPanel.vue`**, ouvert par un tap sur l'élément dans la 3D : titre = l'espèce ou la famille,
  touches de famille, pastilles d'espèce (« Générique » + celles de la famille), hauteur −/+ et
  saisie (pas de 0,1 m sous 2 m, 0,5 m au-dessus), orientation par 15° et saisie, « Autre forme »,
  « Supprimer » en deux temps. Idiomes de `ParkingPanel`.
- **`HomeView`** : `panelMode` gagne `'garden'` (après l'ouverture et la place, avant l'appareil). Un
  tap de fond désarme puis désélectionne. Un tap sur une pièce ne ferme pas le panneau pendant le
  réglage d'un élément (même garde-fou que pour une ouverture ou une place). Couper le mode édition
  désarme et désélectionne le jardin.

Récit et décisions : `../2_maison/2_2_jardin.md`.

Sources : `apps/web/src/components/home/{GardenSection,GardenPanel,HouseEditPanel}.vue`,
`apps/web/src/views/HomeView.vue`, `apps/web/src/i18n/locales/{fr,en}.json` (`garden.*`), arbre de
travail non commité après cf60c7d.

### Mise à jour 2026-09-29 — panneau d'édition de la maison en accordéon, bouton « Terminer »

Le panneau de la maison en mode édition range ses trois sections (fenêtres de toit, places, jardin)
dans des accordéons exclusifs (`EditSection.vue`) : une seule ouverte à la fois, retenue sur le
poste, aucune au premier affichage. Replier une section désarme la pose qu'elle a lancée. Son en-tête
porte un bouton **« Terminer »**, qui éteint le mode édition. Armer le mode dans les Réglages mène
directement à la vue Maison. Détails, et la section Jardin par famille : `../2_maison/2_2_jardin.md`
(mise à jour du 2026-09-29, soir).

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

### Mise à jour 2026-10-01 — modifier le contour du terrain

**Demande** : bouger, ajouter, supprimer les points du polygone du terrain, y compris depuis
« Régler la maison et le jardin ».

**Deux entrées, un seul éditeur.** L'éditeur « Modeler le terrain » (`ReliefPanel.vue`) gagne deux
onglets **Relief | Contour** (`Segmented`), état `settings.terrainTab` (jamais persisté ;
`setReliefEditing(v, tab?)`, `setTerrainTab`). Le panneau du mode « Régler la maison »
(`HouseEditPanel.vue`) a un bouton « Modifier le contour du terrain » : il désarme les poses en
cours, désélectionne place / arbre / ouverture, ferme le banc de lumière et ouvre l'éditeur sur
Contour. **Écarté** : poser les poignées du contour directement dans le mode « Régler la maison »
— un tap sur le terrain y plante déjà un arbre et un glissement y déplace place ou ouverture :
trois gestes sur le même sol.

**Gestes** (`OutlineEditor`, détails dans `../1_architecture/1_5_scene-3d.md`) : tap sur un sommet
= le choisir ; tap sur la poignée au milieu d'un côté = y insérer un sommet ; glisser le sommet
choisi ; saisie X/Y dans le panneau ; « Supprimer le sommet » ou Suppr / Retour arrière (hors
champ de saisie) ; minimum 3 sommets. Un contour qui se croiserait est refusé au geste et à la
saisie. Ctrl+Z / Ctrl+Y et les boutons annuler/rétablir de l'en-tête agissent sur l'onglet
courant ; les flèches ne concernent que le relief.

**Avertissement, pas blocage** (choix de l'utilisateur). Une ligne d'état de l'onglet Contour
compte ce que le nouveau contour met DEHORS et qui était DEDANS dans le contour enregistré :
éléments du jardin (par leur centre), places au sol (sans `levelId`, centre), zones (un sommet
suffit), appareils extérieurs placés (sans niveau résolu), « une partie de la maison » (un sommet
de pièce). Tolérance de 5 cm sur le bord. **Piège trouvé en preview** : la zone « allée » de la
maison démo partage un coin avec le terrain ; sans la tolérance ni la règle « qui était dedans »,
elle était signalée dehors alors qu'on AGRANDISSAIT. Rien n'est retiré du fichier.

**Valider / Terminer / Annuler.** Valider écrit le contour d'abord (`PUT /api/house/terrain`),
puis le relief s'il diffère encore (relu après : le serveur a pu l'agrandir comme le brouillon).
Terminer = écrire puis quitter ; Annuler = revenir au terrain enregistré.

**Rien ne bouge.** Les deux onglets sont empilés dans la MÊME cellule de grille, l'inactif en
`visibility: hidden` + `inert` : le panneau mesure 300 × 518 px en fr comme en en, dans les deux
onglets, avec ou sans avertissement (3 lignes réservées). Il est borné à
`max-height: calc(100% - 108px)` et son corps défile : à l'équivalent zoom 150 % (viewport
853 × 533) il tenait plus, il débordait déjà un peu avant les onglets. **Piège de vérification** :
`document.documentElement.style.zoom` ne simule pas le zoom navigateur (la scène grandit avec) ;
utiliser un viewport équivalent.

i18n : `relief.tabs.*`, `relief.outline.*` (fr / en, pluriels à trois formes) ; le `relief.hint`
des Réglages mentionne l'onglet Contour.

**Import de la parcelle cadastrale** : fait le même jour, voir la section suivante.

Sources : `apps/web/src/components/home/{ReliefPanel,HouseEditPanel}.vue`,
`apps/web/src/stores/{settings,house}.ts`, `apps/web/src/i18n/locales/{fr,en}.json`,
`apps/web/src/views/HomeView.vue` (arbre de travail non commité après 1ce4a91).

### Mise à jour 2026-10-01 — « Importer le cadastre » (onglet Contour)

Un bouton **Importer le cadastre** à côté de « Supprimer le sommet » remplace le BROUILLON du contour
par la parcelle cadastrale qui porte la maison — comme l'import IGN du relief, rien n'est écrit avant
Valider, et le remplacement est un pas d'historique (`OutlineEditor.setPolygon`,
`HouseScene.setOutlineDraft`), sans sommet choisi.

**Source** (`lib/ignParcel.ts`, `fetchIgnParcel`) : Parcellaire Express de l'IGN, WFS de la
Géoplateforme (`data.geopf.fr/wfs/ows`, couche `CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle`),
ouvert, sans clé, CORS ouvert, appelé depuis le navigateur. Mesuré le 2026-10-01 :

- **Interroger par emprise (`BBOX`), pas par point** : `CQL_FILTER=INTERSECTS(geom,POINT(…))` rend
  zéro parcelle dans un sens d'axes comme dans l'autre. La BBOX (en `lat,lon` pour
  `urn:ogc:def:crs:EPSG::4326`) couvre les pièces de la maison à 1 m près ; la réponse GeoJSON est en
  `[lon, lat]`, convertie par `geoToLocal(origin, …)`.
- **Parcelles gardées** : celles qui contiennent le centre d'au moins une pièce (sans pièce, l'origine).
  Une maison à cheval sur plusieurs parcelles les reçoit **fusionnées** (`mergeParcels` : contours
  orientés dans le même sens, un côté parcouru dans les deux sens disparaît, le reste doit former UNE
  boucle). Sinon (sommets non partagés, parcelles disjointes), la parcelle qui porte le plus la maison
  est gardée seule, et le message le dit.
- **Nettoyage** : arrondi au centimètre, doublons retirés, et tout sommet à moins de 5 cm de la droite
  de ses voisins (`COLLINEAR_M`) — un côté courbe du cadastre en faisait des dizaines ; la parcelle CT 15
  de Dijon en garde 14. Un résultat qui se croise est refusé.
- **Exactitude** : le contour est placé par `origin` ; tant que `origin` n'est pas calé sur la photo
  (cf. `2_0_format-house-json`), il peut être décalé de quelques mètres — comme le relief IGN.

**Messages** (ligne d'état de l'onglet, avant l'avertissement « hors du nouveau contour ») :
« Parcelle CT 15 chargée (1 192 m²). Validez pour la garder. », « Parcelles … fusionnées », « Parcelle …
seule chargée … », et deux échecs dits en clair (`IgnParcelError`, codes `none` / `shape`) : aucune
parcelle sous la maison (domaine public, ou `origin` décalé), contour inutilisable ; une panne réseau
reste « Cadastre indisponible : … ». Le message s'efface dès que le brouillon n'est plus celui de
l'import, ou après Valider. La ligne d'état n'est plus rouge en entier : seul l'avertissement l'est
(`.relief__warn`), le message de l'import reste neutre.

**Piège de la démo** : `house/demo-house.json` est posée sur une RUE de Dijon (la parcelle voisine
s'arrête ~5 m avant) : l'import y répond « aucune parcelle », ce qui est juste. Pour voir le cas
heureux dans la preview, déplacer l'origine EN MÉMOIRE (`house.$patch`) vers 47.30905, 5.04512.

Pas fait : ajouter une parcelle SANS la maison (un jardin séparé) — à faire si le terrain réel en compte une.

Tests : `apps/web/src/lib/ignParcel.test.ts` (parcelle sous la maison, fusion de deux voisines,
sommets alignés retirés, aucune parcelle → `code: 'none'`), `outlineEditor.test.ts` (`setPolygon`).

Sources : `apps/web/src/lib/ignParcel.ts`, `apps/web/src/components/home/ReliefPanel.vue`,
`apps/web/src/three/relief/outlineEditor.ts`, `apps/web/src/three/HouseScene.ts`,
`apps/web/src/i18n/locales/{fr,en}.json` (`relief.outline.cadastre*`).

### Mise à jour 2026-10-01 — vue Véhicules : le panneau Climatisation

Le bouton « Climatisation » de la carte (teinté quand la clim tourne) déplie `VehicleClimate.vue`
sous la carte, comme « Modifier » ; un seul panneau de clim ouvert à la fois. Le panneau est
**commun à tous les véhicules** : il montre TOUJOURS la marche, la consigne ±, et six emplacements
disposés en vue de dessus (siège avant gauche, volant, siège avant droit ; trois sièges arrière). Ce
que `meta.vehicle.climate` ne déclare pas est **grisé**, avec « Pas disponible sur ce véhicule » en
info-bulle : rien n'apparaît ni ne disparaît d'une voiture à l'autre.

Règles :
- **Marche** : `vehicle.climate_start`, qui réveille. Le bouton tient l'attente (spinner à la place
  de l'icône) jusqu'à voir `climateOn`, 90 s au plus.
- **Consigne** : éveillée, envoyée 800 ms après le dernier clic (`climate_set`) ; endormie, RETENUE
  et envoyée avec la marche (jamais de réveil pour un réglage). Bornes et pas du véhicule.
- **Sièges et volant** : un clic monte d'un cran, puis revient à 0. Grisés tant que la clim est à
  l'arrêt (prudence : Tesla pourrait refuser le chauffage d'un siège clim éteinte ; pas vérifié).
  Trois barres pour tout siège ; un siège à un seul cran les allume toutes.
- Une ligne d'aide, à hauteur réservée (2 lignes), dit la raison de ce qui est grisé ou l'attente.

**« Réveiller » ne disparaît plus** quand la voiture s'éveille : il se grise. En apparaissant et
disparaissant, il changeait le nombre de lignes de la rangée de boutons et poussait le panneau de
48 px (mesuré). Il reste absent pour un véhicule sans notion de veille (`sleepState` absent, la R5).

Vérifié dans la preview (simulation : une Tesla complète, une R5 réduite à deux places à un cran) :
aucun décalage à la marche ni à l'arrêt, ni texte tronqué ni débordement aux zooms 1 / 1,25 / 1,5,
en fr et en en, thèmes clair et sombre. La carte de la vue Maison (`controls/VehicleCard.vue`) n'a pas
encore ce panneau.

Sources : `apps/web/src/components/vehicles/VehicleClimate.vue` (+ test), `apps/web/src/views/VehiclesView.vue`,
`apps/web/src/lib/optimistic.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

> **Corrigé le 2026-10-01** : le « ni débordement » ci-dessus ne valait que DANS le panneau. À 828 px,
> sa rangée du haut (marche, − consigne +) avait une largeur minimale de 290 px pour 279 disponibles :
> élément de la grille de la carte, il élargissait la colonne et poussait TOUT le contenu de la carte
> hors de son cadre (vu par l'utilisateur). Corrigé par `min-width: 0` sur le panneau, une rangée
> resserrée (bouton 10 px de marge, consigne 84 px) et un repli sur deux lignes si la carte est trop
> étroite (selon la largeur seule, jamais l'état). Mesuré sur la CARTE (`scrollWidth - clientWidth` = 0)
> à 375, 828 et 1280 px, zooms 1 / 1,25 / 1,5, fr et en : une seule ligne partout.

> **Ajout 2026-10-01** : deux rangées de boutons sous la carte du véhicule. D'abord les GESTES qui
> agissent tout de suite (verrouiller, charge, réveiller, actualiser), puis dessous ceux qui
> DÉPLIENT une section (Climatisation, Modifier), juste au-dessus de la section qu'ils ouvrent.

> **Ajout 2026-10-01 (bis)** : les boutons deviennent une grille de **tuiles identiques** (deux
> colonnes, icône au-dessus du libellé, 56 px de haut), toujours dans le même ordre pour tous les
> véhicules : [Verrouiller | Charge] [Réveiller | Actualiser], puis [Climatisation | Modifier].
> **Tout est toujours affiché** (règle de l'utilisateur) : ce que le véhicule ne sait pas faire est
> grisé, avec « Pas disponible sur ce véhicule » en info-bulle (`vehicle.unsupported`) ; la charge
> est grisée câble débranché, « Modifier » quand il n'y a rien à régler. Mesuré : une seule taille
> de tuile par carte, aucun libellé coupé (« Arrêter la charge » compris), aucun débordement, à 375
> et 828 px, zooms 1 / 1,25 / 1,5, fr et en.

> **Corrigé le 2026-10-01** : plus haut, « le plugin Tesla, en lecture seule, ne déclare ni l'un ni
> l'autre et n'a donc ni "Déverrouiller" ni "Lancer la charge" » ne vaut plus pour la charge : Tesla
> déclare `charging` (`../3_plugins/3_8_tesla.md`). Le verrouillage reste absent.

### Mise à jour 2026-10-01 — lancer la charge : une attente qui tourne, et des boutons qui ne bougent pas

**Vue Véhicules.** Seul le bouton de la commande EN COURS tourne : `waking` (Réveiller), `refreshing`
(Actualiser), `devices.isChargeRequested` (Charge). Avant, « Lancer la charge » faisait tourner Réveiller
et Actualiser (remarque de l'utilisateur) : `busy(v)` servait à la fois à griser et à faire tourner.
Il ne sert plus qu'à griser. Pendant une demande de charge, Réveiller est grisé ; Actualiser n'est grisé
que pendant l'aller-retour de la commande (`isPending`) et redevient cliquable ensuite, comme pendant un
réveil. Le bouton de charge montre un spinner à la place de l'icône (même taille : il ne change pas de
largeur) jusqu'à ce que la voiture se dise en charge (`../1_architecture/1_4_app-web.md`). Le panneau de
détail (`VehicleCard`) fait de même avec `:loading`.

**Un saut de 2 px.** La ligne de charge `.vcard__charge` avait `min-height: 16px` ; pleine, elle faisait
18 px, vide 16 : tout le bas de la carte, tuiles comprises, descendait de 2 px au démarrage de la charge.
Elle a maintenant `height: 1.5em` (et `line-height: 1.5em`). Mesuré aux zooms 1 / 1,25 / 1,5 : carte qui
charge et carte vide alignées.

**Panneau de la borne (`EvChargerControl`).**

- « Mode sécurisé » (orange, icône `alert`, l'explication en info-bulle seulement) prend la PLACE de
  « Courant max · N A », sur la même ligne : rien ne bouge, et c'est logique, ce courant-là ne vaut plus
  (`state.safeLimit`).
- Sous Démarrer / Arrêter, quand `meta.evCharger.stopUntilUnplug` : une phrase d'aide (fr : « Arrêter
  bloque la borne jusqu'au prochain débranchement : la charge verte ne reprendra pas avec le soleil. »).

Sources : `apps/web/src/views/VehiclesView.vue`, `apps/web/src/components/controls/{VehicleCard,EvChargerControl}.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`.

> **Ajout 2026-10-01 (ter)** : le panneau de détail de la vue 3D (`controls/VehicleCard.vue`) reprend
> le panneau Climatisation (`VehicleClimate`, sous la cible de charge, pour un véhicule qui a
> `climate_precondition`) et passe Verrouiller / Charge en tuiles identiques, toujours affichées et
> grisées avec leur raison. Le bouton « Lancer la charge » y débordait de 35 px en français ; mesuré
> après : aucun débordement ni libellé coupé (« Arrêter la charge » compris), zooms 1 / 1,25 / 1,5,
> fr et en. À 284 px de panneau, la consigne de la clim passe sous le bouton de marche (repli prévu).

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

### Mise à jour 2026-10-01 — carte véhicule : l'âge en tête, la charge qui se voit, « Voir dans la vue 3D »

- **« Lu il y a 12 min » en tête de carte** : il était sous les panneaux dépliables (clim,
  réglages) et descendait à leur ouverture. Il est désormais à droite de l'en-tête, deuxième ligne
  de `.vcard__side`, en face du sous-titre (« Tesla · À la maison »), sous la pastille de veille.
  Deux rangées fixes : sans pastille (R5), l'âge reste sur la seconde. L'explication « le véhicule
  dort… » passe au survol de l'âge (elle reste sous la cible de charge). Le sous-titre tient sur
  une ligne, avec une ellipse : un lieu long passait à la ligne et grandissait l'en-tête de 18 px à
  375 px de large.
- **Quota sur une ligne** : « Evaluation de » est devenu « ≈ » (`vehicle.quota`) ; le pire cas
  français (« ≈ 10,00 $/10,00 $ de crédit Tesla · depuis le 13 sept. ») mesure 267 px pour 280
  dans la carte la plus étroite (329 avant). Ellipse et texte complet au survol en filet.
- **Charge active visible** : en charge, l'icône d'en-tête devient l'éclair, avec un halo qui
  pulse (`box-shadow`, rien ne bouge), et un reflet parcourt le remplissage de la jauge (rogné au
  remplissage, pas à la jauge : les repères débordent toujours). Coupés sous
  `prefers-reduced-motion`.
- **Case « Câble »** (`vehicle.charge`, « Cable » en anglais) au lieu de « Charge » :
  « Câble : Branché / En charge / Débranché » ne répète pas le mot. « Branchement » écarté pour la
  même raison.
- **« Voir dans la vue 3D »** : sur le terrain, une épingle au bout du sous-titre ouvre l'accueil
  et sélectionne la voiture (`house.selectDevice`, id de maison ou id de plugin, même ordre que
  `RoomBands.show` : naviguer, PUIS sélectionner). « Sur le terrain » = le test de la scène
  (`sitePosition` avec le `gpsOffset`), pas le rayon « À la maison », qui déborde le terrain.
- **Une seule convention pour cette action dans toute l'app** : icône `pin`, pastille discrète
  (gris, accent au survol), libellé `common.showIn3d` « Voir dans la vue 3D » / « Show in the 3D
  view ». Les clés `rooms.origins.show` (« Voir dans la maison 3D ») et `music.locate` (« Voir
  dans la maison ») sont retirées au profit de celle-ci.
- Mesuré dans la preview (simulation) : en-tête à 42 px partout, aucun décalage à l'ouverture des
  panneaux (zooms 1 / 1,25 / 1,5), rien ne déborde à 375 px en fr et en en. Non vu : l'épingle qui
  disparaît (les deux voitures simulées sont sur le terrain).

### Mise à jour 2026-10-01 (bis) — carte véhicule : filigranes de section, autonomie partagée

- **Filigranes** : chaque section de la carte de la vue Véhicules porte, en bas à droite, l'icône de
  ce qu'elle dit, monochrome (`--text`, opacité 0,07), SOUS le contenu (`isolation: isolate` sur la
  section, `z-index: -1` sur l'icône), rognée d'un quart de sa surface (mesuré : 77 %, pneu 73 %),
  sans prendre de place. État : cadenas (ouvert si déverrouillée) ; Câble : prise ; Mouvement :
  compteur (`gauge`) ; Températures : `hotCold` (soleil et flocon de part et d'autre d'une
  diagonale) ; Pneus : `tire` ; Limite de charge : batterie DEBOUT (prop `watermark` de
  `ChargeLimitCard`, que seule la vue Véhicules active ; couchée, elle tombait au niveau du curseur).
- **Impasses des températures** : le thermomètre (ambigu de loin), puis « °C » dessiné (le C rogné,
  et l'unité peut être °F). D'où un symbole sans unité.
- **`components/vehicles/VehicleBattery.vue`** : l'autonomie, partagée par la carte de la vue
  Véhicules et le panneau du véhicule de la vue Maison (`controls/VehicleCard.vue`), comme
  `ChargeLimitCard`. Batterie en 40 px, kilomètres + « Autonomie », jauge de 8 px (reflet en charge,
  rouge sous 20 % hors charge), repères plancher et cible ; `limit` fait suivre le repère de cible au
  curseur pendant qu'on le glisse. « — » pour un véhicule jamais lu (`unread`, déplacé de la vue).
  Le panneau perd la jauge Vuetify (qui passait au vert en charge : le reflet le dit déjà).
- **Panneau du véhicule** : la grande valeur générique de `DevicePanel` (`headlineValue`, le « 67 % »)
  n'est plus montrée pour un véhicule — elle répétait la batterie et était parfois rognée.
- Mesuré dans la preview (simulation) : en-tête des cartes à 42 px, rien ne déborde à 375 px aux
  zooms 1 / 1,25 / 1,5 ; panneau à 1440 × 900 ; clair et sombre.

### Mise à jour 2026-10-02 — vue Véhicules : cartes horizontales, panneaux par-dessus la carte

Deux voitures par maison en général : en colonnes étroites, la vue laissait toute la droite vide.
Chaque véhicule a désormais une carte pleine largeur dont la disposition suit la largeur de la zone
(`container-type: inline-size` sur `.vehicles__scroll`, deux `@container`) :

| Largeur de la zone | Disposition |
|---|---|
| ≥ 1100 px | énergie (quota en bas) · état puis boutons · carte sur toute la hauteur |
| 720 – 1100 px (écran moyen, zooms 1,25 / 1,5) | énergie, état, quota · boutons étirés jusqu'au bas de l'énergie, puis carte |
| < 720 px (téléphone) | énergie · état · boutons · carte · quota |

- **Zones de grille, pas colonnes** : l'ordre du DOM est la pile du téléphone (`.vcard__energy`,
  `.vcard__state`, `.vcard__actions`, `.vcard__mapzone`, `.vcard__quota`) ; plus large, des
  `grid-template-areas` où un bloc couvre plusieurs rangées (`'a st map' 'a act map' 'q act map'`,
  puis `'a act' 'st map' 'q map'`). Impasse : trois colonnes-enveloppes partagent leurs rangées et
  laissent des trous (la carte grandissait aussi avec les panneaux).
- **Boutons** : une grille de six, rangée par `order` (`data-slot`). Carte à droite (≥ 1100 px) :
  réveiller, actualiser / déverrouiller, clim / charge, modifier — ceux qui ouvrent un panneau dans
  la colonne qui touche la carte. Sinon : réveiller, actualiser / déverrouiller, charge / clim,
  modifier. Sur écran moyen, les rangées s'étirent (`minmax(56px, 1fr)`) jusqu'au bas de l'énergie ;
  le sélecteur porte `.vcard` en tête, la règle de base des tuiles (56 px) venant plus bas.
- **Panneaux clim et réglages** : UN à la fois (`panel`, `togglePanel`), PAR-DESSUS la carte, qui
  ne change pas de taille et ne prend plus la main (`inert`, voilée). Transition `vpanel` (glissé
  vers le haut, sans déplacement sous `prefers-reduced-motion`). Grand écran et écran moyen : calque
  absolu sur la zone exacte. Téléphone : carte et panneau dans la même cellule de grille, la zone
  grandit si le panneau le demande (250 / 263 px), la carte garde sa hauteur.
- **Hauteur minimale commune** de la carte et des panneaux : `--vmap-min` (245 px).
- **`VehicleClimate` étiré** : rangées `auto 1fr auto`, sièges `minmax(52px, 1fr)`, aide en bas ;
  à sa hauteur naturelle (téléphone, panneau de la vue Maison) les sièges restent à 52 px. Impasse :
  `minmax(52px, 88px)` montait les rangées à 88 px PARTOUT (grille sans hauteur donnée).
- Mesuré dans la preview (simulation) à 1440 × 900, 1024 × 768 et 375 × 812, zooms 1 / 1,25 / 1,5,
  clair et sombre : aucun débordement ni libellé coupé, rien ne bouge à l'ouverture d'un panneau en
  grand écran. Non vu : le quota en bas de colonne (la simulation n'en a pas).

### Mise à jour 2026-10-02 — vue Véhicules : la ligne « Logiciel » et les notes de version

`components/vehicles/VehicleSoftware.vue`, sous les pneus de chaque carte. Une ligne TOUJOURS là
(« — », grisée pour un véhicule qui n'en dit rien) : version installée, puis l'état de la mise à
jour en accent (« 2026.38 disponible », « programmée demain à 02:00 », « téléchargement 40 % »,
« Installation de 2026.38 · 35 % »). Un statut qui change ne fait bouger aucun bloc de la carte
(géométrie mesurée avant/après une annulation).

Un clic ouvre une boîte `v-dialog` par-dessus la page : **À venir** (statut, notes de la version
attendue, puis « Installer maintenant », une heure + « Programmer » / « Reprogrammer », « Annuler la
programmation ») et **Historique** (par version). Les gestes passent par une confirmation qui dit la
durée d'immobilisation ; voiture endormie, ils sont grisés avec « Réveillez la voiture d'abord ».
Notes demandées dans la langue de l'app, rechargées si elle change boîte ouverte ; servies en
anglais, une ligne le dit. Illustrations du thème courant, place réservée en 740 / 463. Le délai
jusqu'à l'heure choisie est arrondi au-DESSUS (`lib/vehicleSoftware.ts`) : arrondi au plus proche,
la confirmation annonçait 01:59 pour 02:00.

Vérifié dans la preview `kasbah-mock` : programmer, annuler, état endormi ; aucun libellé coupé en
fr et en, clair et sombre, zooms 1 / 1,25 / 1,5 à 1440 × 900 et 375 × 812 (captures figées : thème
vérifié par mesure des couleurs). Vu en passant, préexistant : à 375 px et zoom 1,25 / 1,5, la
carte entière déborde de 20 à 30 px (minimum de grille de 320 px).

Sources : `apps/web/src/components/vehicles/VehicleSoftware.vue`, `apps/web/src/lib/vehicleSoftware.ts`
(+ test), `apps/web/src/views/VehiclesView.vue`, `apps/web/src/i18n/locales/{fr,en}.json` (`vehicle.software.*`).

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

### Mise à jour 2026-10-02 (bis) — boîte « Logiciel » : réveil, durée, décompte et progression

Après le premier vrai essai (voir `../3_plugins/3_8_tesla.md`), la boîte suit l'appli Tesla :
- **réveiller sans fermer la boîte** : une rangée de hauteur FIXE sous les gestes (40 px ; 84 px,
  bouton sous le texte, quand la boîte fait moins de 340 px — `@container`). Endormie :
  « Endormie : aucune commande acceptée. » et « Réveiller » (qui tourne jusqu'au réveil constaté,
  90 s au plus) ; éveillée : « l'installation peut être lancée » ; puis un texte par phase ;
- **la durée** annoncée par Tesla, sous le statut : « L'installation dure environ 20 min : la voiture
  sera bloquée pendant ce temps. » ;
- **quatre phases** dans une zone de hauteur fixe (88 px, celle de deux rangées de boutons) :
  prête (les boutons), **décompte** à moins de 15 min du démarrage (« Installation dans 1:42 »,
  « Annuler l'installation » seul — comme l'appli après « Installer maintenant »), **démarrage**
  (heure passée, la relecture du serveur pas encore arrivée), **installation** (barre, pourcentage,
  fin estimée d'après le pourcentage et la durée). La ligne de la carte suit (« installation dans
  1:42 », « Installation de 2026.38 · 30 % »). Horloge de la vue à la seconde près du décompte, à la
  demi-minute de loin.

Piège : la boîte prenait la largeur de son CONTENU (plus étroite en anglais, lignes de hauteurs
différentes d'une langue à l'autre) ; `.box { width: 100% }` lui donne celle du `v-dialog` (560 px
au plus).

Vérifié dans la preview `kasbah-mock` (temps simulé ×30 : le décompte y affiche des minutes
fausses, l'heure programmée étant en temps simulé) : prête → décompte → installation → version
installée, zone et rangée à hauteur constante ; réveil sans décalage ; fr et en, 1440 × 900 et
375 × 812, zooms 1 / 1,25 / 1,5. Non vu dans la preview : la phase « démarrage » (la simulation
passe en installation dès l'heure atteinte) — couverte par la logique seulement.

Sources : `apps/web/src/components/vehicles/VehicleSoftware.vue`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-10-02 (ter) — la ligne « Logiciel » aussi dans le panneau du véhicule

Le panneau d'un véhicule dans la vue 3D (`components/controls/VehicleCard.vue`) reprend
`VehicleSoftware` sous la climatisation, comme il reprend déjà la batterie, la limite de charge et
la clim : même ligne, même boîte (notes, réveil, installation, décompte, progression), toujours là
et grisée pour un véhicule qui n'en dit rien. Enveloppée dans un `div` : le composant a plusieurs
racines (la ligne et ses deux `v-dialog`), un `class` posé dessus ne s'appliquerait pas. Vérifié
dans la preview : rien de coupé ni de débordant en fr et en, zooms 1 / 1,25 / 1,5, même fond que le
bloc climatisation en clair et en sombre.

Sources : `apps/web/src/components/controls/VehicleCard.vue`.

### Mise à jour 2026-10-03 — apparence d'une pièce et de la façade, en brouillon

**Panneau de pièce en mode édition** (`RoomEditPanel.vue`) : section « Apparence » entre les
ouvertures et les places, onglets Sol / Murs, puis la barre du brouillon, puis le sélecteur. La
barre est AVANT la grille : Sol et Murs n'ont pas le même nombre de vignettes, elle ne bouge pas.
**Panneau maison** (`HouseEditPanel.vue`) : section repliable « Façade », même sélecteur.

**Sélecteur** (`FinishPicker.vue`) : « Celle du style » en tête (retire la finition), puis les
vignettes `thumb.jpg` (128 px) rangées par famille. Lignes RÉSERVÉES : nom de la finition choisie et
teinte (sélecteur de couleur grisé hors peinture, « × » masqué sans teinte). Passer d'une peinture à
une autre garde la teinte. Consigne « style costume » sur une ligne réservée quand le style courant
n'interprète pas les finitions.

**Brouillon** (store `house`) : `appearanceHistory` (les états successifs du patch) et
`appearanceStep` ; chaque choix entre dans la maison que reçoit la scène (`withAppearanceDraft`,
avant les brouillons d'ouverture / place / jardin), rien n'est écrit. `AppearanceBar.vue` : annuler /
rétablir (aussi Ctrl+Z / Ctrl+Y ou Ctrl+Maj+Z hors d'un champ), état du brouillon, puis
« Abandonner » / « Valider » en deux moitiés égales (sur une ligne, « Abandonner » débordait de 28
px en français). `appearanceDirty` compare les finitions avant / après : choisir puis revenir au
fichier n'est pas une modification. « Valider » écrit toute la séance (`saveAppearance`), un refus
garde le brouillon. **Quitter le mode édition abandonne le brouillon** (`HomeView.vue`).

*(Dépassé le 2026-10-03 : `appearanceHistory` / `appearanceStep` / `appearanceDirty` sont devenus `editHistory` / `editStep` / `editDirty`, et `AppearanceBar.vue` est `EditBar.vue` (`apps/web/src/stores/house.ts`, `components/home/EditBar.vue`) — voir « Mise à jour 2026-10-03 (bis) — onglet Dimensions, et un seul brouillon de séance ».)*

Les autres éditeurs (ouvertures, places, jardin) écrivent toujours à la fin de chaque geste : la
règle « aucune écriture sans approbation » de l'utilisateur ne leur est pas encore appliquée.

Vérifié dans la preview simulée : rien ne bouge (mesure géométrique sur choix, teinte, retour au
style, annuler, changement d'onglet ; contrôle négatif détecté), aucun débordement fr / en aux zooms
1 / 1,25 / 1,5, clair et sombre.

**Tap sur une pièce pendant un réglage** (signalé par l'utilisateur) : avec une ouverture, une place
ou un arbre en réglage, `onRoomTap` ignorait le tap (garde-fou « ne pas refermer le panneau par
surprise ») et l'on restait coincé sur l'ouverture, à repasser par le fil d'Ariane. Désormais le tap
sur le sol d'une pièce quitte le réglage (chaque geste y est déjà écrit) et ouvre cette pièce. Le
correctif du rayon qui traversait le plancher est dans `../1_architecture/1_5_scene-3d.md`.

Tests : `apps/web/src/stores/house.appearance.test.ts`.

Sources : `apps/web/src/components/home/{FinishPicker,AppearanceBar,RoomEditPanel,HouseEditPanel}.vue`,
`apps/web/src/stores/house.ts`, `apps/web/src/views/HomeView.vue`, `apps/web/src/i18n/locales/{fr,en}.json` (`finish.*`).

*(Dépassé le 2026-10-03 : `AppearanceBar.vue` est devenu `EditBar.vue`.)*

### Mise à jour 2026-10-03 (bis) — onglet Dimensions, et un seul brouillon de séance

**Onglet « Dimensions »** dans la section Apparence du panneau de pièce (Sol | Murs | Dimensions,
`RoomEditPanel.vue`) : il allume les poignées de la pièce dans la 3D (`house.shapeEditing`) ;
quitter le panneau les éteint. `RoomShapeSection.vue` : case « Le mur mitoyen entraîne la pièce
voisine » (`house.coupleWalls`, cochée par défaut), consigne, surface des cotes, la liste des
côtés (nom qui choisit le mur, champ de longueur en m — virgule acceptée — qui fixe le côté en
faisant reculer le mur suivant), et une ligne d'actions TOUJOURS là (« Ajouter un sommet au
milieu » pour le mur choisi, « Retirer le sommet » pour le sommet choisi, grisés sinon). La poignée
choisie (`house.shapeSelection`) est partagée par la 3D et la liste.

**Un seul brouillon** (store `house`) : `editHistory` / `editStep` portent des `HouseEditPatch`
(apparence et formes) ; `setRoomFinish` / `setFacadeFinish` y entrent comme les gestes de forme
(`pushRoomWall`, `setSideLength`, `addCorner`, `removeCorner`). Un GLISSEMENT ne fait qu'un pas :
`beginShapeDrag` fige la base, `previewRoomWall` / `previewCorner` posent un `shapeTransient` montré
sans entrer dans l'historique, `endShapeDrag` en fait un pas. `editView` = la maison du brouillon ; si
la validation la refuse (ouverture qui ne tient plus), la scène garde la **dernière forme
dessinable**, mais `shapeOf` et les gestes suivent le brouillon tel quel (un sommet ajouté au travers
d'une ouverture se voit, pour qu'on le déplace). `editBlocking` nomme les pièces et les ouvertures
(`shape.openingNoFit`) ; `editDirty` compare polygones, ouvertures et finitions, pas les cotes ni les
emprises (une maison convertie sans changer de forme n'a rien à écrire). API renommée :
`AppearanceBar.vue` → `EditBar.vue`, `*Appearance` → `*Edit`.

**`EditBar.vue`** : la ligne d'état dit ce qui bloque (« Impossible de valider : … », le premier
motif, tous dans l'info-bulle, `rgb(var(--v-theme-error))`) et « Valider » est grisé — sur la même
ligne réservée, rien ne bouge.

Vérifié dans la preview simulée, en vrais gestes : mur poussé (baie qui suit), sommet glissé, saisie
d'une longueur, cloison entraînant salon et cuisine, détachée → chevauchement bloquant, annuler ;
rien ne bouge (sélection, saisie, blocage, annulation, case), aucun débordement fr / en aux zooms 1 /
1,25 / 1,5, clair et sombre. Deux défauts trouvés en vérifiant, corrigés : le sommet ajouté au
travers d'une ouverture ne se voyait pas ; revenir à la forme d'origine laissait la séance
« modifiée » (emprise ajoutée par la conversion).

Tests : `apps/web/src/stores/house.edit.test.ts`.

Sources : `apps/web/src/components/home/{RoomShapeSection,EditBar,RoomEditPanel}.vue`,
`apps/web/src/stores/house.ts`, `apps/web/src/views/HomeView.vue`, `apps/web/src/i18n/locales/{fr,en}.json` (`shape.*`).

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

### Mise à jour 2026-10-06 (soir) — Réglages : la carte « Comptes »

La carte « Assistants IA (MCP) » de Réglages (`components/settings/McpUsersCard.vue`) devient
**« Comptes » / « Accounts »** : les mêmes comptes ouvrent Kasbah depuis l'extérieur et connectent un
assistant IA. Aide réécrite en fr et en. Quand une session existe (adresse publique), la carte affiche
« Connecté en tant que … » et un bouton « Se déconnecter » (formulaire natif `POST /logout` : le serveur
ferme la session et renvoie à sa page de connexion) ; la liste et le formulaire y sont **masqués** et
`/api/mcp/users` n'est même pas demandé (il rendrait 403 `LAN_ONLY`). Sur le réseau local, rien de
changé. Vérifié en fr et en à 375 px, sans débordement. Détail : `../1_architecture/1_7_serveur-mcp.md`,
mise à jour du 2026-10-06 (soir) ; la description d'origine de la carte y figure à la mise à jour du
2026-10-04 (nuit).

### Mise à jour 2026-10-07 — page Musique et cartes de comptes : le compte courant, le mode anonyme

Les comptes musicaux sont par utilisateur (`../1_architecture/1_6_lecteur-musique.md`,
`../3_plugins/3_16_ytmusic.md`, `../3_plugins/3_20_mixcloud.md`). Ce que l'écran en montre :

- **Cartes de Réglages** (`YtmusicLinkCard.vue`, `MixcloudLinkCard.vue`) : une seule carte, qui agit sur
  « le compte courant » (le sien si l'on est connecté, celui de la maison sur le réseau local ; une carte
  séparée « Mes comptes musique » a été écartée). Une ligne « Compte de {user} : ce qui est réglé ici ne
  touche pas le compte de la maison » (`settings.musicAccountOf`) rend explicite lequel on règle. YouTube
  Music ajoute `settings.ytmusic.anonymous` et masque la section d'import du navigateur pour un utilisateur ;
  les étapes du cookie sont réécrites (`settings.ytmusic.pasteHowTo`).
- **YouTube Music en anonyme** (`views/MusicView.vue`) : la source reste utilisable ; les onglets Likes et
  Playlists sont masqués (`personal`) et l'onglet mémorisé est ramené à Récents.
- **Mixcloud en anonyme** (`components/music/MixcloudBrowser.vue`) : recherche et genres, pas d'onglets
  personnels ; hors recherche, invitation « Relier ton compte Mixcloud » (`mixcloud.anonymousHint`) avec le
  champ AVANT l'explication — sur téléphone la zone sous la recherche ne fait que ~137 px, le champ était
  sous le pli.
- **Vérifié** (serveur jetable, connecté en `alice`) : rien ne bouge entre repos et recherche (mesure
  géométrique), aucun débordement à 1 280 et 375 px, fr et en ; cartes de Réglages et étapes du cookie fr/en à
  375 px. Pas de contrôle clair/sombre consigné : aucune couleur n'a été touchée.
- **Limite** : le badge de santé du plugin, dans Réglages, reste celui de la maison.

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

### Mise à jour 2026-10-08 — changer de propriété (mode démonstration)

Le **pavé d'initiales du rail** devient un bouton quand il y a plusieurs propriétés : même taille
(38×38), donc rien ne bouge ; il ouvre le menu des propriétés (`components/layout/PropertyList.vue`).
Le rail du téléphone n'a pas de pavé : la même liste est une **carte « Propriété » dans Réglages**
(`views/SettingsView.vue`). Avec une seule propriété, le pavé reste ce qu'il était.

Le store `apps/web/src/stores/properties.ts` : `load`, `apply` (sur le `snapshot`, qui porte
`propertyId`) et `select`, qui demande la bascule puis **attend que le serveur nomme la nouvelle
propriété avant de recharger** (la bascule se fait après la réponse du serveur, donc la page ne doit
pas recharger sur sa seule réponse 202).
En mode in-process (`VITE_INPROCESS_MOCK=1`), la propriété est retenue par le navigateur
(`localStorage`, clé `kasbah.demoProperty`, la première par défaut). Libellés : `properties.*`, fr et en.

Vérification de la vue sur les trois maisons : configs de preview `kasbah-demo-server` (9789) +
`kasbah-demo` (6177) pour la bascule côté serveur, `kasbah-mock` pour l'in-process
(`../5_setup/5_0_installation-et-scripts.md`).

Sources : `apps/web/src/components/layout/{PropertyList,NavRail}.vue`, `apps/web/src/stores/properties.ts`,
`apps/web/src/views/SettingsView.vue`, `apps/web/src/api/demoProperties.ts`.

### Mise à jour 2026-10-10 — pièces et niveaux en mode édition, relief dans la carte « Mode édition »

Choix de l'utilisateur : poser une pièce **contre un mur** (et au tap pour un niveau vide), étage ou
sous-sol avec le **toit qui suit**, retirer une pièce ou un niveau **vide**, nom et type **dans le
brouillon**. Format : `../2_maison/2_0_format-house-json.md` (même date).

- **Panneau maison** (`HouseEditPanel.vue`) : section repliable « Pièces et niveaux » en tête (clé
  `structure` de l'accordéon), avec la barre du brouillon (`EditBar`). « Ajouter une pièce » arme
  `house.placingRoom` (niveau de l'onglet, sinon le plus bas — `levelsSorted` est trié du haut vers
  le bas) et devient « Annuler » dans la même boîte ; « Ajouter un étage » | « Ajouter un sous-sol » ;
  « Retirer « niveau » » grisé hors d'un onglet de niveau ou si `levelRemovable` dit non. Consignes
  sur des **lignes réservées** (3 et 2 lignes, `.hint--3` / `.hint--2`) : la première version faisait
  sauter la suite de 18 px en armant, et la consigne anglaise passait à 4 lignes au zoom 1,5 (texte
  raccourci).
- **Panneau de pièce** (`RoomEditPanel.vue`) : section « Pièce » en tête (nom — vide refusé, le champ
  reprend — et type, colonnes 3fr / 2fr), « Retirer la pièce » en pied (un seul tap : c'est dans le
  brouillon, annulable). Onglet Dimensions (`RoomShapeSection.vue`) : « Ajouter une pièce de ce côté »
  en pleine largeur sous les deux actions de sommet, grisé sans mur choisi.
- **Store** (`stores/house.ts`) : `addRoomAgainstWall`, `startPlacingRoom` / `cancelPlacingRoom` /
  `placeRoomAt`, `removeRoom`, `setRoomIdentity`, `addLevel` (« Étage N », N = niveaux habités ;
  « Sous-sol »), `levelRemovable`, `removeLevel`. La pièce née devient la sélection, le niveau né
  l'onglet. `mergeEdit` cumule ajouts et retraits ; `buildingOf` compare aussi ids, noms, types et
  niveaux ; `issueText` nomme les pièces nées dans la séance. Abandonner la séance désarme la pose.
- **Scène** : `setPlacingRoom` / événement `roomPlaceTap` — n'importe quel sol touché (un niveau neuf
  n'a pas encore de plancher) ; tap hors sol = renoncement (`HomeView.vue`).
- **Réglages** : « Modeler le terrain » quitte la carte Rendu 3D pour la carte « Mode édition » (il
  écrit dans le fichier de la maison, comme le reste du mode).

Limites connues : un niveau ne se renomme pas encore ; une automatisation qui nomme une pièce retirée
garde la référence. Tant qu'une fenêtre de toit bloque, la pièce née ne se voit pas dans la 3D (la
scène garde la dernière maison valide).

Vérifié dans la preview simulée (`kasbah-mock`), en vrais boutons : pièce contre un mur, pièce sur un
étage neuf (blocage par la fenêtre de toit, message), nom et type, « Valider », retrait et annulation,
retrait d'un niveau ; rien ne bouge (mesure géométrique, trois états), aucun débordement fr / en aux
zooms 1 / 1,25 / 1,5.

Tests : `apps/web/src/stores/house.structure.test.ts`.

Sources : `apps/web/src/components/home/{HouseEditPanel,RoomEditPanel,RoomShapeSection}.vue`,
`apps/web/src/stores/house.ts`, `apps/web/src/three/HouseScene.ts`, `apps/web/src/composables/useHouseScene.ts`,
`apps/web/src/views/{HomeView,SettingsView}.vue`, `apps/web/src/i18n/locales/{fr,en}.json` (`structure.*`).


### Mise à jour 2026-10-10 (2) — créer une propriété, démos en lecture seule, guide de premier lancement

Décisions de l'utilisateur : le dépôt est public, il faut pouvoir créer une maison depuis une
installation fraîche ; les démos ne se modifient pas mais se **dupliquent** ; la création pose d'office
une première pièce et un guide enchaîne **contour du terrain → cotes de la pièce**. Côté serveur et
format : `../1_architecture/1_2_serveur-et-plugins.md`, `../1_architecture/1_3_protocole-rest-ws.md`,
`../2_maison/2_0_format-house-json.md` (même date).

- **Sélecteur** (`components/layout/PropertyList.vue`) : deux groupes (propriétés du poste, puis
  démonstrations), actions « Créer » et « Dupliquer ». Le store `stores/properties.ts` gagne `isDemo`,
  `canCreate`, `creating`, `busy`, `create`, `duplicateActive`. Sur une démo, il **coupe le mode édition
  et le relief au chargement** : l'écriture serait refusée de toute façon (409 `DEMO_READONLY`).
- **Boîte « Nouvelle propriété »** (`components/property/NewPropertyDialog.vue`, montée par `App.vue`),
  trois étapes, **hauteur fixe** (règle « rien ne bouge » : le bouton « Suivant » a bougé d'une étape
  à l'autre à la première version, corrigé). Recherche d'adresse par le géocodage IGN
  (`data.geopf.fr/geocodage/search`) ou « Ma position » (`navigator.geolocation`). Après la relecture
  UI : le corps est une colonne flex où **la carte prend la hauteur qui reste** (plancher 140 px) — la
  ligne du cap tombait sous le pli aux trois zooms ; aux étapes 2 et 3, la carte garde la même place
  (texte sur quatre lignes réservées, rangée de 40 px au-dessus : recherche ou cotes, rangée du cap
  au-dessous, réglable aussi à l'étape du terrain) ; « Suivant » et « Créer » ont la même largeur
  (`min-width` 104 px) ; le type se dit en toutes lettres (`Segmented` affiche l'icône À LA PLACE du
  libellé quand on lui en donne une).
- **Carte de pose** (`components/property/OriginPicker.vue`, MapLibre) : satellite IGN ou plan
  OpenFreeMap, repère glissable pour le point 0, superposition de la pièce, des axes x / y et du
  terrain, zoom 20, recadrage sur le terrain à l'étape 3 (le terrain sortait de la carte avant ça).
  Le cap est celui de l'axe +y, horaire depuis le nord (`geo.ts`). **Piège corrigé** (signalé par
  l'utilisateur : point posé, rien dessiné) : `setStyle` « en différence » (défaut de MapLibre) retire
  les calques ajoutés par le code SANS émettre `style.load`, qui les repose — selon que le style des
  étiquettes arrivait avant ou après le premier chargement, la pièce, les axes et le terrain
  disparaissaient. Les changements de style passent donc `{ diff: false }`. Les cotes du terrain
  s'appellent « Le long de x / de y », avec la pastille de l'axe (couleurs partagées par
  `components/property/axes.ts`) : « largeur / profondeur » ne disait pas à quel côté elles allaient.
- **Guide** (`components/property/OnboardingCoach.vue`, monté par `HomeView.vue` ; état dans
  `lib/onboarding.ts`) : la création recharge l'application sur la maison neuve, donc l'étape est
  retenue en `localStorage` (`kasbah.onboarding` = `{ propertyId, step }`). Déroulé de « Créer »
  (`stores/properties.ts`, `create`) : `POST /api/properties`, écriture du guide (« room » d'emblée
  pour un appartement), fermeture de la boîte, puis le `select` habituel, qui attend que le serveur
  nomme la nouvelle propriété avant de recharger ; « Dupliquer » (`duplicateActive`) fait de même sous
  « nom (copie) », sans guide. « terrain » ouvre l'éditeur
  du contour ; « Terminer » sélectionne la pièce en mode édition (étape « room »). Confort de CE poste
  seulement : sans lui, la maison existe quand même. Corrigé à la vérification : le guide chevauchait le
  panneau du terrain. Après la relecture UI : à l'étape « room », le guide émet `room` et `HomeView`
  ouvre le panneau — sur un écran étroit c'est un tiroir fermé, et le guide renvoyait à un onglet
  invisible. L'avertissement MapLibre `Image "circle-11" could not be loaded` vient du jeu d'icônes du
  style OpenFreeMap, partagé avec la carte des véhicules.
- **Réglages** (`views/SettingsView.vue`) : sur une démo, la carte « Mode édition » est en lecture
  seule, avec un bouton « Dupliquer ». Message traduit pour `DEMO_READONLY` (`properties.readOnly`).

**Limites** : recherche d'adresse et fond satellite pour la France seulement ; nom non modifiable après
création ; pas de création en mode in-process (409).

**Vérifié** sur `kasbah-demo-server` + `kasbah-demo` : création, guide, écriture de la maison créée,
duplication (le parc simulé suit), 409 sur une démo avec fichier inchangé. Suite complète 2065 / 2065,
typecheck et lint globaux propres.

Sources : `apps/web/src/components/layout/PropertyList.vue`, `apps/web/src/components/property/*.vue`,
`apps/web/src/lib/onboarding.ts`, `apps/web/src/stores/properties.ts`, `apps/web/src/views/{SettingsView,HomeView}.vue`,
`apps/web/src/App.vue`, `apps/web/src/api/httpTransport.ts`.

### Mise à jour 2026-10-10 (3) — corrections de la relecture UI du lot « pièces et niveaux » (commit 000d5f8)

Une relecture indépendante de la mise à jour précédente a trouvé, puis corrigé :

- **Annuler ou abandonner une pièce ou un niveau né laissait un panneau et un onglet vides** : le store
  remonte désormais à la maison (watch sur `index`).
- **Ajouter puis retirer un étage laissait le niveau du toit relevé** : `structure.ts` ignore les
  niveaux nés et retirés dans la même séance.
- **Titre de pièce au nom long** : en `MarqueeText` (défilement avec fondu, règle « rien ne bouge »).
- **Consigne distincte sur l'onglet « Tout »** : `structure.addRoomHintLowest`, parce que la pièce y
  naît au niveau le plus bas.

Sources : `apps/web/src/stores/house.ts`, `apps/web/src/components/home/HouseEditPanel.vue`,
`packages/shared/src/house/structure.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.
