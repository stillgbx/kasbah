# Journal du wiki

Entrées les plus récentes en haut. Une session = une entrée.

<!-- log-nav:begin (généré par scripts/wiki-log.mjs, ne pas éditer) -->
> **Mois en cours uniquement** (2026-11). Les mois précédents sont archivés dans [log/](log/README.md) par `scripts/wiki-log.mjs` : 401 entrées, de 2026-09 à 2026-10, une archive par mois.
> Pour remonter plus loin : chercher (`Grep`) un nom de page, un fichier ou un mot-clé dans `log/`, plutôt que lire les archives ; la date de mise à jour d'une page donne le mois à ouvrir. Mois précédent : [log/2026-10.md](log/2026-10.md).
<!-- log-nav:end -->

## [2026-11-12] update | Android Auto 0.11 : retours du premier essai en voiture

**Déclencheur** : retours de l'utilisateur après l'essai de la 0.10 dans sa voiture (boutons de Parler qui bougent, page Maison, saut de l'accueil, triangles du téléphone), puis « Oui, livre ».

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - section datée « version 0.11 » : message de Parler tenu à deux lignes, page Maison en grille avec les comptes (ouvrants ouverts, lecteurs, robots dehors) et pourquoi pas une liste, accueil redessiné seulement si les données changent, ▼ dessiné en ▲ retourné dans le texte d'aide, piège du DHU (debug retirée du lanceur à la réinstallation)

**Index** : catalogue inchangé (date déjà du jour), index.md régénéré.

## [2026-11-12] update | Android Auto : accueil à onglets, lumières, ouvrants, caméras

**Déclencheur** : question de l'utilisateur (plein écran dans Android Auto, autres modèles possibles), puis maquettes, essais dans le DHU sur la démonstration et sur la vraie maison, et ses choix d'onglets, d'icônes et d'ordre.

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - section datée : `TabTemplate` (Accueil avec tuiles Voiture, Maison, Caméras ; Lumières avec scènes par pièce et interrupteurs ; Ouvrants ; Parler qui écoute à l'ouverture), ordre des pièces de la maison, photos de caméra en lecture seule datées, « Tout lire », pièges (quatre onglets au plus, barre d'actions masquée dans un onglet, DHU = hôte du téléphone), version 0.10

**Index** : catalogue 1_architecture mis à jour (date), index.md régénéré.

## [2026-11-12] update | Scène 3D : pluie et neige sur l'objectif

**Déclencheur** : demande de l'utilisateur (gouttes et flocons sur l'écran de la vue 3D, comme si elle était filmée dehors, discret), puis quatre retours sur le rendu.

**Pages modifiées** :
- `1_architecture/1_11_scene-3d-rendu.md` - section datée : les essais écartés (calque CSS), la passe de réfraction GLSL/TSL, la carte d'eau simulée par le CPU et floutée, la gravité, l'adhérence du verre, la neige, le branchement et le piège WebGPU de la carte retournée
- `4_ui/4_7_reglages.md` - section datée : carte « Pluie et neige sur l'objectif » de l'onglet Scène 3D, allumée par défaut

**Index** : catalogues 1_architecture (résumé et date) et 4_ui (date) mis à jour, index.md régénéré.

## [2026-11-12] update | Musique : une source coupée en cours de fichier est rouverte

**Déclencheur** : demande de l'utilisateur (« assez souvent des arrêts de lecture », mix Mixcloud sur une barre de son ou sur le PC, à relancer à la main).

**Pages modifiées** :
- `1_architecture/1_6_lecteur-musique.md` - section datée : cause (réponse terminée en deçà du `content-length`, lecteur bloqué), reprise de la source par plage, abandon par `destroy`, piège `Readable.fromWeb`, relance du navigateur à chaque coupure, tests et contrôle négatif, ce qui n'est pas couvert
- `3_plugins/3_20_mixcloud.md` - section datée : renvoi vers 1_6

**Index** : catalogues 1_architecture et 3_plugins mis à jour (dates), index.md régénéré.

## [2026-11-11] update | Maison : `npm run check:house` sans démarrer le serveur

**Déclencheur** : issue « idée du jour » #6 (une maison invalide n'était signalée qu'en empêchant le serveur de démarrer).

**Pages modifiées** :
- `5_setup/5_0_installation-et-scripts.md` - section datée : commande, chemin par défaut et `INIT_CWD`, codes de sortie, ce qu'elle ne fait pas

**Index** : catalogue 5_setup mis à jour (résumé et date), index.md régénéré.

## [2026-11-11] update | Liste de courses : oublier un produit de la mémoire

**Déclencheur** : issue « idée du jour » #2 (un nom mal tapé restait proposé par la recherche pour toujours).

**Pages modifiées** :
- `1_architecture/1_10_liste-de-courses.md` - section datée : bouton « Oublier » sur les propositions, règle « pas tant qu'il a une ligne », opération pure, route, store optimiste ; renvoi posé sur l'« Écarté en v1 » et ligne au tableau des routes
- `1_architecture/1_3_protocole-rest-ws.md` - section datée : `DELETE /api/shopping/products/:id` (404 / 409 `IN_LIST`)

