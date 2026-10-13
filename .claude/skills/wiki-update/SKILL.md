---
name: wiki-update
description: >-
  Ingest new knowledge into the project wiki (./doc/) after a coding session :
  new feature, important bug fix, refactor, schema change, deployment change.
  Updates existing pages or creates new ones, maintains the section catalogues
  (index.md is generated from them) and log.md.
  Use when the user says "update the wiki", "document this", "mets a jour la
  doc", at the end of a feature branch, or when an important change merges.
  Also use when a wiki-query reveals that the wiki is stale or incomplete.
---

# wiki-update

Ingest or update knowledge in the wiki.

## Wiki path

`./doc/` (local to this repo).

## Process

### Step 1 : context

Read :
1. `doc/SCHEMA.md` - conventions (section layout, naming, language).
2. `doc/index.md` - existing pages (titles + dates per section) ; the summaries are in each section's `README.md` catalogue.

If `doc/SCHEMA.md` or `doc/index.md` is missing, propose initializing the wiki skeleton (SCHEMA + index + log) before editing content pages.

### Step 2 : identify the change

Sources (in preference order) :
1. Explicit user description (what changed, why).
2. `git log origin/main..HEAD --oneline` + `git diff origin/main...HEAD --stat` for the current branch.
3. Session commit messages.

If the branch has no commits or the context is fuzzy, **ask for clarification** before proceeding.

### Step 3 : determine impacted pages

For each change, identify the wiki page via **`doc/index.md` and `doc/SCHEMA.md`** (section numbering, thematic folders) — do not assume paths from another project.

Heuristics for this repo :

| Code / asset area | Typical wiki page |
|-------------------|-------------------|
| `packages/shared/src/devices/*` | `1_architecture/1_1_contrat-appareils.md` |
| `packages/shared/src/protocol/*`, `apps/server/src/http/*`, `apps/server/src/ws/*` | `1_architecture/1_3_protocole-rest-ws.md` |
| `packages/shared/src/house/{schema,validate,lookup,geo}.ts`, `docs/house-json.md`, `house/*.json` | `2_maison/2_0_format-house-json.md` |
| `packages/shared/src/house/geometry/*` | `2_maison/2_1_geometrie.md` |
| `apps/server/src/core/*`, `apps/server/src/app.ts` | `1_architecture/1_2_serveur-et-plugins.md` |
| `apps/server/src/plugins/mock/*`, `packages/mock-sim/*` | `3_plugins/3_0_simulation-mock.md` |
| `apps/server/src/plugins/hue/*` | `3_plugins/3_1_philips-hue.md` |
| new plugin folder | `3_plugins/3_2_ecrire-un-plugin.md`, `3_plugins/3_3_fabricants-a-venir.md` |
| `apps/web/src/{stores,api,router}/*`, `apps/web/src/lib/optimistic.ts` | `1_architecture/1_4_app-web.md` |
| `apps/web/src/three/*`, `apps/web/src/composables/useHouseScene.ts` | `1_architecture/1_5_scene-3d.md` (socle, interactions) ; rendu, styles, lumière, perf : `1_11_scene-3d-rendu.md` ; marqueurs et objets dessinés : `1_12_scene-3d-objets.md` |
| `apps/server/src/music/*`, `apps/web/src/**/music/*` | `1_architecture/1_6_lecteur-musique.md` |
| `apps/server/src/mcp/*` | `1_architecture/1_7_serveur-mcp.md` |
| `apps/server/src/http/session.ts`, `apps/server/src/mcp/{auth,users-routes,users-cli}.ts`, `userStateDir` | `1_architecture/1_13_comptes-et-sessions.md` (+ `1_7` for the OAuth side) |
| `apps/server/src/core/{history,chargeCoordination}.ts`, `energy` / `ev_charger` states | `1_architecture/1_14_energie.md` |
| `apps/server/src/core/automations/*`, `packages/shared/src/automations/*` | `1_architecture/1_8_automatisations.md` |
| `apps/server/src/plugins/<fabricant>/*` | the plugin's own `3_plugins/3_N_<fabricant>.md` (see `index.md`) |
| `apps/web/src/styles/*`, `apps/web/src/plugins/vuetify.ts`, `apps/web/src/lib/strokeIcons.ts` | `4_ui/4_0_langage-visuel.md` |
| `apps/web/src/components/layout/*`, `apps/web/src/components/home/*`, `views/HomeView.vue` | `4_ui/4_1_navigation-et-panneaux.md` |
| another view (`apps/web/src/views/*`) and its components | the page of that view : `4_ui/4_3` (Lumières, Ouvrants, Caméras) … `4_ui/4_8` (mode édition), see `doc/4_ui/README.md` |
| `apps/web/src/stores/settings.ts`, `apps/web/src/i18n/*` | `4_ui/4_2_theme-et-langues.md` |
| `package.json`, `apps/server/.env.example`, `apps/server/build.mjs`, `.claude/launch.json` | `5_setup/*` |
| incident / gotcha | `6_faq/6_0_pieges-outillage.md` or `6_faq/6_1_pieges-runtime.md` |

