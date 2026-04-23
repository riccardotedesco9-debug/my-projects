// orchestrator.ts — pipeline driver. Called by daily-scan.ts (cron) and by
// local dry-run.mjs (set JOBHUNT_DRY_RUN=true). Steps:
//   1. scrape 7 sources in parallel (Promise.allSettled — one fail ≠ abort)
//   2. normalize → malta-gate → filter → score (drop failures)
//   3. build sheet index, run 6-layer dedup
//   4. extract contact info for survivors
//   5. append new rows + apply merges to sheet
//   6. if new > 0: cap digest + compose + send email
//   7. write run_log row (always, zero days included)
//
// Failure modes:
//   - Any phase crashes → send failure email (if GMAIL_RECIPIENT set), rethrow
//   - All 7 scrapers fail → treat as run failure
//   - Dedup/score errors for a single job → drop job, continue

import { scrapersForTrack } from "./scrapers/index.js";
import { SOURCE_ENABLED, LIMITS } from "./config.js";
import { normalize } from "./pipeline/normalize.js";
import { passesMaltaGate } from "./pipeline/malta-gate.js";
import { runFilter } from "./pipeline/filter.js";
import { rankBatchHaiku, rerankSonnet } from "./pipeline/llm-rank.js";
import { getReputationBatch } from "./pipeline/company-reputation.js";
import { buildSheetIndex, dedup } from "./pipeline/dedup.js";
import { extractContact } from "./pipeline/contact.js";
import { isFreshFromMetadata, verifyActiveBatch } from "./pipeline/freshness.js";
import {
  readAllJobRows,
  appendRows,
  appendRunLog,
  mergeSourceIntoRow,
  readProfile,
  readRatingCache,
  upsertRatings,
  JOBS_TAB,
  JOBS_GLOBAL_TAB,
  RUN_LOG_TAB,
  RUN_LOG_GLOBAL_TAB,
} from "./sheet-client.js";
import { sendEmail } from "./gmail-client.js";
import {
  composeDailyDigest,
  composeFailureAlert,
  composeSubject,
} from "./digest-composer.js";
import { detectSilentSources } from "./source-monitor.js";
import type { Job, RunStats, SheetRow, Source, Track, Reputation } from "./types.js";
import { normCompany } from "./pipeline/normalize.js";

export interface OrchestratorOptions {
  dryRun?: boolean;              // skip sheet writes + email
  digestCap?: number;            // override LIMITS.digestCap
  track?: Track;                 // "malta" (default) | "global"
}

