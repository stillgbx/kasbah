# Plugin Philips Hue

> Dernière mise à jour : 2026-11-07
> Sources : `apps/server/src/plugins/hue/{index,client,discovery,mapping,types,entertainment}.ts`, `apps/server/src/core/lightStreamBridge.ts`, `tools/hue-entertainment-probe.mts`, `apps/server/src/core/sse.ts`, tests `mapping.test.ts`, `plugin.test.ts`, `entertainment.test.ts`

## API utilisée

API **locale** du bridge, **CLIP v2** : `GET https://<bridge>/clip/v2/resource/{light,device,room,zone,scene,grouped_light,zigbee_connectivity}`,
`PUT …/resource/{light,grouped_light,scene}/<id>`, flux d'événements `GET /eventstream/clip/v2` (SSE),
en-tête `hue-application-key`.

## TLS

Le bridge présente un certificat signé par l'autorité Signify (CN = id du bridge), inconnu du
système. Le client utilise **`fetch` et `Agent` du paquet `undici`** avec
`connect: { rejectUnauthorized: false }` (jamais de désactivation globale), option `HUE_TLS_INSECURE`
(défaut `true`). L'épinglage de l'AC Signify est une suite possible.

## Découverte et appairage

- Sans `HUE_BRIDGE_HOST`, `discovery.ts` interroge `https://discovery.meethue.com/` (limité ~1 appel /
  15 min par IP) et journalise l'IP trouvée en recommandant de l'épingler.
- Sans `HUE_APP_KEY`, le plugin démarre en **`needs_pairing`** (0 appareil) et expose
  `POST /api/plugins/hue/pair` : `POST https://<bridge>/api { devicetype: "kasbah#server", generateclientkey: true }`.
  Erreur 101 → 409 `LINK_BUTTON_NOT_PRESSED` ; succès → la clé est **adoptée en mémoire** (redécouverte +
  flux) et renvoyée avec l'indication de la coller dans `.env`. Le serveur **n'écrit jamais `.env`**.
- L'app web montre la carte d'appairage dans Réglages uniquement en `needs_pairing`.

## Mappage (`mapping.ts`, pur)

- `toDescriptor` : capacités inférées des sections (`dimming` → `brightness`, `color_temperature` →
  `color_temp`, `color` → `color`), `meta.colorTempMirek` depuis `mirek_schema`, pièce Hue en `meta.room`.
- `toGroupDescriptor` (`HUE_EXPOSE_ROOMS=true`) : `grouped_light` d'une pièce → lampe de groupe (`meta.isGroup`).
- `toLightPatch` : fonctionne sur une ressource complète **ou** un fragment d'événement ; ignore
  `mirek` si `mirek_valid: false`.
- `toPutBody` : brightness 0 → `on: false` ; clamp au `min_dim_level` et à la plage mirek ; `color`
  et `color_temperature` étant incompatibles dans un même PUT, **`color` prime** (avertissement).
- `connectivityToAvailability` : `zigbee_connectivity.status === 'connected'` par lampe du device.

## Flux d'événements

`core/sse.ts` parse les trames (`id:`, `data:` multi-lignes, coupures de chunk) et reconnecte avec
backoff (1 s → 30 s, remis à zéro après 30 s de stabilité). À chaque **re**connexion, le plugin
resynchronise tout (événements manqués). `add`/`delete` de lampe/device/pièce → redécouverte
différée 1,5 s. Flux hors service deux fois de suite → tous les appareils `available: false`.

## Limitation de débit

Seaux à jetons : 10 PUT/s sur `light`, 1/s sur `grouped_light`. Une commande en attente pour la
**même** ressource est **supplantée** par la suivante (un glissement de curseur n'envoie que la
dernière valeur), et la promesse supplantée est résolue.

## Tests

