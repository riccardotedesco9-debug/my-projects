// Session synchronization — round-6 race fix lives here.
//
// This module owns the code that turns "a participant changed state" into
// "the orchestrator wakes at the right gate". Before round 6 the router
// triggered the orchestrator fire-and-forget and then polled the sessions
// row for waitpoint token IDs the orchestrator hadn't yet created. Under
// Trigger.dev cold-start latency the poll window expired silently and
// sessions got stuck in PAIRED forever.
//
// The new contract: waitpoint tokens are created by `spawnOrchestrator`
// BEFORE the orchestrator task runs, stored on the sessions row, and passed
// into the orchestrator via payload. The orchestrator waits on tokens that
// already exist. Zero polls, zero sleeps.
//
// See also:
//   - session-orchestrator.ts: consumes the token IDs, checks the cancelled
//     sentinel, and has the ghost-reminder match_attempt guard
//   - migrations/0012-router-owned-tokens.sql: adds sessions.match_attempt
//   - tools/test-scenarios/scenario-01-happy-2-person.sh: end-to-end proof

import { wait } from "@trigger.dev/sdk";
import {
  query,
  getSessionParticipants,
  updateParticipantState,
  updateSessionStatus,
  getSessionById,
  getUser,
  getReplyContext,
  emitSessionEvent,
} from "./d1-client.js";
import { sendTextMessage } from "./telegram-client.js";
import { generateResponse } from "./response-generator.js";
import { sessionOrchestrator } from "./session-orchestrator.js";

/**
 * Create waitpoint tokens for a session's two gates and kick off a fresh
 * orchestrator run that will wait on them. Safe to call repeatedly for the
 * same session: Trigger.dev idempotency keys (versioned by match_attempt)
 * dedupe duplicate spawns.
 *
 * The idempotency keys must change on each match attempt because
 * `wait.createToken` returns the ORIGINAL waitpoint when a key is reused —
 * even if that waitpoint has already been completed. Without versioning,
 * the amend flow would get back the stale completed token and its forToken
 * call would return immediately, breaking the rematch.
 */
export async function spawnOrchestrator(sessionId: string): Promise<void> {
  const row = await query<{ match_attempt: number }>(
    "SELECT match_attempt FROM sessions WHERE id = ?",
    [sessionId]
  );
  const attempt = row.results[0]?.match_attempt ?? 0;

  const confirmedToken = await wait.createToken({
    idempotencyKey: `confirmed-${sessionId}-v${attempt}`,
    timeout: "7d",
  });
  const preferredToken = await wait.createToken({
    idempotencyKey: `preferred-${sessionId}-v${attempt}`,
    timeout: "4h",
  });

  await query(
    "UPDATE sessions SET both_confirmed_token_id = ?, both_preferred_token_id = ? WHERE id = ?",
    [confirmedToken.id, preferredToken.id, sessionId]
  );

  await sessionOrchestrator.trigger(
    {
      session_id: sessionId,
      confirmed_token_id: confirmedToken.id,
      preferred_token_id: preferredToken.id,
      match_attempt: attempt,
    },
    { idempotencyKey: `orch-${sessionId}-v${attempt}` }
  );

  await emitSessionEvent(sessionId, "orchestrator_spawned", { match_attempt: attempt });
}

/**
 * Cancel whichever gate the current orchestrator is parked at and spawn a
 * fresh orchestrator to rerun matching. Used by the amend flow: when a
 * user edits their schedule after a match was already delivered, we don't
 * want two competing matching pipelines running in parallel, and we don't
 * want the old orchestrator to eventually fire a bogus "expired" message
 * on top of the successful rematch.
 *
 * Gate resolution is by session status:
 *   PAIRED / MATCHING → old orchestrator at gate A (confirmed)
 *   MATCHED           → old orchestrator at gate B (preferred)
 *   COMPLETED         → parked on `wait.until(reminderDate)` which has no
 *                       token; the match_attempt check in the orchestrator
 *                       handles that case on wake.
 */
