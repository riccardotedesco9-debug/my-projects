#!/usr/bin/env node
// probe-search.mjs — hit Firecrawl /v1/search for a source's query and dump
// what URLs come back. Use to diagnose zero-return scrapers (regex drift,
// site relaunch, Google deindexing).
//
// Usage:  node --env-file=.env tools/probe-search.mjs konnekt

const QUERIES = {
  konnekt: "site:konnekt.com malta",
  archer: "site:archer.mt",
  "indeed-ie": "site:ie.indeed.com",
  linkedin: "site:linkedin.com/jobs/view malta part-time",
  "linkedin-ie": "site:ie.linkedin.com/jobs/view",
  maltajobsboard: "site:maltajobsboard.com",
  mfsa: "site:mfsa.mt/career",
};

// Regex each source uses to extract its sourceId from URLs. Kept in sync with
// src/trigger/job-hunt/scrapers/*.ts manually — mirrored here for diagnostics.
const REGEXES = {
  konnekt: /\/jobs\/[^/]+\/[^/]+\/(\d+)(?:[/?#]|$)/,
  archer: /archer\.mt\/job\/([^/?#]+)/i,
  "indeed-ie": /[?&]jk=([A-Za-z0-9]+)/,
  linkedin: /\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/,
  "linkedin-ie": /\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/,
  maltajobsboard: /maltajobsboard\.com\/job\/([^/?#]+)/i,
  mfsa: /mfsa\.mt\/career\/([^/?#]+)/i,
};

async function main() {
  const source = process.argv[2];
  const q = QUERIES[source];
  const re = REGEXES[source];
  if (!q) {
    console.error("Usage: node tools/probe-search.mjs <source>");
    console.error("  Known:", Object.keys(QUERIES).join(", "));
    process.exit(1);
  }
  const apiKey = process.env.FireCrawlAPI;
  if (!apiKey) throw new Error("FireCrawlAPI is not set");

  console.log(`Query: ${q}`);
  const resp = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, limit: 50 }),
  });
  if (!resp.ok) throw new Error(`search ${resp.status}: ${await resp.text()}`);
  const body = await resp.json();
  const hits = body.data ?? [];
  console.log(`\nTotal hits returned: ${hits.length}`);

  let matched = 0;
  console.log("\nFirst 15 URLs + regex verdict:");
  for (const h of hits.slice(0, 15)) {
    const u = h.url ?? "";
    const m = re ? u.match(re) : null;
    if (m) matched++;
    console.log(`  [${m ? "OK id=" + m[1].slice(0, 20) : "NO "}] ${u.slice(0, 110)}`);
  }

  const matchedAll = hits.filter((h) => re.test(h.url ?? "")).length;
  console.log(`\nRegex match rate: ${matchedAll}/${hits.length}`);
}

main().catch((err) => {
  console.error("probe-search failed:", err.message);
  process.exit(1);
});
