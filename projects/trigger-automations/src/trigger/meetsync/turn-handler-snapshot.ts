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

import { parseScheduleBlob, type Snapshot, type UserProfile, type PersonNote } from "./d1-client.js";

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
    lines.push(...renderShiftListCompact(user.latest_schedule_json, "    ", timezone));
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
      const shiftLines = renderShiftListCompact(n.schedule_json, "      ", timezone);
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
  const shifts = parseScheduleBlob(scheduleJson);
  if (!shifts || shifts.length === 0) return "";
  try {
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

// Group all entries by date so a date with OFF + activity (or a split
// shift across two windows) renders on one line, not two contradictory
// ones. Preserve insertion order within each date so labels stay stable.
function groupShiftsByDate<T extends { date: string }>(shifts: T[]): Map<string, T[]> {
  const byDate = new Map<string, T[]>();
  for (const s of shifts) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  return byDate;
}

// Build the per-date schedule lines (with a "today" divider) shared by the
// internal [STATE] block and the user-facing display. The divider lets
// the reader distinguish past vs upcoming dates at a glance. `dates` is
// already filtered to the desired range (and, for [STATE], already capped);
// this just formats each one. Returns lines WITHOUT indent — callers add
// their own prefix.
function buildScheduleDateLines<T extends { start_time: string; end_time: string; label?: string }>(
  byDate: Map<string, T[]>,
  dates: string[],
  todayIso: string,
  timezone: string,
  display: boolean,
): string[] {
  const out: string[] = [];
  if (dates.length === 0) {
    out.push(`── today (${todayIso}) — nothing in the active window ──`);
    return out;
  }
  let dividerInserted = false;
  let lastMonth = "";
  for (const date of dates) {
    // Month band (display only) before each new month's first date, so the
    // caller can tell months apart at a glance. Not emitted in [STATE].
    if (display) {
      const ym = date.slice(0, 7);
      if (ym !== lastMonth) {
        const monthLong = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
        out.push(`──────── ${monthLong} ────────`);
        lastMonth = ym;
      }
    }
    if (!dividerInserted && date >= todayIso) {
      out.push(`── today (${todayIso}) ──`);
      dividerInserted = true;
    }
    const d = new Date(date + "T12:00:00Z");
    const dayName = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const dayNum = d.getUTCDate();
    const monthName = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const entries = byDate.get(date)!;
    const holiday = timezone === "Europe/Malta" ? maltaHolidayName(date) : null;
    const rawEntries = formatDayEntries(entries, holiday, { display });
    // Glue emojis to their text (display only) so a Telegram wrap can't orphan them.
    const entriesStr = display ? glueEmojiToText(rawEntries) : rawEntries;
    if (display) {
      // Fixed-width date + a "│" column separates the day from its entries so
      // the schedule scans cleanly. padStart(2) on the day number keeps the
      // "│" aligned across single- and double-digit dates.
      const dateLabel = `${dayName} ${String(dayNum).padStart(2)} ${monthName}`;
      out.push(`${dateLabel} │ ${entriesStr}`);
    } else {
      out.push(`${dayName} ${dayNum} ${monthName}  ${entriesStr}`);
    }
  }
  // Edge case: every rendered date is in the past — emit the divider at the
  // bottom so the reader sees that nothing upcoming is on file.
  if (!dividerInserted) {
    out.push(`── today (${todayIso}) — nothing upcoming on file ──`);
  }
  return out;
}

// [STATE] schedule view: windowed (today−14d → today+60d) and capped at 35
// dates to keep routine turns cheap. Out-of-window / over-cap dates are
// still in D1 and reachable via query_schedule_history (prose Q&A) or the
// deterministic show_schedule path (full display). The hidden-date hint
// lines tell Claude what exists beyond the window.
function renderShiftListCompact(scheduleJson: string, indent: string, timezone: string): string[] {
  const shifts = parseScheduleBlob(scheduleJson);
  if (!shifts) return [`${indent}(schedule data unparseable)`];
  if (shifts.length === 0) return [];

  const byDate = groupShiftsByDate(shifts);
  const allDates = Array.from(byDate.keys()).sort();

  // Today anchor — UTC ISO, stable for comparison against ISO date strings;
  // the +/-1 day fuzz from timezone is acceptable here (the divider is a
  // visual hint, not a strict cutoff).
  const todayIso = new Date().toISOString().slice(0, 10);
  const windowStart = isoDateWithOffset(-WINDOW_DAYS_BACK);
  const windowEnd = isoDateWithOffset(WINDOW_DAYS_FORWARD);

  // Window the render to the active range. Out-of-window dates are still in
  // D1 and reachable via query_schedule_history / show_schedule; we just
  // don't pay the tokens to inline them every turn. Count what's hidden so
  // Claude can tell the user "I have N older / M further dates on file too".
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

  const MAX = 35;
  const displayDates = dates.slice(0, MAX);
  for (const line of buildScheduleDateLines(byDate, displayDates, todayIso, timezone, false)) {
    out.push(`${indent}  ${line}`);
  }
  if (dates.length > MAX) {
    out.push(`${indent}  …and ${dates.length - MAX} more dates inside the window`);
  }
  return out;
}

/**
 * Render the caller's schedule for USER-FACING display (the "Schedule"
 * command). Unlike the [STATE] view this is NOT capped and has no forward
 * window: it shows from TODAY through the LAST stored date, so the user
 * sees their whole upcoming schedule (no past days). The lines are produced
 * deterministically here (group-by-date, OFF+activity merge, holiday tags,
 * sensitive-label redaction) so the user-facing schedule is never a lossy
 * LLM transcription — the failure mode where an entry silently vanished
 * from one render. Returns un-indented lines; the caller wraps them in a
 * code block. Empty array = no schedule on file.
 */
export function renderScheduleForDisplay(scheduleJson: string | null, timezone: string): string[] {
  if (!scheduleJson) return [];
  const shifts = parseScheduleBlob(scheduleJson);
  if (!shifts) return ["(schedule data unparseable)"];
  if (shifts.length === 0) return [];

  const byDate = groupShiftsByDate(shifts);
  const allDates = Array.from(byDate.keys()).sort();
  // Anchor on the caller's real local "today" (tz-correct, no UTC drift).
  const todayIso = todayIsoInTimezone(timezone);
  // Start from TODAY (no past days) through the latest stored date — no
  // 60-day cap, no 35-date cap. The caller wants what's coming up, not history.
  const dates = allDates.filter((d) => d >= todayIso);
  return buildScheduleDateLines(byDate, dates, todayIso, timezone, true);
}

/**
 * Render a multi-person availability grid for USER-FACING display (the
 * "who's free" / "show everyone's availability" command). Groups by DATE
 * with ━━━ dividers; each person's day-shape is rendered deterministically
 * via the same formatter as the personal schedule (work → 💼, OFF+activity
 * merge, sensitive-label redaction), so the grid can never silently drop a
 * person or an entry the way an LLM transcription could. Names are left-
 * padded to align. People with no entry on a date show "—". `people`
 * schedules should already be calendar-enriched by the snapshot. Returns
 * un-indented lines; the caller wraps them in a code block. Empty array =
 * nobody has anything in the window.
 */
export function renderAvailabilityBlock(
  people: Array<{ name: string; scheduleJson: string | null }>,
  timezone: string,
  windowDaysForward = 21,
): string[] {
  const todayIso = todayIsoInTimezone(timezone);
  const windowEnd = isoDateOffset(todayIso, windowDaysForward);

  const perPerson = people.map((p) => ({
    name: p.name,
    byDate: groupShiftsByDate(parseScheduleBlob(p.scheduleJson) ?? []),
  }));

  // Union of all dates anyone has inside [today, windowEnd].
  const dateSet = new Set<string>();
  for (const p of perPerson) {
    for (const d of p.byDate.keys()) {
      if (d >= todayIso && d <= windowEnd) dateSet.add(d);
    }
  }
  const dates = Array.from(dateSet).sort();
  if (dates.length === 0) return [];

  const nameWidth = Math.max(...perPerson.map((p) => p.name.length));
  const out: string[] = [];
  for (const date of dates) {
    const d = new Date(date + "T12:00:00Z");
    const dayName = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const dayNum = d.getUTCDate();
    const monthName = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    out.push(`━━━ ${dayName} ${dayNum} ${monthName} ━━━`);
    const holiday = timezone === "Europe/Malta" ? maltaHolidayName(date) : null;
    for (const p of perPerson) {
      const entries = p.byDate.get(date);
      const shape = entries && entries.length > 0
        ? glueEmojiToText(formatDayEntries(entries, holiday, { display: true }))
        : "—";
      out.push(` ${p.name.padEnd(nameWidth)}  ${shape}`);
    }
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
// Sensitive label patterns — when an entry's label matches one of these,
// the rendered [STATE] line shows "(appointment)" instead of the real
// label so the caller can safely share a schedule screenshot without
// revealing private medical / mental-health / recovery / legal / job-
// hunting info to a colleague. The original label remains untouched in
// D1 and Google Calendar — only the rendered output is abstracted.
// Everyday things (gym, mobility, yoga, dinner, drinks, dentist, hair,
// optometrist, work shifts, named meetups) stay visible.
const SENSITIVE_LABEL_PATTERNS: RegExp[] = [
  // Mental health & talk therapy
  /therap(y|ist)/i,                        // therapy, therapist, psychotherapy
  /\bpsych/i,                              // psychiatrist, psychologist, psychiatric, psychotherapy
  /counsel(l)?(or|ling|ing)/i,             // counsellor, counselling, counseling
  /\bdepress(ion|ed)?\b/i,
  /\banxiety\b/i,
  /\bPTSD\b|\bOCD\b|\bADHD\b|\bADD\b/i,
  /bipolar/i,
  /mental\s*health/i,
  /breakdown/i,
  /support\s*group/i,

  // Medical specialists (specialist visit usually implies a specific concern)
  /gastro(enterolog)?/i,                   // gastro, gastroenterology
  /cardiolog/i,
  /neurolog/i,
  /dermatolog/i,
  /oncolog/i,                              // cancer
  /urolog/i,
  /gyna?ecolog/i,                          // gynaecologist, gynecologist
  /\bOB[-\s]?GYN\b|\bOBGYN\b/i,
  /endocrinolog/i,
  /rheumatolog/i,
  /pulmonolog/i,
  /\bENT\b/,                               // ear-nose-throat
  /podiatr/i,
  /allergist/i,
  /immunolog/i,
  /hematolog|haematolog/i,
  /nephrolog/i,
  /physio(therap)?/i,
  /chiropract/i,
  /osteopath/i,
  /\bdoctor\b|\bdr\.?\b/i,                 // generic doctor visits
  /\bGP\b/,                                // general practitioner

  // Medical — diagnostics / imaging
  // (blood test/work/panel deliberately NOT redacted — caller considers a
  // routine blood test fine to show by name.)
  /urine\s*(test|sample)/i,
  /\bMRI\b|\bCT\s*scan\b|\bX-?ray\b/i,
  /ultrasound|biopsy|mammogram|colonoscopy|endoscopy|gastroscopy/i,
  /\bscan\b/i,                             // medical scan
  /screening/i,
  /diagnosis/i,
  /check-?up\b/i,
  /\bswab\b/i,

  // Medical — venues / general care
  /hospital/i,
  /\bclinic\b/i,
  /\bER\b|\bA&E\b/,                        // emergency
  /surgery|operation|procedure/i,
  /pharmac(y|ist)/i,
  /prescription/i,
  /\binfusion\b/i,
  /chemo(therapy)?/i,
  /radiation\s*therapy/i,
  /dialysis/i,

  // Medication
  /\bmed(ication|s)\b/i,
  /\binsulin\b/i,
  /methadone/i,
  /antidepressant/i,
  /\bSSRIs?\b/,

  // Addiction & recovery
  /\bAA\b|\bNA\b/,                         // anonymous groups (case-sensitive)
  /\brehab\b/i,
  /\bsobriety\b|\bsober\b/i,
  /detox/i,
  /recovery\s*(meeting|group)/i,
  /\bsponsor\b.*\bmeeting\b/i,

  // Sexual & reproductive health
  /\bHIV\b|\bSTD\b|\bSTI\b/,
  /herpes|\bHPV\b/i,
  /abortion|\bIVF\b|miscarriage|fertility/i,
  /pregnan/i,
  /prenatal|antenatal|postnatal|postpartum/i,
  /contracepti|birth\s*control/i,
  /\bIUD\b|plan\s*B/i,
  /vasectomy|tubal/i,
  /sexual\s*health/i,

  // Legal — typically signals trouble
  /\blawyer\b|attorney|solicitor/i,
  /\bcourt\b/i,
  /\bhearing\b/i,                          // court hearing
  /divorce|custody|mediation/i,
  /probation|parole|\bbail\b/i,
  /bankruptcy|creditor/i,
  /restraining\s*order/i,

  // (Job-hunting terms — interview / recruiter / offer call — are deliberately
  // NOT redacted: per the caller's rule, interviews are fine to show by name.
  // Redaction is reserved for genuinely sensitive categories only.)

  // Cosmetic / body procedures
  /cosmetic\s*surgery|plastic\s*surgery/i,
  /botox|filler\b/i,
  /hair\s*transplant/i,

  // Grief / heavy personal
  /funeral|memorial/i,
  /\bestate\b|\bwill\s*reading\b/i,

  // Couples / relationship counselling
  /couples?\s*(counsel|therap)/i,
  /marriage\s*(counsel|therap)/i,

  // Spiritual / confession-style
  /confession/i,
];

function isSensitiveLabel(label: string | undefined): boolean {
  if (!label) return false;
  return SENSITIVE_LABEL_PATTERNS.some((p) => p.test(label));
}

/**
 * Return a label safe to render in shareable schedule output. If the label
 * matches a sensitive pattern, it becomes "<first letter> appointment" — e.g.
 * "G appointment" for "Gastro …", "T appointment" for "Therapy". That lets the
 * caller recognise their OWN entry at a glance while a shared screenshot still
 * doesn't spell out what it is. Caller's underlying D1 row and Google Calendar
 * event title remain unchanged — this is purely a render-time abstraction.
 */
function redactLabelForRender(label: string | undefined): string | undefined {
  if (!label) return label;
  if (!isSensitiveLabel(label)) return label;
  const initial = (label.match(/[a-z0-9]/i)?.[0] ?? "").toUpperCase();
  return initial ? `${initial} appointment` : "appointment";
}

/** A work shift, by label. Work entries render as a 💼 marker in display
 *  mode (the label — e.g. "work (office, St Julian's)" — is dropped, the
 *  marker carries the meaning). \bwork\b deliberately does NOT match
 *  "homework"/"workout" (no word boundary inside those). */
function isWorkLabel(label: string | undefined): boolean {
  if (!label) return false;
  return /\b(work|shift)\b/i.test(label);
}

/** Glue an emoji to the text right after it with a non-breaking space, so a
 *  Telegram line-wrap can never strand the emoji alone on its own line
 *  (e.g. "💼 15:00…" / "(🧘 yoga)"). Handles a trailing variation selector. */
function glueEmojiToText(s: string): string {
  return s.replace(/(\p{Extended_Pictographic}️?) /gu, "$1 ");
}

/**
 * Format the entries for a single date into one line.
 *
 * `display` toggles user-facing polish (the "Schedule" / availability
 * commands) vs. the raw [STATE] view Claude reads:
 *   - display: work shifts collapse to "💼 07:00–16:00" (label dropped),
 *     a leading "meetup: " prefix is stripped, exact-duplicate entries are
 *     collapsed. This reproduces the cleanup the LLM used to do by hand —
 *     deterministically, so nothing is ever silently dropped.
 *   - [STATE] (display=false): raw redacted labels, so Claude can still
 *     reason over "(work …)" / "(meetup: …)" when answering.
 * Sensitive-label redaction applies in BOTH modes.
 */
function formatDayEntries(
  entries: Array<{ start_time: string; end_time: string; label?: string }>,
  holidayName: string | null = null,
  opts: { display?: boolean } = {},
): string {
  const display = opts.display === true;
  const isOff = (s: { start_time: string; end_time: string }) => s.start_time === "00:00" && s.end_time === "00:00";
  const isAllDayBusy = (s: { start_time: string; end_time: string }) => s.start_time === "00:00" && s.end_time === "23:59";

  // Collapse exact-duplicate entries (same start/end/label) so a row that
  // got saved twice — e.g. a meetup busy-block plus an identical personal
  // event — renders once. Near-duplicates (different times OR labels) are
  // PRESERVED: silently merging those would be the same drop-an-entry bug
  // we're fixing, and a genuine double-booking is worth seeing.
  const seen = new Set<string>();
  const deduped = entries.filter((s) => {
    const key = `${s.start_time}|${s.end_time}|${s.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const offEntries = deduped.filter(isOff);
  const allDayBusy = deduped.find(isAllDayBusy);
  const partials = deduped.filter((s) => !isOff(s) && !isAllDayBusy(s));

  // Holiday annotation is a SUFFIX. Always wins for OFF/no-data days, but
  // never replaces existing partials. Format: "OFF (Sette Giugno 🎆) + 13:30–17:00 (cook)".
  const holidaySuffix = holidayName ? ` [${holidayName}]` : "";

  // Display-safe label: redact sensitive, then (display only) strip the
  // "meetup: " prefix book_meetup writes so it reads cleanly to the user.
  const cleanLabel = (label: string | undefined): string | undefined => {
    let safe = redactLabelForRender(label);
    if (display && safe) safe = safe.replace(/^meetup:\s*/i, "");
    return safe;
  };

  // All-day-busy dominates everything else on the same date — if both an
  // OFF and a hectic-all-day are stored, the all-day-busy wins (it's the
  // stronger signal). Should be rare; happens if a stale upload conflicts.
  if (allDayBusy) {
    if (display && isWorkLabel(allDayBusy.label)) return "💼 all day" + holidaySuffix;
    const safeLabel = cleanLabel(allDayBusy.label) ?? "busy all day";
    return safeLabel.toUpperCase() + holidaySuffix;
  }

  const renderPartial = (s: { start_time: string; end_time: string; label?: string }) => {
    if (display && isWorkLabel(s.label)) return `💼 ${s.start_time}–${s.end_time}`;
    // The label already carries any emoji Claude chose at save time — render
    // it verbatim (redacted + "meetup:"-stripped). Work is the one exception
    // above: it's bulk rota data, marked with a fixed 💼.
    const safeLabel = cleanLabel(s.label);
    return safeLabel ? `${s.start_time}–${s.end_time} (${safeLabel})` : `${s.start_time}–${s.end_time}`;
  };

  // Render timed entries in CHRONOLOGICAL order (by start time) and join the
  // whole day with " + " — e.g. "09:30–10:30 (🧘 yoga) + 💼 15:00–00:00".
  // Times are zero-padded "HH:MM", so a lexicographic sort is chronological.
  const sortedPartials = [...partials].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const partialTokens = sortedPartials.map(renderPartial);

  // OFF leads (it's the day's character) and carries the holiday tag; the
  // timed entries follow in order.
  if (offEntries.length > 0) {
    const rawOffLabel = cleanLabel(offEntries[0].label);
    const offLabel = rawOffLabel && rawOffLabel.toLowerCase() !== "off"
      ? `OFF (${rawOffLabel})`
      : "OFF";
    return [`${offLabel}${holidaySuffix}`, ...partialTokens].join(" + ");
  }

  // No OFF: just the chronological entries joined with " + ", holiday tag at
  // the end so it's clearly a meta tag, not another entry.
  if (partialTokens.length === 0) return holidaySuffix.trim();
  return partialTokens.join(" + ") + holidaySuffix;
}

/**
 * Maltese public holiday lookup. Fixed-date holidays + Good Friday (computed).
 * Returns null for non-holiday dates. Used to annotate [STATE] schedule lines
 * for Malta-timezone callers so Claude doesn't have to recall the holiday
 * calendar from training data (which led to it replacing existing entries
 * with the holiday name).
 */
function maltaHolidayName(isoDate: string): string | null {
  const md = isoDate.slice(5); // "MM-DD"
  const FIXED: Record<string, string> = {
    "01-01": "New Year's Day",
    "02-10": "Feast of St Paul 🕯️",
    "03-19": "St Joseph 🕯️",
    "03-31": "Freedom Day 🇲🇹",
    "05-01": "Workers' Day",
    "06-07": "Sette Giugno 🎆",
    "06-29": "St Peter & St Paul 🕯️",
    "08-15": "Assumption 🕯️",
    "09-08": "Our Lady of Victories 🕯️",
    "09-21": "Independence Day 🇲🇹",
    "12-08": "Immaculate Conception 🕯️",
    "12-13": "Republic Day 🇲🇹",
    "12-25": "Christmas 🎄",
  };
  if (FIXED[md]) return FIXED[md];
  // Good Friday (Western, Gregorian) — computed via Anonymous Gregorian.
  const year = Number(isoDate.slice(0, 4));
  if (Number.isFinite(year) && isoDate === goodFridayIso(year)) {
    return "Good Friday";
  }
  return null;
}

function goodFridayIso(year: number): string {
  // Anonymous Gregorian algorithm → Easter Sunday, then -2 days for Good Friday.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  // Subtract 2 days. Day arithmetic via UTC Date is safe here.
  const easter = new Date(Date.UTC(year, easterMonth - 1, easterDay));
  easter.setUTCDate(easter.getUTCDate() - 2);
  const y = easter.getUTCFullYear();
  const mo = String(easter.getUTCMonth() + 1).padStart(2, "0");
  const da = String(easter.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}


/**
 * "Today" as YYYY-MM-DD in the caller's timezone. Use this anywhere you
 * need a date anchor for calendar windowing or schedule lookups —
 * `new Date().toISOString().slice(0, 10)` is UTC and silently drifts by
 * a day for non-UTC users near midnight (Malta-evening UTC is "tomorrow"
 * UTC; Pacific-morning UTC is "yesterday" UTC).
 */
export function todayIsoInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * ISO date `daysOffset` days after `startIsoDate` (still YYYY-MM-DD).
 * Used to extend the calendar-fetch window from "today in tz" forward.
 * The arithmetic is plain UTC stride (24h × n), which is stable across
 * DST because we only care about the date string, not a wall-clock time.
 */
export function isoDateOffset(startIsoDate: string, daysOffset: number): string {
  const d = new Date(startIsoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
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
