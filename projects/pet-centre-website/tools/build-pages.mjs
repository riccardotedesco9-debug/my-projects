#!/usr/bin/env node
/**
 * Author the Pet Centre marketing pages in Builder.io via the Write API.
 * Each page is one "Custom Code" block of premium, brand-styled HTML (fonts +
 * tokens match the storefront; hero images served from /heroes/). Create-or-update
 * by urlPath (idempotent). Private bpk- key read from 1Password.
 *
 * Run: node build-pages.mjs
 */
import {execSync} from 'node:child_process';

const PUBLIC = '6dc7b5fe062641aba00bcbdab6b2917f';
const PRIVATE = execSync('op read "op://AI-Stack/qcmb3oltovklvjnkj4m2ltuuzi/password"', {
  encoding: 'utf8',
}).trim();

// ---- shared styles (scoped under .pc) ------------------------------------
const S = `<style>
.pc{font-family:'Montserrat',sans-serif;color:#23315a;line-height:1.7;background:#fbf8f2}
.pc *{box-sizing:border-box}
.pc h1,.pc h2,.pc h3{font-family:'Fredoka',sans-serif;color:#243673;line-height:1.12;letter-spacing:-.01em;margin:0}
.pc-wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.pc-eyebrow{display:inline-block;font-weight:700;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:#00975a;margin-bottom:14px}
.pc-lead{font-size:1.12rem;color:#51607a;max-width:62ch}
.pc-btn{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;font-size:.98rem;padding:14px 28px;border-radius:999px;background:#00975a;color:#fff;text-decoration:none;box-shadow:0 10px 24px rgba(0,151,90,.25);transition:transform .2s,box-shadow .2s}
.pc-btn:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(0,151,90,.32);color:#fff}
.pc-btn-gold{background:#e0b136;color:#243673;box-shadow:0 10px 24px rgba(224,177,54,.3)}
.pc-btn-gold:hover{color:#243673}
.pc-btn-ghost{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.65);box-shadow:none}
.pc-btn-ghost:hover{background:rgba(255,255,255,.12);color:#fff}
.pc-section{padding:74px 0}
.pc-section h2{font-size:clamp(1.65rem,1.2rem+1.6vw,2.3rem)}
.pc-sub{color:#51607a;max-width:62ch;margin:12px 0 0}
.pc-center{text-align:center}
.pc-center .pc-sub{margin-left:auto;margin-right:auto}
.pc-hero{position:relative;min-height:560px;display:flex;align-items:center;color:#fff;overflow:hidden}
.pc-hero-bg{position:absolute;inset:0;background-size:cover;background-position:center}
.pc-hero-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,rgba(20,28,56,.74),rgba(20,28,56,.12) 66%)}
.pc-hero .pc-wrap{position:relative;z-index:1;padding:56px 24px}
.pc-hero h1{color:#fff;font-size:clamp(2.2rem,1.4rem+3vw,3.6rem);max-width:17ch}
.pc-hero .pc-eyebrow{color:#ffd97a}
.pc-hero .pc-lead{color:rgba(255,255,255,.93)}
.pc-hero-cta{display:flex;flex-wrap:wrap;gap:14px;margin-top:28px}
.pc-trust{background:#fff;border-top:1px solid #ece4d6;border-bottom:1px solid #ece4d6}
.pc-trust .pc-wrap{display:flex;flex-wrap:wrap;gap:18px 40px;justify-content:center;padding:22px 24px}
.pc-trust span{display:inline-flex;align-items:center;gap:10px;font-weight:600;color:#243673;font-size:.95rem}
.pc-trust .ic{font-size:1.25rem}
.pc-cats{display:grid;gap:20px;grid-template-columns:repeat(2,1fr);margin-top:34px}
@media(min-width:760px){.pc-cats{grid-template-columns:repeat(3,1fr)}}
.pc-cat{position:relative;display:block;border-radius:18px;overflow:hidden;min-height:210px;text-decoration:none;box-shadow:0 8px 24px rgba(36,54,115,.1)}
.pc-cat img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .6s cubic-bezier(.2,.7,.2,1)}
.pc-cat:hover img{transform:scale(1.07)}
.pc-cat::after{content:'';position:absolute;inset:0;background:linear-gradient(to top,rgba(18,26,52,.72),transparent 62%)}
.pc-cat b{position:absolute;left:18px;bottom:16px;z-index:1;color:#fff;font-family:'Fredoka';font-size:1.35rem;font-weight:600}
.pc-3{display:grid;gap:22px;grid-template-columns:1fr;margin-top:34px}
@media(min-width:760px){.pc-3{grid-template-columns:repeat(3,1fr)}}
.pc-card{background:#fff;border:1px solid #ece4d6;border-radius:18px;padding:30px;box-shadow:0 8px 24px rgba(36,54,115,.06)}
.pc-card .ic{font-size:2rem}
.pc-card h3{margin:14px 0 10px;font-size:1.3rem}
.pc-card p{color:#51607a;margin:0 0 14px}
.pc-card a{color:#00975a;font-weight:700;text-decoration:none}
.pc-split{display:grid;gap:44px;align-items:center;grid-template-columns:1fr}
@media(min-width:860px){.pc-split{grid-template-columns:1.05fr 1fr}}
.pc-split img{width:100%;border-radius:20px;box-shadow:0 16px 40px rgba(36,54,115,.13)}
.pc-quotes{display:grid;gap:22px;grid-template-columns:1fr;margin-top:34px}
@media(min-width:760px){.pc-quotes{grid-template-columns:repeat(3,1fr)}}
.pc-quote{background:#fff;border:1px solid #ece4d6;border-radius:18px;padding:28px}
.pc-quote p{font-size:1.02rem;color:#243673;margin:0 0 16px}
.pc-quote .who{font-weight:700;color:#00975a;font-size:.9rem}
.pc-stars{color:#e0b136;font-size:1rem;letter-spacing:2px;margin-bottom:10px}
.pc-band{background:linear-gradient(120deg,#00975a,#243673);color:#fff;border-radius:24px;padding:54px 40px;text-align:center}
.pc-band h2{color:#fff;font-size:clamp(1.7rem,1.2rem+1.8vw,2.4rem);margin-bottom:12px}
.pc-band p{color:rgba(255,255,255,.92);max-width:50ch;margin:0 auto 24px}
.pc-list{margin:16px 0 0;padding:0;list-style:none}
.pc-list li{padding-left:30px;position:relative;margin:0 0 12px;color:#51607a}
.pc-list li::before{content:'✓';position:absolute;left:0;top:0;color:#fff;background:#00975a;width:20px;height:20px;border-radius:50%;font-size:.72rem;font-weight:800;display:flex;align-items:center;justify-content:center}
.pc-tiers{display:grid;gap:20px;grid-template-columns:1fr;margin-top:34px}
@media(min-width:760px){.pc-tiers{grid-template-columns:repeat(3,1fr)}}
.pc-tier{background:#fff;border:1px solid #ece4d6;border-radius:18px;padding:28px;text-align:center}
.pc-tier .step{width:40px;height:40px;border-radius:50%;background:#e7f4ed;color:#00975a;font-family:'Fredoka';font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.pc-info{display:grid;gap:20px;grid-template-columns:1fr;margin-top:34px}
@media(min-width:760px){.pc-info{grid-template-columns:repeat(3,1fr)}}
</style>`;

