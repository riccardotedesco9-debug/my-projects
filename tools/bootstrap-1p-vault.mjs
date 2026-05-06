#!/usr/bin/env node
// bootstrap-1p-vault.mjs — One-time helper to populate the AI-Stack vault
// from existing .env files on disk. Reads values locally, calls
// `op item create` for each manifest entry. Skips items that already
// exist. Prompts on stdin for values not present in any .env (Anthropic
// admin key, Elevenlabs, etc.). Auto-generates INTERNAL_ALERT_SECRET.
//
// Usage:
//   op signin                     # ensure signed in first
//   node tools/bootstrap-1p-vault.mjs

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VAULT = "AI-Stack";

// Files to scan for values, in priority order (later wins).
const ENV_FILES = [
  "Engineering/trigger-automations/.env",
  "job-hunt/.env",
  "meetsync/.env",
];

// Mapping: 1P item title -> { fieldName: envKey | (() => string) | "ASK" | "GENERATE" }
// Values resolved in this order: env file lookup > generator > prompt.
const ITEMS = {
  "meetsync-bot":          { token: "TELEGRAM_BOT_TOKEN" },
  "meetsync-webhook":      { secret: "TELEGRAM_WEBHOOK_SECRET" },
  "meetsync-admin":        { "chat-id": "ADMIN_CHAT_ID" },
  "meetsync-dashboard":    { token: "DASHBOARD_TOKEN_OR_ASK" },
  "internal-alert":        { secret: "GENERATE" },
  "anthropic":             { "api-key": "ANTHROPIC_API_KEY" },
  "anthropic-admin":       { "api-key": "ASK" },
  "triggerdev":            { "api-key": "TRIGGERDEV_API_KEY", "api-url": "TRIGGERDEV_API_URL" },
  "google-meetsync-oauth": { "client-id": "GOOGLE_CLIENT_ID", "client-secret": "GOOGLE_CLIENT_SECRET" },
  "google-jobhunt-oauth":  { "client-id": "OAuth_Client_ID_Desktop", "client-secret": "OAuth_Client_Secret_Desktop", "refresh-token": "Google_Refresh_Token" },
  "jobhunt-recipient":     { email: "Gmail_Recepient" },
  "cloudflare":            { "account-id": "CLOUDFLARE_ACCOUNT_ID", "api-token": "CLOUDFLARE_API_TOKEN", "d1-meetsync-id": "CLOUDFLARE_D1_DATABASE_ID", "billing-api-token": "ASK" },
  "elevenlabs":            { "api-key": "ASK" },
  "firecrawl":             { "api-key": "FIRECRAWL_API_KEY_OR_FireCrawlAPI" },
  // billing-sheet/id intentionally omitted — populate after creating the Google Sheet
};

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) out[m[1]] = v;
  }
  return out;
}

const envValues = {};
for (const f of ENV_FILES) {
  Object.assign(envValues, parseEnvFile(resolve(ROOT, f)));
}

function lookupEnv(key) {
  // Support `KEY_OR_ALT` syntax: try first then fallback.
  if (key.includes("_OR_")) {
    for (const k of key.split("_OR_")) {
      if (envValues[k]) return envValues[k];
    }
    return null;
  }
  return envValues[key] ?? null;
}

function itemExists(title) {
  const r = spawnSync("op", ["item", "get", title, `--vault=${VAULT}`, "--format=json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return r.status === 0;
}

function createItem(title, fields) {
  const args = ["item", "create", `--vault=${VAULT}`, "--category=password", `--title=${title}`];
  for (const [field, value] of Object.entries(fields)) {
    args.push(`${field}=${value}`);
  }
  const r = spawnSync("op", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    throw new Error(`op item create ${title} failed:\n${r.stderr || r.stdout}`);
  }
}

const rl = createInterface({ input, output });

async function ask(prompt) {
  const v = await rl.question(prompt);
  return v.trim();
}

async function main() {
  // Sanity: ensure signed in
  const who = spawnSync("op", ["whoami"], { encoding: "utf8" });
  if (who.status !== 0) {
    console.error("Not signed in. Run: Invoke-Expression $(op signin)");
    process.exit(1);
  }
  console.log(`Signed in as: ${who.stdout.trim().split("\n").find((l) => l.startsWith("Email")) || "(unknown)"}\n`);

  let created = 0, skipped = 0, failed = 0;

  for (const [title, schema] of Object.entries(ITEMS)) {
    if (itemExists(title)) {
      console.log(`SKIP   ${title} (already exists)`);
      skipped++;
      continue;
    }
    const fields = {};
    let aborted = false;
    for (const [field, source] of Object.entries(schema)) {
      let value = null;
      if (source === "GENERATE") {
        value = randomBytes(32).toString("hex");
      } else if (source === "ASK") {
        value = await ask(`  ${title}/${field} not in any .env — paste value: `);
      } else {
        value = lookupEnv(source);
        if (!value) {
          value = await ask(`  ${title}/${field} (${source}) missing — paste value: `);
        }
      }
      if (!value) {
        console.error(`SKIP   ${title} — empty value for ${field}`);
        failed++;
        aborted = true;
        break;
      }
      fields[field] = value;
    }
    if (aborted) continue;
    try {
      createItem(title, fields);
      console.log(`CREATE ${title}`);
      created++;
    } catch (err) {
      console.error(`FAIL   ${title}: ${err.message}`);
      failed++;
    }
  }

  rl.close();
  console.log(`\nDone. ${created} created, ${skipped} skipped, ${failed} failed.`);
  console.log(`\nRemaining manual items:`);
  console.log(`  - billing-sheet/id  → after creating the AI Spend Tracker Google Sheet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