**Index** : catalogue 1_architecture mis à jour (2 lignes), index.md régénéré.

## [2026-11-11] update | Un téléphone Android sans accès au réseau local depuis Chrome

**Déclencheur** : signalé par l'utilisateur (sur un seul téléphone de la maison, en Wi-Fi, « too many retries » ou « Serveur injoignable », rien dans les logs du serveur ; marche partout ailleurs et en 5G) ; diagnostic depuis le téléphone, aucun code touché.

**Pages modifiées** :
- `6_faq/6_1_pieges-runtime.md` - entrée du 2026-11-11 : DNS correct (adresse locale du NAS), aucune page du réseau local joignable dans Chrome, Firefox passe après la demande d'Android ; cause = autorisation d'accès au réseau local refusée à Chrome ; ordre de diagnostic
- `5_setup/5_2_production.md` - « Pièges vus » de l'étape 0 : renvoi vers cette entrée

**Index** : catalogues 6_faq (résumé élargi) et 5_setup (date) mis à jour, index.md régénéré.

## [2026-11-10] update | Automatisations : le dernier passage survit au redémarrage

**Déclencheur** : issue #1 (idée du jour), `lastRun` perdu à chaque redémarrage du serveur.

**Pages modifiées** :
- `1_architecture/1_8_automatisations.md` - section datée (3) : `.state/automation-runs.json`, relu au démarrage pour les règles présentes, réécrit à chaque passage et suppression ; renvois posés sur « Statut » et sur la limite « ne survivent pas à un redémarrage »

**Index** : catalogue inchangé (date déjà au 2026-11-10).

## [2026-11-10] update | Déclencheur « Sonnette » et notification native de la sonnette

**Déclencheur** : brief de session « déclencheur d'automatisation événement (sonnette) », plus la remarque de l'utilisateur qu'aucune notification n'arrive aujourd'hui quand on sonne ; il a choisi une notification native côté serveur (pas dans le plugin Nest), dans le même lot.

**Pages modifiées** :
- `1_architecture/1_8_automatisations.md` - section datée : schéma `event`, moteur (`onEvent`, `cooldownMin` en mémoire, pas de délai après un run `skipped`), santé, MCP, éditeur (segment « Sonnette », libellé serré à 1024 px), liste, démo navigateur, tests ; renvois posés sur « Graines de l'itération 2 » et « Limites connues »
- `1_architecture/1_8_automatisations.md` - seconde section datée : action `flash` (le serveur fait clignoter les lumières puis les remet ; choix de l'utilisateur : par le serveur, en action d'automatisation ; bouton « Essayer » 5 s au plus)
- `1_architecture/1_16_notifications-push.md` - section datée : `AlertNotifier` écoute `deviceEvent`, catégorie `cameras`, tag par sonnette, droit `cameras`, écrans déjà abonnés à cocher

**Index** : catalogue 1_architecture mis à jour (2 lignes, résumés élargis à la sonnette), index.md régénéré.

## [2026-11-10] update | Routes d'un plugin qui ne tourne pas : 503 dans l'hôte

**Déclencheur** : brief de session « refuser proprement les routes d'un plugin non démarré » (un 500 sur `ctx!` nul, des gardes recopiées plugin par plugin, et la limite Open-Meteo « après `stop()` »). Trois décisions de l'utilisateur : « démarré » = `slot.ctx` non nul, aucune exemption par route, 503 partout.

**Pages modifiées** :
- `1_architecture/1_2_serveur-et-plugins.md` - section datée : crochet `onRequest` de `registerRoutes`, sens de « tourne », audit des routes (aucune ne servait plugin jamais démarré, cartes d'appairage affichées plugin coché seulement), gardes locales alignées, tests ; renvoi posé sur l'ancienne affirmation « on appaire avant d'allumer »
- `3_plugins/3_2_ecrire-un-plugin.md` - liste de contrôle : renvoi sur la garde de l'hôte
- `3_plugins/3_10_open-meteo.md` - section datée : limite « après `stop()` » levée, 409 → 503
- `1_architecture/1_7_serveur-mcp.md` - note : message rendu à l'agent par les outils appuyés sur une route de plugin

**Index** : catalogues mis à jour (4 lignes), index.md régénéré.

## [2026-11-10] update | Android Auto 0.9 : alerte d'approche qui dit ses échecs, journal des approches

**Déclencheur** : retour de l'utilisateur, plus d'alerte à l'approche de la maison depuis la dernière version ; cause non établie (téléphone lu par `adb` : géorepérage, permissions, canal et session en ordre, aucune trace du trajet).

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - section datée : ce qui a été lu sur le téléphone, les trois issues muettes de `arrive`, l'échec de lecture dit sur l'écran de la voiture, le journal des approches (`journal`, `note`, « Dernières approches »), l'ouverture de l'appli qui repose le géorepérage, l'hypothèse de l'entrée détectée tard, `MSYS_NO_PATHCONV`

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-11-10] update | Scène 3D : lampes sautées avant calcul, lampes de jardin tenues dehors

