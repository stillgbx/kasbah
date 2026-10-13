# Production

> Dernière mise à jour : 2026-10-13
> Sources : `apps/server/build.mjs`, `apps/server/src/http/static.ts`, `apps/web/vite.config.ts`, `apps/server/src/core/paths.ts`, `apps/server/src/config/env.ts`, `apps/web/index.html`, `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/`, `apps/web/src/stores/appUpdate.ts`, `apps/web/src/components/AppUpdateBanner.vue` (2026-10-13)

## Build

```bash
npm run build   # apps/web/dist (Vite, base '/') puis apps/server/dist/main.js (esbuild, ESM, node22)
npm start       # node dist/main.js — API + WebSocket + build web sur KASBAH_PORT
```

Le bundle serveur inclut les sources des paquets `@kasbah/*` et laisse les dépendances npm
externes (chargées depuis `node_modules`) ; `pino-pretty` est externe et optionnel.

## Service statique

`@fastify/static` sert `KASBAH_STATIC_DIR` si `index.html` existe, avec **repli SPA** pour les `GET`
hors `/api` et `/ws`. Depuis le 2026-10-04, le routage web est en historique HTML5 (`/music`, plus de `#`) : ce
repli est **requis** pour qu'une adresse profonde se recharge. Le build est en `base: '/'` et ne se
sert donc plus depuis un sous-dossier (`http://nas/kasbah/`) : il chercherait `/assets/…` à la racine.
Pour un préfixe, poser `base: '/kasbah/'` dans `apps/web/vite.config.ts` (le routeur suit
`BASE_URL`) et faire renvoyer `index.html` sous ce préfixe par le serveur placé devant. Auparavant,
le routage par hash et `base: './'` rendaient la réécriture inutile et le sous-dossier possible. En dev, Vite sert l'app et proxifie `/api` et `/ws`.

## Écran sur le LAN

Ouvrir `http://<ip-du-serveur>:8787` depuis l'écran ; ajouter à l'écran d'accueil (méta
`mobile-web-app-capable`, `viewport-fit=cover`, zones sûres gérées en CSS). Pas de HTTPS ni
d'authentification en v1 : réseau local de confiance uniquement.

*(Dépassé en partie le 2026-10-06 : seul le serveur MCP — `/mcp`, `/oauth/*`, `/.well-known/oauth-*` — est authentifié (OAuth, comptes de `mcp-users.json`) et peut être publié derrière un proxy HTTPS en posant `MCP_PUBLIC_URL` ; sous ce nom public, tout autre chemin répond 404 (`publicHostFilter`, `apps/server/src/mcp/auth.ts`). L'application, l'API REST et le WebSocket restent sans authentification, réservés au réseau local. Voir `../1_architecture/1_7_serveur-mcp.md` et le README.)*

