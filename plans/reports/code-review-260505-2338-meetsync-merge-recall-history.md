# Code Review — meetsync merge + recall + history (commits 4d25814 / d9422e3 / 04242d2 / 185e266)

## Headline: SHIP — with two small follow-ups noted below.

Architectural fixes are sound. Per-date merge logic is correct, multi-turn build is correct, window math is fine. Two real but minor issues; nothing blocking.

---

## Findings

### serious

**S1. `isMediaMarker` regex is too permissive — could swallow real first-line user content**
`turn-handler.ts:336` — `/^\[(photo|document|voice|contact|.+?) (uploaded|message|shared) ?(?:·|\b)/`
The `.+?` alternation makes `(photo|document|voice|contact|.+?)` accept *anything* up to a space. A real user message starting with e.g. `"[Note] uploaded backup yesterday"` or `"[draft] message saved"` (well-formed brackets, then "uploaded"/"message"/"shared") would match and be silently dropped from history. Probability is low but not zero (and you already worry about exactly this in the ask).
Fix: drop the `.+?` alternation; pin to the actual literal markers the worker emits. `/^\[(photo|document|voice|contact) (uploaded|message|shared)\b/`. The `?(?:·|\b)` tail is also redundant once the alternation is anchored — `\b` after a known noun is enough.

### minor

**M1. `extractTrailingUserTurns` echo-detection becomes asymmetric for media turns**
`turn-handler.ts:319-347` — when the current turn is media (photo/voice/document), `currentText` is undefined / `mediaCache.fileId`-like, so `matchesCurrent` is always false and only `isMediaMarker` saves the day. Combined with S1 this is the failure case: a non-media `currentText === undefined` (rare but possible — e.g. contact share with no text) plus a popped non-marker user message → that real message gets dropped. Tightening S1 already mitigates it; consider also: only pop the LAST trailing user entry (the worker pre-log echo), not the entire trailing run, then handle bursts as a separate concern. The current `while`-pop strategy plus media handling means burst-bailed turns earlier than the immediate echo ride along in `popped` and only the last is dropped — that part is correct — but the comment at line 314 ("FIRST popped entry is the actual current turn") is wrong; `popped.unshift` puts new entries at the front, so the LAST element of `popped` is the most recent (= the echo). Code matches that semantics (`popped[popped.length - 1]`, then `popped.pop()`), but the comment lies. Update the comment.

**M2. `mergeShiftsByDate` corrupt-blob path silently discards prior dates**
`turn-handler-tools.ts:457-465` — on `JSON.parse` failure, `existing` stays `[]`, so the corrupt blob is effectively wiped on the next `parse_schedule` call (you log a warning but downstream `JSON.stringify(merged)` overwrites D1 with only the new dates). This may be intentional (corrupt = lost) but it's a one-way door. Alternatives: (a) refuse to write and surface a tool error so Claude tells the user; (b) salvage by trying a permissive parse first. Given how rare this is, document the choice in the comment ("corrupt → treated as empty AND will be overwritten on next save") so future-you doesn't get surprised.

**M3. `enrichSnapshotWithCalendarEvents` corrupt-JSON branch loses calendar events for that target**
`turn-handler.ts:430-443` — `continue` skips both the merge AND `target.write`, so calendar events for the corrupt-blob target are dropped from the in-memory snapshot. Correct trade vs the regression you fixed (manual shifts mattered more) — but worth a one-line note: "calendar events for THIS target also drop this turn; they'll re-fetch next turn once the blob is healed by the next parse_schedule write".

**M4. Window math vs user timezone — confirmed harmless, but document it**
`turn-handler-snapshot.ts:185-189` — `isoDateWithOffset` uses UTC; `todayIso` (line 222) also UTC. A user in Auckland near midnight local time can see a window edge that's "wrong" by 1 day vs their wall clock. Practical impact: a date the user calls "today" might land 1 day inside or outside the rendered window. Acceptable because the divider line is also UTC-relative (consistent), `query_schedule_history` covers any date Claude wants, and `WINDOW_DAYS_BACK=14` gives slack. Leave as-is; just add a one-liner comment noting the UTC choice and why it's OK.

