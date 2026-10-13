# Automatisations (règles « Quand / Sauf si / Alors »)

> Dernière mise à jour : 2026-10-13
> Sources : `packages/shared/src/automations/{predicate,automation,fields}.ts`, `packages/shared/src/house/{sun,geo}.ts`, `packages/shared/src/devices/activity.ts`, `apps/server/src/core/automations/{engine,schedule,evaluate,context,status,runner,store}.ts`, `apps/server/src/app.ts`, `apps/server/src/http/routes.ts`, `apps/server/src/ws/hub.ts`, `packages/mock-sim/src/behaviours/weather.ts`, `.gitignore`, tests listés en fin de page, arbre de travail NON COMMITÉ du 2026-09-23 (après 0f943a0)

## Ce que c'est, et pourquoi c'est le serveur qui s'en charge

Une automatisation est une règle **plate** : un déclencheur (« Quand »), des bloqueurs (« Sauf si »),
des actions (« Alors »). Exemple type de la maison : « 15 min avant le crépuscule, mais jamais après
22:00, fermer tous les volets roulants — sauf si un lecteur joue au salon ».

Trois choix de fond :

- **Exécutée par le serveur.** L'écran dort, se recharge, perd le Wi-Fi ; le serveur non. Le
  moteur vit dans `apps/server/src/core/automations/`, l'interface ne fait qu'écrire et afficher.
- **Écrite sur le contrat, jamais sur un fabricant.** Un prédicat parle de kinds, de champs d'état, de
  pièces, de places (`packages/shared/src/automations/predicate.ts`) ; aucun plugin n'a rien à
  implémenter pour que ses appareils soient automatisables. Conséquence voulue : un plugin qu'on
  éteint retire ses appareils du registre, la règle passe en santé `incomplete` et **rien n'est
  supprimé** — le plugin revient, la règle redevient `ok`.
- **Pas de `.default()` dans le module.** Le fichier d'automatisations est écrit tel que parsé, et
  zod 4 ne valide pas ses défauts (piège déjà documenté dans `house/schema.ts`). Même raison pour
  `automationPatchSchema`, écrit à la main plutôt qu'en `.partial()`.

### Décisions prises avec l'utilisateur (2026-09-22)

- **Règle plate, pas de graphe à la n8n.** Les exemples réels de la maison y tiennent tous, et
  l'éditeur reste un formulaire faisable au doigt (commentaire d'en-tête de `automation.ts`).
- **Un fichier par maison**, à côté de son `house.json` (voir Persistance).
- **Action « lancer un programme sur le serveur » = liste blanche dans le `.env`**, reportée à
  l'itération 2 (seulement annoncée en commentaire, voir plus bas).
- **Premier périmètre** : le moteur et la vue, avec déclencheurs horaires (heure fixe et soleil) et
  déclencheurs d'état. Ni prévision, ni événement d'appareil, ni webhook dans cette itération.

## Le modèle (`packages/shared/src/automations/`)

### Prédicats (`predicate.ts`)

| Type | Vrai quand | Inconnu (`null`) quand |
|---|---|---|
| `device` | le champ `field` de l'état se compare à `value` (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`) | appareil absent, indisponible, pas encore relevé, champ absent ; ordre demandé sur un booléen ou un mot |
| `deviceOn` | l'appareil est ACTIF (`isDeviceOn`) | idem |
| `vehicleOnSite` | la position est à moins de `HOME_RADIUS_M` (120 m) de `house.origin` | pas de position |
| `vehicleParkedAt` | la règle d'accrochage `assignParkings` range l'engin sur `parkingId` | pas de position, ou place inexistante |
| `anyInRoom` | au moins un appareil de ce kind (et de cette nature, `deviceClass`) est actif dans la pièce | pièce inexistante, ou aucun actif mais au moins un inconnu |
| `timeWindow` | l'heure locale est dans `[from, to[` ; `to` avant `from` = la plage passe minuit | jamais |
| `days` | le jour local est dans la liste (**0 = dimanche**, convention de `Date.getDay()`) | jamais |
| `dateRange` | la date locale est dans la période, bornes comprises | jamais |
| `any` | l'une de ses feuilles est vraie — **un seul niveau** : un `any` ne contient que des feuilles | aucune vraie et au moins une inconnue |

