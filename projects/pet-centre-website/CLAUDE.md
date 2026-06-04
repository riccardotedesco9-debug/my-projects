# CLAUDE.md — pet-centre-website

Domain: **WebDesign — Web Studio Mode** (lives in `projects/`; uses global + WebDesign skills).

The **build** of the Pet Centre online store for Riccardo's real pet shop in Mellieħa, Malta
(petcentremalta.com — vet + retail under one roof, Pet Club loyalty, 6 animal categories). The
marketing strategy + research lives in the sibling **`../pet-centre-mellieha/`** project; this
folder is the production website (the app is in `storefront/`).

> **This is the first test bed for the general-purpose Web Studio tool**, not a one-off. The tool
> (see the recipe) is built to stand up *any* site — marketing, blog, web-app, storefront. Pet
> Centre just happens to be the first (and a commerce one). Keep build patterns reusable, not
> pet-store-specific.

## Stack (composable; see the recipe)
Builder.io (visual + Fusion AI) on **Shopify headless**, rendered by **Hydrogen on Oxygen**
(Hydrogen 2026.1.1, React Router 7, **Tailwind v4**, **pnpm**). Add-on modules:
**Cal.com/Calendly** (vet/grooming booking, inline embed) · **Crisp** (EU-hosted chatbot + AI-Act
disclosure) · Shopify Email · Judge.me (reviews) · Smile.io (Pet Club) · custom GDPR consent banner.
Full procedure, the client-credentials Admin flow, and the security model:
**[`../../agents/WebDesign/.claude/rules/web-studio-recipe.md`](../../agents/WebDesign/.claude/rules/web-studio-recipe.md)**.
Approved architecture plan: `~/.claude/plans/you-are-a-senior-wild-simon.md`.

## Security invariant
Payments/checkout/cards/accounts = certified managed services only (Shopify PCI L1, Stripe). AI
owns presentation only. 2FA on every admin.

## Brand
Green `#00975a` + gold `#e0b136` + navy `#243673`; display *Fredoka*, body *Montserrat*; logo =
two gold paws + green "Pet Centre". Tokens:
`../../agents/WebDesign/brand_assets/pet-centre/brand-tokens.md`.

## Status — built, deployed & stocked (June 2026)
- **Storefront** (`storefront/`) — Oxygen-linked, **deployed to Production**
  (`my-store-bc19f2075e1627c3f983.o2.myshopify.dev`, currently **Private** — flip Production to
  Public to share). Builds green (client + SSR); renders the Builder homepage + native commerce.
- **Real store:** `dsgncm-nw.myshopify.com`. **15 starter products** seeded across all 6 categories
  (priced EUR, published to every channel) via `tools/seed-catalog.mjs` (client-credentials Admin token).
- **Builder pages:** Home (`/`), Contact, Vet & Grooming — published, served through the catch-all route.

**Remaining / placeholders:** product images (none yet — the next visual upgrade); real Crisp website
ID (`app/components/Chatbot.tsx`); Cal.com/Calendly URL (`app/routes/book.tsx`); make Production
Public to go live; push commits to GitHub.

## Malta
18% VAT + EU OSS (needs Malta VAT no.); Shopify Payments early-access (confirm or use Stripe);
GDPR consent + DPAs; EU AI Act Art. 50 chatbot disclosure (from 2 Aug 2026). EUR.
