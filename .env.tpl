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

SHOPIFY_CLIENT_ID=op://AI-Stack/Shopify ID & Secret/username
SHOPIFY_CLIENT_SECRET=op://AI-Stack/Shopify ID & Secret/password
BUILDER_PRIVATE_KEY=op://AI-Stack/builder/password

# Backup copies of secrets whose source of record is .env (mirrored 2026-07-28)
BARCODELOOKUP_API_KEY=op://AI-Stack/barcodelookup/api-key
HIKE_CLIENT_ID=op://AI-Stack/hike-oauth/client-id
HIKE_CLIENT_SECRET=op://AI-Stack/hike-oauth/client-secret
HIKE_REDIRECT_URI=op://AI-Stack/hike-oauth/redirect-uri
HIKE_ACCESS_TOKEN=op://AI-Stack/hike-oauth/access-token
HIKE_REFRESH_TOKEN=op://AI-Stack/hike-oauth/refresh-token
HIKE_TOKEN_OBTAINED_AT=op://AI-Stack/hike-oauth/token-obtained-at

# --- Catalogue engine: optional identity sources (fail-open no-ops until set) -------------------
# Open Icecat, free tier. Barcode-keyed, manufacturer-approved data sheets -> joins the GREEN
# cascade. Register: https://icecat.biz/en/registration
ICECAT_USERNAME=op://AI-Stack/icecat/username
# eBay Browse API, free. GTIN search, global, any category. Capped at YELLOW in the engine because
# eBay's GTIN is seller-asserted. Register: https://developer.ebay.com/
EBAY_CLIENT_ID=op://AI-Stack/ebay-browse/client-id
EBAY_CLIENT_SECRET=op://AI-Stack/ebay-browse/client-secret