Chaque prédicat porte un `not` facultatif, qui inverse vrai et faux et **laisse l'inconnu inconnu**.

`field` n'est pas validé à l'enregistrement : il l'est **à l'exécution** contre les clés du kind
(`stateKeys`, moins `kind` / `updatedAt` / `available`). Un champ inconnu rend la règle `incomplete`
au lieu d'en refuser l'écriture. `fields.ts` (`TRIGGER_FIELDS`) n'est que la liste que PROPOSE
l'éditeur, par kind — un guide, pas une barrière ; un test vérifie que chaque entrée existe dans
l'état de son kind.

**Évaluation à trois valeurs** (`apps/server/src/core/automations/evaluate.ts`) : vrai, faux ou
inconnu, et **seul `true` compte** partout. Un déclencheur ne part que sur un passage faux → vrai, un
« sauf si » ne bloque que s'il est vrai. Un inconnu ne déclenche rien et n'empêche rien. C'est ce qui
rend le front montant sûr : un redémarrage, un plugin qui revient, un appareil qui réapparaît passent
par « inconnu » et ne déclenchent pas.

### Déclencheurs (`automation.ts`)

- **`time`** : `at` est soit `{ kind: 'clock', time: 'HH:MM' }`, soit
  `{ kind: 'sun', event: dawn | sunrise | sunset | dusk, offsetMin?, notBefore?, notAfter? }`
  (`offsetMin` négatif = avant, ±720). `notBefore` / `notAfter` se lisent **le même jour** et ramènent
  l'heure calculée dedans (« au coucher, mais jamais après 22:00 »). `days` et `dateRange` facultatifs
  (absents = tous les jours, toute l'année).
- **`state`** : `when` est un prédicat ; la règle part sur le **front montant** faux → vrai.
  `forMin` exige que le prédicat le reste N minutes (« la production dépasse la consommation depuis
  10 min »). Une contrainte horaire n'a rien à faire dans `when` — elle ne serait réévaluée qu'au
  prochain changement d'appareil — elle va dans `unless`.

### « Sauf si » (`unless`)

Liste de prédicats (20 au plus) combinés en **OU** : la règle ne fait **rien** si l'UN d'eux est vrai.
L'exécution est alors notée `skipped` dans `lastRun`.

### Actions et cibles

- **`command`** : une commande du contrat (`commandSchema`) sur une cible. L'exécution prend
  **le même chemin que le REST** (`POST /api/devices/:id/command`) : `assertCommandAllowed` contre le
  descripteur, puis `host.execute` (`runner.ts`).
- **`recallScene`** : rappel d'une ambiance de fabricant, avec un mode **écrit** (`automationRecallSchema`,
  pas le défaut de `sceneRecallSchema`) ; `dynamic` sur une ambiance sans palette animée est refusé
  comme par la route.

Une cible est soit **`devices`** (ids nommés), soit **`selector`** `{ kind, deviceClass?, roomIds?,
levelIds?, zoneIds?, exceptRoomsWith? }` résolu **au moment d'agir** : une lampe ajoutée demain entre
dans « toutes les lumières du rez-de-chaussée » sans rien réécrire. Aucune portée = toute la maison.
`exceptRoomsWith` écarte les pièces qui contiennent un appareil ACTIF de ce kind (« toutes les
lumières, sauf là où la TV est allumée »). Nuance voulue dans `resolveTarget` : une cible nommée rend
aussi les ids absents (erreur `DEVICE_UNKNOWN` à rapporter), une **sélection saute les appareils
indisponibles** — sans quoi chaque exécution nocturne se solderait par un échec partiel pour une
lampe débranchée.

La nature d'un appareil (`deviceClass`) se lit par `deviceClassOf(descriptor)`
(`packages/shared/src/devices/activity.ts`), avec les défauts du contrat : un lecteur muet sur sa
nature est une enceinte (`speaker`), un climat un `thermostat`.

Les actions s'enchaînent **dans l'ordre** ; les appareils d'une même action partent ensemble
(`Promise.allSettled`). Un échec n'arrête rien. Le compte rendu dit « accusé », jamais « fait » : un
fabricant qui acquitte n'a pas forcément exécuté (leçons iRobot et PetKit,
`../3_plugins/3_14_irobot-roomba.md`, `../3_plugins/3_17_petkit.md`). Issue : `ok`, `partial`,
`failed` (toutes les tentatives ont échoué) ou `skipped` ; aucune cible (toutes les pièces écartées)
n'est pas un échec.

