# Installation et scripts

> Dernière mise à jour : 2026-10-13
> Sources : `package.json` (racine et workspaces), `.claude/launch.json`, `apps/web/vite.config.ts`, `apps/server/src/config/env.ts`, `apps/server/src/main.ts`, `README.md`, `scripts/fetch-textures.mjs`, `.claude/launch.json`, `scripts/dev-server.mjs`, `scripts/supervisor.mjs`

## Prérequis

Node ≥ 22 (22.22 utilisé), npm ≥ 10 (11.16 utilisé). Windows 11 / Git Bash sur le poste de développement.

## Installation

```bash
npm install
cp apps/server/.env.example apps/server/.env   # secrets et réglages des fabricants (HUE_*, …)
npm run dev
```

*(Corrigé le 2026-10-13 : ce commentaire disait « ajuster `KASBAH_PLUGINS` », variable supprimée le
2026-09-11. Les plugins actifs se cochent dans Réglages → Plugins et vivent dans `house.json`, voir
« Mise à jour 2026-09-11 » plus bas.)*

Web sur <http://localhost:5173> (Vite, `host: true` → accessible depuis un autre écran via l'IP du
poste), serveur sur <http://localhost:8787>. Sans configuration : plugin `mock` + maison démo.
`npm run dev` lance aussi le **générateur PO Token** (`scripts/dev-pot.mjs`) s'il est buildé sous
`_external/bgutil-ytdlp-pot-provider/server` (gitignored) ; skip si déjà sur le port 4416.

`esbuild` a un script d'installation : si npm le bloque (`allow-scripts`), exécuter
`npm approve-scripts esbuild` puis `npm rebuild esbuild`.

## Scripts

Voir `1_architecture/1_0_monorepo-et-flux.md` (dev, test, typecheck, lint, build, start).
Vitest 5 : un seul `vitest.config.ts` racine avec `test.projects` ; chaque workspace garde sa config
(environnement `node` ou `happy-dom`, alias `@`).

## Versions épinglées et raisons

| Paquet | Version | Raison |
|---|---|---|
| typescript | `~5.9` | TypeScript 7 (compilateur natif) n'est pas garanti compatible avec `vue-tsc` |
| vuetify | `^4` | thème `system` natif ; voir pièges dans `6_faq/6_0_pieges-outillage.md` |
| vite | `^8` (Rolldown) | découpage en chunks via `output.codeSplitting` |
| zod | `^4` | `z.iso.datetime()`, `z.looseObject()`, `z.record(k, v)` à deux arguments |
| three | `^0.185` | imports `three/addons/*` (OrbitControls, CSS2DRenderer, BufferGeometryUtils) |

## Aperçu dans Claude Code

`.claude/launch.json` déclare la configuration `kasbah` (`npm run dev`, port 5173) pour le volet
navigateur intégré.

