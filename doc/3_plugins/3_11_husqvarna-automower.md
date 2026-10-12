# Plugin Husqvarna Automower (robot tondeuse, Automower Connect API)

> Dernière mise à jour : 2026-10-12
> Sources : `apps/server/src/plugins/automower/{index,auth,client,ws,mapping,state,types}.ts`, `apps/server/src/plugins/automower/__fixtures__/automower.ts`, tests `mapping.test.ts` et `plugin.test.ts`, `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/vehicles/VehicleMap.vue`, `apps/web/src/components/robots/MowerZones.vue`, `apps/web/src/lib/siteMap.ts`, `apps/server/.env.example`, bibliothèque de référence aioautomower (Thomas55555, `const.py`, `model/*.py`, `commands.py`, `session.py`, `utils.py`), documentation du binding openHAB « automower », demande de l'utilisateur du 2026-09-16 (Automower 435X AWD)

## Ce que le plugin fait, et ce qu'il ne fait pas encore

**Phase 1 (2026-09-16) : les infos de base, l'état, la position.** Un robot = un appareil `mower`
identifié par l'**UUID** que le fabricant lui donne. Publié : activité (`parked`, `mowing`,
`charging`, `returning`, `paused`, `stopped`, `error`), batterie, prochain départ, **erreur du
fabricant** (code et texte, tels que le support les connaît), ce qui retient le robot au garage
(`restrictedReason` : planning, pluie, gel, consigne…), hauteur de coupe, dernier statut reçu
(`statusAt`), **position GPS** (`location`) et compteurs de vie (`statistics`). Les capacités
déclarées sont `mow`, `park`, `battery`, `schedule` : les trois gestes de la vue
(`mower.start`, `mower.pause`, `mower.park`) sont traduits en actions du fabricant — c'était le
coût d'une ligne chacun, et le contrôle `MowerControl.vue` existant les émettait déjà.

*(Dépassé le 2026-09-16 (nuit, quater) : la capacité `journal` s'ajoute aux quatre autres (`CAPABILITIES` dans `apps/server/src/plugins/automower/mapping.ts`) — voir « Mise à jour 2026-09-16 (nuit, quater) — le journal du robot ».)*

Pas encore : la carte du robot (zones de travail, zones interdites — l'API ne publie **pas** le
câble périphérique, seulement des positions et des polygones), la hauteur de coupe et les phares
en écriture, la confirmation d'une erreur, les messages. Le robot de référence est un **435X AWD**
(GPS embarqué : il publie ses positions) ; au moment d'écrire il était en erreur — **« No loop
signal »**, code 2 — et c'est le premier cas que la vue devait rendre lisible.

*(Dépassé le 2026-09-16 (nuit, quater) : les messages du robot sont désormais lus — voir « Mise à jour 2026-09-16 (nuit, quater) — le journal du robot ». Carte, écritures et confirmation d'erreur restent à faire.)*

Il n'existe **rien en local** : tout passe par le cloud du fabricant, comme pour Nest et Tesla.

## Trois contraintes du fabricant, et ce qu'elles imposent

### 1. Une application, une clé, un secret — et c'est tout

Sur developer.husqvarnagroup.cloud, l'application doit être reliée aux **deux** API
« Authentication API » et « Automower Connect API ». Le jeton s'obtient en
**`client_credentials`** (`POST https://api.authentication.husqvarnagroup.dev/v1/oauth2/token`,
`grant_type=client_credentials&client_id=<clé>&client_secret=<secret>`) : il représente le compte
qui a créé l'application, donc le propriétaire du robot — le fabricant le dit lui-même, « this grant
type is intended only for you ». Pour un foyer c'est exactement ce qu'il faut : **ni consentement
dans un navigateur, ni page de retour, ni fichier de jetons** (le jeton vaut une journée et se
redemande à volonté, `auth.ts`). D'où seulement deux clés dans `.env` : `AUTOMOWER_APP_KEY`,
`AUTOMOWER_APP_SECRET`. Home Assistant passe par le code d'autorisation parce qu'il sert plusieurs
utilisateurs ; openHAB et ioBroker font comme ici.

Chaque appel REST porte trois en-têtes : `Authorization: Bearer`, `Authorization-Provider:
husqvarna`, `X-Api-Key: <clé>` ; le corps est du JSON:API (`application/vnd.api+json`). Base :
`https://api.amc.husqvarna.dev/v1`.

### 2. Un quota de 10 000 requêtes par mois et par clé (et une par seconde)

*(Dépassé le 2026-09-16 : le quota est de 21 000 requêtes par fenêtre de sept jours, pas de 10 000 par mois — voir « Contradiction détectée 2026-09-16 — le quota » ; `WINDOW_REQUESTS` et `WINDOW_MS` dans `apps/server/src/plugins/automower/state.ts`.)*

Ce n'est pas facturé comme chez Tesla, c'est **coupé** : au-delà, le fabricant répond 403 (rendu
`RATE_LIMITED`, comme le 429 de la cadence). D'où l'architecture :

- le **WebSocket** (`wss://ws.openapi.husqvarna.dev/v1`, `ws.ts`) porte le vivant, gratuitement :
  le fabricant y pousse la section qui change (`battery-event-v2`, `mower-event-v2`,
  `planner-event-v2`, `position-event-v2`, `cuttingHeight-event-v2` ; `headlights`, `calendar` et
  `message` sont ignorés). Format V2, le seul servi depuis mars 2025. *(Dépassé le 2026-09-16 (nuit, quater) : `message-event-v2` est lu et alimente le journal du robot.)* La poignée de main veut le
  `Bearer` en **en-tête**, ce que le `WebSocket` natif de Node refuse : d'où le paquet `ws`, passé en
  dépendance de production (il était déjà là par `@fastify/websocket`). Un ping par minute, une
  reconnexion avec backoff (5 s → 5 min) sur toute fermeture — le fabricant coupe vers deux heures —,
  et une **relecture complète à chaque reconnexion** : les événements manqués ne sont pas rejoués ;
- le **REST** ne sert qu'à l'état complet : au démarrage, à la reconnexion du flux, et à cadence
  lente (`AUTOMOWER_POLL_MS`, 10 min = 4 320 requêtes par mois). *(Voir le quota corrigé : 21 000 par fenêtre de sept jours, section « Contradiction détectée 2026-09-16 ».)* `GET /mowers` rend tout d'un coup ;
  un événement pour un robot inconnu déclenche aussi une relecture (au plus une par minute) ;
- le **compte du mois** survit au redémarrage (`state.ts`, `AUTOMOWER_USAGE_FILE`) et sort par
  `PluginHealth.quota` (`labelKey: 'mower.quotaRequests'`) : la jauge au bas de la carte Robots. Les
  appels au serveur de jetons sont comptés aussi, par prudence — leur catégorie n'est pas publiée.

*(Dépassé le 2026-09-16 : les appels au serveur de jetons ne sont plus comptés, le portail du fabricant ne les compte pas — voir « Contradiction détectée 2026-09-16 — le quota ».)*

### 3. Des horodatages en heure locale écrite comme de l'UTC

`nextStartTimestamp` et `errorCodeTimestamp` sont l'heure **murale** du robot posée comme si c'était
de l'UTC (en millisecondes, parfois en secondes sur un vieux firmware — même seuil que la bibliothèque
de référence). `localTimestamp` (`mapping.ts`) les ramène à un vrai instant avec le fuseau de la
maison (`AUTOMOWER_TIMEZONE`, défaut : celui du serveur), en deux passes pour prendre le décalage en
vigueur à l'instant vrai (heure d'été). `statusTimestamp`, lui, est en **UTC** et ne passe pas par là.
`nextStartTimestamp = 0` veut dire « pas de prochain départ » : le patch **efface** le champ (`null`).

