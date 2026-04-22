#!/usr/bin/env node
// test-scrape.mjs — hit one source through Firecrawl and dump its markdown
// to .tmp/<source>-probe.md. Optionally runs the real scraper (via tsx) and
// prints the parsed Job[] count. Use during Phase 3 tuning.
//
// Usage:
//   node --env-file=.env tools/test-scrape.mjs jobsplus
//   node --env-file=.env tools/test-scrape.mjs linkedin
//
// Requires FIRECRAWL_API_KEY in .env.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Direct search URLs per source. Only active sources are listed — removed
// entries for jobsplus/indeed-mt/careerjet which are confirmed unreachable.
const SEARCH_URLS = {
  linkedin: "https://www.linkedin.com/jobs/search/?keywords=analyst&location=Malta&f_JT=P&sortBy=DD",
  keepmeposted: "https://www.keepmeposted.com.mt/jobs?s=analyst",
  konnekt: "https://www.konnekt.com/search?keyword=analyst&jobType=PartTime",
  castille: "https://www.castilleresources.com/jobs?keywords=analyst",
};

async function main() {
  const source = process.argv[2];
  if (!source || !SEARCH_URLS[source]) {
    console.error("Usage: node tools/test-scrape.mjs <source>");
    console.error("  Known sources:", Object.keys(SEARCH_URLS).join(", "));
    process.exit(1);
  }
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");

  const url = SEARCH_URLS[source];
  console.log(`→ Scraping ${url}`);
  const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 3000 }),
  });
  if (!resp.ok) {
    throw new Error(`Firecrawl failed (${resp.status}): ${await resp.text()}`);
  }
  const body = await resp.json();
  const md = body?.data?.markdown ?? body?.markdown ?? "";
  if (!md) {
    console.error("Firecrawl returned empty markdown. Response shape:", Object.keys(body));
    process.exit(2);
  }

  const outDir = resolve(process.cwd(), ".tmp");
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `${source}-probe.md`);
  await writeFile(outFile, md, "utf8");

  // Rough sanity check — count link candidates that look like job listings.
  const links = [...md.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  const plausible = links.filter(([, , u]) => looksLikeJobUrl(source, u));

  console.log(`✓ Wrote ${outFile}`);
  console.log(`  Total links in markdown: ${links.length}`);
  console.log(`  Plausible job links:     ${plausible.length}`);
  if (plausible.length < 5) {
    console.warn(`⚠ Fewer than 5 job-like links — check selectors or site changes.`);
  }
  console.log("\nFirst 5 plausible links:");
  for (const [, text, u] of plausible.slice(0, 5)) {
    console.log(`  ${text.slice(0, 60).padEnd(60)}  ${u.slice(0, 80)}`);
  }
}

function looksLikeJobUrl(source, u) {
  switch (source) {
    case "linkedin": return /\/jobs\/view\/\d+/.test(u);
    case "keepmeposted": return /\/jobs\/(\d+|view\/)/.test(u);
    case "konnekt": return /konnekt\.com\/jobs\//.test(u);
    case "castille": return /castille.*\/jobs\/[^/]+$/.test(u);
    default: return false;
  }
}

main().catch((err) => {
  console.error("test-scrape failed:", err.message);
  process.exit(1);
});
