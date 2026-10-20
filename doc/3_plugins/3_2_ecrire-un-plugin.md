# Écrire un plugin

> Dernière mise à jour : 2026-10-20
> Sources : `apps/server/src/core/plugin.ts`, `apps/server/src/core/plugin-host.ts`, `apps/server/src/plugins/{mock,hue,tahoma,_stub}/index.ts`, `apps/server/src/plugins/comap/{socket,socket.test}.ts`, `apps/server/src/plugins/melcloud/{types,mapping}.ts`, `apps/server/src/plugins/irobot/{index,mapping,discovery}.ts`, `apps/server/src/plugins/sonos/{index,discovery,mapping}.ts`, `apps/server/src/core/atomic-file.ts`, `apps/server/src/assistant/engines.ts`

## Interface (`core/plugin.ts`)

```ts
interface DevicePlugin {
  id: string                                  // 'tahoma', 'sonos'… ([a-z0-9_]+)
  configSchema: z.ZodType<Record<string, unknown>>   // SES variables d'environnement (z.object)
  init(ctx: PluginContext): Promise<void>     // clients, joignabilité — config déjà validée/transformée
  discover(): Promise<DeviceDescriptor[]>     // peut être vide (non appairé)
  start(): Promise<void>                      // états initiaux puis abonnement / polling
  execute(externalId: string, command: Command): Promise<void>   // résout à l'accusé du fabricant
  stop(): Promise<void>
  registerRoutes?(app: FastifyInstance): void // monté sous /api/plugins/<id>/
  health?(): PluginHealth                     // ok | degraded | needs_pairing | error | not_implemented
}
```

`PluginContext` : `config` (sortie de `configSchema.parse(process.env)` — **ne pas re-parser**, voir
`6_faq/6_1_pieges-runtime.md`), `logger` (pino enfant), `clock` (injectable), `signal`
(`AbortSignal` annulé par `stop`), `emitState(externalId, patch)` (ajoute `available: true`),
`setAvailable(externalId | '*', bool)`, `emitDevices(descriptors)` (remplacement complet).

Erreurs : lever `PluginError(code)` avec `DEVICE_UNAVAILABLE`, `UNSUPPORTED_COMMAND`,
`UPSTREAM_ERROR`, `RATE_LIMITED`, `NEEDS_PAIRING`, `TIMEOUT`, `NOT_IMPLEMENTED`, `LOW_BATTERY` (batterie trop faible pour la commande : Tesla `low_soc`, pas de
clim sous 20 % ; `PLUGIN_ERROR_CODES`, `apps/server/src/core/plugin.ts`) *(liste mise à jour le 2026-10-06 : `LOW_BATTERY` manquait)* → codes HTTP mappés
(`1_architecture/1_3_protocole-rest-ws.md`).

## Marche à suivre

1. Créer `apps/server/src/plugins/<id>/` avec `index.ts` (cycle de vie), `client.ts` (HTTP, injectable
   `fetchImpl`), `mapping.ts` (**pur** : ressources fabricant ↔ `DeviceDescriptor` / `StatePatch` / corps
   de commande), `types.ts` (schémas zod souples `z.looseObject` des réponses fabricant).
2. Choisir des `externalId` **stables** (UUID fabricant), sans `:` ni espace.
3. Déclarer la fabrique dans `apps/server/src/plugins/index.ts` (remplacer le `makeStubPlugin`).
   *(Constat du lint du 2026-10-06 : la déclaration se fait aujourd'hui en ajoutant la fabrique à `PLUGIN_FACTORIES` dans `apps/server/src/plugins/index.ts` ; `makeStubPlugin` (`plugins/_stub/index.ts`) n'y est plus utilisé, voir `3_3_fabricants-a-venir.md`.)*
4. Documenter les variables dans `apps/server/.env.example`.
5. Polling : `createPoller` (`core/poll.ts`) avec `ctx.clock` et `ctx.signal` ; SSE : `connectSse`
   (`core/sse.ts`) ; débit : `TokenBucket` (`core/rate-limit.ts`).
6. Tests : `mapping.test.ts` sur fixtures capturées (anonymisées) ; `plugin.test.ts` avec un faux
   `PluginContext` (`emitState: vi.fn()`), un `fetchImpl` simulé et `ManualClock` de `@kasbah/mock-sim`.
