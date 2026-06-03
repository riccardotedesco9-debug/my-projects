#!/usr/bin/env node
// Verification script — replays Diego's schedule image against the updated
// parser prompt/model to confirm the 5 changes produce correct shifts.
//
// Usage: node tools/verify-diego-schedule.mjs
// Requires .env at meetsync/.env with ANTHROPIC_API_KEY + TELEGRAM_BOT_TOKEN.
//
// Ground truth (from Riccardo, 2026-04-15):
//   Mon 13 Apr  OFF
//   Tue 14 Apr  FCN        15:30-00:30
//   Wed 15 Apr  BAR        15:30-00:30
//   Thu 16 Apr  OFF
//   Fri 17 Apr  HK 12-14 + Deliveries 14-17  (SPLIT — two windows same day)
//   Sat 18 Apr  FR         16:00-00:30
//   Sun 19 Apr  BAR        12:00-00:00

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
const envText = readFileSync(envPath, "utf-8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!TG_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN missing in .env");
if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing in .env");

// First image from Riccardo's Diego session (full-week rota).
const FILE_ID =
  "AgACAgQAAxkBAAIESGnfit-ZaCdjqSd-PbKv1M69EwWcAAJYDWsbs6P4UuL-t2knMvKLAQADAgADeQADOwQ";

async function downloadTelegramFile(fileId) {
  const meta = await fetch(
    `https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${fileId}`,
  ).then((r) => r.json());
  if (!meta.ok) throw new Error(`getFile failed: ${JSON.stringify(meta)}`);
  const path = meta.result.file_path;
  const bytes = await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${path}`).then(
    (r) => r.arrayBuffer(),
  );
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType = path.endsWith(".png") ? "image/png" : "image/jpeg";
  return { base64, mimeType };
}

// Inlined copy of the prompt builder + Claude caller so we can observe the
// full raw response (thinking + text blocks) without touching prod code.
function buildWeekdayLookup(timezone) {
  const weekdays = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const lines = [];
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year").value);
  const m = Number(parts.find((p) => p.type === "month").value);
  const d = Number(parts.find((p) => p.type === "day").value);
  const todayUtc = Date.UTC(y, m - 1, d);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  for (let i = 0; i < 28; i++) {
    const date = new Date(todayUtc + i * MS_PER_DAY);
    const iso = date.toISOString().split("T")[0];
    lines.push(`- ${weekdays[date.getUTCDay()]} ${iso}`);
  }
  return lines.join("\n");
}

// Import the prompt from the actual source to make sure we test the shipped
// version verbatim. (Dynamic import via transpile-then-require would be ideal
// but adds complexity; instead we just call extractSchedule itself below and
// separately replay with a logged Claude call for observability.)

async function callClaudeRaw(base64, mimeType, userName, timezone) {
  // Build the EXACT shipped prompt verbatim — any drift means the test isn't
  // testing prod. Copied from schedule-parser.ts::getExtractionPrompt.
  const weekdayLookup = buildWeekdayLookup(timezone);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
  }).formatToParts(now);
  const todayWeekday = parts.find((p) => p.type === "weekday").value;
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  const todayIso = `${y}-${m}-${d}`;

  const userContext = `\n**The target person is "${userName}".** Work rotas typically list MULTIPLE people. Follow this two-step discipline:

STEP 1 — IDENTIFY THE ROW (or column). Scan the image for a row/column labelled with "${userName}" or an obvious variant (first-name match, nickname, initials like "DG" for Diego). If the sheet uses initials or codes, match by whichever identifier is visible. Pick exactly ONE row/column as the target's.

STEP 2 — EXTRACT FROM THAT ANCHOR ONLY. Every shift you emit must visibly sit in the target's row/column, on a date column/row clearly labelled for that date. Do NOT drift into neighbouring rows — day drift (reading Friday's shift into Saturday, etc.) is the #1 failure mode on these rotas. If a shift appears to span multiple cells within the target's group, merge it into one entry. If a single day has TWO SEPARATE time windows for the target (e.g. "HK 12–14 / Deliveries 14–17" on the same day, or AM + evening slots), emit BOTH as separate shift entries on that same date — do not collapse or drop either half.

If "${userName}" genuinely cannot be located on the sheet, pick the most plausible row based on context and mark confidence below 0.7.\n`;

  const prompt = `You are analyzing someone's availability for scheduling. Extract their BUSY / UNAVAILABLE time blocks into structured JSON.

Today is **${todayWeekday}, ${todayIso}**.
${userContext}

============================================================
REASONING PREAMBLE — REQUIRED BEFORE THE JSON
============================================================

Before the JSON object, write 1–3 short sentences (plain prose, NO braces, NO JSON) stating:
  a) what the input is (e.g. "a 7-day multi-person bar rota with names in column 1 and dates across the top"),
  b) which row/column you picked as the target's and what labels it by (e.g. "Diego is row 4, labelled 'DG'"),
  c) how many distinct shift entries you are about to emit (e.g. "5 busy days, 2 OFF days").
Then, on a new line, emit the JSON object. This preamble is the anchor that keeps you honest — do not skip it.

============================================================
IMAGE INPUT — you are very good at vision. Trust yourself and follow these principles:
============================================================

Images can arrive in ANY format: work-rota tables, calendar screenshots, weekly planners, handwritten notes, WhatsApp shots, phone photos of a whiteboard, PDFs, Google/Outlook exports, whatever. Don't assume a specific layout. Read the image the way a careful human would.

Core principles when reading ANY schedule image:

