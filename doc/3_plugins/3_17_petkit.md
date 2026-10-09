# PetKit — mangeoires et fontaines pour animaux

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/petkit/{index,auth,client,ble,mapping,types}.ts`,
> `apps/server/src/plugins/petkit/__fixtures__/petkit.ts` (capture réelle du 2026-09-21),
> `apps/web/src/components/controls/PetFeederCard.vue`, `apps/web/src/components/controls/PetFountainCard.vue`,
> `apps/web/src/views/PetsView.vue`, `apps/web/src/components/PetkitLinkCard.vue`,
> notes de session `_generated-ai-doc/petkit-protocole.md`

Modèles relevés : **mangeoires Fresh Element Solo** (`d4`, Wi-Fi) et **fontaines Eversweet Max**
(`ctw3`). Tout ce qui suit a été vérifié contre le vrai compte, lecture ET écriture, le
2026-09-21 — les seules suppositions restantes sont signalées comme telles.

*(Précision 2026-10-06 : le code gère plus de modèles que ceux relevés — mangeoires `d3`, `d4`, `d4h`, fontaines `ctw2`, `ctw3` (`FEEDER_TYPES` et `FOUNTAIN_TYPES` dans `apps/server/src/plugins/petkit/mapping.ts`) ; seuls `d4` et `ctw3` ont été vérifiés sur le vrai compte.)*

## Pourquoi le cloud, et pourquoi il n'y avait pas le choix

Rien en local. Les mangeoires ne parlent qu'au cloud du fabricant, et **une fontaine Eversweet Max
n'a même pas de Wi-Fi** : elle est en Bluetooth, jointe par un appareil PetKit voisin qui sert de
relais. Voir les appareils dans la table DHCP ne donne donc aucune prise — c'est la situation
Renault / MELCloud (`3_9_renault.md`, `3_13_mitsubishi-melcloud.md`), pas Hue ou Cast.

## Connexion : par CODE, pas par mot de passe

Ce qui distingue ce plugin de tous les autres plugins cloud du projet : **le compte se connecte
avec un code à usage unique envoyé par courriel**, valable dix minutes. Aucun mot de passe ne
traverse jamais le serveur — bonne nouvelle pour la sécurité, contrainte forte pour l'exploitation.

1. `GET user/sendcodeforquicklogin?username=<adresse>` — **un GET, l'adresse en paramètre d'URL**.
2. `POST user/login` avec `username`, `validCode`, `encrypt=1`, `region`, `oldVersion` et `client`
   (le descriptif du téléphone, sérialisé dans un seul champ).

Réponse : `session { id, expiresIn }` (~36 h). Le jeton se pose **dans deux en-têtes à la fois**,
`X-Session` ET `F-Session`.

**Conséquence qui commande tout `auth.ts` : une session perdue ne se reprend pas toute seule.** Il
faut un humain, sa boîte aux lettres et dix minutes. D'où un renouvellement à la MOITIÉ du bail
(`REFRESH_AT_RATIO`) plutôt qu'à l'échéance, et un `needs_pairing` franc quand elle est perdue
plutôt qu'un martèlement silencieux.

### Deux pièges de session repris des bibliothèques tierces

1. **Une nouvelle connexion invalide la précédente.** Sur le compte principal, le serveur et le
   téléphone se déconnecteraient mutuellement en boucle. D'où la consigne d'appairage : un compte
   PetKit **dédié**, à qui l'on partage les appareils — c'est écrit dans la carte des Réglages
   AVANT le formulaire, où l'utilisateur le lit avant de faire le mal.
2. **Deux connexions concurrentes condamnent la session pour la durée du bail.** Les deux voient le
   jeton périmé, les deux se reconnectent, l'un des deux est mort-né, et tout échoue ensuite en
   silence. D'où le verrou d'une seule connexion en vol (`inFlight`) : ce n'est pas une
   optimisation, c'est la correction d'un bug connu et coûteux.

## Les six pièges d'API, tous payés au premier appairage

Le premier essai réel a échoué trois fois de suite. Chaque échec a appris quelque chose que ni la
documentation communautaire ni deux bibliothèques tierces ne disaient correctement.

| Piège | Ce qui se passe | Ce qu'il fallait |
|---|---|---|
| **Le verbe** | `POST` sur `sendcodeforquicklogin` et `v1/regionservers` → refus | ce sont des **GET** |
| **La région** | `region: "FR"` refusé | l'**id du serveur en minuscules** (`fr`), trouvé en cherchant « FR » par `id` ou `name` dans `v1/regionservers` |
| **Les en-têtes** | `Request is incorrect. (code 3)` | **dix en-têtes** sur CHAQUE requête : `Accept`, `Accept-Language`, `Accept-Encoding`, `X-Api-Version`, `X-Client` (`android(<os>;<modèle>)`), `X-Locale`, `X-Hour`, `X-TimezoneId`, `X-Timezone` (**décalage décimal**, « 2.0 »), `User-Agent` |
| **L'inventaire** | `discovery/device_roster_v2` en `Request is incorrect.` | **deux appels** : `group/family/list` puis le roster **par groupe**, avec `day` (AAAAMMJJ) ET `groupId` |
| **Le chemin du détail** | `ctw3/device_detail` → **404** | une fontaine répond sur `<type>/deviceData`, une mangeoire sur `<type>/device_detail` |
| **Le type Bluetooth** | `ble/connect` → `Vous n'avez pas de permission. (code 4)` | le champ `type` veut le **code NUMÉRIQUE** du modèle (24 pour une Ctw3), pas la chaîne |

