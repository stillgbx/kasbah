# Plugin Enphase (production solaire, micro-onduleurs, batteries)

> Dernière mise à jour : 2026-10-26
> Sources : `apps/server/src/plugins/enphase/{index,client,token,cloud,mapping,types,days,inverterDays}.ts`, `apps/server/src/plugins/enphase/__fixtures__/gateway.ts`, tests `token.test.ts`, `mapping.test.ts`, `plugin.test.ts` et `cloud.test.ts`, `apps/web/src/components/EnphasePairingCard.vue`, `apps/server/.env.example`, note technique du fabricant « Accessing IQ Gateway local APIs or local UI with token-based authentication » (2022-12-14), commits 3b4767a et a89ae3b

## Ce que le plugin lit, et ce qu'il ne peut pas lire

La passerelle **IQ Gateway Metered** expose une API **locale** : aucun quota cloud, aucune dépendance
à Internet une fois le jeton posé. Le plugin y prend la production, la consommation, le réseau, la
puissance de chaque micro-onduleur et l'état des batteries IQ.

La **borne IQ EV Charger 2 n'y est pas**. Elle ne parle qu'au cloud Enphase, son Modbus local étant
verrouillé côté installateur (confirmé par le support du fabricant auprès de pyenphase). Le chemin
cloud est ouvert : session Enlighten distincte du jeton local, relevé brut
`GET /api/plugins/enphase/ev/raw`. Le mappage attend la capture du compte réel — voir
la mise à jour du 2026-09-20. En attendant, le kind `ev_charger` du contrat reste servi par la
simulation (décochée sur la maison réelle).

*(Dépassé le 2026-10-01 : le chemin cloud est en place et la borne est commandable — sous-item `ev_charger`, capacité `charge_control`, voir `apps/server/src/plugins/enphase/mapping.ts` — voir « Mise à jour 2026-09-20 » et « Mise à jour 2026-10-01 ».)*

Installation de référence (capturée le 2026-09-11) : des micro-onduleurs, des batteries IQ, deux CT
(production et `net-consumption`).

## Le jeton : un an, et jamais de mot de passe en configuration

Le logiciel 7.0 et plus exige un **JWT** dans `Authorization: Bearer`. Seule `/info` répond sans
jeton — et c'est elle qui donne le **numéro de série**, si bien que l'utilisateur n'a jamais à le
saisir. Le port 80 de la passerelle refuse la connexion : tout passe en HTTPS, sur un certificat
auto-signé, d'où un `Agent` undici dédié (même choix que Hue et TaHoma, jamais en global).

Deux façons d'obtenir le jeton, toutes deux servies par `POST /api/plugins/enphase/token` :

1. **le coller**, après l'avoir créé sur `entrez.enphaseenergy.com` ;
2. **le faire frapper** par le serveur, en deux requêtes au cloud décrites par la note technique du
   fabricant : `POST enlighten.enphaseenergy.com/login/login.json` (formulaire, `user[email]` /
   `user[password]`) rend un `session_id`, puis `POST entrez.enphaseenergy.com/tokens` (JSON
   `{session_id, serial_num, username}`) rend le jeton.

**Décision de l'utilisateur (2026-09-11)** : le mot de passe du compte Enphase n'est **pas** une clé
de configuration, pas même temporaire — « pas de risque d'oublier des identifiants dans le .env ».
Il traverse la requête d'appairage, sert une fois, et n'est ni journalisé, ni écrit, ni renvoyé.
Seul le jeton est conservé, par le serveur, dans `ENPHASE_TOKEN_FILE`. C'est ce qui permet
d'appairer **depuis l'interface** : contrairement à Hue et Nest, il n'y a rien à recopier dans
`.env`, et l'appairage survit aux redémarrages.

Le mot de passe traverse le LAN en HTTP simple (l'app n'est pas servie en TLS) : l'utilisateur l'a
explicitement accepté, et la carte propose le collage de jeton comme voie sans mot de passe.

### Le piège de l'auto-installateur, vérifié sur le vrai compte

Pour un compte à la fois **installateur et propriétaire**, le formulaire web du fabricant ne délivre
qu'un jeton de **12 heures** ; seule la voie programmatique rend celui d'un an. Ce n'est pas
théorique : le premier jeton de l'utilisateur, créé sur le site, a été décodé
`enphaseUser: "installer"` avec onze heures de validité. L'appairage par identifiants a ensuite rendu
un jeton `owner` de 364 jours.

D'où l'affichage du **rôle** et de la date d'échéance dans la carte des Réglages : sans lui,
l'utilisateur ne pouvait que constater une échéance courte sans comprendre pourquoi.

### Ce que `token.ts` décide

- `decodeEnphaseToken` lit `aud` (passerelle visée), `enphaseUser` (rôle) et `exp` **sans vérifier la
  signature** : le vérificateur est la passerelle, pas nous. `null` sur un JWT illisible, pour qu'une
  copie tronquée se dise en clair plutôt que de partir en 401 inexpliqué.
- `checkToken` distingue **trois refus**, parce qu'ils ne se réparent pas pareil : illisible, émis
  pour une **autre passerelle** (le `aud` est comparé au série lu sur `/info`), expiré.
- `tokenStage` classe en `ok` / `expiring` (moins de 30 jours) / `expired`. `health()` rend
  **`degraded`** en `expiring`, ce qui fait passer la pastille des Réglages à l'orange **avant** la
  panne. Un jeton d'installateur naît dans cet état, et c'est voulu.
- `resolveEnphaseToken` choisit, entre `ENPHASE_TOKEN` et le cache, celui qui **expire le plus tard**
  — et non celui de la configuration. Cas vécu : un jeton de 12 h laissé dans `.env` aurait éclipsé
  pendant toute sa durée le jeton d'un an fraîchement frappé et mis en cache.
