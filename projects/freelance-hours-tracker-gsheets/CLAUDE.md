# Freelance Hours Tracker — Google Sheets edition

Domain: Engineering

A Google Sheet + container-bound Apps Script that works like a stopwatch for freelance work:
Start/Stop logs sessions per client, pay is computed from per-client hourly rates, and one
dialog exports a professional monthly timesheet PDF into Drive. Replaces the finished
Excel/VBA version (`projects/freelance-hours-tracker/` — reference spec, do not modify).

## Daily use (the whole manual)

1. Open the spreadsheet (Drive → `Freelance Hours Tracker/`). The **⏱ Tracker** menu and the
   timer sidebar appear automatically.
2. Pick a **Client**, type what you're doing in **Task**, hit **▶ Start timer** (sidebar or
   the Dashboard START box). A live row appears in the **RUNNING NOW** list with its own
   ticking clock; the banner shows how many timers are live.
3. **Run several at once:** hit Start again with a different client/task and a **second** clock
   starts alongside — timers are fully concurrent, and overlapping time bills each task
   independently (start a clock for each thing you're genuinely doing in parallel). Each card
   has its own **Stop & log**; **Stop & log all** closes everything at one instant.
4. Stopping logs one row per session in **Time Log** (date, client, task, start, end, hours,
   **status**, rate, € amount). A running session lives in the log too — Start set, End blank —
   so a crashed tab/PC/network loses nothing; it just keeps ticking until you stop it.
5. **Free (no charge):** tick **Free (no charge)** before Start (sidebar or the Dashboard
   **Free?** box) to log a session as a gift — it shows **Free** (green) instead of a €
   amount, adds €0 to totals, but its hours still count. You can also flip any finished row
   later: select it on the Time Log → ⏱ Tracker → *Mark selected session(s) free / paid*.
7. **Monthly report:** ⏱ Tracker → *Export Timesheet PDF…* → pick client (or All Clients) +
   month + include-€ → print-ready A4 PDF lands in `Timesheets/<Client>/` in Drive, e.g.
   `Timesheet_2026-07_PetCentre_<YourName>.pdf`. In-progress (still-running) sessions are
   excluded; free sessions show **Free** (green, €0) with their hours still counted. The PDF
   ends with a **WORK BREAKDOWN**: same-type tasks consolidated into named groups (Claude
   Haiku via the `ANTHROPIC_API_KEY` Script Property; deterministic exact-match fallback
   without it) + a pie chart of where the hours went. Groupings are cached per client+month.
8. **Forgot to clock?** ⏱ Tracker → *Add past session…* (also linked in the sidebar) logs it
   through the same code path, so the row gets the live formulas manual typing would lack.
9. **Rates & emails:** Clients sheet — type the €/h rate (ships blank) and the client's email
   next to each name. Add a client = type a new row; every dropdown follows. A rate change
   re-prices rows via the live lookup formula; overtype any row's Rate to pin a one-off.
10. **1st of each month:** a trigger builds last month's PDF per active client and leaves a
    **Gmail draft** to them for your review — you press send.
11. **Live client views:** ⏱ Tracker → *Client views…* — pick any client from the dropdown
    (new clients appear automatically; existing views say "refresh"), one button creates or
    refreshes their view-only file and hands back the share link. The file opens on a
    client-facing **Summary** dashboard: headline stats (total hours, sessions, this month),
    an hours-by-month column chart + a "Where the time goes" top-tasks pie, the tables
    behind them, and the latest-first session list — plus a **Status** column showing
    *In Progress* (a task you're timing right now), *Free* on no-charge sessions, and
    *Finished* on everything else. Hours
    ONLY: it imports Log!A2:G (date…hours + the Status label) filtered to that client, so
    rates/€ (H/I) and other clients physically can't appear.

The **sidebar is the control surface** (the RUNNING NOW list with a live clock + Stop per
timer, an add-a-timer form with a Free toggle, Stop-all, today + month footer, export/add-
session shortcuts). The Dashboard mirrors it for the phone: START box + Free? to add a clock,
a RUNNING NOW block with a stop box per timer, and the count banner (gray IDLE / green N running).

## Safety properties (why it's trustworthy)

- **Crash-safe by construction — LOG-AS-TRUTH:** a running session IS a Time Log row (Start
  set, End blank), not a scalar blob. A browser tab, PC, or network death loses nothing — the
  row is already on the server and keeps ticking. Reopening lists every still-running timer
  (stop-&-log / discard per card, or keep/stop/discard all). There is no state blob to corrupt.
- **Concurrent + simultaneous billing (by design):** many clocks run at once; overlapping
  wall-clock time bills each task independently. Session identity = `Start.getTime()`
  (`startedAtMs`), unique among the live set (a same-ms collision bumps +1ms); every consumer
  keys off the stored value, so a ±1ms datetime round-trip never mis-maps a stop.
- **Free sessions:** the Amount cell holds the literal `"Free"` — SUM/QUERY treat text as €0,
  so it drops out of money totals while its hours still count; shown green in the log/PDF and
  as a *Free* tag in the client view.
- **Column order:** A date · B client · C task · D start · E end · F hours · **G Status** ·
  H rate · I amount. Status is a per-row formula (In Progress / Free / Finished) that carries no
  money, so the client view can import A2:G safely. Rate/Amount live at H/I, never imported.
- Times stored as full date+time → midnight-crossing sessions compute correctly.
- Log flags: >8h days (amber date), midnight-crossing rows (red date), hours color scale,
  in-progress (teal Status), free (green Amount).
- Exact-minute billing, no rounding by design — a very short session can show 0.00 h.
- The Report sheet is a regenerate-on-demand artifact — never stored data.

## Upgrading an existing tracker to v2 (concurrent timers)

After pushing the v2 code, run **⏱ Tracker → Maintenance → Update layout (keeps your data)
FIRST**, before starting any timer. It performs a one-time, non-destructive schema migration:
it inserts the new **Status** column at G (shifting your existing Rate→H and Amount→I, formulas
and all), rebuilds the Dashboard/sidebar, and migrates any leftover single-timer state into a
log row. Until you run it, the code (expecting Status@G / Rate@H / Amount@I) is out of step
with the old 8-column log, so don't clock time in that window.

## Dev workflow

- Source of truth: `src/` (pushed by clasp; kebab-case, one concern per file, `_`-suffixed
  privates). `src/build.js` → `rebuild_()` is the **authoritative layout spec**.
- `npm run push` = `clasp push` · `npm run open` = open the container Sheet ·
  `npm test` = eslint + `tools/run-tests.mjs` (drives `runSmokeTest()`).
- **`runSmokeTest()` is a full health check + stress suite** (~450 checks, 15 sections,
  ~3-5 min): section 1 is a READ-ONLY production health check (structure, named ranges,
  triggers, Script Properties, Drive tree, a full data-integrity sweep of the real log incl.
  in-progress rows + dashboard/summary reconciliation); everything else drives the REAL
  functions on a throwaway spreadsheet — the concurrent-timer state machine (in-progress row
  shape, unique ids, stop-by-id, stopAll, discard, free sessions, legacy migration, lock
  hygiene, the crash-safe order invariant), mobile per-row stop checkboxes, log math (DST,
  unicode, formula-injection, grid edge), manual/fee refusal matrices, report period windows
  vs an independent JS mirror (incl. in-progress exclusion + free rendering), breakdown/seal/
  PDF/viewer/drafts artifacts (viewer imports A2:G, money-blind), a 150-row bulk stress +
  full-log invariant sweep, updateLayout preservation, and a disaster-recovery rebuild.
  Asserts CONTENT, never existence; each section is throw-isolated + timed; self-limits to
  the Apps Script 6-min ceiling.
  Test harness lives in `src/test-runner.js`; sections in `src/test-*.js`.
- The in-sheet menu runs the same suite: ⏱ Tracker → Maintenance → *Run health check +
  smoke test* (section-grouped verdict with ⚠ warnings + ℹ info in a dialog) — works even
  without the optional GCP project wiring for `clasp run-function`.
- **Manual steps (one-time):** ① enable Apps Script API + `clasp login`; ② run `setup()` once
  in the editor and click the consent screen; ③ click "Allow access" once inside each client
  viewer (IMPORTRANGE grant).
- **Script Properties (Project Settings → Script Properties)** — personal data lives here, not
  in the (public) repo: `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_ID` (shown on the timesheet), and
  `ANTHROPIC_API_KEY` (task grouping; optional — falls back to exact-match). `SIGNING_SECRET`
  is auto-created on first export.

## clasp v3 cheat-sheet (v2 tutorials are a trap)

- `clasp create-script --type sheets --title "…"` · `clasp clone-script <scriptId>` ·
  `clasp open-container` (not `open`) · `clasp run-function <fn>` (not `run`) ·
  `clasp push` / `clasp pull`. No TypeScript transpilation in v3 — this project is plain JS.
- Login: `clasp login` (browser consent, stored in `~/.clasprc.json`). Node ≥20.

## Known trade-offs (accepted by design)

- Sheets mobile app runs no menus/buttons/sidebars → checkboxes are the phone surface;
  an offline tap logs at sync time with server-time stamping.
- The PDF export URL (`/export?format=pdf`) is official but has shown instability for
  server-side callers (July 2026) → retry ×3 then a degraded `DriveApp.getAs(PDF)` fallback
  (hides other sheets during export).
- Sidebar is fixed 300px and closes on tab reload — elapsed is always re-derived from the
  server timestamp, so the ticking display is cosmetic only.
