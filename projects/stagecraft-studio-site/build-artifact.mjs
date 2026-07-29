/**
 * Produces the Claude-artifact version of the site from index.html.
 *
 * index.html is a complete HTML document, which is what a real site needs.
 * The Artifact publisher supplies its own <!doctype>/<head>/<body> wrapper and
 * expects page content only, so this strips the outer document tags and keeps
 * everything between them — <style>, the sections, and the <script>.
 *
 * Rather than maintain a second copy of the markup by hand, regenerate:
 *   node build-artifact.mjs
 *
 * Note: the artifact CSP blocks font CDNs, so the Google Fonts <link> is
 * dropped here. The stylesheet's fallbacks (Georgia / system-ui) carry the
 * serif-and-sans pairing on the artifact; hosted normally, the real fonts load.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, 'index.html'), 'utf8');

const head = source.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1];
const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
if (!head || !body) throw new Error('Could not find <head> and <body> in index.html');

const style = head.match(/<style[\s\S]*?<\/style>/i)?.[0];
if (!style) throw new Error('Could not find the <style> block in <head>');

const title = head.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim() ?? 'StageCraft';

/* The artifact host writes its own <html>, so the document language declared on
   index.html's tag is dropped on the way through and the published page has none
   for screen readers or hyphenation. Carrying it on a wrapper element sets it for
   the whole subtree instead. Safe: no CSS selector targets a direct child of
   body — everything is descendant-matched. */
const lang = source.match(/<html[^>]*\blang=["']([^"']+)["']/i)?.[1] ?? 'en';

const out = `<title>${title}</title>\n${style}\n<div lang="${lang}">\n${body.trim()}\n</div>\n`;
const target = join(here, 'artifact-source.html');
await writeFile(target, out, 'utf8');

console.log(`Wrote ${target} (${Math.round(out.length / 1024)} KB)`);
