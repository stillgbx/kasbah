# Mixcloud

| | |
|---|---|
| **Id** | `mixcloud` |
| **Rôle** | source musicale : mix et émissions (DJ sets, radios en rediffusion), souvent longs de une à plusieurs heures |
| **Connexion** | **cloud, partiellement non officielle** : API publique de Mixcloud pour le catalogue, `yt-dlp` pour le flux audio |
| **Compte** | un simple **nom d'utilisateur** Mixcloud, sans mot de passe ni cookie |
| **Vues** | Musique (source « Mixcloud »), Réglages → Plugins |

## Ce que fait le plugin

- **Recherche** de mix, d'émissions et de DJ.
- **Votre compte** : accueil recomposé (vos créateurs suivis, nouveautés des comptes suivis, « Réécouter », plus de vos créateurs préférés, émissions populaires dans vos genres), favoris, écoutés, vos mix, playlists, comptes suivis (ouvrir un compte montre ses mix).
- **Genres** : chaque mix porte ses pastilles de genre, et une rangée de filtres permet de **garder** ou d'**écarter** des genres (choix retenu dans le navigateur).
- **Reprise** : un mix interrompu repart où vous l'avez laissé (« Reprendre à 1:23:45 », ou « Repartir du début »), sur n'importe quelle enceinte ou dans le navigateur. Mixcloud ne retient rien sans connexion au site : c'est Kasbah qui garde la position (au-delà de 60 s, jusqu'aux 90 dernières secondes).
- **Lecture** par le lecteur commun (voir plus bas), avec file d'attente, transfert d'une enceinte à l'autre et lecture dans le navigateur.
- Côté assistant (MCP) : `search_music` avec `source: mixcloud` cherche des mix, `play_music` les lance sur une enceinte.

Le plugin ne publie aucun appareil : il n'apparaît pas dans la maison 3D.

## Le lecteur commun

La lecture est faite par le **lecteur de musique commun** de Kasbah, partagé avec YouTube Music (les radios vont directement de la station à l'enceinte). Mixcloud ne fournit que le catalogue et le flux d'un mix. Le lecteur commun :

- sert le mix **sur le réseau de la maison** à l'enceinte, qui le lit comme un fichier : elle connaît la durée et se laisse déplacer dans un mix de trois heures ;
- tient la **file d'attente côté serveur** et retient la **dernière écoute de chaque enceinte**, reprise après un redémarrage du serveur.

Les **enceintes cibles** sont les lecteurs **Google Cast** et **Sonos**, à activer eux aussi dans Réglages → Plugins. Elles refusent `127.0.0.1` : si vous ouvrez Kasbah en `localhost` sur le poste serveur, renseignez `MUSIC_PUBLISH_BASE` (variable du lecteur commun, voir la page [YouTube Music](ytmusic.md)).

## Connexion

Le catalogue vient de l'**API publique** de Mixcloud, qui ne demande ni clé ni jeton : Kasbah lit seulement ce que votre profil montre publiquement. Relier un compte, c'est donner votre nom d'utilisateur (celui de l'adresse de votre profil : `mixcloud.com/votre-nom/`) ; **aucun mot de passe ne transite, aucun secret n'est stocké**. Le nom et les positions de reprise sont gardés dans `apps/server/.state/mixcloud.json`.

Le flux audio est trouvé par `yt-dlp` sur la page du mix. Pas de PO Token ici, contrairement à YouTube Music.

## Mise en route

1. Installer **`yt-dlp`** sur la machine qui héberge Kasbah. S'il est déjà installé pour YouTube Music, rien d'autre : Mixcloud utilise le même (sinon, `MIXCLOUD_YTDLP_PATH`). `ffmpeg` n'est utile qu'en repli, si un flux ne peut pas être relayé tel quel.
2. Cocher **Mixcloud** dans **Réglages → Plugins**.
3. Tant qu'aucun compte n'est relié, la section Mixcloud (et la source Mixcloud de la page Musique) demande votre **nom d'utilisateur** : le saisir puis **Relier**. Kasbah vérifie qu'il existe chez Mixcloud.
4. Ouvrir la vue **Musique**, choisir la source **Mixcloud**, lancer un mix sur une enceinte.

Changer de compte ou le retirer : **Changer de compte** / **Délier**. Sans compte relié, le plugin reste en attente (« à relier ») et les listes personnelles (accueil, favoris, suivis…) sont indisponibles.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `MIXCLOUD_STATE_FILE` | `.state/mixcloud.json` | Nom d'utilisateur et positions de reprise |
| `MIXCLOUD_YTDLP_PATH` | — (puis `YTM_YTDLP_PATH`, puis `yt-dlp`) | Binaire `yt-dlp` |
| `MIXCLOUD_API_URL` | `https://api.mixcloud.com` | Racine de l'API publique |

## Limites

- Qualité plafonnée à **64 kb/s** (AAC) avec un compte gratuit ; un cookie de compte gratuit n'y change rien, il n'y en a donc pas.
- Les recommandations que Mixcloud calcule chez lui pour un compte connecté n'existent pas : l'accueil est recomposé à partir de vos écoutes publiques (relu toutes les 30 min).
- Aucune écoute n'est signalée à Mixcloud : Kasbah ne fait que lire.
- Le lancement prend quelques secondes (recherche du flux par `yt-dlp`).
- La reprise garde les 200 derniers mix entamés.

## Pour aller plus loin

Fonctionnement interne, routes et pièges : [wiki, Mixcloud](../../doc/3_plugins/3_20_mixcloud.md) ; lecteur commun : [wiki, lecteur musique](../../doc/1_architecture/1_6_lecteur-musique.md).
