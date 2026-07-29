/* Builds portrait-compare.html: the About section rendered twice, once with the
   framed studio photograph and once with the background removed, so the two can
   be judged against the real page rather than in isolation.

   Both images are inlined as data URIs so the file opens straight from disk.
   Run: node build-portrait-compare.mjs
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = readFileSync(resolve(here, 'index.html'), 'utf8');

/* Both variants are read from assets/, NOT from whichever one happens to be
   live in index.html — pulling B out of the site config meant that the moment
   the site was reverted to the framed photo this page built framed vs framed. */
const uri = f => 'data:image/webp;base64,' +
  readFileSync(resolve(here, 'assets/portrait', f)).toString('base64');

/* the toned copy, not the straight scan: the raw backdrop blows out behind the
   head. portrait-framed-web.webp stays untouched as the source tone-backdrop.py
   reads, so re-running it never compounds the grade. */
const framed = uri('portrait-framed-toned.webp');

/* The silhouette is feathered in the ALPHA CHANNEL, not with a CSS gradient. A
   gradient draws a straight line across the picture; feathering alpha follows
   the outline, so the shoulder dissolves along its own shape instead of being
   sliced. Built by eroding then blurring alpha at 3x and scaling back — doing it
   at 1:1 left visible stair-steps in the ramp. The erode first also trims the
   pale fringe the cream backdrop left on the cut edge. */
const EDGES = [
  { key: 'hard',  file: 'portrait-cutout-web.webp',   label: 'No fade', ramp: '6px'  },
  { key: 'soft1', file: 'portrait-cutout-soft1.webp', label: 'Gentle',  ramp: '20px' },
  { key: 'soft2', file: 'portrait-cutout-soft2.webp', label: 'Soft',    ramp: '37px' },
  { key: 'soft3', file: 'portrait-cutout-soft3.webp', label: 'Softest', ramp: '53px' }
].map(e => ({ ...e, uri: uri(e.file) }));

const DEFAULT_EDGE = 'soft2';
const cutout = EDGES.find(e => e.key === DEFAULT_EDGE).uri;

/* reuse the real tokens and About styles so nothing is judged against a
   different background or typeface than the page actually uses */
const tokens = site.match(/:root\{[\s\S]*?\}/)?.[0] ?? '';

const COPY = `
  <p class="about-lead">One person, start to finish.</p>
  <p>A product for a shop listing, an apartment, a restaurant, a villa, a venue.
     The job underneath is always the same. The picture has to make someone stop
     scrolling. That is the whole of it, and I do all of it myself. Same hands
     from the first message to the final file.</p>
  <p>I run a business of my own in Mellie&#295;a, so I have been on the other side
     of this: needing pictures that had to sell something. StageCraft is local,
     quick to reach, and priced in the open, so good images are not something you
     weigh up before asking.</p>
  <dl class="about-facts">
    <div><dt>Based in</dt><dd>Mellie&#295;a, covering Malta &amp; Gozo</dd></div>
    <div><dt>Delivery</dt><dd>48 hours as standard, not as a paid upgrade</dd></div>
    <div><dt>Pricing</dt><dd>Published in full on this page</dd></div>
    <div><dt>Languages</dt><dd>English &amp; Maltese</dd></div>
  </dl>`;

const block = (id, cls, src, label, note) => `
<section class="demo" id="${id}">
  <div class="tag"><b>${label}</b>${note}</div>
  <div class="section-head">
    <div class="section-eyebrow">About</div>
    <h2 class="section-title">Who you&rsquo;re <em>working with.</em></h2>
  </div>
  <div class="about-grid">
    <div class="about-portrait ${cls}"><img src="${src}" alt=""></div>
    <div class="about-text">${COPY}</div>
  </div>
</section>`;

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Portrait comparison — framed vs cut-out</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
${tokens}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-weight:300;-webkit-font-smoothing:antialiased}

.bar{position:sticky;top:0;z-index:10;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;
  padding:.85rem 1.5rem;background:rgba(9,9,11,.94);border-bottom:1px solid var(--border);backdrop-filter:blur(8px)}
.bar h1{font-family:var(--serif);font-size:1rem;font-weight:400;margin-right:auto;letter-spacing:.02em}
.bar button{font-family:var(--sans);font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;
  padding:.5rem .9rem;border:1px solid var(--border-mid);background:transparent;color:var(--text-muted);
  border-radius:2px;cursor:pointer;transition:all .2s}
.bar button:hover{border-color:var(--gold);color:var(--gold-light)}
.bar button.on{background:var(--gold);border-color:var(--gold);color:#12100b}
.bar button i{font-style:normal;opacity:.55;margin-left:.35rem}
.bar2{top:53px;background:rgba(9,9,11,.9)}
.bar2 h1{font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;font-family:var(--sans);color:var(--text-muted)}
body.solo-a .bar2{opacity:.35;pointer-events:none}   /* nothing to change on A */

.demo{padding:4.5rem 2rem 5rem;border-bottom:1px solid var(--border);position:relative}
.tag{position:absolute;top:1rem;left:1.5rem;font-size:.6rem;letter-spacing:.16em;text-transform:uppercase;color:var(--text-muted)}
.tag b{color:var(--gold-light);font-weight:500;margin-right:.6rem}
.section-head{text-align:center;margin-bottom:3rem}
.section-eyebrow{font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);margin-bottom:.8rem}
.section-title{font-family:var(--serif);font-size:clamp(1.9rem,3.6vw,2.9rem);font-weight:300}
.section-title em{font-style:italic;color:var(--gold-light)}

