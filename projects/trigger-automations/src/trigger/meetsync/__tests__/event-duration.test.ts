// Regression tests for the assumed-duration defaults. These guard the "bot
// asks how long it'll be every single time" friction: add_personal_event and
// book_meetup treat end_time as optional, so an omitted end_time must always
// resolve to a sane same-day window instead of erroring or bouncing the
// question back at the caller.
//
// No test runner is configured for this project — run directly with tsx:
//   npx tsx src/trigger/meetsync/__tests__/event-duration.test.ts

import assert from "node:assert/strict";
import {
  DEFAULT_EVENT_MINUTES,
  inferEventMinutes,
  defaultEndTime,
} from "../event-duration.js";

// --- inferEventMinutes: table matches -----------------------------------

assert.equal(inferEventMinutes("🍽️ dinner with Sofia"), 120);
assert.equal(inferEventMinutes("drinks with the lads"), 120);
assert.equal(inferEventMinutes("🥐 brunch with mum"), 90);
assert.equal(inferEventMinutes("🎉 dad's 60th"), 180);
assert.equal(inferEventMinutes("🎬 new Dune"), 150);
assert.equal(inferEventMinutes("✈️ flight to Rome"), 360);
assert.equal(inferEventMinutes("💒 wedding"), 480);
assert.equal(inferEventMinutes("🥾 hike up Dingli"), 240);

// Emoji alone carries the match, so non-English labels still land right.
assert.equal(inferEventMinutes("🍽️ cena con Sofia"), 120);
assert.equal(inferEventMinutes("boda de Ana"), 480);

// --- inferEventMinutes: fallback ----------------------------------------

for (const label of ["☕ coffee with Kurt", "💪 gym", "🦷 dentist", "🤝 interview at Solana", "", "   "]) {
  assert.equal(inferEventMinutes(label), DEFAULT_EVENT_MINUTES, `expected 1h default for '${label}'`);
}

// A word must stand alone — "filming" is not a film, "gigantic" is not a gig.
assert.equal(inferEventMinutes("filming day"), DEFAULT_EVENT_MINUTES);
assert.equal(inferEventMinutes("gigantic backlog review"), DEFAULT_EVENT_MINUTES);

// --- defaultEndTime -----------------------------------------------------

assert.equal(defaultEndTime("20:00", "🍽️ dinner with Sofia"), "22:00");
assert.equal(defaultEndTime("15:00", "🦷 dentist"), "16:00");
assert.equal(defaultEndTime("09:30", "🎉 party"), "12:30");
assert.equal(defaultEndTime("06:00", "✈️ flight to Rome"), "12:00");

// Never wrap past midnight: an end_time below start_time reads as an OVERNIGHT
// shift everywhere else in the schedule, which a personal event is not.
assert.equal(defaultEndTime("23:00", "🎉 party"), "23:59");
assert.equal(defaultEndTime("22:30", "🍽️ dinner"), "23:59");

// Malformed start times pass through untouched — the caller (tool) validates.
assert.equal(defaultEndTime("7pm", "dinner"), "7pm");

console.log("event-duration: all assertions passed");
