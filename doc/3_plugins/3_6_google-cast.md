# Plugin Google Cast (enceintes, réveils, Chromecast, barres de son)

> Dernière mise à jour : 2026-10-12
> Sources : `apps/server/src/plugins/google_cast/{index,channel,discovery,mapping,protocol,types}.ts`, `apps/server/src/plugins/google_cast/__fixtures__/network.ts`, tests `protocol.test.ts`, `mapping.test.ts` et `plugin.test.ts`, `apps/server/.env.example`, `apps/web/src/views/MediaView.vue`, demande de l'utilisateur du 2026-09-09, `apps/server/src/plugins/google_cast/known.ts`, `apps/server/src/plugins/google_cast/enrich/cover.ts`, `tools/cast-probe.mts`, `apps/server/src/plugins/google_cast/bravia.ts`, `apps/server/src/plugins/google_cast/__fixtures__/bravia.ts`

## Ce que l'utilisateur veut, et ce que le protocole permet

Demande : intégrer les enceintes et réveils Google du réseau, les Chromecast, les TV Android et
tout ce qui porte « Chromecast built-in », pour à terme **envoyer une musique ou une vidéo** — par
exemple lire une playlist du compte Google (YouTube, YouTube Music).

Tous ces appareils parlent le même protocole **Cast v2**, local, sans compte ni secret. Ce qu'il
sait faire est net, et ce qu'il ne sait pas faire aussi :

| Besoin | Cast local | Remarque |
|---|---|---|
| Voir ce qui joue (titre, artiste, pochette, appli source), volume, muet | Oui | Poussé par l'appareil dès qu'on est connecté, quelle que soit l'origine de la lecture (téléphone, voix). |
| Lire / pause / suivant / précédent / volume / muet | Oui | Sur la session média de l'appli en cours. |
| Lire un média par URL (MP3, MP4, HLS, radio) | Oui | Récepteur média par défaut (`CC1AD845`) — **étape 2, faite** (`media_player.play_url`). |
| Lancer un titre / une playlist YouTube Music avec le compte | **Non** | Le protocole n'a pas de notion de compte ; le compte lié aux enceintes vit dans l'appli Google Home. Aucune API publique. |
| Ouvrir une vidéo YouTube sur une Android TV | Oui, autre protocole | « Android TV Remote » v2 (appairage PIN, lien profond) — **étape 3**. |
| Ouvrir une vidéo YouTube sur un Chromecast / Nest Hub | Fragile | API « Lounge » YouTube non documentée (celle de pychromecast / Home Assistant) — **étape 4**, à marquer non officiel. |

Découpage retenu avec l'utilisateur : (1) plugin local, état et télécommande, vue Médias — **fait** ;
(2) lecture par URL — **fait** ; (3) Android TV ; (4) YouTube sur Chromecast en dernier.

## Relevé du réseau réel (2026-09-09)

Un script mDNS + Cast hors projet a trouvé des appareils de plusieurs familles, tous sur le même
sous-réseau, port 8009 : des réveils **Lenovo CD-4N341Y** (audio seul), des **Google Nest Hub** (écran),
un **Nest Mini**, des **Chromecast** branchés sur des TV, une barre de son **Flexus Core 300**. Aucun groupe
d'enceintes annoncé, aucune Android TV (peut-être hors tension). Rien ne jouait.

Constats gardés dans les fixtures (`__fixtures__/network.ts`, identifiants anonymisés) :
- l'enregistrement TXT porte `id` (32 hex, **stable** → notre `externalId`), `fn` (nom Google Home),
  `md` (modèle), `ca` (masque : bit 0 = écran, bit 2 = audio) ; `rs` est **toujours vide** ;
- un Nest Hub au repos déclare l'appli **Backdrop** (fond d'écran) avec `isIdleScreen: true` : ce
  n'est pas une lecture ;
- les Chromecast sur TV répondent `controlType: fixed`, `level: 1.00` : le volume se règle sur la
  TV, toute commande de volume est sans effet ;
- `stepInterval` est un flottant approximatif (`0.019999…`) : ne pas s'en servir.

La fixture `MEDIA_STATUS_*` est **déduite** de la référence Cast (aucune lecture en cours au relevé) :
à remplacer par une capture de `GET /api/plugins/google_cast/raw` dès qu'un appareil joue.

## Architecture du plugin (`apps/server/src/plugins/google_cast/`)

- `protocol.ts` — **trame Cast v2 encodée à la main** : un entier 32 bits big-endian (longueur) puis
  un protobuf `CastMessage` à six champs (version, source, destination, namespace, type de charge,
  charge JSON). Pas de dépendance protobuf : encodeur / décodeur en moins de cent lignes, champs
  inconnus sautés, charge binaire ignorée. `FrameDecoder` recolle les trames coupées par TCP.
- `discovery.ts` — mDNS `_googlecast._tcp` via `bonjour-service` (seule dépendance ajoutée) ; IPv4
  préférée (les Nest Hub annoncent aussi des IPv6). Option `interface` transmise à multicast-dns
  par transtypage : le typage de la bibliothèque ne la connaît pas, la bibliothèque si.
