# Source quirks — job-hunt scrapers

**v2 status** (probed 2026-04-22):

All active sources go through Firecrawl `/v1/search` which uses Google's index — this bypasses every SPA, CAPTCHA, and site-level bot block because Google already crawled the rendered pages.

| Source | Status | Query | Notes |
|---|---|---|---|
| linkedin | ✅ Working | `site:linkedin.com/jobs/view analyst malta part time` | Part-time keyword in titles → auto-scored high |
| konnekt | ✅ Working | `site:konnekt.com analyst malta` | 16+ filtered analyst jobs |
| keepmeposted | ✅ Working | `site:keepmeposted.com.mt analyst` | 17+ finance/revenue analyst jobs |
| maltajobsboard | ✅ Working | `site:maltajobsboard.com analyst` | AML/KYC/compliance/fintech analyst rich |
| archer | ✅ Working | `site:archer.mt analyst` | BI/data analyst, hybrid roles |
| castille | ✅ Working | sitemap.xml | `castilleresources.com/sitemap.xml` lists ~1000 job URLs at `castillians.com/jobs/{slug}/{id}`. Zero Firecrawl credits — plain fetch + slug-based filter. |
| jooble | ✅ Working | Jooble API | Structured JSON aggregator. Malta index thin (~90 jobs total) but surfaces ATS-platform postings (Manatal, Swooped, HireLifeScience) not in other sources. Env: `Jooble_API_Key`. |
| jobsplus | ❌ Dead | — | JS SPA; sitemap has only static pages/courses, no vacancies. `actions: [scroll, wait]` still shows only chatbot shell |
| indeed-mt | ❌ Dead | — | `mt.indeed.com` DNS doesn't exist; `www.indeed.com` uses `noindex` on search URLs |
| careerjet | ❌ Dead | — | `/search/rss.html` explicitly disallowed in robots.txt; Google has only category list pages |

The ❌ sources stay in `SOURCE_ENABLED` as `false` — they're **confirmed unreachable** even via Firecrawl search. Do not retry in future sessions; solving each requires either Firecrawl `actions` multi-step scripts (costly) or direct API reverse-engineering (fragile).

### Deferred explorations
- **Firecrawl `actions` for jobsplus** — 3-5 credits per run, only worthwhile if user specifically wants gov vacancies
- **Adzuna MT API** — endpoint returns error page, appears deprecated (probed 2026-04-22)
- **Jooble API** — untested alternative aggregator

---

One file per source. Populate during Phase 3 URL-probing (Firecrawl scrape → eyeball → note selectors and URL flags).

## Strategy
- **One broad search per source per run** — keyword permutations client-side after scrape (quota control)
- `Firecrawl scrape` with `formats: ["markdown"]` → parse markdown listings, fallback to extractor schema if structure is wild
- For all sources: dedup by URL (exact) + fingerprint (title+company) inside the pipeline

## linkedin.com
- Search URL: `https://www.linkedin.com/jobs/search/?keywords=analyst&location=Malta&f_JT=P&sortBy=DD`
  - `f_JT=P` = Part Time filter
  - `sortBy=DD` = Date Descending
- Public results only (no auth). Optional `LINKEDIN_SESSION_COOKIE` for authenticated results — pass as cookie header in Firecrawl request.
- Rate-limited; 1 call/day is safe.

## jobsplus.gov.mt
- Search URL: `https://vacancies.jobsplus.gov.mt/Vacancies/Search`
  - Form-based. Simpler to hit `/Vacancies/Index?searchTerm=analyst` and filter client-side.
- Gov site — reasonably stable HTML. Titles + company + locality present in listings.
- **Highest authority** — a job on Jobsplus has been formally registered.

## mt.indeed.com
- Search URL: `https://mt.indeed.com/jobs?q=analyst&jt=parttime&l=Malta&sort=date`
  - `jt=parttime` is the part-time filter
- Sponsored vs organic: pick organic only (class marker `jobsearch-SerpJobCard`).
- Aggressive anti-bot — Firecrawl usually handles it but monitor for CAPTCHA responses.

## keepmeposted.com.mt
- Search URL: `https://www.keepmeposted.com.mt/jobs?s=analyst`
- Local Malta jobs board. Straightforward HTML. Good source for SME roles Jobsplus doesn't show.

## careerjet.com.mt
- Search URL: `https://www.careerjet.com.mt/jobs?s=analyst&l=Malta&p=1`
- RSS available: `https://www.careerjet.com.mt/jobs.rss?s=analyst&l=Malta` — prefer RSS (cheaper, stabler) with HTML fallback.

## konnekt.com
- Search URL: `https://www.konnekt.com/search?keyword=analyst&jobType=PartTime`
- Specialist recruiter, Malta-focused. Descriptions are rich. Contact field sometimes has the recruiter's email.

## castilleresources.com
- Search URL: `https://www.castilleresources.com/jobs?keywords=analyst`
- iGaming + fintech recruiter. Scores high (+20 iGaming domain boost).

---

## Probe checklist (during Phase 3 implementation)

For each source, before writing the scraper:
1. `node tools/probe.mjs <source>` → one raw Firecrawl call, dump markdown to `.tmp/<source>-probe.md`
2. Eyeball markdown → locate listing boundaries (consistent markers like `## Title` or `- [Title](url)`)
3. Write scraper: extract `{ title, company, location, url, snippet }` → hand off to normalize.ts
4. `node tools/test-scrape.mjs <source>` → confirm ≥5 jobs returned
