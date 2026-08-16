#!/usr/bin/env python
"""Render every confirmed product name in English (step 2c, after merge-names).

WHY. Identity is confirmed wherever the GTIN is literally printed, and that is very often a German,
French, Greek, Slovenian or Russian retailer page. The confirmation is just as valid — the barcode is
the same number in every language — but the resulting NAME lands in that language, and a storefront
selling in English cannot ship "Подушка для надувного SPA" or "Sól Do Basenu" to a customer.

So this translates the name only. It does NOT re-open the identity question: the row stays exactly as
confirmed, and the original string is preserved in `name_original` so the link back to the source page
is never lost.

WHAT IS PRESERVED VERBATIM (the translator is instructed, and the result is checked):
  brand names, model/article codes (SC713, C-4401, 58094_26), sizes and units (22 cm, 3,0 kg, 1 L),
  and pack counts. Those carry the product's identity; translating or "tidying" them would break the
  match to the packaging in the garage.

Side benefit: downstream category/type/collection matching keys off English words, so a translated
name classifies correctly where the foreign one silently fell through to blank.

Usage: python translate-names.py <catalog-named.json> [<catalog-desc.json>]
"""
import json
import os
import re
import sys
import urllib.request

IN = sys.argv[1]
DESC_IN = sys.argv[2] if len(sys.argv) > 2 else None
MODEL = "claude-sonnet-4-6"     # a translation, not a judgement call — no need for a bigger model
BATCH = 25

KEY = os.environ.get("ANTHROPIC_API_KEY")
if not KEY:
    sys.exit("ANTHROPIC_API_KEY not set")

# A name is left alone when it is already plain ASCII English-looking AND carries no obvious foreign
# marker. Cheaper and safer than round-tripping every string through a model.
FOREIGN_HINT = re.compile(
    r"[^\x00-\x7F]"                                   # any non-ASCII letter (é ü ö Ø Greek Cyrillic)
    r"|\b(?:gonflable|piscine|de|du|des|pour|sur|avec|nettoyant|batterie"    # fr
    r"|reiniger|ersatzfilter|poolpflege|wasserpflege|siedesalz|randreiniger|fur|mit|und"  # de
    r"|basenu|sol|do|kartuov|vane|baterijski|robotski|sesalnik|bazene|siva"  # pl/sk/sl
    r"|filtre|cartouche|lot|piece|pieces|nettoyage)\b",
    re.IGNORECASE)


def needs_translation(name):
    return bool(name) and bool(FOREIGN_HINT.search(name))


def call_claude(items):
    """items: [{row, name}] -> {row: english_name}. Fails closed: on any error the originals stand."""
    listing = "\n".join(f'{i["row"]}: {i["name"]}' for i in items)
    prompt = (
        "Translate each product name into natural English for an online pool and spa shop.\n\n"
        "RULES — these matter more than fluency:\n"
        "1. Keep brand names EXACTLY as written (Intex, Bestway, Darlly, Bayrol, hth, Aiper, "
        "AstralPool, Höfer Chemie, Steinbach, Gre, Aquality...).\n"
        "2. Keep every model/article code EXACTLY (SC713, C-4401, PRB17.5SF, 58094_26, 28506).\n"
        "3. Keep every measurement and unit EXACTLY, including the original decimal comma "
        "(22 cm, 10.6 x 13.6 cm, 3,0 kg, 1 L, 99x191x25 cm).\n"
        "4. Keep pack counts (2 pack, Set of 3, twin pack).\n"
        "5. Translate ONLY the descriptive words. Do not add words, do not invent a product type, "
        "do not expand abbreviations, do not reorder more than English grammar requires.\n"
        "6. If a name is already English, return it UNCHANGED.\n\n"
        "Reply with ONLY a JSON object mapping each id to its English name, no prose:\n"
        '{"5": "English name", "7": "English name"}\n\n'
        f"Names:\n{listing}"
    )
    body = json.dumps({"model": MODEL, "max_tokens": 4000,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"x-api-key": KEY, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            text = json.loads(r.read())["content"][0]["text"].strip()
    except Exception as e:
        print(f"  translation call failed ({e}) — originals kept for this batch")
        return {}
    if text.startswith("```"):
        text = re.sub(r"^json\s*", "", text.split("```")[1].strip())
    try:
        return json.loads(text)
    except Exception:
        print("  could not parse translation JSON — originals kept for this batch")
        return {}


def code_tokens(s):
    """Model codes and measurements that must survive translation, for the safety check below."""
    return set(re.findall(r"\b[A-Z]{1,4}[-–]?\d{2,}[A-Z0-9.\-_/]*\b", (s or "").upper())) | \
           set(re.findall(r"\d+(?:[.,]\d+)?\s*(?:cm|mm|kg|g|ml|l)\b", (s or "").lower()))


def main():
    rows = json.load(open(IN, encoding="utf-8"))
    todo = [{"row": r["row"], "name": r["clean"]} for r in rows
            if r.get("clean") and needs_translation(r["clean"])]
    print(f"{len(rows)} rows | {len(todo)} names look non-English")
    if not todo:
        return

    mapping = {}
    for i in range(0, len(todo), BATCH):
        mapping.update(call_claude(todo[i:i + BATCH]))

    changed, rejected = 0, 0
    for r in rows:
        new = (mapping.get(str(r["row"])) or "").strip()
        if not new or new == r.get("clean"):
            continue
        # Safety: a translation that DROPPED a model code or a measurement has changed the product's
        # identity, not its language. Reject it and keep the confirmed original.
        lost = code_tokens(r["clean"]) - code_tokens(new)
        if lost:
            rejected += 1
            print(f"  rejected (lost {sorted(lost)[:2]}): {r['clean'][:48]!r}")
            continue
        r["name_original"] = r["clean"]
        r["clean"] = r["name"] = new
        changed += 1

    with open(IN, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=0)
    if DESC_IN:      # keep the descriptions input in step with the names it will be grounded on
        with open(DESC_IN, "w", encoding="utf-8") as f:
            json.dump([r for r in rows if r.get("clean")], f, ensure_ascii=False, indent=0)
    print(f"translated {changed} names to English"
          + (f" | {rejected} rejected for dropping a code/measurement" if rejected else ""))


if __name__ == "__main__":
    main()
