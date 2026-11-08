# Comptes et sessions

> Dernière mise à jour : 2026-11-08
> Sources : `apps/server/src/http/rights.ts`, `packages/shared/src/rights/rights.ts`, `apps/server/src/http/session.ts`, `apps/web/src/stores/session.ts`, `apps/web/src/lib/navItems.ts`, `apps/web/src/views/NoRightView.vue`, `apps/server/src/http/static.ts`, `apps/server/src/mcp/auth.ts`, `apps/server/src/mcp/users-routes.ts`, `apps/server/src/mcp/users-cli.ts`, `apps/server/src/core/paths.ts`, `apps/server/src/music/sources.ts`, `apps/server/src/plugins/claude/index.ts`, `apps/server/src/assistant/assistant.ts` ; pages citées plus bas

Page de synthèse, écrite au lint du 2026-10-13 : le sujet était dispersé entre le serveur MCP, la
configuration, les Réglages et le lecteur musique. Elle décrit l'état du code à cette date et renvoie aux
sections datées qui racontent chaque étape ; le détail (routes OAuth, tests, essais) reste là-bas.

> **Dépassé le 2026-11-08** : le réseau local n'est plus « la maison » sans compte. Connexion pour tout le monde,
> partout ; seule la machine elle-même est de confiance. Voir la dernière section de la page (« Mise à
> jour 2026-11-08 »). Ce qui suit, et les sections datées d'avant, décrit l'état du 2026-11-01 et reste pour
> l'historique.

## Le principe : c'est le nom d'hôte qui décide

Kasbah a deux portes, et c'est le **nom** sous lequel on l'appelle qui choisit, jamais la provenance :
derrière le proxy inverse, toutes les requêtes arrivent du proxy, la provenance ne dit donc rien.

| Appelé par | Authentification | `req.sessionUser` |
|---|---|---|
| le réseau local (`http://<poste>:8787`, écrans fixes) | aucune : le réseau local est de confiance | `null` |
| l'adresse publique (`MCP_PUBLIC_URL`, derrière le proxy inverse) | session par cookie pour toute l'app ; jeton OAuth pour `/mcp` | le compte connecté |
| un outil MCP qui rejoue une route (`app.inject`) | le jeton du client MCP | le compte du jeton (`actAsHeaders`) |

L'adresse publique demande la connexion **même depuis la maison** : c'est voulu (une seule icône sur le
téléphone, mêmes réglages partout). Pourquoi une connexion dans Kasbah plutôt qu'un VPN ou Cloudflare
Access : [1_7 Serveur MCP](1_7_serveur-mcp.md), sections du 2026-10-04 (soir) et du 2026-10-06 (soir).

## Les comptes

- **Un seul fichier pour l'app et le MCP** : `apps/server/mcp-users.json`, à côté du `.env`, ignoré par
  git. Mots de passe en scrypt (`scrypt$<sel>$<clé>`) ; un compte inconnu coûte le même calcul. Le fichier
  est relu quand son `mtime` change : retirer un compte coupe ses jetons et ses sessions sans redémarrage.
- **Gestion** : carte « Comptes » de Réglages ([4_7 Vue Réglages](../4_ui/4_7_reglages.md)), routes
  `GET` / `PUT` / `DELETE /api/mcp/users[/:name]`, ou le script `npm run mcp-user -w @kasbah/server`
  en secours *(renommé le 2026-11-08 : `npm run account`, voir la section datée en bas)*. Nom `^[\w.@-]{1,64}$`, mot de passe de 8 caractères au moins (`userNameSchema`,
  `passwordSchema`, communs au script et aux routes).
- **Réseau local seulement, même connecté** : sous l'adresse publique, `/api/mcp/users` rend 401 sans
  session et 403 `LAN_ONLY` avec une session. Une session volée ne doit pas pouvoir créer de compte.
  Depuis le 2026-10-13, même règle pour `/api/system/*` (version du serveur et mise à jour par le
  superviseur, [5_2 Production](../5_setup/5_2_production.md)) : `LAN_ONLY` est une liste de préfixes
  dans `session.ts`, et le message d'erreur ne nomme plus les comptes.
  Depuis le 2026-10-30, aussi `/api/matter/*` : son code d'appairage donne la main sur ce que le pont
  publie ([1_17](1_17_pont-matter.md)).
- **Droits par compte** (un compte en lecture seule, par exemple) : *(faits le 2026-11-01, voir la section
  datée en bas de page ; avant, tout compte connecté pouvait tout)*. Voir [0_0 Vision et principes](../0_overview/0_0_vision-et-principes.md).

### Mise à jour 2026-10-23 - le nom public sous toutes ses graphies, les routes locales sous toutes leurs écritures

Deux failles relevées par un audit de sécurité du serveur, corrigées le même jour :