**Déclencheur** : audit de la partie 3D demandé par l'utilisateur (optimisations, corrections, changement d'approche éventuel) ; trois correctifs retenus et appliqués.

**Pages modifiées** :
- `1_architecture/1_11_scene-3d-rendu.md` - section datée : coût d'une lampe même éteinte (0,15 ms GPU, mesures avant/après), ombres de `PointLight` absentes en VSM sous three r187 et confinement par `userData.indoor`, capture d'ombres réservée aux lampes de jardin, pistes non prises (PCF, `antialias`, AO demi-résolution), piège de banc ; renvoi posé sur la section « nonies » du 2026-09-15 ; puis section (bis), sur retour de l'utilisateur : ombres en `PCFShadowMap` pour rendre son ombre à la lampe de jardin (elle entre de nouveau par les vitres), confinement `userData.indoor` retiré, comparaison PCF / VSM mesurée, piège de la bascule à chaud ; section VSM du 2026-09-12 marquée dépassée pour le mode

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-11-09] update | iOS : « Demander » s'installe comme une app à part

**Déclencheur** : question de l'utilisateur, iOS n'offre pas le raccourci « Demander » de l'app installée (appui long sur Android) ; le serveur sert `/ask` avec son propre manifest pour qu'on l'ajoute à l'écran d'accueil.

**Pages modifiées** :
- `5_setup/5_2_production.md` - section datée : `manifest.ask{,.en}.webmanifest` (`id`/`start_url` `./ask`), `/ask` servie avec ce manifest, l'icône iOS et `apple-mobile-web-app-title`, ouvert sans session, prod seulement, piste du routeur écartée, ce qui n'est pas vérifié
- `1_architecture/1_13_comptes-et-sessions.md` - complément : `/manifest.ask.webmanifest` ouvert sans session (`MANIFESTS`)

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-11-09] update | Comptes : rôles et droits dès la création

**Déclencheur** : demande de l'utilisateur, un compte créé depuis l'app avait tous les droits et ne se réglait qu'en deuxième étape ; le formulaire propose rôles et droits, six droits par défaut.

**Pages modifiées** :
- `4_ui/4_7_reglages.md` - section datée : bloc rôles + droits dans « Ajouter un compte », six droits par défaut, mode « changer » figé à même emprise
- `1_architecture/1_13_comptes-et-sessions.md` - section datée : `saveUser` et `PUT /api/mcp/users/:name` prennent `rights`, `admin`, `house` pour un compte neuf, en une écriture
- `1_architecture/1_3_protocole-rest-ws.md` - section datée : nouveau corps de `PUT /api/mcp/users/:name`

**Index** : catalogues mis à jour (3 lignes), index.md régénéré.

## [2026-11-09] update | Cast : la lecture attend la sortie de veille

**Déclencheur** : la musique ne part pas sur un Cast en veille (barre de son), le `LAUNCH` expirait à 5 s ; délai propre au `LAUNCH` et méthode `commandTimeoutMs` du contrat.

**Pages modifiées** :
- `3_plugins/3_6_google-cast.md` - section datée : `LAUNCH_TIMEOUT_MS` à 30 s, 35 s demandées à l'hôte pour `play_url` seul, test du récepteur endormi, pas encore essayé sur la vraie barre
- `3_plugins/3_2_ecrire-un-plugin.md` - section datée : `commandTimeoutMs?(command)`, le plus grand des deux délais, à réserver aux appareils réellement lents

**Index** : catalogue mis à jour (2 lignes), index.md régénéré.

## [2026-11-08] update | Réponse parlée refusée sur iOS

**Déclencheur** : bandeau « Réponse parlée impossible » (NotAllowedError) sur iPhone et iPad après une dictée ; correctif dans `useVoiceInput.ts`.

**Pages modifiées** :
- `3_plugins/3_25_transcription.md` - section datée : un seul `<audio>` réutilisé, amorcé par un WAV vide dans le toucher, fin du son vide ignorée, non joué sur iOS

**Index** : catalogue mis à jour (1 ligne), index.md régénéré.

## [2026-11-08] update | Connexion pour tout le monde : fin de la confiance au réseau local

**Déclencheur** : décision de l'utilisateur après constat qu'un invité sur le Wi-Fi avait plus de pouvoir que n'importe quel compte (le réseau local était « la maison », sans compte, avec tous les droits) ; changement de sécurité livré le jour même, non commité.