**Leçon transposable** : chez PetKit, « code 3 » veut dire *en-têtes incomplets* et « code 4 »
*mauvais type*, pas ce que leurs libellés laissent croire. Et un message d'erreur n'est utile que
s'il arrive à l'écran — voir la section « L'enveloppe d'erreur » plus bas.

## Ce que le roster ne dit pas

`discovery/device_roster_v2` rend `{ hasRelay, devices: [{ type, id, groupId, deviceTypeId }] }`.
Le `type` arrive en **casse mixte** (`D4`, `Ctw3`), et il n'y a **ni nom ni adresse Bluetooth**.

Le nom que l'utilisateur a donné (« Mangeoire 1 », « Fontaine 1 ») et le `mac` sans lequel aucun relais
n'est possible ne vivent que dans le DÉTAIL. Le plugin les récolte au premier sondage
(`toIdentity`) et — point important — **les conserve d'un tour de roster à l'autre** : reconstruire
la liste à neuf les effacerait, et une fontaine sans `mac` redevient injoignable jusqu'au sondage
suivant.

## Mangeoire `d4` (Fresh Element Solo)

`state` : `food` (**1 = il en reste**, 0 = trémie vide), `desiccantLeftDays`, `feeding`,
`batteryPower`, `wifi.rsq`, et `feedState` avec `realAmountTotal` (servi) et `planAmountTotal`
(**prévu du jour**). Le plan de la semaine est dans `multiFeedItem.feedDailyList` : sept listes
(`repeats` 1 = lundi … 7 = dimanche) de repas `{ time (secondes depuis minuit), amount, name }`.
C'est de là que vient le « Prochain repas 19:00 » de la carte.

Trois observations que seule la capture donne :

- **Pas de `eatAmountTotal`** : sans plateau pesant, ce modèle ignore ce qui a été MANGÉ. La ligne
  correspondante n'apparaît pas sur la carte plutôt que d'afficher un tiret à vie.
- **`batteryPower: 0` sur une machine au secteur sans piles** — ce n'est pas une batterie à plat,
  et publier « 0 % » serait un faux. On ne publie que du positif.
- **Pas de `callPet`** : `d4/callPet`, `d4/call_pet` et `d4/soundList` répondent tous **404**. Une
  Fresh Element Solo n'a pas de haut-parleur. La capacité `call_pet` n'est déclarée que pour les
  modèles à caméra et micro (`CALL_PET_TYPES`). Le bouton avait été mis en place d'après une
  bibliothèque tierce et ne faisait rien ; c'est l'utilisateur qui l'a remarqué.

