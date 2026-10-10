# Serveur et hôte de plugins

> Dernière mise à jour : 2026-10-10
> Sources : `apps/server/src/{app,main}.ts`, `apps/server/src/core/*.ts`, `apps/server/src/plugins/index.ts`, `apps/server/src/core/scene-registry.ts`, `apps/server/src/core/{plugin,plugin-host,scene-seeder}.ts`, `packages/shared/src/house/schema.ts`, `apps/server/src/plugins/comap/{history,state}.ts`, `apps/server/src/core/paths.ts`, `apps/server/src/core/playbackBridge.ts`, `apps/server/src/music/{player,sources}.ts`, `apps/server/src/core/automations/engine.ts`, `apps/server/src/core/atomic-file.ts`, `apps/server/src/config/properties.ts`, `apps/server/src/main.ts`

## Assemblage (`app.ts`)

`buildApp({ env, logger, clock?, factories?, envSource?, house?, serveStatic? })` construit sans
écouter (les tests utilisent `app.inject`) :

1. lecture et validation de la maison (`config/house.ts` → `parseHouse` + `lintHouse`, avertissements journalisés) ;
2. `Bus` typé (`state`, `availability`, `devices`) ;
3. `DeviceRegistry` ; `WsHub` ; `EnergyHistory` (historique horaire en mémoire des kinds `energy`) ;
4. `PluginHost` (instancie les plugins, valide leur config) ;
5. routes REST, routes propres aux plugins (`/api/plugins/<id>/…`), service statique du build web avec repli SPA.

`main.ts` charge `apps/server/.env` (dotenv), écoute, **puis** démarre les plugins ; arrêt propre sur
SIGINT/SIGTERM avec délai de sécurité.

### Mise à jour 2026-09-19 — `routerOptions.maxParamLength`

