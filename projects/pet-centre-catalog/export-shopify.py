#!/usr/bin/env python
"""Export the enriched catalogue as a Shopify product-import CSV (step 7, Shopify clients).

WHAT THIS IS. The engine's own artifacts are a Hike-shaped xlsx and a human curation workbook. A
client on Shopify (or Shopify POS, which sells the same product records) needs the catalogue in
Shopify's import schema instead. This writes that CSV from the SAME three engine outputs the
workbook is built from, so both artifacts always agree.

COLUMN NAMES ARE THE CURRENT ONES. Shopify renamed much of this schema; older exports and most
blog posts are stale and will silently fail to map. Verified against
help.shopify.com/en/manual/products/import-export/using-csv (2026-08):
  `URL handle` (not Handle) · `Description` (not Body (HTML)) · `Product image URL` (not Image Src)
  `Weight value (grams)` (not Variant Grams) · `Published on online store` (not Published)
  `SEO title` / `SEO description` · `Barcode` · `Charge tax` · `Continue selling when out of stock`
Only `Title` is strictly required (plus `URL handle` when updating or adding variants).

THE ACCURACY RULE STILL APPLIES. Every header the client asked for is present, but a cell is filled
ONLY from data the engine confirmed. Nothing is inferred to look complete:
  - Price, Compare-at price and Cost per item are left blank — pricing is the owner's decision.
  - SKU is GENERATED (<BRAND>-<TYPE>-<last 4 of GTIN>) and stable across re-runs, so re-scanning a
    product later yields the same shelf code instead of renumbering.
  - Inventory quantity is a placeholder (DEFAULT_INVENTORY), per the owner: a real stocktake replaces it.
  - Vendor and Type ARE derived, but only from a brand/category word appearing LITERALLY in the
    barcode-confirmed name, via an explicit allowlist. Never "take the first word" — a wrong vendor
    in a live shop is exactly the false confidence the engine exists to prevent. No match, no value.
  - SEO title / SEO description are left EMPTY on purpose: Shopify already falls back to Title and
    Description, so writing a truncated copy duplicates the row and goes stale the moment the Title
    is edited. A real SEO title is a keyword decision, which is the owner's.
  - `Tags` carries three kinds: CATEGORY (words literally in the confirmed name), WORKFLOW (what the
    engine can prove about completeness), and one FUNNEL role derived from Product Type. The funnel
    taxonomy was delegated by the owner and is a starting set — see FUNNEL_BY_TYPE; rename freely,
    nothing downstream depends on those strings.
  - Every product is written `draft` and unpublished, so an import can never put an unreviewed row
    in front of a customer.

IMAGES. Shopify DOWNLOADS `Product image URL` at import time and re-hosts it, so a normal public
retailer URL works here — unlike a Sheets `=IMAGE()`, whose anonymous fetcher those hosts refuse.
Nothing needs re-hosting first. (Shopify rejects URLs containing `_thumb`/`_small`/`_medium`.)

FACEBOOK / META. There are no Facebook columns in this schema, in Malta or anywhere. The Meta sales
channel syncs from the Shopify catalogue itself, so a correct catalogue is the whole job. The
`Google Shopping / *` columns exist but Shopify's own docs say to ignore them unless an app asks.

Usage:
  python export-shopify.py --rows rows.json --desc desc.json --img img.json --out products.csv
"""
import argparse
import csv
import json
import re
import unicodedata

# Current Shopify product CSV headers, in export order. Dimension metafields are appended last:
# Shopify has no native D/W/H columns, and `dimension` is a supported metafield type ("25.0cm").
HEADERS = [
    "URL handle", "Title", "Description", "Vendor", "Product category", "Type", "Tags",
    "Published on online store", "Status",
    "Option1 name", "Option1 value",
    "SKU", "Barcode",
    "Price", "Compare-at price", "Cost per item", "Charge tax",
    "Inventory tracker", "Inventory quantity", "Continue selling when out of stock",
    "Weight value (grams)", "Weight unit for display", "Requires shipping", "Fulfillment service",
    "Product image URL", "Image position", "Image alt text", "Gift card",
    "SEO title", "SEO description",
    "Collection",
    "Ingredients (product.metafields.custom.ingredients)",
    "Depth (product.metafields.custom.depth)",
    "Width (product.metafields.custom.width)",
    "Height (product.metafields.custom.height)",
]

