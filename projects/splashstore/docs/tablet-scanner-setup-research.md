# Splash Store Malta — Fulfilment Hardware Research (tablet · scanner · ecosystem)

Researched 2026-07-09/11. ~27 research agents across 3 workflow runs; all web via Firecrawl; every finalist claim
adversarially re-verified against live sources. Prices checked 2026-07-09/10 — re-check at purchase.

## TLDR

**SETTLED (2026-07-11): classic tablet + handheld, budget relaxed → one pick, complete day-one kit ≈ €1,290.**
**Tab S10 FE (€469 Scan Malta)** + **Zebra DS2278 cradle kit (€185)** + spare battery, case, holster, 4G router,
250 kg trolley, **ZD230t thermal-transfer label printer** (pulled forward to day one), bin labels, powerbank.
The A11+ 5G budget alternative is demoted to a footnote; spending past ~€1,300 buys nothing (fleet gear the
evidence rejected). The judge's phone-first finding stands in the record (§12) as the declined alternative —
the dedicated-device preference is a legitimate segregation call. Owner-facing consolidated guide = the shared
Artifact page; this file is the deep reference.
Hands-free = belt holster + platform trolley + batch mode, not a ring. Labels: laser + Avery weatherproof
polyester now, thermal-transfer Zebra later — never DYMO direct-thermal on hot chlorine buckets. Electronics
never sleep or charge in the chlorine garage; POS opened on data before entering; van sales recorded same-day.

## 0. Decision record — classic tablet + handheld lane (owner, 2026-07-11)

The owner prefers the classic setup: a tablet as the garage terminal plus a handheld scanner. This is a stated
client decision — it overrides the judge's phone-first lean (§12, kept as the documented alternative) and is a
defensible segregation/comfort call (business off the personal phone; one dedicated station). Making it fare
best:

1. **Scanner pairs to the TABLET, natively** — use Shopify's DS2278 setup page (app/HID-Bluetooth-Classic
   pairing barcodes). Native Zebra-on-Android integration avoids the generic-HID focus-steal bug entirely.
2. **Tablet: SETTLED (budget relaxed 2026-07-11 — "more is fine, nowhere near €2–3k"):**
   - **THE PICK — S10 FE 128GB/8GB (€469 Scan Malta / €499 Sound Machine; Wi-Fi only locally)** — the only
     tablet the evidence lets reach 5–7 yrs. Cellular variant not stocked in Malta (verified 2026-07-11;
     idealo.at 5G €411 is the import route) → pair the Wi-Fi unit with a **mains 4G router in the powered
     clean garage** (~€56 + Epic SIM €9.99/28d) — also gives future devices Wi-Fi.
   - A11+ 5G (€279): was the budget compromise; **demoted to footnote** now the ceiling is relaxed — its
     A-series aging risk is no longer worth €190.
   - **Why not spend more:** past ~€1,300 nothing improves this operation — €500+ tablets buy unused speed,
     and €900–1,400 gear (RS5100 rings, TC-series handhelds, ProGlove) is fleet tooling the evidence rejected.
   - **Complete day-one kit ≈ €1,450–1,550 local-first** (revised 2026-07-11 after the deep Malta-availability
     check — see §10 for the full linked sourcing map): S10 FE €469 + DS2278 €199 local (+cradle quote) + spare
     battery €52 local + ZD230t €350 local + PP labels/ribbon ~€60 local + router €69.90 local + trolley €115
     local + case/holster/bin-labels/protector ~€170 (mostly Amazon). ~90% by value from three Malta shops
     (Scan Malta · iLabMalta · Homemate). Software: POS Lite free, iPacky free tier, EasyScan ~$10/mo, SIM ~€10/mo.
3. **Station layout (garages have power):** DS2278 presentation cradle + tablet stand on the clean-garage
   bench = walk in, grab, scan; charge overnight there or at home — never in the chemical garage.
4. **Carry kit:** rugged hand-strap case (A11+: €39.95 Scan Malta; S10 FE: SEYMAC/HXCASEAC class via
   amazon.de, ~€40–47) so the tablet works as a walkable clipboard during picks; belt holster for the scanner.
5. **At-door sales** still get recorded same-day — either POS on his phone at the door (free) or back at the
   bench tablet; the custom-tender flow is identical.
6. **Unchanged:** all §12 operating rules (Protect Battery 80–85%, bench tests in return window, spare scanner
   battery, One UI update delay), the trolley, label chemistry, chlorine segregation, Nov–Feb stocktake.

## 1. Client profile (verified)