export async function restartOrchestratorForAmend(
  sessionId: string,
  previousStatus: string,
): Promise<void> {
  const existing = await query<{
    both_confirmed_token_id: string | null;
    both_preferred_token_id: string | null;
  }>(
    "SELECT both_confirmed_token_id, both_preferred_token_id FROM sessions WHERE id = ?",
    [sessionId]
  );
  const oldConfirmed = existing.results[0]?.both_confirmed_token_id;
  const oldPreferred = existing.results[0]?.both_preferred_token_id;

  // Cancel the currently-parked gate so the old orchestrator exits cleanly.
  // Wrapped in try/catch because SDK behavior on double-complete is
  // undocumented; if it turns out to be a pure no-op we can drop the catch.
  try {
    if (["PAIRED", "MATCHING"].includes(previousStatus) && oldConfirmed) {
      await wait.completeToken(oldConfirmed, { cancelled: true });
    } else if (previousStatus === "MATCHED" && oldPreferred) {
      await wait.completeToken(oldPreferred, { cancelled: true });
    }
  } catch (err) {
    console.warn(`[amend] completeToken for ${sessionId} failed (probably already completed):`, err);
  }

  // Bump match_attempt so fresh tokens use a new idempotency key version.
  // Null out the old IDs at the same time for sanity.
  await query(
    `UPDATE sessions
        SET match_attempt = match_attempt + 1,
            both_confirmed_token_id = NULL,
            both_preferred_token_id = NULL
      WHERE id = ?`,
    [sessionId]
  );

  await emitSessionEvent(sessionId, "amend_restart", { previous_status: previousStatus });
  await spawnOrchestrator(sessionId);
}

/**
 * Called whenever a participant's state changes to SCHEDULE_CONFIRMED. If
 * all participants in the session are confirmed, wake the orchestrator.
 *
 * Three cases:
 *   A) Fresh session, status=OPEN — spawn the orchestrator (first match).
 *   B) Session already running and someone re-confirmed after an amend —
 *      cancel the parked orchestrator and spawn a fresh one. Covers the
 *      "I changed my schedule after the match was delivered" flow.
 *   C) Session already running and everyone just finished their initial
 *      confirms — complete the pre-created confirmed token so the
 *      orchestrator advances to matching. Token is guaranteed to exist
 *      (created synchronously in spawnOrchestrator), so no polling.
 */
