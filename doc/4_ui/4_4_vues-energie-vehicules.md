# Vues Énergie et Véhicules

> Dernière mise à jour : 2026-10-26
> Sources : sections reprises telles quelles de `4_1_navigation-et-panneaux.md` le 2026-10-13 ; chaque section cite les siennes.

Cette page couvre la vue Énergie (schéma de flux, onduleurs, champs de panneaux, tuiles), la vue Véhicules et la carte d'un véhicule (charge, limite, carte, réveil, climatisation, logiciel). Elle est née du découpage de
[4_1 Navigation et panneaux](4_1_navigation-et-panneaux.md), trop longue pour être lue d'un trait : ses
sections y ont été déplacées sans retouche, dans leur ordre d'origine, avec leurs dates. Un renvoi
« plus haut » ou « plus bas » peut donc désigner une section restée dans une autre page de `4_ui/`.

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

*(Dépassé le 2026-10-12 : chaque tuile mène à sa vue — voir « Mise à jour 2026-10-12 (bis) — les tuiles du panneau maison mènent à leur vue ».)*

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

### Mise à jour 2026-10-15 — vue Énergie : les commandes de la borne sur sa ligne

Demande de l'utilisateur : la borne se pilote aussi depuis sa carte de pièce dans la vue Énergie, pas
seulement depuis son panneau de la vue 3D.

**Un composant, deux rendus** (`components/controls/EvChargerCommands.vue`, prop `variant`). Les
commandes (mode, démarrer / arrêter, annulation, intensité) sortent d'`EvChargerControl`, qui garde
son en-tête d'état et pose le rendu `panel` (défaut) : grands boutons. La ligne de la borne (slot
`control` de `RoomBands`, `views/EnergyView.vue`) pose le rendu `row`. Premier essai avec les
boutons du panneau tels quels (48 et 56 px de haut, aide en trois lignes) : la carte de pièce en
était écrasée, et l'utilisateur a posé la règle — voir `4_1_navigation-et-panneaux.md`.

**Le rendu `row`**, dans le vocabulaire des lignes des autres vues (repris de `HeatingControl`) :
rangée à part (`grid-column: 1 / -1`), touches de 36 px à coins arrondis, modes en mots (`key--text`,
`data-on` sur le mode en cours), démarrer / arrêter en touches à icône (`bolt`, `boltOff`) au bout,
l'aide « arrêter bloque la borne… » devenue l'info-bulle de la touche d'arrêt, l'intensité (borne qui
a `charge_current`) en curseur compact sur sa propre rangée.

**L'annulation, sans touche de plus.** Une touche « Reprendre » à place réservée renvoyait démarrer /
arrêter sur une seconde rangée (mesuré : 331 px de ligne). Sous annulation, c'est donc la touche du
mode EN COURS qui passe dans la couleur d'alerte du thème (`data-on="warn"`, info-bulle qui
l'explique), et la toucher rend le mode : `ev_charger.set_mode` du même mode sous annulation vaut
`resume_mode` (`../3_plugins/3_7_enphase.md`). La ligne d'état le dit en mots, au bout (slot
`status-after`, « annulation manuelle » en couleur d'alerte). Limite : une borne en mode programmé
ou intelligent sous annulation n'a pas de touche à ce rôle sur la ligne ; le panneau garde
« Reprendre ».

Mesuré sur la borne simulée (vue Énergie, 1280 px) : une seule rangée de touches, rien ne bouge
quand l'annulation apparaît, pas de débordement ni de libellé coupé en fr et en aux zooms 1 / 1,25 /
1,5, couleur d'alerte lisible en clair et en sombre. La borne simulée réécrit son état à chaque pas :
l'annulation et le mode ont été maintenus par une sonde le temps des mesures.

Sources : `apps/web/src/components/controls/{EvChargerCommands,EvChargerControl}.vue`,
`apps/web/src/views/EnergyView.vue`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-10-19 — la LOA d'un véhicule : saisie dans « Modifier », jauge au pied de la carte