*(Dépassé le 2026-09-09 : la configuration `kasbah` n'est plus sur le port 5173 mais décalée de +1000, web 6173 et serveur 9787 — voir « Mise à jour 2026-09-09 — la preview lance sa PROPRE pile ».)*

## GitNexus

Index de code dans `.gitnexus/` (ignoré par git). Mettre à jour après des commits importants :
`npx gitnexus analyze` ; vérifier avec `npx gitnexus status`. Redémarrer Claude Code si l'index
paraît périmé côté MCP.

### Mise à jour 2026-09-08 — faire tourner un SECOND front sans casser le premier

`vite.config.ts` fixait `port: 5173` avec `strictPort: true` : un second serveur de développement
(preview d'un agent, deuxième session de travail) échouait au lieu de se poser ailleurs, et aucune
option de lancement n'y pouvait rien.

- `PORT` prend maintenant le dessus sur 5173, et `strictPort` ne vaut **que** pour le port par
  défaut : sur un port imposé, glisser d'un cran vaut mieux qu'échouer. `npm run dev` est inchangé.
- `KASBAH_SERVER` surcharge la cible du proxy (`/api`, `/ws`), qui pointait en dur sur
  `http://localhost:8787`.
- `.claude/launch.json` gagne une configuration **`kasbah-web`** : le front SEUL, avec `autoPort`.
  `npm run dev` démarre aussi le serveur Fastify sur 8787 — inutilisable quand une autre session le
  tient déjà. Le front seul proxyfie vers le 8787 existant.

Attention en s'y branchant : ce front parle alors au serveur qui détient la **vraie** maison, et ce
serveur écrit `house.json` (placement, ordre des pièces). S'en tenir à la lecture, ou utiliser
`VITE_INPROCESS_MOCK=1` qui n'a besoin d'aucun serveur (voir `../3_plugins/3_0_simulation-mock.md`).


### Mise à jour 2026-09-09 — la preview lance sa PROPRE pile, l'IDE garde la sienne

La section « Aperçu dans Claude Code » ci-dessus décrivait la configuration `kasbah` comme
`npm run dev` sur le port 5173 : c'était exactement la pile de l'IDE, donc une collision sur les
**deux** ports (web 5173, serveur 8787) dès que les deux tournaient. Depuis le 2026-09-09,
`.claude/launch.json` décale toute la pile de la preview de +1000 :

| Variable | Valeur preview | Lue par |
|---|---|---|
| `PORT` | `6173` | `apps/web/vite.config.ts` (port de Vite) |
| `KASBAH_PORT` | `9787` | `apps/server/src/config/env.ts` (port de Fastify) |
| `KASBAH_SERVER` | `http://localhost:9787` | `apps/web/vite.config.ts` (cible du proxy `/api`, `/ws`) |

`"port": 6173` et `autoPort: false` dans la configuration de lancement : le volet doit trouver le
front à une adresse fixe. `npm run dev` sans ces variables est inchangé (5173 / 8787).

*(Constat du lint du 2026-10-06 : `.claude/launch.json` porte aujourd'hui `autoPort: true` pour `kasbah` — une seconde session prend le port libre suivant au lieu d'échouer quand 6173 est tenu ; le proxy `/api` suit `KASBAH_SERVER`, inchangé. Le commentaire du fichier l'explique.)*

Ces variables **gagnent sur `apps/server/.env`** : ni `dotenv` (`apps/server/src/main.ts`) ni
`node --env-file-if-exists` (script `dev` du serveur) n'écrasent une valeur déjà présente dans
`process.env` — vérifié avant d'écrire la configuration.

Modèle repris d'un dépôt modèle interne, qui décale son Vite de `DEV_PORT + 1000` via
`CLAUDE_PREVIEW=1`. Différence : là-bas seul le front est à décaler (le back est partagé et
proxyfié), ici la pile compte deux processus.

**Ce qui n'est PAS dédoublé** (choix explicite : « ports seulement ») — les deux serveurs partagent
le fichier de maison (celui de `KASBAH_HOUSE_FILE`), les réglages de plugins
(`apps/server/.state/plugin-settings.json`) et, depuis le 2026-09-10, la mémoire des appareils Cast
déjà vus (`apps/server/.state/google-cast-devices.json`, `CAST_KNOWN_FILE` —
`../3_plugins/3_6_google-cast.md` ; son fichier temporaire porte le pid, justement pour que deux
serveurs ne se marchent pas dessus). Les deux premiers sont écrits en `.tmp` puis `rename`
(`apps/server/src/config/house.ts`, `apps/server/src/core/plugin-settings.ts`) : deux écritures
simultanées se marchent dessus, y compris sur le fichier temporaire. Ils démarrent aussi les mêmes
plugins réels (`KASBAH_PLUGINS` de `.env`) et pilotent donc le **même matériel**. Côté preview :
s'en tenir à la lecture, ou `VITE_INPROCESS_MOCK=1` qui n'a besoin d'aucun serveur (voir
`../3_plugins/3_0_simulation-mock.md`).

*(Dépassé le 2026-09-11 : `apps/server/.state/plugin-settings.json`, `core/plugin-settings.ts` et `KASBAH_PLUGINS` n'existent plus, les plugins actifs vivent dans `house.json` — voir « Mise à jour 2026-09-11 » plus bas.)*

`strictPort` suit désormais la même logique (`FIXED_PORT` dans `apps/web/vite.config.ts`), ce qui
**restreint la règle posée le 2026-09-08** : glisser d'un cran reste le comportement sur un `PORT`
imposé seul, mais dès que `KASBAH_SERVER` est aussi fourni — la signature d'une pile complète à des
adresses fixes — Vite échoue au lieu de glisser. Un volet figé sur 6173 n'afficherait rien si le
front s'était posé sur 6174 : `Port 6173 is already in use` se voit, un glissement silencieux non.
Les trois cas, tous exercés :

| Environnement | Port | `strictPort` |
|---|---|---|
| rien (`npm run dev`) | 5173 | oui — inchangé |
| `PORT` seul (`kasbah-web`, `autoPort`) | imposé | non — glisse d'un cran |
| `PORT` + `KASBAH_SERVER` (preview) | imposé | oui — échoue, port annoncé dans les logs |

La configuration `kasbah-web` (front seul, `autoPort`) reste disponible pour se brancher sur un
serveur déjà démarré, avec le même avertissement qu'au 2026-09-08.

### Mise à jour 2026-09-09 — ffmpeg et le proxy WebSocket de Vite

La vidéo des caméras demande **ffmpeg** sur la machine du serveur (`FFMPEG_PATH`, cf.
`5_1_configuration-env.md`) ; la machine de développement en a un (6.0, gyan.dev). Les écrans
n'ont rien à installer. Le proxy Vite de `/api` passe en `ws: true` : les flux vidéo sont des
WebSockets sous `/api/plugins/<id>/cameras/…`, et sans ce drapeau le proxy ne les fait pas monter.

### Mise à jour 2026-09-11 — ce que les deux serveurs de développement partagent

La liste des fichiers partagés par le serveur de l'IDE (8787) et celui de la preview (9787) change :
`apps/server/.state/plugin-settings.json` n'existe plus, et **`house.json` porte désormais les
plugins actifs et leurs sous-items** (`../2_maison/2_0_format-house-json.md`). Cocher un plugin dans
Réglages côté preview écrit donc la maison des **deux** serveurs — et pilote le même matériel réel.
S'en tenir à la lecture côté preview, ou `VITE_INPROCESS_MOCK=1` qui n'a besoin d'aucun serveur.
Le commentaire de `.claude/launch.json` a été mis à jour dans le même sens.


### Mise à jour 2026-09-13 — configuration de lancement `kasbah-mock`

`.claude/launch.json` gagne **`kasbah-mock`** : le front seul (`npm run dev -w @kasbah/web`) sur le
port 6175 avec `VITE_INPROCESS_MOCK=1`. Aucun serveur, aucun matériel, **aucune écriture dans la
maison** : la simulation in-process sert le parc de démo complet (depuis le 2026-10-08 : la propriété
démo retenue par le navigateur, `house/demos/`, véhicules compris). C'est la façon de vérifier une vue sur des appareils que la maison réelle a décochés (les
sous-items du mock y sont presque tous à `false`) sans cocher quoi que ce soit dans Réglages — ce qui
écrirait `house/maison.json`, partagé avec le serveur de l'IDE. Née en vérifiant la vue Véhicules du
plugin Tesla (`../3_plugins/3_8_tesla.md`).


### Mise à jour 2026-09-14 — `maplibre-gl` hors du pré-empaquetage de Vite

`apps/web/vite.config.ts` : `optimizeDeps.exclude: ['maplibre-gl']`. Sans quoi, en développement,
le worker de MapLibre ne démarre pas et les tuiles vectorielles ne s'affichent pas (détail dans
`../6_faq/6_0_pieges-outillage.md`). Dépendance ajoutée : `maplibre-gl` 6.9 (environ 800 Ko, chargé
avec la vue Véhicules seulement). Les tuiles viennent d'Internet (OpenFreeMap, IGN) : hors ligne, la
carte reste grise.

### Mise à jour 2026-09-15 — `scripts/fetch-textures.mjs`, les matières photo du rendu 3D

Le pack de matières en images du rendu 3D (`apps/web/public/assets/textures/photo/`, voir
`../1_architecture/1_5_scene-3d.md`) n'est pas écrit à la main : `node scripts/fetch-textures.mjs`
télécharge chaque jeu **CC0** depuis ambientCG (`https://ambientcg.com/get?file=<Id>_1K-JPG.zip`,
sans compte), lit l'archive **sans dépendance** (répertoire central du zip + `zlib.inflateRawSync`
de Node), n'en garde que trois cartes (Color, NormalGL, Roughness) et les réduit à **512 px** avec
`ffmpeg -vf scale=512:512 -q:v 4` — ffmpeg est déjà requis par le serveur pour le relais vidéo.
Un jeu 1K d'origine pèse 5 Mo ; l'app en garde ~150 Ko par matière (1,5 Mo le pack).

