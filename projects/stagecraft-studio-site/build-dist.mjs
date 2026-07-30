/* Builds dist/ — the ONLY directory that should ever be deployed.
 *
 * Deploying the project folder itself would publish CLAUDE.md, which names
 * competitors, sets out the undercut strategy, and records in writing that
 * drone aerials are advertised but not yet legally deliverable. It would also
 * publish the internal labs and every rejected portrait variant. None of that
 * belongs on a public domain.
 *
 * An allow-list, not an ignore-list: anything added to the project in future is
 * excluded by default and has to be named here to ship.
 *
 * index.html is fully self-contained — the portrait is an inline data URI and
 * the only external request is Google Fonts — so the site needs nothing else.
 *
 * Run: node build-dist.mjs
 */
import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

/* Files that are allowed to be public. Add deliberately. */
const SHIP = [
  'index.html',
  'og-image.jpg',        /* optional: link previews; skipped if absent */
  'robots.txt',
  'favicon.ico'
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const shipped = [];
const skipped = [];
for (const name of SHIP) {
  const src = join(here, name);
  if (!existsSync(src)) { skipped.push(name); continue; }
  await writeFile(join(dist, name), await readFile(src));
  shipped.push(`${name} (${Math.round((await stat(src)).size / 1024)} KB)`);
}

/* Fail loudly if anything unexpected slipped into dist */
const actual = await readdir(dist);
const unexpected = actual.filter(f => !SHIP.includes(f));
if (unexpected.length) throw new Error('Unexpected files in dist: ' + unexpected.join(', '));

console.log('dist/ contains ONLY:');
shipped.forEach(f => console.log('  ✓ ' + f));
if (skipped.length) console.log('not present (fine):  ' + skipped.join(', '));

const excluded = (await readdir(here, { withFileTypes: true }))
  .map(d => d.name)
  .filter(n => n !== 'dist' && !SHIP.includes(n));
console.log('\ndeliberately NOT published: ' + excluded.join(', '));