- Le serveur **refuse de frapper** un jeton quand celui en place est encore valable, sauf
  `force` : chaque frappe crée un jeton chez Enphase, et en accumuler d'inutilisés n'a pas de
  sens. L'appairage par compte répond alors **200** (session Enlighten liée, JWT local intact).

## Les appareils publiés

| Appareil | Kind | Capacités | Source |
|---|---|---|---|
| `enphase:site` | `energy` | `production`, `consumption`, `grid`, `storage` s'il y a des batteries | compteurs |
| un par micro-onduleur, `externalId` = son numéro de série | `sensor` (`deviceClass: power`, W) | `measure` | `/api/v1/production/inverters` |
| un par batterie IQ, `externalId` = son numéro de série | `energy` | `storage` **seul** | `/ivp/ensemble/` |

Une batterie est un `energy` de seul stockage : l'UI lui donne déjà l'icône batterie
(`apps/web/src/lib/strokeIcons.ts` le prévoyait avant ce plugin), et chacune se place dans une pièce.
Les micro-onduleurs sont des capteurs de puissance parce que c'est ce qu'ils mesurent ; c'est aussi
ce que lient les **champs de panneaux** de house.json (`../2_maison/2_0_format-house-json.md`).

## Cinq choses que seules les vraies réponses disent

Les fixtures ont été écrites **depuis une capture** (`GET /api/plugins/enphase/raw`), jamais d'après
la documentation : c'est la leçon de TaHoma (`3_4_somfy-tahoma.md`), et elle a resservi.

1. **Le signe du stockage est inversé.** Le fabricant compte `storage` **positif en DÉCHARGE** ; le
   contrat Kasbah veut positif = charge (`../1_architecture/1_1_contrat-appareils.md`). La preuve est
   le bilan `load = pv + storage + grid`, qui se ferme **au milliwatt** sur la passerelle réelle
   comme sur l'exemple de la note technique. `mapping.ts` inverse donc.
2. **`production.json` donne DEUX productions** : `inverters` (somme des derniers rapports) et `eim`
   (le CT, temps réel). La première traînait de 1,5 kW sur la capture. On lit le CT, l'autre sert de
   repli pour une passerelle sans compteur.
3. **`net-consumption` publie un `whToday` à zéro.** Les Wh du jour se lisent sur
   `total-consumption`, sous peine d'afficher une journée sans consommation.
4. **`/ivp/ensemble/power` porte sa liste sous la clé `"devices:"`**, avec un deux-points final.
5. **`livedata` répond frais même quand `connection.sc_stream` vaut `disabled`** : il n'y a rien à
   activer sur la passerelle.

## Les cadences, dictées par la vitesse de la passerelle

Mesure du 2026-09-11 : `/ivp/livedata/status`, `/api/v1/production/inverters`,
`/ivp/ensemble/inventory` et `/ivp/ensemble/power` répondent en **0,2 s**, mais
`/production.json?details=1` a mis **1,5 s, 3,2 s, 6,6 s puis 10,8 s** sur quatre appels d'affilée.

Trois conséquences, toutes dans `client.ts` et `index.ts` :

- le délai de requête repris de TaHoma (8 s) coupait une lecture sur deux : il est passé à **20 s** ;
- les requêtes s'**enchaînent** au lieu de partir ensemble (`Promise.all` faisait abandonner le petit
  boîtier) ;
- l'état temps réel du site vient de **`livedata`**, qui porte les mêmes compteurs ; `production.json`
  n'est plus payé qu'une fois par minute, pour les totaux du jour que rien d'autre ne donne.

Symptôme si cela régresse : le site reste `available: false` à zéro watt pendant que les panneaux et
les batteries vont bien (commit a89ae3b).

Un onduleur muet depuis plus d'une demi-heure (la nuit, ou en panne) devient **indisponible** et
garde sa dernière valeur, grisée : inventer un zéro serait affirmer une mesure qu'on n'a pas.

## Les routes du plugin

| Route | Rôle |
|---|---|
| `GET /api/plugins/enphase/token` | état de l'appairage pour les Réglages. Ne porte **jamais** le jeton : série, logiciel, rôle, échéance, où le jeton est gardé. |
| `POST /api/plugins/enphase/token` | appairage : `{ token }` (passerelle seule) ou `{ user, password, force? }` (passerelle **et** session Enlighten pour la borne). |
| `GET /api/plugins/enphase/raw` | relevé brut des huit routes locales, pour écrire les fixtures depuis de vraies réponses. Une route en échec est rendue avec son erreur au lieu de faire tomber tout le relevé. |
| `GET /api/plugins/enphase/ev/raw` | relevé brut du cloud EVSE (session Enlighten exigée). Indépendant du jeton local : coller un JWT de passerelle ne suffit pas. |

La carte `apps/web/src/components/EnphasePairingCard.vue` n'apparaît que si l'appairage demande
quelque chose : voir `../4_ui/4_1_navigation-et-panneaux.md`.

## Vérification sur le parc réel

2026-09-11, serveur de test sur un port dédié, jamais celui de l'utilisateur : appareils publiés,
production, injection et totaux du jour lus, aucune erreur dans les journaux. Les numéros de série des fixtures sont **remplacés par de faux**
avant d'entrer dans le dépôt.

## Mise à jour 2026-09-11 — la production ne descend pas sous zéro

**Symptôme** : « −7 W · Production » affiché la nuit, dans le nœud du schéma de flux comme dans la
ligne d'en-tête de la maison.

**Diagnostic** : la pince de production lit à l'envers le courant de **veille des micro-onduleurs**,
qui remonte la chaîne. C'est une mesure honnête du matériel, mais pas une production : un champ
photovoltaïque produit ou ne produit pas, il ne consomme pas.

