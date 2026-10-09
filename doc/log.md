# Journal du wiki

Entrées les plus récentes en haut. Une session = une entrée.

## [2026-10-09] update | Dépôt public : wiki sans données personnelles, garde-fou

**Déclencheur** : ouverture publique du dépôt. Le wiki entre dans le nouveau dépôt en une seule version,
nettoyée de ce qui identifiait l'auteur, sa famille ou sa maison (son historique n'est pas repris).

**Pages modifiées** :
- Toutes les pages qui en portaient : prénoms, surnoms d'appareils, IP, domaine, commune, plan et
  équipement de la vraie maison, mesures réelles datées, véhicules, école, goûts, réseau personnel.
- `SCHEMA.md` - règle « Aucune donnée personnelle ».
- `5_setup/5_0_installation-et-scripts.md` - section datée : `scripts/check-private.mjs`, `npm run hooks`.

**Pages créées** : aucune.

**Index** : résumés alignés sur les pages nettoyées.

## [2026-10-09] update | Open-Meteo : routes appelées plugin non démarré, 409 au lieu de 500

**Déclencheur** : `GET /api/plugins/open_meteo/places?q=Pornic` → 500 « Cannot read properties of null »
sur le vrai serveur, message que `get_weather` (MCP) rendait à l'agent ; limite notée le même jour par la
session MCP (448fb90).

**Pages modifiées** :
- `3_plugins/3_10_open-meteo.md` - section datée : 409 `DEVICE_UNAVAILABLE` « open_meteo plugin is not started » sur `/places`, `/at`, `/alerts`, convention suivie (comap, `/raw`), test ; l'ancienne limite annotée « levée ».
- `1_architecture/1_7_serveur-mcp.md` - le « défaut relevé, non corrigé » annoté « corrigé ».

**Pages créées** : aucune.

**Index** : mis à jour (1 ligne).

## [2026-10-09] update | Serveur MCP : neuf outils de plus (météo, agenda, automatisations, file musicale, historiques)

**Déclencheur** : demande « a-t-on la météo dans le MCP ? sinon l'implémenter, puis faire le tour de ce qu'il
manque ». Arbre de travail non commité (après 00397bc) : `apps/server/src/mcp/{server,server.test}.ts`,
`README.md`, `docs/plugins/{agenda,open_meteo}.md`.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - tableau des outils (10 → 19), section datée : pourquoi (la météo n'était que partielle), retenu / écarté, un tableau outil → routes → particularités, décisions (heures en clair, pas d'écriture de règle), vérifications, non joué ; limite next/previous du 2026-09-23 annotée « levée ».
- `1_architecture/1_6_lecteur-musique.md` - section datée : `get_music`, `queue_music`, `control_music`.
- `1_architecture/1_8_automatisations.md` - section datée : les trois outils, `run_automation` sans « Sauf si », ni création ni suppression par MCP.
- `3_plugins/3_10_open-meteo.md` - section datée : `get_weather` ; limite connue (routes `/places`, `/at`, `/alerts` en 500 plugin monté mais pas démarré).
- `3_plugins/3_22_agenda.md` - section datée : `get_agenda`, fin d'une journée entière incluse.

**Pages créées** : aucune.

Rien non plus n'a été joué sur la suite complète ni sur le vrai serveur.

**Index** : mis à jour (5 lignes).

## [2026-10-08] update | Page utilisateur du plugin Claude, et deux pièges d'outillage

**Déclencheur** : demande « fais la page et la ligne pour claude aussi », après la page du plugin
transcription.

**Pages modifiées** :
- `3_plugins/3_24_claude.md` - source : la page utilisateur `docs/plugins/claude-assistant.md`.
- `6_faq/6_0_pieges-outillage.md` - deux entrées : `docs/plugins/claude.md` lu comme un `CLAUDE.md` (Windows ignore la casse), `\r` isolé changé en saut de ligne par Python en mode texte.

**Pages créées** : aucune dans le wiki. Hors wiki : `docs/plugins/claude-assistant.md` et sa ligne dans le tableau des plugins du `README.md`.

**Index** : mis à jour (2 lignes).

## [2026-10-08] update | Voix des réponses parlées par compte connecté

**Déclencheur** : demande « chaque utilisateur connecté peut surcharger le choix de voix de la fiche du
plugin transcription ». La voix retenue valait pour toute la maison.

**Pages modifiées** :
- `3_plugins/3_25_transcription.md` - section datée : voix de la maison + voix du compte (fichier d'état du compte), ordre compte → maison → `TTS_VOICE`, forme de `/settings`, carte selon connecté ou réseau local, tests.

**Pages créées** : aucune dans le wiki. Hors wiki : `docs/plugins/transcription.md` (page utilisateur du plugin, qui manquait) et sa ligne dans le tableau des plugins du `README.md`.

**Index** : mis à jour (1 ligne).

## [2026-10-08] update | Badge de santé des comptes de l'utilisateur connecté

**Déclencheur** : demande « affiche le badge de santé du compte de l'utilisateur connecté », suite des
comptes musicaux par utilisateur (2026-10-07). Le badge de Réglages → Plugins restait celui de la maison.

**Pages modifiées** :
- `1_architecture/1_2_serveur-et-plugins.md` - `healthFor` facultatif, `health(user)` / `inventory(user)` asynchrones, repli, appelants ; renvoi daté sur `health()`.
- `1_architecture/1_3_protocole-rest-ws.md` - `/api/health`, `/api/plugins`, `PATCH /api/plugins/:id` pour le compte qui demande.
- `1_architecture/1_7_serveur-mcp.md` - `get_health` aux comptes du jeton (le tableau des outils dit encore `host.health()`, précisé par la section).
- `3_plugins/3_16_ytmusic.md` - badges d'un utilisateur (anonyme `ok`, cookie expiré `needs_pairing`), rechargement de l'inventaire par la carte.
- `3_plugins/3_20_mixcloud.md` - badges d'un utilisateur, rechargement de l'inventaire par la carte.

**Décision de séance** : l'anonyme est `ok` (il fonctionne), signalée à l'utilisateur comme modifiable.

**Index** : updated (5 lignes).

## [2026-10-08] update | Trois propriétés de démonstration et bascule de propriété

**Déclencheur** : demande du 2026-10-07 — une maison de démo montrant toutes les fonctions, sans les prénoms ni la forme de la maison réelle, en vue d'ouvrir le dépôt en public ; puis trois propriétés (toit en pente, toit plat, appartement), un sélecteur en mode démo, un simulateur étendu. Décision : « démo d'abord, vrai multi ensuite ». Session `2026-10-07-demos-multi-proprietes`, code non commité au moment de l'écriture.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - les trois démos, `meta.demo`, fixture des tests anonymisée, deux contraintes (finitions photo, `roof-window`), piège d'édition du fichier versionné.
- `3_plugins/3_0_simulation-mock.md` - parcs de démo, caméra/sonnette, effets, ambiances, voitures garées, 503 au lieu de 501.
- `1_architecture/1_2_serveur-et-plugins.md` - mode démonstration et bascule dans `main.ts`.
- `1_architecture/1_3_protocole-rest-ws.md` - routes `/api/properties`, `propertyId` au snapshot.
- `4_ui/4_1_navigation-et-panneaux.md` - menu des propriétés sur le pavé du rail, carte Réglages.
- `5_setup/5_0_installation-et-scripts.md`, `5_setup/5_1_configuration-env.md` - configs de preview, `KASBAH_HOUSE_FILE` absent.
- `6_faq/6_1_pieges-runtime.md` - entrée « preview figée par les finitions photo ».

**Contradictions relevées (non tranchées)** :
- `5_1` (tableau) et `5_0` (« le fichier de maison `house/demo-house.json` », « parc de démo complet ») décrivent `house/demo-house.json` comme maison par défaut du serveur : plus vrai pour `main.ts` (sans la variable = démonstration), encore vrai pour `loadEnv()` / les tests. Texte d'origine conservé, précisé par des sections datées.
- `3_0` (« la maison de démo existe en deux exemplaires ») ne vaut plus que pour la maison des tests.
- `4_1` (« Piège de la démo », origine sur une rue de Dijon) décrit `demo-house.json` ; les Tilleuls en ont repris l'origine, non revérifié.

**Trous** : seuil exact et coût par finition photo non mesurés ; `1_4_app-web.md` et `1_5_scene-3d.md` non complétées (store des propriétés, perf des matières) ; le vrai multi-sites n'est pas conçu.

**Index** : updated (8 lignes).

## [2026-10-07] update | VoiceStudio sans son interface, lancé avec Kasbah

**Déclencheur** : l'utilisateur ne veut plus ouvrir l'app VoiceStudio pour la voix ; vérifié que son
moteur tourne seul, puis interrupteur du plugin transcription qui le lance et l'arrête avec Kasbah.

**Pages modifiées** :
- `3_plugins/3_25_transcription.md` - mise à jour : port 3900 vérifié, section « Sans son interface », mesures ; question « Non vérifié » close.
- `5_setup/5_1_configuration-env.md` - mise à jour : `VOICESTUDIO_DIR`.

**Index** : mis à jour (1 ligne complétée).

## [2026-10-07] update | Modèle du plugin Claude réglable (`CLAUDE_MODEL`)

**Déclencheur** : sortie de Haiku 5.5 ; l'utilisateur veut changer de modèle sans toucher au code.
Relevé : l'alias `haiku` de la CLI 2.1.288 lançait encore Haiku 4.5.

**Pages modifiées** :
- `3_plugins/3_24_claude.md` - mise à jour : `CLAUDE_MODEL`, santé, piège de l'alias.
- `5_setup/5_1_configuration-env.md` - mise à jour : `CLAUDE_MODEL`.

**Index** : mis à jour (1 ligne complétée).

## [2026-10-07] update | Voix des réponses choisie dans la fiche du plugin transcription

**Déclencheur** : l'utilisateur a créé une voix « ma-voix » dans VoiceStudio et veut la choisir depuis la
fiche du plugin.

**Pages modifiées** :
- `3_plugins/3_25_transcription.md` - mise à jour : routes `/voices` et `/settings`, carte du plugin, mesures.

**Index** : mis à jour (1 ligne complétée).

## [2026-10-07] update | Réponses parlées de l'assistant

**Déclencheur** : demande de l'utilisateur (arbre de travail après 7c3614a) : dire la réponse à voix
haute avec le modèle par défaut de VoiceStudio en « fast », interrupteur dans le plugin, lecture sur
l'appareil d'où vient la demande.

**Pages modifiées** :
- `3_plugins/3_25_transcription.md` - mise à jour : sous-item `speech`, route `/speak`, lecture dans le navigateur, mesures, MOSS-TTS-Nano écarté, contradiction de mesures notée.
- `5_setup/5_1_configuration-env.md` - mise à jour : `TTS_*`.

**Index** : mis à jour (2 lignes complétées).

## [2026-10-07] update | La voix de l'assistant : plugin transcription, trois fournisseurs

**Déclencheur** : étape 2 de l'assistant (arbre de travail après 0a381a3). Décisions de l'utilisateur :
pas de modèle sur le portable de dev (VRAM insuffisante : le Voxtral complet en demande 16 Go), le GPU du serveur
pas forcément pris par la voix — donc prévoir trois cas (VoiceStudio, vLLM + Voxtral, API Mistral) ;
appuyer pour parler, appuyer pour finir, envoi direct ; micro sur le réseau local par drapeau Chrome
(documenté) et par l'adresse publique.

**Pages créées** :
- `3_plugins/3_25_transcription.md` - fournisseurs, audio, mise en route, drapeau Chrome, app, tests.

**Pages modifiées** :
- `1_architecture/1_9_assistant.md` - mise à jour : l'étape 2.
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour : le micro, la place partagée avec la croix.
- `5_setup/5_1_configuration-env.md` - mise à jour : `STT_*`.

**Index** : mis à jour (1 ligne ajoutée, 3 complétées).

## [2026-10-07] update | Assistant dans l'app : « Demander à Kasbah », moteur Claude en plugin

**Déclencheur** : fonctionnalité livrée (arbre de travail après 70eb2e3). Demande : donner des
instructions depuis l'app elle-même, plus seulement par les apps des assistants ; texte d'abord
(étape 1), la voix ensuite. Décisions de l'utilisateur : forfait Claude de chaque compte sans clé
d'API (jeton de `claude setup-token`), repli sur la maison pour tous, Haiku, journal des instructions
visible dans Réglages, sessions Claude gardables pour déboguer, et le moteur découpé en plugin
(« on pourrait imaginer un plugin ChatGPT ou Cursor »).

**Pages créées** :
- `1_architecture/1_9_assistant.md` - le cœur : contrat des moteurs, route NDJSON, jeton de course,
  dernier mot garanti, journal, app web, mesures, limites.
- `3_plugins/3_24_claude.md` - le plugin : forfait par compte, lancement verrouillé, traduction de
  `stream-json`, santé, configuration, pièges, tests et vérification.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - mise à jour : le jeton de course (`runToken`).
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour : la ligne « Demander à Kasbah » de la palette et
  de la barre, la réponse, le téléphone, la section Assistant et sa carte de plugin.
- `5_setup/5_1_configuration-env.md` - mise à jour : `CLAUDE_*` et les fichiers d'état.
- `3_plugins/3_2_ecrire-un-plugin.md` - mise à jour : le plugin moteur de l'assistant, et le rappel sur
  `ctx.config`.
- `6_faq/6_1_pieges-runtime.md` - entrée `--safe-mode` ; récidive du piège de la config re-validée.
- `6_faq/6_0_pieges-outillage.md` - entrée `sed -i` sous Git Bash (CRLF → LF).

**Index** : mis à jour (2 lignes ajoutées, 6 lignes complétées).

## [2026-10-07] update | Comptes musicaux par utilisateur : YouTube Music et Mixcloud

**Déclencheur** : fonctionnalité livrée (arbre de travail après 24471a6, non commitée). Demande : « maintenant qu'on a des utilisateurs, chacun doit avoir accès à ses propres comptes musicaux » sans abîmer l'historique d'un autre ni celui de la maison. Décisions de l'utilisateur : connecté sans réglage = accès anonyme (« pas d'accès » et « repli sur le compte commun » écartés) ; mêmes cartes sur « le compte courant » (carte séparée écartée) ; radios favorites inchangées ; un jeton MCP = les comptes de son compte.

**Pages modifiées** :
- `1_architecture/1_6_lecteur-musique.md` - renvoi sur les signatures du contrat (dépassées) + mise à jour : `MusicUser`, file qui garde le compte de qui l'a lancée, préchargement par compte, `/progress` `/resume` `/transfer`, dernière écoute restée commune
- `3_plugins/3_16_ytmusic.md` - renvois (étapes du cookie, section MCP) + mise à jour : un `Account` par compte, anonyme, mesure 130 kb/s, import refusé, caches par compte, étapes du cookie réécrites, `document.cookie` écarté
- `3_plugins/3_20_mixcloud.md` - renvois (compte `un_auditeur` = la maison, reprise, santé, MCP) + mise à jour : nom et reprise par utilisateur, anonyme, caches par nom Mixcloud, champ avant l'explication
- `3_plugins/3_19_radio.md` - mise à jour : favorites restées celles de la maison
- `1_architecture/1_7_serveur-mcp.md` - renvois (outils « sans compte », `deleteUser`) + mise à jour : `authInfo`, `actAsHeaders`, secret interne, tests
- `0_overview/0_0_vision-et-principes.md` - renvoi : comptes musicaux faits, droits restant à faire
- `5_setup/5_1_configuration-env.md` - `.state/users/<nom>/`, encodage du nom, effacement au retrait ; aucune variable
- `4_ui/4_1_navigation-et-panneaux.md` - cartes de comptes sur le compte courant, modes anonymes de la page Musique
- `6_faq/6_1_pieges-runtime.md` - trois pièges du banc (clic hors page à 1 280×800, `YTM_YTDLP_PATH` absolu, `localStorage['kasbah.locale']`)

**Contradictions code / wiki** : aucune section effacée ; les passages dépassés (signatures `prepare()` / `resolve(id)` / `onProgress(...)`, « mêmes chemins que l'interface », compte Mixcloud unique) gardent leur texte avec un renvoi daté. Un point à vérifier : la page 1_6 (« Piège dans le code ») n'a pas été relue contre le nouveau code de `player.ts`.

**Trous** : `journal.md` de la session non consulté (brief du fil principal seul, recoupé avec `paths.ts`, `sources.ts`, `session.ts`, `auth.ts`) ; la mesure 130 kb/s est un seul passage ; `/transfer` et les routes du lecteur ne sont pas relues dans `player.ts`.

**Index** : mis à jour (9 lignes).

## [2026-10-07] update | L'app installée reste en `standalone` : plein écran essayé, abandonné

**Déclencheur** : demande de l'utilisateur (ouvrir l'app installée en plein écran sur le téléphone) ; deux essais non commités, tous deux abandonnés après test sur Android ; recherche des tickets Chromium.

**Pages modifiées** :
- `5_setup/5_2_production.md` - mise à jour : option mémorisée (abandonnée : quitter l'app sort du plein écran), `display: fullscreen` (bande noire de la caméra, barre du bas hors de l'écran jusqu'à un passage par les apps ouvertes), références Chromium 407420295 et 40780591 avec l'état relevé, procédure pour réessayer
- `6_faq/6_1_pieges-runtime.md` - piège `display: fullscreen` sur Android

**Contradictions code / wiki** : aucune ; le code est inchangé (`standalone`).

**Index** : 2 lignes.

## [2026-10-06] update | Accès à toute l'application depuis l'extérieur, derrière une connexion

**Déclencheur** : fonctionnalité livrée (arbre de travail, HEAD d800aff, non commitée) : l'adresse publique du proxy inverse ouvre toute l'application après connexion (mêmes comptes que le MCP), pour un téléphone hors de la maison sans VPN.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - mise à jour « toute l'application derrière une connexion » (pourquoi, VPN et Cloudflare Access écartés, décisions, porte à session, gardien partagé, page restylée, procédure du proxy inverse, limites, vérifié) ; renvois datés sur « Le reste de Kasbah… sans authentification », « Le MCP seul pour l'instant », « refusé en 404 », « sous le nom public, rien que le MCP » et « pas de préréglage WebSocket »
- `5_setup/5_2_production.md` - renvois (« Pas de HTTPS ni d'authentification », « Suites possibles », PWA « il faudra HTTPS ») + mise à jour : procédure du proxy inverse dans l'ordre, `MUSIC_PUBLISH_BASE`, installation dès la connexion, iPhone
- `5_setup/5_1_configuration-env.md` - `KASBAH_SESSIONS_FILE`, `KASBAH_LOGIN_MAX_FAILURES`, `KASBAH_LOGIN_LOCK_MINUTES`, rôle élargi de `MCP_PUBLIC_URL`
- `0_overview/0_0_vision-et-principes.md` - renvoi : authentification de l'UI faite (droits par compte restant à faire)
- `1_architecture/1_3_protocole-rest-ws.md` - routes `/api/session`, `/login`, `/logout`, codes `AUTH_REQUIRED` / `BAD_ORIGIN` / `LAN_ONLY` + renvoi sur « localhost seulement » du MCP
- `1_architecture/1_4_app-web.md` - `signInAgain` sur `AUTH_REQUIRED` seulement, sonde à la coupure du WebSocket, `router.onError`, `transport.session()`
- `1_architecture/1_6_lecteur-musique.md` - `publishBase` refuse l'adresse publique (+ renvoi sur la description de `MUSIC_PUBLISH_BASE`)
- `4_ui/4_1_navigation-et-panneaux.md` - carte Réglages « Comptes », déconnexion
- `6_faq/6_1_pieges-runtime.md` - entrée groupée de cinq pièges (morceaux JS renvoyés sur la connexion, flux caméra WebSocket, `injectWS`, CSP de la page de connexion, serveur de vérification `*.localhost`)

**Contradictions code / wiki** : aucune section effacée ; les passages devenus faux (« reste sans authentification », « refusé en 404 », « Le MCP seul pour l'instant », « il faudra HTTPS ») gardent leur texte et portent un renvoi daté.

**Trous** : aucun essai réel par le proxy depuis un téléphone n'est consigné (seulement deux constats de l'utilisateur) ; `journal.md` de la session absent.

**Index** : mis à jour (9 lignes).

## [2026-10-06] update | Suites du lint : outils MCP, `house.origin`, retrait de `house.scenes[]`

**Déclencheur** : points laissés « à trancher » par le lint du même jour.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md`, `3_19_radio.md`, `3_20_mixcloud.md` - section datée : comment `search_music`, `play_music` et `play_radio` atteignent la source
- `3_plugins/3_23_toutemonannee.md` - section datée : `get_school`, lecture seule, filtres de la vue École

- `2_maison/2_0_format-house-json.md` - `scenes[]` retiré du format (décision de l'utilisateur), compatibilité des anciens fichiers
- `0_overview/0_1_glossaire.md`, `1_architecture/1_8_automatisations.md` - renvois : la scène maison n'existe plus

Hors wiki : commentaires `site.origin` → `house.origin` dans `apps/web/src/lib/daylight.ts` et `apps/web/src/three/core/ambience.ts` ; `houseSceneSchema` / `sceneActionSchema` retirés de `packages/shared/src/house/schema.ts`, scènes retirées des deux maisons de démo, test de compatibilité dans `house.test.ts` ; `docs/house-json.md` (section Scènes).

**Index** : mis à jour (7 lignes).

## [2026-10-06] lint | Wiki health check, passages dépassés corrigés

**Orphelins** : 0 (le glossaire n'est lié que depuis l'index)
**Liens relatifs cassés** : 0
**Pages de plus de 6 mois** : 0 (la plus ancienne date du 2026-09-08)
**Passages dépassés** : ~110 dans 37 pages, relevés par quatre audits vérifiés dans le code ; presque tous des affirmations de début de page corrigées plus bas par une mise à jour datée, sans renvoi
**Lacunes** : variables de 5_1 (Agenda, Automower, iRobot, MELCloud, PetKit, Renault, fichiers TaHoma, MCP) ; outils MCP absents des pages 3_16 et 3_23 (non traité)

**Actions faites (validées par l'utilisateur)** :
- Renvoi daté en italique après chaque passage dépassé, texte d'origine conservé (thèmes : `KASBAH_PLUGINS` / `MOCK_EXCLUDE_KINDS` / `plugin-settings.json` supprimés le 2026-09-11 ; Tesla, Renault, Enphase, Nest plus en « phase 1 » ; quota Automower 21 000 / 7 jours ; démarrage des plugins en parallèle ; contradiction iRobot tranchée ; `MUSIC_PUBLISH_BASE` ; murs pleine hauteur ; police Plus Jakarta Sans ; page Musique ; routeur sans hash ; `node --watch`)
- Listes de référence remises à jour avec mention datée : 16 kinds (0_1, 1_1), routes plugins et messages WS (1_3), store `settings` (1_4), 10 outils MCP (1_7), démo (2_0), hauteurs et styles du jardin (2_2), 13 styles (4_2), scripts (5_0), section « variables des plugins restants et du MCP » (5_1)
- Une route corrigée en place : `PUT /api/house/edit` (2_0)
- Hors wiki : commentaires de code (`automower/client.ts` et `ws.ts`, `mock-sim/src/simulation.ts`, `plugins/index.ts`), message d'erreur 403 d'Automower, `MUSIC_PUBLISH_BASE` dans `.claude/launch.json`, README (13 styles, URL sans hash)

**Proposé, non fait** :
- Décider du sort de `house.scenes[]`, gardé par le schéma mais lu par aucun code
- Commentaires `site.origin` dans `daylight.ts` / `ambience.ts` (le champ est `house.origin`)
- Mentionner les outils MCP dans 3_16 et 3_23

**Index** : mis à jour (35 dates).

## [2026-10-06] update | Pages utilisateur des plugins, dépôt du protocole COMAP

**Déclencheur** : README complété (vues, plugins manquants, automatisations) et une page utilisateur par plugin dans `docs/plugins/` ; l'utilisateur publie le protocole COMAP dans un dépôt à part.

**Pages modifiées** :
- `3_plugins/3_12_comap-proteo.md` - lien vers `stillgbx/comap-proteo-protocol`, référence du protocole ; `COMAP_HOST` sans défaut (facultatif dans le schéma, exigé par le plugin)
- `3_plugins/3_2_ecrire-un-plugin.md` - pages `docs/plugins/<id>.md`, leurs conventions, point ajouté à la liste de contrôle

**Index** : mis à jour (2 lignes).

## [2026-10-06] update | Brancher chaque assistant IA sur `/mcp`, et le dépannage

**Déclencheur** : procédures relevées les 5 et 6 octobre 2026 et vérifiées par l'utilisateur avec Kasbah (Claude, ChatGPT, Mistral Vibe, Grok), reportées dans le README (section « Serveur MCP » → « Brancher un assistant IA »).

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - section datée : configuration et mode d'inscription par assistant (Claude, ChatGPT en mode développeur, Mistral Vibe, Grok ; Gemini pas encore possible en France, Gemini Enterprise exigerait un client OAuth fixe), Claude Desktop vers l'adresse publique, dépannage (journaux de la version Microsoft Store, port dans l'adresse publique, `--allow-http` qui ne passe pas l'étape OAuth, « invalid state » de Mistral)

**Index** : mis à jour (1 ligne).

## [2026-10-05] update | `randomUUID` hors contexte sécurisé, deux avertissements i18n

**Déclencheur** : création d'automatisation qui plante en http sur le réseau local ; avertissements `[intlify]` dans Réglages.

**Pages modifiées** :
- `6_faq/6_1_pieges-runtime.md` - `crypto.randomUUID` absent hors https / localhost, repli `getRandomValues`
- `4_ui/4_2_theme-et-langues.md` - format de date `long` ajouté, `<nom>` du texte Mixcloud pris pour du HTML

**Index** : mis à jour (2 lignes).

## [2026-10-05] update | DNS local cassé sur Android par un DNS IPv6 annoncé par la box

**Déclencheur** : `kasbah:5173` en `DNS_PROBE_FINISHED_NXDOMAIN` sur le téléphone, l'IP marchait.

**Pages modifiées** :
- `5_setup/5_0_installation-et-scripts.md` - cause (DNS IPv6 de la box relayé par le routeur), correction (IPv6 désactivé), nom complet sur Android

**Index** : mis à jour (1 date).

## [2026-10-04] update | MCP en service sur Claude mobile

**Déclencheur** : connecteur claude.ai ajouté depuis l'app mobile, par un proxy inverse ; ça marche.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - mise en service vérifiée (Host transmis par le proxy, CIMD réel), limite des comptes d'organisation

**Index** : mis à jour (résumé de 1_7).

## [2026-10-04] update | Sous le nom public, rien que le MCP

**Déclencheur** : l'utilisateur veut passer par un proxy inverse qui transmet tout ce qui arrive sous son nom.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - `publicHostFilter`, limite (Host non transmis), autre serveur web écarté, mise en service prévue derrière le proxy

**Index** : mis à jour (résumé de 1_7).

## [2026-10-04] update | Comptes MCP dans Réglages, logo de la page de connexion

**Déclencheur** : l'utilisateur veut gérer les comptes MCP depuis l'app (script gardé en secours) et voir le logo sur la page de connexion.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - routes `/api/mcp/users`, carte de Réglages, logo inclus dans la page, vérification

**Index** : mis à jour (résumé de 1_7).

## [2026-10-04] update | Authentification OAuth sur `/mcp`

**Déclencheur** : l'utilisateur veut Kasbah dans Claude sur le téléphone ; les connecteurs claude.ai appellent depuis Internet. Choix : le MCP seul (VPN pour l'interface web), jeton exigé partout, comptes à côté du `.env`.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - section Sécurité réécrite, suite « accès distant » close, mise à jour OAuth (routes, décisions, piège `form-action`, SDK client et http hors loopback, vérification)

**Index** : mis à jour (résumé de 1_7).

## [2026-10-04] update | Outil MCP `get_school` (école en lecture seule)

**Déclencheur** : l'utilisateur veut lire les devoirs, le cahier de liaison et les publications par MCP ; le plugin TouteMonAnnée ne publie aucun appareil.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - outil `get_school`, entrées, `schoolDigest`, vérification

**Index** : mis à jour (résumé de 1_7).

## [2026-10-04] update | `/mcp` ouvert au réseau local sous le nom `kasbah`

**Déclencheur** : Claude Desktop (`mcp-remote http://kasbah:8787/mcp`) en « Server disconnected » : le serveur tournait, mais renvoyait 403 sur `Host: kasbah`. L'utilisateur choisit d'ouvrir `/mcp` au réseau local.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - liste `ALLOWED_HOSTS` (localhost + `kasbah` / `kasbah.home.internal`), section Sécurité, suite « LAN » retirée

**Index** : mis à jour (1 date).

## [2026-10-04] ingest | Plugin TouteMonAnnée et vue École

**Déclencheur** : l'utilisateur veut consulter les devoirs (cahier de texte toutemonannee.com) plus facilement ; puis cahier de liaison et publications.

**Pages créées** :
- `3_plugins/3_23_toutemonannee.md` - API privée relevée, liaison par cookies, case « fait » du site (bascule), routes, vue École, ce qui reste à faire

**Pages modifiées** :
- `1_architecture/1_3_protocole-rest-ws.md` - routes `/api/plugins/toutemonannee/*`
- `4_ui/4_0_langage-visuel.md` - `Segmented` `count`, icônes `school` / `message` / `news`
- `4_ui/4_1_navigation-et-panneaux.md` - vue École et choix d'interface tranchés avec l'utilisateur
- `5_setup/5_1_configuration-env.md` - `TMA_*`

**Index** : mis à jour (1 ligne ajoutée, 4 dates).

## [2026-10-04] update | Routage web sans `#` (historique HTML5)

**Déclencheur** : l'utilisateur ne veut plus de `#` dans les adresses (`kasbah:5173/#/`).

**Pages modifiées** :
- `1_architecture/1_4_app-web.md` - § Routage : `createWebHistory(BASE_URL)`, `base: '/'` et pourquoi, réécriture des anciens liens `#/`
- `5_setup/5_2_production.md` - repli SPA désormais requis, sous-dossier plus servi sans changer `base`

**Index** : mis à jour (2 lignes).

## [2026-10-04] update | Installer une machine neuve (Windows) : outils, plugin yt-dlp bgutil, fichiers à recopier

**Déclencheur** : passage du projet sur un nouveau poste qui sert au dev et au serveur de la maison ; ffmpeg absent, plugin yt-dlp `bgutil` non chargé (`PO Token Providers: none`).

**Pages modifiées** :
- `5_setup/5_0_installation-et-scripts.md` - section datée : outils et commandes winget, plugin yt-dlp à côté de l'exe (vérifié), fichiers hors git à recopier, `dev` / `house` / `start`, pare-feu ; signale le commentaire `KASBAH_PLUGINS` périmé
- `5_setup/5_2_production.md` - section datée : renvoi vers les prérequis, `npm start` sans PO Token

**Index** : mis à jour (2 lignes).

## [2026-10-04] update | Nom DNS local `kasbah.home.internal` et `server.allowedHosts` de Vite

**Déclencheur** : l'utilisateur a monté un DNS local sur son routeur (zone `home.internal`) ; Vite bloquait le nom.

**Pages modifiées** :
- `5_setup/5_0_installation-et-scripts.md` - section datée : zone DNS, suffixe DHCP, `allowedHosts`, production non concernée

**Index** : mis à jour (1 ligne).

## [2026-10-03] update | Dimensions des pièces depuis l'UI (cotes maîtresses)

**Déclencheur** : suite de l'apparence des pièces — éditer les dimensions (pousser un mur, taper une cote), le mur mitoyen entraînant la voisine, une ouverture qui ne tient plus bloquant « Valider », un seul brouillon ; étape vers la modélisation complète depuis l'UI.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - les cotes deviennent la donnée côté UI : `fitSurvey` porté (passage ouvert, chevauchement), conversion d'une maison non relevée, séance et recalage des ouvertures, gestes
- `1_architecture/1_3_protocole-rest-ws.md` - `PUT /api/house/edit` remplace `/api/house/appearance`
- `1_architecture/1_5_scene-3d.md` - `RoomShapeEditor`, `updateBuilding`, chemins de `useHouseScene`
- `4_ui/4_1_navigation-et-panneaux.md` - onglet Dimensions, brouillon unique, blocages
- `5_setup/5_0_installation-et-scripts.md` - `fit-survey.mjs` enveloppe du code partagé

**Index** : mis à jour (5 lignes).

## [2026-10-03] update | Apparence des pièces (finitions) et sélection en mode édition

**Déclencheur** : demande de l'utilisateur — éditer l'apparence du sol et des murs d'une pièce (puis ses dimensions), avec quelques variantes de textures par matière, étape vers la modélisation complète depuis l'UI ; puis deux bugs de sélection signalés (tap sur une pièce pendant le réglage d'une ouverture, tap sur le sol du 1er qui attrapait une ouverture du RDC).

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - section datée : catalogue `FINISHES`, champs `floorFinish` / `wallFinish` / `house.style.facade`, `applyAppearanceToJson`, dimensions à venir
- `1_architecture/1_3_protocole-rest-ws.md` - `PUT /api/house/appearance`, historique `history/` de house.json
- `1_architecture/1_5_scene-3d.md` - deux sections : finitions et murs découpés par face (`updateAppearance`, bug de la façade seule), occlusion des poignées et des places dans `pick`
- `4_ui/4_1_navigation-et-panneaux.md` - sélecteur de finitions, brouillon et sa barre, tap sur une pièce pendant un réglage
- `5_setup/5_0_installation-et-scripts.md` - finitions dans `fetch-textures.mjs`

**Index** : mis à jour (5 lignes).

## [2026-10-03] update | style de rendu Girlyversaire et ses ballons

**Déclencheur** : demande de l'utilisateur, un thème 3D pour un anniversaire d'enfant (ballons, rose / lilas / doré), renommé « Girlyversaire ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section datée 2026-10-03 : le style `girlyversaire` et l'effet `Parade.balloons`

**Index** : mis à jour (1 ligne). Réparé au passage : 30 lignes de la table finissaient par un octet `\x01` au lieu de ` |` (introduit par d642ac4, sans doute un `\1` dans le remplacement d'un `sed`) : la colonne date n'était plus fermée.

## [2026-10-02] update | Terminologie : « tablette » générique → écran / navigateur / interface

**Déclencheur** : demande de l'utilisateur — Kasbah sert aussi sur ordinateur et téléphone ; même passe de vocabulaire faite dans le code (56 fichiers, non commités), dont le `git diff` sert de référence de ton. Remplacement du terme seul, aucune reformulation de fond.

**Règle appliquée** : « écran(s) » pour un client quelconque (diffusion WS, « toutes les tablettes en héritent ») ; « navigateur » pour ce qui est mémorisé ou calculé localement (`localStorage`, langue, heure, format, préférences) ; « interface » pour « depuis l'UI » (appairage, commandes, côté UI) ; « écran moyen » pour la classe de mise en page 720–1100 px. Jamais « appareil » (réservé aux objets connectés).

**Pages modifiées** (nombre de remplacements) :
- `SCHEMA.md` (1), `0_overview/0_0_vision-et-principes.md` (1) - « app tablette » → « tablette, ordinateur, téléphone » (même formule que le README)
- `1_architecture/` : `1_1_contrat-appareils` (4), `1_2_serveur-et-plugins` (1), `1_3_protocole-rest-ws` (11), `1_4_app-web` (2), `1_5_scene-3d` (1), `1_6_lecteur-musique` (1), `1_8_automatisations` (2)
- `2_maison/` : `2_0_format-house-json` (3), `2_2_jardin` (2)
- `3_plugins/` : `3_13` (1), `3_15` (1), `3_16` (6), `3_17` (1), `3_19` (1), `3_1` (1), `3_21` (1), `3_22` (2, dont le titre « Côté interface »), `3_2` (3), `3_5` (4), `3_6` (1), `3_7` (2), `3_8` (2), `3_9` (1)
- `4_ui/4_1_navigation-et-panneaux` (17), `4_ui/4_2_theme-et-langues` (12)
- `5_setup/` : `5_0` (2), `5_1` (1), `5_2_production` (3, dont le titre « Écran sur le LAN »)
- `6_faq/6_1_pieges-runtime` (6)
- `index.md` (7 résumés ; dates des pages touchées bumpées)

**Gardé exprès** : les cas physiques concrets (tablette murale, du palier, de l'entrée, doigt qui glisse, absence de survol, coût sur tablette, GPU de tablette à tuiles, tablette en portrait, « juger le reflet sur la tablette ») ; l'icône `tablet` et ses descriptions ; les énumérations « tablette, ordinateur, téléphone » ; les titres de sections datées qui citent « préférence de tablette » / « côté tablette » (ancres et citations croisées : `1_4` renvoie à l'un d'eux) ; la citation « tablette » de 4_2 (« Elle ne parle pas de “tablette” ») ; `3_21` « tablette du palier ». Deux emplois de gabarit « sur tablette » laissés dans le doute dans `4_1` (largeur de conteneur 635 px, résumé d'en-tête de `PageHeader`). `log.md` : aucune entrée existante modifiée.

**Index** : mis à jour (7 résumés, dates des pages modifiées).

## [2026-10-02] update | la ligne « Logiciel » dans le panneau 3D du véhicule

**Déclencheur** : « ajoute aussi la ligne Logiciel dans le panneau 3D du véhicule ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée (ter) : `VehicleSoftware` dans `VehicleCard`

**Index** : inchangé (date déjà du jour).

## [2026-10-02] update | Tesla : les nouveautés de la version installée dans l'historique

**Déclencheur** : installation de 2026.38 finie ; l'historique de la boîte ne la montrait pas.

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` - section datée (ter) : forme de `software_update` après installation, `show_in_history: false` sur la version installée, nouvelle règle de tri et `NOTES_RULE`

**Index** : inchangé (date déjà du jour).

## [2026-10-02] update | Tesla : la première installation réelle, suivie jusqu'au bout

**Déclencheur** : l'utilisateur lance « Installer maintenant » depuis Kasbah ; l'appli Tesla montre un décompte annulable puis le pourcentage, Kasbah annonçait une heure passée.

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` - section datée (bis) : heure fixée par Tesla, lectures de suivi, pas de repos pendant l'installation
- `4_ui/4_1_navigation-et-panneaux.md` - section datée (bis) : réveil dans la boîte, durée, décompte, progression, largeur de la boîte
- `3_plugins/3_0_simulation-mock.md` - section datée (bis) : champ retiré émis en `null`, décompte simulé

**Index** : mis à jour (3 lignes).

## [2026-10-02] update | R5 « en charge » à tort : le niveau qui monte, et le démenti par la borne

**Déclencheur** : « la voiture ne charge pas, la borne est en mode vert et pas assez de soleil, mais kasbah affiche toujours qu'elle charge » ; trame Kamereon relue jusqu'au soir ; l'utilisateur choisit les deux corrections.

**Pages modifiées** :
- `3_plugins/3_9_renault.md` - section datée : la trame du 02/10, le second témoin qui exige un niveau qui monte (`trackLevel`, `levelRising`, une heure), ce que ça coûte au démarrage ; puis vérifié sur la vraie maison (`charging: false`, réveil de charge reparti) et le piège du redémarrage trop tôt
- `1_architecture/1_2_serveur-et-plugins.md` - section datée : `chargingRefuted` et `checkChargingClaim` / `recheckChargingClaims` dans `PluginHost`

**Index** : mis à jour (2 lignes).

## [2026-10-02] update | Borne Enphase : le mode d'avant le forçage rendu

**Déclencheur** : branche `claude/r5-charge-mode-reset-103743` ; charge de la R5 forcée par le chat à 50 %, borne restée en annulation manuelle après le débranchement, appli bloquée ; puis « que le mode d'avant revienne une fois la limite de charge atteinte ».

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` - section datée : annulation qui survit au débranchement, manuel puis mode d'avant, `restoreModes`, `resume_mode`, retour dû ; contradiction détectée avec le retour seul au débranchement du 2026-10-01, puis ARBITRÉE par l'utilisateur : le retour seul est normal mais pas garanti, Kasbah remet alors le mode lui-même
- `1_architecture/1_2_serveur-et-plugins.md` - section datée : `forcedFor`, `chargeLimitReached`, envoi de `ev_charger.resume_mode`
- `1_architecture/1_1_contrat-appareils.md` - commande `ev_charger.resume_mode`

## [2026-10-02] update | alertes sur le rail (pastille, « vu » par poste, vigilance dans l'état)

**Déclencheur** : fonctionnalité livrée le 2026-10-02, non commitée (diff + `alerts.ts` de `shared` et du web) ; récit fourni par le fil principal, vérifié contre le code.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : pastille du rail, store, « vu » par poste, trois gravités, « Masquer » / croix, impasses de libellé, nettoyage du stockage, vérifications jouées et non jouées ; un geste ferme toutes les alertes fermables d'un appareil (`closableFor`, corrigé après relecture)
- `1_architecture/1_1_contrat-appareils.md` - `deviceAlerts`, `ALERT_SEVERITIES`, forme des ids, champ météo `vigilance`
- `3_plugins/3_10_open-meteo.md` - lecture de la vigilance à chaque sondage, hors métropole et flux tombé, tests ; les deux phrases de la section du 2026-10-01 contredites (« pas dans l'état », « rien n'est lu tant que la vue ne le demande pas ») marquées dépassées

**Index** : mis à jour (3 lignes).

## [2026-10-02] update | Tesla : mise à jour logicielle et notes de version

**Déclencheur** : brief `_generated-ai-doc/tesla-mise-a-jour-ota.md` (voir la mise à jour et le changelog dans Kasbah, puis l'historique), puis « le changelog dans la langue de l'app avec repli sur l'anglais » ; essais sur la vraie voiture avec l'accord de l'utilisateur (langue, facturation).

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` - section datée : `software_update`, `release_notes` (forme, `?language=fr`, gratuit), cache par version et langue, commandes d'installation jamais envoyées, piège du fichier d'état rejeté en entier
- `1_architecture/1_1_contrat-appareils.md` - `softwareVersion`, `softwareUpdate`, capacités `release_notes` et `software_update`, commandes `schedule_update` / `cancel_update`
- `1_architecture/1_3_protocole-rest-ws.md` - route `GET /api/devices/:id/release-notes?lang=`
- `3_plugins/3_0_simulation-mock.md` - logiciel de la Tesla simulée, réveil de 10 min
- `4_ui/4_1_navigation-et-panneaux.md` - ligne « Logiciel » et boîte des notes

**Index** : mis à jour (5 lignes).

## [2026-10-02] update | vue Véhicules : cartes horizontales, panneaux par-dessus la carte

**Déclencheur** : « avec les cartes véhicule à la verticale on a beaucoup d'espace vide à droite », puis des captures annotées (disposition par largeur, ordre des boutons, panneaux par-dessus la carte, hauteur minimale de 245 px).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : trois dispositions par `@container`, zones de grille (impasse des colonnes-enveloppes), ordre des boutons, panneaux en calque, `--vmap-min`, `VehicleClimate` étiré (impasse du `minmax` plafonné).

**Index** : mis à jour (1 ligne).

## [2026-10-01] update | carte véhicule : filigranes, autonomie partagée, limite Tesla retentée

**Déclencheur** : « mettre en filigrane un visuel représentant la section », le « 67 % » répété et rogné du panneau, « ça pourrait être le même composant partagé (l'autonomie) », puis « la 1ère demande de limite de charge semble parfois être en erreur » (`could_not_wake_buses`).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée (bis) : filigranes et leurs icônes, impasses des températures, `VehicleBattery`, grande valeur retirée du panneau.
- `3_plugins/3_8_tesla.md` - puce : `could_not_wake_buses` sur la limite de charge, retenté dans la commande sous le délai de 10 s.

**Index** : mis à jour (1 ligne).

## [2026-10-01] update | carte véhicule : âge en tête, charge visible, voir dans la vue 3D

**Déclencheur** : « l'information de dernière maj se déplace avec l'ouverture des panels, il faudrait la remonter en haut de carte », puis le quota sur une ligne, un pulse quand la charge est active, un autre terme que « Charge », et un accès à la voiture dans la vue 3D, cohérent avec les volets.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : âge dans l'en-tête, quota « ≈ », éclair + halo + reflet, case « Câble », épingle `pin` et clé `common.showIn3d` partagées (clés `rooms.origins.show` et `music.locate` retirées).

**Index** : mis à jour (1 ligne).

## [2026-10-01] update | vue Météo : vigilance Météo-France, soleil et crédits

**Déclencheur** : capture de la vue Météo à 1919 × 937 : la carte Soleil et lune déborde, les crédits sont trop serrés en bas, et « une alerte vigilance a été émise dans la zone de la maison, possible de l'afficher ? ».

**Pages modifiées** :
- `3_plugins/3_10_open-meteo.md` - section datée : route `/alerts`, flux MeteoAlarm + API Géo, règle de lecture des messages, métropole seule, cache, mesures sur le vrai flux.
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : pastille de vigilance, grille de 24 colonnes, crédits sous le radar, seuils du mode « tout tient » relevés à 1770 × 934.

**Index** : mis à jour (1 ligne).

## [2026-10-01] update | style Akira, moto de Kaneda, personnages sur tout le terrain

**Déclencheur** : « possible d'ajouter un style "Akira" ? » (le rendu 3D, avec la moto), puis faire parcourir tout le terrain à ce qui bouge en évitant maison, piscine, arbres, voitures et robots, lisser les trajectoires, et les défauts vus sur la vraie maison (X-wings hors du terrain, un seul squelette).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section datée (bis) : style Akira, `Parade.bike` et sa traînée, `effects/roam.ts` (boucle planifiée, règles et préférences, qui évite quoi), quatre impasses mesurées, mesures avant / après ; la règle « autour de l'emprise bâtie » du 2026-09-29 est signalée remplacée.
- `4_ui/4_2_theme-et-langues.md` - section datée : clé `render.styles.akira`, la tuile d'un style appliquant l'étalonnage de sortie.

**Index** : mis à jour (2 lignes).

## [2026-10-01] update | détail 3D du véhicule : clim et tuiles

**Déclencheur** : « ajouter les contrôles de clim sur le panel détail de vue 3D », puis « passe-les en tuiles ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - ajout daté (ter) : `VehicleClimate` dans `controls/VehicleCard.vue`, Verrouiller / Charge en tuiles toujours affichées, débordement de 35 px corrigé.

## [2026-10-01] update | préparer la charge de la R5 (démarrage par les réglages, arrêt par la borne)

**Déclencheur** : session « préparer la charge de la R5 » ; code écrit et testé, pas encore essayé sur la vraie voiture.

**Pages modifiées** :
- `3_plugins/3_9_renault.md` - section datée : recette `chargeStartPayload`, programmes non restaurés (décision), 409, `chargeModeRq` en question ouverte, liste de contrôle de l'essai ; deux notes « Corrigé le 2026-10-01 » (ni `charging`, « la seule chose qu'elle laisse changer »).
- `1_architecture/1_2_serveur-et-plugins.md` - section datée (2) : `chargerToStop`, essayé en premier par `PluginHost.execute` ; note « Corrigé » sur « l'arrêt n'est JAMAIS relayé ».
- `1_architecture/1_1_contrat-appareils.md` - section datée : `meta.vehicle.stopViaCharger`.
- `6_faq/6_1_pieges-runtime.md` - une phrase dans l'entrée de la borne bloquée après Arrêter.

**Contradictions relevées** : « l'arrêt n'est JAMAIS relayé » (serveur, FAQ) et « ni `lock` ni `charging` » (Renault) ne tiennent plus ; anciens textes gardés, notes datées ajoutées. Aucun journal de session n'existait : récit tiré du brief du fil principal et du diff, vérifié contre le code.

**Index** : mis à jour (3 lignes).

## [2026-10-01] update | écritures atomiques mises en file (`writeFileAtomic`)

**Déclencheur** : `ENOENT` au `rename` du cache d’état Tesla dans le journal du serveur réel au démarrage ; correctif étendu à tous les fichiers d’état (« on factorise et on applique la même mécanique partout »).

**Pages modifiées** :
- `1_architecture/1_2_serveur-et-plugins.md` - section datée (3) : `core/atomic-file.ts`, file par chemin, sites migrés, `clear()`, texte figé à l’appel, ce qui n’est pas migré.
- `3_plugins/3_2_ecrire-un-plugin.md` - section datée : écrire un fichier d’état par `writeFileAtomic`.
- `6_faq/6_1_pieges-runtime.md` - entrée 2026-10-01 : la course, sa reproduction (2 écritures : 0 / 20, 10 : 20 / 20), la leçon.

**Index** : mis à jour (3 lignes).

## [2026-10-01] update | rayon « à la maison » partagé

**Déclencheur** : « utilise HOME_RADIUS_M du contrat dans VehicleCard », puis « aligne les deux autres aussi » (commit 8feaa09).

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` - note datée : les trois vues web importent `HOME_RADIUS_M` du contrat, plus de copie locale.

**Contradictions relevées** : le doublon `HOME_RADIUS_M` signalé dans l'entrée précédente est tranché.

**Index** : inchangé.

## [2026-10-01] update | lancer la charge des voitures et forcer la borne

**Déclencheur** : session « lancer la charge des voitures et forcer la borne » (Enphase IQ EV Charger 2 + Tesla, essais sur le vrai matériel).

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` - correction datée (« lecture seule » faux), section : routes start / stop / préférence, annulation manuelle jusqu'au débranchement, impasse `iqevc_sch_10028`, intensité par défaut, `send`, mode sécurisé, question ouverte (retour en vert à 2 min 30).
- `3_plugins/3_8_tesla.md` - correction datée, section (quater) : `charge_start` / `charge_stop`, réveil factorisé `wakeThen`, `could_not_wake_buses`.
- `1_architecture/1_2_serveur-et-plugins.md` - section : coordination voiture ↔ borne côté serveur (`chargerToForce`), arrêt jamais relayé, logger en heure locale.
- `1_architecture/1_1_contrat-appareils.md` - section : `safeLimit`, `meta.evCharger.stopUntilUnplug`.
- `1_architecture/1_4_app-web.md` - section : `isChargeRequested`.
- `4_ui/4_1_navigation-et-panneaux.md` - correction datée, section : attente de charge, saut de 2 px, panneau de la borne.
- `6_faq/6_1_pieges-runtime.md` - entrée : la borne ne reprend pas la charge verte après Arrêter.

**Contradictions relevées** : « lecture seule » / « pas de `charge_control` » (Enphase), « lancer la charge reste à faire » (Tesla), « Tesla ne déclare pas `charging` » (navigation) : corrigées par des notes datées, anciens textes conservés. `VehicleCard.vue` définit encore sa propre constante `HOME_RADIUS_M = 120` alors que le contrat partagé exporte `HOME_RADIUS_M` : doublon signalé, non tranché.

**Index** : updated (7 lignes).

## [2026-10-01] update | climatisation de la R5

**Déclencheur** : « ensuite tu peux faire la R5 » (après le panneau de climatisation commun).

**Pages modifiées** :
- `3_plugins/3_9_renault.md` - section datée : `hvac-start` start / cancel, réglages du préconditionnement dans `ev/settings`, `socThreshold`, `heatWhileOff`, questions ouvertes.
- `index.md` - résumé de la page.

## [2026-10-01] update | climatisation commune des véhicules : panneau, sièges, volant

**Déclencheur** : « une UI commune à tous les véhicules, qui propose le max et désactive ce qui n'est pas possible » (captures des applis Tesla et Renault) ; première livraison : marche, consigne, sièges et volant, dans un panneau dépliable.

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` - section datée (ter) : refus `low_soc` constaté sur la vraie voiture, `NEEDS_CONFIRMATION`, `force` / `manual_override`.
- `3_plugins/3_8_tesla.md` - correction datée : le forçage bouclait (`manual_override` ignoré pour `auto_conditioning_start`), remplacé par un refus `LOW_BATTERY`.
- `4_ui/4_1_navigation-et-panneaux.md` - correction datée : le panneau débordait de la carte à 828 px.
- `4_ui/4_1_navigation-et-panneaux.md` - ajouts datés : deux rangées (gestes, puis sections), puis grille de tuiles identiques, tout affiché, l'indisponible grisé.
- `1_architecture/1_1_contrat-appareils.md` - section datée : `meta.vehicle.climate`, `vehicle.climate_set`, `seatHeat`, `steeringWheelHeat`, piège de la fusion superficielle.
- `3_plugins/3_8_tesla.md` - section datée : commandes sièges / volant, numéros de siège, ce qui n'est pas fait.
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : panneau Climatisation, règles, « Réveiller » qui se grise au lieu de disparaître.
- `index.md` - résumés des trois pages.

## [2026-10-01] update | préconditionnement de la Tesla, réveil automatique

**Déclencheur** : « est-il possible d'ajouter le contrôle de la climatisation, pour conditionner le véhicule le matin avant de partir » ; réveil auto accepté, Tesla d'abord.

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` - section datée : commandes `set_temps` / `auto_conditioning_start|stop`, réveil puis attente par la liste, constat par lecture, coût, ce qui reste ouvert.
- `1_architecture/1_1_contrat-appareils.md` - section datée : `vehicle.climate_start|stop`, `climateOn`, `climateTargetC`.
- `index.md` - résumés et dates des deux pages.

**Contradictions** : la règle « jamais de réveil automatique » de la page Tesla ne vaut plus pour le préconditionnement ; noté dans la section datée, l'original n'est pas effacé.

## [2026-10-01] update | démarrage du serveur : plugins en parallèle, `npm run house`

**Déclencheur** : « beaucoup de restart main.ts au démarrage », « les plugins s'activent séquentiellement », « nest indique qu'il faut relier le compte ».

**Pages modifiées** :
- `1_architecture/1_2_serveur-et-plugins.md` - section datée : `startAll` en `Promise.all`, pourquoi sans risque.
- `1_architecture/1_0_monorepo-et-flux.md` - section datée : script `house` (sans watch) pour la maison réelle, `dev` pour développer.
- `6_faq/6_0_pieges-outillage.md` - nouvelle entrée `node --watch` sous Windows ; correction datée dans l'entrée du 2026-09-23 (SIGTERM).
- `3_plugins/3_5_google-nest.md` - piège daté : jeton de rafraîchissement expiré à 7 jours en mode « Testing » (cause probable).
- `index.md` - résumés et dates des quatre pages.

**Contradictions** : l'entrée FAQ du 2026-09-23 affirmait que `main.ts` traite le SIGTERM du watch ; faux sous Windows, corrigé par une ligne datée sans effacer l'original.

## [2026-10-01] update | importer la parcelle cadastrale

**Déclencheur** : « ajoute l'import de la parcelle cadastrale IGN » (onglet Contour de l'éditeur du terrain).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : bouton « Importer le cadastre », WFS Parcellaire Express interrogé par BBOX (pas par point), fusion des parcelles sous la maison, nettoyage, messages, piège de la maison démo posée sur une rue ; la mention « non fait » de la section précédente renvoie à la nouvelle.
- `index.md` - résumé de la page.

## [2026-10-01] update | éditer le contour du terrain

**Déclencheur** : « modifier les points du polygone du terrain — bouger, ajouter, supprimer — aussi depuis Régler la maison et le jardin » (arbre de travail non commité après 1ce4a91).

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - section datée : `setTerrainInJson`, relief agrandi, rien retiré du fichier.
- `2_maison/2_1_geometrie.md` - section datée : `isSimplePolygon`, `extendReliefGrid`.
- `1_architecture/1_3_protocole-rest-ws.md` - section datée : `PUT /api/house/terrain`.
- `1_architecture/1_5_scene-3d.md` - section datée : `OutlineEditor`, remaillage `shapeTerrain(outlineChanged)`, `sameShellButRelief`, visuel et piège du bloom.
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : onglets Relief | Contour, entrée depuis « Régler la maison » (alternative écartée), avertissement sans blocage, rien ne bouge, pièges.
- `index.md` - résumés et dates des cinq pages.

**Contradictions** : aucune relevée. Écart de détail : le brief citait Suppr seul, le code accepte aussi Retour arrière (`ReliefPanel.vue`).

## [2026-09-29] update | contraste AA du texte secondaire des thèmes

**Déclencheur** : lignes de la barre de recherche sous 4,5:1 au repos dans cinq variantes de thème.

**Pages modifiées** :
- `4_ui/4_2_theme-et-langues.md` - section datée : règle `text` / `muted` ≥ 4,5:1 sur surface et fond, méthode (couleur publiée sinon OKLCH à teinte égale), tableau avant / après, garde-fou de test ; le compromis « authenticité du muted » de 2026-09-12 marqué abandonné.
- `index.md` - résumé et date de la page.

## [2026-09-29] update | palette Ctrl+K

**Déclencheur** : « possible d'implémenter une palette de commande ctrl+k ? », puis « V1 navigation seule ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - renvoi depuis le paragraphe de la barre de recherche ; section datée : raccourci en capture, `withHome`, ordre navigation puis sélection, signal `homePanelRequest`, mesures « rien ne bouge », piège jsdom du stub teleport, deux écarts de revue.

## [2026-09-29] update | l'app sur un téléphone, en portrait et en paysage

**Déclencheur** : « les layout en mode mobile portrait et paysage ne conviennent pas » (téléphone Android : contrôles qui se chevauchent, rail sans défilement, boutons trop gros).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : les deux seuils et leurs jetons (`--dock-h`, `--page-x`, `--rail-w`, `--wx-w`), la barre du bas et le rail défilant, l'en-tête replié et son résumé qui défile, la feuille du bas, les boutons de caméra au doigt, Musique empilée, les pièges `.home { flex: none }` et grilles implicites.
- `index.md` - résumé de la page.

## [2026-09-29] update | barre Musique : sablier jusqu'à la lecture effective

**Déclencheur** : « quand on clique sur play sur un titre en pause après un refresh ou un restart serveur, il n'y a pas de spinner ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : le trou entre la réponse de `/resume` et l'état `playing` de l'enceinte, l'état local `starting` (levé à `playing`, au changement de lecteur ou après 15 s), la lecture directe inchangée (patch optimiste).

## [2026-09-29] update | styles Halloween, Noël, Tatooine et leurs personnages

**Déclencheur** : « ajouter 3 autres styles : halloween, noël, star wars », leurs effets (traîneau, fantômes et squelettes, X-wings), puis « des trajectoires plus aléatoires, comme les chauves-souris ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - onze styles livrés ; section datée : les trois styles et leurs réglages écartés, l'effet `Parade` (modèles en primitives, squelettes sur le relief, emprise bâtie plutôt que terrain), le vol qui erre (`wander` / `fly`), points non vérifiés et piège de la console de preview.
- `index.md` - résumé de la page.

## [2026-09-29] update | style de rendu disco, boule à facettes et projecteurs

**Déclencheur** : « ajouter un style de rendu 3D disco », puis « ajoute la boule à facettes et des projecteurs animés ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - huit styles livrés ; section datée : palette et surfaces du style disco, réglages écartés, effet `Disco` (boule, éclats, projecteurs), `StyleLook.disco`, `syncDisco` / `removeDisco` calqués sur les chauves-souris, points ouverts (coût des `SpotLight`, boule en vue par niveau).
- `index.md` - résumé et date de la page.

## [2026-09-29] update | jardin : olivier, noyer, cognassier, rosier

**Déclencheur** : « ajoute aussi un olivier, un noyer, un cognassier, des roses ».

**Pages modifiées** :
- `2_maison/2_2_jardin.md` - quatre espèces sans photo et leur famille (noyer en Feuillu, olivier et cognassier en Fruitier, rosier en Buisson), nombre d'espèces dans les sources.

## [2026-09-29] update | panneau d'édition en accordéon, familles Bambou et Fruitier, cinq espèces

**Déclencheur** : demandes de l'utilisateur sur le panneau d'édition (« mettre chaque section dans un accordéon », « regrouper les végétaux par famille »), puis « famille Bambou à part », « lance la famille fruitier », et pommier, sapin, eucalyptus, châtaignier et bouleau sans photo.

**Pages modifiées** :
- `2_maison/2_2_jardin.md` - `kind` complété ; section datée : accordéon, « Terminer », Réglages → vue Maison, section Jardin par famille (espèces sous « Terminé »), `bamboo` et `fruit` et leurs formes génériques, migration par l'API et piège du serveur qui garde l'ancien schéma, cinq espèces estimées, correctif du port `cone`.
- `2_maison/2_0_format-house-json.md` - familles `bamboo` et `fruit`.
- `4_ui/4_1_navigation-et-panneaux.md` - renvoi daté : accordéon du panneau de la maison et « Terminer ».
- `index.md` - résumés et dates des trois pages.

## [2026-09-29] update | jardin : espacement des sujets d'une haie, autre forme

**Déclencheur** : demandes de l'utilisateur après afd2b63 (« un param espacement entre les individus », « un bouton reset », « regénérer les formes des haies »).

**Pages modifiées** :
- `2_maison/2_2_jardin.md` - champ `spacing` dans le tableau ; section datée : automatique inchangé (20 formes identiques), espacement exact centré, pastille « auto » et ses deux ratés de mise en page mesurés, thème sombre non joué, graine des haies.
- `2_maison/2_0_format-house-json.md` - `spacing`, et `spacing: null` qui l'efface dans un réglage.
- `index.md` - résumés des deux pages.

Hors wiki : `docs/house-json.md` complété.

## [2026-09-29] update | jardin : la haie en rangée de sujets individuels

**Déclencheur** : retour de l'utilisateur sur la haie livrée en ba51936 (« la modélisation n'est vraiment pas détaillée »).

**Pages modifiées** :
- `2_maison/2_2_jardin.md` - section datée : le bloc continu remplacé par une rangée de sujets (espacement, sujet = masses étirées inégales, individualité, construction en mètres et hauteur dans le cache, poids mesuré, premier essai en grille écarté).
- `index.md` - résumé de la page jardin.

## [2026-09-29] update | jardin : tiered, spread, haie linéaire et onze espèces

**Déclencheur** : suite de la session « figuier » : onze photos passées à la skill `garden-species`, trois impasses du générateur levées à la demande de l'utilisateur.

**Pages modifiées** :
- `2_maison/2_2_jardin.md` - champs `spread`, `tiered`, `tiers` et `length` / `width` dans les listes ; section datée sur `tiered` et `spread` (impasses, garantie « 97 formes identiques », espèces ajoutées, piège de la mesure sur la mauvaise photo) ; section datée sur la haie (pourquoi, rendu `hedgeShape.ts`, édition, grilles de familles).
- `2_maison/2_0_format-house-json.md` - mise à jour datée : `kind: "hedge"`, `length`, `width`, segment plutôt que polyligne.
- `index.md` - résumé et date des deux pages.

Hors wiki : `docs/house-json.md` (spécification du format) complété pour la haie.

## [2026-09-29] update | jardin : trunk.forkAt (cépée) et le figuier

**Déclencheur** : skill `garden-species` sur une photo de figuier adulte ; la silhouette en cépée était impossible avec les champs existants.

**Pages modifiées** :
- `2_maison/2_2_jardin.md` - champ `forkAt` dans la liste de la recette ; section datée : impasse (`trunk.height` fixait aussi le bas du houppier), extension, tiges qui entrent dans le feuillage, piège du test (cylindre sans sommets intermédiaires), `fig.json` aux couleurs mesurées puis refoncées.
- `index.md` - résumé et date de la page jardin.

## [2026-09-28] update | jardin : ombres de contact, ombres du soleil, reflet de la piscine

**Déclencheur** : suite de la session « jardin » (après 4437e09) : ombres et reflets des éléments du jardin.

**Pages modifiées** :
- `2_maison/2_2_jardin.md` - section « Ombres, reflet, lampes » : ombre de contact instanciée en couche de décor, sonde de reflet figée (400 ms de calme, 3 à 7 ms mesurés, pixels de la sonde vérifiés), `noLamps` sur les matières du jardin.
- `1_architecture/1_5_scene-3d.md` - ajout daté sous le cadrage des ombres du 2026-09-12 : le jardin entre dans le cadre, retour partiel vers le cadrage large écarté alors (texel 0,87 → 2,41 cm), netteté des ombres de la maison non jugée, parade prévue.
- `index.md` - résumé de la page jardin prolongé.

## [2026-09-28] update | jardin : il suit le style de rendu

**Déclencheur** : suite de la session « jardin » (après 16cbb8a) : l'utilisateur veut que le jardin suive le style (cyberpunk, maquette, candy, maison hantée ; réaliste et nature inchangés).

**Pages modifiées** :
- `2_maison/2_2_jardin.md` - section « Le jardin suit le style de rendu » : `GardenLook` optionnel dans le look d'un style, une teinte par élément tirée par la graine (dans la clé des tranches, d'où le néon par tranche), espèce en ombrage seul sous une palette, feuillage restant du style (la grande masse part la première sur une famille générique), réglages jugés sur capture (émission cyberpunk 0,55 → 0,3, teintes hantées assombries).
- `index.md` - résumé de la page jardin prolongé.

## [2026-09-28] update | jardin : arbres, buissons, pierres posés à la main, style facetté, espèces et saisons

**Déclencheur** : session « jardin » (arbre de travail non commité après cf60c7d, dossier `_generated-ai-doc/sessions/2026-09-28-jardin/`). Récit du thread principal croisé avec le diff, les fichiers neufs et le journal de session ; tests non relancés par le scribe.

**Pages créées** :
- `2_maison/2_2_jardin.md` - page dédiée : le sujet traverse format, REST, store, UI, scène, recettes et une skill ; les pages existantes n'en reçoivent qu'un renvoi. Porte les décisions (végétation réautorisée pour ce qu'on plante, hauteur seule, espèce inconnue = famille, arme qui reste levée, terrain seul), le chemin du style (lisse → MegaKit Quaternius retiré → Pure Poly écarté → facetté procédural), le générateur d'espèces et ses deux premières versions ratées, la skill `garden-species`, `photo-palette.mjs`, la saison.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - section datée `site.garden[]`.
- `1_architecture/1_3_protocole-rest-ws.md` - section datée : trois routes `/api/house/garden`.
- `1_architecture/1_4_app-web.md` - section datée : jardin dans le store `house`, `sceneSeason`.
- `1_architecture/1_5_scene-3d.md` - section datée : `GardenLayer`, API de `HouseScene`, priorité au `pick`, saison ; renvois ajoutés sous les sections 2026-09-15 (quinquies) et (duodecies), dont la décision « pas de végétation » est levée (remplacement signalé, rien d'effacé).
- `4_ui/4_0_langage-visuel.md` - section datée : cinq icônes du jardin.
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : « Régler la maison et le jardin », section Jardin, `GardenPanel`, `HomeView`.
- `4_ui/4_2_theme-et-langues.md` - section datée : `kasbah.sceneSeason`, clés `render.season*` et `garden.*`.
- `6_faq/6_0_pieges-outillage.md` - trois entrées : Vite qui garde une transformation lue en pleine écriture, Google Drive « quota » (2 009 octets), `find` du panneau et l'insécable.
- `SCHEMA.md` - ligne d'arborescence de `2_maison/` (jardin).

**Décision remplacée** : `1_5_scene-3d.md`, 2026-09-15 « pas de mobilier, pas de végétation » → le 2026-09-28, végétation posée par l'utilisateur autorisée (mobilier toujours exclu). Décidé par l'utilisateur d'après le récit ; aucune contradiction code/wiki ouverte.

**Trous signalés** : `docs/house-json.md` (référence humaine du format, hors `doc/`) ne décrit pas encore `site.garden[]`.

**Index** : mis à jour (9 lignes, dont 1 nouvelle).

## [2026-09-28] update | ouvrants : l'appui vise ; contrôles du panneau qui gardaient l'appareil précédent

**Déclencheur** : demande de l'utilisateur (viser d'un appui sur la vignette), puis revue demandée des autres contrôles du panneau après le bug de `CoverControl`. Tests rouges puis verts pour chaque cas, vérifié dans la preview.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - complément daté : l'appui envoie l'ouvrant à l'endroit touché (liste et panneau), ce qui remplace « un appui ne commande rien » ; risque restant dans la liste ; tests `CoverPill.test.ts`.
- `6_faq/6_1_pieges-runtime.md` - entrée : contrôle réutilisé d'un appareil à l'autre (`ClimateControl`, `LightControl`, `SensorCard` après `CoverControl`), ce qui est sain, `:key` écartée, leçon.

**Index** : mis à jour (2 lignes).

## [2026-09-28] update | ouvrants : vignette verticale (liste et panneau), pastille « placé » vers la 3D

**Déclencheur** : retour de l'utilisateur — les curseurs horizontaux de la vue Ouvrants se lisaient à l'envers d'un volet. Vérifié dans la preview (1171 / 780 / 375 px, deux thèmes, fr / en) ; 157 tests des composants et vues verts.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : `CoverPill` (glissement relatif, lames, portail horizontal, repère perso, inconnu), slot `leading` de `RoomBands`, retour à la ligne sur téléphone, panneau à touches empilées, inclinaison = angle des lames, piège `grid-row: span 2`, capacités réactives de `CoverControl` (bug de changement d'ouvrant), suppression de `.cover-slider`, pastille « placé » qui ouvre la 3D.

**Index** : mis à jour (1 ligne).

## [2026-09-28] update | TENS : intensités visées au lancement, plusieurs favoris par programme

**Déclencheur** : demande de l'utilisateur — régler les intensités avant de lancer et les garder dans le favori (rappel en un clic), puis plusieurs favoris par programme quand les réglages diffèrent. `tens.test.ts` et `TensView.test.ts` (37) verts, vérifié dans la preview (1600 / 1100 px, deux thèmes).

**Pages modifiées** :
- `3_plugins/3_21_actitens-tens.md` - section datée : curseurs d'intensité visée, `startProgram(…, targets)` qui passe par la file, `TensFavorite` étendu et `favoriteKey`, étoile à trois états, `lastLaunch.key` / `currentKey`, tuile sur deux lignes, tests.

**Index** : mis à jour (1 ligne).

## [2026-09-28] update | Page Musique : dernière écoute reprise après redémarrage, genres Mixcloud, la file sous toutes les sources

**Déclencheur** : arbre de travail non commité après c6fe7c1 ; l'utilisateur constate que le rechargement de la page perdait la lecture locale, demande que la position soit retenue « à chaque action », et choisit un filtre de genres à trois états. Code relu, `lastPlayed.test.ts` (4) et `localPlayer.test.ts` (2) relancés : verts.

**Pages modifiées** :
- `1_architecture/1_6_lecteur-musique.md` - section datée : `music/lastPlayed.ts`, `.state/music.json`, quand la dernière écoute s'écrit (lancement, file, transfert, position à 15 s sauf action ou pause, `music.stop()`) et quand elle s'oublie (fin de file seule), routes `GET /last` et `POST /resume`, tests.
- `1_architecture/1_4_app-web.md` - section datée : `localPlayer` garde file (`kasbah.music.localQueue`) et position (`kasbah.music.localPosition`), état `restored`, `barSession` synthétisée ; transport `musicLast` / `musicResume`, `MixcloudMix.genres`.
- `3_plugins/3_20_mixcloud.md` - sous-section datée de « Côté web » : pastilles de genres, règle du filtre à trois états (choix de l'utilisateur), ordre figé, file = liste filtrée, durée sur les tuiles.
- `4_ui/4_1_navigation-et-panneaux.md` - section datée (bis) : barre en pause sur la dernière écoute et règle `selectedLast`, `GenrePills` (piège `inline-flex` sur la ligne de base), rangée de filtres (largeur constante, 44 px réservés, fondus, « Tout remettre » sans bordure, grisée sur Playlists/Suivis), badge de durée, bug de la file invisible hors YouTube Music corrigé (`QueueList.vue`, sources en `v-show`).
- `5_setup/5_1_configuration-env.md` - section datée : `MUSIC_STATE_FILE`.
- `6_faq/6_0_pieges-outillage.md` - récidive ajoutée à l'entrée du 2026-09-24 (Vite qui sert des styles périmés, redémarrage nécessaire) et serveurs de dev en watch partagés entre sessions.

**Signalé, non tranché** :
- ~~`MUSIC_STATE_FILE` absente de `apps/server/.env.example`~~ : ajoutée dans la foulée.
- ~~Barre sur une dernière écoute : précédent / suivant / stop allumables sur une enceinte restée en pause sur le flux mort~~ : corrigé dans la foulée (`!resume` dans `MusicPlayerBar.vue`), 4_1 mis à jour.
- Aucune mesure en direct rapportée (reprise sur une vraie enceinte après redémarrage, latence du `/resume`).

**Index** : mis à jour (6 lignes).

## [2026-09-28] update | Houle de la piscine au vent réel, rose du vent retournée, cap de la maison

**Déclencheur** : l'utilisateur constate que la houle ne suit pas le vent, puis que la rose de la Météo contredit la piscine.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - complément daté : repère du vent (`uWaterWind`), phase `k·p − ωt`, amplitude selon `windKmh`, cap `origin.heading` retranché pour soleil, pluie et houle.
- `4_ui/4_1_navigation-et-panneaux.md` - complément daté : la rose pointe sous le vent (`windDirDeg + 180`).

**Index** : mis à jour (1 ligne).

## [2026-09-28] update | Vue Météo : la lune dans les 7 jours, « Aujourd'hui » en entier

**Déclencheur** : demandes de l'utilisateur, la phase de la lune dans la semaine et « Aujourd'hui » tronqué.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - complément daté : disque par jour (`MoonDisc.vue`), colonne du jour en `minmax(40px, 72px)`, « Auj. » entre 760 et 1099 px.

**Index** : inchangé (page déjà datée du jour).

## [2026-09-28] update | Vue Météo : la lune

**Déclencheur** : demande de l'utilisateur, avoir les informations sur la lune dans la vue Météo.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : lune calculée localement (`lib/moon.ts`), disque de phase, lever/coucher, prochaine pleine/nouvelle lune, carte renommée « Soleil et lune », arc resserré en mode large.

**Index** : 1 ligne (date de la page).

## [2026-09-27] update | Agenda : liserés retirés, passé estompé, agendas réordonnables

**Déclencheur** : demandes de l'utilisateur sur la vue Agenda (liserés à gauche des événements, événements passés, ordre des agendas).

**Pages modifiées** :
- `3_plugins/3_22_agenda.md` - route `PUT /calendars/order` (liste complète exigée), ordre = celui du fichier, flèches de la carte Réglages.
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : pastilles sans liseré, `isPast` et opacité 0,45, ordre des agendas suivi par la vue.

**Index** : mis à jour (2 lignes, résumés complétés ; dates déjà du jour).

## [2026-09-27] update | Vue Météo : bande de tendance des 24 heures

**Déclencheur** : demande de l'utilisateur, l'évolution des 24 heures se lisait mal avec les seules icônes et les chiffres.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : courbe des températures teintée sur une échelle fixe, barres de pluie, nuit en fond, points min/max, graduations 1 mm / 4 mm en pastille.

**Index** : inchangé (la date de la page était déjà celle du jour).

## [2026-09-27] update | Plugin Agenda et vue Agenda

**Déclencheur** : demande de l'utilisateur, une vue Agenda qui affiche l'agenda Google partagé de la famille (compte famille), mois / semaine / jour, lecture seule.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : vue Agenda (rail, barre, mois, grille horaire, fiche, préférences par poste).

**Pages créées** :
- `3_plugins/3_22_agenda.md` - le plugin : choix iCal secrète vs OAuth, stockage de l'adresse, lecture des flux, déroulé `ical.js`, routes, carte Réglages, vérification.

**Index** : mis à jour (2 lignes).

## [2026-09-27] update | Shaders hors du fil principal, garde-fou en « auto » seulement, météo simulée à 20 s

**Déclencheur** : changement de style qui mettait quelques secondes à se sélectionner, garde-fou qui écrasait une qualité forcée et descendait trop vite sur le PC, ciel recalculé chaque seconde en simulation.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section datée : `compileBeforeShow` (2,5-5,5 s → 0,47 s d'ancienne image), garde-fou en « auto » seulement (`autoQuality`), budget 33 ms et fin de la règle iGPU (remplace le point 1 du 2026-09-15 et les 25 ms du 2026-09-25 bis, décision utilisateur), rappel qualité basse = eau figée et sans chauves-souris, ambiance dédoublonnée.
- `3_plugins/3_0_simulation-mock.md` - section datée : météo publiée toutes les 20 s réelles, `TickCtx.timeScale`.

**Index** : mis à jour (2 lignes).

## [2026-09-26] update | Pièce mise en valeur : le reste s'efface en dégradé

**Déclencheur** : l'utilisateur trouvait l'estompage des autres pièces « un peu brutal ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - correction datée sous la section (undecies) : `kasbahRoomDistance`, `FEATHER_M` = 2 m, piège du grain rendu impossible.
- `6_faq/6_1_pieges-runtime.md` - mise à jour du piège « sel et poivre ».
- `index.md` - résumé de la page 1_5 (masque en dégradé).

**Index** : résumé 1_5 retouché (date déjà du jour).

## [2026-09-26] update | Relief : l'affinage du maillage suit le changement de plafond

**Déclencheur** : dents de scie au pied d'une façade de la maison réelle, sous une terrasse
d'étage (terrain monté contre le RDC).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - correction datée sous la section relief : `refinedCells` compare les plafonds des deux côtés d'une arête ; mesure 39 cm → 0 cm.

**Index** : inchangé (page déjà datée du 2026-09-26).

## [2026-09-26] update | Velux sur un versant : emprise unique (`surfaceFootprint`), cap de la descente, UV du toit

**Déclencheur** : suite de la session du jour sur les Velux ; l'utilisateur demande les UV du toit à
pentes et de traiter les limites notées dans le wiki. Décision : sur un versant, le cap suit la pente.

**Pages modifiées** :
- `2_maison/2_1_geometrie.md` - `surfaceFootprint` (trou, rectangle, validation, pose, cotes), retrait de `slopeDeg`, bug de sens de `defaultRoofYaw` ; remplace les limites de la section précédente.
- `1_architecture/1_5_scene-3d.md` - UV du toit à pentes (`faceFrame`), cotes de la scène sur l'emprise.
- `2_maison/2_0_format-house-json.md` - `yaw` d'une `roof-window` ignoré sur un versant, validation sur la longueur vue du ciel.
- `4_ui/4_1_navigation-et-panneaux.md` - champ Orientation grisé pour un Velux sur un versant.

**Index** : inchangé (pages déjà datées du jour).

## [2026-09-26] update | Toit à pentes et Velux : trous rebouchés, vitre inversée, longueur le long de la pente

**Déclencheur** : avertissement `mergeGeometries` à chaque chargement de la démo, puis constats de
l'utilisateur dans la preview (le Velux ne suit pas la pente, il est sous les panneaux, la vitre
n'est ni dans l'ouverture ni de la même taille).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - fusion du toit percé (repli sans trous), ordre d'Euler ZXY de la vitre et de la poignée, vitre centrée sur le versant, toit à pentes sans UV (non traité).
- `2_maison/2_1_geometrie.md` - convention « `height` d'un Velux = le long de la pente », `planLength`, trou / `OpeningRect` / `openingCentre` / cotes, ce qui reste en longueur non raccourcie, limite du cap.
- `2_maison/2_0_format-house-json.md` - sens de `height` pour `roof-window`, un Velux déplacé hors d'un champ de panneaux.

**Index** : inchangé (pages déjà datées du jour).

## [2026-09-26] update | Relief du terrain : `site.relief`, maillage drapé, éditeur « Modeler le terrain », import IGN

**Déclencheur** : demande de l'utilisateur d'éditer la topologie du terrain dans la vue Maison
(parcelle réelle : bosses de tailles variées, talus). Livré puis affiné en plusieurs
passes le même jour : pinceau retiré (un point bouge seul), terrain qui touche les murs (écrêtage
sous les planchers au lieu d'un aplanissement), saisie d'altitude, flèches, historique, vues,
maison estompée, poignées estompées en profondeur, lissage monotone (Catmull-Rom dépassait).

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - `site.relief` (format en rangées de cm, retrait du relief plat, `deviceFloorZ` sur le terrain sous l'appareil).
- `2_maison/2_1_geometrie.md` - `relief.ts` : cubique monotone, emprises écrêtées, palier des bassins.
- `1_architecture/1_5_scene-3d.md` - maillage `terrain.ts` (affinage, piège earcut et points alignés), `updateRelief`, éditeur et son historique, fondu des poignées, concentration, vues cardinales.
- `1_architecture/1_3_protocole-rest-ws.md` - `PUT /api/house/relief` ; import IGN direct depuis la tablette.
- `4_ui/4_1_navigation-et-panneaux.md` - `ReliefPanel`.
- `docs/house-json.md` (référence hors wiki) - champ `relief`.

**Index** : mis à jour (5 lignes).

## [2026-09-25] update | Styles revus, chauves-souris, tap sur un mur, ombre en fondu, iso en perspective étroite

**Déclencheur** : retours de l'utilisateur sur sa maison réelle. Candy éblouissant et hantée trop
sombre de jour, nature trop « pierre », chauves-souris demandées, vue iso qui paraît déformée, tap
qui traverse les murs, ombre qui ne suit pas le fondu d'un niveau, puis toit resté vert en réaliste.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section 2026-09-25 (quattuordecies) : styles candy / hantée /
  nature (matière `siding`, toits plats végétalisés), `effects/bats.ts`, `roomOfWallHit`, fondu dans
  la passe d'ombre, isométrie en perspective à champ étroit (20°). Renvoi daté ajouté dans la section
  isométrie du 2026-09-18 (6), qui est remplacée.
- `6_faq/6_1_pieges-runtime.md` - piège : une clé optionnelle de `ScenePalette` survit au
  changement de style (`resolveSceneTheme` étale l'ancien thème).

**Index** : inchangé (les deux pages y sont déjà datées du 2026-09-25).

## [2026-09-25] update | Aucun mur ne descend avec le plafond (marche en haut des cloisons d'un local bas)

**Déclencheur** : défaut de rendu signalé par l'utilisateur (diagonales en haut des murs d'un petit
local) — une cloison basse face à sa moitié voisine plus haute.

**Pages modifiées** :
- `2_maison/2_1_geometrie.md` - mise à jour datée : `wallHeight` = max(plafond, niveau) pour tous les
  murs (remplace la règle « cloison au plafond » du 2026-09-12), note sur le refus « plus bas » de
  `trimCandidate`.
- `2_maison/2_0_format-house-json.md` - mise à jour datée : `height` ne monte plus aucun mur ; le
  local concerné ne déclare plus de hauteur.

**Index** : mis à jour (2 lignes).

## [2026-09-25] update | Plugin local TENS actiTENS mini (Web Bluetooth)

**Déclencheur** : nouvelle fonctionnalité de la session (arbre non commité) — pilotage de
l'électrostimulateur depuis le navigateur, protocole BLE rétro-conçu par capture, validé sur l'appareil.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée : entrée de rail locale (`NavItem.local`,
  `visibleNavItems`), bloc Réglages « Sur cet appareil », vue TENS et « rien ne bouge ».

**Pages créées** :
- `3_plugins/3_21_actitens-tens.md` - premier plugin LOCAL : pourquoi hors serveur, protocole (services,
  trames, CRC-8/MAXIM, jeton, codes de refus 05/11/33), programmes = formes d'onde, file d'intensité,
  appairage (mode bleu, Windows, drapeau Chrome `getDevices`), tests par simulateur, points ouverts.

**Index** : mis à jour (2 lignes).

**Remarques** : détail brut du protocole et captures dans `_generated-ai-doc/tens/` (hors dépôt). Voyant
rose apparu une fois pendant les essais, cause inconnue — tracé en console pour la prochaine fois.

## [2026-09-25] update | Ombre fantôme de l'étage après le voile : le relevé des ombres se compte en images

**Déclencheur** : arbre de travail non commité après 5e2ef15 (`three/HouseScene.ts`, `three.test.ts`) ;
capture de l'utilisateur (RDC affiché, étage masqué, son ombre sur la pelouse).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section (terdecies) : cause (fenêtre de temps expirée pendant
  `holdFrames`), `shadowFramesPending` / `SHADOW_MIN_FRAMES`, relevé en fin d'envol, exclusion du
  garde-fou de qualité, vérifié / non vérifié ; renvoi ajouté dans la section (decies) n° 1.
- `6_faq/6_1_pieges-runtime.md` - entrée « ombre fantôme d'un étage masqué après le voile de
  chargement » et sa leçon (invalidation en temps vs compte d'images).

**Remarques** : défaut non reproduit sur la maison démo avant correctif, cause établie par lecture du
code — à confirmer chez l'utilisateur. Commentaires de `HouseScene.ts` (l. ~346 et ~649) qui citent
encore `compileAsync`, alors que `prepare` ne l'utilise plus (l. ~688, et section (ter) du wiki) :
signalé, non tranché. Bloc « Leçon / Source » dupliqué à la fin de l'entrée FAQ précédente (pilule qui
se réaffiche pleine) : signalé, laissé en l'état.

**Index** : mis à jour (2 lignes).

## [2026-09-25] update | Pilules de niveau en fondu ; seuil du fondu des étages décalé ; la boucle dessine la fin d'une tween

**Déclencheur** : arbre de travail non commité après a1a837a (`three/HouseScene.ts`,
`core/renderLoop.ts`, `markers/DeviceMarker.ts`, `three.test.ts`) ; demande utilisateur (pilules qui
basculaient d'un coup pendant l'envol) et deux défauts signalés par l'utilisateur en vérifiant.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section (duodecies) : `fadePills` (WeakMap, course unique de
  700 ms, phases de sortie et d'entrée, fin forcée d'un fondu en cours), `setPillFade`, marqueurs qui
  montent avec leur étage (`!ghost`, raison `CSS2DRenderer`), lampes en vol, seuil + 0,03 m mesuré,
  correctif de la boucle ; notes de renvoi dans (nonies) et dans « Rendu à la demande » / « Marqueurs ».
- `6_faq/6_1_pieges-runtime.md` - complément « deuxième occurrence » à l'entrée « limite de masque
  posée sur une surface » (règle consolidée : plan comme hauteur) ; nouvelle entrée « une pilule qui
  finit son fondu se réaffiche pleine ».

**Contradiction relevée** : section (nonies) de `1_5` disait « les marqueurs se masquent toujours
immédiatement » ; le code fait désormais `nodes.markers.visible = !ghost`. Non effacée : annotée en
italique, renvoi vers (duodecies).

**Index** : mis à jour (2 lignes).

## [2026-09-25] update | Opacité par matière « opaque par défaut » ; la pièce qu'on regarde se détache

**Déclencheur** : arbre de travail non commité après f059001 (`three/core/roomFocus.ts` nouveau,
`core/levelFade.ts` réécrit, `HouseScene.ts`, `core/levelLight.ts`, `effects/water.ts`,
`three.test.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section (decies) : pourquoi ni `transparent: true` ni `alphaHash`
  partout, `materialOpacity` (uniform dans `userData`, clone), injection avant `alphatest_fragment`,
  IGN si `OPAQUE` / alpha sinon, mesures A/B/A/B et piège du premier passage, non mesuré sur GPU à
  tuiles ; section (undecies) : masque `roomFocus.ts`, constantes, piège de la limite sur le mur,
  contrepartie ~42 cm, recette de diagnostic ; renvoi ajouté dans (nonies) (Bayer remplacée).
- `6_faq/6_1_pieges-runtime.md` - entrée « limite de masque posée sur une surface ».
- `4_ui/4_1_navigation-et-panneaux.md` - complément d'une phrase sous « sélectionner un appareil
  n'allume pas sa pièce ».

**Contradiction** : aucune entre wiki et code. La section (nonies) décrivait une trame de Bayer et
une injection derrière `clipping_planes_fragment` : vrai en f059001, remplacé ici (renvoi posé, rien
effacé). Code : l'en-tête de `core/roomFocus.ts` dit encore « élargi de l'épaisseur d'un mur », alors
que `HouseScene.highlightRoom` ajoute la marge de 0,12 m — commentaire à rafraîchir, signalé.

**Index** : 2 lignes complétées (1_5, 6_1).

## [2026-09-25] update | Les étages s'envolent et s'effacent en trame au lieu de disparaître

**Déclencheur** : arbre de travail non commité après 66a72f6 (`three/core/levelFade.ts` nouveau,
`HouseScene.ts`, `core/tween.ts`, `core/levelLight.ts`, `effects/water.ts`, `three.test.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section 2026-09-25 (nonies) : `liftTo` (8 m, 450 ms, easeIn /
  easeOut, état par clé, `get()` relu, bascule immédiate sans renderer), ombres et `padLamps` en fin
  de vol, fantôme non animé ; fondu tramé Bayer (pourquoi pas de transparence : programme `OPAQUE`),
  seuil `topBelow`, limites (pick en vol, quadrillage de près), vérifications.

**Non modifiée** : `4_ui/4_1_navigation-et-panneaux.md` — son passage sur `applyLevelFocus` (rien
masqué sans focus) reste exact.

**Contradiction** : aucune. Les sections antérieures de `1_5` qui disent qu'`applyLevelFocus`
« masque » les étages restent vraies quant à l'état final ; le masquage est désormais précédé d'un vol.

**Index** : 1 ligne complétée (1_5).

## [2026-09-25] update | Brume basse de l'aube et de la nuit ; météo forcée qui ne gèle plus

**Déclencheur** : arbre de travail non commité après 5f4d9c0 (`three/core/heightMist.ts` nouveau,
`core/levelLight.ts`, `effects/water.ts`, `HouseScene.ts`, `three.test.ts`,
`composables/useHouseScene.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section 2026-09-25 (septies) : brouillard de hauteur intégré
  en forme fermée, injection derrière `fog_fragment`, matières du dehors seules (premier essai sur
  toutes écarté), dosage `mistAmount`, couleur `applyMist`, vérifications et aube non vérifiée ;
  section (octies) : `Fog` permanent rejeté à `NO_FOG_M`, `watchThrottled` 100 ms, chiffres avant /
  après, indicateur « en cours » non fait ; note sur la section du 2026-09-16.
- `6_faq/6_1_pieges-runtime.md` - entrée « le brouillard qui apparaît recompile tout ».
- `6_faq/6_0_pieges-outillage.md` - entrée « `import()` depuis la console après un HMR » (récit du
  thread principal, non reproduit).

**Contradiction** : la section du 2026-09-16 (`1_5`) disait « `applySky` pose un `Fog` », sous-entendu
à la demande ; laissée en place, annotée par la note de la section (octies).

**Index** : 3 lignes complétées (1_5, 6_0 datée 2026-09-25, 6_1).

## [2026-09-25] update | Sélection d'appareil sans surbrillance de pièce ; puits de lumière jamais allumés

**Déclencheur** : arbre de travail non commité après a2e4983 (`views/HomeView.vue`,
`three/builders/buildHouse.ts`, `three/three.test.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - remplacement daté sous « Le cadrage suit la sélection la plus
  fine » (l'appareil n'allume plus sa pièce, `highlightRoom(null)` avant `focusDevice`, pourquoi) ;
  correction dans la section 2026-09-25 (quater) : vitrages `host === 'floor'` sans clone ni `roomId`
  (carré blanc de `puits-salon` constaté en preview), test étendu.
- `4_ui/4_1_navigation-et-panneaux.md` - sous-section 2026-09-25 (règle UI et sa raison) ; note sur
  la phrase du 2026-09-07 « la surbrillance de pièce suit si l'appareil change de pièce », devenue
  fausse (conservée, annotée).

**Contradiction** : la phrase du 2026-09-07 (`4_1`, mode Déplacer) et celle du 2026-09-15 (`1_5`,
« un appareil surligne sa pièce sans la cadrer ») décrivaient l'ancien comportement ; laissées en
place, annotées par un renvoi daté.

**Index** : 2 lignes complétées (1_5, 4_1 datée 2026-09-25).

## [2026-09-25] update | Vue 3D : tache de lumière au sol sous les plafonniers

**Déclencheur** : arbre de travail non commité après 26bc1b2 (`markers/markers.ts`, `three.test.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section 2026-09-25 (sexies) : `lamp-pool` (lampes d'intérieur
  `mount: 'ceiling'`), constante `POOL`, opacité liée au halo du style, hauteur recalée par
  `onBeforeRender`, pourquoi pas une `SpotLight` (`padLamps`, `levelLight.ts`), limite (non découpée
  par la pièce), vérifications ; aucun coût GPU mesuré.

**Index** : 1 ligne complétée (1_5, date inchangée).

## [2026-09-25] update | Vue 3D : étalonnage colorimétrique par l'heure

**Déclencheur** : arbre de travail non commité après 5a6de4a (`core/post.ts`, `styles/{types,tuning,
tuning.test,realistic,nature}.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section 2026-09-25 (quinquies) : `GradeLook` et sa formule,
  application dans `VignetteOutputPass` par uniforms (gamma inversé, aucun changement de programme),
  `hourGrade` (aube / couchant selon l'azimut, nébulosité), styles concernés, transmission par
  `applyTuning`, limite en qualité basse (pas de chaîne, pas d'étalonnage), vérifications ; l'aube
  n'est pas vérifiée à l'œil et aucun coût GPU n'a été mesuré.

**Index** : 1 ligne complétée (1_5, date inchangée).

## [2026-09-25] update | Vue 3D : les fenêtres d'une pièce éclairée s'allument la nuit

**Déclencheur** : arbre de travail non commité après 79dd21a (`apps/web/src/three/HouseScene.ts`,
`builders/buildHouse.ts`, `three.test.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section 2026-09-25 (quater) : verre cloné par pièce dans
  `buildLevel`, `syncWindowGlow` (couleur moyenne des lampes, `WINDOW_GLOW` 0,65, `WINDOW_LIT_OPACITY`
  0,6, nuit seulement), points d'appel, réglage à l'œil (0,45 / 0,9 écartés), test ; piste ouverte :
  erreurs `mergeGeometries … index attribute` au chargement de la démo, préexistantes, cause non établie.

**Index** : 1 ligne complétée (1_5, date inchangée).

## [2026-09-25] update | Vue 3D : shaders précompilés sous un voile de chargement

**Déclencheur** : « précalculer les shaders ne fait rien perdre ? » puis la demande d'un indicateur de
chargement travaillé ; arbre de travail non commité après 4b38557.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section 2026-09-25 (ter) : `prepare` et ses étapes, `holdFrames`,
  `shadersReady` (pas `compileAsync`), le voile `SceneLoader` (vue éclatée, file d'étapes, minimums,
  commandes masquées au premier chargement), mesures cache froid / chaud.
- `6_faq/6_1_pieges-runtime.md` - trois entrées : image rendue avant la fin des compilations,
  `compileAsync` qui ne se résout jamais, `<Transition>` invisible pendant une compilation.

**Index** : inchangé (les deux pages y sont déjà datées du 2026-09-25).

## [2026-09-25] update | Scène 3D en une seule passe, et une chaîne d'effets sans MSAA superflu

**Déclencheur** : « la vue 3D rame » (cible iGPU, mode éco) ; arbre de travail non commité après
71ad357 (`apps/web/src/three/core/levelLight.ts`, `HouseScene.ts`, `core/layers.ts`, `builders/materials.ts`,
`effects/water.ts`, `markers/*.ts`, `three.test.ts`, `components/home/SceneDebug.vue`, `core/post.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - encarts « remplacé » sous la décision des passes (2026-09-15
  sexies) et sous la mise à jour 2026-09-18 (3) ; nouvelle section 2026-09-25 (masque de hauteur,
  `noLamps`, `padLamps`, ombres au changement de niveau, mesures iGPU).
- `6_faq/6_1_pieges-runtime.md` - entrée « changer de niveau fige la 3D deux secondes ».
- `1_architecture/1_5_scene-3d.md` - section 2026-09-25 (bis) : MSAA de la seule scène, vignette
  fusionnée dans la sortie, garde-fou à 25 ms, mesures iGPU.
- `6_faq/6_1_pieges-runtime.md` - entrée « une vignette coûte 2,8 ms : le composer a cloné la cible MSAA ».

**Index** : mis à jour (2 lignes).

## [2026-09-24] update | Eau de la piscine : caustiques par réfraction, absorption, Fresnel

**Déclencheur** : récit du thread principal et arbre de travail non commité après 8700769
(`apps/web/src/three/effects/water.ts`, `HouseScene.ts`, `builders/buildHouse.ts`, `three.test.ts`).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - encart « remplacé en partie » sous la mise à jour du
  2026-09-18 (8) (houle à trois ondes et caustiques émissives ne sont plus vraies ; portes,
  10 Hz, clé de programme restent) ; nouvelle sous-section 2026-09-24 : houle d'une vingtaine
  d'ondes tirées (pourquoi : réseau trop régulier), `WaterCaustics` (grille 256² instanciée 3 × 3,
  cible 512² au quart, rapport d'aires), modulation de `directDiffuse`, `setWaterSun` et paroi face
  au soleil, attribut `waterDepth` et absorption, Fresnel, `createWaterUniforms`, coût mesuré avec
  ses conditions, clearwater écarté tel quel, limites connues.

**Index** : mis à jour (1 ligne).

**À signaler** : coût non mesuré sur le GPU intégré. (Le commentaire d'en-tête de `water.ts`
annonçait une passe de 256 × 256 px au lieu de 512 × 512 : corrigé avant commit.)

## [2026-09-24] update | Lecteur du panneau appareil, qualité d'une radio, style scoped périmé

**Déclencheur** : récit du thread principal (session du 2026-09-24) et arbre de travail non commité
après 553ff9c : le lecteur du panneau vue 3D aligné sur la barre Musique, qualité des radios.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - sous-section 2026-09-24 : rangée de sept touches (tailles
  fixées, 32 px de débordement aux tailles Vuetify), grisage direct / repos, suivant / précédent /
  répéter par la file serveur (avant : `media_player.next` à une enceinte sans rien à sauter),
  `useMusicSession`, qualité au milieu des temps, pied « Page Musique / Ouvrir » ; précédent /
  suivant ne disparaissent plus sans `track_skip`.
- `3_plugins/3_19_radio.md` - route `GET /playing`, section « Qualité d'une radio » (annuaire seule
  source, mémoire jamais effacée ni persistée, filtre côté UI sur le nom du direct, stations manuelles
  sans qualité).
- `6_faq/6_0_pieges-outillage.md` - entrée : Vite de l'utilisateur (5173) servant un bloc de style
  scoped périmé ; diagnostic par l'URL du module de style, `touch` du `.vue`.

**Index** : mis à jour (3 lignes).

## [2026-09-24] update | Plafonnier 3D : vitesse, sens et flux d'air

**Déclencheur** : demande de l'utilisateur (pales à la vitesse et au sens choisis, flux d'air bleu ou
rouge sous le ventilateur), puis retour visuel (particules « comme de la pluie » → anneaux inspirés
de l'onde sonore).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - sous-section 2026-09-24 : rang de vitesse, plafond d'1 tr/s
  (20 Hz, symétrie à 3 pales), sens `forward` = été supposé non vérifié, `FanAirflow` en anneaux,
  essai particules écarté et pourquoi.

**Index** : mis à jour (1 ligne).

## [2026-09-24] update | Vue Météo : recherche de lieu et favoris

**Déclencheur** : demande de l'utilisateur (voir la météo d'un autre lieu, favoris en pastilles,
maison par défaut, dernière sélection gardée).

**Pages modifiées** :
- `3_plugins/3_10_open-meteo.md` - routes `places` (géocodage, `results` absent sans résultat) et
  `at` (état complet, fuseau, cache par position), 400 explicites, limites (air hors d'Europe, AROME).
- `4_ui/4_1_navigation-et-panneaux.md` - barre de lieux, état par tablette, heures dans le fuseau du
  lieu, radar qui suit, dispositions étroites.

**Index** : mis à jour (2 lignes).

## [2026-09-24] update | TaHoma : arbitrage `definition.states`, recette, sonde collante ; retry de l'hôte

**Déclencheur** : l'utilisateur tranche la contradiction du jour, et signale un plugin TaHoma resté
en « réappairage » jusqu'à un redémarrage du serveur de développement.

**Pages modifiées** :
- `3_plugins/3_4_somfy-tahoma.md` - piège n° 1 reformulé (« pas une source fiable »), contradiction
  close en arbitrage ; recette 8788 marquée périmée en place ; nouvelle sous-section sur la sonde
  `/apiVersion` qui collait après un redémarrage de la box (corrigé), et la limite côté hôte.

- `1_architecture/1_2_serveur-et-plugins.md` - l'hôte retente un démarrage raté (hors `NEEDS_PAIRING`).

**Index** : mis à jour (1 ligne).

## [2026-09-24] update | Volets solaires TaHoma : luminosité, batterie, mode discret

**Déclencheur** : question de l'utilisateur (les volets solaires ont des capteurs et un mode discret
dans l'appli Somfy), puis retours sur la fiche et la vue Ouvrants.

**Pages modifiées** :
- `3_plugins/3_4_somfy-tahoma.md` - panneau = capteur de luminosité lié au volet, historique max
  heure/jour/mois tenu par le plugin (écritures sérialisées), batterie, mode discret `lowspeed`
  mesuré ; question ouverte (0 lx par temps couvert) ; **contradiction** sur `definition.states`
  « toujours vide » (à arbitrer) ; recette `KASBAH_PLUGINS` périmée.
- `1_architecture/1_1_contrat-appareils.md` - `cover` : `quiet` / `cover.set_quiet` / `quiet`,
  `battery` / `batteryPct`, capteur lié par `meta.linkedTo`.
- `4_ui/4_1_navigation-et-panneaux.md` - fiche du volet (mode discret, batterie, graphe), cartes de la
  vue Ouvrants sur trois lignes, curseur pleine largeur.
- `3_plugins/3_0_simulation-mock.md` - volet solaire de démo.

**Index** : mis à jour (4 lignes).

## [2026-09-23] update | Automatisations : ligne de liste enrichie

**Déclencheur** : retour utilisateur — sans panneau latéral, la liste a de la place pour plus d'infos.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - ligne de 104 px : Quand / Sauf si / Alors étiquetés, colonne
  Prochaine / Dernière (avec issue) / État (ce qui manque, nommé), repli téléphone ; puis ordre
  d'affichage passé à Quand / Alors / Sauf si (colonnes, lignes, phrase), à la demande de l'utilisateur.

## [2026-09-23] update | Style de rendu « Maison hantée »

**Déclencheur** : nouveau style 3D `haunted` (`apps/web/src/three/styles/haunted.ts`, clés
`render.styles.haunted`), premier jet que l'utilisateur veut améliorer plus tard.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - liste des styles livrés (elle en comptait quatre, il y en avait
  six : `indigo` et `maquette` manquaient), paragraphe `haunted` (jour écrasé, leçon de lisibilité).
- `4_ui/4_2_theme-et-langues.md` - valeur `haunted` de `kasbah.sceneStyle`.

## [2026-09-23] update | Automatisations, itération 1 (moteur serveur, API, vue)

**Déclencheur** : fonctionnalité « Automatisations » écrite le 2026-09-23, NON COMMITÉE (arbre de
travail après 0f943a0) : modèle `packages/shared/src/automations/`, moteur
`apps/server/src/core/automations/`, routes et message WS, store et vue web. Récit du thread
principal croisé avec le code ; aucun `journal.md` de session trouvé pour cette fonctionnalité. En
cours d'ingestion, l'éditeur a quitté le panneau latéral pour une page à lui (décision du 2026-09-23,
puis implémentation) : pages relues contre le code final, la version panneau gardée comme piste écartée.

**Pages créées** :
- `1_architecture/1_8_automatisations.md` - pourquoi côté serveur et sur le contrat, décisions du
  2026-09-22, modèle (prédicats à trois valeurs, déclencheurs heure / soleil / état, « sauf si » en
  OU, cibles nommées ou sélection, statut), moteur (minuteur unique ≤ 6 h, heure d'été, jeu `fresh`,
  photo de référence, bus protégé), persistance `<maison>.automations.json`, `sunTimes` et son piège
  du crépuscule de la veille, fuseau du process, limites, tests. Numérotée **1_8** et non 1_6 comme
  demandé : 1_6 (lecteur musique) et 1_7 (serveur MCP) étaient déjà pris.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` - `activity.ts` (règles « actif ? » déplacées du web),
  `deviceClassOf`, `HOME_RADIUS_M`.
- `1_architecture/1_2_serveur-et-plugins.md` - câblage de l'`AutomationEngine` dans `app.ts`.
- `1_architecture/1_3_protocole-rest-ws.md` - cinq routes `/api/automations`, message `automations`,
  `snapshot.automations`, schémas de réponse.
- `1_architecture/1_4_app-web.md` - store `automations`, cinq méthodes de transport, mock à trois
  règles, `lib/automations.ts`, `useAutomationNames`.
- `1_architecture/1_5_scene-3d.md` - `sunPosition` déménage dans `@kasbah/shared` (non demandé : la
  page citait `three/core/sun.ts` comme lieu du calcul).
- `4_ui/4_0_langage-visuel.md` - icône `automation`.
- `4_ui/4_1_navigation-et-panneaux.md` - liste des automatisations (empreinte fixe, repli téléphone,
  mesures) ; éditeur essayé dans le panneau latéral puis passé en page `/automations/:id`
  (`AutomationEditView.vue`, en-tête fixe, trois colonnes, `meta.nav` du rail, mesures sur la maquette).
- `5_setup/5_1_configuration-env.md` - `TZ` compte pour les automatisations.
- `6_faq/6_1_pieges-runtime.md` - `v-select` étiré sur la hauteur d'une colonne flex.

**Contradiction relevée (non tranchée)** : `2_maison/2_0_format-house-json.md` (tableau des
décisions) dit des scènes de la maison (`scenes[]`) qu'elles sont « exécutées côté client » ; le code
n'a aucun exécuteur de `house.scenes[]`, ni côté web ni côté serveur (constat du 2026-09-23, repris
dans les limites de `1_8`). Page non modifiée : à arbitrer.

**Index** : mis à jour (1 ligne ajoutée, 9 lignes complétées).

## [2026-09-23] update | MCP : chercher et jouer de la musique

**Déclencheur** : premier essai depuis Claude Desktop (« un titre d'un artiste ») raté —
l'agent n'avait que `play_url`, qui attend une URL de flux. Trois outils ajoutés dans
`apps/server/src/mcp/server.ts`, tests dans `server.test.ts`, tableau du `README.md`.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - sous-section datée : pourquoi, les trois outils et les routes
  qu'ils appellent, `app.inject` plutôt que les fonctions des plugins, `MUSIC_PUBLISH_BASE` exigée,
  ce qui a été vérifié (recherche réelle, lancement simulé), limites (suivant/précédent, pochette).

**Index** : mis à jour (1 ligne).

**Contradictions** : aucune.

## [2026-09-23] update | `npm run dev` : serveur sous `node --watch`

**Déclencheur** : l'utilisateur ne pouvait plus lancer `npm run dev` après 4657c58 (serveur MCP) —
serveur muet, `ECONNREFUSED` côté Vite. Correctif d'une ligne dans `apps/server/package.json`.

**Pages modifiées** :
- `6_faq/6_0_pieges-outillage.md` - entrée « `tsx watch` bloqué sous `concurrently` par le SDK MCP v2 »
  (symptôme, bissection jusqu'à l'auto-référence `@modelcontextprotocol/server/_shims`, combinaison
  seule fautive, correctif `node --watch --import tsx`, rechargement sur `packages/shared` en prime).
- `1_architecture/1_0_monorepo-et-flux.md` - sous-section datée : le tableau des scripts disait
  `tsx watch`, c'est désormais `node --watch --import tsx` (ligne du tableau laissée telle quelle).

**Index** : mis à jour (2 lignes).

**Contradictions** : les pages anciennes qui citent `tsx watch` (Nest, Cast, iRobot, pièges runtime)
décrivent le comportement d'avant ; signalé dans `1_0`, pas réécrit.

## [2026-09-23] update | serveur MCP `/mcp`

**Déclencheur** : arbre de travail après c9abf58 — `apps/server/src/mcp/{server,server.test}.ts`,
`registerMcp` dans `apps/server/src/app.ts`, dépendances `@modelcontextprotocol/{server,fastify}`
(+ `client` en dev), section « Serveur MCP » du `README.md`. Demande de l'utilisateur : un serveur MCP
local sans auth ; choix de l'emplacement (Fastify) et du périmètre (lecture + commandes) faits par lui.

**Pages créées** :
- `1_architecture/1_7_serveur-mcp.md` - décisions (SDK v2 plutôt que v1 ou FastMCP, spec 2026-07-28
  sans état, montage dans Fastify), outils et ressource, sécurité localhost (et sa limite), plomberie
  Fastify, tests dans les deux ères, suites possibles.

**Pages modifiées** :
- `1_architecture/1_3_protocole-rest-ws.md` - sous-section datée qui renvoie vers `/mcp`, troisième
  façade sur les mêmes routes.

**Index** : mis à jour (1 ligne ajoutée, 1 ligne complétée).

**Contradictions** : aucune.

## [2026-09-23] update | accueil Mixcloud : « Tes créateurs » réduits aux comptes suivis

**Déclencheur** : arbre de travail non commité après 604939c — `apps/server/src/plugins/mixcloud/home.ts`
(`buildHome` lit `api.following` en parallèle des écoutes) et `plugin.test.ts`. L'utilisateur voyait
dans la rangée des profils non suivis. Sources croisées : récit du thread
principal, `git diff`, code de `home.ts` et `api.ts` (aucun `journal.md` de session trouvé).

**Pages modifiées** :
- `3_plugins/3_20_mixcloud.md` - sous-section datée « Tes créateurs ne garde que les comptes SUIVIS » :
  pourquoi (l'API n'a pas de filtre), filtre sans casse, complément jusqu'à 10 par les autres suivis
  sans requête `user`, retombée sans filtre si les suivis sont illisibles, genres et « Réécouter » sur
  toutes les écoutes, +1 requête, vérification live `un_auditeur` (9 rangées) ; ligne `topCreators` de la
  table annotée plutôt que réécrite ; source ajoutée à l'en-tête. Le filtre anti-doublon des genres
  (`creatorSlugs`) porte sur tous les créateurs écoutés (`listenedCreators`) et les suivis illisibles
  ont leur test.

**Index** : mis à jour (1 ligne, résumé complété ; date déjà au 2026-09-23).

**Contradictions** : aucune entre code et wiki. Deux points relevés dans une première version du code
(`creatorSlugs` calculé après le filtre des suivis, suivis illisibles sans test) ont été corrigés et
testés dans la même session, avant tout commit ; la page le consigne.

## [2026-09-23] update | accueil Mixcloud recomposé des écoutes publiques, compte relié hors de la page

**Déclencheur** : suite de la session du 2026-09-23, arbre de travail non commité après 1839a21 —
nouveau `apps/server/src/plugins/mixcloud/home.ts` (`buildHome`), route `GET /api/plugins/mixcloud/home`,
`api.popular`, `limit` sur `listens`, champ `genres` de `MixcloudMix`, onglet Accueil de
`MixcloudBrowser.vue`. Sources croisées : récit du thread principal, `git diff`, code de `home.ts` et
tests `describe('mixcloud home')` (aucun `journal.md` de session trouvé).

**Pages modifiées** :
- `3_plugins/3_20_mixcloud.md` - ligne `/home` dans la table des routes ; sous-section datée « l'accueil,
  recomposé des écoutes publiques » : rangées et leur provenance, classement, genres par clé
  `/genres/<slug>/`, piège du genre qui n'est qu'un nom de créateur, échecs isolés, cache 30 min et
  reprises non cachées, coût d'une reconstruction, pourquoi le cookie n'est pas nécessaire, mesure live
  (9 rangées, ≈ 4 s, compte `un_auditeur`) ; renvoi « (19) » dans « Côté web ».
- `4_ui/4_1_navigation-et-panneaux.md` - (19) onglet Accueil par défaut, tuiles créateur / mix, la
  rangée devient la file, squelettes et messages vides ; retrait de la pastille « Compte @nom », qui
  rend caduque une phrase de (18) (signalé dans (19), (18) laissée intacte).

**Index** : mis à jour (2 lignes, résumés complétés ; dates déjà au 2026-09-23).

**Contradictions** : aucune entre code et wiki. Une affirmation de (18) de `4_1` (pastille qui délie)
est dépassée par le changement du jour ; documenté par la mise à jour (19).

## [2026-09-23] update | lecteur musique commun `/api/music`, plugin Mixcloud et sa reprise, page Musique à trois sources

**Déclencheur** : suite de la session du 2026-09-23, arbre de travail non commité après 5c43833 —
extraction du cœur de lecture de ytmusic dans `apps/server/src/music/` (décision de l'utilisateur),
nouveau plugin `mixcloud`, transport web renommé `music*`, `MixcloudBrowser`. Sources croisées : récit
du thread principal, `git status` / `git diff`, code des nouveaux fichiers, `git show 5c43833:` pour
l'ancien comportement (aucun `journal.md` de session trouvé pour cette journée).

**Pages créées** :
- `1_architecture/1_6_lecteur-musique.md` — le lecteur commun : pourquoi maintenant, fichiers
  (dont les `git mv`), contrat d'une source, piste `{ source, id }`, routes, `startS` et `onProgress`,
  ce qui est porté à l'identique, changement de comportement du cookie, essai live. 1_6 était libre.
- `3_plugins/3_20_mixcloud.md` — le plugin : compte par nom d'utilisateur, listes et curseurs,
  validation des clés, fil des suivis recomposé, résolution yt-dlp + HEAD, reprise (`store.ts`),
  santé, configuration, essai sur un Sonos, piège MSYS. 3_20 était libre.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — section (14) ; annotations datées (sans effacement) sur « Découpage »
  point 3, « Routes », « Variables », « (5) Routes », « (12) `POST /local` », et (13) « l'extraction est
  faite » ; en-tête Sources (anciens chemins gardés entre parenthèses).
- `3_plugins/3_19_radio.md` — « Suite : Mixcloud » annotée : c'est fait ; source ajoutée.
- `1_architecture/1_2_serveur-et-plugins.md` — section datée (2) : lecteur hors plugins, registre de
  sources.
- `1_architecture/1_4_app-web.md` — section (8) : renommages `Ytmusic*` → `Music*`, `musicProgress`,
  `startS`, appels `mixcloud*`, chemin de `queue.ts` mis à jour.
- `4_ui/4_1_navigation-et-panneaux.md` — section (18) : source Mixcloud, logos de source au trait,
  `playTracks` générique, `MixcloudBrowser`, `MixcloudLinkCard`, Réglages → Plugins triés.
- `5_setup/5_1_configuration-env.md` — section datée : `MUSIC_PUBLISH_BASE` (repli `YTM_PUBLISH_BASE`),
  `FFMPEG_PATH` lue par le lecteur, `MIXCLOUD_*`, et `RADIO_*` (trou signalé par l'entrée précédente,
  comblé).
- `6_faq/6_0_pieges-outillage.md` — entrée : Git Bash convertit un argument en `/…`, `MSYS_NO_PATHCONV=1`.

**Contradictions relevées** : aucune entre wiki et code. Écart de code signalé (non corrigé) : le
commentaire d'en-tête de `apps/server/src/music/proxy.ts` renvoie encore à « `index.ts` route
`/raw` », désormais dans `music/player.ts`.

**Trous signalés** : `3_2_ecrire-un-plugin.md` ne dit pas encore comment une source musicale
s'inscrit (`registerMusicSource`) ; chiffres live (56 tests, 258 kb/s, 43 Mo, 30:26, ≈ 8 s) et
« cookie gratuit sans effet » tirés du seul récit du thread principal ; aucune mesure Mixcloud en
navigateur ni sur Cast.

**Index** : mis à jour (9 lignes, dont 2 nouvelles).

## [2026-09-23] update | plugin Radios, `live` sur `play_url`, pont de lecture dans le noyau, page Musique multi-source

**Déclencheur** : session du 2026-09-23, arbre de travail non commité — nouveau plugin `radio`
(annuaire radio-browser.info), champ `live` du contrat, `ytmusic/bridge.ts` déplacé en
`core/playbackBridge.ts`, sélecteur de source sur la page Musique, sonde Mixcloud. Sources croisées :
récit du thread principal, `git diff` / `git status`, code des nouveaux fichiers (aucun `journal.md` de
session trouvé).

**Pages créées** :
- `3_plugins/3_19_radio.md` — le plugin entier : source sans appareil et sans relais, annuaire et ses
  règles (User-Agent, écoute signalée, stations en échec masquées), recherche indépendante de l'ordre des
  mots, favorites de la maison et ajout par URL, routes, `live: true`, santé, configuration, essai sur
  un Sonos, limites, piège de l'adresse morte (une radio locale), « Suite : Mixcloud » (sonde et
  décision d'extraire le noyau commun avec Mixcloud). Numéro 3_19 et non 3_17 : 3_17 (PetKit) et 3_18
  (Tuya) étaient pris.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : `live?: boolean` sur `media_player.play_url`.
- `1_architecture/1_2_serveur-et-plugins.md` — section datée : `core/playbackBridge.ts` (ancien chemin et
  anciens noms gardés en mémoire) ; source ajoutée à l'en-tête.
- `3_plugins/3_15_sonos.md` — section datée : `hls` vs `live`, classe `audioBroadcast`, report par
  `overlayStreamMeta`, essai sur une radio d'information.
- `3_plugins/3_6_google-cast.md` — section datée : `streamType: LIVE` déclaré par le service ; la ligne
  Sources du 2026-09-22 qui cite `ytmusic/bridge.ts` est annotée « devenu `core/playbackBridge.ts` »
  (chemin d'origine conservé).
- `3_plugins/3_16_ytmusic.md` — section (13) : pont déplacé, page multi-source, noyau extrait avec
  Mixcloud ; en-tête Sources mis à jour, mention de `bridge.ts` du 2026-09-22 annotée.
- `4_ui/4_1_navigation-et-panneaux.md` — section (17) : `Segmented` de source, pastilles « reliée »
  remplacées (et pourquoi), `RadioBrowser.vue`, `ArtThumb` `@error`.

**Trous signalés** : `RADIO_*` absentes de `apps/server/.env.example` et de
`5_setup/5_1_configuration-env.md` ; `3_2_ecrire-un-plugin.md` / `3_3_fabricants-a-venir.md` non touchées ;
`live` côté Cast non essayé en direct (tests seulement).

**Index** : mis à jour (7 lignes, dont 1 nouvelle).

## [2026-09-23] update | application installable (PWA)

**Déclencheur** : le bouton d'installation n'apparaissait pas dans Chrome — ni manifest ni icônes.

**Pages modifiées** :
- `5_setup/5_2_production.md` — section « application installable (PWA) » : manifest et icônes,
  critères actuels de Chrome (contexte sécurisé, plus de service worker), localhost oui / IP en HTTP
  non, pistes HTTPS, icône générée puis rasterisée par Chrome sans interface.

**Index** : mis à jour (1 ligne).

## [2026-09-23] update | lecture locale « Ce navigateur » (page Musique, ytmusic)

**Déclencheur** : nouvelle fonction, arbre de travail non commité — l'appareil qui affiche la page
Musique joue lui-même (`HTMLAudioElement`) ; session privée et nom générique au choix de l'utilisateur.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — section « (12) » : `POST /local` (session `local:<clientId>` sans
  lecteur, chemin relatif, `nextVideoId` préchargé), `sessionActive` faux pour `local:`, `/transfer`
  dans les deux sens (le serveur reprend ou rend position et file), refactor `describeResolved` /
  `streamPath` / `prefetchVideo`, file du navigateur aux règles DUPLIQUÉES de `queue.ts` (dette),
  pièges audio (son silencieux dans le geste pour Safari, son `ended` ignoré, seek après
  `loadedmetadata`, un nouvel essai sur `error`), essai live du 2026-09-23 et ce qui n'a pas été
  essayé (transfert navigateur ↔ enceinte). Date d'en-tête rattrapée (elle était restée au 22 malgré
  les sections (9) à (11) du 23).
- `4_ui/4_1_navigation-et-panneaux.md` — section « (16) » : la ligne « Ce navigateur » en tête du
  panneau Écoute, touche « Voir dans la maison » cachée à place gardée, aiguillage `localSelected`,
  choix par défaut qui attend l'inventaire.
- `1_architecture/1_4_app-web.md` — section « (7) » : store `localPlayer` (`DeviceEntry` synthétique,
  mémoire `localStorage`, API), méthodes de transport et préfixe du chemin relatif.

**Index** : mis à jour (3 lignes).

## [2026-09-23] update | voile immersif, « Retour » hors de la zone qui défile

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section « (15) » : voile fixe, fondu sur quatre bords, jamais sous
  la recherche ; « Retour » unique au-dessus de la zone qui défile, haut de zone fondu.

## [2026-09-23] update | journal ytmusic allégé

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — section « (11) » : les GET par plage passent en `debug`, ce qui reste en
  `info`, `KASBAH_LOG_LEVEL=debug` pour enquêter.

## [2026-09-23] update | titre en cours pulsant, colonne compactée, piège MarqueeText

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section « (14) » : `PulseDot` sur le titre qui joue dans toutes
  les listes, colonne de gauche compactée, piège `MarqueeText` (largeur naturelle nulle) qui avait fait
  disparaître le titre du lecteur.

## [2026-09-23] update | titres explicit retenus par www.youtube.com, détail affiné

**Déclencheur** : un album n'avait que 5 titres sur 8 (les explicit manquaient) ; demandes de
l'utilisateur sur le détail (pochette plus large et nette, présentation, licence, « Retour » et colonne
fixes), les tuiles et un voile sur les pochettes.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — section « (10) » : l'hôte www.youtube.com retient les titres explicit
  (`musicHostFetch` vers music.youtube.com), fausses pistes écartées, présentations d'album et
  d'artiste, page artiste réduite à ses titres.
- `4_ui/4_1_navigation-et-panneaux.md` — section « (13) » : colonne mesurée et fixe, « Retour » collant,
  présentation et licence, `artAt`, voile des pochettes, « E » collé au titre.

## [2026-09-23] update | détail d'album à la YouTube Music

**Déclencheur** : l'utilisateur trouvait la vue album trop vide (liste pleine largeur, pochette
répétée), et proposait la mise en page de YouTube Music.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section « (12) » : colonne pochette / titre / lecture,
  titres d'album sans vignette (numéro → ▶, ligne jouable), pièges `sticky` trop haut et voile qui
  déborde.

## [2026-09-23] update | Nouveautés, numéros, badges explicit des pages browse

**Déclencheur** : onglet Nouveautés (liste complète, en grille), numéros dans les listes, lecture des
playlists, « Avancée » grisée sans recherche ; deux défauts trouvés en chemin (doublon « RELEASED »,
badges explicit perdus dans une enveloppe youtubei.js).

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — section « (9) » : `/explore/new` (deux pages en parallèle, liste
  complète), grilles, doublons, piège `SuperParsedResult` sur les badges.
- `4_ui/4_1_navigation-et-panneaux.md` — section « (11) » : onglet Nouveautés en grille, `MusicShelves`,
  numéros à largeur fixe en px, playlists jouables, « Avancée » grisée.
- `1_architecture/1_4_app-web.md` — section « (6) » : `ytmusicExploreNew`, `ytmusicExploreCovers`.

## [2026-09-22] update | cartes et pochettes des genres

**Déclencheur** : l'utilisateur voulait une présentation plus immersive des genres et ambiances.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — section « (8) » : `/explore/covers` (la page n'a pas d'images ; deux
  pochettes par catégorie prises dans sa page, stock incrémental par catégorie, 6 h).
- `4_ui/4_1_navigation-et-panneaux.md` — section « (10) » : cartes en dégradé, pochettes inclinées en
  fondu, piège `referrerpolicy`.

## [2026-09-22] update | Humeurs et genres (phase 2)

**Déclencheur** : onglets Genres et Ambiances de la page Musique (choix de l'utilisateur : titres +
playlists officielles + albums par catégorie, noms dans la langue de l'app, « Pour vous » en tête des
genres).

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — section « (7) » : page des catégories lue en JSON brut (couleurs),
  grilles par position, page d'une catégorie via `contents_memo` (piège de l'enveloppe), session par
  langue, deux routes, cache 10 min ; bug du titre `<sid>.m4a` corrigé. Note datée sur la ligne « phase
  2, pas faite ».
- `4_ui/4_1_navigation-et-panneaux.md` — section « (9) » : pastilles à liseré, page de catégorie en
  rangées, retour vers la catégorie.
- `1_architecture/1_4_app-web.md` — section « (5) » : `ytmusicExplore`, `ytmusicExploreCategory`.

## [2026-09-22] update | badge explicit sur les tuiles

**Déclencheur** : l'utilisateur ne voyait pas le marquage explicit sur les tuiles de la recherche
simple — elles ne l'avaient jamais eu.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section « (8) » : `MusicTile` porte `explicit` (album,
  titre), `ExplicitBadge` à droite du titre, hauteur de tuile inchangée.

## [2026-09-22] update | album et artiste jouables, lecture au survol, pochettes d'album

**Déclencheur** : demande de l'utilisateur (play sur les vignettes d'album et d'artiste, boutons play
au survol et plus discrets, pochette absente des titres d'un album).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section « (7) » : `ArtPlay` (cercle au trait centré sur la
  pochette, remplace `PlayButton`), révélation au survol sous `(hover: hover)` et affichage permanent
  sans survol, `playable` sur tuiles et lignes d'album / d'artiste (`playCollection`), racine `div`
  `role="button"`.
- `3_plugins/3_16_ytmusic.md` — section « (6) » : les lignes d'une page d'album n'ont ni pochette ni
  artiste (sondé en direct) ; recopiés depuis l'en-tête, compteur « plays » écarté du repli artiste.
  Ligne Sources : `PlayButton` → `ArtPlay`.

## [2026-09-22] update | file d'attente YouTube Music (phase 3)

**Déclencheur** : file d'attente côté serveur et dans la page Musique, implémentée le soir du
2026-09-22 (arbre de travail NON commité : `queue.ts`, `queue.test.ts` nouveaux ; `index.ts`,
`bridge.ts`, `app.ts`, `MusicView.vue`, `MusicPlayerBar.vue`, `MusicItemRow.vue`, transports,
`strokeIcons.ts`, i18n modifiés). Sources : récit du thread principal, diff de l'arbre, code.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — nouvelle section « Mise à jour 2026-09-22 (5) » : pourquoi la file vit
  au serveur, répétition du titre (la file ne boucle pas), neuf routes, détection de fin de piste par
  la position (`END_SLACK_S`, `SETTLE_MS`, position redatée seulement quand elle bouge), préchargement,
  transfert qui emporte la file, piège de la pause non attendue, tests, essai live sur un Sonos. Deux lignes
  au tableau des routes ; notes datées sur « Hors phase 1 » et « Décisions de périmètre ».
  **Deux faits périmés annotés en place, sans effacer** : « position affichée = lecteur + `startS` »
  (faux depuis `6a5a460`), et « un Sonos est sondé toutes les 10 s » (deux occurrences : c'est le Cast,
  `DEFAULT_MEDIA_POLL_MS` ; le Sonos est à 2 s, `SONOS_POLL_MS`).
- `4_ui/4_1_navigation-et-panneaux.md` — section « (6) » : liste qui devient la file (fenêtre de
  1000), « Tout lire », touches de file fixes, vue File, Répéter à la place de l'emplacement fantôme
  (note ajoutée dans la section « (4) »), touche File au bout du morceau et sa pastille, rafraîchissement
  à 800 ms ; défaut connu de la colonne droite à 1280 px consigné.
- `1_architecture/1_4_app-web.md` — section « (4) » : neuf méthodes `ytmusicQueue*`, types
  `YtmusicRepeat` / `YtmusicQueueTrack` / `YtmusicQueue`, `YtmusicSession.queue` ; « dix secondes côté
  Sonos » annoté (même correctif).
- `6_faq/6_1_pieges-runtime.md` — entrée « le compteur recule à la pause » : « relit toutes les dix
  secondes » annoté (Cast 10 s, Sonos 2 s).

**Contradiction relevée (non tranchée)** : `_generated-ai-doc/musique-phases-suivantes.md` (plan de la
phase 3) prévoyait qu'un `idle` en milieu de piste ou un `media_player.stop` explicite vide la file ;
le code laisse la file en
attente sur un `idle` en milieu de morceau et ne la supprime que si la session proxy change ou si le
lecteur joue autre chose. Le wiki décrit le code.

**Index** : mis à jour (3 lignes : 1_4, 3_16, 4_1).

## [2026-09-22] update | recherche officielle, badge explicit, flux 320 kb/s

**Déclencheur** : session de retouches sur la page Musique (volume, cache de recherche, contenus
amateurs dans les résultats, marquage explicit, qualité du flux) et remise au vert du dépôt
(typecheck serveur, lint, tests en échec).

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — `explicit` sur `play_url` et `nowPlaying`, et pourquoi
  il est porté par l'ÉTAT plutôt que par la session du plugin qui lance la lecture.
- `1_architecture/1_4_app-web.md` — cache de la dernière recherche (portée MODULE, pas `setup`) et
  volume appliqué au fil du glissement (throttle 200 ms, relevé ignoré pendant le geste).
- `3_plugins/3_16_ytmusic.md` — filtre « catalogue seulement » (`USER_CHANNEL` vs `ARTIST`), titres
  du filtre `song` portés à `SEARCH_SECTION_LIMIT`, sortie à 320 kb/s avec `FRAME_BYTES` dérivé,
  bloc `quality` de `GET /sessions`, et la mesure des formats source (AAC 258 kb/s de taille exacte,
  `accept-ranges: bytes`) qui ouvre la piste d'un relais sans réencodage.
- `3_plugins/3_15_sonos.md` — piège : ce qu'une enceinte ne sait pas dire doit être reposé à CHAQUE
  relevé (le badge explicit s'éteignait au premier sondage).
- `3_plugins/3_6_google-cast.md` — même report dans le `stickyPlay` de `mediaPatch`.
- `4_ui/4_1_navigation-et-panneaux.md` — badge explicit aux trois endroits, source du badge dans la
  barre (`pending` puis état), ligne de qualité du flux sous le nom du lecteur.

- `3_plugins/3_16_ytmusic.md` (2ᵉ passage) — sonde du relais sans réencodage : validée sur un Sonos
  et un Cast, avec les trois pièges (conteneur avant débit, extension de
  l'URL, AbortError non rattrapée qui tue le serveur).

- `3_plugins/3_16_ytmusic.md` (3ᵉ passage) — le relais devient le chemin par défaut, ffmpeg le repli :
  comment le chemin est choisi, ce que le journal en dit, et la vérification en direct sans drapeau.

- `4_ui/4_1_navigation-et-panneaux.md` (2ᵉ passage) — les deux touches de saut de 10 s et la symétrie
  de la rangée qu'elles doivent préserver.

**Index** : mis à jour (6 lignes).

## [2026-09-22] update | position du lecteur : compteur stable en pause et curseur qui tient sa cible

**Déclencheur** : troisième session du 22/09 (fin d'après-midi), correction ciblée après deux
symptômes vus en live — clic dans le curseur qui « passe par un autre endroit » avant la cible, et
timecode instable en pause. Rien côté serveur, aucune route neuve.

**Pages modifiées** :
- `1_architecture/1_4_app-web.md` — section « (3) — une seule position de lecteur, et un curseur qui
  tient sa cible » : les trois positions d'un seul geste (patch optimiste → relevé d'avant le geste →
  vrai relevé), `MEDIA_POSITION_SLACK_S` exportée (ex-`PAUSED_REANCHOR_S`), `useSeekHold` et sa
  condition de relâche comparée au POINT DE DÉPART, dédoublonnage de `MediaPlayerControl`
  (−30 lignes, son ancien repère recalé sur `playback` = cause du second symptôme), tests. Deux
  corrections signalées sans rien effacer : la section du matin annonçait le partage avant qu'il
  soit fait, et le rythme de sondage y est inversé (Sonos 2 s, Cast 10 s). Une question laissée
  ouverte : l'écho optimiste satisfait déjà la condition de relâche.
- `4_ui/4_1_navigation-et-panneaux.md` — section « (3) » : ce qui change à l'usage (pouce qui ne
  rebondit plus, timecode stable en pause, panneau appareil aligné sur la barre Musique, changement
  de lecteur qui relâche), disposition inchangée.
- `6_faq/6_1_pieges-runtime.md` — complément daté sous l'entrée « le compteur recule à la pause » :
  second symptôme (le pouce qui repasse par l'ancienne position), diagnostic des trois positions,
  règle « la condition de sortie est un rapprochement, pas l'arrivée d'un message », renommage de la
  constante, précision de chiffre sur le sondage, et le point à instrumenter s'il reste un rebond.
- `4_ui/4_0_langage-visuel.md` — note : « rien ne doit bouger » vaut aussi pour les CHIFFRES (une
  valeur qui recule bouge), et l'affichage garde la main tant que la source de vérité ne s'est pas
  rapprochée.

**Pages créées** : aucune.

**Contradictions relevées** (non tranchées ici) : « le plugin la relit toutes les dix secondes
(Sonos) » dans `1_4` et dans l'entrée FAQ du matin contre `SONOS_POLL_MS` à 2 s dans le code ;
`3_plugins/3_16_ytmusic.md` (section du matin, sous bannière) décrit encore la position affichée
comme « celle du lecteur **+ `startS`** », alors que `startS` a été supprimé le même jour.

**Index** : mis à jour (4 lignes).


## [2026-09-22] update | le proxy ytmusic devient un « fichier » MP3 de taille connue

**Déclencheur** : seconde session du 22/09, même journée que l'ingestion précédente — le modèle de
flux documenté le matin (flux vivant sans taille, position et reprise reconstruites côté serveur) a
été **abandonné** l'après-midi au profit d'un proxy qui se présente à l'enceinte comme un fichier MP3
de taille connue, découpable par plages d'octets. Motif donné par l'utilisateur : trop de pièces
mobiles pour une position qui restait approximative ; le téléchargement complet a été refusé (mix de
plusieurs heures, latence).

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — bannière **« modèle abandonné le jour même »** sur la section du
  matin (conservée : elle dit pourquoi l'autre existe), note de correction dans « la page Musique »,
  table des routes à jour (`HEAD /stream`, `/sessions`, `/transfer`, `durationS` sur `/play`), et
  section neuve « (2) — le proxy se présente comme un FICHIER MP3 de taille connue » : pourquoi
  l'abandon, trames fixes (576 o / 24 ms, `lengthFor` / `seekFor` / `parseRange` / `LengthLock` /
  `silentFrame`), d'où vient la durée, 200 / 206 / `HEAD` / plage hors fichier, ce que l'enceinte
  fait seule, transfert (`seekWhenReady`, `TRANSFER_LEAD_S`), tableau des suppressions, tests, essai
  live d'une enceinte à une autre.
- `3_plugins/3_15_sonos.md` — bannière « en partie périmé » sur les trois corrections du matin, puis
  section « (2) » : deux mécanismes supprimés (`SetAVTransportURI` reposé sur `Play`, mapping
  « STOPPED avec notre URI = paused »), deux conservés, la correction neuve sur l'oubli de
  `stickyPlay` (une seconde à l'arrêt juste après l'URI), test supprimé.
- `1_architecture/1_4_app-web.md` — renvoi depuis la section du matin, puis section « (2) » :
  `ytmusicSeek` supprimé du transport, `YtmusicSession` sans `startS`, position et durée du lecteur
  dans `MusicPlayerBar`, `canSeek` sur la seule capacité, filtre « lisible » étendu à `source`.
- `5_setup/5_1_configuration-env.md` — `YTM_RESUME_LEAD_MS` marquée **supprimée** (schéma et
  `.env.example`), tableau conservé pour mémoire, `TRANSFER_LEAD_S` cité comme seul réglage restant
  (en dur).
- `6_faq/6_1_pieges-runtime.md` — trois entrées amendées sans réécriture : session proxy (TTL 1 h →
  6 h, `/seek` disparue), redémarrage `tsx` (processus mourant, proxy vidé, attendre `/status`
  APRÈS), compteur qui recule à la pause (toujours vrai : piège de sondage, pas de flux).
- `4_ui/4_1_navigation-et-panneaux.md` — section « (2) » : curseur qui envoie `media_player.seek`,
  pause/reprise du lecteur, source illisible écartée, ce qui reste montré par la session.

**Pages créées** : aucune.

**Index** : 6 lignes mises à jour (résumés ; dates déjà au 2026-09-22).

**Contradictions et points à arbitrer** :
- Deux sections datées du **même jour** décrivent des modèles opposés dans `3_16` et `3_15`. Choix
  fait : conserver les deux, avec bannière et renvoi, parce que le modèle abandonné porte le
  *pourquoi* de l'actuel. À purger seulement si l'utilisateur le demande.
- Les chiffres de l'essai live (pause 7 s → reprise 11 s, seek 120 → 122, transfert 122,3 → 127
  après 6 s) et le constat « le Sonos ne publie pas la durée de ce flux » viennent du **récit de
  session seul** : aucune trace dans le dépôt (pas de `journal.md` pour cette session), signalés
  comme constats live.

## [2026-09-22] update | page Musique et chaîne de lecture ytmusic → Sonos / Cast

**Déclencheur** : fin de session — refonte de la vue `/ytmusic` en page `/music` et pilotage du flux
proxy (pause, position, transfert d'une pièce à l'autre) vérifié live sur un Sonos.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — trois sections datées : arithmétique de la position
  (`startS` + relevé + temps écoulé, `durationS` du catalogue), les quatre raisons de servir le flux
  (`start` / `resume` / `probe` / `reconnect`) et `playedS`, `YTM_RESUME_LEAD_MS`, les routes
  `/sessions` `/transfer` `/seek` `HEAD /stream/:sid`, `bridge.execute` en porte unique, `pause` et
  non `stop` au remplacement, `sessionActive`, `-ss` avant `-i` + `afade` permanent, runtime
  paresseux, la page Musique, les décisions de périmètre (phases 2 et 3 non faites), l'essai live.
  **Périmé signalé** : « un play réussi emmène sur la maison 3D ».
- `3_plugins/3_15_sonos.md` — trois constats live : deux GET systématiques sur `play_url`, pas de
  vraie pause d'un flux HTTP (reprise à l'octet qui échoue → reposer l'URI), sondage qui garde
  `stickyPlay` sur un URI vide ; test associé.
- `3_plugins/3_6_google-cast.md` — note courte : `stop` ferme l'appli, d'où le `pause` du
  remplacement ; la source d'un transfert reçoit bien un `stop`.
- `4_ui/4_1_navigation-et-panneaux.md` — la page Musique au complet (trois zones, deux modes de
  recherche, panneau Écoute, mode transfert, toasts retirés) ; note de péremption sur « play → 3D ».
- `4_ui/4_0_langage-visuel.md` — cinquième cas de « rien ne bouge » : centrage sur l'écran,
  emplacement fantôme, largeurs fixes, `ArtThumb` avec `size`.
- `1_architecture/1_4_app-web.md` — trois méthodes de transport, `YtmusicSession`, mock qui rend une
  liste vide, `useMediaPosition`.
- `5_setup/5_1_configuration-env.md` — `YTM_RESUME_LEAD_MS`.
- `6_faq/6_1_pieges-runtime.md` — trois entrées : session proxy qui survit au programme suivant de
  l'enceinte, requête pendant un redémarrage `tsx` qui tourne aux défauts, compteur qui recule à la
  pause.
- `6_faq/6_0_pieges-outillage.md` — l'outil d'écriture qui pose de vraies espaces insécables
  (`no-irregular-whitespace`). Placé ici et non en `6_1` : c'est un piège d'**outillage**.

**Pages créées** : aucune.

**Index** : 9 lignes mises à jour (résumés complétés, dates au 2026-09-22).

**À arbitrer / trous** :
- Deux affirmations du wiki devenues fausses ont été **signalées et non effacées** (`3_16` et `4_1` :
  « un play réussi emmène sur la maison 3D »). À purger si l'utilisateur confirme.
- Commentaire de code qui renvoie à `StreamProxy.resolveStart`, méthode qui s'appelle `startFor`
  (`ytmusic/index.ts`, `stream.ts`) — signalé, pas corrigé (hors `doc/`).
- Les mesures « rien ne bouge » (`getBoundingClientRect` à 1280 × 800 et 1920 × 1080) viennent du
  compte rendu de session : aucune trace versionnée, pas de journal de session pour le 2026-09-22.

## [2026-09-22] update | en-tête Plugins : actifs / dispo · appareils

**Déclencheur** : fin de session — résumé à droite du titre de la liste Plugins.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — `pluginsStats` (actifs / implémentés · parc live).
- `4_ui/4_2_theme-et-langues.md` — clé `settings.pluginsStats`.

**Index** : dates 4_1 / 4_2 déjà à jour.

## [2026-09-22] update | mangeoire / fontaine en tour 3D

**Déclencheur** : fin de session — silhouettes Animaux : blocs plus hauts que larges au lieu
des sphères.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — `PET_BOX` pour `pet_feeder` / `pet_fountain`.

**Index** : date 1_5 déjà à jour.

## [2026-09-22] update | formes d'enceintes 3D + Réglages / Modifier

**Déclencheur** : fin de session — `speakerShape` (défaut / galet / barre / bloc) ; libellés
unifiés des cartes pliantes ; Segmented Forme en icônes.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — `HouseDevice.speakerShape` / effacement.
- `1_architecture/1_5_scene-3d.md` — géométries `GenericMarker` + yaw barre/bloc.
- `4_ui/4_1_navigation-et-panneaux.md` — Réglages/Modifier ; Forme icônes.
- `4_ui/4_0_langage-visuel.md` — glyphes `speakerTube|Pebble|Bar|Block`.
- `4_ui/4_2_theme-et-langues.md` — clés `place.*` / `vehicle.tune*` / `speakerShape`.

**Index** : dates 1_5 / 2_0 / 4_0 / 4_1 / 4_2.

## [2026-09-22] update | HomePanel tuiles, occlusion étage, peinture Tesla

**Déclencheur** : fin de session — panneau accueil allégé ; voiture sous plancher ;
persistance peinture Tesla.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — `markerLevelId`, occlusion `pick`, pilules outdoor.
- `3_plugins/3_8_tesla.md` — `paints` dans `TESLA_STATE_FILE`.
- `4_ui/4_1_navigation-et-panneaux.md` — HomePanel = tuiles seulement.
- `6_faq/6_1_pieges-runtime.md` — pièges plancher / peinture Tesla.

**Index** : dates 1_5 / 3_8 / 4_1 / 6_1.

## [2026-09-22] update | médias TV, pack photo sol/herbe, onglet niveau

**Déclencheur** : fin de session — retrait URL manuelle lecteur ; diagonale TV en pouces ;
pack photo (Tiles107 / poolTile / Grass006) ; correction onglet de niveau.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — pack photo + `poolTile`, dalle TV dimensionnable.
- `2_maison/2_0_format-house-json.md` — `HouseDevice.size` pour une TV.
- `4_ui/4_1_navigation-et-panneaux.md` — plus d'URL ; diagonale ″ ; `setFloorTab`.
- `6_faq/6_1_pieges-runtime.md` — piège onglet de niveau vs `selectedKey`.

**Index** : dates 1_5 / 2_0 / 4_1 / 6_1.

## [2026-09-21] update | UI + scène plafonnier CREATE / Tuya

**Déclencheur** : fin de session — polish UI, correction CCT, mesh 3D et pales qui tournent ;
commit de la feature complète.

**Pages modifiées** :
- `3_plugins/3_18_tuya.md` — fabricant `CREATE / Tuya`, CCT DP 23 confirmé (0 = froid).
- `1_architecture/1_5_scene-3d.md` — `LightMarker` hub + 3 pales, rotation via `setCompanionFan`.
- `4_ui/4_0_langage-visuel.md` — `lightFan` / `lightFanOn`, `Segmented.sublabel`.
- `4_ui/4_1_navigation-et-panneaux.md` — dual switch pouce, Segmented fill, sous-titre.
- `4_ui/4_2_theme-et-langues.md` — `kelvinLabel`, `kinds.lightFan`.

**Index** : dates 1_5 / 3_18 / 4_0 / 4_1 / 4_2.

## [2026-09-21] update | Tuya CCT : DP 23 inversé

**Déclencheur** : observation UI — « Froid » allume jaune, « Chaud » allume blanc.

**Pages modifiées** :
- `3_plugins/3_18_tuya.md` — DP 23 : 0 = 4000 K, 1000 = 2700 K (mesuré sur le CREATE).

## [2026-09-21] update | plugin Tuya CREATE, kind `fan`

**Déclencheur** : plan d'implémentation ventilateur-lumière CREATE (protocole local mesuré).

**Pages créées** :
- `3_plugins/3_18_tuya.md` — plugin local 3.5, 7 DP, six pièges, config JSON, lien light/fan.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — kind `fan`, `colorTempMirekSteps`, `linkedTo`, `meta.fan`.
- `3_plugins/3_0_simulation-mock.md` — ventilateur simulé + demo-house.
- `3_plugins/3_2_ecrire-un-plugin.md` — leçons Tuya.
- `4_ui/4_0_langage-visuel.md` — icône `wind`.
- `4_ui/4_1_navigation-et-panneaux.md` — section liée dans Lumières, `FanControl`.
- `4_ui/4_2_theme-et-langues.md` — clés `fan.*` / `light.kelvin.*`.
- `5_setup/5_1_configuration-env.md` — `TUYA_*`.

**Index** : mis à jour (`3_18_tuya`, résumé `1_1`).

## [2026-09-21] update | l'apparence quitte le rail, les Réglages s'y épinglent

**Déclencheur** : demande de l'utilisateur — poser les Réglages tout en bas du rail, en fixe, et
sortir le bouton d'apparence du rail pour l'emmener dans la vue 3D (emplacement arbitré entre
quatre propositions : en-tête après les onglets de niveau, retenu).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — la double bascule, `settings` gardé dans `NAV_ITEMS`
  pour la recherche, les trois emplacements écartés et pourquoi, et les mesures de la preview
  (empreinte fixe sur les quatre modes, en-tête inchangé à 1440 px, une ligne de plus sous ~950 px).
- `4_ui/4_0_langage-visuel.md` — note de relecture : « l'icône d'apparence du rail » de quatre
  mises à jour se lit désormais « en-tête de la vue Maison » ; les raisonnements sur le vocabulaire
  d'icônes, eux, tiennent tels quels.

**Non modifiée volontairement** : `4_ui/4_2_theme-et-langues.md` — elle décrit les quatre modes
d'apparence et leur persistance, pas l'emplacement du bouton.

**Index** : mis à jour (2 lignes).

## [2026-09-21] update | plugin PetKit, kinds d'animalerie, vue Animaux

**Déclencheur** : intégration des appareils PetKit de la maison (mangeoires Fresh Element Solo,
fontaines Eversweet Max), vérifiée de bout en bout contre le vrai compte — lecture et écriture.

**Pages créées** :
- `3_plugins/3_17_petkit.md` — le plugin : connexion par code, les six pièges d'API, le relais
  Bluetooth, la trame de pompe mesurée, ce qui est vérifié et ce qui reste supposé.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — deux kinds `pet_feeder` / `pet_fountain`, et
  l'UNITÉ déclarée par l'appareil (`meta.petFeeder.unit`).
- `3_plugins/3_0_simulation-mock.md` — porteurs simulés, et ce qu'ils ne simulent PAS exprès.
- `3_plugins/3_2_ecrire-un-plugin.md` — cinq leçons transposables.
- `4_ui/4_0_langage-visuel.md` — quatre icônes trait de plus.
- `4_ui/4_1_navigation-et-panneaux.md` — vue Animaux, quatre façons mesurées de faire bouger une
  carte, retour sur commande recâblé.
- `4_ui/4_2_theme-et-langues.md` — `cupGrams`, un réglage d'affichage qui n'est pas un goût.

**Index** : 1 ligne ajoutée, 6 lignes mises à jour.

## [2026-09-21] update | rail ytmusic après météo, play→3D, langue hors rail

**Déclencheur** : UI — ordre rail, navigation après lecture, retirer FR/EN du rail.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section Rail, ytmusic après météo, play→selectDevice,
  plus de langue au rail.
- `3_plugins/3_16_ytmusic.md` — position rail + play → maison 3D.

**Index** : dates inchangées (déjà 2026-09-21).

## [2026-09-21] update | ytmusic discographie, vidéos, layout, Best of

**Déclencheur** : session `/ytmusic` — discographie d'un artiste, Music Video, hideExplicit, layout L1/L2,
Best of bloqué par `releaseType: album`.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — getArtist/getAlbum, video+song, multi-artistes, Best of, explicit
  titre, withSession, UI L1/L2 + hideExplicit.
- `4_ui/4_1_navigation-et-panneaux.md` — layout lignes + switch explicites.
- `6_faq/6_1_pieges-runtime.md` — pièges Best of / Music Video.

**Index** : résumé `3_16`, dates `4_1` / `6_1`.

## [2026-09-20] update | ytmusic recherche classée + ORB pochettes

**Déclencheur** : session UI `/ytmusic` — sections, tris, explicit, pertinence de la recherche, pochettes
bloquées `ERR_BLOCKED_BY_ORB`.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — 3 filtres //, DTO classé, UI, ArtThumb, hors phase 1 play album.
- `4_ui/4_1_navigation-et-panneaux.md` — colonnes / PlayButton / tris / ORB.
- `6_faq/6_1_pieges-runtime.md` — piège ORB ggpht + `referrerpolicy=no-referrer`.

**Index** : résumé `3_16`.

## [2026-09-20] update | `npm run dev` lance le PO Token

**Déclencheur** : démarrer bgutil avec le monorepo (`_external/…/server`).

**Pages modifiées** :
- `1_architecture/1_0_monorepo-et-flux.md` — `dev` + `dev:pot`.
- `5_setup/5_0_installation-et-scripts.md` — note `_external`.
- `3_plugins/3_16_ytmusic.md` — `scripts/dev-pot.mjs` dans la mise en route.

**Index** : dates `1_0` / `5_0`.

## [2026-09-20] update | ytmusic : faux cookie manquant à l'ouverture

**Déclencheur** : bandeau « cookie manquant » sur `/ytmusic` tant qu'on n'a pas ouvert Réglages.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — `refreshLink` au montage de la vue.
- `4_ui/4_1_navigation-et-panneaux.md` — même note.
- `6_faq/6_1_pieges-runtime.md` — piège inventaire plugins hors Réglages.

**Index** : résumé `3_16`.

## [2026-09-20] update | ytmusic renew cookie + flux yt-dlp 2026.08

**Déclencheur** : session — import cookie (DPAPI / Firefox), lecture cassée (« Requested
format is not available »), correctifs vérifiés live.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — collage vs import, DPAPI, `web_music` + `--js-runtimes node`,
  plus d'`android_music`, dump sans `-f`.
- `4_ui/4_2_theme-et-langues.md` — `pasteHowTo` / `importSteps` / `renewHint`.
- `5_setup/5_1_configuration-env.md` — Node PATH pour EJS ; import cookie.
- `6_faq/6_1_pieges-runtime.md` — deux pièges ytmusic (DPAPI, formats / EJS).

**Index** : résumé `3_16`, dates `5_1` / `6_1`.

## [2026-09-20] update | YTM phase 1 + stickyPlay (vérifié live)

**Déclencheur** : fin de session — YouTube Music → Cast/Sonos OK partout ; métadonnées
affichées après `stickyPlay` (DIDL Sonos insuffisant seul).

**Pages créées / modifiées** :
- `3_plugins/3_16_ytmusic.md` — plugin, ops (Docker ou Node PO), `android_music`, métas
  `POST /play`, essais live cochés.
- `3_plugins/3_15_sonos.md` — `stickyPlay` / `overlayStreamMeta`.
- `3_plugins/3_6_google-cast.md` — métas `LOAD` + `stickyPlay`.
- `1_architecture/1_1_contrat-appareils.md` — `play_url` optionnel `title` / `artist` / `artUrl`.
- `5_setup/5_1_configuration-env.md` — `YTM_*`.
- `4_ui/4_1_navigation-et-panneaux.md` / `4_2_theme-et-langues.md` — rail + i18n.

**Index** : `3_16` ; dates 2026-09-20.

## [2026-09-20] update | play_url : titre / artiste / pochette

**Déclencheur** : lecture YTM sur Sonos affichait le hash de session du proxy au lieu du morceau.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — `play_url` optionnel `title` / `artist` / `artUrl`.
- `3_plugins/3_15_sonos.md` — DIDL enrichi.
- `3_plugins/3_16_ytmusic.md` — `POST /play` envoie les métas du titre UI.

## [2026-09-20] update | PO Token sans Docker obligatoire

**Déclencheur** : mise en route ytmusic — Docker n'est qu'une option pour le générateur PO.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` — options Docker **ou** Node natif + plugin yt-dlp `bgutil`.

## [2026-09-20] update | YouTube Music → Cast / Sonos (phase 1)

**Déclencheur** : source musique non officielle (cookie perso, recherche + likes/playlists) branchée
sur `media_player.play_url` déjà en place.

**Pages créées / modifiées** :
- `3_plugins/3_16_ytmusic.md` — plugin, ops cookie / PO Token / yt-dlp, routes, UI, hors phase 1.
- `5_setup/5_1_configuration-env.md` — `YTM_*` + rappel `FFMPEG_PATH`.
- `4_ui/4_1_navigation-et-panneaux.md` — entrée rail YouTube Music.
- `4_ui/4_2_theme-et-langues.md` — clés `ytmusic.*` / `settings.ytmusic.*`.

**Index** : `3_16` ajoutée ; dates au 2026-09-20.

## [2026-09-20] update | `media_player.play_url` (Cast + Sonos)

**Déclencheur** : étape 2 Cast / flux HTTP Sonos — pouvoir envoyer une URL (radio, MP3, HLS)
au média choisi, prérequis avant toute source YouTube Music.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — capacité `play_url`, commande `media_player.play_url`.
- `3_plugins/3_6_google-cast.md` — étape 2 faite (`LAUNCH` `CC1AD845` + `LOAD`), essais live.
- `3_plugins/3_15_sonos.md` — `SetAVTransportURI` + `Play`, essai sur un Play:3.
- `3_plugins/3_0_simulation-mock.md` — mock déclare et sert `play_url`.
- `4_ui/4_1_navigation-et-panneaux.md` — champ URL dans `MediaPlayerControl`.
- `4_ui/4_2_theme-et-langues.md` — clés `media.playUrl` / `media.urlPlaceholder`.
- `6_faq/6_1_pieges-runtime.md` — timeout `LAUNCH` 5 s sur une TV.

**Index** : dates des pages ci-dessus au 2026-09-20.

## [2026-09-20] update | Souffle 3D de la borne en charge

**Déclencheur** : la vraie borne Enphase posée dans la scène restait un bloc gris ; le pulse n'existait
que pour les coffrets de batterie.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — même souffle que la batterie, vert seulement si
  `status === 'charging'` (pas les watts, encore à 0 côté Enphase).

**Index** : date de `1_5` au 2026-09-20.

## [2026-09-20] update | Borne Enphase : session cloud et capture

**Déclencheur** : IQ EV Charger 2 hors API locale ; voie retenue = API privée de l'appli Enphase
(comme Renault). Capture avant mappage.

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` — chemin cloud ouvert (session Enlighten distincte du jeton local,
  sous-item `ev_charger`, `GET /ev/raw`) ; mappage pas encore.
- `5_setup/5_1_configuration-env.md` — `ENPHASE_CLOUD_FILE`.
- `4_ui/4_2_theme-et-langues.md` — clés `settings.enphase.cloudLinked` / `.cloudNeeded`.

**Index** : dates de `3_7` et `5_1` au 2026-09-20.


## [2026-09-20] update | Filtre de la liste d'une pièce, en icônes

**Déclencheur** : le détail d'une pièce n'avait aucun moyen de réduire sa liste d'appareils.
Un switch à libellés débordait du panneau ; les icônes du rail tiennent.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — `RoomPanel` gagne un `Segmented` `fill` + `icon` ;
  catégories présentes seulement ; `Segmented` documenté (sortie du piège des libellés longs
  quand on a des icônes).
- `4_ui/4_2_theme-et-langues.md` — clés `home.filter.*` (infobulle / aria, pas l'affichage).

**Index** : dates de `4_1` et `4_2` au 2026-09-20.


## [2026-09-19] update | Pochette Sonos : `&amp;` dans `/getaa`

**Déclencheur** : pochettes invisibles en lecture HLS sur le Play:3. Le relais `/art`
recevait une URL encore XML-encodée (`&amp;` → 404 chez l'enceinte ; `&` → JPEG).

**Pages modifiées** :
- `3_plugins/3_15_sonos.md` — section datée : `parseDidl` décode les champs texte avant le proxy.

**Index** : date de `3_15` inchangée (même jour).

## [2026-09-19] update | Recapture Sonos en lecture

**Déclencheur** : lecture HLS réelle sur le Play:3 ; remplacement de la fixture DIDL
construite.

**Pages modifiées** :
- `3_plugins/3_15_sonos.md` — section datée : `x-sonosapi-hls-static`, deux formes de DIDL
  sur le même flux (titre qui porte l'artiste + source en `creator`, puis titre / artiste /
  album séparés), pochette `/getaa` relative, pas un direct.

**Index** : 1 ligne mise à jour (`3_15`).

## [2026-09-19] update | Plugin Sonos phase 1 (UPnP local)

**Déclencheur** : session d'intégration du plugin `sonos` sur le parc réel (une enceinte Port
et un Play:3). Sondage `tools/sonos-probe.mts` puis phase 1 miroir Cast.

**Pages créées** :
- `3_plugins/3_15_sonos.md` — porte retenue (UPnP:1400, pas de compte) ; `/status/info` vide vs
  `/status/zp` ; WebSocket `:1443` refusé sans clé ; un `media_player` par enceinte ; transport
  sur le groupe / volume sur le player ; SSDP une socket par IPv4 ; fixtures de repos capturées,
  DIDL de lecture encore construit (file vide à la capture et à la vérif live) ; volume vérifié
  21 → 22 → 21, pause/next en HTTP 500 sur file vide (l'UI les grise déjà).

**Pages modifiées** :
- `3_plugins/3_3_fabricants-a-venir.md` — `sonos` retiré, tableau vide ; section datée : la piste
  UPnP était juste, le chemin nommé `/status/info` ne l'était pas. Les tests d'intégration n'ont
  plus d'exemple de squelette.
- `3_plugins/3_2_ecrire-un-plugin.md` — deux leçons : route documentée qui répond 200 vide ;
  `0.0.0.0` n'est pas « toutes les cartes » pour du multicast.
- `5_setup/5_1_configuration-env.md` — clés `SONOS_*`.
- `4_ui/4_1_navigation-et-panneaux.md` — le tiret « squelette (Sonos…) » daté : plus aucun
  `makeStubPlugin` dans `PLUGIN_FACTORIES`.

**Index** : 1 page créée, 4 lignes mises à jour (résumés complétés, dates au 2026-09-19).

## [2026-09-19] update | Fastify 5 : `maxParamLength` sous `routerOptions`

**Déclencheur** : avertissement `FSTDEP022` au démarrage du serveur (`maxParamLength` au premier
niveau des options Fastify, déprécié depuis 5.12, retiré en v6).

**Pages modifiées** :
- `6_faq/6_0_pieges-outillage.md` — entrée neuve : le warning, la copie interne des options du
  routeur, `routerOptions: { maxParamLength: 512 }` dans `apps/server/src/app.ts`.
- `6_faq/6_1_pieges-runtime.md` — sous-section datée sur l'entrée HTTP 414 : la limite 512 n'a
  pas changé, seul l'emplacement de l'option a bougé.
- `1_architecture/1_2_serveur-et-plugins.md` — sous-section datée dans l'assemblage `app.ts`.

**Index** : 3 lignes mises à jour (résumés complétés, date de `6_0` au 2026-09-19).

## [2026-09-19] update | iRobot phase 2 : la serpillière, et ce que le robot ne dira jamais en local

**Déclencheur** : phase 2 (étape 1) du plugin `irobot` sur le vrai Roomba Combo, branche
`irobot-serpillere`, commit `ec07f7e`. Journal de session
`_generated-ai-doc/sessions/2026-09-19-irobot/journal.md` (entrées `#irobot phase2`) et capture
`favori-capture.json`.

**Pages modifiées** :
- `3_plugins/3_14_irobot-roomba.md` — deux sections datées et un ajout dans une section existante.
  (a) La serpillière au contrat : les deux valeurs de `detectedPad` observées et la règle de lecture
  qu'elles imposent, `tankLvl` établi comme un POUR CENT en le confrontant à l'appli du fabricant,
  réservoir retiré = niveau effacé, capacité déclarée d'après `cap.scrub`. La phrase d'ouverture
  « aucun champ n'a été ajouté au contrat » est explicitement datée de la phase 1 et corrigée, non
  réécrite. (b) L'exploration de phase 2 : trois portes fermées (aucune position publiée — sonde de
  160 s sur une mission par régions, zéro clé neuve, donc pas d'animation 3D par la voie locale ;
  `pmaps` réduit à un id et une version ; consommables au cloud) et une ouverte — un favori lancé
  depuis l'appli inscrit son ordre COMPLET dans le `lastCommand` local, d'où des zones faisables en
  rejouant un ordre capturé, avec la piste « un favori = une scène de plugin ». Compteurs de vie
  locaux chiffrés. (c) Dans la section du délai de grâce : l'appli du fabricant fait elle-même
  `pause` puis `dock` six secondes plus tard — la mesure devient une certitude.
- `1_architecture/1_1_contrat-appareils.md` — capacité `mop` et champs `mopAttached` / `tankLevel`,
  facultatifs ; pourquoi deux champs et pas cinq (`padWetness` et les deux `pad*Allowed` sont des
  réglages de station) ; pourquoi un réservoir retiré et un niveau inconnu se confondent.
- `3_plugins/3_0_simulation-mock.md` — l'aspirateur simulé lave et son réservoir se vide ; la règle
  qui s'en dégage : un champ de contrat ajouté pour un appareil réel a besoin d'un porteur simulé,
  sans quoi sa tenue d'interface n'est vérifiable que chez celui qui possède la machine.
- `4_ui/4_1_navigation-et-panneaux.md` — deux cases `.stat` et une ligne de contrôle, toutes deux
  sous condition de la capacité `mop` ; absence et `null` du réservoir retiré affichés pareil.
- `6_faq/6_1_pieges-runtime.md` — entrée neuve : `tsx watch` ne suit pas un lien de workspace, le
  serveur continue avec l'ancien contrat, le patch est filtré sans erreur, et ça ressemble trait pour
  trait au bug qu'on vient d'écrire. Le test qui tranche : rejouer le mappage hors serveur.

**Index** : 5 lignes mises à jour (résumés complétés, dates au 2026-09-19).

**Contradiction** : celle du 2026-09-19 sur le courtier (premier ou dernier arrivé) reste **ouverte**
et n'a pas été rejouée pendant cette séance.

## [2026-09-19] update | iRobot : le Roomba se pilote en local, et le détour par le cloud qui l'explique

**Déclencheur** : session d'intégration du plugin `irobot` sur le vrai robot du parc (Roomba Combo
`c755840`, firmware `stingray+24.29.5`), commit 14dae06. Journal de session
`_generated-ai-doc/sessions/2026-09-19-irobot/journal.md`, capture `shadow.json` / `transitions.json`.

**Pages créées** :
- `3_plugins/3_14_irobot-roomba.md` — pourquoi un détour par le cloud alors que tout se passe ensuite
  en local (le mot de passe local n'est plus rendu par le datagramme d'appairage : 115 tentatives,
  refus constant, `cap.pw: 0` annoncé par le robot) ; la voie du compte en trois temps et ce qui n'en
  survit pas ; découverte UDP/5678 et les deux sources d'un même robot ; courtier TLS 1.3 à session
  unique ; deltas et ombre accumulée ; `phase` avant `cycle` (4 s puis 11 s mesurées) ; le piège
  majeur d'une commande acceptée et perdue, avec les trois mesures du délai de grâce et sa borne
  `KASBAH_COMMAND_TIMEOUT_MS` ; ce qui reste hors contrat ; fixtures curées dont deux construites.

**Pages modifiées** :
- `3_plugins/3_3_fabricants-a-venir.md` — `irobot` retiré du tableau + section datée : la piste avait
  la bonne porte (MQTT local) mais l'appairage local qu'elle annonçait est précisément ce qui ne
  marche plus. Leçon neuve pour ce tableau : une piste vieillit aussi **par le bas**, un fabricant
  pouvant retirer une voie d'accès par firmware. `sonos` devient le seul vrai squelette.
- `3_plugins/3_2_ecrire-un-plugin.md` — trois leçons transposables : (a) une voie d'accès retirée par
  firmware et annoncée dans les métadonnées de l'appareil ; (b) l'accusé dit « reçu », jamais
  « fait » — vérifier l'effet, et accepter qu'une commande du contrat vaille une suite de verbes
  dépendant de l'état ; (c) des délais mesurés et non choisis, attendus sur l'état publié, bornés par
  `KASBAH_COMMAND_TIMEOUT_MS`.
- `4_ui/4_1_navigation-et-panneaux.md` — la vue Robots accueille les aspirateurs avec une carte
  volontairement plus courte (et pourquoi), et le débordement de 47 px de `VacuumControl`
  (`flex-shrink: 0` de Vuetify, 342 px dans 294) resté invisible parce que le sous-item `vacuum` du
  mock est décoché.

**Contradiction relevée (non tranchée)** : le journal de session mesure un courtier qui **refuse la
seconde session** (`ECONNREFUSED`, premier arrivé premier servi) ; le commentaire de tête de
`apps/server/src/plugins/irobot/mqtt.ts` écrit l'inverse (« le dernier arrivé gagne », l'appli du
fabricant nous chasse). Documentée dans la nouvelle page, section « Contradiction détectée
2026-09-19 ». Aucune ligne de code touchée.

**Index** : 1 ligne ajoutée, 3 lignes mises à jour.

## [2026-09-19] update | Renault : le POST est une commande, le 409 une cadence, et une voiture endormie ne se réveille pas

**Déclencheur** : branche `claude/r5-auto-start-ec4c69`. La R5 branchée avec du surplus
solaire ne démarrait pas sa charge, alors que le « réveil de charge » du plugin est censé rattraper
exactement ce cas. Diagnostic mené sur le vrai véhicule et le vrai serveur.

**Pages modifiées** :
- `3_plugins/3_9_renault.md` — trois affirmations CORRIGÉES sur place par des notes datées (le POST
  `ev/settings` présenté comme une écriture de réglages, le corollaire « c'est l'écriture qui
  réveille, pas son contenu », les actions `kca` supposées interdites), puis une mise à jour
  2026-09-19 qui porte la chronologie à la seconde du 409, l'hypothèse du no-op testée et infirmée,
  les trois preuves qu'une R5 endormie ne se réveille par aucune API (appli du constructeur
  comprise), le 200 d'`actions/hvac-start` et sa nuance, le quota propre aux actions, le recoupement
  voiture/borne, ce qui a été codé et les deux pistes reportées.
- `1_architecture/1_1_contrat-appareils.md` — `readAt` date les VALEURS et non l'appel : quand le
  fabricant date sa donnée, c'est SA date qui gagne ; sur une R5 sans notion de veille, c'est le
  seul signe qu'elle a décroché.
- `6_faq/6_1_pieges-runtime.md` — deux entrées : le quota propre aux ACTIONS et le compte bloqué une
  heure (budget du COMPTE, pas du processus — un script de diagnostic s'ajoute au serveur), et des
  heures de réveils refusés sans trace hors console (pendant du piège du 2026-09-18 sur le réglage
  sans destinataire).
- `1_architecture/1_3_protocole-rest-ws.md` — la forme d'un `/status` de plugin qui rend compte
  d'une action autonome (`lastWake`, trois issues dont `deferred` : « pas maintenant » n'est pas une
  panne). Demandé par l'utilisateur après relecture.
- `3_plugins/3_3_fabricants-a-venir.md` — **contradiction du 2026-09-17 ARBITRÉE** par l'utilisateur :
  le tableau est purgé des cinq squelettes déjà implémentés (`nest`, `google_home`, `enphase`,
  `tesla`, `renault`) et ne garde que `sonos` et `irobot`, qui sont les seuls `makeStubPlugin` du
  code. Chaque ligne retirée garde sa mémoire dans sa section datée ; la phrase sur les secrets
  OAuth, orpheline après la purge, est réécrite.

**Vérification** : faits recoupés avec le diff de la branche (`isDeferred` dans `client.ts`,
`commandSummary` et `patch.readAt` dans `mapping.ts`, `WakeOutcome` dans `index.ts`, fixtures
`SETTINGS_COMMAND` / `SETTINGS_PENDING`, clés i18n `settings.renault.wake*`). Aucune valeur
personnelle dans le wiki : VIN, compte Kamereon, plaque et position restent hors des exemples.

**Rebond en fin de séance** : la voiture rebranchée chargeait vraiment (puissance mesurée à la borne et
par l'onduleur) pendant que Kasbah ET l'appli MY Renault annonçaient « pas en charge ». Une lecture
de `battery-status` a montré que **`chargingStatus` ment** : `0.3` dans une trame de cinq minutes où
`batteryLevel` grimpe et où le temps de charge restant est daté de l'instant. `3_9_renault.md` gagne
une mise à jour (bis) et une correction sur place de « seul `1.0` est en charge » ; le plugin croise
désormais avec un second témoin (`isCharging`), ce qui le rend plus juste que l'application du
constructeur — laquelle ne croise pas.

**Reste ouvert** (non documenté comme acquis) : la sixième condition du réveil, dont ce rebond change
l'orientation — le meilleur démenti n'est pas l'âge de la donnée mais la consommation de la maison,
que Kasbah voit et que Renault ne voit pas — et `hvac-start`/`cancel` en réveil de première
intention.

**Index** : 5 lignes mises à jour.

## [2026-09-19] update | fenêtres de toit et puits de lumière : surface, cotes, trou, panneau Maison

**Déclencheur** : feature Velux / puits de lumière, puis retours utilisateur (cadre vertical, cotes
à deux côtés, pas de contrôles sur Toit, chevauchement avec un skylight, libellés largeur/hauteur,
bascule sur le 1er à la sélection, toit sans trou après pose).

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — `roof-window` / `skylight` (`x`/`y`/`yaw`), validation par
  type (sol ≠ toit), écriture.
- `2_maison/2_1_geometrie.md` — `surface.ts`, trous de dalle et de toiture, `buildRoofMesh`.
- `1_architecture/1_5_scene-3d.md` — cadre plan, quatre cotes, focus Toit, `rebuildRoof`.
- `4_ui/4_1_navigation-et-panneaux.md` — section Velux dans `HouseEditPanel`, longueur × largeur.
- `1_architecture/1_5_scene-3d.md` — résolution d'un conflit de merge wiki latente (HEAD eau +
  incoming places).

**Index** : 4 lignes mises à jour.

## [2026-09-19] update | les places relues : un cône pour le sens, un niveau pour chacune, et trois endroits où les poser

**Déclencheur** : premier essai des places de stationnement regardé dans la scène par l'utilisateur,
capture à l'appui. Neuf remarques : l'orientation invisible, le marquage trop marqué, le dessin à
l'envers (trait plein, « P », bloc de base), le « P » trop petit et dans un coin, la section
introuvable au bas du panneau de la maison, un débordement, l'envie de retrouver l'ajout depuis une
pièce, le niveau d'une place (toit pour un drone, garage pour une voiture), et la question de la base
de robot — « ça ne doit pas faire partie du plugin concerné ? ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — le cône « regarde vers » repris du guide d'un appareil
  orientable, le marquage retourné (trait plein derrière, « P » central lisible depuis l'avant),
  l'opacité baissée, le cadrage qui ne passe plus sous le sol, `groundTap` qui porte le niveau de la
  surface touchée, et la place sélectionnée qui se montre hors mode édition.
- `2_maison/2_0_format-house-json.md` — `levelId` : ce qu'il décide (altitude et passe, hôte des
  cotes, emprise de niveau à défaut de pièce) et pourquoi une place sans niveau garde l'ancien calcul.
- `4_ui/4_1_navigation-et-panneaux.md` — `HouseEditPanel` qui remplace le panneau de la maison en
  édition, la même section de places dans le panneau d'une pièce, la station du robot sous sa carte
  dans la vue Robots (et pourquoi elle n'est pas un bouton de commande), une base par robot, et la
  ligne qui ne déborde plus.

**Réponse à la question de la base** : elle reste une PLACE (`site.parkings[]` avec `deviceId`), pas
une donnée de plugin — un plugin ne connaît ni le repère de la maison ni ses niveaux, et la base
d'un robot est un objet de la maison au même titre qu'un garage. Ce que la vue Robots apporte, c'est
le chemin : on la pose depuis le robot, comme un appareil qui attend sa place.

**Suite du même essai** : la ligne « Orientation » d'une place mentait (« +5° » affichait « -5° », le
`yaw` tournant dans le sens trigonométrique). Elle est remplacée par celle d'un appareil orienté —
deux icônes de rotation et la saisie directe de l'angle — et le cap d'une place s'écrit maintenant
dans `[0, 360[`, comme celui d'un appareil.

**Index** : 5 lignes mises à jour.

## [2026-09-19] update | les `.tmp` de `.state` : les tests écrivaient l'état réel, et les chemins mentaient une fois bundlés

**Déclencheur** : « j'ai pas mal de fichiers state tmp qui trainent, j'ai l'impression qu'il y a des
pbs d'écriture ou de suppression ». Les 32 fichiers n'étaient pas la panne mais sa trace : tous
contenaient du JSON complet et valide (l'écriture réussissait, seul le `rename` manquait), et l'un
d'eux portait une valeur de fixture. Empreintes md5 du dossier avant/après un `vitest run` : la
suite modifiait réellement `comap-consumption.json` et `melcloud-history.json`. Récidive du piège
consigné le 2026-09-10 pour `CAST_KNOWN_FILE`, que la discipline par plugin n'avait pas tenue.
Correctif structurel (`KASBAH_STATE_DIR` + `setupFiles`), et au passage la profondeur de dossiers
en dur, fausse dès que le serveur est bundlé dans `dist/main.js`.

**Pages modifiées** :
- `1_architecture/1_2_serveur-et-plugins.md` — sous-section `core/paths.ts` : `SERVER_ROOT`,
  `REPO_ROOT`, `stateFile()`, et pourquoi huit copies d'une remontée de dossiers valaient un module.
- `5_setup/5_1_configuration-env.md` — `KASBAH_STATE_DIR` ajoutée au tableau des variables serveur,
  plus une sous-section datée sur les dix clés `*_FILE` regroupées et l'isolation des tests.
- `5_setup/5_2_production.md` — sous-section datée : le défaut de `KASBAH_STATIC_DIR` désignait un
  dossier hors du dépôt une fois bundlé ; masqué jusqu'ici par `.env.example`.
- `6_faq/6_1_pieges-runtime.md` — entrée du 2026-09-19, reliée à celle du 2026-09-10 dont elle est
  la récidive ; garde aussi ce qui reste ouvert (la sauvegarde en « feu et oubli » inchangée).

**Index** : mis à jour (4 lignes).

## [2026-09-18] update | les places de stationnement : l'engin au repos se range, et on pose les places au sol

**Déclencheur** : « les véhicules, les robots ont des positions GPS approximatives […] je propose de
définir des positions de stationnement (rectangle au sol avec avant/arrière) et si l'élément est au
repos et proche alors on le déplace automatiquement ». Trois arbitrages posés avec l'utilisateur
avant d'écrire : l'édition se fait **comme la pose d'une ouverture, mais au sol** (avec les cotes sur
les quatre côtés) ; « au repos » se lit **sauf preuve du contraire** (la R5 ne publie ni vitesse ni
rapport) ; le marquage est **toujours tracé**, discret.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — `site.parkings[]` : pourquoi deux champs seulement disent qui
  a droit à quelle place (`accepts` pour le kind, `deviceId` pour la base d'un robot), le `kind`
  écarté, la règle d'accrochage partagée (`assignParkings`, `atRest`, `parkingHost`), l'écriture
  (`newParkingSchema`, `parkingPatchSchema`, `margin: 0` qui efface).
- `1_architecture/1_5_scene-3d.md` — ce que la scène en fait : elle range (`computeParkingFixes`, la
  place qui passe avant le cap déduit, le `yawOffset` qui ne s'y ajoute pas), elle dessine (peinture
  au sol contre objet, et la peinture qui ne suit PAS le thème), elle laisse poser (mode édition au
  sol, `groundTap`, quatre cotes) ; plus le crochet `parkedAt` sans lequel la tondeuse dérivait de sa
  base entre deux reconstructions, et le chemin court `updateParkings`.
- `1_architecture/1_3_protocole-rest-ws.md` — les trois routes `/api/house/parkings`, sixième
  écriture de `house.json` ouverte à l'UI, et pourquoi une suppression n'a rien à libérer.
- `4_ui/4_1_navigation-et-panneaux.md` — la section dans le panneau de la MAISON (une place
  n'appartient à aucune pièce), le menu qui nomme une base d'après son robot, `ParkingPanel`, et le
  réglage qui s'appelle maintenant « Régler la maison ».

**Index** : 4 lignes mises à jour.
## [2026-09-18] update | l'eau de la piscine cesse d'être une image figée

**Déclencheur** : « pour la piscine, possible de faire en sorte que la surface de l'eau ne soit pas
statique ? un shader (ex https://www.shadertoy.com/view/MdlXz8) ? ». Trois questions posées avant
d'écrire — portée (ondes seules, caustiques seules, ou les deux), cadence, styles concernés — parce
que le coût ne vient pas du shader mais de la boucle de rendu, qu'une eau animée fait tourner en
permanence. Réponses : les deux, 10 Hz avec piscine visible et hors qualité basse, tous les styles
sauf `maquette`.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section « l'eau de la piscine bouge, et ce qu'on paie pour ça » :
  les deux gestes (houle qui incline la normale de la surface, caustiques en lumière ajoutée sur le
  fond) et leurs points d'injection dans le shader standard de three, la raison d'être de
  `customProgramCacheKey`, la note de LICENCE (principe repris de Shadertoy, lignes écrites ici :
  CC BY-NC-SA n'entre pas dans le dépôt), les trois portes de coût de `syncWater`, la cadence par
  animation (`Animation.hz`), la SOLUTION DE REPLI si ça rame (exiger une part minimale d'écran
  occupée par la piscine, avec la mesure à écrire ; écartée à la première écriture), et le test qui
  vérifie que les points d'injection de three existent encore. Complément d'une phrase à « Rendu à la
  demande » pour que la cadence par animation soit trouvable depuis le haut de la page.

**Index** : mis à jour (1 ligne, résumé de `1_5_scene-3d` complété).

## [2026-09-18] update | vantaux, matière et couleur d'un ouvrant — et une pilule qui cesse d'être à 2 m de sa fenêtre

**Déclencheur** : « comme on a les vantaux, matériaux et couleurs sur les ouvrants, j'aimerais qu'on
puisse avoir ces attributs sur les volets » + « la pilule pour un volet est assez éloignée de
l'ouvrant, ça me paraît bizarre ». Trois questions posées avant d'écrire (périmètre : tous les
ouvrants ; vantaux : refends seulement, la course ne change pas ; matières : sans le verre) — puis
l'utilisateur a rouvert deux d'entre elles en cours de route : le VERRE finalement oui (les portes de
garage vitrées existent), et le TISSU en plus, pour les ouvertures comme pour les ouvrants. Une
quatrième question à la fin : que faire de la `position` périmée dans le fichier ? Réponse : la
synchroniser.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — `coverMaterial` / `coverColor` / `leaves` d'un ouvrant
  (mêmes matières que les ouvertures, `fabric` ajouté à `OPENING_MATERIALS` ; préfixe `cover` parce
  que `style.color` occupe déjà le mot sur un appareil), chaîne vide qui efface, et le recalage de la
  `position` d'un ouvrant lié à chaque écriture d'ouverture (`alignDevicesOnOpenings`) — avec des
  écarts de plus de 2 m mesurés sur la vraie maison (mur compris) et le recalage en une passe de
  tous les volets.
- `2_maison/2_1_geometrie.md` — `openingCentre`, le centre d'un `OpeningRect`, dit une fois.
- `1_architecture/1_5_scene-3d.md` — l'ancrage d'un ouvrant lié sur sa baie (pilule, clic, cadrage),
  le tablier refendu, le rôle de menuiserie `slat` (verre translucide sans ombre portée, tissu mat),
  l'aperçu de teinte qui se détache du matériau partagé, et la baie habillée qui laisse son vantail à
  l'appareil — y compris à l'arrivée tardive des descripteurs.
- `4_ui/4_1_navigation-et-panneaux.md` — la carte pliante `CoverTuning`, ses trois lignes, et
  `canTakeOpening` qui accepte désormais une porte de garage.

**Pages créées** : aucune.

**Index** : 4 lignes mises à jour (résumés complétés, dates déjà au 2026-09-18).

## [2026-09-18] update | la vue iso, reprise et livrée en DEUX modes — et un réglage qui ne parlait à personne

**Déclencheur** : « peut-on ajouter un mode vue iso à la vue 3D ? peut-être faut-il mettre cette
option dans les params du rendu 3d ». C'est la proposition laissée de côté à l'entrée précédente,
reprise ici. Question posée avant d'écrire : orthographique libre, isométrie verrouillée, ou simple
angle prédéfini ? Réponse de l'utilisateur : **les deux premières**, donc deux modes « iso ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — la projection. La décision qui porte tout le reste (la POSE
  reste celle de la perspective, l'orthographique n'ajoute qu'un zoom, donc la bascule ne déplace
  rien) et la voie écartée avec son motif (le recul fixe à la CAO, qui aurait mis un mur devant
  chaque `focusDevice`). Le tronc de base, les bornes de distance traduites en bornes de zoom, les
  rails de l'isométrie et le geste qu'elle rend (le doigt déplace au lieu de tourner), et les trois
  gestes non évidents d'un échange de caméra — dont la chaîne d'image à refaire, parce que `GTAOPass`
  tient sa caméra. Plus le constat sur « Qualité ».
- `4_ui/4_2_theme-et-langues.md` — `kasbah.sceneProjection` dans la table des préférences de
  tablette, les clés `render.projection*`, et pourquoi le sélecteur dit « À plat » quand le mot juste
  est « Orthographique » (mesures de largeur à trois tailles d'écran).
- `6_faq/6_1_pieges-runtime.md` — un réglage persisté, validé, affiché… et lu par personne. Avec ce
  qui l'a caché deux semaines : un défaut `auto` qui tombait juste.

**Index** : mis à jour (3 lignes).

## [2026-09-18] update | le tilt-shift, et une molette que les étiquettes avalaient depuis toujours

**Déclencheur** : question de l'utilisateur en marge de la session précédente — « serait-il possible
d'appliquer un tilt-shift comme on en voit sur certaines photos ? » — puis « ok pour l'effet ». La
vue iso, proposée en même temps, n'a PAS été retenue pour l'instant. Puis un signalement en cours de
route : « si le curseur de la souris est sur une pilule, on ne peut plus zoomer », qui s'est avéré
sans rapport avec l'effet.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — deux sections. Le tilt-shift : pourquoi une bande d'écran dit la
  même chose qu'une optique inclinée à cette plongée, le choix des deux passes séparables, les
  constantes interpolées depuis le JS pour que les pilules suivent la même courbe que le shader, et
  le fait que l'effet n'appartient à aucun style. La molette : la cause (une pilule cliquable reçoit
  aussi la molette) et le périmètre du relais (la molette, pas le glissement).
- `2_maison/2_0_format-house-json.md` — les quatre champs de tilt-shift, et pourquoi ils sont
  absolus quand le reste est multiplicateur.
- `4_ui/4_1_navigation-et-panneaux.md` — le groupe de curseurs, et le curseur « pilules floutées »
  comme réponse rendue à l'utilisateur plutôt que tranchée.
- `4_ui/4_2_theme-et-langues.md` — le groupe i18n et le choix de son nom.
- `6_faq/6_1_pieges-runtime.md` — le piège, et la leçon de méthode qui vaut plus que lui : un défaut
  remarqué après un changement n'en vient pas forcément, et ça se démontre en éteignant le suspect.

**Index** : mis à jour (5 lignes).

## [2026-09-18] update | régler la lumière de la scène devant la maison, et l'enregistrer dans la maison

**Déclencheur** : demande de l'utilisateur, à partir de trois captures de la vue Maison de nuit —
« les effets sont sympa mais ça pète quand même un peu les yeux ». Le diagnostic a trouvé quatre
sources empilées, pas un réglage de travers. Proposition d'un pack de réglages conservateur ; réponse
de l'utilisateur : **rendre tout ça paramétrable**, un bouton dans les Réglages qui emmène sur la vue
3D, des curseurs en direct, et on déduira un défaut ensuite. Puis, second temps : des **préréglages**
choisis, un bouton **Enregistrer** à la place de « Copier » (« j'imagine que ça va atterrir dans le
json de la maison »), et un **Réinitialiser** qui reste toujours présent.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section « Banc de réglage de la lumière » : le diagnostic en
  quatre points chiffrés (seuil de bloom seuillé sur des valeurs LINÉAIRES, halo additif compté deux
  fois, trait peint au-dessus de 1, ACES qui désature), le choix des multiplicateurs contre des
  valeurs absolues, le chemin court `setTuning`, et les quatre préréglages avec la question à
  laquelle chacun répond.
- `2_maison/2_0_format-house-json.md` — section `render.tuning` : pourquoi la maison et non la
  tablette, l'effacement de la section quand le réglage est neutre, et le renversement sur la
  validation (les `.catch()` de la première version faisaient répondre 200 à une valeur hors bornes
  puis écrivaient autre chose).
- `1_architecture/1_3_protocole-rest-ws.md` — `PUT /api/house/render`, sixième écriture de
  house.json, corps entier plutôt que patch.
- `4_ui/4_1_navigation-et-panneaux.md` — le banc posé sur la vue Maison, sa disposition, et le sens
  exact des deux boutons (ce que « Réinitialiser » ne touche pas).
- `4_ui/4_2_theme-et-langues.md` — `render.tuning.*`, et la ligne de partage préférence de tablette
  vs choix de la maison.
- `6_faq/6_1_pieges-runtime.md` — le piège `useLocalStorage` : un sérialiseur deviné d'après une
  valeur par défaut `null`, et un brouillon écrit `[object Object]`.

**Index** : mis à jour (6 lignes).

## [2026-09-18] update | la menuiserie d'une ouverture : vantaux, matière, couleur — du schéma partagé jusqu'à la 3D

**Déclencheur** : demande de l'utilisateur, en deux temps. D'abord un déplacement dans les Réglages
(« Régler les ouvertures » dans sa propre carte « Mode édition », entre plein écran et origine GPS),
puis trois paramètres de plus sur les ouvertures : nombre de vantaux (1 à 10), matière (bois, métal,
verre) et couleur — plus le renommage du libellé « Passage » en « Passage/Ouverture ».

**Deux questions posées avant d'écrire une ligne**, parce que les réponses changeaient le travail :
jusqu'où vont les paramètres (le stockage seul, ou la 3D), et sous quelle forme se choisit la
couleur. L'utilisateur a tranché pour **tout en 3D** — ce qui obligeait à découper les maillages de
menuiserie fusionnés — et pour une **couleur libre avec un « défaut »** qui rend la main à la
palette du style.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — section « Mise à jour 2026-09-18 (4) » : les trois champs
  facultatifs d'`openingSchema`, la raison de leur caractère facultatif (une maison relevée avant
  eux ne change pas d'aspect), le **tableau qui distingue les deux `leaves` du format** (les
  battants d'un portail, 1 ou 2, et les vantaux d'une menuiserie, 1 à 10 — même mot, deux objets),
  ce que la matière recouvre (dormant ET vantaux) et la convention d'effacement par chaîne vide.
- `2_maison/2_1_geometrie.md` — section « Mise à jour 2026-09-18 (4) » : `openingLeaves` et sa règle
  de déduction, **pourquoi elle vit dans `geometry/walls.ts` et pas dans `openings.ts`** (cycle
  d'imports, même arbitrage que `openingSill`), et `OpeningRect` qui porte désormais la menuiserie.
- `1_architecture/1_5_scene-3d.md` — section « Mise à jour 2026-09-18 (5) » : refends contre panneau
  découpé selon que l'ouverture est vitrée ou pleine (et pourquoi un refend n'aurait rien donné sur
  un vantail plein), `isGlazed`, et surtout la **fusion par teinte avec la clé vide** — le
  compromis qui laisse une maison ordinaire à ses deux appels de dessin. Mesures relevées dans la
  scène (36 triangles pour la menuiserie teintée à côté des 216 du maillage commun ; `#908c86` →
  `#606372` au changement de style pendant que la teinte explicite ne bouge pas).
- `4_ui/4_1_navigation-et-panneaux.md` — section « Mise à jour 2026-09-18 (6) » : les trois lignes du
  panneau, **« Auto » retenu contre « Automatique » sur mesure** (101 px demandés pour 88 offerts),
  le `×` à place réservée contre le `v-if` de `VehicleTuning`, le déplacement de l'interrupteur
  d'édition dans sa carte, et le renommage LIBELLÉ SEULEMENT de `passage`.

**Piste abandonnée, consignée dans les pages** : la première version de « Rétablir » réécrivait le
nombre de vantaux DÉDUIT (`leaves: 1`) au lieu de retirer la clé. Trouvé en vérifiant dans la vraie
app, pas par un test : sur une baie, cela l'aurait figée à deux vantaux et l'élargir n'aurait plus
rien changé. D'où le quatrième champ effaçable, et la règle générale qu'on rend la main au défaut en
RETIRANT la clé, jamais en écrivant sa valeur.

**Index** : mis à jour (4 lignes).

## [2026-09-18] update | une ouverture peut désormais naître et disparaître, et le panneau de pièce change de sujet en mode édition

**Déclencheur** : branche `claude/add-remove-openings-edit-d460e7`, rebasée sur `main`. Demande de
l'utilisateur : « maintenant qu'on a un mode édition d'ouvrants, je voudrais pouvoir en ajouter et en
supprimer », avec une question d'UI ouverte — sa piste étant qu'en mode édition, le clic sur une
pièce montre ses éléments modifiables au lieu des appareils connectés. Trois choix lui ont été
soumis avant d'écrire une ligne ; il a tranché pour **remplacer** la liste d'appareils, pour un
**menu des six natures** (plutôt qu'une fenêtre par défaut à retyper) et pour une pose **en tapant le
mur dans la 3D** (plutôt qu'un placement automatique sur le plus grand vide).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section « Mise à jour 2026-09-18 (5) » : `RoomEditPanel`, le
  cinquième `panelMode`, le tableau des trois formes pesées et pourquoi deux ont été écartées, le
  geste en deux temps (menu = nature, tap = place), la suppression armée à côté de « Rétablir », les
  mesures de la règle « rien ne bouge » (175 px, carte à 456 px dans les deux états) et un piège
  d'outillage (un menu Vuetify en cours d'animation ment sur sa position). **Précise le périmètre**
  de la section du 2026-09-18 sur le mode édition : la liste des ouvertures n'est plus collée sous
  les appareils, elle est le panneau.
- `1_architecture/1_3_protocole-rest-ws.md` — section « Mise à jour 2026-09-18 (bis) » : les deux
  routes, pourquoi le `POST` porte une ouverture ENTIÈRE et non un patch, l'id libre dans toute la
  maison, et le `DELETE` qui libère l'ouvrant dans la même écriture.
- `1_architecture/1_5_scene-3d.md` — section « Mise à jour 2026-09-18 (4) » : `setPlacingOpening`,
  le tap qui sort avant `pick()`, et surtout pourquoi le rayon vise les vraies surfaces du niveau
  quand le glissement, lui, se contente du plan du sol.
- `2_maison/2_0_format-house-json.md` — section « Mise à jour 2026-09-18 (3) » : **lève le périmètre
  annoncé** par la première section du même jour (« on n'en crée ni n'en supprime »), sans rien
  retirer de ce qu'elle disait par ailleurs ; `newOpeningSchema`, l'unicité d'id à l'échelle de la
  maison et sa raison (`devices[].openingId` ne dit pas la pièce), la règle d'écriture de l'allège.
- `2_maison/2_1_geometrie.md` — section « Mise à jour 2026-09-18 (3) » : `newOpeningDims`, le tableau
  des cotes de catalogue, et pourquoi elles sont prises sur les défauts de la maison.

**Index** : mis à jour (5 résumés complétés ; les cinq pages étaient déjà datées du 2026-09-18).

## [2026-09-18] update | les en-têtes Lumières et Ouvrants passent de l'interrupteur à deux gestes nommés

**Déclencheur** : branche `claude/lights-blinds-commands-4ada65` (commit `f29d48e`, `main` fusionné).
Demande de l'utilisateur : remplacer l'interrupteur maître des deux vues par un choix entre « tout
éteindre / fermer » et « tout allumer / ouvrir », « plus simple quand les éléments sont dans des
états différents » ; que le contrôle prenne son état cible au clic (retour arrière si problème) ; et
pouvoir **inverser la commande aussitôt**, sans attendre la fin de course d'un volet. Puis, en cours
de session : différencier volets et stores dans le libellé du résumé.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section « Mise à jour 2026-09-18 (4) » : pourquoi
  l'interrupteur ne suffisait plus, le segment qui montre l'ÉTAT et non le dernier appui, la valeur
  cible obtenue sans état d'intention local (mise à jour optimiste + position visée), le passage des
  gestes d'ensemble à `targetPosition(id) ?? position` qui autorise à se raviser, le résumé compté
  par nature (qui tranche la question laissée ouverte le 2026-09-08 sur portails, garages, rideaux et
  fenêtres), ce que `Segmented` a gagné, et ce qui a été mesuré dans le navigateur. **Précise et
  remplace** les deux sections du 2026-09-12 sur `CoversToggle` — la doctrine « sécuriser » est
  inchangée, seule la forme du contrôle change. Une section « Contradiction détectée 2026-09-18 »
  consigne « store déployé » (vue Ouvrants) contre « store baissé » (`useHomeSummary`), à arbitrer.
- `4_ui/4_2_theme-et-langues.md` — section « Mise à jour 2026-09-18 » : les quatre clés d'action,
  `covers.summary` remplacée par `covers.counts.*` (une par nature, accord dans la traduction), et
  l'appel au seul troisième argument comme manière la plus sûre vis-à-vis du piège `count` / `n`.

**Arbitrage rendu dans la foulée** : l'utilisateur tranche pour « déployé ». L'en-tête et la tuile
de la vue Maison s'alignent (`summary.awningsDown`, `home.awningsDown`, et `deployed` aux trois
endroits anglais) ; les noms de clés et `cover.upDown.*` ne bougent pas. La section
« Contradiction détectée » est **complétée** par l'arbitrage, jamais réécrite.

**Index** : mis à jour (2 lignes, résumés complétés ; `4_2` daté 2026-09-18).

## [2026-09-18] update | un ouvrant simulé déclare sa nature, sans quoi quatre règles d'interface ne se vérifiaient nulle part

**Déclencheur** : session en arbre de travail (`claude/jovial-pare-7e7e2e`), rebasée sur `main`. Constat de
départ : `packages/mock-sim/src/behaviours/cover.ts` ne posait jamais `meta.cover.deviceClass`, alors
qu'un vrai plugin le fait toujours (tous les ouvrants d'une installation TaHoma
réelle) — donc `coverWords`, `isFlatCover`, `isPassageCover` et `expectsOpening` /
`canTakeOpening` (`apps/web/src/lib/cover.ts`) retombaient toutes sur le cas du volet dans le seul
harnais qui sert à vérifier l'interface.

**Pages modifiées** :
- `3_plugins/3_0_simulation-mock.md` — nouvelle section « Mise à jour 2026-09-18 » : pourquoi la
  nature vient du fabricant et jamais du nom, `CoverOptions.deviceClass` rendue **obligatoire**, les
  deux ouvrants ajoutés au scénario `default` (store banne `cover-terrace`, portail `cover-gate`) et
  leurs entrées dans les **deux** copies de `demo-house.json` en ouvrants LIBRES (sans `openingId`,
  dimensionnés par le JSON), le test qui verrouille « aucun ouvrant muet + les trois natures qui
  divergent », et ce qui a été vérifié dans le navigateur (vocabulaire, forme 3D, geste d'ensemble
  qui épargne portail et store, compte « à affecter » 0 → 1, sélecteur d'ouverture sans le portail).
  Deux observations antérieures relevées sans y toucher : le compte « ouverts » de la vue Ouvrants
  ignore la nature, et l'interrupteur d'un ouvrant seul suit « coché = fermé ».

**Index** : mis à jour (1 ligne, résumé complété + date 2026-09-18).

## [2026-09-18] update | les crédits de la carte du radar démarrent repliés

**Déclencheur** : branche `claude/weather-map-credits-collapse-5c4cd7` — demande de replier par défaut
l'attribution MapLibre de la carte de la vue Météo. Une ligne dans
`apps/web/src/components/weather/RainRadar.vue`.

**Pages modifiées** :
- `6_faq/6_0_pieges-outillage.md` — sous-section « Mise à jour 2026-09-18 » sous l'entrée du
  2026-09-14 : nuance la phrase « un repli tenté au montage ne tient pas » (vraie pour la méthode
  d'alors), donne la condition exacte de `_updateCompact()` en maplibre-gl 6.9 et la recette d'une
  ligne (poser `maplibregl-compact` soi-même), avec la coexistence assumée des deux méthodes.
- `4_ui/4_1_navigation-et-panneaux.md` — sous-section « Mise à jour 2026-09-18 (3) » : le comportement
  côté vue Météo, renvoi à la FAQ pour le mécanisme.

**Index** : mis à jour (2 lignes : résumés complétés, date du 6_0 passée au 2026-09-18).

## [2026-09-18] update | les cotes ne se dessinaient jamais : la passe d'un niveau repeint ses murs

**Déclencheur** : troisième ingestion de la session
`_generated-ai-doc/sessions/2026-09-17-edition-ouvertures/` (journal 11:41), après la découverte de
la cause réelle d'un défaut de rendu du mode édition des ouvertures. Toujours en arbre de travail,
aucun commit.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — nouvelle section « Mise à jour 2026-09-18 (3) » : le symptôme
  (cotes jamais dessinées, poignées apparemment occluses), le **faux diagnostic** conservé pour sa
  leçon de méthode (un parent sorti ET une couche changée d'un seul geste — c'était la couche ; une
  couche n'est jamais testée sur les parents, mesuré à 13 174 → 13 246 triangles), le **mécanisme**
  (la passe d'un niveau redessine ses murs et ses sols par-dessus l'image de la passe globale, sans
  effacer, `depthWrite: false` laissant le tampon à égalité), le détail qui trompait (un trou de mur
  n'a pas de surface à redessiner, d'où le cadre qui survit dans l'embrasure), la **règle**
  (`DECOR_LAYER` + groupe `markers` du niveau, chemin du guide du mode « déplacer », groupe qui
  survit à `rebuildLevelNodes`), le **corollaire assumé** (une passe par niveau qui porte des
  poignées, **sans aucun chiffre** : rien n'a été mesuré, machine sur batterie), le second défaut
  (poignée de 0,30 m fixe → `o.depth + 0,18` ; trait de cote 2,2 → 3,5 cm) et **ce que le nouveau
  test garde**, avec les deux passes fantômes qu'il a révélées à la sortie du mode.
- Même page, **décision renversée signalée sur place** plutôt que réécrite : un encadré
  `> Décision RENVERSÉE le 2026-09-18` ouvre le paragraphe « Les poignées, et pourquoi elles ne sont
  pas sur la couche décor de niveau » du matin (`SITE_DECOR_LAYER` pour économiser une passe), dont
  l'argument reste exact mais était incomplet. Le paragraphe sur le tracé des cotes « dans le groupe
  des étiquettes » est corrigé par une précision datée : c'est finalement le groupe `markers`.

**Index** : ligne `1_5_scene-3d` mise à jour (clause `SITE_DECOR_LAYER` requalifiée en décision
renversée, mécanisme et règle ajoutés).

**Contradictions relevées, non tranchées par le wiki** :
- `apps/web/src/three/three.test.ts`, docblock du test « pose une poignée par ouverture et ne laisse
  rien en sortant » : il affirme encore « elles ne coûtent aucune passe de niveau (elles sont
  dessinées dans la passe globale) — c'est ce qui rend le mode gratuit sur l'iGPU ». C'est
  exactement la décision renversée ; le corps du test, lui, a été corrigé. **Commentaire de code
  périmé, signalé, pas touché** (le scribe n'édite pas le code).
- `apps/web/src/three/core/layers.ts` : le commentaire de `DECOR_LAYER` énumère les décors
  « des appareils d'un NIVEAU » et ne mentionne pas les décors du mode édition (poignées, cotes,
  repère d'origine), qui y vivent maintenant. Incomplet plutôt que faux.

## 2026-09-18 — `tabular-nums` était inerte : la police change

**Page** : `4_ui/4_0_langage-visuel.md` (section ajoutée en fin de page ; la puce `tabular-nums` du
2026-09-08 est marquée comme ayant été sans effet jusqu'à cette date, sans être réécrite).

Ce que la passe précédente signalait comme un trou est comblé : la page portait la règle « rien ne
doit bouger » en citant `tabular-nums` sans savoir que la propriété ne faisait rien avec la police du
projet. Mesures reportées telles quelles, avec le **contrôle sur `system-ui`** qui valide la méthode —
c'est lui qui distingue « la propriété est sans effet » de « ma mesure est fausse ».

Écrit aussi ce qu'une police tabulaire ne répare pas (le passage de `9` à `10`), et le corollaire
mesuré sur `ch` : une boîte dimensionnée en `ch` réservait déjà le pire cas, puisque `1ch` vaut la
largeur du « 0 » et que c'était le chiffre le plus large de DM Sans. Les vingt-neuf endroits vraiment
exposés étaient ceux où la valeur coule dans du texte.

**Non fait** : les vingt-neuf endroits n'ont pas été vérifiés un par un dans le navigateur ; le
changement de police les couvre par construction, seuls quelques-uns ont été mesurés
(`.stat-value`, `.big-value`, `.wx__time` : 0 px de variation).

## [2026-09-18] update | édition des ouvertures, passe 2 : quatre lots de plus, une convention de côtés, et des mesures RETIRÉES

**Déclencheur** : même session `_generated-ai-doc/sessions/2026-09-17-edition-ouvertures/` que
l'entrée ci-dessous, mais **quatre lots livrés après la première ingestion** (journal 08:05 → 10:23,
`contrat.md` second lot, `revue-ui.md` troisième section). Deux natures d'ouverture de plus et un nom
en clair, une règle de bornage inversée, la correction d'un piège de matrices monde qui rendait les
poignées injoignables, les annotations de la scène (cotes, nom, repère d'origine), et la liste de
travail des ouvrants dans la vue Ouvrants. Toujours en arbre de travail, aucun commit au moment de
l'ingestion.

**Retrait demandé, et fait** : la première passe avait fidèlement recopié les mesures de performance
du premier lot. L'auteur de ces mesures les a déclarées **nulles** le lendemain (machine sur
batterie, donc en mode économie, carte dédiée bridée dans cet état) et les a retirées des
commentaires du code ; l'utilisateur a confirmé qu'aucun arbitrage n'en découle. **Tous les chiffres
de performance ont donc été retirés de `1_5_scene-3d.md` et de sa ligne d'`index.md`** — construction
en Node (38 / 21 / 12 / 13,5 ms), image de geste (54,4 contre 78,9 ms), couche des poignées (26,0 →
17,3 ms GPU, 487 → 364 appels), ombres gelées (45,5 → 42,3 ms), les deux pistes écartées (6 ms sur
54 ; 3,4 ms sur 13,5) et la limite « ~18 images par seconde ». Ils sont **remplacés par un encadré
qui dit pourquoi ils ne sont plus là** plutôt que supprimés en silence : un chiffre absent invite à
remesurer, un chiffre faux invite à décider. Ce qui se **raisonne** (quel chemin refait quel travail,
quelle passe de rendu s'ajoute, ce qui est jeté avant d'être vu) est conservé mot pour mot ; les deux
pistes écartées le restent, sur leur seul argument non chiffré, avec « à re-décider si l'on remesure
sur secteur » pour la dégradation de qualité.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — `openingSchema.name?` (1 à 60 caractères, facultatif à
  dessein : absent, c'est l'`id` de relevé qui s'affiche, donc aucun fichier existant à retoucher ;
  `openingPatchSchema.name` suit la convention maison, chaîne vide = effacer) et le passage de
  `OPENING_TYPES` de **quatre à six** avec la raison précise — `bay` et `glass-door` disent la
  combinaison qu'aucune des quatre premières ne savait dire, **vitrée comme une fenêtre et posée au
  sol comme une porte**. Plus le piège de l'allège explicite qui survit à un retypage.
- `2_maison/2_1_geometrie.md` — la page la plus enrichie. La **convention gauche/droite dite de
  l'intérieur de la pièce** et sa démonstration (polygones contraints en sens trigonométrique ⇒
  l'intérieur est toujours à gauche de l'arête ⇒ l'observateur a `polygon[segment]` à sa DROITE),
  l'inversion qu'a affichée l'interface pendant un lot, et le test qui reconstruit la droite de
  l'observateur **depuis la normale du mur** pour que ce soit lui qui tombe si le sens des polygones
  changeait un jour. Le format n'a pas bougé : `offset` reste la distance à `polygon[segment]`. Puis
  la règle de bornage inversée (`freeSpan` / `fitWidth` / `fitHeight` / `fitGap` : **on garde la
  valeur saisie et on déplace ce qui peut l'être**), `MIN_OPENING_DIM` et l'arrondi au centimètre, et
  une **note de remplacement** en tête du paragraphe `openingLimits` — la fonction a changé de sens
  et de signature, ce que la première passe en disait n'est plus vrai.
- `1_architecture/1_5_scene-3d.md` — retrait des mesures (ci-dessus) **plus** le piège à écrire noir
  sur blanc : `matrixWorldAutoUpdate = false` ⇒ tout objet neuf garde l'identité jusqu'à l'image
  suivante et le lancer de rayon le teste **à l'origine du monde** (onze poignées sur onze
  injoignables, un tap sur la poignée dessinée émettait `roomTap`) ; remède `updateWorldMatrix(true,
  true)` à la naissance, **avec les enfants**, parce que c'est la dalle et non le groupe que le rayon
  touche. Puis les trois états de poignée distingués par l'**épaisseur** (3,5 / 7,5 cm) et non
  l'opacité, après deux essais ratés ; le cadre au repos en **tube** pour rester soumis à la
  profondeur sans être enterré dans la menuiserie ; les deux natures vitrées et `GLAZED_OPENINGS`
  dans le module feuille (cycle d'import) ; le repère d'origine ; les lignes de cote en géométrie de
  scène, le nombre **au-dessus** du trait faute de seuil en mètres capable de juger une largeur en
  pixels, et le tracé qui devenait orphelin dans le groupe du niveau.
- `4_ui/4_1_navigation-et-panneaux.md` — le panneau au complet (il **remplace** la description de la
  première passe : six natures, huit rangées, les deux cotes de position saisissables, nom au
  crayon) ; la **liste de travail des ouvrants** et le scénario qui la motive (plugin activé des mois
  après le dessin de la maison) ; la distinction de vocabulaire « sans ouverture » ≠ « non lié » ;
  `expectsOpening` (réclamé) contre `canTakeOpening` (autorisé) avec le store banne dans l'écart ; et
  le **fait mesuré** que `font-variant-numeric: tabular-nums` n'a aucun effet sur DM Sans Variable.
- `1_architecture/1_4_app-web.md` — `setCoverOpening` comme **seule** écriture de la liaison, et la
  règle « une ouverture ne porte qu'un ouvrant » (affecter libère le précédent).

**Contradictions et écarts relevés** (signalés, non tranchés) :
- `contrat.md` annonce `openingGaps → { before, after }` ; le code rend `{ left, right }` et porte la
  convention de côtés. Le contrat est la note la plus ancienne, le code a manifestement évolué
  ensuite : **le wiki suit le code**, le contrat de session est à considérer comme périmé sur ce
  point.
- Deux relevés du même parcours donnent des largeurs de chiffre différentes pour la même fonte
  (9,08 / 4,53 px d'un côté, 8,22 / 3,75 px de l'autre). Les deux sont écrits, seule la conclusion
  commune est affirmée : le rapport voisin de deux, donc l'absence de `tnum`. La cause de l'écart
  absolu n'est établie nulle part.
- `4_0_langage-visuel.md` porte la règle « rien ne doit bouger » sans savoir que `tabular-nums` est
  sans effet sur la fonte du projet. Le fait est écrit dans `4_1` parce que c'est là qu'il a été
  mesuré ; **la page `4_0` n'a pas été touchée** et reste, sur ce point, incomplète.
- `3_0_simulation-mock.md` ne dit pas que `packages/mock-sim/src/behaviours/cover.ts` ne pose jamais
  `meta.cover.deviceClass`, ce qui rend la liste de travail des ouvrants invérifiable contre la
  maison de démo. La limite est écrite dans `4_1` ; **`3_0` n'a pas été touchée** pour rester sous la
  règle des cinq pages.

**Index** : 5 lignes mises à jour (résumés complétés, chiffres de performance retirés de la ligne
`1_5`), dates déjà au 2026-09-18.

## [2026-09-18] update | mode édition des ouvertures : une écriture imbriquée, une règle de glissement, un troisième chemin de scène

**Déclencheur** : session `_generated-ai-doc/sessions/2026-09-17-edition-ouvertures/` (journal 23:58
→ 07:40, 30 lignes, plus `contrat.md`, `brief.md` et `revue-ui.md` avec sa contre-visite). Livraison
d'un **mode édition des ouvertures** : armé par un interrupteur des Réglages, il rend fenêtres et
portes sélectionnables et glissables dans la vue Maison, avec un panneau pour leurs cotes (nature,
largeur, hauteur, hauteur d'allège) et le lien vers un ouvrant. Travail en arbre de travail, aucun
commit posé au moment de l'ingestion : `packages/shared/src/house/openings.ts` (+ test),
`packages/shared/src/house/place.ts`, `apps/server/src/http/routes.ts` (+ `openings.test.ts`),
`apps/web/src/three/HouseScene.ts`, `apps/web/src/composables/useHouseScene.ts`,
`apps/web/src/stores/{house,settings}.ts`, `apps/web/src/api/*`,
`apps/web/src/components/home/{OpeningPanel,RoomPanel}.vue`,
`apps/web/src/views/{HomeView,SettingsView}.vue`, i18n.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — la cinquième écriture de `house.json` ouverte à l'UI, et la
  première dont la cible est **imbriquée** (`rooms[i].openings[j]`) ; même moule que les quatre
  autres (patch du JSON brut, `parseHouse` avant écriture, `.bak`, diffusion `house`) ;
  `devicePlacementSchema.openingId` devenu écrivable (chaîne vide = délier) et **pourquoi lier
  ré-ancre** l'appareil sur la pièce de l'ouverture — `validate.ts` refuse le contraire. Périmètre :
  ni création ni suppression, le format lui-même n'a pas bougé.
- `2_maison/2_1_geometrie.md` — la géométrie d'**édition** (`openings.ts`), module frère de
  `walls.ts` : la règle de validation prise « à l'endroit » (on RAMÈNE au lieu de refuser, pour
  qu'un geste ne fabrique jamais une maison rejetée), les deux temps de `slotFromPoint` (le mur le
  plus proche décide sur quel mur, l'intervalle libre courant décide où), le rôle du paramètre
  `from` avec le tableau avant/après du **saut de 1,80 m** mesuré par la revue, la nuance du mur de
  retour, `openingLimits`, et les invariants (19 tests, 1 200 positions).
- `1_architecture/1_3_protocole-rest-ws.md` — la route
  `PUT /api/house/rooms/:roomId/openings/:openingId`, ses deux façons de faire 400 (zod, puis
  `parseHouse` qui laisse le fichier intact), le fait que le lien ouvrant↔ouverture n'a pas de route
  à lui, et `Transport.saveOpening`.
- `1_architecture/1_5_scene-3d.md` — le **troisième chemin de reconstruction**
  (`sameShellButOpenings` → `updateOpenings`, entre `updateDevices` et `load`), ce qu'il refait et
  les deux précautions de `rebuildLevelNodes` (marqueurs repris tels quels sous peine de rouvrir les
  volets fermés ; matériaux de poignées partagés entre niveaux) ; les chiffres avec leurs conditions
  (13,5 ms contre 38 ms en construction Node sur la vraie maison ; 54,4 contre 78,9 ms par image de
  geste, Chrome à part sur iGPU, medium, 1904 × 905) ; les poignées et le passage en passe globale
  `SITE_DECOR_LAYER` (26,0 → 17,3 ms GPU, 487 → 364 appels) ; le piège du `Raycaster` aveugle hors
  couche 0 ; les deux économies gardées (ombres gelées 45,5 → 42,3 ms, une position par image) ; les
  **deux pistes écartées après mesure** (qualité dégradée : 6 ms sur 54 contre bloom et vignette ;
  `LevelGeometry` d'un seul niveau : 3,4 ms contre une copie de `computeHouseGeometry` qui
  dériverait) ; et les limites connues écrites noir sur blanc.
- `1_architecture/1_4_app-web.md` — l'état et les actions d'ouverture du store `house`, et la
  décision centrale : le **brouillon n'est pas un calque**, il entre dans la maison rendue
  (`withOpeningDraft` en tête d'`expanded`), donc ce qu'on voit pendant le geste est ce qu'on
  gardera ; `setOpeningDevice` qui délie avant de lier ; pas de mise à jour optimiste.
- `4_ui/4_1_navigation-et-panneaux.md` — l'interrupteur dans **Réglages** et pourquoi pas dans la
  scène (tablette posée à demeure) ; le panneau d'ouverture et la liste « Ouvertures » ; le
  **piège de mise en page chiffré** (quatre segments = 393 px de `min-content` dans 294 px,
  débordement inconditionnel puisque `--aside-w` est en dur, et un Tab qui décalait tout le panneau
  de 91 px — sortie par un `v-select` à largeur fixe) ; les trois garde-fous d'état appris de la
  revue (armement au chargement, désarmement qui ferme le réglage, tap d'appareil qui ne vole plus
  la sélection) ; et ce qui reste assumé.

**Index** : 6 lignes mises à jour (résumés complétés, date au 2026-09-18).

**Points laissés de côté, faute de source ou par prudence** :
- `clampSlot` était exporté sans aucun appelant hors tests. Signalé par cette ingestion, **retiré**
  dans la foulée avec ses trois tests : une API qu'aucun geste n'appelle est du code spéculatif, pas
  une réserve. `segmentLength` n'est plus exportée non plus (elle ne sert qu'à `openingLimits`).
- La clé `kasbah.houseEditing` n'est pas listée dans le tableau des préférences de
  `4_ui/4_2_theme-et-langues.md` : ce tableau vit dans une section datée du 2026-09-15 qu'on ne
  réécrit pas. La clé est documentée dans `4_1`, et le renvoi est signalé là.
- Rien n'a été mesuré **sur la pile serveur réelle** : toute la revue UI a tourné en mock in-process,
  donc les 400 de `parseHouse` vus par l'utilisateur et le message `opening.saveError` n'ont jamais
  été observés en vrai. Les tests serveur, eux, les couvrent.

## [2026-09-17] update | plugin MELCloud, vue Chauffage et deux champs de contrat

**Déclencheur** : session `_generated-ai-doc/sessions/2026-09-17-melcloud-chauffage/` (journal 21:00
→ 21:35, 15 lignes). Implémentation de bout en bout du plugin **MELCloud** (pompes à chaleur
Mitsubishi Ecodan Zubadan) après capture du vrai compte, nouvelle **vue Chauffage** côté tablette, et
deux champs facultatifs ajoutés au contrat partagé. Aucun commit posé au moment de l'ingestion
(travail en arbre de travail : `apps/server/src/plugins/melcloud/*`, `apps/web/src/views/HeatingView.vue`,
`apps/web/src/components/heating/*`, `apps/web/src/components/MelcloudLinkCard.vue`,
`packages/shared/src/devices/{kinds,descriptor}.ts`, `apps/web/src/three/markers/markers.ts`,
`apps/server/.env.example`, i18n, tests).

**Pages créées** :
- `3_plugins/3_13_mitsubishi-melcloud.md` — page complète du plugin : l'API cloud non officielle et
  le mot de passe échangé une fois contre une `ContextKey`, le HTTP 200 systématique, **ce que la
  capture a démenti** (un appareil pour plusieurs Zubadan, aucun ballon, zone 1 ambiante / zone 2 loi
  d'eau, aucun compteur d'énergie prouvé par un mois d'hiver à zéro), la décision
  `ListDevices` / jamais `Device/Get` (210 champs contre 42), les quatre pièges avec leurs symptômes
  (`ErrorCode` 8000, `RoomTemperatureZone2` = -39, `Offline` qui ment, deux bases de temps sans
  fuseau), ce qui est publié et ce qui ne l'est pas, l'historique construit par sondage, les clés
  `MELCLOUD_*` et la route `raw` à fenêtre réglable.

**Pages modifiées** :
- `3_plugins/3_3_fabricants-a-venir.md` — `melcloud` sort du tableau (sa ligne est citée
  intégralement dans la section datée) : piste juste mais **incomplète** sur deux points (zones d'une
  machine air-eau, absence totale de données d'énergie) ; rôle d'exemple de squelette des tests
  d'intégration passé à `sonos`.
- `1_architecture/1_1_contrat-appareils.md` — `meta.climate.control` (`room` | `flow`, décide le
  vocabulaire) et `meta.climate.deviceClass` (`thermostat` | `heat_pump`, décide le marqueur 3D),
  tous deux facultatifs et sans effet sur l'existant ; pourquoi deux champs et non un ; et
  `ClimateControl.vue` qui ne consultait aucune capacité, démasqué par le premier appareil `climate`
  réel.
- `4_ui/4_1_navigation-et-panneaux.md` — vue Chauffage `/heating` (rail, icône `radiator`, machine et
  historique en tête, `RoomBands` sans liste de zones séparée, carte machine à dix lignes fixes,
  graphique 48 h sans kWh) et les deux leçons de mise en page (un contrôle de panneau ne se transpose
  pas sur une page pleine ; les commandes d'une ligne de `RoomBands` prennent leur propre rangée).
- `3_plugins/3_2_ecrire-un-plugin.md` — mise à jour 2026-09-17 (bis) : `z.unknown()` ne rend pas une
  clé facultative en zod 4, et un drapeau d'état du fabricant peut mentir (préférer une preuve
  mesurable).

**Contradictions relevées, non tranchées** :
- `3_plugins/3_3_fabricants-a-venir.md` : le tableau des squelettes liste encore `nest`,
  `google_home`, `enphase`, `tesla` et `renault`, tous implémentés (et `google_home` n'existe plus
  sous ce nom). Section `### Contradiction détectée 2026-09-17` ajoutée, arbitrage demandé.
- `3_13` note que la fixture du dépôt ne contient **pas** le cas `Offline: true` : le mensonge du
  drapeau est attesté par l'observation en session et les commentaires de code, pas par un fichier
  rejouable.

**Restent à faire** (hors périmètre de cette session d'ingestion) : `5_setup/5_1_configuration-env.md`
(clés `MELCLOUD_*`), `4_ui/4_0_langage-visuel.md` (icône `radiator`),
`4_ui/4_2_theme-et-langues.md` (sections i18n `heating.*`, `climate.flow*`, `settings.melcloud.*`),
`1_architecture/1_5_scene-3d.md` (marqueur `heat_pump`, bloc 60 × 36 × 120 cm) et
`6_faq/6_0_pieges-outillage.md` (entrée zod 4 : `z.unknown()` reste requis).

**Index** : mis à jour (1 ligne ajoutée, 4 résumés complétés).

## [2026-09-17] update | une barre de recherche dans la vue Maison

**Déclencheur** : session d'équipe `_generated-ai-doc/sessions/2026-09-17-recherche-vue-3d/`
(journal 12:54 → 13:25, revue UI chiffrée au HEAD `4ef451f`). Nouvelle fonctionnalité : un champ de
recherche flottant en bas de la vue 3D, qui atteint pièces, zones, niveaux, appareils, ambiances et
pages du rail. Aucun commit encore posé au moment de l'ingestion (travail en arbre de travail :
`lib/search.ts`, `composables/useSearch.ts`, `components/home/SearchBar.vue`, `lib/navItems.ts`,
`views/HomeView.vue`, `styles/tokens.css`, `lib/strokeIcons.ts`, i18n, 16 tests).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section principale : les cinq décisions (aucun index, rien
  à déclarer côté plugins, un résultat navigue et n'agit jamais, focalisation du niveau, appareils
  non placés montrés), le score à trois crans et la marque au dixième du nom, les mesures de « rien
  ne bouge » (1 géométrie sur 31 états de frappe, bas de liste figé à 732 px, croix à place
  réservée), les deux défauts corrigés après revue (`text-overflow` sur le champ, liseré `outline`
  sur la ligne active : 1,26:1 → 5,8:1), les contrastes aux deux thèmes, et le recouvrement par le
  tiroir laissé tel quel. Pointeur ajouté dans la section « Vue Maison » et sources d'en-tête
  complétées.
- `1_architecture/1_1_contrat-appareils.md` — le non-événement qui compte : la recherche n'a coûté
  aucun champ au contrat ni aucune ligne à un plugin, et le corollaire (`meta.manufacturer` /
  `meta.model` ne sont plus décoratifs, ils sont montrés à l'utilisateur).
- `4_ui/4_2_theme-et-langues.md` — section i18n `search.*`, sous-titres empruntés plutôt que
  redéclarés, le texte indicatif comme contrainte de layout, et pourquoi le piège `count`/`n` ne
  mord pas ici (les deux valeurs sont la même).
- `4_ui/4_0_langage-visuel.md` — trois icônes trait de plus (`search`, `room`, `layers`) et date
  d'en-tête au 2026-09-17.

**Pages créées** : aucune. Une page dédiée n'aurait rien porté que la vue Maison ne porte déjà ;
la recherche est une commande de navigation de cette vue, pas un sous-système.

**Contradictions relevées** : aucune entre le code et le wiki.

**Index** : mis à jour (4 lignes : 1_1, 4_0, 4_1, 4_2).

## [2026-09-17] update | COMAP Proteo 2 (suite) : cadrage sans `\n`, historique de consommation, vue Eau

**Déclencheur** : reprise du plugin COMAP au matin, après le commit 68596dd de la nuit. Trois
chantiers : le plugin ne renseignait jamais l'appareil face à la VRAIE station (timeout
systématique) ; la consommation n'existait qu'en trois totaux sans historique ; l'appareil était
publié mais introuvable dans la tablette, donc impossible à placer. Session d'équipe
(`_generated-ai-doc/sessions/2026-09-16-comap-proteo-2/`, journal 07:39 → 11:33).

**Pages modifiées** :
- `3_plugins/3_12_comap-proteo.md` — l'essentiel : la station ne termine JAMAIS ses réponses par un
  saut de ligne (cadrage refait sur « le buffer forme un JSON valide », et le test qui validait un
  `\n` inexistant) ; l'historique de consommation persisté et ses six décisions (48 h / 62 j,
  journalier relu et non sommé, heures datées par le `rtc` de la station, trou > 1 h jeté, pas non
  mesuré absent, curseur non persisté) ; mensuels NON persistés et l'année écoulée qui disparaît au
  1ᵉʳ janvier, conséquence assumée ; `COMAP_*` ; le croisement compteur du distributeur / station (une part de
  l'eau passe hors station) et ce qu'il fait dire de faux au repère du graphique ;
  point non tranché sur `consumption.week`.
- `1_architecture/1_2_serveur-et-plugins.md` — hook `consumption?`, `PluginConsumption`, et pourquoi
  un ajout sur une interface à 43 dépendants est passé.
- `1_architecture/1_3_protocole-rest-ws.md` — `GET /api/devices/:id/consumption`, ses deux codes
  d'erreur, et les trois décisions portées par `deviceConsumptionSchema`.
- `1_architecture/1_4_app-web.md` — `getConsumption`, `useConsumption`, `lib/consumption.ts`,
  `householdSize` comme préférence de tablette jamais écrite dans `house.json`.
- `1_architecture/1_5_scene-3d.md` — caisson 0,59 × 0,17 × 0,59 aux cotes de la notice, mesure GPU
  (écart ≤ 0,16 ms contre un bruit de 4,9 ms), bols de cartouches essayés puis écartés, et le piège
  `isOrientable` distinct de la rotation du maillage.
- `3_plugins/3_2_ecrire-un-plugin.md` — la leçon transposable : une fixture inventée valide ce que
  le vrai appareil ne fait pas ; quatre règles pour les tests de cadrage.
- `4_ui/4_1_navigation-et-panneaux.md` — la vue Eau, le graphique SVG écrit à la main, les seuils
  mesurés (1040 px, 965 px), l'axe à valeurs rondes, le repère SISPEA, les deux unités et le total
  pris dans l'état plutôt que dans la somme des barres.
- `4_ui/4_2_theme-et-langues.md` — `householdSize`, clés `water.*`, piège `count`/`n` du pluriel,
  et le mot « pas » banni au sens d'intervalle.
- `5_setup/5_1_configuration-env.md` — bloc `COMAP_*`, sans authentification et mono-session.
- `6_faq/6_1_pieges-runtime.md` — trois entrées datées (accord de pluriel volé, « 9/12 pas
  mesurés » lu comme une négation, appareil publié mais invisible faute de vue).

**Contradictions relevées** : aucune entre le code et le wiki. Deux zones d'incertitude notées
comme telles dans les pages plutôt que tranchées : `consumption.week` (calendaire ou glissant,
inconnu) et l'origine de l'eau hors station (circuit en amont et/ou fuite intermittente,
fuite permanente écartée par un compteur immobile au repos).

**Index** : mis à jour (10 lignes, résumés complétés et dates au 2026-09-17).

## [2026-09-17] update | Plugin COMAP Proteo 2 : protocole reversé par capture, kind `water`

**Déclencheur** : « attaquer le plugin COMAP Proteo 2 » (station de filtration de l'eau potable de
toute la maison), sans API officielle, avec l'hypothèse de départ que l'application
Android n'était qu'un habillage de site web. Hypothèse **écartée** dès la reconnaissance : ni 80 ni
443 ne répondent, seul le port 23 est ouvert. Protocole obtenu en intercalant un **relais TCP
enregistreur** entre l'application mobile et la station — l'appli demande une IP, on lui donne
celle du PC. Notice constructeur fournie en cours de session : elle a tranché le sens de plusieurs
champs contre les déductions faites sur les seules trames.

**Pages créées** :
- `3_plugins/3_12_comap-proteo.md` — le plugin, le protocole complet, la méthode de reverse, les
  trois pièges (station mono-session, débit en L/h par pas de 36, `lamp` = mode économie), et ce
  qui est délibérément laissé non décodé.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — le kind `water`, ses capacités, et pourquoi tous ses
  champs de mesure sont optionnels ; coût mesuré d'un kind de plus (7 points dans `apps/web`).
- `3_plugins/3_3_fabricants-a-venir.md` — `comap` retiré du tableau des squelettes, avec la trace
  de sa piste **fausse** (« API cloud, jeton », kind `sensor`) et la leçon générale sur ces pistes.
- `3_plugins/3_0_simulation-mock.md` — la station simulée, et le piège du tirage aléatoire au tick
  initial qui décale le hasard de tous les autres appareils.
- `4_ui/4_1_navigation-et-panneaux.md` — `WaterCard.vue`, et trois enseignements de sa relecture
  (réserve en `ch` calée sur le pire cas, contraste à mesurer sur le fond réellement peint,
  « éteint » et « inconnu » à distinguer autrement que par le mot).
- `6_faq/6_0_pieges-outillage.md` — `:global(X) .y` en `<style scoped>` perd le descendant et fuit
  sur `X` ; dette ouverte dans `HomeView.vue:254`.

**Index** : mis à jour (1 ligne ajoutée, 5 dates).

## [2026-09-16] update | Plugin Husqvarna Automower : phase 1, vue Robots, tondeuse en 3D par GPS

**Déclencheur** : « travailler sur le plugin husqvarna / automower » (435X AWD, arrêté sur un problème
de signal de boucle) : « visualiser ses infos de base, son état, sa position (carte un peu comme les
voitures), qu'il soit représenté sur la vue 3d » ; carte, câbles et commandes avancées pour plus tard.
Clés d'application pas encore posées : plugin écrit et testé sur des fixtures tirées de la documentation
et de la bibliothèque de référence.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — sous-section datée : les champs ajoutés à l'état `mower`
  (`location`, `errorCode`, `errorAt`, `restrictedReason`, `cuttingHeight`, `statusAt`, `statistics`),
  l'activité `stopped`, l'effacement par `null`.
- `1_architecture/1_5_scene-3d.md` — sous-section datée : la tondeuse placée par son GPS
  (`effectivePosition`, `drawable`), `vehicleFix` réduit à in/out pour elle, `MarkerContext.toLocal`
  et le marqueur qui suit sans reconstruction.
- `4_ui/4_1_navigation-et-panneaux.md` — sous-section datée : la vue Robots, sa carte par robot et
  ses règles (ligne d'état réservée, disque sur la carte, gestes selon capacités, jauge de quota).
- `3_plugins/3_3_fabricants-a-venir.md` — `automower` retiré du tableau, sous-section datée avec ce
  que la piste ne disait pas.

**Pages créées** :
- `3_plugins/3_11_husqvarna-automower.md` — le plugin : les trois contraintes du fabricant (une clé
  suffit, quota coupé donc WebSocket, horodatages locaux), le mappage, les commandes, les fixtures
  provisoires, les routes, la santé, le côté web, les pistes (zones, écritures, messages).

**Suite le soir même** : clés posées, capture `/raw` faite — fixtures remplacées (conventions
confirmées : majuscules, `serialNumber` nombre, heure locale-comme-UTC pour le prochain départ, vrai UTC
pour le statut). Bug trouvé sur le serveur de dev (robot lu, flux ouvert, registre vide après une
bascule dans les Réglages) et corrigé ; leçon ajoutée à `3_plugins/3_2_ecrire-un-plugin.md`.

**Nuit, bis** : capture des événements WebSocket (route `/raw/events`, park/resume sans faire bouger le
robot — signal de boucle toujours en panne) : ce sont des DELTAS, le mappage effaçait le prochain départ
et aurait levé l'erreur ; corrigé par fusion dans le robot connu, « jusqu'à nouvel ordre » = `mode: HOME`.
`3_11` et `3_2` complétés.
Puis le portail développeur (capture de l'utilisateur) tranche le quota : 21 000 requêtes par fenêtre de
sept jours, jetons non comptés — contradiction datée dans `3_11`, modèle de compteur refait (fenêtre
ancrée, `AUTOMOWER_QUOTA_RESET_AT` facultatif), libellés « cette semaine ». Puis `POST /usage` (compte + ancrage gardés dans le fichier d'usage), comme la console de Tesla.

Puis, retour de l'utilisateur (« complètement variable en hauteur, ça décale tout ») : le journal se
SIGNALE par une pilule comptée, se déplie en liste bornée, pose ses incidents sur la carte satellite et,
depuis le panneau détail de la vue Maison, sur le terrain de la scène 3D (épingles, caméra cadrée sur la
ligne choisie) ; décalage GPS aussi dans le panneau (`4_1`, `1_5`, `3_11`). Puis, à la demande de l'utilisateur, la liste passe en monospace avec une date à largeur constante (« 16/09 18:22 »). Puis l'incident ACTIF : infobulle complète, marqueur de carte grossi et cliquable, épingle 3D étiquetée et touchable (`journalTap`), ligne surlignée qui défile (`4_1`, `1_5`). Correctif : refermer le journal retire les étiquettes DOM des épingles (`1_5`).

Puis le JOURNAL du robot (`GET /mowers/{id}/messages`, capturé : 22 lignes, secondes, gravités, positions
quasi nulles sans fix GPS) exposé par un chemin générique calqué sur les prévisions — capacité `journal`,
hook `journal?()`, `GET /api/devices/:id/journal`, `deviceJournalSchema` — lu une fois puis tenu par
`message-event-v2`, et une carte « Journal » de huit lignes sur la vue Robots (`1_1`, `1_3`, `4_1`, `3_11`).

Puis un « Tondre 1 h » volontaire sur le robot en panne de boucle : « En route » sans bouger, erreur 2
déclarée après trois minutes et affichée dans Kasbah ; l'erreur arrive en trois deltas, la date en
SECONDES par le flux, un `message-event-v2` l'accompagne — fixtures et tests complétés.

**Nuit** : le décalage réglé pose le robot juste en 3D mais pas sur la photo ; vérifié que
les deux vues montrent le même point → c'est `origin`/`heading` de la maison qui ne sont pas calés sur
l'orthophoto. Constat écrit dans `2_maison/2_0_format-house-json.md`, plan de calage (contour sur la
carte, origine réglable) dans `_generated-ai-doc/calage-maison-photo.md` pour une prochaine session.

**Retours du propriétaire (soir)** : hauteur de coupe en centimètres, « À la station », débordement de
la carte sur fenêtre étroite (corrigé par `min-width: 0` sur les rangées), et décalage GPS réglable
(`MowerTuning.vue`, appliqué à la carte par `offsetLocation`) — `4_ui/4_1_navigation-et-panneaux.md`
et `3_plugins/3_11_husqvarna-automower.md` complétés.

**Index** : 1 ligne ajoutée, 5 résumés complétés, dates au 2026-09-16.

## [2026-09-16] update | Apparence « Auto » : l'interface suit le soleil de la maison

**Déclencheur** : « concernant l'apparence on pourrait ajouter un mode automatique qui en fonction de
l'horaire de la journée passe de light à dark et inversement […] des params par défaut qqpart et
peut-être une surcharge auto en fonction des données du plugin météo si actif/dispo ». Trois arbitrages
demandés avant d'écrire une ligne (nom du mode, cascade des sources, moment de la bascule), puis deux
corrections de l'utilisateur : libellé « Auto » plutôt que « Automatique », et pas de « tablette » dans
le texte d'aide (l'app se regarde aussi depuis un téléphone ou un ordinateur).

**Pages modifiées** :
- `4_ui/4_2_theme-et-langues.md` — sous-section datée : quatrième mode `auto`, ce qui le distingue de
  `system`, la cascade météo → soleil calculé depuis `site.origin` → journée type, le seuil de
  crépuscule civil (30 min, ou 5° de hauteur quand on n'a que la position), l'horloge à la minute que
  seul ce mode lit, la clé de libellé dédiée et la ligne d'aide. Un renvoi est ajouté sous la section
  « Apparence », qui annonçait **trois** modes, sans la réécrire.
- `4_ui/4_1_navigation-et-panneaux.md` — sous-section datée : cycle du rail à quatre pas dans l'ordre
  des Réglages (**remplace** sur ce point la description « système → clair → sombre » de la section
  Rail), et la mesure qui a tranché le libellé — 417 px de min-content pour « Automatique » contre
  363 pour « Auto », d'où la règle à retenir : dans cette grille, la longueur d'un mot est une
  contrainte de layout.
- `4_ui/4_0_langage-visuel.md` — sous-section datée : icône `sunHorizon`, et pourquoi un horizon
  plutôt qu'un soleil (voisinage immédiat de `sun` et `auto` sur le même bouton).

**Index** : 3 résumés complétés, dates au 2026-09-16.

## [2026-09-16] update | Vue Réglages : trois zones, et les Ambiances chez leur plugin

**Déclencheur** : « j'aimerais qu'on revoie le layout de la vue params/plugins » — blocs de réglages
en début de page, liste des plugins en fin, bloc Ambiances rattaché au plugin Hue. Puis, après
retours successifs sur le rendu mesuré : « en 1920 c'est horrible », « les blocs autres que rendu 3d
doivent rester à 1 colonne », croquis de la disposition attendue fourni par l'utilisateur.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — sous-section datée : disposition en trois piles 1-2-1 et
  croquis, tableau des quatre dispositions essayées avec leurs hauteurs mesurées, seuil de 1500 px
  déduit du min-content, contenu du Rendu 3D sur deux colonnes par requête de conteneur, tuiles
  plafonnées à trois par rangée, Ambiances déplacées dans `PluginSection.vue`. **Remplace** sur ces
  points la section « Vue Réglages » (colonne gauche / colonne droite) et le placement des Ambiances
  décrit dans la mise à jour du 2026-09-08, tous deux conservés comme état antérieur.
- `6_faq/6_0_pieges-outillage.md` — deux entrées : « Empiler ou aligner » (grille qui aligne ses
  rangées, nombre de colonnes utile, ordre du DOM dans l'équilibrage de `columns`, `column-span`
  limité à `all`) et « Le plancher `auto` d'une piste `fr`, utilisé à l'endroit pour une fois », qui
  complète par l'inverse les entrées des 2026-09-11 et 2026-09-12 sur `minmax(0, 1fr)`.

**Index** : 2 lignes complétées (résumés de `4_1` et `6_0`), dates déjà au 2026-09-16.

## [2026-09-16] update | Météo : kind `weather`, plugin Open-Meteo, widget, vue, scène 3D

**Déclencheur** : « j'aimerais qu'on réfléchisse à la partie météo, plugin/widget/vue complète/impact
vue 3d » — plan écrit d'abord (`_generated-ai-doc/plan-meteo.md`), recommandations validées (« ok pour
tes recommandations, on peut y aller »), puis implémentation des étapes 1 à 7 du plan.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : kind `weather`, état (obligatoire /
  optionnel), prévisions hors état, `meta.weather.attribution`.
- `1_architecture/1_2_serveur-et-plugins.md` — section datée : `ctx.site`, `DevicePlugin.forecast?`,
  `PluginHost.forecast`, route `GET /api/devices/:id/forecast`.
- `1_architecture/1_5_scene-3d.md` — deux sections datées : nébulosité et visibilité dans l'ambiance
  (`overcastSky`, `fogDistance`), puis le palier B — `weatherEffects`, sols mouillés et neige dans
  `applyLook` (`weathered`), éclairs par minuteries d'exposition (`stormStep`) ; puis le palier C —
  pluie en traits et neige en points inclinés par le vent (`effects/precipitation.ts`), coupés en
  qualité basse, et pourquoi le coût est celui de la boucle qui tourne, pas des particules.
- `3_plugins/3_0_simulation-mock.md` — section datée : météo simulée, `world.precipMmH`, prévisions du
  mock, absence de tirage aléatoire, correction du signe de `outdoorTemperature`.
- `4_ui/4_1_navigation-et-panneaux.md` — deux sections datées : `useWeather`, widget, vue Météo, radar
  RainViewer, icônes ; puis la vue Météo qui tient sans défiler à 1920 × 945 (semaine en haut à droite,
  radar en bas à droite, tuiles remplacées par une liste de détails, crédit en bas à gauche).
  Puis la couche AROME sur le radar : frise continue observé → prévision 15 min (Open-Meteo,
  `@openmeteo/weather-map-layer`), URL des fichiers `.om` bâtie à la main (la bibliothèque perd les
  minutes), marqueur de bascule sur le curseur, pièges `isStyleLoaded` et pré-empaquetage Vite.
  Légendes EAQI (paliers, plages, définition) et pollens (niveaux, seuils en grains/m³) ; Détails à la
  hauteur de ses voisines. Météo en 2e entrée du rail, après la maison ; Médias remonté avant Caméras (par l'utilisateur).

**Pages créées** :
- `3_plugins/3_10_open-meteo.md` — le plugin : choix du service, best match plutôt que Météo-France
  seul (probabilité `null`), publication, mappage, particularités des réponses.

- `1_architecture/1_3_protocole-rest-ws.md` — section datée : la route `GET /api/devices/:id/forecast`,
  son schéma et ses codes d'erreur.
- `1_architecture/1_4_app-web.md` — section datée : `Transport.getForecast`, `useWeather` / `useForecast`,
  route `weather`.
- `3_plugins/3_2_ecrire-un-plugin.md` — section datée : `ctx.site`, `forecast?`, et « aucun appel réseau
  dans `discover` » (plugins démarrés en série).
- `4_ui/4_0_langage-visuel.md` — section datée : la famille d'icônes météo, `conditionIcon`.
- `5_setup/5_1_configuration-env.md` — section datée : `OPEN_METEO_POLL_MS`, aucune clé.
- `4_ui/4_2_theme-et-langues.md` — section datée : météo forcée dans la scène en débogage
  (`sceneWeather`, nébulosité, visibilité par paliers), scène seule.

**Index** : mis à jour (10 dates, 1 ligne ajoutée, résumé de 1_1 complété).

## [2026-09-16] update | Limite de charge sur toute la batterie, paramètres repliés, couleur en direct

**Déclencheur** : « pour la limite de charge des fiches véhicule il faudrait que le slider représente
la totalité de la batterie (de 0 à 100 %) avec des marqueurs discrets à 50, 60, 70, 80, 90, 100 et
qu'on ne puisse pas descendre sous 50 » ; puis « on pourrait reprendre ce bloc dans le panel détail
véhicule de la vue 3d », « cette section devrait se déplier uniquement après un appui sur un bouton
paramètres », « j'aimerais que la couleur change directement lors du choix », « il n'y a pas de
bouton Rétablir », et deux incidents rencontrés en chemin (module Vite cassé à chaud, clic qui
effaçait la couleur choisie).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : `ChargeLimitCard.vue` partagée par la vue
  Véhicules et le panneau d'appareil, piste de 0 à 100 % (repères 50-90, part 0-50 voilée, pouce borné
  à 50, piste dessinée à part pour aligner les repères sur le centre du pouce), paramètres d'un
  véhicule repliés derrière « Paramètres · Régler » sur le modèle d'« Emplacement », bouton
  « Rétablir » à place réservée, clé `vehicle.tuneTitle`.
- `1_architecture/1_5_scene-3d.md` — section datée : aperçu de la couleur d'une carrosserie
  (`DeviceMarker.previewColor` → `VehicleMarker`, `HouseScene.previewBodyColor`), matériau de scène
  cloné à la première retouche, `paintBase`, et pourquoi le point d'entrée vit sur la classe de base.
- `1_architecture/1_4_app-web.md` — section datée : `bodyColorPreview` / `previewBodyColor` dans le
  store `house`, traduction identifiant de plugin → clé de marqueur, parallèle avec `draft`.
- `6_faq/6_1_pieges-runtime.md` — entrée : un `<label>` sans `for` active son premier descendant
  étiquetable, ici la croix de remise à zéro placée avant le champ.
- `6_faq/6_0_pieges-outillage.md` — entrée : un import de VALEUR ajouté à chaud casse le module qui le
  porte (`does not provide an export named`, `[VUE_ROUTER_R0010]`).

**Index** : mis à jour (5 lignes).

## [2026-09-16] update | Réglages → Plugins : une section dépliable par fabricant

**Déclencheur** : « le plugin renault affiche toujours son bloc "compte lié" alors que le plugin est
paramétré et fonctionne… chaque section de plugin devrait pouvoir se déplier et contenir ses infos et
params » ; puis arbitrage de l'utilisateur : « réserve l'ouverture auto à `needs_pairing` et `error` ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : `PluginSection.vue` (en-tête à empreinte fixe,
  corps portant le `detail` du serveur, la carte du fabricant, « Fournit » et les clés `.env`), règle
  d'ouverture automatique et `manual` qui laisse le dernier mot, `v-show` plutôt que `v-if`, états
  « déjà lié » de Hue / Nest / Enphase, tests et vérifications.
- `4_ui/4_2_theme-et-langues.md` — section datée : les clés ajoutées et `settings.noKeys` supprimée.

**Index** : mis à jour (2 lignes).

## [2026-09-15] update | Toit (rives, acrotère, gravillon), piscine en bassin, sélection par trait

**Déclencheur** : « ok pour le toit (fascia et acrotère) », « qqchose de mieux pour l'eau/la piscine »,
« revoir la mise en évidence d'une pièce sélectionnée » ; puis « pour le toit plat trouver autre chose
que de la tuile », « aligner la texture du fond », et deux tours de réglage du glow.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée (quaterdecies) : rives et acrotère, rôle `gravel` et
  `roofFlat`, bassin (margelle, parois `BackSide`, eau translucide, terrain et sol percés,
  `alignedToLongestEdge`), sélection remplacée (trait + voile non éclairés, `depthTest: false`, glow × 1,15),
  cinq tests, vérification.
- `6_faq/6_0_pieges-outillage.md` — deux entrées : UV d'extrusion alignées sur le monde ; volume creusé
  bouché par la surface au-dessus.

**Index** : mis à jour (2 lignes).

## [2026-09-15] update | Le détail architectural en procédural (encadrements, appuis, couronnements, soubassement, vantaux)

**Déclencheur** : « on passe au détail architectural » après les matières photo ; correction après la
capture de l'utilisateur (« normal que ce soit comme ça ? à l'intérieur de la pièce ? »).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée (terdecies) : les cinq familles et leurs règles,
  matériaux `trim` / `frame` / `plinth` / `door` déduits de la palette, fusion par matériau et par niveau,
  décalage across le mur seulement, signe de la normale après `rotateZ`, boîtes non indexées avant
  `mergeGeometries`, six tests, vérification, ce qui reste (appliques, fascia).
- `6_faq/6_0_pieges-outillage.md` — deux entrées : `mergeGeometries` indexé/non indexé, axe y local
  après `rotateZ` ≠ normale extérieure.

**Index** : mis à jour (2 lignes).

## [2026-09-15] update | Deux styles de plus (indigo, maquette) et des matières en images (pack photo CC0)

**Déclencheur** : maquette générée fournie comme cible (« se rapprocher du rendu fin et détaillé »),
« je pense qu'il faut qu'on passe aux assets », switch procédural / assets sous les styles, deux styles
à ajouter ; arbitrages : « on ne prend pas en compte le mobilier », « pas de végétation pour l'instant,
par contre un asset gazon oui », « kits existants… on reste en free ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée (duodecies) : styles `indigo` et `maquette` et leurs
  réglages, contrat `SurfaceTexture` élargi (`roughnessMap` / `metalnessMap` / `colored`), pack photo
  ambientCG (dix rôles, cotes, choix et écarts), `loadPackTextures`, `RenderStyle.assets`,
  `setAppearance({ assets })` / `applyMaterials` / jeton `photoGen`, vérification, suite recommandée.
- `4_ui/4_2_theme-et-langues.md` — tableau des réglages de rendu (six styles, `kasbah.sceneAssets`),
  section datée sur le switch « Matières en images » et les clés i18n.
- `5_setup/5_0_installation-et-scripts.md` — section datée sur `scripts/fetch-textures.mjs`.

**Index** : mis à jour (3 lignes).

## [2026-09-15] update | Le goulot était le GPU intégré : détection par le nom du GPU, garde-fou qui mesure le GPU

**Déclencheur** : « on a donc toujours le pb du hors rendu qui gonfle » après les trois coûts
supprimés ; mesure dans un Chrome à part (CDP + requête de temps GPU) ; réglage Windows posé par
l'utilisateur (« effectivement c'est bien mieux ») ; « tu peux faire 2 et 3 ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée (undecies) : la mesure (fil principal libre, 93 ms de
  GPU par image sur le GPU intégré, 14,5 sur le GPU dédié ; pilules et présentation hors de cause ; GTAO
  à coût quasi fixe), `detectQuality(gpu)` et `gpuName`, garde-fou à la requête GPU sur les images
  mesurables avec décision à la médiane (remplace le chronométrage CPU du septies, signalé), vérification
  sur les deux GPU.
- `6_faq/6_0_pieges-outillage.md` — note datée sous les deux entrées DOM (le plafond n'était pas là),
  entrée « mesurer une scène 3D : ni la preview, ni un onglet caché », entrée « `--use-adapter-luid`
  écrasé par la préférence Windows ».
- `6_faq/6_1_pieges-runtime.md` — entrée « la vue Maison à 8 img/s : Chrome dessinait sur le GPU intégré ».

**Index** : mis à jour (3 lignes).

## [2026-09-15] update | Un voile de mesure sur la scène, et trois coûts supprimés

**Déclencheur** : « sur la vraie maison ça rame un peu lorsqu'on orbite ou qu'on sélectionne une
pièce », « on pourrait ajouter un switch debug dans les params rendu 3d qui affiche les graph fps »,
« on plafonne à 22 fps, à mon avis on a un pb quelque part ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée (decies) : le voile de débogage (`stats.js` branché
  en sonde autour de chaque image rendue + relevé chiffré), et les trois coûts trouvés — carte d'ombre
  refaite à chaque image alors qu'elle ne dépend pas de la caméra, passe de niveau payée sans lampe
  allumée ni décor, `backdrop-filter` des pilules recalculé des dizaines de fois par image. Mesures et
  réserve sur ce que la preview permet de mesurer.
- `6_faq/6_0_pieges-outillage.md` — entrée « `backdrop-filter` au-dessus d'un canvas qui s'anime ».

**Index** : mis à jour (2 lignes).

## [2026-09-15] update | Styles de rendu 3D, heure de la maison, et une vraie chaîne d'image

**Déclencheur** : « j'aimerais qu'on puisse choisir un style de rendu, par exemple réaliste comme la
maquette, et d'autres styles (nature, cyberpunk, candy…) », « il faudrait construire la chose pour
qu'on puisse ajouter et switcher de style facilement », « le mode light/dark de l'app ne doit pas
forcément impliquer que la maison est sombre/claire ». Arbitrages pris avant d'écrire : tout en
procédural (assets plus tard si besoin), post-traitement avec réglage de qualité.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée (septies) : les trois axes indépendants (style /
  ambiance / thème), `core/sun.ts` et `core/ambience.ts`, le contrat `RenderStyle`, la carte
  d'environnement posée sur toute la scène (`core/sky.ts`, remplace `core/environment.ts`), la chaîne
  d'image (`core/post.ts` : tone mapping, GTAO, bloom, vignette, qualité auto), les matières
  procédurales passées au PBR (normale + ORM, catalogue gardé), `setAppearance`, `DECOR_LAYER`.
- `4_ui/4_0_langage-visuel.md` — section datée qui REMPLACE la décision du 2026-09-12 : `SCENE_LIGHT`
  / `SCENE_DARK` retirées de `plugins/vuetify.ts`, la matière vient du style ; ce qui est POSÉ sur la
  maison suit toujours le thème.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée (ter) : carte « Rendu 3D » des Réglages.
- `4_ui/4_2_theme-et-langues.md` — section datée : `kasbah.sceneStyle` / `sceneAmbience` /
  `sceneQuality`, section i18n `render.*`.
- `6_faq/6_1_pieges-runtime.md` — trois entrées : exposition `NaN` → image noire sans erreur, carré
  noir sous une lampe (halo additif vu par l'occlusion), maison qui se confond avec son ciel de nuit.

**Suite de la même session — retour de l'utilisateur** : « ici le volet est fermé et dans la pièce on
voit tout de même la lumière traverser la vitre ». Le rendu en passes masquait les marqueurs pendant
la passe qui refait la carte d'ombre : depuis son arrivée, aucun appareil ne portait d'ombre.
- `1_architecture/1_5_scene-3d.md` — section datée (octies) : exclusions dites par COUCHE et non par
  visibilité (`LAMP_LAYER` pour les lampes, `DECOR_LAYER` élargi à tous les décors via `asDecor`), le
  jardin gagne sa passe, compromis assumé sur les lampes extérieures.
- `6_faq/6_1_pieges-runtime.md` — entrée « Un volet fermé qui laisse passer le soleil ».

**Puis, même session** : « les lampes extérieures doivent quand même éclairer la façade mais pas
l'intérieur ». Une couche ne sait pas distinguer les deux faces d'un mur, et le rendu en passes ne
s'additionne pas : il fallait une vraie ombre portée.
- `1_architecture/1_5_scene-3d.md` — section datée (nonies) qui LÈVE le compromis de la précédente :
  lampe de jardin sur la couche commune avec `PointLightShadow` (allumée seulement quand la lampe
  l'est), `SITE_DECOR_LAYER` pour son halo, plus de passe dédiée au jardin, sol du jardin retiré des
  passes de niveau.

**Index** : mis à jour (5 lignes, résumés et dates).

## [2026-09-15] update | La vue Maison se rapproche de la maquette : maison de poupée, nuit, coquille flottante

**Déclencheur** : maquette générée fournie par l'utilisateur (« pour la vue 3D est-ce qu'on peut se
rapprocher de la maquette ? … juste les pièces (murs/sols) et éléments connectés qu'on possède »,
« on ne prend pas en compte les arbres »).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée : murs extérieurs coupés en deux maillages et haut
  masqué au focus (`splitWallsAt`, `wallsUpper`), sol infini non éclairé, éclairage de nuit et halo
  additif des lampes, sol sélectionné émissif, cadrage dans la partie libre (`setViewInset` /
  `setViewOffset`), `orbitBy` / `dollyBy`, trois tests headless.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée qui REMPLACE « Grille » pour la vue Maison :
  rail sans fond posé sur la vue, scène plein écran, en-tête / vignette / boutons de vue flottants,
  panneau en carte flottante.
- `4_ui/4_0_langage-visuel.md` — palette `SCENE_DARK` assombrie (murs éclaircis), jeton `--panel-gap`.

- `1_architecture/1_5_scene-3d.md` — seconde section datée, après retour de l'utilisateur sur la
  maison réelle : la coupe des murs (« maison de poupée ») est RETIRÉE, cloisons pleine hauteur
  aussi ; matières procédurales par défaut (`three/textures/procedural.ts`, table `SURFACE_OF`) ;
  les lampes n'éclairent que leur propre niveau (rendu en passes, `renderPasses`).

- `4_ui/4_1_navigation-et-panneaux.md` — troisième section datée : incident « un cube a disparu »
  (ré-ancré au toit par l'onglet pendant un déplacement), remplacement de la règle « l'onglet emmène
  l'appareil » par un sélecteur de niveau dans « Emplacement » (`setPlacementLevel`), cube remis
  dans sa pièce par l'API.

- `4_ui/4_1_navigation-et-panneaux.md` — quatrième section datée : en-tête collant `.panel-head`, fondus haut/bas,
  barre de défilement sans flèches du panneau flottant.

**Index** : mis à jour (2 dates).

## [2026-09-15] fix | L'aspect de la peinture Tesla se lisait au mauvais endroit

**Déclencheur** : l'inférence tenait à UN seul relevé. Basculer l'écran de bord sur
« Métallique », puis sur « Unie », a suffi à la démonter deux fois — et à la remplacer par trois
points mesurés.

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` — DEUX sections datées, dans l'ordre où la mesure est tombée. La
  première corrige : c'est le cinquième nombre qui dit l'aspect, pas le quatrième. La seconde
  complète, après un troisième basculement (« Unie ») : le quatrième parle AUSSI — rugosité au
  cinquième, métallicité au quatrième, et les trois aspects deviennent dérivables. Les sections
  antérieures sont conservées : le raisonnement faux vaut d'être gardé à côté de ce qui l'a démonté.

**Index** : inchangé (la page était déjà datée du jour).

## [2026-09-15] update | Les voitures prennent leur vraie carrosserie, et leur vraie couleur

**Déclencheur** : « concernant les voitures dans la vue 3d on pourrait mettre des formes réelles ou
presque », puis « est-ce qu'on pourrait avoir des modèles un peu mieux définis » (le rendu restait
mou), et enfin « concernant les couleurs des véhicules, on ne peut pas récupérer ça des infos
dispo ? ». Deux relevés d'API réels ont tranché ce que la documentation ne disait pas.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — trois sections : les carrosseries glTF (où vivent les fichiers
  et pourquoi pas dans le plugin, catalogue, chargeur injecté, substitution à empreinte constante),
  la carte d'environnement HDR propre aux véhicules (sans quoi une carrosserie rend de l'argile),
  et la chaîne couleur/aspect. Plus un encadré sur la préparation d'un modèle — décimer en UNE
  passe depuis le maillage dense, la double décimation étant ce qui abîmait les premiers exports.
- `1_architecture/1_1_contrat-appareils.md` — `meta.vehicle` (`color`, `finish`), `VEHICLE_FINISHES`,
  et la descente de `hexColorSchema` dans `devices/` pour éviter un cycle d'imports.
- `2_maison/2_0_format-house-json.md` — `model3d`, `bodyColor`, `bodyFinish` ; la règle d'effacement
  (chaîne vide) et la nuance `'none'` vs absent.
- `1_architecture/1_2_serveur-et-plugins.md` — `@fastify/compress`, et pourquoi l'ordre
  d'enregistrement se garde par un test.
- `4_ui/4_1_navigation-et-panneaux.md` — les trois lignes d'apparence dans « Régler », la croix
  qui rend la main au fabricant (couleur ET peinture), et l'élargissement de `tunableVehicle`.
- `3_plugins/3_8_tesla.md` — `vehicle_config` dans `DATA_ENDPOINTS` (coût nul), `exterior_color` vs
  `paint_color_override`, la lecture des deux nombres d'aspect, et les deux vestiges à ne pas croire.
- `3_plugins/3_9_renault.md` — la teinte déduite de l'URL des rendus `3dv.renault.com`, sans appel
  supplémentaire ; pourquoi la table de codes reste limitée au vérifié alors que celle de Tesla
  s'autorise des approximations.

**Index** : 7 lignes mises à jour (résumés complétés, date au 2026-09-15).

## [2026-09-15] update | L'énergie et les voitures se voient, dedans comme dehors

**Déclencheur** : « dans le panneau de droite on pourrait ajouter des pilules pour l'énergie et les
voitures », puis « au niveau des batteries dans la vue 3D on pourrait afficher une jauge sur l'objet
comme ce qui a été fait sur les objets des panneaux solaires ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — les tuiles solaire et batterie reviennent dans le panneau
  maison (la décision du 2026-09-11 se disait provisoire), SANS reprendre la place des caméras et
  des lecteurs, et chaque voiture gagne la sienne (valeur = sa charge, étiquette = son nom de
  maison) ; « — » pour une voiture jamais lue plutôt qu'un « 0 % » qui se lirait comme une batterie
  vide ; plafond de la grille relevé de 6 à 10 pour qu'aucune voiture ne soit tronquée ; `key`
  explicite par tuile ; `home.battery` ressuscitée et `home.solarNow` ajoutée (`home.solar`
  reste capitalisée pour la légende de la vue Énergie) ; tuiles décoratives, sans lien vers les vues.
- `1_architecture/1_5_scene-3d.md` — jauge de charge du coffret d'une batterie, dans la langue de
  celle d'un module (piste à 16 %, trait plein à 95 %, `MeshBasicMaterial` sans `depthWrite`) ;
  quatre décisions : sur les DEUX grandes faces (la vue d'ensemble regarde depuis le sud-est, les
  coffrets sont posés `yaw` 270), trait à l'accent et non à la couleur d'état (le souffle dit ce
  que le coffret fait, la hauteur ce qu'il contient), rien du tout si `batterySoc` est absent, et
  dernier niveau conservé quand l'appareil se tait — à l'inverse d'un module, dont la production
  décrit un instant. Dimensions du coffret extraites en `BATTERY_BOX`, qui dimensionne la jauge.

**Index** : 2 lignes mises à jour.

## [2026-09-14] update | Les batteries disent enfin ce qu'elles font

**Déclencheur** : « concernant les objets 3d des batteries j'aimerais bien voir un effet pulse qui
indique que la batterie charge (un vert), décharge (un bleu), ou a un pb si on a l'info (warn orange
ou erreur rouge) ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — le coffret d'une batterie pulse la couleur de ce qu'il fait
  (vert / bleu / rouge, rien au repos) ; souffle en cosinus de 2,6 s, teinte tirée à 30 % ; trois
  décisions à ne pas défaire (le repos RELÂCHE la boucle du rendu à la demande, le coffret a son
  propre matériau donc `onState` lui recopie le thème, le seuil est `IDLE_W` déplacé dans
  `lib/energy.ts` pour que scène et schéma de flux lisent la même zone morte) ; `isOn` d'une
  batterie devient « elle déplace de l'énergie » ; `SceneTheme` gagne `info` et `error` ; et
  pourquoi il n'y a PAS d'orange (le contrat n'a aucun champ de défaut pour un `energy`, seule piste
  ouverte : l'`admin_state_str` d'Enphase, non mappé).

**Index** : 1 ligne mise à jour.

## [2026-09-14] update | Le curseur de pièce dit enfin son pourcentage

**Déclencheur** : « sur ce genre de slider lumière pièce j'aimerais pouvoir visualiser le % car je ne
sais pas où placer le curseur pour obtenir 50 % par exemple ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — valeur écrite dans le slot `#append` du curseur de
  luminosité de pièce (moyenne au repos, brouillon suivi pendant le glissement) ; largeur fixe et
  chiffres tabulaires pour que la piste garde la même longueur de 1 % à 100 % (mesuré : 261 px aux
  zooms 100 / 125 / 150 %) ; disparaît avec le curseur pièce éteinte ; pourquoi le permanent plutôt
  que `thumb-label`.

**Index** : 1 ligne mise à jour.

## [2026-09-14] update | La voiture se tourne enfin, et se règle sous les yeux

**Déclencheur** : « dans les params de décalage véhicule il faudrait aussi ajouter la rotation », puis
« idem dans ce panel » (la section de réglage au bas du panneau de l'appareil sélectionné) et « pour
la jauge autonomie, on peut mettre les marqueurs min max ».

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — `yawOffset` : troisième réglage SAISI d'une entrée de
  véhicule, borné à ±180 à l'écriture, `0` efface ; et pourquoi une correction plutôt qu'un `yaw`
  absolu (écrire le `yaw` figerait une voiture dont le cap est une mesure).
- `1_architecture/1_5_scene-3d.md` — la correction s'AJOUTE au cap déduit (cas 2, 3 et 4 de la
  chaîne) et laisse intact le `yaw` posé à la main ; angle ramené dans `[-180, 180[` avant l'envoi ;
  test qui compare deux scènes décalées de 30°.
- `4_ui/4_1_navigation-et-panneaux.md` — ligne « Rotation (°) », section de réglage descendue au fond
  du panneau d'un véhicule (composant partagé `VehicleTuning`, prédicats dans `lib/vehicleTuning.ts`),
  et repères plancher / cible sur la jauge du panneau — rien d'inventé, la cible suit le réglage en
  cours.
- `4_ui/4_2_theme-et-langues.md` — clé `vehicle.rotation` ; `targetMark` / `floorMark` servent
  désormais deux surfaces.

**Index** : 4 lignes mises à jour.

## [2026-09-14] update | La limite de charge se règle, et part vraiment dans les voitures

**Déclencheur** : « sur les cartes véhicules, possible d'ajouter la modif des limites de charge et
d'envoyer ça aux véhicules ? » — puis, sur la demande de l'utilisateur, les COMMANDES essayées sur
les vraies voitures AVANT de dessiner l'UI. Les deux ont accepté. En chemin, une capture de la
console de facturation Tesla a corrigé une hypothèse du wiki sur le cycle.

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` — première écriture (`vehicle.set_charge_limit`, capacité `charge_limit`),
  vérifiée non signée sur un Model S pré-2021 : véhicule éveillé exigé (408 sinon, aucun réveil
  implicite), refus du fabricant en HTTP 200 (`result: false`), cible publiée sans relecture
  facturée ; et cycle de facturation au 1er du mois (`since` déduit du mois, `/usage` sans `since`).
- `3_plugins/3_9_renault.md` — `ev/soc-levels` s'ÉCRIT : deuxième écriture connue de la plateforme
  après `ev/settings`, niveaux relus et seul `socTarget` changé (le plancher est le réglage de
  l'utilisateur), et le piège des dix secondes pendant lesquelles Kamereon relit l'ancienne valeur.
- `4_ui/4_1_navigation-et-panneaux.md` — le réglage lui-même : six paliers + curseur au pour cent,
  sur la carte de la vue Véhicules et dans le panneau du véhicule sélectionné ; grisé plutôt
  qu'absent quand la voiture dort ; mesures « rien ne bouge » ; six `v-btn` qui débordaient le
  panneau faute de `px-0`.

**Index** : mis à jour (3 résumés complétés, 3 dates).

## [2026-09-14] update | Charge détaillée, réglages saisis par l'utilisateur, et une voiture qui sait où elle regarde

**Déclencheur** : une session de retours sur la vue Véhicules et la scène 3D — bouton « Actualiser »
manquant sur une voiture endormie, temps et puissance de charge absents, marqueur 3D décalé et mal
orienté, « renault » sans majuscule — puis, en creusant, deux découvertes : la R5 ne donne PAS sa
puissance de charge (vérifié voiture en charge) et le réveil de charge secouait une voiture déjà
pleine.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — `chargeMinutesRemaining`, `socMin`, capacité de lecture
  `charge_power`, et `estimateChargePowerW` en règle pure : rien d'estimé n'entre dans l'état.
- `1_architecture/1_5_scene-3d.md` — décalage `gpsOffset` appliqué à la place calculée, et chaîne
  d'orientation d'un véhicule (yaw du JSON → cap du fabricant → axe de la pièce → rien).
- `2_maison/2_0_format-house-json.md` — `gpsOffset` et `batteryKwh` d'une entrée de véhicule, valeurs
  saisies faute que les fabricants les donnent, `0` qui efface.
- `2_maison/2_1_geometrie.md` — `longestEdgeYawDeg`, l'axe d'une pièce.
- `3_plugins/3_0_simulation-mock.md` — la Zoé devient une R5, qui ne déclare `charge_power` que si
  une borne la charge vraiment.
- `3_plugins/3_8_tesla.md` — `time_to_full_charge` et capacité `charge_power`.
- `3_plugins/3_9_renault.md` — capture EN CHARGE (pas de puissance, temps restant frais, `socMin`),
  majuscule du fabricant, cinquième condition du réveil de charge.
- `4_ui/4_1_navigation-et-panneaux.md` — carte véhicule : boutons, case « Charge », ligne de détail,
  repères de jauge, dépliant « Régler ».
- `4_ui/4_2_theme-et-langues.md` — les onze clés `vehicle.*` et `formatMinutes`.

**Index** : mis à jour (9 résumés complétés, 9 dates).

**Fait en deux passes** (noyau contrat/maison/3D, puis plugins et UI) : plus de cinq pages touchées.

## [2026-09-14] update | Réveil de charge Renault, voitures en 3D d'après leur GPS, cartes en satellite

**Déclencheur** : trois demandes de l'utilisateur à la suite du plugin Renault — placer les voitures
dans la scène 3D d'après leurs coordonnées, réveiller la R5 pour relancer la charge sur surplus
solaire, et passer les mini-cartes en vue satellite avec les noms de villes et de rues.

**Pages modifiées** :
- `3_plugins/3_9_renault.md` — le réveil de charge implémenté : sous-item `charge_wake`, quatre
  conditions nécessaires, fenêtre horaire, et la charge utile relue puis réécrite à l'identique.
- `1_architecture/1_5_scene-3d.md` — `sitePosition`, `effectivePosition`, `drawable` : un véhicule
  se place d'après son GPS, sans avoir à être déclaré dans la maison.
- `4_ui/4_1_navigation-et-panneaux.md` — satellite par défaut, étiquettes du plan par-dessus la
  photo, et les deux corrections trouvées en vérifiant (défaut jamais appliqué, « 0 W » inventé).

**Index** : mis à jour (3 résumés complétés).

## [2026-09-14] update | Plugin Renault (R5 E-Tech) phase 1, et deux champs du contrat devenus optionnels

**Déclencheur** : implémentation du plugin `renault` (lecture seule) sur le vrai compte MY Renault
d'un utilisateur, capture du véhicule réel, puis renommage demandé depuis la carte véhicule.

**Pages créées** :
- `3_plugins/3_9_renault.md` — la voie Gigya/Kamereon et pourquoi aucune autre n'existe, le mot de
  passe hors `.env`, les pièges de Gigya (HTTP 200 sur un refus, 2FA), le débit, la capture du vrai
  compte et ses quatre surprises, le réveil de charge solaire de phase 2.

**Pages modifiées** :
- `3_plugins/3_3_fabricants-a-venir.md` — `renault` quitte le tableau ; `melcloud` le remplace comme
  exemple de squelette dans les tests d'intégration ; leçon sur la capture (trois affirmations de la
  doc corrigées).
- `1_architecture/1_1_contrat-appareils.md` — `locked` d'un véhicule devient optionnel (= inconnu).
- `2_maison/2_0_format-house-json.md` — `position` d'un appareil devient optionnelle (= non placé),
  type `PlacedHouseDevice` et garde `isPlaced`, `name` dans `devicePlacementSchema`.
- `4_ui/4_1_navigation-et-panneaux.md` — renommage depuis la carte véhicule, `ref` dans un `v-for`,
  pastille de veille masquée quand le fabricant n'a pas cette notion.

**Index** : mis à jour (1 ligne ajoutée, 4 résumés complétés).

## [2026-09-14] update | Ce que la session avait laissé de côté : protocole, transport, routes

**Déclencheur** : passe `wiki-update` de fin de session. Le wiki avait été tenu au fil des commits
(carte, spinner, attribution, quota, fichier d'état, facturation) ; il restait trois pages que le
travail avait touchées sans qu'on y revienne.

**Pages modifiées** :
- `1_architecture/1_3_protocole-rest-ws.md` — `quota` dans la santé de `/api/health`, et le rappel que
  la santé ne se pousse pas.
- `1_architecture/1_4_app-web.md` — les quatre méthodes Tesla de `Transport`, la santé qu'une vue doit
  redemander, `lib/map.ts` et `VehicleMap.vue`.
- `3_plugins/3_8_tesla.md` — table des routes complétée (`/public-key/rotate`, `/usage`).

**Index** : mis à jour (3 lignes).

## [2026-09-14] update | Lister ne coûte rien : la console du fabricant corrige notre estimation

**Déclencheur** : l'utilisateur ouvre la console d'utilisation de son compte Tesla — 3 requêtes
« Données » par jour, là où le plugin en comptait 144 en listant. Et : « il faudrait mettre à jour le
state en conséquence ».

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` — la liste n'est pas facturée, le piège du préfixe de chemin, la route de
  recalage `POST /usage`, et les chiffres alignés sur la console (6 lectures, 2 réveils, 0,052 $).

**Index** : mis à jour (1 ligne).

## [2026-09-14] update | La carte range ses mentions, et la carte véhicule montre ce qu'il reste de quota

**Déclencheur** : trois demandes de l'utilisateur — « revoir l'affichage des attributions de la map
afin que ce soit propre visuellement », « par défaut on ferme la pills », « une progressbar en bas de
la carte véhicule, pas en bas de la minimap » pour le quota de l'API Tesla ; plus un clin d'œil : les
positions de la démo.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — attribution repliée et habillée, jauge de quota dans la carte.
- `6_faq/6_0_pieges-outillage.md` — les deux verrous du `<details>` de MapLibre.
- `3_plugins/3_2_ecrire-un-plugin.md` — `PluginHealth.quota`.
- `3_plugins/3_8_tesla.md` — le budget du jour publié dans la santé.
- `3_plugins/3_0_simulation-mock.md` — la démo déménage ; les deux copies de la maison de démo.
- `4_ui/4_2_theme-et-langues.md` — nouvelles clés, et une clé `map` en double corrigée.
- `5_setup/5_1_configuration-env.md` — `TESLA_STATE_FILE`.

Deux demandes sont arrivées en cours de route et ont changé la cible : le quota jaugé n'est plus le
budget JOURNALIER du plugin mais le CRÉDIT MENSUEL du fabricant (10 $, cycle calendaire, estimé sur
ses prix affichés), et ce compteur — comme le dernier état de chaque véhicule — survit désormais à un
redémarrage du serveur dans un fichier d'état. Les sections concernées ont été corrigées avant commit
plutôt que contredites par une suite.

**Index** : mis à jour (7 lignes).

## [2026-09-14] update | « Réveiller » dit que la demande est en cours, jusqu'à ce que la voiture réponde

**Déclencheur** : demande de l'utilisateur — « quand on clique sur Réveiller il faudrait indiquer que
la demande est en cours, par exemple en ajoutant un spinner au bouton ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — spinner à la place de l'icône, registre `waking` et ses trois sorties.
- `4_ui/4_2_theme-et-langues.md` — `vehicle.refreshing` retirée.
- `3_plugins/3_8_tesla.md` — `execute` rend la main avant l'effet : l'attente revient à l'UI.

**Index** : mis à jour (3 lignes).

## [2026-09-14] update | La voiture sur une vraie carte, plan ou satellite, sans clé ni compte

**Déclencheur** : demande de l'utilisateur — « ajouter la map dans la carte du véhicule… bon niveau
de zoom, mode satellite, le tout gratuit… un bouton fullscreen ». Choix fait ensemble : MapLibre +
OpenFreeMap + orthophotos IGN, pas de repli satellite hors de France.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — la carte du véhicule : assemblage, cadrage, boutons, plein écran.
- `6_faq/6_0_pieges-outillage.md` — worker MapLibre et Vite, marqueur sans position, MIME `.mjs`.
- `1_architecture/1_1_contrat-appareils.md` — `headingDeg`.
- `3_plugins/3_8_tesla.md` — le cap, les fournisseurs écartés.
- `5_setup/5_0_installation-et-scripts.md` — `optimizeDeps.exclude`, dépendance `maplibre-gl`.
- `4_ui/4_2_theme-et-langues.md` — clés `vehicle.map.*`.

**Index** : mis à jour (6 lignes).

## [2026-09-14] update | La carte de la Tesla dit l'âge de ce qu'elle montre, et sait relire

**Déclencheur** : demande de l'utilisateur — « de quand date le statut affiché », « un bouton pour
rafraîchir », « le nouveau délai d'interrogation repart de ce moment ».

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` — `readAt`, `vehicle.refresh`, sondage reposé après chaque lecture.
- `1_architecture/1_1_contrat-appareils.md` — le champ et la commande dans le contrat.
- `4_ui/4_1_navigation-et-panneaux.md` — la ligne « Lu il y a… » et le bouton « Actualiser ».
- `4_ui/4_2_theme-et-langues.md` — les clés.

**Index** : mis à jour (4 lignes).

## [2026-09-13] update | La vraie Tesla se lie, et apprend cinq choses à la mise en route

**Déclencheur** : liaison du compte réel dans la foulée de l'écriture du plugin. Deux comptes Tesla
et deux applications créées, un domaine « déjà pris », une vérification de clé qui échouait par
format, puis un réveil demandé depuis l'UI et la première capture (`GET /api/plugins/tesla/raw`).

**Pages modifiées** :
- `3_plugins/3_8_tesla.md` — les cinq surprises de la mise en route, fixtures devenues la capture, pistes non lues.
- `6_faq/6_1_pieges-runtime.md` — domaine par application, clé en point hex, carte qui attend un rechargement.
- `4_ui/4_1_navigation-et-panneaux.md` — carte Tesla sur l'inventaire, rotation de clé, « — » pour un véhicule jamais lu.
- `3_plugins/3_0_simulation-mock.md` — le véhicule simulé fournit veille, rapport, vitesse, pneus, températures (reprise du « non couvert » de l'entrée précédente).
- `4_ui/4_2_theme-et-langues.md` — clés `vehicle.*` et `settings.tesla.*`, piège de l'ancre partagée (idem).

**Index** : mis à jour (5 lignes).

## [2026-09-13] update | Le plugin Tesla lit la voiture sans la réveiller, ni la facturer

**Déclencheur** : demande de l'utilisateur — « on peut essayer celui de la Tesla… bien faire attention
au battery drain… remonter le statut, niveau de charge, mouvement, position, pression des pneus…
pour l'instant juste de l'info ». Relevé préalable : Fleet API payante depuis 2025, domaine HTTPS
public obligatoire, véhicule Model S MCU2 (pré-2021), domaine disponible,
consigne « rester en gratuit ».

**Pages modifiées** :
- `3_plugins/3_3_fabricants-a-venir.md` — `tesla` quitte le tableau ; ce que la piste ne disait pas.
- `1_architecture/1_1_contrat-appareils.md` — `VehicleState` : veille, vitesse, rapport, pneus, températures.
- `4_ui/4_1_navigation-et-panneaux.md` — carte Tesla des Réglages, vue Véhicules enrichie.
- `5_setup/5_1_configuration-env.md` — variables `TESLA_*`.
- `5_setup/5_0_installation-et-scripts.md` — configuration de lancement `kasbah-mock`.

**Pages créées** :
- `3_plugins/3_8_tesla.md` — le plugin : trois contraintes du fabricant (domaine, facturation, veille),
  jetons à usage unique, fixtures provisoires, routes, côté web.

Non couvert cette fois (à reprendre) : `3_0_simulation-mock.md` (le véhicule simulé gagne veille,
rapport, vitesse, pneus, températures) et `4_2_theme-et-langues.md` (clés `vehicle.sleep.*`,
`vehicle.tire.*`, `settings.tesla.*`) — mentionnés dans `3_8_tesla.md`.

**Index** : mis à jour (6 lignes, dont 1 créée).

## [2026-09-13] update | Les onduleurs se montrent un par un, à leur place sur le toit

**Déclencheur** : demande de l'utilisateur — « dans la vue énergie, j'aimerais une section avec les
onduleurs et leur production instantanée, organisés par champ et ordonnés selon leurs positions ».
Puis six allers-retours qui ont déplacé le dessin : liste → grille du champ (« la même vision texte
que la représentation 3d »), crête réglable (la crête des modules varie), repère
d'écrêtage, `maxReportWatts` exploité comme record, repères reportés sur la jauge 3D, et le
vocabulaire des fiches techniques (« puissance de sortie max »).

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — `SensorState.maxValue`, record et non caractéristique.
- `2_maison/2_0_format-house-json.md` — `panel.peakW`, `maxOutputW`, et le module patché champ par champ.
- `1_architecture/1_5_scene-3d.md` — jauge de bord du module, ses deux repères, l'échelle qui les
  contient, `SceneTheme.warning` / `.success`, et les deux pistes écartées (anneau de pilule, verre rempli).
- `4_ui/4_1_navigation-et-panneaux.md` — la bande « Onduleurs » de la vue Énergie, les deux réglages
  de la carte des champs, la saisie sélectionnée au focus.
- `4_ui/4_2_theme-et-langues.md` — clés `arrays.peak*`, `arrays.maxOutput*`, `energy.maxReported` et voisines.
- `3_plugins/3_7_enphase.md` — `maxReportWatts` : ce qu'il dit, ce qu'il ne dit pas.
- `3_plugins/3_0_simulation-mock.md` — un panneau simulé tient son record, pour que la démo le montre.
- `6_faq/6_0_pieges-outillage.md` — sélectionner le contenu d'un champ au focus : deux mécanismes l'effacent.

**Index** : mis à jour (8 lignes).

## [2026-09-12] update (septies) | Les champs de panneaux se déclarent, et regardent le soleil

**Déclencheur** : demande de l'utilisateur — « lorsqu'on pose une installation solaire, il faut un
moyen de définir les champs avec le nb de panneaux, l'orientation… dans mon cas j'ai plusieurs champs
de panneaux à des emplacements différents du toit ». Puis une dizaine d'allers-retours sur l'usage réel : le lien
entre l'installation et ses champs, le sens de l'inclinaison, la correspondance entre la grille des
onduleurs et la 3D, et trois défauts de fond que ces gestes ont révélés.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — `siteId` (l'installation emporte ses champs), `yaw` devenu
  l'AZIMUT (rangées descendant vers le soleil, origine au coin haut), `slope` du support distinct du
  `tilt` signé des châssis, écriture (`panelArrayPatchSchema`, `putArrayInJson`), champ neuf vide et
  nommé, migration calculée de la maison de démonstration.
- `1_architecture/1_3_protocole-rest-ws.md` — `PUT` / `DELETE /api/house/arrays/:id`.
- `1_architecture/1_4_app-web.md` — le second mode d'édition du store (champ de panneaux), `editArray`
  et l'ordre qui compte, `siteOf` / `arraysOf`, `hoverSlot`, retour d'un module vers son installation.
- `1_architecture/1_5_scene-3d.md` — `setMovable` d'un GROUPE, pilules toutes transparentes au
  pointeur, verre penché vers l'azimut, ouvrant reconstruit qui se pose, marqueur allumé visible de
  loin, passerelle solaire en boîtier.
- `4_ui/4_1_navigation-et-panneaux.md` — la carte « Champs de panneaux », le panneau d'un module, le
  retrait qui annonce les champs emportés, le segmenté qui débordait.
- `4_ui/4_2_theme-et-langues.md` — section `arrays.*` (dont deux clés qui nomment des objets 3D).
- `3_plugins/3_7_enphase.md` — numéro de série coupé à cinq chiffres, la même longueur qu'ailleurs.
- `6_faq/6_1_pieges-runtime.md` — deux entrées : les volets qui rejouent leur course à chaque écriture
  dans la maison, et le tap qui referme le réglage en cours.
- `6_faq/6_0_pieges-outillage.md` — un contrôle segmenté ne se serre pas, il déborde (et la barre de
  défilement née ailleurs qui lui a pris les pixels).

**Pages créées** : aucune — tout s'est rattaché à des pages existantes.

**Index** : mis à jour (9 lignes).

**Note de méthode** : neuf pages pour une seule session, au-delà des cinq que `wiki-update` conseille.
Le découpage aurait séparé des faits qui se répondent (le format, ce que l'UI en montre, ce que la
scène en dessine) ; chaque section reste courte et renvoie aux autres plutôt que de les répéter.

## [2026-09-12] update (sexies) | Les valeurs du mode « Déplacer » se saisissent

**Déclencheur** : demande de l'utilisateur — des dizaines d'appuis sur « + » pour un portail de plusieurs mètres.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — champ de saisie pour l'orientation et les tailles :
  validation à l'Entrée ou au focus perdu, brouillon pendant la frappe, valeur nettoyée et bornée,
  empreinte identique à celle du texte qu'il remplace.

**Index** : mis à jour (1 ligne).

## [2026-09-12] update (quinquies) | Le toit se touche, et le fil d'Ariane nomme le parent

**Déclencheur** : trois constats de l'utilisateur sur la maison réelle — le clic sur le toit le
faisait disparaître au profit du 1er étage, le retour d'un appareil du toit affichait « Maison »
(« Salon devrait afficher 1er comme parent »), et « Maison » laissait la vue sur le niveau qu'on
regardait.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — le toit entre dans `pick()` (événement `levelTap`, appareils
  testés d'abord), niveau-toit cadré sur `roofBounds` avec une plongée de 35°, et le piège des
  matrices monde non mises à jour en mode `headless`.
- `1_architecture/1_4_app-web.md` — `selectedLevelId` / `selectLevel`, `backFromRoom` et
  `backFromDevice` : la hiérarchie appareil → pièce / zone / niveau → maison, et pourquoi le niveau
  n'a pas d'entrée d'URL propre.
- `4_ui/4_1_navigation-et-panneaux.md` — fil d'Ariane du parent, panneau d'un niveau (ses pièces puis
  ses appareils hors pièce), `RoomRows` extrait de `HomePanel`, « Maison » = onglet « Tout ».
- `4_ui/4_2_theme-et-langues.md` — clé `home.roomsCount`.

**Index** : mis à jour (4 lignes).

## [2026-09-12] update (quater) | Triangles creusés au T des façades, et la hauteur d'une pièce est son plafond

**Déclencheur** : deux constats de l'utilisateur, captures à l'appui, à la suite de la session sur les
angles de murs — des triangles creusés en haut des façades là où une cloison les rejoint, puis le mur
extérieur d'un petit local plus bas que celui de sa voisine.

**Pages modifiées** :
- `2_maison/2_1_geometrie.md` — deux sections : `extendAcross` (la façade passe devant la cloison ;
  pourquoi un balayage en plan ne voyait rien et pourquoi il fallait ne compter que les murs
  `exterior`) et `wallHeight` distinct de `roomHeight` (le plafond n'est pas l'enveloppe).
- `2_maison/2_0_format-house-json.md` — ce que `height` d'une pièce veut dire, et ce qu'il ne faut PAS
  lui faire dire (une annexe plus basse demande son propre niveau).
- `1_architecture/1_5_scene-3d.md` — `LOW_INTERIOR_WALL` ne crée pas ces défauts, il les révèle ;
  règle de recherche pour la suite.

**Index** : mis à jour (3 lignes).

## [2026-09-12] update (ter) | Angles de murs qui se traversent, ombres portées redevenues douces

**Déclencheur** : deux constats de l'utilisateur sur la vue 3D, capture à l'appui — des artefacts aux
intersections murs / cloisons, et des ombres portées « pas terribles ». L'éditeur voxel du projet
`un autre projet` est donné en référence de rendu.

**Pages modifiées** :
- `2_maison/2_1_geometrie.md` — `trimCrossRoomOverlaps` : à un angle de bâtiment, deux pièces portent
  les deux faces perpendiculaires et leurs prismes se croisent (16 paires mesurées sur `maison.json`,
  11 après correctif) ; **corrige** la parenthèse « jamais de z-fight » du point 3, vraie en vis-à-vis
  seulement.
- `1_architecture/1_5_scene-3d.md` — ombres : `VSMShadowMap`, `radius` / `blurSamples`, `normalBias`,
  frustum cadré sur le bâti et ajusté aux 8 coins dans le repère de la lumière ; **précise** la section
  « Rendu à la demande », qui nommait encore `PCFSoftShadowMap`.
- `6_faq/6_0_pieges-outillage.md` — nouvelle entrée : une dépréciation three qui change le rendu sans
  rien casser, signalée en console seulement.

**Index** : mis à jour (3 lignes).

## [2026-09-12] update (bis) | Une position inconnue vaut « au repos »

**Déclencheur** : décision de l'utilisateur après la première mise en service — un ouvrant dont on
ignore la position doit être considéré comme fermé (ou remonté pour un store), pour qu'un geste
d'ensemble n'ouvre jamais un portail ni ne déploie une toile.

**Pages modifiées** :
- `1_architecture/1_4_app-web.md` — `coverAtRest` et `isPassageCover`, et ce que la supposition ne
  change PAS (les libellés disent toujours « Inconnu », l'interrupteur de ligne ferme toujours).
- `1_architecture/1_5_scene-3d.md` — un ouvrant libre inconnu est dessiné au repos ; **remplace** la
  règle « objet déclaré en entier » écrite le matin même.
- `4_ui/4_1_navigation-et-panneaux.md` — l'interrupteur des Ouvrants sécurise (stores remontés, pas
  baissés) et n'ouvre que les volets ; les libellés montrent l'état supposé au lieu d'« Inconnu » ;
  **précise** la section du matin.

**Index** : mis à jour (3 lignes).

## [2026-09-12] update | ouvrants libres en 3D, luminosité de pièce, jauge d'ouverture, positions RTS

**Déclencheur** : session d'évolutions UI demandées par l'utilisateur sur la maison réelle (luminosité
de pièce, lisibilité de la vue Ouvrants, objets 3D du portail, des stores et du thermostat), plus deux
défauts relevés en usage : le repère de position favorite désaligné, et un store RTS arrêté à mi-course
annoncé « Baissé » à 100 %.

**Pages modifiées** :
- `1_architecture/1_3_protocole-rest-ws.md` — `size` et `leaves` dans `devicePlacementSchema`.
- `1_architecture/1_4_app-web.md` — placement avec taille et battants, `coverActivity` / `isFlatCover`,
  `isDeviceOn(state, descriptor?)`, `composables/useRoomLights.ts`.
- `1_architecture/1_5_scene-3d.md` — ouvrants libres (store à plat animé par le déploiement, portail à
  battants), position inconnue dessinée telle que déclarée, thermostat en pastille orientable.
- `2_maison/2_0_format-house-json.md` — champs `size` et `leaves` de `HouseDevice`.
- `3_plugins/3_4_somfy-tahoma.md` — l'arrêt efface la position supposée d'un RTS ; ce que le parc réel
  dit de `my`.
- `4_ui/4_1_navigation-et-panneaux.md` — cinq sections : luminosité de pièce, jauge d'ouverture,
  section « Déplacer » (taille, battants, rotation, débordement), interrupteurs maîtres de vue,
  ouvrant sans retour (mot au lieu du pourcentage, nature en sous-titre, pas du curseur à 1 %).
- `4_ui/4_2_theme-et-langues.md` — `cover.classes.*`, `kinds.cover` = « Ouvrant », clés du placement.
- `6_faq/6_0_pieges-outillage.md` — pouce Vuetify aligné sur le `step` vs repère `ticks` ; colonne de
  grille `auto` qui ne se serre pas.
- `6_faq/6_1_pieges-runtime.md` — une position supposée qui survit à l'arrêt qui l'invalide.

**Index** : mis à jour (9 lignes).

## [2026-09-12] update | Les quatre accents deviennent six thèmes nommés

**Déclencheur** : demande de l'utilisateur — « concernant le théming je souhaiterais plutôt qu'on
intègre une série de thèmes connus et qu'on puisse select celui qu'on souhaite. Faire en sorte de
pouvoir facilement en ajouter », avec la liste (Catppuccin, Dracula, Night Owl, Synthwave '84, Tokyo
Night). Deux arbitrages tranchés avant d'écrire : les 4 accents sont **supprimés** au profit d'un
thème « Kasbah » par défaut qui reprend l'ancienne palette avec le premier accent, et le thème
s'arrête au bord de la maison — « thémer les points, pastilles, bulles, labels, ondes… les éléments
3d restent pour l'instant comme ils sont ». Commit `abf88f5`.

**Pages modifiées** :
- `4_ui/4_2_theme-et-langues.md` — registre `src/themes/`, les six thèmes et leurs déclinaisons
  officielles (Mocha est le sombre de Catppuccin, le clair est Latte ; Alucard, Light Owl, Day), les
  15 rôles d'une palette et ce qui est dérivé (contour, ombre, `--on-accent` choisi par contraste
  WCAG), `wantDark` / `resolveVariant` et le thème sans variante claire qui impose la sienne,
  `kasbah.theme` sans migration, noms de thèmes hors i18n, les deux compromis assumés (le `muted`
  authentique mais dim de Dracula et Light Owl, les paliers crème inventés d'Alucard), garde-fous du
  test. Renvoi ajouté depuis la section « Apparence », qui décrivait les quatre accents.
- `4_ui/4_0_langage-visuel.md` — les jetons couleur sont désormais posés sur `<html>` depuis la
  palette du thème, `tokens.css` réduit au repli avant script (bloc sombre mort retiré), le tableau
  de jetons et celui des `--cat-*` valent maintenant pour le thème Kasbah, règle de choix des quatre
  teintes de catégorie face à l'accent du thème, `sceneMedia` = `--cat-media`.
- `4_ui/4_1_navigation-et-panneaux.md` — bloc « Thème » des Réglages : tuiles à empreinte fixe,
  aperçu rendu avec la palette elle-même, ligne de variante toujours réservée, badge statique
  « Sombre uniquement », aperçus qui montrent la variante DEMANDÉE et non l'appliquée.
- `1_architecture/1_5_scene-3d.md` — ce qui suit le thème (disques de catégorie, sélection, onde) et
  ce qui ne le suit pas (`SCENE_LIGHT` / `SCENE_DARK` communes) ; précision sur la mise à jour du
  2026-09-10, l'onde reste indépendante de l'accent mais suit désormais le thème.

**Index** : 4 lignes mises à jour (résumés + dates).

## [2026-09-11] update | Les plugins s'activent dans l'UI, et la maison retient lesquels

**Déclencheur** : demande de l'utilisateur — « la gestion des plugins dans le .env, c'est assez
pénible. Je pense que le mieux serait que ce qu'on a et qu'on va ajouter par la suite soient tous
dispo par défaut et qu'on ait juste à activer ceux qu'on souhaite dans les params », avec les
sous-items (« mock avec mock energy »). Deux arbitrages tranchés en cours de route : activer = un
interrupteur dans l'UI, et « les choix et infos sont maintenant dans le house.json » — ce qui a
emporté la suppression du second fichier de réglages (`.state/plugin-settings.json`).

**Pages modifiées** :
- `1_architecture/1_2_serveur-et-plugins.md` — hôte qui instancie TOUS les plugins, `settingsOf` lu
  dans la maison, `apply` (allumer / éteindre / redémarrer sur changement de sous-item), `inventory`,
  routes de plugin montées même éteint, `PluginSettingsStore` supprimé.
- `2_maison/2_0_format-house-json.md` — section `plugins` (activation, sous-items, ambiances),
  `setPluginInJson` et la section matérialisée en entier au premier patch.
- `1_architecture/1_3_protocole-rest-ws.md` — `GET /api/plugins` et `PATCH /api/plugins/:id`
  remplacent les deux routes de réglages.
- `1_architecture/1_4_app-web.md` — store `plugins`, ce que perd le store `scenes`.
- `3_plugins/3_0_simulation-mock.md` — `MOCK_EXCLUDE_KINDS` devient dix sous-items cochables.
- `3_plugins/3_2_ecrire-un-plugin.md` — `implemented`, `parts`, `ctx.parts` au contrat.
- `4_ui/4_1_navigation-et-panneaux.md` — carte Plugins : interrupteur par fabricant, pastilles de
  sous-items, squelette grisé.
- `5_setup/5_1_configuration-env.md` — `KASBAH_PLUGINS`, `KASBAH_SETTINGS_FILE` et
  `MOCK_EXCLUDE_KINDS` supprimées ; note de migration.
- `5_setup/5_0_installation-et-scripts.md` — ce que les deux serveurs de dev partagent désormais.
- `6_faq/6_0_pieges-outillage.md` — deux pièges : `.partial()` de zod 4 qui réinjecte le défaut d'un
  champ optionnel (un patch de sous-item éteignait le plugin), et `v-checkbox-btn` qui rend une icône
  vide faute d'alias `$checkboxOn` dans le jeu d'icônes maison.

**Index** : 10 lignes mises à jour (résumés + dates).

## [2026-09-11] update | Un flux d'énergie qui ne dit que ce qu'il mesure

**Déclencheur** : demande de l'utilisateur — « actuellement le flow energie affiche qu'un véhicule
charge, hors ce n'est pas le cas et de toute façon on a pas encore accès à la borne », puis, capture
de l'appli Enphase live à l'appui, « on affiche aussi des flux réseau et PV alors qu'on est uniquement
sur batterie ». Deux allers-retours ensuite sur le seuil d'inactivité (« 100w idle ça me parait
beaucoup », « si on baisse à 10 ou 7w qui correspond à une ampoule led »), chacun tranché par une
mesure sur la vraie passerelle plutôt que par une préférence.

**Pages modifiées** :
- `3_plugins/3_0_simulation-mock.md` — deuxième raison d'exclure un kind de la simulation : non plus
  « un vrai plugin le couvre » mais « personne ne le couvre, et la valeur simulée passe pour une
  mesure » (`MOCK_EXCLUDE_KINDS=…,ev_charger`). Pourquoi le véhicule simulé reste, et l'ancre devenue
  inerte dans `house/maison.json`.
- `3_plugins/3_7_enphase.md` — `productionW` ramenée à 0 sur les deux chemins (`livedata` et repli
  `production.json`), et les deux mesures qui servent au-delà du plugin : une faible production réelle au
  crépuscule (micro-onduleurs à 1–3 W) là où l'appli du fabricant affiche « 0,0 », et un bilan de
  compteurs qui laisse 0 à 11 W de reste.
- `4_ui/4_1_navigation-et-panneaux.md` — vue Énergie : tableau du trajet de décision du seuil
  (20 → 100 rejeté → 7 écarté → 10 W), part Solaire de l'anneau bornée par la production, mot
  « Inactif » sous le seuil, et le nœud « Borne » qui n'avait rien à corriger.
- `1_architecture/1_1_contrat-appareils.md` — invariant `productionW ≥ 0` écrit dans le contrat, et
  pourquoi un commentaire plutôt qu'une borne zod (un patch rejeté fige l'état).
- `6_faq/6_1_pieges-runtime.md` — nouvelle entrée : caler un seuil sur l'affichage arrondi d'une autre
  appli efface des mesures réelles ; et un symptôme unique cachait ici deux causes indépendantes.

**Index** : mis à jour (5 lignes).

## [2026-09-11] update | Déplacer un appareil d'un niveau à l'autre, et un guide qui se voyait enfin

**Déclencheur** : demande de l'utilisateur — « on a maintenant le toit qui est un niveau, je voudrais
déplacer la caméra "toit" qui est au 1er seulement je ne parviens pas à le faire via l'UI », puis, une
fois la caméra sur le toit, « on ne voit pas le cercle au sol et le cône pour orienter ».

**Pages modifiées** :
- `1_architecture/1_4_app-web.md` — `moveToLevel` dans le store `house` : le watch de `focusedLevelId`
  ré-ancre l'appareil sélectionné tant que le mode « déplacer » est ouvert (x;y gardés, pièce reprise
  sous le point, z recalculé pour garder la hauteur absolue) ; `savePlacement` accepte `levelId`, posé
  seulement sans pièce ; `placingOrigin` mémorise le niveau et « Rétablir » le ramène — sans sortir
  l'appareil de sa pièce.
- `1_architecture/1_5_scene-3d.md` — le guide du mode « déplacer » (anneau, fil, cône) passe en
  `depthTest: false` + `renderOrder` : sur un niveau-toit, le sol du niveau est la BASE de la dalle de
  toiture, qui enterrait anneau et cône ; compromis assumé (le guide se voit à travers).
- `4_ui/4_1_navigation-et-panneaux.md` — les onglets de niveau emmènent l'appareil qu'on déplace (geste
  étendu depuis l'appareil provisoire, plutôt qu'un sélecteur de plus), conseil de la section réécrit,
  et la ligne `x · y ·` affiche le niveau à défaut de pièce ; lecture à jour de la phrase du 2026-09-07
  sur les onglets qui « quittent le mode ».

**Index** : mis à jour (3 lignes).

## [2026-09-11] update | Vue Énergie : échelle de temps des deux blocs, et trois pièges de grille CSS

**Déclencheur** : demande de l'utilisateur — « pour le bloc flow enphase, j'aimerais pouvoir
facilement switcher de mode instantané au mode journée », puis, le sélecteur de période remis à plus
tard faute de données datées, « en attendant dans les blocs on peut indiquer instantané pour le flow
et historique local pour la prod jour », suivi du nettoyage du CSS orphelin et de la correction du
débordement horizontal.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — les deux blocs annoncent leur échelle de temps sous leur
  titre (le bloc de flux n'avait aucun titre visible) ; pourquoi sous le titre et non à côté (la
  hauteur de l'en-tête suivait sinon la production du jour) ; pourquoi le sélecteur
  live/jour/mois/année/exploitation n'est pas implémenté (l'API locale ne publie que des compteurs,
  la série datée est dans le cloud Enphase, et l'historique du serveur vit 48 h en mémoire) et la
  voie locale repérée par le compteur monotone `whLifetime` ; largeur plancher de 380 px du schéma,
  qui défile dans sa carte ; CSS orphelin de l'ancienne maquette à quatre tuiles retiré.
- `6_faq/6_0_pieges-outillage.md` — nouvelle entrée : trois façons pour une grille CSS de déborder la
  page ou de changer de hauteur toute seule — le plancher `minmax(340px, 1fr)` de `RoomBands` qui
  faisait déborder les cinq vues en bandes, un `min-width` qui remonte toute la chaîne des cellules,
  et un `min-width: 0` posé par réflexe qui coupe un mot. Avec le garde-fou qui a tenu : vérifier
  `scrollWidth === clientWidth` à treize largeurs et réécrire la valeur affichée pour comparer les
  hauteurs.

**Index** : mis à jour (2 lignes).

## [2026-09-11] update | Plugin Enphase, champs de panneaux sur le toit, vue Énergie refondue

**Déclencheur** : session complète demandée par l'utilisateur — « explorer la faisabilité du plugin
enphase », puis la pose des panneaux sur le toit, la lecture de la vraie passerelle, et la refonte de
la vue Énergie « inspirée de l'app Enphase, où on voit les flux d'électrons ». Commits 01d66e5,
3b4767a, a89ae3b, 8ded591, 181cd72, 1551583.

**Page créée** :
- `3_plugins/3_7_enphase.md` — le plugin : ce que l'API locale donne et ce qu'elle refuse (la borne
  IQ EV Charger 2 est cloud seul), le jeton d'un an et le piège de l'auto-installateur vérifié sur le
  vrai compte (12 h par le formulaire web), la décision « aucun mot de passe en configuration », les
  trois sortes d'appareils publiés, les cinq pièges que seule une capture révèle (signe du stockage
  inversé démontré par le bilan au milliwatt, deux productions dont une en retard, `whToday` nul sur
  `net-consumption`, clé `"devices:"`, lenteur de `production.json`), et les cadences que la vitesse
  mesurée de la passerelle impose.

**Pages modifiées** :
- `3_plugins/3_3_fabricants-a-venir.md` — `enphase` sort du tableau ; deux corrections à la piste
  annoncée (kinds réels, borne inaccessible) et la leçon sur la note technique du constructeur.
- `2_maison/2_0_format-house-json.md` — le toit comme niveau (élévation = base du toit) et `arrays`,
  les champs de panneaux : pourquoi les positions des modules sont dérivées et jamais écrites,
  `meta.panel`, et les trois refus de la validation croisée.
- `3_plugins/3_0_simulation-mock.md` — vingt panneaux simulés, et `SimDevice.partOf` avec
  `Simulation.hiddenFor` : exclure `energy` emporte l'installation solaire entière sans toucher aux
  autres capteurs.
- `4_ui/4_1_navigation-et-panneaux.md` — vue Énergie : liste d'appareils par `RoomBands` multi-kinds
  (panneaux volontairement exclus), site reconnu à la mesure du réseau, schéma de flux (anneau
  d'origine de la consommation, tracés côté → haut/bas du cercle, un point lent, seuil commun de
  20 W), carte d'appairage Enphase et ses trois pièges d'affichage mesurés, orientation élargie.
- `5_setup/5_1_configuration-env.md` — les cinq clés `ENPHASE_*`, l'absence volontaire d'une clé de
  mot de passe, et la règle « le jeton qui expire le plus tard gagne ».
- `1_architecture/1_5_scene-3d.md` — `PanelMarker`, toit visible depuis le niveau qui le porte,
  rotation du maillage des coffrets (piège : `isOrientable` ne suffit pas).
- `6_faq/6_0_pieges-outillage.md` — nouvelle entrée : une cellule de grille en `overflow: hidden`
  perd sa contribution de hauteur, et ni `aspect-ratio` ni un `padding` en pourcentage ne
  dimensionnent une rangée.

**Index** : mis à jour (7 dates, 6 résumés complétés, 1 ligne ajoutée).

**Non documenté ici** : le niveau `toit` a aussi été ajouté à `house/maison.json`, qui est ignoré par
git pour des raisons de vie privée — seul le principe est décrit, dans la page du format.

## [2026-09-11] update | Tuiles de synthèse du panneau maison : caméras et lecteurs

**Déclencheur** : l'utilisateur — « pour ces pills d'info globales on peut pour l'instant remplacer
"solaire" et "batterie" par les infos "caméras" et "lecteurs" ». Remplacement explicitement provisoire.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — liste des tuiles du `HomePanel` corrigée (mention de l'état
  d'avant le 2026-09-11) et sous-section datée : pourquoi les caméras n'ont qu'un nombre (seul
  `available` dans `cameraStateSchema`, l'« active » de la vue Caméras vient du sondage des vignettes)
  et les lecteurs une fraction (le `playing` de `useHomeSummary`, relais HDMI ARC compris), compteur
  `cameras` ajouté au composable, clés `home.cameras` / `home.players` contre `home.battery` supprimée,
  hauteurs mesurées (84 px, libellés d'une ligne de 18 px)

**Index** : mis à jour (1 ligne).

## [2026-09-11] update | Interrupteur maître des lumières d'une pièce

**Déclencheur** : l'utilisateur — « j'aimerais pouvoir allumer ou éteindre complètement une pièce sans
avoir à actionner chaque lampe ». Portée (lampes seulement) et emplacements (panneau pièce, vue Lumières,
panneau maison) choisis par lui parmi les options proposées ; l'ampoule dans le pouce de l'interrupteur
vient de sa remarque en cours de session, le libellé « Lumières » du premier jet a été retiré à sa demande.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — `RoomLightsToggle`, les trois décisions (lampes seulement, coché
  dès qu'une est allumée, n'écrire que sur celles qui changent), présence ≠ disponibilité, pourquoi le lot
  de commandes plutôt que le `grouped_light` du pont (question ouverte), slot `room-action` de `RoomBands`,
  effets de bord `HomePanel` (ligne en `div role=button`, ellipsis) et `.group__title`, clé `rooms.allLights`
- `4_ui/4_0_langage-visuel.md` — icône dans le pouce d'un `v-switch` : ampoule du jeu maison, pourquoi pas
  soleil / lune (déjà l'apparence clair / sombre), un seul glyphe pour deux états, contrastes relevés

**Index** : mis à jour (2 lignes).

## [2026-09-11] update | Pilules des marqueurs 3D : catégorie sur le disque, état par remplissage, niveau de détail selon l'échelle écran

**Déclencheur** : l'utilisateur — « la vue 3d commence à être chargée […] beaucoup de labels qui passent
devant les objets. comment rendre cette ui plus légère sans perdre les infos » puis « différencier les 4
catégories d'appareils dans ces bulles ». Codé directement dans l'app plutôt qu'en maquette, à sa demande,
et validé sur la preview (trois échelles, deux thèmes).

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — `data-lod` (`full` / `icon` / `dot`) posé par `HouseScene.updatePillLod` selon les px/m, seuils relevés, disque d'icône point fixe (ancre 0 × 0, `translate(-15px,-15px)`), pièges `width: max-content` et `span` du disque, structure DOM de la pilule
- `4_ui/4_0_langage-visuel.md` — catégorie / état / sélection sur trois supports, palette `--cat-*` (Médias = `sceneMedia`), `deviceCategory()`, rendu CSS des niveaux de détail

**Index** : mis à jour (2 lignes).

## [2026-09-10] update | Le son de la TV sort par la barre : sonde Sony, lien `meta.audioOutput`, onde sur l'appareil qu'on entend

**Déclencheur** : l'utilisateur — « "tv 1" diffuse youtubemusic mais la sortie son est dirigée vers
"barre de son" […] possible de capter ces infos et de bien afficher les contreparties dans l'app ? ».
Relevé : la barre de son est au repos côté Cast (HDMI eARC, invisible pour le
protocole) ; la TV Sony BRAVIA le dit par son API REST locale, sans clé. Décisions de l'utilisateur :
lien TV → barre déclaré dans house.json, le compteur de l'en-tête ne compte pas la barre.

**Pages modifiées** :
- `3_plugins/3_6_google-cast.md` — relevé (barre au repos, API Bravia : méthodes ouvertes / 403), sonde `bravia.ts`, `audioOutput`, lien déclaré, vérification réelle, piège du house.json relu au démarrage
- `1_architecture/1_1_contrat-appareils.md` — champ `audioOutput` de l'état `media_player`
- `2_maison/2_0_format-house-json.md` — `meta.audioOutput` (sens source → puits, id maison, survit aux placements)
- `1_architecture/1_5_scene-3d.md` — `SoundCue` : l'onde va sur l'appareil qu'on entend, la pochette reste sur la TV
- `1_architecture/1_4_app-web.md` — `lib/audioRouting.ts`, `house.soundRoutes` / `relaySource`
- `4_ui/4_1_navigation-et-panneaux.md` — « Son de TV Salon · titre » dans les listes et le panneau ; révision le même jour : barre cochée, interrupteur et lire / pause agissant sur la TV, pochette de la TV en fond, compteurs (en-tête, vue Médias, pièce) comptant les deux
- `5_setup/5_1_configuration-env.md` — `CAST_BRAVIA_PROBE`

**Index** : mis à jour (7 lignes).

## [2026-09-10] update | Cadrer la sélection : l'appareil vu depuis sa pièce, et le compteur qui se nomme

**Déclencheur** : l'utilisateur — « quand on sélectionne une pièce ou un objet connecté il faudrait
que la vue se positionne mieux sur la sélection avec un peu plus de zoom », puis en cours de session
« dans le header on a par exemple "1 en diffusion", mais 1 quoi ? ». Le premier point cachait un
défaut de fond (un appareil se cadrait sur sa pièce) et un piège de géométrie (l'azimut conservé
plaçait la caméra derrière le mur contre lequel l'appareil est posé), tous deux constatés en preview
sur le parc réel avant d'être corrigés.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée : `focusDevice` et sa boîte fixe de 3 m,
  `roomSideAzimuth` (regarder depuis le centre de la pièce) et l'azimut de l'utilisateur écrasé,
  `DEVICE_FOCUS_POLAR`, les marges de pièce et de zone resserrées, et la mesure qui montre que la
  formule par sphère englobante n'est que 1 % trop large — la marge était le seul levier.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : `summary.playing` en « {n} lecteurs en
  diffusion », les formes de pluriel qui manquaient, et pourquoi « lecteur » plutôt que « média »,
  « enceinte » ou « appareil ».

**Index** : mis à jour (2 lignes).

## [2026-09-10] update | La pochette sur l'écran 3D : cadrage cover, bords fondus, voile dégradé

**Déclencheur** : l'utilisateur — « on pourrait afficher l'artwork sur une face de l'objet 3D, ex. la
pochette du titre en cours sur la TV ». Puis trois retours successifs en regardant le résultat :
« plutôt en mode cover de toute la surface avec un effet fade sur les côtés », « cover sans déformer
l'image, comme en css », « ça semble déformé et ça ne prend pas tout l'espace ». Le dernier a révélé un
vrai piège Three.js (le cadrage posé sur la texture était ignoré par le shader). Enfin : « j'affiche
les images avec un filtre par dessus dans mes projets web, ça adoucit l'ensemble » → voile dégradé.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` — section datée : `screenArt.ts`, l'orientation du plan (et pourquoi
  « droite = +X » demanderait un miroir), le cadrage `cover` sans déformation, le fondu des bords, le
  voile dégradé transposé du CSS, le matériau non éclairé, les points de couture `invalidate` et
  `loadTexture`, et le cycle de vie des textures.
- `6_faq/6_0_pieges-outillage.md` — `texture.repeat` / `offset` ignorés par un `ShaderMaterial` écrit à
  la main : le cadrage doit passer par des uniformes.
- `1_architecture/1_5_scene-3d.md` — dernier retour de l'utilisateur (« enlever le fade sur les côtés
  et juste laisser le cadrage et le filtre gradient ») : fondu des bords retiré, et pourquoi il ne
  manquait pas — le bord de l'image tombe sur l'arête vraie de la dalle.

**Index** : mis à jour (2 lignes).

## [2026-09-10] update | La pochette du morceau à défaut de la vignette : iTunes puis Deezer, correspondance vérifiée

**Déclencheur** : l'utilisateur, sur la lecture YouTube de la TV — « c'est vraiment dommage de ne pas
pouvoir récupérer l'artwork du titre qui passe ». Deux relevés avant de coder : les canaux Cast locaux
(pas d'identifiant de vidéo, seulement un `screenId` sur `youtube.mdx`) et les catalogues publics sur
les vrais morceaux. Voie *lounge* écartée par l'utilisateur ; option « iTunes puis Deezer » retenue.

**Pages modifiées** :
- `3_plugins/3_6_google-cast.md` — section datée : ce que le protocole local ne donne pas (relevé
  `tools/cast-probe.mts`), les deux catalogues mesurés sur le parc réel, `enrich/cover.ts`, le
  contrôle de correspondance, le cache des échecs, la chaîne de pochette du plus précis au plus
  général, vérification en réel (un artiste), et la limite assumée (pochette d'album).
- `6_faq/6_1_pieges-runtime.md` — une API de recherche répond toujours quelque chose : vérifier la
  correspondance fait partie de l'appel.
- `5_setup/5_1_configuration-env.md` — `CAST_COVER_LOOKUP`.

**Index** : mis à jour (3 lignes).

## [2026-09-10] update | Les médias ne sont plus qu'une enceinte : icône, vocabulaire, onde

**Déclencheur** : l'utilisateur — « l'icone de la side barre de gauche pour les médias est un haut
parleur. les médias regroupent maintenant un tas d'objets comme des TV ou autres. y aurait il un
meilleur visuel que le HP ? aussi dans certains textes comme les headers on affiche "n en lecture",
y aurait il un terme plus approprié ? "n diffusent" ? ». Puis, sur l'onde 3D : « au lieu d'utiliser
la couleur d'accent on peut utiliser qqchose qui va ressortir un peu plus comme un bleu adapté », et
« tu peux faire pulser un peu moins vite aussi ». Commit `7ced3c2`.

**Pages modifiées** :
- `4_ui/4_0_langage-visuel.md` — section datée : pourquoi une icône de catégorie n'est pas une icône
  d'objet, glyphe `cast`, les deux candidats écartés (play encadré, ondes concentriques), et le
  jeton de palette `sceneMedia` qui affranchit l'onde de l'accent.
- `1_architecture/1_5_scene-3d.md` — section datée : `theme.media` à la place de `theme.primary`, et
  la vraie cause de l'invisibilité (opacité en (1 − p)² pendant que le rayon grandit, épaisseur à
  8 % du rayon) ; fondu linéaire, anneau à 14 %, période 5,75 s.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : « en diffusion » aux trois endroits, pourquoi
  la forme nominale plutôt que « 3 diffusent », `kinds.media_player` = « Lecteur » (repli sans
  appelant vivant), et l'entrée `media` du rail qui passe à `cast`.

**Index** : mis à jour (3 lignes).

## [2026-09-10] update | Un direct Cast : « précédent » coupait le flux

**Déclencheur** : l'utilisateur — « sur un chromecast j'ai un direct d'une radio d'info qui tourne
mais les boutons prev/next ne sont pas disabled. quand je clic sur prev alors ça coupe le stream et
ensuite l'enceinte semble être dans un état bizarre » (appareil confirmé ensuite : un Nest Mini,
celui dont vient la fixture `MEDIA_STATUS_RADIO`). Puis, sur la piste du masque de commandes :
« une appli de streaming vidéo prev/next ça marche il me semble » — ce qui l'a écartée.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : `nowPlaying.live` (ajout additif),
  distinction avec une durée absente, ce que le direct interdit (précédent, suivant, se placer) et ce
  qu'il autorise ; pourquoi ce n'est pas une capacité.
- `3_plugins/3_6_google-cast.md` — section datée : le `SEEK` à 0 envoyé sur un direct par la règle de
  télécommande, `isLive()` sur `media.streamType`, tableau des trois masques réels
  (`12495` sur-annonce, `143` sous-annonce, `79`), garde-fou à trois niveaux, `refuseOnLive`, ce qui
  n'est pas réparé (session morte, `media_player.stop` inaccessible en `idle`).
- `6_faq/6_1_pieges-runtime.md` — entrée Symptôme / Diagnostic / Solution / Leçon : une règle valable
  pour un morceau appliquée à un flux, et un masque de capacités qui se trompe dans les deux sens.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : précédent, suivant et curseur grisés sur un
  direct, dans le panneau comme dans la vue Médias ; lecture / pause et volume conservés.

**Index** : mis à jour (4 lignes).

## [2026-09-10] update | Appli de vidéo : durée négative, et une appli native qui ne publie rien

**Déclencheur** : l'utilisateur — « je viens de lancer une appli de vidéo sur la tv et ça n'affiche pas grand
chose » (capture : « -1:-1 » des deux côtés du curseur, « … » en guise de titre). Relevé de la vraie
lecture par `/raw`, puis correction.

**Pages modifiées** :
- `3_plugins/3_6_google-cast.md` — section datée : la capture d'une appli de vidéo (fixtures ajoutées),
  `duration: -0.001` = « inconnue », appli native de TV Android qui ne publie aucune métadonnée, ce
  que le protocole donne quand même, piste GTI Amazon.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : sans titre on nomme l'appli (le « … »
  d'attente est retiré), les temps s'affichent dès qu'une position est connue, le curseur reste caché
  sans durée ; statut de liste « Lecture · <appli> ».
- `6_faq/6_1_pieges-runtime.md` — « -1:-1 » : une valeur négative acceptée comme durée, qui bornait
  et écrasait la position. Valider le domaine, pas seulement le type.
- `3_plugins/3_6_google-cast.md` — complément : Prime Video ajouté à `NATIVE_APP_IDS` (identifiant de
  registre `17608BC8` vérifié, fixture ajoutée), logo en pochette de repli comme pour Netflix.
- `3_plugins/3_6_google-cast.md` — section datée : `universalAppId` interrogé avant `appId` (YouTube
  sur TV Android tourne sous `2C6A6E3D`, sans visuel au registre ; ses logos sont sous `233637DE`),
  fixtures réelles YouTube, et le constat général : sur ce matériel, aucune appli n'envoie d'image.

**Index** : mis à jour (3 lignes).

## [2026-09-10] update | Le plugin Cast se souvient des appareils vus ; rien ne déborde du panneau

**Déclencheur** : l'utilisateur — « "TV Salon" est éteinte mais elle apparaît comme ça dans l'app, pourtant
elle avait été enregistrée » (capture : id brut dans le panneau et dans la pilule 3D, « lié à aucun
plugin »), « aussi tout déborde dans le panel ; comme pour le player média, soit ellipsis, soit faire
scroller le texte avec fade ». Trois options proposées pour la première ; réponse : « 1 mais il faudrait
peut-être prévoir dans ce cas de pouvoir retirer un appareil ».

**Pages modifiées** :
- `3_plugins/3_6_google-cast.md` — section datée : `known.ts` (dernière annonce de chaque appareil,
  `CAST_KNOWN_FILE`, `.tmp` par pid), entrées créées avant la découverte, dédoublonnage sorti de
  `discovery.ts` (annonce changée → mémoire + reconnexion ; annonce répétée → tentative immédiate),
  route d'oubli, ce que la mémoire ne peut pas faire.
- `1_architecture/1_1_contrat-appareils.md` — `meta.forgettable` (ajout additif) et la règle d'affichage.
- `1_architecture/1_3_protocole-rest-ws.md` — `DELETE /api/plugins/<plugin>/devices/<externalId>`.
- `1_architecture/1_4_app-web.md` — `Transport.forgetDevice`, `devices.forget` (la liste revient du serveur).
- `4_ui/4_1_navigation-et-panneaux.md` — « Oublier l'appareil » (deux temps, panneau appareil et bande
  « Hors maison » sur sa propre ligne) et les cinq règles anti-débordement du panneau, mesurées.
- `4_ui/4_0_langage-visuel.md` — pilule de marqueur bornée à 210 px, ellipsis, nom entier en infobulle.
- `5_setup/5_1_configuration-env.md` — `CAST_KNOWN_FILE` (chaîne vide = ne rien retenir).
- `6_faq/6_1_pieges-runtime.md` — deux entrées : un défaut de configuration qui désigne un fichier du
  dépôt (les tests lisaient et écrivaient la mémoire Cast du poste), et un Cast en veille profonde qui
  disparaît de l'inventaire en emportant le nom de l'appareil.

**Index** : mis à jour (8 lignes).

## [2026-09-10] update | Appli sans canal média : état `on` « À l'écran » (Netflix natif sur Chromecast)

**Déclencheur** : l'utilisateur — « j'ai lancé une appli de streaming sur une TV et on ne voit rien dans
l'UI, l'appareil affiche même "au repos" ». Diagnostic par `/raw` : appli déclarée sans `transportId` ni
`namespaces`, rejetée par le schéma. Option 1 retenue parmi trois (nouvel état plutôt que `idle` + source ou
`playing` présumé). Question ouverte de l'utilisateur sur une suite (retrouver le titre Netflix) : réponse
notée dans la page (pas d'API Netflix, piste ADB).

Retours dans la même session : `on` doit être ACTIF (interrupteur, pulse, onde 3D) et le logo de l'appli
sert de pochette de repli, généralisé par le registre public des applis Cast (`enrich/appIcon.ts`). Puis
« ajoute le STOP pour fermer l'appli avec le switch » : commande `media_player.stop` dans le contrat, `STOP` de
la session Cast ; et le « Dismiss » des toasts traduit (« Fermer »).

**Pages modifiées** :
- `3_plugins/3_6_google-cast.md` — section datée : symptôme, cause, représentation `on`, fixture, limite et piste ADB ; retours : `on` actif, logo d'appli en repli (registre Cast, table des applis natives), question ouverte du « STOP ».
- `1_architecture/1_1_contrat-appareils.md` — sections datées : `PLAYBACKS` gagne `on`, sémantique, `isMediaActive` côté UI ; commande `media_player.stop`.
- `3_plugins/3_6_google-cast.md` — `stopApp` (STOP de la session), vérifié en réel ; toasts « Fermer ».
- `3_plugins/3_6_google-cast.md` — essai ADB (débogage sans fil, Android 14) : Netflix publie lecture / pause et position, pas de titre.

**Index** : mis à jour (2 lignes).

## [2026-09-10] update | Poser un appareil « Non placé » depuis une liste (provisoire, niveau par les onglets)

**Déclencheur** : l'utilisateur — « je viens d'allumer un appareil qu'on n'avait pas découvert, TV Salon :
hors maison, comment le proposer au placement, à n'importe quel niveau ? un bouton, clic et on arrive sur la
vue 3D ». Bouton « Placer » dans `RoomBands`, appareil provisoire dans le store, niveau par les onglets,
première écriture au dépôt (pièce ou `levelId`, nouveau dans le contrat de placement).

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — section datée : `levelId` accepté par le placement.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : le flux « Placer », vérifié avec la TV Salon.
- `4_ui/4_1_navigation-et-panneaux.md` — retours du premier essai : « Annuler » pour un provisoire, « Retirer de la maison » en deux temps, carte « Placer » du panneau, navigation avant état.
- `1_architecture/1_3_protocole-rest-ws.md` — `DELETE /api/house/devices/:id`.
- `2_maison/2_0_format-house-json.md` — `removeDeviceFromJson`.
- `6_faq/6_1_pieges-runtime.md` — récidive du watcher URL : naviguer d'abord, poser l'état ensuite.

**Index** : mis à jour (2 lignes).

## [2026-09-10] update | « n en lecture » dans l'en-tête ; enrichissement Crunchyroll par l'API interne, sans compte

**Déclencheur** : l'utilisateur — « dans le header on peut afficher le n en lecture comme pour les
lumières et volets », et « on verra plus tard, ça peut être noté » pour la recherche web des
métadonnées Crunchyroll (page JS sans balises, AniList fermée, DuckDuckGo HTML + Kitsu concluants).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : compteur de lecture dans l'en-tête.
- `3_plugins/3_6_google-cast.md` — piste notée : enrichissement par recherche web, résultats des essais.
- `3_plugins/3_6_google-cast.md` — essai concluant de l'API interne Crunchyroll en anonyme, puis enrichissement codé (`enrich/crunchyroll.ts`, `CAST_CRUNCHYROLL_ENRICH`).
- `5_setup/5_1_configuration-env.md` — variable `CAST_CRUNCHYROLL_ENRICH`.

**Index** : mis à jour (2 lignes).

## [2026-09-09] update | Lignes d'appareil : point de lecture, statut défilant, pochette ; onde sonore directionnelle

**Déclencheur** : l'utilisateur, éléments pointés à l'écran — le point pulsant du panneau pièce restait
éteint pendant une lecture ; « afficher l'artwork en background aussi sur cet élément » (ligne de la vue
Médias) ; « le pulse audio peut-il être plus intense dans la direction du cône ? » ; un statut trop long
coupé dans le panneau pièce. Prédicat `isDevicePulsing`, slot `backdrop` de `RoomBands`, `MarqueeText`
dans les statuts de ligne, nuanceur `waveMaterial` à fondu angulaire.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — point de lecture, statut défilant, pochette en fond de ligne, teinte des lampes allumées, curseur de luminosité réservé.
- `3_plugins/3_6_google-cast.md` — capture Crunchyroll : métadonnées génériques, champs faits d'espaces.
- `1_architecture/1_5_scene-3d.md` — onde sonore plus forte devant que derrière.

**Index** : inchangé (résumés déjà couvrants).

## [2026-09-09] update | Panneau lecteur figé, textes qui défilent, onde sonore 3D, pause sans `media`

**Déclencheur** : l'utilisateur, captures à l'appui — « entre la lecture et la pause, tout bouge ; il
faut des emplacements figés », puis « un texte trop long peut défiler doucement avec un fondu »,
« l'appareil en 3D peut émettre un pulse comme des ondes sonores », et « au changement de titre on voit
des identifiants ». Bloc « en cours » à quatre lignes permanentes, `MarqueeText`, anneaux animés dans
`GenericMarker`, en-tête du panneau par nature de lecteur ; côté plugin, `media` hérité quand un état
n'en porte pas, et plus jamais `contentId` comme titre.

**Pages modifiées** :
- `4_ui/4_0_langage-visuel.md` — quatrième cas de « rien ne doit bouger », `MarqueeText`, en-tête par nature, repère d'attente « … » pendant les métadonnées, position interpolée côté client, pochette en fond du panneau (préchargée).
- `1_architecture/1_5_scene-3d.md` — onde sonore d'un lecteur en lecture.
- `6_faq/6_1_pieges-runtime.md` — entrée : morceau perdu à la pause, identifiant en titre.
- `3_plugins/3_6_google-cast.md` — section datée renvoyant aux trois autres.
- `1_architecture/1_1_contrat-appareils.md` — sens de `media_player.previous` (retour au début passé 3 s).
- `1_architecture/1_1_contrat-appareils.md` — capacité `seek` et commande `media_player.seek`.
- `3_plugins/3_6_google-cast.md` — pochettes relayées par le serveur (429 Google), `seek`, « précédent » intelligent.
- `4_ui/4_0_langage-visuel.md` (bis) — bloc sans répétition, curseur de position, ligne de volume (sourdine, −, curseur, +, valeur).
- `4_ui/4_1_navigation-et-panneaux.md` — section « Emplacement » calée au fond du panneau appareil (panneau en colonne flex).
- `4_ui/4_1_navigation-et-panneaux.md` — ligne « Orientation » (rotation par 45°) du mode « Déplacer ».
- `2_maison/2_0_format-house-json.md` — `yaw` accepté par le placement et écrit dans le JSON brut.
- `1_architecture/1_5_scene-3d.md` — écrans tournés selon `yaw`.
- `4_ui/4_1_navigation-et-panneaux.md` — section « Emplacement » : ouverture animée vers le haut, bouton unique à place fixe, « Rétablir » réservé.
- `1_architecture/1_5_scene-3d.md` — cône « regarde vers » au sol pendant le mode « Déplacer » (`lib/orientation.ts` partagé).

**Index** : mis à jour (4 lignes).

## [2026-09-09] update | Lecture réelle sur le Nest Mini : `duration: null` rejetait le MEDIA_STATUS

**Déclencheur** : l'utilisateur — log `MEDIA_STATUS with an unexpected shape ignored` (`media.duration`
`null`) et « une radio joue dans la cuisine, l'enceinte est au repos et non contrôlable ». Schémas du
plugin `google_cast` passés en `nullish`, mappage tolérant aux vides, capture réelle transformée en
fixture, vérifié en réel.

**Pages modifiées** :
- `6_faq/6_1_pieges-runtime.md` — entrée : radio en lecture, enceinte « Au repos » (schéma trop strict).
- `3_plugins/3_6_google-cast.md` — section datée : première fixture réelle de lecture, `contentUrl`, `statusText`.

**Index** : mis à jour (2 lignes).

## [2026-09-09] update | Nature d'un lecteur : `meta.mediaPlayer.deviceClass` (enceinte, téléviseur, écran connecté)

**Déclencheur** : l'utilisateur — « Deux Chromecast sont branchés sur
une TV, possible de détecter ça et de changer type, icône et élément 3D, ou faut-il le définir dans
house.json ? » Détection côté plugin (masque mDNS « sortie vidéo » + modèle), classe optionnelle dans
le contrat, icônes `tv` / `tablet`, marqueurs 3D par classe. Rien dans `house.json`.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : `MEDIA_PLAYER_CLASSES`, `meta.mediaPlayer`.
- `3_plugins/3_6_google-cast.md` — section datée : règle `mediaPlayerClass`, répartition sur le parc.
- `4_ui/4_0_langage-visuel.md` — section datée : glyphes `tv` et `tablet`, formes 3D par classe.

**Index** : mis à jour (3 lignes).

## [2026-09-09] update | Plugin Google Cast et vue Médias

**Déclencheur** : l'utilisateur — « peut-on intégrer les enceintes et réveils Google, les Chromecast,
les TV Android… envoyer une musique ou une vidéo (compte Google avec YouTube / YouTube Music) ? »,
puis « démarre l'étape 1, fais le relevé des appareils Cast ». Relevé mDNS + Cast des appareils
réels, plugin `google_cast` (protocole Cast v2 encodé à la main, découverte `bonjour-service`, une
connexion TLS par appareil, état poussé, commandes acquittées par `requestId`), vue Médias, clés
i18n `media.*` qui manquaient, variables `CAST_*`. Limite posée : le protocole n'a pas de compte,
YouTube Music sur enceinte n'a pas de voie officielle.

**Pages modifiées** :
- `3_plugins/3_3_fabricants-a-venir.md` — section datée : `google_home` sort du tableau, devenu `google_cast`.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : vue Médias (8e entrée du rail), clés `media.*`.
- `5_setup/5_1_configuration-env.md` — section datée : variables `CAST_*`, `MOCK_EXCLUDE_KINDS=…,media_player`.
- `6_faq/6_1_pieges-runtime.md` — entrée : état émis pendant `discover` perdu (appareils « off », volume 0).

**Pages créées** :
- `3_plugins/3_6_google-cast.md` — nouveau plugin : besoin et limites, relevé réel, architecture, côté web, mise en route.

**Index** : mis à jour (5 lignes, dont 1 ajoutée).

## [2026-09-09] update | Cartes de même hauteur : titre en ellipsis, badge d'origine en icône, protocole sur la ligne d'état

**Déclencheur** : l'utilisateur — les cartes des vues Caméras/Lumières/Ouvrants se décalaient quand un
nom passait sur deux lignes ; rendre les hauteurs égales, badge « Dans/Hors plan » plus compact et
mieux nommé, « RTSP » au bout de la ligne « En ligne ». Retouches dans `RoomBands` (partagé) : titre
`ellipsis`, badge d'origine en icône `pin` (libellé en infobulle), slot `status-after` pour le
protocole. Icône `pin` ajoutée à `strokeIcons`. Libellés `rooms.origins` : « Placé / Non placé ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` — section datée ; contradiction assumée avec le 2026-09-08
  (retour à « Placé / Non placé », mais en infobulle d'une icône).

**Index** : mis à jour (1 ligne).

## [2026-09-09] update | Récepteur d'événements Pub/Sub (sonnette) et canal `deviceEvent`

**Déclencheur** : l'utilisateur — « pour Pub/Sub et la sonnette, que faut-il faire ? », puis « commence
le récepteur serveur, la sonnette passe devant, on affichera la vue 3D avec auto-select de la sonnette ».
Nouveau canal d'événement transitoire de bout en bout, et récepteur Pub/Sub côté Nest (sonnette d'abord).

**Pages modifiées** :
- `1_architecture/1_3_protocole-rest-ws.md` — message `deviceEvent`, `PluginContext.emitEvent`, `Bus` au `PluginHost`.
- `3_plugins/3_5_google-nest.md` — phase 3 : récepteur (`pullEvents`/`acknowledge`, `parseSdmEvent`,
  `createPoller` `nest-events`), prérequis Google et coût, réaction 3D à venir.
- `5_setup/5_1_configuration-env.md` — `NEST_PUBSUB_SUBSCRIPTION`, `NEST_PUBSUB_POLL_MS`.
- `1_architecture/1_3_…`, `3_plugins/3_5_…` — réaction 3D web : store `onDeviceEvent`, `HomeView` réagit
  au `chime` (retour maison, cadrage de l'entrée, direct dans la carte). `returnImmediately` sur le tirage.
- `6_faq/6_1_pieges-runtime.md` — course routeur/URL : naviguer puis sélectionner, sérialiser.

**Index** : mis à jour (3 lignes).

## [2026-09-09] update | Observation : activer/désactiver et multi-live via l'API privée Google Home

**Déclencheur** : l'utilisateur — l'appli web Google Home active/désactive les caméras et montre tous
les flux en direct ; « pourquoi eux et pas nous ? », et « on pourra le faire pour l'activation, c'est
utile ». Vérification : ce n'est pas SDM (console Device Access = aucun trait marche/arrêt) mais une
API privée première partie (`home.google.com`, `UpdateTraits`/`SendCameraViewIntent`, WebSocket
`nexustalk`), auth de session Google, hors conditions d'utilisation pour un tiers.

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` — section « Observation 2026-09-09 » : preuves, pourquoi SDM ne peut
  pas, piste d'un connecteur non officiel (`nest-unofficial`) pour plus tard ; renvoi depuis « Ce que
  l'API ne permet pas ».

**Index** : mis à jour (1 ligne).

## [2026-09-09] update | Vue Caméras : vignettes de toutes les caméras, budget de sessions, quota Google

**Déclencheur** : l'utilisateur — voir les flux sur la vue Caméras comme sur la carte détail, tous
à la fois si possible, « une image toutes les 10 s pour toutes les caméras », avec arrêt et son sur chaque
carte. Pas d'instantané à la demande dans l'API : les vignettes sortent du flux RTSP, et « 10 s
pour toutes les caméras » revient à tenir toutes les sessions ouvertes tant que la vue est affichée
(`NEST_LIVE_BUDGET`, rotation en dessous). Le parc réel a corrigé le premier jet trois fois : `-y`
manquant (deuxième session tuée par un fichier déjà là), caméras éteintes dont Google donne l'URL
mais dont le serveur répond 404 (recul par caméra, état « inactive »), sessions zombies jamais
rendues (`onEnded`), et un quota Google épuisé jusqu'à `ListDevices` (deux ouvertures par tick,
pause de 90 s, découverte non fatale). Jetons de flux effacés des journaux.

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` — section datée : contrainte de l'API, réglages, mécanique, quatre enseignements du parc réel, tests.
- `4_ui/4_1_navigation-et-panneaux.md` — tuile vignette / direct sur la vue Caméras ; **repris** en barre
  segmentée à trois états (Arrêté / Aperçu / Direct) + badge, et **trois directs au plus** (`LIVE_MAX`).
- `3_plugins/3_5_google-nest.md` — trois états de la tuile ; le direct n'est pas plafonné par le budget,
  d'où la limite côté vue.
- `3_plugins/3_5_google-nest.md`, `4_ui/4_1_navigation-et-panneaux.md` — compteur « X actives sur N »
  (les caméras n'exposent pas `Connectivity`, seul l'essai du flux les distingue ; « en ligne » abandonné,
  rien dans le header).
- `1_architecture/1_2_serveur-et-plugins.md` — option `snapshot` et `onEnded` du relais.
- `5_setup/5_1_configuration-env.md` — `NEST_LIVE_BUDGET`, `NEST_SNAPSHOT_MS`.
- `3_plugins/3_5_google-nest.md` — **contradiction détectée** : la prolongation Google ne maintient pas la
  connexion RTSP (coupée à l'échéance initiale) ; relève de source sans coupure (`rotateSource`,
  `timestampOffset` côté lecteur). Priorité de rotation aux caméras qui ont déjà donné une image.
- `3_plugins/3_5_google-nest.md`, `6_faq/6_1_pieges-runtime.md` — redémarrage du serveur : vignettes
  figées plusieurs minutes (fichiers qui survivent, échecs oubliés, deux serveurs sur le même compte,
  ffmpeg orphelins) ; rangs dans la rotation.

**Index** : mis à jour (5 lignes).

## [2026-09-09] update | Vidéo des caméras Nest : relais RTSP → MP4 fragmenté, lecture MSE

**Déclencheur** : l'utilisateur — Pub/Sub repoussé (coûts à vérifier), « on peut peut-être essayer
d'afficher les vidéos », la sonnette étant la caméra active. Tout le parc est en RTSP, illisible
par un navigateur : session RTSP ouverte chez Google à la demande (prolongée, puis arrêtée dès que
plus personne ne regarde), un ffmpeg par caméra regardée qui recopie sans ré-encoder en MP4
fragmenté, route WebSocket du plugin, lecture MSE dans la carte détail. Vérifié sur la sonnette :
image et son, 1152 × 864, lecture continue. Piège relevé sur la vraie caméra : se recaler trop près
du direct gèle l'image entre deux fragments (un fragment = un groupe d'images de 4 s) — la lecture
se tient désormais à un fragment du bord. Réponses de l'utilisateur en cours de route : ffmpeg
tourne sur le serveur, jamais sur la tablette ; le serveur vit sur une machine de la maison.

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` — section datée : session Google, relais, route, côté web, compromis de latence, tests ; phase 2 « carte faite ».
- `1_architecture/1_2_serveur-et-plugins.md` — `core/video/` (premier processus externe du cœur).
- `1_architecture/1_4_app-web.md` — `Transport.cameraStreamUrl`, `CameraVideo.vue`.
- `4_ui/4_1_navigation-et-panneaux.md` — la vidéo dans la carte caméra.
- `5_setup/5_1_configuration-env.md` — `FFMPEG_PATH` ; `5_setup/5_0_installation-et-scripts.md` — ffmpeg, `ws: true` sur `/api`.
- `6_faq/6_1_pieges-runtime.md` — le flux qui continue après avoir quitté la vue Maison (`keep-alive`, `onDeactivated`, ping serveur).

**Index** : mis à jour (6 lignes).

## [2026-09-09] update | Thermostat Nest en `climate`, `meta.climate.modes`, sondage lent

**Déclencheur** : l'utilisateur — « dans les appareils Nest il y a aussi un thermostat et des
détecteurs de fumée, on peut intégrer tout ça ? ». Thermostat : oui, il était déjà dans la capture,
mappé vers `climate` (éco = mode à part chez Google, deux commandes pour en sortir, consigne
refusée en éco ou à l'arrêt, relecture de l'appareil après l'accusé), avec un sondage de la liste à
`NEST_POLL_MS`. Nest Protect : non, absent de l'API Device Access, écarté. Trouvaille au passage :
la section `climate` des locales n'existait pas, le contrôle affichait ses clés.

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` — section datée : tableau de mappage, commandes et refus, sondage, côté web.
- `1_architecture/1_1_contrat-appareils.md` — section datée : `meta.climate.modes`.
- `5_setup/5_1_configuration-env.md` — ligne `NEST_POLL_MS`.

**Index** : mis à jour (3 lignes).

## [2026-09-09] update | Vue Caméras, noms de caméras en préfixe, 414 sur les ids longs

**Déclencheur** : suite de la session Nest, trois demandes de l'utilisateur. (1) « je ne parviens pas
à déplacer les caméras qui sont dans des pièces » : HTTP 414, la limite de 100 caractères par
paramètre d'URL de Fastify, dépassée par l'id maison `auto.nest-<96 caractères>` — portée à 512,
premier test d'application (`app.test.ts`). (2) « Caméra … » plutôt que « … Camera » : le type en
préfixe du nom de repli, en français, la traduction selon la langue d'affichage étant écartée avec
lui. (3) « la page des caméras à l'image des autres » : `views/CamerasView.vue` sur `RoomBands`,
7e entrée du rail.

**Pages modifiées** :
- `6_faq/6_1_pieges-runtime.md` — entrée « Position non enregistrée : HTTP 414 » (cause, correction, leçon).
- `3_plugins/3_5_google-nest.md` — nom de repli en préfixe et pourquoi pas de traduction ; phase 4 faite.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : vue Caméras (résumé « en ligne », pas de
  contrôle, puce du flux), 7 vues dans le rail.

**Index** : mis à jour (1 ligne).

## [2026-09-09] update | Plugin Google Nest (phase 1) et kind `camera`

**Déclencheur** : l'utilisateur — « sur le réseau j'ai des équipements Nest (sonnette à caméra,
autres caméras), possible de les inclure ? » avec quatre attentes (marche/arrêt, vidéo dans la 3D
et la carte, vue Caméras, cadrage de l'entrée quand on sonne) à faire « en plusieurs phases, en
commençant par la récupération des éléments et leur positionnement ». Phase 1 livrée : plugin `nest`
(API cloud Smart Device Management, OAuth via le Partner Connections Manager, liaison en
`needs_pairing` comme Hue/TaHoma), nouveau kind `camera` (capacités `live_stream` / `chime`,
`meta.camera`, état sans champ propre, **pas de `on_off`** car l'API ne sait pas éteindre une
caméra), carte détail et carte de liaison côté web. Vérifié en preview avec de fausses clés ; la
liaison réelle faite dans la même session : les caméras remontent, fixtures **remplacées par la
capture** anonymisée (`/devices/raw`), qui a révélé un parc entièrement RTSP (phase 2 = transcodage
serveur) et des noms personnalisés vides sur la plupart des appareils. Piège corrigé au passage : une clé
`NEST_*` vide dans `.env` désactivait le plugin.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : kind `camera`, ses deux capacités,
  `meta.camera.deviceClass` / `protocols`, état réduit à la base, absence de commandes et pourquoi,
  rayon d'impact (switch exhaustifs désignés par le typage, GitNexus `UNKNOWN` sur les constantes).
- `3_plugins/3_3_fabricants-a-venir.md` — `nest` sort du tableau ; les kinds annoncés (`climate`,
  `sensor`) n'étaient pas ceux retenus ; leçon « route de relevé brut quand on ne peut pas capturer avant ».
- `4_ui/4_1_navigation-et-panneaux.md` — carte `NestLinkCard` (liaison dans un onglet Google, bouton
  Actualiser), carte `CameraCard`, icônes `camera` / `doorbell`, marqueur 3D générique.
- `5_setup/5_1_configuration-env.md` — tableau `NEST_*`, redirection à déclarer à l'identique chez Google.

**Pages créées** :
- `3_plugins/3_5_google-nest.md` — la demande et ses phases, ce que l'API refuse, prérequis Google,
  liaison du compte, mappage, routes, fixtures relevées, tests, état réel (parc de caméras, RTSP partout,
  placement par pièce, caméras extérieures non placées), piège de la clé vide.

**Index** : mis à jour (5 lignes, dont 1 nouvelle).

## [2026-09-09] update | Preview Claude Code : sa propre pile, ses propres ports

**Déclencheur** : l'utilisateur — « j'ai l'impression que ça tourne sur les mêmes ports qu'un
`npm run dev` », avec un dépôt modèle interne ajouté à la session comme modèle. C'était exact :
la configuration `kasbah` de `.claude/launch.json` lançait `npm run dev`, donc web 5173 + serveur
8787 — les ports de l'IDE. Décalage de +1000 sur les deux processus (`PORT=6173`,
`KASBAH_PORT=9787`, `KASBAH_SERVER=http://localhost:9787`), après avoir vérifié que ni `dotenv` ni
`node --env-file` n'écrasent `process.env`. Choix assumé de l'utilisateur : « ports seulement »,
donc maison, réglages de plugins et matériel réel restent partagés entre les deux serveurs.

Second temps de la session : sur signalement du glissement possible hors du port attendu par le
volet, `strictPort` est forcé quand `KASBAH_SERVER` est fourni (`FIXED_PORT` dans
`apps/web/vite.config.ts`). Cela **restreint la règle du 2026-09-08** — le glissement ne subsiste
que sur un `PORT` imposé seul (cas `kasbah-web` / `autoPort`).

**Pages modifiées** :
- `5_setup/5_0_installation-et-scripts.md` — section datée : le tableau des trois variables et qui
  les lit, la précédence sur `apps/server/.env`, la différence avec le dépôt modèle (un seul processus à
  décaler là-bas), ce qui n'est PAS dédoublé (écritures `.tmp` + `rename` en course sur
  `house/demo-house.json` et `.state/plugin-settings.json`, même matériel piloté deux fois), et le
  tableau des trois régimes de `strictPort` (rien / `PORT` seul / `PORT` + `KASBAH_SERVER`), les
  trois exercés pour de vrai : 5173 strict, glissement 6173 → 6174, et `Port 6173 is already in
  use` en sortie 1.

**Index** : mis à jour (1 ligne).

## [2026-09-09] update | Reprogrammer la position favorite du moteur

**Déclencheur** : l'utilisateur — « ok pour la reprogrammation de la pos perso », suite à la piste
laissée ouverte la veille. La box a été interrogée d'abord : `setMemorized1Position` est déclarée par
les volets io, avec `{"nparams":1,"paramsSig":"p1"}`, donc un paramètre en FERMETURE comme
`setClosure`.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : la capacité `preset_set`, le tableau
  des trois niveaux indépendants (rappels / lectures / réécritures), pourquoi
  `cover.set_preset` porte la position à graver, et deux conséquences — une ambiance peut
  techniquement reprogrammer une mémoire, et ce réglage vit dans le moteur, pas dans l'app.
- `3_plugins/3_4_somfy-tahoma.md` — section datée : la signature relevée,
  `refreshMemorized1Position` laissé de côté, et l'aveu que **le chemin d'écriture n'a pas été
  exercé contre le matériel** (avec la recette sans effet de bord pour le faire).
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : le geste « amener puis mémoriser », les
  trois choix délibérés (panneau seul, libellé en clair, verrouillage en course) et le toast.
- `4_ui/4_2_theme-et-langues.md` — les deux clés et le formatage du `{pct}` côté appelant.

**Index** : mis à jour (4 lignes).

**Complément le même jour (retour d'usage)** : les deux touches de position perso passent sur UNE
ligne (rappel étiré + mémorisation en 40 px, teinte d'avertissement), la coche devient une
**étoile** (la coche se lisait « validé » ; une pipette, juste sémantiquement, est illisible à
16 px — l'étoile a donc été ajoutée au jeu d'icônes), et le
repère du curseur devient plus haut que le pouce (28 contre 22 px), centré, en avertissement, placé
derrière lui. Piège Vuetify découvert à cette occasion : les repères EXTRÊMES ne reçoivent pas de
style inline, ils sont placés par des marges — qu'un `margin: 0` de recentrage annule, envoyant un
repère à 100 % à gauche de la piste. Le style du repère est passé en commun dans
`styles/app.css` (`.cover-slider`), les deux écrans l'affichant. Pages touchées :
`4_ui/4_1_navigation-et-panneaux.md` (section « bis » qui remplace explicitement la disposition
précédente).

## [2026-09-08] update | Position favorite du moteur (« my ») : rappelable, et montrée quand elle est lisible

**Déclencheur** : l'utilisateur — « certains volets possèdent une position perso programmable ("my"
chez somfy) il faudrait pouvoir visualiser et activer cette position perso sur les éléments
concernés ». Interrogation directe de la box avant toute conception : presque tous les ouvrants déclarent
`my`, mais seuls certains publient `core:Memorized1PositionState` — d'où deux notions séparées.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : capacité `preset` et commande
  `cover.preset`, état `presetPosition` optionnel, pourquoi la capacité et la valeur ne se
  confondent pas, et le `null` de `StatePatch` qui efface un champ (avec son besoin réel).
- `3_plugins/3_4_somfy-tahoma.md` — nouvelle section « Position favorite » : le relevé par famille,
  la valeur lue comme une FERMETURE et les deux indices qui l'appuient, l'effacement de la position
  après un rappel sur un appareil sans retour, et `setMemorized1Position` laissé de côté ;
  complément aux listes de commandes et de capacités.
- `3_plugins/3_0_simulation-mock.md` — l'option `preset` de `cover()`.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : la touche pleine largeur du panneau et la
  4ᵉ touche-icône des listes, le repère posé par `:ticks` de Vuetify (0,01 px d'écart mesuré),
  l'infobulle écartée parce que l'app est tactile, et les deux pièges Vuetify (repère étiqueté,
  accent invisible sur l'accent).
- `4_ui/4_2_theme-et-langues.md` — `cover.preset` / `cover.presetAt` posées hors des deux
  vocabulaires, et la règle qui va avec.

**Index** : mis à jour (4 lignes).

## [2026-09-08] update | Volets et stores : deux vocabulaires, deux compteurs, et la position qu'on ne connaît pas

**Déclencheur** : l'utilisateur — « on pourrait ajouter "n volets ouverts" - "n stores baissés" /
concernant les stores il faudrait indiquer "remonté/baissé" au lieu de "fermé/ouvert" ». Puis, en
regardant le résultat sur sa maison : « les stores sont actuellement remontés (switch sur off), je
pense qu'il y a inversion de terme car ils sont notés baissés ». Le vocabulaire était juste ; c'est
la position qui était inventée.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : `meta.cover.deviceClass`
  (`COVER_CLASSES`) et `position` devenue optionnelle, ce que « absente » veut dire, et la règle
  appliquée aux quatorze points de lecture.
- `3_plugins/3_4_somfy-tahoma.md` — nouvelle section sur la position inconnue d'un RTS avant la
  première commande ; correction de la cellule « Position » du tableau io / RTS, qui annonçait une
  déduction là où il n'y a d'abord rien.
- `4_ui/4_1_navigation-et-panneaux.md` — section datée : `coverWords()` et les six points
  d'affichage, les compteurs volets / stores séparés et pourquoi ils ne peuvent pas fusionner, et
  l'affichage d'une position inconnue (jusqu'au tiret cadratin de `CoverControl`).
- `4_ui/4_2_theme-et-langues.md` — section datée : `cover.*` scindé en `openClose` / `upDown`, le
  choix par préfixe, les clés orphelines retirées et les dégâts d'un remplacement à l'aveugle
  rattrapés par la parité fr/en.
- `6_faq/6_1_pieges-runtime.md` — nouvelle entrée « Deux stores annoncés baissés alors qu'ils sont
  remontés » : une valeur par défaut se lit comme un fait, et deux indicateurs contradictoires sur
  une même ligne trahissent une donnée absente déguisée en donnée.

**Index** : mis à jour (5 lignes).

## [2026-09-08] update | `MOCK_EXCLUDE_KINDS` : la simulation complète le parc réel

**Déclencheur** : l'utilisateur, en regardant la nouvelle vue Ouvrants sur sa maison réelle — « ces
volets hors plan hors maison n'existent pas réellement je pense ». C'étaient les trois volets du
plugin `mock`, restés visibles dans les listes maintenant qu'une vue montre le kind `cover`. Sa
décision : « retirer ce qu'on a déjà traité comme les lumières et ouvrants ».

**Pages modifiées** :
- `3_plugins/3_0_simulation-mock.md` — section datée : le symptôme (appareils simulés « hors plan »
  qui rendent le diagnostic illisible), le réglage, le filtrage à la SORTIE et pourquoi, la
  validation contre `DEVICE_KINDS`, et l'usage attendu (la liste grandit avec les vrais plugins).
- `5_setup/5_1_configuration-env.md` — la variable.

**Index** : mis à jour (1 ligne).

## [2026-09-08] update | Contrôles d'ouvrant : fermeture affichée, position visée, rien qui bouge

**Déclencheur** : retours successifs de l'utilisateur sur la vue Ouvrants et le panneau appareil, une
fois le plugin `tahoma` branché sur son vrai parc — « ouvert = 0 %, fermé = 100 %, c'est plus
intuitif », « on laisse le curseur sur la cible », « si on détecte que ça s'est mal passé on
repositionne », « le pulse ne doit pas décaler le curseur », « le spinner ne reste pas actif le temps
du mouvement », « impossible de recliquer pour inverser le mouvement ». Plus le principe général
qu'il en a tiré : **un élément qui remplace un autre doit occuper le même espace**.

Deux des trois défauts de mise en page et deux des trois pièges de logique ont été trouvés en
**mesurant** dans le navigateur (`getBoundingClientRect`, états injectés côté client), pas en
relisant le code : les tests unitaires passaient à chaque fois.

**Pages modifiées** :
- `1_architecture/1_4_app-web.md` — deux sections datées : la **position visée** tenue par le store
  (pourquoi, forme, règles d'abandon, et les trois contraintes non évidentes : `moved` vient du
  serveur donc la cible se pose après le patch optimiste, péremption sur `Date.now()`, `cover.stop`
  qui gèle au lieu d'effacer) ; puis les **quatre lectures d'un état** de `deviceState.ts` et
  lesquelles reçoivent la cible.
- `4_ui/4_1_navigation-et-panneaux.md` — les contrôles d'ouvrant : fermeture affichée, « les
  contrôles montrent l'intention, le texte montre l'état », la ligne unique `[point | texte | %]`,
  l'empreinte fixe du spinner, l'inversion d'un mouvement depuis les lignes de pièce, et les deux
  limites laissées ouvertes.
- `4_ui/4_0_langage-visuel.md` — la règle « rien ne doit bouger », ses trois occurrences, la primitive
  `PulseDot` (espace réservé, unique `@keyframes`), `tabular-nums`, et la méthode de vérification.
- `5_setup/5_0_installation-et-scripts.md` — `PORT` et `strictPort` dans `vite.config.ts`,
  `KASBAH_SERVER`, la configuration de lancement `kasbah-web` (front seul, `autoPort`), et la
  précaution quand ce front parle au serveur qui détient la vraie maison.
- `6_faq/6_1_pieges-runtime.md` — trois entrées : deux bases de temps mélangées dans une
  soustraction ; un état optimiste pris pour une confirmation du serveur ; un indicateur d'activité
  branché sur « requête en vol » au lieu de « appareil occupé ».

**Index** : mis à jour (5 lignes — dates et résumés, aucune page créée).

**Non documenté volontairement** : le placement des ouvrants dans `house/maison.json` (fenêtres
provisoires). Fichier **non versionné** dont les
noms de pièces sont privés — le wiki n'utilise que `demo-house.json`.

## [2026-09-08] update | Plugin Somfy TaHoma, capacité `open_close`, vue « Ouvrants »

**Déclencheur** : demande de l'utilisateur — « est-ce qu'on peut essayer d'écrire un nouveau plugin,
celui pour les volets/stores/portails somfy ; j'ai une box tahoma switch, j'ai des éléments qui
supportent le protocole i/o et d'autres non ». Puis, dans la même session, une page dédiée à ces
appareils, « comme la page des lumières », avec la consigne explicite de **ne pas dupliquer le code**
de la vue existante.

Trois décisions prises avec l'utilisateur avant d'écrire : API **locale** plutôt que cloud Overkiz,
modèle **honnête sans position** pour la radio RTS plutôt qu'une course simulée, jeton **collé dans
`.env`** plutôt qu'une route d'appairage manipulant le mot de passe du compte Somfy. Nom de la vue :
« Ouvrants », contre « Fermetures » et « Volets ».

Le plugin a été vérifié contre le **vrai matériel** (ouvrants découverts, mouvement réel d'un
volet avec arrêt en pleine course), ce qui a mis au jour deux bugs invisibles aux 19 tests unitaires
et deux défauts de conception. D'où les entrées FAQ.

**Pages créées** :
- `3_plugins/3_4_somfy-tahoma.md` — le plugin : mise en route (mode développeur activable **seulement**
  depuis l'appli mobile, jamais depuis le réseau), API locale et TLS, io vs RTS distingués par les
  états live, inversion fermeture ↔ ouverture, événements en deltas, robustesse, six pièges relevés,
  et ce qui reste non couvert (inclinaison des lames, portails `cycle`, position pendant la course).

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — section datée : capacité **`open_close`** distincte de
  `position` pour le kind `cover`, parce que `cover.open`/`cover.close` exigeaient `position` et
  rendaient un ouvrant RTS impilotable ; rayon d'impact vérifié.
- `3_plugins/3_3_fabricants-a-venir.md` — `tahoma` retiré du tableau des squelettes ; ce que la piste
  d'API avait juste et faux, et la leçon transposable : **écrire les fixtures d'après une réponse
  capturée, pas d'après la spec**.
- `4_ui/4_1_navigation-et-panneaux.md` — vue « Ouvrants » (6e entrée du rail), le choix du nom, le
  composant partagé `RoomBands.vue` et son slot `control` (LightsView passe de 241 à 56 lignes), les
  contrôles conditionnés aux capacités, les libellés de pastille neutres en genre, et le débordement
  mobile **préexistant**.
- `4_ui/4_2_theme-et-langues.md` — section `rooms.*` pour les libellés partagés, les deux règles
  d'i18n mises en évidence (nommer d'après le concept et non la vue ; le genre grammatical), et le
  style compact écrit à la main des fichiers de locale.
- `5_setup/5_1_configuration-env.md` — les cinq variables `TAHOMA_*`, et le rappel que le PIN de la
  passerelle comme le jeton n'ont rien à faire dans un commit.
- `6_faq/6_1_pieges-runtime.md` — deux entrées : un flux d'événements **en deltas** rend un champ
  calculé éternellement figé si le mappage travaille sur la trame seule ; une requête **sans délai
  propre** peut geler une boucle de sondage pour de bon, en silence et sans dégrader `health()`.

**Index** : mis à jour (7 lignes — 1 ajoutée, 6 dates et résumés).

**Non documenté volontairement** : le placement temporaire des ouvrants dans `house/maison.json`
(rattachement par appariement de libellés, fenêtres provisoires). C'est un état de travail à affiner, sur un fichier **non versionné** dont les
noms de pièces sont privés — le wiki n'utilise que `demo-house.json` pour ses exemples.

## [2026-09-08] update | Vue Lumières en bandes par niveau + ordre des pièces dans house.json

**Déclencheur** : demande de l'utilisateur — « sur la page des lights je ne sais pas quel est l'ordre
de tri ; on pourrait ordonner par niveau, passer à la ligne entre les niveaux, mettre les lampes non
placées à la fin, trier par ordre alpha, et mieux : laisser le user réordonner et stocker cet ordre
dans le json ». Précision obtenue avant de coder : le réordonnancement porte sur les pièces **à
l'intérieur** d'un niveau (glisser-déposer), l'ordre des niveaux est le haut d'abord, et il vaut
partout dans l'app.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — section datée : nouveau champ `level.roomOrder` (préférence
  d'affichage, sans effet géométrique), `levelsSorted` en élévation décroissante, `roomsByLevel` trié
  `roomOrder` puis par nom, `setRoomOrderInJson` et ses refus ; `house.json` a désormais deux
  écritures depuis l'UI.
- `1_architecture/1_3_protocole-rest-ws.md` — `PUT /api/house/levels/:id/room-order` (corps, réponse,
  diffusion `house`, codes de refus, ordre partiel légitime).
- `1_architecture/1_4_app-web.md` — `Transport.setRoomOrder` (HTTP + mock) et l'action optimiste du
  store `house`.
- `4_ui/4_1_navigation-et-panneaux.md` — la vue Lumières en bandes (une grille par niveau, bande
  « Hors maison », « Liaisons mortes » en dernier) et le glisser-déposer à la poignée, avec le
  pourquoi de la poignée.
- `6_faq/6_1_pieges-runtime.md` — nouvelle entrée : `setPointerCapture` incompatible avec une liste
  qui se réorganise sous le doigt (le `pointerup` n'arrive jamais), écouteurs sur `window`.

**Ajustement en fin de session** : les onglets de niveau de l'en-tête ont été **remis** dans l'ordre
montant (`Jardin`, `RDC`, `1er`, `Tout`) à la demande de l'utilisateur, après avoir vu le résultat —
seules les listes descendent. `HomeView.vue` retourne `house.levels` ; les deux pages concernées
(`2_maison/2_0`, `4_ui/4_1`) portent l'exception.

**Index** : mis à jour (5 lignes).

## [2026-09-08] update | Icônes unifiées (jeu trait = jeu Vuetify) et couleurs Vuetify par props

**Déclencheur** : question de l'utilisateur — « on a intégré Vuetify mais il y a pas mal d'UI custom,
pourquoi ne pas utiliser les composants Vuetify avec surcharge ? ». Constat : le partage custom/Vuetify
est défendable (Vuetify pour la mécanique, langage visuel maison pour le reste), mais deux points
étaient de la dette réelle — deux jeux d'icônes (trait dans la coquille, `@mdi/js` dans les contrôles)
et des surcharges CSS `!important` visant les classes internes de Vuetify. Les deux ont été traités.

**Pages modifiées** :
- `4_ui/4_0_langage-visuel.md` — section datée : `plugins/icons.ts` (jeu « trait » enregistré en
  `defaultSet: 'stroke'`, alias `$dropdown`/`$clear`/`$eyeDropper`), ~40 glyphes ajoutés à
  `lib/strokeIcons.ts`, `lib/deviceIcons.ts` renvoie des `IconName`, `@mdi/js` retiré ; couleurs des
  curseurs et interrupteurs passées en `defaults` (`trackFillColor`/`thumbColor`/`trackColor`,
  `color`/`baseColor` acceptant `var(--line)`). Signale explicitement que la phrase « les icônes
  `@mdi/js` restent utilisées dans les contrôles Vuetify » n'est plus vraie.
- `6_faq/6_0_pieges-outillage.md` — trois entrées : Vuetify 4 publie son CSS en `@layer` (une règle
  non calquée gagne, `!important` inutile) ; `v-slider` passe sa piste de fond à 38 % d'opacité dès
  qu'on pose `color` ; comment brancher un jeu d'icônes maison (composant qui rend `props.tag`,
  `aliases` partiels, nom inconnu = rien de rendu).

**Index** : mis à jour (2 lignes).

## [2026-09-08] update | Scènes des fabricants (scènes Hue fixes et animées) + capacité `effect`

**Déclencheur** : l'utilisateur utilise des scènes de l'app Hue et voulait les visualiser et les
piloter depuis Kasbah. Vérification faite sur le pont réel avant d'écrire une ligne de code :
scènes, palettes et `status.active` bien disponibles en CLIP v2. Choix retenu : un
**concept générique** dans le contrat (réutilisable pour les scénarios Somfy, les favoris Sonos)
plutôt qu'une route Hue-only ou de faux appareils `light`.

**Pages modifiées** :
- `0_overview/0_1_glossaire.md` — trois sens de « scène » (maison / 3D / **plugin**), rappel, effet.
- `1_architecture/1_1_contrat-appareils.md` — `packages/shared/src/scenes/scene.ts` (`PluginScene`, `group room|zone`, `dynamic`, `swatches` sRGB, état `inactive|static|dynamic`, `sceneRecallSchema`), capacité `effect` (`meta.effects`, `state.effect`, `light.set.effect`).
- `1_architecture/1_2_serveur-et-plugins.md` — `SceneRegistry` (activation conservée à la redécouverte, **une seule scène active par groupe**), bus `scenes`/`scene`, `ctx.emitScenes`/`emitSceneState`, `DevicePlugin.recallScene?` optionnel, pourquoi pas de `discoverScenes()`.
- `1_architecture/1_3_protocole-rest-ws.md` — `GET /api/scenes`, `POST /api/scenes/:id/recall` (404 / 400 `UNSUPPORTED_COMMAND` / 501), `snapshot.scenes` avec défaut, messages `scenes` et `scene` non coalescés.
- `1_architecture/1_4_app-web.md` — store `scenes` (une ligne de couplage dans `devices.start()`, `forRoom`/`forHouse` par `roomKey`, rappel optimiste et retour arrière par comparaison de référence), `Transport.getScenes`/`recallScene`.
- `3_plugins/3_1_philips-hue.md` — ressources `scene`/`zone`, `sceneSwatches` (palette → actions → blancs, doublons ôtés), corps de rappel, seau `scene` 1/s, activation par SSE, effets de lampe et précédence effet > couleur > température ; **constats sur le pont réel** (pas de couleurs intermédiaires en scène dynamique, `public_image` → 404, sync divertissement hors CLIP, 0 `smart_scene`).
- `4_ui/4_1_navigation-et-panneaux.md` — pastilles « Ambiances » (aperçu dégradé, clic = fixe, bouton ✨ = animé, scène en cours mise en avant), placement panneau pièce / panneau maison groupé par zone, sélecteur d'effet dans `LightControl`.

**Affiné le même jour, après essai réel** : l'utilisateur a signalé que les deux boutons ne se
comportaient pas en bascules. Diagnostic : `mode: 'static'` était mappé sur `recall.action: 'active'`,
qui **démarre l'animation** des scènes `auto_dynamic` — les deux modes faisaient donc la même chose
sur ces scènes. Corrigé en `action: 'static'`, et ajout de `mode: 'off'` (extinction par le
`grouped_light` du groupe) pour que la pastille s'éteigne au second appui. Pages 1_1, 1_3, 3_1 et 4_1
mises à jour en place : la sémantique décrite quelques heures plus tôt était devenue fausse, la
laisser aurait été pire que de la réécrire.

**Deuxième correction du même jour** : en changeant d'ambiance, la nouvelle pastille retombait
éteinte — `withActive` (store web) appliquait la règle « une seule active par groupe » aussi sur une
désactivation, et le message « l'ancienne est inactive » que le pont envoie dans le même lot
effaçait la nouvelle. Corrigé, régression testée, entrée dédiée dans `6_faq/6_1_pieges-runtime.md`.
Piège de survol CSS (le `:hover` l'emportait sur `[data-on='1']`) noté dans `4_ui/4_1`.

**Troisième correction du même jour** : `auto_dynamic` (le « démarrer l'animation automatiquement »
de l'app Hue) était ignoré par choix de conception — mauvais choix, l'utilisateur l'a signalé. Le
drapeau est remonté dans le contrat (`autoDynamic`), respecté par l'appui sur la pastille
(`scenes.tapMode`), avec une échappatoire dans Réglages (`kasbah.sceneAutoDynamic`, défaut vrai).
Pages 1_1, 3_1, 4_1 et 4_2 mises à jour.

**Quatrième correction du même jour, sur remarque de l'utilisateur** : plutôt qu'une préférence de
tablette, écrire `auto_dynamic` **sur le pont** — une seule source de vérité quelle que soit l'app
qui règle le paramètre. Ajout de `sceneUpdateSchema`, `DevicePlugin.updateScene?`,
`PATCH /api/scenes/:id`, du PUT Hue et de la propagation par le flux d'événements (vérifiée : le
pont rediffuse le changement, donc une modification faite dans l'app Hue arrive dans Kasbah).
`kasbah.sceneAutoDynamic` supprimé, l'écran Réglages liste les ambiances animées avec un
interrupteur par scène. Piège corrigé au passage : la file de débit d'une ressource supplantait
l'écriture en attente, donc un réglage annulait un rappel de la même scène — les intentions ont
maintenant des files séparées (`putLimited(..., intent)`).

**Cinquième tour, sur deux remarques de l'utilisateur** : (1) les réglages doivent vivre **par
plugin** — l'écran Réglages présente désormais une carte par plugin (le concept de scène est commun,
les réglages non) ; (2) un **défaut** pour les ambiances animées qui apparaissent. Le pont n'a aucun
emplacement pour un tel défaut (24 types de ressources inspectés : « dynamic » n'existe que sur les
scènes et comme durée de transition sur `light`/`grouped_light`), donc il est persisté côté serveur :
`pluginSettingsSchema`, `PluginSettingsStore` (première persistance hors `house.json`),
`SceneSeeder`, `GET /api/plugins/settings` + `PATCH /api/plugins/:id/settings`,
`KASBAH_SETTINGS_FILE`. Le déclencheur est l'**apparition** d'une ambiance animée, ce qui garantit
sans mémoire supplémentaire que l'existant n'est jamais modifié (vérifié sur le pont réel : drapeaux
identiques avant/après un redémarrage, défaut activé). Pages 1_1, 1_2, 1_3, 4_1, 4_2 et 5_1.

**Index** : 9 lignes mises à jour (dates + résumés de 1_1, 1_2, 1_3, 1_4, 3_1, 4_1, 6_1, 0_1).

**Non documenté volontairement** : le curseur de vitesse d'animation (`PUT scene { speed }`), les
`smart_scene` et la teinte animée des marqueurs 3D depuis la palette restent des suites possibles,
pas du code existant.

## [2026-09-08] update | Ajouter une ambiance à une pièce en recopiant une existante

**Déclencheur** : dans le panneau d'une pièce, l'utilisateur ne voyait que les ambiances que le pont
possède pour elle (2 sur l'une d'elles) et voulait pouvoir en choisir une nouvelle parmi celles que
propose le fabricant. Constat vérifié : **le pont n'expose aucune galerie de préréglages** (7 noms de
ressources candidats en 404, aucun des 24 types du pont), donc « toutes celles proposées par Hue »
est hors de portée de l'API locale. En revanche un pont installé porte déjà beaucoup d'ambiances
distinctes, réparties inégalement : c'est cette matière qu'on réutilise.

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` — `sceneCreateSchema`, pourquoi recopier plutôt que
  cataloguer, rapprochement du groupe par nom normalisé, idempotence par nom.
- `1_architecture/1_3_protocole-rest-ws.md` — `POST /api/scenes`, ses refus, et le retour par le
  message `scenes` (qui déclenche le seeder).
- `3_plugins/3_1_philips-hue.md` — corps de création (groupe, distribution des actions sur les lampes
  de la pièce, palette), piège `effects`/`effects_v2`, absence de galerie, absence de suppression.
- `4_ui/4_1_navigation-et-panneaux.md` — la pastille « + » et sa liste « reprise de <pièce> ».
- `6_faq/6_1_pieges-runtime.md` — entrée dédiée au 400 « mutually exclusive ».

**Vérifié sur le pont réel** : « Nuit » ajoutée à une pièce qui ne l'avait pas, palette de 5 couleurs
conservée, `auto_dynamic` posé par le seeder puisque l'ambiance venait d'apparaître (une scène de plus). Une scène de test créée pendant le diagnostic a été supprimée. 145 tests.

**Complété dans la même session, sur retour de l'utilisateur** : (1) le « + » était décentré — une
pastille purement iconique doit annuler `align-items: stretch` et le padding du `<button>` ; (2)
**suppression d'une ambiance depuis l'UI** (`DELETE /api/scenes/:id`, `deleteScene` côté plugin,
confirmation en deux appuis), ce qui transforme la liste des Réglages en écran de gestion listant
désormais TOUTES les ambiances et plus seulement les animées. L'affirmation « Kasbah ne supprime
aucune ambiance », écrite quelques heures plus tôt dans `3_1`, est corrigée en place. Vérifié sur le
pont : la « Nuit » créée pendant le test a été supprimée depuis l'UI (retour au nombre initial de scènes). 146 tests.

## [2026-09-07] update | Placement des appareils depuis l'UI (mode « Déplacer », écriture de house.json)

**Déclencheur** : branche `placement-ui` — l'utilisateur voulait placer les appareils (lampes
surtout, hauteur comprise : plafond, applique, table, sol) sans éditer le JSON à la main, et que le
résultat survive au redémarrage. Première écriture du serveur dans `house.json` : la décision « le
serveur n'écrit jamais le JSON » (2026-09-05) est amendée, pas supprimée.

**Pages modifiées** :
- `1_architecture/1_3_protocole-rest-ws.md` — `PUT /api/house/devices/:id` (corps, réponse, `INVALID_PLACEMENT` / `INVALID_HOUSE`), mécanique lire-modifier-écrire / validation / `.bak` / écriture atomique / file par fichier, message WS `house`.
- `2_maison/2_0_format-house-json.md` — pourquoi patcher le JSON brut (pas les défauts zod), `levelId` suit la pièce, création de l'entrée minimale d'un auto-placé (id stable), arrondi 5 cm, piège fixture démo.
- `1_architecture/1_4_app-web.md` — `Transport.placeDevice` (http + mock en mémoire), store `house` : `selectedDevice`, `placing`, `draft`, `previewPosition/Height`, `savePlacement`, `revertPlacement` ; `devices.serverHouse` suivi par `house` (dépendance à sens unique conservée).
- `1_architecture/1_5_scene-3d.md` — `setMovable` / `moveMarker` / `updateDevices` (caméra intacte, `sameShell`), détecteur de glissement (saisie par rayon, plan à la hauteur de l'appareil, pièce par `pointInPolygon`, faux tap ignoré), guide anneau + fil.
- `4_ui/4_1_navigation-et-panneaux.md` — carte « Emplacement » du panneau appareil : Déplacer / Terminé, préréglages, curseur de hauteur borné par la pièce, Rétablir, appareils exclus, choix d'un mode par appareil.

**Hors wiki** : `docs/house-json.md`, section « Appareils » — paragraphe « Depuis l'UI » (geste,
route, `.bak`, reformatage). Le wiki le cite.

**Index** : dates mises à jour (5 lignes), résumés complétés (5 lignes).

**Vérification** : `npm test` (122), `npm run typecheck`, `npm run lint` (seules les erreurs
préexistantes `.gitnexus/run.cjs` et `NavRail.vue`) ; parcours navigateur en mock in-process
(glisser, changer de pièce, préréglage Table, Rétablir, Terminé) — le serveur de dev de l'utilisateur
tournait sur 8787 avec la maison réelle, il n'a pas été sollicité.

## [2026-09-07] update | Relevé métré de la maison : `meta.survey`, `fit-survey.mjs`, géoréférencement

**Déclencheur** : session de relevé — l'utilisateur a dicté les cotes intérieures des pièces des
deux niveaux, puis le GPS et le cap du repère local. Un relevé intérieur réduit chaque cloison à
une ligne partagée, incompatible avec l'écart `t + t'` qu'exige le moteur de murs : il a fallu une
convention pour garder les mesures brutes et un outil pour en dériver les polygones. Trois bugs
trouvés au passage (deux dans l'outil, une limite dans `walls.ts`).

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — convention `meta.survey` (`unit`, `frame`, `partition`, `levelOffsets`, `points`, `note`), outil `house/fit-survey.mjs` et son `--check`, propriété des surcharges `interior`, effets de bord d'un relevé (ouvertures ancrées sur un index d'arête, positions d'appareils, emprise du niveau) ; `origin` à ramener au 0;0 quand le point GPS connu tombe ailleurs, `heading` mesuré sur les arêtes du bâtiment et ré-expression des données dérivées d'une vue nord-en-haut.
- `2_maison/2_1_geometrie.md` — quatre règles rendues explicites par le relevé : rentrement proportionnel à l'épaisseur du voisin, pièces sans mur (`terrace`, `balcony`) non mitoyennes et hors emprise, une arête = une nature (coupe par point colinéaire), un alignement droit reste droit ; limite du sondage de `classifySegments`.
- `6_faq/6_1_pieges-runtime.md` — nouvelle entrée « Mur mitoyen rendu en façade, ou mur extérieur qui semble absent » (deux causes opposées, parade par `kind` explicite).

**Hors wiki** : `docs/house-json.md` (référence de format lisible) reçoit une section « Relevé
métré » — champs de `meta.survey`, exemple, commandes `fit-survey.mjs`, cinq points de vigilance.
Le wiki la **cite** au lieu de la dupliquer (règle du `SCHEMA`) : le tableau des champs a donc été
retiré de `2_0`, qui ne garde que les décisions et les effets de bord.

**Index** : dates mises à jour (3 lignes), résumés de `2_0`, `2_1` et `6_1` complétés.

**Donnée personnelle** : conformément à la règle posée dans `2_0` le 2026-09-05, seule la
**mécanique** est documentée. Aucune cote, aucun nom de pièce, aucune coordonnée GPS ni contour de
parcelle n'apparaît dans le wiki : la maison réelle vit dans `house/maison.json`, gitignoré.

## [2026-09-05] update | Auto-placement des appareils de plugin et vue Lumières

**Déclencheur** : bridge Hue appairé → des lampes réelles remontées mais invisibles dans l’app, la
maison démo ne référençant que des appareils `mock:*`. Session : auto-placement par nom de pièce,
vue Lumières, icône Réglages, squelette `house/maison.json`.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` — `name` optionnel, auto-placement (`autoplace.ts`), sens unique plugin → placement, nouvelle maison `house/maison.json` (non versionnée, gitignorée).
- `1_architecture/1_4_app-web.md` — store `house` : `effective` (JSON + auto-placés) indexée à la place de `house`, dépendance vers le store `devices`, route `#/lights`.
- `4_ui/4_1_navigation-et-panneaux.md` — 5e entrée du rail, vue Lumières, pastilles Placée / Auto / Non placée, carte Liaisons mortes.
- `4_ui/4_0_langage-visuel.md` — icône `gear` redessinée (c’était un soleil).
- `3_plugins/3_1_philips-hue.md` — `meta.room` devient la clé du placement automatique.
- `5_setup/5_1_configuration-env.md` — `KASBAH_HOUSE_FILE` / `KASBAH_STATIC_DIR` : une valeur fournie est résolue depuis le cwd du serveur (`apps/server`), pas depuis la racine.

**Index** : dates mises à jour (6 lignes), résumé de `4_1` complété.

## [2026-09-04] ingest | Création du wiki

**Déclencheur** : demande de l'utilisateur après la refonte UI (maquette Claude Design) et le premier
commit `0615484` poussé sur `origin/main`.

**Pages créées** :
- `SCHEMA.md`, `index.md`, `log.md` — squelette.
- `0_overview/0_0_vision-et-principes.md`, `0_overview/0_1_glossaire.md`.
- `1_architecture/1_0_monorepo-et-flux.md` … `1_5_scene-3d.md` (6 pages).
- `2_maison/2_0_format-house-json.md`, `2_maison/2_1_geometrie.md`.
- `3_plugins/3_0_simulation-mock.md` … `3_3_fabricants-a-venir.md` (4 pages).
- `4_ui/4_0_langage-visuel.md` … `4_2_theme-et-langues.md` (3 pages).
- `5_setup/5_0_installation-et-scripts.md` … `5_2_production.md` (3 pages).
- `6_faq/6_0_pieges-outillage.md`, `6_faq/6_1_pieges-runtime.md`.

**Index** : créé (22 pages).
