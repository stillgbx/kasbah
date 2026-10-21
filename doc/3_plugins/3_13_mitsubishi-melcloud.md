# Plugin Mitsubishi MELCloud (pompes à chaleur Ecodan Zubadan)

> Dernière mise à jour : 2026-10-21
> Sources : `apps/server/src/plugins/melcloud/{index,auth,client,mapping,history,types}.ts`, tests `mapping.test.ts`, `plugin.test.ts`, `history.test.ts`, capture anonymisée `apps/server/src/plugins/melcloud/__fixtures__/melcloud.ts`, `apps/server/src/plugins/index.ts`, `apps/server/.env.example`, `apps/web/src/components/MelcloudLinkCard.vue`, `apps/web/src/api/transport.ts`, journal de session `_generated-ai-doc/sessions/2026-09-17-melcloud-chauffage/journal.md`

## Ce que la maison chauffe, et ce que MELCloud en montre

Des pompes à chaleur **Ecodan Zubadan** en cascade derrière un seul régulateur **FTC**. Côté
MELCloud, il n'y a **qu'un appareil** : le cloud voit le régulateur, pas les machines qu'il pilote.
C'est le premier démenti de la capture, et il conditionne tout le reste — chercher « une pompe à
chaleur par machine » dans l'inventaire ne donnera jamais rien, et la carte des Réglages dit donc
« 1 machine · N zones » plutôt qu'un nombre qui rassurerait à tort (`health().detail` : `N zone(s) on
1 unit(s) · read-only`).

Ce qui est publié à la maison : **un appareil `climate` par ZONE de chauffage**, en lecture seule.
Deux zones, donc deux appareils (`melcloud:<deviceID>-z1`, `…-z2`).

Ce qui n'est **pas** modélisé : le **ballon d'eau chaude**. `HasHotWaterTank: false` — un ballon
peut exister sans être piloté par la pompe à chaleur, donc MELCloud n'en sait rien
et le plugin n'a rien à en dire. Un plugin qui inventerait un `water_heater` afficherait des zéros
sur un objet réel : c'est pire que de ne rien afficher.

## L'API : un cloud non officiel, et un mot de passe

Le module Wi-Fi d'une Ecodan **ne parle qu'à MELCloud**. Il n'existe rien en local, et aucune voie
officielle pour un particulier. Reste l'API de l'application mobile,
`https://app.melcloud.com/Mitsubishi.Wifi.Client`, avec ce que cela implique.

**Pas d'OAuth : un mot de passe.** Deuxième plugin dans ce cas après Renault
([3_9_renault](3_9_renault.md)), et la décision est la même, littéralement :

> l'identifiant et le mot de passe traversent le serveur **une fois**
> (`POST /api/plugins/melcloud/login`, saisis dans la carte des Réglages), ne sont ni écrits, ni
> journalisés, ni mis en configuration. Seule survit la **`ContextKey`** que MELCloud rend en
> échange, dans `MELCLOUD_SESSION_FILE` (0600, écriture atomique `.tmp` + `rename`).

Plus simple que Renault sur un point : il n'y a **qu'un jeton**, pas deux, et rien à rafraîchir.
Quand MELCloud refuse la clé, il n'existe aucun moyen d'en refaire une sans le mot de passe —
`auth.invalidate()` la jette donc, pour que `health()` repasse en `needs_pairing` tout de suite au
lieu de laisser le plugin marteler une clé morte.

**MELCloud répond TOUJOURS en HTTP 200.** Mot de passe faux, clé périmée : 200, avec l'échec dans
le corps (`ErrorId`, `1` = identifiants refusés). Exactement le piège de Gigya chez Renault. Un
client qui ne regarde que le statut croit réussir à chaque appel — d'où la lecture systématique
d'`ErrorId` avant de regarder `LoginData`.

## Ce que la capture a démenti (le cœur de cette page)

Le mappage a été écrit **après** la capture du vrai compte (`__fixtures__/melcloud.ts`, anonymisée :
identifiants, MAC, numéro de série, coordonnées, propriétaire ; **les valeurs physiques sont
intactes**). Quatre choses que la documentation communautaire ne laissait pas prévoir :

