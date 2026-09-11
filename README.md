# Kasbah

Application web pour tablette qui affiche la maison et le jardin en **3D** (souris et tactile) et permet de **visualiser et piloter les appareils connectés** placés dans les pièces : lumières, volets, enceintes, chauffage, robots, énergie solaire, borne et véhicules électriques.

- La maison (étages, pièces, ouvertures, terrain, origine GPS) est décrite dans un **fichier JSON** : voir [docs/house-json.md](docs/house-json.md).
- Chaque famille d'appareils est un **plugin** côté serveur ; les secrets d'API vivent dans un `.env` **serveur**, jamais dans le navigateur.
- Thème clair / sombre / système, quatre couleurs d'accent, français et anglais.

## Architecture

```
kasbah/
  apps/web        Vite + Vue 3 + Vuetify 4 + Three.js — l'app tablette
  apps/server     Node 22 + Fastify 5 — REST + WebSocket, hôte des plugins, sert le build web
  packages/shared Schémas zod partagés : appareils (kinds, états, commandes), protocole, maison + géométrie pure
  packages/mock-sim Moteur de simulation déterministe (plugin `mock` et démo sans serveur)
  house/          demo-house.json — maison de démonstration liée au plugin mock
```

Flux : les plugins découvrent des appareils et poussent des **patchs d'état** → le registre fusionne, horodate et publie → le hub WebSocket envoie des **états complets** (coalescés 50 ms) aux tablettes. Les commandes passent en **REST** (`POST /api/devices/:id/command`) ; l'état résultant revient par le WebSocket comme tout autre changement.

## Démarrage

Prérequis : Node ≥ 22, npm ≥ 10.

```bash
npm install
cp apps/server/.env.example apps/server/.env   # puis ajuster (plugins, Hue…)
npm run dev
```

- Web (Vite, HMR) : <http://localhost:5173> — accessible depuis la tablette via l'IP du poste (`host: true`).
- Serveur : <http://localhost:8787> — `GET /api/health`, `GET /api/house`, `GET /api/devices`, WebSocket `/ws`.

Sans aucune configuration, le serveur démarre avec le plugin `mock` et la maison de démonstration : tout est pilotable immédiatement.

### Production

```bash
npm run build      # web → apps/web/dist, serveur → apps/server/dist/main.js (bundle esbuild)
npm start          # sert l'app web et l'API sur KASBAH_PORT (8787)
```

### Qualité

```bash
npm test           # vitest, tous les workspaces (shared, mock-sim, server, web)
npm run typecheck  # tsc / vue-tsc par workspace
npm run lint       # eslint (flat config, TypeScript + Vue)
```

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `KASBAH_PORT` / `KASBAH_HOST` | `8787` / `0.0.0.0` | Écoute HTTP + WS |
| `KASBAH_HOUSE_FILE` | `house/demo-house.json` | Fichier de la maison |
| `KASBAH_STATIC_DIR` | `apps/web/dist` | Build web servi en production |
| `KASBAH_STRICT_PLUGINS` | `false` | `true` : une config de plugin invalide empêche le démarrage (sinon le plugin est désactivé) |
| `KASBAH_LOG_LEVEL` / `KASBAH_LOG_PRETTY` | `info` / `false` | Journalisation pino |
| `MOCK_SCENARIO` | `default` | `default`, `empty`, `chaos` (pannes et lenteurs simulées), `winter` |
| `MOCK_TIME_SCALE` | `1` | Accélération du temps simulé (60 → une journée en 24 min) |
| `HUE_BRIDGE_HOST` | découverte | IP du bridge Hue (recommandé de la fixer) |
| `HUE_APP_KEY` | — | Clé obtenue par appairage (voir ci-dessous) |

Chaque plugin valide ses propres variables (`HUE_*`, `CAST_*`) : la liste complète est dans [apps/server/.env.example](apps/server/.env.example).

**Quels plugins sont actifs ne se règle pas ici** : ils sont tous disponibles, et on coche ceux
qu'on veut dans **Réglages → Plugins**. Le choix (et les sous-items, comme les types d'appareils
simulés par `mock`) est écrit dans le fichier de la maison, sous `plugins`, et prend effet sans
redémarrer le serveur. Une maison sans cette section démarre avec la simulation seule.

## Plugins

