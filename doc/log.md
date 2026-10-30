# Journal du wiki

Entrées les plus récentes en haut. Une session = une entrée.

<!-- log-nav:begin (généré par scripts/wiki-log.mjs, ne pas éditer) -->
> **Mois en cours uniquement** (2026-10). Les mois précédents sont archivés dans [log/](log/README.md) par `scripts/wiki-log.mjs` : 217 entrées, de 2026-09 à 2026-09, une archive par mois.
> Pour remonter plus loin : chercher (`Grep`) un nom de page, un fichier ou un mot-clé dans `log/`, plutôt que lire les archives ; la date de mise à jour d'une page donne le mois à ouvrir. Mois précédent : [log/2026-09.md](log/2026-09.md).
<!-- log-nav:end -->

## [2026-10-30] update | Pont Matter : Google Home ne gère pas encore les fermetures

**Déclencheur** : essai de l'utilisateur sur la vraie maison ; texte de l'interrupteur et `docs/matter.md` mis à jour dans le même commit.

**Pages modifiées** :
- `1_architecture/1_17_pont-matter.md` - section « Mise à jour 2026-10-30 (7) » : portes listées mais inertes, lumières Hörmann hors connexion, retour par retrait et republication ; section (5) : le curseur de vitesse du ventilateur vérifié dans Google Home (20 % → vitesse 2).

## [2026-10-30] update | Pont Matter : portes de garage et portails en fermetures Matter 1.5

**Déclencheur** : question de l'utilisateur sur les portes de garage vues comme des stores ; livré dans le même commit que cette entrée (réglage `matter.closures`, interrupteur de la carte, `bridge.ts`, `mapping.ts`).

**Pages modifiées** :
- `1_architecture/1_17_pont-matter.md` - ligne du tableau et section « Mise à jour 2026-10-30 (6) » : réglage d'essai, traduction, deux pièges (`secureState` obligatoire, `TagList` du Descriptor), bascule à chaud par endpoint distinct, vérifié / non joué.

## [2026-10-30] update | Pont Matter : le ventilateur

**Déclencheur** : demande de l'utilisateur, publier le ventilateur de plafond Tuya et pas seulement sa lumière. Livré dans le même commit que cette entrée (`mapping.ts`, `bridge.ts`, type partagé, libellé de la carte).

**Pages modifiées** :
- `1_architecture/1_17_pont-matter.md` - ligne `fan` du tableau et section « Mise à jour 2026-10-30 (5) » : fonctionnalités selon l'appareil, piège du `FanControlServer` sans logique, règles de traduction, vérifié / non joué.

## [2026-10-30] update | Pont Matter : premier essai réel avec Google Home

**Déclencheur** : l'utilisateur a appairé le pont à Google Home sur la vraie maison ; `docs/matter.md` mis à jour dans le même commit (Google vérifié, hub, IPv6 link-local, appli du téléphone plutôt que la page web).

**Pages modifiées** :
- `1_architecture/1_17_pont-matter.md` - section « Mise à jour 2026-10-30 (4) » : ce qui a marché, projet neuf dans la console, hub, IPv6 coupé sur le routeur sans effet, page web qui ne liste pas les appareils.

## [2026-10-30] update | Pont Matter : guide utilisateur et section « Intégré » du site

**Déclencheur** : demande de l'utilisateur, une procédure pour appairer le pont (Google et sa console développeur en particulier) et une section du site pour ce qui est intégré sans être un plugin. Livré dans le même commit que cette entrée : `docs/matter.md`, liens des README, `site/index.html` et `site/fr/index.html`.

**Pages modifiées** :
- `1_architecture/1_17_pont-matter.md` - section « Mise à jour 2026-10-30 (3) » : renvoi vers `docs/matter.md`, ce que les sources de Google, Apple et Amazon établissent pour un pont non certifié, non vérifié chez nous.

**Trous** : aucun vrai assistant essayé ; libellés de la Google Home Developer Console à revérifier (pages de 2022-2023).

## [2026-10-30] update | Pont Matter : réseau local seulement, dissociation d'un assistant

**Déclencheur** : suite du pont Matter, livrée dans le même commit que cette entrée (`session.ts`, `bridge.ts`, `MatterCard.vue`, protocole partagé). Question de l'utilisateur : comment dépublier, d'où les quatre niveaux.

**Pages modifiées** :
- `1_architecture/1_17_pont-matter.md` - section « Mise à jour 2026-10-30 » : `/api/matter` en `LAN_ONLY` et pourquoi, assistants appairés (`fabrics`) et `DELETE`, piège du redémarrage du nœud, libellé produit, tableau des quatre niveaux de dépublication, vérifié / non joué.
- `1_architecture/1_3_protocole-rest-ws.md` - sous-section : `fabrics`, route `DELETE /api/matter/fabrics/:index`, `LAN_ONLY`.
- `4_ui/4_7_reglages.md` - section : boîte appairée, noms, « Dissocier » en deux temps, bouton réduit à l'icône sous 520 px, relecture, piège de grille à deux niveaux.
- `6_faq/6_0_pieges-outillage.md` - entrée « Revu le 2026-10-30 » sur le piège `minmax(0, 1fr)` à deux niveaux.
- `1_architecture/1_13_comptes-et-sessions.md` - une phrase : `/api/matter/*` rejoint les routes `LAN_ONLY`.
- `6_faq/6_1_pieges-runtime.md` - entrée : « n'a pas démarré » après le départ du dernier assistant.

**Contradictions et trous** : le tableau des codes d'erreur de `1_3` ne cite que `/api/mcp/users` pour `LAN_ONLY` (antérieur à `/api/system`) : complété dans la foulée. Non joué : vrai Alexa, Google ou Apple ; adresse publique réelle (seul le test de session couvre la garde).

**Index** : catalogues `6_faq` et `1_architecture` (1 date chacun), index.md régénéré ; les autres dates étaient déjà au 2026-10-30.

## [2026-10-30] update | Pont Matter et carte « Assistants vocaux » de Réglages

**Déclencheur** : rendre des appareils pilotables par Alexa, Google Home ou Apple Maison sans skill ni cloud ; livré dans le même commit que cette entrée : `apps/server/src/matter/`, bloc `matter` de la maison, routes `/api/matter`, carte de Réglages.

**Pages modifiées** :
- `1_architecture/1_3_protocole-rest-ws.md` - section « Mise à jour 2026-10-30 » : `GET` et `PATCH /api/matter`.
- `2_maison/2_0_format-house-json.md` - section « Mise à jour 2026-10-30 » : bloc `matter`, exposition appareil par appareil.
- `4_ui/4_7_reglages.md` - section « Mise à jour 2026-10-30 » : la carte (boîte d'appairage fixe, groupes pliables, mesures).
- `6_faq/6_1_pieges-runtime.md` - deux entrées : matter.js installe son environnement à l'import, Door Lock et ses bornes ; le front proxifie vers `KASBAH_PORT`.

**Pages créées** :
- `1_architecture/1_17_pont-matter.md` - le pont : décisions, pistes écartées (skill Alexa officielle, piloter un Echo, exposition par type ou par plugin, carte Plugins), traductions, cycle de vie, commande contrôleur ou écriture Kasbah, pièges, vérifié / non joué, restant.

**Contradictions et trous** : aucune contradiction code/wiki. Non sourcé, donc non écrit : aucune session de journal (`journal.md`) n'existait, le récit vient du fil principal et du code ; la disponibilité (`reachable`) et tout vrai assistant restent non joués ; les mesures de la carte (94 appareils, 557 px) sont reprises du témoignage.

**Index** : catalogues `1_architecture` (1 ligne ajoutée, intro), `2_maison`, `4_ui` et `6_faq` (1 date chacun), index.md régénéré.

## [2026-10-29] update | Plusieurs toits par maison (`roofs[]`), toits à 1 et 4 pans

**Déclencheur** : changement de code livré dans le même commit (format, géométrie, scène 3D) : une maison peut porter un toit par volume (maison, garage accolé plus bas, abri détaché). Demande liée de l'utilisateur : que les pignons s'affichent comme des murs de façade.

**Pages modifiées** :
- `2_maison/2_1_geometrie.md` — section « Mise à jour 2026-10-29 — plusieurs toits » (`computeRoofs`, `shed`/`hip`, emprise par pièces et règle du voisin, `eaves` et murs, `roofUnder`, validation, structure, impasse « bâtiments ») ; le paragraphe « Toit (`roof.ts`) » et les bornes marqués dépassés.
- `2_maison/2_0_format-house-json.md` — section « Mise à jour 2026-10-29 — `roofs[]` » (champs, compatibilité `roof`, refus des deux ensemble, validation, structure, démo Tilleuls) ; ligne Tilleuls du tableau des démos annotée.
- `1_architecture/1_5_scene-3d.md` — section « Mise à jour 2026-10-29 — plusieurs toits » (un mesh par toit, visibilité par niveau, pick, pignons `roof:gables` en façade, rives sur le contour, piège des observateurs `sameShell*` de `useHouseScene`) ; note « dépassé » sur la section du 2026-09-12 (quinquies).

**Contradictions et trous** : aucune contradiction code/wiki relevée au-delà des passages marqués dépassés.

**Index** : catalogues `1_architecture` (1 date) et `2_maison` (2 dates), index.md régénéré.

## [2026-10-29] update | Démo web statique sur GitHub Pages, Les Embruns en accueil, Les Tilleuls déplacée, assistant simulé

**Déclencheur** : préparation de la publication Play de l'appli Android ; l'utilisateur veut une démo visible sans rien installer, sur le site Pages, « en faisant attention à la sécurité ».

**Pages modifiées** :
- `5_setup/5_2_production.md` — section « Mise à jour 2026-10-29 — la démo web sur Pages » : `build --mode demo`, ce que la démo n'emporte pas (push, diagnostic, manifeste), CSP en `<meta>` et ses cinq hôtes de données, workflow en deux jobs (build sans droits ni scripts d'installation, déploiement seul à écrire, actions épinglées par SHA), `404.html`, vérification locale ; puis l'aperçu des liens de la démo (balises Open Graph et carte X, image `og-demo.jpg` avec bandeau « Live demo »).
- `1_architecture/1_9_assistant.md` — section « Mise à jour 2026-10-29 — un assistant simulé dans la démo sans serveur » : trois demandes à conditions, transcription remplacée et annoncée comme telle, exécution pièce par pièce, réponses enregistrées (fichiers à venir), option `demoAssistant` réservée à la démo ; puis, après essai, l'instruction qui défile (`MarqueeText`) et un rythme lisible des lignes ; enfin les six réponses enregistrées (MP3).
- `3_plugins/3_0_simulation-mock.md` — section « Mise à jour 2026-10-29 » : Les Embruns par défaut du transport in-process, nouvelle origine des Tilleuls (maison et simulation), l'ancienne `HOME` gardée pour la maison démo historique.

**Index** : catalogues `1_architecture` (1 résumé), `3_plugins` (1 date) et `5_setup` (1 résumé), index.md régénéré.

## [2026-10-29] update | Nest : appli OAuth publiée sans validation, liaison depuis un autre poste

