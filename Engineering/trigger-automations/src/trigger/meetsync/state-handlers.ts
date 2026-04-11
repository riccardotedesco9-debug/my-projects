// State-scoped handlers — these run based on the participant's current
// position in the session lifecycle state machine:
//   AWAITING_PARTNER_INFO → AWAITING_SCHEDULE → SCHEDULE_RECEIVED →
//   AWAITING_CONFIRMATION → SCHEDULE_CONFIRMED → (AWAITING_PREFERENCES|
//   MEDIATED send availability) → PREFERENCES_SUBMITTED → COMPLETED.
//
// Extracted from message-router.ts to keep the router focused on intent
// classification + dispatch. Includes addParticipant and
// handleAcceptInvite because they're tightly coupled to the partner-info
// state machine (both create participant rows and feed into subsequent
// state transitions).

import { wait } from "@trigger.dev/sdk";
import {
  query,
  getParticipantByChatId,
  getSessionParticipants,
  updateParticipantState,
  updateSessionStatus,
  getOtherParticipants,
  getParticipantCount,
  getUser,
  findUserByName,
  findUserByPhone,
  createPendingInvite,
  getSessionById,
  updateSessionMode,
  updateInviteStatus,
  getReplyContext,
  emitSessionEvent,
  linkPersonNoteToChat,
} from "./d1-client.js";
import type { UserProfile } from "./d1-client.js";
import { scheduleParser } from "./schedule-parser.js";
import { deliverResults } from "./deliver-results.js";
import { generateResponse } from "./response-generator.js";
import { computeSinglePersonSlots } from "./match-compute.js";
import {
  spawnOrchestrator,
  checkAllConfirmed,
  checkAllPreferred,
} from "./session-sync.js";
import { reply, canProceedToScheduling, type RouterPayload } from "./router-helpers.js";

/**
 * Multi-person partner collection phase. Creator stays here until they
 * explicitly move on (upload schedule or say done_adding). Each call to
 * provide_partner adds one participant and loops back.
 */
