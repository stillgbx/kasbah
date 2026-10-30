# Musique et médias

> Dernière mise à jour : 2026-10-30
> Sources : sections reprises telles quelles de `4_1_navigation-et-panneaux.md` le 2026-10-13 ; chaque section cite les siennes.

Cette page couvre la vue Médias, les lignes et le panneau d'un lecteur, la page Musique (sources, recherche, file, genres, détail d'album, lecture dans le navigateur). Elle est née du découpage de
[4_1 Navigation et panneaux](4_1_navigation-et-panneaux.md), trop longue pour être lue d'un trait : ses
sections y ont été déplacées sans retouche, dans leur ordre d'origine, avec leurs dates. Un renvoi
« plus haut » ou « plus bas » peut donc désigner une section restée dans une autre page de `4_ui/`.

### Mise à jour 2026-09-09 — vue Médias (8e entrée du rail)

Nouvelle vue **Médias** (`views/MediaView.vue`, route `media`, icône `speaker`, entre Caméras et
Énergie) pour le kind `media_player`, sur `RoomBands` comme les trois autres vues par pièce. En-tête :
« N en lecture sur T ». Par ligne : touches précédent / lire-pause / suivant (grisées quand rien
n'est chargé — le plugin refuserait la commande), sourdine (touche allumée quand muet), curseur de
volume à valeur locale pendant le glissement, pourcentage. Chaque touche suit une **capacité** :
un Chromecast à volume fixe n'a ni curseur ni sourdine, un lecteur sans file n'a pas de piste
suivante. Le statut de la ligne (« Lecture · titre », « Au repos ») vient de `lib/deviceState.ts`.

Les clés `media.*` (`playing`, `paused`, `idle`, `off`, `nothing`) qu'utilisaient déjà
`deviceState.ts` et `MediaPlayerControl.vue` **n'existaient pas** dans `fr.json` / `en.json` (les
lecteurs simulés affichaient la clé brute) : ajoutées avec `summary`, `none`, `play`, `next`,
`previous`, `mute`, `unmute`, `volume`. Le rail compte désormais 8 vues. Plugin :
`../3_plugins/3_6_google-cast.md`.

### Mise à jour 2026-09-09 — lignes d'appareil : point de lecture, statut qui défile, pochette en fond

Trois retours de l'utilisateur sur les listes :

- **Point pulsant du panneau pièce** : il restait éteint pendant une lecture, parce qu'il suivait
  `isDeviceBusy`, qui ne connaît que le mouvement d'un ouvrant — et qui sert AUSSI à remplacer
  l'interrupteur du panneau par un spinner, ce qu'une lecture ne doit pas faire. Nouveau prédicat
  `isDevicePulsing` (`lib/deviceState.ts`) = occupé OU en lecture, réservé aux points des listes.
- **Statut qui défile** : « Lecture · titre » débordait et était coupé ; le statut des lignes du
  panneau pièce (`RoomPanel`) et des vues par pièce (`RoomBands`) passe par `MarqueeText` — défilement
  doux avec fondu, seulement si ça déborde.
- **Pochette en fond de ligne** : `RoomBands` expose un slot `backdrop` rendu en premier dans la ligne
  (`.row` en `position: relative; isolation: isolate`) ; la vue Médias y pose la pochette du morceau
  (URL relayée par le serveur) à 20 % d'opacité, fondue de la gauche vers les touches, avec un fondu
  croisé au changement de morceau. Rien ne se décale : la couche est absolue, hors de la grille. Les
  lignes du panneau pièce (`RoomPanel`, `.dev-row__art`) font de même, découpées au rayon de la ligne.
- **Teinte d'une lampe allumée** (même geste, demandé ensuite) : `lib/lightTint.ts` fabrique un dégradé de la
  couleur en cours (xy, sinon température de blanc, sinon blanc chaud 2700 K — le repli de la 3D), dont
  l'opacité suit la luminosité (18 % → 45 %). Posé par le slot `backdrop` dans la vue Lumières et par le
  même fond de ligne du panneau pièce, qui choisit pochette ou teinte selon l'appareil. Éteinte → rien.
- **Curseur de luminosité réservé** (vue Lumières) : il n'apparaissait qu'allumée, et la ligne grandissait
  de 32 px à l'allumage en poussant les lignes du dessous. Il est rendu pour toute lampe qui a la
  capacité `brightness`, en `visibility: hidden` et inactif quand elle est éteinte : toutes les lignes
  font 93 px, allumées ou non (mesuré).

### Mise à jour 2026-09-10 — « n en lecture » dans l'en-tête

Le résumé de l'en-tête (`composables/useHomeSummary.ts`) compte aussi les lecteurs qui jouent, entre
les ouvrants et la température : « 0 en lecture » dès qu'un lecteur existe, comme les lumières et les
volets. Clé `summary.playing`, sans pluriel en français (« 1 en lecture », « 3 en lecture »).

### Mise à jour 2026-09-10 — un lecteur qui ne dit presque rien

Trois règles du bloc « en cours » (`MediaPlayerControl.vue`), tirées d'une lecture dans une appli de vidéo sur
une TV (`../3_plugins/3_6_google-cast.md`) :

- **Sans titre, on nomme l'appli**, tout de suite et sans plus. Le repère d'attente « … » qui pulsait
  sur la première ligne est retiré : il tournait sans fin pour une appli qui ne publiera jamais de
  titre (certaines applis de vidéo natives de la TV), et pour le vrai cas d'attente — métadonnées en retard d'une
  seconde à un changement de morceau — le nom de l'appli est de toute façon ce qu'on affichait juste
  en dessous. Une ligne de moins qui bouge, une information de plus.
- **Les temps s'affichent dès qu'une position est connue**, même sans durée : le total reste vide et
  garde sa place. Avant, « pas de durée » cachait les deux temps, alors que la position d'un direct ou
  d'une appli de TV est une information (« 9:12 »).
- **Le curseur, lui, reste caché sans durée** (rien à parcourir), et sa place reste réservée.

Le statut d'une ligne de liste suit la même idée (`lib/deviceState.ts`) : en lecture sans titre, la
source complète le libellé — « Lecture · <nom de l'appli> » plutôt que « Lecture » seul.

Quatre tests montés sur le composant (`MediaPlayerControl.test.ts`) : nom de l'appli sans « … », temps
seul avec une durée absurde, deux temps et curseur actif sur une vraie durée, quatre lignes tenues au
repos.

### Mise à jour 2026-09-10 — un direct : précédent, suivant et curseur grisés

Ce qui joue peut être un **direct** (radio, chaîne d'info) : l'état le dit désormais
(`nowPlaying.live`, voir `../1_architecture/1_1_contrat-appareils.md`). Il n'a ni piste voisine ni
début où revenir, donc précédent, suivant et le curseur de position sont grisés — dans le panneau
appareil (`MediaPlayerControl.vue`) **comme dans la vue Médias** (`MediaView.vue`), qui portait la
même touche active.

Lecture / pause, sourdine et volume restent actifs : eux marchent sur un direct. Les touches ne
disparaissent pas, elles se grisent — la rangée garde sa forme, comme partout ailleurs.

Le grisage vaut pour le confort et la lisibilité ; c'est le plugin qui protège vraiment l'appareil, en
refusant la commande (un appui a suffi à couper le direct de la cuisine, voir
`../6_faq/6_1_pieges-runtime.md`). Deux tests de plus sur le composant, qui portent son total à six :
touches grisées sur un direct sauf lecture / pause, et actives sur un morceau ordinaire.

### Mise à jour 2026-09-10 — « en diffusion » plutôt que « en lecture », et l'icône du rail

**Le vocabulaire.** « En lecture » vient du monde du morceau de musique, qu'un téléviseur affichant
une série ne « lit » pas vraiment — et la catégorie Médias regroupe maintenant enceintes, téléviseurs
et écrans connectés. Les formulations « N en lecture sur T » (2026-09-09) et « n en lecture »
(2026-09-10, ci-dessus) **ne sont plus celles de l'app depuis le 2026-09-10** :

- `summary.playing` : « {n} en diffusion » (en-tête, toujours sans pluriel en français) ;
- `media.summary` : « {playing} en diffusion sur {total} » (vue Médias) ;
- `media.nothing` : « Rien en diffusion » (titre du bloc « en cours » sans morceau).

Retenue la forme **nominale** plutôt que « 3 diffusent » : elle garde la grammaire des autres
compteurs, tous des syntagmes nominaux (« {n} volets ouverts », « {n} stores baissés »), et elle
survit à la seconde phrase — « 3 en diffusion sur 12 » se lit, « 3 diffusent sur 12 » accroche.
L'anglais garde `playing`, qui couvre déjà le téléviseur.

`kinds.media_player` passe de « Enceinte » à « Lecteur » (« Speaker » → « Player »). C'est un
**repli sans appelant vivant** aujourd'hui — `DevicePanel.vue` aiguille explicitement un
`media_player` vers `media.classes.*` (Enceinte / Téléviseur / Écran connecté) — mais il nommerait
une TV « Enceinte » le jour où il servirait.

**L'icône du rail.** L'entrée `media` ne porte plus `speaker` mais `cast` : la mention « icône
`speaker` » de la mise à jour du 2026-09-09 ci-dessus n'est plus exacte. Raisonnement et candidats
écartés dans `4_0_langage-visuel.md`.

Vérifié dans la simulation in-process : « 1 en diffusion » dans l'en-tête, « 0 en diffusion sur N »
sur la vue Médias branchée à une maison réelle, « Au repos · Rien en diffusion » sur une enceinte au repos.
Commit `7ced3c2`.

### Mise à jour 2026-09-10 — « n lecteurs en diffusion » : le compteur nomme ce qu'il compte

L'utilisateur, en relisant l'en-tête : « on a par exemple "1 en diffusion", mais 1 quoi ? ». Toutes
les autres entrées de la ligne de synthèse sont des syntagmes nominaux complets — « 0 lumière
allumée », « 5 volets ouverts », « 2 stores baissés » — et seule celle-là laissait le nom implicite.

`summary.playing` devient donc **« {n} lecteur en diffusion | … | {n} lecteurs en diffusion »**
(anglais : « {n} player streaming | … | {n} players streaming »). Les formes de pluriel manquaient
alors que `useHomeSummary` passait déjà le compte en troisième argument de `t()` — la chaîne
précédente les ignorait simplement.

« Lecteur » plutôt que « média », « enceinte » ou « appareil » : c'est déjà le nom du kind dans l'app
(`kinds.media_player`, cf. la mise à jour du 2026-09-10 ci-dessus), il reste juste d'une enceinte à
un téléviseur, et il nomme l'**appareil** — c'est bien lui qu'on compte, pas le contenu, ce qui
écartait « média ». « Enceinte » serait faux dès qu'une TV ou une barre de son diffuse, et le parc
réel en compte ; « appareil » est toujours vrai mais ne dit rien.

Les deux autres formulations « en diffusion » de la vue Médias (`media.summary`, `media.nothing`) sont
inchangées : leur sujet est nommé par la phrase qui les porte.

### Mise à jour 2026-09-10 — une barre de son qui joue le son d'une TV : « Son de TV Salon · titre »

Quand la maison lie une TV à une barre (`meta.audioOutput`) et que la TV joue en envoyant son son ailleurs
(`../1_architecture/1_5_scene-3d.md`, `apps/web/src/lib/audioRouting.ts`, `house.relaySource(id)`), la barre
est montrée **active** : icône teintée et point pulsant (`RoomPanel`, `RoomBands` donc vue Médias, `PulseDot`
de la vue Médias), statut `relayLabel` = « Son de TV Salon · titre » (clé `media.relaying`, « Sound from
{name} »). Panneau appareil de la barre : la grande valeur est le **titre entendu** (celui de la TV), le
contrôle dit « Son de TV Salon » à la place de « Rien en diffusion » (prop `relayFrom` de
`MediaPlayerControl`, passée à travers `DeviceControl` en attribut). Ce qui ne change PAS, à dessein :
l'interrupteur et les touches de transport restent ceux de la barre (elle n'a pas de session à mettre en
pause ; le volume, lui, est bien le sien) ; la pochette reste sur la TV ; le compteur « n lecteurs en
diffusion » de l'en-tête ne compte que les lectures propres (décision de l'utilisateur).

