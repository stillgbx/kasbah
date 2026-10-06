# Radios

| | |
|---|---|
| **Id** | `radio` |
| **Rôle** | source musicale : webradios en direct, jouées sur vos enceintes |
| **Connexion** | **cloud, publique** : annuaire libre [radio-browser.info](https://www.radio-browser.info) pour trouver les stations ; le flux, lui, va directement de la radio à l'enceinte |
| **Compte** | aucun : ni compte, ni clé, ni cookie |
| **Vues** | Musique (source « Radios »), Réglages → Plugins |

## Ce que fait le plugin

- **Recherche** d'une station par son nom (« franceinfo », « FIP », « Nova »…). L'ordre des mots, les accents et la décoration du nom n'ont pas d'importance.
- **Les plus écoutées** de votre pays (France par défaut).
- **Favorites de la maison** : l'étoile ajoute ou retire une station. La liste est gardée par le serveur, donc **la même sur tous les écrans**, et une favorite se lance même si l'annuaire ne répond pas.
- **Ajout manuel** (« Ajouter une radio ») : pour une station absente de l'annuaire, ou listée avec une adresse morte, coller l'adresse de son flux (`http` ou `https`) et lui donner un nom.
- **Lecture en direct** sur une enceinte, avec le nom de la station, son pays et son logo ; la qualité annoncée (« MP3 192 kb/s ») s'affiche quand l'annuaire la connaît.
- Côté assistant (MCP) : `search_music` avec `source: radio` cherche des stations, `play_radio` en lance une sur une enceinte.

Le plugin ne publie aucun appareil : il n'apparaît pas dans la maison 3D.

## Le lecteur commun

Contrairement à YouTube Music et Mixcloud, la radio **ne passe pas par le serveur** : Kasbah donne seulement à l'enceinte l'adresse du flux, et l'enceinte se connecte elle-même à la radio. Il n'y a donc ni relais, ni `ffmpeg`, ni file d'attente : un direct n'a rien à mettre en file. Le plugin partage en revanche avec la page **Musique** le panneau « Écoute » (une enceinte = une session) et la barre de lecture.

Les **enceintes cibles** sont les lecteurs **Google Cast** et **Sonos**, à activer eux aussi dans Réglages → Plugins. La page [YouTube Music](ytmusic.md) décrit le lecteur commun des sources qui, elles, sont relayées par le serveur.

## Connexion

Deux appels sortent de la maison : la **recherche dans l'annuaire** (par le serveur Kasbah) et le **flux de la radio** (par l'enceinte). Kasbah signale à l'annuaire chaque écoute lancée, comme celui-ci le demande : c'est ce qui classe les stations par popularité pour tout le monde. Les favorites sont stockées dans `apps/server/.state/radio-favorites.json`.

## Mise en route

1. Cocher **Radio** dans **Réglages → Plugins**. Rien d'autre à configurer.
2. Ouvrir la vue **Musique** et choisir la source **Radios**.
3. Chercher une station ou parcourir **Les plus écoutées**, choisir une enceinte dans le panneau « Écoute », lancer.
4. Ajouter l'étoile aux stations habituelles : elles apparaissent dans l'onglet **Favorites**.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `RADIO_BROWSER_URL` | `https://de1.api.radio-browser.info` | Miroir de l'annuaire |
| `RADIO_FAVORITES_FILE` | `.state/radio-favorites.json` | Favorites de la maison |
| `RADIO_COUNTRY` | `FR` | Pays des « plus écoutées » (code à deux lettres) |

## Limites

- **Pas jouable dans « Ce navigateur »** : la page répond « La radio ne se lit pas encore dans ce navigateur » ; choisir une enceinte.
- **Pas de titre en cours d'émission** : l'annuaire ne le donne pas, l'enceinte affiche le nom de la station.
- Une station mal référencée (adresse de flux morte) se contourne par l'ajout manuel ; la corriger dans l'annuaire en profite à tous.
- Le débit affiché est celui annoncé par l'annuaire, pas une mesure ; il est perdu au redémarrage du serveur jusqu'au prochain lancement, et absent pour une station ajoutée à la main.
- La santé passe en « dégradée » si l'annuaire ne répond plus, et revient d'elle-même.

## Pour aller plus loin

Fonctionnement interne, routes et pièges : [wiki, Radios](../../doc/3_plugins/3_19_radio.md).
