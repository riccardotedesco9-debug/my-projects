# Test scenarios pending rewrite

After the agentic turn-handler rewrite (branch `rewrite/agentic-turn-handler`,
phases 04–06), the existing scenarios in this directory will FAIL against
the new bot for two structural reasons:

1. **Bot replies are LLM-generated, not template-driven.** Old scenarios
   assert on exact substrings from `response-generator.ts`'s static
   fallback table (which has been deleted). The new bot's replies are
   composed by Claude Sonnet on every turn, so wording varies and exact
   matching breaks.

2. **The participant state machine is gone.** Old scenarios — and the
   `_lib.sh` `seed_confirming_session` helper — set
   `participants.state = 'AWAITING_CONFIRMATION'` and similar values to
   stage flows. Nothing reads `participants.state` anymore. The state
   column still exists in D1 (YAGNI — left in place) but is no longer
   load-bearing. Seeding it doesn't affect bot behaviour.

## What needs to change

Each scenario must be reworked to either:

- **Keyword-contains assertions** instead of exact-substring. e.g.
  `assert_bot_reply_contains "$chat" "schedule"` matches any reply
  mentioning "schedule" rather than the exact "Got it! Parsing your
  schedule..." string.

- **Haiku-as-judge assertions** for scenarios where the reply meaning
  matters more than wording. A small Haiku call (`~$0.0002 per
  assertion`) decides whether the bot's reply is appropriate for the
  expected behaviour. Cheaper than maintaining brittle string match
  tables.

- **Drop seeded-state setup.** Replace `seed_confirming_session` with a
  conversational stand-up where the test sends a real schedule message
  and lets the parser run. Slower per scenario (~3-5 s extra Sonnet
  call) but matches how the bot actually works.

## Until then

The scenarios are kept on disk but **MUST NOT** be used as smoke tests
against the new turn-handler. Run them only against the legacy branch
(`pre-agentic-rewrite` tag, when it exists) for historical comparison.

Live smoke testing of the new bot uses the user's real chat_id with the
specific Diego-attribution scenario from
`plans/260411-1614-agentic-rewrite/phase-08-deploy-smoke-rollback.md`.

## Priority

This blocks turning automated CI back on. Personal-tool usage doesn't
need it — manual smoke through Telegram covers the user's actual flow.
Rewrite when you want CI back.
