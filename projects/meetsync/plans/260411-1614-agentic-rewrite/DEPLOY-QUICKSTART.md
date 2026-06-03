# Deploy quickstart — agentic turn-handler rewrite

Run these in order in a maintenance window. ~10 minutes total. Stop and rollback at any failure.

## Pre-flight

```bash
cd "C:/Users/Riccardo/Documents/My Projects"
git fetch --all --tags
git status                        # should be clean
git log --oneline main..origin/rewrite/agentic-turn-handler   # should show 5 commits
git tag --list pre-agentic-rewrite # should print the tag (already pushed)
```

## Step 1 — Wipe in-flight D1 sessions

The new handler ignores `participants.state`. Half-state rows from the old pipeline would otherwise confuse the snapshot.

```bash
cd meetsync/worker
npx wrangler d1 execute meetsync-db --remote --command="
UPDATE sessions SET status = 'EXPIRED' WHERE status NOT IN ('COMPLETED', 'EXPIRED');
DELETE FROM free_slots WHERE session_id IN (SELECT id FROM sessions WHERE status = 'EXPIRED');
DELETE FROM pending_invites WHERE status = 'PENDING';
"
```

## Step 2 — Deploy Trigger.dev

```bash
cd "C:/Users/Riccardo/Documents/My Projects/meetsync"
rm -rf /c/tmp/trigger-deploy && mkdir -p /c/tmp/trigger-deploy
cp -r ../Engineering/trigger-automations/* /c/tmp/trigger-deploy/
cp -r ../Engineering/trigger-automations/.* /c/tmp/trigger-deploy/ 2>/dev/null
cp -r shared /c/tmp/trigger-deploy/shared
cd /c/tmp/trigger-deploy && npx trigger.dev@latest deploy
```

Expected: `meetsync-turn-handler` registers, old task ids (message-router, schedule-parser, match-compute, deliver-results, session-orchestrator) disappear from the deployment.

## Step 3 — Merge + deploy Worker

Two ways:

**A. Merge to main first (cleaner):**
```bash
cd "C:/Users/Riccardo/Documents/My Projects"
git checkout main
git merge --no-ff rewrite/agentic-turn-handler
git push origin main
cd meetsync/worker && npx wrangler deploy
```

**B. Deploy from the branch directly (if you want to test before merging):**
```bash
git checkout rewrite/agentic-turn-handler
cd meetsync/worker && npx wrangler deploy
# After smoke passes:
git checkout main && git merge --no-ff rewrite/agentic-turn-handler && git push
```

## Step 4 — Live smoke (the Diego replay)

Open Telegram, message MeetSync as your real account:

1. Send `new`
2. Send `scheduling with Diego`
3. Send a photo of Diego's actual schedule (or any test image)
4. **Immediately** send `And this is diegos`

**Expected:** bot's first reply correctly attributes the photo to Diego. Either:
- "Got it — pulled out Diego's shifts: ..." (best case)
- "Quick check — is this Diego's schedule? Looks like it from your message." (fine — one clarification, no loop)

**Failure modes to watch for:**
- Bot says "I don't see a file attached" → media handling broken
- Bot saves shifts as YOUR schedule → attribution broken
- Bot loops asking for the schedule again → state ignored

If the smoke fails, rollback (step 6).

## Step 5 — Watch the dashboard for an hour

```
https://meetsync-worker.<your-subdomain>.workers.dev/dashboard?token=<TELEGRAM_WEBHOOK_SECRET>
```

Look for:
- `turn_exceeded_tool_cap` events (model hit the 6-iteration cap → tool design problem)
- Stuck sessions (the dashboard's stuck-session query — should be empty)
- `claude_api_error` events (Anthropic outage or auth issue)

## Step 6 — Rollback (if needed)

```bash
cd "C:/Users/Riccardo/Documents/My Projects"
git checkout pre-agentic-rewrite

# Redeploy old Trigger.dev
cd meetsync && rm -rf /c/tmp/trigger-deploy && mkdir -p /c/tmp/trigger-deploy
cp -r ../Engineering/trigger-automations/* /c/tmp/trigger-deploy/
cp -r ../Engineering/trigger-automations/.* /c/tmp/trigger-deploy/ 2>/dev/null
cp -r shared /c/tmp/trigger-deploy/shared
cd /c/tmp/trigger-deploy && npx trigger.dev@latest deploy

# Redeploy old Worker
cd "C:/Users/Riccardo/Documents/My Projects/meetsync/worker"
git checkout pre-agentic-rewrite -- src/handle-message.ts
npx wrangler deploy
git checkout main -- src/handle-message.ts   # restore working tree
```

The rollback path uses code from before the rewrite (when the old `meetsync-message-router` task body still existed). One redeploy each.

## Costs to expect

- Per-turn: typical $0.05–$0.10, worst-case $0.30–$0.40 (Sonnet 4.6 with 2-6 tool calls and growing context).
- Daily at 20 turns/day: ~$1–$2.
- Set a hard cap on dashboard.anthropic.com if you're nervous.

## After deploy is stable (week+)

Optional cleanups, none blocking:
- Delete dead helpers in `d1-client.ts` (`getSessionSnapshot`, `getReplyContext`, `getOtherParticipants`, etc — see project memory `project_meetsync-next-steps.md`).
- Drop dead D1 columns: `participants.state`, `sessions.both_*_token_id`, `sessions.match_attempt`.
- Rewrite synthetic test scenarios (see `meetsync/tools/test-scenarios/PENDING-AGENTIC-REWRITE.md`).
- Delete dead WhatsApp secrets on the Worker (predates this rewrite).
