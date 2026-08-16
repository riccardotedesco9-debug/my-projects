# Global Instruction-Set Audit — Best Practices & Findings

**Date:** 2026-07-21 · **Scope:** `~/.claude/CLAUDE.md` + 8 `~/.claude/rules/*.md` (ClaudeKit-managed) + workspace `CLAUDE.md` — the ~60KB standing layer injected into every session.
**Method:** ultracode workflow — 3 researchers (Firecrawl-first: Anthropic docs, engineering blog, field sources) → corroborated checklist (kept only if official Anthropic OR ≥2 independent sources) → 7 dimension auditors → adversarial per-finding verification → synthesis. Backup + SHA-256 manifest at `~/.claude/backups/instructions-260721-0827/` taken before any edit.

## TLDR
- **The instruction layer was factually broken, not just bloated.** 114 references pointed at a command namespace (`/ck:*`) that does not exist on this machine — every routing tree in the two skill-routing files, plus development-rules and primary-workflow. All rewritten to the real installed skill names and verified against `ls ~/.claude/skills`.
- **Four contradictions are now resolved in one place** instead of scattered "this supersedes" patches: a precedence block at the top of `~/.claude/CLAUDE.md` states the load order and rules on effort-scaling, the single hard gate, creative-router, and docs upkeep.
- **Four skills were installed but unreachable** — `docx`/`pdf`/`pptx`/`xlsx` sat one directory too deep and never registered. Flattened; they now appear in the skill listing.
- Real bugs fixed: copy-pasted doc descriptions, wrong plan date format, a wrong `development-rules.md` path, a dangling "simplified code" reference, and a broken "repeat from Step 3" back-reference.
- Drift is now detectable: 6 kit files carry local-edit markers, and `node tools/health-check.mjs` warns (verified by simulation) if a ClaudeKit update strips them.
- Injected context down ~2.4KB (~590 tokens/session); emphasis markers 17 → 15. Size was never the main problem — correctness was.

## 1. The corroborated best-practice checklist (what "best practice" actually means)

21 principles survived the corroboration rule; the two that didn't are listed under Dropped.

