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
  type Snapshot,
  type SnapshotSessionEntry,
} from "./d1-client.js";
import {
  extractSchedule,
  mapMimeType,
  type ExtractScheduleResult,
} from "./schedule-parser.js";
import {
  computeOverlaps,
  persistComputedSlots,
  computeSinglePersonSlots,
  type ComputedFreeSlot,
} from "./match-compute.js";
import { deliverMatchToSession } from "./deliver-results.js";

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
  /** Set by parse_schedule so save_schedule can commit without the model echoing shifts. */
  lastParsedShifts?: ExtractScheduleResult["shifts"];
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

// --- Tool 1: parse_schedule ---

const parseScheduleTool: ToolDefinition = {
  name: "parse_schedule",
  description:
    "Extract structured shifts from whatever the user provided this turn: a photo of a rota, a PDF, typed hours, a voice-note transcript, a screenshot of Excel, a paragraph of natural language, anything that describes when someone is busy or free. If the current turn has an attached image/PDF and the user didn't retype their hours, omit text_content to use the attached media. If the user typed their hours as text, pass the text in text_content. Use attributed_to_name ONLY when the schedule is for someone OTHER than the user (e.g. 'here's Diego's rota'). Returns the parsed shifts — you can then show them to the user, or save them directly via save_schedule.",
  input_schema: {
    type: "object",
    properties: {
      text_content: {
        type: "string",
        description:
          "Typed hours or text description of availability. Omit to parse the current turn's attached media instead.",
      },
      attributed_to_name: {
        type: "string",
        description:
          "Name of the third party this schedule is for, if it's not the user's own schedule. Drives the parser to filter multi-person rotas to that person's row.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const textContent = typeof input.text_content === "string" ? input.text_content : undefined;
    const attributedToName = typeof input.attributed_to_name === "string" ? input.attributed_to_name : undefined;

    try {
      let result: ExtractScheduleResult;
      if (textContent) {
        result = await extractSchedule({
          text: textContent,
          userName: ctx.snapshot.user.name ?? undefined,
          timezone: ctx.snapshot.timezone,
          attributedToName,
        });
      } else if (ctx.cachedMedia) {
        result = await extractSchedule({
          media: ctx.cachedMedia,
          userName: ctx.snapshot.user.name ?? undefined,
          timezone: ctx.snapshot.timezone,
          attributedToName,
        });
      } else {
        return {
          error:
            "No media attached to this turn and no text_content provided. Ask the user to send their schedule or type their hours.",
        };
      }

      // Cache for save_schedule
      ctx.lastParsedShifts = result.shifts;

      return {
        shifts: result.shifts,
        shift_count: result.shifts.length,
        attributed_to: attributedToName ?? "caller",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Structured error for unsupported file types — Claude sees the
      // UNSUPPORTED_DOCUMENT / UNSUPPORTED_MEDIA prefix and relays a
      // useful reply to the user.
      return { error: msg };
    }
  },
};

// --- Tool 2: save_schedule ---

const saveScheduleTool: ToolDefinition = {
  name: "save_schedule",
  description:
    "Commit the shifts from your most recent parse_schedule call to a target. MUST be called after parse_schedule and before your terminal reply, unless the user explicitly said not to save. `owner='me'` saves to the caller's own participant row. `owner='person:Diego'` (note the `person:` prefix) saves to the caller's person_notes row for that name — creates the row if absent, use this for on-behalf uploads. Pass session_id to disambiguate when the caller has multiple active sessions.",
  input_schema: {
    type: "object",
    required: ["owner"],
    properties: {
      owner: {
        type: "string",
        description: "'me' for the caller, or 'person:<name>' for an on-behalf upload (e.g. 'person:Diego').",
      },
      session_id: {
        type: "string",
        description: "Session to save to. Defaults to the caller's most recent active session.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const owner = typeof input.owner === "string" ? input.owner.trim() : "";
    const explicitSessionId = typeof input.session_id === "string" ? input.session_id : undefined;

    if (!ctx.lastParsedShifts) {
      return { error: "No parsed shifts available. Call parse_schedule first, then save_schedule." };
    }
    if (!owner) {
      return { error: "Missing owner argument. Pass 'me' or 'person:<name>'." };
    }

    const scheduleJson = JSON.stringify(ctx.lastParsedShifts);

    // On-behalf path: save to person_notes
    if (owner.startsWith("person:")) {
      const personName = owner.slice("person:".length).trim();
      if (!personName) {
        return { error: "Missing person name after 'person:'. Example: owner='person:Diego'." };
      }
      // Ensure the row exists, then write the schedule.
      await upsertPersonNote(ctx.callerChatId, personName);
      await setPersonNoteSchedule(ctx.callerChatId, personName, scheduleJson);
      return {
        saved: true,
        owner_resolved_to: `person_note:${personName}`,
        shift_count: ctx.lastParsedShifts.length,
      };
    }

    // Self path: save to the caller's own participant row in the target session
    if (owner === "me") {
      const sessionEntry = resolveSession(ctx, explicitSessionId);
      if (!sessionEntry) {
        return {
          error:
            "No active session — can't save the caller's own schedule without one. Call session_action(action='new') first, or save this as a person_note instead.",
        };
      }
      const myParticipant = sessionEntry.participants.find((p) => p.chat_id === ctx.callerChatId);
      if (!myParticipant) {
        return {
          error: `Caller is not a participant in session ${sessionEntry.session.id}. This shouldn't happen — investigate.`,
        };
      }
      await saveParticipantSchedule(myParticipant.id, scheduleJson);
      return {
        saved: true,
        owner_resolved_to: `participant:${ctx.callerChatId}`,
        session_id: sessionEntry.session.id,
        shift_count: ctx.lastParsedShifts.length,
      };
    }

    return {
      error: `Unknown owner format: '${owner}'. Use 'me' or 'person:<name>'.`,
    };
  },
};

// --- Tool 3: add_or_invite_partner ---

const addOrInvitePartnerTool: ToolDefinition = {
  name: "add_or_invite_partner",
  description:
    "Add someone to the current session. Provide either a name or a phone number (or both). If the person is a known bot user, they're added as a participant directly. If not, a pending invite is created and the deep-link URL is returned for you to share with the caller. For ambiguous name matches (multiple bot users with the same name), returns candidates for the caller to disambiguate.",
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

// --- Tool 4: remove_partner ---

const removePartnerTool: ToolDefinition = {
  name: "remove_partner",
  description:
    "Remove a partner from the current session by name. Handles real participants and pending invites. Returns {ambiguous: true, candidates} if the name matches multiple people in the session, or {not_found: true} if no match.",
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
    "Compute overlapping free time across all participants (including any on-behalf schedules from person_notes) and deliver the best slot to everyone via Telegram + .ics + Google Calendar. Use when the user explicitly asks 'when are we all free?' OR when they confirm they're ready to finalise. Set force_mediated=true to switch to mediator mode: the caller has a schedule, partners pick from the caller's free slots without uploading their own — use this when the user says 'just send them my free times'.",
  input_schema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      force_mediated: {
        type: "boolean",
        description: "If true, use the caller's schedule as the only source and send their free slots to partners without requiring partner uploads.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const explicitSessionId = typeof input.session_id === "string" ? input.session_id : undefined;
    const forceMediated = input.force_mediated === true;
    const sessionEntry = resolveSession(ctx, explicitSessionId);
    if (!sessionEntry) return { error: "No active session to compute against." };
    const sessionId = sessionEntry.session.id;

    if (forceMediated) {
      // Mediator mode: compute free slots from the caller's schedule only,
      // write to free_slots, and deliver to all other participants as
      // "pick a time" options.
      const caller = sessionEntry.participants.find((p) => p.chat_id === ctx.callerChatId);
      if (!caller?.schedule_json) {
        return { error: "Can't run mediator mode — caller hasn't confirmed their own schedule yet." };
      }
      const slots = computeSinglePersonSlots(caller.schedule_json);
      if (slots.length === 0) {
        return { status: "no_slots_from_single_schedule" };
      }
      // Persist + mark session as mediated + deliver
      await persistComputedSlots(
        sessionId,
        slots.map((s) => ({ ...s, explanation: "caller-only availability" })),
      );
      await query("UPDATE sessions SET mode = 'MEDIATED' WHERE id = ?", [sessionId]);
      const result = await deliverMatchToSession(sessionId);
      return {
        status: result.match ? "delivered_mediated" : (result.reason ?? "no_match"),
        match: result.match,
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
    const delivery = await deliverMatchToSession(sessionId);
    return {
      status: delivery.match ? "delivered" : (delivery.reason ?? "no_match"),
      match: delivery.match,
      slot_count: slots.length,
    };
  },
};

// --- Tool 6: upsert_knowledge ---

const upsertKnowledgeTool: ToolDefinition = {
  name: "upsert_knowledge",
  description:
    "Remember something for future conversations. target='user' saves to the caller's own profile (name, language, timezone, or freeform fact). target='person' saves to a named third party's person_notes row (creates the row if absent). Use this whenever you learn something worth persisting: the user's name, preferred language, timezone, accumulated facts about themselves, or facts about other people they've mentioned.",
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
    "Take an action on the caller's session. 'new' starts a fresh session (expires any existing one). 'cancel' marks the current session EXPIRED and notifies other participants. 'reset_all' wipes ALL the caller's data (sessions, conversation history, person_notes) — you MUST confirm with the user before calling this, and only call it after they explicitly say 'yes, wipe everything'. 'reopen' flips the most-recent COMPLETED session back to OPEN for amend-after-delivered — preserves existing schedules so the user only sends the delta.",
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
      // Expire any existing sessions the caller creates or participates in, then create a fresh one
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
      await query(
        "INSERT INTO participants (id, session_id, chat_id, role, state) VALUES (?, ?, ?, 'creator', 'ACTIVE')",
        [crypto.randomUUID(), sessionId, ctx.callerChatId],
      );
      await emitSessionEvent(sessionId, "session_created", { via: "session_action.new" });
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
      // Safety gate: refuse unless the prior bot message asked for confirmation.
      // We look for either a question mark + the word "sure" or an explicit
      // [CONFIRM_RESET] marker the handler injects. Belt and braces — Claude
      // is ALSO instructed via system prompt to ask first, but we don't trust
      // prompt instructions alone for destructive actions.
      const recentBot = ctx.snapshot.recentHistory.filter((m) => m.role === "bot").slice(-2);
      const asked = recentBot.some(
        (m) =>
          m.message.includes("[CONFIRM_RESET]") ||
          (/\bsure\b/i.test(m.message) && m.message.includes("?")),
      );
      if (!asked) {
        return {
          error:
            "SAFETY_GATE: reset_all refused — you must ask the user to confirm first. Reply asking 'are you sure? this will wipe everything.' and wait for their yes, then call reset_all again.",
        };
      }
      await resetUserData(ctx.callerChatId);
      await query("DELETE FROM conversation_log WHERE chat_id = ?", [ctx.callerChatId]);
      await query("DELETE FROM participants WHERE chat_id = ?", [ctx.callerChatId]);
      await query("DELETE FROM person_notes WHERE owner_chat_id = ?", [ctx.callerChatId]);
      await query("DELETE FROM users WHERE chat_id = ?", [ctx.callerChatId]);
      return { action: "reset", notes: "All caller data wiped." };
    }

    return { error: `Unknown action: ${String(action)}` };
  },
};

// --- Tool 8: reply (terminal) ---

const replyTool: ToolDefinition = {
  name: "reply",
  description:
    "Send the user a reply. This is ALWAYS the LAST tool call of your turn. Use `text` for a single message. Use `messages` for 2+ separate messages in order (e.g. acknowledgment + invite link). Use `buttons` when a yes/no confirmation would make the user's response one-tap — buttons attach to the last message only.",
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
  saveScheduleTool,
  addOrInvitePartnerTool,
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
