# Home Assistant — les appareils d'une installation HA, sans rien y changer

> Dernière mise à jour : 2026-10-30
> Sources : `apps/server/src/plugins/home_assistant/{index,client,mapping}.ts`,
> `apps/server/src/plugins/home_assistant/{mapping,plugin}.test.ts`, `__fixtures__/states.json`,
> `apps/server/src/core/{plugin,plugin-host}.ts` (`enabledPlugins`, `onPluginsChanged`),
> `apps/web/src/components/HomeAssistantCard.vue`, `docs/plugins/home_assistant.md`

## Origine et intention

Plugin proposé par un utilisateur, qgiu (https://github.com/qgiu), écrit sur la version du 2026-10-12
et adapté le 2026-10-30. Pour qui a déjà Home Assistant : essayer Kasbah **sans rien casser** de son
installation, puis migrer appareil par appareil. Le code reçu compilait et passait ses tests contre le
contrat du jour (140 commits plus tard) ; l'adaptation a porté sur les données, la sélection des
entités et trois défauts.

## Principe

- Une seule connexion WebSocket (`/api/websocket`, `client.ts`) : authentification par jeton longue
  durée, requêtes numérotées bornées à 10 s, abonnements, reconnexion à attente croissante (1 s → 30 s ;
  jeton refusé = rythme le plus lent d'emblée).
- **Home Assistant reste seul à commander** : une commande Kasbah devient un `call_service`, l'état
  revient par `state_changed`, jamais d'écho local. Le plugin ne crée aucun automatisme.
- Zone HA (de l'entité, sinon de son appareil) → `meta.room` → auto-placement dans la pièce homonyme.
- Domaines repris : `light`, `cover`, `climate`, `sensor` (classes `HA_SENSOR_CLASSES`), `media_player`.
  Écartées : entités désactivées, masquées, de catégorie `config` / `diagnostic`. Une entité **sans entrée
  de registre** (YAML) est reprise, rangée « Sans intégration ».
- `discover()` ne fait aucun réseau : les appareils naissent à la première synchronisation (`start`).

Correspondances notables (`mapping.ts`) :

- **Volets Somfy « vitesse lente »** : l'intégration Overkiz publie un jumeau `cover.x_low_speed`. Il est
  absorbé et devient la capacité `quiet` ; mode discret allumé, les ordres de mouvement partent vers le
  jumeau. Seul le volet principal fait foi pour l'état.
- **Groupes de volets** (attribut `entity_id`) → `meta.isGroup`.
- **Radiateurs à préréglages seulement** (fil pilote par Overkiz) : `hvac_mode` sans `target_temp` ; les
  préréglages HA ne sont jamais exposés. `heat_cool` ↔ `auto`.

## Sélection des entités (Réglages → Plugins → Home Assistant)

Demande de l'utilisateur : une liste à interrupteurs comme le pont Matter (`../1_architecture/1_17_pont-matter.md`),
pour éviter les doublons. Même conclusion que pour Matter : **c'est la marque qui crée les doublons, pas le
type**. La liste est donc groupée par **intégration HA** (`platform` du registre des entités).

- **Repris d'office** (choix de l'utilisateur) : toute entité traduisible est affichée, les nouvelles aussi,
  **sauf les doublons** : une entité dont l'intégration a un plugin Kasbah natif **allumé**
  (`NATIVE_PLUGIN` : `hue` → hue, `overkiz`/`somfy` → tahoma, `cast` → google_cast, `sonos`, `nest`,
  `roomba` → irobot, `husqvarna_automower` → automower, `enphase_envoy` → enphase, `melcloud`, `tuya`,
  `tesla_fleet`/`teslemetry`/`tessie` → tesla, `renault`, `open_meteo`).
- Un choix explicite gagne dans les deux sens (`isShown`). La carte envoie `null` quand le choix rejoint le
  défaut : l'entité recommence à suivre le plugin natif. D'où la migration : allumer le plugin natif fait
  disparaître le jumeau HA tout seul.
- Choix et volets en mode discret vivent dans **`HA_STATE_FILE`** (`.state/home-assistant.json`), propre au
  plugin. Écarté : un champ dans `house.plugins` (contrat partagé à étendre, maison démo en lecture seule)
  pour un réglage qu'un seul plugin lit.
- Routes : `GET /api/plugins/home_assistant/entities` (`{ connected, entities[] }`), `PATCH` même chemin
  (`{ choices: { entity_id: bool | null } }`), appliqué à chaud par `emitDevices`.
- Une entité masquée n'est ni pilotable ni mise à jour ; son état reste suivi en mémoire pour réapparaître
  à jour.

### Contrat de plugin : deux membres facultatifs

Pour savoir quels plugins sont allumés, sans lire la maison (`ctx.site` et `ctx.parts` suivent la même
règle : c'est l'hôte qui donne) :

- `PluginContext.enabledPlugins?: () => readonly string[]`, relu à chaque appel ;
- `DevicePlugin.onPluginsChanged?(): void`, appelé par `PluginHost.apply` sur les autres plugins **en
  marche** quand un plugin s'allume ou s'éteint.

Facultatifs pour ne toucher aucun des 28 contextes de test écrits à la main. GitNexus classait le contrat
en risque CRITIQUE (72 dépendants directs) : ajout pur, aucun implémenteur modifié. Test :
`core/plugin-host.test.ts` (« other plugins turned on or off »).

## Pochettes des lecteurs

`entity_picture` est une adresse relative de HA (`/api/media_player_proxy/…?token=…&cache=…`) : le
navigateur ne peut pas la suivre depuis l'adresse publique, et le jeton n'a pas à sortir. Le serveur la
relaie : `artUrl` = `/api/plugins/home_assistant/art/<entity_id>?v=<cache>` (`artUrlOf` ; `v` suit l'image,
pas le jeton que HA renouvelle toutes les quelques minutes). La route ne sert que la pochette **courante
d'un lecteur affiché** (pas de relais ouvert) : adresse relative → `fetch` vers `HA_URL` avec le jeton ;
absolue → `publicFetch` ; type raster seulement, envoyée par `sendArt` comme Cast et Sonos.

## Défauts corrigés à l'intégration

- **Événements perdus** : le code reçu lisait les états **puis** s'abonnait ; un changement entre les deux
  était perdu. Abonnement d'abord (test « subscribes before reading the states »).
- **Santé trompeuse** : une synchronisation ratée laissait « ok, 0 entities ». Elle passe en `degraded`
  avec la raison.
- **Mode discret oublié au redémarrage** : gardé dans `HA_STATE_FILE`, comme `TAHOMA_QUIET_FILE`.
- `HA_EXCLUDE` supprimé : la carte le remplace.

## Données du contributeur

Le dépôt est public et `.private-denylist` ne connaît que les valeurs du propriétaire. La fixture reçue
(états « réels capturés ») a été **réécrite** avec des noms neutres (Lampe 1, Volet 1, TV 1…) en gardant les
formes d'attributs : elle laissait voir des noms, des marques, le plan des volets et les applis installées
sur une TV. Le LISEZMOI reçu reste hors du dépôt.

## Vérifié, et non joué

**Vérifié** : 23 tests du plugin (sélection, doublons, `null`, mode discret persistant, pochette relayée et
refus des autres, ordre abonnement / lecture) ; carte web (`HomeAssistantCard.test.ts`) ; dans l'app,
contre un faux Home Assistant local (WebSocket nourri par la fixture) et un serveur isolé : liste par
intégration, « Tout retirer » qui retire les appareils à chaud, rien ne bouge (mesure géométrique), zooms
1 / 1,25 / 1,5, clair et sombre, fr et en, téléphone 375 px sans débordement ; commande en mode discret
partie vers le jumeau lent.

**Non joué** : une vraie installation Home Assistant (celle du contributeur l'a été, sur sa version) ;
l'affichage d'un doublon dans l'app (couvert par les tests seulement : allumer Hue dans la preview aurait
parlé au vrai pont).

## Reste à faire

Caméras, aspirateurs, ventilateurs, serrures, interrupteurs. Boucles possibles entre automatisations HA et
Kasbah sur un même appareil : documentées, pas détectées.
