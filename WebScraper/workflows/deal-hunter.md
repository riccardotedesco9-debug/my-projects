# Deal Hunter

Find the best price for a specific product across retailers, marketplaces, and secondary markets. Output a comparison sheet with trust signals.

## Inputs

- **Product**: exact name / model / SKU where possible
- **Condition acceptable**: new / refurbished / used
- **Budget ceiling**: hard cap
- **Region**: shipping destination (affects retailer set)
- **Sources** (default): Amazon, eBay, manufacturer direct, major regional retailers. Add specialist sites if relevant (B&H for cameras, Backmarket for refurb electronics, etc.)

## Approach

1. **Web search first** via Firecrawl `search` — surfaces current listings and sellers without needing URLs up front.
2. **Scrape the top N results** with schema extract.
3. If Amazon/eBay: hit the product search URL directly rather than relying on search results (cleaner data).
4. Cross-check prices against manufacturer MSRP (scrape official site) to flag suspicious listings.

## Extraction schema

```json
{
  "offers": [
    {
      "source": "string",
      "title": "string",
      "seller": "string",
      "price": "number",
      "currency": "string",
      "shipping": "number",
      "total_landed": "number",
      "condition": "new | refurbished | used",
      "stock": "in_stock | low | out",
      "url": "string",
      "seller_rating": "number",
      "review_count": "number",
      "warranty": "string",
      "notes": ["string"]
    }
  ]
}
```

## Output

Google Sheet columns: `Source | Seller | Condition | Price | Shipping | Total | vs MSRP | Stock | Rating | Warranty | URL | Flags`.
- `vs MSRP` = % delta from manufacturer price
- `Flags` = Claude's trust signals ("seller <95% rating", "sub-MSRP by 40% — suspicious", "no warranty stated")

Sort by `Total` ascending. Top row: MSRP reference.

## Common pitfalls

- "Too good to be true" listings are often fake sellers — low seller rating + sub-MSRP by 30%+ = flag, don't recommend.
- Refurbished pricing is meaningless without warranty terms — always capture.
- Dynamic pricing: Amazon prices move; timestamp every row.
- Import duty / VAT not in listed price — note in Flags for cross-border shopping.

## Example invocation

> "Run deal-hunter: Sony WH-1000XM5 headphones, new or refurbished, shipping to Malta, budget €300."
