# Serveur MCP (`/mcp`)

> Dernière mise à jour : 2026-10-24
> Sources : `apps/server/src/mcp/server.ts`, `apps/server/src/mcp/auth.ts`, `apps/server/src/http/session.ts`, `apps/server/src/mcp/users-cli.ts`, `apps/server/src/mcp/users-routes.ts`, `apps/web/src/components/settings/McpUsersCard.vue`, `apps/server/src/mcp/auth.test.ts`, `apps/server/src/music/player.ts`, `apps/server/src/plugins/{ytmusic,mixcloud,radio}/index.ts`, `apps/server/src/mcp/server.test.ts`, `apps/server/src/app.ts` (`registerMcp`), `apps/server/package.json`, `README.md` (section « Serveur MCP »), arbre de travail du 2026-09-23 (après c9abf58), `apps/server/src/assistant/assistant.ts` ; arbre de travail NON COMMITÉ du 2026-10-09 (après 00397bc) : `apps/server/src/mcp/{server,server.test}.ts`, `README.md`, `packages/shared/src/shopping/shopping.ts` (2026-10-11)

## Ce que c'est

Kasbah expose ses appareils à un agent (Claude Code, VS Code, Cursor…) par le
[Model Context Protocol](https://modelcontextprotocol.io). C'est une **deuxième façade** sur les
mêmes données que le REST (`1_3_protocole-rest-ws.md`) : aucune logique propre, les outils appellent
le registre d'états, le registre des scènes et l'hôte de plugins comme le font les routes.

Point d'accès : `http://localhost:8787/mcp`, Streamable HTTP, démarré avec le serveur, rien à activer.
La configuration des clients est dans le `README.md` (section « Serveur MCP »). Depuis le 2026-10-20,
le README est en anglais : la section s'appelle « MCP server » (« Serveur MCP » dans `README.fr.md`).

## Décisions (2026-09-23)

- **SDK TypeScript officiel v2** : `@modelcontextprotocol/server` + `@modelcontextprotocol/fastify`
  (2.0.0, publiés le 2026-09-17). Le v2 remplace le paquet monolithique `@modelcontextprotocol/sdk`
  (1.30), écarté parce qu'il reste sur la spec 2025. FastMCP (Python) a été écarté : un deuxième
  environnement d'exécution et ses dépendances pour un projet tout en TypeScript.
- **Spec 2026-07-28, sans état** : plus de session (`Mcp-Session-Id`), plus de poignée de main
  `initialize` ; chaque requête porte sa version dans `_meta`. `createMcpHandler` crée donc un
  `McpServer` **par requête** (fabrique `buildServer`). Les clients 2025 sont servis aussi
  (`legacy: 'stateless'`, défaut du SDK) — c'est ce que parlent les clients d'aujourd'hui.
- **Dans Fastify plutôt qu'un paquet `apps/mcp` en stdio** (choix de l'utilisateur) : lecture directe
  du registre sans aller-retour REST ni processus en plus, et la même adresse le jour d'un accès
  distant. L'absence d'état de la nouvelle spec est ce qui rend ce montage trivial.