export async function handleAwaitingPartnerInfo(
  chatId: string,
  intent: string,
  params: Record<string, unknown>,
  user: UserProfile | null,
  userMessage?: string,
  payload?: RouterPayload,
): Promise<Record<string, unknown>> {
  const participant = await getParticipantByChatId(chatId);
  if (!participant) return { action: "no_participant" };

  // "Done adding" intent or schedule upload — transition to scheduling
  if (intent === "done_adding") {
    if (!(await canProceedToScheduling(participant.session_id))) {
      const msg = await generateResponse({
        scenario: "need_participants", state: "AWAITING_PARTNER_INFO",
        userName: user?.name ?? undefined,
        userLanguage: user?.preferred_language ?? undefined,
      });
      await reply(chatId, msg);
      return { action: "need_participants_before_proceed" };
    }
    await updateParticipantState(participant.id, "AWAITING_SCHEDULE");
    await updateSessionStatus(participant.session_id, "PAIRED");
    await spawnOrchestrator(participant.session_id);
    const msg = await generateResponse({
      scenario: "all_notified", state: "AWAITING_SCHEDULE",
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
    });
    await reply(chatId, msg);
    return { action: "done_adding_participants" };
  }

  // Schedule upload while in AWAITING_PARTNER_INFO — handled by smart
  // routing above, but guard here in case routing falls through.
  const isFileUpload = payload && (payload.message_type === "image" || payload.message_type === "document") && payload.media_id;
  const isTextSchedule = intent === "upload_schedule_text" && params.schedule_text;
  if (isFileUpload || isTextSchedule) {
    if (!(await canProceedToScheduling(participant.session_id))) {
      const msg = await generateResponse({
        scenario: "need_participants", state: "AWAITING_PARTNER_INFO",
        userName: user?.name ?? undefined,
        userLanguage: user?.preferred_language ?? undefined,
      });
      await reply(chatId, msg);
      return { action: "need_participants_before_schedule" };
    }
    await updateParticipantState(participant.id, "AWAITING_SCHEDULE");
    await updateSessionStatus(participant.session_id, "PAIRED");
    await spawnOrchestrator(participant.session_id);
    if (payload) {
      return await handleAwaitingSchedule(participant, payload, intent, params, userMessage);
    }
  }

  if (intent !== "provide_partner" || (!params.partner_name && !params.partner_phone)) {
    // Answer whatever they said conversationally — don't fight the user
    const otherCount = (await getParticipantCount(participant.session_id)) - 1;
    const extraHint = otherCount > 0
      ? `${otherCount} people added so far. User can add more names, send their schedule, or say 'done'.`
      : "No one added yet. User can give names or phone numbers to add people.";
    await reply(chatId, await generateResponse({
      scenario: "unknown_intent", state: "AWAITING_PARTNER_INFO",
      userName: user?.name ?? undefined,
      userMessage,
      userLanguage: user?.preferred_language ?? undefined,
      extraContext: `${extraHint} IMPORTANT: Address what the user said FIRST. If they shared any useful info (schedule, availability, preferences), acknowledge it. Then gently mention next steps. Do NOT repeat the same question if bot already asked it recently.`,
    }));
    return { action: "conversational_in_partner_info" };
  }

  // User gave a phone number
  if (params.partner_phone) {
    const partnerPhone = String(params.partner_phone).replace(/[^0-9]/g, "");
    const partnerUser = await findUserByPhone(partnerPhone);

    if (partnerUser) {
      if (partnerUser.chat_id === chatId) {
        await reply(chatId, await generateResponse({
          scenario: "self_number_rejected", state: "AWAITING_PARTNER_INFO",
          userName: user?.name ?? undefined,
          userLanguage: user?.preferred_language ?? undefined,
          userMessage,
        }));
        return { action: "self_invite_rejected" };
      }
      return await addParticipant(chatId, partnerUser.chat_id, participant.session_id, user, partnerUser);
    }

    // Unknown phone — create pending invite, share deep link.
    // Split into two messages: AI-generated acknowledgment (no URL) + a
    // code-generated message with the link in Markdown inline-link format.
    // Reason: legacy Telegram Markdown parses `_` inside raw URLs as italic
    // markers, so `?start=invite_<uuid>` with its underscore throws a 400
    // "can't parse entities" from the Bot API. `[label](url)` bypasses the
    // parser for the URL portion entirely.
    await createPendingInvite(chatId, null, participant.session_id, partnerPhone);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "MeetSyncBot";
    const inviteLink = `https://t.me/${botUsername}?start=invite_${participant.session_id}`;
    await reply(chatId, await generateResponse({
      scenario: "partner_not_found", state: "AWAITING_PARTNER_INFO",
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
      extraContext: `phone ${partnerPhone}`,
    }));
    await reply(
      chatId,
      `Here's your [invite link](${inviteLink}) to share with them. Add more people, or go ahead and send your schedule whenever you're ready.`
    );
    return { action: "invite_created_link_shared" };
  }

  // User gave a name
  if (params.partner_name) {
    const matches = (await findUserByName(String(params.partner_name)))
      .filter((m) => m.chat_id !== chatId);

    if (matches.length === 1) {
      return await addParticipant(chatId, matches[0].chat_id, participant.session_id, user, matches[0]);
    }

    if (matches.length > 1) {
      const list = matches.map((m, i) => `${i + 1}. ${m.name} (${String(m.chat_id).slice(-4)})`).join("\n");
      await reply(chatId, await generateResponse({
        scenario: "multiple_name_matches", state: "AWAITING_PARTNER_INFO",
        userName: user?.name ?? undefined,
        userMessage,
        userLanguage: user?.preferred_language ?? undefined,
        extraContext: list,
      }));
      return { action: "multiple_matches" };
    }

    // No match — create pending invite with deep link.
    await createPendingInvite(chatId, null, participant.session_id);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "MeetSyncBot";
    const inviteLink = `https://t.me/${botUsername}?start=invite_${participant.session_id}`;
    await reply(chatId, await generateResponse({
      scenario: "partner_not_found", state: "AWAITING_PARTNER_INFO",
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
      extraContext: String(params.partner_name),
    }));
    // Markdown inline-link format `[label](url)` — the URL inside `()` is
    // NOT parsed for formatting characters, so underscores in session_id
    // don't blow up the Markdown parser like a raw URL would.
    await reply(
      chatId,
      `Here's your [invite link](${inviteLink}) to share with them. Add more people, or go ahead and send your schedule whenever you're ready.`
    );
    return { action: "partner_not_found_link_shared" };
  }

  return { action: "no_partner_info" };
}

