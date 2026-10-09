# Plugin Open-Meteo (météo au-dessus de la maison)

> Dernière mise à jour : 2026-10-09
> Sources : `apps/server/src/plugins/open_meteo/{index,client,mapping,types,vigilance}.ts`, `apps/server/src/plugins/open_meteo/__fixtures__/open-meteo.ts`, tests `mapping.test.ts` et `plugin.test.ts`, `apps/web/src/components/weather/WeatherPlaces.vue`, `apps/web/src/composables/useWeather.ts`, `apps/server/.env.example`, `_generated-ai-doc/plan-meteo.md` (plan de la session du 2026-09-16)

## Pourquoi Open-Meteo

Décision prise avec l'utilisateur le 2026-09-16, après comparaison (détail dans le plan de session) :

| | Open-Meteo | Google Weather (+ Air Quality + Pollen) |
|---|---|---|
| Clé / compte | **aucun** | clé Maps Platform et **compte de facturation** attaché, même pour le gratuit |
| Gratuit | 10 000 appels/jour, usage non commercial, **attribution CC BY 4.0** | 10 000 appels/mois par SKU (trois SKU) |
| Pour la France | relaie AROME (Météo-France) parmi ses modèles | modèle Google |
| Air et pollens | inclus (programme européen CAMS) | deux API séparées |

Google reste possible plus tard comme **second plugin publiant le même kind** : le contrat `weather`
est l'abstraction, pas une couche « fournisseur » dans le plugin. La Météo agricole n'a pas d'API
publique. Le projet Google Cloud du plugin Nest ne sert à rien ici : c'est un client OAuth, pas une
clé Maps Platform.

**Modèle** : le « best match » d'Open-Meteo, pas `meteofrance_seamless` seul. Vérifié le jour même :
avec le modèle Météo-France forcé, `precipitation_probability` revient **entièrement `null`** (la
probabilité est dérivée de plusieurs modèles). Le best match garde AROME dans son mélange pour la
France et fournit la probabilité.

## Ce que le plugin publie

Un seul appareil `weather` (`open_meteo:home`), à la position de la maison lue dans **`ctx.site`**
(`house.origin`, voir `../1_architecture/1_2_serveur-et-plugins.md`). Aucune variable
d'environnement obligatoire ; `OPEN_METEO_POLL_MS` (défaut 10 min, borné 1 min – 1 h).

- Capacités : `forecast`, `air_quality`, `pollen`. Déclarées d'emblée ; si l'API d'air ne répond
  pas, l'appareil est **redéclaré sans** les deux capacités d'air (`emitDevices`) et les champs
  d'air sont effacés (patch `null`) — elles reviennent avec la première réponse.
- `meta.weather.attribution` = « Open-Meteo.com (CC BY 4.0) », obligatoire dans le contrat : c'est
  l'UI qui l'affiche (pied de la vue Météo).
- Deux appels par sondage : `api.open-meteo.com/v1/forecast` (`current` + `hourly` + `daily`,
  `timezone=auto`, `timeformat=unixtime`, 8 jours) puis
  `air-quality-api.open-meteo.com/v1/air-quality` (`european_aqi` + six pollens, `domains=cams_europe`).
  ~300 appels/jour sur 10 000 : rien à rationner.
- **`discover()` ne touche pas au réseau** : les plugins démarrent l'un après l'autre
  (`PluginHost.startAll`), une API lente retarderait toute la maison. L'appareil naît indisponible,
  la première lecture du poller (immédiate dans `start`) le remplit.

  *(Dépassé le 2026-10-01 : les plugins démarrent désormais en parallèle (`PluginHost.startAll`) — voir « Mise à jour 2026-10-01 » dans `1_2_serveur-et-plugins.md`. La règle « `discover()` sans réseau » reste valable.)*
- `forecast(externalId)` rend la **dernière réponse** mise en forme à l'heure de la demande (24 pas
  horaires à partir de l'heure courante, 7 jours à partir d'aujourd'hui) — jamais un nouvel appel.
- `GET /api/plugins/open_meteo/raw` : dernières réponses brutes, pour relever une fixture.
- Santé : `error` tant que rien n'a été lu, `degraded` si le dernier sondage a échoué mais qu'une
  lecture existe, `ok` sinon ; `detail` dit « weather + air quality » ou « weather only ».

## Mappage (`mapping.ts`, pur)

