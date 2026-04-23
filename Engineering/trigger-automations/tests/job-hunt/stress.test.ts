// job-hunt stress / fault-injection tests.
// Run:  npx tsx --test tests/job-hunt/stress.test.ts
//
// Covers the behaviours most likely to silently regress: filter pass-through
// of unknown-schedule jobs, Firecrawl budget enforcement, reputation worker
// dedupe by normalized key, LLM JSON salvage on truncated output, dedup's
// 6-layer pipeline, geo gates, metadata freshness, and the Sunday heartbeat
// subject split. No external calls — every network dependency is either
// avoided (pure function under test) or mocked inline.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runFilter } from "../../src/trigger/job-hunt/pipeline/filter.js";
import {
  tryReserveFirecrawl,
  resetFirecrawlBudget,
  getFirecrawlUsage,
} from "../../src/trigger/job-hunt/scrapers/firecrawl-search.js";
import { getReputationBatch } from "../../src/trigger/job-hunt/pipeline/company-reputation.js";
import { dedup, buildSheetIndex } from "../../src/trigger/job-hunt/pipeline/dedup.js";
import { passesMaltaGate } from "../../src/trigger/job-hunt/pipeline/malta-gate.js";
import {
  isFreshFromMetadata,
  matchClosedMarker,
} from "../../src/trigger/job-hunt/pipeline/freshness.js";
import {
  composeSubject,
  composeHeartbeat,
  __testables__ as digestTestables,
} from "../../src/trigger/job-hunt/digest-composer.js";
import type { Job, Reputation, SheetRow, RunStats } from "../../src/trigger/job-hunt/types.js";

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    sourceId: "test-1",
    source: "linkedin",
    url: "https://example.com/job/1",
    title: "data analyst",
    titleRaw: "Data Analyst",
    company: "acme",
    companyRaw: "Acme Ltd",
    location: "Malta",
    locality: "mellieha",
    workMode: "hybrid",
    partTime: "unknown",
    descriptionMd: "Analytical role working with SQL and Python.",
    estSalary: null,
    contact: null,
    postedAt: new Date().toISOString(),
    confidence: "high",
    fingerprint: "fp-1",
    score: 0,
    ...overrides,
  };
}

