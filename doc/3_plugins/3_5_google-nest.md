# Plugin Google Nest (caméras, sonnettes)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/nest/{index,client,mapping,types}.ts`, `apps/server/src/plugins/nest/__fixtures__/sdm.ts`, tests `mapping.test.ts` et `plugin.test.ts`, `apps/server/.env.example`, `apps/web/src/components/NestLinkCard.vue`, demande de l'utilisateur du 2026-09-09

## Ce que l'utilisateur veut, et par étapes

Demande initiale : intégrer la sonnette à caméra et les autres caméras Nest — allumer/éteindre une
caméra, voir la vidéo dans la scène 3D et sur la carte détail, une vue « Caméras » (comme Lumières
et Ouvrants), et **quand on sonne, cadrer la pièce de la sonnette et afficher la
vidéo**. Découpé en phases, la première étant l'inventaire et le placement, comme pour les autres
fabricants.

| Phase | Contenu | État |
|---|---|---|
| 1 | Liaison du compte Google, inventaire des caméras, placement par `meta.room`, carte détail | **fait et vérifié sur le compte réel** (2026-09-09) |
| 2 | Vidéo en direct sur la carte (fait, relais RTSP → MP4 fragmenté côté serveur, voir plus bas) ; dans la scène 3D : à faire | **carte faite** (2026-09-09) |
| 3 | Événements Pub/Sub (sonnerie, mouvement, personne) → cadrage automatique de la pièce + vidéo | **fait pour la sonnette** (2026-09-09 : récepteur serveur + réaction 3D web) ; mouvement/personne à venir |
| 4 | Vue « Caméras » dans le rail | **fait** (2026-09-09, `views/CamerasView.vue` sur `RoomBands`, voir `../4_ui/4_1_navigation-et-panneaux.md`) |

**Ce que l'API ne permet pas** : éteindre une caméra. L'API Smart Device Management n'expose pas le
réglage marche/arrêt de l'appli Google Home. Le kind `camera` ne déclare donc pas `on_off`
(cf. `../1_architecture/1_1_contrat-appareils.md`) — promettre un interrupteur qu'aucune commande ne
peut honorer serait mentir. Si l'utilisateur y tient, il faudra une autre voie (routine Google
Home, hors API) et ce sera un choix explicite.

> Mise à jour du 2026-09-09 : l'appli web Google Home **sait** activer/désactiver les caméras et les
> affiche toutes en direct — mais par une **API privée** de Google, pas par SDM. Détail, preuves et
> piste d'un connecteur non officiel : « Observation 2026-09-09 — activer/désactiver et multi-live »
> en bas de page.

## API utilisée

**Smart Device Management (SDM)**, `https://smartdevicemanagement.googleapis.com/v1`, cloud
uniquement : les appareils Nest **n'ont pas d'API locale**, il n'y a rien à découvrir sur le LAN.
La liste des appareils partagés avec le projet se lit par
`GET /enterprises/<NEST_PROJECT_ID>/devices` (jeton Bearer OAuth). Chaque appareil a un `type`
(`sdm.devices.types.DOORBELL`, `CAMERA`, `DISPLAY`, `THERMOSTAT`), un dictionnaire `traits`
(`Info.customName`, `CameraLiveStream.supportedProtocols`, `DoorbellChime`…) et des
`parentRelations` dont le `displayName` est **la pièce Google Home**.

Limites connues : quelques appels par minute et par utilisateur sur la liste ; le plugin ne la lit
qu'au démarrage et à la liaison (pas de sondage — les événements viendront par Pub/Sub).
*(Dépassé le 2026-09-09 : la liste est sondée toutes les `NEST_POLL_MS` (60 s par défaut, `apps/server/src/plugins/nest/index.ts`) et les événements arrivent par Pub/Sub — voir « Mise à jour 2026-09-09 — le thermostat, et un sondage lent » et « phase 3 : récepteur d'événements Pub/Sub ».)*

## Prérequis côté Google (à faire par l'utilisateur, une fois)

Détaillés dans `apps/server/.env.example`. En résumé : un projet Google Cloud avec l'API SDM activée
et un **client OAuth de type application web** dont l'URI de redirection est exactement
`NEST_REDIRECT_URI` ; un projet **Device Access** (5 USD une fois, `console.nest.google.com`) qui
référence ce client OAuth — son UUID est `NEST_PROJECT_ID`. Les caméras doivent être sur un compte
Google (un ancien compte Nest doit être migré). Kasbah ne crée rien de tout ça : ce sont des comptes
et des secrets de l'utilisateur.

## Liaison du compte (`needs_pairing`)

Même schéma que Hue et TaHoma : sans `NEST_REFRESH_TOKEN` le plugin démarre en `needs_pairing`,
zéro appareil, et Réglages montre la carte « Google Nest » (`NestLinkCard.vue`).

1. `GET /api/plugins/nest/auth/url` → URL du **Partner Connections Manager** de Google
   (`nestservices.google.com/partnerconnections/<projet>/auth`) avec `access_type=offline`,
   `prompt=consent` (indispensables pour recevoir un jeton de rafraîchissement) et un `state`
   aléatoire mémorisé côté serveur. C'est là que l'utilisateur **choisit les caméras partagées**.
2. Google redirige vers `GET /api/plugins/nest/auth/callback?code&state`. Un `state` inconnu → 400
   (`INVALID_STATE`) ; il est à usage unique. Le code s'échange contre `refresh_token` +
   `access_token` sur `oauth2.googleapis.com/token`.
3. Le jeton de rafraîchissement est **adopté en mémoire** (redécouverte + `emitDevices` + états), et
   la page HTML de retour affiche `NEST_REFRESH_TOKEN=…` à coller dans `.env`. Le serveur n'écrit
   jamais `.env`.

Portées demandées : `sdm.service` et déjà `pubsub` — inutile en phase 1, mais l'ajouter plus tard
obligerait à refaire la liaison.

Le jeton d'accès dure une heure ; `NestClient` le renouvelle à la demande avec une marge de 60 s.
`invalid_grant` au renouvellement (jeton révoqué) → `NEEDS_PAIRING`, message « link the account
again » ; 403 de SDM après liaison (API pas activée, projet Device Access mal lié) → le message de
Google est remonté tel quel dans `health().detail`.

### Piège 2026-10-01 — « Token has been expired or revoked » : l'écran de consentement en « Testing »

Constaté sur la maison réelle : `health` de nest en `error`, « Google refused the grant (Token has
been expired or revoked.): link the account again », zéro appareil. Cause **probable, non confirmée**
dans la console : tant que l'écran de consentement OAuth du projet Google Cloud est en mode
**Testing**, Google fait expirer les jetons de rafraîchissement **au bout de 7 jours**. Remède : passer
l'application en **In production** (écran de consentement OAuth ; pour un usage personnel, Google
affiche seulement un avertissement « application non vérifiée »), puis relier le compte une dernière
fois depuis Réglages. Le plugin n'y peut rien : il ne fait que relayer le refus.

