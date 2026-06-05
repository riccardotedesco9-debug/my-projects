// Shared by gate-deploy.mjs (recompute at deploy time) and mark-reviewed.mjs (record at review time).
// MUST stay the single source of this logic — if the two computed it differently the deploy gate would
// false-deny a genuinely-reviewed tree.

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Deterministic content hash of what a disk-deploy would ship: git's own content-addressed tree object
// of the working dir (tracked + untracked, minus gitignored), built in a THROWAWAY index so the real
// staging area is untouched. Using write-tree (not `git diff` text) makes the hash immune to the racy
// stat-cache and line-ending normalization that make `git diff HEAD` non-deterministic right after a
// commit. Clean tree ⇒ tree == HEAD's tree ⇒ stable. Relies on the marker dir (`.claude/`) being
// gitignored so writing a marker can't shift the hash (true in this workspace).
export function treeFingerprint(root, head) {
  const tmpIndex = join(tmpdir(), `gate-idx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    const g = (args) =>
      execSync(`git ${args}`, { cwd: root, env, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    g('read-tree HEAD');
    g('add -A');
    const tree = g('write-tree');
    return createHash('sha256').update(`${head}\0${tree}`).digest('hex').slice(0, 16);
  } finally {
    try {
      rmSync(tmpIndex, { force: true });
    } catch {}
  }
}
