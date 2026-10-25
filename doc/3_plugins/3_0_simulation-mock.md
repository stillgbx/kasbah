# Simulation (`@kasbah/mock-sim` et plugin `mock`)

> Dernière mise à jour : 2026-10-25
> Sources : `packages/mock-sim/src/{simulation,scenarios,world,clock,rng,types}.ts`, `packages/mock-sim/src/behaviours/*.ts`, `apps/server/src/plugins/mock/index.ts`, `apps/web/src/api/mockTransport.ts`, `packages/mock-sim/src/behaviours/energy.ts`, `packages/mock-sim/src/demos.ts`, `packages/mock-sim/src/behaviours/camera.ts`

## Pourquoi un paquet séparé

Le moteur ne dépend que de `@kasbah/shared`, sans API Node : il tourne **dans le serveur** (plugin
`mock`, adaptateur de ~100 lignes aujourd'hui, 107 au relevé du 2026-10-06) **et dans le navigateur** (transport in-process pour les tests de
composants et une démo sans serveur). Même comportement, une implémentation.

## Déterminisme

- Horloge injectée (`Clock` : `systemClock` ou `ManualClock` en tests, `advance(ms)` déclenche les timers).
- RNG `mulberry32(seed)` : même graine + même heure de départ → même trajectoire.
- `simTime = startTime + (now − realStart) × timeScale` ; un gros saut est **subdivisé** (`maxStepS`,
  60 s) pour garder les comportements exacts (volet à 5 %/s…).
- Fuseau : `tzOffsetMin` (convention `getTimezoneOffset`) pour les horaires locaux (tondeuse, aspirateur).

## Émission

À chaque pas, chaque appareil **mute** son état ; le moteur diffère avec le dernier snapshot émis et
n'envoie **que les champs changés** (`onPatch(externalId, patch)`). Les indisponibilités du
scénario `chaos` passent par `onAvailability`.

## Comportements (`behaviours/`)

| Kind | Comportement |
|---|---|
| light | instantané ; `transitionMs` interpole la luminosité ; consommation déclarée au monde |
| cover | cible, 5 %/s, `stop` fige, `motion` cohérent, inclinaison optionnelle |
| media_player | playlist factice, position qui avance, enchaînement |
| climate | exponentielle vers la consigne (τ 20 min) ou vers l'extérieur (τ 4 h) si arrêt ; `action` dérivée |
| vacuum | cycle quotidien 11 h (45 min), batterie 100 → 35, retour 3 min, recharge 1 %/min |
| mower | planning lun–ven 10–12 h, −1 %/90 s, retour sous 20 %, **errance dans un rectangle** publiée dans `position` |
| sensor | cibles sinusoïdales (extérieur, piscine, pression de filtration, débit) + bruit, constante de temps |
| energy | `production = irradiance × crête`, `consommation = base + charges du tick`, batterie 5 kWh, identité `grid = cons − prod + batt` ; **tické en dernier** |
| vehicle + ev_charger | départ 8 h 30 / retour 18 h 15 en semaine (GPS interpolé, SOC ↓), branchement automatique, borne qui lit l'état du véhicule via `ctx.getState` |

Le **monde** (`world.ts`) fournit ensoleillement (géométrie 6 h–20 h, pic 13 h, nuages en marche
aléatoire), température extérieure et l'accumulateur `loadsW`.

## Scénarios (`scenarios.ts`)

`default` (ids stables liés à la maison démo : `light-living`, `cover-kitchen`, `energy-site`,
`vehicle-tesla`…), `empty`, `chaos` (indisponibilités ~30 s, 10 % d'`UPSTREAM_ERROR`, latence 3 s),
`winter`. Variables : `MOCK_SCENARIO`, `MOCK_SEED`, `MOCK_START_TIME` (ISO), `MOCK_TIME_SCALE`.

## Tests

`simulation.test.ts` : validité des états, déterminisme, diff minimal, volet 0→100 en 20 ticks et
`stop` à 35, `light.set`, production nulle à 2 h et positive à 13 h, identité énergétique à chaque
tick, trajet du véhicule, planning de la tondeuse, chaos, horloge accélérée.

### Mise à jour 2026-09-08 — `MOCK_EXCLUDE_KINDS` : compléter un parc réel, pas le doubler

*(Dépassé le 2026-09-11 : la variable `MOCK_EXCLUDE_KINDS` a été supprimée, remplacée par des sous-items cochables, un par kind simulé (`MOCK_PARTS`, dérivé de `DEVICE_KINDS` dans `apps/server/src/plugins/mock/index.ts`) — voir « Mise à jour 2026-09-11 — `MOCK_EXCLUDE_KINDS` devient des sous-items cochables ». Le raisonnement ci-dessous reste valable, pas le mécanisme.)*

Symptôme qui l'a motivé : une fois de vrais plugins branchés (Hue pour les lampes, TaHoma pour les
ouvrants), les appareils simulés des MÊMES kinds restent dans les listes en « hors plan » — aucun
`deviceId` de `house.json` ne les lie, donc ils s'empilent dans la bande « Hors maison ». Trois
volets et trois lampes fantômes sur une maison réelle, sans moyen de les distinguer d'un vrai
appareil mal rattaché : le diagnostic devient illisible.

