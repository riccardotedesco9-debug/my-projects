// Turn-handler tools — the Anthropic tools the turn-handler exposes to
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
  setPersonNoteHidden,
  getLatestScheduleForUser,
  updateUserLatestSchedule,
  appendBusyBlockToUser,
  removeBusyBlockFromUser,
  findChatIdsByEmails,
  createScheduleWatch,
  listWatchesForTarget,
  deleteScheduleWatch,
  createReminder,
  listUserReminders,
  cancelReminder,
  localIsoToUtcEpoch,
  type ReminderRecurrence,
  emitSessionEvent,
  getUser,
  linkPersonNoteToChat,
  type Snapshot,
} from "./d1-client.js";
import {
  extractSchedule,
  classifyMime,
  mapMimeType,
  arrayBufferToBase64,
  bufferToText,
  spreadsheetToText,
  type ExtractScheduleResult,
} from "./schedule-parser.js";
import {
  computeOverlaps,
  computeSinglePersonSlots,
  type ComputedFreeSlot,
} from "./match-compute.js";
import { downloadMedia, sendTextMessage } from "./telegram-client.js";
import {
  createCalendarEvent,
  listCalendarEventsInWindow,
  findCalendarEventsOnDate,
  deleteCalendarEvent,
} from "./google-calendar.js";

// --- Types ---

