# Plugin Enphase (production solaire, micro-onduleurs, batteries)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/enphase/{index,client,token,cloud,mapping,types}.ts`, `apps/server/src/plugins/enphase/__fixtures__/gateway.ts`, tests `token.test.ts`, `mapping.test.ts`, `plugin.test.ts` et `cloud.test.ts`, `apps/web/src/components/EnphasePairingCard.vue`, `apps/server/.env.example`, note technique du fabricant « Accessing IQ Gateway local APIs or local UI with token-based authentication » (2022-12-14), commits 3b4767a et a89ae3b

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