**Révision le même jour** — après un premier essai où la barre était active mais non cochée et non
comptée, l'utilisateur tranche : « il faut activer les 2 appareils dans l'app et l'indiquer dans le
header ». Désormais la barre qui relaie est **cochée** (`RoomPanel`, `DevicePanel`) et son interrupteur,
comme la touche lire / pause de la vue Médias, agit sur la **TV** (`toggleCommand` de l'état de la TV,
envoyé à son id — c'est elle qu'on entend, la barre n'a pas de session) ; précédent / suivant restent
grisés (file de la barre). La **pochette de la TV** sert de fond à la ligne de la barre (`RoomPanel`,
slot `backdrop` de la vue Médias via `heard(entry)`) et au haut de son panneau. Les compteurs comptent
**les deux** : « n lecteurs en diffusion » de l'en-tête (`useHomeSummary.playing`), « n en diffusion sur
total » de la vue Médias, « n actifs » d'une pièce (`HomePanel.counts`). Ce paragraphe remplace la
phrase « ce qui ne change PAS » ci-dessus pour l'interrupteur, la pochette et le compteur.

### Mise à jour 2026-09-20 — champ URL du panneau lecteur

Quand l'appareil déclare la capacité `play_url`, `MediaPlayerControl` montre un champ
(placeholder `media.urlPlaceholder`) et un bouton lire (`media.playUrl`) : entrée →
`media_player.play_url`. Absent de la vue Médias en bandes (télécommande seule) — le geste
vit dans le panneau détail. Sources : `MediaPlayerControl.vue`, `lib/optimistic.ts`.

### Mise à jour 2026-09-20 — vue YouTube Music

Entrée rail juste après Médias (`nav.ytmusic`, icône `music`) → `/ytmusic` : recherche, Likes,
Playlists, sélecteur des lecteurs `play_url`, touche Jouer. Carte cookie dans Réglages
(`YtmusicLinkCard`). Badge « non officiel ». Au montage : `plugins.load()` + statut cookie
(sinon faux « manquant » hors Réglages). Sources : `YtmusicView.vue`, `navItems.ts`,
`../3_plugins/3_16_ytmusic.md`.

*(Dépassé le 2026-09-22 : cette vue est devenue la page « Musique » — clé `nav.music`, route `/music`, `views/MusicView.vue` ; `/ytmusic` redirige vers `/music` (`apps/web/src/router/index.ts`) — voir « Mise à jour 2026-09-22 — la page Musique remplace la page YouTube Music ».)*

### Mise à jour 2026-09-20 — recherche classée ytmusic

Colonnes Artiste / Album / EP / Compil / Titre (280 px, ellipsis), `PlayButton`, tris pertinence /
A–Z / date, badge Explicit, `ArtThumb` (`referrerpolicy=no-referrer` contre ORB). Persistance
`kasbah.ytmusic.*`. Détail : `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-21 — layout lignes + masquer explicites

Ligne 1 = titre (+ E) ; ligne 2 = meta + durée + année. Switch client « masquer les explicites »
(`kasbah.ytmusic.hideExplicit`). Détail catalogue / vidéos / Best of : `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-21 — ytmusic après météo, play → 3D, plus de langue au rail

- Ordre rail : Maison → Météo → **YouTube Music** → … (`navItems.ts`).
- Après `ytmusicPlay` réussi : `router.push(home)` puis `selectDevice` (nav d'abord, comme
  sonnette / placement — éviter la course d'URL keep-alive).
- Bouton langue retiré du `NavRail` (Réglages seuls).

> **Périmé depuis le 2026-09-22** : un play **ne navigue plus** (vérifié dans
> `MusicView.vue : play()`). La navigation + `selectDevice` a été déplacée sur la touche « Voir dans
> la maison » de chaque ligne du panneau Écoute (`locate()`), qui garde la règle « nav d'abord ».
> Voir « Mise à jour 2026-09-22 — la page Musique remplace la page YouTube Music » en fin de page.

### Mise à jour 2026-09-22 — médias : plus d'URL manuelle ; TV : diagonale en pouces ; onglet de niveau

- **Champ URL retiré** du panneau lecteur (`MediaPlayerControl`) : `play_url` reste pour YouTube
  Music et les plugins, plus de saisie manuelle dans le détail. Remplace la mise à jour du
  2026-09-20 « champ URL du panneau lecteur » ci-dessus.
- **Taille d'une TV** dans Emplacement → Déplacer : une ligne **Diagonale** (pouces, pas 1″,
  bornes 20–100, défaut 45″). Conversion 16:9 → `HouseDevice.size` en mètres
  (`tvSizeFromInches` / `tvInchesFromSize` dans `lib/orientation.ts`). Les ouvrants libres gardent
  largeur × hauteur / avancée.
- **Onglet de niveau** : `setFloorTab` désélectionne l'appareil (sauf mode Déplacer). Sinon
  `frameSelection` → `focusDevice` → `focusLevel` de la pièce de l'appareil annulait le niveau
  demandé. Voir `../6_faq/6_1_pieges-runtime.md`.

Sources : `MediaPlayerControl.vue`, `PlacementControl.vue`, `lib/orientation.ts`,
`stores/house.ts`, `i18n/locales/{fr,en}.json` (`place.size.diagonal`).

### Mise à jour 2026-09-22 — la page Musique remplace la page YouTube Music

Le rail n'a plus d'entrée « YouTube Music » mais **« Musique »** (`nav.music`, icône `music`, même
place : Maison → Météo → Musique). La route `/ytmusic` **redirige** vers `/music` et
`YtmusicView.vue` a disparu au profit de `MusicView.vue` + `components/music/`. Le renommage porte
une décision : la page est celle de la musique de la maison, pas celle d'un fournisseur — d'où une
**rangée de pastilles de sources** en en-tête (une seule reliée aujourd'hui, avec son point d'état).

**Trois zones fixes**, jamais réorganisées :

1. **Au centre**, la recherche puis le catalogue. Deux modes, mémorisés (`kasbah.music.advanced`) :
   - *simple* : des **rangées de tuiles** (`MusicTile` : grande pochette, deux lignes de hauteur
     fixe) Artistes / Albums / Titres, 12 par rangée, avec « Voir tout » qui bascule en avancée ;
   - *avancée* : les **cinq colonnes** triables héritées de la vue précédente (artistes, albums,
     EP, compilations, titres).
   Sans recherche, la zone sert à **parcourir** : Récents (les 20 derniers titres joués, mémoire du
   navigateur) / Likes / Playlists. `ChipRow` porte les recherches récentes, effaçables, et garde sa
   hauteur même vide. `MusicItemRow` unifie les lignes de catalogue (pochette, titre + badge
   explicite, méta, durée, année).
2. **À droite, le panneau « Écoute »** (`ListeningSessions.vue`) : **un lecteur `media_player` = une
   session**. La ligne choisie est celle que pilote le lecteur du bas et là où partent les lectures.
   Un filtre segmenté restreint aux enceintes / téléviseurs / écrans d'après
   `meta.mediaPlayer.deviceClass` (une option sans porteur est grisée, pas cachée). Tri
   **alphabétique**, les **favoris** groupés au-dessus (étoile par ligne,
   `localStorage kasbah.music.favoriteSessions` — même clé que le choix du lecteur par défaut au
   premier chargement). Trois touches de largeur fixe par ligne : lecture / pause du lecteur
   (**invisible** s'il n'a rien de chargé, sa place restant prise), **« Voir dans la maison »** et
   l'étoile. Une ligne qui joue porte sa **pochette en fond**, fondue vers la droite ; les textes
   trop longs défilent (`MarqueeText`).
3. **En bas, le lecteur** (`MusicPlayerBar.vue`) : le morceau à gauche, transport et position au
   centre, volume et lecteur à droite. Détail des empreintes : `4_0_langage-visuel.md`.

**Mode transfert** : la touche « Transférer » du lecteur transforme le panneau Écoute en sélecteur de
cible — les lignes capables de recevoir un flux (`play_url`) montrent **« Ici »** à la place des deux
premières touches, la source reste visible mais grisée, et la touche de la barre devient
**« Annuler »** (même emplacement, même largeur). Elle n'est active que pour une lecture **lancée
depuis Kasbah** (`GET /sessions`) : une appli native sur un Chromecast n'est pas transférable, et
l'infobulle le dit.

**Ce qui a été retiré** : les toasts de succès au lancement et au transfert. Ils passaient
par-dessus le lecteur, qui montre déjà le résultat (titre en attente + sablier). Les erreurs restent
des toasts. Et « Voir dans la maison » **navigue d'abord, sélectionne ensuite**
(`router.push` puis `selectDevice`) — la course d'URL sous keep-alive est toujours là (`6_1`).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/*.vue`,
`apps/web/src/lib/navItems.ts`, `apps/web/src/router/index.ts`, `i18n/locales/{fr,en}.json`
(`nav.music`, `music.*`), `../3_plugins/3_16_ytmusic.md`.

### Mise à jour 2026-09-22 (2) — le curseur du lecteur déplace vraiment l'enceinte

Le même jour, le proxy ytmusic a changé de modèle (« fichier » MP3 de taille connue,
`../3_plugins/3_16_ytmusic.md`). Rien ne bouge dans la **disposition** de la page Musique — les trois
zones, le mode transfert et les empreintes sont inchangés — mais quatre choses se simplifient,
et ça se voit à l'usage :

- **Le curseur de position** envoie désormais la commande `media_player.seek` du lecteur, comme dans
  la vue Médias : plus de relance de flux, donc **plus de coupure de son** au relâcher. Il est
  actif dès que le lecteur déclare la capacité `seek` et qu'une durée est connue — la question « ce
  flux est-il à nous ? » ne se pose plus.
- **La pause et la reprise** sont celles du lecteur : une vraie pause Sonos, puis **un seul `Play`**
  pour repartir où on en était. Ni le serveur ni la page n'ont plus à retenir quoi que ce soit entre
  les deux.
- **Le panneau « Écoute »** écarte aussi une **source** illisible, et plus seulement un titre
  illisible : une ligne de repli affichait l'URL du proxy ou un identifiant hexadécimal là où on
  attend un nom de source. Même règle que pour le titre (`readable()`), posée une fois.
- **Ce qui reste montré par la session** et non par l'enceinte : titre, artiste, pochette, et la
  **durée** quand le lecteur ne la publie pas (constat live : le Sonos ne la publie pas sur ce flux).

Sources : `apps/web/src/components/music/{MusicPlayerBar,ListeningSessions}.vue`,
`apps/web/src/views/MusicView.vue`, `../1_architecture/1_4_app-web.md`.

### Mise à jour 2026-09-22 (3) — le pouce du curseur ne rebondit plus, et les deux lecteurs se comportent pareil

Correction ciblée de fin d'après-midi, **sans rien changer à la disposition** : ni la barre de
`/music` ni la carte lecteur du panneau appareil ne gagnent ou ne perdent un pixel.

Ce qu'on voyait : on clique à 2:00 dans le curseur, et la lecture « passe par un autre endroit »
avant d'y arriver — le pouce revenait une fraction de seconde à l'ancienne position. En pause, le
timecode oscillait. Les deux viennent du **sondage** : le lecteur ne pousse pas sa position, et le
relevé qui suit immédiatement le geste date d'**avant** lui (mécanique détaillée dans
`../1_architecture/1_4_app-web.md`).

