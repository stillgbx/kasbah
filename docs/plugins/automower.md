# Husqvarna Automower

| | |
|---|---|
| **Id** | `automower` |
| **Appareils** | robots tondeuses (`mower`), un par robot |
| **Connexion** | **cloud Husqvarna** (Automower Connect API, officielle et gratuite) : il n'existe rien en local |
| **Compte** | une application créée sur `developer.husqvarnagroup.cloud` avec le compte de l'appli Automower Connect : une clé et un secret, sans consentement dans un navigateur |
| **Vues** | Robots, Maison (marqueur du robot en 3D), Réglages → Plugins |

## Ce que fait le plugin

- **État** : activité (tond, en charge, rentre, à la station, en pause, arrêtée, en erreur), batterie, prochain départ, hauteur de coupe (en cm), connexion et âge du dernier statut.
- **Ce qui retient le robot** : planning, pluie, gel, garé sur consigne, limite du jour atteinte, mise à jour en cours…
- **Erreur du constructeur** : code, texte (en anglais, tel que le connaît le support) et heure, par exemple « Erreur 2 · No loop signal ».
- **Position GPS** (modèles à GPS embarqué, par exemple le 435X AWD) : carte de la vue Robots et scène 3D. Un décalage GPS réglable dans la vue corrige un récepteur mal placé.
- **Compteurs** de vie : temps de tonte, recharges, collisions, distance.
- **Journal du robot** : les derniers messages, avec leur position quand elle est connue, posés comme incidents sur la carte.
- **Commandes** : **Lancer la tonte** (reprend le planning du robot) ou **Tondre 1 h**, pause, **Rentrer** (jusqu'au prochain créneau ou jusqu'à nouvel ordre).
- **Temps réel** : le constructeur pousse les changements par un flux d'événements, sans consommer de requêtes.

## Connexion

Tout passe par le cloud Husqvarna. Le jeton se redemande tout seul (il vaut une journée) : il n'y a ni page de consentement, ni fichier de jetons, ni appairage dans l'interface. L'application représente le compte propriétaire du robot. Un robot hors ligne (`Hors ligne`) refuse les commandes.

## Mise en route

1. Sur `developer.husqvarnagroup.cloud`, se connecter avec le compte de l'appli Automower Connect (celui qui possède le robot) et créer une application. La relier aux **deux** API « Authentication API » et « Automower Connect API ». L'URL de redirection importe peu.
2. Copier la clé (« Application key ») et le secret de l'application dans `apps/server/.env` : `AUTOMOWER_APP_KEY=…` et `AUTOMOWER_APP_SECRET=…`.
3. Redémarrer le serveur, puis cocher **Automower** dans **Réglages → Plugins**.
4. Le robot apparaît dans la vue **Robots**. Sans clé, le plugin reste en attente (« Appairage requis »).

## Quota

Le constructeur limite chaque clé à **21 000 requêtes par fenêtre de sept jours** (une par seconde au plus), puis coupe. La fenêtre est calée sur la création de l'application ; le portail développeur affiche le compte et l'instant de remise à zéro (« Resets at … »). Kasbah y reste largement : le flux d'événements est gratuit, et la relecture complète toutes les 10 minutes coûte environ 1 000 requêtes par semaine. La jauge au bas de la carte Robots montre le compte de la semaine.

Si elle s'écarte du portail (le portail fait foi), la caler avec `AUTOMOWER_QUOTA_RESET_AT`.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `AUTOMOWER_APP_KEY` | — | Clé de l'application (« Application key ») |
| `AUTOMOWER_APP_SECRET` | — | Secret de l'application |
| `AUTOMOWER_POLL_MS` | `600000` | Relecture complète, qui rattrape ce que le flux aurait manqué (60 000 à 3 600 000 ms) |
| `AUTOMOWER_TIMEZONE` | fuseau du serveur | Fuseau de la maison (par exemple `Europe/Paris`), pour ramener les heures du robot à l'heure vraie |
| `AUTOMOWER_USAGE_FILE` | `apps/server/.state/automower-usage.json` | Où garder le compte de requêtes. Vide : la jauge repart de zéro à chaque redémarrage |
| `AUTOMOWER_QUOTA_RESET_AT` | — | Instant « Resets at » du portail (ISO 8601, par exemple `2026-09-23T17:00:00+02:00`), pour caler la fenêtre exactement |

## Limites

- Le robot écrit ses heures (prochain départ, erreur) en heure locale : si `AUTOMOWER_TIMEZONE` est faux, elles sont décalées.
- La carte du robot (zones de travail, zones interdites) n'est pas dessinée, et le câble périphérique n'est pas publié par l'API.
- Pas encore de réglage de la hauteur de coupe ni des phares, ni de confirmation d'une erreur à distance : à faire dans l'appli du constructeur.
- Une erreur comme « No loop signal » ne se lève pas à distance.
- Le GPS est un récepteur grand public (bruit de 2 à 3 m) ; le robot lui-même annonce une position toutes les 30 secondes environ.

## Pour aller plus loin

Fonctionnement interne, flux d'événements et captures de l'API : [wiki, Husqvarna Automower](../../doc/3_plugins/3_11_husqvarna-automower.md).
