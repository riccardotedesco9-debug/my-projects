# Phase 08 — Deploy, smoke, rollback

**Priority:** P0 — last phase. Decides go/no-go.
**Status:** Pending
**Depends on:** phases 01–07 complete.

## Preconditions

- [ ] Turn handler + tools compile clean (`npx tsc --noEmit`).
- [ ] All synthetic scenarios from phase 07 pass locally against Trigger.dev dev server.
- [ ] The live-failure chat (13:35–13:39 chat_id 909839972, Diego photo attribution) replays cleanly as a synthetic scenario.
- [ ] `docs/known-limitations.md` updated.
- [ ] Rollback branch tagged.

## Deploy plan (maintenance window — pick 10 minutes when you're not using the bot)

### Step 1: Tag rollback point

```bash
cd "C:/Users/Riccardo/Documents/My Projects"
git tag pre-agentic-rewrite
git push origin pre-agentic-rewrite
```

### Step 2: Reset D1 session state

In-flight sessions rely on the old pipeline. Wipe them — personal bot, zero users → zero blast radius.

```bash
cd meetsync/worker
npx wrangler d1 execute meetsync-db --remote --command="
UPDATE sessions SET status = 'EXPIRED' WHERE status NOT IN ('COMPLETED', 'EXPIRED');
DELETE FROM free_slots WHERE session_id IN (SELECT id FROM sessions WHERE status = 'EXPIRED');
DELETE FROM pending_invites WHERE status = 'PENDING';
UPDATE participants SET state = 'IDLE' WHERE 1=1;
"
```

### Step 3: Deploy Trigger.dev

```bash
cd "C:/Users/Riccardo/Documents/My Projects/meetsync"
rm -rf /c/tmp/trigger-deploy && mkdir -p /c/tmp/trigger-deploy
cp -r ../Engineering/trigger-automations/* /c/tmp/trigger-deploy/
cp -r ../Engineering/trigger-automations/.* /c/tmp/trigger-deploy/ 2>/dev/null
cp -r shared /c/tmp/trigger-deploy/shared
cd /c/tmp/trigger-deploy && npx trigger.dev@latest deploy
```

Expected deploy output: new task `meetsync-turn-handler` registered. Shim `meetsync-message-router` still present (harmless).

### Step 4: Deploy Worker

```bash
cd "C:/Users/Riccardo/Documents/My Projects/meetsync/worker"
npx wrangler deploy
```

The Worker now points at `meetsync-turn-handler`.

### Step 5: Smoke test (live — your real chat_id)

Run the "Diego photo" scenario manually:

1. Send "new" to MeetSync.
2. Send "scheduling with Diego".
3. Send a photo of Diego's schedule (any real image).
4. Say "And this is diegos" (before the bot replies, to simulate the original race).
5. **Expected:** bot correctly attributes the photo to Diego in one try. No loop.

Additional smoke scenarios:
- Send a photo of YOUR OWN schedule + "my hours".
- "When are we free?" after both schedules present.
- "Cancel" mid-session.
- `/status` at every stage.

### Step 6: Delete the shim

Once step 5 is green, delete `Engineering/trigger-automations/src/trigger/meetsync/message-router.ts` and redeploy Trigger.dev. Optional — skip if you want a fallback target for a week.

### Step 7: Commit & push

Conventional commits split by concern:

```
feat(meetsync): add agentic turn-handler replacing state-machine router
refactor(meetsync): unwrap schedule-parser, match-compute, deliver-results as callable fns
refactor(meetsync): slim d1-client, drop getSessionSnapshot + state helpers
chore(meetsync): delete intent-router, state-handlers, intent-handlers, response-generator, session-orchestrator, session-sync, router-helpers
refactor(meetsync/worker): point at meetsync-turn-handler, drop callback_data translation table
docs(meetsync): known v1 limitations after rewrite
```

Each commit should compile. Test after each.

## Rollback

If anything goes wrong in step 5:

```bash
cd "C:/Users/Riccardo/Documents/My Projects"
git checkout pre-agentic-rewrite
# Redeploy OLD Trigger.dev
cd meetsync && rm -rf /c/tmp/trigger-deploy && mkdir -p /c/tmp/trigger-deploy
cp -r ../Engineering/trigger-automations/* /c/tmp/trigger-deploy/
cp -r ../Engineering/trigger-automations/.* /c/tmp/trigger-deploy/ 2>/dev/null
cp -r shared /c/tmp/trigger-deploy/shared
cd /c/tmp/trigger-deploy && npx trigger.dev@latest deploy
# Redeploy OLD Worker
cd "C:/Users/Riccardo/Documents/My Projects/meetsync/worker" && npx wrangler deploy
```

Rollback path uses the existing `meetsync-message-router` task id which still exists in Trigger.dev (old deployments don't get deleted automatically). The `pre-agentic-rewrite` tag pins the code.

## Post-deploy observation window

- **First 24 h:** check `/dashboard` hourly for stuck sessions or `turn_exceeded_tool_cap` events.
- **First week:** run the 30+ synthetic scenarios daily against prod using test chat ids (999999001–999999010).
- **Cost watch:** set a Trigger.dev runs alert at 100 runs/day (far above personal usage baseline).
- **Model watch:** track average tool calls per turn. Target: 2–4. If consistently hitting 6, revisit tool design or iteration cap.

## Success criteria (revisited)

All four from `plan.md`:

1. ✅ The live-failure chat replays cleanly.
2. ✅ 30+ edge cases pass.
3. ✅ Zero `AWAITING_*` state references in dispatch code (enforced by deleting the files in phase 05).
4. ✅ `response-generator.ts` deleted.
5. ✅ Amend works without waitpoint tokens.

## Unresolved questions

1. How long to keep the rollback tag + shim task alive? **One week minimum**, then a manual cleanup pass.
2. Do we want to instrument Anthropic API cost per turn? **Skip for v1** — set a dashboard.anthropic.com hard usage cap instead.
