// Shared logic for the dynamic domain briefing, used by two hook entry points:
//   - brief-domain.mjs   (SessionStart — triggers off cwd when a project folder is open)
//   - brief-on-file.mjs  (PostToolUse — triggers off which project's files Claude touches,
//                          the real "active project" signal when working from the repo root)
//
// A project can belong to MULTIPLE domains and they evolve over time. The `Domain:` line is
// authoritative and may list several (e.g. `Domain: WebDesign, Marketing`). Absent a line,
// a single best-guess domain is inferred from contents (labelled "inferred"). The brief
// pulls LIVE "Mandatory Gates" + "Your Agents" from each domain's agents/<Domain>/CLAUDE.md,
// merging gates (deduped) and listing agents per domain — so editing a workspace doc, or
// adding/removing a domain on the line, re-briefs automatically with no per-project wiring.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DOMAINS = ['Engineering', 'Marketing', 'WebDesign', 'WebScraper'];

// The ONE enforced gate, shared by every domain's brief. Its BEHAVIOR is defined by
// tools/gate-deploy.mjs (the PreToolUse hook); this string is only the line shown in the brief.
// Single source — edit here, nowhere else. Domain briefing.md / CLAUDE.md files carry only their
// own CONVENTION gates; buildBrief() prepends this so the enforced gate appears exactly once in
// every brief and can never drift between domains.
export const ENFORCED_GATE =
  '- [ENFORCED] **`code-reviewer` before any deploy / `git push`** — hard-blocked by a PreToolUse ' +
  'hook (`tools/gate-deploy.mjs`). Covers `git push` and every deploy (Bash ' +
  '`wrangler/vercel/netlify/shopify/oxygen/trigger`, `npm run deploy`, and `mcp__*deploy*` tools ' +
  'incl. `mcp__trigger__deploy`). Clear it: commit → run code-reviewer (or `/code-review`) with no ' +
  'must-fix findings → `node tools/mark-reviewed.mjs` from the workspace root → then push/deploy. A ' +
  'new commit (push) or any later edit (deploy) re-arms it.';

// Pull a markdown section (heading + body), from "## <heading>" to the next "## " (or EOF).
export function section(md, heading) {
  const re = new RegExp(`^##\\s+${heading}.*$`, 'im');
  const m = re.exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  return (m[0] + body).trim();
}

// Body only (drop the leading "## ..." heading line).
function sectionBody(md, heading) {
  const s = section(md, heading);
  return s ? s.replace(/^##[^\n]*\n?/, '').trim() : '';
}

// Push bullet lines from a section into `out`, deduped across domains by the first
// `backticked` or **bold** token (so a skill/tool shared by two domains shows once).
function collectDeduped(sectionText, out, seen) {
  for (const line of sectionText.split('\n')) {
    if (!/^\s*[-*]/.test(line)) continue; // bullet lines only
    const tok = line.match(/`([^`]+)`/) || line.match(/\*\*([^*]+)\*\*/);
    const key = (tok ? tok[1] : line.replace(/[`*_>\s-]/g, '').slice(0, 40)).toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(line.trim());
    }
  }
}

