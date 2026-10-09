# Fabricants à venir (squelettes déclarés)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/index.ts`, `apps/server/src/plugins/_stub/index.ts`, `apps/server/src/plugins/nest/index.ts`, demande initiale de l'utilisateur, `apps/server/src/plugins/enphase/index.ts`, `apps/server/src/plugins/tesla/index.ts`, `apps/server/src/plugins/melcloud/index.ts`, `apps/server/src/plugins/irobot/{index,auth,discovery}.ts`, `apps/server/src/plugins/sonos/index.ts`, `apps/server/test/integration.test.ts`

Il n'y a plus d'id déclaré par `makeStubPlugin` : le dernier (`sonos`) a quitté ce tableau le
2026-09-19, voir `3_15_sonos.md`. Le module `plugins/_stub/` existe encore (fabrique d'un id
inerte) mais `PLUGIN_FACTORIES` n'en instancie plus aucun.

| Id | Fabricant | Kinds | Piste d'API |
|---|---|---|---|
| — | — | — | *(aucun squelette restant)* |

Les lignes retirées de ce tableau au fil des implémentations gardent leur mémoire dans les sections
datées ci-dessous — c'est là, et pas dans le tableau, qu'on lit ce que la piste annonçait et ce
qu'elle valait une fois confrontée au vrai appareil.

La plupart des APIs de fabricant exigent des secrets (OAuth, jeton, mot de passe) qu'un navigateur ne
peut pas porter : c'est la raison d'être du serveur (voir `0_overview/0_0_vision-et-principes.md`).
Marche à suivre pour un prochain fabricant : `3_2_ecrire-un-plugin.md`.

### Mise à jour 2026-09-08 — `tahoma` n'est plus un squelette

`tahoma` a quitté ce tableau : le plugin est implémenté, voir `3_4_somfy-tahoma.md`. La piste qui
figurait ici s'est révélée juste sur l'essentiel (API locale du « Developer mode », jeton local,
certificat non vérifiable, événements par sondage de `fetchEvents`) et fausse sur un point :
l'activation du mode développeur **ne passe pas par un site web**, uniquement par l'appli mobile du
fabricant — et le jeton s'y génère aussi, ce qui évite au serveur de manipuler le mot de passe du
compte Somfy.

Leçon transposable aux autres fabricants de ce tableau : **écrire les fixtures d'après une réponse
capturée, pas d'après la spec**. Deux bugs du premier jet ont survécu à 19 tests unitaires verts
parce que les fixtures reproduisaient ce que la documentation décrit et non ce que la box envoie
(champ documenté mais toujours vide, valeur non scalaire là où on attendait un nombre). Détail dans
`3_4_somfy-tahoma.md`.


### Mise à jour 2026-09-09 — `nest` n'est plus un squelette

`nest` a quitté le tableau : le plugin est implémenté (phase 1 : inventaire des caméras, sonnettes
et écrans à caméra, liaison OAuth), voir `3_5_google-nest.md`. La piste indiquée ici était juste
(Smart Device Management, OAuth Google, projet Device Access payant, Pub/Sub pour les événements)
mais les kinds annoncés (`climate`, `sensor`) ne sont **pas** ceux retenus : l'utilisateur veut les
caméras, d'où un nouveau kind `camera` dans le contrat ; les thermostats que la même API expose sont
ignorés pour l'instant.
*(Dépassé le 2026-09-09 : les thermostats sont publiés en `climate` — voir `3_5_google-nest.md`, « Mise à jour 2026-09-09 — le thermostat, et un sondage lent ».)*

Leçon à retenir pour les suivants : quand l'API est cloud et le compte pas encore lié, on ne peut
PAS capturer avant d'écrire — le plugin expose alors une route de relevé brut
(`GET /api/plugins/nest/devices/raw`) pour remplacer les fixtures dès la première liaison.

### Mise à jour 2026-09-09 — `google_home` n'est plus un squelette (devenu `google_cast`)

Le squelette `google_home` (enceintes Google Home) est remplacé par le plugin **`google_cast`**,
nommé d'après le protocole : il couvre aussi les Chromecast, les Nest Hub, les réveils Lenovo et
les barres de son « Chromecast built-in ». La piste indiquée dans le tableau (protocole
Cast local, mDNS `_googlecast._tcp`) s'est confirmée ; ce que le protocole ne permet pas (lancer un
titre YouTube Music avec le compte) est détaillé dans `3_6_google-cast.md`. Sonos reste le seul
`media_player` du tableau.


