# iRobot (Roomba)

| | |
|---|---|
| **Id** | `irobot` |
| **Appareils** | aspirateurs (`vacuum`), un par robot du compte |
| **Connexion** | **locale** : le robot héberge son propre courtier MQTT (TLS) sur le réseau de la maison ; le cloud n'est contacté qu'une fois, pour obtenir le mot de passe de ce courtier |
| **Compte** | identifiant et mot de passe du compte iRobot, saisis une seule fois dans Réglages ; seul le mot de passe local de chaque robot est gardé |
| **Vues** | Robots, Maison (panneau pièce, base du robot), Réglages → Plugins |

![Vue Robots](../screenshots/robots.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **État du robot** : activité (à la base, nettoyage, en pause, retour à la base, erreur), batterie, bac plein, message d'erreur, mis à jour en direct (le robot pousse son état de lui-même, sans sondage).
- **Commandes** : **Démarrer** (ou reprendre une mission en pause), **Pause**, **Retour base**, **Localiser**.
- **Serpillière** (robots qui lavent, comme le Roomba Combo) : patin posé ou non, niveau d'eau.
- **Robot retrouvé tout seul** sur le réseau : aucune adresse IP à saisir, et un changement d'adresse (DHCP) est rattrapé au balayage suivant.
- Un robot du compte introuvable sur le réseau (éteint, hors Wi-Fi) reste affiché, marqué **Hors réseau**.

## Connexion

Une fois le compte relié, tout se passe en local : le serveur Kasbah ouvre une session MQTT chiffrée (port 8883) directement avec le robot. Ni sondage du fabricant, ni quota, rien ne sort du réseau.

Le détour par le compte iRobot est nécessaire une seule fois : les Roomba récents ne remettent plus le mot de passe de leur courtier local à qui le demande sur le réseau. Kasbah l'obtient donc en se connectant au compte, puis le range, pour chaque robot, dans `apps/server/.state/irobot-session.json`. Le mot de passe du **compte**, lui, traverse le serveur une seule fois et n'est ni écrit ni journalisé. Il n'y a pas de connexion déléguée (OAuth). Les comptes avec double authentification ne sont pas pris en charge.

## Mise en route

1. Cocher **Irobot** dans **Réglages → Plugins**, robot allumé et sur le même réseau que le serveur.
2. Dans la section iRobot de Réglages → Plugins : saisir l'**adresse e-mail iRobot** et le **mot de passe**, puis **Lier le compte**.
3. Le robot apparaît dans la liste de la carte, et dans la vue Robots. Rien à recopier dans `.env`.
4. **Délier le compte** ferme les liens et efface les mots de passe locaux.

## Configuration (`apps/server/.env`)

Tout est facultatif et aucun secret n'y figure.

| Variable | Défaut | Rôle |
|---|---|---|
| `IROBOT_SESSION_FILE` | `apps/server/.state/irobot-session.json` | Où garder les mots de passe locaux des robots. Vide : la liaison est perdue à chaque redémarrage |
| `IROBOT_COUNTRY` | `FR` | Code pays du compte (deux lettres) |
| `IROBOT_SCAN_MS` | `120000` | Cadence du balayage réseau qui retrouve un robot (de 15 000 à 3 600 000 ms) |
| `IROBOT_SCAN_TIMEOUT_MS` | `4000` | Durée d'écoute d'un balayage |
| `IROBOT_DISCOVERY_URL`, `IROBOT_APP_ID`, `IROBOT_USER_AGENT` | valeurs du fabricant | À ne changer que si iRobot déplace son API |

## Limites

- Le robot **n'indique pas sa position** et ne donne pas sa carte en local : rien à placer dans la vue 3D au-delà de sa base. Pas de choix de pièces à nettoyer, ni de compteurs d'usure des consommables.
- **Une seule session locale à la fois** : tant que Kasbah tient le lien avec le robot, une autre application qui voudrait lui parler en local sur le même réseau peut être refusée. L'appli iRobot passe normalement par le cloud et n'est pas gênée (cas non vérifié avec l'appli elle-même).
- **Retour base pendant le nettoyage** : Kasbah envoie une pause puis, quelques secondes plus tard, le retour à la base (le robot ignore sinon la commande). Il se passe donc environ 3 à 7 secondes avant qu'il ne bouge.
- Le robot doit être joignable en diffusion UDP (port 5678) sur le réseau du serveur : un réseau invité ou un VLAN séparé l'empêche d'être retrouvé.
- Les codes d'erreur inconnus s'affichent sous la forme « Error N ».
- Testé avec un seul robot (un Roomba Combo) ; plusieurs robots sont prévus mais non éprouvés.

## Pour aller plus loin

Fonctionnement interne, pièges du protocole et mesures : [wiki, iRobot Roomba](../../doc/3_plugins/3_14_irobot-roomba.md).
