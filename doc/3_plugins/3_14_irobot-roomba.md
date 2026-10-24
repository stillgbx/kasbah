# Plugin iRobot (Roomba, courtier MQTT local)

> Dernière mise à jour : 2026-10-24
> Sources : `apps/server/src/plugins/irobot/{index,auth,discovery,mqtt,mapping,types}.ts`, tests `discovery.test.ts`, `mqtt.test.ts`, `mapping.test.ts`, `plugin.test.ts` (51 cas), fixtures `apps/server/src/plugins/irobot/__fixtures__/{shadows.ts,discovery.json}`, `apps/server/src/plugins/index.ts`, `apps/server/.env.example`, `apps/web/src/components/IrobotLinkCard.vue`, `apps/web/src/views/RobotsView.vue`, `apps/web/src/components/controls/VacuumControl.vue`, `apps/web/src/api/transport.ts`, commits 14dae06 et ec07f7e, `packages/shared/src/devices/{kinds,state}.ts`, `packages/mock-sim/src/behaviours/robots.ts`, journal de session `_generated-ai-doc/sessions/2026-09-19-irobot/journal.md` et captures `shadow.json` / `transitions.json` / `favori-capture.json`

## Le robot du parc, et ce que la phase 1 en publie

Un **Roomba Combo** (`sku c755840`). Un robot = **un appareil `vacuum`**, identifié par son **BLID** —
l'identifiant fabricant, déjà utilisé comme identifiant MQTT, stable et sans `:` ni espace : c'est
lui que `house.json` liera.

**Phase 1 = le contrat `vacuum` tel qu'il existe**, et rien d'autre : activité, batterie, bac plein,
message d'erreur, et les quatre gestes (`vacuum.start`, `vacuum.pause`, `vacuum.dock`,
`vacuum.locate`) sous les capacités `clean`, `dock`, `battery`, `locate`. Aucun champ n'a été ajouté
au contrat partagé pour ce plugin.

Ce n'est pas que le robot en dise peu — **il dit 80 clés de premier niveau**, et la phase 1 en
publie quatre. Ce qui reste dehors est listé plus bas ; le choix est de ne pas élargir le contrat
avant de savoir quelle vue en ferait quelque chose.

## Pourquoi un détour par le cloud alors que tout se passe ensuite en local

C'est la seule décision de ce plugin qui mérite d'être expliquée, parce qu'elle a l'air fausse : le
robot héberge **son propre courtier MQTT** sur son adresse locale, y pousse son état de lui-même, et
une fois relié **rien ne sort du réseau de la maison** — ni sondage, ni quota, ni cloud. Et pourtant
il faut se connecter une fois au compte iRobot.

Ce qui manque, et ce qui manque seulement, c'est le **mot de passe de ce courtier**.

### La voie locale a été essayée, et elle est fermée

Les Roomba rendaient historiquement ce mot de passe à qui le demandait sur le réseau : un datagramme
magique sur le port 8883, après un appui long sur HOME. Sur ce firmware, le mécanisme **répond
encore, mais pour refuser** :

- **115 tentatives sur 5 minutes**, bouton HOME maintenu, réponse invariable : `f005efcc3b29`**`03`**
  là où un robot coopératif renvoie le mot de passe. Le `03` final est un refus, pas un secret court.
- Et le robot **l'annonce lui-même** : sa carte d'identité de découverte porte **`cap.pw: 0`**.

Autrement dit, le fabricant a **retiré une voie d'accès par mise à jour de firmware**, et a eu
l'obligeance de le déclarer dans ses propres métadonnées. Un test le verrouille au niveau du parseur
de découverte (`discovery.test.ts`, « annonce que ce robot ne rend plus son mot de passe en local »)
— le jour où un robot du parc dira `cap.pw: 1`, on le saura sans refaire 115 essais.

### La voie du compte, en trois temps, une seule fois

`auth.ts` :

1. **`GET /v1/discover/endpoints?country_code=…`** — endpoint **public**, sans identifiants. Il rend
   la clé Gigya du moment, le centre de données Gigya, et la base HTTP du **déploiement courant**
   (`current_deployment`, plusieurs déploiements coexistant). Rien n'est codé en dur : le fabricant
   peut déplacer son API sans casser le plugin.
2. **`POST accounts.login`** chez Gigya — rend une **signature d'identité** (UID, signature,
   horodatage).
3. **`POST {httpBase}/v2/login`** avec cette signature — rend, **pour chaque robot du compte**, son
   **mot de passe LOCAL**, plus `sku`, `softwareVer`, `name`, `cap`, `digiCap`, `svcDeplId`,
   `user_cert`.

**Ce qui survit à la requête** : le mot de passe local de chaque robot, dans
`IROBOT_SESSION_FILE` (0600, écriture atomique `.tmp` + `rename`). **Le mot de passe du COMPTE ne
survit pas** : il traverse le serveur le temps de l'étape 2, n'est ni écrit, ni journalisé, ni mis en
configuration — et un test le vérifie explicitement (« ne renvoie JAMAIS un mot de passe dans le
statut »). Même arbitrage que Renault ([3_9_renault](3_9_renault.md)) et MELCloud
([3_13_mitsubishi-melcloud](3_13_mitsubishi-melcloud.md)), pour la même raison : pas d'OAuth
possible.

