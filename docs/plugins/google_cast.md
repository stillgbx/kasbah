# Google Cast

| | |
|---|---|
| **Id** | `google_cast` |
| **Appareils** | enceintes et réveils Google, Nest Mini / Hub, Chromecast, Google TV, TV Android, barres de son « Chromecast built-in » (`media_player`) |
| **Connexion** | **locale** : protocole Cast v2 (une connexion TLS par appareil), découverte automatique par mDNS |
| **Compte** | aucun compte, aucun jeton |
| **Vues** | Médias, Musique (comme enceinte de lecture), Maison (marqueur et onde sonore), Réglages → Plugins |

![Vue Médias](../screenshots/media.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Ce qui joue** : titre, artiste, pochette, appli source, volume et sourdine, quelle que soit l'origine de la lecture (téléphone, voix, Kasbah). L'appareil pousse lui-même ces informations, elles s'affichent aussitôt.
- **Télécommande** : lecture / pause, piste précédente / suivante, position dans le morceau, volume, sourdine, et **arrêt** (qui ferme l'appli ouverte sur l'appareil).
- **Lire une URL** (MP3, flux radio, HLS) : champ « Lire une URL » de la vue Médias, et c'est ainsi que les plugins de musique (radios, YouTube Music, Mixcloud) lancent un morceau sur l'appareil.
- **Type d'appareil reconnu tout seul** : enceinte, téléviseur ou écran connecté, d'après ce qu'il annonce. Un Chromecast branché sur une TV a un volume **fixe** : pas de curseur de volume, il se règle sur la TV.
- **Applis muettes** (Netflix natif, par exemple) : l'appareil n'envoie ni titre ni commande. Kasbah affiche « À l'écran · Netflix » avec le logo de l'appli, sans pilotage possible, sauf l'arrêt.
- **Appareil éteint** : un Cast éteint ne s'annonce plus, Kasbah le garde donc dans la liste, indisponible, et le retrouve dès qu'il se rallume. **Oublier l'appareil** l'en retire pour de bon.
- **Enrichissements** (voir plus bas) : épisodes Crunchyroll, pochettes manquantes, sortie du son d'une TV Sony.

## Connexion

Tout est local. Le serveur Kasbah cherche les appareils par mDNS (`_googlecast._tcp`), ouvre une connexion chiffrée vers chacun (port 8009) et la garde ouverte. Rien ne passe par le cloud Google, et le protocole ne connaît aucun compte : la file ou l'historique du compte Google restent dans l'appli Google Home, hors de portée de Kasbah. Les pochettes sont relayées par le serveur, pour que les écrans n'aillent pas les chercher eux-mêmes.

## Mise en route

1. Cocher **Google Cast** dans **Réglages → Plugins**. Les appareils trouvés arrivent dans la bande « Hors maison » ; les placer dans les pièces depuis leur panneau.
2. Si la **simulation** est aussi active, décocher « Lecteur » dans ses sous-items : sinon les lecteurs simulés doublent les vrais.
3. Le serveur et les appareils doivent être sur le **même réseau local** (le mDNS ne traverse pas un routeur). Si la liste reste vide sur une machine à plusieurs cartes réseau (VPN, machines virtuelles), donner à `CAST_MDNS_INTERFACE` l'adresse IPv4 de la carte qui est sur le réseau des appareils, puis redémarrer le serveur.

Option, **TV Sony et barre de son** : une TV en HDMI ARC fait sortir le son par la barre, que le protocole Cast voit « au repos ». Pour que l'onde sonore se pose sur la barre, déclarer le lien dans le fichier de la maison (`meta.audioOutput` de l'appareil TV, avec l'identifiant de la barre) ; c'est la TV qui dit où part son son.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `CAST_MDNS_INTERFACE` | — | IPv4 de la carte réseau qui porte le multicast, si la machine en a plusieurs |
| `CAST_DISCOVERY_WAIT_MS` | `3000` | Temps laissé aux appareils pour répondre à la première question (0,5 à 15 s) |
| `CAST_MDNS_REFRESH_MS` | `60000` | Cadence des questions suivantes : appareils rallumés, annonces perdues (10 s à 10 min) |
| `CAST_KNOWN_FILE` | `apps/server/.state/google-cast-devices.json` | Mémoire des appareils déjà vus ; vide = un appareil éteint disparaît de la liste |
| `CAST_CRUNCHYROLL_ENRICH` | `true` | Complète série, saison, épisode et affiche des lectures Crunchyroll (non officiel) |
| `CAST_COVER_LOOKUP` | `true` | Cherche la pochette d'un morceau nommé sans image (iTunes puis Deezer) |
| `CAST_BRAVIA_PROBE` | `true` | Demande à une TV Sony où part son son (API locale de la TV) |

Les trois dernières peuvent se passer à `false` : l'affichage reste alors celui que donne l'appareil.

## Limites

- **Pas de compte Google** : on ne peut pas lancer depuis Kasbah une playlist YouTube Music « du compte ». Les plugins de musique de Kasbah envoient à la place une adresse de flux que l'appareil va chercher lui-même.
- **Enrichissements non officiels** : Crunchyroll (service interrogé sans compte) et le catalogue iTunes / Deezer peuvent cesser de répondre sans préavis ; Kasbah revient alors à ce que dit l'appareil. La pochette trouvée est celle de l'**album**, pas la vignette de la vidéo.
- **Arrêter ferme l'appli** de l'appareil. Lancer ensuite un flux sur une TV lente à démarrer peut échouer au premier essai (délai de 5 secondes dépassé) : le second passe.
- **Groupes d'enceintes** non gérés ; une TV Android en veille profonde ne s'annonce pas et reste invisible.
- Une appli qui n'ouvre aucun canal média (Netflix, Prime Video natifs) ne donne ni titre ni position : rien à piloter, rien à afficher de plus.

## Pour aller plus loin

Fonctionnement interne, relevés sur le réseau et pièges : [wiki, Google Cast](../../doc/3_plugins/3_6_google-cast.md).