// Best-effort domain guess from a project's contents, used only when no explicit `Domain:` line
// exists. ADDITIVE by design: signals are UNIONed, never early-returned, because a project is
// routinely more than one domain (the philosophy — never lock a project to a single tool). A
// Shopify storefront is WebDesign + Engineering; a marketing folder with a landing page is
// Marketing + WebDesign; an interactive HTML toy is WebDesign + Engineering. The explicit
// `Domain:` line is authoritative and overrides this guess (see resolveDomains). Returns a stable,
// DOMAINS-ordered array (possibly empty → caller stays silent).
export function inferDomains(dir) {
  let names;
  try {
    names = readdirSync(dir).map((n) => n.toLowerCase());
  } catch {
    return [];
  }
  const has = (re) => names.some((n) => re.test(n));

  let pkg = '';
  try {
    const p = join(dir, 'package.json');
    if (existsSync(p)) pkg = readFileSync(p, 'utf8').toLowerCase();
  } catch {}
  const blob = names.join(' ') + ' ' + pkg;

  // Read any HTML files once — used for the web-page signal and the interactivity signal.
  let htmlBlob = '';
  for (const n of names) {
    if (n.endsWith('.html')) {
      try {
        htmlBlob += readFileSync(join(dir, n), 'utf8').toLowerCase();
      } catch {}
    }
  }

  const codey =
    has(/^(package\.json|src|tsconfig\.json)$/) ||
    has(/\.(mjs|ts|tsx)$/) ||
    /"react"|typescript|vite|"node"|wrangler|trigger\.dev/.test(pkg);

  // Real front-end signals → also warrant WebDesign's design convention.
  const webFrontend =
    /react|vue|svelte|astro|next|nuxt|gatsby|remix|vite|tailwind|@shopify\/hydrogen/.test(pkg) ||
    has(/\.(jsx|tsx|vue|svelte|astro)$/) ||
    has(/^(public|index\.html)$/);

  const interactive = /<canvas|requestanimationframe|webgl|three|websocket|new audio/.test(htmlBlob);

  // Union every matching signal — domains accumulate, they don't compete.
  const out = new Set();
  if (/firecrawl|scrape|crawl/.test(blob)) out.add('WebScraper');
  if (/hydrogen|shopify|builder\.io|storefront|oxygen/.test(blob)) {
    out.add('WebDesign'); // storefront UI…
    out.add('Engineering'); // …and it's a real code build (headless owns the front-end code)
  }
  // Word-boundaried so bare `ad`/`ads` and `seo`/`email` substrings inside common words
  // (readme, header, upload, thread, shadow…) don't spuriously flag Marketing on codey projects.
  if (/\b(campaign|persona|funnel|seo|copywrit|brand|ads?|email)\b/.test(blob)) out.add('Marketing');
  if (codey) {
    out.add('Engineering');
    if (webFrontend) out.add('WebDesign');
  }
  // Any HTML page → WebDesign (so the frontend-design convention surfaces); interactivity
  // (canvas/anim/webgl/websocket/audio) adds Engineering for the logic side. Never let UI/HTML
  // work miss WebDesign — that under-briefing was the bug a vanilla-HTML toy hit.
  if (htmlBlob || webFrontend) {
    out.add('WebDesign');
    if (interactive) out.add('Engineering');
  }

  return DOMAINS.filter((d) => out.has(d));
}