**Gigya répond HTTP 200 même quand elle refuse** — la facture avait déjà été payée chez Renault.
C'est `errorCode` qui tranche, jamais le statut : `403042` = identifiants refusés (rendu
`NEEDS_PAIRING`, HTTP 401 côté route), `403101` = double authentification, que ce plugin **ne sait
pas franchir** et dit franchement plutôt que de boucler.

Une fois cette requête faite, **elle ne se refait plus** : le mot de passe local ne bouge pas, et la
liaison se reprend du fichier au démarrage sans toucher au cloud (`auth.restore()`, testé).

## Le lien local : trouver le robot, puis lui parler

### Découverte : une diffusion UDP, aucune adresse à configurer

Un datagramme `irobotmcs` en **diffusion sur UDP/5678**, et chaque robot répond par sa carte
d'identité en JSON (`robotid`, `ip`, `robotname`, `sku`, `sw`, `proto`, `cap`). Trois envois espacés
de 700 ms, écoute de 4 s : l'UDP se perd, et un robot posé sur sa base répond parfois au deuxième.

Conséquence voulue : **aucune adresse IP en configuration**, et une adresse changée par le DHCP se
rattrape au balayage suivant (`IROBOT_SCAN_MS`, deux minutes) — le lien MQTT est alors refermé et
rouvert sur la nouvelle.

**Deux sources pour un même robot, et il faut les deux** : le **compte** dit quels robots existent et
leur mot de passe, mais pas où ils sont ; la **diffusion** dit qui est sur le réseau et à quelle
adresse, mais ne donne rien pour s'y connecter. Un robot du compte introuvable sur le réseau **reste
dans l'inventaire**, marqué indisponible : le faire disparaître parce qu'il est éteint ferait sortir
son entrée de la maison.

Le parseur gère aussi les robots anciens, qui ne mettent le BLID que dans `hostname`
(`Roomba-<blid>`), et **préfère l'adresse que le robot annonce** à celle du datagramme : c'est celle
qu'il croit avoir, donc celle que son courtier écoute.

### Le courtier : TLS 1.3, et une seule session

Relevé sur le robot : **TLS 1.3, `TLS_AES_256_GCM_SHA384`**, sur le port **8883**, avec un certificat
**iRobot au nom du robot** — aucun chiffre hérité à réactiver, contrairement à ce que traînent les
intégrations tierces anciennes. Le certificat est signé par une autorité maison du fabricant, donc
invérifiable ici : `rejectUnauthorized: false`, en assumant que **le secret qui protège la liaison
est le mot de passe, pas la chaîne de certification**.

Le robot s'authentifie avec son **BLID en identifiant d'utilisateur ET en identifiant de client**, le
mot de passe étant celui obtenu une fois par le compte.

**Le courtier n'accepte qu'une session à la fois.** Mesuré : un second client se voit refuser la
connexion (**`ECONNREFUSED` au niveau TCP**) et **le premier n'est pas chassé**. Premier arrivé,
premier servi. La conséquence pratique compte : tant que Kasbah tient le lien, l'appli du fabricant
en mode local ne passe plus — et réciproquement. Voir la contradiction relevée en fin de page, le
code décrit l'inverse.

*(Constat du lint du 2026-10-06 : le code ne décrit plus l'inverse — le commentaire de tête de `apps/server/src/plugins/irobot/mqtt.ts` dit « le premier arrivé la garde » (commit bfa7b76). L'effet sur l'appli iRobot en local reste non vérifié avec l'appli elle-même.)*

## Le robot parle en DELTAS : l'ombre accumulée est obligatoire

Le robot **ne republie pas son état entier** à chaque changement : il envoie le fragment qui bouge,
**parfois une seule clé** (`transitions.json` : six messages de suite dont quatre ne portent qu'un
seul champ modifié).

Un mappage appliqué au seul fragment reçu est donc structurellement incapable de décider d'un état
qui dépend de deux champs — et c'est exactement le cas de l'activité. D'où `mergeShadow` : une
**ombre complète par robot**, accumulée depuis l'ouverture du lien, et le mappage appliqué **à elle**.

Deux règles de fusion, toutes deux dictées par ce que le robot envoie :

