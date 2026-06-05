#!/usr/bin/env node
// SessionStart briefing — fires when a session starts with cwd INSIDE a project
// folder (projects/<name>/...). For the root-level workflow (cwd = workspace root),
// briefing is instead driven by brief-on-file.mjs off the files Claude touches.
//
// Both share tools/brief-lib.mjs. Fail-open: any error → emit nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDomains, buildBrief, gitRoot } from './brief-lib.mjs';

function emit(context) {
  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
      }),
    );
  }
  process.exit(0);
}

try {
  const raw = readFileSync(0, 'utf8');
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const cwd = payload?.cwd || process.cwd();

  const root = gitRoot(cwd);
  if (!root) emit('');

  // Only brief when cwd is inside projects/<name>/...
  const parts = cwd.split(/[\\/]/);
  const pIdx = parts.lastIndexOf('projects');
  if (pIdx === -1 || pIdx + 1 >= parts.length) emit('');
  const projectName = parts[pIdx + 1];
  const projectDir = join(root, 'projects', projectName);

  const { domains, inferred } = resolveDomains(projectDir);
  if (!domains.length) emit('');

  emit(buildBrief(root, domains, projectName, inferred));
} catch {
  emit('');
}
