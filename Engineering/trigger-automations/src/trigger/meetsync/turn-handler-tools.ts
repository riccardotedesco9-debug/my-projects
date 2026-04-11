// Turn-handler tools — the 8 Anthropic tools the turn-handler exposes to
// Claude Sonnet on every turn. Each tool has a JSON schema (for the model)
// and an `execute` function (the actual implementation).
//
// Design rules:
//   1. Tools are pure wrappers over existing helpers (d1-client, parser,
//      match-compute, deliver-results). No new business logic lives here.
//   2. Errors are returned as structured {error: string} tool results, never
//      thrown. Claude reads the error and decides how to recover.
//   3. Writes that mutate the snapshot don't refresh it — tool results
//      contain the delta (e.g. "saved 5 shifts to Diego") so Claude has
//      enough context for the next decision.
//   4. Privacy: tools scope to the caller's own data. Cross-user reads are
//      only possible through fields the caller has in their snapshot (their
//      own session participants, their own person_notes).
//   5. `reply` is the terminal tool — its implementation stores the reply
//      in the context and the loop exits.

import {
  query,
  updateUserName,
  updateUserLanguage,
  updateUserPhone,
  updateUserTimezone,
  appendUserContext,
  upsertPersonNote,
  setPersonNoteSchedule,
  findPersonNote,
  findUserByName,
  findUserByPhone,
  createPendingInvite,
  saveParticipantSchedule,
  cancelSession,
  reopenLastCompletedSession,
  resetUserData,
  emitSessionEvent,
  getSessionParticipants,
  getSessionById,
  getUser,
  getPersonNotesForOwner,
  linkPersonNoteToChat,
  updateInviteStatus,
  type Snapshot,
  type SnapshotSessionEntry,
} from "./d1-client.js";
import {
  extractSchedule,
  mapMimeType,
  arrayBufferToBase64,
  type ExtractScheduleResult,
} from "./schedule-parser.js";
import {
  computeOverlaps,
  persistComputedSlots,
  computeSinglePersonSlots,
  type ComputedFreeSlot,
} from "./match-compute.js";
import { deliverMatchToSession } from "./deliver-results.js";
import { downloadMedia, sendTextMessage } from "./telegram-client.js";

// --- Types ---

export interface ReplyButton {
  text: string;
  callback: "confirm" | "reject" | "yes" | "no";
}

export interface PendingReply {
  messages: string[];   // 1+ messages to send in order
  buttons?: ReplyButton[]; // inline keyboard on the LAST message only
}

export interface ToolContext {
  callerChatId: string;
  snapshot: Snapshot;
  /** Cached media from the current turn (if any). parse_schedule reuses this. */
  cachedMedia?: { base64: string; mediaType: string };
  /** Text from the current turn — used when the user types "I work 9-5" without calling parse_schedule on a file. */
  currentText?: string;
  /** Populated by the reply tool. The handler reads this after the loop exits and sends to Telegram. */
  pendingReply?: PendingReply;
  /** Set when the reply tool has been called — signals the handler to exit the loop. */
  replySent: boolean;
}