- **Le nom public se compare sans casse ni point final** (`isPublicRequest`, `mcp/auth.ts`). Avant,
  `Host: KASBAH.example.org` ou `kasbah.example.org.` ne valait pas le nom de `MCP_PUBLIC_URL` (comparaison
  exacte, et Fastify rend `req.hostname` tel qu'envoyé) : si le proxy transmet le `Host` d'origine, la
  requête passait pour locale, donc **sans authentification**. Désormais le nom public, `Host` et le premier
  `X-Forwarded-Host` sont mis en minuscules et privés d'un point final avant la comparaison
  (`hostKey`). La liste passée au SDK MCP (`hostHeaderValidation`, `mcp/server.ts`) n'est pas touchée.
  Test : `mcp/public-host.test.ts`.
- **`LAN_ONLY` se décide aussi sur la route trouvée** (`gate`, `http/session.ts`) : le chemin brut **ou**
  `req.routeOptions.url`, le motif de route que le routeur a choisi. find-my-way décode `%XX`, coupe à `#`
  et retire un `http://hôte` en tête avant de chercher la route : `/api/mcp/%75sers/x`,
  `/api/mcp/users#x` ou `PUT http://hôte/api/mcp/users/x` atteignaient la gestion des comptes depuis
  l'adresse publique avec n'importe quelle session. Test : `http/session.test.ts`.

Le piège à retenir : **ne jamais décider d'un accès sur `req.url` dans un hook `onRequest`**, le routeur
ne cherche pas la même chaîne ; se fier à `req.routeOptions.url` (fixé avant les hooks, `undefined` en 404).

Reste ouvert : un `Host` qui n'est pas le nom public passe toujours pour le réseau local. Une page web
piégée peut donc, par *DNS rebinding*, parler à Kasbah depuis le navigateur d'un poste de la maison ; il
faudrait une liste des noms locaux admis, qui n'existe pas encore. *(Fait le même jour, section suivante.)*

### Mise à jour 2026-10-23 (soir) - le réseau local reconnu à son nom, et les pages des autres sites refusées

Le réseau local reste sans compte, mais `publicHostFilter` (`mcp/auth.ts`) le filtre désormais :

- **Le nom doit être un nom local** (`isLanHost`) : une adresse IP (v4, ou v6 entre crochets),
  `localhost`, un nom court sans point (`kasbah`), un suffixe qui ne s'achète pas (`.internal`, `.local`,
  `.lan`, `.home.arpa`, `.localhost`), ou un nom de `KASBAH_LAN_HOSTS` (liste à virgules, pour un nom
  local qui ressemble à un nom public). Sinon 403 `UNKNOWN_HOST`. C'est la parade au *DNS rebinding* :
  la page piégée garde son nom de domaine, que le navigateur continue d'envoyer dans `Host` ; elle ne peut
  pas se faire servir sous une IP ni sous un suffixe local. Un `Host` vide (HTTP/1.0) est refusé aussi.
- **Une écriture ou un WebSocket d'un navigateur doit venir de la page servie** : si l'en-tête `Origin`
  est présent, son hôte (port compris) doit être celui de `Host`, sinon 403 `BAD_ORIGIN`. Cela ferme ce
  que la liste de noms ne couvre pas : une page d'un autre site qui vise directement l'IP de Kasbah
  (requête croisée sur une route sans corps, WebSocket `/ws` ou flux de caméra). Sans `Origin` (appli
  Android, enceintes, scripts, outils MCP par `app.inject`), rien ne change, et les lectures non plus.
  Avec Vite en développement, le proxy garde le `Host` du navigateur : `Origin` et `Host` concordent.

Choix écartés : refuser tout nom non listé (il aurait fallu déclarer `kasbah.home.internal`), ou envoyer
un nom inconnu vers la page de connexion (le cookie `__Host-` exige HTTPS et l'origine publique : on
serait bloqué sans comprendre). La liste `ALLOWED_HOSTS` de `/mcp` (`mcp/server.ts`) n'a pas changé, elle
reste plus stricte (pas d'IP). Tests : `mcp/public-host.test.ts`.

## La session de l'app (`http/session.ts`)

- **Cookie** `__Host-kasbah_session` : Secure, Path=/, HttpOnly, SameSite=Lax, aucun Domain.
- **90 jours glissants**, prolongés au plus une fois par jour (le cookie est alors réécrit).
- **Gardée hachée** (sha256) dans `KASBAH_SESSIONS_FILE` (défaut `.state/sessions.json`, 0600), avec une
  **empreinte du haché du mot de passe** : changer le mot de passe ferme les sessions du compte, de quoi
  couper un téléphone perdu. Les jetons MCP, eux, ne tombent qu'au retrait du compte. *(Dépassé le 2026-10-23 : ils portent la même
  empreinte et tombent aussi au changement de mot de passe, voir plus bas.)*
