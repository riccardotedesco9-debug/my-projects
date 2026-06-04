# Accounts & keys — current state (set up, June 2026)

Everything needed for the build is set up. Kept as a reference of what exists + the few optional items left.

## Done
- **Shopify store** `dsgncm-nw.myshopify.com` (Basic) — created; **Hydrogen sales channel** added;
  storefront deployed to Oxygen Production.
- **Custom app (Admin API)** — created in the Dev Dashboard with broad write scopes (`write_products`,
  `write_publications`, `write_inventory`, `write_content`, …). Provisioning uses the **client-credentials
  grant** (Client ID + Secret → 24h Admin token) — see recipe §8 + `tools/seed-catalog.mjs`.
- **Storefront / Headless token** — auto-provisioned by the Hydrogen channel (read-only `unauthenticated_*`).
- **Builder.io** space "Riccardo Tedesco" — public API key wired in `storefront/app/lib/builder.ts`.
- **1Password (AI-Stack):** Shopify Client ID + Secret in *"Shopify ID & Secret"*; Storefront token in
  *"Hydrogen API"*; Builder keys in *"builder-io"*.

## Optional / when ready
- [ ] **Shopify Payments** — confirm Malta approval (else wire Stripe) before taking real orders.
- [ ] **Malta VAT number** — for Shopify Tax + EU OSS.
- [ ] **2FA** on Shopify admin + Builder.io — the real security boundary; do this.
- [ ] Make the Production storefront **Public** + attach **petcentremalta.com**.
- [ ] Real **Crisp** website ID + **Cal.com/Calendly** booking URL (swap the placeholders).
- [ ] Product **images** (the catalog is text-only so far).
