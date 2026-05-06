#!/usr/bin/env node
// sync-secrets.mjs — Push secrets from 1Password (AI-Stack vault) to
// Cloudflare (wrangler) and Trigger.dev (env-file for dashboard import).
//
// Usage:
//   node tools/sync-secrets.mjs --dry-run                  # show diff, no writes
//   node tools/sync-secrets.mjs                            # apply to all platforms
//   node tools/sync-secrets.mjs --target=cloudflare-meetsync
//   node tools/sync-secrets.mjs --target=trigger-prod
//
// Requirements:
//   - 1Password CLI installed and signed in (`op signin`)
//   - For wrangler targets: `npm i -g wrangler` (or rely on local node_modules)
//
// Writes Trigger.dev env files to .tmp/ at 0600 — upload manually via
// dashboard → Project → Environment Variables → Import .env, then delete.

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = resolve(ROOT, "tools/secrets-manifest.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetArg = args.find((a) => a.startsWith("--target="));
const targetFilter = targetArg ? targetArg.split("=")[1] : null;

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

function opRead(ref) {
  if (!ref) return null;
  try {
    return execSync(`op read "${ref}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`1Password read failed for ${ref}:\n${stderr}`);
  }
}

function pushWrangler(secret, value, cwd) {
  const result = spawnSync("npx", ["wrangler", "secret", "put", secret.name], {
    cwd: resolve(ROOT, cwd),
    input: value,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      `wrangler secret put ${secret.name} failed (exit ${result.status}):\n${result.stderr}`,
    );
  }
}

function writeEnvFile(path, entries) {
  const absPath = resolve(ROOT, path);
  mkdirSync(dirname(absPath), { recursive: true });
  const lines = entries.map(([k, v]) => {
    const escaped = String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${k}="${escaped}"`;
  });
  writeFileSync(absPath, lines.join("\n") + "\n");
  try {
    chmodSync(absPath, 0o600);
  } catch {
    // chmod is a no-op on Windows; ignore
  }
  return absPath;
}

function summarize(diff) {
  const lines = [];
  for (const [platform, items] of Object.entries(diff)) {
    lines.push(`\n=== ${platform} ===`);
    for (const item of items) {
      lines.push(`  ${item.skipped ? "SKIP" : "PUSH"}  ${item.name}${item.skipped ? `  (${item.reason})` : ""}`);
    }
  }
  return lines.join("\n");
}

const platforms = manifest.platforms.filter((p) => !targetFilter || p.id === targetFilter);
if (platforms.length === 0) {
  console.error(`No platform matched --target=${targetFilter}`);
  process.exit(1);
}

const diff = {};
for (const platform of platforms) {
  const items = manifest.secrets.filter((s) => s.platforms.includes(platform.id));
  diff[platform.id] = items.map((s) => {
    if (!s.opRef) return { name: s.name, skipped: true, reason: "no opRef in manifest" };
    return { name: s.name, skipped: false };
  });
}

console.log(`${dryRun ? "[DRY RUN] " : ""}Plan:` + summarize(diff));
if (dryRun) process.exit(0);

console.log("\nFetching values from 1Password…");
const values = new Map();
for (const platform of platforms) {
  for (const s of manifest.secrets.filter((x) => x.platforms.includes(platform.id))) {
    if (!s.opRef || values.has(s.opRef)) continue;
    values.set(s.opRef, opRead(s.opRef));
  }
}

let pushed = 0;
let skipped = 0;
for (const platform of platforms) {
  console.log(`\n--- Pushing to ${platform.id} ---`);
  const items = manifest.secrets.filter((s) => s.platforms.includes(platform.id) && s.opRef);
  if (platform.type === "wrangler") {
    for (const s of items) {
      const value = values.get(s.opRef);
      console.log(`  → wrangler secret put ${s.name}`);
      pushWrangler(s, value, platform.cwd);
      pushed++;
    }
  } else if (platform.type === "trigger-env-file") {
    const entries = items.map((s) => [s.name, values.get(s.opRef)]);
    const path = writeEnvFile(platform.outputPath, entries);
    console.log(`  → wrote ${entries.length} vars to ${path}`);
    console.log(`     Upload via Trigger.dev dashboard → Project → Environment Variables → Import .env`);
    console.log(`     Delete the file once imported.`);
    pushed += entries.length;
  } else {
    console.warn(`  (unknown platform type: ${platform.type} — skipping)`);
    skipped += items.length;
  }
}

console.log(`\nDone. ${pushed} pushed, ${skipped} skipped.`);