Le constructeur Fastify porte `routerOptions: { maxParamLength: 512 }` : le défaut (100 caractères)
est trop court pour un id Nest auto-placé. Depuis Fastify 5.12, cette option ne vit plus au premier
niveau (`FSTDEP022` sinon). Voir `../6_faq/6_1_pieges-runtime.md` (le 414) et
`../6_faq/6_0_pieges-outillage.md` (l'avertissement).

## Hôte de plugins (`core/plugin-host.ts`)

- Table statique `PLUGIN_FACTORIES` (`plugins/index.ts`) : typée et grep-able, pas d'import dynamique.
- `KASBAH_PLUGINS=mock,hue` sélectionne ; un id inconnu fait échouer le démarrage avec la liste connue.
  *(Dépassé le 2026-09-11 : `PluginHost` instancie toutes les fabriques de `PLUGIN_FACTORIES` et l'activation vient de `house.json` (`plugins.<id>.enabled`) — voir la mise à jour du 2026-09-11 plus bas ; `KASBAH_PLUGINS` n'est plus lue.)*
- Chaque plugin valide **ses propres** variables avec `configSchema.safeParse(process.env)`. Config
  invalide → plugin **désactivé avec log** (statut `disabled`), sauf `KASBAH_STRICT_PLUGINS=true`.
  *(Constat du lint du 2026-10-06, `core/plugin-host.ts:77-81` : le statut est `error` avec un `detail` (les erreurs zod), pas `disabled` ; le plugin reste déclaré et visible mais ne démarre pas. Le mode strict ne lève que pour un plugin **activé**. C'est ce qui permet à `COMAP_HOST` d'être facultatif dans le schéma depuis le 2026-10-06 : un champ obligatoire ferait échouer le démarrage chez qui n'a pas de station.)*
- Cycle : `init(ctx)` → `discover()` → `registry.register` → `start()`. Chaque plugin est isolé par
  try/catch : un fabricant en panne ne fait jamais tomber la maison (statut `error`).
- Le contexte fourni ajoute implicitement `available: true` aux patchs de `emitState`.
- `health()` agrège le statut, le nombre d'appareils et les **noms** des clés de config (jamais leurs valeurs).
  *(Précisé le 2026-10-08 : asynchrone, et pour le compte qui demande — voir la mise à jour du 2026-10-08 en bas de page.)*
- `restart(id)` permet à Hue de repartir après un appairage.

## Registre (`core/registry.ts`)

`register(pluginId, descriptors)` remplace l'ensemble des appareils d'un plugin (les états des ids
conservés survivent, les nouveaux reçoivent `defaultState`). `applyPatch` : clés vérifiées contre
`stateKeys(kind)`, fusion, validation zod, publication uniquement si changement. `setAvailable`
bascule un appareil ou tous ceux d'un plugin (`'*'`).

## Historique énergie (`core/history.ts`)

Abonné au bus, il moyenne par heure `productionW / consumptionW / gridW` des appareils `energy`
disponibles, borné à 48 h. Exposé par `GET /api/devices/:id/history?hours=24`. Vide au démarrage
(pas de persistance) : le graphique se remplit au fil de la journée.

## Utilitaires

`core/backoff.ts` (exponentiel borné avec gigue), `core/poll.ts` (`createPoller` avec horloge
injectable, `withTimeout` → `PluginError('TIMEOUT')`), `core/rate-limit.ts` (seau à jetons),
`core/sse.ts` (parseur SSE robuste aux coupures de chunk + `connectSse` avec reconnexion),
`core/logger.ts` (pino, joli en TTY).

## Tests

`core/core.test.ts` (backoff, poller, seau, registre, SSE), `core/history.test.ts`,
`test/integration.test.ts` (REST via `inject`, scénario `chaos` → 502, WebSocket réel : snapshot puis
état coalescé).

### Mise à jour 2026-09-08 — registre des scènes plugin

`SceneRegistry` (`core/scene-registry.ts`) est le pendant du registre d'appareils pour les scènes des
fabricants, en beaucoup plus simple : une scène n'a qu'un champ d'état (`active`), donc pas de patch
ni de fusion. `register(pluginId, scenes)` remplace l'ensemble des scènes d'un plugin en **conservant
l'activation des ids qui survivent** (une redécouverte après un événement du pont ne doit pas éteindre
l'affichage) et valide chaque scène (`pluginSceneSchema`) pour attraper tôt un bug de plugin.

**Règle de concept** portée par le registre, pas par le plugin : `setActive` met les autres scènes du
**même groupe** (même `pluginId` + même `group.name`) à `inactive`. Les ponts n'émettent pas toujours
la désactivation de la scène précédente ; sans cette règle l'UI en montrerait deux allumées. Deux
groupes différents restent indépendants.

Nouvelles entrées du bus : `scenes` (liste complète) et `scene` (une activation).

Le contexte de plugin gagne `emitScenes(scenes)` et `emitSceneState(externalId, active)` — un plugin
publie ses scènes lui-même, il n'y a **pas** de `discoverScenes()` symétrique de `discover()` : un
seul chemin (celui de la resynchronisation du plugin) suffit. `DevicePlugin.recallScene?` est
optionnel : un plugin sans scènes ne l'implémente pas, et l'hôte répond alors `NOT_IMPLEMENTED` (501).
`PluginHost.recallScene(sceneId, recall)` applique le même `withTimeout` que les commandes.

### Mise à jour 2026-09-08 — réglages persistés et initialisation des ambiances qui apparaissent

`PluginSettingsStore` (`core/plugin-settings.ts`) : première **persistance du serveur hors
`house.json`** — un JSON minuscule (`KASBAH_SETTINGS_FILE`, défaut `apps/server/.state/`, ignoré par
git), écrit atomiquement (temporaire + `rename`), relu au démarrage. Fichier absent ou illisible =
valeurs par défaut, jamais d'échec au démarrage.

`SceneSeeder` (`core/scene-seeder.ts`) applique le défaut d'un plugin aux ambiances animées **qui
apparaissent**. Le déclencheur est l'apparition, pas un inventaire mémorisé, et c'est ce qui garantit
par construction la règle voulue : *l'existant n'est jamais modifié*.

- La **première** liste reçue d'un plugin sert de photo de référence : aucune écriture.
- Ensuite, tout id animé absent de cette photo est « apparu » : ambiance créée chez le fabricant,
  **ou** ambiance existante à qui on vient d'ajouter une palette (elle entre alors dans l'ensemble
  des animées).
- Après un redémarrage, la photo est reprise sur l'état courant : rien n'est réécrit — vérifié sur un
  pont réel (drapeaux identiques avant/après, défaut activé).
- Angle mort assumé : une ambiance créée pendant que le serveur est arrêté est vue comme existante,
  donc pas initialisée. C'est le prix de ne rien persister d'autre que le réglage lui-même.

Le seeder s'abonne au bus (`scenes`) et écrit via `PluginHost.updateScene` : il ne connaît aucun
fabricant, et la boucle registre → hôte reste sans cycle d'import.

### Mise à jour 2026-09-09 — `core/video/` : relais RTSP → MP4 fragmenté

Premier module du cœur qui lance un processus externe : `RtspRelay` (`core/video/rtsp-relay.ts`)
pilote **un ffmpeg par caméra regardée** (`-c copy`, pas de ré-encodage) et distribue le MP4
fragmenté à ses abonnés — l'entête d'abord, puis les fragments, chacun commençant par une image
clé. Sans abonné depuis un délai de grâce, il prévient l'appelant (`onIdle`) qui libère la source.
`fmp4.ts` (pur) découpe le flux en boîtes et forme la chaîne `codecs` MSE depuis `moov`. Option
`snapshot` : une seconde sortie ffmpeg réécrit en place une vignette JPEG à cadence fixe (la seule
sortie qui décode). `onEnded` prévient l'appelant quand ffmpeg s'arrête seul, pour qu'il libère la
source. Générique :
un plugin y branche une URL RTSP et une route WebSocket ; premier usage dans `plugins/nest`
(`../3_plugins/3_5_google-nest.md`). `spawn` est injectable pour les tests.

### Mise à jour 2026-09-11 — l'activation des plugins passe de `.env` à la maison

Déclencheur : « la gestion des plugins dans le .env, c'est assez pénible ». Décision prise avec
l'utilisateur : **tous les plugins sont disponibles**, on coche ceux qu'on veut dans Réglages, et
« les choix et infos sont maintenant dans le house.json ».

- `PluginHost` instancie **toutes** les fabriques de `plugins/index.ts` (plus de liste d'ids à
  fournir). Ce qui tourne est lu par `settingsOf(pluginId)`, que `app.ts` branche sur
  `house.house.plugins[id]` — relu à chaque appel, puisque `updateHouseFile` mute la maison chargée.
- `apply(id)` est le seul chemin qu'appellent les routes : il allume, éteint, ou **redémarre** si les
  sous-items ont changé (`appliedParts` retient ceux avec lesquels le plugin tourne). Éteindre purge
  ses appareils ET ses ambiances des registres (`register(id, [])`), sinon les écrans gardent une
  liste que plus personne n'alimente.
- `inventory()` sert l'écran Réglages : pour chaque plugin, `implemented`, `enabled`, ses `parts`
  résolues et son `health`. `health()` ne demande plus son avis à un plugin qui ne tourne pas.
- Les **routes propres aux plugins** (`/api/plugins/<id>/…`) sont enregistrées même pour un plugin
  éteint : Fastify n'accepte plus de route après `ready()`, et c'est justement par là qu'on appaire
  un fabricant **avant** de l'allumer. `restart(id)` en revanche respecte l'activation : appairer un
  plugin décoché ne le démarre pas.
- Les gardes de `execute` / `recallScene` / `updateScene` / `createScene` / `deleteScene` testent
  désormais `slot.ctx` (« is not running ») et non `slot.config` : une config valide ne veut plus
  dire que le plugin tourne.
- Le contrat gagne deux champs **statiques** (`core/plugin.ts`) : `implemented` (faux pour les
  squelettes de `plugins/_stub/`, interrupteur grisé côté UI) et `parts` (voir
  `../3_plugins/3_2_ecrire-un-plugin.md`). Statiques parce que les Réglages les affichent alors que
  le plugin est éteint, donc sans config ni `init`.
- `PluginSettingsStore` (`core/plugin-settings.ts`) et son JSON `.state/plugin-settings.json`
  **disparaissent** : le seul réglage qu'il portait, `autoDynamicForNewScenes`, vit maintenant dans
  la maison, et `SceneSeeder` prend un `settingsOf` au lieu du store. La persistance hors
  `house.json` est donc à nouveau à zéro côté serveur.

### Mise à jour 2026-09-15 — compression des réponses

`@fastify/compress` est enregistré dans `buildApp`, **avant** `registerRoutes` : son crochet
`onSend` ne vaut que pour ce qui est déclaré après lui, et rien ne le signale — d'où un test qui
garde cet ordre (`apps/server/src/app.test.ts`).

Le gros du gain est sur le bundle web et sur les carrosseries 3D : `model/gltf-binary` est déjà
marqué compressible dans `mime-db`, aucune configuration de type n'a été nécessaire, et 815 Ko de
modèles tombent à environ 550 Ko sur le fil. Les types non compressibles — JPEG d'un instantané de
caméra, flux vidéo — sont laissés tranquilles par défaut, et le WebSocket ne traverse pas ce crochet.

Rien n'est compressé si le client ne l'annonce pas : c'est `accept-encoding` qui décide.

Sources : `apps/server/src/app.ts`, `apps/server/src/app.test.ts`.

### Mise à jour 2026-09-16 — `ctx.site` et `forecast?` : ce qui dépend du lieu

- **`ctx.site`** (`{ lat, lon, alt }`) : où est la maison, tiré de `house.origin` par l'hôte
  (`PluginHostOptions.site`, branché dans `app.ts`), relu à chaque démarrage de plugin. Même principe
  que `ctx.parts` : un plugin ne va jamais chercher la maison, la position a une seule source de
  vérité — celle dont la scène 3D tire déjà son soleil. Premier usage : la météo (`open_meteo`).
  Changer l'origine ne redémarre pas les plugins (l'origine ne s'édite pas depuis l'UI aujourd'hui).
- **`DevicePlugin.forecast?(externalId)`** : prévisions d'un appareil `weather`, optionnel sur le
  modèle de `recallScene?` — l'hôte répond `NOT_IMPLEMENTED` (501) si le plugin n'en sert pas.
  `PluginHost.forecast(deviceId)` applique le `withTimeout` des commandes et ajoute le `deviceId` ;
  la route `GET /api/devices/:id/forecast` refuse (`KIND_MISMATCH`, 400) un appareil qui n'est pas
  une météo. Le plugin rend sa **dernière lecture**, pas un nouvel appel.
- Les faux contextes des tests de plugins portent désormais `site` (sept fichiers `plugin.test.ts`).

Sources : `apps/server/src/core/{plugin,plugin-host}.ts`, `apps/server/src/http/routes.ts`,
`apps/server/src/app.ts`, `apps/server/test/integration.test.ts`.

### Mise à jour 2026-09-17 — `consumption?` : un troisième hook servi à la demande

Après `forecast?` (météo) et `journal?` (incidents d'un robot), l'hôte sait maintenant demander à un
plugin **ce qu'un appareil a consommé, par pas de temps** : `consumption?(externalId)` dans
`DevicePlugin` (`apps/server/src/core/plugin.ts`), rendu par `host.consumption(deviceId)` et servi
par `GET /api/devices/:id/consumption`. Absent = le plugin n'en tient pas, l'hôte répond
`NOT_IMPLEMENTED`. Le type rendu est `PluginConsumption = Omit<DeviceConsumption, 'deviceId'>` :
comme pour les deux autres, **c'est l'hôte qui ajoute le `deviceId`**, le plugin ne connaît que son
identifiant externe.

La règle est la même que pour les deux prédécesseurs, et c'est elle qui compte : **rendre un
historique déjà tenu au fil des sondages, jamais refaire un relevé à la demande.** Un appel doit
coûter zéro échange avec le matériel.

`impact()` sur `DevicePlugin` (direction amont) rend **CRITICAL : 43 dépendants**, soit tous les
plugins existants. L'ajout est passé quand même, parce qu'il est **strictement additif** — un membre
d'interface facultatif, aucun code existant modifié — et que c'est exactement le risque déjà accepté
pour `forecast?` et `journal?`. Une interface centrale à 43 dépendants ne se lit pas « ne pas
toucher » mais « ne toucher qu'en ajoutant ».

Premier (et pour l'instant seul) porteur : le plugin COMAP, dont l'historique est persisté à part
(`apps/server/src/plugins/comap/{history,state}.ts`, voir
`../3_plugins/3_12_comap-proteo.md`).

### Mise à jour 2026-09-19 — `core/paths.ts` : où vivent les fichiers du serveur

Chaque plugin portait sa propre constante `REPO_ROOT` (sept copies de la même remontée de
dossiers) pour bâtir le défaut de sa clé `*_FILE`, et `config/env.ts` une huitième pour
`KASBAH_HOUSE_FILE` / `KASBAH_STATIC_DIR`. Un seul module répond désormais à la question :

- `SERVER_ROOT` — `apps/server`, reconnu que le code tourne depuis `src/` ou depuis le bundle
  `dist/main.js` (la profondeur diffère ; voir `../5_setup/5_2_production.md`),
- `REPO_ROOT` — la racine, d'où `config/env.ts` tire ses deux défauts,
- `stateFile(nom)` — un fichier de `.state`, redirigeable par `KASBAH_STATE_DIR`.

Le gain n'est pas la ligne économisée mais l'endroit unique à relire quand l'arborescence bouge, et
le point d'entrée qui a permis d'isoler l'état des tests d'un seul geste au lieu d'une discipline à
répéter plugin par plugin.

### Mise à jour 2026-09-23 — `core/playbackBridge.ts` : le pont des sources musicales quitte ytmusic

Un plugin n'a pas de `PluginContext.execute` vers les appareils d'un **autre** plugin. Les sources
musicales, qui ne publient aucun appareil, en ont pourtant besoin pour envoyer `play_url` / `pause` /
`stop` à un lecteur Cast ou Sonos. Le pont tardif qui comble ce manque vivait dans le plugin ytmusic
(`apps/server/src/plugins/ytmusic/bridge.ts`, `YtmusicBridge` / `setYtmusicBridge` /
`getYtmusicBridge`) ; depuis le 2026-09-23 il est **déplacé** dans le noyau :
`apps/server/src/core/playbackBridge.ts`, symboles renommés **`PlaybackBridge`** /
**`setPlaybackBridge`** / **`getPlaybackBridge`**, sans changement de forme (`getDevice`, `execute`,
`onState`).

Pourquoi : un deuxième utilisateur est arrivé, le plugin `radio` (`../3_plugins/3_19_radio.md`) — le
pont n'appartient plus à un seul plugin. Le branchement reste dans
`app.ts`, après `PluginHost` (et `setPlaybackBridge(null)` à la fermeture) ; les tests continuent
d'injecter par `deps`.

Sources : `apps/server/src/core/playbackBridge.ts`, `apps/server/src/app.ts`,
`apps/server/src/plugins/{ytmusic,radio}/index.ts`.

### Mise à jour 2026-09-23 (2) — un lecteur musique hors des plugins, et un registre de sources

Plus tard le même jour, le cœur de lecture de ytmusic (proxy, file, transfert, écoute locale) quitte
le plugin pour **`apps/server/src/music/`** : `createMusicPlayer`, monté par `app.ts` sous
`/api/music` juste après `setPlaybackBridge`, fermé par `music.stop()` dans `close()`. Ce n'est **pas
un plugin** : ni santé, ni activation, ni réglages — il existe dès que le serveur tourne et ne sert
que les sources inscrites. Sa config (`musicConfigSchema` : `FFMPEG_PATH`, `MUSIC_PUBLISH_BASE`) est
lue sur l'environnement complet, comme les plugins.

Le lien plugin → lecteur est un **registre de module** (`music/sources.ts`), pas un champ de
`PluginContext` : `registerMusicSource(...)` à `init`, la fonction rendue appelée à `stop`. Une source
coupée disparaît donc du registre, et ses pistes sont refusées (400). Comme le pont de lecture
ci-dessus, c'est un module partagé, pas une extension du contrat `DevicePlugin`.
Deux sources s'y inscrivent : `ytmusic` et `mixcloud` (nouveau plugin, dans `PLUGIN_FACTORIES`).
Détail : `1_6_lecteur-musique.md`, `../3_plugins/3_20_mixcloud.md`.

Sources : `apps/server/src/app.ts`, `apps/server/src/music/{player,sources}.ts`,
`apps/server/src/plugins/index.ts`.

### Mise à jour 2026-09-23 (3) — le moteur d'automatisations dans l'assemblage

`buildApp` construit un `AutomationEngine` **après `host`** (par qui passent ses commandes, la même
chaîne `assertCommandAllowed` + `host.execute` que le REST) et **avant le hub** WebSocket, dont le
snapshot porte la liste (`WsHubOptions.automations`). `automations.onChange` rediffuse la liste
entière (`hub.broadcast({ type: 'automations', ... })`), et `automations.start()` — chargement du
fichier, abonnements au bus, photo de référence, minuteur — est attendu avant que l'application soit
prête : **un fichier d'automatisations invalide empêche le démarrage**. À l'arrêt, `close()` passe
**en premier**, pour que rien ne se déclenche pendant que les plugins s'arrêtent.

Exposé sur `KasbahApp.automations` (tests) et transmis aux routes par `RoutesDeps.automations`.
Détail du moteur, du fichier `<maison>.automations.json` et des pièges (bus sans try/catch, valeurs
par défaut d'un appareil pas encore relevé) : `1_8_automatisations.md`.

Sources : `apps/server/src/app.ts`, `apps/server/src/http/routes.ts`, `apps/server/src/ws/hub.ts`,
`apps/server/src/core/automations/engine.ts`.

## Mise à jour 2026-09-24 — un démarrage raté est retenté

Jusqu'ici, un plugin dont `init` / `discover` / `start` échouait au démarrage (fabricant injoignable,
box en plein redémarrage, réseau pas encore monté) restait en `error` jusqu'au redémarrage du serveur
— relevé sur la TaHoma le 2026-09-24 (`../3_plugins/3_4_somfy-tahoma.md`).

`startOne` (`apps/server/src/core/plugin-host.ts`) programme désormais une **nouvelle tentative**,
exponentielle (15 s, 30 s, 1 min… plafond 10 min, gigue ±10 %, `retryInitialMs` injectable) ; le
`detail` de santé l'annonce (« … (retry in 15 s) »). Chaque essai repart d'un plugin **arrêté
proprement** (`stopOne` puis `startOne`), et un succès remet la séquence à zéro.

- **Pas de nouvelle tentative sur `NEEDS_PAIRING`** : un jeton manquant ou refusé demande un geste de
  l'utilisateur, le réessayer ne ferait que marteler le fabricant.
- Éteindre le plugin, le redémarrer ou arrêter le serveur **annule** la tentative en attente
  (`stopOne`).
- Tests : `apps/server/src/core/plugin-host.test.ts`.

## Mise à jour 2026-10-01 — les plugins démarrent en parallèle

`PluginHost.startAll()` attendait chaque plugin l'un après l'autre, dans l'ordre des fabriques :
Google Cast (3 s d'écoute mDNS, puis une connexion à chaque appareil connu, téléviseurs en veille
compris jusqu'à leur délai) retardait tous ceux d'après, et un plugin qui ne rendait jamais la main
bloquait la suite (`startOne` n'a pas de délai). Désormais `startAll` lance tous les `startOne` à
la fois (`Promise.all`, `apps/server/src/core/plugin-host.ts`). Sans risque d'échec en cascade :
`startOne` rattrape ses propres erreurs (statut `error`, nouvelle tentative différée). Aucun plugin
ne dépend d'un autre au démarrage — chacun ne fait qu'alimenter le registre ; la musique ne cherche les
lecteurs qu'au moment de jouer. L'arrêt (`stopAll`) reste séquentiel, en ordre inverse. Test :
« starts plugins side by side » dans `plugin-host.test.ts`. Vérifié sur la maison réelle : les
plugins à `ok` après redémarrage (sauf un, en erreur pour son jeton, sans lien).

## Mise à jour 2026-10-01 — « charger » une voiture force aussi la borne (côté serveur)

**Pourquoi.** Lancer la charge d'une voiture branchée sur une borne qui ne donne pas de courant ne fait
rien : la borne Enphase en charge verte, sans soleil, laisse la voiture branchée sans charger. Il fallait donc forcer la borne en même temps. Décision de l'utilisateur : le faire
dans le SERVEUR et non dans l'interface, pour que les automatisations et le MCP en profitent aussi.

**Où.** `PluginHost.execute` (`core/plugin-host.ts`) appelle `chargerToForce`
(`core/chargeCoordination.ts`, fonction pure) puis `dispatch` (l'ancien corps d'`execute`, devenu privé).
Si une borne est désignée, elle reçoit `ev_charger.start` d'abord ; la commande part ensuite à la voiture.
Un échec de la borne est journalisé (`warn`) et **n'empêche pas** la commande à la voiture.

**La règle** (volontairement prudente, parce qu'aucune borne ne dit quelle voiture elle alimente — une borne peut
se croire attelée à une Renault quand c'est une Tesla) :

- seulement `vehicle.start_charge` ;
- la voiture se dit `pluggedIn` et pas `charging` ;
- elle est à la maison : `geoDistance` ≤ `HOME_RADIUS_M` (120 m) de `house.origin` ; position inconnue =
  on la croit à la maison ;
- UNE SEULE borne `charge_control`, `available`, `status: 'connected'`. Deux candidates : on ne devine
  pas, rien n'est forcé.

**L'arrêt n'est JAMAIS relayé.** Arrêter la borne Enphase la bloque jusqu'au débranchement (annulation
manuelle, cf. `../3_plugins/3_7_enphase.md`) : la voiture qui arrête suffit, et la borne revient en vert
au débranchement.

> **Corrigé le 2026-10-01 (plus tard)** : « l'arrêt n'est JAMAIS relayé » n'est plus vrai pour un véhicule
> qui ne sait pas s'arrêter (section suivante). L'ancien texte reste valable pour tous les autres.

**Journaux.** Le logger pretty affichait l'heure en UTC (`translateTime: 'HH:MM:ss'`) ; il passe en heure
locale (`'SYS:HH:MM:ss'`, `core/logger.ts`). Les journaux vont sur la sortie standard de `npm run house`
(lignes préfixées `[house]`), sans fichier.

Sources : `apps/server/src/core/{chargeCoordination,plugin-host,logger}.ts`, test
`chargeCoordination.test.ts`.

### Mise à jour 2026-10-01 (2) — arrêter un véhicule qui ne sait pas s'arrêter : on arrête sa borne

**Pas encore essayé sur la vraie voiture.**

**Pourquoi.** La R5 n'arrête pas sa charge à distance (`charge/pause-resume` en 403, `charge-stop` absent chez
`renault-api` : « use charger to stop »). Plutôt qu'un bouton « Arrêter » qui échoue, le serveur arrête la borne
à sa place. **Choix de l'utilisateur, en connaissance de cause** : la borne Enphase reste alors bloquée jusqu'au
débranchement (`../3_plugins/3_7_enphase.md`), soleil ou pas.

**La règle** (`chargerToStop`, `core/chargeCoordination.ts`, pure) désigne la borne à arrêter, seulement si :

- la commande est `vehicle.stop_charge` ;
- le descripteur du véhicule déclare `meta.vehicle.stopViaCharger` (`1_1_contrat-appareils.md`) : c'est le
  véhicule qui le dit, le serveur ne code pas « Renault » ;
- le véhicule est branché, et à la maison (≤ `HOME_RADIUS_M`, position inconnue = on la croit) ;
- UNE SEULE borne `charge_control`, `available`, en `status: 'charging'`. Deux candidates : on ne devine pas.

On n'exige **pas** que le véhicule se dise en charge : la R5 annonce parfois « en attente » en chargeant
(cf. `../3_plugins/3_9_renault.md`, `chargingStatus` qui ment). Les deux règles partagent `onlyCharger`.

**Dans `PluginHost.execute`**, l'arrêt est essayé EN PREMIER. Borne trouvée : `ev_charger.stop` seul, RIEN n'est
envoyé au véhicule (il refuserait). Sinon la commande part au véhicule, dont le plugin répond
`UNSUPPORTED_COMMAND`. Le démarrage garde son comportement : borne forcée d'abord, échec non bloquant.
À l'arrêt, au contraire, un échec de la borne REMONTE à l'appelant : c'est le seul chemin par lequel ce
véhicule s'arrête, l'utilisateur doit savoir que rien ne s'est arrêté.

Sources : `apps/server/src/core/{chargeCoordination,plugin-host}.ts`, test `chargeCoordination.test.ts`,
`packages/shared/src/devices/descriptor.ts`.

### Mise à jour 2026-10-02 — à sa limite, la voiture rend la borne à son mode

Choix de l'utilisateur du 2026-10-02 : une charge forcée finie, la borne reprend le mode d'avant le
forçage (charge verte, programmée…) sans attendre le débranchement. `PluginHost` retient
véhicule → borne quand `chargerToForce` a réussi (`forcedFor`), écoute le bus `state`, et envoie
`ev_charger.resume_mode` à la borne dès que `chargeLimitReached` (`chargeCoordination.ts`, pure) :
niveau au moins à la cible ET plus en charge (la R5 s'arrête parfois un point au-dessus de la cible). Une seule fois ;
échec journalisé, non remonté. Débranchée avant, le lien est oublié : la borne s'en aperçoit
elle-même (`../3_plugins/3_7_enphase.md`, même date). Un arrêt relayé (`chargerToStop`) oublie aussi
le lien. Le lien vit en mémoire : un redémarrage du serveur le perd.

Sources : `apps/server/src/core/{chargeCoordination,plugin-host}.ts`, test `chargeCoordination.test.ts`.

### Mise à jour 2026-10-02 (2) — « en charge » démenti quand aucune borne ne charge

La R5 s'est dite en charge pendant des heures alors que la borne, en charge verte sans soleil, ne
donnait rien (`../3_plugins/3_9_renault.md`, même date). Choix de l'utilisateur : corriger le plugin
ET faire démentir par la borne, côté serveur.

**La règle** (`chargingRefuted`, `core/chargeCoordination.ts`, pure) dément un véhicule qui se dit en
charge seulement si : il est branché, sa position est CONNUE et à la maison (`HOME_RADIUS_M`), il ne
mesure pas sa propre puissance (`chargePowerW` > 0 : la Tesla sait mieux que nous), et TOUTES les
bornes sont joignables et ne chargent pas. Une borne qui charge ne dément rien : aucune ne dit quelle
voiture est au bout du câble. Pas de borne du tout, ou une borne injoignable : rien n'est démenti.
Faux si la voiture charge sur une prise que Kasbah ne voit pas — risque accepté.

**Où.** `ctx.emitState` passe par `PluginHost.checkChargingClaim` : la PAROLE du plugin est retenue
(`claimsCharging`), et ce qui est publié est `charging: false` (avec `chargeMinutesRemaining: null`)
tant que la règle dément. À chaque état de borne et à chaque changement de disponibilité,
`recheckChargingClaims` relit ces paroles : dès qu'une borne charge, `charging: true` est rendu sans
attendre la trame suivante du véhicule (le temps restant, lui, attend la trame).

Sources : `apps/server/src/core/{chargeCoordination,plugin-host}.ts`, test `chargeCoordination.test.ts`.

## Mise à jour 2026-10-01 (3) — `core/atomic-file.ts` : écritures atomiques mises en file

Les fichiers d'état du serveur (sessions, jetons, caches, historiques, favoris) s'écrivaient chacun
avec sa propre copie du même motif : `<fichier>.<pid>.tmp` puis `rename`. Dix-neuf copies, aucune
sérialisée. Or les plugins enregistrent **sans attendre** (`void store.save(…)`) : deux écritures
rapprochées du même fichier partageaient le même `.tmp`, le premier `rename` l'emportait et le
second échouait en ENOENT (vu au démarrage, sur le cache d'état Tesla, voir
`../6_faq/6_1_pieges-runtime.md`).

`writeFileAtomic(path, text, { mode })` remplace ces copies. Il garde le `.tmp` nommé d'après le
pid : le serveur de développement et celui de la preview écrivent parfois le même fichier. Il met
**en file les écritures d'un même chemin** : une file par chemin résolu, tenue au niveau du module.
Elle couvre donc aussi une fonction libre (`saveQuiet` de TaHoma) et un plugin redémarré pendant
qu'une écriture est encore en cours. C'est la mécanique de `updateHouseFile` (`config/house.ts`).
La dernière écriture demandée est la dernière écrite. En cas d'échec, l'utilitaire rejette sans
bloquer la file. Chaque site garde son choix : avertissement dans le journal (la plupart des
plugins) ou erreur remontée à l'appelant (radio, agenda, Mixcloud, musique, `saveQuiet`).

- **Sites migrés** : `music/lastPlayed.ts` ; `plugins/{agenda,mixcloud}/store.ts`,
  `plugins/radio/favorites.ts`, `plugins/{automower,comap,tesla}/state.ts`,
  `plugins/{melcloud,tahoma}/history.ts`, `plugins/enphase/{cloud,token}.ts`,
  `plugins/{google_cast,sonos}/known.ts`, `plugins/{irobot,melcloud,petkit,renault,tesla}/auth.ts`,
  `plugins/tahoma/index.ts` (`saveQuiet`).
- **`clear()` des sessions** (iRobot, MELCloud, PetKit, Renault) : passe aussi par la file. Avant,
  il écrivait le fichier directement, et une sauvegarde encore en cours pouvait rétablir la session
  effacée juste après.
- **Texte figé à l'appel** : plusieurs sites sérialisaient l'objet après la création du dossier,
  donc un instant plus tard, sur un objet qui avait pu changer entre-temps.
- **Non migrés** : `config/house.ts` et `core/automations/store.ts`, déjà sérialisés et qui font en
  plus une copie `.bak` (la maison relit aussi le fichier avant de le modifier).
- **Tests** : `core/atomic-file.test.ts` (dix écritures rapprochées → la dernière, aucun `.tmp`
  restant ; un échec ne bloque pas la suivante) et le cas Tesla dans `plugins/tesla/state.test.ts`.

### Mise à jour 2026-10-08 — le mode démonstration et la bascule de propriété

**Décision de l'utilisateur** : « démo d'abord, vrai multi ensuite ». Le vrai multi-sites (plusieurs
maisons vivantes en même temps sur un serveur, chaque écran choisissant la sienne) est une **étape
suivante, pas encore conçue**. Aujourd'hui seul le mode démo bascule entre propriétés.

- **Qui décide** : `apps/server/src/main.ts`. **Sans `KASBAH_HOUSE_FILE`**, le serveur est une
  *démonstration* : il charge les trois propriétés de `house/demos/`
  (`loadDemoProperties`, `DEMO_HOUSE_FILES` dans `apps/server/src/config/properties.ts`), retient celle
  qu'on a choisie dans `stateFile('demo-property.json')` et fait vivre cette seule maison. **Avec**
  `KASBAH_HOUSE_FILE`, il fait vivre ce fichier comme toujours et `properties` n'est pas fourni
  (`singleProperty`, `switchable: false`).
- **Le scénario mock suit la maison** : `meta.demo.scenario` de la propriété est injecté par
  `envSource.MOCK_SCENARIO` ; `MOCK_SCENARIO=winter` donne `<scénario>-winter`.
- **La bascule est un arrêt puis une reconstruction** : `POST /api/properties/:id/select` répond 202,
  puis (50 ms plus tard, la réponse partie) `switchTo` ferme l'application courante, écrit la propriété
  retenue et rappelle `start()` sur l'autre maison, **sur le même port** (pas de rechargement à chaud
  des plugins : on reconstruit tout). Mesuré : **0,3 s**.
- **Piège : `app.close()` attendait des connexions ouvertes** (proxy de Vite, requêtes en cours).
  Passé une seconde, `app.server.closeAllConnections()` les coupe ; les
  écrans se reconnectent à la nouvelle maison.
- **L'écran ouvert se recharge seul** : le `snapshot` WebSocket porte `propertyId`
  (`../1_architecture/1_3_protocole-rest-ws.md`) ; un écran qui le trouve changé recharge la page.
- **`apps/server/src/config/env.ts` garde `house/demo-house.json` comme défaut de
  `KASBAH_HOUSE_FILE`** : c'est ce que voit `buildApp` dans les tests. `main.ts` regarde
  `process.env` AVANT `loadEnv()`, d'où le serveur de démonstration. Ne pas « corriger » l'un en
  croyant que l'autre ment.
- **Un `.env` qui définit `KASBAH_HOUSE_FILE` empêche la démo** ; pour lancer la démo à côté, mettre la
  variable à **vide** (ni dotenv ni `node --env-file` n'écrasent `process.env`) — c'est ce que fait la
  config de preview `kasbah-demo-server` (`../5_setup/5_0_installation-et-scripts.md`).
- Limite : en démo, une édition depuis l'UI (placement, pièces) réécrit le fichier **versionné** de la
  propriété affichée (`house/demos/<id>.json`).

Sources : `apps/server/src/main.ts`, `apps/server/src/config/properties.ts`,
`apps/server/src/http/routes.ts`, `apps/server/src/ws/hub.ts`.

### Mise à jour 2026-10-08 — la santé des comptes de qui demande

**Pourquoi.** Demande de l'utilisateur : « affiche le badge de santé du compte de l'utilisateur
connecté ». Depuis les comptes musicaux par utilisateur (2026-10-07, `1_6_lecteur-musique.md`), le badge
de Réglages → Plugins restait celui de la maison : un connecté sans compte relié lisait « liaison
requise » pour YouTube Music, alors que l'accès anonyme fonctionnait.

**Contrat.** `DevicePlugin.healthFor?(user: string): Promise<PluginHealth>` (`core/plugin.ts`),
facultatif : la santé des comptes d'un utilisateur connecté, pour un plugin qui en tient par
utilisateur. Absent : `health()`, la même pour tous. Seuls ytmusic et Mixcloud le déclarent
(`../3_plugins/3_16_ytmusic.md`, `../3_plugins/3_20_mixcloud.md`).

**Hôte** (`core/plugin-host.ts`). `health(user = null)` et `inventory(user = null)` deviennent
**asynchrones**. `healthOf` appelle `healthFor(user)` quand un compte est donné et que le plugin tourne ;
un `healthFor` qui échoue retombe sur `health()`, l'inventaire ne tombe pas. Plugin éteint ou en
erreur : inchangé ; `deviceCount` et `keys` restent posés par l'hôte. Pourquoi asynchrone : l'état d'un
compte se lit sur disque (cookie, `mixcloud.json`) à son premier usage ; un `health()` synchrone aurait
rendu un état faux tant que le compte n'était pas chargé.

**Appelants.** `GET /api/health`, `GET /api/plugins` et `PATCH /api/plugins/:id` passent
`req.sessionUser ?? null` (`http/routes.ts`) ; l'outil MCP `get_health` passe le compte du jeton. Sur le
réseau local, rien ne change : c'est la maison.

**Tests.** `plugin-host.test.ts`, « plugin host health per account » : maison, utilisateur, repli quand
`healthFor` échoue ; contrôle négatif fait (un hôte qui ignore le compte fait rougir le test). Les tests
existants attendent désormais `await h.health()`. Suite complète 2 019 tests verts.

Sources : `apps/server/src/core/{plugin,plugin-host}.ts`, `apps/server/src/http/routes.ts`,
`apps/server/src/mcp/server.ts`.


### Mise à jour 2026-10-10 — propriétés locales, démos en lecture seule, duplication

**Pourquoi** : le dépôt est public, et une installation fraîche doit pouvoir créer SA maison sans
toucher aux fichiers versionnés (par défaut, elle démarre en mode démonstration). Choix validés par
l'utilisateur : les propriétés créées vivent dans un dossier **ignoré par git**, repérées
automatiquement et proposées dans le sélecteur ; les démos ne se modifient **pas** (on les duplique).

- **`house/properties/`** (`LOCAL_PROPERTIES_DIR`, `.gitignore`) : un fichier `<id>.json` par
  propriété. Écart assumé avec l'idée première (« `house/` ») : le serveur de démonstration y aurait
  ramassé `house/maison.json` (la maison réelle, avec ses vrais plugins) et les fichiers voisins
  (automatisations, sauvegardes, historique). `loadLocalProperties` ignore `*.automations.json`, un
  fichier illisible ou sans `id` / `name`, et trie par nom.
- **Liste = propriétés locales d'abord, puis démos** (`all()` dans `main.ts`). Le serveur de
  démonstration seul porte `canCreate: true` ; avec `KASBAH_HOUSE_FILE`, rien ne change
  (`singleProperty`, `kindOf` partagé lit `meta.demo.kind` puis `meta.kind`).
- **Le scénario mock se lit dans la maison, pour toute propriété** : une copie de démo garde donc
  `meta.demo.scenario` et son parc simulé (69 appareils simulés vérifiés sur une copie) ; une maison
  neuve n'a pas de scénario, donc pas de parc.
- **Lecture seule d'une démo** : `start()` passe `readOnly` à `buildApp`, qui pose
  `LoadedHouse.readOnly`. `updateHouseFile` lève `ReadOnlyHouseError` (409 `DEMO_READONLY`) AVANT de
  lire le fichier, et `createAutomationsFile(path, { readOnly })` refuse `save` de la même façon.
  Tout passe par là : placement, pièces, réglages de plugins (activation écrite dans le JSON) et
  automatisations. Vérifié : 409 et fichier inchangé.
- **Remplace** la limite de la mise à jour du 2026-10-08 (« en démo, une édition réécrit le fichier
  versionné `house/demos/<id>.json` ») : elle n'est plus vraie.
- **Création et duplication** (`createLocalProperty`, `duplicateProperty`) : l'id vient du nom
  (`propertyIdFor`, unique parmi les ids existants), le document passe `parseHouse` avant d'être écrit
  (jamais de maison invalide sur disque), écriture par `.tmp` puis `rename`. La bascule vers la
  nouvelle propriété est un `select` à part, comme avant.

Limite : le nom ne se change pas après création ; pas de création en mode in-process.

Sources : `apps/server/src/main.ts`, `apps/server/src/config/{properties,house}.ts`,
`apps/server/src/core/automations/store.ts`, `apps/server/src/app.ts`.
