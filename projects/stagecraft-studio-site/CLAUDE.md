# StageCraft Studio Site

Domain: WebDesign

Marketing one-pager for **StageCraft** — Riccardo's photo/video studio covering Malta & Gozo
(product photography, property photography, videography, drone aerials, 360 walkthroughs).
No people photography.

## What this is

A single self-contained `index.html` — no build step, no dependencies, no framework.
Open it in a browser and it works.

Published artifact: https://claude.ai/code/artifact/223c6b2a-74b3-40da-b3c9-ff959d9c952b
Regenerate `artifact-source.html` with `node build-artifact.mjs` and republish that file
to update the same URL.

Predecessor: an earlier property-only version ("Bring your property to life.", €59/€149/€299
photo-*enhancement* packages). This rebuild keeps that site's visual identity exactly and
replaces the structure: category-first funnel plus per-category shoot pricing.

## Structure

Hero (rotating category showcase) → showreel → **category zone** (`#studio`) → portfolio →
process → about → contact → footer.

**No em dashes in visible copy.** Riccardo reads them as an AI-writing tell (2026-07-28) and
they were stripped from every user-facing string. Use a full stop, comma, colon or brackets
instead. Hyphens in compound words (48-hour, day-to-dusk, holiday-let) and en dashes in
ranges (8–10, 60–120s) are correct and stay. Code comments are exempt; nobody reads those but
us. Before shipping copy changes, check `document.body.innerText.match(/—/g)` is null.

**Portfolio** (`#portfolio`) is three levels deep, and deliberately so: the point is to keep
the main page uncluttered no matter how many photos exist.

1. The page shows only **gallery covers**, one per category (cover image = the first entry
   of that category, so put the strongest frame first).
2. Clicking a cover opens an **overlay with that gallery as a grid** — the visitor picks
   what they want rather than being marched through one at a time.
3. Clicking a tile opens **one frame full size**, layered over the grid, with arrow keys.

Escape steps back one level (single → grid → closed) rather than dumping the viewer out.
Driven by `PORTFOLIO` (entries) and `PORTFOLIO_CATS` (label + blurb per gallery). A category
with no entries gets no cover, so nothing empty is ever shown. `cat` must be one of
products, property, drone, staging, interiors, walkthrough.

There is deliberately **no separate "Our Work" section**. It showed the same six categories
as the hero and the showreel, and the pricing cards already carry per-package example
carousels, so it was three galleries saying one thing.

Riccardo also removed the trailing note paragraphs under the pricing panels (2026-07-28) —
he wants the panels to end on their prices, not on small print. Terms survive where they
apply: Gozo travel and 24-hour delivery on the Property note, the €100 session minimum on
the Products note and the Listing Shots card, and Estate's inclusions on its own card. The
only things genuinely dropped were the multi-service "ask us" line and the "StageCraft is
new" disclosure. **If the placeholder carousels are still in place when this goes to real
traffic, put a short version of that disclosure back somewhere** — unlabelled example frames
on a pricing card can read as client work, which breaks the no-unverified-claims rule.

The hero is sized to leave the showreel visible in the same frame (`min-height:72vh` plus
per-breakpoint padding). If you change hero padding, re-check that the reel still fits at an
800px-tall viewport and that the gaps above and below the hero copy stay roughly equal —
they are tuned separately at each breakpoint because the nav and category strip change
height.

**The hero is the way in.** It cycles through the six services, one at a time: a tinted
backdrop (a photo once `src` is set), the category name and line under the headline, and a
full-bleed strip of all six along the bottom. Every strip item is a button — clicking one
opens that service's pricing and scrolls to it. Auto-rotation stops permanently the moment
someone touches the strip, because competing with a person's own choice is what makes
carousels infuriating. On phones the strip scrolls horizontally and the rotation carries it
along, so categories that start off-screen still get seen.

**The category zone** holds four panels, one visible at a time, driven by the URL hash so
links are shareable and the back button works:

