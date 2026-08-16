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
//   5. every manifest secret resolves from the root .env (the source of record) — WARN, not FAIL
//      (1Password is backup-only; add --with-1p to also check the vault, which needs an op sign-in)
//   6. secrets-manifest.json ↔ .env.tpl have no opRef drift (CLAUDE.md warns this drifts)
//   7. the deploy-coupled trio paths exist (the only hardcoded project paths in shared tooling)
//   8. local edits to the package-managed ~/.claude/rules files still carry their markers — WARN
//
// Exit 1 if any hard FAIL; WARNs don't fail the run. Usage: node tools/health-check.mjs [--verbose]

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile } from './secret-lib.mjs';

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

// ClaudeKit-managed rules files carrying local fixes, each marked with an HTML comment (check #8).
const EDITED_RULES = [
  'development-rules.md',
  'documentation-management.md',
  'orchestration-protocol.md',
  'primary-workflow.md',
  'skill-domain-routing.md',
  'skill-workflow-routing.md',
];

const results = [];
const record = (status, name, detail) => results.push({ status, name, detail });
const pass = (n, d) => record('PASS', n, d);
const warn = (n, d) => record('WARN', n, d);
const fail = (n, d) => record('FAIL', n, d);

// Run one check; an uncaught throw becomes a FAIL rather than crashing the whole run.
// Async: callers with an async fn MUST `await check(...)` — otherwise the check resolves after the
// report has printed and silently reports nothing, pass or fail.
async function check(name, fn) {
  try {
    await fn();
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
    // resolveDomains returns { domains: string[], inferred: boolean } — not a bare array.
    const res = lib.resolveDomains(meetsync);
    if (!res || !Array.isArray(res.domains) || res.domains.length === 0) {
      throw new Error(`resolveDomains(meetsync) returned no domains: ${JSON.stringify(res)}`);
    }
    const how = res.inferred ? 'inferred' : 'declared';
    pass('brief-lib: resolves a domain', `meetsync → ${res.domains.join(', ')} (${how})`);
  } else {
    pass('brief-lib: resolves a domain', 'loaded (meetsync absent, skipped resolve)');
  }
});

// --- 5. Secrets resolve from the root .env, the source of record --------------------------------
// .env is checked first everywhere; 1Password is only a backup. So the health check verifies the
// LOCAL path and does not touch `op` — reaching into the vault here popped an authorization prompt
// on every run. Pass --with-1p to additionally verify the backup vault is reachable.
check('secrets: resolve from .env', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tools', 'secrets-manifest.json'), 'utf8'));
  const env = loadEnvFile();
  const unresolved = manifest.secrets.filter((s) => !process.env[s.name] && !env[s.name]);
  if (unresolved.length) {
    warn(
      'secrets: resolve from .env',
      `${unresolved.length}/${manifest.secrets.length} not in .env (would fall back to 1Password): ` +
        unresolved.map((s) => s.name).join(', '),
    );
    return;
  }
  pass('secrets: resolve from .env', `all ${manifest.secrets.length} manifest secrets present locally`);
});

if (process.argv.includes('--with-1p')) {
  check('1password: backup vault reachable', () => {
    try {
      execSync('op --version', { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      warn('1password: backup vault reachable', 'op CLI not on PATH — backup/restore unavailable');
      return;
    }
    try {
      execSync('op vault get AI-Stack --format=json', { stdio: ['ignore', 'ignore', 'ignore'], timeout: 10000 });
      pass('1password: backup vault reachable', 'signed in, AI-Stack vault reachable');
    } catch {
      warn('1password: backup vault reachable', 'op present but not signed in — run `op signin`');
    }
  });
}

// --- 6. secrets-manifest ↔ .env.tpl have no opRef drift ------------------------------------------
check('secrets: manifest ↔ .env.tpl', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tools', 'secrets-manifest.json'), 'utf8'));
  const tpl = readFileSync(join(ROOT, '.env.tpl'), 'utf8');
  // .env.tpl lines look like NAME=op://AI-Stack/item/field — build NAME→ref map.
  const tplRefs = new Map();
  for (const line of tpl.split(/\r?\n/)) {
    // Names are conventionally ALL-CAPS but mixed-case is accepted too.
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

// --- 7. Deploy-coupled project paths exist (the only hardcoded project paths in shared tooling) ---
check('paths: deploy-coupled projects', () => {
  const required = [
    join(ROOT, 'projects', 'meetsync', 'worker'), // secrets-manifest cwd
    join(ROOT, 'projects', 'trigger-automations'),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`missing: ${missing.map((p) => p.replace(ROOT, '.')).join(', ')}`);
  pass('paths: deploy-coupled projects', `all ${required.length} referenced paths present`);
});

// --- 8. Local edits to the ClaudeKit rules files survive ----------------------------------------
// The rules files are package-managed: a kit update can silently overwrite them, reverting fixes
// (dead skill names, corrected paths) and reintroducing stale instructions into every session.
// Each locally-edited file carries an HTML-comment marker; a missing marker means it was reverted.
check('rules: local edits intact', () => {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return warn('rules: local edits intact', 'no home dir in env — skipped');
  const rulesDir = join(home, '.claude', 'rules');
  if (!existsSync(rulesDir)) return warn('rules: local edits intact', `${rulesDir} not found — skipped`);

  const reverted = EDITED_RULES.filter((f) => {
    const p = join(rulesDir, f);
    return !existsSync(p) || !readFileSync(p, 'utf8').includes('local edit');
  });
  if (reverted.length) {
    return warn(
      'rules: local edits intact',
      `marker missing in ${reverted.join(', ')} — likely reverted by a ClaudeKit update; ` +
        'restore from ~/.claude/backups/instructions-*',
    );
  }
  pass('rules: local edits intact', `${EDITED_RULES.length} files still carry their local-edit marker`);
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