**Besoin** : voir si le kilométrage reste « dans les clous » du forfait de la LOA, au prorata de la durée.

**Saisie** : section « LOA / LLD » du panneau « Modifier » de la carte (`VehicleTuning.vue`), et non la
carte du plugin dans les Réglages : une LOA est par véhicule et vaut pour toute marque. Champs : Début,
Fin, Forfait (km), Compteur au départ (km), une aide, et une croix d'effacement à côté de l'intertitre.
La saisie est un **brouillon**, écrit dès que l'ensemble est valable ; tout vider l'efface (`''`, cf.
`../2_maison/2_0_format-house-json.md`). « Rétablir » couvre aussi la LOA. Pour un véhicule Renault
seulement (`descriptor.pluginId === 'renault'`, VIN = `externalId`), un bouton « Chercher chez Renault »
propose le contrat d'entretien plafonné trouvé et « Reprendre » pré-remplit
(`../3_plugins/3_9_renault.md`).

**Calcul** (`apps/web/src/lib/vehicleLease.ts`, `leaseProgress(lease, odometerKm, now)`) : kilomètres
parcourus (`compteur − startKm`), **autorisés à ce jour** (forfait × part du contrat écoulée, en jours
entiers UTC), part consommée, part écoulée, projection à l'échéance au rythme actuel, `ended`. `null`
sans compteur lu. `leaseOverPace` : plus de km que le prorata. **La projection reste `null` le premier
mois** (`LEASE_PROJECTION_MIN_DAYS = 30`) : rapportée à quelques jours, une semaine de vacances se
lirait comme 60 000 km à l'échéance. Ce mois-là la ligne de détail affiche « Fin le … ».

**Affichage** (`VehiclesView.vue`) : le pied de la colonne de gauche, `.vcard__foot` (zone de grille `q`,
celle du quota Tesla, que la R5 n'utilise pas), empile quota et LOA. Ligne « LOA · X km sur Y autorisés à
ce jour », jauge (remplissage = part du forfait consommée, repère vertical = rythme autorisé, orangé
`#d38b22` quand on roule plus vite que le prorata), ligne de détail « ≈ Z km au <date> (forfait N) » ou
« LOA terminée ». **La ligne de détail garde sa hauteur même vide** (règle « rien ne bouge »).

**Mesuré** (preview `kasbah-mock`, descripteur passé en `renault` à la main pour voir le bouton) : à
1440 × 900 la carte garde sa hauteur (533 px) : le pied tient dans la place libre ; à 1152 × 720 et
960 × 600 (zooms 1,25 et 1,5, disposition moyenne) elle **grandit de 48 px** quand une LOA est saisie,
comme avec le quota Tesla (accepté, pas corrigé). À 375 × 812, ni débordement ni libellé coupé en fr et en,
après raccourcissement de la ligne de projection. Clair et sombre : le repère prend `var(--text)`. Non
joué : le bouton Renault contre le vrai serveur.

Sources : `apps/web/src/components/vehicles/VehicleTuning.vue`, `apps/web/src/views/VehiclesView.vue`,
`apps/web/src/lib/vehicleLease.ts`, `apps/web/src/i18n/locales/{fr,en}.json` (`vehicle.lease.*`).

### Mise à jour 2026-10-19 (bis) — jauge LOA : graduations d'anniversaire et repère du maximum autorisé

Demande de l'utilisateur après un premier essai : un repère discret par année du contrat, un repère plus
visible pour l'utilisation maximale théorique à l'instant T, **dans le langage des autres jauges**.

- **La jauge est celle de la batterie** (`VehicleBattery.vue`) : 8 px, pas d'`overflow: hidden`, les
  repères DÉBORDENT par-dessus ; remplissage accent, orangé `#d38b22` au-delà du rythme autorisé.
- **Graduations d'anniversaire** (début + 1 an, + 2 ans…, aucune sur l'échéance elle-même) :
  `leaseYearMarks(lease)` rend `{ share, date, km }` — la part du contrat est aussi la part du forfait
  autorisée à cette date. Gabarit des graduations du TENS (2 × 12 px), en `var(--muted)` : elles
  rythment, elles n'alertent pas. Infobulle « <date> : N km autorisés » (`vehicle.lease.yearMark`).