**Pages modifiées** :
- `1_architecture/1_13_comptes-et-sessions.md` - bandeau « Dépassé le 2026-11-08 » sur le principe « le nom d'hôte décide » ; nouvelle section datée : rôles `admin` / `house`, barrière pour tous les hôtes (machine, nom public, `lanGate`), `req.account` contre `req.sessionUser`, `settings` fusionné dans admin, `ADMIN_PATHS` + `LAN_ONLY`, écarté, restes ouverts
- `1_architecture/1_7_serveur-mcp.md` - script `mcp-user` renommé `account`, chemins MCP et `app.inject` face à la barrière
- `1_architecture/1_3_protocole-rest-ws.md` - `GET /api/session` (`admin`, `house`), route des rôles, 409 `LAST_ADMIN`
- `1_architecture/1_9_assistant.md`, `1_architecture/1_16_notifications-push.md` - acteur = `req.account`, alertes aux admins, abonnements sans compte
- `3_plugins/3_16_ytmusic.md` - repli sur le cookie du compte de la maison, `houseFallback`, actions personnelles exclues
- `4_ui/4_7_reglages.md` - Réglages sur `session.admin`, carte Comptes (rôles)
- `5_setup/5_0_installation-et-scripts.md`, `5_setup/5_1_configuration-env.md`, `5_setup/5_2_production.md` - script `account`, `MCP_PUBLIC_URL` seule porte, procédure « étape 0 » (HTTPS en local par DNS local + proxy) avec ses pièges, ordre de mise en service
- `0_overview/0_0_vision-et-principes.md` - principe du réseau local de confiance abandonné
- `1_architecture/1_13_comptes-et-sessions.md`, `5_setup/5_2_production.md` - `X-Forwarded-For` du vrai proxy vérifié (point ouvert depuis le 2026-10-24, levé)
- `1_architecture/1_15_appli-android-auto.md` - connexion par l'adresse publique seulement (`signsInThere`), cas sans cookie gardé pour `localhost` (`adb reverse`), version 0.8

**Contradictions relevées** : les sections datées antérieures de 1_13, 1_7, 5_2, 4_7, 1_9, 1_16 décrivent encore « réseau local de confiance » et `mcp-user` ; conservées, signalées par des mentions « dépassé » ou « d'avant », non réécrites.

**Trous** : `X-Forwarded-For` du vrai proxy non vérifié (critique) ; vraie connexion par l'adresse publique non jouée ; appli Android (1_15) à adapter, non touchée.

**Index** : catalogues 0_overview, 1_architecture (résumé de 1_13 retouché : périmètre changé), 3_plugins, 4_ui, 5_setup mis à jour, index.md régénéré.

## [2026-11-08] update | Android Auto 0.7 : bouton de l'alerte, « Rien entendu », écran de transcription

**Déclencheur** : retours de l'utilisateur en voiture — le bouton « Ouvrir le portail » de l'alerte échoue parfois (hôte injoignable), « Rien entendu » fréquent, « Je vous écoute… » affiché pendant la transcription.

**Pages modifiées** :
- `1_architecture/1_15_appli-android-auto.md` - section « Mise à jour 2026-11-08 » : réseau coupé à l'appli en arrière-plan et tâche prioritaire `OpenJob`, mesure du niveau par 50 ms (`Listening`), deux messages dits à voix haute, écran « je transcris ». Tests et lint verts, pas encore essayé en voiture.

**Index** : catalogue 1_architecture (résumé et date de 1_15), index.md régénéré.

## [2026-11-08] update | Réglages : Scène 3D en petites cartes, plugins en cartes

**Déclencheur** : retour de l'utilisateur sur les onglets — Thème et Plein écran à échanger, Scène 3D aux segmentés trop larges, plugins en cartes dépliables, mise à jour du serveur en tête de Système.

**Pages modifiées** :
- `4_ui/4_7_reglages.md` - section « (bis) » : nouvelles piles d'Affichage, ordre de Système, Scène 3D en petites cartes (colonnes CSS), plugins en cartes avec panneau sous la rangée (deux racines + grille `dense`).

**Index** : catalogue déjà à la date du jour, index.md inchangé.

## [2026-11-08] update | Réglages en cinq onglets

**Déclencheur** : demande de l'utilisateur — la page des Réglages « commence à être chargée », la réorganiser en sections, avec des onglets.

**Pages modifiées** :
- `4_ui/4_7_reglages.md` - section « la vue Réglages en cinq onglets » : répartition des cartes, onglet dans `?tab=`, liens « Ouvrir les réglages » vers Plugins, onglet Maison absent sans le droit `settings`, `v-if` par onglet, piles en requête de conteneur à 760 px, libellés courts au téléphone.

**Index** : catalogue 4_ui mis à jour (1 ligne), index.md régénéré.

## [2026-11-08] update | Scène 3D : WebGPU absent d'une page HTTP, Réglages le dit

**Déclencheur** : capture de l'utilisateur — Réglages affirme que le navigateur n'a pas WebGPU, alors que `chrome://gpu` le donne accéléré.

**Pages modifiées** :
- `1_architecture/1_11_scene-3d-rendu.md` - « Deux moteurs de rendu » : piège du contexte sécurisé (`navigator.gpu` absent en HTTP sur le réseau local), nouveau message `render.rendererInsecure`.

**Index** : catalogue déjà à la date du jour, index.md inchangé.