SEO_TITLE_MAX = 70    # Shopify truncates beyond this
SEO_DESC_MAX = 320
ALT_MAX = 125         # optimal alt-text length (hard cap is 512)
DEFAULT_INVENTORY = "999"   # owner's instruction: stock everything at 999 until a real stocktake


def handle_for(title, barcode, seen):
    """URL handle: lowercase letters/numbers/dashes only, unique across the file. The barcode is the
    tiebreaker because it is the one globally-unique thing a scanned row owns."""
    base = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()[:80] or "product"
    h = base
    if h in seen and barcode:
        h = f"{base}-{barcode}"
    n = 2
    while h in seen:
        h = f"{base}-{n}"
        n += 1
    seen.add(h)
    return h


# ============================== VERTICAL KNOBS (swap per catalogue) ==============================
# CATEGORY_TAGS, PRODUCT_TYPES, BRANDS and SHOPIFY_CATEGORY below are the ONLY pool/spa-specific
# things in this file; everything else is vertical-agnostic. Pointing the engine at a different
# catalogue (food, pet, hardware) means replacing these four tables and nothing else.
#   FOOD in particular: keep the Ingredients metafield above (it becomes the important column, and a
#   legal one), set the engine's EDIBLE_TYPE regex in resolve-images.py so composition is actually
#   fetched, and swap the barcode DB — OpenPetFoodFacts is pet-food-only; human food is
#   world.openfoodfacts.org, same API shape. Shopify's food categories live under `fb-*` in the
#   taxonomy (Food, Beverages & Tobacco), not `hg-18-*`.
# See docs/engine-briefing.md -> "Adapting to a NEW catalogue".
# =================================================================================================

# Category tags, keyed to words that must appear LITERALLY in the barcode-confirmed product name.
# This is classification from evidence, not interpretation: if the confirmed name says "filter
# cartridge", tagging it `filters` states nothing the source doesn't. Multilingual because the
# confirming page is often a German, French, Italian or Spanish retailer.
# NOT in here: funnel / lifecycle / margin / bundle tags. Those are positioning decisions about how
# the shop sells, which no amount of product data can derive — the owner supplies that taxonomy.
CATEGORY_TAGS = {
    "filters": r"filter|cartridge|cartouche|kartu|filtre|lamellenfilter|ersatzfilter",
    "spa-hot-tub": r"\bspa\b|hot ?tub|whirlpool|jacuzzi|gonflable",
    "pool": r"\bpool|piscin|basen|bazen|schwimmbad",
    "water-treatment": r"chlor|brom|\bph\b|alkal|stabilizer|clarifier|clear|floc|algic|algae|"
                       r"shock|oxygen|peroxid|multitab|tabs?\b|granulat|desinfekt|sanitis|sanitiz",
    "cleaning": r"clean|reiniger|nettoyant|randfix|randreinig|scrub|brosse|b[uü]rste|eraser|gom",
    "robot-cleaner": r"robot|aiper|scuba|wet ?runner|sesalnik|aspirador",
    "test-measure": r"test|reagenz|photometer|dpd|phenol|messer|tester",
    "salt": r"\bsalt\b|salz|sel\b|sol\b|salin",
    "accessories": r"pillow|podushka|cover|hose|adapter|valve|ventil|connector",
}


# Product Type, matched against the barcode-confirmed name. Ordered MOST SPECIFIC FIRST — a robot
# cleaner also says "pool", and a filter cartridge also says "spa", so first match wins. Same evidence
# standard as the tags: the word is literally in the confirmed name, so the label restates the source
# rather than interpreting it. Shopify's `Type` is a free-text label (unlike `Product category`, which
# must come from Shopify's taxonomy and is therefore left blank).
PRODUCT_TYPES = [
    (r"robot|aiper|scuba|wet ?runner|sesalnik|aspirador",            "Pool robot cleaner"),
    (r"filter|cartridge|cartouche|kartu|filtre|lamellenfilter",      "Filter cartridge"),
    (r"test|reagenz|photometer|\bdpd\b|phenol|tester",               "Water test kit"),
    (r"\bsalt\b|salz|\bsel\b|\bsol\b|salin",                         "Pool salt"),
    (r"chlor|brom|\bph\b|alkal|stabilizer|clarifier|floc|algic|"
     r"algae|shock|oxygen|peroxid|multitab|granulat|desinfekt",      "Pool chemical"),
    (r"clean|reiniger|nettoyant|randfix|randreinig|scrub|brosse|"
     r"b[uü]rste|eraser|\bgom",                                      "Pool cleaning product"),
    (r"\bspa\b|hot ?tub|whirlpool|jacuzzi|gonflable",                "Inflatable spa"),
    (r"airbed|mattress|matelas|pillow|podushka|luftbett",            "Airbed / lounger"),
    (r"\bpool|piscin|basen|schwimmbad",                              "Pool equipment"),
]

