# Énergie : mesures, historique et charge des véhicules

> Dernière mise à jour : 2026-10-13
> Sources : `packages/shared/src/devices/state.ts` (`energyStateSchema`, `evChargerStateSchema`), `packages/shared/src/devices/rules.ts` (`estimateChargePowerW`), `apps/server/src/core/history.ts`, `apps/server/src/core/chargeCoordination.ts`, `apps/server/src/core/plugin-host.ts` (`execute`, `onVehicleState`, `checkChargingClaim`), `apps/server/src/http/routes.ts` (`/api/devices/:id/history`) ; pages citées plus bas

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