### Statut, calculé par le serveur

`automationStatusSchema` : `health` (`ok` | `incomplete` = une référence manque | `unavailable` = un
appareil référencé ne répond pas), `missing[{ kind: device|field|scene|room|level|zone|parking, id }]`,
`unavailableDeviceIds`, `lastRun { at, by: time|state|manual, outcome, errors[{ action, deviceId?, code,
message }] }`, `nextRunAt` (déclencheur horaire), `pendingSince` (attente `forMin` en cours). Le
calcul structurel est dans `status.ts` ; `lastRun`, `nextRunAt` et `pendingSince` sont gardés en
mémoire par le moteur (perdus au redémarrage).

### Graines de l'itération 2 (commentaires seulement, rien d'implémenté)

Dans `automation.ts` : déclencheur `forecast` (`deviceId`, `precipProbability` | `windKmh`, `op`,
`value`, `horizonH`), déclencheur `event` (sonnette, mouvement, personne — `DEVICE_EVENT_KINDS`),
actions `system.run` (nom pris dans une liste blanche du `.env`) et `webhook` (`url`). La forme leur
fait de la place ; aucun schéma ne les accepte aujourd'hui.

## Le moteur (`apps/server/src/core/automations/`)

### Horaire : un seul minuteur (`engine.ts`, `schedule.ts`)

Un **seul** `setTimeout`, posé sur la plus proche échéance de toutes les règles actives, **jamais plus
loin que 6 h** (`MAX_WAIT_MS`) : `setTimeout` plafonne à 24,8 jours, et le soleil doit de toute façon
être relu chaque jour. À chaque réveil, les règles échues partent, puis le minuteur est reposé.

Tout se raisonne en **heure murale locale**. Un jour se construit par `new Date(a, m, j + k)` et
**jamais en ajoutant 24 h** : sinon un changement d'heure décalerait d'une heure toutes les échéances
suivantes. Une heure qui n'existe pas (02:30 au passage à l'heure d'été) est normalisée par `Date` à
03:30 ; une heure qui existe deux fois n'est prise qu'une fois (tests « spring DST » / « autumn DST »
de `schedule.test.ts`). Horizon de recherche : 366 jours.

**Une échéance manquée pendant un arrêt du serveur n'est pas rattrapée** — choix assumé : fermer les
volets à 10 h parce que le serveur a redémarré après le crépuscule serait pire que ne rien faire.

### État : front montant, et le piège des valeurs par défaut

Sur chaque `state` du bus, seules les règles dont le prédicat **touche** cet appareil sont réévaluées
(`touches`). `vehicleParkedAt` dépend aussi des AUTRES engins (une place ne prend qu'un occupant) :
tout état de véhicule ou de tondeuse le réévalue.

- **Le jeu `fresh`.** Un appareil est inconnu tant qu'il n'a pas émis un `state` depuis son apparition.
  Raison : l'état par défaut d'un appareil fraîchement enregistré est `available: false`, et les
  plugins qui appellent `setAvailable` avant leur premier relevé exposeraient un instant les valeurs
  par défaut comme si elles étaient vraies — de quoi fabriquer un faux front au démarrage.
  `fresh` se vide des appareils qui quittent le registre (événement `devices`).
- **Photo de référence** (`baseline`) au démarrage, à chaque écriture (`upsert`) et à chaque
  (dés)activation : la valeur actuelle du prédicat est notée **sans jamais déclencher**. Un inconnu
  qui devient vrai ne déclenche pas non plus : il faut un `false` observé avant le `true`.
- **Garde `running`** : une règle encore en cours d'exécution ignore un nouveau déclenchement (log
  `warn`).
- **Aucun gestionnaire du bus n'attend une exécution** (`void runActions(...)`), et chacun est enrobé
  d'un try/catch : `Bus.emit` n'attrape rien, et une exception remonterait dans le plugin qui a publié
  l'état. Les états produits par nos propres commandes reviennent plus tard, sur un autre tour : front
  seul, pas de boucle.