# Brands seen in this catalogue, matched as whole words in the confirmed name. An ALLOWLIST, never
# "take the first word" — that would invent a vendor on any row whose name starts with a noun, and a
# wrong vendor in a live shop is exactly the false confidence the engine exists to prevent.
BRANDS = [
    (r"\bintex\b", "Intex"), (r"\bbestway\b|flowclear", "Bestway"), (r"\bdarlly\b", "Darlly"),
    (r"\bbayrol\b", "Bayrol"), (r"\bhth\b", "hth"), (r"astral ?pool", "AstralPool"),
    (r"\baiper\b", "Aiper"), (r"spa ?balancer", "SpaBalancer"), (r"bayzid|h[oö]fer", "Höfer Chemie"),
    (r"steinbach", "Steinbach"), (r"\bgre\b", "Gre"), (r"cristal", "Cristal"),
    (r"aquality", "Aquality"), (r"salinen|salzwelten", "Salinen"), (r"estelle", "Estelle"),
    (r"pool ?gom", "Pool'Gom"), (r"\bways\b", "WAYS"), (r"water-?i\.?d|water ?id", "Water-i.d."),
    (r"rising dragon", "Rising Dragon"), (r"\beago\b", "EAGO"),
]


# Shopify Standard Product Taxonomy ids, keyed by the Type label above. Verified against
# Shopify/product-taxonomy dist/en/categories.txt (2026-08) — NOT guessed, because this column drives
# US tax calculation and an invented breadcrumb either fails the import or taxes the product wrongly.
# Sending the id (`hg-18-1-3-1`) rather than the breadcrumb, since ids are stable across renames.
# Water test kits map to the PARENT accessories category on purpose: the taxonomy has no pool
# test-kit leaf, and "Pool Cleaners & Chemicals" would misfile a reagent as a treatment chemical.
SHOPIFY_CATEGORY = {
    "Filter cartridge":      "hg-18-1-3-1",   # Pool & Spa Accessories > Pool & Spa Filters > Filter Cartridges
    "Pool chemical":         "hg-18-1-7",     # Pool Cleaners & Chemicals
    "Pool salt":             "hg-18-1-7",     # Pool Cleaners & Chemicals
    "Pool cleaning product": "hg-18-1-7",     # Pool Cleaners & Chemicals
    "Pool robot cleaner":    "hg-18-1-16",    # Pool Sweeps & Vacuums
    "Water test kit":        "hg-18-1",       # Pool & Spa Accessories (no test-kit leaf exists)
    "Inflatable spa":        "hg-18-4",       # Pool & Spa > Spas
    "Airbed / lounger":      "hg-18-1-11",    # Pool Floats & Loungers
    "Pool equipment":        "hg-18-1",       # Pool & Spa Accessories
}

# A mass stated in the confirmed name, e.g. "hth STABILIZER Granulat 3,0 kg", "Sack (25 kg)".
# Comma decimals are normal on the German/French pages that confirm these codes.
# VOLUME IS NOT WEIGHT: "Bayrol Randfix 0,7 l" is deliberately not matched — converting litres to
# kilograms assumes a density nobody stated, and Shopify uses this field for real shipping cost.
_MASS = re.compile(r"(?<![\d.,])(\d{1,4}(?:[.,]\d{1,3})?)\s*(kg|kilo(?:gram)?s?|g|gram(?:me)?s?)\b",
                   re.IGNORECASE)
# Two dimensions in cm, e.g. "10.6 x 13.6 cm". Only the two-number form is parsed: a three-number
# string ("99x191x25 cm") has no reliable axis order across vendors, and silently mapping it to the
# wrong axis is worse than leaving it blank for a human.
_TWO_DIM = re.compile(r"(?<![\d.,])(\d{1,3}(?:[.,]\d{1,2})?)\s*[x×]\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*cm\b",
                      re.IGNORECASE)


def _num(s):
    return float(str(s).replace(",", "."))


