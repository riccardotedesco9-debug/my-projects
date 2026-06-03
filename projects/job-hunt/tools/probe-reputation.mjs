#!/usr/bin/env node
// probe-reputation.mjs — diagnose reputation lookups for a specific company.
// Runs each source query independently, shows URLs returned + rating parse
// verdict. Helps decide why a company with known reviews isn't hitting.
//
// Usage:  node --env-file=.env tools/probe-reputation.mjs "Aristocrat Interactive"

const QUERIES = [
  { name: "Glassdoor",  query: (c) => `"${c}" glassdoor reviews rating`,    urlFilter: /glassdoor\.com/i },
  { name: "Indeed",     query: (c) => `site:indeed.com/cmp "${c}" reviews`, urlFilter: /indeed\.com/i },
  { name: "Trustpilot", query: (c) => `site:trustpilot.com/review "${c}"`,  urlFilter: /trustpilot\.com/i },
  { name: "Google Maps",query: (c) => `"${c}" google maps reviews`,         urlFilter: /google\.com\/maps/i },
  { name: "Comparably", query: (c) => `site:comparably.com "${c}"`,         urlFilter: /comparably\.com/i },
];

// Same two-pass regex as pipeline/company-reputation.ts → parseRating.
function parseRating(text) {
  const delimited = text.match(/\b([0-5]\.\d)\s*(?:\/\s*5|out of 5|stars?|★|·|\()/i);
  let rating;
  if (delimited) rating = Number(delimited[1]);
  if (rating === undefined) {
    const loose = text.match(/(?:rating[:\s]+)?([0-5]\.\d)(?=[^\d]{0,30}\d[\d,]*\s*reviews?)/i);
    if (loose) rating = Number(loose[1]);
  }
  if (rating === undefined || !Number.isFinite(rating) || rating < 1.0 || rating > 5) return undefined;
  const reviewMatch = text.match(/([\d,]+)\s*reviews?/i);
  const reviews = reviewMatch ? Number(reviewMatch[1].replace(/,/g, "")) : 0;
  return { rating, reviews };
}

async function runQuery(apiKey, source, company) {
  const q = source.query(company);
  console.log(`\n━━━ ${source.name} ━━━`);
  console.log(`Query: ${q}`);
  const resp = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, limit: 8 }),
  });
  if (!resp.ok) {
    console.log(`  ✗ Firecrawl ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    return;
  }
  const body = await resp.json();
  const hits = body.data ?? [];
  console.log(`  Hits total: ${hits.length}`);
  const matching = hits.filter((h) => source.urlFilter.test(h.url ?? ""));
  console.log(`  URL-filtered: ${matching.length}`);
  for (const h of hits.slice(0, 5)) {
    const passes = source.urlFilter.test(h.url ?? "");
    const blob = `${h.title ?? ""} ${h.description ?? ""}`;
    const parsed = passes ? parseRating(blob) : null;
    const mark = passes ? (parsed ? `✓ ${parsed.rating}★ (${parsed.reviews} reviews)` : "✗ parse failed") : "✗ url filter rejected";
    console.log(`    ${mark}`);
    console.log(`      url:   ${(h.url ?? "").slice(0, 110)}`);
    console.log(`      title: ${(h.title ?? "").slice(0, 110)}`);
    console.log(`      desc:  ${(h.description ?? "").slice(0, 160)}`);
  }
}

async function main() {
  const company = process.argv.slice(2).join(" ").trim();
  if (!company) {
    console.error("Usage: node tools/probe-reputation.mjs <Company Name>");
    process.exit(1);
  }
  const apiKey = process.env.FireCrawlAPI;
  if (!apiKey) throw new Error("FireCrawlAPI is not set");
  console.log(`Probing reputation sources for: ${company}`);
  for (const source of QUERIES) {
    try { await runQuery(apiKey, source, company); }
    catch (err) { console.log(`  ERROR: ${err.message}`); }
  }
}

main().catch((err) => { console.error("probe failed:", err.message); process.exit(1); });