Options : `--size N` (défaut 512), `--force` (refaire une matière déjà présente). Le tableau
`ROLES` du script (rôle → identifiant ambientCG) est la seule chose à changer pour remplacer une
matière ; il écrit aussi `SOURCES.md` (provenance et licence) à côté des fichiers. Les fichiers
produits sont **versionnés** : l'app tourne en LAN sans CDN, et le script ne sert qu'à les refaire.

### Mise à jour 2026-10-03 — les finitions dans `fetch-textures.mjs`

Le script rapatrie aussi les 28 matières du catalogue de finitions qui ne sont pas déjà un rôle du
pack (`FINISH_ASSETS`), sous `apps/web/public/assets/textures/finishes/<asset>/`, et écrit pour
chaque matière une vignette `thumb.jpg` (128 px) en plus des trois cartes. La liste est à tenir avec
`FINISHES` (`packages/shared/src/house/finishes.ts`) ; `finishes.test.ts` vérifie que chaque dossier
du catalogue a ses quatre images. Poids versionné : 3,6 Mo pour les 28. Choix fait sur une planche
de candidates (41 matières dont les 10 du pack) que l'utilisateur a validée en bloc, à revoir une
fois vues en place ; gazons et gravier de la planche gardés hors du dépôt pour l'édition du terrain.

