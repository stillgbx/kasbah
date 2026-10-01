# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- Developer feedback and LLM Wiki : start -->
## 5. Developer feedback

No automatic markdown recap files - a response summary is enough. For structured knowledge (architecture, session outcomes), use `_generated-ai-doc/` (gitignored ephemeral) or the wiki in `doc/` via `wiki-update`.

## 6. LLM Wiki

### 6.1. Wiki-first reflex

Before exploring code for any question or task touching project domain concepts
(house JSON format and geometry, device contract, server and plugins, REST/WS
protocol, 3D scene, UI layout and theming, i18n, setup, production, FAQ topics),
**read `doc/index.md` first** to identify 1-3 relevant pages, then read them or invoke the `wiki-query`
skill.

The wiki is often faster than Grep for distilled questions. If the wiki pages
fully answer, stop there. If the answer is partial, continue with code
exploration and **cite the wiki pages that oriented the investigation**.

If code and wiki disagree : flag it, never rewrite the wiki without
`/wiki-update`.

### 6.2. Layout

Narrative knowledge lives in `doc/` (Karpathy-style LLM-maintained wiki) :
- [`doc/SCHEMA.md`](doc/SCHEMA.md) - conventions (read first if never consulted).
- [`doc/index.md`](doc/index.md) - catalogue of all pages (title + summary + date).
- [`doc/log.md`](doc/log.md) - changelog of ingest / update / lint operations.

### 6.3. Skills

Three transverse skills in `.claude/skills/` :
- `wiki-query` - answer a factual question by reading the wiki with citations (**proactive** : invoked at the start of any domain task).
- `wiki-update` - ingest new knowledge into the wiki after a session (feature / fix / refactor).
- `wiki-lint` - health-check (orphans, contradictions, stale pages, gaps).

### 6.4. Wiki vs GitNexus

The wiki and GitNexus are complementary — pick the right tool for the question :
- **Wiki** = narrative knowledge (why this architecture, troubleshooting recipes, setup procedures, design decisions). Consult **first** for domain questions.
- **GitNexus** = code intelligence (mechanical : "who calls X", "blast radius", rename). Consult **first** for code-structure questions.
<!-- Developer feedback and LLM Wiki : end -->

<!-- Custom instruction : start -->

<!-- Custom instruction : end -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **kasbah** (22592 symbols, 77457 relationships, 956 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/kasbah/context` | Codebase overview, check index freshness |
| `gitnexus://repo/kasbah/clusters` | All functional areas |
| `gitnexus://repo/kasbah/processes` | All execution flows |
| `gitnexus://repo/kasbah/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
