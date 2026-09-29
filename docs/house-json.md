# Format `house.json`

Le fichier décrit la maison et le jardin ; il est validé au démarrage du serveur (`parseHouse`, schéma zod dans `packages/shared/src/house/schema.ts`) : une erreur de structure empêche le démarrage avec un chemin lisible (`rooms[1].openings[0].offset: opening exceeds segment length`). Les incohérences non bloquantes (pièce sans appareil, appareil non lié) sont journalisées en avertissement.

## Repère

- **Unités : mètres. Axes : `x` vers l'est, `y` vers le nord, `z` vers le haut** (Z-up). Les polygones sont des listes de points `[x, y]` dans le plan ; les hauteurs s'expriment en `z`.
- `origin` donne la position GPS du point `(0, 0, 0)` : `lat`, `lon`, `alt` et `heading` = cap (degrés, sens horaire depuis le nord vrai) de l'axe local `+y`. Avec `heading: 0`, `+y` pointe au nord ; avec `heading: 90`, `+y` pointe à l'est. Sert à placer les véhicules d'après leur GPS.
- Les polygones de **pièces** sont la **face intérieure finie** des murs, en **sens trigonométrique (CCW)** — l'ordre est imposé car les ouvertures référencent un index d'arête.

## Structure

```jsonc
{
  "schemaVersion": 1,
  "id": "maison", "name": "Ma maison",
  "origin": { "lat": 47.309343, "lon": 5.045591, "alt": 180, "heading": 15 },
  "defaults": {                       // tous optionnels
    "levelHeight": 2.6, "slabThickness": 0.25,
    "interiorWallThickness": 0.10, "exteriorWallThickness": 0.30,
    "doorHeight": 2.10, "windowSill": 0.9
  },
  "levels": [ { "id": "rdc", "name": "Rez-de-chaussée", "elevation": 0.2, "height": 2.6, "outline": [[…]] } ],
  "rooms": [ /* voir ci-dessous */ ],
  "site": { "elevation": 0, "terrain": [[…]], "zones": [ { "id": "pelouse", "name": "Pelouse", "kind": "lawn", "polygon": [[…]] } ] },
  "devices": [ /* voir ci-dessous */ ],
  "roof": { "type": "gable", "levelId": "etage", "ridgeAxis": "x", "pitch": 35, "overhang": 0.4 }
}
```

### Niveaux (`levels`)

- `elevation` : `z` du sol fini (absolu). Placez le rez-de-chaussée **au-dessus** du terrain (`0.2` si le terrain est à `0`) pour éviter que sol et terrain se confondent.
- `shortName` (optionnel) : libellé court pour l'onglet de niveau (« RDC »).
- `height` : hauteur sous plafond (défaut `defaults.levelHeight`).
- `outline` (optionnel) : emprise extérieure, utilisée par le toit. Sinon la boîte englobante des pièces murées agrandie de l'épaisseur extérieure.
- `roomOrder` (optionnel) : ordre d'affichage des pièces du niveau (ids). Les pièces absentes de la liste suivent par ordre alphabétique. Écrit par le glisser-déposer de la vue Lumières ; supprimez la clé pour revenir à l'ordre alphabétique. Les niveaux, eux, se lisent du plus haut au plus bas dans les listes (les onglets de niveau, eux, montent).

### Pièces (`rooms`)

```jsonc
{
  "id": "salon", "levelId": "rdc", "name": "Salon",
  "polygon": [[3.2, 0], [10, 0], [10, 5], [3.2, 5]],     // CCW, face intérieure
  "kind": "room",                                        // room | corridor | stairs | garage | terrace | balcony
  "height": 2.6,                                         // optionnel
  "walls": [{ "segment": 2, "kind": "none" }],           // surcharges par arête : interior | exterior | none, thickness
  "openings": [
    { "id": "baie", "type": "window", "segment": 0, "offset": 1.5, "width": 2.4, "height": 2.15, "sill": 0.2 }
  ],
  "style": { "floor": "wood" }                           // wood | tile | concrete | carpet
}
```

**Murs.** Chaque pièce porte ses murs vers l'extérieur de sa face intérieure. Une arête est classée automatiquement `interior` (une autre pièce murée du même niveau se trouve juste derrière) ou `exterior`, avec l'épaisseur correspondante. Deux pièces adjacentes s'écrivent donc avec un **écart égal à la somme des demi-cloisons** : `0.20 m` avec les défauts (`0.10 + 0.10`). Un espace ouvert (salon/cuisine) se déclare avec `"kind": "none"` sur l'arête commune, des deux côtés. Les coins sont mitrés automatiquement ; `terrace` et `balcony` n'ont pas de murs.

