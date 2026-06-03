# Deploy + first-run checklist

Follow these steps once all credentials are in place. Target cadence: first-run tomorrow morning.

## What's already done

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are already set:
- In `meetsync/.env` locally
- In the Trigger.dev dashboard for `proj_njxprjwjwpnxifasacvr` (meetsync deployed there)

Since job-hunt ships to the same Trigger.dev project, it inherits those automatically. You only need to add the new job-hunt-specific vars.

## What you must do

### 1. Copy OAuth client creds into job-hunt/.env

```bash
cd "C:/Users/Riccardo/Documents/My Projects/job-hunt"
cp .env.example .env
```

Then open `meetsync/.env`, copy the values of `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and paste them into `job-hunt/.env`.

### 2. Add the loopback redirect URI to the OAuth client

Required so `mint-token.mjs` can catch the consent callback.

1. Open [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Find the OAuth 2.0 Client ID matching your `GOOGLE_CLIENT_ID`
3. Click edit → **Authorized redirect URIs** → add: `http://localhost:53682/callback`
4. Save

Also enable, if not already on:
- **Gmail API** → [console.cloud.google.com/apis/library/gmail.googleapis.com](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- **Google Sheets API** → [console.cloud.google.com/apis/library/sheets.googleapis.com](https://console.cloud.google.com/apis/library/sheets.googleapis.com)

### 3. Mint the refresh token

```bash
cd "C:/Users/Riccardo/Documents/My Projects/job-hunt"
node --env-file=.env tools/mint-token.mjs
```

A browser opens, you approve the scopes, the terminal prints the token. Paste it into `.env` as `JOBHUNT_GOOGLE_REFRESH_TOKEN`.

### 4. Firecrawl API key

1. Sign up at [firecrawl.dev](https://firecrawl.dev) — free tier covers our ~14 scrapes/day
2. Copy the API key into `.env` as `FIRECRAWL_API_KEY`

### 5. Create the Google Sheet

```bash
node --env-file=.env tools/init-sheet.mjs
```
Prints `GOOGLE_SHEET_ID=...` — paste into `.env`.

### 6. Local smoke test (optional but recommended)

```bash
# One source — should show ≥5 plausible job links
node --env-file=.env tools/test-scrape.mjs jobsplus
```

### 7. Add vars to Trigger.dev dashboard

Open [cloud.trigger.dev](https://cloud.trigger.dev) → project `proj_njxprjwjwpnxifasacvr` → Environment Variables. Add to **both `prod` and `staging`**:

```
JOBHUNT_GOOGLE_REFRESH_TOKEN
FIRECRAWL_API_KEY
GOOGLE_SHEET_ID
GMAIL_RECIPIENT              # ricotedesco@gmail.com
```

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` should already be there from meetsync — confirm but don't touch.

Optional:
```
LINKEDIN_SESSION_COOKIE      # elevates LinkedIn coverage
JOBHUNT_DIGEST_CAP           # defaults to 20
```

### 8. Local dev trigger

```bash
cd "C:/Users/Riccardo/Documents/My Projects/projects/trigger-automations"
npx trigger.dev@latest dev
# → dashboard opens → Tasks → job-hunt-daily-scan → "Test"
# → Run completes in < 2 min
# → Check inbox for digest
# → Open the sheet — new rows appeared
# → Trigger again — 0 new rows (idempotent)
```

### 9. Deploy to production

```bash
npx trigger.dev@latest deploy
```

Verify:
- Dashboard → Schedules → `job-hunt-daily-scan` registered at `0 7 * * * Europe/Malta`
- Next fire time: tomorrow 07:00 Europe/Malta
- One manual test fire from dashboard → confirm prod env vars resolve

### 10. Week-1 tuning

- Daily: open the sheet, spot-check for noise
- Too many false positives → tighten `CORE_KEYWORDS` or add to `EXCLUDE_KEYWORDS` in `src/trigger/job-hunt/config.ts`
- Too few results → loosen filter, adjust score cutoffs
- Source silent 5+ days → digest auto-flags; check the site for HTML changes
- Redeploy after changes: `npx trigger.dev@latest deploy`

## Rollback

- **Disable schedule** → dashboard → Schedules → toggle off
- **Reset dedup** (false merges) → `node --env-file=.env tools/reset-dedup.mjs`
- **Disable a single source** → flip to `false` in `SOURCE_ENABLED` in `config.ts`, redeploy