- un **objet** se fond clé à clé ;
- **tout le reste REMPLACE** — un tableau rendu par le robot (la liste des zones d'une carte) est une
  valeur entière, pas une suite à compléter.

Et le message arrive sous deux formes selon le topic : `{state:{reported:{…}}}` (forme d'ombre AWS)
ou l'objet nu. `extractReported` rend `null` sur un topic illisible **plutôt que de lever** : un
topic inattendu ne doit pas couper la liaison.

C'est la troisième variante du « complet ou deltas ? » de
[3_2_ecrire-un-plugin](3_2_ecrire-un-plugin.md), après le pont Hue (complet) et Overkiz / Husqvarna
(deltas dans un flux à côté d'une liste complète) : ici il n'y a **que** des deltas, il n'existe
aucune lecture complète à demander.

## `phase` et `cycle` ne basculent pas ensemble (le piège de mappage)

L'activité tient à **deux champs** de `cleanMissionStatus` : `phase` (ce que le robot fait) et
`cycle` (y a-t-il une mission ouverte). Ils **ne changent pas au même instant**, et l'écart est
largement visible :

| Retour à la base | `phase: charge` | `cycle: none` | écart mesuré |
|---|---|---|---|
| 1ᵉʳ (fixtures) | t | t + 4 s | **4 s** |
| 2ᵉ (`transitions.json`) | t | t + 11 s | **11 s** |

Pendant ces quatre à onze secondes, le robot est **posé sur sa base** (`phase: charge`) avec une
**mission encore ouverte** (`cycle: clean`). Un mappage qui lirait `cycle` en premier y publierait
donc « **en pause** » sur un robot à quai, pendant plusieurs secondes, à chaque retour. D'où la
règle : **`phase` décide, `cycle` n'est consulté que là où `phase` ne tranche pas**.

Le seul cas où `phase` ne tranche pas est `stop` (« immobile ») : c'est alors `cycle` qui dit s'il
reste une mission à reprendre — autre chose que `none` ⇒ `paused`, `none` ⇒ repos. Un test porte ce
cas sous son nom (`ne publie pas « en pause » pour un robot posé dont la mission n'est pas encore
refermée`), et la fixture `DOCKED_MISSION_OPEN` n'existe que pour lui.

Deux notes de lecture, du même relevé :

- **`evac` est un repos, pas une mission.** Le robot est sur sa base en train de s'y vider : `docked`.
- **`notReady` est transitoire à quai.** Observé à l'arrivée : `0 → 39 → 68 → 0`, le tout en une
  quarantaine de secondes, le temps que le robot se pose et se vide. En faire un « robot
  indisponible » ferait clignoter la maison à chaque retour ; la phase 1 ne le publie pas.
- Le contrat `vacuum` **n'a pas d'état « arrêté là où il est »** (le `mower`, lui, l'a). Un robot à
  l'arrêt sans mission ressort donc en `docked`, faute de mieux à dire — c'est écrit dans le code
  comme un pis-aller, pas comme une vérité.

## Le piège qui a coûté le plus : une commande ACCEPTÉE et perdue en silence

C'est la leçon principale de la séance, et elle ne se déduit d'aucune documentation.

**`dock` envoyé pendant le nettoyage est accepté, enregistré, et ignoré.** Mesuré sur le vrai
robot : le message est publié sans erreur, le robot l'inscrit dans son `lastCommand`
(`{command: "dock"}`) — et **ne fait rien**. Deux minutes et demie plus tard, il était toujours en
`phase: run`. Aucun refus, aucun code d'erreur, aucun rejeu. Un plugin qui se fierait à l'accusé du
courtier afficherait un bouton « Rentrer » qui **ment**.

Il faut donc l'arrêter d'abord : `pause`, **puis** `dock`. C'est ce que fait l'appli du fabricant.

**Et le `pause` ne suffit pas non plus.** Un `dock` envoyé ~1 s après le `pause` est avalé de la même
façon (robot resté en pause 2 min 30). Le robot **annonce son arrêt avant d'être en mesure de
l'honorer** : `phase: "stop"` apparaît dans l'ombre plus tôt qu'il n'accepte le geste suivant.

Le délai a donc été **mesuré, pas choisi** :

| Délai entre `pause` et `dock` | Le robot rentre ? |
|---|---|
| ~1 s | **non** |
| 3 s | oui |
| 8 s | oui |

**3 s retenues** — la plus petite valeur vérifiée (`DOCK_GRACE_MS`), à quoi s'ajoute une attente
active que l'ombre cesse de dire « nettoie », bornée à **4 s** (`STOP_WAIT_MS`, l'ombre a basculé en
1 s à la mesure). **Somme au pire : 7 s**, et ce chiffre n'est pas libre : il doit tenir sous
**`KASBAH_COMMAND_TIMEOUT_MS`** (10 s par défaut, `config/env.ts`), au-delà duquel c'est le serveur
qui coupe la commande. Un délai de grâce « confortable » de 15 s aurait rendu le bouton inutilisable.

**Corroboration du 2026-09-19 — l'appli du fabricant fait exactement la même chose.** En
observant le courtier local pendant qu'on pilotait le robot depuis l'appli iRobot, on a vu passer un
`pause`, puis un `dock` **six secondes plus tard**. Personne n'a cliqué deux fois : c'est l'appli qui
enchaîne les deux verbes avec son propre délai. Ça change le statut de tout ce qui précède —
`DOCK_GRACE_MS` cesse d'être une valeur trouvée à tâtons en trois essais pour devenir la
**reproduction d'une séquence que le fabricant tient lui-même pour nécessaire**. Et les 3 s retenues
se lisent désormais comme le **bas** d'une fourchette dont iRobot prend le milieu : si un `dock` se
reperdait malgré la grâce, monter vers 6 s serait la première chose à essayer — mais le budget ne le
permet plus tel quel (3 + 4 = 7 s tiennent sous les 10 s du serveur ; 6 + 4 = 10 s non).

Deux détails de méthode qui comptent :

- l'attente d'arrêt **lit l'ombre**, pas une horloge : c'est le robot qui dit quand il s'est arrêté.
  Passé le budget, on continue quand même — mieux vaut un geste qui échoue franchement qu'un plugin
  suspendu à un robot muet ;
- **vérifié en vrai après correctif** : `dock` pendant le nettoyage → HTTP 200 en **4026 ms** →
  `returning` → `docked`. Et le test unitaire a été **vu rouge** en remettant `DOCK_GRACE_MS` à 0 —
  sans quoi il n'aurait rien prouvé (cf. la leçon COMAP dans
  [3_2_ecrire-un-plugin](3_2_ecrire-un-plugin.md)).

Même famille de problème sur `vacuum.start` : le contrat n'a **qu'un bouton**, le robot distingue
`start` (nouvelle mission) de `resume` (reprendre). C'est donc **l'activité courante** qui décide du
verbe. Vérifié sur le robot : `lastCommand: {command: "resume", initiator: "localApp"}`, et il est
reparti. C'est pourquoi `toRobotCommands` rend une **suite de verbes** et non un verbe.

## Ce que le robot dit et que le contrat ne porte pas

Vu dans l'ombre capturée, **hors contrat en phase 1**, et rangé ici pour que la question ne se
repose pas de zéro :

- **la serpillière du Combo** : `detectedPad` (valait `"invalid"`, patin retiré), `tankPresent`,
  `tankLvl`, `padWetness` ;
- **les cartes de pièces** : `pmaps` (le robot annonce `cap.pmaps: 9`), et dans `lastCommand` les
  champs `pmap_id` / `regions` / `favorite_id` — de quoi, un jour, lancer le nettoyage d'**une
  pièce** ;
- **les compteurs de vie** : `bbrun`, `bbmssn`, `bbchg` — une vingtaine de clés ;
- **`notReady`**, **`dock.state`**, **`signal`** (rssi/snr/noise), **`bin.type`** et **`bin.present`**
  à côté du seul `bin.full` qui entre au contrat.

Aucun de ces champs n'a d'endroit où aller dans le kind `vacuum` aujourd'hui, et le parti pris du
projet est constant : **on n'invente pas un champ de contrat avant d'avoir une vue qui le lirait**.
`GET /api/plugins/irobot/raw` les montre tous en attendant.

## Fixtures : capturées, sauf deux, et le fichier le dit

`__fixtures__/shadows.ts` est un **sous-ensemble curé de la capture réelle** du 19/09, prise sur le
courtier local pendant qu'on pilotait le robot depuis l'appli du fabricant. Cinq états viennent d'une
séquence **réellement jouée et horodatée** (pause → retour → posé mission ouverte → posé mission
refermée → reparti).

Ce qui a été **écarté** ne l'a pas été pour alléger le test : `netinfo` (adresse, passerelle, BSSID),
`wlcfg` (SSID), `hwPartsRev` (MAC, numéros de série), `batInfo`, `secureBoot` — **une fixture est un
fichier versionné**. La fixture de découverte porte un BLID et une adresse maquillés pour la même
raison. Tout le reste est la valeur réelle, **bizarreries comprises** (`detectedPad: "invalid"`,
`bin.type: "std"`, `dock.state: 300`).

Deux fixtures sont **CONSTRUITES, et leur commentaire le dit en toutes lettres** :

- **`BIN_FULL`** — le bac était vide toute la séance. Le champ est bien celui que le robot publie
  (`bin.full`, vu à `false`) ; seule sa valeur est posée à la main.
- **`STUCK`** — le robot n'est tombé en panne à aucun moment, et on n'a pas voulu l'y mettre. C'est
  **la fixture la moins sûre du lot** : le code 17 et l'appariement `error != 0` ↔ `phase: "stuck"`
  viennent de ce que rapportent les implémentations tierces. À remplacer par un relevé de `/raw` au
  premier vrai incident.

Même logique pour la table de textes d'erreur (`ERROR_TEXT`) : **partielle et non vérifiée sur ce
robot**, et un code inconnu ressort en `Error N` plutôt qu'en libellé inventé. Le contrat `vacuum`
n'ayant pas de champ `errorCode`, le numéro n'apparaît que dans ce texte de repli.

## Configuration et routes

| Clé `.env` | Rôle |
|---|---|
| `IROBOT_SESSION_FILE` | Où vivent les mots de passe **locaux** des robots (0600). **Jamais celui du compte.** Vide = liaison perdue au redémarrage, et la carte des Réglages le dit. |
| `IROBOT_COUNTRY` | Code pays envoyé à la découverte d'endpoints (`FR`). Il choisit le centre Gigya, pas le déploiement. |
| `IROBOT_DISCOVERY_URL`, `IROBOT_APP_ID`, `IROBOT_USER_AGENT` | Points d'entrée et identité d'application du fabricant, **défauts dans le code**. En configuration pour la raison apprise chez Renault : une rotation de clés côté fabricant a mis en panne toutes les intégrations tierces le même jour. |
| `IROBOT_SCAN_MS` | Cadence du balayage réseau (120 000 par défaut). Il ne sert **qu'à localiser** : l'état arrive tout seul par MQTT. |
| `IROBOT_SCAN_TIMEOUT_MS` | Durée d'écoute d'un balayage (4 000). |

**Aucun secret en configuration** : le compte se relie depuis les Réglages.

Routes (préfixées `/api/plugins/irobot`) :

- `GET /status` — ce que la carte affiche : compte lié, robots connus (nom, `sku`, adresse,
  lien ouvert ou non). **Jamais un mot de passe.**
- `POST /login` / `POST /logout` — relier (puis balayage immédiat, pour que la carte montre le robot
  sans attendre deux minutes) et délier (liens fermés, mots de passe effacés). **409** si le plugin
  est décoché : les routes sont montées même éteint, mais il n'y a alors pas de client à qui parler.
- `GET /raw` — ce que le réseau a trouvé **et** l'ombre complète de chaque robot. C'est par là qu'on
  capture les fixtures et qu'on décidera ce qui mérite d'entrer au contrat.

**Santé** : `needs_pairing` tant que le compte n'est pas relié ; `degraded` si aucun robot n'est
joignable sur le réseau (ou seulement une partie) ; `ok` avec le nombre de liens ouverts — vérifié
en vrai : « N robot connected locally », état `docked` / batterie pleine / bac non plein.

**Pas de `quota`** dans la santé, et c'est un fait notable après Tesla, Husqvarna et Renault :
une fois relié, ce plugin **ne consomme rien** chez le fabricant.

## Côté web

**Carte de liaison** (`IrobotLinkCard.vue`, montée par `PluginSection`) : même forme que la carte
Renault — un vrai formulaire, faute d'OAuth — mais son texte d'introduction dit **pourquoi** on
demande un mot de passe alors que tout est local, et que ce détour existe parce que les Roomba
récents ne rendent plus leur mot de passe local. La liste des robots reste **affichée même quand
aucun ne répond** : le compte fait foi pour l'existence, le réseau seulement pour la joignabilité —
chaque ligne garde donc une place fixe, et c'est la pastille qui change (règle « rien ne bouge »).

**Vue Robots** : elle ne listait que le kind `mower`, elle accueille désormais aussi les `vacuum`.
La carte aspirateur est **volontairement plus courte** : le contrat ne porte que l'activité, la
batterie, le bac et l'erreur — ni carte satellite (le robot ne dit pas où il est), ni journal (il ne
déclare pas la capacité), ni compteurs de vie. **Afficher ces sections vides pour faire pareil que la
tondeuse mentirait** sur ce qu'on sait de lui. Détail dans
[../4_ui/4_1_navigation-et-panneaux](../4_ui/4_1_navigation-et-panneaux.md).

**Un bug d'interface préexistant, révélé par ce plugin** : voir la même page. En deux lignes —
Vuetify pose `flex-shrink: 0` sur tout `v-btn`, les trois boutons du contrôle `VacuumControl`
réclamaient **342 px dans un panneau de 294**, et « Localiser » sortait du cadre, inatteignable.
Personne ne l'avait jamais vu parce que **le sous-item `vacuum` de la simulation est décoché** : le
contrôle n'avait jamais été affiché. Un plugin réel qui découvre un bug d'UI vieux de plusieurs mois
est un argument de plus pour brancher de vrais appareils tôt.

## Ce qui reste ouvert

- **La serpillière, les cartes de pièces, les compteurs de vie** : le robot les dit, le contrat ne
  les porte pas. La question à trancher n'est pas « peut-on les lire » (oui, `/raw` les montre) mais
  « quelle vue les lirait ».
- **`STUCK` et `BIN_FULL` sont construites** : à remplacer par une vraie capture au premier incident.
- **La table de codes d'erreur** est à compléter au fil de ce que le robot produit.
- **Le robot n'a pas de position** : rien à placer dans la scène 3D au-delà de sa base (les places de
  stationnement acceptent déjà une base de robot, cf.
  [../2_maison/2_0_format-house-json](../2_maison/2_0_format-house-json.md)).