| Hash | Panel | Covers |
|---|---|---|
| `#products` | Products | Packshots, styled sets, built scenes, product video |
| `#property` | Property & Spaces | Property shoot tiers, shoot add-ons |
| `#motion` | Video, Drone & 360 | Walkthrough film, reels, drone, virtual walkthroughs |
| `#staging` | Staging & Interiors | Virtual staging, room redesign, photo rescue, single edits |

The six hero categories map onto those four panels — drones and virtual walkthroughs both
land on `#motion`, virtual staging and interior design both on `#staging`. That mapping is
the `go` field in `CATEGORY_SHOWCASE`.

**Do not give any element `id="products"`, `id="property"`, `id="motion"` or `id="staging"`.**
Those hashes are routed by JS; a matching element id makes the browser native-jump instead,
and the router breaks.

Other quirks worth knowing before editing:
- `body` uses `overflow-x: clip`, not `hidden` — `hidden` breaks the sticky category tabs.
- Scrolling goes through `scrollToSection()`, never `scrollIntoView()`. It reads the target's
  own `scroll-margin-top` so the fixed nav never covers a heading, and it drops to an instant
  jump under `prefers-reduced-motion` (an explicit `behavior:'smooth'` would override that).
- Panels must not contain `.reveal` elements. IntersectionObserver never fires inside
  `display:none`, and the 2-second fallback would mark them revealed while hidden. The panel
  container animates instead.
- Without JS, every panel renders stacked (`body.js-tabs` enables the funnel). That is the
  crawler/no-JS view — keep it working.

## Editing content

Everything Riccardo is likely to change sits in one `OWNER CONFIG` block at the top of the
`<script>`:

| Constant | What it controls |
|---|---|
| `WEBHOOK_URL` | Where the contact form posts. Empty → the form hands off to WhatsApp instead. |
| `WHATSAPP_NUMBER` | Receives enquiries while `WEBHOOK_URL` is empty. |
| `PRICING` | The nine headline package prices. A missing key renders `POA`. |
| `UNITS` | The gold "+ €X per extra" pill under each price. Empty string hides the pill. |
| `BUNDLE_MEDIA` | Carousel images per package card. Empty `src` renders the dark placeholder tile. |
| `REEL_MEDIA` | The slow showreel strip above the contact form. 8–12 entries reads best. |
| `ABOUT_PORTRAIT` | Photograph of Riccardo for About, 4:5, embedded as a base64 data URI. |
| `LOCATIONS` | Every Malta/Gozo council for the contact form's location search. |
| `CATEGORY_SHOWCASE` | The six hero services: name, line, `go` target, icon, tint, and `src`. |

**`CATEGORY_SHOWCASE[].src` is the highest-value thing to fill in.** One strong landscape
frame per category (1600px+, hosted URL) turns the hero from a tinted backdrop into the
image-led showcase the whole design is built around.

`PRICING` and `UNITS` also generate the enquiry dropdown labels, so raising a price cannot
leave the form quoting the old one. Add-on and à-la-carte prices are written inline in the
markup (plain text rows — config indirection would make them harder to edit, not easier),
as are the six `Offer` prices in the JSON-LD block above the script; keep those in step.

**The form never fakes success.** With no webhook it opens WhatsApp with every field written
out and says so; the submit button stays live so a visitor can correct a typo and resend.
Wiring `WEBHOOK_URL` switches it to a JSON POST with the original success message.

**Animated hero icons — three rules that cost hours to learn.** Each active category icon
behaves like the thing it depicts (blades spin, plant sways, globe turns, sofa draws itself
in). If you touch them, `icon-lab.html` in this folder renders all six at 5× with a
pause/real-size toggle — iterate there, not on the site.

1. **Every animated SVG part needs `transform-box: fill-box`.** Without it the transform
   pivots around the viewBox corner and the part flies off the icon.
2. **Transform units inside an SVG are viewBox units, not screen pixels.** On a 24-unit
   canvas, `translateY(-7px)` is a third of the icon — that is what sent the drone's rotors
   out of frame. Keep motion under ~2.