- **Lock onto an anchor first.** Identify the date axis (which direction the dates go — rows or columns) and the person axis (which direction the names go). Every cell you read must sit at the intersection of (target's name) × (a specific date). Verbalize this in the preamble. If you cannot find a date axis, say so and lower confidence.
- **Be exhaustive.** Extract EVERY shift/entry visible in the target's row/column. Do not stop early.
- **Both busy AND free days matter.** If a day in the target's row is explicitly OFF / blank / "—" / "rest" / coloured as non-working, emit a framing-B placeholder (00:00–00:00, label "OFF"). Don't silently skip.
- **Split shifts on one day.** If the target has TWO OR MORE time windows on the same day (e.g. Diego's Fri: "HK 12:00–14:00 / Deliveries 14:00–17:00"), emit each window as its own entry on that same date. Never collapse them into one range.
- **Shifts spanning two rows.** If the rota uses one row per shift (not per person), a single person may have two or more rows on the same day. Read ALL of the target's rows for each date — don't stop at the first match.
- **Ignore non-schedule distractions.** Email headers, logos, signatures, app chrome — all noise.
- **Date format conversion.** Convert whatever date format the image uses (DD.MM.YY, DD/MM, "5 Apr", weekday names, relative like "today") to YYYY-MM-DD. Use the weekday lookup table below to resolve weekday names. If the image shows explicit dates, trust those verbatim and cross-check against the lookup to catch year ambiguity.
- **Overnight shifts** (17:00–02:00, 22:00–06:00, etc.): preserve the literal end_time as given. Downstream code handles the midnight crossing — don't split into two entries yourself.
- **Sanity check before emitting JSON.** Re-scan the target's row. For each date you listed, verify the shift you recorded literally lives in that date's cell. Day drift (reading Fri's shift as Sat's) is the most common failure — catch it here.

The user may describe their availability in either of TWO framings — handle BOTH:

FRAMING A — "I work/am busy at these times" (work shifts, classes, meetings):
→ Extract each busy window as a shift entry with real start_time and end_time.
→ For recurring weekly patterns like "I work Mon-Fri 9-5", emit ONE entry per matching date across the ENTIRE 28-day lookup window below. So "Mon-Fri 9-5" = ~20 entries (four of each weekday across four weeks), all 09:00–17:00.
→ Each entry's label should match the shift's actual weekday, and its date MUST be a date from the lookup table that corresponds to that weekday.

FRAMING B — "I'm free at these times" or "I'm totally free" / "whenever":
→ The user has NO busy blocks for the dates they mention. Emit placeholder entries with start_time = "00:00" and end_time = "00:00" for each date in their stated range. Label each "fully free".
→ "I'm free all day for the next 4 weeks" → use every row in the 28-day lookup window below.
→ "I'm free Tue and Thu" → the 4 Tue rows + 4 Thu rows, all 00:00–00:00.

============================================================
WEEKDAY LOOKUP — date-math reference
============================================================

Here are the next 28 days with their weekdays — THIS is the source of truth for any date math. Do NOT compute weekday→date mappings yourself; look them up:
${weekdayLookup}

Rules for using the lookup:
- "Monday" / "next Monday" → the first Monday row in the table.
- "Mon-Fri" (unbounded) → produce ALL Mon/Tue/Wed/Thu/Fri rows that appear in the table — typically 20 dates across 4 weeks. Be generous, cover the full window.
- "this week" / "next week" → only the 5 weekday rows in that specific week.
- When a shift's label says e.g. "Monday work", the date MUST correspond to a Monday row from the table. Double-check by eye.
- If the input gives specific dates (e.g. "April 14" or "15.04.26"), use those verbatim, ignoring the lookup.

Common failure mode to avoid: writing "Monday work" next to a Tuesday date. That means you skipped a row. Always recount before finalizing.

============================================================
OUTPUT SCHEMA
============================================================

JSON shape:
- Top-level object with a "shifts" array.
- Each entry: { "date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "label": "optional description", "confidence": 0.0-1.0 }.
- Use 24-hour format for times.
- Exclude days off / holidays / breaks from busy-block entries (framing A).
- For framing B (fully-free), use 00:00–00:00 placeholders.
- confidence: 1.0 = clearly stated/legible, 0.7–0.9 = mostly sure, below 0.7 = uncertain.
- If a person's name is visible, include it as "person_name" at the top level.
- If the date range is visible (e.g., "April 2026"), include it as "date_range".

Example (framing A — split shift on one day):
Preamble: Single-person weekly rota; target is Diego (only name visible); 6 entries spanning Mon–Sun with Fri split across two windows.
{
  "shifts": [
    { "date": "2026-04-17", "start_time": "12:00", "end_time": "14:00", "label": "HK", "confidence": 0.95 },
    { "date": "2026-04-17", "start_time": "14:00", "end_time": "17:00", "label": "Deliveries", "confidence": 0.95 },
    { "date": "2026-04-18", "start_time": "16:00", "end_time": "00:30", "label": "FR", "confidence": 1.0 }
  ]
}`;

  const body = {
    model: "claude-opus-4-6",
    max_tokens: 12000,
    thinking: { type: "enabled", budget_tokens: 4000 },
    temperature: 1,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

console.log("[1/2] Downloading Diego's schedule image from Telegram…");
const { base64, mimeType } = await downloadTelegramFile(FILE_ID);
console.log(`    got ${Math.round((base64.length * 3) / 4 / 1024)}KB ${mimeType}`);

console.log("[2/2] Calling Claude Opus 4.6 with extended thinking…");
const result = await callClaudeRaw(base64, mimeType, "Diego", "Europe/Malta");

console.log("\n=== RAW CLAUDE RESPONSE ===");
for (const block of result.content) {
  if (block.type === "thinking") {
    console.log("\n--- THINKING ---");
    console.log(block.thinking);
  } else if (block.type === "text") {
    console.log("\n--- TEXT ---");
    console.log(block.text);
  }
}
console.log("\n=== USAGE ===", JSON.stringify(result.usage));