**Ouvertures.** Ancrées sur l'arête `polygon[segment] → polygon[segment+1]` : `offset` est la distance depuis le premier sommet jusqu'au bord de l'ouverture, `width`/`height` ses dimensions, `sill` la hauteur d'allège (défaut `0` pour `door`/`passage`/`garage`, `defaults.windowSill` pour `window`). Une porte intérieure déclarée dans une pièce est **percée automatiquement dans le mur de la pièce en face** : inutile de la déclarer deux fois. Les fenêtres reçoivent un vitrage translucide ; un appareil de type volet lié à une ouverture (`openingId`) y anime une lame.

### Jardin (`site`)

`terrain` : polygone de la parcelle (n'a pas besoin d'être CCW). `zones` : surfaces colorées (`lawn`, `terrace`, `driveway`, `path`, `pool`, `bed`, `other`) qui servent aussi d'ancre aux appareils extérieurs et de cibles de cadrage caméra.

`relief` (facultatif) : relief du terrain, en écart à `elevation`. `step` = pas de la grille (m), `origin` = coin sud-ouest de la grille (m), `rows` = une chaîne par rangée, du sud au nord, hauteurs en **centimètres entiers** séparées par une espace, d'ouest en est. Absent = terrain plat. Sous les pièces, le terrain reste sous le plancher ; autour d'une piscine, il reste plat. Se modèle depuis l'UI : Réglages → Rendu 3D → « Modeler le terrain ».

```jsonc
"relief": { "step": 2, "origin": [-28, -40], "rows": ["0 0 12 15", "0 3 20 41"] }
```

`garden` (facultatif) : arbres, buissons et pierres, posés sur le terrain et qui en suivent le relief. `kind` = `broadleaf` (feuillu), `conifer`, `palm`, `shrub` (buisson), `rock` (pierre) ou `hedge` (haie) ; `center` = pied (m) ; `height` = hauteur (0,1 à 40 m, la largeur en découle) ; `yaw` = orientation (degrés, facultatif) ; `seed` = forme tirée (facultatif) ; `species` = espèce du catalogue de l'app (`cherry`…, facultatif ; inconnue = forme générique de la famille) ; pour une haie seulement, `length` = longueur du segment (0,5 à 100 m, facultatif, 3 par défaut, le long de l'axe tourné de `yaw`) et `width` = largeur (0,2 à 5 m, facultatif, 0,7 par défaut), `spacing` = espacement de pied à pied entre ses sujets (0,2 à 5 m, facultatif ; absent = automatique, les feuillages se chevauchent). Une haie en L = deux segments. Se pose depuis l'UI : Réglages → Mode édition, puis section « Jardin » de la vue Maison.

```jsonc
"garden": [{ "id": "garden.broadleaf-1", "kind": "broadleaf", "center": [4, 19], "height": 7, "yaw": 145, "species": "cherry" }]
```

### Appareils (`devices`)

```jsonc
{
  "id": "light.salon", "name": "Plafonnier salon",  // optionnel : absent → le nom du plugin fait foi
  "deviceId": "hue:6f2c…",              // liaison plugin : "<pluginId>:<externalId>" ; absent → affiché « non lié »
  "kind": "light",                      // indice si non lié ; sinon le descripteur du plugin fait foi
  "position": [6.6, 2.5, 2.5],          // x, y absolus ; z RELATIF au sol de l'ancre (niveau ou terrain)
  "levelId": "rdc", "roomId": "salon",  // ancre intérieure
  "zoneId": "allee",                    // ou ancre extérieure
  "openingId": "baie",                  // volets : le marqueur épouse l'ouverture
  "mount": "ceiling", "yaw": 0          // optionnels (yaw en degrés, 0 = face à +y)
}
```

Un appareil peut se réduire à sa **liaison** et à sa **position** (`{ id, deviceId, position, roomId, mount }`) : nom, kind et capacités viennent du plugin. Mieux : un appareil de plugin **absent** de ce tableau est placé automatiquement au centre du plafond de la pièce qui porte le nom de sa pièce côté fabricant (pièce Hue) ; l’entrée JSON ne sert donc qu’à **préciser** une position. Une lampe qu’aucune pièce ne réclame reste pilotable depuis la vue Lumières, sans marqueur 3D.

**Depuis l'UI** : panneau d'un appareil → « Déplacer » → glisser dans la 3D (x;y), préréglages et curseur pour la hauteur. Chaque dépôt est envoyé au serveur (`PUT /api/house/devices/:id`, corps `{ position, roomId?, mount?, deviceId? }`) qui **réécrit le fichier** (`KASBAH_HOUSE_FILE`) après validation complète, garde la version précédente en `<fichier>.bak` et pousse la maison aux tablettes connectées (message WebSocket `house`). Un appareil auto-placé y gagne son entrée minimale ; le fichier est reformaté (`JSON.stringify` à deux espaces), l'ordre des clés est conservé. Volets (ancrés à une ouverture) et tondeuse ne se déplacent pas ainsi.

Les ids des appareils du plugin `mock` sont stables (`mock:light-living`, `mock:cover-kitchen`, `mock:energy-site`, `mock:vehicle-tesla`…) ; les ids Hue sont les UUID des ressources `light` du bridge (visibles dans `GET /api/devices`).

