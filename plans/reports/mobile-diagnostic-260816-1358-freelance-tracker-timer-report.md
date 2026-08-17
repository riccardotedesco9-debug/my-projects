# Freelance Hours Tracker — mobile diagnostic

**TLDR** — The timer engine is fine. The *mobile layout* is broken: "Mobile view" is stuck **half-applied** on the
live sheet — columns narrowed and input rows enlarged, but every checkbox you actually tap (START, EXPORT,
Include-€, all six STOP boxes) is still desktop-sized, and the analytics block still pushes EXPORT below the
fold. `applyDashboardMode_` aborted partway and there is no lock, no error isolation and no way to re-assert
the mode, so the half-state is permanent. Second, independent problem: **the phone Start/Stop has no feedback
channel at all** — a blank Task (which Start hard-requires) refuses silently, which reads exactly like "the
timer doesn't work". Quick repair: ⏱ Tracker → Maintenance → **Update layout**. Durable fix: 3 code changes below.

Date: 2026-08-16 · Scope: `projects/freelance-hours-tracker-gsheets` · Method: static read of `src/` +
read-only inspection of the **live** spreadsheet and the deployed script.

---

## How this was checked

| Check | Result |
|---|---|
| Deployed Apps Script vs `src/` | `clasp pull` into a scratch dir → **34 files byte-identical**. Code is live. |
| ESLint | Clean. |
| Live named ranges | All 15 current names resolve (+ 6 orphans, see L3). |
| Live Dashboard geometry | Drive XLSX export → parsed column widths, row heights, hidden rows, fonts, validations, merges. |
| Live timer state | Time Log row 11 in progress; RUNNING NOW row 17 mirrors it; hidden id matches exactly. |
| Apps Script execution log | **Not available** — `processes:listScriptProcesses` returns 403 insufficient scopes on the clasp token; Sheets API is disabled on clasp's OAuth project. Root cause of the abort is therefore inferred from sheet state, not read from a stack trace. |

---

## H1 — Mobile view is stuck half-applied (the headline defect)

`chkMobile` (B4) = **TRUE**, but only the first two of seven steps in `applyDashboardMode_` took effect.

Measured on the live Dashboard:

| Step in `applyDashboardMode_` | What it sets | Live value | Expected (mobile) | Verdict |
|---|---|---|---|---|
| 1 — column widths | A..H | 10/64/104/104/104/86/86/10 | same | **applied** |
| 2 — field rows 7,8,39 | height / font | 38px / 14pt | 38 / 14 | **applied** |
| 3a — `dbBilling` F13 | font | 10pt | 14 | **not applied** |
| 3b — captions G13, G40 | font | 10pt | 14 | **not applied** |
| 4 — `dbExpOut` B41 | font / row 41 | 10pt / 26px | 14 / 40 | **not applied** |
| 5 — chkStart B13, chkExport B40, dbExpMoney F40 | font / rows 13,40 | 10pt / 30px | 18 / 46 | **not applied** |
| 6 — stop boxes B17:B22 | font / rows 17-22 | 10pt / 26px | 18 / 36 | **not applied** |
| 7 — hide analytics tail 31-37 | hidden | **visible** | hidden | **not applied** |

