#!/usr/bin/env python
"""Generate warm, informative 1-2 sentence product descriptions (+ structured dimensions) via Claude Sonnet.

Batched + resumable: per-product results are keyed by worksheet row and checkpointed to OUT
(atomic write) after every batch, so a crash never re-bills completed work. Reads ANTHROPIC_API_KEY
from the environment (workspace-root `.env`: `set -a; . ../../.env; set +a`).

Each result is an object: {"description", "depth", "width", "height", "weight"} — description is prose;
depth/width/height are CENTIMETRES and weight KILOGRAMS, filled ONLY when explicitly stated for the
product (else null) so dimensions can map to Hike's native size columns without fabrication.

Optionally grounded: pass the image-resolver output as a 4th arg and any verified product carries real
product text scraped from its source page, letting the writer include accurate specifics (key
ingredient, material, dimensions) instead of staying generic.

Usage: python gen-descriptions.py <in_json> <out_json> [batch_size] [grounding_json]
"""
import json
import os
import re
import sys
import time
import urllib.request

IN = sys.argv[1]
OUT = sys.argv[2]
BATCH = int(sys.argv[3]) if len(sys.argv) > 3 else 40
GROUND_PATH = sys.argv[4] if len(sys.argv) > 4 else None
MODEL = "claude-sonnet-4-6"
KEY = os.environ.get("ANTHROPIC_API_KEY")
if not KEY:
    sys.exit("ANTHROPIC_API_KEY not set — source the workspace .env first: `set -a; . ../../.env; set +a`")

GROUND = {}
if GROUND_PATH and os.path.exists(GROUND_PATH):
    _g = json.load(open(GROUND_PATH, encoding="utf-8"))
    GROUND = {int(k): v["page_text"] for k, v in _g.items() if isinstance(v, dict) and v.get("page_text")}

# Persona comes from the catalogue profile; the default names no vertical. The old hard-coded
# "pet shop's catalog" is the same leak the vision prompt had: framing every product as a pet
# product skews the prose on any other catalogue.
def _persona():
    path = os.environ.get("CATALOG_PROFILE", "")
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f).get("persona") or "an independent shop"
        except Exception as e:
            # Same semantics as the engine: a profile that is SET but unreadable stops the run.
            # Falling back silently here while the engine refuses would run the two halves of the
            # pipeline under different vertical rules.
            sys.exit(f"CATALOG_PROFILE {path!r} unreadable: {e}")
    return "an independent shop"