/**
 * Add a known participant to the session. Does NOT start orchestrator
 * or change session status — creator may still add more people.
 */
export async function addParticipant(
  creatorChatId: string,
  newParticipantChatId: string,
  sessionId: string,
  creatorUser: UserProfile | null,
  newUser: UserProfile | null,
): Promise<Record<string, unknown>> {
  const participantId = crypto.randomUUID();

  // Guard: already in this session
  const existing = await query<{ id: string }>(
    "SELECT id FROM participants WHERE session_id = ? AND chat_id = ? LIMIT 1",
    [sessionId, newParticipantChatId]
  );
  if (existing.results.length > 0) {
    await reply(creatorChatId, await generateResponse({
      scenario: "participant_already_in", state: "AWAITING_PARTNER_INFO",
      userName: creatorUser?.name ?? undefined,
      userLanguage: creatorUser?.preferred_language ?? undefined,
      partnerName: newUser?.name ?? undefined,
    }));
    return { action: "already_in_session" };
  }

  await query(
    "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'partner', 'AWAITING_SCHEDULE')",
    [participantId, sessionId, newParticipantChatId]
  );

  // Notify the added person (may fail if they haven't /started the bot
  // yet — that's OK)
  try {
    await reply(newParticipantChatId, await generateResponse({
      scenario: "proactive_intro", state: "AWAITING_SCHEDULE",
      userName: newUser?.name ?? undefined,
      userLanguage: newUser?.preferred_language ?? undefined,
      partnerName: creatorUser?.name ?? undefined,
    }));
  } catch {
    // Can't message them yet — they'll get prompted when they /start the bot
  }

  // Tell creator: added! Anyone else?
  const confirmMsg = await generateResponse({
    scenario: "participant_added", state: "AWAITING_PARTNER_INFO",
    userName: creatorUser?.name ?? undefined,
    userLanguage: creatorUser?.preferred_language ?? undefined,
    partnerName: newUser?.name ?? undefined,
  });
  await reply(creatorChatId, confirmMsg);

  const followUp = await generateResponse({
    scenario: "ask_more_or_schedule", state: "AWAITING_PARTNER_INFO",
    userName: creatorUser?.name ?? undefined,
    userLanguage: creatorUser?.preferred_language ?? undefined,
  });
  await reply(creatorChatId, followUp);

  return { action: "participant_added", session_id: sessionId, added: newParticipantChatId };
}

