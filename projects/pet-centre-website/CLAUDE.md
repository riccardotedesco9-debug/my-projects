# CLAUDE.md — pet-centre-website

Domain: **WebDesign — Web Studio Mode** (lives in `projects/`; uses global + WebDesign skills).
> Toolkit + mandatory gates: [agents/WebDesign/CLAUDE.md](../../agents/WebDesign/CLAUDE.md) — frontend-design before UI, code-reviewer + `/ck:security` before deploy. The Oxygen/Shopify deploy is hard-blocked by `tools/gate-deploy.mjs` until a review is recorded for the current commit.

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

## Status — flagship build complete (June 2026)
- **Storefront** (`storefront/`) — Oxygen-linked, deployed to Production
  (`my-store-bc19f2075e1627c3f983.o2.myshopify.dev`, currently **Private** — flip Production to
  Public to share). typecheck + build green (client + SSR).
- **Brand design system:** Fredoka/Montserrat loaded; Tailwind v4 `@theme` tokens (green/gold/navy +
  warm neutrals); commerce pages (header, footer, product, collection, cart, search) fully rebranded;
  hand-coded two-gold-paws SVG logo (`app/components/Logo.tsx`).
- **Imagery:** all **15 products imaged** (warm-premium fal.ai shots via `tools/add-product-images.mjs`),
  **7 optimized heroes** in `storefront/public/heroes/`, **6 category banners**.
- **Builder pages (5):** Home (`/`), About, Pet Club, Vet & Grooming, Contact — premium scoped-HTML,
  authored via `tools/build-pages.mjs` (Write API). **6 live smart collections** with hero banners
  (`tools/create-collections.mjs`).
- **Commerce + features:** product page (stock badge In/Low/Sold-out, trust badges, Details,
  related-products row), collection heroes, `/newsletter` route, LocalBusiness JSON-LD, GDPR consent
  banner + chatbot bubble wired in `root.tsx`.
- **Verified:** screenshot QA across home/collection/product/about/pet-club/vet-grooming — all on-brand.

**Remaining / owner actions:** run `pnpm shopify hydrogen deploy --force` (non-TTY → owner terminal);
flip Production **Public** + attach `petcentremalta.com`; drop real Crisp ID
(`app/components/Chatbot.tsx`) + Cal.com URL (`app/routes/book.tsx`); wire `/newsletter` to Shopify
Email/Klaviyo; push commits to GitHub.

## Malta
18% VAT + EU OSS (needs Malta VAT no.); Shopify Payments early-access (confirm or use Stripe);
GDPR consent + DPAs; EU AI Act Art. 50 chatbot disclosure (from 2 Aug 2026). EUR.
