# Journal du wiki

Entrées les plus récentes en haut. Une session = une entrée.

<!-- log-nav:begin (généré par scripts/wiki-log.mjs, ne pas éditer) -->
> **Mois en cours uniquement** (2026-11). Les mois précédents sont archivés dans [log/](log/README.md) par `scripts/wiki-log.mjs` : 401 entrées, de 2026-09 à 2026-10, une archive par mois.
> Pour remonter plus loin : chercher (`Grep`) un nom de page, un fichier ou un mot-clé dans `log/`, plutôt que lire les archives ; la date de mise à jour d'une page donne le mois à ouvrir. Mois précédent : [log/2026-10.md](log/2026-10.md).
<!-- log-nav:end -->

## [2026-11-05] update | Assistant : échecs dans le log du serveur, connexion `claude` expirée

**Déclencheur** : en production, « l'assistant a échoué : Failed to authenticate: OAuth session expired and could not be refreshed », et rien dans `logs/kasbah.log`.

**Pages modifiées** :
- `1_architecture/1_9_assistant.md` - mise à jour 2026-11-05 : la route `/ask` écrit un `warn` « assistant instruction failed » (compte, code, message) pour chaque échec sauf `ABORTED`.
- `3_plugins/3_24_claude.md` - mise à jour 2026-11-05 : diagnostic du message (repli sur la connexion `claude` de la machine, jeton de rafraîchissement expiré) et solution (`claude setup-token` dans Réglages).

**Index** : catalogues mis à jour (2 lignes), index.md régénéré.

## [2026-11-05] update | Pluie et neige placées par le GPU, plus rien dans les pièces

**Trigger** : question « on n'utilise pas de système de particules pour la pluie ? » ; la pluie existait (CPU, traits d'un pixel peu visibles), prototype GPU validé à l'œil par l'utilisateur ; puis « on peut traiter la pluie/neige dans les pièces ? ».

**Pages modified** :
- `1_architecture/1_11_scene-3d-rendu.md` - sous-section « pluie et neige placées par le GPU » : quad instancié placé par le shader, décalage et horloge qui bouclent, traînées de largeur minimale à l'écran, jumeau TSL, modulo de WGSL, ce qui reste (coût non mesuré, pluie dans les pièces).
- `1_architecture/1_11_scene-3d-rendu.md` - sous-section « plus de pluie ni de neige dans les pièces » : surfaces qui couvrent (pentes, toit plat, haut des niveaux, terrasses à découvert), carte de couverture, lecture dans le vertex shader, couvercle invisible quand le toit est masqué, limites.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-11-04] update | Lampes WebGPU : lampes masquées ou éteintes sautées

**Trigger** : suite de la décomposition de l'écart WebGL / WebGPU, demande « les lampes maintenant ? ».

**Pages modified** :
- `1_architecture/1_11_scene-3d-rendu.md` - sous-section « les lampes masquées ou éteintes sautées » : `If` dans `LevelPointLightNode.setup`, pourquoi c'est sûr (`castShadow` dans la clé de cache), gains, et deux trous du banc (`ALL_LAMPS` inerte, vue `night-lamps` toit posé).

**Index** : catalogue inchangé (même date), index.md régénéré.

## [2026-11-04] update | Écart WebGL / WebGPU décomposé, `Discard` du fondu retiré du sol en WebGPU

**Trigger** : question « des optimisations ou corrections à faire côté three ? » sur la lenteur de WebGPU ; décomposition mesurée, puis correctif du poste « Discard du fondu » choisi par l'utilisateur.

**Pages modified** :
- `1_architecture/1_11_scene-3d-rendu.md` - sous-section « l'écart décomposé, le `Discard` retiré du sol » : part de chaque poste (lampes, `Discard`, ombres, environnement ; anticrénelage et Dawn hors de cause), piège du `Discard` jamais pris (et de l'alpha-to-coverage), drapeau `noFade` sur le sol et ses gains, pièges du banc de parité.

**Index** : catalogue inchangé (même date), index.md régénéré.

## [2026-11-04] update | Banc de comparaison WebGL / WebGPU versionné, défauts du mode WebGPU corrigés

**Trigger** : remarque d'un agent annexe (le banc des deux moteurs n'était pas versionné) ; demande de le versionner dans un sous-dossier.

**Pages modified** :
- `1_architecture/1_11_scene-3d-rendu.md` - sous-section « banc versionné » : `scripts/bench-3d/` (`parity.mjs`, `perf.mjs`), ce que la comparaison vérifie, les défauts WebGPU qu'elle a trouvés (uniforms du groupe objet jamais renvoyés, flocon géant, tramage inversé) et leurs correctifs, pièges du banc.

**Index** : catalogue inchangé (même date), index.md régénéré.

## [2026-11-04] update | Deux moteurs de rendu : WebGL par défaut, WebGPU (TSL) en option