- Codes WMO → `condition` : 0-1 `clear`, 2 `partly_cloudy`, 3 `cloudy`, 45/48 `fog`, 51-55 `drizzle`,
  56-57 et 66-67 (verglaçant) `sleet`, 61-65 et 80-82 `rain`, 71-77 et 85-86 `snow`, ≥ 95
  `thunderstorm`. Code absent = `cloudy`.
- L'actuel vient de `current`, **complété par le pas horaire courant** pour ce que `current` ne
  porte pas (visibilité, UV, point de rosée, probabilité de pluie) et par le jour courant pour lever
  et coucher. `observedAt` = `current.time` (début du quart d'heure, pas l'heure de la requête).
- Pollens : grains/m³ → niveau 0-4 avec des seuils **grossiers et communs** (0 / < 10 / < 50 / < 150 /
  au-delà) — les échelles officielles varient par espèce, Open-Meteo ne donne que la concentration.
- Palier d'air : `aqiLevelOf` (partagé, `packages/shared/src/devices/kinds.ts`), paliers de 20.

## Particularités des réponses (fixtures capturées le 2026-09-16)

- Toutes les heures sont en **secondes** epoch ; `daily.time` vaut le minuit **local** du jour.
- Les séries sont des **colonnes parallèles** (`time[i]` va avec `temperature_2m[i]`), avec des
  `null` possibles ; les schémas (`types.ts`) sont `z.looseObject` et acceptent `null` partout.
- `is_day` est un 0/1 ; `visibility` en mètres ; `hourly` couvre 8 jours (192 pas).
- Le service arrondit la position (47,3 / 5,04 pour 47,309343 / 5,045591).

## Mise en route

Rien : cocher « open meteo » dans Réglages → Plugins. La maison doit avoir une `origin` (elle est
obligatoire dans le schéma). Vérifié en direct le 2026-09-16 avec une maison temporaire : appareil
publié, état réel (température et ciel du lieu), prévisions 24 h / 7 j, route `raw`.

### Mise à jour 2026-09-16 — la carte de prévision AROME (côté web)

Le même Open-Meteo sert aussi la **carte** : les champs de précipitation d'AROME France HD au pas de
15 minutes, en fichiers `.om` sur `openmeteo.s3.amazonaws.com/data_spatial/meteofrance_arome_france_hd_15min/`
(`latest.json` : run, échéances, variables). Rendus dans le navigateur par `@openmeteo/weather-map-layer`
(GPL-2.0), sur le radar de la vue Météo, à la suite des images observées de RainViewer. Détail,
pièges et licence dans `../4_ui/4_1_navigation-et-panneaux.md`. Le serveur n'y est pour rien : tout
part du navigateur, comme pour RainViewer.

### Mise à jour 2026-09-24 — la météo AILLEURS : deux routes de plus

La vue Météo sait afficher un autre lieu que la maison (recherche et favoris, voir
`../4_ui/4_1_navigation-et-panneaux.md`). Le plugin ne publie **pas** d'appareil de plus : deux
routes à la demande, servies par le même fournisseur, toujours sans clé.

- **`GET /api/plugins/open_meteo/places?q=…&lang=fr`** — géocodage Open-Meteo
  (`geocoding-api.open-meteo.com/v1/search`, base GeoNames, 8 résultats, noms dans la langue
  demandée). Rend `{ places: [{ id, name, region?, countryCode?, lat, lon }] }` ; `region` =
  « région, pays », sans répéter le nom (`toPlaces`, `mapping.ts`). Piège vérifié par curl : **sans
  résultat, la clé `results` est absente**, pas un tableau vide — le schéma la rend facultative.
  `q` de 2 à 100 caractères, `lang` sur deux lettres, sinon **400 `INVALID_QUERY`**.
- **`GET /api/plugins/open_meteo/at?lat=…&lon=…`** — `{ state, forecast, timezone?, attribution }`,
  au **format de l'appareil de la maison** : `state` est un `StateFor<'weather'>` COMPLET
  (`toWeatherState` = `mergeState(defaultState('weather'), toStatePatch(…))`, `available: true`) —
  les `null` d'effacement du patch n'en sortent jamais. `timezone` est le fuseau IANA renvoyé par
  `timezone=auto` : l'UI y affiche les heures du lieu. Même règle que la maison : **un cache par
  position** arrondie au centième (~1 km), gardé `OPEN_METEO_POLL_MS`, 24 lieux au plus (le plus
  ancien sort). Qualité de l'air facultative ici aussi. Position hors bornes → 400 `INVALID_QUERY`.
