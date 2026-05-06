# MeetSync — whole-stack code review (260505-2338)

## Verdict: SHIP-WITH-FIXES

Stack is healthy. Two BLOCKERs (one referencing a dropped table on the admin path; one cross-user data leak via per-name calendar fan-out) and a handful of SERIOUS races + correctness slips. None affect the happy path; all bite under realistic edge cases.

---

## Security

### B1 — admin `list_users` queries dropped table  [BLOCKER]
`meetsync/worker/src/handle-message.ts:350` — `SELECT DISTINCT chat_id FROM participants ORDER BY created_at DESC LIMIT 50`. `participants` was dropped in migration 0020. Any admin "users / who" message that hits the Haiku classifier returns 500 silently (rate-limit and other admin paths still work, so admin doesn't notice until they ask).
→ Switch to `SELECT chat_id FROM users ORDER BY last_seen DESC LIMIT 50` or remove the action.

### B2 — `compute_overlap` calendar fan-out is a cross-user GCal read  [BLOCKER]
`turn-handler-tools.ts:895-910` — for every linked contact, the caller's compute_overlap pulls each contact's full calendar via `listCalendarEventsInWindow(contact.linked_chat_id, …)` and stuffs raw event titles + locations as labels into `schedules` passed to `computeOverlaps`. The labels then end up in `schedules_summary` returned to Claude (and from there into reply text). The privacy rule in the system prompt asks Claude to abstract sensitive cross-person events, but here we're handing it the literal titles. `enrichSnapshotWithCalendarEvents` does the same merge into `personNotes`, so contacts' raw "Therapy with Dr. X" titles and `@ Mater Dei` locations are already in [STATE]. Single LLM step from leaking. Same exposure on `gatherBusyBlocksForDate` (book_meetup conflict reason quotes the busy `label`, e.g. `"busy calendar: Therapy (15:00–16:00)"`) which goes back to Claude as `conflicts[].reason` and easily into the user-facing reply.
→ Treat any non-self calendar source as opaque: store a sanitised label (`"calendar (busy)"` + duration) for cross-user merges; keep the rich label only for the caller's own row. Same for the `conflicts` reason on attendees.

### S1 — admin classifier is itself a Sonnet/Haiku call gated by string-match  [SERIOUS]
`handle-message.ts:367-405` — admin path triggers when the chat_id matches `ADMIN_CHAT_ID` AND the text contains any of `block / unblock / remove / ban / kick / who / users / list / allowed`. Because the admin user shares the bot in normal conversations, ordinary words like "block out 6pm", "I cancelled my list of …" trip the classifier and burn an Anthropic call per turn. Low-impact (it returns "not_admin" eventually) but it muddles admin behaviour vs end-user behaviour for the same chat.
→ Require an explicit prefix like `/admin <command>`.

### S2 — webhook dashboard token = webhook secret  [SERIOUS]
`worker/src/index.ts:47, 59` — `/dashboard?token=` and `/setup-webhook?token=` accept the same shared secret as Telegram's `X-Telegram-Bot-Api-Secret-Token`. If the dashboard URL ends up in a browser history / referer / screenshot, the webhook auth is compromised at the same time. Already noted in a comment but not fixed.
→ Separate `DASHBOARD_TOKEN` env.

### M1 — `setup-webhook` GET-triggered side effect  [MINOR]
`worker/src/index.ts:57` — `/setup-webhook` is reachable on GET (no method check) and calls Telegram's setWebhook with the secret in the body; secret is also in the URL token. Pre-fetchers and link-preview crawlers will run it. Idempotent today, but a slip-up turning it into a deletion path bites.
→ Require POST.

---

## Concurrency

### S3 — `persistShifts` per-date merge is read-modify-write with no CAS  [SERIOUS]
`turn-handler-tools.ts:480-602` reads `ctx.snapshot.user.latest_schedule_json` (loaded at turn start), computes merge, writes back with `updateUserLatestSchedule`. Two concurrent turns for the same chat (e.g. burst grace on a 3-image upload where one slips through, or a parse_schedule loop concurrently with a book_meetup that calls `appendBusyBlockToUser`) both read the same snapshot, both compute, both write — last-writer wins, the other's dates silently lost. Burst grace narrows but doesn't close the window (1.2s sleep, then if your log is still latest you proceed; another turn that started after your sleep is still in flight).
→ Either route writes through a turn-scoped lock (D1 row-version compare-and-swap on `users.schedule_version`), or coalesce all schedule writes into the latest tool call only.

### S4 — `appendBusyBlockToUser` / `removeBusyBlockFromUser` same RMW issue  [SERIOUS]
`d1-client.ts:560-625` — same pattern: full read of `latest_schedule_json`, parse, mutate, write. `book_meetup`'s "for each attendee, append busy block" loop runs sequentially per attendee but races against any of those attendees' own concurrent turns.
→ Ideally a single SQL `UPDATE users SET latest_schedule_json = json_insert(...)` (D1 SQLite supports JSON1 functions); failing that, retry-on-stale.

### S5 — fire-reminders cron `*/5 * * * *` vs comment "every minute"  [SERIOUS]
`fire-reminders.ts:31` cron is `*/5 * * * *` but the file header (line 2) says "Runs every 5 minutes" while the orchestration prompt (and `meetsync/CLAUDE.md`) describe the cron as "every minute". Comment in the doc-CLAUDE is stale. Functional impact: a reminder set "in 2 min" can fire up to 7 min late. Worse, a one-shot reminder targeted at a non-recurring boundary (e.g. "remind me at 09:00") fires somewhere in 09:00–09:04 — fine for nudges, surprising for users.
→ Either drop the cron to `* * * * *` (D1 traffic is now small) or update docs/system-prompt to match.

### S6 — `cleanup-conversation-log` runs while users are mid-turn  [SERIOUS]
`cleanup-conversation-log.ts:32-37` — DELETE selects last 50 rows by `created_at DESC` then deletes the rest. If the cron lands between Worker pre-log (insert) and turn-handler `getRecentMessages`, a small chat (<50 rows) is unaffected, but a large chat that just crossed 50 sees its newest insert as the kept-set and an in-flight turn that read `recentHistory` before the DELETE may see a now-missing prior context (only matters if the cron lands inside the 1.2s burst-grace window, ~rare). Real risk is duplicate-key chat_ids: the outer `SELECT chat_id, COUNT(*)…` runs one batch but the inner DELETE re-evaluates the now-current 50, so a chat actively chatting at 03:00 UTC may have ITS in-flight insert deleted because the inner LIMIT 50 ranks it lower than 50 older rows. Ordering by `created_at DESC` does keep newest, so probably fine — but `created_at` defaults to `datetime('now')` (1-second resolution) and ties break by `id` only because of `LIMIT 50`'s implicit ordering, which isn't guaranteed.
→ `ORDER BY created_at DESC, id DESC` to make tie-breaking explicit; cron in 04:00 UTC won't move the needle, but the explicit secondary sort is ~free insurance.

### M2 — `linkPersonNoteToChat` race vs `linkShadowedPersonNotesByPhone`  [MINOR]
`d1-client.ts:241-265` checks `existing.linked_chat_id` then UPDATEs unconditionally. If a phone-shadow batch resolution and an explicit `add_contact` race for the same person, both pass the check (existing is null/same) and both update — fine because they write the same chat_id. Becomes a problem only if the user re-uses a phone for a different person; then `linkPersonNoteToChat` may overwrite a shadow-resolved different chat_id. Low likelihood.
→ Add `WHERE id = ? AND (linked_chat_id IS NULL OR linked_chat_id = ?)` so the UPDATE is atomic.

### M3 — bot-wide Telegram throttle is per-process, not per-isolate  [MINOR]
`telegram-client.ts:32-57` keeps `sendTimestamps[]` in module scope. Trigger.dev v4 spawns isolated workers; the throttle is per-worker only. Under burst load multiple workers each maintain their own bucket of 25 — Telegram-side rate limit at ~30/s/bot is the real cap and will start 429-ing.
→ Accept the 429 retry path (`sendTextMessage` already throws on 4xx), or move throttle to a Redis/D1 token bucket.

---

## Correctness

### S7 — `enrichSnapshotWithCalendarEvents` window starts at "today" UTC  [SERIOUS]
`turn-handler.ts:365-366` — `todayISO = new Date().toISOString().slice(0,10)`. For a Pacific user mid-evening UTC-still-shows-tomorrow case, the window starts on a date the user considers "tomorrow", missing today's remaining events. Same comment is flagged as covered (M4) but the issue is broader: `compute_overlap` also uses the same `new Date().toISOString()` window in `turn-handler-tools.ts:891`. Single source of truth needed.
→ Use `todayInTimezone(snapshot.timezone)` once, route both sites through it.

### S8 — `gatherBusyBlocksForDate` skips overnight calendar events on next-day target  [SERIOUS]
`turn-handler-tools.ts:140-202` — pulls calendar events for `[prevDate, date]` window, then `pushShiftBlock` on each. But Google calendar events are emitted with `end_time = "23:59"` if cross-day (`google-calendar.ts:181`). So an overnight calendar event 22:00–06:00 stored as start=22:00,end=23:59 on date X is NOT marked overnight (`end < start` is false), and the prevDate→date spill is silently lost.
→ Calendar overnight needs explicit two-block emission (matches what the schedule-parser does for shifts), or keep the original cross-day end and let `pushShiftBlock` see `end < start`.

### S9 — `computeNextRecurrence` uses UTC arithmetic  [SERIOUS]
`d1-client.ts:1075-1080` — TODO comment acknowledges DST drift. Acceptable for v1 per the comment, but it's a multi-month-old TODO and users are growing.
→ Re-anchor in user's IANA tz: parse fire_at into local components, increment, reconvert to epoch.

### S10 — `book_meetup` conflict check timezone is `resolveCallerTimezone(ctx)` only  [SERIOUS]
`turn-handler-tools.ts:1602, 1629` — both caller and attendee busy blocks are gathered in caller's tz. If the attendee lives in a different tz and has a calendar event in their local tz, the `listCalendarEventsInWindow` call passes the *caller's* tz so Google returns wall-clock times in the caller's tz; the HH:MM emitted is for caller's view. Fine for the conflict check (the meeting itself is set in caller's tz too), but the bot-side `appendBusyBlockToUser` then writes that same caller-tz HH:MM into the attendee's `latest_schedule_json` — which the attendee's own next turn renders in *their* tz. Drift on cross-tz attendees.
→ Per-attendee tz lookup before append; or store the busy block as UTC and convert on render.

### S11 — `findCalendarEventsOnDate` uses `T00:00:00Z` / `T23:59:59Z` literal day window  [SERIOUS]
`google-calendar.ts:277-279` — for a non-UTC user, the UTC-day window misses events at the day's edges in their local tz. A 23:30 Malta event the day before is in scope when the user asks "what's on tomorrow" if they meant local tomorrow.
→ Same fix as S7; resolve the day in caller's tz then convert each end to UTC.

### M4 — overnight-shift logic in `gatherBusyBlocksForDate` doesn't check `prevDate` for stored shifts  [MINOR]
`turn-handler-tools.ts:177` — `if (s.date === prevDate)` checks but the parent loop iterates `parsed` which is everyone's shifts including yesterday's; fine. But the helper accepts `prevDate` only inside `pushShiftBlock`, not for non-overnight shifts that legitimately end at 23:59 on prevDate. Edge case rare enough to flag-not-fix.

### M5 — public-holiday list in system prompt is hardcoded Malta-only  [MINOR]
turn-handler.ts: the holiday rule fires for users in any timezone. A user in Italy gets "looks like a public holiday" on Malta-specific dates that aren't holidays in Italy.
→ Conditional on `timezone === "Europe/Malta"` or pull a per-tz holiday list.

---

## Error handling

### M6 — tools sometimes return raw `{error: ...}` and sometimes `{ok: false, error}`  [MINOR]
`turn-handler-tools.ts:318-322` (parse_schedule direct path returns `{ ok: false, error }`); `turn-handler-tools.ts:813` (forget_contact returns `{ error }`). Claude sees `is_error` flag from the JSON-stringify check (`turn-handler.ts:838`: `is_error: typeof result.error === "string"`) — so both shapes are caught. Just inconsistent.
→ Pick one shape for the contract.

### M7 — `Anthropic` call has no timeout  [MINOR]
`turn-handler.ts:543-557` — fetch without AbortController. A hung Anthropic socket stalls the whole turn until Trigger.dev's 300s `maxDuration` cap.
→ Add 60s AbortController per `callClaude` iteration.

### N1 — `transcribe.ts` `audioBytes = [...new Uint8Array(audioBuffer)]`  [NIT]
`transcribe.ts:44` — array spread on a possibly multi-MB buffer is O(n) memory + GC pressure on the worker isolate.
→ `Array.from(new Uint8Array(audioBuffer))` is identical; better, pass the `Uint8Array` directly if `env.AI.run` accepts it.

### N2 — `extractPayload` doesn't normalize empty `text.trim()`  [NIT]
`handle-message.ts:464-471` — if user sends just whitespace, returns `{message_type: "text", text: ""}` and the turn handler treats it as a real turn.

---

## Performance

### M8 — `book_meetup` does N serial `getUser` calls for emails  [MINOR]
`turn-handler-tools.ts:1668-1672` and 1687-1690 (twice) — one `getUser` per attendee both for email gathering and for marking-as-booked. With 5+ attendees that's ~10 D1 round-trips serially.
→ Single `SELECT chat_id, email FROM users WHERE chat_id IN (...)` upfront, dictionary lookup after.

### M9 — `cleanup-conversation-log` correlated subquery still per-chat  [MINOR]
`cleanup-conversation-log.ts:30-38` — `DELETE … WHERE id NOT IN (SELECT id … LIMIT 50)` is run per chat. Better than the on-write version (it's now off the hot path, as advertised) but still does a self-subquery per chat. Cron is once a day, 03:00 UTC, so fine; flag only if D1 storage timeouts return.

### M10 — `compute_overlap` calendar fan-out is N serial D1+Google calls  [MINOR]
`turn-handler-tools.ts:901-910` — one `listCalendarEventsInWindow` per source, awaited in a `for` loop. Power user with 10 linked contacts: 10 sequential round-trips after `enrichSnapshotWithCalendarEvents` already did this for the snapshot.
→ Either reuse the snapshot's already-enriched calendar events (they're in `personNotes[].schedule_json`) instead of re-fetching, or `Promise.all` the loop.

---

## Maintainability

### M11 — schedule JSON parse-and-validate is open-coded in 5+ places  [MINOR]
`mergeShiftsByDate` (turn-handler-tools), `appendBusyBlockToUser` / `removeBusyBlockFromUser` (d1-client), `enrichSnapshotWithCalendarEvents` (turn-handler), `gatherBusyBlocksForDate` (turn-handler-tools), `query_schedule_history` (turn-handler-tools), `renderShiftListCompact` (snapshot), `addPersonSchedule` (turn-handler-tools). Each does its own try/JSON.parse/Array.isArray dance with subtly different fall-through. Single helper `parseScheduleBlob(json: string|null): Shift[] | "corrupt"` collapses ~50 LOC and centralises corruption telemetry.

### M12 — `Snapshot.activeSessions` always `[]`, used as a defensive `?.[0]` everywhere  [MINOR]
`turn-handler.ts:760, 813, 829, 853, 863` and ~6 sites in turn-handler-tools — `snapshot.activeSessions[0]?.session.id ?? "no-session"`. Vestigial. Drop the field, drop the placeholder.

### M13 — `dashboard.ts` reads dropped tables every request  [MINOR]
`worker/src/dashboard.ts:155-205` — three queries against `sessions`, `session_events`, `participants`. Two of those tables are gone (0020); `session_events` survives. Each `safe()` swallows the error and silent-renders empty. Wastes one D1 RTT per dashboard load and shows an apology banner. Dashboard rework was scheduled separately per the comment but hasn't landed.
→ Either retire the dashboard endpoint or rewrite to query users / person_notes / reminders.

### N3 — unused export `probeCallerCalendarHealth` is just `getFreshAccessToken`  [NIT]
`google-calendar.ts:365-367` — fine, but the helper does a token-refresh as a side effect. Naming "probe" suggests read-only.
→ Rename or split.

---

## Tests

### M14 — concurrent uploads not in test harness  [MINOR]
27 scenarios cover sequence cases. No scenario fires two parse_schedule turns within the burst-grace window simultaneously to validate that the merge survives. S3/S4 above are precisely what's missing coverage.
→ Add scenario: send three image uploads with overlapping dates within 1s; assert final state has all distinct dates merged, none lost.

### M15 — OAuth refresh failure paths untested  [MINOR]
`callerCalendarRefreshFailing`, `callerCalendarTokenInvalid` flags are set in `enrichSnapshotWithCalendarEvents` and read in snapshot formatter, but no scenario simulates a 401/invalid_grant from Google's token endpoint.

### M16 — voice-with-transcript-empty fallback untested  [MINOR]
`turn-handler.ts:701-703` — synthesises a `[VOICE_NOTE_RECEIVED — transcription empty…]` marker. Not asserted in any agentic-Lx scenario.

---

## Unresolved questions

1. S5 cron interval: was the change to `*/5` deliberate (to dodge D1 quotas), or stale? If deliberate, system prompt and CLAUDE.md need updating.
2. B2 privacy: is the existing "Claude abstracts sensitive titles" rule considered a real boundary, or just best-effort guidance? If real, the data needs to be sanitised before reaching Claude, not after. Confirm intent.
3. S3/S4 concurrency: is multi-turn-per-chat parallelism actually possible after burst-grace? If burst-grace is provably tight (no two turns ever survive past the bail check for the same chat in the same second), the RMW is effectively single-writer and these can be downgraded.
4. M13 dashboard: is the planned rework still in scope, or should the route 410?