export async function runJobHunt(opts: OrchestratorOptions = {}): Promise<RunStats> {
  const dryRun = opts.dryRun ?? process.env.JOBHUNT_DRY_RUN === "true";
  const digestCap = opts.digestCap ?? Number(process.env.JOBHUNT_DIGEST_CAP ?? LIMITS.digestCap);
  // NOTE: "Gmail_Recepient" is a deliberate typo — matches the env var name
  // registered in the Trigger.dev dashboard. Do not "fix" to "Recipient" or
  // the runtime lookup breaks and digests stop sending.
  const recipient = process.env.Gmail_Recepient;
  if (!recipient) console.warn("[job-hunt] Gmail_Recepient not set — digests will be skipped");
  const track: Track = opts.track ?? "malta";
  const jobsTab = track === "malta" ? JOBS_TAB : JOBS_GLOBAL_TAB;
  const runLogTab = track === "malta" ? RUN_LOG_TAB : RUN_LOG_GLOBAL_TAB;
  const subjectPrefix = track === "malta" ? "" : "[Global] ";

  const stats: RunStats = {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    // Only track the sources actually used by this track — prevents the other
    // track's sources showing as "silent" in this digest's health-check alert.
    perSource: emptyPerSource(track),
    totalRaw: 0,
    afterMaltaGate: 0,
    afterFilter: 0,
    afterMetaFreshness: 0,
    afterDedup: 0,
    afterAutoReject: 0,
    afterUrlVerify: 0,
    newJobs: 0,
    digestSent: false,
  };

  let phase = "init";
  try {
    // 1. Scrape — allSettled so one dead source doesn't sink the run
    phase = "scrape";
    const rawJobs = await scrapeAll(stats, track);
    stats.totalRaw = rawJobs.length;

    if (rawJobs.length === 0 && allSourcesErrored(stats)) {
      throw new Error("All enabled sources failed — cannot proceed");
    }

    // 2. Normalize + geo-gate (track-specific) + filter + metadata-freshness + score
    phase = "pipeline";
    const processed: Job[] = [];
    let staleDroppedMeta = 0;
    for (const raw of rawJobs) {
      try {
        const job = normalize(raw);
        if (track === "malta" && !passesMaltaGate(job)) continue;
        if (track === "global" && !passesGlobalGate(job)) continue;
        stats.afterMaltaGate++;
        const filter = runFilter(job);
        if (!filter.pass) continue;
        stats.afterFilter++;
        // Layer A freshness (cheap, metadata-only)
        const meta = isFreshFromMetadata(job);
        if (!meta.fresh) {
          staleDroppedMeta++;
          continue;
        }
        // score is set by the LLM-rank stage below. Jobs that fail ranking
        // get score=0 and are filtered out, so no default needed here.
        processed.push(job);
      } catch (err) {
        console.warn(`pipeline skip ${raw.source}:${raw.sourceId}:`, err instanceof Error ? err.message : err);
      }
    }
    stats.afterMetaFreshness = processed.length;
    if (staleDroppedMeta > 0) console.log(`[freshness/meta] dropped ${staleDroppedMeta} stale postings`);

    // 3. Dedup vs sheet + intra-run
    phase = "dedup";
    let newJobs: Job[] = processed;
    let merges: Array<{ rowIndex: number; merged: SheetRow }> = [];
    if (!dryRun) {
      const existingRows = await readAllJobRows(jobsTab);
      const index = buildSheetIndex(existingRows);
      const out = dedup(processed, index);
      newJobs = out.newJobs;
      merges = out.merges;
    } else {
      // dry-run: still collapse intra-run so the preview is realistic
      const out = dedup(processed, { byFingerprint: new Map(), byUrl: new Map(), recentRows: [] });
      newJobs = out.newJobs;
    }
    stats.afterDedup = newJobs.length;

    // 4. Contact extraction
    phase = "contact";
    for (const j of newJobs) {
      if (!j.contact) j.contact = extractContact(j);
    }

    // 4b. LLM ranking — CV-aware fit assessment (Haiku triage → Sonnet rerank top-K).
    // Runs in dry-run too (no side effects beyond paid API calls) so we can
    // validate ranking + funnel end-to-end without writing to sheet or emailing.
    phase = "llm-rank";
    if (newJobs.length > 0) {
      const profile = await readProfile();
      if (profile.length > 0) {
        const haiku = await rankBatchHaiku(profile, newJobs, 15);
        for (const j of newJobs) {
          const a = haiku.get(j.sourceId);
          if (a) {
            j.score = a.fitScore;
            j.fitScoreRaw = a.fitScore;
            j.fit = a.fit;
            j.redFlags = a.redFlags;
            j.tags = a.tags;
          }
        }
        console.log(`[llm-rank] Haiku scored ${haiku.size}/${newJobs.length} jobs`);

        // Reputation lookup — run between Haiku and Sonnet so Sonnet can cite
        // ratings in fit/redFlags. Cache-first; only unknown/stale companies
        // hit Firecrawl. Degrades gracefully if credits exhausted.
        newJobs.sort((a, b) => b.score - a.score);
        const topForSonnet = newJobs.slice(0, Math.min(30, newJobs.length));
        try {
          const ratingCache = await readRatingCache();
          const newRatings = new Map<string, Reputation>();
          // Key rawNames by the SAME normalization used on the fetch path
          // (company || companyRaw) so `upsertRatings` finds the human-readable
          // name for column B. Previously keyed solely off companyRaw → misses.
          const rawNames = new Map<string, string>();
          for (const j of topForSonnet) {
            const key = normCompany(j.company || j.companyRaw);
            if (!key) continue;
            if (j.companyRaw) rawNames.set(key, j.companyRaw);
            else if (j.company) rawNames.set(key, j.company);
          }
          const reputations = await getReputationBatch(
            topForSonnet.map((j) => j.company || j.companyRaw).filter(Boolean),
            ratingCache,
            newRatings,
            5,
          );
          for (const j of topForSonnet) {
            const key = normCompany(j.company || j.companyRaw);
            const rep = reputations.get(key);
            if (rep) j.reputation = rep;
          }
          if (!dryRun && newRatings.size > 0) await upsertRatings(newRatings, rawNames);
          console.log(`[reputation] attached ${reputations.size}/${topForSonnet.length} · cached ${ratingCache.size} · fetched ${newRatings.size}`);
        } catch (err) {
          console.warn("[reputation] batch failed, continuing without ratings:", err instanceof Error ? err.message : err);
        }

        // Sonnet rerank — deeper pass with reputation context in the prompt.
        const sonnet = await rerankSonnet(profile, topForSonnet, 10);
        for (const j of topForSonnet) {
          const a = sonnet.get(j.sourceId);
          if (a) {
            j.score = a.fitScore;  // Sonnet's score wins
            j.fit = a.fit;
            j.redFlags = a.redFlags;
            j.tags = a.tags;
          }
        }
        console.log(`[llm-rank] Sonnet reranked ${sonnet.size}/${topForSonnet.length} top jobs`);
      } else {
        console.warn("[llm-rank] empty profile — skipping LLM pass, falling back to keyword scores");
      }
    }

    // 4c. Drop auto-rejects — the profile instructs the LLM to return
    //     fitScore=0 when a job violates a hard constraint (full-time only,
    //     under salary floor, language mismatch, specialised credential, etc).
    //     These jobs shouldn't appear in the digest OR clutter the sheet.
    const beforeReject = newJobs.length;
    newJobs = newJobs.filter((j) => j.score > 0);
    const autoRejected = beforeReject - newJobs.length;
    stats.afterAutoReject = newJobs.length;
    if (autoRejected > 0) console.log(`[llm-rank] auto-rejected ${autoRejected} jobs (fitScore=0)`);

    // 5. Sort + cap (final order is by LLM fitScore)
    newJobs.sort((a, b) => b.score - a.score);
    let candidateDigest = newJobs.slice(0, digestCap);

    // Layer B freshness — network-verify URLs of digest-bound jobs. Drops
    // 404/410/redirects-to-listing/closed-marker pages. Parallelised with
    // concurrency=5, 8s timeout each. Conservative: network errors → keep.
    phase = "freshness-verify";
    if (!dryRun && candidateDigest.length > 0) {
      const verdicts = await verifyActiveBatch(candidateDigest, 5);
      const stale: Job[] = [];
      candidateDigest = candidateDigest.filter((j) => {
        const v = verdicts.get(j.url);
        if (v && !v.fresh) {
          stale.push(j);
          console.warn(`[freshness/url] drop ${j.source}:${j.sourceId} — ${v.reason}`);
          return false;
        }
        return true;
      });
      // Also remove stale entries from the sheet-writes so we don't store dead rows
      const staleUrls = new Set(stale.map((s) => s.url));
      newJobs = newJobs.filter((j) => !staleUrls.has(j.url));
      if (stale.length > 0) console.log(`[freshness/url] verified ${candidateDigest.length + stale.length} jobs, dropped ${stale.length} inactive`);
    }

    const cappedAt = Math.max(0, newJobs.length - candidateDigest.length);
    const digestJobs = candidateDigest;
    stats.afterUrlVerify = newJobs.length;
    stats.newJobs = newJobs.length;

    // 6. Write to sheet
    phase = "sheet-write";
    if (!dryRun) {
      const rowsToAppend = newJobs.map((j) => jobToSheetRow(j, digestJobs.includes(j)));
      if (rowsToAppend.length > 0) await appendRows(rowsToAppend, jobsTab);
      for (const m of merges) await mergeSourceIntoRow(m.rowIndex, m.merged, jobsTab);
    }

    // 7. Email
    phase = "email";
    stats.finishedAt = new Date().toISOString();
    const healthWarnings = dryRun ? [] : await safeDetectSilentSources(track);
    const shouldSend = !dryRun && recipient && (digestJobs.length > 0 || isSunday(stats.startedAt));
    if (shouldSend) {
      const html = composeDailyDigest({
        jobs: digestJobs,
        stats,
        cappedAt,
        unhealthySources: healthWarnings,
      });
      await sendEmail({
        to: recipient!,
        subject: subjectPrefix + composeSubject({ jobs: digestJobs, stats, cappedAt }),
        html,
      });
      stats.digestSent = true;
    } else if (dryRun) {
      // Dry-run preview: compose digest + dump HTML locally so the funnel
      // summary can be visually validated without actually sending.
      await writeDryRunPreview(track, digestJobs, stats, cappedAt);
    }

    // Always log the run
    phase = "run-log";
    if (!dryRun) await appendRunLog(stats, runLogTab);

    return stats;
  } catch (err) {
    stats.finishedAt = new Date().toISOString();
    console.error(`[job-hunt] failure in phase=${phase}:`, err);
    if (!dryRun && recipient) {
      try {
        await sendEmail({
          to: recipient,
          subject: `⚠ job-hunt failed (${phase})`,
          html: composeFailureAlert(err, stats, phase),
        });
      } catch (mailErr) {
        console.error("[job-hunt] also failed to send failure email:", mailErr);
      }
    }
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

async function scrapeAll(
  stats: RunStats,
  track: Track,
): Promise<Array<Partial<Job> & { source: Source }>> {
  const registry = scrapersForTrack(track);
  const entries = (Object.entries(registry) as Array<[Source, () => Promise<Partial<Job>[]>]>).filter(
    ([s]) => SOURCE_ENABLED[s],
  );
  const results = await Promise.allSettled(
    entries.map(async ([source, fn]) => ({ source, jobs: await fn() })),
  );

  const raw: Array<Partial<Job> & { source: Source }> = [];
  results.forEach((r, i) => {
    const source = entries[i][0];
    if (r.status === "fulfilled") {
      stats.perSource[source] = { fetched: r.value.jobs.length, passed: 0, error: null };
      for (const j of r.value.jobs) raw.push({ ...j, source });
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      stats.perSource[source] = { fetched: 0, passed: 0, error: msg };
      console.warn(`[scrape] ${source} failed: ${msg}`);
    }
  });
  return raw;
}

function allSourcesErrored(stats: RunStats): boolean {
  const vals = Object.values(stats.perSource);
  return vals.length > 0 && vals.every((v) => v.error !== null);
}

function emptyPerSource(track: Track): RunStats["perSource"] {
  // Only init slots for sources used by THIS track. Avoids writing "0" entries
  // for the other track's sources, which would otherwise look like silent
  // (broken) scrapers in the source-health alert.
  const registry = scrapersForTrack(track);
  const out = {} as RunStats["perSource"];
  for (const source of Object.keys(registry) as Source[]) {
    out[source] = { fetched: 0, passed: 0, error: null };
  }
  return out;
}

/**
 * Global geo-gate — strict. User wants:
 *   Primary: fully remote global (workable from Malta)
 *   Bonus:   Ireland-based (potential relocation)
 *
 * Accept only if location clearly indicates Ireland OR the role is clearly
 * marked remote. We inspect `location` primarily; descriptionMd is only used
 * for the remote signal because city names buried in company blurbs (e.g.
 * "we were founded in Dublin 10 years ago") cause false positives.
 */
function passesGlobalGate(job: Job): boolean {
  const loc = (job.location ?? "").toLowerCase();
  const desc = job.descriptionMd.toLowerCase();

  // Ireland in the LOCATION field → accept
  if (/\b(ireland|dublin|cork|galway|limerick|waterford|kilkenny)\b/.test(loc)) return true;

  // Remote signal — location OR description, but then reject region-locked remote
  const remoteSignals = /\b(remote|work from home|wfh|anywhere|fully remote|100% remote|work remotely|remote[-\s]first)\b/;
  const isRemote = remoteSignals.test(loc) || remoteSignals.test(desc);
  if (!isRemote) return false;

  // Reject remote roles restricted to regions Riccardo can't work from
  const usOnlyPatterns = [
    /\bremote[,\s-]*(us|usa|u\.s\.|united states)\b/,
    /\b(us|usa|united states|america)[-\s]based\b/,
    /\bmust (reside|be based|be located) in (the )?(us|usa|united states|canada|brazil|india|australia)\b/,
    /\b(us|usa|united states) only\b/,
    /\bauthorized to work in (the )?(us|usa|united states|canada)\b/,
    /\b(eastern|central|pacific|mountain) time zone only\b/,
    /\bremote\s*\(us\)/,
    /\bremote\s*[-–]\s*(us|usa|united states|canada)\b/,
    /\bremote,?\s*(us|usa|united states|canada|brazil|india|australia)\b/,
  ];
  const blob = `${loc} ${desc}`;
  if (usOnlyPatterns.some((r) => r.test(blob))) return false;

  return true;
}

/**
 * Dry-run digest preview — writes composed HTML + full stats JSON to `.tmp/`
 * so the new 6-stage funnel summary can be inspected in a browser without
 * going through Gmail. Safe to call with empty digestJobs (composer handles it).
 */
async function writeDryRunPreview(
  track: Track,
  digestJobs: Job[],
  stats: RunStats,
  cappedAt: number,
): Promise<void> {
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const dir = resolve(process.cwd(), ".tmp");
    await mkdir(dir, { recursive: true });
    const html = composeDailyDigest({ jobs: digestJobs, stats, cappedAt, unhealthySources: [] });
    const htmlPath = resolve(dir, `digest-preview-${track}.html`);
    const statsPath = resolve(dir, `stats-${track}.json`);
    await writeFile(htmlPath, html, "utf8");
    await writeFile(statsPath, JSON.stringify(stats, null, 2), "utf8");
    console.log(`[dry-run] digest preview → ${htmlPath}`);
    console.log(`[dry-run] stats → ${statsPath}`);
    console.log(
      `[dry-run] funnel: ${stats.totalRaw} → ${stats.afterFilter} → ${stats.afterMetaFreshness} → ${stats.afterDedup} → ${stats.afterAutoReject} → ${stats.afterUrlVerify} (delivered ${stats.newJobs})`,
    );
  } catch (err) {
    console.warn("[dry-run] failed to write preview:", err instanceof Error ? err.message : err);
  }
}

function isSunday(iso: string): boolean {
  // Sunday 7am Europe/Malta — use day-of-week from the Malta TZ
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", weekday: "short" });
  return fmt.format(new Date(iso)) === "Sun";
}

async function safeDetectSilentSources(track: Track) {
  try {
    return await detectSilentSources(track);
  } catch (err) {
    console.warn("[source-monitor] detect failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

function jobToSheetRow(job: Job, sentInDigest: boolean): SheetRow {
  const withTrail = job as Job & {
    _urlTrail?: string[];
    _sourceTrail?: Source[];
    _sourceIdTrail?: string[];
  };
  const urls = withTrail._urlTrail && withTrail._urlTrail.length > 0 ? withTrail._urlTrail : [job.url];
  const sources = withTrail._sourceTrail && withTrail._sourceTrail.length > 0 ? withTrail._sourceTrail : [job.source];
  const sourceIds = withTrail._sourceIdTrail && withTrail._sourceIdTrail.length > 0
    ? withTrail._sourceIdTrail
    : [`${job.source}:${job.sourceId}`];

  return {
    date_seen: new Date().toISOString().slice(0, 10),
    sources: sources.join(","),
    source_ids: sourceIds.join(","),
    title: job.title,
    company: job.company,
    location: job.location,
    locality: job.locality ?? "",
    work_mode: job.workMode,
    part_time_yn: job.partTime,
    est_salary: job.estSalary ?? "",
    contact: job.contact ?? "",
    url: job.url,
    all_urls: urls.join(","),
    status: "new",
    notes: "",
    digest_sent: sentInDigest ? "Y" : "N",
    fingerprint: job.fingerprint,
    confidence: job.confidence,
    score: String(job.score),
  };
}