| ID | Principle | Sources |
|----|-----------|---------|
| BP1 | Apply the deletion test to every line — "would removing this cause Claude to make mistakes?" — cut what fails; bloat causes Claude to ignore the instructions that matter. | code.claude.com/docs/en/best-practices (cited independently 3×) |
| BP2 | Treat the standing layer as a finite attention budget; smallest set of high-signal tokens that still produces the behavior. | anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| BP3 | Audit the 8 unscoped rules files as ONE always-loaded block — unscoped rules/@imports load in full at launch; only path-scoped rules and skills defer. | code.claude.com/docs/en/memory (+field, independent) |
| BP4 | Move multi-step procedures and only-sometimes-relevant content (pipelines, doc protocols, team rules, templates) into skills or path-scoped rules; keep only universal instructions always loaded. | docs/memory + docs/best-practices + humanlayer.dev "writing a good CLAUDE.md" |
| BP5 | State each rule exactly once at the scope where it applies — layers concatenate additively; duplication costs tokens and guarantees drift. | docs/memory + docs/best-practices |
| BP6 | Hunt contradictions across all loaded files as one corpus — conflicts make Claude pick arbitrarily; inline "supersedes" patches leave both instructions in context. | docs/memory + engineering/writing-tools-for-agents + IHEval (measurement) |
| BP7 | Rules that must hold every time belong in hooks; reduce their prose to a one-line pointer (deploy gate is already hook-enforced — its re-explanations are trimmable at near-zero risk). | docs/memory "put guardrails in hooks" + best-practices + humanlayer |
| BP8 | Exclude derivable/frequently-changing facts (directory trees, model IDs/prices, skill counts, dated snapshots); prefer pointers resolved just-in-time over copies that go stale. | best-practices include/exclude table + effective-context-engineering + humanlayer |
| BP9 | Reserve IMPORTANT/MUST for the few genuinely non-negotiable rules; blanket markers dilute the real gates and overtrigger modern models. | platform.claude.com prompting-best-practices ("dial back aggressive language") + best-practices + field |
| BP10 | Delete generic guidance Claude follows by default (YAGNI/KISS/DRY recitals, "write clean code", standard testing advice); keep only the uninferable — unguessable commands, deviations, etiquette, gotchas. | best-practices + docs/memory |
| BP11 | Keep every always-loaded file ≲200 lines; shorter files produce measurably better adherence. | docs/memory ("target under 200 lines") + humanlayer (root ≤60) |
| BP12 | Audit instruction COUNT, not just bytes — adherence degrades uniformly as density rises; every added rule taxes compliance with the rules that matter. | arxiv 2507.11538 (IFScale) + humanlayer + best-practices |
| BP13 | Rewrite surviving rules at the right altitude — concrete enough to verify, expressed as heuristics; avoid brittle enumerated routing trees AND vague platitudes. | effective-context-engineering (2× independent) + docs/memory |
| BP14 | Move dated decision narratives ("decided 2026-06-04") out of the instruction layer into memory files pulled in only when needed. | effective-context-engineering + effective-harnesses-for-long-running-agents |
| BP15 | Put highest-stakes rules at the peripheries and exploit load order (later/more-specific wins) instead of repeating or forward-patching. | docs/memory (load order) + arxiv 2307.03172 (Lost in the Middle) + IFScale |
| BP16 | Replace edge-case laundry lists and anti-pattern tables with a few diverse canonical examples. | effective-context-engineering |
| BP17 | Treat the instruction layer like code — version it, review on misbehavior, prune on schedule, test edits by observing behavior shifts. | best-practices + docs/memory |
| BP18 | Audit from ground truth with built-in tooling: `/context` (per-file token breakdown), `/doctor` (trim baseline), `/memory`. | docs/memory |
| BP19 | Rules that must survive compaction belong at root scope or in hooks — only root CLAUDE.md, unscoped rules, and auto memory are re-injected after compaction. | docs/context-window |
| BP20 | One topic per file/section with descriptive headers, so every rule has one obvious home and duplication becomes visible. | docs/memory + effective-context-engineering |
| BP21 | Maintainer-only provenance notes (dates, "may be reverted" annotations) → HTML comments — stripped before injection, zero context cost. | docs/memory (comment stripping) |

**Dropped (failed corroboration):** (1) HumanLayer's "relevance filter" mechanism claim — single non-official source (its corroborated core merged into BP4); (2) the specific ~150–200-instruction adherence ceiling — single citation chain (BP12 keeps the density principle without the number).

## 2. The `/ck:` namespace verdict (ground truth, verified on disk)