- **`forMin`** : sur le front, `pendingSince` est posé et un minuteur attend ; à son échéance, le
  prédicat est réévalué et doit être encore vrai. Il redevient faux ou inconnu entre-temps → attente
  annulée.

### La maison vue par le moteur (`context.ts`)

`HouseView` fournit la maison **effective** : `house.devices` plus ce que `autoPlaceDevices` rattache à
une pièce d'après `meta.room` des descripteurs — la même que voit l'interface
(`apps/web/src/stores/house.ts`). Recalculée seulement quand la référence `loaded.house` change
(`updateHouseFile` la **réassigne**, une comparaison de référence suffit) ou sur l'événement `devices`
du bus (`invalidate`). Les places occupées (`parkingOf`) suivent la règle de la scène 3D
(`HouseScene.computeParkingFixes`) : un engin dont la maison écrit la position n'est pas candidat, sa
place fait foi.

### « Exécuter maintenant »

`runNow` (route `POST /api/automations/:id/run`) joue **les actions seules**, sans déclencheur ni
« sauf si » : on teste l'« Alors ». `by: 'manual'`.

## Persistance (`store.ts`)

`maison.json` → `maison.automations.json`, dans le même dossier (`automationsPathFor`). Deux maisons,
deux fichiers ; et ce sont des **données de l'utilisateur**, pas un cache — rien à voir avec `.state/`.
Écriture atomique (`.tmp` puis `rename`), copie `.bak` de la version précédente, écritures
**sérialisées** (file de promesses). Format `{ schemaVersion: 1, automations: [...] }`.

**Un fichier illisible empêche le démarrage**, comme une maison invalide : démarrer à vide ferait
écraser les règles par la première sauvegarde. Fichier absent = liste vide. Si l'écriture échoue, le
moteur rétablit la version précédente en mémoire et relaie l'erreur.

`.gitignore` ignore `house/*.automations.json` et son `.tmp` (le `.bak` tombe déjà sous `house/*.bak`).

## Le soleil (`packages/shared/src/house/sun.ts`)

`sunPosition` (et `approximateSunPosition`) a quitté `apps/web/src/three/core/sun.ts` pour
`@kasbah/shared` dès que le serveur en a eu besoin ; le fichier web reste comme ré-export, la scène
n'a rien changé. Nouveau : `sunTimes(day, lat, lon)` rend `dawn` / `sunrise` / `sunset` / `dusk` du
jour **local** qui contient `day` — seuils −0,833° (bord supérieur, réfraction comprise) et −6°
(crépuscule civil). Pas de nouvelle astronomie : balayage par pas de 10 min sur `sunPosition`, puis
dichotomie sur chaque passage. Un passage absent = il n'a pas lieu ce jour-là (jour polaire,
crépuscule qui ne finit pas).

**Piège corrigé** : les passages en montée sont cherchés **avant** le midi solaire, ceux en descente
**après**. Sans ce partage, à ~60° N en juin, le crépuscule de la VEILLE (tombé après minuit) était
pris pour celui du jour (test « never returns the previous evening dusk after midnight »,
`sun.test.ts`). Précision vérifiée à deux minutes aux solstices pour Dijon.

**Ne jamais planifier sur l'état `weather`** (`sunrise` / `sunset`) : le mock les publie à 06:00 et
20:00 fixes (`packages/mock-sim/src/behaviours/weather.ts`, `sunEvents`), et un vrai service peut
tomber. Le calcul local ne dépend de rien.

## Fuseau horaire

Il n'y a pas de `house.timezone` : le moteur utilise le **fuseau du process**, comme le reste du
serveur. Le service doit donc tourner avec le bon `TZ` (`../5_setup/5_1_configuration-env.md`) —
un serveur en UTC fermerait les volets une ou deux heures trop tôt ou trop tard.

## Limites connues (à la date de cette page)

- **Arrivée d'un véhicule en retard** : sa position est relevée toutes les 10 min environ (Tesla,
  `TESLA_POLL_MS`, contraint par le budget d'appels — `../3_plugins/3_8_tesla.md`) ; `vehicleOnSite`
  part donc jusqu'à un intervalle après l'arrivée réelle.