- **Sans session** : une navigation (`GET` d'une page HTML) part en 302 vers `/login?next=…` ; l'API, le
  WebSocket et les fichiers chargés par la page rendent 401 `AUTH_REQUIRED`, et le web renvoie lui-même à
  la connexion. `next` n'accepte qu'un chemin du site (ni `//`, ni `/\`, ni `/login`). *(Depuis le
  2026-10-23, `safeNext` le lit comme le navigateur, avec `new URL` : une tabulation ou un saut de ligne
  y sont retirés, donc `/<TAB>/evil.example` valait `//evil.example`, un autre site, et passait le test
  de préfixe. Seul un résultat de même origine est gardé, rendu en chemin + requête + ancre.)* *(Complété le
  2026-10-25 : le chemin normalisé lui-même ne doit pas commencer par `//`, voir plus bas.)*
- **Ouverts sans session** : `/login`, `/logout`, `/manifest.webmanifest`, `/icons/*`, pour que l'app
  s'installe dès la page de connexion (le navigateur demande le manifest sans cookie).
- **Origine exigée** (celle de `MCP_PUBLIC_URL`) sur toute écriture et toute demande de WebSocket, `/ws`
  comme les flux des caméras : les autres services publiés sous le même domaine sont du même *site*,
  SameSite ne les sépare pas. Sinon 403 `BAD_ORIGIN`.
- `GET /api/session` rend `{ user }` (`null` sur le réseau local). *(Complété le 2026-11-01 : plus `rights`
  quand le compte a une liste, voir la dernière section de la page.)*
- La page de connexion est rendue par le serveur, en français seulement, comme celle du MCP.

## Les échecs de connexion (`LoginGuard`, `mcp/auth.ts`)

Les deux connexions (page de l'app et `/oauth/authorize` du MCP) passent par `checkLogin` et partagent
le même gardien :

| Règle | Valeur | Réglable |
|---|---|---|
| Blocage d'un compte après N échecs d'affilée | 5 (`0` = jamais) | `KASBAH_LOGIN_MAX_FAILURES` |
| Durée du blocage, et fenêtre de « d'affilée » | 15 min | `KASBAH_LOGIN_LOCK_MINUTES` |
| Plafond global, toutes connexions confondues | 10 échecs en 15 min | non (derrière le proxy, tout a la même adresse) |

*(Dépassé le 2026-10-24 : le plafond est désormais par adresse de client, et une tentative compte
avant la vérification du mot de passe ; voir la section datée en bas de page.)*

Le blocage vaut **même avec le bon mot de passe**, il est suivi par **nom saisi**, existant ou non (il ne
trahit pas quels comptes existent), et il vit en mémoire : un redémarrage le lève. Détail :
[5_1 Configuration](../5_setup/5_1_configuration-env.md), section du 2026-10-06 (soir).

## Ce qui dépend du compte

`req.sessionUser` est la seule information que le reste du serveur lit. Là où il compte :

- **Comptes musicaux** : YouTube Music et Mixcloud ont un compte par utilisateur, sous
  `.state/users/<nom>/` (`userStateDir`, `core/paths.ts`) ; sur le réseau local (`null`), c'est le compte
  de la maison. Le nom est encodé pour le disque : `encodeURIComponent`, point de tête en `%2E`,
  majuscules marquées d'un `+` (un disque Windows ne distingue pas deux noms qui ne diffèrent que par la
  casse). Retirer un compte efface ce dossier. Voir [1_6 Lecteur musique](1_6_lecteur-musique.md) et
  [4_5 Musique et médias](../4_ui/4_5_musique-et-medias.md), section du 2026-10-07.
- **Santé des plugins** : `DevicePlugin.healthFor?(user)` donne la santé des comptes de qui demande
  (ytmusic, Mixcloud) ; sinon `health()`, la même pour tous. Voir
  [1_2 Serveur et plugins](1_2_serveur-et-plugins.md), section du 2026-10-08.
- **Assistant** : le jeton Claude de chaque compte (repli sur celui de la maison), une instruction à la
  fois par compte, journal des instructions lu depuis le réseau local seulement. Voir
  [1_9 Assistant](1_9_assistant.md) et [3_24 Claude](../3_plugins/3_24_claude.md).
- **Outils MCP** : ils rejouent les routes de l'app au nom du compte de leur jeton *(sauf `send_command`, `recall_scene` et quelques lectures,
  qui vérifient eux-mêmes les droits : section du 2026-11-01)*. Le secret interne de
  `actAsHeaders` est tiré au démarrage et ne quitte jamais le processus : une requête venue du réseau ne
  peut pas s'en réclamer.

## Fichiers d'état

| Fichier | Contenu | Hors dépôt |
|---|---|---|
| `apps/server/mcp-users.json` | comptes (nom, haché scrypt, `rights` facultatif) | oui, ignoré par git |
| `.state/sessions.json` | sessions de l'app, hachées | oui (`.state/`) |
| `.state/mcp-auth.json` | clients et jetons MCP, hachés | oui (`.state/`) |
| `.state/users/<nom>/` | comptes musicaux et jeton Claude d'un utilisateur | oui (`.state/`) |

Supprimer `sessions.json` déconnecte tout le monde ; supprimer `mcp-auth.json` oblige chaque client MCP à
se reconnecter.

### Mise à jour 2026-10-23 (nuit) - les jetons MCP tombent avec le mot de passe

Constat d'un audit de sécurité : un jeton OAuth du MCP (accès 1 h, rafraîchissement 90 jours glissants) ne
vérifiait que l'existence du **nom** du compte. Changer le mot de passe ne coupait donc pas un client MCP
volé, et un compte retiré puis recréé sous le même nom ranimait ses anciens jetons. Chaque jeton porte
désormais `pw`, l'empreinte du haché du mot de passe à l'émission (`pwTag`, déplacée de `http/session.ts`
vers `mcp/auth.ts`, la même que pour les sessions) ; `requireToken` et le rafraîchissement le comparent au
compte courant (`grantHolds`). Un nouveau haché a un nouveau sel : un compte recréé ne correspond pas.

Un jeton écrit avant ce changement n'a pas d'empreinte : il est **refusé**, et chaque client MCP (connecteur
Claude, par exemple) se reconnecte une fois. L'accepter l'aurait lié au mot de passe du moment de son
prochain rafraîchissement, ce qui annulait la protection. Les jetons d'exécution de l'assistant
(`runToken`), en mémoire seulement, ne sont pas concernés. Tests : `mcp/auth.test.ts`.

### Mise à jour 2026-10-24 - le plafond d'échecs par client, et les tentatives simultanées comptées

Deux constats d'un audit de sécurité sur `LoginGuard` (`mcp/auth.ts`) :

