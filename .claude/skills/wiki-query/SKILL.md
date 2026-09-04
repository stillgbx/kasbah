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
2. `doc/index.md` - catalog of pages (title + 1-line summary + date).

If `doc/` is missing or empty, say so and fall back to code exploration (`apps/`, `packages/`, `README.md`, `docs/`) or GitNexus for structure questions.

### Step 2 : identify candidate pages

Match the question against :
- titles in `index.md`,
- 1-line summaries,
- filenames (keywords).

Pick **3 to 5 pages maximum**. For code-level questions ("who calls X", "blast radius") prefer GitNexus tools (`gitnexus_*`) - the wiki is for narrative / design / procedure questions.

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

Use real paths from `index.md` — never invent page names.

### Step 5 : signal gaps or staleness

- If no page covers the topic : say it explicitly, suggest running `wiki-update` after the user shares the information.
- If a page looks stale (date > 6 months AND contradicts current code) : flag it without rewriting. Decision to update goes to the user.

## Rules

- Never invent a page or citation. If `index.md` doesn't reference a page, it doesn't exist.
- Never modify a page during a query (that's `wiki-update`'s role).
- Cite precisely : `[source : <path-relative-to-doc>.md §<section-name>]`.
- If the question is better answered by GitNexus (code structure), redirect.

## Anti-redundancy with code exploration

When `wiki-query` is invoked proactively at the start of a task :

- **If 3 to 5 pages fully answer** the question or cover the necessary context : **stop there**. Do not also explore the code (Grep / Glob / read source files). The wiki is the narrative source of truth — trust it.
- **If the answer is partial** (wiki describes architecture but not the implementation detail asked, or page flagged stale) : continue with code exploration, but **cite the wiki pages that oriented the investigation** in the final answer. Flag the gap for a possible `wiki-update`.
- **If no page covers** : say so explicitly, switch to code exploration (or GitNexus for code-structure questions), and suggest `wiki-update` at task end.