export async function checkAllConfirmed(sessionId: string): Promise<void> {
  // Treat "preferences-but-not-yet-complete" AND "already-completed"
  // participants as confirmed for amend purposes — a post-match amend
  // resets the amender to AWAITING_CONFIRMATION and then back to
  // SCHEDULE_CONFIRMED, but the OTHER participants may be in
  // PREFERENCES_SUBMITTED / COMPLETED by then. We still want to re-run
  // matching if the amender re-confirms.
  const participants = await getSessionParticipants(sessionId);
  if (participants.length < 2) return; // need at least 2 people
  const CONFIRMED_OR_LATER = new Set([
    "SCHEDULE_CONFIRMED",
    "AWAITING_PREFERENCES",
    "PREFERENCES_SUBMITTED",
    "COMPLETED",
  ]);
  if (!participants.every((p) => CONFIRMED_OR_LATER.has(p.state))) return;
  const everyoneStillInConfirmPhase = participants.every(
    (p) => p.state === "SCHEDULE_CONFIRMED"
  );

  const session = await getSessionById(sessionId);
  if (!session) return;

  // Case A — fresh session, boot the orchestrator for the first time.
  if (session.status === "OPEN" && everyoneStillInConfirmPhase) {
    await updateSessionStatus(sessionId, "PAIRED");
    await spawnOrchestrator(sessionId);
    return;
  }

  // Case B — amend flow: someone edited after an already-running session.
  // Reset late-stage participants back to SCHEDULE_CONFIRMED and hand off
  // to the amend-aware restart helper, which cancels the parked
  // orchestrator and spawns a fresh one with a bumped match_attempt.
  if (
    ["MATCHING", "MATCHED", "COMPLETED", "PAIRED"].includes(session.status) &&
    !everyoneStillInConfirmPhase
  ) {
    // Round-7 UX fix: before silently pulling other participants back into
    // an active flow, notify each one that someone amended so the
    // re-prompt they're about to get has context. The amender is the
    // participant in SCHEDULE_CONFIRMED state (just re-confirmed); others
    // are in later stages and are the ones being reset.
    const amender = participants.find((p) => p.state === "SCHEDULE_CONFIRMED");
    const amenderUser = amender ? await getUser(amender.chat_id) : null;
    const amenderName = amenderUser?.name ?? null;

    for (const p of participants) {
      if (p.state !== "SCHEDULE_CONFIRMED") {
        // Notify them BEFORE the state reset so the message is
        // standalone context. If the notification fails we still proceed
        // with the reset — the orchestrator's fresh slot-list message
        // will still arrive, just without the explanation.
        try {
          await sendTextMessage(p.chat_id, await generateResponse({
            scenario: "amend_notify_others",
            state: p.state,
            partnerName: amenderName ?? undefined,
            ...(await getReplyContext(p.chat_id)),
          }));
        } catch (err) {
          console.warn(`[amend-notify] failed for ${p.chat_id}:`, err);
        }
        await updateParticipantState(p.id, "SCHEDULE_CONFIRMED");
      }
    }
    // Clean old free_slots so the rematch picks fresh data.
    await query("DELETE FROM free_slots WHERE session_id = ?", [sessionId]);
    await updateSessionStatus(sessionId, "MATCHING");
    await restartOrchestratorForAmend(sessionId, session.status);
    return;
  }

  // Case C — normal confirm: orchestrator is already parked at the
  // confirmed gate, just wake it. Token was pre-created by
  // spawnOrchestrator, so we read it directly from the sessions row with
  // no retries.
  const result = await query<{ both_confirmed_token_id: string | null }>(
    "SELECT both_confirmed_token_id FROM sessions WHERE id = ?",
    [sessionId]
  );
  const tokenId = result.results[0]?.both_confirmed_token_id;
  if (!tokenId) {
    // Should never happen — token is written inside spawnOrchestrator
    // before the task that would eventually call us is triggered. If it
    // does, the session is in an inconsistent state and we'd rather fail
    // loudly than leave users waiting silently.
    throw new Error(
      `[checkAllConfirmed] No confirmed token for session ${sessionId} — orchestrator was never spawned?`
    );
  }
  try {
    await wait.completeToken(tokenId, { cancelled: false });
    await emitSessionEvent(sessionId, "confirmed_gate_completed");
  } catch (err) {
    // Token already completed (e.g. two racing checkAllConfirmed calls)
    // is harmless — the orchestrator woke once and is doing its thing.
    // Only warn, don't throw.
    console.warn(`[checkAllConfirmed] completeToken for ${sessionId} threw:`, err);
  }
}

/**
 * Called whenever a participant's state changes to PREFERENCES_SUBMITTED.
 * If everyone has submitted, wake the orchestrator's gate B. Same contract
 * as checkAllConfirmed — token is guaranteed to exist (pre-created by
 * spawnOrchestrator), so no polling.
 */
export async function checkAllPreferred(sessionId: string): Promise<void> {
  const participants = await getSessionParticipants(sessionId);
  if (!participants.every((p) => p.state === "PREFERENCES_SUBMITTED")) return;

  const result = await query<{ both_preferred_token_id: string | null }>(
    "SELECT both_preferred_token_id FROM sessions WHERE id = ?",
    [sessionId]
  );
  const tokenId = result.results[0]?.both_preferred_token_id;
  if (!tokenId) {
    throw new Error(
      `[checkAllPreferred] No preferred token for session ${sessionId} — orchestrator was never spawned?`
    );
  }
  try {
    await wait.completeToken(tokenId, { cancelled: false });
    await emitSessionEvent(sessionId, "preferred_gate_completed");
  } catch (err) {
    console.warn(`[checkAllPreferred] completeToken for ${sessionId} threw:`, err);
  }
}
