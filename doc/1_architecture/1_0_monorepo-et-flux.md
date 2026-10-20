# Monorepo et flux de données

> Dernière mise à jour : 2026-10-20
> Sources : `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `apps/server/src/app.ts`, `README.md`, `scripts/dev-server.mjs`

## Workspaces (npm)

```
kasbah/
  packages/shared     @kasbah/shared   — contrat zod : appareils, protocole, maison + géométrie pure (dépend de zod seulement)
  packages/mock-sim   @kasbah/mock-sim — simulation déterministe (dépend de shared)
  apps/server         @kasbah/server   — Fastify 5, hôte de plugins, REST + WS, sert le build web
  apps/web            @kasbah/web      — Vite 8 + Vue 3 + Vuetify 4 + Three.js
  house/              demo-house.json (copie dans packages/shared/src/house/__fixtures__/)
  docs/               références lisibles (format house.json) ; docs/plugins/ : une page utilisateur par plugin (ajoutées le 2026-10-06)
```

Les paquets partagés exportent **directement leurs sources TS** (`"exports": { ".": "./src/index.ts" }`) :
Vite, Vitest, tsx et `vue-tsc` les résolvent sans étape de build. En production, le serveur est
**bundlé par esbuild** (`apps/server/build.mjs`) avec les paquets `@kasbah/*` inclus et les
dépendances npm externes ; le web est bundlé par Vite.

## Flux d'un état

1. Un **plugin** découvre des descripteurs et pousse des patchs via `ctx.emitState(externalId, patch)`.
2. Le **registre** (`apps/server/src/core/registry.ts`) fusionne (`mergeState`), horodate, valide avec
   zod et publie sur le **bus** seulement si quelque chose a changé.
3. Le **hub WebSocket** (`apps/server/src/ws/hub.ts`) coalesce 50 ms par appareil et envoie des
   **états complets** ; à la connexion, il envoie un `snapshot`.
4. Le **store `devices`** de l'app web remplace l'objet d'état (nouvelle référence) ; la scène 3D et
   les panneaux réagissent par comparaison de référence.

## Flux d'une commande

UI → `POST /api/devices/:id/command` → `assertCommandAllowed` (kind + capacité) → `plugin.execute`
sous timeout → `200 { ok: true }`. L'état résultant **revient par le WebSocket**, jamais dans la
réponse (un seul chemin pour les états). Côté web, un **patch optimiste** est appliqué avant la
réponse et annulé si le serveur refuse (`apps/web/src/lib/optimistic.ts`).

## Scripts racine

| Script | Effet |
|---|---|
| `npm run dev` | `concurrently` : serveur (`tsx watch`, 8787) + Vite (5173, proxy `/api` `/ws`). *(Jusqu'au 2026-10-20, aussi le générateur PO Token ; c'est désormais le plugin ytmusic qui le lance, `../3_plugins/3_16_ytmusic.md`)* |
| `npm run dev:pot` | PO Token seul, à la main |
| `npm test` | Vitest, projets `packages/*` et `apps/*` (`vitest.config.ts` racine → `test.projects`) |
| `npm run typecheck` | `tsc --noEmit` par workspace, `vue-tsc` pour le web |
| `npm run lint` | ESLint flat config (typescript-eslint + eslint-plugin-vue) |
| `npm run build` | web (Vite) puis serveur (esbuild) |
| `npm start` | `node dist/main.js` : API + build web sur `KASBAH_PORT` |

## Dépendances entre workspaces

`shared` ← `mock-sim` ← `server` ; `web` dépend de `shared` **et** de `mock-sim` (transport
in-process pour les tests de composants et la démo sans serveur).

### Mise à jour 2026-09-23 — le serveur de dev tourne sous `node --watch`

Dans le tableau des scripts, le serveur de `npm run dev` n'est plus lancé par `tsx watch` mais par
`node --watch --import tsx` (`apps/server/package.json`) : `tsx watch` se bloquait au démarrage sous
`concurrently` depuis l'arrivée du SDK MCP v2. Détail dans `../6_faq/6_0_pieges-outillage.md`. Les
mentions de `tsx watch` dans les pages plus anciennes décrivent le comportement d'avant.


### Mise à jour 2026-10-01 — `npm run house` : la maison réelle tourne sans watch

`npm run dev` sert à **développer** : son serveur est sous `node --watch`, et chaque fichier écrit
dans `apps/server` ou `packages/shared` (une session Claude qui enchaîne des modifications, un
`git checkout`, un formateur) redémarre la maison — une fois par fichier, plugins compris. Pour faire
tourner la maison au quotidien : `npm run house` (racine), qui lance la même pile (serveur, Vite,
générateur PO Token) mais le serveur par `node --import tsx` **sans** `--watch`
(script `house` de `apps/server/package.json`). Le front reste servi par Vite : une modification
web recharge l'onglet sans relancer les plugins. Mêmes ports que `dev` (8787, 5173) : l'un **ou**
l'autre ; la preview a ses propres ports (`.claude/launch.json`). Pourquoi : voir
`../6_faq/6_0_pieges-outillage.md`, section du 2026-10-01.

### Mise à jour 2026-10-10 — le serveur de dev tourne sous `scripts/dev-server.mjs`

Le script `dev` de `apps/server/package.json` n'est plus `node --watch --import tsx …` mais
`node ../../scripts/dev-server.mjs`, un watcher maison d'une centaine de lignes. Il lance le même
`node --import tsx --env-file-if-exists=.env src/main.ts`, surveille `apps/server/src` et
`packages/*/src` (tests exclus), et ne relance que si la date de modification ou la taille d'un fichier
a changé, en regroupant une rafale d'écritures (300 ms) en une seule relance. Pourquoi : sous Windows,
`node --watch` relançait le serveur sur une simple **lecture** de ses modules (heure de dernier accès
NTFS), d'où plusieurs relances à chaque premier démarrage — détail, sondes et issues dans
`../6_faq/6_0_pieges-outillage.md`, section du 2026-10-10. Ce qui ne change pas : `npm run house`
reste le lancement sans watch de la maison au quotidien, et une relance coupe toujours l'enfant net
sous Windows.