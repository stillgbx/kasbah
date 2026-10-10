# Sonos

| | |
|---|---|
| **Id** | `sonos` |
| **Appareils** | enceintes Sonos (Play:3, Port, etc.), une par enceinte physique (`media_player`) |
| **Connexion** | **locale** : UPnP / SOAP sur le port 1400 de chaque enceinte, découverte automatique par SSDP |
| **Compte** | aucun compte, aucun jeton |
| **Vues** | Médias, Musique (comme enceinte de lecture), Maison (marqueur et onde sonore), Réglages → Plugins |

![Vue Médias](../screenshots/media.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Ce qui joue** : titre, artiste, pochette, volume, sourdine et état de lecture, relus toutes les 2 secondes (quelle que soit l'origine de la lecture : appli Sonos, téléphone, Kasbah).
- **Télécommande** : lecture / pause, arrêt, piste précédente / suivante (« précédent » ramène au début du morceau passé 3 secondes), position dans le morceau, volume, sourdine.
- **Lire une URL** (MP3, flux radio, HLS) : champ « Lire une URL » de la vue Médias, et c'est ainsi que les plugins de musique (radios, YouTube Music, Mixcloud) lancent un morceau sur l'enceinte. L'enceinte va chercher le flux elle-même : Kasbah ne fait pas transiter l'audio.
- **Groupes** : une enceinte groupée reste un lecteur à part dans Kasbah ; son volume est le sien, mais lecture, pause et pistes sont envoyées au chef du groupe.
- **Enceinte éteinte** : elle ne répond plus à la découverte, Kasbah la garde donc dans la liste, indisponible, et la retrouve quand elle se rallume. **Oublier l'appareil** l'en retire pour de bon.
- Les pochettes sont relayées par le serveur, pour que les écrans n'aillent pas les chercher eux-mêmes.

## Connexion

Tout est local. Le serveur Kasbah cherche les enceintes par SSDP (diffusion sur le réseau, UDP 1900), puis leur parle en SOAP sur le port 1400, sans authentification. Rien ne passe par le cloud Sonos, et il n'y a ni compte, ni quota, ni carte de liaison dans Réglages.

## Mise en route

1. Cocher **Sonos** dans **Réglages → Plugins**. Les enceintes trouvées arrivent dans la bande « Hors maison » ; les placer dans les pièces depuis leur panneau.
2. Si la **simulation** est aussi active, décocher « Lecteur » dans ses sous-items : sinon les lecteurs simulés doublent les vrais.
3. Le serveur et les enceintes doivent être sur le **même réseau local**. Si la liste reste vide sur une machine à plusieurs cartes réseau (VPN, machines virtuelles, adresse en `169.254`), donner à `SONOS_SSDP_INTERFACE` l'adresse IPv4 de la carte qui est sur le réseau des enceintes, puis redémarrer le serveur.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `SONOS_SSDP_INTERFACE` | — | IPv4 de la carte réseau du LAN, si la machine en a plusieurs |
| `SONOS_SSDP_REFRESH_MS` | `60000` | Cadence des recherches suivantes : enceintes rallumées (10 s à 10 min) |
| `SONOS_POLL_MS` | `2000` | Relecture du volume et de la lecture (0,5 à 30 s) |
| `SONOS_REQUEST_TIMEOUT_MS` | `5000` | Délai maximal d'une requête vers une enceinte (0,5 à 15 s) |
| `SONOS_KNOWN_FILE` | `apps/server/.state/sonos-devices.json` | Mémoire des enceintes déjà vues ; vide = une enceinte éteinte disparaît de la liste |

## Limites

- **Pas de lancement de Spotify ni d'une file** depuis Kasbah : ces services sont liés dans l'appli Sonos, pas à une URL. Kasbah lit ce qui joue et lance des flux par adresse.
- **Pas de vue des groupes** et pas de WebSocket Sonos (il demande une clé d'API cloud) : les changements sont vus par sondage, avec jusqu'à 2 secondes de délai.
- **Pause d'un direct** : une radio en direct ne se met pas en pause, la pause devient un arrêt.
- Sur une enceinte au repos, sans file, pause et « suivant » sont refusés : l'interface grise ces touches.

## Pour aller plus loin

Fonctionnement interne, relevés sur le réseau et pièges : [wiki, Sonos](../../doc/3_plugins/3_15_sonos.md).