/** Accept a pending invite — add as participant, notify creator */
export async function handleAcceptInvite(
  chatId: string,
  invite: { id: string; inviter_chat_id: string; session_id: string },
  inviteeUser: UserProfile | null,
): Promise<Record<string, unknown>> {
  // Validate session is still active
  const session = await getSessionById(invite.session_id);
  if (!session || session.status === "EXPIRED" || session.status === "COMPLETED" || new Date(session.expires_at) < new Date()) {
    await updateInviteStatus(invite.id, "EXPIRED");
    await reply(chatId, await generateResponse({
      scenario: "session_expired", state: "EXPIRED",
      userName: inviteeUser?.name ?? undefined,
      userLanguage: inviteeUser?.preferred_language ?? undefined,
    }));
    return { action: "invite_session_expired" };
  }

  await updateInviteStatus(invite.id, "ACCEPTED");

  const creatorUser = await getUser(session.creator_chat_id);
  const participantId = crypto.randomUUID();

  // Add invitee as participant
  try {
    await query(
      "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'partner', 'AWAITING_SCHEDULE')",
      [participantId, invite.session_id, chatId]
    );
  } catch {
    // UNIQUE constraint — already joined
    await reply(chatId, await generateResponse({
      scenario: "already_joined", state: "AWAITING_SCHEDULE",
      userName: inviteeUser?.name ?? undefined,
      userLanguage: inviteeUser?.preferred_language ?? undefined,
    }));
    return { action: "already_joined" };
  }

  // Round-6 note: we used to call spawnOrchestrator here when the
  // session was already PAIRED. That branch is now dead code — every
  // path that sets status to PAIRED immediately calls spawnOrchestrator
  // itself, so by the time we get here the orchestrator is already
  // running. A second spawn would just burn two token creates and one
  // UPDATE for no effect (dedup'd by Trigger.dev idempotency + the
  // versioned waitpoint key).

  // Link-on-join: if the creator previously told the bot about this
  // invitee by name (their `inviteeUser.name`), we may already have a
  // person_notes row for them — possibly with an on-behalf schedule
  // already uploaded. Link it to the invitee's chat_id instead of
  // letting a duplicate parallel record form. If the person_note
  // carries a schedule_json, transfer it directly onto the freshly
  // created participant row so matching picks it up without the
  // invitee having to re-upload.
  if (inviteeUser?.name) {
    const linked = await linkPersonNoteToChat(
      session.creator_chat_id,
      inviteeUser.name,
      chatId,
    );
    if (linked?.schedule_json) {
      // Hand off the pre-parsed schedule to the participant and jump
      // straight to AWAITING_CONFIRMATION so the invitee sees "here's
      // what your colleague uploaded for you, does it look right?"
      // instead of being asked for a schedule they don't need to send.
      await query(
        "UPDATE participants SET schedule_json = ?, state = 'AWAITING_CONFIRMATION' WHERE id = ?",
        [linked.schedule_json, participantId],
      );
    }
  }

  // Notify the creator
  await reply(session.creator_chat_id, await generateResponse({
    scenario: "invite_accepted_creator", state: "AWAITING_SCHEDULE",
    userName: creatorUser?.name ?? undefined,
    userLanguage: creatorUser?.preferred_language ?? undefined,
    partnerName: inviteeUser?.name ?? undefined,
  }));

  // Greet the invitee
  await reply(chatId, await generateResponse({
    scenario: "invite_accepted_invitee", state: "AWAITING_SCHEDULE",
    userName: inviteeUser?.name ?? undefined,
    userLanguage: inviteeUser?.preferred_language ?? undefined,
    partnerName: creatorUser?.name ?? undefined,
  }));

  return { action: "invite_accepted", session_id: invite.session_id };
}

export async function handleAwaitingSchedule(
  participant: { id: string; session_id: string; chat_id: string },
  payload: RouterPayload,
  intent: string,
  params: Record<string, unknown>,
  userMessage?: string,
): Promise<Record<string, unknown>> {
  const { chat_id: chatId, message_type, media_id, mime_type } = payload;

  // File upload (image or document)
  if (message_type === "image" || message_type === "document") {
    if (!media_id) {
      await reply(chatId, await generateResponse({
        scenario: "missing_media", state: "AWAITING_SCHEDULE",
        userMessage,
        ...(await getReplyContext(chatId)),
      }));
      return { action: "missing_media" };
    }

    await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
    await reply(chatId, await generateResponse({
      scenario: "parsing_schedule_file", state: "SCHEDULE_RECEIVED",
      userMessage,
      ...(await getReplyContext(chatId)),
    }));

    await scheduleParser.trigger({
      participant_id: participant.id,
      session_id: participant.session_id,
      chat_id: chatId,
      media_id,
      mime_type: mime_type ?? "image/jpeg",
    });
    return { action: "schedule_received_file", media_id };
  }

  // Text-based schedule input — include any previously learned context
  // for richer parsing. Accept ANY intent as long as params.schedule_text
  // is present — the user may have said "im alice, tue-thu 10-6" which
  // gets classified as provide_name, but the schedule text is right
  // there in the same message. Don't make them retype it.
  if (params.schedule_text && intent !== "confirm_schedule" && intent !== "reject_schedule" && intent !== "clarify_schedule") {
    await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
    await reply(chatId, await generateResponse({
      scenario: "parsing_schedule_text", state: "SCHEDULE_RECEIVED",
      userMessage,
      ...(await getReplyContext(chatId)),
    }));

    // Enrich with user context (may contain earlier schedule mentions)
    const userProfile = await getUser(chatId);
    const contextHint = userProfile?.context ? `\nPrevious context about this person: ${userProfile.context}` : "";

    await scheduleParser.trigger({
      participant_id: participant.id,
      session_id: participant.session_id,
      chat_id: chatId,
      text_content: String(params.schedule_text) + contextHint,
    });
    return { action: "schedule_received_text" };
  }

  // Conversational default — the user is in AWAITING_SCHEDULE but said
  // something other than a schedule. Don't parrot "please send your
  // schedule" — let the AI fully address their message and only nudge
  // toward schedule upload if they haven't signaled a different intent.
  //
  // Hard anti-nag guard: the AI previously saw "state is AWAITING_SCHEDULE"
  // and kept reinjecting the schedule ask every turn even when the user
  // explicitly asked to defer or do something else. Now we pass a very
  // strong "do not nag" instruction AND let the AI see the conversation
  // history (via getReplyContext) so it can notice when we've already
  // asked multiple times and drop it entirely.
  await reply(chatId, await generateResponse({
    scenario: "unknown_intent", state: "AWAITING_SCHEDULE",
    userMessage: userMessage ?? payload.text,
    ...(await getReplyContext(chatId)),
    extraContext: "State is AWAITING_SCHEDULE. CRITICAL anti-nag rules: (a) If the user expressed a different intent (defer, add partner, ask a question, share context, push back, change direction, express frustration) — GO WITH IT. Do NOT append 'please share your schedule' as a tail reminder. (b) Check the recent conversation history — if you've ALREADY asked for their schedule 2+ times in the last several messages, STOP asking. Do not repeat yourself. Just address what they actually said and let the conversation breathe. (c) If the user is pushing back ('just use X for now', 'I'll give it later', 'why do you need mine'), acknowledge their position, answer the implicit question if there is one, and DROP the schedule ask entirely from this turn's reply. You are a helpful assistant, not a rigid form. Be graceful about deferrals.",
  }));
  return { action: "conversational_in_schedule" };
}