- **Repère du maximum autorisé à ce jour** : gabarit du repère de cible de charge (3 × 16 px), mais en
  **info** (`rgb(var(--v-theme-info))`) et non en warning comme les autres repères : en warning, il se
  perdrait dans le remplissage orangé du dépassement, justement quand il compte. Infobulle « Autorisé à
  ce jour : N km » (`vehicle.lease.paceMark`). Il remplace le trait `var(--text)` à 55 % de la première
  version.

Mesuré dans la preview `kasbah-mock` (contrat d'exemple de 37 mois, trois graduations) : à 1440 × 900 la
carte garde sa hauteur ; en disposition moyenne (1152 × 720) elle grandit de **52 px** avec une LOA
saisie (48 avant : la jauge passe de 4 à 8 px) ; aucun débordement ; couleurs relevées en clair et en
sombre.

Sources : `apps/web/src/views/VehiclesView.vue`, `apps/web/src/lib/vehicleLease.ts` (+ test),
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-10-19 (ter) — jauge LOA en blocs, repère de la batterie

L'utilisateur a demandé la cohérence graphique avec les autres jauges de la carte, ce qui remplace les
choix de la section (bis) :

- **Anniversaires = blocs**, comme les paliers de la limite de charge (`ChargeLimitCard.vue`,
  `.limit__mark`) : la piste (`.vcard__lease-track`, 8 px, rognée) est découpée par des fentes de 2 px de
  la couleur du fond de la carte (`var(--surface)`, celui de `.card`). Les graduations grises du TENS
  sont abandonnées.
- **Maximum autorisé à ce jour = repère de la batterie** (`VehicleBattery.vue`, `.soc__tick` : cible et
  plancher), 3 × 16 px en **warning**, posé par-dessus la piste, hors du rognage. Le repère info est
  abandonné.
- **Dépassement en rouge** (`rgb(var(--v-theme-error))`, comme la batterie basse) au lieu de l'orangé
  `#d38b22` : le repère warning se serait fondu dans un remplissage orangé, précisément quand on roule
  plus vite que le forfait.

Mesuré dans la preview `kasbah-mock` à 1440 × 900 : carte de 533 px, inchangée ; fentes de la couleur
exacte de la carte en sombre comme en clair ; repère de la même couleur que ceux de la batterie.

Sources : `apps/web/src/views/VehiclesView.vue`.

### Mise à jour 2026-10-25 — vue Énergie : l'historique par période

**Le sélecteur** (`apps/web/src/views/EnergyView.vue`) : Instantané / Jour / Semaine / Mois / Année / Total, et à côté un découpage **Glissant / Calendaire**, grisé hors semaine, mois et année. Glissant = les 7 ou 31 derniers jours, les 12 derniers mois ; calendaire = depuis lundi, depuis le 1er, depuis janvier. Le calendaire existe pour **retrouver les chiffres de l'appli du fabricant**, qui compte ainsi ; le glissant reste le défaut. La donnée vient de `GET /api/devices/:id/energy-days` (voir [1_14 Énergie](../1_architecture/1_14_energie.md)).

**Calcul des périodes.** `bucketSlots` (`apps/web/src/lib/consumption.ts`) reçoit une option `mode` (glissant par défaut : eau, chauffage et lumières n'ont pas bougé). Le même jour, ces trois graphes ont reçu à leur tour le sélecteur Glissant / Calendaire : voir [4_6](4_6_autres-vues.md) et [4_3](4_3_vues-lumieres-ouvrants-cameras.md). `apps/web/src/lib/energyPeriods.ts` porte les totaux, les barres, `energyUnit`, `inverterTotals` et `formatEnergyTotal` : **MWh dès 1 000 kWh**, à la demande de l'utilisateur, pour ne pas écrire cinq chiffres.

**Le schéma de flux sur une période** (`components/energy/EnergyFlow.vue`). Sur une période, les nœuds disent des **énergies** (kWh) au lieu de puissances, et l'anneau de la maison se dessine depuis `solarHomeWh` / `batteryHomeWh` / `gridHomeWh`. **Aucun point animé** : sur une période, le courant a circulé dans les deux sens (le réseau a donné et reçu, la batterie s'est chargée et vidée), une flèche mentirait. Un titre porte « · incomplet » quand un jour de la période manque ; un total ne se présente pas comme complet quand il ne l'est pas.

**Les cases d'onduleurs** (`components/energy/InverterFields.vue`). Sur une période, chaque case montre le **cumul** de l'onduleur : le nombre seul, l'unité écrite **une fois** sous le titre du champ. Essayé d'abord avec l'unité dans chaque case : « 21,6 kWh » débordait d'une case de 52 px (principe « rien ne bouge », [4_0](4_0_langage-visuel.md)). La jauge est relative au meilleur du champ, et les repères record et plafond (qui parlent d'une puissance instantanée) sont masqués.

**La carte Enphase des Réglages** (`components/EnphasePairingCard.vue`) : section « Historique » (dernière synchro, jours couverts), ligne « Onduleurs » avec l'avancement du rattrapage, **frise** mois × 31 colonnes (une case par jour, couleur selon l'état complet / incomplet / absent, lue dans `coverage.days`), bouton **Resynchroniser** et interrupteur « Tout reprendre » (= `force: true`), ligne « Reprendra N jours incomplets » qui dit à l'avance ce que le bouton va faire. Routes : [3_7 Enphase](../3_plugins/3_7_enphase.md).

Libellés en fr et en (`apps/web/src/i18n/locales/`). Tests : `consumption.test.ts`, `energyPeriods.test.ts`, `EnphasePairingCard.test.ts`.

### Mise à jour 2026-10-26 — cases d'onduleurs : le record suit la période

Ce qui change dans « Les cases d'onduleurs » ci-dessus : les repères record (vert) et plafond (jaune)
**ne sont plus masqués sur une période**. Ils restent sur l'échelle en **W** (0 → max de la crête du
module, du plafond et des records), même quand la jauge montre des Wh : les deux repères se lisent
l'un contre l'autre.