- **Un second robot sur le compte** n'a jamais été testé : le code est écrit pour N robots (une carte
  de liaison qui liste, un lien MQTT par BLID), mais ça n'est vérifié que par les tests.

## Mise à jour 2026-09-19 (phase 2, étape 1) — la serpillière entre au contrat

Le paragraphe d'ouverture disait « **aucun champ n'a été ajouté au contrat partagé pour ce plugin** ».
Ce n'est plus vrai depuis le commit `ec07f7e` : il y en a **deux**, plus une capacité. Ce qui précède
reste la description de la phase 1 ; ce qui suit dit ce que la phase 2 y ajoute.

**Ce qui entre** (`packages/shared/src/devices/{kinds,state}.ts`) :

- capacité **`mop`** sur le kind `vacuum` — « cet appareil **lave** en plus d'aspirer, et dit ce
  qu'il faut pour savoir s'il le peut » ;
- **`mopAttached`** (booléen, facultatif) — le patin est-il posé ;
- **`tankLevel`** (pour cent, facultatif) — l'eau restante.

**Deux champs et pas cinq.** Le robot publie aussi `padWetness`, `padDryAllowed` et `padWashAllowed` :
ce sont des **réglages de sa station**, pas un état d'appareil. Le contrat ne les prend pas, et le
partage habituel du projet tient — on n'élargit pas le contrat pour ce qu'aucune vue ne lirait.

