# Somfy TaHoma

| | |
|---|---|
| **Id** | `tahoma` |
| **Appareils** | volets roulants, stores, portails, portes de garage, fenêtres (`cover`), et le capteur de luminosité des volets solaires |
| **Connexion** | **locale** : API « mode développeur » de la box (plateforme Overkiz), sur le réseau de la maison |
| **Compte** | aucun compte en ligne : un jeton généré dans l'appli mobile « TaHoma by Somfy » |
| **Vues** | Maison (marqueurs 3D, panneau pièce), Ouvrants, Réglages → Plugins |

![Vue Ouvrants](../screenshots/covers.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Ouvrants** : ouvrir, fermer, arrêter en pleine course ; viser une **position** en pourcentage quand le moteur sait le faire (moteurs io-homecontrol).
- **Position perso** (la touche « my » de Somfy) : la rappeler depuis Kasbah, et sur les volets io la **mémoriser** à nouveau (« Mémoriser cette position »).
- **Mode discret** (volets io compatibles) : les manœuvres lancées depuis Kasbah roulent en vitesse lente, plus silencieuse. C'est un réglage de Kasbah, la télécommande murale garde sa vitesse.
- **Batterie** des volets solaires, et **luminosité** captée par leur panneau, avec un graphique Jour / Mois / Année construit par Kasbah (la box n'en garde pas).
- **Retour d'état** : la box est interrogée toutes les 2 secondes (elle ne pousse rien), donc un volet actionné à la télécommande est vu presque aussitôt.
- Les moteurs **RTS** (radio à sens unique, sans retour) sont pilotables, mais leur position est seulement **supposée** d'après la dernière commande, et signalée comme telle : sans commande passée par Kasbah depuis le démarrage, l'état est « Inconnu ».
- **Placement** : la box ne dit pas dans quelle pièce est un volet. Les ouvrants arrivent « Sans ouverture » : dans la vue **Ouvrants**, **Affecter à** une fenêtre ou une porte de la maison les place dans la scène 3D.

Le reste de la box (capteurs, chauffage, passerelles, lecteurs audio) est ignoré, et les scénarios de la box ne sont pas repris.

## Connexion

Tout passe par le réseau local : le serveur Kasbah parle en HTTPS à la box, sur le port 8443, avec le jeton en en-tête. Aucun appel au cloud Somfy au fonctionnement. Le certificat de la box est signé par une autorité Overkiz et établi pour le nom `gateway-<PIN>.local` : il est accepté pour ce seul client, ce qui permet aussi de joindre la box par son adresse IP.

## Mise en route

Le **mode développeur** ne s'active que depuis l'appli mobile (c'est le cloud Somfy qui le pose sur la box) : ni un site web, ni le réseau local ne le permettent. Tant qu'il n'est pas actif, le port de la box reste fermé.

1. Dans l'appli **TaHoma by Somfy** : « Configurer l'installation », puis « Accéder aux paramètres » de la box. Taper **sept fois** sur le code PIN de la passerelle (de la forme `1234-5678-9012`) pour activer le mode développeur.
2. **Resynchroniser la box** : l'API locale n'est réellement servie qu'après.
3. Menu « Mode développeur » : **générer un jeton** et le copier tout de suite, il n'est affichable qu'à sa création.
4. Dans `apps/server/.env`, renseigner `TAHOMA_HOST` (le nom `gateway-<PIN>.local`, ou l'IP de la box avec un bail DHCP fixe) et `TAHOMA_TOKEN` (le jeton).
5. Cocher **Tahoma** dans **Réglages → Plugins**, puis redémarrer le serveur : `.env` n'est lu qu'au démarrage.

L'état du plugin dans Réglages dit où on en est :

| Message | Signification |
|---|---|
| « Erreur », « no local API on … » | box injoignable, ou mode développeur pas activé / box pas resynchronisée |
| « Appairage requis » | l'API locale répond, mais `TAHOMA_TOKEN` manque |
| « Erreur », « token rejected » | jeton refusé : en générer un nouveau (un jeton peut ne jamais être enregistré par la box) |

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `TAHOMA_HOST` | — (obligatoire) | `gateway-<PIN>.local` ou adresse IP de la box : il n'y a pas de découverte |
| `TAHOMA_PORT` | `8443` | Port de l'API locale |
| `TAHOMA_TOKEN` | — | Jeton généré dans l'appli mobile |
| `TAHOMA_TLS_INSECURE` | `true` | Accepte le certificat de la box, signé par une autorité Overkiz non publique |
| `TAHOMA_POLL_MS` | `2000` | Cadence d'interrogation de la box (500 à 60 000 ms) |
| `TAHOMA_COMMAND_MODE` | `queue` | Envoi de plusieurs commandes à la fois (automatisation, scène) : `queue` les envoie une par une, `batch` les regroupe en une seule exécution, comme un scénario TaHoma |
| `TAHOMA_LIGHT_HISTORY_FILE` | `apps/server/.state/tahoma-light-history.json` | Historique de luminosité des volets solaires ; vide = pas de sauvegarde |
| `TAHOMA_QUIET_FILE` | `apps/server/.state/tahoma-quiet.json` | Volets en mode discret ; vide = pas de sauvegarde |

## Limites

- **Pas de position pendant la course** : la box ne la publie qu'à la fin du mouvement. L'interface montre le sens (« Fermeture en cours ») puis saute à la valeur finale.
- **RTS** : la position supposée devient fausse dès qu'on utilise la télécommande murale. Arrêter ou rappeler la position perso d'un RTS **efface** la position affichée, par honnêteté. La touche de position perso est proposée dès que la box la déclare, même si le moteur n'en a mémorisé aucune ; elle s'enregistre à la télécommande murale.
- Les portails à commande unique « cycle » (sans ouvrir ni fermer distincts) sont ignorés. L'inclinaison des lames existe mais n'a pas été vérifiée sur du matériel.
- La luminosité des volets solaires n'est enregistrée que tant que le serveur tourne : une heure où il était arrêté reste vide. Que la box relaie bien la luminance en local est à confirmer par temps ensoleillé.
- **Mémoriser** une position perso n'a pas été essayé sur une vraie box (essais sur la simulation seulement) : le mode discret, lui, a été vérifié sur un volet réel.

## Pour aller plus loin

Fonctionnement interne, relevés sur la box et pièges : [wiki, Somfy TaHoma](../../doc/3_plugins/3_4_somfy-tahoma.md).