## Mappage : deux champs pour une activité

`mower.state` prime quand il dit une **erreur** (`ERROR`, `FATAL_ERROR`, `ERROR_AT_POWER_UP`) ou une
**pause** ; puis `mower.activity` dit ce que le robot fait : `MOWING`/`LEAVING` → `mowing`,
`GOING_HOME` → `returning`, `CHARGING` → `charging`, `PARKED_IN_CS` → `parked`, `STOPPED_IN_GARDEN` →
`stopped` ; `state` `STOPPED`/`OFF` → `stopped`. Les énumérations sont lues en minuscules : la
documentation et la bibliothèque de référence ne les écrivent pas dans la même casse.

`stopped` est une activité **ajoutée au contrat** pour l'occasion (`MOWER_ACTIVITIES`) : bouton STOP,
arrêt dans le jardin, robot éteint — ni « au garage », ni « en pause ». Les 160 codes d'erreur et leur
texte anglais (`ERROR_TEXT`) viennent de la référence ; le texte est publié tel quel dans
`errorMessage` — traduire 160 libellés techniques n'apporterait rien, et c'est ce texte que le support
et les forums connaissent. Le code va dans `errorCode`, la date dans `errorAt`.

`toStatePatch` (liste) et `applyEvent` (flux) partagent `errorFields` / `plannerFields` : un
événement `mower` réécrit l'activité **et** l'erreur, la section arrive entière.

*(Dépassé le 2026-09-16 (nuit, bis) : les événements sont des deltas d'un seul champ, la section n'arrive pas entière — voir « Mise à jour 2026-09-16 (nuit, bis) — les événements capturés : des DELTAS, et `mode: HOME` ».)*

Les commandes (`actionBody`) : `mower.start` **avec** durée → `Start` + `attributes.duration`
(minutes) ; **sans** durée → `ResumeSchedule` (le robot suit son planning) ; `mower.pause` → `Pause` ;
`mower.park` → `ParkUntilNextSchedule` ou `ParkUntilFurtherNotice`. Le fabricant accuse en **202 sans
corps** ; l'effet arrive par le flux, rien n'est publié par anticipation. Un robot `connected: false`
refuse la commande (`DEVICE_UNAVAILABLE`) avant même d'appeler.

## Fixtures : provisoires, à remplacer par la capture

