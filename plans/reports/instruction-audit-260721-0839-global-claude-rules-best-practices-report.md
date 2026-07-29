# Global Instruction-Set Audit — Best Practices & Findings

**Date:** 2026-07-21 · **Scope:** `~/.claude/CLAUDE.md` + 8 `~/.claude/rules/*.md` (ClaudeKit-managed) + workspace `CLAUDE.md` — the ~60KB standing layer injected into every session.
**Method:** ultracode workflow — 3 researchers (Firecrawl-first: Anthropic docs, engineering blog, field sources) → corroborated checklist (kept only if official Anthropic OR ≥2 independent sources) → 7 dimension auditors → adversarial per-finding verification → synthesis. Backup + SHA-256 manifest at `~/.claude/backups/instructions-260721-0827/` taken before any edit.

## TLDR
- (filled after findings synthesis)

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

## 3. Verified findings by dimension

(pending — filled from the audit workflow)

## 4. Edit set applied

(pending)

## 5. Before/after metrics

(pending)

## 6. Fresh-session smoke checklist

(pending)

## Unresolved questions

(pending)