7. Ajouter un appareil lié dans `house/demo-house.json` si utile à la démo.

## Liste de contrôle

- [ ] Un état émis contient uniquement des clés du kind (`stateKeys`), sinon le registre le rejette.
- [ ] `execute` refuse les commandes d'un autre kind (`UNSUPPORTED_COMMAND`) et résout **après** l'accusé.
- [ ] Aucune valeur secrète dans les logs ni dans `health().detail`.
- [ ] `stop()` annule timers et connexions (utiliser `ctx.signal`).
- [ ] `npm test`, `npm run typecheck`, `npm run lint` verts ; `npx gitnexus analyze` après commit.

### Mise à jour 2026-09-08 — quatre points appris en branchant un vrai fabricant

Tirés du plugin `tahoma` (détail et symptômes dans `3_4_somfy-tahoma.md` et
`../6_faq/6_1_pieges-runtime.md`). À ajouter à la liste de contrôle :

- [ ] **Fixtures capturées, pas déduites de la spec.** Deux bugs ont survécu à 19 tests verts parce
  que les fixtures reproduisaient la documentation du fabricant : un champ documenté que la box
  renvoie **toujours vide**, et un état dont la valeur est un **tableau** là où on attendait un
  scalaire (ce dernier faisait échouer le parse de tout le setup, à cause d'un état qu'on ne lit même
  pas). Anonymiser une vraie réponse, et y laisser les bizarreries.
- [ ] **Schémas larges sur les valeurs qu'on ne lit pas.** `z.looseObject` ne suffit pas : contraindre
  le *type* d'un champ inutile suffit à faire échouer une réponse entière. Préférer `z.unknown()` et
  filtrer au moment de lire.
- [ ] **Valider ressource par ressource** (`safeParse` dans une boucle, comme `hue/client.ts` et
  `tahoma/client.ts`) : un appareil à la forme inattendue ne doit pas priver la maison des autres.
- [ ] **Borner chaque requête.** Le défaut d'undici est de 300 s. `KASBAH_COMMAND_TIMEOUT_MS` ne
  protège que `execute` : une requête coincée dans un poller le gèlerait **indéfiniment**, en
  silence, `health()` restant `ok`. Composer un `AbortSignal.timeout` avec `ctx.signal`
  (`AbortSignal.any`) et rendre le délai injectable pour les tests.

Question à se poser avant d'écrire le mappage : le fabricant envoie-t-il des **états complets** (pont
Hue) ou des **deltas** (Overkiz, parfois une seule clé par trame) ? Dans le second cas, tout champ
calculé à partir de deux états exige d'accumuler un état complet par appareil — un mappage pur sur
le fragment reçu ne peut pas fonctionner.

### Mise à jour 2026-09-11 — `implemented`, `parts` et `ctx.parts`

Le contrat gagne deux champs facultatifs, tous deux **statiques** : les Réglages les affichent alors
que le plugin est éteint, donc sans config ni `init`.

```ts
readonly implemented?: boolean          // false = squelette : listé, interrupteur grisé
readonly parts?: readonly PluginPart[]  // { id, labelKey, enabledByDefault }
```

- `PluginPart.id` est **écrit dans `house.json`** (`plugins.<id>.parts`) : le choisir stable.
- `labelKey` est une clé i18n de l'app web (`kinds.light`…), pas un libellé : le serveur ne connaît
  pas la langue du navigateur.
- Le contexte reçoit `ctx.parts: Record<string, boolean>`, défauts déjà appliqués — un plugin lit
  `ctx.parts[...]`, il ne va jamais chercher la maison. Changer un sous-item **redémarre** le plugin
  (l'hôte s'en charge) : il suffit de lire `ctx.parts` dans `init`.
