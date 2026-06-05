#!/usr/bin/env node
// PostToolUse briefing — the trigger that matches the real workflow: working from the
// My Projects ROOT and touching project files via the IDE (never cd-ing into a project).
//
// When Claude reads/edits/writes a file under projects/<name>/, this briefs the matching
// domain's toolkit + gates ONCE per session+project (deduped via a marker), so the brief
// arrives the moment work on a project begins — regardless of cwd.
//
// Fail-open: any error → emit nothing (never disrupt a tool result).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDomains, buildBrief, gitRoot } from './brief-lib.mjs';

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

  // Dedup: brief each project once per session.
  const sessionId = (payload?.session_id || 'nosession').replace(/[^\w.-]/g, '_');
  const tmpDir = join(root, '.claude', '.tmp');
  const marker = join(tmpDir, `briefed-${sessionId}-${projectName}.flag`);
  if (existsSync(marker)) emit(''); // already briefed this project this session

  const { domains, inferred } = resolveDomains(projectDir);
  if (!domains.length) emit(''); // undeterminable → stay silent (don't write marker; allow a later retry)

  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(marker, `${new Date().toISOString()} ${domains.join(',')}\n`, 'utf8');

  emit(buildBrief(root, domains, projectName, inferred));
} catch {
  emit('');
}