- **F28 : le plafond global se retournait contre la maison.** Dix mauvais mots de passe de n'importe qui,
  sur n'importe quel nom, bloquaient pendant 15 minutes toutes les connexions à l'adresse publique, page de
  l'app comme autorisation du MCP. Le plafond (10 échecs en 15 min) est maintenant **par client**
  (`clientOf`) : la dernière entrée de `X-Forwarded-For`, celle que le proxy du NAS ajoute avec l'adresse
  qui l'a contacté (un client ne peut pas la choisir), sinon l'adresse du socket. Si le proxy n'ajoutait
  pas cet en-tête, toutes les requêtes auraient l'adresse du NAS : on retomberait sur le plafond global
  d'avant. **À vérifier sur le vrai proxy** : qu'il ajoute bien `X-Forwarded-For` (sinon un client
  pourrait aussi en écrire un et changer d'adresse à volonté pour essayer plus de noms).
- **F17 : des tentatives envoyées en même temps passaient toutes.** Le contrôle avait lieu avant le
  calcul scrypt (asynchrone), l'échec n'était noté qu'après : douze essais simultanés étaient tous
  évalués. Désormais `attempt()` compte l'essai comme un échec **avant** la vérification, et `succeed()`
  le rend.

Inchangé : le blocage d'un compte après N échecs d'affilée reste commun à tous les clients (il protège le
mot de passe) ; quelqu'un qui connaît un nom de compte peut donc encore le bloquer 15 minutes. Tests :
`http/session.test.ts` (douze essais simultanés → trois refus 401 et neuf 429 ; un client bloqué, un
autre qui se connecte).

### Mise à jour 2026-10-24 (3) - les mots de passe de comptes tiers passent en clair sur le réseau local

Constat F35 d'un audit de sécurité, **documenté sans changement de code** (choix de l'utilisateur) : relier
un compte Renault, MELCloud, iRobot ou Enphase (compte Enlighten) envoie son mot de passe au serveur dans
le corps d'une requête. Sur le réseau local, Kasbah n'est servi qu'en HTTP : un appareil malveillant du
réseau qui écoute au bon moment le lit. Le serveur ne le garde pas (seul un jeton ou une session est
conservé). Parade : relier ces comptes depuis l'adresse publique (HTTPS, `MCP_PUBLIC_URL`). Écarté :
refuser ces mots de passe reçus en HTTP, qui rendait la liaison impossible sans adresse publique. Les
pages `docs/plugins/{renault,melcloud,irobot}.md` le disent.

### Mise à jour 2026-10-25 - audit de l'app web : retour après connexion, cadre, secrets en clair

Trois constats d'un audit de sécurité (Claude Security, périmètre `apps/web`, effort medium) touchent les
sessions :

- **`next` pouvait encore sortir du site.** La normalisation de `new URL` retire les segments `.` mais
  garde les segments vides : `/.//evil.example` donnait le chemin `//evil.example`. La valeur passant deux
  fois par `safeNext` (GET qui remplit le champ caché, puis POST), cette charge était neutralisée au
  second passage, mais `/.//kasbah.invalid//evil.example` passait les deux (le premier rend
  `//kasbah.invalid//evil.example`, de même origine que la base factice ; le second rend `//evil.example`)
  et le 303 renvoyait la victime ailleurs juste après sa connexion. `safeNext` refuse désormais tout
  chemin normalisé qui commence par `//` (`http/session.ts`) ; le test « never redirects anywhere but the
  site » couvre ces formes.
- **L'app n'interdisait pas d'être encadrée.** Seules les pages de `htmlPage` posaient `frame-ancestors`.
  Une page étrangère pouvait charger l'app du réseau local dans une iframe transparente : ses requêtes
  portent l'origine de l'app et passent le contrôle d'`Origin`, et le réseau local n'a pas de connexion,
  d'où un clic détourné vers une vraie commande. Toute page HTML du build part maintenant avec
  `X-Frame-Options: SAMEORIGIN` et `Content-Security-Policy: frame-ancestors 'self'` (`http/static.ts`,
  option `setHeaders` de `@fastify/static`, que le repli SPA traverse aussi par `sendFile`). `'self'` et
  non `'none'` : `diag.html` encadre l'app. Test : `http/static.test.ts`.
- **D'autres secrets que les mots de passe de F35 passent en clair.** Le cookie YouTube Music (une
  session Google), le jeton `claude setup-token`, le mot de passe TouteMonAnnée et l'adresse iCal secrète
  traversent eux aussi le réseau local en HTTP au moment de la liaison. Même choix que F35 : documenté
  sans changement de code, dans `docs/plugins/{ytmusic,claude-assistant,toutemonannee,agenda}.md`.

Non audités en entier par ce passage : `components/settings` (dont `McpUsersCard.vue`),
`components/heating`, `components/weather`, le routeur, `main.ts` et `three/HouseScene.ts`.

### Mise à jour 2026-10-30 - `req.sessionUser` valait `undefined` dans les routes des plugins

Signalé par un utilisateur (qgiu) : sur le réseau local, le jeton `claude setup-token` collé dans Réglages
→ Plugins → Claude partait dans `.state/users/undefined/claude.json` au lieu de `.state/claude.json`, et la
carte comme la santé disaient toujours « no house token ». Le jeton servait quand même, par hasard
(`run.user` valait aussi `undefined`), mais la maison était vue sans jeton et le serveur se rabattait sur la
connexion `claude` de la machine.

**Cause** : l'ordre d'enregistrement dans `buildApp` (`apps/server/src/app.ts`). `decorateRequest('sessionUser',
null)` (dans `session.routes`) n'atteint que les contextes Fastify chargés **après** lui ; or
`await registerMcp(...)` chargeait déjà les routes des plugins (`host.registerRoutes`, enregistrées par
`app.register`). Reproduit avec Fastify seul : `undefined` dans une route enregistrée avant un `await
app.register`, `null` à la racine.

**Correctif à la source** plutôt que `?? null` route par route (ce que proposait le correctif reçu, et ce que
`transcription` faisait déjà sans savoir pourquoi) : `session.routes(app)` est appelé juste après les hooks
`onRequest`, avant toute route. Toutes les routes de plugins étaient touchées ; le raté penchait du côté sûr
(un test « réseau local ? » répondait non), aucune faille. Test : `test/integration.test.ts`, « a plugin's own
route sees no account on the local network » (rouge sans le correctif). Un ancien fichier
`.state/users/undefined/claude.json` éventuel est à recoller depuis la carte.

