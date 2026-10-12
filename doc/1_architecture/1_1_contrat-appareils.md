# Contrat des appareils (packages/shared)

> Dernière mise à jour : 2026-10-12
> Sources : `packages/shared/src/devices/{kinds,descriptor,state,command,rules,color}.ts`, `packages/shared/src/scenes/scene.ts`, `packages/shared/src/devices/activity.ts`, `packages/shared/src/house/geo.ts`

## Principe

Un seul module zod définit **kinds**, **capacités**, **descripteurs**, **états** et **commandes**.
Les types TypeScript en sont inférés (`z.infer`). Le serveur valide à la frontière (corps des
commandes, patchs de plugins) ; l'app web parse les réponses.

## Kinds et capacités

`DEVICE_KINDS` : `light`, `cover`, `media_player`, `climate`, `vacuum`, `mower`, `sensor`,
`energy`, `ev_charger`, `vehicle`, `camera`, `weather`, `water`, `pet_feeder`, `pet_fountain`, `fan` (16 au total). `KIND_CAPABILITIES` borne les capacités légales par kind ; le
descripteur est rejeté (`superRefine`) si une capacité n'appartient pas au kind ou si `id ≠ pluginId:externalId`.

> Mis à jour le 2026-10-06 (lint) : la liste des kinds passe de 10 à 16 (ajout de `camera`, `weather`, `water`, `pet_feeder`, `pet_fountain`, `fan`), d'après `packages/shared/src/devices/kinds.ts`.

Choix d'unités (alignés sur Hue, natifs, pas de conversion perdante) :
- luminosité **0–100**, température de couleur en **mirek**, couleur en **CIE xy** (conversions
  UI dans `color.ts` : xy ↔ sRGB ↔ HSV, mirek ↔ kelvin) ;
- volet `position` **0 = fermé, 100 = ouvert** + `motion` (`opening|closing|stopped`) ;
- énergie : `gridW` > 0 = import, `batteryW` > 0 = charge ; véhicule : `soc`, `rangeKm`,
  `location { lat, lon, at }`.

## États