3. **`stroke-dasharray` must match the path's real length** (measure with `getTotalLength()`),
   and **never put `var()` inside keyframes** — custom properties do not interpolate, so the
   draw snaps to finished instead of animating.

Also: a rotating circle is a no-op. The drone's rotors are hubs with visible blades for
exactly this reason.

**The portrait is a base64 data URI, not a URL** — the artifact CSP blocks every external
host, so a hosted link renders as a broken box. To swap it: resize to ~720×900 at JPEG q82
(ImageMagick is installed) and re-encode; that keeps it near 90 KB. Same rule for any image
that has to survive in the published artifact.

**Form text has three deliberate steps of brightness** and they must stay in that order:
`--text-dim` labels → `--text-placeholder` empty fields → `--text` answers. Before this the
placeholders fell back to a browser grey while the services trigger was painted at full
brightness, so an empty field read as answered. JS adds `.picked` to the trigger the moment a
service is ticked; that class is what steps it up.

**Services is a multi-select, not a dropdown.** People routinely want a shoot *and* staging
*and* a reel, so it is a checkbox panel styled to match the selects around it (a native
`<select multiple>` can be neither styled to match nor show prices). "Project Type" was
removed — it re-asked what this field already answers. Each row's price is generated from
`PRICING`, and a pricing-card CTA ticks its service rather than replacing the selection.

The running figure is labelled **"Estimated from"** and is deliberately a floor, never a
quote: per-unit work (products, staged images, extra rooms) depends on quantities the form
does not ask for. Two rules keep it honest and must survive any edit — product rows are
floored at the €100 `SESSION_MIN` rather than summed raw, so it can never show an unbookable
€25; and virtual staging carries **`data-min="70"`** for its two-image minimum.

Three attributes, three jobs — do not conflate them:

| attribute | for |
|---|---|
| `data-from` | a row with **no** `PRICING` key (the a-la-carte video / drone / 360 rows). It must never shadow `PRICING`. |
| `data-min` | the smallest bookable **spend** for a row that also has a unit price in `PRICING`. |
| `data-min-note` | the sentence shown under the estimate when `data-min` lifted the figure. |

If you add a per-unit service with a minimum, give it `data-min` **and** a `data-min-note`:
a visitor must never be shown a number the page has not explained. A row whose `PRICING`
key is missing reads "On request" and is excluded from the total with a note — it does
**not** silently count as zero.

**Carousel images must be hosted URLs** (`https://…`). Not local file paths — they break the
moment the file is shared — and not base64, which would bloat a file that has to stay
readable and pasteable.

## Pricing basis

Set 2026-07-28 from market research across Malta and comparable EU markets, then adjusted
down because Riccardo is a newcomer without a delivered portfolio yet.

Malta anchors: Ivana Cattafi €190/€270/€360 (72h delivery); MyRent.mt from €120; MIPP
official guide €75–200 per property and €75–250 drone add-on; Drone Studio Malta
€150/€300/€595; Immomedia360 video €125–€500; commodity floor €50. Product photography at
€25/image sits dead-on the €20–32 band charged by German and Italian solo studios.

Property tiers land ~20–30% under the direct incumbent's rungs, and Estate beats their top
tier on inclusions (drone is bundled, where theirs costs extra). Expect to raise these once
the portfolio fills — the "Launch pricing" framing was left available for that.

Product volume pricing is **marginal, not all-units** (first 5 at €25, 6–20 at €20, 21+ at
€15). All-units tiers invert: at a flat "€20 each from 6", five products cost €125 and six
cost €120, so a customer pays less for more. Keep any new tier marginal.

**What the services actually are** — corrected 2026-07-29, do not drift back:
- The three product tiers are three *situations*, not a good/better/best ladder, so none of
  them carries a "Recommended" badge. Only Property has one, because Essential → Signature →
  Estate genuinely is a ladder. The tiers: **Listing Shots** (plain background), **Generated
  Setting** (product photographed for real, surroundings generated around it), **Built Set**
  (a physical set, sourced and built, nothing generated). The middle tier used to duplicate
  the third — that was wrong.
