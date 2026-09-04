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
  "origin": { "lat": 45.764, "lon": 4.8357, "alt": 180, "heading": 15 },
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

Les ids des appareils du plugin `mock` sont stables (`mock:light-living`, `mock:cover-kitchen`, `mock:energy-site`, `mock:vehicle-tesla`…) ; les ids Hue sont les UUID des ressources `light` du bridge (visibles dans `GET /api/devices`).

### Scènes (`scenes`)

Lots de commandes exécutés d'un geste depuis le panneau Maison : `{ "id", "name", "icon"?: "leave" | "night" | "movie", "actions": [{ "deviceId", "command" }] }`. Les commandes sont celles de l'API (`light.set`, `cover.close`, `media_player.pause`, `climate.set_target_temp`…) ; les appareils inconnus du serveur sont ignorés.

### Toit (`roof`)

`flat` (dalle sur l'emprise) ou `gable` (deux pentes) ; `pitch` en degrés, `ridgeAxis` (`x` ou `y`, défaut : le côté le plus long), `overhang` en mètres. Masqué dès qu'un niveau est mis au point.

## Exemple complet

[house/demo-house.json](../house/demo-house.json) : deux niveaux, sept pièces, jardin avec allée, terrasse, pelouse et piscine, dix-neuf appareils liés au plugin de simulation.

## Vérifier un fichier

```bash
KASBAH_HOUSE_FILE=chemin/vers/ma-maison.json npm run dev -w @kasbah/server
```

Le serveur refuse de démarrer sur un fichier invalide et affiche chaque problème avec son chemin ; `GET /api/house/warnings` liste les avertissements.
