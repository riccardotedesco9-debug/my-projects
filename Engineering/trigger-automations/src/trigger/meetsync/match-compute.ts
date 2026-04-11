// Match compute — finds overlapping free time between two participants

import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { query, getSessionParticipants, getPersonNotesForOwner } from "./d1-client.js";

const payloadSchema = z.object({
  session_id: z.string(),
});

interface TimeBlock {
  start: number; // minutes since midnight
  end: number;
}

interface ParsedShift {
  date: string;
  start_time: string;
  end_time: string;
}

// Runtime schema for stored schedule_json — same shape as
// schedule-parser's parsedShiftSchema but loosened on optional fields.
// Used to validate D1-stored JSON before computing matches, so a
// corrupted row fails loudly instead of silently returning [] and
// reporting "no overlap" to the user.
const storedShiftSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
}).passthrough();
const storedScheduleSchema = z.array(storedShiftSchema);

// Reasonable free time window (8am-10pm)
const DAY_START = 8 * 60; // 08:00
const DAY_END = 22 * 60; // 22:00
const MIN_BLOCK_MINUTES = 120; // 2 hours minimum

export const matchCompute = schemaTask({
  id: "meetsync-match-compute",
  schema: payloadSchema,
  maxDuration: 30,

  run: async (payload) => {
    const { session_id } = payload;

    const participants = await getSessionParticipants(session_id);

    // Also pull schedule-on-behalf entries from person_notes — people the
    // creator uploaded schedules for without waiting for them to join. We
    // look up by the session creator's chat_id and include any person_notes
    // rows with schedule_json that are NOT already linked to a participant
    // (the linked ones would double-count).
    //
    // The session creator's chat_id is whichever participant has role='creator'.
    const creator = participants.find((p) => p.role === "creator");
    const onBehalfSchedules: Array<{ id: string; schedule_json: string | null }> = [];
    if (creator) {
      const notes = await getPersonNotesForOwner(creator.chat_id);
      for (const note of notes) {
        if (!note.schedule_json) continue;
        // Skip if already merged into a real participant (linked_chat_id
        // matches a participant.chat_id). Prevents counting the same
        // person twice after they've joined the bot.
        const alreadyParticipant = note.linked_chat_id
          && participants.some((p) => p.chat_id === note.linked_chat_id);
        if (alreadyParticipant) continue;
        onBehalfSchedules.push({
          id: `on-behalf:${note.id}`,
          schedule_json: note.schedule_json,
        });
      }
    }

    const totalPeople = participants.length + onBehalfSchedules.length;
    if (totalPeople < 2) {
      throw new Error(`Need at least 2 schedules, found ${totalPeople}`);
    }

    // Parse all schedules — participants + on-behalf. Passing an id so the
    // Zod error path can name the row in logs (round-10 code review fix #8).
    const allSchedules = [
      ...participants.map((p) => parseSchedule(p.schedule_json, p.id)),
      ...onBehalfSchedules.map((o) => parseSchedule(o.schedule_json, o.id)),
    ];

    // Find the overlapping date range across ALL schedules
    const ranges = allSchedules.map(getDateRange).filter((r): r is { start: string; end: string } => r !== null);

    if (ranges.length < 2) {
      return { slot_count: 0, slots: [] };
    }

    // Overlap = latest start to earliest end across all schedules
    const overlapStart = ranges.reduce((max, r) => r.start > max ? r.start : max, ranges[0].start);
    const overlapEnd = ranges.reduce((min, r) => r.end < min ? r.end : min, ranges[0].end);

    if (overlapStart > overlapEnd) {
      return { slot_count: 0, slots: [] };
    }

    // Build the set of all dates within the overlapping range (including weekends)
    const allDates = new Set<string>();
    const start = new Date(overlapStart + "T12:00:00Z");
    const end = new Date(overlapEnd + "T12:00:00Z");
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      allDates.add(d.toISOString().split("T")[0]);
    }

    const freeSlots: Array<{
      day: string;
      day_name: string;
      start_time: string;
      end_time: string;
      duration_minutes: number;
      explanation: string;
    }> = [];

    for (const date of [...allDates].sort()) {

      // N-way intersection: get each person's free time, then intersect all
      const allFreeBlocks = allSchedules.map((schedule) => getFreeTime(schedule, date));
      const allShiftsForDay = allSchedules.flatMap((schedule) => schedule.filter((s) => s.date === date));

      // Reduce: intersect free time across all participants
      const overlap = allFreeBlocks.reduce((acc, blocks) => intersectBlocks(acc, blocks));

      for (const block of overlap) {
        const duration = block.end - block.start;
        if (duration >= MIN_BLOCK_MINUTES) {
          freeSlots.push({
            day: date,
            day_name: new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
            start_time: minutesToTime(block.start),
            end_time: minutesToTime(block.end),
            duration_minutes: duration,
            explanation: explainSlotN(block, allShiftsForDay),
          });
        }
      }
    }

    // Sort chronologically (by date, then by start time)
    freeSlots.sort((a, b) => {
      const dateCompare = a.day.localeCompare(b.day);
      if (dateCompare !== 0) return dateCompare;
      return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
    });

    // Store ALL qualifying slots (no cap — show the full picture)
    const allSlots = freeSlots;

    // Clear existing slots for this session
    await query("DELETE FROM free_slots WHERE session_id = ?", [session_id]);

    for (let i = 0; i < allSlots.length; i++) {
      const slot = allSlots[i];
      await query(
        "INSERT INTO free_slots (id, session_id, slot_number, day, day_name, start_time, end_time, duration_minutes, explanation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          crypto.randomUUID(),
          session_id,
          i + 1,
          slot.day,
          slot.day_name,
          slot.start_time,
          slot.end_time,
          slot.duration_minutes,
          slot.explanation,
        ]
      );
    }

    return { slot_count: allSlots.length, slots: allSlots };
  },
});

