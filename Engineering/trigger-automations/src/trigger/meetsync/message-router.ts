// MeetSync message router — central hub model
// Every user is registered on first contact. No session codes — just say who you want to schedule with.

import { schemaTask, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { sendTextMessage } from "./whatsapp-client.js";
import {
  query,
  getParticipantByPhone,
  getSessionParticipants,
  updateParticipantState,
  updateSessionStatus,
  getPartnerForPhone,
  clearPartner,
  resetUserData,
  registerUser,
  getUser,
  updateUserName,
  updateUserLanguage,
  findUserByName,
  findUserByPhone,
  createPendingInvite,
  getPendingInviteForPhone,
  updateInviteStatus,
} from "./d1-client.js";
import type { UserProfile } from "./d1-client.js";
import { scheduleParser } from "./schedule-parser.js";
import { sessionOrchestrator } from "./session-orchestrator.js";
import { classifyIntent } from "./intent-router.js";
import { generateResponse } from "./response-generator.js";

const payloadSchema = z.object({
  phone: z.string(),
  message_type: z.enum(["text", "image", "document", "audio", "unknown"]),
  text: z.string().optional(),
  media_id: z.string().optional(),
  mime_type: z.string().optional(),
  timestamp: z.string(),
});

export const messageRouter = schemaTask({
  id: "meetsync-message-router",
  schema: payloadSchema,
  maxDuration: 120,

  run: async (payload) => {
    const { phone, message_type, text, media_id, mime_type } = payload;

    // Register/update user in knowledge base on every message
    await registerUser(phone);
    const user = await getUser(phone);

    // Find active participant for this phone number
    const participant = await getParticipantByPhone(phone);
    const currentState = participant?.state ?? "IDLE";

    // Classify intent via Claude Haiku (or fast-path for media)
    const { intent, params } = await classifyIntent(text, message_type, currentState);

    // Update user's language if detected and different from stored
    if (params.detected_language && user && params.detected_language !== user.preferred_language) {
      await updateUserLanguage(phone, params.detected_language);
    }

    // Helper to build response context with user profile
    const responseCtx = (scenario: string, extra?: Partial<Parameters<typeof generateResponse>[0]>) => ({
      scenario,
      state: currentState,
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
      ...extra,
    });

    // --- Global intents (any state) ---
    if (intent === "cancel_session" && participant) {
      return await handleCancel(participant, user);
    }
    if (intent === "show_help") {
      await sendTextMessage(phone, await generateResponse(responseCtx("show_help")));
      return { action: "showed_help" };
    }
    if (intent === "show_status" && participant) {
      await sendTextMessage(phone, `Status: ${participant.state}`);
      return { action: "status" };
    }
    if (intent === "unsupported_media") {
      await sendTextMessage(phone, "I can't process voice messages, videos, or stickers — send me text, a photo, or a PDF instead.");
      return { action: "unsupported_media" };
    }
    if (intent === "reset_all") {
      await resetUserData(phone);
      await sendTextMessage(phone, "All cleared. Send *new* to start fresh.");
      return { action: "reset" };
    }
    if (intent === "new_partner") {
      await clearPartner(phone);
      if (participant) {
        await updateSessionStatus(participant.session_id, "EXPIRED");
      }
      await sendTextMessage(phone, "Got it — starting fresh. Send *new* to schedule with someone new.");
      return { action: "new_partner" };
    }

    // --- Handle name provision globally (user can share name at any point) ---
    if (intent === "provide_name" && params.name) {
      await updateUserName(phone, params.name);
      if (!participant) {
        // New user just shared their name — welcome them properly
        await sendTextMessage(phone, await generateResponse(responseCtx("ask_partner", { userName: params.name })));
        return { action: "name_received", name: params.name };
      }
      // Already in a session — acknowledge and continue
      await sendTextMessage(phone, `Got it, ${params.name}!`);
      return { action: "name_updated", name: params.name };
    }

    // --- No active session ---
    if (!participant) {
      return await handleIdleUser(phone, intent, params, user, text);
    }

    // --- Unknown intent — use inline reply from intent router ---
    if (intent === "unknown") {
      const reply = params.reply as string | undefined;
      if (reply) {
        await sendTextMessage(phone, reply);
      } else {
        await sendTextMessage(phone, await generateResponse(responseCtx("unknown_intent", { userMessage: text })));
      }
      return { action: "conversational_response" };
    }

    // --- Route by state + intent ---
    switch (participant.state) {
      case "AWAITING_PARTNER_INFO":
        return await handleAwaitingPartnerInfo(phone, intent, params, user);

      case "AWAITING_PARTNER":
        return await handleAwaitingPartner(phone, participant, intent, user);

      case "AWAITING_SCHEDULE":
        return await handleAwaitingSchedule(participant, payload, intent, params);

      case "SCHEDULE_RECEIVED":
        await sendTextMessage(phone, "Still analyzing your schedule... please wait a moment.");
        return { action: "parsing_in_progress" };

      case "AWAITING_CONFIRMATION":
        // If user sends a new photo/doc, treat as re-upload
        if ((message_type === "image" || message_type === "document") && media_id) {
          await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
          await sendTextMessage(phone, "Got your updated schedule! Re-analyzing...");
          await scheduleParser.trigger({
            participant_id: participant.id, session_id: participant.session_id,
            phone, media_id, mime_type: mime_type ?? "image/jpeg",
          });
          return { action: "schedule_re_uploaded" };
        }
        return await handleAwaitingConfirmation(participant, intent, params, text);

      case "SCHEDULE_CONFIRMED":
        await sendTextMessage(phone, "Your schedule is confirmed! Waiting for your colleague...");
        return { action: "waiting_for_partner" };

      case "AWAITING_PREFERENCES":
        return await handleAwaitingPreferences(participant, intent, params, text);

      case "PREFERENCES_SUBMITTED":
        await sendTextMessage(phone, "Your preferences are saved! Waiting for your colleague...");
        return { action: "waiting_for_partner_prefs" };

      case "COMPLETED":
        if (intent === "create_session" || intent === "greeting") {
          return await handleNewSession(phone, user);
        }
        await sendTextMessage(phone, "Your last session is done! Send *new* to start a fresh one.");
        return { action: "session_complete" };

      default:
        await sendTextMessage(phone, "Something went wrong. Send *new* to start fresh or *cancel* to reset.");
        return { action: "unknown_state" };
    }
  },
});

// --- State handlers ---

async function handleIdleUser(
  phone: string,
  intent: string,
  params: Record<string, unknown>,
  user: UserProfile | null,
  userMessage?: string
) {
  // Check if someone invited this user
  const invite = await getPendingInviteForPhone(phone);
  if (invite) {
    // Let user decline if they explicitly don't want to
    if (intent === "decline_invite") {
      await updateInviteStatus(invite.id, "DECLINED");
      const inviterUser = await getUser(invite.inviter_phone);
      await sendTextMessage(phone, "No problem! Send *new* when you're ready to schedule.");
      await sendTextMessage(invite.inviter_phone,
        `${user?.name ?? "Your partner"} isn't available right now. Send *new* to try someone else.`);
      return { action: "invite_declined" };
    }
    // Auto-pair on any other message
    return await handleAcceptInvite(phone, invite, user);
  }

  // Only auto-pair when user explicitly wants the same partner
  if (intent === "resume_partner") {
    const partner = await getPartnerForPhone(phone);
    if (partner) {
      const partnerPhone = partner.phone_a === phone ? partner.phone_b : partner.phone_a;
      return await handleReturningPartner(phone, partnerPhone, user);
    }
    return await handleNewSession(phone, user);
  }

  // "new" / "start" / greeting
  if (intent === "create_session" || intent === "greeting") {
    // First-time user with no name — ask for it
    if (!user?.name) {
      await registerUser(phone);
      await sendTextMessage(phone, await generateResponse({
        scenario: "idle_welcome", state: "IDLE",
        userName: user?.name ?? undefined,
        userLanguage: user?.preferred_language ?? undefined,
      }));
      return { action: "welcomed_new_user" };
    }
    return await handleNewSession(phone, user);
  }

  // Off-script while idle
  await sendTextMessage(phone, await generateResponse({
    scenario: "idle_welcome", state: "IDLE", userMessage,
    userName: user?.name ?? undefined,
    userLanguage: user?.preferred_language ?? undefined,
  }));
  return { action: "showed_help" };
}

/** Start a new scheduling session — ask who they want to schedule with */
async function handleNewSession(phone: string, user: UserProfile | null) {
  // Clean up any lingering active sessions for this phone
  await query(
    "UPDATE sessions SET status = 'EXPIRED' WHERE creator_phone = ? AND status NOT IN ('EXPIRED', 'COMPLETED')",
    [phone]
  );

  const sessionId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const code = crypto.randomUUID().slice(0, 6).toUpperCase(); // placeholder — column is NOT NULL
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await query(
    "INSERT INTO sessions (id, code, creator_phone, status, expires_at) VALUES (?, ?, ?, 'AWAITING_PARTNER', ?)",
    [sessionId, code, phone, expiresAt]
  );
  await query(
    "INSERT INTO participants (id, session_id, phone, role, state) VALUES (?, ?, ?, 'creator', 'AWAITING_PARTNER_INFO')",
    [participantId, sessionId, phone]
  );

  await sendTextMessage(phone, await generateResponse({
    scenario: "ask_partner", state: "AWAITING_PARTNER_INFO",
    userName: user?.name ?? undefined,
    userLanguage: user?.preferred_language ?? undefined,
  }));
  return { action: "session_created_awaiting_partner", session_id: sessionId };
}

/** Handle user telling us who they want to schedule with */
async function handleAwaitingPartnerInfo(
  phone: string,
  intent: string,
  params: Record<string, unknown>,
  user: UserProfile | null
) {
  const participant = await getParticipantByPhone(phone);
  if (!participant) return { action: "no_participant" };

  if (intent !== "provide_partner" || (!params.partner_name && !params.partner_phone)) {
    // Not a partner provision — remind them
    await sendTextMessage(phone, await generateResponse({
      scenario: "ask_partner", state: "AWAITING_PARTNER_INFO",
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
    }));
    return { action: "reminded_partner_info" };
  }

  // User gave a phone number
  if (params.partner_phone) {
    const partnerPhone = String(params.partner_phone).replace(/[^0-9]/g, "");

    // Guard: can't schedule with yourself
    if (partnerPhone === phone) {
      await sendTextMessage(phone, "That's your own number! Who else do you want to schedule with?");
      return { action: "self_pairing_blocked" };
    }

    const partnerUser = await findUserByPhone(partnerPhone);

    if (partnerUser) {
      // Known user — instant pair
      return await instantPair(phone, partnerPhone, participant.session_id, user, partnerUser);
    }

    // Unknown phone — create pending invite
    await updateParticipantState(participant.id, "AWAITING_PARTNER");
    await createPendingInvite(phone, partnerPhone, participant.session_id);
    await sendTextMessage(phone, await generateResponse({
      scenario: "invite_sent", state: "AWAITING_PARTNER",
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
    }));
    return { action: "invite_created", invitee: partnerPhone };
  }

  // User gave a name
  if (params.partner_name) {
    const matches = (await findUserByName(String(params.partner_name)))
      .filter((m) => m.phone !== phone); // exclude self from results

    if (matches.length === 1) {
      // Exact match — instant pair
      return await instantPair(phone, matches[0].phone, participant.session_id, user, matches[0]);
    }

    if (matches.length > 1) {
      // Multiple matches — ask for clarification
      const list = matches.map((m, i) => `${i + 1}. ${m.name} (${m.phone.slice(-4)})`).join("\n");
      await sendTextMessage(phone, `I know a few people with that name:\n\n${list}\n\nWhich one? Send their phone number.`);
      return { action: "multiple_matches" };
    }

    // No match — ask for phone
    await sendTextMessage(phone, await generateResponse({
      scenario: "partner_not_found", state: "AWAITING_PARTNER_INFO",
      userName: user?.name ?? undefined,
      userLanguage: user?.preferred_language ?? undefined,
      extraContext: String(params.partner_name),
    }));
    return { action: "partner_not_found" };
  }

  return { action: "no_partner_info" };
}

/** Handle user waiting for their partner to message the bot */
async function handleAwaitingPartner(
  phone: string,
  participant: { id: string; session_id: string; phone: string },
  intent: string,
  user: UserProfile | null
) {
  // cancel_session is handled globally before this point

  await sendTextMessage(phone, await generateResponse({
    scenario: "awaiting_partner_reminder", state: "AWAITING_PARTNER",
    userName: user?.name ?? undefined,
    userLanguage: user?.preferred_language ?? undefined,
  }));
  return { action: "reminded_awaiting_partner" };
}

/** Instantly pair two known users */
async function instantPair(
  creatorPhone: string,
  partnerPhone: string,
  sessionId: string,
  creatorUser: UserProfile | null,
  partnerUser: UserProfile | null
) {
  const partnerId = crypto.randomUUID();

  // Update session
  await query(
    "UPDATE sessions SET partner_phone = ?, status = 'PAIRED' WHERE id = ?",
    [partnerPhone, sessionId]
  );

  // Move creator to AWAITING_SCHEDULE
  const creatorParticipant = await getParticipantByPhone(creatorPhone);
  if (creatorParticipant) {
    await updateParticipantState(creatorParticipant.id, "AWAITING_SCHEDULE");
  }

  // Create partner participant
  await query(
    "INSERT INTO participants (id, session_id, phone, role, state) VALUES (?, ?, ?, 'partner', 'AWAITING_SCHEDULE')",
    [partnerId, sessionId, partnerPhone]
  );

  // Start orchestrator
  await sessionOrchestrator.trigger({ session_id: sessionId }, { idempotencyKey: `orch-${sessionId}` });

  // Notify creator
  await sendTextMessage(creatorPhone, await generateResponse({
    scenario: "partner_found", state: "AWAITING_SCHEDULE",
    userName: creatorUser?.name ?? undefined,
    userLanguage: creatorUser?.preferred_language ?? undefined,
    partnerName: partnerUser?.name ?? undefined,
  }));

  // Notify partner
  await sendTextMessage(partnerPhone, await generateResponse({
    scenario: "invite_accepted_invitee", state: "AWAITING_SCHEDULE",
    userName: partnerUser?.name ?? undefined,
    userLanguage: partnerUser?.preferred_language ?? undefined,
    partnerName: creatorUser?.name ?? undefined,
  }));

  return { action: "instant_paired", session_id: sessionId };
}

/** Accept a pending invite — auto-pair when invitee messages the bot */
async function handleAcceptInvite(
  phone: string,
  invite: { id: string; inviter_phone: string; session_id: string },
  inviteeUser: UserProfile | null
) {
  // Validate the invite's session is still active (session has 24h TTL, invite has 7d)
  const session = await query<{ status: string; expires_at: string }>(
    "SELECT status, expires_at FROM sessions WHERE id = ? LIMIT 1",
    [invite.session_id]
  );
  const sess = session.results[0];
  if (!sess || sess.status === "EXPIRED" || sess.status === "COMPLETED" || new Date(sess.expires_at) < new Date()) {
    await updateInviteStatus(invite.id, "EXPIRED");
    await sendTextMessage(phone, "That scheduling session expired. Send *new* to start fresh!");
    return { action: "invite_session_expired" };
  }

  await updateInviteStatus(invite.id, "ACCEPTED");

  const inviterUser = await getUser(invite.inviter_phone);
  const partnerId = crypto.randomUUID();

  // Update session to PAIRED
  await query(
    "UPDATE sessions SET partner_phone = ?, status = 'PAIRED' WHERE id = ?",
    [phone, invite.session_id]
  );

  // Move inviter to AWAITING_SCHEDULE
  const inviterParticipant = await getParticipantByPhone(invite.inviter_phone);
  if (inviterParticipant) {
    await updateParticipantState(inviterParticipant.id, "AWAITING_SCHEDULE");
  }

  // Create invitee participant (try/catch for race condition — duplicate messages)
  try {
    await query(
      "INSERT INTO participants (id, session_id, phone, role, state) VALUES (?, ?, ?, 'partner', 'AWAITING_SCHEDULE')",
      [partnerId, invite.session_id, phone]
    );
  } catch {
    // UNIQUE constraint violation — already joined this session
    await sendTextMessage(phone, "You're already in this session! Send your work schedule.");
    return { action: "already_joined" };
  }

  // Start orchestrator
  await sessionOrchestrator.trigger(
    { session_id: invite.session_id },
    { idempotencyKey: `orch-${invite.session_id}` }
  );

  // Notify inviter
  await sendTextMessage(invite.inviter_phone, await generateResponse({
    scenario: "invite_accepted_creator", state: "AWAITING_SCHEDULE",
    userName: inviterUser?.name ?? undefined,
    userLanguage: inviterUser?.preferred_language ?? undefined,
    partnerName: inviteeUser?.name ?? undefined,
  }));

  // Notify invitee
  await sendTextMessage(phone, await generateResponse({
    scenario: "invite_accepted_invitee", state: "AWAITING_SCHEDULE",
    userName: inviteeUser?.name ?? undefined,
    userLanguage: inviteeUser?.preferred_language ?? undefined,
    partnerName: inviterUser?.name ?? undefined,
  }));

  return { action: "invite_accepted", session_id: invite.session_id };
}

/** Auto-create session for a known partner pair — no codes needed */
async function handleReturningPartner(phone: string, partnerPhone: string, user: UserProfile | null) {
  // Clean up old sessions
  await query(
    "UPDATE sessions SET status = 'EXPIRED' WHERE creator_phone = ? AND status NOT IN ('EXPIRED', 'COMPLETED')",
    [phone]
  );

  const sessionId = crypto.randomUUID();
  const creatorId = crypto.randomUUID();
  const partnerId = crypto.randomUUID();
  const code = crypto.randomUUID().slice(0, 6).toUpperCase(); // placeholder
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const partnerUser = await getUser(partnerPhone);

  await query(
    "INSERT INTO sessions (id, code, creator_phone, partner_phone, status, expires_at) VALUES (?, ?, ?, ?, 'PAIRED', ?)",
    [sessionId, code, phone, partnerPhone, expiresAt]
  );
  await query(
    "INSERT INTO participants (id, session_id, phone, role, state) VALUES (?, ?, ?, 'creator', 'AWAITING_SCHEDULE')",
    [creatorId, sessionId, phone]
  );
  await query(
    "INSERT INTO participants (id, session_id, phone, role, state) VALUES (?, ?, ?, 'partner', 'AWAITING_SCHEDULE')",
    [partnerId, sessionId, partnerPhone]
  );

  await sessionOrchestrator.trigger({ session_id: sessionId }, { idempotencyKey: `orch-${sessionId}` });

  await sendTextMessage(phone, await generateResponse({
    scenario: "returning_partner_creator", state: "AWAITING_SCHEDULE",
    userName: user?.name ?? undefined,
    userLanguage: user?.preferred_language ?? undefined,
    partnerName: partnerUser?.name ?? undefined,
  }));
  await sendTextMessage(partnerPhone, await generateResponse({
    scenario: "returning_partner_partner", state: "AWAITING_SCHEDULE",
    userName: partnerUser?.name ?? undefined,
    userLanguage: partnerUser?.preferred_language ?? undefined,
    partnerName: user?.name ?? undefined,
  }));

  return { action: "session_resumed", session_id: sessionId };
}

async function handleAwaitingSchedule(
  participant: { id: string; session_id: string; phone: string },
  payload: z.infer<typeof payloadSchema>,
  intent: string,
  params: Record<string, unknown>
) {
  const { phone, message_type, media_id, mime_type } = payload;

  // File upload (image or document)
  if (message_type === "image" || message_type === "document") {
    if (!media_id) {
      await sendTextMessage(phone, "I couldn't receive that file. Try sending it again.");
      return { action: "missing_media" };
    }

    await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
    await sendTextMessage(phone, "Got your schedule! Analyzing it now...");

    await scheduleParser.trigger({
      participant_id: participant.id,
      session_id: participant.session_id,
      phone,
      media_id,
      mime_type: mime_type ?? "image/jpeg",
    });
    return { action: "schedule_received_file", media_id };
  }

  // Text-based schedule input
  if (intent === "upload_schedule_text" && params.schedule_text) {
    await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
    await sendTextMessage(phone, "Got it! Parsing your schedule...");

    await scheduleParser.trigger({
      participant_id: participant.id,
      session_id: participant.session_id,
      phone,
      text_content: String(params.schedule_text),
    });
    return { action: "schedule_received_text" };
  }

  await sendTextMessage(phone, await generateResponse({
    scenario: "remind_upload", state: "AWAITING_SCHEDULE", userMessage: payload.text,
  }));
  return { action: "reminded_upload" };
}

async function handleAwaitingConfirmation(
  participant: { id: string; session_id: string; phone: string; schedule_json: string | null },
  intent: string,
  params: Record<string, unknown>,
  userMessage?: string
) {
  if (intent === "confirm_schedule") {
    await updateParticipantState(participant.id, "SCHEDULE_CONFIRMED");
    await sendTextMessage(participant.phone, "Schedule confirmed! Waiting for your colleague...");
    await checkBothConfirmed(participant.session_id);
    return { action: "schedule_confirmed" };
  }

  if (intent === "reject_schedule") {
    await updateParticipantState(participant.id, "AWAITING_SCHEDULE");
    await sendTextMessage(participant.phone, "No worries — send me your schedule again (photo, PDF, or type your hours).");
    return { action: "schedule_rejected" };
  }

  if (intent === "clarify_schedule" && params.clarification && participant.schedule_json) {
    await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
    await sendTextMessage(participant.phone, "Got it, re-analyzing with your feedback...");

    await scheduleParser.trigger({
      participant_id: participant.id,
      session_id: participant.session_id,
      phone: participant.phone,
      text_content: `Previous schedule data: ${participant.schedule_json}\n\nUser clarification: ${String(params.clarification)}\n\nRe-extract the schedule applying the user's clarification. Include ALL shifts that match their request.`,
    });
    return { action: "schedule_clarified" };
  }

  await sendTextMessage(participant.phone, await generateResponse({
    scenario: "confirm_prompt", state: "AWAITING_CONFIRMATION", userMessage,
  }));
  return { action: "awaiting_confirmation" };
}

async function handleAwaitingPreferences(
  participant: { id: string; session_id: string; phone: string },
  intent: string,
  params: Record<string, unknown>,
  userMessage?: string
) {
  if (intent === "submit_preferences" && Array.isArray(params.slots) && params.slots.length > 0) {
    const slots = (params.slots as number[]).filter((n) => n > 0);

    await updateParticipantState(participant.id, "PREFERENCES_SUBMITTED", {
      preferred_slots: slots.join(","),
    });
    await sendTextMessage(participant.phone, `Saved your preferences: slots ${slots.join(", ")}. Waiting for your colleague...`);
    await checkBothPreferred(participant.session_id);
    return { action: "preferences_submitted", slots };
  }

  await sendTextMessage(participant.phone, await generateResponse({
    scenario: "remind_preferences", state: "AWAITING_PREFERENCES", userMessage,
  }));
  return { action: "reminded_preferences" };
}

// --- Global command handlers ---

async function handleCancel(
  participant: { id: string; session_id: string; phone: string },
  user: UserProfile | null
) {
  await updateParticipantState(participant.id, "COMPLETED");
  await updateSessionStatus(participant.session_id, "EXPIRED");

  const participants = await getSessionParticipants(participant.session_id);
  for (const p of participants) {
    if (p.phone !== participant.phone) {
      await sendTextMessage(p.phone, "Your colleague cancelled the session. Send *new* to start a fresh one.");
      await updateParticipantState(p.id, "COMPLETED");
    }
  }

  // Also expire any pending invites for this session
  await query(
    "UPDATE pending_invites SET status = 'CANCELLED' WHERE session_id = ? AND status = 'PENDING'",
    [participant.session_id]
  );

  await sendTextMessage(participant.phone, "Session cancelled. Send *new* to start a fresh one.");
  return { action: "cancelled" };
}

// --- Waitpoint helpers ---

async function checkBothConfirmed(sessionId: string) {
  const participants = await getSessionParticipants(sessionId);
  if (!participants.every((p) => p.state === "SCHEDULE_CONFIRMED")) return;

  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await query<{ both_confirmed_token_id: string | null }>(
      "SELECT both_confirmed_token_id FROM sessions WHERE id = ?", [sessionId]
    );
    const tokenId = result.results[0]?.both_confirmed_token_id;
    if (tokenId) {
      await wait.completeToken(tokenId, { completed: true });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.warn(`Confirmed token not found for session ${sessionId}`);
}

async function checkBothPreferred(sessionId: string) {
  const participants = await getSessionParticipants(sessionId);
  if (!participants.every((p) => p.state === "PREFERENCES_SUBMITTED")) return;

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await query<{ both_preferred_token_id: string | null }>(
      "SELECT both_preferred_token_id FROM sessions WHERE id = ?", [sessionId]
    );
    const tokenId = result.results[0]?.both_preferred_token_id;
    if (tokenId) {
      await wait.completeToken(tokenId, { completed: true });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.warn(`Preference token not found for session ${sessionId}`);
}
