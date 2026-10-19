# TouteMonAnnée

| | |
|---|---|
| **Id** | `toutemonannee` |
| **Rôle** | cahier de texte (devoirs), cahier de liaison et publications de la classe, pour les parents comme pour l'élève |
| **Connexion** | **cloud, non officielle** : l'API privée de l'appli web de [toutemonannee.com](https://www.toutemonannee.com), sans API publique |
| **Compte** | votre compte TouteMonAnnée (adresse e-mail ou identifiant + mot de passe), utilisés **une seule fois** ; seuls les cookies de session sont gardés |
| **Vues** | École, Réglages → Plugins |

> **Non officiel.** Le site n'offre aucune connexion déléguée ni API : Kasbah se connecte comme le fait un navigateur. Une évolution du site peut casser la lecture sans préavis.

![Vue École](../screenshots/school.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Devoirs** (cahier de texte) : regroupés par jour à rendre à partir d'aujourd'hui, le prochain jour à rendre mis en avant ; les devoirs passés des derniers jours se déplient. Une case **« fait »** par devoir.
- **Liaison** : les messages de l'enseignante, les plus récents d'abord, avec la mention « Non lu » et le nombre de réponses.
- **Publications** de la classe (annonces, images, documents joints), avec « Nouveau » pour celles que vous n'avez pas encore vues. Les photos s'ouvrent dans Kasbah : on passe de l'une à l'autre, on zoome et on les télécharge.
- **Filtres** par classe (si le compte en a plusieurs) et par niveau (CP, CE1, CE2, CM1, CM2) pour ne voir que ce qui concerne votre enfant ; ce qui ne nomme aucun niveau reste affiché. Les filtres sont gardés par le serveur, donc les mêmes sur tous les écrans.
- **Pastilles** dans la vue : devoirs non faits du prochain jour, messages non lus, publications nouvelles.
- **Relecture automatique** toutes les 30 minutes, ou à la demande (« Mis à jour à HH:MM »).
- Côté assistant (MCP) : l'outil `get_school` lit les devoirs, messages et publications, avec les mêmes filtres que la vue École.

Le plugin ne publie aucun appareil : il n'apparaît pas dans la maison 3D.

## Connexion

TouteMonAnnée ne propose aucune connexion via un tiers : il faut le **mot de passe du compte**. Il ne traverse le serveur Kasbah qu'**une fois**, au moment de relier le compte, et **n'est jamais enregistré**. Le serveur ne garde que les **cookies de session**, dans `apps/server/.state/toutemonannee.json` (droits restreints, hors dépôt, hors `.env`) ; l'un d'eux rouvre seul une session expirée. Ce fichier donne accès à votre compte : le traiter comme un secret.

La lecture est faite par le serveur ; les écrans ne parlent jamais directement au site. Si le site refuse malgré tout la session, la vue affiche un bandeau, **garde la dernière lecture** et le formulaire de liaison réapparaît.

## Mise en route

1. Cocher **Toutemonannee** dans **Réglages → Plugins**. Tant qu'aucun compte n'est relié, le plugin est « Appairage requis ».
2. Dans la section TouteMonAnnée, saisir l'**adresse e-mail ou identifiant** et le **mot de passe** de votre compte, puis **Relier le compte**. La carte affiche « Relié : … ».
3. Ouvrir la vue **École** (lien « Ouvrir la vue École » sur la carte). Les devoirs, messages et publications apparaissent après la première lecture.
4. Si la classe n'est pas la bonne, ou s'il y a plusieurs enfants, régler les filtres de classes et de niveaux en haut de la vue.

**Délier le compte** efface les cookies ; les filtres et les cases « fait » locales sont conservés.

## La case « fait »

- Quand l'enseignante a ouvert la case sur un devoir, c'est **celle du site** : la cocher dans Kasbah la coche sur TouteMonAnnée, et **l'enseignante voit qui l'a cochée**.
- Sinon la case reste **dans Kasbah** seulement (pense-bête du foyer).

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `TMA_FILE` | `.state/toutemonannee.json` | Cookies de session, cases « fait » locales, filtres |
| `TMA_REFRESH_MS` | `1800000` (30 min) | Relecture, 5 minutes au moins |
| `TMA_PAST_DAYS` | `7` | Jours passés relus pour les devoirs (0 à 31) |

## Limites

- Non officiel : dépend de l'appli web du site, qui peut changer.
- **Lecture** surtout : on ne peut pas répondre à l'enseignante, commenter une publication ni marquer un message de liaison comme lu.
- Le niveau (CE1, CE2…) n'est pas une donnée du site : Kasbah le lit dans le texte (« pour les CE1 »). Une mention absente ou inhabituelle n'est pas filtrée.
- Le site ne garde que quelques jours de devoirs passés.
- Cocher la case « fait » du site est la seule écriture que Kasbah fasse chez TouteMonAnnée.

## Pour aller plus loin

Fonctionnement interne, routes relevées et pièges : [wiki, TouteMonAnnée](../../doc/3_plugins/3_23_toutemonannee.md).