// --- Time utilities ---

/** Generate a brief human-readable explanation for why a free slot exists */
function explainSlotN(block: TimeBlock, allShifts: ParsedShift[]): string {
  if (allShifts.length === 0) return "everyone has the day off";

  const latestEnd = Math.max(...allShifts.map((s) => timeToMinutes(s.end_time)));
  const earliestStart = Math.min(...allShifts.map((s) => timeToMinutes(s.start_time)));

  if (block.start >= latestEnd) {
    return `all free after ${minutesToTime(latestEnd)}`;
  }
  if (block.end <= earliestStart) {
    return "free morning before shifts start";
  }

  return "gap between shifts";
}

function getDateRange(shifts: ParsedShift[]): { start: string; end: string } | null {
  if (shifts.length === 0) return null;
  const dates = shifts.map((s) => s.date).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

function parseSchedule(json: string | null, participantId?: string): ParsedShift[] {
  if (!json) return [];

  // Round-7 fix: the previous implementation silently returned [] on any
  // parse error, so corrupted schedule_json in D1 would flow through
  // match-compute as "no free time" without any signal to the logs. Now
  // we log-loud on both JSON.parse and Zod validation failures so a
  // malformed row can actually be diagnosed.
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    console.error(
      `[match-compute] schedule_json JSON.parse failed${participantId ? ` for participant ${participantId}` : ""}. Raw (first 300): ${json.slice(0, 300)}`
    );
    return [];
  }

  const validated = storedScheduleSchema.safeParse(raw);
  if (!validated.success) {
    console.error(
      `[match-compute] schedule_json schema validation failed${participantId ? ` for participant ${participantId}` : ""}. Issues: ${JSON.stringify(validated.error.issues.slice(0, 5))}. Raw (first 300): ${json.slice(0, 300)}`
    );
    return [];
  }

  return validated.data as ParsedShift[];
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Add N days to a YYYY-MM-DD string (can be negative). UTC-safe. */
function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().split("T")[0];
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** Get free time blocks for a person on a given date (within DAY_START-DAY_END).
 *  Handles overnight shifts (end < start, e.g. 22:00-06:00) by splitting them
 *  into (a) a late block on the shift-start date going to end-of-day and
 *  (b) an early block on the following date starting at 00:00. Without this,
 *  night-shift workers appear free during their entire sleep window. */
function getFreeTime(schedule: ParsedShift[], date: string): TimeBlock[] {
  const prevDate = shiftDate(date, -1);
  const workBlocks: TimeBlock[] = [];
  for (const s of schedule) {
    const start = timeToMinutes(s.start_time);
    const end = timeToMinutes(s.end_time);
    const overnight = end < start && !(start === 0 && end === 0);

    if (s.date === date) {
      if (overnight) {
        // Shift starts today, ends tomorrow — today is busy from start to midnight
        workBlocks.push({ start, end: 24 * 60 });
      } else {
        workBlocks.push({ start, end });
      }
    } else if (s.date === prevDate && end < start && !(start === 0 && end === 0)) {
      // Yesterday's overnight shift spills into today from 00:00 to end
      workBlocks.push({ start: 0, end });
    }
  }
  workBlocks.sort((a, b) => a.start - b.start);

  // If no work on this day, the entire day is free
  if (workBlocks.length === 0) {
    return [{ start: DAY_START, end: DAY_END }];
  }

  // Compute gaps between work blocks within the day window
  const free: TimeBlock[] = [];
  let cursor = DAY_START;

  for (const block of workBlocks) {
    const blockStart = Math.max(block.start, DAY_START);
    const blockEnd = Math.min(block.end, DAY_END);

    if (cursor < blockStart) {
      free.push({ start: cursor, end: blockStart });
    }
    cursor = Math.max(cursor, blockEnd);
  }

  if (cursor < DAY_END) {
    free.push({ start: cursor, end: DAY_END });
  }

  return free;
}

/** Compute free-time slots for a single person's schedule (for mediated mode) */
export function computeSinglePersonSlots(scheduleJson: string | null): Array<{
  day: string;
  day_name: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
}> {
  const schedule = parseSchedule(scheduleJson);
  if (schedule.length === 0) return [];

  const range = getDateRange(schedule);
  if (!range) return [];

  const slots: Array<{
    day: string;
    day_name: string;
    start_time: string;
    end_time: string;
    duration_minutes: number;
  }> = [];

  const today = new Date().toISOString().split("T")[0];
  const start = new Date(range.start + "T12:00:00Z");
  const end = new Date(range.end + "T12:00:00Z");

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().split("T")[0];
    if (date < today) continue; // skip past dates
    const freeBlocks = getFreeTime(schedule, date);

    for (const block of freeBlocks) {
      const duration = block.end - block.start;
      if (duration >= MIN_BLOCK_MINUTES) {
        slots.push({
          day: date,
          day_name: new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
          start_time: minutesToTime(block.start),
          end_time: minutesToTime(block.end),
          duration_minutes: duration,
        });
      }
    }
  }

  return slots;
}

/** Find intersection of two sets of time blocks */
function intersectBlocks(blocksA: TimeBlock[], blocksB: TimeBlock[]): TimeBlock[] {
  const result: TimeBlock[] = [];
  let i = 0;
  let j = 0;

  while (i < blocksA.length && j < blocksB.length) {
    const start = Math.max(blocksA[i].start, blocksB[j].start);
    const end = Math.min(blocksA[i].end, blocksB[j].end);

    if (start < end) {
      result.push({ start, end });
    }

    // Advance the pointer with the earlier end time
    if (blocksA[i].end < blocksB[j].end) {
      i++;
    } else {
      j++;
    }
  }

  return result;
}