### Mise à jour 2026-11-01 - les droits par compte (phases 1 et 2 : écritures et lectures)

Demande : choisir à quoi chaque compte a droit (pas les réglages des plugins, pas les voitures, pas le
chauffage ; lumières et volets oui), avec des blocages **dans le code**, pas seulement dans l'écran. Cette
section remplace la puce « Droits par compte : pas encore faits » plus haut (laissée en place, renvoyée
ici) ; le masquage dans l'app (phase 3) reste à faire, voir en fin de section.

**Le principe : un interrupteur par domaine, pas par appareil.** 17 domaines (`RIGHTS`,
`packages/shared/src/rights/rights.ts`) : lights, covers, access, heating, vehicles, media, cameras, robots,
pets, energy, water, weather, agenda, school, shopping, automations, settings. Un interrupteur par appareil
aurait été ingérable à tenir (les appareils changent, les usages de la maison non) et aurait laissé les
futurs appareils ouverts par défaut.
- `deviceRight(descriptor)` : le `kind` donne le domaine (`RIGHT_OF_KIND`). Exceptions : un `cover` de
  classe gate / garage / window demande `access` et non `covers` (`ACCESS_COVER_CLASSES`, les mêmes classes
  que le garde-fou `sensitiveActions` du MCP, qui garde sa propre copie) ; `fan` → heating ;
  `ev_charger` → vehicles ; `sensor` → aucun droit (rien à garder).
- `RIGHT_OF_NOTIFY_CATEGORY` : catégorie de push → droit (les alertes de plugins → settings).
- `grants(rights, right)` : **liste absente = tous les droits**.

**Qui est concerné.** Seulement un compte **identifié** : adresse publique, jeton MCP, assistant de l'app
(qui agit au nom du compte). Le réseau local (`req.sessionUser === null`) est la maison et garde tous les
droits, comme un compte sans liste `rights` (rétrocompatible : rien ne change tant qu'on n'a pas touché la
carte). **Limite à dire clairement : un enfant qui ouvre l'adresse locale n'a aucun blocage** ; les droits
protègent l'accès par compte, pas la maison.

**Stockage.** Champ facultatif `rights` (tableau) de chaque compte de `apps/server/mcp-users.json`
(`usersFileSchema`, `mcp/auth.ts`). Changer un mot de passe (`saveUser`) garde les droits. `setUserRights(path,
name, rights | null)`. Route `PUT /api/mcp/users/:name/rights` `{ rights: Right[] | null }` (`null` = tous),
404 si le compte n'existe pas, réseau local seulement comme le reste de `/api/mcp/users` ; `GET` ne rend
`rights` que si la liste existe. Les 17 allumées s'enregistrent en `null` (pas de liste), ce qui couvre aussi
les domaines ajoutés plus tard.

**Phase 1 : écritures** (`apps/server/src/http/rights.ts`). Un seul `preHandler` global (`registerRights`,
branché dans `buildApp` juste après la création du registre, **avant** toute route), décidé sur le **motif de
route** (`req.routeOptions.url`), jamais sur l'URL brute : même piège que `LAN_ONLY` (section du 2026-10-23).
Refus : 403 `NO_RIGHT`, message `this account may not use "<right>"`.
- `classifyRoute(method, url)` : `/api/devices/:id/*` → droit de l'appareil (résolu par le registre ; un
  appareil inconnu laisse la route répondre 404) ; `PATCH /api/plugins/:id` → settings ; `/api/music/*` →
  media ; écritures du cœur par préfixe (`CORE_WRITES`) : house et properties → settings, scenes → lights
  (les scènes fabricant sont des scènes Hue), automations et automation-order → automations, shopping →
  shopping. Push, diag, assistant, mcp/users, system, matter, login/logout/oauth/mcp : aucun droit.
- Routes propres aux plugins (`/api/plugins/<id>/…`) : table `PLUGIN_RIGHTS` (domaine du plugin + premiers
  segments d'**écriture** qui relèvent des réglages : login, logout, pair, token, calendars, devices…).
  `raw` (dumps fabricant) et `auth` (OAuth : le callback est un GET qui enregistre le jeton) → settings
  pour toute méthode. **Choix** : le cookie YouTube Music, le compte Mixcloud et le jeton Claude sont
  **personnels**, donc pas « settings » (ytmusic et mixcloud = media, claude = aucun droit) ; transcription =
  aucun droit sauf ses réglages.
- **Garde-fou : le doute refuse.** Une route qu'aucune table ne connaît demande `settings` (trop refuser
  plutôt que pas assez). Un hook `onRoute` les collecte, `buildApp` les journalise en `warn` au démarrage
  (`unmappedRoutes`, exposé sur `KasbahApp`) et un test d'intégration exige une liste vide : une nouvelle
  route oubliée fait rougir la suite. `rights.test.ts` vérifie aussi que chaque dossier de plugin qui a
  `registerRoutes` figure dans `PLUGIN_RIGHTS`.

**Phase 2 : lectures.**
- `GET /api/devices` est filtré (`deviceFilter`, passé à `registerRoutes`) ; les lectures d'un appareil
  (`/api/devices/:id`, history, forecast, journal, map, release-notes, consumption, energy-days) suivent le
  droit de l'appareil ; `GET /api/scenes` → lights, `/api/automations` → automations, `/api/shopping` →
  shopping (`CORE_READS`).
