# Setup Alignment Audit — Full Report

**Date:** 2026-06-03 21:49 · **Scope:** every level of the Claude Code setup (global `~/.claude`, the four `agents/` domain workspaces, all `projects/`, shared `tools/`, root config, and auto-memory) · **Goal:** find conflicting / stale / misaligned instructions and align them **without breaking things**.

## Method
Three parallel Explore agents mapped the layers; load-bearing claims were then verified directly (diffed rule files byte-for-byte, confirmed git-tracking vs gitignore, grepped exact stale lines, counted skills on disk). Two of the explorers' "high severity" flags were verified to be **false positives** and dropped.

## Central finding (reshaped the fix scope)
The per-workspace `agents/<ws>/.claude/` directories are **full, gitignored, package-managed ClaudeKit installs** (each carries `metadata.json`; `git check-ignore` confirms ignored). The most-flagged "conflicts" all live **inside those vendored packages** — so they are *package-version drift*, not hand-authored mistakes. Per user rule `feedback_claudekit-safety.md`, vendored ClaudeKit files are never hand-edited (and edits would be wiped on the next package sync). → Those are **reported, not edited**. All durable fixes were applied to **user-authored files only** (git-tracked docs + auto-memory).

---

## FIXED (user-authored layer)

### 1. Memory path cleanup — post-refactor drift
The `agents/`+`projects/` restructure (commit `53d01a5`, ~3 days ago) left 9 memory files pointing at the pre-refactor path `Engineering/trigger-automations/...`. Updated `Engineering/trigger-automations/` → `projects/trigger-automations/` (and the older `My Projects/meetsync/` / bare `meetsync/tools/` forms → `projects/meetsync/...`) in:
- `feedback_vision-reasoning.md`, `feedback_schedule-encoding-patterns.md`
- `project_mcp-provider-choices.md`, `project_meetsync.md`, `project_meetsync-next-steps.md`, `project_meetsync-tools-2026-05.md`, `project_meetsync-test-harness.md`, `project_trigger-mcp-setup.md`
- `reference_google-drive-mcp-hangs.md`

**Left intentionally:** `project_workspace-structure.md` still cites the old path *on purpose* — it documents the old→new translation rule.