**M5. `query_schedule_history` accepts the empty-string contact_name as "self"**
`turn-handler-tools.ts:1218` — `input.contact_name.trim()` after the typeof check means `""` and `"   "` both fall through to the self path. Probably fine (Claude won't pass a blank string on purpose), but if you want to be explicit, `if (typeof input.contact_name === "string" && input.contact_name.trim() !== "")` is clearer. `start_date == end_date` is correctly allowed (`start > end` is the only reject). Case-insensitive `.toLowerCase()` matches the convention in `persistShifts`. Good.

**M6. Cache-control on snapshot text still works, but window-render makes the snapshot text unstable across turns**
`turn-handler.ts:213` — `cache_control: { type: "ephemeral" }` on `snapshotText` is the third breakpoint. Within a single turn (multiple tool-loop iterations) the text is byte-identical, so cache hits as before — OK. Across turns, `today` advances, the active-window dates re-render, and shift entries can change → cache misses across turns, same as before windowing. Net change: zero. Note: removing the [RECENT HISTORY] block actually *improved* per-turn cache stability (it used to flip every message). No action needed — flagging only because you asked.

### nit

**N1. `[Earlier in this burst, the user also said:]` preamble**
`turn-handler.ts:243` — bullets join with `\n` but there's no separator from the user's actual message (`\n\n` after, but the bulleted list itself uses `- ` per line). Fine; just confirming intentional.

**N2. Trailing-user-run pop comment off-by-one**
See M1 — the JSDoc at lines 314-317 says "FIRST popped entry is the actual current turn echoing back". With `unshift`, the *last* element of `popped` is the echo. Code is correct, comment is inverted.

**N3. Test harness — `__HTTP_CODE__:` sentinel in body could collide with response content**
`send-telegram-update.sh` / `send-telegram-callback.sh` — if the Worker ever returns a body containing the literal `__HTTP_CODE__:NNN\n`, the `sed` strip drops it and `grep` over-matches. /webhook returns essentially-empty 200 today, so harmless. If you reuse the helpers for a non-trivial endpoint later, switch to `-w "%{stderr}…"` and capture stderr separately, or read `--write-out` to a fd.

**N4. Leftover `[RECENT HISTORY]` reference in test scenario script**
`meetsync/tools/test-scenarios/agentic-L4-06-recall-long-message.sh:6` — comment still references the old `User: <first 500 chars>… inside a flat [RECENT HISTORY]` framing. Cosmetic only; the assertion itself is fine. Update the comment when you next touch the file. (No other live-code references found — `phase-03-turn-handler-core.md` is a plan doc, fine.)

**N5. Unrelated 500-char references found in grep — all OK**
`schedule-parser.ts:403,411` (debug log), `telegram-client.ts:159` (file-content preview), `turn-handler-tools.ts:1368,1382` (reminder text cap, by design), `turn-handler.ts:712` (transcription error truncation). None depend on the worker's pre-log cap. No action.

---

## Verified

- Per-date merge symmetry across self / on-behalf paths and direct-shifts hatch — correct, single helper used everywhere.
- `merged` count log line accurate (`keptDateCount = totalDateCount - newDateCount` — works because newShifts dates were filtered out of `existing` first; no double-count).
- `attributedToName.toLowerCase()` lookup matches `add_contact`/snapshot convention.
- Dedup key `${date}|${start}|${end}|${label ?? ""}` — `?? ""` handles `undefined` and missing field; `""` already coerces to `""`. No collision risk.
- `buildMessagesArray` coalesce: when `last.content` is a string AND new entry comes in, `lastText = last.content`; when it's `ContentBlock[]`, only text blocks are joined (image/document blocks dropped on coalesce). Historical entries are always strings (from `conversation_log`), and the *current* turn (ContentBlock[]) is appended AFTER the loop — never coalesced into. Type flow is safe.
- Leading-assistant trim (`while messages[0].role !== "user"`) — correct.
- Windowed render: hidden-before/after counts, all-out-of-window divider path, MAX=35 cap message wording all coherent.
- Worker pre-log cap 500→4000 — only consumer is `conversation_log.message`, capped on the way out by `logMessage` (also 4000). Symmetric.
- L4-08 judge wording (185e266) — improvement: "must surface the shift hours" instead of "must NOT claim nothing on file". Tighter, less false-trigger surface for Haiku. Good.
- `d9422e3` curl streaming — `__HTTP_CODE__:` sentinel approach is reasonable; see N3 for the only theoretical risk.

---

## Unresolved questions

1. M2 — should corrupt schedule_json be self-healing (overwrite with valid new data) or fail-loud? Current behaviour is self-heal. Confirm intent.
2. M5 — should empty/whitespace `contact_name` be a tool error instead of falling through to self? Probably nit, but it's a small behaviour cliff.
3. N1 — preamble formatting confirmed intentional?