export async function handleAwaitingConfirmation(
  participant: { id: string; session_id: string; chat_id: string; schedule_json: string | null },
  intent: string,
  params: Record<string, unknown>,
  userMessage?: string,
): Promise<Record<string, unknown>> {
  if (intent === "confirm_schedule") {
    await updateParticipantState(participant.id, "SCHEDULE_CONFIRMED");
    // Generate a reply that addresses the user's actual message first
    // (they may have asked a follow-up question alongside "yes") before
    // announcing the state change. Prior behavior hard-coded "Schedule
    // confirmed! Waiting..." which completely ignored multi-part
    // confirmations like "yes my partner is Diego and when he sends his
    // schedule can you find our free time?"
    await reply(participant.chat_id, await generateResponse({
      scenario: "schedule_confirmed", state: "SCHEDULE_CONFIRMED",
      userMessage,
      ...(await getReplyContext(participant.chat_id)),
      extraContext: "The user's schedule is now confirmed. Address what they actually said in their message FIRST (answer any questions, acknowledge any details they shared), then briefly confirm their schedule is locked in and you're waiting for the other participants. Keep it 2-4 lines total. Do NOT ignore questions they asked.",
    }));
    // Pass participant.chat_id explicitly so checkAllConfirmed Case B
    // (amend flow) knows which participant just re-confirmed, instead of
    // racing to find them by state (round-10 code review fix #1).
    await checkAllConfirmed(participant.session_id, participant.chat_id);
    return { action: "schedule_confirmed" };
  }

  if (intent === "reject_schedule") {
    await updateParticipantState(participant.id, "AWAITING_SCHEDULE");
    await reply(participant.chat_id, await generateResponse({
      scenario: "schedule_rejected", state: "AWAITING_SCHEDULE",
      userMessage,
      ...(await getReplyContext(participant.chat_id)),
      extraContext: "The user rejected the parsed schedule. Address what they said first, then ask them to re-send their schedule (photo, PDF, or typed hours).",
    }));
    return { action: "schedule_rejected" };
  }

  if (intent === "clarify_schedule" && params.clarification && participant.schedule_json) {
    await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
    await reply(participant.chat_id, await generateResponse({
      scenario: "parsing_schedule_clarify", state: "SCHEDULE_RECEIVED",
      userMessage,
      ...(await getReplyContext(participant.chat_id)),
    }));

    await scheduleParser.trigger({
      participant_id: participant.id,
      session_id: participant.session_id,
      chat_id: participant.chat_id,
      text_content: `Previous schedule data: ${participant.schedule_json}\n\nUser clarification: ${String(params.clarification)}\n\nRe-extract the schedule applying the user's clarification. Include ALL shifts that match their request.`,
    });
    return { action: "schedule_clarified" };
  }

  await reply(participant.chat_id, await generateResponse({
    scenario: "confirm_prompt", state: "AWAITING_CONFIRMATION", userMessage,
  }));
  return { action: "awaiting_confirmation" };
}

