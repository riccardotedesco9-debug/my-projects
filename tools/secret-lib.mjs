// Secret resolution for workspace tooling.
//
// Order is deliberate and matches the policy in CLAUDE.md: the gitignored `.env` at the workspace
// root is the source of record, 1Password is a backup. Every lookup therefore tries local values
// first and only shells out to `op` when there is nothing local — so routine work (billing pulls,
// secret syncs, health checks) never triggers a 1Password authorization prompt.
//
// Resolution order for readSecret(name, opRef):
//   1. process.env[name]                 — already-exported shell env
//   2. .env at the workspace root        — the source of record
//   3. OP_<UPPER_SNAKE_OF_REF>           — legacy alias used by the billing scripts
//   4. `op read <opRef>`                 — 1Password, the backup

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, '.env');

let cachedEnv = null;

// Parse the root .env once. Tolerates `export ` prefixes, inline comments on unquoted values,
// quoted values, and blank/comment lines. Never throws — a missing .env just yields {}.
export function loadEnvFile(path = ENV_PATH) {
  if (cachedEnv && path === ENV_PATH) return cachedEnv;
  const out = {};
  if (existsSync(path)) {
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let value = m[2].trim();
      const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
      if (quoted) value = quoted[2];
      else value = value.replace(/\s+#.*$/, '').trim(); // strip trailing comment on bare values
      out[m[1]] = value;
    }
  }
  if (path === ENV_PATH) cachedEnv = out;
  return out;
}

// Merge the root .env into process.env without clobbering anything already exported.
export function hydrateProcessEnv() {
  const env = loadEnvFile();
  let added = 0;
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) { process.env[k] = v; added++; }
  }
  return added;
}

// The legacy alias the billing scripts used: op://AI-Stack/billing-sheet/password
// → OP_AI_STACK_BILLING_SHEET_PASSWORD.
export function opRefToEnvName(ref) {
  return 'OP_' + String(ref).replace(/^op:\/\//, '').replace(/[/-]/g, '_').toUpperCase();
}

// Resolve one secret. `name` is the variable name as it appears in .env / secrets-manifest.json;
// `opRef` is its 1Password reference (optional). Returns { value, source } or null when unresolved.
// Set opts.allowOp = false to guarantee no `op` invocation (and therefore no auth prompt).
export function readSecret(name, opRef, opts = {}) {
  const { allowOp = true } = opts;

  if (name && process.env[name]) return { value: process.env[name], source: 'process.env' };

  const fileEnv = loadEnvFile();
  if (name && fileEnv[name]) return { value: fileEnv[name], source: '.env' };

  if (opRef) {
    const alias = opRefToEnvName(opRef);
    if (process.env[alias]) return { value: process.env[alias], source: `env:${alias}` };
    if (fileEnv[alias]) return { value: fileEnv[alias], source: `.env:${alias}` };

    if (allowOp) {
      try {
        const value = execSync(`op read "${opRef}"`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        if (value) return { value, source: '1password' };
      } catch {
        return null; // not signed in / ref missing — caller decides whether that is fatal
      }
    }
  }
  return null;
}

// Reverse map op://… → the variable name that holds it, built from .env.tpl (the manifest of
// which secret lives where). Lets callers that only know an opRef still hit .env first.
let refIndex = null;
function opRefIndex() {
  if (refIndex) return refIndex;
  refIndex = new Map();
  const tplPath = join(ROOT, '.env.tpl');
  if (existsSync(tplPath)) {
    for (const raw of readFileSync(tplPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(op:\/\/\S+)/.exec(line);
      if (m) refIndex.set(m[2], m[1]);
    }
  }
  return refIndex;
}

// Resolve by 1Password reference alone: .env (via the .env.tpl name map) first, then `op read`.
// Drop-in replacement for the old per-script `opRead(ref)` helpers.
export function readSecretByRef(opRef, opts = {}) {
  const name = opRefIndex().get(opRef);
  const hit = readSecret(name, opRef, opts);
  return hit ? hit.value : null;
}

// Convenience for callers that just want the string and treat absence as fatal.
export function requireSecret(name, opRef, opts = {}) {
  const hit = readSecret(name, opRef, opts);
  if (!hit) {
    throw new Error(
      `Secret "${name}" not found. Add it to ${ENV_PATH} (the source of record)` +
        (opRef ? `, or sign in to 1Password for ${opRef}.` : '.'),
    );
  }
  return hit.value;
}