### Scènes (`scenes`)

Lots de commandes exécutés d'un geste depuis le panneau Maison : `{ "id", "name", "icon"?: "leave" | "night" | "movie", "actions": [{ "deviceId", "command" }] }`. Les commandes sont celles de l'API (`light.set`, `cover.close`, `media_player.pause`, `climate.set_target_temp`…) ; les appareils inconnus du serveur sont ignorés.

### Toit (`roof`)

`flat` (dalle sur l'emprise) ou `gable` (deux pentes) ; `pitch` en degrés, `ridgeAxis` (`x` ou `y`, défaut : le côté le plus long), `overhang` en mètres. Masqué dès qu'un niveau est mis au point.

## Relevé métré (`meta.survey`)

Une maison réelle se mesure **à l'intérieur des pièces** : chaque cloison mitoyenne s'y retrouve réduite à une seule ligne partagée, alors que les polygones doivent être écartés de la somme des demi-cloisons (cf. **Murs** ci-dessus). Plutôt que de corriger les cotes à la main, les mesures brutes sont conservées dans `meta` — que le schéma laisse libre — et les `polygon` en sont **dérivés** par un script.

```jsonc
{
  "meta": {
    "survey": {
      "unit": "cm",                        // cm | mm | absent → mètres
      "frame": "0;0 = coin sud-ouest du plan, +x est, +y nord",
      "partition": 0.08,                   // cloison COMPLÈTE entre deux pièces murées (m)
      "levelOffsets": { "rdc": [0, 92] }   // correction de repère d'un niveau, dans l'unité du relevé
    }
  },
  "rooms": [{
    "id": "chambre", "levelId": "etage", "name": "Chambre",
    "polygon": [[…]],                                                    // DÉRIVÉ — ne pas éditer
    "walls": [{ "segment": 2, "kind": "interior", "thickness": 0.04 }],  // DÉRIVÉ aussi
    "meta": {
      "survey": {
        "points": [[0, 0], [360, 0], [360, 120], [360, 300], [0, 300]],  // les cotes relevées, jamais retouchées
        "note": "point 360;120 ajouté (colinéaire) : le mur est est mitoyen au-delà, en façade en dessous"
      }
    }
  }]
}
```

Régénérer après toute modification d'un relevé :

```bash
node house/fit-survey.mjs house/ma-maison.json           # réécrit polygon, walls et outline
node house/fit-survey.mjs house/ma-maison.json --check   # vérifie sans écrire (sortie 1 si divergence)
```

Le script rentre chaque face de l'épaisseur que le voisin pousse dans elle, laisse les façades en place (l'emprise du relevé est donc conservée), pose `kind` et `thickness` sur les arêtes mitoyennes, et recalcule l'`outline` du niveau sur ses pièces murées. Cinq points à connaître :

- **`partition` est indépendant de `defaults.interiorWallThickness`** : le défaut global continue de servir aux niveaux non relevés ; un relevé peut porter des cloisons plus fines sans les déplacer.
- **`levelOffsets`** corrige le **repère** d'une campagne de relevé dont le `0;0` ne tombe pas sur celui des autres niveaux : c'est une translation appliquée aux points bruts, donc un seul nombre à ajuster, et les cotes restent intactes.
- **Une arête ne porte qu'une nature et qu'une épaisseur.** Une arête à cheval — mitoyenne sur une partie, en façade sur le reste (décroché de façade) — doit être coupée en insérant un point **colinéaire** dans `points` : la pièce mesurée est inchangée et chaque portion reçoit son mur. Le script signale les arêtes concernées.
- **Une pièce sans mur** (`terrace`, `balcony` : terrasse, balcon, sas ouvert) ne crée pas de mitoyenneté : la pièce murée d'en face garde sa façade, et c'est la pièce sans mur qui l'absorbe. Son `polygon` est donc son **sol fini** — le décroché brut moins les façades qui le bordent.
- **Les ouvertures sont ancrées sur un index d'arête** : elles sont à revoir dès qu'un relevé change un polygone. Idem pour la `position` des appareils, qui peut se retrouver hors de sa pièce.

Enfin, `origin` attend le GPS du `0;0` du relevé. Si le seul point connu tombe ailleurs (marqueur d'adresse, repère d'un service de cartographie), le **ramener** au `0;0` plutôt que de le recopier tel quel ; et `heading` se mesure sur les arêtes du bâtiment, un relevé étant aligné sur les murs et non sur le nord.

## Exemple complet

[house/demo-house.json](../house/demo-house.json) : deux niveaux, sept pièces, jardin avec allée, terrasse, pelouse et piscine, dix-neuf appareils liés au plugin de simulation.

## Vérifier un fichier

```bash
KASBAH_HOUSE_FILE=chemin/vers/ma-maison.json npm run dev -w @kasbah/server
```

Le serveur refuse de démarrer sur un fichier invalide et affiche chaque problème avec son chemin ; `GET /api/house/warnings` liste les avertissements.
