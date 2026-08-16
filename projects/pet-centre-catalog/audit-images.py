#!/usr/bin/env python
"""Vision-audit the images a run already resolved: is each one really THIS product, one unit, uncropped?

WHY SEPARATE FROM `--vision`. The resolver's own `--vision` flag judges images *during* the cascade,
which means enabling it costs a full re-run: Firecrawl credits again, and a metered Barcode Lookup
call per product. This audits what is already on disk — no Firecrawl, no barcode DB, no re-resolution.
It is the cheap way to answer "is that actually the product?" after the fact.

COST. One downscaled image (long edge 1024) plus a short prompt is roughly 1.9k input / 60 output
tokens on Sonnet — about $0.006 per image, so ~$0.20 for a 30-image batch and ~$1.50 for a
229-product catalogue. Bounded by --limit if you want to sample rather than sweep.

WHAT IT DOES NOT DO. It never swaps or deletes an image. Deciding a photo is wrong is a judgement,
and the engine's rule is that judgements get FLAGGED for a human, not acted on silently. It writes
`img_quality` (crop / multi / mismatch / unclear) and `img_audit` (the model's one-line reason) back
onto the resolved record, which the curation workbook then shows beside the photo.

The deterministic gate in resolve-images.py (`looks_like_placeholder`) still runs first and costs
nothing — that one catches site logos and empty banners outright. This is for the subtler cases:
a cropped product, a multipack marketing shot, a lifestyle scene, or simply the wrong item.

Usage: python audit-images.py <resolved.json> <catalog-named.json> [--limit N] [--apply]
"""
import importlib.util
import json
import os
import sys

RESOLVED = sys.argv[1]
CATALOG = sys.argv[2]
APPLY = "--apply" in sys.argv
LIMIT = None
if "--limit" in sys.argv:
    i = sys.argv.index("--limit")
    if i + 1 < len(sys.argv) and sys.argv[i + 1].isdigit():
        LIMIT = int(sys.argv[i + 1])

if not os.environ.get("ANTHROPIC_API_KEY"):
    sys.exit("ANTHROPIC_API_KEY not set")
# The resolver exits at import without a Firecrawl key. Nothing here calls Firecrawl, so a placeholder
# satisfies the guard and keeps `vision_assess` in ONE place rather than copying it.
os.environ.setdefault("FIRECRAWL_API_KEY", "unused-by-audit")

_spec = importlib.util.spec_from_file_location(
    "engine", os.path.join(os.path.dirname(os.path.abspath(__file__)), "resolve-images.py"))
engine = importlib.util.module_from_spec(_spec)
sys.argv = [sys.argv[0], "in", "out"]          # the engine reads argv at import
_spec.loader.exec_module(engine)


def main():
    resolved = json.load(open(RESOLVED, encoding="utf-8"))
    rows = {str(r["row"]): r for r in json.load(open(CATALOG, encoding="utf-8"))}

    targets = [(k, v) for k, v in sorted(resolved.items(), key=lambda x: int(x[0])) if v.get("url")]
    if LIMIT:
        targets = targets[:LIMIT]
    print(f"auditing {len(targets)} images (~${0.006 * len(targets):.2f})\n")

    flagged, checked = [], 0
    for key, rec in targets:
        row = rows.get(key, {})
        name = row.get("clean") or row.get("name") or ""
        verdict = engine.vision_assess(rec["url"], name, row.get("brand", ""), row.get("type", ""))
        checked += 1
        conf = verdict.get("confidence", 0)
        # A barcode-confirmed row is NOT demoted on vision's say-so — the GTIN is harder evidence than
        # a picture. Only the photo is flagged, and only when the model is actually sure.
        problem = ""
        if conf >= engine.VISION_MIN_CONF:
            if not verdict["match"]:
                problem = "mismatch"
            elif not verdict["whole"]:
                problem = "crop"
            elif not verdict["single"]:
                problem = "multi"
        if problem:
            flagged.append((key, problem, name, verdict.get("reason", "")))
            print(f"  row {key:>3}  {problem:<9} {name[:44]:<46} {verdict.get('reason','')[:40]}")
            if APPLY:
                rec["img_quality"] = problem
                rec["img_audit"] = verdict.get("reason", "")[:120]
        elif APPLY:
            rec.pop("img_audit", None)
            if rec.get("img_quality") in ("mismatch", "crop", "multi"):
                rec.pop("img_quality", None)     # previously flagged, now clean

    if APPLY:
        with open(RESOLVED, "w", encoding="utf-8") as f:
            json.dump(resolved, f, ensure_ascii=False, indent=0)

    print(f"\n{checked} checked | {len(flagged)} flagged"
          + (" | written back to the resolved record" if APPLY else " | dry run, use --apply to record"))


if __name__ == "__main__":
    main()