**Solution** : `productionW` est ramenée à `Math.max(0, …)` dans `mapping.ts`, sur les **deux
chemins** — `livedata` (temps réel) et le repli `production.json` — avec un test qui injecte
`-7000 mW` et `wNow: -7` (`mapping.test.ts`). Le correctif vit dans le plugin, et non dans l'UI : c'est
au plugin de traduire le travers de son matériel vers le contrat, comme il redresse déjà le signe du
stockage. Conséquence, un seul correctif sert le schéma de flux, l'en-tête, la couleur des modules
dans la scène 3D et l'historique. L'invariant est écrit dans le contrat partagé
(`../1_architecture/1_1_contrat-appareils.md`).

### Deux mesures qui servent au-delà du plugin

**Au crépuscule, la passerelle produit vraiment.** Les micro-onduleurs sont à 1, 2 ou 3 W chacun, tous
`available` (rapport frais), soit **quelques dizaines de watts** au compteur du site. L'appli Enphase affiche « 0,0 » au
même instant : elle arrondit au dixième de kW. Son affichage n'est donc **pas** une référence pour
décider qu'il ne passe rien — voir `../6_faq/6_1_pieges-runtime.md`.

**Les compteurs ne se ferment pas toujours.** Le bilan `production + réseau − batterie = consommation`
s'est fermé **au watt** sur un relevé, preuve que les pinces mesurent fin.
Mais sur huit relevés d'affilée pris une heure plus tard, il laissait un reste de **0 à 11 W**. Ce
désaccord est la quantité qui fixe le seuil « rien ne passe » de la vue Énergie, posé à 10 W
(`../4_ui/4_1_navigation-et-panneaux.md`) : plus bas, c'est le désaccord entre compteurs qu'on
dessinerait comme un flux.


### Mise à jour 2026-09-12 — cinq chiffres de numéro de série, partout les mêmes

`shortSerial` (`apps/server/src/plugins/enphase/mapping.ts`) coupait les numéros de série à **six**
caractères (« Onduleur 123456 ») alors que la grille d'un champ de panneaux en affichait **quatre**
(« 3456 ») : deux fins de numéro différentes pour le même appareil, impossibles à rapprocher quand on
garnit un champ avec le plan d'installation à la main. Les deux sont passées à **cinq**
(`SHORT_SERIAL`, cité de part et d'autre), et la case de la grille prend désormais la fin des
**chiffres** plutôt que la fin des caractères — un identifiant non numérique (`panel-s10`) donnait
« L-S10 » au lieu de « 10 ».

La longueur est un choix d'affichage, pas une contrainte du fabricant : les identifiants complets
restent les `externalId`, et rien d'autre ne les tronque.

### Mise à jour 2026-09-13 — `maxReportWatts` est un record, jamais une fiche technique

`/api/v1/production/inverters` porte, à côté de `lastReportWatts`, un `maxReportWatts` : le maximum
jamais rapporté par cet onduleur. Il remonte désormais jusqu'à l'app (`SensorState.maxValue`, cf.
[contrat appareils](../1_architecture/1_1_contrat-appareils.md)) et s'affiche en repère « record »
sur les jauges de la vue Énergie et sur le module en 3D. Il est optionnel dans la réponse : absent,
aucun record n'est inventé.

**Ce qu'il ne permet PAS**, et la capture le montre seule : en déduire la puissance de
sortie de l'onduleur. Les valeurs relevées sont chacune différente, sans le
moindre plateau — c'est le meilleur moment de l'année de chaque onduleur, pas son écrêtage. Aucune
route interrogée par le plugin ne publie la puissance nominale d'un micro-onduleur ; `/inventory.json`
liste bien les PCU avec un `part_num`, mais y associer un modèle à sa puissance serait une table
devinée. D'où la saisie sur le champ de panneaux (`maxOutputW`), 480 W pour des IQ8P.

Source : `apps/server/src/plugins/enphase/mapping.ts`, fixture `__fixtures__/gateway.ts`, test
`mapping.test.ts` (« les records de la capture sont des valeurs sans plateau »).

### Mise à jour 2026-09-20 — chemin cloud de la borne, capture d'abord

L'API officielle Enlighten v4 (plan Watt, 1 000 appels/mois, télémétrie 15 min, commandes
réservées VPP) ne sert pas un écran qui veut l'état live. Même décision que Renault : on
parle à l'API privée de l'appli Enphase.

Ce qui est en place, et ce qui ne l'est pas encore :

- **Même plugin**, sous-item `ev_charger` (coché par défaut). La production locale ne dépend
  plus d'Internet.
- **Deux caches** : le JWT d'un an de la passerelle (`ENPHASE_TOKEN_FILE`) et une session
  Enlighten (`ENPHASE_CLOUD_FILE`). Coller un jeton n'ouvre PAS le cloud ; seuls les identifiants
  du compte le font. Le mot de passe n'est toujours pas une clé de configuration.
- Appairage par compte : la session Enlighten est enregistrée **même** si le jeton local est
  encore valable (HTTP 200, JWT non recréé). Deux secrets distincts : le `session_id` JSON
  frappe le JWT de passerelle ; le cookie `_enlighten_4_session` ouvre l'API de la borne.
  Les coller l'un pour l'autre → 401. Le bouton de la carte dit **Valider**.
- `GET /api/plugins/enphase/ev/raw` sonde les routes EVSE (état, résumé, appareils, firmware).
  Une route en échec est rendue avec son erreur, comme `/raw`.
- **Mappage lecture seule** d'après la capture du 20/09 : une IQ EV Charger 2 EU 32 A,
  branchée, pas en charge (`SUSPENDED_EVSE` / `INSUFFICIENT_SOLAR` = `connected`, pas une
  panne). `e_c` → `sessionWh` (Wh). Aucun watt dans cette trame → `powerW` 0. Pas de
  `charge_control` tant qu'aucune commande n'a été capturée. Le sous-item `ev_charger`
  se décoche. Deux sites Enlighten : on lit celui retenu à l'appairage (`sites[0]`).