Ce qui change à l'usage :

- **Après un déplacement, le curseur reste sur la valeur demandée** jusqu'à ce que le lecteur
  publie une position plus proche de la cible que du point d'où l'on venait. Un relevé périmé ne
  fait donc plus reculer le pouce, et un déplacement d'une **seconde** tient lui aussi — c'est le
  cas qu'une simple « distance minimale » aurait laissé passer.
- **En pause, le timecode est stable** : il se fige à la valeur affichée et ignore un relevé qui
  s'en écarte de moins de 2,5 s, tout en suivant un vrai saut (seek, transfert).
- **Le panneau appareil se comporte exactement comme la barre Musique** : il partageait le
  vocabulaire, il partage maintenant le code (`useMediaPosition`, `useSeekHold`). Son ancienne copie
  recalait la position sur le relevé périmé au passage en pause — c'est ce qui donnait deux
  comportements pour un même curseur selon la page où on se trouvait.
- **Changer de lecteur** (autre session, autre appareil) relâche la valeur tenue : on n'hérite pas
  de la cible visée sur l'enceinte précédente.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/components/controls/MediaPlayerControl.vue`,
`apps/web/src/composables/useMediaPosition.ts`, `../1_architecture/1_4_app-web.md`,
`../6_faq/6_1_pieges-runtime.md`.

### Mise à jour 2026-09-22 (3) — badge explicit, qualité du flux, volume au fil du geste

**Badge explicit** (`components/ui/ExplicitBadge.vue`, le même carré « E » que les lignes de
recherche) à trois endroits, qui lisent tous `nowPlaying.explicit` :

- barre de lecture de la page Musique, contre le titre ;
- panneau « Écoute », sur la ligne du morceau (légèrement réduit, `scale(0.85)`) ;
- détail d'un appareil dans la vue 3D (`MediaPlayerControl.vue`), sur la ligne artiste / album.

PIÈGE relevé à l'usage : dans la barre, le badge doit suivre la MÊME source que le titre et la
pochette. Entre le clic et le premier octet servi il s'écoule quelques secondes (résolution yt-dlp),
pendant lesquelles la barre montre déjà le titre du CATALOGUE (`pending`) : en lisant l'état du
lecteur, le badge arrivait en retard sur un titre explicit, puis RESTAIT allumé sur le titre suivant
— qui ne l'était pas — jusqu'au démarrage du flux. Il lit donc `pending.explicit` tant qu'un envoi
est en cours, l'état ensuite.

**Qualité du flux** : une ligne discrète sous le nom du lecteur, dans la colonne de droite de la
barre (`MP3 320 kb/s`), avec en info-bulle l'échantillonnage, le nombre de voies, la taille annoncée
et le format reçu de YouTube (« source M4A 258 kb/s »). Emplacement de largeur fixe (96 px) TOUJOURS
rendu, insécable quand rien de nous ne joue : la colonne ne bouge pas quand la lecture part.

**Volume** : le curseur applique le réglage pendant le glissement (détail dans
`../1_architecture/1_4_app-web.md`).

Sources : `apps/web/src/components/ui/ExplicitBadge.vue`,
`apps/web/src/components/music/{MusicPlayerBar,ListeningSessions}.vue`,
`apps/web/src/components/controls/MediaPlayerControl.vue`,
`apps/web/src/components/music/MusicPlayerBar.test.ts`.

### Mise à jour 2026-09-22 (4) — reculer / avancer de 10 s dans le lecteur fixe

Deux touches encadrent la touche lecture : `↺ 10` et `↻ 10` (flèche circulaire avec le pas EN SON
CENTRE, comme sur les lecteurs de podcast). Le pas est écrit PETIT — 8 px dans une flèche de 24 :
à 10 px les deux chiffres remplissaient le cercle bord à bord et l'ensemble devenait une tache. La rangée reste symétrique — emplacement fantôme,
piste précédente, −10, lecture, +10, piste suivante, stop (*l'emplacement fantôme est devenu la
touche Répéter le soir même, cf. « (6) » plus bas*) — donc la touche lecture est toujours au
centre exact de l'ÉCRAN : mesuré à 1280 (640 px) et à 1920 (960 px), rangée de 322 px dans une
colonne centrale qui en fait 340 au minimum.

Le saut passe par le MÊME chemin qu'un déplacement au curseur (`useSeekHold` puis `media_player.seek`
vers le lecteur) et part de la position AFFICHÉE : deux appuis rapides s'additionnent (100 → 110 →
120) au lieu de retomber deux fois sur un relevé qui n'a pas encore bougé. Bornes : jamais avant 0,
jamais au-delà de la durée. Les deux touches sont grisées quand il n'y a rien à parcourir (direct,
lecteur au repos, appareil sans capacité `seek`) — comme le curseur lui-même.

Le pas est la constante `SEEK_STEP_S` du composant, reprise dans le libellé (`media.jumpBack` /
`media.jumpForward`, paramètre `{seconds}`) : changer la constante change l'info-bulle.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/components/music/MusicPlayerBar.test.ts`,
`apps/web/src/composables/useMediaPosition.ts`.

### Mise à jour 2026-09-22 (5) — touches de transport OBLONGUES, et l'attente d'une recherche

**Des touches plus larges, pas plus hautes.** La taille des touches est bornée par la HAUTEUR de la
barre (92 px), qui empile la rangée et le curseur de position : 42 px de haut (lecture 50) est ce qui
y tient. On agit donc sur la largeur — `--key-w: clamp(42px, calc(5.2vw - 24px), 84px)` — car c'est
l'espace libre entre le morceau (à gauche) et le volume (à droite) qui la borne : ~376 px à 1280,
~682 px à 1920. Résultat mesuré : 43 × 42 à 1280 (la rangée y touche déjà ses voisines, rien à
gagner), **76 × 42 à 1920**, soit le double de la largeur d'origine. L'icône se règle sur la HAUTEUR
(`height: 46%; width: auto`) : en pourcentage des deux côtés elle s'étirait avec la touche.

La rangée porte `width: var(--center-w)` et `justify-content: center` : quand elle déborde (écran
étroit), elle déborde des DEUX côtés à égalité et la touche lecture reste au centre exact de l'écran
— vérifié à 1280 (640) et à 1920 (960). Sans ça elle partait du bord gauche de la colonne et lecture
glissait de 5 px.

**L'attente d'une recherche.** Une recherche prend plusieurs secondes (InnerTube) : les résultats
précédents sont maintenant VIDÉS dès l'envoi, et la zone montre des squelettes à la forme des tuiles
à venir (trois rangées de sept, `.skel`, respiration de 1,4 s coupée par `prefers-reduced-motion`),
plus une ligne `role="status"` « Recherche en cours… ». Garder les anciens résultats laissait croire
que le clic n'avait pas pris — ou pire, que c'était la réponse. Vérifié en direct : 21 squelettes et
aucune tuile de résultat pendant l'attente, 27 tuiles et plus un squelette à l'arrivée.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-22 (6) — la file d'attente dans la page Musique