- Say plainly on the Generated Setting card that the product itself is never altered, only
  what surrounds it. That disclosure is the whole reason the tier is honest.
- **There is no renovation service.** Riccardo does not repaint, re-floor or change finishes.
  The interiors card is **Styling & Decor**: furniture, lighting, art, plants, textiles. Any
  copy about wall colour, kitchen fronts or finish swaps is a regression.
- Styling comes two ways: digitally in the photo (Staging & Interiors panel) and physically
  on the day (**On-location styling**, an add-on on the Property panel).

**Staging and interiors** (researched 2026-07-28, separate pass):
- Virtual staging is priced **per image** across the entire industry — BoxBrownie €22,
  Styldod €15–21, VizCraft €16.60, EU band €8–28. "Per room" is the convention for
  *physical* staging and invites a dispute when a room is shot from three angles. Ours is
  €35/image, tiered to €30 at 3+ and €25 at 6+: above the wholesale bureaus (we are a
  service, not a factory) and well under the €45–115 photographer add-on rate.
- Room redesign at €119/room/concept undercuts the one Malta competitor publishing a rate
  (Swift Design, €80/render inside a €1,500 five-render package) while being far faster,
  and sits far below Malta's €500–1,500 room-consultation norm.
- The two are easy to confuse, so the panel carries a boxed "staging is not redesign"
  explainer and a "photo-based, not CGI" honesty note. Both earn their space — naming the
  limit of what we sell is the fastest substitute for a portfolio. Do not quietly drop them.
- Staging promises **24h**, not the site-wide 48h. It is the one service where we can
  credibly beat everyone and it costs nothing.

## Invariants found by review (2026-07-29)

Each of these was a real defect that shipped. They are cheap to reintroduce.

- **The showreel strip masks its edges, it does not scrim them.** A translucent overlay
  still lets a tile's 1px border and lighter panel read through, so the end tile looked
  sliced. `--fade` on `.reel-scroll` must stay at least half a tile wide at every width.
- **`half()` adds one flex gap before halving.** The list is rendered twice inside one
  flex row, so `scrollWidth` is a gap *short* of two periods. Halving it plainly put the
  loop 8px out and the strip twitched on every wrap. Measured: true period 2460px, naive
  2452px.
- **Do not reset drag state unconditionally in `lostpointercapture`.** `endDrag` releases
  the pointer itself and that fires `lostpointercapture` ~0.7ms later (measured, trusted
  events), which wiped the fling before a single frame ran and made the momentum dead
  code. Guard on `dragging` still being true, which only happens on a genuine loss.
- **Drag the strip by DELTAS, never by an absolute offset from where the drag started.**
  `scrollLeft = startLeft - dx` is recomputed from a stale origin the moment the loop
  wraps, which cancels the wrap and pins the strip against the end of its scroll range.
  It read as the reel running out of images. Deltas survive any number of wraps
  (verified: 6233px of continuous drag, 2.8x the loop period, zero stuck frames).
- **Release velocity comes from a WINDOW of recent samples, not the last pointermove.**
  A real mouse reports the same X two frames running fairly often, so reading only the
  final sample returned "stopped" for a hand still travelling and the coast never
  started. `releaseVelocity()` regresses over the last 90ms. This also makes the
  pause-then-release case fall out for free: no recent samples, so it returns 0. Verified
  a throw ending on repeated coordinates still coasts 281px against a 28px drift floor.
- **The drone icon is the hub-and-blade version — Riccardo picked it over a rotor-ring
  redraw (2026-07-29). Do not "improve" it.** Two constraints hold it together:
  headroom, so the climb stays inside the viewBox and the top blades do not clip (hence
  the static `translate(0 .6)` wrapper and the 1.8-unit `i-bank` lift), and the blades'
  **resting tilt, which is baked into the path geometry, not a CSS transform**. Four
  horizontal blades read as a grille when the animation is off. Keep the tilt in the `d`
  attribute: a static `transform:rotate()` would become the implicit `from` of `i-spin`
  and the rotor would jump back on every loop. The tilt is **mirrored left-to-right**,
  not parallel across all four — parallel reads as a sheared grille rather than a drone.
  Verified 1.9 units of headroom across the climb and rotor sweep combined.
