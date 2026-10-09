# Plugin Somfy TaHoma

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/tahoma/{index,client,mapping,types}.ts`, tests `mapping.test.ts`,, `history.ts`, `solar.test.ts` (volets solaires, 2026-09-24)
> `plugin.test.ts`, fixtures `__fixtures__/box.ts`, `apps/server/.env.example`,
> [Somfy-Developer/Somfy-TaHoma-Developer-Mode](https://github.com/Somfy-Developer/Somfy-TaHoma-Developer-Mode)
> et son `docs/openapi.yaml`, relevés sur une TaHoma Switch

Plugin de la plateforme **Overkiz** (qui équipe les box TaHoma), en **API locale** : aucun appel
cloud au fonctionnement. Kind exposé : `cover` uniquement (volets, stores, portails, fenêtres,
portes de garage). Le reste du parc de la box — capteurs de luminosité, lecteurs audio, chauffage,
passerelles — est ignoré et journalisé en `debug`.

*(Dépassé le 2026-09-24 : le plugin publie aussi un `sensor` de luminosité pour les capteurs `LightSensor` des volets solaires (`apps/server/src/plugins/tahoma/mapping.ts`, état `core:LuminanceState`) — voir la mise à jour du 2026-09-24 plus bas. « `cover` uniquement » ne vaut plus ; les lecteurs audio, le chauffage et les passerelles restent ignorés.)*

## Mise en route : uniquement depuis l'appli mobile

Le **mode développeur** est un drapeau que le cloud Somfy pousse sur la box. Il ne s'active donc
**ni depuis un site web, ni depuis le réseau local** : avant qu'il soit posé, le port 8443 de la box
est fermé et il n'existe aucun endpoint pour l'ouvrir. La marche à suivre (appli « TaHoma by
Somfy ») :

1. « Configurer l'installation » → « Accéder aux paramètres » de la box → **sept appuis sur le code
   PIN** de la passerelle (format `2001-0001-1891`).
2. **Resynchroniser la box** : l'API locale n'est réellement servie qu'après.
3. Menu « Mode développeur » → générer un jeton. Il n'est **affichable qu'à la création**.
4. Coller le jeton dans `TAHOMA_TOKEN` (voir `../5_setup/5_1_configuration-env.md`).

Diagnostic disponible sans jeton : `GET /apiVersion` est le **seul endpoint qui n'exige pas
d'autorisation**. `init()` le sonde systématiquement, ce qui permet à `health()` de distinguer trois
états au lieu d'un seul :

| `health()` | Signification |
|---|---|
| `error` — « no local API on … » | Box injoignable, ou mode développeur pas activé |
| `needs_pairing` — « developer mode is on » | API locale servie, `TAHOMA_TOKEN` manquant |
| `error` — « token rejected (…) » | Jeton refusé par la box (voir ci-dessous) |

Un jeton généré peut **ne jamais être enregistré** par la box : la réponse est alors
`{"errorCode":"RESOURCE_ACCESS_DENIED","error":"Not authenticated."}`, exactement comme pour une
valeur inventée. Le remède est d'en régénérer un. Repère utile : **sans** en-tête `Authorization` la
box répond « Missing authorization token. », donc ce message accuse *notre* code, alors que « Not
authenticated. » accuse le jeton. C'est pourquoi `client.ts` recopie le message de la box dans
l'erreur (il ne contient jamais le jeton).

## API locale

Base : `https://gateway-<PIN>.local:8443/enduser-mobile-web/1/enduserAPI`, en-tête
`Authorization: Bearer <jeton>` — « Bearer » **sensible à la casse**, c'est la seule forme acceptée
(sept variantes testées contre la box).

Le certificat est signé par l'AC Overkiz pour le nom `gateway-<PIN>.local` : joindre la box par son
IP échoue la vérification TLS, d'où un **Agent undici dédié** (`TAHOMA_TLS_INSECURE`, vrai par
défaut) — jamais un réglage global, même choix que le pont Hue. Le nom `.local` est résolu par l'OS
quand le mDNS passe, et il correspond au certificat.