**Trigger** : question « migrer sur WebGPU / TSL, plus moderne ? » ; prototype mesuré (scène, puis chaîne d'effets), deux comparatifs publiés relus, mesure refaite hors mode éco ; choix de l'utilisateur : « les deux modes », WebGL par défaut.

**Pages modified** :
- `1_architecture/1_11_scene-3d-rendu.md` - nouvelle section « Deux moteurs de rendu » : mesures (WebGPU 1,3 à 1,9 fois le temps GPU, moitié du CPU), à-coup au premier usage, organisation (`three/gpu/` à la demande, contrat `renderBackend.ts`), correspondance GLSL ↔ TSL, pièges (cache de shaders et `userData`, points d'un pixel, `viewportSize`, `fragmentNode` et MRT), écarts connus, banc.
- `4_ui/4_2_theme-et-langues.md` - préférence `kasbah.sceneRenderer`.
- `6_faq/6_0_pieges-outillage.md` - Vite refuse les `node_modules` du dépôt principal dans un worktree ; une sonde `import('/src/…')` obtient une autre instance d'un module modifié.

**Index** : catalogues mis à jour (3 lignes), index.md régénéré.

## [2026-11-04] update | Site vitrine : playlists par langue et cartes de tutos

**Trigger** : deux playlists YouTube (EN, FR) avec la vidéo de promo et un premier tuto (installer l'app sur Android avec le raccourci « Demander ») ; demande de faire pointer le lien du pied de page sur la playlist et d'ajouter les cartes des tutos.

**Pages modified** :
- `5_setup/5_2_production.md` - site vitrine : lien « Vidéos » vers la playlist de la langue, section Tutos (cartes, miniatures locales, bouton lecture en coin) ; puis vidéos lues en 240p : formats réduits pour un envoi en 1080p, renvoyées en 1440p (échelle VP9 complète, 1080p d'emblée), nouveaux identifiants ; redirection vers `fr/` corrigée (un choix FR mémorisé la coupait).

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-11-04] update | Zone MELCloud retenue par un thermostat lié : ni « Chauffe », ni repos muet

**Trigger** : sur la vraie maison, la zone de la pompe à chaleur était dite « Chauffe » alors que le Nest en série, satisfait, retenait la machine ; demande de l'afficher correctement, en disant qui la retient.

**Pages modified** :
- `3_plugins/3_13_mitsubishi-melcloud.md` - mise à jour 2026-11-04 : une zone qui demande sans que la machine chauffe est au repos ; hypothèse sur `OperationMode`.
- `4_ui/4_6_autres-vues.md` - mise à jour 2026-11-04 : règle `heldBy`, « Retenu par » dans la vue Chauffage et sous la puce du panneau, ligne réservée sur un thermostat lié.

**Index** : catalogues mis à jour (2 lignes), index.md régénéré.

## [2026-11-04] update | Thermostats liés : chaque copie écartée dit pourquoi

**Trigger** : premier essai du lien sur la vraie maison, une consigne posée sur le Nest depuis Kasbah n'a pas atteint la pompe à chaleur, sans trace au journal ; second essai réussi, cause non trouvée.

**Pages modified** :
- `1_architecture/1_2_serveur-et-plugins.md` - mise à jour 2026-11-04 : ligne `linked thermostat skipped` avec ses raisons, côté source et destinataire, et la recherche en production.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-11-03] update | Consigne plus fine, zone MELCloud pilotable, thermostats liés

**Trigger** : demande de régler la consigne de chauffage plus finement que par demi-degré ; en chemin, la zone MELCloud sur l'ambiante devient pilotable et un lien entre thermostats voisins est ajouté (non commité à la rédaction).

**Pages modified** :
- `3_plugins/3_13_mitsubishi-melcloud.md` - mise à jour 2026-11-03 : écriture de la consigne (SetAtw, état complet, drapeaux, piège du HTTP 200), arrondi avant envoi mesuré sur la vraie maison, remontées irrégulières ; dépasse la lecture seule et « Écriture » de « Ce qui reste ouvert ».
- `1_architecture/1_1_contrat-appareils.md` - `meta.climate.stepC`.
- `1_architecture/1_2_serveur-et-plugins.md` - `core/climateLinks.ts` : liaison aveugle aux marques, arrondi vers le haut, garde anti-écho (cas du sondage tardif), premières lectures non copiées.
- `2_maison/2_0_format-house-json.md` - section `climateLinks` et route `PUT /api/house/climate-link`.
- `4_ui/4_6_autres-vues.md` - touches calées sur la grille, saisie au dixième, piège de l'input qui pousse la touche, sélecteur « Thermostat lié » ; dépasse « pas de commandes pour MELCloud ».
- `3_plugins/3_5_google-nest.md` - renvoi court (le Nest garde les dixièmes, partenaire du lien).

**Contradictions** : les passages « lecture seule » de 3_13 et 4_6 (et de `6_faq/6_1_pieges-runtime.md` pour la zone 2 de l'Ecodan, qui reste en lecture seule et donc exact) sont marqués dépassés par les sections datées, non effacés. Rien d'éprouvé sur le serveur réel pour le lien de thermostats.

**Index** : catalogues mis à jour (5 lignes), index.md régénéré.

## [2026-11-03] update | Site vitrine : la page française montre la vidéo française

**Trigger** : une vidéo de promotion en français est publiée, la page `/fr/` montrait la version anglaise.

**Pages modified** :
- 5_setup/5_2_production.md - puce « Une vidéo par langue » dans la section du site vitrine (où revient l'identifiant) ; complétée quand `README.fr.md` passe à la vidéo française.

**Index** : catalogue 5_setup déjà daté du 2026-11-03, index.md inchangé.

## [2026-11-03] update | Manifest d'installation en français ou en anglais

**Trigger** : demande de localiser le manifest, en particulier le raccourci « Demander » → « Ask », en fr et en seulement.

**Pages modified** :
- 5_setup/5_2_production.md - section datée « 2026-11-03 (ter) » (deux manifests, choix par `Accept-Language` à l'adresse unique, `Vary`, limite du réglage de langue non suivi faute de cookie, dev et démo).

**Index** : catalogue 5_setup déjà daté du 2026-11-03, index.md régénéré (inchangé).

## [2026-11-03] update | Icône du raccourci « Demander » : dessinée pour le disque blanc du lanceur

**Trigger** : capture du téléphone après mise à jour de la WebAPK, le disque plein reste réduit dans un disque blanc.

**Pages modified** :
- 5_setup/5_2_production.md - section datée « 2026-11-03 (bis) » (le lanceur enveloppe toute icône non adaptative, fond transparent, couleurs pour le blanc, dessin centré et agrandi, maskable inchangée, simulation) ; puce « disque plein » de la section précédente annotée comme démentie ; complément après la capture du téléphone (rendu bon, échelle mesurée à 76 %, étincelle agrandie en dégradé, onde centrée écartée).

**Contradiction relevée** : la section du matin affirmait que le disque plein évitait le fond blanc ; laissée en place, annotée avec renvoi.

**Index** : catalogue 5_setup déjà daté du 2026-11-03, index.md régénéré.

## [2026-11-03] update | Icône du raccourci « Demander » : disque plein, onde et étincelle, place de la pastille Android

**Trigger** : constat sur un téléphone Android, l'icône du raccourci épinglé réduite dans un disque blanc ; demande d'un visuel plus moderne (IA, voix, flux audio) qui tient compte de la pastille de l'app.

**Pages modified** :
- 5_setup/5_2_production.md - section datée « l'icône du raccourci Demander redessinée pour le lanceur Android » (Chrome prend l'icône any, disque plein contre le fond blanc, pastille à 44 % en bas à droite, nouveau dessin, aperçu jetable) ; puce Icônes de la section du 2026-10-31 annotée.

**Index** : catalogue 5_setup mis à jour (1 ligne), index.md régénéré.

## [2026-11-01] update | Droits par compte, fin de la phase 3 : le plan de la maison filtré par compte

**Trigger** : code non commité. Le plan (`house.json`) restait lisible par tous les comptes : un compte limité voyait nom et emplacement des appareils cachés, d'où leurs marqueurs dans la 3D de la vue Maison.

**Pages modified** :
- 1_architecture/1_13_comptes-et-sessions.md - section datée « le plan de la maison est filtré par compte » (trois sorties, règles `filterHouse` / `kindRight` / `settings` voit tout, effet côté app, tests, non joué) ; la puce « Restent lisibles » de la phase 2 et la « limite qui reste » de la phase 3 annotées comme levées.
- 1_architecture/1_7_serveur-mcp.md - `kasbah://house` filtrée par compte ; mention de `GET /api/session` corrigée (`rights` en plus de `user`).
- 1_architecture/1_3_protocole-rest-ws.md - `GET /api/house` et message `house` filtrés par compte (tableau des routes, section datée, renvoi « reste lisible » annoté).

**Contradiction relevée** : la mention « `/api/house` reste lisible » (1_3, 1_13 phase 2) est dépassée ; laissée en place, annotée avec renvoi. Aucune contradiction code / wiki trouvée.

**Trou** : jamais essayé avec un vrai compte limité sous l'adresse publique ; preview non jouée (le mode simulé n'a ni serveur ni comptes).

**Index** : catalogues inchangés (1_3, 1_7 et 1_13 déjà datés du 2026-11-01, portée des résumés inchangée), index.md régénéré (à jour).

## [2026-11-01] update | Droits par compte, phase 3 : l'app cache rail, vues et réglages interdits

**Trigger** : code non commité. Constat sur un compte limité (adresse publique) : toutes les icônes dans le rail, vue interdite vide avec un toast `errors.NO_RIGHT` non traduit, Réglages montrant tous les plugins.

**Pages modified** :
- 1_architecture/1_13_comptes-et-sessions.md - section datée « phase 3 » (`rights` dans `/api/session`, store, attente du routeur, `navItems`, `NoRightView`, i18n, écarté : griser, limite : marqueurs 3D, vérifications, piège GitNexus) ; « Reste à faire (phase 3) » annoté comme fait ; puce `/api/session` complétée ; sources.
- 1_architecture/1_3_protocole-rest-ws.md - `GET /api/session` rend `rights`.
- 1_architecture/1_4_app-web.md - store `session`, `beforeEach`, `navItems`, `NoRightView` dans le `keep-alive`.
- 4_ui/4_7_reglages.md - blocs masqués sans le droit `settings`, ce qui reste ; la « limite visible » du matin annotée comme levée.

**Contradiction relevée** : 1_7 (« `GET /api/session` → `{ user }` ») et la section 2026-10-06 de 1_4 (`session(): Promise<{ user }>`) sont dépassées sur la forme de la réponse ; laissées telles quelles (historique daté), complétées par renvoi dans 1_3, 1_4 et 1_13.

**Trou** : jamais essayé avec un vrai compte limité sous l'adresse publique (le mock n'a pas de session).

**Index** : catalogues 1_architecture (1_4 : date) ; 1_3, 1_13 et 4_7 déjà datés du 2026-11-01 ; index.md régénéré.

## [2026-11-01] update | Raccourci « Demander à Kasbah » : une page à part, `/ask`

**Trigger** : demande de l'utilisateur : le raccourci de la PWA arrivait sur la vue Maison (délai de la scène 3D) ; il veut une page dédiée, écoute en grand, saisie discrète dessous, place pour les actions et la réponse, rail gardé.

**Pages modified** :
- 1_architecture/1_9_assistant.md - section datée 2026-11-01 : route `/ask` sans scène ni entrée de rail, ancienne adresse renvoyée par `beforeEnter`, `canListenAlone()` déplacée, mise en page à quatre rangées et version écran bas, focus au doigt abandonné, three.js encore téléchargé par les stores, tests et mesures ; sources.
- 5_setup/5_2_production.md - section datée : adresse du raccourci `./ask`, repli SPA, ancienne adresse redirigée.

**Index** : catalogues 1_architecture et 5_setup (dates), index.md régénéré.

## [2026-11-01] update | Droits par compte, phases 1 et 2 (écritures, lectures, WebSocket, push)

**Trigger** : fonctionnalité livrée, code non encore commité : choisir à quoi chaque compte a droit (un interrupteur par domaine), blocages côté serveur, liste pliable sous chaque compte dans la carte Comptes.

**Pages modified** :
- 1_architecture/1_13_comptes-et-sessions.md - section datée 2026-11-01 (17 domaines, qui est concerné, stockage, hook de routes, garde-fou « le doute refuse », lectures, WebSocket, limites, phase 3 à faire) ; puces « Droits par compte » et « Outils MCP » renvoyées vers elle ; `rights` au tableau des fichiers d'état ; sources.
- 1_architecture/1_3_protocole-rest-ws.md - route `PUT /api/mcp/users/:name/rights`, code `NO_RIGHT`, WebSocket filtré par compte.
- 1_architecture/1_7_serveur-mcp.md - outils qui ne passent par aucune route et vérifient eux-mêmes.
- 1_architecture/1_16_notifications-push.md - envoi filtré par droit, abonnement gardé.
- 4_ui/4_7_reglages.md - lignes pliables, pastilles par domaine, limite de la phase 3.
- 0_overview/0_0_vision-et-principes.md - note datée : les droits ne sont plus « à faire » (hors masquage).

**Contradiction relevée** : 1_7 (2026-10-04) et 1_13 disaient que les outils MCP rejouent les routes de l'app ; faux pour `send_command`, `recall_scene` et plusieurs lectures (accès direct au registre). Anciennes phrases gardées, annotées.

**Trou** : les anciennes mentions « droits à faire » de 1_7 (« Décisions de l'utilisateur », 2026-10-04) sont laissées telles quelles (historique daté).

**Index** : catalogues 0_overview, 1_architecture (2 lignes, dont un résumé de 1_13 élargi), 4_ui mis à jour ; index.md régénéré.

<!-- log-nav:begin (généré par scripts/wiki-log.mjs, ne pas éditer) -->
> Fin du mois en cours. Entrées plus anciennes : [log/2026-10.md](log/2026-10.md) - catalogue : [log/README.md](log/README.md).
<!-- log-nav:end -->
