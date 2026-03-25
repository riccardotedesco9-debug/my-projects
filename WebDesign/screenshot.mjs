import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SCREENSHOTS_DIR = join(process.cwd(), 'temporary-screenshots');
const CHROME_DEVTOOLS_SCREENSHOT = join(homedir(), '.claude', 'skills', 'chrome-devtools', 'scripts', 'screenshot.js');

const url = process.argv[2];
const label = process.argv[3] || '';

if (!url) {
  console.error('Usage: node screenshot.mjs <url> [label]');
  process.exit(1);
}

if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Find next increment number
const existing = readdirSync(SCREENSHOTS_DIR).filter(f => f.startsWith('screenshot-'));
const numbers = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0', 10));
const next = (numbers.length ? Math.max(...numbers) : 0) + 1;

const filename = label ? `screenshot-${next}-${label}.png` : `screenshot-${next}.png`;
const outputPath = join(SCREENSHOTS_DIR, filename);

try {
  execSync(`node "${CHROME_DEVTOOLS_SCREENSHOT}" "${url}" --output "${outputPath}" --full-page`, {
    stdio: 'inherit',
  });
  console.log(`Screenshot saved: ${outputPath}`);
} catch (err) {
  console.error('Screenshot failed:', err.message);
  process.exit(1);
}
