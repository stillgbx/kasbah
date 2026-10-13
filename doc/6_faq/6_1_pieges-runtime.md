# FAQ — pièges à l'exécution

> Dernière mise à jour : 2026-10-13
> Sources : `apps/web/src/components/home/SceneLoader.vue`, `apps/web/src/three/HouseScene.ts` (`padLamps`), `apps/web/src/three/core/post.ts`, session du 2026-09-19 (`_generated-ai-doc/sessions/2026-09-19-irobot/journal.md`), sessions du 2026-09-04, du 2026-09-07, du 2026-09-08 et du 2026-09-09, `apps/server/src/plugins/tahoma/{client,index,mapping}.ts`, `apps/web/src/stores/devices.ts`, `apps/web/src/stores/scenes.ts`, `apps/server/src/plugins/hue/index.ts`, `apps/server/test/integration.test.ts`, `apps/web/src/styles/app.css`, `apps/server/src/core/registry.ts`, `packages/shared/src/devices/{state,rules}.ts`, `apps/web/src/lib/deviceState.ts`, `packages/mock-sim/src/simulation.ts`, `packages/shared/src/house/geometry/walls.ts`, `house/fit-survey.mjs`, `apps/web/src/composables/useHouseScene.ts`, `apps/server/src/plugins/google_cast/{index,known,discovery,channel,mapping}.ts`, session du 2026-09-17 (`_generated-ai-doc/sessions/2026-09-16-comap-proteo-2/journal.md`), `apps/web/src/components/automations/AutomationEditor.vue`, `apps/server/src/core/atomic-file.ts`, `apps/server/src/plugins/tesla/{state,index}.ts`, `apps/web/src/views/AutomationEditView.vue`, `apps/server/src/plugins/claude/run.ts`, `house/demos/tilleuls.json`

## ytmusic : « Best of » reste en Album alors que « Best Of » est en Compil

- **Date** : 2026-09-21
- **Symptôme** : *The Best of Depeche Mode, Vol. 1* en colonne Album ; un autre *Best Of* en Compil.
- **Diagnostic** : pas la casse (déjà normalisée). `getAlbum` / InnerTube posait `releaseType: 'album'`
  et `mapAlbum` court-circuitait `inferCompilationFromTitle` via `??`.
- **Solution** : les mots-clés titre forcent `compilation` sauf Single/EP (`mapping.ts`).

## ytmusic : titre explicite introuvable (Restricted Mode off)

- **Date** : 2026-09-21
- **Symptôme** : morceau connu (ex. *Good Is A LIE*) absent de la colonne Titre ; Restricted Mode off.
- **Diagnostic** : catalogue InnerTube ne le propose qu'en **Music Video**, pas en filtre `song`.
- **Solution** : 4ᵉ recherche `video` fusionnée aux songs (`catalog.ts`).

## ytmusic : pochettes `net::ERR_BLOCKED_BY_ORB`

- **Date** : 2026-09-20
- **Symptôme** : avatars / pochettes manquants ; Network montre des URLs ggpht / googleusercontent
  en `(failed) net::ERR_BLOCKED_BY_ORB`.
- **Diagnostic** : Chrome ORB bloque les réponses cross-origin quand le `Referer` de Kasbah part
  avec un `background-image` CSS (pas de `referrerpolicy` possible en CSS).
- **Solution** : `<img referrerpolicy="no-referrer">` (`ArtThumb.vue` sur `/ytmusic`).
  *(Dépassé le 2026-10-06 : les pochettes sont désormais celles de la page Musique (`/music`, `apps/web/src/views/MusicView.vue`) ; `/ytmusic` n'est plus qu'une redirection vers elle (`apps/web/src/router/index.ts`). `apps/web/src/components/ui/ArtThumb.vue` garde le `referrerpolicy="no-referrer"`.)*

## ytmusic : faux « cookie manquant » en ouvrant `/ytmusic`

- **Date** : 2026-09-20
- **Symptôme** : bandeau « Cookie YouTube Music manquant ou expiré » ; disparaît après un passage
  par Réglages puis retour.
- **Diagnostic** : la vue lisait `plugins.byId.ytmusic.health`, mais `plugins.load()` n'est appelé
  que dans `SettingsView` — inventaire vide ⇒ `linked === false`.
- **Solution** : au montage, `plugins.load()` + `ytmusicStatus()` (`YtmusicView.refreshLink`).
  *(Dépassé le 2026-10-06 : `YtmusicView` n'existe plus, `/ytmusic` redirige vers `/music` ; la fonction `refreshLink` vit aujourd'hui dans `apps/web/src/views/MusicView.vue` et fait toujours `plugins.load()` puis `ytmusicStatus()`.)*

## ytmusic : « Requested format is not available » / seuls des storyboards

