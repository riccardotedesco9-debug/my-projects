#!/usr/bin/env node
// dry-run.mjs — run a fake pipeline end-to-end using fixture data, write
// .tmp/digest-preview.html so you can eyeball the email. Does NOT hit
// Firecrawl, sheet, or Gmail. For real-data dry run, set JOBHUNT_DRY_RUN=true
// and manually trigger the Trigger.dev task from the dashboard.
//
// Usage:  node tools/dry-run.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const FIXTURE = [
  {
    title: "data analyst",
    company: "gaming innovation group",
    location: "St Julian's, Malta",
    locality: "st julian's",
    workMode: "hybrid",
    partTime: "yes",
    source: "castille",
    url: "https://www.castilleresources.com/jobs/data-analyst-123",
    descriptionMd: "Join our iGaming analytics team. Part-time, 20h/week. SQL, Tableau, Power BI required. Email careers@gig.com to apply.",
    contact: "careers@gig.com",
    estSalary: "€30,000 - €35,000 pro-rata",
    confidence: "high",
    score: 120,
  },
  {
    title: "business analyst",
    company: "bank of valletta",
    location: "Valletta, Malta",
    locality: "valletta",
    workMode: "onsite",
    partTime: "yes",
    source: "jobsplus",
    url: "https://vacancies.jobsplus.gov.mt/Vacancies/Details/67890",
    descriptionMd: "Part-time BA role, 25h/week. Experience with Jira, Excel, and financial reporting. Must be EU citizen.",
    contact: null,
    estSalary: null,
    confidence: "medium",
    score: 88,
  },
  {
    title: "reporting analyst",
    company: "betsson group",
    location: "Malta",
    locality: "ta' xbiex",
    workMode: "hybrid",
    partTime: "unknown",
    source: "linkedin",
    url: "https://www.linkedin.com/jobs/view/4012345678",
    descriptionMd: "Reporting analyst for one of the leading iGaming companies. Power BI, SQL, GA4 exposure a plus.",
    contact: null,
    estSalary: null,
    confidence: "medium",
    score: 76,
  },
];

const STATS = {
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  totalRaw: 147,
  afterMaltaGate: 62,
  afterFilter: 18,
  afterDedup: 12,
  newJobs: FIXTURE.length,
  digestSent: false,
  perSource: {
    linkedin: { fetched: 31, passed: 4, error: null },
    jobsplus: { fetched: 24, passed: 3, error: null },
    "indeed-mt": { fetched: 18, passed: 2, error: null },
    keepmeposted: { fetched: 15, passed: 1, error: null },
    careerjet: { fetched: 28, passed: 0, error: null },
    konnekt: { fetched: 19, passed: 4, error: null },
    castille: { fetched: 12, passed: 4, error: null },
  },
};

// Inline the subset of digest-composer we need. This mirrors the TS version;
// update both if the template changes.
const STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #24292f; max-width: 720px; margin: 0 auto; padding: 16px; line-height: 1.5; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  .meta { color: #57606a; font-size: 13px; margin-bottom: 24px; }
  .job { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .job h2 { font-size: 16px; margin: 0 0 4px; }
  .job h2 a { color: #0969da; text-decoration: none; }
  .job .company { color: #57606a; font-size: 13px; margin-bottom: 6px; }
  .chips { margin: 6px 0; }
  .chip { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 12px; background: #f6f8fa; color: #57606a; margin-right: 4px; }
  .chip.hi { background: #dafbe1; color: #116329; }
  .chip.md { background: #fff8c5; color: #633c01; }
  .chip.lo { background: #ffebe9; color: #82071e; }
  .desc { font-size: 13px; color: #424a53; margin: 6px 0 0; }
  .footer { color: #57606a; font-size: 12px; margin-top: 24px; border-top: 1px solid #d0d7de; padding-top: 12px; }
`;

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderJob(j) {
  const chipCls = j.confidence === "high" ? "hi" : j.confidence === "medium" ? "md" : "lo";
  const chips = [
    `<span class="chip ${chipCls}">${j.confidence}</span>`,
    `<span class="chip">${j.workMode}</span>`,
    `<span class="chip">${j.partTime === "yes" ? "part-time" : j.partTime === "unknown" ? "pt unclear" : "full-time"}</span>`,
    j.locality ? `<span class="chip">${escapeHtml(j.locality)}</span>` : "",
    `<span class="chip">${j.source}</span>`,
    `<span class="chip">score ${j.score}</span>`,
  ].filter(Boolean).join("");
  return `<div class="job">
    <h2><a href="${escapeHtml(j.url)}">${escapeHtml(j.title)}</a></h2>
    <div class="company">${escapeHtml(j.company)} · ${escapeHtml(j.location)}</div>
    <div class="chips">${chips}</div>
    <div class="desc">${escapeHtml(j.descriptionMd.slice(0, 260))}</div>
    ${j.contact ? `<div class="desc"><strong>Contact:</strong> ${escapeHtml(j.contact)}</div>` : ""}
    ${j.estSalary ? `<div class="desc"><strong>Salary:</strong> ${escapeHtml(j.estSalary)}</div>` : ""}
  </div>`;
}

const perSource = Object.entries(STATS.perSource).map(([s, v]) => `${s}:${v.fetched}`).join(" · ");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
  <h1>Daily Malta job digest</h1>
  <div class="meta">${new Date(STATS.startedAt).toLocaleString("en-GB", { timeZone: "Europe/Malta" })} · scraped ${STATS.totalRaw} → ${STATS.afterFilter} matched → ${STATS.newJobs} new</div>
  ${FIXTURE.map(renderJob).join("\n")}
  <div class="footer">Per-source fetched: ${perSource}</div>
</body></html>`;

const outDir = resolve(process.cwd(), ".tmp");
await mkdir(outDir, { recursive: true });
const outFile = resolve(outDir, "digest-preview.html");
await writeFile(outFile, html, "utf8");

console.log(`✓ Wrote ${outFile}`);
console.log("  Open in browser to preview the digest format.");
