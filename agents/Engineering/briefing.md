# Engineering — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). Keeping the brief's lists here means a ClaudeKit
regen of any managed doc can't blank what Engineering projects get briefed. Edit THIS file to change
the Engineering brief.

Four `##` sections are parsed: **Mandatory Gates**, **Recommended Skills**, **MCP Tools**, **Your
Agents**. The single **[ENFORCED]** gate (code-review before push/deploy) is injected automatically
from `tools/brief-lib.mjs` for every domain — do NOT repeat it here; list only Engineering's own
**[CONVENTION]** practices. Keep each bullet on ONE line; the parser keeps a bullet's first line and
dedupes by its first `backticked` / **bold** token.

## Mandatory Gates

- [CONVENTION] **`/test` before shipping** a feature — verify behavior, don't assume.
- [CONVENTION] **`/fix`** for concrete bugs / CI failures (root-cause, not blind edits).
- [CONVENTION] **`frontend-design`** before frontend/UI code (pulls in WebDesign's craft; surfaced automatically when a project is also WebDesign).

## Recommended Skills

- **The moment there's a UI, reach for `frontend-design` + `ui-ux-pro-max`** — they're what keep a frontend from looking generic; don't hand-roll the visual layer.
- Build: `backend-development` · `frontend-development` · `databases` · `web-frameworks` · `better-auth` · `payment-integration` (stack-specific: `tanstack`, `shopify`, `mobile-development`, `react-best-practices`).
- Ship & ops: `deploy` · `devops` · `security-scan` / `ck-security`.
- Work & quality: open unfamiliar code with `/scout`, weigh options with `/brainstorm`, root-cause with `/ck:debug`, verify with `/test`, fix concretely with `/fix`; pull current library docs via `docs-seeker` instead of guessing.
- Full "which skill for which job" map: `~/.claude/rules/skill-domain-routing.md`.

## Designated in-house engines (do NOT rebuild these, and do NOT confuse them)

Reach for the existing engine before writing anything. Each one is finished, reviewed and in use.

**Barcode / GTIN → product identity, images, descriptions, dimensions →
`projects/pet-centre-catalog/`** (`resolve-images.py` is the engine; architecture in
`docs/engine-briefing.md`). Any task that starts from a barcode, EAN/UPC/GTIN, a POS export or a
shelf scan routes here — there is no other barcode tool, and "look it up on the web" is not a
substitute. Accuracy rule: a result is only reported when the GTIN is confirmed LITERALLY at the
source, so GREEN means barcode-proven, never name-matched. It is vertical-agnostic and portable
(pet shop → pool shop already done); re-point it per `docs/engine-briefing.md` → *Adapting to a NEW
catalogue*, don't fork it.

The deliverable is the LAST step, not the lookup: `read-catalog.py` (or a scan front end) →
`resolve-images.py` → `translate-names.py` (scan-sourced, non-English sources) → `gen-descriptions.py`
→ `normalize-images.py` → `assemble.py --preview --embed --imgdir <normalized>` →
`make-preview-pdf.py` → `export-shopify.py` (Shopify clients). The `--embed --imgdir` flags are
what produce the actual artifact: a curation workbook with an embedded thumbnail per row, per-field
GREEN/YELLOW/RED grading and a worst-field READY/REVIEW/HOLD status. Omit them and you get a
colourless, image-free table and will wrongly conclude the engine cannot do images.

To land it in Google Sheets, upload that .xlsx and let Drive convert it — anchored images survive, so
no image hosting, no public links, no `=IMAGE()` (which fails outright: Google's image fetcher is
anonymous and retailer hosts refuse it). Helper: `tools/google-sheets-lib.mjs`
(`getClaspAccessToken` + `uploadXlsxAsSheet`); clasp's login is the credential here carrying a Drive
scope.

Identity sources are **key-gated and fail-open**, so adding one is dropping a key into the root `.env`:
`BARCODELOOKUP_API_KEY` (paid, best non-food coverage) and `ICECAT_USERNAME` (free, electronics-skewed)
join the GREEN cascade; `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` (free, global, any category) is capped at
YELLOW because eBay's GTIN is seller-asserted, not manufacturer-asserted. **GS1 is manual only** — every
endpoint 403s to programmatic clients and access is a human request to the national office; use its free
web lookup to settle a single disputed code, never try to automate it.

**Don't mix these up** — they are different tools that all touch products or spreadsheets:
| Need | Use | NOT |
|---|---|---|
| barcode → what is this product | `projects/pet-centre-catalog/` | anything else |
| scanned code list as the input | `projects/splashstore/catalog/read-scans.py` (front end only) | the engine's `read-catalog.py`, which expects a POS xlsx with names |
| Hike POS catalogue → a live Google Sheet | `projects/pet-centre-hike-sync/` (Apps Script) | the catalogue engine |
| write/format an existing Google Sheet from Node | `tools/google-sheets-lib.mjs` | hand-rolling OAuth again |

## MCP Tools

- **Context7** — up-to-date library/framework documentation lookup.
- **Chrome DevTools** — live UI debugging, performance, scripted browser flows.
- **Cloudflare** — D1 queries, Workers, KV/R2 (meetsync infra).
- **Trigger.dev** — background jobs & scheduled tasks (build in `projects/trigger-automations/`).
- **Sequential Thinking** — structured multi-step reasoning when a problem is gnarly.
- Need custom art / video / music / voice? That's the **WebDesign / Marketing** domains — `creative-router` (fal) for visuals + music, **ElevenLabs** for voice/SFX; add that `Domain:` to the project too rather than pulling the tools in here.

## Your Agents

All agents are global (`~/.claude/agents/`) — spawn them, don't carry a big build solo. Hand planning &
construction to **planner** / **researcher** / **fullstack-developer** / **frontend-developer** /
**database-admin**; route quality & shipping through **code-reviewer** (the gate) / **tester** /
**debugger** / **code-simplifier**; lean on **docs-manager** / **git-manager** / **mcp-manager** /
**brainstormer** / **journal-writer** for support.