- Les deux routes renvoient elles-mêmes leur 400 (`sendError`) plutôt que de laisser filer une
  `ZodError` : le test monte un Fastify nu, sans le gestionnaire d'erreurs du vrai serveur.
- Tests : `plugin.test.ts`, bloc « ailleurs qu'à la maison ». Attention en écrivant ce genre de
  test : avancer l'horloge relance AUSSI le sondage de la maison — compter les appels par position.
- **Limites connues** : l'air et les pollens restent sur `domains=cams_europe` — hors d'Europe, des
  tirets ; la couche AROME du radar s'affiche même hors de sa zone (France et voisins).
- Simulation (`mockTransport.ts`) : quatre villes en dur, et la météo simulée de la maison décalée
  de quelques degrés selon la position.

### Mise à jour 2026-10-01 — la vigilance Météo-France : troisième route

Demande : afficher la vigilance émise sur la zone de la maison (une vigilance jaune orages était en
cours sur la zone ce soir-là). Open-Meteo n'en dit rien. Source retenue : le **flux JSON
MeteoAlarm** (`feeds.meteoalarm.org/api/v1/warnings/feeds-france`, sans clé ni compte, CC BY 4.0),
où Météo-France publie ses vigilances en CAP. Écartée : l'API Vigilance de Météo-France
(`portail-api.meteofrance.fr`), qui demande un compte et une clé.

- **`GET /api/plugins/open_meteo/alerts?lat=…&lon=…`** → `{ area, warnings, attribution, web }`.
  `area` = le département (`null` hors de la métropole) ; `warnings` = `{ type, level, onset, expires }`
  au moins jaunes, en cours d'abord, la plus forte en tête ; vide = vert. Code :
  `open_meteo/vigilance.ts` (`vigilanceFor` pur, `VigilanceClient`).
- **Le flux n'a pas de polygones**, seulement le nom du département (`areaDesc`) et un code NUTS3.
  La position devient un département par l'API Géo de l'État (`geo.api.gouv.fr/communes?lat&lon`,
  sans clé), et les noms se comparent sans accents ni ponctuation. Vérifié le 2026-10-01 : les 83
  noms présents dans le flux correspondent tous à un département de l'API Géo.
- **Métropole seule** : un code `97x` rend `area: null`. Le flux France ne couvre pas l'outre-mer,
  où un département absent voudrait dire « vert » à tort.
- **Lire le flux** : il mêle messages du jour et du lendemain, mises à jour, retours au vert
  (niveau 1, « AllClear ») et messages en deux langues (la première suffit). Règle : par phénomène
  (`awareness_type`), le message de `sent` le plus récent qui couvre l'instant donne le niveau du
  moment, le plus récent qui commence plus tard donne le suivant ; deux fenêtres contiguës au même
  niveau fusionnent ; `msgType: Cancel` = vert. Des messages « Update » portent `expires` <
  `onset` : ils sont ignorés.
- Cache : le flux (~500 Ko) relu au plus une fois par `OPEN_METEO_POLL_MS`, partagé par tous les
  lieux ; le département gardé par position arrondie au centième (24 au plus) ; un échec ne reste
  pas en cache. Rien n'est lu tant que la vue Météo ne le demande pas *(dépassé le 2026-10-02 : le
  flux est relu à chaque sondage pour la maison, voir plus bas)*.
- Mesuré sur le vrai flux le 2026-10-01 : un département en jaune orages jusqu'à minuit ; Hérault
  rouge crues, orange pluie-inondation, jaune orages ; Berlin et la Guadeloupe `area: null`.
- Tests : `vigilance.test.ts` (vert plus récent, annulation, fusion de fenêtres, ordre, cache,
  hors de France et outre-mer). Simulation (`mockTransport.ts`) : jaune orages jusqu'à minuit dans
  une France grossière, `null` ailleurs.
- ~~**Pas dans l'état de l'appareil**~~ *(dépassé le 2026-10-02)* : c'était une route seulement ;
  la vigilance EN COURS de la maison est désormais dans l'état (section suivante), la route reste
  pour l'à-venir et les autres lieux.

### Mise à jour 2026-10-02 — la vigilance de la maison entre dans l'état

