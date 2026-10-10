# COMAP Proteo

| | |
|---|---|
| **Id** | `comap` |
| **Appareils** | une station de traitement de l'eau (`water`), un seul appareil pour toute la station |
| **Connexion** | **locale**, protocole non officiel ([comap-proteo-protocol](https://github.com/stillgbx/comap-proteo-protocol)) : JSON en clair sur TCP, port 23, sur le réseau de la maison |
| **Compte** | aucun : la station n'a pas d'authentification, rien à appairer ni à coller |
| **Vues** | Eau, Maison (marqueur 3D de la station), Réglages → Plugins |

![Vue Eau](../screenshots/water.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

Testé sur une station **Proteo 2** (antitartre électronique, préfiltre, deux cartouches de charbon actif, lampe UVc). Le plugin est en **lecture seule** : les réglages se font sur l'écran tactile de la station.

- **Usure des consommables** : préfiltre, charbon 1, charbon 2 et lampe UVc, en pourcentage restant (rouge sous 20 %).
- **Lampe UVc** : allumée ou éteinte.
- **Débit instantané**, en litres par heure. Le débitmètre compte par pas de 36 L/h : la mesure est plus grossière que ses chiffres ne le laissent croire.
- **Consommation** du jour, de la semaine et du mois, et un **historique** construit par Kasbah : graphique par heure (48 dernières heures), par jour (62 derniers jours) et par mois (année civile en cours), avec un repère de moyenne française selon la taille du foyer.
- **Avertissement** et **défaut** de la station (indicateurs de synthèse : les codes détaillés ne sont pas décodés).

## Connexion

Tout passe par le réseau local : le serveur Kasbah ouvre une connexion TCP courte vers la station à chaque lecture (toutes les 30 s), puis la referme. Aucun cloud, aucun compte, aucun quota. La station n'a aucune authentification : toute machine du réseau local peut la lire (et y écrire), ce que Kasbah ne fait pas.

**Une seule connexion à la fois.** La station n'en accepte qu'une, et l'appli mobile du fabricant s'en sert aussi. Pendant qu'elle est ouverte, une lecture de Kasbah reste muette : c'est normal et sans conséquence. Le plugin ne déclare la station indisponible qu'après plusieurs échecs de suite (trois sondages).

## Mise en route

1. Donner à la station une adresse fixe (bail DHCP réservé) et la noter. Aucune découverte automatique : l'adresse se configure.
2. Renseigner `COMAP_HOST` dans `apps/server/.env` (par exemple `COMAP_HOST=192.168.1.50`), puis redémarrer le serveur.
3. Cocher **Comap** dans **Réglages → Plugins**.
4. La station apparaît dans la vue **Eau**. L'historique se remplit au fil du temps : le suivi horaire se dessine en quelques heures, le quotidien en quelques jours.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `COMAP_HOST` | — | Adresse IP de la station : **obligatoire**. Sans elle, le plugin ne déclare aucun appareil et reste en erreur (« set COMAP_HOST to the station address ») |
| `COMAP_PORT` | `23` | Port TCP de la station |
| `COMAP_POLL_MS` | `30000` | Cadence de lecture (5 000 à 600 000 ms) |
| `COMAP_TIMEOUT_MS` | `5000` | Délai avant d'abandonner une lecture restée muette (500 à 30 000 ms) |
| `COMAP_HISTORY_FILE` | `apps/server/.state/comap-consumption.json` | Où garder l'historique de consommation. Vide : il repart de zéro à chaque redémarrage |

## Limites

- **Lecture seule**, volontairement : une fausse manœuvre à distance sur l'eau potable coûterait plus cher que le confort gagné.
- Le graphique ne compare que l'eau **filtrée** par la station : une partie de l'eau de la maison peut ne pas la traverser (extérieur, garage, arrosage). Ne pas le lire comme un indicateur de facture.
- Le suivi mensuel suit l'année civile : au 1er janvier, l'année écoulée disparaît du graphique.
- Une heure sans mesure (trou de plus d'une heure, redémarrage) est laissée vide plutôt que remplie par un zéro ou un faux pic.
- Les compteurs de la station sont remis à zéro par la station elle-même ; l'horloge qui date les relevés est la sienne.
- Les alertes détaillées de la station ne sont pas décodées : seuls « avertissement » et « défaut » sont affichés.

## Pour aller plus loin

- Le protocole de la station, reconstitué par capture et documenté à part : [stillgbx/comap-proteo-protocol](https://github.com/stillgbx/comap-proteo-protocol).
- Fonctionnement du plugin, pièges et historique de consommation : [wiki, COMAP Proteo](../../doc/3_plugins/3_12_comap-proteo.md).