const hero = (img, eyebrow, h1, lead, ctas) => `<section class="pc-hero"><div class="pc-hero-bg" style="background-image:url('${img}')"></div><div class="pc-wrap"><span class="pc-eyebrow">${eyebrow}</span><h1>${h1}</h1><p class="pc-lead">${lead}</p><div class="pc-hero-cta">${ctas}</div></div></section>`;

const CATS = [
  ['Dogs', '/collections/dogs', '/heroes/dogs.jpg'],
  ['Cats', '/collections/cats', '/heroes/cats.jpg'],
  ['Fish & Aquatics', '/collections/fish-aquatics', '/heroes/fish.jpg'],
  ['Birds', '/collections/birds', '/heroes/birds.jpg'],
  ['Reptiles', '/collections/reptiles', '/heroes/reptiles.jpg'],
  ['Small Animals', '/collections/small-animals', '/heroes/small-animals.jpg'],
];
const catTiles = CATS.map(([t, h, i]) => `<a class="pc-cat" href="${h}"><img src="${i}" alt="${t}"/><b>${t}</b></a>`).join('');

const quote = (stars, text, who) => `<div class="pc-quote"><div class="pc-stars">${'★'.repeat(stars)}</div><p>"${text}"</p><div class="who">${who}</div></div>`;