### Les deux valeurs sont mesurées, pas déduites

C'est le cœur de ce qu'il faut retenir, parce que ni l'une ni l'autre ne se devine.

- **`detectedPad` vaut `"invalid"` quand aucun patin n'est posé**, et passe à **`"reusableWet"`**
  dans la seconde qui suit la pose (relevé avec la lingette réutilisable). Ce sont les
  **deux seules valeurs observées** sur ce robot. D'autres existent sûrement (patin sec, patin
  jetable), d'où la règle de lecture retenue : **tout ce qui n'est pas `invalid` est un patin**,
  plutôt qu'une liste blanche devinée qui refuserait un patin bien présent. Deux tests portent les
  deux moitiés de la règle, dont un sur une valeur inventée
  (`'une-valeur-que-le-firmware-inventera'` ⇒ patin).
- **`tankLvl` EST un pour cent**, et c'est une comparaison qui l'établit, pas une supposition :
  l'appli du fabricant affichait sa goutte **quasi vide** avec « Remplissez le réservoir »
  **pendant que l'ombre disait 10**. Sans ce recoupement, 10 aurait pu être une échelle maison, un
  décilitre ou un cran sur douze.
- **Réservoir retiré (`tankPresent: false`) ⇒ le niveau est EFFACÉ** (`tankLevel: null`), pas laissé
  à sa dernière valeur. La valeur qui traîne dans l'ombre ne veut plus rien dire, et surtout : un
  réservoir absent et un niveau inconnu **appellent le même geste**, aller voir la machine. Le
  contrat autorisant un patch à effacer un champ, autant s'en servir plutôt que de mentir de 10 %.

