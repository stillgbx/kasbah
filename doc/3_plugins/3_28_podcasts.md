# Plugin Podcasts (annuaires, flux RSS, reprise)

> Dernière mise à jour : 2026-11-06
> Sources : `apps/server/src/plugins/podcasts/{index,api,resolve,store}.ts`, tests `apps/server/src/plugins/podcasts/plugin.test.ts`, `apps/server/src/music/player.ts` (`RAW_MIME`), `apps/server/src/http/rights.ts`, `apps/server/src/plugins/index.ts`, `apps/server/.env.example`, `apps/web/src/components/music/PodcastBrowser.vue`, `apps/web/src/views/MusicView.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/lib/strokeIcons.ts`, arbre de travail non commité du 2026-11-06 (après d0be4fc)

## Ce que c'est

Quatrième source de la page Musique, après YouTube Music, les Radios et Mixcloud : les émissions de
podcast. **Officiel de bout en bout** : l'annuaire d'Apple (et, si on lui donne une clé, Podcast Index)
pour trouver une émission, le flux RSS public de l'émission pour ses épisodes, le fichier MP3 ou M4A
de l'épisode pour le son. Ni compte externe, ni yt-dlp, ni cookie. Comme ytmusic, radio et Mixcloud,
le plugin **ne publie aucun appareil** (`discover` → `[]`, `execute` → `UNSUPPORTED_COMMAND`) : c'est
une **source du lecteur commun** (`../1_architecture/1_6_lecteur-musique.md`), qui relaie le fichier
aux enceintes, tient la file, le transfert et l'écoute locale.

Ce que le plugin ajoute au lecteur : **les abonnements, la reprise de chaque épisode et la liste de ce
qui a été écouté**, par compte.

### Pourquoi les podcasts, et pas Spotify

L'utilisateur voulait Spotify. **Écarté**, après examen : le son est un flux chiffré (DRM) ; l'API
officielle n'est qu'une télécommande de Spotify Connect (Premium requis, et le mode développeur est
limité à 5 utilisateurs depuis février 2026) ; l'API interne du lecteur web donne le catalogue mais
pas le son, et contourner Widevine est exclu. Parmi les services intégrables sans tricherie (podcasts
RSS, SoundCloud, Bandcamp, bibliothèque du NAS…), les podcasts ont été choisis : officiels, gratuits, et
leurs fichiers MP3/M4A **de taille connue** sont exactement le profil du relais brut du lecteur
(même raison que Mixcloud, `3_20_mixcloud.md`, mais sans yt-dlp).

## Trouver une émission : trois voies

1. **Annuaire Apple** (iTunes Search API, sans clé) : `search?media=podcast&entity=podcast&limit=30&country=…`
   et `lookup?id=`. Le pays (`PODCASTS_COUNTRY`, `FR` par défaut) décide du magasin interrogé.
   **Constat du 2026-11-06** : Apple ne renvoie plus `feedUrl` pour des émissions entières. Toutes celles
   de France Inter et de France Culture testées (par `search` comme par `lookup`) en sont privées, alors
   que leurs flux RSS publics existent toujours (`radiofrance-podcast.net/podcast09/rss_<n>.xml`
   répondait 200). Ces entrées sans flux sont **écartées** des résultats : on ne peut pas les lire.
2. **Podcast Index** (facultatif, clé et secret gratuits sur podcastindex.org) : requêtes signées,
   `Authorization = sha1(clé + secret + date unix)` avec `X-Auth-Key`, `X-Auth-Date` et
   `User-Agent: Kasbah/1.0` ; `search/byterm?q=&max=30` et `podcasts/byfeedid?id=`. Il comble le trou
   d'Apple : l'utilisateur a constaté sur le site de Podcast Index que France Culture y figure (les
   descriptions disent « Pour écouter tous les épisodes sans limite, rendez-vous sur Radio France » :
   **les flux Radio France ne gardent que les épisodes récents**). **Non vérifié en réel** : aucune clé
   n'était disponible pendant la session ; seuls des tests à faux `fetch` couvrent la signature, la
   fusion et `byId`.
