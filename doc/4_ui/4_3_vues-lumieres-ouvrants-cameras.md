# Vues Lumières, Ouvrants et Caméras

> Dernière mise à jour : 2026-10-20
> Sources : sections reprises telles quelles de `4_1_navigation-et-panneaux.md` le 2026-10-13 ; chaque section cite les siennes.

Cette page couvre les vues Lumières, Ouvrants et Caméras (bandes par niveau, `RoomBands`), les contrôles d'ouvrant et la position favorite, les interrupteurs maîtres, les cartes et tuiles caméra. Elle est née du découpage de
[4_1 Navigation et panneaux](4_1_navigation-et-panneaux.md), trop longue pour être lue d'un trait : ses
sections y ont été déplacées sans retouche, dans leur ordre d'origine, avec leurs dates. Un renvoi
« plus haut » ou « plus bas » peut donc désigner une section restée dans une autre page de `4_ui/`.

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

## Mise à jour 2026-10-20 — vue Ouvrants : ouvrir, arrêter, fermer les volets d'une pièce d'un appui

Demande de l'utilisateur : « des boutons au niveau de la pièce afin de pouvoir ouvrir / stop / fermer
tous les volets de la pièce en un seul click ». `components/devices/RoomShutterKeys.vue` pose dans
l'en-tête de chaque carte de pièce (slot `room-action` de `RoomBands`, celui de l'interrupteur des
lampes d'une pièce dans la vue Lumières) les trois touches d'une ligne d'ouvrant, à 32 px.

**Les volets seulement**, choix de l'utilisateur parmi trois portées proposées (touches de ligne
appliquées à tout, touches de ligne sans ouvrir un passage, doctrine « au repos » de `CoversMaster`) :
ni store, ni portail, ni porte de garage. Un ouvrant sans nature déclarée compte comme un volet,
la nature par défaut (`coverWords`). Une pièce sans volet n'a pas de touches — une différence entre
pièces, jamais un élément qui apparaît dans le temps.

Comme les autres commandes d'ensemble, c'est un **lot** (`devices.runScene`) :

- Ouvrir et Fermer lisent la position **visée** (`targetPosition ?? position`, comme `CoversMaster`,
  section 2026-09-18 (4)) et n'écrivent qu'aux volets qui doivent bouger : on peut se raviser en pleine
  course. Une position inconnue reçoit la commande quand même ;
- Stop n'existe que si un volet de la pièce déclare `stop`, et part à tous les volets joignables qui
  la déclarent, immobiles compris — le même effet que la touche Stop d'une ligne. Sur une radio sans
  retour, cela efface la position déduite (`../3_plugins/3_4_somfy-tahoma.md`) ; ce que fait un moteur
  RTS immobile qui reçoit `stop` n'a pas été vérifié ;
- plus aucun volet joignable : les touches restent, grisées (règle « rien ne doit bouger »).

**Rien ne bouge** : les touches débordent de 5 px sur la marge de l'en-tête (`margin: -5px 0`) au lieu
de l'agrandir. Mesuré dans la preview : en-tête et première ligne au même endroit pour une carte avec
ou sans touches, aux zooms 1 / 1,25 / 1,5 ; thèmes clair et sombre. À −4 px, l'en-tête gagnait 1 px.

Libellés (infobulle et `aria-label` seulement) : `rooms.shuttersOpen`, `rooms.shuttersStop`,
`rooms.shuttersClose` (fr/en).

Sources : `apps/web/src/components/devices/RoomShutterKeys.vue` (+ `RoomShutterKeys.test.ts`),
`apps/web/src/views/CoversView.vue`, `apps/web/src/i18n/locales/{fr,en}.json`.
