# Comptes et sessions

> Dernière mise à jour : 2026-10-13
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
- **Droits par compte** (un compte en lecture seule, par exemple) : pas encore faits, tout compte connecté
  peut tout. Voir [0_0 Vision et principes](../0_overview/0_0_vision-et-principes.md).

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