Sources : `apps/server/src/plugins/enphase/{cloud,token,index}.ts`, tests `cloud.test.ts` et
`plugin.test.ts`, carte `EnphasePairingCard.vue`.

> **Corrigé le 2026-10-01** : « mappage lecture seule » et « pas de `charge_control` tant qu'aucune
> commande n'a été capturée » ci-dessus ne sont plus vrais. La borne se commande, cf. la section
> suivante.

### Mise à jour 2026-10-01 — la borne se COMMANDE : démarrer, arrêter, et ce que « arrêter » coûte

Essayé sur la vraie borne le 2026-10-01. Le descripteur déclare désormais la capacité
**`charge_control`** (boutons Démarrer / Arrêter de l'UI) et `meta.evCharger.stopUntilUnplug: true`.
Il ne déclare PAS `charge_current` : l'intensité ne se règle pas, Démarrer prend celle de l'appli.

**Les routes** (API privée Enlighten, relevées dans l'intégration Home Assistant
`barneyonline/ha-enphase-energy` puis essayées sur la borne) :

- `POST /service/evse_controller/{site}/ev_chargers/{sn}/start_charging`, corps
  `{ chargingLevel, connectorId: 1 }` → `{ data: { chargingLevel }, error: {} }` ;
- `PUT …/stop_charging`, sans corps ;
- lecture du mode : `GET /service/evse_scheduler/api/v1/iqevc/charging-mode/{site}/{sn}/preference`
  avec `Authorization: Bearer <accessToken>` (le jeton de `/users/self/token`, déjà gardé, suffit).
  Modes : `GREEN_CHARGING`, `SCHEDULED_CHARGING`, `MANUAL_CHARGING`, `SMART_CHARGING`. **Le plugin ne
  lit pas encore le mode** : il ignore donc dans quel mode la borne se trouve.

**Le piège : arrêter la borne la bloque.** En charge verte, `start` ET `stop` posent tous deux une
**annulation manuelle « jusqu'au prochain débranchement »** : le `mode` de `/ev_chargers/status` passe
de 1 (vert) à 0 alors que la préférence reste `GREEN_CHARGING`. La borne repasse seule en vert au
débranchement (dit par l'utilisateur, confirmé par l'appli). Conséquence : un `stop` coupe la charge
jusqu'au débranchement, **soleil ou pas** — constaté, l'appli affichait « Pas de charge – annulation
manuelle ». D'où `stopUntilUnplug`, que l'UI dit sous Arrêter.

Impasse : réécrire `GREEN_CHARGING` (PUT sur la préférence) pour lever l'annulation est **refusé**,
HTTP 400 `iqevc_sch_10028` « Charging mode is already enabled ». Seuls l'écran des modes de l'appli ou
le débranchement la lèvent.

**L'intensité envoyée.** L'appli « Charger maintenant » envoie le `defaultChargeLevel` du résumé
(24 A ici). Un `start` SANS intensité a pris 32 A côté cloud et la borne n'a rien donné en 90 s
(`SUSPENDED_EVSE`, `SwitchingPhases`) ; avec 24 A, le courant arrive en ~20 s. Le plugin envoie
`defaultChargeLevel ?? maxCurrent`, arrondi.

**Le client.** `EnlightenClient.send(method, path, body)` (`cloud.ts`) sert l'écriture : un `error` non
vide sous HTTP 200 est un REFUS (`UPSTREAM_ERROR`), un 409 / 422 dit la borne pas prête
(`DEVICE_UNAVAILABLE`). `getJson` en est devenu un cas. Le plugin relit la borne 45 s après une
commande (`EV_FOLLOW_UP_MS`) : le courant met de 20 s à 1 min à venir.

**Mode sécurisé.** `connectors[0].safeLimitState` à 1 veut dire que la borne s'est repliée sur son
intensité de sécurité (8 A d'après l'appli) : sa « répartition dynamique de la charge » n'a plus de
mesure. Publié en `safeLimit` dans l'état. Vu actif lors d'un essai (une puissance réelle bien
inférieure à celle demandée). La capture du 20/09 montrait `gwConnStatus: 0` : la borne n'est pas reliée à la
passerelle. C'est un problème d'installation, à régler dans l'appli (Menu →
Paramètres → Chargeur VE → Connectivité), pas dans Kasbah.

**Ce que la borne ne dit pas.** Elle peut se croire attelée à un autre constructeur
(`evManufacturerName`) que celui de la voiture branchée : aucun champ ne dit quelle voiture est au bout du câble. C'est
pourquoi la coordination voiture ↔ borne a une règle prudente
(`../1_architecture/1_2_serveur-et-plugins.md`).

**Question ouverte.** Une première session forcée est retombée seule en charge verte au bout
d'environ 2 min 30, sans geste de l'utilisateur ; non reproduit au second essai (tenue plus de
6 min). Cause inconnue.

Sources : `apps/server/src/plugins/enphase/{cloud,index,mapping}.ts`, tests `mapping.test.ts` et
`plugin.test.ts`, `packages/shared/src/devices/{descriptor,state}.ts`.

### Mise à jour 2026-10-02 — l'annulation qui survit au débranchement, et le mode d'avant rendu

**Ce qui s'est passé sur la vraie borne.** Le chat (serveur MCP) a réglé la cible de charge d'une voiture à 50 % puis lancé la
charge : Kasbah a forcé la borne (`start_charging`). La voiture s'est arrêtée seule à 51 %. Débranchée,
la borne tenait ENCORE son annulation : `mode` 0 dans `/ev_chargers/status`, préférence toujours
`GREEN_CHARGING`, et l'appli de l'utilisateur ne pouvait plus remettre le vert (même refus
`iqevc_sch_10028` « Charging mode is already enabled », vu comme « server error »). Le même matin,
`/ev_chargers/status` (v1) a rendu des HTTP 500 passagers : la borne a disparu de Kasbah le temps
d'une relecture.

