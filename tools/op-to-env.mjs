#!/usr/bin/env node
// Materialize the gitignored workspace-root `.env` from 1Password.
//
// Reads every `NAME=op://AI-Stack/<item>/<field>` line in `.env.tpl` and writes the resolved
// real values to `.env`. Run this once after a key rotation (or to (re)create `.env` on a fresh
// machine). 1Password stays the source of truth; `.env` is a generated, gitignored cache that
// scripts/tools read at runtime so nothing depends on a per-command `op` approval popup.
//
// Usage:  node tools/op-to-env.mjs        (requires the `op` CLI signed in to the AI-Stack vault)
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const tpl = readFileSync(new URL(".env.tpl", root), "utf8");
const out = [];
const failed = [];

for (const line of tpl.split(/\r?\n/)) {
  // Only real refs: NAME=op://vault/item/field (>= 3 path segments). Comments / blanks are skipped.
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(op:\/\/[^/\s]+\/[^/\s]+\/\S+)$/);
  if (!m) continue;
  const [, name, ref] = m;
  try {
    const val = execFileSync("op", ["read", ref], { encoding: "utf8" }).trim();
    if (val) out.push(`${name}=${val}`);
    else failed.push(name);
  } catch {
    failed.push(name);
  }
}

writeFileSync(new URL(".env", root), out.join("\n") + "\n", { mode: 0o600 });
console.log(`wrote .env with ${out.length} keys`);
if (failed.length) console.error("could not read (left out):", failed.join(", "));
