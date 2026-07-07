# Freelance Hours Tracker — Google Sheets edition

Domain: Engineering

A Google Sheet + container-bound Apps Script that works like a stopwatch for freelance work:
Start/Stop logs sessions per client, pay is computed from per-client hourly rates, and one
dialog exports a professional monthly timesheet PDF into Drive. Replaces the finished
Excel/VBA version (`projects/freelance-hours-tracker/` — reference spec, do not modify).

## Daily use (the whole manual)

1. Open the spreadsheet (Drive → `Freelance Hours Tracker/`). The **⏱ Tracker** menu and the
   timer sidebar appear automatically.
2. Pick a **Client**, type what you're doing in **Task**, hit **▶ Start** (sidebar, dashboard
   button, or menu). Banner goes green, the sidebar clock ticks live.
3. **■ Stop & Log** when done — one row lands in **Time Log** (date, client, task, start, end,
   hours, rate, € amount).
4. **Juggling jobs:** with the timer running, pick the other client/task and hit **▶ Start** —
   it offers to log the current session and start the new one with **zero gap**. One active
   clock ever; no hour is double-billed.
5. **On the phone** (Google Sheets app): tick the **▶ Start** / **■ Stop** checkboxes on the
   Dashboard — they run the same timer. Offline taps log when the phone syncs.
6. **Monthly report:** ⏱ Tracker → *Export Timesheet PDF…* → pick client (or All Clients) +
   month + include-€ → print-ready A4 PDF lands in `Timesheets/<Client>/` in Drive, e.g.
   `Timesheet_2026-07_PetCentre_<YourName>.pdf`. The PDF ends with a **WORK BREAKDOWN**:
   same-type tasks consolidated into named groups (Claude Haiku via the `ANTHROPIC_API_KEY`
   Script Property; deterministic exact-match fallback without it) + a pie chart of where
   the hours went. Groupings are cached per client+month.
7. **Forgot to clock?** ⏱ Tracker → *Add past session…* (also linked in the sidebar) logs it
   through the same code path, so the row gets the live formulas manual typing would lack.
8. **Rates & emails:** Clients sheet — type the €/h rate (ships blank) and the client's email
   next to each name. Add a client = type a new row; every dropdown follows. A rate change
   re-prices rows via the live lookup formula; overtype any row's Rate to pin a one-off.
9. **1st of each month:** a trigger builds last month's PDF per active client and leaves a
   **Gmail draft** to them for your review — you press send.
10. **Live client views:** ⏱ Tracker → *Create client view…* makes a view-only spreadsheet per
    client (their sessions + hours ONLY, never money) you can share as a link.

The **sidebar is the control surface** (ticking clock, Start/Stop, zero-gap confirm, today +
month footer, export/add-session shortcuts). The Dashboard's one button opens it; the status
banner (gray IDLE / green RUNNING) is the on-sheet feedback; checkboxes cover the phone.

## Safety properties (why it's trustworthy)

- **Crash-safe:** timer state lives server-side in Script Properties — browser tab, PC, or
  network death loses nothing. Reopening offers keep-timing / stop-&-log / discard.
- Zero-gap switches use the **same captured millisecond** for old-end and new-start.
- Times stored as full date+time → midnight-crossing sessions compute correctly.
- Log flags: >8h days (amber row), midnight-crossing rows (red date), hours color scale.
- Exact-minute billing, no rounding by design — a very short session can show 0.00 h.
- The Report sheet is a regenerate-on-demand artifact — never stored data.

## Dev workflow

- Source of truth: `src/` (pushed by clasp; kebab-case, one concern per file, `_`-suffixed
  privates). `src/build.js` → `rebuild_()` is the **authoritative layout spec**.
- `npm run push` = `clasp push` · `npm run open` = open the container Sheet ·
  `npm test` = eslint + `tools/run-tests.mjs` (drives `runSmokeTest()`).
- **`runSmokeTest()` is a full health check + stress suite** (~330 checks, 15 sections,
  ~3-5 min): section 1 is a READ-ONLY production health check (structure, named ranges,
  triggers, Script Properties, Drive tree, a full data-integrity sweep of the real log +
  dashboard/summary reconciliation); everything else drives the REAL functions on a
  throwaway spreadsheet — timer state machine incl. corrupted-state/crash/lock tests,
  checkbox onEdit paths, log math (DST, unicode, formula-injection, grid edge), manual/fee
  refusal matrices, report period windows vs an independent JS mirror, breakdown/seal/PDF/
  viewer/drafts artifacts, a 150-row bulk stress + full-log invariant sweep, updateLayout
  preservation, and a disaster-recovery rebuild. Asserts CONTENT, never existence; each
  section is throw-isolated + timed; self-limits to the Apps Script 6-min ceiling.
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
