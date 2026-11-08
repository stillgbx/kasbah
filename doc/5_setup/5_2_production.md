# Production

> Dernière mise à jour : 2026-11-08
> Sources : `apps/server/build.mjs`, `apps/server/src/http/static.ts`, `apps/web/vite.config.ts`, `apps/server/src/core/paths.ts`, `apps/server/src/config/env.ts`, `apps/web/index.html`, `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/`, `apps/web/src/stores/appUpdate.ts`, `apps/web/src/components/AppUpdateBanner.vue`, `scripts/supervisor.mjs`, `apps/server/src/http/system.ts`, `site/`, `.github/workflows/pages.yml`, `apps/web/src/stores/push.ts` (2026-10-29)

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

*(Mise à jour 2026-10-28 : la tour n'a plus de fenêtres, et refaire les PNG a ses pièges — voir la section « Mise à jour 2026-10-28 (bis) » en fin de page.)*

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

### Mise à jour 2026-10-13 (bis) — superviseur et mise à jour depuis Réglages

**Besoin.** Mettre le serveur à jour sans être devant la machine. Jusqu'ici : `git pull`, `npm run build`
et relance de `npm start` à la main, dans un terminal du poste.

**Ce qui est fait.**

- **`scripts/supervisor.mjs`**, sans dépendance, lance `apps/server/dist/main.js` en processus enfant
  avec un canal IPC (build d'abord si `dist/main.js` manque). Il relance le serveur s'il tombe, après
  1 s, puis 2, 4… jusqu'à 60 s ; le délai revient à 1 s après une minute de marche. Le journal du
  serveur et le sien vont dans `logs/kasbah.log` (ignoré par git, `*.log`), copié en `kasbah.1.log`
  au-delà de 10 Mo.
- **Réglages → Mise à jour du serveur** (`../4_ui/4_7_reglages.md`) montre le commit en service et ceux
  qui attendent sur `origin/main`, et demande la mise à jour au superviseur (routes `/api/system/*`,
  `apps/server/src/http/system.ts`, détail dans `../1_architecture/1_3_protocole-rest-ws.md`).
  **Réseau local seulement**, même connecté (`LAN_ONLY`).
- Le serveur, quand il a un superviseur (`process.send`, `apps/server/src/main.ts`) : dit « prêt »
  une fois ses plugins démarrés, s'arrête proprement sur demande (`shutdown`), et s'arrête aussi si le
  superviseur disparaît (`disconnect`). Sous Windows, tuer le parent ne tue pas l'enfant : le port
  8787 resterait pris et le superviseur suivant ne pourrait plus démarrer le serveur.

**Déroulé d'une mise à jour.** Le superviseur écrit chaque étape dans `.state/update-status.json`, que
Réglages relit.

| Étape | Ce qui se passe | Serveur |
|---|---|---|
| Récupération | vérifie qu'on est sur `main`, `git fetch origin main`, avance rapide (`git merge --ff-only`) | en service |
| Dépendances | `npm ci`, **seulement si `package-lock.json` a changé** | **arrêté** : `npm ci` efface `node_modules`, que Windows verrouille (modules natifs) tant que le serveur tourne |
| Construction | `npm run build` | en service (sauf si les dépendances ont changé) |
| Redémarrage | arrêt propre, relance, attente du « prêt » (3 min au plus) | coupure de quelques secondes ; une à deux minutes avec `npm ci` |

Une étape qui échoue avant tout changement (réseau absent, mauvaise branche, fichiers suivis modifiés
localement qui bloquent l'avance rapide) **ne touche à rien**. Au-delà, le superviseur **revient au
commit d'avant** : `git reset --keep`, `npm ci` si le lock avait changé, build, relance. Réglages dit
l'étape en cause, si le retour a réussi, et les 60 dernières lignes de sortie. Un nouveau serveur qui
tombe ou ne dit pas « prêt » compte comme un échec : un commit qui casse le démarrage revient en
arrière tout seul.

**Prérequis sur la machine.**

- Un **clone git** dont `origin` est le dépôt GitHub, **sur `main`**, sans modification locale des
  fichiers suivis. Dépôt public en HTTPS : `git fetch` ne demande rien.
- Les outils et les fichiers hors dépôt de `5_0_installation-et-scripts.md` (mise à jour du
  2026-10-04 (bis)) : Node, ffmpeg, `_external/`, `apps/server/.env`, `.state/`, `house/properties/`.
- **Si la machine sert aussi au développement**, un clone réservé à la production (par exemple
  `D:\kasbah-prod` ou `/opt/kasbah`). Une mise à jour ne touche alors jamais un travail en cours, et le
  dépôt de développement tourne sur les démonstrations, sur d'autres ports et un autre état
  (`KASBAH_PORT`, `KASBAH_SERVER`, `KASBAH_STATE_DIR`). Deux serveurs sur les mêmes `.env` et `.state/`
  partagent les jetons des fabricants et les quotas des comptes, et leurs automatisations se
  déclenchent deux fois.
- Arrêter le `npm start` lancé à la main avant d'installer le superviseur (port 8787).

**Windows — tâche planifiée.** Le superviseur doit tourner **avec le compte de l'utilisateur**, pas en
service système : un service ne verrait ni son `PATH` (ffmpeg installé par winget) ni son profil. Dans
un PowerShell ouvert dans le clone de production :

*(Précisé le 2026-10-26 : ce PowerShell doit être ouvert **en administrateur**, et placé dans le clone
par `Set-Location` avant le bloc. Voir « Mise à jour 2026-10-26 » en fin de page.)*

```powershell
$cred = Get-Credential "$env:USERDOMAIN\$env:USERNAME"   # le mot de passe Windows, pas le code PIN
$action = New-ScheduledTaskAction -Execute (Get-Command node).Source -Argument 'scripts\supervisor.mjs' -WorkingDirectory (Get-Location).Path
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'Kasbah' -Action $action -Trigger $trigger -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited
Start-ScheduledTask -TaskName 'Kasbah'
```

- `-AtStartup` avec un mot de passe enregistré équivaut à « Exécuter même si l'utilisateur n'est pas
  connecté » : Kasbah repart après un redémarrage imposé par Windows Update, sans ouverture de session.
  Un compte Microsoft demande le mot de passe du compte Microsoft.
- `-ExecutionTimeLimit 0` est **indispensable** : par défaut, le Planificateur arrête une tâche au bout
  de 72 h.
- `-RestartCount` / `-RestartInterval` : le filet si le superviseur lui-même tombe.
- La même chose à la souris : Planificateur de tâches → Créer une tâche. Général : « Exécuter même si
  l'utilisateur n'est pas connecté ». Déclencheurs : « Au démarrage ». Actions : programme `node.exe`
  (chemin complet, `where node`), arguments `scripts\supervisor.mjs`, « Commencer dans » le clone.
  Paramètres : décocher « Arrêter la tâche si elle s'exécute plus de », cocher « Si la tâche échoue,
  redémarrer toutes les » 1 minute.
- Suivre : `Get-Content logs\kasbah.log -Wait -Tail 50`. Arrêter : `Stop-ScheduledTask -TaskName Kasbah`
  (le superviseur est tué, le serveur le voit et s'arrête proprement). Après une modification du
  superviseur lui-même : `Stop-ScheduledTask` puis `Start-ScheduledTask`.
- La tâche tourne sans fenêtre, et Windows ne peut donc pas y demander l'autorisation du pare-feu. Si
  les écrans n'atteignent pas 8787, autoriser Node pour les réseaux **privés** (Pare-feu Windows →
  Autoriser une application), ou lancer une fois `node scripts/supervisor.mjs` dans un terminal pour
  faire apparaître la demande.

**Linux — service systemd.** Fichier `/etc/systemd/system/kasbah.service`. L'utilisateur du service doit
posséder le clone : le superviseur y écrit (`git`, `npm ci`, build).

```ini
[Unit]
Description=Kasbah
After=network-online.target
Wants=network-online.target

[Service]
User=kasbah
WorkingDirectory=/opt/kasbah
# chemin donné par `which node` pour cet utilisateur (nvm le met ailleurs que /usr/bin)
ExecStart=/usr/bin/node scripts/supervisor.mjs
Restart=on-failure
RestartSec=5
# SIGTERM au superviseur seul, qui arrête le serveur proprement ; le reste est tué après le délai
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kasbah
journalctl -u kasbah -f        # ou : tail -f /opt/kasbah/logs/kasbah.log
```

ffmpeg et yt-dlp doivent être dans le `PATH` du service (`/usr/bin`), ou désignés dans `.env`
(`FFMPEG_PATH`, `YTM_YTDLP_PATH`).

**Limites.**

- Une modification de `scripts/supervisor.mjs` ne vaut qu'à son prochain démarrage (Réglages le
  signale) : relancer la tâche ou le service.
- Une nouvelle variable de `.env` reste à poser à la main.
- Pas de retour à une version choisie : seulement le retour automatique au commit d'avant un échec.
- Pendant la construction, Vite vide `apps/web/dist` : un écran qui ouvre une vue à ce moment la
  recharge (mécanisme du 2026-10-13 ci-dessus), puis le bandeau « Nouvelle version » suit le
  redémarrage.
- La branche suivie est `main`, en dur.

**Écarté.**

- Un runner GitHub Actions installé sur le serveur : le dépôt est public, une PR venue d'un fork
  pourrait exécuter du code sur la machine qui pilote la maison.
- pm2 : il relance un processus mais ne fait pas la mise à jour. Sous Windows, son démarrage
  automatique passe par un service système (`pm2-windows-startup`, `pm2-installer`), avec le problème
  de `PATH` déjà noté.
- Une tâche planifiée qui lance la mise à jour tous les quarts d'heure : elle ne serait pas le parent du
  serveur, et devrait le retrouver par son port pour le tuer.

**Vérifié** : les routes et la garde réseau local, par des tests (`apps/server/src/http/system.test.ts`,
`session.test.ts`) ; la carte, dans la preview. Le superviseur, de bout en bout sous Windows 11, sur
une copie de production (clone d'un dépôt « origine » local, maison de démonstration, port et état à
part), un commit poussé par cas :

| Cas | Résultat | Coupure |
|---|---|---|
| commit ordinaire | à jour en ~11 s, arrêt propre (code 0) | ~3,5 s |
| build cassé | échec à « Construction », retour au commit d'avant ; le journal garde l'erreur d'esbuild (fichier, ligne) | ~3 s (relance après le rebuild) |
| serveur qui plante au démarrage | échec à « Redémarrage », retour en arrière ; la pile d'erreur du serveur est dans le journal | ~11 s |
| `package-lock.json` modifié | arrêt, `npm ci` (~30 s), build, relance : pas d'`EPERM` | ~56 s |
| `scripts/supervisor.mjs` modifié | mise à jour faite, `supervisorChanged` signalé | ~3 s |
| serveur tué hors mise à jour | relancé après 1 s | ~5 s |
| superviseur tué (comme « Arrêter la tâche ») | le serveur s'arrête et libère le port | — |

Ce premier essai a fait corriger deux défauts : le journal affiché était celui du rebuild de l'ancienne
version, qui chassait l'erreur, et il gardait les codes de couleur du terminal. **Pas encore éprouvé** :
la tâche planifiée Windows et le service systemd ci-dessus, à confirmer au premier déploiement.

*(Mise à jour 2026-10-26 : la tâche planifiée Windows est éprouvée au premier déploiement, voir en fin
de page. Le service systemd reste à éprouver.)*

Sources : `scripts/supervisor.mjs`, `apps/server/src/http/system.ts` (+ test), `apps/server/src/main.ts`,
`apps/server/src/app.ts`, `apps/server/src/http/session.ts`, `apps/web/src/components/settings/ServerUpdateCard.vue`.

## Mise à jour 2026-10-24 — cacher les lignes de commande des autres comptes (`hidepid`)

Le relais vidéo Nest passe à ffmpeg une adresse qui contient un jeton d'accès au flux (constat F38, voir
`../3_plugins/3_5_google-nest.md`). Sous Linux, toute ligne de commande est lisible par tous les comptes
de la machine. Si le serveur de production a d'autres comptes que celui de Kasbah, monter `/proc` avec
`hidepid=2` : chaque compte ne voit plus que ses propres processus.

```
# /etc/fstab
proc  /proc  proc  defaults,hidepid=2  0  0
```

puis `sudo mount -o remount,hidepid=2 /proc`. Sans autre compte local, rien à faire.

*(Le même jour, F38 a été corrigé dans le code : le jeton ne passe plus par la ligne de commande
de ffmpeg, voir `../3_plugins/3_5_google-nest.md`. `hidepid` reste une bonne pratique, mais n'est
plus nécessaire pour ce jeton.)*

## Mise à jour 2026-10-26 — la tâche planifiée Windows, éprouvée au premier déploiement

**Symptôme.** Le bloc PowerShell de la mise à jour du 2026-10-13 (bis), lancé dans une console
ordinaire, échoue sur `Register-ScheduledTask` : « Accès refusé », `HRESULT 0x80070005`
(`PermissionDenied`).

**Cause.** Enregistrer une tâche **au démarrage** (`-AtStartup`) avec un **mot de passe enregistré**
(« Exécuter même si l'utilisateur n'est pas connecté ») demande les droits d'administrateur. Seul
l'enregistrement les demande : la tâche, elle, tourne avec le compte de l'utilisateur (`-User`) et sans
élévation (`-RunLevel Limited`), comme prévu.

**Procédure corrigée.**
1. Ouvrir PowerShell **en tant qu'administrateur**.
2. Se placer dans le clone de production : `Set-Location <clone de production>`. Une console
   administrateur s'ouvre dans `C:\Windows\system32`, et le bloc prend le dossier courant comme
   dossier de travail de la tâche (`-WorkingDirectory (Get-Location).Path`) : sans cela, la tâche
   chercherait `scripts\supervisor.mjs` dans `system32`.
3. Lancer le bloc tel quel. Le suivi (`Get-Content logs\kasbah.log -Wait -Tail 50`) se fait dans une
   console ordinaire.

**Vérifié au premier déploiement, sur la vraie machine** (clone de production séparé du dépôt de
développement) :
- `Get-ScheduledTask -TaskName Kasbah` : état `Running`. `Get-ScheduledTaskInfo` rend
  `LastTaskResult` 267009 : c'est `SCHED_S_TASK_RUNNING` (tâche en cours), pas une erreur ;
- le serveur écoute sur 8787, tous les plugins démarrés dans `logs/kasbah.log` ;
- `GET /api/system/version` rend `"supervised": true` et le commit en service.

**Pas encore éprouvé** : une mise à jour réelle lancée depuis Réglages sur cette installation (au
prochain commit poussé sur `main`), et le redémarrage de Windows sans ouverture de session.

*(Le même soir : la mise à jour réelle est éprouvée, voir ci-dessous. Reste le redémarrage de Windows.)*

**Première mise à jour réelle : échec, puis réussite.**
- **Échec** : le clone de production avait été rempli par **copie** du dépôt de développement, `node_modules`
  et `dist/` compris. Les jonctions `node_modules/@kasbah/*` y étaient devenues des dossiers vides :
  build serveur en échec (`Could not resolve "@kasbah/shared"`), retour en arrière en échec pour la même
  raison, serveur resté en service sur l'ancien commit, mais build web refait avec des imports bruts qui
  cassent les vues. Détail : `../6_faq/6_0_pieges-outillage.md`, entrée du 2026-10-26.
  *(Précisé le même jour : le build web échouait lui aussi, mais après avoir écrit ses fichiers dans
  `dist/`. Depuis le greffon `kasbah-fail-unresolved` de `apps/web/vite.config.ts`, un build web raté
  ne touche plus à `dist/` : les écrans gardent la version en service.)*
- **Correction** : `Stop-ScheduledTask -TaskName Kasbah` (une console ordinaire suffit pour arrêter et
  relancer la tâche ; seul l'enregistrement demande l'administrateur), `npm ci` dans le clone,
  `Start-ScheduledTask -TaskName Kasbah`.
- **Réussite** : mise à jour de bout en bout en ~12 s, coupure ~9 s, arrêt propre (code 0).

**Prérequis précisé.** `node_modules` ne se copie pas d'une installation à l'autre : `npm ci` dans le
clone de production, avant le premier démarrage. Les fichiers hors dépôt de la liste du 2026-10-13 (bis)
(`.env`, `.state/`, `house/properties/`, `_external/`) se recopient, eux.

**Mettre à jour sans Réglages.** Quand la vue Réglages ne s'ouvre plus (build web cassé, par exemple),
la même demande se fait depuis le poste serveur, dans une console ordinaire :

```powershell
Invoke-WebRequest http://localhost:8787/api/system/update -Method Post -ContentType 'application/json' -Body '{}' -UseBasicParsing
```

Réponse `202` ; l'avancement se lit dans `apps/server/.state/update-status.json` ou par
`GET /api/system/update`. Sans `-ContentType` ni `-Body`, PowerShell envoie un `POST` en
`application/x-www-form-urlencoded`, que Fastify refuse (415, `FST_ERR_CTP_INVALID_MEDIA_TYPE`).

**Rappel.** Un clone de production lancé sans `KASBAH_HOUSE_FILE` sert les propriétés de
`house/properties/` (mode « réel » par défaut dès qu'il y en a une, `apps/server/src/config/catalog.ts`) :
recopier ce dossier depuis l'ancienne installation suffit, il n'y a pas de `house/maison.json` à poser.

Sources : `scripts/supervisor.mjs`, `apps/server/src/http/system.ts`, `apps/server/src/config/properties.ts`,
`apps/server/src/config/catalog.ts`.

## Mise à jour 2026-10-28 — notifications push : HTTPS exigé, un service worker, deux fichiers d'état

- **Contexte sécurisé obligatoire.** Les notifications (Web Push) ne marchent que par l'**adresse
  publique HTTPS** (`MCP_PUBLIC_URL`, voir la mise à jour du 2026-10-06 (soir)) ou `localhost`. Par
  `http://<poste>:8787` depuis un autre écran, la carte Réglages → Notifications le dit et ne
  propose rien. Sur iPhone, seulement l'app **installée sur l'écran d'accueil** (iOS 16.4 ou plus).
- **Un service worker existe désormais** : `apps/web/public/sw.js`, servi à la racine. Il ne fait que
  les notifications (pas de cache, pas de mode hors ligne). La phrase de la mise à jour PWA du
  2026-09-23, « plus besoin de service worker », reste vraie pour l'**installation** ; elle ne vaut pas
  pour les notifications.
- **Fichiers d'état** (dossier `.state/`, non versionnés) : `push.json` (clés VAPID **dont la clé
  privée**, et abonnements) et `push-alerts.json` (ids des alertes déjà notifiées, pour qu'un
  redémarrage ne renvoie rien). Supprimer `push.json` crée de nouvelles clés : les écrans se
  réabonnent à leur prochaine ouverture. L'émission sort du serveur vers le service de push du
  navigateur (via `publicFetch`) : le serveur doit pouvoir joindre Internet.

Détail : [1_16 Notifications push](../1_architecture/1_16_notifications-push.md).

Sources : `apps/web/public/sw.js`, `apps/server/src/core/push/{service,alerts}.ts`, `apps/server/src/app.ts`.

## Mise à jour 2026-10-28 (bis) — logo sans fenêtres, deux coutures, et refaire les PNG

**La tour perd ses fenêtres.** Les cinq polygones sombres (`rgba(13,20,32,0.85)`, `#d90d1420` côté
Android) sont retirés partout où le logo est dessiné : `icon.svg`, `icon-maskable.svg`, les quatre PNG,
et les drawables Android `ic_kasbah_logo.xml` (écran de l'appli) et `ic_launcher_foreground.xml`
(icône, repris par `ic_launcher_logo` et `ic_launcher_foreground_badged`). Les deux familles de
coordonnées diffèrent : `ic_kasbah_logo` suit `icon.svg`, `ic_launcher_foreground` suit
`icon-maskable.svg`.

Sans les fenêtres, deux défauts de couture se voyaient sur les arêtes :

- **Liseré sombre sous les créneaux.** Le dessus de la tour (`#8f5f35`) était peint après les deux
  faces ; son contour de 0,6 débordait sur le haut des murs et ressortait sous le bord lissé des
  créneaux, qui sont dans le prolongement des murs. Il est maintenant peint **avant** les faces.
- **Point turquoise sur l'arête centrale.** Le dessus du cube était d'abord peint en entier, y compris
  sous la tour (jusqu'à x = 184,4 pour une arête à 193,9) : la couture lissée entre les deux faces de
  la tour laissait voir le turquoise à cette hauteur. Ce premier polygone s'arrête désormais à
  x = 205 (`icon.svg`) / 215 (`icon-maskable.svg`), sous la face droite, avant l'arête.

Règle générale : une forme cachée par la tour ne doit pas passer sous une arête **intérieure** de
celle-ci, la couture entre deux faces adjacentes n'étant jamais tout à fait opaque.

**Refaire les PNG avec Chrome sans interface :**

- Une fenêtre de moins de ~500 px rend une image tronquée (192 et 180 sortent coupés). On rend
  toujours en `--window-size=512,512` et on réduit par `--force-device-scale-factor` : 0,375 pour
  `icon-192.png`, 0,3515625 pour `apple-touch-icon.png` (180).
- `apple-touch-icon.png` vient de `icon-maskable.svg` (fond plein, iOS arrondit lui-même) ;
  `icon-512.png` et `icon-192.png` de `icon.svg` (coins transparents).
- Depuis Git Bash, donner à `--screenshot=` un chemin à barres obliques (`D:/…/icon-192.png`) : avec
  des antislashs, Chrome n'a parfois rien écrit (« Unsupported screenshot image file type »). Depuis
  PowerShell, `chrome.exe` rend la main avant d'écrire le fichier : rien n'est produit.
- Pour juger une arête, rendre le SVG dans une page HTML à `width: 8192px` décalée sur la zone
  (×16) : un défaut de couture est invisible à 512.

Sources : `apps/web/public/icons/`, `apps/android/app/src/main/res/drawable/{ic_kasbah_logo,ic_launcher_foreground}.xml`.

## Mise à jour 2026-10-29 — le site vitrine sur GitHub Pages (`site/`)

Une page publique qui se partage (X, Discord, README), montre la vidéo, et porte l'URL de la
**politique de confidentialité** qu'exige la fiche Google Play de l'appli Android :
`https://stillgbx.github.io/kasbah/` (anglais) et `/fr/` (français), chacune avec son `privacy.html`.

- **Où** : le dossier `site/` à la racine — `index.html`, `privacy.html`, `fr/` (les deux mêmes pages
  en français), un seul `style.css`, `assets/`. Pas le mode « dossier `/docs` » de Pages : `docs/` porte
  déjà la documentation des plugins.
- **Publication** : `.github/workflows/pages.yml`, sur tout push de `site/**` dans `main` (ou à la main,
  `workflow_dispatch`) : `upload-pages-artifact` (chemin `site`) puis `deploy-pages`. Prérequis réglé
  une fois dans le dépôt : Settings → Pages → Source = **GitHub Actions**. Ne pas cliquer « Configure »
  sur cette page : GitHub commiterait un second workflow concurrent. Le jeton par défaut des Actions
  n'a pas les droits pour activer Pages lui-même.
- **Technique** : HTML et CSS écrits à la main, aucune dépendance ni étape de build. Couleurs = variante
  sombre du thème Kasbah (`apps/web/src/themes/kasbah.ts`) plus le sable du logo (`#e0aa70`) ; sombre
  seulement.
- **Aucune requête vers un tiers tant qu'on ne clique pas** : la police Plus Jakarta Sans est servie par
  le site (le `woff2` latin de `@fontsource-variable`, 27 Ko), pas par Google Fonts ; la vidéo est une
  affiche locale qui ne devient un `iframe` `youtube-nocookie.com` qu'au clic (dix lignes de script ;
  sans JavaScript, un simple lien). C'est ce qui permet à la politique de confidentialité de dire que le
  site ne charge rien d'ailleurs.
- **Images** : uniquement des captures des **démos** (Les Embruns, Les Tilleuls, `docs/screenshots/`),
  ré-encodées par ffmpeg en WebP (1280 px, ~20 à 60 Ko chacune). `og-image.png` (1200 × 630, aperçu des
  liens) est un rendu des Embruns recadré sur la 3D, assombri en dégradé, avec le logo et le titre
  posés par `drawtext` en Segoe UI (ffmpeg ne lit pas le `woff2`). Le site pèse ~440 Ko hors cette image.
  Remplacée le jour même par `og-card.png` : la carte titre de la vidéo (logo, « Kasbah », « Your
  whole home. One app. ») recadrée de 16:9 en 1200 × 630, choisie par l'utilisateur parce que l'aperçu
  d'un lien doit montrer la marque, la piscine restant l'affiche de la vidéo. Un **nouveau nom de
  fichier** plutôt que l'ancien écrasé : Discord et X gardent l'image d'une URL en cache.
- **YouTube choisit seul la qualité** de la vidéo intégrée, d'après la taille du lecteur et le débit ;
  `vq=hd1080` dans l'URL est ignoré depuis des années.
- **Une vidéo par langue** (2026-11-03) : `fr/index.html` intègre la version française de la vidéo,
  `index.html` l'anglaise. L'identifiant YouTube revient trois fois par page (`og:video`, `href` et
  `data-id` de l'affiche, lien du pied de page) ; l'affiche locale est commune. Même partage pour les
  README : `README.fr.md` pointe sur la vidéo française (bannière et « Voir la vidéo »), `README.md`
  sur l'anglaise.
- **Playlists et tutos** (2026-11-04) : la chaîne a une playlist par langue (EN `PLafIQZ_WgF34`, FR
  `PLIs8W3H_CjZ4`), avec la vidéo de promo puis les tutos. Le lien du pied de page devient
  « Videos » / « Vidéos » et pointe sur la playlist de la langue : l'identifiant de la vidéo de promo
  ne revient plus que deux fois par page (`og:video`, affiche). Une section **Tutorials / Tutos**
  (`#tutorials`, après « Démarrer », entrée dans le menu) aligne des cartes vidéo (`.tutos` / `.tuto`
  de `style.css`, grille `auto-fill` à 280 px) : miniature, titre, une phrase, lien
  `watch?v=<id>&list=<playlist>` pour que YouTube enchaîne sur la suite. Pas d'intégration ni de
  miniature `i.ytimg.com` : l'image est locale (`assets/tuto-install-en.webp` / `-fr.webp`, WebP
  800 × 450, ~17 Ko, réduits des miniatures `@2x` fournies par l'utilisateur), si bien que le site ne
  charge toujours rien de YouTube avant un clic. Le bouton lecture de `.video__play` est réduit et
  posé dans le coin bas-droit : centré, il cachait le titre que la miniature porte en son milieu.
  Ajouter un tuto = un `<li>` de plus sur chacune des deux pages.
- **Vidéos envoyées en 1440p** (2026-11-04) : envoyées en 1080p60, les vidéos n'avaient reçu de YouTube
  qu'un jeu de formats réduit (VP9 en 360p seulement, AV1 incomplet), et la qualité automatique restait
  en 240p AV1, dans le lecteur intégré au site comme sur youtube.com, connecté, lecteur de 2545 px.
  Une autre vidéo, dans le même navigateur, partait en 720p. Les mêmes vidéos agrandies en
  2560 × 1440 avant l'envoi (`ffmpeg -vf scale=2560:1440:flags=lanczos -c:v libx264 -preset slow
  -crf 16 -g 30 -c:a copy`) reçoivent d'emblée l'échelle VP9 complète, de 144p à 1440p60, et le
  lecteur du site (1118 × 628) passe en 1080p dès la première seconde. Les quatre vidéos ont été
  renvoyées ainsi : les identifiants du site et des README ont changé. Pour mesurer : le panneau
  navigateur intégré ne vaut rien (240p partout, y compris sur une vidéo témoin) ; Claude in Chrome
  oui, formats lus dans `ytInitialPlayerResponse.streamingData.adaptiveFormats`, qualité du lecteur
  intégré par `enablejsapi=1` et les messages `infoDelivery`.
- **Politique de confidentialité** : écrite d'après le code de `apps/android` (ce que garde
  `KasbahClient`, le géorepérage d'`Approach.kt`, le micro de `Voice.kt`, l'écran Voiture de
  `ProbeScreen.kt`, qui affiche sans rien envoyer). À relire à chaque permission ajoutée au manifeste.
  Contact : les issues GitHub, pour ne pas écrire d'adresse dans le dépôt public.
- **Langue** : un script en tête des deux pages anglaises renvoie vers `fr/` un navigateur dont la
  PREMIÈRE langue est le français, sauf si la pastille EN / FR a déjà servi : elle écrit
  `kasbah-lang` dans le `localStorage`, que la redirection respecte. Les robots d'aperçu de liens
  n'exécutent pas de script et voient la page demandée. La section « Ce site » des deux politiques le
  dit. Le titre français, plus long, a droit à `18ch` au lieu de `14ch` (`.hero h1:lang(fr)`) pour
  rester sur deux lignes comme l'anglais ; sur téléphone il en prend trois.
  *Correction 2026-11-04* : la condition était `!chosen && navigateur français`, si bien qu'un choix
  mémorisé, **même `fr`**, coupait la redirection : avoir cliqué FR une fois laissait la racine en
  anglais. Elle est devenue `chosen === 'fr' || (!chosen && navigateur français)` dans `index.html` et
  `privacy.html` : le choix de la pastille l'emporte, sinon la langue du navigateur. Pour tester en
  local, recharger vraiment la page (`location.reload()`) : une navigation qui ne change que le `#`
  ne relance pas le script.
- **Formulaire des fabricants et commerçants** (2026-11-06) : un encadré `#partners` à la fin de la
  section Plugins des deux pages (`.partner` / `.form` de `style.css`) invite à prêter du matériel pour
  qu'on l'intègre. Le formulaire est envoyé à **Web3Forms** (`api.web3forms.com/submit`, en JSON par
  `fetch`, la page reste affichée ; sans JavaScript, le POST classique mène à la page de confirmation de
  Web3Forms), qui le transmet par mail. La clé d'accès (`access_key`, champ caché) est **publique par
  nature** : elle ne fait qu'envoyer vers l'adresse qui l'a créée, un alias Proton Pass de la boîte du
  projet, désactivable en cas de spam sans toucher à l'adresse principale, qui n'apparaît nulle part.
  Écartés : le `mailto:` masqué (rien ne se passe chez qui n'a pas de client mail configuré),
  Formspree (50 messages par mois, compte obligatoire), Formsubmit (adresse dans l'URL). Anti-spam :
  la case `botcheck`, hors écran, que seuls les robots cochent. La ligne d'état (`.form__status`,
  `role="status"`) réserve deux lignes ; sous 520 px elle passe sous le bouton, sinon le message
  français en prenait trois et repoussait la note de 23 px. Les simples utilisateurs sont renvoyés vers
  les issues GitHub. La section « Ce site » des deux politiques (ancre `#website`) décrit l'envoi.
  Envoi réel vérifié depuis la preview locale, message reçu.
- **Vérifier en local** : config `kasbah-site` de `.claude/launch.json`
  (`python -m http.server 8090 --directory site`), puis la page à 375 px et sur bureau.

Sources : `site/`, `.github/workflows/pages.yml`, `.claude/launch.json`, `_generated-ai-doc/plan-site-android-nest.md` §1 (non versionné).

### Mise à jour 2026-10-29 — la démo web sur Pages (`/kasbah/demo/`)

But : voir l'app sans rien installer, depuis le bouton **Try the demo** / **Essayer la démo** du site.
C'est l'app web elle-même, sur la simulation in-process (`../3_plugins/3_0_simulation-mock.md`), pas
une maquette.

- **Build** : `npm run build:demo -w @kasbah/web` = `vite build --mode demo`. Le mode `demo` de
  `apps/web/vite.config.ts` pose `base` = `/kasbah/demo/`, sort dans `apps/web/dist-demo/` (ignoré par
  git ; le `dist/` que sert le serveur n'est pas touché) et force `import.meta.env.VITE_INPROCESS_MOCK`
  à `'1'` par `define`. Pas de fichier `.env.demo` : `.env*` est ignoré par git, il ne partirait pas en CI.
- **Ce que la démo n'emporte pas** (plugin `kasbah-demo` du même fichier) : `sw.js` (push), `diag.html`
  (il poste au serveur) et le manifeste d'installation (lien retiré de la page). Le store `push` se
  déclare non pris en charge en démo (`apps/web/src/stores/push.ts`) : sans ça, il enregistrait
  `/sw.js` **à la racine du domaine** `stillgbx.github.io`, que partagent toutes les pages Pages du compte.
- **Content-Security-Policy en `<meta>`** : Pages n'envoie pas d'en-têtes. Scripts du site seuls
  (`'wasm-unsafe-eval'` pour le lecteur `.om` du radar, `worker-src blob:` pour MapLibre), styles
  `'unsafe-inline'` (Vue et Vuetify posent des attributs `style`), `connect-src` et `img-src` limités
  au site et à cinq hôtes de données : `tiles.openfreemap.org`, `data.geopf.fr`, `api.rainviewer.com`,
  `tilecache.rainviewer.com`, `openmeteo.s3.amazonaws.com` (cartes, radar, IGN). `photon.komoot.io`
  (repli de la recherche d'adresse) reste bloqué. Vérifié dans le navigateur : l'accueil ne sort pas
  du site, la page Météo ne sort que vers ces hôtes ; un hôte retiré de la liste est bloqué.
- **Workflow durci** (`.github/workflows/pages.yml`) : déclenché aussi par `apps/web/**`,
  `packages/shared/**`, `packages/mock-sim/**`, `house/demos/**`, `package-lock.json`. Deux jobs : le
  build (jeton `contents: read`, `checkout` sans identifiants persistés, `npm ci --ignore-scripts`)
  puis le déploiement, seul à avoir `pages: write` et `id-token: write`, qui n'exécute aucun code du
  dépôt ni de npm. Actions épinglées par SHA de commit (dernier correctif des versions majeures déjà
  utilisées). `configure-pages` retiré : il ne sert qu'aux générateurs qui lisent l'URL de base.
  `npm ci --ignore-scripts` puis `build:demo` vérifiés sur un checkout propre (Windows).
- **`site/404.html`** : Pages le sert pour toute adresse absente du site ; une page profonde de la
  démo rechargée ou partagée (`/kasbah/demo/weather`) y est renvoyée vers `/kasbah/demo/`, faute
  d'`index.html` à cette adresse. Liens absolus, puisque la page s'affiche à n'importe quelle adresse.
  Non vérifié sur Pages au moment de l'écrire.
- **Données privées** : le contenu construit passé contre `.private-denylist` (55 règles, aucune trouvée).
- **Politique de confidentialité** : la section « This website » / « Ce site » décrit la démo (tout dans
  le navigateur, réglages dans le stockage local, les hôtes des cartes et du radar).
- **Voix de l'assistant simulé** : le même plugin copie `apps/web/demo/voice/` (sans son README) dans
  `voice/` à côté du build ; détails dans `../1_architecture/1_9_assistant.md`, mise à jour du 2026-10-29.
- **Aperçu des liens** : le même plugin pose dans la page de démo le titre, la description, les balises
  Open Graph et la carte `summary_large_image` de X. L'image, `site/assets/og-demo.jpg` (1200 × 630,
  ~100 Ko), est un rendu des Embruns en coupe recadré, avec un bandeau « Kasbah / Live demo – try it in
  your browser, nothing to install » posé par ffmpeg (`drawbox` + `drawtext` en Segoe UI) ; choisie par
  l'utilisateur plutôt que la capture seule, pour que l'aperçu dise que c'est une démo à essayer, et
  distincte de `og-card.png` pour qu'un lien vers la démo ne ressemble pas à un lien vers le site.
  Adresse absolue (`DEMO_SITE`) : les robots la lisent depuis ailleurs.
- **Vérifier en local** : `npm run build:demo -w @kasbah/web`, puis la config `kasbah-demo-static` de
  `.claude/launch.json` (`vite preview --mode demo`, port 8091) et `http://localhost:8091/kasbah/demo/`.

Sources : `apps/web/vite.config.ts`, `apps/web/package.json`, `apps/web/src/stores/push.ts`, `.github/workflows/pages.yml`, `site/404.html`, `site/privacy.html`, `site/fr/privacy.html`, `.claude/launch.json`.

## Mise à jour 2026-10-31 — un raccourci « Demander à Kasbah » dans le manifest

Le manifest gagne un membre `shortcuts` (une entrée, adresse `./?ask&source=shortcut`) : appui long sur
l'icône de l'app installée, raccourci à glisser sur l'écran d'accueil. Ce qu'il ouvre :
`../1_architecture/1_9_assistant.md`, mise à jour du 2026-10-31.

- **Icônes** (`apps/web/public/icons/`) : le micro de l'app (`mic` de `src/lib/strokeIcons.ts`) en
  sombre dans une bulle sable `#e0aa70`, sur le fond `#0d1420` du logo. Deux PNG de 192 px :
  `shortcut-ask-192.png` (`purpose: any`, coins arrondis comme `icon.svg`) et
  `shortcut-ask-maskable-192.png` (`maskable`, fond plein, dessin dans le cercle de sécurité de 40 %),
  la seconde pour le recadrage rond d'Android si Chrome la prend, la première sinon. Sources SVG à
  côté (`shortcut-ask.svg`, `shortcut-ask-maskable.svg`), rasterisées comme le logo (mise à jour du
  2026-10-28 (bis) : fenêtre 512, `--force-device-scale-factor=0.375`, chemins à barres obliques).
  *(Mise à jour 2026-11-03 : Chrome prend l'icône `any`, désormais un disque plein, avec un dessin d'onde et d'étincelle qui laisse le coin bas-droit à la pastille de l'app — voir la section « Mise à jour 2026-11-03 » en fin de page.)*
- **Mise à jour sur le téléphone** : Chrome relit le manifest d'une app installée à son lancement et la
  met à jour, avec un délai qui peut aller jusqu'à un jour ; désinstaller puis réinstaller la prend
  tout de suite.
- **Build** : `public/` est copié tel quel, le manifest construit porte `shortcuts` (vérifié sur un build
  dans un dossier jetable, `vite build --outDir`, pour ne pas remplacer le `dist/` servi). Le build de
  démo retire le manifest (`demoPage()` de `vite.config.ts`) : pas de raccourci sur Pages.

Sources : `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/shortcut-ask*.{svg,png}`.

## Mise à jour 2026-11-01 — le raccourci pointe sur `./ask`

L'adresse du raccourci passe de `./?ask&source=shortcut` à `./ask`, une page à part sans scène 3D
(`../1_architecture/1_9_assistant.md`, mise à jour du 2026-11-01). Rien à faire côté serveur : `/ask`
est servie par le repli SPA comme toute route de l'app. Un téléphone dont Chrome n'a pas encore relu
le manifest ouvre l'ancienne adresse, que le routeur renvoie vers `/ask`.

Sources : `apps/web/public/manifest.webmanifest`, `apps/web/src/router/index.ts`.

## Mise à jour 2026-11-03 — l'icône du raccourci « Demander » redessinée pour le lanceur Android

Constaté sur un téléphone Android (raccourci épinglé sur l'écran d'accueil) : l'icône apparaissait
réduite au centre d'un disque blanc.

- **Chrome prend l'icône `any` des raccourcis, pas la `maskable`.** Les deux sont déclarées dans le
  manifest, mais l'écran montrait le carré à coins arrondis de `shortcut-ask-192.png`. Le lanceur
  (Launcher3) traite une icône non adaptative ainsi : si sa silhouette opaque n'a pas la forme du
  masque, il la réduit et la pose sur un fond blanc.
- **Correctif : l'icône `any` est un disque plein** de 512 (`<circle r="256">`) au lieu d'un carré
  arrondi. Sa silhouette correspond au masque rond, et le lanceur l'affiche telle quelle. La version
  `maskable` reste déclarée, pour le cas où Chrome la prendrait un jour.
  *(Démenti le même jour sur le téléphone : le disque plein reste réduit dans un disque blanc — voir
  « Mise à jour 2026-11-03 (bis) » ci-dessous.)*
- **La pastille de l'app.** Sur un raccourci épinglé, Android ajoute l'icône de l'app dans le coin
  bas-droit, sur environ 44 % du diamètre (`ICON_BADGE_SCALE` de Launcher3). Le dessin est donc
  décalé vers le haut à gauche, et le quart bas-droit ne contient que le fond `#0d1420`. Comme le
  logo est lui aussi sur fond nuit, la pastille se fond dans le disque.
- **Nouveau dessin** : la bulle sable et son micro sont remplacés par cinq barres d'onde arrondies,
  en dégradé du turquoise `#7fd0d7` vers le sable `#e0aa70`, avec une étincelle à quatre branches
  `#f3d4a4` en haut à droite. Dans `shortcut-ask-maskable.svg`, l'étincelle est un peu rentrée
  (centre 360,132 au lieu de 378,124) pour rester dans le cercle de sécurité de 40 %.
- PNG refaits comme d'habitude (fenêtre 512, `--force-device-scale-factor=0.375`). Avant de choisir,
  le rendu a été jugé sur une page jetable qui pose `icon-maskable.svg` en pastille à 44 % dans le
  coin bas-droit, à deux tailles.

Le téléphone ne voit le changement qu'à la prochaine mise à jour de la WebAPK par Chrome (jusqu'à un
jour), ou tout de suite en désinstallant puis réinstallant l'app. Le raccourci épinglé est ensuite à
reposer.

Sources : `apps/web/public/icons/shortcut-ask{,-maskable}.svg`, `apps/web/public/icons/shortcut-ask{,-maskable}-192.png`.

## Mise à jour 2026-11-03 (bis) — le disque blanc ne s'évite pas : l'icône est dessinée pour lui

Vu sur le téléphone après la mise à jour de la WebAPK : le nouveau dessin est arrivé, mais le disque
sombre apparaît toujours réduit (environ 68 % du diamètre) au centre d'un disque blanc. Ce lanceur
enveloppe **toute** icône non adaptative, quelle que soit sa silhouette, et Chrome ne fournit aux
raccourcis que l'icône `any` (le code de Chromium renvoie au ticket crbug 1152661 pour les icônes
maskable des raccourcis, état non vérifié). Le blanc ne se supprime donc pas côté manifest.

- **`shortcut-ask.svg` a un fond transparent** : l'onde est posée directement sur le disque blanc du
  lanceur. Couleurs reprises pour le blanc : dégradé de turquoises foncés `#1b4f58` → `#2c8791`,
  étincelle sable `#e0aa70`. Les turquoises clairs et le sable pâle du dessin sur fond nuit
  manquaient de contraste.
- **Dessin centré et agrandi** : les cinq barres (56 de large, pas de 86) occupent presque toute la
  largeur du carré de 512. Le profil en losange de l'onde laisse vide le coin bas-droit, où tombe la
  pastille de l'app. L'onde est remontée de 20 et les barres de droite raccourcies pour que la
  pastille ne les touche pas à l'échelle observée.
- **`shortcut-ask-maskable.svg` ne change pas** (dessin sur fond nuit, décalé en haut à gauche) :
  Chrome ne l'utilise pas pour les raccourcis.
- Choix fait sur une page jetable qui simule le lanceur : disque blanc, icône à 68 / 60 / 52 % du
  diamètre, `icon-maskable.svg` en pastille à 44 % dans le coin bas-droit. L'icône précédente y
  ressemblait à la capture du téléphone, ce qui valide la simulation.

Non vérifié sur le téléphone au moment de l'écrire (même délai de mise à jour de la WebAPK).

*(Complément 2026-11-03, après la capture du téléphone :)* le rendu est bon, l'onde remplit le
disque blanc et la pastille ne touche aucune barre. Mesuré sur la capture : l'image de l'icône
occupe environ **76 %** du disque blanc (le lanceur agrandit un dessin à fond transparent d'après
son contenu), la pastille environ 46 %, et elle déborde un peu du disque en bas à droite. Ensuite :

- **Étincelle agrandie** (demi-branche 86 au lieu de 72, centre 416,88) et un peu plus pleine
  (points de contrôle décalés de 6 du centre), en dégradé `#f3d4a4` → `#b77a45` : la version sable
  uni paraissait petite et pâle sur le blanc.
- **Onde centrée : écartée.** Sur la simulation recalée à 76 %, la pastille couvre le bas des deux
  barres de droite ; réduite à 88 %, elle les mord encore, et l'onde perd la place gagnée. Le
  décalage de 20 vers le haut à gauche reste.

Sources : `apps/web/public/icons/shortcut-ask.svg`, `apps/web/public/icons/shortcut-ask-192.png`.

## Mise à jour 2026-11-03 (ter) — le manifest en français ou en anglais

Le manifest existe en deux langues : `apps/web/public/manifest.webmanifest` (français, inchangé) et
`apps/web/public/manifest.en.webmanifest` (anglais : description, `lang: "en"`, raccourci « Ask
Kasbah » / « Ask »). Le reste (icônes, adresses, couleurs) est identique dans les deux.

- **Le serveur choisit à l'adresse unique `/manifest.webmanifest`** (route de `registerStatic`,
  `apps/server/src/http/static.ts`) : `manifestFile()` lit `Accept-Language`, le premier de `fr` ou
  `en` dans l'ordre de l'en-tête gagne, l'anglais sinon. C'est la règle de l'app sans choix enregistré
  (`detectLocale`, `apps/web/src/i18n/index.ts`). Réponse avec `Vary: Accept-Language`.
- **L'adresse ne change pas** : une app installée n'est pas perturbée, et la page de connexion
  (`INSTALL_HEAD` de `session.ts`) en profite sans rien toucher.
- **Limite** : une langue choisie dans les Réglages, différente de celle du navigateur, n'est pas
  suivie. Le navigateur demande le manifest sans cookie, le serveur ne connaît donc ni le compte ni
  le réglage. Écarté : un cookie de langue envoyé par `crossorigin="use-credentials"`, plus de
  pièces pour un cas rare.
- **Dev** : Vite sert `public/manifest.webmanifest` tel quel, donc en français ; seul le serveur de
  production choisit. **Démo** : `demoPage()` retire les deux fichiers.
- Même délai qu'ailleurs sur le téléphone : la WebAPK prend le nouveau libellé à sa prochaine
  relecture du manifest.

Vérifié par `apps/server/src/http/static.test.ts` (cinq en-têtes, dont un navigateur allemand qui
accepte le français et une requête sans en-tête).

Sources : `apps/server/src/http/static.ts`, `apps/web/public/manifest{,.en}.webmanifest`, `apps/web/vite.config.ts`.

## Mise à jour 2026-11-08 — l'adresse publique devient la seule porte, HTTPS en local (« étape 0 »)

Le réseau local n'est plus sans compte : voir [1_13](../1_architecture/1_13_comptes-et-sessions.md), section du
2026-11-08. Les mentions ci-dessus de « réseau local de confiance » et de `npm run mcp-user` sont **dépassées**.
Conséquence pour qui déploie : `http://<ip>:8787` ne sert plus l'app (302 vers `MCP_PUBLIC_URL` pour une page,
401 sinon) ; seule la machine elle-même (`localhost`) ouvre Kasbah sans connexion. Sans `MCP_PUBLIC_URL`,
Kasbah avertit au démarrage et seule cette machine y entre. Le pare-feu sur 8787 reste **facultatif** : le HTTP
local ne sert plus que les flux des enceintes (URL à `sid` aléatoire).

**Étape 0 : HTTPS depuis le réseau local, sous le même nom que dehors.** Procédure générique, faite par
l'utilisateur et vérifiée depuis un PC (certificat valide, `/` renvoie à `/login`) :

1. Un DNS local (Pi-hole ou équivalent) répond au nom public (`kasbah.example.org`) par l'adresse du NAS qui
   porte le proxy inverse et son certificat Let's Encrypt.
2. Le proxy transmet à la machine Kasbah (autre machine que le NAS), comme à la procédure plus haut.
3. Contrôle : depuis un poste du réseau, le nom public résout vers l'adresse **locale** du NAS, et
   `https://<nom public>/` renvoie à `/login` avec un certificat valide.

Pièges vus :
- `nslookup` interroge le **premier** DNS de sa liste (ici un DNS IPv6 annoncé par le routeur, même avec l'IPv6
  désactivé sur le poste) et **ment** ; la résolution Windows (`Resolve-DnsName`, celle des navigateurs) était
  la bonne. Juger avec `Resolve-DnsName`.
- Le cache du Pi-hole pouvait rendre l'ancienne adresse publique **en plus** de la locale : redémarrer le
  résolveur.
- **Ne pas** faire relayer le routeur vers le Pi-hole quand le Pi-hole a une redirection conditionnelle vers le
  routeur : boucle. Inutile de toute façon : par l'adresse publique, le NAT loopback ramène au NAS, toujours
  en HTTPS valide.

**À vérifier sur le vrai proxy** : qu'il ajoute bien `X-Forwarded-For`. C'est lui qui dit « client à la
maison » (`LAN_ONLY`) et qui empêche de prendre une requête proxifiée pour la machine elle-même.

**Ordre de mise en service** : (1) créer l'admin par le script (`npm run account -w @kasbah/server -- add
<nom> --admin`) ; (2) marquer le compte de la maison (`… house <nom> on`) ; (3) mettre les écrans fixes (tablette)
sur l'adresse publique ; (4) seulement alors déployer, sans quoi l'écran fixe tombe sur 302 / 401.