1. **Une machine MELCloud ≠ une pompe à chaleur.** Des Zubadan en cascade, un seul appareil.
2. **Aucun ballon** (`HasHotWaterTank: false`).
3. **Les deux zones ne se pilotent pas pareil.** Zone 1 sur l'**ambiante** : température mesurée
   et consigne de pièce. Zone 2 en **loi d'eau** : température de départ et consigne de départ.
   Deux couples de champs MELCloud entièrement différents, sous un même kind —
   c'est ce constat qui a fait naître `meta.climate.control` dans le contrat
   (voir [../1_architecture/1_1_contrat-appareils](../1_architecture/1_1_contrat-appareils.md)).
4. **Aucun compteur d'énergie.** `HasEnergyConsumedMeter: false`, `CanMeasureEnergyConsumed: false`,
   et surtout : le relevé d'énergie interrogé sur **31 jours de janvier-février** revient **tout à
   zéro**, `CoP` intégralement en `null`. Une semaine de septembre à zéro n'aurait rien prouvé (une
   machine qui ne chauffe pas consomme zéro) ; il a fallu **aller demander l'hiver** pour trancher.
   `MissingMinutes` y vaut 1380 comme sur la semaine de septembre — une constante, donc pas une
   mesure.

Conséquence directe : **pas de kWh nulle part dans l'UI**, et un historique construit autrement
(voir plus bas). Le quatrième point est aussi ce qui permet à la vue d'**omettre** la section
consommation plutôt que d'afficher une colonne de zéros : `SystemReading.energyMeter` porte
l'information jusqu'à l'écran.

## La décision contre-intuitive : `ListDevices` et jamais `Device/Get`

Les noms trompent. `Device/Get` — « la lecture détaillée d'un appareil » — rend **42 champs** ;
`User/ListDevices` — « la liste du compte » — en rend **210** pour la même machine, et couvre tout
le compte **en un seul appel**.

Le sondage lit donc `ListDevices`, un appel par tour quel que soit le nombre de machines, et
`Device/Get` ne sert plus qu'au relevé brut. À retenir pour les autres fabricants : **vérifier
laquelle des deux routes est la plus riche avant de choisir**, l'intuition des noms se trompe ici du
tout au tout.

Cadence : `MELCLOUD_POLL_MS`, deux minutes par défaut (plancher à une minute, plafond à une heure).
Elle est bornée par la **physique**, pas par un quota : la machine remonte au cloud **chaque minute**
(`NextCommunication` une minute après `LastCommunication`). Sonder plus vite relit la même chose, et
le chauffage est de toute façon une grandeur lente. Le repli d'erreur (`createBackoff`) est calé sur
l'intervalle lui-même : réessayer dans deux secondes ne ferait que fâcher une API déjà muette.
*(Dépassé le 2026-10-21 : une minute par défaut, et la vue Chauffage suit la cadence du serveur — voir « Mise à jour 2026-10-21 ».)*

Le mappage met à plat **l'enveloppe et le sous-objet `Device`** (`Device` gagne en cas de conflit) :
aucun des deux ne se suffit — les bornes de consigne sont dans l'enveloppe, l'état de la machine
dans `Device`. Et les appareils sont cherchés **par leur forme, pas par leur chemin** : MELCloud les
range à quatre profondeurs possibles (`Structure.Devices`, `Structure.Areas[].Devices`,
`Structure.Floors[].Devices`, `Structure.Floors[].Areas[].Devices`) selon l'installation ; on descend
l'arbre et on retient tout nœud qui porte un `DeviceID` (sans le parcourir plus loin, son `Device`
interne referait compter la même machine deux fois).

## Les quatre pièges, chacun avec son symptôme

### 1. `ErrorCode` vaut **8000** quand tout va bien

**Symptôme si on l'ignore** : la maison est déclarée en panne en permanence.
`HasError: false` est la seule lecture fiable ; le code n'est gardé que pour l'afficher à côté du
message du fabricant.

### 2. `RoomTemperatureZone2` vaut **-39**

**Symptôme** : une pièce à −39 °C dans l'interface, ou une « température mesurée » absurde à côté
d'une consigne plausible. C'est une **sentinelle de sonde absente**, pas un `null` — MELCloud ne
sait pas dire « je ne sais pas ». Le champ qui **dit la vérité** est `Zone2InRoomMode` (faux ici).

Piège dans le piège : `HasThermostatZone2: true` alors qu'aucune sonde n'est branchée — ce champ
décrit ce que le FTC **permet**, pas ce qui existe.

