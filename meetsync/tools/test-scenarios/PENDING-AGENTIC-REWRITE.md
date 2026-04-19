# Pre-rewrite scenarios — archived

The five `scenario-0N-*.sh` files that used to live here have been deleted.
They asserted on exact substrings from a response-generator table that no
longer exists, and seeded `participants.state` rows in a table that was
dropped in migration 0020. They cannot be made to pass against the agentic
turn-handler without a full rewrite.

## What replaces them

The new suite is `agentic-LN-<slug>.sh` in this directory. It uses:

- **Claude Haiku as judge** (`_judge.sh`) — matches reply intent, not wording.
- **D1 outcome asserts** (`_lib.sh` helpers) — verifies what actually
  landed in the database.
- **Post-rewrite schema only** — no references to `sessions`,
  `participants`, `pending_invites`, `free_slots`.

Run every scenario with `./run-all.sh` or a subset with `./run-all.sh L1`.

## Why not keep the old ones

Two structural reasons from the original rewrite note still apply:

1. **Bot replies are LLM-generated, not template-driven.** Static substring
   assertions break on every minor persona tweak.
2. **The participant state machine is gone.** Seeded `participants.state`
   values are not read by the turn-handler; scenarios that rely on that
   setup silently pass while not actually exercising anything.

The new suite is scaffolded to cost ~$0.02 per full run (Haiku judge calls)
and take ~5-10 min end-to-end.

## Layers (see `meetsync-stress-test-and-harden.md` plan for full taxonomy)

- L1 — today's four-symptom regression
- L2 — per-tool golden path
- L3 — persona principles
- L4 — input/state edges
- L5 — chaos (fault injection)
- L6 — integration flows
- L7 — scale
- L8 — observability
