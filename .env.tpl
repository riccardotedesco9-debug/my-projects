# ─────────────────────────────────────────────────────────────────
# Single source of truth for every secret across this workspace.
# Workflow:
#   - 1Password CLI replaces values at runtime: `op run --env-file=.env.tpl -- <cmd>`
#   - tools/sync-secrets.mjs reads the same op:// refs to push to Cloudflare/Trigger.dev
#   - This file is committed (op:// refs are not secrets themselves)
#   - The matching .env (real values) is gitignored at root, mode 0600
#
# When you add a secret: add it here AND to tools/secrets-manifest.json.
# Group order is alphabetical-by-prefix; keep it that way for diff sanity.
# ─────────────────────────────────────────────────────────────────

# --- Anthropic ---
ANTHROPIC_API_KEY=op://AI-Stack/anthropic/api-key
ANTHROPIC_ADMIN_API_KEY=op://AI-Stack/anthropic-admin/api-key

# --- Cloudflare ---
CLOUDFLARE_ACCOUNT_ID=op://AI-Stack/cloudflare/account-id
CLOUDFLARE_API_TOKEN=op://AI-Stack/cloudflare/api-token
CLOUDFLARE_BILLING_API_TOKEN=op://AI-Stack/cloudflare/billing-api-token
CLOUDFLARE_D1_DATABASE_ID=op://AI-Stack/cloudflare/d1-meetsync-id

# --- ElevenLabs ---
ELEVENLABS_API_KEY=op://AI-Stack/elevenlabs/api-key

# --- Firecrawl ---
FIRECRAWL_API_KEY=op://AI-Stack/firecrawl/api-key

# --- Google: meetsync OAuth (calendar read/write) ---
GOOGLE_CLIENT_ID=op://AI-Stack/google-meetsync-oauth/client-id
GOOGLE_CLIENT_SECRET=op://AI-Stack/google-meetsync-oauth/client-secret

# --- Google: job-hunt OAuth (gmail.send + spreadsheets) ---
OAuth_Client_ID_Desktop=op://AI-Stack/google-jobhunt-oauth/client-id
OAuth_Client_Secret_Desktop=op://AI-Stack/google-jobhunt-oauth/client-secret
Google_Refresh_Token=op://AI-Stack/google-jobhunt-oauth/refresh-token
Gmail_Recepient=op://AI-Stack/jobhunt-recipient/email

# --- Trigger.dev (used by meetsync Worker to forward turns) ---
TRIGGERDEV_API_KEY=op://AI-Stack/triggerdev/api-key
TRIGGERDEV_API_URL=op://AI-Stack/triggerdev/api-url

# --- meetsync bot ---
TELEGRAM_BOT_TOKEN=op://AI-Stack/meetsync-bot/token
TELEGRAM_WEBHOOK_SECRET=op://AI-Stack/meetsync-webhook/secret
ADMIN_CHAT_ID=op://AI-Stack/meetsync-admin/chat-id
DASHBOARD_TOKEN=op://AI-Stack/meetsync-dashboard/token

# --- Cross-service alert relay (any internal service can post to /internal/alert on the meetsync Worker) ---
INTERNAL_ALERT_SECRET=op://AI-Stack/internal-alert/secret

# --- Billing pulse (monthly cost tracker) ---
BILLING_SHEET_ID=op://AI-Stack/billing-sheet/password
FAL_KEY=op://AI-Stack/fal/password
