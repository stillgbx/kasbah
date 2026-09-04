---
name: wiki-lint
description: >-
  Health-check the project wiki (./doc/) : detect orphan pages, contradictions
  between pages, stale pages that diverged from the code, concepts mentioned
  without dedicated pages (gaps). Produces a report and proposes corrections
  without auto-applying them. Use when the user says "lint the wiki", "health
  check doc", "verifie la doc", or asks for a wiki audit. Run periodically (once
  a month).
---

# wiki-lint

Audit the project wiki health.

## Wiki path

`./doc/`.

## Process

### Step 1 : inventory

1. List all markdown pages : `find doc -name "*.md"` (or equivalent on Windows).
2. Read `doc/index.md` for the official list.
3. Build two sets : **on disk** vs **indexed**.

If `doc/` is absent, report "wiki not initialized" and stop (suggest `wiki-update` with SCHEMA bootstrap).

### Step 2 : detect orphans

A page is **orphan** if :
- it's on disk but absent from `index.md`, OR
- it's not referenced by **any** other page (neither `index.md`, nor a section `README.md`, nor another page).

Legitimate exceptions : whatever `doc/SCHEMA.md` lists (typically `SCHEMA.md`, `log.md`, `index.md`, section `README.md` files, `_generated-ai-doc/*`, optional `doc/raw/*` assets not meant to be indexed).

For each orphan, propose :
- either add it to `index.md`,
- or remove it (after user confirmation).

### Step 3 : detect contradictions

For each key concept that appears in multiple pages (e.g. device id format, house.json coordinate frame, WebSocket message shapes, env variable names, plugin status values), verify coherence :

- Catalog references to field names, store keys, env vars, route paths, component names, etc.
- Flag divergences without pre-judging which is correct.

Most apparent contradictions are **current vs target** state differences : report them as such, not as errors.

### Step 4 : stale pages

For each page :
- Extract `Last updated` from header or the `index.md` column.
- If > 6 months AND the referenced code has moved significantly (GitNexus index or `git log --since=...` on cited files), flag as **refresh candidate**.

Heuristic : `git log --since="6 months ago" --oneline -- <cited-file>`. If the page cites files that have changed a lot, it deserves a look. Cited files must be paths **in this repo** (e.g. `apps/server/src/...`, `packages/shared/src/...`).

### Step 5 : detect gaps

Spot concepts **cited** in pages but without **their own dedicated page**. Examples :
- A page describes the Hue event stream but no page documents the generic SSE helper → gap.
- FAQ mentions a deployment step that would deserve a `5_setup/` page → gap.

Don't be exhaustive : focus on transverse concepts with documentation value. Use section names from `doc/SCHEMA.md`, not paths from another project.

### Step 6 : report

Produce a markdown report in conversation :

```markdown
## Wiki lint - YYYY-MM-DD

### Orphans
- <file> : not indexed, no inbound links
- ...

### Potential contradictions
- `<page-A>` says "X = …" ; `<page-B>` says "X = …" - context : ...

### Stale candidates (>6 months + code moved)
- `<page>` - last updated YYYY-MM-DD, referenced code (<path-in-this-repo>) has N commits since

### Identified gaps
- Concept "Foo" cited in <page-A> and <page-B> without dedicated page

### Proposed actions
(ordered list, each requiring user validation before execution)
```

### Step 7 : append `log.md`

`lint` entry :

```markdown
## [YYYY-MM-DD] lint | Wiki health check

**Orphans found** : N
**Contradictions** : M
**Stale pages >6 months** : P
**Gaps** : Q

**Actions taken** : <none | list if user validated>
**Proposed actions not executed** : <list>
```

## Rules

- **No auto-fix** : every correction goes through explicit user validation.
- **Non-anxious report** : current vs target contradictions are normal, report them factually.
- **Selective on gaps** : don't list every concept, focus on those with documentation value.
- **If all is OK** : say it - "Wiki healthy, 0 orphans, 0 contradictions, 0 gaps. Next pass in X weeks." Still add the lint entry in `log.md`.

## Relationship with GitNexus

For impact analysis of code changes, GitNexus is authoritative. The lint of the wiki is **not** a substitute for `gitnexus_detect_changes()` before commits. Both are complementary :
- GitNexus : "does my code change break something".
- `wiki-lint` : "is my documentation still consistent and fresh".