- **Périmètre : lecture + commandes** (choix de l'utilisateur). Ni écriture de `house.json`, ni
  réglage de plugin, ni appairage.

## Outils et ressource

| Outil | Ce qu'il fait |
|---|---|
| `list_devices` | appareils + état ; filtres `kind`, `room`, `query` (sous-chaîne sans casse). Nom et pièce tels que la **maison** les donne (`indexHouse().devicesByBinding` → `roomId` → nom de pièce), sinon ceux du descripteur (`meta.room`) |
| `get_device` | l'entrée complète (descripteur, capacités, meta, état) |
| `send_command` | `commandSchema` + `assertCommandAllowed` + `host.execute` — exactement la chaîne de `POST /api/devices/:id/command` |
| `list_scenes` / `recall_scene` | scènes des fabricants ; le rappel valide `sceneRecallSchema` et refuse `dynamic` sans palette animée, comme la route |
| `get_health` | `host.health()` |
| `search_music` | cherche dans YouTube Music (défaut), Mixcloud ou Radios ; `query`, `source`, `limit` (1 à 25). Lecture seule |
| `play_music` | joue une piste ou une file (jusqu'à 100) sur un `media_player` qui a `play_url`, via `POST /api/music/queue` |
| `play_radio` | joue une station (`stationId` venu de `search_music`) sur un `media_player` qui a `play_url`, via `POST /api/plugins/radio/play` |
| `get_school` | cahier de texte, cahier de liaison et publications de TouteMonAnnée, en lecture seule ; `section`, `includePast`, `includeHidden` |
| `get_weather` | météo de la maison ou d'un lieu (`place`) : état, prévisions, air, pollens, vigilance à venir *(2026-10-09)* |
| `get_agenda` | événements des agendas sur `from` + `days` (1 à 62, défaut 7), en lecture seule *(2026-10-09)* |
| `list_automations` / `run_automation` / `set_automation_enabled` | statut des règles, lancement immédiat, activation *(2026-10-09)* |
| `create_automation` / `update_automation` | création et modification d'une règle ; pas de suppression *(2026-10-15)* |
| `get_music` / `queue_music` / `control_music` | ce qui joue et la file, ajout sans interruption, pilotage de la file *(2026-10-09)* |
| `get_device_history` | énergie (`hours` 1 à 48), journal du fabricant, consommation d'eau *(2026-10-09)* |
| `get_shopping_list` / `add_shopping_items` / `update_shopping_item` / `remove_shopping_item` / `finish_shopping` / `set_shopping_favorite` | liste de courses de la maison : lire, ajouter, cocher ou changer la quantité, retirer, retirer les cochées, marquer un habituel *(2026-10-11)* |

> Mis à jour le 2026-10-06 (lint) : le tableau passe de 6 à 10 outils (`apps/server/src/mcp/server.ts`) ; `search_music`, `play_music` et `play_radio` viennent de la section 2026-09-23 (soir), `get_school` de la section 2026-10-04 (l'école).

> Mis à jour le 2026-10-09 : le tableau passe de 10 à **19** outils (9 ajouts, voir la section du 2026-10-09 en bas de page).

Ressource `kasbah://house` : le `house.json` validé.

Comme en REST, une commande réussit **à l'accusé du fabricant** et ne rend pas l'état : l'agent le
relit par `get_device`. Un appareil inconnu est rendu en `isError: true` ; une exception
(`CommandNotAllowedError`, `PluginError`) est convertie en `isError` par le SDK — l'agent lit un
message, pas une erreur de protocole.

## Sécurité : OAuth, puis liste d'hôtes

Depuis le 2026-10-04 (soir), **jeton OAuth exigé sur `/mcp`, réseau local compris** (`auth.ts`,
détail dans la mise à jour en bas de page). Jusque-là, aucune authentification.

En plus, la sous-application porte `hostHeaderValidation()` (toutes ses routes, OAuth compris) et
`originValidation()` (`/mcp` seul) du SDK, avec `ALLOWED_HOSTS` plus le nom de `MCP_PUBLIC_URL` :
un `Host` ou un `Origin` hors de `localhost` / `127.0.0.1` / `[::1]` / `kasbah` /
`kasbah.home.internal` / nom public reçoit **403**. C'est une protection contre le **DNS rebinding**,
pas un contrôle d'accès (un client peut forger son `Host`) : le contrôle d'accès, c'est le jeton.
Le reste de Kasbah (interface web, API REST) reste sans authentification, réservé au réseau local.
*(Dépassé le 2026-10-06 : sous le nom public, le reste de Kasbah n'est plus fermé, il est derrière une session ; sur le réseau local, il reste sans compte. Voir « Mise à jour 2026-10-06 (soir) — toute l'application derrière une connexion ».)*

## Plomberie Fastify

- Fastify a **déjà lu** le corps JSON : la route reconstruit une `Request` web (en-têtes recopiés sans
  `content-length`, corps `JSON.stringify(req.body)`) et renvoie la `Response` du SDK par
  `reply.send()`, que Fastify 5 sait envoyer. `@modelcontextprotocol/node` (`toNodeHandler`) n'a pas
  été pris : il tire `hono` et `@hono/node-server` pour une conversion de dix lignes.
- `compress: false` sur la route : `@fastify/compress` est enregistré en global
  (`1_2_serveur-et-plugins.md`) et la réponse peut être un flux SSE.
- `handler.close()` sur le crochet `onClose` de l'application.

## Tests et vérification

`apps/server/src/mcp/server.test.ts` monte l'application réelle (maison de démo, plugin `mock`
seul) sur un port libre et l'interroge avec le **vrai client** `@modelcontextprotocol/client`
(dépendance de dev), dans les **deux ères** par `describe.each` : `versionNegotiation.mode`
`'legacy'` et `{ pin: '2026-07-28' }`. Couvert : liste des outils, filtre par kind, commande suivie
par le registre, erreurs d'outil (appareil inconnu, commande refusée par les capacités), ressource,
403 sur un `Host` étranger.

Vérifié aussi sur le bundle de production (`dist/main.js`, maison de démo, port 8799) : `initialize`
en `2025-06-18` puis `tools/call list_devices` par `curl` — pièces résolues depuis la maison.

Les configurations de clients du `README.md` (Claude Code, VS Code, Cursor, Claude Desktop via
`mcp-remote`) n'ont **pas** été essayées. *(Dépassé : Claude Code, Claude (web, mobile, Desktop), ChatGPT, Mistral Vibe et Grok ont été essayés et vérifiés depuis — voir les mises à jour du 2026-10-04 et du 2026-10-06 plus bas ; constat du lint du 2026-10-06. Seuls VS Code et Cursor restent non essayés.)*

## Suites possibles

- **Accès distant** : fait le 2026-10-04 (OAuth, mise à jour en bas de page). Reste à poser le
  tunnel HTTPS et à ajouter le connecteur sur claude.ai.
  *(Dépassé le 2026-10-04 : en service par le proxy inversé, connecteur ajouté et vérifié depuis l'app Claude mobile — voir « Mise à jour 2026-10-04 (soir) — en service ».)*
- **Notifications** : `subscriptions/listen` (2026-07-28) et `handler.notify` permettraient de
  pousser les changements d'état ; rien n'est branché.

### Mise à jour 2026-09-23 (soir) — la musique : `search_music`, `play_music`, `play_radio`

**Pourquoi.** Premier essai réel depuis Claude Desktop : « lance un titre d'un artiste ». L'agent a
demandé quelle source (YouTube Music, Spotify, Apple Music — les deux derniers n'existent pas ici),
puis a tenté `send_command` avec `media_player.play_url`, qui attend l'URL d'un **flux** (MP3, AAC,
HLS) et non un titre : il n'avait aucun moyen de la trouver. Tout ce qu'il fallait existe déjà dans
les sources et le lecteur commun (`1_6_lecteur-musique.md`) ; il manquait de le lui montrer.
Périmètre choisi par l'utilisateur : chercher + jouer (ni pilotage de la file, ni albums/playlists).

| Outil | Passe par |
|---|---|
| `search_music` (`query`, `source` = `ytmusic` par défaut / `mixcloud` / `radio`, `limit` ≤ 25) | `GET /api/plugins/{ytmusic,mixcloud,radio}/search` ; titres ytmusic seuls (ni artistes ni albums), rendus dans la forme d'une piste du lecteur commun (`{ source, id, title, artist, artUrl, durationS, explicit }`, mêmes champs que `MusicView.vue` / `MixcloudBrowser.vue`), stations en `stationId` |
| `play_music` (`deviceId`, 1 à 100 pistes) | `POST /api/music/queue` : une file, dans l'ordre, qui remplace ce que jouait l'appareil |
| `play_radio` (`deviceId`, `stationId`) | `POST /api/plugins/radio/play` (direct, `live: true`) |

La description de `search_music` dit **qu'il n'y a ni Spotify ni Apple Music** et à quel outil passer
chaque résultat : c'est elle qui évite la question de l'agent.

**Par les routes, pas par les fonctions.** Les outils appellent les routes existantes par
`app.inject` (aucun réseau). La recherche est une fermeture dans chaque plugin, le lecteur commun
porte ses validations (source coupée → 400, file ≤ 1 000) et surtout `publishBase` : l'adresse
publiée aux enceintes, qui **refuse** une requête en localhost sans `MUSIC_PUBLISH_BASE` /
`YTM_PUBLISH_BASE`. Un appel injecté n'a pas d'autre Host que localhost : **la musique par MCP
exige donc cette variable** (réglée dans le `.env` réel). Une réponse d'erreur des routes devient une
exception, rendue en `isError` avec le message de la route (cookie YTM expiré, source non activée).
*(Précisé le 2026-10-07 : ces appels injectés ne sont plus « sans compte » — ils portent le compte du jeton (`x-kasbah-user`, voir la mise à jour du 2026-10-07 en bas de page), donc le cookie en question est celui de ce compte, pas forcément celui de la maison.)*

**Vérifié.** Recherche en direct sur le serveur réel, trois sources (un nom d'artiste : titres
YouTube Music, une station, des mixtapes Mixcloud). Lancement **non** essayé sur
le vrai matériel (utilisateur absent) : test sur une enceinte simulée avec une source `ytmusic`
factice inscrite par `registerMusicSource` (la piste arrive dans `GET /api/music/queue`), et source
non inscrite → `isError` qui la nomme (`apps/server/src/mcp/server.test.ts`). Les nouveaux outils
sont apparus dans un client déjà connecté sans le redémarrer.

**Limites connues.** `media_player.next` / `previous` de `send_command` ne sautent pas dans la file
Kasbah (l'enceinte ne connaît qu'un « fichier » : ce sont les routes `/api/music/queue/{next,previous}`) —
à exposer si le besoin vient. *(Levée le 2026-10-09 : `control_music` pilote la file Kasbah — voir la section en bas de page.)* La pochette ytmusic de la recherche est la vignette 120 px du
catalogue ; le lecteur la remonte à 544 px pour l'enceinte (`playArt`).

### Mise à jour 2026-10-04 — `/mcp` joignable sous le nom `kasbah`

**Pourquoi.** Claude Desktop était configuré avec `mcp-remote http://kasbah:8787/mcp` et affichait
« Server disconnected ». Le serveur tournait, mais les crochets localhost refusaient `Host: kasbah:8787`
(mesuré : **200** en `localhost`, **403** en `kasbah`). Le nom `kasbah` vient du DNS local
(une zone `home.internal` qui résout `kasbah` vers le serveur). Vite avait eu le même
problème, réglé par `allowedHosts` (`apps/web/vite.config.ts`).

**Ce qui change.** `localhostHostValidation()` / `localhostOriginValidation()` deviennent
`hostHeaderValidation(ALLOWED_HOSTS)` / `originValidation(ALLOWED_HOSTS)`. La liste
(`apps/server/src/mcp/server.ts`) reprend les trois noms localhost du SDK et y ajoute `kasbah` et
`kasbah.home.internal`, les mêmes noms que Vite. Elle est écrite en dur, comme dans Vite, et n'est
pas une variable d'environnement. `/mcp` est donc ouvert au réseau local, **sans authentification**.
La protection contre le DNS rebinding tient toujours pour les autres noms (test : `kasbah:8787`
passe, `evil.example:8787` reçoit 403). Le client n'a plus besoin d'être sur la machine du serveur.

**Piège côté client.** `mcp-remote` refuse lui-même une URL `http://` qui n'est pas localhost
(« Non-HTTPS URLs are only allowed for localhost or when --allow-http flag is provided ») : ajouter
`--allow-http` après l'URL dans la configuration de Claude Desktop.

### Mise à jour 2026-10-04 — l'école : `get_school`

**Pourquoi.** L'utilisateur veut lire les devoirs par MCP. Le plugin TouteMonAnnée (`3_23_toutemonannee.md`)
ne publie aucun appareil : rien ne passait par `list_devices`. Périmètre choisi par l'utilisateur :
devoirs, cahier de liaison et publications, **en lecture seule** (pas d'outil pour cocher « fait »,
qui écrit sur le site de l'école).

| Entrée | Effet |
|---|---|
| `section` (`all` par défaut / `homework` / `messages` / `posts`) | ne rend que cette partie |
| `includePast` (faux) | ajoute les devoirs dont la date est passée (le plugin en garde `TMA_PAST_DAYS`) |
| `includeHidden` (faux) | ignore les filtres classes / niveaux de la vue École |

**Par la route, comme la musique.** L'outil lit `GET /api/plugins/toutemonannee/school` par `app.inject` ;
plugin absent → 404 → `isError`, compte non relié → `isError` qui dit de le relier dans la vue École.
La mise en forme est une fonction pure exportée, `schoolDigest` : mêmes filtres que `isVisible` de
`apps/web/src/lib/school.ts` (recopiés : le serveur n'importe pas le web), devoirs à venir triés par
date puis id (`today` = date locale du serveur), classe nommée au lieu de son uuid, pièces jointes
réduites à `{ name, url }`, champs vides omis. Messages avec `read`, publications avec `new`
(`id > postsSeen`, comme la pastille de la vue). Une session perdue rend `error` avec la dernière lecture.

**Vérifié.** Tests de `schoolDigest` (filtres, passés et masqués sur demande, section, session perdue)
et de l'outil sans le plugin (`isError`). `schoolDigest` lancé sur la vraie réponse de `/school` : les
devoirs d'une classe masquée sont écartés par le filtre gardé, les cases « fait » sont rendues. Après redémarrage, appelé
depuis Claude Code par `mcp-remote http://kasbah:8787/mcp --allow-http` (« quels sont les devoirs de la semaine ? ») : `section: homework` rend les devoirs à venir.

### Mise à jour 2026-10-04 (soir) — authentification OAuth sur `/mcp`

**Pourquoi.** L'utilisateur veut Kasbah dans Claude **sur le téléphone**. L'app mobile n'a ni
`mcp-remote` ni configuration locale : seulement les connecteurs claude.ai, qui appellent depuis le
cloud d'Anthropic, pas depuis le téléphone. `/mcp` doit donc être joignable depuis Internet, et
porter un vrai contrôle d'accès.

**Décisions de l'utilisateur.**
- **Le MCP seul pour l'instant.** L'interface web en déplacement passera plutôt par un VPN (Tailscale) :
  rien à coder, et ni les caméras ni l'API exposées. Une authentification sur toute l'application
  reste possible plus tard, en réutilisant la même page de connexion.
  *(Renversé le 2026-10-06 : « plus tard » est arrivé, et sans VPN — voir « Mise à jour 2026-10-06 (soir) ».)*
- **Jeton exigé partout, réseau local compris** : un seul chemin, rien qui dépende d'une provenance
  (derrière un tunnel, tout arrive de `cloudflared` en local) ni d'un `Host` forgeable. Le port
  dédié au public, envisagé d'abord, a été écarté.
- **Comptes dans un fichier à côté du `.env` serveur** (`apps/server/mcp-users.json`, ignoré par git),
  plus pratique que `.state/`.

**Montage (`apps/server/src/mcp/auth.ts`).** Kasbah est à la fois serveur de ressource et son
propre serveur d'autorisation : le SDK v2 n'apporte **aucun** outil d'auth côté serveur (le v1 avait
`mcpAuthRouter` / `requireBearerAuth`), tout est écrit à la main.

| Route | Rôle |
|---|---|
| `/.well-known/oauth-protected-resource[/mcp]` | RFC 9728 : la ressource et son serveur d'autorisation |
| `/.well-known/oauth-authorization-server` | RFC 8414 : endpoints, `S256` seul, `token_endpoint_auth_methods_supported: ['none']`, `client_id_metadata_document_supported`, `authorization_response_iss_parameter_supported` |
| `POST /oauth/register` | enregistrement dynamique (RFC 7591), clients publics, redirection https ou http loopback ; 50 clients au plus, les plus anciens sortent |
| `GET/POST /oauth/authorize` | page de connexion (nom du client et hôte de retour affichés), code à usage unique 60 s, retour avec `code`, `state`, `iss` |
| `POST /oauth/token` | `authorization_code` (PKCE vérifié) et `refresh_token` (tourné à chaque usage) |
| crochet sur `/mcp` | `Bearer` valide, sinon 401 + `WWW-Authenticate: Bearer resource_metadata="…"` (`error="invalid_token"` si un jeton était présenté) |

- **Client ID Metadata Documents** aussi (spec 2026-07-28, qui déprécie le DCR) : un `client_id` en
  `https://` est lu (5 s, 64 Ko, pas de redirection), doit se nommer lui-même, mis en cache 1 h.
  On ne sait pas lequel des deux claude.ai emploie : les deux sont servis.
- **Émetteur lu sur la requête** : `http://<Host>` sur le réseau local, `MCP_PUBLIC_URL` (https)
  quand le `Host` est le sien. Les deux URL des métadonnées collent donc à ce que le client a appelé.
- **Mots de passe** : scrypt (`node:crypto`), `scrypt$<sel>$<clé>`. Un compte inconnu coûte le même
  calcul. Le fichier des comptes est relu quand son `mtime` change : **retirer un compte coupe ses
  jetons** sans redémarrage. Échecs plafonnés **globalement** (10 par quart d'heure → 429) : derrière
  un tunnel, toutes les requêtes ont la même adresse.
- **Jetons opaques**, gardés hachés (SHA-256) dans `.state/mcp-auth.json` (0600), avec les clients :
  accès 1 h, renouvellement 90 jours glissants. Les codes restent en mémoire.
- **Page de connexion** : HTML inline, clair / sombre, `X-Frame-Options: DENY`, CSP sans script.
  **Pas de `form-action`** dans la CSP : Chrome l'applique aussi à la redirection 302 qui suit le
  formulaire, et bloquait le retour vers le client (« violates … form-action 'self' »). Vu dans le
  navigateur seulement : les tests, qui postent par `fetch`, ne le voient pas. Verrouillé depuis par
  un test.
- **Comptes** : `npm run mcp-user -w @kasbah/server -- add|remove <nom>` / `list`
  (`src/mcp/users-cli.ts`), saisie sans écho. Une seule interface `readline` lue en itérateur : avec
  une entrée redirigée, une interface par question perdait la seconde ligne.

**Piège côté client : pas d'http hors loopback.** Le SDK client (`assertSecureTokenEndpoint`, SEP-2207)
refuse d'envoyer ses identifiants à un endpoint de jeton en `http://` qui n'est pas la machine
locale. Sur le réseau local, `http://kasbah:8787/mcp` ne marchera donc plus depuis un autre poste
pour un client bâti sur le SDK : `http://localhost:8787/mcp` sur le poste du serveur, l'adresse
publique en https ailleurs. Les configurations `mcp-remote http://kasbah:8787/mcp --allow-http` d'avant
ce changement doivent passer à l'adresse publique (ou au connecteur claude.ai).

**Vérifié.**
- `auth.test.ts` (serveur d'autorisation seul, devant une route factice) : mauvais mot de passe et
  compte inconnu sans redirection, plafond d'échecs, redirection non déclarée refusée sans renvoi,
  PKCE `plain` refusé, redirection http hors loopback refusée, mauvais vérificateur / code rejoué /
  code expiré, rotation du renouvellement, expiration de l'accès, compte retiré, jetons gardés après
  redémarrage, document de métadonnées (et usurpation de `client_id` refusée), adresse publique.
- `server.test.ts` : tous les tests MCP passent par le **vrai parcours OAuth du SDK client**
  (`auth()` : découverte, enregistrement, PKCE, échange avec `iss`), dans les deux ères ; 401 et
  `WWW-Authenticate` sans jeton. Assistant : `src/mcp/test-oauth.ts`.
- Dans le navigateur, sur une instance jetable (maison de démo, plugin mock, port 9799) : page au
  format téléphone (débordement de 16 px trouvé et corrigé : `box-sizing`), clair et sombre, refus
  d'un mauvais mot de passe (l'utilisateur reste saisi), puis connexion → retour vers un écouteur
  local → échange par le SDK → `list_devices` avec le jeton (4 lampes de la démo).
- **Essayé par l'utilisateur avec Claude Code** (serveur relancé) : page de connexion, puis retour
  sur le serveur de rappel local du client (`127.0.0.1:<port>/oauth/callback`) qui affiche « Authorization
  successful! ». Cette page de retour est **celle du client**, pas de Kasbah : on ne peut pas l'embellir
  (une page intermédiaire Kasbah a été proposée puis laissée de côté : elle n'aurait été vue qu'une seconde).
- **Pas encore essayé** : un vrai connecteur claude.ai (le tunnel n'existe pas), et la saisie sans
  écho de `mcp-user` dans un vrai terminal.

### Mise à jour 2026-10-04 (nuit) — comptes dans Réglages, logo sur la page de connexion

**Pourquoi.** Demande de l'utilisateur : gérer les comptes MCP depuis l'app plutôt qu'au terminal,
le script `mcp-user` restant en secours ; et le logo de l'app sur la page de connexion.

**Serveur (`users-routes.ts`).** `GET /api/mcp/users` → `{ users: [{ name }] }` (jamais les hachés),
`PUT /api/mcp/users/:name` `{ password }` (crée ou change le mot de passe), `DELETE /api/mcp/users/:name`
(404 si absent). Nom `^[w.@-]{1,64}$`, mot de passe 8 caractères au moins (`userNameSchema`,
`passwordSchema` dans `auth.ts`, partagés avec le script). Écriture par `saveUser` / `deleteUser`
(`auth.ts`), communes au script et aux routes : un fichier absent vaut vide, un fichier **illisible fait
échouer l'écriture** (500) au lieu d'être écrasé par une liste vide — `readUsers`, lui, reste tolérant
pour la connexion. Comme tout `/api`, ouvert au réseau local sans authentification (décision assumée :
le réseau local est de confiance) ; **refusé en 404 quand le `Host` est le nom de `MCP_PUBLIC_URL`**,
au cas où le tunnel publierait plus que `/mcp`. Montées dans `app.ts` après `createMcpAuth`.
*(Précisé le 2026-10-06 : sous le nom public, ces routes rendent 401 sans session et **403 `LAN_ONLY` même avec une session** (`http/session.ts`), non plus 404 ; la carte de Réglages s'appelle désormais « Comptes ». Voir la mise à jour du 2026-10-06 (soir).)*
*(Précisé le 2026-10-07 : `deleteUser` efface aussi `.state/users/<nom>/`, les comptes musicaux du compte retiré — par la route comme par le script `mcp-user`.)*

**Web.** Section « Assistants IA (MCP) » de Réglages, avant la liste des plugins
(`components/settings/McpUsersCard.vue`, appels directs au transport : un seul consommateur, pas de
store). Lignes : nom, « Mot de passe » (le formulaire passe en changement pour ce compte, focus sur le mot
de passe), « Retirer » en deux appuis (motif armé de la carte Agenda, largeur fixe). Formulaire : nom,
mot de passe, confirmation ; contrôles côté client en français / anglais (le serveur répond en anglais),
place réservée pour l'avertissement (il décalait le bouton de 2 px : `line-height` et `min-height` à
1,5). Mode simulé : un compte `parent` en mémoire (`mockTransport.ts`).

**Logo.** `apps/web/public/icons/icon.svg` lu au chargement de `auth.ts` et **inclus dans la page**
(pas de `<img src="/icons/…">` : le tunnel ne publie pas `/icons`, et la CSP reste `default-src 'none'`).
Absent → page sans logo.

**Vérifié.** `users-routes.test.ts` (création, changement, pas de haché rendu, nom / mot de passe
refusés, retrait et 404, fichier illisible non écrasé, refus sous le nom public) ; logo présent dans la
page (`auth.test.ts`). Preview `kasbah-mock` : ajout, changement, retrait armé, rien ne bouge quand
l'avertissement apparaît (mesure géométrique), pas de débordement à 1280 et 375 px, zooms 1,25 et 1,5,
fr / en, clair / sombre. Page de connexion avec logo au format téléphone. Script `mcp-user` rejoué sur
les fonctions communes. Suite complète (1 891 tests), typecheck et lint verts.

### Mise à jour 2026-10-04 (nuit, suite) — sous le nom public, rien que le MCP

*(Dépassé le 2026-10-06 : sous le nom public, le MCP passe toujours sans session (ses jetons), mais tout le reste n'est plus rendu en 404 : il est envoyé à une porte à session. `publicHostFilter` prend cette porte en second argument, 404 reste le défaut sans elle. La procédure du proxy ci-dessous est complétée par les en-têtes WebSocket : voir « Mise à jour 2026-10-06 (soir) ».)*

**Pourquoi.** L'utilisateur préfère un **proxy inverse** (le nom est déjà
en HTTPS public, pour la clé Tesla) à un tunnel Cloudflare. Or ce proxy associe un nom et un port à une
cible et transmet **tout** : sans filtre, l'interface, l'API REST sans authentification, les caméras et
le WebSocket auraient été publiés. Un hôte virtuel de serveur de fichiers ne convient pas : il sert des
fichiers (c'est lui qui porte la clé Tesla), il ne relaie pas.

**Ce qui est fait.** `publicHostFilter` (`auth.ts`), crochet `onRequest` GLOBAL posé dans `buildApp`
avant toute route : quand le nom de la requête est celui de `MCP_PUBLIC_URL` (`Host`, ou le premier
`X-Forwarded-Host` si le proxy réécrit le `Host`), seuls `/mcp`, `/oauth/{authorize,token,register}` et
les trois documents `/.well-known/oauth-*` répondent, tout le reste rend 404 (repli SPA, `/api`, `/ws`
compris). Le tri ne dépend donc plus de la configuration du proxy. La garde propre aux routes
`/api/mcp/users` est retirée, couverte par ce filtre. `createMcpAuth` est construit en tête de
`buildApp` pour cela.

**Limite.** Si le proxy ne transmet ni le `Host` d'origine ni `X-Forwarded-Host`, Kasbah ne peut pas
reconnaître le nom public : le filtre ne s'applique pas ET l'émetteur annoncé est faux. À vérifier à la
mise en service : `https://<nom public>/` doit rendre 404, et `/.well-known/oauth-protected-resource`
annoncer l'adresse en https.

**Vérifié.** `public-host.test.ts` sur l'application assemblée : `/`, `/settings`, `/api/*`, `/ws`,
`/api/mcp/users` en 404 sous le nom public, aussi par `X-Forwarded-Host` ; MCP (401), métadonnées
(adresse https) et `/oauth/authorize` (400 sans paramètres) joignables ; réseau local inchangé. Contrôle
négatif : crochet retiré, les tests d'exposition échouent. Suite complète (1 894 tests) verte.

**Mise en service prévue (proxy inverse).** Source
`https://kasbah.example.org:443` (ou le même nom sur un autre port si le DDNS n'accepte pas de
sous-domaine), destination `http://<poste Kasbah>:8787` ; certificat Let's Encrypt associé ; 443 redirigé
vers le proxy sur le routeur ; `MCP_PUBLIC_URL` dans `apps/server/.env` ; connecteur claude.ai.
**Ordre impératif** : Kasbah relancé avec ce filtre et `MCP_PUBLIC_URL` AVANT de créer la règle, sinon
toute l'application est publiée dès l'enregistrement. Règle : source HTTPS / nom public / 443,
HTTP/2 oui, contrôle d'accès non (claude.ai appelle depuis les serveurs d'Anthropic) ; destination HTTP /
IP du poste Kasbah / 8787 ; en-têtes personnalisés vides a priori (le proxy transmet `Host` et `X-Forwarded-*`,
non vérifié : sinon `Host` = `$host`) ; pas de préréglage WebSocket (le MCP n'en utilise pas). *(Dépassé le 2026-10-06 : l'application, elle, en a besoin — en-têtes WebSocket à créer, `Host` vérifié le 2026-10-04.)*

### Mise à jour 2026-10-04 (soir) — en service : Claude mobile par le proxy inverse

**Vérifié par l'utilisateur en conditions réelles.** Proxy inversé (`kasbah.example.org`
→ poste Kasbah, port 8787) ; contrôle depuis le téléphone : `/` en 404, métadonnées annonçant l'adresse
https — le proxy transmet donc bien le `Host` d'origine, aucun en-tête personnalisé nécessaire. Connecteur
ajouté depuis l'app Claude mobile : elle détecte « Se connecter maintenant » (OAuth) et « Utiliser
l'identité publiée de Claude » (**CIMD**, préféré au DCR quand le serveur annonce
`client_id_metadata_document_supported`) ; la lecture de la vraie fiche client d'Anthropic par Kasbah
a fonctionné du premier coup. Page de connexion Kasbah, puis les outils Kasbah dans l'app.

**Limite côté compte.** Dans une **organisation** Claude (Team / Enterprise), seul un propriétaire peut
ajouter un connecteur personnalisé (« Demandez à un propriétaire de l'organisation… ») : il faut passer
par un compte personnel. Retirer l'authentification n'y changerait rien (c'est l'ajout du
connecteur qui est bloqué) ; l'annuaire des connecteurs est fait pour les éditeurs (soumission, revue).

### Mise à jour 2026-10-06 — brancher chaque assistant IA, et le dépannage

**Pourquoi.** Le README ne décrivait que Claude (connecteur claude.ai, Claude Code, Claude Desktop en
local). Les procédures des autres assistants ont été relevées les 5 et 6 octobre 2026, et
**vérifiées par l'utilisateur avec Kasbah** sur les mêmes assistants (Claude, ChatGPT, Mistral Vibe,
Grok) : aucun réglage propre à un assistant, le serveur d'autorisation (`auth.ts`) sert les deux
modes d'inscription. Détail dans le `README.md`, section « Serveur MCP » → « Brancher un assistant
IA » (« MCP server » → « Connecting an AI assistant » depuis que le README est en anglais, le
2026-10-20).

| Assistant | Configuration | Inscription auprès du serveur |
|---|---|---|
| Claude (claude.ai, app mobile) | app web, connecteur personnalisé ; suit le compte, donc aussi sur mobile. Organisation (Team, Enterprise) : seul le propriétaire l'ajoute, pour tous les membres | document de métadonnées client |
| ChatGPT | app web seulement, **mode développeur** : Plugins → Parcourir les plugins → + → Créer une application MCP ; authentification OAuth ; ensuite aussi sur mobile | document de métadonnées client (`https://chatgpt.com/oauth/client.json`) |
| Mistral Vibe | app web seulement : Contexte → Connecteurs → connecteur personnalisé, authentification OAuth2.1 ; ensuite aussi sur mobile | enregistrement dynamique (`mistral-mcp-client`, retour `callback.mistral.ai`) |
| Grok | directement depuis l'app mobile | enregistrement dynamique (`Grok`, retour `grok.com`) |
| Gemini | **pas encore possible en France** : applications personnalisées de l'app grand public réservées aux États-Unis (compte personnel, anglais) ; Gemini Enterprise exige un client OAuth fixe avec secret, que `auth.ts` ne gère pas (clients publics seulement) | — |

Nom de connecteur conseillé : `Kasbah`, en un mot, pour le mentionner dans le chat (`@Kasbah …`).

**Claude Desktop vers l'adresse publique.** Par `claude_desktop_config.json` (indépendant du forfait,
donc hors de la limite des organisations) : `npx -y mcp-remote https://<adresse>/mcp`. La variante
`http://localhost:8787/mcp` ne vaut que sur le poste du serveur.

**Dépannage relevé.**
- Journaux de Claude Desktop : `%LOCALAPPDATA%\Claude\Logs\` pour la version Microsoft Store (ceux de
  `%APPDATA%\Claude\logs\` ne sont plus écrits par cette version), `~/Library/Logs/Claude/` sur macOS.
- `ETIMEDOUT` sans trace côté serveur : un **port dans l'adresse publique** (`:8787`) ; le proxy
  répond sur 443, le port du poste ne sert qu'entre le proxy et lui.
- `http://kasbah:8787/mcp --allow-http` depuis un autre poste : le nom passe le contrôle d'hôte
  (`ALLOWED_HOSTS`), mais `--allow-http` ne lève que le contrôle d'URL de `mcp-remote` ; le SDK
  qu'il embarque (0.14.x) lève `InsecureTokenEndpointError` (« Refusing to send credentials to
  non-https token endpoint ») sans aucun contournement. Confirme le piège noté plus haut
  (`assertSecureTokenEndpoint`) : l'adresse publique en https, toujours, hors du poste du serveur.
- « invalid state » affiché par Mistral alors que le jeton a bien été délivré côté serveur : page de
  connexion issue d'un ajout précédent du connecteur, ou formulaire envoyé deux fois. Supprimer le
  connecteur, l'ajouter une fois, se connecter en un seul clic.

### Mise à jour 2026-10-06 (soir) — toute l'application derrière une connexion, par l'adresse publique

**Pourquoi.** Demande de l'utilisateur : ouvrir Kasbah depuis un téléphone hors de la maison, le VPN
étant « bien mais trop compliqué pour certains utilisateurs ». C'est le « plus tard » de la décision du
2026-10-04 (« Le MCP seul pour l'instant », Tailscale pour l'interface). **Écarté** : Cloudflare Tunnel
+ Cloudflare Access (zéro code, mais l'utilisateur avait préféré le proxy inverse à un tunnel). Un
proxy inversé simple ne sait pas poser de mot de passe : son contrôle d'accès ne filtre que par IP.
La connexion est donc dans Kasbah.

**Décisions de l'utilisateur.** Mêmes comptes que le MCP (`mcp-users.json`) ; droits par compte
(enfant en lecture seule…) : plus tard ; **caméras accessibles depuis l'extérieur** une fois connecté ;
blocage d'un compte après trop d'échecs, paramétrable.

**Décisions de séance.**
- **Le réseau local ne change pas** : aucun compte, écrans fixes inchangés.
- **C'est le NOM qui décide, pas la provenance** : par le proxy tout arrive du proxy, donc la provenance
  ne dit rien. L'adresse publique demande la connexion **même depuis la maison** (constat de
  l'utilisateur en conditions réelles, validé comme voulu). Conseil : sur le téléphone, n'utiliser que
  l'adresse publique (une icône, mêmes réglages) ; l'adresse locale reste pour les écrans fixes.
- **La gestion des comptes (`/api/mcp/users`) reste au réseau local MÊME connecté** (403 `LAN_ONLY`) :
  une session volée ne doit pas pouvoir créer de compte.
- **Page de connexion rendue par le serveur**, en français seulement (comme celle du MCP) : rien d'autre
  n'est servi sans session.

**Porte à session (`apps/server/src/http/session.ts`, nouveau).** `createAppSession` rend `gate`, que
`publicHostFilter(publicHosts, gate)` appelle pour tout chemin non-MCP sous le nom public, et `routes` :
`GET`/`POST /login`, `POST /logout`, `GET /api/session` (→ `{ user }`, `null` sur le réseau local ;
`/login` y renvoie vers `/`). Décoration `req.sessionUser`.
- **Cookie** `__Host-kasbah_session` : Secure, Path=/, HttpOnly, SameSite=Lax. **90 jours glissants**,
  prolongés au plus une fois par jour (le cookie est alors réécrit).
- **Sessions hachées** (sha256) dans `KASBAH_SESSIONS_FILE` (défaut `.state/sessions.json`, 0600).
  Chacune porte une **empreinte du haché du mot de passe** : changer le mot de passe ferme toutes les
  sessions du compte, retirer le compte aussi — de quoi couper un téléphone perdu. Les jetons MCP, eux,
  **ne tombent pas** sur un changement de mot de passe (seulement au retrait du compte).
- **Ouverts sans session** : `/login`, `/logout`, `/manifest.webmanifest`, `/icons/*` (le navigateur
  demande le manifest SANS cookie).
- **Sans session** : une *navigation* (`GET` hors `/api/` et `/ws` **et** `Accept` contenant
  `text/html`) part en 302 vers `/login?next=…` ; tout le reste (API, WebSocket, scripts, CSS, images)
  rend 401 `{ error: { code: 'AUTH_REQUIRED' } }`. `next` est filtré : chemin du site seulement, ni
  `//`, ni `/\`, ni `/login`.
- **Origine exigée** (`Origin` égale à l'origine de `MCP_PUBLIC_URL`) sur toute écriture (méthodes hors
  GET/HEAD/OPTIONS, `/login` et `/logout` compris) **et sur toute demande de WebSocket** (en-tête
  `upgrade`) : `/ws` ET les flux vidéo des caméras → sinon 403 `BAD_ORIGIN`. Raison : les autres
  services hébergés derrière le même domaine (`nas.example.org`…) sont du MÊME
  site que `kasbah.example.org` : SameSite ne les sépare pas.
- La page de connexion porte le manifest et les balises d'installation (`INSTALL_HEAD`) : l'app
  s'installe dès cette page.

**Gardien partagé (`mcp/auth.ts`, `LoginGuard`).** Les deux connexions (app et `/oauth/authorize`) y
passent par `checkLogin`. Le plafond GLOBAL d'avant est conservé (10 échecs / 15 min, constantes
`GLOBAL_*` : derrière un proxy toutes les requêtes ont la même adresse) et s'y ajoute le **blocage par
compte** après `KASBAH_LOGIN_MAX_FAILURES` échecs d'affilée (défaut 5, 0 = jamais), chacun à moins de
`KASBAH_LOGIN_LOCK_MINUTES` (défaut 15) du précédent. Bloqué **même avec le bon mot de passe** ; suivi
par NOM SAISI, existant ou non (le blocage ne trahit pas les comptes) ; Map bornée à 1 000 noms ; succès =
compteur remis à zéro ; journal warn « login locked for this account ». Message 429 « Trop d'essais :
réessayer dans N min. ». `checkLogin` garde le haché factice d'un compte inconnu (même coût qu'un
mauvais mot de passe). Ajoutés : `usersReader`, `isPublicRequest`, `htmlPage` (partagée par les deux
pages) ; `createMcpAuth` expose `guard` et `users`.

**Page de connexion restylée** (demande de l'utilisateur) au thème « Kasbah » : jetons de
`themes/kasbah.ts` et dérivés de `cssVars`, clair/sombre par `prefers-color-scheme` (la page n'a ni
script ni accès au thème choisi dans l'app), carte à filet et ombre, libellés en petites capitales,
champs de 44 px, bouton pilule sur l'accent, erreur dans un encart. **Plus Jakarta Sans embarquée en
base64** (28 Ko, lue dans `node_modules/@fontsource-variable/plus-jakarta-sans/files/`, à la racine ou
sous `apps/web`) car rien d'autre n'est servi sans session ; repli sur la police du système si absente.
CSP : `default-src 'none'; style-src 'unsafe-inline'; font-src data:; manifest-src 'self'; img-src
'self'; frame-ancestors 'none'`. Le logo reste inclus dans la page.

**Côté web.** Réglages : la carte devient « Comptes » / « Accounts », aide réécrite (fr/en), ligne
« Connecté en tant que … » et « Se déconnecter » (formulaire natif `POST /logout`) quand une session
existe ; sous l'adresse publique, liste et formulaire sont masqués et `/api/mcp/users` n'est même pas
demandé (`McpUsersCard.vue`). Le reste du transport : `1_4_app-web.md`.

**Procédure du proxy inverse complétée.** Mêmes étapes que la mise à jour du 2026-10-04 (nuit, suite), plus :
en-têtes personnalisés → Créer → **WebSocket** (`Upgrade: $http_upgrade`, `Connection:
$connection_upgrade`), sans quoi l'état en direct ne passe pas ; pas de `Host` à ajouter (le proxy le
transmet, vérifié le 2026-10-04). **Ordre impératif inchangé** : `MCP_PUBLIC_URL` posé et Kasbah relancé
AVANT de créer ou modifier la règle. **iPhone** : l'app ajoutée à l'écran d'accueil a ses propres cookies
(se connecter une fois dedans) ; sur Android l'app installée partage la connexion de Chrome.

**Limites connues.**
- Un WebSocket déjà ouvert survit à la révocation jusqu'à sa prochaine coupure (lecture seule : les
  commandes passent par HTTP et sont refusées).
- Blocage **en mémoire** (un redémarrage débloque) ; un tiers qui connaît un nom de compte peut le
  bloquer exprès (les sessions ouvertes ne sont pas touchées).
- Après une révocation on revient sur la vue où l'on était, pas sur celle qu'on ouvrait.
- Page de connexion en français seulement.

**Vérifié.** `http/session.test.ts` (14 tests, horloge simulée : redirection / 401, page et manifest
sans session, cookie et attributs, `next` filtré, refus sans cookie, origine sur connexion / écriture /
WebSocket / flux caméra, `LAN_ONLY`, révocation par mot de passe et par retrait, déconnexion, glissement
90 j, blocage et sa levée, blocage par compte seulement, seuil 0, réseau local inchangé) ;
`mcp/public-host.test.ts` (6 : application assemblée, `injectWS` 401 / 403 / instantané, blocage partagé
avec `/oauth/authorize` au seuil 2) ; `music/player.test.ts` (2). Suite complète 1 913 tests, typecheck et
lint verts. Navigateur (serveur mock local, voir `../6_faq/6_1_pieges-runtime.md`) : réseau local sans
compte ; adresse publique → connexion ; 3 échecs → 429 « réessayer dans 2 min » ; connexion → retour sur
`/settings`, `/api/session`, instantané WS, cookie invisible au JS, `/api/mcp/users` 403 ; révocation par
changement de mot de passe → renvoi à la connexion ; déconnexion ; carte en fr/en à 375 px sans
débordement ; page en clair et sombre, police chargée ; manifest et icône sans session.

**Non consigné** : un essai réel par le proxy depuis un téléphone ne figure pas dans les sources ; seuls
deux constats de l'utilisateur en conditions réelles sont connus (l'installation n'était proposée
qu'après la connexion — corrigé, la page annonce maintenant le manifest —, et la connexion demandée
depuis la maison — voulu).

Sources : `apps/server/src/http/session.ts`, `apps/server/src/mcp/auth.ts`, `apps/server/src/app.ts`,
`apps/server/src/music/player.ts`, `apps/web/src/components/settings/McpUsersCard.vue`.

### Mise à jour 2026-10-07 — un jeton appartient à un compte, les outils musique jouent en son nom

**Pourquoi.** Les comptes musicaux sont désormais par utilisateur (`../3_plugins/3_16_ytmusic.md`,
`../3_plugins/3_20_mixcloud.md`, `1_6_lecteur-musique.md`). Décision de l'utilisateur : un jeton
appartient à un compte, donc `search_music` / `play_music` utilisent **les comptes de ce compte** — un
assistant branché par Alice cherche et lance avec ses réglages, pas avec ceux de la maison.

**Le compte voyage jusqu'à la route.** `requireToken` pose `req.sessionUser = grant.user`
(`apps/server/src/mcp/auth.ts`). Le compte passe par `authInfo.extra.user` (`handler.fetch(…, { authInfo })`) ;
la fabrique `createMcpHandler((ctx) => buildServer(deps, app, user))` le lit dans `ctx.authInfo`
(`apps/server/src/mcp/server.ts`). Les outils appellent toujours les routes par `app.inject`, mais avec
`actAsHeaders(user)` : deux en-têtes, `x-kasbah-internal: <secret>` et `x-kasbah-user`.

**Pourquoi un secret.** Un en-tête `x-kasbah-user` seul serait réclamable par n'importe quelle requête
réseau, qui se ferait passer pour un compte. Le secret est tiré au démarrage (`randomBytes(32)`) dans
`apps/server/src/http/session.ts`, ne quitte jamais le processus ; `actAsHook` (crochet `onRequest`
posé dans `app.ts` après `publicHostFilter`) n'accepte le compte annoncé que si le secret correspond.

**Tests** (`apps/server/src/mcp/server.test.ts`) : les outils jouent au nom du compte du jeton, dans les
deux versions de protocole ; l'en-tête interne n'est pas réclamable depuis le réseau. Contrôles négatifs
faits : retirer les en-têtes MCP, ou la vérification du secret, fait rougir. `users-routes.test.ts` : le
dossier du compte est effacé au retrait ; les noms `.` et `..` (admis par `userNameSchema`) restent
sous `users/` ; `Alice` et `alice` sont deux comptes distincts sur le disque (encodage, voir
`../5_setup/5_1_configuration-env.md`).

Sources : `apps/server/src/mcp/{auth,server}.ts`, `apps/server/src/http/session.ts`, `apps/server/src/app.ts`.

### Mise à jour 2026-10-07 (soir) — le jeton de course, pour un client lancé par le serveur lui-même

**Pourquoi.** L'assistant de l'app (`1_9_assistant.md`) lance `claude -p` sur le serveur, qui doit
joindre `/mcp` comme n'importe quel client, et **au nom du compte qui a donné l'instruction** (ses
comptes musicaux). Passer par OAuth n'a pas de sens pour un processus que le serveur lance lui-même.

**`auth.runToken(user, ttlMs)`** (`apps/server/src/mcp/auth.ts`, interface `McpAuth`) tire un jeton
opaque gardé **en mémoire seulement** (empreinte SHA-256 → `{ user, expiresAt }`, jamais dans
`.state/mcp-auth.json`) et rend `{ token, revoke }`. `requireToken` le cherche **avant** les jetons
OAuth : valide s'il n'a pas expiré et si son compte existe encore (`null` = la maison, toujours
valide), et pose alors `req.sessionUser`. Le cœur de l'assistant le tire pour la durée d'un appel
(délai + 10 s) et le révoque à la fin ; les jetons expirés sont balayés au tirage suivant. Le moteur
le passe à `claude` dans un fichier de config MCP 0600, jamais en argument.

**Tests** (`auth.test.ts`) : ouvre `/mcp` au nom du compte ou de la maison, refusé après `revoke()`,
après expiration, et quand le compte est retiré du fichier. La route factice du test rend désormais
`req.sessionUser`.

### Mise à jour 2026-10-08 — `get_health` rend la santé des comptes du jeton

Le tableau des outils plus haut associe `get_health` à `host.health()` : c'est désormais
`host.health(user)`, `user` étant le compte du jeton (même chemin que `search_music` et `play_music`,
mise à jour du 2026-10-07). Pour ytmusic et Mixcloud, l'assistant voit donc l'état des comptes musicaux
de son utilisateur, pas celui de la maison. Détail : `1_2_serveur-et-plugins.md`, mise à jour du
2026-10-08.

Sources : `apps/server/src/mcp/server.ts`.

### Mise à jour 2026-10-09 — neuf outils de plus : météo, agenda, automatisations, file musicale, historiques

**Pourquoi.** Demande de l'utilisateur : « a-t-on la météo dans le MCP ? sinon l'implémenter, puis faire
le tour de ce qu'il manque ». Constat : la météo n'était que **partiellement** visible — l'appareil `weather`
via `list_devices` / `get_device` donne l'état actuel et la vigilance en cours, mais ni prévisions, ni
vigilance à venir, ni autre lieu. Un inventaire des manques a été soumis ; **retenu** : agenda (lecture),
automatisations, file musicale et sessions, historiques d'appareils. **Écarté par l'utilisateur** : la
bibliothèque YouTube Music (aimés, playlists, albums), les radios favorites, cocher un devoir « fait »
(déjà écarté le 2026-10-04 : cela écrit chez l'école).

**Comptage.** **9** outils ajoutés (`get_weather`, `get_agenda`, `list_automations`, `run_automation`, `set_automation_enabled`,
`get_music`, `queue_music`, `control_music`, `get_device_history`) et le test de liste en attend **19**.
Le chiffre retenu ici est celui du code.

**Même méthode que la musique** : tous passent par `app.inject` sur les routes existantes, au nom du compte
du jeton (`actAsHeaders`). Le client interne `call` accepte maintenant `PATCH` et `DELETE` ; `clockOf(tz)`
(heure en clair dans un fuseau) est partagé.

| Outil | Routes | À savoir |
|---|---|---|
| `get_weather` `{ place? }` | maison : premier appareil `weather` du registre, `host.forecast`, `/api/plugins/open_meteo/alerts` avec `house.origin` ; repli sur la vigilance EN COURS de l'état si la route échoue. Lieu : `/places?q&lang=fr` (premier résultat, rendu dans `place` pour vérification), `/at`, `/alerts` | `weatherDigest` (pure, exportée) : heures en `YYYY-MM-DD HH:MM` dans le fuseau du LIEU (`timezone` IANA de `/at` ; maison = fuseau du serveur), `isDay` retiré des pas horaires, lever/coucher en `HH:MM`, `vigilance` = `{ area, warnings[{ type, level, from, to }] }`, `null` hors métropole, absente si inconnue |
| `get_agenda` `{ from?, days? }` | `/api/plugins/agenda/calendars` puis `/events?from&to` | aucun agenda → `isError` qui dit d'en ajouter un ; agendas en échec listés dans `failing`. `agendaDigest` (pure) : tri par début, nom de l'agenda, journée entière → `date` + `until` = dernier jour **inclus** |
| `list_automations` `{ query? }` | `GET /api/automations` | statut en clair : santé, `missing`, `unavailableDeviceIds`, `nextRun`, `pendingSince`, `lastRun` |
| `run_automation` `{ id }` | `POST /api/automations/:id/run` | exécute **tout de suite**, sans « Sauf si », même désactivée (comme le bouton de l'app, `1_8_automatisations.md`) ; rend `outcome` et les erreurs |
| `set_automation_enabled` `{ id, enabled }` | `PATCH /api/automations/:id` | — |
| `get_music` `{ deviceId? }` | `/api/music/sessions` (qui joue, sur quel appareil, titre, file résumée), `/api/music/last` (en pause : à reprendre) ; avec `deviceId`, `/api/music/queue` (file complète indexée, `null` s'il n'y en a pas) | — |
| `queue_music` `{ deviceId, tracks 1-100, where }` | `POST /api/music/queue/add` | `where` = `next` ou `end` ; ne coupe pas la lecture, démarre si rien ne joue |
| `control_music` `{ deviceId, action, … }` | `next`, `previous`, `jump`, `remove`, `repeat`, `clear`, `resume`, `transfer` : `/api/music/queue/{next,previous,jump,remove,repeat}`, `DELETE /api/music/queue`, `/api/music/resume`, `/api/music/transfer` | paramètre manquant (`index`, `mode` de `REPEAT_MODES` off/once/loop, `positionS`, `toDeviceId`) → `isError` ; rend un résumé de file (`index`, `length`, `repeat`, `current`) |
| `get_device_history` `{ id, hours 1-48 }` | `/api/devices/:id/history` (kind `energy`), journal (capacité `journal`, 50 plus récents), consommation (capacité `water_usage` : `hourly` limité à `hours`, `daily` 31 derniers, `monthly`) | aucune série pour l'appareil → `isError` |

**Décisions.**
- **Heures en clair** (météo, agenda, statut des automatisations) : un agent convertit mal un epoch, et lirait
  une fin de flux iCal exclusive un jour trop tard — d'où `until` inclus pour les journées entières.
  Contrôles négatifs faits : fuseau forcé à UTC → `weatherDigest` rouge ; fin incluse retirée →
  `agendaDigest` rouge.
- **Pas de création, modification ni suppression d'automatisation par MCP.** Une règle tourne sans
  surveillance : elle s'écrit dans la vue Automatisations. *(Renversé le 2026-10-15 à la demande de
  l'utilisateur pour la création et la modification ; la suppression reste hors MCP. Voir la section en bas de page.)* Seuls `run_automation` et
  `set_automation_enabled` agissent, et `run_automation` n'évalue pas le « Sauf si » (même contrat que le
  bouton).
- **`control_music` lève la « limite connue » du 2026-09-23** : `media_player.next` / `previous` de
  `send_command` ne sautent pas dans la file Kasbah, `control_music` si.

**Vérifié.** `server.test.ts` : 68 tests verts dans les deux ères — liste des 19 outils ; météo de la
maison (simulateur) ; autre lieu sans plugin `open_meteo` → `isError` ; file pilotée (ajout, file indexée,
`repeat` loop, `jump`, `remove` sans index refusé, `clear`) ; automatisation créée, coupée puis lancée
(la lampe s'allume), id inconnu → `isError` ; historique énergie, lampe → `isError` ; `get_agenda` sans
plugin → `isError` ; tests purs des deux `…Digest`. **Le test d'automatisation travaille sur une COPIE
temporaire** de `demo-house.json` : `<maison>.automations.json` s'écrit à côté de la maison
(`1_8_automatisations.md`) et ne doit pas atterrir dans `house/`. Essai réel contre l'API Open-Meteo (test
jetable, supprimé) : maison démo (Europe/Paris, vigilance verte), Pornic, Montpellier (vigilance
Hérault), Tokyo (heures `Asia/Tokyo`, vigilance `null`), lieu absurde → « lieu introuvable » ; réponses
d'environ 4,2 Ko. Typecheck serveur et lint des fichiers touchés verts.

**Non joué.** Suite complète (pas de commit à ce stade) ; agenda et automatisations sur le vrai serveur
(non démarré en watch : redémarrage nécessaire) ; consommation d'eau (le plugin `mock` n'implémente pas
`consumption` : l'outil rend alors une erreur) ; journal.

**Défaut relevé, non corrigé** — *corrigé le 2026-10-09 : 409 `DEVICE_UNAVAILABLE` « open_meteo plugin is not started », message que `get_weather` rend à l'agent.* Les routes `/places`, `/at`, `/alerts` d'`open_meteo` répondent 500 quand le
plugin est monté mais pas démarré : voir `../3_plugins/3_10_open-meteo.md`.

Sources : `apps/server/src/mcp/{server,server.test}.ts`, `README.md` (table « Serveur MCP »).

### Mise à jour 2026-10-11 — six outils pour la liste de courses

> Le tableau des outils passe de 19 à **25**.

La liste de courses partagée (`1_10_liste-de-courses.md`) se tient aussi par l'agent. Les six outils
appellent les routes `/api/shopping/*` par `app.inject`, comme la musique ou les automatisations : même
validation, même file d'écriture du `ShoppingService`, même diffusion WebSocket aux écrans — une ligne
ajoutée à la voix apparaît tout de suite sur la tablette. Le type de `call` accepte désormais `PUT`
(pour `PUT /api/shopping/favorites`).

| Outil | Ce qu'il fait |
|---|---|
| `get_shopping_list` | lignes dans l'ordre d'ajout (`id`, `name`, `quantity`, `checked`) et noms des habituels (`favorites`). Lecture seule |
| `add_shopping_items` | 1 à 50 produits `{ name, quantity? }` ; déjà là et pas pris → quantité augmentée, déjà coché → de nouveau à acheter |
| `update_shopping_item` | `item` (id **ou nom**), `checked` et/ou `quantity` ; ni l'un ni l'autre → `isError` |
| `remove_shopping_item` | retire une ligne sans l'acheter ; le produit reste connu |
| `finish_shopping` | retire toutes les lignes cochées |
| `set_shopping_favorite` | pose ou retire l'étoile d'un produit, connu ou non ; ne l'ajoute pas à la liste |

**La ligne se désigne par son nom.** Un agent dit « le lait », pas `lait` : l'outil relit la liste et
résout le nom par `findShoppingItem` (même clé sans casse ni accents que le serveur), puis vise la ligne
par son id. Une ligne absente rend `isError` avec un message qui renvoie à `get_shopping_list`. Chaque
écriture rend la liste réduite à ce qui sert à l'agent (`shoppingView` : ni `addedAt`, ni compteur
d'usage, ni produits non étoilés).

L'assistant (`1_9_assistant.md`) les a sans réglage : `claude -p` y est lancé avec
`--allowedTools mcp__kasbah` (`apps/server/src/plugins/claude/run.ts`), tout le préfixe.

**Vérifié.** `server.test.ts`, dans les deux versions du protocole : liste des 25 outils ; ajout du même
produit sous deux casses (quantité 3), coche par le nom en minuscules, étoile, fin des courses (ligne
partie, habituel resté), retrait et mise à jour d'une ligne absente → `isError`. Les deux passages
partagent le serveur : un produit par passage (`Lait <version>`). Le test travaille sur la COPIE
temporaire de la maison déjà en place pour les automatisations : `<maison>.shopping.json` s'écrit à côté.

Sources : `apps/server/src/mcp/{server,server.test}.ts`, `packages/shared/src/shopping/shopping.ts`, `README.md` (table « Serveur MCP »).

**Ajout 2026-10-11 (2).** Coupée dans Réglages → Plugins (`plugins.shopping`), la liste de courses n'a
plus d'outils : `buildServer` ne les enregistre pas (`registerShoppingTools`), et comme une instance est
créée par requête, la bascule vaut dès la suivante. Test « retire les outils de la liste de courses quand
elle est coupée ». Voir `1_10_liste-de-courses.md`.

### Mise à jour 2026-10-15 — créer et modifier une automatisation

> Le tableau des outils passe de 25 à **27**.

**Pourquoi.** Demande de l'utilisateur : que l'agent puisse gérer les automatisations (activer et couper
existaient déjà, il manquait la création et la modification). Cela renverse la décision du 2026-10-09
(« une règle tourne sans surveillance, elle s'écrit dans la vue Automatisations ») pour ces deux
opérations. **La suppression reste hors MCP** : non demandée.

| Outil | Passe par | À savoir |
|---|---|---|
| `create_automation` `{ name, enabled?, trigger, unless?, actions }` | `PUT /api/automations/<uuid>` | id tiré par le serveur (`randomUUID`, comme `newAutomationId` de l'app) ; `enabled` vrai et `unless` vide par défaut ; la règle va en bas de la liste |
| `update_automation` `{ id, name?, enabled?, trigger?, unless?, actions? }` | `GET /api/automations` puis `PUT /api/automations/:id` | seuls les champs passés changent, chacun **remplacé en entier** (ajouter une action = renvoyer toute la liste) ; id inconnu → `isError` (l'outil ne crée jamais) |

- **Même forme que `list_automations`** : les schémas d'entrée sont les champs d'`automationBodySchema`
  (`packages/shared/src/automations/automation.ts`), donc une règle lue se réécrit telle quelle et le
  client voit la vraie structure (déclencheurs, prédicats, cibles) dans le JSON Schema de l'outil.
- **Même validation que l'app** : l'écriture passe par la route (`automationBodySchema.parse`), le
  moteur, le fichier `<maison>.automations.json` et la diffusion WebSocket — la règle apparaît tout de
  suite sur les écrans.
- **Les deux outils rendent la règle et son statut** (`automationView`, partagé avec `list_automations`) :
  une référence absente (appareil, champ d'état, pièce) n'empêche pas l'écriture, elle se lit dans
  `health: incomplete` et `missing`, comme dans l'app.
- Description commune (`AUTOMATION_HELP`) : formes du déclencheur, « sauf si » en OU, contrainte d'heure
  dans `unless` et pas dans `when`, cibles nommées ou sélection, ids de pièces dans `kasbah://house`.
- Pas de garde contre une écriture concurrente : `update_automation` lit puis réécrit, une modification
  faite dans l'app entre les deux serait perdue.

**Vérifié.** `server.test.ts`, dans les deux versions du protocole : liste des 27 outils ; création
(allumée, sans « sauf si », prochaine exécution à l'heure demandée), renommage et coupure sans toucher
au déclencheur ni aux actions, id inconnu → `isError`, appareil absent → `incomplete` avec `missing`.

Sources : `apps/server/src/mcp/{server,server.test}.ts`, `README.md` (table « Serveur MCP »).

### Mise à jour 2026-10-15 (2) — garde-fous des automatisations écrites par l'assistant

**Pourquoi.** Question de l'utilisateur après la livraison de `create_automation` / `update_automation` :
faut-il des garde-fous ? `send_command` agit déjà tout de suite ; le risque NOUVEAU est la
**persistance** : une règle continue d'agir sans personne pour la regarder, et l'agent a pu lire du
contenu extérieur (agenda, école) qui la lui dicte. Il n'y a pas d'outil de suppression, donc rien à
« tout supprimer ». Quatre garde-fous retenus par l'utilisateur.

1. **La version d'avant.** `update_automation` rend `previous` (`name`, `enabled`, `trigger`, `unless`,
   `actions`) : la repasser telle quelle à l'outil annule la modification. Le serveur ne garde qu'un `.bak`.
2. **Actions sensibles enregistrées coupées** (`sensitiveActions`, `apps/server/src/mcp/server.ts`) :
   ouvrir (`cover.open`, `cover.preset`, `cover.set_position` > 0) un ouvrant de nature `gate`, `garage`
   ou `window` ; `vehicle.unlock` ; `vehicle.schedule_update` (la mise à jour logicielle). Un appareil
   inconnu du registre compte comme un accès possible, une sélection `cover` sans nature aussi (elle
   prend le portail). Fermer n'est pas sensible. La règle est écrite `enabled: false` et la réponse porte
   `safety: { disabled, actions, reason }`. Pas d'interdiction : « ouvrir le portail quand la voiture
   arrive » est un vrai usage ; on l'active dans l'app, ou par `set_automation_enabled` si l'utilisateur
   le demande expressément (dit dans la description de l'outil). En modification, le garde-fou ne joue que
   si `trigger`, `unless` ou `actions` changent : renommer ou rallumer seul n'y touche pas.
3. **Origine visible.** Champ `byAssistant: { user?, at }` d'`automationSchema`, posé par le SERVEUR (hors
   d'`automationBodySchema`, donc ni l'app ni l'agent ne l'écrivent). La route `PUT /api/automations/:id`
   le pose quand la requête vient du MCP (`fromMcp`, `apps/server/src/http/session.ts` : seul le MCP porte
   le secret interne) et l'efface sur toute écriture venue de l'app. `actAsHeaders` accepte désormais
   `null` (la maison, jeton de course de l'assistant de l'app) : la requête reste marquée MCP sans compte.
   Côté app : voir `1_8_automatisations.md`.
4. **Plafond** : `AUTOMATION_CREATE_LIMIT` = 10 créations par heure glissante, pour tout le serveur (le
   compte vit dans `registerMcp`, une instance de serveur MCP étant créée par requête). Au-delà, `isError`.

**Écarté.** La confirmation demandée par le serveur (*elicitation* MCP) : son support par claude.ai et
l'app mobile n'est pas établi. Les clients demandent déjà l'accord de l'utilisateur pour un outil non
lecture seule (`destructiveHint` vaut vrai par défaut).

**Vérifié.** `server.test.ts`, deux versions du protocole : marque posée au nom du compte du jeton puis
effacée par une écriture de l'app ; `previous` repassé rétablit la règle ; portail ouvert → créée coupée
(`safety.actions: [1]`), renommée → toujours coupée, rallumée par `set_automation_enabled`, déclencheur
changé → recoupée, portail fermé → non sensible ; plafond atteint → `isError` (après les deux passages) ;
test pur de `sensitiveActions`. Contrôle négatif : garde-fou neutralisé → le test du portail rougit.

Sources : `apps/server/src/mcp/{server,server.test}.ts`, `apps/server/src/http/{session,routes}.ts`,
`apps/server/src/core/automations/engine.ts`, `packages/shared/src/automations/automation.ts`.

### Mise à jour 2026-10-24 — un contenu extérieur lu interdit d'ouvrir un accès ; les automatisations sensibles, depuis l'app seulement

Constats d'un audit de sécurité (F18, F19, F23) : du texte écrit par des tiers arrive tel quel à l'agent
par `get_agenda` (titre, lieu, description d'un flux iCal), `get_school` (publications) et `search_music`
(titres, tags), alors que `send_command` ouvrait le portail ou déverrouillait la voiture sans autre
contrôle que les capacités, et que `set_automation_enabled` / `run_automation` défaisaient le garde-fou
du 2026-10-15. Choix de l'utilisateur, garde **dans le serveur**, pas dans le modèle :

- **Lecture extérieure** (`ExternalReads`, `apps/server/src/mcp/server.ts`) : ces trois outils marquent le
  jeton qui les appelle (haché, en mémoire) pour 30 min. Pendant ce temps, `send_command` refuse ce que
  `sensitiveActions` juge sensible (ouvrir portail, garage, fenêtre, appareil sans classe ; déverrouiller
  une voiture ou lancer sa mise à jour), avec un message qui renvoie à l'app. Fermer et tout le reste
  passent. L'assistant de l'app tire un jeton par demande (`runToken`) : « ouvre le portail » seul marche
  toujours ; un client OAuth garde le marquage 30 min ou jusqu'au jeton suivant.
- **Automatisations sensibles** : le MCP ne peut plus les activer (`set_automation_enabled`, ni
  `update_automation` avec `enabled: true` sur une règle coupée, qui repasse par `sensitiveActions`) ni
  les lancer (`run_automation`). Seule l'app le fait (route `PATCH /api/automations/:id`). La phrase
  « ou par set_automation_enabled si l'utilisateur le demande expressément » (2026-10-15) est donc
  dépassée.
- Reste ouvert : `list_devices` / `get_device` rendent aussi des textes de tiers (titre joué par un
  récepteur Cast) sans marquer le jeton ; marquer ces lectures aurait bloqué le cas courant (chercher l'id
  du portail).

Tests : `mcp/server.test.ts` (portail refusé après chacune des trois lectures, accepté avec un nouveau
jeton ; activation et lancement refusés au MCP, acceptés par l'app).
