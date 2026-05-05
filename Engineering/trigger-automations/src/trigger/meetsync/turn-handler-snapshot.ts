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
  if (snapshot.callerCalendarTokenInvalid) {
    lines.push(`Google Calendar: ✗ token expired (OAuth grant invalid). Events and free/busy data for this caller are NOT available until they run /connect again. Tell the user honestly if they ask about their calendar.`);
    lines.push("");
  } else if (snapshot.callerCalendarRefreshFailing) {
    lines.push(`Google Calendar: ⚠ bot's runtime can't refresh the caller's OAuth token right now (server-side config issue, NOT user's fault). Their /connect is fine — but the bot can't read or write Calendar this turn. Tell them honestly if they ask: "I can't reach your Calendar right now — there's a server-side wiring issue on my end, not your account." Do NOT say "connected" or claim events were booked.`);
    lines.push("");
  } else if (!snapshot.callerCalendarConnected && snapshot.user.name) {
    lines.push(`Google Calendar: NOT connected for this caller. When the conversation becomes about booking a real meetup, point them at /connect so meetups actually land on their calendar. Don't nag if they're not booking anything yet.`);
    lines.push("");
  } else if (snapshot.callerCalendarConnected) {
    lines.push("Google Calendar: ✓ connected — book_meetup will create real events here.");
    lines.push("");
  }

  if (snapshot.calendarDegraded) {
    lines.push("Google Calendar: ⚠ read partially failed this turn — some events may be missing from [STATE]. If the user asks about a specific appointment you can't see, say so honestly rather than asserting they're free.");
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
  //
  // Recent history is no longer rendered as a flat text block here. As of
  // the multi-turn fix, the turn handler passes prior conversation_log
  // entries to Claude as proper user/assistant messages in the messages[]
  // array — the way Claude.ai natively passes context. Flat-text "User: X
  // / Bot: Y" narrative was getting truncated at 500 chars per message and
  // collapsed into a single user turn, which Claude couldn't pattern-match
  // against. See turn-handler.ts buildMessagesArray.

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
 * Format: one line per DATE (not per shift). If a date carries multiple
 * entries (e.g. an OFF marker + a gym block, or a split shift), they're
 * merged into one line: "Mon 4 May  OFF + 18:00–19:00 (gym)". This avoids
 * the previous bug where the same date would render as two contradictory
 * lines (one OFF, one busy) and Claude had to guess which to trust.
 * Capped at 35 dates to keep the snapshot from blowing up on multi-month
 * rotas.
 */
// Active window for snapshot rendering. The full schedule history lives
// in users.latest_schedule_json forever (per-date merge, no pruning), but
// rendering EVERY past+future entry every turn balloons the snapshot text
// over time and burns tokens for data the user usually isn't asking
// about. So [STATE] surfaces today−WINDOW_DAYS_BACK → today+WINDOW_DAYS_FORWARD
// inline, and Claude calls query_schedule_history for anything outside.
const WINDOW_DAYS_BACK = 14;
const WINDOW_DAYS_FORWARD = 60;

function isoDateWithOffset(daysOffset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

function renderShiftListCompact(scheduleJson: string, indent: string): string[] {
  let shifts: Array<{ date: string; start_time: string; end_time: string; label?: string }> = [];
  try {
    const parsed = JSON.parse(scheduleJson);
    if (Array.isArray(parsed)) shifts = parsed;
  } catch {
    return [`${indent}(schedule data unparseable)`];
  }
  if (shifts.length === 0) return [];

  // Group all entries by date so a date with OFF + activity (or a split
  // shift across two windows) renders on one line, not two contradictory
  // ones. Preserve insertion order within each date so labels stay stable.
  const byDate = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  const allDates = Array.from(byDate.keys()).sort();

  // Today anchor — UTC ISO. Used to insert a "── today ──" divider so
  // Claude can distinguish past vs upcoming dates at a glance and won't
  // count past off days when answering "how many off days do I have left
  // this week". Computed in UTC for stable comparison against ISO date
  // strings; the +/-1 day fuzz from timezone is acceptable here (the
  // divider is a visual hint, not a strict cutoff).
  const todayIso = new Date().toISOString().slice(0, 10);
  const windowStart = isoDateWithOffset(-WINDOW_DAYS_BACK);
  const windowEnd = isoDateWithOffset(WINDOW_DAYS_FORWARD);

  // Window the render to the active range. Out-of-window dates are still
  // in D1 and reachable via query_schedule_history; we just don't pay the
  // tokens to inline them every turn. Count what's hidden so Claude can
  // tell the user "I have N older / M further dates on file too".
  const dates = allDates.filter((d) => d >= windowStart && d <= windowEnd);
  const hiddenBefore = allDates.filter((d) => d < windowStart).length;
  const hiddenAfter = allDates.filter((d) => d > windowEnd).length;
  const earliestStored = allDates[0];
  const latestStored = allDates[allDates.length - 1];

  const out: string[] = [];
  out.push(`${indent}shifts (active window ${windowStart} → ${windowEnd}):`);

  // Surface hidden-date counts up-front so Claude doesn't say "I don't have
  // that on file" for older/further dates that DO exist in storage.
  if (hiddenBefore > 0) {
    out.push(`${indent}  …${hiddenBefore} older date(s) on file (earliest ${earliestStored}) — call query_schedule_history if asked`);
  }
  if (hiddenAfter > 0) {
    out.push(`${indent}  …${hiddenAfter} further-future date(s) on file (latest ${latestStored}) — call query_schedule_history if asked`);
  }

  if (dates.length === 0) {
    // All entries are outside the window. Still emit the today divider so
    // Claude sees the orientation and knows nothing upcoming-soon is on file.
    out.push(`${indent}  ── today (${todayIso}) — nothing in the active window ──`);
    return out;
  }

  const MAX = 35;
  const displayDates = dates.slice(0, MAX);
  let dividerInserted = false;
  for (const date of displayDates) {
    if (!dividerInserted && date >= todayIso) {
      out.push(`${indent}  ── today (${todayIso}) ──`);
      dividerInserted = true;
    }
    const d = new Date(date + "T12:00:00Z");
    const dayName = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const dayNum = d.getUTCDate();
    const monthName = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const entries = byDate.get(date)!;
    out.push(`${indent}  ${dayName} ${dayNum} ${monthName}  ${formatDayEntries(entries)}`);
  }
  // Edge case: all dates within the window are in the past — emit the
  // divider at the bottom so Claude sees that nothing upcoming is on file.
  if (!dividerInserted) {
    out.push(`${indent}  ── today (${todayIso}) — nothing upcoming on file ──`);
  }
  if (dates.length > MAX) {
    out.push(`${indent}  …and ${dates.length - MAX} more dates inside the window`);
  }
  return out;
}

/**
 * Format the entries for a single date into one human-readable string.
 *
 * Day-shapes (see turn-handler.ts encoding rules):
 *   00:00–00:00          → OFF / free
 *   00:00–23:59          → busy all day (hectic / volunteer / work / etc.)
 *   anything else        → partial busy window
 *
 * When a date carries an OFF entry alongside one or more partial-busy
 * entries (e.g. "Mon off, gym 18:00–19:00"), render as
 * "OFF + 18:00–19:00 (gym)" — the OFF prefix preserves the off-from-work
 * semantic, the partials preserve the actual blocked time. Two split
 * shifts on a busy day render comma-separated: "12:00–14:00 (HK), 14:00–17:00 (Deliveries)".
 */
function formatDayEntries(entries: Array<{ start_time: string; end_time: string; label?: string }>): string {
  const isOff = (s: { start_time: string; end_time: string }) => s.start_time === "00:00" && s.end_time === "00:00";
  const isAllDayBusy = (s: { start_time: string; end_time: string }) => s.start_time === "00:00" && s.end_time === "23:59";

  const offEntries = entries.filter(isOff);
  const allDayBusy = entries.find(isAllDayBusy);
  const partials = entries.filter((s) => !isOff(s) && !isAllDayBusy(s));

  // All-day-busy dominates everything else on the same date — if both an
  // OFF and a hectic-all-day are stored, the all-day-busy wins (it's the
  // stronger signal). Should be rare; happens if a stale upload conflicts.
  if (allDayBusy) {
    return (allDayBusy.label ?? "busy all day").toUpperCase();
  }

  const renderPartial = (s: { start_time: string; end_time: string; label?: string }) =>
    s.label ? `${s.start_time}–${s.end_time} (${s.label})` : `${s.start_time}–${s.end_time}`;

  // OFF + activities → "OFF + 18:00–19:00 (gym)" on one line.
  if (offEntries.length > 0 && partials.length > 0) {
    const offLabel = offEntries[0].label && offEntries[0].label.toLowerCase() !== "off"
      ? `OFF (${offEntries[0].label})`
      : "OFF";
    return `${offLabel} + ${partials.map(renderPartial).join(", ")}`;
  }

  // OFF only.
  if (offEntries.length > 0) {
    const label = offEntries[0].label;
    return label && label.toLowerCase() !== "off" ? `OFF (${label})` : "OFF";
  }

  // Partials only — comma-separate split shifts.
  return partials.map(renderPartial).join(", ");
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