- **Date** : 2026-09-20
- **Symptôme** : lecture Cast/Sonos échoue ; yt-dlp ne liste que des images `sb*`.
- **Diagnostic** : yt-dlp ≥2026.08 ignore `android_music` ; sans runtime JS (challenge n/sig) les formats audio disparaissent. Un `-f bestaudio` échoue alors même s'il reste des storyboards.
- **Solution** : `web_music` + `--js-runtimes node` (+ PO Token) ; Node sur le PATH. Pas de `-f` : dump `-J` puis choix en JS (`stream.ts`). Voir `3_plugins/3_16_ytmusic.md`.
  *(Constat du lint du 2026-10-06 : `stream.ts` n'existe pas dans le code ; le dump `-J` et le choix en JS sont dans `apps/server/src/plugins/ytmusic/resolve.ts`, et le lecteur commun appelle yt-dlp par `apps/server/src/music/ytdlp.ts`.)*

## ytmusic : import cookie Chrome Windows « Failed to decrypt with DPAPI »

- **Date** : 2026-09-20
- **Symptôme** : Importer depuis Chrome/Edge échoue malgré navigateur fermé.
- **Diagnostic** : chiffrement lié à l'appli (yt-dlp#10927) — `--cookies-from-browser` casse souvent sur Windows.
- **Solution** : coller l'en-tête Cookie (F12), ou importer depuis Firefox (profil normal, pas privé).

## Plugin Hue « failed to start » avec une ZodError sur `HUE_EXPOSE_ROOMS`

- **Date** : 2026-09-04
- **Symptôme** : au démarrage, `Invalid option: expected one of "0"|"1"|"true"|"false"` alors que `.env` est correct.
- **Diagnostic** : l'hôte passe au plugin une config **déjà transformée** (booléens) ; le plugin la re-parsait avec le schéma d'entrée (chaînes).
- **Solution** : dans `init(ctx)`, utiliser `ctx.config as HueConfig` sans re-parser. Règle générale documentée dans `3_plugins/3_2_ecrire-un-plugin.md`.
- **Récidive 2026-10-07** : même erreur sur le plugin Claude (`CLAUDE_KEEP_SESSIONS`), trouvée à l'allumage réel et pas par les tests, qui passaient une config brute au lieu de celle de l'hôte. Les tests du plugin donnent désormais `claudeConfigSchema.parse({})` (`../3_plugins/3_24_claude.md`).

## Test WebSocket qui expire alors que le serveur envoie bien le snapshot

- **Symptôme** : le test attend `message` après `open` et n'obtient rien.
- **Diagnostic** : le snapshot arrive dans le **même tick** que `open` (même paquet TCP) ; l'écouteur posé après `await open` le manque.
- **Solution** : poser l'écouteur `message` **avant** l'ouverture et consommer via une file (`test/integration.test.ts`).

## Étiquettes 3D au-dessus des boutons de l'interface

- **Symptôme** : les pilules/étiquettes de la scène passent au-dessus des surcouches Vuetify.
- **Diagnostic** : `CSS2DRenderer` pose un `z-index` élevé sur chaque élément projeté.
- **Solution** : `.scene-labels { z-index: 1; isolation: isolate }` — le contexte d'empilement isolé confine ces z-index.

## Patch d'état avec une clé d'un autre kind accepté en silence

- **Symptôme** : un patch `{ position: 3 }` sur une lampe publiait un « changement » vide.
- **Diagnostic** : zod supprime les clés inconnues ; la fusion voyait une différence puis la validation la retirait.
- **Solution** : le registre vérifie les clés du patch contre `stateKeys(kind)` (`packages/shared/src/devices/state.ts`) et rejette avec log.

## Appel interprété comme suite d'un `throw` (ASI)

- **Symptôme** : `TypeError: … is not a function` sur `(dev.apply as …)(cmd)` après un `throw new SimError(…)` sans point-virgule.
- **Diagnostic** : insertion automatique de point-virgule : la parenthèse ouvrante prolonge l'expression précédente.
- **Solution** : ne jamais commencer une ligne par `(` en style sans point-virgule ; passer par une variable intermédiaire.

## Sélection depuis l'URL non appliquée à la scène

- **Symptôme** : `#/?level=rdc&room=cuisine` sélectionne dans le store mais la scène reste en vue d'ensemble.
- **Diagnostic** : la sélection est appliquée avant que la scène soit montée (`scene` encore nul).
- **Solution** : rejouer la sélection quand `scene.ready` passe à vrai (`views/HomeView.vue`).
  *(Dépassé le 2026-10-04 : le routeur est en historique HTML5 (`createWebHistory`, `apps/web/src/router/index.ts`), l'URL s'écrit `/?level=rdc&room=cuisine` ; un ancien lien `#/…` est réécrit au chargement.)*

## Bandeau « Connexion au serveur… » qui clignote au chargement

- **Solution** : n'afficher le statut `connecting` qu'au-delà de 1,5 s (`components/ConnectionBanner.vue`).

## Mur mitoyen rendu en façade, ou mur extérieur qui semble absent

- **Date** : 2026-09-07
- **Symptôme** : sur un niveau relevé, une cloison entre deux pièces apparaît épaisse comme une
  façade ; ou l'inverse, un mur extérieur paraît manquant (une cloison fine là où on attend 30 cm).
- **Diagnostic** : deux causes opposées. (a) `classifySegments` sonde à
  `2 × interiorWallThickness + 5 cm` derrière le **milieu** de l'arête : avec des cloisons plus
  fines que le défaut global, ou quand ce milieu tombe en face du joint entre deux pièces d'en
  face, le sondage ne trouve aucune pièce et conclut « extérieur ». (b) Une arête mitoyenne sur
  quelques centimètres seulement et en façade sur tout le reste est classée mitoyenne **sur toute
  sa longueur** : la façade disparaît.
- **Solution** : ne rien laisser deviner sur un niveau relevé. `house/fit-survey.mjs` écrit
  `kind: 'interior'` et `thickness` explicitement sur les arêtes réellement mitoyennes, et signale
  les arêtes à cheval, à couper par un point colinéaire. Détail dans
  `../2_maison/2_1_geometrie.md`.

## Cadrage caméra : le format portrait coupe la maison

- **Solution** : `fitDistance` prend le plus petit des deux champs (vertical et horizontal) → la sphère englobante tient toujours (`three/core/cameraFit.ts`).

## Changer d'ambiance : la nouvelle pastille ne reste pas allumée

- **Date** : 2026-09-08
- **Symptôme** : une ambiance tourne (Starlight), on en touche une autre du même groupe. La
  nouvelle pastille s'allume un instant puis retombe éteinte, alors que les lampes ont bien pris
  la nouvelle scène et que la route a répondu 200.
- **Diagnostic** : le pont annonce un changement d'ambiance par **deux** messages dans le même lot
  — « la nouvelle est `static` » ET « l'ancienne est `inactive` ». Le serveur les relaie tels quels
  (vérifié au WebSocket). Or `withActive` du store appliquait la règle « une seule active par
  groupe » **aussi sur une désactivation** : le second message éteignait donc toutes les sœurs du
  groupe, dont la nouvelle scène activée par le premier. Le registre serveur, lui, avait le
  garde-fou (`if (active !== 'inactive')`) — la règle avait été perdue en la portant côté client.
- **Solution** : `const sibling = active !== 'inactive' && …` dans
  `apps/web/src/stores/scenes.ts`. **Activer** une scène éteint ses sœurs ; **éteindre** une scène
  n'éteint rien d'autre. Régression couverte dans `stores/scenes.test.ts` (les deux ordres
  d'arrivée du lot).
- **Leçon** : une règle dupliquée serveur/client doit être testée sur les deux côtés avec la même
  séquence. Ici le test client existant n'appliquait jamais un `inactive` explicite pendant qu'une
  sœur était active, donc il passait.

## Créer une ambiance Hue échoue en 400 « mutually exclusive »

- **Date** : 2026-09-08
- **Symptôme** : `POST /clip/v2/resource/scene` renvoie 400
  `Both effects and effects_v2 palettes are mutually exclusive`, alors que la palette envoyée est la
  copie exacte d'une palette lue sur le même pont.
- **Diagnostic** : le pont RENVOIE les deux listes d'effets (`effects: []` et `effects_v2: []`,
  firmware 1.78) mais REFUSE de les recevoir ensemble, même vides. Recopier une palette telle quelle
  est donc impossible. Isolé en trois essais : sans palette le POST passe (201), avec la palette
  brute le PUT échoue (400), avec la palette assainie il passe (200).
- **Solution** : `toCreatePalette` (`plugins/hue/mapping.ts`) ne garde que la liste d'effets non
  vide, et aucune si les deux le sont. Couvert par `mapping.test.ts`.
- **Leçon** : ce qu'un fabricant renvoie en lecture n'est pas toujours un corps d'écriture valide.
  Recopier une ressource demande de l'assainir, pas de la relayer.

## Un glisser-déposer qui réordonne la liste perd son `pointerup`

- **Date** : 2026-09-08
- **Symptôme** : dans la vue Lumières, le premier glissement d'une carte s'enregistre bien, le
  suivant non — la carte reste en état « déplacée » (contour d'accent), l'ordre affiché est le bon
  mais rien n'est écrit dans `house.json`, et le glissement suivant repart d'un état incohérent.
- **Diagnostic** : la poignée appelait `setPointerCapture` et écoutait `pointermove` / `pointerup`
  **sur elle-même**. Or réordonner la liste fait déplacer la carte — donc le bouton — par Vue dans le
  DOM, ce qui **relâche la capture de pointeur** (`lostpointercapture`). Le `pointerup` part alors sur
  l'élément réellement sous le curseur, pas sur la poignée : `endDrag` n'est jamais appelé. Le premier
  glissement de la session passait tant que le relâchement tombait encore sur la poignée.
- **Solution** : poser `pointermove` / `pointerup` / `pointercancel` sur **`window`** au `pointerdown`
  et les retirer dans `endDrag` (plus `onBeforeUnmount(endDrag)` pour ne pas laisser d'écouteurs en
  quittant la vue au milieu d'un geste). Aucune capture de pointeur n'est nécessaire.
- **Leçon** : capture de pointeur et liste qui se réorganise sous le doigt sont incompatibles — dès
  que le geste déplace son propre élément déclencheur, l'écoute appartient à la fenêtre.

## Un flux d'événements en deltas : l'état d'un appareil semble figé

- **Date** : 2026-09-08
- **Symptôme** : les états d'un appareil arrivent bien (la position finale d'un volet se met à jour),
  mais un champ dérivé reste éternellement à sa valeur par défaut — ici `motion` bloqué sur
  `stopped` alors que l'ouvrant est visiblement en train de descendre.
- **Diagnostic** : la box TaHoma envoie des **deltas d'une seule clé par trame**. Sur une fermeture,
  `core:TargetClosureState` arrive seul, puis `core:MovingState=true` arrive dans **sa propre trame**,
  et aucune position n'est publiée pendant la course. Le mappage calculait le patch à partir de la
  **trame seule** : celle qui dit « je bouge » n'a ni position ni cible, donc il ne pouvait pas en
  déduire un sens et n'émettait rien du tout.
- **Solution** : garder par appareil un **état complet fusionné**, semé par la découverte puis mis à
  jour trame par trame, et calculer le patch sur cette carte fusionnée — pas sur le fragment reçu.
- **Leçon** : avant d'écrire un mappage d'événements, vérifier si le fabricant envoie des **états
  complets** (le pont Hue) ou des **deltas** (Overkiz). Un mappage pur sur fragment ne marche que
  dans le premier cas ; dans le second, tout champ calculé à partir de **deux** états ou plus exige
  l'accumulation. À vérifier sur une capture réelle : la documentation ne le dit pas.

## Une requête sans délai propre peut geler un sondage pour de bon

- **Date** : 2026-09-08
- **Symptôme** : une commande a expiré au bout de 10 s (HTTP 504, `KASBAH_COMMAND_TIMEOUT_MS` de
  l'hôte de plugins) sans **aucun** log du plugin, alors que la même requête mesurée seule contre le
  même appareil répond en 54 ms. Non reproductible.
- **Diagnostic** : la cause du blocage n'a pas été identifiée. Mais l'incident a révélé un défaut de
  conception : **aucune requête du client n'avait de délai propre**. Le défaut d'undici est de 300 s
  (`headersTimeout`/`bodyTimeout`), et seul le garde-fou de l'hôte protégeait les commandes. Le
  sondage d'événements, lui, n'en avait aucun : `createPoller` attend `fn()`, donc une requête
  coincée aurait figé le sondage **indéfiniment**, en silence, `health()` restant `ok` pendant que le
  plugin était aveugle.
- **Solution** : chaque requête porte son `AbortSignal.timeout` composé avec le signal d'arrêt du
  plugin (`AbortSignal.any`), mappé sur `PluginError('TIMEOUT')`. Le délai est injectable pour que
  les tests n'attendent pas 8 s.
- **Leçon** : un plugin qui parle à un équipement local doit borner **chaque** requête, pas seulement
  celles qu'un appelant borne déjà. Le pire mode de défaillance n'est pas la commande qui échoue,
  c'est la boucle de sondage qui s'arrête sans le dire.

## Un délai calculé sur l'horloge du serveur, jetée par une horloge simulée

- **Date** : 2026-09-08
- **Symptôme** : une valeur que le client doit tenir quelques secondes (ici la position visée d'un
  volet) est abandonnée **dès la première trame reçue**. Rien dans les tests unitaires ne le montre :
  ils passent tous.
- **Diagnostic** : la péremption était calculée en comparant `state.updatedAt` à l'instant de pose.
  Or `updatedAt` est posé par le SERVEUR, et le plugin `mock` tourne sur une horloge **simulée
  accélérée** (`MOCK_TIME_SCALE`) : ses valeurs bondissent de plusieurs minutes entre deux trames.
  L'écart dépassait immédiatement le délai de 90 s.
- **Solution** : mesurer une durée vécue par le client avec `Date.now()`. `updatedAt` sert à ordonner
  et à dédupliquer des états, pas à chronométrer côté client.
- **Leçon** : ne jamais mélanger deux bases de temps dans une soustraction. Dans cette app, trois
  horloges coexistent — celle du navigateur, celle du serveur, et le temps simulé du mock.

## Un état optimiste pris pour une confirmation du serveur

- **Date** : 2026-09-08
- **Symptôme** : une intention que le client doit tenir jusqu'à confirmation est effacée aussitôt
  posée, alors que la logique d'abandon semble correcte.
- **Diagnostic** : la mise à jour optimiste écrit elle-même le champ qui sert de preuve (`motion`
  passé à `closing` de notre propre chef). La règle d'abandon lisait ce champ sans distinguer son
  origine et prenait notre propre écriture pour une réponse du fabricant : la première trame réelle,
  souvent « à l'arrêt » avant que le moteur démarre, passait alors pour « arrêté ailleurs ».
- **Solution** : poser l'intention **après** le patch optimiste, pour que la résolution ne voie que
  des états venus du serveur. Et relever toute valeur dont on aura besoin **avant** ce patch, qui
  peut déjà avoir fait disparaître ce qu'on voulait lire.
- **Leçon** : dès qu'une mise à jour optimiste et une règle de décision lisent le même champ, il faut
  savoir qui l'a écrit. Ordonner les deux est plus simple que de tracer l'origine, mais l'ordre
  devient alors une contrainte à commenter — sans quoi un refactor la reperdra.

## Un indicateur d'activité qui clignote sans être lisible

- **Date** : 2026-09-08
- **Symptôme** : un spinner apparaît et disparaît presque aussitôt, alors que l'appareil met une
  vingtaine de secondes à exécuter la commande.
- **Diagnostic** : l'indicateur était branché sur « une requête est en vol » (`isPending` du store).
  Or un fabricant acquitte en quelques dizaines de millisecondes — 54 ms mesurées sur une box
  TaHoma — et la commande n'est que le DÉBUT de l'action.
- **Solution** : distinguer les deux notions. `isDeviceBusy` répond « l'appareil exécute encore » :
  pour un ouvrant, tant qu'il bouge ou qu'une position reste visée.
- **Leçon** : « requête en cours » et « appareil occupé » ne coïncident que pour les appareils qui
  répondent instantanément. Tout ce qui a une inertie mécanique demande la seconde notion.


## Deux stores annoncés « baissés » alors qu'ils sont remontés

- **Date** : 2026-09-08
- **Symptôme** : l'en-tête affiche « 2 stores baissés » et les deux lignes disent « Baissé », alors
  que les stores sont bel et bien remontés. L'utilisateur soupçonne une inversion de vocabulaire.
- **Diagnostic** : le vocabulaire était juste (`cover.upDown.open` = « Remonté », `closed` =
  « Baissé », vérifié dans les deux locales), et la chaîne d'affichage cohérente avec elle-même. Le
  défaut était **en amont** : ces deux stores sont en RTS, radio unidirectionnelle, ils ne renvoient
  aucun état. La `position: 0` venait de `defaultState('cover')`
  (`packages/shared/src/devices/rules.ts`), un remplissage prévu pour un appareil *indisponible* —
  que le plugin déclarait ensuite disponible sans jamais fournir de position. L'interface affirmait
  donc un fait qu'elle n'avait jamais reçu.
- **Solution** : `position` est devenue optionnelle dans `coverStateSchema`, son absence signifiant
  « inconnue », et `defaultState` n'en pose plus. Tous les points de lecture ont été repris pour ne
  rien affirmer, compteurs du résumé compris (voir `../1_architecture/1_1_contrat-appareils.md`).
- **Leçon** : **une valeur par défaut se lit comme un fait.** Un zéro de remplissage traverse toute
  l'application et ressort en libellé et en compteur, sans jamais dire d'où il vient. Quand un
  appareil peut ne pas savoir, le contrat doit pouvoir l'exprimer — et c'est le rôle d'un type
  optionnel, pas d'une convention entre développeurs.
- **Indice qui aurait dû alerter plus tôt** : la même ligne montrait deux indicateurs contradictoires
  — icône éteinte (`isDeviceOn` : `position > 0`, donc « pas ouvert ») et interrupteur coché
  (`toggleChecked` : `position <= 0`, donc « fermé »). Deux lectures opposées de la même valeur sur
  une seule ligne signalent presque toujours une donnée absente déguisée en donnée.


## « Position non enregistrée : HTTP 414 » sur une caméra auto-placée

- **Date** : 2026-09-09
- **Symptôme** : en mode Déplacer, faire glisser une caméra Nest auto-placée affiche « Position non
  enregistrée : HTTP 414 ». Les appareils Hue et TaHoma se déplacent sans problème.
- **Diagnostic** : 414 = « URI trop longue ». Fastify borne chaque paramètre d'URL à **100
  caractères** par défaut (`maxParamLength`). Les ids Google Nest font 96 caractères : `nest:<id>`
  passe de justesse (99), mais l'id maison dérivé par l'auto-placement, `auto.nest-<id>`, en fait
  104 — et c'est lui que porte `PUT /api/house/devices/:id`. Rien à voir avec le placement
  lui-même : la requête n'atteignait pas la route.
- **Solution** : `maxParamLength: 512` dans les options de Fastify (`apps/server/src/app.ts`), avec
  un test qui envoie un id de 104 caractères sur cette route.
- **Leçon** : un id de fabricant n'a pas de longueur garantie, et un préfixe ajouté côté maison
  (`auto.<plugin>-`) suffit à franchir une limite qu'on ignorait. Toute route qui met un id dans
  l'URL doit tolérer les ids les plus longs du parc, pas ceux de la simulation.

### Mise à jour 2026-09-19 — Fastify 5 : `routerOptions`

Jusqu'au 2026-09-19, `maxParamLength: 512` était au **premier niveau** des options Fastify. Fastify
5.12 émet alors `FSTDEP022` au démarrage (accès déprécié, retiré en v6). La valeur reste 512 ; elle
vit désormais dans `routerOptions: { maxParamLength: 512 }` (`apps/server/src/app.ts`). Le test
d'id long (`apps/server/src/app.test.ts`) est inchangé. Détail outillage :
`6_0_pieges-outillage.md`.


## Un flux vidéo qui continue après avoir quitté la vue Maison

- **Date** : 2026-09-09
- **Symptôme** : on ouvre la sonnette dans le panneau appareil, la vidéo joue ; on passe à la vue
  Caméras ; dix secondes plus tard le serveur annonce toujours « 1 live stream(s) », ffmpeg tourne,
  la session RTSP chez Google reste ouverte et se fait prolonger toutes les quatre minutes.
- **Diagnostic** : `CameraVideo.vue` fermait son WebSocket dans `onBeforeUnmount`. Or `App.vue`
  garde la vue Maison **en vie** (`<keep-alive include="HomeView">`, pour ne pas reconstruire la
  scène 3D à chaque retour) : changer d'onglet **désactive** la vue, il ne la démonte pas. Le
  composant vidéo continuait donc de recevoir et décoder le flux, invisible. Côté serveur, rien à
  reprocher : sans fermeture du client, aucun `close` n'arrive.
- **Solution** : `onDeactivated(close)` et `onActivated(start)` en plus du démontage, et un `watch`
  sur `deviceId` (le même composant est réutilisé quand on passe d'une caméra à une autre). Par
  sûreté côté serveur, la route du flux **pingue** l'écran toutes les 30 s et coupe sans pong :
  un écran qui perd le Wi-Fi ne laisse plus ffmpeg ni la session Google tourner.
- **Leçon** : dans une vue gardée en vie, **`onBeforeUnmount` n'est pas « je quitte l'écran »**. Tout
  composant qui tient une ressource vivante (WebSocket, flux, minuteur) sous `HomeView` doit
  aussi écouter `onDeactivated` / `onActivated`. Et une ressource coûteuse côté serveur ne doit
  jamais dépendre du seul bon vouloir du client pour être libérée.
- **Suite, le même jour** : un second ffmpeg survivait quand même. Deux WebSockets partaient pour la
  même caméra (sous `<keep-alive>`, `mounted` PUIS `activated` appelaient tous deux `start`, et le
  premier `MediaSource` finissait par ouvrir sa connexion), et côté serveur deux `openStream`
  simultanés demandaient chacun une session à Google — la seconde écrasait la première dans la
  table, dont le ffmpeg et le minuteur de prolongation ne s'arrêtaient plus. Corrigé aux deux bouts :
  une `MediaSource` périmée n'ouvre plus de WebSocket, et le plugin partage l'ouverture en cours
  (`opening`) entre demandes concurrentes. Leçon : **une ressource par clé ouverte de façon asynchrone
  doit dédupliquer sur la promesse, pas sur le résultat.**
- **Note de développement** : un `hmr update` de `CameraVideo.vue` remonte le composant même quand la
  vue Maison est désactivée, donc `mounted` rouvre un flux invisible (vu : « 1 live stream(s) » et
  un ffmpeg alors que l'onglet Caméras était affiché). Recharger la page le ferme. Ça n'arrive pas
  en production, où rien ne remonte un composant sous une vue désactivée.

## Vignettes figées plusieurs minutes après un redémarrage du serveur

- **Date** : 2026-09-09
- **Symptôme** : on relance `npm run dev` ; sur la vue Caméras, les caméras actives montrent une
  image « il y a 7 min » qui ne bouge pas, recharger la page n'y change rien ; lancer le direct sur
  une carte « repart un peu », pas pour toutes.
- **Diagnostic** : trois choses se cumulent. (1) Les vignettes sont des **fichiers** dans le dossier
  temporaire : ils survivent au serveur, leur date est donc celle de l'ancienne exécution — l'âge
  affiché est vrai, c'est la session qui manque. (2) La mémoire des caméras **en échec** (éteintes,
  404) ne survit pas ; au redémarrage la rotation classait par ancienneté de vignette, et les
  caméras sans vignette passaient **avant** les actives, une ouverture par 8 s, avec un quota
  Google (≈ 10 commandes/min) qui déclenche vite la pause de 90 s. (3) Deux serveurs peuvent tourner
  en même temps sur le même compte Google et le **même dossier de vignettes** (la preview du volet
  navigateur, `.claude/launch.json`, et le `npm run dev` de l'IDE) : deux fois plus de commandes,
  et deux ffmpeg qui écrivent le même fichier. Et un serveur tué sans `stop()` (`tsx watch`, Ctrl+C
  mal propagé sous Windows) laisse ses ffmpeg **orphelins** jusqu'à l'échéance Google, cinq minutes.
  Recharger la page ne sert à rien : tout se joue côté serveur.
- **Solution** : rangs dans la rotation (`gridTick`) — d'abord les caméras qui ont une vignette et
  n'ont pas encore été rendues (exécution précédente ou session morte), puis les jamais essayées,
  puis les rendues, puis les échecs. Après un redémarrage, les caméras connues comme actives sont
  rouvertes dans les 24 premières secondes. Pour le reste : **un seul serveur** face au compte
  Google quand on regarde la vue Caméras, et, après un redémarrage brutal, `tasklist | findstr
  ffmpeg` pour compter les orphelins (ils meurent seuls à cinq minutes).
- **Leçon** : un cache sur disque qui survit au processus est une **mémoire partielle** — ici la
  preuve qu'une caméra diffuse, sans la mémoire de celles qui ne diffusent pas. Quand l'ordre d'un
  travail dépend d'une telle mémoire, distinguer explicitement « connu bon », « inconnu » et
  « connu mauvais » plutôt que de tout mettre sur une seule échelle de temps.

## Naviguer PUIS sélectionner : le watcher URL annule la navigation

- **Date** : 2026-09-09
- **Symptôme** : à un coup de sonnette (événement `deviceEvent`) déclenché alors qu'on est sur la vue
  Caméras, la sonnette est bien sélectionnée mais l'écran **reste** sur Caméras — la vue Maison ne
  s'affiche pas, alors que le handler appelle `router.push({ name: 'home' })`.
- **Diagnostic** : `HomeView` a un watcher qui **reflète la sélection dans l'URL**
  (`router.replace({ query })`, sans chemin → route courante). Le handler faisait, dans l'ordre :
  `router.push(home)` (asynchrone) puis `house.selectDevice(...)` (synchrone). La sélection déclenche
  aussitôt le `router.replace({ query })` sur la route **courante** (Caméras), qui court contre le
  `push(home)` encore en vol et le supplante. On finit sur `#/cameras?…room=entree`.
  *(Dépassé le 2026-10-04 : depuis le routeur en historique HTML5 (`createWebHistory`), l'URL obtenue serait `/cameras?…room=entree`, sans `#`. Le mécanisme décrit est inchangé.)*
- **Solution** : **attendre** la navigation avant de sélectionner :
  `await router.push({ name: 'home' }).catch(() => {})` puis `house.selectDevice(...)`. Le
  `replace({ query })` s'applique alors sur la maison. (Le cadrage 3D, lui, marchait déjà : les
  watchers `selectedRoomId → focusRoom` tournent même quand `HomeView` est désactivé sous
  `<keep-alive>`, donc la scène était cadrée avant même d'être affichée.)
- **Leçon** : quand deux écritures de route se suivent (une navigation explicite et un watcher qui
  réécrit l'URL), **sérialiser** — sinon la seconde, calée sur la route courante, gagne.
- **Récidive 2026-09-10** : le bouton « Placer » d'une liste posait la sélection (store) puis appelait
  `router.push(home)` — même course, même perdant : l'utilisateur restait sur la liste avec
  `?device=…` dans l'URL. La règle tient aussi dans l'autre sens : **naviguer d'abord, poser l'état
  ensuite** quand l'état est reflété dans l'URL par une vue gardée en vie.

## Un état émis pendant `discover` est perdu (appareils « off », volume 0)

- **Date** : 2026-09-09 (plugin `google_cast`).
- **Symptôme** : `health` dit « N device(s), N connected », mais quelques appareils sont affichés
  indisponibles, volume 0, lecture « off » — l'état par défaut du kind — tandis que les autres
  sont corrects. Le partage varie d'un redémarrage à l'autre.
- **Diagnostic** : le plugin connecte chaque appareil **dans `discover`** (il lui faut le type de
  volume pour construire le descripteur) et le premier `RECEIVER_STATUS` déclenchait aussitôt
  `ctx.emitState`. Or l'hôte n'enregistre les descripteurs qu'au **retour** de `discover` : le
  registre jette le patch (« patch for unknown device ignored », en warn). Les « bons » avaient
  reçu un second état après l'enregistrement (redémarrages de `tsx watch` en cascade), pas les
  autres. Rien ne signale l'erreur au plugin : `emitState` ne rend rien.
- **Solution** : ne publier qu'à partir de `start` (`started` faux avant) ; au `start`, pousser
  d'un bloc l'état courant de chaque connexion (`emitCurrent`), et marquer indisponibles celles qui
  n'ont pas abouti. Test : un seul patch complet par appareil, après `start`, rien pendant `discover`.
- **Leçon** : un plugin qui se connecte dans `discover` pour lire des capacités doit **retenir** ce
  qu'il reçoit et le publier au `start` — le contexte accepte les appels trop tôt sans se plaindre.

## Une radio joue, l'enceinte reste « Au repos » (MEDIA_STATUS rejeté)

- **Date** : 2026-09-09 (plugin `google_cast`).
- **Symptôme** : une radio lancée à la voix joue sur un Nest Mini ; Kasbah l'affiche « Au repos », touches
  grisées. Log serveur : `MEDIA_STATUS with an unexpected shape ignored`, issue
  `media.duration : expected number, received null`.
- **Diagnostic** : le schéma zod du `MEDIA_STATUS` déclarait `duration: z.number().optional()`, d'après la
  référence Cast. Un flux **en direct** n'a pas de durée et le récepteur envoie `null`, pas une absence :
  `optional` n'accepte pas `null`, le message entier est rejeté, la session média n'est jamais connue,
  donc ni lecture ni commandes (`nothing is playing`). Même piège que TaHoma (`3_2_ecrire-un-plugin.md`,
  « schémas larges sur les valeurs qu'on ne lit pas ») : la fixture était **déduite** de la spec, elle ne
  pouvait pas contenir ce `null`.
- **Solution** : tout champ qu'on ne lit pas strictement passe en `.nullish()` (`types.ts`) et le mappage
  traite vide et `null` comme « absent » (`||` plutôt que `??`, `mapping.ts`). La capture réelle est
  devenue une fixture (`RECEIVER_STATUS_RADIO`, `MEDIA_STATUS_RADIO`) avec ses bizarreries : `duration:
  null`, `contentId: ""` (URL dans `contentUrl`), piste `VIDEO` sur un flux audio. Vérifié en réel : l'enceinte
  passe en « Lecture · » suivi du nom de la radio, touches actives.
- **Leçon** : « optionnel » selon la spec veut souvent dire **`null`** chez le fabricant. Pour un champ
  qu'on n'exploite pas, `nullish` — ou `unknown` — jamais un type strict.

## À la pause, le morceau disparaît (« Rien en lecture · En pause »), et un identifiant s'affiche en titre

- **Date** : 2026-09-09 (plugin `google_cast`, Nest Hub avec YouTube Music).
- **Symptôme** : pause → le panneau perd titre, artiste et barre ; reprise → ils reviennent. À chaque
  changement de morceau, le titre affiche une seconde un identifiant (« NxHNlQsUooM »).
- **Diagnostic** : deux lectures trop littérales de la référence Cast. (1) Le récepteur n'inclut le
  bloc `media` d'un `MEDIA_STATUS` **que lorsqu'il change** : un accusé de PAUSE arrive sans lui, et
  le mappage traitait « pas de `media` » comme « plus rien ». (2) Au changement de morceau, le
  premier état porte `contentId` (id de vidéo YouTube, URI Spotify) **avant** les métadonnées ; le
  repli de titre `metadata.title ?? contentId` l'affichait.
- **Solution** : dans `channel.ts`, un état sans `media` pour la **même** `mediaSessionId` hérite du
  `media` connu (une autre session n'hérite de rien) ; le faux récepteur des tests acquitte PLAY /
  PAUSE par un delta sans `media`, comme le vrai. Dans `mapping.ts`, jamais `contentId` comme titre :
  `metadata.title`, sinon `statusText` de l'appli (« Diffusion: <radio> »), sinon son nom.
- **Leçon** : dans un flux d'états en **deltas**, l'absence d'un champ veut dire « inchangé », pas
  « vide » (même leçon que les événements Overkiz) ; et un identifiant n'est jamais un libellé.

## 2026-09-10 — Les tests écrivaient le fichier d'état réel du poste

- **Symptôme** : à l'ajout de la mémoire des appareils Cast, cinq tests du plugin partis au vert
  échouaient d'un coup, dont `health` qui annonçait « N device(s), 0 connected » là où le test
  n'avait déclaré **aucun** appareil. Et `apps/server/.state/google-cast-devices.json` contenait un
  appareil fictif au milieu des vrais.
- **Diagnostic** : la valeur par défaut de `CAST_KNOWN_FILE` pointe vers le fichier d'état du dépôt. Le
  faux contexte des tests parse la configuration réelle (`googleCastConfigSchema.parse({…})`), les tests
  **lisaient donc la mémoire du poste de développement** et **écrivaient** la leur par-dessus (en
  parallèle, plusieurs processus vitest).
- **Solution** : le contexte de test passe `CAST_KNOWN_FILE: ''` (chaîne vide = aucune mémoire), et les
  tests qui veulent en éprouver une l'**injectent** (`deps.known`, en mémoire vive). Le fichier
  intermédiaire d'écriture porte en plus le pid, deux serveurs pouvant partager le fichier.
- **Leçon** : un défaut de configuration qui désigne un **chemin du dépôt** est une porte ouverte dans les
  tests. Le fichier de maison suivait déjà cette règle (`KASBAH_HOUSE_FILE` en dossier temporaire dans
  `app.test.ts`) ; toute nouvelle variable qui désigne un fichier doit être neutralisée de la même façon.

## 2026-09-10 — Un Cast en veille profonde disparaît de l'inventaire (et emporte le nom de l'appareil)

- **Symptôme** : un appareil posé dans la maison la veille s'affichait sous son id brut
  (`auto.google_cast-abcd1234…`), panneau « Cet appareil n'est lié à aucun plugin », icône générique et
  pilule 3D démesurée — alors qu'il avait bien été enregistré.
- **Diagnostic** : le nom et l'icône viennent du **descripteur du plugin**, l'entrée de `house.json` ne
  portant qu'une liaison (`deviceId`) — décision assumée pour qu'un renommage chez le fabricant se
  propage (`../2_maison/2_0_format-house-json.md`). Or l'inventaire Cast venait **entièrement** de la
  découverte mDNS : un téléviseur en veille profonde ne s'annonce plus, donc plus de descripteur, donc
  plus rien à afficher que la clé.
- **Solution** : le plugin retient les appareils déjà vus dans un fichier et les republie au démarrage,
  indisponibles (`../3_plugins/3_6_google-cast.md`), avec un geste « Oublier l'appareil » pour le ménage.
- **Leçon** : quand l'inventaire d'un plugin vient d'une **découverte** et non d'une passerelle qui liste
  tout, la disparition d'un appareil n'est pas une information — c'est un trou. Ce qui a été vu une fois
  doit survivre au redémarrage, sans quoi les liaisons de la maison s'effondrent en silence.

## 2026-09-10 — « -1:-1 » : une durée négative prise pour une durée

- **Symptôme** : une appli de vidéo à la demande lancée sur une TV Android, le panneau affichait « -1:-1 » **des deux
  côtés** du curseur de position, curseur collé à zéro, alors que l'appareil publiait une position qui
  avançait (`currentTime: 141.89`).
- **Diagnostic** : `duration: -0.001` dans le MEDIA_STATUS — la façon de cette appli de dire
  « inconnue ». Elle passait le contrôle `typeof … === 'number'`, puis : le formateur rendait
  « -1:-1 » (`Math.floor(-0.001 / 60)`), et surtout la position était **bornée à la durée**
  (`Math.min(position, duration)`), donc écrasée par une valeur négative. Une seule mauvaise valeur
  faisait mentir trois affichages.
- **Solution** : une durée n'est retenue que **positive et finie**, côté plugin (`isDuration`) comme
  côté UI ; une position négative est ignorée. Fixture réelle ajoutée
  (`../3_plugins/3_6_google-cast.md`).
- **Leçon** : troisième déclinaison du même piège. `null` (radio), `-0.001` (une appli de vidéo),
  `stepInterval: 0.0199…` (volume Cast) : un fabricant encode « je ne sais pas » comme il veut, dans le
  type attendu. Valider le **domaine** d'une valeur, pas seulement son type — et ne jamais laisser une
  valeur douteuse en borner une autre qui, elle, est sûre.

## 2026-09-10 — « Précédent » coupe un direct, et l'enceinte reste inutilisable

- **Symptôme** : un direct radio (une station d'information) joue sur une enceinte Cast ; les touches précédent /
  suivant sont actives. Un appui sur « précédent » **arrête le flux**, et l'appareil reste ensuite dans
  un état où même relancer la radio à la voix échoue.
- **Diagnostic** : `media_player.previous` appliquait la règle de télécommande « passé 3 s, retour au
  début du morceau » et envoyait un `SEEK` à `0` — sur un flux en direct, qui n'a pas de début. Le
  récepteur coupait le flux et gardait une session morte que l'appli ne sait pas relancer. Deux causes
  se cumulaient : une **règle valable pour un morceau appliquée à autre chose**, et une UI qui ne
  savait pas distinguer les deux.
- **Solution** : le plugin publie `nowPlaying.live` (depuis `media.streamType === 'LIVE'`) ; l'UI grise
  précédent, suivant et le curseur ; le plugin **refuse** ces commandes sans rien envoyer à l'appareil
  (`UNSUPPORTED_COMMAND`), pour qu'un état en retard côté interface ne puisse plus couper un flux.
- **Leçon** : ne pas croire un appareil qui annonce ses capacités **par commande**. Le masque
  `supportedMediaCommands` de l'appli Radio France déclare SEEK, précédent et suivant sur un direct
  (`12495`) où aucun n'est valable ; celui d'une appli de streaming vidéo (`143`) omet « suivant », qui fonctionne. Un
  masque qui se trompe dans les deux sens n'est pas exploitable : il faut chercher la donnée qui décrit
  la **nature de ce qui joue** (`streamType`), pas la liste de ce que le vendeur croit permis. Et
  quand une commande peut casser l'appareil, la refuser au plus près de la socket — l'UI grise pour le
  confort, le plugin protège.

## 2026-09-10 — Un catalogue qui répond toujours quelque chose

- **Symptôme** (évité de justesse, pas subi) : en cherchant la pochette d'un morceau par son nom,
  l'API de recherche iTunes a rendu un artiste de variété et un orchestre sans rapport pour
  « Titre - Live Performance (Piano Set) ». Prendre le premier résultat aurait collé une pochette
  sans aucun rapport sur la lecture, avec l'aplomb d'une vraie donnée.
- **Diagnostic** : une recherche plein-texte n'a pas de notion d'échec. `resultCount: 0` n'arrive que
  si aucun mot ne ressemble à rien ; sinon elle classe et rend le moins mauvais. Deezer, lui, rend
  `{ data: [] }` sur la même question — deux services, deux conventions.
- **Solution** : ne jamais accepter un résultat de recherche sans **vérifier qu'il désigne bien ce
  qu'on cherchait** (`enrich/cover.ts : matches` — titre normalisé identique, artistes compatibles),
  et mémoriser les échecs pour ne pas re-poser la question toutes les dix secondes.
- **Leçon** : une API de recherche est une suggestion, pas une réponse. Le contrôle de correspondance
  fait partie de l'appel — sans lui, le code « marche » et affiche faux.

## 2026-09-11 — Un seuil calé sur l'affichage d'une autre appli

- **Symptôme** : la vue Énergie montrait un flux solaire et un flux réseau alors que l'appli du
  fabricant, ouverte à côté, affichait « 0,0 Production » et un réseau « Inactif ». Premier réflexe :
  monter le seuil « rien ne passe » de 20 à 100 W pour que les deux écrans se rejoignent.
- **Diagnostic** : faux, et vérifié en descendant d'un cran dans les données. Les micro-onduleurs
  rapportaient **1 à 3 W chacun**, tous `available` — quelques dizaines de watts de production bien réelle au crépuscule. Si
  l'appli du fabricant écrit « 0,0 », c'est qu'elle affiche des kW à une décimale : 47 W et 5 W y
  tombent au même endroit. C'est sa **résolution d'affichage**, pas une mesure. Le seuil à 100 W aurait
  effacé cette production, et aussi le soutirage mesuré la même nuit.
- **Solution** : seuil posé sur une quantité **mesurée dans nos propres données** — le désaccord entre
  les compteurs de la passerelle, de l'ordre de 0 à 11 W sur plusieurs relevés d'affilée — soit 10 W, et la mesure écrite
  dans le commentaire qui porte la constante (`apps/web/src/components/energy/EnergyFlow.vue`) pour que
  le chiffre ne reparte pas à l'intuition. La vraie erreur d'affichage était ailleurs : une **borne de
  recharge simulée** que le schéma mélangeait aux compteurs réels
  (`../3_plugins/3_0_simulation-mock.md`).
- **Leçon** : quand deux écrans divergent, la question n'est pas « comment les aligner » mais **lequel
  est le plus fin**. S'aligner sur un affichage arrondi, c'est jeter de l'information qu'on a déjà. Et
  un symptôme unique peut cacher deux causes indépendantes : la borne fantôme et la lecture des
  petites valeurs n'avaient rien à voir l'une avec l'autre.

## 2026-09-12 — Une position supposée qui survit à l'arrêt qui l'invalide

- **Symptôme** : un store banne RTS physiquement déployé à moitié, annoncé « Baissé » à 100 % par
  l'interface. Signalé par l'utilisateur sur son installation, pas par un test.
- **Diagnostic** : sur une radio unidirectionnelle, le plugin Somfy **déduit** la position des
  commandes de pleine course (`down` → 0). C'est juste tant que la course va jusqu'au bout. Le rappel
  de position favorite (`my`) effaçait déjà cette déduction devenue fausse, mais l'**arrêt** ne le
  faisait pas : il ne publiait que `motion: 'stopped'`, et la position de la commande précédente
  restait affichée comme un fait. Deux commandes invalident pourtant la même chose, et une seule avait
  été traitée.
- **Solution** : `cover.stop` efface la position au même titre que `cover.preset` sur un appareil sans
  retour (`apps/server/src/plugins/tahoma/index.ts`). Et côté UI, un ouvrant sans capacité `position`
  n'affiche plus de pourcentage du tout — seulement « Baissé » / « Remonté », qui reste vrai quelle que
  soit la course réelle.
- **Leçon** : quand on décide d'effacer une valeur devenue fausse, il faut faire le tour de **toutes**
  les commandes qui la rendent fausse, pas seulement de celle qui a motivé le correctif. Et une valeur
  déduite doit être affichée avec la grossièreté de sa source : un mot, pas un pourcentage.


## 2026-09-12 — Les volets rejouent leur course à chaque écriture dans la maison

- **Symptôme** : en déplaçant un champ de panneaux, tous les volets **fermés** de la maison
  s'ouvraient puis se refermaient. Signalé « au mouse down » par l'utilisateur.
- **Diagnostic** : ce n'était pas le geste. Une sonde posée sur `buildMarkers` a compté **0**
  reconstruction à l'appui et pendant le mouvement, **1** au dépôt. Toute écriture dans la maison
  rediffuse la maison entière, la vue appelle `updateDevices`, et **tous** les marqueurs sont
  reconstruits. Or un `CoverMarker` naît ouvert (sa lame est montée à 0) et son premier état le
  **tweene** vers sa position réelle sur 400 ms : c'est la course qu'on voyait. Le défaut existait pour
  tout placement enregistré ; le glissement d'un champ, qui écrit à chaque dépôt, l'a rendu voyant.
- **Solution** : la **première** position reçue s'applique sans animation (`posed`,
  `apps/web/src/three/markers/markers.ts`) ; une vraie course s'anime comme avant. Deux assertions
  dans `three.test.ts` : le premier état se pose sans dérouler les animations, le second s'anime.
- **Leçon** : quand une animation part toute seule, se demander d'abord **qui reconstruit l'objet**
  plutôt que ce que l'utilisateur vient de faire. Une sonde de dix lignes sur le constructeur répond en
  un geste, là où la lecture du code laissait trois hypothèses ouvertes. Et un état initial devrait se
  POSER : n'animer que ce qui change vraiment.

## 2026-09-12 — Un tap qui referme le réglage qu'on est en train de faire

- **Symptôme** : « le clic sur un panneau ne fait rien » — impossible de glisser un champ de panneaux,
  et la carte de réglage disparaissait sans qu'on comprenne pourquoi.
- **Diagnostic** : deux causes cumulées. La pilule d'un marqueur n'est transparente au pointeur que
  lorsqu'il est en mode « déplacer » (`data-moving`), et ce drapeau n'était posé que sur **un** module
  du champ : les autres avalaient le clic, qui devenait un tap, donc une **sélection** — et la
  sélection refermait le réglage. Ensuite, un clic tombé à côté (sur le toit, sur le fond) sélectionnait
  le niveau ou vidait la sélection, avec le même effet.
- **Solution** : tous les modules d'un groupe déplaçable portent `data-moving` (le guide, lui, reste
  sur un seul) ; et pendant le réglage d'un champ, les taps sur ses modules, sur le niveau qui le porte
  et sur le fond sont **sans effet** (`apps/web/src/views/HomeView.vue`). On est venu déplacer le
  champ, pas changer de sujet.
- **Leçon** : un mode d'édition doit décider ce que deviennent les gestes qui n'en font pas partie.
  Laisser passer le tap « normal » pendant une édition, c'est offrir un bouton « annuler » invisible.


### Mise à jour 2026-09-13 — trois pièges de la mise en route Tesla (vrai compte)

**Un domaine Tesla n'appartient qu'à une application.**
Date : 2026-09-13. Symptôme : `POST /api/1/partner_accounts` → 422 « Domain has already been taken »
(ou « Public key hash has already been taken »), puis toute lecture → 412 « Account … must be
registered in the current region », alors que la clé publique est bien servie sur le domaine.
Diagnostic : l'application avait été recréée sous un second compte développeur ; le domaine (et la
clé) appartenaient à la première. Solution : reprendre les identifiants de la première application —
n'importe quel compte Tesla peut ensuite consentir — ou la supprimer sur developer.tesla.com. Le
plugin `tesla` lit les deux 422 et dit lequel des remèdes s'applique. Source :
`apps/server/src/plugins/tesla/index.ts` (route `/register`), `3_plugins/3_8_tesla.md`.

**La clé rendue par Tesla n'est pas un PEM.**
Date : 2026-09-13. Symptôme : « Domaine enregistré, mais Tesla n'a pas lu notre clé » alors que le
domaine sert exactement la clé du serveur ; plugin `degraded`. Diagnostic :
`partner_accounts.public_key` est le **point EC non compressé en hexadécimal** (`04…`, 130
caractères) ; la comparaison de PEM ne pouvait qu'échouer. Solution : dériver le point de notre clé
(`createPublicKey(pem).export({ format: 'jwk' })` → X, Y) et comparer les hex
(`samePublicKey`, `apps/server/src/plugins/tesla/auth.ts`).

**Une carte de mise en route qui n'apparaît qu'après rechargement.**
Date : 2026-09-13. Symptôme : allumer le plugin dans Réglages → Plugins n'affiche pas sa carte de
mise en route tant que la page n'est pas rechargée. Diagnostic : la carte lisait
`devices.health.plugins.<id>`, relu de loin en loin, et guettait l'APPARITION de l'entrée — or
`/api/health` liste aussi les plugins éteints (`disabled`), l'entrée était déjà là. Solution : lire la
santé dans l'inventaire des plugins (`stores/plugins`, mis à jour par la réponse de l'interrupteur) et
réagir au changement de STATUT. Les cartes Enphase et Nest ont la même lecture par `/api/health`, à
vérifier au prochain passage. Source : `apps/web/src/components/TeslaLinkCard.vue`.

**Une image entièrement NOIRE, sans la moindre erreur en console.**
Date : 2026-09-15. Symptôme : la scène 3D ne rend plus que son fond ; la maison, les sols, le terrain
ont disparu, mais les pilules DOM des appareils sont bien là et la caméra est au bon endroit.
Diagnostic : le réglage `kasbah.sceneAmbience` contenait une valeur inattendue (`"night"` avec ses
guillemets, écrite à la main dans le localStorage — `useLocalStorage` sérialise une chaîne BRUTE).
`resolveAmbience` lisait alors `FIXED[mode]` → `undefined`, la hauteur du soleil devenait `NaN`, et
`dayFactor` propageait ce `NaN` jusqu'à `renderer.toneMappingExposure`. Une exposition `NaN` ne lève
rien : elle multiplie toute l'image par zéro. Solution : un mode inconnu retombe sur `auto` (le vrai
soleil) au lieu de produire une ambiance `NaN`, et un test l'épingle. Leçon plus large : toute valeur
qui finit dans un uniforme de shader mérite d'être validée à l'entrée, parce que l'échec y est
silencieux. Source : `apps/web/src/three/core/ambience.ts`.

**Un carré NOIR sous chaque lampe allumée.**
Date : 2026-09-15. Symptôme : depuis l'arrivée de l'occlusion ambiante, une tache sombre rectangulaire
apparaît sur le sol sous les lampes allumées — et seulement en qualité haute. Diagnostic : le halo
d'une lampe est un `Sprite` additif (`depthWrite: false`), invisible dans le rendu normal ; mais la
passe d'occlusion redessine la scène avec un matériau d'override pour relever profondeur et normales,
et ce matériau-là ÉCRIT la profondeur. Le halo devenait un panneau plein face à la caméra, donc un
obstacle, donc de l'ombre. Solution : le halo vit sur une couche dédiée (`DECOR_LAYER`,
`apps/web/src/three/core/layers.ts`) que `ArchitectureGTAOPass` éteint le temps de son relevé. Règle à
retenir : **tout décor additif ou transparent doit être exclu des passes qui relèvent la géométrie**.
Source : `apps/web/src/three/core/{layers,post}.ts`, `apps/web/src/three/markers/markers.ts`.

**Une maison qui se confond avec son ciel de nuit.**
Date : 2026-09-15. Symptôme : en ambiance « Nuit », la scène paraît vide — alors que tout est bien
rendu. Diagnostic : mesuré à la sortie de la courbe filmique, les murs éclairés par la lune tombaient
à 41 sur 255 et le fond du canvas à 45. Deux valeurs à quatre pas l'une de l'autre ne font pas une
silhouette. Solution, en deux temps : un ciel de nuit BEAUCOUP plus sombre (horizon linéaire 0,03 →
0,012) et une lune qui éclaire vraiment (0,25 → 1,1), plus un remplissage hémisphérique relevé — en
`auto`, la lune tombe où elle tombe et les faces qu'on regarde peuvent toutes être à l'ombre. Le
contraste d'une scène de nuit se règle entre ces deux valeurs, pas au jugé. Source :
`apps/web/src/three/styles/realistic.ts`.

**Un volet fermé qui laisse passer le soleil.**
Date : 2026-09-15. Symptôme : l'ouvrant est fermé, son tablier est bien dessiné dans l'embrasure, et
la tache de lumière se pose quand même sur le sol de la pièce. Diagnostic : la lame porte `castShadow`
— mais le rendu en passes masquait tous les marqueurs de niveau pendant la passe qui refait la carte
d'ombre, et three ne relève comme bloqueur que ce qui est VISIBLE au moment du rendu. Depuis
l'arrivée de ce rendu en passes, aucun appareil ne portait d'ombre (ni volet, ni voiture, ni coffret).
Solution : ne plus masquer les marqueurs, et sortir de la passe globale ce qui doit vraiment en
sortir — les lampes et les décors translucides — par des COUCHES (`DECOR_LAYER`, `LAMP_LAYER`), que
three teste aussi bien pour les lumières que pour le relevé d'ombre. Règle à retenir : **masquer un
objet pour l'exclure d'un éclairage l'exclut aussi de l'ombre** ; quand deux passes doivent voir la
scène différemment, c'est une couche qu'il faut, pas une visibilité. Source :
`apps/web/src/three/core/layers.ts`, `apps/web/src/three/HouseScene.ts` (`renderPasses`).

**Un composant enfant qui se branche sur une ressource que le parent n'a pas encore créée.**
Date : 2026-09-15. Symptôme : le voile de débogage affiche bien ses chiffres, mais les courbes de
`stats.js` restent figées — à moitié vivant, sans erreur. Diagnostic : Vue exécute le `onMounted`
des ENFANTS avant celui du parent. La scène 3D est construite dans le `onMounted` du parent
(`useHouseScene`) ; le `setProbe` de l'enfant, fait à son propre montage, s'appliquait donc à `null`.
Les chiffres, eux, marchaient : ils relisent la scène à chaque relevé. Solution : brancher au premier
relevé où la ressource existe, pas au montage. Règle : **un enfant ne peut pas supposer qu'une
ressource du parent existe à son montage** — s'y abonner, ou la relire. Source :
`apps/web/src/components/home/SceneDebug.vue`.

## 2026-09-15 — La vue Maison à 8 images par seconde : Chrome dessinait sur le GPU intégré

- **Symptôme** : sur une maison réelle, l'orbite plafonne à 8–18 img/s et « ça gonfle avec le temps »
  (40 puis 20 img/s). Le voile montre `rendu 3,6 ms` et `hors rendu 60 ms` ; changer la qualité ne
  semble rien faire ; le gestionnaire de tâches de Chrome affiche plus de 100 % de CPU pour l'onglet.
- **Diagnostic** : mesuré à la requête de temps GPU, une image « high » coûtait **93 ms de GPU** — le
  fil principal était libre à 90 %. Le portable est hybride (GPU intégré + GPU dédié) et Chrome, sans préférence Windows pour `chrome.exe`, dessinait sur le GPU intégré
  (`UNMASKED_RENDERER_WEBGL` = `ANGLE (… Graphics ...)`, sans le nom du GPU dédié). `powerPreference:
  'high-performance'` n'y change rien. Le poste dominant est le `GTAOPass` (qualité « high »), dont le
  coût ne dépend presque pas du nombre de pixels. L'iGPU partage l'enveloppe de puissance du CPU : sa
  cadence dérive sous charge (93 ms puis 30 ms une heure plus tard, même scène). Le garde-fou de
  qualité, qui chronométrait le CPU, ne voyait rien.
- **Solution** : côté machine, Paramètres → Système → Affichage → Graphiques → `chrome.exe` →
  Hautes performances (8,5 → 62 img/s, confirmé par l'utilisateur). Côté code, `detectQuality` lit le
  nom du GPU et part en « medium » sur un GPU intégré, et le garde-fou mesure le GPU
  (`EXT_disjoint_timer_query_webgl2`, médiane des images d'un geste). Pour vérifier sur une machine :
  `gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)` dans la
  console. Source : `apps/web/src/three/core/post.ts`, `../1_architecture/1_5_scene-3d.md` (undecies).

## Un clic dans une ligne de formulaire efface le choix qu'on vient de faire

- **Date** : 2026-09-16
- **Symptôme** : dans les paramètres d'un véhicule, on choisit une couleur dans la popup native, puis
  on clique dans la ligne « Couleur » pour en sortir. La popup se ferme, la croix « Effacer la
  couleur choisie » apparaît — et la couleur est aussitôt rendue, comme si on avait appuyé sur cette
  croix. Cliquer ailleurs qu'en travers de la ligne : aucun problème.
- **Diagnostic** : c'était bien la croix. La ligne est un `<label>` sans `for`, et un clic dans son
  vide active son **premier descendant étiquetable** — pas celui qu'on croit. Or la croix est un
  `<button>`, qui est étiquetable, et elle est placée AVANT le champ dans le DOM (la maquette la veut
  à gauche de la pastille). Le label transmettait donc le clic au bouton de remise à zéro. Le même
  piège dormait sur la ligne « Peinture », dont la croix précède aussi le `<select>`.
- **Solution** : `for` explicite sur les deux lignes qui portent une croix, avec un `id` dérivé de
  l'appareil (`tune-color-${descriptor.id}`) — plusieurs `VehicleTuning` pouvant coexister. Le label
  active alors le champ voulu, la croix ne répond plus qu'à un clic sur elle-même, et l'ordre visuel
  ne bouge pas. Vérifié : `row.control` renvoie bien l'`input[type=color]`, et un clic dans le vide
  de la ligne laisse la couleur en place.
- **Règle** : un `<label>` qui enveloppe un bouton EN PLUS de son champ a besoin d'un `for`. À
  défaut, mettre le bouton hors du label. Source :
  `apps/web/src/components/vehicles/VehicleTuning.vue`.

## 2026-09-17 — « 1 pas mesurés sur 24 » : un champ nommé `count` vole l'accord du pluriel

- **Date** : 2026-09-17
- **Symptôme** : un message pluralisé s'accorde sur le mauvais nombre. Ici « **1** pas mesuré**s**
  sur 24 » : le singulier réel (1 heure mesurée) prend la forme plurielle de 24. **Aucune erreur,
  aucun avertissement, rien en console** — le message s'affiche, simplement faux.
- **Diagnostic** : `getPluralIndex` de vue-i18n **préfère `named.count`, puis `named.n`**, au
  troisième argument de `t()`. Le résumé du graphique d'eau passait `{count}` pour le nombre de
  **colonnes** (24) et `measuredCount` (1) en troisième argument : le champ interpolé a
  silencieusement écrasé le pilote de l'accord. Le nom du champ décidait du pluriel sans que rien ne
  le signale.
- **Solution** : dans un message pluralisé, **`count` et `n` sont des noms réservés** — renommer le
  champ interpolé (`{steps}` ici). Sur un message non pluralisé (sans variantes séparées par `|`),
  ils restent inoffensifs : `water.referenceLegend` utilise `{n}` sans conséquence. Voir
  `../4_ui/4_2_theme-et-langues.md`.

## 2026-09-17 — « 9/12 pas mesurés » se lit comme une négation

- **Date** : 2026-09-17
- **Symptôme** : une mention parfaitement exacte est comprise à l'envers. « 9/12 pas mesurés »
  voulait dire « neuf pas de temps sur douze ont été mesurés » ; un lecteur français y lit « neuf
  douzièmes ne sont **pas** mesurés ».
- **Diagnostic** : **« pas » au sens d'intervalle entre en collision avec l'adverbe de négation**,
  et la place du mot (juste avant un participe passé) rend la lecture négative plus naturelle que la
  bonne. Aucun contexte ne rattrape l'ambiguïté, et le bug n'est pas visible pour qui a écrit la
  phrase en pensant « pas de temps ».
- **Solution** : ne jamais écrire « pas » au sens d'intervalle dans l'interface française —
  remplacer par **l'unité réelle** du pas (« 9 mois sur 12 mesurés », « 5 heures sur 24 mesurées »).
  Clés `water.measuredFragment.hours/days/months`. La règle vaut pour toute l'interface.

## 2026-09-17 — un appareil publié mais introuvable dans l'application

- **Date** : 2026-09-17
- **Symptôme** : l'API rend bien l'appareil (`GET /api/devices/comap:station` complet, plugin en
  bonne santé) et sa carte est écrite, mais il n'apparaît nulle part dans l'interface — donc
  impossible de le placer dans la maison.
- **Diagnostic** : un **nouveau kind** avait sa carte de contrôle, mais aucune **vue** ne le listait.
  La compilation ne dit rien : les `Record<DeviceKind, …>` exhaustifs couvrent les cartes et les
  icônes, pas l'existence d'un écran où l'appareil serait visible. Corollaire attrapé le même jour :
  `isOrientable` (`apps/web/src/lib/orientation.ts`) ignorait le kind, si bien que le maillage 3D
  suivait son `yaw` mais que le panneau n'offrait jamais de le régler — **faire tourner un maillage
  et rendre un appareil orientable sont deux choses distinctes**.
- **Solution** : pour un nouveau kind, compter **quatre** points et pas un seul — la carte, une vue
  et sa route, l'entrée de rail, et (s'il a une face) `isOrientable`. Voir
  `../4_ui/4_1_navigation-et-panneaux.md` et `../1_architecture/1_5_scene-3d.md`.

## 2026-09-18 — un réglage persisté qui repart à zéro à chaque rechargement

- **Date** : 2026-09-18
- **Symptôme** : le brouillon du banc de réglage de la lumière (`kasbah.sceneTuning`) se comportait
  parfaitement pendant toute une session — curseurs, préréglages, scène qui suit — mais ne survivait
  **pas au rechargement de la page** : l'interface revenait au réglage neutre sans rien dire.
- **Diagnostic** : `localStorage.getItem('kasbah.sceneTuning')` rendait la chaîne littérale
  **`[object Object]`**. `useLocalStorage` de VueUse **devine son sérialiseur d'après la valeur par
  défaut** ; une valeur par défaut `null` ne dit rien, il retombe donc sur le sérialiseur `any`, qui
  écrit `String(value)`. À la relecture, la chaîne n'est pas du JSON : le réglage repart au neutre.
  Rien dans les types ne prévient — `useLocalStorage<Partial<SceneTuning> | null>` compile et le
  `ref` se comporte correctement en mémoire, c'est **uniquement l'aller-retour par le stockage** qui
  perd l'objet. Les autres clés du projet n'étaient pas concernées : leur valeur par défaut est une
  chaîne, un nombre ou un booléen, dont le sérialiseur se devine.
- **Solution** : dire le sérialiseur quand la valeur par défaut est `null` —
  `useLocalStorage(clé, null, { serializer: StorageSerializers.object })`. Vérifié après
  rechargement : la clé contient du JSON et le brouillon revient. Corollaire tenu à l'écriture du
  code : une valeur relue du stockage se valide (`resolveTuning` + `safeParse`) et un contenu abîmé
  retombe au neutre **sans faire tomber la vue** — ce qui a permis de constater le bug sans écran
  blanc, mais l'a aussi rendu silencieux.

Sources : `apps/web/src/stores/settings.ts`, `apps/web/src/three/styles/tuning.ts`.

## 2026-09-18 — la molette ne zoome plus quand le curseur est sur une étiquette

- **Date** : 2026-09-18
- **Symptôme** : le zoom à la molette de la vue Maison marche, sauf par endroits. Sur une maison bien
  peuplée, il devient franchement intermittent — et comme les endroits morts se déplacent avec la
  caméra, le défaut paraît aléatoire. Constaté juste après l'ajout d'une passe d'image, donc
  naturellement attribué à elle.
- **Diagnostic** : rien à voir avec le rendu, et le défaut était **ancien**. Les étiquettes des
  appareils sont du DOM posé par `CSS2DRenderer` au-dessus du canvas ; une pilule est cliquable, donc
  `pointer-events: auto`, donc elle reçoit AUSSI les événements de molette. `OrbitControls` écoute le
  canvas : il ne les voit jamais. Les « endroits morts » sont exactement les pilules.
- **Solution** : la couche des étiquettes relaie l'événement `wheel` au canvas, position comprise
  (`HouseScene.forwardWheelFromLabels`) — le zoom vise toujours le curseur. **Seulement la molette** :
  un glissement parti d'une pilule est ambigu (c'est peut-être un appui), une molette sur une
  étiquette ne l'est pas.
- **La leçon de méthode**, elle, vaut plus que le correctif : un défaut remarqué juste après un
  changement n'en vient pas forcément. Il s'est démontré en **éteignant l'effet soupçonné** et en
  mesurant la distance caméra avant/après un cran de molette — identique sur une pilule (30,067 →
  30,067), franche à côté sur le canvas (34,005 → 30,067). Une mesure coûte quelques minutes ; croire
  le mauvais coupable coûte une réécriture.

## 2026-09-18 — un réglage qui n'a aucun destinataire, et qui a l'air de marcher

- **Date** : 2026-09-18
- **Symptôme** : dans Réglages → Rendu 3D, choisir « Haute » ou « Basse » pour la qualité ne change
  rien à l'image. Le choix est bien retenu d'un rechargement à l'autre.
- **Diagnostic** : `settings.sceneQuality` n'était lu nulle part. Le store le déclarait, le
  `Segmented` de `views/SettingsView.vue` l'affichait et le validait, mais aucun appel ne le passait
  à la scène : `useHouseScene` n'appelait `scene.setOptions()` que **si son appelant lui fournissait
  des `options`**, et `HomeView.vue` ne lui en fournit pas. `HouseScene` gardait donc la valeur de
  son champ `options`, `quality: 'auto'`.
- **Ce qui l'a caché deux semaines** : sur cette machine, `auto` détecte `medium`. « Moyenne »
  marchait donc par coïncidence, et l'écart entre les autres niveaux est un halo de lampe et un
  crénelage — pas de quoi accuser un réglage plutôt que ses yeux. Le typage était content
  (`setOptions` prend un `Partial`), les tests aussi (ils appellent `setOptions({ quality })`
  directement sur la scène : le contrat est vérifié, **le câblage ne l'est pas**).
- **Solution** : `useHouseScene` pousse le réglage lui-même, au montage et par un `watch`, comme il
  le fait pour la projection. Vérifié dans le navigateur au voile de débogage : `low` ne construit
  **aucune** chaîne d'image (`post` reste `null`, 262 appels de dessin), `medium` en construit une
  sans occlusion ambiante (277), `high` la chaîne complète en 3 passes (369).
- **Règle** : un réglage ajouté au store n'est pas fini quand l'écran le montre. Le chemin
  `store → destinataire` est la moitié du travail, et c'est celle qu'aucun test de contrat ne
  couvre. Quand la valeur par défaut est `auto` — c'est-à-dire « quelque chose de raisonnable » — un
  réglage mort est indiscernable d'un réglage vivant ; chercher la lecture, pas l'effet.

## 2026-09-19 — Trente-deux `.tmp` dans `.state`, et la récidive qu'ils signalaient

- **Symptôme** : `apps/server/.state/` accumulait des fichiers intermédiaires — 31
  `comap-consumption.json.<pid>.tmp` sur deux jours, plus un `google-cast-devices.json.28644.tmp`
  du 2026-09-11. Lus comme un défaut d'écriture ou de nettoyage.
- **Ce que les fichiers disaient** : tous contenaient du **JSON complet et valide**. L'écriture
  réussissait donc, et seul le `rename` final manquait. Un test de 300 cycles écriture+renommage
  dans ce même dossier n'a produit aucun échec (~1 ms par cycle) : ni le disque ni Windows n'étaient
  en cause.
- **Diagnostic** : un `.tmp` contenait `{ t: 16/09, litres: 412 }` — la valeur exacte de la fixture
  `plugins/comap/__fixtures__/station.ts`, absente du vrai fichier. Vérification par empreinte md5
  du dossier avant/après un `vitest run` complet : la suite **modifiait réellement**
  `comap-consumption.json` et `melcloud-history.json`, en y ajoutant ses points de fixture. Les dix
  clés `*_FILE` des plugins avaient pour défaut le vrai chemin du dépôt ; un test qui appelle
  `plugin.init()` sans injecter de store **chargeait l'état réel** et le réécrivait. Et comme la
  sauvegarde est en « feu et oubli » (`void historyStore?.save(history)`, `plugins/comap/index.ts`),
  le worker vitest sortait parfois entre le `writeFile` et le `rename` : un `.tmp` par worker tué,
  donc un par pid, jamais réécrit ni supprimé par personne.
- **C'est la même leçon qu'au 2026-09-10** (« Les tests écrivaient le fichier d'état réel du
  poste »), appliquée alors au seul `CAST_KNOWN_FILE` par une chaîne vide dans le contexte de test.
  La discipline était par plugin ; les six plugins écrits depuis ne l'ont pas reprise. **Une règle
  qui demande d'être réappliquée à chaque nouveau fichier finit par ne plus l'être.**
- **Solution** : le dossier d'état devient déplaçable (`core/paths.ts`, variable
  `KASBAH_STATE_DIR`) et `apps/server/test/state-isolation.ts`, chargé en `setupFiles` avant
  **chaque** fichier de test, le pointe vers `%TEMP%/kasbah-test-state/<pid>` puis le supprime en
  `afterAll`. Plus aucune liste à tenir : une clé `*_FILE` ajoutée demain est neutralisée sans que
  son auteur ait à y penser.
- **Vérifié** : empreintes des dix fichiers de `.state` identiques avant et après une suite
  complète (485 tests serveur), aucun `.tmp` créé, aucun dossier temporaire résiduel.
- **Reste ouvert** : la sauvegarde en « feu et oubli » n'a pas été touchée. Un vrai serveur tué
  entre les deux opérations peut encore laisser un `.tmp` — beaucoup plus rarement, les workers
  vitest étant la source massive.
- **Leçon** : des fichiers qui traînent sont une **trace**, pas la panne. Ici ils dataient et
  signaient le coupable (un pid par worker, un contenu portant la fixture) ; le vrai dégât, invisible,
  était l'état de production réécrit par la suite de tests.

## 2026-09-19 — Un champ de contrat tout neuf reste invisible : `tsx watch` ne voit pas `packages/shared`

- **Symptôme** : une capacité (`mop`) et deux champs d'état (`mopAttached`, `tankLevel`) venaient
  d'être ajoutés à `packages/shared/src/devices/{kinds,state}.ts`, et le mappage du plugin iRobot
  venait d'être écrit pour les publier. Le serveur de développement tournait. **Rien n'apparaissait
  côté appareil** : capacité absente du descripteur, champs absents de l'état — et **aucune erreur**,
  ni au serveur, ni dans la console du navigateur, ni dans `GET /api/devices`.
- **Diagnostic** : `apps/server` tourne en `tsx watch` (`apps/server/package.json`), qui surveille
  les fichiers du serveur. `@kasbah/shared` est un **lien de workspace** : le rechargement à chaud ne
  le suit pas. Le processus continuait donc de tourner avec **l'ancien contrat chargé en mémoire**,
  et le plugin faisait consciencieusement son travail contre lui : un patch dont les clés
  n'appartiennent pas au schéma du kind est **filtré sans bruit** par le registre, et une capacité
  inconnue ne se déclare pas. Tout se comportait comme un mappage qui ne marche pas.
- **Ce qui rend le piège coûteux** : il **ressemble exactement à un bug qu'on vient d'écrire**. Le
  premier réflexe est de relire le mappage, d'ajouter des traces, puis de soupçonner l'appareil — on
  cherche dans le code qui est juste, pendant que le code qui tourne n'est pas celui qu'on lit.
- **Solution** : **redémarrer le serveur à la main** après toute modification de `packages/shared`
  (ou de tout autre workspace lié). Rien n'a été automatisé ici.
  *(Dépassé le 2026-09-23 : le serveur de développement ne tourne plus en `tsx watch` mais en `node --watch --import tsx` (`apps/server/package.json`), qui redémarre aussi sur une modification de `packages/shared` — voir « `tsx watch` bloqué sous `concurrently` par le SDK MCP v2 » dans `6_0_pieges-outillage.md`. Le redémarrage à la main ne s'impose plus ; le piège d'un contrat chargé en mémoire reste vrai pour un serveur lancé sans surveillance, comme `npm run house`.)*
- **Le test qui tranche en trente secondes** : vérifier le contrat **hors serveur**, en rejouant le
  mappage sur une ombre réelle par un petit script `tsx` jetable (c'est ce qui a été fait,
  `verif-mappage.ts` de la session). S'il rend les champs attendus alors que le serveur ne les montre
  pas, **le code est bon et c'est le processus qui est périmé**. Cette dissociation est ce qui a fait
  gagner du temps.
- **Leçon plus générale** : un rechargement à chaud qui ne couvre qu'une partie du monorepo est plus
  dangereux que pas de rechargement du tout — il fait croire que ce qu'on voit est à jour.
## 2026-09-19 — « Votre compte est bloqué pour au moins 1 h » : les actions Renault ont leur propre quota

- **Symptôme** : en plein diagnostic du réveil de charge, `actions/charging-start` répond **HTTP
  429** — alors qu'une lecture `battery-status` envoyée juste après passe sans broncher. Peu après,
  l'**appli MY Renault de l'utilisateur** affiche « trop d'appels serveur, votre compte est bloqué
  pour une durée d'au moins 1 h ».
- **Diagnostic** : les **actions** (`actions/hvac-start`, `actions/charging-start`) et les
  **lectures** ne puisent pas au même seau. Quatre minutes séparaient les deux actions, et c'était
  déjà trop ; au même moment les lectures, bien plus nombreuses, passaient toutes. Le 429 ne dit
  donc rien de la cadence globale : il ne parle que de la famille d'endpoints qu'on vient
  d'employer.
- **Le piège dans le piège** : le seau à jetons du plugin (`RENAULT_RATE_PER_HOUR`, 60 appels/h,
  cf. `../3_plugins/3_9_renault.md`) compte **les appels du processus**. Le budget, lui, est celui
  du **COMPTE**. Un script de diagnostic lancé à côté du serveur a son propre seau, et **les deux
  s'additionnent** chez Renault — c'est très exactement ce qui s'est produit ce jour-là. Un
  garde-fou local ne protège que de lui-même.
- **Ce que ça coûte** : le blocage ne prive pas seulement Kasbah. Il prive **l'utilisateur de son
  appli mobile** pendant une heure, sur une voiture qu'il voudrait justement faire charger.
- **Règle à retenir** : sur une API de fabricant sans documentation de quota, un diagnostic manuel
  se mène **serveur arrêté**, ou pas du tout. Et une intégration ne doit jamais supposer qu'elle
  est seule à consommer le budget de son compte.

## 2026-09-19 — Des heures de réveils refusés, et rien nulle part pour le dire

- **Symptôme** : la voiture est branchée, du surplus solaire est disponible, et la charge ne
  démarre pas. Côté interface, tout va bien : le plugin est lié, la santé est `ok`, la carte des
  Réglages ne signale rien.
- **Diagnostic** : ce qui est ÉTABLI, c'est qu'aucune commande de réglages n'a abouti après un certain instant
  (`lastSettingsUpdateTimestamp` figé), et que les réveils rejoués à la main ce jour-là ont tous été
  refusés en HTTP 409, « une commande est déjà en attente » (cf. `../3_plugins/3_9_renault.md`). Que
  le plugin ait essuyé les mêmes refus tour après tour est une **reconstruction** : la console du
  serveur n'a jamais été relue — et c'est précisément le problème, elle était le seul endroit où
  l'échec s'écrivait. Pendant ce temps l'UI affichait « lu il y a 4 min » au-dessus de chiffres de
  trois heures d'âge, parce que `readAt` datait notre appel et non la donnée du fabricant.
- **C'est le pendant du piège du 2026-09-18** (« un réglage qui n'a aucun destinataire, et qui a
  l'air de marcher ») : ici le destinataire existe, mais **le compte rendu n'en a pas**. Une
  fonction qui écrit chez un tiers et dont on ne voit jamais le résultat est indiscernable d'une
  fonction qui marche — tant que l'utilisateur ne regarde pas son surplus se perdre.
- **Solution** : `WakeOutcome` (`sent` / `deferred` / `failed` + détail) rendu par
  `GET /api/plugins/renault/status` et affiché par `RenaultLinkCard.vue` ; `isDeferred()` qui
  sépare « pas maintenant » de « en panne » pour que le `warn` retrouve un sens ; et `readAt` pris
  sur l'horodatage du constructeur pour que l'âge de la donnée cesse de mentir.
- **Règle** : toute action qu'un plugin déclenche **seul**, sans qu'un geste de l'utilisateur
  l'attende, doit laisser une trace lisible **dans l'UI**. Le journal serveur n'est pas un
  destinataire : personne ne le lit avant d'avoir un symptôme.

## 2026-09-20 — Une TV Cast : `LAUNCH` du récepteur média timeout à 5 s

- **Symptôme** : `media_player.play_url` sur une TV répond `TIMEOUT` — « LAUNCH on … timed out after 5000 ms ». Un Nest Mini et une barre de son OK sur la même URL.
- **Diagnostic** : `playUrl` envoie `LAUNCH` du récepteur par défaut (`CC1AD845`) puis attend l'accusé dans le délai de commande (5 s). Une TV qui sort de veille peut démarrer plus lentement ; le second essai, TV déjà réveillée, réussit.
- **Solution (constat)** : retenter ; ne pas confondre avec un échec de `LOAD`. Piste non codée : allonger le délai de `LAUNCH` seul, ou préchauffer le récepteur.
- **Règle** : un timeout Cast sur TV n'est pas forcément un refus de l'URL — mesurer si le `LAUNCH` aboutit avant de blâmer le flux.

## 2026-09-22 — onglet de niveau : l'appareil sélectionné annulait le niveau demandé

- **Symptôme** : appareil sélectionné, clic sur un autre onglet de niveau → l'objet semble quitter la sélection, le niveau choisi ne s'affiche pas (la scène reste sur l'étage de l'appareil).
- **Diagnostic** : `setFloorTab` mettait à jour `focusedLevelId` et pouvait vider `selectedRoomId`, mais gardait `selectedKey`. Le watcher `selectedRoomId` / `selectedKey` rappelait `frameSelection` → `focusDevice` → `focusLevel` de la pièce de l'appareil, qui écrasait le niveau de l'onglet.
- **Solution** : `setFloorTab` désélectionne l'appareil (`selectedKey = null`) sauf en mode Déplacer (le sélecteur Emplacement seul change alors de niveau).
- **Règle** : un onglet de niveau NAVIGUE ; il ne doit pas laisser une sélection fine (`selectedKey`) capable de recadrer la caméra contre lui.

Sources : `apps/web/src/stores/house.ts`, `apps/web/src/views/HomeView.vue`.

## 2026-09-22 — voiture sous le plancher d'un étage focalisé

- **Symptôme** : 1er affiché, tap dans une pièce de l'étage au-dessus d'une voiture garée → sélection de la voiture du RDC ; sa pilule perce le parquet.
- **Diagnostic** : (1) GPS + place sans `levelId` → `outdoorMarkers`, pilules jardin toujours allumées ; (2) `pick` prenait l'appareil sans comparer la distance au sol plus proche.
- **Solution** : parentage au niveau de la place (`markerLevelId`) ; occlusion appareil vs sol/toit ; masquage des pilules outdoor sous le plancher focalisé.
- **Règle** : un marqueur « dehors » qui se range dans un niveau doit suivre ce niveau ; un tap ne sélectionne jamais ce qui est derrière le plancher qu'on voit.

Sources : `apps/web/src/three/HouseScene.ts`, `../1_architecture/1_5_scene-3d.md`.

## 2026-09-22 — Tesla : couleur perso perdue au redémarrage si la voiture dort

- **Symptôme** : après redémarrage serveur, Tesla endormie → carrosserie en couleur de thème dans la 3D (plus la teinte du Coloriseur).
- **Diagnostic** : `paint_color_override` n'est que dans `vehicle_data` ; `VehicleTrack.paint` n'était pas écrit dans `TESLA_STATE_FILE`.
- **Solution** : champ `paints` dans le cache d'état, restauré à la liste.
- **Règle** : tout ce qu'une lecture chère révèle et qu'une liste gratuite omet doit survivre au redémarrage si l'UI l'affiche au repos.

Sources : `apps/server/src/plugins/tesla/state.ts`, `../3_plugins/3_8_tesla.md`.

## 2026-09-22 — l'enceinte joue une radio, Kasbah affiche encore notre morceau

- **Symptôme** : titre lancé depuis la page Musique, puis radio lancée à la voix depuis Google Home
  sur la même enceinte. La page continue d'afficher **notre** titre, **notre** durée, et propose de
  transférer ce morceau vers une autre pièce.
- **Diagnostic** : une session du proxy (`StreamProxy`) ne sait rien de ce que l'enceinte fait
  ensuite. Elle vit tant que son TTL (1 h) court, et `GET /sessions` la rendait telle quelle. Un
  transfert aurait relancé un morceau que personne n'écoutait plus.
- **Solution** : `sessionActive()` (`apps/server/src/plugins/ytmusic/index.ts`) confronte la session à
  l'**état publié du lecteur** : il doit jouer ou être en pause, et son titre doit être le nôtre ou
  **illisible** (identifiant hexadécimal de 24 caractères, URL — une enceinte n'en sait pas plus sur
  un flux HTTP). Les **5 premières secondes** sont accordées d'office, le temps que l'état suive la
  commande. Le filtre s'applique à `/sessions`, `/transfer` et `/seek`.
- **Corrigé le 2026-09-22 (après-midi)** : le filtre existe toujours et n'a pas changé, mais deux
  chiffres de ce diagnostic ont bougé avec le nouveau modèle de flux — le **TTL d'une session est
  passé de 1 h à 6 h** (un mix de plusieurs heures doit rester servable) et la route `POST /seek`,
  citée dans la solution, **n'existe plus** : le filtre s'applique désormais à `/sessions` et
  `/transfer`. Le TTL plus long rend d'ailleurs ce piège **plus probable**, pas moins.
- **Règle** : un objet de session côté serveur n'est **pas** une preuve que l'appareil joue encore.
  La preuve est dans l'état publié par l'appareil — et quand cet état est pauvre (un flux HTTP n'a
  pas de titre), c'est la **pauvreté elle-même** qu'il faut accepter comme signe, pas l'absence de
  contradiction.

Sources : `apps/server/src/plugins/ytmusic/index.ts`, `../3_plugins/3_16_ytmusic.md`.

## 2026-09-22 — une requête arrivée pendant un redémarrage `tsx` tourne avec les défauts

- **Symptôme** : au premier essai de lecture juste après une modification du serveur, « yt-dlp
  introuvable » ou une URL de flux en `localhost` — alors que la configuration est bonne et que
  l'essai suivant passe.
- **Diagnostic** : `tsx` peut recharger un module et **réenregistrer ses routes sans repasser par
  `init()`**. Avant, le plugin ytmusic plantait carrément (`proxy!` à `null`) ; depuis que tout ce
  que `init()` construisait se reconstruit à la demande (`getProxy()`, `cfg()`, `now()`, `log()`), il
  ne plante plus — mais `cfg()` rend alors les **défauts du schéma zod** : `YTM_YTDLP_PATH` =
  `yt-dlp`, `YTM_PUBLISH_BASE` vide.
- **Solution** : aucune côté code (le repli est volontaire, il vaut mieux qu'un crash). Côté
  utilisation : **attendre que `/status` réponde** avant de conclure quoi que ce soit d'un essai
  lancé dans la fenêtre de redémarrage.
- **Revu le 2026-09-22 (après-midi)**, le piège tient toujours et se précise : la requête peut
  tomber sur le **processus mourant**. `stop()` du plugin vide le proxy (`proxy.clear()`) et remet
  `ctx`, `config` et le catalogue à `null` ; la reconstruction à la demande repart alors aux défauts,
  d'où le `spawn yt-dlp ENOENT` quand le binaire n'est pas sur le PATH. Les sessions de flux en cours
  sont perdues avec le proxy : l'enceinte redemande un « fichier » dont le `sid` n'existe plus et
  reçoit un 404. Même consigne, à la lettre : **attendre que `/status` réponde APRÈS le
  redémarrage** — une réponse obtenue avant ne prouve rien, c'est peut-être l'ancien processus.
- **Règle** : un repli sur les défauts transforme un plantage en **résultat faux** ; il faut alors un
  moyen de savoir qu'on est dans le repli — ici, `/status`.
- *(Constat du lint du 2026-10-06 : entrée historique, d'avant le 2026-09-23. Le proxy de flux et la base publiée ne sont plus dans le plugin ytmusic : `getProxy()` n'existe plus, le proxy est dans `apps/server/src/music/proxy.ts` et la clé `MUSIC_PUBLISH_BASE` (`YTM_PUBLISH_BASE`, ancien nom, n'étant plus lue qu'en repli) dans `apps/server/src/music/player.ts`. Le principe — un repli sur les défauts transforme un plantage en résultat faux — reste valable.)*

Sources : `apps/server/src/plugins/ytmusic/index.ts`, `../3_plugins/3_16_ytmusic.md`.

## 2026-09-22 — le compteur recule à la pause, puis se remet en place

- **Symptôme** : pause d'un morceau → le temps affiché **saute en arrière** d'une à deux secondes,
  puis revient à la bonne valeur au relevé suivant.
- **Diagnostic** : l'appareil ne pousse pas sa position, le plugin la relit toutes les dix secondes
  (*correctif 2026-09-22 soir : dix secondes pour un Cast, `DEFAULT_MEDIA_POLL_MS` ; deux pour un
  Sonos, `SONOS_POLL_MS`*).
  Au moment de la pause, le dernier relevé date d'**avant** le geste (jusqu'à 2 s de retard sur un
  Sonos). Adopter ce chiffre comme nouveau repère faisait reculer le compteur.
- **Solution** : `useMediaPosition` (`apps/web/src/composables/useMediaPosition.ts`) fige la position
  **nette** au passage lecture → pause (`pos: local()`), et, en pause, **ignore** un relevé qui
  s'écarte de moins de 2,5 s (`PAUSED_REANCHOR_S`) — au-delà, c'est un vrai déplacement (seek,
  transfert) et il faut le suivre.
  *(Renommé : `PAUSED_REANCHOR_S` s'appelle `MEDIA_POSITION_SLACK_S`, exportée — voir le complément de la fin d'après-midi plus bas.)*
- **Règle** : quand une valeur est **avancée localement** entre deux relevés, l'arrivée d'un relevé
  n'est pas forcément une correction : c'est peut-être une donnée plus vieille que ce qu'on affiche.
- **Toujours vrai après le changement de modèle du flux** (le proxy ytmusic servant désormais un
  « fichier » de taille connue, `../3_plugins/3_16_ytmusic.md`) : ce piège n'est pas un piège de
  flux mais un piège de **sondage**, et il vaut pour n'importe quel lecteur, Cast compris.
  `useMediaPosition` n'a pas été touché.

Sources : `apps/web/src/composables/useMediaPosition.ts`, `../4_ui/4_0_langage-visuel.md`.

### Complément 2026-09-22 (fin d'après-midi) — et le pouce du curseur qui repasse par l'ancienne position

L'entrée ci-dessus reste vraie **côté cause** (un relevé plus vieux que ce qu'on affiche). Le même
retard de sondage produit un second symptôme, sur le geste de déplacement cette fois :

- **Symptôme** : on clique à 2:00 dans le curseur du lecteur ; la lecture « passe par un autre
  endroit » avant la cible — le pouce revient brièvement à l'ancienne position, puis rejoint 2:00.
- **Diagnostic** : trois positions se succèdent pour un seul geste. La **mise à jour optimiste**
  écrit la cible (`apps/web/src/lib/optimistic.ts`), le plugin publie ensuite un relevé **d'avant le
  geste** (`SONOS_POLL_MS`, défaut 2 s), puis le vrai relevé arrive. Une tenue relâchée au
  **premier** relevé reçu — ce que faisait la barre Musique — cède donc au relevé périmé.
- **Solution** : `useSeekHold` (`apps/web/src/composables/useMediaPosition.ts`) garde la cible
  affichée tant que la position publiée n'est pas **plus proche de la cible que du point de départ**.
  Comparer au point de départ, et non à une distance fixe, est ce qui fait tenir aussi un
  déplacement d'une seconde face à un relevé stagnant. Changer de lecteur relâche.
- **Règle** : quand on affiche une valeur **demandée** en attendant sa confirmation, la condition de
  sortie doit être « le porteur de vérité s'est rapproché de ce que j'ai demandé », pas « un message
  est arrivé ».
- **Renommage** : la marge de 2,5 s de l'entrée précédente s'appelle désormais
  `MEDIA_POSITION_SLACK_S` et est **exportée** (avant : `PAUSED_REANCHOR_S`, privée), pour que le
  test cite la même constante que le code.
- **Précision de chiffre** : le diagnostic de l'entrée précédente dit « toutes les dix secondes ».
  C'est le rythme de **Cast** (`DEFAULT_MEDIA_POLL_MS`) ; **Sonos sonde à 2 s** (`SONOS_POLL_MS`).
  Le piège est le même dans les deux cas, la fenêtre n'a pas la même largeur.
- **L'écho optimiste** : la mise à jour optimiste du store (`lib/optimistic.ts`) pose la cible
  exacte AVANT tout relevé, et satisferait aussitôt la condition de sortie — la tenue tombait avant
  l'arrivée du relevé périmé. D'où une **tenue minimale** `SEEK_HOLD_MIN_MS` (2 s, l'écho ne compte
  pas) et une **tenue maximale** `SEEK_HOLD_MAX_MS` (8 s, un lecteur qui ne confirme jamais ne fige
  pas le curseur). Couvert par le test « ignores the optimistic echo ».

Sources : `apps/web/src/composables/useMediaPosition.ts` + `useMediaPosition.test.ts`,
`apps/web/src/components/{music/MusicPlayerBar,controls/MediaPlayerControl}.vue`,
`apps/web/src/lib/optimistic.ts`, `../1_architecture/1_4_app-web.md`.

## 2026-09-23 — un `v-select` s'étire sur toute la hauteur d'une colonne

- **Date** : 2026-09-23
- **Symptôme** : dans l'éditeur d'automatisation en trois colonnes, un champ de liste Vuetify occupait
  toute la hauteur restante de sa colonne au lieu de sa hauteur de champ.
- **Diagnostic** : la colonne (`.col`) est un conteneur `display: flex; flex-direction: column`, et
  un `v-select` porte `flex: 1 1 auto` (pensé pour grandir en LARGEUR dans une rangée) : dans une
  colonne, ce même `flex` le fait grandir en HAUTEUR.
- **Solution** : `.col > * { flex: 0 0 auto }` sur la colonne, dans
  `apps/web/src/components/automations/AutomationEditor.vue`. À reprendre pour tout conteneur flex
  vertical qui reçoit des champs Vuetify. Contexte : `../4_ui/4_1_navigation-et-panneaux.md`, mise à
  jour (20) du 2026-09-23.

## 2026-09-25 — changer de niveau fige la 3D deux secondes, la première fois seulement

- **Date** : 2026-09-25
- **Symptôme** : premier clic sur « RDC » après le chargement : l'image se fige ~2,2 s sur un iGPU,
  puis tout est fluide, y compris les allers-retours suivants.
- **Diagnostic** : three compile un programme par combinaison de paramètres, dont le **nombre de
  lumières** (`numPointLights`). Masquer l'étage (`group.visible = false`) retirait ses lampes du
  compte : toutes les matières demandaient un nouveau programme, compilé de façon synchrone au
  `render()` suivant. Le cache évite la seconde fois, d'où « la première fois seulement ». Mesuré en
  chronométrant la première image après `focusLevel` avec `gl.finish()`.
- **Solution** : garder le compte constant — `HouseScene.padLamps` remplace chaque lampe masquée par
  une `PointLight` éteinte (`apps/web/src/three/HouseScene.ts`). Même règle pour toute idée qui
  ferait apparaître ou disparaître des lumières : jouer sur `intensity`, jamais sur `visible`.

## 2026-09-25 — une vignette coûte 2,8 ms : le composer a cloné la cible MSAA

- **Date** : 2026-09-25
- **Symptôme** : sur un iGPU, chaque passe plein écran de la chaîne d'effets (vignette, sortie,
  tilt-shift) coûte ~2,8 ms, le bloom ~5 ms — des shaders triviaux.
- **Diagnostic** : `new EffectComposer(renderer, target)` avec une `target` à `samples > 0` : le
  composer **clone** cette cible pour son second tampon. Toutes les passes écrivent donc dans du
  MSAA demi-flottant et le résolvent. Mesuré par requête GPU autour de chaque `pass.render`
  (`_generated-ai-doc/perf/kasbah-passes.mjs`), puis en passant `samples = 0` aux deux tampons à chaud.
- **Solution** : cible du composer sans MSAA ; le MSAA dans une cible propre à la passe de scène,
  recopiée une fois (`ScenePass`, `apps/web/src/three/core/post.ts`). 22 → 11,6 ms par image.

## 2026-09-25 — la précompilation des shaders ne fait rien gagner : une image est rendue avant

- **Date** : 2026-09-25
- **Symptôme** : `compileAsync` en place, mais le chargement fige toujours la page ~9 s (cache froid,
  iGPU) ; une tâche longue pleine d'attentes `getProgramInfoLog` (jusqu'à 2 s chacune).
- **Diagnostic** : la boucle de rendu dessine une image dès `load()`, avant la fin des compilations
  parallèles : three compile alors tout de façon synchrone à cette image. Relevé par une frise injectée
  avant l'application (`Page.addScriptToEvaluateOnNewDocument`, `_generated-ai-doc/perf/preload-timeline.js`).
- **Solution** : ne rendre aucune image pendant la préparation (`HouseScene.holdFrames`). Fil principal
  bloqué : 11 s → 1,4 s.

## 2026-09-25 — le voile de chargement reste affiché : `compileAsync` ne se résout jamais

- **Date** : 2026-09-25
- **Symptôme** : une fois sur plusieurs chargements, le voile reste sur « Compilation des shaders ».
- **Diagnostic** : la boucle d'attente de `WebGLRenderer.compileAsync` (three 0.185) lit
  `properties.get(material).currentProgram.isReady()` sans garde. Une matière détruite pendant
  l'attente (les marqueurs se reconstruisent quand les descripteurs arrivent) lève une erreur dans son
  `setTimeout` : la boucle meurt, la promesse reste en suspens.
- **Solution** : `renderer.compile` puis une attente maison qui ignore les matières disparues, plafonnée
  (`HouseScene.shadersReady`).

## 2026-09-25 — un texte en `<Transition>` ne s'affiche pas pendant une compilation

- **Date** : 2026-09-25
- **Symptôme** : le sous-titre « Compilation des shaders » du voile n'apparaît jamais à l'écran, alors
  qu'il est dans le DOM.
- **Diagnostic** : une `<Transition mode="out-in">` attend la fin de la sortie puis une image pour
  lancer l'entrée ; pendant les compilations, le fil principal n'en donne pas — le texte restait à
  l'état « enter-from » (invisible), puis l'étape suivante le remplaçait.
- **Solution** : fondus en CSS pur (animation d'entrée, transition de sortie posée par minuterie) et
  une image peinte (`nextPaint`, deux `requestAnimationFrame`) avant de lancer une étape lourde. Piège
  voisin : `animation: … both` garde l'opacité de fin et annule un fondu de sortie posé ensuite ; il
  faut `backwards`.

## 2026-09-25 — curseur de visibilité qui fige la vue 3D : le brouillard qui apparaît recompile tout

- **Date** : 2026-09-25
- **Symptôme** : dans les Réglages, « Météo forcée », faire descendre la visibilité gèle l'image
  plus de deux secondes ; les autres curseurs accrochent au glissement.
- **Diagnostic** : `HouseScene.applySky` faisait `scene.fog = far === null ? null : new Fog(…)`. Sous
  5 km de visibilité, `scene.fog` passait de `null` à un `Fog` : three garde une variante de programme
  AVEC et une SANS brouillard, et recompile alors **toutes** les matières de la scène — 2,1 s d'image
  figée mesurées. En plus, chaque cran de curseur envoyait une ambiance, qui refait le ciel (~35 ms).
- **Solution** : un `Fog` toujours posé, rejeté à `NO_FOG_M` = 1e6 m quand l'air est clair, dont on ne
  change que couleur, `near` et `far` (117 ms + 4 ms d'image à l'apparition du brouillard, pluie /
  neige / orage 50-80 ms, programmes stables) ; `watchThrottled` à 100 ms sur l'ambiance
  (`useHouseScene`). Règle générale : dans three, ce qui existe ou non (brouillard, nombre de
  lumières — cf. `padLamps`) change le programme ; ce qui varie doit être un **réglage** d'un objet
  toujours présent.
- **Source** : `apps/web/src/three/HouseScene.ts` (`applySky`), `apps/web/src/composables/useHouseScene.ts` ;
  mesures du thread principal. Voir `../1_architecture/1_5_scene-3d.md`, section 2026-09-25 (octies).

## 2026-09-25 — murs extérieurs qui scintillent en « sel et poivre » : une limite de masque posée sur une surface

- **Date** : 2026-09-25
- **Symptôme** : pièce mise en valeur (le reste de la maison assombri), les murs extérieurs de la
  pièce se couvrent d'un grain clair / sombre qui scintille au moindre geste de caméra ; surtout
  visible sur le crépi, clair et en relief. Repéré par l'utilisateur sur capture.
- **Diagnostic** : le masque de `core/roomFocus.ts` prenait le contour du sol élargi d'**exactement**
  l'épaisseur du mur extérieur. La face extérieure du mur tombait donc pile sur la limite du
  point-dans-polygone : à la précision flottante près, chaque pixel basculait dedans ou dehors, et
  la décision changeait à chaque image. La matière n'y était pour rien.
- **Solution** : une marge `ROOM_FOCUS_MARGIN_M` = 0,12 m ajoutée à l'élargissement (et au haut de la
  tranche) : la limite tombe dans le vide, au-delà du mur. Contrepartie : un mur voisin à moins de
  ~42 cm reste un peu plus clair. **Règle générale : jamais une limite de masque posée sur une
  surface** — la décaler dans le vide. Pour diagnostiquer un masque, forcer un contour vide ou
  lointain (tout doit s'assombrir) sépare « le code ne tourne pas » de « le test répond faux ».
- **Source** : `apps/web/src/three/HouseScene.ts` (`highlightRoom`, `ROOM_FOCUS_MARGIN_M`),
  `apps/web/src/three/core/roomFocus.ts` ; récit du thread principal. Voir
  `../1_architecture/1_5_scene-3d.md`, section 2026-09-25 (undecies).
- **Mise à jour 2026-09-26** : le masque est désormais un DÉGRADÉ (`smoothstep` sur 2 m de la
  distance à la pièce) : sans discontinuité à la limite, ce grain ne peut plus apparaître. La règle
  reste valable pour tout masque booléen.

### Complément 2026-09-25 — deuxième occurrence : le seuil du fondu des étages

Même règle, autre masque. Le fondu tramé des étages qui s'envolent (`core/levelFade.ts`) écarte les
pixels au-dessus d'un seuil de hauteur, `topBelow` = haut du niveau qui reste. Sur la maison démo
(d'après le thread principal), le dessus des murs du RDC est à 2,800 m, **exactement** ce seuil :
grain qui scintillait sur ces faces pendant l'envol (signalé par l'utilisateur), et la couvertine
`details:trim` à 2,805 m, qui appartient pourtant au niveau qui reste, était tramée entière.
Correctif : `LEVEL_FADE_MARGIN_M` = 0,03 m ajouté au seuil (2,83 m). **Consolidation** : la règle
vaut pour **toute** limite de masque, en plan (contour) comme en hauteur (seuil) — une limite
calculée à partir de la géométrie tombe presque toujours pile sur une face ; la décaler d'une marge
explicite, dans le vide, et vérifier ce qui se trouve juste au-delà (ici la couvertine). Source :
`apps/web/src/three/HouseScene.ts` (`topBelow`, `LEVEL_FADE_MARGIN_M`) ; voir
`../1_architecture/1_5_scene-3d.md`, section 2026-09-25 (duodecies).

## 2026-09-25 — une pilule qui finit son fondu se réaffiche pleine avant de disparaître

- **Date** : 2026-09-25
- **Symptôme** : RDC affiché, clic sur l'étage : les pilules du RDC s'estompent, puis à la fin
  elles se réaffichent pleines et disparaissent. Signalé par l'utilisateur.
- **Diagnostic** : `core/renderLoop.ts` ne comptait « en mouvement » que les tweens qui
  continuent. À l'image où le fondu **finit**, `onDone` pose l'état final (opacité remise à 1, puis
  pilule masquée) mais la tween est retirée sans rien signaler ; si une animation décorative tourne
  sans être due à cette image (eau à 10 Hz, onde d'enceinte), la boucle saute le dessin. Le DOM a
  bien changé, mais le `CSS2DRenderer` ne repasse pas : la pilule reste affichée, à opacité 1,
  jusqu'au tic suivant du décor.
- **Solution** : un drapeau `finished` levé quand une tween se termine, et
  `interactive = moving || dirty || finished` : l'image de fin est toujours dessinée. Vaut pour
  toutes les tweens (fin d'envol, vols de caméra). Test « l'image où une tween finit est dessinée,
  même quand le décor n'est pas encore dû » (échoue sans le correctif, d'après le thread
  principal) ; preview, `MutationObserver` sur une pilule : 1 → … → 0 → (1, masquée) d'un seul coup.
  **Leçon** : dans une boucle à la demande, « plus rien ne bouge » n'est pas « plus rien à dessiner » —
  la dernière image d'une animation est un changement comme un autre.
- **Source** : `apps/web/src/three/core/renderLoop.ts`, `apps/web/src/three/HouseScene.ts`
  (`fadePills`, `finishPillFade`) ; récit du thread principal. Voir
  `../1_architecture/1_5_scene-3d.md`, section 2026-09-25 (duodecies).

## 2026-09-25 — ombre fantôme d'un étage masqué après le voile de chargement

- **Date** : 2026-09-25
- **Symptôme** : maison réelle affichée sur le RDC après le voile, étage masqué, mais sa grande
  ombre reste sur la pelouse (capture de l'utilisateur).
- **Diagnostic** : la demande de relevé des ombres était une **fenêtre de temps**
  (`invalidateShadows` → `shadowsDirtyUntil` = maintenant + 700 ms). Pendant la préparation, aucune
  image n'est dessinée (`holdFrames`) et la compilation des shaders dure des secondes : la fenêtre
  expirait sans image, et l'étage masqué entre-temps (fin de son envol) restait dans la carte
  d'ombre. Cause trouvée par lecture du code : le défaut n'a pas été reproduit sur la maison démo.
- **Solution** : `invalidateShadows` pose aussi un compte d'images, `shadowFramesPending` = 2
  (`SHADOW_MIN_FRAMES`), décrémenté par `renderScene` : les deux prochaines images **dessinées**
  refont les ombres quoi que dure l'attente. La fin de l'envol redemande un relevé. Test « focaliser
  un niveau redemande un relevé des ombres » étendu (la demande survit à 60 s sans image).
  **Leçon** : une invalidation exprimée en TEMPS ne survit pas à une période sans image (voile, onglet
  caché, compilation) ; la doubler d'un compte d'IMAGES à servir.
- **Source** : `apps/web/src/three/HouseScene.ts`, `apps/web/src/three/three.test.ts` ; récit du
  thread principal. Voir `../1_architecture/1_5_scene-3d.md`, section 2026-09-25 (terdecies).

## 2026-09-25 — l'herbe du style nature reste sur le toit plat en réaliste

- **Date** : 2026-09-25
- **Symptôme** : le toit plat reste vert (herbe) après être passé du style nature au style réaliste
  (capture de l'utilisateur).
- **Diagnostic** : `setAppearance` recompose le thème de scène avec
  `resolveSceneTheme(next.ui ?? this.theme, palette, …)`, qui ÉTALE l'ancien thème puis la nouvelle
  palette. Une clé de palette **optionnelle**, `roofFlat`, présente seulement dans nature, n'était
  donc jamais écrasée par un style qui ne la déclare pas.
- **Solution** : `ScenePalette.roofFlat` est obligatoire. `mixPalette` la remplit avec la couleur du
  toit quand le style ne la déclare pas. Test « la dalle végétalisée de nature ne survit pas au retour
  au réaliste ». **Leçon** : toute clé de `ScenePalette` doit être présente dans chaque style ; une
  clé optionnelle hérite de la valeur du style précédent.
- **Source** : `apps/web/src/three/{styles/types.ts, core/theme.ts, builders/materials.ts, three.test.ts}`.
  Voir `../1_architecture/1_5_scene-3d.md`, section 2026-09-25 (quattuordecies).

## 2026-09-28 — le panneau appareil garde les réglages de l'appareil affiché AVANT

- **Date** : 2026-09-28
- **Symptôme** : on passe de « Volet chambre 1 » au « Volet baie » dans le panneau de la maison. Le
  volet baie affiche une inclinaison qu'il n'a pas et perd sa position perso, son mode discret et sa
  batterie. Après un rechargement directement sur lui, tout est juste.
- **Diagnostic** : `DeviceControl` choisit le contrôle par `kind` (`<component :is>`). Entre deux
  appareils du même kind, Vue **garde l'instance** et ne change que les props. Or plusieurs contrôles
  lisaient le descripteur une seule fois, au montage (`const hasTilt =
  props.descriptor.capabilities.includes('tilt')`). Revue des 18 contrôles le même jour, trois autres
  touchés :
  - `ClimateControl`, le plus grave en vrai : plage de consigne, modes, droit de régler la consigne et
    le mode, vocabulaire « départ d'eau ». La zone 2 de l'Ecodan (départ d'eau, lecture seule)
    héritait des boutons + / − et des modes du thermostat affiché avant elle ;
  - `LightControl` : la plage du curseur de blanc (`colorTempMirek`, propre à chaque modèle Hue) ;
  - `SensorCard` : la courbe de luminosité d'un panneau de volet solaire.
  Sont sains : les `has(c)` (fonctions réévaluées au rendu) et les `ref()` locales resynchronisées
  par un `watch` (volume, luminosité, température de lampe, flux caméra sur `deviceId`, historique de
  luminosité sur `descriptor.id`, touches en attente sur `pending`, glissement de la limite de charge).
- **Solution** : tout ce qui dérive du descripteur passe en `computed`. Une `:key="descriptor.id"`
  dans `DeviceControl` aurait tout couvert d'un coup, mais aurait recréé chaque contrôle à chaque
  sélection : écarté. Un test par contrôle monte un appareil puis `setProps` vers un autre (rouges
  avant correctif). **Leçon** : dans un contrôle d'appareil, ne jamais lire `props.descriptor` au
  niveau du script hors d'un `computed`, d'un `watch` ou d'une fonction appelée au rendu. Un test qui
  ne fait qu'un seul montage ne voit pas le défaut.
- **Source** : `apps/web/src/components/controls/{CoverControl,ClimateControl,LightControl,SensorCard}.vue`
  et leurs tests (`SensorCard.test.ts` créé). Voir `../4_ui/4_1_navigation-et-panneaux.md`, section
  2026-09-28 sur les ouvrants.

## 2026-10-01 — la borne Enphase ne reprend pas la charge verte après un « Arrêter »

- **Symptôme** : après un Arrêter (ou un Démarrer) sur la borne, la voiture reste branchée sans charger,
  même en plein soleil. L'appli Enphase affiche « Pas de charge – annulation manuelle ».
- **Diagnostic** : en charge verte, `start_charging` comme `stop_charging` posent une annulation manuelle
  « jusqu'au prochain débranchement » : le `mode` de `/ev_chargers/status` passe de 1 à 0, la préférence
  reste `GREEN_CHARGING`. Réécrire `GREEN_CHARGING` ne la lève pas (400 `iqevc_sch_10028`, « Charging mode
  is already enabled »).
- **Solution** : débrancher puis rebrancher, ou choisir un mode dans l'écran des modes de l'appli. Côté
  Kasbah, ne jamais relayer un arrêt de voiture à la borne (`core/chargeCoordination.ts`), et l'UI le dit
  sous Arrêter (`meta.evCharger.stopUntilUnplug`).
  Exception depuis le 2026-10-01 : l'Arrêter d'une R5 passe par la borne (`meta.vehicle.stopViaCharger`), donc la
  bloque jusqu'au débranchement, par choix de l'utilisateur.
- **Source** : `../3_plugins/3_7_enphase.md` (section 2026-10-01), `apps/server/src/plugins/enphase/index.ts`.

## 2026-10-01 — « could not write Tesla state cache … rename … ENOENT » au démarrage

- **Date** : 2026-10-01
- **Symptôme** : au démarrage de la maison réelle, le journal du serveur porte `could not write
  Tesla state cache`, avec `ENOENT: rename 'tesla-state.json.<pid>.tmp' -> 'tesla-state.json'`.
- **Diagnostic** : `persist()` (`plugins/tesla/index.ts`) lance l'écriture sans l'attendre, et le
  démarrage l'appelle deux fois coup sur coup. Les deux écritures utilisaient le **même** `.tmp`
  (nommé d'après le pid, pas d'après l'appel) : le premier `rename` déplace le fichier, le second
  ne le trouve plus. La course dépend du disque : sur le poste de développement, deux écritures ne
  la déclenchent jamais (0 sur 20), trois une fois sur sept, dix à chaque fois (20 sur 20). Dix-huit
  autres fichiers d'état du serveur avaient la même copie du motif.
- **Solution** : `writeFileAtomic` (`core/atomic-file.ts`) met en file les écritures d'un même
  chemin. Les 19 sites passent par lui. Test rouge avant correctif avec dix écritures (deux ne
  suffisent pas à le rendre fiable). **Leçon** : un `.tmp` propre au processus protège d'un AUTRE
  processus, pas de deux écritures du même processus. Écrire un fichier sans attendre exige une file.
- **Source** : `apps/server/src/core/atomic-file.ts`, `core/atomic-file.test.ts`,
  `plugins/tesla/state.test.ts`. Voir `../1_architecture/1_2_serveur-et-plugins.md`, section 2026-10-01 (3).

## 2026-10-05 — « crypto.randomUUID is not a function » à la création d'une automatisation

- **Date** : 2026-10-05
- **Symptôme** : « Nouvelle automatisation » ne s'ouvre pas ; la console porte `Uncaught (in
  promise) TypeError: crypto.randomUUID is not a function` dans `AutomationEditView.vue`, et Vue
  signale une erreur dans le `setup`.
- **Diagnostic** : `crypto.randomUUID` n'existe que dans un **contexte sécurisé** (https, ou
  `localhost`). L'utilisateur ouvre l'app en http sous `kasbah.home.internal:5173` : la fonction est
  absente. Invisible en développement comme dans la preview, toutes deux sur `localhost`.
  `crypto.getRandomValues`, lui, existe partout.
- **Solution** : `newId()` (`views/AutomationEditView.vue`) essaie `randomUUID` et, dans le `catch`,
  tire 16 octets par `getRandomValues` rendus en 32 caractères hexadécimaux, que `AUTOMATION_ID_RE`
  (`packages/shared/src/automations/automation.ts`) admet aussi. Vérifié dans la preview en
  retirant `Crypto.prototype.randomUUID` avant d'ouvrir `/automations/new` (UUID avec, hexadécimal
  sans). C'était le seul appel côté web. **Leçon** : l'app tourne en http sur le réseau local ; une
  API réservée au contexte sécurisé (`randomUUID`, presse-papiers, géolocalisation…) y manque, et
  `localhost` ne le montrera jamais. Pour reproduire : supprimer l'API du navigateur avant le geste.
- **Source** : `apps/web/src/views/AutomationEditView.vue`.

## 2026-10-06 — accès extérieur : cinq pièges de la porte à session

Entrée groupée : cinq constats de la mise en service de la connexion sous l'adresse publique
(`../1_architecture/1_7_serveur-mcp.md`, mise à jour du 2026-10-06 (soir)).

### 1. Les morceaux JS chargés à la demande reçoivent la page de connexion

- **Date** : 2026-10-06
- **Symptôme** : après la révocation d'une session, une vue qui se charge pour la première fois reste
  vide, sans erreur claire.
- **Diagnostic** : la première version redirigeait en 302 vers `/login` tout `GET` hors `/api` et `/ws`
  sans session. Les morceaux de Vite (`/assets/*.js`) recevaient alors le HTML de la connexion à la place
  du script : la vue cassait en silence. Vu dans le navigateur : morceaux en 401, `/api/session` en 401,
  puis `/login`.
- **Solution** : redirection seulement si `Accept` contient `text/html` (une vraie navigation) ; tout
  le reste rend 401 `AUTH_REQUIRED`, et `router.onError` interroge `/api/session`, qui renvoie à la
  connexion. Limite : on revient sur la vue où l'on était, pas celle qu'on ouvrait.
- **Source** : `apps/server/src/http/session.ts` (`gate`), `apps/web/src/router/index.ts`.

### 2. Les flux des caméras sont des WebSockets, hors de `/ws`

- **Date** : 2026-10-06
- **Symptôme** : un contrôle d'origine limité à `/ws` laissait passer les flux vidéo.
- **Diagnostic** : les flux des caméras sont aussi des WebSockets, sous `/api/plugins/<id>/cameras/…`
  (le proxy Vite a `ws: true` sur `/api`).
- **Solution** : le contrôle d'origine porte sur l'en-tête `upgrade`, pas sur le chemin.
- **Source** : `apps/server/src/http/session.ts`.

### 3. Tester un vrai WebSocket : `injectWS`, et l'écouteur dans `onInit`

- **Date** : 2026-10-06
- **Symptôme** : impossible de vérifier le refus d'un WebSocket avec `app.inject` ; puis un test qui
  attend un message jusqu'au délai d'expiration.
- **Diagnostic** : `app.inject` ne fait qu'un GET. `@fastify/websocket` 11 fournit `app.injectWS(path,
  { headers }, { onInit })`, qui passe par le vrai chemin d'upgrade et ses crochets `onRequest`, et
  rejette avec « Unexpected server response: <code> ». L'instantané part dès l'ouverture : l'écouteur
  posé après l'ouverture arrive trop tard.
- **Solution** : poser l'écouteur dans `onInit`. Contrôle négatif : condition d'origine retirée, deux
  tests rougissent.
- **Source** : `apps/server/src/mcp/public-host.test.ts`, `apps/server/src/http/session.test.ts`.

### 4. La CSP de la page de connexion interdit `fetch` depuis la page

- **Date** : 2026-10-06
- **Symptôme** : « Failed to fetch » dans une sonde exécutée sur `/login`.
- **Diagnostic** : `default-src 'none'` interdit `connect-src`, donc tout `fetch` depuis la page elle-même.
  Voulu.
- **Solution** : tester la page par le formulaire, pas par un `fetch`. Autre limite du banc : le panneau
  du navigateur masqué a `document.hasFocus()` faux, donc `:focus` ne s'applique pas ; la règle est
  présente mais le rendu du focus n'a pas pu y être vérifié.
- **Source** : `apps/server/src/mcp/auth.ts` (`htmlPage`).

### 5. Un serveur de vérification local pour l'adresse publique

- **Date** : 2026-10-06
- **Symptôme** : comment essayer le cookie `Secure` / `__Host-` et la connexion sans proxy ni https.
- **Diagnostic / recette** : script jetable (hors dépôt) qui lance `buildApp` avec le SEUL plugin mock
  (factories) et une copie de la maison de démo, `MCP_PUBLIC_URL=http://kasbah-pub.localhost:9887` ;
  Chrome traite `*.localhost` comme contexte sécurisé et accepte ces cookies en http. Lancé par une
  entrée provisoire de `.claude/launch.json`, retirée ensuite. Hors dépôt, un `.ts` sous tsx part en CJS
  (« Top-level await not supported ») : extension `.mts`, imports absolus en `file:///D:/…`, `pino`
  résolu par `createRequire` depuis `apps/server/package.json`.
- **Solution** : la recette ci-dessus ; à rejouer pour toute vérification de la porte.
- **Source** : `apps/server/src/app.ts` (`buildApp`), `.claude/launch.json` (non versionné).

## 2026-10-07 — `display: fullscreen` sur Android : bande noire et barre du bas hors de l'écran

- **Date** : 2026-10-07
- **Symptôme** : l'app installée avec `"display": "fullscreen"` s'ouvre avec une bande noire en haut
  (zone de la caméra) ; parfois la barre d'icônes du bas de l'app manque, la carte météo et la
  recherche touchent presque le bas. Un passage par les apps ouvertes, puis retour, remet tout en
  place, en vrai plein écran.
- **Diagnostic** : défaut de Chrome sur Android, suivi dans Chromium
  [407420295](https://issues.chromium.org/issues/407420295) (« In Progress » au 2026-10-07). Au
  lancement, la zone de la caméra est réservée en noir malgré `viewport-fit=cover`, et la page reçoit la
  hauteur de l'écran entier : le cadre de l'app (`100dvh`, `App.vue`) dépasse en bas, et la barre du bas,
  collée à ce cadre, sort de l'écran. Rien ne s'est vu dans le panneau du navigateur, qui n'émule ni le
  mode `display-mode: fullscreen` ni le plein écran (« Permissions check failed » même sur un vrai clic).
- **Solution** : rester en `standalone` (décision de l'utilisateur). Détail, références et procédure
  pour réessayer : `../5_setup/5_2_production.md`, mise à jour du 2026-10-07.
- **Source** : `apps/web/public/manifest.webmanifest`.

## 2026-10-07 — vérifier les comptes musicaux dans le navigateur : trois pièges du banc

- **Date** : 2026-10-07
- **Symptôme** : (1) sur la page de connexion du serveur jetable, ni Entrée ni un clic par coordonnées ne
  soumettent le formulaire ; (2) la lecture anonyme échoue alors que yt-dlp est installé ; (3) comment voir
  la version anglaise sans toucher aux réglages.
- **Diagnostic** : (1) quand la taille émulée (1 280×800) dépasse celle du panneau, le clic tombe hors de
  la page. (2) le serveur jetable passe sa configuration à `buildApp` par `envSource`, qui remplace
  `process.env` pour les plugins : le `.env` (qui donne `YTM_YTDLP_PATH`) n'est pas lu, la valeur par
  défaut `yt-dlp` s'applique, et yt-dlp n'est pas sur le `PATH` (« spawn yt-dlp ENOENT »). (3) la langue est lue dans
  `localStorage['kasbah.locale']`, en chaîne brute (pas du JSON).
- **Solution** : (1) remettre la taille du panneau avant de se connecter. (2) passer `YTM_YTDLP_PATH`
  absolu au serveur jetable. (3) `localStorage['kasbah.locale'] = 'en'`, puis recharger. Le serveur jetable
  lui-même : « Un serveur de vérification local pour l'adresse publique », entrée du 2026-10-06 plus haut.
- **Source** : session du 2026-10-07 (comptes musicaux par utilisateur), `apps/server/src/app.ts`
  (`buildApp`).

## 2026-10-07 — `claude -p --safe-mode` : le serveur MCP passé par `--mcp-config` n'est pas chargé

- **Date** : 2026-10-07
- **Symptôme** : lancé avec `--safe-mode` pour ignorer la configuration personnelle de la machine,
  `claude -p` répond « je ne peux pas contrôler des appareils physiques » ; l'événement `init` de la
  sortie `stream-json` montre `mcp_servers: []`.
- **Diagnostic** : `--safe-mode` désactive TOUTES les personnalisations, serveurs MCP compris, y
  compris ceux passés explicitement par `--mcp-config` (`claude --help`, CLI 2.1.288).
- **Solution** : ne pas l'employer. Ignorer la machine autrement : `--setting-sources ""`, dossier
  courant vide, `CLAUDE_CONFIG_DIR` dédié quand un jeton est employé, environnement filtré de
  `CLAUDE*` / `ANTHROPIC*` (des plugins de la session qui avait lancé le serveur se chargeaient malgré
  `--setting-sources ""` : ils passaient par l'environnement). Vérifier dans `init` que le serveur
  `kasbah` est `connected`. Détails : `../3_plugins/3_24_claude.md`.
- **Source** : session du 2026-10-07 (assistant), `apps/server/src/plugins/claude/run.ts`.

## La preview se fige plus de 45 s au chargement d'une maison (finitions photo trop nombreuses)

- **Date** : 2026-10-07
- **Symptôme** : en ouvrant « Les Tilleuls » (maison de démonstration), la preview ne répond plus
  pendant plus de 45 s ; les deux autres démos se chargent normalement.
- **Diagnostic** : la maison portait **19 finitions photo distinctes** ; chaque finition distincte
  coûte au chargement (préparation des matières photo). Ce n'est ni la géométrie ni le nombre
  d'appareils (56 appareils, 17 pièces).
- **Solution** : ramener les finitions à 11 → chargement normal. Mesure de référence : Belvédère 11,
  Embruns 7. Compter les finitions distinctes avant d'en ajouter à une maison.
- **Source** : session du 2026-10-07 (démos multi-propriétés), `house/demos/tilleuls.json` ; voir
  `../2_maison/2_0_format-house-json.md`. Le seuil exact et le coût par finition n'ont pas été mesurés.

## 2026-10-13 — Liseré noir autour de la carte peinte (qualité haute) ; `outline` du rez-de-chaussée pris pour l'emprise

**Symptôme** : (1) en qualité haute seulement, les traits de la carte peinte d'une tondeuse sont cernés de
sombre. (2) Une maison calée sur la photo au contour de son rez-de-chaussée se retrouve décalée de
plusieurs mètres.

**Diagnostic** : (1) l'occlusion ambiante GTAO traite les rubans, 5 cm au-dessus de l'herbe, comme des
obstacles. (2) `levels[].outline` « sert au toit » : c'est une enveloppe, pas l'emprise réelle.

**Solution** : (1) mettre la carte peinte sur `SITE_DECOR_LAYER`. (2) caler sur le contour du dernier
étage, les pièces du rez-de-chaussée et la pelouse du robot posée sur sa base, jamais sur l'`outline` du
rez-de-chaussée. Détails : `../1_architecture/1_5_scene-3d.md` et `../2_maison/2_0_format-house-json.md`.
