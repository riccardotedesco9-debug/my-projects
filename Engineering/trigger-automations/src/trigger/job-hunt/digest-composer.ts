// digest-composer.ts — HTML email digest templates.
// Explicitly opts out of Gmail's dark-mode auto-invert via
// `meta name="color-scheme" content="light"`. Light-only is intentional — the
// palette was tuned for it; auto-invert was muddying tier colors.

import type { Job, RunStats, Reputation } from "./types.js";
import type { SourceHealth } from "./source-monitor.js";

const STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2328; max-width: 720px; margin: 0 auto; padding: 20px 18px 28px; line-height: 1.55; background: #f3f5f8; }
  .hero { background: linear-gradient(135deg, #0d4a9f 0%, #2f6fe2 100%); color: white; border-radius: 12px; padding: 24px 26px; margin-bottom: 20px; box-shadow: 0 2px 12px rgba(13,74,159,0.18); }
  .hero h1 { font-size: 24px; margin: 0 0 6px; font-weight: 700; letter-spacing: -0.3px; }
  .hero .meta { font-size: 13px; opacity: 0.88; }
  .hero .headline { font-size: 13.5px; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.22); opacity: 0.96; }
  .hero .headline b { font-weight: 600; }
  /* Gmail strips display:flex — use inline-block + explicit separators so
     numbers and labels don't run together ("347 scraped189 passed…"). */
  .summary { font-size: 13px; color: #5a6470; margin-bottom: 14px; padding: 14px 18px; background: white; border: 1px solid #dae0e6; border-radius: 10px; line-height: 1.9; }
  .summary .funnel-title { font-size: 11px; font-weight: 700; color: #838c98; letter-spacing: 0.6px; text-transform: uppercase; margin-bottom: 6px; }
  .summary span.stage { display: inline-block; margin-right: 14px; }
  .summary b { color: #1f2328; font-weight: 700; margin-right: 4px; }
  .summary .drop { color: #838c98; font-style: normal; font-size: 11.5px; margin-left: 3px; }
  .summary .arrow { color: #b8bfc7; margin: 0 2px 0 -6px; }
  .summary .meta-line { font-size: 11.5px; color: #838c98; margin-top: 8px; padding-top: 8px; border-top: 1px solid #eef1f4; }
  .legend { background: white; border: 1px solid #dae0e6; border-radius: 10px; padding: 10px 18px; font-size: 12px; color: #5a6470; margin-bottom: 16px; line-height: 2; }
  .legend b { color: #1f2328; margin-right: 6px; }
  .legend .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 5px 0 10px; vertical-align: middle; }
  .tier { margin: 26px 0 12px; font-size: 13px; font-weight: 700; color: #2d333b; letter-spacing: 0.5px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #d0d7de; }
  .tier .count { font-weight: 500; color: #838c98; letter-spacing: 0; text-transform: none; font-size: 12px; margin-left: 10px; }
  /* Card uses relative positioning + absolute score-pill (top-right) so long
     titles wrap cleanly beneath the pill without ever touching it. Right
     padding on the card reserves the pill's column. */
  .job { position: relative; background: white; border: 1px solid #dae0e6; border-radius: 10px; padding: 16px 72px 14px 20px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
  .score-pill { position: absolute; top: 16px; right: 18px; font-size: 12px; font-weight: 700; padding: 4px 11px; border-radius: 14px; color: white; min-width: 30px; text-align: center; white-space: nowrap; line-height: 1.3; }
  .score-strong { background: #1a7f37; }
  .score-stretch { background: #bf8700; }
  .score-adjacent { background: #57606a; }
  .score-longshot { background: #9ca3af; }
  .job-header { margin-bottom: 2px; }
  .rank { font-size: 13px; color: #838c98; font-weight: 700; margin-right: 10px; display: inline-block; }
  .job h2 { font-size: 17px; margin: 0; font-weight: 600; letter-spacing: -0.15px; word-break: break-word; line-height: 1.35; display: inline; }
  .job h2 a { color: #0a58ca; text-decoration: none; }
  .job h2 a:hover { text-decoration: underline; }
  .company-row { color: #424a53; font-size: 13.5px; margin: 5px 0 0 38px; }
  .company-row b { color: #1f2328; font-weight: 600; }
  .reputation { margin: 6px 0 0 38px; }
  .rep-stars { color: #424a53; font-size: 12.5px; line-height: 1.6; }
  .rep-strong { color: #116329; font-weight: 600; }
  .rep-mid { color: #9a6700; font-weight: 600; }
  .rep-weak { color: #a40e26; font-weight: 600; }
  .rep-good { display: inline-block; color: #116329; font-size: 12px; font-weight: 500; background: #f0faf3; padding: 4px 10px; border-radius: 4px; margin-top: 5px; line-height: 1.5; }
  .rep-bad { display: inline-block; color: #7a0517; font-size: 12px; font-weight: 500; background: #ffe8e6; padding: 4px 10px; border-radius: 4px; margin-top: 5px; line-height: 1.5; }
  .rep-missing { color: #838c98; font-size: 12px; font-style: italic; line-height: 1.5; }
  .why { font-size: 13px; color: #1f7334; margin: 10px 0 10px 38px; font-weight: 500; padding: 7px 10px; background: #f0faf3; border-left: 3px solid #1a7f37; border-radius: 4px; line-height: 1.55; }
  .chips { margin: 10px 0 0 38px; }
  .chip { display: inline-block; font-size: 11px; padding: 3px 10px; border-radius: 12px; background: #eaeef2; color: #424a53; margin: 0 5px 5px 0; font-weight: 500; line-height: 1.55; }
  .chip.remote { background: #cce7ff; color: #0a3d78; }
  .chip.hybrid { background: #efe1ff; color: #4a247e; }
  .chip.parttime { background: #caf0d5; color: #0d5a2a; }
  .chip.fulltime { background: #ffe2c7; color: #7a4d00; }
  .redflag { font-size: 12.5px; color: #7a0517; background: #ffe8e6; border-left: 3px solid #a40e26; padding: 8px 12px; margin: 10px 0 0 38px; border-radius: 4px; line-height: 1.55; }
  .redflag b { color: #7a0517; font-weight: 700; }
  .desc { font-size: 13px; color: #424a53; margin: 10px 0 0 38px; line-height: 1.55; }
  .details { font-size: 12.5px; color: #5a6470; margin: 10px 0 0 38px; }
  .details b { color: #1f2328; font-weight: 600; }
  .apply-row { margin: 14px 0 0 38px; }
  .apply-btn { display: inline-block; background: #1a7f37; color: white !important; text-decoration: none; padding: 8px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
  .apply-btn:hover { background: #116329; }
  .source-tag { display: inline-block; font-size: 11.5px; color: #838c98; margin-left: 14px; }
  .thin-banner { font-size: 11.5px; color: #7a4d00; background: #fff5d6; padding: 5px 11px; border-radius: 4px; margin: 8px 0 0 38px; display: inline-block; line-height: 1.55; }
  .footer { color: #838c98; font-size: 11.5px; margin-top: 26px; padding: 12px 16px; background: white; border: 1px solid #dae0e6; border-radius: 10px; line-height: 1.6; }
  .alert { background: #fff5d6; border: 1px solid #d4a72c; padding: 12px 16px; border-radius: 8px; margin-bottom: 14px; font-size: 13px; color: #5c3800; line-height: 1.6; }
  .alert b { color: #3d2400; }
  .alert.danger { background: #ffe8e6; border-color: #a40e26; color: #7a0517; }
  .alert.danger b { color: #7a0517; }
`;

export interface DigestInput {
  jobs: Job[];
  stats: RunStats;
  cappedAt: number;
  unhealthySources?: SourceHealth[];
}

export function composeSubject(input: DigestInput & { heartbeat?: boolean }): string {
  const d = new Date(input.stats.startedAt).toISOString().slice(0, 10);
  if (input.heartbeat) return `job-hunt heartbeat — pipeline healthy (${d})`;
  if (input.jobs.length === 0) return `job-hunt — no new matches today (${d})`;
  // Subject kept neutral — the hero body already shows top categories.
  // Avoids locking the user's attention on one specific role before they open.
  const cats = topCategories(input.jobs, 3);
  const catSuffix = cats.length > 0 ? ` · ${cats.slice(0, 3).map((c) => c.replace(/\s\(\d+\)$/, "")).join(" / ")}` : "";
  return `job-hunt — ${input.jobs.length} new match${input.jobs.length === 1 ? "" : "es"}${catSuffix} (${d})`;
}

/** Aggregate tag counts across all jobs. Used to show "top categories" in the
 * digest header so the user sees the shape of the day before any one role. */
function topCategories(jobs: Job[], n = 4): string[] {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    for (const t of j.tags ?? []) {
      const k = t.trim();
      if (!k || k.length > 30) continue;
      // Dedupe within a single job so a role doesn't double-count its own tag.
      const key = k.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  // Drop generic "confidence" or pure work-mode tags from top categories —
  // they're expected everywhere and not useful as topics.
  const GENERIC = /^(high|medium|low|strong|stretch|adjacent|long[-\s]?shot|score|confidence|malta|hybrid|remote|onsite|part[-\s]?time|full[-\s]?time|unclear)$/i;
  return [...counts.entries()]
    .filter(([k]) => !GENERIC.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, c]) => `${k} (${c})`);
}

type Tier = "strong" | "stretch" | "adjacent" | "longshot";
function tierOf(score: number): Tier {
  if (score >= 85) return "strong";
  if (score >= 65) return "stretch";
  if (score >= 40) return "adjacent";
  return "longshot";
}
const TIER_META: Record<Tier, { label: string; colorClass: string }> = {
  strong:   { label: "Strong match",            colorClass: "score-strong" },
  stretch:  { label: "Stretch — worth a look",  colorClass: "score-stretch" },
  adjacent: { label: "Adjacent role",           colorClass: "score-adjacent" },
  longshot: { label: "Long shot",               colorClass: "score-longshot" },
};

export function composeDailyDigest(input: DigestInput): string {
  const { jobs, stats, cappedAt, unhealthySources } = input;

  // Hero shows "shape of the day" — top tag categories — instead of zooming
  // in on a single role. Helps the reader orient before scanning.
  const cats = topCategories(jobs, 5);
  const catLine = cats.length > 0
    ? `Today's mix: ${cats.map((c) => `<b>${escapeHtml(c)}</b>`).join(" · ")}`
    : "";

  const hero = `<div class="hero">
    <h1>${jobs.length} new role${jobs.length === 1 ? "" : "s"} today</h1>
    <div class="meta">${formatDate(stats.startedAt)} · ranked by CV-aware fit score</div>
    ${catLine ? `<div class="headline">${catLine}</div>` : ""}
  </div>`;

  const allSources = Object.entries(stats.perSource);
  const enabledSourceCount = allSources.filter(([, s]) => s.fetched > 0 || s.error).length;
  const activeSourceCount = allSources.filter(([, s]) => s.fetched > 0).length;
  const erroredSources = allSources.filter(([, s]) => s.error).map(([name]) => name);
  // Degraded only when a meaningful share of sources hit real errors.
  const degraded = enabledSourceCount > 0 && erroredSources.length >= Math.ceil(enabledSourceCount / 2);
  const degradedBanner = degraded
    ? `<div class="alert danger"><b>⚠ Pipeline degraded</b> — only ${activeSourceCount} of ${enabledSourceCount} sources returned data. ${
        erroredSources.length > 0 ? `Errored: ${erroredSources.slice(0, 3).join(", ")}.` : ""
      } Today's digest is thinner than usual.</div>`
    : "";

  // Full funnel — every stage shows what's LEFT, plus the drop count and
  // reason inline (visible on mobile, not hidden in hover tooltip). Labels
  // are human-readable not pipeline-jargon: "role match" not "passed filters",
  // "good fit" not "after LLM rank", etc. Geo-gate is only shown when it
  // actually dropped something (Malta track: it rarely does; global track:
  // rejects US-only remote + onsite-Ireland — visible signal).
  const geoDrop = Math.max(0, stats.totalRaw - stats.afterGeoGate);
  const filterDrop = Math.max(0, stats.afterGeoGate - stats.afterFilter);
  const metaDrop = Math.max(0, stats.afterFilter - stats.afterMetaFreshness);
  const dedupDrop = Math.max(0, stats.afterMetaFreshness - stats.afterDedup);
  const rejectDrop = Math.max(0, stats.afterDedup - stats.afterAutoReject);
  const urlDrop = Math.max(0, stats.afterAutoReject - stats.afterUrlVerify);
  const arrow = `<span class="arrow">→</span>`;
  const dropTag = (n: number, reason: string) =>
    n > 0 ? `<span class="drop">(−${n} ${reason})</span>` : `<span class="drop">(−0)</span>`;
  const geoStage = geoDrop > 0
    ? `<span class="stage"><b>${stats.afterGeoGate}</b> right region ${dropTag(geoDrop, "wrong location")}</span>${arrow}`
    : "";
  const fcLine = typeof stats.firecrawlCalls === "number"
    ? ` · Firecrawl: <b>${stats.firecrawlCalls}</b>${stats.firecrawlBudget ? `/${stats.firecrawlBudget}` : ""} calls`
    : "";
  const summary = `<div class="summary">
    <div class="funnel-title">Today's funnel</div>
    <span class="stage"><b>${stats.totalRaw}</b> found</span>${arrow}
    ${geoStage}
    <span class="stage"><b>${stats.afterFilter}</b> role-relevant ${dropTag(filterDrop, "non-analytical titles")}</span>${arrow}
    <span class="stage"><b>${stats.afterMetaFreshness}</b> recent ${dropTag(metaDrop, "older than 60 days")}</span>${arrow}
    <span class="stage"><b>${stats.afterDedup}</b> not seen before ${dropTag(dedupDrop, "already in sheet")}</span>${arrow}
    <span class="stage"><b>${stats.afterAutoReject}</b> good fit ${dropTag(rejectDrop, "LLM flagged mismatch")}</span>${arrow}
    <span class="stage"><b>${stats.newJobs}</b> matched ${dropTag(urlDrop, "listing closed")}</span>
    <div class="meta-line">Shown in this email: <b>${jobs.length}</b>${cappedAt > 0 ? ` · rolled to tomorrow: <b>${cappedAt}</b>` : ""} · <b>${activeSourceCount}</b>/${enabledSourceCount} sources active${erroredSources.length > 0 ? ` · errors: ${erroredSources.slice(0, 3).join(", ")}` : ""}${fcLine}</div>
  </div>`;

  const legend = `<div class="legend">
    <b>Score tiers</b>
    <span class="dot" style="background:#1a7f37"></span>Strong (85+) ·
    <span class="dot" style="background:#bf8700"></span>Stretch (65–84) ·
    <span class="dot" style="background:#57606a"></span>Adjacent (40–64) ·
    <span class="dot" style="background:#9ca3af"></span>Long shot (below 40)
  </div>`;

  const alerts = renderAlerts(cappedAt, unhealthySources);

  const body = jobs.length === 0
    ? `<div class="job"><p style="margin:0">No new matches today. Pipeline ran cleanly — check the run log for source activity.</p></div>`
    : renderTiered(jobs);

  return wrap(hero + degradedBanner + summary + legend + alerts + body + renderFooter(stats));
}

/**
 * Sunday heartbeat — sent when the Sunday run produced zero matches. Distinct
 * framing so the user recognises "all clear, nothing for you today" instead of
 * confusing it with a broken pipeline. Shows this week's activity stats to
 * prove the system is alive end-to-end.
 */
export function composeHeartbeat(
  stats: RunStats,
  weekStats?: { runs: number; totalNew: number },
): string {
  const activeSources = Object.entries(stats.perSource).filter(([, v]) => v.fetched > 0).length;
  const totalSources = Object.keys(stats.perSource).length;
  const weekLine = weekStats
    ? `Last 7 days: <b>${weekStats.runs}</b> runs · <b>${weekStats.totalNew}</b> new roles surfaced`
    : `Scrapers healthy — <b>${activeSources}/${totalSources}</b> sources active today`;
  const hero = `<div class="hero" style="background: linear-gradient(135deg, #116329 0%, #1a7f37 100%);">
    <h1>💚 Pipeline healthy — nothing to report</h1>
    <div class="meta">${formatDate(stats.startedAt)} · scheduled check-in</div>
    <div class="headline">${weekLine}</div>
  </div>`;
  const body = `<div class="job">
    <p style="margin:0 0 6px"><b>What this means:</b> the bot ran on schedule, all sources responded, and nothing new passed the filters today. No action needed.</p>
    <p style="margin:0;color:#5a6470;font-size:12.5px">Next digest: tomorrow at 07:00 Europe/Malta. Watch-outs and rejections are still logged to the sheet for review.</p>
  </div>`;
  return wrap(hero + body + renderFooter(stats));
}

export function composeFailureAlert(err: unknown, stats: Partial<RunStats>, phase: string): string {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
  const perSource = stats.perSource
    ? Object.entries(stats.perSource)
        .map(([s, v]) => `  ${s}: fetched=${v.fetched}${v.error ? ` error=${v.error}` : ""}`)
        .join("\n")
    : "(no source stats yet)";

  const hero = `<div class="hero" style="background: linear-gradient(135deg, #a40e26 0%, #cf222e 100%);">
    <h1>⚠ job-hunt run failed</h1>
    <div class="meta">Phase: <strong>${escapeHtml(phase)}</strong> · ${formatDate(stats.startedAt ?? new Date().toISOString())}</div>
  </div>`;
  const body = `
    <div class="alert danger">${escapeHtml(msg.slice(0, 2000))}</div>
    <div class="job">
      <h3 style="font-size:13px;margin:0 0 8px">Per-source progress</h3>
      <pre style="font-size:11px;background:#f6f8fa;padding:10px;border-radius:6px;white-space:pre-wrap;overflow-x:auto">${escapeHtml(perSource)}</pre>
      <p style="font-size:12px;margin:8px 0 0">If this is an auth error, check <code>Google_Refresh_Token</code> in the Trigger.dev dashboard — it may have been revoked.</p>
    </div>
  `;
  return wrap(hero + body);
}

// ────────────────────────────────────────────────────────────────────

function renderTiered(jobs: Job[]): string {
  const tiers: Record<Tier, Job[]> = { strong: [], stretch: [], adjacent: [], longshot: [] };
  for (const j of jobs) tiers[tierOf(j.score)].push(j);

  const sections: string[] = [];
  let rank = 1;
  for (const t of ["strong", "stretch", "adjacent", "longshot"] as Tier[]) {
    const group = tiers[t];
    if (group.length === 0) continue;
    // Mind the space between label and count — prevents "Strong match(3)".
    sections.push(`<div class="tier">${TIER_META[t].label} <span class="count">(${group.length})</span></div>`);
    for (const job of group) {
      sections.push(renderJob(job, rank++));
    }
  }
  return sections.join("\n");
}

function renderJob(job: Job, rank: number): string {
  const tier = tierOf(job.score);
  const scoreCls = TIER_META[tier].colorClass;
  // Haiku always populates `fit`; the old deterministic keyword-based fallback
  // was dead code and has been removed. If `fit` is empty we show nothing
  // rather than a robotic "Matches: title: ..." line.
  const whyLine = job.fit ?? "";
  const chips = renderChips(job);

  const companyLoc = job.company
    ? `<b>${escapeHtml(job.company)}</b> · ${escapeHtml(job.location || "Malta")}`
    : `<span style="font-style:italic;color:#838c98">Employer not in listing</span> · ${escapeHtml(job.location || "Malta")}`;

  const dataThin = !job.company && (!job.descriptionMd || job.descriptionMd.trim().length < 40) && !job.reputation;

  const safeUrl = /^https?:\/\//i.test(job.url) ? job.url : "";
  const applyBtn = safeUrl
    ? `<a class="apply-btn" href="${escapeAttr(safeUrl)}">View &amp; Apply →</a>`
    : "";
  const sourceTag = `<span class="source-tag">via ${escapeHtml(job.source)}</span>`;

  const titleHtml = safeUrl
    ? `<a href="${escapeAttr(safeUrl)}">${escapeHtml(job.title || "(no title)")}</a>`
    : escapeHtml(job.title || "(no title)");

  const reputationLine = renderReputation(job);

  const desc = job.descriptionMd && job.descriptionMd.trim().length > 20
    ? `<div class="desc">${escapeHtml(cleanDesc(job.descriptionMd))}</div>`
    : "";

  const details: string[] = [];
  if (job.contact) details.push(`<b>Contact:</b> ${escapeHtml(job.contact)}`);
  // Only show salary when we actually extracted a value. Previously we always
  // showed "not disclosed" when estSalary was null — but estSalary is null for
  // all Google-snippet-sourced jobs (no scraper populates it) even when the
  // full listing clearly states salary. Silent = "we don't know" rather than
  // falsely asserting it's missing.
  if (job.estSalary) details.push(`<b>Salary:</b> ${escapeHtml(job.estSalary)}`);
  if (job.postedAt) details.push(`<b>Posted:</b> ${formatShortDate(job.postedAt)}`);
  const detailsRow = details.length > 0 ? `<div class="details">${details.join(" &nbsp;·&nbsp; ")}</div>` : "";

  const thinBanner = dataThin
    ? `<div class="thin-banner">Minimal data — score is tentative, click through for full details</div>`
    : "";

  const visibleRedFlags = dataThin
    ? (job.redFlags ?? []).filter((f) => !/insufficient|click through|verify|sparse|minimal data/i.test(f))
    : (job.redFlags ?? []);

  return `<div class="job">
    <div class="job-header">
      <span class="rank">#${rank}</span>
      <h2>${titleHtml}</h2>
      <span class="score-pill ${scoreCls}">${job.score}</span>
    </div>
    <div class="company-row">${companyLoc}</div>
    ${reputationLine}
    ${thinBanner}
    ${whyLine ? `<div class="why">${escapeHtml(whyLine)}</div>` : ""}
    <div class="chips">${chips}</div>
    ${visibleRedFlags.length > 0 ? `<div class="redflag"><b>⚠ Watch-outs:</b> ${visibleRedFlags.map(escapeHtml).join(" · ")}</div>` : ""}
    ${desc}
    ${detailsRow}
    <div class="apply-row">${applyBtn}${sourceTag}</div>
  </div>`;
}

function renderReputation(job: Job): string {
  const rep = job.reputation;
  const hasAnyRating = rep && (rep.glassdoor || rep.indeed || rep.other);

  // Company was looked up (job in Sonnet top-K) but no public ratings found —
  // surface explicitly so user knows this is a small/private employer, not a
  // data gap on our side.
  if (!hasAnyRating && job.reputationLookedUp) {
    return `<div class="reputation"><div class="rep-missing">No public reviews found — likely a small or private employer</div></div>`;
  }
  // Not looked up (outside Sonnet top-K) — stay silent
  if (!rep || !hasAnyRating) return "";

  // Stars line — one entry per source that hit. Links where available.
  const renderStar = (label: string, rating: number, reviews: number, url?: string): string => {
    const cls = rating < 3 ? "rep-weak" : rating < 4 ? "rep-mid" : "rep-strong";
    const inner = `${label} ${rating.toFixed(1)}★`;
    const wrapped = url
      ? `<a href="${escapeAttr(url)}" style="color:inherit;text-decoration:none">${inner}</a>`
      : inner;
    return `<span class="${cls}">${wrapped}</span> (${formatK(reviews)} reviews)`;
  };
  const starParts: string[] = [];
  if (rep.glassdoor) starParts.push(renderStar("Glassdoor", rep.glassdoor.rating, rep.glassdoor.reviews, rep.glassdoor.url));
  if (rep.indeed) starParts.push(renderStar("Indeed", rep.indeed.rating, rep.indeed.reviews, rep.indeed.url));
  if (rep.other) starParts.push(renderStar(rep.other.source, rep.other.rating, rep.other.reviews, rep.other.url));

  // Good signal: at least one rating ≥4.2, or avg across sources ≥4.0
  const ratings = [rep.glassdoor?.rating, rep.indeed?.rating, rep.other?.rating].filter(
    (r): r is number => typeof r === "number",
  );
  const avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const maxR = ratings.length > 0 ? Math.max(...ratings) : 0;
  const goods: string[] = [];
  if (maxR >= 4.2 || (ratings.length > 1 && avg >= 4.0)) {
    goods.push(ratings.length > 1 ? "Well-rated (consistent across sources)" : "Well-rated employer");
  }

  // Red flags from reputation fetch — kept separate from LLM-derived redFlags
  // (which appear in the `.redflag` block below the card).
  const bads = rep.redFlags ?? [];

  const parts: string[] = [];
  if (starParts.length > 0) parts.push(`<div class="rep-stars">${starParts.join(" &nbsp;·&nbsp; ")}</div>`);
  if (goods.length > 0) parts.push(`<div class="rep-good">✓ ${goods.map(escapeHtml).join(" · ")}</div>`);
  if (bads.length > 0) parts.push(`<div class="rep-bad">⚠ ${bads.map(escapeHtml).join(" · ")}</div>`);

  return parts.length > 0 ? `<div class="reputation">${parts.join("")}</div>` : "";
}

function renderChips(job: Job): string {
  const out: string[] = [];
  if (job.tags && job.tags.length > 0) {
    for (const tag of job.tags) {
      const cls = /remote/i.test(tag) ? "remote"
        : /hybrid/i.test(tag) ? "hybrid"
        : /part[-\s]?time/i.test(tag) ? "parttime"
        : /full[-\s]?time/i.test(tag) ? "fulltime"
        : "";
      out.push(`<span class="chip ${cls}">${escapeHtml(tag)}</span>`);
    }
  } else {
    if (job.workMode !== "unclear") {
      out.push(`<span class="chip ${job.workMode}">${job.workMode}</span>`);
    }
    if (job.partTime === "yes") out.push(`<span class="chip parttime">part-time</span>`);
    else if (job.partTime === "no") out.push(`<span class="chip fulltime">full-time</span>`);
    else out.push(`<span class="chip">schedule unclear</span>`);
    if (job.locality) out.push(`<span class="chip">${escapeHtml(job.locality)}</span>`);
  }
  return out.join("");
}

function renderAlerts(cappedAt: number, unhealthy?: SourceHealth[]): string {
  const parts: string[] = [];
  if (cappedAt > 0) {
    parts.push(`<div class="alert">Digest capped — <b>${cappedAt}</b> additional matches rolled to tomorrow.</div>`);
  }
  if (unhealthy && unhealthy.length > 0) {
    // Plain-English phrasing — old "N d silent" was cryptic.
    const listItems = unhealthy
      .map((u) => `<li><b>${escapeHtml(u.source)}</b> — no jobs returned for ${u.zeroStreakDays} days</li>`)
      .join("");
    parts.push(
      `<div class="alert">
        <b>Scraper health check</b>
        <ul style="margin:6px 0 0 20px;padding:0">${listItems}</ul>
        <div style="margin-top:6px;font-size:12px">These sources are enabled but haven't returned any jobs for several runs — the site likely changed layout and the scraper needs updating.</div>
      </div>`,
    );
  }
  return parts.join("");
}

function renderFooter(stats: RunStats): string {
  const perSource = Object.entries(stats.perSource)
    .filter(([, v]) => v.fetched > 0)
    .map(([s, v]) => `${s}:${v.fetched}`)
    .join(" · ");
  return `<div class="footer">${formatDate(stats.startedAt)} → ${formatDate(stats.finishedAt)} · ${perSource || "(no active sources)"}</div>`;
}

function cleanDesc(md: string): string {
  const cleaned = md
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Bump limit 280 → 500 so most Google snippets (typically 200-400 chars)
  // show in full. When truncation is still needed, cut at a SENTENCE boundary
  // near the limit so the description doesn't end mid-word or mid-thought.
  const MAX = 500;
  if (cleaned.length <= MAX) return cleaned;
  // Search 50 chars before and after the soft limit for a sentence ender.
  const window = cleaned.slice(0, MAX + 50);
  const sentenceEnd = window.search(/[.!?](?:\s|$)(?=[A-Z]|\s*$)/);
  const cutAt = sentenceEnd >= MAX - 50 && sentenceEnd <= MAX + 50
    ? sentenceEnd + 1  // include the period
    : MAX;             // no good boundary found — fall back to hard cut
  return cleaned.slice(0, cutAt).trim() + "…";
}

function formatK(n: number): string {
  if (!n) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function wrap(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>${STYLE}</style></head><body>${inner}</body></html>`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { timeZone: "Europe/Malta", dateStyle: "medium", timeStyle: "short" });
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/Malta", dateStyle: "short" });
  } catch {
    return iso.slice(0, 10);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