- **Restent lisibles** : `/api/house` (elle dessine la vue : un compte limité y voit encore le **nom et
  l'emplacement** des appareils cachés, pas leur état), `/api/plugins`, `/api/health`. Limite assumée.
  *(Levée pour `/api/house` le 2026-11-01 (nuit) : le plan est filtré par compte, voir la dernière section.)*
- **WebSocket** (`ws/hub.ts`) : chaque connexion retient son compte ; `filterMessage` (`http/rights.ts`)
  filtre le snapshot (devices, scenes, automations, shopping) et les messages devices, state, deviceEvent,
  availability, scenes / scene, automations, shopping ; le reste passe. Une sérialisation par jeu de droits,
  pas par client. Les droits sont relus à chaque connexion (`preHandler` de `/ws`) et à chaque ping (15 s,
  `refreshRights()`) : droits changés → nouveau snapshot à ses écrans ; compte retiré → écran fermé, code
  1008. Réseau local et comptes sans liste : comportement inchangé (GitNexus classait `WsHub` CRITICAL, d'où
  ce soin). L'app web ne lit scenes / automations / shopping que par le WebSocket : un compte limité n'a donc
  aucune erreur au démarrage.
- **Push** : voir [1_16](1_16_notifications-push.md).

**Constat qui corrige la puce « Outils MCP » de « Ce qui dépend du compte ».** Elle dit que les outils rejouent
les routes de l'app au nom du compte. C'est vrai de la plupart (`call` passe par `app.inject` +
`actAsHeaders`, donc par le hook), mais `send_command` et `recall_scene`, et des lectures (`list_devices`,
`get_device`, `get_device_history`, `list_scenes`, `get_weather`), agissent **directement** sur le registre
ou l'hôte, sans route : le hook ne les voit pas. Ils vérifient donc eux-mêmes (`mayUse`, message `NO_RIGHT`
en français, `mcp/server.ts`). Voir [1_7](1_7_serveur-mcp.md).

**Reste à faire (phase 3).** *(Faite le soir même : section suivante.)* Masquer dans l'app les entrées de menu, vues et marqueurs 3D interdits
(exposer les droits dans `GET /api/session`). Aujourd'hui une vue interdite reste dans le menu, **vide**.

Vérifié : suite complète verte (2 610 tests), typecheck et lint globaux. Tests : `http/rights.test.ts`,
`mcp/users-routes.test.ts`, `mcp/server.test.ts` (« rights of the account »), `core/push/push.test.ts`,
`test/integration.test.ts` (« rights of an account » : commande refusée, liste filtrée, vrai WebSocket
filtré, nouveau snapshot après changement, fermeture 1008). L'interface : [4_7](../4_ui/4_7_reglages.md).

### Mise à jour 2026-11-01 (soir) - phase 3 : l'app cache ce que le compte ne peut pas utiliser

Constat sur un compte limité, sous l'adresse publique : toutes les icônes restaient dans le rail, une vue
interdite s'ouvrait **vide** avec un toast brut `errors.NO_RIGHT` (clé non traduite), et Réglages montrait
tous les plugins. Le serveur refusait déjà tout (phases 1 et 2) : il ne manquait que l'écran.

- **Le serveur dit les droits** : `GET /api/session` rend `{ user, rights? }` (`http/session.ts`).
  `rights` n'est là que si le compte a une liste ; absent = tous les droits, comme sur le réseau local
  (`user: null`, jamais de `rights`). Test : `http/session.test.ts`.
- **Un store** `stores/session.ts` : `user`, `rights` (`undefined` = tous), `ready()` (lu une seule fois),
  `may(right)`. Il est relu à chaque snapshot WebSocket **sauf le premier** : le hub renvoie un snapshot
  quand les droits d'un compte changent (phase 2), donc l'écran ouvert suit sans rechargement. Branché dans
  `devices.start()` (`onMessage`).
- **Le routeur attend** (`router/index.ts`, `beforeEach` → `session.ready()`) avant la première vue : sans
  cela, une vue interdite serait montée un instant, ses requêtes partiraient et le serveur répondrait
  `NO_RIGHT`.
- **`lib/navItems.ts`** : chaque entrée porte `rights?: Right[]` (**un seul** droit suffit). **Ouvrants =
  covers OU access**, parce que le portail et le garage y vivent : un compte qui n'a que `access` doit les
  voir. Maison, Réglages, TENS (personnel, local au poste) et Demander n'exigent aucun droit. Helpers
  `navAllowed(item, rights)`, `navItemOf(route)` (lit `meta.nav`, pour les sous-pages comme l'édition d'une
  automatisation) et `visibleNavItems(..., rights)`. Le rail (`NavRail`), la recherche (`useSearch`) et la
  carte « Barre de navigation » de Réglages (`NavOrderCard`) filtrent avec.
- **Une vue interdite ouverte par son adresse** (favori, lien) est remplacée par `NoRightView` dans
  `App.vue`, **dans le même `keep-alive`** pour ne pas perdre le cache de la vue Maison : « Le compte X
  n'a pas accès à « Vue » », l'aide « Les droits d'un compte se règlent depuis le réseau local, dans
  Réglages → Comptes », et un bouton « Retour à la maison ». La vue n'est jamais montée.
