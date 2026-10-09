# Plugin Tesla (véhicules, Fleet API)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/tesla/{index,auth,client,mapping,types}.ts`, `apps/server/src/plugins/tesla/__fixtures__/fleet.ts`, tests `mapping.test.ts` et `plugin.test.ts`, `apps/web/src/components/TeslaLinkCard.vue`, `apps/web/src/views/VehiclesView.vue`, `apps/server/.env.example`, documentation developer.tesla.com (Fleet API : billing-and-limits, vehicle-endpoints, third-party-tokens, virtual-keys), relevé de l'utilisateur (Model S, MCU2), mise en route sur le vrai compte le 2026-09-13 (soir), première écriture essayée sur la vraie voiture le 2026-09-14, console de facturation du fabricant (relevé du 2026-09-14), `apps/server/src/plugins/tesla/state.ts`, essais sur la vraie voiture du 2026-10-02 (notes de version, langue, facturation)

## Ce que le plugin fait, et ce qu'il ne fait pas encore

**Phase 1 (2026-09-13) : lecture seule, plus le réveil à la demande.** Un véhicule = un appareil
`vehicle` identifié par son **VIN**. Publié : charge (`soc`), autonomie, câble et charge en cours,
limite de charge, verrouillage, position GPS datée, kilométrage, vitesse et rapport (`speedKmh`,
`gear`), pression des quatre pneus (`tirePressureBar`), températures intérieure et extérieure, et la
**veille** (`sleepState`). Les capacités déclarées sont `soc`, `range`, `location` : ni `lock` ni
`charging`, donc l'UI ne propose pas ce que le plugin refuserait (`UNSUPPORTED_COMMAND`).

La seule commande acceptée est `vehicle.wake`. Verrouiller, lancer ou arrêter la charge, régler la
limite viendront en phase 2 : sur le véhicule de référence (Model S pré-2021) ce sont des
`POST /api/1/vehicles/{vin}/command/...` **non signés**, le Vehicle Command Protocol n'existant pas
pour ces modèles. Voir la piste d'origine dans `3_3_fabricants-a-venir.md`.

*(Dépassé du 2026-09-14 au 2026-10-02 : les commandes de charge (limite, démarrer/arrêter), la climatisation, les sièges et le volant chauffants et la mise à jour logicielle (OTA) ont été ajoutées — capacités `charge_limit`, `charging`, `climate_precondition`, `software_update`, `WRITE_CAPABILITIES` dans `apps/server/src/plugins/tesla/mapping.ts`. Seul le verrouillage reste à faire : `vehicle.lock` est refusé (`UNSUPPORTED_COMMAND`). Voir les sections « Mise à jour » datées de 2026-09-14 à 2026-10-02 plus bas.)*

Il n'existe **rien en local** : tout passe par le cloud du fabricant, comme pour Nest.

## Trois contraintes de la Fleet API, et ce qu'elles imposent

### 1. Un domaine public en HTTPS, même en lecture seule

