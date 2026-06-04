# Account & Key Setup — what only Riccardo can do

These are external, account-creating / paid steps. Claude cannot (and should not) create accounts,
generate API keys, or spend on your behalf. Do these, then tell Claude — it will wire the keys into
1Password + the project `.mcp.json` and start Phase 1 (the build).

## 1. Shopify  (commerce backbone — ~€33/mo Basic; 3-day free trial + 3mo @ €1)
- [ ] Create the store (start the free trial). Plan: **Basic**.
- [ ] **Settings → Payments:** check whether **Shopify Payments is approved** for your Malta account.
      If not, we'll wire **Stripe** instead (note it).
- [ ] Create a **custom app** (Settings → Apps → Develop apps) → generate:
      - **Admin API access token** (least-privilege scopes: products, inventory, orders, content).
      - **Storefront API access token**.
- [ ] Have your **Malta VAT number** ready (for Shopify Tax + EU OSS).
- [ ] Enable **2FA** on the Shopify admin.

## 2. Builder.io  (visual / AI build spine — Free to start; Pro ~$30/user/mo when ready)
- [ ] Create an account → create a **Space** for Pet Centre.
- [ ] Copy the **Public API key** (Space settings).
- [ ] Enable **2FA**.

## 3. Stripe  (ONLY if Shopify Payments isn't approved for you)
- [ ] Create a Stripe account (Malta) → copy **Publishable** + **Secret** keys (test mode first).

## 4. Hand the keys to Claude
Don't paste secrets into chat files. Tell Claude you've created them; it will guide you to store each
in **1Password (AI-Stack vault)** and reference them via `op://` in `.env.tpl` — never on disk.

## What Claude does next (once keys exist)
1. Wire secrets: 1Password items → `.env.tpl` + `tools/secrets-manifest.json`.
2. Register MCPs (Shopify Dev/Storefront + Builder.io) in a project `.mcp.json`; install the Shopify
   AI Toolkit Claude Code plugin.
3. Phase 1 build: products/inventory → Hydrogen on Oxygen → Builder.io homepage → payments → legal +
   consent → POS Lite. Then you tweak a section by hand to confirm the loop.
