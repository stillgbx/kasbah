# Plugin Renault (véhicules, Gigya + Kamereon)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/renault/{index,auth,client,mapping,types}.ts`, `apps/server/src/plugins/renault/__fixtures__/kamereon.ts`, tests `mapping.test.ts` et `plugin.test.ts`, `apps/web/src/components/RenaultLinkCard.vue`, `apps/web/src/views/VehiclesView.vue`, `apps/server/.env.example`, capture du vrai compte le 2026-09-14 (Renault 5 E-Tech `R5E1VE`), documentation `renault-api` (hacf-fr), portail `developer.ampere.cars`, dépôt `evcc-io/evcc` (modes de réveil), forum communautaire Renault, écriture de la cible de charge essayée sur le vrai véhicule le 2026-09-14, diagnostic du 2026-09-19 sur le vrai véhicule et le vrai serveur (réveil de charge qui ne partait pas)

## Il n'existe aucune voie officielle

Trois portes ont été essayées avant de choisir :

1. **`developer.ampere.cars`** (Ampere, l'entité VE de Renault) : portail ouvert en mai 2025, il ne
   sert qu'à écrire des **applications Android Automotive qui tournent DANS la voiture** (système
   openR Link). Un seul chapitre y est ouvert — des émulateurs R5 et Scenic. Aucune API cloud,
   aucun endpoint véhicule. C'est la direction inverse de ce qu'on veut. **À retenir quand même :
   c'est exactement ce qu'il faudrait pour récupérer ce que l'API ne donne pas** (pression des
   pneus…), par une appli Kasbah embarquée qui les exposerait au serveur.
2. **High Mobility**, l'agrégateur à qui Renault confie ses données véhicule : B2B, contrat,
   validation par le constructeur, facturé au véhicule. Inaccessible à un foyer.
3. **L'API privée de l'appli MY Renault** — **Gigya** (SAP Customer Data Cloud) pour
   l'authentification, **Kamereon** pour les données. C'est la voie retenue, celle qu'empruntent
   `renault-api`, l'intégration Renault de Home Assistant et evcc.

## Ce que le plugin fait, et ce qu'il ne fait pas encore

**Phase 1 (2026-09-14) : lecture seule.** Un véhicule = un appareil `vehicle` identifié par son VIN.
Publié : charge (`soc`), autonomie, câble et charge en cours, limite de charge, position GPS datée,
kilométrage, température **intérieure**, et `readAt`. Capacités déclarées : `soc`, `range`,
`location` — ni `lock` ni `charging`, l'UI ne propose donc pas ce que le plugin refuserait.

> **Corrigé le 2026-10-01** : `charging` est désormais déclarée (démarrage de la charge, arrêt par la borne),
> cf. la dernière section de la page. `lock` reste absente.

*(Dépassé du 2026-09-14 au 2026-10-01 : au-delà de `vehicle.refresh`, le plugin accepte aussi des commandes d'écriture — capacités `charge_limit`, `charging` et `climate_precondition`, voir `CAPABILITIES` dans `apps/server/src/plugins/renault/mapping.ts` ; voir « Mise à jour 2026-09-14 (bis) », « Mise à jour 2026-09-14 (ter) » et « Mise à jour 2026-10-01 ». `lock` reste absente.)*

La seule commande acceptée est **`vehicle.refresh`** (relire maintenant). Elle n'est pas un luxe :
la capacité `soc` fait apparaître le bouton « Actualiser » dans la vue Véhicules, et un bouton que
le plugin refuserait est précisément ce que ce projet évite.

Il n'existe **rien en local** : tout passe par le cloud du fabricant.

## Trois contraintes de cette API, et ce qu'elles imposent

### 1. Un mot de passe, pas un OAuth

Gigya n'offre aucune connexion déléguée à un tiers. Décision prise avec l'utilisateur : **le mot de
passe est saisi depuis l'UI, jamais dans `.env`**. Il traverse le serveur une seule fois
(`POST /api/plugins/renault/login`), n'est ni journalisé ni écrit ; seul survit le `login_token`
rendu par Gigya (`RENAULT_SESSION_FILE`). Un test vérifie nommément qu'il ne se retrouve nulle part
dans ce qui est gardé.

Deux jetons à ne pas confondre : le **login token** (durable, c'est lui qu'on garde) et le **JWT**
(15 minutes, c'est lui que Kamereon accepte).

**Piège central : Gigya répond TOUJOURS en HTTP 200.** Mot de passe faux, session périmée, double
authentification en attente — tout arrive en 200 avec un `errorCode` dans le corps. Un client qui ne
regarde que le statut croit avoir réussi à chaque fois. Trois codes sont traduits :
`403042` identifiants refusés, `403005` session périmée (→ `needs_pairing`), et **`403101` double
authentification** : un compte qui l'active **ne peut pas être relié**, et le message le dit
plutôt que de laisser croire à une faute de frappe.

### 2. Des clés d'API que Renault fait tourner sans prévenir

Les points d'entrée et clés de `fr_FR` (Gigya `accounts.eu1.gigya.com`, Kamereon
`api-wired-prod-1-euw1.wrd-aws.com`) ont des défauts **dans le code** mais sont **surchargeables par
l'environnement** (`RENAULT_GIGYA_URL`, `RENAULT_GIGYA_API_KEY`, `RENAULT_KAMEREON_URL`,
`RENAULT_KAMEREON_API_KEY`). Ce n'est pas du zèle : **Renault les a changées en mai 2026**, mettant
en panne le même jour toutes les intégrations tierces qui les avaient en dur. Une clé neuve se pose
dans `.env` sans toucher au code.

### 3. Un débit serré, et resserré

Renault tolère en pratique **60 appels par heure** (valeur retenue par les autres intégrations, et
resserrée fin 2025). Le client tient un **seau à jetons** (`RENAULT_RATE_PER_HOUR`, 60) et **refuse
lui-même** avant d'appeler, plutôt que d'attendre le 429.