- **Le repère vert suit le sélecteur** (`inverterPeaks`, `lib/energyPeriods.ts`) : le plus haut pic
  quotidien de l'onduleur sur Jour, Semaine, Mois, Année ou Total ; en **Instantané**, le record de
  tout l'historique, pour comparer la puissance du moment au meilleur jamais atteint. Source des pics :
  `peakW` de `energy-days` ([1_14](../1_architecture/1_14_energie.md)), eux-mêmes lus dans le cloud
  ([3_7](../3_plugins/3_7_enphase.md), même date).
- **Infobulle** : « … · Record xxx W », aussi sur une période.
- **`EnergyView` charge l'historique journalier même en Instantané** (avant : seulement sur une
  période), sans quoi le repère n'a rien à montrer au premier affichage.
- **`InverterCell.maxW` supprimé** (`lib/energy.ts`) : le record ne vient plus de l'état live
  (`maxValue`) mais de l'historique, par période. `scaleW` = max(crête, plafond) ; la vue l'élargit aux
  records (`scaleOf` dans `InverterFields.vue`) pour qu'aucun repère ne sorte de la case.
- Une puissance instantanée peut dépasser le record (il est en moyenne 15 min) : la jauge passe alors
  au-dessus du repère vert, c'est normal.

Vérifié dans la preview `kasbah-mock` à 1440×900 : un repère différent pour chaque période, aucune
case ne bouge (mesure géométrique, 15 boîtes), console propre. Tests : `energyPeriods.test.ts`,
`lib.test.ts`.
