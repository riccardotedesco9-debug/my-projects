# Diagnosis — Diego Schedule Parse Failure

**Chat**: 8641024183 (Riccardo). **Date**: 2026-04-15. **Source**: D1 `conversation_log`.

## Summary

The bot DID produce shifts for Diego, but with two observable pathologies — both matching the suppressors in the approved plan.

## Evidence

### Pathology 1: Inconsistent re-parses of the SAME image

Same `file_id` (`AgACAg...3QBAAMCAAN5AAM7BA`, full-week rota) re-parsed three times, produced three different Sat 18 values:

| Attempt | Sat 18 |
|---|---|
| 1st parse | 14:00 – 17:00  (BAR / Deliveries) |
| 2nd parse | 12:00 – 03:00  (BAR / Deliveries) |
| 3rd parse | 12:00 – 00:30  (BAR + Deliveries 14–17) |

Bot self-reported "confidence drops to 0.75 on Sat/Sun". Variance across identical inputs ⇒ the model is not reasoning stably, just pattern-matching differently each call. **Fix: extended thinking (Change 2) + Opus (Change 1)** give the model room to anchor its reading to visible evidence before emitting JSON.

### Pathology 2: Row identification abandoned

On the second image (`AgACAg...E0BAAMCAAN5AAM7BA`, weekend-only rota), the bot produced candidate shifts then capitulated when challenged: *"parser couldn't confidently identify Diego's specific row... it's a multi-person sheet and it can't reliably isolate which row belongs to him."*

The user pasted the same image into Claude.ai and got correct shifts including a shift split across two rows. The image IS readable; the parser is throwing reasoning power away. **Fix: explicit two-step row-ID (Change 5)** makes row identification an auditable first-class step, not an implicit ask buried in a 115-line prompt.

### Pathology 3 (inferred from Pathology 2): Split-shift handling

The weekend rota showed Diego with a shift split across two rows (AM/PM pair). The first pass missed this (Sat read as "14:00–17:00" — only the delivery slice, missing the BAR slice). Claude.ai reassembled both. **Fix: Change 5 explicitly names the split-row failure mode** in the prompt.

## Which Suppressors Hit

All five from the plan contribute, but in priority order of impact on this case:

1. **No extended thinking** — explains the Pathology 1 variance directly.
2. **No explicit row-ID step** — explains Pathology 2 directly.
3. **Model: Sonnet 4.6 vs Opus 4.6** — Opus would handle ambiguous multi-row layouts more robustly.
4. **"Return ONLY JSON" + prompt order** — compound the above.

## Recommendation

Proceed with all 5 changes as planned. No scope trim needed — each change addresses a distinct part of the observed failure.

## Ground Truth (provided by Riccardo, 2026-04-15 15:23)

For the FIRST image (full-week rota, file_id `AgACAg...3QBAAMCAAN5AAM7BA`):

| Day | Actual | 1st-parse output | Match |
|---|---|---|---|
| Mon 13 | OFF | OFF | ✓ |
| Tue 14 | FCN 15:30–00:30 | 15:30–00:30 (FCN) | ✓ |
| Wed 15 | BAR 15:30–00:30 | 15:30–00:30 (BAR) | ✓ |
| Thu 16 | OFF | OFF | ✓ |
| Fri 17 | **HK 12:00–14:00 + Deliveries 14:00–17:00** (split!) | 16:00–00:30 (FR) | ✗ |
| Sat 18 | FR 16:00–00:30 | 14:00–17:00 (BAR/Deliveries) | ✗ |
| Sun 19 | BAR 12:00–00:00 | 12:00–03:00 (BAR) | ✗ |

**New pathology: day drift.** The parser didn't just misread — it *shifted labels forward by one day* starting at Fri. Sat's "FR" label landed on Fri; Fri's "Deliveries" landed on Sat. The Fri 17 split shift (HK + Deliveries on the same day) was completely missed — Claude collapsed it and grabbed only one slice for the wrong day. Sun's end time drifted from 00:00 to 03:00 (probably bled over from a neighbouring row).

Root cause: the parser has **no row-as-anchor discipline**. It reads entries and guesses day labels rather than locking to the visible date column. Extended thinking (Change 2) + the explicit row-ID step (Change 5) directly address this — a think-aloud preamble naming "Diego is row X, date column is column Y, reading left-to-right" forces the model to commit to an anchor before extracting.

## Unresolved

- Does the weekend image actually have Diego's shift split across two rows, or was Claude.ai inferring it from context? (Would need to re-examine the image — out of scope for diagnosis.)
- Confidence score (0.75) is surfaced in bot copy but not gated — should low-confidence parses trigger a "confirm this" flow? (Future improvement, not part of this plan.)
- Should Change 5 explicitly mention "split shifts where one day has two time windows" (like Diego's Fri 17)? The current plan wording covers "spans two rows" but Riccardo's case is "two windows on one day" — slightly different. Worth expanding the prompt example.
