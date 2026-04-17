# Property Search

Scrape property listings across portals, normalize, rank, deliver as a Google Sheet shortlist.

## Inputs (ask Riccardo before running)

- **Location**: city / area / postcode
- **Budget**: min–max price (or max rent)
- **Type**: buy or rent
- **Must-haves**: beds, baths, garden, parking, pets, furnished, etc.
- **Deal-breakers**: leasehold, no lift, specific streets
- **Sites**: default Rightmove + Zoopla + OnTheMarket (UK) / Zillow + Realtor + Redfin (US) / Idealista (ES) / Remax (MT) — confirm per location

## Approach

1. **Map each portal's search URL** — most accept query params (e.g. Rightmove `?searchLocation=...&minPrice=...`). Build one search URL per site up front.
2. **Firecrawl `scrape` with schema extract** on the search result pages. Do NOT `crawl` — too broad, pulls unrelated listings.
3. One pass per site; dedupe by address + price on Claude's side.
4. If JS-heavy results miss listings, escalate (see `docs/escalation-ladder.md`).

## Extraction schema

```json
{
  "listings": [
    {
      "title": "string",
      "address": "string",
      "price": "number",
      "price_unit": "per_month | total",
      "beds": "number",
      "baths": "number",
      "type": "string",
      "url": "string",
      "photo_url": "string",
      "agent": "string",
      "listed_date": "string",
      "notable_features": ["string"]
    }
  ]
}
```

## Output

Google Sheet with columns: `Source | Address | Price | £/bed | Beds | Type | URL | Agent | Listed | Photo | Score | Notes`.
- `Score` = Claude's rank based on must-haves / deal-breakers (1–10)
- `Notes` = flags (e.g. "leasehold 99yr", "above budget by 5%")

Share link goes to Riccardo. Sort descending by Score.

## Common pitfalls

- Rightmove rate-limits aggressive scraping — stick to result pages, avoid deep-linking into every listing unless a match scores highly.
- Prices sometimes include service charges; extraction must capture `price_unit`.
- Some portals return "from £X" for new-build ranges — flag these as estimates.

## Example invocation

> "Run property-search workflow: Valletta rentals, €1000–1500/month, 2 bed min, no ground floor, pets OK. Default MT portals."