Le mappage applique donc deux conditions pour retenir l'ambiante : la zone doit être **pilotée**
dessus **et** la valeur doit être plausible (garde `plausible()` : > −30 °C et < 100 °C). Une sonde
débranchée retombe sur la température de départ, qui vaut mieux qu'une valeur fausse.

### 3. `Offline` **MENT**

**Symptôme observé** : les deux zones de la maison grisées et « injoignables », avec des données
parfaitement fraîches en dessous.

Relevé en direct sur la machine : `Offline: true` alors que `LastTimeStamp` avançait **à chaque
minute**, que `NextCommunication` annonçait la remontée suivante dans soixante secondes, que
`WifiAdapterStatus` valait `NORMAL` et que `HasError` était faux.

La disponibilité se décide donc sur la **fraîcheur de `LastTimeStamp`**, seule chose vérifiable
(`unitAvailable`, seuil `DEFAULT_STALE_MS` = **15 minutes**, soit quinze fois la cadence de remontée
observée : assez pour absorber un module Wi-Fi qui bafouille, assez court pour ne pas montrer des
chiffres d'hier). `Offline` est conservé dans `SystemReading.offline` **pour le diagnostic
seulement**, jamais pour décider. Sans aucun horodatage, et là seulement, on retombe faute de mieux
sur ce que dit le fabricant.

> Réserve honnête : **la fixture du dépôt ne contient pas ce contre-exemple** — capturée à un autre
> instant, elle porte `Offline: false`. Le mensonge est attesté par l'observation en session
> (journal de session) et par les commentaires de `mapping.ts` / `types.ts`, pas par un fichier rejouable.
> Le jour où `Offline: true` se reproduit, en garder la capture.

### 4. Deux bases de temps, toutes deux écrites sans fuseau

**Symptôme** : « dernière remontée » décalée de deux heures selon la route qui a servi à la lire.

- `LastTimeStamp` (dans `ListDevices`, celle qu'on sonde) est en heure **LOCALE** ;
- `LastCommunication` (dans `Device/Get`) est le **même instant en UTC** ;
- et **aucune des deux ne porte de fuseau**. Sur la capture, la même remontée apparaît avec deux heures d'écart (local contre UTC).

`Date.parse` lit une date-heure sans fuseau comme locale : la première est donc correcte telle
quelle, la seconde exige un `Z` ajouté à la main. `lastSeenAt()` résout cela **une fois**, et rend
des **millisecondes epoch** — aucun lecteur, côté serveur ou côté web, n'a plus à savoir de quelle
route vient la valeur. C'est le piège déjà rencontré chez Husqvarna
([3_11_husqvarna-automower](3_11_husqvarna-automower.md)), traité ici à la source plutôt que chez
chaque consommateur.

## Ce que le plugin publie, et ce qu'il refuse de publier

### Un `climate` par zone, en lecture seule

Seule capacité déclarée : **`current_temp`**. Ni `target_temp`, ni `hvac_mode` — le plugin refuse
toute commande (`execute` lève `UNSUPPORTED_COMMAND`), et déclarer les capacités ferait promettre à
l'UI des boutons qui échoueraient. C'est le raisonnement qui avait déjà privé le kind `camera` de
`on_off`. **La consigne reste lisible** : elle fait partie de l'état, c'est le geste qui manque, pas
la valeur.

`meta` porte trois choses qui décident l'affichage :

- `climate.modes` : `off, heat, eco` — pas `cool`, puisque `CanCool: false` ;
- `climate.control` : `room` pour la zone 1, `flow` pour la zone 2 ;
- `climate.deviceClass: 'heat_pump'` : une machine au sol, pas une pastille murale.

`mode` et `action` sont distingués, et c'est loin d'être cosmétique : la machine est **allumée**
(`mode: 'heat'`) presque toute l'année, elle ne **chauffe** (`action: 'heating'`) que par moments.
Sur la capture de septembre, `Power` est vrai et les deux zones sont au repos.

Les descripteurs ne sont republiés que si leur empreinte change : une zone qui bascule de l'ambiante
à la loi d'eau change son `meta.climate.control` et l'UI doit le savoir, mais redire la même chose
toutes les deux minutes ferait battre le registre pour rien.

### L'état MACHINE n'est pas un appareil : `GET /api/plugins/melcloud/system`

Dégivrage, appoints électriques, quatre circulateurs, vanne 3 voies, départ / retour / condensation,
demande en pour cent, état Wi-Fi, erreur. **Une douzaine de capteurs pour des valeurs qu'on ne
consulte qu'à un seul endroit** encombrerait l'inventaire, la recherche et la scène 3D. Ils sont
servis à la vue Chauffage par une route de plugin, qui rend **la dernière lecture du sondage** et ne
refait jamais d'appel — même règle que les prévisions météo et l'historique de consommation.

La route répond **409** tant que le compte n'est pas relié : « pas encore lié » n'est pas une panne.

### L'historique est construit par SONDAGE, faute de compteur

`history.ts` : un point par heure, **168 heures** (une semaine), persisté dans
`MELCLOUD_HISTORY_FILE`. Servi par `GET /api/plugins/melcloud/history`.

Trois décisions à retenir :

- **Des comptes d'échantillons, pas des minutes.** Chaque point porte `n` (échantillons pris dans
  l'heure) et des compteurs (`heating`, `defrost`, `booster`). `n` donne l'échelle, et une heure mal
  sondée — serveur redémarré, cloud muet — se lit alors **pour ce qu'elle est** au lieu de passer
  pour une heure creuse. Une heure jamais sondée est **absente**, pas à zéro.
- **C'est `idle` qui compte, pas `power`.** Compter les heures « allumées » tracerait une ligne
  plate de janvier à décembre. Un échantillon compte comme « chauffe » si la machine est allumée
  **et** qu'au moins une zone n'est pas au repos.
- **Écriture à la bascule d'heure**, pas à chaque sondage : 720 écritures par jour pour sauver au
  mieux deux minutes de trace n'ont pas de sens. `stop()` écrit l'heure en cours, sinon chaque
  redémarrage trouerait la courbe.

L'historique ne suit que la **première** machine : un foyer en a une, et mélanger deux pompes à
chaleur dans une même courbe ne voudrait rien dire. À revoir le jour où il y en a deux.

## Configuration et routes

| Clé `.env` | Rôle |
|---|---|
| `MELCLOUD_BASE_URL` | Point d'entrée de l'API (`https://app.melcloud.com/Mitsubishi.Wifi.Client`). En configuration pour la même raison que les clés Renault : le fabricant peut le déplacer. |
| `MELCLOUD_APP_VERSION` | Version d'application annoncée à la connexion (`1.34.12.0`). MELCloud l'exige ; sa valeur n'a jamais bloqué, mais le fabricant pourrait se mettre à la vérifier. |
| `MELCLOUD_SESSION_FILE` | Où vit la `ContextKey`. **Jamais le mot de passe.** |
| `MELCLOUD_POLL_MS` | Cadence (120 000 par défaut, 60 000 ≤ v ≤ 3 600 000). |
| `MELCLOUD_HISTORY_FILE` | Historique de fonctionnement déjà calculé. Chaîne vide = ne rien garder (il repart alors de zéro à chaque redémarrage). |

**Aucun secret** n'est en configuration : la liaison se fait depuis la carte « Mitsubishi MELCloud »
des Réglages (`MelcloudLinkCard.vue`, montée par `PluginSection`).

Routes du plugin (préfixées `/api/plugins/melcloud`) :

- `GET /status` — ce que la carte des Réglages affiche : compte lié, nom, machines vues,
  `zoneCount`, cadence, dernière erreur. Jamais le mot de passe ni la clé.
- `POST /login` / `POST /logout` — relier, délier. `login` enchaîne un sondage immédiat, pour que la
  carte montre les zones sans attendre deux minutes.
- `GET /system`, `GET /history` — la machine et sa trace, pour la vue Chauffage.
- `GET /raw?from=AAAA-MM-JJ&to=AAAA-MM-JJ` — relevé brut : `ListDevices`, plus `Device/Get` et le
  relevé d'énergie **machine par machine**, chaque lecture tentée séparément et son **échec rendu
  plutôt que levé** (savoir ce que MELCloud refuse vaut autant que savoir ce qu'il donne). **C'est
  la fenêtre réglable de cette route qui a permis de trancher l'absence de compteur** : le défaut
  (sept jours) tombait en septembre et ne prouvait rien ; `?from=2026-01-15&to=2026-02-15` a donné
  31 jours d'hiver à zéro. La réponse contient des identifiants de compte et des noms de bâtiment :
  **à anonymiser** avant d'en faire une fixture.

## Ce qui reste ouvert

- **Écriture.** Le plugin est en lecture seule par décision de phase, pas par limite de l'API :
  MELCloud sait écrire une consigne. Le jour où on l'ouvrira, il faudra déclarer `target_temp` (et
  se souvenir que les bornes ne sont pas les mêmes selon `control` : ambiante contre 30-60 °C de
  départ) — et relire ce que Renault a appris sur un fabricant qui accuse en HTTP 200.
- **Le cas `Offline: true` n'est pas figé en fixture** (voir plus haut).
- **La sonde d'ambiance de la zone 1 n'est pas représentée** dans la maison : ce n'est pas un objet
  connecté, c'est une commande filaire du boîtier. Rien à placer dans la scène.
- **Les Zubadan en cascade restent invisibles** : rien dans l'API ne les distingue. Si un jour l'un tombe
  en panne, c'est le régulateur qui le dira, ou personne.

### Mise à jour 2026-10-21 — une lecture par minute, et une vue qui suit le serveur

Constaté sur la vraie maison : Nest passé en chauffe, la vue Chauffage affichait « dernière remontée »
vieille de plusieurs minutes et rien ne bougeait. Deux causes **cumulées** :

- les retards s'ajoutaient : la machine remonte chaque minute, le serveur lisait MELCloud toutes les
  **2 min**, et la vue relisait `/system` toutes les **2 min**, cadence **écrite en dur**
  (`useIntervalFn(refresh, 120_000)`) alors que la page recevait déjà `pollMs` du serveur. Jusqu'à
  ~5 min de retard au pire ;
- et **MELCloud ne voit pas la cascade**. Sur place, l'utilisateur constatait le circulateur en
  marche et une des trois unités extérieures en route ; MELCloud disait au même moment compresseur
  à **0 Hz** (`HeatPumpFrequency`), quatre circulateurs arrêtés, `IdleZone1/2` vrais. La vue
  affichait donc à tort zones « au repos » et 0 h de marche. Lu d'abord comme « la machine ne chauffe
  pas » — **faux**, corrigé par l'utilisateur. Les compteurs d'activité de `ListDevices` décrivent
  le FTC et son unité propre, pas les Zubadan en cascade. Seul champ vu bouger : `OperationMode`,
  **0** sur la capture de septembre (machine au repos) et **2** (chauffage, dans la numérotation
  Ecodan) pendant cette chauffe ; `DemandPercentage` ne départage rien (100 au repos en septembre).
  D'où `machineHeating` (`mapping.ts`) : `OperationMode` 2 = la machine chauffe.
  - `SystemReading.heating` le porte, et la carte machine dit « En chauffe » plutôt que « En marche » ;
  - une zone passe en `action: 'heating'` si elle n'est pas au repos **ou** si la machine chauffe et
    que la zone est en mode chauffage (`ZoneNInHeatMode`). MELCloud ne dit pas **quelle** zone la
    cascade sert (maison ou échangeur piscine) : les deux zones en mode chauffage l'affichent.
    Limite assumée, à revoir si un champ s'avère départager les zones ;
  - l'historique compte une heure de chauffe sur `system.heating` aussi : les 0 h de marche
    venaient du même aveuglement.

  Tests : `mapping.test.ts` (« sees the cascade heating through OperationMode… »),
  `history.test.ts` (« counts the machine heating even when the zones say idle »). La valeur 2 est
  la numérotation Ecodan (0 arrêt, 1 eau chaude, 2 chauffage, 3 rafraîchissement…) recoupée par
  la seule observation du 2026-10-21 ; garder la capture le jour où une autre valeur apparaît.

Désormais `MELCLOUD_POLL_MS` vaut **60 000** par défaut (le plancher : aucun quota MELCloud, la
remontée de la machine est la seule borne) et `views/HeatingView.vue` relit au rythme de `pollMs`
(une valeur de `.env` est respectée). Retard maximal ramené à ~2 min. L'historique n'écrit toujours
qu'à la bascule d'heure.

Note : la route `/raw` refait des appels au cloud (`ListDevices`, `Device/Get`, rapport d'énergie)
à chaque requête — à ne pas sonder en boucle pour du diagnostic ; `/system` rend la dernière lecture.

Voir aussi : la vue Chauffage dans [../4_ui/4_1_navigation-et-panneaux](../4_ui/4_1_navigation-et-panneaux.md),
les deux champs de contrat dans [../1_architecture/1_1_contrat-appareils](../1_architecture/1_1_contrat-appareils.md),
et les leçons transposables dans [3_2_ecrire-un-plugin](3_2_ecrire-un-plugin.md).
