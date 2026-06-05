// Regression tests for the deterministic schedule/availability display
// renderers. These guard the "where's the cooking with fran" bug: the
// user-facing schedule used to be hand-typed by the LLM and could silently
// drop an entry (notably the activity on an OFF day). The renderers below
// build the block in code, so an entry can never go missing.
//
// No test runner is configured for this project — run directly with tsx:
//   npx tsx src/trigger/meetsync/__tests__/render-display.test.ts
//
// Fixtures are anchored on the module's own date helpers so the active
// window lines up regardless of the day the test runs.

import assert from "node:assert/strict";
import {
  renderScheduleForDisplay,
  renderAvailabilityBlock,
  todayIsoInTimezone,
  isoDateOffset,
} from "../turn-handler-snapshot.js";

const TZ = "Europe/Malta";
const today = todayIsoInTimezone(TZ);
const d = (n: number) => isoDateOffset(today, n);

type Shift = { date: string; start_time: string; end_time: string; label?: string };
const json = (shifts: Shift[]) => JSON.stringify(shifts);

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log("renderScheduleForDisplay:");

// 1. The exact production failure: OFF day + activity must keep BOTH, and a
//    near-duplicate (different end time / label) must show BOTH, not be
//    silently collapsed.
check("OFF + activity (+ near-dup) all survive on one line", () => {
  const out = renderScheduleForDisplay(
    json([
      { date: d(2), start_time: "00:00", end_time: "00:00", label: "off" },
      { date: d(2), start_time: "13:30", end_time: "16:30", label: "Cook with Francesca" },
      { date: d(2), start_time: "13:30", end_time: "17:00", label: "meetup: Cooking with Fran 🍳" },
    ]),
    TZ,
  ).join("\n");
  // "OFF" leads, then activities (a holiday tag like "[Sette Giugno 🎆]"
  // may sit between OFF and the "+", so allow it).
  assert.match(out, /OFF[^\n]*\+[^\n]*Cook with Francesca/, "OFF status leads, activity follows");
  assert.match(out, /13:30–16:30 \(Cook with Francesca\)/, "personal cooking entry kept");
  assert.match(out, /13:30–17:00 \(Cooking with Fran 🍳\)/, "near-dup meetup entry kept (meetup: stripped)");
  assert.doesNotMatch(out, /meetup:/i, "'meetup:' prefix stripped in display");
});

