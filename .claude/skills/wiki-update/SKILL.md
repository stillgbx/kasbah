---
name: wiki-update
description: >-
  Ingest new knowledge into the project wiki (./doc/) after a coding session :
  new feature, important bug fix, refactor, schema change, deployment change.
  Updates existing pages or creates new ones, maintains index.md and log.md.
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
2. `doc/index.md` - existing pages.

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
| `apps/web/src/three/*`, `apps/web/src/composables/useHouseScene.ts` | `1_architecture/1_5_scene-3d.md` |
| `apps/web/src/styles/*`, `apps/web/src/plugins/vuetify.ts`, `apps/web/src/lib/strokeIcons.ts` | `4_ui/4_0_langage-visuel.md` |
| `apps/web/src/views/*`, `apps/web/src/components/**` | `4_ui/4_1_navigation-et-panneaux.md` |
| `apps/web/src/stores/settings.ts`, `apps/web/src/i18n/*` | `4_ui/4_2_theme-et-langues.md` |
| `package.json`, `apps/server/.env.example`, `apps/server/build.mjs`, `.claude/launch.json` | `5_setup/*` |
| incident / gotcha | `6_faq/6_0_pieges-outillage.md` or `6_faq/6_1_pieges-runtime.md` |

- **Touched file → page** : find the closest indexed page; if none, propose a new page (`N_M_title.md` per SCHEMA).
- **Product concept** (scène, carte, export joueur, mode MJ…) → thematic page in the matching section.
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

### Step 5 : update `index.md`

For each edited or created page :
- Bump the "Last updated" column to today.
- If new page : add line in the correct section table (sorted by number).

Also update the section's own `README.md` entries list when SCHEMA defines section READMEs.

### Step 6 : append `log.md`

At the **top of the file** (after title + intro), add :

```markdown
## [YYYY-MM-DD] update | <short update title>

**Trigger** : <short context : branch, feature, incident>

**Pages modified** :
- <page1> - <what changed>
- <page2> - <what changed>

**Pages created** (if applicable) :
- <new-page> - <reason>

**Index** : updated (N lines).
```

### Step 7 : flag contradictions

If new info contradicts an existing page :
- **Don't delete** the old version.
- Add a `### Contradiction detected YYYY-MM-DD` section documenting both versions with context (dates, commits).
- Ask the user to arbitrate : which version is authoritative, which to keep.

## Rules

- **Preserve existing content** : golden rule. Complement, don't rewrite.
- **One session = one log.md entry**, even if multiple pages are touched.
- **No auto-commit** : let the user review wiki modifications before committing.
- If > 5 pages impacted by a single update, propose to split into several steps rather than doing it all at once.