Fixtures anonymisées (`__fixtures__/bridge.ts` : 3 lampes, devices, pièce, groupe, connectivité,
trame SSE brute, réponses d'appairage). `mapping.test.ts` : inférence des capacités, patchs,
corps PUT, disponibilité. `plugin.test.ts` : découverte + états + événements SSE + PUT avec
en-tête, appairage 409 puis 200 via `app.inject`, supplantation sous limitation de débit.

## État réel

Le plugin est validé sur un bridge réel : découverte automatique via `discovery.meethue.com`, puis
appairage par bouton (`POST /api/plugins/hue/pair`), et les lampes du bridge remontent.
L'adresse du bridge (`HUE_BRIDGE_HOST`) et la clé applicative (`HUE_APP_KEY`) vivent dans
`apps/server/.env`, ignoré par git : ce sont des données d'installation, elles n'ont pas leur place
dans le wiki.

### Mise à jour 2026-09-05 — `meta.room` sert au placement

`descriptor.meta.room` (la pièce Hue, posée par `toDescriptor`) n'est plus seulement informatif :
c'est la clé de l'**auto-placement** des lampes non déclarées dans le JSON de la maison
(cf. `../2_maison/2_0_format-house-json.md`). Nommer une pièce de la maison comme la pièce Hue
suffit à faire apparaître ses lampes dans la scène 3D, sans écrire une seule position dans le JSON.
Une lampe dont la pièce Hue n'a pas d'équivalent reste pilotable depuis la vue Lumières, signalée
« non placée », mais n'a pas de marqueur 3D.

### Mise à jour 2026-09-08 — scènes et effets

**Ressources ajoutées** : `GET /clip/v2/resource/scene` et `.../zone` (une zone a la même forme
qu'une `room`, `hueRoomSchema` est réutilisé). Elles sont lues dans le même `Promise.all` que les
lampes, donc à chaque `fetchAll` : découverte, démarrage et resynchronisation.

**Anatomie d'une scène** (`hueSceneSchema`) : `actions[]` porte les valeurs fixes lampe par lampe,
`palette.color[]` les couleurs que le pont fait défiler, `group` pointe une `room` **ou** une `zone`,
`status.active` vaut `inactive | static | dynamic_palette`.

- `dynamic` = `palette.color.length >= 2` (une palette d'une couleur n'a rien à animer).
  `auto_dynamic` du pont est remonté tel quel en `autoDynamic` : c'est la case « démarrer
  l'animation automatiquement » de l'app Hue, et elle varie réellement d'une scène à l'autre sur un
  pont installé (deux scènes du même nom dans deux pièces peuvent différer). Kasbah la lit pour
  décider ce que joue un appui sur la pastille, et l'**écrit** aussi :
  `PUT scene/<id> { auto_dynamic }` (vérifié sur le pont : 200, valeur persistée, et le pont
  **rediffuse le changement dans son flux** ~66 ms plus tard, donc les autres apps et écrans le
  voient). Un fragment d'événement `{ type: 'scene', auto_dynamic }` met donc à jour le descripteur
  local et republie les scènes, d'où que vienne la modification.
- **Deux files de débit sur la même ressource** : le seau `scene` est à 1 PUT/s et la file
  supplante l'écriture en attente — légitime pour deux rappels successifs, faux pour un rappel et un
  réglage, qui sont deux intentions différentes. `putLimited(type, id, body, intent)` ajoute donc
  l'intention à la clé de file (`scene/<id>#set` vs `#settings`) : les deux partent, aucune n'écrase
  l'autre.
- `sceneSwatches` : palette animée d'abord (c'est ce qu'on voit tourner), sinon les valeurs des
  `actions` (fidèles lampe par lampe pour une scène fixe), sinon la palette de blancs. Conversion par
  `xyToRgb` / `mirekToRgb` / `rgbToHex` (`packages/shared/src/devices/color.ts`), **doublons ôtés** :
  trois lampes au même blanc doivent donner UNE pastille, et plafond à 6.
- Rappel : `PUT scene/<id> { recall: { action, dimming?, duration? } }` avec `static` → **`static`**
  et `dynamic` → `dynamic_palette`. **Ne pas utiliser `active`** : il applique la scène *et* démarre
  l'animation quand elle porte `auto_dynamic` (la moitié des scènes livrées par Philips), ce qui rend
  les deux modes de Kasbah indistinguables. Vérifié sur le pont : `static` sur une scène
  `auto_dynamic` renvoie bien `status.active: static`.
- `mode: 'off'` : le pont n'a pas de « désactiver la scène ». Un seul PUT sur le `grouped_light` du
  groupe — son rid vient de `room.services` / `zone.services`, déjà chargés, donc sans requête de
  plus, et il couvre aussi les lampes que la scène ne liste pas. Repli lampe par lampe
  (`sceneTargetLights`) si le groupe n'a pas de `grouped_light`. Le pont recalcule alors
  `status.active: inactive` de lui-même.
- Le seau à jetons du client gagne `scene` à **1 PUT/s** (mêmes limites que `grouped_light`) ; la
  supplantation d'une commande en attente vaut aussi pour les scènes.
- Flux SSE : un fragment `{ type: 'scene', status: { active } }` met l'activation à jour en temps réel
  — donc un rappel depuis l'app Hue ou un interrupteur mural s'affiche dans Kasbah. Le fragment n'est
  pris en compte **que s'il porte `status`** (un simple renommage de scène ne doit pas l'éteindre).
  `add`/`delete` de `scene` ou `zone` déclenche la resynchronisation différée de 1,5 s.

**Effets de lampe** : `light.effects.effect_values` (ou `effects_v2.status.effect_values` sur les
firmwares récents) donne la liste, `effects.status` l'effet courant, `PUT { effects: { effect } }`
l'applique. Précédence dans `toPutBody` : **effet > couleur > température**, avec avertissement — un
effet en cours pilote lui-même la couleur, lui en imposer une dans le même PUT n'a pas de sens.
`no_effect` est l'exception : il arrête l'effet, la couleur du même appel reste légitime.

### Constats sur le pont réel (2026-09-08, `apiversion` 1.78.0)

- Le pont expose des scènes de **pièce** et de **zone**, fixes et à palette animée, et une majorité
  de lampes acceptent des effets (`candle`, `fire`, `prism`, `sparkle`, `opal`, `glisten`,
  `underwater`, `cosmos`, `sunbeam`, `enchant`). Rappel dynamique vérifié de bout en bout : le pont a
  renvoyé `status.active: dynamic_palette` par le flux, et les lampes de la pièce se sont allumées sur
  des couleurs différentes de la palette.
- **Le pont n'émet PAS les couleurs intermédiaires d'une scène dynamique.** Nos états de lampes
  restent figés sur la première couleur pendant que l'animation tourne : seul `status.active` dit
  qu'elle joue. Conséquence pour la suite : une teinte animée dans la scène 3D devra être **jouée
  côté client** depuis `swatches`, pas attendue du pont.
- **Les vignettes officielles ne sont pas récupérables** : `metadata.image` est un `rid` vers le
  catalogue Signify, et le pont répond **404** sur `/clip/v2/resource/public_image/<rid>` (testé).
  D'où les pastilles calculées depuis la palette.
- **Le sync divertissement** (boîtier HDMI, sync musique) ne passe pas par CLIP v2 : il demande l'API
  entertainment en DTLS (la clé cliente est déjà demandée à l'appairage, `generateclientkey: true`).
  Hors périmètre de cette itération. Fait le 2026-11-05 pour la synchro musique : voir la mise à jour
  « flux Entertainment » en fin de page.
- `smart_scene` (scènes qui suivent l'heure) : aucune sur ce pont, non implémenté côté Kasbah.

**Tests** : fixtures `__fixtures__/bridge.ts` complétées (une zone, deux scènes — une fixe sur la
pièce, une à palette animée sur la zone —, effets sur la lampe `l-plain`, troisième événement SSE
d'activation). `mapping.test.ts` : pastilles, `dynamic`, activation, corps de rappel, précédence de
l'effet. `plugin.test.ts` : scènes publiées avec leur groupe, activation suivie par le flux, PUT de
rappel, scène inconnue → `DEVICE_UNAVAILABLE`.

### Mise à jour 2026-09-08 — créer une ambiance pour une pièce

`POST /clip/v2/resource/scene` (réponse **201**, `{ data: [{ rid }] }`), corps construit par
`toCreateSceneBody` :

- `group` = la pièce **ou** la zone dont le nom correspond (`roomKey`) ; ses lampes viennent des
  `children` — `device` pour une pièce (puis ses services `light`), `light` directement pour une zone.
- `actions` : celles de la source distribuées sur les lampes de la pièce, en boucle si elle en a
  plus. Chaque lampe reçoit ce qu'elle sait faire : couleur si elle en est capable, sinon la
  température (bornée à sa plage), sinon juste allumage et intensité.
- `palette` recopiée telle quelle **sauf** les listes d'effets, cf. le piège ci-dessous. C'est elle
  qui porte l'animation, et elle est indépendante du groupe : une ambiance animée recopiée reste
  animée.
- Le pont émet un `add` : la resynchronisation différée republie les scènes, et le seeder applique
  le défaut du plugin à cette ambiance qui vient d'apparaître (`autoDynamic`).

**Piège vérifié — `effects` et `effects_v2` sont mutuellement exclusifs, MÊME VIDES.** Une lecture de
scène renvoie les deux listes (vides sur un pont 1.78), et les réoffrir telles quelles au POST donne
un **400 « Both effects and effects_v2 palettes are mutually exclusive »**. `toCreatePalette` ne
garde donc que la liste non vide, et aucune si les deux le sont.

**Pas de galerie côté pont** : `scene_template`, `scene_gallery`, `gallery`, `template`,
`scene_catalog`, `preset`, `public_image` → 404. Les préréglages (noms, palettes, vignettes) vivent
dans l'app Signify. D'où le choix de recopier l'existant plutôt que d'inventer des palettes.

**Suppression** : `DELETE /clip/v2/resource/scene/<id>` (200), exposé dans l'UI (Réglages) après
confirmation en deux appuis. Le pont émet un `delete` : la resynchronisation différée republie les
scènes. Écrit plus tôt le même jour dans cette page — « Kasbah ne supprime aucune ambiance » — puis
demandé par l'utilisateur et implémenté : la liste des Réglages est devenue l'écran de gestion des
ambiances (réglage du démarrage animé + suppression), et non plus seulement une liste de réglages.

### Mise à jour 2026-10-24 — certificat du pont épinglé au premier contact

Constat F32 d'un audit de sécurité : avec `HUE_TLS_INSECURE=true` (défaut), aucune vérification du
certificat, et la clé `hue-application-key` partait vers quiconque prenait l'adresse du pont. Désormais
`true` veut dire « pas de vérification par une AC, mais certificat épinglé au premier contact »
(`.state/hue-tls-pin.json`) : un certificat différent coupe la connexion avant l'envoi de la clé, santé
`error` (« Le certificat du pont Hue a changé… »). `POST /pair` efface l'épingle (au début de
l'appairage, pas après sa réussite) et la connexion suivante réapprend. La vérification par l'AC Signify
a été écartée pour rester simple. Mécanisme commun : `apps/server/src/core/tls-pin.ts` (empreinte SHA-256 apprise au premier contact, contrôle sur le socket établi avant toute écriture ; reprise de session TLS coupée, car une session TLS 1.3 reprise n'expose pas de certificat ; un certificat absent est refusé). Rien n'a encore été essayé sur le vrai matériel : au premier démarrage, le journal doit montrer `device certificate pinned`. Une mise à jour de firmware qui change le certificat met le plugin en erreur jusqu'au ré-appairage : c'est voulu.

### Mise à jour 2026-11-05 — flux Entertainment (lumières en rythme avec la musique)

Première brique de la synchro musique / lumières (orchestration côté lecteur :
[1_6 Lecteur musique commun](../1_architecture/1_6_lecteur-musique.md), mise à jour du même jour).

**Clé cliente gardée à l'appairage.** `client.ts : pair()` demandait déjà `generateclientkey: true`,
mais `index.ts` jetait la `clientkey`. Désormais `POST /pair` la rend (`clientKey`) et la carte
d'appairage des Réglages dit de recopier `HUE_APP_KEY` **et** `HUE_CLIENT_KEY` dans `.env` (nouvelle
variable, 32 caractères hexadécimaux, `.env.example`). Un appairage antérieur n'a pas gardé sa clé
cliente : il faut **réappairer** (bouton du pont), ce qui crée aussi une nouvelle clé d'application.

**Le flux** (`entertainment.ts`) :
- CLIP v2 ne fait que démarrer et arrêter la zone (`PUT /clip/v2/resource/entertainment_configuration/<id>`
  `{ action: "start" | "stop" }`, `client.ts : entertainmentAction`) ; les trames passent en **DTLS
  sur UDP 2100**, identité PSK = clé d'application, PSK = clé cliente décodée de l'hexadécimal, suite
  `TLS_PSK_WITH_AES_128_GCM_SHA256`, par la dépendance `node-dtls-client` (Node n'a pas de DTLS).
- Trame `HueStream` v2 (`encodeFrame`, testée octet par octet) : en-tête de 16 octets (version 2.0,
  séquence, espace RGB), UUID de la zone en 36 caractères ASCII, puis 7 octets par canal (id + R, G, B
  sur 16 bits gros-boutiste), 20 canaux au plus.
- Le pont coupe un flux muet depuis 10 s : la dernière trame est renvoyée après 1 s de silence. Un
  `close` ou une erreur du socket arrête la zone et prévient l'appelant (`onEnded`).
- **Une seule zone à la fois par pont** : ouvrir un flux ferme celui en cours.
- Choix de la zone d'une pièce (`pickArea`) : **toutes** ses lampes sont dans la pièce (une lampe
  voisine clignoterait au mauvais endroit), puis celle qui couvre le plus de lampes de la pièce, puis
  le plus de canaux. Les lampes de la pièce viennent de la maison (`app.ts`), pas d'un nom Hue.
- Les zones sont lues avec le reste dans `fetchAll` (lecture facultative : un échec ne fait pas tomber
  les lampes) et relues sur `add` / `delete` d'une `entertainment_configuration` du flux SSE.
- Le plugin s'inscrit au démarrage dans `core/lightStreamBridge.ts` (même patron que
  `playbackBridge.ts`) si la clé cliente est là, et s'en retire à l'arrêt.

**Vérifié sur le vrai pont (2026-11-05)**, avec la sonde `tools/hue-entertainment-probe.mts`
(`pair` attend le bouton jusqu'à 10 min et range les clés dans `.state/`, `list`, `stream <zone>`) :
poignée de main DTLS en 159 ms, alternance rouge / bleu vue sur la lampe, 37 trames/s envoyées depuis
le poste Windows (les minuteries y étirent les 20 ms prévus ; le pont n'en relaie que 25/s aux lampes).
**Après `stop`, le pont remet seul les lampes dans leur état d'avant** (allumage, luminosité, couleur) :
aucun instantané à prendre côté Kasbah.

Piège : une **zone** Hue ordinaire (regroupement pour les scènes) n'est pas une **zone de
divertissement** ; seule la seconde se diffuse. Elle se crée dans l'appli Hue (Paramètres → Zones de
divertissement), et l'API CLIP v2 permet aussi d'en créer une (non utilisé).

### Mise à jour 2026-11-05 (nuit) — un flux que le pont arrête sans le dire

Constat de l'utilisateur : « parfois ça s'arrête de fonctionner […] ensuite plus possible de remettre la
sync en marche » (logs non relevés : correctif à l'aveugle, sur les angles morts trouvés à la lecture).
- **Le flux UDP ne dit jamais qu'il est mort** : si le pont abandonne la session (coupure réseau de plus de
  10 s, appli Hue, autre diffuseur), `node-dtls-client` n'émet rien, Kasbah envoie dans le vide et la
  synchro se croit active. Le pont, lui, publie sur le flux SSE une mise à jour
  `entertainment_configuration` `status: "inactive"` : `handleEvents` la suit désormais et termine le flux
  de la zone en cours (`HueLightStream.abort`, `onEnded` → la synchro rouvre 10 s plus tard). L'événement
  est ignoré pendant les 2 s qui suivent une ouverture : celui de la fermeture du flux qu'elle remplace
  peut encore arriver.
- `node-dtls-client` **lève une exception** sur `send()` d'un socket qu'il a fermé lui-même (alerte fatale,
  erreur UDP) : l'envoi est protégé et termine le flux au lieu de jeter depuis un minuteur.

Tests : `plugin.test.ts` (événement du pont, délai de grâce), `entertainment.test.ts` (envoi qui lève).

### Mise à jour 2026-11-05 (nuit, suite) — la fin de zone se juge à l'ordre des événements, pas à un délai

Constat de l'utilisateur, capture à l'appui : activer, couper puis réactiver la synchro affichait « Flux
coupé par le pont Hue ». Le délai de grâce de 2 s de la mise à jour précédente était un pari sur la
latence du pont. Mesuré sur le vrai pont (sonde ponctuelle qui lit le flux SSE pendant des
ouvertures / fermetures) : les événements `entertainment_configuration` arrivent **dans l'ordre mais en
retard et groupés** — un `active` reçu 700 ms après que le flux était déjà ouvert, et pendant la poignée
de main DTLS lors de la première ouverture. Un `inactive` du flux qu'on vient de fermer, livré plus de
2 s en retard, coupait donc le flux rouvert.

Désormais : `streamArea` est posé **dès le début de l'ouverture** (la confirmation peut arriver pendant
la poignée de main), et un `inactive` ne compte qu'une fois que le pont a confirmé ce flux par un
`active` (`activeConfirmed`) — le `inactive` de l'ancien flux, si tard qu'il arrive, précède toujours le
`active` du nouveau.

Vérifié sur le vrai pont : activer / couper / réactiver avec la vraie synchro (musique simulée), flux
rouvert sans incident ; arrêt de la zone depuis l'extérieur (comme le ferait l'appli Hue) : événement
reçu en 250 ms, le pont ferme aussi la session DTLS (`close_notify`), la synchro rouvre 10 s plus tard.
Tests `plugin.test.ts` : fin confirmée, confirmation pendant la poignée de main, arrêt tardif ignoré.

### Mise à jour 2026-11-06 — une poignée de main DTLS qui expire : ce que dit maintenant l'échec

Constat sur la vraie maison : la synchro de « Ce navigateur » ([1_6](../1_architecture/1_6_lecteur-musique.md),
mise à jour du même jour) démarre bien la zone par CLIP v2, puis `The DTLS handshake timed out` à chaque
essai. Ce qui a été écarté, mesuré le jour même :
- **la zone et le pont** : la sonde `tools/hue-entertainment-probe.mts stream`, lancée depuis le poste de
  développement puis depuis le serveur avec les clés de son `.env`, se connecte en 22 à 41 ms ;
- **le code du plugin** : `openStream` + `defaultDtlsConnect`, appelés hors du serveur (script jetable),
  se connectent en ~0,5 s ;
- **une clé cliente fausse** : le pont ne se tait pas, il répond par une alerte fatale
  `bad_record_mac` en 0,8 s. Une **expiration** ne vient donc pas d'une paire de clés mal assortie.

Au même moment, le serveur ne joignait plus une bonne partie du réseau local (passerelle solaire,
filtration, une porte de garage, l'aspirateur, la plupart des enceintes), alors que le pont (HTTPS) et
la box des volets répondaient. **Cause non trouvée** : réseau du serveur, ou processus trop occupé pour lire les
réponses avant son propre délai (sur un minuteur en retard, Node traite les minuteurs avant les
entrées-sorties : le délai de 3 s de `node-dtls-client` expire alors même si la réponse attend).

Pour trancher au prochain échec, `openStream` (`entertainment.ts`) compte les datagrammes reçus du pont
sur le socket UDP sous-jacent de `node-dtls-client` (`socket.udp`) et échantillonne le retard des
minuteurs toutes les 100 ms pendant la poignée de main ; le message d'erreur (journal
`Hue: DTLS handshake failed` et détail affiché dans le panneau des lumières en rythme) devient par ex.
`DTLS handshake timed out (0 packet(s) from the bridge, timers up to 40 ms late)`. 0 paquet et peu de
retard : le réseau ; un retard d'une seconde ou plus : le processus. Test `entertainment.test.ts`
(horloge qui saute, comme un processus bloqué).

Rappel des deux clés : `HUE_APP_KEY` (le `username` de l'appairage) authentifie les appels HTTPS et sert
d'**identité** PSK en DTLS ; `HUE_CLIENT_KEY` (rendue au même appairage, `generateclientkey`) est la
**clé secrète** PSK du flux. Chaque appairage crée une nouvelle paire ; les deux doivent venir du même.

### Mise à jour 2026-11-06 (soir) — un paquet perdu, et le pont devient sourd : la zone relancée entre deux essais

Avec le message enrichi, l'échec du serveur s'est lu `1 packet(s) from the bridge, timers up to 16 ms late` :
processus pas en cause, première réponse du pont reçue puis plus rien. Constat de l'utilisateur : couper
puis rallumer la synchro redonnait la même erreur. Mesuré le jour même sur le vrai pont, par le code du
plugin (scripts jetables) :
- `node-dtls-client` **ne retransmet jamais** un vol perdu (`TODO: implement retransmission` dans sa
  source) : un paquet perdu = une poignée de main morte, jusqu'à son délai.
- Une poignée de main **coupée après la deuxième réponse du pont** (simulée en fermant le socket UDP) le
  rend **sourd à toute nouvelle poignée de main pendant 2 à 3 s** (0 paquet en retour). Coupée après la
  première réponse seulement : sans effet.
- **Arrêter puis redémarrer la zone par CLIP le débloque aussitôt** (poignée de main en 242 ms, 19 ms après
  la coupure).
- Fermer puis rouvrir un flux sain, aussitôt et trois fois de suite, marche (clés du serveur comprises) :
  la fermeture de Kasbah (`close_notify` puis `stop`) n'était pas en cause.

`openStream` (`entertainment.ts`) : délai d'une tentative ramené à 1,5 s, **3 tentatives** ; entre deux,
la zone est arrêtée puis redémarrée. Seule une expiration est réessayée (une alerte, clé fausse, serait
rendue de la même façon). Le message d'échec dit le nombre de tentatives. Vérifié sur le vrai pont : pont
volontairement rendu sourd, flux ouvert en 2,3 s au lieu de l'échec. Tests `entertainment.test.ts`
(trois essais puis abandon, réussite au deuxième, pas de nouvel essai sur une alerte).

**Reste** : la cause des pertes, le réseau du serveur (même moment que les autres appareils injoignables).

### Mise à jour 2026-11-06 (nuit) — une zone qui déborde sur la pièce voisine est acceptée

Constat de l'utilisateur : des pièces manquaient au choix de « Ce navigateur ». Lecture des zones sur
le pont : deux zones contiennent chacune une lampe d'une pièce voisine (pièces ouvertes l'une sur
l'autre). La règle « **toutes** ses lampes dans la pièce »
(plus haut) les écartait.

Depuis cette date, `pickArea` (`entertainment.ts`) accepte une zone dont **au moins la moitié** des
lampes sont dans la pièce : la lampe d'à côté suit alors la musique elle aussi (choix de l'utilisateur,
plutôt que de redécouper la zone dans l'appli Hue). Une zone surtout ailleurs reste écartée. Ordre de
préférence : aucune lampe hors de la pièce (une pièce qui avait déjà sa zone la garde), puis le plus de
lampes de la pièce, le moins de lampes dehors, le plus de canaux. Tests `entertainment.test.ts` (zone
moitié dedans prise, zone surtout dehors refusée, zone propre préférée, départage). La page
`docs/plugins/hue.md` dit la même règle. **Pas encore vérifié** sur le vrai serveur.

### Mise à jour 2026-11-07 — garder et rendre l'état des lampes de la zone

Pour la synchro musique ([1_6 Lecteur musique commun](../1_architecture/1_6_lecteur-musique.md), mise à
jour du même jour), le `LightStreamer` du plugin (`index.ts`) gagne trois gestes :
- `saveLights(zone)` : **relit** `GET /clip/v2/resource/light` (l'index de `fetchAll` n'est pas tenu à
  jour par les événements SSE) et garde, pour chaque lampe de la zone (`areaLights`), le PUT qui la
  ramène (`restoreBody`, `entertainment.ts`) : allumage, luminosité, puis température (`mirek` si
  `mirek_valid`) ou couleur `xy`, avec une transition de 1 s (`dynamics.duration`).
- `restoreLights(instantané)` : ces PUT, par la file limitée `putLimited`.
- `switchOff(zone)` : `on: false` sur chaque lampe de la zone.

Limite : une lampe **éteinte** avant la synchro n'est que rééteinte. Le pont ne garantit pas qu'il
prenne une couleur ou une luminosité pour une lampe éteinte, donc rien n'est envoyé d'autre ; elle peut
se rallumer plus tard dans la dernière couleur du flux.

Vérifié : `entertainment.test.ts` (`restoreBody` : couleur, blanc, lampe éteinte) et `plugin.test.ts`
(seule la lampe de la zone, relue au pont, rendue telle quelle ; extinction).

### Contradiction détectée 2026-11-07 — ce que fait le pont à l'arrêt du flux

- **Version du 2026-11-05** (section « flux Entertainment » ci-dessus, sonde
  `tools/hue-entertainment-probe.mts` sur le vrai pont) : après `stop`, le pont remet seul les lampes dans
  leur état d'avant ; aucun instantané à prendre côté Kasbah.
- **Constat de l'utilisateur du 2026-11-07**, avec la synchro musique : à l'arrêt de l'écoute, les lampes
  semblent rester dans leur dernier état. Non tranché : avec l'ancien code, les lampes restaient 5 s au
  plancher de l'effet avant la fermeture, ce qui peut aussi expliquer ce constat.

Le code du même jour ne dépend pas de la réponse pour rendre l'état d'avant (s'il est déjà rendu, le
PUT renvoie le même). Il en dépend pour l'extinction après une pause : si le pont rend l'état d'avant à
`stop`, les lampes peuvent se rallumer un instant entre la fermeture du flux et `switchOff`. Publié sur
décision de l'utilisateur sans essai préalable ; **à trancher sur la vraie maison** (arrêter l'écoute,
regarder s'il y a un éclat avant l'extinction ; si oui, éteindre avant de fermer le flux).

### Mise à jour 2026-11-07 (suite) — le pont refuse un nouveau flux pendant 15 s à 3 min après le précédent

Constat sur la vraie maison, juste après la mise en service du code ci-dessus : la synchro de « Ce
navigateur » ne s'ouvre plus, `The DTLS handshake timed out (3 attempt(s), 3 packet(s) from the bridge,
timers up to 13 ms late)` toutes les 15 s pendant plusieurs minutes. Le même échec figure dans les journaux
du matin **avec la version d'avant** : flux fermé 5 s après un changement de morceau lent, refus pendant
~100 s, puis ouverture d'elle-même.

Reproduit le jour même sur le vrai pont, avec les clés du serveur, par scripts jetables qui tracent chaque
datagramme (zone démarrée et arrêtée par CLIP à chaque essai) :
- poignée de main saine : `ClientHello` → `HelloVerifyRequest` → `ClientHello` avec cookie → `ServerHello` +
  `ServerHelloDone` → `ClientKeyExchange` + `ChangeCipherSpec` + `Finished` → `ChangeCipherSpec` + `Finished`,
  3 datagrammes reçus, ~25 ms ;
- **après la fin de n'importe quelle session**, le pont répond au premier `ClientHello` (`HelloVerifyRequest`)
  puis plus rien au second : d'où « 1 paquet par tentative ». Durée mesurée de 15 s à plus de 3 min, quelle
  que soit la fin de la session précédente (`close_notify` puis `stop`, ou coupée sans un mot), avec ou
  sans trames envoyées, en réessayant toutes les 5 s ou en attendant 40 s avant le premier essai, depuis un
  port UDP local neuf **ou le même** que la session précédente ;
- laisser la zone active entre deux sessions (pas de `stop`) est pire : le pont ne répond plus du tout.

**Contradiction avec la mise à jour 2026-11-06 (soir)** ci-dessus (« fermer puis rouvrir un flux sain,
aussitôt et trois fois de suite, marche ») : plus vrai le 2026-11-07 sur ce pont. Version du pont non
relevée ; la mise à jour du 2026-11-06 reste telle quelle, celle-ci la remplace pour la conduite à tenir.

Conséquences :
- La synchro ne ferme plus le flux pendant une pause ([1_6](../1_architecture/1_6_lecteur-musique.md), même
  jour) : un flux gardé ouvert n'a pas à être rouvert.
- `openStream` (`entertainment.ts`) ajoute au message d'échec, quand chaque tentative a reçu une réponse puis
  plus rien : `the bridge answered the first message of each try only, as it does for 15 s to 3 min after a
  stream ended` — lisible dans le panneau des lumières en rythme. Test `entertainment.test.ts`.
- `switchOff` (extinction des lampes après une pause, section 2026-11-07 ci-dessus) est retiré du
  `LightStreamer` : plus de fermeture pendant une pause. La **contradiction du 2026-11-07** sur l'arrêt du flux
  (éclat possible entre la fermeture et l'extinction) n'a donc plus d'objet ; reste ouvert, sans conséquence
  pour le code, ce que le pont fait des lampes à `stop` (l'état d'avant est rendu par Kasbah de toute façon).