**Ce qui lève l'annulation** (essayé ce jour-là, borne débranchée) : `PUT` de la préférence
`{ "mode": "MANUAL_CHARGING" }`, puis `{ "mode": <le mode d'avant> }` une vingtaine de secondes plus
tard. Relu : `mode` 1, `sch_d.status` 0. La préférence lue rend aussi `config.isModeCancellable: true`.

**Le mode d'avant**, c'est la préférence de l'appli : un forçage ne la change pas
(`enabledChargingMode`, `mapping.ts`, le `modes.*` marqué `enabled`). `mode` 0 est publié en
`manualOverride` sur `EvCharger`. Le plugin le rend dans deux cas :

- **à la limite de charge**, voiture branchée : le serveur envoie `ev_charger.resume_mode`
  (`1_architecture/1_2_serveur-et-plugins.md`, même date). Rien si la borne n'est plus sous
  annulation ou si la préférence est le manuel. Le passage en manuel part dans la commande, le
  retour 5 s plus tard hors de son délai (`KASBAH_COMMAND_TIMEOUT_MS`, 10 s) ;
- **au débranchement** (`restoreModes`, à chaque relecture de la borne) : débranchée et `mode` 0,
  la préférence est rendue si Kasbah avait forcé la borne, ou si c'est le vert (sans forçage connu,
  après un redémarrage, on ne sait pas ce que vaut `mode` en charge programmée). Une tentative par
  quart d'heure (`MODE_RESTORE_RETRY_MS`), remise à zéro par un nouveau forçage.

Un retour refusé reste DÛ (`owed`) et se retente à la relecture suivante sans repasser par le
manuel : une borne laissée en manuel chargerait sur le réseau au prochain branchement. Un ARRÊT ne
rend pas le mode avant le débranchement : la charge verte recommencerait au soleil.

### Contradiction détectée 2026-10-02 — ARBITRÉE par l'utilisateur

La section du 2026-10-01 dit que la borne « repasse seule en vert au débranchement (dit par
l'utilisateur, confirmé par l'appli) ». Le 2026-10-02, débranchée depuis un quart d'heure, elle tenait encore
`mode` 0.

**Arbitrage** (utilisateur, 2026-10-02) : les deux sont vrais. Le retour seul au mode d'avant est le
comportement normal de la borne, mais il n'est **pas garanti** : ça peut déconner, et dans ce cas
c'est Kasbah qui remet le mode lui-même (`restoreModes` au débranchement, `ev_charger.resume_mode`
à la limite de charge, ci-dessus). Quand la borne y est revenue seule, Kasbah n'a rien à faire : il
ne touche à rien tant que `mode` n'est pas 0.

Sources : `apps/server/src/plugins/enphase/{index,mapping}.ts`, fixture `EVSE_PREFERENCE`
(`__fixtures__/evse.ts`, capture du 2026-10-02), tests `plugin.test.ts`.

### Mise à jour 2026-10-15 — l'annulation manuelle se VOIT, et se lève depuis la carte de la borne

**Le constat, sur la vraie maison.** Voiture branchée sous sa cible, surplus solaire exporté,
batteries pleines, préférence de la borne en charge verte, et pourtant rien ne coulait. Le
connecteur disait `SUSPENDED_EVSE` (c'est la BORNE qui retient le courant, pas la voiture qui le
refuse), sans `INSUFFICIENT_SOLAR`, et `mode` valait 0 : une annulation manuelle « jusqu'au
débranchement » (section du 2026-10-01). L'appli comme Kasbah continuaient d'afficher la charge
verte, puisque la préférence ne change pas. Origine non retrouvée : aucune automatisation ne touche
à la charge, et un démarrer / arrêter depuis l'appli ou depuis Kasbah (« Arrêter la charge » de la
R5 passe par la borne, `chargerToStop`) pose la même annulation. `ev_charger.resume_mode` envoyé à la
main l'a levée (relu : `mode` 1), et la charge verte est repartie en quelques minutes.

**Ce qui change.** `mode` 0 était lu (`manualOverride` sur `EvCharger`, `mapping.ts`) mais restait
interne au plugin. Il est maintenant dans le contrat : `manualOverride` sur l'état `ev_charger`
(`packages/shared/src/devices/state.ts`), publié par `toChargerPatch` quand la borne donne `mode`.
Absent = la borne ne le dit pas (la borne simulée, par exemple).

**Dans l'interface** (`apps/web/src/components/controls/EvChargerControl.vue`) : sous les boutons,
« Annulation manuelle jusqu'au débranchement » (explication en info-bulle) et un bouton **Reprendre**
qui envoie `ev_charger.resume_mode`, la commande déjà utilisée à la limite de charge
(`resumeMode`, `index.ts`) : passage en manuel, puis retour à la préférence. L'avertissement et l'aide
« Arrêter bloque la borne… » partagent la même cellule de grille, seule la visibilité change : la
carte ne grandit pas et rien ne bouge quand l'annulation apparaît (mesuré en fr et en en, zooms 1 /
1,25 / 1,5, sur la borne simulée).

**Ce qui n'est pas fait.** Le réveil de charge de la R5 (`maybeWake`, `3_9_renault.md`) continue de
partir pendant une annulation, pour rien : le blocage est côté borne. Le couper demanderait qu'un
plugin voie l'état des autres appareils, ce que `PluginContext` ne donne pas (choix d'architecture,
laissé à l'utilisateur). Coût actuel : au plus une écriture dans la voiture par quart d'heure, dans
la fenêtre du réveil.

