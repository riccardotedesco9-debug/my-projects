#!/usr/bin/env python
"""Generate warm, informative 1-2 sentence product descriptions via Claude Haiku.

Batched + resumable: descriptions are keyed by worksheet row and checkpointed to
OUT after every batch, so a crash never re-bills completed work. Reads ANTHROPIC_API_KEY
from the environment (inject via `op run --env-file=.env.tpl`).

Optionally grounded: pass the image-resolver output as a 4th arg and any product that
was verified carries real product text scraped from its source page, letting the writer
include accurate specifics (key ingredient, material, dimensions) instead of staying generic.

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
MODEL = "claude-haiku-4-5-20251001"
KEY = os.environ.get("ANTHROPIC_API_KEY")
if not KEY:
    sys.exit("ANTHROPIC_API_KEY not set — run via `op run --env-file=.env.tpl -- python gen-descriptions.py ...`")

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
    "When a product includes source_info (real text scraped from its verified product page), you MAY "
    "use accurate, specific facts from it — a key ingredient, material, dimensions, or intended use — "
    "to make the description more informative. Use only facts clearly about THIS product; ignore "
    "navigation, prices, reviews, cookie notices and unrelated text, and never copy marketing fluff. "
    "RULES: Never name or refer to the shop, any town, or location. No fluff, no hype, no marketing "
    "cliches ('purr-fect', 'best ever', 'must-have'), no emojis, no exclamation overload. Don't repeat "
    "the brand or size if it adds nothing. "
    "Vary sentence openings across products. Output is plain text, one description, no quotes or labels."
)


def call(batch):
    """Return list of descriptions aligned to batch order."""
    lines = []
    for i, p in enumerate(batch):
        line = f'{i + 1}. name="{p["clean"]}" brand="{p["brand"] or "n/a"}" category="{p["type"] or "n/a"}"'
        src = GROUND.get(p["row"])
        if src:
            line += f'\n   source_info="""{src[:800]}"""'
        lines.append(line)
    user = (
        "Write a description for each numbered product below. "
        "Return ONLY a JSON array of strings, in the same order, one description per product. "
        "No keys, no numbering, no extra text.\n\n" + "\n".join(lines)
    )
    body = json.dumps(
        {
            "model": MODEL,
            "max_tokens": 4096,
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
    if len(arr) != len(batch):
        raise ValueError(f"got {len(arr)} descriptions for {len(batch)} products")
    return arr


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
                descs = call(batch)
                break
            except Exception as e:
                wait = 2 ** attempt * 3
                print(f"  batch {i // BATCH} attempt {attempt} failed: {e} -> retry in {wait}s")
                time.sleep(wait)
        else:
            print(f"  batch {i // BATCH} GAVE UP, leaving for next run")
            continue
        for p, d in zip(batch, descs):
            done[p["row"]] = d.strip()
        json.dump({str(k): v for k, v in done.items()}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        print(f"  batch {i // BATCH}: +{len(batch)} (total {len(done)})")
    print(f"DONE: {len(done)} descriptions -> {OUT}")


if __name__ == "__main__":
    main()
