#!/usr/bin/env node
// sync-secrets.mjs — Push secrets to Cloudflare (wrangler) and Trigger.dev
// (env-file for dashboard import).
//
// Values come from the root .env first (the source of record) and fall back to
// 1Password only when a secret is missing locally — so a normal sync needs no
// `op` sign-in. Pass --op-only to force reading everything from the vault.
//
// Usage:
//   node tools/sync-secrets.mjs --dry-run                  # show diff, no writes
//   node tools/sync-secrets.mjs                            # apply to all platforms
//   node tools/sync-secrets.mjs --target=cloudflare-meetsync
//   node tools/sync-secrets.mjs --target=trigger-prod
//   node tools/sync-secrets.mjs --op-only                  # ignore .env, read from 1Password
//
// Requirements:
//   - Secrets present in the root .env (or 1Password CLI signed in as fallback)
//   - For wrangler targets: `npm i -g wrangler` (or rely on local node_modules)
//
// Writes Trigger.dev env files to .tmp/ at 0600 — upload manually via
// dashboard → Project → Environment Variables → Import .env, then delete.

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSecret } from "./secret-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = resolve(ROOT, "tools/secrets-manifest.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetArg = args.find((a) => a.startsWith("--target="));
const targetFilter = targetArg ? targetArg.split("=")[1] : null;
const opOnly = args.includes("--op-only");

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

// Resolve one manifest secret: root .env first (source of record), 1Password as fallback.
// Records where each value came from so the run reports it and surprises are visible.
const sources = new Map();
function resolveValue(secret) {
  if (opOnly) {
    try {
      const value = execSync(`op read "${secret.opRef}"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      sources.set(secret.name, "1password");
      return value;
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : err.message;
      throw new Error(`1Password read failed for ${secret.opRef}:\n${stderr}`);
    }
  }

  const hit = readSecret(secret.name, secret.opRef);
  if (!hit) {
    throw new Error(
      `No value for ${secret.name}. Add it to the root .env (source of record), ` +
        `or sign in to 1Password for ${secret.opRef}.`,
    );
  }
  sources.set(secret.name, hit.source);
  return hit.value;
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

console.log(opOnly ? "\nFetching values from 1Password…" : "\nResolving values (.env first, 1Password as fallback)…");
const values = new Map();
for (const platform of platforms) {
  for (const s of manifest.secrets.filter((x) => x.platforms.includes(platform.id))) {
    if (!s.opRef || values.has(s.opRef)) continue;
    values.set(s.opRef, resolveValue(s));
  }
}
const tally = [...sources.values()].reduce((a, s) => ((a[s] = (a[s] || 0) + 1), a), {});
console.log(`  ${Object.entries(tally).map(([k, v]) => `${v} from ${k}`).join(", ")}`);

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
