#!/usr/bin/env node
// PostToolUse reminder — every plan-mode plan should OPEN with a TLDR so its gist lands at a glance
// without scrolling. Fires on writes to plan-mode plan files (a `.claude/plans/*.md` path); if no
// TLDR appears near the top, injects a one-line reminder to add one. Reminder only — it never blocks
// the write, and it stays silent once a TLDR is present. Fail-open: any error → emit nothing.

import { readFileSync } from 'node:fs';

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
  const fp = payload?.tool_input?.file_path || '';

  // Scope to plan-mode plan files only: a markdown file under a `.claude/plans/` directory.
  if (!/[\\/]\.claude[\\/]plans[\\/].+\.md$/i.test(fp)) emit('');

  let content = '';
  try {
    content = readFileSync(fp, 'utf8');
  } catch {
    emit(''); // file unreadable (e.g. mid-rename) → stay silent
  }

  // A TLDR near the top (first ~40 lines), as a heading or bold/plain label, satisfies the rule.
  const head = content.split('\n').slice(0, 40).join('\n');
  if (/(^|\n)\s*#{0,6}\s*\**\s*(tl;?dr)\b/i.test(head)) emit(''); // present → silent

  emit(
    'Reminder: this plan-mode plan has no TLDR near the top. Add a 2-3 line **TLDR** at the very ' +
      'start — the gist without losing key information — so it can be grasped at a glance before the detail.',
  );
} catch {
  emit('');
}