// ---- pages ----------------------------------------------------------------
const HOME = `<div class="pc">${S}
${hero('/heroes/homepage.jpg', 'Mellieħa · Malta', 'Your neighbourhood pet shop &amp; vet', 'Premium food, honest face-to-face advice, grooming and in-house veterinary care — all under one roof, with same-day local delivery across the north.', `<a class="pc-btn" href="/collections">Shop online</a><a class="pc-btn pc-btn-ghost" href="/book">Book vet &amp; grooming</a>`)}
<section class="pc-trust"><div class="pc-wrap"><span><span class="ic">🩺</span> Vet + shop under one roof</span><span><span class="ic">🛵</span> Same-day local delivery</span><span><span class="ic">🎁</span> Pet Club rewards</span><span><span class="ic">🏷️</span> 26+ trusted brands</span></div></section>
<section class="pc-section"><div class="pc-wrap pc-center"><span class="pc-eyebrow">Shop by animal</span><h2>Everything your pet needs</h2><p class="pc-sub">Six aisles of carefully-chosen food, treats, toys and care — for the whole family of pets.</p><div class="pc-cats">${catTiles}</div></div></section>
<section class="pc-section" style="background:#fff"><div class="pc-wrap pc-center"><span class="pc-eyebrow">More than a shop</span><h2>Care, not just the catalogue</h2><div class="pc-3"><div class="pc-card"><div class="ic">🩺</div><h3>Vet care</h3><p>A vet you can walk to — check-ups, vaccinations, microchipping and friendly advice for new and growing pets.</p><a href="/vet-grooming">Vet services →</a></div><div class="pc-card"><div class="ic">✂️</div><h3>Grooming</h3><p>Wash, trim and full grooms by appointment. Your pet leaves clean, comfy and happy.</p><a href="/book">Book grooming →</a></div><div class="pc-card"><div class="ic">🎁</div><h3>Pet Club</h3><p>Earn points on every visit, get member-only offers, and a free new-pet starter pack.</p><a href="/pet-club">Join free →</a></div></div></div></section>
<section class="pc-section"><div class="pc-wrap"><div class="pc-split"><img src="/heroes/cats.jpg" alt="Pet Centre Mellieħa"/><div><span class="pc-eyebrow">Why Pet Centre</span><h2>Your local pet experts in Mellieħa</h2><p class="pc-sub">We're a family-run shop that genuinely knows pets. Pop in for a chat, get matched to the right food, pick up a click-&amp;-collect order, or have your pet seen by our in-house vet — all in one friendly visit.</p><ul class="pc-list"><li>Honest, face-to-face advice from people who care</li><li>Premium brands at fair local prices</li><li>Same-day delivery &amp; in-store collection</li></ul><div style="margin-top:24px"><a class="pc-btn" href="/about">Our story</a></div></div></div></div></section>
<section class="pc-section" style="background:#fff"><div class="pc-wrap pc-center"><span class="pc-eyebrow">Loved locally</span><h2>What Mellieħa says</h2><div class="pc-quotes">${quote(5, 'The team actually know their stuff — they matched our rescue pup to the perfect food and the vet visit was so easy. Everything in one place.', 'Maria, Mellieħa')}${quote(5, 'Same-day delivery saved me when we ran out of cat litter. Friendly, fast and genuinely local.', 'Jean-Pierre, Mellieħa')}${quote(5, 'Grooming was gentle and lovely, and the Pet Club points add up fast. Our go-to shop now.', 'Sophie &amp; Bella the spaniel')}</div></div></section>
<section class="pc-section"><div class="pc-wrap"><div class="pc-band"><h2>Join the Pet Club — free</h2><p>Points on every purchase, member-only offers, early access to new stock and a free new-pet starter pack. Because loyal pets deserve loyal perks.</p><a class="pc-btn pc-btn-gold" href="/pet-club">Become a member</a></div></div></section>
</div>`;