## [2026-11-08] update | Réglages : changer de moteur de rendu recharge sur la vue Maison

**Déclencheur** : demande de l'utilisateur — au changement de moteur, aller directement sur la vue 3D plutôt que recharger la page des Réglages.

**Pages modifiées** :
- `1_architecture/1_11_scene-3d-rendu.md` - phrase complétée dans « Deux moteurs de rendu » : le rechargement se fait sur la vue Maison.
- `4_ui/4_2_theme-et-langues.md` - ligne `kasbah.sceneRenderer` complétée de même.

**Index** : catalogue 4_ui mis à jour (1 ligne), index.md régénéré.

## [2026-11-08] update | Scène 3D : en WebGPU, la maison se construit de nouveau sous le voile

**Déclencheur** : constat de l'utilisateur — depuis les deux moteurs, le voile de chargement revient à chaque fois, se fige, et la 3D l'interrompt parfois.

**Pages modifiées** :
- `1_architecture/1_11_scene-3d-rendu.md` - mise à jour 2026-11-08 : `shadersReady` lisait `renderer.properties`, absent de `WebGPURenderer`, et l'erreur avalée faisait partir le voile avant la première image ; `prepare` attend désormais `init()` et rend la première image sous le voile. Renvoi ajouté au paragraphe « À-coup au premier usage ».

**Index** : catalogue 1_architecture mis à jour (1 ligne), index.md régénéré.

**Non mesuré** : la fluidité image par image après le chargement (volet de la preview masqué).

## [2026-11-07] update | Hue : l'état d'avant rendu en passant par « éteint », trame noire avant la fermeture

**Déclencheur** : constat de l'utilisateur — au changement de pièce, l'ancienne zone ne reprend pas son état d'avant.