def mass_from_name(name):
    """Grams stated literally in the name, else ''. Ignores anything under 1 g or over 200 kg as a
    mis-parse (a '3' in a model code followed by 'g' elsewhere)."""
    m = _MASS.search(name or "")
    if not m:
        return ""
    try:
        value = _num(m.group(1))
    except ValueError:
        return ""
    grams = value * 1000 if m.group(2).lower().startswith(("kg", "kilo")) else value
    return str(round(grams)) if 1 <= grams <= 200_000 else ""


def dims_from_name(name):
    """(width_cm, height_cm) when the name states exactly two cm measurements, else ('', '').
    Matches the axis convention the description writer already uses for the same strings."""
    m = _TWO_DIM.search(name or "")
    if not m:
        return "", ""
    try:
        return f"{_num(m.group(1))}cm", f"{_num(m.group(2))}cm"
    except ValueError:
        return "", ""


# Existing storefront collections, matched against the confirmed name. MOST SPECIFIC FIRST — a
# branded spa accessory must beat the generic spa rule, and a filter must beat "pool".
# Two hard constraints from Shopify's CSV import, both respected here:
#   1. A product can be added to exactly ONE collection via the Collection column. So this picks the
#      single best home; add a product to further collections in admin afterwards.
#   2. If the target is an AUTOMATED collection, the product must satisfy its conditions or the
#      assignment is ignored — the CSV cannot override a smart collection's rules.
# Titles must match the storefront exactly; a title that does not exist CREATES a new collection,
# which is how a catalogue quietly grows duplicate collections. No match -> blank, on purpose.
COLLECTIONS = [
    (r"(?=.*\bintex\b)(?=.*(?:pillow|podushka|headrest|cover|seat|bench|cup ?holder|accessor))",
     "Intex Pure Spa Accessories"),
    (r"(?=.*\bintex\b)(?=.*(?:\bspa\b|hot ?tub|whirlpool|gonflable))", "Intex Hot Tubs"),
    (r"(?=.*(?:lay-?z|bestway))(?=.*(?:\bspa\b|hot ?tub))",            "Lay-Z Spa Accessories"),
    (r"dosier|floater|dispenser|schleuse|doseur",                      "Chlorine Floaters"),
    (r"filter|cartridge|cartouche|kartu|filtre|lamellenfilter|ersatzfilter",
     "Filter cartridges and filter media for water pumps"),
    (r"robot|aiper|scuba|wet ?runner|sesalnik|aspirador|vacuum|sweeper",
     "Pool Cleaning Equipment"),
    (r"clean|reiniger|nettoyant|randfix|randreinig|scrub|brosse|b[uü]rste|eraser|\bgom",
     "Pool Cleaning Equipment"),
    (r"chlor|brom|\bph\b|alkal|stabilizer|clarifier|floc|algic|algae|shock|oxygen|peroxid|"
     r"multitab|granulat|desinfekt|\bsalt\b|salz|salin",               "Water Chemicals and Chlorine"),
    (r"airbed|mattress|matelas|luftbett|downy",                        "Inflatable Beds and Mattresses"),
    (r"test|reagenz|photometer|\bdpd\b|phenol|tester",                 "Pool Accessories"),
    (r"\bspa\b|hot ?tub|whirlpool|jacuzzi",                            "Hot Tubs"),
    (r"\bpool|piscin|basen|schwimmbad",                                "Pool Accessories"),
]


# Funnel role, derived from Product Type. Riccardo delegated the taxonomy ("see for yourself"), so this
# is a STARTING SET built on the one commercial fact the data does support: how often an item is bought.
#   repeat-purchase   — consumed and replaced on a cycle (chemicals, salt, filter cartridges). The
#                       reorder/subscription/bundle audience.
#   considered-purchase — high ticket, researched before buying (spas, robot cleaners, airbeds).
#   add-on            — low ticket, bought alongside something else (brushes, test kits, fittings).
# Rename or re-map freely; nothing downstream depends on these exact strings.
FUNNEL_BY_TYPE = {
    "Filter cartridge":      "repeat-purchase",
    "Pool chemical":         "repeat-purchase",
    "Pool salt":             "repeat-purchase",
    "Pool cleaning product": "add-on",
    "Water test kit":        "add-on",
    "Pool equipment":        "add-on",
    "Pool robot cleaner":    "considered-purchase",
    "Inflatable spa":        "considered-purchase",
    "Airbed / lounger":      "considered-purchase",
}