- **Only the hero's TOP padding may shrink on short screens; the bottom stays 7.5rem.**
  The category strip is absolutely positioned at the hero's bottom edge, so it lives
  inside that bottom padding. Letting it shrink to `9vh` closed the gap between the CTA
  buttons and the strip to ~3px. Room for the showreel comes from the reel, not here.
- **Reel tiles are sized from viewport HEIGHT (`--tile-h:clamp(104px,16vh,180px)`), not
  width.** A width-driven tile grew largest on a wide-but-short window, which is exactly
  where there was least vertical room, and pushed the strip past the fold. The mask
  `--fade` is derived from that SAME `--tile-h` and must stay above half a tile: a
  width-only clamp fell short on every phone in portrait and the end tile went back to
  reading as a hard cut.
- **The reel repeats its list as many times as the viewport needs, never a fixed two.**
  `scrollLeft` is capped at `trackWidth - clientWidth`, so if one period is narrower than
  the viewport the wrap point sits past the end of the scroll range and can NEVER be
  reached: the strip drifts to its last tile and stops there for good. Two copies is only
  enough while the strip is wider than the viewport, which fails on a wide-and-short
  window and on any short `REEL_MEDIA`. `measure()` tops the copies up, re-runs on resize,
  and caches `PERIOD` so the rAF loop stops forcing a reflow on every frame.
- **An arrow press must stand the drift loop down (`holdUntil`).** The loop writes
  `scrollLeft` every frame and any such write cancels an in-flight smooth scroll, so an
  arrow moved the strip by a single drift step unless the cursor happened to be over the
  reel. Under reduced motion the loop is not running at all, so `step()` applies the wrap
  itself or the arrows dead-end at both extremes.
- **`start()` owns the reduced-motion check, not its call site.** `restart()` is wired to
  hover and focus, so guarding only the initial call let a hover start the carousel for
  someone who asked for stillness.
- **No list roles on the showcase chips.** `role="listitem"` on a `<button>` overrides its
  button semantics and assistive tech stops announcing it as activatable.
- **Read checkbox groups with `FormData.getAll`.** `Object.fromEntries` keeps only the last
  value for a repeated name, so a four-service enquiry reached the webhook as one.
- **Every route out of the single-image view restores focus.** Escape used to skip it and
  strand the keyboard on a hidden button. Tab is trapped inside whichever layer is on top.
- **`data-from` on a service row must never shadow a `PRICING` key.** `serviceFrom()`
  reads PRICING first now. It used to read `data-from` first, and `stg-staging` carried
  `data-from="70"` while PRICING said 35 — so the row read "€35 per image" and the running
  total added €70. `data-from` is only for the à-la-carte video/drone/360 rows, which have
  no single PRICING figure of their own. Minimums go in `data-min` (see the table above),
  because inverting that lookup removed the only way to express one.
- **`window.open` must NOT be given `'noopener'` in its feature string.** The spec makes it
  return `null` whenever that flag is set, so the "popup was blocked" fallback fired on
  every submission and navigated the visitor's own tab to WhatsApp: they lost the page and
  never saw the success line. Open without the flag and null the `opener` afterwards, which
  keeps the same protection and leaves a handle worth testing.
- **The €100 product session minimum is stated in the estimate note whenever it applies**,
  and the flag for that is `rawProduct < SESSION_MIN`, not `total === SESSION_MIN`: the
  latter also fired on a lone €100 Built Set, which reaches the minimum on its own and
  needs no explaining. It is published on the product cards as well, so form and cards
  agree.
