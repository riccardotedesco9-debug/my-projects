#!/usr/bin/env node
// UserPromptSubmit briefing — the ONLY trigger that precedes the model's first generated action,
// so it's where "make the AI aware of the full relevant toolkit BEFORE it acts" actually belongs.
//
// On each prompt:
//   - If a project is resolvable (cwd inside projects/<name>, or the prompt names an existing
//     project), inject that project's FULL toolkit brief (gates + skills + MCP + agents + project
//     CLAUDE pointer), deduped once per session+project via a marker SHARED with the SessionStart
//     and PostToolUse hooks — so a project is briefed exactly once, by whichever fires first.
//   - Otherwise inject a short, one-per-session orientation nudge so brand-new / unnamed work is
//     still pointed at the structure before the first action.
//
// Fail-open: any error → emit nothing (never disrupt the prompt).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveDomains,
  buildBrief,
  gitRoot,
  alreadyBriefed,
  markBriefed,
  alreadyNudged,
  markNudged,
  projectFromPath,
  findProjectInPrompt,
  genericNudge,
} from './brief-lib.mjs';

function emit(context) {
  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
      }),
    );
  }
  process.exit(0);
}

try {
  const raw = readFileSync(0, 'utf8');
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const cwd = payload?.cwd || process.cwd();
  const prompt = payload?.prompt || '';
  const sessionId = payload?.session_id || 'nosession';

  const root = gitRoot(cwd);
  if (!root) emit('');

  // Resolve the project: cwd inside projects/<name> first, else a reference in the prompt text.
  let projectName = projectFromPath(cwd);
  if (!projectName) projectName = findProjectInPrompt(root, prompt);

  if (projectName) {
    const projectDir = join(root, 'projects', projectName);
    if (existsSync(projectDir)) {
      if (alreadyBriefed(root, sessionId, projectName)) emit(''); // briefed this session → silent
      const { domains, inferred } = resolveDomains(projectDir);
      if (domains.length) {
        markBriefed(root, sessionId, projectName, domains);
        emit(buildBrief(root, domains, projectName, inferred));
      }
    }
  }

  // No project briefed → generic orientation, once per session.
  if (alreadyNudged(root, sessionId)) emit('');
  markNudged(root, sessionId);
  emit(genericNudge());
} catch {
  emit('');
}