// 2. Work shift renders as 💼, the verbose work label is dropped.
check("work shift renders as 💼 with label dropped", () => {
  const out = renderScheduleForDisplay(
    json([{ date: d(1), start_time: "08:00", end_time: "17:00", label: "work (office, St Julian's)" }]),
    TZ,
  ).join("\n");
  assert.match(out, /💼 08:00–17:00/, "work → 💼 HH:MM–HH:MM");
  assert.doesNotMatch(out, /\(work/i, "work label not shown as a parenthetical");
});

// 3. Exact-duplicate entries collapse to one; non-exact dups (above) do not.
check("exact-duplicate entry collapses to one", () => {
  const out = renderScheduleForDisplay(
    json([
      { date: d(3), start_time: "18:30", end_time: "19:30", label: "🌙 Yin" },
      { date: d(3), start_time: "18:30", end_time: "19:30", label: "🌙 Yin" },
    ]),
    TZ,
  ).join("\n");
  const occurrences = (out.match(/🌙 Yin/g) ?? []).length;
  assert.equal(occurrences, 1, "identical rows render once");
});

// 4. Sensitive labels are abstracted to "(appointment)".
check("sensitive label redacted", () => {
  const out = renderScheduleForDisplay(
    json([{ date: d(4), start_time: "16:00", end_time: "17:00", label: "Psychiatrist - St James Hospital" }]),
    TZ,
  ).join("\n");
  assert.match(out, /\(appointment\)/, "sensitive → (appointment)");
  assert.doesNotMatch(out, /Psychiatrist/i, "raw sensitive label not leaked");
});

// 5. No forward cap: an entry ~90 days out still renders.
check("far-future entry not truncated (no 60d / 35-date cap)", () => {
  const farDate = d(90);
  const out = renderScheduleForDisplay(
    json([{ date: farDate, start_time: "09:00", end_time: "10:00", label: "Dentist" }]),
    TZ,
  ).join("\n");
  assert.match(out, /\(Dentist\)/, "far-future entry present");
});

// 6. Today divider present.
check("today divider emitted", () => {
  const out = renderScheduleForDisplay(
    json([{ date: d(1), start_time: "08:00", end_time: "17:00", label: "work" }]),
    TZ,
  ).join("\n");
  assert.match(out, /── today \(/, "divider present");
});

// 7. Display starts from TODAY — past days are excluded, today + future shown.
check("past dates excluded; today onward included", () => {
  const out = renderScheduleForDisplay(
    json([
      { date: d(-3), start_time: "08:00", end_time: "17:00", label: "work" },   // 3 days ago
      { date: d(0), start_time: "10:00", end_time: "11:00", label: "Gym" },     // today
      { date: d(5), start_time: "09:00", end_time: "10:00", label: "Dentist" }, // future
    ]),
    TZ,
  ).join("\n");
  assert.match(out, /\(Gym\)/, "today's entry shown");
  assert.match(out, /\(Dentist\)/, "future entry shown");
  // The only work entry is the past one (d-3); work renders as 💼, so its
  // absence proves the past day was dropped.
  assert.doesNotMatch(out, /💼/, "past work day excluded");
});

// Interviews are NOT redacted — job-hunting terms were removed from the
// sensitive catalog per the caller's rule (only truly sensitive data hides).
check("interviews shown by name, not redacted", () => {
  const out = renderScheduleForDisplay(
    json([{ date: d(1), start_time: "11:00", end_time: "12:00", label: "Pet Centre interview" }]),
    TZ,
  ).join("\n");
  assert.match(out, /\(Pet Centre interview\)/, "interview shown by name");
  assert.doesNotMatch(out, /appointment/, "interview NOT turned into (appointment)");
});

// Blood tests are also shown by name (removed from the sensitive catalog);
// genuinely sensitive items still redact.
check("blood test shown by name; psychiatrist still redacted", () => {
  const out = renderScheduleForDisplay(
    json([
      { date: d(1), start_time: "11:00", end_time: "12:00", label: "Blood test" },
      { date: d(2), start_time: "16:00", end_time: "17:00", label: "Psychiatrist" },
    ]),
    TZ,
  ).join("\n");
  assert.match(out, /\(Blood test\)/, "blood test shown by name");
  assert.match(out, /\(appointment\)/, "psychiatrist still redacted");
  assert.doesNotMatch(out, /Psychiatrist/i, "sensitive label not leaked");
});

// A labelled month band separates months in the display.
check("month band separates months", () => {
  const far = d(45); // ~1.5 months out → always a different month than d(1)
  const out = renderScheduleForDisplay(
    json([
      { date: d(1), start_time: "10:00", end_time: "11:00", label: "A" },
      { date: far, start_time: "10:00", end_time: "11:00", label: "B" },
    ]),
    TZ,
  ).join("\n");
  const farMonth = new Date(far + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  assert.ok(
    out.split("\n").some((l) => l.includes(farMonth) && /────/.test(l)),
    `month band for ${farMonth} present`,
  );
});

// Empty / null schedule yields no lines (caller shows a friendly note).
check("empty schedule → no lines", () => {
  assert.deepEqual(renderScheduleForDisplay(null, TZ), []);
  assert.deepEqual(renderScheduleForDisplay(json([]), TZ), []);
});

console.log("renderAvailabilityBlock:");

// 8. Multi-person grid keeps every person; a person with no entry on a date
//    shows "—"; names align; ━━━ day divider present.
check("availability grid keeps all people, no row dropped", () => {
  const lines = renderAvailabilityBlock(
    [
      { name: "You", scheduleJson: json([{ date: d(1), start_time: "08:00", end_time: "17:00", label: "work" }]) },
      { name: "Marco", scheduleJson: json([{ date: d(2), start_time: "00:00", end_time: "00:00", label: "off" }]) },
    ],
    TZ,
  );
  const out = lines.join("\n");
  assert.match(out, /━━━ /, "day divider present");
  // d(1): You works, Marco has nothing → Marco shows —
  assert.match(out, /You .*💼 08:00–17:00/, "You's work row present");
  assert.match(out, /Marco .*—/, "Marco shows — on a day with no entry");
  // d(2): Marco OFF present
  assert.match(out, /Marco .*OFF/, "Marco OFF row present");
});

console.log(`\n${passed} checks passed.`);
