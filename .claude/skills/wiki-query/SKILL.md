---
name: wiki-query
description: >-
  Answer a factual question about the Kasbah project (house JSON format and
  geometry, device contract, server and plugins, REST/WebSocket protocol, 3D
  scene, UI layout and theming, i18n, setup, production, known pitfalls) by
  consulting the wiki in ./doc/. Use when the user asks
  "what does the doc say about X", "how does Y work", "where is Z documented",
  or any factual question about design, data model, ops, or troubleshooting.
  Use PROACTIVELY at the start of any task touching project domain concepts
  BEFORE code exploration — the wiki often answers faster than reading code.
  For pure code-structure questions ("who calls X", "blast radius") prefer
  GitNexus instead. Always cite the pages read.
---

# wiki-query

Consult the project wiki to answer a factual question with citations.

## Wiki path

`./doc/` (local to this repo).

## Process

### Step 1 : context

Read first :
1. `doc/SCHEMA.md` - wiki conventions (layers, structure, rules).
2. `doc/index.md` - catalog of pages : per section, an introduction line, then titles + dates.

If `doc/` is missing or empty, say so and fall back to code exploration (`apps/`, `packages/`, `README.md`, `docs/`) or GitNexus for structure questions.

### Step 2 : identify candidate pages

The index has two levels : `index.md` only gives each section's introduction and its pages' titles
and dates ; the **summaries** live in the catalogue of `doc/<section>/README.md`.

1. In `index.md`, spot the 1 or 2 relevant sections (introduction line, titles, filenames).
2. Read their `README.md` catalogue (summaries : what each page covers).
3. Pick **1 to 3 pages**.

For code-level questions ("who calls X", "blast radius") prefer GitNexus tools (`gitnexus_*`) - the wiki is for narrative / design / procedure questions.

### Step 2 bis : history (only if the question is about the past)

The log is split by month : `doc/log.md` holds the **current month** only, past months are in
`doc/log/AAAA-MM.md` (catalogue : `doc/log/README.md`). Don't read them by default ; go there when :
- the question is about **when / why / following what** something changed ;
- a page, file or plugin named by the user doesn't appear in the pages read ;
- a page's last update predates the current month and the session that produced it matters.

Method : `Grep` on `doc/log/` (page filename, plugin name, keyword), then read **only the entry found**
(`offset` / `limit`). The page's last-update date gives the month to open ; without a lead, the table
of `doc/log/README.md` says which months touched which section. Cite
`[source : log/AAAA-MM.md §[AAAA-MM-JJ] title]`.

### Step 3 : read

Read each candidate page. If a page has a `> **Source** : ...` header pointing to supplementary material under `doc/` (e.g. `doc/raw/...`) and the distillation lacks the detail asked, also read that source file.

### Step 4 : synthesize

Concise answer in the user's language (French / English depending on question). Typical shape :

```
Synthetic answer (2-3 sentences).

Relevant details with inline citations :
- Point 1 [source : <path-relative-to-doc>.md §<section-name>]
- Point 2 [source : <path-relative-to-doc>.md §<section-name>]

Further reading : <list of pages if the user wants more>.
```

Use real paths from `index.md` and the section catalogues — never invent page names.

### Step 5 : signal gaps or staleness

- If no page covers the topic : say it explicitly, suggest running `wiki-update` after the user shares the information.
- If a page looks stale (date > 6 months AND contradicts current code) : flag it without rewriting. Decision to update goes to the user.

## Rules

- Never invent a page or citation. If neither `index.md` nor a section's `README.md` catalogue references a page, it doesn't exist.
- Never modify a page during a query (that's `wiki-update`'s role).
- Cite precisely : `[source : <path-relative-to-doc>.md §<section-name>]`.
- If the question is better answered by GitNexus (code structure), redirect.

## Anti-redundancy with code exploration

When `wiki-query` is invoked proactively at the start of a task :

- **If these pages fully answer** the question or cover the necessary context : **stop there**. Do not also explore the code (Grep / Glob / read source files). The wiki is the narrative source of truth — trust it.
- **If the answer is partial** (wiki describes architecture but not the implementation detail asked, or page flagged stale) : continue with code exploration, but **cite the wiki pages that oriented the investigation** in the final answer. Flag the gap for a possible `wiki-update`.
- **If no page covers** : say so explicitly, switch to code exploration (or GitNexus for code-structure questions), and suggest `wiki-update` at task end.
