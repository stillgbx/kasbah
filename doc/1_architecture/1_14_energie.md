# Énergie : mesures, historique et charge des véhicules

> Dernière mise à jour : 2026-10-31
> Sources : `packages/shared/src/devices/state.ts` (`energyStateSchema`, `evChargerStateSchema`), `packages/shared/src/devices/rules.ts` (`estimateChargePowerW`), `apps/server/src/core/history.ts`, `apps/server/src/core/chargeCoordination.ts`, `apps/server/src/core/plugin-host.ts` (`execute`, `onVehicleState`, `checkChargingClaim`), `apps/server/src/http/routes.ts` (`/api/devices/:id/history`, `/api/devices/:id/energy-days`), `apps/server/src/http/recentDays.ts`, `apps/server/src/plugins/enphase/days.ts` ; pages citées plus bas, `apps/server/src/app.ts` (historique écrit sur disque, 2026-10-31)

Page de synthèse, écrite au lint du 2026-10-13 : l'énergie était décrite par morceaux dans le contrat,
le serveur, les plugins Enphase, Tesla et Renault et la vue Énergie. Elle décrit l'état du code à cette
date et renvoie aux sections datées ; le détail (captures, pièges de chaque fabricant) reste là-bas.

## Ce que le contrat porte

| Kind | Ce qu'il dit | Qui le publie |
|---|---|---|
| `energy` | le bilan du site : `productionW` (jamais négatif), `consumptionW`, `gridW` (> 0 import, < 0 export), et en option `batteryW` (> 0 charge), `batterySoc`, les cumuls du jour | Enphase (passerelle locale), la simulation |
| `sensor` | un micro-onduleur (sa puissance), ou un module simulé, rattaché dans la simulation à l'installation par `SimDevice.partOf` | Enphase, la simulation |
| `ev_charger` | une borne : `status` (`disconnected` … `charging`, `finished`, `error`), `powerW`, `sessionWh`, intensité, `safeLimit` (repli sur l'intensité de sécurité) | Enphase (borne, par le cloud) |
| `vehicle` | niveau, limite de charge, `pluggedIn`, `charging`, `chargePowerW` quand le fabricant le donne, position | Tesla, Renault, la simulation |

Les champs de panneaux de la maison (`arrays`, positions dérivées, un onduleur par emplacement) sont
décrits dans [2_0 Format house.json](../2_maison/2_0_format-house-json.md) ; les kinds et capacités
dans [1_1 Contrat des appareils](1_1_contrat-appareils.md).

## Historique : en mémoire, à l'heure

`EnergyHistory` (`core/history.ts`) écoute le bus et range chaque état `energy` disponible dans un seau
par heure (moyenne des échantillons), **48 h** gardées, **sans base de données** : un redémarrage du
serveur repart de zéro. `GET /api/devices/:id/history?hours=` rend les points (`productionW`,
`consumptionW`, `gridW`, `samples`) ; l'outil MCP de l'historique d'un appareil passe par la même route.
Ce que la passerelle cumule elle-même (`todayProductionWh`, `todayConsumptionWh`) vient de l'état, pas de
cet historique. Voir [1_2 Serveur et plugins](1_2_serveur-et-plugins.md).

## Une estimation, une seule : la puissance de charge

Quand un véhicule charge sans dire sa puissance, `estimateChargePowerW` (`rules.ts`, règle pure) la
déduit : énergie qu'il reste à mettre (cible − niveau, sur la capacité de la batterie) divisée par le
temps restant que la voiture annonce. La capacité vient de la maison (`HouseDevice.batteryKwh`, saisie
par l'utilisateur) : **aucun fabricant ne la donne**. Rien ne s'affiche dès qu'un morceau manque, que la
voiture donne déjà sa puissance, que la charge touche à sa fin ou que le résultat sort des puissances
plausibles. Une capacité en variable d'environnement, essayée, a été retirée le jour même. Voir
[1_1 Contrat des appareils](1_1_contrat-appareils.md) et [3_9 Renault](../3_plugins/3_9_renault.md).

## Voiture et borne : la coordination de charge

Une voiture branchée sur une borne qui ne donne pas de courant ne charge pas, quoi qu'on lui demande :
une borne Enphase en « charge verte », sans soleil, laisse la voiture branchée sans rien faire. Le
serveur coordonne donc les deux, au même endroit pour l'interface, les automatisations et le MCP
(`PluginHost.execute`, règles dans `core/chargeCoordination.ts`) :

| Situation | Ce que fait le serveur |
|---|---|
| « Charger » une voiture branchée qui ne charge pas | force d'abord la borne (`ev_charger.start`, `chargerToForce`), puis envoie la commande à la voiture, même si la borne a échoué |
| La voiture d'une borne forcée atteint sa limite | la borne reprend son mode d'avant (`ev_charger.resume_mode`, `chargeLimitReached` : niveau ≥ cible **et** plus en charge) |
| « Arrêter » une voiture qui ne sait pas s'arrêter à distance (`meta.vehicle.stopViaCharger`) | arrête la borne à sa place (`chargerToStop`) ; rien ne part à la voiture, qui refuserait |
| Une voiture se dit en charge alors qu'aucune borne de la maison ne charge | l'état publié la dément (`chargingRefuted`) ; on retient ce qu'elle a dit, et on le rend dès qu'une borne charge |

**La prudence commune** : aucune borne ne dit quelle voiture est au bout de son câble. Le serveur n'agit
donc que si la voiture est branchée, à la maison (position inconnue : on la croit à la maison, sauf pour
le démenti, qui exige une position connue) et qu'**une seule** borne pilotable est dans l'état attendu.
Deux candidates : on ne devine pas. Le démenti ne vise pas un véhicule qui mesure sa propre puissance
(il sait mieux que la borne) ; il se trompe si la voiture charge sur une prise que Kasbah ne voit pas,
risque accepté.

**À savoir** : arrêter la borne Enphase la bloque jusqu'au débranchement, soleil ou pas. C'est un choix
de l'utilisateur, en connaissance de cause. Voir [3_7 Enphase](../3_plugins/3_7_enphase.md) (section
« Contradiction détectée 2026-10-02 — ARBITRÉE »), [3_8 Tesla](../3_plugins/3_8_tesla.md) et
[3_9 Renault](../3_plugins/3_9_renault.md) (réveil de charge solaire).

## À l'écran

- **Vue Énergie** : schéma de flux (seuil mesuré, anneau borné, « Inactif »), onduleurs à leur place,
  tuiles par voiture, échelle de temps écrite dans chaque bloc ; **vue Véhicules** : charge, limite,
  lancer / arrêter, attente qui tourne. Voir [4_4 Vues Énergie et Véhicules](../4_ui/4_4_vues-energie-vehicules.md).
- **Scène 3D** : modules photovoltaïques, jauge de bord d'un module, coffret de batterie et borne qui
  « soufflent » ce qu'ils font. Voir [1_12 Scène 3D : objets dessinés](1_12_scene-3d-objets.md).
- **Simulation** : panneaux simulés et exclusion en cascade (décocher l'énergie retire toute
  l'installation solaire). Voir [3_0 Simulation](../3_plugins/3_0_simulation-mock.md).

### Mise à jour 2026-10-25 — un historique journalier persistant, à côté de celui des 48 h

> Dépassé le 2026-10-25 : la section « Historique : en mémoire, à l'heure » ci-dessus reste vraie pour
> l'**heure** (`EnergyHistory`, 48 h, en mémoire), mais ce n'est plus le seul historique : un
> historique **par jour**, persistant, couvre la période depuis la mise en service.

Les vues Semaine, Mois, Année et Total de la vue Énergie ne peuvent pas se bâtir sur 48 h de seaux
horaires. Le site porte donc la capacité `energy_history` (kind `energy`) et sert ses totaux journaliers à
la demande par `GET /api/devices/:id/energy-days` (`deviceEnergyDaysSchema`, `packages/shared/src/protocol/http.ts`) :
`since`, `syncedAt`, `days[]` (production, consommation, import, export, charge, décharge, trois parts de
la maison, borne) et, facultatif, `inverters` (Wh par jour de chaque micro-onduleur). Un champ que la
source n'a pas rapporté est **absent**, jamais zéro. Un jour porte sa `source` (`vendor` : historique du
cloud ; `local` : mesuré par le serveur) et `partial` quand le serveur ne l'a pas vu en entier.

Deux principes, dont le détail (routes Enlighten, resynchro, fichiers d'état) est dans
[3_7 Enphase](../3_plugins/3_7_enphase.md) :
- **Des jours clés par date locale**, pas par instant : 23 ou 25 h aux changements d'heure.
- **Ce qui est exact, ce qui est approché** : production et consommation viennent des compteurs du jour de
  la passerelle ; réseau, batterie et parts de la maison sont intégrés depuis la puissance (10 s), donc
  approchés ; la borne vient de l'énergie de session. **Aujourd'hui reste toujours local.**

Le mécanisme est générique côté serveur (hook `energyDays?(externalId)` d'un plugin, relayé par
`PluginHost.energyDays`) ; seuls Enphase et la simulation le fournissent.

### Mise à jour 2026-10-26 — `inverters.devices[].peakW`

`deviceEnergyDaysSchema.inverters.devices[]` gagne `peakW?: (number | null)[]` : le plus haut point de
puissance du jour de chaque micro-onduleur, **indexé comme `wh`** (jour `from` + i, W, `null` = inconnu).
Absent quand la source ne garde pas de pics. Enphase le remplit depuis la série au quart d'heure du
cloud (moyenne sur 15 min, une seule source pour tous les jours : [3_7](../3_plugins/3_7_enphase.md)) ;
la simulation le dérive des Wh du jour ([3_0](../3_plugins/3_0_simulation-mock.md)). La vue Énergie en tire
le record par période ([4_4](../4_ui/4_4_vues-energie-vehicules.md)).

Sources : `packages/shared/src/protocol/http.ts`, `apps/server/src/plugins/enphase/inverterDays.ts` (`snapshot`).

### Mise à jour 2026-10-26 (bis) — `?days=n` : seulement les derniers jours

`GET /api/devices/:id/energy-days?days=n` ne rend que les **n derniers jours**, aujourd'hui compris
(`recentEnergyDays`, `apps/server/src/http/recentDays.ts`) : `days[]` filtré, et pour chaque onduleur
`wh` et `peakW` coupés, `inverters.from` avancé au premier jour gardé. Le découpage compte en jours de
**calendrier** (jours de 23 ou 25 h aux changements d'heure), comme le reste de l'historique. `since`,
`syncedAt` et `lifetimeWh` sont rendus tels quels. Sans `days` (ou non entier ≥ 1) : l'historique entier,
comme avant.

Le découpage se fait dans la **route**, une fois pour toutes : aucun plugin (Enphase, simulation) n'a à
le connaître. Le transport web le passe en second argument de `getEnergyDays(id, days)` ; le mock en
processus l'ignore et rend tout, ce que la fusion côté vue accepte
([4_4](../4_ui/4_4_vues-energie-vehicules.md)).

Pourquoi : des années d'historique de vingt onduleurs (Wh et pics) pèsent des centaines de Ko, et la vue
Énergie les rechargeait en entier chaque minute. Tests : `recentDays.test.ts` (dont le passage à l'heure
d'été).

### Mise à jour 2026-10-26 (ter) — production du jour par les onduleurs, consommation par bilan

Corrige « production et consommation viennent des compteurs du jour de la passerelle » ci-dessus,
pour Enphase : le compteur `whToday` de la passerelle s'est révélé capable de sauter (vérifié sur la
vraie installation, détail dans [3_7](../3_plugins/3_7_enphase.md)). La **production** d'un jour local
est maintenant la somme des compteurs du jour des onduleurs ; la **consommation** est le bilan
production + import − export + décharge − charge, réseau et batterie restant intégrés (donc approchés).
L'état `energy` du site porte les mêmes valeurs (`todayProductionWh`, `todayConsumptionWh`), calculées
par `EnergyDays.today`. « Aujourd'hui reste toujours local » tient toujours. Sources :
`apps/server/src/plugins/enphase/days.ts`, `index.ts`.

### Mise à jour 2026-10-31 — les phases, et l'historique qui survit à une coupure

**Pourquoi.** L'utilisateur fait sauter son abonnement triphasé quand la voiture charge pendant que
le four et le chauffage tournent. Un compteur triphasé coupe dès qu'**une** phase dépasse sa part de
l'abonnement (en principe le tiers), quel que soit le total : le `gridW` du site ne pouvait pas le
montrer.

**Contrat.** L'état `energy` gagne deux champs optionnels (`packages/shared/src/devices/state.ts`) :
`gridPhases` (L1, L2, L3 : puissance active `w` et apparente `va`, même signe que `gridW`) et
`phaseLimitVa` (la part de l'abonnement de chaque phase, réglée par l'utilisateur). La puissance
**apparente** est celle que le compteur limite : avec une pompe à chaleur ou un compresseur, elle
dépasse l'active. Le point d'historique horaire gagne `phasePeakVa` (`protocol/http.ts`) : le plus
fort soutirage de chaque phase dans l'heure, 0 si elle n'a fait qu'injecter. Une moyenne horaire
cacherait la minute qui fait couper.

**`EnergyHistory` n'est plus seulement en mémoire.** *(Dépasse le « sans base de données : un
redémarrage efface l'historique » plus haut, pour la partie effacement.)* Une coupure du compteur
éteint aussi le serveur, et effaçait justement l'heure qui l'explique. L'historique est donc écrit
dans `.state/energy-history.json` (`app.ts`, option `file`), relu au démarrage, toujours 48 h :
- toutes les **5 minutes** ;
- **aussitôt** quand le pic d'une phase monte au-delà de **80 %** de sa limite (`URGENT_SHARE`) :
  les secondes d'avant une coupure sont celles qui comptent. Sans limite saisie, seul le rythme de
  5 minutes joue.

Usure du disque, choix de l'utilisateur : environ 300 écritures par jour d'un fichier d'une
quinzaine de Ko (le site et chaque batterie, 48 seaux chacun), au lieu de milliers avec une écriture
à chaque hausse de pic. Le prix : un arrêt brutal sans dépassement perd au plus 5 minutes de
moyennes, celles du graphique de production.

**Rien à rattraper chez Enphase.** La resynchronisation ne ramène que des totaux journaliers, et la
série au quart d'heure du cloud est une moyenne sur 15 min : aucune des deux ne dit le pic d'une
phase. L'historique des phases commence au premier démarrage du serveur avec ce code.

Sources : `apps/server/src/core/history.ts` (+ `history.test.ts`), `apps/server/src/app.ts`,
`packages/shared/src/devices/state.ts`, `packages/shared/src/protocol/http.ts`. Plugin :
[3_7 Enphase](../3_plugins/3_7_enphase.md) ; vue : [4_4](../4_ui/4_4_vues-energie-vehicules.md).
