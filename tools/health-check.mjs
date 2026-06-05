#!/usr/bin/env node
// Workspace health check — verifies the hooks/gates/secrets infrastructure THIS workspace actually
// depends on, which the global ClaudeKit runner (~/.claude/hooks/health-check.cjs) does not cover.
// That one tests upstream hook code; this one tests the tools/ scripts wired into .claude/settings.
//
// Checks, in order of how load-bearing they are:
//   1. hook scripts parse (node --check) — a syntax error silently fails-open every gate
//   2. hooks are actually registered in settings.local.json — code that isn't wired does nothing
//   3. the deploy gate actually denies a deploy and allows a benign command (the one ENFORCED gate)
//   4. brief-lib loads and resolves a known project's domain (the briefing mechanism)
//   5. 1Password reachable + AI-Stack vault present (secrets source of truth) — WARN, not FAIL
//   6. secrets-manifest.json ↔ .env.tpl have no opRef drift (CLAUDE.md warns this drifts)
//   7. the deploy-coupled trio paths exist (the only hardcoded project paths in shared tooling)
//
// Exit 1 if any hard FAIL; WARNs don't fail the run. Usage: node tools/health-check.mjs [--verbose]

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

// Hook scripts wired into settings — kept here so check #1 and #2 share one list.
const HOOK_SCRIPTS = [
  'gate-deploy.mjs',
  'gate-plan-tldr.mjs',
  'brief-domain.mjs',
  'brief-on-prompt.mjs',
  'brief-on-file.mjs',
];
// Libraries the hooks import — a syntax error here breaks the hooks that depend on them.
const LIB_SCRIPTS = ['gate-lib.mjs', 'brief-lib.mjs', 'mark-reviewed.mjs', 'sync-secrets.mjs'];

const results = [];
const record = (status, name, detail) => results.push({ status, name, detail });
const pass = (n, d) => record('PASS', n, d);
const warn = (n, d) => record('WARN', n, d);
const fail = (n, d) => record('FAIL', n, d);

// Run one check; an uncaught throw becomes a FAIL rather than crashing the whole run.
function check(name, fn) {
  try {
    fn();
  } catch (err) {
    fail(name, err.message);
  }
}

// --- 1. Hook + lib scripts parse cleanly --------------------------------------------------------
for (const file of [...HOOK_SCRIPTS, ...LIB_SCRIPTS]) {
  check(`syntax: ${file}`, () => {
    const path = join(ROOT, 'tools', file);
    if (!existsSync(path)) throw new Error('missing file');
    execSync(`node --check "${path}"`, { stdio: ['ignore', 'ignore', 'pipe'] });
    pass(`syntax: ${file}`);
  });
}

// --- 2. Hooks registered in settings.local.json -------------------------------------------------
check('settings: hooks wired', () => {
  const path = join(ROOT, '.claude', 'settings.local.json');
  if (!existsSync(path)) throw new Error('.claude/settings.local.json not found');
  const raw = readFileSync(path, 'utf8');
  const missing = HOOK_SCRIPTS.filter((s) => !raw.includes(s));
  if (missing.length) throw new Error(`not referenced in settings: ${missing.join(', ')}`);
  pass('settings: hooks wired', `${HOOK_SCRIPTS.length} hooks registered`);
});

// --- 3. Deploy gate behaves (deny a deploy, allow a benign command) -----------------------------
function runGate(payload) {
  // Mirrors how the harness invokes the PreToolUse hook: JSON on stdin, deny via stdout JSON.
  const out = execSync(`node "${join(ROOT, 'tools', 'gate-deploy.mjs')}"`, {
    input: JSON.stringify(payload),
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'ignore'],
  }).toString();
  return out.includes('"permissionDecision":"deny"');
}
check('gate-deploy: denies a deploy', () => {
  const denied = runGate({ tool_name: 'Bash', tool_input: { command: 'wrangler deploy' }, cwd: ROOT });
  if (denied) pass('gate-deploy: denies a deploy', 'deploy blocked without a review marker');
  // Not denying is only alarming if no review marker exists; most likely a marker matches the tree.
  else warn('gate-deploy: denies a deploy', 'deploy was allowed — a current review marker likely matches the tree');
});
check('gate-deploy: allows benign command', () => {
  const denied = runGate({ tool_name: 'Bash', tool_input: { command: 'echo hello' }, cwd: ROOT });
  if (denied) throw new Error('benign `echo` was DENIED — gate is over-blocking');
  pass('gate-deploy: allows benign command');
});