Le sondage (`RENAULT_POLL_MS`, **10 min** comme Tesla) fait **cinq lectures par véhicule**, soit une
trentaine d'appels par heure. La liste des véhicules n'est **pas** relue à chaque tour : contrairement
à Tesla il n'y a pas de veille à surveiller. Un échec de tour ne déclenche **pas** de reprise serrée
(`createBackoff` calé sur l'intervalle) : le débit est la ressource rare.

*(Dépassé le 2026-10-01 : six lectures par véhicule, `ev/settings` étant lu à chaque tour, soit 36 appels par heure au défaut de 10 min — voir « Mise à jour 2026-10-01 — la climatisation dans le panneau commun ».)*

## La capture du 2026-09-14, et ses quatre surprises

Le compte a été relié le jour même, et `GET /api/plugins/renault/raw` a sondé **onze lectures** — y
compris celles qu'on s'attendait à voir refusées, car savoir ce que la voiture refuse vaut autant que
savoir ce qu'elle donne. Les fixtures de `__fixtures__/kamereon.ts` **sont cette capture**,
anonymisée (VIN, plaque, identifiants de compte, position).

| Lecture | Adaptateur | Réponse de la R5 |
|---|---|---|
| `battery-status` | kca v2 | `batteryLevel`, `batteryAutonomy`, `plugStatus`, `chargingStatus`, `chargingRemainingTime` |
| `cockpit` | kca **v1** | `totalMileage`, `fuelQuantity: 0` |
| `location` | kca v1 | `gpsLatitude`, `gpsLongitude`, `lastUpdateTime` |
| `hvac-status` | kca v1 | `internalTemperature`, `hvacStatus`, `socThreshold` |
| `ev/soc-levels` | **kcm** v1 | `socMin`, `socTarget` |
| `ev/settings` | **kcm** v1 | réglages de charge complets + programmes |
| `charging-settings`, `charge-mode` | kca v1 | **403 `err.func.wired.forbidden`** |
| `lock-status`, `pressure`, `res-state` | kca v1 | **404 `err.func.wired.notFound`** |

> **Portée corrigée le 2026-09-19** : ces onze sondes sont **toutes des LECTURES**. En conclure que
> l'adaptateur `kca` refuse aussi les **actions** était un saut que rien dans la capture ne portait —
> `actions/hvac-start` répond 200. Voir « Une R5 endormie ne se réveille pas par l'API » plus bas.

Les quatre surprises :

1. **`cockpit` en v2 répond un HTTP 200 SANS données**, avec un mot d'esprit à la place :
   `{"message": "you should not be there but well done for the effort"}`. C'est la **v1** qui porte
   le kilométrage. Le piège « champ documenté mais toujours vide » du wiki, en version farceuse — et
   sans la capture on aurait eu un kilométrage silencieusement absent.
2. **Les refus ont DEUX saveurs** : 403 « interdit » pour les réglages de charge, 404 « inconnu »
   pour verrouillage, pression et démarrage à distance. `isEndpointUnavailable` (`client.ts`)
   reconnaît les deux ; n'avoir prévu que le 403 aurait fait redemander trois lectures toutes les
   dix minutes, pour toujours la même réponse.
3. **`hvac-status` donne la température INTÉRIEURE** (`internalTemperature`), pas l'extérieure.
   Donc `insideTempC` oui, `outsideTempC` jamais.
4. **Une personne a plusieurs comptes Kamereon** : `MYRENAULT` (les services connectés, qui possède
   les véhicules) et `SFDC` (la fiche client Salesforce, sans véhicule). Le plugin choisit
   explicitement le type `MYRENAULT` ; « le premier de la liste » aurait pu tomber sur le CRM et
   rendre une liste vide sans erreur claire.

Ce que la R5 ne donne **pas** du tout, et qui reste donc absent de l'état : verrouillage, puissance
de charge instantanée, cap, pression des pneus, vitesse et rapport, température extérieure, veille.

### `chargingStatus` est un flottant, pas un booléen

`0.0` pas en charge, `0.1` en attente d'une charge programmée, `0.2` charge terminée, **`0.3` en
attente de la charge courante**, `0.4` trappe ouverte, `1.0` charge en cours. Seul `1.0` est
« en charge ». `plugStatus` vaut `1` branché, `0` débranché, `-1` erreur, `-2147483648` inconnu.

`0.3` avec un câble branché est l'état constaté à la capture — et c'est l'état où la R5 se coince
(voir ci-dessous).

> **Corrigé le 2026-09-19 : `chargingStatus` MENT, et « seul `1.0` est en charge » ne tient plus.**
> Voiture en charge, plusieurs kW mesurés à la borne et par l'onduleur, elle a servi des heures durant un
> `0.3` dans des trames par ailleurs fraîches et exactes. Le plugin croise donc désormais avec un
> second témoin de la MÊME trame — détail dans la mise à jour du 2026-09-19 (bis) en bas de page.

## Le réveil de charge solaire : le problème, et la recette

Demande de l'utilisateur, **à faire en phase 2**. *(Dépassé le 2026-09-14 : fait — voir « Mise à jour 2026-09-14 (bis) — le réveil de charge est implémenté ».)* Une borne alimentée par le surplus
photovoltaïque Enphase voit sa puissance s'interrompre et reprendre au gré des nuages. **La R5 ne
reprend pas la charge toute seule** après une coupure — bug Renault non corrigé depuis plus d'un an,
documenté sur le forum communautaire du constructeur ; une Tesla, elle, reprend sans problème. Le
contournement manuel est de verrouiller/déverrouiller la voiture à la télécommande, ce qui la
réveille.

**evcc a le même problème et le règle** depuis sa version 0.204.1, avec `wakeupmode: MY24` (*Model
Year 2024*, la génération de la R5). Le mécanisme est contre-intuitif :

- `charge/pause-resume` (kcm), la commande évidente, répond **403** sur cette plateforme ;
- ce qui réveille la voiture est de **RÉÉCRIRE LES RÉGLAGES VE** :
  `POST .../kamereon/kcm/v1/vehicles/{vin}/ev/settings`. Ce n'est pas une commande qui la réveille,
  c'est une écriture de réglages — son boîtier télématique doit la prendre en compte. C'est le
  pendant numérique du coup de télécommande. (Le *quoi* est établi ; le *pourquoi* est une déduction.)

> **Corrigé le 2026-09-19** : ce `POST` n'est **pas** une écriture de réglages. Il rend
> `{ commandId, type: 'HVAC_CHARGE_SYNCH', status: 'CREATED' }` — une **commande déposée** que le
> boîtier applique à sa prochaine connexion, ou jamais s'il dort. Et le corollaire de la ligne
> ci-dessous (« c'est l'écriture qui réveille, son contenu importe peu ») est tombé aussi : le 409
> qui refuse l'écriture ne parle pas de la charge utile, mais d'une **cadence**. Détail dans la mise
> à jour du 2026-09-19 en bas de page.

**Nuance qui compte** : evcc envoie des valeurs **codées en dur** (départ 21:00, durée 1615, 20 °C,
`programs: []`). Les réglages réels du véhicule de référence sont tout autres (heure, durée, température,
programme inactif). Rejouer la recette d'evcc **écraserait les réglages de l'utilisateur à chaque
réveil**. Le plugin devra relire `ev/settings` et le **réécrire à l'identique**, seul l'horodatage
changeant. C'est pour cela que `ev/settings` est lu par le relevé brut alors que le mappage l'ignore.

*(Dépassé le 2026-09-14 : le plugin relit et réécrit `ev/settings` à l'identique pour le réveil de charge — voir « Mise à jour 2026-09-14 (bis) — le réveil de charge est implémenté ». Il est désormais lu à chaque tour, voir « Mise à jour 2026-10-01 ».)*

## Routes propres

| Route | Rôle |
|---|---|
| `GET /api/plugins/renault/status` | mise en route pour la carte des Réglages (compte lié, comptes Kamereon, véhicules, cadence, débit) — jamais un secret |
| `POST /api/plugins/renault/login` | `{ email, password }` → jeton de session ; le mot de passe n'est ni gardé ni journalisé |
| `POST /api/plugins/renault/logout` | efface le jeton de session |
| `GET /api/plugins/renault/raw` | relevé brut : la fiche détaillée du véhicule et les onze lectures sondées, échecs RENDUS (et non levés) avec leur `unavailable` |

`health()` : `needs_pairing` sans compte lié ; `degraded` sur la dernière erreur ; `ok` avec
« n vehicle(s), read-only ».

*(Dépassé le 2026-09-14 : quand le sous-item de réveil de charge est coché, le détail est `charge wake-up HH:MM-HH:MM` à la place de `read-only` — `apps/server/src/plugins/renault/index.ts`.)*

## Côté web

- **`RenaultLinkCard.vue`** (Réglages) : un formulaire identifiant + mot de passe, précédé de ce
  qu'il advient du mot de passe. Une fois le compte lié, la carte montre les véhicules et propose de
  délier. Masquée pour un plugin éteint.
- **`VehiclesView.vue`** : la R5 s'affiche à côté de la Tesla. Les cases sans valeur disent « — »
  (verrouillage, mouvement, pneus, température extérieure). **La pastille de veille disparaît**
  quand le fabricant n'a pas cette notion : un soleil suivi d'un tiret se lirait « éveillée :
  inconnu ». L'absence est stable, rien ne bouge pour autant.
- **Renommage** : la voiture s'appelle par défaut de sa plaque (`registrationNumber`) — le **surnom
  de l'appli MY Renault n'est exposé nulle part** dans l'API, ni par la liste des véhicules ni par la
  fiche `/details`. Un crayon sur la carte véhicule écrit donc un nom dans la MAISON
  (`house.devices[].name`), cf. `../2_maison/2_0_format-house-json.md`.

## Ce que ce plugin a changé dans le contrat et la maison

Deux champs sont devenus **optionnels**, tous deux pour la même raison — ne pas mentir faute de
savoir :

- **`locked`** dans l'état `vehicle` : la R5 répond 404 sur `lock-status`. Même arbitrage que la
  `position` d'un ouvrant. Détail dans `../1_architecture/1_1_contrat-appareils.md`.
- **`position`** dans `houseDeviceSchema` : une voiture est connue de la maison (elle peut y porter
  un nom) sans occuper de point de la scène 3D. Détail dans
  `../2_maison/2_0_format-house-json.md`.

## Fragilités assumées

Usage non prévu par les conditions du constructeur, comme toute API privée. Clés rotées sans
préavis. Débit susceptible d'être resserré à nouveau. Endpoints qui apparaissent ou disparaissent
avec les mises à jour logicielles du véhicule — d'où la liste `unavailable` **vidée au redémarrage**
plutôt que gardée sur disque.


### Mise à jour 2026-09-14 (bis) — le réveil de charge est implémenté

Ce que la section « Le réveil de charge solaire » annonçait pour la phase 2 existe maintenant.

**Le sous-item `charge_wake`** (« Réveil de charge », coché par défaut) le commande : il ÉCRIT dans
la voiture, l'utilisateur doit donc pouvoir le couper depuis l'interface sans toucher au serveur.
C'est aussi pourquoi `health().detail` ne dit plus « read-only » mais
« n vehicle(s) · charge wake-up 08:00-20:00 » quand il est actif : c'est la seule ligne où cela se
voit.

**Quatre conditions, toutes nécessaires** (`maybeWake`, `index.ts`) : le sous-item est coché ; on
SAIT que la voiture est branchée et qu'elle ne charge pas (`pluggedIn === true && charging === false`
— un champ manquant n'autorise rien) ; l'heure locale tombe dans `RENAULT_WAKE_FROM`–`RENAULT_WAKE_TO`
(8 h–20 h) ; le dernier réveil du même VIN remonte à plus de `RENAULT_WAKE_EVERY_MS` (15 min).

**La fenêtre horaire n'est pas du confort.** La nuit, une voiture branchée qui ne charge pas attend
le plus souvent SA charge programmée : la secouer serait se
battre contre le réglage de l'utilisateur. Bornes égales = jamais, c'est l'autre façon de couper la
fonction. Une fenêtre à cheval sur minuit (`22:00`–`06:00`) est acceptée.

**La charge utile est celle de la voiture** (`wakePayload`, pur) : `ev/settings` est RELU puis
réécrit à l'identique, seul `lastSettingsUpdateTimestamp` change — *dans la charge utile qu'on
envoie* ; côté voiture il ne bouge, lui, qu'une fois la commande appliquée (2026-09-19). Les valeurs codées en dur d'evcc
(21:00, 1615, 20 °C, `programs: []`) écraseraient l'heure de départ, la durée, la température et le
programme de charge choisis DANS la voiture. Un test le verrouille champ par champ.

Ce que le plugin ne fait toujours pas, et n'a pas besoin de faire : **voir le surplus solaire**.
Aucun moteur d'automatisation ne relie encore deux plugins, et « branchée et pas en charge » est
exactement ce que l'utilisateur constate avant d'aller secouer la voiture à la télécommande.

Un réveil qui échoue est journalisé et **ne fait pas perdre la lecture** : l'état est publié avant.


### Mise à jour 2026-09-14 — capture EN CHARGE : la R5 ne dit pas sa puissance, et le confirme

La première capture avait été prise **branchée sans courant délivré** (`chargingStatus: 0.3`), ce
qui laissait une question ouverte : l'absence de `chargingInstantaneousPower` venait-elle du véhicule
ou de l'état ? Un relevé `GET /api/plugins/renault/raw` pris le 14/09, **voiture en charge**
(`chargingStatus: 1`, `plugStatus: 1`), tranche : `battery-status` ne porte toujours aucune
puissance instantanée. Ce n'est pas un effet de l'état, c'est le véhicule.

La fixture `BATTERY_CHARGING` est désormais **cette capture** (elle était synthétisée à partir de
celle à l'arrêt), et la bizarrerie n° 5 en tête de `kamereon.ts` le note.

Ce que la même capture apporte :

- **`chargingRemainingTime: 43`, et FRAIS** — son `chargingRemainingTimeLastUpdateDateTime` vaut le
  `timestamp` de la lecture, là où la capture à l'arrêt le datait de l'avant-veille. D'où la règle du
  mappage : le temps restant n'est publié que **pendant** la charge, et effacé (`null`) sinon.
- **`socMin: 20`** était là depuis le début dans `ev/soc-levels`, à côté du `socTarget` déjà lu :
  c'est le plancher de charge voulu par l'utilisateur, publié comme tel.
- **`meta.manufacturer: 'Renault'`** — le descripteur n'en portait aucun, et l'UI retombait sur l'id
  du plugin (« renault » en minuscule sous le nom de la voiture). Écrit en dur : les libellés du
  constructeur, eux, CRIENT (`brand.label` = « RENAULT »).

La **puissance de charge** manquante est désormais estimée à l'affichage, à partir du temps restant
et d'une capacité de batterie saisie par l'utilisateur — pas ici. Un premier jet l'avait mise dans ce
plugin, avec une variable `RENAULT_BATTERY_KWH` ; les deux ont été retirés le jour même (voir
`../1_architecture/1_1_contrat-appareils.md`) : l'API ne donne pas la capacité, ce n'est donc pas
une configuration du plugin mais une valeur de la maison.

### Mise à jour 2026-09-14 — cinquième condition du réveil de charge : la limite atteinte

`maybeWake` n'avait que quatre conditions, et il manquait la plus fréquente. **Une voiture pleine
est le cas ordinaire d'une voiture branchée qui ne charge pas** : chaque nuit après sa charge, puis
toute la journée suivante. Avec les valeurs par défaut (fenêtre 08:00–20:00, un réveil au plus tous
les quarts d'heure), la R5 à 80 % sur une cible de 80 % se faisait réécrire ses réglages VE jusqu'à
**48 fois par jour**, pour rien — et ce réveil ÉCRIT dans la voiture.

```ts
const target = patch.chargeLimit
if (patch.soc !== undefined && target != null && patch.soc >= target) return
```

L'arbitrage diffère de celui des deux autres champs, et c'est délibéré : `pluggedIn` et `charging`
manquants **interdisent** tout (« un champ manquant n'autorise rien »), tandis qu'un niveau ou une
cible inconnus **n'empêchent pas** le réveil — ne pas connaître la cible ne prouve pas que la charge
est finie, et « branchée et pas en charge » reste le signe que la fonction existe pour rattraper.

Pas de marge non plus : à 79 % sur une cible de 80 %, il reste un point à mettre, le réveil garde son
sens. Le journal du réveil porte maintenant le niveau et la cible, pour qu'un réveil inutile se
relise après coup.

Sources : `apps/server/src/plugins/renault/{index,mapping}.ts`,
`apps/server/src/plugins/renault/__fixtures__/kamereon.ts`, tests `mapping.test.ts` et
`plugin.test.ts`.

### Mise à jour 2026-09-14 (ter) — `ev/soc-levels` s'ÉCRIT : la cible de charge se règle

Deuxième écriture connue de cette plateforme, après `ev/settings` (le réveil de charge) : un
**`POST` sur `.../kamereon/kcm/v1/vehicles/{vin}/ev/soc-levels`** change la **cible de charge**.
Essayé sur la vraie R5 le 2026-09-14 — plusieurs valeurs successives, chacune relue depuis la voiture.
C'est d'autant moins évident que `charging-settings` et `charge-mode` (kca) répondent **403** sur ce
véhicule : le refus des réglages de charge ne s'étend pas aux niveaux VE.

Le plugin accepte donc **`vehicle.set_charge_limit`** et déclare la capacité **`charge_limit`**
(`CAPABILITIES` dans `mapping.ts`, l'ancien `PHASE_1_CAPABILITIES` — la lecture seule n'est plus la
règle). Même précaution que pour le réveil : les niveaux sont **RELUS**, seul `socTarget` change,
horodatage rafraîchi (`socTargetPayload`, pure et testée). Le **plancher `socMin` est le réglage de
l'utilisateur fait DANS la voiture** : le réécrire avec une valeur inventée le lui prendrait.

**Le piège de cette écriture** : Kamereon relit l'**ANCIENNE valeur** pendant une dizaine de
secondes. Une relecture immédiate après l'écriture rend donc la cible précédente, et une UI qui s'y
fierait afficherait un échec là où tout s'est bien passé. D'où `emitState({ chargeLimit })` tout de
suite après le POST : le prochain tour de sondage confirmera.

À noter pour le réveil de charge : sa cinquième condition (« la limite est atteinte ») se lit sur
cette même cible. Baisser la cible sous le niveau courant éteint donc le réveil, ce qui est le
comportement voulu — la voiture est pleine au sens où l'utilisateur vient de le décider.

> **Corrigé le 2026-10-01** : `CAPABILITIES` ne se limite plus à la cible de charge. Elle porte aussi
> `climate_precondition` et `charging` ; la phrase « la seule chose qu'elle laisse changer » (commentaire de
> `mapping.ts` à l'époque) n'est plus vraie.

Sources : `apps/server/src/plugins/renault/{index,client,mapping}.ts`, tests `mapping.test.ts` et
`plugin.test.ts`, essai sur le vrai véhicule le 2026-09-14.

### Mise à jour 2026-09-15 — la teinte, cachée dans l'URL des rendus

Renault ne nomme la couleur **nulle part** : ni `vehicleDetails`, ni `/details`, qui pourtant
étiquettent en clair la batterie, l'autoradio et la boîte de vitesses. Elle est pourtant là.

`vehicleDetails.assets[]` contient sept rendus du véhicule **dans sa configuration**, faits à la
demande par `3dv.renault.com/ImageFromBookmark`. Le paramètre `configuration` de l'URL liste les
codes d'usine, et le code `TE<teinte>` porte la peinture de caisse. Il est doublé de `TP<teinte>` (boucliers) et
`TS<teinte>` (rétroviseurs) — trois fois le même code, donc bien la teinte, que l'image rendue confirme.

**Aucun appel supplémentaire** : ces `assets` sont dans la liste des véhicules que la découverte lit
déjà. `bodyColor()` décode l'URL, découpe sur `/` et cherche le premier code `TE…`.

La table `PAINT` ne contient QUE des codes vérifiés sur une voiture réelle — une seule entrée à ce
jour. Un code inconnu ne publie **rien** : la scène retombe sur sa couleur de thème et l'utilisateur
règle à la main, ce qui vaut mieux qu'une couleur inventée. La différence avec Tesla est
délibérée : là-bas un nom lisible (un nom d'usine) dit de quelle couleur il s'agit et s'approche
sans risque ; ici un code opaque ne dit rien tant qu'une voiture ne l'a pas prouvé.

Renault ne dit rien de l'ASPECT de la peinture (`meta.vehicle.finish` reste absent), là où Tesla le
donne — voir `3_8_tesla.md`.

> Les autres points de vue s'obtiennent en changeant `bookmark=` dans l'URL : `EXT_34_AV`,
> `EXT_34_DESSUS`, `EXT_LEFT_SIDE`, `EXT_RIGHT_SIDE`.

Sources : `apps/server/src/plugins/renault/mapping.ts`, `apps/server/src/plugins/renault/types.ts`,
`apps/server/src/plugins/renault/__fixtures__/kamereon.ts`.

### Mise à jour 2026-09-19 — la journée de surplus perdue : le POST est une COMMANDE, et une voiture endormie ne se réveille pas

**Le symptôme, tel que l'utilisateur l'a vu** : la R5 branchée, du surplus solaire
disponible, et aucune charge qui démarre — exactement le cas que le réveil de charge est censé
rattraper. Diagnostic mené sur le vrai véhicule et le vrai serveur. Il en ressort quatre faits, dont
trois **corrigent** ce que cette page affirmait, et un défaut de conception qui les dépassait tous.

#### 1. `POST ev/settings` n'est pas un enregistrement, c'est une commande

La réponse, jusqu'ici jetée par le plugin :

```json
{ "commandId": "ba6a5b31-…", "type": "HVAC_CHARGE_SYNCH", "status": "CREATED" }
```

`CREATED`, pas `APPLIED`. La commande est **déposée** chez Kamereon ; elle n'atteint la voiture que
lorsque son boîtier télématique se reconnecte, et `lastSettingsUpdateTimestamp` ne bouge pas avant.
Ce que la section « Le réveil de charge solaire » présentait comme une **écriture de réglages** est
donc une **file d'attente** : le plugin croyait avoir agi alors qu'il avait seulement posté une
lettre. `commandSummary()` (`mapping.ts`) en fait une ligne lisible — `type status commandId` — et
c'est la seule chose qui dise ce qu'est devenu un réveil.

#### 2. Le 409 `err.func.vcps.ev.post-settings.error` veut dire « une commande est déjà en attente »

Chronologie mesurée le jour même (instants relatifs), chaque ligne étant un vrai appel :

| Instant | Corps envoyé | Réponse |
|---|---|---|
| t | celui du plugin (réglages relus) | **409** |
| t + 6 min | corps allégé | **OK** — commande créée |
| t + 7 min | celui du plugin | **409** |
| t + 7 min (1 s plus tard) | **le corps qui venait de passer 40 s plus tôt** | **409** |
| t + 18 min | corps avec `programs: []` (la recette evcc) | **409** |

La quatrième ligne tranche : **ce n'est ni la forme ni le contenu de la charge utile**, c'est une
**cadence minimale entre deux commandes**. L'hypothèse de départ — « une réécriture à l'identique
serait un no-op côté Renault, d'où le `programs: []` d'evcc qui force un changement » — a donc été
**testée et infirmée**. Elle était séduisante et elle est fausse : inutile de la reprendre.

Conséquence dans le code : `isDeferred()` (`client.ts`) sépare **« pas maintenant »** de **« en
panne »**. Un 409 de ce code, comme un 429, est journalisé en `info` et rendu à l'UI comme un
report, pas comme une erreur.

#### 3. Une R5 endormie ne se réveille pas par l'API — c'est la conclusion centrale

Trois preuves convergentes, le même jour :

- `lastSettingsUpdateTimestamp` **figé** toute la journée, pendant que des commandes étaient
  créées avec succès ;
- `battery-status.timestamp` **figé**, c'est-à-dire des chiffres de trois heures d'âge ;
- et surtout **l'appli MY Renault elle-même affichait des données vieilles de trois heures** : l'outil
  officiel du constructeur n'y arrivait pas davantage.

La charge a démarré **instantanément** à l'appui sur la clé. Une fois le boîtier hors ligne, aucun
chemin réseau ne le rappelle.

**Ce que cela impose à la conception du réveil** : un réveil **périodique** toute la journée est la
mauvaise stratégie. Ce n'est pas « essayer souvent » qui gagne — dès que la voiture a décroché, la
journée est perdue quel que soit le nombre de tentatives. Ce qu'il faudrait, c'est réveiller **vite
après l'arrêt de la charge, tant que la voiture est encore en ligne**. Cette piste n'est **pas
implémentée** (voir « ce qui reste ouvert »).

#### 4. Les actions `kca` ne sont PAS interdites sur cette plateforme

Cette page l'affirmait — c'était faux, et c'est une erreur de raisonnement qui mérite d'être nommée.
Le relevé brut du 14/09 n'avait sondé **que des lectures** ; les 403 `err.func.wired.forbidden`
observés portaient sur les **lectures** `charging-settings` et `charge-mode`. On en avait déduit que
la famille d'endpoints entière était fermée.

Constaté :

```
POST /commerce/v1/accounts/{account}/kamereon/kca/car-adapter/v1/cars/{vin}/actions/hvac-start
{"data":{"type":"HvacStart","attributes":{"action":"cancel"}}}
→ HTTP 200  {"data":{"type":"HvacStart","id":"…"}}
```

C'est le **réveil historique d'evcc** : annuler un préconditionnement qui ne tourne pas ne fait rien
à la voiture, l'appel sert uniquement à la solliciter.

**Nuance honnête** : l'action a été **acceptée par le cloud**, rien ne prouve encore qu'elle
**réveille** la voiture — elle a été essayée sur un véhicule déjà hors ligne, sans effet visible.
Ce qui est établi, c'est seulement que la porte n'est pas fermée.

#### 5. Les actions ont leur propre quota, bien plus serré que les lectures

`actions/charging-start` envoyé **quatre minutes** après `hvac-start` → **HTTP 429**, alors qu'une
lecture `battery-status` juste après passait sans problème. Puis le **compte entier** a fini bloqué :
l'appli MY Renault annonçait « trop d'appels serveur, votre compte est bloqué pour une durée d'au
moins 1 h ». Le seau à jetons du client (60 appels/h) ne protège de rien ici : le budget est celui du
**compte**, pas du processus. Détail et piège complet dans `../6_faq/6_1_pieges-runtime.md`.

#### 6. Les deux bouts de la chaîne, enfin recoupés

Côté voiture : `chargingStatus: 0.3` — *waiting for current charge*, « j'attends du courant ». Côté
borne (Enphase IQ EV Charger 2, cloud seul, hors Kasbah — cf. `3_7_enphase.md`) : « le VE n'est pas
prêt ». La borne proposait donc le courant et **c'est la voiture qui refusait**. Le défaut de reprise
de la R5, décrit jusqu'ici d'après le forum du constructeur, est confirmé **des deux côtés** pour la
première fois.

Deux éléments de contexte, à ne pas confondre avec des faits établis :

- **Hypothèse de l'utilisateur** : une mise à jour logicielle du véhicule était annoncée dans
  l'appli ce jour-là, ce qui expliquerait le boîtier hors ligne depuis la mi-journée.
- Le **programme de charge actif** vu dans `ev/settings` avait été
  activé **à la main depuis l'appli** par l'utilisateur, comme test. Ce n'est pas Kasbah qui l'a
  écrit — un futur lecteur de fixture pourrait le croire.

#### Ce qui a été codé

Le défaut de fond n'est aucun des quatre faits ci-dessus : **pendant cinq heures, les réveils ont été
refusés sans que rien ne le montre hors de la console du serveur**, pendant qu'une journée de surplus
se perdait. C'est cela que ces changements corrigent.

- **`mapping.ts` — `readAt` porte l'horodatage de la VOITURE** (`battery-status.timestamp`) et non
  celui de notre appel. L'UI annonçait « lu il y a 4 min » au-dessus de chiffres vieux de trois
  heures. C'est une mise en conformité avec ce que le contrat dit déjà de `readAt` (« sur une API
  facturée et un véhicule qui dort, les valeurs ont un âge et l'UI doit le montrer ») — et, la R5
  n'ayant **aucune notion de veille** contrairement à Tesla, cet horodatage est le **seul signe
  qu'elle a décroché**. Voir `../1_architecture/1_1_contrat-appareils.md`.
- **`mapping.ts` — `commandSummary()`** : la commande rendue, résumée en une ligne, jamais levée.
- **`client.ts` — `isDeferred()`** : 409 `err.func.vcps.ev.post-settings.error` et 429 sont « pas
  maintenant », journalisés en `info`, et non des pannes.
- **`index.ts` — `WakeOutcome`** (`sent` / `deferred` / `failed` + détail), rendu par
  `GET /api/plugins/renault/status` (`lastWake`) et affiché par `RenaultLinkCard.vue` (clés
  `settings.renault.wakeSent` / `wakeDeferred` / `wakeFailed` ; teinte d'alerte réservée aux deux
  derniers). Le journal du réveil porte maintenant `command` et `dataAgeMs` — l'âge de la donnée au
  moment où on secoue la voiture est précisément ce qui manquait pour comprendre la journée.
- **Fixtures** : `SETTINGS_COMMAND` (réponse acceptée) et `SETTINGS_PENDING` (le 409) sont les
  réponses réelles du jour.

Suite verte : 1030 tests, lint et typecheck.

#### Ce qui reste ouvert

Deux décisions **reportées**, délibérément : on observe d'abord les nouveaux journaux dans les jours
qui viennent.

1. **Une sixième condition au réveil** : ne pas secouer une voiture dont la donnée a des heures —
   `readAt` la rend enfin mesurable, mais le seuil se choisit sur des relevés, pas à l'estime.
2. **`hvac-start` / `cancel` en réveil de première intention**, avant ou à la place de
   `POST ev/settings`. Séduisant (evcc l'emploie, et il n'a pas la cadence du 409), mais son effet
   réel sur cette voiture n'est pas démontré, et son quota d'action est nettement plus serré.

Sources : `apps/server/src/plugins/renault/{index,client,mapping}.ts`,
`apps/server/src/plugins/renault/__fixtures__/kamereon.ts`, tests `mapping.test.ts` et
`plugin.test.ts`, `apps/web/src/components/RenaultLinkCard.vue`,
`apps/web/src/i18n/locales/{fr,en}.json`, diagnostic sur le vrai véhicule le 2026-09-19.

### Mise à jour 2026-09-19 (bis) — `chargingStatus` ment, deux champs de la même trame le démentent

Quelques heures après le diagnostic ci-dessus, la voiture a été rebranchée et **chargeait pour de
bon** — plusieurs kW lus à la borne Enphase *et* par l'onduleur. Kasbah affichait « pas en charge ».
L'appli MY Renault aussi. Une lecture de `battery-status` tranche :

```jsonc
{
  "timestamp": "…T14:11:54Z",                              // FRAÎCHE, 5 minutes
  "batteryLevel": 73,                                      // monte d'une lecture à l'autre
  "plugStatus": 1,
  "chargingStatus": 0.3,                                   // « en attente de courant » — FAUX
  "chargingRemainingTime": 52,
  "chargingRemainingTimeLastUpdateDateTime": "…T14:11:54Z" // daté de la trame elle-même
}
```

Ce n'est donc **ni** une donnée périmée (la trame a cinq minutes), **ni** un défaut de liaison, **ni**
un mauvais mappage : dans une seule et même réponse, le constructeur sert un niveau qui grimpe, un
temps de charge restant rafraîchi à l'instant, et un `chargingStatus` qui prétend que rien ne se
passe. **C'est le champ qui est faux.**

Pourquoi l'appli du fabricant se trompe pareillement : elle lit `chargingStatus` et lui seul. Les
deux autres témoins sont pourtant sous ses yeux, dans la même trame — elle ne les croise pas. Kasbah
est donc, sur ce point précis, **plus juste que l'application officielle**.

#### La règle retenue : un second témoin

`isCharging()` (`mapping.ts`, pure et testée) : `chargingStatus === 1.0` reste le oui franc ; à
défaut, un **`chargingRemainingTime` daté de la trame elle-même** vaut oui. Ce second témoin n'est
pas une trouvaille du jour — la capture du 14/09 avait déjà établi que ce champ **traîne** hors
charge (rendu daté de l'avant-veille sur une voiture à l'arrêt) et n'est rafraîchi que pendant une
charge. Il dormait dans le mappage, qui s'en servait pour EFFACER le temps restant ; il sert
maintenant aussi à savoir qu'on charge.

**Ce que la règle ne couvre pas**, et c'est dit pour qu'on sache où revenir : une voiture qui
attendrait une charge PROGRAMMÉE en rafraîchissant quand même son estimation serait annoncée « en
charge » à tort. Un seul contre-exemple est connu (14/09, branchée en attente, temps restant vieux
de deux jours) et il va dans le bon sens — mais un seul.

#### Ce que cela change pour le réveil de charge

`maybeWake` exige « branchée ET pas en charge ». Avec un `chargingStatus` menteur, il **secouait une
voiture déjà en train de charger** — en brûlant le quota d'actions, pour un état qui n'avait pas
lieu d'être rattrapé. Le second témoin corrige cela sans toucher à la condition.

Et il rouvre la question de la sixième condition sous un meilleur jour : le démenti le plus solide
n'est pas l'âge de la donnée, c'est **la consommation de la maison**. Kasbah voit les kilowatts que
Renault ne voit pas. C'est la première raison vraiment fondée de relier deux plugins, là où la page
notait jusqu'ici qu'« aucun moteur d'automatisation ne relie encore deux plugins ».

Fixture : `BATTERY_CHARGING_LIAR` est cette trame, telle quelle. Sources :
`apps/server/src/plugins/renault/mapping.ts` (`isCharging`), `mapping.test.ts`,
`apps/server/src/plugins/renault/__fixtures__/kamereon.ts`.

### Mise à jour 2026-10-01 — la climatisation dans le panneau commun

Le plugin déclare `climate_precondition` et `meta.vehicle.climate` (`CLIMATE_FEATURES`, `mapping.ts`) :
sièges avant et volant en marche / arrêt, **réglables clim éteinte** (`heatWhileOff`), consigne 16-26 °C
au degré. Les bornes sont une **hypothèse** : l'appli ne les montre pas, à corriger au premier refus.
D'après les captures de l'appli MY Renault, la R5 offre :

- **« climatiser »** maintenant, 10 min au plus : `POST kca .../actions/hvac-start`,
  `{ data: { type: 'HvacStart', attributes: { action: 'start', targetTemperature } } }`, et `cancel`
  pour arrêter. C'est une ACTION, au quota serré (cf. le 429 du 2026-09-19). La réponse est une
  commande déposée, pas un effet : une relecture 60 s plus tard constate `hvacStatus` (`on` / `off`
  → `climateOn`).
- **consigne, siège conducteur, volant, siège passager**, « communs à tous les programmes » : ce sont
  les champs `preconditioningTemperature` et `preconditioningHeated{LeftSeat,RightSeat,StrgWheel}` de
  `ev/settings`. `vehicle.climate_set` les relit puis les réécrit À L'IDENTIQUE, seuls les champs
  nommés changeant (`climateSettingsPayload`), comme le réveil de charge. Conduite à gauche : le
  siège GAUCHE est `fl`. `ev/settings` est désormais lu à chaque tour (six lectures, 36 / h au défaut
  de 10 min).
- **batterie faible** : `hvac-status.socThreshold` (15 % à la capture) dit sous quel niveau la voiture
  refuse ; Kasbah refuse alors en `LOW_BATTERY` SANS dépenser l'action.

**Pas encore essayé sur la vraie voiture.** Questions ouvertes : l'action `start` est-elle prise sur
cette plateforme (seul `cancel` a été vu accepté, le 2026-09-19) ? la réécriture de `ev/settings`
retombe-t-elle sur le même 409 de cadence que le réveil (`err.func.vcps.ev.post-settings.error`) ?
Les **programmes de départ** (heure, jours, clim exécutée par la voiture elle-même) ne sont pas faits.

Sources : `apps/server/src/plugins/renault/{index,client,mapping}.ts`, tests `mapping.test.ts` et
`plugin.test.ts`, captures de l'appli MY Renault fournies par l'utilisateur le 2026-10-01.

### Mise à jour 2026-10-01 — lancer la charge, et l'arrêter par la borne

**Pas encore essayé sur la vraie voiture** : le code et ses tests (`mapping.test.ts`, `plugin.test.ts`,
`chargeCoordination.test.ts`) passent, l'essai réel reste à faire par l'utilisateur.

**Pourquoi.** Le bouton « Lancer la charge » de la vue Véhicules doit marcher aussi pour la R5, qui
n'avait jusqu'ici aucune commande de charge (`charge/pause-resume` répond 403, cf. le diagnostic du
2026-09-19). La voie vient de `renault-api` (hacf-fr), table `_VEHICLE_ENDPOINTS["R5E1VE"]` :

- `actions/charge-start` y est `actions/charge-start-via-settings`, soit `POST kcm/v1/vehicles/{vin}/ev/settings`
  en mode `kcm-settings` (ticket n°1348 de renault-api, « analyse du comportement de l'appli MyRenault ») ;
- `actions/charge-stop` y est `None`, avec le commentaire « Not supported - use charger to stop ».

**La recette du démarrage** (`chargeStartPayload`, `mapping.ts`, pure et testée, rend `{ body, deactivated }`) :
relire `ev/settings`, passer **tous** les programmes de charge à `programActivationStatus: false`, rejouer
le reste à l'identique, horodatage neuf. C'est la charge programmée qui fait attendre la voiture : sans
programme actif, rien ne la retient. `chargeModeRq` (`SCHEDULED` à la capture) n'est **pas** touché :
`renault-api` ne le touche pas et ses autres valeurs sont inconnues. **Question ouverte** si la voiture ne
charge pas après le POST : c'est le premier champ à suspecter.

**Décision de l'utilisateur (2026-10-01) : les programmes coupés ne sont PAS restaurés.** Les rallumer
couperait la charge en cours, puisque c'est leur activation qui la fait attendre. Le prix : après un
« Lancer la charge », les programmes de l'utilisateur restent éteints jusqu'à ce qu'il les rallume dans
l'appli MY Renault. Le journal dit combien l'étaient (`deactivatedPrograms`).

**Une commande déposée, pas un effet** (même leçon que le réveil, cf. 2026-09-19). Le plugin :

- relit `ev/settings` ; une réponse vide donne `UPSTREAM_ERROR`, rien n'est écrit ;
- poste ; un 409 `err.func.vcps.ev.post-settings.error` (commande déjà en attente) devient `RATE_LIMITED`
  « réessayer dans quelques minutes » : ce n'est pas une panne, mais rien n'est parti ;
- pose `lastWake` : c'est une écriture de réglages, le réveil de charge ne doit pas en reposter une
  derrière lui (il prendrait le 409) ;
- relit la voiture `CLIMATE_FOLLOW_UP_MS` (60 s) plus tard pour **constater** la charge.

**L'arrêt n'existe pas côté voiture.** Le plugin déclare désormais la capacité `charging` et
`meta.vehicle.stopViaCharger: true` (`toDescriptor`) : le serveur arrête la borne à sa place
(`../1_architecture/1_2_serveur-et-plugins.md`, même date). Un `vehicle.stop_charge` qui parvient quand même
au plugin n'a trouvé aucune borne unique en charge à la maison : il répond `UNSUPPORTED_COMMAND` avec un
message qui dit d'arrêter depuis la borne, plutôt que de feindre.

**Liste de contrôle de l'essai à venir.**

1. Borne Enphase en charge verte, R5 branchée : « Lancer la charge » ; la borne passe en charge, puis la
   voiture (1 à 2 minutes).
2. Dans l'appli MY Renault : le programme de charge est bien désactivé.
3. « Arrêter » : la borne s'arrête, et reste bloquée jusqu'au débranchement (`3_7_enphase.md`).
4. Si la voiture ne charge pas : regarder `chargeModeRq`, puis le 409 de cadence.

Sources : `apps/server/src/plugins/renault/{index,mapping}.ts` (`chargeStartPayload`, `toDescriptor`,
`CAPABILITIES`), `apps/server/src/core/chargeCoordination.ts`, `packages/shared/src/devices/descriptor.ts`,
tests `mapping.test.ts`, `plugin.test.ts`, `chargeCoordination.test.ts`, `renault-api` (hacf-fr,
`_VEHICLE_ENDPOINTS`).

### Mise à jour 2026-10-02 — le second témoin seul ne suffit plus : il faut que le niveau monte

**Ce qui s'est passé.** Le soir du 2026-10-02, la R5 branchée sur la borne en charge verte, pas
assez de soleil : rien ne passait (0 W à la borne). Kasbah l'affichait « en charge ». La trame que
Kamereon servait encore datait de **plusieurs heures** (la voiture dort, son boîtier se tait) :

```jsonc
{ "timestamp": "2026-10-02T…Z", "batteryLevel": 52, "plugStatus": 1,
  "chargingStatus": 0.3,                                     // « en attente de courant » : VRAI ce jour-là
  "chargingRemainingTime": 480,
  "chargingRemainingTimeLastUpdateDateTime": "2026-10-02T…Z" }  // daté de la trame
```

C'est exactement le trou que la section du 2026-09-19 (bis) annonçait : une voiture qui attend en
rafraîchissant quand même son estimation. Le second témoin (temps restant daté de la trame) l'a
déclarée en charge. Ce qui la distingue de la menteuse du 19/09 : **le niveau ne monte pas** (un point en
plus de deux heures), là où l'autre grimpait à chaque lecture.

**La règle devient** (`isCharging(battery, levelRising)`, `mapping.ts`) : `chargingStatus` 1.0 reste le
oui franc ; à défaut, le temps restant frais ne vaut oui que si le niveau monte. `trackLevel` /
`levelRising` (purs) suivent le niveau trame après trame, par VIN, dans le plugin : une hausse ne
compte que si elle tient en moins d'une heure entre deux trames (`LEVEL_RISE_WINDOW_MS`), et elle
vaut une heure de plus ; la même trame relue (voiture endormie) garde son verdict. Un point étalé
sur plus de deux heures n'est donc pas une charge.

**Ce que ça coûte** : après un redémarrage du serveur, ou au tout début d'une charge où
`chargingStatus` ment, « en charge » n'apparaît qu'à la première hausse d'1 % (quelques minutes à pleine puissance,
une vingtaine en mode sécurisé). Le réveil de charge (`maybeWake`) suit le même verdict.

**Second filet, côté serveur** : quand aucune borne de la maison ne charge, « en charge » est démenti
(`chargingRefuted`, `../1_architecture/1_2_serveur-et-plugins.md`, même date). Choix de l'utilisateur :
les deux.

**Vérifié sur la vraie maison le 2026-10-02** (commit b38b162) : même
trame, la R5 passe à `charging: false`, temps restant effacé, dès le premier sondage — par la
règle du plugin seule, le démenti des bornes n'a rien eu à faire. Conséquence attendue : branchée, pas
en charge, sous sa cible, le réveil de charge est reparti (`HVAC_CHARGE_SYNCH CREATED`) ;
le faux « en charge » le bloquait jusque-là. Piège du jour : un premier redémarrage tournait
encore sur l'ancien code, le dépôt principal n'ayant été mis à jour qu'après (le serveur
`npm run house` n'est pas en mode watch) — l'état gardait ses 480 min de temps restant, signe de
l'ancien mappage.

Fixture : `BATTERY_WAITING_FRESH_ETA`, la trame du 02/10 telle quelle. Sources :
`apps/server/src/plugins/renault/{index,mapping}.ts`, `mapping.test.ts`,
`apps/server/src/plugins/renault/__fixtures__/kamereon.ts`.