La file vit sur le **serveur**, une par lecteur (mécanique, fin de piste et répétition :
`../3_plugins/3_16_ytmusic.md`, « Mise à jour 2026-09-22 (5) »). La page ne fait que la remplir, la
montrer et la piloter. Non commitée au moment de l'ingestion.

**Jouer un titre, c'est jouer sa liste.** Un clic sur un titre d'une liste — album ou playlist
ouverts, Likes, Récents, titres de la recherche (tuiles du mode simple comme lignes de l'avancé) —
le lance, et **toute la liste devient la file à partir de lui** (`play(track, list)` →
`ytmusicQueuePlay`). Une liste plus longue que les 1000 titres qu'accepte le serveur est envoyée par
**fenêtre** (`QUEUE_WINDOW`) : jusqu'à 100 titres avant celui choisi, et la suite. L'en-tête du détail
d'un album / d'une playlist gagne une pastille **« Tout lire »** (depuis le premier titre).

*(Dépassé le 2026-09-22 : la méthode du transport s'appelle `musicQueuePlay` (`apps/web/src/api/transport.ts`), la page Musique n'étant plus propre à YouTube Music.)*

**Compléter sans interrompre.** Chaque ligne de titre (`MusicItemRow`, prop `queueable`) porte deux
petites touches **fixes** devant le bouton play — « Lire ensuite » (`queueNext`) et « Ajouter à la
fin » (`queueAdd`) — jamais au survol : rien ne bouge. Les tuiles du mode simple (`MusicTile`) ne les
ont **pas encore**. Rien ne joue depuis Kasbah sur ce lecteur ? L'ajout lance la lecture (réponse
`started`). Pas de toast de succès : le retour est la **pastille** de la touche File.

