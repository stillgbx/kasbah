# Plugin COMAP Proteo 2 (station de filtration d'eau, protocole reversé)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/comap/{index,socket,mapping}.ts`, `apps/server/src/plugins/comap/__fixtures__/station.ts`, tests `mapping.test.ts` et `plugin.test.ts`, `packages/shared/src/devices/state.ts` (`waterStateSchema`), `packages/shared/src/devices/kinds.ts`, `apps/web/src/components/controls/WaterCard.vue`, `packages/mock-sim/src/behaviours/water.ts`, notice constructeur `3356779005607_CENTRALE_TRAITEMENT_PROTEO_2.pdf` (28 pages), captures de session `_generated-ai-doc/sessions/2026-09-16-comap-proteo-2/captures/` ; mise à jour 2026-09-17 : `apps/server/src/plugins/comap/{history,state,socket}.ts` et leurs tests, `apps/server/src/core/plugin.ts` (`consumption?`), `apps/server/src/http/routes.ts`, `packages/shared/src/protocol/http.ts`, `apps/server/.env.example`, `apps/web/src/views/WaterView.vue`, `apps/web/src/components/water/WaterConsumptionChart.vue`, `apps/web/src/lib/consumption.ts`, `apps/web/src/three/markers/markers.ts`, journal de session `_generated-ai-doc/sessions/2026-09-16-comap-proteo-2/journal.md`

## Ce que la station est, et ce que le plugin en fait

Une **centrale de traitement de l'eau potable de toute la maison**, posée à l'arrivée d'eau :
antitartre électronique, préfiltre 80 µm, deux cartouches de charbon actif 10 µm, lampe UVc 25 W.
Modèle relevé : `Proteo V3`, à **192.168.1.92**.

Le plugin publie **un seul appareil** de kind `water` — pas six capteurs séparés. C'est un choix
explicite du propriétaire : la station est un objet, sa carte doit le rester. Il est en **lecture
seule**, alors même que le protocole sait écrire (voir plus bas) : les réglages se font sur l'écran
tactile, et une fausse manœuvre à distance sur l'eau potable coûterait plus cher que le confort
gagné.

Publié : usure des quatre consommables, état de la lampe UVc, débit instantané, consommation du
jour / de la semaine / du mois, avertissement et défaut. **Tout est local** — ni cloud, ni jeton,
ni quota, contrairement à Nest, Tesla ou Automower.

## Le protocole n'existe nulle part : il a été capturé

COMAP ne publie aucune API et personne ne l'a documenté publiquement (recherches infructueuses le
2026-09-16). Tout ce qui suit vient d'une capture du dialogue réel entre l'application mobile du
fabricant et la station.

### La méthode, réutilisable pour d'autres appareils

L'application Proteo **demande l'adresse IP de la station**. Il suffit donc de lui donner celle du
PC et d'y faire tourner un **relais TCP enregistreur** qui relaie vers la vraie station en notant
les deux sens : ni root sur le téléphone, ni interception TLS, ni extraction d'APK. L'outil tient
en 60 lignes (`captures/proteo-tap.mjs`). **Chaque fois qu'une application demande une IP saisie à
la main, c'est la voie à essayer en premier.**

La reconnaissance réseau avait d'abord égaré : ni 80 ni 443 ne répondent, **seul le port 23 est
ouvert**, il accepte la connexion, ne renvoie aucune bannière, ne négocie aucune option telnet et
reste muet face à Modbus RTU, Modbus TCP, AT et HTTP. Tout cela ressemblait à un pont série↔TCP
transparent. C'était faux : la station parle un protocole applicatif parfaitement propre, mais ne
dit rien tant qu'on ne le parle pas.

### Le dialecte

**JSON en clair, un message par ligne, sur TCP/23**, requête terminée par `\r\n`.

