# Barcode Lookup API — is it worth buying?

**TLDR:** Yes, for any real catalogue run. On an identical 44-code set, the paid API found **+13 product
photos (14 → 27, +93%)**, **+5 identifications**, **zero regressions**, and it made the run **46% cheaper
in Firecrawl credits** (267 → 144) because a database hit short-circuits the paid image search. One month
of **Starter ($99, 5,000 calls)** covers SplashStore's whole 229-product catalogue ~35× over; plans are
month-to-month, so buy one month, run everything, cancel.

## Method

Same 44 lookupable GTINs (51 scanned codes, deduplicated), same engine
(`projects/pet-centre-catalog/resolve-images.py`), same day, run from scratch in parallel:

- **Arm A — free cascade:** `BARCODELOOKUP_API_KEY` unset. Free DBs + Firecrawl only.
- **Arm B — paid cascade:** key set. Barcode Lookup is Tier-0 and short-circuits the rest on a hit.

## Results

| metric | A: free | B: + Barcode Lookup | delta |
|---|---:|---:|---:|
| products identified | 28 | **33** | +5 |
| with product photo | 14 | **27** | **+13 (+93%)** |
| Firecrawl credits burned | 267 | **144** | **-123 (-46%)** |
| Barcode Lookup calls metered | 0 | 27 | +27 |
| photos found ONLY by that arm | **0** | 13 | — |

**Zero regressions.** Every photo the free cascade found, the paid arm also found. The paid API is
strictly additive here, which is the cleanest possible result for a buy decision.

**It costs LESS to run, not more.** A Tier-0 hit skips the Firecrawl image search and page scrapes, so
the paid arm burned 46% fewer credits. The API fee is partly offset by lower scraping spend — and on a
9,817-product run that offset is the difference between one Firecrawl plan tier and the next.

Photos only the paid API could supply (12 of 13 shown): Darlly SC705 / C-4401 / SC750 / SC713 spa filters,
hth Stabilizer 3kg, Cristal Randreiniger, SpaBalancer UltraShock, Pool Gom, HTH Spa 1L, Salinen pool salt,
Aiper Scuba S3, Aiper Scuba L1. Note the pattern: **hardware and chemicals**, exactly the non-food goods
the free open databases barely cover.

## The bigger reason: variance

The free cascade is **not reproducible**. Its identity depends on which pages a web search returns that
minute. Three separate free runs over the same 44 codes produced **41, 28 and 33** identifications. A
barcode-database lookup is deterministic: it hits or it does not.

For a catalogue you intend to sell from, that reproducibility matters more than the raw +13. It is the
difference between "run it once, review it" and "run it repeatedly and union the results", which is what
the free-only path forced today.

## Economics

Live pricing (barcodelookup.com/api, checked 2026-08-16), month-to-month, no contract:

| plan | calls | price |
|---|---:|---:|
| Starter | 5,000 | $99 / mo |
| Advanced | 25,000 | $249 / mo |
| Professional | 100,000 | $499 / mo |
| Enterprise | 500,000 | $949 / mo |

Only successful (HTTP 200 with data) calls meter — **404 misses are free**, verified empirically. Measured
hit rate on this stock: **27 metered calls / 44 codes = 61%**.

Projected metered calls at that rate:

| catalogue | products | est. calls | cheapest plan |
|---|---:|---:|---|
| SplashStore garage (this batch) | 44 | 27 | free trial covers it |
| SplashStore full | ~229 | ~140 | Starter $99 (uses 3% of it) |
| Pet Centre (Hike) | 9,817 | ~6,000 | Advanced $249 |
| both, one month | ~10,050 | ~6,140 | **Advanced $249, then cancel** |

**Recommendation:** one month of **Advanced ($249)** clears both catalogues at once with headroom, then
cancel. If only SplashStore matters, **Starter ($99)** is ~35× more than needed. Do not run either
catalogue on the current free trial: it is **50 calls per month**, which this single 44-code experiment
has already spent 39 of.

## Caveats worth knowing

- **The API supplies images, not better names.** Identifications rose only +5, and its titles are
  transliterated/ASCII-stripped ("Flssig", "Kartuov Filter") and thinner than a manufacturer or shop
  page's. The engine was fixed on 2026-08-16 so a nameless row still harvests the better name from the
  barcode directories even when the API supplies the photo; without that fix the paid arm *degrades* 5 of
  10 names.
- **It carries no ingredients**, and its dimensions are shipping weights — the engine ignores both.
- **Buying it does not fix the 3 unidentified codes** (`5061066600127`, `5292638000759`, `9008748095532`);
  the API 404s on all three. Nor the 7 non-barcodes (GS1 serial captures + supplier codes), which need
  re-scanning off the packaging.

## Unresolved

- Hit rate is measured on 44 pool/spa items. Pet Centre's mix (pet food, toys, accessories) may differ;
  the 61% is a planning figure, not a guarantee.
- Firecrawl credit unit cost was not verified, so the "cheaper to run" claim is stated in credits, not
  dollars.