### La capacité suit ce que le robot annonce

`canMop(cap)` lit **`cap.scrub`** — la table de capacités du fabricant, présente aussi bien dans
l'annonce réseau de la découverte que dans l'ombre MQTT (`scrub: 1` sur ce Combo). Un Roomba **sec**
ne se voit donc pas déclarer `mop`, et sa carte n'affiche pas deux cases qu'il ne pourra jamais
remplir. C'est la même famille de décision que `cap.pw: 0` plus haut : **le robot dit ce qu'il sait
faire, on le croit** plutôt que de déduire des capacités d'un numéro de modèle.

Un détail de mise en œuvre qui a l'air d'une incohérence et n'en est pas : `toStatePatch` publie
`mopAttached` / `tankLevel` **même quand le descripteur ne déclare pas `mop`**. Le registre filtre
sur les clés du kind, pas sur les capacités — et un robot sec n'a de toute façon aucun de ces champs
dans son ombre, donc le patch est vide de lui-même. La capacité sert à l'**affichage**, pas au
filtrage de l'état.

### Le simulé lave aussi

`packages/mock-sim/src/behaviours/robots.ts` : l'aspirateur simulé déclare `mop`, part **patin posé
et 80 % d'eau**, et **son réservoir se vide en nettoyant** (au même rythme que la batterie, 70 points
sur la durée de cycle). Sans ça, les deux contrôles ne seraient vérifiables **qu'avec un vrai Combo
sous la main** — et la leçon du bug de débordement de `VacuumControl`, découvert le matin même parce
que le sous-item `vacuum` était décoché, venait précisément d'être payée. Détail dans
[3_0_simulation-mock](3_0_simulation-mock.md).

### Le piège d'environnement qui a failli faire conclure à un bug

`tsx watch` **n'a pas rechargé le serveur** après la modification de `packages/shared` : le lien de
workspace n'entre pas dans ce qu'il surveille. Le plugin a continué de tourner **avec l'ancien
contrat** — capacité absente, champs absents — **sans aucune erreur**, comme si le mappage ne
marchait pas. Redémarrage manuel obligatoire. Consigné dans
[../6_faq/6_1_pieges-runtime](../6_faq/6_1_pieges-runtime.md), parce que ça ne concerne pas ce
plugin en particulier.

Vérification faite **hors serveur**, en rejouant le mappage contre l'ombre RÉELLE relue sur le
courtier (`verif-mappage.ts` de la session) : capacité `mop`, `mopAttached: true`, `tankLevel` bas.

## Mise à jour 2026-09-19 (phase 2) — l'exploration : trois portes fermées, une ouverte