- **The em-dash gate has to be checked with the estimate box OPEN.** A `document.body`
  sweep misses it: the placeholder only rendered once a service was ticked, so an em dash
  sat in the total for "Not sure yet" through several clean sweeps. It now reads
  "On request".

- **The portrait backdrop is graded through a real subject matte, and it has to be.**
  `assets/portrait/tone-backdrop.py` scales the backdrop uniformly through
  `subject-matte.png` (fal birefnet, run on that exact file so it is pixel-aligned),
  which keeps the backdrop's gradient and vignette moving together and leaves the
  subject alone at any strength. Three cheaper routes were tried and all fail:
  a tone curve biting only the top end **compresses** the gradient instead of moving
  it, so the bright centre flattens toward the dimmer edge and rings around the head;
  a luminance-derived matte cannot separate backdrop from subject, because the
  backdrop's own vignette falls below any threshold that excludes the shirt, so the
  dark corners escape and the scaled centre rings against them; and a wide global
  rolloff avoids the ring only by staying so weak it is invisible, flattening the face
  as soon as it is pushed. The pre-existing cut-out in that folder is a **different
  crop** of the shoot and cannot be registered to this framing, so it is not a
  substitute matte. `portrait-framed-web.webp` is the untouched source and must stay
  that way, or re-running the script compounds the grade.

## Outstanding

- **Fill in `BUSINESS` in the config before this goes live at a real domain.** Trading name,
  address and VAT position are the only legally required facts on the page that nobody but
  Riccardo can supply. While any is blank the footer and the privacy notice show a visible
  "to be completed" marker and the console logs what is missing, deliberately: an invented
  trading name or VAT number on a legal notice is worse than an obviously unfinished one.
  Confirm the VAT position (Article 11 small undertaking under €35,000, or registered and
  therefore prices shown inclusive) with a Maltese accountant. Basis:
  `plans/reports/researcher-260729-1733-malta-site-legal-minimum-report.md`.

- **Eight paid extras are absent from the contact form's service picker** (on-location
  styling €120, listing copy €25, social captions €25, guidebook €100, day-to-dusk €15,
  object removal €12, second direction €69, extra styled image €25). Deliberate for now
  — they read as add-ons discussed after a shoot is agreed, not things to pick up front.
  Prices for the nine that ARE listed were verified against the cards on 2026-07-29.
- **The portrait treatment is undecided.** The site ships the framed original;
  `portrait-compare.html` (built by `build-portrait-compare.mjs` from the two webp files
  in `assets/portrait/`) renders the About section both ways for a side-by-side call.
- **The About paragraph needs Riccardo's sign-off.** The invented origin story ("started
  out fixing photographs") was removed; what replaced it claims only that he runs a
  business of his own in Mellieħa. Nothing else about him is asserted anywhere on the page.
- **Drone Aerials is advertised with prices but not yet legally deliverable** — commercial
  work needs A2 certification, operator registration and insurance he does not hold. See
  `plans/reports/research-260729-malta-drone-commercial-requirements-report.md`.
- `hello@stagecraftpro.com` has **no MX record** — mail sent there bounces. Riccardo is
  sorting the domain; until then WhatsApp is the only channel that actually reaches him.
  `og:image` on the same domain is likely a 404, so shared links render without a preview.
- Carousel images are placeholders. Real photos go in `BUNDLE_MEDIA` as hosted URLs.

Full research and rationale: `plans/reports/` and the plan at
`~/.claude/plans/i-want-to-create-toasty-blossom.md`.

## Publishing

The file is a complete HTML document, which is correct for a real site. The Artifact tool
wants body-only content, so publishing strips the outer wrapper — regenerate the artifact
source rather than hand-maintaining a second copy.

The artifact CSP blocks font CDNs, so Google Fonts will not load there. Both font stacks
fall back deliberately (`Cormorant Garamond` → Georgia, `DM Sans` → system-ui), which keeps
the serif/sans pairing intact. Hosted properly, the real fonts load.

## Gates

Run the `code-reviewer` agent before any deploy or `git push` — hook-enforced from the
workspace root.