```
>  {"1234567":{"msgId":5,"read":["status","wear"]}}\r\n
<  {"1234567":{"msgId":5,"read":{"status":{…},"wear":{…}}}}
>  {"1234567":{"msgId":5,"write":{"lamp":{"p1":[0,1,7,1],"p2":[…],"p3":[…]}}}}
<  {"1234567":{"msgId":5,"write":{"lamp":{"p1":"ok","p2":"ok","p3":"ok"}}}}
```

- L'identifiant racine (`1234567`) et `msgId` sont de **simples échos** : la station renvoie ce
  qu'on lui donne, `7654321` répond aussi bien. **Il n'y a aucune authentification** — tout le
  réseau local peut lire la station, et écrire dedans. À savoir, pas à exploiter.
- `msgId` est en revanche **obligatoire** : sans lui, la station répond `null`.
- Une clé inconnue est ignorée en silence (`"read":{}`), jamais d'erreur.
- **Les 9 clés tiennent dans une seule requête** : un aller-retour suffit pour tout l'état. L'appli
  du fabricant, elle, ouvre une connexion par écran — inutile de l'imiter sur ce point.
- `write` écrit un bloc entier et accuse `"ok"` par sous-clé ; la valeur persiste.

### Les neuf clés

| Clé | Contenu |
|---|---|
| `status` | `warning`, `defect`, `uvc` (lampe allumée), `mode` |
| `about` | `hw`, `fw`, `mod` (« Proteo V3 »), `sn` |
| `wear` | `prefilt`, `filt1`, `filt2`, `lamp` — pourcentages **restants** |
| `consumption` | `day`, `week`, `month` en litres + `year[12]` par mois |
| `flow` | `inst`, `max`, `avge` en litres par heure |
| `rtc` | `date:[j,m,aaaa]`, `time:[h,min]` |
| `config` | `lang`, `waterQ`, `prefilt`, `waterT` |
| `lamp` | `p1`/`p2`/`p3`, quatre entiers chacun |
| `alert` | `D001`…`D021`, quatre entiers chacun |

## Trois pièges que la capture seule n'aurait pas révélés

### 1. La station n'accepte qu'UNE connexion TCP à la fois

Établi le 2026-09-16 : pendant une session de l'appli mobile, une lecture
indépendante lancée pile dans la fenêtre a été **acceptée puis laissée sans
réponse**, ni données ni erreur. Hors de cette fenêtre, toutes les lectures aboutissent.

Deux conséquences, toutes deux implémentées dans `socket.ts` et `index.ts` :

- **Une connexion courte par sondage** : ouvrir, lire, refermer. Jamais de socket maintenu — il
  monopoliserait la station et **casserait l'application mobile du propriétaire**.
- **Un silence n'est pas une panne** : c'est le plus souvent quelqu'un d'autre qui parle à la
  station. L'appareil ne passe `available: false` (et `health()` en `degraded`) qu'après
  **trois sondages ratés consécutifs**, pas au premier.

Et puisque la station **accepte** la connexion avant de se taire, le timeout composé avec
`ctx.signal` n'est pas une précaution de principe : sans lui le poller se fige en silence.

### 2. Le débit est en litres par heure, par pas de 36

L'unité n'était pas donnée. Mesure au robinet le 2026-09-16 : un mitigeur ouvert à fond fait monter
`flow.inst` à **900**, soit 15 L/min — l'ordre de grandeur exact d'un robinet (en litres par
minute, il aurait fallu croire à 54 m³/h, quand la notice spécifie la station pour 2 m³/h).

Détail qui compte pour l'affichage comme pour la simulation : **toutes les valeurs relevées sont
des multiples de 36** (720, 612, 792, 900, 648, 828, 396, 72). Le débitmètre compte par pas de
36 L/h, donc la mesure est bien plus grossière que ses trois chiffres ne le laissent croire. Une
simulation qui produirait 837 L/h mentirait discrètement.

### 3. `lamp` programme le mode économie, pas l'allumage

`lamp.pN = [heure début, minute début, heure fin, minute fin]`, confirmé en faisant régler un
créneau à 23:45 depuis l'appli : `p1` est passé à `[23,45,7,0]`.