Au moment d'écrire, les clés ne sont **pas posées** : `__fixtures__/automower.ts` est tiré de la
documentation et de la bibliothèque de référence (un 435X AWD en erreur 2, garé, connecté ; le même en
tonte ; le même hors ligne). La leçon TaHoma / Renault tient : dès les clés dans `.env`, capturer
`GET /api/plugins/automower/raw`, anonymiser (identifiant, numéro de série, positions) et **remplacer**
le fichier en gardant les bizarreries. À vérifier en particulier : la casse réelle des énumérations,
le type de `serialNumber` (nombre ou chaîne), et si `positions` est bien ordonné du plus récent au
plus ancien.

*(Dépassé le 2026-09-16 (soir) : les clés sont posées et les fixtures sont désormais la capture du vrai compte — voir « Mise à jour 2026-09-16 (soir) — la capture du vrai compte, et un bug de redémarrage ».)*

## Routes propres

| Route | Rôle |
|---|---|
| `GET /api/plugins/automower/status` | pour l'UI et les tests : configuré ou non, robots (nom, modèle, connecté), flux ouvert (`live`), cadence, fuseau, requêtes du mois — jamais la clé ni le secret |
| `GET /api/plugins/automower/raw` | relevé brut pour les fixtures (une requête, comptée) |