Avant d'écrire la serpillière, la question posée était plus ambitieuse : **peut-on faire bouger le
robot dans la scène 3D, et lancer le nettoyage d'une pièce ?** La réponse tient en quatre constats,
et ils valent d'être écrits parce qu'ils **évitent de reprendre la piste dans trois semaines**.

### 1. Le robot ne publie AUCUNE position — et ce n'est pas un réglage à trouver

Sonde de **160 s** sur le courtier pendant une mission **ordonnée par régions** (donc le cas le plus
favorable, celui où le robot sait où il va) : `cleanMissionStatus` **n'a pas bougé d'un champ**, et
**aucune clé neuve** n'est apparue dans l'ombre. Ni coordonnées, ni pièce courante, ni progression.

Ce qui rend le constat solide plutôt que négatif : **l'appli du fabricant, elle, affiche
« Aspiration : <nom de pièce> »** au même instant. Elle le sait donc — mais elle ne le tient pas du robot,
elle le tient du **cloud**, qui reçoit la carte et la trajectoire par un autre canal. Conclusion :
**animer le robot dans la scène 3D est impossible par la voie locale**, quelle que soit l'envie.

Et il n'y a **même pas de drapeau** disant qu'une mission ciblée est en cours. On avait d'abord cru
que `cleanMissionStatus.operatingMode: 2` le signalait ; la relecture des captures le dément :
pendant une seule et même mission par régions, il est passé de **1** à **2**,
et il valait **0** sur une mission manuelle en pause, puis **1** puis **0** pendant un retour à la
base. Trois valeurs, qui changent avec la phase autant qu'avec le type de mission : sa signification
n'est pas établie, et il ne peut pas servir à distinguer une mission ciblée d'une autre.

Ce qu'on a en revanche, c'est la LISTE des régions de la mission, puisque le robot garde l'ordre
reçu dans `lastCommand` (voir plus bas). De quoi dire « la mission couvre ces pièces-là » — jamais
« il est dans celle-ci ».

### 2. Pas de carte en local

`pmaps` ne contient **qu'un identifiant et une date de version** : `[{"<id de carte>":
"AAMMJJTHHMMSS"}]`. Rien d'autre. La **géométrie**, le **découpage en pièces** et surtout les **noms**
sont au cloud, et le robot le dit lui-même en annonçant `pmapCL: true` et `mapUploadAllowed: true` :
sa carte **monte**, elle ne descend pas.

### 3. Pas de compteurs de consommables en local

L'écran « Product Health » de l'appli (heures de brosse restantes, missions de lingette restantes,
filtre) **n'a aucun équivalent dans l'ombre**. Cloud lui aussi. Une jauge d'entretien dans Kasbah
supposerait donc de retourner au compte, ce que ce plugin ne fait qu'**une fois**, à l'appairage.

### 4. Mais les compteurs de VIE sont locaux, et riches

Relevés sur l'ombre (fin de séance) :

| Clé | Valeur | Ce que ça compte |
|---|---|---|
| `bbmssn.nMssn` | un entier | missions depuis toujours |
| `bbrun.nEvacs` | un entier | vidages du bac à la base |
| `bbrun.nStuck` | un entier | fois où il s'est coincé |
| `bbswitch.nClean` | un entier | départs par le bouton CLEAN — lecture PLAUSIBLE d'après le nom, jamais vérifiée : personne n'a appuyé sur le bouton en relisant le compteur |
| `bbsys.hr` | un entier | heures au compteur système |

Ce sont bien des compteurs **vivants** : la capture prise deux heures plus tôt dans la même séance
donnait des valeurs plus basses. C'est exactement l'équivalent des « **Compteurs** » que la vue
Robots affiche déjà pour la tondeuse. **Faisable, non fait** : il faudrait un champ de contrat (ou
une capacité `journal`-like) pour les porter, et la règle du projet reste « pas de champ avant une
vue qui le lirait » — sauf qu'ici, pour une fois, **la vue existe déjà**.

### La découverte qui rouvre les zones : un ordre cloud s'inscrit dans le `lastCommand` LOCAL

C'est le résultat de la séance qu'il ne faut pas perdre.

Un **favori lancé depuis l'appli** — donc un ordre venu du cloud, auquel Kasbah n'a aucun accès —
inscrit néanmoins **son ordre complet** dans le `lastCommand` que le robot publie **en local**.
Capture dans `_generated-ai-doc/sessions/2026-09-19-irobot/favori-capture.json` :

```json
{ "command": "start", "initiator": "rmtApp", "ordered": 1,
  "favorite_id": "<32 hex>", "pmap_id": "<id de carte>", "user_pmapv_id": "<version>",
  "regions": [ { "region_id": "1", "type": "rid",
                 "params": { "noAutoPasses": true, "operatingMode": 2, "twoPass": false } }, … ] }
