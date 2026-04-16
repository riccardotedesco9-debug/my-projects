// Snapshot formatter — turns a structured Snapshot from d1-client into
// the [STATE] block string the turn handler prepends to every user turn.
//
// The format is optimised for Claude Sonnet's reading comprehension:
// short headers, bullet lists, no JSON (structured text is easier for
// the model to ground on than raw JSON when composing replies).
//
// Rule #1: the snapshot passed to formatSnapshot is the GROUND TRUTH.
// If something isn't listed here, Claude must not claim it exists. The
// system prompt has a matching instruction.
//
// Rule #2: never include other callers' person_notes here. Snapshot is
// built with getPersonNotesForOwner(caller) so the privacy boundary is
// already SQL-enforced — this formatter just passes them through.

import type { Snapshot, UserProfile, PersonNote } from "./d1-client.js";

/**
 * Format a Snapshot as the human-readable [STATE] block that goes at
 * the top of the user turn content sent to Claude.
 *
 * `todayLabel` is the bot's view of "today" in the user's timezone,
 * computed by the turn handler so all timestamps in the snapshot agree.
 */
export function formatSnapshot(snapshot: Snapshot, todayLabel: string): string {
  const lines: string[] = [];

  lines.push("[STATE — ground your answer in these facts. Do not invent participants, schedules, or actions not listed here.]");
  lines.push("");
  lines.push(`Today: ${todayLabel}`);
  lines.push("");

  // Phone is optional. It helps auto-link when someone adds the caller
  // by number, but most contacts don't use Telegram. Don't nag — if they
  // share it organically (e.g. via Telegram contact card), save it. Never
  // ask for it unprompted or gatekeep features on it.
  if (!snapshot.user.phone && snapshot.user.name) {
    lines.push(`Note: no phone on file for ${snapshot.user.name}. This is fine — phone only helps auto-link if someone adds them by number. Don't ask for it.`);
    lines.push("");
  }

  // Calendar connection status — the product is calendar-first. When a
  // meetup is agreed, book_meetup creates real Google Calendar events for
  // everyone connected. Unconnected users can't get events booked on their
  // calendar, so nudge them toward /connect when the topic turns to booking.
  if (!snapshot.callerCalendarConnected && snapshot.user.name) {
    lines.push(`Google Calendar: NOT connected for this caller. When the conversation becomes about booking a real meetup, point them at /connect so meetups actually land on their calendar. Don't nag if they're not booking anything yet.`);
    lines.push("");
  } else if (snapshot.callerCalendarConnected) {
    lines.push("Google Calendar: ✓ connected — book_meetup will create real events here.");
    lines.push("");
  }

  // Caller profile
  lines.push(...formatUserSection(snapshot.user, snapshot.timezone));
  lines.push("");

  // People the caller has told the bot about (owner-scoped)
  if (snapshot.personNotes.length > 0) {
    lines.push(...formatPersonNotesSection(snapshot.personNotes, snapshot.timezone));
    lines.push("");
  }

  // Shared-hub model: no session section. Contacts + their schedules are
  // already rendered by formatPersonNotesSection. The caller's own schedule
  // is rendered in formatUserSection.

  // Recent history
  if (snapshot.recentHistory.length > 0) {
    lines.push("");
    lines.push("[RECENT HISTORY — last 12 messages, oldest first]");
    for (const msg of snapshot.recentHistory) {
      const who = msg.role === "user" ? "User" : "Bot";
      // Trim long messages so the snapshot stays under ~2k tokens total
      const text = msg.message.length > 500 ? msg.message.slice(0, 500) + "…" : msg.message;
      lines.push(`${who}: ${text}`);
    }
  }

  return lines.join("\n");
}

function formatUserSection(user: UserProfile, timezone: string): string[] {
  const lines: string[] = [];
  const name = user.name ?? "(no name yet — ask the user what to call them)";
  const lang = user.preferred_language ?? "en";
  lines.push(`You are talking to: ${name}`);
  lines.push(`  Language: ${lang} — always reply in this language.`);
  lines.push(`  Timezone: ${timezone}`);
  if (user.phone) lines.push(`  Phone: ${user.phone}`);
  if (user.context && user.context.trim()) {
    const ctx = user.context.slice(0, 600).replace(/\n/g, " · ");
    lines.push(`  Accumulated facts: ${ctx}`);
  }
  if (user.latest_schedule_json) {
    const coverage = scheduleCoverageLabel(user.latest_schedule_json, timezone);
    lines.push(`  Their own schedule: ✓ UPLOADED ${coverage}`);
    lines.push(...renderShiftListCompact(user.latest_schedule_json, "    "));
  } else {
    lines.push("  Their own schedule: ✗ not uploaded yet");
  }
  return lines;
}

