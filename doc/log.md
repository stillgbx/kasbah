# Journal du wiki

Entrées les plus récentes en haut. Une session = une entrée.

<!-- log-nav:begin (généré par scripts/wiki-log.mjs, ne pas éditer) -->
> **Mois en cours uniquement** (2026-11). Les mois précédents sont archivés dans [log/](log/README.md) par `scripts/wiki-log.mjs` : 401 entrées, de 2026-09 à 2026-10, une archive par mois.
> Pour remonter plus loin : chercher (`Grep`) un nom de page, un fichier ou un mot-clé dans `log/`, plutôt que lire les archives ; la date de mise à jour d'une page donne le mois à ouvrir. Mois précédent : [log/2026-10.md](log/2026-10.md).
<!-- log-nav:end -->

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
