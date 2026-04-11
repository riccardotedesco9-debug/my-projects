// Intent-scoped handlers — these run in response to a classified user
// intent that is independent of the current state machine position:
// /cancel, remove partner, swap partner, amend schedule.
//
// Extracted from message-router.ts to keep the router itself focused on
// state dispatch. Each handler is self-contained and only depends on
// d1-client, response-generator, schedule-parser, router-helpers, and
// session-sync.

import {
  query,
  getSessionParticipants,
  updateParticipantState,
  updateSessionStatus,
  getUser,
  findUserByName,
  createPendingInvite,
  getReplyContext,
} from "./d1-client.js";
import type { UserProfile } from "./d1-client.js";
import { generateResponse } from "./response-generator.js";
import { scheduleParser } from "./schedule-parser.js";
import { reply } from "./router-helpers.js";

export async function handleCancel(
  participant: { id: string; session_id: string; chat_id: string },
  user: UserProfile | null,
): Promise<Record<string, unknown>> {
  // Wipe the canceller's conversation history so stale context from the
  // cancelled session doesn't leak into the next one (e.g. old partner
  // names showing up as "previous conversation" after a fresh /new). Done
  // BEFORE sending the cancel reply so that reply becomes the first entry
  // of their next session's history.
  await query("DELETE FROM conversation_log WHERE chat_id = ?", [participant.chat_id]);

  await updateParticipantState(participant.id, "COMPLETED");
  await updateSessionStatus(participant.session_id, "EXPIRED");

  // Notify ALL other participants
  const participants = await getSessionParticipants(participant.session_id);
  for (const p of participants) {
    if (p.chat_id !== participant.chat_id) {
      await reply(p.chat_id, await generateResponse({
        scenario: "cancel_partner", state: p.state,
        partnerName: user?.name ?? undefined,
      }));
      await updateParticipantState(p.id, "COMPLETED");
    }
  }

  // Cancel any pending invites
  await query(
    "UPDATE pending_invites SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'",
    [participant.session_id]
  );

  await reply(participant.chat_id, await generateResponse({
    scenario: "cancel_self", state: "COMPLETED",
    userName: user?.name ?? undefined,
    userLanguage: user?.preferred_language ?? undefined,
  }));
  return { action: "cancelled" };
}

/**
 * Remove a specific partner from the current session by name.
 * If the partner exists as a real user, delete the participants row.
 * If the partner is only a pending invite (unknown user), mark the
 * invite as DECLINED. We match by latest-matching name — if there are
 * duplicates we silently drop the most recent.
 */
export async function handleRemovePartner(
  chatId: string,
  participant: { id: string; session_id: string; chat_id: string; schedule_json: string | null; state: string },
  user: UserProfile | null,
  removeName: string,
  userMessage?: string,
): Promise<Record<string, unknown>> {
  const target = removeName.trim().toLowerCase();
  let removedLabel = "";

  // 1. Try exact match on any real participant's stored name first; fall
  //    back to substring only when it's unambiguous (1 candidate). Round-2
  //    review flagged: substring-first match could remove the wrong person
  //    (e.g. "tom" matches both "Tom Smith" and "Thomas" — break on first
  //    = nondeterministic).
  const others = await getSessionParticipants(participant.session_id);
  const candidates: Array<{ id: string; name: string; exact: boolean }> = [];
  for (const p of others) {
    if (p.chat_id === chatId) continue;
    const pUser = await getUser(p.chat_id);
    if (!pUser?.name) continue;
    const lower = pUser.name.toLowerCase();
    if (lower === target) candidates.push({ id: p.id, name: pUser.name, exact: true });
    else if (lower.includes(target)) candidates.push({ id: p.id, name: pUser.name, exact: false });
  }
  const exact = candidates.find((c) => c.exact);
  if (exact) {
    await query("DELETE FROM participants WHERE id = ?", [exact.id]);
    removedLabel = exact.name;
  } else if (candidates.length === 1) {
    await query("DELETE FROM participants WHERE id = ?", [candidates[0].id]);
    removedLabel = candidates[0].name;
  } else if (candidates.length > 1) {
    const list = candidates.map((c) => c.name).join(", ");
    await reply(chatId, await generateResponse({
      scenario: "remove_ambiguous", state: participant.state,
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
      userMessage,
      extraContext: list,
    }));
    return { action: "remove_ambiguous" };
  }

  // 2. If no real participant matched, drop the most recent pending
  //    invite (pending invites don't store the invitee name anywhere, so
  //    we can't target by name — we drop the newest one on the principle
  //    that the user is most likely referring to the person they just added).
  if (!removedLabel) {
    const latest = await query<{ id: string }>(
      "SELECT id FROM pending_invites WHERE inviter_chat_id = ? AND session_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1",
      [chatId, participant.session_id]
    );
    if (latest.results[0]) {
      await query("UPDATE pending_invites SET status = 'DECLINED' WHERE id = ?", [latest.results[0].id]);
      removedLabel = removeName;
    }
  }

  if (!removedLabel) {
    await reply(chatId, await generateResponse({
      scenario: "remove_not_found", state: participant.state,
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
      userMessage,
      partnerName: removeName,
    }));
    return { action: "remove_partner_not_found", target: removeName };
  }

  // Route through generateResponse so questions the user asked alongside
  // the remove intent get addressed ("remove tom, btw how does matching
  // work?").
  await reply(chatId, await generateResponse({
    scenario: "unknown_intent", state: participant.state,
    userMessage,
    ...(await getReplyContext(chatId)),
    extraContext: `User asked to remove "${removedLabel}" from the session — the removal is done. Confirm briefly that ${removedLabel} is out. ALSO: address anything else the user said in their message. Keep it 1-3 lines.`,
  }));
  return { action: "partner_removed", name: removedLabel };
}