function formatPersonNotesSection(notes: PersonNote[], timezone: string): string[] {
  const lines: string[] = [];
  lines.push(`People the user has told you about (${notes.length}):`);
  for (const n of notes) {
    const parts: string[] = [n.name];
    parts.push(n.linked_chat_id ? "joined the bot" : "not joined yet");
    if (n.phone) parts.push(`phone ending ${n.phone.slice(-4)}`);
    if (n.schedule_json) {
      const coverage = scheduleCoverageLabel(n.schedule_json, timezone);
      parts.push(`schedule: ✓ UPLOADED ${coverage}`);
    } else {
      parts.push("schedule: ✗ not uploaded");
    }
    if (n.notes) {
      const trimmed = n.notes.slice(0, 200).replace(/\n/g, " · ");
      parts.push(`notes: ${trimmed}`);
    }
    lines.push(`  - ${parts.join(" — ")}`);
    if (n.schedule_json) {
      const shiftLines = renderShiftListCompact(n.schedule_json, "      ");
      lines.push(...shiftLines);
    }
  }
  return lines;
}

/**
 * Returns a compact label like "(covers through Sat 26 Apr)" or
 * "(STALE — schedule ends Sat 19 Apr, today is Wed 16 Apr)".
 * Helps Claude caveat stale data naturally without a rigid template.
 */
function scheduleCoverageLabel(scheduleJson: string, timezone: string): string {
  try {
    const shifts = JSON.parse(scheduleJson) as Array<{ date: string }>;
    if (!Array.isArray(shifts) || shifts.length === 0) return "";
    const dates = shifts.map((s) => s.date).filter(Boolean).sort();
    const lastDate = dates[dates.length - 1];
    if (!lastDate) return "";
    const now = new Date();
    const todayParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const todayIso = `${todayParts.find((p) => p.type === "year")!.value}-${todayParts.find((p) => p.type === "month")!.value}-${todayParts.find((p) => p.type === "day")!.value}`;
    const d = new Date(lastDate + "T12:00:00Z");
    const label = d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    if (lastDate < todayIso) {
      return `(⚠️ STALE — last entry is ${label}, which is in the past. Data may be outdated — ask the user to re-upload if you need current info.)`;
    }
    return `(covers through ${label})`;
  } catch {
    return "";
  }
}

/**
 * Parse a stored schedule_json blob and return a compact, human-readable
 * shift list for inclusion in the [STATE] block. Lets Claude answer
 * personal-availability questions like "am I free at 10am tomorrow?"
 * directly from the snapshot — no extra tool call needed.
 *
 * Format: one line per shift, "Mon 30 Mar  15:00–00:00" (or "OFF" for
 * 00:00–00:00 fully-free placeholders). Capped at 35 entries to keep
 * the snapshot from blowing up on multi-month rotas.
 */
function renderShiftListCompact(scheduleJson: string, indent: string): string[] {
  let shifts: Array<{ date: string; start_time: string; end_time: string; label?: string }> = [];
  try {
    const parsed = JSON.parse(scheduleJson);
    if (Array.isArray(parsed)) shifts = parsed;
  } catch {
    return [`${indent}(schedule data unparseable)`];
  }
  if (shifts.length === 0) return [];
  const out: string[] = [];
  out.push(`${indent}shifts:`);
  const MAX = 35;
  const display = shifts.slice(0, MAX);
  for (const s of display) {
    const d = new Date(s.date + "T12:00:00Z");
    const dayName = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const dayNum = d.getUTCDate();
    const monthName = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    // Three canonical day-shapes (see turn-handler.ts encoding rules):
    //   00:00–00:00 → OFF/free (matcher: fully free)
    //   00:00–23:59 → busy all day; show the label (hectic / volunteer / etc.)
    //   anything else → a partial busy window
    const isOff = s.start_time === "00:00" && s.end_time === "00:00";
    const isAllDayBusy = s.start_time === "00:00" && s.end_time === "23:59";
    let time: string;
    if (isOff) {
      time = s.label ? `OFF (${s.label})` : "OFF";
    } else if (isAllDayBusy) {
      time = (s.label ?? "busy all day").toUpperCase();
    } else {
      // Partial busy window — include the label so Claude can tell the
      // caller "Kurt's walking the dog Sunday morning", not just "busy".
      time = s.label ? `${s.start_time}–${s.end_time} (${s.label})` : `${s.start_time}–${s.end_time}`;
    }
    out.push(`${indent}  ${dayName} ${dayNum} ${monthName}  ${time}`);
  }
  if (shifts.length > MAX) {
    out.push(`${indent}  …and ${shifts.length - MAX} more shifts`);
  }
  return out;
}


/**
 * Compute "today" in the user's timezone as a human-readable label,
 * e.g. "Saturday, 2026-04-11". The turn handler uses the same value
 * for the system prompt and the snapshot so all date references agree.
 */
export function todayInTimezone(timezone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Monday";
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  // Include wall-clock time so Claude can resolve "in 2 minutes" / "tomorrow 6am"
  // against real now, not just the date.
  return `${weekday}, ${y}-${m}-${d} ${hh}:${mm}`;
}
