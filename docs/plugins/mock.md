# Simulation (mock)

| | |
|---|---|
| **Id** | `mock` |
| **Appareils** | tous les types d'appareils, simulés : lumières, ouvrants, lecteurs, chauffage, aspirateur, tondeuse, capteurs, énergie solaire, borne et véhicules, météo, eau, animaux, ventilateurs (pas de caméra) |
| **Connexion** | aucune : la simulation tourne **dans le serveur Kasbah** |
| **Compte** | aucun, rien à configurer |
| **Vues** | toutes (Maison, Lumières, Ouvrants, Médias, Chauffage, Véhicules, Robots, Animaux, Énergie, Eau, Météo…), Réglages → Plugins |

## Ce que fait le plugin

- **Une maison qui vit toute seule**, sans matériel : volets qui montent à vitesse réaliste, thermostat qui rejoint sa consigne, aspirateur et tondeuse qui suivent leur planning, véhicules qui partent et rentrent, soleil et nuages qui font varier la production solaire, usure des consommables de la station d'eau…
- **La maison de démonstration** : les appareils portent des identifiants stables (`mock:light-living`, `mock:cover-kitchen`…) liés à `house/demo-house.json`, donc tout apparaît directement dans la scène 3D.
- **Un banc d'essai** : le même moteur sert à découvrir Kasbah sans rien acheter, à développer une vue, ou à voir un cas rare (alerte, panne, hiver) sans attendre qu'il arrive chez soi.
- **Quatre scénarios** : `default` (la maison de démo), `empty` (aucun appareil, pour voir les écrans vides), `chaos` (appareils qui disparaissent une trentaine de secondes, 10 % de commandes en erreur, réponses lentes de 3 s), `winter` (hiver : chauffage en marche, store rentré, lampes allumées).
- **Un temps accéléré** possible : une journée simulée en quelques minutes pour voir le soleil bouger ou une recharge se terminer.
- Le moteur existe aussi **dans le navigateur** (démo sans serveur : `VITE_INPROCESS_MOCK=1 npm run dev -w @kasbah/web`).

## Connexion

Aucune. Rien n'est lu ni envoyé sur le réseau : les valeurs sont fabriquées par le serveur, et sont **déterministes** (même graine + même heure de départ = même journée). L'état vit en mémoire : un redémarrage du serveur remet la maison à son état initial.

## Mise en route

1. Rien à faire sur une installation neuve : sans section `plugins` dans le fichier de la maison, le serveur démarre avec **la simulation seule**.
2. Pour la retirer, ou l'ajouter à de vrais plugins : cocher / décocher **Mock** dans **Réglages → Plugins**.
3. **Dès qu'un vrai plugin couvre un type d'appareil, décocher ce type** dans les sous-items du plugin (« Lumière » quand Hue est branché, « Ouvrant » avec TaHoma, « Lecteur » avec Cast ou Sonos…). Sans cela, les appareils simulés s'empilent avec les vrais dans la bande « Hors maison » et on ne distingue plus l'un de l'autre. Décocher « Énergie » retire le site solaire simulé **et** ses vingt panneaux ; le changement prend effet tout de suite, sans redémarrage.

Il y a un sous-item par type simulé (15 aujourd'hui), tous cochés par défaut.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `MOCK_SCENARIO` | `default` | Scénario : `default`, `empty`, `chaos` ou `winter` |
| `MOCK_SEED` | `42` | Graine du hasard : la même donne la même journée |
| `MOCK_TIME_SCALE` | `1` | Accélération du temps simulé (`60` : une journée en 24 minutes) |
| `MOCK_START_TIME` | — (maintenant) | Date et heure de départ simulées, au format ISO 8601 (ex. `2026-06-21T06:00:00+02:00`) |

Quels types d'appareils sont simulés se choisit dans Réglages → Plugins, jamais ici.

## Limites

- **Ce sont des valeurs fictives** : une borne de recharge ou un panneau simulé dessine de vrais flux dans la vue Énergie. Mélangée à de vraies mesures sans décocher le type correspondant, la simulation fausse les compteurs. À ne pas laisser cochée sur ce qu'aucun vrai plugin ne couvre, sauf à savoir qu'on regarde de la démonstration.
- Pas de caméra simulée.

## Pour aller plus loin

Moteur, scénarios et comportements simulés : [wiki, Simulation et plugin mock](../../doc/3_plugins/3_0_simulation-mock.md).
