#!/usr/bin/env node
// Records that the current state passed code review, authorizing the deploy gate (see gate-deploy.mjs)
// to let push/deploy through. Writes BOTH markers so either ship class is covered:
//   - reviewed-<HEAD_SHA>.flag         → authorizes `git push` of this commit
//   - reviewed-tree-<FINGERPRINT>.flag → authorizes a disk-deploy of the current working tree
//
// Run this ONLY after a genuine code review with no must-fix findings.
//
// Order matters: COMMIT first, then review, then run this, then push/deploy. Marking before committing
// strands the markers on the old commit/tree — the next commit changes HEAD and re-arms the gate.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { treeFingerprint } from './gate-lib.mjs';

try {
  const git = (args) =>
    execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();

  const root = git('rev-parse --show-toplevel');
  const head = git('rev-parse HEAD');

  // Same fingerprint gate-deploy.mjs recomputes at deploy time (shared in gate-lib.mjs).
  const fp = treeFingerprint(root, head);
  const status = git('status --porcelain'); // for the human message only

  const dir = join(root, '.claude', '.tmp');
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString();
  writeFileSync(join(dir, `reviewed-${head}.flag`), `${stamp} reviewed commit ${head}\n`, 'utf8');
  writeFileSync(join(dir, `reviewed-tree-${fp}.flag`), `${stamp} reviewed tree ${fp} @ ${head}\n`, 'utf8');

  const dirty = status ? ' (working tree has uncommitted changes — that exact state is what the ' +
    'deploy marker authorizes; commit before pushing)' : '';
  console.log(
    `Recorded review for commit ${head.slice(0, 8)} + tree ${fp} — push and deploy gates cleared.${dirty}`,
  );
} catch (err) {
  console.error('mark-reviewed failed:', err.message);
  process.exit(1);
}