Endpoints utilisés : `apiVersion`, `setup`, `events/register`, `events/{id}/fetch`,
`events/{id}/unregister`, `exec/apply`. **Il n'y a pas de flux poussé** : on enregistre un écouteur
puis on le sonde (`TAHOMA_POLL_MS`, 2 s par défaut). Quand la box a oublié l'écouteur,
`fetchEvents` rend `null` et le tick suivant en réenregistre un **puis resynchronise** (on était
aveugle entre-temps).

L'API locale n'expose **pas les scénarios** de la box : le plugin n'implémente donc pas
`recallScene` (les « Ambiances » de l'UI restent celles de Hue).

## io-homecontrol et RTS, distingués par ce que la box déclare

Le parc Somfy mélange deux radios, et c'est la seule difficulté conceptuelle du plugin :

| | io-homecontrol | RTS |
|---|---|---|
| Sens | bidirectionnel | **unidirectionnel** |
| Retour d'état | 12 à 14 états live | **aucun** (tableau `states` vide) |
| Commandes | `open`/`close`/`stop`, `setClosure`, `my`… | `up`/`down`/`stop`/`my` seulement |
| Position | réelle | **inconnue**, puis déduite de la dernière commande (voir ci-dessous) |

Le plugin **n'énumère aucun `controllableName`** : il lit les commandes déclarées par la box, donc un
modèle inconnu fonctionne sans toucher au code. `mapping.ts` résout :

- ouvrir = premier présent de `open`, `up`, `undeploy` ;
- fermer = premier présent de `close`, `down`, `deploy` — **déployé = fermé** pour un store banne ou
  un écran, ce qui est cohérent avec l'inversion ci-dessous ;
- position = `setClosure` ou `setDeployment` ; inclinaison = `setOrientation` ; arrêt = `stop` ;
- position favorite = `my`, sans paramètre (voir la section dédiée plus bas).

Un ouvrant retenu doit avoir une `uiClass` de la liste blanche (`COVER_UI_CLASSES`) **et** au moins
ouvrir et fermer, sinon il est ignoré.

**Deux conventions inverses à ne pas confondre** : Overkiz mesure une FERMETURE (`core:ClosureState`,
`core:DeploymentState` : 0 = ouvert / rentré, 100 = fermé / déployé), Kasbah mesure une OUVERTURE
(`position` : 0 = fermé, 100 = ouvert). D'où le `100 - v` systématique dans les deux sens, et un
paramètre de `setClosure` égal à `100 - position`.

Capacités déclarées (voir `../1_architecture/1_1_contrat-appareils.md`) : `open_close` toujours,
`position` **seulement si la box sait viser une position**, puis `tilt`, `stop`, `preset` et
`preset_set` selon les commandes. Un RTS n'annonce donc pas `position` : l'UI n'affiche pas de
curseur, et `execute` pose
la position déduite (100 après « ouvrir », 0 après « fermer ») plutôt que d'inventer une course.

### Ce qu'un RTS ne dira jamais : la position avant la première commande (2026-09-08)

Un RTS ne renvoie rien, donc au démarrage du serveur le plugin **n'a aucune position** à émettre pour
lui — ni au `/setup`, ni par les événements. `toCoverPatch` rend un patch vide, et c'est correct : la
`position` du contrat est optionnelle et son absence signifie « inconnue »
(`../1_architecture/1_1_contrat-appareils.md`). L'interface affiche alors « Inconnu » et laisse ces
ouvrants hors des compteurs du résumé, au lieu d'annoncer « Baissé » pour deux stores en réalité
remontés — ce qu'elle faisait tant que `defaultState` posait un zéro
(`../6_faq/6_1_pieges-runtime.md`).

La position n'apparaît qu'**après une commande passée par Kasbah** : `execute()` pose alors
`assumedPosition(command)` (100 après « ouvrir », 0 après « fermer ») pour les seuls appareils sans
retour. Cette valeur reste une déduction, et elle redevient fausse dès qu'on touche la télécommande
murale ; Kasbah ne peut pas le savoir, et ne le prétend pas. Un redémarrage du serveur la reperd :
c'était le choix assumé face à une persistance sur disque, qui aurait menti aussi longtemps sans
jamais l'avouer.

Les volets io ne sont pas concernés : ils publient `core:ClosureState` au `/setup` comme en cours
de route.

## Six pièges relevés contre la vraie box

Chacun est verrouillé par une fixture ou une assertion — les fixtures sont des **relevés**, pas des
extrapolations de la spec du fabricant, et c'est précisément ce qui manquait au premier jet.

1. **`definition.states` n'est pas une source fiable** : vide pour tous les appareils relevés le
   2026-09-08, rempli pour les volets solaires et leurs capteurs le 2026-09-24 (voir l'arbitrage en
   bas de page). Les états exploitables sont dans le tableau `states` de l'appareil. Un `hasPositionFeedback()` qui lit la définition classe donc *tous* les appareils en
   unidirectionnels, y compris des moteurs io qui remontent une position réelle. Les 19 tests
   unitaires passaient : seul le matériel l'a montré.
2. **`core:CommandLockLevelsState` a une valeur TABLEAU.** Une union `string|number|boolean|null` sur
   `value` fait échouer le parse de **tout** `/setup` à cause d'un état qu'on ne lit même pas. D'où
   `z.unknown()` et un filtrage à la lecture (`pct()`, `bool()`).
3. **La box envoie des deltas d'UNE SEULE CLÉ par trame.** Sur une fermeture :
   `core:TargetClosureState` arrive seul, puis `core:MovingState=true` arrive dans sa propre trame, et
   **aucune position n'est émise pendant la course**. Une trame traitée isolément ne donne donc jamais
   de sens de déplacement : le plugin garde un état **fusionné** par appareil (semé par `/setup`, mis
   à jour trame par trame) et calcule `motion` dessus. Sans cette accumulation, `motion` reste
   éternellement `stopped`.
4. **Le `/setup` local ne renvoie que `devices` et `gateways`** — pas d'arbre de pièces, et aucun
   appareil ne porte de `placeOID` (constat sur tous les relevés). Un appareil TaHoma n'a donc **jamais**
   `meta.room`, et l'auto-placement par nom de pièce ne peut pas s'appliquer : le rattachement passe
   par `house.json` et le mode « Emplacement ».
5. **Un `deviceURL` porte souvent un index de sous-appareil** (`io://1234-5678-9012/12345678#1`). Un `externalId` Kasbah servant de segment d'URL, la transformation
   neutralise `://`, `/` **et** `#` → `io.1234-5678-9012.12345678.1`.
6. **Aucune requête n'avait de délai propre.** Une commande s'est bloquée plus de 10 s une fois
   (garde-fou `KASBAH_COMMAND_TIMEOUT_MS` de l'hôte, HTTP 504, aucun log), sans être reproductible —
   un banc de mesure donne `exec/apply` à 54 ms en pleine course et `events/fetch` à 188 ms de
   moyenne. La cause reste inconnue, mais le défaut d'undici étant de **300 s**, une requête coincée
   gèlerait le sondage d'événements pour de bon, `health()` restant au vert. Chaque requête porte
   désormais son `AbortSignal.timeout` (`REQUEST_TIMEOUT_MS`, 8 s, injectable en test), mappé sur
   `PluginError('TIMEOUT')`.

## Robustesse

- **Validation appareil par appareil** dans `getSetup` (même choix que le pont Hue) : un seul
  appareil à la forme inattendue ne doit pas priver la maison des autres.
- `DeviceCreatedEvent` / `DeviceRemovedEvent` programment une resynchronisation complète, donc
  appairer un volet chez Somfy ne demande pas de redémarrer le serveur.
- Les événements d'exécution sont ignorés : un `stop` en pleine course produit un
  `ExecutionStateChangedEvent … FAILED / CMDCANCELLED` **normal** (l'exécution précédente est
  annulée), qu'il ne faut pas remonter comme une erreur.

## Ce qui n'est pas couvert

- **Inclinaison des lames** (`core:SlateOrientationState`, `setOrientation`) : le code existe mais
  aucun appareil du parc de test ne la déclare, donc le sens de la valeur n'est **pas vérifié**.
- **Portails à commande unique `cycle`** : ignorés (ils n'ont ni `open` ni `close`). Le portail RTS
  du parc de test déclare bien `open`/`close`/`stop`.
- **Pas de position pendant la course** : la box ne la publie qu'à la fin du mouvement. L'UI affiche
  donc un `motion` juste et une position figée pendant les ~20 s de descente, puis un saut à la
  valeur finale. C'est le matériel, représenté honnêtement plutôt qu'interpolé.
- Découverte réseau : `TAHOMA_HOST` est obligatoire. Le mDNS annonce `_kizbox._tcp` en permanence et
  `_kizboxdev._tcp` **seulement** quand le mode développeur est actif — utile au diagnostic, pas
  encore implémenté côté plugin.

## Vérification contre du vrai matériel

Recette employée, sans jamais toucher au serveur de développement de l'utilisateur (qui tient la
vraie maison et l'écrit). **Périmée depuis que les plugins actifs viennent du fichier de maison** :
`KASBAH_PLUGINS` ne limite plus rien et cette commande démarre TOUT le parc réel — voir la recette
de remplacement en bas de page (mise à jour du 2026-09-24).


```
cd apps/server && KASBAH_PORT=8788 KASBAH_PLUGINS=tahoma TAHOMA_POLL_MS=1000 npx tsx src/main.ts
curl http://127.0.0.1:8788/api/health          # statut du plugin et nombre d'appareils
curl http://127.0.0.1:8788/api/devices         # descripteurs et états
```

Résultat sur le parc de test : des volets roulants io (`io:DynamicRollerShutter…`,
`io:RollerShutterWithLowSpeedManagement…`, `io:RollerShutterGeneric…`), des stores bannes
`rts:HorizontalAwningRTSComponent`, un portail `rts:GateOpenerRTSComponent`. Les io annoncent
`open_close, position, stop`, les RTS `open_close, stop`.

Mouvement réel validé de bout en bout : `cover.close`, puis `cover.stop` **en pleine course**
(arrêt effectif à mi-hauteur), puis `cover.set_position 100` — `motion` passe bien `closing`,
`stopped`, `opening`, `stopped`, et l'ouvrant revient à son état de départ.

## Position favorite (« my ») : ce que la box en dit vraiment

Relevé sur les ouvrants du parc de test, et c'est ce relevé qui a dicté le modèle :

| | Commande `my` | `core:Memorized1PositionState` |
|---|---|---|
| volets roulants io | oui | **oui** |
| stores bannes RTS | oui | non |
| portail RTS | **non** | non |

D'où **plus de rappels possibles que de valeurs affichables**, et la séparation entre la capacité
`preset` et l'état `presetPosition` (voir `../1_architecture/1_1_contrat-appareils.md`). Le portail
ne déclarant pas `my`, il n'a pas de bouton du tout : le plugin n'énumère aucun modèle, il lit les
commandes déclarées.

La valeur mémorisée est une **FERMETURE**, de la même famille que `core:ClosureState`, d'où le
`100 - v` habituel. Deux indices concordants : les valeurs relevées (des fermetures élevées = un ouvrant
majoritairement baissé, ce qu'est une position de mi-ombre) et un volet qui n'était pas
fermé, arrêté exactement sur sa valeur mémorisée (fermeture et mémoire égales). Un appui sur le bouton
suffit à le reconfirmer : la fermeture atteinte doit égaler la valeur affichée.

**Rappeler `my` sur un appareil sans retour EFFACE sa position.** Le moteur part vers une position
que la box ne nomme pas ; garder la position déduite du dernier ouvrir/fermer afficherait « Baissé »
pour un store parti ailleurs — le défaut même corrigé plus haut. `execute()` émet donc
`{ position: null }` pour ces appareils, ce qui est l'usage qui a motivé l'effacement par patch.

Non implémenté, mais disponible : `setMemorized1Position` existe sur les volets io, donc Kasbah
pourrait aussi **reprogrammer** la position favorite. `refreshMemorized1Position` la fait republier.

*(Dépassé le 2026-09-09 : c'est fait, capacité `preset_set` — voir la section « Reprogrammer la position favorite (2026-09-09) » juste en dessous.)*

### Reprogrammer la position favorite (2026-09-09)

`setMemorized1Position` est déclarée par les **volets io** et par aucun RTS, exactement comme
`core:Memorized1PositionState` — d'où la capacité `preset_set` séparée de `preset`. Sa signature
relevée dans `/setup` est `{"nparams":1,"paramsSig":"p1"}`, identique à celle de `setClosure` : le
paramètre est donc une **FERMETURE**, et `toAction` envoie `100 - position` comme pour viser une
position. `refreshMemorized1Position` (mêmes appareils, sans paramètre) force la box à republier
la valeur ; elle n'est pas utilisée, la box étant censée émettre le changement d'état d'elle-même.

**Non vérifié contre le matériel** : le chemin d'écriture n'a été exercé que contre la simulation.
Écrire une position favorite modifie un réglage réel de la maison — et le bouton
« my » des télécommandes murales avec — donc rien n'a été envoyé à la vraie box. Reste à
confirmer sur le matériel : que la box accepte le paramètre en fermeture, et **qu'elle republie
`core:Memorized1PositionState`** après l'écriture. Si elle ne le fait pas, l'interface n'afficherait
la nouvelle valeur qu'après une resynchronisation, et il faudrait enchaîner
`refreshMemorized1Position`. Recette sans effet de bord : réécrire la valeur ACTUELLE d'un volet
(par exemple mémoriser 73 alors que la mémoire vaut déjà 73) exerce tout le chemin sans rien
changer.

### Mise à jour 2026-09-12 — un ARRÊT efface la position supposée d'un RTS

Une radio unidirectionnelle ne dit jamais où elle en est : le plugin **déduit** la position des
commandes de pleine course (`up` → 100, `down` → 0, `assumedPosition`). Le rappel `my` effaçait déjà
cette déduction devenue fausse (`{ position: null }`), mais `cover.stop` se contentait de publier
`motion: 'stopped'` — **la position supposée survivait à l'arrêt**. Relevé sur l'installation réelle :
un store banne physiquement déployé à moitié, annoncé « Baissé » à 100 %.

`execute` traite désormais `cover.stop` comme `cover.preset` sur un appareil sans retour : la position
est **effacée**. Conséquence assumée — arrêter un ouvrant déjà immobile efface une position juste ;
c'est le prix pour ne jamais affirmer une fin de course qu'on n'a pas vue. Un io positionnable
(`entry.feedback`) n'est pas concerné : il publie sa vraie position.

Côté interface, un ouvrant sans capacité `position` n'affiche plus **aucun** pourcentage, seulement le
mot (`../4_ui/4_1_navigation-et-panneaux.md`).

**Position favorite, ce que le parc réel montre.** Le portail ne déclare pas `my` : Kasbah n'affiche
donc pas la touche pour lui, et c'est bien ce qu'on voit. Les stores bannes, eux, la déclarent —
la box sait toujours émettre la commande — mais l'appui ne fait rien : aucune position n'est mémorisée
dans ces moteurs. **Rien dans le protocole ne permet de le savoir** (c'est une commande radio sans
accusé), donc la touche reste affichée dès que la box déclare `my` ; une position `my` s'enregistre à
la télécommande murale.

## Mise à jour 2026-09-24 — volets solaires : luminosité, batterie, mode discret

Relevé du `/setup` réel : **une partie des volets io est solaire** (`io:DynamicRollerShutterIOComponent`,
avec `core:BatteryLevelState` et `core:BatteryState`). Trois choses en découlent.

### Le panneau est un capteur de luminosité

Chaque volet solaire est déclaré **deux fois** sur le même nœud radio : le moteur (`…#1`) et son
panneau (`…#2`), `io:SunEnergyActuatorSensor`, uiClass `LightSensor`, **même libellé que le volet** et
aucune commande. États : `core:LuminanceState` (en lux — c'est l'unité que l'appli Somfy affiche),
`core:SunEnergyState` (unité inconnue, non exposé) et `core:StatusState`.

`mapping.ts` en fait un appareil `sensor` (`isLightSensor`, `toLightSensorDescriptor`) :
`meta.sensor = { unit: 'lx', deviceClass: 'illuminance' }`, nom `<libellé> · luminosité` (deux appareils
du même nom se confondraient dans une liste), et **`meta.linkedTo` vers le volet** du même nœud
(`sameNode` : même `deviceURL` hors index `#`). Relevé contre la box : chaque
capteur est lié au bon volet.

### Un historique construit par Kasbah

L'API locale **n'expose aucun historique** : le graphe heure / jour / mois de l'appli vient du cloud
Somfy. `history.ts` (`LightHistory`) tient donc le **maximum** par heure (48 h) et par jour local
(400 jours), le mois se déduisant des jours. Le maximum, pas une moyenne : c'est ce que montre l'appli,
et c'est exact sans échantillonnage, puisque la box n'émet la luminance que quand elle change.

- Une heure **sans trame** (la nuit, un ciel constant) reçoit la dernière valeur connue — seulement si
  CE processus l'a vue pendant tout ce temps (`live.since`). Une heure où le serveur ne tournait pas
  reste **absente**, jamais à zéro.
- Persistance : `TAHOMA_LIGHT_HISTORY_FILE` (défaut `.state/tahoma-light-history.json`), écrite à chaque
  heure ouverte et à l'arrêt. **Les écritures sont sérialisées** : les capteurs ouvrent leur heure
  dans la même passe, et des écritures simultanées se disputaient le même fichier temporaire
  (ENOENT au renommage, relevé contre la box, verrouillé par `solar.test.ts`).
- Lecture : `GET /api/plugins/tahoma/light/:externalId` → `{ hourly, daily, monthly }` (`registerRoutes`).

**Question ouverte** : le 2026-09-24 au matin, par temps couvert, les capteurs sont restés à **0 lx** pendant
plus d'une heure, sans une seule trame `core:LuminanceState` — mais l'appli Somfy n'avait pas non plus de
donnée du jour. Que la box relaie bien la luminance en local reste donc **à confirmer** un jour
ensoleillé (une lecture de `/setup` suffit).

### Batterie

`core:BatteryLevelState` (%) → capacité `battery` et `CoverState.batteryPct`
(`../1_architecture/1_1_contrat-appareils.md`). Déclarée dès que l'état figure au `/setup`.

### Mode discret (vitesse lente)

C'est le « mode discret » de l'appli : `setClosureAndLinearSpeed`, signature relevée `p1,*p2`, déclarée
par les volets solaires et les `RollerShutterWithLowSpeedManagement`, pas par les
génériques. Le second paramètre vaut **`'lowspeed'`**. Vérifié sur un volet, 20 % de course
dans chaque sens : **+34 % de durée à la descente** (9,5 s contre 7,1 s) et **+22 % à la montée**
(10,0 s contre 8,2 s) — la box accepte donc bien le paramètre.

La box ne mémorise **rien** : c'est une option de chaque manœuvre. Le plugin tient donc l'interrupteur
(`cover.set_quiet`, capacité `quiet`, état `CoverState.quiet`, fichier `TAHOMA_QUIET_FILE`, défaut
`.state/tahoma-quiet.json`) et, s'il est allumé, `toAction` fait passer ouvrir (fermeture 0), fermer
(100) et viser une position (`100 - position`) par `setClosureAndLinearSpeed [fermeture, 'lowspeed']`.
L'arrêt et le rappel `my` n'ont pas d'équivalent lent et gardent leur commande. Basculer le mode
n'envoie rien à la box. La télécommande murale, elle, garde sa vitesse normale.

### Arbitrage 2026-09-24 — `definition.states` n'est pas toujours vide

Le piège n° 1 plus haut (et le commentaire de `types.ts`) affirme que l'API locale renvoie
`definition.states` **toujours vide**. Sur la même box, relevé du 2026-09-24 : les volets
`io:DynamicRollerShutterIOComponent` y listent 17 états, et les capteurs `LightSensor` leurs 3 états.
Le raisonnement du piège reste juste pour le code (on lit les états LIVE, qui disent ce que l'appareil
publie vraiment), mais l'affirmation « toujours vide » est fausse au moins pour ces modèles — peut-être
depuis une mise à jour de firmware. **Tranché par l'utilisateur le 2026-09-24** : la formulation du
piège n° 1 est corrigée (« pas une source fiable »), ainsi que les commentaires de
`apps/server/src/plugins/tahoma/{types,mapping}.ts`. Le code, lui, ne change pas.

### Mise à jour 2026-09-24 — recette de vérification : `KASBAH_PLUGINS` ne limite plus rien

La recette de la section « Vérification contre du vrai matériel » (`KASBAH_PLUGINS=tahoma … npx tsx
src/main.ts` sur 8788) **démarre désormais TOUS les plugins** : les plugins actifs viennent du fichier
de maison, pas de cette variable. Relevé le 2026-09-24 (Hue, Nest, Cast… lancés en parallèle du serveur de
développement ; rien n'a été commandé, mais c'est le parc réel). Recette sûre à la place : un script
jetable qui instancie `createTahomaPlugin()` seul avec un faux `PluginContext`, puis `discover()` /
`start()` / `stop()` — les fichiers d'état redirigés vers un dossier temporaire par
`TAHOMA_LIGHT_HISTORY_FILE` et `TAHOMA_QUIET_FILE`.

### Mise à jour 2026-09-24 — une sonde ratée pendant un redémarrage de la box ne colle plus

Le 2026-09-24, la box a **coupé toutes ses connexions** (`ECONNRESET` sur une écoute en
cours) — un redémarrage de la box ou de son API. Le serveur de développement, rechargé autour de ce
moment, affichait ensuite l'invite « activez le mode développeur » (lue comme un réappairage) jusqu'à
un redémarrage manuel, alors que le jeton était bon.

Cause : `localApiUp`, qui décide de ce message dans `health()`, n'était posé QUE par la sonde
`/apiVersion` de `init`. Une sonde tombée pendant le redémarrage le laissait faux pour toute la vie du
processus. Il est désormais posé aussi par toute réponse réussie (`refresh`, chaque passe de
sondage) — verrouillé par `solar.test.ts` (« recovers from a startup probe… »).

Limite qui demeure, côté HÔTE et pour tous les plugins : si `discover()` échoue au démarrage (box
encore injoignable), `plugin-host.ts` laisse le plugin en erreur sans nouvelle tentative ; seul un
redémarrage le relance. **Levée le même jour** : l'hôte retente désormais un démarrage raté
(`../1_architecture/1_2_serveur-et-plugins.md`, mise à jour du 2026-09-24). Relevé : une box qui répond 400 « No registered event listener. » pour un
écouteur inconnu — cas déjà géré (réenregistrement), donc hors de cause.