3. **Ajout par adresse RSS** (`POST /subscriptions/rss { url }`) : pour ce qu'aucun annuaire ne donne.
   Le flux est lu une fois pour vérifier qu'il contient des épisodes audio (et pour nommer l'émission),
   puis l'abonnement est direct. Ajouter deux fois la même adresse ne fait pas de doublon.

**Fusion de la recherche** : Apple d'abord (dans son ordre), puis ce que seul Podcast Index possède. Une
entrée Podcast Index est écartée si son `itunesId` est un résultat Apple **ou** si son flux est déjà
dans les résultats. Une panne de Podcast Index ne fait pas échouer la recherche (avertissement en log,
liste Apple seule).

**Garde-fou de l'adresse** (`isPublicFeedUrl`) : refuse le non-http(s), les noms sans point
(`localhost`, un nom de LAN nu), les suffixes `.local/.lan/.home/.internal/.localhost`, les IPv4
privées, loopback, link-local et CGNAT, les IPv6 loopback, ULA, link-local et « mapped ». **Limite
assumée** : le contrôle porte sur l'adresse **écrite**, pas sur sa résolution DNS ni sur les
redirections ; un flux public qui redirige vers le LAN passerait.

## Identifiants

- **Émission** : Apple = `\d{1,15}` (l'id iTunes) ; Podcast Index = `pi-<id>` ; ajout par adresse =
  `rss-<12 hex de sha1(url)>`.
- **Épisode** : `<émission>:<16 hex de sha1(guid || url du fichier)>`, donc stable tant que le flux garde
  ses guid (le repli sur l'URL du fichier casse si l'hébergeur la change).

Apple et Podcast Index sont **sans état** : une émission se retrouve par `lookup` / `byfeedid`. Une
émission `rss-` n'est connue **que par les abonnements qui la portent** : `episodeOf` charge d'abord le
compte (`accountOf(user)`), ce qui la rend résoluble après un redémarrage (testé). La table `shows` en
mémoire est commune à tous les comptes : une émission `rss-` d'un compte est donc résoluble par un autre
qui en connaîtrait l'identifiant. Choix assumé, sans conséquence (le flux est public, l'id est un hash).

## Routes

