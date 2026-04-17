---
type: code-review
date: 2026-04-08
scope: MeetSync central hub model overhaul (session codes removed, conversational pairing)
---

# Code Review: MeetSync Central Hub Model

## Scope
- **Files**: message-router.ts (678 LOC), d1-client.ts (289 LOC), intent-router.ts (167 LOC), response-generator.ts (224 LOC), types.ts (94 LOC), 0006-users-and-invites.sql (21 LOC)
- **Total LOC**: ~1,473
- **Focus**: State machine completeness, race conditions, security, edge cases

## Overall Assessment

Solid rewrite. The conversational pairing flow is well-structured, the state machine covers the happy path cleanly, and the static fallback pattern in the response generator is good defensive design. However, there are several medium-to-high severity issues around race conditions, missing validation, and dead code paths.

---

## Critical Issues

### 1. Self-Pairing: No Guard Against Scheduling With Yourself

`handleAwaitingPartnerInfo` never checks if `partnerPhone === phone`. A user who provides their own phone number will be paired with themselves, creating a session with duplicate participants, an instant-complete orchestrator (both "people" confirm instantly because they're the same person), and nonsensical results.

**Fix** (message-router.ts, inside `handleAwaitingPartnerInfo` after phone normalization):
```ts
if (partnerPhone === phone) {
  await sendTextMessage(phone, "That's your own number! Who else do you want to schedule with?");
  return { action: "self_pairing_rejected" };
}
```

Same check needed in `handleReturningPartner` and `handleAcceptInvite` (inviter inviting themselves by entering their own number).

### 2. `findUserByName` LIKE Injection

`findUserByName` passes user input directly into a LIKE pattern:
```ts
`%${name}%`
```
If a user sends `%` or `_` as a name, the LIKE pattern matches ALL users or performs unintended wildcard matching. This is not SQL injection (parameterized queries protect against that), but it is a **data leak** — a user could enumerate all names in the system.

**Fix** (d1-client.ts):
```ts
export async function findUserByName(name: string) {
  const escaped = name.replace(/[%_]/g, '\\$&');
  const result = await query<UserProfile>(
    "SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE",
    [`%${escaped}%`]
  );
  return result.results;
}
```

---

## High Priority

### 3. Race Condition: Simultaneous Invite Acceptance

Two users could message the bot simultaneously. Both hit `handleIdleUser`, both call `getPendingInviteForPhone`, and both proceed to `handleAcceptInvite`. This creates duplicate partner participants for the same session.

**Mitigation**: The `UNIQUE(session_id, phone)` constraint on the participants table will cause the second INSERT to fail. But the code doesn't catch this — it will throw an unhandled D1 error that surfaces as a 500 to the user.

**Fix**: Wrap the participant INSERT in `handleAcceptInvite` and `instantPair` with try/catch to handle the unique constraint violation gracefully (e.g., "You're already paired!").

### 4. Race Condition: Concurrent Session Creation

`handleNewSession` expires old sessions then creates a new one. If two messages arrive rapidly, both expire the old session and both create new sessions for the same phone. `getParticipantByPhone` returns the most recent, so the first session becomes orphaned.

**Mitigation**: The orphaned session will expire naturally via `expires_at`, but the idempotency key on the orchestrator trigger (`orch-${sessionId}`) prevents double orchestration per session. However, the first orchestrator run will wait forever for a second participant that never comes.

**Recommendation**: Add an idempotency key to session creation based on phone + time window, or use `INSERT ... WHERE NOT EXISTS` to prevent duplicate active sessions.

### 5. `decline_invite` Intent is Defined but Never Handled

`decline_invite` exists in the intent list (intent-router.ts line 12) and the system prompt (line 65), but no case in message-router.ts handles it. If Haiku classifies a message as `decline_invite`, it falls through to the `unknown` intent handler and the user gets a generic "I don't understand" response.

**Fix**: Add explicit handling in `handleIdleUser` (after the invite check) or as a global intent:
```ts
if (intent === "decline_invite") {
  const invite = await getPendingInviteForPhone(phone);
  if (invite) {
    await updateInviteStatus(invite.id, "CANCELLED");
  }
  await sendTextMessage(phone, "No problem! Send *new* whenever you want to schedule.");
  return { action: "invite_declined" };
}
```

### 6. `savePartner` Imported but Never Called in message-router.ts

Line 14 imports `savePartner` but it is never used in the file — it is only called in `deliver-results.ts`. Dead import.

### 7. Placeholder `code` Column — Tech Debt

`handleNewSession` and `handleReturningPartner` generate random UUIDs for the `code` column:
```ts
const code = crypto.randomUUID().slice(0, 6).toUpperCase(); // placeholder — column is NOT NULL
```
The sessions table has `code TEXT UNIQUE NOT NULL` and an index on it. Since codes are no longer user-facing, this wastes a unique index on random values. Should be migrated: make `code` nullable or remove the column + index.

---

## Medium Priority

### 8. Phone Number Normalization Gap

The intent router strips non-digits from phone numbers (`text.replace(/[\s\-\(\)\.+]/g, "")`), but this only applies to the fast-path regex match. When Haiku extracts `params.partner_phone`, the message-router strips only non-digits:
```ts
const partnerPhone = String(params.partner_phone).replace(/[^0-9]/g, "");
```
But phone numbers in WhatsApp come in E.164 format (e.g., `35699123456`). If a user types `+356 9912 3456`, the fast-path and Haiku extraction both normalize to `35699123456`. However, if Haiku returns something like `"356-99-123456"`, the normalization works correctly. The concern is that there is **no centralized normalization function** — each callsite strips differently. Consider a shared `normalizePhone()` utility.

### 9. Invite Auto-Accept Bypasses User Consent

When an invitee messages the bot for the first time (any message, even "hello"), `handleIdleUser` auto-accepts the pending invite without asking. The user has no opportunity to decline before being paired. This happens because the invite check runs before intent classification matters.

**Recommendation**: At minimum, check if the intent is `decline_invite` before auto-accepting. Better: show "X invited you to schedule — want to proceed? Yes/No" and wait for confirmation.

### 10. Missing Expiry Check on Invite's Session

`handleAcceptInvite` accepts the invite and pairs users into `invite.session_id`. But the session itself may have expired (via `expires_at`) between when the invite was created and when the invitee messages. The invite's `expires_at` is 7 days, but the session's `expires_at` in `handleNewSession` is only 24 hours.

**Fix**: Check session status/expiry in `handleAcceptInvite` before proceeding:
```ts
const session = await query("SELECT status, expires_at FROM sessions WHERE id = ?", [invite.session_id]);
if (!session.results[0] || session.results[0].status === 'EXPIRED') {
  await updateInviteStatus(invite.id, "EXPIRED");
  await sendTextMessage(phone, "That invite expired. Ask your friend to send *new* again.");
  return { action: "invite_session_expired" };
}
```

### 11. `unknown` Intent Position in Switch Creates Ordering Dependency

The `unknown` intent check on line 124 runs before the state-specific switch. This means if Haiku returns `unknown` for a message in `AWAITING_PARTNER_INFO` state, the user gets a generic reply instead of the partner-info reminder. This is intentional (Haiku already generated a contextual `reply`), but it creates a tight coupling between Haiku's `reply` quality and user experience for misclassified messages.

### 12. No Index on `users.name` for LIKE Queries

`findUserByName` uses `WHERE name LIKE ? COLLATE NOCASE`. On D1/SQLite, LIKE with leading `%` cannot use an index and always does a full table scan. For small user bases this is fine, but it will degrade as the user count grows. Consider adding a normalized name column with an index if search becomes a bottleneck.

---

## Low Priority

### 13. `handleAwaitingPartnerInfo` Re-fetches Participant

Line 273 calls `getParticipantByPhone(phone)` again even though the caller already had the participant object. The participant is passed through the switch case but not to this function.

### 14. `handleAwaitingPartner` Redundantly Handles `cancel_session`

Line 343 checks `intent === "cancel_session"`, but this is already handled as a global intent on line 76. The global check will always fire first. Dead code.

### 15. Session Code Index Remains

`idx_sessions_code` index exists on a column that is now just a random UUID placeholder. Adds write overhead with zero query benefit.

---

## Positive Observations

1. **Static fallback pattern** in response-generator.ts is excellent — the bot never goes silent if the Claude API fails
2. **Parameterized queries everywhere** — no SQL injection vectors via the D1 HTTP API params
3. **Idempotency keys** on orchestrator triggers prevent duplicate orchestration runs
4. **COALESCE logic** in `registerUser` correctly avoids overwriting existing names with null (confirmed: `COALESCE(?, users.name)` with `name ?? null` means null input preserves existing name)
5. **Kill switch** via `MEETSYNC_USE_AI_RESPONSES` env var for fast rollback to static responses
6. **Allowed column whitelist** in `updateParticipantState` prevents arbitrary column injection

---

## Recommended Actions (Priority Order)

1. **[Critical]** Add self-pairing guard in `handleAwaitingPartnerInfo`, `instantPair`, `createPendingInvite`
2. **[Critical]** Escape LIKE wildcards in `findUserByName`
3. **[High]** Handle `decline_invite` intent in message-router
4. **[High]** Add try/catch around participant INSERT for duplicate-key race condition
5. **[High]** Validate invite's session is still active in `handleAcceptInvite`
6. **[Medium]** Consider consent flow for auto-invite acceptance
7. **[Medium]** Centralize phone normalization into a shared utility
8. **[Medium]** Plan migration to remove/nullable the `code` column
9. **[Low]** Remove dead import (`savePartner`), dead code (cancel check in `handleAwaitingPartner`), redundant participant re-fetch

---

## Unresolved Questions

1. Should the invite acceptance be opt-in (show prompt first) or stay auto-accept for frictionless UX?
2. What happens if a user has multiple pending invites from different people? Currently only the most recent is auto-accepted (ORDER BY created_at DESC LIMIT 1). The older invites silently expire. Is that acceptable?
3. The `returning_partner` flow creates a session and notifies the partner without their consent. Should the partner be asked before auto-creating a new session?