# Shopify's `Type` -> a 3-letter SKU segment. Short, stable, and readable on a shelf label.
SKU_TYPE = {
    "Filter cartridge": "FIL", "Pool chemical": "CHM", "Pool salt": "SLT",
    "Pool cleaning product": "CLN", "Water test kit": "TST", "Pool robot cleaner": "ROB",
    "Inflatable spa": "SPA", "Airbed / lounger": "BED", "Pool equipment": "EQP",
}


def sku_for(vendor, ptype, barcode, seen):
    """Readable internal SKU: <BRAND>-<TYPE>-<last 4 of GTIN>, e.g. DAR-FIL-2406.

    Built from the barcode tail rather than a counter so it is STABLE — re-running the pipeline, or
    re-scanning this product in a year, produces the same SKU instead of renumbering the shelf.
    A SKU is not the barcode: Shopify keeps them separate (barcode = the manufacturer's GTIN for the
    scanner, SKU = the shop's own code), so this stays short and human-readable.
    """
    brand = re.sub(r"[^A-Z0-9]", "", (vendor or "GEN").upper())[:3] or "GEN"
    kind = SKU_TYPE.get(ptype, "GEN")
    tail = re.sub(r"\D", "", barcode or "")[-4:] or "0000"
    base = f"{brand}-{kind}-{tail}"
    sku, n = base, 2
    while sku in seen:            # same brand+type+tail on two codes: suffix rather than collide
        sku = f"{base}-{n}"
        n += 1
    seen.add(sku)
    return sku


def first_match(name, table):
    """First (pattern, label) whose pattern appears in the confirmed name. '' when none match —
    blank is the correct answer when there is no evidence, not a guess."""
    for pattern, label in table:
        if re.search(pattern, name or "", re.IGNORECASE):
            return label
    return ""


def tags_for(row, rec, has_image, ptype=""):
    """Tags Shopify can filter and group on. Two kinds, both factual:

    CATEGORY — matched against words literally present in the barcode-confirmed name (see
    CATEGORY_TAGS). Safe because the evidence is the same confirmed string the Title comes from.
    WORKFLOW — what the engine can prove about the row's completeness, so a human can filter the
    catalogue by what still needs doing.

    Funnel / marketing tags are deliberately NOT invented here — that is positioning, the owner's
    call. Add them in the sheet's Tags cell, or hand over the taxonomy and it can be applied in bulk.
    Shopify wants letters, numbers and hyphens only, comma-separated.
    """
    name = (row.get("clean") or "").lower()
    tags = [tag for tag, pat in CATEGORY_TAGS.items() if re.search(pat, name, re.IGNORECASE)]
    funnel = FUNNEL_BY_TYPE.get(ptype)
    if funnel:
        tags.append(funnel)

    conf = (rec.get("confidence") or "")
    if conf.startswith("verified"):
        tags.append("barcode-verified")
    if len(row.get("name_sources") or []) >= 2:
        tags.append("multi-source-confirmed")
    if not has_image:
        tags.append("needs-photo")
    if not name.strip():
        tags.append("needs-identification")
    tags.append("needs-review")          # nothing here has been seen by a human yet
    tags.append("scanned-stock")
    return ", ".join(tags)


def grams(weight_kg):
    """Shopify wants integer grams. Only emit when the engine actually extracted a weight."""
    try:
        g = round(float(weight_kg) * 1000)
        return str(g) if g > 0 else ""
    except (TypeError, ValueError):
        return ""


def dim(value):
    """A `dimension` metafield value, e.g. '25.0cm'. Blank when the engine found no stated size."""
    try:
        v = float(value)
        return f"{v}cm" if v > 0 else ""
    except (TypeError, ValueError):
        return ""