- **Touched file → page** : find the closest indexed page; if none, propose a new page (`N_M_title.md` per SCHEMA). The new `M` is read **on disk** (largest `M` among the folder's `N_*.md` files, + 1), never from a table.
- **Product concept** (scène maison, automatisation, source musicale…) → thematic page in the matching section.
- **Incident / gotcha** → FAQ section (`6_faq/6_N_*.md`, format Date / Symptôme / Diagnostic / Solution).

If no existing page fits, **propose creating a new page** with location and name. Ask for confirmation before creating.

### Step 4 : edit the pages

Non-negotiable rules :

- **Never silently overwrite** a section. Prefer :
  - add a dated sub-section (`### Update YYYY-MM-DD - title`),
  - or complement an existing section with an extra sentence / paragraph,
  - or flag replacement : "Previously, X was done this way (cf. commit abc123) ; from YYYY-MM-DD, Y replaces X."
- **Bump the date** in the page header.
- **Respect the existing format** : if the page is FAQ-style (Date / Symptom / Diagnosis / Solution), keep it.
- **Cite sources** (code files under this repo, commit SHA, issue numbers) in factual claims.
- **Language** : follow `doc/SCHEMA.md` (French for this wiki).

### Step 5 : update the section catalogue, then regenerate `index.md`

The index has two levels (SCHEMA.md, « Index à deux niveaux »). **Never edit a section's block in
`index.md`** (between `<!-- section:<N_section>:begin … -->` and `<!-- section:<N_section>:end -->`) :
it is generated. Edit the catalogue of `doc/<N_section>/README.md`, between `<!-- catalogue:begin -->`
and `<!-- catalogue:end -->` :

- edited page : bump its "Dernière mise à jour" cell to today ; touch the summary **only if the page's
  scope changed** ;
- new page : add its row (sorted by number) ;
- then run `node scripts/wiki-index.mjs`. Fix every `[ERREUR]` (page missing from the catalogue, dead
  link) and `[ALERTE]` (summary too long or dated, catalogue date behind the page header) it prints.

A summary says **what the page covers**, 350 characters at most. It never tells what changed : no
« depuis le AAAA-MM-JJ », no « remplacé par … ». History lives in the page (dated sub-sections) and
in `log.md`.

**New section** : create its `README.md` with a catalogue, add to `index.md` a `## N — Name` followed
by the two empty markers (numeric order), run the script.

### Step 6 : append `log.md`

**Archive first** : run `node scripts/wiki-log.mjs`. It decides alone : `log.md` keeps the current
month, any entry of an earlier month moves to `doc/log/AAAA-MM.md` (catalogue `doc/log/README.md`,
navigation blocks regenerated). No effect when there is nothing to do ; never move an entry by hand.
Then read only the **top** of `log.md` (`limit` ~40 lines) to insert the entry, never the whole file
nor the archives.

At the **top of the file** (after title, intro and the generated `log-nav` block), add :

```markdown
## [YYYY-MM-DD] update | <short update title>

**Trigger** : <short context : branch, feature, incident>

**Pages modified** :
- <page1> - <what changed>
- <page2> - <what changed>

**Pages created** (if applicable) :
- <new-page> - <reason>

**Index** : catalogue(s) updated (N lines), index.md regenerated.
```

### Step 7 : flag contradictions

If new info contradicts an existing page :
- **Don't delete** the old version.
- Add a `### Contradiction detected YYYY-MM-DD` section documenting both versions with context (dates, commits).
- Ask the user to arbitrate : which version is authoritative, which to keep.

## Rules

- **Preserve existing content** : golden rule. Complement, don't rewrite.
- **No personal data** : the repository is public. Never write names, real IPs or domains, GPS, the real house plan, device ids, real measurements, family, school or health details — see CLAUDE.md §7. Write « vérifié sur la vraie maison » without the details; quote the user's request in `log.md` without them.
- **One session = one log.md entry**, even if multiple pages are touched.
- **Generated files are never edited by hand** : the section blocks of `index.md`, the `log-nav`
  blocks, `doc/log/README.md`. After a merge conflict on `log.md` or `doc/log/` (keep both sides),
  rerun `node scripts/wiki-log.mjs` ; after one on `index.md`, take either side and rerun
  `node scripts/wiki-index.mjs`.
- **No auto-commit** : let the user review wiki modifications before committing.
- If > 5 pages impacted by a single update, propose to split into several steps rather than doing it all at once.