- `channel.ts` — `CastConnection`, **une socket TLS par appareil** (`rejectUnauthorized: false` :
  certificat propre à chaque appareil), `CONNECT` au récepteur, PING/PONG toutes les 5 s (trois
  battements sans nouvelle → fermeture), réponse aux PING du récepteur. Deux canaux : `receiver`
  (volume, appli en cours, **poussé** par l'appareil) et `media` (à ouvrir vers le `transportId` de
  l'appli qui tourne, qui pousse alors ses `MEDIA_STATUS`). Une requête porte un `requestId`, la
  réponse le reprend : c'est l'**accusé** qu'attend `execute`. Une réponse d'un autre type
  (`INVALID_REQUEST`, `LOAD_FAILED`…) devient `UNSUPPORTED_COMMAND`. Pendant une lecture, la
  position est relue toutes les 10 s (le récepteur ne la pousse pas seul).
- `mapping.ts` — pur : TXT → descripteur (`volume` et `mute` retirés si `fixed`), `RECEIVER_STATUS`
  → volume / muet, appli active (hors écran de veille), `MEDIA_STATUS` → `playback` et
  `nowPlaying` (**`null` pour effacer** le morceau quand plus rien ne joue).
- `index.ts` — cycle de vie : `discover` écoute le mDNS `CAST_DISCOVERY_WAIT_MS` puis connecte
  chaque appareil pour connaître son type de volume avant de rendre les descripteurs ; un appareil
  injoignable est listé quand même (indisponible, retenté 5 s, 10 s… 2 min). Appareil annoncé plus
  tard → `emitDevices` et connexion. Coupure → `setAvailable(false)` + reconnexion. `health` :
  `degraded` sans appareil ou sans connexion, sinon `N device(s), M connected[, P playing]`. Route
  `GET /api/plugins/google_cast/raw` : dernier état brut de chaque appareil (fixtures).

Piège rencontré (voir `../6_faq/6_1_pieges-runtime.md`) : un état émis **pendant `discover`** est
perdu, les appareils n'étant pas encore enregistrés. Le plugin ne publie qu'à partir de `start`, où
il pousse l'état courant de chaque connexion d'un bloc.

Ce qui n'est pas fait : les groupes d'enceintes (apparaîtraient comme des appareils à part),
les Android TV en veille profonde qui ne s'annoncent pas. `media_player.stop` et la lecture par
URL (`play_url`) sont faits — voir les sections datées.

## Côté web

Vue **Médias** (`MediaView.vue`, 5e entrée du rail, icône `speaker`) sur `RoomBands` kind
`media_player`, comme Lumières / Ouvrants / Caméras : touches précédent / lire-pause / suivant
(grisées quand rien n'est chargé, le plugin refuserait), sourdine (allumée quand muet), curseur de
volume avec valeur locale pendant le glissement. Les touches suivent les **capacités** : pas de
curseur ni de sourdine sur un Chromecast à volume fixe. Le statut de la ligne (« Lecture · titre »,
« Au repos ») vient de `lib/deviceState.ts`. Clés i18n `media.*` (summary, none, playing, paused,
idle, off, nothing, play, next, previous, mute, unmute, volume) ajoutées en fr et en : `media.playing`
& co étaient référencées par `deviceState.ts` et `MediaPlayerControl.vue` **sans exister**.

## Mise en route

`KASBAH_PLUGINS=…,google_cast` et `MOCK_EXCLUDE_KINDS=…,media_player` (sinon les lecteurs simulés
doublent les vrais).
*(Dépassé le 2026-09-11 : `KASBAH_PLUGINS` et `MOCK_EXCLUDE_KINDS` n'existent plus comme réglages. On coche « Google Cast » dans Réglages → Plugins, et on décoche « Lecteur » (kind `media_player`) dans les sous-items du plugin Mock, libellé de `kinds.media_player` dans `apps/web/src/i18n/locales/fr.json` — voir `3_0_simulation-mock.md`, « `MOCK_EXCLUDE_KINDS` devient des sous-items cochables ».)* Sur une machine à plusieurs cartes réseau (VPN, VM), `CAST_MDNS_INTERFACE` =
IPv4 de la carte sur le LAN des appareils, sinon la question mDNS part sur la mauvaise carte et la
liste reste vide. Variables : `../5_setup/5_1_configuration-env.md`. Les appareils arrivent en
« Hors maison » : à placer dans les pièces depuis l'UI.

Vérifié le 2026-09-09 sur le serveur de développement : tous les appareils connectés, volumes et
sourdine conformes ; `set_volume` acquitté par un réveil (HTTP 200), `play` refusé
(`UNSUPPORTED_COMMAND`, rien ne joue).

### Mise à jour 2026-09-09 — téléviseur, écran connecté ou enceinte : `mediaPlayerClass`

Question de l'utilisateur : des Chromecast sont branchés sur
une TV, peut-on le détecter plutôt que de le déclarer dans `house.json` ? Oui, l'annonce mDNS suffit
(`mapping.ts : mediaPlayerClass`) : bit « sortie vidéo » du masque `ca` levé → si le modèle est un
écran à lui (`Nest Hub`, `Home Hub`, `Smart Display`) c'est un **`display`**, sinon un **`tv`**
(Chromecast, Google TV Streamer, TV Android à Chromecast intégré) ; sans sortie vidéo, **`speaker`**.
Le volume `fixed` confirme le branchement HDMI mais n'arrive qu'après connexion : le masque, lui, est
là dès la découverte. Posé dans `meta.mediaPlayer.deviceClass`
(`../1_architecture/1_1_contrat-appareils.md`).
Rien dans `house.json` : le fichier ne porte que le placement.

### Mise à jour 2026-09-09 — première lecture réelle : `duration: null` rejetait tout le message

Une radio (Radio France, lancée à la voix) sur un Nest Mini : l'enceinte restait « Au
repos ». Cause et correction dans `../6_faq/6_1_pieges-runtime.md` : `duration` vaut `null` sur un
direct, le schéma exigeait un nombre. Schémas passés en `nullish`, mappage tolérant au vide, et la
capture brute est devenue la première fixture **réelle** de lecture (`*_RADIO` dans
`__fixtures__/network.ts`). La fixture Spotify reste déduite : à remplacer à la première lecture d'un
morceau à durée. Constaté au passage : `contentId` vide et l'URL du flux dans `contentUrl` ;
`statusText` de l'appli (« Diffusion: franceinfo ») sert de titre de repli quand les métadonnées manquent.

### Mise à jour 2026-09-09 — pause sans `media`, identifiant en titre, et l'UI du lecteur

Première vraie séance d'écoute (YouTube Music sur un Nest Hub) : le morceau disparaissait à la pause
et un identifiant de vidéo s'affichait au changement de titre — deux corrections côté plugin, décrites
dans `../6_faq/6_1_pieges-runtime.md`. Côté web, le panneau lecteur ne bouge plus entre lecture et
pause, les textes longs défilent (`MarqueeText`) et le lecteur qui joue émet une onde sonore dans la
scène 3D (`../4_ui/4_0_langage-visuel.md`, `../1_architecture/1_5_scene-3d.md`).

### Mise à jour 2026-09-09 — pochettes relayées par le serveur, `seek`, « précédent » intelligent

- **Pochettes** : chargées directement par le navigateur, les images de Google finissaient en
  `429 Too Many Requests` (constaté dans l'inspecteur). `mapping.ts` publie désormais dans `artUrl`
  une URL **relative** de la route `GET /api/plugins/google_cast/art?url=<originale encodée>`
  (`artProxyUrl`) ; la route ne relaie que les URL vues dans un état média (pas un relais ouvert),
  télécharge une fois avec jusqu'à trois tentatives espacées sur 429 / 5xx, garde 32 images six heures
  (un échec une minute) et répond `Cache-Control: public, max-age=86400`. Vérifié en réel : JPEG de
  32 Ko servi, URL inconnue → 404.
- **`media_player.seek`** → `SEEK { currentTime }` sur la session ; la capacité `seek` est déclarée
  pour tout appareil (l'UI la réserve aux morceaux à durée).
- **Champs faits d'espaces** : Crunchyroll (appli native sur Chromecast, `appId: AndroidNativeApp`) envoie
  des métadonnées génériques — titre de l'épisode, `artist: " "`, ni série ni saison ni image : il n'y a
  rien de plus à afficher, et un champ vide ou fait d'espaces vaut « absent » (`clean` dans `toMediaPatch`).
  Capture réelle en fixture (`*_CRUNCHYROLL`).
- **`media_player.previous`** : au-delà de 3 s dans le morceau (position estimée = dernier relevé +
  temps écoulé), `SEEK` à 0 ; sinon `QUEUE_UPDATE jump: -1`.

### Piste notée 2026-09-10 — enrichir les métadonnées pauvres (Crunchyroll) par une recherche web

Demande de l'utilisateur, remise à plus tard : quand l'appli source n'envoie que le titre de l'épisode
(Crunchyroll : `metadataType: 0`, ni série ni image), retrouver la série et une affiche. Testé depuis
le réseau de la maison le 2026-09-09 :

- **Page Crunchyroll de l'épisode** (`/watch/<id>`) : coquille JavaScript, aucune balise de partage
  côté serveur → impasse sans navigateur.
- **AniList** : API fermée ce jour-là (« temporarily disabled »).
- **DuckDuckGo HTML** (`html.duckduckgo.com/html/?q=…`) : répond sans clé ; pour
  « crunchyroll "<titre d'épisode>" », un extrait donne le nom de la série animée. Non officiel, mais stable depuis des années.
- **Kitsu** (`kitsu.io/api/edge/anime?filter[text]=…`) : gratuite, sans clé ; retrouve la série, ses
  titres et une affiche (URL **signée, 15 min**) — à faire passer tout de suite par le relais
  d'images, qui la garde en cache.
  Variante relevée par l'utilisateur dans l'inspecteur du site Kitsu (2026-09-10) : le site passe par
  **Algolia** — `GET kitsu.io/api/edge/algolia-keys` donne une clé de recherche publique, puis une
  requête Algolia sur l'index `production_media` rend `titles` (en, ja, romaji), `canonicalTitle`,
  `posterImage`, `slug`, `id`. Recherche plus tolérante que `filter[text]` (synonymes, fautes) ; même
  affiche signée au bout.

Schéma envisagé : couche d'enrichissement côté serveur, déclenchée seulement pour les applis pauvres
(Crunchyroll d'abord), recherche par titre d'épisode → nom de série extrait des extraits (le maillon
fragile : texte libre des sites d'actualité) → confirmation Kitsu → série en deuxième ligne et affiche
en pochette ; cache par identifiant d'épisode, dégradation silencieuse, activable par variable
d'environnement, marquée non officielle. Pas commencé.

Banc d'essai du 2026-09-10 (script hors dépôt, sur le titre capturé) : la chaîne complète marche en ~2 s —
DuckDuckGo rend « <série> - Episode #N », l'extraction « X - Episode N » isole le
nom, Algolia/Kitsu rend la fiche avec affiche. MAIS après trois requêtes rapprochées DuckDuckGo ne sert
plus qu'une page de contrôle anti-robot (HTTP 202), même pour la requête qui passait : inutilisable en
production sans une API de recherche à clé (Brave Search, palier gratuit ; Google Programmable Search,
100/jour). L'index médias de Kitsu ne connaît pas les titres d'épisodes (73 résultats hors sujet ; confirmé par
l'utilisateur sur le site : un titre français ne donne rien de bon), et
l'API de contenu de Crunchyroll répond 403 Cloudflare à un serveur. Conclusion : faisable seulement avec
une clé de recherche ; à trancher avec l'utilisateur avant de coder.

**Essai de l'API interne Crunchyroll (2026-09-10) — concluant, SANS compte.** L'utilisateur ayant proposé son
compte, testé d'abord l'accès anonyme, celui du site pour un visiteur : `POST /auth/v1/token` avec le client
web public (identifiant public du site en `Basic`, `grant_type=client_id`) rend un jeton d'une heure de portée
`content` ; `GET /content/v2/cms/objects/<id>?locale=fr-FR` rend alors le type, le titre, `episode_metadata`
(`series_title`, `season_title`, `season_number`, `episode_number`, `series_id`, `is_premium_only`) et huit
vignettes jusqu'à 1920 × 1080 ; `GET /content/v2/cms/series/<series_id>` rend l'affiche (`poster_tall`,
`poster_wide`). Le tout en ~0,7 s depuis Node. Deux pièges : (1) l'hôte `www.crunchyroll.com` répond 403
Cloudflare à Node (empreinte TLS), mais pas à curl — l'hôte `beta-api.crunchyroll.com`, celui des applis,
accepte Node ; (2) le client web n'accepte pas `grant_type=password` (`unsupported_grant_type`), et il n'en
faut pas : les métadonnées ne demandent aucun compte, les identifiants ajoutés à `.env` pour l'essai sont
inutiles. Non officiel, à cache par identifiant et dégradation silencieuse. C'est cette voie, et non la
recherche web, qu'il faudra coder.

### Mise à jour 2026-09-10 — enrichissement Crunchyroll (non officiel, sans compte)

Codé à la suite de l'essai ci-dessus. `enrich/crunchyroll.ts` (`CrunchyrollEnricher`) : jeton anonyme du
client web public (renouvelé une minute avant l'heure), `GET /content/v2/cms/objects/<id>` sur l'hôte
`beta-api.crunchyroll.com` (le seul qui accepte Node), schémas zod souples, cache par identifiant (succès
24 h, échec 10 min, 128 entrées), une requête en vol par identifiant, tout échec avalé en debug.
`mapping.ts : applyEnrichment` (pur) pose le **titre** de l'épisode s'il manque (vu en réel dès la première
lecture : l'appareil n'avait envoyé qu'un artiste vide, et le panneau restait en « … » d'attente), la série en `artist`, « S1 · E10 » en `album` et, en `artUrl`
**relayée** (`/art`, URL ajoutée aux connues), l'**affiche portrait de la série** (`GET /content/v2/cms/series/<id>`,
`poster_tall` ≥ 480 px, une requête par série, en cache — choix de l'utilisateur : une image stable par
série plutôt qu'une capture par épisode), sinon la vignette de l'épisode ≥ 640 px — sans écraser ce que
l'appareil a dit. L'API sert chaque image en 8 ou 9 tailles du même fichier.
Dans `index.ts`, `mediaPatch` : cache → appliqué d'un coup ; sinon publication immédiate de l'état brut,
puis republication enrichie quand la réponse arrive **si le même contenu joue encore**. Déclenché seulement
pour l'appli Crunchyroll (`isCrunchyrollApp` : nom ou paquet Android). Variable
`CAST_CRUNCHYROLL_ENRICH` (`true` par défaut). Fixtures : jeton et objet réels anonymisés
(`CRUNCHYROLL_TOKEN`, `CRUNCHYROLL_OBJECT_EPISODE`) ; tests `enrich/crunchyroll.test.ts` et `plugin.test.ts`.
Non officiel : un changement de l'API Crunchyroll rend simplement l'affichage à ce que l'appareil donne.

### Mise à jour 2026-09-10 — appli sans canal média : état `on` (« À l'écran »), capture Netflix

**Symptôme** (utilisateur) : Netflix lancé sur un Chromecast, rien dans l'UI, la ligne
dit « Au repos ». **Cause** : `GET /api/plugins/google_cast/raw` montre l'appli déclarée dans le
RECEIVER_STATUS (`appId: "Netflix"`, `appType: "WEB"`, `isIdleScreen: false`, `sessionId`) mais **sans
`transportId` ni `namespaces`** : Netflix natif n'ouvre aucun canal média Cast. `receiverApplicationSchema`
exigeait `transportId`, l'appli était rejetée par `activeApplication` → « aucune appli » → `idle`. À
l'inverse Crunchyroll natif, Arte et YouTube Music déclarent `urn:x-cast:com.google.cast.media` et un
`transportId`, d'où leurs métadonnées.

**Ce qu'on sait alors** : uniquement le nom de l'appli. Ni titre, ni position, ni lecture / pause, ni
commande de transport possible. Représentation retenue par l'utilisateur (option 1 sur trois : nouvel
état / rester `idle` avec la source / prétendre `playing`) :
- `PLAYBACKS` gagne **`on`** (`packages/shared/src/devices/state.ts`, voir
  `../1_architecture/1_1_contrat-appareils.md`) : « une appli est à l'écran mais ne dit pas ce qu'elle fait ».
- `types.ts` : `transportId` optionnel. `mapping.ts : toMediaPatch` : appli sans `transportId` →
  `{ playback: 'on', nowPlaying: { title: '', source: displayName } }` ; sans appli ou sans session : `idle`
  comme avant.
- `channel.ts` : le changement d'appli se compare par **`sessionId`** (un `transportId` absent des deux côtés
  aurait masqué le changement et rien n'aurait été publié) ; CONNECT et GET_STATUS média ne partent que
  s'il y a un `transportId` ; `requireMedia` refuse toute commande (« nothing is playing »).
- UI : `lib/deviceState.ts` résume « À l'écran · Netflix » (clé i18n `media.on`, fr / en) ; le panneau
  (`MediaPlayerControl`) nomme l'appli sur la première ligne sans le « … » d'attente (le titre n'arrivera
  jamais) ; la vue Médias grise les touches (`loaded` = `playing` ou `paused`) ; ni onde sonore ni compteur
  « en lecture » (réservés à `playing`).
- Capture réelle en fixture `RECEIVER_STATUS_NETFLIX` ; tests `mapping.test.ts` et `plugin.test.ts` (aucun
  message envoyé à l'appli, commande refusée, retour à `idle` à la fermeture). Vérifié en réel : le serveur
  publie `on` + Netflix, la ligne l'affiche.

**Limite et suite possible** : Netflix n'a aucune API publique, et l'appli native ne donne même pas un
identifiant de contenu à chercher — un compte dans le `.env` n'y changerait rien (l'historique de visionnage
Netflix n'est mis à jour qu'après coup, par une API interne non officielle, protégée). La voie plausible pour
un titre : **ADB** sur le Chromecast avec Google TV (débogage réseau à activer sur l'appareil, port 5555),
`dumpsys media_session` expose la MediaSession Android de l'appli au premier plan (titre, lecture / pause,
position) — à vérifier pour Netflix, non codé. Le protocole « Android TV Remote v2 » (étape 3) ne donne que
le paquet de l'appli au premier plan, pas ses métadonnées.

**Retours de l'utilisateur, même jour** (« le switch n'est pas on, pas de pulse ; dans la 3D on peut mettre le
pulse car l'appareil diffuse une image ; en attendant mieux une image Netflix en fond, en repli pour Arte,
Crunchyroll et autres ») :
- `on` est ACTIF côté UI : `lib/deviceState.ts : isMediaActive` (`playing` ou `on`) alimente `isDeviceOn`
  (interrupteur, teinte de l'icône, comptage « actifs » d'une pièce), `isDevicePulsing` (point des listes, y
  compris la vue Médias), `deviceColor` et l'onde des marqueurs 3D (`three/markers/markers.ts`). Le compteur
  « n en lecture » reste sur `playing`. La bascule de l'interrupteur envoie `pause`, refusée par le plugin
  (« nothing is playing ») : ce que devrait faire « éteindre » une appli à l'écran (un `STOP { sessionId }` sur
  le canal récepteur ferme l'appli) est une question ouverte.
- **Logo de l'appli en pochette de repli**, généralisé : `enrich/appIcon.ts`. Quand le morceau n'a pas d'image
  (Netflix natif, Crunchyroll avant enrichissement…), `index.ts : withAppIcon` pose en `artUrl` (relayée par
  `/art`) d'abord l'`iconUrl` que le récepteur donne lui-même (Radio France ; Netflix et Spotify l'envoient
  vide), sinon l'icône du **registre public des applis Cast** — `GET
  https://clients3.google.com/cast/chromecast/device/app?a=<appId>`, sans clé, réponse JSON précédée du garde
  `)]}'`, `promo_assets[].icon_url` = carré 512 px chez Google (relevé : Netflix, YouTube, Spotify, Radio
  France). Une appli lancée par Cast porte son vrai `appId` (8 hex) : couverte d'office ; une appli NATIVE
  (`appId: "Netflix"`, `AndroidNativeApp`) passe par la table `NATIVE_APP_IDS` (nom → id, Netflix / YouTube /
  Spotify vérifiés — à compléter, Crunchyroll et Arte natifs n'y sont pas encore). Cache 24 h (échec 1 h),
  une requête en vol par id, publication immédiate puis republication quand le logo arrive si la même appli
  est encore à l'écran (`sessionId`). L'enrichissement Crunchyroll passe AVANT le logo : son affiche gagne.
  Rendu : les fonds existants (ligne `auto` centré, panneau `cover`) montrent le « N » rouge de Netflix ;
  fixture `CAST_REGISTRY_NETFLIX` (capture réelle), tests `enrich/appIcon.test.ts` et `plugin.test.ts` (le
  registre est muet par défaut dans les tests : aucune sortie réseau). Vérifié en réel sur les trois surfaces.

**Suite, même jour — `media_player.stop` ferme l'appli.** L'utilisateur a tranché la question ouverte : « ajoute
le STOP pour fermer l'appli avec le switch ». `channel.ts : stopApp` envoie `STOP { sessionId }` au récepteur
(`receiver-0`, namespace receiver) ; il répond par un RECEIVER_STATUS sans appli, d'où `idle` et le morceau
effacé par le chemin habituel. Sans appli à l'écran : `UNSUPPORTED_COMMAND` (« nothing is on screen »).
`index.ts` : `media_player.stop` → `stopApp`, quel que soit l'état (une appli qui joue est fermée aussi : c'est
« arrêter », pas « pause »). Le faux récepteur des tests vide `applications` sur STOP. Vérifié en réel : Netflix
fermé depuis l'interrupteur du panneau, le Chromecast revenu à l'accueil, la ligne repassée « Au repos ».
Au passage : le bouton de fermeture des toasts (`v-snackbar-queue`, `App.vue`) disait « Dismiss » (locale Vuetify
par défaut) ; il prend `common.close` (« Fermer » / « Close »).

### Essai 2026-09-10 — ADB sur un Chromecast : Netflix ne publie pas de titre

Mode développeur activé par l'utilisateur. Sur ce Chromecast (produit `sabrina`, **Android 14**),
« Débogage USB » n'ouvre PAS le port 5555 (refusé) : c'est le **débogage sans fil** qui ouvre ADB,
annoncé en mDNS `_adb-tls-connect._tcp` (port aléatoire), après un appairage unique par code
(`adb pair <ip>:<port d'appairage> <code>`, puis `adb connect <ip>:<port>`). ADB est installé sur le poste par
winget (`Google.PlatformTools`, hors PATH : `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.PlatformTools_*\platform-toolsdb.exe`).
Sous Git Bash, `MSYS_NO_PATHCONV=1` sinon `/sdcard/...` est réécrit en chemin Windows.

Résultat avec Netflix 13.1.3 en lecture : `dumpsys media_session` montre la session « Netflix media session »
**active, `PLAYING` / `PAUSED` fiable, position en ms** (vérifié : `KEYCODE_MEDIA_PAUSE` → `PAUSED`, reprise →
`PLAYING`, position qui avance), mais **`metadata: null`** — ni titre, ni durée, ni image. Rien ailleurs non
plus : `uiautomator dump` (le lecteur est une surface sans vues), `screencap` vide (flux protégé),
`android.media.tv/watch_next_program` et `preview_program` vides, aucune notification, `logcat` muet.
Conclusion : la voie ADB donnerait pour Netflix natif **lecture / pause + position** (mieux que `on`), pas de
titre. Un titre Netflix n'est accessible par aucune source locale. Les autres applis natives pourraient
renseigner leur `MediaSession` (à relever : Disney+, Prime Video…). Non codé.
**Décision de l'utilisateur (2026-09-10) : laissé de côté.** Trop compliqué pour l'utilisateur final (appairage
par appareil, port qui change) pour un gain qui ne rend pas ce qui est diffusé. La doc reste au cas où ; le mode
développeur et le débogage ont été désactivés sur le Chromecast.

### Mise à jour 2026-09-10 — mémoire des appareils vus : un Cast éteint reste là

Constat de l'utilisateur : « TV salon est éteinte mais elle apparaît comme ça dans l'app, pourtant elle
avait été enregistrée » — l'entrée `auto.google_cast-abcd1234…` de `house.json` s'affichait sous son **id
brut**, avec « Cet appareil n'est lié à aucun plugin ». Cause : la découverte était la **seule** source de
l'inventaire. Un téléviseur en veille profonde ne s'annonce plus en mDNS (limite notée plus haut), le
plugin ne le retenait que le temps du processus, et au redémarrage suivant il n'existait plus : la liaison
de la maison visait un id que plus aucun plugin ne remontait, donc plus de nom, plus d'icône, plus d'état.

Trois options posées à l'utilisateur ; il a choisi **la mémoire côté plugin** — plutôt que d'écrire le nom
dans `house.json` au placement, qui l'aurait figé et empêché un renommage dans Google Home de se propager
(`../2_maison/2_0_format-house-json.md`) — en demandant de « pouvoir retirer un appareil ».

- **`known.ts`** — la dernière annonce de chaque appareil (`host`, `port`, enregistrement TXT) dans un
  petit JSON, écrit atomiquement. Le fichier intermédiaire porte le **pid** (`…json.<pid>.tmp`) : le
  serveur de développement et celui de la preview partagent ce fichier comme ils partagent `house.json`
  (`../5_setup/5_0_installation-et-scripts.md`), un `.tmp` commun se serait marché dessus. Fichier absent,
  illisible ou d'une autre forme → mémoire vide, jamais d'erreur fatale (le plugin doit démarrer même sans
  écriture possible). Chemin : **`CAST_KNOWN_FILE`** (défaut `apps/server/.state/google-cast-devices.json`) ;
  **chaîne vide = ne rien retenir**.
- **`init` charge la mémoire et crée les entrées AVANT la découverte** : `discover` les connecte comme les
  autres. Un appareil éteint échoue (5 s de délai de connexion, en parallèle) et reste **listé,
  indisponible**, avec son nom, sa nature (`tv` / `display` / `speaker`) et ses capacités ; il est retenté
  à 5 s, 10 s… 2 min. `emitDevices` est donc appelé avec la mémoire + le réseau, jamais avec le réseau seul.
- **`discovery.ts` ne dédoublonne plus par id** : chaque annonce remonte au plugin, qui compare
  (`sameService` : hôte, port, `fn`, `md`, `ca`). Annonce identique → rien ; **adresse ou nom changés**
  (bail DHCP, renommage dans Google Home) → mémoire réécrite, descripteurs republiés, connexion rouverte ;
  **pas de connexion → nouvelle tentative immédiate** (`reconnectNow`, délai remis à zéro) — une annonce
  prouve que l'appareil est là, inutile d'attendre la fin d'un délai qui peut valoir deux minutes. Sans ce
  changement, une adresse **retenue et périmée** aurait tenu jusqu'au redémarrage suivant.
- **`DELETE /api/plugins/google_cast/devices/:externalId`** — oublier : connexion fermée, entrée sortie de
  la liste **et** de la mémoire, descripteurs republiés (`../1_architecture/1_3_protocole-rest-ws.md`). Un
  appareil encore sur le réseau revient à sa prochaine annonce, et c'est voulu : on n'oublie que ce qui a
  disparu (appareil vendu, invité de passage). Les descripteurs portent `meta.forgettable: true` pour que
  l'UI sache le proposer sans connaître le nom du plugin (`../1_architecture/1_1_contrat-appareils.md`).

Trois tests ajoutés à `plugin.test.ts` (mémoire injectée, aucun accès disque) : un appareil retenu et
absent du réseau est listé indisponible puis connecté dès qu'il s'annonce ; une annonce d'adresse et de nom
changés est suivie ; l'oubli par la route sort l'appareil de la liste et de la mémoire, un second appel
répond 404.

Vérifié en réel le 2026-09-10 sur le serveur de développement : appareils retenus au redémarrage, mémoire
réécrite à chaque nouveauté, un appareil de test oublié depuis l'UI (geste en deux temps) disparaît de la
vue Médias et du fichier, `health` baissant d'un appareil.

**Ce que la mémoire ne peut pas faire** : elle ne connaît que ce qu'elle a vu **depuis sa mise en
service**. « TV Salon » (`abcd1234…`) ne s'est pas réannoncée depuis, son entrée de maison reste donc non
liée jusqu'à ce que le téléviseur s'annonce **une fois** ; à partir de là, il gardera son nom même éteint.
Un second téléviseur Sony, allumé au moment du relevé, est entré dans la mémoire sous `dcba4321…`
(sans nom donné dans Google Home). À surveiller : si le téléviseur du salon
réapparaissait sous un **autre id** que `abcd1234…`, sa liaison serait morte pour de bon et devrait être
refaite (retirer l'entrée, reposer l'appareil) — un identifiant Cast est censé être stable, ce point n'est
pas tranché.

### Mise à jour 2026-09-10 — Prime Video : `duration: -0.001`, et une appli native qui ne dit rien

Constat de l'utilisateur, Prime Video lancé sur « TV Salon » : « ça n'affiche pas grand chose » —
titre remplacé par un « … » qui pulse, et **« -1:-1 » de chaque côté du curseur**. Relevé par
`GET /api/plugins/google_cast/raw` (fixtures `RECEIVER_STATUS_PRIME_VIDEO` / `MEDIA_STATUS_PRIME_VIDEO`) :

```
applications[0] : appId "AndroidNativeApp", appType "ANDROID_TV", displayName "Prime Video",
                  namespaces [media], transportId présent
media           : contentId "amzn1.dv.gti.…", duration -0.001, title "", currentTime 141.89,
                  playerState PLAYING, supportedMediaCommands 79
```

Deux enseignements, tous deux dans la lignée du `duration: null` de la radio :

1. **`-0.001` est la façon de Prime Video de dire « durée inconnue »**. Elle était prise pour une
   vraie durée : le formateur rendait « -1:-1 » pour le total, et le curseur bornait la position à la
   durée (`Math.min(141.89, -0.001)`), donc la position affichait « -1:-1 » elle aussi et le curseur
   restait collé à zéro. `mapping.ts` ne retient plus qu'une durée **positive et finie**
   (`isDuration`), et refuse une position négative. L'UI se défend de la même façon
   (`MediaPlayerControl.vue`), pour ne pas dépendre d'un seul plugin bien élevé.
2. **Une appli native de TV Android ne publie aucune métadonnée** : titre vide, un identifiant Amazon
   pour tout contenu. Le titre n'arrivera JAMAIS — le « … » d'attente tournait donc sans fin. Rien
   n'est inventé côté plugin (le titre reste vide, comme pour l'état `on`) ; c'est l'UI qui nomme
   l'appli, voir `../4_ui/4_1_navigation-et-panneaux.md`.

Ce que le protocole donne quand même sur ces applis : la **position** (relue toutes les 10 s), l'état
lecture / pause, les commandes de transport (`supportedMediaCommands: 79`) et le volume. C'est ce que
le panneau montre désormais : « Lecture », « Prime Video », « 9:12 », touches actives.

Vérifié en réel le 2026-09-10 pendant une lecture Prime Video : état publié `playback: 'playing'`,
`nowPlaying: { title: '', positionS: 512.665, source: 'Prime Video' }` — plus de `durationS`, position
qui avance.

**Complément (demande de l'utilisateur : « on peut au moins mettre l'image de prime video en background
comme on a fait pour netflix ? »)** — oui, le mécanisme existait déjà, il manquait une ligne : une appli
native ne porte pas son identifiant Cast (`appId: "AndroidNativeApp"`), c'est la table `NATIVE_APP_IDS`
d'`enrich/appIcon.ts` qui fait le lien par son nom, et Prime Video n'y était pas. Identifiant relevé sur
le registre public avant de l'écrire : `17608BC8` rend bien `display_name: "Prime Video"` et une icône
512 px (fixture `CAST_REGISTRY_PRIME_VIDEO`). La table connaît donc Netflix, YouTube, Spotify et
Prime Video ; toute autre appli native reste sans logo jusqu'à un relevé.

Vérifié en réel pendant la lecture : l'état publié porte
`artUrl: '/api/plugins/google_cast/art?url=…lh3.googleusercontent.com…'`, la route relaie l'image
(HTTP 200, `image/png`, 119 683 octets) et le panneau la pose en fond fondu derrière l'en-tête, comme
pour Netflix. Crunchyroll, autre appli native, n'en a pas besoin : son affiche vient de l'enrichissement.

Piste (non codée, même famille que Crunchyroll) : le `contentId` est un **GTI Amazon**
(`amzn1.dv.gti.…`). Aucune API publique connue pour le résoudre en titre ; à creuser seulement si
l'utilisateur le demande, et probablement bloqué par l'authentification Prime.

### Mise à jour 2026-09-10 — un direct (`streamType: LIVE`) : « précédent » coupait le flux

Constat de l'utilisateur, sur un Nest Mini : « j'ai un direct de franceinfo qui tourne
mais les boutons prev/next ne sont pas disabled. quand je clic sur prev alors ça coupe le stream et
ensuite l'enceinte semble être dans un état bizarre, par exemple je n'ai pas pu relancer le stream
france info ».

Ce n'était pas qu'une touche mal grisée. `media_player.previous` appliquait la règle de télécommande
(« passé 3 s, retour au début du morceau ») et envoyait un **`SEEK` à `currentTime: 0` sur un flux qui
n'a pas de début** : le récepteur coupait le direct et gardait une session morte, que l'appli Radio
France ne sait pas relancer. `media_player.next` (`QUEUE_UPDATE jump: +1`) est du même tonneau : il
n'y a pas de file.

**Le masque `supportedMediaCommands` ne sert à rien ici** — c'est l'enseignement le plus durable de la
session. Il se trompe dans les deux sens, sur des captures réelles :

| Appli (capture réelle) | Masque | Ce qu'il annonce | Ce qui est vrai |
|---|---|---|---|
| Radio France, direct franceinfo | `12495` | PAUSE, **SEEK, précédent, suivant**, volume, muet, débit, pistes | aucune des trois n'a de sens, et SEEK **tue** le flux |
| Crunchyroll (appli native) | `143` | PAUSE, SEEK, volume, muet, **précédent** (pas suivant) | précédent ET suivant marchent (constaté par l'utilisateur) |
| Prime Video (appli native) | `79` | PAUSE, SEEK, volume, muet, **suivant** (pas précédent) | non vérifié, laissé actif |

S'en servir pour griser aurait donc cassé le « suivant » de Crunchyroll, qui fonctionne. Le seul signe
fiable est `media.streamType` — `LIVE` sur la radio, `BUFFERED` partout ailleurs — présent dans la même
capture depuis le début (`MEDIA_STATUS_RADIO`). D'où `isLive()` dans `mapping.ts`, et rien d'autre.

Le garde-fou est posé à trois niveaux, pour qu'aucun ne soit le seul rempart :

1. **Contrat** : le plugin publie `nowPlaying.live: true` (voir `../1_architecture/1_1_contrat-appareils.md`).
2. **Plugin** : `channel.ts` refuse `QUEUE_UPDATE` et `SEEK` sur une session en direct
   (`refuseOnLive`, `UNSUPPORTED_COMMAND`) — **rien ne part sur le réseau**, même si un écran
   resté sur un vieil état l'exige. `previous()` passe désormais par `seek()`, donc par le même
   contrôle. Lecture, pause, volume et sourdine restent acceptés.
3. **UI** : précédent, suivant et curseur grisés, dans le panneau comme dans la vue Médias
   (voir `../4_ui/4_1_navigation-et-panneaux.md`).

Le `streamType` survit à une pause : le récepteur n'inclut `media` que lorsqu'il change, et le canal
recopie déjà le morceau connu de la même session (piège documenté plus haut) — donc `live` reste vrai
en pause.

Tests : `plugin.test.ts` refuse précédent, suivant et se placer sur la capture franceinfo **et vérifie
qu'aucun `SEEK` ni `QUEUE_UPDATE` n'est émis**, tout en laissant passer la pause ; `mapping.test.ts`
distingue direct / morceau / durée inconnue.

Ce qui n'est PAS réparé : une session déjà morte côté récepteur. Kasbah ne peut pas la relancer, et
tant que l'appli reste chargée sans session on publie `idle` — donc l'interrupteur propose « lecture »
et non « fermer l'appli », ce qui laisse sans issue depuis l'app (il faut la voix ou l'appli Google
Home). Piste notée : traiter « appli chargée, rien à jouer » comme `on` pour rendre `media_player.stop`
accessible, au prix de faire apparaître « actif » un lecteur avec une appli simplement ouverte.

### Mise à jour 2026-09-10 — `universalAppId` : l'identifiant qui porte les visuels

Constat de l'utilisateur, une vidéo YouTube Music lancée sur la TV du salon : « je n'ai pas de
background ». Le morceau est pourtant complet (titre, artiste, durée, position) — mais **sans aucune
image** dans ses métadonnées, donc tout reposait sur le logo de l'appli. Relevé :

```
appId "2C6A6E3D", appType "ANDROID_TV", displayName "YouTube", universalAppId "233637DE"
media : title "<artiste> - …", artist "<artiste>", duration 1544.541, currentTime 602.781, aucune image
```

Une TV Android lance **sa variante** de l'appli : `appId` valait `2C6A6E3D`, un identifiant que le
registre connaît (`display_name: "YouTube"`) mais **sans un seul `promo_assets`** — donc réponse
valide, aucun logo, fond vide. Les visuels sont rangés sous l'identifiant **canonique**,
`universalAppId: 233637DE` (dix-sept entrées). `registryAppId` essaie donc `universalAppId` d'abord,
puis `appId`, puis la table des applis natives par nom (Netflix annonce `appId` et `universalAppId`
non hexadécimaux : `Netflix`, il passe toujours par la table). Fixtures réelles ajoutées, dont la
réponse **sans visuel** de la variante Android TV — c'est elle qui documente le piège.

Vérifié en réel : l'état publié porte le logo relayé (HTTP 200, `image/png`, 5 462 octets) et le fond
apparaît derrière l'en-tête du panneau.

À noter pour la suite : ces trois relevés (Netflix, Prime Video, YouTube) disent la même chose des
applis d'une TV Android — **aucune n'envoie d'image**, et deux sur trois n'envoient pas de titre. Le
logo de l'appli n'est donc pas un repli exceptionnel sur ce matériel, c'est le cas courant.

### Mise à jour 2026-09-10 — la pochette du morceau, à défaut de la vignette de la vidéo

Regret de l'utilisateur sur la lecture YouTube : « c'est vraiment dommage de ne pas pouvoir récupérer
l'artwork du titre qui passe ». Deux relevés ont tranché la question avant d'écrire une ligne.

**Ce que le protocole local ne donne pas.** Un relevé à la main sur tous les canaux que l'appli
déclare (`tools/cast-probe.mts`, jetable et réutilisable) :

```
→ youtube.mdx  {"type":"getMdxSessionStatus"}
← youtube.mdx  {"type":"mdxSessionStatus","data":{"screenId":"2153…634d","deviceId":"f03b…a03b"}}
→ youtube.mdx  {"type":"getNowPlaying"}          (sans réponse)
→ cast.customdata / cast.system {"type":"getStatus"}   (sans réponse)
← cast.media   … contentId "" … metadata { title, artist } … aucune image
```

Donc : **pas d'identifiant de vidéo**, donc pas de `i.ytimg.com/vi/<id>`. Le `screenId` ouvrirait la
voie de l'API *lounge* de YouTube (jeton, puis session `bind` en long-poll dont les événements portent
le `videoId`) — non officielle, étatée, quelques centaines de lignes, et à la merci d'un changement
côté Google. **Écartée** (l'utilisateur a choisi la seconde voie).

**Ce que le nom du morceau donne.** Il reste titre + artiste, et deux catalogues publics les
retrouvent sans clé ni compte. Vérifié sur le parc réel avant de coder :

| Ce qui joue | iTunes Search | Deezer |
|---|---|---|
| `Titre` · *Artiste A et Artiste B* | ✅ `Artiste A & Artiste B` / `Titre` | ✅ pochette 1000 px |
| `Artiste - Live Performance (Piano Set)` | ❌ propose des artistes sans rapport | ✅ rien |

D'où `enrich/cover.ts` (`CAST_COVER_LOOKUP`, vrai par défaut), sur le modèle de l'enrichisseur
Crunchyroll : iTunes d'abord (couverture large, pochette montée en 600 px par réécriture du gabarit
d'URL), Deezer en second recours (plus strict, mais il ne nomme que l'artiste principal).

Le cœur du sujet n'est pas la requête, c'est le **contrôle de correspondance** (`matches`) : iTunes
répond TOUJOURS quelque chose. Titre identique après normalisation (accents, parenthèses —
« (Live) », « [Official Video] » —, ponctuation), et artistes compatibles par **jeux de mots**, l'un
contenant l'autre : cela accepte « Artiste A » (Deezer) comme « Artiste A & Artiste B »
(iTunes) face au « Artiste A et Artiste B » de l'appareil — l'appli en français remplace le
« & » par « et » —, et refuse un artiste sans rapport. Sans lui, on collait une pochette étrangère sur un set piano.

Les **échecs sont mémorisés** (six heures) autant que les succès (sept jours) : pendant une lecture le
plugin republie l'état toutes les dix secondes, une vidéo non musicale déclencherait sinon une requête
en boucle. La chaîne de la pochette se lit maintenant du plus précis au plus général : image des
métadonnées → enrichissement Crunchyroll → **pochette de l'album par le nom** → logo de l'appli.

Vérifié en réel le 2026-09-10 : un titre joué sur la TV depuis YouTube Music
affiche la pochette de son album (relayée par `/art`, HTTP 200, `image/jpeg`, 259 331 octets) là où
il n'y avait que le logo YouTube.

Limite assumée : c'est la pochette de l'**album**, pas la vignette de la vidéo. Pour de la musique
c'est ce qu'on veut voir ; pour une reprise live ou un mix qui n'existe dans aucun catalogue, aucune
correspondance n'est trouvée et le logo de l'appli reprend sa place.

### Mise à jour 2026-09-10 — le son sort ailleurs : la TV Sony dit où (sonde `bravia.ts`)

Constat de l'utilisateur : « TV Salon » diffuse YouTube Music (pochettes à l'écran) mais **le son sort
par la barre de son**, et l'app montrait la TV en lecture et la barre « Au repos ». Relevé
(`tools/cast-probe.mts` sur les deux appareils) : la barre, côté Cast, est **réellement au repos** —
aucune appli, aucune session média, volume 6 %. Le son passe par **HDMI eARC**, que le protocole Cast ne
voit pas. La barre « Flexus Core 300 » est une **Klipsch** (l'annonce AirPlay 2 sur le port 7000 donne le
fabricant ; le `md` mDNS n'a pas la marque) et n'expose aucune API locale de statut (80/443/8443 → 404).

**La TV, elle, le dit.** C'est une Sony **BRAVIA** (XR), et son API REST locale (« IP control »,
`POST http://<tv>/sony/<service>`, JSON-RPC) répond **sans clé PSK ni appairage** à :

| Méthode | Réponse relevée | Ce qu'on en tire |
|---|---|---|
| `audio.getSoundSettings` `[{ target: 'outputTerminal' }]` v1.1 | `currentValue: 'audioSystem'` | le son part vers le système audio (`speaker` = ses haut-parleurs, `speaker_hdmi` = les deux) |
| `avContent.getCurrentExternalInputsStatus` v1.1 | « HDMI 3 (eARC/ARC) » `connection: true`, étiquette « Barre de son », et l'entrée CEC `port=3` titrée **« Flexus 300 »** | le nom que la TV donne à l'appareil branché en ARC |
| `audio.getVolumeInformation` | `speaker: 6` | le volume de la TV EST celui de la barre (CEC) — identique au volume Cast de la barre |
| `avContent.getPlayingContentInfo`, `system.getSystemInformation` | `403 Forbidden` + `auth_url` | demandent une clé PSK : on n'en a pas besoin |

`apps/server/src/plugins/google_cast/bravia.ts` : `isBravia(md)` (modèle mDNS qui commence par
`BRAVIA`), `parseSoundOutput` → `internal` / `external` / `both`, `parseArcDeviceName` (nom CEC du port
ARC connecté, à défaut l'étiquette de l'entrée), `probeBravia(host)` en **deux requêtes** (la seconde
seulement si le son sort de la TV). Le plugin (`index.ts : startAudioProbe`) sonde toute BRAVIA
**connectée** tout de suite puis toutes les 10 s (`BRAVIA_POLL_MS`), tant que la connexion Cast tient
(elle tombe avec la TV), et publie **`audioOutput: { terminal, name? }`** dans l'état `media_player`
(`../1_architecture/1_1_contrat-appareils.md`) — seulement quand ça change ; une TV qui ne répond pas
garde son dernier relevé, rien n'est inventé. `CAST_BRAVIA_PROBE=false` pour s'en passer. Fixtures
relevées : `__fixtures__/bravia.ts` ; tests `bravia.test.ts` et `plugin.test.ts` (« asks a Sony TV… »).

**Le lien TV → barre reste DÉCLARÉ**, dans house.json sur l'appareil TV : `meta.audioOutput` = l'id
maison de la barre (`../2_maison/2_0_format-house-json.md`). Le nom CEC (« Flexus 300 ») ne suffit pas
à l'apparier seul au modèle Cast (« Flexus Core 300 ») ; la TV confirme ou infirme le lien (réglée
sur `speaker`, il ne joue pas), et muette là-dessus (autre marque), on croit la déclaration. Ce que
l'UI en fait : `../1_architecture/1_5_scene-3d.md` (l'onde change d'appareil) et
`../4_ui/4_1_navigation-et-panneaux.md` (« Son de TV Salon · titre »). Décision de l'utilisateur : lien
dans le JSON, pas de sélecteur ; le compteur « n lecteurs en diffusion » **ne compte pas** la barre.

Vérifié en réel sur le parc : état de la TV `audioOutput: { terminal: 'external', name: 'Flexus 300' }`
publié ; onde sur la barre, pochette seule sur la TV, panneau de la barre « <titre> / Son de TV Salon ».
Piège : le serveur ne relit house.json qu'au démarrage — après l'édition à la main, un redémarrage
(`tsx watch` sur un fichier touché) était nécessaire pour voir le lien.

### Mise à jour 2026-09-20 — `media_player.play_url` (étape 2)

Commande du contrat : `LAUNCH` du récepteur média par défaut (`CC1AD845`) si besoin, puis
`LOAD` avec `mediaFromUrl` (MIME et `LIVE` / `BUFFERED` d'après le chemin). Capacité
`play_url` déclarée sur tous les Cast. Vérifié en réel (franceinfo Icecast, volume bas) :
Nest Mini Cuisine, barre Salon, TV Salon — lecture puis `stop` → `idle`. Premier essai TV
Salon : `LAUNCH` timeout 5 s (TV lente à démarrer le récepteur) ; second essai OK, son vers
Flexus 300 (`audioOutput.external`). Ce n'est **pas** YouTube Music : le compte Google Home
reste hors protocole. Sources : `channel.ts : playUrl`, `mapping.ts : mediaFromUrl`,
`../1_architecture/1_1_contrat-appareils.md`.

### Mise à jour 2026-09-20 — métadonnées `play_url` (`stickyPlay`)

`mediaFromUrl` / `LOAD` acceptent `title` / `artist` / `artUrl` optionnels (contrat
`media_player.play_url`). Le plugin retient aussi ces champs (`stickyPlay`) tant que le
`contentId` correspond — filet si le récepteur n'écho pas les images / le titre du `LOAD`.
Vérifié en réel avec YouTube Music (phase 1) sur Nest / barre / TV. Sources :
`mapping.ts : PlayUrlMeta`, `index.ts` (`stickyPlay`), `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-22 — remplacer un flux sur un Cast : `pause`, pas `stop`

Rappel devenu une contrainte pour un autre plugin : sur un Cast, `media_player.stop` **ferme la
session, donc l'appli** (déjà noté plus haut). Quand ytmusic remplace le titre qu'il joue déjà sur un
lecteur, il envoie donc `media_player.pause` — le temps de la résolution yt-dlp — et jamais `stop` :
il faudrait sinon relancer le récepteur par `LAUNCH`, avec le timeout de 5 s déjà observé sur la TV
Salon (`../6_faq/6_1_pieges-runtime.md`).

À l'inverse, la **source** d'un transfert reçoit bien un `stop` : on veut qu'elle se taise et rende
l'appli. Détail du mécanisme : `../3_plugins/3_16_ytmusic.md`.

Sources : `apps/server/src/plugins/ytmusic/index.ts`, `apps/server/src/plugins/ytmusic/bridge.ts`
(devenu `apps/server/src/core/playbackBridge.ts` le 2026-09-23, voir plus bas),
`apps/server/src/app.ts`.

## Mise à jour 2026-09-22 (2) — `explicit` dans le `stickyPlay`

`PlayUrlMeta` porte `explicit`, posé par `media_player.play_url` et **reposé par `mediaPatch`** à
chaque patch tant que le `contentId` reste le nôtre : le récepteur Cast ne publie pas ce marquage,
comme il ne publie pas toujours le titre. Même règle et même raison que pour Sonos, où l'oubli du
report faisait s'éteindre le badge au premier sondage — détail dans `3_15_sonos.md`.

Sources : `apps/server/src/plugins/google_cast/{index,mapping}.ts`,
`../1_architecture/1_1_contrat-appareils.md`.

## Mise à jour 2026-09-23 — `live` déclaré par le service, et le pont qui a déménagé

**`streamType: 'LIVE'` sans `.m3u8`.** `mediaFromUrl` sépare `hls` (URL en `.m3u8` / `.m3u`, qui ne
décide plus que le type MIME `application/x-mpegurl`) de `live` = `hls` **ou** `meta.live` venu de
`media_player.play_url`. Un Icecast `.aac` part donc en `audio/mp4` **et** en `LIVE` quand le service
le déclare (plugin `radio`, `3_19_radio.md`). `PlayUrlMeta` porte `live`, posé dans l'écho immédiat et
reporté par le `stickyPlay` à chaque patch, comme `explicit`. Test : `mapping.test.ts`. Pas d'essai en
direct sur un Cast rapporté à cette date (l'essai du jour était sur Sonos).

Rappel utile : un direct côté Cast change aussi le sens de « précédent » (section du 2026-09-10
ci-dessus, « un direct (`streamType: LIVE`) : « précédent » coupait le flux »).

**Pont de lecture.** Le module cité dans la section du 2026-09-22 (`apps/server/src/plugins/ytmusic/bridge.ts`,
`YtmusicBridge`) est déplacé dans `apps/server/src/core/playbackBridge.ts` (`PlaybackBridge`), partagé
par ytmusic et radio. Le comportement vis-à-vis de Cast ne change pas (`pause` pour remplacer, `stop`
pour la source d'un transfert). Voir `../1_architecture/1_2_serveur-et-plugins.md`.

Sources : `apps/server/src/plugins/google_cast/{mapping,index}.ts`,
`apps/server/src/plugins/google_cast/mapping.test.ts`, `apps/server/src/core/playbackBridge.ts`.

### Mise à jour 2026-10-12 — une interface mDNS absente ne fait plus tomber le serveur

**Symptôme.** Serveur lancé hors du réseau local avec `CAST_MDNS_INTERFACE`
posé : tout le processus mourait au démarrage sur un `EADDRNOTAVAIL` non géré.

**Diagnostic.** `bonjour-service` n'écoute **pas** les erreurs de son socket multicast (`server.mdns`) :
l'adresse configurée n'existant plus sur la machine, le `bind` échoue, l'`error` émis n'a aucun
écouteur et remonte comme exception non interceptée — pour un plugin d'enceintes, c'était le serveur
entier qui tombait.

**Correctif** (`apps/server/src/plugins/google_cast/discovery.ts`) : un écouteur `error` sur
`server.mdns` ; la première panne produit **un** avertissement (« mDNS unavailable… Cast discovery
paused »), les suivantes un `debug` (sans quoi chaque `refresh()` rejouerait l'avertissement) ; la
découverte est **en pause** (`close()`), et le `refresh()` périodique du plugin (`CAST_MDNS_REFRESH_MS`) **rouvre** une découverte
(`open()`) au lieu de ne rien faire — elle repart d'elle-même quand l'interface revient. Un service
retrouvé remet le drapeau de panne à zéro.

**Test** (`discovery.test.ts`) : vrai socket, sur `203.0.113.7` (adresse réservée à la documentation, aucune
machine ne la porte) ; vérifie qu'aucune exception non interceptée ne passe, qu'un seul `warn` part malgré
un `refresh()`, et qu'il nomme l'interface.

Sources : `apps/server/src/plugins/google_cast/{discovery,discovery.test}.ts`.