export interface ReplyButton {
  text: string;
  callback: "confirm" | "reject" | "yes" | "no" | "new_session";
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
 * Caller's timezone, with a single fallback chain used by all time-sensitive
 * tools (schedule_reminder, list_reminders, …). Snapshot-level tz is the
 * authoritative value; user-level is a secondary source; Europe/Malta is the
 * product default. Having one helper keeps behavior consistent across tools.
 */
function resolveCallerTimezone(ctx: ToolContext): string {
  return ctx.snapshot.timezone || ctx.snapshot.user.timezone || "Europe/Malta";
}

/** Minutes since midnight from "HH:MM". */
function timeToMinutes(hm: string): number {
  const m = hm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Inverse of timeToMinutes. */
function minutesToTime(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * All busy windows for a user on a specific date, pulled from both their
 * stored schedule_json (shifts + hectic days) and their live Google
 * Calendar (if connected). Returned as [start,end) minute-ranges within
 * the day (0-1440). Used by book_meetup's conflict check.
 */
async function gatherBusyBlocksForDate(
  chatId: string,
  date: string,
  timezone: string,
): Promise<Array<{ start: number; end: number; label: string }>> {
  const blocks: Array<{ start: number; end: number; label: string }> = [];
  const prevDate = shiftDateISO(date, -1);
  const pushShiftBlock = (
    s: { date: string; start_time: string; end_time: string; label?: string },
  ): void => {
    // OFF marker — informational only ("off from work / main commitment"),
    // NOT a hard block on availability. Skip this entry but keep processing
    // the rest of the array — other entries on the same date (e.g. gym
    // 18:00–19:00 on an off day) are real blocks and still get pushed below.
    // Do not "fix" this skip without re-reading the encoding rules in
    // turn-handler.ts buildSystemPrompt.
    if (s.start_time === "00:00" && s.end_time === "00:00") return;
    const start = timeToMinutes(s.start_time);
    const end = timeToMinutes(s.end_time);
    const label = s.label ?? "busy";
    const isOvernight = end < start;
    if (!isOvernight && s.date === date) {
      blocks.push({ start, end, label });
      return;
    }
    if (isOvernight) {
      // Overnight shift (e.g. 22:00–06:00): fills target-date from
      // `start` to midnight, AND spills into the next day from 00:00 to
      // `end`. For our target `date`, include BOTH directions: any
      // shift that starts on `date` (fills 22→24), OR any shift on
      // prevDate that spills into `date` (fills 00→06).
      if (s.date === date) {
        blocks.push({ start, end: 24 * 60, label });
      } else if (s.date === prevDate) {
        blocks.push({ start: 0, end, label });
      }
    }
  };

  const sched = await getLatestScheduleForUser(chatId);
  if (sched) {
    try {
      const parsed = JSON.parse(sched) as Array<{
        date: string;
        start_time: string;
        end_time: string;
        label?: string;
      }>;
      for (const s of parsed) pushShiftBlock(s);
    } catch {
      // corrupt schedule — skip
    }
  }
  try {
    // Pull calendar events for yesterday+today so overnight calendar
    // events that end on `date` also count as busy.
    const events = await listCalendarEventsInWindow(chatId, prevDate, date, timezone);
    for (const e of events) pushShiftBlock(e);
  } catch {
    // calendar read is best-effort
  }
  return blocks;
}

/** Return `date` shifted by `days` (positive or negative) as YYYY-MM-DD. */
function shiftDateISO(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Notify each owner whose shadow-tracked contact just got linked to a newly-
 * known chat_id. Sends a Telegram message per owner in the owner's language,
 * mentioning whether the contact already has a schedule on file. Best-effort.
 */
async function notifyShadowLinkResolutions(
  resolved: Array<{ owner_chat_id: string; name: string }>,
  linkedChatId: string,
): Promise<void> {
  if (resolved.length === 0) return;
  const linkedUser = await getUser(linkedChatId);
  const hasSchedule = !!linkedUser?.latest_schedule_json;
  for (const row of resolved) {
    try {
      const owner = await getUser(row.owner_chat_id);
      const lang = owner?.preferred_language ?? "en";
      const schedLine = hasSchedule
        ? (lang === "it" ? " Hanno già condiviso il loro orario, quindi posso trovare una sovrapposizione quando vuoi."
          : lang === "es" ? " Ya han compartido su horario, así que puedo encontrar un solapamiento cuando quieras."
          : lang === "fr" ? " Ils ont déjà partagé leur emploi du temps, je peux trouver un créneau commun quand tu veux."
          : lang === "de" ? " Sie haben ihren Zeitplan schon geteilt — ich kann Überschneidungen jederzeit finden."
          : " They've already shared their schedule, so I can find an overlap whenever you're ready.")
        : "";
      const msg =
        lang === "it" ? `🔗 ${row.name} si è appena unito al bot e ora è collegato ai tuoi contatti.${schedLine}`
        : lang === "es" ? `🔗 ${row.name} acaba de unirse al bot y ahora está vinculado a tus contactos.${schedLine}`
        : lang === "fr" ? `🔗 ${row.name} vient de rejoindre le bot et est maintenant lié à tes contacts.${schedLine}`
        : lang === "de" ? `🔗 ${row.name} ist dem Bot gerade beigetreten und jetzt mit deinen Kontakten verknüpft.${schedLine}`
        : `🔗 ${row.name} just joined the bot and is now linked in your contacts.${schedLine}`;
      await sendTextMessage(row.owner_chat_id, msg);
    } catch (err) {
      console.warn(`[shadow-link notify] failed for owner ${row.owner_chat_id}:`, err);
    }
  }
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
    "Extract and save shifts from a schedule. Input modes (priority order): (1) shifts — structured array you extracted yourself (fastest, most reliable); (2) text_content — typed input; (3) media_id — Telegram file_id referenced from a previous turn's '[photo uploaded · file_id=...]' entry; (4) omit all — uses the current turn's attached media. attributed_to_name routes the shifts to a named contact; omit it to save to the caller. For multi-person CSVs: one call per person, attributed_to_name for everyone except the caller. Don't call this on voice messages — they arrive pre-transcribed as text; use 'shifts' or 'text_content'.",
  input_schema: {
    type: "object",
    properties: {
      shifts: {
        type: "array",
        description: "Pre-extracted shifts to save directly. Use this when you can already see the schedule in an attached file or in the user's text — skips the parser entirely. Each shift: {date: 'YYYY-MM-DD', start_time: 'HH:MM', end_time: 'HH:MM', label?: string}. Use 24-hour times. For days off, use start='00:00' end='00:00' with label='off' (canonical — always this exact string). If a day is off but has a brief activity (e.g. 'Mon off, gym 6–7pm'), emit BOTH entries on the same date: the OFF marker AND the partial-busy entry. Don't drop one — both together preserve 'off from work, but gym blocks 18:00–19:00'.",
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
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const directShifts = Array.isArray(input.shifts) ? (input.shifts as Array<Record<string, unknown>>) : undefined;
    const textContent = typeof input.text_content === "string" ? input.text_content : undefined;
    const explicitMediaId = typeof input.media_id === "string" ? input.media_id.trim() : "";
    const explicitMimeType = typeof input.mime_type === "string" ? input.mime_type : undefined;
    const attributedToName = typeof input.attributed_to_name === "string" ? input.attributed_to_name.trim() : "";

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
        return await persistShifts(ctx, fakeResult, attributedToName, "direct");
      }

      // 1. Resolve media: explicit media_id (download from Telegram) wins,
      //    then current-turn cachedMedia, then text_content as a last resort.
      //    The explicit media_id path is what lets the bot recover the user's
      //    "I already sent it" reference — Claude reads the file_id from
      //    conversation history and passes it here.
      let resolvedMedia: { base64: string; mediaType: string } | undefined;
      let resolvedText: string | undefined;
      if (explicitMediaId) {
        try {
          const { buffer, mimeType: detectedMime } = await downloadMedia(explicitMediaId);
          const mime = explicitMimeType ?? detectedMime ?? "image/jpeg";
          const category = classifyMime(mime);
          if (category === "vision") {
            const mediaType = mapMimeType(mime);
            resolvedMedia = { base64: arrayBufferToBase64(buffer), mediaType };
          } else if (category === "text") {
            resolvedText = bufferToText(buffer);
          } else if (category === "spreadsheet") {
            resolvedText = spreadsheetToText(buffer);
          } else {
            return { ok: false, error: `Unsupported file type: ${mime}. Ask the user to send as image, PDF, CSV, Excel, or plain text.` };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("audio/") || (explicitMimeType && explicitMimeType.startsWith("audio/"))) {
            return {
              ok: false,
              error: "This is a voice/audio file, not a schedule image. The voice note was already transcribed to text — read the transcription in the user's message and either extract shifts directly (pass them in the 'shifts' array) or pass the text via 'text_content'.",
            };
          }
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

      // Person-specific context feeds company-specific parse hints (e.g.
      // "brown cells = office, white = remote" for the caller, or fixed-
      // location notes like "Diego bartends at Hugo's so every shift is
      // on-site"). For self-uploads pull from users.context; for
      // attributed_to uploads pull from the target contact's person_notes.
      let personContext: string | null = null;
      if (attributedToName) {
        const note = ctx.snapshot.personNotes.find(
          (n) => n.name.toLowerCase() === attributedToName.toLowerCase(),
        );
        personContext = note?.notes ?? null;
      } else {
        personContext = ctx.snapshot.user.context ?? null;
      }

      let result: ExtractScheduleResult;
      const effectiveText = textContent || resolvedText;
      if (effectiveText) {
        result = await extractSchedule({
          text: effectiveText,
          userName: ctx.snapshot.user.name ?? undefined,
          timezone: ctx.snapshot.timezone,
          attributedToName: attributedToName || undefined,
          personContext,
        });
      } else if (resolvedMedia) {
        result = await extractSchedule({
          media: resolvedMedia,
          userName: ctx.snapshot.user.name ?? undefined,
          timezone: ctx.snapshot.timezone,
          attributedToName: attributedToName || undefined,
          personContext,
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

      return await persistShifts(ctx, result, attributedToName, textContent ? "text" : "media");
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
 * Per-date merge: union prior shifts with newly-parsed ones, replacing
 * only the dates the new parse covers. Rationale: rotas come in piecemeal
 * (week 1 today, week 2 next week). A REPLACE-everything strategy silently
 * loses earlier weeks the moment the user uploads a partial follow-up —
 * which was the bug behind the recurring "schedule got mixed up" reports.
 *
 * Semantics: any date present in `newShifts` has its existing entries
 * dropped and is fully owned by `newShifts`. Dates NOT present in
 * `newShifts` keep their existing entries verbatim. So a re-upload of
 * Wed (with changes) updates Wed only; Mon/Tue/Thu/Fri stay put.
 */
function mergeShiftsByDate<T extends { date: string }>(
  existingJson: string | null,
  newShifts: T[],
): T[] {
  let existing: T[] = [];
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (Array.isArray(parsed)) existing = parsed as T[];
    } catch {
      // Corrupt blob — treat as empty rather than crash. Better surfaced
      // by the [persistShifts] log line below than by a 500.
      console.warn("[persistShifts] existing schedule_json was unparseable — treating as empty");
    }
  }
  const coveredDates = new Set(newShifts.map((s) => s.date));
  const kept = existing.filter((s) => !coveredDates.has(s.date));
  return [...kept, ...newShifts];
}

/**
 * Save extracted shifts to the right target (person_note or self) and
 * sync the in-turn snapshot. Used by both the parser path and the
 * direct-shifts escape hatch.
 *
 * Merge behaviour: per-date replace, NOT total replace. See
 * mergeShiftsByDate above for the rationale.
 */
async function persistShifts(
  ctx: ToolContext,
  result: ExtractScheduleResult,
  attributedToName: string,
  source: "direct" | "text" | "media",
): Promise<ToolResult> {
  // Drop exact-duplicate (date, start, end, label) tuples WITHIN the new
  // parse first — the parser occasionally emits the same entry twice on
  // multi-page PDFs / overlapping recurring expansions. Then merge per-
  // date with whatever's already on file. The merge guarantees each date
  // is "owned" by the most recent upload, so re-uploading Wed updates
  // Wed without disturbing Mon/Tue.
  const seen = new Set<string>();
  const dedupedNew = result.shifts.filter((s) => {
    const key = `${s.date}|${s.start_time}|${s.end_time}|${s.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const droppedDuplicates = result.shifts.length - dedupedNew.length;
  if (droppedDuplicates > 0) {
    console.log(`[persistShifts] dropped ${droppedDuplicates} exact-duplicate entries from ${attributedToName || "self"}`);
  }

  // Pick the existing-blob source for this target (self vs on-behalf)
  // and run the per-date merge. We use the snapshot's view of the blob
  // — it was loaded at turn start and is the same row we're about to
  // write back to, so no extra D1 read is needed.
  const existingJson = attributedToName
    ? ctx.snapshot.personNotes.find(
        (n) => n.name.toLowerCase() === attributedToName.toLowerCase(),
      )?.schedule_json ?? null
    : ctx.snapshot.user.latest_schedule_json ?? null;
  const merged = mergeShiftsByDate(existingJson, dedupedNew);
  const newDateCount = new Set(dedupedNew.map((s) => s.date)).size;
  const totalDateCount = new Set(merged.map((s) => s.date)).size;
  const keptDateCount = totalDateCount - newDateCount;
  console.log(
    `[persistShifts] merged for ${attributedToName || "self"}: ${dedupedNew.length} new shifts on ${newDateCount} dates, kept ${keptDateCount} pre-existing dates, total ${merged.length} shifts on ${totalDateCount} dates`,
  );
  const scheduleJson = JSON.stringify(merged);
  result = { shifts: merged };

  // On-behalf path → person_notes.schedule_json
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
        hidden: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    await emitSessionEvent("no-session", "parse_schedule_saved", {
      chat_id: ctx.callerChatId,
      source,
      target: `person_note:${attributedToName}`,
      shift_count: result.shifts.length,
      new_dates: newDateCount,
      kept_dates: keptDateCount,
    });
    return {
      saved: true,
      saved_to: `person_note:${attributedToName}`,
      shift_count: result.shifts.length,
      shifts: result.shifts,
    };
  }

  // Self path → users.latest_schedule_json (shared-hub model, migration 0018).
  // Schedule lives on the user row and follows them across any context.
  await updateUserLatestSchedule(ctx.callerChatId, scheduleJson);
  ctx.snapshot.user = { ...ctx.snapshot.user, latest_schedule_json: scheduleJson };
  await emitSessionEvent("no-session", "parse_schedule_saved", {
    chat_id: ctx.callerChatId,
    source,
    target: `user:${ctx.callerChatId}`,
    shift_count: result.shifts.length,
    new_dates: newDateCount,
    kept_dates: keptDateCount,
  });

  // Fire any outstanding watchers — callers who asked the bot to let them
  // know once this user uploaded. Best-effort: a failure to message one
  // watcher doesn't block the save or other watchers.
  const watchers = await listWatchesForTarget(ctx.callerChatId);
  const firedWatchers: string[] = [];
  const callerName = ctx.snapshot.user.name ?? "Your contact";
  for (const w of watchers) {
    try {
      await sendTextMessage(
        w.watcher_chat_id,
        `📬 Heads up — ${callerName} just uploaded their schedule. Want me to find a time that works for you both?`,
      );
      await deleteScheduleWatch(w.id);
      firedWatchers.push(w.watcher_chat_id);
    } catch (err) {
      console.warn(`[parse_schedule] watcher notify failed for ${w.watcher_chat_id}:`, err);
    }
  }

  return {
    saved: true,
    saved_to: `user:${ctx.callerChatId}`,
    shift_count: result.shifts.length,
    shifts: result.shifts,
    watchers_notified: firedWatchers.length,
  };
}

// --- Tool 3: add_or_invite_partner ---

const addOrInvitePartnerTool: ToolDefinition = {
  name: "add_contact",
  description:
    "Add someone to the caller's contact list. Canonical tool for 'I want to plan with X' / 'add Jojo' / 'here's Patrick, his number is 9968…'. Phone is OPTIONAL — most contacts don't use Telegram and that's fine. Outcomes: (1) name matches a bot user → link directly, caller sees their schedule. (2) phone given and matches a bot user → link directly + capture phone on their user row. (3) unknown name + no phone → create contact anyway (contact_created=true). You can save their schedule immediately. (4) unknown name + unknown phone → SILENTLY shadow-track (save person_note with name+phone, no link yet). The moment that phone ever joins the bot, the link resolves automatically. Don't offer invite links. Never gatekeep on phone — just create the contact and move on to saving their schedule.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      phone: { type: "string" },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    // Preserve the leading + so E.164 numbers ("+35699112233") still match
    // users.phone (stored in E.164). Strip spaces, dashes, parens, letters.
    const phone = typeof input.phone === "string" ? input.phone.replace(/[^0-9+]/g, "") : "";

    if (!name && !phone) {
      return { error: "Provide either name or phone." };
    }

    // Helper: link contact to a known bot user — creates/updates person_note
    // and the in-turn snapshot so subsequent tools see them. Returns the tool
    // result. No session writes anywhere.
    const linkContact = async (
      contactChatId: string,
      contactName: string | null,
      phoneToCapture: string | null,
    ): Promise<ToolResult> => {
      const displayName = (name || contactName || "").trim();
      if (!displayName) return { error: "No name available to label this contact." };
      await upsertPersonNote(
        ctx.callerChatId,
        displayName,
        phoneToCapture ? { phone: phoneToCapture } : {},
      );
      await linkPersonNoteToChat(ctx.callerChatId, displayName, contactChatId);
      // Sync the caller's in-turn snapshot so compute_overlap and the snapshot
      // formatter both see this contact immediately, with their latest schedule.
      const contactSchedule = await getLatestScheduleForUser(contactChatId);
      const existing = ctx.snapshot.personNotes.find(
        (n) => n.name_normalized === displayName.trim().toLowerCase(),
      );
      if (existing) {
        existing.linked_chat_id = contactChatId;
        if (phoneToCapture) existing.phone = phoneToCapture;
        if (contactSchedule && !existing.schedule_json) existing.schedule_json = contactSchedule;
      } else {
        ctx.snapshot.personNotes.push({
          id: 0,
          owner_chat_id: ctx.callerChatId,
          name: displayName,
          name_normalized: displayName.trim().toLowerCase(),
          phone: phoneToCapture,
          linked_chat_id: contactChatId,
          schedule_json: contactSchedule,
          notes: null,
          hidden: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return {
        linked: true,
        contact_name: displayName,
        contact_chat_id: contactChatId,
        schedule_present: !!contactSchedule,
      };
    };

    // Phone lookup takes priority when present.
    if (phone) {
      const existing = await findUserByPhone(phone);
      if (existing && existing.chat_id !== ctx.callerChatId) {
        if (!existing.phone) {
          const resolved = await updateUserPhone(existing.chat_id, phone);
          await notifyShadowLinkResolutions(resolved, existing.chat_id);
        }
        return await linkContact(existing.chat_id, existing.name ?? null, phone);
      }
      if (existing && existing.chat_id === ctx.callerChatId) {
        return { error: "That's the caller's own phone number — can't add themselves." };
      }
      // Phone didn't match. If a name was also given, try name lookup.
      if (name) {
        const byName = (await findUserByName(name)).filter((u) => u.chat_id !== ctx.callerChatId);
        if (byName.length === 1) {
          const u = byName[0];
          if (!u.phone) {
            const resolved = await updateUserPhone(u.chat_id, phone);
            await notifyShadowLinkResolutions(resolved, u.chat_id);
          }
          return await linkContact(u.chat_id, u.name ?? null, phone);
        }
        if (byName.length > 1) {
          return {
            ambiguous: true,
            candidates: byName.map((m) => ({
              name: m.name,
              phone_last_4: m.phone ? m.phone.slice(-4) : null,
            })),
            notes: "Multiple bot users match this name — the phone didn't match any of them. Ask the caller to clarify which one.",
          };
        }
      }
      // Unknown phone → shadow-track the contact silently. The moment that
      // phone ever joins the bot (via their own /start flow or a contact
      // share), updateUserPhone → linkShadowedPersonNotesByPhone resolves
      // the link without any further action here. No invite URL, no
      // pending_invite row — just a recorded name+phone. This matches the
      // product's shared-hub model: track everything, reveal on match.
      const labelName = name || `+${phone}`;
      await upsertPersonNote(ctx.callerChatId, labelName, { phone });
      // Sync caller's in-turn snapshot so the next tool sees this contact.
      const norm = labelName.trim().toLowerCase();
      const existingShadow = ctx.snapshot.personNotes.find((n) => n.name_normalized === norm);
      if (!existingShadow) {
        ctx.snapshot.personNotes.push({
          id: 0,
          owner_chat_id: ctx.callerChatId,
          name: labelName,
          name_normalized: norm,
          phone,
          linked_chat_id: null,
          schedule_json: null,
          notes: null,
          hidden: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return {
        shadow_tracked: true,
        contact_name: labelName,
        phone,
        notes: "Saved silently. They're not on the bot yet — the moment this number joins, the link fires automatically. Don't offer an invite link.",
      };
    }

    // Name-only lookup.
    // 1. Caller's own person_notes — already linked?
    const existingNote = await findPersonNote(ctx.callerChatId, name);
    if (existingNote?.linked_chat_id && existingNote.linked_chat_id !== ctx.callerChatId) {
      return {
        already_linked: true,
        contact_name: existingNote.name,
        contact_chat_id: existingNote.linked_chat_id,
      };
    }
    // 2. Global user lookup (substring LIKE, no fuzzy — ask for a phone if uncertain).
    const matches = (await findUserByName(name)).filter((u) => u.chat_id !== ctx.callerChatId);
    if (matches.length === 1) {
      return await linkContact(matches[0].chat_id, matches[0].name ?? null, null);
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
    // 3. Unknown name without phone — create the contact anyway. Phone is
    //    optional (only needed for Telegram auto-linking). Most contacts
    //    don't use Telegram — they still get schedules stored + appear in
    //    availability checks.
    await upsertPersonNote(ctx.callerChatId, name);
    const norm = name.trim().toLowerCase();
    if (!ctx.snapshot.personNotes.find((n) => n.name_normalized === norm)) {
      ctx.snapshot.personNotes.push({
        id: 0,
        owner_chat_id: ctx.callerChatId,
        name,
        name_normalized: norm,
        phone: null,
        linked_chat_id: null,
        schedule_json: null,
        notes: null,
        hidden: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    return {
      contact_created: true,
      contact_name: name,
      notes: `Created ${name} as a contact. No phone on file — that's fine, phone is only needed if they join Telegram later. You can now save their schedule via parse_schedule with attributed_to_name="${name}".`,
    };
  },
};

// --- Tool 4: forget_contact (hard delete, vs set_person_hidden which is soft) ---

const removePartnerTool: ToolDefinition = {
  name: "forget_contact",
  description: "Permanently delete a contact from the caller's person list. Use when the caller explicitly wants to erase someone — 'forget X', 'delete X from my list', 'stop keeping track of X'. For 'I'm not interested in X for now' use set_person_hidden (reversible) instead. Owner-scoped: only deletes the caller's own person_note, not the other user's account.",
  input_schema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", description: "Name of the contact to forget (matched against the caller's person_notes)." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return { error: "Missing name argument." };
    const normalized = name.trim().toLowerCase();
    const result = await query(
      "DELETE FROM person_notes WHERE owner_chat_id = ? AND name_normalized = ?",
      [ctx.callerChatId, normalized],
    );
    const changes = result.meta?.changes ?? 0;
    if (changes === 0) return { not_found: true, name };
    ctx.snapshot.personNotes = ctx.snapshot.personNotes.filter(
      (n) => n.name_normalized !== normalized,
    );
    return { forgotten: true, name };
  },
};

// --- Tool 5: compute_overlap ---

const computeAndDeliverMatchTool: ToolDefinition = {
  name: "compute_overlap",
  description:
    "Find overlapping free time between the caller and their non-hidden contacts, using everyone's canonical schedule (users.latest_schedule_json for real bot users, person_notes.schedule_json for on-behalf). Returns ranked slots. If `deliver=true` and the caller has ≥1 linked contact, also sends a notification + calendar event to each linked contact. No sessions involved.",
  input_schema: {
    type: "object",
    properties: {
      deliver: {
        type: "boolean",
        description: "Optional. When true and there's a clear best slot, send a notification + calendar event to each linked contact. Default false (preview only).",
      },
      only_contacts: {
        type: "array",
        items: { type: "string" },
        description: "Optional. Limit overlap to these named contacts (case-insensitive). If omitted, uses all non-hidden contacts.",
      },
      force_mediated: {
        type: "boolean",
        description: "If true, return only the caller's own availability windows (single-person slots) — useful when the caller wants to offer their free times to someone who hasn't uploaded yet.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const deliver = input.deliver === true;
    const forceMediated = input.force_mediated === true;
    const onlyFilter = Array.isArray(input.only_contacts)
      ? (input.only_contacts as unknown[]).filter((v): v is string => typeof v === "string").map((s) => s.toLowerCase())
      : null;

    const callerSchedule = ctx.snapshot.user.latest_schedule_json;
    if (forceMediated) {
      if (!callerSchedule) {
        return { error: "Can't run mediated mode — caller hasn't uploaded their schedule yet." };
      }
      const slots = computeSinglePersonSlots(callerSchedule);
      return {
        status: slots.length > 0 ? "caller_only_slots" : "no_slots_from_single_schedule",
        all_slots: slots,
      };
    }

    // Build the schedule set: caller + non-hidden contacts with a schedule.
    const contacts = ctx.snapshot.personNotes.filter((n) => {
      if (n.hidden) return false;
      if (!n.schedule_json) return false;
      if (onlyFilter && !onlyFilter.includes(n.name.toLowerCase())) return false;
      return true;
    });

    const schedules: Array<{ id: string; schedule_json: string | null }> = [];
    if (callerSchedule) schedules.push({ id: `caller:${ctx.callerChatId}`, schedule_json: callerSchedule });
    for (const n of contacts) {
      schedules.push({ id: `contact:${n.linked_chat_id ?? `note${n.id}`}`, schedule_json: n.schedule_json });
    }

    // Augment with each participant's live Google Calendar events (if
    // connected). The bot's stored schedule is shift-level ("I work
    // 9–5"); calendar has real appointments ("dentist 3pm Thursday").
    // Merging both gives a truthful picture without requiring users to
    // re-type their meetings. Silent no-op for anyone not /connect'd.
    const overlapTz = resolveCallerTimezone(ctx);
    const windowStart = new Date().toISOString().slice(0, 10);
    const windowEnd = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const calendarSources: Array<{ chat_id: string; id_prefix: string }> = [
      { chat_id: ctx.callerChatId, id_prefix: "caller-cal" },
      ...contacts
        .filter((n) => !!n.linked_chat_id)
        .map((n) => ({ chat_id: n.linked_chat_id as string, id_prefix: `contact-cal:${n.linked_chat_id}` })),
    ];
    for (const src of calendarSources) {
      try {
        const events = await listCalendarEventsInWindow(src.chat_id, windowStart, windowEnd, overlapTz);
        if (events.length > 0) {
          schedules.push({ id: src.id_prefix, schedule_json: JSON.stringify(events) });
        }
      } catch (err) {
        console.warn(`[compute_overlap] calendar fetch failed for ${src.chat_id}:`, err);
      }
    }

    if (schedules.length < 2) {
      return {
        status: "need_more_schedules",
        caller_has_schedule: !!callerSchedule,
        contacts_with_schedule: contacts.length,
        missing_hint: callerSchedule
          ? "Caller's schedule is uploaded, but no eligible contact has a schedule. Ask the caller who they want to plan with, or tell them the contact needs to upload theirs."
          : "Caller hasn't uploaded their own schedule yet — ask for it first.",
      };
    }

    const slots: ComputedFreeSlot[] = computeOverlaps(schedules);
    if (slots.length === 0) {
      return { status: "no_overlap" };
    }

    // Delivery (optional): for each linked contact, send a notification and
    // create a calendar event for the top slot. Skip on-behalf-only notes
    // (no linked_chat_id = no Telegram chat to message).
    let deliveryResult: Awaited<ReturnType<typeof deliverMatchToContacts>> | null = null;
    if (deliver) {
      const top = slots[0];
      const linkedContactIds = contacts
        .map((n) => n.linked_chat_id)
        .filter((id): id is string => !!id);
      deliveryResult = await deliverMatchToContacts(
        ctx.callerChatId,
        linkedContactIds,
        top,
        ctx.snapshot.user.preferred_language ?? "en",
        ctx.snapshot.user.name ?? null,
        resolveCallerTimezone(ctx),
      );
    }

    // Build a compact per-person per-day schedule summary so Claude has
    // exact shift times RIGHT NEXT to the overlap result — prevents time
    // confabulation when reasoning about "when do I finish the day before?"
    const schedulesSummary: Record<string, Record<string, string>> = {};
    const callerName = ctx.snapshot.user.name ?? "Caller";
    // Build per-date summaries that preserve OFF + activity coexistence.
    // Group by date first; reconcile OFF/partials/all-day-busy in one pass
    // so an off day with a gym block reads as "OFF + 18:00–19:00 (gym)"
    // — not silently overwritten by either side.
    const addPersonSchedule = (name: string, json: string | null) => {
      if (!json) return;
      try {
        const shifts = JSON.parse(json) as Array<{ date: string; start_time: string; end_time: string; label?: string }>;
        const grouped = new Map<string, typeof shifts>();
        for (const s of shifts) {
          const list = grouped.get(s.date);
          if (list) list.push(s);
          else grouped.set(s.date, [s]);
        }
        const byDay: Record<string, string> = {};
        for (const [date, entries] of grouped) {
          const offs = entries.filter((s) => s.start_time === "00:00" && s.end_time === "00:00");
          const allDay = entries.find((s) => s.start_time === "00:00" && s.end_time === "23:59");
          const partials = entries.filter(
            (s) => !(s.start_time === "00:00" && s.end_time === "00:00")
              && !(s.start_time === "00:00" && s.end_time === "23:59"),
          );
          const renderPartial = (s: { start_time: string; end_time: string; label?: string }) =>
            `${s.start_time}–${s.end_time}${s.label ? ` (${s.label})` : ""}`;
          if (allDay) {
            byDay[date] = (allDay.label ?? "busy all day").toUpperCase();
          } else if (offs.length > 0 && partials.length > 0) {
            byDay[date] = `OFF + ${partials.map(renderPartial).join(", ")}`;
          } else if (offs.length > 0) {
            byDay[date] = "OFF";
          } else {
            byDay[date] = partials.map(renderPartial).join(", ");
          }
        }
        schedulesSummary[name] = byDay;
      } catch { /* skip malformed */ }
    };
    addPersonSchedule(callerName, callerSchedule);
    for (const n of contacts) {
      addPersonSchedule(n.name, n.schedule_json);
    }

    return {
      status: deliver ? "delivered" : "preview",
      match: slots[0],
      all_slots: slots,
      slot_count: slots.length,
      delivery: deliveryResult,
      schedules_summary: schedulesSummary,
    };
  },
};

/**
 * Lightweight delivery: for each contact we have a chat_id for, send a text
 * notification + create a calendar event keyed to the chosen slot. Best-
 * effort: a failure for one contact doesn't stop the rest. Calendar event
 * creation reuses the existing google-calendar helper.
 */
async function deliverMatchToContacts(
  callerChatId: string,
  contactChatIds: string[],
  slot: ComputedFreeSlot,
  callerLang: string,
  callerName: string | null,
  timezone: string,
): Promise<{
  delivered_to: string[];
  failures: string[];
  calendar_events_created: string[];
  calendar_failures: string[];
}> {
  const delivered: string[] = [];
  const failures: string[] = [];
  const calendarOk: string[] = [];
  const calendarFail: string[] = [];
  const whoLabel = callerName ?? `chat ${callerChatId.slice(-4)}`;
  const headline =
    callerLang === "it" ? `${whoLabel} ha trovato un orario: ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`
    : callerLang === "es" ? `${whoLabel} encontró un horario: ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`
    : callerLang === "fr" ? `${whoLabel} a trouvé un créneau : ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`
    : callerLang === "de" ? `${whoLabel} hat einen Termin gefunden: ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`
    : `${whoLabel} picked a time: ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`;

  // Recipients = all contacts + the caller themselves, so everyone lands a
  // calendar event for a chosen slot. Caller gets no Telegram ping (they're
  // already in the conversation that produced this).
  const summary = callerName ? `Meetup with ${callerName}` : "MeetSync meetup";
  for (const cid of contactChatIds) {
    try {
      await sendTextMessage(cid, `📅 ${headline}`);
      delivered.push(cid);
    } catch (err) {
      failures.push(cid);
      console.warn(`[deliver] telegram send failed to ${cid}:`, err);
    }
  }

  const everyoneForCalendar = [callerChatId, ...contactChatIds];
  for (const cid of everyoneForCalendar) {
    try {
      const r = await createCalendarEvent(
        cid,
        slot.day,
        slot.start_time,
        slot.end_time,
        summary,
        timezone,
      );
      if (r === true) calendarOk.push(cid);
      else calendarFail.push(cid);
    } catch (err) {
      calendarFail.push(cid);
      console.warn(`[deliver] calendar create failed for ${cid}:`, err);
    }
  }
  return {
    delivered_to: delivered,
    failures,
    calendar_events_created: calendarOk,
    calendar_failures: calendarFail,
  };
}

// --- Tool 6: upsert_knowledge ---

const upsertKnowledgeTool: ToolDefinition = {
  name: "upsert_knowledge",
  description:
    "Persist knowledge across turns. target='user' updates the CALLER's own profile (name, language, timezone, phone, a freeform fact). target='person' updates or creates a person_notes row for a named third party — use this ONLY to store facts/phone/notes about someone ALREADY known to the caller (e.g. 'Jojo's favorite café is X', 'Jojo's phone is +356...'). Do NOT use this tool to add someone to a meetup, invite them, or find a time — for 'add Jojo to plan with' / 'let's meet Jojo', use add_or_invite_partner instead.",
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
        const resolved = await updateUserPhone(ctx.callerChatId, phone);
        ctx.snapshot.user = { ...ctx.snapshot.user, phone };
        actions.push(`phone=${phone}`);
        // Fire shadow-link notifications — anyone who had this caller
        // shadow-tracked by phone now sees them linked in their contacts.
        await notifyShadowLinkResolutions(resolved, ctx.callerChatId);
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

// --- Tool 6b: set_person_hidden ---

const setPersonHiddenTool: ToolDefinition = {
  name: "set_person_hidden",
  description:
    "Hide or unhide a person from the caller's visible pool. Use when the user says things like 'not interested in Sofia anymore' / 'remove Sofia from my list' (hidden=true) or 'bring Sofia back' / 'I want Sofia again' (hidden=false). Hidden contacts are excluded from the snapshot's person list and from 'who's available' results. Data is preserved — nothing is deleted, and unhiding restores the person with their schedule/notes intact.",
  input_schema: {
    type: "object",
    required: ["person_name", "hidden"],
    properties: {
      person_name: { type: "string", description: "The name the user referred to (matched against the caller's person_notes, normalized)." },
      hidden: { type: "boolean", description: "true to hide, false to unhide." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const personName = typeof input.person_name === "string" ? input.person_name.trim() : "";
    if (!personName) return { error: "person_name required." };
    if (typeof input.hidden !== "boolean") return { error: "hidden must be a boolean." };
    const ok = await setPersonNoteHidden(ctx.callerChatId, personName, input.hidden);
    if (!ok) {
      return {
        error: "not_found",
        message: `No contact named '${personName}' in your list. If you meant to add them, mention their name and I'll start tracking them.`,
      };
    }
    return {
      ok: true,
      person_name: personName,
      hidden: input.hidden,
      action: input.hidden ? "hidden" : "unhidden",
    };
  },
};

// --- Tool 7a: query_schedule_history ---
//
// The snapshot's [STATE] block only renders shifts inside an active window
// (today−14d → today+60d). Full schedule history lives in
// users.latest_schedule_json (or person_notes.schedule_json) forever — the
// per-date merge in persistShifts never prunes — but rendering every date
// each turn would balloon token cost as months pass. So out-of-window
// dates are reachable via this tool. Claude calls it when the user asks
// "what was my September look like" / "did I work last Christmas" /
// "what's penciled in for December".

const queryScheduleHistoryTool: ToolDefinition = {
  name: "query_schedule_history",
  description:
    "Look up shifts on dates OUTSIDE the active window shown in [STATE] (today−14d → today+60d). Use whenever the user asks about a specific past date older than two weeks ago, or a future date more than two months out, that is NOT in the inline shift list. Examples: 'was I working on 12 March?', 'what was my schedule in September?', 'do I have anything penciled for Christmas?'. Returns shifts in the date range, grouped by date. Reads the full stored schedule — nothing is ever deleted, so even years-old uploads come back. Don't fabricate; if the tool returns no rows for a date, tell the user honestly that nothing's on file for that date.",
  input_schema: {
    type: "object",
    required: ["start_date", "end_date"],
    properties: {
      start_date: {
        type: "string",
        description: "Inclusive start date in YYYY-MM-DD. Pick a sensible window around what the user asked — e.g. for 'September' use 2026-09-01. Don't query single-day windows just to check one date — a 3-7 day window is fine and gives you context.",
      },
      end_date: {
        type: "string",
        description: "Inclusive end date in YYYY-MM-DD. Must be >= start_date.",
      },
      contact_name: {
        type: "string",
        description: "Optional. The name of a contact (must already be in the caller's person_notes) whose history to query. Omit to query the caller's own history.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const start = typeof input.start_date === "string" ? input.start_date : "";
    const end = typeof input.end_date === "string" ? input.end_date : "";
    const contactName = typeof input.contact_name === "string" ? input.contact_name.trim() : "";
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(start) || !dateRe.test(end)) {
      return { error: "start_date and end_date must be YYYY-MM-DD." };
    }
    if (start > end) {
      return { error: `start_date (${start}) must be on or before end_date (${end}).` };
    }

    let scheduleJson: string | null;
    let target: string;
    if (contactName) {
      const note = ctx.snapshot.personNotes.find(
        (n) => n.name.toLowerCase() === contactName.toLowerCase(),
      );
      if (!note) {
        return {
          error: "contact_not_found",
          message: `No contact named '${contactName}' in your list.`,
        };
      }
      scheduleJson = note.schedule_json;
      target = `person_note:${contactName}`;
    } else {
      scheduleJson = ctx.snapshot.user.latest_schedule_json;
      target = `user:${ctx.callerChatId}`;
    }

    if (!scheduleJson) {
      return {
        target,
        range: { start, end },
        shifts: [],
        notes: "no schedule on file for this target",
      };
    }

    let allShifts: Array<{ date: string; start_time: string; end_time: string; label?: string }> = [];
    try {
      const parsed = JSON.parse(scheduleJson);
      if (Array.isArray(parsed)) allShifts = parsed;
    } catch {
      return { error: "schedule_json unparseable for target — corrupt blob in D1." };
    }

    const inRange = allShifts
      .filter((s) => typeof s.date === "string" && s.date >= start && s.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

    return {
      target,
      range: { start, end },
      shift_count: inRange.length,
      shifts: inRange,
    };
  },
};

// --- Tool 7: reset_conversation ---

const sessionActionTool: ToolDefinition = {
  name: "reset_conversation",
  description:
    "Wipe the caller's recent conversation history with the bot so the next turn starts fresh. Use when the user says 'start over', 'fresh start', 'new session', 'forget what we were just talking about'. Does NOT delete contacts, schedules, or reminders — those are the user's data and survive. Only the recent-messages log for THIS caller is cleared. The previous system had a stricter 'session' concept; in the shared-hub model there's nothing else to reset.",
  input_schema: { type: "object", properties: {} },
  async execute(_input, ctx): Promise<ToolResult> {
    await query("DELETE FROM conversation_log WHERE chat_id = ?", [ctx.callerChatId]);
    ctx.snapshot.recentHistory = [];
    return {
      ok: true,
      notes: "Conversation history cleared. Tell the user clearly: chat history wiped, but ALL their data is safe — contacts, schedules, reminders, calendar connections, everything. Nothing lost except the message thread.",
    };
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
            callback: { type: "string", enum: ["confirm", "reject", "yes", "no", "new_session"] },
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
            ["confirm", "reject", "yes", "no", "new_session"].includes((b as ReplyButton).callback),
        ) as ReplyButton[])
      : undefined;
    ctx.pendingReply = { messages, buttons: buttons && buttons.length > 0 ? buttons : undefined };
    ctx.replySent = true;
    return { queued: true, message_count: messages.length };
  },
};

// --- Tool 8: schedule_reminder ---

const MAX_ACTIVE_REMINDERS_PER_USER = 20;

const scheduleReminderTool: ToolDefinition = {
  name: "schedule_reminder",
  description:
    "Schedule a reminder that the bot will send back to the user as a Telegram message at a chosen time. Use when the user says things like 'remind me tomorrow at 6am to call mum', 'ping me Friday 3pm', 'every Monday at 9am tell me to stretch'. Always parse their natural-language time into a local ISO timestamp in THEIR timezone (shown in [STATE]). The 'when_local' argument is a wall-clock time in the user's local timezone — NOT UTC. For recurring, pass recurrence='daily'|'weekly'|'monthly'.",
  input_schema: {
    type: "object",
    required: ["text", "when_local"],
    properties: {
      text: {
        type: "string",
        description: "What to remind the user about. Short, first-person-ish ('call mum', 'stretch', 'take meds'). Max 500 chars.",
      },
      when_local: {
        type: "string",
        description: "Wall-clock time in the user's timezone, ISO format 'YYYY-MM-DDTHH:MM' (e.g. '2026-04-15T06:00'). Must be in the future.",
      },
      recurrence: {
        type: "string",
        enum: ["daily", "weekly", "monthly"],
        description: "Optional. Omit for one-shot. 'daily'/'weekly'/'monthly' fires repeatedly, advancing by that interval each fire.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 500) : "";
    if (!text) return { error: "text required." };
    const whenLocal = typeof input.when_local === "string" ? input.when_local.trim() : "";
    if (!whenLocal) return { error: "when_local required (ISO like '2026-04-15T06:00')." };
    const recurrence =
      input.recurrence === "daily" || input.recurrence === "weekly" || input.recurrence === "monthly"
        ? (input.recurrence as ReminderRecurrence)
        : null;

    const tz = resolveCallerTimezone(ctx);
    const fireAtEpoch = localIsoToUtcEpoch(whenLocal, tz);
    if (fireAtEpoch === null) {
      return { error: `Couldn't parse when_local='${whenLocal}'. Use 'YYYY-MM-DDTHH:MM'.` };
    }
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (fireAtEpoch <= nowEpoch) {
      return { error: "when_local is in the past — please pick a future time." };
    }

    // Cap active reminders per user so a mischievous turn can't spam.
    const active = await listUserReminders(ctx.callerChatId, { limit: MAX_ACTIVE_REMINDERS_PER_USER + 1 });
    if (active.length >= MAX_ACTIVE_REMINDERS_PER_USER) {
      return {
        error: "reminder_cap",
        message: `You already have ${MAX_ACTIVE_REMINDERS_PER_USER} active reminders — cancel one first.`,
      };
    }

    const id = await createReminder(ctx.callerChatId, text, fireAtEpoch, tz, recurrence);
    return {
      ok: true,
      reminder_id: id,
      text,
      fires_at_local: whenLocal,
      fires_at_epoch: fireAtEpoch,
      timezone: tz,
      recurrence,
    };
  },
};

// --- Tool 9: list_reminders ---

const listRemindersTool: ToolDefinition = {
  name: "list_reminders",
  description:
    "List the caller's active (PENDING) reminders, soonest-first. Use when the user asks things like 'what reminders do I have?' / 'show my reminders'. Returns id, text, fire_at_local, recurrence for each.",
  input_schema: { type: "object", properties: {} },
  async execute(_input, ctx): Promise<ToolResult> {
    const rows = await listUserReminders(ctx.callerChatId);
    const tz = resolveCallerTimezone(ctx);
    const items = rows.map((r) => {
      // Format fire_at as local wall-clock for display.
      const localStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: r.timezone || tz,
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(r.fire_at * 1000));
      return {
        id: r.id,
        text: r.text,
        fires_at_local: localStr,
        fires_at_epoch: r.fire_at,
        recurrence: r.recurrence,
      };
    });
    return { ok: true, count: items.length, reminders: items };
  },
};

// --- Tool 10: cancel_reminder ---

const cancelReminderTool: ToolDefinition = {
  name: "cancel_reminder",
  description:
    "Cancel an active reminder by id. Use when the user says 'cancel that reminder' / 'don't remind me about X anymore'. Pass the reminder_id from list_reminders. Cancellation is owner-scoped — you can't cancel someone else's reminders.",
  input_schema: {
    type: "object",
    required: ["reminder_id"],
    properties: {
      reminder_id: { type: "string", description: "UUID returned from list_reminders." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const id = typeof input.reminder_id === "string" ? input.reminder_id.trim() : "";
    if (!id) return { error: "reminder_id required." };
    const ok = await cancelReminder(ctx.callerChatId, id);
    if (!ok) return { error: "not_found", message: "No active reminder with that id." };
    return { ok: true, reminder_id: id, status: "CANCELLED" };
  },
};

// --- Tool 12: relay_message ---

const RELAY_MAX_TEXT_LEN = 500;

const relayMessageTool: ToolDefinition = {
  name: "relay_message",
  description:
    "Send a message on the caller's behalf to someone they've already added (a person_note whose linked_chat_id is set). Use when the caller explicitly asks to pass something on: 'tell Kurt I want to meet Saturday', 'remind Joejoe to send his schedule', 'let Sofia know I'm running late'. You GHOSTWRITE the message in the bot's natural voice, naming the caller inside the body where it helps — e.g. 'Hey Kurt 👋 Riccardo asked me to nudge you — could you share your schedule this week?'. Do NOT quote the caller literally, do NOT use stiff attribution like 'Riccardo says: …'. Match your usual warm, direct style. CRITICAL confirmation gate: always draft the exact text back to the caller FIRST (via reply with yes/no buttons, or by asking 'send this to Kurt? [draft]') — only call this tool AFTER the caller explicitly confirms. Never call on an implied/ambiguous request. Never send without showing the draft. IMPORTANT: draft the message in the RECIPIENT's preferred_language, not the caller's — the recipient will read it; the caller is only approving it. Show the caller the draft in their own language for approval but send the recipient-language version. If you can't see the recipient's language in [STATE], default to the caller's.",
  input_schema: {
    type: "object",
    required: ["to_person_name", "text"],
    properties: {
      to_person_name: {
        type: "string",
        description: "Name of the person to send to. Must resolve to a person_note with linked_chat_id set (they have to be a real bot user the caller has added).",
      },
      text: {
        type: "string",
        description: `The message body — your ghostwritten draft in the bot's voice, already confirmed by the caller. Sent verbatim. Max ${RELAY_MAX_TEXT_LEN} chars.`,
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const toName = typeof input.to_person_name === "string" ? input.to_person_name.trim() : "";
    const text = typeof input.text === "string" ? input.text.trim().slice(0, RELAY_MAX_TEXT_LEN) : "";
    if (!toName) return { error: "to_person_name required." };
    if (!text) return { error: "text required." };

    const note = await findPersonNote(ctx.callerChatId, toName);
    if (!note) {
      return {
        error: "not_found",
        message: `No contact named '${toName}' in the caller's list. Add them first (name + phone) before relaying.`,
      };
    }
    if (!note.linked_chat_id) {
      return {
        error: "not_joined",
        message: `${toName} hasn't joined the bot yet — can't message them until they do.`,
      };
    }
    if (note.linked_chat_id === ctx.callerChatId) {
      return { error: "self_target", message: "Can't send a message to yourself." };
    }

    // Sent verbatim — Claude is responsible for drafting in the bot's voice.
    try {
      await sendTextMessage(note.linked_chat_id, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: "send_failed", message: `Telegram rejected the send: ${msg}` };
    }

    return { ok: true, sent_to: note.name, to_chat_id: note.linked_chat_id, chars: text.length };
  },
};

// --- Tool 13: watch_schedule_upload ---

const watchScheduleUploadTool: ToolDefinition = {
  name: "watch_schedule_upload",
  description:
    "Register a one-shot follow-through: the NEXT time the named contact uploads a schedule, the bot pings the caller automatically. Use this whenever you promise to 'let them know' or 'ping them once X uploads' — otherwise the promise is empty. The contact must already be in the caller's person_notes with linked_chat_id (i.e. a real bot user). Safe to call repeatedly for the same (caller, contact) pair — idempotent.",
  input_schema: {
    type: "object",
    required: ["person_name"],
    properties: {
      person_name: {
        type: "string",
        description: "Name of the contact whose schedule-upload you want to be notified about.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const name = typeof input.person_name === "string" ? input.person_name.trim() : "";
    if (!name) return { error: "person_name required." };
    const note = await findPersonNote(ctx.callerChatId, name);
    if (!note) return { error: "not_found", message: `No contact named '${name}'.` };
    if (!note.linked_chat_id) {
      return {
        error: "not_joined",
        message: `${name} isn't a bot user yet — can't watch for an upload that can't happen.`,
      };
    }
    await createScheduleWatch(ctx.callerChatId, note.linked_chat_id);
    return { ok: true, watching: note.name, watching_chat_id: note.linked_chat_id };
  },
};

// --- Tool 14: book_meetup ---

const bookMeetupTool: ToolDefinition = {
  name: "book_meetup",
  description:
    "Commit a meetup to Google Calendar for the caller and each named attendee. CANONICAL 'lock in' action — a real calendar event on every /connect'd participant's primary calendar, plus a busy block appended to each person's in-bot schedule so future 'who's free' queries treat the slot as taken. Single-day event only: one date, one start time, one end time. For recurring, tell the caller to duplicate from Google Calendar's UI — no recurrence here. Anyone without Google Calendar connected is listed in skipped_not_connected; the caller's OWN event is still created unconditionally (booking on the caller's calendar never requires the contact's consent or connection). After booking, reply with ONE line ('booked — it's on your calendar') and stop. When the caller defers ('just pick', 'just book it', 'you choose'), you are authorised to choose concrete values (date, start_time, end_time, title) yourself and book immediately — do not re-ask for specifics after a defer.",
  input_schema: {
    type: "object",
    required: ["date", "start_time", "end_time", "title"],
    properties: {
      date: { type: "string", description: "YYYY-MM-DD, in the caller's timezone." },
      start_time: { type: "string", description: "HH:MM (24h), local to the caller's timezone." },
      end_time: { type: "string", description: "HH:MM (24h), local to the caller's timezone." },
      title: { type: "string", description: "Short event title, e.g. 'Cat walk with Kurt', 'Dinner with Sofia'." },
      attendee_names: {
        type: "array",
        items: { type: "string" },
        description: "Names of the caller's contacts (must be in their person_notes with linked_chat_id) to also book on their calendars. Omit to book only for the caller.",
      },
      override_conflicts: {
        type: "boolean",
        description: "When false/omitted, the tool refuses to book if any participant is busy at the requested time, returning conflicts[]. When true, books anyway. Only set true if the caller has explicitly acknowledged the conflict and asked to proceed.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const date = typeof input.date === "string" ? input.date.trim() : "";
    const startTime = typeof input.start_time === "string" ? input.start_time.trim() : "";
    const endTime = typeof input.end_time === "string" ? input.end_time.trim() : "";
    const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD." };
    if (!/^\d{2}:\d{2}$/.test(startTime)) return { error: "start_time must be HH:MM." };
    if (!/^\d{2}:\d{2}$/.test(endTime)) return { error: "end_time must be HH:MM." };
    if (!title) return { error: "title required." };

    const tz = resolveCallerTimezone(ctx);
    const attendeeNames = Array.isArray(input.attendee_names)
      ? (input.attendee_names as unknown[]).filter((v): v is string => typeof v === "string")
      : [];

    // Resolve attendee chat_ids from person_notes
    const attendeeTargets: Array<{ name: string; chat_id: string }> = [];
    const unknownAttendees: string[] = [];
    for (const n of attendeeNames) {
      const note = await findPersonNote(ctx.callerChatId, n);
      if (note?.linked_chat_id) attendeeTargets.push({ name: note.name, chat_id: note.linked_chat_id });
      else unknownAttendees.push(n);
    }

    // Conflict check BEFORE writing anything: for each participant, union
    // their stored schedule + their live Google Calendar events, and see
    // if the requested slot overlaps any busy block. If anyone's busy,
    // bail out with conflicts so Claude can either suggest a different
    // time or re-ask the user with the override flag.
    const conflictTargets = [
      { name: ctx.snapshot.user.name ?? "you", chat_id: ctx.callerChatId },
      ...attendeeTargets,
    ];
    const conflicts: Array<{ name: string; reason: string }> = [];
    const reqStart = timeToMinutes(startTime);
    const reqEnd = timeToMinutes(endTime);
    for (const t of conflictTargets) {
      const busy = await gatherBusyBlocksForDate(t.chat_id, date, tz);
      const hit = busy.find((b) => reqStart < b.end && reqEnd > b.start);
      if (hit) {
        conflicts.push({
          name: t.name,
          reason: `busy ${hit.label} (${minutesToTime(hit.start)}–${minutesToTime(hit.end)})`,
        });
      }
    }
    const override = input.override_conflicts === true;
    if (conflicts.length > 0 && !override) {
      return {
        error: "conflict",
        conflicts,
        message: `At least one participant is busy at ${date} ${startTime}–${endTime}. Either pick a different time, or call book_meetup again with override_conflicts=true if the caller explicitly wants to book over the conflict.`,
      };
    }

    // Book for caller + each attendee
    const booked: string[] = [];
    const skippedNotConnected: string[] = [];
    const failed: string[] = [];
    // Partial failures that don't block the "booked" confirmation but DO
    // need to surface to the user — so Claude can mention them honestly
    // instead of the bot saying "booked!" when half the side-effects
    // silently failed (bus block write, attendee notify, etc.).
    const partialFailures: string[] = [];
    const allTargets = [
      { name: ctx.snapshot.user.name ?? "you", chat_id: ctx.callerChatId },
      ...attendeeTargets,
    ];
    const busyLabel = `meetup: ${title}`;

    // Gather emails for attendees who have them (captured on OAuth). These
    // go as attendees on the single shared event created on the caller's
    // calendar — Google auto-invites them, so they get the event on their
    // own calendar with proper RSVP/edit/delete semantics.
    const attendeeEmails: string[] = [];
    const attendeesWithoutEmail: Array<{ name: string; chat_id: string }> = [];
    for (const t of attendeeTargets) {
      const u = await getUser(t.chat_id);
      if (u?.email) attendeeEmails.push(u.email);
      else attendeesWithoutEmail.push(t);
    }

    // Create ONE event on the caller's calendar with all email-attendees.
    // If THIS write fails (token expired, env missing, network), short-circuit
    // with an honest error — historically the tool returned ok:true with an
    // empty booked[], and Claude misread it as "booked!" and lied to the user.
    // We also skip the bot-side busy-memory write below so the stored
    // schedule doesn't show phantom events that don't exist on the calendar.
    let callerEventCreated = false;
    try {
      const r = await createCalendarEvent(ctx.callerChatId, date, startTime, endTime, title, tz, attendeeEmails);
      if (r === true) {
        callerEventCreated = true;
        booked.push(ctx.snapshot.user.name ?? "you");
        // Mark email-attendees as booked too — Google sent them the invite.
        for (const t of attendeeTargets) {
          const u = await getUser(t.chat_id);
          if (u?.email) booked.push(t.name);
        }
      } else if (r === "token_expired") {
        return {
          error: "calendar_token_expired",
          message: "The caller's Google Calendar token is expired or revoked. Tell them their /connect needs to be re-run, and do NOT claim the meetup is booked. Nothing was written.",
        };
      } else {
        return {
          error: "calendar_unavailable",
          message: "Couldn't write the event to the caller's Google Calendar (refresh failed — check Trigger.dev env vars or the prior console.warn for detail). Tell the caller honestly that booking did not go through; do NOT say 'booked'. Nothing was written.",
        };
      }
    } catch (err) {
      console.warn(`[book_meetup] shared event failed:`, err);
      return {
        error: "calendar_write_failed",
        message: `Calendar API threw an error (${err instanceof Error ? err.message : String(err)}). Tell the caller honestly that booking did not go through. Nothing was written.`,
      };
    }

    // For attendees WITHOUT email (not OAuth-connected), fall back to
    // creating a parallel event on their own calendar if they're connected
    // that way (unlikely — no email means no /connect), otherwise they
    // just get a Telegram ping and a memory-schedule update.
    for (const t of attendeesWithoutEmail) {
      try {
        const r = await createCalendarEvent(t.chat_id, date, startTime, endTime, title, tz);
        if (r === true) booked.push(t.name);
        else skippedNotConnected.push(t.name);
      } catch (err) {
        failed.push(t.name);
        partialFailures.push(`couldn't create calendar event for ${t.name}`);
        console.warn(`[book_meetup] fallback event failed for ${t.chat_id}:`, err);
      }
    }

    // Write busy block into EVERYONE's schedule memory, connected or not.
    for (const t of allTargets) {
      try {
        await appendBusyBlockToUser(t.chat_id, date, startTime, endTime, busyLabel);
        if (t.chat_id === ctx.callerChatId) {
          const updated = await getLatestScheduleForUser(ctx.callerChatId);
          if (updated) ctx.snapshot.user = { ...ctx.snapshot.user, latest_schedule_json: updated };
        }
      } catch (err) {
        partialFailures.push(`couldn't update bot-side busy memory for ${t.name} (future conflict-checks may miss this slot)`);
        console.warn(`[book_meetup] memory-schedule append failed for ${t.chat_id}:`, err);
      }
    }

    // Ping attendees (who got booked) with a short confirmation
    const callerName = ctx.snapshot.user.name ?? "your contact";
    for (const t of attendeeTargets) {
      if (!booked.includes(t.name)) continue;
      try {
        await sendTextMessage(
          t.chat_id,
          `📅 ${callerName} just booked "${title}" for ${date} ${startTime}–${endTime} — it's on your Google Calendar.`,
        );
      } catch (err) {
        partialFailures.push(`couldn't notify ${t.name} on Telegram — may want to nudge them directly`);
        console.warn(`[book_meetup] attendee notify failed for ${t.chat_id}:`, err);
      }
    }

    return {
      ok: true,
      booked,
      skipped_not_connected: skippedNotConnected,
      failed,
      unknown_attendees: unknownAttendees,
      partial_failures: partialFailures,
      event: { date, start_time: startTime, end_time: endTime, title },
    };
  },
};

// --- Tool 15: cancel_meetup ---

const cancelMeetupTool: ToolDefinition = {
  name: "cancel_meetup",
  description:
    "Cancel a previously-booked meetup on the caller's primary calendar. Two-stage flow: call once with date+optional title_hint to LIST candidates (returns events[]); then call again with event_id+confirmed=true to actually delete. The destructive call sends Google cancellation invites to attendees automatically AND clears the busy block from each attendee's bot-side schedule memory (when their email is known). Single-instance only — for recurring series, the caller should cancel from Google Calendar's UI to choose 'this event' vs 'this and following' vs 'all'. Past events: allowed (cleanup). Secondary calendars: not supported (book_meetup only creates on primary).",
  input_schema: {
    type: "object",
    required: ["date"],
    properties: {
      date: { type: "string", description: "YYYY-MM-DD of the meetup to cancel, in caller's timezone." },
      title_hint: { type: "string", description: "Optional case-insensitive substring to filter events by title (e.g. 'football' to skip the dentist appt that's also that day)." },
      event_id: { type: "string", description: "Google Calendar event id, from a previous list call. Required when confirmed=true and there were multiple candidates." },
      confirmed: { type: "boolean", description: "Set true ONLY after showing the caller exactly which event you're about to cancel and getting their explicit yes. Without this, the tool returns a preview/list and DOES NOT delete." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const date = typeof input.date === "string" ? input.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD." };
    const titleHint = typeof input.title_hint === "string" ? input.title_hint.trim() : "";
    const eventId = typeof input.event_id === "string" ? input.event_id.trim() : "";
    const confirmed = input.confirmed === true;

    // Always list candidates first — even with event_id we re-fetch to be
    // sure it's still on the calendar and to get its attendees for cleanup.
    const candidates = await findCalendarEventsOnDate(ctx.callerChatId, date, titleHint);
    if (candidates.length === 0) {
      return { error: "not_found", message: `No events on ${date}${titleHint ? ` matching '${titleHint}'` : ""} across the caller's calendars.` };
    }

    // Preview-only call (or ambiguous + no pick).
    if (!confirmed || (candidates.length > 1 && !eventId)) {
      return {
        preview: true,
        date,
        candidates: candidates.map((c) => ({
          event_id: c.id,
          summary: c.summary,
          start_time: c.start_time,
          end_time: c.end_time,
          attendees: c.attendee_emails.length,
        })),
        notes:
          candidates.length > 1
            ? "Multiple events match — show the caller, ask which one to cancel, then call again with event_id + confirmed=true."
            : "Show the caller this event and ask 'cancel it?' before calling again with confirmed=true.",
      };
    }

    // Pick the target. If event_id given, validate it's in the list. If not
    // given (only possible when there's exactly 1 candidate), use that.
    const target = eventId
      ? candidates.find((c) => c.id === eventId)
      : candidates[0];
    if (!target) {
      return {
        error: "stale_event_id",
        message: `event_id ${eventId} no longer matches any event on ${date}. The event may have been deleted or changed; re-list candidates.`,
      };
    }

    // Hard delete — pass the calendar_id so secondary-calendar events
    // delete correctly (findCalendarEventsOnDate now spans all calendars).
    const result = await deleteCalendarEvent(ctx.callerChatId, target.id, target.calendar_id);
    if (result === "not_found") {
      return { error: "already_deleted", message: "Event was already deleted on Google's side. Nothing to do." };
    }
    if (result !== true) {
      return { error: "delete_failed", message: "Google rejected the delete. Try again or remove from Calendar UI." };
    }

    // Clean up bot-side busy blocks. The label format from book_meetup is
    // "meetup: {title}" — match that on the caller's row plus every
    // attendee's row whose email we have on file.
    const labelMatch = `meetup: ${target.summary}`;
    let cleared = 0;
    cleared += await removeBusyBlockFromUser(ctx.callerChatId, date, labelMatch);
    if (target.attendee_emails.length > 0) {
      const attendeeChatIds = await findChatIdsByEmails(target.attendee_emails);
      for (const cid of attendeeChatIds) {
        cleared += await removeBusyBlockFromUser(cid, date, labelMatch);
      }
    }
    // Sync caller's in-turn snapshot.
    if (cleared > 0) {
      const updated = await getLatestScheduleForUser(ctx.callerChatId);
      ctx.snapshot.user = { ...ctx.snapshot.user, latest_schedule_json: updated };
    }

    return {
      ok: true,
      cancelled: { event_id: target.id, summary: target.summary, date, start_time: target.start_time, end_time: target.end_time },
      attendees_notified: target.attendee_emails.length,
      busy_blocks_cleared: cleared,
    };
  },
};

// --- Dispatcher ---

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  parseScheduleTool,
  addOrInvitePartnerTool,
  removePartnerTool,
  computeAndDeliverMatchTool,
  upsertKnowledgeTool,
  setPersonHiddenTool,
  queryScheduleHistoryTool,
  sessionActionTool,
  scheduleReminderTool,
  listRemindersTool,
  cancelReminderTool,
  relayMessageTool,
  watchScheduleUploadTool,
  bookMeetupTool,
  cancelMeetupTool,
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