### L'unité n'est pas le gramme

**`settings.factor: 10`** : les quantités d'un `d4` sont des **dixièmes de tasse**. L'appli du
fabricant écrit « 3/10 cup », et pour le plan « 1/2 (environ 50 g) » — soit 10 g par dixième.
Les afficher en grammes se trompait d'un facteur dix.

Le contrat porte donc l'unité PAR APPAREIL (`meta.petFeeder.unit`, voir
`../1_architecture/1_1_contrat-appareils.md`) : un `d3` (Fresh Element Infinity) pèse vraiment en
grammes. La contrepartie en grammes affichée à côté des tasses est une **estimation**, calculée
depuis un réglage (`settings.cupGrams`, 100 g par défaut — le chiffre du fabricant) que
l'utilisateur cale en pesant une ration une fois. D'où le « ~ » qui l'accompagne partout.

### Servir une ration — VÉRIFIÉ

`POST <type>/saveDailyFeed` avec `{ deviceId, day, time: -1, amount }`, `amount` **en unité brute**
(l'utilisateur demande 0,1 tasse, la machine reçoit 10). Réponse :
`{ id, time, amount, src: 3, status: 0, isExecuted: 1 }`, et `realAmountTotal` a augmenté d'un dixième de tasse.

Le plugin **relit après la commande** : l'accusé dit « reçu », jamais « tombé ». Une ration hors de
la liste déclarée est refusée ici plutôt que laissée à l'arrondi silencieux du fabricant.

## Fontaine `ctw3` (Eversweet Max)

`mode` (2 = intermittent), **`status.powerStatus`** (la marche de la pompe est IMBRIQUÉE, pas au
premier niveau — lue à côté, la fontaine paraît éteinte en permanence), `filterPercent`,
`filterWarning`, `lackWarning`, `breakdownWarning`, `electricity.batteryPercent`, `syncTime`.

**`-1` est une sentinelle « non compté »**, pas une valeur : `todayCleanWater`,
`filterExpectedDays`, `waterPumpRunTime` et `expectedCleanWater` valaient tous -1 sur les
machines relevées. Les lire comme des zéros afficherait « 0 mL bus » et « 0 jour de filtre », deux
mensonges — même piège que la sonde absente rendue à -39 par MELCloud.

Une Eversweet Max **ne mesure aucun volume**. Ce qu'elle sait, c'est compter ses VISITES :
`POST <type>/getWorkRecord` avec `{ day, deviceId, userId }` (le propriétaire vient de l'appareil ;
sans lui, « L'appareil n'a pas été trouvé. (code 703) ») rend une entrée
`{ workTime, dayTime, stayTime }` par passage. C'est le « 6 fois » et la durée moyenne de l'appli.
La capacité `water_usage` porte donc ici des **passages**, pas des millilitres.

### Le mode s'appelle « intermittent », pas « à l'approche »

Corrigé le 2026-09-21 : les deux régimes s'étaient d'abord appelés `normal` et `smart`, et `smart`
avait été traduit « à l'approche » — un contresens. L'appli du fabricant dit « Intermittent » et
affiche le cycle en minutes (« 3 Mins En cours, 3 Mins Pause ») : c'est une **minuterie**, pas une
détection de présence. Le contrat porte `continuous` / `intermittent`.

## Le relais Bluetooth

Séquence, corps `{ bleId, type, mac }` où `type` est le **code numérique** :

```
ble/ownSupportBleDevices?groupId   qui peut relayer ? (`pim: 1` = en ligne)
ble/connect                        demande acceptée ? → {state: 1}
ble/poll × n                       0 en cours, 1 connecté, -1 échec (4 s entre deux)
…lecture ou commande…
ble/cancel                         refermer — dans un `finally`, toujours
```

**Établi en 5 secondes** sur la machine réelle, pas les deux minutes que laissait craindre le pire
cas de la boucle.

### La trame de pompe, MESURÉE

```
[250,252,253]   en-tête
220             « régler la pompe »
1, <compteur>   numéro de séquence
3, 0            longueur de la charge utile
<marche>        1 = tourne, 0 = pause
<mode>,<mode>   1 = continu, 2 = intermittent — RÉPÉTÉ DEUX FOIS
[251]           pied
```

**Le mode répété est ce que les tables tierces ont faux.** Leur trame d'intermittent (`…,1,2,1`)
est **accusée « 1 » et ne change rien** ; seule `…,1,2,2` bascule la machine. Un accusé de
réception ne prouve donc rien ici — c'est la relecture du mode qui tranche, et c'est ainsi que la
bonne trame a été trouvée (même leçon que le `dock` accepté et ignoré du Roomba, `3_14_irobot-roomba.md`).

Marche et régime voyagent dans la MÊME trame : le plugin retient le régime courant
(`lastFountainMode`) pour n'en changer qu'un à la fois — sinon éteindre la pompe la ferait aussi
repasser en continu, à l'insu de tout le monde.

**Arrêt et remise en route vérifiés** : `powerStatus` 1 → 0 **avec le mode préservé** (2 avant,
2 après), puis retour à 1 du premier coup.

### Forcer une synchronisation n'est PAS à notre portée

Essayé : relais ouvert, puis les deux trames de demande de données de l'appli (215 et 216). Elles
sont **acceptées** et `syncTime` **ne bouge pas**. La fontaine, elle, se synchronise très bien seule.

D'où une décision à contre-courant du premier dessin : **il n'y a pas de sondage périodique par
relais**. Il aurait mobilisé la radio de la mangeoire voisine toutes les dix minutes pour ne rien
rafraîchir — et une note tierce avertit qu'un relais rouvert plus souvent que toutes les 7 minutes
FIGE certains appareils. Le relais ne sert qu'aux COMMANDES ; la carte montre l'âge du relevé
(`syncedAt`) plutôt que de faire croire au temps réel, comme `readAt` sur un véhicule endormi.

## Configuration et routes

Clés `PETKIT_*` : `PASSPORT_URL`, `GATEWAY` (vide = déduite de la région), `REGION`, `TIMEZONE`,
`APP_VERSION`, `SESSION_FILE`, `POLL_MS` (5 min).

*(Précision 2026-10-06 : ce bloc est documenté dans `apps/server/.env.example` depuis le 2026-10-06 ; défauts `PETKIT_REGION` = `FR`, `PETKIT_TIMEZONE` = `Europe/Paris`, `PETKIT_POLL_MS` = 300 000.)*

| Route | Rôle |
|---|---|
| `GET /api/plugins/petkit/status` | ce que la carte des Réglages affiche (jamais le jeton) |
| `GET /api/plugins/petkit/raw` | dernier relevé BRUT, par appareil |
| `POST /api/plugins/petkit/login/code` | étape 1 : demander un code |
| `POST /api/plugins/petkit/login` | étape 2 : l'échanger contre une session |
| `POST /api/plugins/petkit/logout` | effacer le jeton |

### L'enveloppe d'erreur

Les routes de ce plugin rendent `{ error: { code, message } }`, l'enveloppe que
`apiErrorSchema` (donc l'interface) sait lire. **Les routes de MELCloud et de Renault rendent
encore `{ error: "<texte>" }`** : l'analyse échoue côté client, le message du fabricant est perdu
et l'écran n'affiche qu'un « HTTP 502 » muet. C'est exactement ce qui a fait perdre du temps au
premier appairage — à corriger sur ces deux plugins.

## Ce que le plugin ne fait pas, volontairement

Le plan de repas (il s'édite dans l'appli du fabricant ; une ration servie ici s'y ajoute sans le
toucher), les vidéos et la détection d'animal (les modèles relevés n'ont pas de caméra), les
litières et purificateurs (non pris en charge).

Non lu, noté pour plus tard : les graphiques par jour, les rapports d'activité nommés (« Goûter du
soir », « Dîner »), la durée moyenne de repas côté mangeoire, et le « mode batterie » de la
fontaine — un quatrième régime que le contrat ne porte pas.