Sources : `packages/shared/src/devices/state.ts`, `apps/server/src/plugins/enphase/mapping.ts`
(test `mapping.test.ts`), `apps/web/src/components/controls/EvChargerControl.vue`, clés
`charger.manualOverride` / `manualOverrideHint` / `resumeMode` des locales.

### Mise à jour 2026-10-15 (bis) — le mode de la borne se CHOISIT : charge verte ou manuel

Demande de l'utilisateur : puisque Kasbah sait écrire la préférence de l'appli (passage en manuel
puis retour, section du 2026-10-02), la proposer directement, sur la carte et par le MCP. **Vert et
manuel seulement**, les deux seuls PUT essayés sur la vraie borne ; programmé et intelligent
dépendent de réglages de l'appli (horaires, profil) que Kasbah ne lit pas.

**Le contrat** (`packages/shared/src/devices/`) : capacité `charge_mode` (`kinds.ts`), état
`chargeMode` (`green` / `manual` / `scheduled` / `smart`, le mode de l'appli tel qu'il est lu) et
commande `ev_charger.set_mode` dont le `mode` n'accepte que `SETTABLE_CHARGE_MODES` (`green`,
`manual`). Le MCP n'a rien eu à faire : `send_command` prend `commandSchema` pour schéma d'entrée,
la commande et ses deux valeurs y sont donc d'office.

**Le plugin** (`setMode`, `index.ts`) :

- autre mode que celui en cours : un seul PUT de la préférence. Il lève aussi une annulation : c'est
  le second temps de `resumeMode`. Ce que Kasbah devait rendre (`owed`, `forced`) est oublié, le
  choix de l'utilisateur passe avant ;
- même mode sous annulation : `resumeMode` (manuel, puis retour) ; même mode sans annulation : rien,
  le cloud refuserait (`iqevc_sch_10028`).

**La lecture du mode** (`preferenceOf`) : relue au plus toutes les dix minutes
(`PREFERENCE_TTL_MS`), et aussitôt après une écriture, au lieu d'une fois par relecture de la borne
(chaque minute) : elle ne change qu'à la main. Une lecture ratée garde l'ancienne.

**En mode manuel, `mode` 0 n'est plus publié comme annulation** (`toChargerPatch`, paramètre
`preference`) : il n'y aurait rien à « reprendre », `resumeMode` ne fait rien en manuel. Déduit de la
séquence du 2026-10-15 (`mode` 0 relu pendant le passage en manuel), pas encore observé en mode manuel
tenu.

**L'interface** (`EvChargerControl.vue`) : deux boutons « Charge verte » / « Manuel » au-dessus de
Démarrer / Arrêter, celui du mode en cours en couleur primaire, une info-bulle par mode (le manuel
charge sur le réseau s'il le faut). En programmé ou intelligent, aucun n'est allumé. Mise à jour
optimiste : `chargeMode` et plus d'annulation (`optimistic.ts`). Mesuré sur la borne simulée : rien
ne bouge au changement de mode, pas de débordement en fr / en aux zooms 1 / 1,25 / 1,5.

**Pas encore vu sur la vraie borne** : un `set_mode` isolé. Les deux PUT l'ont été, enchaînés, le
2026-10-02 et le 2026-10-15.

Sources : `packages/shared/src/devices/{kinds,state,command}.ts` (test `rules.test.ts`),
`apps/server/src/plugins/enphase/{index,mapping}.ts` (tests `plugin.test.ts`, `mapping.test.ts`),
`apps/web/src/components/controls/EvChargerControl.vue`, `apps/web/src/lib/optimistic.ts`,
`docs/plugins/enphase.md`.

### Mise à jour 2026-10-23 — `/ev/raw` ne rend plus le jeton du compte

Constat d'un audit de sécurité : la sonde `GET /api/plugins/enphase/ev/raw` interrogeait aussi
`/users/self/token` et en recopiait la réponse, soit le jeton d'accès Enlighten du compte, utilisable depuis
Internet (piloter la borne, lire le site) par quiconque appelait la route. Ce chemin est retiré de
`EV_RAW_PATHS` (`apps/server/src/plugins/enphase/cloud.ts`) ; la sonde dit seulement s'il est obtenable
(`hasAccessToken`). La lecture du jeton pour les commandes (`readAccessToken`) ne change pas.

### Mise à jour 2026-10-24 — certificat de la passerelle épinglé, fichiers d'identifiants en 0600

Constat F37 : le jeton propriétaire d'un an partait en `Bearer` vers `https://ENPHASE_HOST` (par défaut
`envoy.local`, un nom mDNS que tout hôte du réseau peut prendre) sans aucun contrôle du certificat. Il
est désormais épinglé au premier contact dans `.state/enphase-tls-pin.json`, fichier à part car le
fichier du jeton est facultatif ; l'épingle couvre aussi `/info`. Ré-appairer (`POST /token`, jeton collé
ou compte) l'efface. Une mise à jour du logiciel de la passerelle peut changer son certificat : il faut
alors ré-appairer. Mécanisme commun : `apps/server/src/core/tls-pin.ts` (empreinte SHA-256 apprise au premier contact, contrôle sur le socket établi avant toute écriture ; reprise de session TLS coupée, car une session TLS 1.3 reprise n'expose pas de certificat ; un certificat absent est refusé). Rien n'a encore été essayé sur le vrai matériel : au premier démarrage, le journal doit montrer `device certificate pinned`. Une mise à jour de firmware qui change le certificat met le plugin en erreur jusqu'au ré-appairage : c'est voulu.

Constats F26, F31, F33 : le jeton de passerelle et la session Enlighten sont désormais écrits en 0600,
comme les autres fichiers d'identifiants du serveur.

### Mise à jour 2026-10-25 — l'historique journalier du site et de chaque onduleur

**Pourquoi.** La vue Énergie ne savait montrer que l'instant et 48 h (`core/history.ts`, en mémoire). Les
vues Semaine, Mois, Année et Total exigent des cumuls **par jour**, que la passerelle ne garde pas :
elle ne connaît que les compteurs du jour (production, consommation) et la production à vie de chaque
micro-onduleur. Le plugin tient donc lui-même un historique persistant (`apps/server/src/plugins/enphase/days.ts`,
`inverterDays.ts`).

**Le site** (`EnergyDays`, `.state/enphase-days.json`, variable `ENPHASE_DAYS_FILE`). Un jour est clé par
sa date **locale** `AAAA-MM-JJ`, jamais par un instant : il dure 23 ou 25 h aux changements d'heure, une
clé de date s'en moque. Deux sources par jour :
- **le vendeur** : la route privée Enlighten `GET /pv/systems/{site}/lifetime_energy`, appelée avec la
  session déjà tenue pour la borne. UN appel rend une valeur par jour depuis la mise en service
  (`production`, `consumption`, `import`, `export`, `charge`, `discharge`, `solar_home`, `battery_home`,
  `grid_home`, `evse`) ; `null` = non rapporté, et le champ reste absent du jour (jamais zéro) ;
- **nos relevés** : compteurs du jour de la passerelle pour production et consommation (exacts, avec la
  règle « un compteur pas encore remis à zéro dans les 15 min après minuit appartient à la veille ») ;
  intégration de la puissance (livedata, 10 s) pour réseau, batterie et les trois parts de la maison
  (**approché** : la passerelle ne tient aucun compteur fiable pour elles) ; énergie de session de la
  borne pour la borne, le cloud ne donnant aucune puissance de borne. Un jour local est `partial` si le
  serveur ne l'a pas vu en entier (aujourd'hui : depuis minuit seulement). **Aujourd'hui reste toujours
  local**, même si le vendeur a déjà une valeur.