*(Dépassé le 2026-10-06 (soir) : sous le nom public, l'application, l'API, le WebSocket et les caméras ne répondent plus 404, ils sont derrière une connexion (comptes de `mcp-users.json`, cookie de session). Le réseau local reste sans compte. Voir « Mise à jour 2026-10-06 (soir) — accès depuis l'extérieur » plus bas.)*

## Suites possibles

Dockerfile (Node 22 alpine, `npm ci` + `npm run build`, `KASBAH_HOUSE_FILE` monté en volume),
service systemd, HTTPS et authentification (voir `0_overview/0_0_vision-et-principes.md`).

*(Constat du lint du 2026-10-06 : HTTPS et authentification existent déjà pour le seul serveur MCP, voir le renvoi de la section « Écran sur le LAN ».)*

*(Mise à jour du 2026-10-06 (soir) : l'authentification de l'application est faite, par l'adresse publique du proxy inverse ; le HTTPS est celui du proxy, pas celui de Kasbah. Restent le Dockerfile et le service systemd.)*

### Mise à jour 2026-09-19 — les défauts de chemins survivent maintenant au bundle

`config/env.ts` et les sept plugins calculaient leurs chemins par défaut en remontant un nombre
fixe de dossiers depuis `import.meta.url`. Juste en développement (`apps/server/src/…`), **faux une
fois bundlé** : dans `apps/server/dist/main.js`, la même remontée désigne un dossier situé au-dessus
du dépôt. `KASBAH_STATIC_DIR` par défaut pointait alors hors de l'arborescence, et le serveur
répondait « no web build found » ; les fichiers d'état auraient été écrits ailleurs encore.

Le défaut ne se voyait pas parce que `.env.example` recommande de fixer `KASBAH_HOUSE_FILE` et
`KASBAH_STATIC_DIR` — le piège attendait le premier déploiement qui s'en remettrait aux défauts
(un `docker run` sans `-e`, typiquement).

`apps/server/src/core/paths.ts` tranche une fois pour toutes : il reconnaît la forme bundlée
(dossier `dist`), remonte jusqu'à `apps/server` et en déduit `SERVER_ROOT`, `REPO_ROOT` et
`stateFile()`. Vérifié en exécutant la même sonde depuis la source puis depuis un bundle esbuild :
les quatre chemins par défaut (état, maison, build web, racine) sont identiques dans les deux cas.

### Mise à jour 2026-09-23 — application installable (PWA)

L'app déclare maintenant un manifest (`apps/web/public/manifest.webmanifest` : `display: standalone`,
`start_url` et `scope` relatifs `./`, couleurs du thème sombre `#0d1420`) et ses icônes
(`apps/web/public/icons/` : `icon.svg` aussi favicon, PNG 192 et 512, `icon-maskable-512.png` à fond
plein pour les icônes rondes d'Android, `apple-touch-icon.png` 180). `index.html` les référence par
des chemins absolus que Vite réécrit en `./…` au build (`base: './'`), vérifié sur un build.

*(Dépassé le 2026-10-04 : le build est en `base: '/'` (`apps/web/vite.config.ts`), les chemins restent absolus et ne sont plus réécrits en `./…` — voir la section « Service statique » plus haut. `start_url` et `scope` du manifest, eux, ne sont pas revus ici.)*

Ce que Chrome / Edge exigent aujourd'hui pour proposer l'installation : un manifest (nom, `start_url`,
`display`, icônes 192 et 512) et un **contexte sécurisé**. Plus besoin de service worker. Conséquence :
le bouton apparaît sur `http://localhost:5173` (ou `:8787` sur la machine du serveur), **pas** sur
`http://<ip>:8787` depuis un autre écran — il faudra HTTPS (certificat local type mkcert, ou reverse
proxy avec Let's Encrypt) ; l'ajout à l'écran d'accueil d'iOS, lui, marche déjà par les
balises `apple-mobile-web-app-*`.

*(Mise à jour 2026-10-06 : le HTTPS existe désormais par l'adresse publique du proxy inverse (`MCP_PUBLIC_URL`) ; l'installation y est proposée dès la page de connexion. Voir la mise à jour du 2026-10-06 (soir).)*

L'icône — une tour de kasbah crénelée à murs en fruit, avec une extension moderne basse à bandeau
vitré (turquoise « Lagon » du thème) encastrée dans un coin — a été générée en SVG isométrique par un
script jetable (non versionné) puis rasterisée par Chrome sans interface
(`chrome --headless --screenshot --default-background-color=00000000`). Pour la retoucher, éditer
`icon.svg` / `icon-maskable.svg` puis refaire les PNG de la même façon ; Chrome garde en cache
l'icône d'une app déjà installée (désinstaller puis réinstaller).

### Mise à jour 2026-10-04 — prérequis d'une machine neuve

Ce qu'il faut installer sur la machine du serveur avant `npm run build && npm start` (Node, git,
ffmpeg, yt-dlp et son plugin `bgutil`, générateur PO Token), et ce qu'il faut recopier d'une
ancienne machine (`.env`, `.state/`, maison, `_external/`) : `5_0_installation-et-scripts.md`,
mise à jour du 2026-10-04 (bis). `npm start` ne lance **pas** le générateur PO Token, contrairement
à `npm run dev` / `npm run house` : en production il tourne à part, sur le port 4416.

### Mise à jour 2026-10-06 (soir) — accès depuis l'extérieur : l'adresse publique, derrière une connexion

**Ce que ça change pour qui déploie.** Poser `MCP_PUBLIC_URL` (adresse publique du proxy inverse) ne publie plus seulement le MCP : **toute l'application** devient joignable de l'extérieur, mais
derrière une connexion (page `/login`, comptes de `mcp-users.json`, cookie de session 90 jours
glissants). Le réseau local reste sans compte. C'est le NOM d'hôte qui décide : l'adresse publique
demande la connexion même depuis la maison. Raisons et décisions : `../1_architecture/1_7_serveur-mcp.md`,
mise à jour du 2026-10-06 (soir). Variables : `5_1_configuration-env.md` (même date).

**Procédure derrière un proxy inverse, dans l'ordre.**
1. `MCP_PUBLIC_URL` dans `apps/server/.env` **et Kasbah relancé AVANT** de créer ou modifier la règle :
   sans cela, la règle publie une application sans porte (ordre impératif inchangé).
2. Au moins un compte (`npm run mcp-user -w @kasbah/server -- add <nom>`, ou Réglages → Comptes **depuis
   le réseau local** : la gestion des comptes est refusée sous l'adresse publique, même connecté).
3. Proxy inversé : source HTTPS / nom public / 443, destination `http://<poste Kasbah>:8787`, certificat
   Let's Encrypt (détail dans la mise à jour du 2026-10-04 de 1_7).
4. En-têtes du proxy : activer le **WebSocket** (`Upgrade: $http_upgrade`, `Connection:
   $connection_upgrade`). Sans eux, la page s'ouvre mais l'état en direct ne passe pas. Pas de `Host` à
   ajouter : le proxy le transmet (vérifié).
5. Contrôle : `https://<nom public>/` doit renvoyer à `/login`, et `/api/session` (sans cookie) répondre
   401.

**Lecture sur les enceintes.** Sous l'adresse publique, lancer une musique sur une enceinte Cast ou Sonos
exige `MUSIC_PUBLISH_BASE` : une enceinte ne peut pas lire une adresse qui demande une session. Sans
elle, erreur « MUSIC_PUBLISH_BASE required when the UI is opened through the public address ». Les outils
MCP (`play_music`) passent par `app.inject` sous `localhost` : inchangés.

**Installation sur le téléphone (PWA).** La page de connexion annonce le manifest et les icônes
(servis sans session) : l'installation est proposée **dès la connexion**, plus seulement après (premier
constat de l'utilisateur en conditions réelles). Piège iPhone : l'app ajoutée à l'écran d'accueil a **ses
propres cookies**, il faut s'y connecter une fois ; sur Android l'app installée partage la connexion de
Chrome. Conseil : sur un téléphone, n'utiliser que l'adresse publique (une icône, mêmes réglages).

**Limites.** Blocage de compte en mémoire (un redémarrage débloque) ; page de connexion en français
seulement ; WebSocket ouvert avant une révocation vivant jusqu'à sa prochaine coupure.

Sources : `apps/server/src/http/session.ts`, `apps/server/.env.example`.

### Mise à jour 2026-10-07 — l'app installée reste en `standalone` : le plein écran au lancement, essayé et abandonné

**Demande de l'utilisateur.** Ouvrir l'app installée sur le téléphone directement en plein écran. Deux
essais, aucun retenu ; `manifest.webmanifest` garde `"display": "standalone"`.

1. **Option « Plein écran » mémorisée par appareil** (préférence dans `localStorage`, reprise au
   premier toucher après chaque ouverture, l'API plein écran exigeant un geste). Abandonnée sur le
   téléphone : quitter l'app fait sortir du plein écran, et il faut retoucher l'écran à chaque retour.
2. **`"display": "fullscreen"` dans le manifest.** Essayé sur Android (Chrome, app réinstallée). Au
   lancement, Android garde une **bande noire en haut** (la zone de la caméra) et Chrome donne à la
   page la hauteur de l'écran entier : tout est décalé vers le bas et **la barre d'icônes du bas de
   l'app passe sous le bord de l'écran**, au hasard des lancements. Un passage par les apps ouvertes
   (balayage vers le haut, puis retour) remet tout d'aplomb : l'app occupe alors tout l'écran. C'est un
   défaut de Chrome, que la page ne peut pas corriger : elle ne peut ni forcer Android à redessiner la
   fenêtre, ni appeler l'API plein écran sans geste. Effet de bord à éviter si on y revient : dans ce
   mode, l'interrupteur « Plein écran » de Réglages (API de la page) dirait « désactivé » sans rien
   pouvoir y faire ; l'essai le masquait sous `(display-mode: fullscreen)` (en le laissant visible
   pendant un plein écran par l'API, où ce media query vaut aussi).

**Références.**
- Chromium [407420295 — « Edge-to-Edge not working for fullscreen PWAs »](https://issues.chromium.org/issues/407420295) :
  `viewport-fit=cover` + `display: fullscreen`, l'app installée ne va pas dans la zone de la caméra,
  alors que la même page sous `requestFullscreen()` y va. Ouvert en mars 2025, « In Progress » ; état
  relevé le 2026-10-07 : correctifs de la zone de la caméra et des marges intégrés (CL 8223545, 8227486,
  8207801), reste la vérification et une mise derrière des paramètres avant diffusion (casses vues sur
  des sites en `viewport-fit=cover`) ; aucune date. Le même travail vise aussi `standalone` sous la
  barre d'état, et un commentaire y mentionne des redimensionnements au geste retour en `fullscreen`.
- Chromium [40780591 — « Full screen PWA clicks are showing top navigation bar »](https://issues.chromium.org/issues/40780591) :
  défaut voisin de 2021 (barres qui reviennent à chaque toucher, Android 10/11), corrigé dans Chrome
  95 ; on y contournait déjà en revenant à `standalone`.
- [tech-ish, juillet 2026](https://tech-ish.com/2026/07/15/google-chrome-for-android-pwa-edge-to-edge/)
  sur ce correctif ; d'autres projets ont fait le même choix ([retour à `standalone`](https://github.com/whisper-money/whisper-money/pull/1080),
  [plein écran redemandé au premier toucher](https://github.com/jpcpais01/Pixel-Game/pull/124),
  [limite connue](https://github.com/New-York-Chinese-Seventh-day-Adventist/sda-church-app/issues/180)).

**Pour réessayer** quand 407420295 sera dans Chrome stable : passer `display` à `fullscreen`, déployer,
puis sur le téléphone `chrome://webapks` → *Request update* pour Kasbah (ou réinstaller : sans cela
Chrome ne relit le manifest qu'environ une fois par jour, au lancement). Vérifier : pas de bande noire
en haut, barre d'icônes du bas visible dès le premier lancement, plusieurs lancements de suite. iPhone :
iOS ignore `fullscreen`, rien n'y change.

Sources : `apps/web/public/manifest.webmanifest`, `apps/web/src/stores/settings.ts` (`fullscreen`),
`apps/web/src/views/SettingsView.vue`, `apps/web/src/App.vue` (`100dvh`), `apps/web/src/components/layout/NavRail.vue` (barre du bas).

### Mise à jour 2026-10-13 — un écran resté ouvert pendant une mise à jour

**Symptôme.** Après un `npm run build` et le redémarrage du serveur, un clic dans le rail ne
faisait rien sur un écran resté ouvert (la tablette murale, typiquement), avec en console
`Failed to load module script: … MIME type of "text/html"`. Vite vide `dist/` à chaque build et
renomme les vues paresseuses (`ShoppingView-<hash>.js`) : l'ancien `index.html`, encore en mémoire,
demandait un fichier qui n'existait plus, et le repli SPA lui servait `index.html` à la place.

**Ce qui est fait (trois parties).**

1. **404 sous `/assets/`** (`apps/server/src/http/static.ts`) : le repli SPA ne couvre plus
   `/assets/*`. Un fichier absent est un vrai 404 JSON, lisible, au lieu d'un faux type MIME.
2. **Une vue qui ne se charge pas recharge la page** (`apps/web/src/router/index.ts`) :
   `router.onError` demande d'abord `/api/session` (une session finie renvoie toujours à la
   connexion) ; session bonne et erreur `TypeError` (un `import()` qui échoue, dans tous les
   navigateurs), la page se recharge sur la vue demandée. Une seule fois par fenêtre de 10 s
   (`sessionStorage`, clé `kasbah.chunkReloadAt`) : une vue toujours introuvable ne boucle pas.
3. **Bandeau « Nouvelle version » et rechargement automatique** :
   - le build écrit son identifiant (`Date.now()` en base 36) dans l'app (`__KASBAH_BUILD__`,
     `define` de `apps/web/vite.config.ts`, vide en dev) et à côté d'elle (`dist/build-id.txt`) ;
   - le serveur relit `build-id.txt` **à chaque connexion WebSocket** (`readAppBuild`,
     `appBuild` du snapshot) : un build refait est vu à la reconnexion qui suit le redémarrage ;
   - l'écran qui porte un autre build affiche `AppUpdateBanner.vue` et se recharge seul après
     **2 min sans interaction** (`pointerdown`, `keydown`, `wheel` relancent le délai,
     `apps/web/src/stores/appUpdate.ts`) ; **une fois par build** (`sessionStorage`,
     `kasbah.reloadedForBuild`) : si l'écart persiste après, le bandeau reste, sans boucle.

Le bandeau est en bas au centre, **au-dessus** de la barre de recherche de l'accueil, et seulement
en ligne (recharger hors ligne ne mène nulle part). En haut, à côté de la pastille de connexion, il
masquait le sélecteur d'étage, et il est cliquable, lui. Il s'abrège sur un écran étroit (vérifié à
300 px), le bouton reste entier.

**Écarté.** Garder les anciens fichiers (`emptyOutDir: false`) : les anciens écrans tournent, mais
`dist/` grossit et l'ancienne app continue de parler à un serveur plus récent. Une PWA avec service
worker (`vite-plugin-pwa`) : une couche de cache de plus, avec ses propres pièges, pour un besoin
que le snapshot couvre.

**À savoir.** L'identifiant est une heure, pas un hash du contenu : un build refait sans changement
affiche aussi le bandeau (recharger ne coûte rien). Les écrans ouverts avant ce changement ne
portent pas ce code : il faut les recharger à la main une dernière fois.

Vérifié sur un build réel servi par le serveur de démonstration : vue d'un build remplacé en 404
puis page rechargée sur `/shopping`, bandeau à la reconnexion, bouton Recharger ; thèmes clair et
sombre, fr et en, 1280, 375 et 300 px.

Sources : `apps/server/src/http/static.ts` (+ `static.test.ts`), `apps/server/src/ws/hub.ts`,
`apps/server/src/app.ts`, `packages/shared/src/protocol/ws.ts`, `apps/web/vite.config.ts`,
`apps/web/vitest.config.ts`, `apps/web/src/router/index.ts`, `apps/web/src/stores/appUpdate.ts`
(+ test), `apps/web/src/components/AppUpdateBanner.vue`.
