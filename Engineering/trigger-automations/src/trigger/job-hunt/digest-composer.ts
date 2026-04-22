// digest-composer.ts — HTML email digest templates.
// Designed to render cleanly in Gmail both light AND dark mode. Uses
// mid-contrast colors with enough saturation to survive Gmail's auto-invert.

import {
  CORE_KEYWORDS,
  TOOL_KEYWORDS,
  DOMAIN_KEYWORDS,
  DRIVE_30MIN,
} from "./config.js";
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
  .summary { font-size: 13px; color: #5a6470; margin-bottom: 14px; padding: 12px 18px; background: white; border: 1px solid #dae0e6; border-radius: 10px; line-height: 1.9; }
  .summary span { display: inline-block; margin-right: 18px; }
  .summary b { color: #1f2328; font-weight: 700; margin-right: 4px; }
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
  .reputation { color: #424a53; font-size: 12.5px; margin: 4px 0 0 38px; }
  .rep-strong { color: #116329; font-weight: 600; }
  .rep-mid { color: #9a6700; font-weight: 600; }
  .rep-weak { color: #a40e26; font-weight: 600; }
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

export function composeSubject(input: DigestInput): string {
  const d = new Date(input.stats.startedAt).toISOString().slice(0, 10);
  if (input.jobs.length === 0) return `job-hunt — no new matches (${d})`;
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

  const summary = `<div class="summary">
    <span><b>${stats.totalRaw}</b> scraped</span>
    <span><b>${stats.afterFilter}</b> passed filters</span>
    <span><b>${stats.newJobs}</b> new after freshness check</span>
    <span><b>${activeSourceCount}</b> of ${enabledSourceCount} sources returned data</span>
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

export function composeHeartbeat(stats: RunStats, weekStats: { runs: number; totalNew: number }): string {
  const hero = `<div class="hero">
    <h1>Weekly heartbeat — job-hunt is alive</h1>
    <div class="meta">Last 7 days: ${weekStats.runs} runs · ${weekStats.totalNew} new roles surfaced</div>
  </div>`;
  const body = `<div class="job"><p style="margin:0">Still crawling. Next digest tomorrow 07:00 Europe/Malta.</p></div>`;
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
  const whyLine = job.fit ?? deterministicWhy(job);
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

  const reputationLine = renderReputation(job.reputation);

  const desc = job.descriptionMd && job.descriptionMd.trim().length > 20
    ? `<div class="desc">${escapeHtml(cleanDesc(job.descriptionMd))}</div>`
    : "";

  const details: string[] = [];
  if (job.contact) details.push(`<b>Contact:</b> ${escapeHtml(job.contact)}`);
  // Always surface salary state — user specifically asked for this.
  details.push(
    job.estSalary
      ? `<b>Salary:</b> ${escapeHtml(job.estSalary)}`
      : `<b>Salary:</b> <span style="color:#838c98">not disclosed</span>`,
  );
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

function renderReputation(rep?: Reputation): string {
  if (!rep || (!rep.glassdoor && !rep.indeed)) return "";
  const parts: string[] = [];
  if (rep.glassdoor) {
    const cls = rep.glassdoor.rating < 3 ? "rep-weak" : rep.glassdoor.rating < 4 ? "rep-mid" : "rep-strong";
    parts.push(`<span class="${cls}">Glassdoor ${rep.glassdoor.rating.toFixed(1)}★</span> (${formatK(rep.glassdoor.reviews)} reviews)`);
  }
  if (rep.indeed) {
    const cls = rep.indeed.rating < 3 ? "rep-weak" : rep.indeed.rating < 4 ? "rep-mid" : "rep-strong";
    parts.push(`<span class="${cls}">Indeed ${rep.indeed.rating.toFixed(1)}★</span> (${formatK(rep.indeed.reviews)} reviews)`);
  }
  return `<div class="reputation">${parts.join(" &nbsp;·&nbsp; ")}</div>`;
}

function deterministicWhy(job: Job): string {
  const reasons = matchReasons(job);
  return reasons.length > 0 ? `Matches: ${reasons.join(" · ")}` : "";
}

function matchReasons(job: Job): string[] {
  const reasons: string[] = [];
  const titleLower = job.title.toLowerCase();
  const descLower = job.descriptionMd.toLowerCase();
  const hitCore = CORE_KEYWORDS.find((k) => titleLower.includes(k));
  if (hitCore) reasons.push(`title: "${hitCore}"`);
  const tools = TOOL_KEYWORDS.filter((t) => descLower.includes(t)).slice(0, 3);
  if (tools.length > 0) reasons.push(`tools: ${tools.join(", ")}`);
  if (/\b(i[-\s]?gaming|gambling|casino|sportsbook|betting)\b/.test(descLower)) {
    reasons.push("iGaming");
  } else {
    const dom = DOMAIN_KEYWORDS.find((d) => descLower.includes(d));
    if (dom) reasons.push(`domain: ${dom}`);
  }
  if (job.partTime === "yes") reasons.push("part-time confirmed");
  if (job.workMode === "hybrid") reasons.push("hybrid");
  else if (job.workMode === "remote") reasons.push("remote");
  if (job.locality && DRIVE_30MIN.has(job.locality.toLowerCase())) reasons.push("drive ≤30min");
  return reasons;
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
  return cleaned.length > 280 ? cleaned.slice(0, 277) + "…" : cleaned;
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
