"""Inline the barcode images into the template, then render the PDF.

The published HTML is self contained: every barcode is embedded as a data URI
rather than linked. That keeps the source file portable and sidesteps the way
headless Chromium treats local file:// subresources.

Placeholder {{SOME_TOKEN}} maps to barcodes/some-token.png. The build fails
loudly on any placeholder left unreplaced, because a silently missing barcode
would render as an empty box that still looks plausible on paper.
"""
import base64
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BARCODES = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "barcodes"
OUT_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE.parent.parent / "docs"

TEMPLATE = HERE / "template.html"
OUT_HTML = OUT_DIR / "ds2278-owner-cheat-sheet.html"
OUT_PDF = OUT_DIR / "ds2278-owner-cheat-sheet.pdf"

NODE_PATH = "C:/Users/Riccardo/AppData/Roaming/npm/node_modules"

html = TEMPLATE.read_text(encoding="utf8")

# Refuse to build against barcodes that did not decode during extraction.
manifest_path = BARCODES / "manifest.json"
if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    broken = [k for k, v in manifest.items() if "OK" not in v["status"]]
    if broken:
        sys.exit(f"barcodes failed to decode at extraction time: {broken}")

tokens = sorted(set(re.findall(r"\{\{([A-Z0-9_]+)\}\}", html)))
if not tokens:
    sys.exit("template contains no barcode placeholders")

for token in tokens:
    png = BARCODES / f"{token.lower().replace('_', '-')}.png"
    if not png.exists():
        sys.exit(f"missing barcode image for {{{{{token}}}}}: {png}")
    uri = "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode()
    html = html.replace(f"{{{{{token}}}}}", uri)

left = re.findall(r"\{\{[A-Z0-9_]+\}\}", html)
if left:
    sys.exit(f"unreplaced placeholders: {left}")

OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_HTML.write_text(html, encoding="utf8")
print(f"wrote {OUT_HTML}  ({len(html) / 1024:.0f} KB, {len(tokens)} barcodes inlined)")

# Playwright rather than the bare `playwright pdf` CLI: that CLI never passes
# printBackground, so every tinted panel would silently drop out.
script = """
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.emulateMedia({ media: 'print', colorScheme: 'light' });
  await p.goto(process.argv[1], { waitUntil: 'networkidle' });
  await p.pdf({
    path: process.argv[2],
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', right: '13mm', bottom: '14mm', left: '13mm' },
  });
  await b.close();
})();
"""

url = OUT_HTML.as_uri()
res = subprocess.run(
    ["node", "-e", script, url, str(OUT_PDF)],
    env={**__import__("os").environ, "NODE_PATH": NODE_PATH},
    capture_output=True,
    text=True,
)
if res.returncode != 0:
    sys.exit(f"render failed:\n{res.stdout}\n{res.stderr}")

print(f"wrote {OUT_PDF}  ({OUT_PDF.stat().st_size / 1024:.0f} KB)")