**La vue File remplace la zone centrale**, ouverte par la touche File de la barre (fermée par
« Retour », ou en changeant d'onglet Parcourir). Le titre qui joue est surligné et amené sous les
yeux à l'ouverture ; un clic sur une ligne y saute (`/queue/jump`). Chaque ligne a sa touche de
retrait (`removable`) — **masquée sur le titre courant mais sa place gardée** (`visibility: hidden`),
le serveur refusant de retirer ce qui joue. « Vider la file » garde le titre en cours, seul.

**La barre** (`MusicPlayerBar.vue`) :

- **Précédent / suivant** sont pilotés par la file quand la session en a une : `MusicView` intercepte
  `media_player.next` / `previous` et appelle les routes de file (l'enceinte n'a qu'un titre).
  Suivant est grisé en bout de file ; précédent reste actif au premier titre (il ramène au début).
  Sans file, on retombe sur la capacité `track_skip` du lecteur, comme avant.
- **Répéter** prend l'emplacement qui répond à Stop — celui qu'occupait jusqu'ici un
  **emplacement fantôme** (`key--ghost`, section « (4) » ci-dessus) : la rangée reste symétrique et
  lecture pile au centre. Un appui fait tourner `off` → `once` → `loop` → `off` ; le pas s'écrit au
  centre des flèches (« 1 » ou « ∞ », comme le « 10 » des sauts ; classe `key--repeat`). Grisée sans
  file.
- **La touche File** est posée **au bout de la zone du morceau**, pas dans la colonne de droite : à
  1280 px, volume + lecteur + Transférer la remplissent déjà. Sa **pastille** (titres en attente,
  « 99+ » au-delà) est posée **sur le coin**, en `position: absolute` : elle n'élargit rien quand elle
  apparaît.

**Suivre l'enchaînement automatique.** Le serveur enchaîne seul ; la page relit donc `GET /sessions`
**800 ms** après tout changement de lecture ou de titre du lecteur choisi, plutôt qu'au prochain tour
de 20 s — le délai laisse au serveur le temps de finir de lancer le titre suivant. La file elle-même
est relue dès que la session annonce un autre index, une autre longueur ou une autre répétition.

Nouvelles icônes `repeat`, `queueNext`, `queueAdd` (`lib/strokeIcons.ts` ; la touche File reprend
`list`). Clés i18n `music.queue*`, `music.playAll`, `music.playNext`, `music.addToQueue`,
`music.repeatOff` / `repeatOnce` / `repeatLoop` (fr / en).

Vérifié en direct sur un Sonos (selon la session) : suivant, cycle de répétition, lire
ensuite, retrait, vider.

**Défaut connu, antérieur, non corrigé** : dans la colonne de droite de la barre à 1280 px, la boîte
du nom du lecteur (96 px) déborde sur la pastille Transférer, et le « 12 » du volume chevauche le
bloc du lecteur d'environ 4 px. Relevé pendant la session, pas mesuré de nouveau ici.

Sources : `apps/web/src/views/MusicView.vue`,
`apps/web/src/components/music/{MusicPlayerBar,MusicItemRow}.vue`,
`apps/web/src/components/music/MusicPlayerBar.test.ts`, `apps/web/src/lib/strokeIcons.ts`,
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-22 (7) — jouer un album ou un artiste d'un geste, lecture au survol sur la pochette

**Lecture sur la pochette** (`components/music/ArtPlay.vue`) : le bouton plein en bout de ligne
(`PlayButton.vue`, supprimé) est remplacé par un cercle au trait (1,5 px blanc) sur un voile sombre
translucide, centré sur la pochette — 48 px sur une tuile de 128, 30 px sur la vignette de 44 d'une
ligne. Lisible sur n'importe quelle image, sans aplat de couleur ; au survol du cercle lui-même, il
prend l'accent. Grisé par le trait (pas par l'opacité, qui appartient au parent).

**Au survol seulement** : sous `@media (hover: hover)`, le cercle ET les touches de file (« Lire
ensuite », « Ajouter à la fin ») d'une ligne sont à `opacity: 0` et apparaissent au survol ou au focus
de la tuile / de la ligne ; le cercle reste visible pendant l'envoi (`aria-busy`, sablier). Leur place
est gardée : rien ne bouge. Sur un écran **sans survol** (tactile), tout reste affiché en permanence —
sinon rien ne serait jouable ; c'est le cercle au trait qui rend l'écran moins chargé qu'avant.
Révélation écrite côté parent par `:deep(.art-play)` (pas de `:global`, cf. le piège du sélecteur
global dans un style scoped).

**Album et artiste jouables** (`playable` sur `MusicTile` et `MusicItemRow`) : tuiles de la recherche
simple et lignes des colonnes Artistes / Albums / EP / Compilations de la recherche avancée. Le cercle
lance `playCollection` : les titres de l'album (`ytmusicAlbum`) ou de l'artiste (`ytmusicArtist`),
filtrés par « Masquer explicit », deviennent la file depuis le premier ; le reste de la tuile ou de la
ligne ouvre le détail, comme avant (le clic du cercle ne remonte pas — verrouillé par
`MusicTile.test.ts`). Les playlists n'ont pas (encore) de cercle : non demandé.

**Structure** : la racine d'une tuile ou d'une ligne qui s'ouvre est désormais un `div` avec
`role="button"`, `tabindex` et Entrée / Espace — un bouton de lecture ne peut pas vivre dans un
`<button>` (HTML invalide).

Vérifié dans la preview (1280×800, sombre) sur un Sonos de test : pochettes nettes au repos,
cercle au survol, un album lancé depuis sa tuile (premier titre, une dizaine de titres en attente, pochette et
artiste reçus par l'enceinte), un artiste lancé depuis sa tuile sans quitter la recherche (file de
plusieurs dizaines de titres).

Sources : `apps/web/src/components/music/{ArtPlay,MusicTile,MusicItemRow}.vue`,
`apps/web/src/components/music/MusicTile.test.ts`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-22 (8) — le « E » explicit sur les tuiles de la recherche simple

Les tuiles d'album et de titre n'avaient jamais porté le marquage (seules les lignes, le lecteur du bas
et le panneau Écoute l'affichaient). `MusicTile` gagne `explicit` : le même `ExplicitBadge` que le
lecteur, posé à droite du titre sous la pochette (`.tile__line1`, flex) — c'est le titre qui se
raccourcit, la tuile garde sa hauteur (172 px avec ou sans badge, mesuré sur une recherche d'artiste : la plupart
des tuiles Album et Titre en portent un). Pas de badge sur un artiste (non marqué par le
catalogue). Test : `MusicTile.test.ts`.

Sources : `apps/web/src/components/music/MusicTile.vue`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-22 (9) — onglets Genres et Ambiances

« Parcourir » gagne deux onglets (`browseTab` : `genres`, `moods`). **Genres** : la rangée « Pour vous »
(si YouTube en donne) puis les 25 genres ; **Ambiances** : les humeurs et moments. Des pastilles de
hauteur FIXE (52 px, grille `auto-fill minmax(176px, 1fr)`), liseré gauche de 6 px à la couleur de
YouTube Music (`--cat`) — pas en aplat : ces couleurs sont pastel (#a4ffa4, #cccccc…) et rendraient le
texte illisible en sombre ; survol teinté à 16 %. Nom trop long coupé (ellipsis, `title`). Squelettes
de pastilles pendant le chargement. Noms dans la langue de l'app (`hl = locale`), relus seulement si
la langue change.

**Page d'une catégorie** (`browse.kind === 'category'`) : rangées de tuiles avec le titre de chaque
rangée ; titres jouables (la rangée devient la file), playlists et albums qui s'ouvrent ou se jouent
d'un geste (`playPlaylist`, `playAlbum` — même `playCollection`). « Masquer explicit » s'applique, une
rangée vidée disparaît. **Retour** : ce qui est ouvert DEPUIS une catégorie y revient (`backStack`,
rangées gardées en mémoire), puis à la grille. Vérifié dans la preview (1280×800) : 31 pastilles de
52×190 px, Jazz (Titres / Sélection de playlists / Albums), double retour, une playlist
lancée depuis Calme sur un Sonos de test (file de plusieurs dizaines de titres).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-22 (10) — cartes de genres et d'ambiances

Les pastilles de la section « (9) » deviennent des CARTES à la manière de « Parcourir » de Spotify :
108 px de haut, grille `auto-fill minmax(208px, 1fr)`, fond en dégradé de la couleur de la catégorie
ASSOMBRIE (`color-mix` avec #0b0d12, halo radial dans le coin) — même carte dans les deux thèmes, comme
une vignette ; nom en 17 px gras, deux lignes au plus (`line-clamp`), à gauche. Deux pochettes
inclinées (22° devant, −10° derrière, ombrées) dépassent du coin bas-droit ; au survol elles se
redressent un peu, la carte s'éclaircit. Les cartes s'affichent d'abord ; `ytmusicExploreCovers` arrive
ensuite, chaque pochette n'apparaît (fondu 0,35 s) qu'une fois chargée (`@load`) — emplacement absolu,
rien ne bouge. PIÈGE retrouvé : `<img referrerpolicy="no-referrer">` obligatoire pour les pochettes
Google (cf. `ArtThumb`), sinon image vide. Vérifié en sombre et clair à 1280×800 (12 ambiances, 31
genres, toutes avec leurs deux pochettes).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`.

### Mise à jour 2026-09-23 (11) — onglet Nouveautés, numéros, lecture des playlists, « Avancée »

- **Nouveautés** : nouvel onglet de « Parcourir », entre Playlists et Genres (six options). Rangées de
  la page de YouTube : la playlist phare en tête, puis TOUS les albums et singles récents (~185), en
  GRILLE (`MusicShelves grid` : `repeat(auto-fill, 128px)`, passage à la ligne) et non en rangée
  défilante. « Retour » depuis un album ouvert ici ramène aux Nouveautés.
- **`MusicShelves.vue`** : les rangées de tuiles (titres jouables en file, playlists et albums
  ouverts ou joués) sont un composant partagé par la page d'une catégorie et les Nouveautés ; une
  rangée sans titre prend le nom de ce qu'elle contient.
- **Numéros** `#1, #2…` (`MusicItemRow position`) dans la file, le détail d'une playlist / d'un album /
  d'un artiste et les Likes (pas les Récents, dont l'ordre ne signifie rien). Colonne de 38 px FIXE :
  en `ch` elle suivait la graisse et la ligne en cours (numéro en gras, couleur d'accent) décalait sa
  pochette d'un pixel. Rang dans la liste AFFICHÉE (« Masquer explicit » renumérote).
- **Lignes de playlists jouables** (onglet Playlists) : cercle de lecture au survol, comme les tuiles.
- **« Avancée » grisée sans recherche affichée** : elle ne règle que la présentation des résultats ; le
  choix reste mémorisé et revient à la recherche suivante, largeur inchangée.

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/{MusicShelves,MusicItemRow}.vue`,
`apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-23 (12) — détail d'album / de playlist / d'artiste à la YouTube Music

Le détail n'est plus une liste pleine largeur : **colonne de gauche** (208 px) avec la pochette en
grand (176 px, ronde pour un artiste), le titre (2 lignes au plus), l'artiste, « E · Album · 2012 »
(type de sortie : Album / Single / EP / Compilation, ou Playlist / Artiste), « 8 titres · 33 min »
(durée calculée sur la liste affichée) et une grande touche de lecture (52 px, lance tout) ; **titres
à droite**. Un voile flou de la pochette (`blur(60px)`, opacité .24, masque en dégradé) en fond. La
colonne reçoit ce que la liste d'origine savait de l'élément (`DetailHead` dans `Browse`).

**Titres d'un album sans vignette** (`MusicItemRow artless`) : la même pochette partout ne s'y répète
plus. Le numéro devient ▶ au survol (sablier pendant l'envoi) et la ligne ENTIÈRE se joue (clic,
toucher, Entrée) — c'est le geste des écrans tactiles, qui n'ont pas de survol. Touches de file
inchangées (elles ne lancent pas le titre). Hauteur de ligne identique avec ou sans vignette (61 px).
Playlists et artistes gardent leurs vignettes (un titre, une pochette).

**PIÈGES rencontrés** : (1) une colonne `sticky` plus haute que la zone de défilement rend sa touche de
lecture inaccessible (on ne peut plus la ramener en vue) — la colonne n'est collante qu'à partir de
760 px de hauteur d'écran, et compactée ; (2) le voile qui déborde de 20 px crée une barre
horizontale — contenu dans la zone, et `overflow-x: clip` (pas `hidden`, qui casserait le `sticky`).
Vérifié à 1280×800 sombre et clair : un album, une playlist, un artiste ; clic sur une
ligne d'album → la file part de ce titre (Sonos de test).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/MusicItemRow.vue`,
`apps/web/src/components/music/MusicTile.test.ts`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-23 (13) — détail affiné, pochettes nettes et adoucies

- **Colonne de gauche** : pochette qui grandit avec l'écran (`--cover` 208 / 260 / 300 px selon la
  largeur ; `--art` posé en ligne par ArtThumb, remplacé par `!important`), plus d'air, titre 22 px.
  **Fixe tant qu'elle tient en entier** sous « Retour » : la page MESURE la colonne et la zone
  (`useResizeObserver` de VueUse sur les deux ; `sideFits` → `.is-fixed`, `position: sticky; top:
  var(--back-row-h)`) et la laisse défiler sinon (écran bas, présentation dépliée) — plus de seuils
  d'écran devinés. Accrochée à sa place EXACTE de départ (la ligne « Retour » fait `--back-row-h`, sans
  marge dessous), sinon elle glissait de 6 px avant de se fixer. NB : dans la preview en arrière-plan,
  la page ne se redessine pas et un ResizeObserver ne se déclenche pas — forcer un rendu (capture)
  pour vérifier.
- **« Retour » collant** (`.back-row`, toutes les vues à détail) en haut de la zone, sur `var(--bg)` : il ne
  chevauche plus le voile flou (qui commence sous lui) et reste accessible en défilant.
- **Présentation** d'album et d'artiste sous la durée, repliée sur 2 lignes, un clic la déplie ; la
  mention « Source : Wikipedia, licence : Creative Commons… » détachée en petit dessous, sans les URL
  (tronquées par YouTube, parfois sans parenthèse fermante, ou avec leurs propres parenthèses) —
  `lib/wikiCredit.ts` (testé).
- **Pochettes nettes** : le catalogue les livre en 120 px ; `lib/artUrl.ts` (`artAt`, même réécriture que
  `upgradeArtUrl`) les redemande en 600 px pour le détail et en 256 px pour les tuiles de 128 (artistes
  compris). `i.ytimg.com` : jamais `maxresdefault` (absent pour bien des vidéos).
- **Voile sur les pochettes** (`ArtThumb`, demande de l'utilisateur : une page pleine d'images « pète
  les yeux ») : dégradé du haut transparent au bas assombri de 25 %, seulement sur une vraie image, à
  l'arrondi de la pochette qui le porte (`border-radius: inherit`, le détail l'a à 10 px).
- **« E » collé au titre** dans les lignes (`.title` ne prend que sa place).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/ui/ArtThumb.vue`,
`apps/web/src/components/music/{MusicTile,MusicItemRow}.vue`, `apps/web/src/lib/{artUrl,wikiCredit}.ts` (+ tests).

### Mise à jour 2026-09-23 (14) — le titre qui joue, pulsant dans les listes ; colonne compactée

- **Titre en cours signalé** (`MusicItemRow playing`) : le `PulseDot` du panneau Écoute, devant le titre,
  à l'accent. Allumé et pulsant quand le lecteur choisi JOUE ce titre (servi par nous : `nowPlayingId` =
  `videoId` de sa session, `nowPulsing` = `playback === 'playing'`) ; en pause, la ligne reste surlignée,
  le point s'éteint. Sa place est toujours gardée sur une ligne de titre (titres alignés au pixel, allumé
  ou non). Partout où l'on voit des titres : détail, likes, récents, recherche avancée, file. Le surlignage
  suit désormais ce qui JOUE, et non plus le dernier titre lancé depuis la page (`recentPlays[0]`).
- **Colonne de gauche compactée** (~55 px gagnés, la touche de lecture tenait mal à 1920×1080 avec la
  ligne de licence) : type, année, titres et durée sur UNE ligne, marges et touche resserrées.
- **PIÈGE — `MarqueeText` a une largeur naturelle NULLE** (`contain: inline-size`, voulu : un titre long
  n'élargit pas son panneau). Lui donner `flex: 0 1 auto` pour coller le « E » au titre l'a réduit à zéro
  : le titre avait disparu du lecteur du bas. Il garde `flex: 1 1 auto`, et le « E » passe DEVANT lui.

Sources : `apps/web/src/components/music/{MusicItemRow,MusicPlayerBar}.vue`, `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-23 (15) — voile immersif et « Retour » hors de la zone qui défile

- **Voile de la pochette** (`.veil`) : sorti de la zone qui défile, il ne bouge plus quand la liste défile ;
  posé dans un bloc `.main__body` (« Retour » + zone qui défile) — JAMAIS sous la recherche ni les
  recherches récentes (demande de l'utilisateur) — et fondu sur ses QUATRE bords (deux masques croisés,
  `mask-composite: intersect`) : plus aucune démarcation. Rogné dans sa boîte (l'image floue agrandie ne
  déborde pas, pas de barre horizontale).
- **« Retour » hors de la zone qui défile** : une seule ligne pour la file, une catégorie et un détail
  (titre, « Vider la file » selon le cas), au-dessus de la zone. Plus de fond plein qui tranchait le voile,
  et plus rien ne passe dessous ; le haut de la zone qui défile se fond sur 14 px (`main__scroll--under`),
  une ligne qui monte s'y efface. Colonne de gauche collante à `top: 0` ; `sideFits` compare sa hauteur à
  la seule zone qui défile. Écartée en chemin : une vitre dépolie sur « Retour » laissée DANS la zone —
  les titres de la colonne passaient lisibles sous le bouton.

Sources : `apps/web/src/views/MusicView.vue`.

### Mise à jour 2026-09-23 (16) — « Ce navigateur » : la page joue elle-même

Le panneau « Écoute » gagne un lecteur qui n'est aucune enceinte : **« Ce navigateur »** (sous-titre
« Son de cet appareil », icône `tablet`), qui fait jouer la musique par l'appareil qui affiche la page.
Mécanique serveur et pièges audio : `../3_plugins/3_16_ytmusic.md`, « (12) ».

- **Toujours la toute première ligne**, au-dessus même des favoris, dans son **propre groupe sans
  titre** (`ListeningSessions.vue`, groupe `local`) : c'est le lecteur qu'on a sous la main. Il n'entre
  ni dans les favoris ni dans le tri alphabétique.
