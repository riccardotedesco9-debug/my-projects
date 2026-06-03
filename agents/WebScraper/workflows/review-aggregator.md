# Review Aggregator

Pull reviews for a product, service, or place from multiple sources, synthesize into a balanced summary with evidence links.

## Inputs

- **Target**: product / service / restaurant / hotel / software
- **Sources**: auto-pick based on target type, or specify:
  - Products → Amazon, Reddit, YouTube (descriptions + top comments), manufacturer site
  - Restaurants/hotels → Google, TripAdvisor, local blogs
  - Software → G2, Capterra, Reddit, Hacker News, Trustpilot
- **Depth**: quick (top 20 reviews per source) or thorough (100+)

## Approach

1. **Firecrawl `search`** to find authoritative review pages.
2. **Scrape review sections** with schema extract (not full-page content).
3. For Reddit: target specific subreddit threads, not the site root.
4. Dedupe near-identical reviews (likely fake).
5. Claude synthesizes — does NOT just average stars. Look for patterns, specific complaints, praise themes.

## Extraction schema

```json
{
  "reviews": [
    {
      "source": "string",
      "rating": "number",
      "rating_scale": "number",
      "title": "string",
      "body": "string",
      "verified_purchase": "boolean",
      "date": "string",
      "reviewer": "string",
      "helpful_votes": "number",
      "url": "string"
    }
  ]
}
```

## Output

Markdown report in the current project folder:

```
# {Target} — Review Synthesis

## Verdict
Claude's balanced take in 2-3 sentences.

## Consensus strengths
- Theme 1 — cited by X/Y sources
- Theme 2 — ...

## Consensus weaknesses
- Theme 1 — cited by X/Y sources
- Theme 2 — ...

## Polarizing points
Things reviewers split hard on.

## Red flags
Specific complaints that recur across sources (not one-offs).

## Evidence
Links to notable reviews per theme.

## Source distribution
| Source | N reviews | Avg rating | Notes |
```

## Common pitfalls

- Amazon reviews have fake-review infestation on certain product categories — weight Reddit/forum reviews higher for these.
- Ratings are not comparable across platforms (5-star distributions differ) — use qualitative themes, not numerical averages, for the verdict.
- Recency matters: a 2022 review of a frequently-updated SaaS product is near-useless.
- Paid reviews: flag suspicious patterns (all 5-star within a week, identical language).

## Example invocation

> "Run review-aggregator: Notion as a team wiki. Sources: G2, Reddit r/Notion + r/productivity, Trustpilot. Depth: thorough."
