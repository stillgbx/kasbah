# Mode édition et propriétés

> Dernière mise à jour : 2026-10-13
> Sources : sections reprises telles quelles de `4_1_navigation-et-panneaux.md` le 2026-10-13 ; chaque section cite les siennes.

Cette page couvre le mode édition de la maison (ouvertures, menuiserie, places, fenêtres de toit, jardin, terrain, relief, cadastre, apparence, dimensions, pièces et niveaux) et la gestion des propriétés (démo, création, renommage). Elle est née du découpage de
[4_1 Navigation et panneaux](4_1_navigation-et-panneaux.md), trop longue pour être lue d'un trait : ses
sections y ont été déplacées sans retouche, dans leur ordre d'origine, avec leurs dates. Un renvoi
« plus haut » ou « plus bas » peut donc désigner une section restée dans une autre page de `4_ui/`.

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

### Mise à jour 2026-10-10 (4) — l'interrupteur Démo | Réel

Décision de l'utilisateur : passer du mode démo au mode réel, et revenir, quand on veut. Mécanique
serveur : `../1_architecture/1_2_serveur-et-plugins.md` (catalogue) ; route :
`../1_architecture/1_3_protocole-rest-ws.md` (même date).

- **`components/property/ModeSwitch.vue`** : un `Segmented` **Démo | Réel** en tête de la carte
  « Propriété » des Réglages. « Réel » est grisé tant que le serveur n'annonce pas de propriété réelle
  (`realAvailable`) ; la consigne dit alors de créer une propriété ou de dupliquer une démo.
- **Confirmation, pas d'action directe** : changer de mode recharge l'application sur une autre maison ;
  une tablette murale ne doit pas basculer sur un doigt qui passe. Choisir l'autre mode arme une ligne
  « Passer en mode … ? L'application se recharge. » avec Annuler / Confirmer.
- **Rien ne bouge** : cette ligne est **réservée en permanence** (40 px de haut) ; au repos elle porte
  la consigne, armée la confirmation. Mesuré avant / après : à la première version la ligne sautait de
  **4 px** entre les deux états (hauteur au contenu) ; corrigé par la hauteur fixe. Vérifié en fr et en
  en au zoom 1,5, sans débordement.
- **Store `properties`** : `mode` (`null` pour une maison imposée ou la maquette sans serveur),
  `setMode` (attend que le serveur annonce le nouveau mode, puis recharge ; l'attente est partagée avec
  `select` par `reloadWhen`) et **`hasMenu`** = pouvoir changer **ou** créer. Le menu du rail et la carte
  « Propriété » s'affichent donc **aussi avec une seule propriété réelle** : sans cela, aucun moyen d'en
  créer une seconde.
- **`PropertyList.vue`** : plus de groupes « Mes propriétés / Démonstrations » (remplace la description
  de la mise à jour (2) ci-dessus) : le serveur ne liste que le mode courant ; les deux libellés i18n
  sont retirés. Nouvelles clés `properties.mode*`.
- Vérifié sur `kasbah-demo-server` + `kasbah-demo` : réel → démo → réel par la carte, propriété retenue
  rouverte dans chaque mode, démos seules en démo, carte « Mode édition » en lecture seule en démo.
  Pas de relecture UI indépendante pour ce lot au moment de l'écriture.

Sources : `apps/web/src/components/property/ModeSwitch.vue`, `apps/web/src/stores/properties.ts`,
`apps/web/src/components/layout/{NavRail,PropertyList}.vue`, `apps/web/src/views/SettingsView.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-10-10 (5) — renommer la propriété et un niveau, recherche d'adresse dans le monde

- **Section « Pièces et niveaux »** (`HouseEditPanel.vue`), sous la barre du brouillon : « Nom de la
  propriété », puis « Niveau de l'onglet » (nom + nom court des onglets, 12 caractères). Les champs
  du niveau sont TOUJOURS là, grisés sur « Tout » avec une consigne en placeholder : changer d'onglet
  ne fait rien bouger (mesuré). Un nom vide est refusé, le champ reprend l'ancien ; le nom court peut
  se vider. Gestes du store : `setPropertyName`, `setLevelIdentity` (dans le brouillon, annulables).
- **Recherche d'adresse** de l'assistant (`lib/geocode.ts`) : l'IGN (Base Adresse Nationale) ET Photon
  (komoot, OpenStreetMap, monde entier, sans clé), lancés ensemble ; l'IGN passe devant et fait foi
  pour la France — les résultats français de Photon sont écartés quand l'IGN répond (à Paris, une
  grande place n'avait pas le même point dans les deux services : 30 m ne suffisaient pas à
  reconnaître le doublon) ; ailleurs, un lieu déjà donné à moins de 30 m n'est pas répété ; six
  résultats au plus ; un service muet laisse la place à l'autre. Champ « Adresse » (plus « (France) »).
  La photo satellite reste celle de l'IGN, France seulement : ailleurs, le mode « Plan ».

Vérifié dans la preview simulée : renommages (onglet « R+1 », en-tête), rien ne bouge, fr / en au
zoom 1,5 sans débordement ; recherches Paris (IGN seul), Madrid et Londres (Photon).

Tests : `apps/web/src/lib/geocode.test.ts`.