`deviceStateSchema = discriminatedUnion('kind', …)`. Chaque état porte `updatedAt` (posé par le
serveur) et `available` (`false` conserve les dernières valeurs : l'UI grise au lieu de perdre).
`defaultState(kind)` produit un état complet indisponible pour qu'un client ait toujours un objet
entier. `stateKeys(kind)` liste les clés légales : le registre **rejette** un patch portant une
clé étrangère au kind (sinon zod la supprimerait en silence et publierait un faux changement).

## Commandes

Nommage `kind.verbe`, union discriminée sur `type`. `light.set` est **fusionnée** (on, brightness,
colorTempMirek, color, transitionMs) : miroir du PUT Hue, un seul aller-retour par mouvement de
color picker. `COMMAND_REQUIRES` donne la capacité exigée par chaque commande ; `sensor` et
`energy` n'ont pas de commandes.

## Règles pures (`rules.ts`)

- `assertCommandAllowed(descriptor, cmd)` → `CommandNotAllowedError('KIND_MISMATCH' | 'UNSUPPORTED_COMMAND')`.
- `mergeState(prev, patch, now)` retourne **la même référence** si rien ne change : c'est ce qui
  garde silencieux le tick 1 Hz de la simulation.
- `parseDeviceId` / `makeDeviceId`.

## Type `StatePatch`

Distributif sur le kind (`K extends DeviceKind ? Partial<…> : never`) : sans cela, le type par
défaut ne contiendrait que les clés communes et `{ on: true }` serait refusé.

## Tests

`packages/shared/src/devices/rules.test.ts` (ids, autorisation, fusion, états par défaut),
`color.test.ts`, `protocol/protocol.test.ts`.

### Mise à jour 2026-09-08 — scènes plugin et capacité `effect`

Deux ajouts au contrat, tous deux **additifs** (aucun champ existant n'a changé de sens).

**Scènes plugin** (`packages/shared/src/scenes/scene.ts`, module frère de `devices/`) : un préréglage
qui vit chez le fabricant n'est ni un appareil ni une scène maison, donc il a son propre schéma
plutôt qu'un faux appareil `light` (un tel appareil n'aurait pas d'état à porter et polluerait
l'auto-placement 3D).

- `pluginSceneSchema` : `id` (`<pluginId>:<externalId>`, même forme et même `superRefine` qu'un
  descripteur), `name`, `group { name, kind: 'room' | 'zone' }` **optionnel**, `dynamic: boolean`,
  `autoDynamic: boolean` (défaut `false`), `swatches: string[]` (couleurs sRGB `#rrggbb`).
- `dynamic` est une **capacité** (la scène a une palette à animer), `autoDynamic` une **préférence**
  (« démarrer l'animation automatiquement »). Le contrat transporte les deux séparément parce
  qu'ils répondent à deux questions différentes — « est-ce possible ? » et « est-ce souhaité ? ».
- `sceneUpdateSchema` (`{ autoDynamic: boolean }`) écrit cette préférence **chez le fabricant**, là
  où elle vit déjà. C'est la seule chose que Kasbah modifie dans la configuration d'un fabricant, et
  c'est délibéré : la stocker côté app créerait deux valeurs pour une même question, donc une
  ambiguïté dès qu'une autre app (celle du fabricant, un autre écran) touche au réglage. Une
  seule source de vérité, quelle que soit l'app qui règle le paramètre.
- Le `group.kind` porte la règle de rapprochement : une `room` se relie à la pièce **homonyme** de la
  maison (même convention `roomKey` que l'auto-placement, cf. `../2_maison/2_0_format-house-json.md`),
  une `zone` traverse les pièces et n'appartient donc à aucune.
- Les pastilles sont calculées **côté plugin** (donc sRGB dans le contrat, pas du xy) : les vignettes
  officielles des fabricants ne sont pas récupérables, et l'aperçu doit rester lisible sans conversion
  côté client. Cf. `../3_plugins/3_1_philips-hue.md`.
- `pluginSceneStateSchema` : `active: 'inactive' | 'static' | 'dynamic'` + `updatedAt`. Une scène n'a
  qu'un seul champ d'état : pas de patch, pas de fusion — le serveur remplace.
- `sceneRecallSchema` : `mode` (`static` par défaut, `dynamic`, `off`), `brightness?`, `transitionMs?`.
  `off` existe parce qu'aucun fabricant n'offre de « désactiver la scène » : une scène s'éteint en
  éteignant ses lampes, et c'est au **plugin** de savoir lesquelles (l'app ne connaît pas les membres
  d'une zone du fabricant). Les trois modes font de la pastille et du bouton d'animation deux
  bascules, cf. `../4_ui/4_1_navigation-et-panneaux.md`.
- `makeSceneId` / `parseSceneId`, miroirs de leurs équivalents appareils.

**Capacité `effect`** (kind `light`) : animation d'une seule lampe, côté fabricant.

- `CAPABILITIES` gagne `effect`, autorisée pour `light` seul ; `descriptor.meta.effects: string[]`
  liste les noms proposés par le modèle (`no_effect` en premier — l'ordre du fabricant est conservé,
  les noms ne sont **pas** normalisés : chaque firmware en ajoute).
- `lightStateSchema.effect?: string` (l'état vaut `no_effect` quand aucun effet ne tourne).
- `light.set` gagne `effect?: string` plutôt qu'une commande dédiée : c'est la commande fusionnée
  miroir du PUT Hue, un effet part donc dans le même aller-retour qu'une couleur.
- Comme `color` vs `colorTempMirek`, la précédence est tranchée par le plugin, pas par le contrat.

### Mise à jour 2026-09-08 — réglages par plugin

`pluginSettingsSchema` (`packages/shared/src/scenes/scene.ts`) : les réglages d'un **plugin**, pas
d'une scène. Le concept de scène est commun à tous les plugins, les réglages ne le sont pas — on
peut vouloir les palettes animées sur les lampes et pas sur un autre parc d'appareils. Un seul champ
aujourd'hui, `autoDynamicForNewScenes` (défaut `false`).

Ces réglages vivent **côté serveur** et non dans le navigateur : ils gouvernent une réaction du
serveur (initialiser une ambiance qui apparaît) et doivent valoir pour tous les écrans.
Distinguer trois emplacements, c'est la règle du projet :

| Nature | Où |
|---|---|
| Réglage d'un appareil ou d'une scène | **chez le fabricant** (`sceneUpdateSchema`) |
| Réglage d'un plugin | **serveur**, persisté (`pluginSettingsSchema`) |
| Goût d'affichage d'un écran | **navigateur** (`localStorage`, cf. `../4_ui/4_2_theme-et-langues.md`) |

*(Dépassé le 2026-09-11 : `pluginSettingsSchema` n'est plus dans `scenes/scene.ts` mais dans `packages/shared/src/house/schema.ts`, et le réglage vit dans `house.json` (`plugins.<id>`, avec `enabled`, `parts` et `autoDynamicForNewScenes`). Il n'y a plus de `PluginSettingsStore` ni de `.state/plugin-settings.json` — voir `1_2_serveur-et-plugins.md`.)*

### Mise à jour 2026-09-08 — créer une ambiance en recopiant une existante

`sceneCreateSchema` (`{ fromSceneId, groupName }`) : ajouter une ambiance à une pièce **en
recopiant** une ambiance présente ailleurs. Pourquoi cette forme et pas une galerie de préréglages :
les fabricants ne publient pas la leur. Vérifié sur un pont Hue — aucune ressource catalogue
(`scene_template`, `scene_gallery`, `preset`… tous en 404 ; les 24 types de ressources du pont n'en
contiennent aucun), la galerie vit dans l'app du fabricant. La seule matière fiable est donc ce que
le pont porte déjà, et un pont installé en porte beaucoup (des ambiances distinctes réparties
inégalement sur les pièces).

Le rapprochement du groupe se fait par **nom normalisé** (`roomKey`), comme l'auto-placement des
appareils et le regroupement des ambiances : c'est la convention unique du projet pour relier une
pièce de la maison à une pièce du fabricant. La création est **idempotente par nom** : le plugin
refuse une ambiance déjà présente dans ce groupe.

### Mise à jour 2026-09-08 — `open_close`, distincte de `position` pour le kind `cover`

`cover.open` et `cover.close` exigeaient la capacité **`position`**. Conséquence découverte en
branchant un parc Somfy réel (`../3_plugins/3_4_somfy-tahoma.md`) : un ouvrant piloté en radio
**unidirectionnelle** (RTS) ne peut pas viser une position — s'il ne déclare pas `position`, il
devenait impossible de l'ouvrir *ou* de le fermer, alors que c'est tout ce qu'il sait faire.

D'où une capacité de plus dans `KIND_CAPABILITIES.cover` :

| Capacité | Sens | Commandes qui l'exigent |
|---|---|---|
| `open_close` | ouvrir / fermer en tout ou rien | `cover.open`, `cover.close` |
| `position` | position arbitraire **connue et réglable** | `cover.set_position` |
| `tilt` | orientation des lames | `cover.set_tilt` |
| `stop` | arrêt en cours de course | `cover.stop` |

Un moteur bidirectionnel déclare les deux premières, une radio unidirectionnelle seulement
`open_close`. `COMMAND_REQUIRES` porte le changement, donc le refus reste **central** : le serveur
rejette `cover.set_position` en 400 (`assertCommandAllowed`) avant même d'atteindre le plugin, et
`CoverControl.vue` comme la vue Ouvrants n'affichent le curseur que si `position` est déclarée.

Rayon d'impact vérifié avant l'édition : `COMMAND_REQUIRES` n'est lu qu'à un seul endroit
(`rules.ts`), et le seul producteur de descripteurs `cover` à mettre à jour était le volet du moteur
de simulation (`packages/mock-sim/src/behaviours/cover.ts`).


### Mise à jour 2026-09-08 — nature de l'ouvrant, et position qui peut manquer

Deux ajouts au kind `cover`, tous deux nés du parc Somfy réel.

**`meta.cover.deviceClass`** (`COVER_CLASSES` : `shutter`, `awning`, `blind`, `curtain`, `gate`,
`garage`, `window`) dit la NATURE de l'ouvrant, exactement comme `meta.sensor.deviceClass` dit celle
d'un capteur. Elle est posée par le plugin d'après ce que le fabricant déclare — jamais par une
heuristique sur le nom de l'appareil. Elle ne change **aucune** commande : un volet et un store se
pilotent tous deux par `cover.open` / `cover.close`. Elle ne sert qu'à l'interface, qui n'emploie pas
les mêmes mots ni les mêmes compteurs pour les deux (voir `../4_ui/4_1_navigation-et-panneaux.md`).

**`position` est devenue optionnelle**, et son absence signifie « inconnue ». Ce n'est pas un cas
marginal : une radio unidirectionnelle (RTS chez Somfy) ne publie jamais où elle en est, donc Kasbah
n'a rien à dire de ses ouvrants tant qu'aucune commande n'est passée par lui. Auparavant
`defaultState('cover')` posait `position: 0`, un remplissage prévu pour un appareil **indisponible**
que le plugin déclarait ensuite disponible sans jamais fournir de position : l'interface annonçait
donc « Fermé » (« Baissé » pour un store) et le comptait dans le résumé, sans rien savoir. Le
symptôme et sa correction sont détaillés dans `../6_faq/6_1_pieges-runtime.md`.

Conséquence pour un lecteur d'état : `state.position` d'un `cover` doit être testé avant usage. Les
quatorze points de lecture ont été traités un par un (`vue-tsc` les désigne tous) ; la règle
appliquée partout est **ne rien affirmer** — pas de teinte d'icône, pas d'interrupteur coché, pas de
pourcentage, et hors des compteurs du résumé, numérateur **et** dénominateur. Le moteur de
simulation, lui, pose toujours une position et ne l'efface jamais, d'où les `!` assumés dans
`packages/mock-sim/src/behaviours/cover.ts`.

### Mise à jour 2026-09-08 — capacité `preset`, et un patch qui sait EFFACER

**`preset`** (kind `cover`) : l'ouvrant sait rejoindre une position favorite **mémorisée dans le
moteur**, rappelée par `cover.preset` — une commande sans paramètre, puisque la valeur ne vient pas
de nous. C'est le « my » de Somfy ; le contrat le nomme `preset` parce qu'il doit rester neutre.

Deux notions à ne pas fondre en une : la **capacité** dit qu'on peut rappeler cette position, l'état
**`presetPosition`** (optionnel, même échelle que `position`) seulement qu'on peut la MONTRER. Une
radio unidirectionnelle a la première sans la seconde — relevé sur une TaHoma Switch : presque tous
les ouvrants déclarent `my`, un peu moins publient la valeur. Les fondre aurait interdit le bouton là où
il fonctionne, ou promis une valeur inexistante.

**`StatePatch` accepte désormais `null` sur un champ optionnel : « efface ce champ ».** Sans ça, il
n'existait aucun moyen de repasser une valeur à « inconnue » — `mergeState` ignore `undefined`, qui
veut dire « je ne parle pas de ce champ ». Le besoin est concret : rappeler la position favorite d'un
moteur unidirectionnel le déplace vers une position qu'on ne connaît pas, donc celle qu'on affichait
devient fausse et doit disparaître, pas rester périmée. Le type n'autorise `null` que là où
`undefined` est déjà permis, et `mergeState` ne signale un changement que si le champ existait —
sinon un plugin qui efface à chaque trame réveillerait le WebSocket pour rien. Portée nulle sur le
protocole : le client reçoit toujours l'état ENTIER, jamais un patch.

### Mise à jour 2026-09-09 — `preset_set` : la mémoire du moteur est réinscriptible

Troisième niveau autour de la position favorite, et les trois sont **indépendants** parce qu'un même
parc les mélange :

| Capacité / état | Signification | Relevé sur un parc d'ouvrants Somfy |
|---|---|---|
| `preset` | on peut RAPPELER la position favorite | presque tous |
| `presetPosition` | on peut la LIRE | un peu moins |
| `preset_set` | on peut la RÉÉCRIRE | un peu moins |

Un store RTS rappelle sans lire ni réécrire ; un portail ne fait rien des trois. Les fondre en une
seule capacité aurait donc interdit le rappel là où il fonctionne.

`cover.set_preset` **porte la position à graver**, au lieu de laisser le plugin lire celle de
l'appareil : l'appelant grave ainsi ce qu'il MONTRE, et jamais la position de départ d'un moteur
déjà en train de bouger. L'interface ne s'en sert que pour enregistrer la position courante (voir
`../4_ui/4_1_navigation-et-panneaux.md`), mais le contrat n'a pas besoin d'être plus étroit que la
commande du fabricant.

Deux conséquences à connaître :

- **une action d'ambiance peut techniquement reprogrammer une position favorite**, `sceneActionSchema`
  (`packages/shared/src/house/schema.ts`) embarquant n'importe quelle commande. Rien ne l'interdit
  aujourd'hui ; restreindre demanderait de scinder l'union des commandes, ce qui n'a pas été fait
  faute de besoin ;
- ce réglage vit **dans le moteur** et sert aussi aux télécommandes murales : le reprogrammer depuis
  Kasbah change le comportement du bouton physique pour toute la maison. Ce n'est pas un réglage
  d'application.

### Mise à jour 2026-09-09 — kind `camera`

Onzième kind, né du plugin Google Nest (`../3_plugins/3_5_google-nest.md`). Additif : aucun champ
existant ne change.

- `KIND_CAPABILITIES.camera` : **`live_stream`** (un flux vidéo à la demande, protocoles dans
  `meta.camera.protocols`) et **`chime`** (l'appareil sonne : c'est ce qui distingue une sonnette).
  **Pas de `on_off`** : l'API Nest ne sait pas éteindre une caméra, et déclarer une capacité
  qu'aucune commande ne peut honorer serait mentir à l'interface.
- `meta.camera.deviceClass` (`CAMERA_CLASSES` : `camera`, `doorbell`, `display`) dit la NATURE,
  comme `meta.cover.deviceClass` et `meta.sensor.deviceClass` — même commande de flux pour les
  trois, pas le même mot ni la même icône. `meta.camera.protocols` (`STREAM_PROTOCOLS` : `webrtc`,
  `rtsp`) est ce que le fabricant déclare ; il décidera de la façon d'afficher la vidéo.
- `cameraStateSchema` n'a **aucun champ propre** : seuls `available` et `updatedAt`. L'API ne
  publie ni marche/arrêt ni activité ; les événements (sonnerie, mouvement) s'ajouteront ici quand
  le flux Pub/Sub sera branché. `defaultState('camera')` retourne donc la base seule.
- **Aucune commande** `camera.*` : comme `sensor` et `energy`. Le flux WebRTC (offre → réponse SDP)
  est un aller-retour avec réponse, pas une commande « feu et accusé » — il passera par une route
  propre au plugin, pas par `commandSchema`.

Rayon d'impact : les `switch` exhaustifs sur le kind côté web (`lib/deviceState.ts`,
`lib/format.ts`, `lib/deviceIcons.ts`, `lib/strokeIcons.ts`, `controls/DeviceControl.vue`) et
`defaultState` — tous désignés par `vue-tsc` / `tsc`. GitNexus rend `UNKNOWN` sur les constantes du
contrat (lectures de propriétés d'objet, pas d'arêtes) : la liste ci-dessus vient d'une recherche
textuelle, confirmée par le typage.

### Mise à jour 2026-09-09 — `meta.climate.modes`

Additif, même famille que `meta.effects` et `meta.camera.protocols` : la liste des modes qu'un
appareil `climate` DÉCLARE. Sans elle, `ClimateControl.vue` proposait les six `CLIMATE_MODES` à tout
thermostat, donc « Refroidissement » à un thermostat Nest qui ne sait que chauffer — une commande
que le fabricant refuse. Absente = tous les modes (la simulation ne la pose pas). Le contrat ne
restreint pas `climate.set_mode` pour autant : c'est le plugin qui refuse un mode non déclaré
(`UNSUPPORTED_COMMAND`), comme pour toute capacité absente. Voir `../3_plugins/3_5_google-nest.md`.

### Mise à jour 2026-09-09 — `meta.mediaPlayer.deviceClass` (nature d'un lecteur)

Sur le modèle de `meta.cover.deviceClass` et `meta.camera.deviceClass` : `MEDIA_PLAYER_CLASSES =
['speaker', 'tv', 'display']` (`kinds.ts`) et `meta.mediaPlayer: { deviceClass }` **optionnel**
(`descriptor.ts`), absent = enceinte. Additif : aucun champ existant ne change, le kind reste
`media_player` avec les mêmes capacités et commandes — la classe ne décide que l'**icône** (`speaker`,
`tv`, `tablet`) et le **marqueur 3D** (cylindre d'enceinte, écran plat, petite dalle). Né du parc Cast
réel : un Chromecast branché sur une TV et un Nest Hub sont tous deux des `media_player` mais ne se
représentent pas pareil. Déclarée côté plugin, jamais dans `house.json`, qui ne porte que le placement.
Le simulateur déclare ses lecteurs `speaker`. Source : `../3_plugins/3_6_google-cast.md`.

### Mise à jour 2026-09-09 — sens de `media_player.previous`

Demande de l'utilisateur : « précédent » doit **revenir au début du morceau** s'il a déjà joué plus de
quelques secondes, et seulement sinon passer au morceau d'avant — le comportement d'une télécommande.
Aucune commande nouvelle : c'est la sémantique de `media_player.previous`, mise en œuvre là où la
position est connue, chez le fabricant. Plugin `google_cast` (`channel.ts : previous`) : position
estimée = dernier relevé + temps écoulé si ça joue ; au-delà de 3 s → `SEEK` à 0 sur la session,
sinon `QUEUE_UPDATE jump: -1`. Le simulateur (`mock-sim/behaviours/media.ts`) applique la même règle.
Un futur plugin `media_player` devra la suivre aussi.

### Mise à jour 2026-09-09 — capacité `seek` et commande `media_player.seek`

Demande de l'utilisateur : naviguer dans le morceau avec le curseur de durée quand ce n'est pas du
direct. Ajout **additif** au kind `media_player` : capacité `seek` (`KIND_CAPABILITIES`) et commande
`media_player.seek { positionS ≥ 0 }` (`COMMAND_REQUIRES` → `seek`). Le plugin `google_cast` la déclare
sur tous ses appareils et l'exécute par un `SEEK` Cast sur la session en cours ; l'UI ne propose le
curseur que si le morceau a une durée (un direct n'en a pas) et si la capacité est là. Le simulateur
la déclare et la sert. Mise à jour optimiste : la position visée s'affiche tout de suite
(`lib/optimistic.ts`), l'état du récepteur confirme.

### Mise à jour 2026-09-10 — état de lecture `on` (appli à l'écran, lecture inconnue)

`PLAYBACKS` : `playing`, `paused`, `idle`, **`on`**, `off`. `on` = une appli occupe l'écran du lecteur mais ne
publie aucune session média : on ne peut affirmer ni lecture ni pause, et aucune commande de transport n'a de
destinataire. Le plugin publie alors `nowPlaying: { title: '', source: <nom de l'appli> }`. Cas réel qui l'a
motivé : Netflix natif sur un Chromecast (`../3_plugins/3_6_google-cast.md`). Côté UI (`lib/deviceState.ts :
isMediaActive`), `on` compte comme ACTIF au même titre que `playing` — l'écran diffuse bien une image :
interrupteur coché, point pulsant, icône teintée, onde dans la scène 3D ; seul le compteur « en lecture » de
l'en-tête reste réservé à `playing`. Le libellé est « À l'écran · <appli> » (`media.on`). Le simulateur n'émet
pas `on`.

### Mise à jour 2026-09-10 — commande `media_player.stop` (fermer ce qui occupe le lecteur)

Ajout **additif** : `media_player.stop` (sans paramètre, `COMMAND_REQUIRES` → `playback`). Sens : ARRÊTER ce qui
occupe le lecteur, pas seulement suspendre — pour Cast, `STOP` de la session de l'appli sur le canal récepteur,
l'appareil revient à son écran d'accueil (`../3_plugins/3_6_google-cast.md`). C'est la bascule de l'interrupteur
d'un lecteur en état `on` (`lib/deviceState.ts : toggleCommand` : `playing` → pause, `on` → stop, sinon play) ;
patch optimiste `{ playback: 'idle', nowPlaying: undefined }` (`lib/optimistic.ts`). Le simulateur repasse
`idle` et oublie le morceau. Vérifié en réel : Netflix fermé sur le Chromecast depuis l'interrupteur.

### Mise à jour 2026-09-20 — capacité `play_url` et commande `media_player.play_url`

Ajout **additif** au kind `media_player` : capacité `play_url` (`KIND_CAPABILITIES`) et commande
`media_player.play_url { url, title?, artist?, artUrl? }` (`COMMAND_REQUIRES` → `play_url`). L'`url` est une chaîne HTTP(S)
bornée (`z.string().url().max(2048)` + refine `https?://`) — pas de `ftp`, pas de page web à
ouvrir. Sens : **charger et lire un flux** (MP3, AAC, HLS, webradio), distinct de `playback`
(lire / pause / stop sur la session déjà là). Les champs optionnels `title` / `artist` / `artUrl`
alimentent le DIDL Sonos et les métadonnées `LOAD` Cast (sinon le hostname de l'URL). Cast et Sonos
la déclarent ; un lecteur qui ne sait que télécommander une appli déjà ouverte ne la déclare pas.
Patch optimiste `{ playback: 'playing' }` (`lib/optimistic.ts`). Le simulateur déclare la capacité et
pose `nowPlaying` depuis `title` / `artist` / `artUrl` si fournis, sinon l'hôte de l'URL. Vérifié en
réel (une webradio) : Nest Mini, Play:3, barre de son, TV. Sources :
`packages/shared/src/devices/{kinds,command}.ts`, `../3_plugins/3_6_google-cast.md`,
`../3_plugins/3_15_sonos.md`.

### Mise à jour 2026-09-10 — `meta.forgettable` : un appareil que son plugin retient

Ajout **additif** à `deviceMetaSchema` : `forgettable?: boolean`. Sens : *le plugin garde cet appareil dans
son inventaire même absent du réseau*, et l'UI peut donc proposer de l'**oublier**, par convention
`DELETE /api/plugins/<plugin>/devices/<externalId>` (`1_3_protocole-rest-ws.md`). Absent = la liste du
plugin fait foi, il n'y a rien à oublier.

Un seul plugin le pose aujourd'hui : `google_cast`, dont la découverte est la seule source de vérité — un
Cast éteint ne s'annonce plus, il est donc retenu dans un fichier (`../3_plugins/3_6_google-cast.md`). Le
drapeau évite que l'UI code en dur le nom d'un plugin pour savoir si le geste existe : elle le propose
quand `meta.forgettable` est vrai, que l'appareil est **indisponible** et qu'il n'est **pas** dans la
maison (une entrée de maison qui vise un id oublié deviendrait une liaison morte).

### Mise à jour 2026-09-10 — `nowPlaying.live` : un flux en direct

Ajout **additif** au kind `media_player` : `nowPlaying.live?: boolean` (`packages/shared/src/devices/state.ts`).
Sens : **ce qui joue est un direct** (radio, chaîne d'info) — il n'a ni début où revenir, ni fin, ni
piste voisine. Absent = on ne sait pas, et on suppose un morceau ordinaire.

À ne pas confondre avec `durationS` absente, qui dit seulement « durée inconnue » : une appli native
de TV n'annonce pas de durée sans être un direct pour autant (Prime Video). Les deux informations
sont distinctes et servent à des choses différentes — la durée décide du curseur et du temps total,
`live` décide de ce qui a du SENS sur ce flux.

Ce que le contrat en tire, et qui vaut pour tout futur plugin `media_player` :
- `media_player.previous` et `media_player.next` n'ont pas d'objet sur un direct ; la règle « retour au
  début passé 3 s » (voir plus haut) ne s'y applique pas non plus, faute de début ;
- `media_player.seek` non plus ;
- lecture, pause, volume et sourdine, eux, restent valides.

Aucune capacité nouvelle : `track_skip` et `seek` restent des propriétés de l'**appareil** (il sait
faire), `live` une propriété de ce qui **joue** (il n'y a rien à faire ici). Un plugin déclare donc
toujours ses capacités, et publie `live` quand la session le dit. Le refus reste de sa
responsabilité : `google_cast` renvoie `UNSUPPORTED_COMMAND` sans rien envoyer à l'appareil
(voir `../3_plugins/3_6_google-cast.md`), l'UI grise les touches concernées.

### Mise à jour 2026-09-10 — `audioOutput` : où sort le son d'un lecteur

`mediaPlayerStateSchema` gagne **`audioOutput?: { terminal: 'internal' | 'external' | 'both'; name?: string }`**
(`packages/shared/src/devices/state.ts`) : où part le son de l'appareil quand il sait le dire. Relevé
sur une TV Sony (`../3_plugins/3_6_google-cast.md`) : `external` = un système audio branché (HDMI ARC,
optique) — c'est LUI qu'on entend, la TV n'émet que l'image ; `name` = le nom que l'appareil donne à ce
système (nom CEC, « Flexus 300 »). Absent = inconnu (la plupart des lecteurs ne le disent pas). L'état
reste ce que l'appareil dit **de lui-même** : quel appareil joue ce son est un lien de la maison
(`meta.audioOutput`, `../2_maison/2_0_format-house-json.md`), résolu côté web (`../1_architecture/1_4_app-web.md`).

### Mise à jour 2026-09-11 — `productionW` n'est jamais négative

`energyStateSchema.productionW` porte désormais son invariant en commentaire, comme `gridW` et
`batteryW` portent déjà le leur : *« Jamais négatif : un champ photovoltaïque produit ou ne produit
pas, il ne consomme pas. »* (`packages/shared/src/devices/state.ts`).

**Un commentaire, et non un `.min(0)` zod** : une borne dans le schéma ferait **rejeter** le patch
entier au lieu de le corriger, et l'état cesserait de bouger — un appareil figé sur sa dernière valeur
est pire qu'une valeur à zéro. Le contrat dit donc ce qui est vrai, et c'est à chaque plugin de
traduire le travers de son matériel avant d'émettre : la passerelle Enphase lit quelques watts à
l'envers la nuit (veille des onduleurs), son plugin les ramène à zéro
(`../3_plugins/3_7_enphase.md`).

La règle vaut au-delà de ce champ : **le contrat décrit ce que l'UI a le droit de croire**, le plugin
est responsable de le respecter, et l'UI n'a pas à se défendre contre des valeurs impossibles.

### Mise à jour 2026-09-13 — `maxValue` : le record que l'appareil tient lui-même

`SensorState` gagne un champ optionnel `maxValue` : **la plus haute valeur jamais rapportée par
l'appareil, quand c'est LUI qui la tient**. Une passerelle Enphase publie ce chiffre pour chacun de
ses micro-onduleurs (`maxReportWatts`) ; la plupart des capteurs n'ont rien de tel, d'où
l'optionnalité — absent veut dire « l'appareil ne le dit pas », jamais « zéro ».

Ce que ce champ N'EST PAS, et c'est tout l'intérêt de le nommer « record » : ce n'est pas une
caractéristique de l'appareil. Il dit ce qui s'est produit un jour de beau temps, pas ce que le
matériel sait faire. Sur un vrai parc d'onduleurs identiques, les records relevés s'étalent
sans plateau : en déduire la puissance de sortie de l'onduleur serait inventer une
fiche technique à partir de la météo. Celle-ci se déclare donc à la main sur le champ de panneaux
(`maxOutputW`, cf. [format house.json](../2_maison/2_0_format-house-json.md)), et l'app montre les
deux côte à côte.

Un record ne s'efface pas quand l'appareil se tait : la nuit rend un onduleur indisponible, son
record reste. Sources : `packages/shared/src/devices/state.ts`,
`apps/server/src/plugins/enphase/mapping.ts`.


### Mise à jour 2026-09-13 — ce qu'un véhicule connecté dit aussi (`VehicleState`)

Six champs **optionnels** s'ajoutent à `vehicleStateSchema` pour le plugin Tesla
(`../3_plugins/3_8_tesla.md`), sans rien changer aux champs existants ni à la simulation :

| Champ | Sens |
|---|---|
| `sleepState` | `VEHICLE_SLEEP_STATES` = `online` / `asleep` / `offline`. **`asleep` est un état normal**, pas une panne : le véhicule coupe son ordinateur au bout d'un quart d'heure d'arrêt. `available` reste vrai, les autres valeurs sont les DERNIÈRES connues. `offline` = injoignable par le fabricant. |
| `speedKmh` | vitesse instantanée, 0 à l'arrêt ; absente = inconnue |
| `gear` | `VEHICLE_GEARS` = `P` / `R` / `N` / `D` ; absent = inconnu |
| `tirePressureBar` | `{ fl, fr, rl, rr }` en bar, **chaque roue optionnelle** : les capteurs ne rapportent qu'en roulant, un véhicule qui n'a pas bougé n'en donne aucune |
| `insideTempC`, `outsideTempC` | températures |

Règle appliquée par le mappage Tesla, transposable : un `null` du fabricant devient un champ **absent**
du patch (« je ne parle pas de ce champ »), jamais un zéro — sauf là où le fabricant veut dire zéro
(une vitesse `null` à l'arrêt). Une pression de pneu `null` n'est pas 0 bar. Sources :
`packages/shared/src/devices/state.ts`, `apps/server/src/plugins/tesla/mapping.ts`.


### Mise à jour 2026-09-14 — `VehicleState.readAt` et la commande `vehicle.refresh`

`readAt` (ms epoch, optionnel) : date de la dernière lecture COMPLÈTE du véhicule, distincte de
`updatedAt` que n'importe quel patch (la veille) fait bouger. Sur une API facturée et un véhicule qui
dort, les valeurs ont un âge et l'UI doit le montrer. `vehicle.refresh` (capacité `soc`) demande une
relecture immédiate ; un plugin y répond par une lecture facturée, jamais par un réveil. Sources :
`packages/shared/src/devices/{state,command}.ts`, `3_plugins/3_8_tesla.md`.


### Mise à jour 2026-09-14 — `VehicleState.headingDeg`

Cap du véhicule (degrés, 0 = nord, sens horaire, dans [0, 360]), optionnel : c'est ce qui oriente
son marqueur sur la carte de la vue Véhicules. Tesla le donne (`drive_state.heading`), la
simulation le calcule vers sa destination. Sources : `packages/shared/src/devices/state.ts`,
`apps/server/src/plugins/tesla/mapping.ts`, `packages/mock-sim/src/behaviours/ev.ts`.


### Mise à jour 2026-09-14 — `locked` devient optionnel : tous les constructeurs ne le disent pas

`vehicleStateSchema.locked` passe de `z.boolean()` à `z.boolean().optional()`, et `defaultState`
(`packages/shared/src/devices/rules.ts`) ne pose plus `locked: true` sur un véhicule neuf.

Motif : la **Renault 5 E-Tech répond 404 `err.func.wired.notFound`** sur son endpoint `lock-status`
(cf. `../3_plugins/3_9_renault.md`). Le défaut du contrat affirmait « verrouillé » pour un véhicule
dont on ne sait rien — exactement le mensonge que la `position` optionnelle d'un ouvrant avait déjà
écarté ailleurs dans ce fichier. **Absent = inconnu**, et l'UI écrit « — ».

Conséquence côté web : `VehiclesView.vue` a un `locked()` qui rend « — », et le jeton de
`VehicleCard.vue` disparaît quand l'état est inconnu (un cadenas ouvert se lirait « déverrouillé »).
Le BOUTON de verrouillage, lui, n'a pas bougé : il suit la capacité `lock`, qu'un plugin sans
verrouillage ne déclare pas.

Sources : `packages/shared/src/devices/state.ts`, `packages/shared/src/devices/rules.ts`,
`apps/web/src/views/VehiclesView.vue`, `apps/web/src/components/controls/VehicleCard.vue`.


### Mise à jour 2026-09-14 — la charge dit ce qu'il lui reste, et ce qu'elle ne sait pas

Trois ajouts au `vehicleStateSchema`, tous optionnels, tous issus de ce que les fabricants donnent
VRAIMENT (capture Renault du 14/09 voiture en charge, fixtures Tesla) :

- **`chargeMinutesRemaining`** — minutes avant la fin de charge **telles que le VÉHICULE les
  estime** (Tesla `time_to_full_charge`, en heures décimales ; Renault `chargingRemainingTime`, en
  minutes). Jamais un calcul de Kasbah, qui ne connaît ni la courbe de charge ni le chauffage de la
  batterie. Les deux fabricants **laissent traîner** ce champ une fois la charge finie — la capture
  R5 le datait de l'avant-veille — d'où la règle des deux mappages : hors charge, on l'**efface**
  (`null`) plutôt que de l'afficher.
- **`socMin`** — plancher de charge voulu par l'utilisateur (`socMin` de `ev/soc-levels` chez
  Renault, seuil de la décharge V2L comprise). **Tesla n'a pas cette notion** : le champ reste
  absent, et la jauge ne montre alors qu'un repère au lieu de deux.
- **`chargePowerW`** est précisé, pas modifié : c'est la puissance **telle que le véhicule la dit**.
  Absente = il ne la dit pas.

Et une capacité de plus, `charge_power` (`kinds.ts`), de la famille **lecture** comme `soc`,
`range` ou `location` — elle ne porte aucune commande. Elle dit : « ce véhicule DONNE sa puissance
de charge instantanée ». Tesla la déclare (`charger_power`), Renault non (absence vérifiée voiture
en charge, cf. `../3_plugins/3_9_renault.md`). C'est elle qui permet à l'UI de ne demander une
capacité de batterie qu'à qui en a besoin.

### Mise à jour 2026-09-14 — `estimateChargePowerW` : une règle pure, et rien d'estimé dans l'état

Pour un véhicule sans `charge_power`, la puissance se **déduit de ce que la voiture annonce** :
l'énergie qui reste à mettre (`chargeLimit − soc`, sur la capacité de la batterie) divisée par le
temps qu'elle se donne (`chargeMinutesRemaining`). Exemple : 6 points sur 52 kWh en
43 min ≈ 4,4 kW.

Écartée, la **pente de `soc`** entre deux relevés : un point de charge vaut un demi-kWh, le sondage
est à dix minutes, le bruit d'arrondi dépasserait le signal. La voiture, elle, estime en continu.

La fonction vit dans `rules.ts`, avec les autres règles pures, et rend `undefined` dès qu'il n'y a
rien à estimer (pas de capacité saisie, véhicule qui donne déjà sa puissance, cible ou temps
inconnus) ou que le calcul mentirait : moins de 2 points à mettre, moins de 5 minutes restantes (le
courant s'effondre sur les derniers pourcents), résultat hors de [200 W, 150 kW]. Le reste est
arrondi à la centaine de watts — le calcul n'en dit pas plus.

**Où elle N'est PAS.** Un premier jet mettait l'estimation dans le plugin Renault, avec un champ
d'état `chargePowerEstimated` et une capacité de batterie en variable d'environnement
(`RENAULT_BATTERY_KWH`). Les deux ont été retirés le jour même : la capacité est une valeur que
**seul l'utilisateur** connaît (aucun fabricant ne la donne, cf. `../2_maison/2_0_format-house-json.md`),
elle vit donc dans la maison ; et un état qui mêle mesures et déductions ne se lit plus. L'état
reste ce que le fabricant a répondu, l'estimation se fait **à l'affichage**.

Sources : `packages/shared/src/devices/{state,kinds,rules}.ts`, test `rules.test.ts`,
`apps/server/src/plugins/{tesla,renault}/mapping.ts`, `apps/web/src/views/VehiclesView.vue`.

### Mise à jour 2026-09-15 — `meta.vehicle` : ce que le fabricant dit de la CARROSSERIE

Nouveau sous-objet de `deviceMetaSchema`, sur le modèle de `meta.cover` / `meta.camera` :

```ts
vehicle: { color?: '#rrggbb', finish?: 'solid' | 'metallic' | 'matte' }
```

- **`color`** : la teinte réelle du véhicule, quand le relevé permet de la déduire. Renault l'encode
  dans la référence de configuration de ses images, Tesla la nomme dans `vehicle_config` — voir
  `../3_plugins/3_9_renault.md` et `../3_plugins/3_8_tesla.md`.
- **`finish`** : l'aspect de la peinture, dans le vocabulaire que le fabricant emploie lui-même
  (le « Coloriseur » d'une Tesla propose Unie / Métallique / Mate). Ce n'est pas une coquetterie :
  c'est ce qui décide si la voiture renvoie le ciel ou l'absorbe, et l'écart se voit au premier
  coup d'œil dans la scène.

Absents = **on n'a rien trouvé**, et ce n'est pas une panne : la plupart des plugins ne disent rien
de la peinture. C'est un DÉFAUT, jamais une vérité — le réglage de la maison
(`HouseDevice.bodyColor` / `bodyFinish`) l'emporte toujours, parce qu'un covering, une repeinte ou
simplement un goût le contredisent. Voir `../2_maison/2_0_format-house-json.md`.

`VEHICLE_FINISHES` rejoint `COVER_CLASSES` et consorts dans `packages/shared/src/devices/kinds.ts`.
`hexColorSchema` est descendu de `house/schema.ts` vers `devices/descriptor.ts` : `house/` importe
`devices/`, l'inverse ferait un cycle. `house/schema.ts` le ré-exporte, les imports existants ne
bougent pas.

Sources : `packages/shared/src/devices/descriptor.ts`, `packages/shared/src/devices/kinds.ts`.

### Mise à jour 2026-09-16 — kind `weather` : la météo au-dessus de la maison

Nouveau kind **`weather`**, en lecture seule comme `camera` (aucune commande), **un appareil par
plugin** (`externalId: 'home'`, sa position est `house.origin`). Capacités `forecast`,
`air_quality`, `pollen` : elles disent ce que la vue peut afficher en plus de l'actuel, qui est
implicite ; un fournisseur sans pollens ne déclare pas `pollen` et la vue ne montre pas de section
vide.

L'état (`weatherStateSchema`) porte ce que le widget, la scène 3D et une future routine ont besoin
**sans rien demander** : `condition` (neuf mots, `WEATHER_CONDITIONS`, indépendants du fournisseur —
Open-Meteo parle en codes WMO), `tempC`, `humidity`, `windKmh`, `windDirDeg`, `cloudCover`, `isDay`,
`sunrise` / `sunset` (jour courant, ms epoch) et `observedAt` (heure de l'observation, distincte
d'`updatedAt`) sont obligatoires ; `feelsLikeC`, `dewPointC`, `pressureHpa`, `windGustKmh`, `precipMm`,
`precipProbability`, `visibilityM`, `uvIndex`, `aqi`, `aqiLevel` (`AQI_LEVELS`, paliers EAQI de 20,
`aqiLevelOf`), `pollen` (`POLLEN_TYPES`, niveaux 0-4) sont optionnels — absent = le fournisseur ne le
dit pas, jamais un zéro. Pourcentages sur 100 comme partout (`climate.humidity`) ; la scène 3D, qui
pense en 0-1, convertit.

**Les prévisions ne sont pas dans l'état.** Horaire 24 h + quotidien 7 j pèsent plusieurs Ko et
changent à chaque sondage : elles se lisent **à la demande**, `GET /api/devices/:id/forecast`, au
schéma partagé `weatherForecastSchema` (`packages/shared/src/protocol/http.ts`) — même arbitrage que
l'historique énergie. `meta.weather.attribution` est **obligatoire** (données CC BY 4.0),
`meta.weather.model` facultatif.

Sources : `packages/shared/src/devices/{kinds,state,descriptor,rules}.ts`, `packages/shared/src/protocol/http.ts`,
`packages/shared/src/devices/rules.test.ts`.

### Mise à jour 2026-09-16 — l'état `mower` s'étoffe pour un vrai robot (Husqvarna)

Le kind `mower` n'avait que ce que la simulation savait dire : activité, batterie, prochain départ,
`errorMessage`, `position` locale. Un robot Husqvarna (`../3_plugins/3_11_husqvarna-automower.md`)
dit plus, et autrement :

- **`location { lat, lon, at }`** : la position en GPS, comme un véhicule — le plugin ne connaît pas
  le repère de la maison, c'est la scène qui projette. `position` (locale, la simulation) prime si
  les deux sont là.
- **`errorCode`** et **`errorAt`** à côté d'`errorMessage` : le code du fabricant est ce que le
  support demande ; le texte reste celui du fabricant (anglais), pas une traduction.
- **`restrictedReason`** (`MOWER_RESTRICTIONS` : `none`, `week_schedule`, `park_override`, `sensor`,
  `daily_limit`, `fota`, `frost`, `all_work_areas_completed`, `external`, `not_applicable`) : pourquoi
  le robot ne tond pas alors qu'il pourrait.
- **`cuttingHeight`** (1 à 9), **`statusAt`** (dernier statut REÇU par le fabricant, plus vieux
  qu'`updatedAt` quand le robot ne parle plus), **`statistics`** (secondes, mètres, nombres, tous
  facultatifs).
- **`stopped`** rejoint `MOWER_ACTIVITIES` : bouton STOP, arrêt dans le jardin, robot éteint — ni
  garé, ni en pause. La simulation et `MowerControl.vue` n'ont rien eu à changer (clé i18n ajoutée).

Tout est optionnel : un patch peut effacer `nextStartAt`, `errorCode`, `errorMessage`, `errorAt`
par `null` (un robot qui repart n'a plus d'erreur).

Sources : `packages/shared/src/devices/state.ts`, `apps/server/src/plugins/automower/mapping.ts`.

### Mise à jour 2026-09-16 (nuit) — capacité `journal` et `DeviceJournal`

Un appareil peut tenir un **journal** de ce qui lui arrive (erreurs, avertissements) : la tondeuse
Husqvarna le publie (`GET /mowers/{id}/messages`). C'est un historique, pas un état : il suit le
précédent des prévisions météo — capacité **`journal`** (légale sur `mower`, à étendre au besoin),
données servies à la demande par `GET /api/devices/:id/journal`, schéma `deviceJournalSchema`
(`protocol/http.ts`) : `entries[]` du plus récent au plus ancien, chacune `{ at, severity, code?,
message, location? }` avec `JOURNAL_SEVERITIES = info | warning | error | fatal`. Le `message` est
le texte du fabricant, pas une traduction ; `location` n'est là que si l'appareil savait où il était.

Sources : `packages/shared/src/devices/kinds.ts`, `packages/shared/src/protocol/http.ts`.

### Mise à jour 2026-09-17 — le kind `water` (station de traitement de l'eau)

Douzième kind, créé pour la station COMAP Proteo 2 : `water`. *(Constat du lint du 2026-10-06 : dans `DEVICE_KINDS`, `water` est le treizième ; `camera` et `weather` le précèdent.)* Motif désormais habituel — un
appareil trop riche pour `sensor`, qui ne porte qu'**une seule** valeur numérique, alors qu'une
station publie quatre usures indépendantes, un débit et trois fenêtres de consommation. Mêmes
précédents que `weather` (créé pour Nest) et `mower` (étoffé pour Automower).

Capacités : `consumables`, `water_flow`, `water_usage`, `uv_lamp`. Elles disent ce que la station
SAIT dire, et changent d'un modèle à l'autre dans une même gamme (toutes n'ont pas de lampe
UVc) : sans la capacité, la carte omet la section au lieu d'en afficher une vide — même rôle que
`forecast` / `air_quality` / `pollen` pour la météo. **Aucune commande** : les réglages restent
sur l'écran de la station, et une fausse manœuvre à distance sur de l'eau potable coûterait plus
cher que le confort gagné. Le protocole sait pourtant écrire : c'est un choix, pas une limite.

**Tous les champs de mesure de `waterStateSchema` sont optionnels**, et c'est le point de
contrat qui mérite attention : avant la première lecture réussie, « absent » se lit « inconnu ».
Un `0 %` d'usure ou un `0 L` de consommation affirmerait une mesure qu'on n'a pas — même
raisonnement que `cover.position`. `defaultState` se réduit donc à `{ kind, ...base }`, comme
`camera`.

Coût d'un kind de plus, mesuré à cette occasion : **sept** endroits dans `apps/web` (trois
`Record<DeviceKind>` exhaustifs et quatre `switch`) que la compilation signale d'elle-même, plus
une case à cocher dans le mock, qui reste vide tant que `packages/mock-sim` ne simule pas le
kind. Le serveur, lui, ne bronche pas. C'est un filet fiable : aucun de ces sept points n'a été
trouvé par relecture, tous par `tsc`.

Voir [../3_plugins/3_12_comap-proteo](../3_plugins/3_12_comap-proteo.md).

### Mise à jour 2026-09-17 (bis) — la recherche de la vue Maison ne demande RIEN au contrat

Une fonctionnalité qui aurait pu coûter un champ au contrat et une ligne à chaque plugin n'a coûté
ni l'un ni l'autre, et c'est le genre de non-événement qui mérite d'être noté : la **barre de
recherche** de la vue Maison (voir `../4_ui/4_1_navigation-et-panneaux.md`) cherche sur ce que le
descripteur porte **déjà** — `name`, `kind`, `meta.room`, et depuis ce jour `meta.manufacturer` /
`meta.model` comme second rang de correspondance (« proteo » doit trouver la station COMAP, dont le
nom d'usage est « Traitement de l'eau »).

**Aucun champ ajouté à `deviceDescriptorSchema`, aucun plugin modifié, aucune déclaration de
« mots-clés » à écrire côté fabricant.** Le point d'extension est resté **côté web** : une boucle
par famille dans `apps/web/src/composables/useSearch.ts`. Un plugin qui arrive demain est
cherchable le jour de son premier `publish`, sans rien savoir de la recherche — c'est ce que vaut
un contrat où le nom et la marque sont des champs de premier ordre plutôt que du `meta` libre.

Le corollaire à garder en tête : `meta.manufacturer` et `meta.model` **cessent d'être décoratifs**.
Un plugin qui les laisse vides rend ses appareils introuvables par la marque, et un plugin qui y
écrit une chaîne de débogage la montre à l'utilisateur, puisque la ligne de résultat affiche
l'alias à la place du lieu quand c'est par lui qu'on est arrivé.

### Mise à jour 2026-09-17 (ter) — `meta.climate.control` et `meta.climate.deviceClass`

Deux champs neufs dans `meta.climate`, **tous deux facultatifs et sans aucun effet sur l'existant** :
absents, ils valent `thermostat` / `room`, c'est-à-dire exactement le comportement des appareils
`climate` d'avant (simulation et thermostat Nest). Aucun plugin existant n'a été touché.

Ils viennent du plugin MELCloud (`../3_plugins/3_13_mitsubishi-melcloud.md`), et ils répondent à
**deux questions différentes** qu'un même kind mélangeait :

- **`control: 'room' | 'flow'` — SUR QUOI la zone se règle.** Une pompe à chaleur air-eau pilote
  certaines zones sur la température de l'**eau de départ** (loi d'eau) : la consigne y vaut 45 °C et
  le « mesuré » est celui du circuit, pas d'un salon. Le champ **ne change rien à la forme de
  l'état** — `currentTempC` et `targetTempC` restent les deux mêmes champs aux deux mêmes places ; il
  dit **de quoi ils parlent**, donc **comment les nommer**. Concrètement il décide le VOCABULAIRE :
  « Eau de départ » / « Consigne de départ » au lieu de « Température » / « Consigne »
  (`climate.flowCurrent` / `climate.flowTarget` dans l'i18n, lues par `ClimateControl.vue`).
  Sans lui, 45 °C se lirait comme une consigne de pièce — un chiffre juste, un sens faux.
- **`deviceClass: 'thermostat' | 'heat_pump'` — ce que l'appareil EST.** Même rôle que
  `meta.mediaPlayer.deviceClass` pour un lecteur : `CLIMATE_CLASSES` dans `kinds.ts`, et ça ne
  décide **que le marqueur 3D**. Un thermostat reste la pastille couchée de 12 cm contre le mur ;
  une pompe à chaleur devient un **bloc au sol de 60 × 36 × 120 cm** (cotes constructeur arrondies
  d'une hydrobox Ecodan, `HEATPUMP_BOX` dans `three/markers/markers.ts`). Dessiner une installation
  entière en pastille murale la faisait passer pour un boîtier de salon.

La séparation est délibérée : **une zone en loi d'eau n'est pas forcément une machine, et une
machine n'est pas forcément en loi d'eau.** Les fondre en un seul champ « genre de chauffage » aurait
lié le vocabulaire au marqueur, et il aurait fallu les redéfendre l'un contre l'autre au premier
fabricant qui les combine autrement.

Effet de bord utile, découvert en branchant un vrai appareil `climate` : `ClimateControl.vue` était
**le seul contrôle à ne pas consulter les capacités** — la simulation les déclarait toutes, et aucun
appareil réel de ce kind n'existait. Une pompe à chaleur lue en seule lecture l'a démasqué. Les
boutons suivent désormais `target_temp` / `hvac_mode`, et **la valeur reste montrée dans tous les
cas** : c'est le geste qui manque, pas le chiffre.

### Mise à jour 2026-09-19 — capacité `mop` et deux champs d'aspirateur

Le kind `vacuum` n'avait pas bougé depuis l'origine ; le premier robot réel du parc, un Roomba
**Combo** ([../3_plugins/3_14_irobot-roomba.md](../3_plugins/3_14_irobot-roomba.md)), y ajoute trois
choses, **toutes facultatives** — une maison sans robot laveur ne voit aucune différence.

- **Capacité `mop`** (`KIND_CAPABILITIES.vacuum`) : « cet appareil **lave** en plus d'aspirer, et dit
  ce qu'il faut pour savoir s'il le peut ». Un aspirateur sec ne la déclare pas, et **la section
  n'apparaît pas** plutôt que de s'afficher vide.
- **`vacuumStateSchema.mopAttached`** (booléen facultatif) : le patin de serpillière est-il posé.
  Absent = le robot ne le rapporte pas.
- **`vacuumStateSchema.tankLevel`** (pour cent facultatif) : l'eau restante. **Absent aussi quand le
  RÉSERVOIR n'est pas en place** — les deux se confondent **volontairement**, parce qu'un réservoir
  retiré et un niveau inconnu appellent le même geste : aller voir la machine. À ne pas confondre
  avec `binFull`, qui parle du bac à poussière.

**Deux champs et pas cinq**, et c'est la décision à retenir : le robot publie aussi `padWetness`,
`padDryAllowed` et `padWashAllowed`, qui sont des **réglages de sa station de lavage**, pas un état
d'appareil. Le contrat s'arrête à ce qu'on lit pour décider quoi faire — même partage qu'ailleurs :
le champ entre quand une vue le lit, pas quand un fabricant le publie.

Les deux valeurs sont **mesurées, pas déduites** (détail et méthode sur la page du plugin) : le
niveau d'eau n'a été reconnu comme un **pour cent** qu'en le confrontant à la goutte quasi vide de
l'appli du fabricant au même instant, et le patin ne se lit que par la négative, `detectedPad` ne
valant `"invalid"` que patin retiré.

### Mise à jour 2026-09-19 — `readAt` date les VALEURS, pas l'appel qui les a rapportées

La définition n'a pas changé (« date de la dernière lecture COMPLÈTE du véhicule ») ; c'est sa
**lecture par les plugins** qui était trop littérale, et le plugin Renault l'a payée.

Kamereon ne va pas chercher la voiture : il rend le **dernier état qu'elle a remonté**, et son
boîtier se tait dès qu'elle dort. Dater `readAt` de notre appel HTTP revient donc à certifier la
fraîcheur d'une donnée qu'on n'a pas relue. Le 2026-09-19, l'UI annonçait **« lu il y a 4 min »
au-dessus de chiffres vieux de plusieurs heures**, faute de voir que la voiture avait décroché. Le plugin publie depuis `battery-status.timestamp`
(`apps/server/src/plugins/renault/mapping.ts`), et retombe sur l'heure de l'appel seulement si le
fabricant ne date rien.

C'est exactement ce que la mise à jour du 2026-09-14 annonçait — « sur une API facturée et un
véhicule qui dort, les valeurs ont un âge et l'UI doit le montrer ». **La règle : quand le fabricant
date sa donnée, c'est SA date qui gagne.** Et là où Tesla dit sa veille par un `sleepState`, la R5
n'a aucune notion de veille : `readAt` y est **le seul signe** qu'elle s'est tue. Sources :
`packages/shared/src/devices/state.ts`, `apps/server/src/plugins/renault/mapping.ts`,
`../3_plugins/3_9_renault.md`.


### Mise à jour 2026-09-21 — deux kinds d'animalerie, et une UNITÉ qui se déclare

`pet_feeder` et `pet_fountain` entrent au contrat (plugin PetKit, `../3_plugins/3_17_petkit.md`).
**Deux kinds et non un seul avec des classes** : une mangeoire et une fontaine ne partagent aucune
commande, et la règle du contrat est qu'un kind est une famille de commandes.

Capacités neuves : `feed` (servir une ration hors du plan de repas), `call_pet` (jouer le son
enregistré), `pump_mode`. Réutilisées telles quelles : `on_off`, `battery`, `consumables`
(dessiccant d'un côté, filtre de l'autre) et `water_usage` — qui ne veut PAS dire « un volume » :
une Eversweet Max compte les **passages** de l'animal, pas des millilitres (`drinksToday`,
`drinkAvgS`).

Ce que cet ajout apprend et qui dépasse PetKit :

- **`meta.petFeeder.unit` : l'unité n'est pas une propriété du kind, c'est une propriété de
  l'APPAREIL.** Une Fresh Element Solo compte en dixièmes de TASSE (elle le déclare elle-même,
  `settings.factor: 10`), une Fresh Element Infinity pèse en grammes — deux modèles de la même
  gamme. Les champs s'appellent donc `servedToday` / `plannedToday` / `eatenToday`, sans suffixe
  d'unité, et le descripteur dit dans quoi ils sont comptés. Ils s'étaient d'abord appelés
  `…G` et l'interface écrivait « 30 g » pour trois dixièmes de tasse : un facteur dix.
- **`meta.petFeeder.portions` : une liste, pas un intervalle.** Le fabricant n'accepte que cinq
  valeurs sur ce modèle ; un curseur mentirait. Le serveur refuse ce qui n'y est pas plutôt que de
  laisser arrondir en silence.
- `PET_PUMP_MODES` vaut `continuous` / `intermittent`. Ces deux-là s'étaient d'abord appelés
  `normal` / `smart`, et `smart` était traduit « à l'approche » — un contresens : l'appli du
  fabricant affiche un cycle en minutes, c'est une minuterie et non une détection de présence.
- `eatenToday` est **absent** d'un modèle sans plateau pesant, et `nextMealAt` / `nextMealAmount`
  se déduisent du plan hebdomadaire du fabricant. `pet_fountain.syncedAt` date le relevé, comme
  `readAt` pour un véhicule : une fontaine Bluetooth n'est jamais en temps réel.

Sources : `packages/shared/src/devices/{kinds,state,command,descriptor}.ts`.

### Mise a jour 2026-09-21 — kind `fan`, listes de crans, lien d'accessoires

Nouveau kind `fan` : capacites `on_off`, `fan_speed`, `fan_direction`, `fan_timer`,
`mute` (ici = bip d'accuse, pas le son d'un lecteur — double sens documente dans `kinds.ts`).
Commande unique `fan.set` (comme `light.set`). Etat : `on`, `speed`, `direction`,
`timerMin`, `muted`.

Dans `deviceMetaSchema` :
- `colorTempMirekSteps` : temperatures REELLEMENT applicables en mirek (module 3CCT) — liste,
  pas plage ; prioritaire sur `colorTempMirek` ;
- `fan.speeds` : vitesses acceptees (liste) ;
- `linkedTo` : l'accessoire pointe vers le principal (ventilateur → lumiere).

Sources : `packages/shared/src/devices/{kinds,state,command,descriptor,rules}.ts`,
`doc/3_plugins/3_18_tuya.md`.

## Mise à jour 2026-09-22 — `explicit` voyage avec le morceau

Le marquage **explicit** d'un titre n'est publié par AUCUNE enceinte : seul le service qui lance la
lecture le connaît (il vient du catalogue). Deux champs facultatifs, strictement additifs :

- `media_player.play_url` accepte `explicit?: boolean` — le service le passe avec le titre,
  l'artiste et la pochette ;
- `MediaPlayerState.nowPlaying` porte `explicit?: boolean` — absent = on ne sait pas, et l'UI ne
  marque rien.

Pourquoi l'ÉTAT, et non un champ de session du plugin qui a lancé la lecture : porté par l'état, le
marquage arrive partout où l'état se lit — barre de lecture, panneau « Écoute », détail d'un
appareil dans la vue 3D — sans plomberie supplémentaire côté web, et il survit à un rechargement de
page. Charge aux plugins d'enceinte de le REPOSER à chaque relevé (voir `../3_plugins/3_15_sonos.md`).

Sources : `packages/shared/src/devices/{command,state}.ts`,
`apps/server/src/plugins/{sonos,google_cast}/index.ts`, `../4_ui/4_1_navigation-et-panneaux.md`.

## Mise à jour 2026-09-23 — `live` sur `media_player.play_url` : le service dit que c'est un direct

`media_player.play_url` accepte un champ facultatif de plus, **`live?: boolean`**
(`packages/shared/src/devices/command.ts`), strictement additif.

**Pourquoi** : jusque-là, les plugins d'enceinte déduisaient le direct de l'URL seule (`.m3u8` /
`.m3u`). Une radio Icecast servie en `.aac` ou `.mp3` **ressemble à un fichier** : rien dans l'adresse
ne dit que c'est un direct. Seul le service qui lance la lecture le sait — le plugin `radio` l'envoie
toujours à `true` (`../3_plugins/3_19_radio.md`).

**Côté état, rien de nouveau** : `nowPlaying.live` existait déjà (ni piste voisine, ni début, ni
curseur). Le champ de commande sert à le faire publier par l'enceinte. Même schéma que `explicit`
(section du 2026-09-22 ci-dessus) : la donnée descend du service, et les plugins d'enceinte doivent la
**reposer à chaque relevé** puisque l'enceinte ne la redit pas (`../3_plugins/3_15_sonos.md`,
`../3_plugins/3_6_google-cast.md`). Absent = l'enceinte continue de deviner d'après l'URL.

Sources : `packages/shared/src/devices/command.ts`, `apps/server/src/plugins/{sonos,google_cast}/{mapping,index}.ts`,
`apps/server/src/plugins/radio/index.ts`.

### Mise à jour 2026-09-23 — `activity.ts` : la lecture « actif ? » passe dans le contrat

Le serveur en a eu besoin pour les automatisations (« une lumière est allumée dans la pièce », « la
TV marche », `1_8_automatisations.md`). `isDeviceOn`, `isMediaActive`, `coverWords`, `isFlatCover`,
`coverAtRest` et `coverActivity` ont donc quitté `apps/web/src/lib/deviceState.ts` et
`apps/web/src/lib/cover.ts` pour `packages/shared/src/devices/activity.ts`, **à l'identique**. Les deux
fichiers web les ré-exportent : aucun appelant de l'interface n'a changé. Ce qui reste côté web est
l'affichage (`toClosure`, `coverRestKey`, libellés…).

Nouveau dans le même fichier : **`deviceClassOf(descriptor)`**, la nature d'un appareil tous kinds
confondus (`meta.cover` / `mediaPlayer` / `camera` / `sensor` / `climate` `.deviceClass`), avec les
**défauts du contrat** déjà écrits ailleurs : un `media_player` muet sur sa nature est une enceinte
(`speaker`), un `climate` un `thermostat`. Absent = le kind n'a pas de nature. C'est ce que filtre une
sélection « tous les volets » plutôt que « tous les ouvrants ».

Et dans `packages/shared/src/house/geo.ts` : **`HOME_RADIUS_M = 120`**, le rayon « à la maison » autour
de l'origine — plus tolérant que le polygone du terrain (une voiture garée dans la rue devant est
rentrée). Les vues web (`VehiclesView.vue`, `HouseScene.ts`, `VehicleCard`) déclarent encore chacune
leur propre constante de même valeur.

> **Corrigé le 2026-10-01** : plus de copie. `VehiclesView.vue`, `HouseScene.ts` et `VehicleCard.vue`
> importent `HOME_RADIUS_M` de `@kasbah/shared`, comme le serveur pour la coordination voiture ↔ borne
> (`apps/server/src/core/chargeCoordination.ts`) : une seule valeur, 120 m, inchangée (commit 8feaa09).

Sources : `packages/shared/src/devices/activity.ts`, `packages/shared/src/house/geo.ts`,
`apps/web/src/lib/{deviceState,cover}.ts`.

## Mise à jour 2026-09-24 — ouvrant : mode discret et batterie

Deux ajouts au kind `cover` (`packages/shared/src/devices/{kinds,state,command}.ts`), tous deux
optionnels, donc sans effet sur les ouvrants existants :

- **`quiet`** (capacité) + **`cover.set_quiet { on }`** (commande) + **`CoverState.quiet`** (état) :
  le moteur sait rouler en vitesse lente. C'est un réglage **tenu par le plugin**, appliqué aux
  manœuvres suivantes : la commande ne déplace rien. Premier usage : Somfy `setClosureAndLinearSpeed`
  (`../3_plugins/3_4_somfy-tahoma.md`).
- **`battery`** (capacité, déjà existante pour d'autres kinds, désormais légale sur `cover`) +
  **`CoverState.batteryPct`** : charge d'un moteur autonome (volet solaire). Même nom de champ que
  les appareils d'animalerie, `batteryPct` — pas `battery` comme l'aspirateur et la tondeuse, où la
  batterie est obligatoire.

Le panneau d'un volet solaire n'est PAS un champ du volet : c'est un appareil `sensor` à part
(`deviceClass: 'illuminance'`, `unit: 'lx'`) qui déclare **`meta.linkedTo`** vers lui — le lien
accessoire → principal déjà utilisé par le ventilateur et son plafonnier.

### Mise à jour 2026-10-01 — préconditionnement du véhicule

La capacité `climate_precondition`, déclarée dans `KIND_CAPABILITIES.vehicle` mais sans commande
jusqu'ici, en porte maintenant deux : **`vehicle.climate_start`** (`targetTempC` facultatif, 15-28 °C,
les bornes de Tesla ; absent = la consigne que la voiture garde) et **`vehicle.climate_stop`**.
`VehicleState` gagne **`climateOn`** et **`climateTargetC`**, facultatifs (absent = inconnu).
Le contrat dit qu'un plugin **peut réveiller** le véhicule pour honorer `climate_start` : c'est
l'objet même de la commande. La consigne est facultative pour la Renault 5 : son « climatiser »
immédiat n'en prend pas (il reprend le réglage commun de la voiture).
Implémenté par Tesla (`../3_plugins/3_8_tesla.md`) et le véhicule simulé, proposé dans les
automatisations (`vehicle.climate_start` avec la consigne en paramètre, `vehicle.climate_stop`).

### Mise à jour 2026-10-01 (bis) — climatisation commune : sièges, volant, ce que le véhicule sait faire

Demande de l'utilisateur : **une UI commune à tous les véhicules**, qui propose le maximum et grise
ce qu'un véhicule ne sait pas faire. Le contrat le porte ainsi :

- **`meta.vehicle.climate`** (descripteur) : `minC`, `maxC`, `stepC`, `seats` (parmi `VEHICLE_SEATS` :
  `fl`, `fr`, `rl`, `rc`, `rr`), `seatLevels` (3 = trois crans, 1 = marche / arrêt),
  `steeringWheelHeat`. Une seule entrée de méta plutôt qu'une capacité par option : la capacité
  `climate_precondition` dit « il y a une clim », la méta dit laquelle. Absente = marche / arrêt seuls.
- **`vehicle.climate_set`** : consigne, crans des sièges, volant, chacun facultatif (« pas touché »).
  Commande regroupée, sur le modèle de `light.set`. **Ne réveille jamais** la voiture, à l'inverse
  de `climate_start`.
- **`VehicleState.seatHeat`** (cran 0-3 par place) et **`steeringWheelHeat`**.

Piège : la fusion de l'état (`mergeState`) est **superficielle**. Un patch `{ seatHeat: { fl: 2 } }`
efface les autres places : un plugin publie toujours `seatHeat` en entier (Tesla le fusionne avec
son dernier état connu ; le patch optimiste de l'UI aussi).

## Mise à jour 2026-10-01 — la borne : mode sécurisé et arrêt qui bloque

Deux champs facultatifs, ajoutés pour la borne Enphase (`../3_plugins/3_7_enphase.md`) :

- **`EvChargerState.safeLimit?: boolean`** : la borne s'est repliée sur son intensité de sécurité
  (« mode sécurisé »), typiquement faute de mesure pour sa répartition de charge. `maxCurrentA` ne vaut
  alors plus. Absent = inconnu.
- **`meta.evCharger.stopUntilUnplug?: boolean`** (descripteur) : arrêter la borne la BLOQUE jusqu'au
  prochain débranchement, mode programmé compris. L'UI le dit sous Arrêter. Absent = un arrêt ordinaire.

Sources : `packages/shared/src/devices/{state,descriptor}.ts`.

## Mise à jour 2026-10-01 — `meta.vehicle.stopViaCharger`

**`meta.vehicle.stopViaCharger?: boolean`** (descripteur) : le véhicule ne sait pas arrêter sa charge à
distance, c'est la borne où il est branché que le serveur arrête (`vehicle.stop_charge` devient
`ev_charger.stop`, cf. `1_2_serveur-et-plugins.md`, même date). Absent = le véhicule s'arrête lui-même. Le
champ est déclaré par le véhicule : le serveur ne code pas « Renault » (la R5 le pose, `plugins/renault/mapping.ts`).
Facultatif, sans effet sur l'existant.

Sources : `packages/shared/src/devices/descriptor.ts`.

### Mise à jour 2026-10-02 — logiciel du véhicule

Deux champs facultatifs dans `vehicleStateSchema` : `softwareVersion` (version installée) et
`softwareUpdate` `{ status, version?, downloadPct?, installPct?, scheduledAt?, expectedDurationS? }`,
`status` parmi `VEHICLE_UPDATE_STATUSES` (`available`, `scheduled`, `downloading`, `waiting_wifi`,
`installing`). Rien en attente = pas de `softwareUpdate` (`null` dans un patch l'efface).

Deux capacités `vehicle` : `release_notes` (lecture : notes servies à la demande, comme `journal`)
et `software_update` (écriture : `vehicle.schedule_update { delayS }` 0-86 400 s, 0 = maintenant,
et `vehicle.cancel_update`). Les notes ne sont PAS dans l'état publié : c'est du contenu, qui change
une fois par version (`deviceReleaseNotesSchema`, voir `1_3_protocole-rest-ws.md`). Premier
fabricant : Tesla (`../3_plugins/3_8_tesla.md`) ; la R5 ne déclare ni l'une ni l'autre.

Sources : `packages/shared/src/devices/{state,kinds,command}.ts`.

### Mise à jour 2026-10-02 — alertes d'appareil et vigilance météo

**`deviceAlerts(deviceId, state)`** (`packages/shared/src/devices/alerts.ts`) : fonction pure qui
rend les alertes en cours d'un appareil d'après son seul état, ou `null` pour « on ne sait pas »
(appareil `available: false`, véhicule sans `readAt`, météo sans `vigilance`). `null` n'est PAS
« aucune alerte » : c'est ce qui évite à un client d'oublier une alerte fermée sur une simple panne
de lecture. Rien de neuf sur le fil. Elle vit dans `shared` pour que le serveur s'en serve plus tard
(automatisation, push, MCP) avec la même règle que l'écran.

`DeviceAlert` : `{ id, deviceId, kind, severity, type }`. `ALERT_SEVERITIES` = `info`, `problem`,
`critical` ; `type` = `software_update` | `device_error` | `vigilance`.

**L'id** est `deviceId|type|clé`, et la clé porte ce qui rend l'alerte NOUVELLE (une alerte fermée
ne revient pas tant qu'elle est la même) :
- véhicule : la version proposée (`softwareUpdate.version`), la même alerte sous tous les statuts
  de `softwareUpdate` (programmée, en téléchargement…) ; gravité `info` ;
- tondeuse : `errorCode@errorAt`, quand l'activité est `error` OU qu'un `errorCode` est présent
  (même règle que la ligne d'état de la vue Robots) ; `problem` ;
- aspirateur : `errorMessage`, activité `error` ; `problem` ;
- météo : `type:level@onset`. Le jaune est ignoré (il reste sur la page Météo), l'orange est
  `problem`, le rouge `critical`. Passer de l'orange au rouge change le niveau, donc l'id : nouvelle
  alerte.

**Météo : champ `vigilance`** (optionnel, `weatherStateSchema`) = les vigilances Météo-France EN
COURS sur le département de la maison, la plus forte d'abord : `{ type, level, onset, expires }`
(ms epoch), `level` parmi `VIGILANCE_LEVELS` (`yellow`, `orange`, `red`), `type` un phénomène
(`thunderstorm`, `wind`…, `other` si inconnu). `[]` = aucune ; absent = inconnu ; `null` dans un
patch l'efface (maison hors métropole). Les vigilances à venir et celles d'autres lieux restent à la
demande (`/api/plugins/open_meteo/alerts`, voir `../3_plugins/3_10_open-meteo.md`). Côté poste :
`../4_ui/4_1_navigation-et-panneaux.md`.

Sources : `packages/shared/src/devices/{alerts,state}.ts` (+ `alerts.test.ts`).

### Mise à jour 2026-10-02 — `ev_charger.resume_mode`

Nouvelle commande de borne, capacité `charge_control` : fin d'un forçage, la borne reprend le mode
choisi dans l'appli du fabricant au lieu d'obéir au dernier démarrer / arrêter, et rien si elle y
est déjà revenue. Le serveur l'envoie quand la voiture forcée atteint sa limite
(`1_2_serveur-et-plugins.md`, même date). La simulation la lit comme un retour à la charge permise.

Sources : `packages/shared/src/devices/command.ts`, `packages/mock-sim/src/behaviours/ev.ts`.

### Mise à jour 2026-10-12 — tondeuse : zones de travail, zones d'exclusion, carte du terrain

Trois capacités s'ajoutent au kind `mower` (`KIND_CAPABILITIES`, `packages/shared/src/devices/kinds.ts`),
**optionnelles** : un plugin ne les déclare que si son robot les a (l'Automower les déduit de
`attributes.capabilities`, voir `../3_plugins/3_11_husqvarna-automower.md`) :

- `work_areas` : la tondeuse connaît des zones de travail (tracées chez le fabricant) et sait partir en
  tondre une ;
- `stay_out_zones` : des zones d'exclusion qu'on active ou désactive ;
- `site_map` : elle publie la carte de son terrain, servie à la demande (route dans
  `1_3_protocole-rest-ws.md`, même date).

**Commandes** (`command.ts`) et capacité exigée (`COMMAND_REQUIRES`) :

| Commande | Champs | Capacité |
|---|---|---|
| `mower.start_in_area` | `workAreaId` (entier ≥ 0), `durationMin` (entier > 0, **requis**) | `work_areas` |
| `mower.set_stay_out_zone` | `zoneId` (chaîne), `enabled` | `stay_out_zones` |

La durée est requise parce que l'API Husqvarna l'exige pour `StartInWorkArea` ; `mower.start` garde sa
durée facultative (sans durée = reprendre le planning).

**État** (`mowerStateSchema`, `state.ts`) : `workAreas?: { id, name, enabled }[]` (un `name` vide est
légal : la zone `0`, tout le terrain, n'a pas de nom) et `stayOutZones?: { id, name, enabled }[]`
(`enabled` = le robot n'y entre pas). Absent = le robot n'en dit rien ; **liste vide = il gère les zones
et n'en a aucune** — la distinction est voulue (voir la page du plugin : la section est absente côté
fabricant tant qu'aucune zone n'a été tracée).

**Inverse d'automatisation** (`packages/shared/src/automations/inverse.ts`) : `mower.start_in_area` →
`mower.park` (jusqu'au prochain créneau), comme `mower.start` ; `mower.set_stay_out_zone` → la même
commande avec `enabled` inversé.

La simulation déclare les trois capacités (`../3_plugins/3_0_simulation-mock.md`).

Sources : `packages/shared/src/devices/{kinds,command,state}.ts`, `packages/shared/src/automations/inverse.ts`.

### Mise à jour 2026-10-12 (bis) — tondeuse : la tâche en cours

Deux champs d'état optionnels de plus sur `mower` (`packages/shared/src/devices/state.ts`) :

- `workAreaId` (entier ≥ 0) : la zone de travail où le robot tond, ou qu'il rejoint (`workAreas[].id` ;
  `0` = tout le terrain) ;
- `leaving` (booléen) : il est **en route** vers sa zone. L'activité reste `mowing` — on n'a pas ajouté de
  valeur à `MOWER_ACTIVITIES`, que lisent les automatisations, la scène et les contrôles ; ce champ
  précise seulement qu'il n'y est pas encore.

L'interface en tire une phrase (`apps/web/src/lib/mowerTask.ts`) : voir
`../4_ui/4_1_navigation-et-panneaux.md`, même date.
