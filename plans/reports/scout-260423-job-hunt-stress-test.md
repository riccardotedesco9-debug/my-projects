# Job-Hunt Pipeline Stress-Test Scout Report

**Date:** 2026-04-23 | **Scope:** Shipping readiness assessment | **Lines scanned:** ~2,500

---

## Summary

The job-hunt automation is architecturally sound and handles graceful degradation well across most failure surfaces. However, six material risks exist that will surface under load or edge-case data. Three are correctness hazards (silent data loss in dedup/LLM parsing); three are operational blind spots (cost, UX edge cases, regex brittleness). None are blockers, but all should be addressed before production shipping.

---

## HIGH-Severity Findings

**1. Dedup Sheet Read Failure → Silent Data Loss**
- **File:** orchestrator.ts lines 404–435 | **Impact:** Same jobs re-appear in digests across runs; user receives duplicates
- **Risk:** eadAllJobRows() in sheet-client.ts (line 45) has no try-catch at call site. If sheet is corrupt, inaccessible, or returns malformed data, orchestrator proceeds with an empty dedup index. Phase 5 (dedup) then skips all validation, and all 50–100 jobs from Phase 4 pass through to LLM ranking. User never knows the dedup layer failed.
- **Current mitigation:** Sheet client throws on auth/quota errors; orchestrator does not catch these.
- **Recommendation:** Wrap eadAllJobRows() in orchestrator Phase 1 with explicit error boundary. If read fails, either (a) abort with alert email, or (b) proceed in degraded mode with flagged-dedup bypass and send "⚠️ Dedup unavailable" header in digest.

**2. LLM JSON Parse Truncation → Silent Job Drop**
- **File:** llm-rank.ts lines 198–220 (Sonnet rerank loop) | **Impact:** Jobs with special chars in description silently excluded from top-30; user misses candidates
- **Risk:** Haiku triage returns scores for all ~100 jobs; top-30 are sent to Sonnet rerank. Sonnet's JSON response (array of ranked objects) is parsed with JSON.parse() at line 215. If a job description contains unescaped quotes or the response is truncated mid-object, parse fails. Catch block (line 217) logs a warning and returns [], skipping the entire batch. No retry, no partial salvage. Jobs silently disappear from digest.
- **Current mitigation:** Salvage logic exists for individual job JSON blobs (line 207) but not for batch response parsing.
- **Recommendation:** Add JSON repair/partial-parse before throwing. Extract valid objects from truncated response using regex {...} matching. Log count of salvaged vs. dropped jobs per batch.

**3. Firecrawl Search Cost Uncapped → Quota Surprise**
- **File:** orchestrator.ts lines 120–145 (Phase 1 scrape loop) | **Impact:** 700 search calls/run × unknown cost = unpredictable spend; potential API suspension mid-run
- **Risk:** 14 scrapers × 50 results per scraper = 700 Firecrawl /v1/search calls per run. Cost per call is unknown (vendor docs not referenced; likely \.01–0.05). No quota tracking, no cost projection, no spend alerts. If run frequency is daily, monthly bill could be \–\,000 without warning.
- **Current mitigation:** None. Firecrawl account has hard quota limit (assume \/month), but orchestrator has no awareness.
- **Recommendation:** (a) Query Firecrawl pricing and document in config.ts. (b) Add cost estimator: estimatedCostUSD = scraperCount * resultsPerScraper * costPerCall. (c) Log estimate at Phase 1 start. (d) If estimate > daily budget, either reduce result limit or skip low-priority sources.

---

## MEDIUM-Severity Findings

