# Cross-cutting tools

Workspace-wide utilities that touch multiple projects. Single-project tools live under `{project}/tools/` instead.

## `sync-secrets.mjs` — push secrets from 1Password to platforms

Single source of truth for secrets is the **AI-Stack** vault in 1Password. This script reads from 1P, pushes to Cloudflare (via `wrangler secret put`) and writes a Trigger.dev-importable `.env` for dashboard upload.

### One-time setup

1. **Install 1Password CLI**
   ```powershell
   winget install AgileBits.1Password.CLI
   op signin   # sign into your account once
   ```

2. **Create the AI-Stack vault** in 1Password (any device)
   - Use whatever item structure you like — what matters is the `op://AI-Stack/<item>/<field>` references match `secrets-manifest.json`.
   - Recommended item names mirror the `opRef` field in `secrets-manifest.json`. Adjust the manifest if you've already named items differently.

3. **Populate from your existing `.env` files** (one-time, ~30 min)
   - Open each `.env` referenced in the audit (projects/meetsync/, projects/trigger-automations/)
   - For each variable, create or update the matching 1P item

4. **Verify**
   ```powershell
   op read "op://AI-Stack/anthropic/api-key"
   # → should print the key. If "not found", fix the manifest opRef or the item path.
   ```

### Day-to-day usage

```powershell
# Show plan without writing
node tools/sync-secrets.mjs --dry-run

# Push to Cloudflare only (meetsync Worker secrets)
node tools/sync-secrets.mjs --target=cloudflare-meetsync

# Generate Trigger.dev .env file (then import via dashboard)
node tools/sync-secrets.mjs --target=trigger-prod
# → writes .tmp/trigger-prod.env with mode 0600
# → upload via Trigger.dev dashboard → Project → Environment Variables → Import .env
# → delete .tmp/trigger-prod.env after import

# Push everything
node tools/sync-secrets.mjs
```

### Recommended cutover order

Migrate one platform at a time so a mistake never tanks both halves of the stack:

1. **Cloudflare first** (meetsync Worker)
   - `node tools/sync-secrets.mjs --target=cloudflare-meetsync --dry-run`
   - Apply, then deploy: `cd projects/meetsync/worker && npx wrangler deploy`
   - Confirm bot replies to a Telegram message
   - Confirm `/dashboard?token=...` still works
2. **Trigger.dev second**
   - `node tools/sync-secrets.mjs --target=trigger-prod --dry-run`
   - Apply (writes file), import via dashboard
   - Trigger a manual run of `billing-monthly-pulse` and `meetsync-turn-handler`
   - Watch logs for missing-env errors
3. **Cleanup**
   - Delete the `.tmp/trigger-prod.env` after dashboard import
   - Keep per-project `.env` files only if a project genuinely needs its own; the workspace root `.env` is the source of record

### Local dev — load the root `.env`

The gitignored **`.env` at workspace root is the source of record**; 1Password is a backup. Load it and run — no authorization prompt:

```powershell
# PowerShell, from anywhere
Get-Content "$env:USERPROFILE\Documents\My Projects\.env" | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) }
}
npx wrangler dev        # or: npx trigger.dev@4.4.4 dev
```

```bash
# Bash
set -a; . "$HOME/Documents/My Projects/.env"; set +a
npx wrangler dev
```

Node scripts can skip the shell entirely — `import { hydrateProcessEnv } from './tools/secret-lib.mjs'` then `hydrateProcessEnv()`, which is what the workspace tooling does.

**Fallback only:** `op run --env-file=".env.tpl" -- <command>` injects from 1Password without writing to disk, but prompts for authorization every time. Use it when a secret is missing locally or on a fresh machine — not by default.

### When you add a new secret

1. Add the item to the AI-Stack vault
2. Add a row to `secrets-manifest.json` with the `opRef` and target platforms
3. Add the variable to the root `.env.tpl` (so local dev picks it up)
4. Re-run `sync-secrets.mjs --target=<platform>` to push

### Risks / known gotchas

- **`op run` on PowerShell**: argument splitting is fussier than on bash. If a secret contains special characters and breaks the child process invocation, prefer `op inject` (template substitution) over `op run`.
- **Trigger.dev import**: the dashboard's `.env` import is per-environment. Pick "prod" not "dev" when uploading the synced file.
- **Wrangler secret bulk**: this script invokes `wrangler secret put` once per secret. For 10+ secrets that's noticeable; consider switching to `wrangler secret bulk` if it becomes a bottleneck.
- **`.tmp/trigger-prod.env`**: ignored by git (root-level `**/.tmp/`), but still on disk at 0600 until you delete it. Treat as a hot artifact — import and delete in one sitting.
