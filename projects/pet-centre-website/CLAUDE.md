# CLAUDE.md — pet-centre-website

Domain: **WebDesign — Web Studio Mode** (lives in `projects/`; uses global + WebDesign skills).

The **build** of the Pet Centre online store for Riccardo's real pet shop in Mellieħa, Malta
(petcentremalta.com — vet + retail under one roof, Pet Club loyalty, 6 animal categories). The
marketing strategy + research lives in the sibling **`../pet-centre-mellieha/`** project; this
folder is the production website.

> **This is the first test bed for the general-purpose Web Studio tool**, not a one-off. The tool
> (see the recipe) is built to stand up *any* site — marketing, blog, web-app, storefront. Pet
> Centre just happens to be the first (and a commerce one). Keep build patterns reusable, not
> pet-store-specific.

## Stack (composable; see the recipe)
Builder.io (visual + Fusion AI) on **Shopify headless**, rendered by **Hydrogen on Oxygen**.
Add-on modules: BookX (vet/grooming booking) · Flyweight AI (chatbot) · Shopify Email · Judge.me
(reviews) · Smile.io (Pet Club) · Pandectes (GDPR). Full procedure, MCP/secrets wiring, and the
security model: **[`../../agents/WebDesign/.claude/rules/web-studio-recipe.md`](../../agents/WebDesign/.claude/rules/web-studio-recipe.md)**.
Approved architecture plan: `~/.claude/plans/you-are-a-senior-wild-simon.md`.

## Security invariant
Payments/checkout/cards/accounts = certified managed services only (Shopify PCI L1, Stripe). AI
owns presentation only. 2FA on every admin.

## Brand
Green `#00975a` + gold `#e0b136` + navy `#243673`; display *Bobby Jones* / Fredoka, body
*Montserrat* / *DM Sans*; logo = two gold paws + green "Pet Centre". Tokens:
`../../agents/WebDesign/brand_assets/pet-centre/brand-tokens.md`.

## Status
**Scaffold only — blocked on account/key setup.** Nothing is wired or deployed yet. Next action is
Riccardo's: create the accounts + generate keys per **[`docs/account-setup-checklist.md`](docs/account-setup-checklist.md)**.
Once keys exist, wire them into 1Password + the project `.mcp.json`, then start Phase 1 (MVP).

## Malta
18% VAT + EU OSS (needs Malta VAT no.); Shopify Payments early-access (confirm or use Stripe);
GDPR consent + DPAs; EU AI Act Art. 50 chatbot disclosure (from 2 Aug 2026). EUR.