- **splashstoremalta.com** — Shopify since 2022-01-20; "Powered by Shopify" + Shopify CDN + `/products.json` dump.
  Backing domain `hot-tub-and-pools-malta.myshopify.com`; several nav pages never migrated off it (DIY web ops).
- Operated by **MC Imports and Trading**; direct Intex importer for Malta; Lay-Z-Spa (Bestway) too.
- **229 products / 246 variant SKUs** (full catalog counted — under the 250 json cap). Brand mix: Intex 127,
  "Various Manufacturers" 82, Lay-Z-Spa 9, Bestway 4, Aiper 3. Range €9 (pH granules) → €6,200 (fibreglass hot tub).
- Water Chemicals & Chlorine collection: 34 products, all in stock, max €50.
- Warehouse: Triq Pietru Felici, **Qormi** (yellow.com.mt listing matches phone/email). Free Malta/Gozo delivery
  >€30; warehouse pickup "any time of the day once notified". Contact via WhatsApp +356 7905 2595.
- Socials: FB/IG @splashstoremalta + YouTube channel (activity level unverified — Firecrawl can't scrape FB).

## 2. The two jobs + how his day changes

**Job A (now):** one-time scan of ALL stock → barcode+qty master list → feeds the AI catalog-enrichment engine
(`projects/pet-centre-catalog/`, portable per its `docs/engine-briefing.md`).

**Job B (ongoing):** pick-scan-verify orders into the van, record manual sales so Shopify stock stays true,
goods-in when containers land, cycle counts.

| Moment | Today | With the setup |
|---|---|---|
| Order arrives | Picks from memory | Picking list (iPacky free tier), scan-verify each item into the van — wrong-item-in-van is the expensive delivery-business mistake |
| Paid cash/Revolut at door | Stock drifts silently | Close sale **on his phone**: POS custom payment "Revolut"/"Cash" → normal order → inventory decrements. Free (POS Lite), **works offline**, syncs later |
| Container lands (Mar–Apr) | Manual notes | Scan-in goods at the garage |
| Stock truth | Unknown | Job A capture → then monthly cycle counts of fast movers in season |

## 3. Platform layer (all first-party sourced, live-scraped)

- **Shopify Payments IS available in Malta for ONLINE** (dedicated Malta help page exists) — but **NOT for
  in-person/POS** (Malta absent from the both-online-and-in-person country list). No Shopify card readers, no Tap
  to Pay. In-person card money, if ever wanted: SumUp (€34–169, sumup.com/en-mt) or Revolut Reader (€49 at Malta
  launch 7/2024; 0.8%+€0.02 — current price unverified), recorded as custom tender.
- **POS Lite is free** on every paid plan and covers everything needed: cash tender (built-in), **custom payment
  types** (admin → Point of Sale channel → Settings → Checkout → "Add custom payment type" — intended for
  "third-party terminals"; closes as a normal inventory-adjusting order), **offline checkout for cash/custom
  tenders "available to all Shopify POS users"** (not Pro-gated). Offline limits: can't create products, some
  search functions, email receipts queue. POS Pro ($89/mo) not needed.
- **Stocky is dead** — no new installs since 2026-02-02, stops working 2026-08-31. Do not build on it.
- Live app choices: **EasyScan** ("506 EasyScan SKU & Barcode", Basic $9.99/mo — barcode assignment, label
  printing, stocktakes; mid-tier price conflicting $24.99 vs $39.99, check listing) · **StockSavvy** ($9/mo,
  500 SKUs/count, 20 POs) · **iPacky** (pick/pack scan-verify, **free ≤50 orders/mo**, browser-based = Android OK).
  "Pikr" does not exist on the App Store (closest: "Order Picking App" $14.95/mo).
- **Shopify admin app (Android)**: built-in camera inventory scanner (Products → Scan inventory) + can populate a
  product's barcode field by camera scan. External HID scanners in POS only add to cart — they can't do admin
  inventory edits (that's what EasyScan-class apps are for).
- **HID scanner support in POS is new (Oct 2025) and quirky.** Landscape from community evidence:
  - Officially: "most HID scanners" work; toggle = POS → Settings → **Allow HID mode**. Scanning from the POS
    home screen (search bar NOT focused) adds straight to cart. Variant's **Barcode field must be populated**.
  - Known bug class: suffix/prefix + focus issues. Config rule: suffix = **single CR, no LF, no prefix**. Android
    focus-steal bug (Dec 2025, unresolved): after touching the search bar once, HID scans stop registering —
    workarounds: tap cart clear, or don't touch search, or restart POS. Expect to fiddle with the manual's config
    barcodes once at setup.
  - Zebra on Android is the officially blessed native path (sidesteps the whole HID bug class). Socket Mobile
    (the iOS-era official answer) has years of complaint threads ("went through 4 in two years") — avoid.

## 4. Core hardware — verified tiers (research chronology; the operative decision is §0)

Adversarially verified 2026-07-09 (prices live at named retailers; corrections applied). Tier names below are
from the research pass — after the owner's classic-lane decision, "Recommended" maps to the **budget pick** and
"Rugged/Premium" to the **longevity pick** in §0.

| Tier | Kit | Total | Fit |
|---|---|---|---|
| **Value ~€325** | Tab A11+ 5G €279 (Scan Malta, in stock; €226 idealo.de) + Netum NT-1228BL €46 (amazon.de) | ~€325 | Meets every hard requirement; consumer scanner = 1–2 yr consumable risk |
| **Recommended ~€505** | Tab A11+ 5G + **Zebra DS2278 cradle kit** €184.65 (idealo.de; scanner-only from €122) + Just-in-Case rugged strap case €39.95 (Scan Malta) | ~€505 | The zero-drama pick — see verdicts below |
| **Rugged/Premium ~€695** | **Tab S10 FE** €469 (Scan Malta, exact model in stock; €403 idealo.de) + DS2278 kit + case | ~€695 | Only if the tablet must live rough: IP68, updates to Apr 2032 |

**Tab A11+ 5G (SM-, Dec 2025):** Android 16; updates to **30 Dec 2031 floor** (endoflife.date), Samsung/press say
7 years (≈Dec 2032); Shopify POS Android minimum is 10 — huge headroom. 5G built in solves spotty garage Wi-Fi
(≈€10/mo Malta prepaid data: Epic 8GB €9.99/28d). No IP rating → rugged case + never stored in garage. 5G premium
over Wi-Fi: €50 local / €27 DE.

**Tab S10 FE (SM-X520, Apr 2025):** Android 15, 8GB; **IP68 confirmed** (Samsung official); updates to
**03 Apr 2032** (7 yrs). "Only IP68 tablet in budget" is marketing-grade (Tab Active5 also IP68, over budget).

**Zebra DS2278 kit DS2278-SR7U2100PRW:** on Shopify's **named supported list** with its own setup page (pairing
via "HID Bluetooth Classic" barcode on Android; app-mode too). **Out-of-Range Batch Mode confirmed** (one config
barcode from the PRG, no PC needed; caveat: don't combine with Auto-Reconnect — reconnect config matters; exact
DS2278 buffer capacity unverified, DS8178 sibling ≈30KB). Corrections: drop spec **1.5 m** (not 1.8), IP52,
straight trigger (not gun-grip). Field-replaceable battery (the wear item that kills cordless scanners — budget
units generally lack this). 3-yr factory warranty commonly cited for DS22xx (unverified — confirm with Sirap).
Community: deployers say they "last forever without issue"; enterprise scanners show "fewer connectivity issues
vs consumer" (multiple voices).

**Netum NT-1228BL:** €46.34 amazon.de (NETUM Official store; netum.net direct $47.99 ships from Prague 3–7 days).
True 2D CMOS, triple connectivity (BT HID + 2.4G dongle + USB — dongle inclusion varies by listing, check box
contents). **Storage mode confirmed in manual but capacity undocumented** — bench-test within the return window.
Amazon.de 4.3★/1,871 ratings with an **~18% 1–2★ tail** (themes: BT dropouts after weeks, battery fade after
months). Merchant anecdote: Netum→Google Sheets "works perfectly on an Android tablet" (flaky on iPad).

**Benchmark row (not recommended):** iPad 11 A16 128GB — €399 at Forestals (vs €519 iCentre — big same-island
spread); client prefers Android; iPad+BT-scanner combos also the flakier path per merchant reports.

## 5. Hands-free / wearable scanners (his new question)

**Verdict: additive experiment, not core.** His scan cadence is intermittent (pick bucket → walk → load → scan a
few lines), not the continuous hundreds-per-day where rings earn their keep. Fleet workers handed rings with
spares/chargers like them ("2 free hands for large packages"); small operators choosing their own kit get steered
to handhelds — rings snag and break exactly during heavy lifting, and no first-person account exists of a solo
e-commerce owner running a budget ring long-term.

- **Budget rings (€50–80):** Eyoyo ring class — documented **16 MB / 5,000+ code memory mode** (best-documented
  offline capacity of any budget unit; out-specs the DS2278's offline story); 26 g; but 380 mAh cell, exposed
  charging pads (corrode with sweat/humidity — Maltese summers), velcro stretch. Treat as **1–2 yr consumable**.
  Netum NT-R2 (~€80, HID explicitly documented, same vendor as NT-1228BL) is the lowest-pairing-risk ring.
- **Mid (Unitech MS652+):** real Zebra SE4107 engine, 7.5 MB batch memory, two-finger strap — but no EU street
  price found, no Malta channel. Quote-only if pursued.
- **Enterprise benchmarks:** Zebra RS5100 **€856+** (the only ring with organic positive sentiment — Amazon FC
  standard issue; hot-swap batteries; serviceable via Sirap) = 1.2–2.6× his entire budget. ProGlove ~€800–1000 +
  middleware. Zebra WS50: no Google services → no Shopify POS. All confirmed overkill.
- **The 90% alternative:** DS2278 in a **belt holster or clipped to the trolley** + the r/Odoo pattern (tablet
  mounted on the pick trolley) ≈ hands-free-enough for €20–40 of mounting hardware, keeps the supported-list
  scanner, nothing worn or broken.

## 6. Label printing (products without barcodes + bin labels)

**The decisive physics: direct thermal fades — heat/sun/chemical contact accelerates it** (5+ independent
practitioner sources; industry rule-of-thumb 6–24 months indoors at office temps, collapsing to weeks–months with
heat; a Maltese garage hits 40–50 °C with chlorine dust = oxidizer on the label). **Thermal transfer (ribbon) on
polypropylene stock is the durable answer** for bucket labels.

- **Recommended: Zebra ZD230t ~€242** (thermal transfer, same driver family; works with Retail Barcode Labels via
  the OS print dialog though not on the named list) or **ZD421t ~€300** (officially listed; note Shopify's EU
  store SKU ZD4A042-D0EM00EZ is the direct-thermal variant — buy the "t" from a normal reseller). Wax-resin
  ribbon + polypropylene 2"×1" (#10010039) product labels; 3"×2" (#10010044) for buckets/big boxes (bigger
  gloved-scan target). Local supplies channel: Sirap Ltd (Zebra Malta partner).
- **The tempting trap: DYMO LW550 €82.50** — officially supported but direct-thermal-only + RFID-locked genuine
  labels: may be unreadable after one Maltese summer on a chlorine bucket.
- **NIIMBOT B1 (~€50–60):** zero Shopify integration (app-only) — but fine as a casual **bin/location labeler**.
  Phomemo with the Shopify label app: community-confirmed dead end (Feb 2025 thread, no solution).
- **Reality check: label printing is a DESKTOP task regardless of tablet choice.** Shopify docs are explicit — no
  label printing from POS/mobile. Flow: Retail Barcode Labels app (free) in Chrome/Edge on his PC → one-click
  "create barcodes for all products without barcodes" (Code-128; exactly Job A's gap-filler) → batch-print →
  carry labels to the garage. "Save as PDF" enables offline reprints. Zero-hardware fallback: Avery 5160 sheets
  on any laser printer (paper labels on buckets want clear-tape over-lamination).
- App caveats: fixed label sizes only, no CSV/bulk selection (manual variant picking — community gripe thread),
  ~2★ app rating claim (single source). Bin/location labels are NOT a Shopify-app job — free ZebraDesigner on the
  same printer, or the NIIMBOT.

## 7. Picking kit & garage fit-out

- **Trolley — buy local:** Homemate Malta 250 kg **€115** or Megastore MacAllister 250 kg €129.58 ("Notify me" —
  verify stock). The hoped €40–90 band only buys 100–125 kg class (marginal for stacked 25 kg buckets); Wolfcraft
  ergonomic €89.99 amazon.de if importing (capacity unverified). Useful add-on: folding Stanley FXWT-706 (125 kg,
  stows flat in the van) for delivery stops. Malta Hire Shop rents a 250 kg truck for the one-off stocktake.
  Platform trolley alternative is better for the Job-A bench runs (buckets upright) but useless on kerbs.
- **Locations before software** (practitioner consensus): code every rack/bay/shelf — `G1-A-3` = Garage 1, Rack A,
  Shelf 3; one prefix per garage; fast movers waist-height near the door. **Magnetic C-profile label holders**
  (amazon.de 50-packs; magnetic beats adhesive in Maltese heat) + printed Code-128 location barcodes. Store bin
  codes in **Shopify's native bin-location field (CSV-managed, zero apps)** — never encode location into SKU.
- **Power:** garages have outlets (owner-confirmed 2026-07-11) → DS2278 **cradle + charging shelf live on the
  bench in the NON-chemical garage** (charging contacts are chlorine vapour's first victim — never charge in the
  chemical bay). Anker 20,000 mAh USB-C PD **€23.99** (30W) as van/mobile backup. Don't cook li-ion in the van
  cargo box.
- **Form factor check (rugged handheld lane):** Zebra TC21/TC26 class is THE small-warehouse default per 4+
  communities — but for a solo 246-SKU operation it means a second SIM, quote-only refurb EU pricing, unverified
  update horizon on 2020-era hardware, and the Wi-Fi-only TC21 is a trap for no-Wi-Fi garages. Phone/tablet + BT
  scanner is proportionate now; refurb TC26 is the clean later upgrade if juggling annoys him.

## 8. Job A runbook (feeds the AI catalog engine)

1. Print internal barcodes first for known no-EAN stock (repackaged chemicals, loose parts, unboxed floats —
   GS1 reserves prefixes 20–29 for in-store codes; Retail Barcode Labels can auto-generate for all products).
2. Tablet: Google Sheet marked **"Available offline" BEFORE leaving coverage**; scanner in HID mode, suffix CR;
   scan → barcode lands in cell, cursor drops a row. Quantity: scan-per-unit or type (toggle soft keyboard — HID
   scanner counts as a keyboard and hides it).
3. Dead-zone garages: scanner **batch/memory mode**, dump on reconnect. Bench-test capacity day one (Netum's is
   undocumented; Zebra's confirmed).
4. Watch: inner vs outer carton EANs on multipacks (different GTINs!), duplicate/shared EANs on white-label
   imports, glare on shrink-wrap (tilt, don't tape over codes), curved buckets (place own labels on flattest
   face/lid), sun-faded labels → type manually.
5. Output: barcode + name + qty + location sheet → `pet-centre-catalog` engine (re-point per engine-briefing).

## 9. Environment & timing (dual-sourced + strongest community consensus found)

- **Chlorine vapour corrodes electronics** — pool-industry guidance ("destroyed pumps, controllers…
  electronics") + 5 independent owner threads ("chlorine gas will rust anything in sight"). **Segregate:**
  chemicals in one ventilated garage; bench/charging/printer/tablet in a DIFFERENT garage or home nightly.
  Devices enter the chlorine garage minutes at a time; IP68 doesn't protect against overnight vapour. Prefer
  plastic shelving in the chemical room; expect faster wear on metal fittings there. Air 10–15 min before
  sessions; lids tight; chlorine away from acid.
- **Stocktake timing:** full count **Nov–Feb** (low stock, bearable heat, low off-gassing); goods-in verification
  pass **Mar–Apr**; never Jun–Aug. Season: mid-June–mid-Sept peak, demand ramps Apr–May.

## 10. Procurement — REVISED 2026-07-11 deep local check: ~90% of the kit is buyable in Malta

Owner's rule: local preferred when equal; functionality wins otherwise. Deep sweep found **iLabMalta (Mosta,
ilabmalta.com) is a full Zebra/Honeywell/Datalogic webshop with live prices + stock** — not quote-only as
assumed. Local sourcing map (all links live-checked 2026-07-11):

| Item | Route | Price |
|---|---|---|
| Tab S10 FE 128/8GB Wi-Fi | **LOCAL** [Scan Malta](https://www.scanmalta.com/shop/samsung-galaxy-tab-s10-fe-10-9-128gb-8gb-android-wifi-grey-tablet.html), in stock (Sound Machine €499 backup; 5G variant NOT sold in Malta — EU-only, e.g. dakauf.eu X526B €547) | €469 |
| Zebra DS2278 | **LOCAL** [iLabMalta €199 incl VAT, sale from €267](https://ilabmalta.com/zebra-ds2278-sr7umc00azw) — SKU SR7UMC00AZW = scanner + micro-USB **charge cable, NO cradle** (data still Bluetooth). **Ask iLab to quote the presentation-cradle kit (DS2278-SR7U2100PRW)** — cradle = drop-in charging + the wired-USB fallback route; import kit fallback [idealo.de €184.65](https://www.idealo.de/preisvergleich/OffersOfProduct/6814346_-ds2278-sr7u2100prw-zebra-technologies.html) | €199 (+cradle TBD) |
| DS2278 spare battery | **LOCAL** [iLabMalta BTRY-DS22EAB0E-00, 3 in stock](https://ilabmalta.com/zebra-btry-ds22eab0e-00) | €52 |
| Label printer ZD230t (thermal transfer) | **LOCAL** [iLabMalta ZD230 TT USB+Ethernet, in stock](https://ilabmalta.com/zd23042-30ec00ez-zebra-zd230-thermal-transfer-labe) — €108 over idealo's €242; buys local warranty/support, accepted per owner's stance. Auto-cutter variant €560 exists; not needed | €350 |
| PP labels 2"×1" | **LOCAL** [iLabMalta 2,580× 50.8×25.4mm polypropylene thermal-transfer permanent](https://www.ilabmalta.com/2580-labels-508x254mm-polypropylene-thermal-transf) + wax-resin ribbon from their [labels/rolls range](https://ilabmalta.com/barcode-labels-thermal-rolls) | ~€40–60 |
| 4G router | **LOCAL** [Scan Malta TP-Link M7350 portable, in stock](https://www.scanmalta.com/shop/tp-link-m7350-advanced-4g-lte-3g-150mbps-portable-wifi-modem-router.html) €69.90 (mains Archer MR200 €79.90 currently out of stock — M7350 does mains-powered duty fine) | €69.90 |
| Screen protector | **LOCAL** [Scan Malta "Just in Case" tempered glass S10 FE](https://www.scanmalta.com/shop/just-in-case-samsung-galaxy-tab-s9-s9-fe-s10-fe-s10-lite-s11-11-tempered-glass-screen-protector.html) (also tames the digitizer oversensitivity) | ~€20 |
| Trolley 250 kg | **LOCAL** [Homemate Malta](https://www.homemate.com.mt/product-category/trolleys-transporters) | €115 |
| Rugged hand-strap case | **IMPORT — no local equivalent** (Scan Malta has only trifold book cases €25–30): SEYMAC/HXCASEAC class, amazon.de | ~€40–47 |
| Belt holster, magnetic bin labels | **IMPORT** (trivial, amazon.de) | ~€45 |
| Amazon route note | .de/.it ship to Malta (€4.99+€0.99/kg, real-world 1–2 wks); filter "sold by Amazon" | — |

**Local total ≈ €1,335 across three shops** (Scan Malta · iLabMalta · Homemate) + ~€110 Amazon bits ≈
**€1,400–1,450 all-in** — roughly €100–150 over the import-heavy version, buying same-week availability, Maltese
VAT invoices and walk-in warranty. One consolidated iLabMalta order covers scanner + battery + printer + labels
+ ribbon (+cradle quote). Sirap (San Gwann) stays the Zebra service/support relationship if ever needed.

## 11. Cost summary — SUPERSEDED (research chronology; operative numbers are §0 + §10 local-first ≈ €1,450–1,550)

| | Item | € |
|---|---|---|
| Core | Tab A11+ 5G + DS2278 kit + rugged case | ~505 |
| Connectivity | Prepaid data SIM (Epic 8GB/28d) | ~10/mo |
| Essential kit | Trolley 250 kg (local) + powerbank | ~140 |
| Labels | ZD230t + ribbon/PP stock (or defer; DYMO trap avoided) | ~242+media |
| Optional | NIIMBOT bin labeler ~€55 · ring scanner experiment €50–80 · Stanley folding van truck · 4G MiFi ~€56 if SIM-in-tablet isn't enough | per pick |
| Software | POS Lite free · iPacky free tier · EasyScan $9.99/mo when barcode ops start · Shopify Payments online (already eligible) | ~$10/mo |

Core + essentials ≈ **€645–650** — inside envelope. With label printer ≈ €890 (flag: printer was scoped as add-on).

## 12. Community verdicts (holistic judge, cross-referencing 7 evidence sweeps)

| Tier | Verdict | Core reasoning |
|---|---|---|
| Value (A11+ + Netum) | **community-pushback** | Not the parts — the 5–7-yr claim. Field report: A-series tablets "infuriatingly sluggish after a year" in exactly this inventory duty; r/GalaxyTab calls 4–6GB A-series "practically E-waste" → **verify the €279 Scan Malta unit is 8GB/128GB or the tier collapses**. Netum: fine 2–3 yrs, sealed battery, undocumented memory capacity, rides the unresolved Android HID focus-steal bug. Honest reframe: a 2–3-yr stack — or drop the tablet and run scanner + phone |
| Recommended (A11+ + DS2278) | **endorsed-with-caveats** | DS2278 = best-evidenced purchase in the shortlist ("deployed many… they last forever"; native Android integration sidesteps the HID bug class; replaceable battery; 36-mo warranty, battery 12-mo → buy a spare ~€30). Caveats: same A-series aging risk; tablet = bench station, not mobile picker; **bench-test scan-to-cart + batch upload inside the return window** (one Nov 2025 report of scans landing in search bar; zero field reports of batch mode against Shopify) |
| Rugged/Premium (S10 FE + DS2278) | **endorsed-with-caveats** | Only tablet that credibly reaches 5–7 yrs (calm owner reports, class-leading battery). Honest pitch: the ~€190 uplift buys **update runway + battery, NOT IP68** (zero field evidence IP68 matters vs vapour; segregation does). LCD glare in open-air van loading. Survival is discipline-dependent: 80–85% charge cap, never sleeping in van/chlorine garage |

**Form-factor ruling (the honest answer):** phone + scanner **first**, tablet **second** as a fixed bench
station, rugged handheld (TC21/Chainway) **never** (fleet gear, US-refurb pricing + duty, no EU warranty,
unknown updates, duplicates his phone). Across ~15 solo/small-operator threads, none runs a tablet station;
phone-only demonstrably carried a real store at hundreds of scans/week for two years — the upgrade people buy is
a scanner, not a tablet. The tablet's defensible roles: office/bench terminal, big screen for the 229-product
capture-week cleanup, keeping business off the personal phone — worth €279–469 only if he values that; any home
PC covers it free, and label printing is desktop-only regardless.

**Wearable ruling:** rings don't fit this workflow. Physics: hands-free carrying happens BETWEEN scans, not
scanning WHILE carrying — with a bucket in each hand no trigger is pressable. The praised wearables are all
fleet-tier (RS5100 ~€900, MS652+ €459, ProGlove €1,200+, payback needs hundreds of scans/shift; he does ~30–60).
Budget rings (€79) fail his own spec: 360mAh cells, charging-death failure mode, no IP/temp rating, 1-yr life;
warehouse buyers get steered off rings as "easy to break while lifting boxes" — his exact motion. Robust call:
**DS2278 in a belt holster + batch mode + platform trolley** (removes more carrying than any wearable). Ring =
€79 curiosity after a season, treated as a consumable.

**Prioritized ecosystem list (judge):**
- **Essential:** platform/convertible trolley bought locally (~€99–115) — the single highest-leverage hands-free
  purchase · laser + Avery-format **weatherproof polyester** sheets for the master-scan labels (€0–40 if any
  laser exists; sidesteps thermal fade entirely) · 4G data + the **open-POS-on-data-before-entering rule**
  (€0–120/yr) — a cold-opened POS app in a dead spot cannot transact · storage-discipline kit (lockable
  cabinet/sealed tote + desiccant in the NON-chemical garage, €40–80)
- **Strongly recommended:** DS2278 **belt holster** (€15–25) · powerbank €24–38 (van/mobile backup; garages have
  power — cradle lives on the clean-garage bench) · **spare DS2278 battery** (~€30, confirm via Sirap) · rugged
  strap case €40 (mandatory if tablet exists, moot if cut) · magnetic C-profile bin labels + location codes
  (€25–50; native Shopify bin-location field per help docs — the judge's "metafield" alternative reflects older
  community threads)
- **Nice-to-have:** Zebra ZD230t thermal-transfer printer €242 (defer until Avery-sheet reprints prove annoying;
  doubles as bin-label printer) · van phone mount + bench tablet mount (€30–60) · Netum NT-R2 ring €79 experiment
- **Skip:** DYMO/any direct-thermal-only printer for bucket labels (fades in heat, no upgrade path) ·
  TC21/Chainway handhelds · NIIMBOT/Phomemo for product labels (zero Shopify path = 246 double-entries) ·
  enterprise wearables

**Judge's operating rules (free, load-bearing):** create "Revolut"/"Cash" custom payment types BEFORE hardware
arrives; open POS on mobile data before entering the garage; record van sales same-day (unrecorded manual sales
are the top cause of the ~10% stock drift that afflicts even well-equipped stores); enable Samsung Protect
Battery (80–85%) day one; charge overnight indoors; delay major One UI updates a few months (take security
patches normally); plan Job A as **1–3 days chunked by garage** (a ~250-item anchor case took a week of
reorganizing), capturing bin locations in the same pass; first full recount in autumn, then cycle counts.

## 13. Final red-team check (2026-07-11, on the owner's chosen classic lane)

Last adversarial pass: full-thread community evidence (13 r/GalaxyTab/r/shopify threads via archive API, 6
Shopify Community threads via Discourse JSON, ~10 more via snippets) + fresh consensus searches. Verdict per
decision, strongest counter-evidence included:

| Decision | Verdict | Strongest counter-evidence, honestly |
|---|---|---|
| **Zebra DS2278 kit** | **HOLDS — strongest item in the plan** | Nobody praises it much; it wins on official status + zero complaint threads (vs Socket's years of them) + "deployed many… last forever" + replaceable battery. A wired DS2208 (~€70–90) would suffice IF he only scanned at the bench — he doesn't; cordless + batch mode is the workflow. Bonus: the cradle also does USB-wired to the tablet — Shopify's documented "most reliable" route — so bench=wired, walking=Bluetooth |
| **Classic tablet lane itself** | **HOLDS as client decision — not evidence-led, and that's fine** | Sellers at his exact scale call barcode systems "maybe overkill for only 250 items"; no harvested solo operator runs a tablet station; phone-only ran a busier store for 2 years. The €280–470 buys segregation/comfort, not measured throughput. Recorded as preference, de-risked via bench-terminal role |
| **S10 FE as longevity pick** | **HOLDS — the honest in-lane winner** | "In 6 years it's gonna be real slow… 4 years is more realistic" for heavy duty — but Shopify-app+scanner is light duty, the favourable end; owners at 2 yrs: "it's all I need"; class-leading battery is owner-measured. Premium buys updates+battery, NOT IP68 (zero field evidence it matters vs vapour) |
| **A11+ 5G as budget pick** | **WEAKEST LINK — holds only with eyes open** | The one fleet report in exactly this duty: A-series "infuriatingly sluggish after a year", "LCD screens are completely ass"; r/GalaxyTab: 4–6GB A-series = "practically E-waste" → 8GB/128GB check is mandatory; One UI majors regress budget tablets (delay them). Fine as a scan-terminal; wrong pick if "feels fast in 2031" is the bar |
| **Android (client pref) vs iPad** | **HOLDS with a caveat on record** | Dec 2025 merchant: "Do not go Android… app becomes unresponsive, card readers delete themselves" — but his pain was card readers (irrelevant here: Revolut/cash) and Shopify calls the apps functionally identical; Android takes USB peripherals, iPad doesn't. iPad's real edge is hardware longevity sentiment; client chose Android — defensible |
| **No wearables / holster+trolley instead** | **HOLDS — physics + selector guidance agree** | The FOR case (Amazon FC "2 free hands") is real but fleet-supported high-frequency work; selectors steer small buyers off rings ("easy to break while lifting boxes"). Nothing new refutes it |
| **Label chemistry (TT later, laser+polyester now, no DYMO)** | **HOLDS — consensus physics** | No counter-evidence found; direct-thermal fade in heat is multi-community consensus |
| **Software spine (POS Lite custom tenders, EasyScan-class app, no Stocky)** | **HOLDS with one honest gripe on record** | "I regret switching to Shopify POS… inventory management is way too barebones for what they charge" (r/ShopifyeCommerce) — true, and exactly why the plan assumes an EasyScan-class app on top; admin app takes no BT scanner input (POS app / web admin / third-party app only); native camera scanner increments only → van sales go through POS custom tender or Draft Orders, as planned |

**The one genuinely weak evidence point in the whole plan:** DS2278 + Shopify POS on Android scan-to-cart has
ZERO positive first-person reports found (the endorsement rests on official support + absence of complaints),
and one Nov 2025 Android merchant reports scans landing in the search bar instead of the cart (scanner brand
unknown). Mitigations already in plan and now non-negotiable: **bench-test scan-to-cart + batch upload inside
the return window, before the 246-SKU capture**; fallback exists (cradle USB-wired mode — the documented most
reliable route; or scan into EasyScan-class app instead of POS). This is a test-first gate, not a reason to
change the pick.

## Unresolved questions

- Netum NT-1228BL memory-mode capacity (undocumented) — bench-test in return window.
- DS2278 exact batch buffer size; DS22xx 3-yr warranty terms via Sirap (unverified).
- EasyScan mid-tier price ($24.99 vs $39.99 sources conflict).
- Current Revolut Reader Malta price (2024 launch price €49; page now 404s).
- SumUp Malta per-transaction fee.
- Zebra TC21/26 Android security-update end date (if the handheld lane is ever pursued).
- Magnetic label holder + van mount exact landed prices (amazon.de bot-gated).
- Klikk Tab A11+ price (listing live, price not captured).
- S10 FE verifier ran without the safety-classifier cross-check (noted in run diagnostics); its claims matched
  independent sources but re-confirm the €469 Scan Malta price at purchase.
