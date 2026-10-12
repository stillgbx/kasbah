# YouTube Music (non officiel)

| | |
|---|---|
| **Id** | `ytmusic` |
| **Rôle** | source musicale : catalogue, bibliothèque et playlists de votre compte YouTube Music, jouées sur vos enceintes |
| **Connexion** | **cloud, non officielle** : API interne du site YouTube Music, flux audio extrait par `yt-dlp` |
| **Compte** | votre compte Google / YouTube Music, relié par un **cookie** de navigateur (pas d'identifiant ni de mot de passe) |
| **Vues** | Musique, Réglages → Plugins |

![Vue Musique](../screenshots/music.webp)

*Capture de la démonstration : genres, titres et pochettes inventés, la démo n'ayant pas de compte YouTube Music.*

> **Non officiel.** Google ne propose pas d'API pour ça : Kasbah se fait passer pour le site web de YouTube Music. À réserver à un usage perso à la maison. Google peut casser le chemin sans préavis ; le plugin passe alors en erreur dans Réglages plutôt que de faire semblant.

## Ce que fait le plugin

- **Recherche** de titres, albums, singles / EP, compilations et artistes, avec les mentions *explicit* (et un interrupteur pour les masquer).
- **Bibliothèque** : récents, titres aimés (« Likes »), playlists, nouveautés, humeurs et genres ; pages d'album et d'artiste.
- **Lecture sur les enceintes** de la maison (voir plus bas), avec **file d'attente** (« Tout lire » sur un album ou une playlist, « Lire ensuite », répétition du titre), pause, curseur de position et **transfert** d'une enceinte à l'autre sans perdre la position.
- **Lecture dans le navigateur** : l'appareil qui affiche la page peut jouer lui-même (« Ce navigateur »).
- Côté assistant (MCP) : l'outil `search_music` cherche dans YouTube Music, `play_music` lance les résultats sur une enceinte.

Le plugin ne publie aucun appareil : il n'apparaît pas dans la maison 3D.

## Le lecteur commun

La lecture n'est pas faite par le plugin lui-même mais par le **lecteur de musique commun** de Kasbah, partagé avec Mixcloud (les radios, elles, vont directement de la station à l'enceinte). Le plugin ne fournit que le catalogue et le flux d'un titre ; le lecteur commun se charge du reste :

- il sert le flux **sur le réseau de la maison** à l'enceinte cible, qui le lit comme un fichier (elle connaît donc la durée et se laisse déplacer dans le morceau) ;
- il tient la **file d'attente côté serveur** : l'écran peut s'éteindre, le titre suivant démarre quand même ;
- il garde la **dernière écoute de chaque enceinte** et la reprend après un redémarrage du serveur.

Les **enceintes cibles** sont les lecteurs **Google Cast** (Chromecast, enceintes et téléviseurs compatibles Cast) et **Sonos**, qui doivent donc être activés eux aussi dans Réglages → Plugins. Elles refusent `127.0.0.1` : si vous ouvrez Kasbah en `localhost` sur le poste serveur, renseignez `MUSIC_PUBLISH_BASE` (voir plus bas).

## Connexion

Le serveur Kasbah interroge YouTube Music avec votre cookie, puis lance `yt-dlp` pour trouver le flux audio de chaque titre. `yt-dlp` a besoin d'un **PO Token**, une preuve que YouTube exige de plus en plus : un petit service local (« générateur PO Token », port 4416) le fabrique. Rien d'autre ne quitte la maison.

Le cookie est stocké dans `apps/server/.state/ytmusic-cookie.txt`, **jamais** dans `.env`. Un compte **Premium** est attendu pour un vrai catalogue (un compte famille convient). Quand le cookie expire, la carte de Réglages le dit : refaire la même procédure.

## Mise en route

1. **Installer les outils**, sur la machine qui héberge Kasbah (pas sur les écrans) :
   - `yt-dlp` (dans le `PATH`, ou son chemin dans `YTM_YTDLP_PATH`) et son module `bgutil-ytdlp-pot-provider` (sans lui, l'option PO Token est ignorée sans erreur) ;
   - `ffmpeg` (repli de transcodage du lecteur commun ; chemin dans `FFMPEG_PATH` s'il n'est pas dans le `PATH`) ;
   - **Node** dans le `PATH` : `yt-dlp` s'en sert pour résoudre les défis de YouTube.
2. **Lancer le générateur PO Token** sur le port 4416 (Docker : `docker run -d --init -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider`, ou Node natif). `npm run dev` le démarre seul s'il est installé dans `_external/`. Tant qu'il ne répond pas, la santé du plugin reste « dégradée ».
3. Cocher **Ytmusic** dans **Réglages → Plugins**.
4. Se connecter à **music.youtube.com** dans un navigateur **sur la machine Kasbah**, puis **ne pas se déconnecter** (fermer seulement la fenêtre).
5. Dans la section YouTube Music de Réglages → Plugins, relier le cookie de l'une des deux façons :
   - **Coller le cookie** (le plus fiable, surtout sous Windows) : F12 → onglet Réseau → recharger → cliquer une requête vers `music.youtube.com` → En-têtes de requête → **Cookie** → copier toute la valeur (elle doit contenir `__Secure-3PAPISID`) → **Enregistrer le cookie**. Une fenêtre privée convient.
   - **Importer depuis un navigateur du serveur** : profil **normal** (pas privé), navigateur complètement fermé, puis choisir le navigateur et **Importer depuis le navigateur**. Sous Windows, Chrome et Edge échouent souvent (chiffrement) : préférer Firefox ou le collage.
6. La carte affiche « Cookie enregistré » et l'état du générateur PO Token. Ouvrir la vue **Musique**, choisir une enceinte dans le panneau « Écoute », lancer un titre.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `YTM_COOKIE_FILE` | `.state/ytmusic-cookie.txt` | Fichier du cookie (vide : cookie perdu au redémarrage) |
| `YTM_PO_TOKEN_URL` | `http://127.0.0.1:4416` | Adresse du générateur PO Token |
| `YTM_YTDLP_PATH` | `yt-dlp` | Binaire `yt-dlp` (Mixcloud s'en sert aussi par défaut) |
| `MUSIC_PUBLISH_BASE` | — (déduite du navigateur) | Adresse du serveur donnée aux enceintes, ex. `http://192.168.1.10:8787` ; obligatoire si l'interface est ouverte en `localhost` |
| `FFMPEG_PATH` | `ffmpeg` | Binaire `ffmpeg` du lecteur commun |

`MUSIC_PUBLISH_BASE` et `FFMPEG_PATH` sont lues par le lecteur commun, pas par le plugin ; l'ancien nom `YTM_PUBLISH_BASE` est encore accepté.

## Limites

- Non officiel : une mise à jour de YouTube ou de `yt-dlp` peut tout casser, temporairement.
- Le titre suivant démarre avec environ 2,5 s de silence : pas de lecture sans coupure (*gapless*).
- Pas de mix / radio YouTube, de podcasts, ni de synchronisation multi-pièces.
- Une lecture lancée depuis l'appli Cast ou Sonos elle-même n'est pas à Kasbah : elle ne se transfère pas.
- Vider le cookie n'interrompt pas le titre en cours, seulement les suivants.

## Pour aller plus loin

Fonctionnement interne, routes et pièges : [wiki, YouTube Music](../../doc/3_plugins/3_16_ytmusic.md) ; lecteur commun : [wiki, lecteur musique](../../doc/1_architecture/1_6_lecteur-musique.md).
