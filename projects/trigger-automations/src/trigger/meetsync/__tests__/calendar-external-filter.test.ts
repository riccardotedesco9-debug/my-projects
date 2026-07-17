// Tests for filterExternalCalendarEvents — the guard that keeps the bot's own
// mirrored Google Calendar events (and pre-marker duplicates) from double-
// showing when calendar events are merged into a stored schedule. This is the
// spine of both "external events don't show" (Bug 1) and "it re-added my
// booking" (Bug 3): only genuinely-external events should survive the merge.
//
// No test runner is configured — run directly with tsx:
//   npx tsx src/trigger/meetsync/__tests__/calendar-external-filter.test.ts

import assert from "node:assert/strict";
import { filterExternalCalendarEvents, type CalendarBusyBlock } from "../google-calendar.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log("filterExternalCalendarEvents:");

check("drops bot-origin events, keeps external, dedupes pre-marker duplicates", () => {
  const events: CalendarBusyBlock[] = [
    // The bot's own mirror of a booked meetup — must be dropped (already in D1).
    { date: "2026-07-20", start_time: "14:00", end_time: "15:00", label: "calendar: Dinner", origin: "bot" },
    // A genuinely-external appointment — must be kept.
    { date: "2026-07-20", start_time: "16:00", end_time: "17:00", label: "calendar: Dentist", origin: "external" },
    // A pre-marker mirror (reads as external) whose tuple matches a stored
    // entry — must be dropped by the tuple fallback, despite the label diff.
    { date: "2026-07-21", start_time: "09:00", end_time: "10:00", label: "calendar: Standup", origin: "external" },
  ];
  const existing = [
    { date: "2026-07-21", start_time: "09:00", end_time: "10:00", label: "meetup: Standup" },
  ];
  const out = filterExternalCalendarEvents(events, existing);
  assert.equal(out.length, 1, "only the genuinely-new external event survives");
  assert.equal(out[0].label, "calendar: Dentist", "the surviving event is the external Dentist");
});

check("empty existing schedule keeps all external events", () => {
  const events: CalendarBusyBlock[] = [
    { date: "2026-07-22", start_time: "10:00", end_time: "11:00", label: "calendar: Physio", origin: "external" },
    { date: "2026-07-22", start_time: "00:00", end_time: "23:59", label: "all-day calendar: Holiday", origin: "external" },
  ];
  const out = filterExternalCalendarEvents(events, []);
  assert.equal(out.length, 2, "both external events kept when nothing is stored");
});

check("all-bot input yields nothing to merge", () => {
  const events: CalendarBusyBlock[] = [
    { date: "2026-07-23", start_time: "12:00", end_time: "13:00", label: "calendar: Lunch meetup", origin: "bot" },
  ];
  assert.deepEqual(filterExternalCalendarEvents(events, []), []);
});

console.log(`\n${passed} checks passed.`);