Mais **ce ne sont pas des plages de fonctionnement** — c'est la notice qui tranche, contre la
déduction qu'on faisait à partir des seules trames : « permet de programmer jusqu'à 3 créneaux
quotidiens au cours desquels la lampe se met en **mode économie** ». Et en mode économie, « au bout
d'une heure environ sans tirage d'eau, la lampe s'arrête ». Hors créneau, la lampe est en mode
sécurité, optimal, qui est le réglage par défaut.

C'est cohérent avec l'observation : à 23 h, hors créneau, `status.uvc` vaut 1.

**Leçon générale : la notice du fabricant tranche le SENS des champs là où la capture ne donne que
leur forme.** À consulter avant de supposer.

## Ce qui n'est délibérément pas décodé

- **`alert` (D001…D021)** : la notice ne documente pas ces codes, elle renvoie au SAV. Et le
  premier entier ne signifie pas « active » — D005 et D017 valent 1 alors que `warning` et `defect`
  sont à 0. Le plugin ne publie donc que ces deux résumés-là, dont le sens est sûr. Les deux
  horodatages sont figés entre deux lectures (ce sont des instants d'événements) et ressemblent à
  des secondes depuis une époque non identifiée ; le décodage en champ de bits date/heure ne donne
  rien de cohérent.
- **`consumption.year`** : douze valeurs mensuelles, archivées seulement à la clôture du mois (le
  mois en cours reste à 0 alors que `month` est renseigné). Pas de foyer naturel dans l'état.
- **`status.mode`** : sens non établi. Il ne bascule **pas** à l'entrée du créneau économie
  (vérifié : toujours 1 après plus de cinquante minutes). Laissé hors du contrat plutôt que doté
  d'un sens inventé.

## Le kind partagé `water`

Ajouté pour l'occasion dans `packages/shared/src/devices/kinds.ts` et `state.ts` — un appareil trop
riche pour `sensor`, qui ne porte qu'une seule valeur numérique. Précédents du même genre :
`weather` créé pour Nest, `mower` étoffé pour Automower.

Capacités : `consumables`, `water_flow`, `water_usage`, `uv_lamp`. Elles disent ce que la station
SAIT dire, et varient d'un modèle à l'autre dans la gamme (toutes n'ont pas de lampe UVc) : sans la
capacité, la carte omet la section au lieu d'en afficher une vide. Aucune commande.

**Tous les champs de mesure de `waterStateSchema` sont optionnels**, et c'est délibéré : avant la
première lecture réussie, « absent » se lit « inconnu ». Un `0 %` d'usure ou un `0 L` affirmerait
une mesure qu'on n'a pas — même règle que `cover.position`. D'où un `defaultState` réduit à
`{ kind, ...base }`, comme `camera`.

Ajouter un kind casse exactement sept endroits dans `apps/web` (trois `Record<DeviceKind>` et
quatre `switch` exhaustifs) : la compilation sert de filet, le serveur ne bronche pas.

## Côté web et simulation

`WaterCard.vue` affiche les quatre usures avec une pastille d'état pour la lampe, puis débit et
consommations, puis l'alerte — sections gouvernées par les capacités déclarées, valeurs absentes en
tiret et jamais en zéro, seuil bas sous 20 % en rouge comme pour une batterie. Aucun contrôle :
l'appareil se regarde travailler, comme la météo ou une caméra.

`packages/mock-sim/src/behaviours/water.ts` simule la station (usures en dents de scie sur 150 à
300 jours, débit par salves **quantifié au pas réel de 36 L/h**, consommations cumulées), sans quoi
la carte ne serait atteignable par personne en preview.

## Pistes pour la suite

- **L'écriture**, si elle est un jour souhaitée : le verbe est connu et capturé (régler l'horloge,
  la dureté de l'eau, les créneaux de la lampe). Volontairement non implémentée.
- **L'époque des horodatages d'alerte**, qui se calerait en comparant avec les dates affichées en
  clair sur l'écran de la station.
- **`status.mode`**, à élucider par observation prolongée.
- Le marqueur 3D et le placement de la station dans la maison.

### Mise à jour 2026-09-17 — la station ne termine JAMAIS ses réponses par un saut de ligne

**Le bug le plus instructif de la session.** Branché sur la vraie station, le plugin publiait
l'appareil mais ne le renseignait jamais : chaque lecture expirait au bout des 5 s de
`COMAP_TIMEOUT_MS`, trois échecs de suite faisaient passer `health()` en `degraded` — alors qu'un
client direct, lui, obtenait la réponse instantanément.

`readOnce` attendait `buffer.indexOf('\n')`, repris du patron `google_cast/channel.ts` dont ce
fichier s'inspire. La capture relue **en octets** (`captures/dialogue-app-station.log`) tranche : la
réponse de la station finit par `7d 7d 7d 7d` (`}}}}`) et **rien derrière**, quand la requête, elle,
finit bien par `0d 0a`. Le cadrage est **asymétrique** : la requête est terminée par une fin de
ligne, la réponse ne l'est pas. Rien dans la trame lue en texte ne le montre — il faut regarder les
octets.

**Les tests ne l'avaient pas vu, et c'est le vrai enseignement.** La fabrique de socket injectée par
les tests émettait un `\n` que la vraie station n'envoie jamais : le test validait un comportement
**inexistant**, et donnait toute confiance à un code qui ne pouvait pas marcher. Une fixture
inventée est une hypothèse déguisée en preuve ; seule une trame **capturée** vaut référence (même
leçon que les fixtures Automower, cf. `3_11_husqvarna-automower.md`).

Correctif dans `apps/server/src/plugins/comap/socket.ts` : une réponse est complète quand le buffer
**forme un JSON valide**, avec ou sans `\n`. Le `\n` reste tenté en premier (gratuit, et protège
d'une variante de firmware qui en ajouterait un) ; à défaut on retente le buffer entier, **une fois
par chunk et jamais par octet** ; un JSON encore tronqué (chunk coupé en plein milieu) ne résout
rien et attend la suite au lieu de rendre du partiel.

Trois tests de non-régression dans `socket.test.ts` : la trame réelle **sans** saut de ligne, la
même **avec**, et un JSON coupé en **deux paquets**. Les paquets y sont rejoués un par un, chacun sur
son propre `setImmediate` — des écritures synchrones avant tout abonnement seraient livrées en un
seul évènement `data` et ne testeraient rien. Vérifié que les deux premiers **expiraient** (5 s) avec
l'ancien code, par `git stash` sur le seul `socket.ts`.

Vérification sur le vrai matériel après correctif : `/api/health` rend `comap=ok`, et
`GET /api/devices/comap:station` rend les neuf mesures réelles. Suite serveur à 753/753.

### Mise à jour 2026-09-17 — l'historique de consommation, persisté

La carte disait la consommation du jour, de la semaine et du mois ; elle ne disait pas **quand** on
tire l'eau. D'où un historique tenu par le plugin et servi à la demande, sur le patron exact de
`forecast?` / `journal?` : nouveau hook facultatif `consumption?(externalId)`
(`apps/server/src/core/plugin.ts`), route `GET /api/devices/:id/consumption`
(`apps/server/src/http/routes.ts`), schémas `consumptionPointSchema` / `deviceConsumptionSchema`
(`packages/shared/src/protocol/http.ts`). Détail du contrat et de la route : voir
`../1_architecture/1_3_protocole-rest-ws.md`.

Les décisions, toutes prises contre la tentation de « remplir » le graphique :

- **48 points horaires et 62 journaliers, rien d'autre** (`HOURLY_POINTS_MAX` /
  `DAILY_POINTS_MAX`, `history.ts`). La série journalière sert **la semaine ET le mois** : la même
  série alimente deux échelles, inutile de la stocker deux fois. Une centaine de nombres, quelques
  kilo-octets.
- **Le journalier est une RELECTURE, pas une somme.** `consumption.day` est déjà un cumul absolu
  depuis minuit local, remis à zéro par la station elle-même : la dernière valeur vue un jour donné
  **est** le total de ce jour. Quand le jour change, on cesse simplement de mettre à jour son point
  et on en ouvre un autre — aucune « clôture » explicite. Seules **les heures** demandent un delta,
  parce que `day` ne se remet pas à zéro à chaque heure.
- **Les heures sont datées par le `rtc` de la STATION**, jamais par l'horloge du serveur
  (`readingAt`). C'est la station qui mesure, c'est son horloge qui fait foi.
- **Un trou de plus d'une heure fait JETER le delta** (`MAX_BRIDGE_GAP_MS`). Au-delà, on ne sait plus
  dans quelle heure l'eau a coulé : l'heure de reprise repart de zéro plutôt que d'hériter d'un
  delta qui ne lui appartient peut-être pas. Mieux vaut un trou qu'un faux pic.
- **Un pas non mesuré est ABSENT, jamais à zéro.** Les heures sautées ne figurent pas dans le
  tableau. « Rien mesuré » et « mesuré à 0 L » sont deux choses différentes, et l'affichage les
  distingue (voir `../4_ui/4_1_navigation-et-panneaux.md`).
- **Ce qui survit à un redémarrage** : les points déjà calculés, dans
  `apps/server/.state/comap-consumption.json` (`COMAP_HISTORY_FILE`, écriture atomique par `rename`,
  même patron que `automower/state.ts`). Le **curseur** de delta, lui, ne survit pas : un sondage
  après redémarrage n'a pas de précédent, il pose simplement la référence.

**Les mensuels ne sont PAS persistés** (choix de l'utilisateur, arbitré le 2026-09-17). Ils sont
dérivés à chaque sondage réussi de `consumption.year[12]` + `consumption.month` + `rtc.date`
(`monthlyOf`) : **année civile, indice 0 = janvier** — confirmé deux fois sur la vraie station, la
seconde fois en direct le 2026-09-17 par `GET /api/plugins/comap/raw` (`rtc.date=[17,9,2026]`,
`year[8]=0` pour septembre en cours, `year[0..7]` remplis). Le mois courant est complété depuis
`month`, et **les mois pas encore commencés sont omis** : leur `0` dans `year[]` ne dit pas « rien
consommé », il dit « pas encore eu lieu ».

**Conséquence assumée, écrite noir sur blanc : au 1ᵉʳ janvier, `year[]` repart à zéro et l'année
écoulée disparaît du graphique.** C'est un choix (ne rien stocker de plus), pas un bug. Le jour où
l'on voudra un glissant sur douze mois vrais, il faudra persister les mensuels comme les autres.

Vérification en direct le 2026-09-17 (serveur de dev 8787, rechargement automatique) :
`GET /api/devices/comap:station/consumption` rend un point `daily` (minuit local), un point
`hourly` et **9 points mensuels** (janvier→septembre), le dernier valant
`month` ; horodatages recontrôlés convertis en heure locale (Europe/Paris, GMT+2).
Tests : 783/783 sur 67 fichiers (+30 : `history.test.ts`, `state.test.ts`, `plugin.test.ts`).

Cela referme — sans la contredire — la réserve posée plus haut dans « Ce qui n'est délibérément pas
décodé » (« `consumption.year` : pas de foyer naturel dans l'état ») : `year[]` n'entre toujours
**pas** dans l'état de l'appareil, il est servi par la route d'historique, qui est précisément le
foyer qui manquait.

**Point non tranché** : `consumption.week` est un compteur dont on ignore s'il est **calendaire ou
glissant**. Il est affiché tel quel, sans réinterprétation, à côté de sept barres qui viennent, elles,
de `daily`. À trancher par observation (un lundi matin suffirait).

### Mise à jour 2026-09-17 — configuration (`COMAP_*`)

`COMAP_HOST`, `COMAP_PORT`, `COMAP_POLL_MS` (30 s), `COMAP_TIMEOUT_MS` (5 s) et
`COMAP_HISTORY_FILE` documentées dans `apps/server/.env.example` — détail dans
`../5_setup/5_1_configuration-env.md`. Deux particularités que ce plugin est le seul à avoir :
**aucune authentification** (rien à appairer ni à coller, contrairement à tous les autres
fabricants) et **une seule connexion TCP à la fois**, d'où la connexion courte par sondage et la
tolérance aux silences déjà décrites plus haut.

### Mise à jour 2026-09-17 — une part de l'eau de la maison ne passe pas par la station

Relevé de l'utilisateur, en croisant le compteur du gestionnaire et la station sur **la même
longue période** (plusieurs mois) : la station mesure nettement moins que le compteur.

**Une part importante de l'eau consommée ne traverse pas la station**, et la consommation totale
dépasse la moyenne française du foyer (voir le repère du graphique).

La conséquence pour l'interface est plus importante que le chiffre : **le repère de moyenne affiché
sur le graphique ne compare que l'eau FILTRÉE.** Il peut donc dire « dans les clous » quand la
facture dit l'inverse. Toute lecture de ce graphique comme un indicateur de facture est fausse par
construction.

Fuite permanente **écartée** : compteur immobile au repos. Restent deux pistes, **non tranchées** —
un circuit branché en amont de la station (extérieur, garage, arrosage) et/ou une fuite
intermittente. À reprendre avec l'historique horaire, qui est exactement l'outil qu'il faut pour ça :
une consommation nocturne régulière trancherait.

### Mise à jour 2026-09-17 — ce que le plugin a gagné côté tablette et côté scène

- Une **vue dédiée** `/water` et son entrée de rail : sans elles, l'appareil était publié mais
  **invisible**, donc impossible à placer. Voir `../4_ui/4_1_navigation-et-panneaux.md`.
- Un **marqueur 3D** aux cotes de la notice (caisson 0,59 × 0,17 × 0,59 m), posé dans la
  maison. Voir `../1_architecture/1_5_scene-3d.md`.

La dernière ligne de « Pistes pour la suite » (« le marqueur 3D et le placement de la station ») est
donc close. Les trois autres — l'écriture, l'époque des horodatages d'alerte, `status.mode` — restent
ouvertes.

### Mise à jour 2026-10-06 — le protocole a son propre dépôt

Le protocole de la station, reconstitué par capture (trames, verbes `read` / `write`, clés), est
publié à part par l'utilisateur : [stillgbx/comap-proteo-protocol](https://github.com/stillgbx/comap-proteo-protocol).
C'est la référence du protocole lui-même ; cette page reste celle du plugin (choix de lecture seule,
connexion unique, historique de consommation). La page utilisateur `docs/plugins/comap.md` le cite
aussi, dans son en-tête et dans « Pour aller plus loin ».

### Mise à jour 2026-10-06 — `COMAP_HOST` n'a plus de défaut

Le schéma donnait l'adresse d'une station comme défaut de `COMAP_HOST` ; elle est
retirée (le dépôt n'a pas à porter une adresse du réseau local, et une adresse par défaut ferait
sonder une machine au hasard ailleurs). `COMAP_HOST` est désormais **facultatif dans le schéma** et
exigé par le plugin, comme `TAHOMA_HOST` : absent, `discover()` ne déclare rien, `start()` ne pose
aucun poller, `/raw` répond 409 et `health()` rend `error` « set COMAP_HOST to the station
address ». Un champ simplement obligatoire aurait fait échouer la validation au démarrage du
serveur (`plugin-host.ts`), donc une erreur affichée chez quiconque n'a pas de station, plugin
décoché compris. Une installation existante n'est pas touchée : son `.env` renseigne l'adresse. Test : plugin
sans adresse, rien de déclaré, aucune connexion, pas d'indisponibilité en boucle (contrôle négatif :
sans la garde de `start()`, le poller échoue et marque la station indisponible). `.env.example`
donne une adresse d'exemple, citée aussi dans cette page, les fixtures et
`socket.test.ts`.