// Resolve a project's domains. Explicit `Domain:` line wins and may list MULTIPLE
// (scanned from the declaration part, before the "—"/"(" explanatory tail). Else inferred
// (possibly several). Returns { domains: string[], inferred: boolean }.
export function resolveDomains(projectDir) {
  const projectClaude = join(projectDir, 'CLAUDE.md');
  if (existsSync(projectClaude)) {
    const pmd = readFileSync(projectClaude, 'utf8');
    const lineM = /^[>\s*-]*Domain\b[:\s*]*([^\n]*)/im.exec(pmd);
    if (lineM) {
      // Only the declaration head (before em-dash or paren), so the "uses global + X
      // skills" explanatory tail can't inject a false domain.
      const head = lineM[1].split(/[—(]/)[0];
      const found = DOMAINS.filter((d) => new RegExp(`\\b${d}\\b`, 'i').test(head));
      if (found.length) return { domains: found, inferred: false };
    }
  }
  const guess = inferDomains(projectDir);
  return { domains: guess, inferred: guess.length > 0 };
}

// Resolve the doc a domain's brief is pulled from. Prefer a dedicated, non-package-managed
// `agents/<domain>/briefing.md` (so a ClaudeKit reset of a managed CLAUDE.md can't blank the brief);
// fall back to the workspace `CLAUDE.md`. Returns { path, rel } or null if neither exists.
function domainDoc(root, domain) {
  const briefing = join(root, 'agents', domain, 'briefing.md');
  if (existsSync(briefing)) return { path: briefing, rel: `agents/${domain}/briefing.md` };
  const claude = join(root, 'agents', domain, 'CLAUDE.md');
  if (existsSync(claude)) return { path: claude, rel: `agents/${domain}/CLAUDE.md` };
  return null;
}

// Build the briefing for one or more domains: merge their Mandatory Gates (deduped by the
// gist of each bullet) and list each domain's agents. Returns '' if no workspace docs found.
export function buildBrief(root, domains, projectName, inferred) {
  // Start with the single shared enforced gate; seed the dedupe set with its token so any leftover
  // enforced copy still sitting in a domain doc collapses into this one bullet.
  const gateBullets = [ENFORCED_GATE];
  const seenGate = new Set();
  const enforcedTok = ENFORCED_GATE.match(/`([^`]+)`/);
  if (enforcedTok) seenGate.add(enforcedTok[1].toLowerCase());
  const agentBlocks = [];
  const skillBullets = [];
  const seenSkill = new Set();
  const mcpItems = [];
  const seenMcp = new Set();
  const links = [];

  for (const domain of domains) {
    const doc = domainDoc(root, domain);
    if (!doc) continue;
    const wmd = readFileSync(doc.path, 'utf8');
    links.push(`[${domain}](${doc.rel})`);

    const gates = sectionBody(wmd, 'Mandatory Gates');
    for (const line of gates.split('\n')) {
      if (!/^\s*[-*]/.test(line)) continue; // bullet lines only
      // Dedupe by the gate's leading skill token (first `backticked` id), so the same
      // gate worded differently across domains collapses to one bullet. Fallback: gist.
      const tok = line.match(/`([^`]+)`/);
      const key = (tok ? tok[1] : line.replace(/[`*_>\s-]/g, '').slice(0, 40)).toLowerCase();
      if (key && !seenGate.has(key)) {
        seenGate.add(key);
        gateBullets.push(line.trim());
      }
    }

    const agents = sectionBody(wmd, 'Your Agents');
    if (agents) agentBlocks.push(`**${domain}:** ${agents.replace(/\n+/g, ' ').trim()}`);

    // Curated skills/MCP to reach for — the focusing layer so Claude needn't scan the whole
    // catalog (the user's explicit intent). Deduped across domains.
    collectDeduped(sectionBody(wmd, 'Recommended Skills'), skillBullets, seenSkill);
    collectDeduped(sectionBody(wmd, 'MCP Tools'), mcpItems, seenMcp);
  }

  if (!links.length) return '';

  const label = domains.length > 1 ? `Domains: ${domains.join(' + ')}` : `Domain: ${domains[0]}`;
  const note = inferred ? ` — inferred, add \`Domain: ${domains.join(', ')}\` to ${projectName}/CLAUDE.md to lock it` : '';

  let brief = `## Domain briefing — ${projectName} (${label}${note})\n\n`;
  brief += `> **Use the real tools — don't hand-roll what a managed tool already does.**\n`;
  brief += `> **If you skip a clearly-fitting recommended tool / skill / agent, say why in one line — don't default silently.**\n\n`;
  brief += `Consult this toolkit before choosing an approach — first prompt or a new path later; reach for them, then decide. ${links.join(' · ')}:\n`;
  if (gateBullets.length) brief += `\n### Mandatory gates\n${gateBullets.join('\n')}\n`;
  if (skillBullets.length) brief += `\n### Skills to reach for\n${skillBullets.join('\n')}\n`;
  if (mcpItems.length) brief += `\n### MCP tools for this work\n${mcpItems.join('\n')}\n`;
  if (agentBlocks.length) brief += `\n### Agents to spawn when relevant\n${agentBlocks.join('\n')}\n`;

  // Surface the project's OWN CLAUDE.md (stack, brand, compliance) — the brief only knows the domain,
  // not the project specifics, so point Claude at the file and let it decide whether to read it.
  const projClaude = join(root, 'projects', projectName, 'CLAUDE.md');
  if (existsSync(projClaude)) {
    brief += `\n→ This project's stack & conventions: read \`projects/${projectName}/CLAUDE.md\`.\n`;
  }
  return brief.trim();
}

// ---- Session+project dedup, shared by all three briefing entry points ----
// A project is briefed at most ONCE per session; whichever hook fires first (prompt > session-start >
// file-touch) wins, the rest stay silent. A separate per-session marker tracks the generic
// orientation nudge so it shows once, not on every prompt. Markers live in <root>/.claude/.tmp.

function tmpDir(root) {
  return join(root, '.claude', '.tmp');
}
function safe(s) {
  return String(s || 'nosession').replace(/[^\w.-]/g, '_');
}

export function alreadyBriefed(root, sessionId, projectName) {
  return existsSync(join(tmpDir(root), `briefed-${safe(sessionId)}-${safe(projectName)}.flag`));
}
export function markBriefed(root, sessionId, projectName, domains) {
  const dir = tmpDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `briefed-${safe(sessionId)}-${safe(projectName)}.flag`),
    `${new Date().toISOString()} ${(domains || []).join(',')}\n`,
    'utf8',
  );
}
export function alreadyNudged(root, sessionId) {
  return existsSync(join(tmpDir(root), `oriented-${safe(sessionId)}.flag`));
}
export function markNudged(root, sessionId) {
  const dir = tmpDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `oriented-${safe(sessionId)}.flag`), `${new Date().toISOString()}\n`, 'utf8');
}