À chaque sondage, le plugin lit la vigilance de `ctx.site` (même `VigilanceClient`, donc même cache
que la route `/alerts`), garde celles EN COURS (`onset <= now < expires`, horloge du contexte) et les
publie dans `vigilance` de l'état `weather` (contrat : `../1_architecture/1_1_contrat-appareils.md`).
Pourquoi : les alertes du rail lisent l'état, et une automatisation pourra y réagir. Les cas :
- maison hors métropole (`area: null`) : `vigilance: null`, le champ est effacé ;
- flux en échec : le champ n'est PAS touché (dernière valeur gardée), la météo passe quand même, avec
  un `warn` « vigilance unavailable, weather kept ». Même esprit que l'air, facultative ;
- aucune vigilance en cours : `[]`.

La page Météo continue de lire la route `/api/plugins/open_meteo/alerts` (à venir, autres lieux).

Tests (`plugin.test.ts`, « vigilance de la maison ») : en cours seulement (une orange en cours, une
rouge à venir écartée), liste vide, outre-mer `null`, flux 503 (champ absent, `condition` publiée).
Les tests existants ne comptent plus que les appels à Open-Meteo (`vigilanceCalls` à part).
**Pas essayé contre le vrai flux avec une vigilance orange.**

Sources : `apps/server/src/plugins/open_meteo/{index,plugin.test}.ts`, `packages/shared/src/devices/state.ts`.

### Mise à jour 2026-10-09 — lue par le MCP (`get_weather`), et un défaut relevé

**Un consommateur de plus.** L'outil MCP `get_weather` (`../1_architecture/1_7_serveur-mcp.md`) rend la météo, les
prévisions, l'air, les pollens et la vigilance **à venir** : pour la maison par l'appareil `weather`, `host.forecast`
et `/alerts` (avec `house.origin` ; repli sur la vigilance en cours de l'état si la route échoue), pour un autre lieu
par `/places`, `/at` et `/alerts`. C'est ce qui manquait : `list_devices` / `get_device` ne donnent que l'état et la
vigilance en cours. Heures rendues en clair dans le fuseau du `timezone` renvoyé par `/at`.
Essai réel contre l'API : Pornic, Montpellier (vigilance Hérault), Tokyo (vigilance `null`, hors métropole).

**Défaut préexistant, non corrigé (limite connue)** — *levé le jour même, voir la section suivante.* `/places`, `/at` et `/alerts` répondent **500** « Cannot read
properties of null » quand le plugin est monté mais pas démarré : `client`, `ctx` (et `vigilance` pour `/alerts`)
sont nuls tant que le démarrage n'a pas tourné, et les routes les déréférencent avec `!`
(`apps/server/src/plugins/open_meteo/index.ts`). Visible par le MCP comme par la vue Météo ; un 409
`DEVICE_UNAVAILABLE`, comme `/raw`, serait plus honnête.

Sources : `apps/server/src/mcp/server.ts`, `apps/server/src/plugins/open_meteo/index.ts`.

### Mise à jour 2026-10-09 — routes appelées plugin non démarré : 409 en clair

Le défaut ci-dessus est corrigé. Observé le 2026-10-09 sur le vrai serveur :
`GET /api/plugins/open_meteo/places?q=Pornic` → 500 (« Cannot read properties of null (reading 'places') »),
que `get_weather` rendait tel quel à l'agent.

- `/places`, `/at` et `/alerts` répondent désormais **409 `DEVICE_UNAVAILABLE`**, message
  « open_meteo plugin is not started », quand `ctx` (et `client` pour `/places`, `vigilance` pour `/alerts`)
  est nul : plugin désactivé dans `plugins` de la maison, ou démarrage pas encore passé.
- Le contrôle vient **après** la validation de la requête : une requête mal formée garde son 400.
- Convention suivie : celle de `comap` (`sendError(reply, 409, 'DEVICE_UNAVAILABLE', 'plugin not started')`) et
  de `/raw` ici même. Le message nomme le plugin, comme `radio`, `mixcloud` et `transcription`
  (« … plugin is not started ») : le MCP le transmet tel quel à l'agent, et « plugin not started » seul
  ne dirait pas lequel.
- Test : `plugin.test.ts`, « plugin monté mais jamais démarré » (les trois routes) ; rouge avant le
  correctif (500 au lieu de 409).

Non couvert : après `stop()`, `ctx` reste posé : ce contrôle ne refuse pas les routes d'un plugin arrêté (pas le cas observé).

Sources : `apps/server/src/plugins/open_meteo/{index,plugin.test}.ts`, `apps/server/src/plugins/comap/index.ts`.