**4. Digest UX Edge Case: Zero-Match Days Ambiguous**
- **File:** digest-composer.ts lines 380–410 (zero-match branch) | **Impact:** User cannot distinguish "no jobs posted today" from "all jobs rejected by filters"
- **Risk:** When Phase 5 dedup + Phase 6 LLM filtering produce zero results, digest is sent with subject "🟢 No New Matches" and body showing a full funnel (0 scraped, 0 gated, 0 deduped, 0 scored). Sunday digests (heartbeat only, no scraping) also produce zero matches but use the same template. User sees identical email and cannot tell if job market dried up or the bot is broken. Also, "no new matches" subject line suggests "we looked and found nothing" but doesn't convey "on purpose filters rejected all."
- **Current mitigation:** Subject line includes emoji; body has funnel stats. But no separator between "zero matches due to low market activity" vs. "zero matches due to strict filters."
- **Recommendation:** (a) On zero matches, include filter reason in body: "All X candidates rejected by: relevance scores < threshold (Y) | location gating (Z)". (b) For heartbeat-only digests, use distinct subject: "💚 Scheduled Check-in (No Scraping)"—signals intentional, not a failure.

**5. Location Gating Regex Brittleness → Silent Regional Misclassification**
- **File:** orchestrator.ts lines 404–435 (passesGlobalGate()) | **Impact:** Job with "Remote(US)" passes when "Remote (US)" would correctly reject; false positives on region-locked jobs leak into digest
- **Risk:** Global gate uses regex patterns like /Remote\s+\(US\)/i and /Canada-only/i. Patterns fail on whitespace variations, parenthesis styles, abbreviations ("Remote – US" with en-dash), and timezone labels ("Irish Time" ≠ "IST" ≠ Malta TZ). Malta gate (line 379) checks for "malta" in locality but not regional names like "Valletta" or abbreviations like "VLT". Edge case: job posted as "Remote + Ireland office, Dublin-based preferred" passes Malta gate but may be strict on-site in practice.
- **Current mitigation:** Regex patterns catch most common formats; manual review of false positives is expected.
- **Recommendation:** (a) Expand regex to handle whitespace: /Remote[\s\-–—]*(?:Base|with)?[\s\(]*(?:US|USA|Canada)/i. (b) Add abbreviation map: { IST: "Ireland", VLT: "Malta", … }. (c) Log all regex decisions (matched pattern, job ID) for audit. (d) For "strong preference" vs. "requirement" language, add confidence score to gate result, tag digest entries with "⚠️ Location not verified" if confidence < 0.9.

**6. File Cohesion Boundary: Two 500-Line Files Complicate Refactoring**
- **File:** orchestrator.ts (516 lines), digest-composer.ts (501 lines) | **Impact:** During polish phase, refactoring email logic or scrape phase becomes high-risk and time-consuming
- **Risk:** Both files are near the 300-line comfort boundary. Orchestrator mixes pipeline orchestration (Phases 1–6), gate logic (Malta, global), and error handling. Digest composer bundles template generation, funnel stats, tier grouping, and HTML layout. If a bug is found in email formatting, changes affect 500-line file with many dependencies. No single-responsibility principle.
- **Current mitigation:** None; files are monolithic but well-commented.
- **Recommendation:** During Phase 2 (polish), extract: (a) gates.ts: Malta gate, global gate, location regex. (b) email-templates.ts: HTML layout, CSS, funnel rendering. (c) Keep orchestrator focused on Phase sequencing. Reduces cognitive load and test surface.

---

## Unresolved Questions

1. What is the actual cost per Firecrawl /v1/search call? (Vendor docs not found in codebase.)
2. Does eadAllJobRows() retry on transient sheet errors (quota, timeout), or fail immediately?
3. Are job descriptions HTML-encoded or plain text when stored in sheet? (Affects JSON serialization in Sonnet payload.)
4. How is the "intra-run collapse" dedup phase (lines 159–175) tested? No test files found.
5. What is the rollback plan if a bad Sonnet rerank weights all jobs as score=0?

---

## Prioritized Recommendations

1. **Immediate (pre-ship):** Add try-catch around eadAllJobRows() with alert email fallback.
2. **High:** Document Firecrawl cost and add cost estimator to orchestrator Phase 1.
3. **High:** Add JSON salvage logic to Sonnet parse; log recovery rate per batch.
4. **Medium:** Improve location regex; add abbreviation map and confidence scoring.
5. **Medium (polish phase):** Extract gates and email templates into separate modules.

---

**Confidence Level:** Medium-High. Code is well-structured and error-aware; risks are edge cases and load-dependent, not architectural flaws.