Tesla exige qu'une **clé publique EC P-256** soit servie à
`https://<domaine>/.well-known/appspecific/com.tesla.3p.public-key.pem` sur le domaine déclaré dans
l'application (developer.tesla.com), et que ce domaine soit **enregistré** (`POST
/api/1/partner_accounts`, jeton partenaire `client_credentials`). C'est la preuve de propriété du
domaine ; en phase 1 la clé privée ne signe rien.

Kasbah tourne sur le LAN. Le plugin **génère la paire** au premier démarrage (`auth.ts`,
`ensureKeyPair`, cache `TESLA_KEY_FILE`), avant même que l'application existe, et la carte des
Réglages **affiche la clé publique** et l'URL exacte où la poser. C'est l'utilisateur qui la dépose
sur son domaine (par exemple sur un NAS : `nas.example.org`). Puis « Enregistrer le domaine »
(`POST /api/plugins/tesla/register`) déclare le domaine et **vérifie ce que Tesla a lu**
(`GET /api/1/partner_accounts/public_key?domain=`) : `registered` vaut vrai seulement si la clé lue
est la nôtre, PEM comparé sans ses blancs (Tesla peut la rendre sans armure).

### 2. Une API facturée à l'usage

Depuis le 2025-01-01 : crédit de **10 $ par mois et par compte**, puis lecture complète
(`vehicle_data`) **1 $ pour 500**, réveil **1 $ pour 50**, commande 1 $ pour 1 000, signal de
télémétrie 1 $ pour 150 000. Quotas : 60 lectures / min, 3 réveils / min, 30 commandes / min par
véhicule. Sans carte bancaire enregistrée, la facturation est bornée à 0 $ : Tesla coupe au bout du
crédit. La décision de l'utilisateur est de **rester dans le gratuit**.

D'où :
- un **budget journalier** de lectures complètes (`TESLA_DAILY_DATA_BUDGET`, 100 par défaut = 6 $ par
  mois dans le pire cas). Épuisé, seule la veille est suivie jusqu'au lendemain (date locale du
  serveur), journalisé une fois ; `/status` et `health().detail` disent `n/limite` ;
- **jamais de réveil automatique** : `vehicle.wake` est un geste de l'UI (bouton « Réveiller »,
  proposé seulement quand le véhicule dort), suivi d'une relecture différée de 15 s, comptée au budget.

*(Dépassé le 2026-10-01 : deux commandes réveillent désormais la voiture d'elles-mêmes, la climatisation et le lancement de la charge — voir « Mise à jour 2026-10-01 » et « Mise à jour 2026-10-01 (quater) ».)*

Ce qu'on ne sait pas encore : la **catégorie tarifaire de `GET /api/1/vehicles`** (la liste). La
documentation la met dans un volet que le rendu texte ne montre pas ; si elle est facturée comme une
lecture, 144 appels par jour à 10 min coûteraient l'essentiel du crédit. À vérifier sur la console
développeur après le premier mois, avant de toucher `TESLA_POLL_MS`. La télémétrie en flux (Fleet
Telemetry, la voie bon marché) demande un serveur TLS public que Tesla appelle : écartée pour un foyer.

*(Dépassé le 2026-09-14 : la console du fabricant a tranché, lister n'est pas facturé — voir « Mise à jour 2026-09-14 (bis) — la console du fabricant tranche : lister ne coûte rien ».)*

### 3. Le véhicule dort

Garé, sans personne à bord et sans charge, le véhicule coupe son ordinateur au bout d'un quart
d'heure. Endormi, il répond **408** à `vehicle_data` ; la **liste** des véhicules, elle, donne
`state` (`online` / `asleep` / `offline`) **sans le réveiller**. Sur un Model S ou X d'avant 2021,
une lecture peut retarder la veille (drain de batterie) ; sur les véhicules 2021+ seules les commandes
le font.

Le sondage (`poll`, toutes les `TESLA_POLL_MS`, 10 min) :
1. lit la liste, émet `sleepState` pour chaque véhicule, republie les descripteurs si un VIN apparaît
   ou disparaît ;
2. pour un véhicule `online` seulement, hors **repos** et si le budget le permet, lit `vehicle_data`
   (`endpoints=charge_state;drive_state;vehicle_state;climate_state;location_data` —
   `location_data` est obligatoire pour la position depuis le logiciel 2023.38) ;
3. une lecture qui montre le véhicule **au repos** (`isResting` : rapport `P` ou `null`, pas en
   charge, personne à bord) pose `restUntil = maintenant + TESLA_REST_MS` (15 min) : on le laisse
   s'endormir. En route ou en charge, on relit à chaque tour ;
4. un 408 entre la liste et la lecture (endormi entre-temps) émet `sleepState: 'asleep'` et n'est ni
   une erreur ni un backoff.

`asleep` est un **état normal**, pas une indisponibilité : `available` reste vrai, les dernières
valeurs restent affichées (cf. `1_architecture/1_1_contrat-appareils.md`).

## Jetons : à usage unique

OAuth code d'autorisation sur `auth.tesla.com/oauth2/v3/authorize`, jetons sur
`fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token` avec `audience` = base régionale
(`TESLA_REGION` : `eu` → `fleet-api.prd.eu.vn.cloud.tesla.com`). Portées demandées d'emblée, commandes
comprises, pour ne pas relier le compte une seconde fois en phase 2 : `openid offline_access
vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds`.

Le **refresh token est à usage unique** (Tesla en rend un nouveau à chaque rafraîchissement, l'ancien
reste toléré 24 h) : `TeslaAuth.adopt` **écrit le cache avant tout usage**, un seul rafraîchissement à
la fois (`refreshing`), et un 400/401 sur `refresh_token` ramène en `needs_pairing` (compte à
relier) plutôt qu'en incident réseau. L'access token est rafraîchi 5 min avant son échéance, et une
fois de plus sur un 401 de l'API avant de rejouer la requête.

Comme Enphase, **le serveur garde les jetons** (`TESLA_TOKEN_FILE`) : rien à recopier dans `.env`,
la liaison depuis l'interface suffit. La page de retour (`/auth/callback`) le dit, et prévient si le
cache est désactivé.

## Fixtures : provisoires, à remplacer par la capture

Au moment d'écrire, le compte n'est **pas lié** : `__fixtures__/fleet.ts` est tiré de la
documentation et des formes connues de l'API propriétaire, en reproduisant ce qu'on en sait (`speed`
et `shift_state` à `null` à l'arrêt, miles et mph, `charger_power` en kW entiers, pressions en bar et
`null` tant que le véhicule n'a pas roulé, `gps_as_of` en secondes à côté de `timestamp` en
millisecondes). La leçon TaHoma tient : dès la liaison, capturer `GET /api/plugins/tesla/raw` (liste
puis `vehicle_data` des seuls véhicules éveillés, chaque lecture comptée au budget), anonymiser VIN
et position, et **remplacer** le fichier en gardant les bizarreries.

*(Dépassé le 2026-09-13 au soir : le compte est lié et les fixtures sont désormais la capture réelle — voir « Mise à jour 2026-09-13 (soir) ».)*

## Routes propres

| Route | Rôle |
|---|---|
| `GET /api/plugins/tesla/status` | mise en route pour la carte des Réglages (clé publique, URL, `registered`, `linked`, véhicules et veille, budget) — jamais un secret |
| `GET /api/plugins/tesla/public-key` | la clé publique en `application/x-pem-file` |
| `POST /api/plugins/tesla/register` | enregistre le domaine (jeton partenaire) puis vérifie la clé lue |
| `GET /api/plugins/tesla/auth/url` | URL de consentement, `state` retenu |
| `GET /api/plugins/tesla/auth/callback` | échange du code, liste, descripteurs, démarrage du sondage, page HTML |
| `GET /api/plugins/tesla/raw` | relevé brut pour les fixtures |
| `POST /api/plugins/tesla/public-key/rotate` | nouvelle paire de clés (l'ancienne cesse de valoir : à reposer sur le domaine, puis réenregistrer) |
| `POST /api/plugins/tesla/usage` | recale le compteur du mois sur la console du fabricant — `{ data, wakes, commands, since? }` |

`health()` : `needs_pairing` sans identifiants ou sans compte ; `degraded` si le domaine est
enregistré mais la clé lue n'est pas la nôtre, ou sur la dernière erreur ; `ok` avec « n véhicule(s),
n en veille · n/limite lectures aujourd'hui ».

## Côté web

- `TeslaLinkCard.vue` (Réglages) : trois pas toujours rendus et cochés (clé publique à copier,
  enregistrement, liaison), masquée pour un plugin **éteint** (`/api/health` liste aussi ceux-là) et
  quand tout est fait.
- `VehiclesView.vue` : pastille de veille (soleil / lune), cases « Mouvement » et « Températures »,
  quatre cases de pneus fixes (« — » à défaut : rien ne bouge quand une valeur arrive), boutons qui
  suivent les **capacités** du descripteur, « Réveiller » seulement quand ça dort.
- La simulation (`packages/mock-sim/src/behaviours/ev.ts`) fournit ces champs pour que l'UI s'essaie
  sans compte ; la configuration de lancement `kasbah-mock` (`.claude/launch.json`) la sert sans
  serveur ni maison réelle.


### Mise à jour 2026-09-13 (soir) — la mise en route sur le vrai compte, et ses cinq surprises

La page ci-dessus a été écrite avant la liaison. Le soir même, le compte a été lié et la voiture
(« Voiture 1 », Model S, MCU2, `api_version` 95) lue une première fois après
un réveil demandé depuis l'UI. Les fixtures de `__fixtures__/fleet.ts` sont désormais **cette
capture**, anonymisée (VIN, identifiants, nom, position). Le mappage n'a pas eu à changer : la doc
disait vrai sur les unités et les `null`. En revanche la MISE EN ROUTE a réservé cinq surprises,
toutes corrigées dans le plugin :

1. **Un domaine n'appartient qu'à UNE application.** L'utilisateur avait recréé l'application sous
   un second compte développeur, même domaine : `POST /api/1/partner_accounts` répond alors 422
   « Domain has already been taken », et toute lecture de la nouvelle application répond 412
   « Account … must be registered in the current region ». Changer la clé n'y fait rien (le 422
   dit alors « Public key hash has already been taken » si la clé aussi est celle de l'autre).
   Sortie retenue : **garder la première application** ; le compte qui consent n'a pas à être celui
   qui a créé l'application. Le plugin distingue les deux 422 et, après un 412 qui suit, dit lequel
   des deux remèdes s'applique (reprendre l'autre application, ou `POST /public-key/rotate`).
2. **Tesla rend la clé enregistrée en POINT EC hexadécimal** (`04` ‖ X ‖ Y, 130 caractères), pas en
   PEM. La première vérification comparait des PEM et concluait toujours « pas la nôtre » —
   `degraded` à tort, avec un « Générer une nouvelle clé » proposé pour rien. `samePublicKey`
   (`auth.ts`) accepte le point hex, le PEM et le base64 nu.
3. **Réenregistrer met à jour la clé.** Après une rotation de clé (inutile ici, mais faite), un
   nouveau `POST /partner_accounts` a répondu 200 avec `updated_at` changé et la nouvelle clé : une
   rotation se rattrape sans supprimer l'application.
4. **La vérification peut être refusée alors que l'API répond.** `GET
   /api/1/partner_accounts/public_key?domain=` a rendu 403 « This account does not have access to
   <domaine> » pendant l'épisode 1. Le plugin ne conclut plus rien d'un échec de vérification ;
   c'est la LISTE DES VÉHICULES qui fait foi (412 = pas enregistré).
5. **La liaison ne doit pas dépendre de la première liste.** Le premier jet listait les véhicules
   dans `/auth/callback` et rendait l'erreur si la liste échouait — les jetons étaient pourtant
   déjà gardés, et l'utilisateur relisait « erreur » sur un compte lié. La page de retour affiche
   maintenant l'erreur de liste séparément, et le sondage part quand même.

À côté : `/api/1/users/me` exige la portée `user_data` (non demandée) — retiré du relevé brut au
profit de `/api/1/users/region` seul ; `/api/1/products` liste véhicules ET installations énergie ;
un compte sans accès à la voiture (mauvais compte au consentement) donne une liste **vide** en 200,
pas une erreur.

Ce que la capture montre et que le mappage ignore pour l'instant : `charging_state: "NoPower"`
(câble IEC engagé, borne sans courant — mappé « branché, pas en charge »),
`tpms_last_seen_pressure_time_*` (la pression affichée datait de la veille : le véhicule n'avait pas
roulé), `software_update` programmée, `media_info` (lecture en pause). Pistes pour plus tard.

**Côté UI**, deux corrections du même soir : la carte Tesla lit la santé dans l'INVENTAIRE des
plugins (`stores/plugins`) et non dans `/api/health`, sinon elle n'apparaissait qu'après un
rechargement de la page une fois le plugin allumé ; et la vue Véhicules affiche « — » (et non
« 0 % · 0 km », les défauts du contrat) pour un véhicule découvert endormi et jamais lu.


### Mise à jour 2026-09-14 — l'âge des valeurs, la relecture à la demande, et un sondage qui repart de la dernière lecture

Demande de l'utilisateur : « de quand date le statut affiché », « un bouton pour rafraîchir », « le
délai d'interrogation repart de ce moment ». Trois changements :

- **`readAt`** dans l'état `vehicle` (contrat) : la date de la dernière LECTURE COMPLÈTE, posée par le
  plugin à chaque `vehicle_data` réussi (`ctx.clock.now()`). Ce n'est pas `updatedAt`, que la seule
  veille fait bouger à chaque tour de liste. Absente = jamais lu.
- **Commande `vehicle.refresh`** (capacité `soc`) : relire MAINTENANT. Le plugin relit d'abord la
  liste (le véhicule a pu s'endormir depuis l'affichage) ; éveillé → lecture complète comptée au budget
  (budget épuisé → `RATE_LIMITED`, la lecture n'est pas dépensée) ; endormi → la veille seule est
  émise, on ne le réveille PAS — c'est l'autre bouton, dix fois plus cher.
- **Le sondage repart de la dernière lecture.** `createPoller` cède la place à un timer maison
  (`scheduleNext`) : chaque lecture réussie, d'où qu'elle vienne (tour de sondage, relecture après
  réveil, rafraîchissement demandé), repose le timer à `TESLA_POLL_MS`. Relire dix minutes après la
  dernière lecture, et non selon un calendrier fixe. Un échec de tour ne fait pas de backoff serré
  (l'API est facturée) : dix minutes plus tard.

Côté vue Véhicules : une ligne toujours présente sous les actions, « Lu il y a 12 min » (ou « Jamais
lu »), qui vieillit d'elle-même (horloge de la vue toutes les 30 s), et un bouton « Actualiser »
quand le véhicule est éveillé (« Réveiller » reste le bouton du véhicule endormi). `formatAgo`
(`apps/web/src/lib/format.ts`, `Intl.RelativeTimeFormat`) ramène une date FUTURE à « maintenant » :
l'horloge du serveur et celle du navigateur diffèrent de quelques secondes, et la simulation vit
dans un temps accéléré (« lu dans 8 min » a été vu sur la maquette avant cette garde).


### Mise à jour 2026-09-14 — le cap, et la carte

`drive_state.heading` est repris en `headingDeg` (normalisé dans [0, 360[), pour orienter la voiture
sur la carte de la vue Véhicules. La carte elle-même — MapLibre, OpenFreeMap, orthophotos IGN — est
décrite dans `../4_ui/4_1_navigation-et-panneaux.md`. Les fournisseurs écartés pour ce choix :
**Google Maps** (carte bancaire exigée pour la clé depuis mars 2025, même sans dépasser le gratuit),
Mapbox / MapTiler / Cesium ion (compte chez un tiers, quotas). Pas de repli satellite hors de France
pour l'instant : l'imagerie mondiale d'Esri a des conditions d'usage plus floues, et l'utilisateur
n'en a pas voulu.


### Mise à jour 2026-09-14 — `execute` rend la main AVANT que la voiture soit réveillée

À retenir pour tout plugin dont une commande met longtemps à produire son effet : `vehicle.wake`
résout dès que Tesla accuse le `POST wake_up`, en une seconde, alors que la voiture met une dizaine
de secondes à répondre et que la relecture différée arrive 15 s plus tard. Le contrat l'impose
(`execute` résout à l'accusé du fabricant, et `KASBAH_COMMAND_TIMEOUT_MS` vaut 10 s : tenir la
requête serait de toute façon exclu). C'est donc à l'UI de tenir l'attente jusqu'à l'effet constaté —
comment, dans `../4_ui/4_1_navigation-et-panneaux.md`.


### Mise à jour 2026-09-14 — un fichier d'état : dernières valeurs connues et crédit du mois

Le plugin garde désormais dans `TESLA_STATE_FILE` (`state.ts`) ce qui n'est ni un secret ni un jeton,
et que perdre au redémarrage coûtait cher :

- **Le dernier état de chaque véhicule**, réémis au démarrage suivant AVANT toute lecture. Sans lui, un
  redémarrage repart d'une carte vide (« Jamais lu », 0 %) jusqu'à la prochaine lecture — qui peut
  attendre des heures, le temps que la voiture se réveille. Ce sont les dernières valeurs connues, et
  elles étaient déjà affichées comme telles : `readAt` les date, rien n'est inventé.
- **La consommation du cycle de facturation**, sans quoi la jauge repartirait de zéro à chaque
  redémarrage et ne voudrait plus rien dire.

`health().quota` publie donc le **crédit mensuel du fabricant** : 10 $ par compte, cycle CALENDAIRE
(« Billing cycles are monthly, starting on the first day »), et non le budget journalier que le plugin
s'impose — celui-ci reste le garde-fou, visible dans `/status` et le détail de la santé. Le premier
cycle commence en pratique le jour de la liaison du compte (`since`), puisqu'avant il n'y avait rien à
compter.

Le coût est une **estimation**, calculée sur les prix affichés par le fabricant (`PRICE_USD` :
lecture 1 $/500, réveil 1 $/50, commande 1 $/1000) et comptée dans le client HTTP, sur tout appel qui
répond en dessous de 500 — un 408 « voiture endormie » est facturé comme le reste. Seul Tesla facture
vraiment ; sa console reste la référence.

Une incertitude assumée, à lever dès que la console du fabricant tranche : la documentation range
chaque route dans une catégorie tarifaire mais **ne publie pas celle de `GET /api/1/vehicles`**. Elle
est comptée comme une lecture — une jauge pessimiste vaut mieux qu'un crédit dépassé. À la cadence de
dix minutes, c'est d'ailleurs ce poste qui domine : 144 listes par jour, soit environ 8,6 $ par mois
si elles sont bien facturées ainsi, contre 0,4 $ pour les lectures complètes.

*(Dépassé le 2026-09-14 : la liste n'est pas facturée, ce poste est nul — voir la section suivante, « la console du fabricant tranche : lister ne coûte rien ».)*


### Mise à jour 2026-09-14 (bis) — la console du fabricant tranche : lister ne coûte rien

La section précédente comptait la liste des véhicules comme une lecture facturée, faute de catégorie
tarifaire publiée. **La console d'utilisation du compte a tranché le jour même** : elle relève
**une poignée de requêtes « Données » par jour** là où le plugin en faisait 144 rien qu'en listant, et le compteur
local en avait enregistré bien plus que le fabricant n'en facturait. `GET
/api/1/vehicles` **n'est pas facturé** — ni comme donnée, ni ailleurs : aucune des six catégories de la
console ne bouge quand on liste.

Ce que cela change, et c'est une bonne nouvelle : le sondage de la veille est **gratuit**. Ne coûtent
que la lecture complète (0,2 ¢), le réveil (2 ¢) et les commandes (0,1 ¢). Avec le budget par défaut
de 100 lectures par jour, le pire cas mensuel tombe de 8,6 $ à 6 $, et l'usage réel — une poignée de
lectures par jour — à quelques dizaines de centimes. Attention au piège de `billableKind` : le chemin
d'une lecture COMMENCE par celui de la liste, c'est `vehicle_data` qu'il faut reconnaître, pas le
préfixe.

**Recaler le compteur** : `POST /api/plugins/tesla/usage` avec `{ data, wakes, commands, since? }`
écrit le cycle courant. L'estimation dérive forcément de la facturation réelle — catégories non
publiées, arrondis, appels faits hors de Kasbah par une autre application tierce qui partage le même
crédit —, et la console reste la seule vérité. Le compteur a été aligné sur elle le 2026-09-14.

La devise reste le **dollar** (les prix publiés le sont), alors que la console facture en euros à son
propre taux : une raison de plus de ne lire cette jauge que comme un ordre de grandeur.


### Mise à jour 2026-09-14 — la fin de charge, et la capacité `charge_power`

`toDataPatch` lit deux champs de plus de `charge_state` :

- **`time_to_full_charge`**, en **heures décimales**, converti en minutes (`chargeMinutesRemaining`).
  Tesla le laisse à sa dernière valeur une fois la charge finie : hors charge, le patch l'**efface**
  (`null`) — sinon la carte annoncerait une fin de charge pour une voiture débranchée.
- rien de plus pour la puissance, déjà lue (`charger_power`, en kW entiers), mais le descripteur
  déclare désormais la capacité **`charge_power`** : elle dit que ce véhicule DONNE sa puissance, ce
  qui dispense l'UI de l'estimer et de demander une capacité de batterie (cf.
  `../1_architecture/1_1_contrat-appareils.md`). Les capacités de lecture passent donc à
  `['soc', 'range', 'location', 'charge_power']` — toujours aucune commande : la phase 1 reste en
  lecture seule.

Côté UI, le bouton « Actualiser » est maintenant proposé **même quand la voiture dort** (cf.
`../4_ui/4_1_navigation-et-panneaux.md`). Rien à changer côté plugin : `vehicle.refresh` relisait
déjà la liste d'abord et s'arrêtait là si le véhicule dormait — c'est exactement ce qu'il faut pour
constater qu'il s'est réveillé tout seul, sans payer un réveil.

Sources : `apps/server/src/plugins/tesla/mapping.ts`, test `mapping.test.ts`,
`apps/server/src/plugins/tesla/index.ts`.

### Mise à jour 2026-09-14 (bis) — la première ÉCRITURE : la limite de charge

La phase 1 n'est plus tout à fait la lecture seule : le plugin accepte
**`vehicle.set_charge_limit`**, et le descripteur déclare la capacité **`charge_limit`** à côté des
quatre capacités de lecture (`WRITE_CAPABILITIES` dans `mapping.ts`). Verrouiller et lancer /
arrêter la charge restent à faire.

`POST /api/1/vehicles/{vin}/command/set_charge_limit` avec `{ percent }`. **Essayé sur la vraie
voiture le 2026-09-14** (cible modifiée, relue depuis la voiture, puis remise) : ce que
le wiki annonçait d'après la documentation est confirmé — sur un **Model S pré-2021**, la
commande REST **non signée** passe, sans clé virtuelle.

Trois choses que l'essai a apprises, et que le code tient :

1. **Une commande exige la voiture ÉVEILLÉE.** Endormie, Tesla répond **408**, soit
   `DEVICE_UNAVAILABLE` (cf. `client.ts`, déjà traduit ainsi pour `vehicle_data`). Le plugin ne
   réveille **jamais** implicitement pour un réglage : le réveil coûte dix lectures et reste le
   geste explicite de l'utilisateur.
2. **Tesla REFUSE en HTTP 200.** Le corps porte `{ response: { result: false, reason } }` — c'est
   `result` qui tranche, pas le statut (`commandResultSchema`, `types.ts`). S'en remettre au statut
   ferait afficher une cible que la voiture n'a jamais prise.
3. **La cible est publiée sans relecture.** Une lecture coûte dix fois une commande et la voiture
   peut se rendormir dans la minute : c'est `emitState({ chargeLimit })` qui tient la carte à jour
   jusqu'au prochain tour de sondage.

Une commande est facturée **0,001 $** (un dixième de lecture), et `billableKind` la comptait déjà
(`/command/`) : la jauge de crédit la voit passer.

### Mise à jour 2026-09-14 (ter) — le cycle de facturation commence le 1er du mois

Relevé sur la console du fabricant : « Les cycles de facturation commencent le 1er de chaque mois ».
Le plugin gardait dans son état un champ `since` valant le **premier appel compté** — en pratique le
jour de la liaison du compte (13 septembre) — et la carte affichait « depuis le 13 sept. », ce qui
laissait croire à un cycle glissant.

Désormais `since` n'est plus **gardé** : il est **déduit** du mois (`cycleStart('2026-09')` →
1er septembre 00:00 UTC, `state.ts`). Un champ qui se recalcule ne peut pas mentir après un
redémarrage, et un fichier d'état écrit par une version précédente se relit sans broncher (le
`since` qu'il porte est simplement ignoré). Conséquence sur la route de recalage : `POST
/api/plugins/tesla/usage` prend `{ data, wakes, commands }` et **plus** de `since`.

La même console a donné l'ordre de grandeur réel du premier cycle : **quelques dizaines de requêtes
« Données » et quelques « Sorties de veille »**, soit quelques centimes — là où l'estimation du plugin comptait un peu plus. L'écart est
attendu (catégories tarifaires non publiées, arrondis, appels faits hors de Kasbah) : c'est
précisément à quoi sert `/usage`.

Sources : `apps/server/src/plugins/tesla/{index,mapping,state,types}.ts`, tests `state.test.ts`,
`mapping.test.ts` et `plugin.test.ts`, console développeur du fabricant (relevé du 2026-09-14).

### Mise à jour 2026-09-15 — la peinture : `vehicle_config`, et la couleur choisie DANS la voiture

`vehicle_config` rejoint `DATA_ENDPOINTS`. L'endpoint `/vehicle_config` **isolé** est mort depuis
longtemps (404), mais la SECTION vit toujours dans `vehicle_data` — vérifié sur la vraie voiture le
2026-09-15. Le coût est **nul** : c'est une section de plus sur une requête déjà facturée, pas un
appel supplémentaire.

Deux champs, et c'est le second qui compte :

```
exterior_color        "<nom d'usine>"
paint_color_override  "40,90,200,0.9,0.3"
```

- **`exterior_color`** nomme la peinture d'usine. Le plugin l'approche par une petite table
  (`PAINT` dans `mapping.ts`) — APPROXIMATIONS assumées : Tesla nomme ses couleurs mais n'en publie
  pas les valeurs. C'est acceptable parce qu'un nom lisible dit de quelle couleur il s'agit ; un
  nom hors table ne publie rien plutôt qu'une couleur inventée.
- **`paint_color_override`** porte la couleur que le propriétaire a choisie **depuis son écran de
  bord** (le « Coloriseur »), en RGB exact. Elle PRIME : c'est celle que la voiture affiche, donc
  celle qu'il a en tête. Les deux nombres qui suivent le RGB donnent l'aspect : la voiture relevée
  était sur « Mate » avec `0.9, 0.3`, d'où la lecture 0,9 = **rugosité** (un mat diffuse) et 0,3 =
  métallicité — l'ordre inverse décrirait un chrome brillant, ce que l'écran contredit.
  `bodyFinish()` classe en `solid` / `metallic` / `matte` avec des seuils larges : c'est une seule
  voiture qui l'a dicté, pas une documentation.

Le propriétaire peut changer tout ça sans prévenir : le plugin **republie le descripteur** quand la
peinture bouge. C'est le seul cas où un descripteur change sans que la liste des véhicules ait bougé
— la peinture n'est PAS dans la liste, elle n'arrive qu'avec une lecture complète, donc le
descripteur naît sans peinture et la gagne ensuite (`VehicleTrack.paint`).

**Deux pièges.** `color` et `option_codes` de la liste `/api/1/vehicles` valent `null` : ce sont des
vestiges, il ne faut pas compter dessus. Et `vehicle_specs`, qu'on croise dans la facturation, est
une portée réservée aux **Partner Tokens** — autre chose que `vehicle_config`, et inutile ici.

Sources : `apps/server/src/plugins/tesla/mapping.ts`, `apps/server/src/plugins/tesla/index.ts`,
`apps/server/src/plugins/tesla/types.ts`, `apps/server/src/plugins/tesla/__fixtures__/fleet.ts`.

### Mise à jour 2026-09-15 (bis) — correction : c'est le CINQUIÈME nombre qui dit l'aspect

La section précédente affirmait que `0.9` était la rugosité et `0.3` la métallicité, déduit d'un
seul relevé et de ce que l'écran de bord affichait (« Mate »). **C'était faux**, et la mesure l'a
montré : la même voiture, basculée sur « Métallique » entre deux relevés du même jour, donne

```
Mate        paint_color_override  40,90,200,0.9,0.3
Métallique  paint_color_override  40,90,200,0.9,0.01
```

Seul le **cinquième** nombre bouge, et il **baisse** quand la peinture devient brillante : il se
comporte comme une rugosité. Le quatrième reste à `0.9` dans les deux cas — il ne dit donc rien du
type de peinture. `bodyFinish()` le lisait : il répondait « mate » quoi qu'il arrive, y compris sur
une voiture réglée en métallique. Ce qu'aucun test ne pouvait attraper, puisque les fixtures
venaient du même unique relevé que l'inférence.

Ce que l'épisode enseigne, et qui vaut au-delà de Tesla : **une inférence tirée d'un seul
échantillon n'est pas une connaissance**, même quand elle est cohérente avec tout ce qu'on voit.
Le test qui l'a tuée coûtait un basculement sur l'écran et une lecture.

Deux points de mesure = deux aspects dérivables, seuil posé entre eux (`MATTE_ABOVE = 0.15`).
**`solid` (« Unie ») reste un choix MANUEL** tant qu'aucun relevé ne l'a montré : l'inventer serait
refaire exactement l'erreur qu'on vient de corriger. Le quatrième nombre garde son mystère — peut-être
une opacité, peut-être une métallicité fixe de vernis ; il ne sert à rien tant qu'on ne l'a pas vu
varier.

Sources : `apps/server/src/plugins/tesla/mapping.ts`, `apps/server/src/plugins/tesla/mapping.test.ts`.

### Mise à jour 2026-09-15 (ter) — le troisième relevé : deux axes, et le quatrième nombre parle

La section précédente concluait que le quatrième nombre « ne dit rien du type de peinture ». C'était
vrai de ce qu'elle avait mesuré, et faux en général : avec « Mate » et « Métallique » il valait 0,9
dans les deux cas, donc rien ne le distinguait. Un troisième basculement, sur « Unie », l'a fait
bouger.

```
Mate        40,90,200,0.9,0.30
Métallique  40,90,200,0.9,0.01
Unie        40,90,200,0.7,0.04
```

**Deux axes, chacun mesuré sur les trois aspects.** Le cinquième se comporte comme une RUGOSITÉ : il
s'effondre quand la peinture brille (0,01 métallique, 0,04 unie), il monte pour le mat (0,30). Le
quatrième comme une MÉTALLICITÉ : 0,9 pour les deux peintures à paillettes, 0,7 pour la teinte unie,
qui n'en a pas. La rugosité décide donc du mat, et la métallicité départage les deux brillants —
`ROUGHNESS = 4`, `METALNESS = 3`, seuils posés ENTRE des valeurs mesurées (`MATTE_ABOVE = 0.15`,
`METALLIC_FROM = 0.8`).

Les trois aspects sont désormais dérivés, aucun n'est inventé. Vérifié bout en bout sur la vraie
voiture : basculer l'écran de bord fait passer `meta.vehicle.finish` par `matte`, `metallic` puis
`solid`, sans rien d'autre à faire.

> **Deux erreurs successives, et ce qu'elles coûtent.** La première lisait le mauvais nombre
> (« mate » quoi qu'il arrive), la seconde lisait le bon mais ne savait pas dire « unie ». Toutes
> deux venaient d'avoir trop peu de relevés — une, puis deux. Sur une API non documentée, le nombre
> d'échantillons EST la limite de ce qu'on peut affirmer, et un basculement d'écran coûte moins cher
> qu'une inférence qui tient six mois avant qu'on s'en aperçoive.

### Mise à jour 2026-09-22 — peinture persistée dans `TESLA_STATE_FILE`

La peinture n'arrive qu'avec `vehicle_data` (`VehicleTrack.paint`). Au redémarrage, voiture
endormie → seule la liste (sans `vehicle_config`) → descripteur sans couleur → scène 3D sur la
teinte de thème.

`state.ts` porte désormais `paints` (par VIN : `color` / `finish`). Rempli à chaque lecture
complète ; restauré dans `adoptList` avant `discover`. Même fichier que les derniers états et le
cycle de facturation. Une lecture après déploiement suffit à peupler le cache ; les redémarrages
suivants gardent la couleur sans réveiller.

Sources : `apps/server/src/plugins/tesla/{state,index}.ts`, tests `state.test.ts` et
`plugin.test.ts` (« la peinture survit au redémarrage »).

### Mise à jour 2026-10-01 — préconditionner l'habitacle, avec réveil automatique

Le plugin accepte **`vehicle.climate_start`** (consigne `targetTempC` facultative, 15-28 °C) et
**`vehicle.climate_stop`**, sous la capacité **`climate_precondition`** (ajoutée à
`WRITE_CAPABILITIES`). Usage visé : chauffer ou rafraîchir la voiture le matin avant de partir,
depuis le bouton « Climatiser » de la vue Véhicules ou depuis une automatisation horaire.

Appels Fleet API, tous **non signés** comme `set_charge_limit` (Model S pré-2021) :
`command/set_temps` `{ driver_temp, passenger_temp }` (même valeur des deux côtés, seulement si une
consigne est donnée), puis `command/auto_conditioning_start` ; `command/auto_conditioning_stop`
pour arrêter. Chaque commande est refusée en HTTP 200 par `result: false`, comme la limite de charge.
Lus en retour depuis `climate_state` : `is_climate_on` → `climateOn`, `driver_temp_setting` →
`climateTargetC`.

**La règle « jamais de réveil automatique » est assouplie pour cette commande seulement**, avec
l'accord de l'utilisateur (2026-10-01), y compris quand c'est une automatisation qui la lance. Un
matin, la voiture dort presque toujours ; une commande sur une voiture endormie répond 408. Donc :

1. Éveillée : la commande part tout de suite. Un 408 malgré tout (endormie depuis le dernier
   relevé) bascule sur le chemin du réveil.
2. Endormie : `POST wake_up`, et `execute` rend la main **à l'accusé du réveil** (le délai d'une
   commande est de 10 s, le réveil en prend une vingtaine). Derrière, la veille est relue par la
   **liste** (gratuite) toutes les 5 s, pendant 90 s au plus ; en ligne → la commande, puis une
   lecture complète 15 s plus tard pour **constater** l'effet (comptée au budget). Pas réveillée à
   temps, ou commande refusée : un `warn` dans le journal du serveur, rien d'autre.
3. `climate_stop` sur une voiture endormie ne réveille rien : sa clim est forcément à l'arrêt.

Coût d'un préconditionnement au réveil : un réveil (2 ¢), deux commandes (0,2 ¢), une lecture (0,2 ¢),
soit environ 0,50 € par mois à raison d'un matin par jour ouvré.

**Reste ouvert** : un échec en arrière-plan ne remonte ni dans l'UI ni dans le `lastRun` de
l'automatisation, qui dit « fait » dès l'accusé du réveil. Le bouton tient l'attente jusqu'à voir
`climateOn` (90 s au plus) : c'est le seul témoin visible. **Pas encore essayé sur la vraie voiture.**

*(Dépassé le 2026-10-01 : la climatisation a été essayée sur la vraie voiture le jour même — voir « Mise à jour 2026-10-01 (ter) — batterie faible : `low_soc`, confirmer puis forcer ».)*

Sources : `apps/server/src/plugins/tesla/{index,mapping,types}.ts`, tests `plugin.test.ts`
(« climatisation ») et `mapping.test.ts`, `apps/web/src/views/VehiclesView.vue`,
`apps/web/src/lib/automations.ts`.

### Mise à jour 2026-10-01 (bis) — sièges et volant chauffants, consigne

`vehicle.climate_set` est implémenté : `set_temps` pour la consigne, `remote_seat_heater_request`
`{ heater, level }` par siège (numéros Tesla : 0 avant gauche, 1 avant droit, 2 arrière gauche,
4 arrière centre, 5 arrière droit ; 3 et 6 sont les dossiers arrière, absents sur ce modèle),
`remote_steering_wheel_heater_request` `{ on }`. Une commande par réglage, l'état publié à chaque
accusé. Voiture endormie : 408 → `DEVICE_UNAVAILABLE`, **pas de réveil** pour un réglage.

Lus dans `climate_state` : `seat_heater_left|right|rear_left|rear_center|rear_right` → `seatHeat`,
`steering_wheel_heater` → `steeringWheelHeat`. Le descripteur déclare `meta.vehicle.climate`
**fixe** (`CLIMATE_FEATURES`, `mapping.ts`) : 15-28 °C au pas de 0,5, cinq places à trois crans et le
volant. C'est ce que montre l'appli Tesla sur une Model S, et ce que rapporte sa
`climate_state`. Une autre Tesla sans sièges arrière chauffés refuserait la commande, et le refus
remonterait tel quel.

Ce que l'appli Tesla offre en plus et qui n'est **pas fait** (choix de l'utilisateur pour la première
livraison) : dégivrage, aérer les fenêtres, modes Camping / Animal de compagnie, défense anti armes
biologiques, protection contre la surchauffe, programme de départ. La `climate_state` capturée porte
déjà `defrost_mode`, `bioweapon_mode`, `climate_keeper_mode`, `cabin_overheat_protection`.

Sources : `apps/server/src/plugins/tesla/{index,mapping,types}.ts`, tests `plugin.test.ts` et
`mapping.test.ts`.

### Mise à jour 2026-10-01 (ter) — batterie faible : `low_soc`, confirmer puis forcer

**Constaté sur la vraie voiture** (batterie basse) : `auto_conditioning_start` est refusé en HTTP 200 avec
`reason: low_soc`. L'appli Tesla fait la même chose et demande de confirmer. Le champ qui force est
`manual_override` : il existe dans `HvacAutoAction { power_on, manual_override }` du protocole
officiel (`teslamotors/vehicle-command`, `car_server.proto`) ; il n'est pas cité sur la page REST de
developer.tesla.com. Le corps REST `{ "manual_override": true }` n'est **pas encore essayé** sur la
vraie voiture.

- Contrat : `vehicle.climate_start` gagne `force` ; nouveau code d'erreur plugin
  **`NEEDS_CONFIRMATION`** (HTTP 409) : « le fabricant refuse sans confirmation explicite ».
- Plugin : `low_soc` → `NEEDS_CONFIRMATION`. Sous **20 %** (le seuil de Tesla) d'après le dernier
  état connu, la confirmation est demandée **avant** le réveil : sinon on payerait un réveil suivi
  d'un refus en arrière-plan, que personne ne verrait.
- UI : pas de notification pour ce code (le store garde `lastError[id]`) ; le panneau Climatisation
  ouvre une boîte « Batterie faible », et « Climatiser quand même » rejoue avec `force`.
- **Reste ouvert** : une automatisation du matin sous 20 % échoue sur `NEEDS_CONFIRMATION` (son
  `lastRun` le dit) ; elle n'a pas d'option « forcer ».

> **Corrigé le 2026-10-01, même jour** : le forçage décrit ci-dessus **ne marche pas**. Essayé sur la
> vraie voiture : la confirmation revenait en boucle. Le proxy officiel
> (`teslamotors/vehicle-command`, `pkg/proxy/command.go`) ne lit AUCUN `manual_override` pour
> `auto_conditioning_start` (il le lit pour `set_climate_keeper_mode`, `set_preconditioning_max` et
> `set_bioweapon_mode`) ; envoyé quand même, il était ignoré. Pistes écartées par l'utilisateur :
> forcer par le mode « Maintenir » ou par le dégivrage maximal. Ce qui reste : `force` et la boîte de
> confirmation sont **retirés** ; le code devient **`LOW_BATTERY`** (HTTP 409, notification « batterie
> trop faible, le constructeur refuse de climatiser »), toujours levé AVANT le réveil quand la
> dernière charge connue est sous 20 %.

> **Corrigé le 2026-10-01 (charge)** : « verrouiller et lancer / arrêter la charge restent à faire »
> (mise à jour du 2026-09-14 bis) n'est plus vrai pour la charge : voir la section suivante. Verrouiller
> reste à faire.

### Mise à jour 2026-10-01 (quater) — lancer et arrêter la charge

Le plugin accepte `vehicle.start_charge` et `vehicle.stop_charge`, et le descripteur déclare la
capacité `charging` (ajoutée à `WRITE_CAPABILITIES`, `mapping.ts`). Ce sont `charge_start` et
`charge_stop`, **non signés** comme la limite de charge. Être déjà dans l'état voulu (`is_charging`,
`not_charging`) compte pour un succès.

- **Débranchée** d'après le dernier état connu : refus (`DEVICE_UNAVAILABLE`) AVANT tout réveil.
- **Endormie** : `start` la RÉVEILLE, comme la climatisation (geste de l'utilisateur ou d'une règle
  qu'il a écrite) ; `stop` ne fait rien (une voiture qui charge ne dort pas) et publie `charging: false`.
- **Un seul chemin de réveil.** Le réveil de la clim est factorisé en
  `wakeThen(vin, what, run, followUpMs)` : réveiller, attendre que la liste (gratuite) dise « en
  ligne », lancer `run`, puis relire `followUpMs` plus tard. `execute` rend la main à l'accusé du
  réveil ; un échec derrière se lit dans le journal du serveur.
- **`charging` n'est pas publié sur l'accusé** : la voiture accepte avant que le courant coule (la borne
  met 20 s à 1 min). C'est la relecture `CHARGE_FOLLOW_UP_MS` (60 s) qui le constate ; l'UI tient
  l'attente d'ici là (`isChargeRequested`, `../1_architecture/1_4_app-web.md`).
- **Refus passager `could_not_wake_buses`.** Vu sur la vraie voiture, juste après la borne forcée :
  « online » d'après la liste, mais ses bus internes dorment encore. `execute` répond accepté, retente
  jusqu'à `BUSES_RETRIES` = 3 fois toutes les 5 s, puis relit. Elle a chargé quand même, parce que la
  borne donnait déjà du courant ; la commande n'était pas le seul levier.
- **Le même refus sur la limite de charge** (vu le 2026-10-01 : la première limite réglée échouait,
  la suivante passait). Retenté DANS la commande, l'UI attendant le résultat : 2 essais à 2,5 s
  (`LIMIT_BUSES_RETRIES`, `LIMIT_BUSES_PAUSE_MS`), pour tenir sous `KASBAH_COMMAND_TIMEOUT_MS`
  (10 s) ; au-delà, le refus remonte. Tests : `plugin.test.ts`.

**Essai réel par Kasbah le 2026-10-01** : borne forcée en moins de 20 s, Tesla en charge. Le
démarrage relaie d'abord la borne quand la voiture y est branchée (coordination côté serveur,
`../1_architecture/1_2_serveur-et-plugins.md`) ; l'arrêt, jamais.

Sources : `apps/server/src/plugins/tesla/{index,mapping}.ts`, test `plugin.test.ts`.

### Mise à jour 2026-10-02 — mise à jour logicielle (OTA) et notes de version

**Lu sans appel de plus.** `vehicle_state` porte déjà `car_version` et `software_update` :
`toDataPatch` (`mapping.ts`) publie `softwareVersion` (le hash de build éventuel est retiré) et
`softwareUpdate` (`toSoftwareUpdate`). `status: ''` = rien en attente → `null`, qui EFFACE le
champ. Statuts : `available`, `scheduled` (avec `scheduled_time_ms`), `downloading`,
`downloading_wifi_wait` → `waiting_wifi`, `installing`. Chaque nombre n'est publié que dans son
statut : Tesla laisse `install_perc: 10` sur une mise à jour seulement disponible (capture réelle).

**Notes de version (`GET /api/1/vehicles/{vin}/release_notes`)**, capturées sur la vraie voiture le
2026-10-02 (fixtures `RELEASE_NOTES_INSTALLED` / `RELEASE_NOTES_STAGED`) :
- sans paramètre : la version installée et quelques précédentes, jusqu'à la dernière grosse mise à
  jour seulement ; `?staged=true` : la version EN ATTENTE, mêlée d'anciennes notes (filtrées sur
  `customer_version`) ;
- entrées `title` (parfois avec une espace finale), `description`, `customer_version`,
  `show_in_history` (exclut l'entrée générique « Minor Fixes », `is_fallback`), `image_url` (thème
  sombre) et `light_image_url`, des URL SIGNÉES qui expirent (`__gda__=exp=…`, une quinzaine de jours),
  en 740 × 463 ;
- **la langue se demande par `?language=fr`** : essayé sur la vraie voiture, c'est le texte de
  l'appli Tesla (« Cartes de sites Superchargeur »). `Accept-Language`, `locale=fr_FR` et
  `locale=fr-FR` sont ignorés (anglais) ;
- **gratuit** : cinq appels de notes seuls puis une lecture complète, la console n'a pris que la
  lecture (`billableKind`, `state.ts`). La console se met à jour à l'arrivée d'une requête facturée,
  pas à heure fixe.

**Cache.** Après une lecture complète (voiture éveillée, donc), `refreshNotes` relit les notes en
arrière-plan SEULEMENT quand la version installée ou attendue a changé, ou un jour avant
l'échéance des illustrations. Un cache par VIN et par LANGUE dans `TESLA_STATE_FILE`
(`releaseNotes`, `releaseNotesLangs`) : l'anglais toujours (repli), plus les langues que l'app a
demandées (au plus 4). Une langue que Tesla rend identique à l'anglais est marquée `ignored` et
l'anglais est servi. `history` s'ALLONGE au fil des versions, au-delà de ce que Tesla remonte ; les
illustrations périmées sont retirées à l'affichage, le texte reste. Un échec de lecture attend 6 h
(`NOTES_RETRY_MS`) avant un nouvel essai. `releaseNotes(vin, lang)` sert le cache, jamais un appel ;
une langue nouvelle, voiture éveillée, est lue tout de suite — jamais de réveil pour des notes.

**Installer.** `vehicle.schedule_update { delayS }` → `schedule_software_update { offset_sec }`,
`vehicle.cancel_update` → `cancel_software_update` (capacité `software_update`). Voiture éveillée
seulement, refus d'avance si rien n'est téléchargé (`available` ou `scheduled` requis) ; annuler
sans programmation n'envoie rien. L'état suit l'accusé sans relecture. **Jamais envoyé à la vraie
voiture à la date d'écrire** : premier essai à faire avec l'utilisateur.

*(Dépassé le 2026-10-02 : premier essai réel fait — voir « Mise à jour 2026-10-02 (bis) — première installation réelle, et la suivre jusqu'au bout ».)*

**Piège vécu : le fichier d'état rejeté en entier.** Le cache des notes a changé de forme entre deux
versions non commitées ; au redémarrage, `teslaStateSchema` refusait le fichier, et `createStateFile`
repartait d'un état vide — compteur du 1er octobre compris (perdu,
recalé depuis la console par `POST /usage`). Désormais `releaseNotes` et `releaseNotesLangs`
ont un `.catch` : une forme inattendue n'oublie que les notes (test `state.test.ts`).

Côté web : voir `../4_ui/4_1_navigation-et-panneaux.md` (ligne « Logiciel » et sa boîte).

Sources : `apps/server/src/plugins/tesla/{index,mapping,state,types}.ts`, `__fixtures__/fleet.ts`,
tests `mapping.test.ts`, `plugin.test.ts`, `state.test.ts`, console développeur Tesla (relevés du
2026-10-02).

### Mise à jour 2026-10-02 (bis) — première installation réelle, et la suivre jusqu'au bout

**Premier vrai essai, le 2026-10-02**, « Installer maintenant » depuis Kasbah :
`schedule_software_update { offset_sec: 0 }` accepté, et Tesla a fixé LUI-MÊME le démarrage un
peu plus tard (une quinzaine de secondes après la lecture, dans `scheduled_time_ms`). L'appli Tesla montre ce
décompte, annulable. L'installation a démarré ; après redémarrage du serveur, la première lecture
disait `installing`, avec un pourcentage.

**Ce qui manquait** : la première lecture avait vu la voiture « au repos », donc pas de relecture
avant `TESLA_REST_MS` — Kasbah annonçait une heure passée pendant que la voiture installait. Désormais
(`index.ts`) :
- une lecture `UPDATE_FOLLOW_UP_MS` (15 s) après l'accusé, pour publier l'heure de Tesla et non la
  nôtre ;
- une lecture `UPDATE_START_GRACE_MS` (60 s) après l'heure prévue (`watchUpdateStart`, posée à
  chaque lecture qui montre `scheduled`, au plus 6 h d'avance), pour voir le démarrage ;
- `isResting` est faux pendant `installing` (`mapping.ts`) : chaque tour du sondage (10 min) relit,
  le pourcentage monte jusqu'à la nouvelle version ;
- annuler retire la lecture prévue.

Coût : deux ou trois lectures de plus par installation. Tests : `plugin.test.ts` (« maintenant » :
Tesla fixe l'heure…), `mapping.test.ts`.

Sources : `apps/server/src/plugins/tesla/{index,mapping}.ts`, appli Tesla et état du serveur relevés
le 2026-10-02.

### Mise à jour 2026-10-02 (ter) — après l'installation : les nouveautés de la version installée

Installation finie (relevé brut) : `software_update` revient à `status: ''`,
`version: ' '` (une espace), `expected_duration_sec: 2700` — lu comme « rien en attente », champ
effacé. Et `release_notes` rend les notes de la version INSTALLÉE en `show_in_history: false`, SANS
`is_fallback` ; le filtre « ce que Tesla montre dans son historique » les écartait, et l'historique
de Kasbah ne commençait pas par la version qu'on venait d'installer. Règle désormais : garder
`show_in_history`, PLUS les entrées de `deployed_version` qui ne sont pas l'entrée générique
(`is_fallback`, « Minor Fixes »). La règle entre dans la clé du cache (`NOTES_RULE`) : la changer fait
relire les notes une fois. Vérifié sur la vraie voiture : la version installée, la précédente, puis une plus ancienne
— que Tesla ne rend déjà plus, gardée par Kasbah. Tests : `plugin.test.ts`.

Sources : `apps/server/src/plugins/tesla/index.ts`, relevé `GET /api/plugins/tesla/raw` du 2026-10-02.
