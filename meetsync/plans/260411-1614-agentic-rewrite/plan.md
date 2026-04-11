# MeetSync — Agentic Rewrite

**Created:** 2026-04-11 16:14 CET
**Status:** Phases 01–06 complete on `rewrite/agentic-turn-handler` (5 commits, −1,610 net LOC, both sides compile clean). Awaiting user-driven phase 08 deploy.
**Branch:** `main` (work on `rewrite/agentic-turn-handler` once approved)
**Driver:** router rounds 1–11 kept patching rigidity without removing its cause; real-usage logs (D1 `conversation_log` 2026-04-11 13:35–13:40) prove the bot is worse than raw Claude at following a two-turn conversation about whose photo is whose. Overhaul the orchestration layer. Keep the infrastructure.

## Verdict

- **~50% of the codebase stays** (Worker gateway, D1 schema, schedule parser, match algo, deliver-results, Telegram client, Google OAuth, admin, dashboard).
- **~2,700 LOC gets deleted** and replaced with a single Claude-orchestrated turn handler (~500–700 LOC). The scraps are the intent router, state handlers, intent handlers, response generator scenario table, session orchestrator + session-sync waitpoint dance, and most of message-router.ts.
- Single-user personal tool → no backward compat, wipe the in-flight session rows, ship.

## Phases

| # | File | Scope | Status |
|---|---|---|---|
| 01 | [phase-01-classify-rip-or-keep.md](phase-01-classify-rip-or-keep.md) | Per-file ruthless verdict (scrap/keep/trim) | ✅ Done — diagnosis report at `reports/diagnosis-rigidity-root-cause.md` |
| 02 | [phase-02-tool-schema-and-contract.md](phase-02-tool-schema-and-contract.md) | Design the ~8 Anthropic tools the turn handler exposes | ✅ Done — implemented in `turn-handler-tools.ts` (commit dd6879b) |
| 03 | [phase-03-turn-handler-core.md](phase-03-turn-handler-core.md) | Build `turn-handler.ts` — the agentic loop replacing message-router | ✅ Done — `turn-handler.ts` 462 LOC + snapshot 167 LOC + tools 825 LOC (commit dd6879b) |
| 04 | [phase-04-unwrap-reusable-modules.md](phase-04-unwrap-reusable-modules.md) | Make schedule-parser, match-compute, deliver-results callable as plain async functions (not only Trigger.dev tasks) | ✅ Done — `extractSchedule`, `computeOverlaps`, `deliverMatchToSession`, `loadSnapshot` added (commit 00e6c6b) |
| 05 | [phase-05-rip-the-rot.md](phase-05-rip-the-rot.md) | Delete intent-router, state-handlers, intent-handlers, response-generator, router-helpers, session-orchestrator, session-sync. Rewrite message-router as the thin dispatch to turn-handler | ✅ Done — 7 files deleted, 3,272 LOC removed (commit fd5e0e9) |
| 06 | [phase-06-worker-and-schema-cleanup.md](phase-06-worker-and-schema-cleanup.md) | Point Worker at the new task ID, drop dead D1 columns | ✅ Done — Worker triggers `meetsync-turn-handler` directly, shim deleted (commit 016d65b). D1 column cleanup deferred per YAGNI. |
| 07 | [phase-07-edge-case-coverage.md](phase-07-edge-case-coverage.md) | Enumerate 30+ user archetypes & edge cases, map each to the agentic flow, extend synthetic webhook scenarios to cover them | ⚠️ Partial — archetypes documented, synthetic test rewrite deferred. See `meetsync/tools/test-scenarios/PENDING-AGENTIC-REWRITE.md`. Manual smoke covers usage. |
| 08 | [phase-08-deploy-smoke-rollback.md](phase-08-deploy-smoke-rollback.md) | Deploy plan, smoke-test flow, rollback procedure | ⏳ Awaiting user — branch pushed (`origin/rewrite/agentic-turn-handler`), rollback tag `pre-agentic-rewrite` set on `main`. User runs deploy + Diego-attribution smoke when ready. |

## Reports

- [reports/diagnosis-rigidity-root-cause.md](reports/diagnosis-rigidity-root-cause.md) — Explore agent's smoking-gun analysis (file:line references for each failure mode in the live chat log)

## Key Dependencies

- **Model upgrade:** turn handler uses **Claude Sonnet 4.6** (`claude-sonnet-4-6`) instead of Haiku. Latency ~2–5 s per turn (acceptable; Telegram shows the typing indicator). Cost ~1.5 ¢/turn — negligible for personal use.
- **Anthropic tool use API:** already available via the messages API; no SDK changes needed.
- **No new infra:** still Cloudflare Worker → Trigger.dev → D1. No new services.

## Success Criteria

1. The live chat that failed today (13:35–13:40 chat_id 909839972) replays cleanly: bot correctly attributes Diego's photo to Diego on first try, or asks one clarifying question and never loops.
2. All 30+ edge cases in phase-07 pass their synthetic scenarios.
3. No `AWAITING_*` state checks anywhere in dispatch code. State lives in D1 rows, period.
4. `scenarios` table in `response-generator.ts` no longer exists.
5. Amend-after-match works without waitpoint tokens.

## Out of Scope

- Rewriting the schedule parser (it works).
- Rewriting match-compute (the algorithm is correct).
- New features (mediator improvements, calendar features, multi-person UX polish). Do those later on a clean foundation.
- Multi-tenant / productization — still a personal tool, keep YAGNI.