Sources : `scripts/fetch-textures.mjs`, `apps/web/public/assets/textures/photo/SOURCES.md`.

### Mise à jour 2026-10-03 (bis) — `house/fit-survey.mjs` devient l'enveloppe du code partagé

Le calcul des polygones depuis le relevé vit dans `packages/shared/src/house/survey.ts`
(`fitSurvey`), celui que le serveur rejoue à chaque écriture des cotes depuis l'interface. Le script
le charge par `tsx/esm/api` (`register()` puis import du `.ts`) : l'usage ne change pas (`node
house/fit-survey.mjs [fichier] [--check]`), ni sa sortie (vérifiée identique sur `maison.json`).

Sources : `house/fit-survey.mjs`, `packages/shared/src/house/survey.ts`.

### Mise à jour 2026-10-04 — un nom DNS local pour le front de dev (`server.allowedHosts`)

Le poste de dev peut être joignable sur le LAN sous un nom local tel que `kasbah.home.internal` :
zone `home.internal` sur le DNS du routeur, enregistrement A `kasbah` vers l'IP du poste, et
`home.internal` comme nom de domaine du serveur DHCP pour que le nom court `kasbah` se résolve aussi.
Suffixe `.internal` (réservé aux réseaux privés par l'ICANN en 2024) plutôt que `.local`, pris par mDNS.

Vite refusait ce nom : `Blocked request. This host ("kasbah.home.internal") is not allowed.` Le
serveur de développement n'accepte par défaut que `localhost` et les adresses IP (protection contre
le *DNS rebinding*), `host: true` ne change rien à ce contrôle. `vite.config.ts` déclare donc
`server.allowedHosts: ['kasbah.home.internal', 'kasbah']` ; un autre nom (ou un autre poste)
demande de l'y ajouter, et un redémarrage de `npm run dev`. Le serveur Fastify de production ne
fait pas ce contrôle : `http://kasbah.home.internal:8787` marche sans réglage.

