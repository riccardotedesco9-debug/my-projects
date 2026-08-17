# Fact check: Hörbal prospect deck, adversarial verification pass

**TLDR:** 218-row claim ledger, 36 internal arithmetic checks, 14 adversarial Firecrawl agents over 206 external claims (185 confirmed, 9 refuted, 13 unconfirmed). Every refutation adjudicated against its source. Deck corrected and republished: 175 venues became 170 (3 unverifiable cut, 2 duplicates merged), 7 wrong or overstated claims fixed, all prose counts now generated from data so they cannot drift again. Deck: https://claude.ai/code/artifact/da8855ea-e222-4548-a57a-8d6b94c20afa

## Method

1. `audit-ledger.mjs` extracted 218 checkable claims from the published HTML.
2. `audit-internal.mjs` recomputed every number from first principles (margins, segment values, chart averages, count web, ranking invariants). Now includes a duplicate-name gate. Runs clean: 36/36.
3. Workflow `wf_e850fc45-be7`: 14 agents, refute-framing, URL required for CONFIRMED/REFUTED, "not found" = UNCONFIRMED, FB/IG flagged unusable. ~1.9M tokens, 322 tool calls. Full verdicts: `scratchpad/verdicts.json`.
4. Every kill adjudicated by re-reading the agent's evidence before applying (sticky-decision rule).

## Errors found and fixed

| # | Was printed | Verified truth | Fix |
|---|---|---|---|
| 1 | Hospitality page "lists €43 falling to €34.40" (38-72% above trade) | €43 = single-bottle price on product pages; hospitality wholesale runs €40.85 → €34.40 (christelshorbal.com, read 8 Aug) | Reworded; premium now 38-63% |
| 2 | Corinthia St George's NA beer €6.00 vs Heineken €4.50 | Live in-room menu INVERTS it: NA €4.50, Heineken €5.00 | Row cut; takeaway no longer claims "Maltese hotels" plural |
| 3 | HJB mocktail €7.25 | May 2026 menu PDF: €6.75/€6.75/€8.50, no €7.25 | Row now €6.75, margin 54-63% |
| 4 | Over Grain NA cocktail €14 "same as alcoholic" | Menu PDF prints no price on NA cocktails; €14 belongs to sparkling wine cocktails | Row cut, footer link removed |
| 5 | Two venues missing off the map | Geocoder lacked "Tarxien" and "San Pawl il-Bahar" | Aliases added, both pinned |
| 6 | NAAR twice (RestoBar + Malta), 5 Beans twice | Same businesses, dedupe miss | Merged; duplicate-name gate added to audit |
| 7 | "45 already sell the category" | Spa evidence is bundled pours; several proven flags failed verification | "39 already stock", flags corrected |

Venues cut as unverifiable-trading (drop, don't pad): LivWell (last trace 2021), Nature's Pantry (parent site in maintenance), Cicci Beqqi (B2B/preorders only, and not a cocktail bar). Sattva relocated San Gwann → St Paul's Bay per its own contact page. The map/prose counts moved 175 → 170, 84-of-152 → 79-of-149, all now injected from `deck-facts.json` so prose can never go stale again.

Reason lines reworded to what sources support: Carisma ("every package" → "main packages"), Colours of Malta ("26 years" → "since 1997", dropped uncited "writes the drinks spec"), Xara ("~45 venues" → "~40", own list shows 38-42), NAAR (no zero-alcohol sparkling on menu; six virgin mocktails ~€7 is what's real), Kuch Kuch (unscrapeable award swapped for verified zero-proof Fake Martini on own menu), Coffee Circus (franchise-ambiguous ownership line dropped), Cozy Corner ("nightly" false, closed Mondays), Brillace (kombucha unverifiable → proven=false, resegmented bar → cafe), Café del Mar (beach club, not hotel → corp), IK Padel (Manoel Island site gone from booking list). Knock-ladder 03 softened: "covers most premium wedding volume" (no public market-share data) → the verified statement about MCC's three exclusive caterers + four official VisitMalta planners.

## Confirmed bulletproof (all re-read 8 Aug 2026, URLs in verdicts.json)

- "7 days refrigerated after opening" verbatim on both edition pages — the deck's strongest argument stands.
- Site names zero reference customers; still/sparkling genuinely unstated; €2 deposit; sample case = shipping covered, bottles not stated free.
- Embassy: 4 mocktails at €8.00; Cisk 0.0% €5.00 vs Cisk €4.00 (same small size). Excelsior: NA cocktails €6.50. Hansa: Seedlip €45 (out of stock), Tanqueray 0.0% €20.50.
- ION Harbour Malta's only two-star; MCC's three exclusive caterers = Xara/James/Corinthia verbatim; VisitMalta's four official planners exact; Corinthia Caterers' exclusives verbatim on their page; Myoka in Hilton/Marriott/DoubleTree/Radisson; Carisma 8 sites; Good Earth sparkling botanicals on own homepage.
- All remaining 167 long-tail venues: trading, locality correct, no reputation flags.

## Unresolved questions

- Kuch Kuch's "2nd Best Cocktails, Lovin Recommends 2026" exists only on FB/IG; Lovin's article names no runner-ups. Left out of the deck; fine to say aloud as hearsay.
- Corinthia vs Xara both currently list Castello Zammitello and the Saluting Battery among their venues; one "exclusive" claim may be stale. Deck quotes Corinthia's own page; worth asking in the room.
- Good Earth's exact 2026 shop count is soft (best list is 2018); deck avoids a number.
- Ta' Detta: still only Instagram evidence; deck keeps it as a question for Christel, not a fact.
- Whether her site's 7-day/€43 lines were ever different: no Wayback snapshots exist, cannot be dated.

## Residual limits

- €25 trade price and 3-6 month open life remain founder-sourced, deck attributes them as "your" numbers.
- RAW Juice kept on June 2026 IG activity (search-snippet only) — weakest surviving entry.
- Excelsior menu PDF is dated Jan 2024 though currently served on the hotel site.