**Écarté : l'API officielle v4** (inscription développeur, OAuth) : trop de démarches pour une donnée que
la session Enlighten déjà tenue donne en un appel. Contrepartie : ce sont des routes **privées**, que le
fabricant peut changer ; les schémas (`lifetimeEnergySchema`, `arrayLayoutSchema`, `inverterEnergySchema`)
sont tolérants, une forme inattendue lève `UPSTREAM_ERROR` sans toucher au fichier.

**Par onduleur** (`inverterDays.ts`, `.state/enphase-inverter-days.json`, `ENPHASE_INVERTER_DAYS_FILE`).
- Passerelle : `/ivp/pdm/device_data` lu toutes les 5 min (`DEVICE_DATA_MS`, 50 Ko environ, les micros ne
  rapportent pas plus souvent). Par micro `pcu` : `wattHours.today`, et `lifetime.joulesProduced`,
  en **joules** (divisé par 3600 pour les Wh : piège de l'unité). Le cumul à vie est servi tel quel,
  exact même quand des jours manquent.
- Cloud : `GET /systems/{site}/inverter_data_x/energy.json?start_date&end_date` rend la **somme** par
  onduleur sur la plage, pas des séries, avec pour clés l'id Enlighten à 9 chiffres. La correspondance
  avec les numéros de série vient de `GET /pv/systems/{site}/array_layout_x`
  (`arrays[].modules[].inverter.{inverter_id, serial_num}`).
- **Rattrapage tout en jours** : un appel par jour, 2 s entre appels (`VENDOR_DAY_GAP_MS`), en arrière-plan,
  après la synchro du site. Choix de l'utilisateur, contre un mélange « mois + 62 derniers jours »
  (moins d'appels) : le motif détaillé n'est pas consigné.

**Resynchro intelligente.** Chaque jour a un état : `c` complet, `p` incomplet, `m` absent (et `e`, voir « Mise à jour 2026-10-25 (bis) »). Site : complet
si le vendeur ne l'a pas donné partiel, ou si le local l'a vu en entier ; onduleurs : complet si le
vendeur l'a donné, ou si la passerelle a été lue à moins de 20 min de minuit (`WHOLE_DAY_SLACK_MS`). Par
défaut on ne reprend que les jours non complets ; `force: true` reprend tout.
- **Automatique seulement** quand l'historique est vide et le compte Enlighten lié : au démarrage, ou
  juste après l'appairage par compte. Un appairage par jeton collé ne l'ouvre pas (pas de session
  Enlighten, donc pas de route privée).
- Sinon, à la demande : `POST /api/plugins/enphase/history/sync { force?: boolean }`, qui rend le même
  état que `GET /api/plugins/enphase/token`.
- `GET …/token` porte désormais `history { syncedAt, since, days, syncing, error, inverters { syncedAt,
  done, total, error }, coverage { from, days: 'ccpm…' } }` : `coverage.days` est une chaîne d'un
  caractère `c`/`p`/`m` par jour depuis `from`, que la carte des Réglages dessine en frise.

**Variables** (`apps/server/.env.example`) : `ENPHASE_DAYS_FILE` et `ENPHASE_INVERTER_DAYS_FILE`, par
défaut dans `.state/` ; ils s'ajoutent à `health().keys`.

**Vérifié** sur la vraie installation : les routes privées ci-dessus ont été sondées avec la session
déjà tenue. Aucune valeur de l'installation n'est consignée ici.

### Mise à jour 2026-10-25 (bis) — un jour sans rien chez Enphase est connu, pas absent

Première synchronisation réelle : réussie (site puis onduleurs jour par jour, sans erreur), mais les
deux premiers jours restaient « absents » : `inverter_data_x/energy.json` répond pour eux sans aucune
valeur d'onduleur (mise en service, les micro-onduleurs ne rapportaient pas encore). Chaque
resynchro les redemandait, et la frise les montrait comme un trou à combler.

Désormais un jour auquel Enphase répond **vide** est retenu comme tel (`empty: true` dans
`.state/enphase-inverter-days.json`) et prend un quatrième état, `e` « rien chez Enphase »
(`DayStatus` = `c` | `e` | `p` | `m`, rang croissant pour la frise : le pire l'emporte). La resynchro
intelligente saute les jours `c` **et** `e` ; « Tout reprendre » les redemande. Exception : **la veille**
n'est jamais retenue vide, le cloud peut simplement ne pas l'avoir reçue. Une réponse ultérieure avec
des valeurs remplace le jour vide. La carte dessine `e` en gris discret, distinct du pointillé
« absent », et ne le compte pas dans « Reprendra N jours ».

Sources : `apps/server/src/plugins/enphase/{inverterDays,days,index}.ts`, tests `inverterDays.test.ts`
et `plugin.test.ts`, `apps/web/src/components/EnphasePairingCard.vue` et son test.

### Mise à jour 2026-10-26 — `maxReportWatts` oublie ses pics : le record vient de notre historique

**Ce qui était faux.** La section du 2026-09-13 (et `1_1`) tenaient `maxReportWatts` pour le maximum
« jamais rapporté », « le meilleur moment de l'année », un record qui ne s'efface pas. Vérifié sur la
vraie installation : **la passerelle oublie ses pics en quelques jours**. Les pics d'été avaient
disparu un mois plus tard ; certains onduleurs gardaient encore le pic de la veille, donc ce n'est pas
non plus exactement le pic du jour : c'est un maximum sur une fenêtre récente, de durée inconnue. Ce
qui reste vrai de l'ancienne section : ce n'est pas la puissance nominale (`maxOutputW` se déclare à
la main). Le champ n'est plus publié (retiré de `inverterSchema`, `types.ts`) ; il reste dans la
fixture de capture, et `mapping.test.ts` vérifie qu'il ne ressort jamais.

**La nouvelle source.** Route privée Enlighten, avec la session déjà tenue :
`GET /systems/{site}/inverter_data_x/time_series.json?start_date=AAAA-MM-JJ&end_date=AAAA-MM-JJ`.
Réponse : `{ "AAAA-MM-JJ": { "<id Enlighten>": { POWR: [[epoch s, W moyen sur le quart d'heure, 900], …] } }, haiku: … }`,
soit 96 points par jour et **tous les onduleurs en un appel**. Les clés qui ne sont pas des jours
(`haiku`, et `date` dans la variante `?date=`) sont ignorées (`peaksOfTimeSeries`). Mesuré : 7 jours en
un appel ≈ 7 s et 290 Ko ; **31 jours dépassent le délai cloud de 15 s**. La même semaine a pris
11 à 13 s l'après-midi du même jour, et le premier rattrapage réel a échoué sur un dépassement : les
tranches sont donc de **3 jours** (`PEAK_CHUNK_DAYS`, ≈ 5 s, deux fois plus d'appels). Écartée : `/systems/{site}/inverters/{id}/time_series_x?stat=POWR&date=`,
qui coûte un appel par onduleur (elle donne en plus DCV, DCA, ACV, ACHZ et TMPI, dont on n'a pas
l'usage). La correspondance id ↔ série reste `array_layout_x`, lue une fois (`serialOf`).

**Stockage.** `.state/enphase-inverter-days.json` gagne `peakW: { jour: { série: W } }` (défaut `{}` :
un ancien fichier se relit). `importVendorPeaks` retient un jour vide comme « connu vide » seulement
avant hier (même réserve que pour les Wh : le cloud n'a peut-être pas reçu les derniers jours) ;
`peaklessDays` liste les jours sans pic ; `recordOf(serie)` rend le meilleur pic quotidien de tout
l'historique.

**Rattrapage.** Dans `syncInverters`, **après** les Wh : les jours sans pic sont regroupés en runs
consécutifs de 3 jours au plus (`peakChunks`), un appel chacun, 2 s entre appels, comptés dans la
progression « Onduleurs » de la carte Réglages. `force: true` reprend tous les pics. **Une tranche en
échec ne coûte que ses jours** : la boucle continue, l'erreur dit « N/M peak requests failed, last: … ».
Dans la frise (`coverage`), un jour dont les Wh sont complets mais qui n'a pas de pic compte comme
**incomplet** (`p`) : sans ça, tout paraissait complet et « Resynchroniser » restait grisé, sans moyen
de reprendre les pics manquants. Au démarrage, `autoSync` relance la synchro si des pics manquent
(`peaksMissing`) : une installation déjà synchronisée rattrape seule, environ 115 appels depuis sa mise
en service. **Aujourd'hui et hier** sont
redemandés toutes les 15 min (`PEAKS_REFRESH_MS`) tant que le compte Enlighten est lié : c'est le
seul appel cloud régulier ajouté.

**Une seule source, choix délibéré.** Quart d'heure pour tous les jours, sans mélanger avec les pics
instantanés de la passerelle : une moyenne sur 15 min est environ 10 % sous un pic instantané, un
record « Jour » (instantané) et un record « Mois » (quart d'heure) n'auraient pas été comparables.
Conséquence à connaître : la puissance instantanée d'un onduleur peut dépasser son record. Ce n'est
pas un plafond.

**Sans compte Enlighten lié** : pas d'historique, donc pas de record (`toPanelPatch` ne publie pas
`maxValue`). Affichage : [4_4](../4_ui/4_4_vues-energie-vehicules.md) ; contrat :
[1_1](../1_architecture/1_1_contrat-appareils.md) ; protocole : `peakW` dans
[1_14](../1_architecture/1_14_energie.md).

Sources : `apps/server/src/plugins/enphase/{inverterDays,index,mapping,types}.ts` et leurs tests.