The abort is exactly at the boundary between the `fieldRows` loop and the first `getRangeByName` pass —
[dashboard-mode.js:85](projects/freelance-hours-tracker-gsheets/src/dashboard-mode.js#L85).

**Why it feels broken on the phone.** The columns *did* narrow, so the mode looks like it took. But the whole
point of the mode — `boxFont` 10 → 18, which is the only lever Sheets gives over checkbox tap-target size — never
ran. So you get a phone-shaped sheet with desktop-sized checkboxes, and EXPORT still sits under a visible
analytics block instead of above the fold.

**Why it stays broken.** Three compounding gaps:

1. **No lock.** Every timer mutation goes through `withLock_`
   ([state.js:90](projects/freelance-hours-tracker-gsheets/src/state.js#L90)), but the mode toggle rewrites shared
   sheet geometry with no serialization. Two interleaved executions — a bounced or immediately-corrected tap on
   the phone (tick → untick → tick) — produce precisely this half-and-half result: one execution wins steps 1-2,
   the other wins steps 4-7.
2. **No error isolation.** `onEditInstallable` calls `applyDashboardMode_` bare, with no `try/catch`
   ([triggers.js:26](projects/freelance-hours-tracker-gsheets/src/triggers.js#L26)) — unlike the action paths,
   which have a `finally`. A single transient "Service Spreadsheets failed while accessing document" mid-run
   leaves the sheet split and nothing retries. `rebuild_` is wrapped in `withSpreadsheetRetry_`; this is not.
3. **No re-assert path.** You cannot re-tick a ticked checkbox — tapping it unticks it. So there is no gesture
   that says "apply the current mode again". Repair requires a full untick → tick round trip, or Update layout.

Both (1) and (2) are consistent with the evidence; without the execution log I can't say which fired. Either
way the fix is the same, and the design gap — an unguarded, unserializable, non-idempotent mode write — is real
regardless of which one tripped it.

## H2 — The phone Start/Stop has no feedback channel

`startWorkCtx_`'s return value is **discarded**
([triggers.js:60](projects/freelance-hours-tracker-gsheets/src/triggers.js#L60)). Every refusal ends the same
way: the checkbox flicks back to unticked and nothing else happens. Refusal cases:

- **blank Task** — `startWorkCtx_` hard-requires one
  ([timer.js:132](projects/freelance-hours-tracker-gsheets/src/timer.js#L132)). The Task cell is free-text with an
  allow-invalid dropdown, so leaving it empty is easy.
- blank Client, or a Client not on the Clients sheet.
- Stop: `if (id) stopSessionCtx_(...)` ([triggers.js:67](projects/freelance-hours-tracker-gsheets/src/triggers.js#L67))
  — a blank or stale id is a silent no-op.

`notify_` would not help even if wired up: it uses `ss.toast()`, which the Sheets mobile app does not render.
The export block solved this properly with a result cell (`dbExpOut`); start/stop has no equivalent.

The suite currently codifies the silence — `test-timer-machine.js:261` asserts only that nothing started, never
that the user was told why.

**This is the most likely everyday cause of "the timer doesn't work on mobile."** Tap START with an empty Task
and the tracker gives you nothing at all.

## M1 — Even fully applied, mobile mode is wider than a phone

Mobile widths total **568px** across A..H; the visible band B..G is **548px**. A phone in the Sheets app has
roughly 360-410dp. The START bar's coloured face alone runs to x ≈ 386px, so the **Billing dropdown (F13)** and
the **Include-€ checkbox (F40)** sit off-screen right and need a horizontal scroll to reach.

`CLAUDE.md` claims "~840px to ~460px". 840 matches desktop A..H, but 460 matches only **B..F** — it excludes
column G, which is where the control captions live. Doc drift plus a genuine reachability gap.

## M2 — Stop-by-row is position-keyed at tap time, id-resolved at sync time

The stop checkbox maps to a session by its **row index** into `dbRunIds`, read when the trigger runs, not when
you tapped. `renderRunningNow_` compacts the list upward after every stop. So on a phone — stale view, offline
tap, or just a quick second tap — the row you touched may no longer hold the session you saw. You either stop a
different clock or hit a blank id and get silence (H2). Reachable whenever two or more timers run.

## Low severity

- **L1** — The mode toggle never scales itself. B4 is excluded from the `boxFont` list
  ([dashboard-mode.js:100](projects/freelance-hours-tracker-gsheets/src/dashboard-mode.js#L100)), so in mobile mode
  it stays 10pt while every other checkbox doubles — the one control for getting back to desktop is the hardest to tap.
- **L2** — Mobile hides rows 31-37, but the "THIS MONTH BY CLIENT" card spans E25:G36. Rows 25-30 stay visible,
  so the card is cut mid-table with its bottom border hidden.
- **L3** — Six orphaned `#REF!` named ranges: `stStartedAt`, `stClient`, `stTask`, `stStatus`, `chkStop`, `dbFree`
  (v1 leftovers). `updateLayout_` never removes named ranges — only the destructive `wipeWorkbook_` does. Harmless
  today, but broken named ranges are the classic trigger for `getRangeByName` flakiness, which is one candidate
  for H1's abort.
- **L4** — Dropdown validations over-reach their source lists: period points at O2:O20 but only 14 labels are
  written (O2:O15); client points at N2:N20. Trailing blank entries in both phone dropdowns.

## Verified healthy

- Deployed script byte-identical to `src/` (34 files) — nothing is stale on the Apps Script side.
- All 15 current named ranges resolve on the live sheet; the phone export block is fully built.
- Period list is current: O2 = "August 2026"; `dbExpPeriod` = "July 2026" (valid, so no stale-period repair fired);
  `dbExpMoney` = TRUE.
- **Timer core is correct.** One in-progress session — Time Log row 11, Splash Store / "Barcode Information
  Retrevial", Status formula resolving to *In Progress*, Amount blank. RUNNING NOW row 17 mirrors it with label
  "· since 13:57" and hidden id `1786881467827`, which matches the row's stored Start exactly. Log-as-truth,
  the id round-trip and the render path are all behaving.

---

## Recommended fixes

**Immediate, no code:** ⏱ Tracker → Maintenance → **Update layout (keeps your data)**. `updateLayout_` reads the
toggle before the rebuild and re-applies the mode after
([build.js:281](projects/freelance-hours-tracker-gsheets/src/build.js#L281), `:312`), which repairs the half-state.
It will re-break if the underlying cause recurs.

**Durable — 3 changes, in priority order:**

1. **H2 — give the phone start/stop a result cell.** Mirror what the export block already does: write
   `res.msg` into a Dashboard cell on refusal, green/red. Smallest change with the biggest felt effect, and it
   makes every other mobile failure self-explaining instead of silent.
2. **H1 — make the mode write safe.** Wrap `applyDashboardMode_` in `withLock_`, wrap the call site in
   `try/catch`, and re-assert the mode on `onOpenInstallable` so opening the sheet self-heals a half-state.
   Optionally wrap in `withSpreadsheetRetry_` for the transient-error case.
3. **M1 — fit the phone.** Trim mobile widths so B..G lands under ~380px, or move Billing and Include-€ off the
   control row onto their own rows.

L1-L4 are cheap follow-ons; M2 needs a design call (id-in-the-cell rather than row-position mapping) and is worth
discussing before touching.

No code changed — this was a diagnostic pass only.

## Unresolved

- Exact throw/interleave that aborted `applyDashboardMode_` is inferred, not read. To confirm, either attach a
  standard GCP project to the script (enables `clasp logs` / execution transcripts), or check
  **Apps Script editor → Executions** for a failed `onEditInstallable` around the time mobile view was last toggled.
- Whether the abort is reproducible: untick → re-tick "Mobile view" and re-inspect. If it splits again at the
  same step, it is deterministic (points at L3 / `getRangeByName`) rather than a race.