- **« Voir dans la maison » disparaît** sur cette ligne (le navigateur n'a pas de place dans la 3D),
  mais **son emplacement reste** (`is-hidden`, désactivée, hors tabulation) : les touches des lignes
  restent alignées. La barre du bas montre la même icône `tablet` (`MusicPlayerBar.vue`).
- **Session privée** (choix de l'utilisateur) : les autres écrans ne voient pas cette ligne.
- **Aucun cas particulier d'affichage** : le store présente un `DeviceEntry` synthétique, le panneau
  et la barre le rendent comme les autres. Seules les commandes changent de chemin : `MusicView`
  aiguille lecture, file, transport, déplacement et transfert vers le store quand le lecteur choisi est
  local (`localSelected`), et les touches du panneau passent par `panelCommand`.
- **Transfert** dans les deux sens : le navigateur peut être source (il donne sa position et sa file,
  puis se tait) ou cible (« Ici » sur sa ligne ; il reprend fichier, position et file).
- **Choix du lecteur par défaut** : le lecteur local étant toujours dans la liste, le `watch` qui
  choisit la ligne au premier chargement **attend l'inventaire des appareils** avant de juger un choix
  mémorisé — sinon il l'aurait jugé disparu.
- La musique **continue quand on change de page** : le store vit hors de la vue.

Sources : `apps/web/src/components/music/{ListeningSessions,MusicPlayerBar}.vue`,
`apps/web/src/views/MusicView.vue`, `apps/web/src/stores/localPlayer.ts`,
`i18n/locales/{fr,en}.json` (`music.localPlayer`, `music.localRoom`, `music.localFailed`).

### Mise à jour 2026-09-23 (17) — la page Musique choisit sa source : YouTube Music ou Radios

**Sélecteur de source.** La rangée de pastilles de sources en en-tête (section du 2026-09-22, « une
seule reliée aujourd'hui, avec son point d'état ») est **remplacée** par un `Segmented` en haut à
droite, dans `PageHeader` : « YouTube Music », plus « Radios » si le plugin `radio` est actif
(`plugins.byId.radio?.enabled`). Le choix est mémorisé (`kasbah.music.source`) ; si la source mémorisée
n'est plus active, la page **retombe sur YouTube Music** sans effacer le choix.

Le point « reliée » a disparu avec les pastilles, et pas par oubli : `Segmented` n'affiche que
l'icône quand on lui en donne une (le libellé devient l'infobulle), et un `sublabel` le passe en
disposition empilée, donc **change sa hauteur** — aucune des deux façons de porter un état ne tenait
dans le gabarit de l'en-tête sans le faire bouger. Clés i18n `music.sourceLinked` / `sourceUnlinked`
retirées.

**Ce que la source change, et ce qu'elle ne change pas.** La source choisie occupe **la recherche et
la zone centrale** ; le panneau « Écoute » et la barre du bas restent **communs** (une radio lancée se
pilote dans la même barre, qui gérait déjà `nowPlaying.live` : ni curseur ni saut).

**`RadioBrowser.vue`** (source Radios) :
- recherche au **même gabarit** que celle de YouTube Music — rien ne bouge en changeant de source ;
  mémoire `kasbah.radio.query` ;
- onglets **Favorites / Les plus écoutées** (`Segmented`, `kasbah.radio.tab`) ; les favorites sont
  celles de la maison, gardées par le serveur (`../3_plugins/3_19_radio.md`) ;
- liste en grille **`repeat(auto-fill, minmax(320px, 1fr))`** de `MusicItemRow`, chacune suivie d'une
  **étoile** (ajouter / retirer des favorites) ; ligne de méta = pays · codec et débit · trois tags ;
- la station « qui joue » est reconnue sur le lecteur choisi : `playing`, `nowPlaying.live` et titre
  égal au nom de la station ;
- touche **« Ajouter une radio »** : formulaire nom + URL du flux (validé `http(s)`), qui bascule sur
  l'onglet Favorites ;
- lecteur « Ce navigateur » choisi → message « La radio ne se lit pas encore dans ce navigateur :
  choisissez une enceinte » (pas de lecture locale pour la radio).

**`ArtThumb.vue`** : `@error` sur l'image → retour à l'icône de remplacement. Les logos de radio de
l'annuaire sont souvent disparus ou refusent le lien direct ; sans cela, le navigateur affichait son
image cassée.

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/RadioBrowser.vue`,
`apps/web/src/components/ui/{ArtThumb,Segmented}.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`i18n/locales/{fr,en}.json` (`radio.*`).

### Mise à jour 2026-09-23 (18) — source Mixcloud, logos de source, Réglages triés

**Troisième source.** « Mixcloud » s'ajoute au sélecteur de la section (17) si le plugin `mixcloud`
est actif (`plugins.byId.mixcloud?.enabled`), entre YouTube Music et Radios. Serveur :
`../3_plugins/3_20_mixcloud.md`.

**Le sélecteur passe aux logos.** Les options du `Segmented` portent désormais une icône :
`sourceYtmusic`, `sourceMixcloud`, `sourceRadio`, ajoutées à `lib/strokeIcons.ts` — les logos
**redessinés au trait** comme le reste du jeu, pas les marques en couleur. Comme le notait (17),
`Segmented` n'affiche que l'icône quand on lui en donne une : le nom de la source devient l'infobulle
et le libellé accessible. Le gabarit ne change donc pas (ce qui écartait un point d'état en (17)
reste vrai).

**Une lecture générique.** `MusicView.vue` gagne `playTracks(tracks, index)`, indépendant de la
source : la liste devient la file du lecteur choisi — une enceinte (`musicQueuePlay`, file côté
serveur) ou **ce navigateur** (`localPlayer.playQueue`) — par fenêtre de 100 pistes autour de celle
lancée, comme le faisait déjà YouTube Music. `nowPlayingTrack` est `{ source, id }` ; les listes
YouTube Music ne reconnaissent comme « en cours » qu'un id venu de `ytmusic` (`nowPlayingId`), pour
qu'un id Mixcloud ne s'allume pas par hasard ailleurs. Contrairement à la radio, **Mixcloud se lit
aussi dans le navigateur**.

**`components/music/MixcloudBrowser.vue`** (source Mixcloud) :
- tant que rien n'est relié : champ **nom d'utilisateur** et touche « Relier » sur la page même
  (texte : « Aucun mot de passe : Kasbah ne lit que ce que ton profil montre publiquement ») ;
- recherche au même gabarit que les autres sources ;
- onglets **Nouveautés / Favoris / Écoutés / Mes mix / Playlists / Suivis** (`Segmented`,
  `kasbah.mixcloud.tab`), sur la même rangée qu'une pastille « Compte @nom » qui délie ; rangée
  gardée (grisée) pendant une recherche ; sous Nouveautés, une ligne rappelle que le fil est recomposé
  et mis à jour toutes les 30 min ;
- une playlist ou un compte suivi s'ouvrent en **liste de mix**, avec une rangée « Retour » ;
- grille **`repeat(auto-fill, minmax(320px, 1fr))`** de `MusicItemRow` ; un mix écouté en partie
  affiche **« Reprendre à hh:mm:ss »** en tête de sa méta (le nom de l'auteur passe derrière) et le
  lancer part de cette position ;
- à droite de chaque ligne, une touche **« Repartir du début »** (`rotateLeft`) qui oublie la position
  (`DELETE /resume`) puis joue du début ; sa **place est toujours gardée** (`is-hidden` quand il n'y a
  rien à reprendre), pour qu'une ligne sans reprise ne se décale pas (règle « rien ne doit bouger »,
  `4_0_langage-visuel.md`) ;
- « Afficher plus » tant que l'API rend un curseur `next`.

Seule la piste **lancée** part avec sa reprise ; les suivantes de la file démarrent au début.

**`components/MixcloudLinkCard.vue`** : la même liaison dans Réglages → Plugins, avec en plus
« Changer de compte ».

**Réglages → Plugins trié.** `SettingsView.vue` range les sections de plugin par **ordre alphabétique
de leur nom affiché** (l'id, `_` remplacé par une espace : `google cast`, `open meteo`), et non plus
dans l'ordre où la liste arrive du serveur.

Sources : `apps/web/src/views/{MusicView,SettingsView}.vue`, `apps/web/src/components/music/MixcloudBrowser.vue`,
`apps/web/src/components/MixcloudLinkCard.vue`, `apps/web/src/components/settings/PluginSection.vue`,
`apps/web/src/lib/strokeIcons.ts`, `apps/web/src/stores/localPlayer.ts`,
`i18n/locales/{fr,en}.json` (`mixcloud.*`).

### Mise à jour 2026-09-23 (19) — Mixcloud : onglet Accueil, la touche du compte quitte la page

**Un onglet « Accueil », en premier et par défaut.** `MixcloudBrowser.vue` ajoute `home` en tête des
onglets de (18) ; c'est la nouvelle valeur par défaut de `kasbah.mixcloud.tab` (qui valait `feed`) —
un navigateur qui a déjà un onglet retenu le garde. L'accueil reprend celui du site : des **rangées
horizontales** de `MusicTile` (128 px, défilement horizontal avec `scroll-snap` léger), une par section
rendue par `GET /api/plugins/mixcloud/home` (composition côté serveur :
`../3_plugins/3_20_mixcloud.md`, « l'accueil, recomposé des écoutes publiques »). Titres :
« Tes créateurs », « Des comptes que tu suis », « Réécouter », « Plus de {nom} », « Émissions {genre}
populaires ».
- une tuile **créateur** est **ronde** (`round`, icône `person` faute de photo) et **ouvre** ses mix :
  même chemin que depuis Suivis (`openUser` → liste de mix avec la rangée « Retour ») ;
- une tuile **mix** **joue** ; la **rangée** devient la file (`play(m, sh.items)` — `play` accepte
  désormais la liste en second argument au lieu de toujours prendre la liste affichée) ; comme ailleurs,
  seule la piste lancée part de sa reprise, et « Reprendre à hh:mm:ss » apparaît dans la méta de la
  tuile. La touche « Repartir du début » des lignes n'existe pas sur les tuiles ;
- pendant le chargement, **trois rangées squelettes** de six tuiles au gabarit des vraies ; sans
  rangée, un message : « Mixcloud ne répond pas » en cas d'échec, sinon « Écoute quelques mix sur
  Mixcloud : l'accueil se compose de tes écoutes » (un compte sans écoute publique n'a pas d'accueil) ;
- une recherche, une playlist ou un compte ouverts remplacent l'accueil (`showsHome`) comme ils
  remplacent les autres listes.

**La pastille « Compte @nom » qui déliait est retirée de la page** (demande de l'utilisateur) : la rangée
des onglets ne porte plus que le `Segmented`. Ce que (18) décrivait — « sur la même rangée qu'une
pastille « Compte @nom » qui délie » — n'est donc plus vrai à partir de cette date. Relier, **changer**
et **délier** se font dans la fiche du plugin, Réglages → Plugins (`MixcloudLinkCard.vue`, qui avait
déjà les trois). Le champ « Relier » de la page reste, lui, tant qu'aucun compte n'est relié. Clé i18n
`mixcloud.account` supprimée ; `mixcloud.unlink` reste (utilisée par la fiche).

Transport : `mixcloudHome()` et le type `MixcloudHomeSection` (union discriminée par `kind` / `id`,
calquée sur `HomeSection` du serveur) ; le mock lève `501 NOT_IMPLEMENTED` comme les autres `mixcloud*`.

Sources : `apps/web/src/components/music/{MixcloudBrowser,MusicTile}.vue`,
`apps/web/src/components/MixcloudLinkCard.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`,
`i18n/locales/{fr,en}.json` (`mixcloud.tabHome`, `mixcloud.home*`), arbre non commité après 1839a21.

### Mise à jour 2026-09-24 — le lecteur du panneau appareil rejoint la barre Musique

**Pourquoi.** Le lecteur du panneau (vue 3D, `MediaPlayerControl.vue`) n'avait que précédent,
lecture, suivant — et ses précédent / suivant envoyaient `media_player.next` à l'enceinte. Or un
lecteur qui joue un flux **servi par Kasbah** (YouTube Music, Mixcloud) n'a qu'un « fichier » : la
file vit sur le serveur (« (6) » plus haut), l'enceinte n'a rien à sauter. L'appui ne faisait rien.

**La rangée** est désormais celle de la barre de la page Musique : répéter, précédent, −10 s,
lecture / pause, +10 s, suivant, stop. Sept touches dans les **285 px** de contenu du panneau fixe de
340 px : aux tailles Vuetify par défaut la rangée débordait de 32 px, d'où des tailles fixées dans le
composant (36 px les touches de texte, 40 px les tonales, 50 px la lecture) et un
`justify-content: space-between` ; la rangée étant symétrique, lecture reste au centre. Le pas
(« 10 », « 1 », « ∞ ») vit au centre de la flèche, comme dans la barre.

**Ce qui se grise** (rien ne disparaît, règle « rien ne bouge ») :
- **direct** (`nowPlaying.live`) : répéter, précédent, suivant et ±10 s grisés ; lecture / pause,
  stop et volume restent actifs ;
- **au repos** : tout grisé ;
- **répéter** n'est actif qu'avec une file serveur ; suivant se grise sur le dernier titre de la file.

Changement discret : précédent / suivant étaient en `v-if="has('track_skip')"` et **disparaissaient**
sur un lecteur sans cette capacité ; ils sont maintenant toujours rendus, grisés.

**Qui reçoit l'appui.** Avec une file serveur, suivant / précédent / répéter passent par
`musicQueueNext` / `musicQueuePrevious` / `musicQueueRepeat` ; sans file, on retombe sur
`media_player.next` / `previous` et la capacité `track_skip`, comme avant. La session est suivie par
un composable dédié, `composables/useMusicSession.ts` : il ne lit que CE lecteur dans
`GET /api/music/sessions`, relit 800 ms après un changement d'état ou de titre (le délai de la page
Musique : laisser le serveur lancer le titre qu'il enchaîne) et toutes les 20 s, et ne fait **aucun
appel** si l'appareil n'a pas `play_url`. La session survit au morceau (TTL serveur) : le panneau ne
l'écoute que tant que le lecteur est en lecture ou en pause.

**Qualité du flux**, au milieu de la ligne des temps (grille `5ch | 1fr | 5ch`), en 10 px à
`opacity: .6` : c'est une info de connaisseur, pas de lecture, elle doit peser moins que les temps qui
l'encadrent. Info-bulle pour le détail. Le calcul est partagé avec la barre Musique dans
`lib/streamQuality.ts` (`qualityLabel`, `qualityDetails`, `streamQuality`) ; pour une radio, la
qualité est celle de l'annuaire (voir `../3_plugins/3_19_radio.md`, « Qualité d'une radio »).
Vérifié en réel sur un Sonos avec un mix servi par Kasbah : « AAC 64 kb/s », pied et
rangée de touches sans débordement à 90, 100 et 125 % de zoom.

**Pied « Page Musique / Ouvrir »**, même motif que « Réglages / Modifier » (`card card--soft`,
libellé `muted`, pastille ; clés `media.musicPageHint`, `media.openInMusic`). Il écrit l'id de
l'appareil dans `localStorage['kasbah.music.session']` — la clé que `MusicView.vue` lit pour son
lecteur choisi ; `useLocalStorage` de VueUse synchronise aussi dans le même document, donc le choix
passerait même si la page Musique était gardée en vie (aujourd'hui seule `HomeView` l'est, `App.vue`)
— puis pousse la route `music`.

Tests montés du composant enrichis (`MediaPlayerControl.test.ts`). Voir aussi le piège du style
scoped périmé rencontré pendant cette session : `../6_faq/6_0_pieges-outillage.md`, 2026-09-24.

Sources : `apps/web/src/components/controls/MediaPlayerControl.vue`,
`apps/web/src/components/controls/MediaPlayerControl.test.ts`,
`apps/web/src/composables/useMusicSession.ts`, `apps/web/src/lib/streamQuality.ts`,
`apps/web/src/components/music/MusicPlayerBar.vue`, `apps/web/src/views/MusicView.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`, arbre de travail non commité du 2026-09-24 (après 553ff9c).

### Mise à jour 2026-09-28 (bis) — page Musique : dernière écoute en pause, genres Mixcloud, la file partout

Arbre de travail non commité après c6fe7c1. Serveur : `../1_architecture/1_6_lecteur-musique.md` et
`../3_plugins/3_20_mixcloud.md`, sections du 2026-09-28 ; store : `../1_architecture/1_4_app-web.md`.

**(a) La barre montre la dernière écoute d'une enceinte, en pause.** Après un redémarrage du serveur
ou un arrêt, la barre (`MusicPlayerBar.vue`, nouvelle prop `resume`) affiche le titre, la pochette, la
position et la durée de ce que jouait l'enceinte, **en pause**. Lecture → `musicResume` (file et
répétition comprises) ; le **curseur et les sauts de 10 s ne font que choisir la position de départ**
(`resumeAt` dans `MusicView.vue`) — rien n'est envoyé à l'enceinte, qui n'a plus rien à déplacer.
Précédent, suivant, stop et répétition sont **grisés tant que `resume` est posé** (`canPrevious`,
`canNext` et le `disabled` de stop testent `!resume`) : une enceinte restée **en pause** sur le flux
mort a `loaded` vrai, et sans ce test ses capacités (`track_skip`) auraient allumé des touches qui
seraient parties vers elle. La répétition, elle, n'a pas de file vivante à régler. `MusicView` lit
`musicLast()` avec `musicSessions()` à chaque rafraîchissement.

**Quand la montrer — `selectedLast`.** Seulement si le lecteur n'a **aucune session vivante** de
nous, qu'il **ne joue pas**, et, s'il est **en pause**, qu'il montre encore **notre** titre, un nom
de fichier `<sid>.m4a` (le Sonos publie parfois le nom du fichier servi) ou une URL — un flux mort,
donc. Autre chose en pause (une appli, une radio lancée ailleurs) : c'est ça que la barre montre, pas
un souvenir qui le masquerait.

**(b) Ce navigateur aussi** : après un rechargement, le titre est là en pause à sa position, file
visible, précédent / suivant actifs ; même logique du curseur (point de départ seulement). Mécanique :
`1_4_app-web.md`, état `restored`.

**(c) Genres Mixcloud en pastilles** — `components/music/GenrePills.vue`, posées sous chaque mix par
un slot `extra` ajouté à `MusicItemRow` (lignes) et à `MusicTile` (tuiles de l'accueil). Les tags
quittent la méta.
- Une ligne de **hauteur fixe (20 px)** : ce qui ne tient pas **s'estompe à droite** (la suite existe)
  et **défile** façon `MarqueeText` — au survol de la tuile ou de la ligne avec une souris, en continu
  sur un écran tactile (pas de survol), jamais sous `prefers-reduced-motion`.
- **Piège corrigé** : `.gp__inner` en `inline-flex` se posait sur la **ligne de base** et descendait
  de 4 px, rognant le bas des pastilles ; passé en `display: flex` + `width: max-content`.
- Un genre gardé par le filtre s'allume **à la couleur seule** : un gras élargirait la pastille, et le
  défilement mesuré ne serait plus le bon.

**(d) La rangée de filtres** (`MixcloudBrowser.vue`), entre les onglets et la liste :
- **trois états** par pastille, cycle neutre → gardé → écarté (règle : `3_20_mixcloud.md`) ; l'état se
  lit **aux couleurs et au trait seulement** — gardé = accent, écarté = bord pointillé et texte barré,
  sans icône ni gras : **largeur constante** (demande de l'utilisateur, règle « rien ne bouge ») ;
- **composée des mix reçus** : à l'accueil, toutes les rangées de mix, **dédoublonnées par mix** (un
  mix présent dans plusieurs rangées ne compte qu'une fois) ; dans une liste, la page chargée. Classée
  par fréquence **avant filtre** ; l'ordre ne change pas quand on choisit, et les genres choisis
  absents des mix reçus vont **à la fin** (ils restent pour pouvoir être défaits) ;
- choix mémorisé dans `kasbah.mixcloud.genres` (nom + état) ;
- **une seule ligne qui défile** : la molette verticale d'une souris la fait avancer à l'horizontale ;
  barre fine globale de l'appli (`apps/web/src/styles/app.css`, `* { scrollbar-width: thin }`, qui
  fait ignorer les règles `-webkit-scrollbar`). **Hauteur réservée de 44 px, barre comprise**, qu'elle
  soit là ou non ; libellé « Genres » et bouton calés en haut (marge 4 px, hauteur 28 px) comme les
  pastilles ; fondu au bord **du côté où la rangée continue** (`data-fade-start` / `data-fade-end`,
  recalculés au défilement et par `ResizeObserver`) ;
- **« Tout remettre »** : bouton discret **sans bordure, avec l'icône `undo`** — l'utilisateur ne le
  distinguait pas des pastilles quand il en avait l'air ; sa place est gardée, invisible, sans filtre ;
- **grisée, pas masquée**, sur Playlists et Suivis (rien à filtrer) : rien ne bouge en changeant
  d'onglet ;
- la file lancée depuis une liste = la liste **filtrée** (`play` prend `shownMixes`) ; sans mix
  restant : « Aucun mix ne correspond à ces genres ».

**(e) Durée sur les tuiles de l'accueil** : prop `badge` de `MusicTile`, étiquette sombre en bas à
droite de la pochette — elle ne prend aucune place au texte. Les lignes avaient déjà la durée à droite.

**(f) Bug corrigé : la file n'existait que pour YouTube Music.** La vue File de (6) vivait dans la
branche YouTube Music de `MusicView.vue` ; depuis l'arrivée des sources (17) et (18), la touche File
de la barre **basculait sans rien montrer** sous Mixcloud ou Radios — alors même que sa pastille
annonçait des mix en attente. La liste est extraite dans `components/music/QueueList.vue` et prend la
zone centrale **quelle que soit la source**, avec sa rangée « Retour » / « Vider la file ».
`RadioBrowser` et `MixcloudBrowser` restent **montés** (`v-show`) : on les retrouve tels quels au
retour (onglet, défilement, recherche).

Sources : `apps/web/src/views/MusicView.vue`, `apps/web/src/components/music/{MusicPlayerBar,MixcloudBrowser,GenrePills,QueueList,MusicItemRow,MusicTile}.vue`,
`apps/web/src/stores/localPlayer.ts`, `apps/web/src/styles/app.css`, `i18n/locales/{fr,en}.json`
(`mixcloud.genres`, `mixcloud.genresReset`, `mixcloud.genresEmpty`, `mixcloud.genreNeutral|On|Off`).

### Mise à jour 2026-09-29 — la touche lecture tourne jusqu'à ce que l'enceinte joue

**Bug.** Lecture sur la dernière écoute (en pause après un rechargement ou un redémarrage du serveur) :
le sablier ne durait que l'appel `musicResume`. Le serveur répond une fois le lancement fait, mais
l'enceinte publie « lecture » un peu après ; entre les deux, `pending` était retombé, la dernière
écoute oubliée, l'enceinte encore au repos : la touche revenait à un « lire » grisé, sans sablier.

**Correctif** (`MusicPlayerBar.vue`) : un état local `starting`, posé au clic sur lecture, levé dès que
l'état du lecteur passe à `playing`, au changement de lecteur, ou au bout de `STARTING_MAX_MS`
(15 s) si l'enceinte ne suit jamais. La touche tourne (`busy` = `pending` ou `starting`) et reste
désactivée pendant ce temps ; même taille, rien ne bouge. Sur une lecture **directe** (enceinte en
pause sur un flux vivant), le patch optimiste du store (`lib/optimistic.ts`) passe aussitôt à
`playing` : la touche montre « pause » tout de suite, comme avant. Le Cast mappe déjà `BUFFERING`
sur `playing` côté serveur : le trou n'était pas là.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`,
`apps/web/src/components/music/MusicPlayerBar.test.ts` (« attente de la lecture »).

### Mise à jour 2026-10-07 — page Musique et cartes de comptes : le compte courant, le mode anonyme

Les comptes musicaux sont par utilisateur (`../1_architecture/1_6_lecteur-musique.md`,
`../3_plugins/3_16_ytmusic.md`, `../3_plugins/3_20_mixcloud.md`). Ce que l'écran en montre :

- **Cartes de Réglages** (`YtmusicLinkCard.vue`, `MixcloudLinkCard.vue`) : une seule carte, qui agit sur
  « le compte courant » (le sien si l'on est connecté, celui de la maison sur le réseau local ; une carte
  séparée « Mes comptes musique » a été écartée). Une ligne « Compte de {user} : ce qui est réglé ici ne
  touche pas le compte de la maison » (`settings.musicAccountOf`) rend explicite lequel on règle. YouTube
  Music ajoute `settings.ytmusic.anonymous` et masque la section d'import du navigateur pour un utilisateur ;
  les étapes du cookie sont réécrites (`settings.ytmusic.pasteHowTo`).
- **YouTube Music en anonyme** (`views/MusicView.vue`) : la source reste utilisable ; les onglets Likes et
  Playlists sont masqués (`personal`) et l'onglet mémorisé est ramené à Récents.
- **Mixcloud en anonyme** (`components/music/MixcloudBrowser.vue`) : recherche et genres, pas d'onglets
  personnels ; hors recherche, invitation « Relier ton compte Mixcloud » (`mixcloud.anonymousHint`) avec le
  champ AVANT l'explication — sur téléphone la zone sous la recherche ne fait que ~137 px, le champ était
  sous le pli.
- **Vérifié** (serveur jetable, connecté en `alice`) : rien ne bouge entre repos et recherche (mesure
  géométrique), aucun débordement à 1 280 et 375 px, fr et en ; cartes de Réglages et étapes du cookie fr/en à
  375 px. Pas de contrôle clair/sombre consigné : aucune couleur n'a été touchée.
- **Limite** : le badge de santé du plugin, dans Réglages, reste celui de la maison.

### Mise à jour 2026-10-30 — page Musique sur téléphone : barre compacte, lecteur agrandi, feuille Écoute

Retour de l'utilisateur : la page était inutilisable sur téléphone. Mesuré à 360 × 740, la zone de
contenu n'avait plus que **48 px** (en-tête 126, recherche 96, Écoute 126, lecteur 200, barre du bas 72) :
les trois zones permanentes du bureau (contenu, Écoute, lecteur) ne tiennent pas. **Remplace** la partie
« Musique » de la mise à jour du 2026-09-29 de `4_1_navigation-et-panneaux.md` (Écoute sur 38 % de la
hauteur, barre à quatre rangées). Seulement sous 600 px de large (`useMediaQuery('(max-width: 599px)')`
et les mêmes media queries) : bureau et tablette inchangés (mesuré à 1 280 × 800 : colonne Écoute à
droite, barre de 92 px).

Choix de l'utilisateur sur maquettes (deux directions comparées : mini-lecteur + plein écran, ou barre
compacte fixe + onglet Écoute) : **la barre compacte** — les touches classiques toujours à portée —,
**agrandissable en plein écran**, et **pas d'onglet Écoute** (écarté).

- **Barre compacte** (`MusicPlayerBar.vue`) : trois rangées, 145 px que quelque chose joue ou non — le
  morceau (pochette 44 px, titre, une pastille au nom du lecteur qui ouvre Écoute, touche File), les sept
  touches de transport, la position. Volume, lecteur et « Transférer » attendent dans le lecteur agrandi.
  La pastille a une largeur fixe (108 px) : un nom long défile, un nom court ne rétrécit pas le titre.
- **Lecteur agrandi** : un tap sur la pochette ou le titre (`.bar__open`, un bouton seulement sur
  téléphone) étale la barre sur toute la page, au-dessus de la barre du bas (`.page` en `position:
  relative`, `.bar[data-full='1']` en `inset: 0`) : chevron pour réduire, grande pochette (largeur de la
  page, au plus 38 % de la hauteur, `coverSize`), titre et File, position puis touches, volume, lecteur
  (qui ouvre Écoute) et « Transférer ». Ouvrir la file réduit le lecteur : la file s'affiche dans la zone
  centrale, qu'il couvre. Le retour au bureau le replie (`watch(phone)`).
- **Écoute en feuille** (`MusicView.vue`, `.sessions-sheet`) : le même `ListeningSessions`, toujours monté
  (son filtre et son défilement survivent), dans une feuille du bas de 64 % de la page, au-dessus du
  lecteur, agrandi ou non ; voile et poignée la ferment. « Transférer » l'ouvre aussi : il faut la liste
  des cibles. Hors téléphone, le conteneur est en `display: contents` et le panneau reste la colonne de
  droite de la grille. `SidePanel` n'a pas été repris : il démonte son contenu à la fermeture.
- **Piège** : la feuille fermée, poussée hors du cadre par `translateY(100%)`, allongeait la zone qui
  défile de la coquille — toute la page glissait de 327 px vers le haut. `overflow: hidden` sur le
  conteneur de la feuille.
- **Piège** : en plein écran, la barre passe en colonne flex, mais l'`align-items: center` de sa grille de
  bureau s'y applique aussi et réduit la rangée du morceau à son contenu (titre de largeur nulle, à cause
  du `contain: inline-size` de `MarqueeText`). `align-items: stretch` sur `.bar[data-full='1']`.
- **Recherche** : « Avancée » et « Masquer explicit » passent dans un menu (`v-menu`) ouvert par une touche
  réglages au bout du champ, teintée quand une option est active. Le sélecteur de source remonte sur la
  ligne du titre (`.page :deep(.page-header__titles) { flex-basis: 0 }`, `order: -1` avant la touche de
  l'assistant). Contenu : 48 → 343 px à 360 × 740.
- Nouvelles clés `music.playerExpand`, `playerCollapse`, `choosePlayer`, `searchOptions`.

**Vérifié** dans la preview `kasbah-mock` à 360 × 740 (lecture forcée dans le store) : barre de même
hauteur au repos et en lecture, aucun débordement horizontal, plein écran, feuille et menu ouverts ; clair
et sombre ; 1 280 × 800 inchangé ; suite complète, typecheck et lint verts. **Non vérifiés** : le vrai
téléphone, les zooms 1,25 / 1,5, l'anglais, une vraie pochette et plusieurs enceintes (le mock n'en
liste qu'une). **Non fait** : fermer la feuille ou le lecteur agrandi en les tirant vers le bas.

Sources : `apps/web/src/components/music/MusicPlayerBar.vue`, `apps/web/src/views/MusicView.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`.