`MOCK_EXCLUDE_KINDS` (liste de kinds séparés par des virgules, vide par défaut) retire ces kinds de
`discover()` **et** des états émis. Le moteur continue de les faire vivre en interne — c'est le
filtrage à la sortie qui compte, sinon le registre journalise un « patch pour un appareil inconnu »
à chaque tick. Un kind inconnu **désactive le plugin** au démarrage (validé par `z.enum(DEVICE_KINDS)`
dans `configSchema`) plutôt que d'être ignoré en silence, et `health().detail` rappelle ce qui est
exclu — visible dans Réglages.

Usage attendu : la liste **grandit** à mesure que les vrais fabricants arrivent. Aujourd'hui
`light,cover` ; demain `energy` avec Enphase, `vehicle` avec Tesla et Renault, `climate` avec
MELCloud (voir `3_3_fabricants-a-venir.md`). La simulation garde ainsi exactement son intérêt :
alimenter les vues que rien ne couvre encore.

À ne pas confondre avec le scénario `empty`, qui ne fournit **aucun** appareil.


### Mise à jour 2026-09-08 — `preset` sur un volet simulé

`cover()` accepte une option `preset` (position favorite du moteur, échelle de `position`). Quand
elle est donnée, l'appareil déclare la capacité `preset`, publie `presetPosition` et rejoint cette
valeur sur `cover.preset` ; sinon la commande est refusée en `UNSUPPORTED_COMMAND`. Un seul volet du
scénario par défaut la porte (`cover-living`, favori à 27) : c'est ce qui permet de développer et de
vérifier la fonction sans dépendre d'une vraie box — et de couvrir les deux cas, avec et sans.



### Mise à jour 2026-09-11 — panneaux solaires simulés, et exclusion en cascade

`solarPanel()` (dans `behaviours/energy.ts`) ajoute un module photovoltaïque : un capteur de
puissance en watts qui suit l'ensoleillement, avec un rendement relatif et une heure d'ombrage
facultative. Le scénario `default` en compte **vingt**, dix « sud » et dix « nord », pour que les
deux champs de panneaux de la maison de démonstration aient des onduleurs à lier
(`../2_maison/2_0_format-house-json.md`).

Ces vingt appareils ont révélé une limite de `MOCK_EXCLUDE_KINDS` : un panneau est un `sensor`, donc
exclure `energy` ne les retirait pas d'un parc réel, et exclure `sensor` aurait emporté les capteurs
de piscine et de filtration. **Un appareil simulé peut désormais déclarer l'installation à laquelle
il appartient** — `SimDevice.partOf`, ici `'energy'` — et `Simulation.hiddenFor(kinds)` masque un
appareil quand son propre kind est exclu **ou** quand son `partOf` l'est. Le plugin `mock` délègue à
cette méthode au lieu de filtrer sur le kind lui-même.

Conséquence pratique, une fois le plugin Enphase branché : `MOCK_EXCLUDE_KINDS=…,energy` retire le
site solaire simulé **et** ses vingt panneaux d'un seul mot, sans toucher aux autres capteurs.
Vérifié sur un vrai serveur : 9 appareils simulés restants, zéro panneau, capteur de piscine intact,
et aucun « patch pour un appareil inconnu » dans les journaux.

### Mise à jour 2026-09-11 — exclure un kind qu'AUCUN plugin ne couvre