- **Pas de détection de présence ni d'alarme** : le contrat connaît `motion` / `person` / `sound`
  (`DEVICE_EVENT_KINDS`), mais le plugin Nest ne pousse encore que `chime`
  (`apps/server/src/plugins/nest/index.ts`), et les événements ne sont de toute façon pas des
  déclencheurs dans cette itération.
- **Pas de grêle** dans la prévision : `weatherForecastSchema` n'a aucun champ pour elle.
- **`play_url` lancé par le serveur** a besoin d'une URL joignable sur le LAN ; la voie envisagée est
  le lecteur musique commun (`/api/music`, `1_6_lecteur-musique.md`).
- **`house.scenes[]` n'a toujours aucun exécuteur** : une automatisation rappelle des ambiances de
  fabricant (`recallScene`), pas les scènes de la maison. *(Clos le 2026-10-06 : le champ est retiré
  du format, voir `../2_maison/2_0_format-house-json.md`.)*
- `lastRun`, `nextRunAt` et `pendingSince` ne survivent pas à un redémarrage.

## API et interface

Routes, message WebSocket et schémas de réponse : `1_3_protocole-rest-ws.md` (mise à jour du
2026-09-23). Assemblage dans `app.ts` : `1_2_serveur-et-plugins.md`. Store, transport et maquette :
`1_4_app-web.md`. Vue `/automations` (liste) et page d'édition `/automations/:id` — l'éditeur a
d'abord logé dans le panneau latéral, trop étroit, écarté le 2026-09-23 :
`../4_ui/4_1_navigation-et-panneaux.md`.

## Tests

- `packages/shared/src/automations/automations.test.ts` — aller-retour d'une règle, `any` imbriqué
  refusé, heures mal formées, commande hors contrat, snapshot d'un serveur ancien sans automatisations,
  `TRIGGER_FIELDS` cohérent avec l'état.
- `packages/shared/src/house/sun.test.ts` — solstices à Dijon (±2 min), jour polaire, crépuscule de la
  veille à 60° N.
- `apps/server/src/core/automations/schedule.test.ts` — jours autorisés, période, décalage et bornes du
  soleil, passages à l'heure d'été et d'hiver.
- `apps/server/src/core/automations/engine.test.ts` — inconnu avant le premier relevé, rayon de la
  maison, `any` et plage passant minuit, sélection sauf pièces à TV allumée, front seul, retour de
  disponibilité sans déclenchement, `forMin` annulé, `incomplete` puis `ok`, exécution partielle,
  fichier à côté de la maison avec `.bak`, refus de démarrer sur un fichier illisible.