```

Plusieurs régions dans celui-là (`region_id` non consécutifs — la numérotation
est **trouée**, ce ne sont pas des index), toutes avec les mêmes `params`.

**Conséquence : le nettoyage par zones est faisable EN LOCAL** — non pas en lisant la carte, qu'on
n'a pas, mais en **rejouant un ordre capturé**. On n'a pas besoin de savoir ce qu'est la région 14 ;
il suffit de l'avoir vue passer une fois pour pouvoir la redemander.

**Piste notée, non implémentée** : un favori iRobot ressemble beaucoup à une **scène de plugin**
Kasbah (`emitScenes` / `recallScene`, comme les scènes du pont Hue) — un identifiant opaque, un
libellé, un rappel qui rejoue un état. Ce qui manque reste les **noms** des régions, qui sont au
cloud ; ils se récolteraient en lançant **une fois** un nettoyage par pièce depuis l'appli et en
notant quel `region_id` en sort. Un apprentissage manuel, une fois, pour une maison.

### Ce que ces constats changent à la liste « Ce qui reste ouvert »

- **La serpillière** est faite (section précédente).
- **Les compteurs de vie** sont confirmés lisibles en local, et la vue qui les afficherait existe :
  c'est la plus proche du prochain pas.
- **Les cartes de pièces** ne viendront pas du local telles quelles ; la voie est l'ordre capturé,
  pas la carte.
- **Le robot n'a pas de position** : ce n'était qu'une observation de phase 1, c'est maintenant
  **mesuré sur le cas favorable** et ça ne bougera pas sans passer par le cloud.

### Contradiction détectée 2026-09-19 — qui gagne quand deux clients se présentent ?

*(Tranché : le premier arrivé garde la session, cf. le commentaire de tête de `apps/server/src/plugins/irobot/mqtt.ts` corrigé par le commit bfa7b76 ; l'effet sur l'appli iRobot en local reste non vérifié.)*

Deux sources de la même séance disent l'inverse l'une de l'autre sur le comportement du courtier
quand une seconde session s'ouvre :

- **Le journal de session, qui rapporte une mesure** : « le courtier du robot refuse une
  SECONDE session (`ECONNREFUSED` au niveau TCP) au lieu de chasser la première : un seul client à la
  fois, **premier arrivé premier servi** ».
- **Le commentaire de tête de `apps/server/src/plugins/irobot/mqtt.ts`** : « Si l'appli iRobot se
  connecte en local, elle nous chasse ; mqtt.js se reconnecte alors en boucle, ce qui est le
  comportement voulu — **le dernier arrivé gagne**, et on reprend la main dès qu'elle raccroche. »

Les deux ne peuvent pas être vrais. L'enjeu est concret : si c'est le **premier** qui gagne, alors
Kasbah, une fois connecté, **empêche l'appli du fabricant** de parler au robot en local tant que le
serveur tourne — ce qui est une décision produit, pas un détail. Si c'est le **dernier**, la
reconnexion en boucle de `mqtt.js` est le bon comportement et il n'y a rien à faire.

Le code, lui, se comporte pareil dans les deux cas (il retente toutes les 10 s) ; seule la
**documentation du comportement** diverge. **À arbitrer** : rejouer l'essai en ouvrant l'appli
iRobot pendant que le lien de Kasbah est établi, et corriger celle des deux sources qui a tort.
Rien n'a été modifié ici.

Voir aussi : les leçons transposables dans [3_2_ecrire-un-plugin](3_2_ecrire-un-plugin.md), la sortie
du tableau dans [3_3_fabricants-a-venir](3_3_fabricants-a-venir.md), et le kind `vacuum` dans
[../1_architecture/1_1_contrat-appareils](../1_architecture/1_1_contrat-appareils.md).

### Mise à jour 2026-10-24 — adresse de l'émetteur, certificat du robot épinglé

Constat F7 : n'importe quel hôte pouvait répondre à la découverte UDP en indiquant une autre `ip` dans
son message ; le serveur fermait le vrai lien et envoyait le mot de passe local du robot à cette adresse,
sans contrôle du certificat. Désormais l'adresse est celle de l'**émetteur** du datagramme, jamais le
champ `ip` du message, et un lien connecté n'est jamais remplacé sur la foi d'une réponse de découverte
(la nouvelle adresse n'est essayée qu'une fois le lien tombé). Le certificat de chaque robot est épinglé
dans `irobot-session.json` (champ `pin`, 0600). mqtt.js écrit son CONNECT avant la fin de la poignée de
main : le serveur construit lui-même le `MqttClient` sur un flux bloqué (`cork`) jusqu'au contrôle.
Relier de nouveau le compte efface l'épingle. Mécanisme commun : `apps/server/src/core/tls-pin.ts` (empreinte SHA-256 apprise au premier contact, contrôle sur le socket établi avant toute écriture ; reprise de session TLS coupée, car une session TLS 1.3 reprise n'expose pas de certificat ; un certificat absent est refusé). Rien n'a encore été essayé sur le vrai matériel : au premier démarrage, le journal doit montrer `device certificate pinned`. Une mise à jour de firmware qui change le certificat met le plugin en erreur jusqu'au ré-appairage : c'est voulu.