## Mappage (`mapping.ts`, pur)

- `isCamera` : le `type` est dans `CAMERA_TYPES` (`CAMERA`, `DOORBELL`, `DISPLAY`). Les thermostats
  sont **ignorés mais comptés** (`health` : « N camera(s), M other device(s) ignored »).
  *(Dépassé le 2026-09-09 : les thermostats sont publiés en kind `climate` — voir « Mise à jour 2026-09-09 — le thermostat, et un sondage lent ».)*
- `externalId` = dernier segment de `name` (`enterprises/…/devices/<id>`), opaque et stable.
- `toDescriptor` : kind `camera` ; capacités `live_stream` si trait `CameraLiveStream`, `chime` si
  `DoorbellChime` ; `meta.camera.deviceClass` d'après le type, `meta.camera.protocols` d'après
  `supportedProtocols` (`WEB_RTC` → `webrtc`, `RTSP` → `rtsp`) ; `meta.room` = pièce Google Home ;
  `meta.manufacturer` « Google Nest », `meta.model` = type sans préfixe.
- **Nom** : `Info.customName`, que Google laisse souvent **vide** (l'appli Google Home affiche alors
  « <pièce> <type> ») → repli « <type> <pièce> » ici (« Caméra Garage », « Sonnette Entrée »), le type en
  **préfixe** comme les autres appareils de la maison (« Volet Salon »), et en français : le nom d'un
  descripteur est une seule chaîne, la traduire selon la langue d'affichage aurait demandé de
  reconnaître un nom de repli aux six endroits où le client lit `descriptor.name` — écarté avec
  l'utilisateur. Vide confirmé sur la capture pour la majorité des appareils.

`meta.room` est la clé de l'**auto-placement** (`../2_maison/2_0_format-house-json.md`) : nommer la
pièce de la maison comme la pièce Google Home suffit à faire apparaître la caméra dans la scène 3D.
Sinon la caméra est listée « non placée » et se
place à la main par le mode Déplacer du panneau appareil.

## Routes propres

| Route | Rôle |
|---|---|
| `GET /api/plugins/nest/auth/url` | URL de consentement + `redirectUri` attendue |
| `GET /api/plugins/nest/auth/callback` | retour Google, adoption du jeton, page HTML |
| `GET /api/plugins/nest/devices/raw` | **dernière réponse brute** de la liste, pour relever une fixture réelle |

## Fixtures : relevées sur le compte réel (2026-09-09)