- Un plugin **sans** `parts` n'a rien à faire : la majorité n'a pas de sous-item.
- À la liste de contrôle : ne pas supposer qu'on démarre. Un plugin est instancié même décoché, et
  ses routes sont montées (c'est par là qu'on l'appaire) ; seul `init`/`start` attend l'activation.


### Mise à jour 2026-09-14 — `PluginHealth.quota` : dire ce qu'on consomme

Un plugin dont l'API est FACTURÉE ou bornée, et qui se rationne, peut publier sa consommation dans
sa santé — l'UI la montre là où elle compte (pour Tesla, au bas de la carte du véhicule) :

```ts
quota?: { used: number; limit: number; labelKey: string; unit?: 'usd'; since?: number }
```

`labelKey` est une **clé i18n de l'app web**, pas un libellé : même convention que `PluginPart.labelKey`,
le serveur ne connaît pas la langue du navigateur (Tesla envoie `vehicle.quotaCredit`). `unit: 'usd'`
dit que `used` et `limit` sont des dollars, à mettre en forme comme une somme — sans lui, ce sont des
décomptes. `since` date le début de la période comptée, pour que l'UI puisse l'écrire. Le serveur ne
formate jamais : il dit quoi, combien, dans quelle unité, depuis quand. Absent = ce plugin ne compte
rien, et l'UI n'affiche rien — c'est le cas de tous les autres aujourd'hui.
*(Constat du lint du 2026-10-06 : Tesla et Automower publient `PluginHealth.quota` (`labelKey` `mower.quotaRequests` pour Automower) ; « tous les autres » ne vaut plus.)*

À retenir : la santé n'est **ni poussée ni sondée** (`GET /api/health` à la demande). Une vue qui
affiche un quota doit donc la redemander elle-même, au rythme qui lui convient.

### Mise à jour 2026-09-16 — `ctx.site`, `forecast?`, et ne pas bloquer `discover`

Trois points appris en écrivant le plugin météo (`3_10_open-meteo.md`) :

- **`ctx.site`** (`{ lat, lon, alt }`) : la position de la maison, fournie par l'hôte comme `parts`.
  Un plugin qui dépend du lieu la lit là, il ne va jamais chercher `house.json`.
- **`forecast?(externalId)`** : méthode optionnelle du contrat pour un appareil `weather`, rendue par
  `GET /api/devices/:id/forecast`. Rendre la **dernière lecture** mise en forme (le type
  `PluginForecast` = `WeatherForecast` sans `deviceId`, que l'hôte ajoute) — jamais un nouvel appel
  au fournisseur depuis la route.
- **Aucun appel réseau dans `discover()`.** Les plugins démarrent **en série**
  (`PluginHost.startAll`) : une API lente ou muette y retarderait tous les suivants.
  *(Dépassé le 2026-10-01 : `startAll` lance désormais tous les `startOne` en parallèle, `Promise.all` dans `apps/server/src/core/plugin-host.ts` — voir `../1_architecture/1_2_serveur-et-plugins.md`. La règle « pas de réseau dans `discover()` » reste valable.)* Déclarer les
  appareils avec leurs capacités présumées, les laisser naître indisponibles, et laisser la première
  lecture du poller (immédiate dans `start`) les remplir ; redéclarer par `emitDevices` si la lecture
  dément une capacité. À ajouter à la liste de contrôle.

Sources : `apps/server/src/core/plugin.ts`, `apps/server/src/plugins/open_meteo/index.ts`.


### Mise à jour 2026-09-16 (soir) — un plugin est une fermeture qui survit à `stop()`

Appris sur Automower (`3_11_husqvarna-automower.md`) : l'hôte redémarre un plugin **sans le
réinstancier** (`stopOne` puis `startOne` sur la même fabrique), et `startOne` vide ses appareils avec
le résultat de `discover()` avant `start`. Tout ce qui, dans la fermeture, sert à décider « ai-je déjà
publié ? » (une liste de descripteurs émis, un cache de comparaison) doit donc se **remettre à zéro
dans `init`** — sinon, après une bascule dans les Réglages, le plugin lit son fabricant, ouvre son flux,
et ses appareils manquent au registre sans qu'aucune erreur ne le dise. Et si `discover()` ne fait
pas de réseau, qu'il **redise ce qu'il sait déjà** plutôt que rien. À ajouter à la liste de contrôle.


### Mise à jour 2026-09-16 (nuit) — deltas : un cas de plus, et la capture qui tranche

La question « états complets ou deltas ? » ci-dessus a une troisième réponse chez Husqvarna
(`3_11_husqvarna-automower.md`) : la LISTE rend des états complets, le FLUX des deltas d'un champ.
La documentation montre des sections entières ; seule la capture des événements (`GET
/api/plugins/automower/raw/events`) l'a révélé, et deux champs se sont effacés sur le vrai serveur
entre-temps. À la liste de contrôle : **capturer le flux d'événements aussi**, pas seulement la liste,
et garder par appareil le dernier état complet dans lequel fondre chaque événement.

### Mise à jour 2026-09-17 — une fixture inventée peut valider ce que le vrai appareil ne fait pas

Le plugin COMAP avait treize tests verts, un cadrage de trames couvert, et ne marchait pas du tout
face à la vraie station : timeout systématique à chaque lecture. La fabrique de socket **injectée
par les tests** émettait un `\n` en fin de réponse ; la vraie station n'en envoie jamais (relevé en
octets dans la capture : `}}}}` et rien derrière, alors que la requête, elle, finit bien par
`0d 0a`). Le test ne validait pas le plugin, il validait **une hypothèse déguisée en preuve**.

À en tirer, pour tout plugin qui parle à un vrai appareil :

- **La fabrique injectée doit rejouer une trame CAPTURÉE, octet pour octet**, pas une trame
  reconstruite de mémoire ou déduite du patron d'un autre plugin. Ici le `\n` venait de
  `google_cast/channel.ts`, copié sans être vérifié.
- **Le cadrage se vérifie en octets**, pas en texte : un `\n` manquant ne se voit pas dans un log
  lisible.
- **Un test de cadrage doit prouver qu'il échouait avant.** La non-régression a été confirmée par
  `git stash` sur le seul fichier corrigé : les deux nouveaux cas expiraient bien à 5 s avec
  l'ancien code. Un test écrit après le correctif et jamais vu rouge ne prouve rien.
- Pour tester des paquets **séparés**, les rejouer chacun sur son propre `setImmediate` : des
  écritures synchrones faites avant tout abonnement arrivent fusionnées en un seul évènement `data`
  et ne testent pas le découpage.

Détail complet du bug : `3_12_comap-proteo.md`.

Au passage, l'interface gagne un troisième hook facultatif servi à la demande, `consumption?`, après
`forecast?` et `journal?` — même règle : **rendre un historique tenu au fil des sondages, jamais
refaire un relevé** (voir `../1_architecture/1_2_serveur-et-plugins.md`).

### Mise à jour 2026-09-17 (bis) — deux leçons du plugin MELCloud

Deux pièges rencontrés en écrivant MELCloud (`3_13_mitsubishi-melcloud.md`), transposables tels
quels à tout plugin qui parle à un fabricant.

**1. En zod 4, `z.unknown()` ne rend PAS une clé facultative.**

Le réflexe appris de TaHoma est de **ne rien contraindre de ce qu'on ne lit pas** : `z.unknown()`
sur chaque champ inutile, pour qu'un type inattendu ne fasse pas échouer la réponse entière. Sauf
que `z.unknown()` reste une clé **requise** : un champ qu'on ne lit même pas, mais que le fabricant
n'envoie pas toujours (`Expiry`, `Device`), fait échouer le `safeParse` de toute la réponse.

Le symptôme est **exactement** celui que cette page attribue aux schémas trop serrés — « une
réponse entière rejetée pour un champ qui ne sert à rien » — et on l'obtient ici **en croyant les
avoir relâchés**, ce qui est la raison de l'écrire noir sur blanc. La règle : `z.unknown()` dit « je
me fiche du type », `.optional()` dit « je me fiche de la présence », et il faut **les deux**
(`z.unknown().optional()`). Voir aussi `../6_faq/6_0_pieges-outillage.md`, entrée zod 4.

**2. Un drapeau d'état du fabricant peut mentir : préférer une preuve mesurable.**

MELCloud publie `Offline`. Relevé sur la vraie machine : `Offline: true` **pendant** que
l'horodatage de remontée avançait chaque minute, que le module Wi-Fi se disait `NORMAL` et qu'aucune
erreur n'était signalée. S'y fier grisait toute la maison au-dessus de données parfaitement
fraîches.

La disponibilité se décide donc sur la **fraîcheur du dernier horodatage** — une grandeur qu'on
mesure, et dont on choisit le seuil en connaissance de la cadence du fabricant (ici 15 minutes pour
une remontée par minute). Le drapeau est gardé, mais **pour le diagnostic seulement**.

Généralisation, et elle rejoint « valeur par défaut lue comme un fait » de
`../6_faq/6_1_pieges-runtime.md` : entre **ce qu'un fabricant coche** et **ce qu'on peut mesurer**,
choisir la mesure. Un booléen `online` / `connected` / `available` d'API tierce est une opinion ;
un horodatage qui avance est un fait. Corollaire de méthode : une capture prise à un instant
« normal » **ne contient pas** le contre-exemple — il n'apparaît qu'en observant la machine en
direct, et il faut penser à en garder la trace quand il passe.

### Mise à jour 2026-09-19 — trois leçons du plugin iRobot

Apprises en branchant un vrai Roomba ([3_14_irobot-roomba](3_14_irobot-roomba.md)), transposables
telles quelles à n'importe quel fabricant.

**1. Un fabricant peut RETIRER une voie d'accès par mise à jour de firmware — et l'annoncer dans ses
propres métadonnées.**

Les Roomba rendaient leur mot de passe local à qui le demandait sur le réseau. Ce n'est plus vrai sur
les firmwares récents : le mécanisme répond encore, mais pour refuser — **115 tentatives sur 5 minutes,
toujours la même réponse de refus**. La documentation communautaire, elle, décrit toujours l'ancienne
méthode ; toutes les bibliothèques tierces aussi.

Ce qui rend cette leçon utilisable plutôt que décourageante : **l'appareil le disait lui-même**. Sa
carte d'identité de découverte porte `cap.pw: 0` — une capacité annoncée à zéro. Avant de conclure à
une panne de réseau, de pare-feu ou de code, **chercher dans ce que l'appareil déclare de lui-même
s'il ne dit pas tout simplement non**. Et écrire un test sur cette déclaration : le jour où un
appareil du parc repasse à `1`, on le saura sans refaire 115 essais.

Corollaire sur les pistes d'API : une piste vieillit aussi **par le bas**. Elle peut être devenue
fausse sans que personne ne l'ait notée, parce qu'elle reste vraie sur les appareils plus anciens.

**2. Une commande peut être ACCEPTÉE et perdue en silence : vérifier l'EFFET, pas l'accusé.**

La liste de contrôle dit depuis longtemps qu'`execute` doit résoudre **après l'accusé du fabricant**.
Ce n'est pas toujours suffisant. Sur le Roomba, un `dock` envoyé pendant le nettoyage est publié sans
erreur, **enregistré par le robot** dans son `lastCommand`… et **ignoré** : il a poursuivi sa mission
deux minutes et demie. Aucun refus, aucun code d'erreur, aucun rejeu. Un plugin qui se fie à l'accusé
rend un bouton qui ment, et la panne est invisible côté serveur.

À en tirer : **l'accusé dit « reçu », jamais « fait »**. Quand un geste échoue silencieusement, la
seule preuve est l'état que l'appareil publie ensuite. Deux conséquences d'écriture :

- une commande du contrat peut valoir une **suite** de verbes du fabricant, pas un seul (ici
  `pause` puis `dock`) — et le verbe peut dépendre de l'**état courant** (`start` pour une nouvelle
  mission, `resume` pour une reprise) ;
