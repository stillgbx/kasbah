# 1 — Architecture

> Dernière mise à jour : 2026-10-13
> Catalogue de la section : source unique de sa liste de pages, d'où `scripts/wiki-index.mjs` génère le bloc `1_architecture` de [`index.md`](../index.md). Historique de la section : `Grep 1_architecture/` dans [`log/`](../log/README.md).

Un résumé dit **ce que couvre** la page, en 350 caractères au plus, jamais ce qui a changé : l'historique
vit dans la page (sections datées) et dans le journal.

<!-- catalogue:begin -->
Monorepo, contrat partagé des appareils, serveur et plugins, protocole REST/WebSocket, application web, scène 3D, et les briques transverses : lecteur musique, MCP, automatisations, assistant, liste de courses.

### Pages

| Page | Résumé | Dernière mise à jour |
|---|---|---|
| [1_0 Monorepo et flux de données](1_0_monorepo-et-flux.md) | Les quatre workspaces npm et leurs dépendances, le flux d'un état (plugin → registre → WebSocket → écrans) et d'une commande, les scripts racine (`dev`, `house`, PO Token, watcher `scripts/dev-server.mjs`). | 2026-10-10 |
| [1_1 Contrat des appareils](1_1_contrat-appareils.md) | Modèle zod partagé de `packages/shared` : kinds et capacités, états discriminés, natures (`meta.*.deviceClass`), commandes `kind.verbe`, règles pures (`rules.ts`), `StatePatch` qui sait effacer un champ, scènes plugin et leur rappel. | 2026-10-12 |
| [1_2 Serveur et hôte de plugins](1_2_serveur-et-plugins.md) | Assemblage Fastify (`app.ts`), hôte de plugins (cycle de vie, isolation, activation lue dans la maison, réglages persistés), registre d'états et de scènes, bus, historique énergie, hooks `forecast?` / `journal?` / `consumption?`, relais vidéo `core/video/`, chemins `core/paths.ts`. | 2026-10-11 |
| [1_3 Protocole REST et WebSocket](1_3_protocole-rest-ws.md) | Routes REST (appareils, maison et ses écritures atomiques, scènes, plugins et leur activation, santé et quotas), messages WebSocket `/ws` (états complets, coalescence, `house`, `scenes`), codes d'erreur, transport et reconnexion côté client (`httpTransport.ts`). | 2026-10-13 |
| [1_4 Application web : stores, transport, routage](1_4_app-web.md) | Démarrage, stores Pinia (appareils, maison, scènes, plugins), transport HTTP/WS et mock in-process, mise à jour optimiste et position visée d'un ouvrant, les quatre lectures d'un état, routage, résolution d'une sélection, routage audio (`lib/audioRouting.ts`). | 2026-10-06 |
| [1_5 Scène 3D (Three.js)](1_5_scene-3d.md) | Contrôleur `HouseScene`, repère Z-up, rendu à la demande, cadrage et contrôles, niveaux et cloisons, marqueurs DOM et pilules, sélection et glissement d'un appareil, onde sonore et pochettes, thème et ambiance lumineuse, chaîne d'image et performance GPU, banc de réglage. | 2026-10-13 |
| [1_6 Lecteur musique commun](1_6_lecteur-musique.md) | Noyau `apps/server/src/music/` partagé par les sources (ytmusic, Mixcloud, radios) : contrat d'une source, piste `{ source, id }`, routes `/api/music/*`, sessions par enceinte, reprise de la dernière écoute, pièges connus. | 2026-10-09 |
| [1_7 Serveur MCP](1_7_serveur-mcp.md) | Serveur MCP sur `/mcp` monté dans Fastify (SDK TS v2, sans état) : décisions, outils et ressource `kasbah://house`, même validation que le REST, OAuth (Kasbah serveur d'autorisation, comptes, jetons) puis liste d'hôtes, tests et suites. | 2026-10-11 |
| [1_8 Automatisations](1_8_automatisations.md) | Règles « Quand / Sauf si / Alors » exécutées par le serveur et écrites sur le contrat : modèle partagé, moteur (prédicats à trois valeurs, déclencheurs heure, soleil et état, minuteur unique), persistance par maison, fuseau horaire, limites, API et interface. | 2026-10-11 |
| [1_9 Assistant (« Demander à Kasbah »)](1_9_assistant.md) | Instruction en texte passée à un moteur (plugin) qui agit par le MCP : contrat des moteurs, route NDJSON `/api/assistant/ask`, jeton de course, délai et dernier mot garanti, journal et coût des instructions, côté web, mesures de latence, suites. | 2026-10-11 |
| [1_10 Liste de courses](1_10_liste-de-courses.md) | Liste partagée par maison (vue `/shopping`) : choix d'interface faits avec l'utilisateur, modèle `items` + `products`, opérations pures partagées, persistance `<maison>.shopping.json`, routes `/api/shopping/*` et message WS, outils MCP, désactivation dans Réglages. | 2026-10-11 |
<!-- catalogue:end -->