- **Réglages** sans le droit `settings` : voir [4_7](../4_ui/4_7_reglages.md).
- **i18n** : `errors.NO_RIGHT` (fr, en) pour les refus qui passent quand même, objet `noRight.*`, aide
  `mcpUsers.rightsHint` réécrite (elle disait que l'entrée de menu restait affichée).

**Écarté** : griser l'entrée plutôt que la masquer. L'utilisateur voulait que les icônes disparaissent.
**Limite qui restait** : les marqueurs 3D de la vue Maison montraient encore l'emplacement des appareils
cachés, parce que `/api/house` les décrit (limite déjà notée en phase 2) ; seuls leur état et leurs commandes
étaient refusés. *(Levée le soir même : section suivante.)*

Vérifié : tests des dossiers touchés et suite complète, typecheck, lint ; preview mock en forçant les droits
dans le store pinia (rail réduit à 8 entrées, page de refus centrée en fr et en, 375 px sans débordement,
Réglages réduits, console sans erreur). **Non joué** : un vrai compte limité sous l'adresse publique (le mock
n'a pas de session, les droits y ont été posés à la main). Piège d'outillage : GitNexus `impact` a rendu des
résultats incohérents pour `createAppSession` et `visibleNavItems` (même CRITICAL, mêmes 661 appelants
directs) ; les appelants ont été vérifiés par recherche texte.

### Mise à jour 2026-11-01 (nuit) - le plan de la maison est filtré par compte

Jusqu'ici `house.json` restait lisible par tous les comptes : un compte limité voyait le **nom et
l'emplacement** des appareils cachés, d'où leurs marqueurs dans la 3D de la vue Maison (limite notée en
phase 2 et en phase 3). Le serveur filtre maintenant le plan à ses trois sorties :

- `GET /api/house` (`http/routes.ts`, dépendance `houseView` passée par `app.ts`, absente = plan entier) ;
- le message WebSocket `house` (`filterMessage` gagne un `case 'house'` ; `ws/hub.ts` utilise le nouveau
  `registryRight(registry)`, qui remplace la fermeture écrite en dur) ;
- la ressource MCP `kasbah://house` (`mcp/server.ts`, `houseView(deps.auth.users, deps.registry, user)`).

**Règles** (`filterHouse(house, rights, rightOf)`, `http/rights.ts`) :
- un appareil du plan, relié et connu du registre, prend le droit de son descripteur (`deviceRight` : portail,
  garage et fenêtre demandent donc `access`) ;
- un appareil inconnu du registre (plugin absent) ou non relié est jugé sur son indice `kind`
  (`kindRight`, `packages/shared/src/rights/rights.ts`) ; sans `kind`, il reste ;
- un capteur ne demande aucun droit : il reste ;
- **le droit `settings` voit tout le plan**, puisqu'il l'édite. Sans risque : les écritures du plan se font
  appareil par appareil (`PUT /api/house/devices/:id`…), jamais en renvoyant le plan entier ; un plan
  filtré n'efface donc rien ;
- réseau local (`user === null`) et comptes sans liste : plan entier, inchangé.

`kindRight` est ajoutée **à côté** de `deviceRight` plutôt que d'en changer la signature : GitNexus classe
`deviceRight` CRITICAL (beaucoup d'appelants).

**Effet côté app, sans code web** : la vue Maison reçoit moins d'appareils, donc leurs marqueurs, panneaux et
entrées de recherche disparaissent. Un volet caché laisse sa fenêtre **sans tablier** (`dressedOpenings` de
`HouseScene` ne la voit plus habillée).

Tests : `http/rights.test.ts` (filtre, `kind` de repli, `settings` et liste absente = plan entier, message
`house`), `test/integration.test.ts` (compte limité aux lumières : ni volets, ni portail, ni véhicule,
capteurs gardés ; compte sans liste : plan entier), `mcp/server.test.ts` (ressource filtrée). Suite complète
(2 614 tests), typecheck et lint globaux verts. **Non joué** : la preview (le mode simulé n'a ni serveur ni
comptes) et un vrai compte limité sous l'adresse publique.

### Mise à jour 2026-11-08 - connexion pour tout le monde, super-utilisateurs, compte de la maison

**Pourquoi.** Le réseau local était « la maison » (`req.sessionUser === null`) : sans compte, avec tous les
droits, et seul à atteindre les routes `LAN_ONLY` (comptes, mise à jour, Matter, journal de l'assistant).
Un invité sur le Wi-Fi avait donc plus de pouvoir que n'importe quel compte, y compris un compte en lecture
seule créé avec soin. Décision de l'utilisateur : connexion pour tout le monde, partout, **sans migration
ni mode de transition** ; des super-utilisateurs ; un compte de la maison désigné. Les sections datées
d'avant décrivent le modèle remplacé (« le réseau local est de confiance ») : elles ne sont pas réécrites.

**Les rôles.** Champs facultatifs `admin: true` et `house: true` de chaque compte de `mcp-users.json`
(écrits seulement à vrai, `mcp/auth.ts`). Un seul compte de la maison : en marquer un démarque les autres.
Refus 409 `LAST_ADMIN` de retirer le rôle au dernier admin ou de le supprimer (seulement s'il existe au
moins un admin : un fichier sans admin reste utilisable pour l'amorcer). Route `PUT /api/mcp/users/:name/role`
`{ admin?, house? }` ; `GET /api/mcp/users` rend les rôles ; `saveUser` garde tous les champs et la place du
compte dans la liste. Le premier admin se crée par le script : `npm run account -w @kasbah/server`
(ancien `mcp-user`), sous-commandes `add <nom> [--admin]`, `remove <nom>`, `admin <nom> on|off`,
`house <nom> on|off`, `list` (affiche les rôles).

**La barrière, pour tous les hôtes** (`publicHostFilter`, `isLoopbackRequest` et `isPrivateAddress`
dans `mcp/auth.ts`, `lanGate` dans `http/session.ts`). `UNKNOWN_HOST` et `BAD_ORIGIN`, inchangés, sont
contrôlés avant.

| Appelé par | Ce qui se passe |
|---|---|
| le nom public (`MCP_PUBLIC_URL`, proxy du NAS, à la maison comme dehors) | session obligatoire, comme avant |
| **la machine elle-même** : pair loopback **et** nom loopback (`localhost`, `127.x`, `[::1]`, `*.localhost`) **et** pas de `X-Forwarded-For` | de confiance, admin implicite (`req.account = null`) |
| tout autre nom local (`http://<ip>:8787`) | `lanGate` : seuls passent les flux des enceintes, le manifest et `/icons/` ; une page HTML part en 302 vers la même adresse sous `MCP_PUBLIC_URL` ; le reste 401 `AUTH_REQUIRED` |
| les chemins MCP | passent (ils ont leurs jetons) |

- **La machine** couvre le dev (Vite garde le `Host` du navigateur, ni `changeOrigin` ni `xfwd`), les retours
  OAuth en `http://localhost:8787` (Nest, Tesla) et les outils MCP rejoués par `app.inject`. Les trois
  conditions se cumulent : un proxy posé sur la même machine ajoute `X-Forwarded-For` et n'est donc pas
  pris pour elle.
- **Flux d'enceintes** : `/api/music/stream/:sid` et `/api/music/raw/:sid.ext`, GET / HEAD seulement. Une
  enceinte n'a ni cookie ni compte ; le `sid` fait 96 bits aléatoires et vit peu : c'est une **URL de
  capacité**, aucune signature n'est écrite.
- **Aucune connexion possible en HTTP** (cookie `__Host-` Secure) : l'adresse locale en clair ne sert plus
  que ces URL de capacité.
- Sans `MCP_PUBLIC_URL` : avertissement au démarrage ; seule la machine ouvre Kasbah.
- **Piège** : une requête sans socket (un WebSocket injecté par les tests, `injectWS`) faisait planter la
  détection (500). `req.socket?.remoteAddress`, et sans socket ce n'est pas la machine.

**Deux notions par requête.** `req.account` (nouveau) est le compte **connecté** : droits, rôle, WebSocket,
push, filtres du plan, `mayUse` MCP, `runToken`. `req.sessionUser` (inchangé) est le **propriétaire des
données personnelles**. `ownerOf(file, account)` : le compte de la maison donne `null`, donc ses données
sont celles de la maison (`.state/claude.json`, cookie YouTube Music de la maison…) ; aucun plugin n'a été
modifié pour cela. `actAsHook` devient une fabrique `actAsHook(users)` ; `requireToken` pose les deux.

**Droits : `settings` fusionné dans admin** (`packages/shared/src/rights/rights.ts`, `http/rights.ts`).
16 domaines au lieu de 17 ; type `Need = Right | 'admin' | null`, garde `isRight`. Tout ce qui demandait
`settings` demande admin (PATCH plugin, écritures `house` / `properties`, login / pair / token / raw / auth
des plugins…) ; une route inconnue demande admin (test `unmappedRoutes` gardé). `Access {admin, house,
rights}`, `allows()` ; `accountRights` rend des `Access` ; un admin a `rights` absent ; **un nom sans compte
n'a droit à rien** (avant : tout). `filterHouse` : rights absents = plan entier (admin, ou compte sans
liste). `grants` (classé CRITICAL par GitNexus) n'a pas été modifié. Un `"settings"` resté dans
`mcp-users.json` est ignoré à la lecture (sinon `readUsers` rendait une liste vide et bloquait **tous** les
comptes) : testé.

**`ADMIN_PATHS`** = `/api/mcp/users`, `/api/system`, `/api/matter`, `/api/assistant/log` (toute méthode).
Ces quatre exigent **en plus** un client à la maison : `clientOf` (dernière entrée de `X-Forwarded-For`,
posée par le proxy) dans une plage privée, sinon 403 `LAN_ONLY` « managed from home only ». La raison
d'être de `LAN_ONLY` change : ce n'est plus « le réseau local est de confiance », c'est « une session admin
volée, dehors, ne doit pas gérer les comptes ».

**Côté app.** `GET /api/session` rend `{ user, admin?, house?, rights? }` ; la machine : `{ user: null,
admin: true }` ; `rights` seulement pour un non-admin avec liste. WebSocket (`ws/hub.ts`) : clé `*!` pour un
admin, pour qu'un changement de rôle renvoie un snapshot (l'app relit alors la session). Push : abonnement
retenu par `req.account` ([1_16](1_16_notifications-push.md)). Assistant : agit au nom de `req.account`
([1_9](1_9_assistant.md)). Repli musical sur le cookie de la maison : [3_16](../3_plugins/3_16_ytmusic.md).
Carte Comptes et Réglages : [4_7](../4_ui/4_7_reglages.md).

**Écarté.** Garder la confiance au réseau local (invité Wi-Fi > comptes) ; URL signées pour les enceintes
(le `sid` aléatoire suffit) ; pare-feu obligatoire sur 8787 (le HTTP local ne sert plus que des URL de
capacité, il reste facultatif) ; `settings` distinct d'admin (l'utilisateur a voulu la fusion) ; migration
ou mode de transition (refusé).

**Reste ouvert.** (1) Vérifier sur le vrai proxy qu'il ajoute bien `X-Forwarded-For` : ouvert depuis le
2026-10-24, devenu **critique**, car c'est lui qui dit « client à la maison » (sans l'en-tête, `clientOf`
verrait le proxy, donc une adresse privée, et `LAN_ONLY` ne protégerait plus rien : déduction du code, non
essayée). (2) Appli Android : retirer le cas « réseau local : `/login` renvoie à l'accueil sans cookie »
([1_15](1_15_appli-android-auto.md)). (3) **Non joué** : une vraie connexion par l'adresse publique avec le
proxy du NAS.

Vérifié : suite complète (2 805 tests), typecheck global, lint du code suivi ; serveur de démonstration en
dev : `{ user: null, admin: true }` par Vite, 401 par l'IP locale, flux d'enceinte qui passe la barrière.
