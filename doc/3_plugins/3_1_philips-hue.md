# Plugin Philips Hue

> Dernière mise à jour : 2026-10-24
> Sources : `apps/server/src/plugins/hue/{index,client,discovery,mapping,types}.ts`, `apps/server/src/core/sse.ts`, tests `mapping.test.ts`, `plugin.test.ts`

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
  Hors périmètre de cette itération.
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