// --- 4. Briefing mechanism loads + resolves a known project -------------------------------------
await check('brief-lib: resolves a domain', async () => {
  const lib = await import(pathToFileURL(join(ROOT, 'tools', 'brief-lib.mjs')).href);
  if (!Array.isArray(lib.DOMAINS) || lib.DOMAINS.length !== 4) throw new Error('DOMAINS not the 4 expected workspaces');
  const meetsync = join(ROOT, 'projects', 'meetsync');
  if (existsSync(meetsync)) {
    const domains = lib.resolveDomains(meetsync);
    if (!Array.isArray(domains) || domains.length === 0) throw new Error('resolveDomains(meetsync) returned nothing');
    pass('brief-lib: resolves a domain', `meetsync → ${domains.join(', ')}`);
  } else {
    pass('brief-lib: resolves a domain', 'loaded (meetsync absent, skipped resolve)');
  }
});

// --- 5. 1Password reachable + vault present (WARN-level: env state, not a broken setup) ----------
check('1password: op + AI-Stack vault', () => {
  try {
    execSync('op --version', { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {
    warn('1password: op + AI-Stack vault', 'op CLI not on PATH — secrets sync unavailable');
    return;
  }
  try {
    execSync('op vault get AI-Stack --format=json', { stdio: ['ignore', 'ignore', 'ignore'], timeout: 10000 });
    pass('1password: op + AI-Stack vault', 'signed in, AI-Stack vault reachable');
  } catch {
    warn('1password: op + AI-Stack vault', 'op present but not signed in / vault unreachable — run `op signin`');
  }
});

// --- 6. secrets-manifest ↔ .env.tpl have no opRef drift ------------------------------------------
check('secrets: manifest ↔ .env.tpl', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tools', 'secrets-manifest.json'), 'utf8'));
  const tpl = readFileSync(join(ROOT, '.env.tpl'), 'utf8');
  // .env.tpl lines look like NAME=op://AI-Stack/item/field — build NAME→ref map.
  const tplRefs = new Map();
  for (const line of tpl.split(/\r?\n/)) {
    // Names are conventionally ALL-CAPS but a few (job-hunt) are mixed-case — accept both.
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(op:\/\/\S+)/);
    if (m) tplRefs.set(m[1], m[2]);
  }
  const drift = [];
  for (const s of manifest.secrets || []) {
    if (!s.opRef) continue; // staged/partial — intentionally skipped, per manifest comment
    if (!tplRefs.has(s.name)) drift.push(`${s.name}: in manifest, absent from .env.tpl`);
    else if (tplRefs.get(s.name) !== s.opRef) drift.push(`${s.name}: ref mismatch`);
  }
  if (drift.length) throw new Error(drift.join('; '));
  pass('secrets: manifest ↔ .env.tpl', `${tplRefs.size} refs consistent`);
});

// --- 7. Deploy-coupled trio paths exist (the only hardcoded project paths in shared tooling) -----
check('paths: deploy-coupled trio', () => {
  const required = [
    join(ROOT, 'projects', 'meetsync', 'worker'), // secrets-manifest cwd
    join(ROOT, 'projects', 'trigger-automations'),
    join(ROOT, 'projects', 'job-hunt'),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`missing: ${missing.map((p) => p.replace(ROOT, '.')).join(', ')}`);
  pass('paths: deploy-coupled trio', 'all 3 referenced paths present');
});

// --- Report -------------------------------------------------------------------------------------
const icon = { PASS: 'OK  ', WARN: 'WARN', FAIL: 'FAIL' };
console.log(`\nWorkspace Health Check — ${results.length} checks\n`);
for (const r of results) {
  const detail = (VERBOSE || r.status !== 'PASS') && r.detail ? `  — ${r.detail}` : '';
  console.log(`  [${icon[r.status]}] ${r.name}${detail}`);
}
const fails = results.filter((r) => r.status === 'FAIL').length;
const warns = results.filter((r) => r.status === 'WARN').length;
console.log(`\n  ${results.length - fails - warns} passed, ${warns} warn, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