Sous `/api/plugins/podcasts/`, droit `media` (`PLUGIN_RIGHTS`, `apps/server/src/http/rights.ts`) :

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/status` | `{ subscriptions, account, lastError }` |
| `GET` | `/search?q=` | recherche d'émissions (2 caractères min.), les deux annuaires fusionnés |
| `GET` | `/subscriptions` | émissions suivies, la dernière abonnée en tête |
| `PUT` / `DELETE` | `/subscriptions/:id` | s'abonner / se désabonner |
| `POST` | `/subscriptions/rss` | s'abonner par adresse de flux (`{ url }`) |
| `GET` | `/shows/:id?offset=` | une émission et ses épisodes, du plus récent au plus ancien, **pages de 50**, `next` = le `offset` suivant (ou `null`) |
| `GET` | `/latest` | « Nouveautés » : les 20 derniers épisodes de chaque abonnement, fusionnés, **60 au plus** ; 4 flux lus à la fois, un flux en échec est sauté |
| `DELETE` | `/resume?id=` | « Repartir du début » : oublie la position **et** le « écouté » |

Les vues **ne rendent ni l'adresse du flux ni celle du fichier** (le navigateur n'en a pas besoin, et ce
sont des adresses d'hébergeur, parfois signées) : une émission porte `subscribed`, un épisode `resumeS`
et `played`. La lecture ne passe pas par ces routes : l'UI envoie `{ source: 'podcasts', id: <épisode> }`
à `/api/music/*`.

## Le flux RSS

`api.ts`, lu avec `fast-xml-parser` (dépendance ^5.12 de `apps/server/package.json`), avec
`parseTagValue: false` (un `guid` numérique reste du texte, sinon son hash change de forme) et `item`
toujours en tableau (un flux d'un seul épisode n'est pas un objet).

- **Épisodes** = les `item` qui ont un `enclosure` audio (type `audio/*`, ou à défaut une extension
  connue), triés du plus récent au plus ancien ; `itunes:duration` lue en secondes, `MM:SS` ou
  `HH:MM:SS` ; image de l'épisode, sinon celle du flux ; auteur = `itunes:author`.
- **Bornes** : flux > 20 Mo refusé, délai de 20 s.
- **Cache de 30 min par émission**, partagé entre comptes (un flux est public), requêtes simultanées
  dédoublonnées. Un épisode absent d'un flux en cache déclenche **une relecture forcée** avant d'être
  déclaré disparu (`this episode is no longer in the podcast feed`).

## La lecture : résolution et relais

`resolve.ts` : l'adresse du fichier passe presque toujours par un **préfixe de mesure d'audience** (une
ou plusieurs redirections). Un `HEAD` avec suivi des redirections donne l'**URL finale** (`res.url`), que
l'enceinte (via le relais) contacte directement, plus `content-length` et `accept-ranges: bytes`. Si le
`HEAD` est refusé ou muet, un `GET` avec `Range: bytes=0-0` donne la taille par `content-range`. Extension
par le type MIME, sinon par le chemin de l'URL ; débit estimé = taille × 8 / durée. **Sans taille ni
plages**, le lecteur commun retombe sur son repli MP3 (ffmpeg), sans déplacement possible dans le fichier.

Avec une taille, le lecteur relaie le fichier brut. Pour cela `RAW_MIME` (`music/player.ts`) a gagné
`mp3: 'audio/mpeg'` : voir la mise à jour du 2026-11-06 de `1_6_lecteur-musique.md`.

**Un épisode se lance seul** : pas de file avec les suivants. Choix délibéré, un podcast n'est pas un
album ; l'utilisateur enchaîne lui-même.

## Comptes, reprise, « écouté »

`store.ts` : un état `{ subscriptions, resume, played }` **par compte**, `PODCASTS_STATE_FILE`
(`.state/podcasts.json`) pour la maison, `users/<nom>/podcasts.json` pour un utilisateur connecté (même
logique que Mixcloud, `3_20_mixcloud.md`, mise à jour du 2026-10-07 ; voir `../1_architecture/1_13_comptes-et-sessions.md`).
**Pas de compte externe, pas d'anonyme** : sans compte relié il n'y a rien à relier, un utilisateur sans
abonnement a simplement un état vide.

- **Reprise** : mêmes règles que Mixcloud — `noteProgress` et `resumePoint` sont **importées** de
  `plugins/mixcloud/store.ts`, pas recopiées (rien en deçà de 60 s, oubli dans les 90 dernières
  secondes). Alimentée par `onProgress` du lecteur commun.
- **« Écouté »** : posé quand la position est oubliée par fin naturelle ou dans les 90 dernières secondes,
  **et seulement au-delà de la moitié de l'épisode** — sans cette garde, un épisode de 100 s serait
  « écouté » à 15 s (l'oubli des 90 dernières secondes le couvrirait presque en entier). 5 000 épisodes
  écoutés gardés au plus (`PLAYED_MAX`), les plus anciens partent.
- **Repartir du début** (`DELETE /resume`) oublie la position **et** l'état écouté.
- **Écriture** : au plus toutes les 15 s (une progression arrive à chaque relevé), tout de suite sur fin,
  oubli, abonnement ou désabonnement.

## Santé

`ok` : « Podcasts: N subscriptions, Apple + Podcast Index » ou « …, Apple directory only (no Podcast
Index key) » ; `degraded` avec la dernière erreur d'un appel extérieur. `healthFor(user)` rend le compte de
l'utilisateur (contrat dans `../1_architecture/1_2_serveur-et-plugins.md`), `health()` celui de la maison.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PODCASTS_STATE_FILE` | `.state/podcasts.json` | Abonnements, reprises, écoutés de la maison |
| `PODCASTS_COUNTRY` | `FR` | Magasin de l'annuaire Apple (deux lettres) |
| `PODCASTS_DIRECTORY_URL` | `https://itunes.apple.com` | Racine de l'annuaire |
| `PODCASTINDEX_KEY` / `PODCASTINDEX_SECRET` | *(vides)* | Active Podcast Index (les deux ensemble) |
| `PODCASTINDEX_URL` | `https://api.podcastindex.org` | Racine de Podcast Index |

Détail dans `../5_setup/5_1_configuration-env.md`, mise à jour du 2026-11-06.

## Côté web

Source « Podcasts » (icône `sourcePodcasts`) de la page Musique, visible si le plugin est actif :
`components/music/PodcastBrowser.vue`. Recherche, onglets **Nouveautés** / **Abonnements** (grisés
pendant une recherche), page d'une émission avec Retour et bouton S'abonner / Abonné, épisodes avec
« Reprendre à… » ou « Écouté », date, et le nom de l'émission dans Nouveautés ; « Épisodes plus anciens »
pour la page suivante. Détail et pièges de mise en page : `../4_ui/4_5_musique-et-medias.md`, section
du 2026-11-06. Mock : les méthodes `podcasts*` lèvent `501`.

## Vérifié

- **Tests** : `plugin.test.ts`, 13 tests (flux et durées, entrées sans flux écartées, signature Podcast
  Index, fusion sans doublon, adresses refusées, résolution avec redirection et sans taille, reprise
  puis « écouté », routes par compte, ajout par adresse relu après redémarrage, cache de 30 min, lecture
  par le lecteur commun). Suite complète du jour : 2 736 tests verts, typecheck et lint verts.
- **En réel**, sur un serveur jetable (copie de la maison de démo, plugins mock + podcasts, état dans un
  dossier temporaire) : vraie recherche Apple (« jardinage » : 6 émissions avec flux) ; ajout par adresse
  d'un flux Radio France réel → 50 épisodes et `next` ; « Nouveautés » → 20 ; lecture dans le
  navigateur : relais **brut m4a, 44 Mo, ~194 kb/s**, réponses 206 par plages, lecture qui avance.
- **Écran** : rien ne bouge entre les onglets ni au bouton S'abonner (`getBoundingClientRect`), aucun
  débordement à 1 280 et 375 px, fr et en, thèmes clair et sombre.
- **Non vérifié** : Podcast Index réel (pas de clé), lecture sur une vraie enceinte Cast ou Sonos,
  zooms 1,25 et 1,5, lumières en rythme sur un podcast.

## Limites

- Apple ne donne plus le flux de nombreuses émissions (Radio France) : sans clé Podcast Index, elles ne
  se trouvent que par leur adresse RSS ; et ces flux ne gardent que les épisodes récents.
- L'adresse RSS n'est contrôlée ni après DNS ni après redirection (voir plus haut).
- **Pas dans le MCP** : `search_music` ne connaît toujours que ytmusic, Mixcloud et radio.
- Pas de notification de nouveaux épisodes : « Nouveautés » se calcule à l'ouverture (cache de 30 min).

## Pièges

- **`PLUGIN_RIGHTS`** : tout plugin qui sert des routes doit entrer dans `apps/server/src/http/rights.ts`
  (ici `podcasts: { right: 'media' }`), sinon `rights.test.ts` et `test/integration.test.ts` échouent
  (« knows every plugin that serves routes »).
- **Activer un plugin en preview** : `kasbah-demo-server` refuse toute modification de la maison de
  démo (`DEMO_READONLY`). Il a fallu un serveur jetable sur une **copie** de maison (`KASBAH_HOUSE_FILE`
  et `KASBAH_STATE_DIR` en dossier temporaire, entrée temporaire de `.claude/launch.json` retirée
  ensuite). Voir aussi `../6_faq/6_0_pieges-outillage.md`.
- **Un guid numérique** : sans `parseTagValue: false`, le parseur le lit comme un nombre et l'identifiant
  d'épisode change selon le flux.
