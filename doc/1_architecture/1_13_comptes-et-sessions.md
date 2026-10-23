# Comptes et sessions

> Dernière mise à jour : 2026-10-23
> Sources : `apps/server/src/http/session.ts`, `apps/server/src/mcp/auth.ts`, `apps/server/src/mcp/users-routes.ts`, `apps/server/src/mcp/users-cli.ts`, `apps/server/src/core/paths.ts`, `apps/server/src/music/sources.ts`, `apps/server/src/plugins/claude/index.ts`, `apps/server/src/assistant/assistant.ts` ; pages citées plus bas

Page de synthèse, écrite au lint du 2026-10-13 : le sujet était dispersé entre le serveur MCP, la
configuration, les Réglages et le lecteur musique. Elle décrit l'état du code à cette date et renvoie aux
sections datées qui racontent chaque étape ; le détail (routes OAuth, tests, essais) reste là-bas.

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
  en secours. Nom `^[\w.@-]{1,64}$`, mot de passe de 8 caractères au moins (`userNameSchema`,
  `passwordSchema`, communs au script et aux routes).
- **Réseau local seulement, même connecté** : sous l'adresse publique, `/api/mcp/users` rend 401 sans
  session et 403 `LAN_ONLY` avec une session. Une session volée ne doit pas pouvoir créer de compte.
  Depuis le 2026-10-13, même règle pour `/api/system/*` (version du serveur et mise à jour par le
  superviseur, [5_2 Production](../5_setup/5_2_production.md)) : `LAN_ONLY` est une liste de préfixes
  dans `session.ts`, et le message d'erreur ne nomme plus les comptes.
- **Droits par compte** (un compte en lecture seule, par exemple) : pas encore faits, tout compte connecté
  peut tout. Voir [0_0 Vision et principes](../0_overview/0_0_vision-et-principes.md).

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
  couper un téléphone perdu. Les jetons MCP, eux, ne tombent qu'au retrait du compte.
- **Sans session** : une navigation (`GET` d'une page HTML) part en 302 vers `/login?next=…` ; l'API, le
  WebSocket et les fichiers chargés par la page rendent 401 `AUTH_REQUIRED`, et le web renvoie lui-même à
  la connexion. `next` n'accepte qu'un chemin du site (ni `//`, ni `/\`, ni `/login`).
- **Ouverts sans session** : `/login`, `/logout`, `/manifest.webmanifest`, `/icons/*`, pour que l'app
  s'installe dès la page de connexion (le navigateur demande le manifest sans cookie).
- **Origine exigée** (celle de `MCP_PUBLIC_URL`) sur toute écriture et toute demande de WebSocket, `/ws`
  comme les flux des caméras : les autres services publiés sous le même domaine sont du même *site*,
  SameSite ne les sépare pas. Sinon 403 `BAD_ORIGIN`.
- `GET /api/session` rend `{ user }` (`null` sur le réseau local).
- La page de connexion est rendue par le serveur, en français seulement, comme celle du MCP.

## Les échecs de connexion (`LoginGuard`, `mcp/auth.ts`)

Les deux connexions (page de l'app et `/oauth/authorize` du MCP) passent par `checkLogin` et partagent
le même gardien :

| Règle | Valeur | Réglable |
|---|---|---|
| Blocage d'un compte après N échecs d'affilée | 5 (`0` = jamais) | `KASBAH_LOGIN_MAX_FAILURES` |
| Durée du blocage, et fenêtre de « d'affilée » | 15 min | `KASBAH_LOGIN_LOCK_MINUTES` |
| Plafond global, toutes connexions confondues | 10 échecs en 15 min | non (derrière le proxy, tout a la même adresse) |

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
- **Outils MCP** : ils rejouent les routes de l'app au nom du compte de leur jeton. Le secret interne de
  `actAsHeaders` est tiré au démarrage et ne quitte jamais le processus : une requête venue du réseau ne
  peut pas s'en réclamer.

## Fichiers d'état

| Fichier | Contenu | Hors dépôt |
|---|---|---|
| `apps/server/mcp-users.json` | comptes (nom, haché scrypt) | oui, ignoré par git |
| `.state/sessions.json` | sessions de l'app, hachées | oui (`.state/`) |
| `.state/mcp-auth.json` | clients et jetons MCP, hachés | oui (`.state/`) |
| `.state/users/<nom>/` | comptes musicaux et jeton Claude d'un utilisateur | oui (`.state/`) |

Supprimer `sessions.json` déconnecte tout le monde ; supprimer `mcp-auth.json` oblige chaque client MCP à
se reconnecter.