*(Dépassé le 2026-09-11 : `MOCK_EXCLUDE_KINDS=…,ev_charger` n'existe plus ; on décoche « Borne de recharge » parmi les sous-items du plugin Mock dans Réglages → Plugins — voir « `MOCK_EXCLUDE_KINDS` devient des sous-items cochables ».)*

Jusqu'ici, sortir un kind de la simulation voulait dire « un vrai plugin le couvre déjà » : les lampes
par Hue, les ouvrants par TaHoma, le solaire par Enphase. La borne de recharge a ajouté une **seconde
raison, opposée** : personne ne la couvre, et la valeur simulée se faisait prendre pour une mesure.

Le mock publiait `mock:charger-home` (« En charge », 7,4 kW), alimentée par la Tesla simulée qui se
branche toute seule au retour du travail. Dans la vue Énergie de la maison réelle, cette borne
dessinait un flux sortant de 7,4 kW alors qu'aucune voiture ne chargeait — et une
**IQ EV Charger 2 ne parle qu'au cloud Enphase** : aucun plugin ne l'atteint, donc rien ne viendrait
jamais démentir le chiffre simulé. D'où `MOCK_EXCLUDE_KINDS=…,ev_charger` dans `apps/server/.env`.

La règle qui s'en dégage : **un kind simulé est acceptable tant qu'on sait qu'il est simulé**. Il
cesse de l'être dès qu'il se mélange à des mesures réelles dans un même écran — ici le schéma de flux,
qui additionne la borne et les compteurs Enphase sans dire lequel vient d'où.

Le **véhicule** simulé reste, lui : la vue Véhicules n'a rien de réel à montrer, et il n'alimente plus
rien de visible côté énergie — la vue Énergie ne lit que les appareils de kind `ev_charger`
(`apps/web/src/composables/useHomeSummary.ts`), jamais la puissance de charge du véhicule.

Vérifié sur un serveur mock seul, port dédié : kinds restants `mower`, `sensor`, `vacuum`, `vehicle`,
plus aucun `ev_charger`. Effet de bord assumé : l'ancre `auto.mock-charger-home` de `house/maison.json`
pointe désormais dans le vide. Elle est **inerte** — la scène et les bandes parcourent les appareils et
cherchent leur ancre, jamais l'inverse — et garde sa place si la borne devient joignable.

### Mise à jour 2026-09-11 — `MOCK_EXCLUDE_KINDS` devient des sous-items cochables

Même concept, même `Simulation.hiddenFor` (exclure `energy` emporte toujours le site solaire ET ses
panneaux) — seul l'endroit où on le décide change : la variable `MOCK_EXCLUDE_KINDS` disparaît de
`.env` au profit de **sous-items** déclarés par le plugin et cochés dans Réglages → Plugins.

- `createMockPlugin()` expose `parts` : un sous-item par kind simulé, soit les dix de `DEVICE_KINDS`
  **sauf `camera`**, que la simulation ne fournit pas. *(Constat du lint du 2026-10-06 : `DEVICE_KINDS` compte aujourd'hui 16 kinds, donc 15 sous-items sans `camera` ; « dix » était le compte du 2026-09-11.)* `labelKey: 'kinds.<kind>'`, tous à `true` par
  défaut.
- `init(ctx)` en déduit `excluded` = les kinds dont `ctx.parts[kind] === false`. Le reste du plugin
  est inchangé, `health()` dit toujours « sans light/cover ».
- Conséquence heureuse : une faute de frappe n'est plus possible (on coche une liste), là où un kind
  inconnu désactivait le plugin au démarrage.
- Décocher prend effet **tout de suite** : l'hôte redémarre le plugin quand ses sous-items changent
  (`../1_architecture/1_2_serveur-et-plugins.md`). Vérifié dans l'app : décocher « Énergie » fait
  passer la simulation de 39 à 18 appareils (le site solaire et ses vingt panneaux).

### Mise à jour 2026-09-13 — un panneau simulé tient son record

`solarPanel` enveloppe son `tick` pour garder la plus haute valeur produite depuis le démarrage et
la publier en `maxValue`, comme une passerelle Enphase tient le `maxReportWatts` de chacun de ses
onduleurs. Sans ça, le repère « record » de la vue Énergie et de la scène 3D n'avait rien à montrer
en démonstration, et ne pouvait donc pas s'y vérifier. Source :
`packages/mock-sim/src/behaviours/energy.ts`.


### Mise à jour 2026-09-13 — le véhicule simulé dort, roule et dit ses pneus

`packages/mock-sim/src/behaviours/ev.ts` : le véhicule simulé fournit les champs que le contrat
`vehicle` a gagnés pour le plugin Tesla (`../1_architecture/1_1_contrat-appareils.md`), afin que la
vue Véhicules s'essaie dessus sans compte : `sleepState` (`online` en route ou en charge, `asleep`
sinon — et `vehicle.wake` le passe à `online`), `gear` (`D` en trajet, `P` garé), `speedKmh` (la
moyenne du trajet simulé, 77 km/h), `tirePressureBar` constant (2,90 / 2,90 / 2,95 / 2,95) et deux
températures fixes. Rien de ce qui existait ne change : la charge, la position et le kilométrage
suivent la même simulation. Voir la configuration de lancement `kasbah-mock`
(`../5_setup/5_0_installation-et-scripts.md`) pour la voir sans toucher à la maison réelle.


### Mise à jour 2026-09-14 — la démo déménage (et les DEUX maisons de démo)

La maison de démo et le trajet simulé quittent Lyon pour deux points près de Dijon — `HOME` 47.309343, 5.045591 (l'origine de la
maison de démo, donc la voiture garée se pose dessus) et `WORK` 47.3216, 5.0415. Ils sont à
**2,3 km** l'un de l'autre, donc sous la règle des 3 km de `apps/web/src/lib/map.ts` : la carte du
véhicule cadre les deux, ce qui est tout l'intérêt de la démo.

Piège à connaître : **la maison de démo existe en deux exemplaires identiques**, et les changer tous
les deux n'est pas facultatif —
`house/demo-house.json` (ce que le serveur charge par défaut) et
`packages/shared/src/house/__fixtures__/demo-house.json` (ce qu'importent le transport in-process du
web et les tests, via l'export `@kasbah/shared/demo-house.json`). N'en changer qu'un donne une maison
à un endroit et une voiture à un autre : « À 174 km » sur la carte, pour un trajet de 2 km.
L'exemple de `docs/house-json.md` recopie la même origine.


### Mise à jour 2026-09-14 — la Zoé devient une R5, et joue le véhicule qui se tait

Le second véhicule simulé passe de « Zoé » à **« R5 »** (`vehicle-r5`, modèle « Renault 5 E-Tech »,
410 km d'autonomie pleine) : le parc de démo suit le parc réel. Les **deux** copies de
`demo-house.json` changent ensemble (`id: "vehicle.r5"`, `deviceId: "mock:vehicle-r5"`), comme
toujours.

Son intérêt de simulation ne change pas, il se précise. Sa borne est à `chargerPowerW: 0`, donc elle
ne charge jamais dans la démo — et le descripteur ne déclare la capacité **`charge_power` que si une
borne la charge vraiment** :

```ts
...((o.chargerPowerW ?? 7400) > 0 ? ['charge_power' as const] : []),
```

La R5 simulée reproduit donc exactement le cas de la vraie : un véhicule qui ne dit pas sa puissance,
pour qui l'UI demande une capacité de batterie et affiche une estimation. La Tesla simulée, elle, la
déclare. Deux autres valeurs viennent nourrir la vue Véhicules : `socMin: 20` (plancher que Tesla
n'a pas) et un `chargeMinutesRemaining` recalculé à chaque tour pendant la charge, effacé sinon.

Sources : `packages/mock-sim/src/{scenarios.ts,behaviours/ev.ts}`, `house/demo-house.json`,
`packages/shared/src/house/__fixtures__/demo-house.json`.

### Mise à jour 2026-09-16 — météo simulée, et la courbe de température remise à l'endroit

- `behaviours/weather.ts` : un appareil `weather` (`mock:weather`, sous-item « Météo » comme les
  autres kinds) tiré du monde partagé — nuages, température, ensoleillement, et un nouveau
  `world.precipMmH` (une averse se forme au-dessus de 0,7 de nuages, s'éteint dessous). Vent,
  humidité, pression, UV, visibilité, AQI et pollens (saisons françaises par mois) en découlent ;
  `conditionOf` traduit le tout en une condition (neige sous 1 °C, orage au-delà de 4 mm/h et 20 °C,
  brouillard à 95 % d'humidité). Lever 6 h, coucher 20 h : ceux de `solarGeometry`.
- **Sans tirage aléatoire** : le vent est une houle déterministe et l'averse une dérive sans bruit.
  Un tirage de plus par tick aurait décalé la suite du générateur partagé pour tous les autres
  appareils — et fait tomber le test « chaos » de l'intégration (deux commandes lentes de 3 s avant
  la première panne, au lieu d'une).
- `SimDevice.forecast?(ctx)` et `Simulation.forecast(externalId)` : prévisions déduites du monde
  (`forecastOf`), 24 h et 7 jours, déterministes ; le plugin `mock` les sert par `forecast()`. La
  vue Météo et le widget se développent donc sans réseau (config `kasbah-mock` de la preview).
- **Bug corrigé au passage** : `outdoorTemperature` avait le signe inverse (maximum à 3 h du
  matin, minimum à 15 h), depuis le commit initial. Personne ne l'avait vu : seuls des capteurs
  lissés en dépendaient. La météo simulée l'aurait affiché en grand.

Sources : `packages/mock-sim/src/behaviours/weather.ts`, `packages/mock-sim/src/{world,types,simulation,scenarios}.ts`,
`apps/server/src/plugins/mock/index.ts`, `packages/mock-sim/src/simulation.test.ts`.

### Mise à jour 2026-09-17 — la station de traitement de l'eau simulée, et le piège du tirage initial

`packages/mock-sim/src/behaviours/water.ts` simule un appareil `water` (« Traitement de
l'eau ») : usures en dents de scie sur 150 à 300 jours selon le consommable, débit **par
salves** plutôt qu'en continu — c'est ce que fait une maison — et consommations cumulées.

Le débit est **quantifié au pas réel du débitmètre, 36 L/h** : toutes les valeurs de la vraie
station en sont des multiples, et une simulation qui produirait 837 L/h mentirait discrètement à
quiconque développe l'affichage en s'y fiant.

**Piège rencontré en l'écrivant, qui vaut pour tout nouveau comportement** : le premier jet
tirait `ctx.rng()` à chaque tick, **y compris au tick initial `dtS = 0`** de la construction de
`Simulation`. Comme tous les appareils partagent le même générateur seedé, ce tirage
supplémentaire décalait toute la suite, et le scénario `chaos` basculait sur une autre branche :
un test d'intégration partait alors sur `slowRate`, qui attend une horloge manuelle jamais
avancée — le test restait bloqué jusqu'au timeout de vitest, sans message utile. Correctif : ne
pas tirer au sort quand `ctx.dtS <= 0`, la probabilité d'un événement y étant de toute façon
nulle.

**À retenir : un comportement de simulation ne doit rien tirer au sort tant que le temps n'a pas
avancé**, sinon il déplace le hasard de tous les autres.

Un défaut connu subsiste : les usures dérivant de l'horloge murale, la station **naît en
avertissement** selon la date (Charbon 2 à 11 % le jour de l'écriture). La preview montre donc
une alerte par défaut.

### Mise à jour 2026-09-18 — un ouvrant simulé DÉCLARE sa nature (et le parc gagne un store et un portail)

Jusqu'ici `cover()` ne posait jamais `meta.cover.deviceClass` : les six ouvrants simulés étaient
muets sur leur nature, là où un vrai plugin la déclare toujours (une installation TaHoma
remonte des ouvrants tous renseignés, de natures `shutter`, `awning` ou `gate` — voir
`apps/server/src/plugins/tahoma/mapping.ts`, `COVER_UI_CLASSES`).

Conséquence : **tout ce que l'interface décide sur la nature d'un ouvrant retombait sur le cas du
volet**, donc était structurellement invérifiable avec le harnais qui sert justement à vérifier
l'interface. Les quatre règles concernées vivent dans `apps/web/src/lib/cover.ts` : `coverWords`
(« ouvrir/fermer » contre « remonter/baisser »), `isFlatCover` (la forme dessinée dans la scène),
`isPassageCover` (ce qu'un geste d'ensemble n'ouvre jamais) et `expectsOpening` / `canTakeOpening`
(la liste « à affecter » de la vue Ouvrants).

- `CoverOptions.deviceClass` est désormais **obligatoire** (`packages/mock-sim/src/behaviours/cover.ts`) :
  on ne peut plus ajouter un ouvrant simulé muet par distraction. Le modèle annoncé suit la nature
  (un coffret de portail ne s'annonce plus « Roller shutter »). La nature est **décidée appareil par
  appareil**, jamais devinée d'après le nom — c'est ce que fait un plugin, et l'imiter est le but.
- Le scénario `default` (`scenarios.ts`) déclare `shutter` pour les trois volets et gagne les deux
  natures qui divergent : `cover-terrace` (store banne `awning`, déployé à 40 l'été, rentré à 100
  l'hiver) et `cover-gate` (portail `gate`, fermé). Le portail manquait totalement : le
  contre-exemple « un portail ne doit jamais apparaître comme en attente d'ouverture » n'avait
  aucun appareil sur lequel se vérifier.
- Les **deux** copies de `demo-house.json` (rappel de la mise à jour du 2026-09-14 : `house/` et
  `packages/shared/src/house/__fixtures__/`) portent `cover.terrasse` (zone `terrasse`, `size`
  4 × 2,5 m) et `cover.portail` (zone `allee`, `size` 4,4 × 1,6 m), **tous deux sans `openingId`** :
  ce sont des ouvrants LIBRES, que le JSON dimensionne et oriente lui-même
  (`apps/web/src/lib/orientation.ts`). Le portail ne déclare pas `leaves` : deux vantaux sont déjà
  le défaut de sa nature.
- `simulation.test.ts` verrouille les deux moitiés de la règle : aucun ouvrant muet, et le parc
  couvre `shutter` / `awning` / `gate`.

Vérifié dans le navigateur sur la preview `kasbah-mock` (in-process, aucune maison réelle touchée) :
le store propose **Remonter / Stop / Baisser** quand volets et portail proposent Ouvrir / Fermer ;
sa jauge se lit « Descente 60 % » puis « Remonté 0 % » ; il est dessiné **à plat** au-dessus de la
terrasse et rentre vers la façade, quand le portail est un panneau **debout** à deux battants en
travers de l'allée ; l'interrupteur maître « sécuriser » puis « ouvrir » ne rouvre **que les trois
volets** (portail à 0 et store à 100 inchangés) ; et le compte « à affecter » reste à **0** avec un
portail et un store sans ouverture, passe à **1** dès qu'un volet est détaché du sien. Le sélecteur
d'ouvrant d'une ouverture propose le store banne et **jamais** le portail (`canTakeOpening`).

Deux observations relevées au passage, laissées telles quelles (antérieures et hors sujet) : le
compte « 4 ouverts sur 5 » de la vue Ouvrants se lit sur `position > 0` sans regarder la nature, si
bien qu'un store **rentré** y est compté « ouvert » (la tuile d'accueil, elle, sépare bien « volets
ouverts » et « stores baissés ») ; et l'interrupteur d'un ouvrant pris seul suit la convention
« coché = fermé » de son curseur (`toggleChecked`), qui pour un store veut dire **baissé** — c'est
`CoversToggle`, le geste d'ensemble, qui porte la notion de repos.

### Mise à jour 2026-09-19 — l'aspirateur simulé lave, et son réservoir se vide

`behaviours/robots.ts` : l'aspirateur simulé déclare désormais la capacité **`mop`** (voir
[../1_architecture/1_1_contrat-appareils.md](../1_architecture/1_1_contrat-appareils.md)), part
**patin posé** (`mopAttached: true`) et **80 % d'eau**, et **perd son eau en nettoyant** — 70 points
étalés sur la durée du cycle, comme la batterie, et seulement si le patin est posé. Personne ne le
remplit tout seul : le réservoir reste bas jusqu'au prochain démarrage de la simulation.

La raison est une leçon du matin même, pas un souci d'exactitude : le sous-item `vacuum` était
**décoché** dans la maison de démo, si bien que le contrôle `VacuumControl` n'avait jamais été
affiché — et qu'il **débordait de 47 px** depuis des mois sans que personne le voie (détail dans
[../4_ui/4_1_navigation-et-panneaux.md](../4_ui/4_1_navigation-et-panneaux.md)). Livrer deux
contrôles de serpillière vérifiables **seulement avec un vrai Roomba Combo sous la main** aurait
refait exactement la même dette. La règle qui se dégage : **tout champ de contrat ajouté pour un
appareil réel doit avoir un porteur simulé**, sinon sa tenue d'interface n'est vérifiable que chez
celui qui possède la machine.

À noter : le sous-item reste décoché dans la démo. Ce qui change, c'est qu'en le cochant on obtient
maintenant un robot **complet**, pas un aspirateur muet sur la moitié de sa carte.

### Mise à jour 2026-09-20 — `play_url` sur le lecteur simulé

Le `mediaPlayer` mock déclare `play_url` et, à la commande, passe en `playing` avec
`nowPlaying.title` = hôte de l'URL (comme Cast). Source : `behaviours/media.ts`.


### Mise à jour 2026-09-21 — porteurs simulés pour les deux kinds d'animalerie

`behaviours/pets.ts` ajoute `petFeeder` et `petFountain` (deux sous-items cochables de plus, la
table des `parts` passe à 14 *(mise à jour 2026-09-21 : 15 avec `fan`, voir la section suivante)*). La mangeoire sert ses repas aux heures du plan, compte le servi et
le prévu, use son dessiccant ; la fontaine compte des passages, use son filtre et sa batterie plus
vite en continu qu'en intermittent, et **rejoue le rythme de synchronisation par relais** (dix
minutes) pour que la ligne « relevé il y a … » de la carte soit vérifiable.

Le point intéressant est ce que la simulation NE simule PAS, et pourquoi. La mangeoire simulée est
calée sur la capture du vrai appareil : **ni `eatenToday` ni `batteryPct`**, parce que la vraie
machine n'a ni plateau pesant ni piles. Simuler ce que la machine tait donnerait une carte
impossible à vérifier chez soi — l'inverse exact de ce que la règle « tout champ de contrat ajouté
pour un appareil réel doit avoir un porteur simulé » cherche à obtenir.

La fontaine, elle, garde volontairement un écart assumé : elle compte des passages comme la vraie.
Source : `packages/mock-sim/src/behaviours/pets.ts`, `packages/mock-sim/src/scenarios.ts`.

### Mise a jour 2026-09-21 — ventilateur de plafond simule

`ceilingFan` / `ceilingFanLight` dans `behaviours/fan.ts` : reproduisent reglement vitesse
allume et extinction qui efface la minuterie. Present dans le scenario `default` et les DEUX
copies de `demo-house.json` (Chambre 2). Sous-item `fan` cochable via `DEVICE_KINDS`.

## Mise à jour 2026-09-24 — un volet solaire dans la démo

« Volet baie » (`cover-living`) prend l'option `quiet` : capacités `quiet` et `battery`, vitesse divisée
par deux en mode discret, batterie à 86 %. Son panneau est un capteur
`sensors.shutterLight` (`sensor-living-light`, luminance = ensoleillement × 40 000 lx, `linkedTo`
vers le volet). Côté web, `mockTransport.lightHistory` fabrique un historique plausible (48 h, 400
jours) où six heures d'hier manquent exprès, pour voir le tiret d'un pas non mesuré.

### Mise à jour 2026-09-27 — la météo simulée se relit toutes les 20 s de temps réel

Le monde dérive à chaque pas (marche aléatoire des nuages) et l'appareil `weather` publiait à chaque
pas : un pour-cent de nuages suffisait à produire une nouvelle ambiance, donc un ciel, des matières et
des ombres refaits dans la scène 3D **chaque seconde** — trente fois plus vite encore dans le mock
in-process (`timeScale: 30`, `apps/web/src/api/index.ts`).

Désormais `behaviours/weather.ts` n'observe le monde que toutes les `OBSERVATION_REAL_S` = 20 s de temps
**réel**, quelle que soit l'accélération : le contexte de pas porte l'accélération
(`TickCtx.timeScale`, rempli par `Simulation.ctx`). Le vent continue de s'intégrer à chaque pas ;
seule la publication est espacée. Le monde (soleil, production solaire) n'est pas touché. Le premier
pas publie tout de suite (scénarios forcés visibles d'entrée).

Test : `packages/mock-sim/src/simulation.test.ts` (« publishes the weather every 20 real seconds,
whatever the time scale »). Vérifié dans la preview : 2 ambiances en 40 s au lieu d'une par seconde.

Sources : `packages/mock-sim/src/behaviours/weather.ts`, `packages/mock-sim/src/{types,simulation}.ts`.

### Mise à jour 2026-10-02 — logiciel de la Tesla simulée, et un réveil qui dure

`VehicleOptions.software { version, pending?, notes? }` : la Tesla du scénario par défaut est en
2026.32.7 avec 2026.38 téléchargée, et déclare `release_notes` + `software_update`. Une installation
programmée démarre à son heure simulée, `installPct` monte sur `expectedDurationS`, puis la version
change et `softwareUpdate` disparaît ; la voiture reste éveillée pendant l'installation. Notes
simulées en anglais ET en français (`Simulation.releaseNotes(id, lang)`, repli sur l'anglais).

Changement de comportement : `vehicle.wake` tient la voiture éveillée 10 minutes simulées
(`AWAKE_AFTER_WAKE_MS`). Avant, le tick suivant la rendormait en une seconde, et aucun geste qui
exige une voiture éveillée ne pouvait s'essayer.

Sources : `packages/mock-sim/src/behaviours/ev.ts`, `packages/mock-sim/src/{simulation,types,scenarios}.ts`,
test `simulation.test.ts`.

### Mise à jour 2026-10-02 (bis) — un champ retiré de l'état s'efface enfin chez le client

`Simulation.emitDiff` ne parcourait que les champs PRÉSENTS : un `delete s.x` dans un comportement
n'était jamais transmis, et le client gardait l'ancienne valeur (la fin d'une installation affichait
« Installation · 97 % » sous « Installée : 2026.38 » ; la fin d'une charge gardait
`chargeMinutesRemaining`). Un champ disparu part désormais en `null`, qui efface dans un patch
(contrat). Test : `simulation.test.ts` (« a field removed from the state is emitted as null »).

La Tesla simulée laisse aussi un décompte de deux minutes simulées à « installer maintenant »
(`NOW_COUNTDOWN_S`), comme la vraie.

Sources : `packages/mock-sim/src/{simulation.ts,behaviours/ev.ts}`.

### Mise à jour 2026-10-08 — trois parcs de démonstration, caméras, ambiances

**Pourquoi** : les trois maisons de `house/demos/` (`../2_maison/2_0_format-house-json.md`) devaient
montrer *toutes* les fonctions, y compris celles que le simulateur ne savait pas jouer (caméra,
sonnette, TV, porte de garage, ambiances). Le moteur a été étendu, pas contourné.

- **Parcs** : `packages/mock-sim/src/demos.ts` (`tilleulsDevices`, `embrunsDevices`, `belvedereDevices`
  et leurs ambiances `*_SCENES`). Scénarios `tilleuls`, `embruns`, `belvedere` et leurs variantes
  `-winter` (`SCENARIO_NAMES`). La liaison maison ↔ parc doit être **exacte** (les appareils liés
  de la maison et ceux du parc se correspondent un à un) : c'est le test de
  `packages/mock-sim/src/demos.test.ts`, vérifié par un contrôle négatif.
- **Caméra, sonnette, écran** (`behaviours/camera.ts`) : **sans `live_stream`**, donc la vue dit « pas
  de flux » au lieu d'inventer une image. Une sonnette sonne **une fois par jour** à chaque heure de
  `rings` (événement `chime`, émis par `TickCtx.emitEvent`).
- **Lumière** : option `effects` (capacité `effect`, `no_effect` en tête). **Lecteur média** :
  `deviceClass` (`speaker` / `tv` / `display`) et `model`. **Climat** : `deviceClass` (`thermostat` /
  `heat_pump`, qui déclare `meta.climate`).
- **Ambiances** : `Simulation.start(onPatch, onAvailability?, onEvent?, onScene?)`, `scenes()`,
  `sceneState()`, `recallScene(id, { mode, brightness })`. Une lampe réglée à la main **sort de
  l'ambiance** (comme sur Hue) et les autres ambiances du même groupe s'effacent. Le plugin `mock`
  (`apps/server/src/plugins/mock/index.ts`) les publie (`emitScenes`) — sauf si le sous-item
  « Lumière » est décoché —, relaie `recallScene` et `emitEvent`. La caméra est maintenant un sous-item
  (16 kinds).
- **Voitures garées** : le GPS « maison » d'un véhicule est celui de sa **place** (`localToGeo` depuis
  l'origine de la maison), sinon la voiture se posait sur l'origine du repère.
- **Caps des maisons démo à 0** : la tondeuse convertit ses positions avec un cap 0 ; un autre cap
  décalerait le robot par rapport au jardin.
- **Changement de contrat** : rappeler une ambiance que le mock ne connaît pas rend **503
  `DEVICE_UNAVAILABLE`** (scène inconnue), et non plus 501 (test d'intégration
  `apps/server/test/integration.test.ts`).
- **In-process** : `apps/web/src/api/mockTransport.ts` joue les ambiances (liste, rappel, push `scene`)
  et la sonnette (`deviceEvent`) sans serveur.

Quelle propriété le mock peuple, et comment on en change : `../1_architecture/1_2_serveur-et-plugins.md`
(mode démonstration).

Précision sur le piège des « deux exemplaires » plus haut : il ne vaut que pour la maison **des tests**
(`house/demo-house.json` et sa copie de fixtures). Les trois démos de `house/demos/` n'existent qu'une
fois : le serveur et le web les lisent au même endroit.

Sources : `packages/mock-sim/src/{demos,simulation,types,scenarios}.ts`,
`packages/mock-sim/src/behaviours/{camera,light,media,climate}.ts`,
`apps/server/src/plugins/mock/index.ts`, `apps/web/src/api/mockTransport.ts`.

### Mise à jour 2026-10-12 — la tondeuse simulée a des zones et une carte

Pour que la vue Robots montre ses zones et sa carte sans compte fabricant, la tondeuse simulée
(`packages/mock-sim/src/behaviours/robots.ts`) déclare `work_areas`, `stay_out_zones` et `site_map` et
publie :

- deux zones de travail, « Devant » (id 1) et « Fond » (id 2) — le rectangle d'errance coupé en deux ;
- une zone d'exclusion, « Potager », dans la seconde, qu'on peut basculer (`mower.set_stay_out_zone`) ;
- sur la **carte seulement**, une zone de réensauvagement « Prairie », comme chez Husqvarna ;
- `siteMap()` : terrain, zones, câble guide et station, dans le **repère maison** (supposé plein nord,
  comme la `location`) avec la station sur la base du robot.

`mower.start_in_area` y fait errer le robot dans la seule zone demandée (`bounds`) ; `mower.start`
remet tout le terrain. Une zone ou une zone d'exclusion inconnue lève `UNSUPPORTED_COMMAND`. La carte
est relayée par `Simulation.siteMap`, par `siteMap` du plugin `mock` et par `mockTransport.getSiteMap`.
Contrat : `../1_architecture/1_1_contrat-appareils.md`, même date.

Sources : `packages/mock-sim/src/{behaviours/robots,simulation,types}.ts`, `apps/server/src/plugins/mock/index.ts`, `apps/web/src/api/mockTransport.ts`.

### Mise à jour 2026-10-12 (bis) — la tondeuse simulée dit où elle tond

Elle publie `workAreaId` (`0` au planning et sur « tondre », la zone donnée sur « tondre une zone ») et
`leaving` : une vingtaine de secondes « en route » à chaque départ de la station (`depart`), effacé au
retour. De quoi voir la phrase de tâche sans robot réel (`packages/mock-sim/src/behaviours/robots.ts`).

### Mise à jour 2026-10-14 — reprendre le programme, lever une erreur

`mower.start` **sans durée** reprend le programme : plus d'ordre manuel (`manualUntil = 0`), le planning
décide au pas suivant ; en pause hors créneau, le robot repart pour rentrer. Avec durée, rien ne change.
La tondeuse déclare `confirm_error` : `mower.confirm_error` la remet à la station et efface l'erreur si
elle était `errorConfirmable`, sinon refuse (`DEVICE_UNAVAILABLE`). La simulation ne met jamais le robot
en erreur d'elle-même : pour voir le lien, injecter l'erreur dans le store du navigateur
(`packages/mock-sim/src/behaviours/robots.ts`).

### Mise à jour 2026-10-25 — le site simulé a un historique journalier

Pour que la vue Énergie se teste sans vraie installation, le site simulé déclare `energy_history`
(`packages/mock-sim/src/behaviours/energy.ts`). `simulatedDays` fabrique environ 420 jours plausibles
(production saisonnière et nuageuse d'un jour à l'autre, consommation plus forte l'hiver, borne tous les quelques jours, maison répartie entre soleil, batterie et réseau ; bruit déterministe, donc les mêmes jours à chaque appel), et `Simulation.energyDays`
(`simulation.ts`) répartit la production du jour entre les **panneaux simulés** (`partOf: 'energy'`), chacun avec
un rendement propre et stable d'un jour à l'autre, comme un champ réel où un module traîne : de quoi
remplir les cases d'onduleurs. Le plugin mock (`apps/server/src/plugins/mock/index.ts`, hook `energyDays`)
et le transport en mémoire du navigateur (`apps/web/src/api/mockTransport.ts`) le servent. Rien n'est enregistré : la série est fabriquée à chaque appel, aujourd'hui s'arrêtant à l'heure simulée.