`/ck:X` is **dead as an invocation surface on this machine**: `~/.claude/commands/` holds only `generate-tests.md` + `mkt/`; the old engineer-kit command files were deliberately archived to `~/.claude/command-archive/` (last write 2026-06-03). The functionality lives as **skills invoked by plain name** (`cook`, `fix`, `preview`, `scout`, `test`…) or `ck-`prefixed skill names where names clashed (`ck-plan`, `ck-debug`, `ck-help`, `ck-code-review`, `ck-security`). Only `mkt:*` keeps a namespace. Upstream ClaudeKit still supports `/ck:` as an opt-in install mode, so a kit update **could** re-emit the commands.
**Decision applied (per locked user decisions #2/#5):** rewrite `/ck:X` references in the rules files to the real installed skill names (with local-edit markers), plus one alias line in global CLAUDE.md as insurance if a kit update resurrects the namespace.

## 3. Verified findings

Each was confirmed against the files on disk (line-cited) before any edit. Method note: the parallel audit
fleet was killed twice by infrastructure (network outage, then a session token limit), so the audit was
completed inline — every anchor re-verified directly with grep/read rather than trusted from an agent summary.

### High severity

| # | Where | Defect | Why it degrades instruction-following | BP |
|---|-------|--------|----------------------------------------|-----|
| 1 | all routing files + development-rules, primary-workflow, orchestration-protocol | **114 references to `/ck:X`** — a command namespace with no resolvable commands (`~/.claude/commands/` holds only `generate-tests.md` + `mkt/`; engineer commands were archived 2026-06-03) | Every routing decision terminated at a name that cannot be invoked; survived only by silently re-mapping to a same-named skill | BP8, BP13 |
| 2 | global CLAUDE.md ↔ primary-workflow.md | "delegate to `planner` first" + numbered pipeline vs "pipeline is the ceiling, not the floor" | Two directives that cannot both hold; model picks arbitrarily | BP6, BP15 |
| 3 | global CLAUDE.md ↔ development-rules.md | "review after **every** implementation" vs "the *only* non-negotiable step is review before push/deploy" | Dilutes the one gate that is actually hook-enforced | BP6, BP7, BP9 |
| 4 | `~/.claude/skills/document-skills/` | `docx`, `pdf`, `pptx`, `xlsx` nested one level too deep → never registered, not invocable, while routing pointed at them | Instructions routed to capabilities that could not be reached | BP8 |
| 5 | skill-domain-routing.md ↔ workspace CLAUDE.md | image-generation routing (`ai-artist`/`ai-multimodal`) vs the creative-router "single source of truth" block | Conflict resolved only by a note in a *different* file — bad findability | BP6, BP15 |

### Medium severity

| # | Where | Defect | BP |
|---|-------|--------|-----|
| 6 | documentation-management.md:6–7 | System Architecture **and** Code Standards both carried the changelog's description (copy-paste) | BP13 |
| 7 | documentation-management.md:37 vs :43 | Plan-dir example `251101-1505` vs tree `20251101-1505`; `.ck.json` sets `YYMMDD-HHmm`, so the tree was wrong | BP8 |
| 8 | documentation-management.md:71 | "Fully respect the `./docs/development-rules.md` file" — that file lives at `~/.claude/rules/` | BP8 |
| 9 | primary-workflow.md:17 | Tests run on "the **simplified code**" — no simplification step exists in that file | BP13 |
| 10 | primary-workflow.md:46 | "repeat from the **Step 3**" — Step 3 is Code Quality; the debug loop restarts at fix→re-test | BP13 |
| 11 | development-rules.md:19–20 | `` `imagemagick` `` and `` `debug` `` named as skills; neither exists (`media-processing`, `ck-debug` do) | BP8 |
| 12 | global CLAUDE.md ↔ per-prompt hook ↔ memory | Three-way conflict on failed skill scripts: "fix directly" vs "report first" vs "never modify package files" | BP6 |
| 13 | global ↔ workspace CLAUDE.md | Skill architecture and secrets flow each told in full twice | BP5 |

### Noted, deliberately not changed

- **Heavyweight docs mandates** (`documentation-management.md`: roadmap/changelog after every feature, "Weekly Reviews", `project-manager` MUST-actor) — per your locked decision, governed by precedence rather than rewritten in the kit file. "Weekly Reviews" remains non-actionable in isolation (no cross-session clock).
- **Duplication the hook re-injects** — the per-prompt `## Rules` block restates YAGNI/KISS/DRY and the dev-rules pointer that `development-rules.md` already carries. Removing it means editing hook code, out of this scope.
- **Protected by your decision, untouched:** MCP catalog prose, secrets flow, Firecrawl-first, TLDR style, model ladder, deploy gate, the domain-separation mechanism, all 8 rules filenames.

## 4. Edit set applied

**User-owned (`~/.claude/CLAUDE.md`)**
- Added the **Precedence** section: explicit 6-level load order + rulings on effort-scaling, the one hard gate, creative-router, docs upkeep, and failed skill scripts; plus the `/ck:` → skill-name alias line as insurance if a kit update resurrects the namespace.
- Condensed Skill Architecture (~40 lines of dated decision narrative → 15 lines of operative facts + memory pointers). Every routing fact stays always-loaded.
- Secrets section reduced to the operative rules + pointer; full flow stays canonical in the workspace file.

**User-owned (workspace `CLAUDE.md`)**
- Skill Visibility: 7 duplicated lines → 4-line pointer. Domain-routing mechanism and both gate descriptions left fully intact.
- Model ladder (updated to `claude-opus-5` on 28 Jul) preserved untouched.

**ClaudeKit-managed rules — mechanical only, each marked**
- 114 `/ck:`/`/ckm:` refs → real skill names (`ck-` prefix where the directory carries it).
- Fixed findings 6–11 above; `primary-workflow.md` gained a scope line pointing at Workflow Scaling.
- Markers in 6 files: `<!-- local edit 2026-07-28: … may be reverted by a ClaudeKit update -->` (HTML comments — stripped before injection, zero token cost).

**Infrastructure**
- `tools/health-check.mjs` check #8: warns if any local-edit marker disappears. **Verified by simulation** — removing a marker produced the WARN, restoring it returned OK, file byte-identical after.
- `~/.claude/skills/{docx,pdf,pptx,xlsx}` flattened; all four now register.
- Memory `feedback_claudekit-safety.md` rewritten (its "never modify kit files" rule contradicted both your decisions) + MEMORY.md index line updated.

**Backups:** `~/.claude/backups/instructions-260728-1509/` — all 10 files + health-check, with pre- and post-edit SHA-256. Rollback = copy back.

## 5. Before/after metrics

| Metric | Before | After |
|---|---|---|
| Injected bytes (HTML comments excluded) | 75,542 | 73,181 (**−2,361 ≈ 590 tokens/session**) |
| Global `~/.claude/CLAUDE.md` | 10,036 B | 8,379 B |
| Workspace `CLAUDE.md` | 32,942 B | 32,100 B |
| Dead `/ck:` references | 114 | 0 (5 remaining occurrences are inside markers/the alias line) |
| Dangling skill references | 6 | 0 |
| Emphasis markers (IMPORTANT/MUST/NEVER/ALWAYS) | 17 | 15 |
| Unresolved contradiction pairs | 5 | 0 (all precedence-governed) |
| Unreachable installed skills | 4 | 0 |

Note: the rules files grew slightly (markers + the scope line) while the two user-owned files shrank. Kit
files were deliberately held to mechanical fixes, so the large BP1/BP11 trimming opportunity there is
untaken by design — see open items.

## 6. Fresh-session smoke checklist

Run these in a **new** session from the workspace root:

1. Ask *"what's my web search default?"* → Firecrawl, stated once, no hedging.
2. Ask *"tiny typo fix — do you run the full pipeline?"* → cites Workflow Scaling, no planner delegation.
3. Ask *"which skill edits a .docx?"* → `docx` (proves the flattened skills register).
4. Touch any file under `projects/<a WebDesign project>/` → domain brief fires.
5. Try `git push` without a review marker → still hard-blocked by the gate.
6. `node tools/health-check.mjs` → 15 passed, 1 warn (1Password sign-in only).

## 7. Full-system health check (28 Jul, post-audit)

`node tools/health-check.mjs` → **17 passed, 0 warn, 0 failed.**

**Bugs found and fixed during the sweep** (none caused by the audit — all pre-existing):

1. **`health-check.mjs` never ran its own domain-resolution check.** `check()` was synchronous, so the one
   `await check(...)` with an async body resolved *after* the report printed. It reported nothing — pass
   or fail. A silent hole in the check that guards the briefing mechanism. `check()` is now async.
2. **That check asserted the wrong signature.** It expected an array; `resolveDomains()` returns
   `{domains, inferred}`. It would have hard-failed the moment it started running. Fixed, and it now
   prints which domain resolved and whether it was declared or inferred.
3. **`splashstore` was never briefed.** `Domain: cross-cutting — Engineering + Marketing` names its
   domains in the explanatory tail, which the head-only scan deliberately ignores (a guard against false
   positives), and `cross-cutting` isn't a workspace — so it resolved to nothing and inference found
   nothing either. `brief-lib.mjs` now widens to the full line **only** for an explicit cross-cutting
   declaration. Verified: 13/13 projects resolve; `meetsync` and `pet-centre-website` unchanged (no
   false positives from their tails).

**Verified healthy:** 136 skills all with `SKILL.md` and none nested-unregistered · 32 agents · 17 global
hook scripts + 5 workspace hooks all present · gates behaving correctly (`wrangler deploy`, `npm run
deploy`, `mcp__trigger__deploy` all denied on a dirty tree; `git push` allowed because HEAD `45f58385`
carries a review flag — correct by design) · `.env` gitignored, no secrets staged · instruction files
clean (0 dead refs, 6 markers, precedence block present, all rules files under the 200-line guideline).

**Open, non-blocking:** 89 stale `reviewed-*.flag` files in `.claude/.tmp/` (harmless accumulation) ·
workspace `CLAUDE.md` at 205 lines, marginally over BP11's ~200 · 22 uncommitted changes including a new
untracked `projects/stagecraft-studio-site/` (declares `Domain: WebDesign`, resolves correctly).

## 8. Secrets: `.env`-first now enforced in code (28 Jul)

Riccardo clarified: keep 1Password as a backup, but **`.env` must be the first place checked**. That was
already the documented policy — it was not the implemented one. The auth prompts he kept hitting were real:

| Script | Before | After |
|---|---|---|
| `sync-secrets.mjs` (pushes to Cloudflare/Trigger) | `op read` immediately | `.env` first, 1P fallback; `--op-only` to force vault |
| `create-billing-sheet.mjs` | `op read` immediately | via shared resolver |
| `clean-` / `upgrade-billing-sheet.mjs` | env first, but only under a mangled `OP_AI_STACK_*` name never present in `.env` | via shared resolver (real `.env` names) |
| `health-check.mjs` | `op vault get` on **every run** — the recurring prompt | checks local resolution only; `--with-1p` opts into the vault check |

New `tools/secret-lib.mjs` is the single resolver (DRY): **`process.env` → root `.env` →
`OP_<UPPER_SNAKE>` alias → `op read`**. It also reverse-maps `op://…` refs to `.env` names via `.env.tpl`,
so callers that only know a ref still hit local values first.

**Verified with `op` explicitly disabled:** all **23/23** manifest secrets resolve locally (20 from `.env`,
3 already exported), and all 4 refs the billing scripts request resolve from `.env`. Zero would need
1Password. Health check runs in 1.4s with no `op` invocation; `--with-1p` still passes (18 checks).

Only three scripts still call `op` directly, all correctly: `bootstrap-1p-vault.mjs` (populates the vault
*from* `.env`), `op-to-env.mjs` (restore path), and the fallback branch inside `secret-lib.mjs`.

**Still open:** the 7 vars with no `op://` ref (`BARCODELOOKUP_API_KEY`, `HIKE_*` ×6) were **not** mirrored
to the vault per his instruction, so they exist only in `.env`. With 1P demoted to backup, `.env` is a
single point of failure for them — it needs some backup story (encrypted copy off-machine), even a manual one.

## Unresolved questions

1. **Kit-file trimming.** BP1/BP11 say the always-loaded rules files should shrink substantially (generic "write clean code" advice, standard testing platitudes, anti-pattern tables). Held back because you scoped kit files to mechanical fixes. Worth a follow-up pass?
2. **Hook-injected duplication.** The per-prompt `## Rules` block re-states content already in `development-rules.md` every single turn. Cutting it means editing `dev-rules-reminder.cjs` (kit hook code).
3. **`/ck:` may return.** ClaudeKit upstream still supports the namespace as an install mode; if a future `ck update` re-emits commands, the alias line in global CLAUDE.md covers it and the health-check WARN will flag the reverted files.
4. **`documentation-management.md` "Weekly Reviews"** remains non-actionable in the file itself; currently neutralized only by precedence.
5. **Backup story for `.env`.** Resolved for day-to-day (§8: `.env` is now checked first everywhere, no
   more auth prompts) — 1P stays as backup, nothing decommissioned. What remains open is disaster
   recovery for the 7 vars that exist *only* in `.env`: if that file is lost, they're gone. Options: mirror
   just those 7 into 1P during the next `op` sign-in you're doing anyway, or keep an encrypted copy of
   `.env` off-machine. Low effort either way, but currently unaddressed.
