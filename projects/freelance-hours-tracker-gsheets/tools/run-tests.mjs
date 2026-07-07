// run-tests.mjs — drives the in-GAS smoke suite from the terminal:
//   npm test  →  eslint, then `clasp run-function runSmokeTest`, pretty-print,
//   exit 0/1. If run-function isn't wired yet (needs a standard GCP project +
//   Apps Script API), it points at the identical in-sheet menu runner.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const res = spawnSync('npx', ['clasp', 'run-function', 'runSmokeTest'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  // fileURLToPath handles the space in "My Projects" (URL.pathname keeps %20).
  cwd: fileURLToPath(new URL('..', import.meta.url)),
});

const out = `${res.stdout || ''}\n${res.stderr || ''}`;
const jsonMatch = out.match(/\{[\s\S]*"results"[\s\S]*\}/);

if (!jsonMatch) {
  console.error(out.trim());
  console.error(
    '\n✋ Could not get a result from `clasp run-function`.\n' +
      'One-time wiring it needs: attach a standard GCP project to the Apps Script\n' +
      'project and enable the Apps Script API on it, then deploy as API executable.\n' +
      'Until then, run the SAME suite from the sheet: ⏱ Tracker → Run smoke test.'
  );
  process.exit(1);
}

let verdict;
try {
  verdict = JSON.parse(jsonMatch[0]);
} catch (e) {
  console.error(`Unparseable run-function output (${e.message}):\n` + out);
  process.exit(1);
}

const icon = (ok) => (ok ? '✔' : '✘');
let section = '';
for (const r of verdict.results) {
  if (r.section && r.section !== section) {
    section = r.section;
    console.log(`\n\x1b[1m${section}\x1b[0m`);
  }
  if (r.level === 'info') {
    console.log(`\x1b[36mℹ ${r.name}: ${r.actual}\x1b[0m`);
  } else if (r.level === 'warn') {
    if (!r.ok) console.log(`\x1b[33m⚠ ${r.name} — ${r.actual}\x1b[0m`);
  } else if (r.ok) {
    console.log(`\x1b[32m${icon(true)} ${r.name}\x1b[0m`);
  } else {
    console.log(`\x1b[31m${icon(false)} ${r.name}\x1b[0m  [expected ${r.expected} | actual ${r.actual}]`);
  }
}
const warn = verdict.warned ? ` · ⚠ ${verdict.warned} warning(s)` : '';
const skipped = verdict.skippedSections
  ? ` · ⏭ ${verdict.skippedSections} section(s) SKIPPED on time budget — rerun to cover them`
  : '';
console.log(`\n${verdict.failed === 0 ? '✅' : '❌'} ${verdict.passed}/${verdict.total} assertions passed${warn}${skipped}`);
process.exit(verdict.failed === 0 ? 0 : 1);
