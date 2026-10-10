# Simulation (mock)

| | |
|---|---|
| **Id** | `mock` |
| **Appareils** | tous les types d'appareils, simulés : lumières (avec effets), ouvrants (volets, stores, rideaux, portail, portes de garage, fenêtre de toit), lecteurs (enceintes, TV, écrans), chauffage, aspirateur, tondeuse, capteurs, énergie solaire, borne et véhicules, météo, eau, animaux, ventilateurs, caméras et sonnettes (sans flux vidéo), et des ambiances |
| **Connexion** | aucune : la simulation tourne **dans le serveur Kasbah** |
| **Compte** | aucun, rien à configurer |
| **Vues** | toutes (Maison, Lumières, Ouvrants, Médias, Chauffage, Véhicules, Robots, Animaux, Énergie, Eau, Météo…), Réglages → Plugins |

![Les Tilleuls](../screenshots/maison-tilleuls.webp)
![Les Embruns](../screenshots/maison-embruns.webp)
![Le Belvédère](../screenshots/maison-belvedere.webp)

*Captures de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Une maison qui vit toute seule**, sans matériel : volets qui montent à vitesse réaliste, thermostat qui rejoint sa consigne, aspirateur et tondeuse qui suivent leur planning, véhicules qui partent et rentrent, soleil et nuages qui font varier la production solaire, usure des consommables de la station d'eau…
- **Les propriétés de démonstration** : chacune des trois maisons de `house/demos/` a son parc (`tilleuls`, `embruns`, `belvedere`), aux identifiants stables (`mock:tl-light-salon`…) liés à la maison, donc tout apparaît directement dans la scène 3D. Le parc suit la propriété affichée.
- **Des ambiances** à rappeler depuis le panneau Maison, comme celles d'un pont Hue : fixes ou animées, par pièce ou par zone ; elles s'effacent quand on règle une de leurs lampes à la main.
- **Une sonnette** qui sonne à heures fixes (le facteur, un livreur) : la vue Maison réagit comme à une vraie.
- **Un banc d'essai** : le même moteur sert à découvrir Kasbah sans rien acheter, à développer une vue, ou à voir un cas rare (alerte, panne, hiver) sans attendre qu'il arrive chez soi.
- **Des scénarios** : un par propriété de démonstration, avec sa variante `-winter` ; et `default` (la maison des tests), `empty` (aucun appareil, pour voir les écrans vides), `chaos` (appareils qui disparaissent une trentaine de secondes, 10 % de commandes en erreur, réponses lentes de 3 s), `winter` (hiver : chauffage en marche, store rentré, lampes allumées).
- **Un temps accéléré** possible : une journée simulée en quelques minutes pour voir le soleil bouger ou une recharge se terminer.
- Le moteur existe aussi **dans le navigateur** (démo sans serveur : `VITE_INPROCESS_MOCK=1 npm run dev -w @kasbah/web`).

## Connexion

Aucune. Rien n'est lu ni envoyé sur le réseau : les valeurs sont fabriquées par le serveur, et sont **déterministes** (même graine + même heure de départ = même journée). L'état vit en mémoire : un redémarrage du serveur remet la maison à son état initial.

## Mise en route

1. Rien à faire sur une installation neuve : sans section `plugins` dans le fichier de la maison, le serveur démarre avec **la simulation seule**.
2. Pour la retirer, ou l'ajouter à de vrais plugins : cocher / décocher **Mock** dans **Réglages → Plugins**.
3. **Dès qu'un vrai plugin couvre un type d'appareil, décocher ce type** dans les sous-items du plugin (« Lumière » quand Hue est branché, « Ouvrant » avec TaHoma, « Lecteur » avec Cast ou Sonos…). Sans cela, les appareils simulés s'empilent avec les vrais dans la bande « Hors maison » et on ne distingue plus l'un de l'autre. Décocher « Énergie » retire le site solaire simulé **et** ses vingt panneaux ; le changement prend effet tout de suite, sans redémarrage.

Il y a un sous-item par type simulé (16 aujourd'hui, caméras comprises), tous cochés par défaut.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `MOCK_SCENARIO` | `default` | Scénario : `default`, `empty`, `chaos`, `winter`, ou celui d'une propriété (`tilleuls`, `embruns`, `belvedere`, et `-winter`). En démonstration, c'est la propriété qui le choisit ; `winter` y donne sa version d'hiver |
| `MOCK_SEED` | `42` | Graine du hasard : la même donne la même journée |
| `MOCK_TIME_SCALE` | `1` | Accélération du temps simulé (`60` : une journée en 24 minutes) |
| `MOCK_START_TIME` | — (maintenant) | Date et heure de départ simulées, au format ISO 8601 (ex. `2026-06-21T06:00:00+02:00`) |

Quels types d'appareils sont simulés se choisit dans Réglages → Plugins, jamais ici.

## Limites

- **Ce sont des valeurs fictives** : une borne de recharge ou un panneau simulé dessine de vrais flux dans la vue Énergie. Mélangée à de vraies mesures sans décocher le type correspondant, la simulation fausse les compteurs. À ne pas laisser cochée sur ce qu'aucun vrai plugin ne couvre, sauf à savoir qu'on regarde de la démonstration.
- Caméras et sonnettes **sans image** : la vue Caméras dit « pas de flux ». Les ambiances se rappellent mais ne se créent ni ne se suppriment.

## Pour aller plus loin

Moteur, scénarios et comportements simulés : [wiki, Simulation et plugin mock](../../doc/3_plugins/3_0_simulation-mock.md).