`__fixtures__/sdm.ts` reproduit la capture de `GET /api/plugins/nest/devices/raw` faite le jour de
la liaison, anonymisée (UUID du projet, ids d'appareils, de structure et de pièces),
noms conservés. Ce que la capture a appris, par rapport à la fixture écrite d'après la doc :

- `Info.customName` est **vide sur la majorité des appareils** — peu d'entre eux ont
  un nom. Le repli « <type> <pièce> » (« Caméra Garage ») est donc le nom le plus courant ;
- `parentRelations[0].displayName` porte bien la pièce Google Home, et un champ `assignee` (non
  utilisé) la double ;
- **toutes les caméras relevées sont en RTSP** 640×480 H264/AAC — caméras et sonnette de 1re génération — avec
  `CameraImage` + `CameraEventImage`, et aucun `WEB_RTC` ni `CameraClipPreview`. La fixture garde une
  caméra WebRTC **synthétique**, marquée comme telle, pour exercer le mappage des protocoles.

## Tests

`mapping.test.ts` (filtre des types, id, descripteurs sonnette / RTSP / écran, protocoles inconnus et
doublons, trait absent, URL d'autorisation). `plugin.test.ts` avec un faux Google (`fetchImpl`) et
`app.inject` : non configuré → `error` et `/auth/url` en 409 ; liaison complète (`state` forgé
refusé, échange du code, en-tête Bearer, `emitDevices`, page HTML avec le jeton, `state` à usage
unique, `/devices/raw`) ; déjà lié par `.env` (rafraîchissement, découverte, jeton réutilisé) ;
jeton révoqué → `NEEDS_PAIRING` ; 403 SDM → message de Google.

## État réel

Compte lié le 2026-09-09 : **les caméras remontent** (caméras et sonnette),
le thermostat est ignoré et compté *(dépassé le 2026-09-09 : publié en `climate`, voir « le thermostat, et un sondage lent »)*, `health` en `ok`. Deux constats qui engagent la suite :

- **Phase 2 = RTSP, pas WebRTC.** Aucune caméra relevée ne parle WebRTC ; le flux RTSP (URL signée,
  à prolonger toutes les 5 min via `ExtendRtspStream`) ne se lit pas dans un navigateur. Il faudra
  un transcodage côté serveur (ffmpeg → HLS ou fragments MP4 / WebRTC local). L'image d'événement
  (`CameraEventImage`, JPEG à la demande) est en revanche disponible et peut servir d'aperçu.
  *(Dépassé le 2026-09-09 : le relais ffmpeg est fait — voir « Mise à jour 2026-09-09 — phase 2 : la vidéo en direct (RTSP relayé) ».)*
- **Placement.** Les pièces Google Home dont le nom correspond à une pièce de la maison voient
  leurs caméras auto-placées. Quand la pièce Google Home n'a pas le nom de la pièce de la maison
  (cas d'une sonnette), soit renommer la pièce Google Home, soit déplacer l'appareil par le mode
  Déplacer (il est auto-placé, donc déplaçable). Les caméras extérieures restent **non placées** :
  l'auto-placement ne connaît que les pièces, pas les zones extérieures, et un appareil non placé
  n'a pas de marqueur à faire glisser. Pour elles il faudra soit une entrée dans le JSON de la
  maison, soit étendre l'auto-placement aux zones du jardin.
  Fait le jour même pour certaines, à la main dans le JSON de la maison (une caméra posée hors de
  toute pièce, sans `roomId` — un dépôt en mode Déplacer lui redonnerait la pièce sous le doigt,
  c'est le comportement de `roomAt`). **Sujet ouvert** : poser un appareil sur un **niveau** sans
  pièce (un toit, par exemple) — à traiter dans le format de la maison, pas dans ce plugin.

Vérifications sans compte, le même jour : preview avec de fausses clés, plugin en `needs_pairing`,
carte visible, `GET /auth/url` 200, `state` forgé → 400, `/devices/raw` → 404 avant toute liste.

### Piège rencontré 2026-09-09 — une clé vide dans `.env` désactivait le plugin

Symptôme : « Désactivé » dans Réglages après avoir rempli `.env`. Cause : `NEST_REFRESH_TOKEN=`
laissée vide en attendant la liaison, refusée par `z.string().min(1).optional()` → configuration
invalide → plugin `disabled`, avec un détail visible seulement dans les logs. Correction : les
quatre clés optionnelles passent par `optionalKey` (chaîne vide → `undefined`, valeur `trim`).
Autre confusion vécue : `NEST_PROJECT_ID` reçoit l'**UUID du projet Device Access**, pas l'id du
projet Google Cloud (`kasbah-projet`), et le plugin ne peut pas le détecter avant la liaison.

### Mise à jour 2026-09-09 — le thermostat, et un sondage lent

Le thermostat que la même API expose (un seul sur le compte) n'est plus ignoré :
kind **`climate`**, capacités `hvac_mode`, `target_temp`, `current_temp` et `humidity` si le trait
`Humidity` est là. Rien à faire côté Google : il était déjà partagé avec le projet. Les détecteurs
de fumée Nest Protect, eux, **ne sont pas dans l'API Device Access** (vérifié sur la capture :
aucun Protect) — seule l'API privée de l'appli Nest y accède, non documentée et
fragile ; écarté.

**Mappage** (`toThermostatDescriptor`, `toClimatePatch`, `toThermostatCommands`) :

| Google | Kasbah |
|---|---|
| `ThermostatMode.mode` HEAT / COOL / HEATCOOL / OFF | `mode` heat / cool / auto / off |
| `ThermostatEco.mode` MANUAL_ECO | `mode: 'eco'` — l'éco se superpose au mode HVAC chez Google, Kasbah n'a qu'un `mode` |
| `ThermostatHvac.status` HEATING / COOLING / OFF | `action` heating / cooling / idle (off si le mode est OFF) |
| `ThermostatTemperatureSetpoint.heatCelsius` (ou `coolCelsius` en COOL ; celles de l'éco quand il est actif) | `targetTempC` |
| `Temperature.ambientTemperatureCelsius`, `Humidity.ambientHumidityPercent` | `currentTempC`, `humidity` |
| `Connectivity.status` OFFLINE | `available: false` |
| `ThermostatMode.availableModes` + éco si proposé | `meta.climate.modes` (nouveau dans le contrat) |

Les flottants bruts de Google (24.23999) sont arrondis au dixième : sinon chaque relecture publierait
un « changement ». `meta.targetTempC` vaut la plage acceptée par Google, 9 à 32 °C. Le nom de repli
est « Thermostat <pièce> ».

**Commandes** : `climate.set_mode` → `ThermostatMode.SetMode` (ou `ThermostatEco.SetMode
MANUAL_ECO` pour `eco`) ; sortir de l'éco vers un mode HVAC prend **deux** commandes (éco OFF puis le
mode), Google ne le fait pas seul. `climate.set_target_temp` → `SetHeat` / `SetCool` / `SetRange`
selon le mode HVAC courant, bornée à 9–32 ; **refusée avant d'appeler Google** en éco ou à l'arrêt
(Google répondrait 400 `FAILED_PRECONDITION`), et un mode absent de `availableModes` aussi. Après
l'accusé de Google, le plugin **relit l'appareil** (`GET devices/<id>`) et publie ce qu'il a retenu,
plutôt que d'attendre le sondage suivant ou de croire la commande.

**Sondage** : l'API ne pousse rien sans Pub/Sub, donc la liste des appareils est relue toutes les
`NEST_POLL_MS` (60 s par défaut, plancher 10 s ; Google borne les appels à quelques-uns par
minute). Un seul appel couvre tout le parc : états du thermostat, disponibilité, et ajouts /
retraits d'appareils (l'inventaire n'est republié que s'il change). Le poller démarre avec le
plugin, ou à la liaison du compte quand celui-ci a démarré sans jeton.

**Côté web** : `ClimateControl.vue` ne propose plus que `meta.climate.modes` quand ils sont déclarés
(ce thermostat ne connaît que chauffage, arrêt et éco : lui offrir « Refroidissement » promettait
une commande refusée). Au passage, la section `climate` des locales **n'existait pas** — le contrôle
affichait ses clés brutes sur la pompe à chaleur simulée ; ajoutée en fr et en.

Un 400 de Google sur une commande remonte en `UNSUPPORTED_COMMAND` avec le message de Google, un
404 en `DEVICE_UNAVAILABLE`. Tests : `mapping.test.ts` (descripteur, état, éco / OFF / HEATING,
commandes et refus, HEATCOOL) et `plugin.test.ts` (faux Google qui exécute les commandes en mutant
sa copie du thermostat, sondage à l'horloge simulée, relecture après commande, 400 de Google).

### Mise à jour 2026-09-09 — phase 2 : la vidéo en direct (RTSP relayé)

Vérifié sur la sonnette réelle : image et son dans la carte détail, 1152 × 864 (Google annonce
640 × 480 dans `maxVideoResolution`, le flux fait mieux), lecture continue, ~4 s de retard sur le
direct.

**Côté Google** : `CameraLiveStream.GenerateRtspStream` rend une URL `rtsps://…?auth=<jeton>`
valable **cinq minutes** et un `streamExtensionToken` ; le plugin prolonge toutes les 4 min par
`ExtendRtspStream` — voir la contradiction ci-dessous : la connexion en cours est tout de même
coupée à l'échéance, il faut se reconnecter avec le nouveau jeton — et **arrête** la session par
`StopRtspStream` dès que plus personne ne regarde (8 s de grâce pour un changement de vue). Forme
des réponses conforme à la doc sur la première session réelle (`sdmRtspStreamSchema`,
`sdmExtendStreamSchema`, `types.ts`).

**Côté serveur** (`core/video/`, générique, rien de Nest dedans) : `RtspRelay` lance **un ffmpeg par
caméra regardée**, quel que soit le nombre d'écrans, qui recopie les flux sans ré-encodage
(`-c copy`, CPU négligeable) en MP4 fragmenté (`empty_moov+default_base_moof+frag_keyframe`) sur
stdout ; `fmp4.ts` découpe les boîtes et lit `avcC` / `mp4a` dans `moov` pour former la chaîne
`codecs` que Media Source Extensions exige (`video/mp4; codecs="avc1.4D0020, mp4a.40.2"` sur la
sonnette). L'entête (`ftyp` + `moov`) est gardée pour les abonnés qui arrivent en cours de route.
`FFMPEG_PATH` (défaut `ffmpeg`, clé commune non préfixée) désigne le binaire — installé sur la
machine du serveur, **jamais sur l'écran**, qui ne reçoit que du MP4 que son navigateur lit.

**Route** : `GET /api/plugins/nest/cameras/<externalId>/stream` en WebSocket (le proxy Vite a
gagné `ws: true` sur `/api`). Premier message : une ligne JSON `{ type: 'init', mime }` ; puis
l'entête MP4 et les fragments en binaire ; `{ type: 'ended', reason }` si ffmpeg s'arrête. Un
écran qui a plus de 8 Mo d'envoi en attente saute des fragments plutôt que d'empiler — c'est
sans danger parce que **chaque fragment commence par une image clé** (`frag_keyframe`).

**Côté web** : `CameraVideo.vue` (MSE) dans `CameraCard.vue` dès que la caméra déclare `rtsp` ;
l'URL vient de `Transport.cameraStreamUrl`, convention `/api/plugins/<plugin>/cameras/<id>/stream`.
Démarre en sourdine (règle des navigateurs pour l'autoplay), boutons arrêter / son.

**Le compromis de latence, à connaître.** `frag_keyframe` = un fragment par groupe d'images, écrit
seulement à l'image clé SUIVANTE : la lecture a forcément un fragment de retard, soit **4 s sur la
sonnette** (son groupe d'images fait 4 s). Un premier réglage qui se recalait à 0,3 s du bord
donnait 0,3 s d'image puis 3,7 s de gel, en boucle — relevé sur la vraie caméra (`readyState` 1,
`currentTime` figé entre deux fragments). `CameraVideo` mesure donc la durée des fragments et ne
se recale qu'au delà de deux fragments de retard, à un fragment du bord. Descendre sous les 4 s
demanderait des fragments plus courts (`-frag_duration`) et donc de repérer soi-même les images
clés (`trun`) pour les abonnés tardifs : pas fait, à décider si les 4 s gênent pour la sonnerie.
Même logique au démarrage : le premier fragment couvre un groupe d'images et le suivant n'arrive
qu'à la fin de ce groupe, donc lancer la lecture immédiatement mène la tête au bout du tampon au
moment exact où la suite arrive — la lecture attend 600 ms avant de partir (`PRIME_DELAY_MS`).
Et Chrome **met en pause une vidéo muette en arrière-plan** (« video-only background media was
paused to save power »), sans la relancer : `CameraVideo` relance au retour au premier plan et après
toute pause non demandée. Relevé dans le volet de preview de Claude Code, dont la page se déclare
`hidden` même affichée — la lecture continue n'y est donc pas vérifiable au delà de quelques
secondes ; elle l'a été avant que le volet ne passe en arrière-plan (14 s continues, `readyState` 4).

**Fin de session vérifiée** : quitter la vue Maison ou recharger la page ferme le WebSocket, le
relais attend 8 s puis `onIdle` → `StopRtspStream`, journal « rtsp stream closed · no viewer left »,
zéro processus ffmpeg. Un arrêt BRUTAL du serveur pendant une lecture (redémarrage `tsx watch` en
développement, `kill -9`) laisse en revanche un ffmpeg orphelin : il ne meurt pas de son tube cassé,
mais s'arrête de lui-même quand Google ferme la session RTSP faute de prolongation, soit **au plus
cinq minutes** ; `taskkill /IM ffmpeg.exe` pour ne pas attendre.
Autre chemin de fuite, bouché après l'avoir vu : un écran qui se connecte puis repart AVANT que
Google ait ouvert la session (quelques secondes) laissait un relais sans abonné, donc sans minuteur
d'inactivité. Le relais arme désormais ce minuteur dès son démarrage : sans abonné dans le délai de
grâce, il se signale inutile et la session est fermée. Le piège rencontré en route — la vue Maison gardée en vie qui
ne démonte jamais le composant vidéo — est dans `../6_faq/6_1_pieges-runtime.md`.

Tests : `fmp4.test.ts` (découpage sur des frontières arbitraires, taille 64 bits, chaîne `codecs`),
`rtsp-relay.test.ts` (faux ffmpeg : arguments, entête puis fragments, abonné tardif, délai de grâce
et `onIdle`, sortie de ffmpeg, codecs inconnus). Le parcours complet a été vérifié à la main sur la
sonnette, pas en test.

### Mise à jour 2026-09-09 — vue Caméras : vignettes, budget de sessions, rotation

Demande : voir toutes les caméras d'un coup sur la vue Caméras, « une image toutes les 10 s »,
avec les boutons arrêter / son de la carte détail.

**Ce que l'API impose.** Il n'y a **pas d'instantané à la demande** chez Google pour ces caméras
(`CameraEventImage.GenerateImage` exige un événement). Une image doit donc sortir du flux RTSP
lui-même, et ce qui coûte n'est pas la cadence des images mais le **nombre de sessions ouvertes** :
une session Google, un ffmpeg, 1 à 2 Mbit/s par caméra, et 4 à 8 s avant la première image. Une
rotation stricte (une caméra à la fois) ne donnerait qu'une image par minute avec dix caméras ;
« 10 s pour toutes les caméras » veut dire **toutes les sessions ouvertes** tant que la vue est affichée.

**Réglages** (`5_setup/5_1_configuration-env.md`) : `NEST_LIVE_BUDGET` (défaut 10) borne les sessions
simultanées, directs regardés compris ; `NEST_SNAPSHOT_MS` (défaut 10 s) est la cadence de la vignette
de chaque session ouverte. En dessous du nombre de caméras, les vignettes **tournent** : la caméra
tenue depuis le plus longtemps (`GRID_DWELL_MS`, 20 s) cède sa place à celle dont la vignette est la
plus vieille (ou, sans vignette, qui a rendu sa place depuis le plus longtemps).
Les caméras qui ont déjà donné une image passent **avant** les réessais de caméras en échec : avec
une ouverture toutes les 8 s, six caméras éteintes dont le délai expire en même temps feraient
sinon attendre plus d'une minute la seule qui marche — vu sur la vue (« il y a 82 s » sur une
caméra active).

**Mécanique.** La vue se signale toutes les 5 s (`GET /api/plugins/nest/cameras/snapshots?watch=1`) ;
15 s sans signal et les sessions de vignettes se ferment (le plugin y regarde toutes les 8 s). Chaque relais reçoit une seconde sortie
ffmpeg — la seule qui **décode** (quelques pourcents de CPU par session, quel que soit l'intervalle) —
qui réécrit en place un JPEG de 480 px (`-update 1 -atomic_writing 1`, et **`-y`** : sans lui ffmpeg
refuse un fichier déjà là et sort, ce qui a tué les deuxièmes sessions au premier essai) dans
`<tmp>/kasbah-nest-snapshots/<id>.jpg`. La vue tient une session par un abonné muet (« prise »)
sur le relais ; `GET …/cameras/<id>/snapshot.jpg` sert le fichier, `…/cameras/snapshots` les dates
(mtime) et l'état `live` / `inactive` / `paused`. Côté web, `CameraVideo` en mode tuile (`autoplay=false`)
offre trois états — **Arrêté** (`PUT …/cameras/<id>/snapshots { enabled:false }`, la caméra sort de la
rotation jusqu'à `enabled:true`, retenu en mémoire), **Aperçu** (l'image et son âge), **Direct** (la
vidéo) — dans une barre segmentée, avec un badge d'état ; `CamerasView` sonde les dates.

**Trois directs au plus.** Un direct passe par `openStream` **sans** consulter le budget (seule la
rotation des vignettes le respecte) : neuf directs, ce sont neuf sessions Google épinglées et neuf
ffmpeg, et l'ouverture en rafale tape le quota. `CamerasView` plafonne donc à `LIVE_MAX` (3) le
nombre de directs simultanés, en grisant le bouton Direct des autres tuiles au-delà.

**Compteur « actives », et pourquoi pas « en ligne ».** Les caméras du parc n'exposent **aucun trait
`Connectivity`** (seul le thermostat l'a, à `ONLINE`) : `isAvailable` les met donc toutes disponibles,
et l'API cloud ne permet pas de savoir qu'une caméra est débranchée. Le **seul** signal, c'est l'essai
du flux — image = elle marche, 404 = éteinte (`inactive`). L'en-tête de la vue Caméras affiche donc
« X actives sur N » où *active* = caméra **pas** connue `inactive` (`CamerasView.activeCount`, à partir
des vignettes sondées) ; une caméra éteinte n'y tombe qu'**après** un passage de la
rotation qui échoue. On n'affiche pas de compteur « en ligne » séparé : sans connectivité côté API il
vaudrait toujours le total (ce qui donnait le trompeur « tout en ligne »). Pas dans le header non
plus : le sonder en continu épuiserait le quota.

**Ce que le parc réel a appris, le jour même.**

- **Caméras éteintes** : Google rend une URL RTSP pour une caméra éteinte ou en veille, et son
  serveur répond **404** ; ffmpeg sort aussitôt. Sans garde-fou la rotation la redemandait toutes
  les 5 s. D'où un **recul par caméra** (3 min, doublé à chaque échec, plafonné à 15 min) et l'état
  `inactive` remonté à la vue (« Caméra inactive : pas de flux »). Une seule caméra était active à
  cette heure, et c'est ce qui l'a révélé. Une session dont le flux n'a jamais
  démarré n'est pas rendue par `StopRtspStream` (une commande de moins dans le quota) : elle expire
  seule au bout de cinq minutes.
- **Sessions zombies** : quand ffmpeg sortait de lui-même, le relais s'arrêtait mais la session
  restait dans la table, comptée dans le budget et jamais rendue à Google (`StopRtspStream` jamais
  appelé). `RtspRelay` gagne `onEnded`, et le plugin ferme la session dessus.
- **Quota Google** : neuf ouvertures d'un coup puis les retentatives ont valu « Rate limited » sur
  `ExecuteDeviceCommand`, `GenerateCameraLiveStream` **et `ListDevices`** — le plugin ne pouvait
  plus lister ses appareils. Trois parades : **une ouverture toutes les 8 s** (dix caméras en
  80 s, puis plus rien que les prolongations), une **pause globale de 90 s** dès que Google se
  plaint, et une découverte qui **n'est plus fatale** au
  démarrage (liste vide, `health` en erreur, le sondage réessaie et publie l'inventaire dès qu'il
  passe — avant, un quota épuisé au démarrage condamnait le plugin jusqu'au redémarrage).
- **Jetons dans les journaux** : ffmpeg recopie l'URL `rtsps://…?auth=<jeton>` dans ses messages
  d'erreur ; le relais l'efface (`redactStreamUrl`) avant de journaliser ou de la transmettre.
- **Redémarrage du serveur** (ajout le même jour) : le dossier des vignettes survit au serveur, pas la
  mémoire des échecs. Au redémarrage, les caméras éteintes (aucune vignette, donc « les plus
  anciennes ») passaient les premières, une par 8 s, quota Google compris ; les caméras actives
  attendaient derrière, en affichant une image « d'il y a 7 min ». L'ordre de la rotation est
  maintenant par rangs : caméras **ayant une vignette et pas encore rendues** (exécution précédente,
  ou session morte — on sait qu'elles diffusent), puis jamais essayées, puis rendues par la rotation
  (plus vieille image en tête), puis en échec. Test : « after a restart, a camera that gave an image
  last time is reopened before the others ». Voir aussi la FAQ 6_1 « Vignettes figées plusieurs
  minutes après un redémarrage ».

Tests : `rtsp-relay.test.ts` (`-y`, sortie vignette, redaction), `plugin.test.ts` avec un faux
ffmpeg injecté (`spawnImpl`) : ouverture dans le budget une par tick, fermeture 15 s après le
dernier signal, rotation avec budget 1, recul d'une caméra dont le flux meurt avant sa première image,
arrêt / reprise d'une vignette depuis la tuile.

### Contradiction détectée 2026-09-09 — la prolongation ne maintient PAS la connexion RTSP

Écrit plus haut le même jour : « `ExtendRtspStream` : l'URL ne change pas, la session continue ».
**Faux**, constaté sur deux caméras avec le moniteur de la vue Caméras : session
ouverte avec `expiresAt` à +4 min 56 s, prolongation à 4 min sans erreur, vignettes fraîches
jusqu'à +5 min puis figées, ffmpeg en **fin de flux (code 0) à +6 min 2 s**. Google coupe la
connexion RTSP à l'échéance INITIALE, prolongée ou pas ; `ExtendRtspStream` rend un nouveau
`streamToken` qui sert à **rouvrir** la connexion sur l'URL portant `?auth=<nouveau jeton>`
(`rtspUrlWithToken`). C'est ce qui produisait les « il y a 82 s » sur la vue Caméras : la session
mourait à 5 min, était fermée, puis rouverte par la rotation derrière les réessais des caméras
éteintes.

Correction : `RtspRelay.rotateSource(url)` lance un second ffmpeg sur la nouvelle URL une minute
avant l'échéance ; dès qu'il livre son entête et un premier fragment, il devient la source, les
abonnés reçoivent une **nouvelle entête** et l'ancien ffmpeg est arrêté — sans trou dans les
vignettes, et sans coupure pour un direct : `CameraVideo` décale les horodatages de la nouvelle
source (`SourceBuffer.timestampOffset` = fin du tampon) avant de l'ajouter, sinon la lecture
reculerait à zéro et resterait bloquée. Si la relève échoue, l'ancienne source va jusqu'à son terme
et le plugin rouvre la session comme avant. Tests : `rtsp-relay.test.ts` (« rotateSource »),
`plugin.test.ts` (prolongation à 4 min → second ffmpeg sur `auth=<nouveau>`).

### Observation 2026-09-09 — activer/désactiver et multi-live : l'appli Google Home y arrive, par une API privée

L'utilisateur a comparé avec l'appli **web** Google Home (`home.google.com`) : elle **active/désactive**
chaque caméra (voire toutes d'un coup) et **affiche tous les flux en direct** en même temps. Deux
fonctions qu'on a écartées faute d'API. Vérification faite, ce n'est pas la même API que la nôtre.

**Ce n'est pas SDM.** Dans la console Device Access, les traits « Caméra » exposés sont
`CameraEventImage`, `CameraGarageDoor`, `CameraImage`, `CameraLiveStream`, `CameraMotion`,
`CameraPerson`, `CameraSound`, `Info` — **aucun trait ni commande d'allumage/extinction**. Les seules
commandes caméra publiques sont `CameraLiveStream.{GenerateRtspStream,GenerateWebRtcStream,ExtendRtspStream,StopRtspStream}`
et `CameraEventImage.GenerateImage`. Le réglage « caméra activée » de l'appli Home n'a donc **aucun
équivalent public**. Notre conclusion (`camera` sans `on_off`) tient : la commande n'existe pas dans
l'API publique, on ne l'a pas juste « ratée ».

**Ce que fait l'appli Home, relevé dans l'onglet réseau du navigateur** :
- des appels `UpdateTraits` et `SendCameraViewIntent` sur `home.google.com` (Home Graph **interne**),
  pas sur `smartdevicemanagement.googleapis.com` ;
- un WebSocket **`nexustalk`** (handshake HTTP 101) — le protocole de streaming **propriétaire** de Nest.

Autrement dit, une **API privée première partie** : hôte différent, **auth de session Google** (le
compte connecté dans le navigateur) et non notre jeton OAuth de partenaire Device Access, endpoints
non documentés. `UpdateTraits` mute un trait interne « activée » que SDM n'expose pas ; `nexustalk`
ne passe pas par `ExecuteDeviceCommand`, donc il échappe à la limite (~10 cmd/min) et à l'expiration
de 5 min qui nous imposent budget et rotation — d'où le multi-live fluide côté Google.

**Pourquoi eux et pas nous** : c'est Google qui se parle à lui-même sur son propre backend. Les
partenaires n'ont droit qu'au sous-ensemble publié dans SDM, volontairement plus pauvre.

**Piste pour plus tard (demande de l'utilisateur : l'activation/désactivation serait vraiment utile).**
Reproduire ces fonctions supposerait un **connecteur « Nest non officiel »**, séparé du plugin SDM, qui
rejoue le protocole `nexustalk` et les endpoints internes en s'authentifiant avec les **identifiants
Google de l'utilisateur** (cookies / master token), comme le font des projets tiers (`homebridge-nest`
et apparentés). À assumer comme tel :
- **hors conditions d'utilisation** de Google (rétro-ingénierie d'API privée) ;
- **fragile** : ces endpoints changent sans préavis, ça casse régulièrement ;
- **auth différente et plus sensible** (jeton maître du compte plutôt qu'un jeton partenaire révocable
  et cadré).

Décision du jour : on **note** la piste, on ne l'implémente pas. Si on la fait un jour, ce sera un
second plugin isolé (ex. `nest-unofficial`), avec au minimum l'allumage/extinction, jamais mélangé au
plugin SDM officiel. Le reste (vidéo RTSP relayée, vignettes, thermostat) reste sur SDM.

### Mise à jour 2026-09-09 — phase 3 : récepteur d'événements Pub/Sub (la sonnette d'abord)

L'API SDM ne pousse rien : les événements (sonnerie, mouvement, personne, son) passent par **Pub/Sub**.
Côté serveur, c'est en place, limité à la **sonnette** pour commencer.

**Réglages** (`config/env.ts` du plugin) : `NEST_PUBSUB_SUBSCRIPTION` (nom complet d'un abonnement
**pull**, vide = rien) et `NEST_PUBSUB_POLL_MS` (5 s par défaut).

**Mécanique** : à `start()`, si un abonnement est configuré et le compte lié, un `createPoller`
(`nest-events`) appelle `subscriptions:pull` (`NestClient.pullEvents`, hôte `pubsub.googleapis.com`,
**même jeton OAuth** que SDM, portée `pubsub`, `returnImmediately` pour ne PAS retenir la requête sur un
abonnement vide — sinon un TIMEOUT en boucle), décode chaque message (`parseSdmEvent`, pur :
base64 → JSON → `resourceUpdate.name`/`events`), et pour un `DoorbellChime.Chime` sur un appareil connu
appelle `ctx.emitEvent(externalId, 'chime')` → message `deviceEvent` aux clients (voir
`../1_architecture/1_3_protocole-rest-ws.md`). Puis `subscriptions:acknowledge` de **tous** les
messages tirés (même ceux ignorés), sinon Google les redonne en boucle. Mouvement/personne/son sont
décodés mais **pas encore poussés** (ils spammeraient un client qui n'en fait rien) : un seul `if` à
ouvrir plus tard. Tirage court toutes les 5 s : une sonnerie arrive avec au plus ~5 s de retard, sans
maintenir de connexion longue.

**Réaction côté web (fait le même jour)** : le store `devices` relaie `deviceEvent` à qui s'abonne
(`onDeviceEvent`, il ne cadre ni ne route — affaire de la vue). `HomeView` s'abonne : sur un `chime`,
il ramène sur la vue Maison (`router.push({name:'home'})`), résout la sonnette (`house.houseDeviceFor`),
la sélectionne (`house.selectDevice`) et ouvre le panneau. Les watchers existants cadrent alors sa
pièce et la carte détail lance son **direct** (la sonnette est une caméra RTSP,
`CameraVideo` en autoplay). La sonnette passe devant sans toucher au plafond des 3 directs (le plafond
ne vaut que pour la vue Caméras). Vérifié bout en bout : un `chime` déclenché depuis la vue Caméras
ramène sur la maison, cadre le Sas et joue le direct (1152×864) dans le panneau. Mouvement/personne :
rien côté web pour l'instant (le serveur ne les pousse pas).

**Prérequis Google (à faire par l'utilisateur, une fois)** — l'appli web Google Home le fait par une
API privée (voir « Observation » plus haut), nous par Pub/Sub public :
1. Projet **Google Cloud** (celui du client OAuth) avec **facturation active** — Pub/Sub l'exige ;
   le volume d'un foyer (petits JSON) reste dans le quota gratuit (10 Gio/mois), donc ~ **0 €**. La
   mention « les coûts varient selon la configuration » couvre les gros usages.
2. API **Cloud Pub/Sub** activée ; créer un **sujet** (ex. `projects/<projet-cloud>/topics/nest-events`)
   — l'option « Ajouter un abonnement par défaut » crée du même coup un abonnement **pull**
   `nest-events-sub` (rétention 7 j, ack 10 s, expire après 31 j d'inactivité : sans effet, on tire en
   continu). C'est celui qu'on veut.
3. Donner le droit **Pub/Sub Publisher** sur le sujet au **groupe** `sdm-publisher@googlegroups.com`
   (doc Google, `subscribe-to-events`) : en Cloud Shell
   `gcloud pubsub topics add-iam-policy-binding projects/<projet-cloud>/topics/nest-events --member="group:sdm-publisher@googlegroups.com" --role="roles/pubsub.publisher"`,
   ou console Pub/Sub → sujet → Autorisations → Ajouter un compte principal. Puis saisir le sujet dans
   la console Device Access et **Ajouter et valider** (elle publie un événement test).
4. Refaire la **liaison OAuth** de Kasbah pour accepter la portée `pubsub` (déjà dans `OAUTH_SCOPES`).
5. `NEST_PUBSUB_SUBSCRIPTION=projects/<projet-cloud>/subscriptions/nest-events-sub`.

Piège rappelé : `projects/{project}/…` attend l'**ID du projet Cloud**, pas l'UUID Device Access.

Tests : `plugin.test.ts` (faux Pub/Sub) — une sonnerie sur la sonnette est poussée (`emitEvent('…','chime')`)
et acquittée ; un mouvement et un appareil inconnu sont acquittés mais **pas** poussés.