export interface ToolResult {
  [key: string]: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// --- Helpers ---

/**
 * Resolve which active session a tool should act on. If the caller provided
 * an explicit session_id, validate it's in the snapshot. Otherwise default
 * to the most recent active session. Returns null if the caller has no
 * active sessions at all.
 */
function resolveSession(ctx: ToolContext, explicitId?: string): SnapshotSessionEntry | null {
  if (ctx.snapshot.activeSessions.length === 0) return null;
  if (explicitId) {
    const found = ctx.snapshot.activeSessions.find((s) => s.session.id === explicitId);
    if (found) return found;
    // Fall through — caller gave a stale id. Use the default.
  }
  return ctx.snapshot.activeSessions[0]; // most recent first
}

// --- Tool 1: parse_schedule (auto-saves on success) ---
//
// Extracts shifts and writes them straight to D1 in one call —
// participant.schedule_json for the caller's own schedule,
// person_notes.schedule_json when attributed_to_name is set. Auto-creates
// a session if the caller has none. Returns the parsed shifts. Claude
// reads the result and decides how to reply.

const parseScheduleTool: ToolDefinition = {
  name: "parse_schedule",
  description:
    "Extract and save shifts from a schedule. Four input modes (in priority order): (1) shifts — pass a structured shifts array directly when you've already read the schedule yourself from an attached image/PDF/voice transcript and just need to save it (skips the parser entirely, fastest and most reliable path); (2) text_content for typed input the user gave you; (3) media_id to fetch a Telegram file by id — use this when the user references a file they shared in a previous turn (you'll see entries like '[document uploaded · file_id=ABC]' or '[photo uploaded · file_id=XYZ]' in recent history; pass that exact file_id); (4) omit all to use the current turn's attached media. attributed_to_name flags an on-behalf upload for someone other than the user. Auto-saves to D1.",
  input_schema: {
    type: "object",
    properties: {
      shifts: {
        type: "array",
        description: "Pre-extracted shifts to save directly. Use this when you can already see the schedule in an attached file or in the user's text — skips the parser entirely. Each shift: {date: 'YYYY-MM-DD', start_time: 'HH:MM', end_time: 'HH:MM', label?: string}. Use 24-hour times. For days off, use start='00:00' end='00:00' with label='off' or 'free'.",
        items: {
          type: "object",
          required: ["date", "start_time", "end_time"],
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            start_time: { type: "string", description: "HH:MM (24h)" },
            end_time: { type: "string", description: "HH:MM (24h)" },
            label: { type: "string" },
          },
        },
      },
      text_content: {
        type: "string",
        description: "Typed hours or text description. Use this when the user typed their schedule and you want the parser to extract structured shifts.",
      },
      media_id: {
        type: "string",
        description: "Telegram file_id from a previous turn's history entry. Use this when the user references a file they already sent.",
      },
      mime_type: {
        type: "string",
        description: "MIME type for media_id. Optional — defaults to JPEG.",
      },
      attributed_to_name: {
        type: "string",
        description: "Name of the third party this schedule is for, if it's not the user's own schedule.",
      },
      session_id: {
        type: "string",
        description: "Session to save the user's own schedule to. Defaults to the most recent active session, creates a fresh one if none exists.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const directShifts = Array.isArray(input.shifts) ? (input.shifts as Array<Record<string, unknown>>) : undefined;
    const textContent = typeof input.text_content === "string" ? input.text_content : undefined;
    const explicitMediaId = typeof input.media_id === "string" ? input.media_id.trim() : "";
    const explicitMimeType = typeof input.mime_type === "string" ? input.mime_type : undefined;
    const attributedToName = typeof input.attributed_to_name === "string" ? input.attributed_to_name.trim() : "";
    const explicitSessionId = typeof input.session_id === "string" ? input.session_id : undefined;

    try {
      // 0. Direct-shifts path: Claude already extracted shifts from a file
      //    it can see in its multimodal context (attached image/PDF/voice
      //    transcript). Skip the parser entirely. This is the escape hatch
      //    for when extractSchedule's separate Sonnet call has trouble with
      //    a file that Claude itself reads fine.
      if (directShifts && directShifts.length > 0) {
        const validated: Array<{ date: string; start_time: string; end_time: string; label?: string }> = [];
        const dateRe = /^\d{4}-\d{2}-\d{2}$/;
        const timeRe = /^\d{2}:\d{2}$/;
        for (const raw of directShifts) {
          const date = typeof raw.date === "string" ? raw.date : "";
          const start = typeof raw.start_time === "string" ? raw.start_time : "";
          const end = typeof raw.end_time === "string" ? raw.end_time : "";
          const label = typeof raw.label === "string" ? raw.label : undefined;
          if (!dateRe.test(date) || !timeRe.test(start) || !timeRe.test(end)) {
            return {
              ok: false,
              error: `Invalid shift format: date='${date}' start='${start}' end='${end}'. Each shift needs date='YYYY-MM-DD', start_time='HH:MM', end_time='HH:MM'. Fix the array and call again.`,
            };
          }
          validated.push({ date, start_time: start, end_time: end, ...(label ? { label } : {}) });
        }
        const fakeResult: ExtractScheduleResult = { shifts: validated };
        return await persistShifts(ctx, fakeResult, attributedToName, explicitSessionId, "direct");
      }

      // 1. Resolve media: explicit media_id (download from Telegram) wins,
      //    then current-turn cachedMedia, then text_content as a last resort.
      //    The explicit media_id path is what lets the bot recover the user's
      //    "I already sent it" reference — Claude reads the file_id from
      //    conversation history and passes it here.
      let resolvedMedia: { base64: string; mediaType: string } | undefined;
      if (explicitMediaId) {
        try {
          const { buffer, mimeType: detectedMime } = await downloadMedia(explicitMediaId);
          const mediaType = mapMimeType(explicitMimeType ?? detectedMime ?? "image/jpeg");
          resolvedMedia = { base64: arrayBufferToBase64(buffer), mediaType };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await emitSessionEvent(
            ctx.snapshot.activeSessions[0]?.session.id ?? "no-session",
            "parse_schedule_media_download_failed",
            { chat_id: ctx.callerChatId, media_id: explicitMediaId, error: msg.slice(0, 200) },
          );
          return {
            ok: false,
            error: `Couldn't download file_id=${explicitMediaId} from Telegram. The file may have expired (Telegram file_ids are session-scoped) or the id is wrong. Tell the user honestly that the previous file isn't fetchable any more and ask them to re-send it. Underlying: ${msg.slice(0, 200)}`,
          };
        }
      } else if (ctx.cachedMedia) {
        resolvedMedia = ctx.cachedMedia;
      }

      let result: ExtractScheduleResult;
      if (textContent) {
        result = await extractSchedule({
          text: textContent,
          userName: ctx.snapshot.user.name ?? undefined,
          timezone: ctx.snapshot.timezone,
          attributedToName: attributedToName || undefined,
        });
      } else if (resolvedMedia) {
        result = await extractSchedule({
          media: resolvedMedia,
          userName: ctx.snapshot.user.name ?? undefined,
          timezone: ctx.snapshot.timezone,
          attributedToName: attributedToName || undefined,
        });
      } else {
        return {
          ok: false,
          error: "No media available and no text_content provided. Tell the user honestly that nothing was passed to the parser, ask them to either send the schedule or type their hours.",
        };
      }

      if (result.shifts.length === 0) {
        await emitSessionEvent(
          ctx.snapshot.activeSessions[0]?.session.id ?? "no-session",
          "parse_schedule_zero_shifts",
          { chat_id: ctx.callerChatId, input_kind: textContent ? "text" : "media", attributed: attributedToName || null },
        );
        return {
          ok: false,
          error: "Parser returned 0 shifts. The file may be unreadable, low-resolution, or not contain a schedule.",
        };
      }

      return await persistShifts(ctx, result, attributedToName, explicitSessionId, textContent ? "text" : "media");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface the underlying error to the dashboard so we can see WHY
      // extractSchedule keeps throwing on certain inputs (Sonnet schema
      // mismatch, JSON parse failure, API timeout, etc).
      await emitSessionEvent(
        ctx.snapshot.activeSessions[0]?.session.id ?? "no-session",
        "parse_schedule_threw",
        { chat_id: ctx.callerChatId, error: msg.slice(0, 400) },
      );
      return { ok: false, error: `parse_schedule threw: ${msg.slice(0, 300)}` };
    }
  },
};

/**
 * Save extracted shifts to the right target (person_note or participant)
 * and sync the in-turn snapshot. Used by both the parser path and the
 * direct-shifts escape hatch.
 */
async function persistShifts(
  ctx: ToolContext,
  result: ExtractScheduleResult,
  attributedToName: string,
  explicitSessionId: string | undefined,
  source: "direct" | "text" | "media",
): Promise<ToolResult> {
  const scheduleJson = JSON.stringify(result.shifts);

  // On-behalf path → person_notes
  if (attributedToName) {
    await upsertPersonNote(ctx.callerChatId, attributedToName);
    await setPersonNoteSchedule(ctx.callerChatId, attributedToName, scheduleJson);
    const existing = ctx.snapshot.personNotes.find(
      (n) => n.name.toLowerCase() === attributedToName.toLowerCase(),
    );
    if (existing) {
      existing.schedule_json = scheduleJson;
    } else {
      ctx.snapshot.personNotes.push({
        id: 0,
        owner_chat_id: ctx.callerChatId,
        name: attributedToName,
        name_normalized: attributedToName.toLowerCase(),
        phone: null,
        linked_chat_id: null,
        schedule_json: scheduleJson,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    await emitSessionEvent(
      ctx.snapshot.activeSessions[0]?.session.id ?? "no-session",
      "parse_schedule_saved",
      { chat_id: ctx.callerChatId, source, target: `person_note:${attributedToName}`, shift_count: result.shifts.length },
    );
    return {
      saved: true,
      saved_to: `person_note:${attributedToName}`,
      shift_count: result.shifts.length,
      shifts: result.shifts,
    };
  }

  // Self path → participant.schedule_json
  let sessionEntry = resolveSession(ctx, explicitSessionId);
  if (!sessionEntry) {
    const sessionId = crypto.randomUUID();
    const code = crypto.randomUUID().slice(0, 6).toUpperCase();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await query(
      "INSERT INTO sessions (id, code, creator_chat_id, status, expires_at) VALUES (?, ?, ?, 'OPEN', ?)",
      [sessionId, code, ctx.callerChatId, expiresAt],
    );
    const creatorParticipantId = crypto.randomUUID();
    await query(
      "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'creator', 'ACTIVE')",
      [creatorParticipantId, sessionId, ctx.callerChatId],
    );
    await emitSessionEvent(sessionId, "session_created", { via: "parse_schedule" });
    sessionEntry = {
      session: {
        id: sessionId,
        code,
        creator_chat_id: ctx.callerChatId,
        status: "OPEN",
        mode: null,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      participants: [
        {
          id: creatorParticipantId,
          chat_id: ctx.callerChatId,
          role: "creator",
          state: "ACTIVE",
          schedule_json: null,
          preferred_slots: null,
          name: ctx.snapshot.user.name,
          has_schedule: false,
        },
      ],
      pendingInvites: [],
    };
    ctx.snapshot.activeSessions.unshift(sessionEntry);
  }

  const myParticipant = sessionEntry.participants.find((p) => p.chat_id === ctx.callerChatId);
  if (!myParticipant) {
    return { ok: false, error: `Caller is not a participant in session ${sessionEntry.session.id}.` };
  }
  await saveParticipantSchedule(myParticipant.id, scheduleJson);
  myParticipant.schedule_json = scheduleJson;
  myParticipant.has_schedule = true;

  await emitSessionEvent(
    sessionEntry.session.id,
    "parse_schedule_saved",
    { chat_id: ctx.callerChatId, source, target: `participant:${ctx.callerChatId}`, shift_count: result.shifts.length },
  );
  return {
    saved: true,
    saved_to: `participant:${ctx.callerChatId}`,
    session_id: sessionEntry.session.id,
    shift_count: result.shifts.length,
    shifts: result.shifts,
  };
}

// (Tool 2 save_schedule was removed — parse_schedule now auto-saves on
// extraction so cross-turn shift persistence isn't a problem any more.)


// --- Tool 3: add_or_invite_partner ---

const addOrInvitePartnerTool: ToolDefinition = {
  name: "add_or_invite_partner",
  description:
    "Add someone to the current session by name or phone. Known bot users are added directly; unknown people get a pending invite + deep-link URL the caller can share. Returns ambiguous candidates when multiple users share a name.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      phone: { type: "string" },
      session_id: {
        type: "string",
        description: "Session to add to. Defaults to the caller's most recent active session. Creates a fresh session if caller has none.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const phone = typeof input.phone === "string" ? input.phone.replace(/[^0-9]/g, "") : "";
    const explicitSessionId = typeof input.session_id === "string" ? input.session_id : undefined;

    if (!name && !phone) {
      return { error: "Provide either name or phone." };
    }

    // Resolve or create a session — adding a partner without an active
    // session implies the caller wants to start one.
    let sessionEntry = resolveSession(ctx, explicitSessionId);
    if (!sessionEntry) {
      // Create a fresh session with the caller as the creator. We write to
      // D1 directly here (no existing d1-client helper for "create session
      // with creator participant" exists yet — it lives in old state-handlers
      // which are going away in phase 05). Small inline insert is fine.
      const sessionId = crypto.randomUUID();
      const code = crypto.randomUUID().slice(0, 6).toUpperCase();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await query(
        "INSERT INTO sessions (id, code, creator_chat_id, status, expires_at) VALUES (?, ?, ?, 'OPEN', ?)",
        [sessionId, code, ctx.callerChatId, expiresAt],
      );
      const creatorParticipantId = crypto.randomUUID();
      await query(
        "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'creator', 'ACTIVE')",
        [creatorParticipantId, sessionId, ctx.callerChatId],
      );
      await emitSessionEvent(sessionId, "session_created", { via: "add_or_invite_partner" });
      // Synthesise a snapshot entry so subsequent tools in this turn see it
      const fresh: SnapshotSessionEntry = {
        session: {
          id: sessionId,
          code,
          creator_chat_id: ctx.callerChatId,
          status: "OPEN",
          mode: null,
          created_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        participants: [
          {
            id: creatorParticipantId,
            chat_id: ctx.callerChatId,
            role: "creator",
            state: "ACTIVE",
            schedule_json: null,
            preferred_slots: null,
            name: ctx.snapshot.user.name,
            has_schedule: false,
          },
        ],
        pendingInvites: [],
      };
      ctx.snapshot.activeSessions.unshift(fresh);
      sessionEntry = fresh;
    }

    // Phone lookup takes priority when present
    if (phone) {
      const existing = await findUserByPhone(phone);
      if (existing && existing.chat_id !== ctx.callerChatId) {
        return await addKnownParticipant(ctx, sessionEntry, existing.chat_id, existing.name ?? null);
      }
      if (existing && existing.chat_id === ctx.callerChatId) {
        return { error: "That's the caller's own phone number — can't add themselves." };
      }
      // Unknown phone — invite
      await createPendingInvite(ctx.callerChatId, null, sessionEntry.session.id, phone);
      const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "MeetSyncBot";
      const inviteLink = `https://t.me/${botUsername}?start=invite_${sessionEntry.session.id}`;
      // Also upsert a person_note if a name was provided alongside the phone
      if (name) await upsertPersonNote(ctx.callerChatId, name, { phone });
      return {
        invited: true,
        invite_link: inviteLink,
        session_id: sessionEntry.session.id,
        notes: "Phone isn't linked to a bot user yet — share the invite link with them.",
      };
    }

    // Name lookup
    // 1. Check caller's own person_notes for a previously-linked Diego
    const existingNote = await findPersonNote(ctx.callerChatId, name);
    if (existingNote?.linked_chat_id && existingNote.linked_chat_id !== ctx.callerChatId) {
      return await addKnownParticipant(ctx, sessionEntry, existingNote.linked_chat_id, existingNote.name);
    }
    // 2. Global user lookup
    const matches = (await findUserByName(name)).filter((u) => u.chat_id !== ctx.callerChatId);
    if (matches.length === 1) {
      return await addKnownParticipant(ctx, sessionEntry, matches[0].chat_id, matches[0].name ?? null);
    }
    if (matches.length > 1) {
      return {
        ambiguous: true,
        candidates: matches.map((m) => ({
          name: m.name,
          phone_last_4: m.phone ? m.phone.slice(-4) : null,
        })),
        notes: "Multiple bot users match this name. Ask the caller to disambiguate by phone number.",
      };
    }
    // 3. Unknown name — create person_note + pending invite + return deep link
    await upsertPersonNote(ctx.callerChatId, name);
    await createPendingInvite(ctx.callerChatId, null, sessionEntry.session.id);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "MeetSyncBot";
    const inviteLink = `https://t.me/${botUsername}?start=invite_${sessionEntry.session.id}`;
    return {
      invited: true,
      invite_link: inviteLink,
      session_id: sessionEntry.session.id,
      partner_name: name,
      notes: `${name} isn't in the bot yet — share the invite link with them.`,
    };
  },
};

async function addKnownParticipant(
  ctx: ToolContext,
  sessionEntry: SnapshotSessionEntry,
  partnerChatId: string,
  partnerName: string | null,
): Promise<ToolResult> {
  // Idempotent: skip if already a participant
  const already = sessionEntry.participants.some((p) => p.chat_id === partnerChatId);
  if (already) {
    return {
      already_in_session: true,
      partner_name: partnerName,
      session_id: sessionEntry.session.id,
    };
  }
  const participantId = crypto.randomUUID();
  await query(
    "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'partner', 'ACTIVE')",
    [participantId, sessionEntry.session.id, partnerChatId],
  );
  // Update the in-turn snapshot so subsequent tools see the new participant
  sessionEntry.participants.push({
    id: participantId,
    chat_id: partnerChatId,
    role: "partner",
    state: "ACTIVE",
    schedule_json: null,
    preferred_slots: null,
    name: partnerName,
    has_schedule: false,
  });
  return {
    added: true,
    partner_chat_id: partnerChatId,
    partner_name: partnerName,
    session_id: sessionEntry.session.id,
  };
}

// --- Tool 3.5: accept_invite ---
//
// When a user taps a deep link like t.me/<bot>?start=invite_<sessionId>,
// Telegram delivers it as a text message "/start invite_<sessionId>" to the
// bot. Claude reads that in the user_message tag and calls this tool with
// the session_id parsed out. The tool joins the caller to the existing
// session, transfers any on-behalf schedule the inviter had uploaded for
// them (best-effort name match), notifies the inviter, and updates the
// in-turn snapshot so subsequent tools see the new state.

const acceptInviteTool: ToolDefinition = {
  name: "accept_invite",
  description:
    "Accept an invite to join an existing session via deep link. Call this when the user's first message is `/start invite_<sessionId>` (Telegram delivers tapped invite links this way) — extract the part after `invite_` as the session_id and pass it here. The tool adds the caller as a participant in the inviter's session, transfers any schedule the inviter previously uploaded on the caller's behalf (so they don't have to re-send it), notifies the inviter that the caller joined, and returns the resolved session_id and inviter info so you can welcome the new user with context.",
  input_schema: {
    type: "object",
    required: ["session_id"],
    properties: {
      session_id: {
        type: "string",
        description: "The session_id from the /start invite_<sessionId> deep link.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const sessionId = typeof input.session_id === "string" ? input.session_id.trim() : "";
    if (!sessionId) return { ok: false, error: "Missing session_id." };

    // 1. Validate session
    const session = await getSessionById(sessionId);
    if (!session) return { ok: false, error: `No session found with id ${sessionId}.` };
    if (session.status === "EXPIRED" || session.status === "COMPLETED") {
      return { ok: false, error: `Session ${sessionId} is ${session.status}. Tell the user the invite has expired and ask if they want to start a fresh session.` };
    }
    if (new Date(session.expires_at) < new Date()) {
      return { ok: false, error: `Session ${sessionId} expired at ${session.expires_at}. Tell the user the invite has timed out.` };
    }

    // 2. Idempotency: already a participant?
    const existing = await query<{ id: string }>(
      "SELECT id FROM participants WHERE session_id = ? AND chat_id = ? LIMIT 1",
      [sessionId, ctx.callerChatId],
    );
    if (existing.results.length > 0) {
      return { ok: true, already_joined: true, session_id: sessionId };
    }

    // 3. Insert participant row
    const participantId = crypto.randomUUID();
    await query(
      "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'partner', 'ACTIVE')",
      [participantId, sessionId, ctx.callerChatId],
    );

    // 4. Mark the pending invite as ACCEPTED (best-effort — there may not
    //    be an exact row matching this caller, since pending_invites are
    //    created without invitee_chat_id when the inviter only had a name).
    const pendingInvites = await query<{ id: string }>(
      "SELECT id FROM pending_invites WHERE session_id = ? AND status = 'PENDING' ORDER BY created_at ASC LIMIT 1",
      [sessionId],
    );
    if (pendingInvites.results[0]) {
      await updateInviteStatus(pendingInvites.results[0].id, "ACCEPTED");
    }

    // 5. Try to link an on-behalf person_note. The inviter may have already
    //    uploaded a schedule for the caller under their name. We try a few
    //    matching strategies (best-effort, no error if nothing matches).
    let linkedScheduleJson: string | null = null;
    let linkedName: string | null = null;
    try {
      const callerProfile = await getUser(ctx.callerChatId);
      const inviterNotes = await getPersonNotesForOwner(session.creator_chat_id);
      const unlinked = inviterNotes.filter((n) => !n.linked_chat_id);

      let candidate = null;
      // Strategy 1: caller's display name matches a person_note name
      if (callerProfile?.name) {
        const nameLower = callerProfile.name.toLowerCase();
        candidate = unlinked.find((n) => n.name.toLowerCase() === nameLower)
          ?? unlinked.find((n) => n.name.toLowerCase().includes(nameLower) || nameLower.includes(n.name.toLowerCase()));
      }
      // Strategy 2: only one unlinked note → assume it's this person
      if (!candidate && unlinked.length === 1) candidate = unlinked[0];

      if (candidate) {
        const linked = await linkPersonNoteToChat(session.creator_chat_id, candidate.name, ctx.callerChatId);
        if (linked) {
          linkedName = linked.name;
          if (linked.schedule_json) {
            // Transfer the on-behalf schedule onto the new participant row
            await saveParticipantSchedule(participantId, linked.schedule_json);
            linkedScheduleJson = linked.schedule_json;
          }
        }
      }
    } catch (err) {
      console.warn("[accept_invite] person_note link best-effort failed:", err);
    }

    // 6. Notify the inviter (best-effort — failure shouldn't block the join)
    let inviterName: string | null = null;
    try {
      const creatorUser = await getUser(session.creator_chat_id);
      inviterName = creatorUser?.name ?? null;
      const lang = creatorUser?.preferred_language ?? "en";
      const callerName = (await getUser(ctx.callerChatId))?.name ?? "Your invitee";
      const msg =
        lang === "it" ? `${callerName} ha accettato il tuo invito! 🎉`
        : lang === "es" ? `${callerName} aceptó tu invitación! 🎉`
        : lang === "fr" ? `${callerName} a accepté votre invitation ! 🎉`
        : lang === "de" ? `${callerName} hat deine Einladung angenommen! 🎉`
        : lang === "pt" ? `${callerName} aceitou o seu convite! 🎉`
        : `${callerName} just joined your session! 🎉`;
      await sendTextMessage(session.creator_chat_id, msg);
    } catch (err) {
      console.warn("[accept_invite] inviter notification failed:", err);
    }

    // 7. Sync in-turn snapshot so subsequent tools (and Claude's reply
    //    composition) see the new session — including the creator (so
    //    Claude knows who the inviter is) AND the caller (the new joinee).
    const allParticipantsFromDb = await getSessionParticipants(session.id);
    const builtParticipants = await Promise.all(
      allParticipantsFromDb.map(async (p) => {
        const u = p.chat_id === ctx.callerChatId
          ? ctx.snapshot.user
          : await getUser(p.chat_id);
        return {
          id: p.id,
          chat_id: p.chat_id,
          role: p.role,
          state: p.state,
          schedule_json: p.schedule_json,
          preferred_slots: p.preferred_slots,
          name: u?.name ?? null,
          has_schedule: p.schedule_json !== null && p.schedule_json !== "",
        };
      }),
    );
    const newSessionEntry: SnapshotSessionEntry = {
      session: {
        id: session.id,
        code: session.code,
        creator_chat_id: session.creator_chat_id,
        status: session.status,
        mode: session.mode,
        created_at: session.expires_at, // session row doesn't expose created_at via getSessionById; use expires_at as a stand-in
        expires_at: session.expires_at,
      },
      participants: builtParticipants,
      pendingInvites: [],
    };
    ctx.snapshot.activeSessions.unshift(newSessionEntry);

    await emitSessionEvent(sessionId, "invite_accepted", {
      caller_chat_id: ctx.callerChatId,
      transferred_schedule: linkedScheduleJson !== null,
      linked_person_note: linkedName,
    });

    return {
      ok: true,
      session_id: sessionId,
      inviter_name: inviterName,
      transferred_schedule: linkedScheduleJson !== null,
      transferred_shift_count: linkedScheduleJson ? (JSON.parse(linkedScheduleJson) as unknown[]).length : 0,
    };
  },
};

// --- Tool 4: remove_partner ---

const removePartnerTool: ToolDefinition = {
  name: "remove_partner",
  description: "Remove a partner from the current session by name. Returns ambiguous candidates on multi-match, not_found on no match.",
  input_schema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      session_id: { type: "string" },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return { error: "Missing name argument." };
    const explicitSessionId = typeof input.session_id === "string" ? input.session_id : undefined;
    const sessionEntry = resolveSession(ctx, explicitSessionId);
    if (!sessionEntry) return { error: "No active session to remove from." };

    const target = name.toLowerCase();
    const candidates = sessionEntry.participants
      .filter((p) => p.chat_id !== ctx.callerChatId && p.name)
      .filter((p) => p.name!.toLowerCase().includes(target));

    if (candidates.length === 0) {
      // Also check pending invites for name match — but pending invites
      // don't store names, only phone/deep-link scope. Drop the most recent
      // pending invite as a "best guess" only if the caller has exactly one.
      if (sessionEntry.pendingInvites.length === 1) {
        await query(
          "UPDATE pending_invites SET status = 'DECLINED' WHERE id = ?",
          [sessionEntry.pendingInvites[0].id],
        );
        sessionEntry.pendingInvites = [];
        return { removed: true, name, notes: "Removed the only pending invite (name couldn't be verified against invite row)." };
      }
      return { not_found: true, name };
    }

    // Exact match preferred
    const exact = candidates.find((p) => p.name!.toLowerCase() === target);
    const winner = exact ?? (candidates.length === 1 ? candidates[0] : null);
    if (!winner) {
      return {
        ambiguous: true,
        candidates: candidates.map((c) => ({ name: c.name, chat_id_suffix: c.chat_id.slice(-4) })),
      };
    }
    await query("DELETE FROM participants WHERE id = ?", [winner.id]);
    sessionEntry.participants = sessionEntry.participants.filter((p) => p.id !== winner.id);
    return { removed: true, name: winner.name, session_id: sessionEntry.session.id };
  },
};

// --- Tool 5: compute_and_deliver_match ---

const computeAndDeliverMatchTool: ToolDefinition = {
  name: "compute_and_deliver_match",
  description:
    "Find overlapping free time across everyone in the session (including on-behalf schedules). Returns all slots sorted longest-first plus the chosen best one. Sends .ics + Google Calendar event to every participant; other participants get a short text notification, the caller doesn't (avoids duplicating your reply tool). Session stays OPEN after delivery so follow-up questions still work. force_mediated=true uses only the caller's schedule and offers their free times to partners.",
  input_schema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      force_mediated: { type: "boolean" },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const explicitSessionId = typeof input.session_id === "string" ? input.session_id : undefined;
    const forceMediated = input.force_mediated === true;
    const sessionEntry = resolveSession(ctx, explicitSessionId);
    if (!sessionEntry) return { error: "No active session to compute against." };
    const sessionId = sessionEntry.session.id;
    const deliverOptions = {
      excludeTextForChatId: ctx.callerChatId,
      keepSessionOpen: true,
    };

    if (forceMediated) {
      const caller = sessionEntry.participants.find((p) => p.chat_id === ctx.callerChatId);
      if (!caller?.schedule_json) {
        return { error: "Can't run mediator mode — caller hasn't confirmed their own schedule yet." };
      }
      const slots = computeSinglePersonSlots(caller.schedule_json);
      if (slots.length === 0) {
        return { status: "no_slots_from_single_schedule" };
      }
      await persistComputedSlots(
        sessionId,
        slots.map((s) => ({ ...s, explanation: "caller-only availability" })),
      );
      await query("UPDATE sessions SET mode = 'MEDIATED' WHERE id = ?", [sessionId]);
      const result = await deliverMatchToSession(sessionId, deliverOptions);
      return {
        status: result.match ? "delivered_mediated" : (result.reason ?? "no_match"),
        match: result.match,
        all_slots: result.all_slots,
      };
    }

    // Non-mediated: pull schedules from participants + on-behalf person_notes
    const allParticipants = await getSessionParticipants(sessionId);
    const participantSchedules = allParticipants
      .filter((p) => p.schedule_json)
      .map((p) => ({ id: p.id, schedule_json: p.schedule_json }));

    // On-behalf schedules from the creator's person_notes
    const creator = allParticipants.find((p) => p.role === "creator");
    const onBehalfSchedules: Array<{ id: string; schedule_json: string | null }> = [];
    if (creator) {
      for (const note of ctx.snapshot.personNotes) {
        if (!note.schedule_json) continue;
        const alreadyParticipant =
          note.linked_chat_id && allParticipants.some((p) => p.chat_id === note.linked_chat_id);
        if (alreadyParticipant) continue;
        onBehalfSchedules.push({ id: `on-behalf:${note.id}`, schedule_json: note.schedule_json });
      }
    }

    const totalSchedules = participantSchedules.length + onBehalfSchedules.length;
    if (totalSchedules < 2) {
      return {
        status: "need_more_schedules",
        missing: Math.max(0, (allParticipants.length + sessionEntry.pendingInvites.length) - totalSchedules),
      };
    }

    const slots: ComputedFreeSlot[] = computeOverlaps([...participantSchedules, ...onBehalfSchedules]);
    if (slots.length === 0) {
      return { status: "no_overlap" };
    }
    await persistComputedSlots(sessionId, slots);
    const delivery = await deliverMatchToSession(sessionId, deliverOptions);
    return {
      status: delivery.match ? "delivered" : (delivery.reason ?? "no_match"),
      match: delivery.match,
      all_slots: delivery.all_slots,
      slot_count: slots.length,
    };
  },
};

// --- Tool 6: upsert_knowledge ---

const upsertKnowledgeTool: ToolDefinition = {
  name: "upsert_knowledge",
  description:
    "Persist knowledge across conversations. target='user' updates the caller's own profile (name, language, timezone, freeform fact). target='person' updates a person_notes row for a named third party (creates it if absent).",
  input_schema: {
    type: "object",
    required: ["target"],
    properties: {
      target: { type: "string", enum: ["user", "person"] },
      person_name: { type: "string", description: "Required when target='person'." },
      name: { type: "string", description: "User's display name — used when target='user'." },
      language: { type: "string", description: "ISO 639-1 code (en, it, fr, de, es, ...)." },
      timezone: { type: "string", description: "IANA timezone (e.g. Europe/Rome)." },
      phone: { type: "string" },
      fact: {
        type: "string",
        description: "Freeform note to append. 300-char cap per call.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const target = input.target;
    if (target !== "user" && target !== "person") {
      return { error: "target must be 'user' or 'person'." };
    }
    const fact = typeof input.fact === "string" ? input.fact.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const language = typeof input.language === "string" ? input.language.trim().toLowerCase() : "";
    const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";

    if (target === "user") {
      const actions: string[] = [];
      if (name) {
        await updateUserName(ctx.callerChatId, name);
        ctx.snapshot.user = { ...ctx.snapshot.user, name };
        actions.push(`name=${name}`);
      }
      if (language) {
        await updateUserLanguage(ctx.callerChatId, language);
        ctx.snapshot.user = { ...ctx.snapshot.user, preferred_language: language };
        actions.push(`language=${language}`);
      }
      if (timezone) {
        await updateUserTimezone(ctx.callerChatId, timezone);
        ctx.snapshot.user = { ...ctx.snapshot.user, timezone };
        ctx.snapshot.timezone = timezone;
        actions.push(`timezone=${timezone}`);
      }
      if (phone) {
        await updateUserPhone(ctx.callerChatId, phone);
        ctx.snapshot.user = { ...ctx.snapshot.user, phone };
        actions.push(`phone=${phone}`);
      }
      if (fact) {
        await appendUserContext(ctx.callerChatId, fact);
        actions.push(`fact="${fact.slice(0, 80)}"`);
      }
      if (actions.length === 0) return { error: "No fields provided to upsert." };
      return { saved: true, target: "user", applied: actions };
    }

    // target === "person"
    const personName = typeof input.person_name === "string" ? input.person_name.trim() : "";
    if (!personName) return { error: "person_name required when target='person'." };
    await upsertPersonNote(ctx.callerChatId, personName, {
      phone: phone || undefined,
      notes: fact || undefined,
    });
    return { saved: true, target: "person", person_name: personName };
  },
};

// --- Tool 7: session_action ---

const sessionActionTool: ToolDefinition = {
  name: "session_action",
  description:
    "Session lifecycle action. 'new' starts a fresh session (expires existing). 'cancel' marks the current session EXPIRED. 'reopen' flips the most-recent COMPLETED session back to OPEN preserving its schedules (for amend-after-delivered). 'reset_all' wipes ALL the caller's data — sessions, history, person_notes — so use it only when the user clearly asks to start completely over.",
  input_schema: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["new", "cancel", "reset_all", "reopen"] },
      session_id: { type: "string" },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const action = input.action;
    const explicitSessionId = typeof input.session_id === "string" ? input.session_id : undefined;

    if (action === "new") {
      // Expire any existing sessions the caller creates or participates in,
      // then create a fresh one.
      await query(
        "UPDATE sessions SET status = 'EXPIRED' WHERE creator_chat_id = ? AND status NOT IN ('EXPIRED','COMPLETED')",
        [ctx.callerChatId],
      );
      const sessionId = crypto.randomUUID();
      const code = crypto.randomUUID().slice(0, 6).toUpperCase();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await query(
        "INSERT INTO sessions (id, code, creator_chat_id, status, expires_at) VALUES (?, ?, ?, 'OPEN', ?)",
        [sessionId, code, ctx.callerChatId, expiresAt],
      );
      const creatorParticipantId = crypto.randomUUID();
      await query(
        "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'creator', 'ACTIVE')",
        [creatorParticipantId, sessionId, ctx.callerChatId],
      );
      await emitSessionEvent(sessionId, "session_created", { via: "session_action.new" });

      // CRITICAL: sync the in-turn snapshot. Without this, a subsequent
      // parse_schedule call in the same turn would still see the old
      // (now-expired) sessions in ctx.snapshot.activeSessions and try to
      // save into a stale participant row — schedule lands in an expired
      // session and disappears from loadSnapshot next turn. Live test
      // 2026-04-11 16:53-16:55 hit this exact bug.
      ctx.snapshot.activeSessions = [
        {
          session: {
            id: sessionId,
            code,
            creator_chat_id: ctx.callerChatId,
            status: "OPEN",
            mode: null,
            created_at: new Date().toISOString(),
            expires_at: expiresAt,
          },
          participants: [
            {
              id: creatorParticipantId,
              chat_id: ctx.callerChatId,
              role: "creator",
              state: "ACTIVE",
              schedule_json: null,
              preferred_slots: null,
              name: ctx.snapshot.user.name,
              has_schedule: false,
            },
          ],
          pendingInvites: [],
        },
      ];

      return { action: "new", session_id: sessionId };
    }

    if (action === "cancel") {
      const sessionEntry = resolveSession(ctx, explicitSessionId);
      if (!sessionEntry) return { error: "No active session to cancel." };
      await cancelSession(sessionEntry.session.id);
      // Remove from in-turn snapshot
      ctx.snapshot.activeSessions = ctx.snapshot.activeSessions.filter(
        (s) => s.session.id !== sessionEntry.session.id,
      );
      return { action: "cancelled", session_id: sessionEntry.session.id };
    }

    if (action === "reopen") {
      const reopenedId = await reopenLastCompletedSession(ctx.callerChatId);
      if (!reopenedId) return { error: "No completed session to reopen." };
      return { action: "reopened", session_id: reopenedId };
    }

    if (action === "reset_all") {
      // No code-side safety gate. The system prompt instructs you to ask
      // before calling this; ONE confirmation (a "yes" / a tapped Confirm
      // button / explicit user request) is enough. Don't loop back asking
      // again — that's the brittle pattern this rewrite was supposed to
      // eliminate.
      await resetUserData(ctx.callerChatId);
      await query("DELETE FROM conversation_log WHERE chat_id = ?", [ctx.callerChatId]);
      await query("DELETE FROM participants WHERE chat_id = ?", [ctx.callerChatId]);
      await query("DELETE FROM person_notes WHERE owner_chat_id = ?", [ctx.callerChatId]);
      await query("DELETE FROM users WHERE chat_id = ?", [ctx.callerChatId]);
      return { action: "reset", notes: "All caller data wiped successfully." };
    }

    return { error: `Unknown action: ${String(action)}` };
  },
};

// --- Tool 8: reply (terminal) ---

const replyTool: ToolDefinition = {
  name: "reply",
  description:
    "Send the user a reply. This is the terminal tool of your turn. Use text for a single message, messages[] for multiple messages in order, or buttons[] for one-tap yes/no replies (buttons attach to the last message).",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "A single reply message." },
      messages: {
        type: "array",
        items: { type: "string" },
        description: "Multiple messages to send in order. Use instead of `text` when you need more than one bubble.",
      },
      buttons: {
        type: "array",
        description: "Inline keyboard buttons to attach to the last message.",
        items: {
          type: "object",
          required: ["text", "callback"],
          properties: {
            text: { type: "string" },
            callback: { type: "string", enum: ["confirm", "reject", "yes", "no"] },
          },
        },
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const messages: string[] = [];
    if (Array.isArray(input.messages)) {
      for (const m of input.messages) if (typeof m === "string" && m.trim()) messages.push(m);
    }
    if (typeof input.text === "string" && input.text.trim()) {
      messages.push(input.text);
    }
    if (messages.length === 0) {
      return { error: "reply requires non-empty text or messages." };
    }
    const buttons: ReplyButton[] | undefined = Array.isArray(input.buttons)
      ? (input.buttons.filter(
          (b): b is ReplyButton =>
            !!b &&
            typeof b === "object" &&
            typeof (b as ReplyButton).text === "string" &&
            ["confirm", "reject", "yes", "no"].includes((b as ReplyButton).callback),
        ) as ReplyButton[])
      : undefined;
    ctx.pendingReply = { messages, buttons: buttons && buttons.length > 0 ? buttons : undefined };
    ctx.replySent = true;
    return { queued: true, message_count: messages.length };
  },
};

// --- Dispatcher ---

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  parseScheduleTool,
  addOrInvitePartnerTool,
  acceptInviteTool,
  removePartnerTool,
  computeAndDeliverMatchTool,
  upsertKnowledgeTool,
  sessionActionTool,
  replyTool,
];

/** JSON tool schemas in the shape Anthropic's messages API expects. */
export const TOOL_SCHEMAS = TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

/** Look up and execute a tool by name. Returns the structured result the turn handler
 *  serialises into a tool_result block for Claude. Unknown tools return an error. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Tool '${name}' threw: ${msg}` };
  }
}