### Mise à jour 2026-09-11 — `enphase` n'est plus un squelette

`enphase` a quitté le tableau : le plugin est implémenté, voir `3_7_enphase.md`. La piste indiquée
ici s'est révélée juste sur le principe — « passerelle locale IQ possible (jeton) » — et le plugin ne
passe **jamais** par l'Enlighten API v4 ni par ses quotas : tout se lit en local.

Deux corrections à ce qu'annonçait la ligne. Les kinds retenus ne sont pas `energy` + `ev_charger`
mais `energy` (le site **et** une entrée par batterie IQ) et `sensor` (un par micro-onduleur, une
puissance en watts). Et la **borne n'est pas accessible** : l'IQ EV Charger 2 ne parle qu'au cloud
Enphase, son Modbus local étant verrouillé côté installateur — elle reste donc à faire, par une voie
cloud séparée.
*(Dépassé : la borne a été attaquée par le cloud le 2026-09-20 (capture d'abord), puis se commande depuis le 2026-10-01 — voir `3_7_enphase.md`, « Mise à jour 2026-09-20 » et « Mise à jour 2026-10-01 ».)*

Leçon transposable aux fabricants restants : la note technique du constructeur décrivait bien
l'authentification par jeton, mais **aucun** des cinq pièges du mappage (signe du stockage inversé,
deux productions dont une en retard, `whToday` nul sur un compteur, clé à deux-points, lenteur d'une
route) n'en ressortait. Seule la capture d'une vraie réponse les donne.


### Mise à jour 2026-09-13 — `tesla` n'est plus un squelette

`tesla` a quitté le tableau : le plugin est implémenté en phase 1 (lecture seule, réveil à la
demande), voir `3_8_tesla.md`. *(Dépassé : le plugin n'est plus en lecture seule — limite de charge, préconditionnement et sièges chauffants, lancer/arrêter la charge, mise à jour logicielle OTA ; voir `3_8_tesla.md`, mises à jour des 2026-09-14 à 2026-10-02.)* La piste indiquée ici — « Fleet API (OAuth, enregistrement
d'application, clé de commande signée pour les véhicules récents) » — était juste, avec trois choses
qu'elle ne disait pas :

- l'API est **facturée à l'usage** depuis 2025 (10 $ de crédit mensuel), ce qui fait entrer un budget
  journalier et une politique de sondage dans le plugin lui-même ;
- un **domaine public en HTTPS** est exigé même en lecture seule, pour y servir la clé publique de
  l'application — Kasbah étant sur le LAN, c'est un NAS ou un serveur public qui la porte ;
- le véhicule de référence (MCU2) est **pré-2021** : la « clé de commande signée » ne le
  concerne pas, ses commandes resteront des `POST /command/...` non signés en phase 2. *(La phase 2 est faite : voir `3_8_tesla.md`.)*

Leçon pour les fabricants restants : quand une API est **payante**, la cadence n'est plus un réglage
de confort mais une ligne de coût, et le plugin doit pouvoir dire combien il a dépensé
(`/status`, `health().detail`). `renault` devient l'exemple de squelette des tests d'intégration
(`apps/server/test/integration.test.ts`) à la place de `tesla`.
*(Constat du lint du 2026-10-06 : périmé, `renault` est implémenté ; l'exemple a ensuite passé à `melcloud`, puis `sonos`, puis plus aucun — voir « Mise à jour 2026-09-19 (soir) ».)*


### Mise à jour 2026-09-14 — `renault` n'est plus un squelette

`renault` quitte le tableau : le plugin est implémenté en phase 1 (lecture seule), voir
`3_9_renault.md`. *(Dépassé : le plugin commande aujourd'hui la climatisation, la charge et la cible de charge ; voir `3_9_renault.md`, mises à jour des 2026-09-14 (ter), 2026-09-19 et 2026-10-01.)* La piste indiquée ici — « API Gigya/Kamereon non officielle (login compte MY
Renault) » — était **juste**, avec quatre choses qu'elle ne disait pas :

- il n'existe **aucune** voie officielle : le portail développeur d'Ampere ne sert qu'aux
  applications Android qui tournent DANS la voiture, et les données véhicule sont revendues en B2B
  par un agrégateur ;
- Gigya n'a pas d'OAuth, donc **un mot de passe traverse le serveur** — une première ici, bornée par
  une décision : saisie depuis l'UI, jamais dans `.env`, seul le jeton de session est gardé ;
- Gigya répond **HTTP 200 même quand elle refuse** (`errorCode` dans le corps) : un client qui ne
  regarde que le statut croit toujours avoir réussi ;
- les **clés d'API sont rotées sans préavis** par le fabricant (mai 2026 : panne générale des
  intégrations tierces le même jour), d'où leur présence en configuration avec un défaut.

`melcloud` devient l'exemple de squelette des tests d'intégration
(`apps/server/test/integration.test.ts`) à la place de `renault`.
*(Constat du lint du 2026-10-06 : périmé, `melcloud` est implémenté lui aussi — voir « Mise à jour 2026-09-19 (soir) ».)*

**Leçon pour les fabricants restants** (elle prolonge celles de TaHoma, Nest et Enphase) : la
capture a corrigé **trois** affirmations que la documentation rendait plausibles — la version d'un
endpoint (`cockpit` v1 et non v2, la v2 répondant 200 avec une blague et zéro donnée), le sens d'une
valeur (température intérieure et non extérieure), et la nature d'une autre (`chargingStatus` est un
flottant énuméré, pas un booléen). Capturer AVANT d'écrire le mappage n'est plus une précaution,
c'est la seule méthode qui tienne.

### Mise à jour 2026-09-16 — `automower` n'est plus un squelette

`automower` quitte le tableau : le plugin est implémenté en phase 1 (infos de base, état, position
GPS, trois gestes), voir `3_11_husqvarna-automower.md`. La piste indiquée ici — « Automower Connect
API (OAuth, clé d'application), WebSocket d'événements » — était **juste**, avec trois précisions :

1. **Pas d'OAuth navigateur** pour un foyer : la clé et le secret de l'application suffisent
   (`client_credentials`), le jeton représente le compte qui a créé l'application. Deux clés
   `.env`, aucune carte d'appairage dans les Réglages.
2. Le **WebSocket** n'est pas un confort, c'est ce qui rend le quota tenable : 10 000 requêtes par
   mois et par clé, coupées au-delà. Le REST ne fait que resynchroniser.
   *(Dépassé le 2026-09-16 : le portail du fabricant donne 21 000 requêtes par fenêtre de 7 jours (`WINDOW_REQUESTS`, `WINDOW_MS` dans `apps/server/src/plugins/automower/state.ts`) — voir `3_11_husqvarna-automower.md`, « Contradiction détectée 2026-09-16 ». L'argument du WebSocket demeure.)*
3. Les **horodatages** du fabricant sont en heure locale écrite comme de l'UTC (sauf
   `statusTimestamp`) : un piège que la bibliothèque de référence documente, et que la fixture doit
   reproduire.

*(Dépassé le 2026-09-16 au soir : l'essentiel des fixtures vient désormais d'une capture du vrai compte (quelques événements du flux restent d'après la référence) — voir `3_11_husqvarna-automower.md`, « Mise à jour 2026-09-16 (soir) — la capture du vrai compte ».)*

Fixtures écrites d'après la documentation, faute de clés : la leçon de cette page (capturer avant
d'écrire le mappage) reste à honorer dès que `AUTOMOWER_APP_KEY` est posée.

### Mise à jour 2026-09-17 — `comap` n'est plus un squelette, et sa piste était fausse

Le plugin `comap` est implémenté : il a quitté ce tableau. Sa ligne y disait « API cloud COMAP
(à documenter : jeton) » et un kind `sensor` — **les deux se sont révélés faux**, et c'est la
raison de garder la trace ici plutôt que de la faire disparaître.

La station COMAP Proteo 2 n'a **aucune API cloud** : elle parle un JSON en clair, ligne par
ligne, sur **TCP/23**, sans la moindre authentification, et son application mobile ne fonctionne
que sur le réseau local. Il n'y a donc ni jeton, ni quota, ni renouvellement à prévoir. Elle est
par ailleurs trop riche pour un `sensor`, qui ne porte qu'une seule valeur numérique : un kind
`water` a été créé pour elle.

**La leçon vaut pour les autres lignes de ce tableau** : ces pistes sont des suppositions faites
de loin, pas des faits. Avant d'implémenter, sonder l'appareil — ici, un scan de ports a suffi à
renverser l'hypothèse en une minute.

Voir [3_12_comap-proteo](3_12_comap-proteo.md).

### Mise à jour 2026-09-17 (bis) — `melcloud` n'est plus un squelette

`melcloud` quitte le tableau : le plugin est implémenté en phase 1 (lecture seule), voir
[3_13_mitsubishi-melcloud](3_13_mitsubishi-melcloud.md). Sa ligne disait :

> | `melcloud` | Mitsubishi (PAC) | `climate` | MELCloud, API non officielle (login, polling). |

Elle était **juste sur tout ce qu'elle affirmait** — cloud non officiel, connexion par mot de passe,
sondage, kind `climate` — et **incomplète sur deux points qui ont changé le contrat et l'UI** :

- **« kind `climate` » ne dit pas qu'une machine air-eau se découpe en ZONES.** Un thermostat est un
  appareil ; une pompe à chaleur air-eau en publie **un par zone de chauffage**, et ces zones ne se
  pilotent même pas de la même façon — zone 1 sur l'air de la pièce, zone 2 sur la température de
  l'eau de départ, avec deux couples de champs et deux vocabulaires. D'où deux champs neufs dans le
  contrat (`meta.climate.control`, `meta.climate.deviceClass`,
  cf. `../1_architecture/1_1_contrat-appareils.md`). Symétriquement, **une machine MELCloud n'est
  pas une pompe à chaleur** : plusieurs Zubadan en cascade derrière un régulateur FTC
  n'apparaissent que comme un seul appareil à deux zones.
- **Elle ne dit pas qu'il n'y aurait AUCUNE donnée d'énergie.** Pas « une API pauvre » : l'API sert
  bien un relevé d'énergie, mais l'installation n'a pas de compteur (`HasEnergyConsumedMeter:
  false`), et le relevé revient **vide sur 31 jours de plein hiver**, `CoP` intégralement en `null`.
  Une vue Chauffage sans kWh, et un historique de fonctionnement **construit par le serveur au fil
  de ses sondages**, sont des conséquences directes de ce trou-là.

**Leçon transposable** (elle prolonge celle de COMAP) : une ligne de ce tableau dit par quelle
**porte** entrer, jamais **ce qu'il y a derrière**. Ici la porte était la bonne du premier coup ;
c'est la forme des données qui a coûté deux champs de contrat et une vue.

`sonos` devient l'exemple de squelette des tests d'intégration
(`apps/server/test/integration.test.ts`) à la place de `melcloud` : il faut qu'un id y reste
`not_implemented` pour que le test prouve qu'un squelette coché ne démarre pas.
*(Constat du lint du 2026-10-06 : périmé, `sonos` a été implémenté le soir même — voir « Mise à jour 2026-09-19 (soir) ».)*

### Mise à jour 2026-09-19 — `irobot` n'est plus un squelette, et sa piste était juste par la mauvaise porte

`irobot` quitte le tableau : le plugin est implémenté en phase 1 (contrat `vacuum` existant, pilotage
local), voir [3_14_irobot-roomba](3_14_irobot-roomba.md). Sa ligne disait :

> | `irobot` | iRobot Roomba | `vacuum` | API locale MQTT non officielle (BLID + mot de passe obtenus
> à l'appairage) ou cloud non officiel. |

Elle annonçait **deux voies**, et la vérité est qu'il faut **les deux à la fois**, mais pas comme
elle l'imaginait :

- **« API locale MQTT non officielle » : juste, et c'est bien là que tout se passe.** Le robot
  héberge son propre courtier MQTT en TLS, y pousse son état de lui-même, et une fois relié rien ne
  sort du réseau de la maison. Ni sondage, ni quota, ni cloud — c'est le premier plugin de fabricant
  du projet dans ce cas depuis TaHoma et COMAP.
- **« BLID + mot de passe obtenus à l'appairage » : FAUX sur ce firmware, et c'est tout le sujet.**
  L'appairage local — le datagramme magique après un appui long sur HOME — est précisément ce qui ne
  marche plus. **115 tentatives sur 5 minutes** n'ont rendu qu'un refus, et le robot **l'annonce
  lui-même** dans sa carte d'identité de découverte : **`cap.pw: 0`**.
- **« ou cloud non officiel » : juste, mais ce n'est pas une alternative, c'est le passage
  obligé** — et il ne sert **qu'une fois**, à obtenir le mot de passe local de chaque robot
  (découverte d'endpoints publique → Gigya → `POST /v2/login`). Ensuite le cloud n'est plus jamais
  appelé.

Le BLID, lui, s'obtient toujours **sans identifiants** : la diffusion UDP/5678 le donne, avec
l'adresse du robot. Ce qui manque au réseau seul, c'est le mot de passe.

**Leçon transposable, et elle est neuve dans ce tableau** : jusqu'ici les pistes se trompaient sur la
**forme des données** (MELCloud) ou sur la **porte d'entrée** (COMAP). Ici, la piste était juste **au
moment où elle a été écrite** — et un fabricant a **retiré une voie d'accès par mise à jour de
firmware**. Une ligne de ce tableau vieillit donc aussi par le bas : ce qui marchait chez tout le
monde il y a deux ans peut ne plus exister sur l'appareil qu'on a en main, sans que la documentation
communautaire l'ait noté. Corollaire utile : **l'appareil sait souvent le dire lui-même** — ici
`cap.pw: 0`, une capacité annoncée à zéro. Chercher cette déclaration avant de conclure à une panne.

Conséquence pour la contradiction ci-dessous (qui reste ouverte et **n'a pas été arbitrée**) :
`sonos` est maintenant le **seul** id du tableau qui soit encore un squelette au sens de
`makeStubPlugin` — et c'est aussi lui qui sert d'exemple de squelette aux tests d'intégration.

### Mise à jour 2026-09-19 (soir) — `sonos` n'est plus un squelette

`sonos` quitte le tableau : le plugin est implémenté en phase 1 (inventaire, état, télécommande
`media_player`), voir `3_15_sonos.md`. La piste indiquée ici — « API locale UPnP/SOAP (découverte
SSDP) ou Sonos Control API cloud (OAuth) » — était **juste sur la première porte**, et c'est celle
qui a été retenue :

- **UPnP:1400** : HTTP 200, aucune authentification, sur un Port **et** un Play:3. Volume, muet, transport, position, topologie de groupes se lisent en SOAP.
- **`/status/info`** que la doc communautaire annonce en JSON est **vide** ; l'identité est dans
  `/status/zp` (XML). Une route documentée qui répond 200 sans rien dedans n'est pas une panne.
- **WebSocket `:1443`** : HTTP 400 sans clé d'API — la seconde porte locale n'est pas ouverte.
- **Control API cloud** : non utilisée. Réserve si un firmware ferme le local.

Leçon pour un prochain fabricant (elle prolonge TaHoma / Cast / iRobot) : **sonder le vrai appareil
avant d'écrire le mappage**, et ne pas prendre pour argent comptant le premier chemin que la spec
nomme. Ici le chemin nommé (`/status/info`) était un cul-de-sac ; le chemin qui marche
(`/status/zp` + SOAP) n'était pas celui qu'on aurait branché en premier.

Les tests d'intégration n'ont plus d'exemple de squelette : `sonos` y est `implemented: true`,
éteint par défaut. `PluginSection.test.ts` construit un id factice `unobtanium` pour le cas
« ne se déplie pas ».

### Contradiction détectée 2026-09-17 — le tableau garde cinq squelettes déjà implémentés

Relevé en passant, **non corrigé** : le tableau ci-dessus liste encore `nest`, `google_home`,
`enphase`, `tesla` et `renault`, alors que les sections datées de cette page disent qu'ils l'ont
quitté et que `apps/server/src/plugins/index.ts` les branche sur de vraies fabriques (`google_home`
n'existe même plus sous ce nom : c'est `google_cast`). Seuls `sonos` et `irobot` sont encore des
squelettes au sens de `makeStubPlugin`.

Les retraits ont été faits pour `tahoma`, `automower`, `comap` et `melcloud`, pas pour les cinq
autres. **À arbitrer par l'utilisateur** : soit purger le tableau (les sections datées gardent la
mémoire de chaque ligne), soit ajouter une colonne « état » — mais la page ne peut pas rester à
moitié des deux.

> **Arbitré le 2026-09-19 : le tableau est purgé.** Les cinq lignes (`nest`, `google_home`,
> `enphase`, `tesla`, `renault`) en sont retirées. Le titre de cette page dit « squelettes
> déclarés » : y laisser des plugins implémentés faisait mentir la seule chose qu'elle promet, et
> une colonne « état » aurait dédoublé une information que `/api/health` donne déjà, en vrai et en
> direct. Ce que chaque ligne annonçait, et ce qu'elle valait, reste lisible dans sa section datée.
> `irobot` étant parti le même jour par sa propre section, il ne restait que `sonos` — lui-même
> parti le soir même (`3_15_sonos.md`). **Le tableau est vide.**