const ABOUT = `<div class="pc">${S}
${hero('/heroes/homepage.jpg', 'Our story', 'A neighbourhood shop, built on care', 'Pet Centre began with a simple idea: a place in Mellieħa where you could shop, get real advice, and see a vet — without driving across the island.', `<a class="pc-btn" href="/collections">Shop online</a>`)}
<section class="pc-section"><div class="pc-wrap"><div class="pc-split"><div><span class="pc-eyebrow">One roof</span><h2>Shop &amp; vet, together</h2><p class="pc-sub">Most pet care means a shop in one town and a vet in another. We put them under one roof — so a question about food can become a quick health check, and advice is always from someone who knows your pet.</p><p class="pc-sub" style="margin-top:16px">It's a model built around <strong>trust, locality and convenience</strong> — not just the lowest price.</p></div><img src="/heroes/dogs.jpg" alt="Happy pets in Mellieħa"/></div></div></section>
<section class="pc-section" style="background:#fff"><div class="pc-wrap pc-center"><span class="pc-eyebrow">What we stand for</span><h2>Care you can feel</h2><div class="pc-3"><div class="pc-card"><div class="ic">🤝</div><h3>Honest advice</h3><p>No upselling. We match you to what your pet actually needs, every time.</p></div><div class="pc-card"><div class="ic">📍</div><h3>Proudly local</h3><p>Born in Mellieħa, serving the north — with same-day delivery and a smile.</p></div><div class="pc-card"><div class="ic">💚</div><h3>Pets first</h3><p>From premium brands to in-house vet care, every choice puts animals first.</p></div></div></div></section>
<section class="pc-section"><div class="pc-wrap"><div class="pc-band"><h2>Come say hello</h2><p>Pop into the shop on Triq il-Kbira, Mellieħa — for advice, a click-&amp;-collect order, or to meet the team.</p><a class="pc-btn pc-btn-gold" href="/contact">Visit us</a></div></div></section>
</div>`;

const PETCLUB = `<div class="pc">${S}
${hero('/heroes/dogs.jpg', 'Pet Club', 'Loyal pets deserve loyal perks', 'Join free and earn on every visit — plus member-only offers, early access to new stock, and a welcome gift for new pets.', `<a class="pc-btn pc-btn-gold" href="/account/register">Join free</a>`)}
<section class="pc-section"><div class="pc-wrap pc-center"><span class="pc-eyebrow">How it works</span><h2>Three easy steps</h2><div class="pc-tiers"><div class="pc-tier"><div class="step">1</div><h3>Sign up free</h3><p style="color:#51607a;margin-top:8px">Create an account in-store or online — it takes a minute.</p></div><div class="pc-tier"><div class="step">2</div><h3>Earn points</h3><p style="color:#51607a;margin-top:8px">Collect points on every purchase and vet or grooming visit.</p></div><div class="pc-tier"><div class="step">3</div><h3>Enjoy perks</h3><p style="color:#51607a;margin-top:8px">Redeem for discounts, treats and member-only offers.</p></div></div></div></section>
<section class="pc-section" style="background:#fff"><div class="pc-wrap"><div class="pc-split"><img src="/heroes/small-animals.jpg" alt="Pet Club"/><div><span class="pc-eyebrow">Member benefits</span><h2>More than points</h2><ul class="pc-list"><li>Points on every purchase, vet visit and groom</li><li>Member-only monthly offers &amp; bundle deals</li><li>Free new-pet starter pack when you join</li><li>Early access to new stock and events</li><li>Discounted routine vet check-ups</li></ul><div style="margin-top:24px"><a class="pc-btn" href="/account/register">Become a member</a></div></div></div></div></section>
</div>`;

const VETGROOM = `<div class="pc">${S}
${hero('/heroes/dogs.jpg', 'Vet &amp; Grooming', 'Healthcare &amp; pampering, under one roof', 'A vet you can walk to and grooming by appointment — professional care for your pet, right inside the shop.', `<a class="pc-btn" href="/book">Book a visit</a>`)}
<section class="pc-section"><div class="pc-wrap"><div class="pc-3" style="grid-template-columns:1fr"><div class="pc-split"><div><span class="pc-eyebrow">🩺 Vet care</span><h2>In-house veterinary care</h2><p class="pc-sub">Friendly, convenient care for new and growing pets — no cross-island drive needed.</p><ul class="pc-list"><li>Health checks &amp; vaccinations</li><li>Microchipping &amp; registration</li><li>Parasite &amp; nutrition advice</li><li>Routine wellness visits</li></ul><div style="margin-top:22px"><a class="pc-btn" href="/book">Book a vet visit</a></div></div><img src="/heroes/cats.jpg" alt="Vet care"/></div></div></div></section>
<section class="pc-section" style="background:#fff"><div class="pc-wrap"><div class="pc-split"><img src="/heroes/small-animals.jpg" alt="Grooming"/><div><span class="pc-eyebrow">✂️ Grooming</span><h2>Grooming by appointment</h2><p class="pc-sub">Wash, trim and full grooms — your pet leaves clean, comfy and happy.</p><ul class="pc-list"><li>Bath &amp; blow-dry</li><li>Full groom &amp; styling</li><li>Nail trims &amp; tidy-ups</li></ul><div style="margin-top:22px"><a class="pc-btn pc-btn-gold" href="/book">Book grooming</a></div></div></div></div></section>
</div>`;