SYSTEM = (
    f"You write product descriptions for {_persona()}'s catalogue. "
    "For each product you get a name, brand, and category. Write ONE to TWO short sentences that are "
    "informative FIRST (what it is, who/what it's for, the useful detail a shopper wants) and warmly, "
    "subtly playful SECOND. Keep the focus on the product. "
    "ACCURACY IS CRITICAL — false claims are worse than vague ones. ONLY state attributes that are "
    "explicitly present in the product name or are universally true of the category. Do NOT invent or "
    "guess: ingredients, 'grain-free'/'natural'/'hypoallergenic', flavours, materials, sizes, breed "
    "suitability, life-stage, or any feature not stated. If the name lacks specifics, describe the "
    "product generically by its category and stay true. When unsure, be general rather than specific. "
    "Do NOT expand or guess the meaning of cryptic abbreviations or SKU codes in the name (e.g. "
    "'Adlt Chic Pot Grfr') — if a name is heavily abbreviated or unclear, describe it generically by "
    "its category rather than inventing the full words. "
    "When a product includes source_info (real product text gathered for this item) you MUST mine it "
    "for the concrete specifics that matter and lead with them:\n"
    "  - ANY EDIBLE ITEM (food, treats, snacks, chews, bones, dental sticks, pate, milk, etc. — not just "
    "'food'): name the KEY INGREDIENT(S) or main protein — this is REQUIRED whenever the "
    "source_info states a composition/ingredients (e.g. 'chicken & rice', 'salmon', 'with glucosamine'). "
    "Do not write an edible item's description that omits the ingredient when the source gives it.\n"
    "  - ACCESSORIES / TOYS / BEDDING / HOUSING: give the DIMENSIONS/size and the MATERIAL — especially "
    "a material the source emphasises (e.g. 'heavy-duty', 'chew-proof', 'stainless steel').\n"
    "  - GADGETS / ELECTRONICS: the mechanism or key technology.\n"
    "Dimensions and ingredients are the two most important details — include them whenever present and "
    "relevant. The name itself may carry a real dimension (e.g. '6.5CM') or pack size — prefer it for "
    "size. Use ONLY facts clearly about THIS exact product; if the source text might describe a "
    "different size or variant, stay general on the uncertain detail rather than asserting it. Ignore "
    "navigation, prices, reviews, cookie notices and unrelated text, and never copy marketing fluff. If "
    "the source genuinely gives no such specifics, stay accurate and general rather than inventing any. "
    "RULES: Never name or refer to the shop, any town, or location. No fluff, no hype, no marketing "
    "cliches ('purr-fect', 'best ever', 'must have'), no emojis, no exclamation overload. Don't repeat "
    "the brand or size if it adds nothing. Vary sentence openings across products.\n"
    "PUNCTUATION: NEVER use an em dash or en dash (the long '—' / '–'); they read as machine-written and "
    "cheapen the copy. Use a comma, full stop, or 'and' instead. Also avoid hyphenated compound words "
    "unless the hyphen is genuinely standard for the term or dropping it would mislead: prefer writing "
    "'grain free', 'odour control', 'easy to clean' as separate words. Keep punctuation plain and human.\n"
    "DIMENSIONS: also extract the product's physical size as plain numbers — depth, width, height in "
    "CENTIMETRES and weight in KILOGRAMS. Give a number ONLY when that measurement is explicitly stated "
    "for THIS product or its package; otherwise null. Convert inches (x2.54), mm (/10) to cm and grams "
    "(/1000) to kg; round dimensions to one decimal and weight to three decimals. CRITICAL: a FUNCTIONAL "
    "measurement is NOT a box dimension — a "
    "collar's neck range ('15-17 in'), a garment/collar 'size 4', a screen size, or a bowl's litre "
    "capacity must leave depth/width/height null (keep that detail in the description instead). Fill only "
    "the dims actually stated (e.g. a round bed giving one '60cm' figure fills one dimension, nulls the rest).\n"
    "INGREDIENTS (any EDIBLE item — food, treats, chews, bones, dental, etc.): also populate `ingredients` "
    "with the full composition / ingredient "
    "list AND analytical constituents (protein, fat/oils, fibre, ash, moisture and any other percentages or "
    "additives), copied EXACTLY as stated in source_info — keep the real figures; do NOT invent, estimate, "
    "round or infer any value. Format readably, e.g. 'Composition: chicken 30%, rice, ... | Analytical "
    "constituents: protein 26%, fat 15%, fibre 3%, ash 7%, moisture 8%'. If the item is not edible, or "
    "source_info gives no composition, set ingredients to an empty string. Never fabricate ingredients or values.\n"
    "NO REDUNDANCY: the description and `ingredients` must not duplicate each other. The DESCRIPTION may "
    "name the headline ingredient/protein/flavour for context (e.g. 'a chicken-and-rice dry food'), but must "
    "NOT re-list the full composition or quote the analytical-constituent percentages — that exhaustive "
    "detail lives ONLY in `ingredients`. Keep the description readable prose about what the product is."
)