Sources : `apps/web/vite.config.ts`.

### Mise à jour 2026-10-04 (bis) — installer une machine neuve (Windows)

Procédure suivie et vérifiée en passant le projet sur un nouveau poste, qui sert à la
fois au développement et au serveur de la maison. Elle **complète** la section « Installation » plus
haut, dont le commentaire « ajuster `KASBAH_PLUGINS` » est périmé depuis le 2026-09-11 : les
plugins actifs se cochent dans Réglages et vivent dans `house.json` (voir la mise à jour du
2026-09-11 ci-dessus).

**Outils** (les écrans n'installent rien) :

| Outil | Requis pour | Installation |
|---|---|---|
| Node ≥ 22, npm, git | tout ; Node aussi pour yt-dlp (`--js-runtimes node`) | `winget install OpenJS.NodeJS.LTS`, `winget install Git.Git` |
| ffmpeg | relais RTSP des caméras, transcodage musical (`music/player.ts`, `music/proxy.ts`), `fetch-textures.mjs` | `winget install Gyan.FFmpeg` (9.0.2 sur ce poste ; l'ancien avait une 6.0) |
| yt-dlp | YouTube Music, Mixcloud | `_external/yt-dlp.exe`, référencé par `YTM_YTDLP_PATH` / `MIXCLOUD_YTDLP_PATH` |
| générateur PO Token | YouTube Music | `_external/bgutil-ytdlp-pot-provider/server` (Option B de `../3_plugins/3_16_ytmusic.md`) |
| plugin yt-dlp `bgutil` | YouTube Music | voir ci-dessous |

`winget` installe ffmpeg **pour l'utilisateur** (`%LOCALAPPDATA%\Microsoft\WinGet\Packages\…`) et
complète son `PATH` : rouvrir le terminal, et relancer le serveur, avant qu'il le trouve. Un futur
service Windows (compte système) ne verrait pas ce `PATH` : il lui faudra `FFMPEG_PATH` absolu.

**Le plugin yt-dlp `bgutil` est un maillon à part, et le plus facile à oublier.** Le générateur
PO Token (port 4416) ne sert à rien si yt-dlp ne charge pas son plugin client : sur ce poste,
`yt-dlp -v` affichait `Plugin directories: none` et `PO Token Providers: none` alors que
`/ping` répondait. `apps/server/src/plugins/ytmusic/resolve.ts` passe bien
`--extractor-args youtubepot-bgutilhttp:base_url=…`, mais sans plugin chargé l'argument est ignoré
sans erreur. Avec `yt-dlp.exe` autonome (pas de `pip`), poser le plugin **à côté de l'exécutable** :

```text
_external/yt-dlp-plugins/bgutil-ytdlp-pot-provider/yt_dlp_plugins/   ← copie de
_external/bgutil-ytdlp-pot-provider/plugin/yt_dlp_plugins/
```

yt-dlp cherche `<dossier de l'exe>/yt-dlp-plugins/<paquet>/yt_dlp_plugins/` ; `--ignore-config`
(passé par le serveur) ne désactive pas les plugins. Vérifier :
`_external/yt-dlp.exe -v --simulate <url youtube>` doit lister
`PO Token Providers: bgutil:http-2.0.0`. Installé et vérifié ainsi sur ce poste le 2026-10-04.
`%APPDATA%\yt-dlp\plugins\<paquet>\` marche aussi, mais
sort du dépôt.

**Reprendre une maison existante** : git ne porte ni `apps/server/.env`, ni `apps/server/.state/`
(jetons et sessions des fabricants : sans eux, refaire chaque mise en route), ni
`house/maison.json`, `house/maison.automations.json`, `house/history/`, ni `_external/`. Les
recopier depuis l'ancienne machine, puis ajuster dans `.env` ce qui porte l'IP du poste
(`MUSIC_PUBLISH_BASE`, `YTM_PUBLISH_BASE`, commit dc9c9ee).

*(Constat du lint du 2026-10-06 : liste à compléter de `apps/server/mcp-users.json`, les comptes des assistants IA (serveur MCP), hors dépôt comme `.env` — à recopier aussi, ou à recréer par `npm run mcp-user` (voir `../1_architecture/1_7_serveur-mcp.md`). Et ne citer que `MUSIC_PUBLISH_BASE` : `YTM_PUBLISH_BASE` est l'ancien nom, encore lu par `apps/server/src/music/player.ts` en repli.)*

**Lancer** :

| Commande | Usage |
|---|---|
| `npm run dev` | développement ; serveur relancé à chaque modification (`node --watch`) |
| `npm run house` | maison réelle au quotidien : serveur sans relance automatique, front Vite |
| `npm run dev:pot` | le générateur PO Token seul (`scripts/dev-pot.mjs`), déjà lancé par `npm run dev` |
| `npm run mcp-user -w @kasbah/server -- add <nom>`, `… remove <nom>`, `… list` | comptes du serveur MCP (`mcp-users.json`), en secours de Réglages : `add` demande le mot de passe, `remove` coupe aussi les jetons (`apps/server/src/mcp/users-cli.ts`) |
| `npm run build && npm start` | production de base : app + API sur `KASBAH_PORT` (8787), sans Vite (`5_2_production.md`) |
| `node scripts/supervisor.mjs` | production supervisée : build si absent, serveur relancé s'il tombe, mise à jour depuis Réglages ; lancé au démarrage de la machine (`5_2_production.md`, mise à jour 2026-10-13 (bis)) |

*(Depuis le 2026-10-10, le serveur de `npm run dev` n'est plus relancé par `node --watch` mais par
`scripts/dev-server.mjs`, qui ignore les simples lectures et regroupe les rafales d'écritures — voir
`../6_faq/6_0_pieges-outillage.md`, section du 2026-10-10.)*

Les trois lisent le même `apps/server/.env`, donc la même maison (`KASBAH_HOUSE_FILE`). Au premier
lancement, Windows demande d'autoriser Node dans le pare-feu : accepter pour les réseaux **privés**,
sinon les écrans du LAN n'atteignent ni 5173 ni 8787.

Sources : `README.md` (section Démarrage), `package.json`, `apps/server/package.json`,
`apps/server/src/plugins/ytmusic/resolve.ts`, `scripts/dev-pot.mjs`.

### Mise à jour 2026-10-05 — `kasbah.home.internal` introuvable sur Android : un DNS IPv6 annoncé par la box

**Symptôme.** Sur un téléphone Android du LAN, `http://kasbah:5173` (et par moments
`kasbah.home.internal`) rendait `DNS_PROBE_FINISHED_NXDOMAIN`, alors que l'IP du poste
marchait et que le PC résolvait le nom. Le serveur Kasbah n'y était pour rien : l'échec est DNS, et
une relance du serveur qui semblait « réparer » n'était qu'une coïncidence (cache négatif expiré).

**Cause.** Le téléphone avait DEUX DNS : un DNS IPv6 en premier, puis celui du routeur.
Le premier est celui que la **box** de l'opérateur annonce en IPv6 ; il ne connaît pas `home.internal` et
répond NXDOMAIN, réponse valide qu'Android ne retente pas auprès du routeur. La box atteignait le
LAN parce que le routeur relayait les annonces IPv6 de la box telles quelles, alors même que l'IPv6 du
réseau local était décoché. Android, de plus, n'applique pas le suffixe DHCP : le nom court
`kasbah` seul n'y est pas fiable, utiliser `kasbah.home.internal`.

**Correction.** Désactiver l'IPv6 sur le routeur, plutôt que de déléguer un préfixe avec le routeur comme
DNS annoncé : rien à la maison n'a besoin d'IPv6, ni Kasbah ni les appareils. Après reconnexion du
Wi-Fi, le téléphone n'a plus que le DNS du routeur et le nom marche. Garder le routeur en mode
routeur : en mode point d'accès, la box ferait DHCP et DNS et la zone `home.internal` du routeur ne
servirait plus. Sur Windows, les anciens DNS IPv6 restent listés jusqu'au bail suivant
(`ipconfig /renew6` ou rebrancher le câble) ; le nom se résout quand même. Ne pas rétablir le relais :
pour l'IPv6 un jour, préfixe délégué + DNS du routeur annoncé.

Sources : réglages du routeur et d'Android, `Resolve-DnsName` sur le poste.

### Mise à jour 2026-10-08 — la démonstration : deux configs de preview

Sans `KASBAH_HOUSE_FILE`, le serveur est une démonstration à trois propriétés
(`../1_architecture/1_2_serveur-et-plugins.md`). `.claude/launch.json` gagne deux configs :

- **`kasbah-demo-server`** : `npm run dev -w @kasbah/server`, port **9789**, `KASBAH_HOUSE_FILE` **vide**
  (une valeur vide gagne sur `apps/server/.env`, car ni dotenv ni `node --env-file` n'écrasent
  `process.env`) et `KASBAH_STATE_DIR=.state/demo` (la propriété retenue et les historiques n'écrasent
  pas ceux du vrai serveur ; chemin relatif à `apps/server`).
- **`kasbah-demo`** : le front de ce serveur (`npm run dev -w @kasbah/web`, port **6177**,
  `KASBAH_SERVER=http://localhost:9789`). Lancer le serveur d'abord.

Pourquoi deux configs `npm run dev -w` et pas `npx` : un `npx` dans `runtimeExecutable` échoue sous
Windows (« 'C:\Program' n'est pas reconnu », le chemin avec espace est coupé).

Attention : ces configs ne protègent pas la maison — une édition depuis l'UI réécrit
`house/demos/<id>.json`, fichier versionné. `kasbah-mock` (in-process) n'écrit rien et propose lui aussi
les trois propriétés ; le « parc de démo complet » cité plus haut s'entend désormais de la propriété
retenue par le navigateur, `house/demo-house.json` étant la maison des tests.

Sources : `.claude/launch.json`, `apps/server/.env.example`.

### Mise à jour 2026-10-09 — le garde-fou des données personnelles (`npm run hooks`)

Le dépôt est public. `scripts/check-private.mjs` refuse un commit, ou un message de commit, qui ajoute
une valeur de `.private-denylist` : fichier **non versionné** à la racine, une valeur par ligne
(littérale, ou `re:` suivi d'une expression régulière, `#` pour commenter), qui n'existe que chez le
propriétaire. Sans ce fichier, rien n'est bloqué.

- `npm run hooks` (une fois par clone) : `git config core.hooksPath .githooks`, qui branche
  `.githooks/pre-commit` (lignes ajoutées) et `.githooks/commit-msg` (message).
- `npm run check:private` : tout l'arbre suivi, à la demande.
- La sortie nomme le fichier et la ligne, jamais la valeur. Un refus se corrige en retirant la valeur,
  jamais par `--no-verify`.

### Mise à jour 2026-10-10 — la démonstration n'est plus « sans KASBAH_HOUSE_FILE »

La mise à jour du 2026-10-08 ci-dessus décrit un serveur sans `KASBAH_HOUSE_FILE` comme « une
démonstration à trois propriétés ». Depuis le 2026-10-10, c'est le catalogue de propriétés et son
interrupteur Démo | Réel (`5_1_configuration-env.md`, `../1_architecture/1_2_serveur-et-plugins.md`).
Les configs `kasbah-demo-server` et `kasbah-demo` restent valides : la variable vide et
`KASBAH_STATE_DIR=.state/demo` leur donnent leur propre `property-mode.json`.

Sources : `apps/server/src/main.ts`, `.claude/launch.json`.