def clip(text, limit, ellipsis=True):
    """Trim to a word boundary. `ellipsis=False` for SEO titles: Shopify wants those alphanumeric,
    and a trailing '…' both breaks that and spends a character to say nothing."""
    t = " ".join((text or "").split())
    if len(t) <= limit:
        return t
    cut = t[: limit - (1 if ellipsis else 0)].rsplit(" ", 1)[0]
    return cut + "…" if ellipsis else cut


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--desc", required=True)
    ap.add_argument("--img", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    rows = json.load(open(a.rows, encoding="utf-8"))
    desc = json.load(open(a.desc, encoding="utf-8"))
    img = json.load(open(a.img, encoding="utf-8"))

    seen, seen_sku, out, skipped = set(), set(), [], 0
    for r in rows:
        title = (r.get("clean") or r.get("name") or "").strip()
        if not title:
            skipped += 1      # Title is the one required column; an unidentified row cannot be a product
            continue
        key = str(r["row"])
        d = desc.get(key, {}) or {}
        rec = img.get(key, {}) or {}
        image = rec.get("url") or ""
        body = (d.get("description") or "").strip()
        ptype = (r.get("type") or "").strip() or first_match(title, PRODUCT_TYPES)
        vendor = (r.get("brand") or "").strip() or first_match(title, BRANDS)
        # The page-grounded extraction wins; the name is the fallback when the page stated nothing.
        weight = grams(d.get("weight")) or mass_from_name(title)
        nw, nh = dims_from_name(title)

        out.append({
            "URL handle": handle_for(title, r.get("barcode", ""), seen),
            "Title": title,
            "Description": body,
            # Brand/type from evidence in the confirmed name; the POS export's own value wins
            # when it has one (a scanned row has none).
            "Vendor": vendor,
            "Product category": SHOPIFY_CATEGORY.get(ptype, ""),
            "Type": ptype,
            "Tags": tags_for(r, rec, bool(image), ptype),
            "Published on online store": "false",
            "Status": "draft",
            "Option1 name": "Title",
            "Option1 value": "Default Title",
            "SKU": sku_for(vendor, ptype, r.get("barcode", ""), seen_sku),
            "Barcode": r.get("barcode", ""),
            "Price": "",
            "Compare-at price": "",
            "Cost per item": "",
            "Charge tax": "true",
            "Inventory tracker": "shopify",
            # Placeholder stock so the products are sellable the moment they go active;
            # the real count comes from the owner's own stocktake.
            "Inventory quantity": DEFAULT_INVENTORY,
            "Continue selling when out of stock": "deny",
            "Weight value (grams)": weight,
            "Weight unit for display": "kg",
            "Requires shipping": "true",
            "Fulfillment service": "manual",
            "Product image URL": image,
            "Image position": "1" if image else "",
            "Image alt text": clip(title, ALT_MAX) if image else "",
            "Gift card": "false",
            # Left BLANK on purpose. Shopify already falls back to Title / Description when these are
            # empty, so writing a truncated copy duplicates the row and creates a staleness trap: edit
            # the Title later and the stale SEO copy silently OVERRIDES it in search results. A useful
            # SEO title is a keyword decision, not a truncation — the owner fills these.
            "SEO title": "",
            "SEO description": "",
            # Empty for non-edibles; the engine fills it for food/treats, where the full
            # composition is a legal requirement on the listing, not a nice-to-have.
            # Maps into the storefront's EXISTING collections; blank when no rule matches,
            # because inventing a title would create a brand-new collection on import.
            "Collection": first_match(title, COLLECTIONS),
            "Ingredients (product.metafields.custom.ingredients)": (d.get("ingredients") or "").strip(),
            "Depth (product.metafields.custom.depth)": dim(d.get("depth")),
            "Width (product.metafields.custom.width)": dim(d.get("width")) or nw,
            "Height (product.metafields.custom.height)": dim(d.get("height")) or nh,
        })

    # UTF-8 + LF, per Shopify's file requirements.
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS, lineterminator="\n")
        w.writeheader()
        w.writerows(out)

    filled = lambda col: sum(1 for r in out if r[col])
    print(f"Shopify CSV -> {a.out}  ({len(out)} products, {skipped} unidentified rows skipped)")
    print(f"  barcode {filled('Barcode')} | image {filled('Product image URL')} | "
          f"type {filled('Type')} | category {filled('Product category')} | vendor {filled('Vendor')} | "
          f"collection {filled('Collection')} | "
          f"description {filled('Description')} | weight {filled('Weight value (grams)')} | "
          f"dims {sum(1 for r in out if r['Depth (product.metafields.custom.depth)'] or r['Width (product.metafields.custom.width)'] or r['Height (product.metafields.custom.height)'])}")
    print(f"  SKU generated, inventory placeholder {DEFAULT_INVENTORY}; "
          f"price left blank — pricing is the owner's decision, not an engine fact.")
    print("  All rows written status=draft, published=false.")


if __name__ == "__main__":
    main()