**Déclencheur** : chantier 3 du plan site / Android / Nest — le compte Nest était à relier tous les 7 jours ; l'utilisateur demandait aussi si une appli Google commune à toutes les installations était possible.

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` — deux sections « Mise à jour 2026-10-29 » : statut « Test » constaté puis publication non validée (ce que réclame la page Branding, pas de logo, avertissement non bloquant, appli commune écartée et pourquoi), et la liaison depuis un autre poste (URI publique en HTTPS déclarée, ou recopie de l'URL de retour). L'absence d'expiration reste à constater d'ici le 2026-11-12.
- `docs/plugins/nest.md` (hors wiki) — paragraphe « Linking from another computer ».

**Index** : catalogue `3_plugins` (1 date), index.md régénéré.

## [2026-10-29] update | Site vitrine sur GitHub Pages (EN + FR) et politique de confidentialité de l'appli Android

**Déclencheur** : chantier 1 du plan site / Android / Nest — une page à partager, et l'URL de politique de confidentialité qu'exige Google Play.

**Pages modifiées** :
- `5_setup/5_2_production.md` — section « Mise à jour 2026-10-29 » : dossier `site/`, workflow `pages.yml` et réglage Pages = GitHub Actions, police servie par le site et vidéo au clic (aucun tiers avant un clic), images des démos seulement, `og-image` par ffmpeg, qualité YouTube non pilotable, politique écrite d'après le code Android.
- `5_setup/5_0_installation-et-scripts.md` — section datée : `check:private` ne lit que les fichiers suivis (`--message <fichier>` pour un fichier neuf), config de preview `kasbah-site`.

**Index** : catalogue `5_setup` (2 dates, résumé de 5_2 élargi au site), index.md régénéré.

## [2026-10-28] update | Logo sans fenêtres, deux coutures d'arêtes corrigées, appli Android 0.6

**Déclencheur** : la tour du logo perd ses fenêtres (idée venue d'une vidéo de démo) ; l'utilisateur a ensuite signalé un défaut sur l'arête de la tour.

**Pages modifiées** :
- `5_setup/5_2_production.md` — section « Mise à jour 2026-10-28 (bis) » : fenêtres retirées (web et Android), liseré sous les créneaux (dessus de tour peint avant les faces), point turquoise sur l'arête centrale (dessus du cube coupé avant l'arête), pièges pour refaire les PNG avec Chrome sans interface (fenêtre ≥ 500 px et facteur d'échelle, chemins à `/`, PowerShell) ; renvoi depuis le paragraphe de l'icône.
- `1_architecture/1_15_appli-android-auto.md` — note : générateur des XML non versionné, retouches portées à la main, version 0.6.

**Index** : catalogues `1_architecture` (1 date) et `5_setup` (date déjà du jour), index.md régénéré.

## [2026-10-28] update | Notifications push (Web Push) : alertes de la maison et action d'automatisation `notify`

**Déclencheur** : demande de notifications sur le bureau et le téléphone (alertes de la maison, messages d'automatisations) ; fonctionnalité codée dans l'arbre de travail, NON COMMITÉE au moment de l'écriture.

**Pages modifiées** :
- `1_architecture/1_8_automatisations.md` — section « Mise à jour 2026-10-28 » : action `notify`, aucun abonné n'est pas un échec, tous refusés = `UPSTREAM_ERROR`, statut inchangé, champ poussé à chaque frappe.
- `1_architecture/1_3_protocole-rest-ws.md` — section datée : les quatre routes `/api/push/*`, 502 si le service de push refuse, pas de message WS.
- `4_ui/4_7_reglages.md` — section datée : carte « Notifications » (interrupteur, six catégories, essai, raisons d'impossibilité, deux lignes réservées sous 700 px).
- `5_setup/5_2_production.md` — section datée : HTTPS obligatoire, iPhone en app installée, service worker désormais présent (nuance sur « plus besoin de service worker »), `.state/push.json` et `push-alerts.json`.

**Pages créées** :
- `1_architecture/1_16_notifications-push.md` — le mécanisme d'ensemble : pourquoi pas de bibliothèque (garde anti-SSRF), règle « une notification quand l'alerte apparaît », oublis à 10 min et 7 jours, contraintes, pistes écartées (ntfy), ce qui n'a pas été joué.

**Contradiction signalée** : aucune stricte. Nuance : `5_setup/5_2_production.md` (PWA, 2026-09-23) dit « plus besoin de service worker » ; vrai pour l'installation, plus pour les notifications (noté dans la mise à jour du jour).

**Trous** : aucun vrai envoi jusqu'à un navigateur réel, thème sombre et zooms 1,25 / 1,5 non joués ; en-têtes de cache de `sw.js` en production non vérifiés.

**Index** : catalogues `1_architecture` (1 ligne ajoutée, 2 dates, introduction), `4_ui` et `5_setup` (1 date chacun), index.md régénéré.

## [2026-10-27] update | iRobot : `IROBOT_HOST` pour un robot sur un autre sous-réseau

**Déclencheur** : préparation d'un réseau séparé pour les objets connectés (VLAN), où la diffusion UDP de la découverte iRobot ne passe plus ; renumérotation du réseau local de la vraie maison le même jour.

**Pages modifiées** :
- `3_plugins/3_14_irobot-roomba.md` — section « Mise à jour 2026-10-27 » : `IROBOT_HOST` interrogée directement en plus de la diffusion, réponse en envoi direct vérifiée sur le vrai robot, ce qui reste à constater à travers le routeur, test.
- `5_setup/5_1_configuration-env.md` — section « Mise à jour 2026-10-27 » : `IROBOT_HOST`, clés à revoir quand la plage du réseau local change, pièges rencontrés, plage privée obligatoire (`isPublicIp`).

**Index** : catalogues `3_plugins` et `5_setup` mis à jour (1 ligne chacun), index.md régénéré.

## [2026-10-26] update | Dev : le front suit le port du serveur, le clone de dev quitte le 8787 de la production

**Déclencheur** : production installée dans son propre clone sur 8787 ; le clone de développement, sur la même machine et en mode Réel, passe sur un autre port, et son front proxyfiait vers 8787 en dur.

**Pages modifiées** :
- `5_setup/5_0_installation-et-scripts.md` — section « Mise à jour 2026-10-26 » : `serverPort` de `vite.config.ts` (environnement, puis `apps/server/.env`, puis 8787 ; `KASBAH_SERVER` gagne), `MUSIC_PUBLISH_BASE` sur le même port, prix accepté du mode Réel dans deux clones.

**Index** : catalogue `5_setup` mis à jour (1 ligne), index.md régénéré.

## [2026-10-26] update | Build web : un import introuvable arrête le build avant toute écriture

**Déclencheur** : reproduction du build web de la mise à jour ratée : il échouait bien (code 1), mais après avoir vidé `dist/` et écrit des vues à import brut ; l'entrée FAQ du jour disait à tort qu'il réussissait.

**Pages modifiées** :
- `6_faq/6_0_pieges-outillage.md` — entrée du 2026-10-26 : correction du diagnostic (échec après écriture), greffon `kasbah-fail-unresolved`, vérification.
- `5_setup/5_2_production.md` — mise à jour du 2026-10-26 : précision sur le build web, qui ne touche plus à `dist/` quand il échoue.

**Index** : catalogues déjà au 2026-10-26, index.md à jour.

## [2026-10-26] update | Production : `node_modules` recopié, et la mise à jour lancée sans Réglages

**Déclencheur** : première mise à jour réelle depuis Réglages en échec au build (`Could not resolve "@kasbah/shared"`), sur un clone de production rempli par copie ; écrans cassés par le build web refait ; Réglages inaccessible.

**Pages modifiées** :
- `6_faq/6_0_pieges-outillage.md` — entrée du 2026-10-26 : jonctions `node_modules/@kasbah/*` devenues des dossiers vides à la copie, build web qui réussit avec des imports bruts, `npm ci` serveur arrêté.
- `5_setup/5_2_production.md` — suite de la mise à jour du 2026-10-26 : échec puis réussite (~12 s, coupure ~9 s), `npm ci` comme prérequis, `Stop-`/`Start-ScheduledTask` sans administrateur, commande `Invoke-WebRequest` de secours (avec `-ContentType` et `-Body`, sinon 415).

**Index** : catalogue `6_faq` mis à jour (1 ligne, périmètre élargi), catalogue `5_setup` déjà au 2026-10-26, index.md régénéré.

## [2026-10-26] update | Production : la tâche planifiée Windows, éprouvée au premier déploiement

**Déclencheur** : premier déploiement du superviseur sur la vraie machine ; `Register-ScheduledTask` refusé (« Accès refusé », 0x80070005) dans une console ordinaire.

**Pages modifiées** :
- `5_setup/5_2_production.md` — section « Mise à jour 2026-10-26 » : console administrateur pour enregistrer la tâche, `Set-Location` dans le clone avant le bloc (la console admin s'ouvre dans `system32`), ce qui a été vérifié (`Running`, `LastTaskResult` 267009 = en cours, `supervised: true`) et ce qui reste à éprouver ; renvois ajoutés sous le bloc PowerShell et sous « Pas encore éprouvé ».

**Index** : catalogue `5_setup` mis à jour (1 ligne), index.md régénéré.

## [2026-10-26] update | Enphase : le jour ne se lit plus sur les compteurs `whToday` de la passerelle

**Déclencheur** : la vue Énergie affichait pour aujourd'hui une production trois fois supérieure à la somme des onduleurs ; le compteur `eim` de `production.json` avait sauté (vérifié sur la vraie installation, Enlighten et les onduleurs d'accord entre eux).

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` — production du jour = somme des compteurs des onduleurs, consommation = bilan ; `toDailyPatch` et `recordCounters` supprimés ; ce qui était faux dans « nos relevés ».
- `1_architecture/1_14_energie.md` — correction de « exact, approché » pour Enphase.

**Index** : catalogues déjà au 2026-10-26, index.md régénéré.

## [2026-10-26] update | Vue Énergie : l'historique journalier rechargé par ses deux derniers jours

**Déclencheur** : la vue Énergie rechargeait chaque minute l'historique entier (et désormais même en Instantané) ; sur des années d'historique de vingt onduleurs, des centaines de Ko par minute.

**Pages modifiées** :
- `1_architecture/1_14_energie.md` — paramètre `?days=n` de `GET /api/devices/:id/energy-days` (`recentEnergyDays`), découpé dans la route.
- `4_ui/4_4_vues-energie-vehicules.md` — chargement entier à l'ouverture et au changement de jour, puis hier et aujourd'hui fusionnés (`mergeRecentDays`) ; cas où tout est rechargé.

**Index** : catalogues déjà au 2026-10-26, index.md régénéré.

## [2026-10-26] update | Enphase : rattrapage des pics par 3 jours, une tranche en échec n'arrête plus rien

**Déclencheur** : le premier rattrapage réel s'est arrêté sur un dépassement du délai cloud (une semaine prenait 11 à 13 s pour 15 s), et la frise, qui ne regardait que les Wh, disait tout complet : « Resynchroniser » restait grisé.

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` — tranches de 3 jours, échec par tranche, jour sans pic compté incomplet dans la frise.

## [2026-10-26] update | Enphase : le record d'un onduleur vient de l'historique, plus de `maxReportWatts`

**Déclencheur** : le `maxReportWatts` de la passerelle n'est pas un record (il oublie ses pics en quelques jours, vérifié sur la vraie installation) ; les records viennent désormais du cloud Enlighten (série au quart d'heure) et suivent la période de la vue Énergie. Changement de code non commité au moment de l'écriture.

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` - section datée : ce qui était faux, nouvelle route `time_series.json` (mesures de méthode, route écartée), `peakW` stocké, rattrapage par tranches de 7 jours, rafraîchissement 15 min, source unique et pourquoi
- `1_architecture/1_1_contrat-appareils.md` - `maxValue` tenu par l'appareil ou son plugin ; renvoi corrigeant la section du 2026-09-13
- `1_architecture/1_14_energie.md` - `peakW` dans `energy-days`
- `4_ui/4_4_vues-energie-vehicules.md` - repères record et plafond visibles sur une période, record qui suit le sélecteur, `maxW` supprimé
- `1_architecture/1_12_scene-3d-objets.md` - le repère record de la scène montre le vrai record ; il peut être dépassé
- `3_plugins/3_0_simulation-mock.md` - `peakW` simulé

**Contradiction signalée** : les sections du 2026-09-13 de `3_7` et `3_0` (« meilleur moment de l'année », record tenu comme `maxReportWatts`) ne sont pas réécrites ; la mise à jour du jour les corrige par renvoi. `3_0` : le record live simulé (`maxValue`) n'est pas aligné sur le `peakW` simulé.

**Index** : catalogues mis à jour (6 lignes), index.md régénéré.

## [2026-10-26] update | Caméras Nest : vignettes en mémoire, première image tout de suite, direct rejoint sans attente

**Déclencheur** : demande de l'utilisateur : première image d'un flux trop lente, surtout sur la vue Caméras, images très anciennes après une longue pause, et le moins d'écritures disque possible (serveur sous Windows).

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` - section datée : vignettes par `pipe:3` gardées en mémoire, image figée sur le disque (fermeture, 5 min, arrêt) et rechargée au démarrage, `select` + `-threads 1` (causes du retard mesurées), dernier fragment rejoué, mesures sur une vraie caméra, piste `fflags nobuffer` relevée, ordre du rang 0 de la rotation relevé ; renvoi « Dépassé » sous l'ancienne description du JPEG réécrit sur le disque. Seconde section datée : `fflags nobuffer` retiré (liste `concat` et ligne de commande), mesures avant / après sur une vraie caméra ; renvois sous la description de la liste `concat` du 2026-10-24 et sous la piste.
- `4_ui/4_3_vues-lumieres-ouvrants-cameras.md` - section datée : la dernière vignette reste affichée pendant la connexion du direct, jusqu'à ce que la vidéo joue. Seconde section datée, sur retour de l'utilisateur : tuile d'une caméra éteinte (image assombrie et message), raisons d'échec du direct en phrases, Aperçu qui efface l'échec. Troisième section datée : « Mise à jour de l'image… » qui pulse pendant un essai. Quatrième section datée : âge des vignettes en heures et en jours. Cinquième section datée : Direct saute au direct.
- `3_plugins/3_5_google-nest.md` - troisième section datée : une image efface la marque « inactive », quel que soit celui qui a ouvert la session ; caméra en échec jamais réessayée quand le budget est inférieur au nombre de caméras (relevé, non traité). Quatrième section datée : flux bloqués (délai réseau de ffmpeg, surveillance du relais), état `refreshing`, ordre de rotation au démarrage confirmé. Cinquième section datée : au démarrage, l'image la plus récente d'abord. Sixième section datée : quota de Google documenté et mesuré, ouvertures en rafale sous un plafond de 6 commandes par minute. Septième section datée : fragments d'une demi-seconde, rejeu depuis l'image clé, direct à environ 1 s du bord, départ à froid de 19,6 s relevé. Huitième section datée : départ à froid mesuré étape par étape (10 s de Google pour deux caméras), délai réseau à 20 s, analyse du flux bornée.

**Index** : catalogues mis à jour (2 lignes), index.md régénéré.

## [2026-10-26] update | Le brouillard météo s'étire avec la caméra

**Déclencheur** : brouillard sur la vraie maison ; vue 3D grise sur téléphone et en vue « Jardin » sur ordinateur, lisible en vue « Tout » sur ordinateur.

**Pages modifiées** :
- `1_architecture/1_11_scene-3d-rendu.md` - section datée : distances de caméra mesurées (55 / 114 / 120 m), `fogRange` et `FOG_CAMERA_REF_M`, bornes relues à chaque image, décalage écarté ; renvois ajoutés à la section du 2026-10-14 et à la « conséquence connue » de l'isométrie.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-25] update | Eau, Chauffage, Luminosité : découpage glissant ou calendaire

**Déclencheur** : demande de l'utilisateur, après la vue Énergie : le même choix Glissant / Calendaire sur les autres graphes d'historique.

**Pages modifiées** :
- `4_ui/4_6_autres-vues.md` - section datée : sélecteur sur les graphes Eau et Chauffage, fenêtres calendaires, pas à venir vides, titres de fenêtre, mise en page au téléphone, restes (sélecteur à quatre choix trop large aux forts zooms).
- `4_ui/4_3_vues-lumieres-ouvrants-cameras.md` - section datée : le même sélecteur sur le graphe Luminosité.
- `4_ui/4_4_vues-energie-vehicules.md` - phrase « eau, chauffage et lumières n'ont pas bougé » complétée d'un renvoi.

**Index** : catalogue mis à jour (2 lignes), index.md régénéré.

## [2026-10-25] update | Windows refuse le `rename` d'un fichier d'état ouvert

**Déclencheur** : test du journal de l'assistant en échec à 5 s dans la suite complète (trois fois sur quatre), jamais seul ; cause : l'écriture perdue, pas lente.

**Pages modifiées** :
- `6_faq/6_1_pieges-runtime.md` - entrée datée : `rename` refusé en `EPERM` sous Windows sur un fichier ouvert (mesure 1 789 / 2 000), entrée du journal perdue, test qui attend l'écriture, `writeFileAtomic` qui retente 2 s.
- `1_architecture/1_2_serveur-et-plugins.md` - section datée : retentative du `rename` sous Windows (codes, attente, limite, file).

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-25] update | Enphase : un jour sans rien chez Enphase est connu

**Déclencheur** : première synchronisation réelle réussie, mais deux jours de mise en service restaient « absents » pour les onduleurs (Enphase répond vide) et étaient redemandés à chaque resynchro.

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` - section datée (bis) : état `e` « rien chez Enphase », sauté par la resynchro intelligente, jamais pour la veille ; renvoi depuis la liste des états.

**Index** : rien à régénérer (date du catalogue déjà au 2026-10-25).

## [2026-10-25] update | Automatisations : vider la période et les bornes au téléphone

**Déclencheur** : sur Android, impossible de retirer les dates de début et de fin d'une règle dupliquée ; le sélecteur natif ne vide pas son champ.

**Pages modifiées** :
- `1_architecture/1_8_automatisations.md` - section datée : bouton × au bout des lignes « Du / Au » et « Pas avant / Pas après », place réservée, vérifications et restes.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-25] update | Vue Énergie : historique par période (jour par jour, site et onduleurs)

**Déclencheur** : fonctionnalité codée dans la session (non commitée à l'écriture) : sélecteur Jour / Semaine / Mois / Année / Total, historique journalier persistant du plugin Enphase par le cloud et par nos relevés, par onduleur, resynchro, simulation.

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` - section datée : modèle de jour (date locale, vendeur ou local), routes Enlighten privées, API v4 écartée, onduleurs (joules, somme par plage, rattrapage tout en jours), resynchro `c`/`p`/`m`, routes de plugin, variables, fichiers d'état ; lacune `.env.example` signalée.
- `1_architecture/1_14_energie.md` - section datée avec note « Dépassé le 2026-10-25 » sur l'historique en mémoire (l'ancien texte est conservé).
- `4_ui/4_4_vues-energie-vehicules.md` - section datée : sélecteur et découpage glissant / calendaire, flux sur une période sans point animé, cases d'onduleurs (unité une fois), carte des Réglages.
- `1_architecture/1_1_contrat-appareils.md` - capacité `energy_history`.
- `1_architecture/1_3_protocole-rest-ws.md` - route `energy-days` et routes de plugin de l'historique.
- `3_plugins/3_0_simulation-mock.md` - site simulé : ~420 jours fabriqués, répartition entre panneaux.
- `6_faq/6_0_pieges-outillage.md` - deux entrées : réécriture des chemins `/…` par Git Bash (`MSYS_NO_PATHCONV=1`) ; instance de module distincte après rechargement à chaud dans la preview.

**Contradictions** : aucune entre code et wiki ; l'historique « 48 h, en mémoire » de 1_14 n'est plus le seul, signalé en place.

**Index** : catalogues mis à jour (7 lignes dont 3 résumés de périmètre), index.md régénéré.

## [2026-10-25] update | L'assistant depuis toutes les pages : un bouton dans l'en-tête

**Déclencheur** : demande « accessible depuis n'importe quelle page, et en particulier sur mobile » ; seule zone commune, l'en-tête.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : bouton de `PageHeader` qui ouvre la palette (signal `paletteRequest`), sans focus au doigt, placement téléphone / bureau / Maison / Météo, onglets compacts de Maison entre 1000 et 1199 px, mesures, restes (1000-1023 px, Ouvrants) et piège jsdom du focus.
- `1_architecture/1_9_assistant.md` - section datée : troisième point d'entrée, renvoi vers 4_1 ; `PageHeader.vue` ajouté aux sources.

**Index** : catalogues mis à jour (2 lignes), index.md régénéré.

## [2026-10-25] update | Graphique « Jour » : heures réelles au changement d’heure

**Déclencheur** : `WaterConsumptionChart.test.ts` échoue le jour du passage à l’heure d’hiver ; la cause est dans `bucketSlots`, pas dans le test.

**Pages modifiées** :
- `6_faq/6_1_pieges-runtime.md` - entrée datée : colonnes horaires reculées en heures d’horloge, une heure sans colonne ; heures en millisecondes, tests figés aux deux dates, renvoi aux automatisations (jour calendaire).

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-25] update | Rail : Lumières et Ouvrants d’abord, ordre réglable par appareil

**Déclencheur** : sur téléphone, il fallait faire défiler la barre du bas pour atteindre les Ouvrants ; demande d’un ordre propre à chaque appareil (Maison et Réglages fixes).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : nouvel ordre par défaut de `NAV_ITEMS`, `orderNavItems` et `kasbah.navOrder`, ordre par utilisateur écarté.
- `4_ui/4_7_reglages.md` - section datée : carte « Barre de navigation » (`NavOrderCard`), glisser par poignée, vues masquées qui gardent leur place, placement mesuré dans la pile de gauche.

**Index** : catalogue mis à jour (2 lignes), index.md régénéré.

## [2026-10-25] update | Tuya : la santé dit pourquoi la connexion locale échoue

**Déclencheur** : ventilateur indisponible dans Kasbah, en ligne dans l'application Tuya ; la santé ne donnait que « no Tuya device connected ».

**Pages modifiées** :
- `3_plugins/3_18_tuya.md` - section datée : appli Tuya (cloud) ≠ joignable en local, `onConnectError`, `warn` une fois par raison, `connectErrors` par appareil, lecture des messages d'erreur.
- `3_plugins/README.md` - résumé et date de la page.

**Contradictions** : aucune relevée.

## [2026-10-25] update | Sécurité de l'appli Android Auto : hôte vérifié, préférences hors sauvegarde, récepteur de test protégé

**Déclencheur** : scan Claude Security de `apps/android` (effort medium), trois constats corrigés.

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - section datée : liste d'hôtes signés en release (`hosts_allowlist_sample`, tout-venant gardé pour la version debug), `kasbah.xml` exclu de la sauvegarde et du transfert, `MockLocationReceiver` réservé à `adb` par `DUMP` ; pistes écartées (`allowBackup="false"`, `exported="false"`) ; renvois ajoutés aux deux passages devenus inexacts.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-25] update | Sécurité de l'app web : retour après connexion, cadre, secrets en clair, Agenda borné

**Déclencheur** : audit Claude Security de `apps/web` (effort medium), quatre constats corrigés.

**Pages modifiées** :
- `1_architecture/1_13_comptes-et-sessions.md` - section datée : `safeNext` refuse un chemin normalisé en `//`, en-têtes anti-cadre sur les pages du build, cookie YouTube / jeton Claude / mot de passe TouteMonAnnée / adresse iCal documentés comme passant en clair ; zones non auditées.
- `3_plugins/3_22_agenda.md` - section datée : jours d'un événement bornés à ceux affichés (`within`).

**Index** : catalogues mis à jour (2 lignes), index.md régénéré.

## [2026-10-24] update | Sécurité : le serveur ne va plus chercher d'adresse locale pour autrui ; mots de passe en clair documentés

**Déclencheur** : audit de sécurité de `apps/server`, constats F24, F25, F27, F30 (requêtes vers des adresses choisies par d'autres) et F35 (mots de passe de comptes tiers en HTTP sur le réseau local).

**Pages modifiées** :
- `3_plugins/3_6_google-cast.md`, `3_plugins/3_15_sonos.md`, `3_plugins/3_22_agenda.md`, `1_architecture/1_7_serveur-mcp.md` - sections datées : `publicFetch` (`core/outbound.ts`), adresse publique seule ; exception Sonos pour une enceinte connue.
- `1_architecture/1_13_comptes-et-sessions.md`, `3_plugins/3_9_renault.md` - F35 documenté, choix de ne pas refuser le HTTP.

**Index** : catalogue mis à jour (4 lignes), index.md régénéré.

## [2026-10-24] update | Sécurité : le jeton RTSP de Nest hors de la ligne de commande de ffmpeg

**Déclencheur** : F38, d'abord seulement documenté ; ffmpeg 9.0.2 sur le serveur et sur le poste a permis de tester les parades.

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` - section datée : liste `concat` 0600 effacée à la sortie, `-/i` refusé, liste blanche des protocoles obligatoire ; renvoi sur la section « non corrigé ».
- `5_setup/5_2_production.md` - renvoi : `hidepid` n'est plus nécessaire pour ce jeton.

**Index** : index.md inchangé (pages déjà datées du jour).

## [2026-10-24] update | Sécurité : certificat de la box TaHoma épinglé, jeton RTSP de Nest documenté

**Déclencheur** : suite de l'audit de sécurité de `apps/server` : TaHoma ne vérifiait pas non plus son certificat ; constat F38 (jeton du flux Nest dans la ligne de commande de ffmpeg).

**Pages modifiées** :
- `3_plugins/3_4_somfy-tahoma.md` - mise à jour datée : épingle TOFU, accepter un nouveau certificat en supprimant `.state/tahoma-tls-pin.json`.
- `3_plugins/3_5_google-nest.md` - mise à jour datée : F38 non corrigé dans le code, pourquoi, et la parade côté machine.
- `5_setup/5_2_production.md` - section datée : `hidepid=2` sur `/proc`.

**Index** : catalogues mis à jour (3 lignes), index.md régénéré.

## [2026-10-24] update | Sécurité : robustesse (connexions, messages iRobot, descriptions iCal)

**Déclencheur** : audit de sécurité de `apps/server`, constats F17, F28 (blocage des connexions), F39 (récursion iRobot), F41 (expression régulière iCal).

**Pages modifiées** :
- `1_architecture/1_13_comptes-et-sessions.md` - renvoi daté sur le plafond global et section : plafond par client (`clientOf`, dernière entrée de `X-Forwarded-For`), tentative comptée avant scrypt.
- `1_architecture/1_7_serveur-mcp.md`, `5_setup/5_1_configuration-env.md` - renvois datés sur le plafond global.
- `3_plugins/3_14_irobot-roomba.md` - mise à jour datée : message de plus de 32 niveaux écarté, gestionnaire qui ne laisse rien s'échapper.
- `3_plugins/3_22_agenda.md` - mise à jour datée : regex linéaire, description tronquée et nettoyée seulement pour une occurrence gardée, flux plafonné à 10 Mo.

**Index** : catalogues mis à jour (2 lignes), index.md régénéré.

## [2026-10-24] update | Sécurité : un contenu extérieur lu interdit d'ouvrir un accès par le MCP

**Déclencheur** : audit de sécurité de `apps/server`, constats F18, F19, F23 (injection d'instructions par l'agenda, l'école, la recherche musicale).

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - mise à jour datée : `ExternalReads` (jeton marqué 30 min après `get_agenda`, `get_school`, `search_music`, `send_command` sensible refusé), automatisations sensibles activées et lancées depuis l'app seulement ; renvoi sur la phrase du 2026-10-15 dépassée.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-24] update | Sécurité : fichiers d'identifiants en 0600, cookie YouTube Music effacé en entier

**Déclencheur** : audit de sécurité de `apps/server`, constats F11, F26, F29, F31, F33, F43.

**Pages modifiées** :
- `3_plugins/3_16_ytmusic.md` - mise à jour datée : cookie et copie Netscape en 0600, les deux effacées au déliage.
- `3_plugins/3_22_agenda.md` - mise à jour datée : fichier des agendas en 0600.
- `3_plugins/3_7_enphase.md` - (dans la section du certificat) jeton de passerelle et session Enlighten en 0600.

**Index** : catalogue mis à jour (2 lignes), index.md régénéré.

## [2026-10-24] update | Sécurité : certificats des appareils épinglés au premier contact

**Déclencheur** : audit de sécurité de `apps/server`, constats F7, F32, F37 (TLS non vérifié vers le pont Hue, la passerelle Enphase, le Roomba).

**Pages modifiées** :
- `3_plugins/3_1_philips-hue.md`, `3_plugins/3_7_enphase.md`, `3_plugins/3_14_irobot-roomba.md` - mise à jour datée : épingle TOFU (`core/tls-pin.ts`), santé `error` et ré-appairage qui l'efface ; Roomba : adresse de l'émetteur UDP, lien connecté jamais remplacé, CONNECT bloqué jusqu'au contrôle.

**Index** : catalogue mis à jour (3 lignes), index.md régénéré.

## [2026-10-23] update | Appli Android Auto : alerte d'approche « Ouvrir le portail », ouvrants numérotés

**Déclencheur** : demande de ne plus ouvrir l'appli pour ouvrir le portail ; prototype d'une notification voiture à l'approche, essayé dans le DHU.

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - troisième section datée : version 0.4, message de localisation en arrière-plan exigé par Google Play, déclaration et vidéo de la Play Console.
- `1_architecture/1_15_appli-android-auto.md` - seconde section datée : noms courts numérotés par type, icône numérotée, liste du téléphone (ordre, ★ deux au plus pour l'alerte), notification qui ouvre la grille ; vérifié dans le DHU.
- `1_architecture/1_15_appli-android-auto.md` - section datée : position de la maison (`origin`), géorepérage de 400 m, contrôle « en voiture », notification à deux boutons, version debug à part et `MockLocationReceiver`, constats du DHU (bandeau bref, pas de second bandeau, résultat non montré dans la voiture), pièges (code 1000, émulateur), reste à faire.

**Index** : catalogue `1_architecture` (résumé de 1_15), index.md regénéré.

## [2026-10-23] update | Appli Android Auto : ajouter un testeur

**Déclencheur** : un second testeur ne trouvait pas l'appli sur le Play Store, puis l'a eue un peu plus tard.

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - mémo du Play Store, étape 7 : un autre testeur (pas de mode développeur, liste cochée, délai avant que l'appli apparaisse).

**Index** : index.md inchangé (page déjà datée du jour).

## [2026-10-23] update | Sécurité : les jetons MCP tombent avec le mot de passe

**Déclencheur** : audit de sécurité de `apps/server`, constats F8/F9 (jetons MCP qui survivaient au mot de passe).

**Pages modifiées** :
- `1_architecture/1_13_comptes-et-sessions.md` - renvoi daté sur « les jetons MCP ne tombent qu'au retrait du compte » et section : empreinte `pw` dans chaque jeton, anciens jetons refusés (reconnexion une fois).

**Index** : index.md inchangé (page déjà datée du jour).

## [2026-10-23] update | Sécurité : le relais `/art` ne rend qu'une image matricielle

**Déclencheur** : audit de sécurité de `apps/server`, constats F5/F6 (relais d'illustrations Sonos et Cast).

**Pages modifiées** :
- `3_plugins/3_6_google-cast.md`, `3_plugins/3_15_sonos.md` - mise à jour datée : `/art` ne retient que des adresses http(s), ne rend qu'une image matricielle (pas de SVG), en-têtes `nosniff` et CSP `sandbox` (`http/art.ts`).

**Index** : catalogue mis à jour (2 lignes), index.md régénéré.

## [2026-10-23] update | Sécurité : la sonde Enphase ne rend plus le jeton du compte

**Déclencheur** : audit de sécurité de `apps/server`, constats F12/F13 (jeton Enlighten rendu par `/ev/raw`).

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` - mise à jour datée : `/ev/raw` ne sonde plus `/users/self/token`, seulement `hasAccessToken`.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-23] update | Sécurité : le retour après connexion lu comme le navigateur

**Déclencheur** : audit de sécurité de `apps/server`, constat F4 (redirection ouverte par `next=/<TAB>/evil.example`).

**Pages modifiées** :
- `1_architecture/1_13_comptes-et-sessions.md` - précision datée sur `next` : `safeNext` passe par `new URL`, seul un chemin de même origine est gardé.

**Index** : index.md inchangé (page déjà datée du jour).

## [2026-10-23] update | Sécurité : le réseau local reconnu à son nom, les pages des autres sites refusées

**Déclencheur** : audit de sécurité de `apps/server`, constat F14 (DNS rebinding) et les requêtes croisées depuis le réseau local (F15, F16, F22 et les déliaisons de comptes).

**Pages modifiées** :
- `1_architecture/1_13_comptes-et-sessions.md` - mise à jour datée (soir) : `isLanHost` (IP, `localhost`, nom court, suffixes locaux, `KASBAH_LAN_HOSTS`), 403 `UNKNOWN_HOST`, `Origin` exigé du même hôte pour une écriture ou un WebSocket sur le réseau local, choix écartés.
- `5_setup/5_1_configuration-env.md` - mise à jour datée : variable `KASBAH_LAN_HOSTS`.

**Index** : catalogues mis à jour (1 ligne), index.md régénéré.

## [2026-10-23] update | Appli Android Auto : mémo des étapes Google Play

**Déclencheur** : mise en ligne de l'appli sur la piste de test interne du Play Store, pour qu'elle apparaisse dans la vraie voiture ; garder les étapes en mémoire.

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - mise à jour datée : compte, nom de package, partage interne refusé avant publication, clé d'envoi hors du dépôt, `bundleRelease`, `targetSdk` 36, piste de test interne, lien d'activation, mises à jour., et le constat dans la vraie voiture (réponse vocale coupée à l'écran, corrigée en 0.2).

**Index** : index.md inchangé (page déjà datée du jour).

## [2026-10-23] update | Sécurité : nom public sans casse, routes locales décidées sur la route trouvée

**Déclencheur** : audit de sécurité de `apps/server` (Claude Security), correctifs des deux failles les plus graves.

**Pages modifiées** :
- `1_architecture/1_13_comptes-et-sessions.md` - mise à jour datée : le nom public comparé sans casse ni point final (`isPublicRequest`), `LAN_ONLY` décidé aussi sur `req.routeOptions.url`, le piège de `req.url` dans un hook `onRequest`, et le *DNS rebinding* qui reste ouvert.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-23] update | Appli Android Auto : le Play Store exigé en voiture, français et anglais

**Déclencheur** : l'appli n'apparaît pas dans la vraie voiture ; puis la demander en français et en anglais.

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - deux mises à jour datées : « Sources inconnues » ne couvre pas la Car App Library (le simulateur saute le contrôle), essais écartés, voie du partage interne Play et adresse publique du compte ; textes en `strings.xml` anglais / français.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-22] update | Appli Android Auto (`apps/android`)

**Déclencheur** : lire la pression des pneus de la R5 par une appli dans la voiture ; devenu une appli Android Auto pour le portail, les garages et la voix (« Parler »), essayée sur un téléphone et dans le simulateur.

**Pages modifiées** :
- `1_architecture/1_9_assistant.md` - mise à jour datée : la synthèse vocale des réponses existe (route `speak`), et l'appli de voiture est un deuxième client de `/api/assistant/ask`.
- `3_plugins/3_9_renault.md` - mise à jour datée : l'appli embarquée openR Link ne lira pas les pneus (permission `_3P` à partir d'Android Automotive 15, R5 en Android 12).
- `6_faq/6_0_pieges-outillage.md` - deux entrées : simulateur DHU bloqué par des connexions fermées de force, script `.cmd` lu de travers (LF, `chcp`).

**Pages créées** :
- `1_architecture/1_15_appli-android-auto.md` - l'appli : choix d'Android Auto et pistes écartées, connexion, écrans voiture, sondage, voix, simulateur, pièges.

**Index** : catalogues mis à jour (4 lignes), index.md régénéré.

## [2026-10-22] update | Page de diagnostic navigateur et `POST /api/diag`

**Déclencheur** : « j'ai essayé l'app dans le navigateur de la tesla, ça rame beaucoup et la vue 3d ne semble jamais s'afficher » ; avant de corriger, savoir ce qu'est ce navigateur.

**Pages modifiées** :
- `1_architecture/1_3_protocole-rest-ws.md` - section datée : page autonome `/diag.html` (ES5, hors app), route `POST /api/diag` journalisée par un journal enfant (le journal HTTP est à `warn`).
- `1_architecture/1_3_protocole-rest-ws.md` - section (bis) : tests 3D depuis `/diag.html` (vraie scène avec ou sans ombres et photos, `?probe=`, `sceneProbe.ts`), rampe mémoire GPU, lecture des traces.
- `1_architecture/1_11_scene-3d-rendu.md` - section datée : mesures du navigateur de voiture, `lacksResources()` (≤ 2 Go annoncés) → pas de scène, message et « Afficher quand même » pour la session.

**Index** : catalogue 1_architecture (1 ligne), index.md régénéré.

## [2026-10-21] update | Thermostat : une seule commande après une rafale de clics (quota Google)

**Déclencheur** : « quand on veut régler la température et baisser de plusieurs demi degrés […] des messages d'erreur indiquant qu'il y a trop de commandes ».

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` - section datée : deux appels Google par clic, brouillon de consigne `useSetpointDraft` (1,2 s), abandon au changement d'appareil dans le panneau 3D.

**Index** : index.md régénéré (date déjà à jour).

## [2026-10-21] update | Hörmann : flasher et configurer un pont

**Déclencheur** : préparation du 2e Atom ; « mettre ces infos d'aide à la config dans le doc du plugin », avec les liens du matériel.

**Pages modifiées** :
- `3_plugins/3_26_hormann.md` - section « Flasher et configurer un pont » : esptool à 115 200 bauds, offsets, AP HCPBRIDGE, ordre des réglages, Device ID ; LED de l'Atom allumée sur USB-C seulement (corrige « pas de voyant »).

## [2026-10-21] update | Hörmann : la lumière du moteur n'est plus liée à la porte

**Déclencheur** : « ce sont des led sur le moteur, donc au plafond du garage […] ça ne semble pas apparaître dans la vue Lumières ».

**Pages modifiées** :
- `3_plugins/3_26_hormann.md` - plus de `meta.linkedTo` sur la lumière : la vue Lumières (`RoomBands hide-linked`) cache tout accessoire lié, et la porte (mur) et ses LED (plafond) ne sont pas un même objet.

## [2026-10-21] update | Hörmann : stop avant inversion ; lier un ouvrant à un appareil jamais placé

**Déclencheur** : « quand une action est en cours et qu'on demande une autre action, la deuxième ne fonctionne pas » ; « pouvoir directement lier l'appareil à l'ouvrant sans manip de placement ».

**Pages modifiées** :
- `3_plugins/3_26_hormann.md` - le moteur ignore une commande contraire au mouvement : stop puis commande (`needsStopFirst`), délai non mesuré.
- `4_ui/4_8_mode-edition-et-proprietes.md` - section datée : « Ouvrant lié » propose les covers de plugin sans entrée, `setOpeningPluginDevice`, cas auto-placé non vérifié.
- `4_ui/README.md` - date du catalogue.

## [2026-10-21] ingest | Plugin Hörmann : portes de garage par un pont HCPBridgeMqtt

**Déclencheur** : « écris le plugin Kasbah Hörmann (HTTP /status, /command, SSE /events de l'Atom) », après le raccordement de la première porte au bus.

**Pages créées** :
- `3_plugins/3_26_hormann.md` - câblage RJ12, bus coupé hors scan, broches série inversées sur l'Atom Lite, API HTTP lue dans le firmware 1.0.2, choix du plugin (sondage, fraîcheur du bus, effet vérifié, lumière en bascule), reste à faire.

**Pages modifiées** :
- `3_plugins/README.md` - entrée du catalogue.

**Contradictions** : la demande citait le SSE `/events` ; le firmware n'y émet que capteurs et E/S, d'où le sondage de `/status`.

## [2026-10-21] update | Vue Chauffage : cartes plus larges, modes à parts égales, humidité déplacée

**Déclencheur** : « on peut peut-être les élargir un peu […] les 3 boutons chauffage/éco/arrêt prennent toute la largeur […] placer le taux d'humidité ailleurs ».

**Pages modifiées** :
- `4_ui/4_6_autres-vues.md` - section datée : `--card-min` de `RoomBands` (420 px sur la vue Chauffage), touches de mode à largeur égale, humidité au bout de la ligne de consigne, hauteur réservée à l'arrêt.

**Index** : index.md régénéré (date déjà à jour).

## [2026-10-21] update | Résumé de l'en-tête : « chauffage en marche » ; temps de marche lisible

**Déclencheur** : « on pourrait indiquer ici que le chauffage fonctionne quand c'est le cas », puis « mettre le temps de fonctionnement dans un format plus humain ».

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : `useHomeSummary.heating` (action `heating` ou `unitHeating`), mention seulement pendant la chauffe.
- `4_ui/4_6_autres-vues.md` - section datée : `formatRunTime` (min, h, puis jours et heures) pour le temps de marche de la vue Chauffage.

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-21] update | MELCloud : la zone qui chauffe n'est plus devinée, historique d'un an

**Déclencheur** : retour de la vraie maison : la zone 2 ne chauffait pas alors que la vue disait « Chauffe » sur les deux ; puis demande de garder l'historique et de pouvoir changer la durée (semaine / mois / année).

**Pages modifiées** :
- `3_plugins/3_13_mitsubishi-melcloud.md` - section datée (bis) : `action` effacée par `null` (et non omise) quand la machine chauffe sans que la zone le dise, `unitHeating` ; circulateurs « Non remonté » (seuls `OperationMode` et `DemandPercentage` bougent) ; série quotidienne de ~13 mois, points relus pondérés. Mention « dépassé » sur « les deux zones affichent Chauffe ».
- `4_ui/4_6_autres-vues.md` - section datée (bis) : pas de mot d'action inconnu, dégradé sur `action` ou `unitHeating`, pastille « Machine en chauffe », sélecteur 48 h / Semaine / Mois / Année.
- `1_architecture/1_1_contrat-appareils.md` - `climate.unitHeating`.
- `1_architecture/1_12_scene-3d-objets.md` - marqueurs `climate` qui pulsent en chauffe (vérifié par test seulement).

**Index** : catalogues mis à jour (4 lignes), index.md régénéré.

## [2026-10-21] update | Vue Chauffage : thermostat en chauffe mis en valeur, MELCloud lu chaque minute

**Déclencheur** : « le chauffage est lancé, normal de ne rien voir bouger dans la vue chauffage ? on pourrait déjà mettre en valeur la carte du thermostat non ? ensuite pourquoi les données ne sont pas refresh ? »

**Pages modifiées** :
- `3_plugins/3_13_mitsubishi-melcloud.md` - section datée : retards cumulés (machine 1 min, serveur 2 min, vue 2 min en dur), sondage à 60 s par défaut, vue au rythme de `pollMs`  ; MELCloud ne voit pas la cascade (zones « au repos » à tort) : la chauffe se lit sur `OperationMode` 2 (carte machine, zones, historique) ; `/raw` refait des appels cloud. Mention « Dépassé » sur la cadence.
- `4_ui/4_6_autres-vues.md` - section datée : prop `emphasize` de `RoomBands`, fond dégradé chaud sur la carte du thermostat qui chauffe (liseré écarté), humidité sur la ligne d'état, renvois Nest / MELCloud.

**Index** : catalogues mis à jour (2 lignes), index.md régénéré.

## [2026-10-21] update | Thermostat Nest en éco : consigne lue, modes réordonnés

**Déclencheur** : « en mode eco l'action sur la température retourne un "commande non supportée" […] on peut masquer les boutons », puis « revoir l'ordre des boutons chauffage / eco / eteint ».

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` - section datée : ordre Chauffage / Éco / Arrêt, consigne éco = borne basse arrondie au demi-degré (stockée en °F), boutons masqués à leur place, humidité sur la vue Chauffage, température extérieure absente de SDM (écartée).

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-10-20] update | Alertes des plugins en panne, et le générateur PO Token lancé par ytmusic

**Déclencheur** : « actuellement sur la vraie maison il y a plusieurs pb de plugins. je pense qu'il faudrait ajouter les alertes dans le rail etc si un pb est présent dans un plugin » (un compte Nest à relier, le PO Token absent avec `npm run start`).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : santé lue chaque minute, `error` / `needs_pairing` tout de suite, `degraded` après 5 min, pastille sur l'engrenage, lignes du panneau maison, choix écartés.
- `3_plugins/3_16_ytmusic.md` - section datée : le plugin lance `bgutil` s'il est buildé et que rien ne répond ; renvoi depuis l'étape 3 de la mise en route.
- `5_setup/5_0_installation-et-scripts.md` - `dev-pot` sort de `npm run dev` / `house`, `dev:pot` reste manuel.
- `1_architecture/1_0_monorepo-et-flux.md` - tableau des scripts racine.

**Index** : catalogues mis à jour (3 lignes), index.md régénéré.

## [2026-10-20] update | Véhicules : alerte de pneu sous-gonflé

**Déclencheur** : « la Tesla a un pneu à moins de 2,8 bar, affiché en warn dans la voiture : on devrait afficher cette alerte (rail, etc.) ».

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` - champ `tireWarning`, section datée : type `tire_low`, sévérités, seuil calculé écarté.
- `3_plugins/3_8_tesla.md` - section datée : indicateurs `tpms_soft_warning_*` / `tpms_hard_warning_*`, relevé brut de vérification, couleurs de la vue Véhicules.
- `index.md` - dates des deux pages.

Complément du même jour : le panneau de détail de la vue 3D n'avait pas les pneus ; bloc partagé `VehicleTires.vue` et icône d'alerte près du titre, ajoutés à la section datée de `3_plugins/3_8_tesla.md`.

## [2026-10-20] update | Code : commentaires, noms de tests et journaux en anglais

**Trigger** : demande de l'utilisateur, suite de la bascule de langue du dépôt public ; passe unique par workflow (9 lots), contrôlée par un garde-fou de comparaison à `HEAD`.

**Pages modified** :
- 5_setup/5_0_installation-et-scripts.md - section « les commentaires du code passent en anglais » : périmètre, ce qui reste en français, garde-fou, risque GitNexus attendu, `.git-blame-ignore-revs`
- SCHEMA.md - la langue des commentaires du code n'est plus le français

**Index** : catalogue inchangé (date déjà au 2026-10-20), index.md régénéré.

## [2026-10-20] update | Dépôt public : README, docs/ et commits en anglais

**Trigger** : demande de l'utilisateur, le dépôt étant public : garder le français, basculer en anglais, ou tout reprendre ? Retenu : vitrine (`README.md`, `docs/`) et commits en anglais, historique et wiki en français.

**Pages modified** :
- 5_setup/5_0_installation-et-scripts.md - section « langue du dépôt public » : les trois couches, `README.fr.md`, l'historique non réécrit, la passe unique envisagée pour les commentaires du code
- 3_plugins/3_2_ecrire-un-plugin.md - les conventions des pages `docs/plugins/` transposées en anglais, liste de contrôle (README et README.fr.md)
- 2_maison/2_0_format-house-json.md - titres anglais des sections de `docs/house-json.md` citées, bouton « Edit » (`place.move`)
- 1_architecture/1_7_serveur-mcp.md - section README « MCP server » (« Serveur MCP » dans `README.fr.md`)
- SCHEMA.md - la langue du wiki reste le français, celle de la vitrine et des commits l'anglais

**Index** : catalogues mis à jour (4 lignes), index.md régénéré.

## [2026-10-20] update | Vue Ouvrants : touches de pièce pour les volets

**Trigger** : demande de l'utilisateur, ouvrir / arrêter / fermer tous les volets d'une pièce en un seul appui depuis la vue Ouvrants.

**Pages modified** :
- 4_ui/4_3_vues-lumieres-ouvrants-cameras.md - section 2026-10-20 : `RoomShutterKeys.vue` dans le slot `room-action`, volets seulement (portée choisie par l'utilisateur), lot sur la position visée, Stop aux volets qui le déclarent (effet RTS non vérifié), marge négative pour que l'en-tête ne grandisse pas ; complément du même jour : Stop limité aux volets en mouvement (`motion`), grisé au repos, version précédente citée (`02c279d`), conséquence pour un RTS sans retour

**Index** : catalogue 4_ui (1 ligne, date), index.md régénéré.

## [2026-10-19] update | Vue École : visionneuse des photos

**Trigger** : demande de l'utilisateur, les photos des publications ouvraient le navigateur ; les voir dans l'app, passer de l'une à l'autre, zoomer et télécharger.

**Pages modified** :
- 4_ui/4_6_autres-vues.md - section 2026-10-19 : `PhotoViewer.vue` (barre, flèches grisées aux extrémités, clavier, glissé, zoom 1× à 6× par boutons / molette / pincement / double-clic, déplacement borné, fermeture sur le fond), téléchargement par fetch → blob et son repli, icônes `zoomIn` / `zoomOut` / `download`, limites tactiles connues
- 3_plugins/3_23_toutemonannee.md - les vignettes ouvrent la visionneuse ; images publiques servies avec `Access-Control-Allow-Origin: *`

**Index** : catalogues 3_plugins et 4_ui (1 ligne chacun, date), index.md régénéré.

## [2026-10-19] update | Alertes : la pastille tient, la liste au fond du panneau maison

**Trigger** : demande de l'utilisateur, plusieurs alertes en cours sur la vraie maison (tondeuse, distributeurs) : garder la pastille du rail tant qu'elles durent et les lister dans le panneau de résumé de la vue 3D, avec un accès à l'appareil.

**Pages modified** :
- 1_architecture/1_1_contrat-appareils.md - section 2026-10-19 : alertes `pet_feeder` / `pet_fountain` (défaut, réserve basse, consommables), robots et animaux injoignables gardant leurs alertes, champ `detail` ; renvoi daté dans la section 2026-10-02
- 4_ui/4_1_navigation-et-panneaux.md - section 2026-10-19 : plus de fermeture (« Masquer » et la croix météo retirés, `info` seule vue en ouvrant sa vue), section « Alertes » du `HomePanel` (une ligne par appareil, au fond, clic = sélection dans la 3D) ; règles de fermeture du 2026-10-02 marquées dépassées

**Index** : catalogues 1_architecture et 4_ui (1 ligne chacun ; résumé de 4_1 élargi aux alertes du panneau), index.md régénéré.

## [2026-10-19] update | Suivi de la LOA d'un véhicule

**Trigger** : demande de l'utilisateur, suivre si le kilométrage reste dans les clous du forfait de sa LOA, au prorata de la durée ; fonctionnalité codée, non commitée (HEAD 06fd524).

**Pages modified** :
- 2_maison/2_0_format-house-json.md - section 2026-10-19 : `devices[].lease` (`start`, `end`, `km`, `startKm`), règles, écriture d'un bloc, `''` efface
- 3_plugins/3_9_renault.md - section 2026-10-19 : `/contracts` (aucun contrat de financement chez Kamereon, ce que l'endpoint contient, filtre `toMileageContracts`, lecture au clic seulement, lecture quotidienne écartée, route et codes d'erreur)
- 4_ui/4_4_vues-energie-vehicules.md - section 2026-10-19 : saisie dans « Modifier », calcul au prorata (projection muette le premier mois), jauge au pied de la carte, mesures de mise en page ; section 2026-10-19 (bis) : jauge au gabarit de la batterie, graduations grises aux anniversaires (`leaseYearMarks`), repère info du maximum autorisé à ce jour (info et non warning, pour rester visible sur le dépassement orangé) ; section 2026-10-19 (ter) : la jauge passe aux blocs de la limite de charge et au repère warning de la batterie, dépassement en rouge

**Trous signalés** : le bouton « Chercher chez Renault » n'a pas été cliqué contre le vrai serveur depuis l'interface ; aucun `journal.md` de session n'existait, récit tiré du brief du fil principal et du code.

**Index** : catalogues 2_maison, 3_plugins, 4_ui (1 ligne chacun, date seule), index.md regénéré.

## [2026-10-15] update | MCP : garde-fous des automatisations écrites par l'assistant

**Trigger** : question de l'utilisateur (« faut-il des garde-fous ? »), quatre garde-fous retenus.

**Pages modified** :
- 1_architecture/1_7_serveur-mcp.md - section 2026-10-15 (2) : version d'avant, actions sensibles coupées, marque `byAssistant`, plafond de créations, elicitation écartée
- 1_architecture/1_8_automatisations.md - section 2026-10-15 (2) : marque « à relire » dans la liste et l'éditeur, ligne d'indice en `MarqueeText`

**Index** : catalogue 1_architecture et index.md inchangés (dates déjà au 2026-10-15).

## [2026-10-15] update | MCP : créer et modifier une automatisation

**Trigger** : demande de l'utilisateur, « permettre au MCP de gérer les automatisations : activation/désactivation, création, modification ».

**Pages modified** :
- 1_architecture/1_7_serveur-mcp.md - outils `create_automation` et `update_automation` (27 outils), décision du 2026-10-09 marquée renversée pour la création et la modification
- 1_architecture/1_8_automatisations.md - section du 2026-10-15, renvoi vers 1_7

**Index** : catalogue 1_architecture mis à jour (1 ligne), index.md régénéré.

## [2026-10-15] update | Automatisations : bouton « Dupliquer »

**Déclencheur** : « un bouton "dupliquer" qui copie une automatisation, navigue vers la copie désactivée
par défaut » ; le pourcentage pour lumières et ouvrants existait déjà, menu gardé tel quel.

**Pages modifiées** :
- `1_architecture/1_8_automatisations.md` - section datée : copie de la version enregistrée,
  désactivée, piège du `router-view` sans clé, bascule « % » écartée.

**Index** : catalogue `1_architecture` déjà à la date du jour, index.md régénéré.

## [2026-10-15] update | Vue Énergie : les commandes de la borne sur sa ligne, en rendu de ligne

**Déclencheur** : « il faudrait ajouter les commandes de la borne sur sa carte dans la vue énergie »,
puis la règle « si un composant [est] partagé alors il doit avoir [un] mode de rendu ».

**Pages modifiées** :
- `4_ui/4_4_vues-energie-vehicules.md` - `EvChargerCommands` (rendus `panel` / `row`), touches de
  ligne, annulation portée par la touche du mode en cours et dite sur la ligne d'état, mesures.
- `4_ui/4_1_navigation-et-panneaux.md` - règle : un contrôle partagé panneau / carte de vue a un rendu
  par contexte.

**Index** : catalogue `4_ui` (deux dates), index.md régénéré.

## [2026-10-15] update | Borne Enphase : choisir le mode (charge verte ou manuel), sur la carte et par le MCP

**Déclencheur** : « si on sait modifier le mode de la borne, pourquoi ne pas le proposer dans l'app
directement ? aussi via le MCP ? » — vert et manuel seulement, les deux éprouvés.

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` - `setMode` (un seul PUT, ou `resumeMode` pour le même mode sous
  annulation), lecture du mode toutes les dix minutes, pas d'annulation publiée en mode manuel,
  boutons de la carte, ce qui n'est pas encore vu sur la vraie borne.
- `1_architecture/1_1_contrat-appareils.md` - `manualOverride`, capacité `charge_mode`, état
  `chargeMode`, commande `ev_charger.set_mode`.

**Index** : catalogues `1_architecture` et `3_plugins` (dates), index.md régénéré.

## [2026-10-15] update | Borne Enphase : annulation manuelle visible et levée depuis la carte

**Déclencheur** : « pourquoi la R5 ne charge pas tout en gardant la borne en charge verte ? » —
borne sous annulation manuelle (`mode` 0, `SUSPENDED_EVSE`) malgré le surplus, invisible dans Kasbah.

**Pages modifiées** :
- `3_plugins/3_7_enphase.md` - constat sur la vraie maison, `manualOverride` publié dans l'état
  `ev_charger`, avertissement et bouton « Reprendre » (`ev_charger.resume_mode`) sur la carte de la
  borne, réveil de la R5 sous annulation laissé en l'état (un plugin ne voit pas les autres appareils).

**Index** : catalogue `3_plugins` (date), index.md régénéré.

## [2026-10-15] update | Automatisations : champs « Pendant » et « Depuis au moins »

**Déclencheur** : « Pendant » semblait plafonné à 60 min (60 tapé, 20 enregistré). Le plafond réel
était 1440 ; un rendu provoqué par un état d'appareil remettait l'ancienne valeur avant la validation.

**Pages modifiées** :
- `1_architecture/1_8_automatisations.md` - plage affichée et saisie ramenée à la borne ; piège des
  champs numériques de l'éditeur (Vue réécrit `value`, texte en cours de frappe gardé jusqu'au `change`).

**Index** : catalogue `1_architecture` (date), index.md régénéré.

## [2026-10-14] update | TaHoma : rafales de commandes, file ou exécution groupée

**Déclencheur** : une automatisation fermant 15 volets a laissé 6 volets ouverts (6 `TIMEOUT` sur
`exec/apply`). Cause : 15 requêtes simultanées ; une à une ou en une seule exécution, la box les prend.

**Pages modifiées** :
- `3_plugins/3_4_somfy-tahoma.md` - piège 7 : mesures sur la vraie box (une à une 868 ms, groupé
  214 ms), `TAHOMA_COMMAND_MODE` `queue` (défaut) / `batch`, fenêtre `BATCH_WINDOW_MS`, l'arrêt d'un
  volet dans un lot reste à vérifier.

**Index** : catalogue `3_plugins` mis à jour (résumé, date), index.md régénéré.

## [2026-10-14] update | Tondeuse : effacer l'erreur, reprendre le programme

**Déclencheur** : demande de l'utilisateur : lever une erreur depuis Kasbah et relancer le
fonctionnement habituel après une pause ou une erreur, sur la vue Robots puis dans le panneau 3D.

**Pages modifiées** :
- `3_plugins/3_11_husqvarna-automower.md` - sous-section du 2026-10-14 : `mower.confirm_error` →
  `POST /mowers/{id}/errors/confirm`, `errorConfirmable`, refus sans appel ; « reprendre » = `mower.start`
  sans durée (`ResumeSchedule`).
- `1_architecture/1_1_contrat-appareils.md` - capacité `confirm_error`, commande, champ d'état ; optimiste
  sans « tonte » anticipée sans durée.
- `4_ui/4_6_autres-vues.md` - lien « Effacer l'erreur » et bouton « Reprendre le programme », vue Robots
  et panneau, mesures « rien ne bouge ».
- `3_plugins/3_0_simulation-mock.md` - `mower.start` sans durée reprend le planning, `confirm_error`.

**Index** : catalogues `3_plugins`, `1_architecture`, `4_ui` mis à jour (4 lignes, dates), index.md régénéré.

## [2026-10-14] update | Brouillard météo de la scène 3D : visibilité filtrée et portée plancher

**Déclencheur** : par un matin couvert sur la vraie maison, la vue 3D était noyée dans un brouillard
gris ; la visibilité d'Open-Meteo (sortie de modèle) tombait à quelques dizaines de mètres.

**Pages modifiées** :
- `1_architecture/1_11_scene-3d-rendu.md` - sous-section du 2026-10-14 : visibilité ignorée sous ciel
  clair, peu nuageux ou couvert (`DRY_AIR`), `fogDistance` avec un plancher de 120 m, mesure avant/après.

**Index** : catalogue `1_architecture/README.md` mis à jour (1 ligne, date), index.md régénéré.

## [2026-10-13] update | Superviseur de production et mise à jour du serveur depuis Réglages

**Déclencheur** : l'utilisateur ne veut plus aller sur le serveur pour mettre à jour (pull, build,
relance de `npm start`). Choix faits avec lui : un superviseur maison plutôt que pm2 ou une tâche
périodique, un bouton dans Réglages plutôt qu'une branche `prod` (toutes les branches d'un dépôt public
sont visibles), procédures Windows et Linux décrites dans le setup.

**Pages modifiées** :
- `5_setup/5_2_production.md` - sous-section du 2026-10-13 (bis) : `scripts/supervisor.mjs`, déroulé
  d'une mise à jour et retour en arrière, prérequis (clone de production séparé du dépôt de dev),
  tâche planifiée Windows et service systemd, limites, pistes écartées, ce qui n'est pas encore éprouvé.
- `5_setup/5_0_installation-et-scripts.md` - ligne `node scripts/supervisor.mjs` dans la table « Lancer ».
- `1_architecture/1_3_protocole-rest-ws.md` - routes `/api/system/version` et `/api/system/update`.
- `1_architecture/1_13_comptes-et-sessions.md` - `LAN_ONLY` devient une liste, `/api/system` y entre.
- `4_ui/4_7_reglages.md` - la carte « Mise à jour du serveur ».

**Index** : catalogue `5_setup/README.md` mis à jour (1 ligne, périmètre de 5_2), index.md régénéré.

## [2026-10-13] update | Éditeur d'automatisations : fondu, listes filtrables, aube et crépuscule précisés

**Déclencheur** : reprise de la page d'édition demandée par l'utilisateur (saisie perdue au changement de
mode, fondu des lumières, choix multiple filtrable, lecture fautive de « après le crépuscule », boutons,
débordements sur tablette et téléphone).

**Pages modifiées** :
- `1_architecture/1_8_automatisations.md` - sous-section du 2026-10-13 : fondu (`transitionMs`, une
  commande par lampe, inverse avec le même fondu, Hue seul), mémoire par mode, aube et crépuscule
  précisés, listes filtrables, Appliquer / Enregistrer, deux pièges de mise en page en écran étroit.

**Index** : catalogue `1_architecture/README.md` mis à jour (1 ligne), index.md régénéré.

## [2026-10-13] update | Découpage de 4_1 et de 1_5, pages Comptes et sessions et Énergie

**Déclencheur** : actions du lint du jour validées par l'utilisateur : `4_1` (~116k tokens) et `1_5`
(~83k) dépassaient ce qu'une requête peut lire ; comptes et énergie étaient dispersés.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - ne garde que la navigation et les panneaux de la vue Maison
  (39 sections), avec un tableau « Où sont les vues » ; 92 Ko.
- `1_architecture/1_5_scene-3d.md` - ne garde que le socle, les interactions et les chemins de
  reconstruction (28 sections), avec un tableau des pages filles ; 82 Ko.

**Pages créées** :
- `4_ui/4_3` à `4_8` (Lumières / Ouvrants / Caméras, Énergie / Véhicules, Musique et médias, autres
  vues, Réglages, mode édition et propriétés) - 159 sections reprises de `4_1`.
- `1_architecture/1_11_scene-3d-rendu.md`, `1_12_scene-3d-objets.md` - 86 sections reprises de `1_5`.
- `1_architecture/1_13_comptes-et-sessions.md`, `1_14_energie.md` - synthèses vérifiées sur le code,
  qui renvoient aux sections datées.

Sections déplacées sans retouche, dates comprises ; vérifié que chacune des 198 + 114 sections se
retrouve dans exactement une page. Les renvois « plus haut / plus bas » d'une section déplacée peuvent
désigner une page sœur : chaque page fille le dit en tête. Les 102 renvois d'autres pages vers `4_1`
restent valides par le tableau « Où sont les vues ».

**Hors wiki** : table de correspondance de `wiki-update` mise à jour (vues, scène 3D, comptes, énergie).

**Index** : catalogues `1_architecture` et `4_ui` mis à jour (11 lignes), index.md régénéré.

## [2026-10-13] lint | Wiki health check

**Orphans found** : 0 (`wiki-index.mjs --check` vert : 50 pages cataloguées, aucun lien mort).
**Contradictions** : 1 ouverte - `5_setup/5_0` : la commande d'installation dit encore « ajuster
`KASBAH_PLUGINS` », variable supprimée (signalé seulement dans une section datée plus bas). Les six
sections « Contradiction détectée » des pages sont toutes tranchées.
**Stale pages >6 months** : 0 (wiki commencé en septembre 2026).
**Gaps** : 2 - comptes et sessions de l'UI (`http/session.ts`, `.state/users/`), dispersés entre
`1_7`, `4_1`, `5_1` ; énergie (historique, coordination de charge, vue Énergie), entre `1_1`, `1_2`,
`3_9`, `4_1`.

**À arbitrer** : `3_plugins/3_11` (section du 2026-10-12 ter) chiffre une rotation constatée sur la
vraie maison (CLAUDE.md §7), déjà relevé le 2026-10-13.
**Observations** : `4_1` (~116k tokens, 187 sections datées) et `1_5` (~83k) dépassent ce qu'une
requête peut lire ; 36 pages ne sont liées que par leur catalogue ; quelques chemins de fichiers
déplacés depuis restent cités dans des sections datées (historique, non corrigé).

**Actions taken** (validées par l'utilisateur) : commande d'installation de `5_0` corrigée, avec note
datée ; chiffre de rotation remplacé par « plusieurs degrés » dans `3_11`, `1_5` et l'entrée du journal
qui le citait (donnée réelle, CLAUDE.md §7).
**Proposed actions not executed** : découper `4_1` puis `1_5` ; pages « Comptes et sessions » et
« Énergie » (validés, à suivre).

## [2026-10-13] update | Index à deux niveaux et journal découpé par mois

**Déclencheur** : reprise des principes adoptés par un autre wiki du même type : `index.md` (150 Ko,
résumé médian de 1 600 caractères qui racontait l'historique) et `log.md` (389 Ko) étaient relus en
entier à chaque requête.

**Pages modifiées** :
- `SCHEMA.md` - sections « Index à deux niveaux » et « Journal et archives », numéro d'une nouvelle
  page lu sur le disque, pages hors index (catalogues, archives).
- `index.md` - réduit aux blocs générés par section (titres et dates), 7 Ko.
- `log.md` - mois en cours seulement ; les 217 entrées de septembre déplacées telles quelles.

**Pages créées** :
- `0_overview/README.md` … `6_faq/README.md` - catalogue de chaque section : résumés réécrits au
  périmètre de la page (350 caractères au plus, sans historique), source du bloc d'`index.md`.
- `log/2026-09.md`, `log/README.md` - archive de septembre et catalogue des archives (générés).

**Hors wiki** : `scripts/wiki-index.mjs` (génère les blocs, contrôle les catalogues),
`scripts/wiki-log.mjs` (archive les mois échus, idempotent) ; skills `wiki-query`, `wiki-update`,
`wiki-lint`, `publish` et `CLAUDE.md` / `AGENTS.md` alignés.

**Index** : régénéré en entier (`wiki-index.mjs`).

## [2026-10-13] update | Panneau de la tondeuse : erreur en clair, blocs rangés

**Déclencheur** : robot en erreur sur la vraie maison, sans le détail dans le panneau de la vue Maison ; sections du panneau éparpillées sur la hauteur.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : `mowerStatus` partagé avec la vue Robots, pastille d'activité retirée (saut de 16 px), un seul `margin-top: auto` pour les blocs repliés.

**Index** : date déjà au 2026-10-13.

## [2026-10-13] update | Mise à jour de l'application : bandeau et rechargement

**Déclencheur** : « parfois quand on clique sur un élément du rail il ne se passe rien » après une mise à jour du serveur (vue paresseuse d'un build remplacé servie en `text/html`), et la demande d'un moyen d'indiquer qu'une mise à jour est disponible.

**Pages modifiées** :
- `5_setup/5_2_production.md` - section datée : symptôme et cause, 404 sous `/assets/`, rechargement sur une vue introuvable (une fois par 10 s), `build-id.txt` / `__KASBAH_BUILD__`, bandeau et rechargement automatique après 2 min (une fois par build), emplacement du bandeau, pistes écartées (`emptyOutDir: false`, service worker).
- `1_architecture/1_3_protocole-rest-ws.md` - section datée : `appBuild` au snapshot, relu à chaque connexion ; repli SPA hors `/assets/`.

**Index** : mis à jour (2 lignes).

## [2026-10-13] update | Origine de la maison réglable : caler sur la photo

**Déclencheur** : calage de la maison sur l'orthophoto (cap et origine faux, carte du robot et GPS de l'appareil en désaccord), puis un liseré sombre autour de la carte peinte en qualité haute.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - section datée : `origin` réglable (route, `setOriginInJson`, `shiftOrigin`, `turnOrigin` et son pivot), piège de `levels[].outline` (enveloppe du toit), sens de `mapOffset` après calage, correction automatique des décalages écartée.
- `1_architecture/1_3_protocole-rest-ws.md` - section datée : `PUT /api/house/origin` (corps entier), transport et store.
- `4_ui/4_1_navigation-et-panneaux.md` - section datée : fenêtre « Caler sur la photo » (ce qu'elle trace et pourquoi, commandes, bilan sur sa ligne, rien n'est écrit avant Enregistrer).
- `3_plugins/3_11_husqvarna-automower.md` - section datée : recette du GPS garé, lecture cap / translation, pelouse comme repère, `mapOffset` remis à zéro.
- `1_architecture/1_5_scene-3d.md` - section datée : carte peinte sur `SITE_DECOR_LAYER`, cause GTAO.
- `6_faq/6_1_pieges-runtime.md` - entrée : liseré noir GTAO ; `outline` du rez-de-chaussée pris pour l'emprise.
- `6_faq/6_0_pieges-outillage.md` - section datée : le worker MapLibre absent du build (contredit l'entrée du 2026-09-14), `lib/maplibreWorker.ts`.

**Contradiction / à arbitrer** : la section du 2026-10-12 de `3_11` chiffre la rotation résiduelle constatée sur la vraie maison ; à relire au regard de la règle « pas de valeur réelle » (CLAUDE.md §7).

**Index** : mis à jour (6 lignes).

## [2026-10-12] update | Transcription : la réponse réécrite pour la voix

**Déclencheur** : « lors du TTS de la réponse à une commande, le modèle a du mal avec les abréviations comme RDC, le h de 8h00 ou les °C », puis « pouvoir facilement ajouter de nouveaux éléments à remplacer, penser au multilingue » et « reprends les shortName des étages automatiquement ».

**Pages modifiées** :
- `3_plugins/3_25_transcription.md` - section datée : `spokenText` dans `speak()`, les tables par langue (`words`, `units`, `plural`, `minus`, `hours`), la langue = `STT_LANGUAGE`, les abréviations des niveaux envoyées par l'app dans `/speak` (casse respectée, abréviation d'un seul caractère ou sans lettre écartée), ce qui a été écarté et ce qui n'a pas été joué.

**Hors wiki** : `docs/plugins/transcription.md` (prononciation, `STT_LANGUAGE`, limite).

**Index** : mis à jour (1 ligne).

## [2026-10-12] update | Tondeuse : la carte peinte dans la scène 3D, le panneau des zones fusionné

**Déclencheur** : suite de la session du jour — « afficher les zones sur la vue 3D quand on le souhaite, zone par zone », puis « fusionner les deux sections du panneau, trier les zones », et « on est certain des décalages appliqués ? ».

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - section datée : `setGroundOverlay` et `builders/groundOverlay.ts` (aplats drapés, rubans sur le relief, pas de tap, repeints au changement de terrain) ; `mapOffset` non appliqué dans la scène, et pourquoi ; rotation résiduelle de plusieurs degrés constatée sur la vraie maison, cap de la maison suspect.
- `4_ui/4_1_navigation-et-panneaux.md` - section (quinquies) : liste unique triée (`zoneRows`), interrupteur « Sur la scène », pastille-bascule par zone, `stores/sceneZones`.
- `3_plugins/3_11_husqvarna-automower.md` - section (ter) : carte en 3D, et le calage de la maison qui reste à faire.

**Index** : dates déjà au 2026-10-12 sauf `1_5_scene-3d` (mise à jour).

## [2026-10-12] update | Tondeuse : la tâche en cours, et ses zones depuis la vue Maison

**Déclencheur** : suite de la session du jour — « afficher l'ordre en cours (en direction de la zone sud, tonte de la zone avant, retour à la station) » et « lancer la tonte d'une zone depuis le panneau détail du robot dans la vue 3D ».

**Pages modifiées** :
- `3_plugins/3_11_husqvarna-automower.md` - section datée (bis) : `workAreaId` et `LEAVING` n'arrivent que par la lecture complète ; `taskFields` ; relecture sur changement d'activité (une par minute au plus) et 10 s après `StartInWorkArea` ; la zone pendant un `StartInWorkArea` n'est pas encore vérifiée sur le vrai robot.
- `1_architecture/1_1_contrat-appareils.md` - champs d'état `workAreaId` et `leaving` (pas de nouvelle valeur d'activité, et pourquoi).
- `4_ui/4_1_navigation-et-panneaux.md` - section (quater) : phrase de tâche (`mowerTask`) dans la ligne d'état de la vue Robots et sous la pastille du panneau 3D, bloc « Zones du robot » dans `DevicePanel`.
- `3_plugins/3_0_simulation-mock.md` - la tondeuse simulée publie sa zone et son départ.

**Hors wiki** : le commentaire de quota de `RobotsView.vue` (signalé à l'entrée précédente) dit désormais 21 000 requêtes par fenêtre de sept jours.

**Index** : dates déjà au 2026-10-12, inchangé.

## [2026-10-12] update | Tondeuse : zones, carte du terrain, calques ; Cast ne fait plus tomber le serveur

**Déclencheur** : session du 2026-10-12 (code non commité à l'écriture) — commander les zones d'un robot tondeuse, poser la carte de son terrain sur la photo satellite, et corriger une chute du serveur quand l'interface mDNS configurée est absente.

**Pages modifiées** :
- `3_plugins/3_11_husqvarna-automower.md` - section datée : ce que l'API permet et ne permet pas (pas de création/redessin de zone, profils), commandes `StartInWorkArea` et `PATCH stayOutZones`, capacités déduites, état `workAreas` / `stayOutZones`, cartes SVG et leur code couleur, réensauvagement = affichage seul (PATCH refusé en 400, piste fermée), cache de carte, idée « mini-zone à la volée » écartée ; « Pistes pour la suite » marquées dépassées / faites en partie (la géométrie n'est PAS dans `GET /mowers`).
- `1_architecture/1_1_contrat-appareils.md` - capacités, commandes (avec capacité requise), états et inverses d'automatisation de la tondeuse.
- `1_architecture/1_3_protocole-rest-ws.md` - route `GET /api/devices/:id/map`, forme `SiteMap`, hook de plugin `siteMap?`.
- `2_maison/2_0_format-house-json.md` - champ `devices[].mapOffset`, distinct de `gpsOffset`.
- `4_ui/4_1_navigation-et-panneaux.md` - panneau Zones, carte du terrain (ancrage, couleurs), menu des calques, décalage de carte, fraîcheur.
- `3_plugins/3_6_google-cast.md` - chute du serveur sur `EADDRNOTAVAIL` (écouteur `error` sur le socket mDNS, pause, `refresh()` qui réessaie).
- `3_plugins/3_0_simulation-mock.md` - tondeuse simulée : deux zones, une exclusion, un réensauvagement, sa carte.

**Pages créées** : aucune.

**Contradictions relevées** : aucune dans le wiki. Écart de code noté (non tranché) : le commentaire de `apps/web/src/views/RobotsView.vue` sur le quota dit encore « 10 000 requêtes par mois » alors que la page du plugin établit 21 000 par fenêtre de sept jours (2026-09-16).

**Index** : mis à jour (7 lignes).

## [2026-10-12] update | Panneau maison : les tuiles mènent à leur vue

**Déclencheur** : demande de l'utilisateur — toucher une tuile du panneau de droite (« volets ouverts », une voiture…) emmène sur la vue concernée.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée : correspondance tuile → vue, `router-link` autour de `StatTile`, survol sans décalage ; la mention « tuiles décoratives » du 2026-09-15 marquée dépassée.

**Pages créées** : aucune.

**Index** : date de `4_1` relevée.

## [2026-10-12] update | Chauffage à l'arrêt : plus de consigne, et Nest ne l'invente plus

**Déclencheur** : demande de l'utilisateur — la carte d'un thermostat arrêté affichait trois fois la même température.

**Pages modifiées** :
- `3_plugins/3_5_google-nest.md` - mise à jour datée : à l'arrêt Google publie un trait de consigne vide ; le plugin retient la dernière consigne vue hors arrêt et éco (en mémoire), l'ambiante en dernier recours.
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée : statut sans consigne à l'arrêt, touches − / + retirées, modes placés avant la consigne (vue Chauffage et panneau appareil), modes qui passent à la ligne.

**Pages créées** : aucune.

**Index** : dates de `3_5` et `4_1` relevées (2 lignes).

## [2026-10-11] update | Automatisations : ordre manuel et « pendant N minutes »

**Déclencheur** : demande de l'utilisateur — pouvoir changer l'ordre de la liste, et « ouvrir le portail pendant 20 minutes » (action inverse au bout du délai).

**Pages modifiées** :
- `1_architecture/1_8_automatisations.md` - mise à jour datée : ordre du fichier rangé par glisser-déposer, `forMin` et `inverseCommand`, retours persistés dans `.state/` et rattrapés au redémarrage.
- `1_architecture/1_3_protocole-rest-ws.md` - route `PUT /api/automation-order`.

**Pages créées** : aucune.

**Index** : date de `1_8` relevée (`1_3` déjà au 2026-10-11).

## [2026-10-11] update | Vue Robots : cartes à l'horizontale

**Déclencheur** : demande de l'utilisateur — cartes de la vue Robots en largeur sur grand écran, comme la vue Véhicules ; compteurs descendus sous la batterie à sa demande.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée (10) : groupes en `display: contents` sur téléphone, zones de grille à 720 et 1100 px, compteurs à gauche, vérifications.

**Pages créées** : aucune.

**Index** : inchangé (date de `4_1` déjà au 2026-10-11).

## [2026-10-11] update | Vue École : devoirs en grille

**Déclencheur** : demande de l'utilisateur — afficher les devoirs en grille plutôt qu'en une colonne étroite sur grand écran.

**Pages modifiées** :
- `3_plugins/3_23_toutemonannee.md` - mise à jour datée : un jour par case, `auto-fill` et garde sous 320 px, rangées à la hauteur du jour le plus chargé (maçonnerie écartée), vérifications.

**Pages créées** : aucune.

**Index** : ligne `3_23` complétée, date relevée.

## [2026-10-11] update | Liste de courses désactivable

**Déclencheur** : question de l'utilisateur — pouvoir couper la liste de courses pour qui n'en veut pas ; interrupteur dans les Réglages retenu, allumée par défaut.

**Pages modifiées** :
- `1_architecture/1_10_liste-de-courses.md` - mise à jour datée (2) : les deux voies et le choix, défaut allumé, effets de la coupure, vérifications.
- `1_architecture/1_2_serveur-et-plugins.md` - mise à jour datée : `pluginSettingsOf` et `PLUGINS_ON_BY_DEFAULT`.
- `1_architecture/1_7_serveur-mcp.md` - ajout : outils retirés quand la liste est coupée.

**Pages créées** : aucune.

**Index** : `1_2` et `1_10` complétés, date de `1_2` relevée.

## [2026-10-11] update | Liste de courses partagée (`/shopping`)

**Déclencheur** : demande de l'utilisateur d'une nouvelle vue, une liste de courses partagée par maison que chacun remplit et coche, avec des produits habituels à remettre dans le panier, une recherche, et une gestion complète par le MCP ; présentation choisie avec lui en séance.

**Pages modifiées** :
- `1_architecture/1_7_serveur-mcp.md` - six outils ajoutés au tableau (25 en tout) et mise à jour datée : ligne désignée par son nom, vérifications.
- `1_architecture/1_3_protocole-rest-ws.md` - mise à jour datée : routes `/api/shopping/*`, message `shopping`, champ `shopping` facultatif au snapshot (et pourquoi pas `.default()`).
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée (9) : entrée Courses du rail et de la barre du bas, résumé de l'écran.

**Pages créées** :
- `1_architecture/1_10_liste-de-courses.md` - nouveau concept (ni plugin ni appareil) : décisions de l'utilisateur, modèle, persistance, REST/WS, MCP, écran, vérifications et piège de mesure des transitions dans le panneau masqué.

**Index** : 1 ligne ajoutée, 2 dates relevées (`1_3`, `1_7`).

## [2026-10-11] update | Réponse de l'assistant : en-tête fixe, fondu, champ vide après la voix

**Déclencheur** : capture de l'utilisateur sur téléphone (réponse longue qui emportait l'instruction et la croix au défilement, texte dicté à effacer avant la commande suivante).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée (8) : en-tête fixe, corps qui défile avec fondu du côté qui a une suite, vue qui suit la fin, micro dès que le champ est vide.
- `3_plugins/3_25_transcription.md` - mise à jour datée : le champ reste vide après une commande vocale.

**Pages créées** : aucune.

**Index** : date de `4_1_navigation-et-panneaux` au 2026-10-11.

## [2026-10-11] update | Assistant : coût de chaque instruction dans le journal

**Déclencheur** : demande de l'utilisateur d'obtenir le coût d'une course `claude -p` et de l'afficher dans le journal de la carte Assistant.

**Pages modifiées** :
- `3_plugins/3_24_claude.md` - mise à jour datée : champs du `result` (`total_cost_usd`, `usage`, `costBasis: "list"`), ce que vaut le chiffre avec un forfait, `usageOf`.
- `1_architecture/1_9_assistant.md` - mise à jour datée : `AssistantUsage` optionnel sur le dernier mot, journal, carte (coût par ligne, total).

**Pages créées** : aucune.

**Index** : dates de `1_9_assistant` et `3_24_claude` au 2026-10-11.

## [2026-10-11] update | Voix : envoi à la fin de la phrase

**Déclencheur** : demande de l'utilisateur de ne plus appuyer sur Terminer après une instruction dictée, avec un interrupteur sur la fiche du plugin.

**Pages modifiées** :
- `3_plugins/3_25_transcription.md` - mise à jour datée : sous-item `autoSend`, détection à seuil (`lib/vad.ts`), plancher de bruit, rien entendu sans transcription, pistes écartées, limites.

**Pages créées** : aucune.

**Index** : date de `3_25_transcription` au 2026-10-11.

## [2026-10-10] update | Barre de navigation du bas : plus haute, chevrons de défilement ; keydown sans touche

**Déclencheur** : sur un vrai téléphone, le glissement dans la barre du bas était pris par le système (doigt trop bas), et rien ne disait qu'elle défilait ; erreur `toLowerCase` à la palette sur un `keydown` du remplissage automatique.

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée (7) : barre 72 px à 14 px du bord, fondu et chevron du seul côté qui a une suite (`inert`), garde des raccourcis globaux.

**Pages créées** : aucune.

**Index** : inchangé (`4_1` déjà au 2026-10-10).

## [2026-10-10] update | Vue Maison sur téléphone, réponse de l'assistant refermable et réécoutable

**Déclencheur** : retours de l'utilisateur sur un vrai téléphone (recherche trop étroite, réponse qui masquait la météo, feuille du bas sans geste de fermeture, « Rien entendu » brutal, clavier qui montait au micro) et sur toutes les versions (réécouter une réponse sans refaire la synthèse, fermer une réponse en vidant le champ).

**Pages modifiées** :
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée (6) : recherche pleine largeur, météo et vue d'ensemble sous les niveaux, poignée de la feuille, croix et Échap qui vident le champ, focus rendu au micro.
- `3_plugins/3_25_transcription.md` - mise à jour datée : « rien entendu » dans le champ, réécoute et cache de l'audio.

**Pages créées** : aucune.

**Index** : date de `3_25_transcription` au 2026-10-10.

## [2026-10-10] update | Voile de la vue 3D : l'animation complète une seule fois

**Déclencheur** : sur le téléphone, chaque relance de l'app (et chaque rechargement dans un navigateur) faisait patienter plus de 5 s devant le voile, à cause des minimums d'animation et non du calcul.

**Pages modifiées** :
- `1_architecture/1_5_scene-3d.md` - mise à jour datée : minimums du voile tenus la première fois seulement (`kasbah.sceneLoaderSeen`) ; la section du 2026-09-25 est annotée « dépassé ».

**Pages créées** : aucune.

**Index** : date de `1_5_scene-3d` au 2026-10-10.

## [2026-10-10] update | Renommer la propriété et un niveau, recherche d'adresse dans le monde, bascule depuis la démo

**Déclencheur** : trois limites relevées en fin de lot C, que l'utilisateur veut lever.

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - mise à jour datée : `propertyName` et `levels` dans le patch de structure.
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée : champs de nom dans « Pièces et niveaux », géocodage IGN + Photon.
- `1_architecture/1_3_protocole-rest-ws.md` - mise à jour datée : `select` vise une propriété de n'importe quel mode (correctif « unknown property » à la création depuis la démo).

**Pages créées** : aucune.

**Index** : inchangé (dates déjà au 2026-10-10).

## [2026-10-10] update | Lot C : catalogue de propriétés, interrupteur démo / réel

**Déclencheur** : l'utilisateur veut passer du mode démo au mode réel et revenir quand il veut, sans
dépendre de `KASBAH_HOUSE_FILE` (gardée en forçage facultatif) ; une seule propriété vivante à la
fois, le vrai multi-propriétés remis à plus tard. Lot C, non commité à l'écriture.

**Pages modifiées** :
- `1_architecture/1_2_serveur-et-plugins.md` - `PropertyCatalog`, deux modes, propriété retenue par mode, `property-mode.json`, forçage ; reste à faire (état et clés par propriété, migration non faite). Remplace la lecture « sans `KASBAH_HOUSE_FILE` = démonstration ».
- `1_architecture/1_3_protocole-rest-ws.md` - `POST /api/properties/mode`, `mode?` / `realAvailable?`, liste limitée au mode courant.
- `4_ui/4_1_navigation-et-panneaux.md` - `ModeSwitch.vue`, confirmation sur ligne réservée, `hasMenu`, groupes du sélecteur retirés.
- `5_setup/5_1_configuration-env.md` - `KASBAH_HOUSE_FILE` devient un forçage, nouveau fichier d'état.
- `5_setup/5_0_installation-et-scripts.md` - renvoi : la démonstration n'est plus « sans `KASBAH_HOUSE_FILE` ».

**Contradictions** : aucune entre code et wiki ; les descriptions du 2026-10-08 et du lot B sont marquées remplacées, non effacées. `2_maison/2_0_format-house-json.md` (sélection d'une autre maison) et `5_setup/5_2_production.md` citent encore `KASBAH_HOUSE_FILE` comme moyen de choisir la maison : toujours vrai en forçage, non retouchées.

**Index** : updated (5 lines).

## [2026-10-10] update | Lot B : créer une propriété, démos en lecture seule, duplication, guide

**Déclencheur** : le dépôt est public ; une installation fraîche doit pouvoir créer sa maison (par
défaut en mode démo). Lot B, non commité à l'écriture : propriétés locales, démos non modifiables et
dupliquables, assistant de création, guide de premier lancement. Complète aussi le lot A (corrections
de la relecture UI, commit 000d5f8).

**Pages modifiées** :
- `1_architecture/1_2_serveur-et-plugins.md` - `house/properties/`, liste locales + démos, lecture
  seule (`ReadOnlyHouseError`), création / duplication ; la limite du 2026-10-08 (« une édition en démo
  réécrit le fichier versionné ») est notée comme remplacée.
- `1_architecture/1_3_protocole-rest-ws.md` - deux routes POST, `demo?` / `canCreate?`, 409 `DEMO_READONLY`.
- `2_maison/2_0_format-house-json.md` - maison neuve (`newHouseJson`), `meta.kind`, `propertyIdFor`.
- `4_ui/4_1_navigation-et-panneaux.md` - sélecteur, assistant, carte de pose, guide, Réglages ; mise à
  jour séparée pour les corrections du lot A.
- `5_setup/5_1_configuration-env.md` - dossier `house/properties/`, mode démo.

**Pages créées** : aucune.

**Contradiction** : la mise à jour du 2026-10-08 de `1_2` dit qu'en démo l'édition réécrit
`house/demos/<id>.json` ; le code le refuse désormais (409). Ancien texte conservé, nouvelle
mise à jour qui le remplace.

**Index** : mis à jour (5 lignes).

## [2026-10-10] update | Lot A : pièces et niveaux qui naissent ou disparaissent en mode édition

**Déclencheur** : le dépôt public doit permettre de créer une maison depuis une installation neuve ;
préalable demandé par l'utilisateur : ajouter et retirer des pièces et des niveaux depuis le mode
édition, avant l'assistant de création (lot B).

**Pages modifiées** :
- `2_maison/2_0_format-house-json.md` - mise à jour datée : patch de structure (`structure.ts`),
  ordre d'application, règles d'élévation, du toit qui suit et du retrait, gestes `roomAgainstWall` /
  `rectRoomAt`.
- `4_ui/4_1_navigation-et-panneaux.md` - mise à jour datée : section « Pièces et niveaux », identité
  et retrait d'une pièce, bouton de l'onglet Dimensions, pose au tap, relief dans « Mode édition ».

**Pages créées** : aucune.

**Index** : mis à jour (2 lignes).

## [2026-10-10] update | Serveur de dev : `node --watch` remplacé par un watcher maison

**Déclencheur** : « lors du démarrage du serveur avec `npm run dev` on voit de multiples
`Restarting src/main.ts` ». Cause trouvée : sous Windows, libuv remonte l'heure de dernier accès NTFS
comme un `change`, et le serveur relit ses modules au démarrage. Recherches documentées avec les
issues qui confirment le mécanisme.

**Pages modifiées** :
- `6_faq/6_0_pieges-outillage.md` - entrée du 2026-10-10 (symptôme, diagnostic, sondes, issues
  codegraph#1451, ttsc#1719, nodejs/node#21643, nodemon#1208, solution) ; notes datées dans les
  entrées du 2026-09-23 (dépassée) et du 2026-10-01 (complément).
- `1_architecture/1_0_monorepo-et-flux.md` - mise à jour datée : `scripts/dev-server.mjs`.
- `5_setup/5_0_installation-et-scripts.md` - renvoi daté sous le tableau des scripts.

**Pages créées** : aucune.

**Index** : mis à jour (3 lignes).

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

<!-- log-nav:begin (généré par scripts/wiki-log.mjs, ne pas éditer) -->
> Fin du mois en cours. Entrées plus anciennes : [log/2026-09.md](log/2026-09.md) - catalogue : [log/README.md](log/README.md).
<!-- log-nav:end -->