/* ---- the two treatments, exactly as each would ship ---- */
.about-grid{display:grid;grid-template-columns:380px minmax(0,1fr);gap:3rem;align-items:start;max-width:1040px;margin:0 auto}
.about-portrait{position:relative;align-self:start}
.about-portrait img{position:absolute;inset:0;width:100%;height:100%;display:block}

/* A — framed: the photograph keeps its own 4:5 and sits in a card */
.about-portrait.framed{aspect-ratio:4/5;border:1px solid var(--border);border-radius:3px;
  overflow:hidden;box-shadow:var(--lit),var(--lift);background:linear-gradient(160deg,#232329,#141418 65%)}
.about-portrait.framed img{object-fit:cover}

/* B — cut-out: no frame at all, subject straight on the page, bottom feathered */
.about-portrait.cutout{aspect-ratio:700/976;display:flex;align-items:center;justify-content:center}
.about-portrait.cutout img{object-fit:contain;
  -webkit-mask-image:linear-gradient(180deg,#000 58%,rgba(0,0,0,.55) 80%,rgba(0,0,0,.12) 94%,transparent 100%);
  mask-image:linear-gradient(180deg,#000 58%,rgba(0,0,0,.55) 80%,rgba(0,0,0,.12) 94%,transparent 100%)}

.about-text p{font-size:.92rem;line-height:1.85;color:var(--text-muted);margin-bottom:1.1rem}
.about-text p.about-lead{font-family:var(--serif);font-size:1.5rem;font-weight:300;color:var(--text);line-height:1.4;margin-bottom:1.3rem}
.about-facts{margin-top:1.8rem;display:grid;gap:.9rem}
.about-facts div{display:grid;grid-template-columns:110px 1fr;gap:1rem;padding-bottom:.9rem;border-bottom:1px solid var(--border)}
.about-facts dt{font-size:.6rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}
.about-facts dd{font-size:.85rem;color:var(--text-muted)}

/* side by side, portraits only */
.pair{display:grid;grid-template-columns:1fr 1fr;gap:4rem;max-width:900px;margin:0 auto}
.pair figure{margin:0}
.pair figcaption{margin-top:1rem;text-align:center;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--text-muted)}

body.solo-a #demo-b, body.solo-b #demo-a{display:none}
body.solo-a #pair, body.solo-b #pair{display:none}
body.only-pair #demo-a, body.only-pair #demo-b{display:none}

@media(max-width:820px){
  .about-grid{grid-template-columns:1fr;gap:2rem}
  .about-portrait{width:min(320px,80vw);margin:0 auto}
  .pair{grid-template-columns:1fr;gap:2.5rem}
}
</style>
</head><body>

<div class="bar">
  <h1>Portrait &mdash; framed vs cut-out</h1>
  <button data-mode="both" class="on">Both</button>
  <button data-mode="solo-a">A only</button>
  <button data-mode="solo-b">B only</button>
  <button data-mode="only-pair">Side by side</button>
</div>
<div class="bar bar2">
  <h1>Cut-out edge fade</h1>
  ${EDGES.map(e => `<button data-edge="${e.key}"${e.key === DEFAULT_EDGE ? ' class="on"' : ''}>${e.label} <i>${e.ramp}</i></button>`).join('\n  ')}
</div>

${block('demo-a', 'framed', framed, 'A', 'original photograph, framed card')}
${block('demo-b', 'cutout', cutout, 'B', 'background removed, no frame')}

<section class="demo" id="pair">
  <div class="tag"><b>A / B</b>same width, same page</div>
  <div class="pair">
    <figure><div class="about-portrait framed"><img src="${framed}" alt=""></div>
      <figcaption>A &mdash; framed</figcaption></figure>
    <figure><div class="about-portrait cutout"><img src="${cutout}" alt=""></div>
      <figcaption>B &mdash; cut-out</figcaption></figure>
  </div>
</section>

<script>
var EDGE_URIS = ${JSON.stringify(Object.fromEntries(EDGES.map(e => [e.key, e.uri])))};
var mode = 'both';

document.querySelectorAll('.bar:not(.bar2) button').forEach(function(b){
  b.addEventListener('click', function(){
    document.querySelectorAll('.bar:not(.bar2) button').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    mode = b.dataset.mode;
    document.body.className = mode === 'both' ? '' : mode;
    window.scrollTo({top: 0, behavior: 'smooth'});
  });
});

/* swap every cut-out image at once so both the in-context block and the
   side-by-side pair stay on the same edge treatment */
document.querySelectorAll('.bar2 button').forEach(function(b){
  b.addEventListener('click', function(){
    document.querySelectorAll('.bar2 button').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    var src = EDGE_URIS[b.dataset.edge];
    document.querySelectorAll('.about-portrait.cutout img').forEach(function(img){ img.src = src; });
  });
});
</script>
</body></html>`;

writeFileSync(resolve(here, 'portrait-compare.html'), html);
console.log('Wrote portrait-compare.html (' + Math.round(html.length / 1024) + ' KB)');
console.log('  A framed : ' + Math.round(framed.length / 1024) + ' KB data URI');
console.log('  B cutout : ' + Math.round(cutout.length / 1024) + ' KB data URI');