/** Mediated mode — share creator's availability with ALL other participants */
export async function handleSendAvailability(
  chatId: string,
  participant: { id: string; session_id: string; chat_id: string; schedule_json: string | null },
  user: UserProfile | null,
): Promise<Record<string, unknown>> {
  const slots = computeSinglePersonSlots(participant.schedule_json);
  if (slots.length === 0) {
    await reply(chatId, await generateResponse({
      scenario: "no_free_slots_computed", state: "SCHEDULE_CONFIRMED",
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
    }));
    return { action: "no_free_slots" };
  }

  const otherParticipants = await getOtherParticipants(participant.session_id, chatId);
  if (otherParticipants.length === 0) {
    await reply(chatId, await generateResponse({
      scenario: "no_other_participants", state: "SCHEDULE_CONFIRMED",
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
    }));
    return { action: "no_other_participants" };
  }

  // Store slots
  await query("DELETE FROM free_slots WHERE session_id = ?", [participant.session_id]);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    await query(
      "INSERT INTO free_slots (id, session_id, slot_number, day, day_name, start_time, end_time, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), participant.session_id, i + 1, s.day, s.day_name, s.start_time, s.end_time, s.duration_minutes]
    );
  }

  // Round-8 fix for pre-existing double-delivery bug:
  // In mediated mode, handleSendAvailability owns the slot computation
  // (single-person slots from the creator's schedule) AND the eventual
  // deliverResults call (from handleAwaitingPreferences once the partner
  // picks). The orchestrator should NOT also run matchCompute +
  // deliverResults — doing so overwrites free_slots with N-way overlap
  // (wrong in mediated) and fires deliverResults twice (duplicate ics +
  // duplicate Telegram messages).
  //
  // Previously this code completed both tokens with `{completed: true}`
  // which woke the orchestrator through the non-mediated path. Now we
  // complete them with `{cancelled: true}` so the orchestrator returns
  // via its cancellation branch and stays out of the mediated pipeline.
  //
  // Round-10 code review fix: also NULL out the token IDs on the
  // sessions row after cancellation. Otherwise a subsequent amend
  // flow reads stale token IDs and tries to complete them again —
  // harmless (caught by the try/catch in restartOrchestratorForAmend)
  // but each leaked completion is a wasted Trigger.dev API call.
  await updateSessionMode(participant.session_id, "MEDIATED");
  const session = await getSessionById(participant.session_id);
  if (session?.both_confirmed_token_id) {
    try { await wait.completeToken(session.both_confirmed_token_id, { cancelled: true }); } catch { /* already completed */ }
  }
  if (session?.both_preferred_token_id) {
    try { await wait.completeToken(session.both_preferred_token_id, { cancelled: true }); } catch { /* already completed */ }
  }
  if (session?.both_confirmed_token_id || session?.both_preferred_token_id) {
    await query(
      "UPDATE sessions SET both_confirmed_token_id = NULL, both_preferred_token_id = NULL WHERE id = ?",
      [participant.session_id]
    );
  }

  // Format slot list
  const slotLines = slots.map((s, i) =>
    `${i + 1}. *${s.day_name}* ${s.day} — ${s.start_time}-${s.end_time} (${Math.floor(s.duration_minutes / 60)}h)`
  ).join("\n");

  // Send availability to ALL other participants
  for (const other of otherParticipants) {
    const otherUser = await getUser(other.chat_id);
    await updateParticipantState(other.id, "AWAITING_PREFERENCES");
    await reply(other.chat_id, await generateResponse({
      scenario: "mediated_partner_slots", state: "AWAITING_PREFERENCES",
      userName: otherUser?.name ?? undefined,
      userLanguage: otherUser?.preferred_language ?? undefined,
      partnerName: user?.name ?? undefined,
      slotList: slotLines,
    }));
  }

  // Creator implicitly prefers all their free slots
  await updateParticipantState(participant.id, "PREFERENCES_SUBMITTED", {
    preferred_slots: slots.map((_, i) => i + 1).join(","),
  });

  // Confirm to creator
  await reply(chatId, await generateResponse({
    scenario: "mediated_availability_sent", state: "PREFERENCES_SUBMITTED",
    userName: user?.name ?? undefined,
    userLanguage: user?.preferred_language ?? undefined,
  }));

  return { action: "availability_sent_mediated" };
}