*(Complété le 2026-09-16 : `apps/server/src/plugins/automower/index.ts` sert aussi `GET /api/plugins/automower/raw/events` (derniers messages bruts du flux), `GET /api/plugins/automower/raw/messages/:id` (journal brut d'un robot) et `POST /api/plugins/automower/usage` (recaler le compteur sur le portail) — voir les sections « Mise à jour 2026-09-16 (nuit, bis) », « (nuit, quater) » et « (nuit, sexies) ».)*

`health()` : `needs_pairing` sans clé ; `degraded` sur la dernière erreur (dont une clé refusée par le
serveur de jetons : 400 `invalid_client`) ; `ok` avec « n mower(s), n connected · live events /
polling only · n/10000 requests this month », et `quota`. *(Dépassé le 2026-09-16 : le détail est `n/21000 requests this week` — `WINDOW_REQUESTS`, fenêtre de sept jours.)* Les clés `.env` sont affichées par l'hôte
d'après le schéma de configuration (`plugin-host.ts`), sans que le plugin les liste.

## Côté web

- **Vue Robots** (`views/RobotsView.vue`, route `/robots`, icône `mower` au rail après Véhicules) :
  une carte par robot — pastille d'activité (accent en tonte, orangé en erreur), batterie, ligne
  d'état toujours réservée (l'erreur « Erreur 2 · No loop signal · il y a 3 h », sinon la raison qui
  retient le robot), prochain départ, hauteur de coupe (« 6 / 9 »), connexion et âge du statut,
  quatre compteurs fixes, la **carte** (celle des véhicules, `VehicleMap` avec `subject="mower"` : un
  disque plutôt qu'une flèche, le robot ne dit pas son cap), les gestes selon les capacités, « Mis à
  jour il y a… », la jauge de quota. Détail dans `../4_ui/4_1_navigation-et-panneaux.md`.
- **Scène 3D** : la tondeuse se pose par son GPS comme une voiture, mais son marqueur **suit**
  ensuite chaque relevé sans reconstruction — voir `../1_architecture/1_5_scene-3d.md`.
- **Simulation** : la tondeuse simulée publie aussi une `location` (repère supposé plein nord depuis
  l'origine de la maison de démo), une hauteur de coupe et des compteurs, pour que la vue ait quelque
  chose à montrer sans compte (`packages/mock-sim/src/behaviours/robots.ts`, option `home`).

## Pistes pour la suite

*(Dépassé le 2026-10-12 : `workAreas` ne porte AUCUN polygone dans `GET /mowers` — id, nom, état, hauteur de coupe et calendrier seulement ; la géométrie n'existe que dans les cartes SVG (`GET /maps/*`). Voir « Mise à jour 2026-10-12 — zones, carte du terrain ».)*
- **Carte du robot** : `workAreas` (polygones, hauteur de coupe et planning par zone) et
  `stayOutZones` sont dans `GET /mowers` ; le fil des `positions` (une cinquantaine de points)
  dessinerait la trace. Le **câble périphérique** n'est pas publié par l'API : il ne se dessinera pas.
*(Fait en partie le 2026-10-12 : `StartInWorkArea` et l'activation d'une zone d'exclusion existent ; la hauteur de coupe, les phares et la confirmation d'erreur restent à faire.)*
- **Écritures** : `POST /mowers/{id}/settings` (hauteur de coupe, phares), `POST
  /mowers/{id}/errors/confirm` (erreur confirmable, `capabilities.canConfirmError`), `StartInWorkArea`.
- **Messages** : `GET /mowers/{id}/messages` (journal des erreurs avec position et gravité).
  *(Fait le 2026-09-16 (nuit, quater) : voir « le journal du robot ».)*


### Mise à jour 2026-09-16 (soir) — la capture du vrai compte, et un bug de redémarrage

Les clés ont été posées le soir même ; `GET /api/plugins/automower/raw` a rendu « Robby »,
le 435X AWD, et **le robot n'était plus en erreur** : signal de boucle revenu, garé sur sa
base, `RESTRICTED` / `WEEK_SCHEDULE` jusqu'au lendemain 10 h. Les fixtures sont désormais **cette
capture**, anonymisée (identifiant, numéro de série, positions décalées d'un vecteur constant vers la
maison de démo — la forme du relevé est gardée) ; la variante en erreur « No loop signal » est
**dérivée**, pas capturée. Les événements du flux restent à capturer.

Ce que la capture a **confirmé** (la section « Fixtures » ci-dessus posait les questions) :

- énumérations en **MAJUSCULES** (`PARKED_IN_CS`, `RESTRICTED`, `WEEK_SCHEDULE`, `MAIN_AREA`) ;
- `serialNumber` est un **nombre** ;
- `positions` va du **plus récent au plus ancien** : le premier point est à la station, les
  cinquante dessinent le couloir de 70 m que le robot a suivi pour rentrer ;
- **`nextStartTimestamp` en heure locale écrite comme UTC** : `1789639200000` se lit
  « 2026-09-17 10:00 UTC », or le créneau du calendrier commence à `start: 600` minutes = **10 h
  locales**. Et `statusTimestamp` (`1789570593758`, 14:56 UTC) était six minutes avant la capture
  (15:02 UTC) : **vrai UTC**. Les deux conventions cohabitent bien dans la même réponse ;
- les cinquante positions tombent **dans le terrain** de `maison.json` (`sitePosition` les accepte
  toutes) : la tondeuse se dessinera en 3D sans réglage.

Ce que la capture a **appris** :

- `battery.remainingChargingTime`, `statistics.downTime` / `upTime`, et un `workAreas[]` avec
  `cuttingHeight: 100` : la hauteur de coupe d'une **zone** est en **pour cent**, celle de `settings`
  sur l'échelle 1-9 (`7` ici). À retenir pour la carte des zones.
- `capabilities` : `workAreas: true`, `stayOutZones: true`, `canConfirmError: true` — ce robot a tout.

**Le bug.** Le serveur de dev disait `1 mower(s), 1 connected · live events` et pourtant
`deviceCount: 0` : la tondeuse était lue, le flux ouvert, et elle n'était **pas dans le registre**.
Cause : à un **redémarrage du plugin** (bascule dans les Réglages, changement de sous-item), l'hôte
vide ses appareils avec le résultat de `discover()` — vide, puisque `discover` ne fait pas de réseau —
puis relance `start`. Or la variable `published` du plugin survivait à ce cycle : la relecture
trouvait la même liste et **ne réémettait rien**. Corrigé : `init` remet `published` (et `lastError`,
`lastResync`) à zéro, et `discover()` **redit les robots déjà connus** — le registre n'attend pas la
relecture. Un test « stop puis init/discover/start » le tient. Leçon générale, à ajouter à la liste de
contrôle de `3_2_ecrire-un-plugin.md` : **un plugin est une fermeture qui survit à `stop()`** ; tout
ce qui sert à décider « ai-je déjà publié ? » se remet à zéro dans `init`.

Sources : capture du 2026-09-16, `apps/server/src/plugins/automower/__fixtures__/automower.ts`,
`apps/server/src/plugins/automower/index.ts`, `plugin.test.ts` (« automower — redémarrage »).

### Mise à jour 2026-09-16 (soir, bis) — centimètres, station, décalage

Trois précisions d'usage venues du propriétaire : la hauteur de coupe du fabricant est en
**centimètres** (le contrat le dit désormais), le robot garé est **« à la station »**, et la position
publiée à la station était décalée de quelques mètres sur la photo aérienne (récepteur GPS sous un
débord de toit) — d'où le réglage `gpsOffset` offert dans la vue Robots, qui corrige la
carte et la scène (détail dans `../4_ui/4_1_navigation-et-panneaux.md`).


### Mise à jour 2026-09-16 (nuit) — le décalage réglé : la 3D juste, la photo non

Avec un `gpsOffset` réglé, le robot se pose au bon endroit dans la scène (l'utilisateur le
confirme) mais à quelques mètres sur la photo aérienne. Vérifié dans la page 3D du vrai serveur (crochet
`window.kasbahScene`) : le marqueur est au point corrigé attendu ; la carte montre le
même point. Ce n'est donc **ni le plugin ni le décalage** : c'est le calage de la maison
(`origin`/`heading`) sur le monde — voir `../2_maison/2_0_format-house-json.md`, mise à jour du même
jour, et le plan dans `_generated-ai-doc/calage-maison-photo.md`.

Deux choses apprises sur le GPS du robot au passage : le décalage de carte de l'appli mobile du
fabricant est un réglage d'AFFICHAGE (l'API rend le GPS brut, la bibliothèque de référence ne connaît
aucun champ de décalage) ; et la dispersion des 50 positions du relevé donne le bruit, 2 à 3 m, qui
s'ajoute au biais constant — un GPS grand public, contre un mur, sous un toit.


### Mise à jour 2026-09-16 (nuit, bis) — les événements capturés : des DELTAS, et `mode: HOME`

Capture faite sans faire bouger le robot (le signal de boucle est toujours en panne) : un
`ParkUntilFurtherNotice` puis un `ResumeSchedule`, robot à la station, relevés par la nouvelle route
**`GET /api/plugins/automower/raw/events`** (les 200 derniers messages bruts du flux, datés par le
serveur — le fabricant n'horodate rien). Vingt-six événements en trente secondes. Ce qu'ils ont appris,
et qui **contredit la lecture « une section entière »** de la version du matin :

- **Les événements sont des deltas.** `mower-event-v2` peut ne porter QU'un champ :
  `{ inactiveReason: "PLANNING" }`, `{ state: "STOPPED" }`, `{ activity: "NOT_APPLICABLE" }` ; sa
  forme la plus complète (`mode`, `activity`, `state`, `errorCode`, `isErrorConfirmable`) n'a jamais
  `errorCodeTimestamp` ni `workAreaId`. `planner-event-v2` ne redit **jamais** `nextStartTimestamp`.
  Mapper le fragment seul faisait deux dégâts, tous deux constatés sur le vrai serveur : le prochain
  départ **effacé** (`nextStartAt: null`, absent lu comme « aucun ») et une erreur qui aurait été
  **levée** par le premier fragment sans `errorCode`. C'est mot pour mot la question que
  `3_2_ecrire-un-plugin.md` pose (« états complets ou deltas ? ») — la documentation laissait croire à
  des sections, la capture a tranché.
- **Le remède** : `applyEvent(ev, current, o)` reçoit le robot tel qu'on le connaît (dernière liste
  ou dernier événement fondu), fond le delta dans la section (`{ ...connu, ...présent }`, les clés
  absentes ne comptent pas) et mappe la section fondue — comme si la liste l'avait rendue. Il rend
  le robot mis à jour, que le plugin garde pour l'événement suivant. Une position s'ajoute en tête
  du relevé (50 au plus).
- **« Garé jusqu'à nouvel ordre » = `mode: HOME`.** Le planificateur, lui, disait toujours
  `WEEK_SCHEDULE` et `override: NOT_ACTIVE` ; `PARK_OVERRIDE` n'est pas apparu. Le mode prime donc
  dans `plannerFields` : `HOME` → `restrictedReason: park_override`. `ResumeSchedule` rend
  `MAIN_AREA`.
- **L'arrêt prime sur l'activité.** Le robot est passé `state: STOPPED` alors que `activity` disait
  encore `PARKED_IN_CS` ; `toActivity` lit désormais `stopped`/`off` avant l'activité, comme
  l'erreur et la pause. `WAIT_POWER_UP` et `NOT_APPLICABLE` passent quelques secondes au changement
  de mode ; sans activité connue, ils se lisent « arrêtée ».
- `ready.connectionId` est un **base64**, pas un UUID.

Les fixtures `WS_*` sont ces captures ; `WS_POSITION` et `WS_BATTERY` restent d'après la référence
(robot immobile et plein) — à capturer dès que le robot tondra. La séquence entière est rejouée dans
`mapping.test.ts` (huit deltas, l'activité et la restriction à chaque pas) et dans `plugin.test.ts`.

Sources : capture du 2026-09-16 soir, `apps/server/src/plugins/automower/{mapping,index}.ts`,
`__fixtures__/automower.ts`, tests.

### Mise à jour 2026-09-16 (nuit, ter) — un `Start` qui échoue, capturé de bout en bout

À la demande de l'utilisateur, un « Tondre 1 h » envoyé au robot dont le signal de boucle est en
panne. L'appli du fabricant a affiché « En route » (`LEAVING`) alors que le robot ne bougeait pas ;
le GPS a dérivé d'un mètre ou deux (une position toutes les **30 s**) ; au bout de **trois minutes**
le robot a déclaré l'erreur 2, et la carte Robots l'a affichée avec son code, son texte et l'heure
exacte. Ce que le flux a montré de plus :

- en tonte forcée, le planificateur porte `nextStartTimestamp: 0` et `override: FORCE_MOW` — le
  seul cas vu où il redit le prochain départ, et c'est pour l'effacer ;
- l'erreur arrive en **trois deltas** : `{ errorCode: 2, isErrorConfirmable: false }` seul (l'état
  dit encore `IN_OPERATION`), puis `{ activity: NOT_APPLICABLE, state: ERROR }`, puis, trois
  secondes plus tard, `{ errorCodeTimestamp: 1789582935 }` — en **secondes** par le flux, là où la
  liste donne des millisecondes. Le seuil hérité de la bibliothèque de référence l'absorbe ;
- un **`message-event-v2`** accompagne l'erreur : `{ time (s), code, severity: "ERROR", latitude,
  longitude }` — le journal du robot, ignoré pour l'instant, piste pour plus tard ; *(Dépassé le 2026-09-16 (nuit, quater) : lu et exploité — voir « le journal du robot ».)*
- `isErrorConfirmable: false` pour le code 2 : cette erreur ne se lève pas à distance.

Les fixtures `WS_PLANNER_FORCE_MOW`, `WS_MOWER_IN_OPERATION`, `WS_MOWER_LEAVING`, `WS_POSITION`
(désormais réelle, décalée comme la liste), `WS_MOWER_ERROR_*`, `WS_MESSAGE_ERROR` sont cette capture ;
la séquence est rejouée dans `mapping.test.ts`. Seule la batterie reste d'après la référence.

### Mise à jour 2026-09-16 (nuit, quater) — le journal du robot

`GET /mowers/{id}/messages` rend le **journal** du robot : 22 lignes à la capture, du plus récent au
plus ancien, `{ time, code, severity, latitude, longitude }`. Ce qu'il a appris : `time` en
**secondes**, heure locale écrite comme UTC (comme `errorCodeTimestamp` du flux) ; `severity` en
majuscules — `ERROR`, `FATAL` (code 1, hors zone), `WARNING` vus ; et des **positions quasi nulles**
(`2e-7 ; 6.2e-6`) sur plusieurs lignes du code 62 : le robot a consigné sans fix GPS. Une position
n'en est une que si elle s'écarte de (0 ; 0) — `toJournalEntry` la laisse sinon absente.

Le journal est servi par le chemin **générique** ouvert pour l'occasion, calqué sur les prévisions
météo (`../1_architecture/1_1_contrat-appareils.md`, `../1_architecture/1_3_protocole-rest-ws.md`) :
capacité `journal` déclarée par le descripteur, hook `journal?(externalId)` du contrat de plugin,
route `GET /api/devices/:id/journal`, entrées normalisées (`at` vrai instant, `severity`
`info`/`warning`/`error`/`fatal`, `code`, `message` = texte du fabricant, `location?`).

Côté quota : le journal est lu **une fois** par robot, à la première demande (une requête, comptée),
puis **tenu par le flux** — chaque `message-event-v2` rejoint le journal en mémoire, sans doublon
(même date, même code) et sans relire. Une coupure du flux le marque `stale` : des lignes ont pu
passer, la prochaine demande relit. Un redémarrage du plugin vide le cache (`init`). Cent lignes au
plus. Un `message-event-v2` ne touche **pas** à l'état du robot : l'erreur courante vient de
`mower-event-v2`, le journal n'est que l'historique.

Côté vue Robots : une carte « Journal » sous les compteurs, **huit lignes** fixes (pastille de gravité,
heure courte, texte du fabricant et code), redemandée à chaque battement de 30 s — une requête locale.
Rien pour la simulation, qui ne déclare pas la capacité.

Sources : capture `GET /api/plugins/automower/raw/messages/:id` du 2026-09-16,
`apps/server/src/plugins/automower/{mapping,index,types}.ts`, `__fixtures__/automower.ts` (`MESSAGES`),
`apps/server/src/core/{plugin,plugin-host}.ts`, `apps/server/src/http/routes.ts`,
`packages/shared/src/protocol/http.ts`, `apps/web/src/views/RobotsView.vue`, tests.

### Mise à jour 2026-09-16 (nuit, quinquies) — le journal devient une carte des incidents

Côté web, le journal ne s'affiche plus en liste ouverte (elle changeait la hauteur de la carte) : il
se signale, se déplie, et **pose ses incidents positionnés** sur la carte satellite et sur le terrain
de la scène 3D — les « No loop signal » ont désormais une place, et une ligne choisie y emmène. Le
panneau détail de la vue Maison offre la même chose, plus le décalage GPS. Détail dans
`../4_ui/4_1_navigation-et-panneaux.md` et `../1_architecture/1_5_scene-3d.md`.

### Contradiction détectée 2026-09-16 — le quota : 21 000 requêtes par semaine, pas 10 000 par mois

Cette page disait, d'après la documentation du binding openHAB : « 10 000 requêtes par mois et par
clé, une par seconde ». Le **portail développeur du fabricant** (capture de l'utilisateur, le soir du
2026-09-16, application « Kasbah ») affiche autre chose : **« 33 of 21000 requests · Resets at … »**, soit 21 000 requêtes par
**fenêtre de sept jours** calée sur la création de l'application (créée le 16). Le portail fait foi ; la version « 10 000 par mois » reste
ci-dessus comme témoin de ce que la documentation tierce dit encore.

Deuxième enseignement du même relevé : le portail comptait **33** requêtes quand le plugin en avait
compté **35** — il ne compte que les appels à l'API Automower Connect, **pas les jetons** demandés au
serveur d'authentification. Le compteur ne les compte plus non plus.

Ce que le plugin fait désormais (`state.ts`) : une fenêtre de sept jours (`WINDOW_MS`) sur une grille
ancrée soit sur `AUTOMOWER_QUOTA_RESET_AT` (l'instant « Resets at » du portail, en ISO 8601, pour
caler exactement), soit sur la première requête — à quelques minutes de la création de l'application ;
une fenêtre écoulée repart de zéro sur la même grille. `PluginHealth.quota` publie `limit: 21000` et
`since` = début de fenêtre ; `/status` rend `requestsInWindow`, `windowLimit`, `windowResetAt`. Le
fichier d'usage de l'ancienne forme (`{ month, requests }`) est ignoré au chargement : le compte repart
de zéro, le portail restant la référence. À la cadence de dix minutes, la relecture complète coûte
**1 008** requêtes par semaine sur 21 000 : rien à changer côté cadence.

Sources : capture du portail (2026-09-16), `apps/server/src/plugins/automower/{state,index,auth}.ts`,
`plugin.test.ts`, `apps/server/.env.example`.

### Mise à jour 2026-09-16 (nuit, sexies) — recaler le compteur sur le portail : `POST /usage`

Comme la console de Tesla, le portail est la seule vérité : **`POST /api/plugins/automower/usage`**
avec `{ requests, resetAt? }` écrit le compte de la fenêtre et, si `resetAt` est donné (l'instant
« Resets at … » du portail, ISO 8601 ou ms), **l'ancrage de la grille**, gardé dans le fichier
d'usage (`anchor`) pour caler les fenêtres suivantes sans configuration. `AUTOMOWER_QUOTA_RESET_AT`
prime s'il est posé. Le fichier d'usage tient donc trois choses : début de fenêtre, compte, ancrage.
Ce que le fichier de Tesla garde en plus — le dernier état de chaque véhicule — n'a pas lieu d'être
ici : la liste se lit en une requête au démarrage, sans attendre un réveil.

Sources : `apps/server/src/plugins/automower/{index,state}.ts`, `plugin.test.ts`, `apps/server/.env.example`.

### Mise à jour 2026-10-12 — zones, carte du terrain, et ce que l'API ne laisse pas faire

Session de l'utilisateur : voir et commander les zones du robot, et poser la carte de son terrain sur la
photo satellite. Relevés faits sur le vrai robot : la liste et ses zones, les cartes SVG, le refus du
réensauvagement. `StartInWorkArea` et la bascule d'une zone d'exclusion ne sont encore éprouvés qu'en
simulation et par les tests (ni noms ni tracé ici : les exemples sont ceux des fixtures inventées,
« Fond du jardin », « Massif », « Prairie »).

#### Ce que l'API permet, et ne permet pas

Lecture de la spécification officielle (`swagger.yml` v1.0.0, developer.husqvarnagroup.cloud) : **l'API
NE PERMET PAS de créer, redessiner ou supprimer une zone** — ni de travail, ni d'exclusion. Elle permet
seulement : la hauteur de coupe, le nom et l'activation d'une zone de travail (`PATCH workAreas`), son
calendrier, et l'**activation** des zones d'exclusion. Côté profils de carte : créer (copie du profil
actif), supprimer, activer, renommer ; **un seul est actif**, et changer de profil recharge zones et carte
**sans événement de fin** (d'où la relecture périodique plus bas). Aucune limite de nombre de zones ou de
profils n'est publiée — ni la spécification ni le support. Les zones se tracent donc dans l'appli du
fabricant, et la vue Robots le dit quand il n'y en a aucune.

*Idée écartée — « envoyer le robot à un point ».* Créer dynamiquement une mini-zone autour du point
cliqué exigerait l'API **privée** de l'appli (rétro-ingénierie, conditions d'utilisation, fragilité,
resynchronisation lente de la carte). Piste retenue à la place, **pas encore codée** : une grille de zones
tracées une fois dans l'appli, puis un clic sur la carte lance `StartInWorkArea` sur la zone qui contient
le point.

#### Commandes

- `mower.start_in_area` (`workAreaId`, `durationMin`) → action **`StartInWorkArea`** avec
  `attributes.workAreaId` **et** `attributes.duration`, les deux obligatoires (`actionBody`, `mapping.ts`).
  Capacité requise : `work_areas`. Le contrat refuse donc une durée absente (`durationMin` requis).
- `mower.set_stay_out_zone` (`zoneId`, `enabled`) → `PATCH /mowers/{id}/stayOutZones/{zoneId}`, corps
  `{ data: { type: 'stayOutZone', id, attributes: { enable } } }` (`AutomowerClient.stayOutZone`,
  `client.ts` ; le client accepte désormais `PATCH`). Capacité requise : `stay_out_zones`. **Refusé côté
  plugin** (`DEVICE_UNAVAILABLE`) tant que `stayOutZones.dirty` est vrai : la carte se synchronise avec le
  cloud et le fabricant refuserait de toute façon.
- **Relecture complète 5 s après une bascule** (`ZONE_REFRESH_MS`, `index.ts`) : aucun événement du
  flux WebSocket ne porte ces zones, et le fabricant accuse en 202 avant que le robot n'ait appliqué. Un
  seul minuteur à la fois, annulé par `stop()`.

#### Capacités et état

Les capacités s'ajoutent à `mow`, `park`, `battery`, `schedule`, `journal` d'après
`attributes.capabilities` (`optionalCapabilities`, `mapping.ts`) : `work_areas`, `stay_out_zones`, et
`site_map` **si `position`** — un robot sans position n'a pas de terrain relevé à montrer.

État publié : `workAreas[]` (`id`, `name` rogné, `enabled`) et `stayOutZones[]` (`id` UUID, `name`,
`enabled`). Piège relevé : la section `stayOutZones` est **ABSENTE** de la liste tant qu'aucune zone n'a
jamais été tracée, puis devient `{ zones: [], dirty }` ; le plugin publie donc une liste **vide** (pas
`undefined`) dès que le robot déclare gérer les zones, pour que « aucune zone » ne se lise pas « inconnu ».
Le robot publie aussi une zone de travail `0` sans nom (tout le terrain) tant qu'aucune n'est tracée ; la
hauteur de coupe d'une zone est en **pour cent**, celle de `settings` sur 1-9 (voir plus haut).

#### Les cartes : du SVG, pas du JSON

La géométrie n'est que dans trois cartes SVG, que le plugin lit (`AutomowerClient.mapSvg`) :
`GET /mowers/{id}/maps/generated` (robot AIM : le terrain relevé), `/maps/zone` (AIM : les zones tracées ;
**404 `map.zone.not_found`** tant qu'aucune), `/maps/site` (robot EPOS). Le parseur est `parseSvgMap` /
`toSiteMap` (`mapping.ts`), sans DOM côté serveur. Relevé réel : **millimètres**, `x` vers l'est, `y` vers
le nord, origine quelconque. Husqvarna code la nature par la couleur :

| Carte | Vert | Rouge | Bleu | Jaune |
|---|---|---|---|---|
| générée | le terrain entier (`main_area_0`) → `lawn` | `island_*` : obstacle relevé (maison, arbre) → `obstacle` | `guide_*` : câble guide → `guide` | `lona_cs` : la station → `station` |
| zones | une zone de travail tracée → `work_area` | zone d'exclusion → `stay_out` ; avec `rewildingzone="true"` → `rewilding` | chemin → `transport` | — |

- Le **premier point** de la ligne jaune est la plaque de charge : les câbles guides en partent tous.
  C'est lui qui devient `SiteMap.station`, le seul lien entre la carte et le monde.
- Sur la carte de zones, l'`id` d'une zone de travail est un **UUID** qui n'est **pas** son `workAreaId`.
  Le `title` porte son nom (avec ses espaces, d'où le `trim`) : **le nom est le seul lien** entre la forme
  et `workAreas[]`. Une zone d'exclusion, elle, partage son UUID avec `stayOutZones`.
- Une zone **désactivée** reste sur la carte, avec `display="none"`. Le parseur en tire `enabled` pour les
  zones d'exclusion et de réensauvagement ; pas pour une zone de travail (son état vient de `workAreas`).

#### Réensauvagement : affichage seul, piste fermée

Une zone de réensauvagement (l'herbe y pousse) n'est publiée **que sur la carte** : elle est absente de
`stayOutZones`. Essai du 2026-10-12 sur le vrai robot : `PATCH stayOutZones/{id de la zone de
réensauvagement}` → **HTTP 400, code `rewilding.stay_out_zone`**, « is not a supported stay out zone ».
Elle ne se bascule pas : la vue la dessine (jaune pâle), c'est tout. À ne pas rouvrir.

#### Cache de la carte

Lire une carte coûte deux requêtes de quota (terrain, puis zones). `siteMaps` (`index.ts`) la lit **à la
demande**, la garde **en mémoire**, et la juge périmée dans deux cas :

- `zonesKey` change : les ids **et les noms** des zones, plus le drapeau `dirty` — tout cela est déjà dans
  la relecture de 10 minutes, donc sans coût ; les noms comptent parce que c'est par eux que la carte est
  reliée à `workAreas` ;
- elle a plus de 24 h (`SITE_MAP_MAX_AGE_MS`) : un tracé **redessiné** sans autre changement ne modifie ni
  id ni nom, rien d'autre ne le signalerait.

Pas de fichier sur disque : deux requêtes par redémarrage (contre le quota de 21 000 par semaine). Le
cache est vidé par `init` (même leçon que `published` : une fermeture survit à `stop()`).

#### Côté web

Bouton « Zones » (panneau `MowerZones.vue`), carte du terrain sur la carte satellite, menu des calques et
décalage `mapOffset` : voir `../4_ui/4_1_navigation-et-panneaux.md`, mise à jour du même jour. Contrat
(capacités, commandes, route `GET /api/devices/:id/map`) : `../1_architecture/1_1_contrat-appareils.md` et
`../1_architecture/1_3_protocole-rest-ws.md`. La tondeuse simulée sert aussi une carte (voir
`3_0_simulation-mock.md`).

Sources : `apps/server/src/plugins/automower/{index,client,mapping,types}.ts`, `__fixtures__/automower.ts`,
tests `mapping.test.ts` et `plugin.test.ts`, `packages/shared/src/devices/{kinds,command,state}.ts`,
`apps/web/src/lib/siteMap.ts`.
