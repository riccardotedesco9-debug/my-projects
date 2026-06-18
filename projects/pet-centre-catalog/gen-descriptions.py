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

SYSTEM = (
    "You write product descriptions for a friendly neighbourhood pet shop's catalog. "
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
    "cliches ('purr-fect', 'best ever', 'must-have'), no emojis, no exclamation overload. Don't repeat "
    "the brand or size if it adds nothing. Vary sentence openings across products.\n"
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


def _clean_result(o):
    """Normalise one model result; tolerate a bare string (description only, no dims/ingredients)."""
    if isinstance(o, str):
        return {"description": o.strip(), "depth": None, "width": None, "height": None, "weight": None, "ingredients": ""}
    if not isinstance(o, dict):
        return {"description": "", "depth": None, "width": None, "height": None, "weight": None, "ingredients": ""}
    return {
        "description": (o.get("description") or "").strip(),
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
            done[p["row"]] = o  # object: {description, depth, width, height, weight}
        tmp = OUT + ".tmp"  # atomic write so a crash mid-flush can't corrupt the checkpoint
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({str(k): v for k, v in done.items()}, f, ensure_ascii=False, indent=0)
        os.replace(tmp, OUT)
        print(f"  batch {i // BATCH}: +{len(batch)} (total {len(done)})")
    print(f"DONE: {len(done)} descriptions -> {OUT}")


if __name__ == "__main__":
    main()
