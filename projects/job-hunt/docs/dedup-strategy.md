# Dedup strategy

Same role crossposted to 4-5 sources would flood the digest. The pipeline collapses duplicates in 6 layers.

## Layer 1 — Normalize
Both sides of any comparison pass through `normTitle()` and `normCompany()`:
- lowercase + strip accents
- remove qualifiers: `part-time`, `full-time`, `hybrid`, `remote`, `contract`, `permanent`, `pt`, `ft`, `temp`, `freelance`
- strip company suffixes: `Ltd`, `plc`, `Inc`, `LLC`, `GmbH`, `Holdings`, `Group`, `Co.`

Result: "Data Analyst (Part-Time, Hybrid)" + "Bet365 Malta Ltd" → `"data analyst"` + `"bet365 malta"`

## Layer 2 — Exact fingerprint
`fingerprint = sha256(normTitle + "|" + normCompany)[:16]` — 64-bit prefix is enough given our scale.

On startup we load every fingerprint from the sheet into a `Set<string>` — O(1) membership check. Matches here short-circuit the other layers.

## Layer 3 — Fuzzy fallback
For entries that survived layer 2, compare `"title|company"` with Levenshtein ratio against every row seen in the last 30 days.
- Threshold: **0.92** (conservative — only 1-2 char differences trigger)
- Catches: "data analyst" vs "data analyst ii", "bet365" vs "bet 365"

## Layer 4 — URL safety net
Direct URL compare against:
- Col L (`url`) — winner URL
- Col M (`all_urls`) — every source URL we've logged for this role

Catches cases where titles differ but a common application URL reveals the match.

## Layer 5 — Source priority
When duplicates collapse, winner = highest `SOURCE_PRIORITY` value:
```
castille (100) > konnekt (90) > keepmeposted (80) > jobsplus (70)
  > linkedin (60) > indeed-mt (40) > careerjet (30)
```
Rationale: specialist recruiters > Malta-specific > aggregators > aggregator-of-aggregators.

## Layer 6 — Intra-run collapse
Before comparing to the sheet, collapse duplicates inside the current scrape batch. Prevents double-insert when the same role appears in the same run from two sources.

## Merge behaviour
When a duplicate is detected:
- Keep the existing row unchanged (title, company, description — all from the winner source)
- Append the new URL to `all_urls` (comma-separated)
- Append the new source to `sources` (comma-separated)
- Append `{source}:{sourceId}` to `source_ids`

The row's `digest_sent` flag is **not** re-sent — we send each role once, even if new sources later add to its trail.

## Escape hatches
- False-merge suspicion → `node tools/reset-dedup.mjs` clears the fingerprint column. Next run re-dedups from scratch.
- Tune threshold → edit `LIMITS.fuzzyThreshold` in `config.ts`.
