#!/usr/bin/env node
// PostToolUse briefing — the trigger that matches the real workflow: working from the
// My Projects ROOT and touching project files via the IDE (never cd-ing into a project).
//
// When Claude reads/edits/writes a file under projects/<name>/, this briefs the matching
// domain's toolkit + gates ONCE per session+project (deduped via a marker), so the brief
// arrives the moment work on a project begins — regardless of cwd.
//
// Fail-open: any error → emit nothing (never disrupt a tool result).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDomains, buildBrief, gitRoot, alreadyBriefed, markBriefed } from './brief-lib.mjs';

function emit(context) {
  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
      }),
    );
  }
  process.exit(0);
}

try {
  const raw = readFileSync(0, 'utf8');
  const payload = raw.trim() ? JSON.parse(raw) : {};

  // The file this tool acted on (Read/Edit/Write/MultiEdit use file_path; notebooks differ).
  const ti = payload?.tool_input || {};
  const filePath = ti.file_path || ti.notebook_path || ti.path || '';
  if (!filePath) emit('');

  // Locate the project segment: .../projects/<name>/...
  const parts = filePath.split(/[\\/]/);
  const pIdx = parts.lastIndexOf('projects');
  if (pIdx === -1 || pIdx + 1 >= parts.length) emit(''); // file outside projects/ → ignore
  const projectName = parts[pIdx + 1];

  // Workspace root = the path up to (not including) the `projects` segment.
  const rootCandidate = parts.slice(0, pIdx).join('/');
  const root = gitRoot(rootCandidate) || rootCandidate;
  if (!root) emit('');
  const projectDir = join(root, 'projects', projectName);
  if (!existsSync(projectDir)) emit('');

  // Dedup: brief each project once per session, via the marker shared with the prompt &
  // session-start hooks (whichever fired first already briefed it → stay silent).
  const sessionId = payload?.session_id || 'nosession';
  if (alreadyBriefed(root, sessionId, projectName)) emit('');

  const { domains, inferred } = resolveDomains(projectDir);
  if (!domains.length) emit(''); // undeterminable → stay silent (don't mark; allow a later retry)

  markBriefed(root, sessionId, projectName, domains);
  emit(buildBrief(root, domains, projectName, inferred));
} catch {
  emit('');
}