**Pages modifiées** :
- `3_plugins/3_1_philips-hue.md` - mise à jour 2026-11-07 (fin d'après-midi) : remise ignorée quand elle vaut l'état que CLIP croit en place ; `on: false` d'abord pour une lampe allumée, trame noire avant la fermeture.

**Index** : catalogue déjà à la date du jour, index.md régénéré.

**Non vérifié** : la vraie maison (changement de pièce, désactivation, lampe éteinte avant la synchro).

## [2026-11-07] update | Hue : la poignée de main DTLS renvoyée comme Hue Sync, le flux se referme de nouveau en pause

**Déclencheur** : question de l'utilisateur — l'appli officielle Hue Sync n'a pas de coupure, comment fait-elle ?

**Pages modifiées** :
- `3_plugins/3_1_philips-hue.md` - mise à jour 2026-11-07 (soir) : Hue Sync = `huestream` sur mbedTLS, qui renvoie les vols ; le pont ignore le premier `ClientHello` à cookie après un flux et répond au renvoi ; `retransmitHandshake` ; piège de la fenêtre anti-rejeu ; CLIP rapporte l'état d'avant pendant et après un flux.
- `1_architecture/1_6_lecteur-musique.md` - mise à jour 2026-11-07 (soir) : fermeture après 5 s de pause et extinction de retour (choix de l'utilisateur) ; la section « flux reste ouvert » datée.

**Contradictions** : la conclusion « quoi que fasse le client » de la section 2026-11-07 (suite) de 3_1 est datée ; la contradiction du 2026-11-07 sur l'arrêt du flux reçoit une explication possible (sonde lue par CLIP), à confirmer sur place.

**Index** : catalogues déjà à la date du jour, index.md régénéré.

**Non vérifié** : la synchro complète sur la vraie maison (aspect des lampes à la fermeture, rallumage à la reprise).

## [2026-11-07] update | Lumières en rythme : le pont refuse un nouveau flux après le précédent, le flux reste ouvert

**Déclencheur** : constat de l'utilisateur après la mise en service (« on a toujours les pbs de connexion »), DTLS en échec pendant plusieurs minutes ; cause recherchée sur le vrai pont.

**Pages modifiées** :
- `3_plugins/3_1_philips-hue.md` - mise à jour 2026-11-07 (suite) : trace d'une poignée de main saine, refus de 15 s à 3 min après n'importe quelle fin de flux (pistes écartées : `close_notify`, trames, rythme des essais, même port, zone laissée active), message d'échec explicite, `switchOff` retiré.
- `1_architecture/1_6_lecteur-musique.md` - mise à jour 2026-11-07 (suite) : le flux ne se ferme plus pendant une pause (choix de l'utilisateur), noir tenu par le keepalive ; puces de la section précédente datées.

**Contradictions** : la mise à jour 2026-11-06 (soir) de 3_1 (« fermer puis rouvrir aussitôt marche ») n'est plus vraie ; notée, l'ancienne gardée. La contradiction du 2026-11-07 sur l'arrêt du flux n'a plus d'effet sur le code.

**Index** : catalogues déjà à la date du jour, index.md régénéré.

**Non vérifié** : la vraie maison avec ce code.

## [2026-11-07] update | Lumières en rythme : fondu à l'arrêt du son, état des lampes rendu à la désactivation

**Déclencheur** : demande de l'utilisateur (à l'arrêt de l'écoute les lampes semblent rester dans leur dernier état ; synchro active sans son → fondu jusqu'à l'extinction ; synchro désactivée → état d'avant la synchro).

**Pages modifiées** :
- `1_architecture/1_6_lecteur-musique.md` - mise à jour 2026-11-07 : fondu de 3 s, extinction à la fermeture après 5 s de pause, instantané avant le premier flux rendu à la désactivation, au passage à une autre enceinte et à l'arrêt du serveur ; `LightStreamer` gagne `saveLights` / `restoreLights` / `switchOff`.
- `3_plugins/3_1_philips-hue.md` - mise à jour 2026-11-07 : les trois gestes côté Hue (`restoreBody`, relecture des lampes au pont), limite d'une lampe éteinte ; section « Contradiction détectée ».

**Contradictions** : la section du 2026-11-05 de 3_1 dit que le pont rend seul l'état d'avant à `stop` (sonde) ; le constat de l'utilisateur dit l'inverse. Les deux versions sont gardées, à trancher sur la vraie maison (publié sans essai, sur décision de l'utilisateur).

**Index** : catalogues 1_architecture et 3_plugins (1 ligne chacun), index.md régénéré.

**Non vérifié** : la vraie lampe (rallumage par le flux après une extinction, éclat possible entre la fermeture et l'extinction).

## [2026-11-06] update | Lumières en rythme : Vague par défaut, ambiance adoucie, zones qui débordent acceptées

**Déclencheur** : retours de l'utilisateur sur le panneau : Vague en premier choix, ambiance trop agressive aux deux bouts, des pièces absentes du choix, barre de défilement alors que tout est affiché.

**Pages modified** :
- 1_architecture/1_6_lecteur-musique.md - section datée : Vague par défaut et en tête, attaque progressive de l'enveloppe, bornes de l'ambiance resserrées par effet, strobo plafonné à ~3 éclairs/s
- 3_plugins/3_1_philips-hue.md - section datée : `pickArea` accepte une zone dont au moins la moitié des lampes sont dans la pièce, zone propre préférée
- 4_ui/4_5_musique-et-medias.md - section datée : seul le panneau de couleurs choisi prend de la place, dialogue ancré en haut, tuile Vague en premier

**Index** : catalogues (déjà datés du jour), index.md régénéré.

## [2026-11-06] update | Hue : poignée de main DTLS réessayée, zone relancée entre deux essais

**Déclencheur** : échec `1 packet(s) from the bridge` sur le serveur, et « si je coupe et que j'essaie de rallumer la sync alors même erreur. il ne faut pas fermer des choses ? ».

**Pages modified** :
- 3_plugins/3_1_philips-hue.md - section datée : pas de retransmission dans `node-dtls-client`, pont sourd 2 à 3 s après une poignée de main coupée, débloqué par stop / start CLIP, 3 tentatives dans `openStream`, fermeture hors de cause

**Index** : catalogue 3_plugins (déjà daté du jour), index.md régénéré.

## [2026-11-06] update | Hue : ce que dit une poignée de main DTLS qui expire

**Déclencheur** : la synchro de « Ce navigateur » échoue sur la vraie maison (`The DTLS handshake timed out`) alors que la sonde passe depuis le poste et depuis le serveur.

**Pages modified** :
- 3_plugins/3_1_philips-hue.md - section datée : pistes écartées (pont, code du plugin, clé fausse = `bad_record_mac` et non expiration), cause non trouvée, message d'échec enrichi (paquets du pont, retard des minuteurs), rappel des deux clés

**Index** : catalogue 3_plugins (date), index.md régénéré.

## [2026-11-06] update | Lumières en rythme pour « Ce navigateur » : la pièce choisie

**Déclencheur** : « quand je suis dans kasbah et que l'écoute est "sur cet appareil" alors je souhaite pouvoir choisir la cible des lights à activer », précisé ensuite : la cible ne dépend pas de la pièce où se trouve l'ordinateur.

**Pages modified** :
- 1_architecture/1_6_lecteur-musique.md - section datée : pièce choisie (`setRoom`, `roomChoices`, dépendances `rooms` / `lightsOfRoom`), relevés de lecture du navigateur (`POST /local/state`, 10 s, muet après 25 s), routes `lightsync/rooms` et `lightsync/:deviceId/room`, ce qui a été écarté
- 4_ui/4_5_musique-et-medias.md - section datée : ampoule de « Ce navigateur », rangée Pièce du panneau, réglages bloqués avant le choix, mémoire dans le navigateur

**Index** : catalogues 1_architecture et 4_ui (déjà datés du jour), index.md régénéré.

## [2026-11-06] update | Site vitrine : formulaire de contact des fabricants et commerçants

**Déclencheur** : un moyen d'être contacté par les fabricants et commerçants qui voudraient prêter du matériel, sans exposer l'adresse de la boîte du projet sur le site statique (GitHub Pages).

**Pages modified** :
- 5_setup/5_2_production.md - puce datée dans la section du site vitrine : encadré `#partners`, envoi par Web3Forms, clé publique liée à un alias Proton Pass, options écartées (`mailto:` masqué, Formspree, Formsubmit), ligne d'état réservée, politiques de confidentialité.

**Index** : catalogue 5_setup (date), index.md régénéré.

## [2026-11-06] ingest | Plugin IKEA DIRIGERA, préparé sans hub

**Déclencheur** : « préparer l'intégration des solutions ikea tradfri et symfonisk sans pour l'instant avoir le matériel ». SYMFONISK = Sonos (rien à écrire) ; TRÅDFRI par le hub DIRIGERA. Plugin codé dans la session, non commité ; hypothèses confrontées aux sources du paquet npm `dirigera` 2.0.2 (trois corrections).

**Pages créées** :
- `3_plugins/3_29_ikea-dirigera.md` - voies écartées, bibliothèque lue et non utilisée, correspondances, appairage, épinglage TLS du WebSocket, vérifié / non joué, liste à vérifier sur le premier hub.

**Index** : catalogue `3_plugins` (3_29), index.md régénéré.

## [2026-11-06] update | Recherches récentes sur toutes les sources de la page Musique

**Déclencheur** : « pour ytm on a une zone qui contient les dernières recherches, on peut généraliser ça sur toutes les sources ? […] l'historique affiché est par source ».

**Pages modifiées** :
- `4_ui/4_5_musique-et-medias.md` - mise à jour 2026-11-06 : `useRecentQueries` (un historique par source, clé de YouTube Music conservée), `ChipRow` réutilisé sous la recherche des Radios, Mixcloud et Podcasts, mémorisation au lancement seulement, libellés passés en `music.*`, piège de sonde (bouton « Radios » homonyme).

**Index** : catalogue `4_ui` (résumé : podcasts et recherches récentes), index.md régénéré.

## [2026-11-06] update | Plugin Podcasts : quatrième source du lecteur commun

**Déclencheur** : demande d'une source « Spotify » ; écartée (flux chiffré DRM, API officielle = simple télécommande Connect), les podcasts RSS retenus à la place. Plugin codé dans la session, non commité.

**Pages créées** :
- `3_plugins/3_28_podcasts.md` - le plugin : trois voies pour trouver une émission (Apple, Podcast Index, adresse RSS), ids, routes, flux RSS, résolution, reprise et « écouté » par compte, santé, limites, pièges.

**Pages modifiées** :
- `1_architecture/1_6_lecteur-musique.md` - mise à jour 2026-11-06 : `RAW_MIME` accepte le MP3 (avant : repli ffmpeg), `onProgress` n'est plus propre à Mixcloud, lumières en rythme déduites du code pour les podcasts (non vérifié).
- `5_setup/5_1_configuration-env.md` - `PODCASTS_*` et `PODCASTINDEX_*`.
- `4_ui/4_5_musique-et-medias.md` - la source Podcasts, son gabarit, le bouton réduit sous 520 px.

**Contradictions** : aucune ; deux phrases de `1_6` (« Seul Mixcloud s'en sert aujourd'hui », « Périmètre v1 ») sont dépassées, signalées par renvoi daté sans réécriture.

**Non vérifié** : Podcast Index réel (pas de clé), enceinte Cast/Sonos réelle, zooms 1,25 et 1,5, lumières en rythme sur un podcast.

**Index** : 4 catalogues mis à jour (1 ligne ajoutée, 3 dates), index.md régénéré.

## [2026-11-05] update | Lumières en rythme : réactivation coupée par un événement tardif du pont

**Déclencheur** : « si j'active la sync, que je la coupe, et que j'essaie de la réactiver alors ça donne ça » (capture : « Flux coupé par le pont Hue »).

**Pages modifiées** :
- `3_plugins/3_1_philips-hue.md` - mise à jour 2026-11-05 (nuit, suite) : événements du pont en ordre mais tardifs (mesuré), confirmation par ordre au lieu d'un délai, zone suivie dès l'ouverture.
- `1_architecture/1_6_lecteur-musique.md` - mise à jour 2026-11-05 (nuit, suite) : `problemDetail` affiché (raison du pont, erreur ffmpeg sans l'URL).

**Index** : rien à changer (pages déjà datées du jour).

## [2026-11-05] update | Lumières en rythme : un arrêt sans reprise, deux angles morts corrigés

**Déclencheur** : « parfois ça s'arrête de fonctionner […] ensuite plus possible de remettre la sync en marche » ; logs non relevés, correctif choisi à l'aveugle.

**Pages modifiées** :
- `3_plugins/3_1_philips-hue.md` - mise à jour 2026-11-05 (nuit) : fin de zone annoncée par le pont (SSE) suivie, délai de grâce, envoi protégé.
- `1_architecture/1_6_lecteur-musique.md` - mise à jour 2026-11-05 (nuit) : échec d'analyse distingué de la fin, reprise à délais croissants, `-reconnect`, `status.problem` affiché ; cause non confirmée.

**Index** : rien à changer (pages déjà datées du jour).

## [2026-11-05] update | Lumières en rythme : couleurs au hasard qui vont ensemble

**Déclencheur** : « sur la palette perso on peut ajouter un bouton random qui si possible sort des couleurs qui peuvent s'assembler selon différentes méthodes ».

**Pages modifiées** :
- `4_ui/4_5_musique-et-medias.md` - mise à jour 2026-11-05 (nuit) : bouton « au hasard », six règles de la roue chromatique (`lib/colorHarmony.ts`), règle affichée sur une ligne réservée.

**Index** : rien à changer (page déjà datée du jour).

## [2026-11-05] update | Lumières en rythme : effets, palettes, ambiance, panneau de réglages

**Déclencheur** : « il va falloir aller plus loin en ajoutant des réglages car là on ne peut pas contrôler grand chose » (gamme de couleurs, ambiance, effets).

**Pages modifiées** :
- `1_architecture/1_6_lecteur-musique.md` - mise à jour 2026-11-05 (soir) : contrat partagé des réglages, réglages par pièce persistés, cinq effets reconfigurables en direct, palettes (presets, scène, perso, pochette par ffmpeg), route `settings`.
- `4_ui/4_5_musique-et-medias.md` - mise à jour 2026-11-05 (soir) : ampoule + flèche, `LightSyncDialog`, ordre des sections et panneaux de couleurs empilés pour que rien ne bouge, piège `structuredClone`.

**Index** : rien à changer (pages déjà datées du jour).

## [2026-11-05] update | Lumières en rythme : vérifié avec de la musique

**Déclencheur** : « ça fonctionne », après le redémarrage du serveur avec les nouvelles clés Hue.

**Pages modifiées** :
- `1_architecture/1_6_lecteur-musique.md` - la chaîne complète (morceau sur une enceinte Cast, lampe de la pièce) est vérifiée sur la vraie maison ; manque de réglages noté.

**Index** : rien à changer (page déjà datée du jour).

## [2026-11-05] update | Lumières de la pièce en rythme avec la musique (flux Hue Entertainment)

**Déclencheur** : « est-ce qu'il serait possible de sync les lumières d'une pièce avec le son d'une enceinte de la pièce ? » ; étape 1 livrée (YouTube Music et Mixcloud, interrupteur sur la carte Écoute), radio et TV laissées de côté.

**Pages modifiées** :
- `3_plugins/3_1_philips-hue.md` - mise à jour 2026-11-05 : clé cliente gardée à l'appairage (`HUE_CLIENT_KEY`, réappairage nécessaire), flux DTLS (trame `HueStream` v2, PSK, maintien, une zone à la fois, choix de la zone d'une pièce), sonde `tools/hue-entertainment-probe.mts`, vérifié sur le vrai pont (159 ms, le pont restaure seul les lampes), piège zone ordinaire / zone de divertissement.
- `1_architecture/1_6_lecteur-musique.md` - mise à jour 2026-11-05 : `music/lightsync/` (second ffmpeg, caractéristiques toutes les 20 ms, orchestrateur `LightSync`, effet pulsation), routes `/api/music/lightsync`, pièce calculée dans `app.ts`, radio écartée pour l'instant.
- `4_ui/4_5_musique-et-medias.md` - mise à jour 2026-11-05 : touche ampoule de la carte Écoute, colonne réservée dès qu'une pièce peut, vérifications de la preview.

**Index** : catalogues mis à jour (3 lignes), index.md régénéré.

## [2026-11-05] update | Étalonnage des volets : la part réelle de la fenêtre, lames ajourées ou serrées

**Déclencheur** : « un volet fermé à 50 % ne cache pas 50 % de la fenêtre » ; demande de réglages par volet pour que 25 / 50 / 75 % soient la vraie couverture, et de distinguer un volet couvrant (jours ouverts) d'un volet fermé (lames serrées).

**Pages modifiées** :
- `1_architecture/1_1_contrat-appareils.md` - mise à jour 2026-11-05 : capacité `calibration`, commande `cover.set_calibration`, champs `calibration` / `motorPosition` / `sealed`, `set_position { motor }`, conversions de `cover-calibration.ts`.
- `3_plugins/3_4_somfy-tahoma.md` - mise à jour 2026-11-05 : pourquoi le pourcentage Somfy ment, application dans le plugin (sortie, entrée, sens du mouvement en valeurs moteur), « Fermé » contre « couvert à 100 % », arrondi du moteur, fichier d'état, geste d'étalonnage (bloc Réglages du panneau, petite clé sur la ligne du nom des cartes), curseur qui tient la cible, position favorite mémorisée là où est le moteur, repères saisis ou effacés un à un ; pas encore essayé sur un vrai volet.

**Index** : catalogues mis à jour (2 lignes), index.md régénéré.

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