- `apps/server/test/automations.test.ts` — de bout en bout par `buildApp` : routes (400 / 404), fichier
  écrit à côté de la maison copiée, règle incomplète acceptée, snapshot WebSocket, et **un vrai
  déclenchement** : simulation mock accélérée (`MOCK_TIME_SCALE=600`, dix minutes simulées par seconde
  d'horloge), la Tesla du scénario rentre à la maison et la règle part.

`schedule.test.ts` et `sun.test.ts` imposent `TZ=Europe/Paris` en tête de fichier, avec une garde qui
saute les cas si la plateforme ignore `TZ`. `engine.test.ts` ne l'impose pas.

### Mise à jour 2026-10-09 — pilotées par le MCP

Trois outils MCP (`1_7_serveur-mcp.md`) passent par les routes `/api/automations` : `list_automations` (statut :
santé, `missing`, `unavailableDeviceIds`, `nextRun`, `pendingSince`, `lastRun`), `set_automation_enabled`
(`PATCH`) et `run_automation` (`POST /:id/run`). Ce dernier exécute les actions **tout de suite, sans « Sauf si »**,
même règle désactivée : le contrat du bouton de l'app, pas celui d'un déclencheur. Décision : **ni création, ni
modification, ni suppression par MCP** — une règle tourne sans surveillance, elle s'écrit dans la vue
Automatisations. Le test crée sa règle dans une copie temporaire de la maison de démo, pour que
`<maison>.automations.json` n'atterrisse pas dans `house/`.

Sources : `apps/server/src/mcp/{server,server.test}.ts`.

### Mise à jour 2026-10-11 — ordre rangé à la main, et « pendant N minutes »

**Ordre de la liste.** Il n'est plus alphabétique : c'est l'ordre du fichier, que l'utilisateur range par
glisser-déposer (poignée à gauche de chaque ligne). Décision de l'utilisateur, contre un tri par prochaine
exécution : un déclencheur d'état (« une voiture arrive au portail ») n'a pas de prochaine heure. Route
`PUT /api/automation-order` `{ ids }` (`automationOrderSchema`), **hors de** `/api/automations/` parce que
`order` est un id d'automatisation valide. `AutomationEngine.reorder` : id inconnu ignoré, règle absente de la
liste gardée après les autres ; réécrire une règle ne la déplace pas, une neuve va en bas. Le store web garde
un tableau `order` à part (une clé d'objet numérique comme « 12 » passerait devant les autres dans
`Object.values`) ; le glissement est optimiste, l'ordre revient si le serveur refuse. Filtrée ou cherchée,
la liste n'échange que les places des lignes affichées : les autres gardent les leurs dans le fichier.

**« Pendant N minutes ».** Une action `command` porte un `forMin` facultatif (1 à 1440) : au bout, la
commande **inverse** part sur les appareils qui ont accusé réception (« ouvrir le portail pendant 20 min »).
`inverseCommand` (`packages/shared/src/automations/inverse.ts`) ne connaît que les inverses évidents, choix
de l'utilisateur : ouvrir ↔ fermer, allumer ↔ éteindre (une commande qui ne fait QUE basculer `on`),
lecture → arrêt, aspirateur → base, tondeuse → `mower.park` jusqu'au prochain créneau, verrouiller ↔
déverrouiller, charge ↔ arrêt, préchauffage → arrêt. Ni position, ni luminosité, ni volume, ni consigne :
il faudrait relever la valeur d'avant. Pour une commande sans inverse, l'éditeur grise le bouton
« Pendant » et retire `forMin` ; le serveur l'ignore de toute façon.

Côté moteur : `runActions` rend `{ run, reverts }`, un retour daté par appareil. Le moteur les garde par
`automation#action#appareil` (un nouveau déclenchement **remplace** le retour en attente : l'attente
repart de zéro), sous un seul minuteur. Un retour échu ne part que si son appareil a publié un état
(`fresh`) et est disponible — jamais sur les valeurs par défaut d'un appareil pas encore relevé. Ni
supprimer ni désactiver la règle n'annule un retour : le portail se referme quand même. Un échec du
retour est seulement journalisé (`automation revert failed`), il n'entre pas dans `lastRun`.

**Rattrapé après un redémarrage**, choix de l'utilisateur et contraire assumé de la règle des échéances
horaires (non rattrapées) : laisser le portail ouvert serait pire que le fermer en retard. Les retours en
attente sont écrits dans `.state/automation-reverts.json` (`reverts.ts`, `writeFileAtomic`) ; un fichier
illisible est ignoré avec un avertissement, il ne bloque pas le démarrage. Un seul fichier pour le
serveur, pas un par maison : les ids d'appareils sont ceux des plugins, communs aux maisons.

Le mode simulé (`mockTransport`) range la liste mais **n'exécute pas** les retours.

Sources : `packages/shared/src/automations/{automation,inverse}.ts`, `apps/server/src/core/automations/{runner,engine,reverts}.ts`,
`apps/server/src/{app.ts,http/routes.ts}`, `apps/web/src/{stores/automations.ts,views/AutomationsView.vue,lib/automations.ts}`,
`apps/web/src/components/automations/{AutomationRow,ActionEditor}.vue`. Tests : `engine.test.ts` (retour après N min, attente
qui repart, rattrapage au redémarrage une fois l'appareil relevé, aucune commande sans inverse, ordre),
`automations.test.ts` (`inverseCommand`), `stores/automations.test.ts` (ordre du serveur, retour arrière).

### Mise à jour 2026-10-13 — éditeur : fondu des lumières, listes filtrables, aube et crépuscule précisés

**Fondu des lumières.** Une action lumière (allumer, éteindre, allumer à N %) porte un fondu facultatif,
saisi en secondes ou en minutes entières et plafonné à une heure (`FADE_MAX_MS`). Rien de neuf dans le
contrat : c'est le `transitionMs` de `light.set` (`1_1_contrat-appareils.md`), que l'éditeur ne proposait
pas. **Une seule commande par lampe** : le plugin Hue la traduit en `dynamics.duration`
(`apps/server/src/plugins/hue/mapping.ts`) et c'est le pont qui fait la rampe ; le serveur n'envoie pas de
pas intermédiaires. Hue v2 ne documente aucun plafond (la v1 s'arrêtait à 109 min), d'où l'heure. Les
lumières Tuya ignorent le champ et changent d'un coup ; le mode simulé imite la rampe
(`packages/mock-sim/src/behaviours/light.ts`). Avec « Pendant N min », la commande inverse **refait le même
fondu**, choix de l'utilisateur : `inverseCommand` ne compte plus `transitionMs` comme un réglage qui
empêche l'inverse, et le recopie. Passer d'« allumer » à « allumer à N % » garde le fondu choisi. La phrase
de la règle le dit : « Allumer · … · en 10 min · pendant 120 min » (`fadeLabel`). Non vérifié sur la vraie
installation : ce que la lampe publie pendant la rampe (valeur finale tout de suite, ou étapes).

**Changer de mode ne perd plus la saisie.** Heure → Soleil → Heure rendait 07:30 et vidait la période.
Chaque mode garde ce qu'on y a saisi le temps de l'édition (« Annuler » l'oublie), et passer de l'heure au
soleil ne change que l'instant : jours et période restent, y compris après un détour par « Appareil »
(`setTriggerKind`, `AutomationEditor.vue`).

**Aube et crépuscule précisés.** `dawn` et `dusk` sont civils (soleil à −6°, voir « Le soleil » plus
haut). Le menu ne disait que « Crépuscule », et « 5 min après le crépuscule » a été lu « 5 min après son
début », qui est le coucher, environ 35 min plus tôt. L'utilisateur a voulu garder les termes justes en
les précisant : « Début de l'aube », « Fin du crépuscule », un sous-titre dans le menu (« 6° sous
l'horizon, ~35 min après le coucher ») et des phrases comme « 15 min avant la fin du crépuscule ». En
anglais, *dawn* et *dusk* désignent déjà ces instants : seul le sous-titre s'ajoute. Aucune logique ne
change.

**Listes filtrables.** Les choix d'appareil, de pièce, de « Où » et d'ambiance sont des `v-autocomplete`
(on tape pour filtrer). « Ajouter un appareil » est un choix multiple qui reste ouvert, coché pour les
appareils déjà pris ; les pastilles au-dessus restent la liste visible, un appareil disparu y reste en
orange. Les listes courtes (places, opérateurs, unités) restent des menus. Sur tablette, un champ
filtrable fait monter le clavier.

**Appliquer et Enregistrer.** « Enregistrer » ne fermait pas la page : il devient « Appliquer »
(enregistre et reste), et « Enregistrer » enregistre puis revient à la liste, directement s'il n'y a
rien à enregistrer. Seul le bouton appuyé dit « Enregistrement… ». Sur téléphone, les cinq boutons
tiennent en deux rangées de trois.

**Débordements en écran étroit.** Deux pièges de mise en page :
- une carte en `display: grid` sans colonne déclarée prend la largeur minimale de son enfant le plus
  large : les cartes d'action et d'exception débordaient de leur colonne vers 900-1000 px de large.
  Corrigé par `grid-template-columns: minmax(0, 1fr)` ;
- colonnes empilées (sous 900 px), le `min-height: 0` du bureau laissait la grille de hauteur fixe
  écraser les rangées : les colonnes se chevauchaient sur téléphone. Elles reprennent `min-height: auto`
  et c'est toute la zone qui défile.

Vérifié dans le mode simulé : mesures géométriques aux largeurs 375, 768, 901, 973 et 1280 px, en
français et en anglais (aucun débordement, rien ne bouge en ouvrant les menus, en activant le fondu ni en
appliquant).

Sources : `packages/shared/src/automations/inverse.ts`, `apps/web/src/lib/automations.ts`,
`apps/web/src/components/automations/{AutomationEditor,ActionEditor,PredicateEditor}.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`. Tests : `automations.test.ts` (shared : inverse avec fondu),
`apps/web/src/lib/automations.test.ts` (phrase avec fondu, crépuscule précisé).
