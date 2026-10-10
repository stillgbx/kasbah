# Mitsubishi MELCloud

| | |
|---|---|
| **Id** | `melcloud` |
| **Appareils** | une zone de chauffage (`climate`) par zone de la pompe à chaleur, en lecture seule |
| **Connexion** | **cloud, non officielle** : l'API de l'application mobile MELCloud (le module Wi-Fi d'une Ecodan ne parle qu'à ce cloud) |
| **Compte** | identifiant et mot de passe du compte MELCloud, saisis une seule fois dans Réglages ; seule une clé de session est gardée |
| **Vues** | Chauffage, Maison (panneau pièce), Réglages → Plugins |

![Vue Chauffage](../screenshots/heating.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Une zone de chauffage = un appareil** : température mesurée, et consigne affichée. La machine est « allumée » presque toute l'année ; l'interface distingue ce qui est allumé de ce qui chauffe vraiment.
- **Vue Chauffage** : l'état de la machine (en marche, en veille, injoignable), dégivrage, appoint électrique, circulateurs, vanne 3 voies, températures de départ, de retour et extérieure, demande, erreur éventuelle, et l'heure de la dernière remontée.
- **Historique de fonctionnement** sur les dernières 48 heures (quand la machine a chauffé, dégivré, sollicité l'appoint, face à quelle température extérieure). Il se construit au fil des lectures faites par Kasbah, une semaine au plus : il est vide au départ.
- **Placement** : chaque zone se place dans la maison comme les autres appareils, par le fichier de la maison.

Ce que le plugin ne fait pas : voir Limites.

## Connexion

Le serveur Kasbah interroge le cloud de Mitsubishi à intervalle régulier (une lecture toutes les 2 minutes par défaut, un seul appel pour tout le compte). Rien ne passe par le réseau local. Cette API n'est pas publiée par Mitsubishi pour les particuliers : c'est celle de l'application, avec le risque qu'elle change sans préavis.

Il n'y a pas de connexion déléguée (OAuth). Le mot de passe traverse le serveur **une seule fois**, il n'est ni écrit ni journalisé ; MELCloud rend en échange une clé de session, seule conservée, dans `apps/server/.state/melcloud-session.json`.

## Mise en route

1. Cocher **Melcloud** dans **Réglages → Plugins**.
2. Dans la section Mitsubishi MELCloud de Réglages → Plugins : saisir l'**adresse e-mail MELCloud** et le **mot de passe**, puis **Lier le compte**.
3. La carte affiche le nombre de machines et de zones de chauffage publiées, et les zones apparaissent aussitôt dans la vue Chauffage.
4. Rien à recopier dans `.env`. **Délier le compte** supprime la clé de session.

Si MELCloud refuse un jour la clé, le plugin repasse en « Appairage requis » : il suffit de lier le compte à nouveau.

## Configuration (`apps/server/.env`)

Tout est facultatif, aucun secret n'y figure.

| Variable | Défaut | Rôle |
|---|---|---|
| `MELCLOUD_BASE_URL` | `https://app.melcloud.com/Mitsubishi.Wifi.Client` | Point d'entrée de l'API, au cas où le fabricant le déplace |
| `MELCLOUD_APP_VERSION` | `1.34.12.0` | Version d'application annoncée à la connexion |
| `MELCLOUD_SESSION_FILE` | `apps/server/.state/melcloud-session.json` | Où garder la clé de session (jamais le mot de passe). Vide : la liaison est perdue à chaque redémarrage |
| `MELCLOUD_POLL_MS` | `120000` | Cadence de lecture, de 60 000 à 3 600 000 ms |
| `MELCLOUD_HISTORY_FILE` | `apps/server/.state/melcloud-history.json` | Historique de fonctionnement. Vide : il repart de zéro à chaque redémarrage |

## Limites

- **Lecture seule** : les consignes s'affichent, elles ne se règlent pas encore depuis Kasbah.
- **Une machine MELCloud n'est pas une pompe à chaleur** : plusieurs pompes en cascade derrière un même régulateur n'apparaissent que comme une seule machine à deux zones.
- **Pas de ballon d'eau chaude, pas de compteur d'énergie** : MELCloud ne les expose pas pour toutes les installations, rien n'est affiché en kWh.
- Selon la zone, la température affichée est celle de la pièce ou la température de départ de l'eau (loi d'eau) : l'interface le précise.
- L'historique ne suit que la première machine du compte.
- L'indicateur « hors ligne » de MELCloud n'est pas fiable : Kasbah juge la machine joignable tant qu'elle a remonté des données dans les 15 dernières minutes.

## Pour aller plus loin

Fonctionnement interne, pièges de l'API et mappage : [wiki, Mitsubishi MELCloud](../../doc/3_plugins/3_13_mitsubishi-melcloud.md).