export async function handleAwaitingPreferences(
  participant: { id: string; session_id: string; chat_id: string; preferred_slots: string | null },
  intent: string,
  params: Record<string, unknown>,
  userMessage?: string,
): Promise<Record<string, unknown>> {
  if (intent === "submit_preferences" && Array.isArray(params.slots) && params.slots.length > 0) {
    const slots = (params.slots as number[]).filter((n) => n > 0);

    await updateParticipantState(participant.id, "PREFERENCES_SUBMITTED", {
      preferred_slots: slots.join(","),
    });

    const session = await getSessionById(participant.session_id);
    if (session?.mode === "MEDIATED") {
      // N≥3 fix: the previous code triggered deliverResults the moment
      // the FIRST participant submitted, ignoring the others in a 3+
      // person mediated session. Now we only proceed when EVERY
      // participant is PREFERENCES_SUBMITTED (creator is auto-submitted
      // by handleSendAvailability so they're already in that state).
      const allParticipants = await getSessionParticipants(participant.session_id);
      const stillWaiting = allParticipants.filter((p) => p.state !== "PREFERENCES_SUBMITTED");

      if (stillWaiting.length > 0) {
        await reply(
          participant.chat_id,
          stillWaiting.length === 1
            ? `Got it — slots ${slots.join(", ")}! Waiting on 1 more person to pick.`
            : `Got it — slots ${slots.join(", ")}! Waiting on ${stillWaiting.length} more people to pick.`
        );
        return { action: "mediated_preferences_waiting", slots, waiting: stillWaiting.length };
      }

      // Everyone has submitted — compute and deliver
      await reply(participant.chat_id, await generateResponse({
        scenario: "mediated_finding_match", state: "PREFERENCES_SUBMITTED",
        userMessage,
        ...(await getReplyContext(participant.chat_id)),
        extraContext: `slots ${slots.join(", ")}`,
      }));
      await updateSessionStatus(participant.session_id, "MATCHING");
      try {
        const result = await deliverResults.triggerAndWait({ session_id: participant.session_id });
        if (!result.ok) throw new Error("Delivery failed");
      } catch (err) {
        // Round-10 code review fix #12: emit a terminal-esque event
        // so the dashboard's stuck-session query doesn't flag this
        // session forever. Without this, a deliverResults crash in
        // mediated mode left no signal in session_events at all.
        await emitSessionEvent(participant.session_id, "delivery_failed", {
          mode: "mediated",
          error: String(err),
        });
        await reply(participant.chat_id, await generateResponse({
          scenario: "match_delivery_failed", state: "MATCHING",
          ...(await getReplyContext(participant.chat_id)),
        }));
      }
      return { action: "mediated_preferences_submitted", slots };
    }

    // Route through generateResponse so the user's actual message gets
    // addressed (same ignore-the-user bug as the confirm_schedule
    // hardcoded reply). Users often ask questions alongside "1, 3" slot
    // picks and the old hardcoded string silently dropped them.
    await reply(participant.chat_id, await generateResponse({
      scenario: "preferences_saved", state: "PREFERENCES_SUBMITTED",
      userMessage,
      ...(await getReplyContext(participant.chat_id)),
      extraContext: `User picked slots ${slots.join(", ")}. Address what they actually said in their message FIRST (answer any questions, acknowledge context), then briefly confirm their preferences are saved and you're waiting for the other participants. Keep it 2-4 lines. Do NOT ignore questions they asked.`,
    }));
    await checkAllPreferred(participant.session_id);
    return { action: "preferences_submitted", slots };
  }

  await reply(participant.chat_id, await generateResponse({
    scenario: "remind_preferences", state: "AWAITING_PREFERENCES", userMessage,
  }));
  return { action: "reminded_preferences" };
}