### 2. Project `Domain:` lines — convention compliance
Root `CLAUDE.md` + `projects/README.md` require a `Domain:` line atop each project `CLAUDE.md`; only `pixel-life` had one. Added (matching pixel-life's format) to:
- `projects/meetsync/CLAUDE.md` → `Domain: Engineering`
- `projects/trigger-automations/CLAUDE.md` → `Domain: Engineering`
- `projects/job-hunt/CLAUDE.md` → `Domain: Engineering`

### 3. Authored `CLAUDE.md` for two new (untracked) projects
- `projects/pet-centre-mellieha/CLAUDE.md` → `Domain: Marketing` (pet-store strategy; rival Paws 'n' Claws; brand tokens; sourced from memory `project_pet-centre-mellieha.md`).
- `projects/job-application/CLAUDE.md` → `Domain: WebDesign` (Puppeteer HTML→PDF CV/cover-letter renderer; `node render.mjs` entry).

### 4. Root + global doc alignment
- Global `~/.claude/CLAUDE.md`: "distributed across **three** layers" → "**four**" (it then lists four skill-bearing layers); "(~47 skills)" → "(~45 skills)" (verified ~45 dirs on disk).
- Root `My Projects/CLAUDE.md` (Google Drive bullet): added a caveat that `mcp__google-drive__*` hangs in this environment (prefer OAuth-fetch / ask user), resolving the doc-says-use-it vs memory-says-never (`reference_google-drive-mcp-hangs.md`) contradiction. Noted it does **not** apply to the `mcp__claude_ai_Google_Drive__*` connector.

---

## REPORTED ONLY — ClaudeKit package drift (not edited)
These are real inconsistencies but live in gitignored, package-managed ClaudeKit installs. **Correct fix: re-sync / reinstall the ClaudeKit packages so every workspace runs the same version — do not hand-edit.**

- **Marketing is on an older package version.** `agents/Marketing/.claude/workflows/` copies are stale vs the global/Engineering `.claude/rules/`:
  - `orchestration-protocol.md` — 15 lines vs 43; **missing the entire "Delegation Context (MANDATORY)" section** (work-context / reports / plans path passing).
  - `primary-workflow.md` (47L vs 60L) & `development-rules.md` (41L vs 51L) — drifted wording, incl. code-review gate ("after implementation" vs "after testing passes") and tester-on-"simplified code".
- **Engineering** `orchestration-protocol.md` differs slightly from global (same 43L) — minor package drift.
- **`development-rules.md`** (global + Engineering copies) still says use `ai-multimodal` to *generate* images — contradicts root `CLAUDE.md`, which supersedes that ("those tools are for *analysis*"; generation routes through `creative-router`). This is the *packaged* rule file; the root override already wins at runtime.
- **`common/` "skill" duplicated** across Engineering + Marketing `.claude/skills/` with divergent contents (`api_key_helper.py` 12,675 B vs 9,504 B). It's shared utility code, not a real skill — divergence is a maintenance smell, not a runtime conflict.

## Lower-priority observations (left as-is by design)
- WebScraper & WebDesign have **no local `.claude/rules/`** — fine (specialist workspaces; they inherit global rules).
- `trigger-automations/CLAUDE.md` is a **builder persona**, not a project-architecture doc (no env-var/stack section like meetsync's). Consider adding a short architecture/env block later — not a conflict.
- Global `~/.claude/CLAUDE.md` still describes local-skill paths as `{project}/Engineering/.claude/skills/` (generic placeholder, pre-`agents/` form). Left untouched to avoid editing the generic global pattern; noted for awareness.
- `effortLevel: xhigh` (settings.json) vs "scale effort to task size" — **not a conflict** (reasoning budget per turn ≠ pipeline depth).

## False positives ruled out
- `creativity` / `assets-organizing` skills are **not** missing — they exist as Marketing local skills (one explorer only checked the global folder).
- Deploy-trio hardcoded paths in `tools/secrets-manifest.json` + `bootstrap-1p-vault.mjs` are **correct and documented** (the sanctioned exception to "never hardcode project paths").

---

## Security assessment (general)
**Verdict: solid hygiene, no exposed secrets.** Checks run:
- **No real secrets tracked in git.** Only `.env.example` / `.env.test.example` templates, migration SQL, and the sync tooling are tracked — zero secret values. `git ls-files` secret-pattern sweep is clean.
- **`.env.tpl`** = 25 `op://AI-Stack/...` references, **no raw values** (safe to commit).
- **`.gitignore`** correctly ignores `.env`, `.env.*`, `**/.tmp/`; whitelists only `.env.example` / `.env.tpl`. Real legacy `.env` files (meetsync/job-hunt/trigger-automations) are ignored; `trigger-prod.env` (materialized by sync) lands in ignored `.tmp/`.
- **1Password (`op`, AI-Stack vault)** is the canonical secret source; secrets pushed to Cloudflare/Trigger via `sync-secrets.mjs`, never committed.
- **Defensive hooks** present: `privacy-block.cjs` (gates sensitive-file reads via AskUserQuestion), `scout-block.cjs` (blocks `node_modules`/`.venv` access).

**Residual risks (inherent to a local dev box, low):**
1. Legacy `.env` files with **real values still on disk** (gitignored, but present). Once the 1P migration is fully trusted, delete them.
2. **`FAL_KEY` materialized into the Windows user env** via `setx` — a documented, conscious exception (fal is prepaid → capped blast radius). Re-evaluate if the key gains broader scope.
3. Confirm the tracked `.env.example` files contain **placeholders only** (naming implies so; quick eyeball recommended).
4. Standard workstation posture: 1Password CLI session + Claude.ai MCP OAuth connectors (Gmail/Slack/Google/etc.) hold live tokens outside the repo — keep the OS account and 1P locked.

No mass-exposure, no tracked credentials, no public blast radius found.

## Verification
- `grep "Engineering/(trigger-automations|job-hunt|meetsync)"` across memory → only the intentional `project_workspace-structure.md` remains.
- All 6 `projects/*/CLAUDE.md` now carry a `Domain:` line; the 2 previously-missing files now exist.
- `git diff --stat` → changes confined to root `CLAUDE.md` + 3 project `CLAUDE.md`; memory + global `~/.claude/CLAUDE.md` are outside the repo; the 2 new project CLAUDE.md are untracked. **Zero edits under any `agents/*/.claude/`.**

## Open items for the user
1. Run a ClaudeKit package re-sync to bring `agents/Marketing/` up to the current rule-file version (closes the orchestration/workflow drift at the source).
2. Decide whether to delete legacy on-disk `.env` files now that 1P is canonical.
3. Confirm `Domain: WebDesign` is right for `job-application` (vs cross-cutting / Marketing).