const CONTACT = `<div class="pc">${S}
${hero('/heroes/homepage.jpg', 'Visit us', 'Pop in and say hello', 'Come in for advice, collect a click-&amp;-collect order, or book the vet — we love meeting the pets of Mellieħa.', `<a class="pc-btn" href="https://maps.google.com/?q=Triq+il-Kbira+Mellieha+Malta" target="_blank" rel="noopener">Get directions</a>`)}
<section class="pc-section"><div class="pc-wrap"><div class="pc-info"><div class="pc-card"><div class="ic">📍</div><h3>Find us</h3><p>Triq il-Kbira,<br/>Il-Mellieħa, Malta</p></div><div class="pc-card"><div class="ic">🕒</div><h3>Opening hours</h3><p>Mon–Sat: 9:00–19:00<br/>Sunday: closed</p></div><div class="pc-card"><div class="ic">💬</div><h3>Get in touch</h3><p>Call or message us in-store,<br/>or chat with us online anytime.</p></div></div></div></section>
<section class="pc-section" style="background:#fff"><div class="pc-wrap"><div class="pc-band"><h2>Need a vet or groom?</h2><p>Book an appointment online in under a minute and we'll confirm by email.</p><a class="pc-btn pc-btn-gold" href="/book">Book now</a></div></div></section>
</div>`;

const PAGES = [
  {name: 'Home', url: '/', title: 'Pet Centre — pet shop & vet in Mellieħa, Malta', html: HOME},
  {name: 'About', url: '/about', title: 'About Pet Centre — Mellieħa, Malta', html: ABOUT},
  {name: 'Pet Club', url: '/pet-club', title: 'Pet Club rewards | Pet Centre', html: PETCLUB},
  {name: 'Vet & Grooming', url: '/vet-grooming', title: 'Vet & Grooming | Pet Centre', html: VETGROOM},
  {name: 'Contact', url: '/contact', title: 'Visit us in Mellieħa | Pet Centre', html: CONTACT},
];

async function loadPageMap() {
  const r = await fetch(
    `https://cdn.builder.io/api/v3/content/page?apiKey=${PUBLIC}&limit=100&includeUnpublished=true&fields=id,data.url&cachebust=true&noTargeting=true`,
    {headers: {Authorization: `Bearer ${PRIVATE}`}},
  );
  const map = {};
  if (r.ok) {
    const d = await r.json();
    (d.results || []).forEach((x) => {
      if (x.data && x.data.url) map[x.data.url] = x.id;
    });
  }
  return map;
}

async function writePage(spec, id) {
  const payload = {
    name: spec.name,
    published: 'published',
    query: [{property: 'urlPath', operator: 'is', value: spec.url}],
    data: {
      title: spec.title,
      url: spec.url,
      blocks: [{'@type': '@builder.io/sdk:Element', component: {name: 'Custom Code', options: {code: spec.html}}}],
    },
  };
  const endpoint = id
    ? `https://builder.io/api/v1/write/page/${id}`
    : `https://builder.io/api/v1/write/page`;
  const r = await fetch(endpoint, {
    method: id ? 'PATCH' : 'POST',
    headers: {Authorization: `Bearer ${PRIVATE}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  const ok = r.ok;
  const txt = ok ? '' : (await r.text()).slice(0, 200);
  console.log(`  ${ok ? '+' : 'x'} ${spec.url}  (${id ? 'update' : 'create'}) ${txt}`);
}

async function main() {
  const map = await loadPageMap();
  for (const spec of PAGES) {
    await writePage(spec, map[spec.url]);
  }
  console.log('\nDone. Builder pages published (allow ~30s for CDN).');
}
main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