/**
 * Swap one partner for another in the current session.
 *
 * Strategy (silent swap, per Riccardo's explicit preference):
 *  - If swap_from is given, remove them by name (same logic as handleRemovePartner).
 *  - If swap_from is NOT given ("oh wait i meant Tom"), drop the most
 *    recently added pending invite — the assumption is the user is
 *    correcting the thing they just said.
 *  - Then add swap_to as a new participant (known user) or pending invite
 *    (unknown).
 */
export async function handleSwapPartner(
  chatId: string,
  participant: { id: string; session_id: string; chat_id: string; schedule_json: string | null; state: string },
  user: UserProfile | null,
  swapFrom: string | undefined,
  swapTo: string | undefined,
  userMessage?: string,
): Promise<Record<string, unknown>> {
  if (!swapTo) {
    await reply(chatId, await generateResponse({
      scenario: "swap_missing_target", state: participant.state,
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
      userMessage,
    }));
    return { action: "swap_missing_target" };
  }

  // 1. Remove the old one. Exact match preferred; substring fallback only
  //    when unique. If swapFrom is explicit, remove by name. Otherwise
  //    drop the most recent pending invite (common case: "wait i meant
  //    Tom not Ben" where the user most recently mentioned Ben and
  //    doesn't explicitly repeat "not Ben").
  let removedLabel = "";
  if (swapFrom) {
    const target = swapFrom.trim().toLowerCase();
    const others = await getSessionParticipants(participant.session_id);
    const candidates: Array<{ id: string; name: string; exact: boolean }> = [];
    for (const p of others) {
      if (p.chat_id === chatId) continue;
      const pUser = await getUser(p.chat_id);
      if (!pUser?.name) continue;
      const lower = pUser.name.toLowerCase();
      if (lower === target) candidates.push({ id: p.id, name: pUser.name, exact: true });
      else if (lower.includes(target)) candidates.push({ id: p.id, name: pUser.name, exact: false });
    }
    const exact = candidates.find((c) => c.exact);
    if (exact) {
      await query("DELETE FROM participants WHERE id = ?", [exact.id]);
      removedLabel = exact.name;
    } else if (candidates.length === 1) {
      await query("DELETE FROM participants WHERE id = ?", [candidates[0].id]);
      removedLabel = candidates[0].name;
    } else if (candidates.length > 1) {
      const list = candidates.map((c) => c.name).join(", ");
      await reply(chatId, await generateResponse({
        scenario: "swap_ambiguous", state: participant.state,
        userName: user?.name ?? undefined,
        userLanguage: user?.preferred_language ?? undefined,
        userMessage,
        extraContext: list,
      }));
      return { action: "swap_ambiguous" };
    }
    // No candidate — fall through to the pending-invite drop below.
    if (!removedLabel) {
      const latest = await query<{ id: string }>(
        "SELECT id FROM pending_invites WHERE inviter_chat_id = ? AND session_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1",
        [chatId, participant.session_id]
      );
      if (latest.results[0]) {
        await query("UPDATE pending_invites SET status = 'DECLINED' WHERE id = ?", [latest.results[0].id]);
        removedLabel = swapFrom;
      }
    }
  } else {
    // No explicit name — drop the most recent pending invite
    const latest = await query<{ id: string }>(
      "SELECT id FROM pending_invites WHERE inviter_chat_id = ? AND session_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1",
      [chatId, participant.session_id]
    );
    if (latest.results[0]) {
      await query("UPDATE pending_invites SET status = 'DECLINED' WHERE id = ?", [latest.results[0].id]);
    }
  }

  // If the user SAID "swap" but we couldn't find anyone to remove, warn
  // rather than silently becoming an add — flagged by round-2 code
  // reviewer (high priority).
  if (swapFrom && !removedLabel) {
    await reply(chatId, await generateResponse({
      scenario: "swap_from_not_found", state: participant.state,
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
      userMessage,
      extraContext: swapFrom,
    }));
  }

  // 2. Add the new one — known user → participant, unknown → pending
  //    invite. Both completion paths route through generateResponse so
  //    any question the user asked alongside the swap gets addressed
  //    instead of silently dropped.
  const matches = await findUserByName(swapTo.trim());
  if (matches.length === 1 && matches[0].chat_id !== chatId) {
    try {
      await query(
        "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'partner', 'AWAITING_SCHEDULE')",
        [crypto.randomUUID(), participant.session_id, matches[0].chat_id]
      );
    } catch { /* already in */ }
    const label = matches[0].name ?? swapTo;
    const actionDesc = removedLabel
      ? `Swapped ${removedLabel} for ${label}`
      : `Added ${label} to the session`;
    await reply(chatId, await generateResponse({
      scenario: "unknown_intent", state: participant.state,
      userMessage,
      ...(await getReplyContext(chatId)),
      extraContext: `${actionDesc} — the action is done. Confirm briefly. ALSO address anything else the user said in their message. 1-3 lines.`,
    }));
    return { action: "swap_complete", to: label };
  }

  // Unknown — new pending invite (reuses the same session deep link).
  await createPendingInvite(chatId, null, participant.session_id);
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "MeetSyncBot";
  const inviteLink = `https://t.me/${botUsername}?start=invite_${participant.session_id}`;
  const headline = removedLabel
    ? `Swapped ${removedLabel} for ${swapTo}`
    : `Going with ${swapTo}`;
  // LLM acknowledgment addresses user's message; link arrives in a
  // separate deterministic message so the LLM can't hallucinate URLs.
  await reply(chatId, await generateResponse({
    scenario: "unknown_intent", state: participant.state,
    userMessage,
    ...(await getReplyContext(chatId)),
    extraContext: `${headline}. ${swapTo} isn't in MeetSync yet — an invite link is coming in the NEXT message (do NOT include any URLs in your reply, just acknowledge). ALSO address anything else the user said. 1-3 lines.`,
  }));
  // Markdown inline-link format — raw URLs with `_` in `invite_<uuid>` blow
  // up Telegram's legacy Markdown parser.
  await reply(chatId, `Here's your [invite link](${inviteLink}) to share with ${swapTo}.`);
  return { action: "swap_complete", to: swapTo };
}