// Project name if a path/cwd sits inside projects/<name>/...  Else ''.
export function projectFromPath(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/);
  const i = parts.lastIndexOf('projects');
  return i !== -1 && i + 1 < parts.length ? parts[i + 1] : '';
}

// Best-effort: does the prompt reference an EXISTING project under projects/? A `projects/<name>`
// path wins; else a bare folder name matched as a whole word (longest first, so a longer slug beats
// an overlapping shorter one). Conservative by design — returns '' when unsure, so the caller falls
// back to the generic nudge rather than briefing the wrong project.
export function findProjectInPrompt(root, prompt) {
  if (!prompt) return '';
  const text = String(prompt);
  const pathM = /projects[\\/]+([\w.-]+)/i.exec(text);
  if (pathM) return pathM[1];
  let dirs;
  try {
    dirs = readdirSync(join(root, 'projects'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return '';
  }
  for (const name of dirs.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) return name;
  }
  return '';
}

// Short orientation injected BEFORE the first action when no project is resolvable (cold/new work).
// Points at the FULL toolkit (skills + subagents + MCP + gates), not skills alone — the brief is
// toolkit-wide, and that completeness is the whole point.
export function genericNudge() {
  return [
    '## Orientation — My Projects workspace',
    '',
    "Anything you'll keep — a site, app, game, campaign, scraper, automation, or a one-off toy/showcase —",
    'is a **project**: build it in `projects/<name>/` with a `Domain:` line, so the full domain toolkit',
    '(**skills, subagents, MCP tools, gates**) briefs you *before* you build. `plans/visuals/` is only for',
    'throwaway preview/diagram outputs — never a standalone build.',
    '',
    "Not sure of the domain yet? It's one of Engineering / Marketing / WebDesign / WebScraper; the root",
    '`CLAUDE.md` holds the structure + cross-cutting rules (1Password secrets, tools-first, creative-router).',
  ].join('\n');
}

// Resolve workspace root (git toplevel) from a starting dir. Null on failure.
export function gitRoot(fromDir) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: fromDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}
