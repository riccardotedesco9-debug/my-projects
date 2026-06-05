# CLAUDE.md — job-hunt

Domain: Engineering — lives in `projects/` (uses global + Engineering skills/agents).
> Toolkit + mandatory gates: [agents/Engineering/CLAUDE.md](../../agents/Engineering/CLAUDE.md) — your agents, skills, and the code-reviewer-before-deploy/push gate.

Daily 7am Malta digest of part-time analytical roles. Aggregates 7 sources, dedupes, emails.

## Architecture

Production code lives in `projects/trigger-automations/src/trigger/job-hunt/` (Trigger.dev task).
This folder holds:
- `docs/` — source quirks, dedup strategy, Malta localities reference
- `plans/` — implementation plans and phase notes
- `tools/` — local CLI `.mjs` scripts for testing (init-sheet, dry-run, test-scrape, reset-dedup)
- `.env.example` — credentials template

## Pipeline

```
cron (0 7 * * *, Europe/Malta)
  → 7 scrapers (Firecrawl, Promise.allSettled)
  → normalize → malta-gate → filter → score
  → dedup (6-layer vs sheet + intra-run)
  → append to Google Sheet
  → compose HTML digest → send via Gmail (if new > 0)
```

## Sources

| Source | Type | Part-time filter | Priority |
|---|---|---|---|
| linkedin | aggregator | URL flag `f_JT=P` | medium |
| jobsplus | gov portal | Keyword filter | high |
| indeed-mt | aggregator | `jt=parttime` | medium |
| keepmeposted | specialist | Keyword | high |
| careerjet | aggregator (RSS) | Keyword | low |
| konnekt | recruiter | Keyword | high |
| castille | recruiter (iGaming) | Keyword | high |

## Sheet columns (19)

`date_seen | sources | source_ids | title | company | location | locality | work_mode | part_time_yn | est_salary | contact | url | all_urls | status | notes | digest_sent | fingerprint | confidence | score`

## Credentials (`.env` + Trigger.dev dashboard)

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — reused from meetsync (already in Trigger.dev project env)
- `JOBHUNT_GOOGLE_REFRESH_TOKEN` — scopes `gmail.send` + `spreadsheets`. Mint via `node tools/mint-token.mjs`
- `FIRECRAWL_API_KEY` — sign up at firecrawl.dev
- `GOOGLE_SHEET_ID` — auto-filled after `tools/init-sheet.mjs`
- `GMAIL_RECIPIENT` — ricotedesco@gmail.com

## Local commands

```bash
# One-time setup
node --env-file=.env tools/mint-token.mjs      # mint OAuth refresh token
node --env-file=.env tools/init-sheet.mjs      # create Google Sheet + headers

# Development
node --env-file=.env tools/test-scrape.mjs jobsplus    # probe one source
node tools/dry-run.mjs                                  # preview digest HTML (no creds needed)
node --env-file=.env tools/reset-dedup.mjs             # clear fingerprint column
```

## Deploy

```bash
cd projects/trigger-automations
npx trigger.dev@latest dev        # local testing
npx trigger.dev@latest deploy     # push to production
```