- le test qui verrouille ce comportement doit avoir été **vu rouge**, ici en remettant le délai à
  zéro (même exigence que pour le cadrage de trames de COMAP, plus haut).

**3. Un appareil peut annoncer un état avant d'être en mesure de l'honorer : MESURER le délai, et le
borner par `KASBAH_COMMAND_TIMEOUT_MS`.**

Suite du point 2, et c'est la partie qui ne se devine pas : même après un `pause`, un `dock` envoyé
~1 s plus tard est avalé de la même façon. Le robot publie `phase: "stop"` **plus tôt** qu'il
n'accepte le geste suivant. Son ombre dit vrai sur ce qu'il est, pas sur ce qu'il est prêt à faire.

Le délai de grâce a donc été **mesuré, pas choisi** : ~1 s non, 3 s oui, 8 s oui → **3 s retenues**,
la plus petite valeur vérifiée. Et ce nombre n'est pas libre : additionné à l'attente que l'état
bascule (4 s), il fait **7 s**, qui doivent tenir sous **`KASBAH_COMMAND_TIMEOUT_MS`** (10 s par
défaut) — au-delà c'est le serveur qui coupe la commande, et le geste échoue pour de bon. Un délai
« confortable » de 15 s aurait rendu le bouton inutilisable.

Trois règles à réutiliser : **attendre sur l'état publié par l'appareil, pas sur une horloge** (et
ne se donner l'horloge que comme plafond) ; **continuer quand même passé le plafond**, un geste qui
échoue franchement valant mieux qu'un plugin suspendu ; et **écrire chaque constante avec sa
mesure**, faute de quoi le prochain lecteur la « simplifiera » sans savoir ce qu'elle achète.

Sources : `apps/server/src/plugins/irobot/{index,mapping,discovery}.ts`,
`apps/server/src/config/env.ts`.

### Mise à jour 2026-09-19 (soir) — deux leçons du plugin Sonos

**1. Une route documentée peut répondre 200 et ne rien porter.** La doc communautaire Sonos pointe
`GET /status/info` (JSON : `playerId`, modèle). Sur un Port et un Play:3, cette
route est **vide**. L'identité est dans `/status/zp` (XML). Un client qui parse le JSON annoncé
n'obtient ni erreur ni appareil. Chercher ce que l'appareil **sert vraiment**, pas ce que la
première page nomme — et garder la sonde (`tools/sonos-probe.mts`) à côté du plugin.

**2. `0.0.0.0` n'est pas « toutes les cartes » pour du multicast.** Une socket SSDP liée à l'adresse
par défaut partait sur l'APIPA `169.254` de cette machine et restait muette, alors que `GET :1400`
vers l'IP connue répondait. Même famille que `CAST_MDNS_INTERFACE`. Pour Sonos : une socket par
IPv4, ou `SONOS_SSDP_INTERFACE`.

Sources : `apps/server/src/plugins/sonos/{index,discovery,mapping}.ts`, `tools/sonos-probe.mts`.


### Mise à jour 2026-09-21 — cinq leçons du plugin PetKit

Détail complet dans `3_17_petkit.md` ; ce qui se transpose :

1. **Un code d'erreur du fabricant ne dit pas ce que son libellé dit.** « Request is incorrect.
   (code 3) » de PetKit veut dire *en-têtes incomplets*, et « Vous n'avez pas de permission.
   (code 4) » *mauvais type de paramètre*. Chercher l'erreur là où le message l'indique fait
   perdre des heures.
2. **Un message d'erreur qui n'arrive pas à l'écran n'existe pas.** Les routes de plugin doivent
   rendre `{ error: { code, message } }` — l'enveloppe qu'`apiErrorSchema` sait lire. Avec
   `{ error: "<texte>" }` (ce que font encore MELCloud et Renault), l'analyse échoue côté interface
   et l'utilisateur ne voit qu'un « HTTP 502 » muet.
3. **Un accusé de réception peut être un faux positif silencieux.** Une trame Bluetooth mal formée
   est accusée « 1 » par PetKit et ne change rien sur la machine. C'est la RELECTURE de l'état qui
   tranche — la même leçon que le `dock` accepté et ignoré du Roomba, mais en pire : ici l'octet
   fautif venait d'une table publiée par une bibliothèque qui fonctionne.
4. **L'identité d'un appareil n'est pas forcément dans l'inventaire.** Le roster PetKit ne rend ni
   nom ni adresse Bluetooth : ils sont dans le détail. Un plugin qui reconstruit sa liste à chaque
   tour les efface — il faut REPRENDRE ce qu'on a déjà appris.
5. **Une sentinelle négative n'est pas une valeur.** `-1` chez PetKit veut dire « je ne compte pas
   ça » ; le ramener à 0 affiche « 0 mL bus » et « 0 jour de filtre ». Après le `-39` de MELCloud,
   c'est la deuxième fois : se méfier de tout nombre négatif sur une grandeur qui ne peut pas
   l'être.

### Mise a jour 2026-09-21 — lecons Tuya (CREATE)

Reprises dans `3_18_tuya.md` : jamais sonder un DP isole ; attendre l'etat republie pas l'accuse ;
boucle de reconnexion ; `discover` sans reseau quand le broadcast est filtre ; config JSON d'un
bloc (id+cle+IP) ; fixtures captivees (timer a 239, pas 240).

### Mise à jour 2026-10-01 — un fichier d'état s'écrit par `writeFileAtomic`

Un plugin qui garde un fichier (session, jeton, cache, historique) l'écrit par `writeFileAtomic`
(`core/atomic-file.ts`), jamais par un `.tmp` + `rename` recopié. L'enregistrement est presque
toujours lancé sans attendre (`void store.save(…)`). Deux écritures rapprochées d'un même `.tmp`
se marchent dessus : le second `rename` échoue en ENOENT. L'utilitaire les met en file par chemin.
À l'appelant de choisir entre avertir (`try` / `catch` + `logger.warn`) et laisser remonter
l'erreur. Le texte se calcule au moment de l'appel. L'effacement d'une session (`clear()`) passe
par le même utilitaire, sinon une sauvegarde en cours le recouvre. Détail dans
`../1_architecture/1_2_serveur-et-plugins.md`, section 2026-10-01 (3).

### Mise à jour 2026-10-06 — une page utilisateur par plugin dans `docs/plugins/`

Chaque plugin a désormais une page **utilisateur** `docs/plugins/<id>.md` (22 pages, liées depuis le
tableau « Plugins » du `README.md`), distincte de sa page wiki : elle dit ce que le plugin apporte,
comment il se connecte (local / cloud, officiel ou non, compte, où sont gardés les jetons), sa mise
en route pas à pas, ses variables `.env`, ses limites, et renvoie au wiki pour le reste. Modèle :
`docs/plugins/hue.md` (tableau d'en-tête Id / Appareils ou Rôle / Connexion / Compte / Vues).

Conventions retenues à la relecture :

- **Vouvoiement** ou infinitif, jamais de tutoiement.
- Le plugin se coche sous le libellé **qu'affiche** Réglages → Plugins, c'est-à-dire son id
  capitalisé (`plugin.id.replace('_', ' ')`, `text-transform: capitalize` dans
  `apps/web/src/components/settings/PluginSection.vue`) : « Ytmusic », « Open Meteo », « Google
  Cast », pas le nom commercial. L'état s'écrit comme l'i18n : « Appairage requis ».
- Aucune donnée d'installation réelle (IP, identifiants, domaine).

Liste de contrôle d'un nouveau plugin, en plus des points ci-dessus :

- [ ] Écrire `docs/plugins/<id>.md` sur le modèle et l'ajouter au tableau « Plugins » du `README.md`.

### Mise à jour 2026-10-07 — un plugin moteur de l'assistant

Troisième forme de plugin sans appareil, après les sources musicales : un **moteur de l'assistant**
s'inscrit à son `start()` par `registerAssistantEngine({ id, label, run })`
(`apps/server/src/assistant/engines.ts`) et se retire à son `stop()`. `run` reçoit l'instruction, le
compte, le prompt système, l'adresse de `/mcp` et un jeton de course, émet des événements puis UN
dernier mot, et s'arrête sans rien dire quand son `signal` est annulé. Exemple : le plugin Claude
(`3_24_claude.md`) ; contrat complet : `../1_architecture/1_9_assistant.md`. Un plugin pour un autre
CLI (Codex, Gemini, Cursor) suivrait la même forme, avec sa propre carte de compte dans Réglages.

Rappel vérifié à nouveau ce jour-là : **ne pas revalider `ctx.config`** dans `init` (l'hôte la donne
déjà transformée) ; et dans les tests, passer la config telle que l'hôte la donne
(`schema.parse({})`), sinon le défaut ne se voit pas.


### Mise à jour 2026-10-20 — les pages `docs/plugins/` en anglais

Les pages utilisateur sont désormais en anglais (le pourquoi : `../5_setup/5_0_installation-et-scripts.md`,
mise à jour du 2026-10-20). Les conventions du 2026-10-06 ci-dessus valent toujours, transposées :

- titres fixes « What the plugin does », « Connection », « Setup », « Configuration
  (`apps/server/.env`) », « Limitations », « Further reading » ; tableau d'en-tête Id / Devices /
  Connection / Account / Views ; colonnes Variable / Default / Purpose ; légende des captures
  « *Screenshot of the demo (simulation, no real device).* » ;
- l'impératif anglais remplace la question du vouvoiement ;
- l'état s'écrit comme l'i18n anglaise (« Pairing required »), et tout libellé cité vient de
  `apps/web/src/i18n/locales/en.json` ; le plugin se coche toujours sous son id capitalisé (« Ytmusic ») ;
- les liens vers ce wiki portent « (in French) ».

Le point de la liste de contrôle ci-dessus devient : écrire `docs/plugins/<id>.md` **en anglais** sur
le modèle (`docs/plugins/hue.md`) et l'ajouter au tableau « Plugins » du `README.md` **et** de
`README.fr.md`.

Sources : `docs/plugins/*.md`, `.claude/skills/publish/SKILL.md` (§4).
