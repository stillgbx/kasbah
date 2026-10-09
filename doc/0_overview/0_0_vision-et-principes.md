# Vision et principes

> Dernière mise à jour : 2026-10-07
> Sources : `README.md`, `CLAUDE.md`, commit 0615484

## Objectif

Une app web (**tablette, ordinateur, téléphone**) qui montre la maison et le jardin en **3D** (souris et tactile),
place les appareils connectés dans les pièces et permet de les piloter simplement : lumières,
volets, enceintes, chauffage, robots (aspirateur, tondeuse), énergie solaire, borne et véhicules
électriques. La maison est décrite dans un **fichier JSON** ; chaque famille d'appareils est un
**plugin** ; les secrets d'API vivent dans un `.env` **côté serveur**.

## Décisions structurantes (prises avec l'utilisateur le 2026-09-04)

| Décision | Pourquoi |
|---|---|
| **Serveur Node dédié** (Fastify) qui héberge les plugins | La quasi-totalité des APIs visées (Somfy TaHoma, Nest SDM, Enphase, Tesla Fleet, Renault…) exige des secrets OAuth et refuse le CORS navigateur. Un `.env` côté navigateur exposerait les clés. |
| **TypeScript partout**, types **inférés des schémas zod** de `packages/shared` | Une seule source de vérité pour serveur, plugins et app web ; les erreurs de contrat sont attrapées à la compilation et à la frontière (parse). |
| **Vuetify 4** comme bibliothèque UI (« si besoin ») | Curseurs et interrupteurs tactiles, color picker pour Hue, tiroirs, snackbars, thème système natif. Le langage visuel reste piloté par nos jetons CSS (voir `4_ui/4_0_langage-visuel.md`). |
| **Three.js brut** (pas de wrapper Vue) | Contrôle total du rendu à la demande et du cycle de vie ; le contrôleur est testable en Node sans WebGL. |
| **Plugins v1 : `mock` + Philips `hue`** ; les autres fabricants sont des squelettes déclarés | Développer et tester toute l'UI sans clé API ; Hue est la seule intégration locale sans OAuth. *(Dépassé le 2026-10-06 (lint) : 21 plugins sont implémentés, aucun squelette (`apps/server/src/plugins/index.ts`, `3_plugins/3_3_fabricants-a-venir.md`), et plusieurs sont des intégrations locales : TaHoma, Cast, Sonos, Tuya, Enphase, COMAP.)* |
| **Commandes en REST, états poussés en WebSocket** | Codes HTTP, timeouts et testabilité `curl` pour les commandes ; un seul chemin pour les états. |
| **Maquette Claude Design** comme référence visuelle et de navigation | Fournie par l'utilisateur en fin de session ; l'app a été réalignée dessus (rail, onglets, panneau latéral, pilules). |

## Principes

- **Simplicité d'abord** : pas d'abstraction spéculative ; une commande = un appel REST ; un état = un objet remplacé.
- **Tout est testable sans matériel** : simulation déterministe, Hue sur fixtures, scène 3D headless.
- **Une seule définition** pour chaque chose : kinds/états/commandes (`packages/shared`), couleurs (jetons → Vuetify → Three), maison (`house.json`).
- **Hors ligne sur le LAN** : aucune ressource externe au runtime (police embarquée, pas de CDN).
  *(Dépassé le 2026-10-06 (lint) : la carte de la vue Véhicules (`apps/web/src/lib/map.ts`, tuiles openfreemap et geopf), l'import de relief IGN (`lib/ignRelief.ts`) et AROME (`lib/arome.ts`) appellent des services externes depuis le navigateur ; seuls la police et le cœur de l'app restent locaux.)*

## Périmètre v1 livré

Monorepo complet, 108 tests, plugin mock et plugin Hue réels (le bridge de l'utilisateur est
appairé), UI alignée sur la maquette. Voir `1_architecture/1_0_monorepo-et-flux.md`.

*(État au 2026-09-04. Constat du lint du 2026-10-06 : 1 895 tests, 21 plugins, serveur MCP, automatisations et lecteur de musique.)*

## Suites envisagées (hors v1)

Plugins réels des autres fabricants (`3_plugins/3_3_fabricants-a-venir.md`), authentification,
Dockerfile, mDNS Hue et épinglage du certificat Signify, éclairage solaire selon l'heure et
l'origine GPS, carte des véhicules, mode éclaté des niveaux, éditeur de maison.

*(Constat du lint du 2026-10-06 : déjà fait — tous les plugins, l'éclairage solaire (`packages/shared/src/house/sun.ts`), la carte des véhicules (`apps/web/src/components/vehicles/VehicleMap.vue`), l'édition partielle de la maison, l'OAuth du seul MCP. Reste à faire : Dockerfile (aucun dans le dépôt), mDNS Hue, épinglage du certificat Signify, authentification de l'UI et de l'API.)*

*(Mise à jour du 2026-10-06 (soir) : l'authentification de l'UI et de l'API est faite pour l'accès depuis l'extérieur — sous l'adresse publique du proxy inverse, tout passe par une connexion (mêmes comptes que le MCP, session par cookie). Le réseau local reste sans compte, par choix : écrans fixes de confiance. Les droits par compte (enfant en lecture seule…) restent à faire. Voir `../1_architecture/1_7_serveur-mcp.md`.)*

*(Mise à jour du 2026-10-07 : première chose que ces comptes servent — les **comptes musicaux par utilisateur** (YouTube Music, Mixcloud) : chacun retrouve ses playlists et recommandations sans abîmer l'historique d'un autre ni celui de la maison ; connecté sans réglage = accès anonyme ; sur le réseau local, toujours « la maison ». Les **droits** par compte restent à faire. Voir `../1_architecture/1_6_lecteur-musique.md`.)*