| Id | Fabricant | État |
|---|---|---|
| `mock` | Simulation de tous les types d'appareils | ✅ complet |
| `hue` | Philips Hue (bridge local, CLIP v2 + flux d'événements) | ✅ lumières et pièces |
| `tahoma` `nest` `google_home` `sonos` `irobot` `automower` `melcloud` `comap` `enphase` `tesla` `renault` | Somfy, Google Nest, Google Home, Sonos, iRobot, Husqvarna, Mitsubishi, COMAP Proteo, Enphase, Tesla, Renault | 🧩 squelettes déclarés (`not_implemented`) |

### Appairer un bridge Hue

1. Activez le plugin dans **Réglages → Plugins**. Sans `HUE_BRIDGE_HOST`, le bridge est cherché via `discovery.meethue.com` (fixez ensuite l'IP dans `.env`).
2. Lancez le serveur : le plugin est en état `needs_pairing` (visible dans **Réglages → Plugins**).
3. Appuyez sur le bouton rond du bridge, puis dans les 30 s cliquez **Appairer le bridge** (ou `curl -X POST http://localhost:8787/api/plugins/hue/pair`).
4. Copiez la clé renvoyée dans `apps/server/.env` (`HUE_APP_KEY=…`) : le serveur ne modifie jamais ce fichier, mais la clé est utilisée immédiatement en mémoire.

### Écrire un plugin

Un plugin implémente [`DevicePlugin`](apps/server/src/core/plugin.ts) :

- `configSchema` : schéma zod de **ses** variables d'environnement ;
- `discover()` : retourne des `DeviceDescriptor` (`id = "<plugin>:<externalId>"`, `kind`, `capabilities`) ;
- `start()` : pousse l'état initial puis les changements via `ctx.emitState(externalId, patch)` / `ctx.setAvailable(...)` ;
- `execute(externalId, command)` : traduit une commande générique (`light.set`, `cover.set_position`…) en appel fabricant ; lève `PluginError(code)` en cas d'échec ;
- optionnel : `registerRoutes(app)` (monté sous `/api/plugins/<id>/`) et `health()`.

Déclarez-le dans [apps/server/src/plugins/index.ts](apps/server/src/plugins/index.ts). Le modèle d'appareils (kinds, états, commandes) est défini une seule fois dans [packages/shared/src/devices](packages/shared/src/devices) et partagé avec l'app web.

## Interface

Mise en page tablette (paysage) en trois colonnes : **rail** de navigation à gauche (Maison, Énergie, Véhicules, Réglages ; apparence et langue en bas), **scène** au centre avec l'en-tête (nom de la maison, résumé vivant, onglets Jardin / niveaux / Tout), **panneau** contextuel à droite (340 px). En portrait ou sur petit écran, le panneau devient un tiroir.

- **Maison** : scène 3D. Un doigt tourne, deux doigts zooment/déplacent, la caméra ne passe jamais sous le sol. Les cloisons intérieures sont abaissées pour lire l'intérieur en plongée ; l'onglet de niveau masque les étages supérieurs et le toit. Chaque appareil porte une **pilule** (icône + nom, teintée quand il est actif) : touchez-la, ou l'objet 3D, ou une pièce. Le panneau enchaîne Maison (tuiles de synthèse, **scènes**, pièces) → Pièce (appareils avec bascule rapide) → Appareil (contrôle complet). L'URL reflète la sélection (`#/?level=…&room=…&device=…`).
- **Énergie** : solaire, maison, réseau (soutirage/injection), batterie, borne, autoconsommation et production horaire du jour (historique en mémoire côté serveur, `GET /api/devices/:id/history`).
- **Véhicules** : une carte par véhicule (charge, autonomie, verrouillage, charge, position par rapport à la maison).
- **Réglages** : apparence clair / sombre / système, langue, couleur d'accent (4), origine GPS, état des plugins avec les noms de leurs clés `.env`, appairage Hue.

### Scènes

Une scène est un lot de commandes déclaré dans la maison (`scenes`) et exécuté en un geste depuis le panneau Maison :

```jsonc
{ "id": "night", "name": "Nuit", "icon": "night", "actions": [
  { "deviceId": "mock:light-living", "command": { "type": "light.set", "on": false } },
  { "deviceId": "mock:cover-living", "command": { "type": "cover.close" } }
] }
```

## Licence

Projet personnel.