/**
 * Amend a previously-confirmed schedule.
 *
 * Round-1 bug: users who said "yes" to their parsed schedule and then
 * said "wait, i also work saturdays" got acknowledgment but no actual
 * re-parse. Round-2 flagged that re-parse alone didn't wake the match
 * pipeline. Round-6 (current): we leave session.status UNCHANGED here
 * on purpose — `checkAllConfirmed` Case B reads the real previous
 * status (MATCHING / MATCHED / COMPLETED / PAIRED) and routes to the
 * correct gate when cancelling the parked orchestrator. Overwriting to
 * PAIRED here would hide gate-B parks (MATCHED) and leave old
 * orchestrators stranded on the preference waitpoint until they time
 * out.
 *
 * Flow: reset amender to SCHEDULE_RECEIVED → parser re-runs → user
 * re-confirms → checkAllConfirmed detects not-all-in-confirm-phase + a
 * running session → restartOrchestratorForAmend(sessionId, realStatus).
 */
export async function handleAmendSchedule(
  chatId: string,
  participant: { id: string; session_id: string; chat_id: string; schedule_json: string | null; state: string },
  user: UserProfile | null,
  amendText: string,
): Promise<Record<string, unknown>> {
  await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
  await reply(chatId, await generateResponse({
    scenario: "parsing_schedule_amend", state: "SCHEDULE_RECEIVED",
    userName: user?.name ?? undefined,
    userLanguage: user?.preferred_language ?? undefined,
    userMessage: amendText,
  }));

  // Feed the parser the previous schedule + the amendment so it can
  // produce a merged result rather than a fresh one (which would lose
  // the original data). Ambiguity rule: if the user refers to a weekday
  // ("the Wednesday thing") that appears multiple times in the prior
  // schedule, apply the amendment to the NEAREST-FUTURE matching date
  // only — not all occurrences. This gives deterministic behavior
  // instead of picking randomly. Explicit dates override this rule.
  const prior = participant.schedule_json
    ? `Previous parsed schedule JSON: ${participant.schedule_json}\n\nUser's amendment: ${amendText}\n\nRe-extract the full schedule applying the amendment. Keep everything from the previous schedule that wasn't changed, and merge in the new/updated shifts. AMBIGUITY RULE: if the amendment references a weekday or vague time reference ("the Wednesday thing", "that Monday", "friday's shift") and multiple matching dates exist in the prior schedule, apply the change to the NEAREST-FUTURE matching date only, leaving the others intact. If the user gives an explicit date (e.g. "Apr 15") apply only to that date.`
    : amendText;

  await scheduleParser.trigger({
    participant_id: participant.id,
    session_id: participant.session_id,
    chat_id: participant.chat_id,
    text_content: prior,
  });
  return { action: "schedule_amend_triggered" };
}