function makeStats(overrides: Partial<RunStats> = {}): RunStats {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    perSource: { linkedin: { fetched: 10, passed: 8, error: null } },
    totalRaw: 10,
    afterGeoGate: 10,
    afterFilter: 8,
    afterMetaFreshness: 8,
    afterDedup: 8,
    afterAutoReject: 5,
    afterUrlVerify: 5,
    newJobs: 5,
    digestSent: false,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────
// 1–3. Filter pass-through behaviour
// ────────────────────────────────────────────────────────────────────

test("filter: partTime=unknown is rejected (strict PT-only policy)", () => {
  // Policy: "if a listing doesn't say part-time, assume full-time and drop".
  // Scrapers with no description (Castille sitemap, MFSA) go dark — acceptable
  // tradeoff for a lean part-time-only digest.
  const job = makeJob({ partTime: "unknown", title: "data analyst" });
  const result = runFilter(job);
  assert.equal(result.pass, false);
  assert.match(result.reasons[0], /no part-time indication|silent = FT/);
});

test("filter: partTime=no is explicitly rejected", () => {
  const job = makeJob({ partTime: "no" });
  const result = runFilter(job);
  assert.equal(result.pass, false);
  assert.match(result.reasons[0], /explicitly full-time/);
});

test("filter: partTime=yes passes through", () => {
  const job = makeJob({ partTime: "yes", title: "data analyst" });
  const result = runFilter(job);
  assert.equal(result.pass, true);
});

test("filter: excluded title (waiter) rejected even when partTime=yes", () => {
  const job = makeJob({ partTime: "yes", title: "part time waiter" });
  const result = runFilter(job);
  assert.equal(result.pass, false);
  assert.match(result.reasons[0], /title matches non-analytical/);
});

// ────────────────────────────────────────────────────────────────────
// 4. Firecrawl budget counter
// ────────────────────────────────────────────────────────────────────

test("firecrawl budget: allows up to limit, then refuses", () => {
  const prev = process.env.FIRECRAWL_RUN_BUDGET;
  process.env.FIRECRAWL_RUN_BUDGET = "3";
  resetFirecrawlBudget();
  try {
    assert.equal(tryReserveFirecrawl("t1"), true);
    assert.equal(tryReserveFirecrawl("t2"), true);
    assert.equal(tryReserveFirecrawl("t3"), true);
    assert.equal(tryReserveFirecrawl("t4"), false, "4th call must be refused at budget=3");
    assert.equal(tryReserveFirecrawl("t5"), false, "subsequent calls stay refused");
    const usage = getFirecrawlUsage();
    assert.equal(usage.calls, 3);
    assert.equal(usage.budget, 3);
  } finally {
    if (prev === undefined) delete process.env.FIRECRAWL_RUN_BUDGET;
    else process.env.FIRECRAWL_RUN_BUDGET = prev;
    resetFirecrawlBudget();
  }
});

test("firecrawl budget: resetFirecrawlBudget() resets counter", () => {
  process.env.FIRECRAWL_RUN_BUDGET = "2";
  resetFirecrawlBudget();
  tryReserveFirecrawl("a");
  tryReserveFirecrawl("b");
  assert.equal(tryReserveFirecrawl("c"), false);
  resetFirecrawlBudget();
  assert.equal(tryReserveFirecrawl("d"), true, "after reset the counter starts fresh");
  delete process.env.FIRECRAWL_RUN_BUDGET;
  resetFirecrawlBudget();
});

// ────────────────────────────────────────────────────────────────────
// 5. Reputation batch dedupe by normalized key
// ────────────────────────────────────────────────────────────────────

test("reputation batch: dedupes across raw-string variants of the same company", async () => {
  // Block all live fetches via exhausted budget — we only care that the batch
  // NEVER calls the live fetch path twice for aliases.
  const prev = process.env.FIRECRAWL_RUN_BUDGET;
  process.env.FIRECRAWL_RUN_BUDGET = "0";
  resetFirecrawlBudget();
  try {
    const cache = new Map<string, Reputation>();
    const cached: Reputation = {
      company: "bvnk",
      fetchedAt: new Date().toISOString(),
      glassdoor: { rating: 4.2, reviews: 120 },
    };
    cache.set("bvnk", cached);
    const newEntries = new Map<string, Reputation>();
    // Feed 3 aliases of same company + one distinct.
    const res = await getReputationBatch(
      ["BVNK Ltd", "bvnk", "BVNK", "Betsson Group"],
      cache,
      newEntries,
      5,
    );
    // bvnk served from cache; betsson attempted live fetch but budget=0 → null.
    assert.equal(res.size, 1, "only the cached one should resolve");
    assert.ok(res.has("bvnk"), "bvnk key should resolve from cache");
  } finally {
    if (prev === undefined) delete process.env.FIRECRAWL_RUN_BUDGET;
    else process.env.FIRECRAWL_RUN_BUDGET = prev;
    resetFirecrawlBudget();
  }
});

// ────────────────────────────────────────────────────────────────────
// 6. Dedup — 6-layer pipeline
// ────────────────────────────────────────────────────────────────────

test("dedup: fingerprint match against sheet → merge, not new", () => {
  const existingRow: SheetRow = {
    date_seen: "2026-04-20",
    sources: "linkedin",
    source_ids: "linkedin:abc",
    title: "data analyst",
    company: "acme",
    location: "Malta",
    locality: "mellieha",
    work_mode: "hybrid",
    part_time_yn: "yes",
    est_salary: "",
    contact: "",
    url: "https://linkedin.com/jobs/1",
    all_urls: "https://linkedin.com/jobs/1",
    status: "new",
    notes: "",
    digest_sent: "Y",
    fingerprint: "shared-fp",
    confidence: "high",
    score: "75",
  };
  const index = buildSheetIndex([existingRow]);
  const incoming = makeJob({
    source: "konnekt",
    sourceId: "xyz",
    fingerprint: "shared-fp",
    url: "https://konnekt.com/jobs/999",
  });
  const out = dedup([incoming], index);
  assert.equal(out.newJobs.length, 0, "fingerprint match must not create a new row");
  assert.equal(out.merges.length, 1, "fingerprint match must emit a merge");
  assert.match(out.merges[0].merged.all_urls, /konnekt\.com/);
});

test("dedup: intra-run collapse picks highest-priority source as winner", () => {
  const a = makeJob({
    source: "linkedin",
    sourceId: "a",
    fingerprint: "same-fp",
    url: "https://linkedin.com/a",
  });
  const b = makeJob({
    source: "castille",
    sourceId: "b",
    fingerprint: "same-fp",
    url: "https://castille.com/b",
  });
  const emptyIndex = buildSheetIndex([]);
  const out = dedup([a, b], emptyIndex);
  assert.equal(out.newJobs.length, 1, "duplicates must collapse intra-run");
  assert.equal(out.newJobs[0].source, "castille", "castille (priority 100) beats linkedin (60)");
});

test("dedup: fuzzy short-string guard prevents false merge", () => {
  // Both titles under 25 chars — fuzzy path must refuse to match.
  const short: SheetRow = {
    date_seen: "2026-04-20",
    sources: "linkedin",
    source_ids: "linkedin:1",
    title: "analyst",
    company: "acme",
    location: "Malta",
    locality: "",
    work_mode: "unclear",
    part_time_yn: "unknown",
    est_salary: "",
    contact: "",
    url: "https://example.com/a",
    all_urls: "https://example.com/a",
    status: "new",
    notes: "",
    digest_sent: "N",
    fingerprint: "diff-fp-1",
    confidence: "medium",
    score: "50",
  };
  const index = buildSheetIndex([short]);
  const incoming = makeJob({
    title: "analysts", // 1-char edit; but strings short → must not merge
    fingerprint: "diff-fp-2",
    url: "https://example.com/b",
  });
  const out = dedup([incoming], index);
  assert.equal(out.newJobs.length, 1, "short-title pairs must not fuzzy-merge");
  assert.equal(out.merges.length, 0);
});

// ────────────────────────────────────────────────────────────────────
// 7. Malta + global gates
// ────────────────────────────────────────────────────────────────────

test("malta gate: job with Malta locality passes", () => {
  const job = makeJob({ locality: "sliema" });
  assert.equal(passesMaltaGate(job), true);
});

test("malta gate: pure remote without Malta signal is rejected", () => {
  const job = makeJob({
    locality: null,
    location: "Remote",
    workMode: "remote",
    descriptionMd: "Work from anywhere in the world.",
  });
  assert.equal(passesMaltaGate(job), false, "remote-anywhere without Malta anchor must fail");
});

// ────────────────────────────────────────────────────────────────────
// 8. Freshness metadata gate
// ────────────────────────────────────────────────────────────────────

test("freshness/meta: 90-days-ago is rejected", () => {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const job = makeJob({ postedAt: ninetyDaysAgo });
  const result = isFreshFromMetadata(job);
  assert.equal(result.fresh, false);
  assert.match(result.reason ?? "", /d old/);
});

test("freshness/meta: '3 months ago' in snippet is rejected", () => {
  const job = makeJob({
    postedAt: null,
    titleRaw: "Data Analyst 3 months ago",
    descriptionMd: "Posted 3 months ago. Apply now.",
  });
  const result = isFreshFromMetadata(job);
  assert.equal(result.fresh, false);
});

test("freshness/meta: recent job passes", () => {
  const job = makeJob({ postedAt: new Date().toISOString() });
  const result = isFreshFromMetadata(job);
  assert.equal(result.fresh, true);
});

// ────────────────────────────────────────────────────────────────────
// 9. Digest subject + heartbeat branches
// ────────────────────────────────────────────────────────────────────

test("composeSubject: heartbeat flag produces distinct subject", () => {
  const stats = makeStats();
  const weekdayZero = composeSubject({ jobs: [], stats, cappedAt: 0 });
  const heartbeat = composeSubject({ jobs: [], stats, cappedAt: 0, heartbeat: true });
  assert.notEqual(weekdayZero, heartbeat, "heartbeat subject must differ from weekday zero-match");
  assert.match(heartbeat, /heartbeat/i);
  assert.match(weekdayZero, /no new matches/i);
});

test("composeHeartbeat: body conveys 'healthy, nothing to report' not 'failure'", () => {
  const stats = makeStats();
  const html = composeHeartbeat(stats);
  assert.match(html, /healthy/i);
  assert.match(html, /nothing/i);
  assert.doesNotMatch(html, /⚠/, "heartbeat must not show warning markers");
  assert.doesNotMatch(html, /failed/i, "heartbeat must not say 'failed'");
});

// ────────────────────────────────────────────────────────────────────
// 10. Subject sanity: non-zero match
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// 10b. Closed-listing markers in body text (freshness Layer B)
// ────────────────────────────────────────────────────────────────────

const CLOSED_BODY_SAMPLES = [
  "The best role for you. this role is no longer accepting applications. Learn more",
  "This position has been filled. We'll post new roles soon.",
  "this vacancy has been closed",
  "the job is no longer available",
  "we are no longer accepting applications for this role",
  "applications are closed",
  "applications have now closed for this position",
  "no longer accepting applicants",
  "position filled — thank you for your interest",
  "role filled. please check our other openings.",
  "job expired — check our careers page for active postings",
  "we have filled this opportunity. stay tuned.",
  "this role has been withdrawn from the site",
  "this advertisement is no longer available",
  "vacancy closed to applications",
  "this opportunity is no longer available",
  "we are no longer hiring for this role",
  "this role is no longer being advertised",
];

for (const sample of CLOSED_BODY_SAMPLES) {
  test(`closed-marker: detects "${sample.slice(0, 60)}${sample.length > 60 ? "…" : ""}"`, () => {
    const match = matchClosedMarker(sample.toLowerCase());
    assert.ok(match !== null, `should flag as closed, pattern set missed this phrasing`);
  });
}

const LIVE_BODY_SAMPLES = [
  "Apply now for this exciting role at Acme. We are growing our team.",
  "We're looking for a Data Analyst to join our hybrid team in Malta.",
  "About the role: you will be responsible for building dashboards.",
  "Salary: €35,000. Apply by 2026-05-30.",
  "We closed our Series B last quarter and are expanding.", // safe: "we closed" not on a listing-noun
];

for (const sample of LIVE_BODY_SAMPLES) {
  test(`closed-marker: does NOT flag live listing "${sample.slice(0, 60)}${sample.length > 60 ? "…" : ""}"`, () => {
    const match = matchClosedMarker(sample.toLowerCase());
    assert.equal(match, null, `false positive on live listing`);
  });
}

// ────────────────────────────────────────────────────────────────────
// 11. cleanDesc — Google snippet trailing-ellipsis handling
// ────────────────────────────────────────────────────────────────────

test("cleanDesc: strips Google's trailing '...' and trims to last sentence", () => {
  const { cleanDesc } = digestTestables;
  const googleSnippet =
    "We are seeking a diligent professional for an AML role. The successful candidate will work with...";
  const out = cleanDesc(googleSnippet);
  assert.doesNotMatch(out, /\.\.\.\s*$/, "must not end with Google's three-dot ellipsis");
  assert.doesNotMatch(out, /…\s*$/, "must not end with unicode ellipsis when we trimmed upstream one");
  assert.match(out, /AML role\.$/, "trim back to the last sentence");
});

test("cleanDesc: over-long text cuts at sentence boundary, not mid-word", () => {
  const { cleanDesc } = digestTestables;
  const long =
    "Lorem ipsum dolor sit amet. ".repeat(25) + // ~700 chars
    "Consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
  const out = cleanDesc(long);
  assert.ok(out.length <= 600, `truncation should bound output (got ${out.length})`);
  assert.match(out, /[.!?]$|…$/, "output ends at a punctuation boundary or explicit ellipsis");
});

test("cleanDesc: description shorter than MAX with clean end is preserved verbatim", () => {
  const { cleanDesc } = digestTestables;
  const short = "This is a complete sentence. And another one.";
  assert.equal(cleanDesc(short), short);
});

test("cleanDesc: stub-only upstream snippet collapses to empty when all we have is '...'", () => {
  const { cleanDesc } = digestTestables;
  assert.equal(cleanDesc("..."), "");
  assert.equal(cleanDesc("…"), "");
  assert.equal(cleanDesc("   …   "), "");
});

test("composeSubject: non-zero match shows count + top categories", () => {
  const stats = makeStats();
  const jobs = [
    makeJob({ sourceId: "1", tags: ["compliance", "hybrid"] }),
    makeJob({ sourceId: "2", tags: ["compliance", "aml"] }),
    makeJob({ sourceId: "3", tags: ["finance"] }),
  ];
  const subject = composeSubject({ jobs, stats, cappedAt: 0 });
  assert.match(subject, /3 new match/);
  assert.match(subject, /compliance/);
});
