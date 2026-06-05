#!/usr/bin/env node
// PreToolUse gate: blocks deploy / git-push until a code review is recorded for what is actually being
// shipped. The harness runs this regardless of what the model decides mid-session, and regardless of
// permission mode (bypassPermissions skips prompts, not hooks) — which is the whole point: prose
// reminders get skipped in long solo sessions, a hook does not.
//
// Two ship classes, two markers (both written by mark-reviewed.mjs):
//   - push   → ships COMMITS. Authorized by `.claude/.tmp/reviewed-<HEAD_SHA>.flag`. A new commit
//              changes HEAD and invalidates it. Working-tree edits don't get pushed, so a dirty tree
//              must NOT block a push of an already-reviewed commit.
//   - deploy → ships DISK STATE (wrangler/vercel/netlify/shopify/oxygen/trigger, npm run deploy, and
//              any `mcp__*deploy*` MCP tool). Authorized by `reviewed-tree-<FINGERPRINT>.flag`, where
//              the fingerprint hashes HEAD + the working-tree diff/status, so editing files after the
//              review re-arms the gate (the HEAD-only marker missed this).
//
// Fail-open: any unexpected error (not a git repo, bad input) allows the command through — the gate
// should never wedge legitimate work, only catch silent skips.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { treeFingerprint } from './gate-lib.mjs';

// Deploy CLIs, matched at the START of a command segment (after splitting on ; && || newline) so a
// deploy token inside a commit message or echo string can't trip the gate.
const DEPLOY_SEG_PATTERNS = [
  /^(npx\s+|pnpm\s+(dlx\s+)?|yarn\s+|bun\s+(x\s+)?|npm\s+(run\s+)?)?(wrangler|vercel|netlify|shopify|oxygen|trigger\.dev)\b.*\bdeploy\b/i,
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?deploy\b/i,
];
// push: `git`, optional global flags (e.g. `-C dir`), then the SUBCOMMAND `push` — not any substring.
const GIT_PUSH_PATTERN = /^git(\s+-\S+(\s+\S+)?)*\s+push\b/i;
// MCP tools whose name contains "deploy" ship a build → treat as the deploy class.
const MCP_DEPLOY_PATTERN = /^mcp__.+deploy/i;

// Known boundary (documented, intentionally NOT widened): a deploy run through a generically-named
// script (`node deploy.mjs`, `bash deploy.sh`) or via an MCP tool whose name lacks "deploy" (e.g. a
// raw Cloudflare API call) is NOT caught here. Widening to match those would false-deny routine
// commands, which violates the don't-over-constrain principle. When shipping via such a path, name
// the deploy step with a recognized verb or run the code review explicitly. Revisit only if a real
// bypass occurs.

// Classify a Bash command by splitting into segments and checking each one's start. Deploy wins over
// push if a command does both (deploy's tree fingerprint is the stricter check).
function classifyCommand(command) {
  const segments = command.split(/[\n;]|&&|\|\|/).map((s) => s.trim());
  if (segments.some((s) => DEPLOY_SEG_PATTERNS.some((re) => re.test(s)))) return 'deploy';
  if (segments.some((s) => GIT_PUSH_PATTERN.test(s))) return 'push';
  return null;
}

function allow() {
  // No output + exit 0 = hook is a no-op, command proceeds.
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const raw = await readStdin();
  if (!raw.trim()) allow();

  const payload = JSON.parse(raw);
  const toolName = payload?.tool_name || '';

  let klass = null; // 'push' | 'deploy' | null
  if (toolName === 'Bash') {
    klass = classifyCommand(payload?.tool_input?.command ?? '');
  } else if (MCP_DEPLOY_PATTERN.test(toolName)) {
    klass = 'deploy';
  }
  if (!klass) allow();

  // Resolve the repo root + HEAD from the command's own cwd (projects deploy from their own subdir but
  // share the one workspace git repo).
  const cwd = payload?.cwd || process.cwd();
  const git = (args) =>
    execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();

  const root = git('rev-parse --show-toplevel');
  const head = git('rev-parse HEAD');
  const tmp = (name) => join(root, '.claude', '.tmp', name);

  if (klass === 'push') {
    if (existsSync(tmp(`reviewed-${head}.flag`))) allow();
    deny(
      `Push blocked: no code review recorded for commit ${head.slice(0, 8)}.\n` +
        `Run the code-reviewer agent (or /code-review) on the changes. Once it passes with no ` +
        `must-fix findings:\n    node tools/mark-reviewed.mjs\nthen retry. (A new commit re-arms the ` +
        `gate — commit first, then review, then push.)`,
    );
  }

  // klass === 'deploy' — authorize against the working-tree fingerprint (what's actually shipping).
  const fp = treeFingerprint(root, head);
  if (existsSync(tmp(`reviewed-tree-${fp}.flag`))) allow();
  deny(
    `Deploy blocked: no code review recorded for the current working tree ` +
      `(commit ${head.slice(0, 8)}, tree ${fp}).\n` +
      `A deploy ships files on disk, so any edit since the last review must be reviewed again. ` +
      `Run the code-reviewer agent (or /code-review), then:\n    node tools/mark-reviewed.mjs\n` +
      `then retry. (Editing files after marking re-arms the gate.)`,
  );
} catch {
  // Never wedge real work on an unexpected error.
  allow();
}