def _num(x, hi, decimals=1):
    """Coerce to a sane positive float in the expected unit, else None (drops junk / 0 / out-of-range)."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, decimals) if 0 < v < hi else None


def _no_dashes(text):
    """Strip em/en dashes (— –) from prose — they read as 'AI-written' and cheapen the copy. Replace with a
    comma and tidy spacing/punctuation. Regular hyphens (omega-3, grain-free) are LEFT ALONE; the prompt
    handles minimising those by judgement."""
    t = re.sub(r"\s*[‒–—―]+\s*", ", ", text or "")  # figure/en/em/horizontal-bar dashes
    t = re.sub(r"\s+-+\s+", ", ", t)                # spaced hyphen(s) used AS a dash (keeps grain-free, omega-3)
    t = re.sub(r"\s*,\s*,+", ", ", t)               # collapse any double commas the swap created
    t = re.sub(r"\s+([.,;:!?])", r"\1", t)          # no space before punctuation
    t = re.sub(r",\s*([.;:!?])", r"\1", t)          # ", ." -> "." etc.
    return re.sub(r"\s{2,}", " ", t).strip(" ,")


# Deterministic measurement extraction — the safety net under the model. Measured on the pool
# batch: 16 rows whose stored page_text plainly stated a mass ("3,0 Kg", "18kg") had weight=null,
# because extraction relied on the model alone. Regexes recover ONLY what is literally printed:
# mass for weight (never volume — litres are not kilograms), and the same conservative dimension
# forms export-shopify's name parser uses (single or two-dimension; the ambiguous "A x B x C" form
# is deliberately refused because nothing says which number is depth). Provenance lands in
# dims_src per field: "model" (LLM), "page" (regex on source text), "name" (regex on the name).
_MASS_RX = re.compile(r"(?<![\d.,])(\d{1,3}(?:[.,]\d{1,3})?)\s*(kg|g|gr)\b", re.IGNORECASE)
# A bare mass ANYWHERE in page text is very often a DIFFERENT product: related-items links, review
# strips, even image filenames all flatten into page_text (review found a 1-litre bottle shipped at
# 20 kg off a "Sea salt 20kg" sidebar link). A page mass counts only with a weight word right
# before it; the name needs no anchor but must not be a capacity ("for dogs up to 15 kg").
_MASS_ANCHOR_RX = re.compile(
    r"(?:net\s*weight|weight|contents?|inhalt|gewicht|poids|peso|contenido)\W{0,12}"
    r"(\d{1,3}(?:[.,]\d{1,3})?)\s*(kg|g|gr)\b", re.IGNORECASE)
_CAPACITY_BEFORE_RX = re.compile(
    r"(?:up\s+to|to|max\.?|bis(?:\s+zu)?|jusqu.{0,3}|fino\s+a|hasta|for)\s*$", re.IGNORECASE)
_DIM1_RX = re.compile(r"(?<![\dx.,])(\d{1,3}(?:[.,]\d)?)\s*(cm|mm)\b(?!\s*[x×])", re.IGNORECASE)
# The lookbehind on the FIRST number makes the ambiguous "99x191x25 cm" form unmatchable (99 fails
# the lookahead, 191/25 fail the lookbehind) — nothing in that string says which number is depth,
# and inventing the mapping was exactly the comment's promise this regex previously broke.
_DIM2_RX = re.compile(
    r"(?<![\dx×.,])(\d{1,3}(?:[.,]\d)?)\s*[x×]\s*(\d{1,3}(?:[.,]\d)?)\s*(cm|mm)\b(?!\s*[x×])",
    re.IGNORECASE)
# The engine writes an unambiguous "Net weight: X kg." prefix into page_text (from the OFF family);
# it previously reached only the model, which sometimes ignored it.
_NETWT_RX = re.compile(r"Net weight:\s*(\d+(?:[.,]\d+)?)\s*kg", re.IGNORECASE)


def _to_cm(v, unit):
    v = float(str(v).replace(",", "."))
    return round(v / 10.0, 1) if unit.lower() == "mm" else round(v, 1)


def _to_kg(v, unit):
    v = float(str(v).replace(",", "."))
    return round(v / 1000.0, 3) if unit.lower() in ("g", "gr") else round(v, 3)


def measure_fallback(rec, name, page_text):
    """Fill ONLY the measurements the model left null, from text that literally states them."""
    src = {}
    for f in ("depth", "width", "height", "weight"):
        if rec.get(f) is not None:
            src[f] = "model"
    if rec.get("weight") is None:
        m, origin = _NETWT_RX.search(page_text or ""), "netwt"
        if not m:
            m, origin = _MASS_ANCHOR_RX.search(page_text or ""), "page"
        if not m:
            nm = _MASS_RX.search(name or "")
            # a capacity ("for dogs up to 15 kg") is a rating, not the product's weight
            if nm and not _CAPACITY_BEFORE_RX.search((name or "")[:nm.start()]):
                m, origin = nm, "name"
        if m:
            kg = _to_kg(m.group(1), m.group(2) if m.lastindex and m.lastindex >= 2 else "kg")
            if kg and 0 < kg < 200:
                rec["weight"], src["weight"] = kg, origin
    # Dimensions come from the NAME only. Page text is flattened chrome (sidebars, review strips,
    # filenames) where a stray "0,1 x 2 cm" belongs to anything but this product — the same trap the
    # mass rung fell into. The name is confirmed/curated text, and sub-centimetre "dimensions" are
    # rejected as chrome even there.
    if rec.get("width") is None and rec.get("height") is None:
        m = _DIM2_RX.search(name or "")
        if m:
            w, h = _to_cm(m.group(1), m.group(3)), _to_cm(m.group(2), m.group(3))
            if w >= 1 and h >= 1:
                rec["width"], rec["height"] = w, h
                src["width"] = src["height"] = "name"
    if all(rec.get(f) is None for f in ("depth", "width", "height")):
        m = _DIM1_RX.search(name or "")
        if m:
            w = _to_cm(m.group(1), m.group(2))
            if w >= 1:
                rec["width"], src["width"] = w, "name"
    rec["dims_src"] = src
    return rec


def _clean_result(o):
    """Normalise one model result; tolerate a bare string (description only, no dims/ingredients)."""
    if isinstance(o, str):
        return {"description": _no_dashes(o.strip()), "depth": None, "width": None, "height": None, "weight": None, "ingredients": ""}
    if not isinstance(o, dict):
        return {"description": "", "depth": None, "width": None, "height": None, "weight": None, "ingredients": ""}
    return {
        "description": _no_dashes((o.get("description") or "").strip()),
        "depth": _num(o.get("depth"), 1000),   # cm — sanity-cap at 10 m
        "width": _num(o.get("width"), 1000),
        "height": _num(o.get("height"), 1000),
        "weight": _num(o.get("weight"), 200, 3),  # kg — sanity-cap at 200 kg; 3dp keeps gram precision
        "ingredients": (o.get("ingredients") or "").strip(),  # food/treats: full composition + macros, else ""
    }


def call(batch):
    """Return list of result objects {description, depth, width, height, weight} aligned to batch order."""
    lines = []
    for i, p in enumerate(batch):
        line = f'{i + 1}. name="{p["clean"]}" brand="{p["brand"] or "n/a"}" category="{p["type"] or "n/a"}"'
        src = GROUND.get(p["row"])
        if src:
            line += f'\n   source_info="""{src[:4500]}"""'  # headroom for full ingredient + constituents lists
        lines.append(line)
    user = (
        "For each numbered product below, return one JSON object. Return ONLY a JSON array of objects in "
        "the same order, one per product, each EXACTLY:\n"
        '{"description": "<plain-text 1-2 sentences, no quotes or labels>", "depth": <cm|null>, '
        '"width": <cm|null>, "height": <cm|null>, "weight": <kg|null>, '
        '"ingredients": "<food/treats only: full composition + analytical constituents, else empty>"}\n'
        "No extra keys, no numbering, no text outside the array.\n\n" + "\n".join(lines)
    )
    body = json.dumps(
        {
            "model": MODEL,
            "max_tokens": 20000,  # ingredients/nutrition can be long; avoid truncated-JSON batches
            "system": SYSTEM,
            "messages": [{"role": "user", "content": user}],
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
    text = data["content"][0]["text"].strip()
    if text.startswith("```"):
        text = re.sub(r"^json\s*", "", text.split("```")[1].strip())
    arr = json.loads(text)
    if not isinstance(arr, list):  # a stray dict would otherwise iterate keys -> silent garbage
        raise ValueError("model did not return a JSON array")
    if len(arr) != len(batch):
        raise ValueError(f"got {len(arr)} results for {len(batch)} products")
    return [_clean_result(o) for o in arr]


def main():
    products = json.load(open(IN, encoding="utf-8"))
    done = {}
    if os.path.exists(OUT):
        done = {int(k): v for k, v in json.load(open(OUT, encoding="utf-8")).items()}
    todo = [p for p in products if p["row"] not in done]
    print(f"{len(products)} products, {len(done)} already done, {len(todo)} to do")
    for i in range(0, len(todo), BATCH):
        batch = todo[i : i + BATCH]
        for attempt in range(4):
            try:
                results = call(batch)
                break
            except Exception as e:
                wait = 2 ** attempt * 3
                print(f"  batch {i // BATCH} attempt {attempt} failed: {e} -> retry in {wait}s")
                time.sleep(wait)
        else:
            print(f"  batch {i // BATCH} GAVE UP, leaving for next run")
            continue
        for p, o in zip(batch, results):
            # Regex safety net under the model, from text that literally states the measurement;
            # dims_src records who supplied each number ("model" / "page" / "name") so the workbook
            # can colour a measurement by its evidence instead of leaving the cell white.
            done[p["row"]] = measure_fallback(o, p.get("clean") or p.get("name") or "",
                                              GROUND.get(p["row"], ""))
        tmp = OUT + ".tmp"  # atomic write so a crash mid-flush can't corrupt the checkpoint
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({str(k): v for k, v in done.items()}, f, ensure_ascii=False, indent=0)
        os.replace(tmp, OUT)
        print(f"  batch {i // BATCH}: +{len(batch)} (total {len(done)})")
    print(f"DONE: {len(done)} descriptions -> {OUT}")


if __name__ == "__main__":
    main()
